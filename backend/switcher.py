"""Local Codex provider selector. No credentials are stored in TOML or logs."""
import ctypes
from ctypes import wintypes
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import tomllib
import urllib.request

SOURCE = Path(__file__).resolve().parent
ROOT = Path.home() / '.codex' / 'provider-switcher'
CONFIG = ROOT.parent / 'config.toml'
KEY = ROOT / 'deepseek-key.dpapi'
CATALOG = ROOT / 'deepseek-models.json'
STATE = ROOT / 'previous-settings.json'
PYTHON = Path(sys.executable).with_name('python.exe')
SETUP_URL = 'https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.ps1'
MANAGED = ('model', 'model_provider', 'preferred_auth_method', 'forced_login_method',
           'model_reasoning_effort', 'model_catalog_json', 'web_search',
           'show_raw_agent_reasoning', 'service_tier', 'model_context_window',
           'model_auto_compact_token_limit', 'model_reasoning_summary',
           'plan_mode_reasoning_effort')
BEGIN = '# BEGIN local DeepSeek provider selector'
END = '# END local DeepSeek provider selector'


def initialize():
    ROOT.mkdir(parents=True, exist_ok=True)
    if not CATALOG.exists():
        atomic(CATALOG, (SOURCE / 'catalog.json').read_text('utf-8'))
    # Keep the existing auth-command path stable across extension/source updates.
    helper = (SOURCE / 'credential_helper.py').read_text('utf-8')
    if not (ROOT / 'switcher.py').exists() or (ROOT / 'switcher.py').read_text('utf-8') != helper:
        atomic(ROOT / 'switcher.py', helper)


def atomic(path, text):
    path = Path(path)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + '.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def protect(raw, decrypt=False):
    buf = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    source = Blob(len(raw), buf)
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    if decrypt:
        ok = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    else:
        ok = crypt.CryptProtectData(ctypes.byref(source), 'Codex DeepSeek API key', None, None, None, 1, ctypes.byref(target))
    if not ok:
        raise RuntimeError('Windows could not access the encrypted credential for this user.')
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.WinDLL('kernel32').LocalFree(target.data)


def token():
    if not KEY.exists():
        raise RuntimeError('Save a DeepSeek API key in the local provider selector first.')
    return protect(bytes.fromhex(KEY.read_text('ascii')), True).decode('utf-8')


def save_key(value):
    value = value.strip()
    if not re.fullmatch(r'sk-[A-Za-z0-9_-]{12,}', value):
        raise ValueError('The API key must start with sk- and contain no spaces.')
    atomic(KEY, protect(value.encode()).hex())


def refresh_catalog():
    # Parse data only. Never execute the downloaded setup script.
    with urllib.request.urlopen(SETUP_URL, timeout=25) as response:
        source = response.read(2_000_000).decode('utf-8-sig')
    match = re.search(r"\$ModelsJson\s*=\s*@'\r?\n(.*?)\r?\n'@", source, re.S)
    if not match:
        raise RuntimeError('The official catalog format changed; the installed catalog was preserved.')
    catalog = json.loads(match[1])
    models = catalog.get('models', [])
    if not models or any(not re.fullmatch(r'deepseek-[a-z0-9-]+', m['slug']) for m in models):
        raise RuntimeError('Invalid official DeepSeek model catalog.')
    atomic(CATALOG, json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    return models


def provider_block():
    args = [str(ROOT / 'switcher.py'), '--token']
    return ('\n' + BEGIN + '\n[model_providers.deepseek]\nname = "DeepSeek"\n'
            'base_url = "https://api.deepseek.com/"\nwire_api = "responses"\n'
            '[model_providers.deepseek.auth]\ncommand = ' + json.dumps(str(PYTHON)) + '\n'
            'args = ' + json.dumps(args) + '\ntimeout_ms = 10000\nrefresh_interval_ms = 0\n'
            + END + '\n')


def split_config(text):
    # Managed settings are scalar top-level values. Reject multiline values safely.
    match = re.search(r'(?m)^\s*\[', text)
    at = match.start() if match else len(text)
    return text[:at], text[at:]


def rewrite(text, values, add_provider):
    text = re.sub(r'\n?' + re.escape(BEGIN) + r'\n.*?' + re.escape(END) + r'\n?', '\n', text, flags=re.S)
    head, tail = split_config(text)
    for key in MANAGED:
        head = re.sub(r'(?m)^' + re.escape(key) + r'\s*=.*\r?\n?', '', head)
    prefix = ''.join(k + ' = ' + v + '\n' for k, v in values.items())
    result = prefix + head + tail
    if add_provider:
        parsed = tomllib.loads(result)
        if 'deepseek' in parsed.get('model_providers', {}):
            raise RuntimeError('An unmanaged DeepSeek provider already exists; no changes made.')
        result += provider_block()
    tomllib.loads(result)
    return result


def captured_values(text):
    head, _ = split_config(text)
    parsed = tomllib.loads(text)
    values = {}
    for key in MANAGED:
        match = re.search(r'(?m)^' + re.escape(key) + r'\s*=\s*(.*?)\s*$', head)
        if match:
            # Ensure this whole value fits on one line before any changes.
            if tomllib.loads(key + ' = ' + match[1])[key] != parsed[key]:
                raise RuntimeError('Unsupported multiline setting: ' + key)
            values[key] = match[1]
    return values


def scalar_value(values, key):
    raw = values.get(key)
    return tomllib.loads(key + ' = ' + raw)[key] if raw is not None else None


def latest_chatgpt_values():
    # CC Switch can leave a custom provider/model snapshot. Recover the newest
    # compatible ChatGPT configuration without reading or exposing credentials.
    backups = sorted(ROOT.glob('config-*.toml.bak'), key=lambda path: path.stat().st_mtime, reverse=True)
    for backup in backups:
        try:
            text = backup.read_text('utf-8-sig')
            config = tomllib.loads(text)
        except (OSError, tomllib.TOMLDecodeError):
            continue
        model = config.get('model')
        if config.get('model_provider', 'openai') == 'openai' and not (
                isinstance(model, str) and model.startswith('deepseek-')):
            return captured_values(text)
    return None


def normalized_chatgpt_values(values):
    result = dict(values)
    provider = scalar_value(result, 'model_provider')
    model = scalar_value(result, 'model')
    incompatible = provider not in (None, 'openai') or (
        isinstance(model, str) and model.startswith('deepseek-'))
    if incompatible:
        result = latest_chatgpt_values() or {}
    result['model_provider'] = json.dumps('openai')
    return result


def switch(model=None, effort='high'):
    original = CONFIG.read_text('utf-8-sig')
    current = tomllib.loads(original)
    if model:
        if not KEY.exists():
            raise RuntimeError('Save your API key first.')
        token()  # Check DPAPI access without printing the credential.
        models = json.loads(CATALOG.read_text('utf-8'))['models']
        selected = next(m for m in models if m['slug'] == model)
        if effort not in [x['effort'] for x in selected['supported_reasoning_levels']]:
            raise ValueError('Unsupported reasoning effort for this model.')
        if current.get('model_provider', 'openai') != 'deepseek':
            atomic(STATE, json.dumps(normalized_chatgpt_values(captured_values(original)), indent=2))
        elif not STATE.exists():
            raise RuntimeError('The saved ChatGPT settings are missing; no changes made.')
        values = {k: json.dumps(v) for k, v in dict(model=model, model_provider='deepseek',
                  model_reasoning_effort=effort, model_catalog_json=str(CATALOG),
                  web_search='disabled').items()}
        updated = rewrite(original, values, True)
    else:
        if current.get('model_provider', 'openai') == 'deepseek':
            if not STATE.exists():
                raise RuntimeError('The saved ChatGPT settings are missing; no changes made.')
            values = json.loads(STATE.read_text('utf-8'))
        else:
            values = captured_values(original)
        updated = rewrite(original, normalized_chatgpt_values(values), False)
    # Backups contain configuration only; the API key never enters the TOML.
    backup = ROOT / ('config-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.toml.bak')
    atomic(backup, original)
    if CONFIG.read_text('utf-8-sig') != original:
        raise RuntimeError('Codex changed its configuration during selection. Please try again.')
    atomic(CONFIG, updated)
    return 'Selection saved. Reload the Codex client, then start a new conversation.'


def verify_api():
    request = urllib.request.Request('https://api.deepseek.com/models',
                                     headers={'Authorization': 'Bearer ' + token()})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            data = json.load(response)
        return [m['id'] for m in data['data']]
    except Exception:
        raise RuntimeError('DeepSeek verification failed. Check the key, account balance and network. No key was logged.') from None


if __name__ == '__main__':
    initialize()
    if sys.argv[1:] == ['--token']:
        try:
            sys.stdout.write(token())
        except Exception:
            sys.stderr.write('DeepSeek credential unavailable. Open the local provider selector.\n')
            sys.exit(1)
    elif sys.argv[1:] == ['--refresh']:
        print(', '.join(m['slug'] for m in refresh_catalog()))
    else:
        print('Open Codex Switch in the VS Code sidebar.')
