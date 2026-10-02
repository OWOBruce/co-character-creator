"""Turn a game costume file (Costume_*.jpg, or its costume text) into the index's costume JSON.

    python .claude/skills/build-costume/costume_to_json.py <Costume_....jpg | costume.txt> [out.json]

The game keeps the costume as Cryptic parser text in the JPEG's IPTC record 2:202 (see viewer/js/costume-file.js).
Everything a costume JSON can say is carried over: skeleton, stance, height, muscle, skin, body-shape sliders
(bodyScale, scaleValues), region categories, and per part geometry, bone, material, pattern/detail/diffuse/
specular textures, colours and glow. Link and lock settings (ColorLink, MaterialLink, ControlledRandomLocks)
aren't part of the JSON format and are dropped. Prints the JSON when no output file is given.
"""
import json
import re
import sys


def costume_text(path):
    data = open(path, 'rb').read()
    if not data.startswith(b'\xff\xd8'):
        return data.decode('latin1')
    k = data.find(b'\x1c\x02\xca')  # IPTC record 2, dataset 202
    if k < 0:
        sys.exit(f'{path}: no costume in this picture (no IPTC 2:202 record)')
    n = int.from_bytes(data[k + 3:k + 5], 'big')
    return data[k + 5:k + 5 + n].decode('latin1')


def parse(text):
    """Cryptic parser text -> nested [(name, value, block|None)]."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    i = 0

    def block():
        nonlocal i
        out = []
        while i < len(lines):
            line = lines[i]; i += 1
            if line == '}':
                return out
            if line == '{':
                out.append(('', '', block())); continue
            m = re.match(r'^(\S+)(?:\s(.*))?$', line)
            name, value = m.group(1), (m.group(2) or '').strip()
            sub = None
            if i < len(lines) and lines[i] == '{':
                i += 1; sub = block()
            out.append((name, value, sub))
        return out
    return block()


def nums(v):
    return [float(x) for x in v.split(',') if x.strip()]


def hexc(c):
    return '#%02x%02x%02x' % tuple(round(x) for x in c[:3])


def find_costume(entries):
    for name, value, sub in entries:
        if sub is not None and name.lower().startswith('costume'):
            return value.strip('"'), sub
        if sub is not None:
            found = find_costume(sub)
            if found:
                return found
    return None


def to_json(text):
    found = find_costume(parse(text))
    if not found:
        sys.exit('No costume found in the text')
    name, fields = found
    out = {'skeleton': '', 'name': name.split('_', 1)[-1] if '_' in name else name}
    scale, regions, parts = {}, {}, []
    part_keys = {'Bone': 'bone', 'Geometry': 'geometry', 'Material': 'material', 'PatternTexture': 'pattern',
                 'DetailTexture': 'detail', 'DiffuseTexture': 'diffuse', 'SpecularTexture': 'specular'}
    for key, value, sub in fields:
        if key == 'Skeleton': out['skeleton'] = value.strip('"')
        elif key == 'Stance': out['stance'] = value.strip('"')
        elif key == 'Height': out['height'] = round(float(value), 4)
        elif key == 'Muscle': out['muscle'] = round(float(value), 4)
        elif key == 'ColorSkin': out['skin'] = hexc(nums(value))
        elif key == 'BodyScale': out['bodyScale'] = nums(value)
        elif key == 'ScaleValues':
            n, v = value.split(); scale[n] = float(v)
        elif key == 'RegionCategory':
            r, c = value.split(); regions[r] = c
        elif key == 'Part' and sub is not None:
            p, colors = {}, [None] * 4
            for pk, pv, psub in sub:
                if pk in part_keys: p[part_keys[pk]] = pv.strip('"')
                elif re.fullmatch(r'Color_[0-3]', pk): colors[int(pk[-1])] = hexc(nums(pv))
                elif pk == 'CustomColors' and psub:
                    for gk, gv, _ in psub:
                        if gk == 'glowScale' and any(nums(gv)): p['glow'] = [round(x, 3) for x in nums(gv)]
            if all(colors): p['colors'] = colors
            parts.append({k: p[k] for k in ('geometry', 'bone', 'material', 'pattern', 'detail', 'diffuse',
                                            'specular', 'colors', 'glow') if p.get(k)})
    if scale: out['scaleValues'] = scale
    if regions: out['regionCategories'] = regions
    out['parts'] = parts
    return out


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    result = json.dumps(to_json(costume_text(sys.argv[1])), indent=1)
    if len(sys.argv) > 2:
        open(sys.argv[2], 'w', encoding='utf-8').write(result + '\n')
    else:
        print(result)
