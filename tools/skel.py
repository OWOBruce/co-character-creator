"""Parser for Cryptic .skel skeleton files (Champions Online).

Layout (little-endian):
  u32 len, name, NUL
  bones: u32 len, name, NUL, f32 pos[3], f32 quat[4] (x, y, z, w), u8 flags
flags bit0 = another sibling follows in this run, bit1 = this bone has children.
Children are written as one run per parent; parents with children are expanded
LIFO (stack), i.e. the last parent read is expanded first.
"""
import struct


def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def quat_rotate(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    # v' = q * v * q^-1
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty),
            vy + w * ty + (z * tx - x * tz),
            vz + w * tz + (x * ty - y * tx))


class Skeleton:
    def __init__(self, path):
        d = path if isinstance(path, (bytes, bytearray)) else open(path, 'rb').read()
        n = struct.unpack_from('<I', d, 0)[0]
        self.name = d[4:4 + n].decode('latin-1')
        self._d, self._p = d, 4 + n + 1
        self.bones = []  # dicts in file order: name, parent, pos, quat
        self.index = {}
        stack = [None]
        first = True
        while self._p < len(d):
            parent = stack.pop() if not first else None
            first = False
            run = self._read_run(parent)
            stack.extend(b for b in run if self.bones[b]['has_children'])
            if not stack:
                break
        self._world()

    def _read_run(self, parent):
        run = []
        while True:
            d, p = self._d, self._p
            ln = struct.unpack_from('<I', d, p)[0]
            name = d[p + 4:p + 4 + ln].decode('latin-1')
            p += 4 + ln + 1
            v = struct.unpack_from('<7f', d, p)
            flags = d[p + 28]
            self._p = p + 29
            idx = len(self.bones)
            self.bones.append({'name': name, 'parent': parent, 'pos': list(v[:3]), 'quat': list(v[3:]),
                               'has_children': bool(flags & 2)})
            self.index[name.lower()] = idx
            run.append(idx)
            if not flags & 1:
                return run

    def _world(self):
        # parents always precede children in file order
        for b in self.bones:
            if b['parent'] is None:
                b['world_pos'], b['world_quat'] = tuple(b['pos']), tuple(b['quat'])
            else:
                p = self.bones[b['parent']]
                off = quat_rotate(p['world_quat'], b['pos'])
                b['world_pos'] = tuple(a + o for a, o in zip(p['world_pos'], off))
                b['world_quat'] = quat_mul(p['world_quat'], b['quat'])

    def bone(self, name):
        return self.bones[self.index[name.lower()]]
