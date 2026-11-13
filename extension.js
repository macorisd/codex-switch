'use strict';
const vscode = require('vscode');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const process = require('node:process');
const codexAccount = require('./codex-account');
const { ApiSessions } = require('./api-session');
const balanceAlerts = require('./media/balance-alerts');
const DEFINITIONS = require('./backend/providers.json');
const PROVIDERS = [{ id: 'openai', name: 'ChatGPT', subtitle: 'Your Plan' }, ...DEFINITIONS];
const PROVIDER_LAYOUT_KEY = 'providerLayout';
const BALANCE_ALERT_KEY = 'apiBalanceAlerts';
const codexHome = (process.env.CODEX_HOME || '.codex').replace(/^~(?=$|[/\\])/, os.homedir());
const root = path.join(path.resolve(os.homedir(), codexHome), 'provider-switcher');
const python = process.platform === 'win32' ? 'python' : 'python3';

function backend(request, signal) {
  return new Promise((resolve, reject) => {
    const interpreter = vscode.workspace.getConfiguration?.('codexSwitch')?.get('pythonPath') || python;
    const child = spawn(interpreter, [path.join(__dirname, 'backend', 'bridge.py')], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: os.homedir(),
      signal,
    });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The operation took too long. Please try again.'));
    }, 65000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 4_000_000) child.kill();
    });
    // Never log process output or the request: it may contain credentials.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('The local Codex connector could not start.'));
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout);
        if (!result.ok) throw new Error(result.error);
        resolve(result.data);
      } catch (error) {
        reject(new Error(error instanceof SyntaxError ? 'The local Codex configuration could not be read.' : error.message));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

class Selector {
  constructor(context) {
    this.context = context;
    this.busy = false;
    this.layoutRevision = 0;
    this.layoutUpdate = Promise.resolve();
    this.activeProvider = null;
    this.viewVisible = false;
    this.chatgpt = { loading: true };
    const savedAlerts = context.globalState.get(BALANCE_ALERT_KEY, {});
    this.balanceAlerts = Object.fromEntries(DEFINITIONS.map(p => [p.id, { threshold: balanceAlerts.threshold(savedAlerts?.[p.id]?.threshold) }]));
    this.alertTracker = new balanceAlerts.Tracker();
    this.api = new ApiSessions({ definitions: DEFINITIONS, request: backend,
      visible: id => this.canLoad(id), post: value => this.post(value),
      input: options => this.input(options),
      apply: work => this.applyProvider(work),
      alerts: (id, balance) => this.checkBalance(id, balance) });
  }
  canLoad(id) { return this.viewVisible && this.providerLayout().some(p => p.id === id && p.visible); }
  input({ allowRemove, ...options }) {
    if (!allowRemove) return vscode.window.showInputBox(options);
    return new Promise(resolve => {
      const box = vscode.window.createInputBox();
      Object.assign(box, options);
      const remove = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Remove API key' };
      box.buttons = [remove];
      let settled = false;
      const listeners = [];
      const finish = value => {
        if (settled) return;
        settled = true;
        for (const listener of listeners) listener.dispose();
        box.value = ''; box.hide(); box.dispose();
        resolve(value);
      };
      listeners.push(box.onDidAccept(() => finish(box.value)),
        box.onDidTriggerButton(button => { if (button === remove) finish({ remove: true }); }),
        box.onDidHide(() => finish(undefined)));
      box.show();
    });
  }
  post(value) {
    // Polling publishes one completed snapshot, never intermediate loading data.
    if (this.refreshMessages && ['state', 'apiState', 'chatgpt'].includes(value.type)) {
      this.refreshMessages.set(`${value.type}:${value.provider || ''}`, value);
      return Promise.resolve();
    }
    return this.view?.webview.postMessage(value);
  }
  reconcilePolling() {
    if (this.viewVisible && this.providerLayout().some(p => p.visible)) {
      if (!this.refreshTimer) this.refreshTimer = setInterval(() => this.syncAll(false), 60000);
    } else { clearInterval(this.refreshTimer); this.refreshTimer = null; }
  }
  resolveWebviewView(view) {
    this.view = view;
    this.viewVisible = view.visible !== false;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = crypto.randomBytes(24).toString('base64');
    let html = fs.readFileSync(path.join(this.context.extensionPath, 'media', 'index.html'), 'utf8');
    const replacements = { '{{NONCE}}': nonce, '{{CSP}}': view.webview.cspSource };
    for (const [name, file] of Object.entries({ STYLE: 'style.css', SCRIPT: 'view.js', API_SCRIPT: 'api-view.js', ALERT_SCRIPT: 'balance-alerts.js', CHATGPT_ICON: 'providers/openai.svg', DEEPSEEK_ICON: 'providers/deepseek.svg' })) {
      replacements[`{{${name}}}`] = view.webview.asWebviewUri(vscode.Uri.joinPath(media, ...file.split('/'))).toString();
    }
    for (const [key, value] of Object.entries(replacements)) html = html.split(key).join(value);
    view.webview.html = html;
    this.context.subscriptions.push(view.webview.onDidReceiveMessage(m => this.run(m)),
      view.onDidChangeVisibility(() => {
        this.viewVisible = view.visible;
        if (this.viewVisible) void this.ready();
        else { this.api.reconcile(); this.stopAccountPolling(); this.reconcilePolling(); }
      }), { dispose: () => { this.viewVisible = false; this.api.dispose(); this.stopAccountPolling(); this.reconcilePolling(); } });
    if (view.onDidDispose) this.context.subscriptions.push(view.onDidDispose(() => {
      this.viewVisible = false; this.api.dispose(); this.stopAccountPolling(); this.reconcilePolling();
    }));
  }
  async update(busy = this.busy) {
    try {
      const local = await backend({ action: 'status', includeDeepSeek: false });
      this.activeProvider = local.provider;
      await this.post({ type: 'state', busy, state: { ...local,
        providers: PROVIDERS.map(p => ({ ...p, iconUri: p.icon ? this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'providers', p.icon)).toString() : undefined })), providerLayout: this.providerLayout(), providerLayoutRevision: this.layoutRevision,
        chatgpt: this.chatgpt, balanceAlerts: this.balanceAlerts } });
      this.api.reconcile();
      this.reconcilePolling();
      if (!this.canLoad('openai')) this.stopAccountPolling();
    } catch { void vscode.window.showErrorMessage('The local Codex configuration could not be read.'); }
  }
  async ready() {
    await this.update();
    await Promise.allSettled([this.syncAccount(), this.api.refreshAll(true)]);
  }
  stopAccountPolling() { this.accountAbort?.abort(); }
  syncAccount() {
    if (!this.canLoad('openai')) return Promise.resolve();
    if (this.accountRequest) return this.accountAbort?.signal.aborted ? this.accountRequest.then(() => this.syncAccount()) : this.accountRequest;
    this.accountAbort = new AbortController();
    const controller = this.accountAbort;
    this.accountRequest = (async () => {
      try {
        const account = await codexAccount.readAccount(codexAccount.executable(vscode), { signal: controller.signal });
        if (this.canLoad('openai') && !controller.signal.aborted) this.chatgpt = { ...account, loading: false, stale: false };
      } catch { if (this.canLoad('openai') && !controller.signal.aborted) this.chatgpt = { ...this.chatgpt, loading: false, stale: true }; }
      if (this.canLoad('openai') && !controller.signal.aborted) await this.post({ type: 'chatgpt', account: this.chatgpt });
    })().finally(() => { this.accountRequest = null; });
    return this.accountRequest;
  }
  checkBalance(id, balance) {
    if (!balance) { this.alertTracker.reset(id); return; }
    const warning = this.alertTracker.observe(id, balance, this.balanceAlerts[id].threshold);
    if (!warning) return;
    const name = DEFINITIONS.find(p => p.id === id).name;
    const remaining = warning.unit === '%' ? `${warning.value.toFixed(1)}%`
      : new Intl.NumberFormat('en-US', { style: 'currency', currency: warning.unit, currencyDisplay: 'code' }).format(warning.value);
    void vscode.window.showWarningMessage(warning.level === 'zero'
      ? `${name} ${warning.unit === '%' ? 'quota' : 'credits'} exhausted.`
      : `${name} ${warning.unit === '%' ? 'quota' : 'balance'} is low: ${remaining} remaining.`);
  }
  async applyProvider(work) {
    if (this.busy) return;
    this.busy = true;
    try { await work(); await vscode.commands.executeCommand('workbench.action.reloadWindow'); }
    finally { this.busy = false; }
  }
  async syncAll(manual = true) {
    if (this.busy || !this.viewVisible) return;
    // Do not start a poll over startup or an explicit credential/model action.
    if (!manual && (this.accountRequest || this.api.pending.size)) return;
    this.busy = true;
    if (!manual) this.refreshMessages = new Map();
    try {
      await this.post({ type: 'syncLoading', loading: true, quiet: !manual });
      await this.update();
      await Promise.allSettled([this.syncAccount(), this.api.refreshAll(manual)]);
      // Provider management stays available; include any newly enabled provider.
      while (this.accountRequest || this.api.pending.size) {
        await Promise.allSettled([this.accountRequest, ...this.api.pending.values()]);
      }
    } finally {
      await this.update(false);
      const updates = this.refreshMessages ? [...this.refreshMessages.values()] : undefined;
      this.refreshMessages = null;
      this.busy = false;
      await this.post({ type: 'syncLoading', loading: false, updates });
    }
  }
  async run(message) {
    if (!message || typeof message.action !== 'string') return;
    if (message.action === 'ready') return this.ready();
    if (message.action === 'saveProviderLayout') return this.saveProviderLayout(message.layout, message.revision);
    if (message.action === 'api') return this.busy ? undefined : this.api.run(message);
    if (message.action === 'saveBalanceAlert') {
      const id = message.provider;
      if (!DEFINITIONS.some(p => p.id === id) || !this.canLoad(id) || !Number.isFinite(Number(message.threshold))) return;
      const value = balanceAlerts.threshold(message.threshold);
      this.balanceAlerts[id] = { threshold: value };
      this.alertTracker.reset(id);
      this.alertTracker.observe(id, this.api.sessions.get(id).balance, value);
      await this.context.globalState.update(BALANCE_ALERT_KEY, this.balanceAlerts);
      await this.view?.webview.postMessage({ type: 'balanceAlerts', balanceAlerts: this.balanceAlerts });
      return;
    }
    if (message.action === 'syncAll') {
      return this.syncAll();
    }
    if (message.action === 'apply' && message.provider === 'openai' && !this.busy) {
      try { await this.applyProvider(() => backend({ action: 'apply', provider: 'openai' })); }
      catch { void vscode.window.showErrorMessage('Could not restore the ChatGPT configuration.'); }
    }
  }

  providerLayout(activeProvider = this.activeProvider) {
    const saved = this.context.globalState.get(PROVIDER_LAYOUT_KEY, []);
    const known = new Set(PROVIDERS.map(provider => provider.id));
    const seen = new Set();
    const layout = [];
    if (Array.isArray(saved)) {
      for (const entry of saved) {
        if (!entry || !known.has(entry.id) || seen.has(entry.id)) continue;
        seen.add(entry.id);
        layout.push({ id: entry.id, visible: entry.visible !== false });
      }
    }
    for (const provider of PROVIDERS) {
      if (!seen.has(provider.id)) layout.push({ id: provider.id, visible: true });
    }
    const active = layout.find(entry => entry.id === activeProvider);
    if (active) active.visible = true;
    return layout;
  }

  async saveProviderLayout(value, revision) {
    if (!Array.isArray(value)) return;
    const known = new Set(PROVIDERS.map(provider => provider.id));
    const seen = new Set();
    const layout = [];
    for (const entry of value) {
      if (!entry || !known.has(entry.id) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      layout.push({ id: entry.id, visible: Boolean(entry.visible) });
    }
    for (const provider of PROVIDERS) {
      if (!seen.has(provider.id)) layout.push({ id: provider.id, visible: true });
    }
    const active = layout.find(entry => entry.id === this.activeProvider);
    if (active) active.visible = true;
    const nextRevision = Number.isInteger(revision) ? revision : this.layoutRevision + 1;
    this.layoutUpdate = this.layoutUpdate.catch(() => {}).then(async () => {
      if (nextRevision < this.layoutRevision) return;
      this.layoutRevision = nextRevision;
      try {
        const previous = this.providerLayout();
        await this.context.globalState.update(PROVIDER_LAYOUT_KEY, layout);
        if (!this.canLoad('openai')) this.stopAccountPolling();
        this.api.reconcile();
        await this.view?.webview.postMessage({
          type: 'providerLayout',
          layout,
          revision: nextRevision,
        });
        for (const entry of layout) {
          if (!entry.visible || previous.find(item => item.id === entry.id)?.visible) continue;
          if (entry.id === 'openai') void this.syncAccount();
          else void this.api.refresh(entry.id, true);
        }
      } catch (error) {
        await this.view?.webview.postMessage({
          type: 'providerLayoutError',
          layout: this.providerLayout(),
          revision: this.layoutRevision,
          message: error.message,
        });
      }
    });
    return this.layoutUpdate;
  }


}

function activate(context) {
  const selector = new Selector(context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('codexSwitch.selector', selector));
  context.subscriptions.push(vscode.commands.registerCommand(
    'codexSwitch.open',
    () => vscode.commands.executeCommand('codexSwitch.selector.focus'),
  ));
  context.subscriptions.push(vscode.window.registerUriHandler({
    handleUri: () => vscode.commands.executeCommand('codexSwitch.selector.focus'),
  }));
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(root), 'config.toml'));
  let pending;
  const refresh = () => {
    clearTimeout(pending);
    pending = setTimeout(() => selector.update(), 200);
  };
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(refresh),
    watcher.onDidCreate(refresh),
    { dispose: () => clearTimeout(pending) },
  );
}

module.exports = { activate, deactivate() {} };
