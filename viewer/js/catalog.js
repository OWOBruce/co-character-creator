// Catalog access (viewer/data/catalog, built by build_web.py) and part resolution:
// a costume part {bone, geometry, material, pattern, detail, diffuse, colors} -> what to load and draw.

export const ASSET_ROOT = 'assets/';
const catalogs = new Map();
let shared = null;

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

let shaders = null;
export function loadShaders() {
  shaders ||= json('data/catalog/shaders.json');
  return shaders;
}

export async function loadShared() {
  shared ||= Promise.all(['palettes', 'costumes', 'unlocks'].map(n => json(`data/catalog/${n}.json`)))
    .then(([palettes, costumes, unlocks]) => ({ palettes, costumes, unlocks }));
  return shared;
}

export function loadCatalog(skeleton) {
  if (!catalogs.has(skeleton)) catalogs.set(skeleton, json(`data/catalog/${skeleton}.json`));
  return catalogs.get(skeleton);
}

// Image of a texture def for one role (Pattern / Diffuse / Detail): the def's own image if it has that
// type, else one of its extra textures; a pattern always falls back to its main image.
function textureImage(cat, name, kind) {
  const t = name && cat.textures[name];
  if (!t) return null;
  if (t.type.includes(kind) && t.image) return t.image;
  for (const e of t.extra) if (e.type.includes(kind) && e.image) return e.image;
  return kind === 'Pattern' ? t.image : null;
}

export function partMaterial(cat, part) {
  const g = cat.geometries[part.geometry];
  if (!g) return null;
  const name = [part.material, g.defaultMaterial, ...g.materials].find(m => m && cat.materials[m]);
  return name ? { name, ...cat.materials[name] } : null;
}

// The texture a part draws for a field (pattern / diffuse / detail / specular): its own, else the material's
// default, else, when the material requires one, its first texture of that kind. Saved costumes leave such a
// texture empty (the Cosmic helmet's Shiny Metal: one pattern, no default) and the game draws that one.
// Saving still writes what the part holds (file-ui.js).
const KINDS = { pattern: 'Pattern', diffuse: 'Diffuse', detail: 'Detail', specular: 'Specular' };
export function drawnTexture(cat, part, m, field) {
  if (part[field]) return part[field];
  if (m?.defaults?.[field]) return m.defaults[field];
  if (!m?.requires?.includes(field)) return '';
  return (m.textures || []).find(t => cat.textures[t]?.type.includes(KINDS[field])) || '';
}

// The part's textures by the placeholder each replaces in its material's shader (lower case -> image):
// the game swaps a material's Default_Color_Mm, Default_Detail_N, M_Chest_Tight_01_N ... for the costume's
// chosen pattern / detail / diffuse / specular textures and their extra textures (CostumeTexture OrigTexture).
export function textureSwaps(cat, part) {
  const m = partMaterial(cat, part), swaps = new Map();
  for (const k of ['pattern', 'diffuse', 'detail', 'specular']) {
    const t = cat.textures[drawnTexture(cat, part, m, k)];
    if (!t) continue;
    for (const e of [...t.extra, t]) if (e.replaces && e.image) swaps.set(e.replaces.toLowerCase(), e.image);
  }
  return swaps;
}

// Everything needed to draw one part. Textures missing from the local install come back as null.
export function resolvePart(cat, part) {
  const g = cat.geometries[part.geometry];
  if (!g) return null;
  const m = partMaterial(cat, part) || { defaults: {}, suppressMuscle: [0, 0, 0, 0] };
  const [pattern, diffuse, detail] = ['pattern', 'diffuse', 'detail'].map(k => drawnTexture(cat, part, m, k));
  // the shader's 'Muscles' map: the pattern's own *_Muscle_N extra, else the material's default
  const pat = pattern ? cat.textures[pattern] : null;  // ('' when the part draws none: glass, screens)
  const muscle = pat?.extra.find(e => e.texture && /muscle/i.test(e.texture) && e.image)?.image || m.muscle || null;
  return {
    geometry: g, material: m.name || null, shader: m.shader || null, hasSkin: !!m.hasSkin, suppressMuscle: m.suppressMuscle,
    reflection: m.reflection || null, specularity: m.specularity || null,
    mesh: g.mesh, model: g.model, boneNames: g.boneSet !== undefined ? cat.boneSets[g.boneSet] : null,
    attachBone: g.attachBone || null,
    images: {
      mask: textureImage(cat, pattern, 'Pattern'),
      diffuse: textureImage(cat, diffuse, 'Diffuse') || textureImage(cat, pattern, 'Diffuse'),
      detail: textureImage(cat, detail, 'Detail') || textureImage(cat, pattern, 'Detail'),
      muscle,
    },
  };
}
