'use strict';
// First-start entry shipped in the VSIX. Wait for this host's asynchronous
// preparation before loading the retained runtime. No configuration or secrets
// are put in arguments, and an owned setup error never falls back to a provider.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

async function main() {
  const bindingPath = process.env.CODEX_SWITCH_BINDING;
  const ownerPid = Number(process.env.CODEX_SWITCH_OWNER);
  if (!bindingPath || ownerPid !== process.ppid) throw Error('Invalid owner');
  const root = path.resolve(path.dirname(bindingPath), '../..');
  const ownerFile = path.join(root, 'owners', `${ownerPid}.json`);
  const deadline = Date.now() + 65000;
  let owner;
  do {
    process.kill(ownerPid, 0);
    owner = read(ownerFile);
    if (owner.pid !== ownerPid || owner.binding !== bindingPath || ['error', 'inactive'].includes(owner.state)) throw Error('Owner unavailable');
    if (owner.state === 'ready') break;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  if (owner.state !== 'ready') throw Error('Setup timeout');
  const recovery = require(path.join(root, 'recovery.js'));
  if (!owner.ownerStart || recovery.identity(ownerPid) !== owner.ownerStart) throw Error('Owner changed');
  const binding = read(bindingPath);
  recovery.monitorRetirement(root);
  const original = process.env.CODEX_SWITCH_EXECUTABLE;
  if (recovery.managed(original) || original === binding.ignoredCommand) delete process.env.CODEX_SWITCH_EXECUTABLE;
  if (process.platform !== 'win32') return recovery.launch(root, ownerPid, owner.ownerStart, process.argv.slice(2));
  const launcher = read(path.join(root, 'recovery.json')).launcher;
  if (!launcher || !fs.existsSync(launcher)) throw Error('Bootstrap unavailable');
  const child = spawn(launcher, process.argv.slice(2), { stdio: 'inherit', windowsHide: true });
  child.once('error', () => { process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}
if (require.main === module) main().catch(() => {
  console.error('Codex Switch could not start this window. Open Codex Switch to recover its configuration.');
  process.exitCode = 1;
});
module.exports = { main };
