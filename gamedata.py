"""Decoded game data for the build, straight from the install's archives (gamefs.py).

    records('CostumeGeometry')   # the records of bin/CostumeGeometry.bin, decoded once per run
    materials()                  # the graphics materials of bin/Materials.bin (tools/matunpack.py)
    shader_templates()           # its shader templates

Replaces the old decoded/*.json files of the extraction: nothing is written.
"""
import os
import sys
from functools import lru_cache

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'tools'))
import bindecode as B  # noqa: E402
from gamefs import open_game  # noqa: E402

# bin -> (parse table, fields stripped from this bin). Client-stripped bins omit fields whose second type
# word has 0x400 (bindecode.HI_NO_BIN); the dynamics bins keep them.
BINS = {
    'CostumeGeometry': 'PCGeometryDef', 'CostumeMaterial': 'PCMaterialDef',
    'CostumeTexture': 'PCTextureDef', 'PlayerCostume': 'PlayerCostume',
    'CostumeSkeleton': 'PCSkeletonDef', 'CostumeBone': 'PCBoneDef',
    'CostumeRegion': 'PCRegion', 'CostumeCategory': 'PCCategory', 'CostumeLayer': 'PCLayer',
    'CostumeStyle': 'PCStyle', 'Costumemood': 'PCMood', 'Costumeset': 'PCCostumeSet',
    'CostumeColorQuads': 'PCColorQuadSet', 'CostumeColors': 'UIColorSet',
    'CostumeGeometryAdd': 'PCGeometryAdd', 'CostumeMaterialAdd': 'PCMaterialAdd',
    'Costumetransition': 'PCTransition', 'ModelHeaders': 'ModelHeader',
    'ClientMessagesEnglish': 'Message',
}
OTHER_BINS = {  # name -> (table, skip_hi); checked against the earlier decodes of the extracted files
    'SkelInfos': ('SkelInfo', B.HI_NO_BIN), 'BlendInfos': ('SkelBlendInfo', B.HI_NO_BIN),
    'ScaleInfos': ('SkelScaleInfo', B.HI_NO_BIN), 'DynSequences': ('DynSeqData', B.HI_NO_BIN),
    'DynMove': ('DynMove', 0),
    'DynBouncer': ('DynBouncerGroupInfo', B.HI_NO_BIN), 'DynClothInfo': ('DynClothInfo', B.HI_NO_BIN),
    'DynClothCol': ('DynClothCollisionInfo', B.HI_NO_BIN),
    'Skies': ('SkyInfo', B.HI_NO_BIN),
}


@lru_cache(maxsize=1)
def schema():
    """The client's parse tables (catalog/schema.json), read out of the install's GameClient.exe when missing;
    build.py rewrites it on every build so it follows game patches."""
    import dump_schema
    if not os.path.isfile(dump_schema.OUT):
        dump_schema.main()
    return B.Schema(dump_schema.OUT)


def fs():
    return open_game()


def bin_bytes(name):
    data = fs().read(f'bin/{name}.bin')
    if data is None:
        raise FileNotFoundError(f'bin/{name}.bin is not in the game archives')
    return data


@lru_cache(maxsize=None)
def decode(name):
    """{'records', 'errors'} of bin/<name>.bin."""
    table, skip = OTHER_BINS[name] if name in OTHER_BINS else (BINS[name], B.HI_NO_BIN)
    return B.Decoder(schema(), skip_hi=skip).decode_file(bin_bytes(name), table)


def records(name):
    return decode(name)['records']


@lru_cache(maxsize=1)
def messages():
    """English message key -> text."""
    return {m['MessageKey']: m['DefaultString'] for m in records('ClientMessagesEnglish')}


@lru_cache(maxsize=1)
def shader_templates():
    """ShaderTemplate records of Materials.bin (the plain part before the packed materials), by lower-case name."""
    s = schema()
    dec = B.Decoder(s)
    r = B.Reader(bin_bytes('Materials'))
    dec.files = B.read_header(r)
    r.u32()  # MaterialLoadInfo size
    n = r.u32()
    return {t['Name'].lower(): t for t in (dec.sized_struct(r, s.table('ShaderTemplate')) for _ in range(n))}


@lru_cache(maxsize=1)
def materials():
    """Graphics materials of Materials.bin: name -> {template, opValues, ...} (tools/matunpack.py)."""
    import matunpack
    return matunpack.decode_materials(bin_bytes('Materials'))
