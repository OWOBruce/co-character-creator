// Character sheet: a 3840x2160 (16:9) PNG of the current character. Face close-ups that fade out at
// their edges on the left (three-quarter from the character's left, front, three-quarter from the right:
// the two sides of a costume can differ); front, left, back and right full-body views on the right. On
// the tailor's blue backdrop, white or black. Saved where the player chooses (the browser's save
// dialog), or downloaded where that dialog isn't available.
//
// Every view is drawn in the same instant, so the idle pose is the same in all of them. The key and rim
// lights turn with the camera, so each side is lit as the front is.
import * as THREE from 'three';

const W = 3840, H = 2160, MARGIN = 60;
// face close-ups (square), stacked; degrees turned from where the face points, towards the character's left
const FACE = { x: MARGIN, size: 640, gap: 40, angles: [45, 0, -45] };
FACE.y = (H - FACE.angles.length * FACE.size - (FACE.angles.length - 1) * FACE.gap) / 2;
const BODY = { x: FACE.x + FACE.size + 60, y: MARGIN, h: H - 2 * MARGIN - 90 };  // body views, labels below
BODY.w = W - MARGIN - BODY.x;
const VIEWS = [['Front', 0], ['Left', 90], ['Back', 180], ['Right', 270]];
const FOV = 20;  // a long lens: little perspective distortion
export const BACKGROUNDS = {
  blue: { label: 'Blue', text: '#ffd21f', outline: '#000', sub: '#a9c3ea' },
  white: { label: 'White', fill: '#ffffff', text: '#161616', outline: null, sub: '#555' },
  black: { label: 'Black', fill: '#000000', text: '#f2f2f2', outline: null, sub: '#999' },
};

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// points on the drawn meshes (sampled skinned vertices, body sliders applied), in world space
function meshPoints(objects, per = 4000) {
  const pts = [], v = new THREE.Vector3();
  for (const root of objects) root.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const pos = o.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / per));
    for (let i = 0; i < pos.count; i += step) {
      if (o.isSkinnedMesh) o.getVertexPosition(i, v); else v.fromBufferAttribute(pos, i);
      pts.push(v.clone().applyMatrix4(o.matrixWorld));
    }
  });
  return pts;
}
const meshBox = objects => new THREE.Box3().setFromPoints(meshPoints(objects));

// view: { renderer, scene, ch, lights: [DirectionalLight], hide: () => [objects to hide], characterBox }
export async function renderSheet(view, background) {
  const { renderer, scene, ch, lights } = view;
  const bg = BACKGROUNDS[background] || BACKGROUNDS.blue;
  const sheet = document.createElement('canvas'); sheet.width = W; sheet.height = H;
  const g = sheet.getContext('2d');
  await document.fonts.load('52px Bangers').catch(() => {});  // the view labels
  if (bg.fill) { g.fillStyle = bg.fill; g.fillRect(0, 0, W, H); }
  else {  // the tailor backdrop, covering the sheet
    const img = await loadImage('ui/backdrop.jpg');
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    g.drawImage(img, (W - img.naturalWidth * s) / 2, (H - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
  }

  // renderer state to put back
  const size = renderer.getSize(new THREE.Vector2()), ratio = renderer.getPixelRatio();
  const clear = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
  const lightPos = lights.map(l => l.position.clone());
  const hidden = view.hide().filter(o => o && o.visible);
  hidden.forEach(o => (o.visible = false));
  const gl = renderer.getContext();
  const maxSize = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

  // one view into a canvas of w x h (supersampled 2x when the GPU allows): cam, placed by the caller,
  // with the lights turned by deg as the camera is
  const shot = (w, h, deg, cam) => {
    const ss = Math.max(1, Math.min(2, Math.floor(maxSize / Math.max(w, h))));
    const turn = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(deg));
    lights.forEach((l, i) => l.position.copy(lightPos[i]).applyMatrix4(turn));
    cam.updateProjectionMatrix();
    renderer.setPixelRatio(1); renderer.setSize(w * ss, h * ss, false);
    renderer.setClearColor(0x000000, 0);
    scene.updateMatrixWorld(); ch.afterMatrixUpdate();
    renderer.render(scene, cam);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cg = c.getContext('2d'); cg.imageSmoothingQuality = 'high';
    cg.drawImage(renderer.domElement, 0, 0, w, h);
    return c;
  };

  try {
    // full body, orthographic (a turnaround: no perspective, the same scale in every view). Each view is
    // as wide as the character is from that side, and one scale fits the tallest and the widest of them.
    scene.updateMatrixWorld(); ch.afterMatrixUpdate();
    const pts = meshPoints([ch.group], 3000);
    let yMin = Infinity, yMax = -Infinity;
    for (const p of pts) { yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y); }
    const sides = VIEWS.map(([label, deg]) => {
      const a = THREE.MathUtils.degToRad(deg), right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { const u = p.dot(right); lo = Math.min(lo, u); hi = Math.max(hi, u); }
      return { label, deg, a, right, lo, hi, w: (hi - lo) * 1.04 };
    });
    const gap = 24, avail = BODY.w - gap * (VIEWS.length - 1), hgt = (yMax - yMin) * 1.04;
    const scale = Math.min(BODY.h / hgt, avail / sides.reduce((n, s) => n + s.w, 0));  // pixels per foot
    const pad = (avail - sides.reduce((n, s) => n + s.w * scale, 0)) / VIEWS.length;
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 400);
    let x = BODY.x;
    for (const s of sides) {
      const cw = Math.round(s.w * scale + pad), chh = BODY.h, far = 100;
      const center = s.right.clone().multiplyScalar((s.lo + s.hi) / 2).setY((yMin + yMax) / 2);
      Object.assign(ortho, { left: -cw / 2 / scale, right: cw / 2 / scale, top: chh / 2 / scale, bottom: -chh / 2 / scale });
      ortho.position.set(center.x + Math.sin(s.a) * far, center.y, center.z + Math.cos(s.a) * far);
      ortho.lookAt(center);
      g.drawImage(shot(cw, chh, s.deg, ortho), x, BODY.y);
      text(g, bg, s.label, x + cw / 2, BODY.y + chh / 2 + hgt * scale / 2 + 62, 52, 'center');  // under the feet
      x += cw + gap;
    }
    const target = new THREE.Vector3(0, (yMin + yMax) / 2, 0);

    // face: the head piece's extent (or the head bone), framed from the front, then feathered
    const head = [...ch.parts.entries()].find(([b]) => /^[a-z]*_head$/i.test(b))?.[1]?.mesh;
    let fc, fsize;
    if (head) { const hb = meshBox([head]); fc = hb.getCenter(new THREE.Vector3()); fsize = Math.max(hb.max.y - hb.min.y, hb.max.x - hb.min.x); }
    if (!fsize || !isFinite(fsize)) {
      const bone = ch.rig?.byName.get('head');
      fc = bone ? new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).add(new THREE.Vector3(0, 0.35, 0)) : target.clone();
      fsize = 0.9;
    }
    // from where the face points (stances turn and tilt the head), with the tilt halved
    const headBone = ch.rig?.byName.get('head');
    const look = headBone ? new THREE.Vector3(0, 0, 1).transformDirection(headBone.matrixWorld) : new THREE.Vector3(0, 0, 1);
    look.y *= 0.5;
    if (look.lengthSq() < 1e-6 || look.z < -0.2) look.set(0, 0, 1);  // not facing us at all: plain front
    look.normalize();
    const persp = new THREE.PerspectiveCamera(FOV, 1, 0.05, 400);
    FACE.angles.forEach((deg, i) => {
      const dir = look.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
      persp.position.copy(fc).addScaledVector(dir, (fsize * 0.95) / tan); persp.lookAt(fc);
      const face = shot(FACE.size, FACE.size, THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z)), persp);
      const fg = face.getContext('2d');
      const r = FACE.size / 2, grad = fg.createRadialGradient(r, r, r * 0.55, r, r, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      fg.globalCompositeOperation = 'destination-in'; fg.fillStyle = grad; fg.fillRect(0, 0, FACE.size, FACE.size);
      g.drawImage(face, FACE.x, FACE.y + i * (FACE.size + FACE.gap));
    });
  } finally {
    lights.forEach((l, i) => l.position.copy(lightPos[i]));
    renderer.setPixelRatio(ratio); renderer.setSize(size.x, size.y, false);
    renderer.setClearColor(clear, clearAlpha);
    hidden.forEach(o => (o.visible = true));
    scene.updateMatrixWorld(); ch.afterMatrixUpdate();
  }
  return sheet;
}

function text(g, bg, s, x, y, px, align) {
  g.font = `${px}px Bangers, Impact, sans-serif`; g.textAlign = align; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = `${Math.round(px * 0.04)}px`;
  if (bg.outline) { g.lineJoin = 'round'; g.lineWidth = px * 0.12; g.strokeStyle = bg.outline; g.strokeText(s, x, y); }
  g.fillStyle = bg.text; g.fillText(s, x, y);
}

// Where to save: the file the player picks (File System Access API; asked first, while the click still
// counts as the player's), else a download. -> { write(blob) -> description } or null if they cancelled.
async function saveTarget(name) {
  if (window.showSaveFilePicker) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }] });
    } catch (e) { if (e.name === 'AbortError') return null; throw e; }
    return { write: async blob => { const w = await handle.createWritable(); await w.write(blob); await w.close(); return `Saved ${handle.name}`; } };
  }
  return { write: async blob => {
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return `Downloaded ${name}`;
  } };
}

// The export dialog: background choice, then render and save. view as for renderSheet, plus status(text).
export function openSheetDialog(view, anchor) {
  document.querySelector('.sheetDialog')?.remove();
  const box = el('div', 'palette sheetDialog');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Export character sheet');
  box.append(el('div', 'phead', 'Character sheet'),
    el('div', 'hint', 'A 3840 × 2160 picture: the face from three angles and the character from four sides.'));
  let choice = 'blue';
  try { choice = localStorage.getItem('co.sheetBg') || choice; } catch { /* private mode */ }
  const row = el('div', 'bgChoices'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', 'Background');
  const buttons = Object.entries(BACKGROUNDS).map(([k, b]) => {
    const btn = el('button', 'bgChoice bg-' + k, b.label); btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.onclick = () => { choice = k; sync(); };
    row.append(btn); return [k, btn];
  });
  const sync = () => buttons.forEach(([k, b]) => { b.classList.toggle('on', k === choice); b.setAttribute('aria-checked', String(k === choice)); });
  sync();
  const state = el('div', 'hint'); state.setAttribute('role', 'status');
  const foot = el('div', 'row'), go = el('button', null, 'Export…'), cancel = el('button', null, 'Cancel');
  go.type = cancel.type = 'button';
  foot.append(go, cancel);
  box.append(row, state, foot);
  document.body.append(box);
  const r = anchor?.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(r ? r.left : 392, innerWidth - box.offsetWidth - 8)) + 'px';
  box.style.top = (r ? r.bottom + 6 : 60) + 'px';
  const close = () => box.remove();
  cancel.onclick = close;
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  go.onclick = async () => {
    try { localStorage.setItem('co.sheetBg', choice); } catch { /* private mode */ }
    go.disabled = true;
    try {
      const name = ((view.ch.fileInfo?.character || view.ch.doc.name || 'Character').replace(/^Archetype_/, '')
        .replace(/[\\/:*?"<>|]/g, '') || 'Character') + ' character sheet.png';
      state.textContent = 'Choose where to save it…';
      const target = await saveTarget(name);
      if (!target) { state.textContent = 'Not saved.'; go.disabled = false; return; }
      state.textContent = 'Drawing…';
      await new Promise(res => requestAnimationFrame(res));  // let "Drawing…" show
      const sheet = await renderSheet(view, choice);
      const blob = await new Promise(res => sheet.toBlob(res, 'image/png'));
      view.status(await target.write(blob));
      close();
    } catch (e) { state.textContent = 'Could not export: ' + e.message; go.disabled = false; console.warn(e); }
  };
  go.focus();
}
