"""JSON interface for the VS Code extension. Never return credentials."""
import json
import sys
import tomllib
import switcher as s
import api_providers as api


def status(include_deepseek=True):
    config = tomllib.loads(s.CONFIG.read_text('utf-8-sig'))
    catalog = json.loads(s.CATALOG.read_text('utf-8')) if include_deepseek else {'models': []}
    return {
        'provider': config.get('model_provider', 'openai'),
        'model': config.get('model', ''),
        'effort': config.get('model_reasoning_effort', 'medium'),
        'hasKey': s.KEY.exists() if include_deepseek else False,
        'models': [{
            'id': m['slug'], 'name': m['display_name'],
            'image': 'image' in m.get('input_modalities', []),
            'efforts': [level['effort'] for level in m['supported_reasoning_levels']],
        } for m in catalog['models']],
    }


def handle(request):
    action = request.get('action')
    if action == 'api':
        provider = request.get('provider')
        api.definition(provider)
        operation = request.get('operation')
        if operation == 'saveKey':
            api.save_key(provider, request.get('key', ''))
            return api.state(provider)
        if operation == 'endpoint':
            api.configure_endpoint(provider, request.get('url', ''))
            return api.state(provider)
        if operation == 'status': return api.state(provider)
        if operation == 'refresh': return api.refresh(provider)
        if operation == 'balance': return api.balance(provider)
        if operation == 'test': return api.test_model(provider)
        if operation == 'select': return api.select(provider, request.get('model'), request.get('effort', ''))
        if operation == 'apply':
            selected = api.saved(provider)
            if not selected.get('validatedAt'):
                raise ValueError('Validate this provider before switching.')
            api.select(provider, selected.get('model'), selected.get('effort', ''))
            s.switch(selected['model'], selected.get('effort', ''), provider)
            return api.state(provider)
        raise ValueError('Unsupported provider operation')
    if action == 'status':
        return status(request.get('includeDeepSeek', True))
    if action == 'saveKey':
        s.save_key(request.get('key', ''))
    elif action == 'verify':
        return {'models': s.verify_api()}
    elif action == 'refresh':
        s.refresh_catalog()
    elif action == 'balance':
        return s.balance()
    elif action == 'apply':
        if request.get('provider') == 'openai':
            s.switch()
        elif request.get('provider') == 'deepseek':
            models = json.loads(s.CATALOG.read_text('utf-8'))['models']
            if not models:
                raise ValueError('No DeepSeek models are available.')
            model = models[0]
            supported = [level['effort'] for level in model['supported_reasoning_levels']]
            effort = model.get('default_reasoning_level', 'high')
            if effort not in supported:
                effort = supported[0]
            s.switch(model['slug'], effort)
        else:
            raise ValueError('Unsupported provider')
    else:
        raise ValueError('Unsupported action')
    return status()


if __name__ == '__main__':
    try:
        s.initialize()
        request = json.loads(sys.stdin.read(16384))
        result = handle(request)
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=True, allow_nan=False))
    except s.credential_store.StoreUnavailable:
        print(json.dumps({'ok': False, 'error': 'Your system keychain is locked or unavailable. Unlock it and try again.'}))
        sys.exit(1)
    except Exception:
        # Do not expose exception text, request bodies, or upstream responses.
        print(json.dumps({'ok': False, 'error': 'The operation could not be completed. Check the API key, connection and local Codex configuration.'}))
        sys.exit(1)
