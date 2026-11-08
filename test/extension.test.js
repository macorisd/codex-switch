'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const extensionRoot = path.dirname(__dirname);
const plain = value => JSON.parse(JSON.stringify(value));
function harness(options = {}) {
  const calls = [];
  const messages = [];
  const commands = new Map();
  const errors = [];
  const infos = [];
  const inputBoxes = [];
  const globalValues = new Map(Object.entries(options.globalValues || {}));
  const context = {
    extensionPath: extensionRoot,
    extensionUri: extensionRoot,
    subscriptions: [],
    globalState: {
      get: (key, fallback) => globalValues.has(key) ? globalValues.get(key) : fallback,
      update: async (key, value) => {
        globalValues.set(key, value);
      },
    },
  };
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
      showInputBox: async values => {
        inputBoxes.push(values);
        return options.inputKey;
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
          if ((options.failActions || []).includes(request.action)) {
            child.stdout.emit('data', JSON.stringify({ ok: false, error: 'Connection failed safely.' }));
          } else {
            child.stdout.emit('data', JSON.stringify({ ok: true, data: state }));
          }
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
    inputBoxes,
    globalValues,
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
    'Manage Providers',
    'ChatGPT',
    'Your Plan',
    'DeepSeek',
    'API key',
    'Set API key',
    'Not configured',
    'Update model catalog',
    'Check connection',
    'Switch to ChatGPT',
    'Switch to DeepSeek',
  ]) {
    assert.equal(h.view.webview.html.includes(text), true, text);
  }
  assert.doesNotMatch(h.view.webview.html, /<footer|<select|reasoning|type="password"|notice|intro/i);
  await h.receive({ action: 'ready' });
  const latest = h.messages.at(-1).state;
  assert.equal(latest.hasKey, true);
  assert.equal(latest.key, undefined);
  assert.deepEqual(plain(latest.providerLayout), [
    { id: 'openai', visible: true },
    { id: 'deepseek', visible: true },
  ]);
});

test('Set API key uses the native password dialog and never returns the key', async () => {
  const key = 'sk-example_1234567890';
  const h = harness({ inputKey: key });
  await h.receive({ action: 'saveKey' });
  assert.equal(h.inputBoxes.length, 1);
  assert.equal(h.inputBoxes[0].password, true);
  assert(h.calls.some(call => call.action === 'saveKey' && call.key === key));
  assert.equal(h.messages.at(-1).state.key, undefined);
});

test('canceling the native API key dialog preserves the stored key', async () => {
  const h = harness();
  await h.receive({ action: 'saveKey' });
  assert.equal(h.inputBoxes.length, 1);
  assert.equal(h.calls.some(call => call.action === 'saveKey'), false);
});

test('provider visibility and order are validated and persisted', async () => {
  const h = harness();
  await h.receive({
    action: 'saveProviderLayout',
    layout: [
      { id: 'deepseek', visible: true },
      { id: 'openai', visible: false },
      { id: 'deepseek', visible: false },
      { id: 'unknown', visible: true },
    ],
  });
  const expected = [
    { id: 'deepseek', visible: true },
    { id: 'openai', visible: false },
  ];
  assert.deepEqual(plain(h.globalValues.get('providerLayout')), expected);
  assert.deepEqual(plain(h.messages.at(-1).state.providerLayout), expected);
});

test('catalog and connection actions emit colored feedback results', async () => {
  const h = harness();
  await h.receive({ action: 'refresh' });
  assert.deepEqual(plain(h.messages.find(message => message.type === 'actionResult')), {
    type: 'actionResult',
    ok: true,
    message: 'Model catalog updated.',
  });
  await h.receive({ action: 'verify' });
  assert.deepEqual(plain(h.messages.filter(message => message.type === 'actionResult').at(-1)), {
    type: 'actionResult',
    ok: true,
    message: 'Connection successful.',
  });
});

test('failed connection checks return red feedback instead of a webview notice', async () => {
  const h = harness({ failActions: ['verify'] });
  await h.receive({ action: 'verify' });
  assert.deepEqual(plain(h.messages.find(message => message.type === 'actionResult')), {
    type: 'actionResult',
    ok: false,
    message: 'Connection failed safely.',
  });
  assert.equal(h.errors.length, 0);
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
