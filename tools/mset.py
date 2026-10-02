"""Parser for Cryptic .mset model files (Champions Online).

File:
  u32 LE header_size, then big-endian: u32 version, u32 crc, u16 model_count,
  per model: u16 name_len, name, u16 lod_count, lod_count * (u32 offset, u32 size), 3 * u32 (unknown;
             checked on all 22,552 files: the Files1 section always follows the last model's)
  then a textparser "Files1" section (source file list), then the LOD blocks.
LOD block (big-endian, offsets relative to block start):
  u32 data_size, u32 vert_count, u32 tri_count, u32 tex_count, f32, f32, u32, u32,
  12 * (i32 packed_size, i32 unpacked_size, u32 offset)   # unpacked < 0 = raw bytes, else delta-coded
  tex_count * (u32 tex_index, u32 tri_count)
  ...zlib streams...
  at data_size: u16 name_count, name_count * (u16 len, name)   # material slot names
Stream slots: 0 tris, 1 positions, 2 normals, 3 tangents, 4 binormals, 5 uv0, 6 uv1,
              7 ?, 8 bone weights (4 x u8), 9 bone indices (4 x u8, stored x3), 10/11 morph verts/normals.
"""
import struct
import zlib

SLOTS = ['tris', 'positions', 'normals', 'tangents', 'binormals', 'uv0', 'uv1', 'slot7',
         'weights', 'bones', 'positions2', 'normals2']
DELTA_SHAPE = {'tris': (3, False), 'positions': (3, True), 'normals': (3, True), 'tangents': (3, True),
               'binormals': (3, True), 'uv0': (2, True), 'uv1': (2, True), 'positions2': (3, True),
               'normals2': (3, True)}


def uncompress_deltas(src, stride, count, floats):
    """City of Heroes-style delta decoding: 2-bit codes, then 0/1/2/4-byte deltas."""
    nb = (2 * count * stride + 7) // 8
    p = nb
    scale = float(1 << src[p])
    p += 1
    out = []
    last = [0] * stride
    bit = 0
    for _ in range(count):
        row = []
        for j in range(stride):
            code = (src[bit >> 3] >> (bit & 7)) & 3
            bit += 2
            if code == 0:
                dv = 0
            elif code == 1:
                dv = src[p] - 0x7f
                p += 1
            elif code == 2:
                dv = (src[p] | src[p + 1] << 8) - 0x7fff
                p += 2
            else:
                dv = struct.unpack_from('<f' if floats else '<i', src, p)[0]
                p += 4
            if floats:
                last[j] += dv if code == 3 else dv / scale
            else:
                last[j] += dv + 1
            row.append(last[j])
        out.append(row)
    if p != len(src):
        raise ValueError(f'delta stream length mismatch: used {p} of {len(src)}')
    return out


class Lod:
    def __init__(self, d, base):
        be = lambda i: struct.unpack_from('>i', d, base + 4 * i)[0]
        self.data_size, self.vert_count, self.tri_count, self.tex_count = be(0), be(1), be(2), be(3)
        self.floats = struct.unpack_from('>ff', d, base + 16)
        self.packs = {}
        for k, name in enumerate(SLOTS):
            comp, unpacked, off = be(8 + 3 * k), be(9 + 3 * k), be(10 + 3 * k)
            if comp or unpacked:
                self.packs[name] = (comp, unpacked, off)
        self.tex_idx = [(be(44 + 2 * t), be(45 + 2 * t)) for t in range(self.tex_count)]
        p = base + self.data_size
        n = struct.unpack_from('>H', d, p)[0]
        p += 2
        self.tex_names = []
        for _ in range(n):
            ln = struct.unpack_from('>H', d, p)[0]
            self.tex_names.append(d[p + 2:p + 2 + ln].decode('latin-1'))
            p += 2 + ln
        self._d, self._base = d, base

    def stream(self, name):
        if name not in self.packs:
            return None
        comp, unpacked, off = self.packs[name]
        start = self._base + off
        raw = zlib.decompress(self._d[start:start + comp]) if comp else self._d[start:start + abs(unpacked)]
        stride, floats = DELTA_SHAPE.get(name, (4, False))
        count = self.tri_count if name == 'tris' else self.vert_count
        if unpacked < 0:
            if name not in DELTA_SHAPE:
                return raw  # weights / bone indices: 4 x u8 per vertex
            # raw little-endian arrays: f32 for vertex data, i32 for triangles
            vals = struct.unpack_from(f'<{count * stride}{"f" if floats else "i"}', raw)
            return [list(vals[i:i + stride]) for i in range(0, len(vals), stride)]
        return uncompress_deltas(raw, stride, count, floats)

    def mesh(self):
        """Return dict with positions, normals, uvs, triangles, bone weights/indices and per-slot tri ranges."""
        out = {k: self.stream(k) for k in ('tris', 'positions', 'normals', 'tangents', 'binormals', 'uv0', 'uv1')}
        w, b = self.stream('weights'), self.stream('bones')
        if w is not None:
            out['weights'] = [list(w[4 * i:4 * i + 4]) for i in range(self.vert_count)]
        if b is not None:
            out['bones'] = [[x // 3 for x in b[4 * i:4 * i + 4]] for i in range(self.vert_count)]
        out['submeshes'] = [{'tex': t, 'name': self.tex_names[t] if t < len(self.tex_names) else None, 'tris': n}
                            for t, n in self.tex_idx]
        return out


class MSet:
    def __init__(self, path):
        self.d = d = path if isinstance(path, (bytes, bytearray)) else open(path, 'rb').read()
        p = 4
        self.version, self.crc, count = struct.unpack_from('>IIH', d, p)
        p += 10
        self.models = []
        for _ in range(count):
            ln = struct.unpack_from('>H', d, p)[0]
            name = d[p + 2:p + 2 + ln].decode('latin-1')
            p += 2 + ln
            nlod = struct.unpack_from('>H', d, p)[0]
            p += 2
            lods = []
            for _ in range(nlod):
                off, size = struct.unpack_from('>II', d, p)
                p += 8
                lods.append((off, size))
            p += 12  # 3 more u32 per model (unused here); without skipping them every model after the first is misread
            self.models.append({'name': name, 'lods': lods})

    def lod(self, model=0, lod=0):
        return Lod(self.d, self.models[model]['lods'][lod][0])
