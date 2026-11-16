'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { attachExisting, metadata } = require('../live-client');

test('metadata observer excludes prompts, tool output, arbitrary config and service errors', () => {
  assert.deepEqual(metadata({ id: 1, method: 'thread/start', params: { input: 'PRIVATE', cwd: '/private' } }),
    { id: 1, method: 'thread/start', params: { threadId: undefined } });
  assert.equal(metadata({ id: 2, method: 'turn/start', params: { input: 'PRIVATE' } }), null);
  const value = metadata({ id: 3, method: 'config/batchWrite', params: { edits: [{ keyPath: 'api_key', value: 'PRIVATE' }, { keyPath: 'model', value: 'chosen' }] } });
  assert.equal(JSON.stringify(value).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(metadata({ id: 4, error: { message: 'PRIVATE' } }, true)).includes('PRIVATE'), false);
});

test('late attachment confirms the exact already-initialized child, filters only private replies and persists model acknowledgements', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'codex late client '));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const env = { ...process.env, CODEX_HOME: folder };
  const bridge = value => new Promise((resolve, reject) => {
    const child = spawn(python, ['-S', path.join(__dirname, '../backend/bridge.py')], { env, windowsHide: true });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.resume();
    child.on('error', reject); child.on('close', () => { try { const r = JSON.parse(output); if (!r.ok) throw Error('Backend failed'); resolve(r.data); } catch (e) { reject(e); } });
    child.stdin.end(JSON.stringify({ workspace: 'a'.repeat(64), window: 'b'.repeat(32), ...value }));
  });
  fs.writeFileSync(path.join(folder, 'config.toml'), 'model_provider="openai"\nmodel="old-model"\n');
  const fixture = path.join(folder, 'native.py');
  fs.writeFileSync(fixture, `import sys,json,os\nfrom pathlib import Path\np=Path(os.environ['CODEX_HOME'])/'config.toml'\nfor line in sys.stdin.buffer:\n v=json.loads(line);m=v.get('method');r={}\n if m=='config/read':r={'config':{'model_provider':'openai','model':'old-model'}}\n if m=='config/batchWrite':p.write_text('model_provider="openai"\\nmodel="new-model"\\n')\n if m=='echo':r=v['params']\n if 'id' in v:print(json.dumps({'id':v['id'],'result':r}),flush=True)\n`);
  const child = spawn(python, ['-u', fixture, 'app-server', 'features.code_mode_host=true', '--analytics-default-enabled'], { env, windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const messages = []; let buffer = '';
  child.stdout.on('data', raw => { buffer += raw; let index; while ((index = buffer.indexOf('\n')) >= 0) { messages.push(JSON.parse(buffer.slice(0, index))); buffer = buffer.slice(index + 1); } });
  child.stderr.resume();
  const wait = async predicate => { for (let i = 0; i < 600; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw Error('Native response timed out'); };
  child.stdin.write('{"id":"init","method":"initialize","params":{}}\n');
  await wait(() => messages.some(m => m.id === 'init'));
  // The native child predates preparation and the adapter, matching restored views.
  const prepared = await bridge({ action: 'prepareWindow', command: child.spawnfile, configuredCommand: null,
    ownerPid: process.pid, node: process.execPath, cwd: folder });
  const attached = await attachExisting(prepared.binding, bridge, [child]);
  assert.ok(attached); t.after(() => attached.dispose());
  const state = await bridge({ action: 'windowStatus' });
  assert.equal(state.verified, true); assert.equal(state.provider, 'openai');
  assert.equal(messages.some(m => typeof m.id === 'string' && m.id.startsWith('codex-switch-live-')), false);
  const payload = { text: 'unicode ñ \n', padding: 'x'.repeat(80000) };
  child.stdin.write(JSON.stringify({ id: 'echo', method: 'echo', params: payload }) + '\n');
  await wait(() => messages.some(m => m.id === 'echo'));
  const echoed = messages.find(m => m.id === 'echo').result;
  assert.equal(echoed.text, payload.text); assert.equal(echoed.padding.length, payload.padding.length);
  assert.ok(echoed.padding === payload.padding, 'Large payload bytes stay intact');
  child.stdin.write(JSON.stringify({ id: 'model', method: 'config/batchWrite', params: { edits: [{ keyPath: 'model', value: 'new-model' }] } }) + '\n');
  await wait(() => fs.existsSync(path.join(folder, 'provider-switcher/workspaces', 'a'.repeat(64), 'native-model.json')));
  const changed = await bridge({ action: 'windowStatus' });
  assert.equal(changed.model, 'new-model'); assert.equal(changed.reloadRequired, false);
});
