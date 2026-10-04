# CO Costume Editor: developer notes

How the editor reads the game and how each part works. For installing and using it, see `README.md`.
Everything is read straight from the install's `.hogg` archives: nothing is extracted, and the project ships no game data.

## Pipeline

```bash
start.bat                       # double-click: builds the editor's data if needed, starts the server, opens the editor
python build.py [--game FOLDER] [--force]   # build everything the editor needs from an install (~90 s)
python tools/dump_schema.py     # GameClient.exe ParseTables -> catalog/schema.json (build.py runs it every build)
python make_release.py          # zip for sharing, with CO Costume Editor.exe -> dist/CO-Costume-Editor-<version>.zip (no game data; --source-only: no exe; --installer: also the Setup.exe)
python tests/run.py [--quick] [--no-browser] [--show]   # regression tests (see Tests below)
```

- **`gamefs.py`** reads any file of an install by path, from its archives (`open_game().read('bin/SkelInfos.bin')`), and finds the install (`--game`, `settings.json`, Steam libraries, Arc).
- **`gamedata.py`** decodes the game's `.bin` files from there on demand, once per run (the parse table and field stripping for each is in its `BINS` / `OTHER_BINS`), plus the materials and shader templates of `Materials.bin`.
- **`build.py`** reads the parse tables out of the install's `GameClient.exe` (`tools/dump_schema.py`), then runs `build_catalog.py` → `build_web.py` → `build_ui.py` → `build_index.py` in one process, and records the install and its archives' and exe's sizes and dates in `viewer/data/build.json`. It does nothing when those still match. Progress: it prints `## <stage>` lines and `%% <fraction done>` lines (`buildprogress.py`: `span` splits the current share of the bar, `each` gives each loop item its own slice), which serve.py passes to the page's progress bar; the stages' shares come from how long each took last time (`stageSeconds` in `build.json`), else from `STAGES`' typical seconds. It stops with a clear message when Pillow or numpy is missing (`requirements.txt`; `start.bat` installs them on first run).
- **`serve.py`** checks that record at start and after a folder change in Settings. When the build is missing or the game was patched, it runs `build.py` in the background, and the page shows the progress, then reloads.
- **Outputs** (all generated per install): `catalog/` (with `schema.json`), `viewer/data/`, `viewer/ui/` and `index/`. They are not source: `make_release.py` leaves them out, `.gitignore` lists them, and in this Dropbox copy they carry Dropbox's ignore mark (`com.dropbox.ignored` stream) so they don't sync. The build empties `index/` rather than deleting it, so the mark stays.
- **Checked against the old extraction-based build:** everything is byte-identical, except 17 piece names the game has since corrected ("Cannisters" → "Canisters").

## Releasing

GitHub: [codexheroes/co-character-creator](https://github.com/codexheroes/co-character-creator) (`main`, GPL-3.0). The repo holds exactly the release files (`make_release.py`'s `FILES`/`FOLDERS`) plus `LICENSE`, `.gitignore`, `.gitattributes` and `.github/`; `.gitignore` keeps out everything built from the game, `settings.json`, `my_costumes/`, `captions/batches.json` and `.claude/settings.local.json`. A new file the editor needs must go in `FILES`/`FOLDERS` too, or the program won't have it.

1. Bump `VERSION` in `viewer/js/version.js` (the only place it is set; the About box shows it).
2. Commit and `git push`.
3. `git tag v<version>` and `git push origin v<version>`. `.github/workflows/release.yml` then builds the program, the zip and `CO-Costume-Editor-<version>-Setup.exe` (Inno Setup, `installer/setup.iss`) on a Windows runner and publishes them as a GitHub Release. It fails if the tag doesn't match `version.js`. **Actions > Release > Run workflow** builds without publishing (the files are kept as a workflow artifact).

**Updates.** The installer reads the installed version from its uninstall entry (`DisplayVersion` under the `AppId`, HKLM or HKCU) before the wizard: newer offers to update, the same version asks before reinstalling, and older over newer asks with No as the default; silent installs skip the questions. An update skips the licence page and reuses the folder and choices (Inno's defaults for a known `AppId`, so the `AppId` must never change). The editor learns of new releases through `serve.py` `/api/update` (`latest_release`): GitHub's `releases/latest`, asked at most once a day and cached in `settings.json` (`latestRelease`; a failure retries after an hour), and never under the test page (`?test`). `about.js` compares it with `version.js`: a newer one shows in the version label and the About box (with the installer link). Settings → Updates writes `checkUpdates` (on unless set false), which makes `/api/update` answer `{"off": true}` without asking GitHub.

**Antivirus and proof of origin.** An unsigned PyInstaller program draws machine-learning antivirus guesses: Defender flagged the v0.6.6 installer as `Trojan:Win32/Wacatac.B!ml` (2 of 71 engines on VirusTotal; the sandboxes found nothing). To make that less likely, the workflow compiles PyInstaller's launcher on the runner instead of taking PyPI's prebuilt one, which malware ships too (it stops if it ends up with the prebuilt one), and `make_release.py` never UPX-packs and gives the exe version details (`version_file()`; also required for code signing). Report a flagged release at microsoft.com/wdsi/filesubmission (Software developer → incorrectly detected). Every file the workflow makes gets a build attestation: `gh attestation verify <file> --repo codexheroes/co-character-creator` shows it was built by this workflow from this repo, and from which commit. The workflow's actions are pinned to commits, and PyInstaller to a version.

`python make_release.py --installer` makes the same files locally in `dist/`, for testing (needs PyInstaller and Inno Setup 6). The installer puts the program in Program Files (admin; or `%LOCALAPPDATA%\Programs` if the player picks only-for-me) and writes `installed.ini` beside it. `paths.py` sees that marker and moves everything the editor writes (`catalog/`, `index/`, `viewer/data/`, `viewer/ui/`, `settings.json`, `my_costumes/`) to `%LOCALAPPDATA%\CO Costume Editor` (`CO_EDITOR_DATA` overrides; without the marker, as in this source folder or the zip, it stays beside the code). serve.py then serves `/data/` and `/ui/` from there, and on each start makes that folder a Claude Code workspace (`paths.claude_workspace`: the skill copied from the program, a `launch.json` that starts the installed exe, a `CLAUDE.md` naming the program folder). Every script must get its output paths from `paths.data()`, never from its own folder. Installing over an older version replaces the code (it clears `_internal/`, `tools/` and `viewer/js/` first) and leaves the data alone. The uninstaller asks before deleting the data folder.

## Tests

`python tests/run.py` checks the build against the install and the editor against its data; exit code 0 when all pass. Run it after any change and after a game patch. About 3 minutes plus the browser part; `--quick` skips decoding every animation track and decodes a sample of meshes instead of all of them.
- **Python:** the build is current; every `.bin` decodes without errors; every `.mset` header reads (all 22,552, including the 1,915 with several models); every `.atrk` decodes; every player piece finds the model its geometry names and its mesh decodes; `viewer/js/mset.js` (run in Node, `tests/mset_parity.mjs`) agrees with `tools/mset.py` on every multi-model file plus a sample; every stance/mode/mood, tail/wing animation and body-scale track has its pose file; `costume_check.py` accepts all starting costumes and `examples/`; the index lists each piece once with correct counts and no hidden categories.
- **Browser:** `viewer/test.html` (headless Edge or Chrome, SwiftShader WebGL; `--show` for a visible window, or open `/test.html` in the running editor and press Run) drives the editor in a frame: every material compiles and links (skinned and rigid, normal maps on and off); every player stance has an idle and a different costume pose, and every mood animates; the Costume pose / T-pose / stance buttons switch modes and move the body; every `Live/screenshots/Costume_*.jpg` loads and saves back to identical text (checksum mismatches are noted, not failed); every starting costume loads without errors and without a part much bigger than the body. Results are posted to `/api/test/results`, which `run.py` collects.
- **Accepted exceptions** (game-data quirks) are listed with reasons in `tests/known.json`.
- **Load:** everything runs at below-normal priority. Under the test page the editor draws 2 frames a second (`index.html?test`), since headless WebGL renders on the CPU (SwiftShader) and full-rate drawing ran every core flat out; the page also rests 250 ms between costumes. `--browser-only` runs just the build check and the browser part.

## Piece descriptions (captions)

What each piece looks like, for the index: `captions.py`, `viewer/render.html` (`viewer/js/render.js`), `captions/`.
1. `python captions.py pilot [N]` writes the render list (`viewer/data/render_jobs.json`): N pieces that exist on both bodies, spread over every slot, each on the male and the female body.
2. `http://localhost:<port>/render.html` renders each listed piece on a plain grey mannequin of its body (the creator's default pieces, Heroic stance, standing still, cloth settled for 2 s) in its default material with a fixed four-colour scheme (0 light grey, 1 mid blue, 2 near black, 3 red), as a 1280×640 sheet of eight views: full body front and back; the piece zoomed (camera framed on its bounding box) from the front, three-quarter front, side, back and three-quarter back, with the body faded and the piece drawn over it so it shows from every side; and the piece alone from above. One piece at a time with a 300 ms rest, on the graphics card of a normal browser window. Sheets go to `<renders folder>/<Male|Female>/<geometry>.jpg`: `settings.json` `rendersFolder` if set, else `%LOCALAPPDATA%/CO Costume Editor/renders` (outside the project: bulk images made from game data).
3. Each sheet is looked at and described: a one- or two-sentence description, which features take which colour slot, tags from `captions/TAGS.md`, and how the other body's version differs. `python captions.py add FILE` merges them into `captions/captions.json` (in the project, so they're kept), keyed `<Male|Female>/<geometry>` with the mesh and model they describe, and rejects tags not on the list. `python captions.py status` counts progress.
4. `describe.py` does step 3 at scale with Claude Sonnet 5.5 through the Message Batches API (half price): one request per piece with its male and female sheets together, structured JSON replies whose tags can only come from `TAGS.md`, instructions that forbid naming the test scheme's colours (with two hand-written entries built in as examples); colour words that still slip through as adjectives are removed on collection. `plan` (offline estimate), `submit [--max N]` (only pieces without a description), `collect` (saves after each batch), `status`; submitted batches are tracked in `captions/batches.json`. Needs `pip install anthropic`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_WORKSPACE_ID` if the key isn't scoped to a workspace. Every piece was described this way on 2026-09-30 (17,746 sheets, about $42).

## Layout

| Path | Contents |
|---|---|
| `hogg.py` | Reader for Cryptic `.hogg` archives |
| `tools/pe.py`, `tools/dump_schema.py` | Recover the ParseTable schema from `GameClient.exe` |
| `tools/bindecode.py` | Generic decoder for Cryptic textparser `.bin` files |
| `tools/trace.py` | Field-by-field trace of one record (for debugging decodes) |
| `catalog/schema.json` | ~4,100 recovered struct definitions (generated from the install's exe) |
| `catalog/` | Cleaned catalog for the web app |
| `rig_data.py` | Skeletons, animation tracks, stances and body sliders for `build_web.py` |
| `gamefs.py`, `gamedata.py`, `build.py` | Game files from the archives, decoded bins, the whole build |

In the archives: `bin/` (compiled defs), `bin/geobin/cl|ol` (`.mset` meshes), `texture_library/` (`.wtex`), `animation_library/` (skeletons and animations), `shaders/` (material operations).

## Catalog

| File | What |
|---|---|
| `skeletons.json` | Body types: bones, regions, height/muscle/body-scale ranges, stances, colour sets |
| `regions.json`, `categories.json`, `bones.json` | Designer menu structure (region → category → bone slot) |
| `geometries.json` | Pieces: display name, bone, categories, allowed materials, mesh path, availability, unlock sources |
| `materials.json` | Materials: allowed textures and defaults, glow/reflection/specular, availability |
| `textures.json` | Patterns, details and so on: `.wtex` path, extra textures, movable limits, availability |
| `colorSets.json`, `colorQuadSets.json` | Palettes |
| `moods.json`, `styles.json`, `layers.json` | Misc designer options |
| `unlockBundles.json` | Unlock costumes (item/account unlock): source (event, lockbox, C-Store…), parts granted, icon if matched |
| `costumeSets.json` | C-Store/F2P costume sets and their unlock expression |
| `messages_en.json` | English strings for every message key referenced above |

**Availability** comes from each piece's `RestrictedTo` flags: `initial` means available at character creation, `unlock` means a player can use it once it is unlocked, and `npc` means NPC-only. `unlockedBy` lists the unlock bundles whose parts include the piece.

## Format notes

- **HOGG**: header `0xDEADF00D`, v10. File table entries are 32 bytes (offset, size, timestamp, crc, …, ea index) and EA entries are 16 bytes (name id, header id, unpacked size, flags). Names are in the `?Datalist` file, plus the data list journal: the `dlj_size` bytes after the header's `opj_size` operation journal, where a patch records the names it adds before the data list is rewritten (u32, u32 bytes used, u32 the same, then records of u8 op: `1` add = i32 name id, u32 length, name; `2` remove = i32 name id). Reading only the data list misses every file patched in since it was last rewritten: about a thousand costume meshes, a few hundred textures and data files (`hogg.py` `_apply_journal`). Data is zlib-compressed when the unpacked size is non-zero.
- **ParseTables** (32-bit exe, `.data`): 40-byte rows `name, ?, type, type_hi, offset, param, subtable, format, …`. The header row has `type_hi = 0x04000000`, and the table ends with token 2. Token = `type & 0xff`. Flags: `0x40000` earray, `0x80000` fixed array, `0x100000` pointer, `0x400000` alias (skip), `0x20000000` deprecated (skip). `type_hi & 0x400` means the field is not written to bins.
- **.bin**: `CrypticS` header, `Files1` source list, `Depen1`, then `u32 dataSize, u32 count` and one `u32 size + fields` per record.
  - Strings are `u16 len` plus bytes, padded to 4. References are strings.
  - An embedded struct is `u32 size + body`. A pointer struct is `u32 present` followed by a sized struct. An earray is `u32 count + items`.
  - u8 is 1 byte and bit fields are 4 bytes. A `CURRENTFILE` field is an index into the file list, offset by 2.

## Costume index (for building costumes by name, e.g. with an AI)

`build_index.py` (part of `build.py`, ~35 s) writes `index/`: a Markdown description of every piece a player can wear. The guide (`index_guide.md` → `index/GUIDE.md`) explains how costumes work, the costume JSON format and the workflow.

- **Per slot** (`index/<Body>/<Region>/<Slot>.md`, cut into `<Slot>/part_N.md` when long; each piece once, with the categories the editor offers — deprecated and hidden ones are left out): every piece with its categories, availability and unlock source, mirror piece, child slots, and materials.
  - **Material looks** are derived from the material's shader (`material_look`): matte / satin / glossy, reflective, brushed-metal sheen, see-through, glowing, bright edges, animated.
  - **Colour rules:** skin on colour 3, and which slots may glow.
  - **Patterns** show what each colour slot paints: `pattern_coverage` measures the mask texture from the archives (R, G, B and the remainder, weighted by the tint mask).
  - **Hair length:** `hair_length` measures the mesh's lowest point against body landmarks from the skeleton's bind pose (short / chin / neck / shoulder / upper-back / mid-back / waist+, plus "tall on top").
- **Shared:** `shared-materials.md` (effect materials used by many pieces) and `pattern-lists/` (long shared pattern lists).
- **Palettes:** `palettes.md` lists the creator's palettes with the nearest colour names, plus the 25 ready-made schemes.
- **For scripts:** `index.json` holds the same data.
- **Checker:** `costume_check.py file.json [--out doc.json]` checks and completes a costume JSON (colours always snap to the creator's palettes):
  - pieces, slots and category fit;
  - materials and textures for the piece;
  - required slots and child pieces;
  - glow slots and body ranges.

  It reports errors, changes and notes, with suggestions. `serve.py` offers it at `POST /api/check`. The editor's Load button, drag-and-drop and paste (Ctrl+V on the page) accept costume JSON, show the report and load the result.
- **Tested against the 183 starting costumes:** the only errors are the developer archetypes' NPC-only pieces and materials.
- **Size:** see the build output. It's generated, like `viewer/data/`.
- **Example:** `examples/night_courier.json`.

## Editor

```bash
python build_web.py     # catalog/*.json -> viewer/data/catalog/{Male,Female}.json, palettes, starting costumes, poses
python build_ui.py      # the game's UI art -> viewer/ui (panel/button kits, slider parts, backdrop)
start.bat               # double-click: starts the server and opens the editor in its own window (python serve.py --open)
python serve.py         # http://localhost:8765 (viewer/ at /, the game's meshes + textures at /assets/)
python serve.py --game "D:\Games\Champions Online"   # a different install (else the saved or detected one)
```

**Meshes and textures come straight from your install.** `serve.py` indexes the install's `Live/piggs/*.hogg` archives at startup (about 0.2 s, 73k meshes and textures) and answers each `/assets/` request from them:
- a mesh is the `.mset` as stored;
- a texture is the `.wtex` with its Cryptic header stripped, i.e. the embedded `.dds`.

Nothing is converted per asset. The browser decodes `.mset` (`viewer/js/mset.js`, a port of `tools/mset.py` checked against it on 60 random meshes) and `.dds` (`viewer/js/dds.js`; DXT1/DXT5 stay compressed on the GPU).
- **Which install:** `--game`, else the folder saved in Settings (`settings.json`), else the first install found: Steam's default folder, other Steam libraries (`libraryfolders.vdf`), or Arc's default folder. The install root, its inner `Champions Online` folder, `Live` or `piggs` all work.
- **Changing it:** the **Settings** button (next to the title) shows the folder in use. Type a path and press Enter, or Browse… to open a folder picker (the server is local, so the dialog opens on this machine). Changing it reloads the page. Settings opens by itself when no usable folder is found.
- **No fallback:** assets come only from the chosen install's archives, never from an extracted copy.
- **start.bat** finds Python (`py -3`, else `python`), runs `serve.py --open` and keeps its window open; closing the window stops the editor. `--open` opens the page as an app window (`msedge`/`chrome --app=URL`, found through the registry's App Paths or the usual install folders), falling back to the default browser; `start.bat --browser` passes `--browser`, which wins and opens a normal tab. Starting it again while it's running just opens the editor again (the server won't share its port). The tab and window icon is `viewer/img/favicon.svg` (`app.ico`, the program's icon, is rendered from it).
- **CO Costume Editor.exe** (release only) is `app_launcher.py` frozen by PyInstaller (`make_release.py`), windowed, with Python and every library the editor's scripts import (found by scanning them: Pillow, numpy, tkinter and the standard library) in `_internal/`. The editor's own `.py` files stay plain files beside it and are run from there, so the program and `start.bat` run the same code. It starts `serve.py --open --quit-when-closed`; `sys.executable` is the program, so the server's `[sys.executable, '-u', 'build.py', ...]` comes back to the launcher, which runs that script with its output on the pipe. With no console, the server's output goes to `%LOCALAPPDATA%/CO Costume Editor/editor.log`, and a failure to start (e.g. `sys.exit` for a taken port) shows a message box. `--quit-when-closed`: every page reports in (`/api/alive`, every 15 s, from a plain script ahead of the module) and says goodbye on `pagehide` (`sendBeacon` to `/api/bye`); the server stops 10 s after the last page leaves (a reload comes back within that), drops pages silent for 5 minutes (a minimised window's timers run once a minute), and stops a running build with it. PyInstaller's working files go to `%LOCALAPPDATA%/CO Costume Editor/release-build`. The program isn't code-signed, so SmartScreen warns on first run. **Load** asks serve.py (`/api/file/open`) to show a native Open dialog (tkinter, like the folder Browse), since a browser's picker can't be started in a given folder; it starts in the install's `Live/screenshots`, then the last folder used this run, and answers with the file's bytes. Without serve.py or tkinter the page falls back to its `<input type=file>`. The account for saved costumes lives in `settings.json` (`/api/settings`, returned by `GET /api/source`); localStorage `co.account` is only a cache, and an account only a browser had is moved to the server on start.
- **Local only:** the server listens on 127.0.0.1, and only same-origin JSON requests may change the folder.
- **The editor's data** (`viewer/data`, ~67 MB, and the UI art) is built from the same archives by `build.py`. The server keeps it in step with the install; see Pipeline.

- **Catalog** (`viewer/data/catalog/<Skeleton>.json`, ~19 MB each, gzipped by `serve.py`): regions → categories, bone slots, every player-usable geometry (mesh path, model name, vertex bone names, sub-skeleton), material (textures, defaults, suppress-muscle, muscle map) and texture (DDS paths, extras). Unlock sources are indices into `unlocks.json`. `costumes.json` has the 183 `Archetype_*` costumes as editor documents.
- **Costume document** (`viewer/js/character.js`): `{skeleton, stance, skin, height, muscle, bodyScale, scaleValues, parts: [{bone, geometry, material, pattern, detail, diffuse, specular, colors}]}`, the same fields as `PlayerCostume`. Empty material/texture fields fall back to the geometry's default material and that material's defaults (or, for a texture the material requires and has no default for, its first one; see Materials).
- **Editing:** `Character.setPart(bone, part)` rebuilds only that bone's mesh (~300 ms uncached). Colours, skin and muscle are shader uniforms (`viewer/js/costume-material.js`: ColorTint4b and the muscle `NormalAdd` on the GPU), so they update instantly.
- **Sub-skeletons** (tails, wings, vehicles): `CostumeGeometry.Options.SubSkeleton` names a SkelInfo (e.g. `Core_Tail_Lizzard`) and `SubBone` the main-skeleton bone its root hangs off (`Hips`, `Tail`, `Back`). The attach bones all have identity bind rotations. Each piece's mesh is modelled around the sub-skeleton's own origin, so the inverse bind matrices come from the sub-skeleton alone. Pieces that share a sub-skeleton and attach bone share one instance (e.g. an insect backpack and the wings on its child bone).
  - **Animation:** a sub-skeleton has its own `Sequencer` and `SeqType`, resolved like the body's (`StanceResolver.resolve_sub`). In the creator it plays `Core_Tail_Lizzard/Idle`, `Core_Wings/Test` (the name the game uses), `Wings_Bug_Idle` or `Wings_Bfly_Idle`. Its translation keys are applied: they are authored for that skeleton, and the wing tracks' `Wing_Back` key exactly cancels its bind offset (+0.186, −0.373 against −0.186, +0.373), which confirms keys are offsets added to the bind pose.
  - **Sliders:** a skeleton slider with a `SubSkeleton` (Tail Length/Thickness, Wings, Wings (insect), Wings (butterfly), plus NPC-only ones) drives that sub-skeleton's own ScaleInfo groups (`Core_Tail_Scale`, `Core_Wings_Scale`) and nothing on the body. The sub-skeleton hangs off its attach bone like a child bone, so it inherits the attach bone's position, rotation and scale. The editor only shows these sliders while such a piece is worn. The tail group scales from 0.1× at −100 to 5× at +100, which is why the player range is −70…+10.
  - **Creator bits:** tails and wings only have `Idle` sequences, and the in-world face and basebone layers also key off `Idle`, so creator mode sets `Costume` and `Idle` (`MODES` in `tools/stances.py`). This changes nothing on the body except enabling the basebone idle, whose track is empty.
- **Unresolved skin bones:** 214 cloth pieces (capes, some belts) weight vertices to `cloth`, a pseudo-bone the cloth simulation drives. Weights on unknown bones are dropped and the rest renormalised. Vertices weighted only to `cloth` follow the mesh's dominant real bone, so capes hang as modelled with no simulation. Every other vertex bone name of every player piece resolves to its skeleton or sub-skeleton.
- **Belt and helmet add-ons** (501 pieces): skinned models whose ModelHeader attaches them to `Capebelt` or `Helmetextra` (or a waist accessory) are modelled around a skeleton bone, not in character space: `Belt`, `Helmet`, or the costume bone's `BoneName`. `build_web.py` marks them `localTo` and the viewer moves a copy of the mesh to that bone's bind pose before skinning (`placeMesh`). Without it they were drawn at the character's feet. Inferred from the data (moved, their centres sit a median 0.4 ft from their skin bones, against 3.9 ft as stored), not ported; `tests/run.py` checks that no skinned piece sits at the floor while skinned only to bones up the body.
- **Unskinned pieces** are modelled in their bone's space and bound rigidly to the ModelHeader's `attachment_bone` (sub-skeleton first, e.g. vehicles). Weapons and travel items (~780) name no bone because the game attaches them at run time. As a preview they go in the right hand (`WepR`, grip at the model origin); their held orientation and weapon stances are not implemented.

### Item browser (`viewer/js/parts-panel.js`, rules in `viewer/js/rules.js`)

- **Regions and categories:** region tabs, then a ◀ category ▶ cycler. Each region shows one category (`PlayerCostume.RegionCategory`, stored as `regionCategories` in the document). Categories named "DEPRECATED:" or marked hidden are not offered. Switching category keeps the pieces that belong to it, gives required bones (skeleton `requiredBones` plus the category's) a piece, and removes the rest and any bones the category excludes.
- **Slots:** the region's non-child bones that have player pieces in the category. Each is a ◀ piece ▶ cycler, and clicking the name opens a searchable list. Hovering (or arrowing through) the list previews the piece on the character; leaving the list or pressing Esc restores the old one.
- **Selected slot:** Material, then Pattern / Detail / Diffuse / Specular (the material's textures of each type, with "none" unless the material requires it), the colours, and child attachments.
- **Child pieces:** `CostumeGeometry.Options.ChildGeometryDef` (in the catalog as `childGeos`: bone, default, choices, required). Picking a piece puts its default children on their bones and clears child bones it doesn't define, e.g. the robotic chest brings robotic arms.
- **Mirror left/right** (on by default) also puts the piece's `MirrorGeometry` on the bone's `MirrorBone`.
- **Badges:** unlockable pieces, materials and patterns get the game's padlock (`CC_Costume_Locked`), or the C-Store coin (`CC_Costume_Purchased`) when every unlock source is a store item. The tooltip lists the unlock sources. "Hide locked" hides them; "Show unused/NPC" lists pieces the artists named NPC:/UNUSED:/DEPRECATED:.

### Colours (`viewer/js/colors.js`)

- **Palettes** come from the skeleton: `BodyColorSet0` (`Hero_Colors`, 323 swatches, a 19×17 grid), `SkinColorSet` (`Hero_Skin`, 97) and `ColorQuadSet` (`Hero_Colorquads`, 25 four-colour schemes). No player bone or piece overrides them.
- **Links:** each part has `ColorLink` (enum at `0x20171b8`: None 0, All 1, Mirror 2, Group 3, MirrorGroup 4, Different 5). All means the costume's shared colours: in 96% of costumes with several All-linked parts they are identical. The document keeps them as `colors`/`glow`, taken from the first All-linked part. Mirror shares colours with the part on the mirror bone. Player skeletons have no bone groups, so Group behaves like None and MirrorGroup like Mirror. New pieces keep what their slot had, or else link to the shared colours.
- **Editor:**
  - The costume box has the shared colours, skin, Schemes (colour quads), Shuffle, Randomise and Reset.
  - The selected slot has Shared/Mirror/Unique buttons and its four colours. On skin materials colour 4 is the skin chip.
  - Clicking a chip opens the palette. Hovering a swatch previews it, Esc or clicking outside cancels.
  - A Glow slider (0–10, the range costumes use) appears for colours whose material `ColorOptions.AllowGlow` is set (the top-level `AllowGlow` copy is unused and always 0).
  - **Colour dropper** (the pipette, top right of every colour popup but Skin's; `pick.js`): while it's on, the character view shows a pipette cursor and the camera is still. The pixel under the cursor is drawn again into a 1×1 target (`setViewOffset`), with everything but the costume pieces hidden, blending off and depth written, and each piece's material in pick mode (uniform `coPick` = its number): `CO_PICK_OUTPUT` writes the piece's number and the slot `coRegionSlot` gives that spot (the Colour regions weights, the largest wins; 4 where the mask's alpha leaves the texture's colour, 5 for a template with no colour tint) instead of its colour. The answer is that piece's colour and glow in that slot, so lighting, glow and the mirroring don't change the reading; skin (colour 4 on skin materials), untinted spots and hidden black Fx give nothing. The preview is undone before each reading, so hovering reads the pieces' own colours, not the one being tried on them. A pick snaps to the popup's palette. Its glow is copied (clamped to the popup's range) only where the popup offers glow, i.e. the slot's material allows it; shared colours and slots that can't glow take just the colour. Hover readings run once per animation frame. The compare figure in costume can be picked from; the grey default can't.
- **Not rendered:** the engine's HDR and bloom, so glowing colours look bright but don't bleed light. Reflection and specularity options are also not shown yet.

### Body, stance and mood (`viewer/js/body-panel.js`)

The sidebar has the game's three screens as tabs: Costume, Body, and Stance & Mood.
- **Stance & Mood:**
  - The player stances (`RestrictedTo & 8`) and the 9 `Costumemood`s (Normal, Courageous, Determined, Grim, Angry, Pleasant, Pensive, Smug, Tail Idle: Low). Names come from the full message table, `decoded/messages_en_all.json`.
  - A mood adds its bits: `MOOD_ANGRY` etc. pick the `Core_Face` mood sequences, and `MOOD_TAIL_LOW` picks the tail's `Core_Tail_Lizzard_Idle_Cat`. `stances.json` has a `moods` table (skeleton → stance → mode → mood → layers) wherever a mood changes the layers, and sub-skeletons have `moodAnim`.
  - **Costume pose:** in creator mode the costume face idle (priority 4) outranks the mood faces (priority 2). The game's Stance & Mood screen handles this by clearing the costume-pose bit: UIGen calls `CharacterCreation_ForceCostumeStance(False)` (0x78db40, which sets the creator character's bit string to `COSTUME` or nothing), and its button toggles it back. The editor copies this: picking a stance or mood switches to the in-world idle, and "Costume pose" switches back.
    - Costumes open in the stance's idle, not the costume pose: the costume's own player stance, else Heroic. New costumes are Heroic.
    - While Costume pose or T-pose is on, the Stance and Mood rows stay marked but are shaded, with a note that the pose is overriding them.
    - Legs: in creator mode every stance's `Default` layer is `Core_Average_Idle_Costume`, but its `Core_Blend_Lowerbody` layer (Hips and legs) stays the stance's own (`Beast_Mode_Idle_Costume`, `Huge_Mode_Idle_Costume`…), so crouched stances put the upright costume pose on bent legs. The editor deliberately differs from the game here: Costume pose always plays the lower-body layer of the player stance shown as "Average" (`Average`, `Femaleaverage`), passed to `stanceAnimation` as `legsFrom`. `stances.json` still holds what the game plays.
- **Body:**
  - The skeleton's `ScalePreset`s. A Body or Head preset is applied on top of `Resetbody` or `Resethead` (Reset applies just that).
  - Sliders in the skeleton's player groups: Face (plus the brow, jaw and mouth BodyScale tracks), Upper Body, Lower Body, and Tail & Wings (only while one is worn). Body holds height, body mass and muscle.
  - Double-click a slider's name to reset it. "Costume values" and "Neutral" reset everything.
  - Head presets also set sliders players can't see, such as `Browy` and `Jawx`.

### Look (`build_ui.py`, `viewer/js/ui.js`)

`python build_ui.py` turns the game's own UI art (`texture_library/ui` in the archives) into `viewer/ui/*.png`:
- The costume creator's greyscale 9-slice kits (`CC_Panel_Greyscale_*`, `CC_Paddle_Greyscale_*`: a black ink outline around a white fill that the game tints) are assembled into 24×24 border-image sheets and tinted blue (panels, buttons) or gold (selected).
- It also copies the segmented slider parts (`Widgets/slider`), the colour-button frame and glow, the category header glow, the zippatone strip, and the tailor backdrop `Screen_BG_Tailor_01` (as `backdrop.jpg`).

The 3D view is transparent over that backdrop, and the floor grid is optional (View → Scene). The View options ("View → …" in these notes) are in four tabs (Light, Motion, Scene, Inspect). Their pages share one grid cell, with the others hidden by `visibility` and `inert`, so the block is as tall as the tallest page and the tab row doesn't move when switching. The last tab picked is kept in localStorage (`co.viewTab`).

**View background** (`viewer/js/backdrop.js`, View options → Scene → Background): the page's backdrop covers the whole page and the 3D view is see-through, so by default nothing changes. A colour gives `#view` its own background, so the left panel keeps the page's. With Comic art, the backdrop is turned once into greyscale art centred on mid-grey (1.5× its spread about its mean; the backdrop averages `#0f59a6`), laid over the colour with `background-blend-mode: hard-light`, fixed and covering the window like the page's so the two line up. Hard-light keeps the dots and panels on black and white too. Without it, a plain colour. The lighting, status text, grid and height marks don't change with it, and it isn't remembered. Sliders are a small widget (`gameSlider`) built from the game's bar, fill, thumb and middle-marker pieces. Two-sided ranges fill from 0 and show the marker. It works with drag and with the keyboard. The game's fonts (Blambot FX Pro, CC Dave Gibbons) are commercial, so the page uses Google Fonts' Bangers and Comic Neue in their place.

### Saved costume files (`viewer/js/costume-file.js`, `costume-hash.js`, `file-ui.js`)

The game saves costumes at the tailor as `Live/screenshots/Costume_<account>_<character>_CC_Comic_Page_Blue_<n>.jpg`. `<n>` is Cryptic time, seconds since 2000-01-01 UTC. Each file is a 300×400 JPEG of the character on the `CC_Comic_Page_Blue` cover, with a Photoshop APP13 block after the JFIF header. It is written by `0x802d20`/`0x8031e0` and read by `0x8050a0`. The block holds IPTC records:
- `2:0` = `00 02`
- `2:25` keywords `FightClub`, `FC` and `Gender:<Male|Female>` (and `Species:<name>` when set)
- `2:120` captions: account, character, and `7799` + checksum + NUL
- `2:202` the costume as Cryptic parser text: `{ CostumeV5 <Account>_<Character> { Skeleton … Part { … } … } }`. Fields are in struct order and default or zero fields are left out. Lists are written `Name  a,  b`. Floats use `%f` from 1 up and the shortest 6-digit form below 1. Enums are written by name (`ColorLink All`). The costume name is title-cased per word.

**Checksum** (`0x802f50`): over the text bytes, `a += T[byte]; b += a` (16-bit each), result `(b << 16) | a` as a signed int. `T` is the 256-entry u16 table at `0x19bf4a0`. It is printed `7799%10.10d`; the game's printf pads negatives to 10 characters including the sign (`7799-574348051`). The loader recomputes it and rejects the file on a mismatch (`0x805257`–`0x80526c`).

**Editor:**
- **Load** (or drop a file on the page) reads these files.
- **Save** asks for the account and character names and writes the same kind of file.
- A part's textures are written when set, or when its material requires them (`Requires*`); otherwise they are left empty, as the game does.
- Fields the editor doesn't handle (`Cloth`, `ControlledRandomLocks`, `Transition`, reflection and specularity in `CustomColors`, …) are kept and written back in place.

**Checked on the 37 costume files in `Live/screenshots`:**
- 36 checksums match.
- All 36 valid files load into the editor and save back byte-identical, checksum included.
- The 37th was changed outside the game, so its checksum doesn't match and the game would reject it.

### Demo recordings (`readDemo` in `costume-file.js`, picker in `file-ui.js`)

`Live/demos/*.demo` is Cryptic parser text as well. The header holds `Version 1`, `ZoneName`, `activePlayerRef` (the recording player's `EntityRef`) and similar fields, followed by `packets { … }` blocks. An entity coming into view is recorded in a packet's `createdEnts`:
- `EntityRef`, `ContainerID`
- `EntityAttach { savedName <character> … }`. For the recording player only, it also holds `CostumeData { CostumeSlot { Costume <name> { … } } … UnlockedCostume … }`, which are all of their costume slots. The slots have no names, so the picker numbers them.
- `entityTypeEnum ENTITYPLAYER | ENTITYCRITTER`
- `CostumeV5 { pStoredCostume <name> { Skeleton … Part … } }`: the costume worn. It is the same struct as a saved file's `CostumeV5` (plus `Transition`, which is kept).

A player is usually created twice with the same `ContainerID`, and the last one is used. Costumes never appear in later `updates` packets. The costume name is usually `<Account>_<Character>`, so the picker shows the account. On save, the account defaults to the one in Settings.

**Checked on 43 demos (Dec 2025 to Sep 2026):**
- All of them read in under 50 ms each.
- The recording player's worn costume matched one of their slots every time.
- One player had a `Core_Quad` skeleton. The picker lists it but it can't be loaded.

### Character sheet (`viewer/js/sheet.js`)

Settings → Export character sheet renders a 3840×2160 PNG with the page's own renderer, the same way the saved-costume preview is drawn. Every view is drawn in one go, so the pose is the same in all of them.
- **Body views:** front, left, back and right, with an orthographic camera. The vertices are sampled once, and each view's cell is as wide as the character is from that side. One scale (pixels per foot) fits the tallest and the widest views. The lights (and the reflection map) turn with the camera, through the page's `turnLights`.
- **Faces:** three close-ups stacked on the left: three-quarter from the character's left, front, and three-quarter from the right, because the two sides of a costume can differ. A perspective camera (20°) looks along the head bone's facing (tilt halved), turned ±45°, at the head piece's extent. Each is masked with a radial gradient so it fades out at the edges. The sheet has no name on it.
- **Detail:** each view is rendered at 2× (when the GPU allows) and scaled down.
- **Backgrounds:** the tailor backdrop, white, black, or "Same as view": the 3D view's background (`backdrop.js` `drawBackdrop`; the tailor backdrop when the view has its own), lettered like the blue one, or like the white one over a light colour.
- **Saving:** the browser's save dialog (`showSaveFilePicker`) is opened before drawing, while the click still counts. A download is used where the dialog isn't supported.

### Bouncers (`viewer/js/bouncers.js`)

The engine's jiggle bones, ported from GameClient.
- **Definitions** come from `DynBouncer.bin` (`DynBouncerGroupInfo` records, through `SkelInfo.BouncerInfo`). Male and female both use `Male_Bouncer`: 34 bones such as `HeadBouncer` (hair), `BackBouncer`, `ChestBouncer`, the ears and the lanterns. Each has a `Type` (0 Linear, 1 Linear2, 2 Hinge, 3 Hinge2), `spring`, `DampRate`, `MaxDist` and a `Rotation` quaternion. A QUATPYR field is a 4-float quaternion in bins, which `tools/bindecode.py` now reads.
- **Update** (`0x16ba4c0`), each frame after animation:
  1. The bone's world movement since last frame is put in the bouncer's frame: `conj(Rotation ⊗ worldRot)`.
  2. Linear types kick 1 or 2 axes by −2× that movement and offset the bone along `localRot ⊗ Rotation`, clamped to ±MaxDist.
  3. Hinge types negate it, add 0.2 on z, and kick 1 or 2 angles (`atan2(y, |xz|)`, `atan2(x, z)`). They rotate the bone by `localRot ⊗ Rotation ⊗ euler(angles) ⊗ Rotation⁻¹`, clamped to ±MaxDist° with the velocity stopped at the limit.
  4. Each axis is one RK4 step (`0x16ba2c0`/`0x16ba250`) of `x'' = −spring·x − DampRate·x'`, with dt capped at 0.05 s.
- **Helpers:** the quaternion product (`0x110d360`), vector rotation (`0x7551d0`) and pitch/yaw/roll → quaternion (`0x110c7a0`) are ported. Engine quaternions are the conjugates of three.js's, so the maths runs in engine convention.
- **Result:** in the creator's idle, hair and ears move 1–2°; bigger swings come from moving the character (View → Shake).
- Cloth pieces are not bouncers; see Cloth below.

### Materials (`viewer/js/shader-graph.js`, `tools/matunpack.py`, `tools/shaderops.py`)
A costume material's `Material` (catalog `shader`, e.g. `Avatar_Metal`, `Costume_Fx_Fresnel_Ghost`) names a graphics material in `bin/Materials.bin`: a **shader template** plus the values its operations take.
- **Materials.bin:**
  - It starts with 174 `ShaderTemplate` records as plain structs. Each is a graph of operations (Texture, ColorTint4b, MaskCombine, FresnelTerm, Specular…) wired into an `Output`, with `Flags` (2 NoAlphaCutout, 32 AlphaPassOnly, 64 NO_NORMALMAP…) and `Reflection`.
  - The 9,463 materials follow in a `SerializablePackedStructStream`: a shared string table and a bit-packed block. `tools/matunpack.py` decodes them all (format in its docstring, from `structpack.c` / `bitstream.c` in `GameClient.exe`) to `decoded/materials.json`.
  - Material `GfxFlags`: 1 Additive, 4 DoubleSided, 8 NoZWrite.
- **Operations:** `shaders/Operations/*.op` define each operation's inputs, defaults and outputs (`tools/shaderops.py` parses them). `shaders/D3D/ops/*.phl` hold their HLSL.
- **Build:** `build_web.py` writes `data/catalog/shaders.json`: the 273 costume shaders, their 27 templates, the 39 operation types they use, and images for the textures they name. Effect textures (`fx/...`) that the costume extraction skipped are pulled from the texture hoggs at build time.
- **Viewer:**
  - Each template is compiled once to GLSL, one block per operation written from the game's HLSL. Unconnected inputs become uniforms (material value, else the template's fixed value, else the default), so materials that share a template share a program.
  - The `Output` drives the game's lighting model (`LightingModels/Standard.LightingModel`, `ops/Output.phl`) on three's Phong lights:
    - `albedo = lerp(LitColor, LitColor·refl, RW·(1−add%))`;
    - `unlit = lerp(Unlit, Unlit·refl, …) + RW·add%·refl`;
    - specular `SpecularValue·SpecularColor·pow(L·R, 128·SpecularExponent)`.
  - Colours are computed in the game's gamma space, then converted to linear.
- **Costume inputs** (`0xcd0570`, `0xcd0700`):
  - The costume's textures replace the material's placeholders by name (CostumeTexture `OrigTexture`: `Default_Color_Mm`, `Default_Detail_N`, `M_Chest_Tight_01_N`…).
    - A texture the material requires (`RequiresPattern` etc.) but neither the part nor the material's defaults name is drawn as the material's first texture of that kind (`drawnTexture` in `catalog.js`). 1,728 materials require a pattern, list exactly one and set no default, and saved costumes do leave it empty: the Cosmic helmet's Shiny Metal (`M_Helmet_Face_Cosmic_01_Avatar_Anisotropic_02`) in one of the regression costumes shows its Basic pattern in game. Before, those pieces drew the placeholder `Default_Color_Mm`, with the colours in the wrong places. Saving still writes the field as the part holds it, so costumes save back unchanged.
  - **IsDXT5nm** (`TextureNormalDXT5nm`, used by the Brushed / Shiny Metal template `4color_Spec_Reflect_1normal_Nx_Anisotropic`) is a hidden input the engine sets from the bound texture (`TextureNormal_IsDXT5nm`); the `isdxt5nm 1` the materials store is their placeholder's. Costume normal maps are uncompressed RGB (5,967 of them; the install's only DXT5nm texture is `system/Templates/Default_Dxt5nm_N`, a DXT5 file with header flag byte `0x03` where normal maps have `0x01`), so the viewer sets it per bound texture, 1 only for a DXT5 one (`setGraphTexture`). With the stored 1, the missing alpha was read as X: every normal tipped onto three's per-triangle tangent, and those metals drew faceted and nearly black.
  - The `Color0` operation and the `Color1`–`Color3` ColorValues take the costume colours (skin and glow as in Colouring).
  - **Tint:** `Output.phl` multiplies every material's unlit colour and albedo by `v.color0`, and alpha by its alpha, unless the template defines `HANDLES_COLOR_TINT` (only the debug views do). `v.color0` is the draw's `color0` constant (`vs_inc.hlsl getColor0`), which is also what the `Color0` op's default input reads.
    - The viewer tints templates that take no costume colours (no unconnected `Color0` input, no `color1`–`color3` op) by the part's Color0. That covers every Fx material: Psionic, Holoforce, Fire, Ooze, Shadow, Glass… The others get white.
    - A black Fx piece is therefore invisible, which players use on purpose (black Psionic). View → "Show hidden psionics" draws those untinted.
- **Colour regions** (View options → Inspect; `options.rawMask`, uniform `coRawMask`): the first ColorTint4b in a template records its region colour (`REGION_GLSL` in `costume-material.js`: the same weights as the tint, w0 for colour 1 and R/G/B for 2–4, with the four slots as gold, red, green and blue, grey where the mask's alpha leaves the texture's colour). With the option on, that colour replaces the albedo, and glow, reflection and specular are dropped, so the piece shows flat, lit for its shape. Templates without costume colours (Fx) show as colour 1, which tints them whole. Before the shader-graph port this was "Raw masks" (the mask's RGB) and did nothing on graph materials.
    - The rule is inferred from the shaders plus in-game observation. Where the engine sets the draw colour for costume parts hasn't been traced.
  - `MuscleWeight` takes the muscle value.
  - Materials with custom reflection or specularity write `defaultReflection` / `defaultSpecularity` bytes ÷ 100 over `ReflectionWeight` / `SpecularWeight` (`0xcd1e80`).
- **Blending:**
  - Additive materials, and templates with screen refraction (ghost), add light and leave the canvas alpha alone.
  - AlphaPassOnly templates, and NoAlphaCutout ones with an alpha output (glass, ice), alpha-blend.
  - Depth is written unless the material has `NoZWrite` (GfxFlags 8), blended or not. So an ice or glass body (Ice_04: flags 4) hides its own farther parts whatever order three.js sorts the parts in. Psionic and Holoforce (flags 9) don't write depth.
  - The rest alpha-test at `AlphaRef` (0.6).
- **Not the game's:**
  - Screen refraction: the refracted background is drawn as the background itself, via additive blending.
  - The runtime values of oscillators (`1 + A·sin(2π·f·t + phase)`; the materials store 1 as the idle value), scrolling (rate × seconds) and TimeGradient (its maximum).

### Cloth (`viewer/js/cloth.js`)

Capes, cloth skirts, scarves and similar pieces (214 player pieces) use the game's own cloth system (`dynCloth*.c` in `GameClient.exe`), not PhysX.
- **A cloth piece** is a coarse mesh; a cape is a 9×9 grid with 128 triangles, modelled as a flat panel. Each vertex's weight on the `Cloth` pseudo-bone (`dynClothBuild` `0x16b9650`) says how free it is: 0 = held by the body, 1 = free. On a cape only the shoulder points of the top edge are held, so the panel is meant to fall and drape.
- **Data:**
  - `CostumeGeometry.ClothData` names each piece's `DynClothInfo`: stiffness, drag, min/max weight, gravity scale, `ClothBoneInfluenceExponent`, particle collision radius, tessellation and wind. Those come from `DynClothInfo.bin` (16).
  - It also names its `DynClothCollision` set (`DynClothCol.bin`, 62): shapes on bones. The type enum is Sphere, Plane, Cylinder, Baloon and Box; player sets use cylinders, each with bone-space `Offset`/`Direction`, `Radius`, the stretch −Exten1…+Exten2 along the axis, `MovingBackwards` and `InsideVolume`.
  - All of this is in the catalog (`cloth` on geometries, `clothInfos`, `clothCollisions`).
- **Ported:** the Verlet step (`0x169d550`): `next = pos + (pos − prev)·(1 − Drag) + a·dt²`, gravity `GravityScale × 10` ft/s². `S+0x180` is Stiffness and `S+0x184` ClothBoneInfluenceExponent (`dynClothObjectSetup` `0x16b9970`).
- **Wind (ported from the same step):** the per-cape wind fields are copied onto the cloth by `dynClothObjectSetup` and the wind is handed over by `0x15ff560` → `0x169cc00`.
  - Every frame the game samples its world wind grid (`dynWind.c`, 5 ft cells) at the character. It splits the sample into a direction and a speed, and multiplies the speed by the piece's `WindSpeedScale`.
  - In the step, the wind is a steady acceleration `direction × speed × 10`, alongside gravity.
  - It also makes a travelling ripple: each particle gets a push along its normal of `sin((dot(p − root, D) − 20·WaveTimeScale·t)·WavePeriodScale) × |N| × dt × 0.05 × WindRippleScale`.
  - `NormalWindFromMovement` and `FakeWindFromMovement` add wind from the character's own motion (both 0 on player capes).
  - The world wind comes from each map's sky (Speed 0–10, variation, direction, change rate). View → Wind / Direction / Gusts set it here. (The skies are in `bin/Skies.bin` after all, and `Master_Exterior` has a wind: see "Creator lighting" below.) The default is no wind (capes hang still), and the gust pattern is the viewer's own.
- **Two solvers** share the particles, skinning, wind and drawing (`ClothBase` in `cloth.js`). The editor uses `GameClothSim` (`viewer/js/cloth-game.js`), which follows the game's solver as traced below. The earlier `ClothSim` is kept but no longer offered on the page (it had a View → Game cloth switch while the two were compared): `Character.options.gameCloth = false` picks it for new pieces, and `Character.setClothSolver(false)` rebuilds the loaded cloth with it.
- **The earlier solver (`ClothSim`), written here before the game's was traced:**
  - distance constraints on mesh edges, plus bending constraints across edge-sharing triangles at strength `Stiffness`;
  - particles at or below `MinWeight` follow the skinned body; between Min and Max they are pulled toward it by `(1 − t)^exponent`;
  - cylinder and sphere push-out with the particle radius;
  - `MovingBackwards` shapes are skipped (the creator character stands still);
  - a particle that starts inside a shape (e.g. the cape's top edge inside the "ceiling" cylinder above the shoulders) is exempt from that shape;
  - it runs in world space at a fixed 1/60 s step and settles for 1.5 s when a piece is loaded;
- **Drawing (both solvers):** pieces whose `DynClothInfo` has `Tessellate` set (Cape_Default, Cape_Heavy…) are drawn through two levels of Loop subdivision (`viewer/js/cloth-tess.js`). A cape goes from 128 to 2048 triangles. The simulation still runs on the coarse particles: the fine vertices are a fixed weighted sum of them, and normals are welded across UV seams so the surface shades smoothly. The game's own tessellator is not ported; Loop is a standard scheme with a similar result. `Notessellate` pieces are drawn coarse, as in the game.
- **Cost:** three cloth pieces take 0.2 ms per frame with the earlier solver, about 0.12 ms with the game's (one constraint pass). View → Cloth turns it off for pieces loaded afterwards; they then keep their modelled shape.

#### The game's solver, traced 2026-10-02 (`cloth-game.js`)

Read from `GameClient.exe` (`dynCloth*.c`) and described here in our own words. `cloth-game.js` is written fresh from these notes, not copied. It departs from the game in two ways: a steady 60 steps a second (the game takes one per frame, so its cloth runs faster at high frame rates), and no sleep. The drawing is still our Loop smoothing.
- **Corrects the "ported" note above:** gravity is `GravityScale × 32` ft/s² (`0x15ff1d0` stores −32 at cloth `+0x174`; `+0x1c0` is GravityScale). The ×10 is the wind only. Each step lasts a fixed `0.01 × TimeScale / NumIterations` s of cloth time, whatever the frame time (`0x169f660`).
  - Steps per frame: `round(frameTime × 60)`, at least 1 and at most 4 (`0x15ff560`). Each step runs NumIterations sub-iterations, clamped to 1–8 (`0x15ff450`).
  - So at 60 fps a cape gets one 0.01 s step per frame, and gravity moves a particle `3 × 32 × 0.01²` = 0.0096 ft per step². Ours, 30 ft/s² at 1/60 s, gives 0.0083, which is close by chance.
- **Particles** (`dynClothBuild` `0x16b9650`, `0x16b87b0`):
  - Each vertex's weight `w` on the `Cloth` bone is its mass, and its inverse mass is `1/w`. A vertex with no Cloth weight has inverse mass 0 and is pinned.
  - **MinWeight and MaxWeight aren't read** by any code traced.
  - Every particle is hooked to its own skinned vertex (the "attach harness", `0x16b9030`: one eyelet per particle).
- **Per step:**
  1. **Targets** (`0x169da00`). Each particle is pulled toward its skinned position by `(1 − w)^ClothBoneInfluenceExponent`: fully for pinned particles, not at all for `w = 1`. Its velocity is cut by the same fraction. During sub-steps the target is interpolated across the frame.
  2. **Verlet** (`0x169d550`). The velocity is multiplied by `(1 − Drag/NumIterations) × w^exponent`, so partly held particles move sluggishly. The step then adds gravity and wind. `Stiffness > 1` (only possible with `AllowExtraStiffness`, which no player cloth has) would also blend toward the rest shape.
  3. **Collision** (`0x169d2d0`), before the constraints:
     - Each shape is applied up to 5 times.
     - The push-out is scaled by `w`, so partly held particles give way only partly.
     - Contact depth over the particle radius, capped at 1, is kept per particle (`+0xc4`). It reduces that particle's inverse mass in the constraint pass by `1/(1 + 0.1·depth²)`.
  4. **Constraints** (`0x169eb80` → `0x16c73e0`):
     - One Gauss–Seidel pass over every constraint, with no extra iterations.
     - The correction is weighted by inverse mass (`1/w`, so particles near the pins are the light ones) and scaled by `Stiffness`, clamped to 0.001–1, and by `1/NumIterations`.
     - Rest lengths are multiplied by the character's scale relative to the scale at build time (average of x, y, z).
  5. **Seam duplicates** (UV splits within 0.001 ft) are averaged together after the constraint pass.
- **Constraints built** (`0x169c3a0`, `0x16c7310`):
  - Every triangle edge, at **0.99×** its modelled length (×1.1, then ×0.9 for all).
  - The two vertices opposite each shared edge ("stiffness connections", LOD 0–1 only), at **1.089×** their modelled distance. A flat panel can't reach that, so these links keep pushing the cloth open and flat. That is the game's resistance to folding: the cloth flares rather than creases.
  - All constraints are two-sided. The solver also supports one-sided "keep apart" constraints (negative rest length), but the build doesn't create any.
- **Collision shapes** (`0x16af0c0`, `dynClothCollide.c`):
  - They are built each frame from `Point1`/`Point2` (`Offset ∓ Direction × Exten`) on the bone. The radius is scaled by the bone's scale across the axis, and the previous frame's shape is interpolated through sub-steps.
  - **Cylinder (3)** is a capped cylinder. A particle inside is pushed out through the nearest surface, side or end cap, whichever is closer. So the big cylinder above the shoulders acts as a ceiling that cloth can't rise into. Ours pushes sideways only, which is why we needed the "exempt" rule.
  - **Baloon (4)** is a capsule. **Sphere (1)** pushes out radially.
  - `MovingBackwards` shapes are switched on only while moving backwards. Player sets use only types 1 and 3, and none of them uses `InsideVolume`.
- **Sleep:** when the average particle movement stays under 0.0001 for 0.2 s, physics and constraints stop and only collision runs (`0x15ff560`).
- **Drawing:**
  - `Tessellate` splits each triangle into four at its edge midpoints. The midpoints sit on the straight edge, with averaged normals (`0xf2b370`). It smooths the shading, not the silhouette.
  - Normals are an equal-weight average of the face normals.
  - D3D11 builds also have hardware PN-triangle tessellation (`standard_hull_shader.hhl`). Whether cloth uses it wasn't traced.
- **Differences from ours that matter for the look:**
  - We pin `c ≤ MinWeight` hard and ignore the `w^exponent` damping.
  - We run 4+ relaxation passes on two-sided bends at 1.0×. The game runs one pass, with edges at 0.99× and opening links at 1.089×.
  - We push out of cylinders radially only, and collide inside each iteration rather than once before the constraints.
  - We ignore the character's scale, and our Loop subdivision rounds off and slightly shrinks the outline.

### Creator lighting, traced 2026-10-02 (`shader-graph.js`, `lighting.json`)

- **The creator's sky is in the client data:** `bin/Skies.bin`, table `SkyInfo`, holds 450 skies, including `Sky_Player_Costume_Creator`, `Headshot_Sky` and `Master_Exterior`. The exe names it as the costume editor sky (`CostumeCreation_SetSky`). Its values (HSV, where V can exceed 1 as an intensity):
  - ambient (0, 0, 0.5);
  - sky light (219°, 0.5, 1.0); no ground or side light;
  - key "diffuse" (26°, 0.2, **1.7**), a warm white;
  - secondary diffuse (32°, 0.75, 0.5), an orange fill on the side facing away from the key;
  - specular (219°, 0.33, 1.0);
  - character backlight (220°, 0.6, **1.8**);
  - background (211°, 0.68, 0.5);
  - **Exposure 1.3**, LightRange 3, LightAdaptation 0.4;
  - bloom (rate 1.1, range 8);
  - one luminary, the sun: SkyDome `default_sun`, Angle 150°, RotationAxis (10, −2.5, −3).
- **Sun direction** (`0xf389e0` → `0xf38c40`): a luminary circles its sky's RotationAxis `d`. With `u = normalize(Y × d)` and `v = normalize(d × u)`, the direction toward it is `normalize(cos θ·u − sin θ·v)` (plus the dome's Position / 8000), where `θ = Angle + 90°`. With no luminary, it is `(−1, 1, 1)` normalised.
  - The creator's sun is toward (0.34, 0.84, 0.42) in the game's space: 57° up, in front of the character (+Z), on the viewer's left. That assumes the creator character faces +Z, as the viewer's does.
- **Colours:** HSV → RGB in the usual way, with V as the brightness (`build_web.hsv_rgb`), plus the sky's character-lighting HSV offsets (all 0 in the creator sky).
- **`lighting.json`** (`build_web.lighting_json`, from `bin/Skies.bin`) holds these as RGB in the game's gamma space, the sun direction in game space, and Exposure, LightRange and LightAdaptation.
- **`Master_Exterior` also has wind:** speed 1.5 ± 1.5, direction (0.707, 0, 0.707), turbulence 0.5. The creator sky sets no wind, so this may be what the creator uses.
- **Light model** (`LightingModels/Standard.LightingModel`, `light_inc.hlsl`, `vs_inc.hlsl`):
  - **Key light:** `d = N·L` is wrapped by the material's light bleed (`d·bleed.y + bleed.x`). The lit side gets `key × saturate(d')`; the side facing away gets `secondary × saturate(−d')`.
  - **Specular:** `pow(saturate(L·R), 128·SpecularExponent) × specular colour`.
  - **Hemisphere:** `lerp(ground, sky, 0.5 + 0.5·N·up)`, plus `side × (1 − |N·up|)`.
  - **Ambient:** `ambient × AO × albedo`, faded by `1 − saturate(0.5 × key intensity × exposure)`.
  - **Backlight**, two kinds:
    - The `BacklightInShadow` template flag (`0x1000`) adds `in_shadow × backlight × lerp(1, albedo, 0.5) × a view-angle term` in the lighting model. None of the costume templates set it.
    - The `Backlight` template define (`ShaderGraph.Defines`; matched regardless of case, like `No_Delta_Normal_Ao`). The 4color mask templates set it, and they feed `CharacterBacklightColor` and `LightBleedTransform(0.6)` into Output's BackLightColor / BackLightBleed. `Output.phl` first applies `unlit *= unlit·0.65 + 0.35`. After lighting it does `colour *= 1.8·dot(normalize(N + (0, −0.65, 0)), V)` (view space), which brightens what faces the camera by up to about 1.6× and darkens the silhouette. Then `colour += backlight × (0.35 + albedo) × saturate(−N·V × bleed.y + bleed.x)`, a blue rim. This is much of the game's look.
  - **Template flags:** 1 HAS_BUMP, 2 NoAlphaCutout, 8 NoHDR, 0x20 AlphaPassOnly, 0x40 NO_NORMALMAP, 0x80 NoTintForHDR, 0x100 AllowAlphaRef, 0x200 UseAmbientCube, 0x400 AllowRefMIPBias, 0x800 AlphaToCoverage, 0x1000 BacklightInShadow, 0x2000 UnlitInShadow.
  - **AO** (no vertex colours on costumes) is the normal map's `saturate(N · geometric normal)`. The hemisphere direction is taken as world up (`sky_dome_direction_vs` wasn't traced).
- **Exposure** (`0xf8cdf0`, `0xf8d090`) is auto-exposure:
  - The target is `lerp(LightRange, 2 × measured scene luminance, LightAdaptation) / Exposure`, approached at `LightAdaptationRate`. The base (`+0x304`) is the sky's LightRange, or 2 when it has none (`0xed1760`).
  - The output is multiplied by `1/target` (`exposure_transform.x`; this is the non-HDR form, and HDR mode rescales for its buffer and tone-mapping pass).
  - The editor takes the scene's luminance as 0.35 (`SCENE_LUMINANCE`), which gives `1.3 / (0.6·3 + 0.4·0.7)` ≈ **0.625**. The lights' 1.7 key, 0.5 ambient and 1.0 sky add up to well over 1, so this brings them back down.
- **Reflection map (used):** the creator's sky names no `ReflectionCube`, so the game falls back to its default, `TerrainTest_cube` (`texture_library/system/cubemaps`: a 128² DXT1 cube with mips, cloudy blue sky with a sun glow, dark below). The default is chosen in sky blending (`0xf396c0`) and at material binding (`0xfaf4c0`): the material's own texture, then the sky's, then the default. The ambient cube defaults to `default_ambient_cube`. `ReflectionSimple` materials use the matching `_spheremap`.
  - The reflection is sampled with the world-space reflection vector and multiplied by `ReflectionColorMask`. It is then brought into HDR space (`× exposure_transform.y`, `Output.phl`), so the final exposure leaves reflected sky at its own brightness.
  - The editor uses it (`shader-graph.js` `setGameReflections`; `dds.js` reads DDS cube maps). The faces go up as stored, since D3D and WebGL lay cube faces out alike, and the direction has X mirrored back to the game's space. With the game's lighting the reflection is divided by the exposure (`y = 1/x`); with the earlier lights it isn't.
  - The earlier plain sky/ground gradient is kept (`setGameReflections(false)`), no longer offered on the page; it had a View → Game reflections switch while the two were compared. A region of the creator map could override the map; nothing traced suggests it does.
- **In the editor** (`shader-graph.js`), the graph materials replace three's lighting with this model, computed in the game's gamma space and converted to linear only for output. The uniforms are shared (`LIGHT`), filled from `lighting.json`.
  - View → Light → **Lighting** (on by default) chooses this model; unticked, the graph materials use the earlier three.js Phong lights: a white hemisphere light (1.4), a white key (2.2) and a blue rim (1.0). Those lights also light the non-graph materials (the grey compare figure, the ruler) either way.
  - **The lights turn with the view.** The creator turns the character in front of a fixed camera and fixed lights; the editor orbits its camera instead. So every frame the page (`turnLights` in `index.html`) turns the sun, the reflection map (`turnLighting`, the `coTurn` uniform) and the Phong key and rim about the vertical by the camera's yaw around its target. Looking from any side shows that side lit as the front is, as on a turntable. Only yaw turns them: orbiting up or down leaves the sun where it is, and the hemisphere's up is still world up. The character sheet turns them per view the same way.
  - The View → Light sliders set the sun (`setSun`; `getSun`, and `lightingReady` resolves to the creator's): direction round from the camera and angle above level (in the viewer's space, before the turn), brightness, and colour. The colour is the key light's at full strength, normalised to its brightest channel (the creator's is #ffe2cc at 1.7). The specular light is tinted by the same per-channel ratio to the creator's colour, and both scale with the brightness. The ambient, hemisphere, secondary (shadow-side) and back lights stay the creator's. The block is greyed out (inert) with Lighting unticked, since the Phong lamps don't follow it. It isn't saved between sessions. The character sheet uses whatever is set.
  - Not yet: bloom, the auto-exposure's frame-by-frame measuring, shadows, fog, and the halftone model.

## File formats

- **.wtex** = `u32 header_size` + Cryptic header + a standard DDS (DXT1/DXT5 or BGRA/BGR).
- **.mset** (`tools/mset.py`): a big-endian header lists models and their LOD blocks. Each LOD block has a 46-word header with vertex/triangle counts and 12 stream slots `(compressed, unpacked, offset)`, followed by zlib streams.
  - A stream with `unpacked > 0` uses City of Heroes-style delta coding (2-bit codes, then 1/2/4-byte deltas and a float scale). One with `unpacked < 0` is a raw little-endian array.
  - Slots: tris, positions, normals, tangents, binormals, uv0, uv1, ?, weights (4×u8), bone indices (4×u8, stored ×3), morph positions/normals.
  - Meshes are in character space, in bind (T) pose. Bone names come from `ModelHeaders`.
- **Colouring** (`shaders/D3D/ops/ColorTint4b_IgnoreAlpha.phl`, used by the `4color_*` templates in `Materials.bin`): `tint = (1-R-G-B)*Colour0 + R*Colour1 + G*Colour2 + B*Colour3`, then `lerp(1, tint, mask.a) * Diffuse`. The colour constants are built by the engine at `0xcd1110`–`0xcd1350` and `0xcd1d10`: `ColorN = Color_N / 255`; if `glowScale[N] > 1` the colour's HSV value is multiplied by it (glow is just an overbright colour); and on skin materials (`HasSkin`, costume `ColorSkin` set) `Color3`, the mask's blue region, is the skin colour, without glow. The data had pointed the same way before the port: skin-material default patterns are mostly blue, and costumes store the skin tone in `Color_3`. The weight constants (`MuscleWeight` etc.) are written in array order and combined with `dot([r, g, b, 1-r-g-b], weight)` (`shaders/D3D/ops/MaskCombine.phl`), so `SuppressMuscle[0]` goes with the red channel.

### Skeletons and poses

- **Skeleton lookup**: PlayerCostume `Skeleton` (Male/Female) → `catalog/skeletons.json` `Skeleton` (Coredefault/Core_Female) → `SkelInfos.bin` → `animation_library/skeletons/<...>.skel`.
- **.skel** (`tools/skel.py`): header name, then bones as `u32 len, name, NUL, f32 pos[3], f32 quat[4] (w = -1 for identity), u8 flags`. Flag bit0 means "another sibling follows" and bit1 means "has children". Each parent's children are written as one run of siblings, and parents are expanded LIFO.
- **Skinning**: each `.mset` vertex has 4 bone indices (stored ×3) into the ModelHeader's `bone_names`. Names are matched case-insensitively to skeleton bones. The meshes are already in bind space, so the bind matrices are identity.
- **.atrk** (`tools/atrk.py`, ported from `GameClient.exe` with `tools/disasm.py` + capstone): `u32 -1, u32 version (200), name, u32 compressed, u32 bone_count`. Each bone has `u16 const_mask, u16 anim_mask`, a float per constant channel, and per animated channel `f32 base, f32 scale, u32 zsize, zlib`. A `u32 frame_count` ends the file.
  - Channel bits 0–2 are rotation, 3–5 translation offset and 6–8 scale.
  - Each animated channel is `2 × nextpow2(frames)` u16 values. `q = 0` means 0.0; otherwise the value is `base + (q-1)·scale`. These coefficients go through one level of inverse CDF 9/7 lifting (`0x18e75d0`), and the first `frames` samples are kept.
  - Rotation (x, y, z) becomes a quaternion using `Euler(x, -y, z, 'YZX')` (`0x15c9a60`). The engine's matrices use the conjugate, so three.js needs `conj(q)`, applied on top of the bind rotation.
  - The data is left-handed. The viewer poses the character in game space and mirrors X at the end.
  - Files with `compressed = 0` (2,562 files, ported from `0x15c8fb0`) store per-bone `u32 posKeys, u32 rotKeys, [u32 scaleKeys]` followed by keys: `(u32 frame, f32 x, y, z)` for position and scale, and `(u32 frame, f32 qx, qy, qz, qw)` for rotation. Version ≥ 160 adds a `u32` data size before the bones. Keys are interpolated (lerp/slerp).
  - All 6,657 `.atrk` files parse.
- **Stances** (`tools/stances.py`) resolve through this chain:
  1. The stance's `Bits` plus a mode bit: `Costume` in the character creator, `Idle` in the world.
  2. `SkelInfo.BlendInfo` gives the sequencers. `Default` drives the whole body, and `Core_Blend_Lowerbody`, `Core_Face` and `Core_Basebone` each own listed bones. A sequencer's sequences are the `.Dseq` files in `Dyn/Sequence/<sequencer>/`.
  3. Within each sequencer, the `DynSeqData` whose `requiresBits` are all active wins, by highest `Priority`.
  4. The action whose `FirstIf` holds is chosen, then the `DynMove` whose `UseIf` holds.
  5. The `DynMoveSeq` variant is the first one matching `SkelInfo.SeqType` (Female tries `Core_Female` first, then the male variants).
  6. That variant's `AnimTrackName` is the `.atrk` to play.

  `rig_data.py` writes `viewer/data/stances.json` and one pose file per unique track. The viewer plays the layers together, each looping independently.
- **Translation keys:** body tracks are shared across skeletons (female characters play male tracks), so the viewer uses only Hips/Base translation from them. Their other per-bone offsets are skeleton-specific: the female idles' Jaw key opened the mouth, and foot keys sank the feet. Face-layer tracks keep all offsets, because they animate the lips and brows by translation. This rule is inferred from the data, not ported from the engine.
### Body sliders

These are exported by `body_json()` in `rig_data.py` and applied by `computeBody` and `applyBodyMatrices` in `viewer/js/rig.js`. The rules are ported from GameClient.

- **Sliders:** `PlayerCostume.ScaleValues` (name → −100…100) map through the skeleton def's `ScaleGroup[].Scale[].Affects` to `(scale group, axis)` pairs. Each group input on each axis is `value/100`, clamped to −1…1, as the engine's "Invalid BodyScale… must be between -1 and 1" check does. Stored values fall within ±100 in nearly all of the 17k costumes. `Include` groups receive the input × fraction.
- **Per-bone values** (`0x158cc90`, wlSkelInfo.c). Groups come from `ScaleInfos.bin` (`SkelScaleBone`: Small/Large Min/Max, `CounterScale`, `Universal` at +0x38, `Translation` at +0x39).
  - Min/Max are blended by body mass: `lerp(Small, Large, mass)` (`0x8c32b0`).
  - The value on an axis is `lerp(neutral, Min, −v)` below 0 and `lerp(neutral, Max, v)` above (`0x158cac0`). Neutral is 1 for scale and 0 for translation.
  - Each bone collects three things in a `DynScaleCollection` entry (0x28 bytes). `Translation` bones add to **T**, `Universal` bones multiply **B** (+0xc), and all other bones multiply **A** (+0).
  - A `Universal` bone multiplies each of its `CounterScale` bones' B by `1/B` (its own B at that moment). Groups are walked last bone first.
- **Scaled base skeleton** (`0x15320d0`, dynSkeleton.c), built per character from the root down:
  - Scale tracks are applied first (`BodyScale[i]` samples its `.atrk` at frame `value/100 × (frames−1)`): scale multiplies the local scale, position adds and rotation multiplies.
  - Then local scale = `scale / A(parent) × A × B`, and local position += T. Children therefore divide A back out but inherit B and the tracks' scale.
  - The female Bodymass track `Core_Female/Core_Female_Scale` is not installed. The viewer substitutes the scale channels only of `Coredefault/Scale/Core_Muscle_Female_Scale`, marked "(approx.)".
- **Node transforms** (`0x15204d0`, dynNode.c) keep position, rotation and scale separate. World scale = local × parent's, per axis. World rotation = parent's × local. World position = parent's + parent's rotation applied to (local position × parent's world scale). There is no shear. Tail and wing sub-skeletons hang off their attach bone the same way, so they inherit its scale.
- **Skinning** (`0x164e4c0`): `T(world position) · R(world rotation) · S(world scale)`, then the bind position is taken off. The base skeleton's bind rotations are all identity (checked for all 221 female bones), so three.js's bone inverses give the same result.
- **Height:** uniform scale `Height / HeightBase` (6 ft).
- **Grounding:** the root is lifted so the bind-pose soles keep their height. The engine computes `(Hips.y − Sole_R.y) / Hips.y` for this (`0x15326b0`), but how it applies that hasn't been traced, so this part is still my own equivalent.
- **Muscle** is shading, not geometry. It is ported from the engine: the material setup at `0xcd0700` and the `4color_*_Mask` shader templates.
  - `MuscleWeight[i] = PlayerCostume.Muscle / 100`, set to 0 where the material's `ColorOptions.SuppressMuscle[i]` is set.
  - `muscleN = lerp(flat, Muscles, clamp(dot([mask.rgb, 1-r-g-b], MuscleWeight)))`. The detail normal is then expressed in `muscleN`'s frame (the `NormalAdd` op).
  - The `Muscles` texture is the pattern's `*_Muscle_N` extra if it has one. Otherwise it is the material's default, which is the base body normal (e.g. `F_Chest_Tight_01_N`) that muscle extras replace. Materials whose texture lists never mention a muscle map get none, because their `.Material` source files aren't shipped.
  - The viewer composes this per part on the CPU (`composeNormal`).

- Note: `.bin` files differ in which fields they strip. Client bins (messages, costumes) omit fields with `hi & 0x400`, while `DynMove.bin` keeps them. See `Decoder(skip_hi=...)`.

## Known gaps

- 59 geometries have no mesh: 57 weapons, an NPC barrel and an empty placeholder. None of them is in the patcher's manifest (`Live/.patch/FightclubClient.manifest`), so the game doesn't ship them either. About ten are naming slips that a file with an `_01` suffix (or without a leading `_`) would answer, e.g. `Weapon_Dagger` → `weapon_dagger_01.mset`; the rest look like retired weapon definitions. Every texture is found (the one without an image is the `None` placeholder).
- Item definitions (reward and store item names) are server-side, so unlock sources come from the unlock-costume folder names. Costume sets use `PermTokenTypePlayer(...)` expressions.
- Cloth is simulated with the game's settings but not its exact solver; tessellation uses Loop subdivision rather than the game's own scheme, with the particles held by the body and the mesh's corners kept in place (plain Loop smoothing rounds the cape's top corners off the shoulders). The cloth's response to wind is ported, but the wind itself (speed, heading, gusts) is set in the viewer, since the creator's sky wasn't found at first; it's in `bin/Skies.bin` (see "Creator lighting"). Sub-skeleton bouncers (`Core_Tail_Lizzard_Bouncer`) are not run; no player mesh is weighted to them.
- Materials use the game's shader graphs and lighting model with the creator sky's lights (see "Creator lighting"); the exposure is fixed (the scene's luminance assumed), bloom isn't drawn, screen refraction is approximated by additive blending, and the runtime formulas of oscillators and scrolling aren't ported. The per-part custom reflection / specularity a saved costume can carry (kept as-is in `customExtra`) isn't applied yet; the material's defaults are.
- Weapons and the vehicle bike are left out: the Weapons region, the 'Attachment Weapon' slots and the Vehicle Bike Attachpoint slot with its attachments (`*_Vehicle_Attach*`) aren't offered or drawn (`rules.isLeftOutBone`; `build_index.py`, `costume_check.py` and `tests/run.py` follow the same rule). A loaded costume's parts there stay in the document, so saving keeps them.
- `ExcludedCategories` (used only by deprecated categories) is not enforced.
- Pieces weighted to helper bones follow the body sliders as the game computes them (ported 2026-09-30). The earlier model cancelled CounterScale only for the bone itself, and left the body-mass track's scale uninherited. With that model, Webwork's `M_Back_Holoforce_Arachnid_02_F` (blended `Ribs` / `Muscle_Lat01_L/R` / `HeadBouncer`) came apart under her waist and head sliders. What remains is `Player_Chest_Length −50` squashing `Ribs` to 0.8 height, which is also what the game computes. This hasn't been compared with an in-game screenshot.
