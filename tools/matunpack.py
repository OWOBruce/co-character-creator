"""Decode the bit-packed MaterialData records in Champions Online's bin/Materials.bin.

Format (reverse-engineered from GameClient.exe structpack.c / bitstream.c):

File: CrypticS header, MaterialLoadInfo {ShaderTemplate[] (sized), u32 0, u32 present=1,
SerializablePackedStructStream {globalStringTable[], method, flags, TextParserBinaryBlock
{Ints[] (the bitstream, as LE u32 words), ActualByteSize, SizeBeforeZipping}},
MaterialDataInfoSerialize[] {material_name, data_offset (BIT offset), filename, texture_deps}}.

Bitstream (0x114efb0): bytes read LSB-first; an N-bit value is assembled low bits first.
packedInt(n) (0x114f510): v=read(n); base=0; while v == 2^n-1 and n<32: base+=2^n-1;
  n=min(2n,32); v=read(n).  Result v+base.

Record at data_offset (0x11f4480 / 0x11f47e0):
  if stream.flags & 1: 32 bits (ignored here)
  pos0 = tell(); jump = read(16 if method==0 else 28); string list at pos0+jump.
  String list: n=packedInt(1); ids[0]=packedInt(15); ids[i]=ids[i-1]+delta where
    delta: bit=1 -> +1; else sign=bit (1 -> negative), sel=read(2), mag=read([4,9,14,32][sel]).
  Then (back at pos0+16) the struct, which ends exactly at the string list; the record ends
  after the string list, padded to a byte boundary (next data_offset).
Struct (0x11f5460): idx=-1 (ParseTable row index, row 0 = table header row);
  while read(1): idx += packedInt(2)+1; unpack column idx.  Omitted columns = default.
Column (0x11f54e0): plain -> one value.  EARRAY (0x11f5620): count=packedInt(max(1,(flags>>8)&0xff)),
  then sparse element list (0x11f4ca0): i=-1; while read(1): i += packedInt(1)+1; elem i.
  FIXED (0x11f55a0): same sparse list over param elements (MATPYR: one value).
Values: INT/U8/I16: packedInt(max(1,(flags>>8)&0xff)).  F32: precision p=(flags>>8)&0xff;
  p==0 -> raw 32-bit float, else packedInt(bits[p]) (signed) * scale[p]
  (p: 1 -> 8 bits*0.01, 2 -> 6*0.1, 3 -> 7*1, 4 -> 5*5, 5 -> 4*10).
  STRING/CURRENTFILE/FILENAME with POOLED: seen=#strings already taken in this record;
    if seen==0 or read(1): s=ids[seen]; seen+=1 else s=ids[read(ceil_log2(seen))];
    value = globalStringTable[s].  Non-pooled / REFERENCE: inline NUL-terminated bytes.
  BOOLFLAG: no bits, presence => true.  STRUCT: presence bit, then recursive struct.
  BIT: packedInt(param>>16); the width is patched in at runtime (MaxReflectResolution = 4).
"""
import json
import os
import struct
import sys

import bindecode as B


FLOAT_PREC = {1: (8, 0.01), 2: (6, 0.1), 3: (7, 1.0), 4: (5, 5.0), 5: (4, 10.0)}
DELTA_BITS = [4, 9, 14, 32]
BIT_WIDTHS = {'MaxReflectResolution': 4}  # all 53 materials using it then decode exactly


class BitStream:
    def __init__(self, data):
        self.d = data
        self.pos = 0  # bit position
        self.n = len(data) * 8

    def read(self, n):
        if n == 0:
            return 0
        p = self.pos
        if p + n > self.n:
            raise B.DecodeError('read past end of bitstream')
        o = p >> 3
        chunk = int.from_bytes(self.d[o:o + 5], 'little')
        self.pos = p + n
        return (chunk >> (p & 7)) & ((1 << n) - 1)

    def packed(self, n):
        if n == 0:
            raise B.DecodeError('packed int with 0 bits')
        v = self.read(n)
        base = 0
        while v == (1 << n) - 1 and n != 32:
            base += (1 << n) - 1
            n = min(n * 2, 32)
            v = self.read(n)
        return (v + base) & 0xffffffff

    def cstring(self):
        out = bytearray()
        while True:
            b = self.read(8)
            if b == 0:
                return out.decode('utf-8', 'replace')
            out.append(b)


def s32(v):
    return v - (1 << 32) if v & 0x80000000 else v


class Unpacker:
    def __init__(self, schema, strings, bits, method=0, flags=3):
        self.s = schema
        self.strings = strings
        self.bs = bits
        self.method, self.flags = method, flags
        # engine row index -> field (row 0 is the table header row, dropped by dump_schema)
        self.rows = {}

    def table_rows(self, table):
        key = table['name']
        if key not in self.rows:
            self.rows[key] = [None] + table['fields']
        return self.rows[key]

    def record(self, bitoff, table):
        bs = self.bs
        bs.pos = bitoff
        if self.flags & 1:
            bs.read(32)
        pos0 = bs.pos
        jump = bs.read(16 if self.method == 0 else 28)
        target = pos0 + jump
        cur = bs.pos
        bs.pos = target
        n = bs.packed(1)
        ids = []
        for i in range(n):
            if i == 0:
                ids.append(bs.packed(15))
            else:
                if bs.read(1):
                    d = 1
                else:
                    sign = -1 if bs.read(1) else 1
                    d = sign * bs.read(DELTA_BITS[bs.read(2)])
                ids.append(ids[-1] + d)
        end = bs.pos
        bs.pos = cur
        self.ids, self.seen = ids, 0
        out = self.struct(table)
        struct_end = bs.pos
        return out, struct_end, target, end

    def struct(self, table):
        bs = self.bs
        rows = self.table_rows(table)
        out = {}
        idx = -1
        while bs.read(1):
            idx += bs.packed(2) + 1
            if idx >= len(rows) or rows[idx] is None:
                raise B.DecodeError(f"{table['name']}: bad column {idx}")
            f = rows[idx]
            out[f['name']] = self.column(f)
        return out

    def column(self, f):
        bs = self.bs
        fl = f['flags']
        if f['flags'] & B.F_EARRAY and f['tok'] != B.TOK_FUNCTIONCALL:
            nb = (fl >> 8) & 0xff or 1
            count = bs.packed(nb)
            return self.sparse(f, count)
        if f['flags'] & B.F_FIXED and f['tok'] != B.TOK_MATPYR:
            return self.sparse(f, f['param'])
        return self.value(f)

    def sparse(self, f, count):
        bs = self.bs
        arr = [None] * count
        i = -1
        while bs.read(1):
            i += bs.packed(1) + 1
            if i >= count:
                raise B.DecodeError(f"{f['name']}: element {i} >= {count}")
            arr[i] = self.value(f)
        if f['tok'] == B.TOK_F32:
            arr = [0.0 if v is None else v for v in arr]
        elif f['tok'] in (B.TOK_INT, B.TOK_U8, B.TOK_I16):
            arr = [0 if v is None else v for v in arr]
        return arr

    def value(self, f):
        bs = self.bs
        tok, fl = f['tok'], f['flags']
        prec = (fl >> 8) & 0xff
        if tok in (B.TOK_U8, B.TOK_I16, B.TOK_INT):
            return s32(bs.packed(prec or 1))
        if tok == B.TOK_F32:
            if prec == 0:
                return struct.unpack('<f', struct.pack('<I', bs.read(32)))[0]
            nb, scale = FLOAT_PREC[prec]
            return round(s32(bs.packed(nb)) * scale, 6)
        if tok in (B.TOK_STRING, B.TOK_CURRENTFILE, B.TOK_FILENAME):
            if fl & B.F_POOLED:
                n = self.seen
                if n == 0 or bs.read(1):
                    sid = self.ids[n]
                    self.seen += 1
                else:
                    sid = self.ids[bs.read((n - 1).bit_length())]
                return self.strings[sid] if 0 <= sid < len(self.strings) else None
            return bs.cstring()
        if tok == B.TOK_REFERENCE:
            return bs.cstring()
        if tok == B.TOK_BOOLFLAG:
            return True
        if tok == B.TOK_BIT:
            # bit width lives in param's high word, filled in by the engine at runtime; the
            # static tables leave it 0, so use widths verified against the data.
            return bs.packed(f['param'] >> 16 or BIT_WIDTHS[f['name']])
        if tok == B.TOK_STRUCT:
            if not bs.read(1):
                return None
            return self.struct(self.s.table(f['sub']))
        raise B.DecodeError(f"unsupported token {tok} ({f['name']})")


def load(d):
    """d: the bytes of Materials.bin"""
    s = B.Schema()
    dec = B.Decoder(s)
    r = B.Reader(d)
    dec.files = B.read_header(r)
    r.u32()  # MaterialLoadInfo size
    for _ in range(r.u32()):  # ShaderTemplate records (sized): skip
        size = r.u32()
        r.p += size
    r.u32()  # stTemplates / overrides (empty)
    assert r.u32() == 1  # packed_data_serialize present
    pss = dec.sized_struct(r, s.table('SerializablePackedStructStream'))
    n = r.u32()
    infos = [dec.sized_struct(r, s.table('MaterialDataInfoSerialize')) for _ in range(n)]
    blk = pss['binary_block']
    data = struct.pack(f'<{len(blk["Ints"])}I', *[x & 0xffffffff for x in blk['Ints']])[:blk['ActualByteSize']]
    up = Unpacker(s, pss['globalStringTable'], BitStream(data + b'\0' * 8),
                  pss['method'], pss['flags'])
    return s, up, infos


def simplify(m):
    """MaterialData dict -> friendlier JSON shape."""
    def ops(lst):
        out = {}
        for ov in lst or []:
            if ov is None:
                continue
            vals = {}
            for sv in ov.get('SpecificValue') or []:
                if sv is None:
                    continue
                sval = sv.get('SValue')
                if isinstance(sval, list) and len(sval) == 1:
                    sval = sval[0]
                if 'SValue' in sv:
                    v = sval if 'FValue' not in sv else {'SValue': sval, 'FValue': sv['FValue']}
                else:
                    v = sv.get('FValue', [])
                vals[sv.get('InputName')] = v
            out[ov.get('OpName')] = vals
        return out

    def maps(lst):
        return {im.get('OpName'): im.get('MappedOpName') for im in lst or [] if im}

    o = {'template': m.get('Template'), 'filename': m.get('FN'),
         'opValues': ops(m.get('OperationValue')), 'inputMapping': maps(m.get('InputMapping'))}
    fb = []
    for f in m.get('Fallback') or []:
        if f is None:
            fb.append(None)
            continue
        fb.append({'template': f.get('Template'), 'opValues': ops(f.get('OperationValue')),
                   'inputMapping': maps(f.get('InputMapping'))})
    if fb:
        o['fallback'] = fb
    for k, v in m.items():
        if k not in ('Template', 'FN', 'N', 'OperationValue', 'InputMapping', 'Fallback'):
            o[k] = v
    return o


def decode_materials(d, report=None):
    """All materials of Materials.bin (bytes): name -> simplified record. report(msg) gets problems."""
    s, up, infos = load(d)
    table = s.table('MaterialData')
    total = up.bs.n
    offs = [i['data_offset'] for i in infos]
    ends = sorted(set(offs))
    nxt = {o: (ends[k + 1] if k + 1 < len(ends) else None) for k, o in enumerate(ends)}
    out, bad, mism = {}, [], []
    for info in infos:
        name = info['material_name']
        try:
            m, send, target, end = up.record(info['data_offset'], table)
        except (B.DecodeError, IndexError, KeyError, struct.error) as e:
            bad.append((name, str(e)))
            continue
        if send != target:
            mism.append((name, 'struct end %d != string list %d' % (send, target)))
        n2 = nxt[info['data_offset']]
        if n2 is not None and (end + 7) & ~7 != n2:  # records are byte-aligned
            mism.append((name, 'record end %d != next offset %d' % (end, n2)))
        if m.get('N') != name:
            mism.append((name, 'N=%r' % m.get('N')))
        e = simplify(m)
        e['texture_deps'] = info.get('texture_deps')
        out[name] = e
    if report:
        report(f'{len(infos)} materials, {len(out)} decoded, {len(bad)} errors, {len(mism)} mismatches;'
               f' last end vs stream bits: {end} / {total}')
        for x in (bad + mism)[:20]:
            report(f'   {x}')
    return out


def main():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    from gamefs import open_game
    out = decode_materials(open_game().read('bin/Materials.bin'), print)
    args = sys.argv[1:]
    if '--json' in args:  # --json PATH: write every material
        path = args.pop(args.index('--json') + 1); args.remove('--json')
        json.dump(out, open(path, 'w'), indent=1)
        print('wrote', path)
    want = args
    low = {k.lower(): k for k in out}
    for w in want:
        k = low.get(w.lower())
        print(f'\n=== {w}:', json.dumps(out[k], indent=1) if k else 'NOT FOUND')


if __name__ == '__main__':
    main()
