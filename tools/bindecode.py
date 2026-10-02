"""Decode Cryptic textparser .bin files using the ParseTables recovered into catalog/schema.json.

File layout:
  "CrypticS" u32 crc, str "ParseM", str "Files1" u32 size, [file list], str "Files1"...,
  str "Depen1" u32 size [...], u32 data_size, u32 count, count * (u32 size, fields...)
"""
import json
import os
import struct

TOK_IGNORE, TOK_START, TOK_END, TOK_U8, TOK_I16, TOK_INT, TOK_INT64, TOK_F32, TOK_STRING, \
    TOK_CURRENTFILE, TOK_TIMESTAMP, TOK_LINENUM, TOK_12, TOK_13, TOK_BOOLFLAG, TOK_QUATPYR, \
    TOK_MATPYR, TOK_FILENAME, TOK_REFERENCE, TOK_FUNCTIONCALL, TOK_STRUCT, TOK_POLYMORPH, \
    TOK_STASHTABLE, TOK_BIT, TOK_MULTIVAL, TOK_COMMAND = range(26)

F_POOLED = 0x00010000
F_EARRAY = 0x00040000
F_FIXED = 0x00080000
F_INDIRECT = 0x00100000
F_REDUNDANT = 0x00400000
F_DEPRECATED = 0x20000000
HI_NO_BIN = 0x400  # second type word: field stripped from some (client) .bin files

SIMPLE = {TOK_U8: ('B', 1), TOK_I16: ('h', 2), TOK_INT: ('i', 4), TOK_INT64: ('q', 8),
          TOK_F32: ('f', 4), TOK_CURRENTFILE: ('I', 4), TOK_TIMESTAMP: ('I', 4),
          TOK_LINENUM: ('I', 4), TOK_BOOLFLAG: ('B', 1), TOK_BIT: ('I', 4)}
FIXED_WIDTH = {TOK_QUATPYR: 3, TOK_MATPYR: 3}

HERE = os.path.dirname(os.path.abspath(__file__))


class Schema:
    def __init__(self, path=os.path.join(HERE, '..', 'catalog', 'schema.json')):
        self.tables = json.load(open(path))
        self.by_name = {}
        for va, t in self.tables.items():
            self.by_name.setdefault(t['name'], va)
        # Subtable pointers filled in at runtime by the engine; patch them by name.
        expr = self.by_name['Expression']
        for t in self.tables.values():
            for f in t['fields']:
                if f['tok'] == TOK_STRUCT and not f['sub'] and f['name'].lower().startswith('expr'):
                    f['sub'] = int(expr, 16)

    def table(self, key):
        if isinstance(key, int):
            key = hex(key)
        if key in self.tables:
            return self.tables[key]
        return self.tables[self.by_name[key]]


class DecodeError(Exception):
    pass


class Reader:
    def __init__(self, data, pos=0):
        self.d = data
        self.p = pos

    def u16(self):
        v = struct.unpack_from('<H', self.d, self.p)[0]
        self.p += 2
        return v

    def u32(self):
        v = struct.unpack_from('<I', self.d, self.p)[0]
        self.p += 4
        return v

    def unpack(self, fmt, n):
        v = struct.unpack_from('<' + fmt, self.d, self.p)[0]
        self.p += n
        return v

    def string(self):
        n = self.u16()
        s = self.d[self.p:self.p + n]
        self.p += (n + 2 + 3) // 4 * 4 - 2
        return s.decode('utf-8', 'replace')


def read_header(r):
    """Skip the CrypticS header; return list of source files."""
    if r.d[:8] != b'CrypticS':
        raise DecodeError('bad magic')
    r.p = 12
    files = []
    while True:
        tag = r.string()
        if tag == 'ParseM':
            continue
        size = r.u32()
        end = r.p + size
        if tag == 'Files1' and size > 4:
            count = r.u32()
            for _ in range(count):
                files.append(r.string())
                r.u32()  # timestamp
        r.p = end
        if tag == 'Depen1':
            return files


class Decoder:
    def __init__(self, schema, skip_hi=HI_NO_BIN, skip_flags=0):
        """skip_hi / skip_flags: fields with these bits are absent from the file. Client-stripped
        bins (messages, costumes) omit hi & 0x400; others (e.g. DynMove) keep them."""
        self.s = schema
        self.files = []
        self.skip_hi, self.skip_flags = skip_hi, skip_flags

    def fields(self, table):
        for f in table['fields']:
            if f['tok'] in (TOK_IGNORE, TOK_START, TOK_END, TOK_COMMAND):
                continue
            if f['flags'] & (F_REDUNDANT | F_DEPRECATED):
                continue
            if f['hi'] & self.skip_hi or f['flags'] & self.skip_flags:
                continue
            yield f

    def struct_body(self, r, table, end):
        out = {}
        for f in self.fields(table):
            out[f['name']] = self.field(r, f)
        if r.p != end:
            raise DecodeError(f"{table['name']}: consumed {r.p - (end - 0)} vs size (at {r.p}, end {end})")
        return out

    def sized_struct(self, r, table):
        size = r.u32()
        start = r.p
        return self.struct_body(r, table, start + size)

    def one(self, r, f):
        tok = f['tok']
        if tok == TOK_CURRENTFILE:
            # index into the header file list; 0 and 1 are reserved
            i = r.u32()
            return self.files[i - 2] if 2 <= i < len(self.files) + 2 else i
        if tok in SIMPLE:
            fmt, n = SIMPLE[tok]
            return r.unpack(fmt, n)
        if tok in FIXED_WIDTH:
            # a QUATPYR is written as pitch/yaw/roll in text but as a quaternion (param 4) in bins
            n = 4 if tok == TOK_QUATPYR and f['param'] == 4 else FIXED_WIDTH[tok]
            return [r.unpack('f', 4) for _ in range(n)]
        if tok in (TOK_STRING, TOK_REFERENCE, TOK_FILENAME):
            return r.string()
        if tok == TOK_STRUCT:
            sub = self.s.table(f['sub'])
            if f['flags'] & F_INDIRECT and not f['flags'] & F_EARRAY:
                if r.u32() == 0:  # presence flag
                    return None
            return self.sized_struct(r, sub)
        if tok == TOK_MULTIVAL:
            t = r.u32()
            return {'type': t, 'raw': r.unpack('I', 4)}
        raise DecodeError(f"unsupported token {tok} ({f['name']})")

    def field(self, r, f):
        if f['flags'] & F_EARRAY:
            n = r.u32()
            return [self.one(r, f) for _ in range(n)]
        if f['flags'] & F_FIXED and f['tok'] not in (TOK_STRING,) and f['tok'] not in FIXED_WIDTH:
            return [self.one(r, f) for _ in range(f['param'])]
        return self.one(r, f)

    def decode_file(self, data, table_name):
        r = Reader(data)
        files = self.files = read_header(r)
        table = self.s.table(table_name)
        size = r.u32()
        count = r.u32()
        records, errors = [], []
        for i in range(count):
            rsize = r.u32()
            start = r.p
            try:
                rec = self.struct_body(r, table, start + rsize)
                records.append(rec)
            except (DecodeError, struct.error) as e:
                errors.append((i, str(e)))
            r.p = start + rsize
        return {'files': files, 'records': records, 'errors': errors}
