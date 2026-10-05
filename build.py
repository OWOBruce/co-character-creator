"""Build everything the editor needs from a Champions Online install: python build.py [--game FOLDER] [--force]

Reads the install's .hogg archives (gamefs.py / gamedata.py) and GameClient.exe, and writes:
  catalog/schema.json          the client's parse tables, for decoding the .bin files (tools/dump_schema.py)
  catalog/*.json               the cleaned costume catalog (build_catalog.py)
  viewer/data/catalog/*.json   per-skeleton catalogs, palettes, starting costumes, shaders (build_web.py)
  viewer/data/stances.json, viewer/data/poses/   stance and body-scale animation (build_web.py)
  viewer/ui/                   the editor's skin, from the game's UI art (build_ui.py)
  index/                       the costume index: every piece, material, pattern and colour, for people and AI
                               (build_index.py; guide in index_guide.md)
  viewer/data/build.json       which install and game version this was built from
  viewer/data/whats_new.json   the pieces, materials and patterns each game patch added, and known_names.json,
                               every name seen so far (whatsnew.py)

It skips the work when build.json matches the install (same archives, same sizes and dates); --force
rebuilds anyway. serve.py runs this by itself when the build is missing or the game has been patched.
Progress lines start with '## ' (the stage) and '%% ' (how much of the build is done, 0 to 1; buildprogress.py);
serve.py shows both in the page. The bar is split between the stages by how long each took last time
(build.json stageSeconds), else by STAGES' typical seconds.
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'tools'))
from paths import data  # noqa: E402

BUILD_INFO = data('viewer', 'data', 'build.json')
VERSION = 6  # bump when the build's output changes, to force a rebuild (5: lighting.json, the creator sky's lights; 6: no vehicle bike in the index)


PACKAGES = {'PIL': 'Pillow', 'numpy': 'numpy'}  # import name -> pip name; also in requirements.txt


# (stage, typical seconds: its share of the progress bar, module)
STAGES = [('Reading the game client data tables', 1, 'dump_schema'), ('Decoding the costume definitions', 14, 'build_catalog'),
          ('Building the editor catalog, stances and shaders', 34, 'build_web'), ('Building the interface art', 1, 'build_ui'),
          ('Building the costume index', 30, 'build_index')]  # seconds from a build on 2026-09-30


def step(msg):
    print('## ' + msg, flush=True)


def missing_packages():
    """pip names of the packages the build needs that aren't installed."""
    import importlib.util
    return [pip for mod, pip in PACKAGES.items() if importlib.util.find_spec(mod) is None]


def current(folder=None):
    """{folder, stamp, version} of the install as it is now."""
    from gamefs import default_folder, open_game
    fs = open_game(default_folder(folder))
    return {'folder': fs.folder, 'stamp': fs.stamp(), 'version': VERSION}


def built():
    try:
        return json.load(open(BUILD_INFO, encoding='utf-8'))
    except (OSError, ValueError):
        return None


def up_to_date(folder=None):
    b, c = built(), current(folder)
    return bool(b) and all(b.get(k) == c[k] for k in ('folder', 'stamp', 'version'))


def run(folder=None, force=False):
    from gamefs import default_folder, save_settings, load_settings
    folder = default_folder(folder)
    if folder:  # the build and the server read the same install
        s = load_settings()
        if s.get('gameFolder') != folder:
            s['gameFolder'] = folder
            save_settings(s)
    if not force and up_to_date(folder):
        step('Up to date')
        return
    missing = missing_packages()
    if missing:
        step('Missing Python packages: ' + ', '.join(missing) + '. Run start.bat again, or: python -m pip install -r requirements.txt')
        sys.exit(1)
    t0 = time.time()
    info = current(folder)
    step(f'Reading {info["folder"]}')
    import importlib
    import whatsnew
    from buildprogress import span, timed
    before = built() or {}
    last = before.get('stageSeconds') or {}
    # what's new is what this build has and the last one didn't: note the last one's names first, if there's
    # nothing noted yet (the first patch after an editor update that brought this)
    try:
        whatsnew.baseline()
    except Exception as e:  # never stops the build
        print(f"Could not note what's in the game for what's new: {e!r}", flush=True)
    weights = [max(1, last.get(name, typical)) for name, typical, _ in STAGES]
    edges = [sum(weights[:i]) / sum(weights) for i in range(len(weights) + 1)]
    seconds = {}
    for i, (name, _, module) in enumerate(STAGES):
        step(name)
        t = time.time()
        with span(edges[i], edges[i + 1]), timed(weights[i]):
            # imported only now: a stage's modules read what the stages before it wrote (e.g. schema.json)
            importlib.import_module(module).main()
        seconds[name] = round(time.time() - t, 1)
    # a patch: the same install with other archives (not another folder, nor only a newer build.py)
    patched = before.get('folder') == info['folder'] and before.get('stamp') not in (None, info['stamp'])
    try:
        entry = whatsnew.record(patched)
        if entry:
            print("What's new: " + ', '.join(f'{sum(map(len, entry[k].values()))} {k}' for k, _ in whatsnew.KINDS), flush=True)
    except Exception as e:
        print(f"Could not work out what's new in the game: {e!r}", flush=True)
    json.dump({**info, 'builtAt': time.strftime('%Y-%m-%d %H:%M:%S'), 'seconds': round(time.time() - t0),
               'stageSeconds': seconds}, open(BUILD_INFO, 'w', encoding='utf-8'), indent=1)
    step(f'Done in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    args = sys.argv[1:]
    game = args[args.index('--game') + 1] if '--game' in args and args.index('--game') + 1 < len(args) else None
    run(game, force='--force' in args)
