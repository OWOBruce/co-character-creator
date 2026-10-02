// Skeleton, stance animation and body sliders (see README "Skeletons and poses" and "Body sliders").
import * as THREE from 'three';

// Skeleton from the .skel bind pose. File quats are (x, y, z, w) with w = -1 for identity.
export function buildRig(bones) {
  const objs = bones.map(b => {
    const o = new THREE.Bone(); o.name = b.name;
    o.position.fromArray(b.pos);
    o.quaternion.set(b.quat[0], b.quat[1], b.quat[2], b.quat[3]).normalize();
    o.userData.bindPos = o.position.clone(); o.userData.bindQuat = o.quaternion.clone();
    return o;
  });
  let root = null;
  bones.forEach((b, i) => { if (b.parent === null) root = objs[i]; else objs[b.parent].add(objs[i]); });
  const byName = new Map(objs.map(o => [o.name.toLowerCase(), o]));
  const index = new Map(objs.map((o, i) => [o.name.toLowerCase(), i]));
  const parent = bones.map(b => b.parent === null ? -1 : b.parent);
  const frames = objs.map(() => new THREE.Matrix4());
  const helper = new THREE.SkeletonHelper(root); helper.visible = false;
  return { root, skeleton: new THREE.Skeleton(objs), byName, index, parent, frames, helper };
}

// ---------------------------------------------------------------------------------------------
// Poses hold per-frame local rotations (already converted exactly as the engine does) and
// translation offsets, in the game's own left-handed space. The whole character is drawn in
// that space and mirrored on X at the end, which gives the correct right-handed image.
// A stance is played as layers, one per sequencer (see tools/stances.py): the 'Default' layer
// drives every bone, later layers (lower body, face) override only the bones they own.
const poseCache = new Map();
const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
let stancesPromise = null;
export function loadStances() {
  stancesPromise ||= fetch('data/stances.json').then(r => r.json());
  return stancesPromise;
}
export async function loadPose(name) {
  if (!poseCache.has(name)) poseCache.set(name, fetch(`data/poses/${name}.json`).then(r => r.json()));
  return poseCache.get(name);
}

// Translation keys: body tracks are shared between skeletons of different proportions (female
// characters play male tracks), so only the root/hips translation is used from them; their other
// per-bone offsets are skeleton-specific (e.g. a female idle's Jaw key opens the mouth). Face tracks
// do animate lips/brows by translation, so the face layer keeps its offsets.
export function setFrame(rig, pose, f, only, allPos) {
  for (const [bn, ch] of Object.entries(pose.bones)) {
    if (only && !only.has(bn.toLowerCase())) continue;
    const b = rig.byName.get(bn.toLowerCase()); if (!b) continue;
    if (ch.quat) b.quaternion.copy(b.userData.bindQuat).multiply(tmpQ.fromArray(ch.quat, f * 4));
    if (ch.pos && (allPos || /^(hips|base)$/i.test(bn)))
      b.position.copy(b.userData.bindPos).add(tmpV.fromArray(ch.pos, f * 3));
  }
}

export function resetPose(rig) {
  for (const b of rig.skeleton.bones) { b.position.copy(b.userData.bindPos); b.quaternion.copy(b.userData.bindQuat); }
}

// -> { layers: [{pose, bones: Set|null, allPos}], info } for a stance in 'creator' / 'idle' mode, with a mood
export async function stanceAnimation(skeleton, stance, mode, mood) {
  const stances = await loadStances();
  const defs = mode && (stances.moods?.[skeleton]?.[stance]?.[mode]?.[mood] || stances[skeleton]?.[stance]?.[mode]);
  if (!defs?.length) return null;
  const layers = await Promise.all(defs.map(async l => ({
    pose: await loadPose(l.track), bones: l.bones.length ? new Set(l.bones.map(b => b.toLowerCase())) : null,
    allPos: l.sequencer === 'Core_Face' })));
  return { layers, info: defs.map(l => `${l.sequencer}: ${l.track.split('__').pop()}`).join(' · ') };
}

// ---------------------------------------------------------------------------------------------
// Body sliders, ported from GameClient: the per-bone values from wlSkelInfo.c (0x158cc90), the scaled
// base skeleton from dynSkeleton.c (0x15320d0) and the node transforms from dynNode.c (0x15204d0).
// From the slider groups it's in, each bone collects
//   A  the scale of ordinary bones: applies to the bone, and its children divide it back out
//   B  the scale of Universal bones: inherited by the children
//   T  the offsets of Translation bones, added to its position.
// A Universal bone gives each of its CounterScale bones 1/B (its B so far) in their B, which cancels
// its scale for them and their children. Scale tracks (Bodymass, face) multiply the bone's scale (so
// children inherit it), add to its position and turn it.
// Bones are then placed the engine's way, with position, rotation and scale kept apart: scale multiplies
// per axis down the chain, and a child's offset is scaled by its parent's scale before the parent's
// rotation. Skinning uses T(position) R(rotation) S(scale) with the bind position taken off (0x164e4c0).
function lerp(a, b, t) { return a + (b - a) * t; }

// body: catalog body definition; vals: {height, muscle, bodyScales: [{name, value, track, fallback}], scaleValues}
// opts.sub: compute for that sub-skeleton (tail, wings): only sliders tagged with it, its own groups
// (passed in body.groups), no body scale tracks, height or grounding (it inherits those from its attach bone).
export function computeBody(rig, body, vals, opts = {}) {
  const sub = opts.sub || null;
  const n = rig.skeleton.bones.length;
  const ones = () => Array.from({ length: n }, () => [1, 1, 1]);
  const A = ones(), B = ones(), TS = ones(), T = Array.from({ length: n }, () => [0, 0, 0]);
  const idx = name => rig.index.get(name.toLowerCase());
  // 1. slider values -> per-group inputs (x, y, z), clamped to -1..1
  const input = {};
  for (const [name, v] of Object.entries(vals.scaleValues)) {
    const slider = body.sliders[name];
    if (!slider || (slider.subSkeleton || null) !== sub) continue;
    for (const [g, axis] of slider.affects) {
      (input[g] ||= [0, 0, 0])[axis] += v / 100;
    }
  }
  // included groups receive the including group's input times a fraction
  for (const [g, def] of Object.entries(body.groups))
    for (const [h, frac] of def.include) if (input[g]) {
      const dst = (input[h] ||= [0, 0, 0]);
      for (let a = 0; a < 3; a++) dst[a] += input[g][a] * frac;
    }
  // 2. Small/Large ranges are blended by body mass (BodyScale 'Bodymass', 0..100)
  const mass = (vals.bodyScales.find(b => b.name.toLowerCase() === 'bodymass')?.value ?? 20) / 100;
  for (const [g, inp] of Object.entries(input)) {
    const def = body.groups[g]; if (!def) continue;
    // the engine walks a group's bones last to first; the order matters for CounterScale
    for (const b of [...def.bones].reverse()) {
      const i = idx(b.bone); if (i === undefined) continue;
      for (let a = 0; a < 3; a++) {
        const v = Math.max(-1, Math.min(1, inp[a])); if (!v) continue;
        const lo = lerp(b.smallMin[a], b.largeMin[a], mass), hi = lerp(b.smallMax[a], b.largeMax[a], mass);
        if (b.translation) T[i][a] += v < 0 ? -v * lo : v * hi;
        else (b.universal ? B : A)[i][a] *= v < 0 ? lerp(1, lo, -v) : lerp(1, hi, v);
      }
      if (b.universal)
        for (const cName of b.counter) {
          const c = idx(cName);
          if (c !== undefined) for (let a = 0; a < 3; a++) B[c][a] /= B[i][a];
        }
    }
  }
  // 3. scale tracks (Bodymass, jaw, mouth, brow...): frame = value/100 * (frames-1). Tracks must be loaded.
  const trackQuat = Array(n).fill(null);
  for (const bs of sub ? [] : vals.bodyScales) {
    const pose = bs.track && bs.pose; if (!pose) continue;
    const f = Math.round(Math.max(0, Math.min(1, bs.value / 100)) * (pose.frames - 1));
    for (const [bn, ch] of Object.entries(pose.bones)) {
      const i = idx(bn); if (i === undefined) continue;
      if (ch.scale) for (let a = 0; a < 3; a++) TS[i][a] *= ch.scale[f * 3 + a];
      // a fallback track was authored for another skeleton: its offsets/rotations don't fit, keep scale only
      if (bs.fallback) continue;
      if (ch.pos) for (let a = 0; a < 3; a++) T[i][a] += ch.pos[f * 3 + a];
      if (ch.quat) (trackQuat[i] ||= new THREE.Quaternion()).multiply(new THREE.Quaternion().fromArray(ch.quat, f * 4));
    }
  }
  const st = { A, B, T, TS, trackQuat, height: sub ? 1 : vals.height / (body.heightBase || 6), lift: 0 };
  if (sub) return st;
  // height fixup: keep the soles where they are in the bind pose (longer legs lift the body)
  const feet = ['footl', 'footr', 'toel', 'toer'].map(idx).filter(i => i !== undefined);
  const lowest = w => Math.min(...feet.map(i => w[i].p.y));
  if (feet.length) st.lift = lowest(placeBones(rig, null, true)) - lowest(placeBones(rig, st, true));
  return st;
}

// Each bone's position, rotation and scale in the character's space, from the bind pose or the current
// (animated) one, with or without the body state. parent: where a sub-skeleton's root bones hang.
const _v = new THREE.Vector3();
function placeBones(rig, st, bind, out = null, parent = null) {
  const bones = rig.skeleton.bones;
  const W = out || bones.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }));
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i], p = rig.parent[i], w = W[i], pw = p >= 0 ? W[p] : parent;
    w.p.copy(bind ? b.userData.bindPos : b.position);
    w.q.copy(bind ? b.userData.bindQuat : b.quaternion);
    w.s.set(1, 1, 1);
    if (st) {
      w.p.add(_v.fromArray(st.T[i]));
      if (st.trackQuat[i]) w.q.multiply(st.trackQuat[i]);
      w.s.fromArray(st.A[i]).multiply(_v.fromArray(st.B[i])).multiply(_v.fromArray(st.TS[i]));
      if (p >= 0) w.s.divide(_v.fromArray(st.A[p]));  // the parent's own scale isn't passed on
    }
    if (pw) { w.p.multiply(pw.s).applyQuaternion(pw.q).add(pw.p); w.q.premultiply(pw.q); w.s.multiply(pw.s); }
  }
  return W;
}

const _m = new THREE.Matrix4();
// Overwrites the bones' matrixWorld (call after scene.updateMatrixWorld()). rig.frames[i] is bone i's
// matrix and rig.world[i] its position/rotation/scale; a sub-skeleton (tail, wings) passes its attach
// bone's as attach, with the main skeleton's root matrix (rig.rootMatrix) as groupMatrix.
export function applyBodyMatrices(rig, st, groupMatrix, attach = null) {
  const bones = rig.skeleton.bones;
  const root = (rig.rootMatrix ||= new THREE.Matrix4()).copy(groupMatrix)
    .multiply(_m.makeScale(st.height, st.height, st.height))
    .multiply(_m.makeTranslation(0, st.lift, 0));
  rig.world = placeBones(rig, st, false, rig.world, attach);
  for (let i = 0; i < bones.length; i++) {
    const w = rig.world[i];
    bones[i].matrixWorld.multiplyMatrices(root, _m.compose(w.p, w.q, w.s));
    rig.frames[i].copy(bones[i].matrixWorld);
  }
}
