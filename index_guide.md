# Champions Online costume index: guide

This folder describes every costume piece a player can wear in Champions Online: slot, material, pattern and
colours. It's built so that a person, or an AI assistant, can put together a costume by name, check it, and
open it in the costume editor. Everything here is generated from your own game install by `build.py`
(`build_index.py`), and is rebuilt when the game is patched.

## Files

| File | What's in it |
|---|---|
| `GUIDE.md` | This guide: how costumes work, the costume JSON format, how to check one |
| `palettes.md` | The creator's colours with names, the skin tones, and 25 ready-made colour schemes |
| `Female/README.md`, `Male/README.md` | Each body's regions, categories and slots, with a link to each slot's file and its hair lengths |
| `<Body>/<Region>/<Slot>.md` | Every piece for a slot (and its child slots), each listed once with the categories it fits. Big slots are cut into parts (`<Slot>/part_1.md`, `part_2.md` …) |
| `<Body>/shared-materials.md` | The materials many pieces share (mostly effects: Fire, Ice, Ghost…) and what they look like |
| `<Body>/pattern-lists.md`, `pattern-lists/P*.md` | Long pattern lists shared by many materials (tights, skins), referenced by id |
| `index.json` | The same data for scripts |

Start with the body's `README.md`, then open only the slot files you need. The whole index is far too big to read at once.

## How a costume is put together

- **Body:** `Female` or `Male`. Pieces are made for one body; `F_…` pieces are female, `M_…` male.
- **Regions and categories:** there are four regions: Head, Upper Body, Hands, Lower Body. Each region uses one **category** at a time (e.g. Upper Body: *Tights & Skin*, *Jackets*, *Mechanical*, *Partial*). Every piece in a region must belong to that category; a piece's entry lists the categories it fits. Choose the category first, then pieces that fit it.
- **Slots:** each region has slots (bones), e.g. `F_Chest`, `F_Hair`, `F_Footl`. A slot holds one piece.
  - Some slots are required on every costume: the head, chest, both hands, hips and both feet. Some categories require more, such as eyes.
  - The checker fills any required slot you leave empty.
- **Child slots:** some pieces offer child slots of their own, e.g. a jacket's sleeves or a helmet's visor. Their options are listed under the piece. A child piece can only be used when its parent piece is worn.
- **Left and right:** left and right pieces are separate (`…l` / `…r` slots, e.g. `F_Footl` / `F_Footr`). A piece's entry names its mirror piece; use both for a symmetrical look.
- **Availability:** "available from the start" pieces work for every character. "unlock (…)" pieces must be unlocked in the game first; the entry says where from (lockbox, C-Store, event, reward…).

## Materials

Each piece offers a few materials. The entry lists them as display name, internal name and look:

- **matte / satin / glossy:** how shiny the surface is (cloth, leather…).
- **reflective / highly reflective:** reflects its surroundings (metal).
- **brushed-metal sheen:** anisotropic highlights.
- **see-through:** transparent (glass, ice, sheer).
- **glowing (adds light):** light-emitting effects (holoforce, psionic, ghost).
- **bright edges:** a rim that brightens at glancing angles (fresnel).
- **animated:** scrolling or pulsing.

These come from each material's shader, not from its name. "Metal" on two pieces can differ.

- **Default material:** marked "default". Leave `material` out to use it.
- **Effect materials:** listed only by name on each piece; `shared-materials.md` says what they look like.
- **Colour rules:** a material's entry can say "colour 3 is the skin tone" (skin materials) and "glow allowed on colour …".

## Patterns and colours

Every piece has **four colour slots, 0 to 3**. The **pattern** (a texture chosen per material) decides which areas each slot paints. An entry like

    `C_Back_Alien_01_Mm` "Alien" (colours 0:51% 1:34% 2:6% 3:9%)

means colour 0 paints about half of the piece's texture, colour 1 a third, and so on.

- **What the numbers measure:** a share of the texture, not of the visible surface. Unused texture space counts as colour 0, so read small differences loosely.
- **"x% untinted":** that part shows the texture's own colours whatever you choose.
- **Finding the main colour:** the slot with the largest share is usually the main colour. Small shares are trims, stripes and accents.
- **No pattern given:** the material's default pattern is used.
- **Skin:** on skin materials colour 3 is the character's skin tone (the costume's `skin`), whatever the part's colour 3 says.
- **Glow:** per colour slot, 0 = none, above 1 glows (up to about 10). Only on the slots a material allows.
- **Palettes:** costumes use the creator's swatches. `palettes.md` lists them with names, plus ready-made four-colour schemes, which are a good starting point. You can write any colour; the checker moves each to the nearest swatch (skin to the nearest skin tone), so pick from the palette to get exactly what you mean.

**Work at the costume level.** Give the costume one colour scheme (`colors`, four colours) and let every part use it, as the creator's "Shared colours" do. Give a part its own `colors` only on purpose, e.g. natural hair colours, or a contrasting cape. A scheme works best with roles: 0 main, 1 secondary, 2 accent/trim, 3 detail (or skin).

## Hair

Hair pieces (slots `F_Hair` / `M_Hair` "Hairstyle A", `F_Head_Hair_Child` "Hairstyle B", `…_Hair_Child`) have a **length**. It's measured from the mesh (its lowest point in the standing pose) against the body:

- short (above the jaw)
- chin length
- neck length
- shoulder length
- upper-back length
- mid-back length
- waist length or longer

"Tall on top" marks tall styles (afros, mohawks, updos). Names can mislead: e.g. "Casual Long" is chin length.

Almost all hair patterns (about 9 in 10) put the main hair colour on **colour 0**; check the coverage for the rest. Give hair its own `colors` when the costume scheme isn't a hair colour.

## Costume JSON

```json
{
  "skeleton": "Female",
  "name": "Night Courier",
  "stance": "Heroic",
  "mood": "Determined",
  "height": 6.0,
  "muscle": 25,
  "skin": "#d4896f",
  "colors": ["#1a1a2e", "#c9a227", "#e8e8e8", "#d4896f"],
  "glow": [0, 0, 0, 0],
  "parts": [
    { "geometry": "F_Head_Face_01" },
    { "geometry": "F_Hair_Face_Ponytail_01", "material": "Hair",
      "colors": ["#2b1a10", "#4a2f1d", "#2b1a10", "#d4896f"] },
    { "geometry": "F_Chest_Tight_01_1", "material": "Skin & Leather Tights" },
    { "geometry": "F_Hips_Tight_01", "material": "Tights Leather" },
    { "geometry": "F_Footl_Tight_Combatsock_01", "material": "Leather" },
    { "geometry": "F_Footr_Tight_Combatsock_01", "material": "Leather" },
    { "geometry": "F_Collar_Child_Tight_Cape_Archer_01_Back", "material": "Cloth" }
  ]
}
```

- **`skeleton`** (required): `Female` or `Male`.
- **`parts[].geometry`** (required): the piece's internal name (the `code` after the name in the slot files).
  - `bone` is optional: it comes from the piece.
  - Leave out required slots and they're filled.
- **`material`, `pattern`, `detail`, `diffuse`, `specular`** (optional): internal names, or a display name when it's unambiguous for that piece ("Leather", "Tights Leather"). Leave them out for the defaults.
- **`colors`:** four colours as `"#rrggbb"`, a CSS colour name (`"crimson"`) or `[r, g, b]`.
  - At the top level, `colors` is the costume's scheme.
  - On a part, it gives that part its own colours.
- **`glow`:** four numbers, at the top level or per part.
- **`stance`, `mood`:** display or internal names (`Heroic`, `Average`, `Vixen`… / `Normal`, `Determined`…). See the body's README.
- **Optional body fields:**
  - `height` in feet (the creator allows 4.5 to 7);
  - `muscle` (female 0 to 80, male 0 to 60);
  - `skin` (a colour; skin tones are in `palettes.md`);
  - `regionCategories` (`{"F_Upperbody": "F_Upper_Jacket"}`). Otherwise the category that fits your pieces is chosen.

`../examples/night_courier.json` is this example.

## Checking a costume

```bash
python costume_check.py my_costume.json                  # report problems
python costume_check.py my_costume.json --out my_costume.editor.json
```

The checker fills in what's missing and reports:

- **Error:** can't be built as written. It names the options or close matches:
  - an unknown piece, material or pattern;
  - a piece for the wrong slot, or an NPC-only piece;
  - two pieces on one slot;
  - pieces that don't share their region's category;
  - a child piece its parent doesn't offer.
- **Changed / warning:** it fixed something:
  - added a required piece;
  - dropped a piece the chosen category has no slot for;
  - removed glow from a slot that can't glow;
  - clamped height or muscle;
  - replaced a stance the creator doesn't offer.
- **Note:** worth knowing, e.g. a piece needs unlocking in the game, or colour 3 is the skin tone.

It exits with status 1 when there are errors. `--out` writes the editor's own costume document.

## Seeing it

In the editor (`start.bat`): **Load** a costume `.json`, drop it on the page, or copy the JSON and paste it anywhere on the page (Ctrl+V). The editor runs the same check, shows its report, and loads the costume. **Save** then writes a real game costume file (`Costume_*.jpg`) you can load at the in-game tailor.

## A way for an AI to build a costume

1. Pick the body. Read its `README.md` for regions, categories and slots.
2. For each region, pick a category that suits the idea (e.g. Upper Body *Jackets* for a coat).
3. For each slot you want, open its file (all its parts, for a big slot) and choose a piece. Use names, categories, hair length and materials; skip pieces whose `categories:` line doesn't include the region's category. The body's `README.md` shows how many pieces each slot has in each category.
4. Choose each piece's material by its look (e.g. glossy leather, highly reflective metal, see-through glass), and a pattern if the piece offers several.
5. Choose a four-colour scheme with roles (`palettes.md` has named colours and ready-made schemes) and a skin tone. Use pattern coverage to see what each slot will paint, and give a part its own colours only where needed.
6. Run `costume_check.py`, fix the errors, and repeat.
7. Load it in the editor and look at it; adjust.

## What pieces look like

Pieces that have been looked at carry four more lines, written from rendered pictures of the piece on the male and on the female body:
- **looks like:** its shape, construction and style in a sentence or two;
- **colour areas (default pattern):** which features take which colour slot (0–3) with the piece's default pattern;
- **tags:** words from a fixed list (`TAGS.md`): style, material look, form, features, coverage and length. Search for them to find pieces (e.g. `steampunk` and `goggles`);
- **versus the male/female version:** only when the two bodies' versions differ noticeably.

Not every piece has these yet. Pieces without them still have everything else.

## Limits

- The material look words come from each material's shader settings; coverage and hair length are measured from textures and meshes. Only pieces with a "looks like" line have been described from pictures; for the rest, a spiky pauldron and a smooth one read the same apart from their names.
- Coverage is a share of the texture, not of the visible surface.
- Hair length is measured in the default standing pose on a default-height body.
- Unlock sources come from the game's unlock-costume folders and can be approximate.
