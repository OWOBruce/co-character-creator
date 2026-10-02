"""Build the costume index (index/): what every costume piece, material, pattern and colour is, in Markdown,
for people and for AI assistants that build costumes. python build_index.py (also part of build.py)

Reads the editor's built data (viewer/data/catalog: catalogs, shaders, palettes) and, from the game's
archives, the hair meshes (to measure length) and the pattern masks (to measure what each colour slot covers).

index/
  GUIDE.md                         how costumes work, the costume JSON format, how to check a costume
  palettes.md                      the creator's colours with names, skin tones, ready-made schemes
  <Skeleton>/README.md             that body's slots, one line each, with a link to its file
  <Skeleton>/<Region>/<Slot>.md    every piece for the slot (and its child slots): materials with their look,
                                   patterns with colour-slot coverage, hair length ...
  <Skeleton>/pattern-lists.md      long pattern lists shared by many materials (tights, skins), referenced by id
  index.json                       the same data for tools (search scripts)
Everything is generated from the install: rebuild after a game patch. Nothing in it is game art.
"""
import collections
import io
import json
import math
import os
import re
import shutil
import sys

import numpy as np
from PIL import Image, ImageColor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'tools'))
import gamedata  # noqa: E402
from mset import MSet  # noqa: E402

DATA = os.path.join(HERE, 'viewer', 'data', 'catalog')
OUT = os.path.join(HERE, 'index')
SKELETONS = ('Female', 'Male')
DEV = re.compile(r'^\s*(NPC|UNUSED|SCALE TEST|DEPRECATED)\b', re.I)
INLINE_PATTERNS = 12  # longer pattern lists go to pattern-lists.md
MAX_FILE = 150_000  # characters; longer slot files are cut into parts (each piece still appears once)


def load(name):
    return json.load(open(os.path.join(DATA, name + '.json'), encoding='utf-8'))


def is_weapon_bone(cat, bone):
    return (cat['bones'].get(bone) or {}).get('region') == 'Weapons' or re.search(r'_Weapon_(Melee|Ranged)$', bone, re.I)


def name_of(x, fallback):
    """A display name on one line (a few of the game's names end in a line break)."""
    return ' '.join((x.get('displayName') or '').split()) or fallback


def slug(s):
    return re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_') or 'slot'


# ---- colour names ------------------------------------------------------------------------------------
def _lab(rgb):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(float(v)) for v in rgb[:3])
    x, y, z = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505, 0.2126 * r + 0.7152 * g + 0.0722 * b, \
              (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))


NAMED = {}
for _n, _hex in ImageColor.colormap.items():
    if 'grey' in _n or _n in ('aqua', 'fuchsia'):  # duplicates of gray / cyan / magenta
        continue
    NAMED[_n] = _lab(ImageColor.getrgb(_hex))


def color_name(rgb):
    """Nearest CSS colour name ('crimson', 'darkslategray'), for describing palette colours in words."""
    L = _lab(rgb)
    return min(NAMED, key=lambda n: sum((a - b) ** 2 for a, b in zip(L, NAMED[n])))


def hexc(rgb):
    return '#%02x%02x%02x' % tuple(int(round(v)) for v in rgb[:3])


# ---- materials: their look, from the shader data -----------------------------------------------------
def material_look(shaders, shader):
    """Plain-words traits of a costume material's shader (see viewer/js/shader-graph.js for what they mean)."""
    m = shaders['materials'].get(shader)
    if not m:
        return []
    t = shaders['templates'][m['template']]
    ops = {op['name']: op for op in t['ops']}
    types = {op['type'] for op in t['ops']}
    vals, gfx = m['values'], m.get('gfxFlags') or 0
    out_op = next((op for op in t['ops'] if op['type'] == 'output'), {'in': {}})

    def value(op, inp, default=None):
        v = (vals.get(op) or {}).get(inp)
        if v is None:
            v = (ops.get(op) or {}).get('fixed', {}).get(inp)
        return v if v is not None else default

    def avg(v):
        return sum(v[:3]) / 3 if isinstance(v, list) and len(v) >= 3 else (v[0] if isinstance(v, list) and v else 0)

    look = []
    refract = 'refract' in types
    blended = gfx & 1 or refract or t['flags'] & 32 or (t['flags'] & 2 and 'alpha' in out_op['in'])
    if gfx & 1 or refract:
        look.append('see-through, glowing (adds light)')
    elif blended:
        look.append('see-through')
    if 'fresnelterm_advanced' in types and blended:
        look.append('bright edges')
    if t['reflection']:
        rw = max((avg(value(n, 'color', [0])) for n in ('reflectionweight', 'reflectweight') if n in ops), default=0)
        rw = max(rw, avg(value('reflection_weight', 'a', [0])) if 'reflection_weight' in ops else 0)
        if rw >= 0.4:
            look.append('highly reflective')
        elif rw > 0.05:
            look.append('reflective')
    if 'anisotropic' in m['template'].lower():
        look.append('brushed-metal sheen')
    if not blended:
        sw = avg(value('specularweight', 'color', [0])) if 'specularweight' in ops else 0
        if sw >= 0.4:
            look.append('glossy')
        elif sw >= 0.15:
            look.append('satin')
        elif not any('reflective' in x or 'sheen' in x for x in look):
            look.append('matte')
    animated = any(
        (op['type'] in ('texscrollscale', 'scroll') and any(abs(x) > 1e-6 for x in value(op['name'], 'scrollrate', [0, 0]) or []))
        or (op['type'] == 'oscillator' and abs(avg(value(op['name'], 'amplitude', [0]))) > 1e-6)
        or (op['type'] == 'texrotate' and abs(avg(value(op['name'], 'rotationrate', [0]))) > 1e-6)
        for op in t['ops'])
    if animated:
        look.append('animated')
    return look


# ---- hair length -------------------------------------------------------------------------------------
def landmarks(cat):
    """Bind-pose heights (feet) of body landmarks, from the skeleton."""
    bones = cat['skeleton']['bones']

    def qmul(a, b):
        ax, ay, az, aw = a
        bx, by, bz, bw = b
        return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]

    def rot(q, v):
        return qmul(qmul(q, [*v, 0]), [-q[0], -q[1], -q[2], q[3]])[:3]
    world = {}
    for i, b in enumerate(bones):
        if b['parent'] is None:
            world[i] = (b['pos'], b['quat'])
        else:
            pp, pq = world[b['parent']]
            world[i] = ([a + c for a, c in zip(pp, rot(pq, b['pos']))], qmul(pq, b['quat']))
    y = {b['name'].lower(): world[i][0][1] for i, b in enumerate(bones)}
    return {'forehead': y['forehead'], 'jaw': y['muscle_head_jawl'], 'neck': y['neck'],
            'shoulder': y['mount_shoulder_l'], 'chest': y['chest'], 'waist': y['waist'], 'hips': y['hips']}


def hair_length(fs, g, lm):
    """(length words, lowest point, top) of a hair mesh in the bind pose, or None."""
    data = fs.read(g['mesh']) if g.get('mesh') else None
    if not data:
        return None
    m = MSet(data)
    idx = next((i for i, x in enumerate(m.models) if x['lods']), 0)
    for i, x in enumerate(m.models):
        if x['lods'] and g.get('model') and x['name'].lower() == g['model'].lower():
            idx = i
    pos = np.asarray(m.lod(idx, 0).mesh()['positions'], dtype=np.float32)
    if not len(pos):
        return None
    low, top = float(np.percentile(pos[:, 1], 0.2)), float(np.percentile(pos[:, 1], 99.5))  # thin strands count
    if low >= lm['jaw'] + 0.08:
        words = 'short (above the jaw)'
    elif low >= lm['neck'] + 0.05:
        words = 'chin length'
    elif low >= lm['shoulder'] - 0.15:
        words = 'neck length'
    elif low >= lm['shoulder'] - 0.45:
        words = 'shoulder length'
    elif low >= lm['chest']:
        words = 'upper-back length'
    elif low >= lm['waist']:
        words = 'mid-back length'
    else:
        words = 'waist length or longer'
    if top > lm['forehead'] + 0.3:  # ordinary hair tops out 0.15-0.2 above the forehead
        words += ', tall on top'
    return words


# ---- pattern masks: what each colour slot covers -----------------------------------------------------
def pattern_coverage(fs, image):
    """Share of a pattern mask (tinted area) each colour slot paints: [slot0, slot1, slot2, slot3] in %,
    plus the untinted share (areas that show the diffuse texture as it is). Colour = (1-R-G-B)*C0 + R*C1
    + G*C2 + B*C3 where the mask's alpha tints (ColorTint4b)."""
    if not image:
        return None
    data = fs.dds('texture_library/' + image[len('dds/'):-len('.dds')] + '.wtex')
    if not data:
        return None
    try:
        im = Image.open(io.BytesIO(data)).convert('RGBA')
    except Exception:
        return None
    if max(im.size) >= 256:
        im = im.reduce(4)
    a = np.asarray(im, dtype=np.float32) / 255
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    w = [np.clip(1 - r - g - b, 0, 1), r, g, b]
    tinted = float(al.mean())
    tot = float(al.sum()) or 1.0
    cov = [float((x * al).sum()) / tot for x in w]
    s = sum(cov) or 1.0
    return {'slots': [round(100 * x / s) for x in cov], 'untinted': round(100 * (1 - tinted))}


def coverage_words(c):
    if not c:
        return ''
    parts = [f'{i}:{p}%' for i, p in enumerate(c['slots']) if p >= 1]
    extra = f', {c["untinted"]}% untinted' if c['untinted'] >= 5 else ''
    return f'colours {" ".join(parts)}{extra}'


# ---- the index -----------------------------------------------------------------------------------------
def main():
    from buildprogress import each
    fs = gamedata.fs()
    shaders, palettes, unlocks = load('shaders'), load('palettes'), load('unlocks')
    # what pieces look like, described from rendered sheets (captions.py); kept only while the piece still uses
    # the mesh and model that was described
    try:
        captions = json.load(open(os.path.join(HERE, 'captions', 'captions.json'), encoding='utf-8'))
    except (OSError, ValueError):
        captions = {}
    # empty the folder but keep it (and anything set on it, like a Dropbox ignore mark); files held open
    # by another program are written over instead
    os.makedirs(OUT, exist_ok=True)
    for e in os.scandir(OUT):
        if e.is_dir():
            shutil.rmtree(e.path, ignore_errors=True)
        else:
            try:
                os.remove(e.path)
            except OSError:
                pass
    everything = {'palettes': {}, 'skeletons': {}}
    cov_cache = {}
    looks = {}

    def look_of(shader):
        if shader not in looks:
            looks[shader] = material_look(shaders, shader)
        return looks[shader]

    # palettes
    sets = {s['Name']: [c['color'] for c in s['Color']] for s in palettes['colorSets']}
    quads = {s['Name']: s['ColorQuad'] for s in palettes['colorQuadSets']}
    first = load(SKELETONS[0])
    body_set, skin_set, quad_set = first['bodyColorSet'], first['skinColorSet'], first['colorQuadSet']
    lines = ['# Palettes', '',
             f'The creator offers these colours. Costume colours should come from **{body_set}** (and skin tones from '
             f'**{skin_set}**): `python costume_check.py` (and the editor\'s import) moves any other colour to the nearest one.',
             'Names are the nearest CSS colour name, to help describe them; several colours can share a name.', '',
             f'## {body_set} ({len(sets[body_set])} colours)', '']
    lines += [f'- `{hexc(c)}` {color_name(c)}' for c in sets[body_set]]
    lines += ['', f'## {skin_set} (skin tones, {len(sets[skin_set])})', '']
    lines += [f'- `{hexc(c)}` {color_name(c)}' for c in sets[skin_set]]
    lines += ['', f'## {quad_set}: ready-made schemes (colours 0, 1, 2, 3)', '']
    for i, q in enumerate(quads.get(quad_set, [])):
        cs = [q[f'Color{k}'] for k in range(4)]
        lines.append(f'- scheme {i + 1}: ' + ', '.join(f'`{hexc(c)}` {color_name(c)}' for c in cs))
    open(os.path.join(OUT, 'palettes.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    everything['palettes'] = {'body': [hexc(c) for c in sets[body_set]], 'skin': [hexc(c) for c in sets[skin_set]],
                              'schemes': [[hexc(q[f'Color{k}']) for k in range(4)] for q in quads.get(quad_set, [])]}

    for sk in each(SKELETONS, 0.05, 1):
        cat = load(sk)
        G, M, T, B = cat['geometries'], cat['materials'], cat['textures'], cat['bones']
        lm = landmarks(cat)
        cat_names = {c['name']: c['displayName'] or c['name'] for r in cat['regions'] for c in r['categories']}
        # the categories the editor offers (as rules.js: not hidden, not named DEPRECATED:/NPC/UNUSED); every
        # player piece is in at least one of them
        offered = {c['name'] for r in cat['regions'] for c in r['categories']
                   if not c.get('hidden') and not DEV.search(c.get('displayName') or '')}
        sk_dir = os.path.join(OUT, sk)
        os.makedirs(sk_dir, exist_ok=True)
        shared_lists, shared_ids = [], {}
        sk_json = {'landmarks': lm, 'slots': {}, 'patternLists': {}}

        def usable(n, g):
            return g.get('availability') != 'npc' and not DEV.search(g.get('displayName') or '') and g.get('mesh')

        def unlock_words(g):
            if g.get('availability') != 'unlock':
                return 'available from the start'
            u = [unlocks[i] for i in g.get('unlockedBy') or [] if i < len(unlocks)]
            if not u:
                return 'unlock (source unknown)'
            src = u[0]
            label = ' / '.join(x for x in (src.get('source'), src.get('detail')) if x)
            return f'unlock ({label}' + (f' +{len(u) - 1} more' if len(u) > 1 else '') + ')'

        def mat_ok(x):
            return x and x in M and M[x].get('availability') != 'npc' and not DEV.search(M[x].get('displayName') or '')

        pattern_table, material_table = {}, {}

        def pattern(tn):
            if tn not in pattern_table:
                t = T.get(tn) or {}
                if tn not in cov_cache:
                    cov_cache[tn] = pattern_coverage(fs, t.get('image'))
                pattern_table[tn] = {'displayName': name_of(t, tn), 'coverage': cov_cache[tn]}
            return pattern_table[tn]

        def pattern_text(tn):
            p = pattern(tn)
            cw = coverage_words(p['coverage'])
            return f'`{tn}` "{p["displayName"]}"' + (f' ({cw})' if cw else '')

        def material(mn):
            if mn not in material_table:
                m = M[mn]
                pats = [t for t in m.get('textures', []) if t in T and 'Pattern' in T[t]['type']]
                e = {'displayName': name_of(m, mn), 'look': look_of(m.get('shader')),
                     'skin': bool(m.get('hasSkin')), 'glowSlots': [i for i, v in enumerate(m.get('allowGlow') or []) if v]}
                if len(pats) > INLINE_PATTERNS:
                    key = tuple(sorted(pats))
                    if key not in shared_ids:
                        shared_ids[key] = f'P{len(shared_lists) + 1}'
                        shared_lists.append((shared_ids[key], sorted(pats, key=lambda x: T[x].get('order', 0))))
                    e['patternList'] = shared_ids[key]
                    e['patternCount'] = len(pats)
                else:
                    e['patterns'] = pats
                for t in pats:
                    pattern(t)
                material_table[mn] = e
            return material_table[mn]

        def color_rules(me):
            bits = []
            if me['skin']:
                bits.append('colour 3 is the skin tone')
            if me['glowSlots']:
                bits.append('glow allowed on colour ' + ', '.join(map(str, me['glowSlots'])))
            return ' · '.join(bits)

        def patterns_text(me):
            if 'patternList' in me:
                return f'list {me["patternList"]} ({me["patternCount"]} patterns: {sk}/pattern-lists/{me["patternList"]}.md)'
            return '; '.join(pattern_text(t) for t in me['patterns']) or 'none'

        # materials worn by many pieces (the effect materials: Fire, Ice, Ghost ...) are described once
        use = collections.Counter(x for g in G.values() if g.get('availability') != 'npc'
                                  for x in dict.fromkeys([g.get('defaultMaterial')] + g['materials']) if mat_ok(x))
        shared_mats = {x for x, k in use.items() if k >= 25}

        def piece_block(n, g):
            mats = [x for x in dict.fromkeys([g.get('defaultMaterial')] + g['materials']) if mat_ok(x)]
            own = [x for x in mats if x not in shared_mats or x == g.get('defaultMaterial')]
            common = [x for x in mats if x not in own]
            entry = {'name': n, 'displayName': name_of(g, n), 'bone': g['bone'],
                     'categories': [cat_names.get(c, c) for c in g.get('categories', []) if c in offered],
                     'availability': unlock_words(g), 'mirror': g.get('mirrorGeometry') or None,
                     'defaultMaterial': g.get('defaultMaterial'), 'materials': mats,
                     'children': [{'bone': c['bone'], 'required': c.get('required'), 'default': c.get('default'),
                                   'options': [o for o in c.get('options', []) if o in G and usable(o, G[o])]}
                                  for c in g.get('childGeos', []) if not is_weapon_bone(cat, c['bone'])],
                     'cloth': bool(g.get('cloth'))}
            if 'hair' in g['bone'].lower():
                entry['hair'] = hair_length(fs, g, lm)
            out = [f'### {entry["displayName"]} — `{n}`', '']
            facts = [entry['availability'], 'categories: ' + ', '.join(entry['categories'])]
            if entry.get('hair'):
                facts.insert(0, 'hair: ' + entry['hair'])
            if entry['mirror']:
                facts.append(f'mirror piece: `{entry["mirror"]}`')
            if entry['cloth']:
                facts.append('cloth (moves in the wind)')
            out.append(' · '.join(facts))
            out.append('')
            cap = captions.get(f'{sk}/{n}')
            if cap and cap.get('mesh') == g.get('mesh') and cap.get('model') == g.get('model'):
                entry['look'] = {k: cap[k] for k in ('description', 'colourAreas', 'tags', 'differs') if cap.get(k)}
                out.append('- looks like: ' + cap['description'])
                if cap.get('colourAreas'):
                    out.append('- colour areas (default pattern): ' + cap['colourAreas'])
                out.append('- tags: ' + ', '.join(cap['tags']))
                if cap.get('differs'):
                    other = 'male' if sk == 'Female' else 'female'
                    out.append(f'- versus the {other} version: ' + cap['differs'])
            mes = {x: material(x) for x in own}
            rules = {color_rules(me) for me in mes.values()}
            pats = {patterns_text(me) for me in mes.values()}
            items = []
            for x, me in mes.items():
                extra = [', '.join(me['look'])] if me['look'] else []
                if x == entry['defaultMaterial']:
                    extra.insert(0, 'default')
                if len(rules) > 1 and color_rules(me):
                    extra.append(color_rules(me))
                if len(pats) > 1:
                    extra.append('patterns: ' + patterns_text(me))
                items.append(f'**{me["displayName"]}** `{x}`' + (f' ({"; ".join(extra)})' if extra else ''))
            if items:
                out.append('- materials: ' + ' · '.join(items))
            if len(rules) == 1 and next(iter(rules)):
                out.append('- colours: ' + next(iter(rules)))
            if len(pats) == 1:
                out.append('- patterns: ' + next(iter(pats)))
            if common:
                out.append('- effect materials (see shared-materials.md): '
                           + ', '.join(f'{name_of(M[x], x)} `{x}`' for x in common))
            for c in entry['children']:
                opts = ', '.join(f'`{o}`' for o in c['options'][:20]) + (' …' if len(c['options']) > 20 else '')
                need = 'required' if c['required'] else 'optional'
                out.append(f'- child slot `{c["bone"]}` ({need}): {opts or "none"}')
            out.append('')
            return entry, out

        # slots, region by region
        readme = [f'# {sk}', '', f'Slots of the {sk} body, by region. Each file lists every piece a player can wear there.',
                  f'Body landmarks (feet, bind pose): ' + ', '.join(f'{k} {v:.2f}' for k, v in lm.items()), '']
        for region in each(cat['regions']):
            if region['name'] == 'Weapons':
                continue
            readme += [f'## {region["displayName"]} (`{region["name"]}`)', '',
                       'Categories (every piece of a region must share the one chosen): ' +
                       ', '.join(f'{c["displayName"]} (`{c["name"]}`)' for c in region['categories']
                                 if not c.get('hidden') and not DEV.search(c.get('displayName') or '')), '']
            r_dir = os.path.join(sk_dir, slug(region['displayName']))
            slots = sorted(((b, d) for b, d in B.items() if d.get('region') == region['name'] and not d.get('isChild')
                            and (d.get('restrictedTo', 0) & 12) and not is_weapon_bone(cat, b)),
                           key=lambda x: x[1].get('order', 0))
            for bone, bd in slots:
                pieces = sorted(((n, g) for n, g in G.items() if g['bone'] == bone and not g.get('isChild') and usable(n, g)),
                                key=lambda x: (x[1].get('order', 0), x[1].get('displayName') or ''))
                kids = [c for c in bd.get('children', []) if not is_weapon_bone(cat, c)]
                kid_pieces = {c: sorted(((n, g) for n, g in G.items() if g['bone'] == c and usable(n, g)),
                                        key=lambda x: (x[1].get('order', 0), x[1].get('displayName') or '')) for c in kids}
                if not pieces and not any(kid_pieces.values()):
                    continue
                os.makedirs(r_dir, exist_ok=True)
                title = (bd.get('displayName') or bone).strip()
                fn = f'{slug(title)}__{bone}.md'
                md = [f'# {sk} › {region["displayName"]} › {title} (`{bone}`)', '',
                      f'{len(pieces)} pieces' + (f'; child slots: ' + ', '.join(f'`{c}` ({len(kid_pieces[c])})' for c in kids) if kids else '') +
                      ('. Required on every costume.' if bone in cat['requiredBones'] else '.'), '',
                      'Colours: `colours 0:40% 1:30% …` is how much of a pattern each colour slot paints (share of the texture, '
                      'not of the visible surface; unused texture space counts as colour 0).', '']
                entries, blocks = [], []  # blocks: (section title or None, entry, text)
                for n, g in pieces:
                    e, text = piece_block(n, g)
                    entries.append(e)
                    blocks.append((None, e, text))
                for c in kids:
                    for n, g in kid_pieces[c]:
                        e, text = piece_block(n, g)
                        entries.append(e)
                        blocks.append((f'Child slot `{c}` — {(B.get(c) or {}).get("displayName", c).strip()}', e, text))

                def render(sel, heading):
                    out, section = list(heading), None
                    for sec, e, text in sel:
                        if sec != section and sec:
                            out += [f'## {sec}', '']
                        section = sec
                        out += text
                    return '\n'.join(out)
                whole = render(blocks, md)
                links = []
                if len(whole) <= MAX_FILE:
                    open(os.path.join(r_dir, fn), 'w', encoding='utf-8').write(whole)
                    links.append((title, f'{slug(region["displayName"])}/{fn}'))
                else:
                    # too long to read in one go: cut into parts in the same order; every piece appears once and
                    # lists its categories
                    s_dir = os.path.join(r_dir, fn[:-3])
                    os.makedirs(s_dir, exist_ok=True)
                    chunks, cur, size = [], [], 0
                    for b in blocks:
                        t = sum(len(x) + 1 for x in b[2])
                        if cur and size + t > MAX_FILE:
                            chunks.append(cur)
                            cur, size = [], 0
                        cur.append(b)
                        size += t
                    chunks.append(cur)
                    for k, sel in enumerate(chunks):
                        part = f' (part {k + 1} of {len(chunks)})'
                        name = f'part_{k + 1}.md'
                        first, last = sel[0][1]['displayName'], sel[-1][1]['displayName']
                        head = [md[0] + part, '', md[2] + f' This part has {len(sel)} of them: {first} … {last}.'] + md[3:]
                        open(os.path.join(s_dir, name), 'w', encoding='utf-8').write(render(sel, head))
                        links.append((f'{title}{part}', f'{slug(region["displayName"])}/{fn[:-3]}/{name}'))
                hair_note = ''
                lens = collections.Counter(e['hair'].split(',')[0] for e in entries if e.get('hair'))
                if lens:
                    hair_note = ' · hair lengths: ' + ', '.join(f'{k} {v}' for k, v in lens.most_common())
                summary = (f'`{bone}`: {len(pieces)} pieces'
                           + (f' (+{sum(len(v) for v in kid_pieces.values())} in child slots)' if kids else '')
                           + (' · required' if bone in cat['requiredBones'] else '') + hair_note)
                cat_counts = collections.Counter(c for e in entries if e['bone'] == bone for c in e['categories'])
                summary += ' · by category: ' + ', '.join(f'{c} {k}' for c, k in cat_counts.most_common())
                if len(links) == 1:
                    readme.append(f'- [{title}]({links[0][1]}) {summary}')
                else:
                    readme.append(f'- {title} {summary} · in {len(links)} parts: '
                                  + ' · '.join(f'[{k + 1}]({u})' for k, (_, u) in enumerate(links)))
                sk_json['slots'][bone] = {'region': region['name'], 'title': title, 'files': [u for _, u in links],
                                          'pieces': entries}
            readme.append('')
        open(os.path.join(sk_dir, 'README.md'), 'w', encoding='utf-8').write('\n'.join(readme))
        pl = ['# Shared pattern lists', '', 'Long pattern lists used by many materials (body tights, skins, capes), one file '
              'each. Coverage: how much of the pattern each colour slot paints.', '']
        os.makedirs(os.path.join(sk_dir, 'pattern-lists'), exist_ok=True)
        for pid, pats in shared_lists:
            users = sorted({name_of(M[x], x) for x, me in material_table.items() if me.get('patternList') == pid})
            pl.append(f'- [{pid}](pattern-lists/{pid}.md): {len(pats)} patterns, used by '
                      + ', '.join(users[:8]) + (' …' if len(users) > 8 else ''))
            body = [f'# {sk} pattern list {pid} ({len(pats)} patterns)', ''] + [f'- {pattern_text(t)}' for t in pats]
            open(os.path.join(sk_dir, 'pattern-lists', pid + '.md'), 'w', encoding='utf-8').write('\n'.join(body) + '\n')
            sk_json['patternLists'][pid] = pats
        open(os.path.join(sk_dir, 'pattern-lists.md'), 'w', encoding='utf-8').write('\n'.join(pl) + '\n')
        sm = ['# Shared materials', '', f'Materials offered on many {sk} pieces (mostly the effect materials). A piece lists '
              'the ones it offers under "effect materials"; this is what they look like.', '']
        for x in sorted(shared_mats, key=lambda x: (M[x].get('displayName') or x, x)):
            me = material(x)
            bits = [', '.join(me['look'])] if me['look'] else []
            if color_rules(me):
                bits.append(color_rules(me))
            bits.append('patterns: ' + patterns_text(me))
            sm.append(f'- **{me["displayName"]}** `{x}` ({use[x]} pieces): ' + ' · '.join(bits))
        open(os.path.join(sk_dir, 'shared-materials.md'), 'w', encoding='utf-8').write('\n'.join(sm) + '\n')
        sk_json['materials'], sk_json['patterns'] = material_table, pattern_table
        everything['skeletons'][sk] = sk_json
        n_pieces = sum(len(s['pieces']) for s in sk_json['slots'].values())
        print(f'{sk}: {len(sk_json["slots"])} slots, {n_pieces} pieces, {len(shared_lists)} shared pattern lists', flush=True)

    json.dump(everything, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    shutil.copy(os.path.join(HERE, 'index_guide.md'), os.path.join(OUT, 'GUIDE.md'))
    if os.path.isfile(os.path.join(HERE, 'captions', 'TAGS.md')):
        shutil.copy(os.path.join(HERE, 'captions', 'TAGS.md'), os.path.join(OUT, 'TAGS.md'))
    print('wrote', OUT, flush=True)


if __name__ == '__main__':
    main()
