"""Shared API-key provider engine. Definitions are data; no protocol conversion."""
import datetime
from decimal import Decimal, InvalidOperation
import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
import switcher as s

DEFINITIONS = json.loads((Path(__file__).with_name('providers.json')).read_text('utf-8'))
PROVIDERS = {p['id']: p for p in DEFINITIONS}


def definition(provider):
    if provider not in PROVIDERS:
        raise ValueError('Unsupported API provider')
    return PROVIDERS[provider]


def key_path(provider):
    definition(provider)
    return s.KEY if provider == 'deepseek' else s.ROOT / (provider + ('-key.dpapi' if s.sys.platform == 'win32' else '-key.keyring'))


def cache_path(provider):
    definition(provider)
    return s.ROOT / (provider + '-selection.json')


def catalog_path(provider):
    return s.CATALOG if provider == 'deepseek' else s.ROOT / (provider + '-models.json')


def saved(provider):
    path = cache_path(provider)
    return json.loads(path.read_text('utf-8')) if path.exists() else {}


def endpoint(provider):
    return saved(provider).get('baseUrl', definition(provider)['baseUrl']).rstrip('/')


def configure_endpoint(provider, url):
    # Keys may only be sent to the documented upstream hosts, never arbitrary URLs.
    parsed = urllib.parse.urlparse(url)
    hosts = {urllib.parse.urlparse(definition(provider)['baseUrl']).hostname}
    hosts.update(definition(provider).get('alternateHosts', []))
    qwen = provider == 'qwen' and bool(re.fullmatch(r'[a-zA-Z0-9-]+\.(?:ap-southeast-1|cn-beijing)\.maas\.aliyuncs\.com', parsed.hostname or ''))
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.port not in (None, 443) or not (parsed.hostname in hosts or qwen):
        raise ValueError('Use an official HTTPS endpoint for this provider.')
    data = saved(provider)
    data['baseUrl'] = url.rstrip('/')
    data.pop('validatedAt', None)
    data.pop('tested', None)
    s.atomic(cache_path(provider), json.dumps(data))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(provider, route, data=None):
    key = s.credential_store.load(key_path(provider))
    req = urllib.request.Request(endpoint(provider) + route,
        data=None if data is None else json.dumps(data).encode(),
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=25) as response:
        payload = response.read(4_000_001)
        if len(payload) > 4_000_000:
            raise ValueError('API response too large')
        result = json.loads(payload)
        if not isinstance(result, dict) or result.get('error') or result.get('base_resp', {}).get('status_code', 0):
            raise ValueError('API returned an error')
        return result


def save_key(provider, value):
    if not isinstance(value, str) or not 8 <= len(value.strip()) <= 8192 or any(c.isspace() for c in value.strip()):
        raise ValueError('Invalid API key')
    s.atomic(key_path(provider), s.credential_store.save(key_path(provider), value.strip()))
    data = saved(provider)
    data.pop('validatedAt', None)
    data.pop('tested', None)
    s.atomic(cache_path(provider), json.dumps(data))


def remove_key(provider):
    s.credential_store.remove(key_path(provider))
    data = saved(provider)
    for field in ('validatedAt', 'tested', 'needsTest'):
        data.pop(field, None)
    s.atomic(cache_path(provider), json.dumps(data))
    return state(provider)


def free_model(p, item):
    """Explicit zero pricing, or documented free IDs when pricing is absent.

    A provider with another pricing shape should normalize it in its adapter;
    missing/unknown prices and a marketing name containing 'free' are not proof.
    """
    pricing = item.get('pricing')
    if isinstance(pricing, dict) and {'prompt', 'completion'} <= pricing.keys():
        try:
            prices = [Decimal(str(value)) for value in pricing.values()]
            if all(value.is_finite() for value in prices):
                return all(value == 0 for value in prices)
        except (InvalidOperation, ValueError):
            return False
        return False
    slug = item.get('id', '')
    return slug in p.get('freeModelIds', []) or bool(p.get('freeModelSuffix') and slug.endswith(p['freeModelSuffix']))


def normalize(provider, raw):
    p = definition(provider)
    models = []
    seen = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        slug = item.get('id')
        if not isinstance(slug, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,200}', slug):
            continue
        if slug in seen:
            continue
        seen.add(slug)
        params = item.get('supported_parameters') if isinstance(item.get('supported_parameters'), list) else []
        architecture = item.get('architecture') if isinstance(item.get('architecture'), dict) else {}
        output_modalities = architecture.get('output_modalities') or ['text']
        input_modalities = (architecture.get('input_modalities') or []) + (item.get('input_modalities') or [])
        if provider == 'openrouter' and ('tools' not in params or 'text' not in output_modalities):
            continue
        if p.get('modelPattern') and not re.fullmatch(p['modelPattern'], slug):
            continue
        if any(word in slug.lower() for word in ('embedding', 'tts', 'transcribe', 'audio', 'realtime', 'image', 'whisper', 'moderation')):
            continue
        capabilities = {}
        for rule in p.get('capabilities', []):
            if re.fullmatch(rule['pattern'], slug):
                capabilities.update(rule)
        efforts = capabilities.get('efforts', [])
        if provider == 'openrouter':
            efforts = ['low', 'medium', 'high'] if 'reasoning' in params or 'reasoning_effort' in params else []
        levels = item.get('supported_reasoning_levels')
        if isinstance(levels, list):
            efforts = [e.get('effort') if isinstance(e, dict) else e for e in levels]
        efforts = list(dict.fromkeys(e for e in efforts if e in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'persistent')))
        default_effort = item.get('default_reasoning_level', capabilities.get('defaultEffort'))
        default_effort = default_effort if default_effort in efforts else None
        context = item.get('context_length', item.get('context_window', capabilities.get('context', 32768)))
        if type(context) is not int or not 4096 <= context <= 10_000_000:
            context = 32768
        models.append({'id': slug, 'name': str(item.get('name', slug))[:200], 'efforts': efforts, 'free': free_model(p, item),
            'context': context, 'image': capabilities.get('image', False) or 'image' in input_modalities,
            'parallel': capabilities.get('parallel', False), 'freeform': capabilities.get('freeform', False),
            'toolMode': capabilities.get('toolMode'), 'defaultEffort': default_effort,
            'compatibility': 'Catalog metadata; model inference has not been tested.'})
    return models


def openai_metadata(items):
    # The API listing establishes access; Codex's own cached metadata supplies
    # capabilities for matching IDs, including newer models. Never return the
    # cache's identity, instructions, account or access-program fields.
    path = s.ROOT.parent / 'models_cache.json'
    try:
        if path.stat().st_size > 4_000_000:
            return items
        cached = {m['slug']: m for m in json.loads(path.read_text('utf-8')).get('models', [])}
    except (OSError, ValueError, KeyError, TypeError):
        return items
    fields = ('context_window', 'supported_reasoning_levels', 'default_reasoning_level', 'input_modalities')
    return [{**{k: cached.get(item.get('id'), {})[k] for k in fields if k in cached.get(item.get('id'), {})}, **item} for item in items if isinstance(item, dict)]


def discover(provider):
    if provider == 'deepseek':
        s.verify_api()
        try:
            s.refresh_catalog()
        except Exception:
            pass  # Keep the previously verified official catalog if its CDN is offline.
        return [{'id': m['slug'], 'name': m['display_name'], 'efforts': [e['effort'] for e in m['supported_reasoning_levels']],
            'context': m.get('context_window', 131072), 'image': 'image' in m.get('input_modalities', [])}
            for m in json.loads(s.CATALOG.read_text('utf-8'))['models']], True
    if provider == 'openrouter':
        request(provider, '/key')  # /models is public and does not validate a key.
    try:
        raw = request(provider, '/models')
    except urllib.error.HTTPError as error:
        if error.code not in (404, 405, 501) or not definition(provider)['fallbackModels']:
            raise
        fallbacks = definition(provider)['fallbackModels']
        host = urllib.parse.urlparse(endpoint(provider)).hostname
        for variant in definition(provider).get('fallbackVariants', []):
            if re.fullmatch(variant['hostPattern'], host):
                fallbacks = variant['models']
        return normalize(provider, [{'id': m} for m in fallbacks]), False
    if not isinstance(raw.get('data'), list):
        raise ValueError('Invalid model catalog')
    return normalize(provider, openai_metadata(raw['data']) if provider == 'openai-api' else raw['data']), True


def codex_catalog(provider, models):
    if provider == 'deepseek':
        return
    # Build the Codex schema explicitly: never inherit DeepSeek-only capabilities.
    result = []
    for model in models:
        m = dict(slug=model['id'], display_name=model['name'], description=model['id'],
            context_window=model['context'], max_context_window=model['context'],
            input_modalities=['text', 'image'] if model['image'] else ['text'],
            supports_parallel_tool_calls=model.get('parallel', False), supports_image_detail_original=False,
            supports_reasoning_summaries=bool(model['efforts']), supports_reasoning_summary_parameter=False, support_verbosity=False,
            supported_reasoning_levels=[{'effort': e, 'description': e} for e in model['efforts']],
            default_reasoning_level=model.get('defaultEffort'),
            default_reasoning_summary='none', use_responses_lite=definition(provider)['useResponsesLite'],
            tool_mode=model.get('toolMode'), base_instructions='You are a coding assistant working with the user in a shared workspace.',
            shell_type='shell_command', visibility='list', supported_in_api=True, priority=1,
            default_verbosity=None, apply_patch_tool_type='freeform' if model.get('freeform') else None,
            truncation_policy={'mode': 'tokens', 'limit': 10000}, effective_context_window_percent=95,
            experimental_supported_tools=[], prefer_websockets=False)
        result.append(m)
    s.atomic(catalog_path(provider), json.dumps({'models': result}))


def refresh(provider):
    models, validated = discover(provider)
    if not models:
        raise RuntimeError('No text/tool-capable models were discovered.')
    data = saved(provider)
    data['models'] = models
    data['validatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat() if validated else data.get('validatedAt')
    data['needsTest'] = not bool(data['validatedAt'])
    data['catalogSource'] = 'api' if validated else 'documented fallback'
    if data.get('model') not in {m['id'] for m in models}:
        data['model'] = models[0]['id']
        data['effort'] = ''
    selected = next(m for m in models if m['id'] == data['model'])
    if data.get('effort') not in selected['efforts']:
        data['effort'] = selected.get('defaultEffort') or ''
    tested = data.get('tested')
    if tested and (tested['model'] != data['model'] or tested['effort'] != data['effort']):
        data.pop('tested', None)
    codex_catalog(provider, models)
    s.atomic(cache_path(provider), json.dumps(data))
    return state(provider)


def state(provider):
    data = saved(provider)
    has_key = key_path(provider).exists()
    return {'hasKey': has_key, 'models': data.get('models', []),
        'model': data.get('model', ''), 'effort': data.get('effort', ''), 'baseUrl': endpoint(provider),
        'valid': has_key and bool(data.get('validatedAt')), 'needsTest': data.get('needsTest', False), 'tested': data.get('tested')}


def select(provider, model, effort):
    data = saved(provider)
    selected = next((m for m in data.get('models', []) if m['id'] == model), None)
    if not selected or (effort and effort not in selected['efforts']):
        raise ValueError('Select a discovered model and supported reasoning level.')
    data.update(model=model, effort=effort)
    data.pop('tested', None)
    s.atomic(cache_path(provider), json.dumps(data))
    return state(provider)


def balance(provider):
    if provider == 'deepseek':
        return s.balance()
    if provider == 'openrouter':
        data = request(provider, '/credits')['data']
        credit, usage = data.get('total_credits'), data.get('total_usage')
        if type(credit) in (int, float) and type(usage) in (int, float) and math.isfinite(credit) and math.isfinite(usage):
            return {'total': credit - usage, 'currency': 'USD'}
    if provider == 'moonshot':
        raw = request(provider, '/users/me/balance')
        value = raw.get('data', {}).get('available_balance')
        if raw.get('status') is True and type(value) in (int, float) and math.isfinite(value):
            return {'total': value, 'currency': 'CNY' if urllib.parse.urlparse(endpoint(provider)).hostname == 'api.moonshot.cn' else 'USD'}
    if provider == 'minimax':
        if s.credential_store.load(key_path(provider)).startswith('sk-api-'):
            return None  # PAYG balance lacks an explicit currency in the response.
        raw = request(provider, '/token_plan/remains')
        entry = next((m for m in raw.get('model_remains', []) if m.get('model_name', '').startswith('MiniMax-M')), {})
        windows = []
        for prefix, label, reset_key in [('current_interval', 'Current window remaining', 'end_time'), ('current_weekly', 'Weekly remaining', 'weekly_end_time')]:
            if entry.get(prefix + '_status') == 3:
                continue  # Unlimited is not zero percent remaining.
            value = entry.get(prefix + '_remaining_percent')
            # *_usage_count changed meaning between API revisions. Never guess.
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 100:
                continue
            if prefix == 'current_weekly':
                boost = entry.get('weekly_boost_permille', 1000)
                if type(boost) not in (int, float) or not math.isfinite(boost) or not 0 < boost <= 10000:
                    continue
                value *= boost / 1000
            reset = entry.get(reset_key)
            windows.append({'label': label, 'remaining': value, 'resetsAt': reset / 1000 if type(reset) in (int, float) and math.isfinite(reset) and 0 < reset <= 253402300799000 else None})
        return {'windows': windows} if windows else None
    return None


def test_model(provider):
    """Explicit, potentially billable function-tool and stateless replay smoke test.

    Sends synthetic data only; never executes a tool, accesses a file or changes
    Codex config. Success is deliberately narrower than full Codex certification.
    """
    data = saved(provider)
    model, effort = data.get('model'), data.get('effort', '')
    select(provider, model, effort)
    body = {'model': model, 'store': False, 'max_output_tokens': 1024, 'input': [{'role': 'user', 'content': 'Call codex_switch_test with value ping, then report its result.'}],
        'tools': [{'type': 'function', 'name': 'codex_switch_test', 'description': 'Return the supplied value.',
                   'parameters': {'type': 'object', 'properties': {'value': {'type': 'string'}}, 'required': ['value'], 'additionalProperties': False}}]}
    if effort:
        body['reasoning'] = {'effort': effort}
        body['include'] = ['reasoning.encrypted_content']
    response = request(provider, '/responses', body)
    output = response.get('output', [])
    calls = [o for o in output if o.get('type') == 'function_call' and o.get('name') == 'codex_switch_test' and o.get('call_id')]
    if not calls:
        raise ValueError('Model did not return a function call')
    body['input'] += output + [{'type': 'function_call_output', 'call_id': call['call_id'], 'output': 'ping'} for call in calls]
    reply = request(provider, '/responses', body)
    if not any(o.get('type') == 'message' and any(c.get('type') == 'output_text' and c.get('text') for c in o.get('content', [])) for o in reply.get('output', [])):
        raise ValueError('Model did not complete the tool round-trip')
    data['validatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    data['needsTest'] = False
    data['tested'] = {'model': model, 'effort': effort, 'at': data['validatedAt']}
    s.atomic(cache_path(provider), json.dumps(data))
    return state(provider)
