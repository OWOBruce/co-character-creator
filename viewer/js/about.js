// About: who made the editor, thanks, and the legal notice. A centred dialog over a darkened page.
import { VERSION } from './version.js';
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

export function setupAbout(button) {
  button.onclick = () => {
    document.querySelector('.aboutBackdrop')?.remove();
    const back = el('div', 'modalBackdrop aboutBackdrop'), box = el('div', 'palette aboutDialog');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'aboutHead');
    const head = el('div', 'phead', 'CO Costume Editor ' + VERSION); head.id = 'aboutHead';

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
    box.append(head, made, bugs, thanks, legal, row);
    back.append(box);
    document.body.append(back);
    const done = () => { back.remove(); button.focus(); };
    close.onclick = done;
    back.addEventListener('mousedown', e => { if (e.target === back) done(); });  // click outside closes
    back.addEventListener('keydown', e => {
      if (e.key === 'Escape') done();
      else if (e.key === 'Tab') {  // keep focus in the dialog: its links, then Close
        e.preventDefault();
        const stops = [bugLink, link, close], i = stops.indexOf(document.activeElement);
        stops[(i + (e.shiftKey ? stops.length - 1 : 1)) % stops.length].focus();
      }
    });
    close.focus();
  };
}
