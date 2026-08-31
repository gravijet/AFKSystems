// Die Sprungmarke: ein Feld, das alles findet und überall hinführt.
//
// Ein Panel wächst, und mit ihm die Seitenleiste. Irgendwann ist der schnellste Weg zu einem
// Nutzer nicht mehr „Nutzer öffnen, suchen, klicken“, sondern eintippen, was man weiß. Genau das
// ist hier: Strg+K (oder ⌘K), ein paar Zeichen, Enter.
//
// Zwei Sorten Treffer stehen darin, und sie kommen aus zwei verschiedenen Welten:
//
//   * **Seiten** kennt der Browser selbst – sie stehen ohnehin schon in der Seitenleiste. Danach
//     wird örtlich gefiltert, ohne den Server zu fragen: Wer „tarife“ tippt, soll nicht auf eine
//     Netzwerkantwort warten, um zu einer Seite zu kommen, die er längst sieht.
//   * **Sachen** – Nutzer, Serverplätze, Accounts, Tickets, Gutscheine, Standorte, Aufladungen –
//     weiß nur die Datenbank. Die holt /api/admin/search, und zwar erst ab zwei Zeichen und mit
//     einer Verzögerung: Jeder Tastendruck eine Abfrage wäre für den Server dieselbe Arbeit wie
//     ein Dutzend Betreiber gleichzeitig.
//
// Wohin ein Treffer führt, sagt der Server (`route`) und nicht diese Datei. Sonst stünde die
// Adressbildung an zwei Stellen – und zwei Stellen laufen auseinander, sobald eine sich ändert.
//
// Für Nicht-Administratoren bleibt die Palette nützlich, aber ruhig: Sie zeigt dann nur die
// eigenen Seiten. Die Suche ist eine Admin-Schnittstelle und wird gar nicht erst gefragt.

import { api, icon, escapeHtml, tr, $, $$, debounce } from './ui.js';
import { state, go, draw, ADMIN_GROUPS, NAV_PRIMARY, NAV_ACCOUNT } from './app.js';

/** Alle Seiten, die dieser Benutzer aufrufen darf – in der Reihenfolge der Seitenleiste. */
function pages() {
  const list = [...NAV_PRIMARY, ...NAV_ACCOUNT].map((item) => ({
    title: tr(item.hash === '#/tickets' && state.me?.role === 'admin' ? 'dash.myTickets' : item.key),
    sub: '',
    icon: item.icon,
    route: item.hash.slice(1) || '/',
  }));
  if (state.me?.role !== 'admin') return list;
  for (const group of ADMIN_GROUPS) {
    for (const item of group.items) {
      list.push({
        title: tr(item.label),
        sub: tr(group.label),
        icon: item.icon,
        route: `/admin/${item.key}`,
      });
    }
  }
  return list;
}

/**
 * Passt eine Seite zur Eingabe?
 *
 * Absichtlich schlicht: Teilzeichenkette, ohne Groß- und Kleinschreibung, über Name und Gruppe.
 * Eine unscharfe Suche („trf“ findet „Tarife“) sähe klug aus, findet aber auch dauernd etwas
 * anderes als das Gemeinte – und bei zwanzig Seiten gibt es nichts zu erraten.
 */
const matches = (page, needle) =>
  `${page.title} ${page.sub} ${page.route}`.toLowerCase().includes(needle);

/** Ein Sinnbild je Art von Treffer – dieselben, die die Seitenleiste für dieselbe Sache benutzt. */
const KIND_ICONS = {
  users: 'users',
  servers: 'server',
  accounts: 'user',
  tickets: 'ticket',
  vouchers: 'ticket',
  nodes: 'pin',
  topups: 'wallet',
};

let open = false;

export function paletteOpen() {
  return open;
}

export async function openPalette(initial = '') {
  if (open) return;
  open = true;

  const dialog = document.createElement('dialog');
  dialog.className = 'palette';
  dialog.innerHTML = `
    <div class="palette-head">
      ${icon('search')}
      <input id="palette-input" type="search" autocomplete="off" spellcheck="false"
        placeholder="${escapeHtml(tr('pal.placeholder'))}" aria-label="${escapeHtml(tr('pal.placeholder'))}"
        value="${escapeHtml(initial)}">
      <kbd>esc</kbd>
    </div>
    <div class="palette-body" id="palette-body" role="listbox" aria-label="${escapeHtml(tr('pal.title'))}"></div>
    <div class="palette-foot small muted">
      <span><kbd>↑</kbd><kbd>↓</kbd> ${escapeHtml(tr('pal.move'))}</span>
      <span><kbd>↵</kbd> ${escapeHtml(tr('pal.go'))}</span>
      ${state.me?.role === 'admin' ? `<span>${escapeHtml(tr('pal.hint'))}</span>` : ''}
    </div>`;
  document.body.append(dialog);

  const body = $('#palette-body', dialog);
  const input = $('#palette-input', dialog);
  let items = []; // die flache Liste der Treffer – die Auswahl zeigt hier hinein
  let cursor = 0;

  const paint = (groups) => {
    items = groups.flatMap((group) => group.hits);
    if (cursor >= items.length) cursor = 0;
    if (!items.length) {
      body.innerHTML = `<p class="palette-empty small muted">${escapeHtml(
        input.value.trim() ? tr('pal.empty') : tr('pal.start')
      )}</p>`;
      return;
    }
    let index = -1;
    body.innerHTML = groups
      .map(
        (group) => `<div class="palette-group">
          <span class="palette-label">${escapeHtml(group.label)}</span>
          ${group.hits
            .map((hit) => {
              index++;
              return `<button type="button" class="palette-hit" role="option" data-index="${index}"
                aria-selected="${index === cursor}">
                <span class="palette-icon">${icon(hit.icon || KIND_ICONS[group.kind] || 'compass')}</span>
                <span class="palette-text">
                  <span class="palette-title">${escapeHtml(hit.title)}</span>
                  ${hit.sub ? `<span class="palette-sub small muted">${escapeHtml(hit.sub)}</span>` : ''}
                </span>
                ${(hit.tags || [])
                  .map((tag) => `<span class="pill missing">${escapeHtml(tag)}</span>`)
                  .join('')}
                ${hit.value ? `<span class="palette-value mono small">${escapeHtml(hit.value)}</span>` : ''}
              </button>`;
            })
            .join('')}
        </div>`
      )
      .join('');
    scrollIntoView();
  };

  const scrollIntoView = () => {
    const node = $(`.palette-hit[data-index="${cursor}"]`, body);
    node?.scrollIntoView({ block: 'nearest' });
  };

  const mark = () => {
    for (const node of $$('.palette-hit', body)) {
      node.setAttribute('aria-selected', String(Number(node.dataset.index) === cursor));
    }
    scrollIntoView();
  };

  const close = () => dialog.close();

  const choose = (index = cursor) => {
    const hit = items[index];
    if (!hit) return;
    close();
    go(hit.route);
    draw();
  };

  /** Die Seiten stehen immer schon da; die Sachen kommen nach, wenn der Server geantwortet hat. */
  const localGroups = () => {
    const needle = input.value.trim().toLowerCase();
    const hits = pages()
      .filter((page) => !needle || matches(page, needle))
      .slice(0, needle ? 6 : 8);
    return hits.length ? [{ label: tr('pal.pages'), hits }] : [];
  };

  let generation = 0;
  const search = debounce(async () => {
    const needle = input.value.trim();
    const mine = ++generation;
    if (state.me?.role !== 'admin' || needle.length < 2) return;
    let answer;
    try {
      answer = await api(`/admin/search?q=${encodeURIComponent(needle)}`);
    } catch {
      // Eine gescheiterte Suche ist kein Grund, die Palette zu leeren: Die Seiten stehen weiter
      // da, und wer eigentlich nur springen wollte, merkt vom Ausfall nichts.
      return;
    }
    // Zwischenzeitlich weitergetippt? Dann gehört diese Antwort zu einer Frage von gestern.
    if (mine !== generation || !open) return;
    paint([...localGroups(), ...answer.groups]);
  }, 220);

  input.addEventListener('input', () => {
    cursor = 0;
    paint(localGroups());
    search();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      cursor = items.length ? (cursor + 1) % items.length : 0;
      mark();
    } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      cursor = items.length ? (cursor - 1 + items.length) % items.length : 0;
      mark();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose();
    }
  });

  body.addEventListener('click', (event) => {
    const hit = event.target.closest('.palette-hit');
    if (hit) choose(Number(hit.dataset.index));
  });

  // Ein Klick neben den Inhalt schließt – bei <dialog> trifft das Ereignis das Element selbst.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  dialog.addEventListener('close', () => {
    open = false;
    dialog.remove();
  });

  paint(localGroups());
  dialog.showModal();
  input.focus();
  input.select();
  if (initial) search();
}
