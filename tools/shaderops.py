"""Parse the material system's operation definitions (shaders/Operations/*.op) and their HLSL bodies
(shaders/D3D/ops/*.phl), read from the game's archives: python shaderops.py -> prints a summary.

ops() -> {name_lower: {name, type, inputs: [{name, float, type, texture, default}], outputs: [{name, float}],
                       hlsl}}
A default is {'type': 'Value', 'floats': [...]} or {'type': 'TexCoord0'} etc.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from gamefs import open_game  # noqa: E402


def _blocks(lines, start, end):
    """Yield (first_line_index, [lines]) for each start..end block (not nested in another of the same kind)."""
    i = 0
    while i < len(lines):
        if lines[i] == start:
            j = i + 1
            depth = 0
            while j < len(lines):
                if lines[j] == start:
                    depth += 1
                elif lines[j] == end:
                    if depth == 0:
                        break
                    depth -= 1
                j += 1
            yield lines[i + 1:j]
            i = j
        i += 1


def _floats(s):
    return [float(x) for x in re.split(r'[\s,]+', s.strip()) if x]


def _parse_io(block):
    out = {'name': None, 'float': None, 'type': None, 'texture': False, 'default': None}
    k = 0
    while k < len(block):
        ln = block[k]
        key, _, val = ln.partition(' ')
        val = val.strip()
        if key == 'Name':
            out['name'] = val
        elif key == 'Float':
            out['float'] = int(val.split()[0])
        elif key == 'Type':
            out['type'] = val
        elif key == 'Texture':
            out['texture'] = val.strip() == '1'
        elif key == 'Default':
            d = {}
            k += 1
            while k < len(block) and block[k] != 'EndDefault':
                dk, _, dv = block[k].partition(' ')
                if dk == 'Type':
                    d['type'] = dv.strip()
                elif dk == 'Floats':
                    d['floats'] = _floats(dv)
                elif dk == 'Strings':
                    d['strings'] = dv.strip().strip('"')
                k += 1
            out['default'] = d
        k += 1
    return out


def parse_op(text):
    lines = [re.sub(r'//.*', '', ln).strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    op = {'name': None, 'type': None, 'inputs': [], 'outputs': []}
    for ln in lines:
        key, _, val = ln.partition(' ')
        if key == 'Name' and op['name'] is None:
            op['name'] = val.strip().strip('"')
        elif key == 'Type' and op['type'] is None:
            op['type'] = val.strip()
        elif key == 'Input:':  # short form: "Input: Name, "description""
            op['inputs'].append({'name': val.split(',')[0].strip(), 'float': 4, 'type': None, 'texture': False,
                                 'default': None})
    op['inputs'] += [_parse_io(b) for b in _blocks(lines, 'Input', 'EndInput')]
    op['outputs'] += [_parse_io(b) for b in _blocks(lines, 'Output', 'EndOutput')]
    return op


def ops():
    fs, out = open_game(), {}
    for path in sorted(fs.names('shaders/operations/', '.op')):
        if path.count('/') != 2:
            continue
        op = parse_op(fs.read(path).decode('latin-1'))
        phl = fs.read('shaders/D3D/ops/' + path.rsplit('/', 1)[1][:-3] + '.phl')
        op['hlsl'] = phl.decode('latin-1') if phl is not None else None
        out[op['name'].lower()] = op
    return out


if __name__ == '__main__':
    o = ops()
    print(len(o))
    for k in ('maskcombine', 'colortint4b_ignorealpha', 'fresnelterm_advanced', 'output', 'texture'):
        v = o[k]
        print(v['name'], v['type'], [(i['name'], i['float'], i['default']) for i in v['inputs']][:6],
              [(x['name'], x['float']) for x in v['outputs']])
