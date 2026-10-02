// Cloth for capes, skirts and scarves: a particle simulation driven by the game's own cloth data.
//
// From the game (see README "Cloth"):
//  * a cloth piece is a coarse mesh whose vertices carry a weight on the "Cloth" pseudo-bone
//    (0 = held by the body, 1 = free cloth; dynClothBuild 0x16b9650). The rest is skinned as usual.
//  * DynClothInfo (via the piece's ClothData): Stiffness, Drag, MinWeight / MaxWeight, GravityScale,
//    ClothBoneInfluenceExponent, ParticleCollisionRadius, NumIterations ...
//  * DynClothCollision: shapes on bones (Sphere, Plane, Cylinder, Baloon, Box). Player capes use
//    cylinders: Offset and Direction in the bone's space, Radius, and the stretch -Exten1..+Exten2 along
//    the axis. MovingBackwards shapes only apply when running backwards; InsideVolume keeps cloth inside.
//  * the integration step (dynCloth.c 0x169d550) is Verlet: next = pos + (pos - prev) * (1 - Drag) + a dt^2,
//    with gravity GravityScale x 10 ft/s^2 (Cape_Default: 3 -> 30 ft/s^2).
//  * wind, from the same step (fields copied by dynClothObjectSetup 0x16b9970; set by 0x15ff2b0 / 0x169cc00):
//      G = wind direction x wind speed x WindSpeedScale x 10          (a steady push, like gravity)
//      V = -(character movement) / 2dt;  N = G + NormalWindFromMovement V;  D = N / |N|
//      a = G + gravity + 5 FakeWindFromMovement V
//      ripple (per particle, along its normal n, added to its velocity):
//        n x sin((dot(p - root, D) - 20 WindRippleWaveTimeScale t) WindRippleWavePeriodScale) x |N| dt 0.05 WindRippleScale
//    where t is the cloth's clock (advancing at TimeScale). The wind itself comes from wind.js.
// Drawn through a smooth render mesh when the info asks for Tessellate (cloth-tess.js: Loop subdivision).
// Not ported from the game: its constraint and collision solvers, the attachment harness, its tessellation
// code. Here: distance constraints along the mesh's edges plus bending constraints across them (strength
// Stiffness), a few iterations, cylinder / sphere push-out, and particles pinned by their cloth weight
// (at or below MinWeight they follow the body; between MinWeight and MaxWeight they are pulled toward
// it by (1 - t)^ClothBoneInfluenceExponent).
import * as THREE from 'three';
import { tessellate } from './cloth-tess.js';

const STEP = 1 / 60;
const _v = new THREE.Vector3();

export class ClothSim {
  // mesh: decoded mesh (positions, tris); skin: { index, weight } per vertex x4 over `bones` (cloth excluded,
  // normalised); cloth: per-vertex cloth weight; bones / inverses: the skinning bones; info: DynClothInfo;
  // shapes: DynClothCollision shapes with resolved `node` (THREE.Bone)
  constructor({ positions, tris, skinIndex, skinWeight, clothWeight, bones, inverses, info, shapes }) {
    this.info = info; this.bones = bones; this.inverses = inverses;
    this.shapes = shapes.filter(s => s.node && !s.MovingBackwards && [1, 3, 4].includes(s.type));
    const nv = positions.length / 3;
    // weld vertices split at UV seams into one particle
    const key = i => `${positions[i * 3].toFixed(4)},${positions[i * 3 + 1].toFixed(4)},${positions[i * 3 + 2].toFixed(4)}`;
    const byKey = new Map(); this.vp = new Int32Array(nv); const reps = [];
    for (let i = 0; i < nv; i++) {
      const k = key(i);
      if (!byKey.has(k)) { byKey.set(k, reps.length); reps.push(i); }
      this.vp[i] = byKey.get(k);
    }
    const n = this.n = reps.length;
    this.rep = Int32Array.from(reps);
    this.pos = new Float32Array(n * 3); this.prev = new Float32Array(n * 3); this.target = new Float32Array(n * 3);
    this.skinIndex = skinIndex; this.skinWeight = skinWeight; this.bind = positions;
    // pinning from the cloth weight
    const lo = info.MinWeight ?? 0.1, hi = info.MaxWeight ?? 0.9, e = info.ClothBoneInfluenceExponent ?? 2;
    this.pin = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      const c = clothWeight[reps[p]], t = Math.min(1, Math.max(0, (c - lo) / Math.max(1e-6, hi - lo)));
      this.pin[p] = c <= lo ? 1 : Math.pow(1 - t, e);
    }
    // constraints: every edge, and across every pair of triangles sharing an edge (bending)
    const edges = new Map(), opposite = new Map();
    const addEdge = (a, b, c) => {
      if (a === b) return;
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!edges.has(k)) edges.set(k, [Math.min(a, b), Math.max(a, b)]);
      (opposite.get(k) || opposite.set(k, []).get(k)).push(c);
    };
    for (let t = 0; t < tris.length; t += 3) {
      const a = this.vp[tris[t]], b = this.vp[tris[t + 1]], c = this.vp[tris[t + 2]];
      addEdge(a, b, c); addEdge(b, c, a); addEdge(c, a, b);
    }
    const rest = (a, b) => {
      const i = reps[a] * 3, j = reps[b] * 3;
      return Math.hypot(positions[i] - positions[j], positions[i + 1] - positions[j + 1], positions[i + 2] - positions[j + 2]);
    };
    const cons = [];
    for (const [a, b] of edges.values()) cons.push([a, b, rest(a, b), 1]);
    const bend = Math.min(1, info.Stiffness ?? 0.6);
    for (const [k, opp] of opposite) if (opp.length === 2 && opp[0] !== opp[1]) cons.push([opp[0], opp[1], rest(opp[0], opp[1]), bend]);
    this.cons = cons;
    this.wtris = [];  // welded triangles, for particle normals (wind ripples)
    for (let t = 0; t < tris.length; t += 3) {
      const a = this.vp[tris[t]], b = this.vp[tris[t + 1]], c = this.vp[tris[t + 2]];
      if (a !== b && b !== c && c !== a) this.wtris.push(a, b, c);
    }
    this.nrm = new Float32Array(n * 3);
    this.wind = { dir: [0, 0, -1], speed: 0 }; this.root = [0, 0, 0]; this.vel = [0, 0, 0]; this.time = 0;
    this.started = false; this.acc = 0;
  }

  // skinned (body-driven) position of every particle, in world space
  updateTargets() {
    const mats = this.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, this.inverses[i]));
    for (let p = 0; p < this.n; p++) {
      const v = this.rep[p];
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < 4; j++) {
        const w = this.skinWeight[v * 4 + j]; if (!w) continue;
        _v.set(this.bind[v * 3], this.bind[v * 3 + 1], this.bind[v * 3 + 2]).applyMatrix4(mats[this.skinIndex[v * 4 + j]]);
        x += _v.x * w; y += _v.y * w; z += _v.z * w;
      }
      this.target[p * 3] = x; this.target[p * 3 + 1] = y; this.target[p * 3 + 2] = z;
    }
  }

  step(dt) {
    this.updateTargets();
    if (!this.target.every(Number.isFinite)) return;  // body not ready this frame
    if (this.started && !this.pos.every(Number.isFinite)) this.started = false;  // recover from a bad frame
    if (!this.started) {
      this.pos.set(this.target); this.prev.set(this.target); this.started = true;
      // a particle that rests inside a shape by design (the cape's own top edge sits inside the "ceiling"
      // cylinder above the shoulders) is not thrown out of it: shapes keep cloth from wandering in
      this.exempt = this.shapes.map(sh => { const m = new Uint8Array(this.n); this.collide(sh, m, true); return m; });
      this.settle(90); return;
    }
    this.acc = Math.min(this.acc + Math.min(dt, 0.1), 0.1);
    while (this.acc >= STEP) { this.substep(STEP); this.acc -= STEP; }
  }
  // wind: { dir (unit, world), speed } from wind.js; root: the character's world position; vel: its velocity
  setWind(wind, root, vel) { this.wind = wind; this.root = root; this.vel = vel; }
  // let a freshly made cloth fall into place before it is first seen
  settle(frames) { for (let i = 0; i < frames; i++) this.substep(STEP); }

  substep(h) {
    const { pos, prev, target, pin, n } = this, info = this.info;
    const drag = 1 - (info.Drag ?? 0.05), gravity = -(info.GravityScale ?? 3) * 10;
    // wind (0x169d550): steady push G, movement wind V, ripple direction D and strength |N|
    const w = this.wind, ws = w.speed * (info.WindSpeedScale ?? 1) * 10;
    const G = [w.dir[0] * ws, w.dir[1] * ws, w.dir[2] * ws], V = this.vel.map(x => -0.5 * x);
    const nw = info.NormalWindFromMovement ?? 0, fw = 5 * (info.FakeWindFromMovement ?? 0);
    const N = [G[0] + nw * V[0], G[1] + nw * V[1], G[2] + nw * V[2]], mag = Math.hypot(...N);
    const D = mag > 1e-6 ? N.map(x => x / mag) : [0, 0, 0];
    const A = [(G[0] + fw * V[0]) * h * h, (G[1] + gravity + fw * V[1]) * h * h, (G[2] + fw * V[2]) * h * h];
    const ripple = mag * h * 0.05 * (info.WindRippleScale ?? 1);
    const phase0 = 20 * (info.WindRippleWaveTimeScale ?? 1) * this.time, period = info.WindRippleWavePeriodScale ?? 1;
    this.time += h * (info.TimeScale ?? 1);
    if (ripple > 0) this.normals();
    const nrm = this.nrm, [rx, ry, rz] = this.root;
    for (let p = 0; p < n; p++) {  // Verlet (dynCloth 0x169d550)
      const i = p * 3;
      if (pin[p] >= 1) { prev[i] = pos[i] = target[i]; prev[i + 1] = pos[i + 1] = target[i + 1]; prev[i + 2] = pos[i + 2] = target[i + 2]; continue; }
      const r = ripple > 0
        ? Math.sin(((pos[i] - rx) * D[0] + (pos[i + 1] - ry) * D[1] + (pos[i + 2] - rz) * D[2] - phase0) * period) * ripple : 0;
      for (let a = 0; a < 3; a++) {
        const cur = pos[i + a], nxt = cur + (cur - prev[i + a] + nrm[i + a] * r) * drag + A[a];
        prev[i + a] = cur; pos[i + a] = nxt;
      }
    }
    const iters = Math.max(4, (info.NumIterations ?? 1) * 4);
    for (let it = 0; it < iters; it++) {
      for (const [a, b, r, k] of this.cons) {
        const wa = pin[a] >= 1 ? 0 : 1, wb = pin[b] >= 1 ? 0 : 1, ws = wa + wb; if (!ws) continue;
        const i = a * 3, j = b * 3;
        const dx = pos[j] - pos[i], dy = pos[j + 1] - pos[i + 1], dz = pos[j + 2] - pos[i + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-9, f = (d - r) / d * k / ws;
        pos[i] += dx * f * wa; pos[i + 1] += dy * f * wa; pos[i + 2] += dz * f * wa;
        pos[j] -= dx * f * wb; pos[j + 1] -= dy * f * wb; pos[j + 2] -= dz * f * wb;
      }
      this.shapes.forEach((sh, k) => this.collide(sh, this.exempt[k]));
      for (let p = 0; p < n; p++) {  // partly held particles are pulled toward the body
        const s = pin[p]; if (s <= 0 || s >= 1) continue;
        for (let a = 0; a < 3; a++) pos[p * 3 + a] += (target[p * 3 + a] - pos[p * 3 + a]) * s;
      }
    }
  }

  // unit normal per particle (area-weighted over its triangles)
  normals() {
    const { pos, nrm, wtris: t } = this;
    nrm.fill(0);
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { nrm[q] += nx; nrm[q + 1] += ny; nrm[q + 2] += nz; }
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
    }
  }

  // push particles out of (or, for InsideVolume, back into) one shape; with mark, only flag the particles
  // that are already where the shape doesn't allow them
  collide(s, exempt, mark = false) {
    const pr = this.info.ParticleCollisionRadius ?? 0.2, { pos, pin, n } = this;
    const M = s.node.matrixWorld;
    const o = new THREE.Vector3(...s.Offset).applyMatrix4(M);
    const dir = new THREE.Vector3(...s.Direction).transformDirection(M);
    const R = s.Radius + pr, isLine = s.type === 3 && (s.Direction[0] || s.Direction[1] || s.Direction[2]);
    for (let p = 0; p < n; p++) {
      if (pin[p] >= 1 || (!mark && exempt[p])) continue;
      const i = p * 3;
      let cx = o.x, cy = o.y, cz = o.z;
      if (isLine) {  // closest point on the cylinder's axis segment
        const t = (pos[i] - o.x) * dir.x + (pos[i + 1] - o.y) * dir.y + (pos[i + 2] - o.z) * dir.z;
        if (t < -s.Exten1 || t > s.Exten2) continue;
        cx += dir.x * t; cy += dir.y * t; cz += dir.z * t;
      }
      const dx = pos[i] - cx, dy = pos[i + 1] - cy, dz = pos[i + 2] - cz, d = Math.hypot(dx, dy, dz);
      if (s.InsideVolume ? d <= R : d >= R) continue;
      if (mark) { exempt[p] = 1; continue; }
      const f = (d > 1e-6 ? R / d : 0) - 1;
      pos[i] += dx * f; pos[i + 1] += dy * f; pos[i + 2] += dz * f;
    }
  }

  // The mesh to draw: the cloth mesh itself, or its Loop subdivision (2 levels) when Tessellate is set.
  // Positions are rows of weights over the particles; normals are computed on the welded mesh so they
  // stay smooth across UV seams.
  renderGeometry(tris, uv) {
    const r = this.render = this.info.Tessellate
      ? tessellate(tris, this.vp, this.n, uv || new Float32Array(this.vp.length * 2), 2, p => this.pin[p] >= 1)
      : { tris: Uint32Array.from(tris), rv2w: Int32Array.from(this.vp), uv: uv || new Float32Array(this.vp.length * 2),
          start: Int32Array.from({ length: this.n + 1 }, (_, i) => i), idx: Int32Array.from({ length: this.n }, (_, i) => i),
          w: new Float32Array(this.n).fill(1), nW: this.n };
    r.wpos = new Float32Array(r.nW * 3); r.wnrm = new Float32Array(r.nW * 3); r.local = new Float32Array(this.n * 3);
    const nR = r.rv2w.length, geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nR * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nR * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(r.uv, 2));
    geo.setIndex(new THREE.BufferAttribute(r.tris, 1));
    return geo;
  }

  // particle positions (world) -> the render geometry (character-local)
  write(geo, toLocal) {
    const r = this.render, L = r.local, P = r.wpos, N = r.wnrm;
    for (let p = 0; p < this.n; p++) {
      _v.set(this.pos[p * 3], this.pos[p * 3 + 1], this.pos[p * 3 + 2]).applyMatrix4(toLocal);
      L[p * 3] = _v.x; L[p * 3 + 1] = _v.y; L[p * 3 + 2] = _v.z;
    }
    for (let v = 0; v < r.nW; v++) {
      let x = 0, y = 0, z = 0;
      for (let k = r.start[v]; k < r.start[v + 1]; k++) { const p = r.idx[k] * 3, w = r.w[k]; x += L[p] * w; y += L[p + 1] * w; z += L[p + 2] * w; }
      P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    }
    N.fill(0);
    const t = r.tris, m = r.rv2w;
    for (let i = 0; i < t.length; i += 3) {
      const a = m[t[i]] * 3, b = m[t[i + 1]] * 3, c = m[t[i + 2]] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }
    }
    const pa = geo.attributes.position.array, na = geo.attributes.normal.array;
    for (let v = 0; v < m.length; v++) {
      const q = m[v] * 3, l = Math.hypot(N[q], N[q + 1], N[q + 2]) || 1;
      pa[v * 3] = P[q]; pa[v * 3 + 1] = P[q + 1]; pa[v * 3 + 2] = P[q + 2];
      na[v * 3] = N[q] / l; na[v * 3 + 1] = N[q + 1] / l; na[v * 3 + 2] = N[q + 2] / l;
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
  }
}
