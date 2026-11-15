'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { install } = require('../codex-spawn');
const recovery = require('../recovery');

test('IDE binding preserves protocol pipes and custom CLI without changing unrelated spawns', () => {
  const calls = [], result = {};
  const api = { spawn(...args) { calls.push(args); return result; } };
  const original = api.spawn;
  const bridge = install('/host/runtime/binding.json', '/installed extension', api);
  const options = { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: 'original', CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'codex_vscode' } };
  const args = ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'];
  assert.equal(api.spawn('/custom codex', args, options), result);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], [path.join('/installed extension', 'window-entry.js'), ...args]);
  assert.equal(calls[0][2].stdio, options.stdio);
  assert.equal(calls[0][2].env.CODEX_SWITCH_EXECUTABLE, '/custom codex');
  assert.equal(calls[0][2].env.CODEX_SWITCH_OWNER, String(process.pid));
  assert.equal(options.env.CODEX_SWITCH_BINDING, undefined);
  for (const [command, argv, opts] of [['other', args, { env: {} }], ['codex', ['--version'], options],
    ['codex', ['app-server'], { env: { CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'codex_cli_rs' } }]]) {
    api.spawn(command, argv, opts);
    assert.deepEqual(calls.at(-1), [command, argv, opts]);
  }
  bridge.dispose();
  assert.equal(api.spawn, original);
});

test('deactivation is safe when another wrapper retains the old hook', () => {
  const calls = [];
  const api = { spawn(...args) { calls.push(args); } };
  const bridge = install('binding', 'extension', api);
  const hook = api.spawn;
  const other = (...args) => hook(...args);
  api.spawn = other;
  bridge.dispose();
  api.spawn('codex', ['app-server'], { env: { CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'codex_vscode' } });
  assert.equal(api.spawn, other);
  assert.equal(calls[0][0], 'codex');
});

test('legacy selectors from either host are recognized without matching arbitrary custom CLIs', () => {
  for (const value of ['C:\\Users\\user\\.codex\\provider-switcher\\codex-window-123456789abc.exe', '/home/user/.codex/provider-switcher/codex-window']) {
    assert.equal(recovery.managed(value), true);
  }
  assert.equal(recovery.managed('/bin/codex-window'), false);
});
