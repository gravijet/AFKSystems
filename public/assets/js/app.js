// Dashboard: Rahmen, Seitenleiste, Router und die Live-Verbindung.
//
// Eine Seite, ein Zustand, ein WebSocket. Die einzelnen Ansichten liegen in views/ und bekommen
// den Zustand übergeben; neu gezeichnet wird immer die ganze Ansicht – bei dieser Größe ist das
// einfacher zu verstehen als jede feinere Aktualisierung, und schnell genug.

import { api, icon, themeSwitch, escapeHtml, credits, $, fail, toast } from './ui.js';

export const state = {
  me: null,
  meta: null,
  profiles: [],
  accounts: [],
  bots: new Map(), // key "profil:konto" -> Zustand
  lines: new Map(), // key -> Chatzeilen (Ringpuffer)
  route: { name: 'uebersicht', id: null, tab: null },
  onLive: null, // die aktive Ansicht darf sich für Live-Daten anmelden
};

// ---------------------------------------------------------------- Router

const ROUTES = [
  { path: /^$|^\/$/, name: 'uebersicht' },
  { path: /^\/konten$/, name: 'konten' },
  { path: /^\/server$/, name: 'server' },
  { path: /^\/server\/(\d+)(?:\/([a-z]+))?$/, name: 'profil' },
  { path: /^\/proxys$/, name: 'proxys' },
  { path: /^\/guthaben$/, name: 'guthaben' },
  { path: /^\/downloads$/, name: 'downloads' },
  { path: /^\/einstellungen$/, name: 'einstellungen' },
  { path: /^\/admin(?:\/([a-z]+))?$/, name: 'admin' },
];

function parseRoute() {
  const hash = location.hash.replace(/^#/, '');
  for (const route of ROUTES) {
    const match = route.path.exec(hash);
    if (!match) continue;
    if (route.name === 'profil') return { name: 'profil', id: Number(match[1]), tab: match[2] || 'verbinden' };
    if (route.name === 'admin') return { name: 'admin', id: null, tab: match[1] || 'uebersicht' };
    return { name: route.name, id: null, tab: null };
  }
  return { name: 'uebersicht', id: null, tab: null };
}

export function go(hash) {
  location.hash = hash;
}

// ---------------------------------------------------------------- Daten

export async function refresh({ profiles = true, accounts = true, me = true } = {}) {
  const jobs = [];
  if (me) jobs.push(api('/me').then((data) => { state.me = data.user; state.stats = data.stats; }));
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
  const limit = state.me?.chat_limit || 200;
  if (list.length > limit) list.splice(0, list.length - limit);
  state.lines.set(key, list);
}

// ---------------------------------------------------------------- Live-Verbindung

let socket = null;
let retry = 0;

function connect() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`;
  socket = new WebSocket(url);

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
      if (state.me) state.me.credits_mcr = message.balance_mcr;
      drawSide();
      if (message.stopped) toast('Guthaben aufgebraucht – die Bots wurden gestoppt.', 'bad');
      state.onLive?.({ type: 'credits' });
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
    node.title = online ? 'Live verbunden' : 'Verbindung zum Panel unterbrochen';
  }
}

// ---------------------------------------------------------------- Seitenleiste

const NAV = [
  { hash: '#/', label: 'Übersicht', icon: 'chart' },
  { hash: '#/server', label: 'Serverprofile', icon: 'server' },
  { hash: '#/konten', label: 'Minecraft-Konten', icon: 'users' },
  { hash: '#/proxys', label: 'Proxys', icon: 'globe' },
  { hash: '#/guthaben', label: 'Guthaben', icon: 'wallet' },
  { hash: '#/downloads', label: 'Downloads', icon: 'download' },
  { hash: '#/einstellungen', label: 'Einstellungen', icon: 'settings' },
];

export const TABS = [
  { key: 'verbinden', label: 'Verbinden' },
  { key: 'chat', label: 'Chat' },
  { key: 'bewegung', label: 'Bewegung' },
  { key: 'inventar', label: 'Inventar' },
  { key: 'pov', label: 'POV' },
  { key: 'proxys', label: 'Proxys' },
  { key: 'macros', label: 'Macros' },
  { key: 'einstellungen', label: 'Einstellungen' },
];

export function drawSide() {
  const route = state.route;
  const profiles = state.profiles
    .map((profile) => {
      const active = route.name === 'profil' && route.id === profile.id;
      const color = profile.online ? 'var(--ok)' : profile.total ? 'var(--text-2)' : 'var(--line)';
      return `<a class="profile-link ${active ? 'active' : ''}" href="#/server/${profile.id}/verbinden">
        <span class="dot ${profile.online ? 'live' : ''}" style="color:${color}"></span>
        <span class="grow truncate">${escapeHtml(profile.name)}</span>
        <span class="count muted">${profile.online}/${profile.total}</span>
      </a>${
        active
          ? `<div style="margin:.15rem 0 .5rem .95rem;padding-left:.6rem;box-shadow:inset 1px 0 0 var(--line)">
              ${TABS.map(
                (tab) =>
                  `<a class="profile-link ${route.tab === tab.key ? 'active' : ''}"
                      style="padding-block:.3rem;font-size:.8125rem"
                      href="#/server/${profile.id}/${tab.key}">${tab.label}</a>`
              ).join('')}
            </div>`
          : ''
      }`;
    })
    .join('');

  $('#side').innerHTML = `
    <a class="brand" href="/" style="padding:.35rem .65rem">
      <img class="logo" src="/assets/img/logo.svg" alt="" />AFKSystems
    </a>

    <nav class="nav">
      ${NAV.map(
        (item) =>
          `<a class="${routeMatches(item.hash) ? 'active' : ''}" href="${item.hash}">${icon(item.icon)}${item.label}</a>`
      ).join('')}
      ${
        state.me?.role === 'admin'
          ? `<a class="${state.route.name === 'admin' ? 'active' : ''}" href="#/admin">${icon('shield')}Administration</a>`
          : ''
      }
    </nav>

    <div class="stack" style="gap:.25rem">
      <div class="row spread">
        <span class="label">Serverprofile</span>
        <button class="btn btn-ghost btn-sm" id="new-profile" title="Serverprofil anlegen">${icon('plus')}</button>
      </div>
      ${profiles || '<p class="small muted" style="padding:.35rem .65rem">Noch keins angelegt.</p>'}
    </div>

    <div class="foot stack" style="gap:.6rem">
      <a class="card tight" href="#/guthaben" style="display:block">
        <div class="row spread">
          <span class="small muted">Guthaben</span>
          <span class="dot" id="live-dot" style="color:var(--text-2)"></span>
        </div>
        <div class="mono strong" style="font-size:1.05rem">${credits(state.me?.credits_mcr ?? 0)} Credits</div>
        <div class="small muted">${hoursLeftText()}</div>
      </a>
      <div class="row spread">
        <a class="row small grow" href="#/einstellungen" style="gap:.5rem">
          ${icon('user')}<span class="truncate">${escapeHtml(state.me?.username || '')}</span>
        </a>
        ${themeSwitch()}
      </div>
      <button class="btn btn-ghost btn-sm" id="logout">Abmelden</button>
    </div>`;

  $('#new-profile').addEventListener('click', () => import('./views/server.js').then((m) => m.newProfile()));
  $('#logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    location.href = '/';
  });
}

function routeMatches(hash) {
  const name = hash.replace('#/', '') || 'uebersicht';
  if (name === 'server') return state.route.name === 'server' || state.route.name === 'profil';
  return state.route.name === name;
}

function hoursLeftText() {
  const running = [...state.bots.values()].filter((bot) => bot.state && bot.state !== 'offline').length;
  const rate = (state.me?.rate_mcr_hour || 7) * Math.max(running, 1);
  const hours = (state.me?.credits_mcr ?? 0) / rate;
  if (hours < 1) return `reicht noch ${Math.max(0, Math.round(hours * 60))} min`;
  if (hours < 48) return `reicht ~${hours.toFixed(1)} h bei ${Math.max(running, 1)} Bot(s)`;
  return `reicht ~${Math.round(hours / 24)} Tage bei ${Math.max(running, 1)} Bot(s)`;
}

// Seitenleiste auf dem Handy ein-/ausblenden.
export function toggleSide(open) {
  $('#side').classList.toggle('open', open);
  $('#side-backdrop').classList.toggle('hide', !open);
}
$('#side-backdrop').addEventListener('click', () => toggleSide(false));
document.addEventListener('click', (event) => {
  if (event.target.closest('.side a')) toggleSide(false);
});

/** Kopfzeile einer Ansicht – enthält auf dem Handy den Knopf für die Seitenleiste. */
export function appbar(title, actionsHtml = '', subtitle = '') {
  return `<div class="appbar">
    <div class="row" style="min-width:0">
      <button class="btn btn-ghost btn-sm" id="side-toggle" style="display:none" aria-label="Menü">${icon('menu')}</button>
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
  uebersicht: () => import('./views/overview.js'),
  konten: () => import('./views/accounts.js'),
  server: () => import('./views/server.js'),
  profil: () => import('./views/server.js'),
  proxys: () => import('./views/proxies.js'),
  guthaben: () => import('./views/billing.js'),
  downloads: () => import('./views/downloads.js'),
  einstellungen: () => import('./views/settings.js'),
  admin: () => import('./views/admin.js'),
};

let drawing = false;

export async function draw() {
  if (drawing) return;
  drawing = true;
  state.route = parseRoute();
  state.onLive = null;
  drawSide();
  try {
    const module = await VIEWS[state.route.name]();
    await module.render($('#main'), state.route);
  } catch (error) {
    $('#main').innerHTML = `<div class="empty"><h3>Das ging schief</h3>
      <p>${escapeHtml(error.message)}</p>
      <button class="btn" onclick="location.reload()">Neu laden</button></div>`;
  } finally {
    drawing = false;
    const toggle = $('#side-toggle');
    if (toggle && window.innerWidth < 1000) {
      toggle.style.display = '';
      toggle.addEventListener('click', () => toggleSide(true));
    }
  }
}

window.addEventListener('hashchange', draw);

// ---------------------------------------------------------------- Start
//
// Bewusst ohne `await` auf Modulebene: die Ansichten importieren dieses Modul zurück, und ein
// wartendes Modul würde diesen Import nie freigeben – das Dashboard bliebe stumm beim Laden stehen.

async function boot() {
  try {
    await refresh();
    if (!state.meta) state.meta = await api('/meta');
    connect();
    await draw();
  } catch (error) {
    if (error.status === 401) {
      location.href = `/login.html?weiter=${encodeURIComponent(location.pathname + location.hash)}`;
    } else {
      fail(error);
      $('#main').innerHTML = `<div class="empty"><h3>Keine Verbindung zum Panel</h3>
        <p>${escapeHtml(error.message)}</p></div>`;
    }
  }
}

boot();
