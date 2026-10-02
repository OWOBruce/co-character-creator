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

// Clicking a slider's number (or Enter on it) lets the player type one. Enter or clicking away sets it
// when it's a value the slider can take; otherwise the box turns red and says what it takes (Enter keeps
// editing, clicking away puts the old number back). Escape puts the old number back.
// parse(text) -> the slider's value, or null; apply(value) sets it; hint: what it takes, e.g. '0 to 100'.
export function editableValue(out, { parse, apply, hint, label = 'value' }) {
  out.classList.add('editable'); out.tabIndex = 0; out.setAttribute('role', 'button');
  out.title = `Click to type a ${label} (${hint})`;
  const edit = () => {
    if (out.querySelector('input')) return;
    const was = out.textContent, inp = document.createElement('input');
    inp.type = 'text'; inp.value = was; inp.className = 'valEdit'; inp.spellcheck = false;
    inp.setAttribute('aria-label', `${label} (${hint})`);
    out.textContent = ''; out.append(inp); inp.focus(); inp.select();
    let open = true;
    const close = () => { open = false; out.textContent = was; };
    const commit = () => {
      const v = parse(inp.value.trim());
      if (v == null) { inp.classList.add('bad'); inp.title = `Not a ${label} this takes: ${hint}`; return false; }
      close(); apply(v);  // apply shows the new number
      return true;
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();  // not the page's shortcuts
      if (e.key === 'Enter') { e.preventDefault(); if (commit()) out.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); out.focus(); }
    });
    inp.addEventListener('input', () => { inp.classList.remove('bad'); inp.title = ''; });
    inp.addEventListener('blur', () => { if (open && !commit()) close(); });
  };
  out.addEventListener('click', edit);
  out.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !out.querySelector('input')) { e.preventDefault(); edit(); } });
}

// A parser for a slider shown as a plain number: shown = toShown(value). Takes the number as shown (with
// its unit, e.g. ° or %, optional) only when it is in range and on the slider's step.
export function numberParser({ min, max, step, toShown = v => v, fromShown = n => n, unit = '' }) {
  return text => {
    const t = text.replace(unit, '').trim();
    if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
    const v = fromShown(+t), k = (v - min) / step;
    if (v < min - 1e-9 || v > max + 1e-9 || Math.abs(k - Math.round(k)) > 1e-6) return null;
    return +(Math.round(k) * step + min).toFixed(6);  // not 0.30000000000000004
  };
}
