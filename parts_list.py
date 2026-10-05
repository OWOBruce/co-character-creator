"""The editor's parts list: the pieces, materials, textures (patterns, details...) and stances it offers.

parts_list.json lists them. build_web.py leaves everything else out of the editor's data (its lists, the
costume index and the checker), and serve.py won't send the meshes or textures of anything else. Parts a game
update adds are offered once a later version of the editor adds them to the list.

The list holds a short hash of each name (key()), not the name: the build hashes the names it reads from the
install and keeps those on the list. new_parts.json says which parts each update added (news()), for the editor's
What's new.
"""
import hashlib
import json
import os
import time
from functools import lru_cache

HERE = os.path.dirname(os.path.abspath(__file__))
LIST = os.path.join(HERE, 'parts_list.json')
NEWS = os.path.join(HERE, 'new_parts.json')
KINDS = ('pieces', 'materials', 'textures', 'stances')


def key(kind, name):
    """The list entry for a name: 16 hex digits of SHA-256 of 'kind:name' (lower case, as the game matches names)."""
    return hashlib.sha256(f'{kind}:{name.lower()}'.encode('utf-8')).hexdigest()[:16]


@lru_cache(maxsize=None)
def lists():
    """{kind: set of keys} of parts_list.json."""
    listed = json.load(open(LIST, encoding='utf-8'))
    return {kind: set(listed[kind]) for kind in KINDS}


def news():
    """new_parts.json's entries, oldest first: {id, title, pieces, materials, textures, stances} (keys)."""
    try:
        return json.load(open(NEWS, encoding='utf-8'))['entries']
    except (OSError, ValueError, KeyError):
        return []


def shown(kind, name):
    """True when the editor may show this piece, material, texture or stance."""
    return bool(name) and key(kind, name) in lists()[kind]


def write_list(listed, made, about):
    """Write parts_list.json with one key per line, sorted, so a change shows as a line added or removed."""
    lines = ['{', f'  "_about": {json.dumps(about)},', f'  "made": {json.dumps(made)},']
    for i, kind in enumerate(KINDS):
        keys = sorted(listed[kind])
        lines.append(f'  "{kind}": [' + ','.join(f'\n    "{k}"' for k in keys) + ('\n  ]' if keys else ']')
                     + (',' if i < len(KINDS) - 1 else ''))
    lines.append('}')
    with open(LIST + '.part', 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    for attempt in range(20):  # Dropbox holds a file for a moment while it syncs it
        try:
            os.replace(LIST + '.part', LIST)
            break
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.5)
    lists.cache_clear()
