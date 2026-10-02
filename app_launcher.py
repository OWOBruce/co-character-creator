"""The release's "CO Costume Editor.exe" (make_release.py freezes this with PyInstaller, Python and the packages
the build needs inside, so players don't install Python). It runs the editor's own .py files that sit next to
it, the same ones start.bat runs:

  CO Costume Editor.exe [serve.py options]   start the server with no console and open the editor window;
                                             the server stops when the last editor window closes
                                             (serve.py --quit-when-closed)
  CO Costume Editor.exe [-u] SCRIPT.py ...   run one of those scripts (serve.py starts build.py this way,
                                             through sys.executable)

With no console, output goes to %LOCALAPPDATA%/CO Costume Editor/editor.log, and a failure to start is shown
in a message box.
"""
import os
import runpy
import sys
import traceback

APP = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__))
LOG_DIR = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'CO Costume Editor')


def message(text, error=True):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, 'CO Costume Editor', 0x10 if error else 0x40)
    except Exception:
        pass


def run(script, args):
    sys.argv = [os.path.join(APP, script)] + args
    runpy.run_path(sys.argv[0], run_name='__main__')


def main():
    os.chdir(APP)
    sys.path[:0] = [APP, os.path.join(APP, 'tools')]
    args = sys.argv[1:]
    if args[:1] == ['-u']:
        args = args[1:]
    if args and args[0].lower().endswith('.py'):  # a script (the build, started by the server): its output
        if sys.stdout is None:                    # goes to the pipe it was given
            os.makedirs(LOG_DIR, exist_ok=True)
            sys.stdout = sys.stderr = open(os.path.join(LOG_DIR, 'build.log'), 'w', encoding='utf-8')
        else:
            sys.stdout.reconfigure(line_buffering=True)
        run(args[0], args[1:])  # a relative path is taken from the program's folder
        return
    # the editor: no console, so the server's messages go to a log
    os.makedirs(LOG_DIR, exist_ok=True)
    log = open(os.path.join(LOG_DIR, 'editor.log'), 'w', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = log
    if not os.path.isfile(os.path.join(APP, 'serve.py')):
        message(f"The editor's files aren't next to the program ({APP}). Unzip the whole folder and run it from there.")
        return
    try:
        run('serve.py', ['--open', '--quit-when-closed'] + args)
    except SystemExit as e:
        if isinstance(e.code, str):  # serve.py's own message, e.g. the port is taken
            message(e.code)
    except Exception:
        traceback.print_exc()
        message('The editor stopped with an error:\n\n' + traceback.format_exc(limit=3)
                + f'\nThe full log is in {LOG_DIR}\\editor.log')


if __name__ == '__main__':
    main()
