'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const recovery = require('../recovery');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex recovery '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('conditional settings cleanup preserves JSON comments, other edits, custom CLI and absence', t => {
  const root = fixture(t), settings = path.join(root, 'settings.json');
  const launcher = path.join(root, 'provider-switcher', 'codex-window-123456789abc.exe');
  const prefix = '{\n  // Keep this comment\n  "editor.fontSize": 17,\n';
  fs.writeFileSync(settings, prefix + `  "chatgpt.cliExecutable": ${JSON.stringify(launcher)},\n}\n`);
  recovery.restoreSettings({ settings, launcher, hadOriginal: true, original: '/custom codex' });
  assert.match(fs.readFileSync(settings, 'utf8'), /Keep this comment/);
  assert.match(fs.readFileSync(settings, 'utf8'), /"editor.fontSize": 17/);
  assert.match(fs.readFileSync(settings, 'utf8'), /custom codex/);
  // A later user choice remains authoritative.
  recovery.restoreSettings({ settings, launcher, hadOriginal: false });
  assert.match(fs.readFileSync(settings, 'utf8'), /custom codex/);
  fs.writeFileSync(settings, JSON.stringify({ 'chatgpt.cliExecutable': launcher, other: 1 }));
  recovery.restoreSettings({ settings, launcher, hadOriginal: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(settings)), { other: 1 });
  fs.writeFileSync(settings, JSON.stringify({ 'chatgpt.cliExecutable': launcher }));
  recovery.restoreSettings({ settings, launcher, hadOriginal: true, original: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(settings)), { 'chatgpt.cliExecutable': null });
});

test('default and named profiles resolve the same application settings file', () => {
  const context = value => ({ globalStorageUri: { fsPath: path.join('/data/User', value, 'globalStorage', 'macor-local.codex-provider-switch') } });
  assert.equal(recovery.settingsPath(context('')), path.join('/data/User', 'settings.json'));
  assert.equal(recovery.settingsPath(context('profiles/work')), path.join('/data/User', 'settings.json'));
});

test('stale locks recover and simultaneous lifecycle updates are serialized', async t => {
  const root = fixture(t), sequence = [];
  recovery.atomic(path.join(root, 'lifecycle-lock', '2147483647-stale.json'), { pid: 2147483647 });
  await Promise.all([recovery.locked(root, async () => {
    sequence.push('a'); await new Promise(resolve => setTimeout(resolve, 80)); sequence.push('b');
  }), recovery.locked(root, () => sequence.push('c'))]);
  assert.deepEqual(sequence, ['a', 'b', 'c']);
});

test('model restoration changes only still-owned scalar lines in their original table', t => {
  const root = fixture(t), config = path.join(root, 'config.toml');
  const text = 'model = "api-model"\nmodel_reasoning_effort = "low"\n# user note\n[profiles.work]\nmodel = "external-choice"\n';
  fs.writeFileSync(config, text);
  recovery.atomic(path.join(root, 'model-defaults.json'), { config, edits: [
    { table: '', key: 'model', before: 'model = "gpt-model"\n', after: 'model = "api-model"\n' },
    { table: '', key: 'model_reasoning_effort', before: null, after: 'model_reasoning_effort = "low"\n' },
    { table: 'profiles.work', key: 'model', before: 'model = "old"\n', after: 'model = "api-choice"\n' },
  ] });
  recovery.restoreModels(root);
  assert.equal(fs.readFileSync(config, 'utf8'), 'model = "gpt-model"\n# user note\n[profiles.work]\nmodel = "external-choice"\n');
});

test('changing the global provider invalidates model-restoration ownership', t => {
  const root = fixture(t), config = path.join(root, 'config.toml');
  const text = 'model_provider = "deepseek"\nmodel = "api-model"\n';
  fs.writeFileSync(config, text);
  recovery.atomic(path.join(root, 'model-defaults.json'), { config, edits: [
    { table: '', before: 'model = "gpt-model"\n', after: 'model = "api-model"\n',
      guards: [{ table: '', key: 'model_provider', line: null }] },
  ] });
  recovery.restoreModels(root);
  assert.equal(fs.readFileSync(config, 'utf8'), text);
});

test('uninstall hook cleans its owned setting and preserves a newer installation', async t => {
  const root = fixture(t), home = fixture(t);
  t.mock.method(os, 'homedir', () => home);
  const settings = path.join(root, 'settings.json');
  const launcher = path.join(root, 'provider-switcher', 'codex-window');
  const extensionPath = path.join(root, 'extension-0.5.1');
  fs.writeFileSync(settings, JSON.stringify({ 'chatgpt.cliExecutable': launcher, preserved: 3 }));
  recovery.register(extensionPath, root);
  recovery.atomic(path.join(root, 'recovery.json'), { settings, launcher, extensionPath, hadOriginal: false });
  await recovery.uninstall(extensionPath);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings)), { preserved: 3 });
  recovery.register(extensionPath, root);
  recovery.atomic(path.join(root, 'recovery.json'), { settings, launcher, extensionPath: 'newer-installation', hadOriginal: false });
  fs.writeFileSync(settings, JSON.stringify({ 'chatgpt.cliExecutable': launcher }));
  await recovery.uninstall(extensionPath);
  assert.equal(JSON.parse(fs.readFileSync(settings))['chatgpt.cliExecutable'], launcher);
});

test('multiline TOML content cannot impersonate model defaults', t => {
  const root = fixture(t), config = path.join(root, 'config.toml');
  const prefix = 'instructions = """\nmodel = "api-model"\n[profiles.fake]\n"""\n';
  fs.writeFileSync(config, prefix + 'model = "api-model"\n');
  recovery.atomic(path.join(root, 'model-defaults.json'), { config, edits: [
    { table: '', key: 'model', before: 'model = "original"\n', after: 'model = "api-model"\n' },
  ] });
  recovery.restoreModels(root);
  assert.equal(fs.readFileSync(config, 'utf8'), prefix + 'model = "original"\n');
});

test('BOM, CRLF, quoted model keys and spaced profile headers survive recovery', t => {
  const root = fixture(t), config = path.join(root, 'config.toml');
  const prefix = '\uFEFFprofile = "work.team"\r\n[ profiles . "work.team" ]\r\n';
  fs.writeFileSync(config, prefix + "'model' = 'api-model'\r\n");
  recovery.atomic(path.join(root, 'model-defaults.json'), { config, edits: [
    { table: ' profiles . "work.team" ', key: 'model', before: "'model' = 'gpt-model'\r\n", after: "'model' = 'api-model'\r\n" },
  ] });
  recovery.restoreModels(root);
  assert.equal(fs.readFileSync(config, 'utf8'), prefix + "'model' = 'gpt-model'\r\n");
});
