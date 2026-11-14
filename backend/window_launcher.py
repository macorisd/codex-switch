"""Launch the official Codex with window-local arguments and verify its config.

Stdio is forwarded unchanged, except for one private config/read exchange. No
inference protocol conversion, request logging, credential parsing or auth copy.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import tempfile
import time


def process_identity(pid):
    """Pair PID with OS start identity so stale/reused PIDs cannot confirm state."""
    try:
        if sys.platform == 'win32':
            import ctypes
            from ctypes import wintypes
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.OpenProcess.restype = wintypes.HANDLE
            kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel.GetProcessTimes.argtypes = [wintypes.HANDLE, *([ctypes.POINTER(wintypes.FILETIME)] * 4)]
            kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            handle = kernel.OpenProcess(0x1000, False, pid)
            if not handle:
                return None
            try:
                created, ended, kernel_time, user_time = [wintypes.FILETIME() for _ in range(4)]
                code = wintypes.DWORD()
                if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value != 259:
                    return None
                if not kernel.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(ended), ctypes.byref(kernel_time), ctypes.byref(user_time)):
                    return None
                return str((created.dwHighDateTime << 32) | created.dwLowDateTime)
            finally:
                kernel.CloseHandle(handle)
        if sys.platform == 'linux':
            stat = Path('/proc/' + str(pid) + '/stat').read_text().rsplit(') ', 1)[1].split()
            return None if stat[0] == 'Z' else stat[19]
        result = subprocess.run(['ps', '-o', 'lstart=', '-p', str(pid)], capture_output=True, text=True, timeout=3)
        return result.stdout.strip() or None
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def atomic(path, value):
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream)
        for attempt in range(10):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(.02)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def launch(binding_path, arguments):
    deadline = time.monotonic() + 30
    while not binding_path or not Path(binding_path).is_file():
        if not binding_path:
            owner = Path(__file__).parent / 'owners' / (str(os.getppid()) + '.json')
            try:
                record = json.loads(owner.read_text('utf-8'))
                if record.get('ownerStart') == process_identity(os.getppid()):
                    binding_path = record['binding']
            except (OSError, ValueError, KeyError):
                pass
        if time.monotonic() >= deadline:
            raise RuntimeError('Window binding unavailable')
        time.sleep(.05)
    binding = json.loads(Path(binding_path).read_text('utf-8'))
    command = [binding['command'], *binding['args'], *arguments]
    creationflags = 0x08000000 if sys.platform == 'win32' else 0
    if 'app-server' not in arguments:
        # Version/probe commands must not create a false app-server receipt.
        return subprocess.call([binding['command'], *arguments], creationflags=creationflags)
    receipt_path = Path(binding_path).with_name('runtime.json')
    private_id = 'codex-switch-config-' + binding['nonce']
    base = {k: binding[k] for k in ('nonce', 'workspace', 'revision', 'ownerPid')}
    base.update(phase='starting', provider=None, model='', pid=os.getpid(), processStart=process_identity(os.getpid()))
    atomic(receipt_path, base)
    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=None, cwd=binding['cwd'], start_new_session=sys.platform != 'win32',
                             creationflags=creationflags)
    guard = None
    guard_write = None
    if sys.platform != 'win32':
        # A separate pipe guard also handles SIGKILL, which Python cannot catch.
        # It owns only this launch's new process group, never the editor's group.
        guard_read, guard_write = os.pipe()
        code = ('import os,signal,sys; data=os.read(int(sys.argv[1]),1); '
                '\nif not data:\n try: os.killpg(int(sys.argv[2]),signal.SIGTERM)\n except ProcessLookupError: pass\n')
        guard = subprocess.Popen([sys.executable, '-c', code, str(guard_read), str(child.pid)],
            pass_fds=(guard_read,), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, start_new_session=True)
        os.close(guard_read)
    lock = threading.Lock()
    initialized = threading.Event()
    verified = threading.Event()

    def send(raw):
        with lock:
            child.stdin.write(raw)
            child.stdin.flush()

    def parent_input():
        try:
            for raw in sys.stdin.buffer:
                send(raw)
                # Bound inspection; large tool/request data is forwarded only.
                if len(raw) < 65536:
                    try:
                        value = json.loads(raw)
                    except (ValueError, UnicodeError):
                        continue
                    if value.get('method') == 'initialized' and not initialized.is_set():
                        initialized.set()
                        send((json.dumps({'id': private_id, 'method': 'config/read',
                            'params': {'includeLayers': False, 'cwd': binding['cwd']}}) + '\n').encode())
        except (BrokenPipeError, OSError):
            pass
        finally:
            with lock:
                child.stdin.close()

    def deadline():
        if not verified.wait(30):
            atomic(receipt_path, {**base, 'phase': 'unconfirmed'})

    threading.Thread(target=parent_input, daemon=True).start()
    threading.Thread(target=deadline, daemon=True).start()
    try:
        for raw in child.stdout:
            value = None
            if len(raw) < 4_000_000:
                try:
                    value = json.loads(raw)
                except (ValueError, UnicodeError):
                    pass
            if isinstance(value, dict) and value.get('id') == private_id:
                config = value.get('result', {}).get('config')
                valid_response = isinstance(config, dict)
                config = config if valid_response else {}
                provider = config.get('model_provider') or 'openai'
                confirmed = valid_response and not value.get('error') and provider == binding['provider']
                atomic(receipt_path, {**base, 'phase': 'verified' if confirmed else 'mismatch',
                    'provider': provider if confirmed else None,
                    'model': config.get('model', '') if confirmed else ''})
                verified.set()
                continue
            sys.stdout.buffer.write(raw)
            sys.stdout.buffer.flush()
        return child.wait()
    finally:
        verified.set()
        if child.poll() is None:
            child.kill()
        child.wait()
        child.stdout.close()
        if guard is not None:
            os.write(guard_write, b'd')
            os.close(guard_write)
            guard.wait(timeout=5)
        atomic(receipt_path, {**base, 'phase': 'stopped'})


if __name__ == '__main__':
    try:
        sys.exit(launch(sys.argv[1], sys.argv[2:]))
    except Exception:
        # Never print child output, configuration or upstream exceptions.
        print('Codex Switch could not start this window. Reload from Codex Switch.', file=sys.stderr)
        sys.exit(1)
