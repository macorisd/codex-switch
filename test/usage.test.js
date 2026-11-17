'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const metrics = require('../media/usage-metrics'), { UsageService } = require('../usage-service'), { UsageStatus } = require('../usage-status');
const { normalize } = require('../codex-account');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));

test('arbitrary and weekly-only Codex windows preserve their own duration, missing values and plan', () => {
  const account = normalize({ type: 'chatgpt', planType: 'pro' }, { rateLimitsByLimitId: { codex: {
    primary: { windowDurationMins: 10080, usedPercent: 91, resetsAt: 1800000000 },
    secondary: { windowDurationMins: 1440, usedPercent: 20 },
  } } });
  assert.equal(account.fiveHour, null); assert.equal(account.weekly.remaining, 9);
  assert.deepEqual(account.windows.map(w => w.durationMins), [1440, 10080]);
  assert.equal(account.windows[0].resetsAt, null);
  assert.equal(normalize({ type: 'apiKey' }, { rateLimits: {} }).windows.length, 0);
});

test('reference text, native units and exact percentage and money boundaries', () => {
  const now = 1800000000000;
  const balance = { windows: [{ durationMins: 300, remaining: 97, resetsAt: now / 1000 + 2460 }, { durationMins: 10080, remaining: 33, resetsAt: now / 1000 + 342000 }] };
  assert.equal(metrics.text(balance, now), '5h 97% · 41m | Week 33% · 3d 23h');
  for (const [value, expected] of [[0,'zero'],[10,'zero'],[10.01,'low'],[25,'low'],[25.01,'ok'],[100,'ok']]) {
    assert.equal(metrics.level({ windows: [{ remaining: 90 }, { remaining: value }] }), expected);
    assert.equal(metrics.level({ windows: [{ remaining: value }, { remaining: 90 }] }), expected);
  }
  for (const value of [-1,0,2,3,10]) {
    const reading = { total: value, currency: 'USD' };
    assert.equal(metrics.level(reading, 0), 'ok');
    assert.equal(metrics.level(reading, 3), value <= 0 ? 'zero' : value < 3 ? 'low' : 'ok');
  }
  assert.equal(metrics.text({ total: 8500000, unit: 'Credits' }), '8,500,000 Credits');
  assert.notEqual(metrics.amount({ total: .00000001, currency: 'USD' }), 'USD 0.00');
  assert.equal(metrics.normalize({ total: 2, currency: 'unknown' }), null);
  assert.equal(metrics.normalize({ windows: [{ remaining: NaN }] }), null);
  assert.equal(metrics.text({ windows: [{ remaining: 10, durationMins: 43200 }] }, now), 'Month 10% · unknown');
  assert.equal(metrics.duration(-10), '0m');
});

test('service shares one pending read and TTL across views, clock rendering requires no reads', async () => {
  const gate = deferred(); let calls = 0, now = 1000;
  const service = new UsageService({ load: () => { calls++; return gate.promise; }, demanded: () => true, now: () => now });
  const a = service.read('deepseek'), b = service.read('deepseek', true); assert.equal(a, b);
  gate.resolve({ balance: { total: 2, currency: 'USD' } }); await a;
  await service.read('deepseek'); metrics.text(service.get('deepseek').balance, now + 30000); assert.equal(calls, 1);
  now += 60001; await service.read('deepseek'); assert.equal(calls, 2); service.dispose();
});

test('late results after invalidation, hiding or disposal cannot overwrite a new reading', async () => {
  const gates = [deferred(), deferred()]; let calls = 0, demand = true;
  const service = new UsageService({ load: () => gates[calls++].promise, demanded: () => demand });
  const old = service.read('mimo'); service.invalidate('mimo'); const next = service.read('mimo');
  gates[1].resolve({ balance: { total: 7, unit: 'Credits' } }); await next;
  gates[0].resolve({ balance: { total: 99, currency: 'USD' } }); await old;
  assert.equal(service.get('mimo').balance.total, 7);
  const gate = deferred(); service.load = () => gate.promise;
  const hidden = service.read('mimo', true); demand = false; service.reconcile();
  gate.resolve({ balance: { total: 123, unit: 'Credits' } }); await hidden;
  assert.equal(service.get('mimo').balance.total, 7);
  service.dispose(); assert.equal(await service.read('mimo'), null);
});

test('failures never turn into zero, use bounded backoff, preserve dated prior reading and allow manual retry', async () => {
  let now = 1000, fail = false, calls = 0;
  const service = new UsageService({ demanded: () => true, now: () => now, load: async () => {
    calls++; if (fail) throw Error('private upstream token'); return { balance: { total: 2, currency: 'USD' } };
  } });
  await service.read('openrouter'); fail = true;
  const failed = await service.read('openrouter', true);
  assert.equal(failed.balance, null); assert.equal(failed.lastGood.balance.total, 2);
  assert.equal(failed.nextRead - failed.capturedAt, 120000);
  now += 60000; await service.read('openrouter'); assert.equal(calls, 2);
  await service.read('openrouter', true); assert.equal(calls, 3);
  assert(!JSON.stringify(service.get('openrouter')).includes('private')); service.dispose();
});

test('native item follows the verified provider, worst-window color, unit threshold and unavailable state', () => {
  const item = { show() {}, dispose() { this.disposed = true; } };
  const vscode = { window: { createStatusBarItem: (id, side) => { assert.equal(id, 'codexSwitch.usage'); assert.equal(side, 2); return item; } },
    StatusBarAlignment: { Right: 2 }, ThemeColor: class { constructor(id) { this.id = id; } } };
  let threshold = 0;
  const status = new UsageStatus(vscode, [{ id: 'openai', name: 'ChatGPT' }, { id: 'deepseek', name: 'DeepSeek' }], () => threshold);
  assert.match(item.text, /Codex Switch —/);
  status.render('openai', { status: 'ready', balance: { windows: [{ durationMins: 10080, remaining: 9 }] } });
  assert.match(item.text, /Codex Week 9%/); assert.equal(item.backgroundColor.id, 'statusBarItem.errorBackground');
  status.render('deepseek', { status: 'ready', balance: { total: 0, currency: 'USD' } }); assert.equal(item.backgroundColor, undefined);
  threshold = 1; status.render('deepseek', { status: 'ready', balance: { total: 0, currency: 'USD' } }); assert.match(item.backgroundColor.id, /error/);
  status.render('deepseek', { status: 'unavailable', reason: 'No billing permission.' });
  assert.match(item.text, /DeepSeek —/); assert.equal(item.backgroundColor, undefined); assert.match(item.tooltip, /No billing permission/);
  assert.equal(item.command, 'codexSwitch.open'); status.dispose(); assert(item.disposed);
});

test('remote tooltip never pretends the server time zone is the client zone', () => {
  const item = { show() {}, dispose() {} };
  const status = new UsageStatus({ env: { remoteName: 'ssh-remote' }, window: { createStatusBarItem: () => item },
    StatusBarAlignment: { Right: 2 }, ThemeColor: class {} }, [{ id: 'openai', name: 'ChatGPT' }], () => 0);
  const reading = { status: 'ready', capturedAt: 1800000000000, balance: { windows: [{ remaining: 80, durationMins: 300, resetsAt: 1800000000 }] } };
  status.render('openai', reading); assert.match(item.tooltip, /UTC/);
  status.setTimeZone('Europe/Madrid'); status.render('openai', reading); assert.doesNotMatch(item.tooltip, / UTC/);
  const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Madrid' }).format(new Date(1800000000000));
  assert(item.tooltip.includes(expected)); status.setTimeZone('invalid/zone'); assert.equal(status.timeZone, 'Europe/Madrid');
});
