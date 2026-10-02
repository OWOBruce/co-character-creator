// The browser's mesh reader (viewer/js/mset.js) on meshes tests/run.py wrote out: node tests/mset_parity.mjs manifest.json
// manifest: [{file, hint}] -> prints [{file, models, model, verts, tris, posSum, triSum, error}] as JSON, which
// run.py compares with tools/mset.py.
import { readFileSync } from 'node:fs';
import { MSet } from '../viewer/js/mset.js';

const out = [];
for (const { file, hint } of JSON.parse(readFileSync(process.argv[2], 'utf8'))) {
  try {
    const bytes = readFileSync(file);
    const m = new MSet(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    const idx = m.modelIndex(hint);
    const mesh = await m.lod(idx, 0).mesh();
    let posSum = 0, triSum = 0;
    for (const v of mesh.positions) posSum += v;
    for (const v of mesh.tris) triSum += v;
    out.push({ file, models: m.models.map(x => x.name), model: m.models[idx].name, verts: mesh.vertCount,
               tris: mesh.tris.length / 3, posSum, triSum });
  } catch (e) { out.push({ file, error: String(e && e.message || e) }); }
}
process.stdout.write(JSON.stringify(out));
