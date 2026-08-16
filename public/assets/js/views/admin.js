// Administration. Ein Bildschirm je Thema, alles über /api/admin.
//
// Der Grundsatz hier: nichts verstecken, was der Betreiber braucht, und nichts anbieten, was das
// Backend nicht kann. Jede Tabelle zeigt echte Werte aus der Datenbank, jede Änderung geht sofort
// hin und kommt frisch zurück.
//
// Die Themen stehen als eigene Punkte in der Seitenleiste (siehe ADMIN_GROUPS und app.js) und
// nicht mehr als siebzehn Reiter in einer Zeile. Siebzehn Reiter nebeneinander sind keine
// Gliederung: sie brechen um, und keiner sagt, was zusammengehört.
//
// "Tickets" ist der Arbeitsbildschirm des Teams – alle Tickets, filterbar. Der Support-Punkt in
// der Seitenleiste zeigt dagegen die **eigenen** Tickets, auch einem Administrator: dort ist er
// Kunde, hier bearbeitet er.

import {
  api, icon, escapeHtml, credits, euro, datetime, date, since, bytes, meter, mcText, tr, $, $$,
  ok, fail, toast, confirmDialog, formDialog, copy, debounce,
} from '../ui.js';
import { mergeLines } from '../chatlog.js';
import { state, appbar, draw, go, ADMIN_GROUPS } from '../app.js';

const ADMIN_ITEMS = ADMIN_GROUPS.flatMap((group) => group.items);

const accountKindLabel = (kind) =>
  tr(kind === 'offline' ? 'acc.kind.offline' : kind === 'microsoft' ? 'acc.kind.microsoft' : 'common.none');

const accountStatusLabel = (status) => {
  const keys = { ok: 'acc.ok', pending: 'acc.pending', error: 'acc.error' };
  return tr(keys[status] || 'state.offline');
};

function bindAdminSwitches(selector, save) {
  $$(selector).forEach((node) => {
    const toggle = async () => {
      const enabled = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(enabled));
      try {
        const saved = await save(node.dataset.discordRole, enabled);
        if (saved === false) node.setAttribute('aria-checked', String(!enabled));
      } catch (error) {
        node.setAttribute('aria-checked', String(!enabled));
        fail(error);
      }
    };
    node.addEventListener('click', toggle);
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });
  });
}

async function changeAccountSuspension(account) {
  if (!account) return;
  const accountId = account.id ?? account.account_id;
  if (account.suspended) {
    if (!(await confirmDialog(tr('adm.resumeAccountAsk', { name: account.name }), { danger: false }))) return;
    await api(`/admin/accounts/${accountId}/suspension`, {
      method: 'POST',
      body: { suspended: false },
    }).catch(fail);
    draw();
    return;
  }
  const answer = await formDialog(
    tr('adm.suspendAccount'),
    [{ key: 'reason', label: tr('adm.suspendReason'), required: true }],
    { submit: tr('adm.suspendAccount'), note: account.name }
  );
  if (!answer) return;
  await api(`/admin/accounts/${accountId}/suspension`, {
    method: 'POST',
    body: { suspended: true, reason: answer.reason },
  }).catch(fail);
  draw();
}

export async function render(root, route) {
  // Alte Lesezeichen aus der früheren Prozessansicht bleiben gültig.
  const requested = route.tab === 'bots' ? 'accounts' : route.tab;
  const entry = ADMIN_ITEMS.find((item) => item.key === requested);
  const tab = entry ? entry.key : 'overview';

  root.innerHTML = `
    ${appbar(tr(entry?.label || 'adm.overview'), '', tr('adm.title'))}
    <div id="admin-body"><div class="empty"><h3>${escapeHtml(tr('common.loading'))}</h3></div></div>`;

  const body = $('#admin-body');
  const views = {
    overview,
    system,
    tickets: route.id ? (node) => staffTicket(node, route.id) : staffTickets,
    users: route.id ? (node) => userDetail(node, route.id) : users,
    servers: route.id ? (node) => serverDetail(node, route.id) : servers,
    accounts,
    nodes,
    plans,
    addons,
    topups,
    vouchers,
    proxies,
    announcements,
    settings,
    client,
    mails,
    ledger,
    audit,
  };
  try {
    await views[tab](body);
  } catch (error) {
    body.innerHTML = `<div class="note bad">${icon('alert')}<div>${escapeHtml(error.message)}</div></div>`;
  }
}

// ---------------------------------------------------------------- Bausteine

const stat = (label, value, sub = '') =>
  `<div class="stat"><div class="k">${escapeHtml(label)}</div><div class="v">${value}</div>
   <div class="s">${escapeHtml(sub)}</div></div>`;

const table = (heads, rows) => `<div class="table-wrap"><table class="table">
  <thead><tr>${heads.map((head) => `<th>${escapeHtml(head)}</th>`).join('')}</tr></thead>
  <tbody>${
    rows.join('') ||
    `<tr><td colspan="${heads.length}" class="small muted" style="padding:1.5rem;text-align:center">${escapeHtml(
      tr('common.none')
    )}</td></tr>`
  }</tbody></table></div>`;

const panel = (title, inner, actions = '') => `<section class="panel" style="margin-bottom:1.5rem">
  <header><h3>${escapeHtml(title)}</h3><div class="row">${actions}</div></header>
  <div class="body" style="padding:0">${inner}</div>
</section>`;

/** Zahlen aus einem Dialog kommen als Text zurück – hier wieder zu Zahlen machen. */
function numbers(answer, extra = []) {
  const out = { ...answer };
  for (const key of [
    'price_credits', 'max_accounts', 'chat_limit', 'max_macros', 'sort', 'credits', 'uses',
    'count', 'expires_days', 'amount', 'max_qty', 'max_bots', 'max_profiles', 'qty', ...extra,
  ]) {
    if (out[key] !== undefined && out[key] !== '') out[key] = Number(out[key]);
  }
  return out;
}

// ---------------------------------------------------------------- Überblick

async function overview(root) {
  const data = await api('/admin/overview');

  root.innerHTML = `
    <div class="grid four" style="margin-bottom:1.5rem">
      ${stat(tr('adm.users'), data.users, tr('adm.usersLine', { new: data.users_new_30d, active: data.users_active_24h }))}
      ${stat(tr('adm.bots'), data.bots_running, `${data.bots_online} × ${tr('state.online')}`)}
      ${stat(
        tr('adm.profiles'),
        data.profiles,
        tr('bill.slotsLine', { paid: data.profiles_paid, free: data.profiles - data.profiles_paid })
      )}
      ${stat(tr('bill.balance'), credits(data.credits_outstanding), euro(data.credits_outstanding))}
      ${stat(tr('adm.topups'), euro(data.revenue_30d_cent), tr('adm.revenueAll', { total: euro(data.revenue_cent) }))}
      ${stat(
        tr('adm.tickets'),
        data.tickets?.open ?? data.open_tickets,
        tr('adm.unread', { n: data.tickets?.unread ?? data.unread_tickets })
      )}
      ${stat(
        tr('adm.attention'),
        data.users_blocked + data.users_unverified + (data.open_topups || 0),
        tr('adm.attentionLine', { blocked: data.users_blocked, unverified: data.users_unverified })
      )}
    </div>

    <div class="grid two">
      <section class="panel">
        <header><h3>${escapeHtml(tr('adm.client'))}</h3>
          <button class="btn btn-sm" id="sync">${icon('refresh')}</button></header>
        <div class="body stack">
          <div class="row spread"><span class="muted small">Release</span>
            <span class="mono">${escapeHtml(data.client.tag || '–')}</span></div>
          <div class="row spread"><span class="muted small">Version</span>
            <span class="mono">${escapeHtml(data.client.version || '–')}</span></div>
          <div class="row spread"><span class="muted small">${escapeHtml(tr('ov.clientVersions'))}</span>
            <span class="mono small">${(data.client.versions || []).map(escapeHtml).join(', ') || '–'}</span></div>
          <div class="row spread"><span class="muted small">${escapeHtml(tr('ov.builds'))}</span>
            <span class="row" style="gap:.35rem">${Object.entries(data.client.builds || {})
              .map(
                ([name, entry]) =>
                  `<span class="pill ${entry.present ? 'primary' : 'missing'}">${escapeHtml(name)}</span>`
              )
              .join('')}</span></div>
          ${
            data.client.error
              ? `<div class="note warn">${icon('alert')}<div>${escapeHtml(data.client.error)}</div></div>`
              : ''
          }
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('adm.settings'))}</h3>
          <a class="btn btn-sm" href="#/admin/settings">${escapeHtml(tr('common.edit'))}</a></header>
        <div class="body stack">
          ${health('SMTP', data.mail.configured, data.mail.configured ? tr('adm.mailsFailed', { n: data.mail.failed_24h }) : '')}
          ${health(tr('auth.verify.title'), data.mail.verify)}
          ${health('Discord', data.oauth?.discord?.available, data.oauth?.discord?.login ? tr('set.link') : '')}
          ${health('Google', data.oauth?.google?.available, data.oauth?.google?.login ? tr('set.link') : '')}
          ${health(
            tr('adm.botStatus'),
            data.bot?.connected > 0,
            data.bot?.connected > 0 ? tr('adm.botConnected') : tr('adm.botAway')
          )}
          ${health(tr('error.maintenance.title'), !Number(data.settings.maintenance), '', true)}
          ${health(tr('auth.register.title'), Number(data.settings.registration_open))}
        </div>
      </section>
    </div>`;

  $('#sync').addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      await api('/admin/client/sync', { method: 'POST', body: { force: false } });
      ok(tr('adm.saved'));
      draw();
    } catch (error) {
      fail(error);
      event.target.disabled = false;
    }
  });
}

const health = (label, good, note = '') => `<div class="row spread">
  <span class="muted small">${escapeHtml(label)}</span>
  <span class="row" style="gap:.5rem">
    ${note ? `<span class="small muted">${escapeHtml(note)}</span>` : ''}
    <span class="pill ${good ? 'primary' : 'missing'}">${good ? 'ok' : '–'}</span>
  </span></div>`;

// ---------------------------------------------------------------- System
//
// Was die Maschine tut und was davon auf uns geht. Die Werte kommen aus zwei Messungen im
// Abstand, deshalb wird die Seite hier von selbst nachgeladen statt einmal beim Öffnen.

async function system(root) {
  let timer = null;

  const paint = (data) => {
    const host = data.host;
    const own = data.afksystems;
    root.innerHTML = `
      <div class="grid three" style="margin-bottom:1.5rem">
        <div class="usage-card">
          <div class="row spread"><span class="k">${escapeHtml(tr('adm.cpu'))}</span>
            <span class="small muted">${escapeHtml(tr('adm.cores', { n: host.cores }))}</span></div>
          <div class="v">${host.cpu_percent === null ? '…' : `${host.cpu_percent.toFixed(1)} %`}</div>
          ${meter(host.cpu_percent || 0)}
          <div class="s">${escapeHtml(tr('adm.ofThat'))}: <strong>${own.cpu_percent.toFixed(1)} %</strong>
            · ${escapeHtml(tr('adm.load'))} ${host.load.join(' / ')}</div>
        </div>

        <div class="usage-card">
          <div class="row spread"><span class="k">${escapeHtml(tr('adm.ram'))}</span>
            <span class="small muted">${bytes(host.memory.total)}</span></div>
          <div class="v">${bytes(host.memory.used)}</div>
          ${meter(host.memory.percent)}
          <div class="s">${escapeHtml(tr('adm.ofThat'))}: <strong>${bytes(own.memory_bytes)}</strong>
            (${own.memory_percent.toFixed(1)} %) · ${own.bots} ${escapeHtml(tr('adm.botProc'))}</div>
        </div>

        <div class="usage-card">
          <div class="row spread"><span class="k">${escapeHtml(tr('adm.disk'))}</span>
            <span class="small muted">${host.disk ? bytes(host.disk.total) : '–'}</span></div>
          <div class="v">${host.disk ? bytes(host.disk.used) : '–'}</div>
          ${host.disk ? meter(host.disk.percent) : ''}
          <div class="s">${escapeHtml(tr('adm.ofThat'))}: <strong>${bytes(own.disk.data)}</strong>
            · ${escapeHtml(tr('adm.logs'))} ${bytes(own.disk.logs)} · Client ${bytes(own.disk.binaries)}</div>
        </div>
      </div>

      <div class="grid two" style="margin-bottom:1.5rem">
        <section class="panel">
          <header><h3>${escapeHtml(tr('adm.machine'))}</h3></header>
          <div class="body stack">
            <div class="row spread"><span class="muted small">Host</span>
              <span class="mono">${escapeHtml(host.hostname)}</span></div>
            <div class="row spread"><span class="muted small">System</span>
              <span class="mono small">${escapeHtml(host.platform)}</span></div>
            <div class="row spread"><span class="muted small">${escapeHtml(tr('adm.uptime'))}</span>
              <span class="mono">${uptime(host.uptime_sec)}</span></div>
            <div class="row spread"><span class="muted small">${escapeHtml(tr('adm.uptimePanel'))}</span>
              <span class="mono">${uptime(own.uptime_sec)}</span></div>
            ${
              host.memory.swap_total
                ? `<div class="row spread"><span class="muted small">Swap</span>
                    <span class="mono">${bytes(host.memory.swap_used)} / ${bytes(host.memory.swap_total)}</span></div>`
                : ''
            }
          </div>
        </section>

        <section class="panel">
          <header><h3>${escapeHtml(tr('adm.disk'))} · AFKSystems</h3></header>
          <div class="body stack">
            ${Object.entries(own.disk)
              .map(
                ([key, value]) => `<div class="row spread">
                  <span class="muted small mono">${escapeHtml(key)}</span>
                  <span class="mono">${bytes(value)}</span></div>`
              )
              .join('')}
          </div>
        </section>
      </div>

      ${panel(
        tr('adm.perServer'),
        table(
          [tr('common.name'), tr('adm.users'), tr('adm.bots'), tr('adm.cpu'), tr('adm.ram'), tr('adm.disk')],
          data.profiles
            .sort((a, b) => b.rss - a.rss)
            .map(
              (entry) => `<tr data-server="${entry.profile_id}" style="cursor:pointer">
                <td>${escapeHtml(entry.name)}</td>
                <td class="small"><a href="#/admin/users/${entry.user_id}">${escapeHtml(entry.username || '')}</a></td>
                <td class="small muted">${entry.bots}</td>
                <td class="mono small">${entry.cpu_percent.toFixed(1)} %</td>
                <td class="mono small">${bytes(entry.rss)}</td>
                <td class="mono small muted">${bytes(entry.disk)}</td>
              </tr>`
            )
        )
      )}`;

    $$('[data-server]').forEach((row) =>
      row.addEventListener('click', () => go(`/admin/servers/${row.dataset.server}`))
    );
  };

  paint(await api('/admin/metrics'));
  // Der erste CPU-Wert ist immer leer: er braucht eine zweite Messung zum Vergleichen.
  const tick = async () => {
    if (state.route.name !== 'admin' || state.route.tab !== 'system') return clearInterval(timer);
    try {
      paint(await api('/admin/metrics'));
    } catch {
      /* beim nächsten Mal wieder */
    }
  };
  timer = setInterval(tick, 4000);
  setTimeout(tick, 1200);
}

function uptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days} d ${hours} h` : hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

// ---------------------------------------------------------------- Tickets
//
// Der Arbeitsbildschirm des Teams: alle Tickets, nach Zustand gefiltert, das Dringendste oben.
// Angeklickt wird daraus dasselbe Gespräch, das der Kunde sieht – nur mit den Werkzeugen dazu.

const TICKET_STATUS_PILL = { open: 'primary', waiting: 'missing', answered: '', closed: '' };
const TICKET_PRIORITY_PILL = { urgent: 'missing', high: 'primary', normal: '', low: '' };

async function staffTicket(root, id) {
  const { renderStaffTicket } = await import('./tickets.js');
  return renderStaffTicket(root, id);
}

async function staffTickets(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const status = params.get('status') || 'open';
  const search = params.get('q') || '';

  const data = await api(`/admin/tickets?status=${status}&q=${encodeURIComponent(search)}`);
  const categories = data.categories || state.meta?.ticket_categories || [];

  root.innerHTML = `
    <div class="row spread wrap" style="margin-bottom:1rem;gap:1rem">
      <div class="row wrap">
        <select id="tk-status" class="mini" style="max-width:13rem">
          <option value="all" ${status === 'all' ? 'selected' : ''}>${escapeHtml(tr('common.all'))}</option>
          ${(data.statuses || [])
            .map(
              (entry) =>
                `<option value="${entry}" ${status === entry ? 'selected' : ''}>${escapeHtml(
                  tr(`tk.status.${entry}`)
                )}</option>`
            )
            .join('')}
        </select>
        <input id="tk-q" type="search" placeholder="${escapeHtml(tr('common.search'))}"
          value="${escapeHtml(search)}" style="max-width:16rem">
      </div>
      <button class="btn btn-sm" id="tk-new-for">${icon('users')} ${escapeHtml(tr('tk.newFor'))}</button>
    </div>

    <section class="panel">
      <div class="body" style="padding:0">
        ${
          data.tickets.length
            ? `<ul class="ticket-list">${data.tickets.map((ticket) => staffRow(ticket, categories)).join('')}</ul>`
            : `<div class="empty" style="box-shadow:none;background:transparent">
                <h3>${escapeHtml(tr('tk.none'))}</h3></div>`
        }
      </div>
    </section>`;

  $$('[data-open]').forEach((node) =>
    node.addEventListener('click', () => go(`/admin/tickets/${node.dataset.open}`))
  );

  const reload = debounce(() => {
    go(
      `/admin/tickets?status=${$('#tk-status').value}&q=${encodeURIComponent($('#tk-q').value.trim())}`
    );
    draw();
  }, 300);
  $('#tk-status').addEventListener('change', reload);
  $('#tk-q').addEventListener('input', reload);

  $('#tk-new-for').addEventListener('click', () => ticketForCustomer(categories));

  // Kommt ein Ticket herein oder eine Antwort, ist die Liste sofort veraltet.
  state.onLive = debounce((event) => {
    if (event.type === 'ticket' && state.route.name === 'admin' && state.route.tab === 'tickets') draw();
  }, 500);
}

function staffRow(ticket, categories) {
  return `<li class="ticket-row ${ticket.unread_staff ? 'is-unread' : ''}" data-open="${ticket.id}">
    <span class="ticket-dot ${ticket.status}"></span>
    <div class="grow" style="min-width:0">
      <div class="row" style="gap:.5rem">
        <span class="strong truncate">${escapeHtml(ticket.subject)}</span>
        <span class="small muted mono">#${ticket.id}</span>
        ${ticket.discord ? `<span class="pill" title="${escapeHtml(tr('tk.inDiscord'))}">${icon('discord')}</span>` : ''}
      </div>
      <div class="small muted truncate">
        ${escapeHtml(categories.find((entry) => entry.key === ticket.category)?.label || ticket.category)}
        ${ticket.username ? ` · ${escapeHtml(ticket.username)}` : ''}
        ${ticket.assigned_name ? ` · ${escapeHtml(ticket.assigned_name)}` : ''}
      </div>
    </div>
    <div class="row" style="gap:.4rem">
      ${
        ticket.priority && ticket.priority !== 'normal'
          ? `<span class="pill ${TICKET_PRIORITY_PILL[ticket.priority] || ''}">${escapeHtml(
              tr(`tk.priority.${ticket.priority}`)
            )}</span>`
          : ''
      }
      <span class="pill ${TICKET_STATUS_PILL[ticket.status] || ''}">${escapeHtml(
        tr(`tk.status.${ticket.status}`)
      )}</span>
      <span class="small muted mono nowrap">${since(ticket.updated_at)}</span>
    </div>
  </li>`;
}

/**
 * Ein Ticket für einen Kunden – etwa nach einem Gespräch, das woanders stattgefunden hat.
 *
 * Das gehört hierher und nicht in den Support-Bildschirm eines Kunden: dort stand es bisher und
 * war für jeden zu sehen, der zufällig Administrator ist, aber gerade Kunde sein wollte.
 */
async function ticketForCustomer(categories) {
  const { users: list } = await api('/admin/users?filter=all');
  const answer = await formDialog(
    tr('tk.newFor'),
    [
      {
        key: 'user_id',
        label: tr('adm.users'),
        type: 'select',
        value: String(list[0]?.id || ''),
        options: list.map((user) => ({ value: String(user.id), label: `${user.username} · ${user.email}` })),
      },
      { key: 'subject', label: tr('tk.subject'), required: true },
      {
        key: 'category',
        label: tr('tk.category'),
        type: 'select',
        value: 'general',
        options: categories.map((entry) => ({ value: entry.key, label: entry.label })),
      },
      {
        key: 'priority',
        label: tr('tk.priority'),
        type: 'select',
        value: 'normal',
        options: ['low', 'normal', 'high', 'urgent'].map((value) => ({
          value,
          label: tr(`tk.priority.${value}`),
        })),
      },
      { key: 'body', label: `${tr('tk.message')} (${tr('common.optional')})`, type: 'textarea' },
    ],
    { submit: tr('tk.send') }
  );
  if (!answer) return;
  try {
    const result = await api(`/admin/users/${answer.user_id}/ticket`, { method: 'POST', body: answer });
    ok(tr('tk.created'));
    go(`/admin/tickets/${result.ticket.id}`);
  } catch (error) {
    fail(error);
  }
}

// ---------------------------------------------------------------- Nutzer

async function users(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const query = params.get('q') || '';
  const filter = params.get('filter') || 'all';
  const data = await api(`/admin/users?q=${encodeURIComponent(query)}&filter=${filter}`);

  root.innerHTML = `
    <div class="row wrap" style="margin-bottom:1rem">
      <input id="search" type="search" placeholder="${escapeHtml(tr('common.search'))}"
        value="${escapeHtml(query)}" style="max-width:18rem">
      <select id="filter" class="mini" style="max-width:12rem">
        ${[
          ['all', tr('common.all')],
          ['paying', tr('adm.paying')],
          ['admins', tr('set.role.admin')],
          ['blocked', tr('adm.block')],
          ['unverified', tr('auth.verify.title')],
        ]
          .map(
            ([value, label]) =>
              `<option value="${value}" ${filter === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
          )
          .join('')}
      </select>
      <div class="grow"></div>
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('adm.newUser'))}</button>
    </div>

    ${panel(
      `${data.users.length} ${tr('adm.users')}`,
      table(
        ['#', tr('auth.register.username'), tr('auth.register.email'), tr('common.credits'), tr('bill.monthly'), tr('adm.profiles'), tr('adm.bots'), ''],
        data.users.map(
          (user) => `<tr data-user="${user.id}" style="cursor:pointer">
            <td class="mono small muted">${user.id}</td>
            <td><span class="row" style="gap:.4rem">${escapeHtml(user.username)}
              ${user.role === 'admin' ? `<span class="pill primary">admin</span>` : ''}
              ${user.blocked ? `<span class="pill missing">${escapeHtml(tr('adm.block'))}</span>` : ''}
              ${!user.email_verified ? `<span class="pill missing">mail</span>` : ''}
              ${user.discord ? `<span class="pill" title="${escapeHtml(user.discord.name || '')}">${icon('discord')}</span>` : ''}</span></td>
            <td class="small muted">${escapeHtml(user.email)}</td>
            <td class="mono">${credits(user.credits)}</td>
            <td class="mono small">${user.monthly ? credits(user.monthly) : '–'}</td>
            <td class="small muted">${user.profiles} (${user.paid_profiles})</td>
            <td class="small muted">${user.bots_running}</td>
            <td class="small muted mono">${user.last_seen_at ? since(user.last_seen_at) : '–'}</td>
          </tr>`
        )
      )
    )}`;

  const search = debounce(() => {
    go(`/admin/users?q=${encodeURIComponent($('#search').value.trim())}&filter=${$('#filter').value}`);
    draw();
  }, 350);
  $('#search').addEventListener('input', search);
  $('#filter').addEventListener('change', search);
  $$('[data-user]').forEach((row) =>
    row.addEventListener('click', () => go(`/admin/users/${row.dataset.user}`))
  );

  $('#new').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('adm.newUser'),
      [
        { key: 'email', label: tr('auth.register.email'), type: 'email', required: true },
        { key: 'username', label: tr('auth.register.username'), required: true },
        { key: 'password', label: tr('auth.register.password'), type: 'password', required: true },
        {
          key: 'role',
          label: tr('set.role'),
          type: 'select',
          value: 'user',
          options: [
            { value: 'user', label: tr('set.role.user') },
            { value: 'admin', label: tr('set.role.admin') },
          ],
        },
      ],
      { submit: tr('common.create') }
    );
    if (!answer) return;
    try {
      await api('/admin/users', { method: 'POST', body: answer });
      ok(tr('adm.saved'));
      draw();
    } catch (error) {
      fail(error);
    }
  });
}

async function userDetail(root, id) {
  const data = await api(`/admin/users/${id}`);
  const user = data.user;
  const discordRoles = new Set(user.discord_roles || []);
  const discordRoleRows = [
    ['customer', null],
    ['premium', null],
    ['ultra', null],
    ['partner', 'discord_partner'],
    ['vip', 'discord_vip'],
    ['administrator', null],
    ['moderator', 'discord_moderator'],
    ['team', null],
  ];

  root.innerHTML = `
    <div class="row wrap spread" style="margin-bottom:1.25rem">
      <div>
        <h2 style="font-size:1.4rem">${escapeHtml(user.username)}
          ${user.role === 'admin' ? '<span class="pill primary">admin</span>' : ''}
          ${(user.discord_roles || [])
            .map((role) => `<span class="pill">${escapeHtml(tr(`role.${role}`))}</span>`)
            .join('')}
          ${user.blocked ? `<span class="pill missing">${escapeHtml(tr('adm.block'))}</span>` : ''}</h2>
        <p class="small muted mono">${escapeHtml(user.email)} · #${user.id} ·
          ${escapeHtml(tr('common.status'))}: ${user.last_seen_at ? since(user.last_seen_at) : '–'}
          ${user.discord ? ` · Discord ${escapeHtml(user.discord.name || user.discord.id)}` : ''}</p>
      </div>
      <div class="row wrap">
        <a class="btn btn-sm" href="#/admin/users">${escapeHtml(tr('common.back'))}</a>
        <button class="btn btn-sm" id="mail">${icon('mail')} ${escapeHtml(tr('adm.sendMail'))}</button>
        <button class="btn btn-sm" id="ticket">${icon('ticket')} ${escapeHtml(tr('adm.openTicket'))}</button>
        <button class="btn btn-sm" id="impersonate">${escapeHtml(tr('adm.impersonate'))}</button>
        <button class="btn btn-primary btn-sm" id="credits">${escapeHtml(tr('adm.addCredits'))}</button>
      </div>
    </div>

    <div class="grid four" style="margin-bottom:1.5rem">
      ${stat(tr('bill.balance'), credits(user.credits), euro(user.credits))}
      ${stat(tr('bill.monthly'), credits(data.monthly_cost), data.paying ? tr('adm.paying') : '–')}
      ${stat(tr('adm.profiles'), data.profiles.length, `${data.accounts.length} ${tr('ov.accounts')}`)}
      ${stat(tr('adm.tickets'), data.tickets.length, `${data.proxies.length} ${tr('px.title')}`)}
    </div>

    <div class="row wrap" style="margin-bottom:1.5rem">
      <button class="btn btn-sm" id="edit">${icon('settings')} ${escapeHtml(tr('common.edit'))}</button>
      <button class="btn btn-sm" id="password">${escapeHtml(tr('adm.setPassword'))}</button>
      <button class="btn btn-sm" id="premium">${escapeHtml(tr('adm.premium'))}</button>
      <button class="btn btn-sm" id="block">${escapeHtml(user.blocked ? tr('adm.unblock') : tr('adm.block'))}</button>
      <button class="btn btn-sm" id="role">${escapeHtml(
        user.role === 'admin' ? tr('adm.revokeAdmin') : tr('adm.makeAdmin')
      )}</button>
      ${
        user.email_verified
          ? ''
          : `<button class="btn btn-sm" id="verify">${escapeHtml(tr('adm.verifyMail'))}</button>`
      }
      <button class="btn btn-sm" id="stop">${escapeHtml(tr('adm.stopBots'))}</button>
      <button class="btn btn-sm" id="logout">${escapeHtml(tr('adm.logoutUser'))}</button>
    </div>

    <section class="panel" style="margin-bottom:1.5rem">
      <header><h3>${escapeHtml(tr('adm.discordRoles'))}</h3>
        <span class="small muted">${escapeHtml(user.discord ? tr('adm.rolesSynced') : tr('adm.rolesNeedLink'))}</span></header>
      <div class="body">
        <ul class="switch-list">
          ${discordRoleRows
            .map(([role, editable]) => `<li>
              <div class="grow">
                <span class="strong">${escapeHtml(tr(`role.${role}`))}</span>
                <p class="small muted">${escapeHtml(tr(`role.${role}.hint`))}</p>
              </div>
              ${
                editable
                  ? `<span class="switch" role="switch" tabindex="0" aria-checked="${Boolean(user[editable])}"
                       aria-label="${escapeHtml(tr(`role.${role}`))}" data-discord-role="${editable}"></span>`
                  : `<span class="pill ${discordRoles.has(role) ? 'primary' : ''}">${escapeHtml(
                      discordRoles.has(role) ? tr('adm.assigned') : tr('adm.notAssigned')
                    )}</span>`
              }
            </li>`)
            .join('')}
        </ul>
      </div>
    </section>

    ${panel(
      tr('adm.accounts'),
      table(
        [tr('common.name'), tr('common.status'), tr('common.created'), ''],
        data.accounts.map(
          (account) => `<tr>
            <td><span class="strong">${escapeHtml(account.name)}</span>
              <span class="small muted"> · ${escapeHtml(accountKindLabel(account.kind))}</span></td>
            <td>${
              account.suspended
                ? `<span class="pill missing">${escapeHtml(tr('acc.suspended'))}</span>
                   ${account.suspend_reason ? `<span class="small muted">${escapeHtml(account.suspend_reason)}</span>` : ''}`
                : `<span class="pill ${account.status === 'error' ? 'missing' : 'primary'}">${escapeHtml(
                    accountStatusLabel(account.status)
                  )}</span>`
            }</td>
            <td class="small muted mono">${datetime(account.created_at)}</td>
            <td style="text-align:right"><button class="btn btn-sm ${account.suspended ? '' : 'btn-danger'}"
              data-account-suspend="${account.id}">${escapeHtml(
                account.suspended ? tr('adm.resumeAccount') : tr('adm.suspendAccount')
              )}</button></td>
          </tr>`
        )
      )
    )}

    ${panel(
      tr('adm.profiles'),
      table(
        [tr('common.name'), tr('srv.address'), tr('srv.plan'), tr('common.month'), tr('common.status'), ''],
        data.profiles.map(
          (profile) => `<tr data-server="${profile.id}" style="cursor:pointer">
            <td>${escapeHtml(profile.name)}</td>
            <td class="mono small">${escapeHtml(profile.address)}</td>
            <td class="small">${escapeHtml(profile.plan || '–')}</td>
            <td class="small muted">${profile.paid_until ? date(profile.paid_until) : '–'}</td>
            <td>${
              profile.locked
                ? `<span class="pill missing">${escapeHtml(tr('adm.serverSuspended'))}</span>`
                : profile.suspended
                  ? `<span class="pill missing">${escapeHtml(tr('adm.billingSuspended'))}</span>`
                  : `<span class="pill ${profile.online ? 'primary' : ''}">${profile.online}</span>`
            }</td>
            <td style="text-align:right"><button class="btn btn-sm" data-extend="${profile.id}">+30 d</button></td>
          </tr>`
        )
      )
    )}

    ${panel(
      tr('adm.ledger'),
      table(
        ['', tr('common.status'), tr('common.credits'), tr('bill.balance')],
        data.ledger
          .slice(0, 30)
          .map(
            (row) => `<tr>
              <td class="small muted mono">${datetime(row.created_at)}</td>
              <td class="small">${escapeHtml(row.kind)} ${
                row.note ? `<span class="muted">· ${escapeHtml(row.note)}</span>` : ''
              }</td>
              <td class="mono" style="color:${row.delta >= 0 ? 'var(--ok)' : 'var(--text)'}">${
                row.delta >= 0 ? '+' : ''
              }${credits(row.delta)}</td>
              <td class="mono small muted">${credits(row.balance)}</td>
            </tr>`
          )
      )
    )}

    ${panel(
      tr('adm.tickets'),
      table(
        [tr('tk.subject'), tr('common.status'), ''],
        data.tickets.map(
          (ticket) => `<tr data-ticket="${ticket.id}" style="cursor:pointer">
            <td>${escapeHtml(ticket.subject)}</td>
            <td class="small">${escapeHtml(tr(`tk.status.${ticket.status}`))}</td>
            <td class="small muted mono">${datetime(ticket.updated_at)}</td>
          </tr>`
        )
      )
    )}

    <section class="panel">
      <header><h3>${escapeHtml(tr('adm.detail'))}</h3></header>
      <div class="body stack">
        <div class="field"><label for="notes">${escapeHtml(tr('common.edit'))}</label>
          <textarea id="notes" rows="4" placeholder="${escapeHtml(tr('adm.everything'))}">${escapeHtml(
            user.notes || ''
          )}</textarea></div>
        <div class="row">
          <div class="field" style="max-width:10rem"><label for="allowance">${escapeHtml(tr('px.title'))}</label>
            <input id="allowance" type="number" min="0" max="100" value="${user.proxy_allowance || 0}"></div>
          <button class="btn btn-primary" id="save-notes" style="align-self:flex-end">${escapeHtml(
            tr('common.save')
          )}</button>
        </div>
        ${
          user.premium_until
            ? `<p class="small muted">${escapeHtml(tr('adm.premium'))}: ${date(user.premium_until)}</p>`
            : ''
        }
      </div>
    </section>`;

  const patch = async (body) => {
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body });
      ok(tr('adm.saved'));
      draw();
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  };

  $('#credits').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('adm.addCredits'),
      [
        { key: 'credits_delta', label: tr('common.credits'), type: 'number', value: 100, required: true },
        { key: 'note', label: tr('common.edit'), value: '' },
      ],
      { submit: tr('common.save'), note: `${tr('bill.balance')}: ${credits(user.credits)}` }
    );
    if (answer) patch({ credits_delta: Number(answer.credits_delta), note: answer.note });
  });

  $('#mail').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('adm.sendMail'),
      [
        { type: 'note', key: 'note', label: `${user.username} · ${user.email}` },
        { key: 'subject', label: tr('tk.subject'), required: true },
        { key: 'body', label: tr('tk.message'), type: 'textarea', required: true },
        {
          key: 'category',
          label: tr('set.notify'),
          type: 'select',
          value: 'announcement',
          options: (state.meta?.mail_categories || [])
            .filter((entry) => entry.key !== 'account')
            .map((entry) => ({ value: entry.key, label: entry.name })),
        },
        { key: 'force', label: tr('adm.mailForce'), type: 'checkbox', value: false },
      ],
      { submit: tr('tk.send') }
    );
    if (!answer) return;
    try {
      await api(`/admin/users/${id}/mail`, { method: 'POST', body: answer });
      ok(tr('adm.mailSent'));
    } catch (error) {
      fail(error);
    }
  });

  $('#ticket').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('adm.openTicket'),
      [
        { type: 'note', key: 'note', label: user.username },
        { key: 'subject', label: tr('tk.subject'), required: true },
        {
          key: 'category',
          label: tr('tk.category'),
          type: 'select',
          value: 'general',
          options: (state.meta?.ticket_categories || []).map((entry) => ({
            value: entry.key,
            label: entry.label,
          })),
        },
        {
          key: 'priority',
          label: tr('tk.priority'),
          type: 'select',
          value: 'normal',
          options: ['low', 'normal', 'high', 'urgent'].map((value) => ({
            value,
            label: tr(`tk.priority.${value}`),
          })),
        },
        { key: 'body', label: `${tr('tk.message')} (${tr('common.optional')})`, type: 'textarea' },
      ],
      { submit: tr('tk.send') }
    );
    if (!answer) return;
    try {
      const result = await api(`/admin/users/${id}/ticket`, { method: 'POST', body: answer });
      go(`/admin/tickets/${result.ticket.id}`);
    } catch (error) {
      fail(error);
    }
  });

  $('#edit').addEventListener('click', async () => {
    const answer = await formDialog(tr('common.edit'), [
      { key: 'username', label: tr('auth.register.username'), value: user.username },
      { key: 'email', label: tr('auth.register.email'), value: user.email },
      {
        key: 'language',
        label: tr('common.language'),
        type: 'select',
        value: user.language,
        options: [
          { value: 'en', label: 'English' },
          { value: 'de', label: 'Deutsch' },
        ],
      },
    ]);
    if (answer) patch(answer);
  });

  $('#password').addEventListener('click', async () => {
    const answer = await formDialog(tr('adm.setPassword'), [
      { key: 'password', label: tr('set.passwordNew'), type: 'password', required: true },
    ]);
    if (answer) patch({ password: answer.password });
  });

  $('#premium').addEventListener('click', async () => {
    const answer = await formDialog(tr('adm.premium'), [
      { key: 'premium_days', label: tr('common.days'), type: 'number', min: 0, max: 3650, value: 30 },
    ]);
    if (answer) patch({ premium_days: Number(answer.premium_days) });
  });

  $('#block').addEventListener('click', () => patch({ blocked: !user.blocked }));
  $('#role').addEventListener('click', () => patch({ role: user.role === 'admin' ? 'user' : 'admin' }));
  $('#verify')?.addEventListener('click', () => patch({ email_verified: true }));

  $('#stop').addEventListener('click', async () => {
    await api(`/admin/users/${id}/stop-bots`, { method: 'POST' }).catch(fail);
    ok(tr('adm.saved'));
  });
  $('#logout').addEventListener('click', async () => {
    if (!(await confirmDialog(tr('adm.logoutUser')))) return;
    await api(`/admin/users/${id}/logout`, { method: 'POST' }).catch(fail);
    ok(tr('adm.saved'));
  });

  $('#impersonate').addEventListener('click', async () => {
    if (!(await confirmDialog(tr('adm.impersonate'), { danger: false }))) return;
    try {
      await api(`/admin/users/${id}/impersonate`, { method: 'POST' });
      location.hash = '#/';
      location.reload();
    } catch (error) {
      fail(error);
    }
  });

  $('#save-notes').addEventListener('click', () =>
    patch({ notes: $('#notes').value, proxy_allowance: Number($('#allowance').value) })
  );

  bindAdminSwitches('[data-discord-role]', (field, enabled) => patch({ [field]: enabled }));
  $$('[data-account-suspend]').forEach((button) => {
    const account = data.accounts.find((entry) => entry.id === Number(button.dataset.accountSuspend));
    button.addEventListener('click', () => changeAccountSuspension(account));
  });

  $$('[data-extend]').forEach((button) =>
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await api(`/admin/profiles/${button.dataset.extend}`, {
        method: 'PATCH',
        body: { extend_days: 30 },
      }).catch(fail);
      ok(tr('adm.saved'));
      draw();
    })
  );

  $$('[data-server]').forEach((row) =>
    row.addEventListener('click', () => go(`/admin/servers/${row.dataset.server}`))
  );
  $$('[data-ticket]').forEach((row) =>
    row.addEventListener('click', () => go(`/admin/tickets/${row.dataset.ticket}`))
  );
}

// ---------------------------------------------------------------- Serverplätze

async function servers(root) {
  const data = await api('/admin/profiles');
  root.innerHTML = panel(
    `${data.profiles.length} ${tr('adm.profiles')}`,
    table(
      ['#', tr('common.name'), tr('adm.users'), tr('srv.address'), tr('srv.plan'), tr('common.month'), '', ''],
      data.profiles.map(
        (profile) => `<tr data-open="${profile.id}" style="cursor:pointer">
          <td class="mono small muted">${profile.id}</td>
          <td>${escapeHtml(profile.name)}</td>
          <td class="small"><a href="#/admin/users/${profile.user_id}">${escapeHtml(profile.username)}</a></td>
          <td class="mono small">${escapeHtml(profile.address)}</td>
          <td class="small">${escapeHtml(profile.plan || '–')}</td>
          <td class="small muted">${profile.paid_until ? date(profile.paid_until) : '–'}</td>
          <td>${
            profile.locked
              ? `<span class="pill missing">${escapeHtml(tr('adm.serverSuspended'))}</span>`
              : profile.suspended
              ? `<span class="pill missing">${escapeHtml(tr('adm.billingSuspended'))}</span>`
              : `<span class="pill ${profile.online ? 'primary' : ''}">${profile.online}</span>`
          }</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-sm" data-extend="${profile.id}">+30 d</button>
            <button class="btn btn-ghost btn-sm btn-danger" data-del="${profile.id}">${icon('trash')}</button>
          </td>
        </tr>`
      )
    )
  );

  $$('[data-open]').forEach((row) =>
    row.addEventListener('click', () => go(`/admin/servers/${row.dataset.open}`))
  );
  $$('[data-extend]').forEach((button) =>
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await api(`/admin/profiles/${button.dataset.extend}`, { method: 'PATCH', body: { extend_days: 30 } })
        .then(() => ok(tr('adm.saved')))
        .catch(fail);
      draw();
    })
  );
  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      await api(`/admin/profiles/${button.dataset.del}`, { method: 'DELETE' }).catch(fail);
      draw();
    })
  );
}

/**
 * Ein Serverplatz aus der Sicht des Betreibers.
 *
 * Dasselbe, was der Kunde sieht – Konten, Zustand, Chat – und dazu, was ihn nichts angeht: wem er
 * gehört, was er verbraucht, wo er liegt, und die Konsole. Wer meldet, dass ein Bot nicht mehr
 * mitkommt, ist damit in einer Minute geholfen statt in einem Hin und Her aus Rückfragen.
 */
async function serverDetail(root, id) {
  const data = await api(`/admin/servers/${id}`);
  const profile = data.profile;

  root.innerHTML = `
    <div class="row wrap spread" style="margin-bottom:1.25rem">
      <div>
        <h2 style="font-size:1.4rem">${escapeHtml(profile.name)}
          ${profile.locked ? `<span class="pill missing">${escapeHtml(tr('adm.locked'))}</span>` : ''}
          ${profile.suspended ? `<span class="pill missing">${escapeHtml(tr('adm.billingSuspended'))}</span>` : ''}</h2>
        <p class="small muted mono">${escapeHtml(profile.address)} · MC ${escapeHtml(profile.mc_version)} ·
          <a href="#/admin/users/${data.owner?.id}">${escapeHtml(data.owner?.username || '')}</a></p>
      </div>
      <div class="row wrap">
        <a class="btn btn-sm" href="#/admin/servers">${escapeHtml(tr('common.back'))}</a>
        <button class="btn btn-sm" id="start" ${profile.locked || profile.suspended ? 'disabled' : ''}>
          ${icon('play')} ${escapeHtml(tr('srv.startAll'))}</button>
        <button class="btn btn-sm" id="stop">${icon('stop')} ${escapeHtml(tr('srv.stopAll'))}</button>
        <button class="btn btn-sm" id="restart" ${profile.locked || profile.suspended ? 'disabled' : ''}>
          ${icon('refresh')}</button>
        <button class="btn btn-sm ${profile.locked ? '' : 'btn-danger'}" id="lock">
          ${icon(profile.locked ? 'unlock' : 'lock')} ${escapeHtml(profile.locked ? tr('adm.unlock') : tr('adm.lock'))}</button>
      </div>
    </div>

    ${
      profile.locked && profile.lock_reason
        ? `<div class="note bad" style="margin-bottom:1.25rem">${icon('lock')}
            <div>${escapeHtml(profile.lock_reason)}</div></div>`
        : ''
    }

    <div class="grid four" style="margin-bottom:1.5rem">
      ${stat(tr('srv.plan'), escapeHtml(data.plan.name), `${credits(data.monthly_credits)} · ${euro(data.monthly_credits)}`)}
      ${stat(
        tr('common.status'),
        profile.days_left === null ? tr('common.forever') : tr('srv.daysLeft', { n: profile.days_left }),
        profile.paid_until ? date(profile.paid_until) : ''
      )}
      ${stat(tr('adm.ram'), bytes(data.usage.rss), `${data.usage.bots} ${tr('adm.botProc')}`)}
      ${stat(tr('adm.cpu'), `${(data.usage.cpu_percent || 0).toFixed(1)} %`, `${tr('adm.disk')}: ${bytes(data.usage.disk)}`)}
    </div>

    <div class="split">
      <section class="panel">
        <header><h3>${escapeHtml(tr('ov.col.account'))}</h3>
          <span class="small muted">${data.accounts.filter((a) => a.online).length}/${data.features.max_accounts}</span>
        </header>
        <div class="body" style="padding:0">
          <ul class="botlist">
            ${
              data.accounts
                .map(
                  (account) => `<li class="botrow ${account.online ? 'is-on' : ''}">
                    <img class="head" src="${escapeHtml(account.head)}" alt="" loading="lazy">
                    <div class="grow" style="min-width:0">
                      <div class="strong truncate">${escapeHtml(account.name)}</div>
                      <div class="small muted truncate">${escapeHtml(account.state)}
                        ${account.detail ? `· ${escapeHtml(account.detail)}` : ''}
                        ${account.pid ? `· PID ${account.pid}` : ''}</div>
                      ${
                        account.suspended
                          ? `<div class="small" style="color:var(--warn)">${escapeHtml(
                              account.suspend_reason || tr('acc.suspended')
                            )}</div>`
                          : ''
                      }
                    </div>
                    <span class="small muted mono">${account.since ? since(account.since) : '–'}</span>
                    <button class="btn btn-sm ${account.suspended ? '' : 'btn-danger'}"
                      data-account-suspend="${account.account_id}">${escapeHtml(
                        account.suspended ? tr('adm.resumeAccount') : tr('adm.suspendAccount')
                      )}</button>
                  </li>`
                )
                .join('') ||
              `<li class="small muted" style="padding:1.25rem">${escapeHtml(tr('srv.noAccounts'))}</li>`
            }
          </ul>
        </div>
      </section>

      <section class="panel console-panel">
        <header><h3>${escapeHtml(tr('adm.console'))}</h3>
          <label class="check small"><input type="checkbox" id="autoscroll" checked> ${escapeHtml(
            tr('ch.autoscroll')
          )}</label></header>
        <div class="body" style="padding:0;display:flex;flex-direction:column;min-height:0">
          <div class="console grow" id="chat" data-empty="${escapeHtml(tr('srv.chatEmpty'))}"></div>
          <div class="row send-row">
            <input type="text" id="msg" placeholder="${escapeHtml(tr('srv.chatPlaceholder'))} — :board, :menu, /list"
              autocomplete="off">
            <button class="btn btn-primary" id="send">${icon('send')}</button>
          </div>
        </div>
      </section>
    </div>

    <div class="grid two" style="margin-top:1.5rem">
      <section class="panel">
        <header><h3>${escapeHtml(tr('nd.title'))}</h3></header>
        <div class="body stack">
          <div class="row spread">
            <span class="row" style="gap:.5rem">${icon('pin')}${escapeHtml(data.node?.name || '–')}</span>
            <button class="btn btn-sm" id="move">${escapeHtml(tr('nd.change'))}</button>
          </div>
          <hr class="rule">
          <div class="row spread">
            <span class="muted small">${escapeHtml(tr('srv.plan'))}</span>
            <select id="plan" class="mini" style="max-width:12rem">
              ${data.plans
                .map(
                  (plan) =>
                    `<option value="${plan.id}" ${plan.id === data.plan.id ? 'selected' : ''}>${escapeHtml(
                      plan.name
                    )}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="row">
            <button class="btn btn-sm" id="extend">+30 ${escapeHtml(tr('common.days'))}</button>
            <button class="btn btn-sm" id="suspend">${escapeHtml(
              profile.suspended ? tr('adm.resumeBilling') : tr('adm.suspendBilling')
            )}</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('ad.title'))}</h3></header>
        <div class="body stack">
          ${data.all_addons
            .map((addon) => {
              const booked = data.addons.find((entry) => entry.id === addon.id);
              return `<div class="row spread">
                <span>${escapeHtml(addon.name_de)}
                  <span class="small muted">· ${credits(addon.price_credits)}</span></span>
                <input type="number" class="mini" min="0" max="${addon.max_qty}" value="${booked?.qty || 0}"
                  data-addon="${addon.id}" style="max-width:5rem">
              </div>`;
            })
            .join('')}
          <p class="small muted">${escapeHtml(tr('adm.detail'))}: ${escapeHtml(tr('ad.sub'))}</p>
        </div>
      </section>
    </div>`;

  // ------------------------------------------------------------ Konsole

  const box = $('#chat');
  const autoscroll = $('#autoscroll');
  const names = Object.fromEntries(data.accounts.map((account) => [account.account_id, account.name]));
  let lines = [];

  const paint = () => {
    box.innerHTML = mergeLines(lines)
      .slice(-500)
      .map(
        (entry) => `<div class="line ${entry.type}"><span class="t">${new Date(entry.t).toLocaleTimeString()}</span>
          ${
            data.accounts.length > 1 && entry.account_id
              ? `<span class="who">${escapeHtml(names[entry.account_id] || '')}</span>`
              : ''
          }
          <span class="msg">${
            entry.type === 'sent' ? `<span class="tag">${escapeHtml(tr('ch.sent'))}:</span> ` : ''
          }${mcText(entry.text)}</span></div>`
      )
      .join('');
    if (autoscroll.checked) box.scrollTop = box.scrollHeight;
  };

  const load = async () => {
    try {
      const fresh = await api(`/admin/servers/${id}/chat`);
      lines = fresh.lines;
      paint();
    } catch {
      /* beim nächsten Mal wieder */
    }
  };
  await load();

  const send = async () => {
    const text = $('#msg').value.trim();
    if (!text) return;
    $('#msg').value = '';
    try {
      const result = await api(`/admin/servers/${id}/send`, { method: 'POST', body: { text } });
      const failed = (result.results || []).filter((entry) => !entry.ok);
      if (failed.length === (result.results || []).length && failed.length) toast(failed[0].error, 'bad');
      setTimeout(load, 600);
    } catch (error) {
      fail(error);
    }
  };
  $('#send').addEventListener('click', send);
  $('#msg').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send();
  });

  // Die Konsole hängt am selben Live-Kanal wie beim Kunden – aber nur für dessen eigene Bots.
  // Für fremde Serverplätze kommt hier nichts an, deshalb wird zusätzlich nachgeladen.
  const poll = setInterval(() => {
    if (state.route.name !== 'admin' || state.route.tab !== 'servers') return clearInterval(poll);
    load();
  }, 5000);

  // ------------------------------------------------------------ Knöpfe

  for (const [selector, action] of [['#start', 'start'], ['#stop', 'stop'], ['#restart', 'restart']]) {
    $(selector).addEventListener('click', async () => {
      await api(`/admin/servers/${id}/${action}`, { method: 'POST' }).catch(fail);
      ok(tr('adm.saved'));
    });
  }

  $('#lock').addEventListener('click', async () => {
    if (profile.locked) {
      await api(`/admin/servers/${id}/lock`, { method: 'POST', body: { locked: false } }).catch(fail);
      draw();
      return;
    }
    const answer = await formDialog(
      tr('adm.lock'),
      [{ key: 'reason', label: tr('adm.lockReason'), required: true }],
      { submit: tr('adm.lock') }
    );
    if (!answer) return;
    await api(`/admin/servers/${id}/lock`, {
      method: 'POST',
      body: { locked: true, reason: answer.reason },
    }).catch(fail);
    draw();
  });

  $('#extend').addEventListener('click', async () => {
    await api(`/admin/profiles/${id}`, { method: 'PATCH', body: { extend_days: 30 } }).catch(fail);
    ok(tr('adm.saved'));
    draw();
  });

  $('#suspend').addEventListener('click', async () => {
    await api(`/admin/profiles/${id}`, {
      method: 'PATCH',
      body: { suspended: !profile.suspended },
    }).catch(fail);
    draw();
  });

  $$('[data-account-suspend]').forEach((button) => {
    const account = data.accounts.find((entry) => entry.account_id === Number(button.dataset.accountSuspend));
    button.addEventListener('click', () => changeAccountSuspension(account));
  });

  $('#plan').addEventListener('change', async (event) => {
    await api(`/admin/profiles/${id}`, {
      method: 'PATCH',
      body: { plan_id: Number(event.target.value) },
    }).catch(fail);
    ok(tr('adm.saved'));
    draw();
  });

  $('#move').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('nd.change'),
      [
        {
          key: 'node_id',
          label: tr('nd.title'),
          type: 'select',
          value: String(data.node?.id || ''),
          options: data.nodes.map((node) => ({ value: String(node.id), label: node.name })),
        },
      ],
      { submit: tr('nd.change') }
    );
    if (!answer) return;
    await api(`/admin/servers/${id}/node`, {
      method: 'POST',
      body: { node_id: Number(answer.node_id) },
    }).catch(fail);
    draw();
  });

  $$('[data-addon]').forEach((input) =>
    input.addEventListener('change', async () => {
      try {
        await api(`/admin/servers/${id}/addons`, {
          method: 'POST',
          body: { addon_id: Number(input.dataset.addon), qty: Number(input.value) },
        });
        ok(tr('adm.saved'));
      } catch (error) {
        fail(error);
      }
    })
  );
}

async function accounts(root) {
  const data = await api('/admin/accounts');
  root.innerHTML = panel(
    `${data.accounts.length} ${tr('adm.accounts')}`,
    table(
      [tr('adm.users'), tr('ov.col.account'), tr('adm.servers'), tr('common.status'), tr('common.created'), ''],
      data.accounts.map(
        (account) => `<tr>
          <td class="small"><a href="#/admin/users/${account.user_id}">${escapeHtml(account.username || '')}</a></td>
          <td><span class="strong">${escapeHtml(account.name || '')}</span>
            <span class="small muted"> · ${escapeHtml(accountKindLabel(account.kind))}</span></td>
          <td class="small">${
            account.servers.length
              ? account.servers
                  .map((server) => `<a href="#/admin/servers/${server.id}">${escapeHtml(server.name)}</a>`)
                  .join(', ')
              : '–'
          }</td>
          <td class="small">${
            account.suspended
              ? `<span class="pill missing">${escapeHtml(tr('acc.suspended'))}</span>
                 ${account.suspend_reason ? `<span class="muted">${escapeHtml(account.suspend_reason)}</span>` : ''}`
              : account.running
                ? `<span class="pill primary">${escapeHtml(tr('state.online'))} ${account.online}/${account.running}</span>`
                : `<span class="pill ${account.status === 'error' ? 'missing' : ''}">${escapeHtml(
                    accountStatusLabel(account.status)
                  )}</span>
                   ${account.last_error ? `<span class="muted">${escapeHtml(account.last_error)}</span>` : ''}`
          }</td>
          <td class="mono small muted">${datetime(account.created_at)}</td>
          <td style="text-align:right"><button class="btn btn-sm ${account.suspended ? '' : 'btn-danger'}"
            data-account-suspend="${account.id}">${escapeHtml(
              account.suspended ? tr('adm.resumeAccount') : tr('adm.suspendAccount')
            )}</button></td>
        </tr>`
      )
    )
  );

  $$('[data-account-suspend]').forEach((button) => {
    const account = data.accounts.find((entry) => entry.id === Number(button.dataset.accountSuspend));
    button.addEventListener('click', () => changeAccountSuspension(account));
  });
}

// ---------------------------------------------------------------- Standorte

async function nodes(root) {
  const data = await api('/admin/nodes');
  const { users: userList } = await api('/admin/users?filter=all');

  root.innerHTML = `
    <div class="row wrap spread" style="margin-bottom:1rem;gap:1rem">
      <p class="small muted" style="margin:0;max-width:46rem">${escapeHtml(tr('nd.sub'))}
        ${escapeHtml(tr('adm.detail'))}: <span class="mono">docs/standorte.md</span></p>
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('common.create'))}</button>
    </div>

    <div class="grid two">
      ${data.nodes
        .map(
          (node) => `<article class="card node-card ${node.active ? '' : 'is-off'}">
            <div class="row spread" style="align-items:flex-start">
              <div style="min-width:0">
                <div class="row" style="gap:.5rem">${icon('pin')}
                  <span class="strong">${escapeHtml(node.name)}</span>
                  ${node.kind === 'local' ? `<span class="pill">${escapeHtml(tr('nd.main'))}</span>` : ''}
                  ${node.full ? `<span class="pill missing">${escapeHtml(tr('nd.full'))}</span>` : ''}
                  ${node.active ? '' : `<span class="pill missing">${escapeHtml(tr('srv.off'))}</span>`}</div>
                <p class="small muted" style="margin:.4rem 0 0">${escapeHtml(node.note || '')}</p>
              </div>
              <span class="pill">${escapeHtml(tr(`nd.access.${node.access}`))}</span>
            </div>

            <dl class="facts" style="margin-top:1rem">
              <div><dt>${escapeHtml(tr('adm.profiles'))}</dt>
                <dd>${node.usage.profiles}${node.max_profiles ? ` / ${node.max_profiles}` : ''}</dd></div>
              <div><dt>${escapeHtml(tr('adm.bots'))}</dt>
                <dd>${node.usage.bots_running}${node.max_bots ? ` / ${node.max_bots}` : ''}</dd></div>
              <div><dt>${escapeHtml(tr('px.title'))}</dt>
                <dd class="mono small">${
                  node.proxy ? `${escapeHtml(node.proxy.kind)}://${escapeHtml(node.proxy.host)}:${node.proxy.port}` : '–'
                }</dd></div>
              <div><dt>${escapeHtml(tr('adm.users'))}</dt>
                <dd class="small">${
                  node.access === 'listed'
                    ? escapeHtml(node.users.map((user) => user.username).join(', ') || '–')
                    : escapeHtml(tr(`nd.access.${node.access}`))
                }</dd></div>
            </dl>

            <div class="row" style="margin-top:1rem">
              <button class="btn btn-sm" data-edit="${node.id}">${escapeHtml(tr('common.edit'))}</button>
              ${
                node.kind === 'local'
                  ? ''
                  : `<button class="btn btn-ghost btn-sm btn-danger" data-del="${node.id}">${icon('trash')}</button>`
              }
            </div>
          </article>`
        )
        .join('')}
    </div>`;

  const fields = (node = {}) => [
    { key: 'name', label: tr('common.name'), value: node.name || '', required: true },
    { key: 'region', label: 'Region', value: node.region || '', placeholder: 'Falkenstein' },
    {
      key: 'proxy_id',
      label: tr('px.title'),
      type: 'select',
      value: String(node.proxy_id || ''),
      hint: tr('nd.sub'),
      options: [
        { value: '', label: '–' },
        ...data.proxies.map((proxy) => ({
          value: String(proxy.id),
          label: `${proxy.label} · ${proxy.kind}://${proxy.host}:${proxy.port}`,
        })),
      ],
    },
    { key: 'max_profiles', label: tr('adm.profiles'), type: 'number', min: 0, value: node.max_profiles ?? 0 },
    { key: 'max_bots', label: tr('adm.bots'), type: 'number', min: 0, value: node.max_bots ?? 0 },
    {
      key: 'access',
      label: tr('nd.access.all'),
      type: 'select',
      value: node.access || 'all',
      options: data.access.map((value) => ({ value, label: tr(`nd.access.${value}`) })),
    },
    {
      key: 'users',
      label: tr('adm.users'),
      hint: `${tr('nd.access.listed')} — IDs, Komma getrennt`,
      value: (node.users || []).map((user) => user.id).join(', '),
    },
    { key: 'note', label: tr('common.edit'), value: node.note || '' },
    { key: 'active', label: tr('srv.on'), type: 'checkbox', value: node.active !== false },
  ];

  const shape = (answer) => ({
    ...numbers(answer),
    proxy_id: answer.proxy_id ? Number(answer.proxy_id) : null,
    users: String(answer.users || '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number),
  });

  $('#new').addEventListener('click', async () => {
    const answer = await formDialog(tr('common.create'), fields(), {
      submit: tr('common.create'),
      note: `${tr('nd.sub')} ${userList.length} ${tr('adm.users')}.`,
    });
    if (!answer) return;
    try {
      await api('/admin/nodes', { method: 'POST', body: shape(answer) });
      ok(tr('adm.saved'));
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $$('[data-edit]').forEach((button) =>
    button.addEventListener('click', async () => {
      const node = data.nodes.find((entry) => entry.id === Number(button.dataset.edit));
      const answer = await formDialog(node.name, fields(node));
      if (!answer) return;
      try {
        await api(`/admin/nodes/${node.id}`, { method: 'PATCH', body: shape(answer) });
        ok(tr('adm.saved'));
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      try {
        await api(`/admin/nodes/${button.dataset.del}`, { method: 'DELETE' });
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );
}

// ---------------------------------------------------------------- Tarife

/**
 * Die Ja/Nein-Merkmale eines Tarifs, mit dem Satz, was sie bewirken.
 *
 * Vorher stand hier der reine Spaltenname als Beschriftung ("offline_accounts", "chat_limit_
 * editable") – wer den Tarif ändern wollte, musste raten oder in der Datenbank nachsehen.
 */
const PLAN_FLAGS = [
  ['free_slot', 'Der kostenlose Platz (genau ein Tarif)'],
  ['premium', 'Premium-Client: Bewegung, Anti-AFK, Schleichen'],
  ['movement', 'Reiter "Bewegung" im Panel'],
  ['proxy', 'Eigene Ausgangsadresse auf Anfrage'],
  ['offline_accounts', 'Offline-/Cracked-Konten erlaubt'],
  ['chat_limit_editable', 'Chatverlauf selbst einstellbar'],
  ['priority_support', 'Support-Vorrang'],
  ['board', 'Scoreboard'],
  ['menus', 'Menüs bedienen'],
  ['pov', 'Live-Ansicht (POV)'],
  ['addons', 'Zusätze buchbar'],
  ['highlight', 'Auf der Preisseite hervorheben'],
  ['active', 'Buchbar'],
];
const PLAN_FLAG_KEYS = PLAN_FLAGS.map(([key]) => key);

async function plans(root) {
  const data = await api('/admin/plans');
  root.innerHTML = `
    <div class="row wrap spread" style="margin-bottom:1rem;gap:1rem">
      <p class="small muted" style="margin:0;max-width:46rem">${escapeHtml(tr('pricing.lead'))}</p>
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('common.create'))}</button>
    </div>
    ${panel(
      tr('adm.plans'),
      table(
        ['#', tr('common.name'), tr('common.credits'), tr('pricing.bots'), tr('pricing.chatHistory'), '', ''],
        data.plans.map(
          (plan) => `<tr>
            <td class="mono small muted">${escapeHtml(plan.slug)}</td>
            <td>${escapeHtml(plan.name_en)} <span class="small muted">/ ${escapeHtml(plan.name_de)}</span>
              ${plan.highlight ? `<span class="pill primary">★</span>` : ''}</td>
            <td class="mono">${plan.free_slot ? escapeHtml(tr('common.free')) : credits(plan.price_credits)}
              <span class="small muted">${plan.free_slot ? '' : euro(plan.price_credits)}</span></td>
            <td class="small">${plan.max_accounts}</td>
            <td class="small">${plan.chat_limit}${plan.chat_limit_editable ? ' ✎' : ''}</td>
            <td class="small">${PLAN_FLAG_KEYS.filter((flag) => plan[flag])
              .map((flag) => `<span class="pill">${escapeHtml(flag)}</span>`)
              .join(' ')}</td>
            <td style="text-align:right;white-space:nowrap">
              <span class="small muted">${plan.in_use}×</span>
              <button class="btn btn-sm" data-edit="${plan.id}">${escapeHtml(tr('common.edit'))}</button>
              <button class="btn btn-ghost btn-sm btn-danger" data-del="${plan.id}">${icon('trash')}</button>
            </td>
          </tr>`
        )
      )
    )}`;

  const fields = (plan = {}) => [
    { key: 'name_de', label: 'Name (DE)', value: plan.name_de || '', required: true },
    { key: 'name_en', label: 'Name (EN)', value: plan.name_en || '', required: true },
    {
      key: 'blurb_de',
      label: 'Beschreibung (DE)',
      type: 'textarea',
      value: plan.blurb_de || '',
      hint: 'Ein Satz, für wen der Tarif gedacht ist. Steht auf der Preisseite unter dem Namen.',
    },
    { key: 'blurb_en', label: 'Beschreibung (EN)', type: 'textarea', value: plan.blurb_en || '' },
    // Der Wortlaut der Merkmalsliste auf der Preisseite. Leer = die Liste baut sich aus den
    // Zahlen dieses Tarifs zusammen (siehe planLines in server/landing.js).
    {
      key: 'features_de',
      label: 'Merkmale auf der Preisseite (DE)',
      type: 'textarea',
      value: plan.features_de || '',
      hint: 'Eine Zeile je Punkt. Leer lassen heißt: die Liste wird aus den Zahlen unten gebaut.',
    },
    {
      key: 'features_en',
      label: 'Merkmale auf der Preisseite (EN)',
      type: 'textarea',
      value: plan.features_en || '',
      hint: 'One line per bullet. Empty means the list is built from the numbers below.',
    },
    { key: 'price_credits', label: `${tr('common.credits')} / 30 d`, type: 'number', min: 0, value: plan.price_credits ?? 0 },
    { key: 'max_accounts', label: tr('pricing.bots'), type: 'number', min: 1, value: plan.max_accounts ?? 1 },
    { key: 'chat_limit', label: tr('pricing.chatHistory'), type: 'number', min: 20, value: plan.chat_limit ?? 200 },
    { key: 'max_macros', label: 'Macros', type: 'number', min: 0, value: plan.max_macros ?? 20 },
    { key: 'sort', label: tr('common.status'), type: 'number', min: 0, value: plan.sort ?? 50 },
    {
      key: 'discord_role',
      label: 'Discord-Rolle',
      value: plan.discord_role || '',
      hint: 'Rollen-ID. Leer = die Rolle aus den Einstellungen.',
    },
    ...PLAN_FLAGS.map(([flag, label]) => ({
      key: flag,
      label,
      type: 'checkbox',
      value: Boolean(plan[flag]),
    })),
  ];

  $('#new').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('common.create'),
      [{ key: 'slug', label: 'slug', required: true }, ...fields()],
      { submit: tr('common.create') }
    );
    if (!answer) return;
    try {
      await api('/admin/plans', { method: 'POST', body: numbers(answer) });
      ok(tr('adm.saved'));
      state.meta = await api('/meta');
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $$('[data-edit]').forEach((button) =>
    button.addEventListener('click', async () => {
      const plan = data.plans.find((entry) => entry.id === Number(button.dataset.edit));
      const answer = await formDialog(plan.slug, fields(plan));
      if (!answer) return;
      try {
        await api(`/admin/plans/${plan.id}`, { method: 'PATCH', body: numbers(answer) });
        ok(tr('adm.saved'));
        state.meta = await api('/meta');
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      try {
        await api(`/admin/plans/${button.dataset.del}`, { method: 'DELETE' });
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );
}

// ---------------------------------------------------------------- Zusätze

async function addons(root) {
  const data = await api('/admin/addons');
  root.innerHTML = `
    <div class="row wrap spread" style="margin-bottom:1rem;gap:1rem">
      <p class="small muted" style="margin:0;max-width:46rem">${escapeHtml(tr('ad.sub'))}</p>
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('common.create'))}</button>
    </div>
    ${panel(
      tr('adm.addons'),
      table(
        ['#', tr('common.name'), tr('common.credits'), 'kind', 'flag', tr('common.status'), ''],
        data.addons.map(
          (addon) => `<tr>
            <td class="mono small muted">${escapeHtml(addon.key)}</td>
            <td>${escapeHtml(addon.name_de)} <span class="small muted">/ ${escapeHtml(addon.name_en)}</span></td>
            <td class="mono">${credits(addon.price_credits)}
              <span class="small muted">${euro(addon.price_credits)}</span></td>
            <td class="small">${escapeHtml(addon.kind)}${addon.max_qty > 1 ? ` ×${addon.max_qty}` : ''}</td>
            <td class="small mono muted">${escapeHtml(addon.flag || '–')}
              ${
                addon.need_cap
                  ? `<span class="pill ${data.caps[addon.need_cap] ? '' : 'missing'}">${escapeHtml(
                      addon.need_cap
                    )}</span>`
                  : ''
              }</td>
            <td>
              <span class="pill ${addon.active ? '' : 'missing'}">${addon.active ? 'aktiv' : 'aus'}</span>
              ${addon.available ? '' : `<span class="pill missing">${escapeHtml(tr('ad.soon'))}</span>`}
              <span class="small muted">${addon.in_use}×</span>
            </td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-sm" data-edit="${addon.id}">${escapeHtml(tr('common.edit'))}</button>
              <button class="btn btn-ghost btn-sm btn-danger" data-del="${addon.id}">${icon('trash')}</button>
            </td>
          </tr>`
        )
      )
    )}`;

  const fields = (addon = {}) => [
    { key: 'key', label: 'Kürzel', value: addon.key || '', required: true, hint: 'a–z, 0–9 und -' },
    { key: 'name_de', label: 'Name (DE)', value: addon.name_de || '', required: true },
    { key: 'name_en', label: 'Name (EN)', value: addon.name_en || '' },
    { key: 'text_de', label: 'Text (DE)', type: 'textarea', value: addon.text_de || '' },
    { key: 'text_en', label: 'Text (EN)', type: 'textarea', value: addon.text_en || '' },
    { key: 'price_credits', label: `${tr('common.credits')} / 30 d`, type: 'number', min: 0, value: addon.price_credits ?? 0 },
    {
      key: 'kind',
      label: 'Art',
      type: 'select',
      value: addon.kind || 'flag',
      options: [
        { value: 'flag', label: 'Merkmal einschalten' },
        { value: 'slot', label: 'Mehr Bots' },
      ],
    },
    {
      key: 'flag',
      label: 'Merkmal',
      value: addon.flag || '',
      hint: 'board · menus · pov · movement · proxy · fakehost · offline_accounts',
    },
    { key: 'amount', label: 'Wie viel je Stück', type: 'number', min: 1, value: addon.amount ?? 1 },
    { key: 'max_qty', label: 'Höchstens', type: 'number', min: 1, value: addon.max_qty ?? 1 },
    { key: 'need_cap', label: 'Braucht Client-Fähigkeit', value: addon.need_cap || '' },
    { key: 'sort', label: tr('common.status'), type: 'number', min: 0, value: addon.sort ?? 50 },
    { key: 'available', label: 'Buchbar', type: 'checkbox', value: addon.available !== 0 },
    { key: 'active', label: 'Sichtbar', type: 'checkbox', value: addon.active !== 0 },
  ];

  $('#new').addEventListener('click', async () => {
    const answer = await formDialog(tr('common.create'), fields(), { submit: tr('common.create') });
    if (!answer) return;
    try {
      await api('/admin/addons', { method: 'POST', body: numbers(answer) });
      ok(tr('adm.saved'));
      state.meta = await api('/meta');
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $$('[data-edit]').forEach((button) =>
    button.addEventListener('click', async () => {
      const addon = data.addons.find((entry) => entry.id === Number(button.dataset.edit));
      const answer = await formDialog(addon.key, fields(addon));
      if (!answer) return;
      try {
        await api(`/admin/addons/${addon.id}`, { method: 'PATCH', body: numbers(answer) });
        ok(tr('adm.saved'));
        state.meta = await api('/meta');
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      try {
        await api(`/admin/addons/${button.dataset.del}`, { method: 'DELETE' });
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );
}

// ---------------------------------------------------------------- Aufladungen und Gutscheine

async function topups(root) {
  const data = await api('/admin/topups');
  root.innerHTML = panel(
    tr('adm.topups'),
    table(
      ['#', tr('adm.users'), tr('bill.method'), tr('common.credits'), tr('bill.reference'), tr('common.status'), ''],
      data.topups.map(
        (topup) => `<tr>
          <td class="mono small muted">${topup.id}</td>
          <td class="small"><a href="#/admin/users/${topup.user_id}">${escapeHtml(topup.username)}</a></td>
          <td class="small">${escapeHtml(topup.provider)}</td>
          <td class="mono">${credits(topup.credits)} <span class="small muted">${euro(topup.amount_cent)}</span></td>
          <td class="mono small">${escapeHtml(topup.reference || '–')}</td>
          <td><span class="pill ${topup.status === 'open' ? 'missing' : ''}">${escapeHtml(topup.status)}</span></td>
          <td style="text-align:right;white-space:nowrap">
            ${
              topup.status === 'open'
                ? `<button class="btn btn-sm btn-primary" data-settle="${topup.id}">${escapeHtml(
                    tr('common.yes')
                  )}</button>
                   <button class="btn btn-sm" data-cancel="${topup.id}">${escapeHtml(tr('common.cancel'))}</button>`
                : `<span class="small muted mono">${topup.paid_at ? datetime(topup.paid_at) : ''}</span>`
            }
          </td>
        </tr>`
      )
    )
  );

  $$('[data-settle]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api(`/admin/topups/${button.dataset.settle}/settle`, { method: 'POST' })
        .then(() => ok(tr('adm.saved')))
        .catch(fail);
      draw();
    })
  );
  $$('[data-cancel]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api(`/admin/topups/${button.dataset.cancel}/cancel`, { method: 'POST' }).catch(fail);
      draw();
    })
  );
}

async function vouchers(root) {
  const data = await api('/admin/vouchers');
  root.innerHTML = `
    <div class="row" style="margin-bottom:1rem">
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('common.create'))}</button>
    </div>
    ${panel(
      tr('adm.vouchers'),
      table(
        ['Code', tr('common.credits'), tr('common.status'), '', ''],
        data.vouchers.map(
          (voucher) => `<tr>
            <td class="mono strong">${escapeHtml(voucher.code)}</td>
            <td class="mono">${credits(voucher.credits)}
              <span class="small muted">${euro(voucher.credits)}</span></td>
            <td class="small muted">${
              // In der Datenbank steht, wie viele Einlösungen **übrig** sind – nicht, wie viele
              // schon waren. Die frühere Anzeige "used/uses" gab es nirgends und blieb leer.
              voucher.uses_left > 0
                ? `${voucher.uses_left}× ${tr('common.open')}`
                : `<span class="pill missing">${tr('bill.voucher')}</span>`
            }${voucher.expires_at ? ` · ${date(voucher.expires_at)}` : ''}</td>
            <td class="small muted">${escapeHtml(voucher.note || '')}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(voucher.code)}">${icon('copy')}</button>
              <button class="btn btn-ghost btn-sm btn-danger" data-del="${escapeHtml(voucher.code)}">${icon(
                'trash'
              )}</button>
            </td>
          </tr>`
        )
      )
    )}`;

  $('#new').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('common.create'),
      [
        { key: 'credits', label: tr('common.credits'), type: 'number', min: 1, value: 500, required: true },
        { key: 'count', label: 'Wie viele Codes', type: 'number', min: 1, max: 50, value: 1 },
        { key: 'uses', label: 'Einlösungen je Code', type: 'number', min: 1, value: 1 },
        { key: 'expires_days', label: `${tr('common.days')} (0 = nie)`, type: 'number', min: 0, value: 0 },
        { key: 'note', label: tr('common.edit'), value: '' },
      ],
      { submit: tr('common.create') }
    );
    if (!answer) return;
    try {
      const result = await api('/admin/vouchers', { method: 'POST', body: numbers(answer) });
      await copy(result.vouchers.map((voucher) => voucher.code).join('\n'));
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $$('[data-copy]').forEach((button) => button.addEventListener('click', () => copy(button.dataset.copy)));
  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      await api(`/admin/vouchers/${button.dataset.del}`, { method: 'DELETE' }).catch(fail);
      draw();
    })
  );
}

// ---------------------------------------------------------------- Proxys

async function proxies(root) {
  const data = await api('/admin/proxies');
  const userList = await api('/admin/users?filter=all');

  root.innerHTML = `
    <div class="row wrap spread" style="margin-bottom:1rem;gap:1rem">
      <p class="small muted" style="margin:0;max-width:46rem">${escapeHtml(tr('px.requestNote'))}
        ${escapeHtml(tr('adm.detail'))}: <span class="mono">docs/standorte.md</span></p>
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('common.create'))}</button>
    </div>
    ${panel(
      tr('adm.proxies'),
      table(
        ['#', tr('common.name'), 'Host', tr('adm.users'), '', ''],
        data.proxies.map(
          (proxy) => `<tr>
            <td class="mono small muted">${proxy.id}</td>
            <td>${escapeHtml(proxy.label)}</td>
            <td class="mono small">${escapeHtml(proxy.kind)}://${escapeHtml(proxy.host)}:${proxy.port}</td>
            <td class="small">${
              proxy.assigned_to
                ? `<a href="#/admin/users/${proxy.assigned_to}">${escapeHtml(proxy.assigned_name || '')}</a>`
                : `<span class="muted">–</span>`
            }</td>
            <td class="small muted">${proxy.in_use}× ${escapeHtml(proxy.note || '')}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-sm" data-edit="${proxy.id}">${escapeHtml(tr('common.edit'))}</button>
              <button class="btn btn-ghost btn-sm btn-danger" data-del="${proxy.id}">${icon('trash')}</button>
            </td>
          </tr>`
        )
      )
    )}`;

  const fields = (proxy = {}) => [
    { key: 'label', label: tr('common.name'), value: proxy.label || '', required: true },
    {
      key: 'address',
      label: 'host:port',
      value: proxy.host ? `${proxy.host}:${proxy.port}` : '',
      required: true,
    },
    {
      key: 'kind',
      label: 'Typ',
      type: 'select',
      value: proxy.kind || 'socks5',
      options: ['socks5', 'socks4', 'http'],
    },
    { key: 'username', label: tr('auth.register.username'), value: proxy.username || '' },
    { key: 'password', label: tr('auth.login.password'), type: 'password', value: '', hint: tr('adm.secretKeep') },
    {
      key: 'assigned_to',
      label: tr('adm.users'),
      type: 'select',
      value: String(proxy.assigned_to || ''),
      options: [
        { value: '', label: '–' },
        ...userList.users.map((user) => ({ value: String(user.id), label: user.username })),
      ],
    },
    { key: 'note', label: tr('common.edit'), value: proxy.note || '' },
  ];

  const shape = (answer) => {
    const body = { ...answer, assigned_to: answer.assigned_to ? Number(answer.assigned_to) : null };
    // Leeres Passwortfeld heißt "nicht angefasst" – sonst löschte jedes Speichern die Zugangsdaten.
    if (!body.password) delete body.password;
    return body;
  };

  $('#new').addEventListener('click', async () => {
    const answer = await formDialog(tr('common.create'), fields(), { submit: tr('common.create') });
    if (!answer) return;
    try {
      await api('/admin/proxies', { method: 'POST', body: shape(answer) });
      ok(tr('adm.saved'));
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $$('[data-edit]').forEach((button) =>
    button.addEventListener('click', async () => {
      const proxy = data.proxies.find((entry) => entry.id === Number(button.dataset.edit));
      const answer = await formDialog(proxy.label, fields(proxy));
      if (!answer) return;
      try {
        await api(`/admin/proxies/${proxy.id}`, { method: 'PATCH', body: shape(answer) });
        ok(tr('adm.saved'));
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      await api(`/admin/proxies/${button.dataset.del}`, { method: 'DELETE' }).catch(fail);
      draw();
    })
  );
}

// ---------------------------------------------------------------- Ankündigungen

async function announcements(root) {
  const data = await api('/admin/announcements');
  root.innerHTML = `
    <div class="row wrap spread" style="margin-bottom:1rem;gap:1rem">
      <p class="small muted" style="margin:0;max-width:46rem">
        ${escapeHtml(tr('set.notifySub'))} — ${data.recipients} ${escapeHtml(tr('adm.users'))}.</p>
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('common.create'))}</button>
    </div>
    <div class="stack">
      ${
        data.announcements
          .map(
            (entry) => `<article class="card">
              <div class="row spread" style="align-items:flex-start">
                <div style="min-width:0">
                  <div class="row" style="gap:.5rem">
                    <span class="pill ${entry.kind === 'info' ? '' : 'missing'}">${escapeHtml(entry.kind)}</span>
                    <span class="strong">${escapeHtml(entry.title_de)}</span>
                    ${entry.active ? `<span class="pill primary">live</span>` : ''}
                  </div>
                  <p class="small muted" style="margin:.5rem 0 0">${escapeHtml(entry.body_de || '')}</p>
                  <p class="small muted" style="margin:.5rem 0 0">
                    ${datetime(entry.created_at)}
                    ${entry.created_by_name ? ` · ${escapeHtml(entry.created_by_name)}` : ''}
                    ${entry.mailed_at ? ` · ${escapeHtml(tr('adm.announceMail'))}: ${datetime(entry.mailed_at)}` : ''}
                  </p>
                </div>
                <span class="switch" role="switch" tabindex="0" aria-checked="${entry.active}"
                  data-toggle="${entry.id}"></span>
              </div>
              <div class="row wrap" style="margin-top:1rem">
                <button class="btn btn-sm" data-edit="${entry.id}">${escapeHtml(tr('common.edit'))}</button>
                <button class="btn btn-sm" data-mail="${entry.id}" ${data.mail_ready ? '' : 'disabled'}>
                  ${icon('mail')} ${escapeHtml(tr('adm.announceMail'))}</button>
                <button class="btn btn-sm" data-test="${entry.id}" ${data.mail_ready ? '' : 'disabled'}>
                  ${escapeHtml(tr('adm.announceTest'))}</button>
                <div class="grow"></div>
                <button class="btn btn-ghost btn-sm btn-danger" data-del="${entry.id}">${icon('trash')}</button>
              </div>
            </article>`
          )
          .join('') || `<p class="small muted">${escapeHtml(tr('common.none'))}</p>`
      }
    </div>`;

  const fields = (entry = {}) => [
    { key: 'title_de', label: 'Titel (DE)', value: entry.title_de || '', required: true },
    { key: 'title_en', label: 'Title (EN)', value: entry.title_en || '' },
    { key: 'body_de', label: 'Text (DE)', type: 'textarea', value: entry.body_de || '' },
    { key: 'body_en', label: 'Text (EN)', type: 'textarea', value: entry.body_en || '' },
    { key: 'link', label: 'Link', value: entry.link || '', placeholder: 'https://…' },
    {
      key: 'kind',
      label: 'Typ',
      type: 'select',
      value: entry.kind || 'info',
      options: ['info', 'warn', 'bad'],
    },
    { key: 'active', label: 'Sichtbar im Panel', type: 'checkbox', value: entry.active !== false },
  ];

  $('#new').addEventListener('click', async () => {
    const answer = await formDialog(tr('common.create'), fields(), { submit: tr('common.create') });
    if (!answer) return;
    await api('/admin/announcements', { method: 'POST', body: answer }).catch(fail);
    state.meta = await api('/meta');
    draw();
  });

  $$('[data-edit]').forEach((button) =>
    button.addEventListener('click', async () => {
      const entry = data.announcements.find((item) => item.id === Number(button.dataset.edit));
      const answer = await formDialog(entry.title_de, fields(entry));
      if (!answer) return;
      await api(`/admin/announcements/${entry.id}`, { method: 'PATCH', body: answer }).catch(fail);
      state.meta = await api('/meta');
      draw();
    })
  );

  $$('[data-mail]').forEach((button) =>
    button.addEventListener('click', async () => {
      const entry = data.announcements.find((item) => item.id === Number(button.dataset.mail));
      const question = entry.mailed_at
        ? tr('adm.announceAgain')
        : `${tr('adm.announceMail')} — ${data.recipients} ${tr('adm.users')}?`;
      if (!(await confirmDialog(question, { confirm: tr('adm.announceMail'), danger: false }))) return;
      button.disabled = true;
      try {
        const result = await api(`/admin/announcements/${entry.id}/mail`, {
          method: 'POST',
          body: { again: Boolean(entry.mailed_at) },
        });
        ok(tr('adm.announceSent', { n: result.sent }));
        draw();
      } catch (error) {
        fail(error);
        button.disabled = false;
      }
    })
  );

  $$('[data-test]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        await api(`/admin/announcements/${button.dataset.test}/mail`, {
          method: 'POST',
          body: { test: true, again: true },
        });
        ok(tr('adm.mailSent'));
      } catch (error) {
        fail(error);
      }
    })
  );

  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      await api(`/admin/announcements/${button.dataset.del}`, { method: 'DELETE' }).catch(fail);
      state.meta = await api('/meta');
      draw();
    })
  );

  $$('[data-toggle]').forEach((node) => {
    const toggle = async () => {
      const next = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(next));
      try {
        await api(`/admin/announcements/${node.dataset.toggle}`, {
          method: 'PATCH',
          body: { active: next },
        });
        state.meta = await api('/meta');
      } catch (error) {
        node.setAttribute('aria-checked', String(!next));
        fail(error);
      }
    };
    node.addEventListener('click', toggle);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  });
}

// ---------------------------------------------------------------- Einstellungen
//
// Das Formular kommt aus der Beschreibung, die der Server mitschickt (settings-schema.js). Damit
// steht jede Beschriftung und jede Erklärung an genau einer Stelle – vorher stand im Frontend eine
// Liste aus Schlüsselnamen ("smtp_pass" als Überschrift) und im Backend eine zweite daneben.
//
// Je Gruppe ein Reiter. Alle neun Gruppen untereinander waren eine Seite, auf der man scrollte,
// bis man vergessen hatte, wonach man suchte; welcher Schalter zu welchem Thema gehört, ließ sich
// nicht mehr sehen.

async function settings(root) {
  const data = await api('/admin/settings');
  const { groups, settings: schema } = data.schema;
  const value = (key) => data.settings[key] ?? '';
  const packages = structuredClone(data.settings.packages || []);

  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const wanted = params.get('group');
  const group = groups.find((entry) => entry.key === wanted) || groups[0];
  const fields = schema.filter((entry) => entry.group === group.key);

  root.innerHTML = `
    <nav class="tabs wrap" style="margin-bottom:1.25rem">
      ${groups
        .map(
          (entry) =>
            `<a class="${entry.key === group.key ? 'active' : ''}"
                href="#/admin/settings?group=${entry.key}">${escapeHtml(entry.title)}</a>`
        )
        .join('')}
    </nav>

    <div class="settings settings-single">
      <section class="setting-card">
        <div class="setting-head">
          <span class="setting-icon">${icon(group.icon)}</span>
          <div>
            <h2>${escapeHtml(group.title)}</h2>
            <p>${escapeHtml(group.text)}</p>
          </div>
        </div>
        <div class="setting-body stack">
          ${fields.map(field).join('')}
          ${group.key === 'mail' ? mailTools() : ''}
          ${group.key === 'discord' ? discordTools(data) : ''}
        </div>
      </section>
    </div>

    <div class="save-bar">
      <button class="btn btn-primary btn-lg" id="save">${escapeHtml(tr('common.save'))}</button>
      <span class="small muted" id="save-hint">${escapeHtml(group.title)}</span>
    </div>`;

  function field(entry) {
    const id = `s-${entry.key}`;
    const help = entry.help ? `<span class="hint">${escapeHtml(entry.help)}</span>` : '';

    if (entry.type === 'switch') {
      return `<label class="switch-row">
        <span class="grow">
          <span class="strong">${escapeHtml(entry.label)}</span>
          ${entry.help ? `<span class="small muted">${escapeHtml(entry.help)}</span>` : ''}
        </span>
        <input type="checkbox" class="visually-hidden" data-set="${entry.key}" ${
          Number(value(entry.key)) ? 'checked' : ''
        }>
        <span class="switch" aria-hidden="true"></span>
      </label>`;
    }

    // Die Aufladepakete sind eine Liste aus Objekten und bekommen deshalb einen eigenen Editor.
    // Ohne diesen Zweig fielen sie in das Textfeld am Ende: dort stand dann "[object Object],
    // [object Object], …", und beim Speichern ging genau dieser Text als `packages` zurück – was
    // der Server zu Recht mit "Pakete müssen eine Liste sein" ablehnte. Danach ließ sich in den
    // Einstellungen überhaupt nichts mehr speichern.
    if (entry.type === 'packages') {
      return `<div class="field">
        <label>${escapeHtml(entry.label)}</label>
        <div class="pack-editor" id="packages"></div>
        <button type="button" class="btn btn-sm" id="add-package" style="align-self:flex-start;margin-top:.6rem">
          ${icon('plus')} ${escapeHtml(tr('common.create'))}</button>
        ${help}
      </div>`;
    }

    if (entry.type === 'password') {
      // Ein Geheimnis kommt nie zurück – das Feld ist deshalb immer leer und sagt nur, ob eines
      // hinterlegt ist. So steht ein Bot-Token nicht im HTML einer Seite, die offen liegen bleibt.
      const set = data.settings.secrets?.[entry.key];
      return `<div class="field">
        <label for="${id}">${escapeHtml(entry.label)}
          <span class="pill ${set ? 'primary' : 'missing'}">${escapeHtml(
            set ? tr('adm.secretSet') : tr('adm.secretUnset')
          )}</span></label>
        <div class="row" style="gap:.4rem">
          <input id="${id}" data-set="${entry.key}" type="password" class="grow" autocomplete="new-password"
            placeholder="${escapeHtml(set ? tr('adm.secretKeep') : '')}">
          <button type="button" class="btn btn-ghost btn-sm" data-peek="${id}"
            title="${escapeHtml(tr('adm.reveal'))}">${icon('eye')}</button>
          ${
            set
              ? `<button type="button" class="btn btn-ghost btn-sm btn-danger" data-clear="${entry.key}"
                  title="${escapeHtml(tr('adm.secretClear'))}">${icon('trash')}</button>`
              : ''
          }
        </div>
        ${help}
      </div>`;
    }

    if (entry.type === 'textarea') {
      return `<div class="field"><label for="${id}">${escapeHtml(entry.label)}</label>
        <textarea id="${id}" data-set="${entry.key}" rows="8">${escapeHtml(value(entry.key))}</textarea>
        ${help}</div>`;
    }

    return `<div class="field"><label for="${id}">${escapeHtml(entry.label)}</label>
      <input id="${id}" data-set="${entry.key}" type="${entry.type === 'number' ? 'number' : 'text'}"
        value="${escapeHtml(value(entry.key))}"
        ${entry.min !== undefined ? `min="${entry.min}"` : ''}
        ${entry.max !== undefined ? `max="${entry.max}"` : ''}
        ${entry.placeholder ? `placeholder="${escapeHtml(entry.placeholder)}"` : ''}>
      ${help}</div>`;
  }

  function mailTools() {
    return `<div class="row wrap" style="gap:.5rem">
      <button type="button" class="btn btn-sm" id="mail-test">${icon('send')} ${escapeHtml(
        tr('adm.testMail')
      )}</button>
      <a class="btn btn-sm" href="#/admin/mails">${escapeHtml(tr('adm.mails'))}</a>
    </div>`;
  }

  function discordTools(data) {
    const bot = data.bot || {};
    return `<div class="note ${bot.connected ? '' : 'warn'}" style="margin:0">
      ${icon(bot.connected ? 'check' : 'info')}
      <div class="small">
        <strong>${escapeHtml(tr('adm.botStatus'))}:</strong>
        ${escapeHtml(bot.connected ? tr('adm.botConnected') : tr('adm.botAway'))}
        ${
          bot.last_heartbeat
            ? ` · ${escapeHtml(tr('adm.when'))} ${datetime(bot.last_heartbeat.at)}`
            : ''
        }
        <br>${escapeHtml(tr('adm.detail'))}: <span class="mono">docs/discord-bot.md</span>
      </div>
    </div>`;
  }

  /** Die Aufladepakete: Betrag in Cent, dafür so viele Credits, dazu die Beschriftung. */
  const paintPackages = () => {
    const box = $('#packages');
    if (!box) return;
    box.innerHTML = packages.length
      ? `<div class="pack-row pack-head">
          <span>${escapeHtml(tr('adm.packCent'))}</span>
          <span>${escapeHtml(tr('common.credits'))}</span>
          <span>${escapeHtml(tr('adm.packLabel'))}</span>
          <span></span>
        </div>
        ${packages
          .map(
            (pack, index) => `<div class="pack-row">
              <input type="number" min="100" step="50" data-pack="${index}" data-key="cent"
                value="${Number(pack.cent) || 0}" aria-label="${escapeHtml(tr('adm.packCent'))}">
              <input type="number" min="1" data-pack="${index}" data-key="credits"
                value="${Number(pack.credits) || 0}" aria-label="${escapeHtml(tr('common.credits'))}">
              <input type="text" data-pack="${index}" data-key="label"
                value="${escapeHtml(pack.label || '')}" aria-label="${escapeHtml(tr('adm.packLabel'))}">
              <button type="button" class="btn btn-ghost btn-sm btn-danger"
                data-pack-del="${index}" title="${escapeHtml(tr('common.delete'))}">${icon('x')}</button>
            </div>`
          )
          .join('')}`
      : `<p class="small muted">${escapeHtml(tr('common.none'))}</p>`;

    $$('[data-pack]', box).forEach((input) =>
      input.addEventListener('input', () => {
        const index = Number(input.dataset.pack);
        const key = input.dataset.key;
        packages[index][key] = key === 'label' ? input.value : Number(input.value);
      })
    );
    $$('[data-pack-del]', box).forEach((button) =>
      button.addEventListener('click', () => {
        packages.splice(Number(button.dataset.packDel), 1);
        paintPackages();
      })
    );
  };
  paintPackages();
  $('#add-package')?.addEventListener('click', () => {
    packages.push({ cent: 500, credits: 500, label: '5 €' });
    paintPackages();
  });

  $$('[data-peek]').forEach((button) =>
    button.addEventListener('click', () => {
      const input = $(`#${button.dataset.peek}`);
      const shown = input.type === 'text';
      input.type = shown ? 'password' : 'text';
      button.innerHTML = icon(shown ? 'eye' : 'eyeOff');
    })
  );

  $$('[data-clear]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('adm.secretClear'), { confirm: tr('common.delete') }))) return;
      try {
        await api(`/admin/settings/${button.dataset.clear}`, { method: 'DELETE' });
        ok(tr('adm.saved'));
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  $('#save').addEventListener('click', async () => {
    // Nur die Felder dieses Reiters gehen mit. Der Server geht ohnehin über jeden Schlüssel
    // einzeln, und was gerade nicht auf dem Bildschirm steht, hat auch niemand geändert.
    const body = {};
    for (const input of $$('[data-set]')) {
      if (input.type === 'checkbox') body[input.dataset.set] = input.checked ? 1 : 0;
      else if (input.type === 'password' && !input.value) continue; // leer = nicht angefasst
      else body[input.dataset.set] = input.value;
    }
    if (fields.some((entry) => entry.type === 'packages')) body.packages = packages;
    try {
      await api('/admin/settings', { method: 'PATCH', body });
      ok(tr('adm.saved'));
      state.meta = await api('/meta');
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $('#mail-test')?.addEventListener('click', async () => {
    const answer = await formDialog(tr('adm.testMail'), [
      { key: 'to', label: tr('auth.register.email'), value: state.me.email },
    ]);
    if (!answer) return;
    try {
      await api('/admin/settings/mail-test', { method: 'POST', body: answer });
      ok(tr('adm.mailSent'));
    } catch (error) {
      fail(error);
    }
  });
}

// ---------------------------------------------------------------- Client, Post, Protokolle

async function client(root) {
  const data = (await api('/admin/client')).client;
  root.innerHTML = `
    <div class="row wrap" style="margin-bottom:1rem">
      <button class="btn btn-primary btn-sm" id="sync">${icon('refresh')} ${escapeHtml(tr('common.retry'))}</button>
      <button class="btn btn-sm" id="force">${escapeHtml(tr('common.retry'))} (force)</button>
      <span class="small muted mono" style="align-self:center">${escapeHtml(data.dir)}</span>
    </div>

    ${
      data.error
        ? `<div class="note warn" style="margin-bottom:1.25rem">${icon('alert')}<div>${escapeHtml(
            data.error
          )}</div></div>`
        : ''
    }

    ${panel(
      tr('ov.builds'),
      table(
        [tr('common.name'), tr('common.status'), 'Version', 'caps'],
        Object.entries(data.builds || {}).map(
          ([name, entry]) => `<tr>
            <td class="mono">${escapeHtml(name)} <span class="small muted">${escapeHtml(entry.file)}</span></td>
            <td><span class="pill ${entry.present ? 'primary' : 'missing'}">${
              entry.present ? 'ok' : '–'
            }</span></td>
            <td class="mono small">${escapeHtml(entry.version || '–')}</td>
            <td class="small muted">${Object.entries(entry.caps || {})
              .filter(([, on]) => on)
              .map(([cap]) => escapeHtml(cap))
              .join(', ')}</td>
          </tr>`
        )
      )
    )}

    ${panel(
      'data/bin',
      table(
        [tr('common.name'), 'Byte', ''],
        (data.files || []).map(
          (file) => `<tr>
            <td class="mono small">${escapeHtml(file.name)}</td>
            <td class="mono small muted">${bytes(file.size)}</td>
            <td class="small muted mono">${datetime(file.changed)}</td>
          </tr>`
        )
      )
    )}`;

  const sync = async (force) => {
    try {
      await api('/admin/client/sync', { method: 'POST', body: { force } });
      ok(tr('adm.saved'));
      draw();
    } catch (error) {
      fail(error);
    }
  };
  $('#sync').addEventListener('click', () => sync(false));
  $('#force').addEventListener('click', () => sync(true));
}

async function mails(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const status = params.get('status') || 'all';
  const query = params.get('q') || '';
  const data = await api(`/admin/mails?status=${status}&q=${encodeURIComponent(query)}`);

  root.innerHTML = `
    <div class="row wrap" style="margin-bottom:1rem">
      <select id="status" class="mini" style="max-width:12rem">
        <option value="all" ${status === 'all' ? 'selected' : ''}>${escapeHtml(tr('common.all'))}</option>
        <option value="sent" ${status === 'sent' ? 'selected' : ''}>ok</option>
        <option value="failed" ${status === 'failed' ? 'selected' : ''}>${escapeHtml(
          tr('set.mailFailed')
        )}</option>
      </select>
      <input id="q" type="search" placeholder="${escapeHtml(tr('common.search'))}"
        value="${escapeHtml(query)}" style="max-width:16rem">
      ${
        data.failed
          ? `<span class="pill missing" style="align-self:center">${escapeHtml(
              tr('adm.mailsFailed', { n: data.failed })
            )}</span>`
          : ''
      }
    </div>
    ${panel(
      tr('adm.mails'),
      // Die Spalten hießen früher to_address und ok – beides gibt es in der Tabelle nicht, die
      // Anzeige blieb deshalb leer. Sie heißen recipient und status.
      table(
        ['', tr('auth.register.email'), tr('tk.subject'), 'kind', tr('common.status')],
        data.mails.map(
          (mail) => `<tr data-mail="${mail.id}" style="cursor:pointer">
            <td class="small muted mono">${datetime(mail.created_at)}</td>
            <td class="small">${escapeHtml(mail.recipient)}
              ${
                mail.username
                  ? `<a class="small muted" href="#/admin/users/${mail.user_id}">${escapeHtml(mail.username)}</a>`
                  : ''
              }</td>
            <td class="small">${escapeHtml(mail.subject)}</td>
            <td class="small muted mono">${escapeHtml(mail.kind)}</td>
            <td><span class="pill ${mail.status === 'sent' ? '' : 'missing'}"
              title="${escapeHtml(mail.error || '')}">${escapeHtml(
                mail.status === 'sent' ? 'ok' : mail.error || 'error'
              )}</span></td>
          </tr>`
        )
      )
    )}`;

  const reload = debounce(() => {
    go(`/admin/mails?status=${$('#status').value}&q=${encodeURIComponent($('#q').value.trim())}`);
    draw();
  }, 300);
  $('#status').addEventListener('change', reload);
  $('#q').addEventListener('input', reload);

  $$('[data-mail]').forEach((row) =>
    row.addEventListener('click', async () => {
      const { mail } = await api(`/admin/mails/${row.dataset.mail}`);
      const dialog = document.createElement('dialog');
      dialog.innerHTML = `
        <header><h3>${escapeHtml(mail.subject)}</h3></header>
        <div class="body stack">
          <div class="row spread small muted">
            <span class="mono">${escapeHtml(mail.recipient)}</span>
            <span class="mono">${datetime(mail.created_at)}</span>
          </div>
          ${
            mail.status !== 'sent'
              ? `<div class="note bad">${icon('alert')}<div>${escapeHtml(mail.error || '')}</div></div>`
              : ''
          }
          <pre class="mail-body">${escapeHtml(mail.body || '')}</pre>
        </div>
        <footer><button class="btn btn-primary" id="close">${escapeHtml(tr('common.close'))}</button></footer>`;
      document.body.append(dialog);
      dialog.addEventListener('close', () => dialog.remove());
      $('#close', dialog).addEventListener('click', () => dialog.close());
      dialog.showModal();
    })
  );
}

async function ledger(root) {
  const data = await api('/admin/ledger');
  root.innerHTML = panel(
    `${tr('adm.ledger')} · ${data.total}`,
    table(
      ['', tr('adm.users'), tr('common.status'), tr('common.credits'), tr('bill.balance')],
      data.entries.map(
        (row) => `<tr>
          <td class="small muted mono">${datetime(row.created_at)}</td>
          <td class="small"><a href="#/admin/users/${row.user_id}">${escapeHtml(row.username)}</a></td>
          <td class="small">${escapeHtml(row.kind)} ${
            row.note ? `<span class="muted">· ${escapeHtml(row.note)}</span>` : ''
          }</td>
          <td class="mono" style="color:${row.delta >= 0 ? 'var(--ok)' : 'var(--text)'}">${
            row.delta >= 0 ? '+' : ''
          }${credits(row.delta)}</td>
          <td class="mono small muted">${credits(row.balance)}</td>
        </tr>`
      )
    )
  );
}

// ---------------------------------------------------------------- Protokoll
//
// Eine Zeile im Protokoll ist eine Handlung, keine JSON-Zeile. Was passiert ist, steht als Satz
// da; wer es genau wissen will, klappt die Einzelheiten auf und bekommt Feld für Feld mit
// Beschriftung – und dort, wo etwas auf einen Nutzer oder einen Serverplatz zeigt, einen Link.

async function audit(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const action = params.get('action') || '';
  const query = params.get('q') || '';
  const data = await api(`/admin/audit?action=${encodeURIComponent(action)}&q=${encodeURIComponent(query)}`);

  root.innerHTML = `
    <div class="row wrap" style="margin-bottom:1rem">
      <select id="action" class="mini" style="max-width:18rem">
        <option value="">${escapeHtml(tr('common.all'))}</option>
        ${data.actions
          .map(
            (entry) =>
              `<option value="${escapeHtml(entry.action)}" ${action === entry.action ? 'selected' : ''}>${escapeHtml(
                entry.action
              )} (${entry.n})</option>`
          )
          .join('')}
      </select>
      <input id="q" type="search" placeholder="${escapeHtml(tr('common.search'))}"
        value="${escapeHtml(query)}" style="max-width:16rem">
    </div>

    <section class="panel">
      <div class="body" style="padding:0">
        <ul class="log">
          ${
            data.entries
              .map(
                (entry) => `<li class="log-row ${entry.detail_parsed?.fields?.length ? 'has-detail' : ''}"
                  data-entry="${entry.id}">
                  <div class="log-head">
                    <span class="log-when small muted mono">${datetime(entry.created_at)}</span>
                    <span class="log-who">${
                      entry.user_id
                        ? `<a href="#/admin/users/${entry.user_id}">${escapeHtml(entry.username || `#${entry.user_id}`)}</a>`
                        : '<span class="muted">System</span>'
                    }</span>
                    <span class="log-action mono">${escapeHtml(entry.action)}</span>
                    <span class="log-summary small muted truncate">${escapeHtml(entry.summary || '')}</span>
                    ${
                      entry.detail_parsed?.fields?.length
                        ? `<span class="log-caret">${icon('arrow')}</span>`
                        : ''
                    }
                  </div>
                  ${
                    entry.detail_parsed?.fields?.length
                      ? `<div class="log-detail hide">
                          <dl class="facts">
                            ${entry.detail_parsed.fields
                              .map(
                                (field) => `<div>
                                  <dt>${escapeHtml(field.label)}</dt>
                                  <dd>${
                                    field.flag !== null
                                      ? `<span class="pill ${field.flag ? 'primary' : 'missing'}">${
                                          field.flag ? tr('common.yes') : '–'
                                        }</span>`
                                      : field.link
                                        ? `<a href="${escapeHtml(field.link)}">${escapeHtml(field.value)}</a>`
                                        : escapeHtml(field.value)
                                  }</dd>
                                </div>`
                              )
                              .join('')}
                          </dl>
                          ${entry.ip ? `<p class="small muted mono">IP ${escapeHtml(entry.ip)}</p>` : ''}
                        </div>`
                      : ''
                  }
                </li>`
              )
              .join('') ||
            `<li class="small muted" style="padding:1.5rem;text-align:center">${escapeHtml(tr('common.none'))}</li>`
          }
        </ul>
      </div>
    </section>`;

  const reload = debounce(() => {
    go(`/admin/audit?action=${encodeURIComponent($('#action').value)}&q=${encodeURIComponent($('#q').value.trim())}`);
    draw();
  }, 300);
  $('#action').addEventListener('change', reload);
  $('#q').addEventListener('input', reload);

  $$('.log-row.has-detail .log-head').forEach((head) =>
    head.addEventListener('click', () => {
      const row = head.parentElement;
      row.classList.toggle('open');
      row.querySelector('.log-detail').classList.toggle('hide');
    })
  );
}
