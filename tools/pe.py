"""Tiny PE32 helper: file offset <-> VA mapping and string reads."""
import struct


class PE:
    def __init__(self, path):
        self.d = d = open(path, 'rb').read()
        pe = struct.unpack_from('<I', d, 0x3c)[0]
        nsec = struct.unpack_from('<H', d, pe + 6)[0]
        opt = struct.unpack_from('<H', d, pe + 20)[0]
        self.base = struct.unpack_from('<I', d, pe + 24 + 28)[0]
        self.secs = []
        for i in range(nsec):
            o = pe + 24 + opt + i * 40
            name = d[o:o + 8].rstrip(b'\0').decode()
            vsize, va, rsize, raw = struct.unpack_from('<IIII', d, o + 8)
            self.secs.append((name, self.base + va, vsize, raw, rsize))

    def off(self, va):
        for _, sva, vs, raw, rs in self.secs:
            if sva <= va < sva + min(vs, rs):
                return raw + va - sva
        return None

    def va(self, off):
        for _, sva, vs, raw, rs in self.secs:
            if raw <= off < raw + rs:
                return sva + off - raw
        return None

    def u32(self, va):
        o = self.off(va)
        return None if o is None else struct.unpack_from('<I', self.d, o)[0]

    def cstr(self, va):
        o = self.off(va)
        if o is None:
            return None
        e = self.d.find(b'\0', o)
        s = self.d[o:e]
        return s.decode('latin-1') if e - o < 200 else None
