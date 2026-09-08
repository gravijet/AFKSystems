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

import { api, icon, escapeHtml, tr, $, $$, debounce, ok, fail, ensureStrings } from './ui.js';
import { state, go, draw, refresh, showShortcuts, ADMIN_GROUPS, NAV_PRIMARY, NAV_ACCOUNT } from './app.js';
import { isFavoriteServer } from './preferences.js';

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

  const choose = async (index = cursor) => {
    const hit = items[index];
    if (!hit) return;
    close();
    if (hit.action === 'new-server') {
      ensureStrings('server')
        .then(() => import('./views/server.js'))
        .then((module) => module.newProfile())
        .catch(fail);
      return;
    }
    if (hit.action === 'shortcuts') {
      showShortcuts();
      return;
    }
    if (hit.action === 'bot-state') {
      try {
        const result = await api(`/profiles/${hit.profileId}/${hit.stateAction}`, {
          method: 'POST',
          body: { accounts: [hit.accountId] },
        });
        const failed = (result.results || []).find((entry) => !entry.ok);
        if (failed) throw new Error(failed.error);
        await refresh({ accounts: false });
        ok(tr(hit.stateAction === 'start' ? 'ov.started' : 'pal.botStopped', { name: hit.accountName }));
        draw();
      } catch (error) {
        fail(error);
      }
      return;
    }
    go(hit.route);
    draw();
  };

  /**
   * Die eigenen Server und Konten sind längst im Zustand des Panels. Für normale Nutzer ist das
   * der wichtigste Teil der Suche – sie sollen „SMP“ tippen und dort sein, nicht erst eine
   * Administrationsschnittstelle brauchen. Schnellaktionen nehmen außerdem die Wege auf, die
   * sonst mit „Seite öffnen, Knopf suchen“ beginnen.
   */
  const localGroups = () => {
    const needle = input.value.trim().toLowerCase();
    const pageHits = pages()
      .filter((page) => !needle || matches(page, needle))
      .slice(0, needle ? 6 : 8);
    const quick = [
      {
        title: tr('dash.newServer'),
        sub: tr('ov.noServer.text'),
        icon: 'plus',
        action: 'new-server',
        route: '',
      },
      { title: tr('ov.connectAccount'), sub: tr('acc.sub'), icon: 'users', route: '/accounts' },
      { title: tr('bill.topUp'), sub: tr('bill.balance'), icon: 'wallet', route: '/credits' },
      { title: tr('ov.openTicket'), sub: tr('dash.tickets'), icon: 'ticket', route: '/tickets' },
      { title: tr('keys.title'), sub: tr('keys.help'), icon: 'keyboard', action: 'shortcuts', route: '' },
    ].filter((item) => !needle || matches(item, needle));
    // Die Palette darf nur Aktionen zeigen, die jetzt tatsächlich zulässig sind. Ein gesperrter
    // oder pausierter Platz bekommt keinen irreführenden Startknopf; der Weg dorthin bleibt als
    // Server-Treffer sichtbar, damit die Ursache überprüft werden kann.
    const botActions = [];
    for (const profile of state.profiles) {
      const canStart = profile.active && !profile.locked && !profile.suspended &&
        !(profile.plan?.free_slot && profile.free_access?.ok === false);
      for (const member of profile.accounts) {
        const bot = state.bots.get(`${profile.id}:${member.account_id}`) || member;
        const running = Boolean(bot.state) && bot.state !== 'offline';
        if (running) {
          botActions.push({
            title: tr('pal.stopBot', { name: member.name }),
            sub: profile.name,
            icon: 'stop',
            action: 'bot-state',
            stateAction: 'stop',
            profileId: profile.id,
            accountId: member.account_id,
            accountName: member.name,
            route: '',
          });
        } else if (canStart) {
          botActions.push({
            title: tr('pal.startBot', { name: member.name }),
            sub: profile.name,
            icon: 'play',
            action: 'bot-state',
            stateAction: 'start',
            profileId: profile.id,
            accountId: member.account_id,
            accountName: member.name,
            route: '',
          });
        }
      }
    }
    const matchingBotActions = botActions
      .filter((item) => !needle || matches(item, needle))
      .slice(0, needle ? 8 : 4);
    const serverHits = [...state.profiles]
      .sort(
        (a, b) =>
          Number(isFavoriteServer(state.me?.id, b.id)) - Number(isFavoriteServer(state.me?.id, a.id)) ||
          Number(b.online > 0) - Number(a.online > 0)
      )
      .filter((profile) =>
        !needle || `${profile.name} ${profile.address} ${profile.plan?.name || ''}`.toLowerCase().includes(needle)
      )
      .slice(0, needle ? 8 : 4)
      .map((profile) => ({
        title: profile.name,
        sub: `${profile.address} · ${profile.online}/${profile.total}`,
        icon: 'server',
        route: `/servers/${profile.id}/connect`,
        tags: isFavoriteServer(state.me?.id, profile.id) ? [tr('srv.favorite')] : [],
      }));
    const accountHits = state.accounts
      .filter((account) => !needle || `${account.name} ${account.kind}`.toLowerCase().includes(needle))
      .slice(0, needle ? 6 : 3)
      .map((account) => ({
        title: account.name,
        sub: tr(account.kind === 'offline' ? 'acc.kind.offline' : 'acc.kind.microsoft'),
        icon: 'user',
        route: '/accounts',
        tags: account.status === 'error' ? [tr('acc.error')] : [],
      }));
    return [
      quick.length && { label: tr('pal.quick'), hits: quick.slice(0, needle ? 5 : 3) },
      matchingBotActions.length && { label: tr('pal.botActions'), hits: matchingBotActions },
      serverHits.length && { label: tr('pal.servers'), hits: serverHits },
      accountHits.length && { label: tr('pal.accounts'), hits: accountHits },
      pageHits.length && { label: tr('pal.pages'), hits: pageHits },
    ].filter(Boolean);
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
