"""Where the editor's files are.

CODE  the editor's own files: this folder.
DATA  what the editor makes and writes: catalog/, index/, viewer/data/, viewer/ui/ (the build, from the game),
      settings.json, and my_costumes/ (an AI assistant's costumes).

DATA is this folder too (running from the source, or from the zip), unless the installer's marker installed.ini
sits here: an install can be in Program Files, which only an administrator can write to, so its DATA is
%LOCALAPPDATA%/CO Costume Editor (also where the logs go). The environment variable CO_EDITOR_DATA overrides both.
INSTALLED and GIT say how this copy got here, and so how it updates: the installer (Update now), a git clone
(git pull), or neither (the release zip, or GitHub's Download ZIP: a new download).
"""
import os

CODE = os.path.dirname(os.path.abspath(__file__))
INSTALLED = os.path.isfile(os.path.join(CODE, 'installed.ini'))
# a git clone (the README's "run it from the source"), which updates with git pull rather than the installer;
# exists, not isdir: in a worktree or submodule .git is a file
GIT = os.path.exists(os.path.join(CODE, '.git'))
USER_DIR = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'CO Costume Editor')
DATA = os.environ.get('CO_EDITOR_DATA') or (USER_DIR if INSTALLED else CODE)


def data(*parts):
    """A path under DATA, e.g. data('viewer', 'data', 'catalog')."""
    return os.path.join(DATA, *parts)


def claude_workspace():
    """In an install, make DATA a folder to open Claude Code in: the build-costume skill (copied from the
    program, so an update brings the new one), a launch.json that starts the installed program, and a
    CLAUDE.md saying where the program is. serve.py calls this on every start."""
    import json
    import shutil
    if DATA == CODE:
        return
    os.makedirs(data('.claude'), exist_ok=True)
    skill = os.path.join(CODE, '.claude', 'skills', 'build-costume')
    if os.path.isdir(skill):
        shutil.copytree(skill, data('.claude', 'skills', 'build-costume'), dirs_exist_ok=True)
    python = os.path.join(CODE, 'python', 'python.exe')  # the bundled Python (make_release.py)
    run = {'runtimeExecutable': python, 'runtimeArgs': [os.path.join(CODE, 'serve.py')], 'port': 8765, 'autoPort': True}
    json.dump({'version': '0.0.1', 'configurations': [{'name': 'costume-viewer', **run}, {'name': 'costume-viewer-app', **run}]},
              open(data('.claude', 'launch.json'), 'w', encoding='utf-8'), indent=2)
    os.makedirs(data('my_costumes'), exist_ok=True)
    with open(data('CLAUDE.md'), 'w', encoding='utf-8') as f:
        f.write(f'''# CO Costume Editor (installed)

This is the installed editor's data folder: what it built from the game (`index/`, `catalog/`, `viewer/data/`,
`viewer/ui/`), its `settings.json`, and `my_costumes/` for costumes made here. The program and its scripts are in
`{CODE}`.

Run the editor's scripts with the program's own Python, from this folder (give the script's full path; file
paths you give the script are from here), for example:

    & "{python}" "{os.path.join(CODE, 'costume_check.py')}" my_costumes\\<name>.json

`preview_start` with `costume-viewer` starts the editor for you (`.claude/launch.json`). The build-costume skill
(`.claude/skills/`) is copied from the program on every start, so don't edit it here.
''')
