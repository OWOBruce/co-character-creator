"""Check a costume written for the editor (by hand or by an AI) and turn it into an editor document.

    python costume_check.py costume.json [--out fixed.json]

The input format is in index/GUIDE.md ("Costume JSON"). The checker
  * fills in what's left out (bone from the piece, default material, shared colours, required pieces ...),
  * reports problems: errors (the costume can't be built as written), warnings (it can, with a change or
    with something the game won't do) and notes,
  * moves every colour to the nearest colour of the creator's palettes (skin tones to the skin palette),
  * with --out writes the editor document (load it with the editor's Load button, or drop it on the page).
Exit status 1 when there are errors. serve.py offers the same check at POST /api/check (the editor's
import uses it). Uses the editor's built data (viewer/data/catalog), so run build.py first.
"""
import difflib
import json
import os
import re
import sys
from functools import lru_cache

from PIL import ImageColor

HERE = os.path.dirname(os.path.abspath(__file__))
from paths import data  # noqa: E402

DATA = data('viewer', 'data', 'catalog')
DEV = re.compile(r'^\s*(NPC|UNUSED|SCALE TEST|DEPRECATED)\b', re.I)
TEXTURE_KINDS = {'pattern': 'Pattern', 'detail': 'Detail', 'diffuse': 'Diffuse', 'specular': 'Specular'}
LINK_ALL, LINK_NONE = 1, 0  # PlayerCostume ColorLink: 1 = uses the costume's shared colours


@lru_cache(maxsize=None)
def catalog(skeleton):
    return json.load(open(os.path.join(DATA, skeleton + '.json'), encoding='utf-8'))


@lru_cache(maxsize=1)
def palettes():
    p = json.load(open(os.path.join(DATA, 'palettes.json'), encoding='utf-8'))
    return {s['Name']: [tuple(int(round(v)) for v in c['color'][:3]) for c in s['Color']] for s in p['colorSets']}


def _lab(rgb):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(float(v)) for v in rgb[:3])
    x, y, z = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505, 0.2126 * r + 0.7152 * g + 0.0722 * b, \
              (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))


def nearest(rgb, choices):
    L = _lab(rgb)
    return min(choices, key=lambda c: sum((a - b) ** 2 for a, b in zip(L, _lab(c))))


def hexc(rgb):
    return '#%02x%02x%02x' % tuple(rgb[:3])


class Checker:
    def __init__(self):
        self.problems, self.snapped = [], []

    def add(self, level, where, msg):
        self.problems.append({'level': level, 'where': where, 'message': msg})

    # ---- values -------------------------------------------------------------------------------------
    def color(self, v, where, palette):
        """'#rrggbb', 'crimson', [r, g, b(, a)] -> [r, g, b, 255], snapped to the nearest colour of palette."""
        rgb = None
        if isinstance(v, str):
            try:
                rgb = ImageColor.getrgb(v.strip())[:3]
            except ValueError:
                self.add('error', where, f'"{v}" is not a colour (use "#rrggbb", a colour name or [r, g, b])')
                return None
        elif isinstance(v, (list, tuple)) and len(v) >= 3 and all(isinstance(x, (int, float)) for x in v[:3]):
            rgb = tuple(int(round(max(0, min(255, x)))) for x in v[:3])
        else:
            self.add('error', where, f'{v!r} is not a colour')
            return None
        # always the creator's swatches: each colour moves to the nearest one (reported once, at the end)
        pal = palettes().get(palette) or []
        if pal and tuple(rgb) not in pal:
            near = nearest(rgb, pal)
            self.snapped.append(f'{hexc(rgb)} -> {hexc(near)}')
            rgb = near
        return [*rgb, 255]

    def colors4(self, v, where, palette):
        if not isinstance(v, list) or len(v) != 4:
            self.add('error', where, 'needs exactly 4 colours (slots 0, 1, 2, 3)')
            return None
        out = [self.color(c, f'{where}[{i}]', palette) for i, c in enumerate(v)]
        return None if None in out else out

    def glow4(self, v, where):
        if v is None:
            return [0, 0, 0, 0]
        if not isinstance(v, list) or len(v) != 4 or not all(isinstance(x, (int, float)) for x in v):
            self.add('error', where, 'glow needs 4 numbers (0 = none; above 1 glows, up to about 10)')
            return [0, 0, 0, 0]
        return [max(0.0, min(10.0, float(x))) for x in v]

    def pick(self, value, options, where, what, labels=None):
        """Match value to an internal name in options, or to a display name (labels: name -> display) if that
        is unambiguous. Returns the name or None (with an error and suggestions)."""
        if value in options:
            return value
        low = {o.lower(): o for o in options}
        if isinstance(value, str) and value.lower() in low:
            return low[value.lower()]
        if labels and isinstance(value, str):
            hits = [o for o in options if (labels.get(o) or '').lower() == value.lower()]
            if len(hits) == 1:
                return hits[0]
            if len(hits) > 1:
                self.add('error', where, f'{what} "{value}" matches several: ' + ', '.join(hits[:8]) + ' (use the internal name)')
                return None
        show = lambda o: f'{labels[o]} ({o})' if labels and labels.get(o) and labels[o] != o else o
        if len(options) <= 12:  # few enough to list
            self.add('error', where, f'{what} "{value}" is not available here; options: '
                     + (', '.join(show(o) for o in options) or 'none'))
            return None
        pool = list(options) + ([labels[o] for o in options if labels.get(o)] if labels else [])
        near = difflib.get_close_matches(str(value), pool, n=4, cutoff=0.5)
        self.add('error', where, f'{what} "{value}" is not available here'
                 + (f'; did you mean {", ".join(near)}?' if near else f' ({len(options)} options)'))
        return None

    # ---- the costume --------------------------------------------------------------------------------
    def check(self, src):
        sk = str(src.get('skeleton', '')).capitalize()
        if sk not in ('Male', 'Female'):
            self.add('error', 'skeleton', f'"{src.get("skeleton")}" is not a body type: use "Female" or "Male"')
            return None
        cat = catalog(sk)
        G, M, T, B = cat['geometries'], cat['materials'], cat['textures'], cat['bones']
        body_pal, skin_pal = cat['bodyColorSet'], cat['skinColorSet']
        doc = {'name': str(src.get('name') or ''), 'skeleton': sk, 'bodyScale': list(src.get('bodyScale') or []),
               'scaleValues': dict(src.get('scaleValues') or {})}

        # stance, mood, body
        stances = {s['name']: s['displayName'] for s in cat['stances'] if s['player']}
        doc['stance'] = cat['defaultStance']
        if src.get('stance'):
            n = len(self.problems)
            doc['stance'] = self.pick(src['stance'], list(stances), 'stance', 'stance', stances) or cat['defaultStance']
            for p in self.problems[n:]:  # a stance the creator doesn't offer: use the default instead
                p['level'], p['message'] = 'warning', p['message'] + f'; using {stances.get(cat["defaultStance"], cat["defaultStance"])}'
        moods = {m['name']: m['displayName'] for m in cat['moods']}
        doc['mood'] = (self.pick(src['mood'], list(moods), 'mood', 'mood', moods) if src.get('mood') else None) or 'Normal'
        body = cat['body']
        for key, rng in (('height', body['heightRange']), ('muscle', body['muscleRange'])):
            if src.get(key) is not None:
                v = float(src[key])
                if not rng[0] <= v <= rng[1]:
                    self.add('warning', key, f'{v:g} is outside the creator\'s range {rng[0]:g}..{rng[1]:g}; clamped')
                    v = max(rng[0], min(rng[1], v))
                doc[key] = v
        doc['skin'] = self.color(src['skin'], 'skin', skin_pal) if src.get('skin') is not None else \
            [*(int(v) for v in cat['defaultSkinColor'][:3]), 255]
        doc['skin'] = doc['skin'] or [*(int(v) for v in cat['defaultSkinColor'][:3]), 255]

        # shared colours (the costume's colour scheme)
        shared = self.colors4(src['colors'], 'colors', body_pal) if src.get('colors') is not None else None
        doc['glow'] = self.glow4(src.get('glow'), 'glow')

        # parts
        parts, bones_seen = [], {}
        for i, p in enumerate(src.get('parts') or []):
            where = f'parts[{i}]'
            if not isinstance(p, dict) or not p.get('geometry'):
                self.add('error', where, 'each part needs a "geometry" (the piece\'s internal name)')
                continue
            gname = p['geometry']
            if gname not in G:
                bone_hint = p.get('bone')
                pool = {n: g.get('displayName') for n, g in G.items() if not bone_hint or g['bone'] == bone_hint}
                self.pick(gname, list(pool), where, 'piece', pool)
                continue
            g = G[gname]
            where = f'parts[{i}] {gname}'
            bone = g['bone']
            if p.get('bone') and p['bone'] != bone:
                self.add('error', where, f'this piece goes on {bone}, not {p["bone"]}')
                continue
            if g.get('availability') == 'npc':
                self.add('error', where, 'NPC-only piece: players can\'t wear it')
                continue
            if DEV.search(g.get('displayName') or ''):
                self.add('warning', where, f'"{g.get("displayName")}" is an unused / test piece')
            if g.get('availability') == 'unlock':
                self.add('info', where, f'"{g.get("displayName")}" has to be unlocked in the game')
            if (B.get(bone) or {}).get('region') == 'Weapons' or re.search(r'_Weapon_(Melee|Ranged)$', bone, re.I):
                self.add('warning', where, 'weapons are kept in the costume but the editor doesn\'t show them')
            if bone in bones_seen:
                self.add('error', where, f'{bone} already has {bones_seen[bone]}; a slot holds one piece')
                continue
            bones_seen[bone] = gname

            # material
            allowed = [m for m in dict.fromkeys([g.get('defaultMaterial')] + g['materials'])
                       if m and m in M and M[m].get('availability') != 'npc']
            labels = {m: M[m].get('displayName') for m in allowed}
            if p.get('material'):
                mat = self.pick(p['material'], allowed, where, 'material', labels)
                if not mat:
                    continue
            else:
                mat = next((m for m in allowed if not DEV.search(M[m].get('displayName') or '')), allowed[0] if allowed else '')
            md = M.get(mat, {})
            part = {'bone': bone, 'geometry': gname, 'material': mat, 'pattern': '', 'detail': '', 'diffuse': '', 'specular': ''}

            # textures
            for key, kind in TEXTURE_KINDS.items():
                if p.get(key):
                    opts = [t for t in md.get('textures', []) if t in T and kind in T[t]['type']]
                    tl = {t: T[t].get('displayName') for t in opts}
                    part[key] = self.pick(p[key], opts, where, key, tl) or ''

            # colours: the part's own, else the costume's shared scheme
            if p.get('colors') is not None:
                own = self.colors4(p['colors'], f'{where} colors', body_pal)
                part['colors'], part['colorLink'] = own or [[128, 128, 128, 255]] * 4, LINK_NONE
            else:
                part['colors'], part['colorLink'] = None, LINK_ALL
            glow = self.glow4(p.get('glow'), f'{where} glow') if p.get('glow') is not None else None
            allow = md.get('allowGlow') or [0, 0, 0, 0]
            for k, v in enumerate(glow or doc['glow']):
                if v > 1 and not allow[k]:
                    if glow is not None:
                        self.add('warning', f'{where} glow', f'glow on colour {k} isn\'t allowed with material {mat}; removed')
                        glow[k] = 0
            part['glow'] = glow
            if md.get('hasSkin') and p.get('colors') is not None:
                self.add('info', where, f'with material {mat} colour 3 is the skin tone: the costume\'s skin colour is used there')
            parts.append(part)

        # required pieces and required children
        for b in cat['requiredBones']:
            if b not in bones_seen:
                d = self._first_piece(cat, b)
                if d:
                    self.add('warning', b, f'required slot was empty: added its default piece {d}')
                    parts.append(self._default_part(cat, b, d))
                    bones_seen[b] = d
                else:
                    self.add('error', b, 'required slot is empty')
        for part in list(parts):
            for c in G[part['geometry']].get('childGeos') or []:
                if c['bone'] in bones_seen:
                    if bones_seen[c['bone']] not in c['options']:
                        self.add('error', c['bone'], f'{bones_seen[c["bone"]]} is not a child piece {part["geometry"]} offers '
                                                     f'(options: {", ".join(c["options"][:8])})')
                elif c.get('required') and c.get('default') in G:
                    self.add('warning', c['bone'], f'{part["geometry"]} needs a piece here: added its default {c["default"]}')
                    parts.append(self._default_part(cat, c['bone'], c['default']))
                    bones_seen[c['bone']] = c['default']
        child_bones = {c['bone']: c for part in parts for c in G[part['geometry']].get('childGeos') or []}
        for part in parts:
            if G[part['geometry']].get('isChild') and part['bone'] not in child_bones:
                self.add('error', part['bone'], f'{part["geometry"]} is a child piece, and no piece in the costume offers it')

        # Each region shows one category at a time (PlayerCostume.RegionCategory) and every piece there must
        # belong to it. Pick the category most pieces fit (the asked-for one if it fits as many); pieces on slots
        # that category doesn't have are dropped, as the creator does; other misfits are errors.
        doc['regionCategories'] = {}
        wanted = src.get('regionCategories') or {}
        for r in cat['regions']:
            mine = [p for p in parts if (B.get(p['bone']) or {}).get('region') == r['name'] and not G[p['geometry']].get('isChild')]
            if not mine:
                continue
            names = {c['name']: c['displayName'] for c in r['categories']}
            order = [c['name'] for c in r['categories']]
            cdefs = {c['name']: c for c in r['categories']}

            def fits(p, c):
                return c in G[p['geometry']]['categories'] or p['bone'] in (cdefs.get(c, {}).get('excludedBones') or [])
            cands = {c for p in mine for c in G[p['geometry']]['categories']}
            score = lambda c: (sum(fits(p, c) for p in mine), c == wanted.get(r['name']), c == r['defaultCategory'],
                               -(order.index(c) if c in order else 99))
            choice = max(cands, key=score)
            if wanted.get(r['name']) and wanted[r['name']] != choice:
                self.add('warning', r['name'], f'category {wanted[r["name"]]} doesn\'t fit the pieces as well; '
                                               f'using {names.get(choice, choice)}')
            doc['regionCategories'][r['name']] = choice
            cdef = cdefs.get(choice, {})
            for p in list(mine):
                if p['bone'] in (cdef.get('excludedBones') or []):
                    self.add('warning', p['bone'], f'category {names.get(choice, choice)} has no {p["bone"]} slot: '
                                                   f'{p["geometry"]} left out')
                    parts.remove(p)
                    bones_seen.pop(p['bone'], None)
                elif choice not in G[p['geometry']]['categories']:
                    self.add('error', p['bone'], f'{p["geometry"]} isn\'t offered with the {r["displayName"]} category '
                             f'{names.get(choice, choice)} the other pieces use (it fits: '
                             + ', '.join(names.get(c, c) for c in G[p['geometry']]['categories']) + ')')
            for b in cdef.get('requiredBones') or []:
                if b not in bones_seen:
                    d = self._first_piece(cat, b, choice)
                    if d:
                        self.add('warning', b, f'category {names.get(choice, choice)} needs a piece here: added {d}')
                        parts.append(self._default_part(cat, b, d))
                        bones_seen[b] = d
                    else:
                        self.add('error', b, f'category {names.get(choice, choice)} needs a piece here')

        # shared colours: given, else the first part with its own, else the creator's default
        if shared is None:
            own = next((p['colors'] for p in parts if p['colors']), None)
            shared = own or [[10, 24, 50, 255], [10, 10, 10, 255], [255, 255, 255, 255], [220, 0, 0, 255]]
            if src.get('parts'):
                self.add('info', 'colors', 'no costume colours given: ' + ('using the first part\'s' if own else 'using the default scheme'))
        doc['colors'] = shared
        for p in parts:
            if p['colors'] is None:
                p['colors'] = [list(c) for c in shared]
            if p['glow'] is None:
                p['glow'] = list(doc['glow']) if p['colorLink'] == LINK_ALL else [0, 0, 0, 0]
        doc['parts'] = parts
        return doc

    @staticmethod
    def _first_piece(cat, bone, category=None):
        """The slot's default piece, else the first player piece the creator lists there (for the category)."""
        G = cat['geometries']
        d = (cat['bones'].get(bone) or {}).get('defaultGeo')
        if d in G and (not category or category in G[d]['categories']):
            return d
        pieces = sorted((n for n, g in G.items() if g['bone'] == bone and g.get('availability') != 'npc' and g.get('mesh')
                         and not DEV.search(g.get('displayName') or '') and (not category or category in g['categories'])),
                        key=lambda n: (G[n].get('availability') != 'initial', G[n].get('order', 0), G[n].get('displayName') or ''))
        return pieces[0] if pieces else None

    def _default_part(self, cat, bone, geo):
        g = cat['geometries'][geo]
        mat = next((m for m in [g.get('defaultMaterial')] + g['materials'] if m and m in cat['materials']), '')
        return {'bone': bone, 'geometry': geo, 'material': mat, 'pattern': '', 'detail': '', 'diffuse': '', 'specular': '',
                'colors': None, 'colorLink': LINK_ALL, 'glow': None}


def check(src):
    """(document or None, problems)"""
    c = Checker()
    try:
        doc = c.check(src if isinstance(src, dict) else {})
    except (KeyError, TypeError, ValueError) as e:
        c.add('error', '', f'could not read the costume: {type(e).__name__}: {e}')
        doc = None
    if c.snapped:
        uniq = list(dict.fromkeys(c.snapped))
        c.add('info', 'colors', f'{len(uniq)} colour(s) moved to the nearest palette colour: ' + ', '.join(uniq[:12])
              + (' …' if len(uniq) > 12 else ''))
    return doc, c.problems


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith('-'):
        print(__doc__)
        sys.exit(2)
    sys.stdout.reconfigure(errors='replace')  # Windows consoles can't print every character
    src = json.load(open(args[0], encoding='utf-8'))
    doc, problems = check(src)
    for p in problems:
        print(f'{p["level"].upper():7} {p["where"]}: {p["message"]}')
    errors = sum(p['level'] == 'error' for p in problems)
    print(f'{errors} errors, {sum(p["level"] == "warning" for p in problems)} warnings'
          + (f'; {len(doc["parts"])} parts' if doc else ''))
    if '--out' in args and doc:
        out = args[args.index('--out') + 1]
        json.dump(doc, open(out, 'w', encoding='utf-8'), indent=1)
        print('wrote', out)
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
