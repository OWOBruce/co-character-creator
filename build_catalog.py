"""Decode the costume .bin files and build a web-friendly costume catalog.

Input:  the game install's .hogg archives (gamefs.py / gamedata.py)
Output: catalog/*.json - cleaned catalog with friendly names, asset paths and unlock info
"""
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tools'))
import gamedata  # noqa: E402

CATALOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'catalog')

BINS = gamedata.BINS

RESTRICT = {1: 'NPC', 2: 'NPCObject', 4: 'Player', 8: 'Player_Initial', 16: 'UGC', 32: 'UGC_Initial'}
COSTUME_TYPE = {0: 'NPC', 1: 'NPCObject', 2: 'Player', 3: 'Item', 4: 'Overlay', 5: 'Unrestricted', 6: 'UGC'}
GENDER = {0: 'Unknown', 1: 'Female', 2: 'Male', 3: 'Neutral'}
TEX_TYPE = {1: 'Pattern', 2: 'Detail', 4: 'Specular', 8: 'Diffuse', 16: 'Movable', 32: 'Other'}
COLOR_LINK = {0: 'None', 1: 'All', 2: 'Mirror', 3: 'Group', 4: 'MirrorGroup', 5: 'Different'}


def flags(v, table):
    return [n for b, n in table.items() if v & b]


def availability(restricted):
    if restricted & 8:
        return 'initial'  # available to every player at creation
    if restricted & 4:
        return 'unlock'  # player-usable once unlocked
    return 'npc'


def index_files(prefix, ext):
    """base name (lower case) -> archive path, for the game files under prefix with extension ext"""
    out = {}
    for path in sorted(gamedata.fs().names(prefix, ext)):
        out.setdefault(path.rsplit('/', 1)[-1][:-len(ext)].lower(), path)
    return out


def dump(path, obj, pretty=False):
    with open(path, 'w', encoding='utf-8') as f:
        if pretty:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        else:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


def source_label(path):
    """Defs/Costumes/Items/Rewards/Winter_Event/X.Costume -> ('Items/Rewards', 'Winter Event')."""
    parts = path.split('/')[2:-1]
    if not parts:
        return 'Other', ''
    head = parts[0]
    if head in ('Items',) and len(parts) > 1:
        return f'{head}/{parts[1]}', ' '.join(parts[2:]).replace('_', ' ')
    return head, ' '.join(parts[1:]).replace('_', ' ')


def main():
    from buildprogress import each
    raw = {}
    os.makedirs(CATALOG, exist_ok=True)
    for b in each(BINS, 0, 0.85):  # decoding the .bin files is most of this stage
        r = gamedata.decode(b)
        print(f'{b:24} {len(r["records"]):6} records, {len(r["errors"])} errors')
        raw[b] = r['records']

    msgs = {m['MessageKey']: m['DefaultString'] for m in raw['ClientMessagesEnglish']}
    used_msgs = {}

    def name(obj, key='displayNameMsg'):
        k = (obj.get(key) or {}).get('Message') or ''
        if k in msgs:
            used_msgs[k] = msgs[k]
            return msgs[k]
        return None

    meshes = index_files('bin/geobin/', '.mset')
    textures = index_files('texture_library/', '.wtex')
    icons = {k: v for k, v in textures.items() if v.startswith('texture_library/ui/Icons/')}

    # --- structural tables -------------------------------------------------------------
    regions = [{'name': r['Name'], 'displayName': name(r), 'order': r['Order'],
                'defaultCategory': r['DefaultCategory'],
                'categories': [c['hCategory'] for c in r['Category']], 'file': r['FileName']}
               for r in raw['CostumeRegion']]
    categories = [{'name': c['Name'], 'displayName': name(c), 'order': c['Order'], 'hidden': bool(c['Hidden']),
                   'requiredBones': [b['hBone'] for b in c['RequiredBone']],
                   'excludedBones': [b['hBone'] for b in c['ExcludedBone']],
                   'excludedCategories': [x['hCategory'] for x in c['ExcludedCategory']], 'file': c['FileName']}
                  for c in raw['CostumeCategory']]
    bones = []
    for b in raw['CostumeBone']:
        bones.append({k: v for k, v in b.items() if not k.endswith(('Msg', 'DispName', 'DisplayName'))}
                     | {'displayName': name(b)})
    skeletons = []
    bone_skels = collections.defaultdict(list)
    for s in raw['CostumeSkeleton']:
        req = [b['hBone'] for b in s['RequiredBone']]
        opt = [b['hBone'] for b in s['OptionalBone']]
        for b in req + opt:
            bone_skels[b].append(s['Name'])
        skeletons.append({k: v for k, v in s.items() if k not in ('displayNameMsg', 'RequiredBone', 'OptionalBone', 'Region')}
                         | {'displayName': name(s), 'gender': GENDER.get(s['Gender']),
                            'restrictedTo': flags(s['RestrictedTo'], RESTRICT),
                            'availability': availability(s['RestrictedTo']),
                            'regions': [r['Region'] for r in s['Region']],
                            'requiredBones': req, 'optionalBones': opt})
    simple = lambda rows: [{k: v for k, v in r.items() if k != 'displayNameMsg'} | {'displayName': name(r)} for r in rows]

    # --- unlock bundles ----------------------------------------------------------------
    set_of = {}
    costume_sets = []
    for cs in raw['Costumeset']:
        exprs = [st['OrigStr'] for st in ((cs.get('ExprBlockUnlock') or {}).get('Statement') or [])]
        costume_sets.append({'name': cs['Name'], 'displayName': name(cs), 'costumeType': COSTUME_TYPE.get(cs['CostumeType']),
                             'flags': cs['Flags'], 'unlockExpression': exprs,
                             'costumes': [p['CostumeName'] for p in cs['PlayerCostume']], 'file': cs['FileName']})
        for p in cs['PlayerCostume']:
            set_of[p['CostumeName']] = cs['Name']

    unlock_of = {'geometry': collections.defaultdict(set), 'material': collections.defaultdict(set),
                 'texture': collections.defaultdict(set)}
    bundles = []
    for pc in raw['PlayerCostume']:
        if not (pc['CostumeType'] == 3 or pc['AccountUnlock']):
            continue
        group, detail = source_label(pc['FileName'])
        parts = []
        for p in pc['Part']:
            tex = [p[k] for k in ('PatternTexture', 'DetailTexture', 'SpecularTexture', 'DiffuseTexture') if p[k]]
            if p['Movable'] and p['Movable'].get('MovableTexture'):
                tex.append(p['Movable']['MovableTexture'])
            parts.append({'bone': p['Bone'], 'geometry': p['Geometry'], 'material': p['Material'], 'textures': tex})
            if p['Geometry']:
                unlock_of['geometry'][p['Geometry']].add(pc['Name'])
            if p['Material']:
                unlock_of['material'][p['Material']].add(pc['Name'])
            for t in tex:
                unlock_of['texture'][t].add(pc['Name'])
        base = re.sub(r'_(m|f|male|female)$', '', pc['Name'], flags=re.I).lower()
        bundles.append({'name': pc['Name'], 'source': group, 'sourceDetail': detail, 'file': pc['FileName'],
                        'costumeType': COSTUME_TYPE.get(pc['CostumeType']), 'accountUnlock': bool(pc['AccountUnlock']),
                        'skeleton': pc['Skeleton'], 'gender': GENDER.get(pc['Gender']),
                        'costumeSet': set_of.get(pc['Name']), 'icon': icons.get(base) or icons.get(pc['Name'].lower()),
                        'parts': parts})

    def unlocks(kind, n):
        return sorted(unlock_of[kind].get(n, ()))

    # --- pieces ------------------------------------------------------------------------
    geos = []
    for g in raw['CostumeGeometry']:
        mesh = meshes.get(g['Geometry'].split('/')[-1].lower()) if g['Geometry'] else None
        geos.append({'name': g['Name'], 'displayName': name(g), 'bone': g['Bone'],
                     'skeletons': bone_skels.get(g['Bone'], []),
                     'categories': [c['hCategory'] for c in g['Category']],
                     'styles': g['Style'], 'costumeGroups': g['CostumeGroups'],
                     'availability': availability(g['RestrictedTo']), 'restrictedTo': flags(g['RestrictedTo'], RESTRICT),
                     'unlockedBy': unlocks('geometry', g['Name']),
                     'geometry': g['Geometry'], 'model': g['Model'], 'mesh': mesh, 'meshInstalled': bool(mesh),
                     'mirrorGeometry': g['MirrorGeometry'], 'defaultMaterial': g['DefaultMaterial'],
                     'materials': g['Material'], 'colorChoices': g['ColorChoices'], 'hasAlpha': bool(g['HasAlpha']),
                     'isCloth': bool(g['IsCloth']), 'isChild': bool(g['IsChild']),
                     'children': [{'bone': c['ChildBone'], 'default': c['DefaultChildGeometry'],
                                   'options': [x['hGeo'] for x in c['ChildGeometry']],
                                   'required': bool(c['RequiresChildGeometry'])} for c in g['ChildGeometryDef']],
                     'colorSets': [g[k] for k in ('BodyColorSet0', 'BodyColorSet1', 'BodyColorSet2', 'BodyColorSet3')],
                     'colorQuadSet': g['ColorQuadSet'], 'order': g['Order'], 'file': g['FileName']})
    mats = []
    for m in raw['CostumeMaterial']:
        mats.append({'name': m['Name'], 'displayName': name(m), 'shader': m['Material'],
                     'availability': availability(m['RestrictedTo']), 'restrictedTo': flags(m['RestrictedTo'], RESTRICT),
                     'unlockedBy': unlocks('material', m['Name']),
                     'textures': m['Texture'],
                     'defaults': {k[7:].lower(): m[k] for k in ('DefaultPattern', 'DefaultDetail', 'DefaultSpecular',
                                                                'DefaultDiffuse', 'DefaultMovable') if m[k]},
                     'requires': [k[8:].lower() for k in ('RequiresPattern', 'RequiresDetail', 'RequiresSpecular',
                                                          'RequiresDiffuse', 'RequiresMovable') if m[k]],
                     'hasSkin': bool(m['HasSkin']), 'colorChoices': m['ColorChoices'],
                     'allowGlow': m['AllowGlow'], 'allowReflection': m['AllowReflection'],
                     'allowSpecularity': m['AllowSpecularity'], 'order': m['Order'], 'file': m['FileName']})
    texs = []
    for t in raw['CostumeTexture']:
        img = textures.get(t['NewTexture'].lower()) if t['NewTexture'] else None
        texs.append({'name': t['Name'], 'displayName': name(t), 'type': flags(t['TypeFlags'], TEX_TYPE),
                     'availability': availability(t['RestrictedTo']), 'restrictedTo': flags(t['RestrictedTo'], RESTRICT),
                     'unlockedBy': unlocks('texture', t['Name']),
                     'replaces': t['OrigTexture'], 'texture': t['NewTexture'], 'image': img,
                     'extra': [{'replaces': e['OrigTexture'], 'texture': e['NewTexture'],
                                'image': textures.get(e['NewTexture'].lower()),
                                'type': flags(e['TypeFlags'], TEX_TYPE)} for e in t['ExtraTexture']],
                     'colorSwap': [t[f'ColorSwap{i}'] for i in range(4)], 'colorChoices': t['ColorChoices'],
                     'movable': {k[7:]: t[k] for k in t if k.startswith('Movable') and k != 'MovableOptions'},
                     'order': t['Order'], 'file': t['FileName']})

    out = {
        'regions': regions, 'categories': categories, 'bones': bones, 'skeletons': skeletons,
        'layers': simple(raw['CostumeLayer']), 'styles': simple(raw['CostumeStyle']),
        'moods': simple(raw['Costumemood']), 'colorSets': raw['CostumeColors'],
        'colorQuadSets': raw['CostumeColorQuads'], 'geometries': geos, 'materials': mats, 'textures': texs,
        'unlockBundles': bundles, 'costumeSets': costume_sets,
    }
    for k, v in out.items():
        dump(os.path.join(CATALOG, k + '.json'), v)
    dump(os.path.join(CATALOG, 'messages_en.json'), dict(sorted(used_msgs.items())))

    # --- summary -----------------------------------------------------------------------
    for kind, rows in (('geometries', geos), ('materials', mats), ('textures', texs)):
        c = collections.Counter(r['availability'] for r in rows)
        named = sum(1 for r in rows if r['displayName'])
        un = [r for r in rows if r['availability'] == 'unlock']
        print(f'{kind:11} {dict(c)}  named={named}/{len(rows)}  '
              f'unlock-with-known-source={sum(1 for r in un if r["unlockedBy"])}/{len(un)}')
    print('geometry meshes installed:', sum(g['meshInstalled'] for g in geos if g['geometry']), '/',
          sum(1 for g in geos if g['geometry']))
    print('texture images installed:', sum(1 for t in texs if t['image']), '/', sum(1 for t in texs if t['texture']))
    print('unlock bundles:', len(bundles), collections.Counter(b['source'] for b in bundles).most_common(12))
    print('bundles with icon:', sum(1 for b in bundles if b['icon']))


if __name__ == '__main__':
    main()
