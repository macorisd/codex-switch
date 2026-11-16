'use strict';
// The official extension and this workspace extension share their host. Scope
// interception to its IDE app-server call; never write the application-wide CLI
// setting, whose paths cannot represent Windows and SSH hosts simultaneously.
const childProcess = require('node:child_process');
const path = require('node:path');

function install(binding, extensionPath, api = childProcess) {
  const original = api.spawn;
  let active = true;
  let attached;
  function spawn(command, args, options) {
    if (!active || !Array.isArray(args) || !args.includes('app-server') ||
        options?.env?.CODEX_INTERNAL_ORIGINATOR_OVERRIDE !== 'codex_vscode') {
      return Reflect.apply(original, this, arguments);
    }
    return Reflect.apply(original, this, [process.execPath, [path.join(extensionPath, 'window-entry.js'), ...args], {
      ...options, env: { ...options.env, ELECTRON_RUN_AS_NODE: '1', CODEX_SWITCH_BINDING: binding,
        CODEX_SWITCH_OWNER: String(process.pid), CODEX_SWITCH_EXECUTABLE: command },
    }]);
  }
  api.spawn = spawn;
  return {
    async attachExisting(request) { attached = await require('./live-client').attachExisting(binding, request); },
    dispose() { active = false; attached?.release(); if (api.spawn === spawn) api.spawn = original; },
  };
}
module.exports = { install };
