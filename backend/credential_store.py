"""OS-backed credentials. Never use a plaintext or fallback keyring backend."""
import ctypes
from ctypes import wintypes
import hashlib
from pathlib import Path
import sys
from credential_native import MacKeychain, LinuxSecretService, StoreUnavailable
import credential_bridge


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def protect(raw, decrypt=False):
    buf = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    source = Blob(len(raw), buf)
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    label = None if decrypt else 'Codex provider API key'
    if not function(ctypes.byref(source), label, None, None, None, 1, ctypes.byref(target)):
        raise RuntimeError('The encrypted credential is unavailable for this user.')
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.WinDLL('kernel32').LocalFree(target.data)


def native_store():
    try:
        if sys.platform == 'darwin':
            return MacKeychain()
        elif sys.platform.startswith('linux'):
            return LinuxSecretService()
        else:
            raise StoreUnavailable('Unsupported credential platform.')
    except (OSError, ImportError):
        raise StoreUnavailable('The system credential store is unavailable.') from None


def service(key_path):
    path = Path(key_path).resolve()
    identity = str(path.parent).encode('utf-8')
    provider = path.name.split('-key.')[0]
    # Preserve the legacy DeepSeek service exactly while isolating every other
    # provider. The runtime directory alone is not a sufficient keyring identity.
    return 'codex-switch.' + provider + '.' + hashlib.sha256(identity).hexdigest()


def native_save(key_path, value):
    if sys.platform == 'win32':
        return protect(value.encode()).hex()
    native_store().set_password(service(key_path), 'api-key', value)
    # Only a non-secret presence marker is written to the runtime directory.
    return 'system-keyring-v1'


def native_load(key_path):
    if Path(key_path).read_text('ascii').strip() == 'vscode-secret-storage-v1':
        raise StoreUnavailable('Connect VS Code to access this API key.')
    if sys.platform == 'win32':
        return protect(bytes.fromhex(Path(key_path).read_text('ascii')), True).decode('utf-8')
    value = native_store().get_password(service(key_path), 'api-key')
    if not value:
        raise RuntimeError('The system credential is unavailable.')
    return value


def native_remove(key_path):
    if sys.platform != 'win32':
        native_store().delete_password(service(key_path), 'api-key')
    Path(key_path).unlink(missing_ok=True)


def provider(key_path):
    return Path(key_path).name.split('-key.')[0]


def status(key_path):
    if credential_bridge.configuration():
        return credential_bridge.exchange(provider(key_path), 'status')
    return {'hasKey': Path(key_path).is_file(), 'revision': None, 'known': Path(key_path).is_file()}


def save(key_path, value):
    config = credential_bridge.configuration()
    if not config:
        return native_save(key_path, value)
    credential_bridge.exchange(provider(key_path), 'store', value)
    if not config.get('remote'):
        try:
            return native_save(key_path, value)
        except (StoreUnavailable, OSError, RuntimeError):
            pass
    return 'vscode-secret-storage-v1'


def load(key_path):
    if credential_bridge.configuration():
        value = credential_bridge.exchange(provider(key_path), 'get').get('value')
        if not value:
            raise StoreUnavailable('Save an API key in Codex Switch.')
        return value
    return native_load(key_path)


def remove(key_path):
    config = credential_bridge.configuration()
    if config:
        credential_bridge.exchange(provider(key_path), 'delete')
        if config.get('remote'):
            Path(key_path).unlink(missing_ok=True)
            return
    # A SecretStorage-only marker has no corresponding native-vault item.
    if Path(key_path).is_file() and Path(key_path).read_text('ascii').strip() == 'vscode-secret-storage-v1':
        Path(key_path).unlink(missing_ok=True)
    else:
        native_remove(key_path)


