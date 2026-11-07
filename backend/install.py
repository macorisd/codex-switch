"""Generate optional CLI profiles; leave the default Codex configuration intact."""
import json
import os
from pathlib import Path
import subprocess
import switcher as s

s.initialize()
for model in json.loads(s.CATALOG.read_text('utf-8'))['models']:
    values = {'model': model['slug'], 'model_provider': 'deepseek',
              'model_reasoning_effort': 'high', 'web_search': 'disabled',
              'model_catalog_json': str(s.CATALOG)}
    profile = ''.join(k + ' = ' + json.dumps(v) + '\n' for k, v in values.items())
    profile += s.provider_block()
    s.atomic(s.ROOT.parent / (model['slug'] + '.config.toml'), profile)
    command = ['codex', '--profile', model['slug'], 'debug', 'prompt-input', 'Offline configuration check.']
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', timeout=40)
    if result.returncode:
        raise RuntimeError(result.stderr)
    json.loads(result.stdout)
    print(model['slug'] + ': runtime profile and model catalog accepted (offline).')
