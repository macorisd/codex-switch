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
  const warnings = [];
  const inputBoxes = [];
  const intervals = [];
  const clearedIntervals = [];
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
      showWarningMessage: async message => {
        warnings.push(message);
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
            let result = state;
            if (request.action === 'balance') {
              const balances = options.balances || [{ available: true, currency: 'USD', total: 12.34, totalText: '12.34' }];
              const index = calls.filter(call => call.action === 'balance').length - 1;
              result = balances[Math.min(index, balances.length - 1)];
            }
            child.stdout.emit('data', JSON.stringify({ ok: true, data: result }));
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
    setInterval: (listener, delay) => {
      const timer = { listener, delay };
      intervals.push(timer);
      return timer;
    },
    clearInterval: timer => clearedIntervals.push(timer),
    require: name => {
      if (name === 'vscode') return vscode;
      if (name === 'node:child_process') return { spawn };
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(extensionRoot, 'extension.js'), 'utf8'), sandbox);
  sandbox.module.exports.activate(context);
  let visibilityListener;
  const view = {
    visible: true,
    onDidChangeVisibility: listener => {
      visibilityListener = listener;
      return disposable;
    },
    onDidDispose: () => disposable,
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
    warnings,
    inputBoxes,
    globalValues,
    intervals,
    clearedIntervals,
    view,
    setVisible: visible => {
      view.visible = visible;
      visibilityListener?.();
    },
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
    'Model catalog',
    'Update model catalog',
    'Check connection',
    'Available balance',
    'Balance alert',
    'Switch to ChatGPT',
    'Switch to DeepSeek',
  ]) {
    assert.equal(h.view.webview.html.includes(text), true, text);
  }
  assert.equal(h.view.webview.html.includes('id="close-manage"'), true);
  assert.doesNotMatch(h.view.webview.html, /<footer|<select|reasoning|type="password"|notice|intro|feedback-icon|Usage dashboard|>Usage</i);
  const detailsStart = h.view.webview.html.indexOf('<details class="model-catalog"');
  const detailsEnd = h.view.webview.html.indexOf('</details>', detailsStart);
  const detailsTag = h.view.webview.html.slice(detailsStart, h.view.webview.html.indexOf('>', detailsStart) + 1);
  assert(detailsStart >= 0 && detailsEnd > detailsStart);
  assert.doesNotMatch(detailsTag, /\sopen(?:\s|=|>)/);
  assert(h.view.webview.html.indexOf('id="models"') > detailsStart);
  assert(h.view.webview.html.indexOf('id="refresh"') > detailsStart);
  assert(h.view.webview.html.indexOf('id="refresh"') < detailsEnd);
  const viewSource = fs.readFileSync(path.join(extensionRoot, 'media', 'view.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(extensionRoot, 'media', 'style.css'), 'utf8');
  assert.equal(viewSource.includes('${info.name} (${info.subtitle})'), true);
  assert.equal(viewSource.includes('checkbox.disabled = locked'), true);
  assert.match(viewSource, /}, 5000\)\);/);
  const catalogStyle = styleSource.match(/\.model-catalog\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(catalogStyle, /border-bottom/);
  assert.doesNotMatch(catalogStyle, /border-top/);
  const usageStyle = styleSource.match(/\.usage\s*\{([^}]+)\}/)?.[1] || '';
  assert.doesNotMatch(usageStyle, /border-top/);
  assert.match(styleSource, /html, body\s*\{[^}]*overflow: hidden/s);
  assert.match(styleSource, /main\s*\{[^}]*overflow-y: auto/s);
  assert.match(styleSource, /\.usage > \.primary\s*\{[^}]*margin-top: 10px/s);
  await h.receive({ action: 'ready' });
  const latest = h.messages.filter(message => message.type === 'state').at(-1).state;
  assert.equal(latest.hasKey, true);
  assert.equal(latest.key, undefined);
  assert.equal(latest.balanceAlert.threshold, 5);
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
  assert.equal(h.messages.filter(message => message.type === 'state').at(-1).state.key, undefined);
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
    revision: 2,
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
  const acknowledgement = h.messages.find(message => message.type === 'providerLayout');
  assert.deepEqual(plain(acknowledgement.layout), expected);
  assert.equal(acknowledgement.revision, 2);
});

test('ready syncs balance once and polls every minute only while visible', async () => {
  const h = harness();
  await h.receive({ action: 'ready' });
  assert.equal(h.calls.filter(call => call.action === 'balance').length, 1);
  assert.equal(h.intervals.length, 1);
  assert.equal(h.intervals[0].delay, 60000);
  h.setVisible(false);
  assert(h.clearedIntervals.includes(h.intervals[0]));
  h.setVisible(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(call => call.action === 'balance').length, 2);
});

test('balance alerts notify only when crossing low and zero states', async () => {
  const h = harness({
    globalValues: { deepseekBalanceAlert: { threshold: 5, level: 'ok' } },
    balances: [
      { available: true, currency: 'USD', total: 4, totalText: '4.00' },
      { available: true, currency: 'USD', total: 3, totalText: '3.00' },
      { available: true, currency: 'USD', total: 0, totalText: '0.00' },
      { available: true, currency: 'USD', total: 0, totalText: '0.00' },
    ],
  });
  await h.receive({ action: 'ready' });
  for (let i = 0; i < 3; i += 1) await h.receive({ action: 'syncBalance' });
  assert.equal(h.warnings.length, 2);
  assert.match(h.warnings[0], /low: \$4\.00/);
  assert.match(h.warnings[1], /exhausted/);
  assert.equal(h.globalValues.get('deepseekBalanceAlert').level, 'zero');
});

test('saving a balance alert persists it and evaluates the next balance sync', async () => {
  const h = harness({
    balances: [
      { available: true, currency: 'USD', total: 10, totalText: '10.00' },
      { available: true, currency: 'USD', total: 2.5, totalText: '2.50' },
    ],
  });
  await h.receive({ action: 'ready' });
  await h.receive({ action: 'saveBalanceAlert', threshold: 3 });
  assert.deepEqual(plain(h.globalValues.get('deepseekBalanceAlert')), {
    threshold: 3,
    level: 'low',
  });
  assert.match(h.warnings.at(-1), /low: \$2\.50/);
});

test('queued provider changes keep the latest checkbox and order state', async () => {
  const h = harness();
  const first = h.receive({
    action: 'saveProviderLayout',
    revision: 1,
    layout: [
      { id: 'deepseek', visible: true },
      { id: 'openai', visible: false },
    ],
  });
  const second = h.receive({
    action: 'saveProviderLayout',
    revision: 2,
    layout: [
      { id: 'openai', visible: true },
      { id: 'deepseek', visible: false },
    ],
  });
  await Promise.all([first, second]);
  const expected = [
    { id: 'openai', visible: true },
    { id: 'deepseek', visible: false },
  ];
  assert.deepEqual(plain(h.globalValues.get('providerLayout')), expected);
  const acknowledgements = h.messages.filter(message => message.type === 'providerLayout');
  assert.deepEqual(plain(acknowledgements.at(-1).layout), expected);
  assert.equal(acknowledgements.at(-1).revision, 2);
});

test('the provider section always keeps the active provider visible', async () => {
  const h = harness({
    globalValues: {
      providerLayout: [
        { id: 'deepseek', visible: true },
        { id: 'openai', visible: false },
      ],
    },
  });
  await h.receive({ action: 'ready' });
  const latest = h.messages.filter(message => message.type === 'state').at(-1).state;
  assert.deepEqual(plain(latest.providerLayout), [
    { id: 'deepseek', visible: true },
    { id: 'openai', visible: true },
  ]);
});

test('catalog and connection actions emit colored feedback results', async () => {
  const h = harness();
  await h.receive({ action: 'refresh' });
  assert.deepEqual(plain(h.messages.find(message => message.type === 'actionResult')), {
    type: 'actionResult',
    action: 'refresh',
    ok: true,
    message: 'Model catalog updated.',
  });
  await h.receive({ action: 'verify' });
  assert.deepEqual(plain(h.messages.filter(message => message.type === 'actionResult').at(-1)), {
    type: 'actionResult',
    action: 'verify',
    ok: true,
    message: 'Connection successful.',
  });
});

test('failed connection checks return red feedback instead of a webview notice', async () => {
  const h = harness({ failActions: ['verify'] });
  await h.receive({ action: 'verify' });
  assert.deepEqual(plain(h.messages.find(message => message.type === 'actionResult')), {
    type: 'actionResult',
    action: 'verify',
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

test('switching sends only the provider and reloads immediately after success', async () => {
  const h = harness();
  await h.receive({ action: 'apply', provider: 'deepseek' });
  const applyIndex = h.calls.findIndex(call => call.action === 'apply');
  const apply = h.calls[applyIndex];
  assert.equal(apply.provider, 'deepseek');
  assert.equal('model' in apply, false);
  assert.equal('effort' in apply, false);
  assert(h.calls.includes('workbench.action.reloadWindow'));
  assert(h.calls.indexOf('workbench.action.reloadWindow') > applyIndex);
  assert.equal(h.infos.length, 0);
});

test('failed provider switching does not reload the window', async () => {
  const h = harness({ failActions: ['apply'] });
  await h.receive({ action: 'apply', provider: 'deepseek' });
  assert.equal(h.errors.length, 1);
  assert.equal(h.calls.includes('workbench.action.reloadWindow'), false);
});
