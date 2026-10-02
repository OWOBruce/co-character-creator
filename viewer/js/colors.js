// Costume colours as the creator handles them.
//
// Each part has four colours (Color_0..3) and a ColorLink (GameClient enum at 0x20171b8):
//   0 None (its own colours), 1 All (the costume's shared colours), 2 Mirror (shared with the part on
//   the mirror bone), 3 Group, 4 MirrorGroup, 5 Different. Player skeletons define no bone groups, so
//   Group behaves like None and MirrorGroup like Mirror here. 96% of costumes with several All-linked
//   parts give them identical colours, which is what makes them "shared".
// Glow is per colour (CustomColors.glowScale, 0..10 in practice): the engine multiplies the colour's
// brightness by it (see costume-material.js). The creator offers it where the material's AllowGlow is set.
// Palettes come from the skeleton: BodyColorSet0 (Hero_Colors, 323), SkinColorSet (Hero_Skin, 97) and
// ColorQuadSet (Hero_Colorquads, 25 four-colour schemes).
import { partOn } from './rules.js';
import { gameSlider, editableValue, numberParser } from './ui.js';

export const LINK = { None: 0, All: 1, Mirror: 2, Group: 3, MirrorGroup: 4, Different: 5 };
export const DEFAULT_SHARED = [[230, 230, 230, 255], [40, 60, 150, 255], [30, 30, 30, 255], [200, 30, 30, 255]];
const copy = cs => cs.map(c => [...c]);
export const linkOf = part => part?.colorLink ?? LINK.All;
const isShared = part => linkOf(part) === LINK.All;
const isMirror = part => [LINK.Mirror, LINK.MirrorGroup].includes(linkOf(part));

export function palettes(cat, shared) {
  const set = n => shared.palettes.colorSets.find(s => s.Name === n)?.Color.map(c => c.color.map(Math.round)) || [];
  return {
    body: set(cat.bodyColorSet), skin: set(cat.skinColorSet),
    quads: shared.palettes.colorQuadSets.find(s => s.Name === cat.colorQuadSet)?.ColorQuad
      .map(q => [q.Color0, q.Color1, q.Color2, q.Color3]) || [],
  };
}

// The costume's shared colours: taken from its first All-linked part when loading.
export function initShared(doc) {
  if (!doc.colors) {
    const p = doc.parts.find(isShared) || doc.parts[0];
    doc.colors = copy(p?.colors || DEFAULT_SHARED);
    doc.glow = [...(p?.glow || [0, 0, 0, 0])];
  }
  for (const p of doc.parts) { p.colorLink ??= LINK.All; p.glow ??= [0, 0, 0, 0]; }
  return doc;
}

// Updates [{bone, colors, glow}] for setting colour `slot` of `bone` (rgba and/or glow), following its link.
export function slotChanges(cat, doc, bone, slot, { rgba, glow }) {
  const part = partOn(doc, bone); if (!part) return [];
  const edit = (p, cs, gs) => {
    const colors = copy(cs), g = [...(gs || [0, 0, 0, 0])];
    if (rgba) colors[slot] = [...rgba];
    if (glow !== undefined) g[slot] = glow;
    return { bone: p.bone, colors, glow: g };
  };
  if (isShared(part)) return sharedChanges(doc, edit({ bone: null }, doc.colors, doc.glow));
  const out = [edit(part, part.colors, part.glow)];
  const other = isMirror(part) && cat.bones[bone]?.mirrorBone && partOn(doc, cat.bones[bone].mirrorBone);
  if (other && isMirror(other)) out.push({ ...out[0], bone: other.bone });
  return out;
}

// New shared colours (and glow) -> updates for every All-linked part; doc.colors itself is set on commit.
export function sharedChanges(doc, { colors, glow }) {
  return [{ bone: null, colors, glow }, ...doc.parts.filter(isShared).map(p => ({ bone: p.bone, colors: copy(colors), glow: [...glow] }))];
}

// Switching a part's link: to All it takes the shared colours; to Mirror it copies the mirror part's.
export function linkChanges(cat, doc, bone, link) {
  const part = partOn(doc, bone); if (!part) return [];
  if (link === LINK.All) return [{ bone, link, colors: copy(doc.colors), glow: [...doc.glow] }];
  if (link === LINK.Mirror) {
    const other = partOn(doc, cat.bones[bone]?.mirrorBone);
    const out = [{ bone, link, colors: copy(other?.colors || part.colors), glow: [...(other?.glow || part.glow)] }];
    if (other) out.push({ bone: other.bone, link, colors: copy(out[0].colors), glow: [...out[0].glow] });
    return out;
  }
  return [{ bone, link, colors: copy(part.colors), glow: [...part.glow] }];
}

// Apply updates to the character (bone null = the shared colours in the document).
export function applyColorChanges(ch, changes) {
  for (const c of changes) {
    if (c.bone === null) { ch.doc.colors = copy(c.colors); ch.doc.glow = [...c.glow]; continue; }
    const p = partOn(ch.doc, c.bone); if (!p) continue;
    if (c.link !== undefined) p.colorLink = c.link;
    ch.setColors(c.bone, copy(c.colors), [...c.glow]);
  }
}
export function snapshotColors(ch, changes) {
  return changes.map(c => c.bone === null ? { bone: null, colors: copy(ch.doc.colors), glow: [...ch.doc.glow] }
    : (p => p && { bone: c.bone, link: p.colorLink, colors: copy(p.colors), glow: [...p.glow] })(partOn(ch.doc, c.bone))).filter(Boolean);
}

export function nearestIndex(list, rgba) {
  let best = -1, bd = Infinity;
  list.forEach((c, i) => { const d = (c[0] - rgba[0]) ** 2 + (c[1] - rgba[1]) ** 2 + (c[2] - rgba[2]) ** 2; if (d < bd) { bd = d; best = i; } });
  return bd <= 12 ? best : -1;  // only an (almost) exact palette colour counts as selected
}

// Put a pop-up next to its anchor, beside the side panel rather than over it, kept on screen.
export function placePopup(box, anchor) {
  const r = anchor.getBoundingClientRect(), side = anchor.closest('#side')?.getBoundingClientRect();
  const left = side && side.right + box.offsetWidth + 8 < innerWidth ? side.right + 6 : r.right + 6;
  box.style.left = Math.max(8, Math.min(left, innerWidth - box.offsetWidth - 8)) + 'px';
  box.style.top = Math.max(8, Math.min(r.top - 40, innerHeight - box.offsetHeight - 8)) + 'px';
}

export const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;

// ---- palette popup ----------------------------------------------------------------------------
// opts: { title, colors: [[r,g,b,a]], current, glow: {value, max}|null, onPreview(rgba|null, glow), onCommit(rgba, glow), onCancel() }
let open = null;
addEventListener('keydown', e => { if (e.key === 'Escape' && open) { e.preventDefault(); open.cancel(); } });
addEventListener('mousedown', e => { if (open && !open.el.contains(e.target) && !open.anchor.contains(e.target)) open.cancel(); });

export function openPalette(anchor, opts) {
  open?.cancel();
  const box = document.createElement('div'); box.className = 'palette';
  const head = document.createElement('div'); head.className = 'phead'; head.textContent = opts.title || 'Colour';
  const grid = document.createElement('div'); grid.className = 'grid';
  let glow = opts.glow?.value ?? 0, picked = null;
  const cur = nearestIndex(opts.colors, opts.current || [0, 0, 0]);
  opts.colors.forEach((c, i) => {
    const sw = document.createElement('button'); sw.className = 'sw' + (i === cur ? ' cur' : '');
    sw.style.background = css(c); sw.title = `${c[0]}, ${c[1]}, ${c[2]}`;
    sw.onmouseenter = () => opts.onPreview(c, glow);
    sw.onclick = () => { picked = c; commit(); };
    grid.append(sw);
  });
  grid.onmouseleave = () => opts.onPreview(null, glow);
  box.append(head, grid);
  if (opts.glow) {
    const row = document.createElement('div'); row.className = 'glowRow';
    const out = document.createElement('span'); out.textContent = glow;
    const max = opts.glow.max || 10;
    const inp = gameSlider({ min: 0, max, step: 1, value: glow,
      onInput: v => { glow = v; out.textContent = v; opts.onPreview(opts.current, glow); },
      onChange: () => { picked = opts.current; commit(false); } });
    editableValue(out, { parse: numberParser({ min: 0, max, step: 1 }), hint: `0 to ${max}`, label: 'glow',
                         apply: v => { inp.value = v; glow = v; out.textContent = v; picked = opts.current; commit(false); } });
    row.append('Glow', inp, out); box.append(row);
  }
  document.body.append(box);
  placePopup(box, anchor);
  const close = () => { box.remove(); open = null; };
  const commit = (shut = true) => { opts.onCommit(picked, glow); if (shut) close(); };
  open = { el: box, anchor, cancel: () => { close(); opts.onCancel(); } };
}
