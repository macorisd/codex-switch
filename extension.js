'use strict';
const vscode = require('vscode');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');

const root = path.join(os.homedir(), '.codex', 'provider-switcher');
const python = 'python';
const PROVIDERS = Object.freeze([
  Object.freeze({ id: 'openai', name: 'ChatGPT', subtitle: 'Your Plan' }),
  Object.freeze({ id: 'deepseek', name: 'DeepSeek', subtitle: 'API key' }),
]);
const PROVIDER_LAYOUT_KEY = 'providerLayout';

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
  }

  resolveWebviewView(view) {
    this.view = view;
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
      if (view.visible) this.update();
    }));
  }

  async update() {
    if (!this.view) return;
    try {
      const state = await backend({ action: 'status' });
      const webviewState = {
        ...state,
        providers: PROVIDERS,
        providerLayout: this.providerLayout(),
        providerLayoutRevision: this.layoutRevision,
      };
      await this.view.webview.postMessage({ type: 'state', state: webviewState, busy: this.busy });
    } catch (error) {
      await vscode.window.showErrorMessage(error.message);
    }
  }

  providerLayout() {
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
    const nextRevision = Number.isInteger(revision) ? revision : this.layoutRevision + 1;
    this.layoutUpdate = this.layoutUpdate.catch(() => {}).then(async () => {
      if (nextRevision < this.layoutRevision) return;
      this.layoutRevision = nextRevision;
      await this.context.globalState.update(PROVIDER_LAYOUT_KEY, layout);
      await this.update();
    });
    return this.layoutUpdate;
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

  promptForReload(provider) {
    const name = provider === 'deepseek' ? 'DeepSeek' : 'ChatGPT';
    vscode.window.showInformationMessage(
      `Switched to ${name}. Reload VS Code to use it.`,
      'Reload',
    ).then(choice => {
      if (choice === 'Reload') return vscode.commands.executeCommand('workbench.action.reloadWindow');
    });
  }

  async run(message) {
    if (!message || typeof message.action !== 'string') return;
    if (message.action === 'ready') return this.update();
    if (message.action === 'saveProviderLayout') return this.saveProviderLayout(message.layout, message.revision);
    if (!['saveKey', 'verify', 'refresh', 'apply'].includes(message.action) || this.busy) return;

    this.busy = true;
    await this.view?.webview.postMessage({ type: 'busy', busy: true });
    try {
      if (message.action === 'saveKey') {
        await this.promptForApiKey();
      } else if (message.action === 'verify') {
        await backend({ action: 'verify' });
        await this.view?.webview.postMessage({
          type: 'actionResult',
          ok: true,
          message: 'Connection successful.',
        });
      } else if (message.action === 'refresh') {
        await backend({ action: 'refresh' });
        await this.view?.webview.postMessage({
          type: 'actionResult',
          ok: true,
          message: 'Model catalog updated.',
        });
      } else if (message.action === 'apply') {
        if (!['openai', 'deepseek'].includes(message.provider)) throw new Error('Unsupported provider.');
        await backend({ action: 'apply', provider: message.provider });
        this.promptForReload(message.provider);
      }
    } catch (error) {
      if (['verify', 'refresh'].includes(message.action)) {
        await this.view?.webview.postMessage({
          type: 'actionResult',
          ok: false,
          message: error.message,
        });
      } else {
        await vscode.window.showErrorMessage(error.message);
      }
    } finally {
      this.busy = false;
      await this.update();
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
