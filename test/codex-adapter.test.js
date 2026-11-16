'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const adapter = require('../codex-adapter');

test('optional entry awaits Switch before loading or activating the original module', async () => {
  const calls = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const exports = {}, context = {};
  vm.runInNewContext(adapter.entry('./original.cjs'), { exports, process: { env: {} }, require(name) {
    if (name === 'vscode') return { extensions: { getExtension: () => ({ activate: async () => { calls.push('switch'); await gate; } }) } };
    assert.equal(name, './original.cjs'); calls.push('load');
    return { activate: value => { assert.equal(value, context); calls.push('native'); return 'original-api'; } };
  } });
  const pending = exports.activate(context);
  assert.deepEqual(calls, ['switch']);
  release(); assert.equal(await pending, 'original-api');
  assert.deepEqual(calls, ['switch', 'load', 'native']);
});

test('disabled/uninstalled Switch needs only vscode and the original module', async () => {
  const calls = [], exports = {};
  vm.runInNewContext(adapter.entry('./original.cjs'), { exports, require(name) {
    calls.push(name);
    if (name === 'vscode') return { extensions: { getExtension: () => undefined } };
    return { activate: () => 'plain-codex', deactivate: () => calls.push('stopped') };
  } });
  assert.equal(await exports.activate({}), 'plain-codex'); exports.deactivate();
  assert.deepEqual(calls, ['vscode', './original.cjs', 'stopped']);
});

test('failed Switch activation still starts original Codex and restores startup markers', async () => {
  const exports = {}, env = { CODEX_SWITCH_OFFICIAL_STARTUP: 'previous' };
  vm.runInNewContext(adapter.entry('./original.cjs'), { exports, process: { env }, require(name) {
    if (name === 'vscode') return { extensions: { getExtension: () => ({ activate: async () => { throw Error('setup failed'); } }) } };
    return { activate: () => 'ordinary-codex' };
  } });
  assert.equal(await exports.activate({}), 'ordinary-codex');
  assert.equal(env.CODEX_SWITCH_OFFICIAL_STARTUP, 'previous');
});

test('manifest-only setup leaves source bytes intact and conditional uninstall preserves edits and newer owners', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'codex optional entry '));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const official = path.join(folder, 'official'), runtime = path.join(folder, 'runtime');
  fs.mkdirSync(official); fs.writeFileSync(path.join(official, 'original.cjs'), 'exports.activate=()=>42;');
  const source = fs.readFileSync(path.join(official, 'original.cjs'));
  const manifest = path.join(official, 'package.json');
  fs.writeFileSync(manifest, JSON.stringify({ name: 'fixture', version: '1.0.0', main: './original.cjs', preserve: true }, null, 2));
  const vscode = { extensions: { getExtension: () => ({ extensionPath: official }) } };
  adapter.install(vscode, { extensionPath: '/switch-1' }, runtime);
  assert.equal(JSON.parse(fs.readFileSync(manifest)).main, adapter.ENTRY);
  assert.deepEqual(fs.readFileSync(path.join(official, 'original.cjs')), source);
  adapter.install(vscode, { extensionPath: '/switch-2' }, runtime);
  adapter.restore(runtime, '/switch-1');
  assert.equal(JSON.parse(fs.readFileSync(manifest)).main, adapter.ENTRY);
  const changed = JSON.parse(fs.readFileSync(manifest)); changed.preserve = 'new-value'; fs.writeFileSync(manifest, JSON.stringify(changed));
  adapter.restore(runtime, '/switch-2');
  assert.deepEqual(JSON.parse(fs.readFileSync(manifest)), { name: 'fixture', version: '1.0.0', main: './original.cjs', preserve: 'new-value' });
  assert.ok(fs.existsSync(path.join(official, adapter.ENTRY)), 'Cached entries remain safe after uninstall');
  adapter.install(vscode, { extensionPath: '/switch-2' }, runtime);
  changed.main = './user-choice.cjs'; fs.writeFileSync(manifest, JSON.stringify(changed));
  adapter.restore(runtime, '/switch-2');
  assert.equal(JSON.parse(fs.readFileSync(manifest)).main, './user-choice.cjs');
});
