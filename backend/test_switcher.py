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
    s.KEY = s.ROOT / ('deepseek-key.dpapi' if sys.platform == 'win32' else 'deepseek-key.keyring')
    s.CATALOG = s.ROOT / 'models.json'
    s.STATE = s.ROOT / 'previous.json'
    s.CATALOG.write_text(catalog, encoding='utf-8')
    s.initialize()
    original = 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\nservice_tier = "default"\n\n[desktop]\nfollowUpQueueMode = "steer"\n\n[projects."C:/example"]\ntrust_level = "trusted"\n'
    s.CONFIG.write_text(original, encoding='utf-8')
    # A hidden provider must not even read its catalog for shared status.
    sys.modules['switcher'] = s
    bridge_spec = importlib.util.spec_from_file_location('bridge', Path(__file__).with_name('bridge.py'))
    bridge = importlib.util.module_from_spec(bridge_spec)
    bridge_spec.loader.exec_module(bridge)
    actual_catalog = s.CATALOG
    s.CATALOG = s.ROOT / 'absent-hidden-catalog.json'
    try:
        assert bridge.handle({'action': 'status', 'includeDeepSeek': False})['models'] == []
    finally:
        s.CATALOG = actual_catalog
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
    assert first['model_providers']['deepseek']['auth']['command'] == str(Path(sys.executable))
    assert 'experimental_bearer_token' not in s.CONFIG.read_text()
    # An unrelated Codex setting changed while DeepSeek was selected.
    s.CONFIG.write_text(s.CONFIG.read_text().replace('"steer"', '"queue"'), encoding='utf-8')
    s.switch('deepseek-v4-pro', 'max')
    assert tomllib.loads(s.CONFIG.read_text())['model'] == 'deepseek-v4-pro'
    s.switch()
    final = tomllib.loads(s.CONFIG.read_text())
    expected = tomllib.loads(original)
    expected['model_provider'] = 'openai'
    expected['desktop']['followUpQueueMode'] = 'queue'
    assert final == expected
    assert fake not in ''.join(p.read_text() for p in s.ROOT.glob('*.bak'))
    # A legacy snapshot from CC Switch must not restore its custom provider or
    # DeepSeek model when ChatGPT is selected.
    s.switch('deepseek-flash')
    s.STATE.write_text(json.dumps({
        'model_provider': json.dumps('custom'),
        'model': json.dumps('deepseek-flash'),
        'model_reasoning_effort': json.dumps('high'),
    }), encoding='utf-8')
    s.switch()
    repaired = tomllib.loads(s.CONFIG.read_text())
    assert repaired['model_provider'] == 'openai'
    assert repaired['model'] == 'gpt-6.1-sol'
    assert repaired['model_reasoning_effort'] == 'medium'
    # A current custom provider with no state must be repaired as well.
    s.CONFIG.write_text(
        'model = "deepseek-flash"\nmodel_provider = "custom"\nmodel_reasoning_effort = "high"\n\n'
        '[model_providers.custom]\nname = "Custom"\nbase_url = "https://example.invalid/v1"\nwire_api = "responses"\n',
        encoding='utf-8',
    )
    s.STATE.unlink(missing_ok=True)
    s.switch()
    repaired_current = tomllib.loads(s.CONFIG.read_text())
    assert repaired_current['model_provider'] == 'openai'
    assert repaired_current['model'] == 'gpt-6.1-sol'
    assert 'custom' in repaired_current['model_providers']
    # Balance parsing selects USD only and keeps the credential in the header.
    original_urlopen = s.urllib.request.urlopen

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, *args):
            return json.dumps(self.payload).encode('utf-8')

    def fake_urlopen(request, timeout):
        assert request.full_url == s.BALANCE_URL
        assert request.get_header('Authorization') == 'Bearer ' + fake
        assert timeout == 25
        return FakeResponse({
            'is_available': True,
            'balance_infos': [
                {'currency': 'CNY', 'total_balance': '9.00'},
                {
                    'currency': 'USD',
                    'total_balance': '12.34',
                    'granted_balance': '2.00',
                    'topped_up_balance': '10.34',
                },
            ],
        })

    s.urllib.request.urlopen = fake_urlopen
    try:
        usd = s.balance()
    finally:
        s.urllib.request.urlopen = original_urlopen
    assert usd == {
        'available': True,
        'currency': 'USD',
        'total': 12.34,
        'totalText': '12.34',
        'availableCurrencies': ['CNY', 'USD'],
    }
    s.urllib.request.urlopen = lambda request, timeout: FakeResponse({
        'is_available': True,
        'balance_infos': [{'currency': 'CNY', 'total_balance': '100.00'}],
    })
    try:
        cny_only = s.balance()
    finally:
        s.urllib.request.urlopen = original_urlopen
    assert cny_only['total'] is None
    assert cny_only['availableCurrencies'] == ['CNY']
    if sys.platform != 'win32':
        s.credential_store.native_store().delete_password(s.credential_store.service(s.KEY), 'api-key')
    print('PASS: native credential round trip, missing-key protection, model switching, CC Switch repair, ChatGPT restoration, balance parsing, unrelated-setting preservation, secret-free backups.')
