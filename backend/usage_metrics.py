"""Read-only billing adapters. Never infer a balance from inference rate limits."""
import datetime
from decimal import Decimal, InvalidOperation
import math
import urllib.error
import urllib.parse


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        result = float(Decimal(str(value)))
        return result if math.isfinite(result) else None
    except (InvalidOperation, ValueError, OverflowError):
        return None


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None:
            result = result.replace(tzinfo=datetime.timezone.utc)
        seconds = result.timestamp()
        return seconds if 0 < seconds <= 253402300799 else None
    except (ValueError, OverflowError, OSError):
        return None


def zai(raw):
    if raw.get('success') is False:
        return None
    data = raw.get('data', raw)
    windows = []
    for item in data.get('limits', []):
        # Observed personal-plan contracts: hours (3), weeks (6). TIME_LIMIT
        # is the unrelated MCP pool. Unknown units/types remain unavailable.
        if not isinstance(item, dict) or item.get('type') not in ('TOKENS_LIMIT', 'CREDIT_LIMIT'):
            continue
        duration = {(3, 5): 300, (6, 1): 10080}.get((item.get('unit'), item.get('number')))
        used = number(item.get('percentage'))
        if duration is None or used is None or not 0 <= used <= 100:
            continue
        reset = number(item.get('nextResetTime'))
        windows.append({'id': str(duration), 'label': '5-hour usage remaining' if duration == 300 else 'Weekly remaining',
            'durationMins': duration, 'remaining': 100 - used,
            'resetsAt': reset / 1000 if reset is not None and 0 < reset <= 253402300799000 else None})
    return {'windows': windows} if windows else None


def mimo(raw, plan):
    if plan:
        quota = raw.get('quota', {})
        remaining, total = number(quota.get('remaining_credits')), number(quota.get('total_credits'))
        if raw.get('object') != 'token_plan' or remaining is None or not 0 <= remaining <= 9007199254740991 or not remaining.is_integer():
            return None
        period = raw.get('period', {})
        return {'total': remaining, 'unit': 'Credits', 'periodEnd': timestamp(period.get('end_at')),
            'periodStart': timestamp(period.get('start_at')), 'quotaTotal': total,
            'autoRenew': raw.get('auto_renew') is True}
    entries = raw.get('balance_infos', [])
    if raw.get('object') != 'balance' or len(entries) != 1:
        return None  # Never combine different currencies or account pools.
    entry = entries[0]
    available, frozen = number(entry.get('total_available')), number(entry.get('frozen_balance'))
    currency = entry.get('currency')
    if available is None or frozen is None or frozen < 0 or currency not in ('USD', 'CNY'):
        return None
    return {'total': available - frozen, 'currency': currency}


def provider_balance(provider):
    import api_providers as api
    import switcher as s
    if provider == 'zai':
        return zai(api.request(provider, '/api/monitor/usage/quota/limit', origin='https://api.z.ai', raw_authorization=True))
    if provider == 'mimo':
        host = urllib.parse.urlparse(api.endpoint(provider)).hostname
        plan = host == 'token-plan-cn.xiaomimimo.com'
        key = s.credential_store.load(api.key_path(provider))
        if plan != key.startswith('tp-'):
            return None
        return mimo(api.request(provider, '/platform/token_plan' if plan else '/platform/balance'), plan)
    return None


def read(provider):
    import api_providers as api
    import switcher as s
    if not api.definition(provider).get('usage'):
        return {'balance': None, 'reason': 'Usage is not available with this provider credential.'}
    if not s.credential_store.status(api.key_path(provider)).get('hasKey'):
        return {'balance': None, 'reason': 'No API key is configured.'}
    try:
        value = api.balance(provider)
        return {'balance': value, 'reason': '' if value else 'No supported usage reading was reported.'}
    except urllib.error.HTTPError as error:
        reason = {401: 'Usage authentication failed.', 403: 'This key has no permission to read usage.',
            429: 'Usage refresh is rate limited.'}.get(error.code, 'Usage is temporarily unavailable.')
        return {'balance': None, 'reason': reason, 'retry': error.code == 429 or error.code >= 500}
