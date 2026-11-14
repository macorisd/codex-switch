"""Workspace isolation, migration and the real platform launch/stdio boundary."""
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import tomllib
import unittest
from unittest.mock import patch

import switcher as s
import api_providers as api
import workspace_state as ws


FAKE = '''import json, sys, tomllib
provider = 'openai'
config_reads = 0
for i, value in enumerate(sys.argv):
    if value == '-c' and sys.argv[i+1].startswith('model_provider='):
        provider = tomllib.loads(sys.argv[i+1])['model_provider']
for raw in sys.stdin.buffer:
    value = json.loads(raw)
    if value.get('method') == 'initialized': continue
    if value.get('method') == 'initialize': result = {'serverInfo': {'name': 'fixture'}}
    elif value.get('method') == 'config/read':
        config_reads += 1
        result = {'config': {'model_provider': provider, 'model': 'fixture-model', 'api_key': 'NEVER_STORE_THIS'}}
    elif value.get('method') == 'fixture/config-read-count': result = config_reads
    elif value.get('method') == 'echo': result = value['params']
    else: result = {}
    print(json.dumps({'id': value['id'], 'result': result}), flush=True)
'''


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='codex workspace Ã± ')
        self.root = Path(self.tmp.name)
        self.patch = patch.multiple(s, ROOT=self.root / 'provider-switcher',
            CONFIG=self.root / 'config.toml', CATALOG=self.root / 'provider-switcher/deepseek-models.json',
            KEY=self.root / 'provider-switcher/deepseek-key.dpapi',
            STATE=self.root / 'provider-switcher/previous-settings.json')
        self.patch.start()
        s.initialize()
        s.CONFIG.write_text('model="gpt-6.1-sol"\nmodel_provider="openai"\n[desktop]\nsetting="preserved"\n', encoding='utf-8')
        ws.use('a' * 64)
        self.fixture = self.root / 'fake cli.py'
        self.fixture.write_text(FAKE, encoding='utf-8')
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=10)
        ws.use(None)
        self.patch.stop()
        self.tmp.cleanup()

    def prepare(self, nonce='a' * 32):
        return ws.prepare({'window': nonce, 'command': sys.executable, 'configuredCommand': None,
                           'ownerPid': os.getpid(), 'cwd': str(self.root)})

    def ordinary(self, state=None):
        prepared = self.prepare()
        record = json.loads((s.ROOT / 'recovery.json').read_text())
        record['command'] = sys.executable
        s.atomic(s.ROOT / 'recovery.json', json.dumps(record))
        owner = s.ROOT / 'owners' / (str(os.getpid()) + '.json')
        if state:
            value = json.loads(owner.read_text())
            value['state'] = state
            s.atomic(owner, json.dumps(value))
        else:
            owner.unlink()
        env = {**os.environ, 'CODEX_SWITCH_BINDING': str(self.root / 'stale-binding.json')}
        return prepared, env, owner

    def test_unbound_launcher_works_without_python_helper_or_extension_sources(self):
        prepared, env, _ = self.ordinary()
        (s.ROOT / 'window_launcher.py').unlink()
        # The fallback executable happens to be Python as a harmless fixture.
        # The connector's Python path and instrumentation have been removed.
        result = subprocess.run([prepared['launcher'], '-c', 'print("ordinary codex")'],
            env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'ordinary codex')

    def test_failed_owned_activation_does_not_silently_run_ordinary_codex(self):
        prepared, env, _ = self.ordinary('error')
        result = subprocess.run([prepared['launcher'], '-c', 'print("wrong provider")'],
            env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn('wrong provider', result.stdout)

    def test_registered_slow_activation_keeps_its_workspace_provider(self):
        s.atomic(ws.directory() / 'selection.json', json.dumps({'provider': 'fixture-api', 'model': 'fixture-model'}))
        _, _, _, state = self.client(preparing=True)
        self.assertEqual(state['provider'], 'fixture-api')

    def test_upgrade_imports_only_a_matching_accepted_api_model_with_a_saved_binding(self):
        import model_defaults
        prepared = self.prepare()
        (s.ROOT / 'legacy-model-recovery.json').unlink()
        binding_path = Path(prepared['binding'])
        binding = json.loads(binding_path.read_text())
        binding['provider'] = 'deepseek'
        s.atomic(binding_path, json.dumps(binding))
        s.atomic(ws.directory() / 'selection.json', json.dumps({'provider': 'deepseek',
            'chatgpt': {'model': '"gpt-6.1-sol"'}, 'model': 'deepseek-flash'}))
        s.atomic(ws.directory() / 'native-model.json', json.dumps({'provider': 'deepseek',
            'model': 'deepseek-flash', 'nonce': 'a' * 32, 'sequence': 1, 'effort': 'high'}))
        s.CONFIG.write_text('model="deepseek-flash"\nmodel_reasoning_effort="low"\n')
        model_defaults.import_legacy()
        journal = json.loads((s.ROOT / 'model-defaults.json').read_text())
        self.assertEqual(len(journal['edits']), 1)
        self.assertEqual(journal['edits'][0]['before'], 'model = "gpt-6.1-sol"' + os.linesep)
        self.assertEqual(journal['edits'][0]['after'], 'model="deepseek-flash"' + os.linesep)

    def test_inactive_owner_delegates_to_original_custom_cli(self):
        prepared, env, _ = self.ordinary('inactive')
        result = subprocess.run([prepared['launcher'], '-c', 'print("custom codex")'],
            env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'custom codex')

    def test_model_journal_keeps_initial_default_across_api_windows_and_disowns_user_edits(self):
        import model_defaults
        prepared = self.prepare()
        binding = json.loads(Path(prepared['binding']).read_text())
        binding['provider'] = 'deepseek'
        params = {'edits': [{'keyPath': 'model', 'value': 'api-first'}]}
        first = model_defaults.capture(binding, params)
        s.CONFIG.write_text('model="api-first"\nmodel_provider="openai"\n[desktop]\nsetting="preserved"\n')
        model_defaults.accepted(binding, first)
        params['edits'][0]['value'] = 'api-second'
        second = model_defaults.capture(binding, params)
        s.CONFIG.write_text(s.CONFIG.read_text().replace('api-first', 'api-second'))
        model_defaults.accepted(binding, second)
        journal = json.loads((s.ROOT / 'model-defaults.json').read_text())
        self.assertEqual(journal['edits'][0]['before'], 'model="gpt-6.1-sol"' + os.linesep)
        self.assertEqual(journal['edits'][0]['after'], 'model="api-second"' + os.linesep)
        # A user edit between requests becomes the new restoration baseline.
        s.CONFIG.write_text(s.CONFIG.read_text().replace('api-second', 'user-model'))
        third = model_defaults.capture(binding, params)
        s.CONFIG.write_text(s.CONFIG.read_text().replace('user-model', 'api-second'))
        model_defaults.accepted(binding, third)
        journal = json.loads((s.ROOT / 'model-defaults.json').read_text())
        self.assertEqual(journal['edits'][0]['before'], 'model="user-model"' + os.linesep)

    def test_native_journal_preserves_bom_crlf_and_existing_quoted_profile_keys(self):
        import model_defaults
        prepared = self.prepare()
        binding = json.loads(Path(prepared['binding']).read_text())
        binding.update(provider='deepseek', profile='work.team')
        text = '\ufeffprofile = "work.team"\r\n[ profiles . "work.team" ]\r\n\'model\' = "gpt-profile"\r\n'
        s.CONFIG.write_bytes(text.encode('utf-8'))
        params = {'edits': [{'keyPath': 'profiles."work.team".model', 'value': 'api-model'}]}
        captured = model_defaults.capture(binding, params)
        s.CONFIG.write_bytes(text.replace('gpt-profile', 'api-model').encode('utf-8'))
        model_defaults.accepted(binding, captured)
        journal = json.loads((s.ROOT / 'model-defaults.json').read_text())
        self.assertEqual(journal['edits'][0]['table'], ' profiles . "work.team" ')
        self.assertEqual(journal['edits'][0]['before'], '\'model\' = "gpt-profile"\r\n')
        self.assertEqual(journal['edits'][0]['after'], '\'model\' = "api-model"\r\n')

    def test_node_and_python_lifecycle_updates_are_serialized_across_processes(self):
        import model_defaults
        counter = s.ROOT / 'counter.json'
        code = '''const r = require(process.argv[1]), path = require('node:path');
        (async () => { for (let i=0; i<3; i++) await r.locked(process.argv[2], async () => {
          const file=path.join(process.argv[2], 'counter.json'), value=r.read(file, {value:0}).value;
          await new Promise(resolve => setTimeout(resolve, 10)); r.atomic(file, {value:value+1});
        }); })().catch(() => {process.exitCode=1});'''
        children = [subprocess.Popen([shutil.which('node'), '-e', code,
            str(s.SOURCE.parent / 'recovery.js'), str(s.ROOT)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            for _ in range(2)]
        self.children.extend(children)
        for _ in range(3):
            with model_defaults.lock(s.ROOT):
                value = json.loads(counter.read_text())['value'] if counter.exists() else 0
                time.sleep(.01)
                s.atomic(counter, json.dumps({'value': value + 1}))
        for child in children:
            _, stderr = child.communicate(timeout=60)
            self.assertEqual(child.returncode, 0, stderr.decode())
        self.assertEqual(json.loads(counter.read_text())['value'], 9)

    def test_native_formatter_updates_guards_after_rewriting_shared_line_endings(self):
        import model_defaults
        prepared = self.prepare()
        binding = json.loads(Path(prepared['binding']).read_text())
        binding['provider'] = 'deepseek'
        s.CONFIG.write_bytes(b'model="gpt-model"\r\nmodel_provider="openai"\r\n')
        captured = model_defaults.capture(binding, {'keyPath': 'model', 'value': 'api-model'})
        s.CONFIG.write_bytes(b'model = "api-model"\nmodel_provider = "openai"\n')
        model_defaults.accepted(binding, captured)
        journal = json.loads((s.ROOT / 'model-defaults.json').read_text())
        guard = next(g for g in journal['edits'][0]['guards'] if g['key'] == 'model_provider')
        self.assertEqual(guard['line'], 'model_provider = "openai"\n')
        subprocess.run([shutil.which('node'), '-e', 'require(process.argv[1]).restoreModels(process.argv[2])',
            str(s.SOURCE.parent / 'recovery.js'), str(s.ROOT)], check=True, timeout=15)
        self.assertEqual(tomllib.loads(s.CONFIG.read_text())['model'], 'gpt-model')

    def client(self, nonce='a' * 32, provider=None, early=False, send_initialized=True, initialize_id=1, preparing=False):
        prepared = self.prepare(nonce)
        binding = Path(prepared['binding'])
        spec = json.loads(binding.read_text())
        spec['args'].insert(0, str(self.fixture))
        if provider:
            spec['args'] += ['-c', 'model_provider=' + json.dumps(provider)]
        s.atomic(binding, json.dumps(spec))
        if preparing:
            owner = s.ROOT / 'owners' / (str(os.getpid()) + '.json')
            record = json.loads(owner.read_text())
            s.atomic(owner, json.dumps({**record, 'state': 'preparing'}))
            threading.Timer(.6, lambda: s.atomic(owner, json.dumps(record))).start()
        env = {**os.environ, 'CODEX_SWITCH_BINDING': str(binding)}
        if early:
            env.pop('CODEX_SWITCH_BINDING', None)
        child = subprocess.Popen([prepared['launcher'], 'app-server', '--fixture', 'space Ã± \\ tail'],
            env=env, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=self.root)
        self.children.append(child)
        messages = queue.Queue()
        def read():
            for raw in child.stdout:
                messages.put(json.loads(raw))
        threading.Thread(target=read, daemon=True).start()
        def send(value):
            child.stdin.write((json.dumps(value) + '\n').encode())
            child.stdin.flush()
        send({'id': initialize_id, 'method': 'initialize', 'params': {}})
        self.assertEqual(messages.get(timeout=15)['id'], initialize_id)
        if send_initialized:
            send({'method': 'initialized'})
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            state = ws.status(nonce)
            if state['phase'] in ('verified', 'mismatch'):
                return child, messages, send, state
            time.sleep(.02)
        self.fail('The launched client did not confirm its configuration: ' + str(state))

    def test_two_live_clients_pin_different_workspace_providers_and_reopen(self):
        original = s.CONFIG.read_bytes()
        a, _, send_a, first = self.client()
        self.assertTrue(first['verified'])
        ws.use('b' * 64)
        # Custom fixture provider uses an existing table, without real keys.
        s.atomic(ws.directory() / 'selection.json', json.dumps({'provider': 'fixture-api', 'model': 'fixture-model'}))
        b, _, _, second = self.client('b' * 32)
        self.assertEqual(second['provider'], 'fixture-api')
        ws.choose('openai')
        self.assertTrue(ws.status('b' * 32)['reloadRequired'])
        ws.use('a' * 64)
        self.assertEqual(ws.status('a' * 32)['provider'], 'openai')
        self.assertFalse(ws.status('a' * 32)['reloadRequired'])
        # Reopening A reuses its saved preference, with a fresh runtime receipt.
        _, _, _, reopened = self.client('c' * 32)
        self.assertEqual(reopened['provider'], 'openai')
        self.assertEqual(s.CONFIG.read_bytes(), original)
        self.assertIsNone(a.poll()); self.assertIsNone(b.poll())

    def test_private_confirmation_never_leaks_into_client_protocol_or_receipt(self):
        child, messages, send, state = self.client()
        payload = {'text': 'Ã¡ \\ "\n', 'tool': {'result': [False, None, 1]}, 'padding': 'x' * 80000}
        send({'id': 'client-config-id', 'method': 'echo', 'params': payload})
        self.assertEqual(messages.get(timeout=10), {'id': 'client-config-id', 'result': payload})
        receipt = (ws.window_directory('a' * 32) / 'runtime.json').read_text()
        self.assertNotIn('NEVER_STORE_THIS', receipt)
        self.assertEqual(state['provider'], 'openai')

    def test_official_ide_handshake_confirms_without_initialized_notification(self):
        _, messages, send, state = self.client(send_initialized=False, initialize_id='1')
        self.assertTrue(state['verified'])
        # A later optional notification must not issue another private request.
        send({'method': 'initialized'})
        send({'id': 'count', 'method': 'fixture/config-read-count'})
        self.assertEqual(messages.get(timeout=5), {'id': 'count', 'result': 1})
        send({'id': 'after-startup', 'method': 'echo', 'params': {'ready': True}})
        self.assertEqual(messages.get(timeout=5), {'id': 'after-startup', 'result': {'ready': True}})

    def test_mismatch_and_other_window_receipts_cannot_be_reported_active(self):
        _, _, _, state = self.client(provider='different')
        self.assertFalse(state['verified']); self.assertIsNone(state['provider'])
        ws.use('b' * 64)
        self.assertIsNone(ws.status('a' * 32)['provider'])
        self.assertEqual(ws.status('a' * 32)['phase'], 'unconfirmed')

    def test_terminating_bootstrap_closes_descendant_pipes(self):
        child, _, _, _ = self.client()
        child.kill(); child.wait(timeout=10)
        # On Windows the bootstrap job kills both Python and app-server; on Unix
        # tests terminate the Python launcher, whose parent-death path owns child.
        if sys.platform == 'win32':
            self.assertEqual(child.stderr.read(), b'')
        self.assertFalse(ws.status('a' * 32)['verified'])

    def test_restored_codex_view_can_bind_its_own_parent_before_environment_setup(self):
        _, _, _, state = self.client(early=True)
        self.assertTrue(state['verified'])
        self.assertEqual(state['provider'], 'openai')

    def test_custom_cli_is_preserved_and_bundled_recovery_is_explicit(self):
        self.prepare()
        request = {'window': 'b' * 32, 'command': sys.executable,
                   'configuredCommand': str(self.root / 'missing-custom-cli'),
                   'ownerPid': os.getpid(), 'cwd': str(self.root)}
        with self.assertRaises(ValueError): ws.prepare(request)
        request.update(configuredCommand=None, resetCommand=True)
        prepared = ws.prepare(request)
        self.assertEqual(json.loads(Path(prepared['binding']).read_text())['command'], sys.executable)

    def test_model_preferences_are_isolated_while_account_metadata_is_shared(self):
        data = {'models': [{'id': 'first', 'efforts': []}, {'id': 'second', 'efforts': []}],
                'model': 'first', 'effort': '', 'validatedAt': 'fixture', 'tested': {'model': 'first', 'effort': ''}}
        s.atomic(api.cache_path('openrouter'), json.dumps(data))
        api.select('openrouter', 'second', '')
        self.assertIsNone(api.saved('openrouter').get('tested'))
        ws.use('b' * 64)
        self.assertEqual(api.saved('openrouter')['model'], 'first')
        api.select('openrouter', 'first', '')
        ws.use('a' * 64)
        self.assertEqual(api.saved('openrouter')['model'], 'second')
        self.assertEqual(api.saved('openrouter')['validatedAt'], 'fixture')

    def test_another_workspace_cannot_reuse_a_model_test_after_credentials_change(self):
        data = {'model': 'model', 'effort': '', 'validatedAt': 'fixture', 'credentialRevision': 'old',
                'tested': {'model': 'model', 'effort': ''}}
        api.persist('openrouter', data)
        ws.use('b' * 64)
        api.persist('openrouter', {**api.saved('openrouter'), 'credentialRevision': 'new', 'tested': None})
        ws.use('a' * 64)
        self.assertIsNone(api.saved('openrouter').get('tested'))

    def test_returning_to_chatgpt_restores_that_workspaces_own_model_snapshot(self):
        original = ws.initial_preference()
        with patch.object(api, 'state', return_value={'valid': True}), \
             patch.object(api, 'saved', return_value={'model': 'deepseek-flash', 'effort': 'high'}), \
             patch.object(api, 'select', return_value={}):
            ws.choose('deepseek')
        s.CONFIG.write_text('model="another-workspaces-model"\nmodel_provider="openai"\n', encoding='utf-8')
        restored = ws.choose('openai')
        self.assertEqual(restored['model'], original['model'])

    def test_legacy_migration_preserves_auth_unrelated_toml_and_backup(self):
        original = s.CONFIG.read_text()
        s.atomic(s.STATE, json.dumps(s.captured_values(original)))
        s.atomic(s.CONFIG, s.rewrite(original, {'model_provider': '"deepseek"', 'model': '"deepseek-flash"',
            'model_catalog_json': json.dumps(str(s.CATALOG))}, True))
        legacy = s.CONFIG.read_bytes()
        auth = self.root / 'auth.json'; auth.write_bytes(b'private-auth-fixture')
        self.prepare()
        self.assertEqual(ws.preference()['provider'], 'deepseek')
        migrated = tomllib.loads(s.CONFIG.read_text())
        self.assertEqual(migrated['model_provider'], 'openai')
        self.assertNotIn('model_catalog_json', migrated)
        self.assertEqual(migrated['desktop']['setting'], 'preserved')
        self.assertEqual(auth.read_bytes(), b'private-auth-fixture')
        self.assertTrue(any(p.read_bytes() == legacy for p in s.ROOT.glob('config-*.bak')))

    def test_native_model_acknowledgements_persist_and_ignore_other_provider_threads(self):
        from window_launcher import ModelChanges
        self.prepare()
        selected = ws.preference()
        binding = {'provider': 'openai', 'nonce': 'a'*32, 'revision': ws.revision(selected)}
        events = []
        changes = ModelChanges(binding, events.append)
        def write(i, model):
            changes.request({'id': i, 'method': 'config/batchWrite', 'params': {'edits': [
                {'keyPath': 'model', 'value': model}, {'keyPath': 'model_reasoning_effort', 'value': 'high'}]}})
        write(1, 'rejected-model')
        changes.response({'id': 1, 'error': {'code': -1}})
        self.assertEqual(events, [])
        write(2, 'gpt-native-choice')
        changes.response({'id': 2, 'result': {'status': 'okOverridden'}})
        s.atomic(ws.directory()/'native-model.json', json.dumps(events[-1]))
        ws.adopt_native()
        self.assertEqual(ws.preference()['model'], 'gpt-native-choice')
        self.assertIn('model=\"gpt-native-choice\"', ws.arguments(ws.preference()))
        changes.request({'id': 3, 'method': 'thread/read', 'params': {'threadId': 'old'}})
        changes.response({'id': 3, 'result': {'thread': {'id': 'old', 'modelProvider': 'deepseek'}}})
        changes.request({'id': 4, 'method': 'thread/settings/update', 'params': {'threadId': 'old', 'model': 'deepseek-flash'}})
        changes.response({'id': 4, 'result': {}})
        self.assertEqual(len(events), 1)
        changes.request({'id': 5, 'method': 'thread/read', 'params': {'threadId': 'current'}})
        changes.response({'id': 5, 'result': {'thread': {'id': 'current', 'modelProvider': 'openai'}}})
        changes.request({'id': 6, 'method': 'thread/settings/update', 'params': {'threadId': 'current', 'model': 'gpt-second'}})
        changes.response({'id': 6, 'result': {}})
        self.assertEqual(events[-1]['model'], 'gpt-second')
        ws.use('b'*64); ws.initial_preference()
        self.assertNotEqual(ws.preference()['model'], 'gpt-native-choice')

    def test_invalid_id_cannot_escape_local_storage(self):
        for value in ('../project', '', 'A' * 64):
            with self.assertRaises(ValueError): ws.use(value)


if __name__ == '__main__':
    unittest.main()
