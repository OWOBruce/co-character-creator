// The 3D view's own background (View options > Scene > Background). By default the view is see-through and
// shows the page's backdrop, the tailor's blue comic page (ui/backdrop.jpg). A colour recolours that comic
// art, or with Comic art off is a plain colour. Only the view changes: the left panel keeps the page's own.
// Recolouring: the art's brightness, centred on mid-grey (CONTRAST x its spread), is laid over the colour
// with hard-light, so the colour is the page's average and the dots and panels lighten and darken it, on
// black and white too. The character sheet's "Same as view" background (sheet.js) draws the same.
// Not remembered between sessions.

export const TAILOR_BLUE = '#0f59a6';  // the backdrop's average colour
const CONTRAST = 1.5;                  // about the original's light-to-dark range over the tailor blue
export const backdrop = { colour: null, comic: true };  // colour: '#rrggbb', or null for the tailor's own

// The greyscale art, made once: a promise of a canvas (null if the backdrop can't be read)
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

// Show the current background on el (the 3D view)
export async function applyBackdrop(el) {
  const { colour, comic } = backdrop;
  el.style.backgroundBlendMode = '';
  if (!colour && comic) { el.style.background = ''; return; }  // the page's own shows through
  const c = colour || TAILOR_BLUE;
  if (!comic) { el.style.background = c; return; }
  const a = await comicArt();
  if (backdrop.colour !== colour || backdrop.comic !== comic) return;  // changed while the art was made
  if (!a) { el.style.background = c; return; }
  // fixed and covering the window, like the page's backdrop, so the art lines up with it
  el.style.background = `url(${a.url}) center / cover fixed, ${c}`;
  el.style.backgroundBlendMode = 'hard-light';
}

// Draw the current background into a w x h canvas context (the character sheet); false for the tailor's
// own, which the caller draws
export async function drawBackdrop(g, w, h) {
  const { colour, comic } = backdrop;
  if (!colour && comic) return false;
  g.save();
  g.fillStyle = colour || TAILOR_BLUE; g.fillRect(0, 0, w, h);
  const a = comic && await comicArt();
  if (a) {
    const s = Math.max(w / a.width, h / a.height);
    g.globalCompositeOperation = 'hard-light';
    g.drawImage(a, (w - a.width * s) / 2, (h - a.height * s) / 2, a.width * s, a.height * s);
  }
  g.restore();
  return true;
}

// How light the background is (0-1), for picking dark or light lettering over it
export function backdropLightness() {
  const h = backdrop.colour || TAILOR_BLUE;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
