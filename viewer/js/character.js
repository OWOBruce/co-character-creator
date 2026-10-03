// An editable character: a costume document drawn with the game's meshes, textures, shader,
// skeleton, stance animation and body sliders. Parts are loaded on demand and swapped per bone.
//
// Costume document (build_web.py costume_state, close to PlayerCostume):
//   { skeleton, stance, skin: [r,g,b,a], height, muscle, bodyScale: [..], scaleValues: {name: v},
//     parts: [{ bone, geometry, material, pattern, detail, diffuse, specular, colors: [[r,g,b,a] x4] }] }
import * as THREE from 'three';
import { MSet } from './mset.js';
import { ddsTexture } from './dds.js';
import { ASSET_ROOT, loadCatalog, loadShaders, resolvePart, textureSwaps } from './catalog.js';
import { createCostumeMaterial, setCostumeTextures, setCostumeColors, setCostumeMuscle, costumeColorValues } from './costume-material.js';
import { createGraphMaterial, shaderTextureSlots, setGraphTexture, setGraphValue, tickShaders, GRAPH_DEFAULTS } from './shader-graph.js';
import { initShared } from './colors.js';
import { Bouncers } from './bouncers.js';
import { ClothSim } from './cloth.js';
import { GameClothSim } from './cloth-game.js';
import { Wind } from './wind.js';
import { isWeaponBone } from './rules.js';
import { buildRig, resetPose, setFrame, stanceAnimation, loadPose, computeBody, applyBodyMatrices } from './rig.js';

const meshCache = new Map();     // url|model -> Promise<decoded mesh>
const textureCache = new Map();  // url -> Promise<THREE.Texture | null>

async function fetchBuffer(url, retries = 1) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return await r.arrayBuffer();
  } catch (e) {
    if (retries > 0 && e instanceof TypeError) return fetchBuffer(url, retries - 1);  // network hiccup
    throw e;
  }
}
// cache a promise, but forget it if it fails so the next request tries again
function cached(cache, key, make) {
  if (!cache.has(key)) cache.set(key, make().catch(e => { cache.delete(key); throw e; }));
  return cache.get(key);
}
const MESH_BUDGET = 300;  // decoded meshes kept for quick re-picks (oldest dropped first)
function loadMesh(path, model) {
  for (const k of meshCache.keys()) { if (meshCache.size < MESH_BUDGET) break; meshCache.delete(k); }
  return cached(meshCache, path + '|' + (model || ''), () => fetchBuffer(ASSET_ROOT + path).then(buf => {
    const m = new MSet(buf);
    return m.lod(m.modelIndex(model), 0).mesh();
  }));
}
const loadedTextures = new Map();  // url -> THREE.Texture, for eviction
const TEXTURE_BUDGET = 250;        // textures kept on the GPU beyond those in use
export function loadTexture(path) {
  if (!path) return Promise.resolve(null);
  return cached(textureCache, path, () => fetchBuffer(ASSET_ROOT + path).then(buf => {
    const t = ddsTexture(buf); loadedTextures.set(path, t); return t;
  })).catch(e => { console.warn('texture', path, e); return null; });
}
// Drop the least recently loaded textures that no current part uses.
function trimTextures(inUse) {
  let excess = loadedTextures.size - TEXTURE_BUDGET;
  for (const [path, t] of loadedTextures) {
    if (excess <= 0) break;
    if (inUse.has(t)) continue;
    t.dispose(); loadedTextures.delete(path); textureCache.delete(path); excess--;
  }
}

// Decoded mesh -> BufferGeometry skinned to this rig. Vertex bone indices point into the model's
// own bone name list; names are matched case-insensitively to the skeleton.
// A sub-skeleton (tail, wings...) whose root hangs off one of the rig's bones. Its bones are appended
// after the rig's own in this part's THREE.Skeleton. The part's mesh is modelled around the
// sub-skeleton's own origin, so the inverse bind matrices come from the sub-skeleton alone.
function buildSubRig(cat, res, rig) {
  const g = res.geometry, def = cat.subSkeletons?.[g.subSkeleton], bones = def?.bones;
  const attach = bones && rig.byName.get((g.subBone || '').toLowerCase());
  if (!attach) return null;
  const sub = buildRig(bones);
  const bind = [], inverses = [];
  bones.forEach((b, k) => {
    const o = sub.skeleton.bones[k];
    o.updateMatrix();
    bind[k] = b.parent === null ? o.matrix.clone() : bind[b.parent].clone().multiply(o.matrix);
    inverses[k] = bind[k].clone().invert();
  });
  attach.add(sub.root);
  return { ...sub, name: g.subSkeleton, def, attach, attachIndex: rig.index.get(attach.name.toLowerCase()), inverses,
           anim: null, bodyState: null };
}

// Belt and helmet add-ons are modelled around a skeleton bone (the catalog's `localTo`, see build_web.py
// LOCAL_ATTACH), not in character space: move a copy of the mesh to that bone's bind pose (the decoded mesh is
// cached and shared).
function placeMesh(mesh, res, rig) {
  const name = res.geometry.localTo?.toLowerCase(), i = name && rig.index.get(name);
  if (i === undefined || i === null) return mesh;
  const m = new THREE.Matrix4().copy(rig.skeleton.boneInverses[i]).invert(), nm = new THREE.Matrix3().getNormalMatrix(m);
  const move = (src, mat, normal) => {
    if (!src) return src;
    const out = new Float32Array(src.length), v = new THREE.Vector3();
    for (let k = 0; k < src.length; k += 3) {
      v.fromArray(src, k);
      if (normal) v.applyMatrix3(mat).normalize(); else v.applyMatrix4(mat);
      v.toArray(out, k);
    }
    return out;
  };
  return { ...mesh, positions: move(mesh.positions, m, false), normals: move(mesh.normals, nm, true) };
}

function buildGeometry(mesh, res, rig, sub) {
  const geo = new THREE.BufferGeometry(), n = mesh.vertCount;
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  if (mesh.normals) geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(mesh.uv0 || new Float32Array(n * 2), 2));
  geo.setIndex(new THREE.BufferAttribute(mesh.tris, 1));
  if (!mesh.normals) geo.computeVertexNormals();
  const idx = new Uint16Array(n * 4), wts = new Float32Array(n * 4);
  let skinned = false, rigid = null, clothWeight = null;
  const find = name => name && (sub?.byName.get(name.toLowerCase()) || rig.byName.get(name.toLowerCase()));
  if (res.boneNames && mesh.bones) {
    const n0 = rig.skeleton.bones.length;
    const remap = res.boneNames.map(b => sub?.index.has(b.toLowerCase()) ? n0 + sub.index.get(b.toLowerCase())
                                                                          : rig.index.get(b.toLowerCase()) ?? -1);
    // Weights on bones we don't have are dropped and the rest renormalised. That is mainly 'cloth', the
    // pseudo-bone the game's cloth simulation drives (capes, skirts): its weight per vertex is kept in
    // clothWeight for cloth.js; for skinning, vertices weighted to it alone follow the dominant real bone.
    const total = new Map();
    for (let i = 0; i < n * 4; i++) { const k = remap[mesh.bones[i]] ?? -1; if (k >= 0) total.set(k, (total.get(k) || 0) + mesh.weights[i]); }
    const main = [...total].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const clothAt = res.boneNames.findIndex(b => b.toLowerCase() === 'cloth');
    if (clothAt >= 0) {
      clothWeight = new Float32Array(n);
      for (let i = 0; i < n * 4; i++) if (mesh.bones[i] === clothAt) clothWeight[i >> 2] += mesh.weights[i] / 255;
    }
    for (let v = 0; v < n; v++) {
      let sum = 0;
      for (let j = 0; j < 4; j++) {
        const i = v * 4 + j, k = remap[mesh.bones[i]] ?? -1;
        idx[i] = Math.max(k, 0); wts[i] = k >= 0 ? mesh.weights[i] / 255 : 0; sum += wts[i];
      }
      if (sum > 0) for (let j = 0; j < 4; j++) wts[v * 4 + j] /= sum;
      else { idx[v * 4] = main; wts[v * 4] = 1; }
    }
    skinned = true;
  } else {
    // Unskinned models are modelled in their bone's space: the ModelHeader's attachment bone (sub-skeleton
    // first). Weapons name no bone at all (the game attaches them at run time); they go in the right hand's
    // WepR as a preview.
    rigid = find(res.attachBone) || (/^(Weapon|Travel)_/i.test(res.geometry.bone) ? find('WepR') : null);
    if (rigid) { for (let v = 0; v < n; v++) wts[v * 4] = 1; skinned = true; }
  }
  if (skinned) {
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(wts, 4));
  }
  return { geo, skinned, rigid, clothWeight };
}

export class Character {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.parts = new Map();   // bone -> { part, res, mesh }
    this.tokens = new Map();  // bone -> latest request (so a slow load can't overwrite a newer pick)
    this.anim = null;
    this.options = { rawMask: false, normals: true, wireframe: false, body: true, mirror: true, bounce: true, cloth: true,
                     gameCloth: true, showHidden: false, loopWings: false };
    this.wind = new Wind(); this.windTime = 0; this.lastRoot = null;
  }

  // Replace everything with a costume document.
  // Resolves false if a newer load() superseded this one.
  async load(doc) {
    const ticket = this.loadTicket = {};
    const cat = await loadCatalog(doc.skeleton);
    if (this.loadTicket !== ticket) return false;
    if (this.group) this.scene.remove(this.group), this.scene.remove(this.rig.helper);
    this.cat = cat;
    this.original = structuredClone(doc);
    this.doc = structuredClone(doc);
    this.doc.stance ||= cat.defaultStance;
    this.doc.skin ||= cat.defaultSkinColor;
    this.doc.regionCategories ||= {};
    this.doc.mood ||= 'Normal';
    this.original.skin ||= this.doc.skin;
    initShared(this.doc); initShared(this.original);
    this.bodyState = null; this.anim = null;  // belong to the previous rig
    this.group = new THREE.Group();
    this.group.visible = false;               // shown once every part is in
    this.rig = buildRig(cat.skeleton.bones);
    this.group.add(this.rig.root);
    this.group.updateMatrixWorld(true);
    this.rig.skeleton.calculateInverses();
    this.scene.add(this.group, this.rig.helper);
    this.bouncers = new Bouncers(cat.bouncers || [], this.rig.byName); this.lastTick = null;
    this.parts = new Map(); this.tokens = new Map(); this.subRigs = new Map();
    await this.setBody(this.costumeBodyValues());
    await Promise.all(this.doc.parts.map(p => this.setPart(p.bone, p)));
    if (this.loadTicket !== ticket) return false;
    // start in the stance's idle (not the creator's costume pose), with the costume's own player stance,
    // else Heroic
    const player = cat.stances.filter(s => s.player);
    const own = player.find(s => s.name.toLowerCase() === (this.doc.stance || '').toLowerCase());
    this.doc.stance = own?.name || player.find(s => s.displayName === 'Heroic')?.name || cat.defaultStance;
    await this.setStance(this.doc.stance, 'idle');
    if (this.loadTicket !== ticket) return false;
    this.applyOptions();
    this.group.visible = true;
    return true;
  }

  // Put a part on a bone (null removes it). Only this bone's mesh is rebuilt.
  async setPart(bone, part) {
    const token = {}; this.tokens.set(bone, token);
    const i = this.doc.parts.findIndex(p => p.bone === bone);
    if (part) { part = { ...part, bone }; if (i >= 0) this.doc.parts[i] = part; else this.doc.parts.push(part); }
    else if (i >= 0) this.doc.parts.splice(i, 1);
    if (!part) { this.removeMesh(bone); return; }
    if (isWeaponBone(this.cat, bone)) { this.removeMesh(bone); return; }  // kept in the document, not drawn
    const res = resolvePart(this.cat, part);
    if (!res?.mesh) { this.removeMesh(bone); this.parts.set(bone, { part, res, mesh: null }); return; }
    try {
      // the game's material: its shader graph, with the costume's textures swapped in by placeholder
      const shaders = await loadShaders().catch(() => null);
      const graph = shaders && res.shader && shaders.materials[res.shader] ? shaders : null;
      const swaps = graph ? textureSwaps(this.cat, part) : null;
      const slots = graph ? shaderTextureSlots(graph, res.shader).map(s => ({ ...s, image: swaps.get(s.placeholder) || graph.images[s.placeholder] || null })) : [];
      const [loaded, mask, diffuse, detail, muscle, ...slotTex] = await Promise.all([
        loadMesh(res.mesh, res.model), ...['mask', 'diffuse', 'detail', 'muscle'].map(k => graph ? null : loadTexture(res.images[k])),
        ...slots.map(s => loadTexture(s.image))]);
      if (this.tokens.get(bone) !== token) return;
      this.removeMesh(bone);
      const mesh = placeMesh(loaded, res, this.rig);
      const sub = res.geometry.subSkeleton ? this.acquireSub(res) : null;
      const { geo, skinned, rigid, clothWeight } = buildGeometry(mesh, res, this.rig, sub);
      const mat = (graph && createGraphMaterial(graph, res.shader)) || createCostumeMaterial();
      if (mat.userData.graph) slots.forEach((s, k) => { s.texture = slotTex[k]; });
      let obj, cloth = null;
      const bones = [...this.rig.skeleton.bones, ...(sub ? sub.skeleton.bones : [])];
      const inverses = [...this.rig.skeleton.boneInverses, ...(sub ? sub.inverses : [])];
      if (clothWeight && skinned && !rigid && this.options.cloth && res.geometry.cloth) {
        // cloth piece: a plain mesh whose vertices the cloth simulation moves (in world space)
        cloth = this.clothSim(mesh, geo, clothWeight, bones, inverses, res.geometry.cloth);
        const drawn = cloth.renderGeometry(mesh.tris, mesh.uv0);  // smoothed when the cloth info tessellates
        geo.dispose();
        obj = new THREE.Mesh(drawn, mat);
        obj.frustumCulled = false;
      } else if (skinned) {
        obj = new THREE.SkinnedMesh(geo, mat);
        const skeleton = rigid ? new THREE.Skeleton([rigid], [new THREE.Matrix4()])  // bone-local model
          : sub ? new THREE.Skeleton(bones, inverses)
          : this.rig.skeleton;
        obj.bind(skeleton, new THREE.Matrix4());
        obj.frustumCulled = false;
      } else obj = new THREE.Mesh(geo, mat);
      obj.userData.bone = bone; obj.userData.sub = sub; obj.userData.cloth = cloth;
      if (sub && sub.users === 1) {
        await this.animateSub(sub); this.updateSubBody(sub);
        if (this.tokens.get(bone) !== token) { this.releaseSub(sub); return; }
      }
      this.group.add(obj);
      this.parts.set(bone, { part, res, mesh: obj, textures: { mask, diffuse, detail, muscle }, slots });
      this.setupPart(bone);
      trimTextures(new Set([...this.parts.values()].flatMap(p => [...Object.values(p.textures || {}), ...(p.slots || []).map(s => s.texture)])));
    } catch (e) {
      console.warn('part', bone, part.geometry, e);
      if (this.tokens.get(bone) === token) { this.removeMesh(bone); this.parts.set(bone, { part, res, mesh: null, error: String(e) }); }
    }
  }

  removeMesh(bone) {
    const old = this.parts.get(bone);
    if (old?.mesh) {
      this.group.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose();
      if (old.mesh.userData.sub) this.releaseSub(old.mesh.userData.sub);
    }
    this.parts.delete(bone);
  }

  // Colours / skin / muscle / display options: uniforms only.
  // colours (and optionally glow) of one part; the document entry and the drawn part share the object
  setColors(bone, colors, glow) {
    const d = this.doc.parts.find(x => x.bone === bone); if (!d) return;
    d.colors = colors; if (glow) d.glow = glow;
    const p = this.parts.get(bone);
    if (p) { p.part = d; this.restylePart(bone); }
  }
  setSkin(rgba) { this.doc.skin = rgba; for (const b of this.parts.keys()) this.restylePart(b); }
  setMuscle(v) { this.bodyValues.muscle = this.doc.muscle = v; for (const b of this.parts.keys()) this.restylePart(b); }

  // uniforms only (cheap: safe to call on every slider / swatch hover)
  restylePart(bone) {
    const p = this.parts.get(bone); if (!p?.mesh) return;
    const mat = p.mesh.material;
    if (mat.userData.graph) { this.restyleGraph(p, mat); return; }
    setCostumeColors(mat, p.part.colors, this.doc.skin, p.res.hasSkin, p.part.glow);
    setCostumeMuscle(mat, this.cat.body.noMuscle ? 0 : this.bodyValues.muscle, p.res.suppressMuscle);
    mat.userData.uniforms.coRawMask.value = this.options.rawMask;
  }

  // The costume's constants on a shader-graph material, as the game's costume code sets them (0xcd0570 ..):
  // Color0..3 (the Color0 operation and the Color1..3 ColorValues), MuscleWeight, and the material's
  // per-colour ReflectionWeight / SpecularWeight when it has custom ones (bytes / 100).
  // A template that takes no costume colours (the Fx materials: Psionic, Holoforce, ...) is tinted as a
  // whole by Color0, through the draw colour every material's output is multiplied by: a black one adds
  // nothing, so it disappears. options.showHidden draws those untinted, to see where they are.
  restyleGraph(p, mat) {
    const cols = costumeColorValues(p.part.colors, this.doc.skin, p.res.hasSkin, p.part.glow);
    const g = mat.userData.graph;
    g.uniforms.coColor0.value.set(...cols[0], 1);
    g.uniforms.coRawMask.value = this.options.rawMask;  // View options > Inspect > Colour regions
    const tint = g.prog.usesColors ? [1, 1, 1] : cols[0];
    g.hidden = !g.prog.usesColors && tint.every(v => v <= 0);
    g.uniforms.coTint.value.set(...(g.hidden && this.options.showHidden ? [1, 1, 1] : tint), 1);
    for (let i = 1; i < 4; i++) setGraphValue(mat, 'color' + i, 'color', [...cols[i], 1]);
    const muscle = this.cat.body.noMuscle ? 0 : this.bodyValues.muscle;
    setGraphValue(mat, 'muscleweight', 'color', [0, 1, 2, 3].map(i => (p.res.suppressMuscle?.[i] ? 0 : muscle / 100)));
    if (p.res.reflection) setGraphValue(mat, 'reflectionweight', 'color', p.res.reflection.map(v => v / 100));
    if (p.res.specularity) setGraphValue(mat, 'specularweight', 'color', p.res.specularity.map(v => v / 100));
  }

  // texture set-up and display options (recompiles the material)
  setupPart(bone) {
    const p = this.parts.get(bone); if (!p?.mesh) return;
    const mat = p.mesh.material, o = this.options, t = p.textures;
    if (mat.userData.graph) {
      for (const s of p.slots) {
        const normal = /_n$|_ns$|normal/.test(s.placeholder);
        setGraphTexture(mat, s.slot, normal && !o.normals ? GRAPH_DEFAULTS.flatNormal : s.texture,
                        normal ? GRAPH_DEFAULTS.flatNormal : GRAPH_DEFAULTS.white);
      }
      mat.wireframe = o.wireframe;
      this.restylePart(bone);
      return;
    }
    setCostumeTextures(mat, { ...t, detail: o.normals ? t.detail : null, muscle: o.normals ? t.muscle : null });
    mat.wireframe = o.wireframe;
    this.restylePart(bone);
  }

  applyOptions() {
    for (const b of this.parts.keys()) this.setupPart(b);
    if (this.group) this.group.scale.x = this.options.mirror ? -1 : 1;
  }

  // ---- stance -----------------------------------------------------------------------------------
  async setStance(stance, mode = this.mode ?? 'idle') {
    this.doc.stance = stance; this.mode = mode;
    resetPose(this.rig);
    // Costume pose: the game keeps each stance's own legs under the shared upper-body pose, which looks
    // wrong on crouched stances (Beast, Huge), so the editor always takes the legs from Average
    const legsFrom = mode === 'creator' ? this.cat.stances.find(s => s.player && s.displayName === 'Average')?.name : null;
    this.anim = await stanceAnimation(this.doc.skeleton, stance, mode, this.doc.mood, legsFrom);
    if (this.anim) { this.anim.start = performance.now(); this.anim.layers.forEach(l => setFrame(this.rig, l.pose, 0, l.bones, l.allPos)); }
    await Promise.all(this.subs().map(sub => this.animateSub(sub)));
    this.restartCloth();  // the pose jumps: cloth left where it was would be dragged through the body's shapes
    return this.anim?.info || '';
  }

  // ---- sub-skeletons (tails, wings) --------------------------------------------------------------
  subs() { return [...this.subRigs.values()]; }
  // One instance per sub-skeleton and attach bone, shared by every piece that uses it (e.g. an insect
  // backpack and the wings on its child bone), as the character has one such skeleton, not one per piece.
  acquireSub(res) {
    const key = `${res.geometry.subSkeleton}|${(res.geometry.subBone || '').toLowerCase()}`;
    let sub = this.subRigs.get(key);
    if (!sub) {
      sub = buildSubRig(this.cat, res, this.rig);
      if (!sub) return null;
      sub.key = key; sub.users = 0;
      this.subRigs.set(key, sub);
    }
    sub.users++;
    return sub;
  }
  releaseSub(sub) {
    if (--sub.users > 0) return;
    sub.root.removeFromParent();
    this.subRigs.delete(sub.key);
  }
  // A sub-skeleton plays its own sequencer's track for the stance (build_web.py sub_skeleton_json).
  // The track is authored for that skeleton, so its translation keys are used as well.
  async animateSub(sub) {
    resetPose(sub);
    const mode = this.mode ?? 'idle';
    const name = sub.def.moodAnim?.[this.doc.stance]?.[mode]?.[this.doc.mood] || sub.def.anim?.[this.doc.stance]?.[mode];
    sub.anim = name && this.mode ? await loadPose(name) : null;
    sub.start = performance.now();  // wings flap once from here (when picked, loaded or the stance changes)
    if (sub.anim) setFrame(sub, sub.anim, 0, null, true);
  }
  // Wings flap once and then hold still, unless options.loopWings; tails, gliders and the rest keep looping.
  isWings(sub) { return /wings/i.test(sub.name || sub.key); }
  // Flap the wings once more (after looping is turned off, so they settle instead of stopping mid-beat).
  replayWings() { const now = performance.now(); for (const sub of this.subs()) if (this.isWings(sub)) sub.start = now; }
  // Tail/wing sliders are the ones tagged with this sub-skeleton; they drive its own scale groups.
  updateSubBody(sub) {
    sub.bodyState = computeBody(sub, { ...this.cat.body, groups: sub.def.groups }, this.bodyValues, { sub: sub.name });
  }

  // ---- body -------------------------------------------------------------------------------------
  costumeBodyValues() {
    const b = this.cat.body, d = this.original;
    return { height: d.height || b.height, muscle: d.muscle ?? b.defaultMuscle,
             bodyScales: b.bodyScales.map((s, i) => ({ ...s, value: d.bodyScale?.[i] ?? s.value })),
             scaleValues: { ...(d.scaleValues || {}) } };
  }
  neutralBodyValues() {
    const b = this.cat.body;
    return { height: b.heightBase, muscle: b.defaultMuscle,
             bodyScales: b.bodyScales.map(s => ({ ...s, value: s.name.toLowerCase() === 'bodymass' ? 20 : 50 })),
             scaleValues: {} };
  }
  async setBody(vals) {
    for (const s of vals.bodyScales) if (s.track && !s.pose) s.pose = await loadPose(s.track);
    this.bodyValues = vals;
    this.updateBody();
    for (const b of this.parts.keys()) this.restylePart(b);
  }
  // Recompute after a body value changed (and mirror it into the costume document).
  updateBody() {
    const v = this.bodyValues, d = this.doc;
    d.height = v.height; d.muscle = v.muscle; d.bodyScale = v.bodyScales.map(s => s.value); d.scaleValues = { ...v.scaleValues };
    this.bodyState = computeBody(this.rig, this.cat.body, v);
    for (const sub of this.subs()) this.updateSubBody(sub);
  }

  // ---- per frame --------------------------------------------------------------------------------
  tick(now, play) {
    this.bouncers?.restore();  // bouncer bones back to their animated pose before this frame's animation
    if (this.anim && play) {
      // 30 fps. The frame's timestamp can be a little earlier than the performance.now() taken when the
      // stance started, so t is clamped: a negative frame index would read outside the track (NaN pose)
      const t = Math.max(0, (now - this.anim.start) / 1000 * 30);
      for (const l of this.anim.layers) setFrame(this.rig, l.pose, Math.floor(t) % l.pose.frames, l.bones, l.allPos);
      for (const sub of this.subs()) {
        if (!sub.anim) continue;
        const frame = this.isWings(sub) && !this.options.loopWings
          ? Math.min(sub.anim.frames - 1, Math.max(0, Math.floor((now - sub.start) / 1000 * 30)))
          : Math.floor(t) % sub.anim.frames;
        setFrame(sub, sub.anim, frame, null, true);
      }
    }
  }
  // after scene.updateMatrixWorld()
  afterMatrixUpdate(now) {
    this.worldMatrices();
    if (now !== undefined) tickShaders(now);
    if (now === undefined) return;
    const dt = this.lastTick === null ? 0 : (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (!this.bouncers || !this.options.bounce) { this.stepCloth(dt); return; }
    // bouncers work in the game's own space: undo the viewer's mirror (the group's translation stays, so
    // moving the character moves them)
    const toGame = new THREE.Matrix4().makeScale(this.group.scale.x < 0 ? -1 : 1, 1, 1);
    if (this.bouncers.update(dt, toGame)) { this.rig.root.updateMatrixWorld(true); this.worldMatrices(); }
    this.stepCloth(dt);
  }
  // Cloth falls into place again from the body's current pose on its next step.
  restartCloth() {
    for (const p of this.parts.values()) { const sim = p.mesh?.userData.cloth; if (sim) sim.started = false; }
  }
  // Cloth pieces: simulate in world space, then write the vertices in the character group's space.
  // Not while a costume is loading (hidden, in the rest pose until its stance arrives).
  stepCloth(dt) {
    // the wind at the character, and how fast the character is moving (for the movement wind)
    if (!this.group?.visible) return;
    this.windTime += Math.min(Math.max(dt, 0), 0.1);
    const wind = this.wind.sample(this.windTime);
    const root = new THREE.Vector3().setFromMatrixPosition(this.group.matrixWorld).toArray();
    const vel = this.lastRoot && dt > 0 ? root.map((x, i) => (x - this.lastRoot[i]) / Math.max(dt, 1 / 240)) : [0, 0, 0];
    this.lastRoot = root;
    let toLocal = null;
    const scale = this.options.body && this.bodyState ? this.bodyState.height : 1;  // cloth-game.js sizes the cloth by it
    for (const p of this.parts.values()) {
      const sim = p.mesh?.userData.cloth; if (!sim) continue;
      toLocal ||= new THREE.Matrix4().copy(this.group.matrixWorld).invert();
      sim.scale = scale;
      sim.setWind(wind, root, vel);
      sim.step(dt);
      sim.write(p.mesh.geometry, toLocal);
    }
  }
  clothSim(mesh, geo, clothWeight, bones, inverses, cloth) {
    const info = this.cat.clothInfos?.[cloth.info] || this.cat.clothInfos?.Cape_Default || {};
    const shapes = (this.cat.clothCollisions?.[cloth.collision] || [])
      .map(s => ({ ...s, node: this.rig.byName.get(s.Bone.toLowerCase()) }));
    const Sim = this.options.gameCloth ? GameClothSim : ClothSim;
    return new Sim({ positions: mesh.positions, tris: mesh.tris, uv: mesh.uv0, skinIndex: geo.attributes.skinIndex.array,
                     skinWeight: geo.attributes.skinWeight.array, clothWeight, bones, inverses, info, shapes });
  }
  // The game's solver (cloth-game.js, options.gameCloth) or the editor's earlier one (cloth.js), which
  // has no switch on the page any more but is kept. The loaded cloth switches at once, falling into place
  // again from the body's current pose.
  setClothSolver(game) {
    this.options.gameCloth = game;
    for (const p of this.parts.values()) {
      const mesh = p.mesh, old = mesh?.userData.cloth;
      if (!old || old instanceof GameClothSim === game) continue;
      const sim = new (game ? GameClothSim : ClothSim)(old.args);
      const geo = sim.renderGeometry(old.args.tris, old.args.uv);
      mesh.geometry.dispose(); mesh.geometry = geo; mesh.userData.cloth = sim;
    }
  }
  worldMatrices() {
    if (this.bodyState && this.options.body) {
      applyBodyMatrices(this.rig, this.bodyState, this.group.matrixWorld);
      // a sub-skeleton hangs off its attach bone, inheriting its scale
      for (const sub of this.subs())
        if (sub.bodyState) applyBodyMatrices(sub, sub.bodyState, this.rig.rootMatrix, this.rig.world[sub.attachIndex]);
    }
  }
}
