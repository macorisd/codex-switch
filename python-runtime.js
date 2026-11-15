'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const cache = new Map();

function compatible(command) {
  return new Promise(resolve => {
    const child = spawn(command, ['-I', '-S', '-c', 'import sys; print(int(sys.version_info >= (3, 11)))'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 2500);
    child.stdout.on('data', chunk => { if (output.length < 32) output += chunk; });
    child.once('error', () => { clearTimeout(timer); resolve(false); });
    child.once('close', code => { clearTimeout(timer); resolve(code === 0 && output.trim() === '1'); });
  });
}

async function discover(explicit) {
  if (explicit) {
    if (await compatible(explicit)) return explicit;
    throw Error('codexSwitch.pythonPath must select a working Python 3.11+ executable on this host.');
  }
  const preferred = process.platform === 'win32' ? 'python' : 'python3';
  if (await compatible(preferred)) return preferred;
  const names = ['python3.15', 'python3.14', 'python3.13', 'python3.12', 'python3.11'];
  const candidates = process.platform === 'win32' ? ['python3', ...names] :
    [...names, ...['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'].flatMap(dir => names.map(name => path.join(dir, name)))];
  const results = await Promise.all(candidates.map(compatible));
  const index = results.indexOf(true);
  if (index >= 0) return candidates[index];
  throw Error('Python 3.11+ is required on the host running Codex. Set codexSwitch.pythonPath to its executable.');
}

function resolve(explicit = '') {
  if (!cache.has(explicit)) cache.set(explicit, discover(explicit).catch(error => { cache.delete(explicit); throw error; }));
  return cache.get(explicit);
}
module.exports = { resolve, compatible };
