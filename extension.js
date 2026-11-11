'use strict';
const vscode = require('vscode');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const codexAccount = require('./codex-account');

const root = path.join(os.homedir(), '.codex', 'provider-switcher');
const python = 'python';
const PROVIDERS = Object.freeze([
  Object.freeze({ id: 'openai', name: 'ChatGPT', subtitle: 'Your Plan' }),
  Object.freeze({ id: 'deepseek', name: 'DeepSeek', subtitle: 'API key' }),
]);
const PROVIDER_LAYOUT_KEY = 'providerLayout';
const BALANCE_ALERT_KEY = 'deepseekBalanceAlert';
const BALANCE_POLL_MS = 60_000;

function backend(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(__dirname, 'backend', 'bridge.py')], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: os.homedir(),
    });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The operation took too long. Please try again.'));
    }, 35000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 100000) child.kill();
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
    this.hasKey = false;
    this.hasValidKey = false;
    this.keyChecking = false;
    this.viewVisible = false;
    this.balanceTimer = null;
    this.balanceRequest = null;
    this.chatgpt = { loading: true };
    this.accountTimer = null;
    this.accountRequest = null;
    this.accountAbort = null;
    const savedAlert = context.globalState.get(BALANCE_ALERT_KEY, {});
    this.balanceAlert = {
      threshold: typeof savedAlert.threshold === 'number' && Number.isFinite(savedAlert.threshold)
        && savedAlert.threshold >= 0 ? savedAlert.threshold : 5,
      level: ['ok', 'low', 'zero'].includes(savedAlert.level) ? savedAlert.level : 'ok',
    };
  }

  resolveWebviewView(view) {
    this.view = view;
    this.viewVisible = view.visible !== false;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = crypto.randomBytes(24).toString('base64');
    let html = fs.readFileSync(path.join(this.context.extensionPath, 'media', 'index.html'), 'utf8');
    const replacements = {
      '{{NONCE}}': nonce,
      '{{CSP}}': view.webview.cspSource,
      '{{STYLE}}': view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'style.css')).toString(),
      '{{SCRIPT}}': view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'view.js')).toString(),
    };
    for (const [key, value] of Object.entries(replacements)) html = html.split(key).join(value);
    view.webview.html = html;
    this.context.subscriptions.push(view.webview.onDidReceiveMessage(message => this.run(message)));
    this.context.subscriptions.push(view.onDidChangeVisibility(() => {
      this.viewVisible = view.visible;
      if (view.visible) {
        this.update();
        this.syncBalance();
        this.startBalancePolling();
        this.syncAccount();
      } else {
        this.stopBalancePolling();
        this.stopAccountPolling();
      }
    }));
    if (typeof view.onDidDispose === 'function') {
      this.context.subscriptions.push(view.onDidDispose(() => {
        this.viewVisible = false;
        this.stopBalancePolling();
        this.stopAccountPolling();
      }));
    }
    this.context.subscriptions.push({ dispose: () => this.stopBalancePolling() });
    this.context.subscriptions.push({ dispose: () => this.stopAccountPolling() });
  }

  stopAccountPolling() {
    clearInterval(this.accountTimer);
    this.accountTimer = null;
    this.accountAbort?.abort();
  }

  syncAccount() {
    if (!this.viewVisible) return Promise.resolve();
    if (!this.accountTimer) this.accountTimer = setInterval(() => this.syncAccount(), 60_000);
    if (this.accountRequest) return this.accountRequest;
    this.accountAbort = new AbortController();
    this.accountRequest = (async () => {
      try {
        const account = await codexAccount.readAccount(codexAccount.executable(vscode), { signal: this.accountAbort.signal });
        this.chatgpt = { ...account, loading: false, stale: false };
      } catch {
        this.chatgpt = { ...this.chatgpt, loading: false, stale: true };
      }
      if (this.viewVisible) await this.view?.webview.postMessage({ type: 'chatgpt', account: this.chatgpt });
    })().finally(() => { this.accountRequest = null; });
    return this.accountRequest;
  }

  async update(keyChecking = this.keyChecking) {
    if (!this.view) return;
    try {
      const state = await backend({ action: 'status' });
      this.activeProvider = state.provider;
      this.hasKey = Boolean(state.hasKey);
      if (!this.hasKey) {
        this.hasValidKey = false;
        keyChecking = false;
      }
      this.keyChecking = Boolean(this.hasKey && keyChecking);
      const webviewState = {
        ...state,
        hasValidKey: this.hasKey && this.hasValidKey,
        keyChecking: this.keyChecking,
        providers: PROVIDERS,
        providerLayout: this.providerLayout(state.provider),
        providerLayoutRevision: this.layoutRevision,
        balanceAlert: { ...this.balanceAlert },
        chatgpt: this.chatgpt,
      };
      await this.view.webview.postMessage({ type: 'state', state: webviewState, busy: this.busy });
      if (this.viewVisible && this.hasValidKey) this.startBalancePolling();
      else this.stopBalancePolling();
    } catch (error) {
      await vscode.window.showErrorMessage(error.message);
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
        await this.context.globalState.update(PROVIDER_LAYOUT_KEY, layout);
        await this.view?.webview.postMessage({
          type: 'providerLayout',
          layout,
          revision: nextRevision,
        });
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

  startBalancePolling() {
    if (!this.viewVisible || !this.hasValidKey || this.balanceTimer) return;
    this.balanceTimer = setInterval(() => this.syncBalance(), BALANCE_POLL_MS);
  }

  stopBalancePolling() {
    if (!this.balanceTimer) return;
    clearInterval(this.balanceTimer);
    this.balanceTimer = null;
  }

  async setBalanceAlert(value) {
    const threshold = value === null || value === undefined || value === '' ? 0 : Number(value);
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new Error('Balance alert must be a non-negative dollar amount.');
    }
    this.balanceAlert = { threshold, level: 'ok' };
    await this.context.globalState.update(BALANCE_ALERT_KEY, this.balanceAlert);
    await this.view?.webview.postMessage({ type: 'balanceAlert', balanceAlert: { ...this.balanceAlert } });
    await this.syncBalance(true);
  }

  async syncBalance(manual = false) {
    if (!this.view || !this.viewVisible || !this.hasValidKey) {
      if (manual) await this.view?.webview.postMessage({ type: 'balanceError', message: 'Balance unavailable.' });
      return;
    }
    if (this.balanceRequest) return this.balanceRequest;
    this.balanceRequest = backend({ action: 'balance' })
      .then(async balance => {
        const total = Number.isFinite(balance.total) ? balance.total : null;
        const level = total !== null && total <= 0
          ? 'zero'
          : total !== null && this.balanceAlert.threshold !== null && total < this.balanceAlert.threshold
            ? 'low'
            : 'ok';
        const previous = this.balanceAlert.level;
        this.balanceAlert.level = level;
        await this.context.globalState.update(BALANCE_ALERT_KEY, { ...this.balanceAlert });
        await this.view?.webview.postMessage({
          type: 'balance',
          balance,
          balanceAlert: { ...this.balanceAlert },
        });
        if (this.viewVisible && level === 'zero' && previous !== 'zero') {
          void vscode.window.showWarningMessage('DeepSeek credits are exhausted.');
        } else if (this.viewVisible && level === 'low' && previous !== 'low') {
          void vscode.window.showWarningMessage(`DeepSeek balance is low: $${total.toFixed(2)} remaining.`);
        }
      })
      .catch(async error => {
        if (manual && this.viewVisible) {
          await this.view?.webview.postMessage({ type: 'balanceError', message: error.message });
        }
      })
      .finally(() => {
        this.balanceRequest = null;
      });
    return this.balanceRequest;
  }

  async promptForApiKey() {
    const key = await vscode.window.showInputBox({
      title: 'DeepSeek API key',
      prompt: 'The key is encrypted for your Windows user and is not shown in the sidebar.',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'sk-...',
      validateInput: value => /^sk-[A-Za-z0-9_-]{12,}$/.test(value.trim())
        ? undefined
        : 'Enter a valid API key that starts with sk-.',
    });
    if (key === undefined) return false;
    const value = key.trim();
    if (!/^sk-[A-Za-z0-9_-]{12,}$/.test(value)) {
      throw new Error('The API key must start with sk- and contain no spaces.');
    }
    await backend({ action: 'saveKey', key: value });
    return true;
  }

  async validateApiKey() {
    this.keyChecking = true;
    await this.update(true);
    try {
      await backend({ action: 'verify' });
      this.hasValidKey = true;
    } finally {
      this.keyChecking = false;
      await this.update(false);
    }
  }

  async ready() {
    const accountRequest = this.syncAccount();
    await this.update(true);
    if (this.viewVisible && this.hasKey && !this.hasValidKey) {
      try {
        await this.validateApiKey();
      } catch {
        // A saved key is disclosed in the UI only after a successful validation.
      }
    }
    if (this.viewVisible && this.hasValidKey) await this.syncBalance();
    await accountRequest;
  }

  async run(message) {
    if (!message || typeof message.action !== 'string') return;
    if (message.action === 'ready') return this.ready();
    if (message.action === 'saveProviderLayout') return this.saveProviderLayout(message.layout, message.revision);
    if (message.action === 'syncBalance') {
      await this.view?.webview.postMessage({ type: 'balanceLoading', loading: true });
      try {
        await this.syncBalance(true);
      } finally {
        await this.view?.webview.postMessage({ type: 'balanceLoading', loading: false });
      }
      return;
    }
    if (message.action === 'saveBalanceAlert') {
      try {
        await this.setBalanceAlert(message.threshold);
      } catch (error) {
        await this.view?.webview.postMessage({ type: 'balanceError', message: error.message });
      }
      return;
    }
    if (!['saveKey', 'verify', 'refresh', 'apply'].includes(message.action) || this.busy) return;

    this.busy = true;
    await this.view?.webview.postMessage({ type: 'busy', busy: true });
    try {
      if (message.action === 'saveKey') {
        const saved = await this.promptForApiKey();
        if (saved) {
          this.hasValidKey = false;
          await this.update(true);
          await this.validateApiKey();
        }
      } else if (message.action === 'verify') {
        await this.validateApiKey();
        await this.view?.webview.postMessage({
          type: 'actionResult',
          action: message.action,
          ok: true,
          message: 'Connection successful.',
        });
      } else if (message.action === 'refresh') {
        await backend({ action: 'refresh' });
        await this.view?.webview.postMessage({
          type: 'actionResult',
          action: message.action,
          ok: true,
          message: 'Model catalog updated.',
        });
      } else if (message.action === 'apply') {
        if (!['openai', 'deepseek'].includes(message.provider)) throw new Error('Unsupported provider.');
        if (message.provider === 'deepseek' && !this.hasValidKey) {
          throw new Error('Validate the DeepSeek API key before switching providers.');
        }
        await backend({ action: 'apply', provider: message.provider });
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    } catch (error) {
      if (['saveKey', 'verify', 'refresh'].includes(message.action)) {
        await this.view?.webview.postMessage({
          type: 'actionResult',
          action: message.action === 'saveKey' ? 'verify' : message.action,
          ok: false,
          message: error.message,
        });
      } else {
        void vscode.window.showErrorMessage(error.message);
      }
    } finally {
      this.busy = false;
      await this.update();
      if (['saveKey', 'verify'].includes(message.action) && this.hasValidKey) await this.syncBalance();
    }
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
