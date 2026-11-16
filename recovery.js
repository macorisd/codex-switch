'use strict';
// Also deployed beside the retained launcher. This file needs only VS Code's
// Node runtime, including after Python or the extension has been removed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

function read(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function remove(file) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { fs.unlinkSync(file); return; }
    catch (error) {
      if (error.code === 'ENOENT') return;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 9) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

function replace(source, target) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { fs.renameSync(source, target); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 9) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    replace(temporary, file);
  } finally { remove(temporary); }
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function identity(pid) {
  try {
    if (process.platform === 'win32') {
      const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToFileTimeUtc().ToString()`;
      const result = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 3000, windowsHide: true });
      return result.status === 0 ? result.stdout.trim() : null;
    }
    if (process.platform === 'linux') {
      const fields = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').pop().split(' ');
      return fields[0] === 'Z' ? null : fields[19];
    }
    if (process.platform === 'darwin') {
      return spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000 }).stdout.trim() || null;
    }
  } catch {}
  return null;
}

function possiblySameProcess(pid, started) {
  if (!alive(pid)) return false;
  if (!started) return true;
  const observed = identity(pid);
  // A bounded OS lookup can fail under load. Unknown identity cannot authorize
  // deleting another live process's lock or retiring its pending model writes.
  return !observed || observed === started;
}

function managed(command) {
  return typeof command === 'string' && /(?:^|[/\\])provider-switcher[/\\]codex-window(?:-[a-f0-9]{12})?(?:\.exe)?$/.test(command);
}

async function locked(root, action) {
  const directory = path.join(root, 'lifecycle-lock');
  fs.mkdirSync(directory, { recursive: true });
  const ownerStart = identity(process.pid);
  const token = `${process.pid}-${crypto.randomBytes(12).toString('hex')}.json`;
  const ownerFile = path.join(directory, token);
  const participants = () => fs.readdirSync(directory).filter(file => file.endsWith('.json') && file !== token).flatMap(file => {
    const location = path.join(directory, file);
    const owner = read(location);
    if (!owner.pid) return [];
    if (!possiblySameProcess(owner.pid, owner.ownerStart)) {
      remove(location);
      return [];
    }
    return [{ ...owner, token: file }];
  });
  // Lamport's bakery protocol publishes the choosing phase before reading
  // tickets. Every contender owns a unique atomic file, including stale cleanup.
  atomic(ownerFile, { pid: process.pid, ownerStart, choosing: true, ticket: 0 });
  try {
    const ticket = 1 + Math.max(0, ...participants().map(owner => owner.ticket || 0));
    atomic(ownerFile, { pid: process.pid, ownerStart, choosing: false, ticket });
    for (let attempt = 0; attempt < 200; attempt++) {
      const blocked = participants().some(owner => owner.choosing || owner.ticket < ticket
        || (owner.ticket === ticket && owner.token < token));
      if (!blocked) return await action();
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Codex configuration is busy.');
  } finally {
    remove(ownerFile);
  }
}

function hasOwners(root, except) {
  let files;
  try { files = fs.readdirSync(path.join(root, 'owners')); } catch { return false; }
  return files.some(file => {
    if (!/^\d+\.json$/.test(file)) return false;
    const record = read(path.join(root, 'owners', file));
    return record.binding !== except && record.state !== 'inactive' && possiblySameProcess(record.pid, record.ownerStart);
  });
}

function hasClients(root) {
  const directory = path.join(root, 'windows');
  let windows;
  try { windows = fs.readdirSync(directory); } catch { return false; }
  return windows.some(window => {
    const receipt = read(path.join(directory, window, 'runtime.json'));
    return receipt.processStart && possiblySameProcess(receipt.pid, receipt.processStart);
  });
}

function registry() { return path.join(os.homedir(), '.codex-switch', 'installations'); }

function installationId(extensionPath) {
  const resolved = path.resolve(extensionPath);
  return crypto.createHash('sha256').update(process.platform === 'win32' ? resolved.toLowerCase() : resolved).digest('hex');
}

function register(extensionPath, root) {
  const id = installationId(extensionPath);
  const scope = crypto.createHash('sha256').update(root).digest('hex');
  atomic(path.join(registry(), `${id}-${scope}.json`), { root });
}

function settingsPath(context) {
  if (!context.globalStorageUri?.fsPath) return null;
  let user = path.dirname(path.dirname(context.globalStorageUri.fsPath));
  // Application settings are shared by VS Code profiles.
  if (path.basename(path.dirname(user)) === 'profiles') user = path.dirname(path.dirname(user));
  return path.join(user, 'settings.json');
}

function restoreSettings(record) {
  if (!record.settings || !fs.existsSync(record.settings)) return;
  const jsonc = fs.existsSync(path.join(__dirname, 'jsonc-parser/main.js'))
    ? require('./jsonc-parser/main') : require('jsonc-parser');
  const original = fs.readFileSync(record.settings, 'utf8');
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  const content = original.slice(bom.length);
  const errors = [];
  const parsed = jsonc.parse(content, errors, { allowTrailingComma: true });
  if (errors.length || !managed(parsed?.['chatgpt.cliExecutable'])
      || parsed['chatgpt.cliExecutable'] !== record.launcher) return;
  const edits = jsonc.modify(content, ['chatgpt.cliExecutable'], record.hadOriginal ? record.original : undefined,
    { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  // Compare again immediately before the atomic replacement.
  if (fs.readFileSync(record.settings, 'utf8') !== original) return;
  const updated = bom + jsonc.applyEdits(content, edits);
  const temporary = `${record.settings}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, updated, { mode: fs.statSync(record.settings).mode & 0o777 });
    replace(temporary, record.settings);
  }
  finally { remove(temporary); }
}

function restoreModels(root) {
  const journal = read(path.join(root, 'model-defaults.json'));
  if (!journal.config || !Array.isArray(journal.edits)) return;
  let original;
  try { original = fs.readFileSync(journal.config, 'utf8'); } catch { return; }
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  const content = original.slice(bom.length);
  const lines = content.split(/(?<=\n)/);
  const scalarLines = text => {
    const result = new Map();
    let table = '', quote = null;
    for (const [lineIndex, line] of text.split(/(?<=\n)/).entries()) {
      if (!quote) {
        const header = line.trim().match(/^\[(.+)\]\s*(?:#.*)?$/);
        if (header) table = header[1];
        const key = line.match(/^\s*["']?(model|model_reasoning_effort|model_provider|profile)["']?\s*=/)?.[1];
        if (key) result.set(`${table}\0${key}`, { line, lineIndex });
      }
      for (let index = 0; index < line.length; index++) {
        const character = line[index];
        if (quote) {
          if (character === '\\' && quote.startsWith('"')) { index++; continue; }
          if (line.startsWith(quote, index)) { index += quote.length - 1; quote = null; }
        } else if (character === '#') break;
        else if (character === '"' || character === "'") {
          quote = line.startsWith(character.repeat(3), index) ? character.repeat(3) : character;
          index += quote.length - 1;
        }
      }
    }
    return result;
  };
  const current = scalarLines(content);
  // Each exact one-line edit includes its TOML table. Unrelated edits and an
  // external model edit invalidate ownership instead of restoring stale data.
  for (const edit of journal.edits) {
    if (edit.guards?.some(guard => (current.get(`${guard.table}\0${guard.key}`)?.line ?? null) !== guard.line)) continue;
    const entry = current.get(`${edit.table}\0${edit.key}`);
    if (entry?.line === edit.after) lines[entry.lineIndex] = edit.before || '';
  }
  const updated = bom + lines.join('');
  if (updated !== original && fs.readFileSync(journal.config, 'utf8') === original) {
    const temporary = `${journal.config}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, updated, { mode: fs.statSync(journal.config).mode & 0o777 });
      replace(temporary, journal.config);
    }
    finally { remove(temporary); }
  }
  remove(path.join(root, 'model-defaults.json'));
}

async function uninstall(extensionPath = __dirname) {
  const id = installationId(extensionPath);
  let files;
  try { files = fs.readdirSync(registry()).filter(file => file.startsWith(`${id}-`) && file.endsWith('.json')); }
  catch { return; }
  for (const file of files) {
    const location = path.join(registry(), file);
    const { root } = read(location);
    if (!root) continue;
    const released = await locked(root, () => {
      if (hasOwners(root)) return false;
      const record = read(path.join(root, 'recovery.json'));
      if (!record.extensionPath || installationId(record.extensionPath) !== id) return;
      require('./codex-adapter').restore(root, extensionPath);
      restoreModels(root);
      if (hasClients(root)) return false;
      restoreSettings(record);
    });
    if (released !== false) remove(location);
  }
  // Other installed versions can still use this root. Retain launchers and
  // preferences so interrupted or delayed references remain functional.
}

function ordinaryCommand(record) {
  if (record.command) return record.command;
  // The official IDE appends its current platform bin directory to PATH.
  // Prefer that current executable over the version present at installation.
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = (process.env.PATH || '').split(path.delimiter).reverse();
  for (const directory of candidates) {
    const candidate = path.join(directory, name);
    if (directory && fs.existsSync(candidate) && !managed(candidate)) return candidate;
  }
  if (record.bundled && !managed(record.bundled)) return record.bundled;
  throw new Error('Codex executable unavailable.');
}

async function launch(root, pid, started, args) {
  started ||= identity(pid);
  const ownerFile = path.join(root, 'owners', `${pid}.json`);
  let owner = read(ownerFile);
  const valid = record => record.pid === pid && record.state !== 'inactive' && alive(pid)
    && (record.ownerStart ? record.ownerStart === started : record.created >= Number(process.env.CODEX_SWITCH_PARENT_CREATED || 0));
  // Codex can spawn before our eager activation is called. Wait here for the
  // owning host's claim instead of causing the workbench to reload at startup.
  const discoveryDeadline = Date.now() + 3000;
  while (!valid(owner) && Date.now() < discoveryDeadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
    owner = read(ownerFile);
  }
  let command, arguments_;
  if (valid(owner)) {
    // A registered activation owns startup even when setup is slow or fails.
    // Its timeout is an error, never a provider substitution.
    const deadline = Date.now() + 65000;
    while (owner.state === 'preparing' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
      owner = read(ownerFile);
    }
    if (!valid(owner) || owner.state !== 'ready') throw new Error('Workspace provider setup failed.');
    const binding = read(owner.binding);
    if (binding.ownerPid !== pid || !binding.python || !binding.launcher) throw new Error('Invalid window binding.');
    command = binding.python;
    arguments_ = [binding.launcher, owner.binding, ...args];
  } else {
    // No extension activation claims this invocation. Disabled and removed
    // extensions still delegate to the ordinary executable after startup grace.
    await locked(root, () => {
      restoreModels(root);
      if (!hasOwners(root) && !hasClients(root)) restoreSettings(read(path.join(root, 'recovery.json')));
    });
    command = ordinaryCommand(read(path.join(root, 'recovery.json')));
    arguments_ = args;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CODEX_SWITCH_OWNER;
  delete env.CODEX_SWITCH_PARENT_CREATED;
  const child = spawn(command, arguments_, { stdio: 'inherit', windowsHide: true, env,
    detached: process.platform !== 'win32' });
  let guard;
  if (process.platform !== 'win32' && child.pid) {
    guard = spawn(process.execPath, [__filename, '--guard', String(child.pid)], {
      detached: true, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    });
    guard.stdio[3].on('error', () => {});
    guard.unref();
  }
  child.on('error', () => { process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    guard?.stdio[3].end('done');
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

async function retire(root, intervalMs = 5000) {
  const file = path.join(root, 'retirement.json');
  const self = { pid: process.pid, started: identity(process.pid) };
  const elected = await locked(root, () => {
    const previous = read(file);
    if (previous.started && possiblySameProcess(previous.pid, previous.started)) return false;
    atomic(file, self);
    return true;
  });
  if (!elected) return;
  // Independent of the IDE and native bootstrap jobs. A final acknowledged
  // model write can finish after deactivate or a forced host shutdown.
  try {
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      if (hasOwners(root) || hasClients(root)) continue;
      const finished = await locked(root, () => {
        if (hasOwners(root) || hasClients(root)) return false;
        restoreModels(root);
        restoreSettings(read(path.join(root, 'recovery.json')));
        return true;
      });
      if (finished) return;
    }
  } finally {
    if (read(file).pid === self.pid) remove(file);
  }
}

function monitorRetirement(root) {
  const child = spawn(process.execPath, [path.join(root, 'recovery.js'), '--retire'], {
    detached: true, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  child.on('error', () => {});
  child.unref();
}

if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === '--guard') {
    const pipe = fs.createReadStream(null, { fd: 3 });
    let completed = false;
    pipe.on('data', () => { completed = true; });
    pipe.on('end', () => {
      if (!completed) { try { process.kill(-Number(args[0]), 'SIGTERM'); } catch {} }
    });
  } else {
    const action = mode === '--retire' ? retire(__dirname) : mode === '--uninstall' || mode === '--type=extension-post-uninstall'
      ? uninstall() : launch(__dirname, Number(args[0]), args[1], args.slice(2));
    action.catch(() => {
      console.error('Codex Switch could not prepare Codex. Open Codex Switch to recover its configuration.');
      process.exitCode = 1;
    });
  }
}

module.exports = { read, atomic, remove, managed, locked, hasOwners, hasClients, register, settingsPath,
  restoreSettings, restoreModels, uninstall, launch, identity, retire, monitorRetirement };
