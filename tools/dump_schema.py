"""Recover Cryptic ParseTables from GameClient.exe into catalog/schema.json.

ParseTable row (32-bit, 40 bytes):
  u32 name, u32 ?, u32 type (low byte = token, high bits = flags), u32 type_hi,
  u32 offset, u32 param, u32 subtable, u32 format, u32, u32
A table begins with a header row (token 0, type_hi 0x04000000, offset = struct size)
and ends with a token-2 row.

build.py runs this against the chosen install (python tools/dump_schema.py [out.json] [GameClient.exe]).
"""
import json
import os
import struct
import sys

from pe import PE

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'catalog', 'schema.json')


def main(out=OUT, exe=None):
    if not exe:
        sys.path.insert(0, os.path.join(HERE, '..'))
        from gamefs import open_game
        exe = open_game().exe
        if not exe:
            raise FileNotFoundError('GameClient.exe is not next to the piggs folder of the chosen install')
    p = PE(exe)
    d = p.d
    _, sva, vs, raw, rs = p.secs[2]  # .data
    tables = {}

    def parse(o):
        w = struct.unpack_from('<10I', d, o)
        if True:
            va = p.va(o)
            fields = []
            k = o + 40
            while k < raw + rs - 40:
                f = struct.unpack_from('<10I', d, k)
                tok = f[2] & 0xff
                if tok == 2 or (f[0] == 0 and f[2] == 0):
                    break
                if tok != 1:
                    sub = f[6]
                    subname = None
                    if sub and p.off(sub):
                        s0 = struct.unpack_from('<I', d, p.off(sub))[0]
                        subname = p.cstr(s0) if s0 and p.off(s0) else p.cstr(sub)
                    fields.append({'name': p.cstr(f[0]) if f[0] and p.off(f[0]) else '',
                                   'tok': tok, 'flags': f[2] & ~0xff, 'hi': f[3],
                                   'offset': f[4], 'param': f[5], 'sub': sub,
                                   'subname': subname, 'format': f[7]})
                k += 40
            tables[hex(va)] = {'name': p.cstr(w[0]), 'size': w[4], 'fields': fields}

    for o in range(raw, raw + rs - 80, 4):
        w = struct.unpack_from('<4I', d, o)
        if w[0] and w[2] == 0 and w[3] == 0x04000000 and p.off(w[0]) and p.cstr(w[0]):
            parse(o)
    # follow subtable pointers the scan missed
    todo = True
    while todo:
        todo = False
        for t in list(tables.values()):
            for f in t['fields']:
                if f['tok'] == 0x14 and f['sub'] and hex(f['sub']) not in tables and p.off(f['sub']):
                    w = struct.unpack_from('<4I', d, p.off(f['sub']))
                    if w[3] == 0x04000000:
                        parse(p.off(f['sub']))
                        todo = True
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    json.dump(tables, open(out, 'w'), indent=1)
    return len(tables)


if __name__ == '__main__':
    print(main(*sys.argv[1:]), 'tables')
