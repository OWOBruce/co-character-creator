"""Skeletons, animation tracks and body sliders for build_web.py, read from the install's archives.

skeleton_json: a player skeleton's bones. export_track: one .atrk track -> viewer/data/poses/<name>.json.
body_json: what the viewer needs to apply the body sliders. export_stances: viewer/data/stances.json.
muscle_image: a pattern's muscle normal map.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'tools'))
from atrk import Track  # noqa: E402
from skel import Skeleton  # noqa: E402
import gamedata  # noqa: E402  (game files from the install's archives)

from paths import data  # noqa: E402

OUT = data('viewer', 'data')


def load(name):
    return json.load(open(data('catalog', name + '.json'), encoding='utf-8'))


TEX = {t['name']: t for t in load('textures')}
COSTUMES = {c['Name']: c for c in gamedata.records('PlayerCostume')}
MODEL_HEADERS = {m['modelname'].lower(): m for m in gamedata.records('ModelHeaders')}
SKELDEFS = {s['Name']: s for s in load('skeletons')}
SKELINFOS = {s['Name'].lower(): s for s in gamedata.records('SkelInfos')}
ANIM_ROOT = 'animation_library'


def find_ci(root, rel, ext):
    """Archive path of root/rel+ext (case-insensitive), or None."""
    return gamedata.fs().real_name(f'{root}/{rel}{ext}')


def skeleton_json(costume_skeleton):
    """PlayerCostume.Skeleton (e.g. 'Male') -> bone list from the .skel file."""
    sdef = SKELDEFS[costume_skeleton]
    info = SKELINFOS[sdef['Skeleton'].lower()]
    path = find_ci(ANIM_ROOT + '/skeletons', info['Skeleton'], '.skel')
    sk = Skeleton(gamedata.fs().read(path))
    bones = [{'name': b['name'], 'parent': b['parent'], 'pos': [round(v, 5) for v in b['pos']],
              'quat': [round(v, 6) for v in b['quat']]} for b in sk.bones]
    return {'file': path, 'bones': bones}, sk


def track_file_name(rel):
    return rel.replace('/', '__')


def export_track(rel):
    """Decode animation_library/<rel>.atrk into viewer/data/poses/<name>.json; returns the name or None."""
    name = track_file_name(rel)
    dest = os.path.join(OUT, 'poses', name + '.json')
    if os.path.exists(dest):
        return name
    path = find_ci(ANIM_ROOT, rel, '.atrk')
    if not path:
        print('  missing track', rel)
        return None
    t = Track(gamedata.fs().read(path))
    # per bone: flat arrays over frames. The engine applies the conjugate of the quaternion
    # it stores (row-vector matrices), so store conj(q) for three.js.
    bones = {}
    for f in range(t.frames):
        for bn, ch in t.frame(f).items():
            b = bones.setdefault(bn, {})
            if ch['quat']:
                qx, qy, qz, qw = ch['quat']
                b.setdefault('quat', []).extend(round(v, 5) for v in (-qx, -qy, -qz, qw))
            if ch['pos']:
                b.setdefault('pos', []).extend(round(v, 5) for v in ch['pos'])
            if ch.get('scale'):
                b.setdefault('scale', []).extend(round(v, 5) for v in ch['scale'])
    json.dump({'name': rel, 'frames': t.frames, 'bones': bones}, open(dest, 'w'), separators=(',', ':'))
    return name


SCALEINFOS = {s['ScaleInfoName'].lower(): s for s in gamedata.records('ScaleInfos')}


def scale_groups(sinfo):
    """ScaleInfo groups: per bone Small/Large Min/Max, Universal, Translation, CounterScale; included groups."""
    return {g['GroupName']: {
        'bones': [{'bone': b['Bone'], 'smallMin': b['SmallMin'], 'smallMax': b['SmallMax'],
                   'largeMin': b['LargeMin'], 'largeMax': b['LargeMax'], 'universal': bool(b['Universal']),
                   'translation': bool(b['Translation']), 'counter': b['CounterScale']} for b in g['Bone']],
        'include': [(i['Group'], i['Fraction']) for i in g['Group']]} for g in sinfo['ScaleGroup']} if sinfo else {}


def body_json(c):
    """Everything the viewer needs to apply the body sliders of costume c.

    * sliders: player scale name -> [(group, axis)]; ScaleValues are -100..100 and feed group input[axis]
    * groups: SkelScaleGroup per name: bones with Small/Large Min/Max (value at input -1/+1 for a slim/heavy
      body), Universal (scale inherited by children), Translation (offsets instead of scale),
      CounterScale (children that cancel the scale) and included groups with a fraction
    * bodyScales: BodyScale[i] (0..100) with its scale track; frame = value/100 * (frames-1)
    """
    sdef = SKELDEFS[c['Skeleton']]
    info = SKELINFOS[sdef['Skeleton'].lower()]
    sinfo = SCALEINFOS.get(info['ScaleInfo'].lower()) if info.get('ScaleInfo') else None
    # a slider with a SubSkeleton only drives that sub-skeleton's scale groups (tails, wings)
    sliders = {s['Name']: {'affects': [(a['Name'], a['Index']) for a in s['Affects']], 'group': g['Name'],
                           'min': s['PlayerMin'], 'max': s['PlayerMax'], 'player': bool(s['RestrictedTo'] & 4),
                           'subSkeleton': s['SubSkeleton'] or None}
               for g in sdef['ScaleGroup'] for s in g['Scale']}
    groups = scale_groups(sinfo)
    tracks = {t['Name'].lower(): t['ScaleAnimFile'] for t in sinfo['ScaleAnimTrack']} if sinfo else {}
    body_scales = []
    names = [b['Name'] for b in sdef['BodyScale']]
    values = c['BodyScale'] or sdef['DefaultBodyScale']
    for i, n in enumerate(names):
        v = values[i] if i < len(values) else (sdef['DefaultBodyScale'][i] if i < len(sdef['DefaultBodyScale']) else 50)
        rel = tracks.get(n.lower())
        track = export_track(rel) if rel else None
        fallback = None
        if rel and not track and n.lower() == 'bodymass' and c['Skeleton'] == 'Female':
            # Core_Female/Core_Female_Scale is not installed locally; this is the closest shipped equivalent
            fallback = 'Coredefault/Scale/Core_Muscle_Female_Scale'
            track = export_track(fallback)
        body_scales.append({'name': n, 'value': v, 'track': track, 'fallback': fallback})
    return {'height': c['Height'] or sdef['DefaultHeight'], 'heightBase': sdef['HeightBase'] or 6.0,
            'heightRange': [sdef['PlayerMinHeight'], sdef['PlayerMaxHeight']],
            'bodyScaleRange': [sdef['PlayerMinBodyScale'], sdef['PlayerMaxBodyScale']],
            'muscle': c['Muscle'], 'muscleRange': [sdef['PlayerMinMuscle'], sdef['PlayerMaxMuscle']],
            'defaultMuscle': sdef['DefaultMuscle'], 'noMuscle': bool(sdef['NoMuscle']), 'bodyScales': body_scales,
            'scaleValues': {s['pcScaleName']: s['fValue'] for s in c['ScaleValues']},
            'sliders': sliders, 'groups': groups,
            'heightFixupBone': sinfo['HeightFixupBone'] if sinfo else None}


def export_stances():
    """viewer/data/stances.json: {skeleton: {stance: {mode: [{sequencer, bones, track}]}}}, plus
    'moods': {skeleton: {stance: {mode: {mood: layers}}}} for player stances where a mood changes the layers."""
    from stances import MODES, StanceResolver, mood_bits
    r = StanceResolver()
    moods = mood_bits()
    out = {'moods': {}}

    def layers_for(skel, stance, mode, extra=()):
        layers = []
        for e in r.resolve(skel, stance, mode, extra)['sequencers']:
            if e.get('track'):
                name = export_track(e['track'])
                if name:
                    layers.append({'sequencer': e['sequencer'], 'bones': e['bones'], 'track': name,
                                   'sequence': e['sequence'], 'move': e['move']})
        return layers
    from buildprogress import each
    for skel in each(('Male', 'Female')):
        for st in each(r.skeldefs[skel]['Stance']):
            for mode in MODES:
                base = out.setdefault(skel, {}).setdefault(st['Name'], {})[mode] = layers_for(skel, st['Name'], mode)
                if not st['RestrictedTo'] & 8:
                    continue
                for mood, bits in moods.items():
                    ls = layers_for(skel, st['Name'], mode, bits) if bits else base
                    if ls != base:
                        out['moods'].setdefault(skel, {}).setdefault(st['Name'], {}).setdefault(mode, {})[mood] = ls
    json.dump(out, open(os.path.join(OUT, 'stances.json'), 'w'), indent=1)


RAW_MAT = {m['Name']: m for m in gamedata.records('CostumeMaterial')}
IMAGE_BY_TEXTURE = {}
for _t in TEX.values():
    for _e in [_t] + _t['extra']:
        if _e['texture'] and _e['image']:
            IMAGE_BY_TEXTURE.setdefault(_e['texture'].lower(), _e['image'])


def _find_texture_image(name):
    """Image path for a raw texture name (e.g. 'F_Chest_Tight_01_N'), from the catalog or the texture folders."""
    if not name:
        return None
    img = IMAGE_BY_TEXTURE.get(name.lower())
    if img:
        return img
    want = '/' + name.lower() + '.wtex'
    return next((p for p in sorted(gamedata.fs().names('texture_library/costumes/', '.wtex')) if p.lower().endswith(want)), None)


def muscle_image(pattern, material):
    """The shader's 'Muscles' normal map: a pattern-specific *_Muscle_N override if the pattern has one,
    else the material's default, i.e. the base body normal that muscle overrides replace."""
    t = TEX.get(pattern)
    for e in (t['extra'] if t else []):
        if e['texture'] and 'muscle' in e['texture'].lower() and e['image']:
            return e['image']
    for tn in (material or {}).get('textures', []):
        for e in (TEX.get(tn) or {}).get('extra', []):
            if e['texture'] and 'muscle' in e['texture'].lower() and e['replaces']:
                return _find_texture_image(e['replaces'])
    return None
