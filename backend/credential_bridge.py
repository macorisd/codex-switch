"""Window-local IPC to VS Code SecretStorage. No API keys in files or arguments."""
import json
import os
import socket
from credential_native import StoreUnavailable


def configuration():
    raw = os.environ.get('CODEX_SWITCH_VAULT')
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data.get('port'), int) or not 0 < data['port'] < 65536:
            raise ValueError()
        if not isinstance(data.get('token'), str) or len(data['token']) != 64:
            raise ValueError()
        return data
    except (ValueError, TypeError, KeyError):
        raise StoreUnavailable('Reconnect the VS Code window to access API keys.') from None


def exchange(provider, operation, value=None):
    config = configuration()
    if not config:
        raise StoreUnavailable('Connect the VS Code window to access API keys.')
    try:
        with socket.create_connection(('127.0.0.1', config['port']), timeout=5) as connection:
            connection.settimeout(50)
            request = {'token': config['token'], 'provider': provider, 'operation': operation}
            if value is not None:
                request['value'] = value
            connection.sendall((json.dumps(request) + '\n').encode())
            with connection.makefile('rb') as stream:
                raw = stream.readline(16385)
            if len(raw) > 16384:
                raise ValueError()
            result = json.loads(raw)
            if not result.get('ok'):
                raise ValueError()
            return result
    except (OSError, ValueError, TypeError):
        raise StoreUnavailable('Reconnect the VS Code window to access API keys.') from None
