"""Parser for Cryptic .atrk animation tracks (Champions Online), version 200.

Layout (little-endian):
  u32 0xFFFFFFFF, u32 version (200), u32 len, name, NUL, u32 ?, u32 bone_count
  per bone: u32 len, name, NUL, u16 const_mask, u16 anim_mask,
            per const bit (ascending): f32 value
            per anim bit (ascending): f32 base, f32 scale, u32 zlib_size, zlib data
  u32 frame_count
Channel bits: 0-2 rotation (Euler radians), 3-5 translation, 6-8 scale.

Decoding follows GameClient.exe (dynAnimTrack.c / utils/wavelet.c):
  * an animated channel holds 2*nextpow2(frames) u16 values; q == 0 -> 0.0,
    otherwise base + (q - 1) * scale
  * those coefficients go through one level of inverse CDF 9/7 lifting
    (first half = approximation, second half = detail); the first `frames`
    samples are the per-frame values
  * rotation channels (x, y, z) become a quaternion with euler_to_quat()
"""
import math
import struct
import zlib

# CDF 9/7 lifting constants as stored in the exe
ALPHA, BETA, GAMMA, DELTA = 1.5861343, 0.052980118, 0.8829111, 0.44350687
SCALE_EVEN, SCALE_ODD = 0.86986446, 1.1496044


def inverse_wavelet(coeffs):
    """Single-level inverse CDF 9/7 (port of the routine at 0x18e75d0)."""
    n = len(coeffs)
    h = n // 2
    x = [0.0] * n
    for i in range(h):
        x[2 * i] = coeffs[i]
        x[2 * i + 1] = coeffs[h + i]
    for i in range(n):
        x[i] *= SCALE_ODD if i & 1 else SCALE_EVEN
    for i in range(2, n, 2):
        x[i] -= DELTA * (x[i - 1] + x[i + 1])
    x[0] -= 2 * DELTA * x[1]
    for i in range(1, n - 2, 2):
        x[i] -= GAMMA * (x[i - 1] + x[i + 1])
    x[n - 1] -= 2 * GAMMA * x[n - 2]
    for i in range(2, n, 2):
        x[i] += BETA * (x[i - 1] + x[i + 1])
    x[0] += 2 * BETA * x[1]
    for i in range(1, n - 2, 2):
        x[i] += ALPHA * (x[i - 1] + x[i + 1])
    x[n - 1] += 2 * ALPHA * x[n - 2]
    return x


def euler_to_quat(x, y, z):
    """Port of the engine's rotation conversion (0x15c9a60): returns (qx, qy, qz, qw)."""
    ca, sa = math.cos(x * 0.5), math.sin(x * 0.5)
    cb, sb = math.cos(-y * 0.5), math.sin(-y * 0.5)
    cc, sc = math.cos(z * 0.5), math.sin(z * 0.5)
    return (sa * cb * cc + ca * sb * sc,
            ca * sb * cc + sa * cb * sc,
            ca * cb * sc - sa * sb * cc,
            ca * cb * cc - sa * sb * sc)


def slerp(a, b, t):
    dot = sum(x * y for x, y in zip(a, b))
    if dot < 0:
        b, dot = [-x for x in b], -dot
    if dot > 0.9995:
        q = [x + (y - x) * t for x, y in zip(a, b)]
    else:
        th = math.acos(dot)
        s0, s1 = math.sin((1 - t) * th) / math.sin(th), math.sin(t * th) / math.sin(th)
        q = [s0 * x + s1 * y for x, y in zip(a, b)]
    n = math.sqrt(sum(x * x for x in q))
    return [x / n for x in q]


def sample_keys(keys, frames, interp):
    """keys: sorted [(frame, value)] -> per-frame values, held before the first / after the last key."""
    out, k = [], 0
    for f in range(frames):
        while k + 1 < len(keys) and keys[k + 1][0] <= f:
            k += 1
        f0, v0 = keys[k]
        if f <= f0 or k + 1 >= len(keys):
            out.append(list(v0))
        else:
            f1, v1 = keys[k + 1]
            out.append(interp(v0, v1, (f - f0) / (f1 - f0)))
    return out


def lerp(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


class Track:
    """Decoded animation: self.bones[name] = {'quat': [q per frame] | None, 'pos': [..] | None,
    'scale': [..] | None}; quaternions are (x, y, z, w) in engine convention (see frame())."""

    def __init__(self, path):
        d = path if isinstance(path, (bytes, bytearray)) else open(path, 'rb').read()
        first = struct.unpack_from('<i', d, 0)[0]
        if first == -1:
            self.version, nl = struct.unpack_from('<II', d, 4)
            p = 12
        else:  # very old files: no version, first u32 is the name length
            self.version, nl, p = 0, first, 4
        self.name = d[p:p + nl].decode('latin-1')
        p += nl + 1
        self.compressed = 0
        if self.version >= 200:
            self.compressed = struct.unpack_from('<I', d, p)[0]
            p += 4
        nb = struct.unpack_from('<I', d, p)[0]
        p += 4
        if self.compressed:
            p = self._read_compressed(d, p, nb)
        else:
            p = self._read_keys(d, p, nb)
        self.frames = struct.unpack_from('<I', d, p)[0]
        self._finish()

    def _read_compressed(self, d, p, nb):
        self._raw = []
        for _ in range(nb):
            ln = struct.unpack_from('<I', d, p)[0]
            name = d[p + 4:p + 4 + ln].decode('latin-1')
            p += 4 + ln + 1
            cm, am = struct.unpack_from('<HH', d, p)
            p += 4
            anim, const = {}, {}
            for b in range(16):
                if cm >> b & 1:
                    const[b] = struct.unpack_from('<f', d, p)[0]
                    p += 4
            for b in range(16):
                if am >> b & 1:
                    base, scale, zs = struct.unpack_from('<ffI', d, p)
                    p += 12
                    anim[b] = (base, scale, zlib.decompress(d[p:p + zs]))
                    p += zs
            self._raw.append((name, anim, const))
        return p

    def _read_keys(self, d, p, nb):
        """Uncompressed format (port of the reader at 0x15c8fb0)."""
        if self.version >= 160:
            p += 4  # data size
        self._keys = []
        for _ in range(nb):
            ln = struct.unpack_from('<I', d, p)[0]
            name = d[p + 4:p + 4 + ln].decode('latin-1')
            p += 4 + ln + 1
            npos, nrot = struct.unpack_from('<II', d, p)
            p += 8
            nsc = 0
            if self.version > 0:
                nsc = struct.unpack_from('<I', d, p)[0]
                p += 4
            keys = {}
            for kind, cnt, nv in (('pos', npos, 3), ('quat', nrot, 4), ('scale', nsc, 3)):
                lst = []
                for _ in range(cnt):
                    fr = struct.unpack_from('<I', d, p)[0]
                    lst.append((fr, struct.unpack_from(f'<{nv}f', d, p + 4)))
                    p += 4 + 4 * nv
                keys[kind] = sorted(lst)
            self._keys.append((name, keys))
        return p

    def _finish(self):
        n = self.frames
        self.bones = {}
        if self.compressed:
            for name, anim, const in self._raw:
                ch = {b: [v] * n for b, v in const.items()}
                for b, (base, scale, raw) in anim.items():
                    q = struct.unpack_from(f'<{len(raw) // 2}H', raw)
                    ch[b] = inverse_wavelet([0.0 if v == 0 else base + (v - 1) * scale for v in q])[:n]
                grp = lambda bits, dflt: [[ch[b][f] if b in ch else dflt for b in bits] for f in range(n)]                     if any(b in ch for b in bits) else None
                rot = grp(range(0, 3), 0.0)
                self.bones[name] = {'quat': [euler_to_quat(*r) for r in rot] if rot else None,
                                    'pos': grp(range(3, 6), 0.0), 'scale': grp(range(6, 9), 1.0)}
        else:
            for name, keys in self._keys:
                self.bones[name] = {
                    'quat': sample_keys(keys['quat'], n, slerp) if keys['quat'] else None,
                    'pos': sample_keys(keys['pos'], n, lerp) if keys['pos'] else None,
                    'scale': sample_keys(keys['scale'], n, lerp) if keys['scale'] else None}

    def frame(self, f):
        """{bone: {'quat', 'pos'}} at frame f. Quaternions are as the engine stores them; the
        engine's matrices apply their conjugate, so renderers should use conj(q)."""
        return {name: {'quat': b['quat'][f] if b['quat'] else None, 'pos': b['pos'][f] if b['pos'] else None,
                       'scale': b['scale'][f] if b['scale'] else None}
                for name, b in self.bones.items()}
