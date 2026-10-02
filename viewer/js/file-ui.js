// Load / Save buttons for game costume files (costume-file.js). Loading accepts the game's
// Costume_*.jpg, a costume JSON or a demo recording (*.demo: pick one of its players), by button or
// drag & drop onto the page; saving writes a Costume_*.jpg into the game's Live/screenshots (serve.py),
// or downloads it when that can't be done.
import { readCostumeJpeg, writeCostumeJpeg, docToText, costumeFileName, readDemo } from './costume-file.js';
import { partMaterial } from './catalog.js';
import { regionCategory } from './rules.js';

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const store = {
  get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
// the player's account name, written into saved costume files (Save asks for it; Settings edits it). Kept in the
// server's settings.json (serve.py /api/settings), so the app window and any browser share it; this browser's copy
// is only a cache for when the page isn't served by serve.py.
let accountTimer;
const postAccount = v => fetch('api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                 body: JSON.stringify({ account: v }) }).catch(() => {});
export const savedAccount = {
  get: () => store.get('co.account'),
  set: v => { store.set('co.account', v); clearTimeout(accountTimer); accountTimer = setTimeout(() => postAccount(v), 400); },
  // at start, from /api/source: the server's copy wins; one only this browser has (older versions) moves to the server
  adopt: server => { if (server) store.set('co.account', server); else if (store.get('co.account')) postAccount(store.get('co.account')); },
};
const SKELETONS = ['Male', 'Female'];

// What the game stores for a part: its material, the textures set on it, and the material's default for
// any texture the material requires (Requires*) but the part leaves empty. Optional ones stay empty and
// fall back to the material's defaults when drawn.
function resolver(cat) {
  return part => {
    const m = partMaterial(cat, part), d = m?.defaults || {}, req = m?.requires || [];
    const tex = k => part[k] || (req.includes(k) ? d[k] || '' : '');
    return { material: m?.name || part.material, pattern: tex('pattern'), detail: tex('detail'),
             diffuse: tex('diffuse'), specular: tex('specular') };
  };
}
// RegionCategory lines: the costume's own (in its order), plus any other region that holds pieces
function regionCategories(cat, doc) {
  const out = {};
  for (const name of Object.keys(doc.regionCategories || {})) {
    const r = cat.regions.find(x => x.name === name);
    out[name] = r ? regionCategory(cat, doc, r) : doc.regionCategories[name];
  }
  for (const r of cat.regions)
    if (!(r.name in out) && doc.parts.some(p => cat.bones[p.bone]?.region === r.name)) out[r.name] = regionCategory(cat, doc, r);
  return out;
}

// The costume's own name is "<account>_<character>" in the game's reference-name case: every word
// lower case with a capital first letter ("DeVore Disciple" -> "Sadders1_Devore Disciple").
export const costumeRefName = (account, character) =>
  `${account}_${character}`.toLowerCase().replace(/(^|[\s_])(\S)/g, (m, a, b) => a + b.toUpperCase());

export function costumeText(ch, account, character) {
  return docToText(ch.doc, { name: costumeRefName(account, character), resolve: resolver(ch.cat),
                             regionCategories: regionCategories(ch.cat, ch.doc) });
}

// The costume check's findings: errors (couldn't be built as written), warnings (changed), notes.
function showReport(problems, label, loaded) {
  document.querySelector('.reportDialog')?.remove();
  const count = l => problems.filter(p => p.level === l).length;
  const [errors, warnings] = [count('error'), count('warning')];
  if (loaded && !errors && !warnings) return;
  const box = el('div', 'palette reportDialog');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Costume check');
  box.append(el('div', 'phead', 'Costume check'));
  box.append(el('div', 'hint', `${label}: ${loaded ? 'loaded' : 'not loaded'} · ${errors} errors, ${warnings} changes or warnings`
    + (count('info') ? `, ${count('info')} notes` : '')));
  const list = el('ul', 'reportList');
  for (const lvl of ['error', 'warning', 'info'])
    for (const p of problems.filter(x => x.level === lvl)) {
      const li = el('li', 'r-' + lvl);
      li.append(el('b', null, { error: 'Error', warning: 'Changed', info: 'Note' }[lvl] + ' '), el('code', null, p.where), ' ' + p.message);
      list.append(li);
    }
  const row = el('div', 'row'), close = el('button', null, 'Close');
  close.onclick = () => box.remove();
  row.append(close);
  box.append(list, row);
  document.body.append(box);
  box.style.left = '392px'; box.style.top = '60px';
  close.focus();
}

// Shown before a demo's players: other people's characters are for learning from, not copying without
// asking. Darkens the page; resolves true for "I understand", false for Cancel / Escape.
function demoNotice() {
  return new Promise(resolve => {
    const back = el('div', 'modalBackdrop'), box = el('div', 'palette noticeDialog');
    box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'demoNoticeHead');
    const head = el('div', 'phead', 'Before you look around'); head.id = 'demoNoticeHead';
    box.append(head,
      el('p', null, 'Loading other players\' characters from a demo recording is meant for learning: seeing how a look was put together.'),
      el('p', null, 'Please get the player\'s permission before recreating anyone\'s costume too closely.'));
    const row = el('div', 'row'), ok = el('button', null, 'I understand'), cancel = el('button', null, 'Cancel');
    ok.type = cancel.type = 'button';
    row.append(ok, cancel); box.append(row); back.append(box); document.body.append(back);
    const done = v => { back.remove(); resolve(v); };
    ok.onclick = () => done(true); cancel.onclick = () => done(false);
    back.addEventListener('keydown', e => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === ok ? cancel : ok).focus(); }
    });
    back.addEventListener('mousedown', e => { if (e.target === back) e.preventDefault(); });  // keep focus in the dialog
    ok.focus();
  });
}

// A demo's players: the recording player first, with a drop-down of their costume slots (the worn one
// chosen), then everyone else in the order they came into view. pick(player, doc, mark) loads one and
// passes the document it opens to mark(). The list stays open (Close or Escape) so you can click
// through them, and marks the one loaded until something else is (open() announces each load with a
// 'costume-open' event).
function showDemoPicker(demo, label, pick) {
  document.querySelector('.demoDialog')?.remove();
  const box = el('div', 'palette demoDialog'), picked = new WeakSet(), stop = new AbortController();
  document.addEventListener('costume-open', e => {
    if (!box.isConnected) { stop.abort(); return; }  // replaced by another demo's list
    if (!picked.has(e.detail)) for (const r of list.children) r.classList.remove('on');
  }, { signal: stop.signal });
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Players in the demo');
  box.append(el('div', 'phead', 'Players in the demo'));
  box.append(el('div', 'hint', `${label}${demo.zone ? ' · ' + demo.zone.replace(/_/g, ' ') : ''} · ${demo.players.length} players · click one to try it on`));
  const list = el('div', 'demoList');
  const close = () => { box.remove(); stop.abort(); };
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  const choose = (row, p, doc) => {
    for (const r of list.children) r.classList.toggle('on', r === row);
    pick(p, doc, d => picked.add(d));
  };
  for (const p of demo.players) {
    const ok = SKELETONS.includes(p.doc.skeleton);
    const who = el('button', 'who'); who.type = 'button';
    who.append(el('span', 'nm', p.name), el('span', 'sub',
      [ok ? p.doc.skeleton : `${p.doc.skeleton} (not supported yet)`, p.account && '@' + p.account].filter(Boolean).join(' · ')));
    const row = el('div', 'demoRow' + (p.active ? ' me' : ''));
    row.append(who);
    if (p.active) {
      who.querySelector('.nm').append(el('span', 'badge', 'Recorded by you'));
      if (p.slots.length) {
        // the costume slots; the worn one comes from the slot list when it's there, else it's listed first
        const slot = el('select'); slot.setAttribute('aria-label', `${p.name}'s costume`);
        if (p.worn < 0) slot.append(new Option('Worn in the demo', -1));
        p.slots.forEach((s, i) => slot.append(new Option(`Costume ${i + 1}${i === p.worn ? ' (worn)' : ''}`
          + (SKELETONS.includes(s.skeleton) ? '' : ` · ${s.skeleton}, not supported`), i)));
        slot.value = String(p.worn);
        const docOf = () => (+slot.value < 0 ? p.doc : p.slots[+slot.value]);
        row.append(slot);
        const tryOn = () => { if (SKELETONS.includes(docOf().skeleton)) choose(row, p, docOf()); };
        who.onclick = tryOn;
        slot.onchange = tryOn;  // switching slots puts that costume on straight away
        list.append(row);
        continue;
      }
    }
    who.disabled = !ok;
    who.onclick = () => choose(row, p, p.doc);
    list.append(row);
  }
  const foot = el('div', 'row'), closeButton = el('button', null, 'Close');
  closeButton.type = 'button'; closeButton.onclick = close;
  foot.append(closeButton);
  box.append(list, foot);
  document.body.append(box);
  box.style.left = '392px'; box.style.top = '60px';
  list.querySelector('button:not(:disabled)')?.focus();
}

// Returns { pickFile(target) }: Load's file picker for another figure (View > Compare with). A target is
// { open(doc, fileInfo) }; the character's own is Load's (ch.fileInfo for the save dialog, then open).
export function setupFiles({ ch, open, renderPreview, status, loadButton, saveButton, dropTarget }) {
  // ---- load ----
  const main = { open: async (doc, info) => { ch.fileInfo = info; await open(doc); } };
  const input = el('input'); input.type = 'file'; input.accept = '.jpg,.jpeg,image/jpeg,.json,application/json,.demo'; input.hidden = true;
  document.body.append(input);
  // Costume JSON (index/GUIDE.md, e.g. written by an AI): checked and completed by the server
  // (costume_check.py), then loaded; what the check changed or found is shown.
  const importJson = async (text, label, target = main) => {
    let costume;
    try { costume = JSON.parse(text); } catch (e) { status(`${label} isn't valid JSON: ${e.message}`); return; }
    let res;
    try {
      const r = await fetch('api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                           body: JSON.stringify({ costume }) });
      res = await r.json();
    } catch (e) { status('Could not check the costume: ' + e.message); return; }
    showReport(res.problems || [], label, !!res.doc);
    if (!res.doc) return;
    await target.open(res.doc, null);
  };
  // A demo recording: pick a player; the save dialog then offers their character name and your account.
  const loadDemo = async (file, target) => {
    let demo;
    try { demo = readDemo(await file.text()); } catch (e) { status('Could not read ' + file.name + ': ' + e.message); console.warn(e); return; }
    if (!demo.players.length) { status(`No players in ${file.name}`); return; }
    if (!await demoNotice()) {  // cancelled: nothing of the demo stays, including an earlier demo's player list
      document.querySelector('.demoDialog')?.remove();
      status(`${file.name} not loaded`);
      return;
    }
    let latest = 0;
    showDemoPicker(demo, file.name, async (p, doc, mark) => {
      const n = ++latest;  // clicking through quickly: only the last pick reports (ch.load drops the others)
      const d = { ...doc, name: p.name };
      mark(d);
      await target.open(d, { account: '', character: p.name });
      if (n === latest) status(`Loaded ${p.name} from ${file.name}`);
    });
  };
  const load = async (file, target = main) => {
    if (/\.json$/i.test(file.name)) { await importJson(await file.text(), file.name, target); return; }
    if (/\.demo$/i.test(file.name)) { await loadDemo(file, target); return; }
    try {
      const info = readCostumeJpeg(await file.arrayBuffer());
      if (!SKELETONS.includes(info.doc.skeleton)) throw new Error(`Skeleton "${info.doc.skeleton}" isn't supported yet`);
      await target.open({ ...info.doc, name: info.character || info.doc.name }, { account: info.account, character: info.character });
      if (!info.hashOk) status(`Loaded ${info.character}, but its checksum doesn't match: the game would reject this file (it was changed outside the game). Saving it again fixes that.`);
    } catch (e) { status('Could not load ' + file.name + ': ' + e.message); console.warn(e); }
  };
  // Load: the server's native Open dialog, which starts in the game's Live/screenshots (the browser's own
  // picker can't be pointed at a folder); the browser's picker when the page isn't served by serve.py
  // pickFile(target) -> true once a file is read (a demo then shows its players), false if cancelled
  let picking = false, browserTarget = main;
  const pickFile = async (target = main) => {
    if (picking) return false;
    picking = true;
    try {
      const r = await fetch('api/file/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (r.ok && r.headers.get('Content-Type') === 'application/octet-stream') {
        const file = new File([await r.blob()], decodeURIComponent(r.headers.get('X-File-Name') || 'costume.jpg'));
        picking = false;
        await load(file, target);
        return true;
      }
      const res = await r.json().catch(() => ({}));
      if (res.cancelled) return false;
      if (r.status === 409) { status(res.error); return false; }
      throw new Error(res.error || `server answered ${r.status}`);
    } catch (e) {  // quick failures only (no serve.py, no tkinter), so the click still lets the browser's picker open
      console.warn("Open dialog unavailable, using the browser's:", e);
      browserTarget = target;
      input.click();
      return true;  // the browser's picker says nothing when it's cancelled
    } finally { picking = false; }
  };
  loadButton.onclick = () => pickFile(main);
  input.onchange = () => { if (input.files[0]) load(input.files[0], browserTarget); input.value = ''; browserTarget = main; };
  dropTarget.addEventListener('dragover', e => { e.preventDefault(); dropTarget.classList.add('dropping'); });
  dropTarget.addEventListener('dragleave', () => dropTarget.classList.remove('dropping'));
  dropTarget.addEventListener('drop', e => {
    e.preventDefault(); dropTarget.classList.remove('dropping');
    const f = [...e.dataTransfer.files].find(x => /\.(jpe?g|json|demo)$/i.test(x.name)); if (f) load(f);
  });
  // paste a costume JSON anywhere (not into a text field)
  document.addEventListener('paste', e => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    const text = e.clipboardData?.getData('text') || '';
    if (/^\s*\{[\s\S]*"parts"[\s\S]*\}\s*$/.test(text)) { e.preventDefault(); importJson(text, 'Pasted costume'); }
  });

  // ---- save ----
  saveButton.onclick = () => {
    document.querySelector('.saveDialog')?.remove();
    const box = el('div', 'palette saveDialog');
    box.append(el('div', 'phead', 'Save costume'));
    const field = (label, value, hint) => {
      const l = el('label', 'field'); l.append(el('span', null, label));
      const i = el('input'); i.value = value; i.placeholder = hint; l.append(i); box.append(l); return i;
    };
    // the account is always yours (Settings), not the one in a loaded file; a new costume (starting costume,
    // New masculine/feminine, JSON) has no character yet
    const acc = field('Account', savedAccount.get(), 'your @handle, without the @');
    const name = field('Character', ch.fileInfo?.character || (ch.doc.name || '').replace(/^Archetype_/, ''), 'character name');
    const note = el('div', 'hint', 'Saved into the game\'s Live/screenshots folder, where the tailor finds it.'
      + (savedAccount.get() ? '' : ' Your account is remembered for next time (change it in Settings).'));
    const row = el('div', 'row'), ok = el('button', null, 'Save'), cancel = el('button', null, 'Cancel');
    row.append(ok, cancel); box.append(note, row);
    document.body.append(box);
    const r = saveButton.getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.top = r.bottom + 6 + 'px';
    (acc.value.trim() ? name : acc).focus();
    cancel.onclick = () => box.remove();
    for (const i of [acc, name]) i.onkeydown = e => { if (e.key === 'Enter') ok.click(); else if (e.key === 'Escape') box.remove(); };
    ok.onclick = async () => {
      const account = acc.value.trim().replace(/^@/, ''), character = name.value.trim();
      if (!account || !character) {
        note.textContent = 'Both names are needed: the game stores them in the file.';
        (account ? name : acc).focus(); return;
      }
      if (!savedAccount.get()) savedAccount.set(account);  // the first one typed becomes the Settings account
      try {
        const text = costumeText(ch, account, character);
        const jpeg = await new Promise(res => renderPreview().toBlob(res, 'image/jpeg', 0.92));
        const file = await writeCostumeJpeg(jpeg, { account, character, gender: ch.cat.gender, text });
        const name = costumeFileName(account, character);
        // straight into the game's Live/screenshots (serve.py); a download if that can't be done
        let saved = null, why = '';
        try {
          const r = await fetch('api/costume/save?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: file });
          const res = await r.json().catch(() => ({ error: `server answered ${r.status}` }));
          if (res.ok) saved = res.path; else why = res.error || '';
        } catch (e) { why = e.message; }
        if (!saved) {
          const a = el('a'); a.href = URL.createObjectURL(file); a.download = name;
          document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }
        ch.fileInfo = { account, character };
        box.remove();
        status(saved ? `Saved ${saved}` : `Downloaded ${name}${why ? ` (couldn't save it to the game: ${why})` : ''}. Move it into the game's Live\\screenshots folder.`);
      } catch (e) { note.textContent = 'Could not save: ' + e.message; console.warn(e); }
    };
  };
  return { pickFile };
}
