// About: who made the editor, thanks, and the legal notice. A centred dialog over a darkened page.
// It also tells the player when a newer version is out: serve.py asks GitHub at most once a day (/api/update,
// off in Settings), and a newer one shows in the version label in the corner and at the top of the About box.
import { VERSION } from './version.js';
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

const INSTALLER = 'https://github.com/codexheroes/co-character-creator/releases/latest/download/CO-Costume-Editor-Setup.exe';
let aboutButton = null, versionLabel = null, newer = null;  // newer: {version, url} of a release newer than this one

// is version a (0.6.10) newer than b (0.6.4)?
function isNewer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function showVersion() {
  if (!versionLabel) return;
  versionLabel.replaceChildren('v' + VERSION);
  versionLabel.classList.toggle('hasUpdate', !!newer);
  aboutButton?.classList.toggle('hasUpdate', !!newer);
  if (aboutButton) aboutButton.title = newer ? `Version ${newer.version} is available. Who made this, thanks, and the legal notice`
    : 'Who made this, thanks, and the legal notice';
  if (!newer) return;
  const link = el('button', 'updateLink', `v${newer.version} is available`); link.type = 'button';
  link.onclick = () => aboutButton?.click();
  versionLabel.append(' · ', link);
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
  newer = rel.version && isNewer(rel.version, VERSION) ? rel : null;
  showVersion();
  return { ...rel, newer: !!newer, current: VERSION };
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

    // a newer version: where to get it, and that updating keeps everything
    const stops = [];
    let update = null;
    if (newer) {
      update = el('div', 'aboutUpdate');
      const get = el('a', null, `Download version ${newer.version}`), notes = el('a', null, "what's new");
      get.href = INSTALLER; notes.href = newer.url || 'https://github.com/codexheroes/co-character-creator/releases/latest';
      for (const a of [get, notes]) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      const line = el('p');
      line.append(el('span', 'aboutSub', 'New version!'), ' ', get, ' (', notes, ').');
      update.append(line, el('p', null, 'Run the installer to update. It keeps your settings and the editor\'s data, so it starts straight away.'));
      stops.push(get, notes);
    }

    const made = el('p');
    made.append('Made by ', el('b', null, '@sadders1'), '. Feel free to hit me up in-game!');
    // bugs and ideas: the project's GitHub issues, as on the website
    const bugs = el('p'), bugLink = el('a', null, 'Open an issue on GitHub.');
    bugLink.href = 'https://github.com/codexheroes/co-character-creator/issues';
    bugLink.target = '_blank'; bugLink.rel = 'noopener noreferrer';
    bugs.append('Found a bug or have an idea? ', bugLink);

    const thanks = el('div', 'aboutThanks');
    const logo = el('img'); logo.src = 'img/adventurers.svg'; logo.alt = 'Adventurers supergroup emblem';
    const link = el('a', null, 'codexheroes.com/co/adventurers');
    link.href = 'https://codexheroes.com/co/adventurers/'; link.target = '_blank'; link.rel = 'noopener noreferrer';
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
    box.append(head, ...(update ? [update] : []), made, bugs, thanks, legal, row);
    back.append(box);
    document.body.append(back);
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
