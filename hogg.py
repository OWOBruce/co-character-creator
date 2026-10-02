"""Minimal reader for Cryptic Engine .hogg archives (version 10/11)."""
import struct
import sys
import threading
import zlib


class Hogg:
    def __init__(self, path):
        self.path = path
        self.f = open(path, 'rb')
        self.lock = threading.Lock()  # raw() may be called from several threads (serve.py)
        hdr = self.f.read(24)
        (magic, self.version, opj_size, fl_size, ea_size,
         self.datalist_fileno, dlj_size) = struct.unpack('<IHHIIII', hdr)
        if magic != 0xDEADF00D:
            raise ValueError('not a hogg file')
        self.f.seek(24 + opj_size + dlj_size)
        fl = self.f.read(fl_size)
        ea = self.f.read(ea_size)
        # file entry: u64 offset, u32 size, u32 timestamp, u32 checksum,
        #             u32 reserved, u16 flags, u16 reserved, i32 ea_index
        self.files = [struct.unpack_from('<QIIIIHHi', fl, i) for i in range(0, fl_size, 32)]
        # ea entry: i32 name_id, i32 header_data_id, u32 unpacked_size (0 = stored), u32 flags
        self.eas = [struct.unpack_from('<iiII', ea, i) for i in range(0, ea_size, 16)]
        self.names = self._read_datalist()

    def raw(self, idx):
        off, size, *_, ea_idx = self.files[idx]
        with self.lock:
            self.f.seek(off)
            data = self.f.read(size)
        unpacked = self.eas[ea_idx][2] if 0 <= ea_idx < len(self.eas) else 0
        if unpacked and unpacked != size:
            data = zlib.decompress(data)
        return data

    def _read_datalist(self):
        data = self.raw(self.datalist_fileno)
        # header: u32 version, u32 count, then [u32 len][bytes] records
        _, count = struct.unpack_from('<II', data, 0)
        pos, out = 8, []
        for _ in range(count):
            (n,) = struct.unpack_from('<I', data, pos)
            pos += 4
            out.append(data[pos:pos + n])
            pos += n
        return out

    def entries(self):
        """Yield (index, name, size, unpacked_size)."""
        for i, (off, size, ts, crc, _, flags, _, ea_idx) in enumerate(self.files):
            if not 0 <= ea_idx < len(self.eas):
                continue
            name_id, _, unpacked, _ = self.eas[ea_idx]
            if name_id < 0 or name_id >= len(self.names) or size == 0 and unpacked == 0:
                continue
            name = self.names[name_id].rstrip(b'\0').decode('utf-8', 'replace')
            yield i, name, size, unpacked

    def read(self, name):
        for i, n, *_ in self.entries():
            if n == name:
                return self.raw(i)
        raise KeyError(name)


if __name__ == '__main__':
    h = Hogg(sys.argv[1])
    for i, name, size, unpacked in h.entries():
        print(f'{size}\t{unpacked}\t{name}')
