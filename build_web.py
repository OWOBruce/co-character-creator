"""Build the editor's data: one catalog per player skeleton plus palettes, starting costumes and animation.

Usage: python build_web.py
Writes viewer/data/catalog/{Male,Female}.json, palettes.json, costumes.json, stances.json and poses/.
Everything is read from the game install's .hogg archives (gamefs.py / gamedata.py). Meshes (.mset) and
textures (.dds) are not converted: serve.py serves them from the archives at /assets/, and the viewer
decodes them.
"""
import json
import math
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'tools'))
import rig_data as ec  # noqa: E402  (tracks, skeleton, body helpers)
import gamedata  # noqa: E402

OUT = os.path.join(HERE, 'viewer', 'data')
SKELETONS = ('Male', 'Female')


def load(name):
    return json.load(open(os.path.join(HERE, 'catalog', name + '.json'), encoding='utf-8'))


def dds_url(image):
    """catalog image (texture_library/...wtex) -> 'dds/....dds' under /assets/, or None if not in the game."""
    if not image or not gamedata.fs().exists(image):
        return None
    return 'dds/' + image[len('texture_library/'):-len('.wtex')] + '.dds'


def body_def(sdef):
    """Skeleton-level body definition: body_json() for a costume with default values."""
    fake = {'Skeleton': sdef['Name'], 'BodyScale': sdef['DefaultBodyScale'], 'Height': sdef['DefaultHeight'],
            'Muscle': sdef['DefaultMuscle'], 'ScaleValues': []}
    b = ec.body_json(fake)
    b['presets'] = [{'name': p['Name'], 'tag': p['Tag'],
                     'values': {v['pcScaleName']: v['fValue'] for v in p['ScaleValues']}} for p in sdef['ScalePreset']]
    b['sliderGroups'] = [{'name': g['Name'], 'displayName': g['DisplayName'] or g['Name'],
                          'sliders': [{'name': s['Name'], 'displayName': s['DisplayName'] or s['Name']}
                                      for s in g['Scale'] if s['RestrictedTo'] & 4 and (s['PlayerMin'] or s['PlayerMax'])]}
                         for g in sdef['ScaleGroup']]
    b['bodyScaleNames'] = [msg(x['displayNameMsg']) or x['Name'] for x in sdef['BodyScale']]
    return b


from stances import MODES, StanceResolver, mood_bits  # noqa: E402
from buildprogress import each, span  # noqa: E402
RESOLVER = StanceResolver()
MOODS = mood_bits()
# DynBouncer.bin: a QUATPYR in a bin is a 4-float quaternion (tools/bindecode.py)
BOUNCERS = {g['InfoName'].lower(): g for g in gamedata.records('DynBouncer')}
CLOTH_INFO = {c['InfoName']: {k: v for k, v in c.items() if k not in ('InfoName', 'FileName')}
              for c in gamedata.records('DynClothInfo')}
CLOTH_COL = {c['InfoName']: c for c in gamedata.records('DynClothCol')}
RAW_MOODS = gamedata.records('Costumemood')
# the full English table: the catalog's copy lacks stance / body scale names
MESSAGES = gamedata.messages()


def msg(m):
    key = (m or {}).get('Message') if isinstance(m, dict) else m
    return MESSAGES.get(key) if key else None


RAW_GEO = {g['Name']: g for g in gamedata.records('CostumeGeometry')}


def starting_costumes():
    return [c for n, c in sorted(ec.COSTUMES.items())
            if c['Skeleton'] in SKELETONS and n.startswith('Archetype_') and c['Part']]


# pieces and materials worn by the starting costumes (kept even when NPC-only)
USED = {x for c in starting_costumes() for p in c['Part'] for x in (p['Geometry'], p['Material']) if x}


def child_defs(name):
    """CostumeGeometry.Options.ChildGeometryDef: pieces this one puts on child bones (e.g. a robotic chest's arms)."""
    opts = (RAW_GEO.get(name) or {}).get('Options') or {}
    return [{'bone': c['ChildBone'], 'default': c['DefaultChildGeometry'],
             'options': [x['hGeo'] for x in c['ChildGeometry'] if x['hGeo']], 'required': bool(c['RequiresChildGeometry'])}
            for c in opts.get('ChildGeometryDef') or []]


# child pieces offered by player pieces are kept even when they are flagged NPC-only themselves
CHILD_REFS = {x for g in load('geometries') if g['availability'] != 'npc'
              for c in child_defs(g['name']) for x in [c['default'], *c['options']] if x}


# Skinned models whose ModelHeader attaches them to one of these are modelled around a skeleton bone, not in
# character space: belt add-ons around Belt, helmet add-ons around Helmet (also when worn in another slot), the
# waist accessories around their costume bone's skeleton bone (CostumeBone.BoneName). Checked on the data: moved
# there, their centres sit a median 0.4 ft from the bones they're skinned to, against 3.9 ft as stored.
# (Inferred from the data, not ported from the engine.)
LOCAL_ATTACH = {'capebelt': 'Belt', 'helmetextra': 'Helmet', 'waistaccessoriesl': None, 'waistaccessoriesr': None}


def bind_positions(bones_json):
    """Skeleton bone name (lower case) -> bind-pose position in character space."""
    def qmul(a, b):
        ax, ay, az, aw = a
        bx, by, bz, bw = b
        return (aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz)

    def rot(q, v):
        x, y, z, w = q
        ix, iy, iz = w * v[0] + y * v[2] - z * v[1], w * v[1] + z * v[0] - x * v[2], w * v[2] + x * v[1] - y * v[0]
        iw = -x * v[0] - y * v[1] - z * v[2]
        return (ix * w - iw * x - iy * z + iz * y, iy * w - iw * y - iz * x + ix * z, iz * w - iw * z - ix * y + iy * x)
    world = {}
    for i, b in enumerate(bones_json):
        if b['parent'] is None or b['parent'] < 0:
            world[i] = (tuple(b['pos']), tuple(b['quat']))
        else:
            pp, pq = world[b['parent']]
            r = rot(pq, b['pos'])
            world[i] = ((pp[0] + r[0], pp[1] + r[1], pp[2] + r[2]), qmul(pq, tuple(b['quat'])))
    return {bones_json[i]['name'].lower(): p for i, (p, _) in world.items()}


def local_anchor(hdr, costume_bone, bind):
    """The skeleton bone a skinned model is modelled around (see LOCAL_ATTACH), or None."""
    attach = (hdr['attachment_bone'] or '').lower()
    if attach not in LOCAL_ATTACH:
        return None
    name = LOCAL_ATTACH[attach] or (costume_bone or {}).get('BoneName') or ''
    anchor = bind.get(name.lower())
    skin = [bind[b.lower()] for b in hdr['bone_names'] if b.lower() in bind]
    if not anchor or not skin:
        return None
    c = [(hdr['min'][k] + hdr['max'][k]) / 2 for k in range(3)]
    moved = [c[k] + anchor[k] for k in range(3)]
    return name if min(math.dist(moved, p) for p in skin) < min(math.dist(c, p) for p in skin) else None


def build_skeleton(sname, tables, unlock_index):
    geos, mats, texs, regions, cats, bones = tables
    sdef = ec.SKELDEFS[sname]
    skel_json, _ = ec.skeleton_json(sname)
    bind = bind_positions(skel_json['bones'])
    region_names = sdef['regions']
    my_bones = {n: b for n, b in bones.items() if b['Region'] in region_names}
    out_bones = {n: {'displayName': b['displayName'], 'region': b['Region'], 'defaultGeo': b['DefaultGeo'],
                     'mirrorBone': b['MirrorBone'], 'isChild': bool(b['IsChildBone']),
                     'children': [c['ChildBone'] for c in b['ChildBoneEntry']],
                     'colorChoices': b['ColorChoices'], 'colorQuadSet': b['ColorQuadSet'],
                     'bodyColorSets': [b[f'BodyColorSet{i}'] for i in range(4)],
                     'order': b['Order'], 'restrictedTo': b['RestrictedTo']} for n, b in my_bones.items()}
    out_regions = []
    for rn in sorted(region_names, key=lambda r: regions[r]['order']):
        r = regions[rn]
        out_regions.append({'name': rn, 'displayName': r['displayName'], 'defaultCategory': r['defaultCategory'],
                            'categories': [{'name': cn, 'displayName': cats[cn]['displayName'],
                                            'order': cats[cn]['order'], 'hidden': cats[cn]['hidden'],
                                            'requiredBones': cats[cn]['requiredBones'],
                                            'excludedBones': cats[cn]['excludedBones'],
                                            'excludedCategories': cats[cn]['excludedCategories']}
                                           for cn in sorted(r['categories'], key=lambda c: cats[c]['order'])
                                           if cn in cats]})
    bone_sets, bone_set_ix = [], {}
    sub_skeletons = {}
    used_cloth, used_col = set(), set()
    out_geos, used_mats = {}, set()
    for g in each(geos):
        # NPC-only pieces are left out unless a starting costume wears them
        if sname not in g['skeletons'] or g['bone'] not in my_bones or (g['availability'] == 'npc' and g['name'] not in USED | CHILD_REFS):
            continue
        mesh = g['mesh'] if g['meshInstalled'] else None
        rec = {'displayName': g['displayName'], 'bone': g['bone'], 'categories': g['categories'],
               'availability': g['availability'], 'unlockedBy': [unlock_index[u] for u in g['unlockedBy'] if u in unlock_index]
               if g['availability'] != 'initial' else [],
               'mesh': mesh, 'materials': g['materials'], 'defaultMaterial': g['defaultMaterial'],
               'mirrorGeometry': g['mirrorGeometry'], 'hasAlpha': g['hasAlpha'], 'isCloth': g['isCloth'],
               'isChild': g['isChild'], 'childGeos': child_defs(g['name']), 'styles': g['styles'], 'order': g['order']}
        if mesh:
            # which model of the .mset to use, and the names behind its vertex bone indices
            rec['model'] = g['model'].split('.')[-1] if g['model'] else None
            base = os.path.splitext(os.path.basename(mesh))[0]
            hdr = ec.MODEL_HEADERS.get((g['model'] or '').lower()) or ec.MODEL_HEADERS.get(f'{base}.{g["model"]}'.lower())
            if hdr and hdr['bone_names']:
                key = tuple(hdr['bone_names'])
                if key not in bone_set_ix:
                    bone_set_ix[key] = len(bone_sets)
                    bone_sets.append(list(key))
                rec['boneSet'] = bone_set_ix[key]
                anchor = local_anchor(hdr, bones.get(g['bone']), bind)
                if anchor:
                    rec['localTo'] = anchor  # the viewer moves the model to this bone's bind pose before skinning
            elif hdr and hdr['attachment_bone']:
                rec['attachBone'] = hdr['attachment_bone']
            # cloth pieces (capes...): which DynClothInfo / DynClothCollision set drives them
            cd = (RAW_GEO.get(g['name']) or {}).get('ClothData') or {}
            if cd.get('IsCloth'):
                rec['cloth'] = {'info': cd.get('ClothInfo') or 'Cape_Default', 'collision': cd.get('ClothCollision') or '',
                                'back': bool(cd.get('HasClothBack'))}
                used_cloth.add(rec['cloth']['info']); used_col.add(rec['cloth']['collision'])
            # tails, wings...: extra bones from another skeleton, rooted at one of ours
            opts = (RAW_GEO.get(g['name']) or {}).get('Options') or {}
            sub = opts.get('SubSkeleton')
            if sub and sub.lower() in ec.SKELINFOS:
                if sub not in sub_skeletons:
                    path = ec.find_ci(ec.ANIM_ROOT + '/skeletons', ec.SKELINFOS[sub.lower()]['Skeleton'], '.skel')
                    sub_skeletons[sub] = ec.Skeleton(gamedata.fs().read(path)).bones if path else None
                if sub_skeletons[sub]:
                    rec['subSkeleton'], rec['subBone'] = sub, opts.get('SubBone') or 'Base'
        out_geos[g['name']] = rec
        used_mats.update(g['materials'])
    out_mats, used_tex = {}, set()
    for mn in sorted(used_mats):
        m = mats.get(mn)
        if not m or (m['availability'] == 'npc' and mn not in USED):
            continue
        raw = ec.RAW_MAT.get(mn) or {}
        opts = raw.get('ColorOptions') or {}
        muscle = ec.muscle_image(None, m)
        out_mats[mn] = {'displayName': m['displayName'], 'shader': m['shader'], 'availability': m['availability'],
                        'unlockedBy': [unlock_index[u] for u in m['unlockedBy'] if u in unlock_index]
                        if m['availability'] != 'initial' else [],
                        'textures': m['textures'], 'defaults': m['defaults'], 'requires': m['requires'],
                        # per-colour options live in ColorOptions (the top-level copies are unused zeros)
                        'hasSkin': m['hasSkin'], 'allowGlow': opts.get('AllowGlow', [0, 0, 0, 0]),
                        'allowReflection': opts.get('AllowReflection', [0, 0, 0, 0]),
                        'allowSpecularity': opts.get('AllowSpecularity', [0, 0, 0, 0]),
                        'suppressMuscle': opts.get('SuppressMuscle', [0, 0, 0, 0]),
                        # per-colour reflection / specularity the costume code writes over the shader's
                        # ReflectionWeight / SpecularWeight (bytes / 100; GameClient 0xcd0bec, 0xcd1e80)
                        'reflection': opts['defaultReflection'] if opts.get('CustomReflection') else None,
                        'specularity': opts['defaultSpecularity'] if opts.get('CustomSpecularity') else None,
                        'muscle': dds_url(muscle), 'order': m['order']}
        used_tex.update(m['textures'])
        used_tex.update(v for v in m['defaults'].values() if v)
    out_tex = {}
    for tn in sorted(used_tex):
        t = texs.get(tn)
        if not t:
            continue
        out_tex[tn] = {'displayName': t['displayName'], 'type': t['type'], 'availability': t['availability'],
                       'unlockedBy': [unlock_index[u] for u in t['unlockedBy'] if u in unlock_index]
                       if t['availability'] != 'initial' else [],
                       'image': dds_url(t['image']), 'replaces': t['replaces'],
                       'colorSwap': t['colorSwap'] if t['colorSwap'] != [0, 1, 2, 3] else None,
                       'movable': t['movable'] if t['movable'] and any(
                           t['movable'][k] for k in ('CanEditPosition', 'CanEditRotation', 'CanEditScale')) else None,
                       'extra': [{'type': e['type'], 'texture': e['texture'], 'image': dds_url(e['image']),
                                  'replaces': e['replaces']}
                                 for e in t['extra']], 'order': t['order']}
    stances = [{'name': s['Name'], 'displayName': msg(s['displayNameMsg']) or s['Name'],
                'player': bool(s['RestrictedTo'] & 12), 'order': s['Order']} for s in sdef['Stance']]
    return {'name': sname, 'displayName': sdef['displayName'], 'gender': sdef['gender'],
            'skeleton': skel_json, 'body': body_def(sdef), 'stances': sorted(stances, key=lambda s: s['order']),
            'defaultStance': sdef['DefaultStance'], 'defaultSkinColor': sdef['DefaultSkinColor'],
            'moods': [{'name': m['Name'], 'displayName': msg(m['displayNameMsg']) or m['Name'], 'order': m['Order']}
                      for m in sorted(RAW_MOODS, key=lambda m: m['Order'])],
            'skinColorSet': sdef['SkinColorSet'], 'bodyColorSet': sdef['BodyColorSet0'],
            'colorQuadSet': sdef['ColorQuadSet'], 'requiredBones': sdef['requiredBones'],
            'regions': out_regions, 'bones': out_bones, 'geometries': out_geos, 'materials': out_mats,
            'textures': out_tex, 'boneSets': bone_sets, 'bouncers': bouncers_for(sdef['Skeleton']),
            'clothInfos': {n: CLOTH_INFO[n] for n in sorted(used_cloth) if n in CLOTH_INFO},
            'clothCollisions': {n: [{k: sh[k] for k in ('type', 'Bone', 'Offset', 'Direction', 'Radius', 'Exten1', 'Exten2',
                                                          'MovingBackwards', 'InsideVolume')} for sh in CLOTH_COL[n]['Shape']]
                                for n in sorted(used_col) if n in CLOTH_COL},
            'subSkeletons': {n: sub_skeleton_json(n, bones_, sname, sdef) for n, bones_ in sub_skeletons.items() if bones_}}


# ---- material shaders ---------------------------------------------------------------------------
# A costume material names a graphics material (its `shader`, e.g. Avatar_Metal) from Materials.bin: a
# shader template (a graph of operations) plus the values its operations take. tools/matunpack.py decodes
# the materials; the templates are plain records in the same file; tools/shaderops.py reads the operation
# definitions. The viewer compiles each template to GLSL (viewer/js/shader-graph.js).
def shader_json(shader_names):
    """shaders.json: {materials, templates, ops, images} for the costume materials' shaders."""
    from shaderops import ops as op_defs
    mats = {k.lower(): (k, v) for k, v in gamedata.materials().items()}
    templates, defs = gamedata.shader_templates(), op_defs()
    textures = {}
    for path in sorted(gamedata.fs().names('texture_library/', '.wtex')):
        textures.setdefault(path.rsplit('/', 1)[-1][:-len('.wtex')].lower(), path)
    out = {'materials': {}, 'templates': {}, 'ops': {}, 'images': {}}
    wanted = set()
    lower = lambda d: {k.lower(): v for k, v in d.items()}
    for name in sorted(shader_names):
        hit = mats.get(name.lower())
        if not hit:
            continue
        m = hit[1]
        t = templates.get(m['template'].lower())
        if not t:
            continue
        values = {op.lower(): lower(v) for op, v in m['opValues'].items()}
        out['materials'][name] = {'template': t['Name'], 'values': values, 'gfxFlags': m.get('GfxFlags') or 0}
        wanted.update(x.lower() for v in values.values() for x in v.values() if isinstance(x, str) and x)
        if t['Name'] in out['templates']:
            continue
        g = t['ShaderGraph']
        ops = []
        for op in g['Operation']:
            typ = op['OperationType'].lower()
            ops.append({'name': op['Name'].lower(), 'type': typ,
                        'in': {e['InputName'].lower(): [e['SourceName'].lower(), e['SourceOutputName'].lower(),
                                                        ''.join('xyzw'[e[k]] for k in ('SwizzleX', 'SwizzleY', 'SwizzleZ', 'SwizzleW'))]
                               for e in op['Input']},
                        'fixed': {f['InputName'].lower(): f['FValue'] for f in op['FixedInput']}})
            dd = defs.get(typ)
            if dd and typ not in out['ops']:
                out['ops'][typ] = {'inputs': {i['name'].lower(): {'float': i['float'], 'default': i['default']}
                                              for i in dd['inputs']},
                                   'outputs': {o['name'].lower(): o['float'] for o in dd['outputs']}}
        out['templates'][t['Name']] = {'flags': g['Flags'], 'reflection': g['Reflection'], 'ops': ops}
    for x in sorted(wanted):
        url = x in textures and dds_url(textures[x])
        if url:
            out['images'][x] = url
    return out


def bouncers_for(skelinfo):
    """SkelInfo.BouncerInfo -> the skeleton's jiggle bones (DynBouncer.bin, see viewer/js/bouncers.js).
    Type: 0 Linear, 1 Linear2, 2 Hinge, 3 Hinge2. Rotation is an engine (x, y, z, w) quaternion."""
    info = ec.SKELINFOS.get(skelinfo.lower()) or {}
    group = BOUNCERS.get((info.get('BouncerInfo') or '').lower())
    return [{'bone': b['BoneName'], 'type': b['Type'], 'spring': b['spring'], 'damp': b['DampRate'],
             'maxDist': b['MaxDist'], 'rotation': [round(v, 6) for v in b['Rotation']]}
            for b in (group or {}).get('DynBouncer', [])]


def sub_skeleton_json(name, bones, sname, sdef):
    """A sub-skeleton (tail, wings): bones, its own scale groups, and per stance/mode the idle it plays."""
    info = ec.SKELINFOS[name.lower()]
    sinfo = ec.SCALEINFOS.get(info['ScaleInfo'].lower()) if info.get('ScaleInfo') else None
    anim, mood_anim = {}, {}
    for st in sdef['Stance']:
        for mode in MODES:
            rel = RESOLVER.resolve_sub(name, sname, st['Name'], mode)
            track = ec.export_track(rel) if rel else None
            if track:
                anim.setdefault(st['Name'], {})[mode] = track
            if not st['RestrictedTo'] & 8:
                continue
            for mood, bits in MOODS.items():  # e.g. Tail_Low switches the tail to its low idle
                mrel = RESOLVER.resolve_sub(name, sname, st['Name'], mode, bits) if bits else None
                if mrel and mrel != rel and (mt := ec.export_track(mrel)):
                    mood_anim.setdefault(st['Name'], {}).setdefault(mode, {})[mood] = mt
    return {'bones': [{'name': b['name'], 'parent': b['parent'], 'pos': [round(v, 5) for v in b['pos']],
                       'quat': [round(v, 6) for v in b['quat']]} for b in bones],
            'groups': ec.scale_groups(sinfo), 'anim': anim, 'moodAnim': mood_anim}


def npc_parts(cat, c):
    """The parts of PlayerCostume c whose piece or material players can't use (weapon slots aside)."""
    out = []
    for p in c['Part']:
        if not p['Geometry'] or (cat['bones'].get(p['Bone']) or {}).get('region') == 'Weapons'                 or re.search(r'_Weapon_(Melee|Ranged)$', p['Bone'] or '', re.I):
            continue
        g, m = cat['geometries'].get(p['Geometry']), cat['materials'].get(p['Material']) if p['Material'] else None
        if not g or g.get('availability') == 'npc' or (p['Material'] and (not m or m.get('availability') == 'npc')):
            out.append(p['Geometry'])
    return out


def costume_state(c):
    """PlayerCostume -> the editor's costume document."""
    return {'name': c['Name'], 'skeleton': c['Skeleton'], 'stance': c['Stance'], 'skin': c['ColorSkin'],
            'regionCategories': {r['PCRegion']: r['PCCategory'] for r in c['RegionCategory'] or []},
            'height': c['Height'], 'muscle': c['Muscle'], 'bodyScale': c['BodyScale'],
            'scaleValues': {s['pcScaleName']: s['fValue'] for s in c['ScaleValues']},
            'parts': [{'bone': p['Bone'], 'geometry': p['Geometry'], 'material': p['Material'],
                       'pattern': p['PatternTexture'], 'detail': p['DetailTexture'],
                       'diffuse': p['DiffuseTexture'], 'specular': p['SpecularTexture'],
                       'colors': [p[f'Color_{i}'] for i in range(4)],
                       # ColorLink: 0 None, 1 All (shared costume colours), 2 Mirror, 3 Group, 4 MirrorGroup, 5 Different
                       'colorLink': p['ColorLink'], 'materialLink': p['MaterialLink'],
                       'glow': (p['CustomColors'] or {}).get('glowScale', [0, 0, 0, 0])}
                      for p in c['Part'] if p['Geometry']]}


def main():
    os.makedirs(os.path.join(OUT, 'catalog'), exist_ok=True)
    # the tracks are written once per build (export_track skips existing files), so start clean
    shutil.rmtree(os.path.join(OUT, 'poses'), ignore_errors=True)
    os.makedirs(os.path.join(OUT, 'poses'), exist_ok=True)
    bundles = load('unlockBundles')
    unlock_index = {b['name']: i for i, b in enumerate(bundles)}
    unlocks = [{'name': b['name'], 'source': b['source'], 'detail': b['sourceDetail'], 'set': b['costumeSet'],
                'type': b['costumeType'], 'account': b['accountUnlock']} for b in bundles]
    json.dump(unlocks, open(os.path.join(OUT, 'catalog', 'unlocks.json'), 'w'), separators=(',', ':'))
    tables = (load('geometries'), {m['name']: m for m in load('materials')}, {t['name']: t for t in load('textures')},
              {r['name']: r for r in load('regions')}, {c['name']: c for c in load('categories')},
              {b['Name']: b for b in load('bones')})
    cats = {}
    for s in each(SKELETONS, 0, 0.6):
        cat = build_skeleton(s, tables, unlock_index)  # body_def() also exports the body scale tracks
        cats[s] = cat
        path = os.path.join(OUT, 'catalog', s + '.json')
        json.dump(cat, open(path, 'w'), separators=(',', ':'))
        print(f"{s}: {len(cat['geometries'])} geometries, {len(cat['materials'])} materials, "
              f"{len(cat['textures'])} textures, {os.path.getsize(path) >> 10} KB")
    json.dump({'colorSets': load('colorSets'), 'colorQuadSets': load('colorQuadSets')},
              open(os.path.join(OUT, 'catalog', 'palettes.json'), 'w'), separators=(',', ':'))
    with span(0.6, 0.7):
        shaders = shader_json({m['shader'] for s in SKELETONS
                               for m in json.load(open(os.path.join(OUT, 'catalog', s + '.json')))['materials'].values()})
    json.dump(shaders, open(os.path.join(OUT, 'catalog', 'shaders.json'), 'w'), separators=(',', ':'))
    print(f"shaders: {len(shaders['materials'])} materials, {len(shaders['templates'])} templates, "
          f"{len(shaders['ops'])} operation types, {len(shaders['images'])} images")
    # starting costumes a player could make: none with an NPC-only piece or material (weapons aside)
    playable = [c for c in starting_costumes() if not npc_parts(cats[c['Skeleton']], c)]
    print(len(starting_costumes()) - len(playable), 'starting costumes left out for NPC-only pieces')
    costumes = [costume_state(c) for c in playable]
    json.dump(costumes, open(os.path.join(OUT, 'catalog', 'costumes.json'), 'w'), separators=(',', ':'))
    print(len(costumes), 'starting costumes')
    with span(0.75, 1):
        ec.export_stances()


if __name__ == '__main__':
    main()
