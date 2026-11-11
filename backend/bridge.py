"""JSON interface for the VS Code extension. Never return credentials."""
import json
import sys
import tomllib
import switcher as s


def status(include_deepseek=True):
    config = tomllib.loads(s.CONFIG.read_text('utf-8-sig'))
    catalog = json.loads(s.CATALOG.read_text('utf-8')) if include_deepseek or config.get('model_provider') == 'deepseek' else {'models': []}
    return {
        'provider': config.get('model_provider', 'openai'),
        'model': config.get('model', ''),
        'effort': config.get('model_reasoning_effort', 'medium'),
        'hasKey': s.KEY.exists(),
        'models': [{
            'id': m['slug'], 'name': m['display_name'],
            'image': 'image' in m.get('input_modalities', []),
            'efforts': [level['effort'] for level in m['supported_reasoning_levels']],
        } for m in catalog['models']],
    }


def handle(request):
    action = request.get('action')
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
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=True))
    except Exception:
        # Do not expose exception text, request bodies, or upstream responses.
        print(json.dumps({'ok': False, 'error': 'The operation could not be completed. Check the API key, connection and local Codex configuration.'}))
        sys.exit(1)
