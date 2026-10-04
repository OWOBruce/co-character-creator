"""Make a release: python make_release.py [--installer | --source-only | --version]
  -> dist/CO-Costume-Editor-<version>.zip, and with --installer dist/CO-Costume-Editor-<version>-Setup.exe

The version comes from viewer/js/version.js (the one place it is set). --version just prints it.
--installer also compiles installer/setup.iss with Inno Setup 6 (ISCC.exe, on PATH or in its usual install
folders; winget install JRSoftware.InnoSetup). Pushing a tag v<version> to GitHub does all of this on a
Windows runner and publishes a release (.github/workflows/release.yml), so a local build is only for testing.

The zip and the installer hold the editor's source and, in python/, the Python that runs it, so players need
nothing installed: python.org's embeddable package (PYTHON, checked against the SHA-256 python.org lists) with
Pillow and numpy added, and tkinter (the folder and file pickers), which the package leaves out, copied from the
Python running this script. So making it needs that same Python version (3.14). The installer's shortcuts run
python\\pythonw.exe app_launcher.py (no console; it quits when its window closes), and start.bat uses
python\\ when it's there. Every program in there is Python's own, signed by the Python Software Foundation; the
unsigned PyInstaller program the releases used to have drew antivirus guesses (Trojan:Win32/Wacatac!ml).
--source-only leaves Python out (the old, small zip; needs Python installed). The working files go to
%LOCALAPPDATA%/CO Costume Editor/release-build, outside the project.

Also in: the piece descriptions (captions/captions.json) and, for AI assistants, the build-costume skill and
.claude/launch.json. Left out: your own costumes (my_costumes/), .claude/settings.local.json, captions/batches.json.
Nothing made from the game is included: catalog/ (with schema.json), viewer/data/, viewer/ui/ and index/ are
built on each person's machine from their own install on first start. settings.json (this machine's game
folder and account) stays out too.
"""
import ast
import glob
import os
import shutil
import subprocess
import sys
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ['README.md', 'LICENSE', 'DEVELOPER.md', 'start.bat', 'requirements.txt', 'index_guide.md', 'app_launcher.py', 'app.ico', 'buildprogress.py',
         'serve.py', 'paths.py', 'build.py', 'build_catalog.py', 'build_web.py', 'build_ui.py', 'build_index.py',
         'rig_data.py', 'costume_check.py', 'gamefs.py', 'gamedata.py', 'hogg.py', 'make_release.py',
         'viewer/index.html', 'viewer/test.html', 'viewer/render.html', 'captions.py', 'describe.py', 'captions/TAGS.md',
         # what each piece looks like (the captioning pass; build_index.py folds it into the costume index)
         'captions/captions.json',
         # for AI assistants (Claude Code): the costume-building skill, and how to start the editor in its browser pane
         '.claude/skills/build-costume/SKILL.md', '.claude/skills/build-costume/costume_to_json.py', '.claude/launch.json',
         'tests/known.json', 'tests/mset_parity.mjs', 'installer/setup.iss']
FOLDERS = [('tools', '.py'), ('viewer/js', '.js'), ('viewer/img', '.svg'), ('examples', '.json'), ('tests', '.py')]
GENERATED = ['catalog', 'index', 'viewer/data', 'viewer/ui', 'settings.json']


def files():
    out = list(FILES)
    for folder, ext in FOLDERS:
        out += sorted(f'{folder}/{n}' for n in os.listdir(os.path.join(HERE, folder)) if n.endswith(ext))
    missing = [f for f in out if not os.path.isfile(os.path.join(HERE, f))]
    if missing:
        sys.exit('Missing: ' + ', '.join(missing))
    assert not any(f == g or f.startswith(g + '/') for f in out for g in GENERATED)
    return out


APP_NAME = 'CO Costume Editor'
# python.org's embeddable Python and the SHA-256 python.org lists for it. The release workflow's setup-python
# must be this same version: tkinter is copied from it.
PYTHON = '3.14.8'
PYTHON_URL = f'https://www.python.org/ftp/python/{PYTHON}/python-{PYTHON}-embed-amd64.zip'
PYTHON_SHA256 = 'a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310'
# imported only by developer tools (describe.py's captioning, tools/disasm.py): not in the bundled Python
DEV_ONLY = {'anthropic', 'capstone'}
WORK = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'CO Costume Editor', 'release-build')


def imported_modules(paths):
    """The top-level modules the editor's scripts import (at the top or inside functions), except the editor's
    own and the developer tools': the bundled Python must have every one."""
    own = {os.path.splitext(os.path.basename(p))[0] for p in paths}
    found = set()
    for p in paths:
        for node in ast.walk(ast.parse(open(os.path.join(HERE, p), encoding='utf-8').read())):
            if isinstance(node, ast.Import):
                found.update(a.name.split('.')[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                found.add(node.module.split('.')[0])
    return sorted(found - own - DEV_ONLY)


def sha256(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def build_runtime():
    """WORK/runtime/python/: the embeddable Python with Pillow, numpy and tkinter, and the editor's folders on its
    path. Returns WORK/runtime, whose python/ goes beside the editor's files."""
    want = PYTHON.rsplit('.', 1)[0]
    if '%d.%d' % sys.version_info[:2] != want:
        sys.exit(f'Making the program needs Python {want} (tkinter is copied from the Python running this); this is '
                 f'{sys.version.split()[0]}.\n(Or python make_release.py --source-only for a zip without it.)')
    zipped = os.path.join(WORK, os.path.basename(PYTHON_URL))  # kept between builds
    if not os.path.isfile(zipped) or sha256(zipped) != PYTHON_SHA256:
        import urllib.request
        print(f'Downloading Python {PYTHON}...', flush=True)
        os.makedirs(WORK, exist_ok=True)
        urllib.request.urlretrieve(PYTHON_URL, zipped)
        if sha256(zipped) != PYTHON_SHA256:
            sys.exit(f"{PYTHON_URL} isn't the file python.org published (its SHA-256 differs)")
    runtime = os.path.join(WORK, 'runtime')
    shutil.rmtree(runtime, ignore_errors=True)
    py = os.path.join(runtime, 'python')
    with zipfile.ZipFile(zipped) as z:
        z.extractall(py)
    site = os.path.join(py, 'Lib', 'site-packages')
    print('Adding Pillow and numpy...', flush=True)
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', '--only-binary=:all:',
                    '--target', site, '-r', os.path.join(HERE, 'requirements.txt')], check=True)
    # tkinter, which the embeddable package leaves out: its module, its DLLs and Tcl/Tk's library, from this Python
    base = sys.base_prefix
    dlls = [p for p in glob.glob(os.path.join(base, 'DLLs', '*'))
            if re.fullmatch(r'_tkinter\.pyd|(tcl|tk|zlib|libtommath).*\.dll', os.path.basename(p), re.I)]
    if not any(p.lower().endswith('_tkinter.pyd') for p in dlls):
        sys.exit(f'This Python ({base}) has no tkinter to copy')
    for p in dlls:
        if not os.path.exists(os.path.join(py, os.path.basename(p))):
            shutil.copy2(p, py)
    skip = shutil.ignore_patterns('__pycache__', 'demos')
    shutil.copytree(os.path.join(base, 'Lib', 'tkinter'), os.path.join(site, 'tkinter'), ignore=skip)
    if os.path.isdir(os.path.join(base, 'tcl')):
        shutil.copytree(os.path.join(base, 'tcl'), os.path.join(py, 'tcl'), ignore=skip)
    # The path: Python's own library, the packages, and the editor's folder and tools/ (python/ sits in the
    # editor's folder), since an embeddable Python doesn't add a script's own folder. No "import site", so
    # nothing from the player's own Python installs gets in.
    stdlib = os.path.basename(glob.glob(os.path.join(py, 'python*.zip'))[0])
    with open(glob.glob(os.path.join(py, 'python*._pth'))[0], 'w', encoding='utf-8') as f:
        f.write(f'{stdlib}\n.\nLib/site-packages\n..\n../tools\n')
    # it has every module the editor's scripts import, and tkinter starts
    check = ('import importlib.util, sys, tkinter\n'
             'missing = [m for m in sys.argv[1:] if importlib.util.find_spec(m) is None]\n'
             'if missing: sys.exit("The bundled Python lacks " + ", ".join(missing))\n'
             'root = tkinter.Tk(); root.withdraw(); root.destroy()\n')
    subprocess.run([os.path.join(py, 'python.exe'), '-c', check] + imported_modules([f for f in files() if f.endswith('.py')]),
                   check=True)
    return runtime


def version():
    text = open(os.path.join(HERE, 'viewer', 'js', 'version.js'), encoding='utf-8').read()
    return re.search(r"VERSION = '([^']+)'", text).group(1)


def find_iscc():
    """Inno Setup 6's compiler: on PATH, or where its installer (or winget, per user) puts it."""
    found = shutil.which('ISCC') or shutil.which('iscc')
    if found:
        return found
    for base in (os.environ.get('ProgramFiles(x86)'), os.environ.get('ProgramFiles'),
                 os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs')):
        if base and os.path.isfile(os.path.join(base, 'Inno Setup 6', 'ISCC.exe')):
            return os.path.join(base, 'Inno Setup 6', 'ISCC.exe')
    sys.exit('The installer needs Inno Setup 6: winget install JRSoftware.InnoSetup (or jrsoftware.org/isdl.php)')


def stage(runtime):
    """Copy the editor's files, and Python beside them, into WORK/stage: what the zip and installer hold."""
    out = os.path.join(WORK, 'stage')
    shutil.rmtree(out, ignore_errors=True)
    for f in files():
        os.makedirs(os.path.dirname(os.path.join(out, f)), exist_ok=True)
        shutil.copy2(os.path.join(HERE, f), os.path.join(out, f))
    if runtime:  # python/
        shutil.copytree(runtime, out, dirs_exist_ok=True)
    return out


def main():
    args = sys.argv[1:]
    if '--version' in args:
        print(version())
        return
    source_only, installer = '--source-only' in args, '--installer' in args
    if source_only and installer:
        sys.exit('The installer needs the bundled Python: leave out --source-only')
    iscc = find_iscc() if installer else None  # before the slow part
    name = 'CO-Costume-Editor-' + version()
    staged = stage(None if source_only else build_runtime())
    dist = os.path.join(HERE, 'dist')
    os.makedirs(dist, exist_ok=True)
    dest = os.path.join(dist, name + '.zip')
    count = 0
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _, names in os.walk(staged):
            for n in names:
                path = os.path.join(root, n)
                z.write(path, f'{name}/' + os.path.relpath(path, staged).replace(os.sep, '/'))
                count += 1
    print(f'wrote {dest} ({count} files, {os.path.getsize(dest) // 1024} KB)')
    if installer:
        for old in glob.glob(os.path.join(dist, name + '-Setup.exe')):
            os.remove(old)
        number = '.'.join(re.findall(r'\d+', version())[:3])  # Windows' version fields take digits only: 0.7.0-rc1 -> 0.7.0
        subprocess.run([iscc, '/Q', f'/DAppVersion={version()}', f'/DAppNumber={number}', f'/DSourceDir={staged}',
                        f'/O{dist}', os.path.join(HERE, 'installer', 'setup.iss')], check=True)
        exe = os.path.join(dist, name + '-Setup.exe')
        print(f'wrote {exe} ({os.path.getsize(exe) // 1024} KB)')


if __name__ == '__main__':
    main()
