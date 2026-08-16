// Dashboard: Rahmen, Seitenleiste, Router und die Live-Verbindung.
//
// Eine Seite, ein Zustand, ein WebSocket. Die einzelnen Ansichten liegen in views/ und bekommen
// den Zustand übergeben; neu gezeichnet wird immer die ganze Ansicht – bei dieser Größe ist das
// einfacher zu verstehen als jede feinere Aktualisierung, und schnell genug.

import { api, icon, themeSwitch, escapeHtml, credits, tr, url, lang, $, fail, toast } from './ui.js';

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
      if (message.event === 'message' && state.route.name !== 'tickets' && state.stats) {
        state.stats.tickets_unread = (state.stats.tickets_unread || 0) + 1;
        drawSide();
      }
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

const NAV = [
  { hash: '#/', key: 'dash.overview', icon: 'chart' },
  { hash: '#/accounts', key: 'dash.accounts', icon: 'users' },
  { hash: '#/proxies', key: 'dash.proxies', icon: 'globe' },
  { hash: '#/credits', key: 'dash.credits', icon: 'wallet' },
  { hash: '#/tickets', key: 'dash.tickets', icon: 'ticket' },
  { hash: '#/settings', key: 'dash.settings', icon: 'settings' },
];

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
      { key: 'tickets', label: 'adm.tickets', icon: 'ticket' },
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
      { key: 'mails', label: 'adm.mails', icon: 'mail' },
      { key: 'audit', label: 'adm.audit', icon: 'terminal' },
    ],
  },
];

const SIDE_COLLAPSED_KEY = 'afk-side-collapsed';
const SIDE_SECTION_PREFIX = 'afk-side-section-';

function storedFlag(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

let sideCollapsed = storedFlag(SIDE_COLLAPSED_KEY);

function sectionOpen(key, fallback = true) {
  // Der aktuelle Bereich ist beim allerersten Besuch geöffnet. Danach zählt ausschließlich die
  // eigene Wahl – sonst würden die vielen Seitenleisten-Updates eingeklappte Gruppen wieder öffnen.
  return storedFlag(`${SIDE_SECTION_PREFIX}${key}`, fallback);
}

function applySideLayout() {
  document.body.classList.toggle('side-collapsed', sideCollapsed);
}

/**
 * Die Reiter eines Serverplatzes. `need` ist die Fähigkeit, die der Client dafür mitbringen muss –
 * fehlt sie (schlanker Client auf dem Gratis-Platz), wird der Reiter gar nicht erst angeboten.
 */
export const TABS = [
  // Verbinden und Chat sind ein Reiter. Getrennt hieß das: starten, wechseln, mitlesen, wechseln,
  // stoppen – und das für jeden Handgriff. Wer einen Bot startet, will sehen, was er sagt.
  { key: 'connect', label: 'tab.connect' },
  { key: 'movement', label: 'tab.movement', need: 'movement' },
  { key: 'board', label: 'tab.board', need: 'board' },
  { key: 'menu', label: 'tab.menu', need: 'menu' },
  { key: 'macros', label: 'tab.macros' },
  { key: 'proxies', label: 'tab.proxies', need: 'proxy' },
  { key: 'plan', label: 'tab.plan' },
  { key: 'addons', label: 'ad.title', paidOnly: true },
  { key: 'settings', label: 'tab.settings' },
];

export const tabsFor = (profile) =>
  TABS.filter((tab) => {
    if (tab.need && !profile?.caps?.[tab.need]) return false;
    // Zusätze gibt es nur, wo sie etwas bewirken – auf dem Gratis-Platz wäre das ein leerer Reiter.
    if (tab.paidOnly && !profile?.plan?.addons) return false;
    return true;
  });

export function drawSide() {
  applySideLayout();
  const route = state.route;
  const profiles = state.profiles
    .map((profile) => {
      const active = route.name === 'server' && route.id === profile.id;
      const color = profile.suspended
        ? 'var(--warn)'
        : profile.online
          ? 'var(--ok)'
          : profile.total
            ? 'var(--text-2)'
            : 'var(--line)';
      return `<a class="profile-link ${active ? 'active' : ''}" href="#/servers/${profile.id}/connect"
          title="${escapeHtml(profile.name)}">
        <span class="dot ${profile.online ? 'live' : ''}" style="color:${color}"></span>
        <span class="grow truncate">${escapeHtml(profile.name)}</span>
        <span class="count muted">${profile.online}/${profile.total}</span>
      </a>${
        active
          ? `<div class="subtabs">
              <span class="side-subtabs-label">${escapeHtml(tr('dash.serverAreas'))}</span>
              ${tabsFor(profile)
                .map(
                  (tab) =>
                    `<a class="profile-link ${route.tab === tab.key ? 'active' : ''}"
                        href="#/servers/${profile.id}/${tab.key}">${escapeHtml(tr(tab.label))}</a>`
                )
                .join('')}
            </div>`
          : ''
      }`;
    })
    .join('');

  const unread = state.stats?.tickets_unread || 0;

  $('#side').innerHTML = `
    <div class="side-head">
      <a class="brand" href="/${lang}">
        <img class="logo" src="${LOGO}" alt="" /><span>AFKSystems</span>
      </a>
      <button class="btn btn-ghost side-collapse" data-collapse-side type="button"
        aria-label="${escapeHtml(tr(sideCollapsed ? 'dash.expandNav' : 'dash.collapseNav'))}"
        title="${escapeHtml(tr(sideCollapsed ? 'dash.expandNav' : 'dash.collapseNav'))}">${icon('arrow')}</button>
      <button class="btn btn-ghost side-close" type="button" aria-label="${escapeHtml(
        tr('common.close')
      )}">${icon('x')}</button>
    </div>

    <nav class="nav side-primary" aria-label="${escapeHtml(tr('dash.overview'))}">
      ${NAV.map(
        (item) =>
          `<a class="${routeMatches(item.hash) ? 'active' : ''}" href="${item.hash}"
              title="${escapeHtml(tr(item.key))}">${icon(item.icon)}<span class="grow truncate">${escapeHtml(
                tr(item.key)
              )}</span>${item.hash === '#/tickets' && unread ? `<span class="count primary">${unread}</span>` : ''}</a>`
      ).join('')}
    </nav>

    <details class="side-section side-servers" data-side-section="servers" ${
      sectionOpen('servers', route.name === 'server') ? 'open' : ''
    }>
      <summary title="${escapeHtml(tr('dash.servers'))}">
        <span class="side-section-title">${icon('server')}<span>${escapeHtml(tr('dash.servers'))}</span></span>
        ${icon('arrow', 'icon side-section-arrow')}
      </summary>
      <div class="side-section-content stack" style="gap:.25rem">
        <button class="btn btn-ghost side-add" id="new-profile" title="${escapeHtml(tr('dash.newServer'))}">
          ${icon('plus')}<span>${escapeHtml(tr('dash.newServer'))}</span>
        </button>
        ${profiles || `<p class="small muted side-empty">${escapeHtml(tr('dash.noServers'))}</p>`}
      </div>
    </details>

    ${adminSection()}

    <div class="foot stack" style="gap:.6rem">
      ${
        state.meta?.discord_invite
          ? `<a class="side-discord" href="${escapeHtml(state.meta.discord_invite)}"
               target="_blank" rel="noopener">${icon('discord')}${escapeHtml(tr('discord.join'))}</a>`
          : ''
      }
      <a class="card tight" href="#/credits" style="display:block">
        <div class="row spread">
          <span class="small muted">${escapeHtml(tr('dash.credits'))}</span>
          <span class="dot" id="live-dot" style="color:var(--text-2)"></span>
        </div>
        <div class="mono strong" style="font-size:1.05rem">${credits(state.me?.credits ?? 0)}</div>
        <div class="small muted">${escapeHtml(costLine())}</div>
      </a>
      <div class="row spread">
        <a class="row small grow" href="#/settings" style="gap:.5rem">
          ${icon('user')}<span class="truncate">${escapeHtml(state.me?.username || '')}</span>
        </a>
        ${themeSwitch()}
      </div>
      <button class="btn btn-ghost btn-sm" id="logout">${escapeHtml(tr('dash.logout'))}</button>
    </div>`;

  $('#new-profile').addEventListener('click', () => import('./views/server.js').then((m) => m.newProfile()));
  $('#side').querySelectorAll('[data-side-section]').forEach((details) => {
    details.addEventListener('toggle', () => {
      try {
        localStorage.setItem(`${SIDE_SECTION_PREFIX}${details.dataset.sideSection}`, String(details.open));
      } catch {
        /* privater Modus: der Abschnitt funktioniert trotzdem */
      }
    });
  });
  $('#logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    location.href = url('');
  });
  drawMobileNav();
}

const MOBILE_NAV = [
  NAV[0],
  { hash: '#/servers', key: 'dash.servers', icon: 'server' },
  NAV[1],
  NAV[4],
];
const ADMIN_MOBILE_NAV = [
  { hash: '#/admin/overview', key: 'adm.overview', icon: 'chart' },
  { hash: '#/admin/tickets', key: 'adm.tickets', icon: 'ticket', staffBadge: true },
  { hash: '#/admin/users', key: 'adm.users', icon: 'users' },
  { hash: '#/admin/servers', key: 'adm.servers', icon: 'server' },
];

function drawMobileNav() {
  const root = $('#mobile-nav');
  if (!root) return;
  const unread = state.stats?.tickets_unread || 0;
  const waiting = state.stats?.staff_tickets || 0;
  const items = state.me?.role === 'admin' ? ADMIN_MOBILE_NAV : MOBILE_NAV;
  root.innerHTML = `${items.map((item) => {
    const badge = item.staffBadge ? waiting : item.hash === '#/tickets' ? unread : 0;
    return `<a href="${item.hash}" ${routeMatches(item.hash) ? 'aria-current="page"' : ''}>
      <span class="mobile-nav-icon">${icon(item.icon)}${badge ? `<i>${badge > 99 ? '99+' : badge}</i>` : ''}</span>
      <span>${escapeHtml(tr(item.hash === '#/accounts' ? 'dash.accountsShort' : item.key))}</span>
    </a>`;
  }).join('')}
    <button type="button" data-open-side>
      <span class="mobile-nav-icon">${icon('menu')}</span>
      <span>${escapeHtml(tr('nav.menu'))}</span>
    </button>`;
}

function adminLink(item, current, waiting) {
  return `<a class="${current === item.key ? 'active' : ''} ${
    item.key === 'tickets' ? 'admin-ticket-link' : ''
  }" href="#/admin/${item.key}" title="${escapeHtml(tr(item.label))}">${icon(item.icon)}
    <span class="grow truncate">${escapeHtml(tr(item.label))}</span>
    ${item.key === 'tickets' && waiting ? `<span class="count primary">${waiting}</span>` : ''}</a>`;
}

/** Die gesamte Administration steht gebündelt unter den normalen Panel- und Serverbereichen. */
function adminSection() {
  if (state.me?.role !== 'admin') return '';
  const requested = state.route.name === 'admin' ? state.route.tab || 'overview' : null;
  const current = requested === 'bots' ? 'accounts' : requested;
  const waiting = state.stats?.staff_tickets || 0;

  return `<details class="side-section admin-nav admin-tools" data-side-section="admin" ${
    sectionOpen('admin', state.route.name === 'admin') ? 'open' : ''
  }>
    <summary title="${escapeHtml(tr('dash.admin'))}">
      <span class="side-section-title">${icon('shield')}<span>${escapeHtml(tr('dash.admin'))}</span></span>
      ${icon('arrow', 'icon side-section-arrow')}
    </summary>
    <div class="side-section-content admin-groups">
    ${ADMIN_GROUPS.map((group) => {
      const active = group.items.some((item) => item.key === current);
      return `<details class="admin-group" data-side-section="admin-${group.key}" ${
        sectionOpen(`admin-${group.key}`, active) ? 'open' : ''
      }>
        <summary>
          <span>${escapeHtml(tr(group.label))}</span>${icon('arrow', 'icon side-section-arrow')}
        </summary>
        <nav class="nav">${group.items.map((item) => adminLink(item, current, waiting)).join('')}</nav>
      </details>`;
    }).join('')}
    </div>
  </details>`;
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
    sideCollapsed = !sideCollapsed;
    try {
      localStorage.setItem(SIDE_COLLAPSED_KEY, String(sideCollapsed));
    } catch {
      /* siehe gespeicherte Abschnitte */
    }
    drawSide();
  } else if (opener) toggleSide(true, opener);
  else if (event.target.closest('.side-close')) toggleSide(false);
  else if (event.target.closest('.side a')) toggleSide(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('#side').classList.contains('open')) toggleSide(false);
});
widePanel.addEventListener('change', () => toggleSide(false));
toggleSide(false);

/** Kopfzeile einer Ansicht – enthält auf dem Handy den Knopf für die Seitenleiste. */
export function appbar(title, actionsHtml = '', subtitle = '') {
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
    <div class="row wrap appbar-actions">${actionsHtml}</div>
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
              ? `<p style="margin:.5rem 0 0"><a href="${escapeHtml(entry.link)}" target="_blank" rel="noopener">${escapeHtml(
                  tr('home.what.link')
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
      localStorage.setItem('afk-seen-news', JSON.stringify(hidden.slice(-50)));
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

window.addEventListener('hashchange', draw);

// ---------------------------------------------------------------- Start
//
// Bewusst ohne `await` auf Modulebene: die Ansichten importieren dieses Modul zurück, und ein
// wartendes Modul würde diesen Import nie freigeben – das Dashboard bliebe stumm beim Laden stehen.

async function boot() {
  try {
    state.meta = await api('/meta');
    await refresh();
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
