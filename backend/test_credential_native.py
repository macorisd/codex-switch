"""Credential protocol regressions; real vault round trips run in test_switcher."""
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import credential_native as native


class FakeBus:
    def __init__(self, dismissed=False):
        self.items, self.calls, self.closed = {}, [], 0
        self.default = '/collection/default'
        self.locked = False
        self.dismissed = dismissed

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed += 1

    @contextmanager
    def filter(self, rule):
        self.rule = rule
        yield []

    def recv_until_filtered(self, _, timeout):
        self.locked = False
        return SimpleNamespace(body=(self.dismissed, ('o', self.default)))

    def send_and_get_reply(self, message, timeout):
        from jeepney import HeaderFields, MessageType
        # Exercise the real bundled marshaller, including all Secret structs.
        message.serialise(serial=1)
        member = message.header.fields[HeaderFields.member]
        path = message.header.fields[HeaderFields.path]
        args = message.body
        self.calls.append((member, args))
        if member == 'OpenSession':
            body = (('s', ''), '/session/1')
        elif member == 'SearchItems':
            matching = [p for p, item in self.items.items() if all(item['attrs'].get(k) == v for k, v in args[0].items())]
            body = ([], matching) if self.locked else (matching, [])
        elif member == 'ReadAlias':
            body = (self.default,)
        elif member == 'CreateCollection':
            self.default = '/collection/new'
            body = (self.default, '/')
        elif member == 'Unlock':
            body = ([], '/prompt/unlock') if self.locked else (args[0], '/')
        elif member == 'GetNameOwner':
            body = (':1.42',)
        elif member in ('AddMatch', 'Prompt'):
            body = ()
        elif member == 'CreateItem':
            properties, secret, replace = args
            attrs = properties[native.LinuxSecretService.ITEM + '.Attributes'][1]
            self.items['/item/' + str(len(self.items))] = {'attrs': attrs, 'value': bytes(secret[2])}
            body = ('/item/new', '/')
        elif member == 'GetSecret':
            body = (('/session/1', b'', self.items[path]['value'], 'text/plain; charset=utf8'),)
        elif member == 'SetSecret':
            self.items[path]['value'] = bytes(args[0][2])
            body = ()
        elif member == 'Delete':
            del self.items[path]
            body = ('/',)
        else:
            raise AssertionError(member)
        return SimpleNamespace(header=SimpleNamespace(message_type=MessageType.method_return), body=body)


class CredentialTests(unittest.TestCase):
    def store(self, bus):
        store = native.LinuxSecretService()
        store.connect = lambda **_: bus
        return store

    def test_bundled_client_needs_no_installed_keyring_and_checks_integrity(self):
        with patch.dict('sys.modules', {'keyring': None, 'secretstorage': None}):
            self.assertTrue(native.LinuxSecretService().connect)
        with patch.object(native, 'VENDOR_SHA256', '0' * 64):
            with self.assertRaises(native.StoreUnavailable):
                native.LinuxSecretService()

    def test_linux_secret_round_trip_updates_and_isolates_provider_identities(self):
        bus = FakeBus()
        store = self.store(bus)
        store.set_password('provider-one', 'api-key', 'fake-one')
        store.set_password('provider-two', 'api-key', 'fake-two')
        self.assertEqual(store.get_password('provider-one', 'api-key'), 'fake-one')
        store.set_password('provider-one', 'api-key', 'fake-updated')
        self.assertEqual(store.get_password('provider-one', 'api-key'), 'fake-updated')
        self.assertEqual(store.get_password('provider-two', 'api-key'), 'fake-two')
        self.assertEqual(len(bus.items), 2)
        store.delete_password('provider-one', 'api-key')
        self.assertIsNone(store.get_password('provider-one', 'api-key'))
        self.assertEqual(bus.closed, 8)

    def test_legacy_python_keyring_item_is_read_and_updated_without_duplication(self):
        bus = FakeBus()
        bus.items['/item/legacy'] = {'attrs': {'service': 'legacy-id', 'username': 'api-key',
            'application': 'Python keyring library'}, 'value': b'old-test-value'}
        store = self.store(bus)
        self.assertEqual(store.get_password('legacy-id', 'api-key'), 'old-test-value')
        store.set_password('legacy-id', 'api-key', 'new-test-value')
        self.assertEqual(store.get_password('legacy-id', 'api-key'), 'new-test-value')
        self.assertEqual(len(bus.items), 1)
        self.assertNotIn('CreateItem', [m for m, _ in bus.calls])

    def test_unlock_prompt_uses_the_vault_owner_and_cancel_never_saves(self):
        for dismissed in (False, True):
            bus = FakeBus(dismissed=dismissed)
            bus.locked = True
            store = self.store(bus)
            if dismissed:
                with self.assertRaises(native.StoreUnavailable):
                    store.set_password('service', 'api-key', 'fake-value')
                self.assertFalse(bus.items)
            else:
                store.set_password('service', 'api-key', 'fake-value')
                self.assertTrue(bus.items)
            self.assertIn("sender=':1.42'", bus.rule.serialise())
            self.assertEqual(bus.closed, 1)

    def test_missing_default_collection_is_created_by_the_native_service(self):
        bus = FakeBus()
        bus.default = '/'
        self.store(bus).set_password('service', 'api-key', 'fake-value')
        self.assertEqual(bus.default, '/collection/new')
        self.assertIn('CreateCollection', [m for m, _ in bus.calls])

    def test_unavailable_vault_never_creates_a_plaintext_key_marker(self):
        import credential_store
        import switcher
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'provider-key.keyring'
            store = self.store(FakeBus())
            store.connect = lambda **_: (_ for _ in ()).throw(OSError('private OS error'))
            with patch.object(credential_store.sys, 'platform', 'linux'), patch.object(credential_store, 'native_store', return_value=store):
                with self.assertRaises(credential_store.StoreUnavailable):
                    switcher.atomic(path, credential_store.save(path, 'fake-value'))
            self.assertFalse(path.exists())
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
