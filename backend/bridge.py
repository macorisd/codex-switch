"""JSON interface for the VS Code extension. Never return credentials."""
import json
import sys
import tomllib
import switcher as s


def status():
    config = tomllib.loads(s.CONFIG.read_text('utf-8-sig'))
    catalog = json.loads(s.CATALOG.read_text('utf-8'))
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
        return status()
    if action == 'saveKey':
        s.save_key(request.get('key', ''))
    elif action == 'verify':
        return {'models': s.verify_api()}
    elif action == 'refresh':
        s.refresh_catalog()
    elif action == 'apply':
        if request.get('provider') == 'openai':
            s.switch()
        elif request.get('provider') == 'deepseek':
            models = json.loads(s.CATALOG.read_text('utf-8'))['models']
            if request.get('model') not in [model['slug'] for model in models]:
                raise ValueError('Unsupported model')
            s.switch(request.get('model'), request.get('effort', 'high'))
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
        print(json.dumps({'ok': False, 'error': 'No se pudo completar la operacion. Comprueba la clave, la conexion y la configuracion local de Codex.'}))
        sys.exit(1)
