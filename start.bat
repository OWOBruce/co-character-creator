@echo off
rem CO Costume Editor: starts the local server and opens the editor in its own window (Edge or Chrome app mode).
rem "start.bat --browser" opens it in a normal browser tab instead; either way it is also at http://localhost:8765 while this runs.
rem Close this window to stop it. Uses the Python in python\ when it's there (the release zip has it), else needs
rem Python 3.10+ (python.org); the game folder is chosen in the editor's Settings.
title CO Costume Editor
cd /d "%~dp0"

set "PY="
if exist "python\python.exe" set "PY=python\python.exe"
if not defined PY py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY python --version >nul 2>&1 && set "PY=python"
if not defined PY (
  echo Python 3 was not found. Install it from https://www.python.org/downloads/
  echo ^(tick "Add python.exe to PATH" in the installer^), then run this again.
  pause
  exit /b 1
)

rem First run: install the two packages the build needs (Pillow for images, numpy for the index)
%PY% -c "import PIL, numpy" >nul 2>&1
if errorlevel 1 (
  echo Installing the Python packages the editor needs ^(Pillow, numpy^)...
  %PY% -m pip install --user --disable-pip-version-check -r requirements.txt
  %PY% -c "import PIL, numpy" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo The packages could not be installed. Check your internet connection, or run:
    echo     %PY% -m pip install -r requirements.txt
    pause
    exit /b 1
  )
)

%PY% serve.py --open %*
if errorlevel 1 pause
