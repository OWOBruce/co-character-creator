// What's new in the editor: the pieces, materials and patterns an update added to its parts list. new_parts.json
// lists them by update (parts_list.py); the build writes data/whats_new.json with the names they have in this
// install (build_web.py whats_new). After an editor update the editor shows the new ones once, in a box over the
// page; Show them has the parts panel keep only the slots and pieces with something new (PartsPanel.showNew), and
// About opens the latest one again. What's listed here is what the editor offers.
import { offered, isLeftOutBone, slotAllowed, visibleCategories, materialsFor, texturesFor, childSlots, isDev } from './rules.js';
import { aboutSection } from './about.js';

const KINDS = ['pieces', 'materials', 'textures'];
const TEXTURE_KINDS = ['Pattern', 'Detail', 'Diffuse', 'Specular'];
const BODY = { Male: 'Masculine', Female: 'Feminine' };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

// The entries, oldest first: [{id, date, title, pieces: {Male: [name]}, materials, textures}]
export async function loadLog() {
  try {
    const r = await fetch('data/whats_new.json');
    return r.ok ? (await r.json()).entries || [] : [];
  } catch { return []; }
}

// One skeleton's new names in some entries: {pieces, materials, textures} as Sets
function namesIn(entries, skeleton) {
  return Object.fromEntries(KINDS.map(k => [k, new Set(entries.flatMap(e => e[k]?.[skeleton] || []))]));
}

// Of one skeleton's new names, what the editor offers, and the top-level pieces that hold any of it (what Show
// them lists): { pieces: [{name, x, where}], materials: [{name, x, on}], textures: [{name, x, kind, on}],
//   sets: {pieces, materials, textures} (the offered names), holders: Set }
export function offeredNew(cat, names) {
  // the pieces the parts panel lists: offered, on a slot that a visible category of a region tab allows
  const tabs = new Map(cat.regions.filter(r => r.categories.length && r.name !== 'Weapons').map(r => [r.name, [r, visibleCategories(r)]]));
  const listed = new Map();
  for (const [n, g] of Object.entries(cat.geometries)) {
    if (!offered(g) || isLeftOutBone(cat, g.bone)) continue;
    const [region, cats] = tabs.get(cat.bones[g.bone]?.region) || [];
    if (cats?.some(c => g.categories.includes(c.name) && slotAllowed(cat, region, c.name, g.bone))) listed.set(n, g);
  }
  // their attachments (pieces on child bones), with the pieces that bring them
  const parentsOf = new Map();
  for (const n of listed.keys()) {
    for (const c of childSlots(cat, n)) for (const [o] of c.options) (parentsOf.get(o) || parentsOf.set(o, new Set()).get(o)).add(n);
  }
  const top = n => (listed.has(n) ? [n] : [...(parentsOf.get(n) || [])]);
  // materials on any of those, and the pieces they're on
  const matOn = new Map();
  for (const n of new Set([...listed.keys(), ...parentsOf.keys()])) {
    for (const [m] of materialsFor(cat, n)) (matOn.get(m) || matOn.set(m, new Set()).get(m)).add(n);
  }
  // new textures one of those materials offers: in which role, and on which materials
  const texOn = new Map();
  for (const m of matOn.keys()) {
    for (const t of cat.materials[m].textures || []) {
      if (!names.textures.has(t) || !cat.textures[t] || isDev(cat.textures[t])) continue;
      const kind = TEXTURE_KINDS.find(k => texturesFor(cat, m, k).some(([x]) => x === t));
      if (!kind) continue;
      const e = texOn.get(t) || texOn.set(t, { kind, materials: new Set() }).get(t);
      e.materials.add(m);
    }
  }
  const holders = new Set();
  const pieces = [...names.pieces].filter(n => listed.has(n) || parentsOf.has(n)).map(n => {
    top(n).forEach(h => holders.add(h));
    const g = cat.geometries[n];
    const where = listed.has(n)
      ? [tabs.get(cat.bones[g.bone]?.region)?.[0].displayName, (cat.bones[g.bone]?.displayName || g.bone).trim()].filter(Boolean).join(' · ')
      : 'Attachment for ' + listNames(top(n).map(p => cat.geometries[p].displayName || p));
    return { name: n, x: g, where };
  });
  const materials = [...names.materials].filter(m => matOn.has(m)).map(m => {
    const on = [...new Set([...matOn.get(m)].flatMap(top))];
    on.forEach(h => holders.add(h));
    return { name: m, x: cat.materials[m], on: on.map(p => cat.geometries[p].displayName || p) };
  });
  const textures = [...texOn].map(([t, { kind, materials: ms }]) => {
    [...ms].flatMap(m => [...matOn.get(m)].flatMap(top)).forEach(h => holders.add(h));
    return { name: t, x: cat.textures[t], kind, on: [...ms].map(m => cat.materials[m].displayName || m) };
  });
  const sets = { pieces: new Set(pieces.map(i => i.name)), materials: new Set(materials.map(i => i.name)), textures: new Set(textures.map(i => i.name)) };
  return { pieces, materials, textures, sets, holders };
}

// "A, B and 2 more"
function listNames(names, most = 3) {
  const u = [...new Set(names)];
  if (u.length <= most) return u.length > 1 ? u.slice(0, -1).join(', ') + ' and ' + u.at(-1) : u[0] || '';
  return `${u.slice(0, most).join(', ')} and ${u.length - most} more`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const longDate = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

// What the editor offers of some entries, for both bodies: {Male: offeredNew(...), Female: ...}. The other
// body's catalogue is read only when the entries have names for it, and not kept (it's big).
async function offeredIn(entries, ch) {
  const out = {};
  for (const sk of Object.keys(BODY)) {
    const names = namesIn(entries, sk);
    if (!KINDS.some(k => names[k].size)) continue;
    let cat = ch.cat?.name === sk ? ch.cat : null;
    if (!cat) {
      try { cat = await (await fetch(`data/catalog/${sk}.json`)).json(); } catch { continue; }
    }
    out[sk] = offeredNew(cat, names);
  }
  return out;
}

// The box: what's new, by kind, each row once for both bodies. news: offeredIn's answer.
function showBox(news, entries, panel, onShow) {
  document.querySelector('.whatsNewBackdrop')?.remove();
  const back = el('div', 'modalBackdrop whatsNewBackdrop'), box = el('div', 'palette whatsNewDialog');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'whatsNewHead');
  const head = el('div', 'phead', 'New in the editor'); head.id = 'whatsNewHead';
  const newest = entries.at(-1), titles = listNames(entries.map(e => e.title).filter(Boolean));
  const added = entries.length > 1 ? `added in the last ${entries.length} updates, the newest on ${longDate(newest.date)}`
    : `added on ${longDate(newest.date)}`;
  const when = el('p', 'wnWhen', titles ? `${titles} · ${added}.` : added[0].toUpperCase() + added.slice(1) + '.');
  // rows: [kind, key] -> {x, label, sub, bodies}
  const rows = new Map();
  const add = (kind, key, it, sub, sk) => {
    const k = kind + '|' + key;
    if (!rows.has(k)) rows.set(k, { kind, x: it.x, label: it.x.displayName || it.name, sub, bodies: [] });
    rows.get(k).bodies.push(BODY[sk]);
  };
  for (const [sk, n] of Object.entries(news)) {
    for (const it of n.pieces) add('pieces', (it.x.displayName || it.name) + '|' + it.where, it, it.where, sk);
    for (const it of n.materials) add('materials', it.x.displayName || it.name, it, 'On ' + listNames(it.on), sk);
    for (const it of n.textures) add('textures', it.x.displayName || it.name, it, `${it.kind === 'Pattern' ? '' : it.kind + ' · '}For ${listNames(it.on)}`, sk);
  }
  const count = kind => [...rows.values()].filter(r => r.kind === kind).length;
  const counts = [['pieces', 'piece'], ['materials', 'material'], ['textures', 'pattern']].filter(([k]) => count(k)).map(([k, w]) => plural(count(k), w));
  const total = el('p', 'wnCounts', counts.length ? (counts.length > 1 ? counts.slice(0, -1).join(', ') + ' and ' + counts.at(-1) : counts[0]) + '.'
    : 'Nothing new for these bodies.');
  const list = el('div', 'wnList');
  for (const [kind, title] of [['pieces', 'Pieces'], ['materials', 'Materials'], ['textures', 'Patterns']]) {
    const these = [...rows.values()].filter(r => r.kind === kind).sort((a, b) => a.sub.localeCompare(b.sub) || a.label.localeCompare(b.label));
    if (!these.length) continue;
    list.append(el('div', 'wnHead', `${title} (${these.length})`));
    for (const r of these) {
      const row = el('div', 'wnItem'), top = el('div', 'wnTop');
      const b = panel.badge(r.x); if (b) top.append(b);
      top.append(el('span', 'wnName', r.label), el('span', 'wnBody', r.bodies.length > 1 ? 'Both' : r.bodies[0]));
      row.title = panel.unlockText(r.x);
      row.append(top, el('div', 'wnSub', r.sub));
      list.append(row);
    }
  }
  const row = el('div', 'row'), show = el('button', 'on', 'Show them'), close = el('button', null, 'Close');
  show.type = close.type = 'button';
  show.title = 'Show only the parts with something new in the Costume tab, marked New';
  show.disabled = !counts.length;
  row.append(show, close);
  box.append(head, when, total, ...(counts.length ? [list] : []), row);
  back.append(box);
  document.body.append(back);
  const done = () => back.remove();
  close.onclick = done;
  show.onclick = () => { done(); onShow(); };
  back.addEventListener('mousedown', e => { if (e.target === back) done(); });  // click outside closes
  back.addEventListener('keydown', e => {
    if (e.key === 'Escape') done();
    else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === show ? close : show.disabled ? close : show).focus(); }
  });
  (show.disabled ? close : show).focus();
}

// Show them: the parts panel keeps what's new, on the Costume tab
function showThem(panel, news) {
  document.querySelector('.mainTabs button[data-tab="costume"]')?.click();
  panel.showNew(Object.fromEntries(Object.entries(news).map(([sk, n]) => [sk, { sets: n.sets, holders: n.holders }])));
}

// At start, once the first costume is in: the box, if an update brought parts since it was last shown
// (settings.json's newPartsSeen, so every window and browser shows it once); and the latest one in About. With
// nothing seen yet (a new install, or an editor from before this), only the newest, if it's from the last 60 days.
const RECENT_DAYS = 60;
export async function setupWhatsNew(panel, ch) {
  if (new URLSearchParams(location.search).has('test')) return;  // the test page drives the editor itself
  const entries = await loadLog();
  if (!entries.length) return;
  const latest = entries.at(-1);
  aboutSection(close => {
    const p = el('p', 'aboutWhatsNew'), open = el('button', null, "What's new");
    open.type = 'button';
    open.title = 'The pieces, materials and patterns the last update added';
    open.onclick = async () => {
      close();
      const news = await offeredIn([latest], ch);
      showBox(news, [latest], panel, () => showThem(panel, news));
    };
    p.append(el('span', 'aboutSub', 'New parts'), ` ${latest.title ? latest.title + ', added' : 'Added'} on ${longDate(latest.date)}. `, open);
    return { el: p, stops: [open] };
  });
  let seen = '';
  try { seen = (await (await fetch('api/source')).json()).newPartsSeen || ''; } catch { return; }
  const recent = e => (Date.now() - new Date(e.date + 'T12:00:00')) / 864e5 <= RECENT_DAYS;
  const unseen = seen ? entries.filter(e => e.id > seen) : [latest].filter(recent);
  if (seen < latest.id) {
    fetch('api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPartsSeen: latest.id }) })
      .catch(() => {});
  }
  if (!unseen.length) return;
  const news = await offeredIn(unseen, ch);
  if (!Object.values(news).some(n => n.holders.size)) return;  // nothing the parts panel lists: nothing to show
  showBox(news, unseen, panel, () => showThem(panel, news));
}
