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
  const accountCalls = [];
  const pendingBackend = [];
  const backendSignals = [];
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
    provider: options.provider || 'openai',
    model: 'gpt-6.1-sol',
    hasKey: options.hasKey !== false,
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
      showErrorMessage: message => {
        errors.push(message);
        return options.hangErrors ? new Promise(() => {}) : Promise.resolve();
      },
      showInformationMessage: async (...args) => {
        infos.push(args);
      },
      showWarningMessage: message => {
        warnings.push(message);
        return options.hangWarnings ? new Promise(() => {}) : Promise.resolve();
      },
      showInputBox: async values => {
        inputBoxes.push(values);
        return values.password ? options.inputKey : values.value;
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
  const spawn = (exe, args, spawnOptions) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = { resume() {} };
    child.stdin = {
      on() {},
      end(text) {
        const request = JSON.parse(text);
        backendSignals.push({ action: request.operation || request.action, provider: request.provider, signal: spawnOptions?.signal });
        calls.push(request);
        const operation = request.operation || request.action;
        if (operation === 'saveKey' && options.inputKey) state.hasKey = true;
        const respond = () => {
          if ((options.failActions || []).includes(operation)) {
            child.stdout.emit('data', JSON.stringify({ ok: false, error: 'Connection failed safely.' }));
          } else {
            let result = request.action === 'api' ? { ...state, valid: true, model: 'model-a', models: [{id:'model-a',name:'A',efforts:['high']}] } : state;
            if (operation === 'balance') {
              const balances = options.balances || [{ available: true, currency: 'USD', total: 12.34, totalText: '12.34' }];
              const index = calls.filter(call => (call.operation || call.action) === 'balance').length - 1;
              result = balances[Math.min(index, balances.length - 1)];
            }
            child.stdout.emit('data', JSON.stringify({ ok: true, data: result }));
          }
          child.emit('close', 0);
        };
        if ((options.hangActions || []).includes(operation)) pendingBackend.push({ action: operation, provider: request.provider, respond });
        else queueMicrotask(respond);
      },
    };
    child.kill = () => {};
    spawnOptions?.signal?.addEventListener('abort', () => child.emit('error', new Error('Aborted')));
    return child;
  };
  const sandbox = {
    module: { exports: {} },
    __dirname: extensionRoot,
    setTimeout,
    clearTimeout,
    AbortController,
    setInterval: (listener, delay) => {
      const timer = { listener, delay };
      intervals.push(timer);
      return timer;
    },
    clearInterval: timer => clearedIntervals.push(timer),
    require: name => {
      if (name === 'vscode') return vscode;
      if (name === './codex-account') return {
        executable: () => 'codex.exe',
        readAccount: async (exe, values) => {
          accountCalls.push(values);
          if (options.accountRead) return options.accountRead(values);
          if (options.accountError) throw new Error('Private upstream error');
          return options.account || { configured: false, usageAvailable: false };
        },
      };
      if (name === 'node:child_process') return { spawn };
      if (name.startsWith('./')) return require(path.join(extensionRoot, name));
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
      postMessage: async value => {
        const data=plain(value); messages.push(data); options.onPost?.(data);
      },
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
    accountCalls,
    pendingBackend,
    backendSignals,
    backendState: state,
    view,
    setVisible: visible => {
      view.visible = visible;
      visibilityListener?.();
    },
    receive: message => receive(message),
  };
}

const definitions = require('../backend/providers.json');
const apiMessage = (provider, operation, extra = {}) => ({ action: 'api', provider, operation, ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
const layout = visible => [{ id: 'openai', visible: true }, ...definitions.map(p => ({ id: p.id, visible: visible.includes(p.id) }))];
const requests = (h, operation, id) => h.calls.filter(c => c.action === 'api' && c.operation === operation && (!id || c.provider === id));

test('secure sidebar boots with nonce-protected scripts and ten declarative providers', async () => {
  const h = harness({ hasKey: false });
  assert(h.commands.has('codexSwitch.open'));
  assert.match(h.view.webview.html, /default-src 'none'/);
  assert.doesNotMatch(h.view.webview.html, /\{\{|unsafe-inline|type="password"/);
  await h.receive({ action: 'ready' });
  assert.equal(h.messages.find(m => m.type === 'state').state.providers.length, 10);
  assert.equal(requests(h, 'status').length, 9);
  assert.equal(requests(h, 'refresh').length, 0);
});

test('each provider uses a native password dialog, validates, and keeps secrets out of messages', async () => {
  for (const p of definitions) {
    const h = harness({ inputKey: 'test-private-key', hasKey: false, globalValues: { providerLayout: layout([p.id]) } });
    await h.receive({ action: 'ready' });
    await h.receive(apiMessage(p.id, 'saveKey'));
    assert.equal(h.inputBoxes[0].password, true);
    assert.equal(requests(h, 'saveKey', p.id)[0].key, 'test-private-key');
    assert.equal(requests(h, 'refresh', p.id).length, 1);
    assert(!JSON.stringify(h.messages).includes('test-private-key'));
    assert.equal(h.messages.filter(m => m.type === 'apiState').at(-1).state.valid, true);
    await h.receive(apiMessage(p.id,'endpoint'));
    assert.equal(h.inputBoxes.at(-1).value,p.baseUrl);
    assert.equal(requests(h,'endpoint',p.id).at(-1).url,p.baseUrl);
  }
});

test('cancelled key entry does not overwrite credentials', async () => {
  const h = harness(); await h.receive({ action: 'ready' });
  await h.receive(apiMessage('openrouter', 'saveKey'));
  assert.equal(requests(h, 'saveKey').length, 0);
});

test('invalid keys release controls immediately without blocking on a notification', async () => {
  const h = harness({ inputKey: 'invalid-test-key', failActions: ['refresh'], hangErrors: true });
  await h.receive({ action: 'ready' }); await h.receive(apiMessage('openrouter', 'saveKey'));
  const state = h.messages.filter(m => m.type === 'apiState' && m.provider === 'openrouter').at(-1).state;
  assert.equal(state.valid, false); assert.equal(state.working, false); assert.equal(state.loading, false);
  assert.match(state.error, /Operation failed/);
  assert.equal(h.errors.length, 0);
});

test('hidden providers make no initial, periodic or manual requests until enabled', async () => {
  const h = harness({ globalValues: { providerLayout: layout(['deepseek']) } });
  await h.receive({ action: 'ready' }); await h.receive({ action: 'syncAll' });
  assert(h.calls.filter(c => c.action === 'api').every(c => c.provider === 'deepseek'));
  await h.receive(apiMessage('openrouter', 'saveKey')); assert.equal(h.inputBoxes.length, 0);
  await h.receive({ action: 'saveProviderLayout', layout: layout(['deepseek','openrouter']), revision: 1 });
  await tick(); assert.equal(requests(h, 'refresh', 'openrouter').length, 1);
  const before = h.calls.length;
  h.setVisible(false); for (const timer of h.intervals) await timer.listener();
  await h.receive({ action: 'syncAll' }); assert.equal(h.calls.length, before);
});

test('hiding a provider aborts its pending network request and discards the response', async () => {
  const h = harness({ hangActions: ['balance'], globalValues: { providerLayout: layout(['deepseek']) } });
  const ready = h.receive({ action: 'ready' }); await tick();
  const signal = h.backendSignals.find(c => c.action === 'balance').signal;
  await h.receive({ action: 'saveProviderLayout', layout: layout([]), revision: 1 });
  await ready; assert.equal(signal.aborted, true);
  assert(!h.messages.filter(m => m.type === 'apiState').some(m => m.state.balance?.total === 12.34));
});

test('layout sanitizes unknown IDs, serializes edits and cannot hide the active provider', async () => {
  const h = harness({ provider: 'openrouter' }); await h.receive({ action: 'ready' });
  await Promise.all([
    h.receive({ action: 'saveProviderLayout', layout: [{ id: 'invalid', visible: true }, { id: 'openrouter', visible: false }], revision: 1 }),
    h.receive({ action: 'saveProviderLayout', layout: [{ id: 'xai', visible: false }, { id: 'openrouter', visible: false }], revision: 2 }),
  ]);
  const saved = h.globalValues.get('providerLayout');
  assert.equal(saved[0].id, 'xai'); assert(!saved[0].visible);
  assert(saved.find(p => p.id === 'openrouter').visible); assert(!saved.some(p => p.id === 'invalid'));
});

test('selection persists before switching; successful switch reloads the window', async () => {
  const h = harness(); await h.receive({ action: 'ready' });
  await h.receive(apiMessage('xai','select',{ model:'model-a', effort:'high' }));
  assert.equal(requests(h,'select','xai')[0].effort,'high');
  await h.receive(apiMessage('xai','apply'));
  assert(h.calls.includes('workbench.action.reloadWindow'));
  await h.receive({action:'apply',provider:'openai'});
  assert(h.calls.some(c=>c.action==='apply' && c.provider==='openai'));
});

test('failed switching never reloads and arbitrary webview actions cannot reach the backend', async () => {
  const h = harness({ failActions:['apply'] }); await h.receive({action:'ready'});
  await h.receive(apiMessage('xai','apply'));
  assert(!h.calls.includes('workbench.action.reloadWindow'));
  const before=h.calls.length;
  await h.receive({action:'shell',command:'anything'}); await h.receive(apiMessage('unknown','apply'));
  assert.equal(h.calls.length,before);
});

test('global sync deduplicates clicks and settles after independent failures', async () => {
  const h=harness({accountError:true,failActions:['refresh'],hangErrors:true});
  await h.receive({action:'ready'}); const before=h.accountCalls.length;
  await Promise.all([h.receive({action:'syncAll'}),h.receive({action:'syncAll'})]);
  assert.equal(h.accountCalls.length,before+1);
  assert.deepEqual(h.messages.filter(m=>m.type==='syncLoading').map(m=>m.loading),[true,false]);
  assert.equal(h.messages.filter(m=>m.type==='state').at(-1).busy,false);
});

test('periodic refresh preserves startup and publishes all results only after the last provider settles', async () => {
  let finishAccount;
  let polling = false;
  const h = harness({ globalValues: { providerLayout: layout(['deepseek', 'openrouter']) },
    accountRead: () => polling ? new Promise(resolve => { finishAccount = resolve; })
      : Promise.resolve({ configured: true, plan: 'Plus' }) });
  await h.receive({ action: 'ready' });
  assert(h.messages.some(m => m.type === 'apiState' && m.state.loading), 'initial loading is unchanged');
  assert(!h.messages.some(m => m.type === 'syncLoading'), 'startup does not become a quiet poll');
  assert.equal(h.intervals.length, 1, 'one timer coordinates all visible providers');
  assert.equal(h.intervals[0].delay, 60000);
  polling = true;
  h.backendState.hasKey = false;
  const start = h.messages.length;
  const refresh = h.intervals[0].listener();
  await tick();
  assert.deepEqual(h.messages.slice(start), [{ type: 'syncLoading', loading: true, quiet: true }]);
  const calls = h.calls.length;
  await h.receive(apiMessage('deepseek', 'saveKey'));
  await h.receive({ action: 'apply', provider: 'openai' });
  await h.receive({ action: 'syncAll' });
  await h.intervals[0].listener();
  assert.equal(h.calls.length, calls, 'conflicting actions and duplicate polls cannot run');
  finishAccount({ configured: false });
  await refresh;
  const completed = h.messages.at(-1);
  assert.equal(completed.type, 'syncLoading');
  assert.equal(completed.loading, false);
  assert.equal(h.messages.length - start, 2, 'one start and one completed transaction');
  assert.equal(completed.updates.find(m => m.type === 'chatgpt').account.configured, false);
  const api = completed.updates.filter(m => m.type === 'apiState');
  assert.deepEqual(api.map(m => m.provider).sort(), ['deepseek', 'openrouter']);
  assert(api.every(m => !m.state.loading && !m.state.working && !m.state.valid));
  assert.equal(completed.updates.find(m => m.type === 'state').busy, false);
  assert.equal(requests(h, 'status', 'mimo').length, 0, 'hidden providers remain idle');
  h.setVisible(false);
  const after = h.calls.length;
  await h.intervals[0].listener();
  assert.equal(h.calls.length, after);
  assert(h.clearedIntervals.includes(h.intervals[0]));
});

test('periodic errors release the spinner and publish settled failure states together', async () => {
  const failures = [];
  let failAccount = false;
  const h = harness({ globalValues: { providerLayout: layout(['deepseek']) }, failActions: failures,
    accountRead: async () => { if (failAccount) throw new Error('offline'); return { configured: true, plan: 'Plus' }; } });
  await h.receive({ action: 'ready' });
  failures.push('status'); failAccount = true;
  await h.intervals[0].listener();
  const result = h.messages.at(-1);
  assert.equal(result.loading, false);
  const account = result.updates.find(m => m.type === 'chatgpt').account;
  assert(account.configured && account.stale, 'ChatGPT failure retains its last known account');
  const api = result.updates.find(m => m.type === 'apiState').state;
  assert(!api.valid && !api.loading && !api.working);
  assert.match(api.error, /Operation failed/);
  failures.length = 0; failAccount = false;
  await h.intervals[0].listener();
  assert(h.messages.at(-1).updates.find(m => m.type === 'apiState').state.valid, 'next poll recovers');
});

test('polling skips unfinished startup and keeps spinning until the last API balance completes', async () => {
  const h = harness({globalValues:{providerLayout:layout(['deepseek'])}, hangActions:['balance']});
  const startup = h.receive({action:'ready'});
  await tick();
  const count = h.calls.length;
  await h.intervals[0].listener();
  assert.equal(h.calls.length, count);
  assert(!h.messages.some(m => m.type === 'syncLoading'));
  h.pendingBackend.shift().respond(); await startup;
  const start = h.messages.length;
  const poll = h.intervals[0].listener(); await tick();
  assert.deepEqual(h.messages.slice(start), [{type:'syncLoading', loading:true, quiet:true}]);
  h.pendingBackend.shift().respond(); await poll;
  assert.equal(h.messages.at(-1).loading, false);
  assert.equal(h.messages.at(-1).updates.find(m => m.type === 'apiState').state.balance.total, 12.34);
});

test('providers enabled during a quiet poll join the completed snapshot before the spinner stops', async () => {
  let finishAccount;
  let polling = false;
  const hang = [];
  const h = harness({globalValues:{providerLayout:layout(['deepseek'])}, hangActions:hang,
    accountRead: () => polling ? new Promise(resolve => { finishAccount = resolve; })
      : Promise.resolve({configured:true})});
  await h.receive({action:'ready'});
  polling = true; hang.push('refresh');
  const poll = h.intervals[0].listener(); await tick();
  await h.receive({action:'saveProviderLayout', layout:layout(['deepseek', 'openrouter']), revision:1});
  await tick();
  finishAccount({configured:true}); await tick();
  assert.equal(h.messages.filter(m => m.type === 'syncLoading').at(-1).loading, true);
  assert.equal(h.pendingBackend[0].provider, 'openrouter');
  h.pendingBackend.shift().respond(); await poll;
  const result = h.messages.at(-1);
  assert.equal(result.loading, false);
  const provider = result.updates.find(m => m.type === 'apiState' && m.provider === 'openrouter').state;
  assert(provider.valid && !provider.loading && !provider.working);
});

test('ChatGPT remains independent and global sync waits for its last request', async () => {
  let finish;
  const h=harness({accountRead:()=>new Promise(resolve=>{finish=resolve;})});
  const sync=h.receive({action:'syncAll'}); await tick();
  assert(requests(h,'balance','deepseek').length);
  assert.equal(h.messages.filter(m=>m.type==='syncLoading').at(-1).loading,true);
  finish({configured:true,plan:'Plus'}); await sync;
  assert.equal(h.messages.filter(m=>m.type==='syncLoading').at(-1).loading,false);
});

test('provider alerts are opt-in, silent initially, independent and never block refresh', async () => {
  for (const id of definitions.filter(p => p.usage).map(p => p.id)) {
    const balances = [4, 4, 0, 0, 3, 0, 9, 4, 0].map(total => ({total, currency:'USD'}));
    const h = harness({hangWarnings:true, globalValues:{providerLayout:layout([id]), apiBalanceAlerts:{[id]:{threshold:5}}}, balances});
    await h.receive({action:'ready'});
    assert.equal(h.warnings.length,0, `${id} startup`);
    for (let i=0; i<8; i++) await h.receive({action:'syncAll'});
    assert.equal(h.warnings.length,4, id);
    assert.match(h.warnings[0], /exhausted/);
    assert.match(h.warnings[1], /exhausted/);
    assert.match(h.warnings[2], /is low/);
    const before = h.calls.length;
    await h.receive({action:'saveBalanceAlert',provider:id,threshold:-2});
    assert.equal(h.globalValues.get('apiBalanceAlerts')[id].threshold,0);
    assert.equal(h.calls.length,before, 'changing a threshold needs no request');
    await h.receive({action:'syncAll'});
    assert.equal(h.warnings.length,4, 'disabled zero never warns');
    const next = harness({globalValues:Object.fromEntries(h.globalValues), balances:[{total:0,currency:'USD'}]});
    await next.receive({action:'ready'});
    assert.equal(next.warnings.length,0, 'restart never replays warnings');
  }
});

test('all API providers have independent default-zero preferences and legacy defaults stay disabled', async () => {
  const h = harness({globalValues:{deepseekBalanceAlert:{threshold:5,level:'low'}}});
  await h.receive({action:'ready'});
  const prefs = h.messages.find(m=>m.type==='state').state.balanceAlerts;
  for (const p of definitions) assert.equal(prefs[p.id].threshold,0);
  await h.receive({action:'saveBalanceAlert',provider:'openrouter',threshold:3});
  assert.equal(h.globalValues.get('apiBalanceAlerts').openrouter.threshold,3);
  assert.equal(h.globalValues.get('apiBalanceAlerts').deepseek.threshold,0);
  await h.receive({action:'saveBalanceAlert',provider:'openai',threshold:1});
  await h.receive({action:'saveBalanceAlert',provider:'openrouter',threshold:'invalid'});
  assert.equal(h.globalValues.get('apiBalanceAlerts').openrouter.threshold,3);
  assert.equal(h.warnings.length,0);
});

test('hidden ChatGPT never starts the app server and disabling it aborts pending reads', async()=>{
  const h=harness({provider:'deepseek',globalValues:{providerLayout:[{id:'openai',visible:false},...layout(['deepseek']).slice(1)]}});
  await h.receive({action:'ready'}); assert.equal(h.accountCalls.length,0);
  await h.receive({action:'saveProviderLayout',layout:layout(['deepseek']),revision:1}); await tick();
  assert.equal(h.accountCalls.length,1);
  await h.receive({action:'saveProviderLayout',layout:[{id:'openai',visible:false},...layout(['deepseek']).slice(1)],revision:2});
  assert(h.accountCalls[0].signal.aborted);
});

test('real sidebar and host keep repeated provider toggles hidden across refreshes and reloads', async () => {
  function linked(globalValues={}) {
    let deliver;
    const host=harness({globalValues,onPost:data=>deliver?.(data)});
    const {window,document}=require('linkedom').parseHTML(host.view.webview.html);
    const outgoing=[];
    deliver=data=>{const event=new window.Event('message');event.data=data;window.dispatchEvent(event);};
    const context=vm.createContext({window,document,
      acquireVsCodeApi:()=>({postMessage:m=>outgoing.push(plain(m))}),
      setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
    });
    for (const file of ['balance-alerts.js','api-view.js','view.js']) {
      vm.runInContext(fs.readFileSync(path.join(extensionRoot,'media',file),'utf8'),context);
    }
    return {host,document,
      choice:id=>document.querySelector(`#manage-list [data-provider="${id}"] input`),
      visible:()=>[...document.querySelector('#provider-list').children].map(c=>c.dataset.provider),
      flush:async()=>{while(outgoing.length) await host.receive(outgoing.shift());},
      toggle(id,visible) {
        const checkbox=this.choice(id); checkbox.checked=visible;
        checkbox.dispatchEvent(new window.Event('change'));
      },
    };
  }
  const h=linked(); await h.flush();
  assert.equal(h.visible().length,10);
  for (const {id} of definitions) {
    // The host sends a new layout object with identical values on each sync.
    await h.host.receive({action:'syncAll'});
    h.toggle(id,false);
    assert(!h.visible().includes(id), `${id} disappears before the host acknowledges`);
    await h.flush();
    assert(!h.visible().includes(id), `${id} stays hidden after acknowledgement`);
    assert.equal(h.host.globalValues.get('providerLayout').find(p=>p.id===id).visible,false);
  }
  assert.deepEqual(h.visible(),['openai']);
  const count=requests(h.host,'status').length;
  await h.host.receive({action:'syncAll'});
  assert.equal(requests(h.host,'status').length,count, 'hidden APIs make no refresh requests');
  h.toggle('openrouter',true); await h.flush();
  await h.host.receive({action:'syncAll'});
  assert(h.visible().includes('openrouter'));
  assert(requests(h.host,'status').length>count, 'reenabling resumes requests');
  h.toggle('openrouter',false); await h.flush();
  const reopened=linked(Object.fromEntries(h.host.globalValues)); await reopened.flush();
  assert.deepEqual(reopened.visible(),['openai']);
  assert.equal(requests(reopened.host,'status').length,0, 'hidden APIs stay inactive after reload');
  for (const {id} of definitions) assert.equal(reopened.choice(id).checked,false,id);
});
