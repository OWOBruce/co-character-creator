// Cryptic .mset decoder (port of tools/mset.py; see README "Format notes").
// Works in browsers and Node 18+ (uses DecompressionStream for the zlib streams).

const SLOTS = ['tris', 'positions', 'normals', 'tangents', 'binormals', 'uv0', 'uv1', 'slot7',
               'weights', 'bones', 'positions2', 'normals2'];
const DELTA_SHAPE = { tris: [3, false], positions: [3, true], normals: [3, true], tangents: [3, true],
                      binormals: [3, true], uv0: [2, true], uv1: [2, true], positions2: [3, true], normals2: [3, true] };

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

// City of Heroes-style delta coding: 2-bit codes, then 0/1/2/4-byte deltas. Returns a flat typed array.
function uncompressDeltas(src, stride, count, floats) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let p = (2 * count * stride + 7) >> 3;
  const scale = 2 ** src[p]; p += 1;
  const out = floats ? new Float32Array(count * stride) : new Uint32Array(count * stride);
  const last = new Float64Array(stride);
  let bit = 0, o = 0;
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < stride; j++, o++) {
      const code = (src[bit >> 3] >> (bit & 7)) & 3;
      bit += 2;
      let d;
      if (code === 0) d = 0;
      else if (code === 1) { d = src[p] - 0x7f; p += 1; }
      else if (code === 2) { d = (src[p] | src[p + 1] << 8) - 0x7fff; p += 2; }
      else { d = floats ? dv.getFloat32(p, true) : dv.getInt32(p, true); p += 4; }
      if (floats) last[j] += code === 3 ? d : d / scale;
      else last[j] += d + 1;
      out[o] = last[j];
    }
  }
  if (p !== src.length) throw new Error(`delta stream length mismatch: used ${p} of ${src.length}`);
  return out;
}

class Lod {
  constructor(bytes, base) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const be = i => dv.getInt32(base + 4 * i, false);
    this.dataSize = be(0); this.vertCount = be(1); this.triCount = be(2); this.texCount = be(3);
    this.packs = {};
    SLOTS.forEach((name, k) => {
      const comp = be(8 + 3 * k), unpacked = be(9 + 3 * k), off = be(10 + 3 * k);
      if (comp || unpacked) this.packs[name] = [comp, unpacked, off];
    });
    this.texIdx = [];
    for (let t = 0; t < this.texCount; t++) this.texIdx.push([be(44 + 2 * t), be(45 + 2 * t)]);
    let p = base + this.dataSize;
    const n = dv.getUint16(p, false); p += 2;
    this.texNames = [];
    for (let i = 0; i < n; i++) {
      const len = dv.getUint16(p, false);
      this.texNames.push(String.fromCharCode(...bytes.subarray(p + 2, p + 2 + len)));
      p += 2 + len;
    }
    this.bytes = bytes; this.base = base;
  }

  async stream(name) {
    const pack = this.packs[name];
    if (!pack) return null;
    const [comp, unpacked, off] = pack, start = this.base + off;
    const raw = comp ? await inflate(this.bytes.subarray(start, start + comp))
                     : this.bytes.slice(start, start + Math.abs(unpacked));
    const [stride, floats] = DELTA_SHAPE[name] || [4, false];
    const count = name === 'tris' ? this.triCount : this.vertCount;
    if (unpacked < 0) {
      if (!DELTA_SHAPE[name]) return raw;  // weights / bone indices: 4 x u8 per vertex
      const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + count * stride * 4);
      return floats ? new Float32Array(buf) : new Uint32Array(buf);  // raw little-endian f32 / i32
    }
    return uncompressDeltas(raw, stride, count, floats);
  }

  // -> { positions, normals, uv0, tris (Uint32Array), weights/bones (Uint8Array, 4 per vertex), submeshes }
  async mesh() {
    const names = ['tris', 'positions', 'normals', 'uv0', 'weights', 'bones'];
    const vals = await Promise.all(names.map(n => this.stream(n)));
    const out = Object.fromEntries(names.map((n, i) => [n, vals[i]]));
    if (out.bones) out.bones = out.bones.map(x => x / 3);  // indices are stored x3
    out.vertCount = this.vertCount;
    out.submeshes = this.texIdx.map(([t, n]) => ({ tex: t, name: this.texNames[t] ?? null, tris: n }));
    return out;
  }
}

export class MSet {
  constructor(buffer) {
    const bytes = this.bytes = new Uint8Array(buffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 4;
    this.version = dv.getUint32(p, false); this.crc = dv.getUint32(p + 4, false);
    const count = dv.getUint16(p + 8, false); p += 10;
    this.models = [];
    for (let i = 0; i < count; i++) {
      const len = dv.getUint16(p, false);
      const name = String.fromCharCode(...bytes.subarray(p + 2, p + 2 + len)); p += 2 + len;
      const nlod = dv.getUint16(p, false); p += 2;
      const lods = [];
      for (let j = 0; j < nlod; j++) { lods.push([dv.getUint32(p, false), dv.getUint32(p + 4, false)]); p += 8; }
      p += 12;  // 3 more u32 per model (unused here); without skipping them every model after the first is misread
      this.models.push({ name, lods });
    }
  }

  // The model the geometry def names (case-insensitive), else the first one with geometry.
  modelIndex(hint) {
    let idx = this.models.findIndex(m => m.lods.length);
    if (hint) {
      const h = hint.toLowerCase();
      this.models.forEach((m, i) => { if (m.lods.length && m.name.toLowerCase() === h) idx = i; });
    }
    return Math.max(idx, 0);
  }

  lod(model = 0, lod = 0) { return new Lod(this.bytes, this.models[model].lods[lod][0]); }
}
