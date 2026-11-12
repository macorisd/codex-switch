"""Native desktop vaults, with no installed Python packages or shell secrets."""
from contextlib import contextmanager
import ctypes as c
import hashlib
from pathlib import Path
import sys

VENDOR_NAME = 'jeepney-0.9.0-py3-none-any.whl'
VENDOR_SHA256 = '97e5714520c16fc0a45695e5365a2e11b81ea79bba796e26f9f1d178cb182683'


class StoreUnavailable(RuntimeError):
    pass


class MacKeychain:
    """Generic-password items compatible with the previous keyring backend."""
    def __init__(self):
        self.sec = c.CDLL('/System/Library/Frameworks/Security.framework/Security')
        self.cf = c.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
        signatures = [
            (self.cf, 'CFStringCreateWithCString', c.c_void_p, [c.c_void_p, c.c_char_p, c.c_uint32]),
            (self.cf, 'CFDataCreate', c.c_void_p, [c.c_void_p, c.c_void_p, c.c_ssize_t]),
            (self.cf, 'CFDictionaryCreate', c.c_void_p, [c.c_void_p, c.c_void_p, c.c_void_p, c.c_ssize_t, c.c_void_p, c.c_void_p]),
            (self.cf, 'CFDataGetLength', c.c_ssize_t, [c.c_void_p]),
            (self.cf, 'CFDataGetBytePtr', c.c_void_p, [c.c_void_p]),
            (self.cf, 'CFRelease', None, [c.c_void_p]),
            (self.sec, 'SecItemCopyMatching', c.c_int32, [c.c_void_p, c.c_void_p]),
            (self.sec, 'SecItemAdd', c.c_int32, [c.c_void_p, c.c_void_p]),
            (self.sec, 'SecItemUpdate', c.c_int32, [c.c_void_p, c.c_void_p]),
            (self.sec, 'SecItemDelete', c.c_int32, [c.c_void_p]),
        ]
        for library, name, result, args in signatures:
            function = getattr(library, name)
            function.restype, function.argtypes = result, args

    def constant(self, name):
        return c.c_void_p.in_dll(self.cf if name.startswith('kCF') else self.sec, name)

    @contextmanager
    def query(self, values):
        owned, keys, refs = [], [], []
        dictionary = None
        try:
            for key, value in values.items():
                keys.append(self.constant(key))
                if isinstance(value, str):
                    value = self.cf.CFStringCreateWithCString(None, value.encode('utf-8'), 0x08000100)
                    owned.append(value)
                elif isinstance(value, bytes):
                    value = self.cf.CFDataCreate(None, value, len(value))
                    owned.append(value)
                if not value:
                    raise StoreUnavailable('Keychain query could not be created.')
                refs.append(value)
            # Values are owned until the synchronous Security call completes.
            # Null callbacks avoid retaining/releasing these references twice.
            dictionary = self.cf.CFDictionaryCreate(None, (c.c_void_p * len(keys))(*keys),
                (c.c_void_p * len(refs))(*refs), len(keys), None, None)
            if not dictionary:
                raise StoreUnavailable('Keychain query could not be created.')
            yield dictionary
        finally:
            if dictionary:
                self.cf.CFRelease(dictionary)
            for value in owned:
                if value:
                    self.cf.CFRelease(value)

    def identity(self, service, account):
        return {'kSecClass': self.constant('kSecClassGenericPassword'),
                'kSecAttrService': service, 'kSecAttrAccount': account}

    @staticmethod
    def check(status):
        if status != 0:
            raise StoreUnavailable('Keychain access was denied or the keychain is locked.')

    def get_password(self, service, account):
        result = c.c_void_p()
        with self.query({**self.identity(service, account),
                        'kSecReturnData': self.constant('kCFBooleanTrue'),
                        'kSecMatchLimit': self.constant('kSecMatchLimitOne')}) as query:
            status = self.sec.SecItemCopyMatching(query, c.byref(result))
        if status == -25300:
            return None
        self.check(status)
        try:
            return c.string_at(self.cf.CFDataGetBytePtr(result), self.cf.CFDataGetLength(result)).decode('utf-8')
        finally:
            if result:
                self.cf.CFRelease(result)

    def set_password(self, service, account, value):
        identity = self.identity(service, account)
        data = {'kSecValueData': value.encode('utf-8')}
        with self.query(identity) as query, self.query(data) as attributes:
            status = self.sec.SecItemUpdate(query, attributes)
        if status == -25300:
            with self.query({**identity, **data}) as query:
                status = self.sec.SecItemAdd(query, None)
            if status == -25299:  # Another instance created the same item.
                with self.query(identity) as query, self.query(data) as attributes:
                    status = self.sec.SecItemUpdate(query, attributes)
        self.check(status)

    def delete_password(self, service, account):
        with self.query(self.identity(service, account)) as query:
            status = self.sec.SecItemDelete(query)
        if status != -25300:
            self.check(status)


class LinuxSecretService:
    """Use the session's native vault through the bundled, pure-Python D-Bus client.

    'plain' is the standard local IPC session encoding, not a disk-storage backend.
    Secrets persist only in the OS vault; no encryption key or secret file is made.
    """
    BUS = 'org.freedesktop.secrets'
    ROOT = '/org/freedesktop/secrets'
    SERVICE = 'org.freedesktop.Secret.Service'
    ITEM = 'org.freedesktop.Secret.Item'
    COLLECTION = 'org.freedesktop.Secret.Collection'

    def __init__(self):
        wheel = Path(__file__).with_name('vendor') / VENDOR_NAME
        if not wheel.is_file() or hashlib.sha256(wheel.read_bytes()).hexdigest() != VENDOR_SHA256:
            raise StoreUnavailable('The bundled credential connector is unavailable.')
        sys.path.insert(0, str(wheel))
        try:
            from jeepney import DBusAddress, MatchRule, new_method_call
            from jeepney.io.blocking import open_dbus_connection
            from jeepney.wrappers import unwrap_msg
        finally:
            sys.path.remove(str(wheel))
        self.address, self.match, self.method = DBusAddress, MatchRule, new_method_call
        self.connect, self.unwrap = open_dbus_connection, unwrap_msg

    def call(self, connection, path, interface, method, signature='', body=(), bus=None):
        address = self.address(path, bus_name=bus or self.BUS, interface=interface)
        return self.unwrap(connection.send_and_get_reply(self.method(address, method, signature, body), timeout=10))

    def prompt(self, connection, path):
        if path == '/':
            return None
        bus_path, bus_interface = '/org/freedesktop/DBus', 'org.freedesktop.DBus'
        owner, = self.call(connection, bus_path, bus_interface, 'GetNameOwner', 's', (self.BUS,), bus_interface)
        rule = self.match(type='signal', sender=owner, path=path,
                          interface='org.freedesktop.Secret.Prompt', member='Completed')
        with connection.filter(rule) as messages:
            self.call(connection, bus_path, bus_interface, 'AddMatch', 's', (rule.serialise(),), bus_interface)
            self.call(connection, path, 'org.freedesktop.Secret.Prompt', 'Prompt', 's', ('',))
            dismissed, result = connection.recv_until_filtered(messages, timeout=45).body
        if dismissed:
            raise StoreUnavailable('System keyring authorization was cancelled.')
        return result[1]

    def unlock(self, connection, path):
        _, prompt = self.call(connection, self.ROOT, self.SERVICE, 'Unlock', 'ao', ([path],))
        self.prompt(connection, prompt)

    @contextmanager
    def session(self):
        try:
            with self.connect(bus='SESSION', auth_timeout=3) as connection:
                _, session = self.call(connection, self.ROOT, self.SERVICE, 'OpenSession', 'sv', ('plain', ('s', '')))
                yield connection, session
        except StoreUnavailable:
            raise
        except Exception:
            raise StoreUnavailable('The desktop secure keyring is locked or unavailable.') from None

    def find(self, connection, service, account):
        unlocked, locked = self.call(connection, self.ROOT, self.SERVICE, 'SearchItems', 'a{ss}',
                                     ({'service': service, 'username': account},))
        if unlocked:
            return unlocked[0]
        if locked:
            self.unlock(connection, locked[0])
            return locked[0]
        return None

    def collection(self, connection):
        collection, = self.call(connection, self.ROOT, self.SERVICE, 'ReadAlias', 's', ('default',))
        if collection == '/':
            collection, prompt = self.call(connection, self.ROOT, self.SERVICE, 'CreateCollection', 'a{sv}s',
                ({self.COLLECTION + '.Label': ('s', 'Codex Switch')}, 'default'))
            collection = self.prompt(connection, prompt) or collection
        if not collection or collection == '/':
            raise StoreUnavailable('A secure system keyring is unavailable.')
        self.unlock(connection, collection)
        return collection

    def get_password(self, service, account):
        with self.session() as (connection, session):
            item = self.find(connection, service, account)
            if item:
                secret, = self.call(connection, item, self.ITEM, 'GetSecret', 'o', (session,))
                return bytes(secret[2]).decode('utf-8')

    def set_password(self, service, account, value):
        with self.session() as (connection, session):
            secret = (session, b'', value.encode('utf-8'), 'text/plain; charset=utf8')
            item = self.find(connection, service, account)
            if item:
                self.call(connection, item, self.ITEM, 'SetSecret', '(oayays)', (secret,))
            else:
                collection = self.collection(connection)
                _, prompt = self.call(connection, collection, self.COLLECTION, 'CreateItem', 'a{sv}(oayays)b',
                    ({self.ITEM + '.Label': ('s', 'Codex Switch API key'),
                      self.ITEM + '.Attributes': ('a{ss}', {'service': service, 'username': account, 'application': 'Codex Switch'})}, secret, True))
                self.prompt(connection, prompt)

    def delete_password(self, service, account):
        with self.session() as (connection, _):
            item = self.find(connection, service, account)
            if item:
                prompt, = self.call(connection, item, self.ITEM, 'Delete')
                self.prompt(connection, prompt)
