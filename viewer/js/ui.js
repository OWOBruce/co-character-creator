// Small widgets drawn with the game's own UI art (viewer/ui, built by build_ui.py).

// The creator's segmented slider: Slider_Bar_Empty / _Full tiles, the Slider_Scroller thumb, and for
// two-sided ranges (e.g. -100..100) a middle marker with the bar filled from the middle.
// Returns an element with .value (get/set); onInput(value) fires while dragging or with the keyboard.
export function gameSlider({ min, max, step = 1, value, onInput, onChange }) {
  const el = document.createElement('div'); el.className = 'gslider'; el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-valuemin', min); el.setAttribute('aria-valuemax', max);
  const fill = document.createElement('div'); fill.className = 'fill';
  const thumb = document.createElement('div'); thumb.className = 'thumb';
  el.append(fill);
  const zero = min < 0 && max > 0 ? (0 - min) / (max - min) : null;
  if (zero !== null) { const m = document.createElement('div'); m.className = 'mid'; m.style.left = zero * 100 + '%'; el.append(m); }
  el.append(thumb);
  let v = value;
  const snap = x => Math.min(max, Math.max(min, Math.round((x - min) / step) * step + min));
  const draw = () => {
    const t = (v - min) / (max - min || 1), a = zero ?? 0;
    fill.style.left = Math.min(a, t) * 100 + '%'; fill.style.width = Math.abs(t - a) * 100 + '%';
    thumb.style.left = t * 100 + '%';
    el.setAttribute('aria-valuenow', v);
  };
  const set = (x, fire = true) => { const n = snap(x); if (n === v) return; v = n; draw(); if (fire) onInput?.(v); };
  const fromPointer = e => { const r = el.getBoundingClientRect(); return min + (e.clientX - r.left) / r.width * (max - min); };
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId); el.classList.add('drag'); set(fromPointer(e));
    const move = ev => set(fromPointer(ev));
    const up = () => { el.classList.remove('drag'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); onChange?.(v); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  });
  el.addEventListener('keydown', e => {
    const big = (max - min) / 10;
    const d = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -big, PageUp: big }[e.key];
    if (d !== undefined) { e.preventDefault(); set(v + d); onChange?.(v); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); set(e.key === 'Home' ? min : max); onChange?.(v); }
  });
  Object.defineProperty(el, 'value', { get: () => v, set: x => { v = snap(+x); draw(); } });
  draw();
  return el;
}
