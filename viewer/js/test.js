// Browser regression tests (viewer/test.html). They drive the real editor, loaded in a frame, through:
//  * saved costumes: every Costume_*.jpg in the game's Live/screenshots loads and saves back to the same text
//  * starting costumes: all of them load without errors and without a part far bigger than the body
//  * materials: every costume shader compiles and links (with and without normal maps, skinned and rigid)
//  * pose: the Costume pose / T-pose buttons change the pose, and picking a stance or mood switches back
// tests/run.py opens this page with ?auto=1 in a headless browser and collects the results the page posts
// to /api/test/results; opened by hand, press Run.
import * as THREE from 'three';
import { readCostumeJpeg } from './costume-file.js';
import { costumeText } from './file-ui.js';
import { loadShaders } from './catalog.js';
import { createGraphMaterial } from './shader-graph.js';
import { createCostumeMaterial } from './costume-material.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REST = 250;  // ms between costumes / batches of materials, so a long run doesn't hold the CPU at full load
const frame = $('editor');
let known = {};

// ---- results ------------------------------------------------------------------------------------
const sections = [];
function section(name) {
  const s = { name, checked: 0, failures: [], notes: [], seconds: 0 };
  sections.push(s);
  s.fail = msg => s.failures.push(msg);
  s.note = msg => s.notes.push(msg);
  return s;
}
function show() {
  $('results').replaceChildren(...sections.map(s => {
    const box = document.createElement('section');
    const h = document.createElement('h2');
    h.className = s.failures.length ? 'fail' : 'pass';
    h.textContent = `${s.failures.length ? 'FAIL' : 'PASS'} ${s.name}: ${s.checked} checked` +
      (s.failures.length ? `, ${s.failures.length} failed` : '') + (s.seconds ? ` · ${s.seconds.toFixed(0)} s` : '');
    box.append(h);
    for (const [list, cls] of [[s.failures, 'fail'], [s.notes, 'note']]) {
      if (!list.length) continue;
      const ul = document.createElement('ul');
      for (const m of list.slice(0, 40)) { const li = document.createElement('li'); li.className = cls; li.textContent = m; ul.append(li); }
      if (list.length > 40) { const li = document.createElement('li'); li.textContent = `… ${list.length - 40} more`; ul.append(li); }
      box.append(ul);
    }
    return box;
  }));
}
const state = t => { $('state').textContent = t; };

// ---- the editor under test ------------------------------------------------------------------------
let ed, win, errors = [];
async function startEditor() {
  frame.src = 'index.html?test=' + Date.now();
  await new Promise(r => { frame.onload = r; });
  win = frame.contentWindow;
  // collect the editor's errors while each test step runs
  const orig = win.console.error.bind(win.console);
  win.console.error = (...a) => { errors.push(a.map(x => x?.message || String(x)).join(' ')); orig(...a); };
  win.addEventListener('error', e => errors.push(e.message));
  win.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason?.message || e.reason)));
  const t0 = performance.now();
  while (!win.editor && performance.now() - t0 < 120000) await sleep(200);
  if (!win.editor) throw new Error('the editor did not start within 2 minutes (is the build ready?)');
  ed = win.editor;
  while (!ed.ch.group?.visible && performance.now() - t0 < 120000) await sleep(200);  // its first costume
}
const statusText = () => win.document.getElementById('status').textContent;
async function open(doc) {
  errors = [];
  await ed.open(doc);
  await sleep(50);
  return errors.splice(0);
}

// ---- saved costumes round-trip --------------------------------------------------------------------
async function testSavedCostumes() {
  const s = section('Saved costumes load and save back unchanged');
  const files = await fetch('api/test/costume-files').then(r => r.json());
  if (!files.length) s.note('No Costume_*.jpg files in the game\'s Live/screenshots folder; nothing to check.');
  for (const [i, f] of files.entries()) {
    state(`Saved costumes ${i + 1}/${files.length}: ${f}`);
    let info;
    try {
      info = readCostumeJpeg(await fetch('api/test/costume-file/' + encodeURIComponent(f)).then(r => r.arrayBuffer()));
    } catch (e) { s.fail(`${f}: can't be read: ${e.message}`); continue; }
    s.checked++;
    if (!info.hashOk) { s.note(`${f}: checksum doesn't match (changed outside the game; the game would reject it too)`); continue; }
    if (!['Male', 'Female'].includes(info.doc.skeleton)) { s.note(`${f}: skeleton ${info.doc.skeleton} isn't supported; skipped`); continue; }
    const errs = await open({ ...info.doc, name: info.character || info.doc.name });
    ed.ch.fileInfo = { account: info.account, character: info.character };
    if (errs.length) s.fail(`${f}: errors while loading: ${errs[0]}`);
    await sleep(REST);
    const text = costumeText(ed.ch, info.account, info.character);
    if (text !== info.text) {
      const a = info.text.split('\r\n'), b = text.split('\r\n');
      const k = a.findIndex((l, j) => l !== b[j]);
      s.fail(`${f}: saved text differs at line ${k + 1}: game "${(a[k] ?? '').trim()}" vs editor "${(b[k] ?? '').trim()}"`);
    }
  }
  return s;
}

// ---- starting costumes --------------------------------------------------------------------------------
async function testStartingCostumes() {
  const s = section('Starting costumes load cleanly');
  const costumes = ed.shared.costumes, allowed = known.oversized || {};
  for (const [i, c] of costumes.entries()) {
    state(`Starting costumes ${i + 1}/${costumes.length}: ${c.name}`);
    const errs = await open(c);
    s.checked++;
    if (errs.length) s.fail(`${c.name}: ${errs.length} error(s): ${errs[0]}`);
    const st = statusText();
    if (!/loaded/.test(st)) s.fail(`${c.name}: didn't finish loading (${st})`);
    const missing = st.match(/\((\d+) not installed\)/);
    if (missing) s.note(`${c.name}: ${missing[1]} part(s) not installed`);
    // no part far bigger than the body: a piece drawn with the wrong model or bones balloons. The editor
    // draws only 2 frames a second under test, so bring its skinning up to date here.
    ed.ch.group.updateMatrixWorld(true);
    ed.ch.group.traverse(o => { if (o.isSkinnedMesh) o.skeleton.update(); });
    const height = ed.ch.bodyValues?.height || 6;
    for (const [bone, p] of ed.ch.parts) {
      if (!p.mesh) continue;
      const box = new ed.THREE.Box3().setFromObject(p.mesh, true);
      if (box.isEmpty()) continue;
      const size = box.getSize(new ed.THREE.Vector3()), big = Math.max(size.x, size.y, size.z);
      if (big > height * 1.15 && !(allowed[c.name] || []).includes(bone))
        s.fail(`${c.name}: ${bone} (${p.part.geometry}) is ${big.toFixed(1)} ft across on a ${height.toFixed(1)} ft body`);
    }
    await sleep(REST);
  }
  return s;
}

// ---- materials ------------------------------------------------------------------------------------------
async function testMaterials() {
  const s = section('Every material compiles');
  const shaders = await loadShaders();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const renderer = new THREE.WebGLRenderer({ canvas });
  let current = '';
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join(' ').trim();
    s.fail(`${current}: ${log.slice(0, 300) || 'shader error'}`);
  };
  const warn = console.warn;
  console.warn = (...a) => { if (String(a[0]).startsWith('shader op not supported')) s.fail(`${current}: ${a.join(' ')}`); warn(...a); };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
  camera.position.z = 3;
  scene.add(new THREE.DirectionalLight(0xffffff, 1), new THREE.HemisphereLight(0xffffff, 0x333333, 1));
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const n = geo.attributes.position.count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 ? 0 : 1)), 4));
  const bone = new THREE.Bone(), skeleton = new THREE.Skeleton([bone]);
  const draw = (mat, what) => {
    current = what;
    for (const skinned of [true, false]) {
      const mesh = skinned ? new THREE.SkinnedMesh(geo, mat) : new THREE.Mesh(geo, mat);
      if (skinned) { mesh.add(bone); mesh.bind(skeleton); }
      scene.add(mesh);
      renderer.render(scene, camera);  // compiles and links (errors are checked when the program is first used)
      scene.remove(mesh);
    }
  };
  try {
    for (const [i, name] of Object.keys(shaders.materials).entries()) {
      state(`Materials: ${name}`);
      if (i % 10 === 9) await sleep(REST);
      const mat = createGraphMaterial(shaders, name);
      if (!mat) { s.fail(`${name}: no material made`); continue; }
      s.checked++;
      draw(mat, name);
      mat.userData.graph.noNormals = true;  // View → Normal maps off
      mat.needsUpdate = true;
      draw(mat, name + ' (normal maps off)');
      mat.dispose();
    }
    draw(createCostumeMaterial(), 'fallback costume material');
    s.checked++;
  } finally {
    console.warn = warn;
    renderer.dispose();
  }
  s.note(`${Object.keys(shaders.templates).length} shader templates, ${Object.keys(shaders.ops).length} operation types`);
  return s;
}

// ---- pose buttons -------------------------------------------------------------------------------------
async function testPose() {
  const s = section('Pose buttons and stances');
  const doc = win.document;
  const bones = () => ed.ch.rig.skeleton.bones.map(b => b.quaternion.toArray().map(v => v.toFixed(4)).join()).join('|');
  const button = label => [...doc.querySelectorAll('#stancePanel button')].find(b => b.textContent === label);
  const settle = async () => { await sleep(400); };
  doc.querySelector('.mainTabs button[data-tab="stance"]').click();
  for (const name of ['Archetype_Freeform_Free_M_01', 'Archetype_Freeform_Free_F_01']) {
    const c = ed.shared.costumes.find(x => x.name === name);
    if (!c) { s.note(`${name} isn't a starting costume here; skipped`); continue; }
    await open(c);
    await settle();
    const cat = ed.ch.cat, where = `${c.skeleton}`;
    const heroic = cat.stances.find(x => x.player && x.displayName === 'Heroic')?.name;
    s.checked++;
    if (ed.ch.mode !== 'idle') s.fail(`${where}: opens in "${ed.ch.mode}" mode, not the stance's idle`);
    // every player stance, in its idle and in the costume pose: an animation, and the two differ
    for (const st of cat.stances.filter(x => x.player)) {
      await ed.ch.setStance(st.name, 'idle');
      const idle = ed.ch.anim?.info;
      await ed.ch.setStance(st.name, 'creator');
      const pose = ed.ch.anim?.info;
      s.checked++;
      if (!idle) s.fail(`${where} ${st.displayName}: no idle animation`);
      if (!pose) s.fail(`${where} ${st.displayName}: no costume-pose animation`);
      if (idle && pose && idle === pose) s.fail(`${where} ${st.displayName}: the costume pose plays the same tracks as the idle`);
      for (const mood of cat.moods) {
        ed.ch.doc.mood = mood.name;
        await ed.ch.setStance(st.name, 'idle');
        if (!ed.ch.anim) s.fail(`${where} ${st.displayName} / ${mood.displayName}: no animation`);
      }
      ed.ch.doc.mood = 'Normal';
    }
    // the buttons, as a person would use them
    await ed.ch.setStance(heroic, 'idle'); ed.body.render(); await settle();
    const idleBones = bones();
    button('Costume pose').click(); await settle();
    s.checked++;
    if (ed.ch.mode !== 'creator' || !button('Costume pose').classList.contains('on')) s.fail(`${where}: Costume pose didn't turn on`);
    else if (bones() === idleBones) s.fail(`${where}: Costume pose is on but the body didn't move`);
    if (!doc.querySelector('#stancePanel .overridden')) s.fail(`${where}: stance and mood rows aren't shaded while the pose is on`);
    button('T-pose').click(); await settle();
    if (ed.ch.mode !== '' || ed.ch.anim) s.fail(`${where}: T-pose didn't turn on`);
    const stanceButton = [...doc.querySelectorAll('#stancePanel button')].find(b => b.textContent === cat.stances.find(x => x.name === heroic)?.displayName);
    stanceButton?.click(); await settle();
    if (!stanceButton) s.fail(`${where}: no Heroic stance button`);
    else if (ed.ch.mode !== 'idle' || ed.ch.doc.stance !== heroic) s.fail(`${where}: picking Heroic didn't switch back to its idle`);
    button('Costume pose').click(); await settle();
    button('Costume pose').click(); await settle();
    if (ed.ch.mode !== 'idle') s.fail(`${where}: turning Costume pose off didn't return to the idle`);
  }
  return s;
}

// ---- run ------------------------------------------------------------------------------------------
async function run() {
  $('run').disabled = true;
  sections.length = 0; show();
  const t0 = performance.now();
  let fatal = null;
  try {
    known = await fetch('api/test/known').then(r => (r.ok ? r.json() : {}));
    state('Starting the editor…');
    await startEditor();
    for (const t of [testMaterials, testPose, testSavedCostumes, testStartingCostumes]) {
      const t1 = performance.now();
      const s = await t();
      s.seconds = (performance.now() - t1) / 1000;
      show();
    }
  } catch (e) {
    fatal = (e.message || String(e)) + (e.stack ? '\n' + e.stack.split('\n').slice(0, 6).join('\n') : '');
    const s = section('Test run'); s.fail(fatal); show();
  }
  const failed = sections.reduce((n, s) => n + s.failures.length, 0);
  state(`${failed ? failed + ' failure(s)' : 'All passed'} · ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  $('run').disabled = false;
  const result = { done: true, fatal, seconds: (performance.now() - t0) / 1000,
                   sections: sections.map(({ name, checked, failures, notes, seconds }) => ({ name, checked, failures, notes, seconds })) };
  await fetch('api/test/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) })
    .catch(() => {});
}
$('run').onclick = run;
if (new URLSearchParams(location.search).has('auto')) run();
