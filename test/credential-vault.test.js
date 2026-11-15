'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const execute = require('node:util').promisify(execFile);
const { CredentialVault } = require('../credential-vault');
const providers = require('../backend/providers.json');

async function fixture(t) {
  const values = new Map();
  const context = { secrets: { get: async key => values.get(key), store: async (key, value) => values.set(key, value) } };
  const first = new CredentialVault(context, providers, true), second = new CredentialVault(context, providers, true);
  await Promise.all([first.ready, second.ready]);
  t.after(async () => { await first.close(); await second.close(); });
  const call = (vault, operation, value) => vault.handle({ token: vault.token, provider: 'openrouter', operation, value });
  return { first, second, values, call };
}

test('shared secrets survive reopening; migration cannot overwrite an explicit key or resurrect removal', async t => {
  const { first, second, call } = await fixture(t);
  await call(first, 'migrate', 'old-desktop-fixture');
  assert.equal((await call(second, 'get')).value, 'old-desktop-fixture');
  const revision = (await call(second, 'status')).revision;
  await call(second, 'store', 'new-explicit-fixture');
  await call(first, 'migrate', 'old-desktop-fixture');
  assert.equal((await call(first, 'get')).value, 'new-explicit-fixture');
  assert.notEqual((await call(first, 'status')).revision, revision);
  await call(second, 'delete');
  await call(first, 'migrate', 'old-desktop-fixture');
  assert.equal((await call(first, 'get')).value, null);
  assert.equal((await call(first, 'status')).known, true);
});

test('Python and the deployed auth helper share keys across hosts without writing remote secrets', async t => {
  const { first, second, call } = await fixture(t);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex secret bridge '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const root = path.join(directory, 'provider-switcher');
  const env = { ...process.env, CODEX_HOME: directory, CODEX_SWITCH_VAULT: first.connection };
  const child = spawn(python, ['-S', path.join(__dirname, '../backend/bridge.py')], { env, windowsHide: true });
  let output = '', stderr = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(JSON.stringify({ action: 'api', provider: 'openrouter', operation: 'saveKey', key: 'remote-fixture-api-key' }));
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0); assert.equal(stderr, '');
  assert.equal(JSON.parse(output).data.hasKey, true);
  assert.equal(output.includes('remote-fixture-api-key'), false);
  const result = await execute(python, ['-S', path.join(root, 'switcher.py'), '--token', 'openrouter'],
    { env: { ...env, CODEX_SWITCH_VAULT: second.connection }, windowsHide: true });
  assert.equal(result.stdout, 'remote-fixture-api-key');
  for (const name of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, name);
    if (fs.statSync(file).isFile()) assert.equal(fs.readFileSync(file).includes(Buffer.from('remote-fixture-api-key')), false, name);
  }
  await call(first, 'delete');
  await assert.rejects(execute(python, ['-S', path.join(root, 'switcher.py'), '--token', 'openrouter'], { env, windowsHide: true }));
  const bad = JSON.stringify({ ...JSON.parse(first.connection), token: '0'.repeat(64) });
  await assert.rejects(execute(python, ['-S', path.join(root, 'switcher.py'), '--token', 'openrouter'],
    { env: { ...env, CODEX_SWITCH_VAULT: bad }, windowsHide: true }));
});

test('untrusted requests cannot enumerate providers, read secrets or choose arbitrary operations', async t => {
  const { first, values } = await fixture(t);
  for (const extra of [{ token: 'wrong' }, { provider: 'openai' }, { operation: 'export-all' }]) {
    await assert.rejects(first.handle({ token: first.token, provider: 'openrouter', operation: 'status', ...extra }));
  }
  assert.equal(values.size, 0);
});
