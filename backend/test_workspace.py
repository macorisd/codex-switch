"""Workspace isolation, migration and the real platform launch/stdio boundary."""
import json
import os
from pathlib import Path
import queue
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
for i, value in enumerate(sys.argv):
    if value == '-c' and sys.argv[i+1].startswith('model_provider='):
        provider = tomllib.loads(sys.argv[i+1])['model_provider']
for raw in sys.stdin.buffer:
    value = json.loads(raw)
    if value.get('method') == 'initialized': continue
    if value.get('method') == 'initialize': result = {'serverInfo': {'name': 'fixture'}}
    elif value.get('method') == 'config/read': result = {'config': {'model_provider': provider, 'model': 'fixture-model', 'api_key': 'NEVER_STORE_THIS'}}
    elif value.get('method') == 'echo': result = value['params']
    else: result = {}
    print(json.dumps({'id': value['id'], 'result': result}), flush=True)
'''


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='codex workspace ñ ')
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

    def client(self, nonce='a' * 32, provider=None, early=False):
        prepared = self.prepare(nonce)
        binding = Path(prepared['binding'])
        spec = json.loads(binding.read_text())
        spec['args'].insert(0, str(self.fixture))
        if provider:
            spec['args'] += ['-c', 'model_provider=' + json.dumps(provider)]
        s.atomic(binding, json.dumps(spec))
        env = {**os.environ, 'CODEX_SWITCH_BINDING': str(binding)}
        if early:
            env.pop('CODEX_SWITCH_BINDING', None)
        child = subprocess.Popen([prepared['launcher'], 'app-server', '--fixture', 'space ñ \\ tail'],
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
        send({'id': 1, 'method': 'initialize', 'params': {}})
        self.assertEqual(messages.get(timeout=15)['id'], 1)
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
        payload = {'text': 'á \\ "\n', 'tool': {'result': [False, None, 1]}, 'padding': 'x' * 80000}
        send({'id': 'client-config-id', 'method': 'echo', 'params': payload})
        self.assertEqual(messages.get(timeout=10), {'id': 'client-config-id', 'result': payload})
        receipt = (ws.window_directory('a' * 32) / 'runtime.json').read_text()
        self.assertNotIn('NEVER_STORE_THIS', receipt)
        self.assertEqual(state['provider'], 'openai')

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

    def test_invalid_id_cannot_escape_local_storage(self):
        for value in ('../project', '', 'A' * 64):
            with self.assertRaises(ValueError): ws.use(value)


if __name__ == '__main__':
    unittest.main()
