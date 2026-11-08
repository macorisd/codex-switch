'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const extensionRoot = path.dirname(__dirname);
function harness() {
  const calls = [];
  const messages = [];
  const commands = new Map();
  const errors = [];
  const infos = [];
  const context = { extensionPath: extensionRoot, extensionUri: extensionRoot, subscriptions: [] };
  let provider;
  let receive;
  const disposable = { dispose() {} };
  const state = {
    provider: 'openai',
    model: 'gpt-6.1-sol',
    hasKey: true,
    models: [{ id: 'deepseek-flash', name: 'DeepSeek-Flash' }],
  };
  const vscode = {
    Uri: { joinPath: (base, ...parts) => path.join(base, ...parts) },
    RelativePattern: class {},
    window: {
      registerWebviewViewProvider: (id, value) => {
        provider = value;
        return disposable;
      },
      registerUriHandler: () => disposable,
      showErrorMessage: async message => {
        errors.push(message);
      },
      showInformationMessage: async (...args) => {
        infos.push(args);
      },
    },
    workspace: {
      createFileSystemWatcher: () => ({
        dispose() {},
        onDidChange: () => disposable,
        onDidCreate: () => disposable,
      }),
    },
    commands: {
      registerCommand: (id, handler) => {
        commands.set(id, handler);
        return disposable;
      },
      executeCommand: async id => calls.push(id),
    },
  };
  const spawn = (exe, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = { resume() {} };
    child.stdin = {
      on() {},
      end(text) {
        const request = JSON.parse(text);
        calls.push(request);
        queueMicrotask(() => {
          child.stdout.emit('data', JSON.stringify({ ok: true, data: state }));
          child.emit('close', 0);
        });
      },
    };
    child.kill = () => {};
    return child;
  };
  const sandbox = {
    module: { exports: {} },
    __dirname: extensionRoot,
    setTimeout,
    clearTimeout,
    require: name => {
      if (name === 'vscode') return vscode;
      if (name === 'node:child_process') return { spawn };
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(extensionRoot, 'extension.js'), 'utf8'), sandbox);
  sandbox.module.exports.activate(context);
  const view = {
    visible: true,
    onDidChangeVisibility: () => disposable,
    webview: {
      cspSource: 'vscode-webview:',
      asWebviewUri: value => value,
      onDidReceiveMessage: fn => {
        receive = fn;
        return disposable;
      },
      postMessage: async value => messages.push(value),
    },
  };
  provider.resolveWebviewView(view);
  return {
    calls,
    messages,
    commands,
    errors,
    infos,
    view,
    receive: message => receive(message),
  };
}

test('sidebar boots with the requested English provider interface', async () => {
  const h = harness();
  assert(h.commands.has('codexSwitch.open'));
  assert.match(h.view.webview.html, /default-src 'none'/);
  assert.doesNotMatch(h.view.webview.html, /\{\{NONCE\}\}|unsafe-inline/);
  for (const text of [
    '<title>Codex Switch</title>',
    'Current Configuration',
    'Provider',
    'ChatGPT',
    'Your Plan',
    'DeepSeek',
    'API key',
    'Update model catalog',
    'Check connection',
    'Switch to ChatGPT',
    'Switch to DeepSeek',
    'type="password"',
  ]) {
    assert.equal(h.view.webview.html.includes(text), true, text);
  }
  assert.doesNotMatch(h.view.webview.html, /<footer|<select|reasoning|notice|intro/i);
  await h.receive({ action: 'ready' });
  assert.equal(h.messages.at(-1).state.hasKey, true);
  assert.equal(h.messages.at(-1).state.key, undefined);
});

test('the sidebar sends a masked API key once without returning it in state', async () => {
  const h = harness();
  const key = 'sk-example_1234567890';
  await h.receive({ action: 'saveKey', key });
  assert(h.calls.some(call => call.action === 'saveKey' && call.key === key));
  assert(h.messages.some(message => message.type === 'keySaved'));
  assert.equal(h.messages.at(-1).state.key, undefined);
});

test('untrusted webview messages cannot invoke arbitrary backend actions', async () => {
  const h = harness();
  await h.receive({ action: 'token' });
  await h.receive({ action: 'apply', provider: 'arbitrary' });
  assert.equal(h.calls.some(call => call.action === 'token' || call.action === 'apply'), false);
  assert.equal(h.errors.length, 1);
});

test('switching sends only the provider and offers an explicit reload', async () => {
  const h = harness();
  await h.receive({ action: 'apply', provider: 'deepseek' });
  const apply = h.calls.find(call => call.action === 'apply');
  assert.equal(apply.provider, 'deepseek');
  assert.equal('model' in apply, false);
  assert.equal('effort' in apply, false);
  assert.match(h.infos.at(-1)[0], /Switched to DeepSeek/);
  assert.equal(h.calls.includes('workbench.action.reloadWindow'), false);
});
