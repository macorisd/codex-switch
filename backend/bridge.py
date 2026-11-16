"""JSON interface for the VS Code extension. Never return credentials."""
import json
import sys
import tomllib
import switcher as s
import api_providers as api
import workspace_state as ws


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
    ws.use(request.get('workspace'))
    if ws.workspace:
        ws.adopt_native()
    action = request.get('action')
    if action == 'credentialMaintenance':
        import credential_bridge
        config = credential_bridge.configuration()
        if not config or config.get('remote'):
            return {}
        for provider in api.PROVIDERS:
            key_path = api.key_path(provider)
            try:
                if request.get('mode') == 'migrate':
                    if key_path.is_file():
                        key = s.credential_store.native_load(key_path)
                        credential_bridge.exchange(provider, 'migrate', key)
                elif request.get('mode') == 'sync':
                    credential = s.credential_store.status(key_path)
                    if credential['hasKey']:
                        key = s.credential_store.load(key_path)
                        try:
                            if key_path.is_file() and s.credential_store.native_load(key_path) == key:
                                continue
                        except Exception:
                            pass
                        s.atomic(key_path, s.credential_store.native_save(key_path, key))
                    elif credential.get('known') and key_path.exists():
                        s.credential_store.native_remove(key_path)
            except Exception:
                # Missing/locked native vaults cannot erase the encrypted
                # client copy. Never return a credential or upstream error.
                pass
        return {}
    if action == 'prepareWindow':
        return ws.prepare(request)
    if action == 'windowStatus':
        return ws.status(request['window'])
    if action == 'adoptClient':
        return ws.adopt_client(request)
    if action == 'api':
        provider = request.get('provider')
        api.definition(provider)
        operation = request.get('operation')
        if operation == 'saveKey':
            api.save_key(provider, request.get('key', ''))
            return api.state(provider)
        if operation == 'removeKey': return api.remove_key(provider)
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
            if not api.state(provider)['valid']:
                raise ValueError('Validate this provider before switching.')
            api.select(provider, selected.get('model'), selected.get('effort', ''))
            if ws.workspace:
                ws.choose(provider)
            else:
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
            if ws.workspace:
                ws.choose('openai')
                return ws.preference()
            s.switch()
        elif request.get('provider') == 'deepseek':
            if ws.workspace:
                return ws.choose('deepseek')
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
        print(json.dumps({'ok': False, 'code': 'credential-store-unavailable', 'error': 'Secure credential storage is unavailable. Reconnect VS Code or unlock your local system keychain.'}))
        sys.exit(1)
    except Exception:
        # Do not expose exception text, request bodies, or upstream responses.
        print(json.dumps({'ok': False, 'error': 'The operation could not be completed. Check the API key, connection and local Codex configuration.'}))
        sys.exit(1)
