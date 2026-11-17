"""Offline billing contracts; no credentials or network are used."""
import unittest
from unittest.mock import patch
import urllib.error
import usage_metrics as usage
import api_providers as api


class UsageTests(unittest.TestCase):
    def test_zai_old_and_new_personal_windows_exclude_mcp_and_unknown_units(self):
        for kind in ('TOKENS_LIMIT', 'CREDIT_LIMIT'):
            raw = {'success': True, 'data': {'limits': [
                {'type': kind, 'unit': 3, 'number': 5, 'percentage': 20, 'nextResetTime': 1800000000000},
                {'type': kind, 'unit': 6, 'number': 1, 'percentage': 100},
                {'type': 'TIME_LIMIT', 'unit': 5, 'number': 1, 'percentage': 99},
                {'type': kind, 'unit': 100, 'number': 1, 'percentage': 50}]}}
            result = usage.zai(raw)
            self.assertEqual([w['remaining'] for w in result['windows']], [80, 0])
            self.assertEqual([w['durationMins'] for w in result['windows']], [300, 10080])
            self.assertEqual(result['windows'][0]['resetsAt'], 1800000000)
            self.assertIsNone(result['windows'][1]['resetsAt'])
        for percent in (None, True, 'nan', 101, -1):
            self.assertIsNone(usage.zai({'limits': [{'type': 'CREDIT_LIMIT', 'unit': 3, 'number': 5, 'percentage': percent}]}))
        self.assertIsNone(usage.zai({'success': False, 'data': {'limits': []}}))

    def test_mimo_money_and_plan_credits_are_not_interchanged(self):
        raw = {'object': 'balance', 'balance_infos': [{'currency': 'CNY', 'total_available': '500.50', 'frozen_balance': '20.25'}]}
        self.assertEqual(usage.mimo(raw, False), {'total': 480.25, 'currency': 'CNY'})
        self.assertIsNone(usage.mimo(raw, True))
        raw['balance_infos'][0]['currency'] = 'unknown'; self.assertIsNone(usage.mimo(raw, False))
        plan = {'object': 'token_plan', 'quota': {'remaining_credits': 8500000, 'total_credits': 10000000},
                'period': {'start_at': '2026-09-21 23:59:59', 'end_at': '2027-09-21 23:59:59'}, 'auto_renew': False}
        result = usage.mimo(plan, True)
        self.assertEqual(result['total'], 8500000); self.assertEqual(result['unit'], 'Credits'); self.assertIsNone(result.get('currency'))
        self.assertFalse(result['autoRenew']); self.assertGreater(result['periodEnd'], result['periodStart'])
        for value in (-1, 1.1, None, float('nan'), True, 9007199254740992):
            plan['quota']['remaining_credits'] = value; self.assertIsNone(usage.mimo(plan, True))

    def test_only_official_usage_origin_and_authentication_are_selected(self):
        with patch.object(api, 'request', return_value={'limits': []}) as request:
            usage.provider_balance('zai')
            request.assert_called_once_with('zai', '/api/monitor/usage/quota/limit', origin='https://api.z.ai', raw_authorization=True)
        with patch.object(api, 'endpoint', return_value='https://token-plan-cn.xiaomimimo.com/v1'), \
             patch('switcher.credential_store.load', return_value='tp-fixture-only'), patch.object(api, 'request', return_value={}) as request:
            usage.provider_balance('mimo'); request.assert_called_once_with('mimo', '/platform/token_plan')
        with patch.object(api, 'endpoint', return_value='https://api.xiaomimimo.com/v1'), \
             patch('switcher.credential_store.load', return_value='tp-fixture-only'), patch.object(api, 'request') as request:
            self.assertIsNone(usage.provider_balance('mimo')); request.assert_not_called()

    def test_unavailable_and_permission_errors_are_not_balances_or_invalid_models(self):
        with patch('switcher.credential_store.status', return_value={'hasKey': True}), patch.object(api, 'balance') as balance:
            for provider in ('openai-api', 'qwen', 'xai'):
                self.assertIsNone(usage.read(provider)['balance'])
            balance.assert_not_called()
            for code in (401, 403, 429, 500):
                balance.side_effect = urllib.error.HTTPError('https://official.invalid', code, 'private', {}, None)
                value = usage.read('openrouter'); self.assertIsNone(value['balance'])
                self.assertNotIn('private', str(value)); self.assertEqual(value['retry'], code == 429 or code >= 500)


if __name__ == '__main__':
    unittest.main()
