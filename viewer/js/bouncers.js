// Bouncers: the engine's jiggle bones (hair, ears, belly, backpacks...), ported from GameClient:
//   0x16ba4c0  per-bouncer update       0x16ba2c0 / 0x16ba250  RK4 step of a damped spring
//   0x110d360  quaternion product (Hamilton)   0x7551d0 rotate a vector   0x110c7a0 pitch/yaw/roll -> quaternion
// Definitions come from DynBouncer.bin via the skeleton's SkelInfo.BouncerInfo (catalog `bouncers`).
//
// Every frame, for each bouncer bone (as the animation left it):
//   delta = its world position - last frame's; L = delta in the bouncer's frame (world rotation x Rotation)
//   Linear / Linear2 (1 or 2 axes):  v += -2 L.xy;  RK4(x, v, spring, DampRate, dt);  x clamped to +-MaxDist
//                                    local position += (localRot x Rotation) applied to (x0, x1, 0)
//   Hinge / Hinge2 (1 or 2 angles):  L = -L, L.z += 0.2;  kick = atan2(L.y, |L.xz|) [, atan2(L.x, L.z)]
//                                    v += kick;  RK4;  past +-MaxDist degrees: clamp and stop
//                                    local rotation = localRot x Rotation x euler(x0, x1, 0) x Rotation^-1
//   dt is capped at 0.05 s.
// Engine quaternions are the conjugates of three.js's (it uses row vectors), so the maths below runs on
// engine-convention (x, y, z, w) arrays and converts only when reading / writing bones.
import * as THREE from 'three';

const mul = (a, b) => [  // 0x110d360: a (x) b
  a[0] * b[3] + b[0] * a[3] + a[1] * b[2] - a[2] * b[1],
  a[1] * b[3] + a[3] * b[1] + b[0] * a[2] - a[0] * b[2],
  b[3] * a[2] + b[2] * a[3] + a[0] * b[1] - a[1] * b[0],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const conj = q => [-q[0], -q[1], -q[2], q[3]];
function rotate(q, v) {  // 0x7551d0
  const [x, y, z, w] = q;
  return [
    (w * w + x * x - z * z - y * y) * v[0] + 2 * ((z * w + x * y) * v[1] + (x * z - y * w) * v[2]),
    (y * y - x * x - z * z + w * w) * v[1] + 2 * ((x * y - z * w) * v[0] + (y * z + x * w) * v[2]),
    (z * z - x * x - y * y + w * w) * v[2] + 2 * ((x * z + y * w) * v[0] + (y * z - x * w) * v[1])];
}
function euler(p, y, r) {  // 0x110c7a0
  const s0 = Math.sin(p / 2), c0 = Math.cos(p / 2), s1 = Math.sin(y / 2), c1 = Math.cos(y / 2);
  const s2 = Math.sin(r / 2), c2 = Math.cos(r / 2);
  return [s0 * c1 * c2 + c0 * s1 * s2, s0 * c1 * s2 - c0 * s1 * c2, c0 * c1 * s2 - s0 * s1 * c2, c0 * c1 * c2 + s0 * s1 * s2];
}
// 0x16ba2c0: one RK4 step of x'' = -k x - c x'
function rk4(s, i, k, c, h) {
  const d = (dx, dv, t) => { const x = s.x[i] + dx * t, v = s.v[i] + dv * t; return [v, -k * x - c * v]; };
  const a = d(0, 0, 0), b = d(a[0], a[1], h / 2), e = d(b[0], b[1], h / 2), f = d(e[0], e[1], h);
  s.x[i] += (a[0] + 2 * (b[0] + e[0]) + f[0]) / 6 * h;
  s.v[i] += (a[1] + 2 * (b[1] + e[1]) + f[1]) / 6 * h;
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export class Bouncers {
  // defs: catalog bouncers; bones: Map lower-case name -> THREE.Bone (bones not in the map are skipped)
  constructor(defs, bones) {
    this.items = [];
    for (const def of defs) {
      const bone = bones.get(def.bone.toLowerCase());
      if (bone) this.add(bone, def);
    }
  }
  add(bone, def) {
    this.items.push({ bone, def, x: [0, 0], v: [0, 0], prev: null, base: null });
  }
  remove(bone) { this.items = this.items.filter(it => it.bone !== bone); }

  // put the bones back as the animation left them (before this frame's animation runs)
  restore() {
    for (const it of this.items) if (it.base) { it.bone.position.copy(it.base.pos); it.bone.quaternion.copy(it.base.quat); }
  }

  // toGame: matrix from world space to the game's own space (undoes the viewer's mirror)
  update(dt, toGame) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    for (const it of this.items) {
      const { bone, def } = it;
      it.base = { pos: bone.position.clone(), quat: bone.quaternion.clone() };
      _m.multiplyMatrices(toGame, bone.matrixWorld).decompose(_p, _q, _s);
      const P = [_p.x, _p.y, _p.z];
      if (!P.every(Number.isFinite)) continue;  // pose not ready this frame
      if (!it.x.every(Number.isFinite) || !it.v.every(Number.isFinite)) { it.x = [0, 0]; it.v = [0, 0]; it.prev = null; }
      const delta = it.prev ? [P[0] - it.prev[0], P[1] - it.prev[1], P[2] - it.prev[2]] : [0, 0, 0];
      it.prev = P;
      const world = [-_q.x, -_q.y, -_q.z, _q.w];  // engine convention
      const rot = def.rotation;
      const L = rotate(conj(mul(rot, world)), delta);
      const local = [-bone.quaternion.x, -bone.quaternion.y, -bone.quaternion.z, bone.quaternion.w];
      if (def.type <= 1) {  // Linear, Linear2
        const n = def.type === 1 ? 2 : 1, kick = [-L[0] * 2, -L[1] * 2];
        for (let i = 0; i < n; i++) {
          it.v[i] += kick[i];
          rk4(it, i, def.spring, def.damp, dt);
          it.x[i] = Math.max(-def.maxDist, Math.min(def.maxDist, it.x[i]));
        }
        const off = rotate(mul(local, rot), [it.x[0], n > 1 ? it.x[1] : 0, 0]);
        bone.position.x += off[0]; bone.position.y += off[1]; bone.position.z += off[2];
      } else {  // Hinge, Hinge2
        const max = def.maxDist * Math.PI / 180, n = def.type === 3 ? 2 : 1;
        const l = [-L[0], -L[1], -L[2] + 0.2];
        const kick = [Math.atan2(l[1], Math.hypot(l[0], l[2])), Math.atan2(l[0], l[2])];
        for (let i = 0; i < n; i++) {
          it.v[i] += kick[i];
          rk4(it, i, def.spring, def.damp, dt);
          if (Math.abs(it.x[i]) > max) { it.x[i] = Math.sign(it.x[i]) * max; it.v[i] = 0; }
        }
        const q = mul(mul(local, mul(rot, euler(it.x[0], n > 1 ? it.x[1] : 0, 0))), conj(rot));
        bone.quaternion.set(-q[0], -q[1], -q[2], q[3]);
      }
    }
    return this.items.length > 0;
  }
}
