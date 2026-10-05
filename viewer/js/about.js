// About: who made the editor, thanks, and the legal notice. A centred dialog over a darkened page.
// It also tells the player when a newer version is out: serve.py asks GitHub at most once a day (/api/update,
// off in Settings), and a newer one shows in the version label in the corner and at the top of the About box,
// with Update now in the installed editor: serve.py downloads the installer, checks it and starts it
// (/api/update/install), so the update doesn't go through the browser's download checks.
// Links open in the default browser through serve.py (/api/open): the editor's own window may be Edge while the
// player's browser is another. Other modules can add a section (aboutSection): what's new in the game does.
import { VERSION } from './version.js';
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

const INSTALLER = 'https://github.com/codexheroes/co-character-creator/releases/latest/download/CO-Costume-Editor-Setup.exe';
const RELEASE = 'https://github.com/codexheroes/co-character-creator/releases/latest';
// newer: {version, url, current, installable} of a release newer than this one
let aboutButton = null, versionLabel = null, newer = null;
let update = { state: 'idle' };   // Update now (serve.py's UPDATE): idle, downloading, checking, starting, started, error
let updateUI = null;              // { button, state } in the open About box
const updating = () => ['downloading', 'checking', 'starting'].includes(update.state);
const sections = [];              // more for the About box: make(close) -> {el, stops} or null (whats-new.js)
export function aboutSection(make) { sections.push(make); }

// is version a (0.6.10) newer than b (0.6.4)?
function isNewer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// A link to one of the project's pages, opened in the default browser by serve.py, or as usual without it
function external(a, href) {
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.onclick = e => {
    e.preventDefault();
    fetch('api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: href }) })
      .then(r => { if (!r.ok) throw new Error(r.status); })
      .catch(() => window.open(href, '_blank', 'noopener'));
  };
  return a;
}

function showVersion() {
  if (!versionLabel) return;
  versionLabel.replaceChildren('v' + VERSION);
  versionLabel.classList.toggle('hasUpdate', !!newer);
  aboutButton?.classList.toggle('hasUpdate', !!newer);
  if (aboutButton) aboutButton.title = newer ? `Version ${newer.version} is available. Who made this, thanks, and the legal notice`
    : 'Who made this, thanks, and the legal notice';
  if (!newer) return;
  const pct = update.state === 'downloading' && update.total ? ` ${Math.round(update.got / update.total * 100)}%` : '';
  const link = el('button', 'updateLink', updating() || update.state === 'started' ? `updating to v${newer.version}${pct}`
    : `v${newer.version} is available`);
  link.type = 'button';
  link.onclick = () => aboutButton?.click();
  versionLabel.append(' · ', link);
}

// ---- Update now ---------------------------------------------------------------------------------
function progressText() {
  const mb = n => (n / 1048576).toFixed(1);
  switch (update.state) {
    case 'downloading': return update.total ? `Downloading version ${update.version}: ${mb(update.got)} of ${mb(update.total)} MB…`
      : 'Asking GitHub for the new version…';
    case 'checking': return "Checking the download against GitHub's checksum…";
    case 'starting': return 'Starting the installer. Windows may ask for permission…';
    case 'started': return "The installer is running. The editor closes now so it can update, and the installer's last page can open the new one.";
    case 'error': return update.error || 'The update stopped.';
    default: return '';
  }
}
function showUpdate() {
  showVersion();
  if (!updateUI?.state.isConnected) return;
  updateUI.state.textContent = progressText();
  updateUI.state.hidden = update.state === 'idle';
  updateUI.state.classList.toggle('bad', update.state === 'error');
  updateUI.button.disabled = updating() || update.state === 'started';
}
async function updateNow() {
  if (updating() || update.state === 'started') return;
  update = { state: 'downloading', got: 0, total: 0 };
  showUpdate();
  try {
    const r = await fetch('api/update/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json().catch(() => ({}));
    update = r.ok ? j : { state: 'error', error: j.error || "Update now couldn't start. Download the installer yourself instead." };
  } catch { update = { state: 'error', error: "The editor didn't answer. Download the installer yourself instead." }; }
  while (updating()) {  // serve.py downloads, checks and starts it
    showUpdate();
    await new Promise(r => setTimeout(r, 400));
    try { update = await (await fetch('api/update/status')).json(); }
    catch { update = update.state === 'starting' ? { state: 'started' } : { state: 'error', error: 'The editor stopped answering.' }; }
  }
  showUpdate();
  if (update.state === 'started') setTimeout(() => window.close(), 2500);  // the editor stops; the installer reopens it
}

// Ask the server for the newest release (not under the test page, which runs offline); quietly does nothing
// when it can't tell. Called at start, and again when Settings turns checking back on. force (Settings' Check
// now) has the server ask GitHub straight away; the answer, {version, error, newer, current}, is for Settings
// to say what it found.
export async function checkForUpdate({ force = false } = {}) {
  if (new URLSearchParams(location.search).has('test')) return null;
  let rel;
  try {
    const r = await fetch(force ? 'api/update?force=1' : 'api/update');
    rel = r.ok ? await r.json() : { error: true };
  } catch { rel = { error: true }; }
  newer = rel.version && isNewer(rel.version, rel.current || VERSION) ? rel : null;
  showVersion();
  return { ...rel, newer: !!newer, current: rel.current || VERSION };
}
export function clearUpdate() { newer = null; showVersion(); }

export function setupAbout(button, label) {
  aboutButton = button; versionLabel = label;
  showVersion();
  checkForUpdate();
  button.onclick = () => {
    document.querySelector('.aboutBackdrop')?.remove();
    const back = el('div', 'modalBackdrop aboutBackdrop'), box = el('div', 'palette aboutDialog');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'aboutHead');
    const head = el('div', 'phead', 'CO Costume Editor ' + VERSION); head.id = 'aboutHead';

    // a newer version: Update now (the installed editor), or where to get it; updating keeps everything
    const stops = [];
    let updateBox = null;
    if (newer) {
      updateBox = el('div', 'aboutUpdate');
      const notes = external(el('a', null, "what's new"), newer.url || RELEASE);
      const line = el('p');
      if (newer.installable) {
        const now = el('button', null, 'Update now'), self = external(el('a', null, 'download it yourself'), INSTALLER);
        now.type = 'button'; now.onclick = updateNow;
        now.title = 'Download the installer from GitHub, check it, and start it';
        line.append(el('span', 'aboutSub', 'New version!'), ` Version ${newer.version} is out (`, notes, ').');
        const row = el('p', 'aboutUpdateRow'), state = el('p', 'aboutUpdateState');
        row.append(now, el('span', null, ' or '), self);
        state.setAttribute('role', 'status');
        updateUI = { button: now, state };
        updateBox.append(line, row, state, el('p', null, 'Update now downloads the installer from GitHub, checks it, and starts it. '
          + "The editor closes while it updates. Your settings and the editor's data stay."));
        stops.push(notes, now, self);
      } else {
        const get = external(el('a', null, `Download version ${newer.version}`), INSTALLER);
        line.append(el('span', 'aboutSub', 'New version!'), ' ', get, ' (', notes, ').');
        updateBox.append(line, el('p', null, 'Run the installer to update. It keeps your settings and the editor\'s data, so it starts straight away.'));
        stops.push(get, notes);
      }
    }

    const made = el('p');
    made.append('Made by ', el('b', null, '@sadders1'), '. Feel free to hit me up in-game!');
    // bugs and ideas: the project's GitHub issues, as on the website
    const bugs = el('p'), bugLink = external(el('a', null, 'Open an issue on GitHub.'), 'https://github.com/codexheroes/co-character-creator/issues');
    bugs.append('Found a bug or have an idea? ', bugLink);

    const thanks = el('div', 'aboutThanks');
    const logo = el('img'); logo.src = 'img/adventurers.svg'; logo.alt = 'Adventurers supergroup emblem';
    const link = external(el('a', null, 'codexheroes.com/co/adventurers'), 'https://codexheroes.com/co/adventurers/');
    const words = el('div');
    const said = el('p');
    said.append(el('span', 'aboutSub', 'Special thanks'), ' to the Adventurers supergroup for their help with testing.');
    words.append(said, link);
    thanks.append(logo, words);

    const legal = el('div', 'aboutLegal');
    legal.append(
      el('p', null, 'Champions Online, its characters, costume pieces, artwork and other game content are the property of their respective owners.'),
      el('p', null, 'The CO Costume Editor is an unofficial fan project. It is not affiliated with, endorsed by or supported by Cryptic Studios, Arc Games or any owner of Champions Online.'),
      el('p', null, 'It reads the game files from your own installation and does not include or redistribute them. Use it at your own risk.'));

    const row = el('div', 'row'), close = el('button', null, 'Close'); close.type = 'button';
    row.append(close);
    const extra = sections.map(make => make(() => back.remove())).filter(Boolean);
    for (const x of extra) stops.push(...x.stops);
    box.append(head, ...(updateBox ? [updateBox] : []), ...extra.map(x => x.el), made, bugs, thanks, legal, row);
    back.append(box);
    document.body.append(back);
    showUpdate();  // an update already under way
    const done = () => { back.remove(); button.focus(); };
    close.onclick = done;
    back.addEventListener('mousedown', e => { if (e.target === back) done(); });  // click outside closes
    stops.push(bugLink, link, close);
    back.addEventListener('keydown', e => {
      if (e.key === 'Escape') done();
      else if (e.key === 'Tab') {  // keep focus in the dialog: its links, then Close
        e.preventDefault();
        const i = stops.indexOf(document.activeElement);
        stops[(i + (e.shiftKey ? stops.length - 1 : 1)) % stops.length].focus();
      }
    });
    close.focus();
  };
}
