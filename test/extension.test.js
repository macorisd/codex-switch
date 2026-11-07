'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const extensionRoot = path.dirname(__dirname);
function harness() {
  const calls = [], messages = [], commands = new Map();
  const context = { extensionPath: extensionRoot, extensionUri: extensionRoot, subscriptions: [] };
  let provider, receive;
  const disposable = { dispose() {} };
  const state = { provider: 'openai', model: 'gpt-6.1-sol', hasKey: true, models: [] };
  const vscode = {
    Uri: { joinPath: (base, ...parts) => path.join(base, ...parts) },
    RelativePattern: class {},
    window: {
      registerWebviewViewProvider: (id, value) => { provider = value; return disposable; },
      registerUriHandler: () => disposable,
      showInputBox: async () => undefined,
    },
    workspace: { createFileSystemWatcher: () => ({ dispose() {}, onDidChange: () => disposable, onDidCreate: () => disposable }) },
    commands: { registerCommand: (id, handler) => { commands.set(id, handler); return disposable; }, executeCommand: async id => calls.push(id) },
  };
  const spawn = (exe, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = { resume() {} };
    child.stdin = { on() {}, end(text) {
      const request = JSON.parse(text);
      calls.push(request);
      queueMicrotask(() => {
        child.stdout.emit('data', JSON.stringify({ ok: true, data: state }));
        child.emit('close', 0);
      });
    } };
    child.kill = () => {};
    return child;
  };
  const sandbox = { module: { exports: {} }, __dirname: extensionRoot, setTimeout, clearTimeout,
    require: name => name === 'vscode' ? vscode : name === 'node:child_process' ? { spawn } : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(extensionRoot, 'extension.js'), 'utf8'), sandbox);
  sandbox.module.exports.activate(context);
  const view = { visible: true, onDidChangeVisibility: () => disposable,
    webview: { cspSource: 'vscode-webview:', asWebviewUri: value => value,
      onDidReceiveMessage: fn => { receive = fn; return disposable; },
      postMessage: async value => messages.push(value) } };
  provider.resolveWebviewView(view);
  return { calls, messages, commands, view, receive: message => receive(message) };
}

test('sidebar boots, uses a nonce CSP, and never sends a key to the webview', async () => {
  const h = harness();
  assert(h.commands.has('codexSwitch.open'));
  assert.match(h.view.webview.html, /default-src 'none'/);
  assert.doesNotMatch(h.view.webview.html, /\{\{NONCE\}\}|unsafe-inline/);
  await h.receive({ action: 'ready' });
  assert.equal(h.messages.at(-1).state.hasKey, true);
  assert.equal(h.messages.at(-1).state.key, undefined);
});

test('canceling native key entry does not overwrite the stored key', async () => {
  const h = harness();
  await h.receive({ action: 'saveKey' });
  assert.equal(h.calls.some(call => call.action === 'saveKey'), false);
});

test('untrusted webview messages cannot invoke arbitrary backend actions', async () => {
  const h = harness();
  await h.receive({ action: 'token' });
  await h.receive({ action: 'apply', provider: 'arbitrary' });
  assert.equal(h.calls.some(call => call.action === 'token' || call.action === 'apply'), false);
  assert.equal(h.messages.some(message => message.notice?.kind === 'error'), true);
});

test('applying changes exposes an explicit reload action without reloading automatically', async () => {
  const h = harness();
  await h.receive({ action: 'apply', provider: 'deepseek', model: 'deepseek-flash', effort: 'high' });
  assert(h.calls.some(call => call.action === 'apply' && call.model === 'deepseek-flash'));
  assert(h.messages.some(message => message.notice?.reload));
  assert.equal(h.calls.includes('workbench.action.reloadWindow'), false);
  await h.receive({ action: 'reload' });
  assert(h.calls.includes('workbench.action.reloadWindow'));
});
