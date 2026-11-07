"""Offline checks; all mutations use an isolated temporary directory."""
import importlib.util
import json
from pathlib import Path
import tempfile
import tomllib
import subprocess
import sys

spec = importlib.util.spec_from_file_location('switcher', Path(__file__).with_name('switcher.py'))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
catalog = (s.SOURCE / 'catalog.json').read_text('utf-8')
with tempfile.TemporaryDirectory() as directory:
    s.ROOT = Path(directory)
    s.CONFIG = s.ROOT / 'config.toml'
    s.KEY = s.ROOT / 'deepseek-key.dpapi'
    s.CATALOG = s.ROOT / 'models.json'
    s.STATE = s.ROOT / 'previous.json'
    s.CATALOG.write_text(catalog, encoding='utf-8')
    s.initialize()
    original = 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\nservice_tier = "default"\n\n[desktop]\nfollowUpQueueMode = "steer"\n\n[projects."C:/example"]\ntrust_level = "trusted"\n'
    s.CONFIG.write_text(original, encoding='utf-8')
    try:
        s.switch('deepseek-flash')
        raise AssertionError('Missing key was accepted')
    except RuntimeError:
        assert s.CONFIG.read_text() == original
    fake = 'sk-offline-test-not-a-real-credential'
    s.save_key(fake)
    assert fake not in s.KEY.read_text()
    assert s.token() == fake
    helper = subprocess.run([sys.executable, str(s.ROOT / 'switcher.py'), '--token'], capture_output=True, text=True, check=True)
    assert helper.stdout == fake
    s.switch('deepseek-flash')
    first = tomllib.loads(s.CONFIG.read_text())
    assert first['model_provider'] == 'deepseek'
    assert 'forced_login_method' not in first
    assert 'preferred_auth_method' not in first
    assert first['model_providers']['deepseek']['auth']['command'].endswith('python.exe')
    assert 'experimental_bearer_token' not in s.CONFIG.read_text()
    # An unrelated Codex setting changed while DeepSeek was selected.
    s.CONFIG.write_text(s.CONFIG.read_text().replace('"steer"', '"queue"'), encoding='utf-8')
    s.switch('deepseek-v4-pro', 'max')
    assert tomllib.loads(s.CONFIG.read_text())['model'] == 'deepseek-v4-pro'
    s.switch()
    final = tomllib.loads(s.CONFIG.read_text())
    expected = tomllib.loads(original)
    expected['desktop']['followUpQueueMode'] = 'queue'
    assert final == expected
    assert fake not in ''.join(p.read_text() for p in s.ROOT.glob('*.bak'))
    print('PASS: DPAPI round trip, missing-key protection, model switching, ChatGPT restoration, unrelated-setting preservation, secret-free backups.')
