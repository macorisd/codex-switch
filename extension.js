'use strict';
const vscode = require('vscode');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');

const root = path.join(os.homedir(), '.codex', 'provider-switcher');
const python = 'python';

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
      await this.view.webview.postMessage({ type: 'state', state, busy: this.busy });
    } catch (error) {
      await vscode.window.showErrorMessage(error.message);
    }
  }

  async saveIncomingKey(message) {
    const key = typeof message.key === 'string' ? message.key.trim() : '';
    if (!key) return;
    if (!/^sk-[A-Za-z0-9_-]{12,}$/.test(key)) {
      throw new Error('The API key must start with sk- and contain no spaces.');
    }
    await backend({ action: 'saveKey', key });
    await this.view?.webview.postMessage({ type: 'keySaved' });
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
    if (!['saveKey', 'verify', 'refresh', 'apply'].includes(message.action) || this.busy) return;

    this.busy = true;
    await this.view?.webview.postMessage({ type: 'busy', busy: true });
    try {
      await this.saveIncomingKey(message);
      if (message.action === 'verify') {
        await backend({ action: 'verify' });
      } else if (message.action === 'refresh') {
        await backend({ action: 'refresh' });
      } else if (message.action === 'apply') {
        if (!['openai', 'deepseek'].includes(message.provider)) throw new Error('Unsupported provider.');
        await backend({ action: 'apply', provider: message.provider });
        this.promptForReload(message.provider);
      }
      if (message.action !== 'saveKey') {
        await this.view?.webview.postMessage({ type: 'actionSuccess', action: message.action });
      }
    } catch (error) {
      await vscode.window.showErrorMessage(error.message);
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
