"""Regression tests for the costume editor: python tests/run.py [--quick] [--no-browser | --browser-only] [--show]

Checks the editor's data and code against the game install it was built from:
  build        the editor's data matches the install (else: python build.py)
  game data    every .bin decodes without errors; every .mset header reads; every .atrk decodes (skipped by --quick)
  meshes       every player piece finds the model its geometry names, and its mesh decodes (all pieces; --quick: a
               sample); the browser's reader (viewer/js/mset.js, run in Node) agrees with tools/mset.py
  stances      every player stance, mode and mood, sub-skeleton animation and body-scale track has its pose file
  checker      costume_check.py accepts every starting costume and the example costume
  index        each piece appears once, no deprecated categories, the counts in the file headers are right
  parts list   the data holds only what the parts list has (parts_list.py), and the server sends only its
               meshes and textures
  what's new   whats_new.json has every new_parts.json entry, naming only parts the editor offers
  browser      viewer/test.html in headless Edge: saved costumes round-trip, starting costumes load, materials
               compile, pose buttons (--no-browser skips; --show opens a visible window instead)

Accepted exceptions (game-data quirks) are in tests/known.json. Exit code 0 when everything passes.
"""
import glob
import json
import os
import random
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path[:0] = [ROOT, os.path.join(ROOT, 'tools')]
from paths import data  # noqa: E402

DATA = data('viewer', 'data')
KNOWN = json.load(open(os.path.join(HERE, 'known.json'), encoding='utf-8'))
DEV = re.compile(r'^\s*(NPC|UNUSED|SCALE TEST|DEPRECATED)\b', re.I)
ARGS = sys.argv[1:]
QUICK = '--quick' in ARGS

RESULTS = []  # (name, checked, failures, notes, seconds)
# below-normal priority for this process and what it starts (server, browser, Node): the tests take their time
# rather than crowd out everything else on the machine
LOW = {'creationflags': 0x4000} if os.name == 'nt' else {}  # BELOW_NORMAL_PRIORITY_CLASS


def lower_priority():
    if os.name == 'nt':
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
    else:
        os.nice(10)


def test(fn):
    """Run one check: fn(fail, note) -> number of things checked."""
    name = fn.__doc__.strip().splitlines()[0]
    failures, notes = [], []
    print(f'-- {name} ...', flush=True)
    t0 = time.time()
    try:
        checked = fn(failures.append, notes.append)
    except Exception as e:
        checked = 0
        failures.append(f'crashed: {type(e).__name__}: {e}\n' + traceback.format_exc(limit=3))
    RESULTS.append((name, checked, failures, notes, time.time() - t0))
    report(RESULTS[-1])
    return not failures


def report(r):
    name, checked, failures, notes, secs = r
    print(f'{"FAIL" if failures else "PASS"} {name}: {checked} checked'
          + (f', {len(failures)} failed' if failures else '') + f' ({secs:.0f} s)', flush=True)
    for f in failures[:15]:
        print('   x ' + f)
    if len(failures) > 15:
        print(f'   … {len(failures) - 15} more')
    for n in notes[:8]:
        print('   - ' + n)
    if len(notes) > 8:
        print(f'   … {len(notes) - 8} more notes')


def catalog(sk):
    return json.load(open(os.path.join(DATA, 'catalog', sk + '.json'), encoding='utf-8'))


def is_left_out_bone(cat, bone):  # weapons and the vehicle bike, as viewer/js/rules.js isLeftOutBone
    return (cat['bones'].get(bone) or {}).get('region') == 'Weapons' or re.search(r'_Weapon_(Melee|Ranged)$|_Vehicle_Attach', bone, re.I)


def model_index(models, hint):  # as MSet.modelIndex in viewer/js/mset.js
    idx = next((i for i, m in enumerate(models) if m['lods']), 0)
    for i, m in enumerate(models):
        if hint and m['lods'] and m['name'].lower() == hint.lower():
            idx = i
    return idx


# ---- checks -----------------------------------------------------------------------------------------
def t_build(fail, note):
    """The editor's data is built from the current install"""
    import build
    b = build.built()
    if not b:
        fail('no build (viewer/data/build.json): run python build.py')
    elif not build.up_to_date(b.get('folder')):
        fail(f'the build is out of date for {b.get("folder")} (game patched, or build.py changed): run python build.py')
    else:
        note(f'built {b.get("builtAt")} from {b.get("folder")}')
    return 1


def t_bins(fail, note):
    """Every game data file (.bin) decodes without errors"""
    import gamedata
    names = list(gamedata.BINS) + list(gamedata.OTHER_BINS)
    for n in names:
        r = gamedata.decode(n)
        if r['errors']:
            fail(f'{n}: {len(r["errors"])} decode errors, e.g. {r["errors"][0]}')
        elif not r['records']:
            fail(f'{n}: no records')
    return len(names)


def t_mset_headers(fail, note):
    """Every mesh file's header reads (all models, up to the Files1 section)"""
    from gamefs import open_game
    from mset import MSet
    fs = open_game()
    names = fs.names('bin/geobin/', '.mset')
    multi = 0
    for n in names:
        try:
            m = MSet(fs.read(n))
            multi += len(m.models) > 1
            p = 14 + sum(2 + len(x['name'].encode('latin-1')) + 2 + 8 * len(x['lods']) + 12 for x in m.models)
            if m.d[p:p + 8] != b'\x06\x00Files1':
                fail(f'{n}: the model table doesn\'t end where the Files1 section starts')
            for x in m.models:
                if not x['name'] and x['lods']:
                    fail(f'{n}: a model with geometry but no name')
        except Exception as e:
            fail(f'{n}: {type(e).__name__}: {e}')
    note(f'{multi} files hold more than one model')
    return len(names)


def t_tracks(fail, note):
    """Every animation track (.atrk) decodes"""
    from gamefs import open_game
    from atrk import Track
    fs = open_game()
    names = fs.names('animation_library/', '.atrk')
    for n in names:
        try:
            t = Track(fs.read(n))
            t.frame(0)
            t.frame(max(t.frames - 1, 0))
        except Exception as e:
            fail(f'{n}: {type(e).__name__}: {e}')
    return len(names)


def player_meshes():
    """[(skeleton, geometry name, mesh path, model hint)] for every piece the editor offers."""
    out = []
    for sk in ('Male', 'Female'):
        cat = catalog(sk)
        for n, g in cat['geometries'].items():
            if g.get('mesh') and not is_left_out_bone(cat, g['bone']):
                out.append((sk, n, g['mesh'], (g.get('model') or '').split('.')[-1]))
    return out


def t_models(fail, note):
    """Every player piece finds its own model, and its mesh decodes"""
    from gamefs import open_game
    from mset import MSet
    fs = open_game()
    allowed = set(KNOWN.get('modelNotFound', {}).get('names', []))
    pieces = player_meshes()
    cache, missing, later, decoded = {}, 0, 0, set()
    sample = set(random.Random(7).sample(sorted({p[2] for p in pieces}), 300)) if QUICK else None
    for sk, n, path, hint in pieces:
        if path not in cache:
            b = fs.read(path)
            cache[path] = MSet(b) if b else None
        m = cache[path]
        if m is None:
            missing += 1  # not installed (the client streams some content on demand)
            continue
        names = [x['name'].lower() for x in m.models if x['lods']]
        if hint and hint.lower() not in names:
            if n not in allowed:
                fail(f'{sk} {n}: its model {hint} isn\'t in {path} (has {", ".join(names) or "none"})')
            continue
        idx = model_index(m.models, hint)
        later += idx > 0
        if (path, idx) in decoded or (sample is not None and path not in sample):
            continue
        decoded.add((path, idx))
        try:
            mesh = m.lod(idx, 0).mesh()
            nv = len(mesh['positions'])
            if not nv or not mesh['tris']:
                fail(f'{sk} {n}: empty mesh')
            elif max(max(t) for t in mesh['tris']) >= nv:
                fail(f'{sk} {n}: a triangle points past the last vertex')
            if any(v != v or abs(v) > 1e4 for p in mesh['positions'] for v in p):
                fail(f'{sk} {n}: a vertex position is NaN or absurdly far out')
        except Exception as e:
            fail(f'{sk} {n}: mesh doesn\'t decode: {type(e).__name__}: {e}')
    note(f'{missing} pieces\' meshes aren\'t installed; {later} pieces use a model that isn\'t first in its file; '
         f'{len(decoded)} meshes decoded' + (' (sample)' if QUICK else ''))
    return len(pieces)


def t_mset_js(fail, note):
    """The browser's mesh reader agrees with the Python one"""
    node = shutil.which('node')
    if not node:
        note('Node.js isn\'t installed; skipped')
        return 0
    from gamefs import open_game
    from mset import MSet
    fs = open_game()
    pieces = player_meshes()
    # every piece whose model isn't first in its file, plus a random sample of the rest
    picks, seen = [], set()
    rng = random.Random(11)
    for sk, n, path, hint in pieces:
        if path in seen:
            continue
        b = fs.read(path)
        if not b:
            continue
        m = MSet(b)
        if model_index(m.models, hint) > 0 or len(m.models) > 1 or rng.random() < 0.01:
            seen.add(path)
            picks.append((path, hint, b, m))
    with tempfile.TemporaryDirectory() as tmp:
        manifest = []
        for k, (path, hint, b, m) in enumerate(picks):
            f = os.path.join(tmp, f'{k}.mset')
            open(f, 'wb').write(b)
            manifest.append({'file': f, 'hint': hint})
        mf = os.path.join(tmp, 'manifest.json')
        json.dump(manifest, open(mf, 'w'))
        r = subprocess.run([node, os.path.join(HERE, 'mset_parity.mjs'), mf], capture_output=True, text=True, timeout=600, **LOW)
        if r.returncode:
            fail('node failed: ' + (r.stderr or r.stdout)[-400:])
            return 0
        js = {x['file']: x for x in json.loads(r.stdout)}
        for (path, hint, b, m), man in zip(picks, manifest):
            j = js.get(man['file'], {})
            if j.get('error'):
                fail(f'{path}: mset.js: {j["error"]}')
                continue
            idx = model_index(m.models, hint)
            mesh = m.lod(idx, 0).mesh()
            py = {'models': [x['name'] for x in m.models], 'model': m.models[idx]['name'], 'verts': len(mesh['positions']),
                  'tris': len(mesh['tris']), 'triSum': sum(v for t in mesh['tris'] for v in t)}
            for k, v in py.items():
                if j.get(k) != v:
                    fail(f'{path}: {k}: mset.js {j.get(k)!r} vs mset.py {v!r}')
                    break
            else:
                ps = sum(v for p in mesh['positions'] for v in p)
                if abs(j['posSum'] - ps) > 1e-3 * max(1, abs(ps)):
                    fail(f'{path}: vertex positions differ (sum {j["posSum"]:.4f} vs {ps:.4f})')
    note(f'{len(picks)} mesh files compared')
    return len(picks)


def t_placement(fail, note):
    """No skinned piece sits at the floor while every bone it's skinned to is up the body"""
    import gamedata
    from build_web import bind_positions
    import rig_data
    headers = rig_data.MODEL_HEADERS
    checked, moved = 0, 0
    for sk in ('Male', 'Female'):
        cat = catalog(sk)
        bind = bind_positions(rig_data.skeleton_json(sk)[0]['bones'])
        for n, g in cat['geometries'].items():
            if not g.get('mesh') or g.get('subSkeleton') or is_left_out_bone(cat, g['bone']):
                continue
            base = os.path.splitext(os.path.basename(g['mesh']))[0]
            h = headers.get(f'{base}.{g.get("model")}'.lower()) or headers.get((g.get('model') or '').lower())
            if not h or not h['bone_names']:
                continue
            ys = [bind[b.lower()][1] for b in h['bone_names'] if b.lower() in bind]
            if not ys:
                continue
            checked += 1
            cy = (h['min'][1] + h['max'][1]) / 2
            if g.get('localTo'):
                moved += 1
                cy += bind[g['localTo'].lower()][1]
            # a model drawn around the floor while skinned only to bones above the knee was built around another point
            if cy < 1.5 and min(ys) > 2.5:
                fail(f'{sk} {n}: model centre at {cy:.2f} ft, but its bones start at {min(ys):.2f} ft (not placed at its anchor?)')
    note(f'{moved} belt and helmet add-ons are moved to their anchor bone (catalog localTo)')
    return checked


def t_stances(fail, note):
    """Every stance, mode, mood, tail/wing animation and body-scale track has its pose file"""
    poses = {os.path.splitext(f)[0] for f in os.listdir(os.path.join(DATA, 'poses'))}
    st = json.load(open(os.path.join(DATA, 'stances.json'), encoding='utf-8'))
    checked = 0

    def need(track, where):
        nonlocal checked
        checked += 1
        if track and track not in poses:
            fail(f'{where}: pose file {track}.json is missing')

    for sk in ('Male', 'Female'):
        cat = catalog(sk)
        for s in [x for x in cat['stances'] if x['player']]:
            for mode in ('idle', 'creator'):
                layers = st.get(sk, {}).get(s['name'], {}).get(mode)
                checked += 1
                if not layers:
                    fail(f'{sk} {s["displayName"]} {mode}: no animation layers')
                    continue
                for layer in layers:
                    need(layer['track'], f'{sk} {s["displayName"]} {mode}')
                for mood, ls in st['moods'].get(sk, {}).get(s['name'], {}).get(mode, {}).items():
                    for layer in ls:
                        need(layer['track'], f'{sk} {s["displayName"]} {mode} {mood}')
        for name, sub in cat.get('subSkeletons', {}).items():
            for stance, modes in (sub.get('anim') or {}).items():
                for mode, track in modes.items():
                    need(track, f'{sk} {name} {stance} {mode}')
            for stance, modes in (sub.get('moodAnim') or {}).items():
                for mode, moods in modes.items():
                    for mood, track in moods.items():
                        need(track, f'{sk} {name} {stance} {mode} {mood}')
        for b in cat['body'].get('bodyScales', []):
            if b.get('track'):
                need(b['track'], f'{sk} body scale {b["name"]}')
    return checked


def t_checker(fail, note):
    """The costume checker accepts every starting costume and the example"""
    import costume_check
    costumes = json.load(open(os.path.join(DATA, 'catalog', 'costumes.json'), encoding='utf-8'))
    warned = 0
    for c in costumes:
        doc, problems = costume_check.check(c)
        errors = [p for p in problems if p['level'] == 'error']
        if errors or not doc:
            fail(f'{c["name"]}: {len(errors)} error(s): {errors[0]["where"]} {errors[0]["message"]}' if errors else f'{c["name"]}: no document')
        warned += any(p['level'] == 'warning' for p in problems)
    for f in sorted(glob.glob(os.path.join(ROOT, 'examples', '*.json'))):
        if f.endswith('.editor.json'):
            continue
        doc, problems = costume_check.check(json.load(open(f, encoding='utf-8')))
        errors = [p for p in problems if p['level'] == 'error']
        if errors or not doc:
            fail(f'{os.path.basename(f)}: {errors[0]["message"] if errors else "no document"}')
    note(f'{warned} starting costumes get changes or warnings (expected: the checker completes and snaps them)')
    return len(costumes)


def t_parts_list(fail, note):
    """The editor's data holds only what the parts list has, and the server sends only its meshes and textures"""
    import parts_list
    import serve
    paths = json.load(open(os.path.join(DATA, 'assets.json'), encoding='utf-8'))
    assets = {p.lower() for p in paths}
    unlocks = json.load(open(os.path.join(DATA, 'catalog', 'unlocks.json'), encoding='utf-8'))
    named, checked = set(), 0
    for sk in ('Male', 'Female'):
        cat = json.load(open(os.path.join(DATA, 'catalog', sk + '.json'), encoding='utf-8'))
        for kind, key in (('pieces', 'geometries'), ('materials', 'materials'), ('textures', 'textures')):
            for name, rec in cat[key].items():
                checked += 1
                if not parts_list.shown(kind, name):
                    fail(f'{sk}: {name} ({kind}) is not on the parts list')
                if any(i >= len(unlocks) for i in rec['unlockedBy']):
                    fail(f'{sk}: {name} names an unlock unlocks.json lacks')
        for s in cat['stances']:
            checked += 1
            if not parts_list.shown('stances', s['name']):
                fail(f'{sk}: stance {s["name"]} is not on the parts list')
        for name, g in cat['geometries'].items():  # (on its own bones: a few name the other body's, e.g. the Egyptian skirt)
            if any(x and x not in cat['geometries'] for c in g['childGeos'] if c['bone'] in cat['bones'] for x in [c['default'], *c['options']]):
                fail(f'{sk}: {name} offers an attachment the catalogue lacks')
        named.update(g['mesh'].lower() for g in cat['geometries'].values() if g['mesh'])
        named.update(m['muscle'].lower() for m in cat['materials'].values() if m['muscle'])
        named.update(x.lower() for t in cat['textures'].values() for x in [t['image'], *(e['image'] for e in t['extra'])] if x)
    if named - assets:
        fail(f'{len(named - assets)} meshes and textures the catalogues name are missing from assets.json, e.g. {min(named - assets)}')
    # the server: a listed mesh is sent, one that isn't (an NPC's) is not
    src = serve.GameSource(json.load(open(os.path.join(DATA, 'build.json'), encoding='utf-8'))['folder'])
    listed = next(p for p in paths if p.endswith('.mset'))
    other = next(k for k in sorted(src.fs.index) if k.startswith('bin/geobin/') and k.endswith('.mset') and k.lower() not in assets)
    serve.load_assets()
    if not src.read(listed):
        fail(f'the server did not send {listed}, which assets.json lists')
    if src.read(other) is not None:
        fail(f'the server sent {other}, which assets.json does not list')
    note(f'{len(assets)} meshes and textures may be sent')
    return checked


def t_whats_new(fail, note):
    """What's new has every new_parts.json entry, by name, with only parts the catalogues offer"""
    import parts_list
    entries, source = json.load(open(os.path.join(DATA, 'whats_new.json'), encoding='utf-8'))['entries'], parts_list.news()
    if [e['id'] for e in entries] != [e['id'] for e in source]:
        fail(f'whats_new.json has {len(entries)} entries, new_parts.json {len(source)}: rebuild')
    cats = {sk: json.load(open(os.path.join(DATA, 'catalog', sk + '.json'), encoding='utf-8')) for sk in ('Male', 'Female')}
    checked = 0
    for e in entries:
        for kind, key in (('pieces', 'geometries'), ('materials', 'materials'), ('textures', 'textures')):
            for sk, names in e[kind].items():
                for n in names:
                    checked += 1
                    if n not in cats[sk][key] or not parts_list.shown(kind, n):
                        fail(f'{e["id"]}: {sk} {n} ({kind}) is not offered')
    note(f'{len(entries)} entries, {checked} parts')
    return checked


def t_index(fail, note):
    """The costume index lists each piece once, with the right counts and no deprecated categories"""
    idx_dir = data('index')
    everything = json.load(open(os.path.join(idx_dir, 'index.json'), encoding='utf-8'))
    checked = 0
    for sk, skel in everything['skeletons'].items():
        seen = {}
        for bone, slot in skel['slots'].items():
            entries = []
            for rel in slot['files']:
                text = open(os.path.join(idx_dir, sk, rel), encoding='utf-8').read()
                got = re.findall(r'^### .* — `([^`]+)`$', text, re.M)
                entries += got
                m = re.search(r'This part has (\d+) of them', text)
                if m and int(m.group(1)) != len(got):
                    fail(f'{sk}/{rel}: header says {m.group(1)} pieces, the file has {len(got)}')
            checked += len(entries)
            if len(entries) != len(slot['pieces']):
                fail(f'{sk} {bone}: files list {len(entries)} pieces, index.json {len(slot["pieces"])}')
            for n in entries:
                if n in seen and seen[n] == bone:
                    fail(f'{sk} {bone}: {n} is listed more than once')
                seen[n] = bone
            for p in slot['pieces']:
                bad = [c for c in p['categories'] if DEV.search(c)]
                if bad:
                    fail(f'{sk} {p["name"]}: lists hidden category {bad[0]}')
                if not p['categories']:
                    fail(f'{sk} {p["name"]}: fits no category the editor offers')
    for f in glob.glob(os.path.join(idx_dir, '**', '*.md'), recursive=True):
        if re.search(r'DEPRECATED', os.path.basename(f), re.I):
            fail(f'{os.path.relpath(f, idx_dir)}: a file for a deprecated category')
    return checked


# ---- browser --------------------------------------------------------------------------------------
def edge_path():
    for p in (r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
              r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'):
        if os.path.isfile(p):
            return p
    return shutil.which('msedge') or shutil.which('chrome') or shutil.which('chromium')


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def t_browser(fail, note):
    """The editor in a browser (viewer/test.html)"""
    browser = edge_path()
    if not browser:
        fail('no Edge or Chrome found to run the browser tests (or use --no-browser)')
        return 0
    import build
    port = free_port()
    base = f'http://127.0.0.1:{port}/'
    profile = tempfile.mkdtemp(prefix='co-test-browser-')
    log_path = os.path.join(profile, 'server.log')
    log = open(log_path, 'w', encoding='utf-8', errors='replace')
    server = subprocess.Popen([sys.executable, '-u', os.path.join(ROOT, 'serve.py'), str(port), '--game', build.built()['folder']],
                              cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, **LOW)
    proc = None
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(base + 'api/source', timeout=2).read()
                break
            except OSError:
                time.sleep(0.2)
        flags = [f'--user-data-dir={profile}', '--no-first-run', '--no-default-browser-check', '--window-size=1000,700',
                 '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
        if '--show' not in ARGS:
            flags.insert(0, '--headless=new')
        proc = subprocess.Popen([browser, *flags, base + 'test.html?auto=1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **LOW)
        t0, res, last = time.time(), {}, ''
        while time.time() - t0 < 1500:
            time.sleep(3)
            res = json.loads(urllib.request.urlopen(base + 'api/test/results', timeout=5).read() or b'{}')
            if res.get('done'):
                break
            if int(time.time() - t0) // 60 != last:
                last = int(time.time() - t0) // 60
                print(f'   ... {last} min', flush=True)
        if not res.get('done'):
            fail('the browser tests didn\'t finish within 25 minutes')
            return 0
    finally:
        if proc:
            subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True) if os.name == 'nt' else proc.kill()
        server.terminate()
        server.wait(10)
        log.close()
        server_log = open(log_path, encoding='utf-8', errors='replace').read().splitlines()
        shutil.rmtree(profile, ignore_errors=True)
    for s in res['sections']:
        RESULTS.append(('browser: ' + s['name'], s['checked'], s['failures'], s['notes'], s['seconds']))
        report(RESULTS[-1])
    if res.get('fatal'):
        fail(res['fatal'] + '\n   server log (last lines):\n' + '\n'.join('     ' + x for x in server_log[-15:]))
    return sum(s['checked'] for s in res['sections'])


def main():
    sys.stdout.reconfigure(errors='replace')
    lower_priority()
    t0 = time.time()
    if not test(t_build):
        print('\nStopping: the other checks need a current build.')
        sys.exit(1)
    checks = [] if '--browser-only' in ARGS else (
        [t_bins, t_mset_headers] + ([] if QUICK else [t_tracks]) + [t_models, t_placement, t_mset_js, t_stances, t_checker, t_index, t_parts_list, t_whats_new])
    for c in checks:
        test(c)
    if '--no-browser' not in ARGS:
        # the browser's sections are reported one by one; its own line counts only when it failed itself
        if test(t_browser):
            RESULTS.pop()
    failed = [r for r in RESULTS if r[2]]
    print(f'\n{len(RESULTS) - len(failed)} of {len(RESULTS)} checks passed in {time.time() - t0:.0f} s'
          + (': ' + ', '.join(r[0] for r in failed) + ' failed' if failed else ''))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
