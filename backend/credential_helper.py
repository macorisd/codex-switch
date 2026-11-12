"""Stable, standalone Codex auth command using the OS credential store."""
from pathlib import Path
import sys
import credential_store

if __name__ == '__main__':
    try:
        if len(sys.argv) in (2, 3) and sys.argv[1] == '--token':
            provider = sys.argv[2] if len(sys.argv) == 3 else 'deepseek'
            import re
            if not re.fullmatch('[a-z][a-z0-9-]{0,30}', provider):
                raise ValueError('Invalid provider')
            name = provider + ('-key.dpapi' if sys.platform == 'win32' else '-key.keyring')
            sys.stdout.write(credential_store.load(Path(__file__).resolve().parent / name))
        else:
            print('Open Codex Switch in the VS Code sidebar.')
    except Exception:
        sys.stderr.write('Provider credential unavailable. Unlock the system keychain and try again.\n')
        sys.exit(1)
