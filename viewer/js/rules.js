// Costume creator rules, from the costume defs (see build_web.py):
//  * each region shows one category at a time (PlayerCostume.RegionCategory); a slot (bone) is offered
//    when some player piece for it is in that category, unless the category excludes the bone
//  * required bones (skeleton + category) always hold a piece
//  * a piece may put pieces on child bones (CostumeGeometry ChildGeometryDef: default, choices, required),
//    e.g. a robotic chest brings its robotic arms
//  * left/right pieces name their mirror piece (MirrorGeometry) for the mirror bone
// Every edit is a list of changes [{bone, part|null}] for Character.setPart.

// Names the artists used for pieces that are not meant for players
export const DEV_NAME = /^\s*(NPC|UNUSED|SCALE TEST|DEPRECATED)\b/i;
export const isDev = x => DEV_NAME.test(x?.displayName || '');

// Left out of the editor: weapons (the Weapons region and the 'Attachment Weapon' slots: sheathed weapons on
// the back / hips) and the vehicle bike (the Vehicle Bike Attachpoint slot and its attachments). A costume's
// parts there are kept in the document (so saving a loaded costume keeps them) but not offered or drawn.
export function isLeftOutBone(cat, bone) {
  return cat.bones[bone]?.region === 'Weapons' || /_Weapon_(Melee|Ranged)$|_Vehicle_Attach/i.test(bone);
}

export function regionOf(cat, name) { return cat.regions.find(r => r.name === name); }
export function categoryDef(cat, name) {
  for (const r of cat.regions) { const c = r.categories.find(c => c.name === name); if (c) return c; }
  return null;
}
export function partOn(doc, bone) { return doc.parts.find(p => p.bone === bone) || null; }

// Categories to offer: the visible, non-deprecated ones (plus the current one, whatever it is).
export function visibleCategories(region, current) {
  return region.categories.filter(c => c.name === current || (!c.hidden && !isDev(c)));
}

// The region's category: the costume's own, else the one most of its pieces belong to, else the default.
export function regionCategory(cat, doc, region) {
  const own = doc.regionCategories?.[region.name];
  if (own && region.categories.some(c => c.name === own)) return own;
  const votes = new Map();
  for (const p of doc.parts) {
    const g = cat.geometries[p.geometry];
    if (!g || cat.bones[p.bone]?.region !== region.name) continue;
    for (const c of g.categories) votes.set(c, (votes.get(c) || 0) + 1);
  }
  const visible = visibleCategories(region);
  const best = visible.map(c => [c.name, votes.get(c.name) || 0]).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] ? best[0] : region.defaultCategory;
}

export function requiredBones(cat, category) {
  return new Set([...cat.requiredBones, ...(categoryDef(cat, category)?.requiredBones || [])]);
}

// Pieces for a slot. opts: { showDev, hideLocked, keep } (keep: a piece name always listed)
export function piecesFor(cat, bone, category, opts = {}) {
  const ok = (n, g) => n === opts.keep || (g.availability !== 'npc' && (opts.showDev || !isDev(g))
                                           && !(opts.hideLocked && g.availability === 'unlock'));
  return Object.entries(cat.geometries)
    .filter(([n, g]) => g.bone === bone && !g.isChild && (!category || g.categories.includes(category)) && ok(n, g))
    .sort((a, b) => a[1].order - b[1].order || a[1].displayName.localeCompare(b[1].displayName));
}

// Top-level slots of a region in its category, in menu order.
export function slotsFor(cat, region, category, opts = {}) {
  const def = categoryDef(cat, category), req = requiredBones(cat, category);
  return Object.entries(cat.bones)
    .filter(([name, b]) => b.region === region.name && !b.isChild && (b.restrictedTo & 12) && !isLeftOutBone(cat, name)
            && !def?.excludedBones.includes(name)
            && (req.has(name) || piecesFor(cat, name, category, opts).length))
    .sort((a, b) => a[1].order - b[1].order)
    .map(([name, b]) => ({ bone: name, def: b, required: req.has(name) }));
}

// Child slots a piece brings: [{bone, def (bone), options: [[name, geo]], required, default}]
export function childSlots(cat, geometry, opts = {}) {
  const g = cat.geometries[geometry];
  return (g?.childGeos || []).filter(c => cat.bones[c.bone] && !isLeftOutBone(cat, c.bone)).map(c => ({
    bone: c.bone, def: cat.bones[c.bone], required: c.required, default: c.default,
    options: c.options.filter(n => cat.geometries[n] && (opts.showDev || !isDev(cat.geometries[n])) && !(opts.hideLocked && cat.geometries[n].availability === 'unlock'))
      .map(n => [n, cat.geometries[n]]),
  }));
}

// A new piece on a bone, with the geometry's default material. `look` carries the colours over:
// {colors, glow, colorLink} (see colors.js; new pieces default to the shared colours).
export function newPart(cat, bone, geometry, look = {}) {
  const g = cat.geometries[geometry];
  const material = [g.defaultMaterial, ...g.materials].find(m => m && cat.materials[m] && !isDev(cat.materials[m]))
    || [g.defaultMaterial, ...g.materials].find(m => m && cat.materials[m]) || '';
  return { bone, geometry, material, pattern: '', detail: '', diffuse: '', specular: '',
           colors: (look.colors || DEFAULT_COLORS).map(c => [...c]), glow: [...(look.glow || [0, 0, 0, 0])],
           colorLink: look.colorLink ?? 1 };
}
export const DEFAULT_COLORS = [[230, 230, 230, 255], [40, 60, 150, 255], [30, 30, 30, 255], [200, 30, 30, 255]];

// Look for a new piece: what the bone wore (colours, glow and link), else the costume's shared colours.
export function lookFor(cat, doc, bone) {
  const p = partOn(doc, bone);
  if (p) return { colors: p.colors, glow: p.glow, colorLink: p.colorLink };
  return { colors: doc.colors || DEFAULT_COLORS, glow: doc.glow, colorLink: 1 };
}

// Changes for putting `geometry` (or nothing) on `bone`, including its child pieces and, if `mirror`,
// the mirrored piece on the mirror bone.
export function pickPiece(cat, doc, bone, geometry, { mirror = false, look } = {}) {
  const changes = new Map();
  const put = (b, geo, lk) => {
    changes.set(b, geo ? newPart(cat, b, geo, lk || lookFor(cat, doc, b)) : null);
    // child bones: the new piece's defaults; anything else on this bone's child bones goes
    const defs = geo ? cat.geometries[geo].childGeos : [];
    for (const child of cat.bones[b]?.children || []) if (!defs.some(d => d.bone === child) && partOn(doc, child)) changes.set(child, null);
    for (const d of defs) {
      if (!cat.bones[d.bone]) continue;
      const pick = [d.default, ...(d.required ? d.options : [])].find(n => n && cat.geometries[n]);
      changes.set(d.bone, pick ? newPart(cat, d.bone, pick, lk || lookFor(cat, doc, d.bone)) : null);
    }
  };
  put(bone, geometry, look);
  if (mirror) {
    const other = cat.bones[bone]?.mirrorBone, mg = geometry && cat.geometries[geometry].mirrorGeometry;
    if (other && cat.bones[other]) {
      if (!geometry) put(other, null);
      else if (mg && cat.geometries[mg]?.bone === other) {
        const mine = changes.get(bone);
        put(other, mg, partOn(doc, other) ? lookFor(cat, doc, other) : { colors: mine.colors, glow: mine.glow, colorLink: mine.colorLink });
      }
    }
  }
  return [...changes].map(([b, part]) => ({ bone: b, part }));
}

// Changes for switching a region to another category: keep pieces that fit, give required bones a
// piece, drop the rest (and anything the category excludes).
export function pickCategory(cat, doc, region, category, opts = {}) {
  const def = categoryDef(cat, category), req = requiredBones(cat, category);
  const changes = [];
  for (const [bone, b] of Object.entries(cat.bones)) {
    if (b.region !== region.name || b.isChild) continue;
    const cur = partOn(doc, bone), g = cur && cat.geometries[cur.geometry];
    if (def?.excludedBones.includes(bone)) { if (cur) changes.push(...pickPiece(cat, doc, bone, null)); continue; }
    if (g && g.categories.includes(category)) continue;
    const list = piecesFor(cat, bone, category, opts);
    if (req.has(bone) && list.length) {
      const pick = list.find(([n]) => n === b.defaultGeo) || list.find(([, x]) => x.availability === 'initial') || list[0];
      changes.push(...pickPiece(cat, doc, bone, pick[0]));
    } else if (cur) changes.push(...pickPiece(cat, doc, bone, null));
  }
  return changes;
}

// Materials a piece offers, and the textures of one kind ('Pattern' | 'Detail' | 'Diffuse' | 'Specular') a material offers.
export function materialsFor(cat, geometry, opts = {}) {
  const g = cat.geometries[geometry];
  return (g?.materials || []).filter(m => cat.materials[m] && (opts.showDev || !isDev(cat.materials[m]))
                                          && !(opts.hideLocked && cat.materials[m].availability === 'unlock'))
    .map(m => [m, cat.materials[m]]);
}
export function texturesFor(cat, material, kind, opts = {}) {
  const m = cat.materials[material];
  return (m?.textures || []).filter(t => cat.textures[t]?.type.includes(kind) && (opts.showDev || !isDev(cat.textures[t]))
                                         && !(opts.hideLocked && cat.textures[t].availability === 'unlock'))
    .map(t => [t, cat.textures[t]]);
}
