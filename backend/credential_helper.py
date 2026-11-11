"""Stable, standalone Codex auth command using the OS credential store."""
from pathlib import Path
import sys
import credential_store

if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--token']:
            name = 'deepseek-key.dpapi' if sys.platform == 'win32' else 'deepseek-key.keyring'
            sys.stdout.write(credential_store.load(Path(__file__).resolve().parent / name))
        else:
            print('Open Codex Switch in the VS Code sidebar.')
    except Exception:
        sys.stderr.write('DeepSeek credential unavailable. Check the system keyring and Python dependencies.\n')
        sys.exit(1)
