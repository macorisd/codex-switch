'use strict';
// Optional manifest entry. The original Codex module and binaries stay intact.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ENTRY = './codex-switch.entry.cjs';
const MARKER = 'codex-switch.adapter.json';
const KIND = 'codex-switch-optional-entry-v1';

function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function write(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try { fs.writeFileSync(temporary, text, { mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch {} }
}
function jsonc() {
  return fs.existsSync(path.join(__dirname, 'jsonc-parser/main.js')) ? require('./jsonc-parser/main') : require('jsonc-parser');
}
function entry(original) {
  return `'use strict';\n// ${KIND}. Optional ordering only; no dependency on Switch files.\n` +
    `let original;\nconst load=()=>original||(original=require(${JSON.stringify(original)}));\n` +
    `exports.activate=async context=>{\n` +
    ` const vscode=require('vscode');\n const product=vscode.extensions.getExtension('macor-local.codex-provider-switch');\n` +
    ` if(product){const previous=process.env.CODEX_SWITCH_OFFICIAL_STARTUP;process.env.CODEX_SWITCH_OFFICIAL_STARTUP='1';\n` +
    `  try{await product.activate();}catch{}finally{if(previous===undefined)delete process.env.CODEX_SWITCH_OFFICIAL_STARTUP;else process.env.CODEX_SWITCH_OFFICIAL_STARTUP=previous;}\n }\n` +
    ` return load().activate(context);\n};\nexports.deactivate=()=>original?.deactivate?.();\n`;
}

function install(vscode, context, root) {
  const extension = vscode.extensions.getExtension('openai.chatgpt');
  if (!extension) return;
  const folder = extension.extensionPath, manifest = path.join(folder, 'package.json');
  const text = fs.readFileSync(manifest, 'utf8'), parsed = jsonc().parse(text);
  const marker = path.join(folder, MARKER), previous = read(marker);
  if (parsed.type === 'module') throw Error('This Codex module format requires a compatible startup adapter.');
  const original = parsed.main === ENTRY ? previous?.original : parsed.main;
  if (typeof original !== 'string' || original === ENTRY) throw Error('Codex startup metadata is unavailable.');
  const target = path.resolve(folder, original);
  if (!target.startsWith(path.resolve(folder) + path.sep) || !fs.existsSync(target)) throw Error('Codex entry module is unavailable.');
  const output = path.join(folder, ENTRY), content = entry(original);
  if (previous && previous.kind !== KIND) throw Error('Codex startup entry is owned by another integration.');
  if (parsed.main !== ENTRY && previous && parsed.main !== previous.original) throw Error('Codex entry changed outside Codex Switch.');
  if (fs.existsSync(output) && !fs.readFileSync(output, 'utf8').includes(KIND)) throw Error('Codex startup filename is already in use.');
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content) write(output, content);
  const record = { kind: KIND, manifest, original, entry: ENTRY, owner: context.extensionPath,
    version: parsed.version, sourceHash: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') };
  write(marker, JSON.stringify(record));
  const registry = path.join(root, 'native-adapters'); fs.mkdirSync(registry, { recursive: true });
  const key = crypto.createHash('sha256').update(manifest).digest('hex');
  write(path.join(registry, key + '.json'), JSON.stringify(record));
  if (parsed.main !== ENTRY) {
    const edits = jsonc().modify(text, ['main'], ENTRY, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
    if (fs.readFileSync(manifest, 'utf8') !== text) throw Error('Codex manifest changed during startup setup.');
    write(manifest, jsonc().applyEdits(text, edits));
  }
}

function restore(root, owner) {
  const ownerKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  let records; try { records = fs.readdirSync(path.join(root, 'native-adapters')); } catch { return; }
  for (const name of records) {
    const file = path.join(root, 'native-adapters', name), record = read(file);
    if (record?.kind !== KIND || ownerKey(record.owner) !== ownerKey(owner)) continue;
    const marker = path.join(path.dirname(record.manifest), MARKER), current = read(marker);
    if (current?.kind !== KIND || ownerKey(current.owner) !== ownerKey(owner)) continue;
    let text; try { text = fs.readFileSync(record.manifest, 'utf8'); } catch { continue; }
    const parsed = jsonc().parse(text);
    if (parsed.main !== ENTRY || parsed.version !== record.version) continue;
    const edits = jsonc().modify(text, ['main'], record.original, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
    if (fs.readFileSync(record.manifest, 'utf8') !== text) continue;
    write(record.manifest, jsonc().applyEdits(text, edits));
    // Keep the inert entry: an already-running workbench can cache main=ENTRY.
  }
}
module.exports = { install, restore, entry, ENTRY };
