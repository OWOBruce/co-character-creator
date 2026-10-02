"""Piece descriptions for the costume index: python captions.py <command>

  pilot [N]   choose N pieces (default 50) that exist on both bodies, spread over every kind of slot, and write
              the render list (viewer/data/render_jobs.json): each piece on the male and the female body
  all         write the render list for every piece in the index, on its own body (render.html?limit=N does
              N sheets at a time, skipping ones already rendered)
  status      how many pieces are rendered and described
  add FILE    merge descriptions from a JSON file ({"<Male|Female>/<geometry>": {description, colourAreas, tags,
              differs?}}) into captions/captions.json: fills in the mesh and model, rejects tags not in TAGS.md

Rendering: open http://localhost:8765/render.html with the editor's server running. It puts each listed piece on a
plain mannequin of that body and saves a sheet of eight views (full body front and back; the piece zoomed from
the front, three-quarter front, side, back and three-quarter back; the piece alone from above) as
<renders folder>/<Male|Female>/<geometry>.jpg: settings.json's rendersFolder, else
%LOCALAPPDATA%/CO Costume Editor/renders (outside the project: bulk images made from game data).

Descriptions and tags are written from those sheets into captions/captions.json (in the project, so they're
kept), keyed "<Male|Female>/<geometry>" with the mesh and model they describe; tags come from captions/TAGS.md.
build_index.py adds them to the index.
"""
import collections
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'viewer', 'data')
JOBS = os.path.join(DATA, 'render_jobs.json')
CAPTIONS = os.path.join(HERE, 'captions', 'captions.json')
sys.path.insert(0, HERE)
from gamefs import renders_folder  # noqa: E402
RENDERS = renders_folder()  # settings.json rendersFolder, else %LOCALAPPDATA%/CO Costume Editor/renders
SAFE = re.compile(r'^[A-Za-z0-9_.-]+$')  # geometry names usable as file names (all of them, in practice)


def index():
    return json.load(open(os.path.join(HERE, 'index', 'index.json'), encoding='utf-8'))['skeletons']


def catalog(sk):
    return json.load(open(os.path.join(DATA, 'catalog', sk + '.json'), encoding='utf-8'))


def load_captions():
    try:
        return json.load(open(CAPTIONS, encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def job(sk, cat, piece, slot_title):
    g = cat['geometries'][piece['name']]
    return {'skeleton': sk, 'geometry': piece['name'], 'bone': g['bone'], 'slot': slot_title,
            'displayName': piece['displayName'], 'mesh': g['mesh'], 'model': g.get('model'),
            'cloth': bool(g.get('cloth')), 'subSkeleton': g.get('subSkeleton') or None}


def counterpart(name):
    """The other body's version of a piece: M_Hair_X <-> F_Hair_X (a name without the prefix is shared)."""
    if name.startswith('M_'):
        return 'F_' + name[2:]
    if name.startswith('F_'):
        return 'M_' + name[2:]
    return name


def pilot(n=50):
    idx = index()
    cats = {sk: catalog(sk) for sk in ('Male', 'Female')}
    female = {p['name']: (p, slot['title']) for slot in idx['Female']['slots'].values() for p in slot['pieces']}
    by_slot = collections.defaultdict(list)  # male slot title -> [(male piece, female piece, female slot title)]
    for slot in idx['Male']['slots'].values():
        for p in slot['pieces']:
            other = female.get(counterpart(p['name']))
            if other and SAFE.match(p['name']) and SAFE.match(other[0]['name']):
                by_slot[slot['title']].append((p, other[0], other[1]))
    rng = random.Random(2026)
    for pairs in by_slot.values():
        rng.shuffle(pairs)
        # tails and wings (own skeleton) first where a slot has them: they're the hardest to show
        pairs.sort(key=lambda x: not cats['Male']['geometries'][x[0]['name']].get('subSkeleton'))
    # three cloth pieces (capes, skirts ...) whatever their slot, then one piece per slot per round
    is_cloth = lambda x: cats['Male']['geometries'][x[0]['name']].get('cloth')
    cloth = [(t, pr) for t, prs in by_slot.items() for pr in prs if is_cloth(pr)]
    rng.shuffle(cloth)
    picks = []
    for t, pr in cloth[:3]:
        by_slot[t].remove(pr)
        picks.append((t, *pr))
    slots = sorted(by_slot)
    while len(picks) < n and any(by_slot.values()):
        for title in slots:  # round robin: one piece per slot per round
            if by_slot[title] and len(picks) < n:
                picks.append((title, *by_slot[title].pop(0)))
    jobs = []
    for title, m, f, ftitle in picks:
        jobs.append(job('Male', cats['Male'], m, title))
        jobs.append(job('Female', cats['Female'], f, ftitle))
    os.makedirs(DATA, exist_ok=True)
    json.dump({'name': f'pilot of {len(picks)} pieces', 'jobs': jobs}, open(JOBS, 'w', encoding='utf-8'), indent=1)
    print(f'wrote {JOBS}: {len(picks)} pieces x 2 bodies = {len(jobs)} sheets, from {len({p[0] for p in picks})} slots')


def tag_list():
    """The allowed tags: every '·'-separated word on the list lines of captions/TAGS.md."""
    text = open(os.path.join(HERE, 'captions', 'TAGS.md'), encoding='utf-8').read()
    return {t.strip() for line in text.splitlines() if ' · ' in line for t in line.split('·') if t.strip()}


def add(path):
    import datetime
    new = json.load(open(path, encoding='utf-8'))
    allowed, caps = tag_list(), load_captions()
    cats = {sk: catalog(sk)['geometries'] for sk in ('Male', 'Female')}
    problems = []
    for key, e in new.items():
        sk, _, geo = key.partition('/')
        g = cats.get(sk, {}).get(geo)
        if not g:
            problems.append(f'{key}: not a {sk} piece')
            continue
        bad = [t for t in e.get('tags', []) if t not in allowed]
        if bad:
            problems.append(f'{key}: tags not in TAGS.md: {", ".join(bad)}')
            continue
        if not e.get('description') or not e.get('tags'):
            problems.append(f'{key}: needs a description and tags')
            continue
        caps[key] = {'mesh': g['mesh'], 'model': g.get('model'), 'description': e['description'].strip(),
                     'colourAreas': e.get('colourAreas', '').strip(), 'tags': e['tags'],
                     **({'differs': e['differs'].strip()} if e.get('differs') else {}),
                     'from': 'sheet', 'date': datetime.date.today().isoformat()}
    os.makedirs(os.path.dirname(CAPTIONS), exist_ok=True)
    json.dump(dict(sorted(caps.items())), open(CAPTIONS, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print(f'{len(new) - len(problems)} added; {len(caps)} descriptions in {CAPTIONS}')
    for p in problems:
        print('  ! ' + p)
    return not problems


def everything():
    """Render list of every piece the index lists (both bodies; weapons, travel and NPC-only pieces are left out)."""
    idx, jobs = index(), []
    for sk in ('Male', 'Female'):
        cat = catalog(sk)
        for slot in idx[sk]['slots'].values():
            for p in slot['pieces']:
                if SAFE.match(p['name']) and p['name'] in cat['geometries']:
                    jobs.append(job(sk, cat, p, slot['title']))
    os.makedirs(DATA, exist_ok=True)
    json.dump({'name': f'all {len(jobs)} pieces', 'jobs': jobs}, open(JOBS, 'w', encoding='utf-8'), indent=1)
    print(f'wrote {JOBS}: {len(jobs)} sheets')


def status():
    jobs = json.load(open(JOBS, encoding='utf-8'))['jobs'] if os.path.isfile(JOBS) else []
    caps = load_captions()
    rendered = sum(os.path.isfile(os.path.join(RENDERS, j['skeleton'], j['geometry'] + '.jpg')) for j in jobs)
    described = sum(f'{j["skeleton"]}/{j["geometry"]}' in caps for j in jobs)
    print(f'render list: {len(jobs)} sheets; {rendered} rendered ({RENDERS}); {described} described; '
          f'{len(caps)} descriptions in {CAPTIONS}')


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args or args[0] not in ('pilot', 'all', 'status', 'add') or (args[0] == 'add' and len(args) < 2):
        print(__doc__)
        sys.exit(2)
    if args[0] == 'pilot':
        pilot(int(args[1]) if len(args) > 1 else 50)
    elif args[0] == 'all':
        everything()
    elif args[0] == 'add':
        sys.exit(0 if add(args[1]) else 1)
    else:
        status()
