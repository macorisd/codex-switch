'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

function resolver(versions) {
  const calls = [], module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../python-runtime.js'), 'utf8'), {
    module, process: { platform: 'linux' }, setTimeout, clearTimeout,
    require: name => name === 'node:path' ? path.posix : { spawn(command, args, options) {
      calls.push(command);
      assert.equal(options.stdio[2], 'ignore');
      assert.equal(args[0], '-I');
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill() {} });
      queueMicrotask(() => {
        if (!(command in versions)) return child.emit('error', Error('missing'));
        child.stdout.emit('data', versions[command] >= 3.11 ? '1\n' : '0\n');
        child.emit('close', 0);
      });
      return child;
    } },
  });
  return { ...module.exports, calls };
}

test('an old PATH Python falls back to the compatible system interpreter and shares discovery', async () => {
  const runtime = resolver({ python3: 3.10, '/usr/bin/python3.13': 3.13 });
  const found = await Promise.all([runtime.resolve(), runtime.resolve()]);
  assert.deepEqual(found, ['/usr/bin/python3.13', '/usr/bin/python3.13']);
  assert.equal(runtime.calls.filter(command => command === 'python3').length, 1);
});

test('an explicit incompatible Python is reported without silently selecting another', async () => {
  const runtime = resolver({ '/custom/python': 3.10, python3: 3.14 });
  await assert.rejects(runtime.resolve('/custom/python'), /pythonPath.*Python 3.11/);
  assert.deepEqual(runtime.calls, ['/custom/python']);
  await assert.rejects(runtime.resolve('/custom/python'));
  assert.equal(runtime.calls.length, 2, 'A repaired explicit executable can be retried');
});
