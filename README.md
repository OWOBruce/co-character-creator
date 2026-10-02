# CO Costume Editor

A costume creator for **Champions Online** that runs in your web browser. You can design a costume on your own computer, without logging into the game, and save it as a costume file the game's tailor can load.

The editor reads everything (pieces, materials, colours, animations) straight from your own copy of the game. It contains no game files, and it never changes your install.

## What you need

- **Windows**, with **Champions Online** installed (Steam or Arc).
- About **320 MB** of free space: the editor itself, plus the data it builds from your game.
- Nothing else to install: the program carries everything it needs.

## Starting it

1. Unzip the editor into any folder you like (keep the whole folder together).
2. Double-click **`CO Costume Editor.exe`**.
   - The first time, Windows may say **"Windows protected your PC"**, because the program isn't signed by a paid certificate. Click **More info**, then **Run anyway**.
3. The editor opens in its own window (Microsoft Edge or Google Chrome with no tabs or address bar; without either, your normal browser).
   - Closing the editor window stops the editor.
   - While it's open you can also use it in any browser at `http://localhost:8765`.
   - If it can't find your game, the **Settings** box opens. Pick your Champions Online folder (for example `C:\Program Files (x86)\Steam\steamapps\common\Champions Online`) with **Browse…**, or paste the path and press Enter.
4. **The first start takes about a minute and a half.** The editor reads your game and builds its data, showing progress on the page. After that it starts in seconds.
   - When the game is patched, the editor notices and rebuilds by itself.

Starting it again while the editor is already open just opens another editor window. The editor stops about 10 seconds after its last window closes.

### Starting it with Python instead (`start.bat`)

`start.bat` starts the same editor with an installed Python (3.10 or newer, from [python.org](https://www.python.org/downloads/) with **"Add python.exe to PATH"** ticked). It installs Pillow and numpy the first time. It keeps a black window open that shows what the editor is doing; closing that window stops the editor. `start.bat --browser` opens a normal browser tab instead of the editor window. This is handy for testing, or for an AI assistant that needs to start the editor.

## Using it

The left panel has the game's three creator screens as tabs.

- **Costume.** Pick pieces by region (head, upper body, lower body…). For the selected piece you can also set its material, pattern, colours and glow.
  - Hover over a piece in a list to preview it; press Esc to go back.
  - **Mirror left/right** keeps gloves, boots and similar pieces matched.
  - **Hide locked** hides pieces you have to unlock. Pieces with a padlock are unlockable; a coin means a store item.
  - **Unlocks** (under the part list; gold, with a count, when something needs unlocking) lists every piece, material and pattern on the costume that needs an unlock, and how to get it: the C-Store, a lockbox, an event reward, a perk and so on, with the unlock item's name. Click one to jump to that part. It's read from the game files, so treat it as a strong hint: the editor can't see what your account owns.
- **Body.** Height, body mass, muscle, and the face and body sliders, plus the game's body and head presets. Double-click a slider's name to reset it.
- **Stance & Mood.** The character's stance and facial mood.
  - **Costume pose** shows the creator's pose instead.
  - **T-pose** is handy for checking pieces.
  - While either pose is on, the stance and mood buttons are shaded; picking one switches back.

At the top:

- **New male / New female** start a blank costume.
- The drop-down loads one of the game's starting costumes. Pick the same one again to undo your changes.
- **Load** opens a costume file or a demo recording. Its file picker starts in the game's `Live\screenshots` folder (where saved costumes are), then in whichever folder you last loaded from, such as `Live\demos`. You can also drag a file onto the page.
- **Save** writes a costume file.
- **Settings** changes which game folder is used, and your account name for saved costume files. Both are kept in the editor's `settings.json`, so they're remembered between sessions and shared by the editor window and any browser.
- **Settings → Export character sheet…** saves a 3840 × 2160 picture of the current character: close-ups of the face from the left, front and right, and the whole character from the front, left, back and right, on the tailor's blue backdrop, white or black. You choose where to save it.
- **About** says who made the editor, thanks the Adventurers supergroup for their help with testing, and has the legal notice.

The **View** options under the 3D view control the preview only; none of them change the costume:

- the floor grid;
- cloth and jiggle physics, plus **Shake** to see them move;
- wind on capes (off by default).
- **Show hidden psionics**: effect materials such as Psionic and Holoforce take their colour from the piece's first colour. In black they're invisible, in the game and in the editor, and this shows them anyway.

Drag in the 3D view to turn the camera, and scroll to zoom.

## Getting costumes into and out of the game

The game keeps saved costumes as picture files in its **`Live\screenshots`** folder, named like `Costume_<account>_<character>_....jpg`. For example: `C:\Program Files (x86)\Steam\steamapps\common\Champions Online\Champions Online\Live\screenshots`.

- **Editing a costume you made in the game:** save it at the in-game tailor, then use **Load** in the editor and pick that file.
- **Taking a costume from a demo recording:** the game keeps demo recordings in **`Live\demos`**. **Load** one and, after a short reminder to ask players before closely copying their costumes, a list of the players in it opens (NPCs are left out). You are at the top of that list with a drop-down of all your costume slots. The one you wore is picked already. Click a player to put their costume on. The list stays open so you can click through everyone (changing your costume slot switches straight away); close it with **Close** or Escape. **Save** then writes a normal costume file.
- **Taking a costume into the game:**
  1. Use **Save**. It asks for your account and character names, then writes the file straight into the game's `Live\screenshots` folder. The account is always yours from **Settings**, even when the costume came from someone else's file. If Settings has none yet, the first one you type at Save is kept there. If it can't reach the game folder, your browser downloads the file instead, and you move it into `Live\screenshots` yourself.
  2. At the in-game tailor, load it.

## Designing costumes with an AI assistant

The build also writes an **`index`** folder that describes, in plain text, every piece, material, pattern and colour a player can use. **`index\GUIDE.md`** explains the costume format.

You can give these files to an AI assistant and ask for a costume ("a noir detective with a long coat and a fedora"). It answers with costume text in a set format. Paste that text into the editor (Ctrl+V on the page) or save it as a `.json` file and **Load** it.

The editor then checks the costume. It fixes what it can (for example, it snaps every colour to the creator's palette) and shows a short report before loading it. There is an example in `examples\night_courier.json`.

## If something goes wrong

- **The program doesn't start, or closes straight away:** its log is in `%LOCALAPPDATA%\CO Costume Editor\editor.log` (paste that into File Explorer's address bar).
- **"Python 3 was not found"** (`start.bat` only): install Python from python.org with "Add python.exe to PATH" ticked, then run `start.bat` again.
- **The packages won't install:** check your internet connection. Or open a command prompt in the editor's folder and run `python -m pip install -r requirements.txt`.
- **"Port 8765 is in use":** another program is using that port. Run `python serve.py 8766` from a command prompt in the editor's folder, then open `http://localhost:8766`.
- **The game folder isn't accepted:** pick the folder that contains `Champions Online\Live\piggs`. The main install folder, its inner `Champions Online` folder, `Live` or `piggs` all work.
- **The build failed:** the page shows the error. Starting the editor again retries. You can also force a clean rebuild with `python build.py --force`.

## Limits

- Weapons aren't offered. A loaded costume keeps its weapons when you save it.
- The preview is close to the game but not identical:
  - reflections, see-through effects, glow and cape movement are approximations;
  - custom reflection and shine settings saved in a costume are kept but not shown yet.
- About 1,000 pieces the game downloads on demand aren't in a fresh install, so they can't be shown.

## Sharing it

Run `python make_release.py` to make a zip of the editor for someone else, with `CO Costume Editor.exe` in it (this needs PyInstaller: `python -m pip install pyinstaller`). `python make_release.py --source-only` makes a small zip without the program, for people who use `start.bat`. Either way it includes only the editor itself (with the piece descriptions and the costume-building skill for AI assistants), never data built from your game: each person's copy builds its own from their install. Your own costumes in `my_costumes/` stay out.

For how it works inside, see [`DEVELOPER.md`](DEVELOPER.md).

*Champions Online is a trademark of its owners. This is a fan-made tool, not affiliated with or endorsed by them.*
