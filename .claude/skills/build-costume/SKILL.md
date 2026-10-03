---
name: build-costume
description: Build, preview and refine a Champions Online costume from a description ("make me a cowgirl", "make her a space cowboy", "more glow", "make her a dragonkin"), or restyle an existing character from a dropped-in Costume_*.jpg (the costume is in its metadata). Covers finding pieces in the index, colours and glow, loading into the running editor, and the close-up clipping check that must pass before showing the user.
---

# Building a costume from a description

The user describes a character; you pick pieces from the index, write a costume JSON, check it, load it in the
editor in the browser pane, inspect it close up for clipping, fix, and only then show it. The user saves it to
the game themselves with **Save** in the editor.

## Running the editor's scripts

Start the editor for yourself with `preview_start` (see "Check, then preview"), not `start.bat` or the program:
those open their own window for the user, and the program quits when that window closes. The commands below say
`python ...`. In the release, `CO Costume Editor.exe` carries its own Python, so when `python` isn't installed
(`python --version` fails), run the same scripts through it, from the editor's folder:
`"./CO Costume Editor.exe" costume_check.py ...`, and preview with `costume-viewer-app` instead of `costume-viewer`.

**Installed editor:** when this folder has no `serve.py` but has a `CLAUDE.md`, you're in the installed editor's
data folder (`%LOCALAPPDATA%\CO Costume Editor`): `index/` and `my_costumes/` are here, the program and its
scripts are in the folder `CLAUDE.md` names. Run every script through the program by its full path, from here:
`& "<program folder>\CO Costume Editor.exe" costume_check.py my_costumes\<name>.json` (it finds the script in
its own folder; the file paths are from here). `costume_to_json.py` is at
`.claude\skills\build-costume\costume_to_json.py` here; give the program that full path. `preview_start` with
`costume-viewer` starts the installed program.

**Somewhere else:** when this folder has neither `serve.py` nor a `CLAUDE.md` naming the editor's program, the
skill was installed into another project. Find the editor before anything else:

1. The data folder, `%LOCALAPPDATA%\CO Costume Editor` (`$LOCALAPPDATA/CO Costume Editor` in bash). If it has a
   `CLAUDE.md`, that names the program folder, and `index/` and `my_costumes/` sit beside it. Without one (only
   logs, say), go on to 2.
2. Else the program: `C:\Program Files\CO Costume Editor\CO Costume Editor.exe`, or
   `%LOCALAPPDATA%\Programs\CO Costume Editor\CO Costume Editor.exe` (installed "for me only"). The
   `installed.ini` beside it names the data folder.
3. Not there: ask the user where the editor is (a source checkout, with `serve.py` and `start.bat`, can be
   anywhere, and keeps `index/` in its own folder), or whether it's installed at all. If it isn't, give them the
   installer: https://github.com/codexheroes/co-character-creator/releases/latest/download/CO-Costume-Editor-Setup.exe
4. Found, but no `index/`: the editor hasn't built its data from the game yet. Ask the user to start it once and
   wait until it has opened.

Then suggest reopening Claude Code in the data folder (or the source checkout), where everything is set up. If the
user would rather stay here, work with full paths into the editor's folders:
- Read the index from `<data folder>\index`, and write costumes to `<data folder>\my_costumes`.
- Run the scripts through the program by its full path, giving it full file paths (it resolves them from the
  current folder, not the data folder): `& "<program folder>\CO Costume Editor.exe" costume_check.py
  "<data folder>\my_costumes\<name>.json"`. From a source checkout, `python "<checkout>\costume_check.py" ...`.
- `preview_start` needs a `costume-viewer` entry in this project's `.claude/launch.json`. Ask before adding it
  (it's the user's project), then add `{"name": "costume-viewer", "runtimeExecutable": "<program folder>\\CO
  Costume Editor.exe", "runtimeArgs": ["serve.py"], "port": 8765, "autoPort": true}`, or for a source checkout
  `"runtimeExecutable": "python", "runtimeArgs": ["<checkout>\\serve.py"]`.

## Where the knowledge is

All generated from the user's install (see the index's own guide for the full format):

| What | Where |
|---|---|
| How costumes work, JSON format, checker | `index/GUIDE.md` (read it once per session if unsure) |
| Regions, categories, slots, file links, hair lengths | `index/Female/README.md`, `index/Male/README.md` |
| Every piece: name, code, unlock source, categories, mirror piece, child slots, **looks like**, **colour areas**, **tags**, materials, patterns, glow | `index/<Body>/<Region>/<Slot>.md` (big slots: `<Slot>/part_N.md`) |
| Allowed tags (style, material, form, features, coverage) | `index/TAGS.md` |
| Palette colours with names, **skin tones** (`## Hero_Skin`), ready-made schemes | `index/palettes.md` |
| Long tights/skin pattern lists referenced as `P26` etc. | `index/<Body>/pattern-lists/P*.md` |
| Effect materials (Fire, Ice, Ghost…) | `index/<Body>/shared-materials.md` |

Every one of the ~17,700 pieces has a "looks like" caption (from `captions/captions.json`, merged at build).
The index is far too big to read whole; search it.

### Searching

Entries start with `### Name — \`code\``, followed by lines for unlock/categories, `- looks like:`,
`- colour areas (default pattern):`, `- tags:`, `- materials:`, `- colours:` (skin tone and glow slots), and
`- child slot …`. An awk over record separator `"\n### "` pulls whole entries:

```bash
cd index/Female
show() { awk -v pat="$2" 'BEGIN{RS="\n### "} NR>1 && tolower($0) ~ pat {n=split($0,L,"\n"); out=L[1];
  for(i=2;i<=n;i++){ if(L[i] ~ /^(unlock|available)|looks like|colour areas|tags:|colours:|materials:|child slot/) out=out"\n   "substr(L[i],1,220)}
  print "### " out "\n"}' $1; }
for f in Head/Head_Wear__F_Helmet/part_*.md; do show $f "cowboy|stetson"; done
```

- Search by **tags** (`tags:[^\n]*western`) for a theme, by name words for a set (`Bounty` = "Space Western",
  `Cyber_Cowboy`, `Dragonbody`, `Draco`…), or by caption words.
- Game sets share a code word across slots; grep the code word over the whole body folder to see a full set.
- Pipe big results to a file and grep it down; one slot folder can be 30 KB+.

## Starting from an existing character

When the user drops in a costume picture (a `Costume_*.jpg` from the game or the editor's Save), **the
costume itself is inside the file**: the game stores it as parser text in the JPEG's IPTC metadata (record
2:202). The picture is only the comic-cover thumbnail, so don't try to match or describe it. Convert the
file with this skill's script (dropped images land in the session's `images/` folder):

```bash
python .claude/skills/build-costume/costume_to_json.py "<path to the .jpg>" my_costumes/<name>_original.json
python costume_check.py my_costumes/<name>_original.json     # should be 0 errors
```

The JSON keeps everything that makes the character them: `bodyScale` and all `scaleValues` (face and body
sliders), height, muscle, stance, skin, and each part's geometry, material, pattern/detail/diffuse textures,
colours and glow. Load it first and compare with the picture. To restyle, keep the identity parts (usually
bones `F_Head`, `F_Hair`/`F_Head_Hair_Child`, `F_Brow`, `F_Eyeballl`/`F_Eyeballr`), drop the rest and
`regionCategories` (the checker picks categories for the new pieces), then add the outfit. The user's saved
costumes are also listed by the running editor at `/api/test/costume-files` (fetch `/api/test/costume-file/<name>`
for one).

## Picking pieces

- **Category first**: each region uses one category and every piece must list it (e.g. Lower Body *Pants* vs
  *Tights & Skin*; Head *Beasts & Monsters* for creature heads). The checker picks a fitting category.
- **Mirror pieces**: `…l` / `…r` slots are separate; the entry names the mirror, use both.
- **Child slots**: helmet/head pieces may have optional children (horns, mouths) or required ones (creature
  eyes). Creature heads often keep their horns in an optional `…_Top_…` child; add it.
- **Unlocks**: prefer "available from the start" when the user wants that; otherwise list what needs unlocking
  (lockbox, F2p, rewards) in the summary.
- **Same character**: when asked to keep the character, keep head/face, skin, hair, height, muscle, stance and
  the colour identity; change only the outfit.

## Colours and glow

- Give the costume one four-colour scheme (0 main, 1 secondary, 2 dark/trim, 3 accent). Give a part its own
  `colors` only when its colour areas need it (hair, skin-coloured tails, a contrasting shirt).
- Read each piece's **colour areas** line before colouring it; that's what each slot paints. It can be wrong
  about light vs dark: some textures stay dark whatever colour 0 is (e.g. `F_Hips_Cyber_Cowboy_01`). Trust
  the render.
- **Skin**: on "Skin …" materials colour 3 is the costume's `skin`. Creature heads: use the head's *Skin …*
  material so head, tail and body share the skin tone. Non-human skin tones (reds etc.) are in
  `palettes.md` under `Hero_Skin`.
- **Glow** (0 none, >1 glows, up to ~10) works only on slots a material allows (`colours: glow allowed on …`).
  A costume-level `glow` is silently dropped where not allowed; put `glow` **on the part** so the checker
  warns. Quick probe: give each part `"glow":[5,5,5,5]` in a scratch copy and read which warnings come back.
  Many armour sets (e.g. Space Western) can't glow in any material; add glowing accessories instead (search
  `tags:[^\n]*lights` plus `glow allowed`): tech visors, Tesla ring bracers, power-cell or disc belts,
  Cyberwire boots, creature eyes (often glow on all slots).

## Check, then preview

```bash
python costume_check.py my_costumes/<name>.json     # 0 errors before loading; read warnings
```

The editor must be running: `preview_start` with name `costume-viewer` (from `.claude/launch.json`; it picks a
free port, so it doesn't clash with an editor the user has open; `costume-viewer-app` without Python). Load a costume by pasting it into the page. Paste these helpers once per page load with
`javascript_tool`:

```js
window.loadC = async (c) => { const dt = new DataTransfer(); dt.setData('text/plain', JSON.stringify(c));
  document.body.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
  await new Promise(r => setTimeout(r, 5000));
  const rep = document.querySelector('.palette')?.innerText || '';
  [...document.querySelectorAll('button')].find(b => /close/i.test(b.textContent))?.click();
  return rep.split('\n').filter(l => /error|Changed|Warning/i.test(l)).join('\n'); };
window.swap = (c, from, to) => { const d = JSON.parse(JSON.stringify(c));
  d.parts.forEach(p => { if (p.geometry === from) Object.assign(p, to); }); return d; };
// orbit camera: y = height in feet (feet 0.3, knee 1.7, hips 3.3, chest 4.5, head 5.4), dist, angle (0 front, 180 back)
window.closeup = (y, dist, deg) => { const {camera, controls} = window.editor; const a = deg*Math.PI/180;
  controls.target.set(0, y, 0); camera.position.set(Math.sin(a)*dist, y, Math.cos(a)*dist); controls.update(); };
// free camera: target xyz, position xyz (+x is her left side, -x her right, -z behind)
window.cam = (tx, ty, tz, px, py, pz) => { const {camera, controls} = window.editor;
  controls.target.set(tx, ty, tz); camera.position.set(px, py, pz); controls.update(); };
```

`window.editor` (`{THREE, camera, controls, ch, …}`) is the editor's debug handle; `editor.ch.doc` is the
loaded costume after the checker (resolved materials, colours, glow). Take screenshots at `scale` 0.5–0.8; the
pane's `zoom` action isn't supported, so move the camera instead. The character idles, so framing shifts a
little between shots.

## Clipping check (required before showing the user)

Clipping is one piece's mesh poking through another. It shows as **patchy, mottled or jagged two-tone areas**
where pieces overlap. Don't call that a texture or pattern until you've ruled clipping out.

1. Full body from front, both sides and back (`closeup(3.1, 9.5, deg)` for deg 0, 90, 180, -90).
2. Close-ups of every junction between overlapping pieces, from front, side and back:
   - boots over legs (`closeup(1.3, 3.4, …)`): the most common failure
   - collar/neck/head, hair or braid against collar, vest and shoulders (`closeup(5.0, 1.5–2.6, …)`)
   - bracers/rings against gloves and sleeves; belt against chest layer, tail, holsters and thigh pieces
   - tail root against belt (`cam(0,3.3,-0.3, ±1.3,4.1,-2.3)`)
3. **Red test** for anything doubtful: temporarily give the suspect underlying piece
   `colors: ['#ff0000','#ff0000','#ff0000','#ff0000']`. If red shows through the piece on top, it clips.
4. **Remove test**: load without the covering piece to see where the hidden piece really ends.
5. Fix, reload, and re-check that junction before moving on.

Fixes that worked:
- Pants clip through tall/sleek boots, even "close-fitting" pants at the calf backs → use skin-tight legs
  (`F_Hips_Tight_01`, Tights & Skin category) with a pattern for detail (e.g. `M_Hips_Tight_Patternseta_07_Mm`
  "Classic Cyberstripe"), or boots made for those pants.
- A long over-the-shoulder braid passes under a vest's shoulder → a smaller chest piece that leaves the
  shoulder clear, or a different hairstyle.
- Belt canisters that ring the back sink into a tail → a belt whose parts sit at the front and hips.
- Hats, visors and high collars were fine with braids and creature heads; check anyway.
- Long, full hair and shoulder mantles/shawls: outer hair strands pass slightly through any shoulder
  garment (seen with green paint on the mantle). No mantle avoids it; an updo (e.g. "Formal Bun Up-Sweep"
  `F_Hair_Face_Wedding_Upsweep_01`) removes it and shows off earrings and the garment's back. Hair lives
  in `F_Hair` (Hairstyle A) or `F_Head_Hair_Child` (Hairstyle B): remove the old one when swapping.
- A mantle's front clasp hides a necklace pendant, leaving bits of the pendant poking out below → drop the
  necklace and let the clasp be the jewellery.
- Jewellery under long hair (earrings) can be completely hidden → check it's visible; drop it if not.
- Bare-skin chest bases (`F_Chest_Tight_01_1` "Skin") have a built-in bra top; under plunging or open-back
  tops use a near-all-skin pattern (e.g. `F_Chest_Tight_Birdpeople_03_Mm` "Bikini Top 6", 97% skin) and
  colour its top like the garment.

## Finding themed pieces

- No piece is called a "shawl": draped shoulder pieces are **mantles** in the Back slot (`F_Capemantle_…`).
  Short ones: "Mantle: of Takofanes" (`F_Capemantle_Tight_Cloak_02`, draped over shoulders and upper chest,
  patterned hem, clasp), "Mantle: Brooch", "Mantle: Collar".
- Formal/gala: the **Wedding** set (`…Wedding…`): halter "Formal Top" chest layer, opera-length gloves,
  open-toe heels, tiaras, masquerade masks, necklaces, earrings, corsages, layered long skirt. Long gowns
  need Lower Body *Long Skirts*: legs "Skin for Long Skirt" (`F_Hips_Tight_Longskirt_01`) plus a Clothing
  skirt (e.g. "Skirt Long Ruffles", "Skirt Long Slits").
- Search `tags:[^\n]*(formal|luxury)` for more.

## Finishing

- Save the final JSON under `my_costumes/<name>.json` (never `examples/`) and run the checker on the file.
- Tell the user: what each slot now holds (a table works), what glows, which clipping you found and how you
  fixed it, what needs unlocking, and the file path. They press **Save** in the editor to write the game file.
- `make_release.py` packs every `examples/*.json` into the shareable zip; the user doesn't want their own
  costumes shipped, so they live in `my_costumes/`, which the release leaves out.
