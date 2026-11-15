'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const process = require('node:process');
const codexAccount = require('./codex-account');
const recovery = require('./recovery');
const spawnBridge = require('./codex-spawn');

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
    this.owner = path.join(root, 'owners', `${process.pid}.json`);
    this.lifecycle = Boolean(context.extensionPath);
    if (this.lifecycle) {
      // Claim startup before Python, account requests or configuration awaits.
      // A failing enabled activation must remain distinguishable from disable.
      recovery.atomic(this.owner, { pid: process.pid, binding: this.binding,
        created: Date.now(), ownerStart: null, state: 'preparing' });
      recovery.register(context.extensionPath, root);
      this.bridge = spawnBridge.install(this.binding, context.extensionPath);
    }
  }
  async initialize(resetCommand = false) {
    try {
      await this.prepare(resetCommand);
    } catch {
      this.error = true;
      if (this.lifecycle) recovery.atomic(this.owner, { ...recovery.read(this.owner), state: 'error' });
    }
  }
  async prepare(resetCommand) {
    const config = this.vscode.workspace.getConfiguration('chatgpt');
    const configured = config.get('cliExecutable');
    const previous = this.lifecycle ? recovery.read(path.join(this.root, 'recovery.json')) : {};
    const installed = await this.request({ action: 'prepareWindow', command: codexAccount.executable(this.vscode),
      configuredCommand: configured, resetCommand, ownerPid: process.pid, node: process.execPath,
      cwd: this.vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === 'file')?.uri.fsPath || os.homedir() });
    if (installed.binding !== this.binding) throw new Error('Window binding mismatch');
    const apply = async () => {
      if (config.get('cliExecutable') !== configured) {
        throw new Error('Codex executable changed during setup');
      }
      if (this.lifecycle) {
        recovery.atomic(path.join(this.root, 'recovery.json'), {
          ...recovery.read(path.join(this.root, 'recovery.json')),
          extensionPath: this.context.extensionPath,
        });
      }
      // Only retire an old selector belonging to this local root. Application
      // settings in a remote window belong to the client, not this filesystem.
      if (this.lifecycle && !this.vscode.env.remoteName && recovery.managed(configured) &&
          path.resolve(path.dirname(configured)) === path.resolve(this.root)) {
        const original = previous.hadOriginal === undefined
          ? recovery.read(path.join(this.root, 'original-cli.json')).command : previous.original;
        await config.update('cliExecutable', previous.hadOriginal === false ? undefined : original,
          this.vscode.ConfigurationTarget.Global);
      }
      this.error = false;
    };
    return this.lifecycle ? recovery.locked(this.root, apply) : apply();
  }
  async release() {
    this.bridge?.dispose();
    if (!this.lifecycle) return;
    await this.prepared;
    await recovery.locked(this.root, async () => {
      recovery.atomic(this.owner, { ...recovery.read(this.owner), state: 'inactive' });
      if (recovery.hasOwners(this.root, this.binding)) return;
      recovery.restoreModels(this.root);
      // An in-flight native write can finish during shutdown. Keep recovery on
      // the next launch until those clients exit, so that write is also retired.
      if (recovery.hasClients(this.root)) return;
      const record = recovery.read(path.join(this.root, 'recovery.json'));
      const config = this.vscode.workspace.getConfiguration('chatgpt');
      if (!this.reloading && !this.vscode.env.remoteName && config.get('cliExecutable') === record.launcher) {
        try {
          await config.update('cliExecutable', record.hadOriginal ? record.original : undefined,
            this.vscode.ConfigurationTarget.Global);
        } catch {
          // Shutdown can close the configuration RPC before deactivate settles.
          // Recheck the actual JSONC file before restoring our exact value.
          recovery.restoreSettings(record);
        }
      }
    });
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
    this.reloading = true;
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
