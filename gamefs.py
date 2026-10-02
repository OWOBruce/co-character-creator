"""Champions Online game files, read straight out of an install's .hogg archives.

    fs = open_game()            # the install from settings.json, else the first one found
    fs.read('bin/SkelInfos.bin')          # bytes (paths are case-insensitive), or None
    fs.names('animation_library/', '.atrk')

Which install: open_game(folder), else settings.json's gameFolder (set in the editor's Settings), else the
first install found: Steam's default folder, other Steam libraries (libraryfolders.vdf), Arc's default
folder. Any of the install root, its inner "Champions Online" folder, Live or piggs works.
"""
import json
import os
import re
import struct

from hogg import Hogg

HERE = os.path.dirname(os.path.abspath(__file__))
from paths import data  # noqa: E402

SETTINGS = data('settings.json')
STEAM_ROOTS = [r'C:\Program Files (x86)\Steam', r'C:\Program Files\Steam']
OTHER_INSTALLS = [r'C:\Program Files (x86)\Arc Games\Champions Online', r'C:\Program Files\Arc Games\Champions Online',
                  r'C:\Program Files (x86)\Cryptic Studios\Champions Online']
BAD = re.compile(r'[<>:"|?*\x00-\x1f]')  # characters that can't be in Windows file names (old extractions replaced them)


def find_piggs(folder):
    """The piggs folder (with the .hogg archives) under a folder, or None."""
    if not folder:
        return None
    folder = os.path.abspath(os.path.expanduser(folder.strip().strip('"')))
    for sub in ('', 'piggs', os.path.join('Live', 'piggs'), os.path.join('Champions Online', 'Live', 'piggs')):
        p = os.path.join(folder, sub)
        if os.path.isfile(os.path.join(p, 'character.hogg')):
            return p
    return None


def steam_libraries():
    libs = []
    for root in STEAM_ROOTS:
        vdf = os.path.join(root, 'steamapps', 'libraryfolders.vdf')
        libs.append(root)
        if os.path.isfile(vdf):
            text = open(vdf, encoding='utf-8', errors='replace').read()
            libs += [p.replace('\\\\', '\\') for p in re.findall(r'"path"\s+"([^"]+)"', text)]
    return list(dict.fromkeys(libs))


def candidates():
    """Installs found on this machine."""
    found = [os.path.join(lib, 'steamapps', 'common', 'Champions Online') for lib in steam_libraries()] + OTHER_INSTALLS
    return [c for c in dict.fromkeys(found) if find_piggs(c)]


def load_settings():
    try:
        return json.load(open(SETTINGS, encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def save_settings(s):
    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    json.dump(s, open(SETTINGS, 'w', encoding='utf-8'), indent=2)


def renders_folder():
    """Where piece sheets for the descriptions go (captions.py, viewer/render.html): settings.json's rendersFolder,
    else %LOCALAPPDATA%/CO Costume Editor/renders. Kept out of the project: bulk images made from game data."""
    return load_settings().get('rendersFolder') or os.path.join(
        os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'CO Costume Editor', 'renders')


def default_folder(folder=None):
    """The install to use: folder, else the saved one, else the first found (may be None)."""
    for f in (folder, load_settings().get('gameFolder')):
        if find_piggs(f):
            return f
    found = candidates()
    return found[0] if found else folder


class GameFS:
    """Every file of an install's .hogg archives, by lower-case path."""

    def __init__(self, folder):
        self.folder = folder
        self.piggs = find_piggs(folder)
        if not self.piggs:
            raise FileNotFoundError(f'No Champions Online archives (Live/piggs/*.hogg) in {folder or "(no folder)"}')
        self.index, self.hoggs = {}, {}
        for fn in sorted(os.listdir(self.piggs)):
            if not fn.lower().endswith('.hogg'):
                continue
            try:
                h = Hogg(os.path.join(self.piggs, fn))
            except (OSError, ValueError, struct.error):
                continue
            self.hoggs[fn] = h
            for i, name, *_ in h.entries():
                self.index.setdefault(BAD.sub('_', name).lower(), (fn, i, name))

    @property
    def exe(self):
        """The game client (Live/GameClient.exe), whose parse tables tools/dump_schema.py reads, or None."""
        p = os.path.join(os.path.dirname(self.piggs), 'GameClient.exe')
        return p if os.path.isfile(p) else None

    def stamp(self):
        """Changes whenever the game is patched: the archives' and the client's sizes and modification times."""
        files = sorted((fn, h.path) for fn, h in self.hoggs.items()) + ([('GameClient.exe', self.exe)] if self.exe else [])
        return [[fn, os.path.getsize(p), int(os.path.getmtime(p))] for fn, p in files]

    def exists(self, path):
        return path.replace('\\', '/').lower() in self.index

    def real_name(self, path):
        hit = self.index.get(path.replace('\\', '/').lower())
        return hit[2] if hit else None

    def read(self, path):
        hit = self.index.get(path.replace('\\', '/').lower())
        return self.hoggs[hit[0]].raw(hit[1]) if hit else None

    def names(self, prefix='', ext=''):
        """Stored names (original case) under a folder prefix with an extension."""
        prefix, ext = prefix.lower(), ext.lower()
        return [n for k, (_, _, n) in self.index.items() if k.startswith(prefix) and k.endswith(ext)]

    def dds(self, wtex_path):
        """A texture's DDS file: its .wtex without the Cryptic header (u32 header size, header, DDS)."""
        data = self.read(wtex_path)
        if data is None:
            return None
        start = struct.unpack_from('<I', data)[0] if len(data) >= 4 else 0
        if data[start:start + 4] != b'DDS ':
            start = data.find(b'DDS ')
        return data[start:] if start >= 0 else None


_open = {}


def open_game(folder=None):
    """GameFS for folder (else the saved / detected install), shared per folder."""
    folder = default_folder(folder)
    if folder not in _open:
        _open[folder] = GameFS(folder)
    return _open[folder]
