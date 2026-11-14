"""Conditional journal of native API-model writes to shared user defaults."""
import json
import os
from pathlib import Path
import re
import time
import tomllib
import uuid
from contextlib import contextmanager


def lines(text):
    result, table, quote = {}, '', None
    for line in text.splitlines(keepends=True):
        if quote is None:
            header = re.fullmatch(r'\s*\[(.+)\]\s*(?:#.*)?', line.strip())
            if header:
                table = header[1]
                result[(table, '__table__')] = line
            match = re.match(r"""\s*["']?(model|model_reasoning_effort|model_provider|profile)["']?\s*=""", line)
            if match:
                result[(table, match[1])] = line
        index = 0
        while index < len(line):
            char = line[index]
            if quote:
                if char == '\\' and quote.startswith('"'):
                    index += 2
                    continue
                if line.startswith(quote, index):
                    index += len(quote)
                    quote = None
                    continue
            elif char == '#':
                break
            elif char in ('"', "'"):
                quote = char * 3 if line.startswith(char * 3, index) else char
                index += len(quote)
                continue
            index += 1
    return result


def profile_table(raw, profile, fallback):
    for table, marker in raw:
        if marker != '__table__':
            continue
        try:
            header = tomllib.loads('[' + table + ']\nvalue = true\n')
            if profile in header.get('profiles', {}):
                return table
        except tomllib.TOMLDecodeError:
            continue
    return fallback


def capture(binding, params):
    config = Path(binding['config'])
    text = config.read_bytes().decode('utf-8-sig') if config.exists() else ''
    parsed, raw = tomllib.loads(text), lines(text)
    profile = binding.get('profile')
    edits = params.get('edits', [params])
    result = []
    for edit in edits:
        key = edit.get('keyPath')
        table = ''
        if profile:
            for name in ('profiles.' + profile, 'profiles.' + json.dumps(profile)):
                if isinstance(key, str) and key.startswith(name + '.'):
                    table, key = name, key[len(name) + 1:]
                    # Preserve the actual header spelling, including quoted
                    # profile names and whitespace in existing user TOML.
                    table = profile_table(raw, profile, table)
        if key not in ('model', 'model_reasoning_effort'):
            continue
        provider = parsed.get('profiles', {}).get(profile, {}).get('model_provider',
            parsed.get('model_provider', 'openai')) if table else parsed.get('model_provider', 'openai')
        result.append({'table': table, 'key': key, 'before': raw.get((table, key)),
            'value': edit.get('value'), 'incompatible': provider != binding['provider'],
            'globalProvider': provider, 'activeProfile': parsed.get('profile'),
            'guards': [{'table': t, 'key': k, 'line': raw.get((t, k))}
                       for t, k in {('', 'model_provider'), ('', 'profile'), (table, 'model_provider')}]})
    return result


@contextmanager
def lock(root):
    from window_launcher import process_identity, atomic
    directory = root / 'lifecycle-lock'
    directory.mkdir(exist_ok=True)
    token = str(os.getpid()) + '-' + uuid.uuid4().hex + '.json'
    target = directory / token
    identity = {'pid': os.getpid(), 'ownerStart': process_identity(os.getpid())}

    def participants():
        result = []
        for file in directory.glob('*.json'):
            if file == target:
                continue
            try:
                owner = json.loads(file.read_text())
            except (OSError, ValueError):
                continue
            started = process_identity(owner.get('pid'))
            if not started or (owner.get('ownerStart') and owner['ownerStart'] != started):
                file.unlink(missing_ok=True)
            else:
                result.append({**owner, 'token': file.name})
        return result

    atomic(target, {**identity, 'choosing': True, 'ticket': 0})
    try:
        ticket = 1 + max([0] + [owner.get('ticket', 0) for owner in participants()])
        atomic(target, {**identity, 'choosing': False, 'ticket': ticket})
        for attempt in range(150):
            blocked = any(owner.get('choosing') or owner['ticket'] < ticket
                or (owner['ticket'] == ticket and owner['token'] < token) for owner in participants())
            if not blocked:
                break
            time.sleep(.02)
        else:
            raise OSError('Configuration busy')
        yield
    finally:
        target.unlink(missing_ok=True)


def accepted(binding, captured):
    if not captured:
        return
    config = Path(binding['config'])
    root = Path(binding['launcher']).parent
    with lock(root):
        text = config.read_bytes().decode('utf-8-sig')
        parsed, raw = tomllib.loads(text), lines(text)
        file = root / 'model-defaults.json'
        try:
            journal = json.loads(file.read_text(encoding='utf-8'))
        except FileNotFoundError:
            journal = {'config': str(config), 'edits': []}
        for edit in captured:
            table = profile_table(raw, binding.get('profile'), edit['table']) if edit['table'] else ''
            key = edit['key']
            previous = next((item for item in journal['edits'] if item['table'] == table and item['key'] == key), None)
            current = parsed.get('profiles', {}).get(binding.get('profile'), {}) if table else parsed
            if current.get(key) != edit['value']:
                continue
            current_provider = current.get('model_provider', parsed.get('model_provider', 'openai'))
            if current_provider != edit['globalProvider'] or parsed.get('profile') != edit['activeProfile']:
                continue
            journal['edits'] = [item for item in journal['edits'] if (item['table'], item['key']) != (table, key)]
            if binding['provider'] == 'openai' or not edit['incompatible']:
                continue
            after = raw.get((table, key))
            if not after or '\n' in after.rstrip('\r\n'):
                continue
            before = previous['before'] if previous and previous['after'] == edit['before'] else edit['before']
            guards = [{'table': t, 'key': k, 'line': raw.get((t, k))}
                      for t, k in {('', 'model_provider'), ('', 'profile'), (table, 'model_provider')}]
            journal['edits'].append({**edit, 'table': table, 'before': before, 'after': after, 'guards': guards})
        from window_launcher import atomic
        atomic(file, journal)


def import_legacy():
    """Recover provenance from 0.5.0's accepted native-model receipts once."""
    import switcher as s
    import api_providers as api
    marker = s.ROOT / 'legacy-model-recovery.json'
    if marker.exists():
        return
    config = tomllib.loads(s.CONFIG.read_bytes().decode('utf-8-sig'))
    journal = s.ROOT / 'model-defaults.json'
    if not journal.exists() and config.get('model_provider', 'openai') == 'openai':
        candidates = []
        for file in (s.ROOT / 'workspaces').glob('*/native-model.json'):
            try:
                event = json.loads(file.read_text(encoding='utf-8'))
                if (event.get('provider') in api.PROVIDERS and event.get('model') == config.get('model')
                        and re.fullmatch('[a-f0-9]{32}', event.get('nonce', ''))):
                    binding = json.loads((s.ROOT / 'windows' / event['nonce'] / 'binding.json').read_text(encoding='utf-8'))
                    if binding.get('provider') == event['provider'] and not binding.get('profile'):
                        candidates.append((event.get('sequence', 0), file))
            except (OSError, ValueError, KeyError):
                continue
        if candidates:
            file = max(candidates)[1]
            event = json.loads(file.read_text(encoding='utf-8'))
            try:
                baseline = json.loads(s.STATE.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                try:
                    baseline = json.loads(file.with_name('selection.json').read_text(encoding='utf-8')).get('chatgpt', {})
                except (OSError, ValueError):
                    baseline = {}
            baseline = s.normalized_chatgpt_values(baseline)
            raw = lines(s.CONFIG.read_bytes().decode('utf-8-sig'))
            newline = '\r\n' if raw.get(('', 'model'), '').endswith('\r\n') else '\n'
            guards = [{'table': '', 'key': key, 'line': raw.get(('', key))} for key in ('profile', 'model_provider')]
            edits = [{'table': '', 'key': key, 'after': raw[('', key)],
                      'before': key + ' = ' + baseline[key] + newline if key in baseline else None,
                      'guards': guards}
                     for key in ('model', 'model_reasoning_effort') if ('', key) in raw
                     and (key == 'model' or config.get(key) == event.get('effort'))]
            s.atomic(journal, json.dumps({'config': str(s.CONFIG), 'edits': edits}))
    s.atomic(marker, json.dumps({'schema': 1}))
