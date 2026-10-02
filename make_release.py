"""Zip the editor for sharing: python make_release.py [--source-only]  ->  dist/CO-Costume-Editor-<date>.zip

The zip holds "CO Costume Editor.exe" (app_launcher.py frozen by PyInstaller, with Python, Pillow, numpy and
tkinter inside, so players need nothing installed; it has no console and quits when its window closes) and
the editor's source next to it, which the program runs and start.bat can run with an installed Python.
--source-only leaves the program out (the old, small zip; needs Python). Making the program needs PyInstaller
(python -m pip install pyinstaller); its working files go to %LOCALAPPDATA%/CO Costume Editor/release-build,
outside the project.

Also in: the piece descriptions (captions/captions.json) and, for AI assistants, the build-costume skill and
.claude/launch.json. Left out: your own costumes (my_costumes/), .claude/settings.local.json, captions/batches.json.
Nothing made from the game is included: catalog/ (with schema.json), viewer/data/, viewer/ui/ and index/ are
built on each person's machine from their own install on first start. settings.json (this machine's game
folder and account) stays out too.
"""
import ast
import os
import shutil
import subprocess
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ['README.md', 'LICENSE', 'DEVELOPER.md', 'start.bat', 'requirements.txt', 'index_guide.md', 'app_launcher.py', 'app.ico', 'buildprogress.py',
         'serve.py', 'build.py', 'build_catalog.py', 'build_web.py', 'build_ui.py', 'build_index.py',
         'rig_data.py', 'costume_check.py', 'gamefs.py', 'gamedata.py', 'hogg.py', 'make_release.py',
         'viewer/index.html', 'viewer/test.html', 'viewer/render.html', 'captions.py', 'describe.py', 'captions/TAGS.md',
         # what each piece looks like (the captioning pass; build_index.py folds it into the costume index)
         'captions/captions.json',
         # for AI assistants (Claude Code): the costume-building skill, and how to start the editor in its browser pane
         '.claude/skills/build-costume/SKILL.md', '.claude/skills/build-costume/costume_to_json.py', '.claude/launch.json',
         'tests/known.json', 'tests/mset_parity.mjs']
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
# imported only by developer tools (describe.py's captioning, tools/disasm.py, this script): not in the program
DEV_ONLY = {'__future__', 'anthropic', 'capstone', 'PyInstaller'}
WORK = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'CO Costume Editor', 'release-build')


def imported_modules(paths):
    """Every module the editor's scripts import (at the top or inside functions), except the editor's own:
    the program runs those scripts from their .py files, so PyInstaller has to be told what they need."""
    own = {os.path.splitext(os.path.basename(p))[0] for p in paths}
    found = set()
    for p in paths:
        for node in ast.walk(ast.parse(open(os.path.join(HERE, p), encoding='utf-8').read())):
            if isinstance(node, ast.Import):
                found.update(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                found.add(node.module)
                found.update(f'{node.module}.{a.name}' for a in node.names)  # submodules (non-modules are skipped)
    import importlib.util

    def is_module(m):  # "from functools import lru_cache" names a function, not a module
        try:
            return importlib.util.find_spec(m) is not None
        except (ImportError, ValueError):
            return False
    return sorted(m for m in found if m.split('.')[0] not in own | DEV_ONLY and is_module(m))


def build_program():
    """Freeze app_launcher.py into WORK/dist/CO Costume Editor/ (the .exe and its _internal folder)."""
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        sys.exit('Making the program needs PyInstaller: python -m pip install pyinstaller\n'
                 '(or python make_release.py --source-only for a zip without it)')
    scripts = [f for f in files() if f.endswith('.py') and not f.startswith('tests/') and f != 'app_launcher.py']
    hidden = imported_modules(scripts)
    shutil.rmtree(WORK, ignore_errors=True)
    cmd = [sys.executable, '-m', 'PyInstaller', os.path.join(HERE, 'app_launcher.py'), '--name', APP_NAME,
           '--windowed', '--noconfirm', '--icon', os.path.join(HERE, 'app.ico'),
           '--distpath', os.path.join(WORK, 'dist'), '--workpath', os.path.join(WORK, 'build'), '--specpath', WORK,
           '--log-level', 'WARN'] + [x for m in hidden for x in ('--hidden-import', m)]
    print(f'Freezing the program ({len(hidden)} modules the scripts import)...', flush=True)
    subprocess.run(cmd, check=True)
    return os.path.join(WORK, 'dist', APP_NAME)


def main():
    source_only = '--source-only' in sys.argv[1:]
    name = 'CO-Costume-Editor-' + time.strftime('%Y%m%d')
    program = None if source_only else build_program()
    os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
    dest = os.path.join(HERE, 'dist', name + '.zip')
    count = 0
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in files():
            z.write(os.path.join(HERE, f), f'{name}/{f}')
            count += 1
        if program:  # the .exe and _internal/ sit beside the source
            for root, _, names in os.walk(program):
                for n in names:
                    path = os.path.join(root, n)
                    z.write(path, f'{name}/' + os.path.relpath(path, program).replace(os.sep, '/'))
                    count += 1
    print(f'wrote {dest} ({count} files, {os.path.getsize(dest) // 1024} KB)')


if __name__ == '__main__':
    main()
