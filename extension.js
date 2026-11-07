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
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      cwd: os.homedir(),
    });
    let stdout = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('La operación tardó demasiado. Vuelve a intentarlo.')); }, 35000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 100000) child.kill(); });
    // Never log process output or the request: it may contain credentials.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('No se pudo iniciar el conector local de Codex.')); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout);
        if (!result.ok) throw new Error(result.error);
        resolve(result.data);
      } catch (error) {
        reject(new Error(error instanceof SyntaxError ? 'No se pudo leer la configuración local de Codex.' : error.message));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

class Selector {
  constructor(context) { this.context = context; this.busy = false; this.notice = null; }
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
    this.context.subscriptions.push(view.onDidChangeVisibility(() => { if (view.visible) this.update(); }));
  }
  async update() {
    if (!this.view) return;
    try {
      const state = await backend({ action: 'status' });
      await this.view.webview.postMessage({ type: 'state', state, busy: this.busy, notice: this.notice });
    } catch (error) { this.postNotice(error.message, 'error'); }
  }
  postNotice(text, kind = 'success', reload = false) {
    this.notice = { text, kind, reload };
    this.view?.webview.postMessage({ type: 'notice', notice: this.notice });
  }
  async run(message) {
    if (!message || typeof message.action !== 'string') return;
    if (message.action === 'ready') return this.update();
    if (message.action === 'reload') {
      if (this.notice?.reload && !this.busy) await vscode.commands.executeCommand('workbench.action.reloadWindow');
      return;
    }
    if (!['saveKey', 'verify', 'refresh', 'apply'].includes(message.action) || this.busy) return;
    this.busy = true;
    this.view?.webview.postMessage({ type: 'busy', busy: true });
    try {
      if (message.action === 'saveKey') {
        const key = await vscode.window.showInputBox({
          title: 'Clave de DeepSeek', prompt: 'Se guarda cifrada con Windows para tu usuario. No se comparte con el proyecto.',
          password: true, ignoreFocusOut: true, placeHolder: 'sk-…',
          validateInput: value => /^sk-[A-Za-z0-9_-]{12,}$/.test(value.trim()) ? undefined : 'Introduce una API key válida que empiece por sk-.',
        });
        if (key === undefined) return;
        await backend({ action: 'saveKey', key: key.trim() });
        this.postNotice('Clave guardada y cifrada.');
      } else if (message.action === 'verify') {
        const result = await backend({ action: 'verify' });
        this.postNotice(`Conexión correcta · ${result.models.length} modelos disponibles.`);
      } else if (message.action === 'refresh') {
        await backend({ action: 'refresh' });
        this.postNotice('Catálogo oficial actualizado.');
      } else {
        if (!['openai', 'deepseek'].includes(message.provider)) throw new Error('Selecciona un proveedor válido.');
        await backend({ action: 'apply', provider: message.provider, model: message.model, effort: message.effort });
        this.postNotice('Configuración guardada. Recarga VS Code y abre un chat nuevo en Codex.', 'success', true);
      }
    } catch (error) { this.postNotice(error.message, 'error'); }
    finally { this.busy = false; await this.update(); }
  }
}

function activate(context) {
  const selector = new Selector(context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('codexSwitch.selector', selector));
  context.subscriptions.push(vscode.commands.registerCommand('codexSwitch.open', () => vscode.commands.executeCommand('codexSwitch.selector.focus')));
  context.subscriptions.push(vscode.commands.registerCommand('codexSwitch.refresh', () => selector.run({ action: 'refresh' })));
  context.subscriptions.push(vscode.commands.registerCommand('codexSwitch.key', () => selector.run({ action: 'saveKey' })));
  context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: () => vscode.commands.executeCommand('codexSwitch.selector.focus') }));
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(root), 'config.toml'));
  let pending;
  const refresh = () => { clearTimeout(pending); pending = setTimeout(() => selector.update(), 200); };
  context.subscriptions.push(watcher, watcher.onDidChange(refresh), watcher.onDidCreate(refresh), { dispose: () => clearTimeout(pending) });
}

module.exports = { activate, deactivate() {} };
