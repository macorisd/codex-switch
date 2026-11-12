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
const DEFINITIONS = require('./backend/providers.json');
const PROVIDERS = [{ id: 'openai', name: 'ChatGPT', subtitle: 'Your Plan' }, ...DEFINITIONS];
const PROVIDER_LAYOUT_KEY = 'providerLayout';
const BALANCE_ALERT_KEY = 'deepseekBalanceAlert';
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
    this.balanceAlert = { threshold: 5, level: 'ok', ...context.globalState.get(BALANCE_ALERT_KEY, {}) };
    this.api = new ApiSessions({ definitions: DEFINITIONS, request: backend,
      visible: id => this.canLoad(id), post: value => this.view?.webview.postMessage(value),
      input: options => vscode.window.showInputBox(options),
      apply: work => this.applyProvider(work), timers: { setInterval, clearInterval },
      alerts: total => this.checkBalance(total) });
  }
  canLoad(id) { return this.viewVisible && this.providerLayout().some(p => p.id === id && p.visible); }
  resolveWebviewView(view) {
    this.view = view;
    this.viewVisible = view.visible !== false;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = crypto.randomBytes(24).toString('base64');
    let html = fs.readFileSync(path.join(this.context.extensionPath, 'media', 'index.html'), 'utf8');
    const replacements = { '{{NONCE}}': nonce, '{{CSP}}': view.webview.cspSource };
    for (const [name, file] of Object.entries({ STYLE: 'style.css', SCRIPT: 'view.js', API_SCRIPT: 'api-view.js', CHATGPT_ICON: 'providers/openai.svg', DEEPSEEK_ICON: 'providers/deepseek.svg' })) {
      replacements[`{{${name}}}`] = view.webview.asWebviewUri(vscode.Uri.joinPath(media, ...file.split('/'))).toString();
    }
    for (const [key, value] of Object.entries(replacements)) html = html.split(key).join(value);
    view.webview.html = html;
    this.context.subscriptions.push(view.webview.onDidReceiveMessage(m => this.run(m)),
      view.onDidChangeVisibility(() => {
        this.viewVisible = view.visible;
        if (this.viewVisible) void this.ready();
        else { this.api.reconcile(); this.stopAccountPolling(); }
      }), { dispose: () => { this.viewVisible = false; this.api.dispose(); this.stopAccountPolling(); } });
    if (view.onDidDispose) this.context.subscriptions.push(view.onDidDispose(() => {
      this.viewVisible = false; this.api.dispose(); this.stopAccountPolling();
    }));
  }
  async update() {
    try {
      const local = await backend({ action: 'status', includeDeepSeek: false });
      this.activeProvider = local.provider;
      await this.view?.webview.postMessage({ type: 'state', busy: this.busy, state: { ...local,
        providers: PROVIDERS.map(p => ({ ...p, iconUri: p.icon ? this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'providers', p.icon)).toString() : undefined })), providerLayout: this.providerLayout(), providerLayoutRevision: this.layoutRevision,
        chatgpt: this.chatgpt, balanceAlert: this.balanceAlert } });
      this.api.reconcile();
      if (!this.canLoad('openai')) this.stopAccountPolling();
    } catch { void vscode.window.showErrorMessage('The local Codex configuration could not be read.'); }
  }
  async ready() {
    await this.update();
    await Promise.allSettled([this.syncAccount(), this.api.refreshAll(true)]);
  }
  stopAccountPolling() { clearInterval(this.accountTimer); this.accountTimer = null; this.accountAbort?.abort(); }
  syncAccount() {
    if (!this.canLoad('openai')) return Promise.resolve();
    if (!this.accountTimer) this.accountTimer = setInterval(() => this.syncAccount(), 60000);
    if (this.accountRequest) return this.accountAbort?.signal.aborted ? this.accountRequest.then(() => this.syncAccount()) : this.accountRequest;
    this.accountAbort = new AbortController();
    const controller = this.accountAbort;
    this.accountRequest = (async () => {
      try {
        const account = await codexAccount.readAccount(codexAccount.executable(vscode), { signal: controller.signal });
        if (this.canLoad('openai') && !controller.signal.aborted) this.chatgpt = { ...account, loading: false, stale: false };
      } catch { if (this.canLoad('openai') && !controller.signal.aborted) this.chatgpt = { ...this.chatgpt, loading: false, stale: true }; }
      if (this.canLoad('openai') && !controller.signal.aborted) await this.view?.webview.postMessage({ type: 'chatgpt', account: this.chatgpt });
    })().finally(() => { this.accountRequest = null; });
    return this.accountRequest;
  }
  async checkBalance(total) {
    const level = total <= 0 ? 'zero' : this.balanceAlert.threshold > 0 && total < this.balanceAlert.threshold ? 'low' : 'ok';
    const previous = this.balanceAlert.level;
    this.balanceAlert.level = level;
    await this.context.globalState.update(BALANCE_ALERT_KEY, this.balanceAlert);
    if (level !== previous && level !== 'ok') void vscode.window.showWarningMessage(level === 'zero'
      ? 'DeepSeek credits are exhausted.' : `DeepSeek balance is low: $${total.toFixed(2)} remaining.`);
  }
  async applyProvider(work) {
    if (this.busy) return;
    this.busy = true;
    try { await work(); await vscode.commands.executeCommand('workbench.action.reloadWindow'); }
    finally { this.busy = false; }
  }
  async run(message) {
    if (!message || typeof message.action !== 'string') return;
    if (message.action === 'ready') return this.ready();
    if (message.action === 'saveProviderLayout') return this.saveProviderLayout(message.layout, message.revision);
    if (message.action === 'api') return this.api.run(message);
    if (message.action === 'saveBalanceAlert') {
      const value = Number(message.threshold);
      if (!Number.isFinite(value) || value < 0) return;
      this.balanceAlert = { threshold: value, level: 'ok' };
      await this.context.globalState.update(BALANCE_ALERT_KEY, this.balanceAlert);
      await this.view?.webview.postMessage({ type: 'balanceAlert', balanceAlert: this.balanceAlert });
      return this.api.refresh('deepseek');
    }
    if (message.action === 'syncAll') {
      if (this.busy || !this.viewVisible) return;
      this.busy = true;
      await this.view?.webview.postMessage({ type: 'syncLoading', loading: true });
      try { await this.update(); await Promise.allSettled([this.syncAccount(), this.api.refreshAll(true)]); }
      finally { this.busy = false; await this.update(); await this.view?.webview.postMessage({ type: 'syncLoading', loading: false }); }
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
