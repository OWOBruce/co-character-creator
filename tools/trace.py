"""Trace field-by-field decoding of one record: python trace.py <bin> <table> <index>"""
import sys

import bindecode as B


def trace(path, table, index):
    s = B.Schema()
    dec = B.Decoder(s)
    orig = dec.field
    depth = [0]

    def traced(r, f):
        p0 = r.p
        depth[0] += 1
        try:
            v = orig(r, f)
        except Exception as e:
            print('  ' * depth[0] + f"{p0:8d} {f['name']} !! {e}  next={r.d[p0:p0 + 24].hex(' ')}")
            raise
        finally:
            depth[0] -= 1
        print('  ' * depth[0] + f"{p0:8d} {f['name']:22} +{r.p - p0:<4} {str(v)[:60]}")
        return v

    dec.field = traced
    d = open(path, 'rb').read()
    r = B.Reader(d)
    B.read_header(r)
    r.u32()
    r.u32()
    for i in range(index + 1):
        sz = r.u32()
        st = r.p
        if i == index:
            print('record size', sz, 'start', st)
            try:
                dec.struct_body(r, s.table(table), st + sz)
            except Exception as e:
                print('ERR', e)
        r.p = st + sz


if __name__ == '__main__':
    trace(sys.argv[1], sys.argv[2], int(sys.argv[3]))
