// Smooth render mesh for cloth (DynClothInfo.Tessellate): Loop subdivision of the coarse cloth mesh.
// The game subdivides its cloth for drawing too; this is the standard Loop scheme, not a port of its code.
//
// Subdivision runs on the welded mesh (one vertex per particle, so UV seams don't tear), while the render
// mesh keeps its own corners for UVs (interpolated linearly). The result is a fixed sparse matrix from
// particles to fine vertices, so each frame is a weighted sum.
//   Loop rules: interior vertex (1 - n b) v + b sum(neighbours), b = 3/(8n) (n > 3) or 3/16;
//               boundary vertex 3/4 v + 1/8 (its two boundary neighbours);
//               interior edge 3/8 (a + b) + 1/8 (c + d); boundary edge 1/2 (a + b).
// Except where the cloth meets the body: particles held by it (the cape's top band, at the mantle) and
// corners (a boundary vertex with one triangle) stay put, and edges between held vertices split at their
// midpoint. Plain Loop smoothing pulls boundaries inward, rounding the cape's top corners off the shoulders.

// rows: array of Map(particle -> weight), one per welded vertex of the current level
function subdivide(level) {
  const { tris, rv2w, uv, rows, held } = level;
  const nW = rows.length;
  // welded topology
  const edgeKey = (a, b) => (a < b ? a * nW + b : b * nW + a);
  const edges = new Map();  // key -> { a, b, opp: [] , index }
  const nbr = Array.from({ length: nW }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) {
    const w = [rv2w[tris[t]], rv2w[tris[t + 1]], rv2w[tris[t + 2]]];
    for (let e = 0; e < 3; e++) {
      const a = w[e], b = w[(e + 1) % 3], c = w[(e + 2) % 3];
      if (a === b) continue;
      const k = edgeKey(a, b);
      if (!edges.has(k)) edges.set(k, { a, b, opp: [] });
      edges.get(k).opp.push(c);
      nbr[a].add(b); nbr[b].add(a);
    }
  }
  const boundaryNbr = Array.from({ length: nW }, () => []);
  for (const e of edges.values()) if (e.opp.length === 1) { boundaryNbr[e.a].push(e.b); boundaryNbr[e.b].push(e.a); }
  const mix = terms => {  // sum of coeff x row
    const out = new Map();
    for (const [c, r] of terms) for (const [p, w] of r) out.set(p, (out.get(p) || 0) + c * w);
    return out;
  };
  // new welded rows: old vertices (smoothed) then one per edge
  const newRows = [];
  for (let v = 0; v < nW; v++) {
    const bn = boundaryNbr[v];
    if (held[v] || (bn.length >= 2 && nbr[v].size === 2)) newRows.push(rows[v]);  // held, or a corner
    else if (bn.length >= 2) newRows.push(mix([[3 / 4, rows[v]], [1 / 8, rows[bn[0]]], [1 / 8, rows[bn[1]]]]));
    else {
      const n = nbr[v].size, b = n > 3 ? 3 / (8 * n) : 3 / 16;
      newRows.push(mix([[1 - n * b, rows[v]], ...[...nbr[v]].map(u => [b, rows[u]])]));
    }
  }
  const newHeld = [...held];
  for (const e of edges.values()) {
    e.index = newRows.length;
    newHeld.push(held[e.a] && held[e.b]);
    newRows.push(held[e.a] && held[e.b] ? mix([[1 / 2, rows[e.a]], [1 / 2, rows[e.b]]]) : e.opp.length === 2
      ? mix([[3 / 8, rows[e.a]], [3 / 8, rows[e.b]], [1 / 8, rows[e.opp[0]]], [1 / 8, rows[e.opp[1]]]])
      : mix([[1 / 2, rows[e.a]], [1 / 2, rows[e.b]]]));
  }
  // render side: corners stay, each render edge gets a midpoint corner
  const nR = rv2w.length;
  const newRv2w = [...rv2w], newUv = [...uv], rEdges = new Map();
  const mid = (ra, rb) => {
    const k = ra < rb ? ra * nR + rb : rb * nR + ra;
    if (!rEdges.has(k)) {
      rEdges.set(k, newRv2w.length);
      newRv2w.push(edges.get(edgeKey(rv2w[ra], rv2w[rb])).index);
      newUv.push((uv[ra * 2] + uv[rb * 2]) / 2, (uv[ra * 2 + 1] + uv[rb * 2 + 1]) / 2);
    }
    return rEdges.get(k);
  };
  const newTris = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    if (rv2w[a] === rv2w[b] || rv2w[b] === rv2w[c] || rv2w[c] === rv2w[a]) { newTris.push(a, b, c); continue; }
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    newTris.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return { tris: newTris, rv2w: newRv2w, uv: newUv, rows: newRows, held: newHeld };
}

// tris: render triangles; vp: render vertex -> particle; nParticles; uv: render uvs (2 per vertex);
// held(p): whether particle p is held by the body (kept in place)
export function tessellate(tris, vp, nParticles, uv, levels = 2, held = () => false) {
  let level = { tris: [...tris], rv2w: [...vp], uv: [...uv], held: Array.from({ length: nParticles }, (_, p) => !!held(p)),
                rows: Array.from({ length: nParticles }, (_, p) => new Map([[p, 1]])) };
  for (let i = 0; i < levels; i++) level = subdivide(level);
  // flatten the rows into CSR arrays
  const start = new Int32Array(level.rows.length + 1), idx = [], w = [];
  level.rows.forEach((r, i) => { for (const [p, x] of r) if (Math.abs(x) > 1e-7) { idx.push(p); w.push(x); } start[i + 1] = idx.length; });
  return { tris: Uint32Array.from(level.tris), rv2w: Int32Array.from(level.rv2w), uv: Float32Array.from(level.uv),
           start, idx: Int32Array.from(idx), w: Float32Array.from(w), nW: level.rows.length };
}
