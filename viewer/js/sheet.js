// Character sheet: a 3840x2160 (16:9) PNG of the current character. Face close-ups that fade out at
// their edges on the left (three-quarter from the character's left, front, three-quarter from the right:
// the two sides of a costume can differ); front, left, back and right full-body views on the right. On
// the tailor's blue backdrop, white, black or the 3D view's background. An optional name goes at the top
// left, in the player's font and colour (solid or a top-to-bottom gradient), with a black outline unless
// turned off; the faces move down (and shrink a little) to make room. Saved where the player chooses (the browser's save
// dialog), or downloaded where that dialog isn't available.
//
// Every view is drawn in the same instant, so the idle pose is the same in all of them. The lights turn
// with the camera, so each side is lit as the front is (the page turns them back on its next frame).
import * as THREE from 'three';
import { drawBackdrop, backdropLightness } from './backdrop.js';

const W = 3840, H = 2160, MARGIN = 60;
// face close-ups (square), stacked; degrees turned from where the face points, towards the character's left
const FACE = { x: MARGIN, size: 640, gap: 40, angles: [45, 0, -45] };
FACE.y = (H - FACE.angles.length * FACE.size - (FACE.angles.length - 1) * FACE.gap) / 2;
const BODY = { x: FACE.x + FACE.size + 60, y: MARGIN, h: H - 2 * MARGIN - 90 };  // body views, labels below
BODY.w = W - MARGIN - BODY.x;
const VIEWS = [['Front', 0], ['Left', 90], ['Back', 180], ['Right', 270]];
const FOV = 20;  // a long lens: little perspective distortion
// The name's fonts: open-source display faces (SIL Open Font License, or Apache for Luckiest Guy and
// Permanent Marker) from Google Fonts. weight: the one loaded, when not the regular.
export const NAME_FONTS = [
  { family: 'Bangers', label: 'Bangers (comic)' },
  { family: 'Luckiest Guy', label: 'Luckiest Guy (cartoon)' },
  { family: 'Bungee', label: 'Bungee (bold block)' },
  { family: 'Black Ops One', label: 'Black Ops One (military)' },
  { family: 'Orbitron', label: 'Orbitron (sci-fi)', weight: 900 },
  { family: 'Audiowide', label: 'Audiowide (techno)' },
  { family: 'Cinzel Decorative', label: 'Cinzel Decorative (fantasy)', weight: 900 },
  { family: 'Metal Mania', label: 'Metal Mania (heavy metal)' },
  { family: 'Creepster', label: 'Creepster (horror)' },
  { family: 'Permanent Marker', label: 'Permanent Marker (handwritten)' },
];
// colours: one, or [top, bottom] for a gradient
export const NAME_SOLIDS = { Gold: '#ffd21f', White: '#ffffff', Red: '#e8202a', Blue: '#2f8bff', Green: '#3bd16f',
                             Purple: '#a55bff', Silver: '#c9d1dc', Black: '#151515' };
export const NAME_GRADIENTS = { 'Hero gold': ['#fff27a', '#ff9d00'], Fire: ['#ffe14d', '#ff2a00'], Ice: ['#ffffff', '#3fa9ff'],
                                Toxic: ['#e4ff5c', '#16b33a'], Royal: ['#e2c4ff', '#5a1fb8'], Chrome: ['#ffffff', '#7d8796'],
                                Sunset: ['#ffcf5c', '#ff3d7f'], Night: ['#8fe3ff', '#23308f'] };
let fontsLinked = null;
// Load a name font: the stylesheet for all of them once, then the face itself. False if it can't be had
// (offline): the name is then drawn in Bangers, which the page always has.
export async function loadNameFont(family) {
  const f = NAME_FONTS.find(x => x.family === family) || NAME_FONTS[0];
  fontsLinked ||= new Promise(res => {
    const link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?' + NAME_FONTS.filter(x => x.family !== 'Bangers')
      .map(x => 'family=' + x.family.replace(/ /g, '+') + (x.weight ? ':wght@' + x.weight : '')).join('&') + '&display=block';
    link.onload = link.onerror = res; setTimeout(res, 4000);
    document.head.append(link);
  });
  await fontsLinked;
  try { return (await document.fonts.load(`${f.weight || 400} 100px "${f.family}"`)).length > 0; } catch { return false; }
}

export const BACKGROUNDS = {
  blue: { label: 'Blue', text: '#ffd21f', outline: '#000', sub: '#a9c3ea' },
  white: { label: 'White', fill: '#ffffff', text: '#161616', outline: null, sub: '#555' },
  black: { label: 'Black', fill: '#000000', text: '#f2f2f2', outline: null, sub: '#999' },
  view: { label: 'Same as view', view: true },  // the 3D view's (backdrop.js), lettered as blue or white
};
// A background as drawn: 'view' takes the 3D view's, with the blue's lettering, or the white's over a light colour
function sheetBackground(key) {
  const bg = BACKGROUNDS[key] || BACKGROUNDS.blue;
  return bg.view ? { ...(backdropLightness() > 0.6 ? BACKGROUNDS.white : BACKGROUNDS.blue), fill: null, view: true } : bg;
}

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

// ---- the name ----------------------------------------------------------------------------------
// name: { text, font, colors: [one] or [top, bottom], outline }. Fitted into w by maxH (the whole block,
// outline included), on one line or, when that makes it clearly bigger, two. -> what drawName needs.
export function fitName(g, name, w, maxH) {
  const f = NAME_FONTS.find(x => x.family === name.font) || NAME_FONTS[0];
  const font = px => `${f.weight || 400} ${px}px "${f.family}", Bangers, Impact, sans-serif`;
  const spacing = px => { if ('letterSpacing' in g) g.letterSpacing = `${Math.round(px * 0.04)}px`; };
  const words = name.text.trim().split(/\s+/);
  const options = [[words.join(' ')]];
  for (let i = 1; i < words.length; i++) options.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  g.font = font(100); spacing(100);
  const outline = name.outline ? 0.14 : 0;  // the outline's width per pixel of size (half of it is outside)
  const m100 = g.measureText('Hg' + name.text);  // how tall this font's letters are, per pixel of size
  const tall = ((m100.actualBoundingBoxAscent || 80) + (m100.actualBoundingBoxDescent || 20)) / 100;
  let best = null;
  for (const lines of options) {
    const widest = Math.max(...lines.map(l => g.measureText(l).width)) / 100;
    const n = lines.length, high = tall * n + 0.08 * (n - 1) + outline;
    const px = Math.min(maxH / high, w / (widest + outline));
    if (!best || px > best.px * (lines.length > best.lines.length ? 1.3 : 1)) best = { lines, px };  // two only if clearly bigger
  }
  const px = Math.floor(best.px);
  g.font = font(px); spacing(px);
  const m = g.measureText('Hg' + best.lines.join(''));
  const ascent = m.actualBoundingBoxAscent || px * 0.8, descent = m.actualBoundingBoxDescent || px * 0.2;
  const pad = name.outline ? px * 0.07 : 0, lineH = ascent + descent + px * 0.08;
  return { lines: best.lines, px, font: font(px), ascent, descent, pad, lineH,
           height: pad * 2 + ascent + descent + (best.lines.length - 1) * lineH };
}

// draw a fitted name centred in the box (x, y, w, h), each line centred on its own
export function drawName(g, name, fit, x, y, w, h) {
  g.save();
  g.font = fit.font; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = `${Math.round(fit.px * 0.04)}px`;
  const y0 = y + (h - fit.height) / 2, cx = x + w / 2;
  fit.lines.forEach((line, i) => {
    const base = y0 + fit.pad + fit.ascent + i * fit.lineH;
    // letter spacing adds a space after the last letter too: shift by half of it to centre the ink
    const lx = cx + ('letterSpacing' in g ? Math.round(fit.px * 0.04) / 2 : 0);
    if (name.outline) {
      g.lineJoin = 'round'; g.lineWidth = fit.px * 0.14; g.strokeStyle = '#000';
      g.strokeText(line, lx, base);
    }
    const [top, bottom] = name.colors;
    if (bottom) {
      const grad = g.createLinearGradient(0, base - fit.ascent, 0, base + fit.descent);
      grad.addColorStop(0, top); grad.addColorStop(1, bottom);
      g.fillStyle = grad;
    } else g.fillStyle = top;
    g.fillText(line, lx, base);
  });
  g.restore();
}

// view: { renderer, scene, ch, turnLights: yaw (radians) => (), hide: () => [objects to hide], characterBox }
// name: as for fitName, or null (or empty text) for none
export async function renderSheet(view, background, name = null) {
  const { renderer, scene, ch, turnLights } = view;
  const bg = sheetBackground(background);
  const sheet = document.createElement('canvas'); sheet.width = W; sheet.height = H;
  const g = sheet.getContext('2d');
  await document.fonts.load('52px Bangers').catch(() => {});  // the view labels
  if (bg.fill) { g.fillStyle = bg.fill; g.fillRect(0, 0, W, H); }
  else if (bg.view && await drawBackdrop(g, W, H)) { /* the view's colour */ }
  else {  // the tailor backdrop, covering the sheet
    const img = await loadImage('ui/backdrop.jpg');
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    g.drawImage(img, (W - img.naturalWidth * s) / 2, (H - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
  }

  // renderer state to put back
  const size = renderer.getSize(new THREE.Vector2()), ratio = renderer.getPixelRatio();
  const clear = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
  const hidden = view.hide().filter(o => o && o.visible);
  hidden.forEach(o => (o.visible = false));
  const gl = renderer.getContext();
  const maxSize = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

  // one view into a canvas of w x h (supersampled 2x when the GPU allows): cam, placed by the caller,
  // with the lights turned by deg as the camera is
  const shot = (w, h, deg, cam) => {
    const ss = Math.max(1, Math.min(2, Math.floor(maxSize / Math.max(w, h))));
    turnLights(THREE.MathUtils.degToRad(deg));
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
    // with a name: the name centred in a box over the face column, the faces below it (a little smaller,
    // to fit). The box is the same for every name, so the faces always sit in the same place.
    let face = FACE;
    if (name?.text?.trim()) {
      await loadNameFont(name.font);
      const box = { x: FACE.x, y: MARGIN, w: FACE.size, h: 200 };  // a title, not a poster: the faces stay big
      drawName(g, name, fitName(g, name, box.w, box.h), box.x, box.y, box.w, box.h);
      const top = box.y + box.h + 30, n = FACE.angles.length, gap = 28;
      const size = Math.min(FACE.size, Math.floor((H - 40 - top - (n - 1) * gap) / n));
      face = { ...FACE, x: FACE.x + (FACE.size - size) / 2, y: Math.max(top, FACE.y), size, gap };
    }
    const persp = new THREE.PerspectiveCamera(FOV, 1, 0.05, 400);
    FACE.angles.forEach((deg, i) => {
      const dir = look.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
      persp.position.copy(fc).addScaledVector(dir, (fsize * 0.95) / tan); persp.lookAt(fc);
      const pic = shot(face.size, face.size, THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z)), persp);
      const fg = pic.getContext('2d');
      const r = face.size / 2, grad = fg.createRadialGradient(r, r, r * 0.55, r, r, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      fg.globalCompositeOperation = 'destination-in'; fg.fillStyle = grad; fg.fillRect(0, 0, face.size, face.size);
      g.drawImage(pic, face.x, face.y + i * (face.size + face.gap));
    });
  } finally {
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
  const nameUi = nameControls(() => choice);
  for (const [, b] of buttons) b.addEventListener('click', nameUi.preview);
  const state = el('div', 'hint'); state.setAttribute('role', 'status');
  const foot = el('div', 'row'), go = el('button', null, 'Preview…'), cancel = el('button', null, 'Cancel');
  go.type = cancel.type = 'button';
  foot.append(go, cancel);
  box.append(row, nameUi.box, state, foot);
  document.body.append(box);
  const r = anchor?.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(r ? r.left : 392, innerWidth - box.offsetWidth - 8)) + 'px';
  box.style.top = (r ? r.bottom + 6 : 60) + 'px';
  const close = () => box.remove();
  cancel.onclick = close;
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  // draw the sheet, then show it: Save… asks where (a fresh click, as the save dialog needs) and writes
  // the picture already drawn; Back returns here to change things
  go.onclick = async () => {
    try { localStorage.setItem('co.sheetBg', choice); } catch { /* private mode */ }
    nameUi.save();
    go.disabled = true;
    try {
      state.textContent = 'Drawing…';
      await new Promise(res => requestAnimationFrame(res));  // let "Drawing…" show
      const sheet = await renderSheet(view, choice, nameUi.value());
      const blob = await new Promise(res => sheet.toBlob(res, 'image/png'));
      state.textContent = '';
      go.disabled = false;
      const file = ((view.ch.fileInfo?.character || view.ch.doc.name || 'Character').replace(/^Archetype_/, '')
        .replace(/[\\/:*?"<>|]/g, '') || 'Character') + ' character sheet.png';
      showPreview(blob, file, async () => {
        const target = await saveTarget(file);
        if (!target) return false;
        view.status(await target.write(blob));
        close();
        return true;
      }, () => go.focus());
    } catch (e) { state.textContent = 'Could not draw it: ' + e.message; go.disabled = false; console.warn(e); }
  };
  go.focus();
}

// The drawn sheet over the whole page, with Back and Save…. save() -> true once saved, false if cancelled.
function showPreview(blob, file, save, back) {
  const url = URL.createObjectURL(blob);
  const backdrop = el('div', 'modalBackdrop sheetPreview'), box = el('div', 'palette');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Character sheet preview');
  const img = el('img'); img.src = url; img.alt = 'The character sheet as it will be saved';
  const state = el('div', 'hint'); state.setAttribute('role', 'status');
  state.textContent = `${file}: 3840 × 2160, ${(blob.size / 1048576).toFixed(1)} MB`;
  const row = el('div', 'row'), backBtn = el('button', null, 'Back'), saveBtn = el('button', null, 'Save…');
  backBtn.type = saveBtn.type = 'button';
  row.append(state, backBtn, saveBtn);
  box.append(img, row);
  backdrop.append(box);
  document.body.append(backdrop);
  const done = () => { backdrop.remove(); URL.revokeObjectURL(url); };
  backBtn.onclick = () => { done(); back(); };
  backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(); back(); } });
  saveBtn.onclick = async () => {
    saveBtn.disabled = backBtn.disabled = true;
    try {
      if (await save()) { done(); return; }
      state.textContent = 'Not saved.';
    } catch (e) { state.textContent = 'Could not save: ' + e.message; console.warn(e); }
    saveBtn.disabled = backBtn.disabled = false;
  };
  saveBtn.focus();
}

// The name part of the dialog: the text, font, solid or gradient colour (presets or the player's own),
// the outline, and a small preview on the chosen background. The style is remembered; the name isn't
// (it belongs to the character). background(): the background chosen in the dialog.
function nameControls(background) {
  let st = { font: NAME_FONTS[0].family, mode: 'solid', solid: NAME_SOLIDS.Gold, gradient: NAME_GRADIENTS['Hero gold'], outline: true };
  try { st = { ...st, ...JSON.parse(localStorage.getItem('co.sheetName') || '{}') }; } catch { /* private mode */ }
  const box = el('div', 'nameBox');
  const label = (text, ctl) => { const l = el('label', 'nameRow'); l.append(el('span', 'lab', text), ctl); return l; };
  const text = el('input'); text.type = 'text'; text.maxLength = 40; text.spellcheck = false;
  text.placeholder = 'Optional: leave empty for none';
  const font = el('select');
  for (const f of NAME_FONTS) { const o = new Option(f.label, f.family); o.style.fontFamily = `"${f.family}"`; font.append(o); }
  font.value = st.font;
  // solid or gradient, its presets, and colour pickers for the player's own
  const modes = el('div', 'bgChoices'); modes.setAttribute('role', 'radiogroup'); modes.setAttribute('aria-label', 'Name colour');
  const modeBtn = Object.fromEntries(['solid', 'gradient'].map(m => {
    const b = el('button', 'bgChoice', m === 'solid' ? 'Solid' : 'Gradient'); b.type = 'button'; b.setAttribute('role', 'radio');
    b.onclick = () => { st.mode = m; sync(); };
    modes.append(b); return [m, b];
  }));
  const swatches = el('div', 'nameSwatches');
  const pick1 = el('input'), pick2 = el('input');
  pick1.type = pick2.type = 'color';
  const picks = el('div', 'namePicks');
  const outline = el('input'); outline.type = 'checkbox'; outline.checked = st.outline;
  const outlineRow = el('label', 'nameCheck'); outlineRow.append(outline, ' Black outline');
  const canvas = el('canvas', 'namePreview'); canvas.width = 640; canvas.height = 200;  // the sheet's name box
  const styleRows = el('div', 'nameStyle');
  styleRows.append(label('Font', font), label('Colour', modes), swatches, picks, outlineRow, canvas);
  box.append(label('Name', text), styleRows);

  const colors = () => st.mode === 'solid' ? [st.solid] : st.gradient;
  const sync = () => {
    for (const [m, b] of Object.entries(modeBtn)) { b.classList.toggle('on', m === st.mode); b.setAttribute('aria-checked', String(m === st.mode)); }
    swatches.replaceChildren(...Object.entries(st.mode === 'solid' ? NAME_SOLIDS : NAME_GRADIENTS).map(([n, c]) => {
      const b = el('button', 'nameSwatch'); b.type = 'button'; b.title = n; b.setAttribute('aria-label', n);
      b.style.background = Array.isArray(c) ? `linear-gradient(${c[0]}, ${c[1]})` : c;
      const on = Array.isArray(c) ? st.mode === 'gradient' && c.join() === st.gradient.join() : st.mode === 'solid' && c === st.solid;
      b.classList.toggle('on', on);
      b.onclick = () => { if (Array.isArray(c)) st.gradient = [...c]; else st.solid = c; sync(); };
      return b;
    }));
    picks.replaceChildren(el('span', 'lab', 'Own'), pick1, ...(st.mode === 'gradient' ? [el('span', 'to', 'to'), pick2] : []));
    pick1.title = st.mode === 'solid' ? 'Your own colour' : 'Top colour'; pick2.title = 'Bottom colour';
    pick1.value = st.mode === 'solid' ? st.solid : st.gradient[0]; pick2.value = st.gradient[1];
    styleRows.hidden = !text.value.trim();
    preview();
  };
  pick1.oninput = () => { if (st.mode === 'solid') st.solid = pick1.value; else st.gradient = [pick1.value, st.gradient[1]]; sync(); };
  pick2.oninput = () => { st.gradient = [st.gradient[0], pick2.value]; sync(); };
  font.onchange = () => { st.font = font.value; sync(); };
  outline.onchange = () => { st.outline = outline.checked; preview(); };
  text.oninput = sync;

  // the name as the sheet will have it, on the chosen background
  let drawn = 0;
  async function preview() {
    const n = value(), g = canvas.getContext('2d'), id = ++drawn;
    if (!n) return;
    await loadNameFont(n.font);
    if (id !== drawn) return;  // a newer change is drawing
    const bg = sheetBackground(background());
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = bg.fill || '#123f86'; g.fillRect(0, 0, canvas.width, canvas.height);
    if (bg.view) await drawBackdrop(g, canvas.width, canvas.height);
    if (id !== drawn) return;
    // the sheet's name box at its own size, so the name fits the same way
    drawName(g, n, fitName(g, n, canvas.width, canvas.height), 0, 0, canvas.width, canvas.height);
  }
  function value() {
    const t = text.value.trim();
    return t ? { text: t, font: st.font, colors: colors(), outline: st.outline } : null;
  }
  sync();
  return { box, value, preview, save: () => { try { localStorage.setItem('co.sheetName', JSON.stringify(st)); } catch { /* private mode */ } } };
}
