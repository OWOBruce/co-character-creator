// Piece sheets for the index's descriptions (viewer/render.html; captions.py writes the list).
// Each listed piece goes on a plain mannequin of its body (the creator's default pieces, Heroic stance, standing
// still), and eight views are rendered into one sheet:
//   top:    full body from the front | the piece zoomed from the front | three-quarter front | side
//   bottom: full body from the back  | zoomed from the back | three-quarter back | the piece alone from above
// In the zoomed views the body is drawn faded and the piece is drawn over it, so a piece is seen whole from
// every side (an eye from behind the head, a belt from the back) with the body as a guide.
// Sheets are posted to /api/render/save (serve.py keeps them outside the project). The page renders one piece
// at a time with a rest in between, on the graphics card of a normal browser window.
import * as THREE from 'three';
import { Character } from './character.js';
import { loadCatalog } from './catalog.js';
import { newPart, pickPiece } from './rules.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TILE = 320, COLS = 4, ROWS = 2, REST = 300;
// a neutral scheme that keeps a pattern's four colour areas apart: light grey, mid blue, near black, red
const COLORS = [[205, 205, 205, 255], [60, 90, 170, 255], [35, 35, 35, 255], [175, 40, 40, 255]];
const BODY = [[105, 110, 120, 255], [105, 110, 120, 255], [105, 110, 120, 255], [105, 110, 120, 255]];  // the mannequin
const BACKGROUND = 0x8b95a3, FADE = 'rgba(139, 149, 163, 0.62)';

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(1);
renderer.setSize(TILE, TILE);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const background = new THREE.Color(BACKGROUND);
scene.background = background;
scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 6, 5); scene.add(key);
const rim = new THREE.DirectionalLight(0x9fb6ff, 1.0); rim.position.set(-4, 4, -5); scene.add(rim);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
const ch = new Character(scene);
Object.assign(ch.options, { bounce: false });
const sheet = document.createElement('canvas');
sheet.width = TILE * COLS; sheet.height = TILE * ROWS;
const g2 = sheet.getContext('2d');

// ---- the mannequin and the piece ---------------------------------------------------------------------
const mannequins = new Map();
async function mannequin(skeleton) {
  if (!mannequins.has(skeleton)) {
    const cat = await loadCatalog(skeleton);
    const parts = cat.requiredBones.filter(b => cat.bones[b]?.defaultGeo && cat.geometries[cat.bones[b].defaultGeo])
      .map(b => newPart(cat, b, cat.bones[b].defaultGeo, { colors: BODY, colorLink: 0 }));
    const heroic = cat.stances.find(s => s.player && s.displayName === 'Heroic')?.name || cat.defaultStance;
    mannequins.set(skeleton, { cat, doc: { name: 'mannequin', skeleton, stance: heroic, parts, bodyScale: [], scaleValues: {},
                                           colors: BODY } });
  }
  return mannequins.get(skeleton);
}
// the mannequin wearing the piece (and the child pieces it brings); -> the bones the piece is drawn on
async function dress(job) {
  const { cat, doc: base } = await mannequin(job.skeleton);
  if (!cat.geometries[job.geometry]) throw new Error('not in the catalog');
  const doc = structuredClone(base);
  const changes = pickPiece(cat, doc, job.bone, job.geometry, { look: { colors: COLORS, colorLink: 0 } });
  for (const { bone, part } of changes) {
    doc.parts = doc.parts.filter(p => p.bone !== bone);
    if (part) doc.parts.push(part);
  }
  await ch.load(doc);
  ch.applyOptions();
  if (ch.rig?.helper) ch.rig.helper.visible = false;
  const bones = changes.filter(c => c.part).map(c => c.bone);
  if (!ch.parts.get(job.bone)?.mesh) throw new Error(ch.parts.get(job.bone)?.error || 'no mesh (not installed?)');
  // stand still; let cloth settle (2 s of simulation) and the pose apply
  const cloth = bones.some(b => ch.parts.get(b)?.mesh?.userData.cloth);
  let now = performance.now();
  for (let i = 0; i < (cloth ? 120 : 2); i++) {
    now += 1000 / 60;
    ch.tick(now, false);
    scene.updateMatrixWorld();
    ch.afterMatrixUpdate(now);
  }
  return bones;
}

// ---- views -------------------------------------------------------------------------------------------
function bounds(objects) {
  const box = new THREE.Box3();
  for (const o of objects) {
    o.traverse(x => { if (x.isSkinnedMesh) x.skeleton.update(); });
    box.expandByObject(o, true);
  }
  return box;
}
// camera on a sphere around the box: azimuth 0 = the character's front, positive = towards its left side
function aim(box, azimuth, elevation, margin = 1.15) {
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.15);
  const dist = radius * margin / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  const a = THREE.MathUtils.degToRad(azimuth), e = THREE.MathUtils.degToRad(elevation);
  camera.position.set(center.x + dist * Math.sin(a) * Math.cos(e), center.y + dist * Math.sin(e), center.z + dist * Math.cos(a) * Math.cos(e));
  camera.near = Math.max(dist / 100, 0.005); camera.far = dist * 10;
  camera.updateProjectionMatrix();
  camera.lookAt(center);
}
// draw only these meshes, over a transparent background
function drawOnly(meshes) {
  const all = [...ch.parts.values()].map(p => p.mesh).filter(Boolean), keep = new Set(meshes);
  const was = all.map(m => m.visible);
  all.forEach(m => { m.visible = keep.has(m); });
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  scene.background = background;
  all.forEach((m, i) => { m.visible = was[i]; });
}
function label(col, row, text) {
  const x = col * TILE, y = row * TILE;
  g2.font = 'bold 15px system-ui, sans-serif';
  const w = g2.measureText(text).width + 12;
  g2.fillStyle = 'rgba(0,0,0,.55)'; g2.fillRect(x + 6, y + 6, w, 22);
  g2.fillStyle = '#fff'; g2.fillText(text, x + 12, y + 22);
  g2.strokeStyle = '#2a3140'; g2.lineWidth = 2; g2.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
}
// a view of everything as worn
function full(col, row, box, azimuth, text) {
  aim(box, azimuth, 5, 1.0);
  renderer.render(scene, camera);
  g2.drawImage(renderer.domElement, col * TILE, row * TILE, TILE, TILE);
  label(col, row, text);
}
// a zoomed view: the body faded, the piece drawn over it
function focus(col, row, box, piece, azimuth, elevation, text) {
  const x = col * TILE, y = row * TILE;
  aim(box, azimuth, elevation);
  renderer.render(scene, camera);
  g2.drawImage(renderer.domElement, x, y, TILE, TILE);
  g2.fillStyle = FADE; g2.fillRect(x, y, TILE, TILE);
  drawOnly(piece);
  g2.drawImage(renderer.domElement, x, y, TILE, TILE);
  label(col, row, text);
}
function renderSheet(bones) {
  const piece = bones.map(b => ch.parts.get(b)?.mesh).filter(Boolean);
  scene.updateMatrixWorld();
  const body = bounds([ch.group]), box = bounds(piece);
  full(0, 0, body, 0, 'full body, front');
  focus(1, 0, box, piece, 0, 8, 'front');
  focus(2, 0, box, piece, 40, 12, 'three-quarter front');
  focus(3, 0, box, piece, -90, 5, 'side');
  full(0, 1, body, 180, 'full body, back');
  focus(1, 1, box, piece, 180, 8, 'back');
  focus(2, 1, box, piece, 140, 12, 'three-quarter back');
  // the piece on its own, from above: its shape without the body
  const x = 3 * TILE, y = TILE;
  aim(box, -40, 40);
  g2.fillStyle = '#' + BACKGROUND.toString(16); g2.fillRect(x, y, TILE, TILE);
  drawOnly(piece);
  g2.drawImage(renderer.domElement, x, y, TILE, TILE);
  label(3, 1, 'piece alone, from above');
  return new Promise(r => sheet.toBlob(r, 'image/jpeg', 0.85));
}

// ---- the run -----------------------------------------------------------------------------------------
let stopping = false;
async function run() {
  $('start').disabled = true; $('stop').disabled = false; stopping = false;
  $('problems').replaceChildren();
  const redo = new URLSearchParams(location.search).has('redo');
  const { jobs, name } = await fetch('data/render_jobs.json', { cache: 'no-store' }).then(r => r.json());
  const done = new Set(redo ? [] : await fetch('api/render/done').then(r => r.json()));
  const limit = +new URLSearchParams(location.search).get('limit') || Infinity;  // a batch: this many sheets, then stop
  const left = jobs.filter(j => !done.has(`${j.skeleton}/${j.geometry}.jpg`)), todo = left.slice(0, limit);
  const t0 = performance.now();
  let n = 0;
  for (const job of todo) {
    if (stopping) break;
    $('state').textContent = `${name}: ${n + 1}/${todo.length} (${jobs.length - left.length} done before, ${left.length - todo.length} after this batch) · ${job.skeleton} ${job.displayName} (${job.geometry})`;
    try {
      const bones = await dress(job);
      const blob = await renderSheet(bones);
      const r = await fetch('api/render/save?name=' + encodeURIComponent(`${job.skeleton}/${job.geometry}.jpg`),
                            { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      if (!r.ok) throw new Error('saving failed: ' + r.status);
      const old = $('last').src; $('last').src = URL.createObjectURL(blob); if (old) URL.revokeObjectURL(old);
    } catch (e) {
      const li = document.createElement('li'); li.textContent = `${job.skeleton} ${job.geometry}: ${e.message}`; $('problems').append(li);
    }
    n++;
    await sleep(REST);
  }
  $('state').textContent = `${stopping ? 'Stopped' : 'Finished'}: ${n} rendered in ${((performance.now() - t0) / 1000).toFixed(0)} s` +
    ($('problems').children.length ? `, ${$('problems').children.length} problem(s) below` : '');
  $('start').disabled = false; $('stop').disabled = true;
}
$('start').onclick = run;
$('stop').onclick = () => { stopping = true; };
if (new URLSearchParams(location.search).has('auto')) run();
