// The 3D view's own background (View options > Scene > Background): a colour and an overlay. By default the
// view is see-through and shows the page's backdrop, the tailor's blue comic page (ui/backdrop.jpg). A colour
// recolours that comic art; the other overlays (OVERLAYS) are drawn here in grey and recoloured the same way,
// and None is the plain colour. Only the view changes: the left panel keeps the page's own.
// Recolouring: the art's brightness, centred on mid-grey, is laid over the colour with hard-light, so the
// colour is the page's average and the art lightens and darkens it, on black and white too. The comic page is
// fixed to the window, like the page's own; the drawn overlays fit the view and centre on the character. The
// character sheet's "Same as view" background (sheet.js) draws the same. Remembered in this browser
// (localStorage co.viewBackdrop); Reset goes back to the tailor's page.

export const TAILOR_BLUE = '#0f59a6';  // the backdrop's average colour
const CONTRAST = 1.5;                  // about the original's light-to-dark range over the tailor blue
export const OVERLAYS = [
  ['comic', 'Comic page', "The tailor's comic page"],
  ['none', 'None', 'Just the colour'],
  ['halftone', 'Halftone', 'Pop-art dots, bigger toward the edges'],
  ['speed', 'Speed lines', 'Manga focus lines rushing in from the edges'],
  ['spotlight', 'Studio spotlight', 'A pool of light behind the character, darker edges'],
  ['starburst', 'Starburst', 'A soft burst of light behind the character'],
  ['sunburst', 'Sunburst', 'Retro poster rays'],
  ['blueprint', 'Blueprint', 'A design grid, heavier every fifth line'],
  ['stars', 'Starfield', 'Stars and a few soft glows'],
  ['hex', 'Hex shield', 'Force-field cells, clear round the character'],
];
export const backdrop = { colour: null, overlay: 'comic' };  // colour: '#rrggbb', or null for the tailor blue

const KEY = 'co.viewBackdrop';
try {
  const s = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (/^#[0-9a-f]{6}$/i.test(s?.colour || '')) backdrop.colour = s.colour;
  if (OVERLAYS.some(([k]) => k === s?.overlay)) backdrop.overlay = s.overlay;
} catch { /* private mode, or nothing saved */ }
export function saveBackdrop() {
  try { localStorage.setItem(KEY, JSON.stringify(backdrop)); } catch { /* private mode */ }
}

// The greyscale comic art, made once: a promise of a canvas (null if the backdrop can't be read)
let art = null;
export function comicArt() {
  return art ||= new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height), p = d.data, n = p.length / 4;
      let sum = 0;
      for (let i = 0; i < p.length; i += 4) sum += 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
      const mean = sum / n;
      for (let i = 0; i < p.length; i += 4) {
        const v = 128 + (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2] - mean) * CONTRAST;
        p[i] = p[i + 1] = p[i + 2] = v;  // clamped by the array
      }
      g.putImageData(d, 0, 0);
      c.toBlob(b => { c.url = URL.createObjectURL(b); res(c); }, 'image/jpeg', 0.9);
    };
    img.onerror = () => res(null);
    img.src = 'ui/backdrop.jpg';
  });
}

// ---- the drawn overlays -------------------------------------------------------------------------
// Each draws its grey art into a w x h context: mid-grey (128) leaves the colour as it is, lighter lightens it
// and darker darkens it. Sizes are in units of h / 600, so the view and the character sheet look alike, and the
// framing ones centre where the character stands (a little above the middle). Random ones use a fixed seed, so
// the art is the same every time.
const grey = v => `rgb(${v},${v},${v})`;
function seeded(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

const DRAW = {
  halftone(g, w, h, u, cx, cy) {
    fill(g, w, h, 128); g.fillStyle = grey(62);
    const s = 14 * u, far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
    for (let row = -1, y = -s; y < h + s; row++, y += s * 0.866) {
      for (let x = (row % 2 ? s / 2 : 0) - s; x < w + s; x += s) {
        const r = Math.max(0, Math.hypot(x - cx, y - cy) / far - 0.18) * s * 0.78;
        if (r > 0.4 * u) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
      }
    }
  },
  speed(g, w, h, u, cx, cy) {
    fill(g, w, h, 128);
    const rnd = seeded(11), far = Math.hypot(w, h);
    for (let i = 0; i < 170; i++) {  // wedges from round the character out past the corners, mostly dark
      const a = rnd() * Math.PI * 2, half = 0.002 + rnd() * 0.008, j = 1 + rnd() * 0.35;
      const sx = cx + Math.cos(a) * h * 0.2 * j, sy = cy + Math.sin(a) * h * 0.46 * j;
      g.fillStyle = rnd() < 0.8 ? grey(55) : grey(215);
      g.beginPath(); g.moveTo(sx, sy);
      g.lineTo(cx + Math.cos(a - half) * far, cy + Math.sin(a - half) * far);
      g.lineTo(cx + Math.cos(a + half) * far, cy + Math.sin(a + half) * far);
      g.fill();
    }
  },
  spotlight(g, w, h, u, cx, cy) {
    const r = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w / 2, h / 2) * 1.05);
    r.addColorStop(0, grey(200)); r.addColorStop(0.5, grey(128)); r.addColorStop(1, grey(55));
    g.fillStyle = r; g.fillRect(0, 0, w, h);
    // a faint floor of light under the feet
    g.save(); g.translate(cx, h * 0.93); g.scale(1, 0.22);
    const f = g.createRadialGradient(0, 0, 0, 0, 0, h * 0.5);
    f.addColorStop(0, 'rgba(255,255,255,0.35)'); f.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = f; g.fillRect(-h * 0.5, -h * 0.5, h, h); g.restore();
  },
  starburst(g, w, h, u, cx, cy) {
    fill(g, w, h, 100);
    const r = g.createRadialGradient(cx, cy, 0, cx, cy, h * 0.67);
    r.addColorStop(0, grey(255)); r.addColorStop(0.25, grey(190)); r.addColorStop(1, 'rgba(100,100,100,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
    const rnd = seeded(5);
    g.globalAlpha = 0.35; g.fillStyle = grey(255);
    for (let i = 0; i < 24; i++) {
      const a = rnd() * Math.PI * 2, half = 0.01 + rnd() * 0.02, len = h * (0.39 + rnd() * 0.66);
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a - half) * len, cy + Math.sin(a - half) * len);
      g.lineTo(cx + Math.cos(a + half) * len, cy + Math.sin(a + half) * len);
      g.fill();
    }
    g.globalAlpha = 1;
  },
  sunburst(g, w, h, u, cx, cy) {
    fill(g, w, h, 112); g.fillStyle = grey(150);
    const n = 28, far = Math.hypot(w, h);
    for (let i = 0; i < n; i += 2) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a0) * far, cy + Math.sin(a0) * far); g.lineTo(cx + Math.cos(a1) * far, cy + Math.sin(a1) * far);
      g.fill();
    }
  },
  blueprint(g, w, h, u, cx, cy) {
    fill(g, w, h, 112);
    const step = 18 * u;  // a heavier line every fifth, through the character's middle
    const lines = (major) => {
      g.beginPath();
      for (let k = Math.floor(-cx / step); cx + k * step <= w; k++) {
        if (major !== (k % 5 === 0)) continue;
        const x = Math.round(cx + k * step) + 0.5; g.moveTo(x, 0); g.lineTo(x, h);
      }
      for (let k = Math.floor(-cy / step); cy + k * step <= h; k++) {
        if (major !== (k % 5 === 0)) continue;
        const y = Math.round(cy + k * step) + 0.5; g.moveTo(0, y); g.lineTo(w, y);
      }
      g.stroke();
    };
    g.strokeStyle = grey(150); g.lineWidth = Math.max(1, 0.7 * u); lines(false);
    g.strokeStyle = grey(185); g.lineWidth = Math.max(1, 1.4 * u); lines(true);
  },
  stars(g, w, h, u, cx, cy) {
    const r = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w / 2, h / 2) * 1.1);
    r.addColorStop(0, grey(120)); r.addColorStop(1, grey(70));
    g.fillStyle = r; g.fillRect(0, 0, w, h);
    const rnd = seeded(3), n = Math.round(w * h / (u * u) * 0.0011);
    for (let i = 0; i < n; i++) {
      const x = rnd() * w, y = rnd() * h, s = rnd();
      g.fillStyle = grey(170 + Math.round(rnd() * 85));
      g.beginPath(); g.arc(x, y, (s < 0.92 ? 0.5 + s * 0.8 : 2.2) * u, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 5; i++) {  // a few soft glows
      const x = rnd() * w, y = rnd() * h, q = g.createRadialGradient(x, y, 0, x, y, 28 * u);
      q.addColorStop(0, 'rgba(255,255,255,0.28)'); q.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = q; g.fillRect(x - 28 * u, y - 28 * u, 56 * u, 56 * u);
    }
  },
  hex(g, w, h, u, cx, cy) {
    fill(g, w, h, 120);
    const s = 16 * u, hw = Math.sqrt(3) * s, far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
    g.lineWidth = Math.max(1, 1.4 * u);
    for (let row = Math.floor(-cy / (s * 1.5)) - 1; cy + row * s * 1.5 < h + s; row++) {
      for (let col = Math.floor(-cx / hw) - 1; cx + col * hw < w + hw; col++) {
        const x = cx + col * hw + (row % 2 ? hw / 2 : 0), y = cy + row * s * 1.5;
        const a = Math.min(1, Math.max(0, (Math.hypot(x - cx, y - cy) / far - 0.2) * 1.6));  // fades out toward the character
        if (a <= 0) continue;
        g.strokeStyle = `rgba(200,200,200,${a})`; g.beginPath();
        for (let k = 0; k < 6; k++) {
          const t = Math.PI / 3 * k + Math.PI / 6;
          g[k ? 'lineTo' : 'moveTo'](x + Math.cos(t) * s, y + Math.sin(t) * s);
        }
        g.closePath(); g.stroke();
      }
    }
  },
};
function fill(g, w, h, v) { g.fillStyle = grey(v); g.fillRect(0, 0, w, h); }

// A drawn overlay's grey art at w x h, as a canvas
export function overlayArt(kind, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  DRAW[kind](c.getContext('2d'), w, h, h / 600, w / 2, h * 0.46);
  return c;
}

// The view's drawn art, at the view's size in device pixels, as an image URL; the last one is kept, so changing
// only the colour doesn't draw it again
let drawn = null;  // { key, url: promise }
function viewArt(kind, el) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(el.clientWidth * dpr)), h = Math.max(1, Math.round(el.clientHeight * dpr));
  const key = `${kind}:${w}x${h}`;
  if (drawn?.key !== key) {
    const old = drawn;
    drawn = { key, url: new Promise(res => overlayArt(kind, w, h).toBlob(b => res(URL.createObjectURL(b)), 'image/jpeg', 0.92)) };
    if (old) Promise.all([old.url, drawn.url]).then(([u]) => setTimeout(() => URL.revokeObjectURL(u), 1000));  // once the new one is up
  }
  return drawn.url;
}

// Show the current background on el (the 3D view). Call again when the view changes size.
export async function applyBackdrop(el) {
  const { colour, overlay } = backdrop;
  const c = colour || TAILOR_BLUE;
  const changed = () => backdrop.colour !== colour || backdrop.overlay !== overlay;
  if (overlay === 'comic' && !colour) { el.style.background = ''; el.style.backgroundBlendMode = ''; return; }  // the page's own shows through
  if (overlay === 'none') { el.style.background = c; el.style.backgroundBlendMode = ''; return; }
  let layer;
  if (overlay === 'comic') {
    const a = await comicArt();
    if (changed()) return;  // changed while the art was made
    // fixed and covering the window, like the page's backdrop, so the art lines up with it
    layer = a && `url(${a.url}) center / cover fixed`;
  } else {
    const url = await viewArt(overlay, el);
    if (changed()) return;
    layer = `url(${url}) center / 100% 100% no-repeat`;
  }
  el.style.background = layer ? `${layer}, ${c}` : c;
  el.style.backgroundBlendMode = layer ? 'hard-light' : '';
}

// Draw the current background into a w x h canvas context (the character sheet); false for the tailor's
// own, which the caller draws
export async function drawBackdrop(g, w, h) {
  const { colour, overlay } = backdrop;
  if (!colour && overlay === 'comic') return false;
  g.save();
  g.fillStyle = colour || TAILOR_BLUE; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'hard-light';
  if (overlay === 'comic') {
    const a = await comicArt();
    if (a) {
      const s = Math.max(w / a.width, h / a.height);
      g.drawImage(a, (w - a.width * s) / 2, (h - a.height * s) / 2, a.width * s, a.height * s);
    }
  } else if (overlay !== 'none') g.drawImage(overlayArt(overlay, w, h), 0, 0);
  g.restore();
  return true;
}

// How light the background is (0-1), for picking dark or light lettering over it
export function backdropLightness() {
  const h = backdrop.colour || TAILOR_BLUE;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
