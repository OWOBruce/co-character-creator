"""Starts the editor with no console: the installer's shortcuts run python\\pythonw.exe app_launcher.py, the
Python make_release.py bundles (python.org's embeddable package, with Pillow, numpy and tkinter added).

  pythonw.exe app_launcher.py [serve.py options]   start the server and open the editor window; the server
                                                   stops when the last editor window closes
                                                   (serve.py --quit-when-closed)

Scripts run as usual with that Python (python\\python.exe costume_check.py ...; serve.py starts build.py through
sys.executable): its python314._pth puts the editor's folder and tools/ on the path.

With no console, output goes to %LOCALAPPDATA%/CO Costume Editor/editor.log, and a failure to start is shown
in a message box.
"""
import os
import runpy
import sys
import traceback

APP = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'CO Costume Editor')


def message(text, error=True):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, 'CO Costume Editor', 0x10 if error else 0x40)
    except Exception:
        pass


def main():
    sys.path[:0] = [APP, os.path.join(APP, 'tools')]
    os.chdir(APP)
    # no console, so the server's messages go to a log
    os.makedirs(LOG_DIR, exist_ok=True)
    log = open(os.path.join(LOG_DIR, 'editor.log'), 'w', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = log
    sys.argv = [os.path.join(APP, 'serve.py'), '--open', '--quit-when-closed'] + sys.argv[1:]
    try:
        runpy.run_path(sys.argv[0], run_name='__main__')
    except SystemExit as e:
        if isinstance(e.code, str):  # serve.py's own message, e.g. the port is taken
            message(e.code)
    except Exception:
        traceback.print_exc()
        message('The editor stopped with an error:\n\n' + traceback.format_exc(limit=3)
                + f'\nThe full log is in {LOG_DIR}\\editor.log')


if __name__ == '__main__':
    main()
