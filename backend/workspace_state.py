"""Workspace preferences and per-window launch bindings. Never store secrets."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tomllib
import time
from contextlib import contextmanager
import switcher as s

workspace = None


def use(value):
    global workspace
    if value is not None and not re.fullmatch(r'[a-f0-9]{64}', value):
        raise ValueError('Invalid workspace identity')
    workspace = value


def directory():
    if not workspace:
        raise ValueError('Workspace identity is required')
    target = s.ROOT / 'workspaces' / workspace
    target.mkdir(parents=True, exist_ok=True)
    return target


def read(path, fallback=None):
    for attempt in range(10):
        try:
            return json.loads(path.read_text('utf-8'))
        except FileNotFoundError:
            return fallback
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(.02)


@contextmanager
def locked(path):
    with path.open('a+b') as lock:
        if sys.platform == 'win32':
            import msvcrt
            if lock.seek(0, 2) == 0:
                lock.write(b'0'); lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if sys.platform == 'win32':
                lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock, fcntl.LOCK_UN)


def preference():
    return read(directory() / 'selection.json', {})


def api_selection(provider):
    return read(directory() / (provider + '.json'), {}) if workspace else {}


def save_api_selection(provider, data):
    s.atomic(directory() / (provider + '.json'), json.dumps(data))


def global_text():
    return s.CONFIG.read_text('utf-8-sig') if s.CONFIG.exists() else ''


def initial_preference():
    with locked(directory() / 'selection.lock'):
        return import_preference()


def import_preference():
    """Import a default once, never present that import as a running client."""
    existing = preference()
    if existing:
        return existing
    import api_providers as api
    text = global_text()
    config = tomllib.loads(text)
    provider = config.get('model_provider', 'openai')
    selected = {'provider': provider, 'model': config.get('model', ''),
                'effort': config.get('model_reasoning_effort', '')}
    if provider == 'openai':
        selected['chatgpt'] = s.normalized_chatgpt_values(s.captured_values(text))
    elif provider in api.PROVIDERS:
        selected.update(model=config.get('model') or api.saved(provider).get('model', ''),
                        effort=config.get('model_reasoning_effort', ''))
    s.atomic(directory() / 'selection.json', json.dumps(selected))
    return selected


def choose(provider):
    with locked(directory() / 'selection.lock'):
        selected = choose_locked(provider)
        # Explicit switches supersede previously observed native picker events.
        selected['nativeSequence'] = max(selected.get('nativeSequence', 0),
            read(directory() / 'native-model.json', {}).get('sequence', 0))
        s.atomic(directory() / 'selection.json', json.dumps(selected))
        return selected


def choose_locked(provider):
    import api_providers as api
    if provider == 'openai':
        selected = preference()
        values = selected.get('chatgpt')
        if not values:
            values = read(s.STATE, {}) or s.captured_values(global_text())
        values = s.normalized_chatgpt_values(values)
        selected = {'provider': 'openai', 'chatgpt': values,
                    'model': s.scalar_value(values, 'model') or ''}
    else:
        api.definition(provider)
        if not api.state(provider)['valid']:
            raise ValueError('Validate the provider before switching')
        saved = api.saved(provider)
        api.select(provider, saved.get('model'), saved.get('effort', ''))
        selected = {'provider': provider, 'model': saved['model'], 'effort': saved.get('effort', '')}
        chatgpt = preference().get('chatgpt')
        if chatgpt:
            selected['chatgpt'] = chatgpt
    s.atomic(directory() / 'selection.json', json.dumps(selected))
    return selected


def arguments(selected):
    import api_providers as api
    provider = selected['provider']
    if provider == 'openai':
        values = s.normalized_chatgpt_values(selected.get('chatgpt', {}))
    elif provider in api.PROVIDERS:
        if not selected.get('model') or not api.catalog_path(provider).is_file():
            raise ValueError('Select an available model before switching')
        values = {k: json.dumps(v) for k, v in {
            'model_provider': provider, 'model': selected['model'],
            'model_catalog_json': str(api.catalog_path(provider)), 'web_search': 'disabled',
        }.items()}
        if selected.get('effort'):
            values['model_reasoning_effort'] = json.dumps(selected['effort'])
        # A TOML inline table pins this window's endpoint and native credential
        # helper, independent of shared provider-table edits in another window.
        p = api.definition(provider)
        helper = {'command': str(s.PYTHON), 'args': [str(s.ROOT / 'switcher.py'), '--token', provider],
                  'timeout_ms': 60000, 'refresh_interval_ms': 0}
        inline = lambda data: '{' + ', '.join(k + ' = ' + (inline(v) if isinstance(v, dict) else json.dumps(v)) for k, v in data.items()) + '}'
        values['model_providers.' + provider] = inline({'name': p['name'], 'base_url': api.endpoint(provider),
                                                      'wire_api': 'responses', 'auth': helper})
    else:
        # Preserve an unmanaged custom provider until the user selects ours.
        values = {'model_provider': json.dumps(provider)}
        if selected.get('model'):
            values['model'] = json.dumps(selected['model'])
    return [part for k, v in values.items() for part in ('-c', k + '=' + v)]


def revision(selected):
    return hashlib.sha256(json.dumps(arguments(selected), sort_keys=True).encode()).hexdigest()


def provider_revision(selected):
    args = arguments(selected)
    stable = [args[i+1] for i in range(0, len(args), 2)
              if args[i+1].split('=', 1)[0] not in ('model', 'model_reasoning_effort')]
    return hashlib.sha256(json.dumps(stable).encode()).hexdigest()


def adopt_native():
    event = read(directory() / 'native-model.json', {})
    if not event: return
    with locked(directory() / 'selection.lock'):
        selected = preference()
        if selected.get('provider') != event.get('provider'): return
        if selected.get('nativeSequence', 0) >= event.get('sequence', 0): return
        try:
            if selected.get('nativeNonce') != event.get('nonce') and revision(selected) != event.get('baseRevision'): return
        except (ValueError, OSError): return
        provider, model = event['provider'], event['model']
        if provider == 'openai':
            selected.setdefault('chatgpt', {})['model'] = json.dumps(model)
        else:
            import api_providers as api
            if provider not in api.PROVIDERS: return
            data = read(api.cache_path(provider), {})
            if model not in {m['id'] for m in data.get('models', [])}: return
            local = api_selection(provider)
            local.update(model=model, effort=event.get('effort') or '')
            local.pop('tested', None)
            save_api_selection(provider, local)
        selected.update(model=model, effort=event.get('effort') or '',
                        nativeNonce=event['nonce'], nativeSequence=event['sequence'])
        if provider == 'openai':
            if event.get('effort'): selected['chatgpt']['model_reasoning_effort'] = json.dumps(event['effort'])
            else: selected['chatgpt'].pop('model_reasoning_effort', None)
        s.atomic(directory() / 'selection.json', json.dumps(selected))


def launcher_path():
    if sys.platform == 'win32':
        digest = hashlib.sha256((s.SOURCE / 'window_launcher.cs').read_bytes()).hexdigest()[:12]
        return s.ROOT / ('codex-window-' + digest + '.exe')
    return s.ROOT / 'codex-window'


def managed_launcher(value):
    return isinstance(value, str) and re.search(r'(?:^|[/\\])provider-switcher[/\\]codex-window(?:-[a-f0-9]{12})?(?:\.exe)?$', value) is not None


def install_launcher(node=None):
    # Atomic updates keep previous launchers usable while another window starts.
    target = s.ROOT / 'window_launcher.py'
    content = (s.SOURCE / 'window_launcher.py').read_bytes()
    if not target.exists() or target.read_bytes() != content:
        s.atomic(target, content)
    s.atomic(s.ROOT / 'model_defaults.py', (s.SOURCE / 'model_defaults.py').read_bytes())
    s.atomic(s.ROOT / 'model_observer.py', (s.SOURCE / 'model_observer.py').read_bytes())
    s.atomic(s.ROOT / 'codex-adapter.js', (s.SOURCE.parent / 'codex-adapter.js').read_bytes())
    recovery = s.SOURCE.parent / 'recovery.js'
    s.atomic(s.ROOT / 'recovery.js', recovery.read_bytes())
    vendor = s.SOURCE.parent / 'node_modules/jsonc-parser/lib/umd'
    for source in vendor.rglob('*.js'):
        destination = s.ROOT / 'jsonc-parser' / source.relative_to(vendor)
        destination.parent.mkdir(parents=True, exist_ok=True)
        s.atomic(destination, source.read_bytes())
    launcher = launcher_path()
    if sys.platform == 'win32':
        source = s.SOURCE / 'window_launcher.cs'
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        stamp = launcher.with_suffix('.sha256')
        if launcher.exists() and stamp.exists() and stamp.read_text() == digest:
            return launcher
        compiler = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
        if not compiler.is_file():
            compiler = compiler.parent.parent.parent / 'Framework/v4.0.30319/csc.exe'
        output = launcher.with_name('codex-window-' + str(os.getpid()) + '.exe')
        try:
            subprocess.run([str(compiler), '/nologo', '/target:exe', '/platform:anycpu',
                '/reference:System.Web.Extensions.dll', '/out:' + str(output), str(source)],
                check=True, capture_output=True, timeout=30, creationflags=0x08000000)
            # A running launcher may be locked on Windows. Leave it intact and
            # retry the source update at the next startup instead of corrupting it.
            try:
                os.link(output, launcher)
            except FileExistsError:
                pass
            s.atomic(stamp, digest)
        finally:
            output.unlink(missing_ok=True)
    else:
        # exec retains the extension host as Node's parent. Fallback does not
        # invoke Python or depend on files in the installed extension directory.
        runtime = str(node or shutil.which('node'))
        script = ('#!/bin/sh\nruntime=' + shlex.quote(runtime) + '\n'
            'if [ -L "/proc/$PPID/exe" ]; then\n'
            '  current=$(readlink "/proc/$PPID/exe")\n'
            'else\n  current=$(ps -p "$PPID" -o comm=)\nfi\n'
            'if [ "${current##*/}" = ' + shlex.quote(Path(runtime).name) + ' ] && [ -x "$current" ]; then\n'
            '  runtime=$current\nfi\n'
            'ELECTRON_RUN_AS_NODE=1 exec "$runtime" ' + shlex.quote(str(s.ROOT / 'recovery.js'))
            + ' --launch "$PPID" "" "$@"\n')
        if not launcher.exists() or launcher.read_text() != script:
            s.atomic(launcher, script)
        launcher.chmod(0o700)
    return launcher


def window_directory(nonce):
    if not isinstance(nonce, str) or not re.fullmatch(r'[a-f0-9]{32}', nonce):
        raise ValueError('Invalid window identity')
    target = s.ROOT / 'windows' / nonce
    target.mkdir(parents=True, exist_ok=True)
    return target


def prepare(request):
    adopt_native()
    # Only retire a legacy block actually owned by this extension. Its backup
    # and ChatGPT restore snapshot keep the pre-migration configuration recoverable.
    with locked(s.ROOT / 'migration.lock'):
        selected = initial_preference()
        text = global_text()
        if s.BEGIN in text and s.END in text:
            if not s.STATE.exists():
                s.atomic(s.STATE, json.dumps(s.normalized_chatgpt_values(s.captured_values(text))))
            s.switch()
        import model_defaults
        model_defaults.import_legacy()
    launcher = install_launcher(request.get('node'))
    configured = request.get('configuredCommand')
    original_path = s.ROOT / 'original-cli.json'
    saved_original = read(original_path, {})
    if not managed_launcher(configured) and configured != saved_original.get('ignoredCommand'):
        saved_original = {'command': configured} if configured else {}
    if request.get('resetCommand'):
        saved_original = {'ignoredCommand': saved_original.get('command') if managed_launcher(configured) else configured}
    s.atomic(original_path, json.dumps(saved_original))
    original = saved_original.get('command')
    if managed_launcher(original):
        original = None
    command = original or request['command']
    if os.path.normcase(command) == os.path.normcase(str(launcher)):
        raise ValueError('Recursive Codex launcher')
    if not shutil.which(command):
        raise ValueError('The saved Codex executable is unavailable')
    recovery = read(s.ROOT / 'recovery.json', {})
    recovery.update(node=request.get('node') or shutil.which('node'), command=original,
                    bundled=request['command'], launcher=str(launcher))
    s.atomic(s.ROOT / 'recovery.json', json.dumps(recovery))
    window = window_directory(request['window'])
    binding = {'workspace': workspace, 'nonce': request['window'], 'ownerPid': request['ownerPid'],
        'profile': tomllib.loads(global_text()).get('profile'), 'config': str(s.CONFIG),
        'command': command, 'ignoredCommand': saved_original.get('ignoredCommand'),
        'model': selected.get('model', ''),
        'python': str(s.PYTHON), 'launcher': str(s.ROOT / 'window_launcher.py'),
        'cwd': request['cwd'], 'args': arguments(selected), 'provider': selected['provider'],
        'revision': revision(selected), 'providerRevision': provider_revision(selected)}
    s.atomic(window / 'binding.json', json.dumps(binding))
    # A restored Codex view can activate before our module loads. The bootstrap
    # can wait for its *own parent* extension host, with PID start verification,
    # instead of borrowing another window's environment or preference.
    from window_launcher import process_identity
    owners = s.ROOT / 'owners'
    owners.mkdir(exist_ok=True)
    s.atomic(owners / (str(request['ownerPid']) + '.json'), json.dumps({
        'binding': str(window / 'binding.json'), 'ownerStart': process_identity(request['ownerPid']),
        'pid': request['ownerPid'], 'state': 'ready'}))
    return {'launcher': str(launcher), 'binding': str(window / 'binding.json')}


def adopt_client(request):
    """Confirm only the exact initialized child queried through its own pipe."""
    from window_launcher import process_identity
    binding = read(window_directory(request['window']) / 'binding.json', {})
    pid = request.get('pid')
    started = request.get('started')
    if not isinstance(pid, int) or not started or process_identity(pid) != started:
        raise ValueError('Client is no longer alive')
    if sys.platform == 'win32':
        shell = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        result = subprocess.run([str(shell), '-NoProfile', '-NonInteractive', '-Command',
            '(Get-CimInstance Win32_Process -Filter "ProcessId=' + str(pid) + '").ParentProcessId'],
            capture_output=True, text=True, timeout=5, creationflags=0x08000000)
        parent = int(result.stdout.strip())
    elif sys.platform.startswith('linux'):
        parent = int(Path('/proc/' + str(pid) + '/stat').read_text().split(') ').pop().split()[1])
    else:
        parent = int(subprocess.check_output(['ps', '-o', 'ppid=', '-p', str(pid)], text=True, timeout=5).strip())
    if parent != binding.get('ownerPid'):
        raise ValueError('Client belongs to a different host')
    config = request.get('config', {})
    provider, model = config.get('model_provider') or 'openai', config.get('model') or ''
    if not isinstance(provider, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', provider) or not isinstance(model, str) or len(model) > 512:
        raise ValueError('Invalid client metadata')
    receipt = {k: binding[k] for k in ('nonce', 'workspace', 'ownerPid')}
    receipt.update(pid=pid, processStart=started, provider=provider, model=model,
        phase='verified' if provider == binding.get('provider') else 'mismatch',
        revision=binding.get('revision') if not binding.get('model') or binding['model'] == model else None)
    s.atomic(window_directory(request['window']) / 'runtime.json', json.dumps(receipt))
    return {'verified': receipt['phase'] == 'verified'}


def status(nonce):
    adopt_native()
    from window_launcher import process_identity
    selected = preference()
    receipt = read(window_directory(nonce) / 'runtime.json', {})
    match = receipt.get('workspace') == workspace and receipt.get('nonce') == nonce
    live = receipt.get('processStart') and process_identity(receipt.get('pid')) == receipt['processStart']
    verified = match and live and receipt.get('phase') == 'verified'
    try:
        current_revision = revision(selected) if selected else None
    except (ValueError, KeyError, OSError):
        current_revision = None
    pending = verified and receipt.get('revision') != current_revision
    native = selected.get('nativeNonce') == nonce and selected.get('provider') == receipt.get('provider')
    binding = read(window_directory(nonce) / 'binding.json', {})
    try:
        if native and binding.get('providerRevision') == provider_revision(selected): pending = False
    except (ValueError, OSError): pass
    return {'provider': receipt.get('provider') if verified else None,
        'model': (selected.get('model', '') if native else receipt.get('model', '')) if verified else '',
        'nativeSelection': {'provider': selected.get('provider'), 'model': selected.get('model'),
            'effort': selected.get('effort', ''), 'sequence': selected.get('nativeSequence')} if native else None,
        'selectedProvider': selected.get('provider'), 'verified': bool(verified),
        'reloadRequired': pending or not verified, 'phase': (receipt.get('phase', 'unconfirmed') if live else 'stopped') if match else 'unconfirmed'}
