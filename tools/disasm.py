"""Disassemble a VA range of GameClient.exe: python disasm.py <start_va> <end_va>"""
import struct
import sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from pe import PE

p = PE(r'C:/Program Files (x86)/Steam/steamapps/common/Champions Online/Champions Online/Live/GameClient.exe')


def dis(start, end):
    md = Cs(CS_ARCH_X86, CS_MODE_32)
    o = p.off(start)
    for ins in md.disasm(p.d[o:o + (end - start)], start):
        note = ''
        for tok in ins.op_str.replace(',', ' ').replace('[', ' ').replace(']', ' ').split():
            if tok.startswith('0x') and len(tok) > 6:
                s = p.cstr(int(tok, 16)) if p.off(int(tok, 16)) else None
                if s and len(s) > 3 and s.isprintable():
                    note = f'  ; "{s[:50]}"'
                elif p.off(int(tok, 16)) and ('dword ptr [0x' in ins.op_str or 'qword ptr [0x' in ins.op_str):
                    o = p.off(int(tok, 16))
                    fmt = '<d' if 'qword' in ins.op_str else '<f'
                    note = f'  ; = {struct.unpack_from(fmt, p.d, o)[0]:.6g}'
        print(f'{ins.address:08x}  {ins.mnemonic:6} {ins.op_str}{note}')


if __name__ == '__main__':
    dis(int(sys.argv[1], 16), int(sys.argv[2], 16))


def func_start(va):
    """Walk back from va to the nearest 'int3/nop padding + push ebp; mov ebp, esp' prologue."""
    o = p.off(va)
    while o > 0:
        if p.d[o:o + 3] == b'\x55\x8b\xec' and p.d[o - 1] in (0xcc, 0x90, 0xc3):
            return p.va(o)
        o -= 1
    return None
