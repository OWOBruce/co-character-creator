"""Local server for the costume editor: python serve.py [port] [--game FOLDER] [--open | --browser] [--quit-when-closed]

--open shows the editor in its own window (Edge or Chrome in app mode: no tabs or address bar), or in the
default browser when neither is installed; --browser (which wins over --open) shows it in a normal browser tab. Either way the editor
stays reachable at http://localhost:PORT/ from any browser while the server runs.
--quit-when-closed (the release's CO Costume Editor.exe, app_launcher.py, which has no console to close): stop
once no editor page is open. Pages report in every 15 s and say goodbye when they close (/api/alive, /api/bye).

/            -> viewer/
/assets/...  -> the game's meshes (bin/geobin/**.mset) and textures (dds/**.dds), read straight out of the
                Champions Online install's .hogg archives (a texture is its .wtex with the Cryptic header
                stripped). Nothing is read from anywhere else.
/api/check   -> POST {"costume"}: check a costume JSON (costume_check.py) -> {"doc", "problems"}
/api/test/... -> for tests/run.py and viewer/test.html: the game's saved costumes (Live/screenshots/Costume_*.jpg,
                read only) and the browser tests' results
/api/render/... -> for viewer/render.html (captions.py): which piece sheets exist; POST a rendered sheet (JPEG),
                saved under RENDERS (settings.json rendersFolder; outside the project: bulk images made from game data)
/api/costume/save -> POST ?name=Costume_....jpg with the JPEG as body: write a saved costume into the install's
                Live/screenshots (never overwriting), where the game's tailor looks for them
/api/file/open -> POST {}: a native Open dialog on this machine for Load, starting in the install's Live/screenshots
                (then wherever the last file came from); answers the chosen file's bytes (X-File-Name: its name,
                URL-encoded) or {"cancelled": true}
/api/alive, /api/bye -> POST {"id"}: an editor page is open / has closed (for --quit-when-closed)
/api/settings -> POST {"account"} and/or {"checkUpdates"}: remember the account name for saved costumes, or
                whether to look for new versions, in settings.json
/api/update  -> GET: the newest release on GitHub {"version", "url"}, asked at most once a day, or {"off": true}
                when Settings turns the check off (latest_release)
/api/source  -> GET: the game folder in use, what was found, the saved account and the state of the editor's data (build);
                POST {"path"}: use another folder; POST {"browse": true}: open a folder picker on this
                machine and use what's chosen.

The editor's data (catalogs, stances, interface art) is built from the same archives by build.py: at start
and after a folder change the server checks it against the install (archive sizes and dates) and rebuilds
it in the background when it's missing or the game has been patched; the page waits and shows progress.

The game folder is, in order: --game, the one saved in settings.json (set from the page), or the first
install found (Steam's default folder and other Steam libraries, Arc's default folder); it is picked in the
page's Settings. Any of the install
root, its inner "Champions Online" folder, Live or piggs works.
JSON is gzipped on the fly when the browser accepts it (the skeleton catalogs are ~20 MB raw).
"""
import gzip
import http.server
import json
import os
import re
import subprocess
import sys
import threading
from functools import lru_cache

from gamefs import GameFS, candidates, default_folder, find_piggs, load_settings, renders_folder, save_settings
from paths import INSTALLED, claude_workspace, data

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'viewer')
DATA_ROOT = data('viewer')  # data/ and ui/ (what the build made) are here: the same folder unless installed
ASSET_DIRS = ('bin/geobin/', 'dds/')


class GameSource:
    """One install's archives, answering the viewer's asset paths."""

    def __init__(self, folder):
        self.folder, self.fs, self.error, self.files = folder, None, None, 0
        self.piggs = find_piggs(folder)
        if not self.piggs:
            self.error = 'No Champions Online archives (Live/piggs/*.hogg) in this folder' if folder else 'No game folder set'
            return
        self.fs = GameFS(folder)
        self.files = sum(1 for k in self.fs.index if k.startswith('bin/geobin/') and k.endswith('.mset')
                         or k.startswith('texture_library/') and k.endswith('.wtex'))

    def info(self):
        return {'folder': self.folder, 'piggs': self.piggs, 'ok': bool(self.piggs), 'error': self.error,
                'files': self.files, 'build': dict(BUILD)}

    def read(self, rel):
        """Bytes of an asset path: 'bin/geobin/**.mset' as stored, 'dds/**.dds' = texture_library/**.wtex's DDS."""
        if not self.fs:
            return None
        low = rel.lower()
        if low.startswith('dds/') and low.endswith('.dds'):
            return self.fs.dds('texture_library/' + rel[4:-4] + '.wtex')
        if low.startswith('bin/geobin/') and low.endswith('.mset'):
            return self.fs.read(rel)
        return None


SOURCE = None
SOURCE_LOCK = threading.Lock()
TEST_RESULTS = {}  # the last results viewer/test.html posted (tests/run.py collects them)
RENDERS = renders_folder()  # settings.json rendersFolder, else %LOCALAPPDATA%/CO Costume Editor/renders
RENDER_NAME = re.compile(r'^(Male|Female)/[A-Za-z0-9_.-]+\.jpg$')


def read_asset(rel):
    """SOURCE.read, opening the archives again once if it fails: the game patches its archives while it
    runs (and its launcher between runs), which moves files the index made at start pointed to."""
    global SOURCE
    src = SOURCE
    try:
        return src.read(rel)
    except Exception as e:
        print(f'Reading {rel} failed ({e!r}); opening the game archives again', flush=True)
    with SOURCE_LOCK:
        if SOURCE is src:  # not already reopened by another request
            SOURCE = GameSource(src.folder)
        src = SOURCE
    return src.read(rel)


def screenshots_folder():
    """The chosen install's Live/screenshots, where the game keeps saved costumes (None without a game folder)."""
    return os.path.join(os.path.dirname(SOURCE.piggs), 'screenshots') if SOURCE and SOURCE.piggs else None


# a costume file name as costume-file.js costumeFileName writes it: no path, no characters Windows forbids
COSTUME_NAME = re.compile(r'^Costume_[^\\/:*?"<>|\x00-\x1f]+\.jpg$')


def saved_costumes():
    """{file name: path} of the game's saved costumes (Live/screenshots/Costume_*.jpg) for the chosen install."""
    folder = screenshots_folder()
    if not folder or not os.path.isdir(folder):
        return {}
    return {n: os.path.join(folder, n) for n in sorted(os.listdir(folder))
            if n.startswith('Costume_') and n.lower().endswith('.jpg')}

# ---- the editor's data (build.py), rebuilt when missing or when the game has been patched -----------
BUILD = {'state': 'idle', 'step': '', 'error': None}
BUILD_LOCK = threading.Lock()
BUILD_WANTED = []  # folders waiting for a build check


def ensure_build(folder):
    """Check (and if needed rebuild) the editor's data for folder, in the background."""
    with BUILD_LOCK:
        BUILD_WANTED.append(folder)
        if BUILD['state'] in ('checking', 'building'):
            return  # the running job picks it up when it ends
        BUILD.update(state='checking', step='Checking the game version', error=None)
    threading.Thread(target=_build_loop, daemon=True).start()


def _build_loop():
    while True:
        with BUILD_LOCK:
            if not BUILD_WANTED:
                if BUILD['state'] == 'checking':
                    BUILD['state'] = 'ready'
                return
            folder = BUILD_WANTED.pop()
            BUILD_WANTED.clear()
        try:
            import build
            if build.up_to_date(folder):
                BUILD.update(state='ready', step='', error=None)
                continue
        except Exception as e:  # unreadable install: report it
            BUILD.update(state='error', step='', error=f'{type(e).__name__}: {e}')
            continue
        BUILD.update(state='building', step='Starting', error=None, progress=0.0, started=__import__('time').time())
        print('Building the editor data from', folder, flush=True)
        proc = BUILD_PROC[0] = subprocess.Popen([sys.executable, '-u', os.path.join(HERE, 'build.py'), '--game', folder],
                                                cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                                encoding='utf-8', errors='replace')
        tail = []
        for line in proc.stdout:
            line = line.rstrip()
            if line.startswith('%% '):  # how much is done, 0 to 1 (buildprogress.py)
                try:
                    BUILD['progress'] = max(BUILD.get('progress') or 0.0, float(line[3:]))
                except ValueError:
                    pass
                continue
            tail = (tail + [line])[-12:]
            if line.startswith('## '):
                BUILD['step'] = line[3:]
                print('  ' + line[3:], flush=True)
        if proc.wait() == 0:
            BUILD.update(state='ready', step='', error=None)
            if 'costume_check' in sys.modules:  # it caches the catalogs
                sys.modules['costume_check'].catalog.cache_clear()
                sys.modules['costume_check'].palettes.cache_clear()
            print('Build finished', flush=True)
        else:
            BUILD.update(state='error', step='', error='The build failed:\n' + '\n'.join(tail))
            print('Build failed:\n' + '\n'.join(tail), flush=True)


def use_folder(folder, save=False):
    global SOURCE
    src = GameSource(folder)
    with SOURCE_LOCK:
        SOURCE = src
    if save and src.piggs:
        s = load_settings(); s['gameFolder'] = folder; save_settings(s)
    print(f'Game folder: {folder or "(none)"} -> {src.piggs or src.error}; {src.files} meshes and textures', flush=True)
    if src.piggs:
        ensure_build(folder)
    return src


def picker_owner():
    """An invisible window on top for a native picker to belong to. Windows only lets the program the player is
    using bring a window forward, and that's the browser, so the picker would open behind the editor; a tap of
    Alt (which Windows takes as the player acting) lets this one come to the front."""
    import tkinter
    root = tkinter.Tk()
    root.overrideredirect(True)
    root.attributes('-alpha', 0.0)
    root.attributes('-topmost', True)
    root.geometry('1x1+200+200')
    root.update()
    try:
        import ctypes
        user32 = ctypes.windll.user32
        user32.keybd_event(0x12, 0, 0, 0)  # Alt down, up
        user32.keybd_event(0x12, 0, 2, 0)
        user32.SetForegroundWindow(user32.GetParent(root.winfo_id()) or root.winfo_id())
    except (AttributeError, OSError):
        pass
    root.lift()
    root.focus_force()
    return root


def browse_for_folder(initial):
    """A native folder picker on this machine (the server runs locally). Returns the path or None."""
    from tkinter import filedialog
    root = picker_owner()
    try:
        path = filedialog.askdirectory(parent=root, initialdir=initial or None, mustexist=True,
                                       title='Choose your Champions Online folder')
    finally:
        root.destroy()
    return os.path.normpath(path) if path else None


def browse_for_file(initial):
    """A native Open dialog on this machine for a costume, costume JSON or demo recording. Returns the path or None."""
    from tkinter import filedialog
    root = picker_owner()
    try:
        path = filedialog.askopenfilename(parent=root, initialdir=initial or None, title='Load a costume or demo recording',
                                          filetypes=[('Costumes and demo recordings', '*.jpg *.jpeg *.json *.demo'),
                                                     ('Saved costumes', '*.jpg *.jpeg'), ('Demo recordings', '*.demo'),
                                                     ('Costume JSON', '*.json'), ('All files', '*.*')])
    finally:
        root.destroy()
    return os.path.normpath(path) if path else None


BROWSE_LOCK = threading.Lock()
BUILD_PROC = [None]  # the running build, stopped with the server
PAGES = {}           # open editor pages: id -> when they last reported in (--quit-when-closed)
PAGES_LOCK = threading.Lock()


def quit_when_closed(server):
    """Stop the server once no editor page is open: 10 s after the last one says goodbye (a reload says goodbye
    and reports in again straight away), when none has reported in for 5 minutes (a minimised window's timers
    slow to once a minute; a crashed browser says nothing), or when no page has come at all in 10 minutes."""
    import time
    start, empty_since = time.time(), None
    while True:
        time.sleep(2)
        now = time.time()
        with PAGES_LOCK:
            for k in [k for k, t in PAGES.items() if now - t > 300]:
                del PAGES[k]
            open_pages = len(PAGES)
        if open_pages or (now - start < 600 and not SEEN_PAGE[0]):
            empty_since = None
            continue
        empty_since = empty_since or now
        if now - empty_since >= 10:
            print('No editor window is open: stopping', flush=True)
            if BUILD_PROC[0] and BUILD_PROC[0].poll() is None:
                BUILD_PROC[0].terminate()
            server.shutdown()
            return


SEEN_PAGE = [False]
LAST_OPENED = {}  # the game folder -> the folder Load last picked a file from, so the next Load starts there


@lru_cache(maxsize=64)
def gzipped(path, mtime):
    with open(path, 'rb') as f:
        return gzip.compress(f.read(), 6)


RELEASES = 'https://api.github.com/repos/codexheroes/co-character-creator/releases/latest'
RELEASE_LOCK = threading.Lock()


def latest_release():
    """The newest published release, for the page's "new version" notice: {'version', 'url', 'checked'}.
    GitHub is asked at most once a day; the answer is kept in settings.json (latestRelease), which also
    answers when GitHub can't be reached (then asked again in an hour). {'off': True} when Settings turns
    checking off (checkUpdates false). Nothing about the player or their costumes is sent."""
    import time
    import urllib.request
    if load_settings().get('checkUpdates') is False:
        return {'off': True}
    with RELEASE_LOCK:
        known = load_settings().get('latestRelease') or {}
        if time.time() - known.get('checked', 0) < 86400:
            return known
        try:
            req = urllib.request.Request(RELEASES, headers={'Accept': 'application/vnd.github+json',
                                                            'User-Agent': 'CO-Costume-Editor'})
            rel = json.loads(urllib.request.urlopen(req, timeout=5).read())
            known = {'version': rel['tag_name'].lstrip('vV'), 'url': rel['html_url'], 'checked': time.time()}
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            known = {**known, 'checked': time.time() - 86400 + 3600}
        s = load_settings()
        s['latestRelease'] = known
        save_settings(s)
        return known


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.json': 'application/json', '.mset': 'application/octet-stream',
                      '.dds': 'application/octet-stream'}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def translate_path(self, path):
        if DATA_ROOT != ROOT and path.lstrip('/').split('/', 1)[0] in ('data', 'ui'):
            root, self.directory = self.directory, DATA_ROOT
            try:
                return super().translate_path(path)
            finally:
                self.directory = root
        return super().translate_path(path)

    def send_bytes(self, body, ctype, status=200):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self._body = body

    def send_json(self, obj, status=200):
        self.send_bytes(json.dumps(obj).encode(), 'application/json', status)

    def send_head(self):
        clean = self.path.split('?', 1)[0].split('#', 1)[0]
        if clean == '/api/source':
            settings = load_settings()
            self.send_json({**SOURCE.info(), 'found': candidates(), 'saved': settings.get('gameFolder'),
                            'account': settings.get('account', ''), 'checkUpdates': settings.get('checkUpdates') is not False})
            return None
        if clean == '/api/update':
            self.send_json(latest_release())
            return None
        if clean == '/api/test/costume-files':
            self.send_json(list(saved_costumes()))
            return None
        if clean.startswith('/api/test/costume-file/'):
            path = saved_costumes().get(http.server.urllib.parse.unquote(clean.rsplit('/', 1)[1]))
            if not path:
                self.send_error(404)
                return None
            self.send_bytes(open(path, 'rb').read(), 'image/jpeg')
            return None
        if clean == '/api/test/results':
            self.send_json(TEST_RESULTS)
            return None
        if clean == '/api/render/done':  # the sheets already rendered: ["Male/<geometry>.jpg", ...]
            self.send_json(sorted(f'{sk}/{n}' for sk in ('Male', 'Female') if os.path.isdir(os.path.join(RENDERS, sk))
                                  for n in os.listdir(os.path.join(RENDERS, sk)) if n.endswith('.jpg')))
            return None
        if clean == '/api/test/known':  # accepted exceptions (tests/known.json)
            try:
                self.send_json(json.load(open(os.path.join(HERE, 'tests', 'known.json'), encoding='utf-8')))
            except (OSError, ValueError):
                self.send_json({})
            return None
        if clean.startswith('/assets/'):
            rel = http.server.urllib.parse.unquote(clean[len('/assets/'):])
            if '..' in rel or not rel.startswith(ASSET_DIRS):
                self.send_error(403)
                return None
            try:
                data = read_asset(rel)
            except Exception as e:  # answer with the reason (a dropped connection is all the page would see)
                print(f'Could not read {rel}: {e!r}', flush=True)
                self.send_bytes(f'Could not read {rel} from the game files: {e}'.encode(), 'text/plain', 500)
                return None
            if data is None:
                self.send_error(404)
                return None
            self.send_bytes(data, 'application/octet-stream')
            return None
        path = self.translate_path(self.path)
        if path.endswith('.json') and os.path.isfile(path) and 'gzip' in self.headers.get('Accept-Encoding', ''):
            body = gzipped(path, os.path.getmtime(path))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self._body = body
            return None
        return super().send_head()

    def do_GET(self):
        self._body = None
        f = self.send_head()
        if self._body is not None:
            self.wfile.write(self._body)
        elif f:
            try:
                self.copyfile(f, self.wfile)
            finally:
                f.close()

    def do_POST(self):
        self._body = None
        path = self.path.split('?', 1)[0]
        if path == '/api/render/save':  # ?name=<Male|Female>/<geometry>.jpg, body: the JPEG
            name = http.server.urllib.parse.parse_qs(self.path.split('?', 1)[1] if '?' in self.path else '').get('name', [''])[0]
            origin = self.headers.get('Origin')
            if (not RENDER_NAME.match(name) or self.headers.get('Content-Type') != 'image/jpeg'
                    or (origin and origin != f'http://{self.headers.get("Host")}')):
                self.send_error(403)
                return
            data = self.rfile.read(int(self.headers.get('Content-Length') or 0))
            os.makedirs(os.path.join(RENDERS, name.split('/')[0]), exist_ok=True)
            # write a temporary file and swap it in, so an interrupted save never leaves a broken sheet behind
            dest = os.path.join(RENDERS, *name.split('/'))
            with open(dest + '.part', 'wb') as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(dest + '.part', dest)
            self.send_json({'ok': True, 'bytes': len(data)})
            self.wfile.write(self._body)
            return
        if path == '/api/costume/save':  # ?name=Costume_<account>_<character>_..._<n>.jpg, body: the JPEG
            name = http.server.urllib.parse.parse_qs(self.path.split('?', 1)[1] if '?' in self.path else '').get('name', [''])[0]
            origin = self.headers.get('Origin')
            if (not COSTUME_NAME.match(name) or self.headers.get('Content-Type') != 'image/jpeg'
                    or (origin and origin != f'http://{self.headers.get("Host")}')):
                self.send_error(403)
                return
            data = self.rfile.read(int(self.headers.get('Content-Length') or 0))
            folder = screenshots_folder()
            if not folder:
                self.send_json({'error': 'No game folder set'}, 409)
            else:
                target = os.path.join(folder, name)
                try:
                    os.makedirs(folder, exist_ok=True)
                    with open(target, 'xb') as f:  # never overwrites
                        f.write(data)
                    self.send_json({'ok': True, 'path': target})
                except FileExistsError:
                    self.send_json({'error': f'{name} already exists'}, 409)
                except OSError as e:
                    self.send_json({'error': f'Could not write {target}: {e.strerror or e}'}, 500)
            self.wfile.write(self._body)
            return
        if path not in ('/api/source', '/api/check', '/api/test/results', '/api/settings', '/api/file/open',
                        '/api/alive', '/api/bye'):
            self.send_error(404)
            return
        # only this page may use these: same-origin JSON requests
        origin = self.headers.get('Origin')
        if 'application/json' not in self.headers.get('Content-Type', '') or (
                origin and origin != f'http://{self.headers.get("Host")}'):
            self.send_error(403)
            return
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
        except ValueError:
            self.send_error(400)
            return
        if path == '/api/test/results':
            TEST_RESULTS.clear()
            TEST_RESULTS.update(req)
            self.send_json({'ok': True})
            self.wfile.write(self._body)
            return
        if path in ('/api/alive', '/api/bye'):  # {"id"}: an editor page is open / closing
            import time
            with PAGES_LOCK:
                if path == '/api/alive':
                    PAGES[str(req.get('id'))] = time.time()
                    SEEN_PAGE[0] = True
                else:
                    PAGES.pop(str(req.get('id')), None)
            self.send_json({'ok': True})
            self.wfile.write(self._body)
            return
        if path == '/api/settings':  # {"account"}, {"checkUpdates"}: kept in settings.json, so every browser and window gets them
            s, out = load_settings(), {'ok': True}
            if 'account' in req:
                out['account'] = str(req.get('account') or '').strip().lstrip('@')[:64]
            if 'checkUpdates' in req:
                out['checkUpdates'] = bool(req['checkUpdates'])
            changed = {k: v for k, v in out.items() if k != 'ok' and s.get(k, '' if k == 'account' else True) != v}
            if changed:
                s.update(changed)
                save_settings(s)
            self.send_json(out)
            self.wfile.write(self._body)
            return
        if path == '/api/file/open':  # Load: a native Open dialog, answered with the chosen file
            if not BROWSE_LOCK.acquire(blocking=False):
                self.send_json({'error': 'A file or folder picker is already open'}, 409)
                self.wfile.write(self._body)
                return
            try:
                start = LAST_OPENED.get(SOURCE.folder) or screenshots_folder()
                chosen = browse_for_file(start if start and os.path.isdir(start) else None)
            except Exception as e:  # no display / tkinter missing: the page falls back to the browser's picker
                self.send_json({'error': f'Could not open a file picker: {e}'}, 500)
                self.wfile.write(self._body)
                return
            finally:
                BROWSE_LOCK.release()
            if not chosen:
                self.send_json({'cancelled': True})
            else:
                try:
                    data = open(chosen, 'rb').read()
                    LAST_OPENED[SOURCE.folder] = os.path.dirname(chosen)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/octet-stream')
                    self.send_header('Content-Length', str(len(data)))
                    self.send_header('X-File-Name', http.server.urllib.parse.quote(os.path.basename(chosen)))
                    self.end_headers()
                    self._body = data
                except OSError as e:
                    self.send_json({'error': f'Could not read {chosen}: {e.strerror or e}'}, 500)
            self.wfile.write(self._body)
            return
        if path == '/api/check':  # costume_check.py: {costume} -> {doc, problems}
            import costume_check
            doc, problems = costume_check.check(req.get('costume'))
            self.send_json({'doc': doc, 'problems': problems})
            self.wfile.write(self._body)
            return
        folder = req.get('path')
        if req.get('browse'):
            if not BROWSE_LOCK.acquire(blocking=False):
                self.send_json({'error': 'A folder picker is already open'}, 409)
                self.wfile.write(self._body)
                return
            try:
                # no folder yet: start where games usually are
                start = SOURCE.folder or next((p for p in (r'C:\Program Files (x86)\Steam\steamapps\common',
                                                           r'C:\Program Files (x86)', r'C:\Program Files') if os.path.isdir(p)), None)
                folder = browse_for_folder(start)
            except Exception as e:  # no display / tkinter missing
                folder = None
                self.send_json({'error': f'Could not open a folder picker: {e}'}, 500)
                self.wfile.write(self._body)
                return
            finally:
                BROWSE_LOCK.release()
            if not folder:
                self.send_json({**SOURCE.info(), 'cancelled': True})
                self.wfile.write(self._body)
                return
        if not folder or not find_piggs(folder):
            self.send_json({**SOURCE.info(), 'rejected': folder,
                            'error': (f"That folder doesn't have Champions Online's game files (Live\\piggs) in it: {folder}"
                                      if folder else 'Type or choose a folder first')}, 400)
        else:
            src = use_folder(folder, save=True)
            self.send_json({**src.info(), 'changed': True})
        self.wfile.write(self._body)

    def end_headers(self):
        # the editor's own files change while developing: make browsers revalidate them (304 when
        # unchanged) instead of running stale modules; game assets never change, so they may be cached
        if not self.path.startswith('/assets/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and str(args[1]) not in ('200', '304'):
            super().log_message(fmt, *args)


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128  # the default 5 drops bursts of mesh/texture requests
    # On Windows SO_REUSEADDR lets a second server bind a port that is in use (and quietly get none of its
    # requests); refuse instead, so a second start finds the running editor.
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        import socket
        if os.name == 'nt' and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def app_browser():
    """Edge or Chrome, which can open a page as its own app window (--app); None when neither is found."""
    import shutil
    if sys.platform != 'win32':
        return next(filter(None, map(shutil.which, ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'])), None)
    import winreg
    for exe in ('msedge.exe', 'chrome.exe'):
        for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(root, rf'Software\Microsoft\Windows\CurrentVersion\App Paths\{exe}') as k:
                    path = winreg.QueryValue(k, None)
                if path and os.path.isfile(path.strip('"')):
                    return path.strip('"')
            except OSError:
                pass
    for base in (os.environ.get('ProgramFiles(x86)'), os.environ.get('ProgramFiles'), os.environ.get('LOCALAPPDATA')):
        for rel in (r'Microsoft\Edge\Application\msedge.exe', r'Google\Chrome\Application\chrome.exe'):
            if base and os.path.isfile(os.path.join(base, rel)):
                return os.path.join(base, rel)
    return None


def window_size():
    """1600x1000, shrunk to fit the screen's work area (without the taskbar). This process isn't DPI aware, so
    Windows reports the area scaled to the display's zoom, in the same units the browser's --window-size uses."""
    w, h = 1600, 1000
    if sys.platform == 'win32':
        import ctypes
        from ctypes import wintypes
        area = wintypes.RECT()
        if ctypes.windll.user32.SystemParametersInfoW(0x30, 0, ctypes.byref(area), 0):  # SPI_GETWORKAREA
            w = min(w, area.right - area.left)
            h = min(h, area.bottom - area.top)
    return w, h


def show(url, app):
    """Open the editor: in its own app window when app is set and Edge or Chrome is there, else a browser tab."""
    exe = app and app_browser()
    if exe:
        w, h = window_size()
        try:
            subprocess.Popen([exe, f'--app={url}', f'--window-size={w},{h}'], close_fds=True)
            return
        except OSError:
            pass
    import webbrowser
    webbrowser.open(url)


def main():
    args = sys.argv[1:]
    if INSTALLED:
        try:
            claude_workspace()
        except OSError as e:
            print('Could not set up the Claude Code folder:', e)
    opt = lambda name: args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else None
    # the port: an argument, else the PORT environment variable (preview tools), else 8765
    port = next((int(a) for a in args if a.isdigit()), int(os.environ.get('PORT') or 8765))
    url = f'http://localhost:{port}/'
    # local only: the page can change which folder is read and open a folder picker on this machine
    try:
        server = Server(('127.0.0.1', port), Handler)
    except OSError:
        # the port is taken: if it's the editor already running, just show it
        import urllib.request
        try:
            urllib.request.urlopen(url + 'api/source', timeout=3).read()
        except OSError:
            sys.exit(f'Port {port} is in use by another program. Run with another port, e.g. python serve.py 8766')
        print(f'The editor is already running at {url}')
        if '--open' in args or '--browser' in args:
            show(url, '--browser' not in args)
        return
    import build
    if build.missing_packages():
        print('Warning: missing Python packages ' + ', '.join(build.missing_packages())
              + '; the build will fail. Install them with: python -m pip install -r requirements.txt')
    use_folder(default_folder(opt('--game')))
    print(f'Serving on {url}' + ('  (stops when the last editor window closes)' if '--quit-when-closed' in args
                                  else '  (close this window or press Ctrl+C to stop)'), flush=True)
    if '--quit-when-closed' in args:
        threading.Thread(target=quit_when_closed, args=(server,), daemon=True).start()
    if '--open' in args or '--browser' in args:  # show the editor once the server is listening
        threading.Timer(0.5, show, (url, '--browser' not in args)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
