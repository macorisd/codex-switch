'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { readAccount, normalize } = require('../codex-account');

function server({ account = { type: 'chatgpt', planType: 'plus', email: 'private@example.invalid' }, rates, rateError = false, hang = false } = {}) {
  const requests = [];
  let killed = false;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { killed = true; };
  child.stdin = new Writable({
    write(chunk, encoding, done) {
      const request = JSON.parse(chunk.toString());
      requests.push(request);
      queueMicrotask(() => {
        if (!request.id || (hang && request.id === 3)) return;
        let result = {};
        if (request.id === 2) result = { account };
        if (request.id === 3) result = rates || {};
        const response = JSON.stringify({ id: request.id, ...(rateError && request.id === 3 ? { error: { message: 'private upstream error' } } : { result }) }) + '\n';
        // Exercise framing across chunks and notifications between responses.
        child.stdout.write('{"method":"account/updated","params":{}}\n');
        child.stdout.write(response.slice(0, 9));
        child.stdout.write(response.slice(9));
      });
      done();
    },
  });
  return { child, requests, killed: () => killed, spawnProcess: (exe, args, options) => {
    assert.equal(options.windowsHide, true);
    assert.deepEqual(args, ['app-server', '-c', 'model_provider="openai"']);
    return child;
  } };
}

const rates = {
  rateLimitsByLimitId: { codex: {
    primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1794435740 },
    secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1795003321 },
  } },
  rateLimitResetCredits: { availableCount: 0, credits: [{ id: 'private-credit' }] },
};

test('read-only protocol returns only account and usage display fields and terminates', async () => {
  const s = server({ rates });
  const result = await readAccount('codex', s);
  assert.deepEqual(result, { configured: true, plan: 'Plus', fiveHour: { remaining: 75, resetsAt: 1794435740 }, weekly: { remaining: 0, resetsAt: 1795003321 }, bankedResets: 0, usageAvailable: true });
  assert.deepEqual(s.requests.map(r => r.method), ['initialize', 'initialized', 'account/read', 'account/rateLimits/read']);
  assert.equal(s.requests[2].params.refreshToken, false);
  assert.equal(s.killed(), true);
  assert(!JSON.stringify(result).includes('private'));
});

test('absent and API-key accounts are not ChatGPT configured and never request rate limits', async () => {
  for (const account of [null, { type: 'apiKey' }]) {
    const s = server({ account });
    const result = await readAccount('codex', s);
    assert.equal(result.configured, false);
    assert.equal(result.bankedResets, null);
    assert.equal(s.requests.length, 3);
  }
});

test('all requested plans are recognized; unrecognized plans do not leak arbitrary text', () => {
  for (const [planType, name] of Object.entries({ free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', business: 'Business', team: 'Business' })) {
    assert.equal(normalize({ type: 'chatgpt', planType }).plan, name);
  }
  assert.equal(normalize({ type: 'chatgpt', planType: '__proto__' }).plan, null);
});

test('missing usage, reset dates and counts remain unknown instead of zero', () => {
  const account = { type: 'chatgpt' };
  assert.equal(normalize(account, {}).bankedResets, null);
  assert.equal(normalize(account, {}).fiveHour, null);
  const result = normalize(account, { rateLimits: { primary: { windowDurationMins: 300, usedPercent: null, resetsAt: -1 } } });
  assert.deepEqual(result.fiveHour, { remaining: null, resetsAt: null });
  assert.equal(normalize(account, { rateLimits: { primary: { windowDurationMins: 15, usedPercent: 12 } } }).fiveHour, null);
  assert.equal(normalize(account, { rateLimits: { limitId: 'other', primary: { windowDurationMins: 300, usedPercent: 12 } } }).fiveHour, null);
});

test('window order is independent of duration and remaining values are bounded', () => {
  const result = normalize({ type: 'chatgpt' }, { rateLimits: {
    primary: { windowDurationMins: 10080, usedPercent: -5 },
    secondary: { windowDurationMins: 300, usedPercent: 110 },
  } });
  assert.equal(result.fiveHour.remaining, 0);
  assert.equal(result.weekly.remaining, 100);
});

test('rate errors and timeouts preserve confirmed account with unavailable usage', async () => {
  for (const options of [{ rateError: true }, { hang: true }]) {
    const s = server(options);
    const result = await readAccount('codex', { ...s, timeoutMs: 30 });
    assert.equal(result.configured, true);
    assert.equal(result.plan, 'Plus');
    assert.equal(result.usageAvailable, false);
    assert.equal(result.bankedResets, null);
    assert(s.killed());
  }
});

test('cancellation and startup errors terminate without exposing upstream errors', async () => {
  const s = server({ hang: true });
  const controller = new AbortController();
  const promise = readAccount('codex', { ...s, signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, { message: 'Codex account unavailable.' });
  assert(s.killed());
  const failed = server();
  const failure = readAccount('codex', failed);
  failed.child.emit('error', new Error('private details'));
  await assert.rejects(failure, { message: 'Codex account unavailable.' });
});
