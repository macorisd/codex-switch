'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const recovery = require('./recovery');

function metadata(value, response = false) {
  if (!value || typeof value !== 'object' || value.id === undefined) return null;
  if (response) {
    if (!Object.hasOwn(value, 'result') && !value.error) return null;
    const thread = value.result?.thread;
    return { id: value.id, ...(value.error ? { error: { code: -1 } } : { result: thread
      ? { thread: { id: thread.id, modelProvider: thread.modelProvider } } : {} }) };
  }
  const { method, params = {} } = value;
  let clean;
  if (['thread/start', 'thread/resume', 'thread/read', 'thread/fork'].includes(method)) clean = { threadId: params.threadId };
  else if (method === 'thread/settings/update') clean = { threadId: params.threadId, model: params.model, reasoningEffort: params.reasoningEffort };
  else if (method === 'config/batchWrite' || method === 'config/value/write') {
    const edits = (method === 'config/batchWrite' ? params.edits || [] : [params]).filter(edit =>
      typeof edit.keyPath === 'string' && /(?:^|\.)(model|model_reasoning_effort)$/.test(edit.keyPath))
      .map(edit => ({ keyPath: edit.keyPath, value: edit.value }));
    if (!edits.length) return null;
    clean = method === 'config/batchWrite' ? { edits } : edits[0];
  } else return null;
  return { id: value.id, method, params: clean };
}

function observer(binding, file) {
  const child = spawn(binding.python, [path.join(path.dirname(binding.launcher), 'model_observer.py'), file],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let sequence = 0, buffer = '';
  const pending = new Map();
  const fail = () => { for (const { resolve, timer } of pending.values()) { clearTimeout(timer); resolve(); } pending.clear(); };
  child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail);
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      let message; try { message = JSON.parse(buffer.slice(0, index)); } catch {}
      buffer = buffer.slice(index + 1);
      const item = pending.get(message?.id);
      if (item) { pending.delete(message.id); clearTimeout(item.timer); item.resolve(); }
    }
  });
  return {
    send(direction, message) {
      if (!message || child.exitCode !== null || child.killed) return Promise.resolve();
      return new Promise(resolve => {
        const id = ++sequence, timer = setTimeout(() => { pending.delete(id); resolve(); }, 5000);
        pending.set(id, { resolve, timer });
        child.stdin.write(JSON.stringify({ id, direction, message }) + '\n');
      });
    },
    close() { fail(); child.stdin.end(); const timer = setTimeout(() => child.kill(), 5000); timer.unref(); },
  };
}

async function attach(child, file, request) {
  const binding = recovery.read(file);
  let started;
  for (let attempt = 0; attempt < 3 && !started && child.exitCode === null; attempt++) {
    started = recovery.identity(child.pid);
    if (!started) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!started || child.exitCode !== null) return null;
  const probeId = 'codex-switch-live-' + crypto.randomBytes(16).toString('hex');
  const originalWrite = child.stdin.write, originalEmit = child.stdout.emit;
  const observed = observer(binding, file);
  let active = true, capturing = false, buffer = Buffer.alloc(0), stringChunks = false, writing = Promise.resolve(), queued = 0;
  const pendingIds = new Set();
  let complete;
  const confirmed = new Promise(resolve => { complete = resolve; });
  const timer = setTimeout(() => complete(false), 15000);
  function write(chunk, ...args) {
    if (!active) return Reflect.apply(originalWrite, this, [chunk, ...args]);
    let value;
    if (Buffer.byteLength(chunk) < 65536) { try { value = JSON.parse(chunk.toString()); } catch {} }
    const clean = capturing ? metadata(value) : null;
    if (!queued && !clean) return Reflect.apply(originalWrite, this, [chunk, ...args]);
    if (clean) pendingIds.add(clean.id);
    queued++;
    writing = writing.then(async () => {
      await observed.send('request', clean);
      Reflect.apply(originalWrite, child.stdin, [chunk, ...args]);
    }).catch(() => {}).finally(() => { if (--queued === 0) child.stdin.emit('drain'); });
    return false;
  }
  const forward = raw => Reflect.apply(originalEmit, child.stdout, ['data', stringChunks ? raw.toString('utf8') : raw]);
  function emit(event, chunk, ...args) {
    if (!active || event !== 'data') {
      if (event === 'end' && buffer.length) { forward(buffer); buffer = Buffer.alloc(0); }
      return Reflect.apply(originalEmit, this, [event, chunk, ...args]);
    }
    stringChunks = typeof chunk === 'string';
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    let index;
    while ((index = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, index + 1); buffer = buffer.subarray(index + 1);
      let value; try { value = JSON.parse(line); } catch {}
      if (value?.id === probeId) {
        const config = value.result?.config;
        if (config && !value.error) {
          void request({ action: 'adoptClient', pid: child.pid, started,
            config: { model_provider: config.model_provider, model: config.model } })
            .then(result => complete(Boolean(result.verified)), () => complete(false));
        } else complete(false);
        continue;
      }
      if (pendingIds.delete(value?.id)) void observed.send('response', metadata(value, true));
      forward(line);
    }
    return true;
  }
  child.stdin.write = write;
  child.stdout.emit = emit;
  const dispose = () => {
    if (!active) return;
    active = false; clearTimeout(timer); complete(false);
    if (child.stdin.write === write) child.stdin.write = originalWrite;
    if (child.stdout.emit === emit) child.stdout.emit = originalEmit;
    if (buffer.length) { forward(buffer); buffer = Buffer.alloc(0); }
    observed.close();
  };
  child.once('close', dispose);
  Reflect.apply(originalWrite, child.stdin, [JSON.stringify({ id: probeId, method: 'config/read',
    params: { includeLayers: false, cwd: binding.cwd } }) + '\n']);
  if (!await confirmed) { dispose(); return null; }
  capturing = true;
  clearTimeout(timer);
  return { dispose, release() { /* Metadata follows the already-live client until close. */ } };
}

async function attachExisting(file, request, handles = process._getActiveHandles?.() || []) {
  const binding = recovery.read(file);
  const normalize = value => process.platform === 'win32' ? String(value).toLowerCase() : String(value);
  const candidates = handles.filter(child => Number.isSafeInteger(child.pid) && child.stdin && child.stdout &&
    child.exitCode === null && child.spawnargs?.includes('app-server') &&
    child.spawnargs?.includes('features.code_mode_host=true') && child.spawnargs?.includes('--analytics-default-enabled') &&
    normalize(child.spawnfile) === normalize(binding.command));
  if (candidates.length !== 1) return null;
  return attach(candidates[0], file, request);
}
module.exports = { attachExisting, attach, metadata };
