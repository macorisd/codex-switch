'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { previousSetting } = require('../client-settings');

function client(files, calls = []) {
  return { Uri: { from: uri => uri }, workspace: { fs: { readFile: async uri => {
    calls.push(uri);
    const name = uri.path.split('/').pop();
    if (!(name in files)) throw Error('Unavailable');
    return Buffer.from(typeof files[name] === 'string' ? files[name] : JSON.stringify(files[name]));
  } } } };
}
const launcher = 'C:\\Users\\user\\.codex\\provider-switcher\\codex-window-123456789abc.exe';

test('remote migration reads only client recovery metadata and preserves custom original settings', async () => {
  for (const original of ['C:\\custom codex.exe', null, undefined]) {
    const calls = [];
    const saved = await previousSetting(client({ 'recovery.json': { launcher, original, hadOriginal: original !== undefined } }, calls), launcher);
    assert.deepEqual(saved, { original, hadOriginal: original !== undefined });
    assert.deepEqual(calls, [{ scheme: 'vscode-userdata', path: '/C:/Users/user/.codex/provider-switcher/recovery.json' }]);
  }
});

test('missing, malformed, recursive and unrelated snapshots cannot authorize a desktop setting change', async () => {
  for (const files of [{}, { 'recovery.json': '{broken' },
    { 'recovery.json': { launcher: '/other/provider-switcher/codex-window', hadOriginal: false } },
    { 'recovery.json': { launcher, hadOriginal: true } },
    { 'recovery.json': { launcher, hadOriginal: true, original: launcher } }]) {
    assert.equal(await previousSetting(client(files), launcher), null);
  }
  const calls = [];
  assert.equal(await previousSetting(client({}, calls), '/custom/codex'), null);
  assert.deepEqual(calls, []);
});

test('the original 0.5.0 snapshot can retire its selector without guessing a custom executable', async () => {
  assert.deepEqual(await previousSetting(client({ 'original-cli.json': { command: '/custom codex' } }), launcher),
    { original: '/custom codex', hadOriginal: true });
  assert.deepEqual(await previousSetting(client({ 'original-cli.json': {} }), launcher), { original: undefined, hadOriginal: false });
});
