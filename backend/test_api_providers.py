"""Offline provider contracts and complete config flows; never uses a real key/network."""
import copy
import json
from pathlib import Path
import tempfile
import tomllib
import unittest
from unittest.mock import patch
import urllib.error
import api_providers as api
import bridge
import switcher as s


class ProvidersTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.paths = patch.multiple(s, ROOT=root, CONFIG=root/'config.toml', KEY=root/'deepseek-key.dpapi',
                                    CATALOG=root/'deepseek-models.json', STATE=root/'previous-settings.json')
        self.paths.start(); s.initialize()
        self.original = 'model = "gpt-original"\nmodel_reasoning_effort = "medium"\n\n[desktop]\nfollowUpQueueMode = "steer"\n\n[model_providers.personal]\nbase_url = "https://example.invalid"\n'
        s.CONFIG.write_text(self.original, encoding='utf-8')
        self.auth = root.parent / (root.name + '-auth.json')
        self.auth.write_text('UNCHANGED-CHATGPT-AUTH', encoding='utf-8')
        self.keys = {}
        def save(path, value): self.keys[str(path)] = value; return 'encrypted-marker'
        self.stores = [patch.object(s.credential_store, 'save', side_effect=save),
                       patch.object(s.credential_store, 'load', side_effect=lambda p: self.keys[str(p)])]
        for mock in self.stores: mock.start()
        self.addCleanup(self.temp.cleanup); self.addCleanup(self.paths.stop)
        for mock in self.stores: self.addCleanup(mock.stop)
        self.addCleanup(lambda: self.auth.unlink(missing_ok=True))
        self.requests = []

    def mock_api(self, request, **kwargs):
        self.requests.append((request.full_url, request.headers, json.loads(request.data) if request.data else None))
        class Response:
            def __enter__(inner): return inner
            def __exit__(inner, *args): pass
            def read(inner, *args): return json.dumps(self.reply(request)).encode()
        return Response()

    def reply(self, request):
        if request.full_url.endswith('/key'): return {'data': {'limit_remaining': 10}}
        if request.full_url.endswith('/credits'): return {'data': {'total_credits': 20, 'total_usage': 5}}
        if request.full_url.endswith('/users/me/balance'): return {'status': True, 'code': 0, 'data': {'available_balance': 8}}
        if request.full_url.endswith('/responses'):
            body=json.loads(request.data)
            if len(body['input']) == 1:
                return {'output': [{'type': 'reasoning', 'encrypted_content': 'opaque'}, {'type': 'function_call', 'name': 'codex_switch_test', 'call_id': 'call_1', 'arguments': '{"value":"ping"}'}]}
            return {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': 'ping'}]}]}
        provider=next(p for p in api.DEFINITIONS if request.full_url.startswith(api.endpoint(p['id'])+'/'))
        model=(provider['fallbackModels'] or {'openrouter':['anthropic/claude-example'],'openai-api':['gpt-5.2'],'xai':['grok-4.7']}.get(provider['id'], ['deepseek-flash']))[0]
        return {'data': [{'id': model, 'supported_parameters':['tools','reasoning'], 'architecture':{'input_modalities':['text'], 'output_modalities':['text']}}]}

    def action(self, provider, operation, **values):
        return bridge.handle(dict(action='api', provider=provider, operation=operation, **values))

    @patch('urllib.request.OpenerDirector.open')
    def test_all_provider_flows_preserve_chatgpt_and_unrelated_settings(self, open_mock):
        open_mock.side_effect=self.mock_api
        # DeepSeek keeps its dedicated official catalog adapter.
        with patch.object(s, 'verify_api', return_value=['deepseek-flash']), patch.object(s, 'refresh_catalog'):
            for p in api.DEFINITIONS:
                with self.subTest(provider=p['id']):
                    provider=p['id']; key='test-only-'+provider
                    self.action(provider,'saveKey',key=key)
                    result=self.action(provider,'refresh')
                    self.assertTrue(result['valid']); self.assertTrue(result['models'])
                    m=result['models'][0]; effort=m['efforts'][-1] if m['efforts'] else ''
                    self.action(provider,'select',model=m['id'],effort=effort)
                    self.action(provider,'test')
                    tested=self.action(provider,'status'); self.assertEqual(tested['tested']['model'],m['id'])
                    self.action(provider,'apply')
                    config=tomllib.loads(s.CONFIG.read_text('utf-8'))
                    self.assertEqual(config['model_provider'],provider)
                    self.assertEqual(config['model'],m['id'])
                    self.assertEqual(config['model_providers'][provider]['wire_api'],'responses')
                    self.assertEqual(config['model_providers'][provider]['auth']['args'][-1],provider)
                    self.assertNotIn('forced_login_method',config)
                    self.assertIn('personal',config['model_providers'])
                    self.assertNotIn(key,s.CONFIG.read_text('utf-8'))
                    self.assertNotIn(key,json.dumps(result))
            bridge.handle({'action':'apply','provider':'openai'})
        final=tomllib.loads(s.CONFIG.read_text('utf-8'))
        expected=tomllib.loads(self.original); expected['model_provider']='openai'
        self.assertEqual(final,expected)
        self.assertEqual(self.auth.read_text(),'UNCHANGED-CHATGPT-AUTH')
        self.assertEqual(len(self.keys),9)
        self.assertTrue(any('/key' in url for url, _, _ in self.requests))
        replay=[body for url,_,body in self.requests if url.endswith('/responses') and len(body['input'])>1]
        self.assertTrue(all(body['input'][1]['encrypted_content']=='opaque' for body in replay))

    @patch('urllib.request.OpenerDirector.open')
    def test_fallback_requires_explicit_model_test_not_fake_validation(self, mock):
        self.action('zai','saveKey',key='test-key-zai')
        mock.side_effect=urllib.error.HTTPError('https://api.z.ai',404,'Not found',{},None)
        value=self.action('zai','refresh')
        mock.side_effect.close()
        self.assertFalse(value['valid']); self.assertTrue(value['needsTest'])
        self.assertEqual(value['models'][0]['id'],'glm-5.3')
        with self.assertRaises(ValueError): self.action('zai','apply')
        self.assertEqual(s.CONFIG.read_text(),self.original)
        mock.side_effect=self.mock_api
        value=self.action('zai','test'); self.assertTrue(value['valid'])
        self.action('zai','apply')

    @patch('urllib.request.OpenerDirector.open')
    def test_auth_failures_never_use_fallback_or_expose_private_response(self,mock):
        for code in (401,403,429,500):
            self.action('minimax','saveKey',key='test-key-minimax')
            mock.side_effect=urllib.error.HTTPError('https://api.minimax.io',code,'private',{},None)
            with self.assertRaises(urllib.error.HTTPError): self.action('minimax','refresh')
            self.assertFalse(self.action('minimax','status')['valid'])
            mock.side_effect.close()

    def test_normalization_rejects_unsafe_and_incompatible_models(self):
        items=[None, {'id':'bad\nmodel'}, {'id':'lab/no-tools'}, {'id':'lab/image','supported_parameters':['tools'],'architecture':{'output_modalities':['image']}},
               {'id':'anthropic/claude','supported_parameters':['tools','reasoning'],'context_length':200000},
               {'id':'google/gemini','supported_parameters':['tools'],'architecture':{'input_modalities':['text','image']}},
               {'id':'google/gemini','supported_parameters':['tools']}]
        result=api.normalize('openrouter',items)
        self.assertEqual([m['id'] for m in result],['anthropic/claude','google/gemini'])
        self.assertTrue(result[1]['image']); self.assertFalse(result[0]['freeform'])
        self.assertEqual(api.normalize('openai-api',[{'id':'gpt-3.5-turbo'},{'id':'gpt-5-audio'},{'id':'text-embedding-3'}]),[])
        self.assertEqual(api.normalize('xai',[{'id':'grok-unknown'}])[0]['efforts'],[])

    def test_free_model_metadata_uses_verified_ids_or_explicit_zero_prices(self):
        items = [
            {'id':'lab/a:free'}, {'id':'openrouter/free'},
            {'id':'lab/zero', 'pricing':{'prompt':'0','completion':'0','request':'0'}},
            {'id':'lab/paid', 'pricing':{'prompt':'0','completion':'0.01'}},
            {'id':'lab/request-fee', 'pricing':{'prompt':'0','completion':'0','request':'0.01'}},
            {'id':'lab/unknown', 'name':'Freedom'},
            {'id':'lab/invalid', 'pricing':{'prompt':'NaN','completion':'0'}},
            {'id':'lab/missing', 'pricing':{'prompt':'0'}},
            {'id':'lab/tiny', 'pricing':{'prompt':'1e-999','completion':'0'}},
        ]
        for item in items:
            item['supported_parameters'] = ['tools']
        models = api.normalize('openrouter', items)
        self.assertEqual([m['free'] for m in models], [True,True,True,False,False,False,False,False,False])
        # A future aggregator can declare its own free identifiers, without UI logic.
        self.assertTrue(api.free_model({'freeModelSuffix':'-gratis'}, {'id':'lab/model-gratis'}))
        self.assertFalse(api.free_model({}, {'id':'lab/a:free'}))

    def test_native_keyring_services_are_isolated_and_legacy_deepseek_is_unchanged(self):
        services=[s.credential_store.service(api.key_path(p)) for p in api.PROVIDERS]
        self.assertEqual(len(set(services)),9)
        import hashlib
        expected='codex-switch.deepseek.'+hashlib.sha256(str(s.KEY.resolve().parent).encode('utf-8')).hexdigest()
        self.assertEqual(s.credential_store.service(s.KEY),expected)

    @patch('urllib.request.OpenerDirector.open')
    def test_selection_and_endpoint_validation(self,mock):
        mock.side_effect=self.mock_api
        self.action('mimo','saveKey',key='test-key-mimo'); self.action('mimo','refresh')
        for model,effort in [('injected',''),('mimo-v2.6-pro','ultra')]:
            with self.assertRaises(ValueError): self.action('mimo','select',model=model,effort=effort)
        for url in ['http://api.xiaomimimo.com/v1','https://api.xiaomimimo.com.evil/v1','https://user:pw@api.xiaomimimo.com/v1','https://evil.invalid/v1']:
            with self.assertRaises(ValueError): api.configure_endpoint('mimo',url)
        api.configure_endpoint('mimo','https://token-plan-cn.xiaomimimo.com/v1')
        self.assertFalse(api.state('mimo')['valid'])
        api.configure_endpoint('qwen','https://workspace123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1')
        self.assertIn('workspace123',api.endpoint('qwen'))
        with self.assertRaises(ValueError): api.definition('arbitrary')
        self.assertIsNone(api.NoRedirect().redirect_request(None,None,None,None,None,None))

    @patch('api_providers.request')
    def test_balance_uses_real_units_and_rejects_missing_nonfinite_metrics(self,mock):
        mock.return_value={'data':{'total_credits':10,'total_usage':3}}
        self.assertEqual(api.balance('openrouter'),{'total':7,'currency':'USD'})
        for payload in ({'data':{}},{'data':{'total_credits':float('nan'),'total_usage':1}}):
            mock.return_value=payload; self.assertIsNone(api.balance('openrouter'))
        mock.return_value={'status':True,'data':{'available_balance':3}}
        self.assertEqual(api.balance('moonshot')['currency'],'USD')
        api.configure_endpoint('moonshot','https://api.moonshot.cn/v1')
        self.assertEqual(api.balance('moonshot')['currency'],'CNY')
        for provider in ('openai-api','zai','qwen','xai','mimo'):
            mock.reset_mock(); self.assertIsNone(api.balance(provider)); mock.assert_not_called()

    @patch('api_providers.request')
    def test_model_test_rejects_missing_tools_and_incomplete_replay(self,mock):
        self.action('zai','saveKey',key='test-key-zai')
        mock.return_value={'data':[{'id':'glm-5.3'}]}
        self.action('zai','refresh')
        mock.return_value={'output':[{'type':'message','content':[{'type':'output_text','text':'no tool'}]}]}
        with self.assertRaises(ValueError): self.action('zai','test')
        mock.side_effect=[{'output':[{'type':'function_call','name':'codex_switch_test','call_id':'call_1'}]},{'output':[]}]
        with self.assertRaises(ValueError): self.action('zai','test')
        self.assertIsNone(api.state('zai')['tested'])
        self.assertEqual(s.CONFIG.read_text(),self.original)

    @patch('api_providers.request')
    def test_native_openai_metadata_intersects_accessible_ids_without_identity(self,mock):
        with patch.object(s,'ROOT',s.ROOT/'provider-switcher'):
            (s.ROOT.parent/'models_cache.json').write_text(json.dumps({'identity':{'private':'never-forward'},'models':[
                {'slug':'gpt-6.1-sol','context_window':272000,'supported_reasoning_levels':[{'effort':'ultra'}],'default_reasoning_level':'ultra','input_modalities':['text','image'],'base_instructions':'private-instructions'},
                {'slug':'not-accessible','supported_reasoning_levels':[]}]}))
            items=api.openai_metadata([{'id':'gpt-6.1-sol'},{'id':'gpt-new'}])
            models=api.normalize('openai-api',items)
            self.assertEqual(len(models),1)
            self.assertEqual(models[0]['efforts'],['ultra']); self.assertEqual(models[0]['context'],272000)
            self.assertNotIn('private',json.dumps(items)); self.assertNotIn('not-accessible',json.dumps(items))

    @patch('api_providers.request')
    def test_minimax_uses_authoritative_percentages_only(self,mock):
        self.action('minimax','saveKey',key='sk-cp-test-only')
        mock.return_value={'model_remains':[{'model_name':'MiniMax-M*','current_interval_usage_count':22,'current_interval_total_count':100}]}
        self.assertIsNone(api.balance('minimax'))
        mock.return_value={'model_remains':[{'model_name':'MiniMax-M*','current_interval_remaining_percent':78,'current_weekly_remaining_percent':50,'weekly_boost_permille':1500,'end_time':1800000000000}]}
        value=api.balance('minimax'); self.assertEqual([w['remaining'] for w in value['windows']],[78,75])
        self.assertEqual(value['windows'][0]['resetsAt'],1800000000)
        self.action('minimax','saveKey',key='sk-api-test-only'); mock.reset_mock()
        self.assertIsNone(api.balance('minimax')); mock.assert_not_called()

    @patch('api_providers.request')
    def test_catalog_has_no_accidentally_inherited_deepseek_features(self,mock):
        models=api.normalize('openrouter',[{'id':'lab/tool','supported_parameters':['tools']}])
        api.codex_catalog('openrouter',models)
        m=json.loads(api.catalog_path('openrouter').read_text())['models'][0]
        self.assertIsNone(m['apply_patch_tool_type']); self.assertIsNone(m['default_reasoning_level'])
        self.assertFalse(m['support_verbosity']); self.assertNotIn('multi_agent_version',m)
        mimo=api.normalize('mimo',[{'id':'mimo-v2.6-pro'}]); api.codex_catalog('mimo',mimo)
        self.assertTrue(json.loads(api.catalog_path('mimo').read_text())['models'][0]['use_responses_lite'])


if __name__=='__main__': unittest.main()
