'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const recovery = require('../recovery');
const { WorkspaceRuntime, identity } = require('../workspace-runtime');
test.beforeEach(t => t.mock.method(require('../codex-spawn'), 'install', () => ({ dispose() {} })));

function harness({ file, folders = ['file:///project-a'], session = 'window-a', custom, fail = false, logUri, lifecycleRoot, remoteName } = {}) {
  const calls = [], commands = [], values = new Map();
  let executable = custom;
  const uri = text => ({ toString: () => text, scheme: 'file', fsPath: text.slice(7) });
  const vscode = {
    env: { sessionId: session, remoteName }, ConfigurationTarget: { Global: 1 },
    extensions: { getExtension: () => null },
    workspace: { workspaceFile: file ? uri(file) : undefined,
      workspaceFolders: folders.map(text => ({ uri: uri(text) })),
      getConfiguration: section => { assert.equal(section, 'chatgpt'); return {
        get: () => executable, inspect: () => ({ globalValue: executable }), update: async (key, value, target) => {
          assert.equal(key, 'cliExecutable'); assert.equal(target, 1); executable = value;
        },
      }; },
    },
    commands: { executeCommand: async command => commands.push(command) },
  };
  const context = { logUri: logUri ? uri(logUri) : undefined,
    workspaceState: { get: key => values.get(key), update: async (key, value) => values.set(key, value) } };
  if (lifecycleRoot) {
    context.extensionPath = __dirname;
    context.globalStorageUri = { fsPath: path.join(lifecycleRoot, 'User/globalStorage/codex-switch') };
  }
  let runtime;
  const request = async value => {
    calls.push(value);
    if (fail) throw new Error('private backend failure');
    if (value.action === 'prepareWindow') {
      const launcher = lifecycleRoot ? path.join(lifecycleRoot, 'codex-window') : path.join('/runtime', 'launcher');
      if (lifecycleRoot) {
        recovery.atomic(path.join(lifecycleRoot, 'recovery.json'), { ...recovery.read(path.join(lifecycleRoot, 'recovery.json')), launcher });
        recovery.atomic(runtime.owner, { ...recovery.read(runtime.owner), state: 'ready' });
      }
      return { launcher, binding: runtime.binding };
    }
    return { provider: 'deepseek', verified: true, reloadRequired: false };
  };
  runtime = new WorkspaceRuntime(vscode, context, request, lifecycleRoot || '/runtime');
  return { runtime, context, vscode, values, calls, commands, executable: () => executable };
}

test('workspace file identity is stable across folder order and independent of active editor/window', () => {
  const a = harness({ file: 'file:///team.code-workspace', folders: ['file:///a', 'file:///b'] });
  const b = harness({ file: 'file:///team.code-workspace', folders: ['file:///b', 'file:///a'], session: 'window-b' });
  const c = harness({ folders: ['file:///a'] });
  assert.equal(a.runtime.workspace, b.runtime.workspace);
  assert.notEqual(a.runtime.window, b.runtime.window);
  assert.notEqual(a.runtime.workspace, c.runtime.workspace);
  assert.notEqual(c.runtime.workspace, harness({ folders: ['file:///b'] }).runtime.workspace);
  assert.equal(c.runtime.workspace, harness({ folders: ['file:///a'], session: 'different' }).runtime.workspace);
});

test('empty windows have independent identities and bind synchronously before preparation', () => {
  const a = harness({ folders: [], session: 'empty-a' });
  assert.equal(process.env.CODEX_SWITCH_BINDING, a.runtime.binding);
  const b = harness({ folders: [], session: 'empty-b' });
  assert.notEqual(a.runtime.workspace, b.runtime.workspace);
  assert.equal(identity(a.vscode, a.context), a.runtime.workspace);
});

test('every backend request carries the same window/workspace, preserving custom CLI and original home', async () => {
  const original = process.env.CODEX_HOME;
  const h = harness({ custom: '/my/custom codex' });
  h.runtime.prepared = h.runtime.initialize();
  await h.runtime.prepared;
  await h.runtime.request({ action: 'api', provider: 'deepseek', operation: 'select' });
  await h.runtime.status();
  assert.equal(h.calls[0].configuredCommand, '/my/custom codex');
  assert.equal(h.executable(), '/my/custom codex');
  for (const call of h.calls) {
    assert.equal(call.workspace, h.runtime.workspace);
    assert.equal(call.window, h.runtime.window);
  }
  assert.equal(process.env.CODEX_HOME, original);
});

test('setup failure cannot fall back to a false active provider', async () => {
  const h = harness({ fail: true });
  h.runtime.prepared = h.runtime.initialize();
  const state = await h.runtime.status();
  assert.equal(state.provider, null); assert.equal(state.verified, false);
  assert.equal(state.phase, 'setup-error'); assert.equal(h.executable(), undefined);
});

test('switch records a new-chat request before reloading only its window; reopening consumes it once', async () => {
  const h = harness();
  await h.runtime.reload();
  assert.equal(h.values.get(h.runtime.pendingKey), true);
  assert.deepEqual(h.commands, ['workbench.action.reloadWindow']);
  h.runtime.prepared = h.runtime.initialize();
  await h.runtime.openPendingChat(); await h.runtime.openPendingChat();
  assert.deepEqual(h.commands, ['workbench.action.reloadWindow', 'chatgpt.newChat']);
  assert.equal(h.calls.filter(call => call.action === 'apply').length, 0);
});

test('reloading rotates the extension session but retains only the owning workbench window request', () => {
  const first = harness({ session: 'old-session', logUri: 'file:///logs/run/window2/exthost/extension' });
  const reloaded = harness({ session: 'new-session', logUri: 'file:///logs/run/window2/exthost1/extension' });
  const other = harness({ session: 'other-session', logUri: 'file:///logs/run/window3/exthost/extension' });
  assert.equal(first.runtime.pendingKey, reloaded.runtime.pendingKey);
  assert.notEqual(first.runtime.pendingKey, other.runtime.pendingKey);
});

test('activation and shutdown preserve custom application CLI across other owning windows', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex lifecycle '));
  const root = path.join(directory, 'provider-switcher');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.mock.method(recovery, 'register', () => {});
  const h = harness({ custom: '/original custom codex', lifecycleRoot: root });
  assert.equal(recovery.read(h.runtime.owner).state, 'preparing');
  h.runtime.prepared = h.runtime.initialize();
  await h.runtime.prepared;
  assert.equal(h.runtime.error, false);
  // Use a real, distinct live PID and its creation identity.
  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true });
  t.after(() => child.kill());
  const otherOwner = path.join(root, 'owners', `${child.pid}.json`);
  recovery.atomic(otherOwner, { pid: child.pid, binding: 'other-window', state: 'ready', ownerStart: recovery.identity(child.pid) });
  await h.runtime.release();
  assert.equal(h.executable(), '/original custom codex');
  fs.rmSync(otherOwner);
  await h.runtime.release();
  assert.equal(h.executable(), '/original custom codex');
});

test('shutdown preserves a newer user CLI choice and failed setup remains explicitly owned', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex lifecycle '));
  const root = path.join(directory, 'provider-switcher');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.mock.method(recovery, 'register', () => {});
  const h = harness({ lifecycleRoot: root });
  h.runtime.prepared = h.runtime.initialize();
  await h.runtime.prepared;
  await h.vscode.workspace.getConfiguration('chatgpt').update('cliExecutable', '/new user choice', 1);
  await h.runtime.release();
  assert.equal(h.executable(), '/new user choice');
  const failed = harness({ lifecycleRoot: root, fail: true });
  failed.runtime.prepared = failed.runtime.initialize();
  await failed.runtime.prepared;
  assert.equal(recovery.read(failed.runtime.owner).state, 'error');
  assert.equal((await failed.runtime.status()).verified, false);
});

test('a canceled shutdown API restores only the still-owned JSONC setting', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex shutdown '));
  const root = path.join(directory, 'provider-switcher');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.mock.method(recovery, 'register', () => {});
  const h = harness({ lifecycleRoot: root });
  h.runtime.prepared = h.runtime.initialize();
  await h.runtime.prepared;
  const record = recovery.read(path.join(root, 'recovery.json'));
  record.settings = recovery.settingsPath(h.context);
  record.hadOriginal = false;
  recovery.atomic(path.join(root, 'recovery.json'), record);
  await h.vscode.workspace.getConfiguration('chatgpt').update('cliExecutable', record.launcher, 1);
  fs.mkdirSync(path.dirname(record.settings), { recursive: true });
  fs.writeFileSync(record.settings, `// Retain comments\n${JSON.stringify({ 'chatgpt.cliExecutable': record.launcher, preserved: 1 })}`);
  const get = h.vscode.workspace.getConfiguration;
  t.mock.method(h.vscode.workspace, 'getConfiguration', section => ({ ...get(section),
    update: async () => { throw Error('Canceled'); } }));
  await h.runtime.release();
  const text = fs.readFileSync(record.settings, 'utf8');
  assert.match(text, /Retain comments/);
  assert.match(text, /preserved/);
  assert.doesNotMatch(text, /cliExecutable/);
});

test('repeated fresh activations with legacy early-start markers never reload the workbench', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex early start '));
  const root = path.join(directory, 'provider-switcher');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.mock.method(recovery, 'register', () => {});
  for (let attempt = 0; attempt < 4; attempt++) {
    const h = harness({ lifecycleRoot: root, folders: [`file:///new-workspace-${attempt}`] });
    recovery.atomic(path.join(root, 'owners', `${process.pid}-bypass.json`), { pid: process.pid });
    h.runtime.prepared = h.runtime.initialize();
    await h.runtime.prepared;
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(h.commands, []);
    assert.equal(h.values.size, 0);
  }
});

test('startup publishes its provisional claim before querying OS process identity', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex initial claim '));
  const root = path.join(directory, 'provider-switcher');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.mock.method(recovery, 'register', () => {});
  t.mock.method(recovery, 'identity', () => { throw Error('Slow OS identity lookup must follow the claim'); });
  const h = harness({ lifecycleRoot: root });
  const owner = recovery.read(h.runtime.owner);
  assert.equal(owner.state, 'preparing');
  assert.equal(owner.ownerStart, null);
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.binding, h.runtime.binding);
});

test('a remote host never replaces the local application selector while local migration restores its saved CLI', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex host migration '));
  const root = path.join(directory, 'provider-switcher');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.mock.method(recovery, 'register', () => {});
  const legacy = path.join(root, 'codex-window-123456789abc.exe');
  recovery.atomic(path.join(root, 'recovery.json'), { launcher: legacy, hadOriginal: true, original: '/original/custom' });
  const remote = harness({ custom: legacy, remoteName: 'ssh-remote', lifecycleRoot: root });
  await remote.runtime.initialize();
  assert.equal(remote.executable(), legacy);
  const local = harness({ custom: legacy, lifecycleRoot: root });
  await local.runtime.initialize();
  assert.equal(local.executable(), '/original/custom');
  assert.equal(local.runtime.error, false);
});
