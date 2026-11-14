'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const process = require('node:process');
const codexAccount = require('./codex-account');

function windowIdentity(vscode, context) {
  // Desktop logUri identifies the workbench window; the exthost suffix can
  // rotate on reload, unlike the window container. env.sessionId also rotates.
  const logWindow = context.logUri?.toString().match(/^(.*\/window\d+)(?:\/|$)/)?.[1];
  return logWindow || `session:${vscode.env.sessionId}`;
}

function identity(vscode, context) {
  // Prefer the workspace file even for a single-folder saved workspace.
  const workspace = vscode.workspace.workspaceFile;
  const folder = vscode.workspace.workspaceFolders?.[0];
  let key = workspace?.toString() || (folder && vscode.workspace.workspaceFolders.length === 1 ? folder.uri.toString() : null);
  if (!key) key = `empty:${windowIdentity(vscode, context)}`;
  if (process.platform === 'win32' && key.startsWith('file:')) key = key.toLowerCase();
  return crypto.createHash('sha256').update(key).digest('hex');
}

class WorkspaceRuntime {
  constructor(vscode, context, request, root) {
    Object.assign(this, { vscode, context, root });
    this.workspace = identity(vscode, context);
    this.window = crypto.randomBytes(16).toString('hex');
    this.pendingKey = `newChat:${crypto.createHash('sha256').update(windowIdentity(vscode, context)).digest('hex')}`;
    this.request = (value, signal) => request({ ...value, workspace: this.workspace, window: this.window }, signal);
    // This synchronous binding precedes every await and official Codex startup.
    // If startup raced activation, no receipt exists and the UI stays unconfirmed.
    this.binding = path.join(root, 'windows', this.window, 'binding.json');
    process.env.CODEX_SWITCH_BINDING = this.binding;
  }
  async initialize(resetCommand = false) {
    try {
      const config = this.vscode.workspace.getConfiguration('chatgpt');
      const installed = await this.request({ action: 'prepareWindow', command: codexAccount.executable(this.vscode),
        configuredCommand: resetCommand ? null : config.get('cliExecutable'), resetCommand, ownerPid: process.pid,
        cwd: this.vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === 'file')?.uri.fsPath || os.homedir() });
      if (installed.binding !== this.binding) throw new Error('Window binding mismatch');
      if (config.get('cliExecutable') !== installed.launcher) {
        await config.update('cliExecutable', installed.launcher, this.vscode.ConfigurationTarget.Global);
      }
      this.error = false;
    } catch { this.error = true; }
  }
  async status() {
    await this.prepared;
    if (this.error) {
      let saved = {};
      try { saved = await this.request({ action: 'windowStatus' }); } catch {}
      return { ...saved, provider: null, model: '', verified: false, reloadRequired: true, phase: 'setup-error' };
    }
    return this.request({ action: 'windowStatus' });
  }
  async reload(newChat = true) {
    if (newChat) await this.context.workspaceState.update(this.pendingKey, true);
    await this.vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
  async openPendingChat() {
    await this.prepared;
    if (this.error || !this.context.workspaceState.get(this.pendingKey)) return;
    try {
      // Activation is awaited by executeCommand. Never send a message/inference.
      await this.vscode.commands.executeCommand('chatgpt.newChat');
      await this.context.workspaceState.update(this.pendingKey, undefined);
    } catch { /* Retain the request for recovery; do not claim a new chat opened. */ }
  }
  async repair() {
    await this.prepared;
    this.prepared = this.initialize(true);
    await this.prepared;
    if (!this.error) await this.reload();
  }
}

module.exports = { WorkspaceRuntime, identity, windowIdentity };
