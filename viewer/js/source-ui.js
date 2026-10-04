// Settings: the game folder the server reads meshes and textures from (serve.py /api/source), the
// account name written into saved costume files (kept in the browser, file-ui.js), and whether to look for
// new versions (about.js; kept in settings.json, on unless turned off). Shows the
// folder in use and lets the player pick another, with the server's folder picker or by typing a path.
// A change reloads the page, since every loaded mesh and texture came from the old folder.
// With no usable folder there is nothing to draw with (even the editor's art comes from the game), so the
// page shows a welcome screen that asks for the folder instead (firstRun).
import { savedAccount } from './file-ui.js';
import { checkForUpdate, clearUpdate } from './about.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

async function api(body) {
  const r = await fetch('api/source', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json().catch(() => ({ error: `server answered ${r.status}` }));
}

// The editor's data is built from the game files by the server (build.py): on first use and after a game
// patch that takes a minute or two. Hold the page until it's ready, showing what's being done; if it had
// to wait, reload so every catalog is the new one. Resolves false when there's no data to start with.
export async function waitForBuild(view) {
  let info;
  try { info = await api(); } catch { return true; }  // not served by serve.py: nothing to wait for
  if (!info.ok) { firstRun(info); return new Promise(() => {}); }  // the page reloads once there's a folder
  const busy = i => ['checking', 'building'].includes(i.build?.state);
  if (!busy(info) && info.build?.state !== 'error') return true;
  const note = el('div', 'buildNote'); view.append(note);
  // building: a bar with how much is done (build.py's '%%' lines), the stage, and a rough time left
  const bar = el('div', 'bnBar'), fill = el('div', 'bnFill'), pct = el('div', 'bnPct'), stepText = el('div', 'bnStep');
  const left = el('div', 'bnHint');
  bar.append(fill); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
  let waited = false, shown = null;
  while (busy(info)) {
    if (info.build.state === 'building') {
      waited = true;
      if (shown !== 'building') {
        shown = 'building';
        note.replaceChildren(el('div', 'bnTitle', 'Building the editor from your game files'), bar, pct, stepText, left,
          el('div', 'bnHint', 'This takes a minute or two the first time, and again after the game is patched.'));
      }
      const p = Math.min(1, info.build.progress || 0), secs = info.build.started ? Date.now() / 1000 - info.build.started : 0;
      fill.style.width = (p * 100).toFixed(1) + '%';
      bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      pct.textContent = `${Math.floor(p * 100)}%`;
      stepText.textContent = info.build.step || 'Starting…';
      const rest = p > 0.08 && secs > 5 ? secs * (1 - p) / p : null;  // a guess from the pace so far
      left.textContent = rest == null ? 'Working…' : rest < 10 ? 'Almost done' : `About ${rest < 60 ? Math.ceil(rest / 5) * 5 + ' seconds' : Math.round(rest / 60) + ' minute' + (Math.round(rest / 60) > 1 ? 's' : '')} left`;
    } else if (shown !== 'checking') { shown = 'checking'; note.replaceChildren(el('div', 'bnStep', 'Checking your game files…')); }
    await new Promise(r => setTimeout(r, 1000));
    try { info = await api(); } catch { /* server restarting: keep polling */ }
  }
  if (info.build?.state === 'error') {
    note.replaceChildren(el('div', 'bnTitle', 'Could not build the editor from your game files'),
      el('pre', 'bnError', info.build.error || ''), el('div', 'bnHint', 'Check the game folder in Settings.'));
    return false;
  }
  if (waited) { location.reload(); return new Promise(() => {}); }
  note.remove();
  return true;
}

// opts.exportSheet(anchor): open the character sheet export (sheet.js)
export async function setupSettings(button, opts = {}) {
  let info;
  try { info = await api(); } catch { button.hidden = true; return; }  // not served by serve.py
  savedAccount.adopt(info.account);

  const open = () => {
    document.querySelector('.settingsDialog')?.remove();
    const box = el('div', 'palette settingsDialog');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Settings');
    box.append(el('div', 'phead', 'Settings'));
    const sec = el('div', 'gameFolder');
    sec.append(el('div', 'gfLabel', 'Game folder'));
    const row = el('div', 'gfRow');
    const input = el('input'); input.type = 'text'; input.spellcheck = false; input.setAttribute('aria-label', 'Champions Online folder');
    input.title = 'Your Champions Online install (the folder with Live\\piggs). Type a path and press Enter, or Browse.';
    const use = el('button', null, 'Use'), browse = el('button', null, 'Browse…');
    use.type = browse.type = 'button';
    row.append(input, use, browse);
    const state = el('div', 'gfState'); state.setAttribute('role', 'status');
    sec.append(row, state);
    // the account written into saved costume files (the Save dialog asks for the character)
    const accSec = el('div', 'gameFolder');
    accSec.append(el('div', 'gfLabel', 'Account'));
    const acc = el('input'); acc.type = 'text'; acc.spellcheck = false; acc.value = savedAccount.get();
    acc.placeholder = 'your @handle, without the @'; acc.setAttribute('aria-label', 'Account name');
    acc.oninput = () => savedAccount.set(acc.value.trim().replace(/^@/, ''));
    acc.onkeydown = e => { if (e.key === 'Escape' || e.key === 'Enter') box.remove(); };
    const accRow = el('div', 'gfRow'); accRow.append(acc);
    accSec.append(accRow, el('div', 'gfState', 'Saved costume files carry your account name. Save asks for the character name.'));
    // new versions: serve.py asks GitHub at most once a day (/api/update), about.js shows a newer one
    const updSec = el('div', 'gameFolder'), updLabel = el('label', 'gfCheck'), upd = el('input');
    upd.type = 'checkbox'; upd.checked = info.checkUpdates !== false;
    updLabel.append(upd, "Tell me when there's a new version");
    upd.onchange = async () => {
      info.checkUpdates = upd.checked;
      await fetch('api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ checkUpdates: upd.checked }) }).catch(() => {});
      if (upd.checked) checkForUpdate(); else clearUpdate();
    };
    // Check now: ask GitHub straight away (works with the daily check off too) and say what came back
    const now = el('button', null, 'Check now'); now.type = 'button'; now.title = 'Ask GitHub now whether a newer version is out';
    const updState = el('div', 'gfState'); updState.setAttribute('role', 'status'); updState.hidden = true;
    now.onclick = async () => {
      now.disabled = true; updState.hidden = false; updState.classList.remove('bad'); updState.textContent = 'Asking GitHub…';
      const res = await checkForUpdate({ force: true });
      now.disabled = false;
      if (!res) { updState.hidden = true; return; }  // the test page doesn't ask
      updState.classList.toggle('bad', !!res.error && !res.newer);
      updState.textContent = res.newer ? `Version ${res.version} is out. About has ${res.installable ? 'Update now' : 'the download link'}.`
        : res.error ? "GitHub couldn't be reached. Try again in a little while."
        : `You have the newest version (${res.current}).`;
    };
    const updRow = el('div', 'gfRow'); updRow.append(updLabel, now);
    updSec.append(el('div', 'gfLabel', 'Updates'), updRow, updState,
      el('div', 'gfState', 'Once a day the editor asks GitHub which version is the newest, and Check now asks straight away. It sends nothing else: no costumes, settings or game details.'));
    // a picture of the current character from four sides (sheet.js), when the page provides it
    const sheetSec = el('div', 'gameFolder');
    if (opts.exportSheet) {
      const exp = el('button', null, 'Export character sheet…'); exp.type = 'button';
      exp.onclick = () => { box.remove(); opts.exportSheet(button); };
      sheetSec.append(el('div', 'gfLabel', 'Character sheet'), exp,
        el('div', 'gfState', 'The face from three angles and the whole character from four sides, 16:9, on blue, white or black.'));
    }
    const foot = el('div', 'row'), close = el('button', null, 'Close'); close.type = 'button';
    foot.append(close);
    box.append(sec, accSec, updSec, ...(opts.exportSheet ? [sheetSec] : []), foot);
    document.body.append(box);
    const r = button.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8)) + 'px';
    box.style.top = r.bottom + 6 + 'px';

    const show = (i, note) => {
      input.value = i.folder || '';
      state.textContent = note || (i.ok ? `Reading ${i.files.toLocaleString()} meshes and textures from the game's archives.`
        : `${i.error || 'No game folder'}. Choose your Champions Online folder.`);
      state.classList.toggle('bad', !i.ok || !!note && !i.changed);
    };
    show(info);
    const apply = async (body) => {
      state.classList.remove('bad');
      state.textContent = body.browse ? 'Waiting for the folder picker (it may open behind this window)…' : 'Checking…';
      const res = await api(body);
      if (res.changed) { info = res; show(res, 'Folder changed. Reloading…'); setTimeout(() => location.reload(), 300); return; }
      show(res.folder !== undefined ? res : info, res.cancelled ? undefined : res.error);
    };
    browse.onclick = () => apply({ browse: true });
    use.onclick = () => apply({ path: input.value });
    input.onkeydown = e => { if (e.key === 'Enter') apply({ path: input.value }); else if (e.key === 'Escape') box.remove(); };
    close.onclick = () => box.remove();
    input.focus();
  };
  button.onclick = open;
}

// The first time (or when the game has moved): a whole-page welcome that asks where the game is. Drawn
// with plain CSS (.firstRun in index.html), since the editor's own art is built from the game files.
function firstRun(info) {
  document.body.classList.add('noGame');
  const page = el('div', 'firstRun'), box = el('div', 'frBox');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'frHead');
  const head = el('h2', null, 'Welcome to the CO Costume Editor'); head.id = 'frHead';
  const why = el('p', null, 'The editor draws every costume piece straight from your own copy of Champions Online, '
    + "so it needs to know where the game is installed. It couldn't find it by itself.");
  const moved = info.saved ? el('p', 'frWarn', `The game used to be in ${info.saved}, but it isn't there any more.`) : null;
  // installs found on this PC (when the saved one has gone but another is there)
  const found = el('div', 'frFound');
  for (const f of info.found || []) {
    const b = el('button', 'frBig', 'Use ' + f); b.type = 'button';
    b.onclick = () => apply({ path: f });
    found.append(b);
  }
  const browse = el('button', 'frBig', 'Find my game folder…'); browse.type = 'button';
  const tip = el('p', 'frHint', "A folder window opens: pick the Champions Online folder (the one with a Live folder "
    + 'in it) and press Select Folder. Picking the folder above it, such as Steam or Arc Games, works too.');
  const or = el('div', 'frOr', 'or paste the folder’s address');
  const row = el('div', 'frRow'), input = el('input'), use = el('button', null, 'Use'); use.type = 'button';
  input.type = 'text'; input.spellcheck = false; input.setAttribute('aria-label', 'Champions Online folder');
  input.placeholder = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Champions Online';
  row.append(input, use);
  const state = el('div', 'frState'); state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
  const help = el('details', 'frHelp'), sum = el('summary', null, 'Where is my game installed?');
  const steps = el('ul');
  steps.append(
    el('li', null, 'Steam: in your Library, right-click Champions Online, then Manage › Browse local files. Copy the '
      + "address from the top of the window that opens and paste it above."),
    el('li', null, 'Arc: usually C:\\Program Files (x86)\\Arc Games\\Champions Online.'),
    el('li', null, "The game has to be installed on this PC. The editor only reads its files and never changes them."));
  help.append(sum, steps);
  box.append(head, why, ...(moved ? [moved] : []), found, browse, tip, or, row, state, help);
  page.append(box);
  document.body.append(page);

  const busy = on => { for (const b of box.querySelectorAll('button')) b.disabled = on; input.disabled = on; };
  async function apply(body) {
    busy(true); state.classList.remove('bad');
    state.textContent = body.browse ? 'Waiting for you to pick a folder…' : 'Checking…';
    let res;
    try { res = await api(body); } catch { res = { error: 'The editor stopped responding. Close it and start it again.' }; }
    if (res.changed) { state.textContent = 'Found it! Getting the editor ready…'; setTimeout(() => location.reload(), 400); return; }
    busy(false);
    state.textContent = res.cancelled ? '' : res.error || '';
    state.classList.toggle('bad', !res.cancelled);
    if (res.rejected) { input.value = res.rejected; input.focus(); }
  }
  browse.onclick = () => apply({ browse: true });
  use.onclick = () => apply({ path: input.value });
  input.onkeydown = e => { if (e.key === 'Enter') apply({ path: input.value }); };
  (found.firstChild || browse).focus();
}
