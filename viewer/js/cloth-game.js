// The game's cloth solver, the one the editor uses, written afresh from how GameClient.exe's dynCloth*.c
// behaves (traced 2026-10-02; DEVELOPER.md "The game's solver"). Particles, skinning, wind input and
// drawing are shared with the editor's own solver (ClothBase, cloth.js). What this one does:
//  * A particle's mass is its weight w on the Cloth bone, its inverse mass 1/w; w = 0 pins it to the body.
//    Each step every particle is pulled toward where the body would put it by (1 - w)^e (e =
//    ClothBoneInfluenceExponent) and loses that share of its velocity, and its motion is damped by w^e.
//    MinWeight / MaxWeight play no part.
//  * Steps of 0.01 s x TimeScale of cloth time (split over NumIterations), 60 a second; gravity is
//    GravityScale x 32 ft/s^2, wind as in cloth.js.
//  * Each step: pull toward the body, Verlet, collision, then one constraint pass (Gauss-Seidel), weighted
//    by inverse mass (so particles near the body are the light ones) and scaled by Stiffness. Constraints,
//    built on the mesh's own vertices (none across a UV seam): every edge at 0.99 x its modelled length,
//    and the two vertices across each shared edge at 1.089 x their distance. A panel can't reach that, so
//    those keep pushing it open: the cloth flares rather than creases. Rest lengths follow the
//    character's height.
//  * Collision runs before the constraints. A Cylinder is capped: a particle inside is pushed out through
//    the nearest surface, ends included, so the big one above the shoulders acts as a ceiling. A Baloon is
//    a capsule and a Sphere a sphere. Radii follow the bone's scale across the axis. A partly held
//    particle takes w of the push, and a particle in contact moves a little less in the constraint pass.
// Not followed: the game takes one step per frame (up to 4 when frames are slow), so its cloth moves
// faster at high frame rates; here it is a steady 60 a second. Nor its "sleep" once the cloth is still.
import * as THREE from 'three';
import { ClothBase } from './cloth.js';

const HZ = 60;                         // steps per second
const STEP_TIME = 0.01;                // cloth time per step (x TimeScale)
const GRAVITY = -32;                   // ft/s^2, x GravityScale
const WIND = 10;                       // wind speed -> acceleration
const EDGE_REST = 1.1 * 0.9;           // edge rest length / modelled length
const ACROSS_REST = 1.1 * 1.1 * 0.9;   // across-edge rest length / modelled distance
const SETTLE = 120;                    // steps to fall into place when the cloth is made or restarted
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _s = new THREE.Vector3();

export class GameClothSim extends ClothBase {
  constructor(args) {
    super(args);
    const { positions, tris, clothWeight, info, shapes } = args, n = this.n;
    const e = info.ClothBoneInfluenceExponent ?? 2;
    this.inv = new Float32Array(n);   // inverse mass, 1/w (0: held by the body)
    this.w = new Float32Array(n);     // w: how much of a collision push the particle takes
    this.hold = new Float32Array(n);  // (1 - w)^e: pull toward the body per step
    this.damp = new Float32Array(n);  // w^e: on its velocity
    for (let p = 0; p < n; p++) {
      const w = Math.min(1, Math.max(0, clothWeight[this.rep[p]]));
      this.w[p] = w; this.inv[p] = w > 0 ? 1 / w : 0;
      this.hold[p] = Math.pow(1 - w, e); this.damp[p] = Math.pow(w, e);
    }
    this.contact = new Float32Array(n);  // how deep in a shape this pass (0..1 of the particle radius)

    // constraints, on the mesh's own vertices (as modelled), mapped to particles
    const nv = positions.length / 3, linked = new Set(), ca = [], cb = [], cr = [];
    const link = (a, b, f) => {
      const k = a < b ? a * nv + b : b * nv + a;
      if (a === b || linked.has(k)) return;
      linked.add(k);
      const pa = this.vp[a], pb = this.vp[b]; if (pa === pb) return;
      const d = Math.hypot(positions[a * 3] - positions[b * 3], positions[a * 3 + 1] - positions[b * 3 + 1],
                           positions[a * 3 + 2] - positions[b * 3 + 2]);
      ca.push(pa); cb.push(pb); cr.push(f * d);
    };
    const across = new Map();  // edge -> the vertices opposite it
    for (let t = 0; t < tris.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = tris[t + k], b = tris[t + (k + 1) % 3], c = tris[t + (k + 2) % 3];
        link(a, b, EDGE_REST);
        const key = a < b ? a * nv + b : b * nv + a;
        (across.get(key) || across.set(key, []).get(key)).push(c);
      }
    }
    for (const opp of across.values())
      for (let i = 0; i < opp.length; i++) for (let j = i + 1; j < opp.length; j++) link(opp[i], opp[j], ACROSS_REST);
    this.ca = Int32Array.from(ca); this.cb = Int32Array.from(cb); this.cr = Float32Array.from(cr);

    // collision shapes: the segment Point1..Point2 on the bone (Offset -/+ Direction x Exten)
    const at = (s, t) => s.Offset.map((o, i) => o + s.Direction[i] * t);
    this.shapes = shapes.filter(s => s.node && !s.MovingBackwards && [1, 3, 4].includes(s.type))
      .map(s => ({ ...s, p1: s.Point1 || at(s, -s.Exten1), p2: s.Point2 || at(s, s.Exten2),
                   c: [0, 0, 0], axis: [0, 0, 0], h: 0, R: 0 }));

    this.scale = 1;                          // the character's height scale (set by Character each frame)
    this.from = new Float32Array(n * 3);     // the body's positions at the last step
    this.goal = new Float32Array(n * 3);     // ... at this step (between the frames' positions)
  }

  held(p) { return this.inv[p] === 0; }

  step(dt) {
    this.updateTargets();
    if (!this.target.every(Number.isFinite)) return;  // body not ready this frame
    if (this.started && !this.pos.every(Number.isFinite)) this.started = false;  // recover from a bad frame
    this.placeShapes();
    if (!this.started) {
      this.pos.set(this.target); this.prev.set(this.target); this.from.set(this.target);
      this.started = true; this.acc = 0;
      for (let i = 0; i < SETTLE; i++) this.tick(this.target);
      return;
    }
    this.acc = Math.min(this.acc + Math.max(0, dt), 4 / HZ);
    const steps = Math.floor(this.acc * HZ + 1e-6);
    if (!steps) return;
    this.acc -= steps / HZ;
    const { from, target, goal } = this;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      for (let i = 0; i < goal.length; i++) goal[i] = from[i] + (target[i] - from[i]) * t;
      this.tick(goal);
    }
    from.set(target);
  }

  // one step of the cloth, toward the body's positions T
  tick(T) {
    const { pos, prev, hold, n } = this, info = this.info;
    const iters = Math.min(8, Math.max(1, info.NumIterations ?? 1));
    const h = STEP_TIME * (info.TimeScale ?? 1) / iters;
    for (let p = 0; p < n; p++) {  // pulled toward the body, losing as much of its velocity
      const k = hold[p]; if (!k) continue;
      for (let i = p * 3; i < p * 3 + 3; i++) {
        const x = pos[i] + (T[i] - pos[i]) * k;
        prev[i] += (x - prev[i]) * k; pos[i] = x;
      }
    }
    for (let it = 0; it < iters; it++) {
      this.time += h;
      this.integrate(h, iters);
      this.collide();
      this.constrain(1 / iters);
    }
  }

  // Verlet, with gravity and the wind (as cloth.js: steady push, movement wind, ripples along the normal)
  integrate(h, iters) {
    const { pos, prev, inv, damp, n } = this, info = this.info;
    const drag = 1 - Math.min(0.5, Math.max(0, info.Drag ?? 0.05)) / iters;
    const gravity = (info.GravityScale ?? 3) * GRAVITY;
    const w = this.wind, ws = w.speed * (info.WindSpeedScale ?? 1) * WIND;
    const G = [w.dir[0] * ws, w.dir[1] * ws, w.dir[2] * ws], V = this.vel.map(x => -0.5 * x);
    const nw = info.NormalWindFromMovement ?? 0, fw = 5 * (info.FakeWindFromMovement ?? 0);
    const N = [G[0] + nw * V[0], G[1] + nw * V[1], G[2] + nw * V[2]], mag = Math.hypot(...N);
    const D = mag > 1e-6 ? N.map(x => x / mag) : [0, 0, 0];
    const A = [(G[0] + fw * V[0]) * h * h, (G[1] + gravity + fw * V[1]) * h * h, (G[2] + fw * V[2]) * h * h];
    const ripple = mag * h * 0.05 * (info.WindRippleScale ?? 1);
    const phase0 = 20 * (info.WindRippleWaveTimeScale ?? 1) * this.time, period = info.WindRippleWavePeriodScale ?? 1;
    if (ripple > 0) this.normals();
    const nrm = this.nrm, [rx, ry, rz] = this.root;
    for (let p = 0; p < n; p++) {
      if (!inv[p]) continue;
      const i = p * 3, k = drag * damp[p];
      const r = ripple > 0
        ? Math.sin(((pos[i] - rx) * D[0] + (pos[i + 1] - ry) * D[1] + (pos[i + 2] - rz) * D[2] - phase0) * period) * ripple : 0;
      for (let a = 0; a < 3; a++) {
        const cur = pos[i + a];
        pos[i + a] = cur + (cur - prev[i + a] + nrm[i + a] * r) * k + A[a];
        prev[i + a] = cur;
      }
    }
  }

  // the shapes where the bones are now
  placeShapes() {
    for (const s of this.shapes) {
      const M = s.node.matrixWorld;
      _a.fromArray(s.p1).applyMatrix4(M); _b.fromArray(s.p2).applyMatrix4(M);
      // the radius follows the bone's scale across the axis
      _s.setFromMatrixScale(M); _s.set(Math.abs(_s.x), Math.abs(_s.y), Math.abs(_s.z));
      const d = s.Direction, along = d[0] * _s.x + d[1] * _s.y + d[2] * _s.z;
      s.R = s.Radius * Math.max(_s.x - d[0] * along, _s.y - d[1] * along, _s.z - d[2] * along);
      if (s.type === 1) { s.c = _a.toArray(); continue; }
      const L = _a.distanceTo(_b);
      s.c = _a.clone().add(_b).multiplyScalar(0.5).toArray();
      s.axis = L > 1e-6 ? _b.clone().sub(_a).divideScalar(L).toArray() : [0, 0, 0];
      s.h = L / 2;
    }
  }

  // push the particles out of each shape (partly held ones take w of it)
  collide() {
    const { pos, inv, w, contact, n } = this, r = this.info.ParticleCollisionRadius ?? 0.2;
    contact.fill(0);
    for (const s of this.shapes) {
      for (let p = 0; p < n; p++) {
        if (!inv[p]) continue;
        const i = p * 3, x = pos[i], y = pos[i + 1], z = pos[i + 2];
        const depth = this.pushOut(s, i, r);
        if (depth <= 0) continue;
        contact[p] = Math.max(contact[p], Math.min(1, depth / r));
        const k = w[p];
        pos[i] = x + (pos[i] - x) * k; pos[i + 1] = y + (pos[i + 1] - y) * k; pos[i + 2] = z + (pos[i + 2] - z) * k;
      }
    }
  }

  // move the particle at pos[i..] out of shape s (r: the particle's radius); how deep it was, 0 if outside
  pushOut(s, i, r) {
    const pos = this.pos, R = s.R + r;
    let dx = pos[i] - s.c[0], dy = pos[i + 1] - s.c[1], dz = pos[i + 2] - s.c[2];
    if (s.type === 1 || s.type === 4) {  // sphere, or capsule (around the nearest point of its segment)
      if (s.type === 4) {
        const ax = s.axis, t = Math.max(-s.h, Math.min(s.h, dx * ax[0] + dy * ax[1] + dz * ax[2]));
        dx -= ax[0] * t; dy -= ax[1] * t; dz -= ax[2] * t;
      }
      const d = Math.hypot(dx, dy, dz);
      if (d >= R || d < 1e-6) return 0;
      const f = (R - d) / d;
      pos[i] += dx * f; pos[i + 1] += dy * f; pos[i + 2] += dz * f;
      return R - d;
    }
    // capped cylinder: out through the side or an end, whichever is nearer
    const ax = s.axis, along = dx * ax[0] + dy * ax[1] + dz * ax[2];
    const toEnd = s.h + r - Math.abs(along);
    if (toEnd <= 0) return 0;
    const qx = dx - ax[0] * along, qy = dy - ax[1] * along, qz = dz - ax[2] * along, q = Math.hypot(qx, qy, qz);
    if (q > R) return 0;
    const toSide = R - q;
    if (q > 0 && toSide <= toEnd) {
      const f = toSide / q;
      pos[i] += qx * f; pos[i + 1] += qy * f; pos[i + 2] += qz * f;
      return toSide;
    }
    const sgn = along >= 0 ? toEnd : -toEnd;
    pos[i] += ax[0] * sgn; pos[i + 1] += ax[1] * sgn; pos[i + 2] += ax[2] * sgn;
    return toEnd;
  }

  // one pass over the constraints, weighted by inverse mass and scaled by Stiffness
  constrain(k) {
    const { pos, inv, contact, ca, cb, cr } = this;
    const stiff = Math.min(1, Math.max(0.01, this.info.Stiffness ?? 0.6)) * k, scale = this.scale;
    for (let c = 0; c < ca.length; c++) {
      const a = ca[c], b = cb[c];
      let wa = inv[a], wb = inv[b];
      if (contact[a] > 0) wa /= 1 + 0.1 * contact[a] * contact[a];
      if (contact[b] > 0) wb /= 1 + 0.1 * contact[b] * contact[b];
      const sum = wa + wb; if (!sum) continue;
      const i = a * 3, j = b * 3;
      const dx = pos[j] - pos[i], dy = pos[j + 1] - pos[i + 1], dz = pos[j + 2] - pos[i + 2];
      const d = Math.hypot(dx, dy, dz); if (!(d > 0)) continue;
      const f = (d - cr[c] * scale) / (d * sum) * stiff;
      pos[i] += dx * f * wa; pos[i + 1] += dy * f * wa; pos[i + 2] += dz * f * wa;
      pos[j] -= dx * f * wb; pos[j + 1] -= dy * f * wb; pos[j + 2] -= dz * f * wb;
    }
  }
}
