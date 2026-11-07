"""Stable Codex auth command, installed next to the encrypted runtime key."""
import ctypes
from ctypes import wintypes
from pathlib import Path
import sys


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def main():
    if sys.argv[1:] != ['--token']:
        print('Open Codex Switch in the VS Code sidebar.')
        return
    key_path = Path(__file__).resolve().parent / 'deepseek-key.dpapi'
    raw = bytes.fromhex(key_path.read_text('ascii'))
    buffer = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    source = Blob(len(raw), buffer)
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    if not crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise RuntimeError('Credential unavailable')
    try:
        sys.stdout.write(ctypes.string_at(target.data, target.size).decode('utf-8'))
    finally:
        ctypes.WinDLL('kernel32').LocalFree(target.data)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.stderr.write('DeepSeek credential unavailable. Open Codex Switch.\n')
        sys.exit(1)
