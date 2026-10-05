"""What's new in the game: the pieces, materials and patterns (textures) a game patch added.

  python whatsnew.py --baseline    note what's in the current build, if nothing has been noted yet

build.py calls baseline() before a build and record() after it. record() compares the new catalogs
(viewer/data/catalog/<skeleton>.json) with every name seen in earlier builds (viewer/data/known_names.json) and,
when the game itself changed, logs the new names in viewer/data/whats_new.json. The editor shows a log entry
once, after the patch (viewer/js/whats-new.js), and decides there which of the names it offers: the log keeps
everything new, NPC and unused pieces too.

The first time there's nothing to compare with, so it only notes what's there: what's new is tracked from then
on. serve.py runs the --baseline line once when the editor starts with a current build and nothing noted yet.

A rebuild because the editor changed (build.VERSION) or another game folder was picked isn't a patch: it
updates the names without logging them, so pieces the editor starts to show don't look new.
"""
import json
import os
import sys
import time

from paths import data

CATALOG = data('viewer', 'data', 'catalog')
KNOWN = data('viewer', 'data', 'known_names.json')
LOG = data('viewer', 'data', 'whats_new.json')
SKELETONS = ('Male', 'Female')
KINDS = (('pieces', 'geometries'), ('materials', 'materials'), ('textures', 'textures'))  # log name, catalog key
KEEP = 20  # log entries kept


def names(catalog=CATALOG):
    """{skeleton: {kind: [name]}} of the built catalogs; None when there's no build."""
    out = {}
    for sk in SKELETONS:
        try:
            cat = json.load(open(os.path.join(catalog, sk + '.json'), encoding='utf-8'))
        except (OSError, ValueError):
            return None
        out[sk] = {kind: sorted(cat.get(key) or {}) for kind, key in KINDS}
    return out


def load(path):
    try:
        return json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError):
        return None


def save(path, obj):
    """Write a temporary file and swap it in, so an interrupted write never leaves half a file."""
    with open(path + '.part', 'w', encoding='utf-8') as f:
        json.dump(obj, f, separators=(',', ':'))
    os.replace(path + '.part', path)


def baseline(catalog=CATALOG, known=KNOWN):
    """Note the names in the current build, unless some are noted already. True when it noted them."""
    if os.path.isfile(known):
        return False
    now = names(catalog)
    if now is None:
        return False
    save(known, now)
    return True


def record(game_changed, catalog=CATALOG, known=KNOWN, log=LOG):
    """After a build: log the names no earlier build had, when the game changed, and note them all.
    Returns the new log entry, or None."""
    now = names(catalog)
    if now is None:
        return None
    seen = load(known)
    if seen is None:  # nothing noted yet: from now on
        save(known, now)
        return None
    new = {kind: {sk: sorted(set(now[sk][kind]) - set((seen.get(sk) or {}).get(kind) or [])) for sk in SKELETONS}
           for kind, _ in KINDS}
    new = {kind: {sk: n for sk, n in by.items() if n} for kind, by in new.items()}
    entry = None
    if game_changed and any(new.values()):
        entry = {'id': time.strftime('%Y%m%d-%H%M%S'), 'date': time.strftime('%Y-%m-%d'), **new}
        entries = ((load(log) or {}).get('entries') or []) + [entry]
        save(log, {'entries': entries[-KEEP:]})
    # every name ever seen: a piece the game drops and brings back later isn't new again
    save(known, {sk: {kind: sorted(set(now[sk][kind]) | set((seen.get(sk) or {}).get(kind) or [])) for kind, _ in KINDS}
                 for sk in SKELETONS})
    return entry


if __name__ == '__main__':
    if '--baseline' in sys.argv[1:]:
        print('Noted the current pieces, materials and patterns' if baseline() else 'Nothing to do')
    else:
        print(__doc__)
