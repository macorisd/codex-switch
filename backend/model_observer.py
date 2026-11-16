"""Metadata-only observer for an IDE child that predates our activation."""
import json
from pathlib import Path
import sys
from window_launcher import ModelChanges, atomic

binding = json.loads(Path(sys.argv[1]).read_text('utf-8'))
target = Path(sys.argv[1]).parents[2] / 'workspaces' / binding['workspace'] / 'native-model.json'
changes = ModelChanges(binding, lambda event: atomic(target, event))
for line in sys.stdin.buffer:
    try:
        value = json.loads(line)
        if value['direction'] == 'request': changes.request(value['message'])
        else: changes.response(value['message'])
        print(json.dumps({'id': value['id'], 'ok': True}), flush=True)
    except Exception:
        print(json.dumps({'id': value.get('id'), 'ok': False}), flush=True)
