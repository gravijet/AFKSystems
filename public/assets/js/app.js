// Dashboard: Rahmen, Seitenleiste, Router und die Live-Verbindung.
//
// Eine Seite, ein Zustand, ein WebSocket. Die einzelnen Ansichten liegen in views/ und bekommen
// den Zustand übergeben; neu gezeichnet wird immer die ganze Ansicht – bei dieser Größe ist das
// einfacher zu verstehen als jede feinere Aktualisierung, und schnell genug.

import { api, icon, themeSwitch, escapeHtml, credits, tr, url, lang, $, fail, toast } from './ui.js';

// Relativ zur eigenen Adresse: unter /assets/v/<version>/js/app.js kommt so von selbst die Adresse
// mit demselben Fingerabdruck heraus. Siehe assetVersion in server/config.js.
const LOGO = new URL('../img/logo.svg', import.meta.url).pathname;

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
  { hash: '#/servers', key: 'dash.servers', icon: 'server' },
  { hash: '#/accounts', key: 'dash.accounts', icon: 'users' },
  { hash: '#/proxies', key: 'dash.proxies', icon: 'globe' },
  { hash: '#/credits', key: 'dash.credits', icon: 'wallet' },
  { hash: '#/tickets', key: 'dash.tickets', icon: 'ticket' },
  { hash: '#/settings', key: 'dash.settings', icon: 'settings' },
];

/**
 * Die Reiter eines Serverplatzes. `need` ist die Fähigkeit, die der Client dafür mitbringen muss –
 * fehlt sie (schlanker Client auf dem Gratis-Platz), wird der Reiter gar nicht erst angeboten.
 */
export const TABS = [
  { key: 'connect', label: 'tab.connect' },
  { key: 'chat', label: 'tab.chat' },
  { key: 'movement', label: 'tab.movement', need: 'movement' },
  { key: 'board', label: 'tab.board', need: 'board' },
  { key: 'menu', label: 'tab.menu', need: 'menu' },
  { key: 'macros', label: 'tab.macros' },
  { key: 'proxies', label: 'tab.proxies', need: 'proxy' },
  { key: 'plan', label: 'tab.plan' },
  { key: 'settings', label: 'tab.settings' },
];

export const tabsFor = (profile) => TABS.filter((tab) => !tab.need || profile?.caps?.[tab.need]);

export function drawSide() {
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
      return `<a class="profile-link ${active ? 'active' : ''}" href="#/servers/${profile.id}/connect">
        <span class="dot ${profile.online ? 'live' : ''}" style="color:${color}"></span>
        <span class="grow truncate">${escapeHtml(profile.name)}</span>
        <span class="count muted">${profile.online}/${profile.total}</span>
      </a>${
        active
          ? `<div class="subtabs">
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
  const staffTickets = state.stats?.staff_tickets || 0;

  $('#side').innerHTML = `
    <a class="brand" href="/${lang}" style="padding:.35rem .65rem">
      <img class="logo" src="${LOGO}" alt="" />AFKSystems
    </a>

    <nav class="nav">
      ${NAV.map(
        (item) =>
          `<a class="${routeMatches(item.hash) ? 'active' : ''}" href="${item.hash}">${icon(item.icon)}${escapeHtml(
            tr(item.key)
          )}${item.hash === '#/tickets' && unread ? `<span class="count primary">${unread}</span>` : ''}</a>`
      ).join('')}
      ${
        state.me?.role === 'admin'
          ? `<a class="${state.route.name === 'admin' ? 'active' : ''}" href="#/admin">${icon('shield')}${escapeHtml(
              tr('dash.admin')
            )}${staffTickets ? `<span class="count primary">${staffTickets}</span>` : ''}</a>`
          : ''
      }
    </nav>

    <div class="stack" style="gap:.25rem">
      <div class="row spread">
        <span class="label">${escapeHtml(tr('dash.servers'))}</span>
        <button class="btn btn-ghost btn-sm" id="new-profile" title="${escapeHtml(tr('dash.newServer'))}">${icon('plus')}</button>
      </div>
      ${profiles || `<p class="small muted" style="padding:.35rem .65rem">${escapeHtml(tr('dash.noServers'))}</p>`}
    </div>

    <div class="foot stack" style="gap:.6rem">
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
  $('#logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    location.href = url('');
  });
}

function routeMatches(hash) {
  const name = hash.replace('#/', '') || 'overview';
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
export function toggleSide(open) {
  $('#side').classList.toggle('open', open);
  $('#side-backdrop').classList.toggle('hide', !open);
}
$('#side-backdrop').addEventListener('click', () => toggleSide(false));
document.addEventListener('click', (event) => {
  // Der Knopf wird bei jeder Ansicht neu gezeichnet – deshalb hier einmal für alle. Ob er
  // überhaupt zu sehen ist, entscheidet allein die Breite, und das gehört ins CSS: sonst bliebe
  // er nach dem Verkleinern des Fensters verschwunden und die Seitenleiste unerreichbar.
  if (event.target.closest('.side-toggle')) toggleSide(true);
  else if (event.target.closest('.side a')) toggleSide(false);
});

/** Kopfzeile einer Ansicht – enthält auf dem Handy den Knopf für die Seitenleiste. */
export function appbar(title, actionsHtml = '', subtitle = '') {
  return `<div class="appbar">
    <div class="row" style="min-width:0">
      <button class="btn btn-ghost btn-sm side-toggle" type="button" aria-label="${escapeHtml(
        tr('nav.menu')
      )}">${icon('menu')}</button>
      <div style="min-width:0">
        <h1 class="truncate">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="small muted truncate">${subtitle}</p>` : ''}
      </div>
    </div>
    <div class="row wrap">${actionsHtml}</div>
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
  } catch (error) {
    $('#main').innerHTML = `<div class="empty"><h3>${escapeHtml(tr('common.error'))}</h3>
      <p>${escapeHtml(error.message)}</p>
      <button class="btn" onclick="location.reload()">${escapeHtml(tr('common.retry'))}</button></div>`;
  } finally {
    drawing = false;
    banner();
    if (redrawWanted) {
      redrawWanted = false;
      draw();
    }
  }
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
