# CO Costume Editor

A costume creator for **Champions Online** that runs in your web browser. You can design a costume on your own computer, without logging into the game, and save it as a costume file the game's tailor can load.

The editor reads everything (pieces, materials, colours, animations) straight from your own copy of the game. It contains no game files, and it never changes your install.

**[⬇ Download the installer for Windows](https://github.com/codexheroes/co-character-creator/releases/latest/download/CO-Costume-Editor-Setup.exe)** (always the newest version) · [All releases](https://github.com/codexheroes/co-character-creator/releases) · [No installer: run it from the source](#without-the-installer-from-the-source-code-with-git-and-python)

## System requirements

The editor needs much less than the game does, but it reads your own copy of Champions Online, so the game must be installed.

| | Minimum | Recommended | Champions Online, recommended (for comparison) |
|---|---|---|---|
| **Operating system** | Windows 10, 64-bit | Windows 10 or 11, 64-bit | Windows 10 / 11, 64-bit |
| **Processor** | Any 64-bit processor that runs Windows 10 | 2.5 GHz dual-core or better | 2.5 GHz dual-core or better |
| **Memory** | 4 GB RAM (the editor uses about 750 MB of it) | 8 GB RAM, to run the editor and the game at the same time | 3 GB RAM or better |
| **Graphics** | Any graphics with WebGL in an up-to-date browser | DirectX 11 graphics with 256 MB of video memory or more | NVIDIA GeForce 8800 / ATI Radeon HD 3850 or better |
| **DirectX** | Not needed | Not needed | DirectX 9.0c |
| **Storage** | 320 MB free, plus the game | 320 MB free, plus the game | 10 GB free |
| **Sound** | Not needed | Not needed | DirectX 9.0c compatible sound card |
| **Browser** | Any up-to-date browser with WebGL | Google Chrome, Microsoft Edge, Brave or Vivaldi | Not needed |
| **Internet** | Needed while the editor is open | Needed while the editor is open | Needed to play |
| **Game** | Champions Online installed (Steam or Arc) | Champions Online installed (Steam or Arc) | |

The editor's figures are recommendations from testing it, not official requirements. The game's figures are from its [Steam page](https://store.steampowered.com/app/9880/Champions_Online/).

- **Memory:** measured with Chrome on Windows 11, the editor used about 620 MB when it opened and about 730 MB after loading five costumes and changing pieces 400 times. It levels off rather than growing. About 200–300 MB of that is the editor's own server; the rest is the browser window. If your browser is already open, the editor adds less, about 500–600 MB. Windows 11 itself needs 4 GB, so most PCs that run the game today have room for the editor too.
- **Graphics:** the editor draws one character, using about 120 MB of video memory. To check that your browser has WebGL, open [get.webgl.org](https://get.webgl.org/): a spinning cube means it works.
- **Processor:** a faster one mainly shortens the first start, when the editor builds its data from your game (about a minute and a half). After that it starts in seconds.
- **Storage:** the 320 MB is the editor itself plus the data it builds from your game.
- **Internet:** the page loads its 3D engine and fonts from the web (see [Dependencies](#dependencies)).
- **Browser:** with Google Chrome, Microsoft Edge (part of Windows), Brave or Vivaldi the editor opens in its own window, without tabs or an address bar: in your default browser when it's one of those, else in Edge or Chrome. Links in the editor open in your default browser. With no such browser it opens in a normal tab.
- Nothing else to install: the program carries everything else it needs.

## Starting it

1. Download **[CO-Costume-Editor-Setup.exe](https://github.com/codexheroes/co-character-creator/releases/latest/download/CO-Costume-Editor-Setup.exe)** (always the newest version; older ones are on the [releases page](https://github.com/codexheroes/co-character-creator/releases)) and run it.
   - Your browser may warn that the installer isn't commonly downloaded; choose to keep it. Windows may then say **"Windows protected your PC"**: click **More info**, then **Run anyway**. Both happen because the installer isn't code-signed ([why, and how to check it](#code-signing-and-checking-a-download)). Once it's installed, **Update now** updates the editor without going through the browser.
   - It installs into `C:\Program Files\CO Costume Editor` (Windows asks for admin rights), or, if you choose **Install for me only**, into your own `%LOCALAPPDATA%\Programs` without them. It adds the editor to the Start menu (and the desktop, if you tick that box).
   - What the editor makes (the data built from your game, its settings and logs) is kept in **`%LOCALAPPDATA%\CO Costume Editor`**.
   - To update, run a newer installer. It says which version you have and offers to update it, in the same folder with the same choices, and keeps that data. (It asks first before reinstalling the same version or putting an older one over a newer one.) Uninstall it from Windows' **Installed apps**; it asks whether to delete the data too.
   - The editor tells you when a new version is out: the version number in the bottom-right corner says so, the **About** button gets a gold dot, and **About** has **Update now**: it downloads the new installer from GitHub, checks it, and starts it, and the editor closes while it updates (the installer's last page can open the new one). You can also download the installer yourself from there. It looks once a day; **Settings** → **Updates** → **Check now** looks straight away, and the tick box there turns the daily look off.
   - Prefer no installer? The release also has a zip: unzip it anywhere (keep the whole folder together) and double-click **`start.bat`**. It uses the Python that comes in the zip; its console window stays open while the editor runs, and closing it stops the editor.
2. Start **CO Costume Editor** from the Start menu (the installer can start it for you the first time).
3. The editor opens in its own window, with no tabs or address bar: your default browser if it's Chrome, Edge, Brave or Vivaldi, else Edge or Chrome (without either, a normal browser tab).
   - Closing the editor window stops the editor.
   - While it's open you can also use it in any browser at `http://localhost:8765`.
   - If it can't find your game, the **Settings** box opens. Pick your Champions Online folder (for example `C:\Program Files (x86)\Steam\steamapps\common\Champions Online`) with **Browse…**, or paste the path and press Enter.
4. **The first start takes about a minute and a half.** The editor reads your game and builds its data, showing progress on the page. After that it starts in seconds.
   - When the game is patched, the editor notices and rebuilds by itself the next time it starts.
   - The editor offers the pieces, materials, patterns and stances on its own parts list. New parts from a game update are added to it in a later version of the editor.
   - **What's new:** when an update of the editor adds parts to its list, it lists them once when it opens, for masculine and feminine characters. **Show them** narrows the Costume tab to the slots with something new, marked **New** (a piece with a new material, pattern or attachment is marked **+new**); the gold **New ×** tag in the filter box shows everything again. **About** opens the latest list again.
   - A costume you load can have parts the editor doesn't offer yet, such as a piece from a recent game update. They stay in the costume: they aren't drawn, the status line under the 3D view counts them, and **Save** writes them back as they were.

Starting it again while the editor is already open just opens another editor window. The editor stops about 10 seconds after its last window closes.

### Without the installer: from the source code, with Git and Python

If you'd rather not run an unsigned installer, run the editor straight from this repository's code. Nothing of ours comes through your browser, so the warnings about the installer don't come up: the only programs involved are Git's and Python's own.

1. Install [Git for Windows](https://git-scm.com/download/win) and [Python](https://www.python.org/downloads/) 3.10 or newer. In Python's installer, keep the default options (they include the `py` launcher, which `start.bat` uses, and tkinter, which the folder and file pickers use) and tick **"Add python.exe to PATH"**.
2. Pick a folder for it. We suggest **`C:\Users\<you>\CO Costume Editor`**, in your own user folder. Avoid `C:\Program Files`, which needs admin rights to write to (the editor keeps its data beside its code), and folders that OneDrive or Dropbox sync, such as Documents or the Desktop on many PCs (the data it builds from your game is about 175 MB).
3. Open **PowerShell** from the Start menu. It starts in `C:\Users\<you>`, so this puts the editor in the suggested folder:

   ```
   git clone https://github.com/codexheroes/co-character-creator.git "CO Costume Editor"
   ```

4. Open the new **CO Costume Editor** folder and double-click **`start.bat`**. The first time, it installs the two Python packages the editor needs (Pillow and NumPy), and the editor builds its data from your game, which takes about a minute and a half, as above. A black window stays open and shows what the editor is doing; closing it stops the editor. For a desktop shortcut, right-click `start.bat` → **Show more options** → **Send to** → **Desktop (create shortcut)**.

- **Updating:** the editor tells you when a new version is out, and **About** says how. In PowerShell, run `cd "CO Costume Editor"`, then `git pull`, and start the editor again. Your settings and the editor's data stay. `git pull` gets the newest code, which can be a little ahead of the latest release.
- **Removing it:** delete the folder.
- **No Git?** **Code → Download ZIP** on [GitHub](https://github.com/codexheroes/co-character-creator) gets the same files, but you'd download it again to update, and Windows may ask before running `start.bat`, since it came through your browser.
- `start.bat --browser` opens a normal browser tab instead of the editor window. This is handy for testing, or for an AI assistant that needs to start the editor.

## Using it

The left panel has the game's three creator screens as tabs.

- **Costume.** Pick pieces by region (head, upper body, lower body…). For the selected piece you can also set its material, pattern, colours and glow, and those of the attachments some pieces bring (a pair of goggles' lenses, a robotic chest's arms).
  - Hover over a piece in a list to preview it; press Esc to go back.
  - **Filter parts:** type in the box under the region tabs, say "goggles" or "speed gog", and only the slots with a matching piece stay, their lists narrowed to the matches. Tabs with nothing matching dim, and a note names the region's other categories that have more. Esc or × clears it.
  - **Take a colour from the character:** in a colour box, click the pipette (top right), then click any spot on the character. You get the colour that piece has there, not the pixel's shade under the lights, whichever of its colours that is, and its glow too when the colour you're setting can glow. Hovering previews it; Esc stops. It works on a character shown with **Compare with**, too. Skin is left out.
  - **Mirror left/right** keeps gloves, boots and similar pieces matched.
  - **Try before you unlock.** Store items and pieces from lockboxes, events and perks are listed too, including some you can't buy right now, so you can see one on your character before spending anything on it. Check in the game that it's on offer, and how it looks there, before you buy.
  - **Hide locked** hides pieces you have to unlock. Pieces with a padlock are unlockable; a coin means a store item.
  - **Unlocks** (under the part list; gold, with a count, when something needs unlocking) lists every piece, material and pattern on the costume that needs an unlock, and how to get it: the C-Store, a lockbox, an event reward, a perk and so on, with the unlock item's name. Click one to jump to that part. It's read from the game files, so treat it as a strong hint: the editor can't see what your account owns.
- **Body.** Height, body mass, muscle, and the face and body sliders, plus the game's body and head presets. Double-click a slider's name to reset it.
- **Stance & Mood.** The character's stance and facial mood.
  - **Costume pose** shows the creator's pose instead, standing on the Average stance's legs whatever the stance.
  - **T-pose** is handy for checking pieces.
  - While either pose is on, the stance and mood buttons are shaded; picking one switches back.

At the top:

- **New masculine / New feminine** start a blank costume.
- The drop-down loads one of the game's starting costumes. Pick the same one again to undo your changes.
- **Load** opens a costume file or a demo recording. Its file picker starts in the game's `Live\screenshots` folder (where saved costumes are), then in whichever folder you last loaded from, such as `Live\demos`. You can also drag a file onto the page.
- **Save** writes a costume file.
- **Settings** changes which game folder is used, and your account name for saved costume files. Both are kept in the editor's `settings.json`, so they're remembered between sessions and shared by the editor window and any browser.
- **Settings → Export character sheet…** saves a 3840 × 2160 picture of the current character: close-ups of the face from the left, front and right, and the whole character from the front, left, back and right, on the tailor's blue backdrop, white, black, or the same background as the 3D view. You choose where to save it.
- **About** says who made the editor, thanks the Adventurers supergroup for their help with testing, and has the legal notice.

**View options**, at the bottom of the left panel, change the preview only; none of them change the costume. They're in four tabs (the editor remembers which one you had open):

- **Light**
  - **Lighting**: the character is lit the way the game's costume creator lights it (on by default). The lights stay put as you turn the view, as if the character turned in front of them, so you can see every side lit. Untick it for the editor's simpler lights.
  - Move the main light round the character (**Direction**: 0° from the camera, negative from your left) and up or down (**Angle**: 90° is overhead, negative from below), and change its **Brightness** and **Colour**. **Reset** puts back the game creator's light. These work with **Lighting** on.
- **Motion**
  - **Play** the animation, **Loop wings**, and the jiggle (**Bouncers**) and **Cloth** physics.
  - Wind on capes (off by default). The game's outdoor wind is about 1.5; stronger wind makes cloth flutter hard, front and back pieces in opposite directions, as in the game.
  - **Shake** sways the character to see the bouncers and cloth move.
- **Scene**: the **Floor grid**, the **Height ruler**, and **Compare with**, another character beside yours. **Background** sets what's behind the character: a colour, and art over it in that colour. **Comic page** is the tailor's comic page, **None** is just the colour, and the drawn ones are **Halftone**, **Speed lines**, **Studio spotlight**, **Starburst**, **Sunburst**, **Blueprint**, **Starfield** and **Hex shield**. It's remembered between sessions, and **Reset** puts back the tailor's blue comic page. The left panel always keeps the tailor's blue. A character sheet with the **Same as view** background uses it too.
- **Inspect**, for checking pieces:
  - **Skeleton** and **Wireframe** draw the bones and each piece's triangles.
  - **Normal maps** (on by default) are the painted-on bumps: wrinkles, seams, stitching and muscle definition. Untick it to see each piece's bare shape.
  - **Colour regions** shows which parts of each piece take which colour: 1 gold, 2 red, 3 green, 4 blue (the skin, on skin materials). Grey parts keep the texture's own colour.
  - **Body sliders** (on by default) applies the Body tab's sliders. Untick it to see the skeleton at its default proportions.
  - **Mirror X** (on by default) shows the character the way round the game does; the game's files are stored mirrored.
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

The build also writes an **`index`** folder that describes, in plain text, every piece, material, pattern and colour the editor shows. **`index\GUIDE.md`** explains the costume format.

You can give these files to an AI assistant and ask for a costume ("a noir detective with a long coat and a fedora"). It answers with costume text in a set format. Paste that text into the editor (Ctrl+V on the page) or save it as a `.json` file and **Load** it.

The editor then checks the costume. It fixes what it can (for example, it snaps every colour to the creator's palette) and shows a short report before loading it. There is an example in `examples\night_courier.json`.

### With Claude Code

The editor comes with a skill for [Claude Code](https://claude.com/claude-code), **build-costume** (in `.claude\skills`). Open Claude Code in the editor's folder (with the installer, its data folder `%LOCALAPPDATA%\CO Costume Editor`, which the editor sets up for this when it starts) and describe a character: "make me a cowgirl", "make her a space cowboy", "more glow". Claude picks pieces from the index, writes and checks the costume, loads it into the editor in its browser pane, and looks at it close up for pieces poking through each other before showing you. It can also restyle a character from a `Costume_*.jpg` you drop in. Start the editor once first, so the index is built. When you like the result, use **Save** in the editor to put it into the game.

## If something goes wrong

- **The program doesn't start, or closes straight away:** its log is in `%LOCALAPPDATA%\CO Costume Editor\editor.log` (paste that into File Explorer's address bar).
- **"Python 3 was not found"** (`start.bat` only): install Python from python.org with "Add python.exe to PATH" ticked, then run `start.bat` again.
- **The packages won't install:** check your internet connection. Or open a command prompt in the editor's folder and run `python -m pip install -r requirements.txt`.
- **"Port 8765 is in use":** another program is using that port. Run `python serve.py 8766` from a command prompt in the editor's folder, then open `http://localhost:8766`.
- **The game folder isn't accepted:** pick the folder that contains `Champions Online\Live\piggs`. The main install folder, its inner `Champions Online` folder, `Live` or `piggs` all work.
- **The build failed:** the page shows the error. Starting the editor again retries. You can also force a clean rebuild with `python build.py --force`. With the installed editor, delete `%LOCALAPPDATA%\CO Costume Editor\viewer\data\build.json` and start it again.

## Limits

- Weapons and the vehicle bike aren't offered. A loaded costume keeps them when you save it.
- The preview is close to the game but not identical:
  - see-through effects and glow are approximations, and there's no bloom;
  - custom reflection and shine settings saved in a costume are kept but not shown yet.

## Dependencies

- **Inside the installer and the zip:** Python 3.14 (python.org's embeddable package, signed by the Python Software Foundation), [Pillow](https://python-pillow.org/) and [NumPy](https://numpy.org/) (reading the game's images and building the index), and tkinter (the folder and file pickers).
- **Loaded by the editor page when it opens** (this is why it needs the internet): [three.js](https://threejs.org/) 0.160 for the 3D view, from the jsDelivr CDN, and the Bangers and Comic Neue fonts from Google Fonts.
- **Running from the source code:** Python 3.10 or newer, plus Pillow and NumPy (`requirements.txt`; `start.bat` installs them).
- **For developers only:** Python 3.14 and [Inno Setup 6](https://jrsoftware.org/isinfo.php) to make the installer, the `anthropic` package for writing the piece descriptions (`describe.py`), `capstone` for `tools\disasm.py`, and Node.js for one test. See [DEVELOPER.md](DEVELOPER.md).

## Code signing, and checking a download

The installer isn't code-signed. A certificate costs money every year, and the free signing programmes for open-source projects want a track record this project doesn't have yet. So Windows SmartScreen, your browser and some antivirus programs may warn about a new release until enough people have downloaded it. The program itself has no exe of its own: the Python it installs is python.org's, signed by the Python Software Foundation, so the installer is the only unsigned file.

To avoid the unsigned installer altogether, [run the editor from the source code](#without-the-installer-from-the-source-code-with-git-and-python) with Git and Python instead.

You can check that a download is the real thing:

- **Built in the open:** every release is built by GitHub Actions from this repository's source (`.github/workflows/release.yml`), not on anyone's PC.
- **Build attestations:** each file carries one. With the [GitHub CLI](https://cli.github.com/), `gh attestation verify CO-Costume-Editor-Setup.exe --repo codexheroes/co-character-creator` shows it was built by that workflow from this repository, and from which commit.
- **Checksums:** the release page lists each file's SHA-256. **Update now** checks the installer against it before starting it.
- **Who:** [sadronmeldir](https://github.com/sadronmeldir) writes the code and reviews any outside contribution before it's merged.

## Privacy

Everything runs on your own computer. The editor's server only answers your own PC (`127.0.0.1`), and it reads your game files without changing them. The only things fetched from the internet are three.js and the fonts above, and, at most once a day (or when you press **Check now**), the number of the newest release from GitHub, so the editor can tell you about updates (nothing else is sent: no costumes, settings or game details; turn it off in **Settings** → **Updates**). When you click **Update now**, the new installer is downloaded from GitHub. Saved costumes go to your game's `Live\screenshots` folder, and the editor's settings to `settings.json` (in `%LOCALAPPDATA%\CO Costume Editor` when installed, else in the editor's folder).

## Feedback and source code

Found a bug, or have an idea? Open an [issue](https://github.com/codexheroes/co-character-creator/issues). The source code is at [github.com/codexheroes/co-character-creator](https://github.com/codexheroes/co-character-creator), and [DEVELOPER.md](DEVELOPER.md) explains how it works.

## Credits

Made by **@sadders1**. Feel free to hit me up in-game!

Special thanks to the **[Adventurers](https://codexheroes.com/co/adventurers/)** supergroup for their help with testing.

## License and legal

The CO Costume Editor is free software under the [GNU General Public License v3.0](LICENSE).

Champions Online, its characters, costume pieces, artwork and other game content are the property of their respective owners. The CO Costume Editor is an unofficial fan project. It is not affiliated with, endorsed by or supported by Cryptic Studios, Arc Games or any owner of Champions Online. It reads the game files from your own installation and does not include or redistribute them. Use it at your own risk.

The parts the editor offers come from its own list, which later versions of the editor add to after game updates. A part in the editor may not be on sale now, or may look different in the game, so check there before you spend anything on it.
