'use strict';
const { managed } = require('./recovery');

const normalized = value => value.replaceAll('\\', '/');
const directory = value => normalized(value).slice(0, normalized(value).lastIndexOf('/'));
const sameDirectory = (a, b) => /^[A-Za-z]:/.test(a)
  ? directory(a).toLowerCase() === directory(b).toLowerCase() : directory(a) === directory(b);

async function previousSetting(vscode, launcher) {
  if (!managed(launcher) || !vscode.workspace.fs || !vscode.Uri?.from) return null;
  // vscode-userdata is served by the client file service, including from a
  // remote extension host. Read only our small recovery records beside the
  // exact managed selector, never account files or arbitrary settings content.
  const folder = directory(launcher);
  const read = async name => {
    try {
      const file = folder + '/' + name;
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.from({
        scheme: 'vscode-userdata', path: file.startsWith('/') ? file : '/' + file,
      }));
      if (bytes.length > 65536) return null;
      return JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch { return null; }
  };
  const record = await read('recovery.json');
  if (record?.launcher && (!managed(record.launcher) || !sameDirectory(launcher, record.launcher))) return null;
  let original, hadOriginal;
  if (typeof record?.hadOriginal === 'boolean') {
    ({ original, hadOriginal } = record);
    if (hadOriginal && original === undefined) return null;
  } else {
    const legacy = await read('original-cli.json');
    if (!legacy || Array.isArray(legacy) || typeof legacy !== 'object') return null;
    original = legacy.command;
    hadOriginal = original !== undefined;
  }
  if (original != null && typeof original !== 'string' || managed(original)) return null;
  return { original, hadOriginal };
}
module.exports = { previousSetting };
