'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const env = { ...process.env };
// A test launched by a Codex tool inherits its window's private broker and
// ownership markers. Never let fixture credentials reach a user's real vault.
for (const key of Object.keys(env)) {
  if (key.startsWith('CODEX_SWITCH_') || ['OPENAI_API_KEY', 'CODEX_API_KEY', 'DEEPSEEK_API_KEY'].includes(key)) delete env[key];
}
delete env.ELECTRON_RUN_AS_NODE;
const tests = [
  // Several integration files start native interpreters and OS identity probes.
  // Bound process fan-out on cold/emulated Windows ARM runners.
  [process.execPath, '--test', '--test-concurrency=2', ...fs.readdirSync('test').filter(file => file.endsWith('.test.js')).map(file => 'test/' + file)],
  ...['test_switcher.py', 'test_api_providers.py', 'test_usage_metrics.py', 'test_workspace.py'].map(file => ['python', '-S', 'backend/' + file]),
  ['python', '-S', '-m', 'unittest', 'discover', '-s', 'backend', '-p', 'test_credential*.py'],
  ['python', '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_*.py'],
];
for (const [command, ...args] of tests) {
  const result = spawnSync(command, args, { env, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) { process.exitCode = result.status || 1; break; }
}
