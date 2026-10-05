// The costume creator's item browser: region tabs -> category -> slots, each slot a
// ◀ piece ▶ cycler whose name opens a searchable list. Hovering a list entry previews it on the
// character; leaving the list puts the old piece back. The selected slot shows its material,
// pattern/detail/diffuse textures, colours and child attachments; an attachment opens the same way inside it.
// The filter bar under the region tabs keeps only the slots with a piece whose name has all its words, and
// narrows their lists to those pieces. What's new's Show them (whats-new.js) narrows them the same way, to the
// pieces with something an update added, and tags what's new.
import {
  isDev, regionCategory, visibleCategories, slotsFor, piecesFor, childSlots, pickPiece, pickCategory,
  materialsFor, texturesFor, partOn, isLeftOutBone, offered, slotAllowed,
} from './rules.js';
import { drawnTexture, partMaterial } from './catalog.js';
import {
  LINK, linkOf, palettes, slotChanges, sharedChanges, linkChanges, applyColorChanges, snapshotColors,
  openPalette, placePopup, css, DEFAULT_SHARED,
} from './colors.js';
import { SKIN_SLOT } from './costume-material.js';

const CSTORE = /c_?store|microtransaction/i;
const SOURCE_LABEL = [
  [/c_?store|microtransaction/i, 'C-Store'], [/lockbox/i, 'Lockbox'], [/perk/i, 'Perk'], [/pvp/i, 'PvP'],
  [/subscription|patriot/i, 'Gold/Lifetime'], [/reward|anniversary|foxbatcon|highnoon|nemesis|nighthawk/i, 'Reward'],
  [/f2p/i, 'Free-to-play set'], [/crafting/i, 'Crafting'], [/questionite/i, 'Questionite'],
];
function sourceLabel(u) { return SOURCE_LABEL.find(([re]) => re.test(u.source))?.[1] || u.source.replace(/^Items\//, ''); }
// How to get an unlock, in plain words, from its source folder and set/event name in the game files (unlocks.json).
// A strong hint, not a certainty: the game files don't say more, and the editor can't see what an account owns.
const HOW_TO = [
  [/c_?store|microtransaction/i, d => `Bought in the C-Store (Zen)${d ? `: look for "${d}"` : ''}.`],
  [/lockbox/i, d => `From ${d ? `the ${d} ` : 'a '}lockbox. Lockbox costume unlocks can often be bought from other players on the Exchange.`],
  [/subscription|patriot/i, () => 'A subscriber unlock (Gold or Lifetime accounts).'],
  [/f2p/i, () => "Part of a costume set that free (Silver) accounts don't have; Gold and Lifetime accounts, or buying the set, unlock it."],
  [/perk/i, () => 'Earned with a perk (an in-game achievement).'],
  [/pvp/i, () => 'A PvP reward.'],
  [/foxbatcon|nemesis|highnoon|anniversary|nighthawk/i, (d, src) => `From the ${src.replace(/^Items\//, '').replace(/con$/, 'Con')} event or promotion.`],
  [/reward/i, d => `An in-game reward${d ? ` (${d})` : ''}: from an event, mission or other reward.`],
  [/crafting/i, () => 'Made with crafting.'],
  [/questionite/i, () => 'Bought with Questionite.'],
  [/retailer/i, () => 'A retailer or pre-order bonus.'],
  [/veteran/i, () => 'A veteran reward.'],
  [/test_costumes|items\/dev|tailorhack/i, () => 'A developer or test item: probably not obtainable.'],
];
function howToUnlock(u) {
  const hit = HOW_TO.find(([re]) => re.test(u.source));
  return hit ? hit[1](u.detail, u.source) : `Listed under "${u.source.replace(/^Items\//, '').replace(/_/g, ' ')}" in the game files.`;
}
function prettyUnlock(u) {
  return u.name.replace(/^(Item_Costume_|Items?_|Cstore_|0_)/i, '').replace(/_[MF]$/, '').replace(/_/g, ' ');
}

// The filter bar's words, and whether a piece's name has them all (any order, any case)
const filterWords = q => q.toLowerCase().split(/\s+/).filter(Boolean);
const nameMatches = (name, words) => { const n = name.toLowerCase(); return words.every(w => n.includes(w)); };
const BODY_WORD = { Male: 'masculine', Female: 'feminine' };

const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

export class PartsPanel {
  constructor(root, ch, shared, onChange) {
    this.root = root; this.ch = ch; this.shared = shared; this.unlocks = shared.unlocks; this.onChange = onChange || (() => {});
    this.opts = { mirror: true, hideLocked: false, showDev: false };
    this.region = null; this.selected = null; this.child = null;  // the open slot's bone, and its open attachment's
    this.filter = '';  // the filter bar's text (kept across region tabs and costumes)
    this.news = null;  // Show them: {skeleton: {sets: {pieces, materials, textures}, holders}} (whats-new.js), or null
    this.picker = null;
    addEventListener('keydown', e => this.picker?.key(e));
    addEventListener('mousedown', e => { if (this.picker && !this.picker.el.contains(e.target)) this.picker.cancel(); });
  }

  get cat() { return this.ch.cat; }
  get doc() { return this.ch.doc; }

  reset() { this.region = this.cat.regions.find(r => slotsFor(this.cat, r, regionCategory(this.cat, this.doc, r), this.opts).length)?.name; this.selected = this.child = null; this.render(); }

  // The worn part whose piece brings `bone` as an attachment (child bone), if any
  parentOf(bone) {
    if (!this.cat.bones[bone]?.isChild) return null;
    return this.doc.parts.find(p => this.cat.geometries[p.geometry]?.childGeos?.some(c => c.bone === bone))?.bone || null;
  }

  // ---- badges / tooltips ---------------------------------------------------------------------
  badge(x) {
    if (!x || x.availability !== 'unlock') return null;
    const us = (x.unlockedBy || []).map(i => this.unlocks[i]).filter(Boolean);
    const img = el('img', 'badge');
    const cstore = us.length && us.every(u => CSTORE.test(u.source));
    img.src = cstore ? 'ui/CC_Costume_Purchased.png' : 'ui/CC_Costume_Locked.png';
    img.alt = cstore ? 'C-Store' : 'Unlock';
    return img;
  }
  unlockText(x) {
    if (!x || x.availability !== 'unlock') return 'Available to everyone';
    const us = (x.unlockedBy || []).map(i => this.unlocks[i]).filter(Boolean);
    if (!us.length) return 'Needs an unlock (source unknown)';
    const groups = new Map();
    for (const u of us) { const k = sourceLabel(u); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(prettyUnlock(u)); }
    return 'Unlocked by:\n' + [...groups].map(([k, v]) => `${k}: ${v.slice(0, 4).join(', ')}${v.length > 4 ? ` (+${v.length - 4} more)` : ''}`).join('\n');
  }
  // While Show them is on: "New" on what an update added, "+new" on a piece that has a new material,
  // pattern or attachment. An item's `fresh` is 'new', 'holds' or null.
  freshTag(fresh) {
    if (!fresh || !this.news) return null;
    const t = el('span', 'freshTag' + (fresh === 'holds' ? ' holds' : ''), fresh === 'holds' ? '+new' : 'New');
    t.title = fresh === 'holds' ? 'Has a new material, pattern or attachment' : 'New in this update';
    return t;
  }

  // ---- applying edits (with hover preview) ----------------------------------------------------
  async apply(changes, { preview = false } = {}) {
    if (preview) {
      this.backup ||= new Map();
      for (const c of changes) if (!this.backup.has(c.bone)) this.backup.set(c.bone, structuredClone(partOn(this.doc, c.bone)));
    }
    await Promise.all(changes.map(c => this.ch.setPart(c.bone, c.part)));
    if (!preview) { this.backup = null; this.render(); this.onChange(); }
  }
  async revert() {
    const b = this.backup; this.backup = null;
    if (b) await Promise.all([...b].map(([bone, part]) => this.ch.setPart(bone, part)));
  }

  // ---- colour edits (hover preview like pieces) ------------------------------------------------
  previewColors(changes) {
    if (!changes) { this.revertColors(); return; }
    this.colorBackup ||= new Map();
    for (const b of snapshotColors(this.ch, changes)) if (!this.colorBackup.has(b.bone)) this.colorBackup.set(b.bone, b);
    applyColorChanges(this.ch, changes);
  }
  revertColors() {
    if (this.colorBackup) applyColorChanges(this.ch, [...this.colorBackup.values()]);
    this.colorBackup = null;
  }
  commitColors(changes) {
    this.revertColors();
    if (changes) applyColorChanges(this.ch, changes);
    this.render(); this.onChange();
  }
  // skin: preview with rgba, restore with null, keep with commit
  setSkin(rgba, commit) {
    this.skinBackup ??= [...this.doc.skin];
    if (commit) { this.ch.setSkin([...rgba]); this.skinBackup = null; this.render(); this.onChange(); }
    else if (rgba) this.ch.setSkin([...rgba]);
    else { this.ch.setSkin(this.skinBackup); this.skinBackup = null; }
  }

  chip(rgba, { label, title, glow, skin, onClick }) {
    const b = el('button', 'chip' + (skin ? ' skin' : '') + (glow > 1 ? ' glow' : ''));
    b.style.backgroundColor = css(rgba);
    if (label) b.append(el('span', null, label));
    b.title = title || ''; b.onclick = e => { e.stopPropagation(); onClick(b); };
    return b;
  }
  skinPalette(anchor) {
    openPalette(anchor, {
      title: 'Skin', colors: this.pal.skin, current: this.doc.skin, glow: null, dropper: false,
      onPreview: rgba => this.setSkin(rgba, false), onCommit: rgba => this.setSkin(rgba, true), onCancel: () => this.setSkin(null, false),
    });
  }

  // The costume-wide box: shared colours, skin, colour schemes, shuffle / randomise / reset.
  colorsBox() {
    const { doc } = this, pal = this.pal;
    const box = el('div', 'colorsBox');
    const row = el('div', 'chips');
    row.append(el('span', 'lab', 'Shared colours'));
    const withSlot = (i, rgba) => sharedChanges(doc, { colors: doc.colors.map((x, j) => (j === i ? rgba : x)), glow: doc.glow });
    doc.colors.forEach((c, i) => row.append(this.chip(c, {
      label: String(i + 1), glow: doc.glow[i], title: `Shared colour ${i + 1}: every part linked to "Shared" uses it`,
      onClick: a => openPalette(a, {
        title: `Shared colour ${i + 1}`, colors: pal.body, current: c, glow: null,
        onPreview: rgba => this.previewColors(rgba ? withSlot(i, rgba) : null),
        onCommit: rgba => this.commitColors(withSlot(i, rgba)),
        onCancel: () => this.revertColors(),
      }),
    })));
    row.append(this.chip(doc.skin, { label: 'Skin', skin: true, title: 'Skin tone (colour 4 on skin materials)', onClick: a => this.skinPalette(a) }));
    box.append(row);
    const tools = el('div', 'tools');
    const btn = (label, title, fn) => { const b = el('button', null, label); b.title = title; b.onclick = fn; tools.append(b); };
    btn('Schemes', "Colour schemes (the skeleton's colour quads)", e => this.openSchemes(e.currentTarget));
    btn('Shuffle', 'Rotate the four shared colours',
        () => this.commitColors(sharedChanges(doc, { colors: [doc.colors[3], ...doc.colors.slice(0, 3)], glow: [doc.glow[3], ...doc.glow.slice(0, 3)] })));
    btn('Randomise', 'Four random palette colours', () => {
      const pick = () => pal.body[Math.floor(Math.random() * pal.body.length)];
      this.commitColors(sharedChanges(doc, { colors: [pick(), pick(), pick(), pick()], glow: [0, 0, 0, 0] }));
    });
    btn('Reset', 'Back to the colours the costume was loaded with', () => {
      const o = this.ch.original;
      const changes = [{ bone: null, colors: (o.colors || DEFAULT_SHARED).map(c => [...c]), glow: [...(o.glow || [0, 0, 0, 0])] }];
      for (const p of doc.parts) {
        const op = o.parts.find(x => x.bone === p.bone && x.geometry === p.geometry);
        if (op) changes.push({ bone: p.bone, link: op.colorLink, colors: op.colors, glow: op.glow || [0, 0, 0, 0] });
      }
      this.ch.setSkin([...o.skin]);
      this.commitColors(changes);
    });
    box.append(tools);
    return box;
  }

  // Colour schemes: hover previews a quad on the shared colours, click keeps it.
  openSchemes(anchor) {
    const { doc } = this;
    const box = el('div', 'palette schemes');
    box.append(el('div', 'phead', 'Colour schemes'));
    const grid = el('div', 'quads');
    this.pal.quads.forEach((q, i) => {
      const t = el('button', 'quad'); t.title = `Scheme ${i + 1}`;
      for (const c of q) { const sp = el('span'); sp.style.background = css(c); t.append(sp); }
      const changes = () => sharedChanges(doc, { colors: q.map(c => [...c]), glow: [0, 0, 0, 0] });
      t.onmouseenter = () => this.previewColors(changes());
      t.onclick = () => { close(); this.commitColors(changes()); };
      grid.append(t);
    });
    grid.onmouseleave = () => this.revertColors();
    box.append(grid);
    document.body.append(box);
    placePopup(box, anchor);
    const off = e => { if (!box.contains(e.target)) { close(); this.revertColors(); } };
    const close = () => { box.remove(); removeEventListener('mousedown', off, true); };
    addEventListener('mousedown', off, true);
  }

  // Link buttons and the part's four colours. Skin materials show the skin tone in colour 4.
  partColors(bone, part, mat) {
    const { cat, doc } = this, pal = this.pal;
    const wrap = el('div', 'partColors');
    const links = el('div', 'links');
    links.append(el('span', 'lab', 'Colours'));
    const mirrorBone = cat.bones[bone]?.mirrorBone, hasMirror = !!mirrorBone && !!partOn(doc, mirrorBone);
    const link = linkOf(part);
    const shown = link === LINK.MirrorGroup ? LINK.Mirror : [LINK.Group, LINK.Different].includes(link) ? LINK.None : link;
    for (const [v, label, tip] of [[LINK.All, 'Shared', "Use the costume's shared colours"],
                                   [LINK.Mirror, 'Mirror', 'Same colours as the matching piece on the other side'],
                                   [LINK.None, 'Unique', 'This piece keeps its own colours']]) {
      if (v === LINK.Mirror && !hasMirror) continue;
      const b = el('button', 'link' + (shown === v ? ' on' : ''), label); b.title = tip;
      b.onclick = () => this.commitColors(linkChanges(cat, doc, bone, v));
      links.append(b);
    }
    wrap.append(links);
    const chips = el('div', 'chips');
    const hasSkin = this.ch.parts.get(bone)?.res?.hasSkin;
    part.colors.forEach((c, i) => {
      if (hasSkin && i === SKIN_SLOT) {
        chips.append(this.chip(doc.skin, { label: 'Skin', skin: true, title: 'Colour 4 is the skin tone on this material', onClick: a => this.skinPalette(a) }));
        return;
      }
      const allow = !!mat?.allowGlow?.[i], g0 = part.glow?.[i] || 0;
      const changes = (rgba, glow) => slotChanges(cat, doc, bone, i, { rgba: rgba || undefined, glow: allow ? glow : undefined });
      chips.append(this.chip(c, {
        label: String(i + 1), glow: g0,
        title: `Colour ${i + 1}${link === LINK.All ? ' (shared)' : ''}${allow ? ' · can glow' : ''}${g0 > 1 ? ` · glow ${g0}` : ''}`,
        onClick: a => openPalette(a, {
          title: `Colour ${i + 1}${link === LINK.All ? ' (shared)' : ''}`, colors: pal.body, current: c,
          glow: allow ? { value: g0, max: 10 } : null,
          onPreview: (rgba, glow) => this.previewColors(rgba || glow !== g0 ? changes(rgba, glow) : null),
          onCommit: (rgba, glow) => this.commitColors(changes(rgba, glow)),
          onCancel: () => this.revertColors(),
        }),
      }));
    });
    wrap.append(chips);
    return wrap;
  }

  // ---- the list popup -----------------------------------------------------------------------
  // items: [{value, label, data}] ; value '' = none
  openPicker(anchor, items, current, { changes, title }) {
    this.picker?.cancel();
    const box = el('div', 'picker');
    const search = el('input'); search.placeholder = `Search ${items.length} ${title || 'items'}…`;
    const list = el('div', 'list');
    box.append(search, list);
    document.body.append(box);
    let rows = [], active = -1, previewTimer = null;
    const preview = v => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => this.apply(changes(v), { preview: true }), 60);
    };
    const draw = (scroll = true) => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = ''; rows = [];
      for (const it of items) {
        if (q && !it.label.toLowerCase().includes(q) && !String(it.value).toLowerCase().includes(q)) continue;
        const row = el('div', 'item' + (it.value === current ? ' current' : '') + (it.data && !it.data.mesh && it.data.mesh !== undefined ? ' missing' : ''));
        const b = this.badge(it.data); if (b) row.append(b);
        row.append(el('span', 'nm', it.label));
        const f = this.freshTag(it.fresh); if (f) row.append(f);
        row.title = `${it.value || 'none'}\n${this.unlockText(it.data)}${it.data && it.data.mesh === null ? '\n(mesh not installed locally)' : ''}`;
        row.onmouseenter = () => { active = rows.indexOf(row); mark(); preview(it.value); };
        row.onclick = () => done(it.value);
        row.dataset.value = it.value;
        list.append(row); rows.push(row);
      }
      active = rows.findIndex(r => r.dataset.value === current);
      mark(scroll);
    };
    const mark = scroll => rows.forEach((r, i) => { r.classList.toggle('active', i === active); if (scroll && i === active) r.scrollIntoView({ block: 'center' }); });
    const close = () => { clearTimeout(previewTimer); box.remove(); this.picker = null; };
    const done = async v => { close(); await this.apply(changes(v)); };
    list.onmouseleave = () => { clearTimeout(previewTimer); this.revert(); };
    search.oninput = () => draw();
    this.picker = {
      el: box,
      cancel: () => { close(); this.revert(); },
      key: e => {
        if (e.key === 'Escape') { e.preventDefault(); this.picker.cancel(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); active = Math.max(0, Math.min(rows.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
          mark(true); preview(rows[active].dataset.value);
        } else if (e.key === 'Enter' && rows[active]) { e.preventDefault(); done(rows[active].dataset.value); }
      },
    };
    // placed once it's filled: placed while empty, it fitted, then the rows ran off the bottom of the window
    draw(false);
    placePopup(box, anchor);
    mark(true);
    search.focus();
  }

  // ◀ name ▶ : arrows step through items and commit, the name opens the list
  cycler(label, items, current, changes, opts = {}) {
    const row = el('div', 'cycler' + (opts.cls ? ' ' + opts.cls : ''));
    const lab = el('span', 'lab', label);
    const cur = items.find(i => i.value === current);
    const idx = items.indexOf(cur);
    const step = d => {
      if (!items.length) return;
      const next = items[((idx < 0 ? (d > 0 ? -1 : 0) : idx) + d + items.length) % items.length];
      this.apply(changes(next.value));
    };
    const left = el('button', 'arrow left'), right = el('button', 'arrow right');
    left.title = 'Previous'; right.title = 'Next';
    left.onclick = e => { e.stopPropagation(); step(-1); }; right.onclick = e => { e.stopPropagation(); step(1); };
    const name = el('button', 'name');
    const b = this.badge(cur?.data); if (b) name.append(b);
    name.append(el('span', 'nm', cur ? cur.label : opts.emptyLabel || '— none —'));
    const f = this.freshTag(cur?.fresh); if (f) name.append(f);
    name.title = `${current || 'none'}\n${this.unlockText(cur?.data)}${cur?.data?.mesh === null ? '\n(mesh not installed locally)' : ''}`;
    name.onclick = e => { e.stopPropagation(); opts.onOpen?.(); this.openPicker(name, items, current, { changes, title: opts.title }); };
    row.append(lab, left, name, right);
    return row;
  }

  // ---- the filter bar -------------------------------------------------------------------------
  // The input lives across renders, so typing in it isn't interrupted by the panel redrawing.
  filterBar() {
    if (!this.filterEl) {
      const bar = el('div', 'filterBar');
      bar.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4.5 4.5"/></svg>';
      const input = el('input'); input.type = 'text'; input.placeholder = 'Filter parts…'; input.spellcheck = false;
      input.setAttribute('aria-label', 'Filter parts by name');
      input.title = 'Show only the slots with a piece whose name has all these words';
      const clear = el('button', 'clear', '×'); clear.type = 'button'; clear.title = 'Clear the filter (Esc)';
      // Show them's tag: only what's new (whats-new.js); a click shows everything again
      const fresh = el('button', 'newOnly'); fresh.type = 'button';
      fresh.append('New', el('span', null, '×'));
      fresh.title = 'Showing only the parts with something new. Click to show everything';
      input.oninput = () => this.setFilter(input.value);
      input.onkeydown = e => { if (e.key === 'Escape' && input.value) { e.preventDefault(); this.setFilter(''); } };
      clear.onclick = () => { this.setFilter(''); input.focus(); };
      fresh.onclick = () => this.showNew(null);
      bar.append(fresh, input, clear);
      this.filterEl = { bar, input, clear, fresh };
    }
    const { bar, input, clear, fresh } = this.filterEl;
    if (input.value !== this.filter) input.value = this.filter;
    clear.hidden = !this.filter;
    fresh.hidden = !this.news;
    input.placeholder = this.news ? 'Filter the new parts…' : 'Filter parts…';
    bar.classList.toggle('active', !!this.filter.trim() || !!this.news);
    return bar;
  }
  setFilter(text) { this.filter = text; this.render(); }

  // Show them (whats-new.js): only the slots and pieces with something new from an update, starting on a tab
  // that has some. news: {skeleton: {sets: {pieces, materials, textures}, holders}}; null shows everything again.
  showNew(news) {
    this.news = news;
    if (news && this.cat) {
      const hits = this.filterHits(filterWords(this.filter)), tabs = this.cat.regions.filter(r => r.categories.length && r.name !== 'Weapons');
      const r = tabs.find(r => this.hitsIn(hits, r, regionCategory(this.cat, this.doc, r)).length)
        || tabs.find(r => visibleCategories(r).some(c => this.hitsIn(hits, r, c.name).length));
      if (r) { this.region = r.name; this.selected = this.child = null; }
    }
    this.render();
  }
  get newHere() { return this.news?.[this.cat?.name] || null; }
  // the item's tag while Show them is on: what kind of new it is (see freshTag)
  fresh(kind, name) {
    const nw = this.newHere;
    return !nw ? null : nw.sets[kind].has(name) ? 'new' : kind === 'pieces' && nw.holders.has(name) ? 'holds' : null;
  }

  // Whether a piece passes the filter bar: its name has all the words, and with Show them on, it has something new
  matches(name, label, words) {
    return (!words.length || nameMatches(label, words)) && (!this.news || !!this.newHere?.holders.has(name));
  }
  // What the filter keeps, for its messages: 'match "red"', 'have something new', or both ('matches', 'has' for one)
  filterWhat(one = false) {
    const t = this.filter.trim();
    return [t && `match${one ? 'es' : ''} "${t}"`, this.news && `ha${one ? 's' : 've'} something new`].filter(Boolean).join(' and ');
  }

  // Offered pieces that pass the filter: [[name, geo]] (one pass over the catalogue per redraw)
  filterHits(words) {
    return Object.entries(this.cat.geometries).filter(([n, g]) => offered(g, this.opts) && this.matches(n, g.displayName || n, words));
  }
  // Of those, the ones a region's category offers
  hitsIn(hits, region, category) {
    return hits.filter(([, g]) => g.categories.includes(category) && slotAllowed(this.cat, region, category, g.bone));
  }

  // ---- rendering ------------------------------------------------------------------------------
  render() {
    const { cat, doc, root } = this;
    if (!cat) return;
    // the filter's input is redrawn too: keep the caret in it while typing
    const typing = this.filterEl && document.activeElement === this.filterEl.input;
    const caret = typing && [this.filterEl.input.selectionStart, this.filterEl.input.selectionEnd];
    root.innerHTML = '';
    this.pal = palettes(cat, this.shared);
    root.append(this.colorsBox());
    const words = filterWords(this.filter), hits = words.length || this.news ? this.filterHits(words) : null;
    const tabs = el('div', 'tabs');
    for (const r of cat.regions) {
      if (!r.categories.length || r.name === 'Weapons') continue;
      const t = el('button', 'tab' + (r.name === this.region ? ' on' : ''), r.displayName);
      t.onclick = () => { this.region = r.name; this.selected = this.child = null; this.render(); };
      if (hits) {  // how many pieces pass the filter in the tab's category
        const n = this.hitsIn(hits, r, regionCategory(cat, doc, r)).length;
        t.classList.toggle('nomatch', !n);
        t.title = n ? `${n} piece${n > 1 ? 's' : ''} that ${this.filterWhat(n === 1)}` : `No pieces here ${this.filterWhat()}`;
      }
      tabs.append(t);
    }
    root.append(tabs, this.filterBar());
    if (typing) { this.filterEl.input.focus(); this.filterEl.input.setSelectionRange(...caret); }
    const region = cat.regions.find(r => r.name === this.region) || cat.regions[0];
    const category = regionCategory(cat, doc, region);
    const cats = visibleCategories(region, category).map(c => ({ value: c.name, label: c.displayName }));
    root.append(this.cycler('Category', cats, category, v => {
      doc.regionCategories = { ...(doc.regionCategories || {}), [region.name]: v };
      return pickCategory(cat, doc, region, v, this.opts);
    }, { cls: 'category', title: 'categories' }));

    const slots = el('div', 'slots');
    const here = hits && this.hitsIn(hits, region, category), hereBones = here && new Set(here.map(([, g]) => g.bone));
    for (const s of slotsFor(cat, region, category, this.opts)) {
      if (!here || hereBones.has(s.bone)) slots.append(this.slot(s, category, words));
    }
    if (hits) {  // nothing here, or more in the region's other categories (pieces this one doesn't offer: many are in several)
      const curName = cats.find(c => c.value === category)?.label || category, hereNames = new Set(here.map(([n]) => n));
      const others = visibleCategories(region, category).filter(c => c.name !== category)
        .map(c => [c.displayName, this.hitsIn(hits, region, c.name).filter(([n]) => !hereNames.has(n)).length]).filter(([, n]) => n);
      const msg = [];
      if (this.news && !this.newHere?.holders.size) {  // Show them, on the other body than the update's new parts
        const others = Object.entries(this.news).filter(([sk, n]) => sk !== cat.name && n?.holders.size).map(([sk]) => BODY_WORD[sk] || sk);
        msg.push(`Nothing new for ${BODY_WORD[cat.name] || cat.name} characters.`
          + (others.length ? ` The update added parts for ${others.join(' and ')} ones: use New ${others[0]}, or load a ${others[0]} costume.` : ''));
      } else if (!here.length) msg.push(`No ${curName} parts ${this.filterWhat()}.`);
      if (others.length) msg.push(`${here.length ? 'More' : 'Matches'} in other categories: ${others.map(([c, n]) => `${c} (${n})`).join(', ')}. Switch the category to see them.`);
      if (msg.length) slots.append(el('div', 'filterNote', msg.join(' ')));
    }
    root.append(slots);

    const o = el('div', 'panelOpts');
    for (const [key, label, tip] of [['mirror', 'Mirror left/right', 'Picking a left or right piece also puts its mirror piece on the other side'],
                                     ['hideLocked', 'Hide locked', 'Hide pieces, materials and patterns that need an unlock'],
                                     ['showDev', 'Show unused/NPC', 'Also list pieces the artists marked NPC, UNUSED or DEPRECATED']]) {
      const l = el('label'); l.title = tip;
      const c = el('input'); c.type = 'checkbox'; c.checked = this.opts[key];
      c.onchange = () => { this.opts[key] = c.checked; this.render(); };
      l.append(c, ' ' + label); o.append(l);
    }
    // what this costume needs unlocked, with how to get it
    const locked = this.lockedItems();
    const ub = el('button', 'unlocksBtn' + (locked.length ? ' some' : ''), locked.length ? `Unlocks (${locked.length})` : 'Unlocks');
    ub.type = 'button';
    ub.title = locked.length ? 'Pieces, materials and patterns on this costume that need an unlock, and how to get them'
      : 'Everything on this costume is available from the start';
    ub.onclick = e => { e.stopPropagation(); this.unlocksPopup(ub); };
    o.append(ub);
    root.append(o);
  }

  // Everything worn that needs an unlock: [{ kind, name, bone, slot, unlocks: [unlock] }], one per item
  lockedItems() {
    const { cat, doc } = this, out = [], seen = new Set();
    const add = (kind, x, part) => {
      if (!x || x.availability !== 'unlock') return;
      const key = kind + '|' + (x.displayName || x.name);
      if (seen.has(key)) return;  // a mirrored pair is one unlock
      seen.add(key);
      out.push({ kind, name: x.displayName || x.name, bone: part.bone, slot: (cat.bones[part.bone]?.displayName || part.bone).trim(),
                 unlockedBy: x.unlockedBy || [], unlocks: (x.unlockedBy || []).map(i => this.unlocks[i]).filter(Boolean) });
    };
    for (const part of doc.parts) {
      if (isLeftOutBone(cat, part.bone)) continue;  // kept from the file but not shown or edited here
      const g = cat.geometries[part.geometry];
      add('Piece', g && { ...g, name: part.geometry }, part);
      add('Material', partMaterial(cat, part), part);
      for (const k of ['pattern', 'detail', 'diffuse', 'specular']) {
        const t = part[k] && cat.textures[part[k]];
        if (t) add(k === 'pattern' ? 'Pattern' : 'Texture', { ...t, name: part[k] }, part);
      }
    }
    return out;
  }

  unlocksPopup(anchor) {
    document.querySelector('.unlocksDialog')?.remove();
    const items = this.lockedItems();
    const box = el('div', 'palette unlocksDialog');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Unlocks for this costume');
    box.append(el('div', 'phead', items.length ? `Unlocks for this costume (${items.length})` : 'Unlocks for this costume'));
    const list = el('div', 'unlockList');
    if (!items.length) list.append(el('p', 'unlockNone', 'Everything on this costume is available from the start.'));
    const done = () => { box.remove(); removeEventListener('mousedown', off, true); removeEventListener('keydown', esc, true); };
    for (const it of items) {
      const row = el('button', 'unlockItem'); row.type = 'button';
      row.title = `Show ${it.slot}`;
      const head = el('div', 'uiHead');
      const b = this.badge({ availability: 'unlock', unlockedBy: it.unlockedBy }); if (b) head.append(b);
      head.append(el('span', 'uiName', it.name), el('span', 'uiKind', `${it.kind} · ${it.slot}`));
      row.append(head);
      // one line per way to get it (a piece can come with several sets)
      const groups = new Map();
      for (const u of it.unlocks) { const how = howToUnlock(u); if (!groups.has(how)) groups.set(how, []); groups.get(how).push(u); }
      if (!groups.size) row.append(el('div', 'uiHow', "Needs an unlock; the game files don't say which."));
      for (const [how, us] of groups) {
        const line = el('div', 'uiHow', how);
        const names = [...new Set(us.map(prettyUnlock))];
        line.append(el('span', 'uiItems', ` Unlock item${names.length > 1 ? 's' : ''}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` (+${names.length - 3} more)` : ''}.`));
        if (us.every(u => u.account)) line.append(el('span', 'uiItems', ' Account-wide.'));
        row.append(line);
      }
      row.onclick = () => {  // show the part: its region tab, opened (an attachment, opened inside its parent's slot)
        const parent = this.parentOf(it.bone), bone = parent || it.bone;
        const region = this.cat.regions.find(r => r.name === this.cat.bones[bone]?.region);
        if (region) this.region = region.name;
        this.selected = bone; this.child = parent ? it.bone : null; this.render();
        if ((this.filter || this.news) && !this.root.querySelector('.slot.selected')) { this.filter = ''; this.showNew(null); }  // the filter hid it
        (this.root.querySelector('.childSlot.selected') || this.root.querySelector('.slot.selected'))?.scrollIntoView({ block: 'nearest' });
      };
      list.append(row);
    }
    const note = el('div', 'hint', 'Where each unlock comes from is read from the game files, so take it as a strong hint. '
      + "The editor can't see what your account owns: the game marks locked pieces when you load the costume at the tailor.");
    const foot = el('div', 'row'), close = el('button', null, 'Close'); close.type = 'button';
    foot.append(close);
    box.append(list, note, foot);
    document.body.append(box);
    // beside the side panel, so the part a click opens stays in view
    const side = this.root.closest('#side')?.getBoundingClientRect();
    if (side && side.right + 8 + box.offsetWidth <= innerWidth - 8) {
      box.style.left = side.right + 8 + 'px';
      box.style.top = Math.max(8, Math.min(anchor.getBoundingClientRect().bottom - box.offsetHeight, innerHeight - box.offsetHeight - 8)) + 'px';
    } else placePopup(box, anchor);
    const off = e => { if (!box.contains(e.target) && e.target !== anchor) done(); };
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); done(); anchor.focus(); } };
    addEventListener('mousedown', off, true); addEventListener('keydown', esc, true);
    close.onclick = () => { done(); anchor.focus(); };
    close.focus();
  }

  slot(s, category, words = []) {
    const { cat, doc } = this;
    const wrap = el('div', 'slot' + (this.selected === s.bone ? ' selected' : ''));
    const part = partOn(doc, s.bone);
    // while filtering: the matching pieces, and the one worn (so the row still names it)
    const items = piecesFor(cat, s.bone, category, { ...this.opts, keep: part?.geometry })
      .map(([n, g]) => ({ value: n, label: g.displayName || n, data: g, fresh: this.fresh('pieces', n) }))
      .filter(it => it.value === part?.geometry || this.matches(it.value, it.label, words));
    if (!s.required) items.unshift({ value: '', label: '— none —', data: null });
    // by what's drawn, not this.selected: opening the piece list selects the slot without redrawing, so after
    // closing the list unchanged the slot is still drawn closed. On an open slot it closes an open attachment.
    const select = () => { if (!wrap.classList.contains('selected') || this.child) { this.selected = s.bone; this.child = null; this.render(); } };
    const row = this.cycler((s.def.displayName || s.bone).trim(), items, part?.geometry || '',
      v => pickPiece(cat, doc, s.bone, v || null, { mirror: this.opts.mirror }),
      { onOpen: () => { if (this.selected !== s.bone) { this.selected = s.bone; this.child = null; } },
        title: words.length ? `pieces matching "${this.filter.trim()}"` : this.news ? 'pieces with something new' : 'pieces' });
    row.querySelector('.lab').onclick = select;
    wrap.append(row);
    const state = this.ch.parts.get(s.bone);
    if (state?.error) wrap.append(el('div', 'note', 'Could not load: ' + state.error));
    else if (part && state && !state.mesh) wrap.append(el('div', 'note', 'Mesh not installed locally'));
    if (this.selected === s.bone && part) wrap.append(this.details(s.bone, part));
    else if (part) row.append(this.swatches(part, select));
    return wrap;
  }

  // A closed part's colours beside its name; a click opens it.
  swatches(part, open) {
    const sw = el('div', 'swatches'); sw.onclick = open; sw.title = 'Edit material, pattern and colours';
    for (const c of part.colors) { const d = el('span'); d.style.background = hex(c); sw.append(d); }
    return sw;
  }

  // material / textures / colours / child attachments of the selected slot
  details(bone, part) {
    const { cat, doc } = this;
    const box = el('div', 'details');
    const setField = patch => [{ bone, part: { ...partOn(doc, bone), ...patch } }];
    const mat = partMaterial(cat, part);
    const mats = materialsFor(cat, part.geometry, { ...this.opts }).map(([n, m]) => ({ value: n, label: m.displayName || n, data: m, fresh: this.fresh('materials', n) }));
    if (mat && !mats.some(m => m.value === mat.name)) mats.unshift({ value: mat.name, label: mat.displayName || mat.name, data: mat });
    if (mats.length > 1) box.append(this.cycler('Material', mats, mat?.name, v => setField({ material: v, pattern: '', detail: '', diffuse: '', specular: '' }), { cls: 'sub', title: 'materials' }));
    if (mat) {
      for (const [kind, field] of [['Pattern', 'pattern'], ['Detail', 'detail'], ['Diffuse', 'diffuse'], ['Specular', 'specular']]) {
        const list = texturesFor(cat, mat.name, kind, this.opts).map(([n, t]) => ({ value: n, label: t.displayName || n, data: t, fresh: this.fresh('textures', n) }));
        if (!list.length) continue;
        const cur = drawnTexture(cat, part, mat, field);  // what's drawn, also for a required texture left empty
        if (cur && !list.some(t => t.value === cur) && cat.textures[cur]) list.unshift({ value: cur, label: cat.textures[cur].displayName || cur, data: cat.textures[cur] });
        if (!mat.requires?.includes(field)) list.unshift({ value: '', label: '— none —', data: null });
        if (list.length < 2) continue;
        box.append(this.cycler(kind, list, cur, v => setField({ [field]: v }), { cls: 'sub', title: kind.toLowerCase() + 's' }));
      }
    }
    box.append(this.partColors(bone, part, mat));
    for (const c of childSlots(cat, part.geometry, this.opts)) {
      const cur = partOn(doc, c.bone);
      const items = c.options.map(([n, g]) => ({ value: n, label: g.displayName || n, data: g, fresh: this.fresh('pieces', n) }));
      if (cur && !items.some(i => i.value === cur.geometry) && cat.geometries[cur.geometry])
        items.unshift({ value: cur.geometry, label: cat.geometries[cur.geometry].displayName, data: cat.geometries[cur.geometry] });
      if (!c.required) items.unshift({ value: '', label: '— none —', data: null });
      if (items.length < 2 && !cur) continue;
      // the attachment is a part of its own: its name opens (or closes) its material, textures and colours
      const open = !!cur && this.child === c.bone;
      const wrap = el('div', 'childSlot' + (open ? ' selected' : ''));
      const toggle = () => { if (cur) { this.child = open ? null : c.bone; this.render(); } };
      const row = this.cycler('↳ ' + (c.def.displayName || c.bone).trim().replace(/^Attachment\s*/i, ''), items, cur?.geometry || '',
        v => pickPiece(cat, doc, c.bone, v || null, { mirror: this.opts.mirror }), { cls: 'sub child', title: 'attachments' });
      row.querySelector('.lab').onclick = toggle;
      wrap.append(row);
      if (open) wrap.append(this.details(c.bone, cur));
      else if (cur) row.append(this.swatches(cur, toggle));
      box.append(wrap);
    }
    return box;
  }
}
