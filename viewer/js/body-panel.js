// The creator's body box and Stance & Mood screen.
//  * Stance / mood buttons: like the game's Stance & Mood screen, picking one clears the costume-pose bit
//    (CharacterCreation_ForceCostumeStance(False)) so the in-world idle and mood face play; the
//    "Costume pose" toggle sets it again (see tools/stances.py MODES).
//  * Presets: the skeleton's ScalePresets. Body / Head presets set their sliders on top of the
//    Resetbody / Resethead preset, which is also what the Reset buttons apply.
//  * Sliders in the skeleton's player groups (Face, Upper Body, Lower Body, Tail & Wings), plus height,
//    body mass, muscle and the other BodyScale tracks (brow, jaw, mouth). Tail/wing sliders only while
//    such a piece is worn. Double-click a slider's name to put it back to its default.

import { gameSlider } from './ui.js';

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
// a labelled row: the label in its own column, the buttons wrapping in theirs
function labelled(label, buttons) {
  const row = el('div', 'row labelled'), list = el('div', 'choices');
  list.append(...buttons);
  row.append(el('span', 'lab', label), list);
  return row;
}
const GROUP_NAMES = { Player_Body_Scales_1: 'Face', Player_Body_Scales_2: 'Upper Body', Player_Body_Scales_3: 'Lower Body',
                      Player_Body_Scales_4: 'Tail & Wings' };
// The names the game's creator shows where the data's differ: by slider (the data calls both female hand
// sliders "Hands"), else by the data's name.
const GAME_NAMES_BY_SLIDER = { Player_Arm_Length: 'Arm Length', Player_Hand_Size: 'Hand Length', Player_Hand_Thick: 'Hands',
                               Player_Leg_Length: 'Leg Length', Player_Tail_Thickness: 'Tail' };
const GAME_NAMES = { 'Arm Thickness': 'Arms', 'Leg Thickness': 'Legs', Neck: 'Neck Thickness', 'Eye Size': 'Eyes',
                     'Cheek Height': 'Cheeks Height', Wrist: 'Wrists', 'Chin Size': 'Chin' };
const gameName = (slider, name) => GAME_NAMES_BY_SLIDER[slider] || GAME_NAMES[name] || name;
// The game creator's order within each group (read left to right, top to bottom), by the game's names;
// anything not listed keeps its place after these. The face's BodyScale tracks (mouth, brow, jaw) come
// first, as the game puts the mouth.
const GAME_ORDER = {
  Player_Body_Scales_1: ['Mouth', 'Brow', 'Jaw Length', 'Jaw Width', 'Mouth Width', 'Head', 'Head Height', 'Head Width',
                         'Head Depth', 'Eyes', 'Eye Height', 'Eye Position', 'Cheeks', 'Cheeks Height', 'Ears', 'Ear Points',
                         'Nose Width', 'Nose Length', 'Nose Height', 'Nose Position', 'Chin', 'Chin Width'],
  Player_Body_Scales_2: ['Neck Thickness', 'Neck Length', 'Shoulders', 'Chest Width', 'Chest Depth', 'Chest Length', 'Arm Length',
                         'Arms', 'Bicep', 'Forearm', 'Wrists', 'Hand Length', 'Hands', 'Breasts'],
  Player_Body_Scales_3: ['Waist', 'Waist Length', 'Leg Length', 'Legs', 'Upper Leg', 'Lower Leg', 'Feet Length', 'Feet Width'],
  Player_Body_Scales_4: ['Tail Length', 'Tail', 'Wings', 'Wings (insect)', 'Wings (butterfly)'],
};
const gameOrder = (group, items, name) => {
  const order = GAME_ORDER[group] || [], at = x => { const i = order.indexOf(name(x)); return i < 0 ? order.length : i; };
  return items.map((x, i) => [x, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([x]) => x);
};
// feet as the game shows height: 5' 4"
const feetInches = ft => { const inches = Math.round(ft * 12); return `${Math.floor(inches / 12)}' ${inches % 12}"`; };

export class BodyPanel {
  // bodyRoot: presets and sliders; stanceRoot: stance, mood and pose
  constructor(bodyRoot, stanceRoot, ch, onChange) {
    this.bodyRoot = bodyRoot; this.stanceRoot = stanceRoot; this.ch = ch; this.onChange = onChange || (() => {});
    this.open = new Set(['Body']);  // expanded slider groups
  }
  get cat() { return this.ch.cat; }
  get doc() { return this.ch.doc; }

  render() {
    if (!this.cat) return;
    this.stanceRoot.replaceChildren(this.stanceBox());
    const all = el('div', 'row');
    for (const [label, tip, fn] of [['Costume values', 'Every body value back to the loaded costume', () => this.ch.costumeBodyValues()],
                                    ['Neutral', 'Default height, mass and muscle; every slider at 0', () => this.ch.neutralBodyValues()]]) {
      const b = el('button', 'choice', label); b.title = tip;
      b.onclick = async () => { await this.ch.setBody(fn()); this.render(); this.onChange(); };
      all.append(b);
    }
    this.bodyRoot.replaceChildren(all, this.presetBox(), this.sliders());
  }

  // ---- stance & mood -----------------------------------------------------------------------------
  stanceBox() {
    const { cat, doc, ch } = this;
    const box = el('div', 'bodyBox');
    const costumePose = el('button', 'toggle' + (ch.mode === 'creator' ? ' on' : ''), 'Costume pose');
    costumePose.title = 'The creator\'s costume pose. Picking a stance or mood switches to the in-world idle, as the game does.';
    costumePose.onclick = () => this.setAnim(doc.stance, ch.mode === 'creator' ? 'idle' : 'creator', doc.mood);
    const tpose = el('button', 'toggle' + (ch.mode === '' ? ' on' : ''), 'T-pose');
    tpose.onclick = () => this.setAnim(doc.stance, ch.mode === '' ? 'idle' : '', doc.mood);
    box.append(labelled('Pose', [costumePose, tpose]));
    // while a pose is on it overrides the stance and mood: they stay marked but are shaded, and picking one
    // switches back to the stance's idle
    const overridden = ch.mode !== 'idle';
    const buttons = (label, items, current, pick) => {
      const row = labelled(label, items.map(it => {
        const b = el('button', 'choice' + (it.name.toLowerCase() === (current || '').toLowerCase() ? ' on' : ''), it.displayName);
        b.onclick = () => pick(it.name);
        if (overridden) b.title = 'Overridden by the pose; click to switch back to this ' + label.toLowerCase();
        return b;
      }));
      row.classList.toggle('overridden', overridden);
      return row;
    };
    box.append(buttons('Stance', cat.stances.filter(s => s.player), doc.stance, s => this.setAnim(s, 'idle', doc.mood)));
    box.append(buttons('Mood', cat.moods, doc.mood || 'Normal', m => this.setAnim(doc.stance, 'idle', m)));
    if (overridden) box.append(el('div', 'poseNote', `${ch.mode === '' ? 'T-pose' : 'Costume pose'} is overriding the stance and mood. `
                                                      + 'Turn it off, or pick a stance or mood, to go back.'));
    this.info = el('div', 'animInfo', ch.anim?.info || '');
    box.append(this.info);
    return box;
  }
  async setAnim(stance, mode, mood) {
    this.doc.mood = mood;
    await this.ch.setStance(stance, mode);
    this.render(); this.onChange();
  }

  // ---- presets -------------------------------------------------------------------------------------
  presetBox() {
    const body = this.cat.body, box = el('div', 'bodyBox');
    for (const [tag, reset, label] of [['Body', 'Resetbody', 'Body'], ['Head', 'Resethead', 'Head']]) {
      const list = body.presets.filter(p => p.tag === tag).map(p => {
        const b = el('button', 'choice', p.name); b.title = `Apply the ${p.name} ${tag.toLowerCase()} preset`;
        b.onclick = () => this.applyPreset(reset, p);
        return b;
      });
      const r = el('button', 'choice reset', 'Reset'); r.title = `The skeleton's ${reset} preset`;
      r.onclick = () => this.applyPreset(reset, null);
      box.append(labelled(label + ' presets', [...list, r]));
    }
    return box;
  }
  applyPreset(resetName, preset) {
    const body = this.cat.body, vals = this.ch.bodyValues;
    const reset = body.presets.find(p => p.name === resetName)?.values || {};
    Object.assign(vals.scaleValues, reset, preset?.values || {});
    this.ch.updateBody(); this.render(); this.onChange();
  }

  // ---- sliders -------------------------------------------------------------------------------------
  // The number shown counts from 0 at the slider's left end, as the game's creator shows it (the game's
  // values can run from below 0, e.g. -100 to 100); the value kept is the game's. show: another way to
  // show it (height in feet and inches).
  slider(label, min, max, step, value, def, onInput, title, show = null) {
    const row = el('div', 'slider');
    const l = el('span', null, label); l.title = (title ? title + '\n' : '') + 'Double-click to reset';
    const fmt = v => show ? show(+v) : (+v - min).toFixed(step < 1 ? 2 : 0);
    const out = el('span', 'val', fmt(value));
    const s = gameSlider({ min, max, step, value, onInput: v => { out.textContent = fmt(v); onInput(v); } });
    l.ondblclick = () => { s.value = def; out.textContent = fmt(def); onInput(def); };
    row.append(l, s, out);
    return row;
  }
  group(name, rows) {
    const d = el('details', 'sliderGroup'); d.open = this.open.has(name);
    d.ontoggle = () => (d.open ? this.open.add(name) : this.open.delete(name));
    const s = el('summary', null, name);
    d.append(s, ...rows);
    return d;
  }
  sliders() {
    const { cat, ch } = this, body = cat.body, vals = ch.bodyValues;
    const wrap = el('div', 'sliders');
    const changed = () => ch.updateBody();
    // Body: height, muscle, body mass (the game's Basics)
    const bodyRows = [this.slider('Height', body.heightRange[0], body.heightRange[1], 0.01, vals.height, body.heightBase,
                                  v => { vals.height = v; changed(); }, '', feetInches)];
    const scaleRow = i => {
      const b = vals.bodyScales[i], lo = body.bodyScaleRange[0]?.[i] ?? 0, hi = body.bodyScaleRange[1]?.[i] ?? 100;
      const label = (body.bodyScaleNames?.[i] || b.name) + (b.fallback ? ' (approx.)' : b.track ? '' : ' (no data)');
      const def = b.name.toLowerCase() === 'bodymass' ? 20 : 50;
      return this.slider(label, lo, hi, 1, b.value, def, v => { b.value = v; changed(); },
                         b.fallback ? 'Game track not installed; using scale channels of ' + b.fallback : '');
    };
    const mass = vals.bodyScales.findIndex(b => b.name.toLowerCase() === 'bodymass');
    if (!body.noMuscle) bodyRows.push(this.slider('Muscle', body.muscleRange[0], body.muscleRange[1], 1, vals.muscle, body.defaultMuscle, v => ch.setMuscle(v)));
    if (mass >= 0) bodyRows.push(scaleRow(mass));
    wrap.append(this.group('Body', bodyRows));
    // the skeleton's player groups; the face group also gets the face BodyScale tracks
    const worn = new Set(ch.subs().map(s => s.name));
    for (const g of body.sliderGroups) {
      const list = g.sliders.filter(s => !body.sliders[s.name].subSkeleton || worn.has(body.sliders[s.name].subSkeleton));
      const items = list.map(s => ({ name: gameName(s.name, s.displayName), row: () => {
        const def = body.sliders[s.name];
        return this.slider(gameName(s.name, s.displayName), def.min, def.max, 1, vals.scaleValues[s.name] ?? 0, 0,
                           v => { vals.scaleValues[s.name] = v; changed(); });
      } }));
      if (g.name === 'Player_Body_Scales_1') vals.bodyScales.forEach((b, i) => {
        if (i !== mass) items.push({ name: body.bodyScaleNames?.[i] || b.name, row: () => scaleRow(i) });
      });
      const rows = gameOrder(g.name, items, x => x.name).map(x => x.row());
      if (rows.length) wrap.append(this.group(GROUP_NAMES[g.name] || g.displayName, rows));
    }
    return wrap;
  }
}
