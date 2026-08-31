// Dashboard: Rahmen, Seitenleiste, Router und die Live-Verbindung.
//
// Eine Seite, ein Zustand, ein WebSocket. Die einzelnen Ansichten liegen in views/ und bekommen
// den Zustand übergeben; neu gezeichnet wird immer die ganze Ansicht – bei dieser Größe ist das
// einfacher zu verstehen als jede feinere Aktualisierung, und schnell genug.

import { api, icon, themeSwitch, escapeHtml, credits, tr, url, lang, safeLink, $, fail, toast } from './ui.js';
import {
  applyPreferences,
  isFavoriteServer,
  rememberRoute,
  startHash,
} from './preferences.js';

// Relativ zur eigenen Adresse: unter /assets/v/<version>/js/app.js kommt so von selbst die Adresse
// mit demselben Fingerabdruck heraus. Siehe assetVersion in server/config.js.
const LOGO = new URL('../img/logo-128.webp', import.meta.url).pathname;

export const state = {
  me: null,
  meta: null,
  stats: null,
  impersonator: null,
  profiles: [],
  accounts: [],
  todos: [], // was der Kunde gerade zu tun hat – berechnet der Server (server/todos.js)
  bots: new Map(), // key "profil:konto" -> Zustand
  lines: new Map(), // key -> Chatzeilen (Ringpuffer)
  route: { name: 'overview', id: null, tab: null },
  onLive: null, // die aktive Ansicht darf sich für Live-Daten anmelden
};

// ---------------------------------------------------------------- Router

const ROUTES = [
  { path: /^$|^\/$/, name: 'overview' },
  { path: /^\/accounts$/, name: 'accounts' },
  { path: /^\/servers$/, name: 'servers' },
  { path: /^\/servers\/(\d+)(?:\/([a-z]+))?$/, name: 'server' },
  { path: /^\/proxies$/, name: 'proxies' },
  { path: /^\/credits$/, name: 'credits' },
  { path: /^\/activity$/, name: 'activity' },
  { path: /^\/tickets(?:\/(\d+))?$/, name: 'tickets' },
  { path: /^\/settings$/, name: 'settings' },
  { path: /^\/admin(?:\/([a-z-]+))?(?:\/(\d+))?$/, name: 'admin' },
];

function parseRoute() {
  const hash = location.hash.replace(/^#/, '').split('?')[0];
  for (const route of ROUTES) {
    const match = route.path.exec(hash);
    if (!match) continue;
    if (route.name === 'server') {
      return { name: 'server', id: Number(match[1]), tab: match[2] || 'connect' };
    }
    if (route.name === 'tickets') return { name: 'tickets', id: match[1] ? Number(match[1]) : null, tab: null };
    if (route.name === 'admin') {
      return { name: 'admin', id: match[2] ? Number(match[2]) : null, tab: match[1] || 'overview' };
    }
    return { name: route.name, id: null, tab: null };
  }
  return { name: 'overview', id: null, tab: null };
}

export function go(hash) {
  location.hash = hash;
}

// ---------------------------------------------------------------- Daten

export async function refresh({ profiles = true, accounts = true, me = true } = {}) {
  const jobs = [];
  if (me) {
    jobs.push(
      api('/me').then((data) => {
        state.me = data.user;
        state.stats = data.stats;
        state.todos = data.todos || [];
        state.impersonator = data.impersonator || null;
      })
    );
  }
  if (profiles) jobs.push(api('/profiles').then((data) => { state.profiles = data.profiles; }));
  if (accounts) jobs.push(api('/accounts').then((data) => { state.accounts = data.accounts; }));
  await Promise.all(jobs);
  for (const profile of state.profiles) {
    for (const member of profile.accounts) {
      state.bots.set(`${profile.id}:${member.account_id}`, member);
    }
  }
}

export const profileById = (id) => state.profiles.find((profile) => profile.id === Number(id));

/** Chatzeilen eines Bots aus dem Zwischenspeicher. */
export function linesOf(key) {
  return state.lines.get(key) || [];
}

function pushLine(key, entry) {
  const list = state.lines.get(key) || [];
  list.push(entry);
  // Wie viel Verlauf ein Platz behält, hängt an seinem Tarif – der Server sagt es im Profil.
  const profileId = Number(key.split(':')[0]);
  const limit = profileById(profileId)?.chat_limit || 200;
  if (list.length > limit) list.splice(0, list.length - limit);
  state.lines.set(key, list);
}

// ---------------------------------------------------------------- Live-Verbindung

let socket = null;
let retry = 0;
let ticketStatsTimer = null;

/**
 * Ticketzähler nie aus einzelnen Push-Nachrichten hochzählen: mehrere Antworten an einem
 * ungelesenen Ticket würden sonst als mehrere Tickets erscheinen. `/me` ist die Quelle für die
 * echten persönlichen und Team-Zähler.
 */
function refreshTicketStats() {
  clearTimeout(ticketStatsTimer);
  ticketStatsTimer = setTimeout(() => {
    api('/me')
      .then((data) => {
        state.stats = data.stats;
        state.todos = data.todos || [];
        drawSide();
      })
      .catch(() => {});
  }, 180);
}

function connect() {
  const address = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`;
  socket = new WebSocket(address);

  socket.addEventListener('open', () => {
    retry = 0;
    setLive(true);
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'hello') {
      for (const bot of message.bots) state.bots.set(bot.key, { ...state.bots.get(bot.key), ...bot });
      state.onLive?.({ type: 'hello' });
      return;
    }
    if (message.type === 'line') {
      pushLine(message.key, message.entry);
      state.onLive?.({ type: 'line', key: message.key, entry: message.entry });
      return;
    }
    if (message.type === 'view') {
      // Anzeigetafel oder Menü eines Bots. Sie hängen am Bot-Zustand, nicht am Chat.
      const bot = state.bots.get(message.key) || {};
      state.bots.set(message.key, {
        ...bot,
        views: { ...(bot.views || {}), [message.kind]: message.view },
      });
      state.onLive?.({ type: 'view', key: message.key, kind: message.kind, view: message.view });
      return;
    }
    if (message.type === 'ticket') {
      // Der Support-Chat läuft live – die Ticket-Ansicht hängt sich hier ein.
      state.onLive?.({ type: 'ticket', event: message.event, message });
      if (message.event !== 'typing') refreshTicketStats();
      return;
    }
    if (message.type === 'state') {
      state.bots.set(message.key, { ...state.bots.get(message.key), ...message.state });
      // Zähler in der Seitenleiste stimmen sonst nicht mehr.
      const [profileId, accountId] = message.key.split(':').map(Number);
      const profile = profileById(profileId);
      const member = profile?.accounts.find((entry) => entry.account_id === accountId);
      if (member) {
        member.state = message.state.state;
        member.online = message.state.online;
        member.detail = message.state.detail;
        member.last_error = message.state.last_error;
        profile.online = profile.accounts.filter((entry) => entry.online).length;
      }
      drawSide();
      state.onLive?.({ type: 'state', key: message.key, state: message.state });
      return;
    }
    if (message.type === 'credits') {
      if (state.me) state.me.credits = message.balance;
      drawSide();
      state.onLive?.({ type: 'credits' });
      return;
    }
    if (message.type === 'suspended') {
      const profile = profileById(message.profile_id);
      if (profile) {
        profile.suspended = true;
        profile.active = false;
      }
      toast(tr('dash.suspended', { name: message.name }), 'bad');
      drawSide();
      state.onLive?.({ type: 'suspended', profile_id: message.profile_id });
    }
  });

  socket.addEventListener('close', () => {
    setLive(false);
    retry += 1;
    setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(retry, 5)));
  });
}

function setLive(online) {
  const node = $('#live-dot');
  if (node) {
    node.style.color = online ? 'var(--ok)' : 'var(--text-2)';
    node.classList.toggle('live', online);
    node.title = online ? tr('dash.live') : tr('dash.offline');
  }
}

// ---------------------------------------------------------------- Seitenleiste
//
// Eine Seitenleiste, die mit dem Panel mitwächst: Serverplätze kommen dazu, der Admin-Bereich hat
// zwanzig Punkte, und jeder Serverplatz bringt noch einmal seine eigenen Reiter mit. Drei Regeln
// halten das zusammen:
//
//  1. **Kopf und Fuß stehen still, nur die Mitte scrollt.** Vorher scrollte die ganze Leiste –
//     wer im Admin-Bereich nach unten ging, hatte weder Marke noch Guthaben noch Abmelden mehr
//     vor sich, und "hoch scrollen" war der einzige Weg zurück.
//  2. **Ein Suchfeld statt immer tieferer Verschachtelung.** Wer weiß, wie sein Serverplatz
//     heißt, tippt drei Buchstaben. Das ist bei dreißig Einträgen schneller als jedes Aufklappen,
//     und es macht Gruppen möglich, die zu sind, ohne etwas zu verstecken.
//  3. **Eine Ebene weniger.** Die Reiter eines Serverplatzes standen in vier beschrifteten
//     Untergruppen, drei Ebenen tief unter der Marke. Jetzt stehen sie flach untereinander, nur
//     durch feine Linien getrennt – die Überschriften dazu stehen ohnehin schon als Reiterleiste
//     über der Ansicht.

/** Die feste Navigation. Zwei Bündel, getrennt durch eine Linie, ohne Überschriften. */
export const NAV_PRIMARY = [
  { hash: '#/', key: 'dash.overview', icon: 'chart' },
  { hash: '#/servers', key: 'dash.servers', icon: 'server' },
  { hash: '#/accounts', key: 'dash.accounts', icon: 'users' },
];

export const NAV_ACCOUNT = [
  { hash: '#/credits', key: 'dash.credits', icon: 'wallet' },
  { hash: '#/activity', key: 'dash.activity', icon: 'bell' },
  { hash: '#/tickets', key: 'dash.tickets', icon: 'ticket' },
  { hash: '#/proxies', key: 'dash.proxies', icon: 'globe' },
  { hash: '#/settings', key: 'dash.settings', icon: 'settings' },
];

function navLabel(item) {
  // Die persönliche Support-Ansicht ist auch für Admins keine Team-Warteschlange. Der Name
  // macht sie neben „Administration → Tickets“ sofort unterscheidbar.
  return item.hash === '#/tickets' && state.me?.role === 'admin' ? tr('dash.myTickets') : tr(item.key);
}

/**
 * Die Punkte des Admin-Bereichs, nach Themen gebündelt.
 *
 * Diese Liste ist die einzige Quelle: die Seitenleiste baut daraus ihre Gruppen, dieser Router
 * seine Ansichten. Was hier nicht steht, gibt es nicht.
 */
export const ADMIN_GROUPS = [
  {
    key: 'work',
    label: 'adm.group.work',
    items: [
      { key: 'overview', label: 'adm.overview', icon: 'chart' },
      { key: 'ops', label: 'adm.ops', icon: 'activity' },
      { key: 'tickets', label: 'adm.allTickets', icon: 'ticket' },
      { key: 'templates', label: 'adm.templates', icon: 'message' },
      { key: 'users', label: 'adm.users', icon: 'users' },
      { key: 'servers', label: 'adm.servers', icon: 'server' },
      { key: 'accounts', label: 'adm.accounts', icon: 'users' },
    ],
  },
  {
    key: 'money',
    label: 'adm.group.money',
    items: [
      { key: 'plans', label: 'adm.plans', icon: 'package' },
      { key: 'addons', label: 'adm.addons', icon: 'layers' },
      { key: 'topups', label: 'adm.topups', icon: 'wallet' },
      { key: 'vouchers', label: 'adm.vouchers', icon: 'ticket' },
      { key: 'ledger', label: 'adm.ledger', icon: 'chart' },
    ],
  },
  {
    key: 'platform',
    label: 'adm.group.platform',
    items: [
      { key: 'settings', label: 'adm.settings', icon: 'settings' },
      { key: 'nodes', label: 'adm.nodes', icon: 'pin' },
      { key: 'proxies', label: 'adm.proxies', icon: 'globe' },
      { key: 'announcements', label: 'adm.announce', icon: 'alert' },
      { key: 'client', label: 'adm.client', icon: 'download' },
    ],
  },
  {
    key: 'logs',
    label: 'adm.group.logs',
    items: [
      { key: 'system', label: 'adm.system', icon: 'cpu' },
      { key: 'security', label: 'adm.security', icon: 'lock' },
      { key: 'mails', label: 'adm.mails', icon: 'mail' },
      { key: 'audit', label: 'adm.audit', icon: 'terminal' },
    ],
  },
];

const SIDE_RAIL_KEY = 'afk-side-collapsed';
const SIDE_SECTION_PREFIX = 'afk-side-section-';
const SIDE_SCROLL_KEY = 'afk-side-scroll';

function storedFlag(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function storeFlag(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* privater Modus: es funktioniert trotzdem, es merkt sich nur nichts */
  }
}

/**
 * Wie weit die Leiste heruntergescrollt ist.
 *
 * Die Leiste wird bei jedem Zustandswechsel eines Bots komplett neu gezeichnet, und beim
 * Seitenwechsel sowieso. Ohne diesen Merker sprang sie dabei jedes Mal an den Anfang – wer im
 * Admin-Bereich unten war, stand nach einem Klick wieder ganz oben. Der Wert liegt in der
 * `sessionStorage`, damit er auch ein echtes Neuladen der Seite übersteht, aber nicht ewig bleibt.
 */
let sideScroll = (() => {
  try {
    return Number(sessionStorage.getItem(SIDE_SCROLL_KEY)) || 0;
  } catch {
    return 0;
  }
})();

function rememberSideScroll(value) {
  sideScroll = Math.max(0, Math.round(value || 0));
  try {
    sessionStorage.setItem(SIDE_SCROLL_KEY, String(sideScroll));
  } catch {
    /* privater Modus: es funktioniert trotzdem, es merkt sich nur nichts */
  }
}

/** Schmale Leiste: nur Symbole. Auf dem Handy gibt es sie nicht, dort ist die Leiste eine Schublade. */
let railMode = storedFlag(SIDE_RAIL_KEY);

/** Was im Suchfeld steht. Überlebt das Neuzeichnen, das bei jedem Zustandswechsel passiert. */
let sideFilter = '';

function sectionOpen(key, fallback = true) {
  // Der aktuelle Bereich ist beim allerersten Besuch geöffnet. Danach zählt ausschließlich die
  // eigene Wahl – sonst würden die vielen Seitenleisten-Updates eingeklappte Gruppen wieder öffnen.
  return storedFlag(`${SIDE_SECTION_PREFIX}${key}`, fallback);
}

function applySideLayout() {
  // Ob die schmale Leiste überhaupt greift, entscheidet allein die Fensterbreite – das steht im
  // CSS. Hier wird nur der Wunsch angeschrieben.
  document.body.classList.toggle('side-rail', railMode);
}

/**
 * Die Reiter eines Serverplatzes. `need` ist die Fähigkeit, die der Client dafür mitbringen muss –
 * fehlt sie (schlanker Client auf dem Gratis-Platz), wird der Reiter gar nicht erst angeboten.
 */
export const TABS = [
  // Verbinden und Chat sind ein Reiter. Getrennt hieß das: starten, wechseln, mitlesen, wechseln,
  // stoppen – und das für jeden Handgriff. Wer einen Bot startet, will sehen, was er sagt.
  { key: 'connect', label: 'tab.connect', group: 'control' },
  { key: 'movement', label: 'tab.movement', group: 'automation', need: 'movement' },
  { key: 'macros', label: 'tab.macros', group: 'automation' },
  { key: 'board', label: 'tab.board', group: 'views', need: 'board' },
  { key: 'menu', label: 'tab.menu', group: 'views', need: 'menu' },
  // Das eigene Inventar liest nur eine Bauform mit Gegenstandslesung – dieselbe Fähigkeit, die
  // auch die Felder eines Menüs füllt. Ohne sie stünde hier ein Raster aus leeren Kästchen.
  { key: 'inventory', label: 'tab.inventory', group: 'views', need: 'items' },
  { key: 'pov', label: 'tab.pov', group: 'views', need: 'pov' },
  { key: 'proxies', label: 'tab.proxies', group: 'manage', need: 'proxy' },
  { key: 'plan', label: 'tab.plan', group: 'manage' },
  { key: 'addons', label: 'ad.title', group: 'manage', paidOnly: true },
  { key: 'settings', label: 'tab.settings', group: 'manage' },
];

export const tabsFor = (profile) =>
  TABS.filter((tab) => {
    if (tab.need && !profile?.caps?.[tab.need]) return false;
    // Zusätze gibt es nur, wo sie etwas bewirken – auf dem Gratis-Platz wäre das ein leerer Reiter.
    if (tab.paidOnly && !profile?.plan?.addons) return false;
    return true;
  });

// ---------------------------------------------------------------- Bausteine

/** Ein Eintrag der Navigation: Symbol, Beschriftung, optional eine Zahl. */
function navItem({ href, label, iconName, active, badge = 0, tone = '' }) {
  return `<a class="side-item ${active ? 'active' : ''} ${tone}" href="${href}"
    title="${escapeHtml(label)}" data-find="${escapeHtml(label.toLowerCase())}"
    ${active ? 'aria-current="page"' : ''}>
    <span class="side-item-icon">${icon(iconName)}</span>
    <span class="side-item-label">${escapeHtml(label)}</span>
    ${badge ? `<span class="side-badge">${badge > 99 ? '99+' : badge}</span>` : ''}
  </a>`;
}

/** Ein Serverplatz in der Liste – Zustandspunkt, Name, wie viele Bots davon laufen. */
function serverItem(profile, active) {
  const tone = profile.suspended ? 'warn' : profile.online ? 'ok' : profile.total ? 'idle' : 'empty';
  const favorite = isFavoriteServer(state.me?.id, profile.id);
  return `<a class="side-item side-server ${active ? 'active' : ''}"
    href="#/servers/${profile.id}/connect" title="${escapeHtml(profile.name)}"
    data-find="${escapeHtml(profile.name.toLowerCase())}">
    <span class="side-item-icon"><span class="side-dot ${tone}"></span></span>
    <span class="side-item-label">${escapeHtml(profile.name)}</span>
    ${favorite ? `<span class="side-favorite" aria-label="${escapeHtml(tr('srv.favorite'))}">${icon('star')}</span>` : ''}
    <span class="side-count">${profile.online}/${profile.total}</span>
  </a>`;
}

/**
 * Die Reiter des offenen Serverplatzes.
 *
 * Flach, nicht in vier beschrifteten Untergruppen: dieselbe Reihenfolge steht als Reiterleiste
 * schon über der Ansicht, und eine zweite Beschriftung derselben Sache in der Seitenleiste ist
 * kein Ordnungsgewinn, sondern ein Ebenengewinn. Die Gruppen bleiben als feine Linie erhalten.
 */
function serverTabs(profile, activeTab) {
  const tabs = tabsFor(profile);
  return `<div class="side-sub">
    ${tabs
      .map((tab, index) => {
        const boundary = index > 0 && tabs[index - 1].group !== tab.group ? ' is-new-group' : '';
        const label = tr(tab.label);
        return `<a class="side-sub-item${boundary}${activeTab === tab.key ? ' active' : ''}"
          href="#/servers/${profile.id}/${tab.key}"
          data-find="${escapeHtml(`${profile.name} ${label}`.toLowerCase())}">${escapeHtml(label)}</a>`;
      })
      .join('')}
  </div>`;
}

/** Eine aufklappbare Gruppe. `key` merkt sich den Zustand im Browser. */
function section({ key, title, iconName, open, headExtra = '', body }) {
  return `<details class="side-section" data-side-section="${key}" ${open ? 'open' : ''}>
    <summary title="${escapeHtml(title)}">
      <span class="side-item-icon">${icon(iconName)}</span>
      <span class="side-item-label">${escapeHtml(title)}</span>
      ${headExtra}
      <span class="side-caret">${icon('arrow')}</span>
    </summary>
    <div class="side-section-body">${body}</div>
  </details>`;
}

/** Die gesamte Administration – eine Gruppe, darin vier Bündel mit kleiner Beschriftung. */
function adminSection() {
  if (state.me?.role !== 'admin') return '';
  const requested = state.route.name === 'admin' ? state.route.tab || 'overview' : null;
  const current = requested === 'bots' ? 'accounts' : requested;
  const waiting = state.stats?.staff_tickets || 0;

  const body = ADMIN_GROUPS.map(
    (group) => `<div class="side-block">
      <span class="side-block-label">${escapeHtml(tr(group.label))}</span>
      ${group.items
        .map((item) =>
          navItem({
            href: `#/admin/${item.key}`,
            label: tr(item.label),
            iconName: item.icon,
            active: current === item.key,
            badge: item.key === 'tickets' ? waiting : 0,
          })
        )
        .join('')}
    </div>`
  ).join('');

  return section({
    key: 'admin',
    title: tr('dash.admin'),
    iconName: 'shield',
    open: sectionOpen('admin', state.route.name === 'admin'),
    headExtra: waiting ? `<span class="side-badge">${waiting > 99 ? '99+' : waiting}</span>` : '',
    body,
  });
}

// ---------------------------------------------------------------- Zeichnen

export function drawSide() {
  applySideLayout();
  const route = state.route;
  const unread = state.stats?.tickets_unread || 0;
  const todoCount = state.todos?.length || 0;
  const side = $('#side');

  // Wer gerade tippt, darf beim Neuzeichnen nicht die Schreibmarke verlieren – und die Leiste
  // wird bei jedem Zustandswechsel eines Bots neu gezeichnet.
  const filterNode = $('#side-filter');
  const hadFocus = document.activeElement === filterNode;
  const caret = filterNode ? filterNode.selectionStart : null;
  // Wo die Leiste gerade steht, bevor sie neu entsteht.
  const scroller = $('#side-scroll');
  if (scroller) rememberSideScroll(scroller.scrollTop);

  const servers = [...state.profiles]
    .sort(
      (a, b) =>
        Number(isFavoriteServer(state.me?.id, b.id)) - Number(isFavoriteServer(state.me?.id, a.id))
    )
    .map((profile) => {
      const active = route.name === 'server' && route.id === profile.id;
      return serverItem(profile, active) + (active ? serverTabs(profile, route.tab) : '');
    })
    .join('');

  side.innerHTML = `
    <div class="side-top">
      <div class="side-brand-row">
        <a class="side-brand" href="/${lang}" title="AFKSystems">
          <img class="side-logo" src="${LOGO}" alt="" width="28" height="28" />
          <span class="side-item-label">AFKSystems</span>
        </a>
        <button class="side-icon-btn side-rail-btn" data-collapse-side type="button"
          aria-label="${escapeHtml(tr(railMode ? 'dash.expandNav' : 'dash.collapseNav'))}"
          title="${escapeHtml(tr(railMode ? 'dash.expandNav' : 'dash.collapseNav'))}">${icon('menu')}</button>
        <button class="side-icon-btn side-close" type="button"
          aria-label="${escapeHtml(tr('common.close'))}">${icon('x')}</button>
      </div>

      <div class="side-find">
        <span class="side-find-icon">${icon('compass')}</span>
        <input id="side-filter" type="search" autocomplete="off" spellcheck="false"
          placeholder="${escapeHtml(tr('dash.search'))}"
          aria-label="${escapeHtml(tr('dash.search'))}" value="${escapeHtml(sideFilter)}" />
        <kbd>/</kbd>
      </div>
    </div>

    <div class="side-scroll" id="side-scroll">
      <nav class="side-block" aria-label="${escapeHtml(tr('dash.group.panel'))}">
        ${NAV_PRIMARY.map((item) =>
          navItem({
            href: item.hash,
            label: navLabel(item),
            iconName: item.icon,
            active: routeMatches(item.hash),
            // Die offenen Aufgaben stehen in der Übersicht. Die Zahl daneben ist der Grund,
            // überhaupt hinzusehen – sonst findet sie nur, wer ohnehin schon dort ist.
            badge: item.hash === '#/' ? todoCount : 0,
          })
        ).join('')}
      </nav>

      ${section({
        key: 'servers',
        title: tr('dash.servers'),
        iconName: 'server',
        open: sectionOpen('servers', true),
        headExtra: `<span class="side-count">${state.profiles.length || ''}</span>`,
        body: `<button class="side-item side-add" id="new-profile" type="button"
            title="${escapeHtml(tr('dash.newServer'))}"
            data-find="${escapeHtml(tr('dash.newServer').toLowerCase())}">
            <span class="side-item-icon">${icon('plus')}</span>
            <span class="side-item-label">${escapeHtml(tr('dash.newServer'))}</span>
          </button>
          ${servers || `<p class="side-empty side-item-label">${escapeHtml(tr('dash.noServers'))}</p>`}`,
      })}

      <nav class="side-block side-block-split" aria-label="${escapeHtml(tr('dash.group.service'))}">
        ${NAV_ACCOUNT.map((item) =>
          navItem({
            href: item.hash,
            label: navLabel(item),
            iconName: item.icon,
            active: routeMatches(item.hash),
            badge:
              item.hash === '#/tickets'
                ? unread
                : item.hash === '#/activity'
                  ? state.stats?.notifications_unread || 0
                  : 0,
          })
        ).join('')}
      </nav>

      ${adminSection()}

      <p class="side-no-hits" hidden>${escapeHtml(tr('dash.noHits'))}</p>
    </div>

    <div class="side-bottom">
      ${
        state.meta?.discord_invite
          ? // Hebt sich ab, solange der Gratis-Platz auf genau diesen Beitritt wartet: dann ist es
            // kein Angebot mehr, sondern der Weg zurück in den Betrieb.
            `<a class="side-item side-discord ${
              state.me?.free_access?.reason === 'discord-join' ? 'is-needed' : ''
            }" href="${escapeHtml(safeLink(state.meta.discord_invite))}"
               target="_blank" rel="noopener" title="${escapeHtml(tr('discord.join'))}">
               <span class="side-item-icon">${icon('discord')}</span>
               <span class="side-item-label">${escapeHtml(tr('discord.join'))}</span></a>`
          : ''
      }
      <a class="side-balance" href="#/credits" title="${escapeHtml(tr('dash.credits'))}">
        <span class="side-item-icon">${icon('wallet')}<span class="dot" id="live-dot"></span></span>
        <span class="side-balance-text">
          <span class="side-balance-value">${credits(state.me?.credits ?? 0)}</span>
          <span class="side-balance-note">${escapeHtml(costLine())}</span>
        </span>
      </a>
      <div class="side-user">
        <a class="side-user-name" href="#/settings" title="${escapeHtml(state.me?.username || '')}">
          <span class="side-avatar">${escapeHtml((state.me?.username || '?').slice(0, 1).toUpperCase())}</span>
          <span class="side-item-label">${escapeHtml(state.me?.username || '')}</span>
        </a>
        ${themeSwitch()}
        <button class="side-icon-btn" id="logout" type="button"
          title="${escapeHtml(tr('dash.logout'))}"
          aria-label="${escapeHtml(tr('dash.logout'))}">${icon('power')}</button>
      </div>
    </div>`;

  $('#new-profile').addEventListener('click', () => import('./views/server.js').then((m) => m.newProfile()));
  side.querySelectorAll('[data-side-section]').forEach((details) => {
    details.addEventListener('toggle', () =>
      storeFlag(`${SIDE_SECTION_PREFIX}${details.dataset.sideSection}`, details.open)
    );
  });
  $('#logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    location.href = url('');
  });

  // Und wieder dorthin, wo sie war. `scrollHeight` ist erst nach dem Einsetzen bekannt, deshalb
  // hier und nicht vorher – und begrenzt, damit eine kürzer gewordene Leiste nicht ins Leere zeigt.
  const fresh = $('#side-scroll');
  if (fresh) {
    fresh.scrollTop = Math.min(sideScroll, Math.max(0, fresh.scrollHeight - fresh.clientHeight));
    fresh.addEventListener('scroll', () => rememberSideScroll(fresh.scrollTop), { passive: true });
  }

  const input = $('#side-filter');
  input.addEventListener('input', () => {
    sideFilter = input.value;
    applyFilter();
  });
  // Escape leert das Feld, statt die Leiste zu schließen – wer sucht, will weitersuchen.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    sideFilter = '';
    input.value = '';
    applyFilter();
  });
  if (hadFocus) {
    input.focus();
    if (caret !== null) input.setSelectionRange(caret, caret);
  }
  applyFilter();

  drawMobileNav();
}

/**
 * Das Suchfeld.
 *
 * Es filtert alles, was einen Namen hat: Navigationspunkte, Serverplätze, deren Reiter und jeden
 * Punkt der Administration. Was nichts trifft, verschwindet; Gruppen ohne Treffer verschwinden
 * mit. Kein Netzverkehr, keine Trefferliste – die Leiste selbst ist das Ergebnis.
 */
function applyFilter() {
  const side = $('#side');
  const needle = sideFilter.trim().toLowerCase();
  side.classList.toggle('is-filtering', Boolean(needle));

  let hits = 0;
  for (const node of side.querySelectorAll('[data-find]')) {
    const match = !needle || node.dataset.find.includes(needle);
    node.hidden = !match;
    if (match) hits += 1;
  }
  // Ein Bündel ohne sichtbaren Eintrag hat nichts mehr zu sagen.
  for (const block of side.querySelectorAll('.side-block, .side-sub, .side-section')) {
    const visible = [...block.querySelectorAll('[data-find]')].some((node) => !node.hidden);
    block.hidden = Boolean(needle) && !visible;
    // Bei einer Suche stehen alle Gruppen offen – sonst läge der Treffer hinter einem Klick.
    if (needle && block.tagName === 'DETAILS' && visible) block.open = true;
  }
  const empty = side.querySelector('.side-no-hits');
  if (empty) empty.hidden = !needle || hits > 0;
}

// ---------------------------------------------------------------- Handy-Leiste
//
// Unten am Bildschirmrand, wo der Daumen ist. Sie zeigt vier Ziele und den Knopf für die
// Seitenleiste – mehr passt nicht nebeneinander, ohne dass die Beschriftungen abbrechen.

const MOBILE_NAV = [
  NAV_PRIMARY[0],
  NAV_PRIMARY[1],
  NAV_PRIMARY[2],
  NAV_ACCOUNT[1],
];
const ADMIN_MOBILE_NAV = [
  { hash: '#/admin/overview', key: 'adm.overview', icon: 'chart' },
  { hash: '#/tickets', key: 'dash.myTickets', icon: 'ticket' },
  { hash: '#/admin/tickets', key: 'adm.allTickets', icon: 'shield', staffBadge: true },
  { hash: '#/admin/users', key: 'adm.users', icon: 'users' },
];

function drawMobileNav() {
  const root = $('#mobile-nav');
  if (!root) return;
  const unread = state.stats?.tickets_unread || 0;
  const waiting = state.stats?.staff_tickets || 0;
  const items = state.me?.role === 'admin' ? ADMIN_MOBILE_NAV : MOBILE_NAV;
  root.innerHTML = `${items
    .map((item) => {
      const badge = item.staffBadge ? waiting : item.hash === '#/tickets' ? unread : 0;
      return `<a href="${item.hash}" ${routeMatches(item.hash) ? 'aria-current="page"' : ''}>
      <span class="mobile-nav-icon">${icon(item.icon)}${badge ? `<i>${badge > 99 ? '99+' : badge}</i>` : ''}</span>
      <span>${escapeHtml(tr(item.hash === '#/accounts' ? 'dash.accountsShort' : item.key))}</span>
    </a>`;
    })
    .join('')}
    <button type="button" data-open-side>
      <span class="mobile-nav-icon">${icon('menu')}</span>
      <span>${escapeHtml(tr('nav.menu'))}</span>
    </button>`;
}

function routeMatches(hash) {
  const name = hash.replace('#/', '') || 'overview';
  if (name.startsWith('admin/')) {
    return state.route.name === 'admin' && state.route.tab === name.slice('admin/'.length);
  }
  if (name === 'servers') return state.route.name === 'servers' || state.route.name === 'server';
  return state.route.name === name;
}

/** Was der Monat kostet – oder dass er nichts kostet. */
function costLine() {
  const cost = state.me?.monthly_cost || 0;
  if (!cost) return tr('dash.balanceFree');
  const paid = state.profiles.filter((profile) => !profile.plan?.free_slot).length;
  return tr('dash.balanceHint', { n: paid, cost: credits(cost) });
}

// Seitenleiste auf dem Handy ein-/ausblenden.
const widePanel = window.matchMedia('(min-width: 1000px)');
let sideTrigger = null;

export function toggleSide(open, trigger = null) {
  const side = $('#side');
  const mobile = !widePanel.matches;
  const visible = mobile && Boolean(open);
  if (trigger) sideTrigger = trigger;
  side.classList.toggle('open', visible);
  side.inert = mobile && !visible;
  side.setAttribute('aria-hidden', String(mobile && !visible));
  $('#side-backdrop').classList.toggle('hide', !visible);
  document.body.classList.toggle('side-open', visible);
  if (visible) requestAnimationFrame(() => side.querySelector('.side-close')?.focus());
  else if (sideTrigger?.isConnected) sideTrigger.focus();
}
$('#side-backdrop').addEventListener('click', () => toggleSide(false));
document.addEventListener('click', (event) => {
  // Der Knopf wird bei jeder Ansicht neu gezeichnet – deshalb hier einmal für alle. Ob er
  // überhaupt zu sehen ist, entscheidet allein die Breite, und das gehört ins CSS: sonst bliebe
  // er nach dem Verkleinern des Fensters verschwunden und die Seitenleiste unerreichbar.
  const opener = event.target.closest('.side-toggle, [data-open-side]');
  const collapse = event.target.closest('[data-collapse-side]');
  if (collapse) {
    // Auf dem Handy ist derselbe Knopf der Öffner der Schublade – dort gibt es keine schmale
    // Leiste, sondern nur "auf" und "zu".
    if (!widePanel.matches) {
      toggleSide(!$('#side').classList.contains('open'), collapse);
      return;
    }
    railMode = !railMode;
    storeFlag(SIDE_RAIL_KEY, railMode);
    drawSide();
  } else if (opener) toggleSide(true, opener);
  else if (event.target.closest('.side-close')) toggleSide(false);
  else if (event.target.closest('.side a')) toggleSide(false);
});
/**
 * Die Sprungmarke aufmachen – Strg+K, oder ⌘K auf dem Mac.
 *
 * Sie kommt erst beim ersten Aufruf über die Leitung: Wer sie nie benutzt, lädt sie auch nicht.
 * Und sie wird **spät** geholt, weil sie ihrerseits aus dieser Datei liest – zwei Module, die sich
 * beim Laden gegenseitig brauchen, sind ein Kreis, zwei die sich beim Aufruf brauchen nicht.
 */
export async function showPalette(initial = '') {
  const palette = await import('./palette.js');
  palette.openPalette(initial);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('#side').classList.contains('open')) return toggleSide(false);
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 'k' || event.key === 'K')) {
    // Strg+K ist im Browser die Adresszeile. Hier ist es die Suche über alles, und das ist an
    // dieser Stelle die naheliegendere Bedeutung: Wer im Panel tippt, sucht im Panel.
    event.preventDefault();
    showPalette();
    return;
  }
  const active = document.activeElement;
  const typing = active && (active.isContentEditable || /^(input|textarea|select)$/i.test(active.tagName));
  if (!typing && event.key === '?') {
    event.preventDefault();
    showShortcuts();
    return;
  }
  if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (event.key.toLowerCase() === 'g') {
      armJumpKeys();
      return;
    }
    if (jumpKeysArmed) {
      const target = { o: '#/', s: '#/servers', a: '#/accounts', t: '#/tickets' }[event.key.toLowerCase()];
      clearJumpKeys();
      if (target) {
        event.preventDefault();
        go(target);
        return;
      }
    }
  }
  // "/" springt ins Suchfeld der Seitenleiste – aber nur, wenn gerade nicht ohnehin getippt wird.
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  if (typing) return;
  const field = $('#side-filter');
  if (!field) return;
  event.preventDefault();
  if (!widePanel.matches) toggleSide(true, active);
  field.focus();
  field.select();
});
widePanel.addEventListener('change', () => toggleSide(false));
toggleSide(false);

let jumpKeysArmed = false;
let jumpKeysTimer = null;
function clearJumpKeys() {
  jumpKeysArmed = false;
  clearTimeout(jumpKeysTimer);
}
function armJumpKeys() {
  jumpKeysArmed = true;
  clearTimeout(jumpKeysTimer);
  jumpKeysTimer = setTimeout(clearJumpKeys, 1200);
}

/** Alle Tastaturwege, in derselben gestalteten Dialogform wie der Rest des Panels. */
export function showShortcuts() {
  if (document.querySelector('dialog.shortcuts')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'shortcuts';
  const row = (keys, text) => `<li><span>${escapeHtml(text)}</span><span class="shortcut-keys">${keys
    .map((key) => `<kbd>${escapeHtml(key)}</kbd>`)
    .join('')}</span></li>`;
  dialog.innerHTML = `
    <header><div class="row">${icon('keyboard')}<h3>${escapeHtml(tr('keys.title'))}</h3></div>
      <button class="btn btn-ghost btn-sm" data-close aria-label="${escapeHtml(tr('common.close'))}">${icon('x')}</button></header>
    <div class="body">
      <ul class="shortcut-list">
        ${row([navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl', 'K'], tr('keys.search'))}
        ${row(['/'], tr('keys.sidebar'))}
        ${row(['G', 'O'], tr('keys.overview'))}
        ${row(['G', 'S'], tr('keys.servers'))}
        ${row(['G', 'A'], tr('keys.accounts'))}
        ${row(['G', 'T'], tr('keys.support'))}
        ${row(['?'], tr('keys.help'))}
      </ul>
    </div>`;
  document.body.append(dialog);
  const close = () => dialog.close();
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-open-palette]')) showPalette();
  if (event.target.closest('[data-show-shortcuts]')) showShortcuts();
});

/** Kopfzeile einer Ansicht – enthält auf dem Handy den Knopf für die Seitenleiste. */
export function appbar(title, actionsHtml = '', subtitle = '') {
  const unread = state.stats?.notifications_unread || 0;
  return `<div class="appbar">
    <div class="row" style="min-width:0">
      <button class="btn btn-ghost btn-sm side-toggle" data-open-side type="button" aria-label="${escapeHtml(
        tr('nav.menu')
      )}">${icon('menu')}</button>
      <div style="min-width:0">
        <h1 class="truncate">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="small muted truncate">${subtitle}</p>` : ''}
      </div>
    </div>
    <div class="row wrap appbar-actions">
      <button class="btn btn-ghost btn-sm appbar-search" data-open-palette type="button"
        title="${escapeHtml(tr('pal.placeholder'))}">${icon('search')}<kbd>${escapeHtml(tr('pal.shortcut'))}</kbd></button>
      <a class="btn btn-ghost btn-sm appbar-bell" href="#/activity"
        aria-label="${escapeHtml(tr('dash.activity'))}" title="${escapeHtml(tr('dash.activity'))}">
        ${icon('bell')}${unread ? `<span>${unread > 99 ? '99+' : unread}</span>` : ''}</a>
      ${actionsHtml}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- Zeichnen

const VIEWS = {
  overview: () => import('./views/overview.js'),
  accounts: () => import('./views/accounts.js'),
  servers: () => import('./views/server.js'),
  server: () => import('./views/server.js'),
  proxies: () => import('./views/proxies.js'),
  credits: () => import('./views/billing.js'),
  activity: () => import('./views/activity.js'),
  tickets: () => import('./views/tickets.js'),
  settings: () => import('./views/settings.js'),
  admin: () => import('./views/admin.js'),
};

let drawing = false;
let redrawWanted = false;
let paintedRoute = '';

function animateRoute(route) {
  const signature = `${route.name}:${route.id || ''}:${route.tab || ''}`;
  if (signature === paintedRoute) return;
  paintedRoute = signature;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $('#main').animate(
    [
      { opacity: 0.15, transform: 'translate3d(16px, 0, 0)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ],
    { duration: 190, easing: 'cubic-bezier(.2,.75,.25,1)' }
  );
}

export async function draw() {
  // Während gezeichnet wird, kommt kein zweiter Durchlauf dazwischen – aber der Wunsch wird
  // gemerkt. Ohne das ging ein Klick verloren, der während des Ladens einer Ansicht kam: die
  // Adresse stand auf der neuen Seite, zu sehen war noch die alte.
  if (drawing) {
    redrawWanted = true;
    return;
  }
  drawing = true;
  state.route = parseRoute();
  rememberRoute(state.me?.id, location.hash || '#/');
  state.onLive = null;
  drawSide();
  try {
    const module = await VIEWS[state.route.name]();
    await module.render($('#main'), state.route);
    animateRoute(state.route);
  } catch (error) {
    $('#main').innerHTML = `<div class="empty"><h3>${escapeHtml(tr('common.error'))}</h3>
      <p>${escapeHtml(error.message)}</p>
      <button class="btn" id="retry-view">${escapeHtml(tr('common.retry'))}</button></div>`;
    $('#retry-view').addEventListener('click', () => location.reload());
  } finally {
    drawing = false;
    banner();
    discordBanner();
    announcements();
    if (redrawWanted) {
      redrawWanted = false;
      draw();
    }
  }
}

/**
 * Ankündigungen des Betreibers, über der Ansicht.
 *
 * Sie standen bisher in der Datenbank und sonst nirgends. Weggeklickt bleiben sie weg – je
 * Ankündigung gemerkt, nicht als "alle aus": eine neue soll wieder auffallen.
 */
function announcements() {
  document.querySelectorAll('.announce').forEach((node) => node.remove());
  const list = state.meta?.announcements || [];
  if (!list.length) return;
  let hidden = [];
  try {
    hidden = JSON.parse(localStorage.getItem('afk-seen-news') || '[]');
  } catch {
    hidden = [];
  }
  const open = list.filter((entry) => !hidden.includes(entry.id));
  if (!open.length) return;

  const main = $('#main');
  const box = document.createElement('div');
  box.className = 'announce stack';
  box.innerHTML = open
    .map(
      (entry) => `<div class="note ${entry.kind === 'info' ? '' : entry.kind}" data-news="${entry.id}">
        ${icon(entry.kind === 'info' ? 'info' : 'alert')}
        <div class="grow">
          <strong>${escapeHtml(entry.title)}</strong>
          ${entry.body ? `<p class="small" style="margin:.35rem 0 0">${escapeHtml(entry.body).replace(/\n/g, '<br>')}</p>` : ''}
          ${
            entry.link
              ? `<p style="margin:.5rem 0 0"><a href="${escapeHtml(safeLink(entry.link))}" target="_blank" rel="noopener">${escapeHtml(
                  // "Mehr dazu", nicht "Alle Funktionen": Der Link einer Ankündigung führt
                  // dorthin, wohin der Betreiber ihn gelegt hat – die Funktionsseite ist das
                  // in aller Regel nicht.
                  tr('common.more')
                )}</a></p>`
              : ''
          }
        </div>
        <button class="btn btn-ghost btn-sm" data-dismiss="${entry.id}"
          aria-label="${escapeHtml(tr('common.close'))}">${icon('x')}</button>
      </div>`
    )
    .join('');
  main.prepend(box);

  box.querySelectorAll('[data-dismiss]').forEach((button) =>
    button.addEventListener('click', () => {
      hidden.push(Number(button.dataset.dismiss));
      // Der lokale Speicher darf fehlen (privater Modus). Gelesen wurde er schon geschützt,
      // geschrieben nicht – und die geworfene Ausnahme nahm den Rest des Klicks mit: die
      // Ankündigung blieb stehen, obwohl jemand gerade auf das Kreuz gedrückt hatte.
      try {
        localStorage.setItem('afk-seen-news', JSON.stringify(hidden.slice(-50)));
      } catch {
        /* dann kommt sie beim nächsten Laden wieder – weggeklickt ist sie trotzdem */
      }
      button.closest('[data-news]').remove();
      if (!box.querySelector('[data-news]')) box.remove();
    })
  );
}

/** Der Streifen ganz oben, wenn ein Administrator dieses Konto gerade nur ansieht. */
function banner() {
  const old = $('#impersonate');
  if (old) old.remove();
  if (!state.impersonator) return;
  const bar = document.createElement('div');
  bar.id = 'impersonate';
  bar.className = 'impersonate';
  bar.innerHTML = `<span>${escapeHtml(
    tr('adm.viewingAs', { user: state.me?.username || '', admin: state.impersonator.username })
  )}</span><button class="btn btn-sm" id="impersonate-back">${escapeHtml(tr('adm.backToAdmin'))}</button>`;
  document.body.prepend(bar);
  $('#impersonate-back').addEventListener('click', async () => {
    try {
      await api('/auth/return', { method: 'POST' });
      location.href = `${url('/app')}#/admin/users`;
    } catch (error) {
      fail(error);
    }
  });
}

/**
 * Der Gratis-Platz hängt an einer Discord-Mitgliedschaft – und das muss man sehen.
 *
 * Bisher stand es an genau einer Stelle: als Eintrag in der To-do-Liste auf der Übersicht. Wer
 * einen Gratis-Platz angelegt hatte und dann auf den Serverplatz ging, sah nur, dass die Bots
 * nicht starten – und suchte den Fehler beim Bot. Die Bedingung ist aber keine Störung, sondern
 * der Preis des Gratis-Tarifs, und der gehört auf jede Seite, solange er nicht erfüllt ist.
 *
 * Deshalb hier ein Streifen über allem, mit dem Einladungslink als Knopf. Er lässt sich **nicht**
 * wegklicken: Was weg ist, kommt nicht wieder, und dann steht der Platz still, ohne dass jemand
 * noch weiß, warum. Er verschwindet von selbst, sobald die Mitgliedschaft bestätigt ist – und
 * genau dann ist er auch nicht mehr nötig.
 *
 * "Konnte gerade nicht bestätigt werden" (`discord-check`) steht bewusst **nicht** darin: Das ist
 * unsere Lücke und nicht die des Kunden, und ein Knopf hilft ihm dabei nicht.
 */
export function discordBanner() {
  document.querySelector('#discord-join')?.remove();
  const access = state.me?.free_access;
  const reason = access?.reason;
  if (reason !== 'discord-link' && reason !== 'discord-join') return;
  // Nur wen es angeht: wer gar keinen Gratis-Platz hat, für den ist das keine Nachricht.
  const hasFree = state.profiles.some((profile) => profile.plan?.free_slot);
  if (!hasFree) return;

  const invite = state.meta?.discord_invite || '';
  const bar = document.createElement('div');
  bar.id = 'discord-join';
  bar.className = 'joinbar';
  bar.innerHTML = `
    <span class="joinbar-icon">${icon('discord')}</span>
    <span class="joinbar-text">
      <strong>${escapeHtml(tr(reason === 'discord-link' ? 'join.linkTitle' : 'join.joinTitle'))}</strong>
      <span class="small">${escapeHtml(tr(reason === 'discord-link' ? 'join.linkText' : 'join.joinText'))}</span>
    </span>
    ${
      reason === 'discord-link'
        ? `<a class="btn btn-sm" href="#/settings">${escapeHtml(tr('join.linkAction'))}</a>`
        : invite
          ? `<a class="btn btn-sm" href="${escapeHtml(safeLink(invite))}" target="_blank" rel="noopener">${escapeHtml(
              tr('discord.join')
            )}</a>`
          : `<a class="btn btn-sm" href="#/settings">${escapeHtml(tr('join.how'))}</a>`
    }`;
  document.body.prepend(bar);
}

window.addEventListener('hashchange', draw);

// ---------------------------------------------------------------- Start
//
// Bewusst ohne `await` auf Modulebene: die Ansichten importieren dieses Modul zurück, und ein
// wartendes Modul würde diesen Import nie freigeben – das Dashboard bliebe stumm beim Laden stehen.

async function boot() {
  try {
    state.meta = await api('/meta');
    await refresh();
    applyPreferences(state.me?.id);
    if (!location.hash) history.replaceState(null, '', startHash(state.me?.id, state.profiles));
    connect();
    await draw();
  } catch (error) {
    if (error.status === 401) {
      location.href = `${url('/login')}?next=${encodeURIComponent(location.pathname + location.hash)}`;
    } else if (error.code === 'email-unverified') {
      location.href = url('/verify');
    } else {
      fail(error);
      $('#main').innerHTML = `<div class="empty"><h3>${escapeHtml(tr('dash.offline'))}</h3>
        <p>${escapeHtml(error.message)}</p></div>`;
    }
  }
}

boot();
