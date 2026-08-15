// Administration. Ein Reiter je Thema, alles über /api/admin.
//
// Der Grundsatz hier: nichts verstecken, was der Betreiber braucht, und nichts anbieten, was das
// Backend nicht kann. Jede Tabelle zeigt echte Werte aus der Datenbank, jede Änderung geht sofort
// hin und kommt frisch zurück.

import {
  api, icon, escapeHtml, credits, euro, datetime, date, since, tr, $, $$, ok, fail, toast,
  confirmDialog, formDialog, copy, debounce,
} from '../ui.js';
import { state, appbar, refresh, draw, go } from '../app.js';

const TABS = [
  { key: 'overview', label: 'adm.overview' },
  { key: 'users', label: 'adm.users' },
  { key: 'profiles', label: 'adm.profiles' },
  { key: 'bots', label: 'adm.bots' },
  { key: 'plans', label: 'adm.plans' },
  { key: 'topups', label: 'adm.topups' },
  { key: 'vouchers', label: 'adm.vouchers' },
  { key: 'proxies', label: 'adm.proxies' },
  { key: 'tickets', label: 'adm.tickets' },
  { key: 'announcements', label: 'adm.announce' },
  { key: 'settings', label: 'adm.settings' },
  { key: 'client', label: 'adm.client' },
  { key: 'mails', label: 'adm.mails' },
  { key: 'ledger', label: 'adm.ledger' },
  { key: 'audit', label: 'adm.audit' },
];

export async function render(root, route) {
  const tab = TABS.some((entry) => entry.key === route.tab) ? route.tab : 'overview';

  root.innerHTML = `
    ${appbar(tr('adm.title'), '', state.me.username)}
    <nav class="tabs wrap">${TABS.map(
      (entry) =>
        `<a class="${tab === entry.key ? 'active' : ''}" href="#/admin/${entry.key}">${escapeHtml(
          tr(entry.label)
        )}</a>`
    ).join('')}</nav>
    <div id="admin-body"><div class="empty"><h3>${escapeHtml(tr('common.loading'))}</h3></div></div>`;

  const body = $('#admin-body');
  const views = {
    overview,
    users: route.id ? (node) => userDetail(node, route.id) : users,
    profiles,
    bots,
    plans,
    topups,
    vouchers,
    proxies,
    tickets: route.id ? (node) => ticketDetail(node, route.id) : ticketList,
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
      ${stat('MRR', credits(data.mrr_credits), euro(data.mrr_credits))}
      ${stat(tr('bill.balance'), credits(data.credits_outstanding), euro(data.credits_outstanding))}
      ${stat(tr('adm.topups'), euro(data.revenue_30d_cent), tr('adm.revenueAll', { total: euro(data.revenue_cent) }))}
      ${stat(tr('adm.tickets'), data.open_tickets, tr('adm.unread', { n: data.unread_tickets }))}
      ${stat(
        tr('adm.attention'),
        data.users_blocked + data.users_unverified,
        tr('adm.attentionLine', { blocked: data.users_blocked, unverified: data.users_unverified })
      )}
    </div>

    <div class="grid two" style="align-items:start">
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
        <header><h3>${escapeHtml(tr('adm.settings'))}</h3></header>
        <div class="body stack">
          <div class="row spread"><span class="muted small">SMTP</span>
            <span class="pill ${data.mail.configured ? 'primary' : 'missing'}">${
              data.mail.configured ? 'ok' : '–'
            }</span></div>
          <div class="row spread"><span class="muted small">${escapeHtml(
            tr('auth.verify.title')
          )}</span><span class="pill ${data.mail.verify ? 'primary' : ''}">${
            data.mail.verify ? tr('srv.on') : tr('srv.off')
          }</span></div>
          <div class="row spread"><span class="muted small">Discord</span>
            <span class="pill ${data.discord.configured ? 'primary' : 'missing'}">${
              data.discord.configured ? 'ok' : '–'
            }</span></div>
          <div class="row spread"><span class="muted small">Redirect</span>
            <span class="mono small truncate" title="${escapeHtml(data.discord.redirect)}">${escapeHtml(
              data.discord.redirect
            )}</span></div>
          <div class="row spread"><span class="muted small">${escapeHtml(
            tr('error.maintenance.title')
          )}</span><span class="pill ${Number(data.settings.maintenance) ? 'missing' : ''}">${
            Number(data.settings.maintenance) ? tr('srv.on') : tr('srv.off')
          }</span></div>
          <div class="row spread"><span class="muted small">${escapeHtml(
            tr('auth.register.title')
          )}</span><span class="pill ${Number(data.settings.registration_open) ? 'primary' : 'missing'}">${
            Number(data.settings.registration_open) ? tr('srv.on') : tr('srv.off')
          }</span></div>
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
      <select id="filter" style="max-width:12rem">
        ${[
          ['all', tr('common.all')],
          ['paying', tr('features.legend.premium')],
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
              ${!user.email_verified ? `<span class="pill missing">mail</span>` : ''}</span></td>
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
    const value = $('#search').value.trim();
    go(`/admin/users?q=${encodeURIComponent(value)}&filter=${$('#filter').value}`);
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

  root.innerHTML = `
    <div class="row wrap spread" style="margin-bottom:1.25rem">
      <div>
        <h2 style="font-size:1.4rem">${escapeHtml(user.username)}
          ${user.role === 'admin' ? '<span class="pill primary">admin</span>' : ''}
          ${user.blocked ? `<span class="pill missing">${escapeHtml(tr('adm.block'))}</span>` : ''}</h2>
        <p class="small muted mono">${escapeHtml(user.email)} · #${user.id} ·
          ${escapeHtml(tr('common.status'))}: ${user.last_seen_at ? since(user.last_seen_at) : '–'}</p>
      </div>
      <div class="row wrap">
        <a class="btn btn-sm" href="#/admin/users">${escapeHtml(tr('common.back'))}</a>
        <button class="btn btn-sm" id="impersonate">${escapeHtml(tr('adm.impersonate'))}</button>
        <button class="btn btn-primary btn-sm" id="credits">${escapeHtml(tr('adm.addCredits'))}</button>
      </div>
    </div>

    <div class="grid four" style="margin-bottom:1.5rem">
      ${stat(tr('bill.balance'), credits(user.credits), euro(user.credits))}
      ${stat(tr('bill.monthly'), credits(data.monthly_cost), data.paying ? tr('features.legend.premium') : '–')}
      ${stat(tr('adm.profiles'), data.profiles.length, `${data.accounts.length} ${tr('ov.accounts')}`)}
      ${stat(tr('adm.tickets'), data.tickets.length, `${data.proxies.length} ${tr('px.title')}`)}
    </div>

    <div class="row wrap" style="margin-bottom:1.5rem">
      <button class="btn btn-sm" id="edit">${icon('settings')} ${escapeHtml(tr('common.edit'))}</button>
      <button class="btn btn-sm" id="password">${escapeHtml(tr('adm.setPassword'))}</button>
      <button class="btn btn-sm" id="premium">${escapeHtml(tr('features.legend.premium'))}</button>
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

    ${panel(
      tr('adm.profiles'),
      table(
        [tr('common.name'), tr('srv.address'), tr('srv.plan'), tr('common.month'), tr('common.status'), ''],
        data.profiles.map(
          (profile) => `<tr>
            <td>${escapeHtml(profile.name)}</td>
            <td class="mono small">${escapeHtml(profile.address)}</td>
            <td class="small">${escapeHtml(profile.plan || '–')}</td>
            <td class="small muted">${profile.paid_until ? date(profile.paid_until) : '–'}</td>
            <td>${
              profile.suspended
                ? `<span class="pill missing">${escapeHtml(tr('tk.status.closed'))}</span>`
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
      <header><h3>${escapeHtml(tr('common.edit'))}</h3></header>
      <div class="body stack">
        <div class="field"><label for="notes">${escapeHtml(tr('common.edit'))}</label>
          <textarea id="notes" rows="4">${escapeHtml(user.notes || '')}</textarea></div>
        <div class="row">
          <div class="field" style="max-width:10rem"><label for="allowance">${escapeHtml(
            tr('px.title')
          )}</label>
            <input id="allowance" type="number" min="0" max="100" value="${user.proxy_allowance || 0}"></div>
          <button class="btn btn-primary" id="save-notes" style="align-self:flex-end">${escapeHtml(
            tr('common.save')
          )}</button>
        </div>
        ${
          user.premium_until
            ? `<p class="small muted">${escapeHtml(tr('features.legend.premium'))}: ${date(
                user.premium_until
              )}</p>`
            : ''
        }
      </div>
    </section>`;

  const patch = async (body) => {
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body });
      ok(tr('adm.saved'));
      draw();
    } catch (error) {
      fail(error);
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
    const answer = await formDialog(tr('features.legend.premium'), [
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

  $$('[data-extend]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api(`/admin/profiles/${button.dataset.extend}`, {
        method: 'PATCH',
        body: { extend_days: 30 },
      }).catch(fail);
      ok(tr('adm.saved'));
      draw();
    })
  );

  $$('[data-ticket]').forEach((row) =>
    row.addEventListener('click', () => go(`/admin/tickets/${row.dataset.ticket}`))
  );
}

// ---------------------------------------------------------------- Serverplätze und Bots

async function profiles(root) {
  const data = await api('/admin/profiles');
  root.innerHTML = panel(
    `${data.profiles.length} ${tr('adm.profiles')}`,
    table(
      ['#', tr('common.name'), tr('adm.users'), tr('srv.address'), tr('srv.plan'), tr('common.month'), '', ''],
      data.profiles.map(
        (profile) => `<tr>
          <td class="mono small muted">${profile.id}</td>
          <td>${escapeHtml(profile.name)}</td>
          <td class="small"><a href="#/admin/users/${profile.user_id}">${escapeHtml(profile.username)}</a></td>
          <td class="mono small">${escapeHtml(profile.address)}</td>
          <td class="small">${escapeHtml(profile.plan || '–')}</td>
          <td class="small muted">${profile.paid_until ? date(profile.paid_until) : '–'}</td>
          <td>${
            profile.suspended
              ? `<span class="pill missing">${escapeHtml(tr('tk.status.closed'))}</span>`
              : `<span class="pill ${profile.online ? 'primary' : ''}">${profile.online}</span>`
          }</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-sm" data-extend="${profile.id}">+30 d</button>
            <button class="btn btn-sm" data-suspend="${profile.id}" data-on="${profile.suspended ? 1 : 0}">${
              profile.suspended ? escapeHtml(tr('srv.resume')) : escapeHtml(tr('tk.status.closed'))
            }</button>
            <button class="btn btn-ghost btn-sm btn-danger" data-del="${profile.id}">${icon('trash')}</button>
          </td>
        </tr>`
      )
    )
  );

  $$('[data-extend]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api(`/admin/profiles/${button.dataset.extend}`, { method: 'PATCH', body: { extend_days: 30 } })
        .then(() => ok(tr('adm.saved')))
        .catch(fail);
      draw();
    })
  );
  $$('[data-suspend]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api(`/admin/profiles/${button.dataset.suspend}`, {
        method: 'PATCH',
        body: { suspended: button.dataset.on !== '1' },
      }).catch(fail);
      draw();
    })
  );
  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      await api(`/admin/profiles/${button.dataset.del}`, { method: 'DELETE' }).catch(fail);
      draw();
    })
  );
}

async function bots(root) {
  const data = await api('/admin/bots');
  root.innerHTML = panel(
    `${data.bots.length} ${tr('adm.bots')}`,
    table(
      [tr('adm.users'), tr('ov.col.account'), tr('ov.col.server'), tr('common.status'), tr('ov.col.uptime'), ''],
      data.bots.map(
        (bot) => `<tr>
          <td class="small"><a href="#/admin/users/${bot.user_id}">${escapeHtml(bot.username || '')}</a></td>
          <td>${escapeHtml(bot.account || '')}</td>
          <td class="small muted mono">${escapeHtml(bot.profile || '')} · ${escapeHtml(bot.host || '')}</td>
          <td class="small">${escapeHtml(bot.state || '')} ${
            bot.plan ? `<span class="pill">${escapeHtml(bot.plan)}</span>` : ''
          }</td>
          <td class="mono small muted">${bot.since ? since(bot.since) : '–'}</td>
          <td style="text-align:right"><button class="btn btn-sm" data-stop="${bot.key}">${escapeHtml(
            tr('ov.stop')
          )}</button></td>
        </tr>`
      )
    )
  );

  $$('[data-stop]').forEach((button) =>
    button.addEventListener('click', async () => {
      const [profileId, accountId] = button.dataset.stop.split(':');
      await api(`/admin/bots/${profileId}/${accountId}/stop`, { method: 'POST' }).catch(fail);
      draw();
    })
  );
}

// ---------------------------------------------------------------- Tarife

const PLAN_FLAGS = ['free_slot', 'premium', 'movement', 'proxy', 'offline_accounts', 'fakehost', 'chat_limit_editable', 'priority_support', 'active'];

async function plans(root) {
  const data = await api('/admin/plans');
  root.innerHTML = `
    <div class="row" style="margin-bottom:1rem">
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('common.create'))}</button>
    </div>
    ${panel(
      tr('adm.plans'),
      table(
        ['#', tr('common.name'), tr('common.credits'), tr('pricing.bots'), tr('pricing.chatHistory'), '', ''],
        data.plans.map(
          (plan) => `<tr>
            <td class="mono small muted">${escapeHtml(plan.slug)}</td>
            <td>${escapeHtml(plan.name_en)} <span class="small muted">/ ${escapeHtml(plan.name_de)}</span></td>
            <td class="mono">${plan.free_slot ? escapeHtml(tr('common.free')) : credits(plan.price_credits)}</td>
            <td class="small">${plan.max_accounts}</td>
            <td class="small">${plan.chat_limit}${plan.chat_limit_editable ? ' ✎' : ''}</td>
            <td class="small">${PLAN_FLAGS.filter((flag) => plan[flag])
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
    { key: 'name_en', label: 'Name (EN)', value: plan.name_en || '', required: true },
    { key: 'name_de', label: 'Name (DE)', value: plan.name_de || '', required: true },
    { key: 'blurb_en', label: 'Blurb (EN)', value: plan.blurb_en || '' },
    { key: 'blurb_de', label: 'Blurb (DE)', value: plan.blurb_de || '' },
    { key: 'price_credits', label: tr('common.credits'), type: 'number', min: 0, value: plan.price_credits ?? 0 },
    { key: 'max_accounts', label: tr('pricing.bots'), type: 'number', min: 1, value: plan.max_accounts ?? 1 },
    { key: 'chat_limit', label: tr('pricing.chatHistory'), type: 'number', min: 20, value: plan.chat_limit ?? 200 },
    { key: 'sort', label: '#', type: 'number', min: 0, value: plan.sort ?? 50 },
    ...PLAN_FLAGS.map((flag) => ({ key: flag, label: flag, type: 'checkbox', value: Boolean(plan[flag]) })),
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

/** Zahlen aus dem Dialog kommen als Text zurück – hier wieder zu Zahlen machen. */
function numbers(answer) {
  const out = { ...answer };
  for (const key of ['price_credits', 'max_accounts', 'chat_limit', 'sort', 'credits', 'uses', 'count', 'expires_days']) {
    if (out[key] !== undefined) out[key] = Number(out[key]);
  }
  return out;
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
            <td class="mono">${credits(voucher.credits)}</td>
            <td class="small muted">${voucher.used}/${voucher.uses}${
              voucher.expires_at ? ` · ${date(voucher.expires_at)}` : ''
            }</td>
            <td class="small muted">${escapeHtml(voucher.note || '')}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(voucher.code)}">${icon('copy')}</button>
              <button class="btn btn-ghost btn-sm btn-danger" data-del="${escapeHtml(
                voucher.code
              )}">${icon('trash')}</button>
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
        { key: 'count', label: '×', type: 'number', min: 1, max: 50, value: 1 },
        { key: 'uses', label: tr('common.all'), type: 'number', min: 1, value: 1 },
        { key: 'expires_days', label: tr('common.days'), type: 'number', min: 0, value: 0 },
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
    <div class="row wrap" style="margin-bottom:1rem">
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('common.create'))}</button>
      <p class="small muted" style="margin:0;align-self:center">${escapeHtml(tr('px.requestNote'))}</p>
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
    { key: 'password', label: tr('auth.login.password'), value: proxy.password || '' },
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

  $('#new').addEventListener('click', async () => {
    const answer = await formDialog(tr('common.create'), fields(), { submit: tr('common.create') });
    if (!answer) return;
    try {
      await api('/admin/proxies', {
        method: 'POST',
        body: { ...answer, assigned_to: answer.assigned_to ? Number(answer.assigned_to) : null },
      });
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
        await api(`/admin/proxies/${proxy.id}`, {
          method: 'PATCH',
          body: { ...answer, assigned_to: answer.assigned_to ? Number(answer.assigned_to) : null },
        });
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

// ---------------------------------------------------------------- Tickets

async function ticketList(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const status = params.get('status') || 'open';
  const data = await api(`/admin/tickets?status=${status}&q=${encodeURIComponent(params.get('q') || '')}`);

  root.innerHTML = `
    <div class="row wrap" style="margin-bottom:1rem">
      <select id="status" style="max-width:12rem">
        <option value="all" ${status === 'all' ? 'selected' : ''}>${escapeHtml(tr('common.all'))}</option>
        ${data.statuses
          .map(
            (entry) =>
              `<option value="${entry}" ${status === entry ? 'selected' : ''}>${escapeHtml(
                tr(`tk.status.${entry}`)
              )}</option>`
          )
          .join('')}
      </select>
      <input id="q" type="search" placeholder="${escapeHtml(tr('common.search'))}"
        value="${escapeHtml(params.get('q') || '')}" style="max-width:16rem">
    </div>
    ${panel(
      `${data.tickets.length} ${tr('adm.tickets')}`,
      table(
        [tr('tk.subject'), tr('adm.users'), tr('tk.category'), tr('common.status'), ''],
        data.tickets.map(
          (ticket) => `<tr data-open="${ticket.id}" style="cursor:pointer">
            <td><span class="row" style="gap:.5rem">
              ${ticket.unread_staff ? '<span class="dot live" style="color:var(--primary)"></span>' : ''}
              ${escapeHtml(ticket.subject)}</span></td>
            <td class="small">${escapeHtml(ticket.username)}</td>
            <td class="small muted">${escapeHtml(
              data.categories.find((entry) => entry.key === ticket.category)?.label || ticket.category
            )}</td>
            <td><span class="pill ${ticket.priority === 'high' || ticket.priority === 'urgent' ? 'primary' : ''}">${escapeHtml(
              tr(`tk.status.${ticket.status}`)
            )}</span></td>
            <td class="small muted mono">${datetime(ticket.updated_at)}</td>
          </tr>`
        )
      )
    )}`;

  const reload = () =>
    go(`/admin/tickets?status=${$('#status').value}&q=${encodeURIComponent($('#q').value.trim())}`);
  $('#status').addEventListener('change', () => {
    reload();
    draw();
  });
  $('#q').addEventListener(
    'input',
    debounce(() => {
      reload();
      draw();
    }, 350)
  );
  $$('[data-open]').forEach((row) =>
    row.addEventListener('click', () => go(`/admin/tickets/${row.dataset.open}`))
  );
}

async function ticketDetail(root, id) {
  const data = await api(`/admin/tickets/${id}`);
  const ticket = data.ticket;

  root.innerHTML = `
    <div class="row wrap spread" style="margin-bottom:1.25rem">
      <div>
        <h2 style="font-size:1.3rem">${escapeHtml(ticket.subject)}</h2>
        <p class="small muted">${escapeHtml(tr(`tk.status.${ticket.status}`))} ·
          <a href="#/admin/users/${ticket.user_id}">${escapeHtml(data.user?.username || '')}</a>
          ${data.paying ? `<span class="pill primary">${escapeHtml(tr('features.legend.premium'))}</span>` : ''}
        </p>
      </div>
      <div class="row wrap">
        <a class="btn btn-sm" href="#/admin/tickets">${escapeHtml(tr('common.back'))}</a>
        <select id="status" style="max-width:10rem">
          ${['open', 'waiting', 'answered', 'closed']
            .map(
              (entry) =>
                `<option value="${entry}" ${ticket.status === entry ? 'selected' : ''}>${escapeHtml(
                  tr(`tk.status.${entry}`)
                )}</option>`
            )
            .join('')}
        </select>
      </div>
    </div>

    <section class="panel" style="margin-bottom:1.25rem">
      <div class="body stack" style="gap:1rem">
        ${data.messages
          .map(
            (message) => `<article class="msg ${message.role === 'staff' ? 'staff' : ''} ${
              message.internal ? 'internal' : ''
            }">
              <header class="row spread">
                <span class="strong small">${escapeHtml(
                  message.internal ? tr('tk.internal') : message.username || tr('tk.staff')
                )}</span>
                <span class="small muted mono">${datetime(message.created_at)}</span>
              </header>
              <p>${escapeHtml(message.body).replace(/\n/g, '<br>')}</p>
            </article>`
          )
          .join('')}
      </div>
    </section>

    <section class="panel">
      <header><h3>${escapeHtml(tr('tk.reply'))}</h3></header>
      <div class="body stack">
        <div class="field"><textarea id="reply" rows="5"></textarea></div>
        <div class="row">
          <button class="btn btn-primary" id="send">${escapeHtml(tr('tk.send'))}</button>
          <button class="btn" id="internal">${escapeHtml(tr('tk.internal'))}</button>
        </div>
      </div>
    </section>`;

  const send = async (internal) => {
    const body = $('#reply').value.trim();
    if (!body) return;
    try {
      await api(`/admin/tickets/${id}/reply`, { method: 'POST', body: { body, internal } });
      await refresh({ profiles: false, accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  };
  $('#send').addEventListener('click', () => send(false));
  $('#internal').addEventListener('click', () => send(true));
  $('#status').addEventListener('change', async () => {
    await api(`/admin/tickets/${id}`, { method: 'PATCH', body: { status: $('#status').value } }).catch(fail);
    draw();
  });
}

// ---------------------------------------------------------------- Ankündigungen

async function announcements(root) {
  const data = await api('/admin/announcements');
  root.innerHTML = `
    <div class="row" style="margin-bottom:1rem">
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('common.create'))}</button>
    </div>
    ${panel(
      tr('adm.announce'),
      table(
        [tr('common.name'), '', tr('common.status'), ''],
        data.announcements.map(
          (entry) => `<tr>
            <td>${escapeHtml(entry.title_en)} <span class="small muted">/ ${escapeHtml(entry.title_de)}</span></td>
            <td class="small muted">${escapeHtml((entry.body_en || '').slice(0, 80))}</td>
            <td><span class="pill ${entry.active ? 'primary' : ''}">${entry.active ? 'live' : '–'}</span></td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-sm" data-toggle="${entry.id}" data-on="${entry.active ? 1 : 0}">${
                entry.active ? escapeHtml(tr('srv.off')) : escapeHtml(tr('srv.on'))
              }</button>
              <button class="btn btn-ghost btn-sm btn-danger" data-del="${entry.id}">${icon('trash')}</button>
            </td>
          </tr>`
        )
      )
    )}`;

  $('#new').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('common.create'),
      [
        { key: 'title_en', label: 'Title (EN)', required: true },
        { key: 'title_de', label: 'Titel (DE)', required: true },
        { key: 'body_en', label: 'Text (EN)', type: 'textarea' },
        { key: 'body_de', label: 'Text (DE)', type: 'textarea' },
        {
          key: 'kind',
          label: 'Typ',
          type: 'select',
          value: 'info',
          options: ['info', 'warn', 'bad'],
        },
      ],
      { submit: tr('common.create') }
    );
    if (!answer) return;
    await api('/admin/announcements', { method: 'POST', body: answer }).catch(fail);
    draw();
  });

  $$('[data-toggle]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api(`/admin/announcements/${button.dataset.toggle}`, {
        method: 'PATCH',
        body: { active: button.dataset.on !== '1' },
      }).catch(fail);
      draw();
    })
  );
  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      await api(`/admin/announcements/${button.dataset.del}`, { method: 'DELETE' }).catch(fail);
      draw();
    })
  );
}

// ---------------------------------------------------------------- Einstellungen

const SETTING_GROUPS = [
  {
    title: 'Guthaben',
    fields: [
      ['free_slots', 'number'],
      ['signup_bonus', 'number'],
      ['low_balance', 'number'],
      ['renew_warn_days', 'number'],
    ],
  },
  {
    title: 'Registrierung',
    fields: [
      ['registration_open', 'switch'],
      ['email_verify', 'switch'],
      ['max_bots_per_user', 'number'],
    ],
  },
  {
    title: 'SMTP',
    fields: [
      ['smtp_host', 'text'],
      ['smtp_port', 'number'],
      ['smtp_secure', 'switch'],
      ['smtp_user', 'text'],
      ['smtp_pass', 'text'],
      ['smtp_from', 'text'],
      ['smtp_from_name', 'text'],
    ],
  },
  {
    title: 'Discord',
    fields: [
      ['discord_client_id', 'text'],
      ['discord_client_secret', 'text'],
      ['discord_login', 'switch'],
      ['discord_staff_webhook', 'text'],
    ],
  },
  {
    title: 'Betrieb',
    fields: [
      ['maintenance', 'switch'],
      ['maintenance_text', 'text'],
      ['support_hours', 'text'],
    ],
  },
  {
    title: 'Recht',
    fields: [
      ['legal_imprint', 'area'],
      ['legal_imprint_en', 'area'],
      ['legal_privacy', 'area'],
      ['legal_privacy_en', 'area'],
      ['legal_terms', 'area'],
      ['legal_terms_en', 'area'],
    ],
  },
];

async function settings(root) {
  const data = await api('/admin/settings');
  const value = (key) => data.settings[key] ?? '';

  root.innerHTML = `
    <div class="grid two" style="align-items:start">
      ${SETTING_GROUPS.map(
        (group) => `<section class="panel">
          <header><h3>${escapeHtml(group.title)}</h3></header>
          <div class="body stack">
            ${group.fields
              .map(([key, kind]) => {
                if (kind === 'switch') {
                  return `<label class="check"><input type="checkbox" data-set="${key}"
                    ${Number(value(key)) ? 'checked' : ''}> <span class="mono small">${key}</span></label>`;
                }
                if (kind === 'area') {
                  return `<div class="field"><label class="mono small" for="s-${key}">${key}</label>
                    <textarea id="s-${key}" data-set="${key}" rows="4">${escapeHtml(value(key))}</textarea></div>`;
                }
                return `<div class="field"><label class="mono small" for="s-${key}">${key}</label>
                  <input id="s-${key}" data-set="${key}" type="${kind === 'number' ? 'number' : 'text'}"
                    value="${escapeHtml(value(key))}"></div>`;
              })
              .join('')}
          </div>
        </section>`
      ).join('')}

      <section class="panel">
        <header><h3>${escapeHtml(tr('bill.topUp'))}</h3></header>
        <div class="body stack">
          <p class="small muted">${escapeHtml(tr('pricing.topup.lead'))}</p>
          <div id="packages" class="stack"></div>
          <button class="btn btn-sm" id="add-package">${icon('plus')}</button>
        </div>
      </section>
    </div>

    <div class="row" style="margin-top:1.25rem">
      <button class="btn btn-primary" id="save">${escapeHtml(tr('common.save'))}</button>
      <button class="btn" id="mail-test">${escapeHtml(tr('set.webhookTest'))}</button>
    </div>`;

  const packages = structuredClone(data.settings.packages || []);
  const paintPackages = () => {
    $('#packages').innerHTML = packages
      .map(
        (pack, index) => `<div class="row" style="gap:.5rem">
          <input type="number" data-pack="${index}" data-key="cent" value="${pack.cent}" style="max-width:7rem">
          <input type="number" data-pack="${index}" data-key="credits" value="${pack.credits}" style="max-width:7rem">
          <input type="text" data-pack="${index}" data-key="label" value="${escapeHtml(pack.label || '')}"
            style="max-width:7rem">
          <button class="btn btn-ghost btn-sm btn-danger" data-pack-del="${index}">${icon('x')}</button>
        </div>`
      )
      .join('');
    $$('[data-pack]').forEach((input) =>
      input.addEventListener('change', () => {
        const index = Number(input.dataset.pack);
        const key = input.dataset.key;
        packages[index][key] = key === 'label' ? input.value : Number(input.value);
      })
    );
    $$('[data-pack-del]').forEach((button) =>
      button.addEventListener('click', () => {
        packages.splice(Number(button.dataset.packDel), 1);
        paintPackages();
      })
    );
  };
  paintPackages();
  $('#add-package').addEventListener('click', () => {
    packages.push({ cent: 500, credits: 500, label: '5 €' });
    paintPackages();
  });

  $('#save').addEventListener('click', async () => {
    const body = { packages };
    for (const input of $$('[data-set]')) {
      body[input.dataset.set] = input.type === 'checkbox' ? (input.checked ? 1 : 0) : input.value;
    }
    try {
      await api('/admin/settings', { method: 'PATCH', body });
      ok(tr('adm.saved'));
      state.meta = await api('/meta');
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $('#mail-test').addEventListener('click', async () => {
    const answer = await formDialog(tr('set.webhookTest'), [
      { key: 'to', label: tr('auth.register.email'), value: state.me.email },
    ]);
    if (!answer) return;
    try {
      await api('/admin/settings/mail-test', { method: 'POST', body: answer });
      ok(tr('adm.saved'));
    } catch (error) {
      fail(error);
    }
  });
}

// ---------------------------------------------------------------- Client, Mails, Protokolle

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
            <td class="mono small muted">${file.size.toLocaleString()}</td>
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
  const data = await api('/admin/mails');
  root.innerHTML = panel(
    tr('adm.mails'),
    table(
      ['', tr('auth.register.email'), tr('tk.subject'), tr('common.status')],
      data.mails.map(
        (mail) => `<tr>
          <td class="small muted mono">${datetime(mail.created_at)}</td>
          <td class="small">${escapeHtml(mail.to_address)}</td>
          <td class="small">${escapeHtml(mail.subject)}</td>
          <td><span class="pill ${mail.ok ? '' : 'missing'}">${
            mail.ok ? 'ok' : escapeHtml(mail.error || 'error')
          }</span></td>
        </tr>`
      )
    )
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

async function audit(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const action = params.get('action') || '';
  const data = await api(`/admin/audit?action=${encodeURIComponent(action)}`);

  root.innerHTML = `
    <div class="row" style="margin-bottom:1rem">
      <select id="action" style="max-width:16rem">
        <option value="">${escapeHtml(tr('common.all'))}</option>
        ${data.actions
          .map(
            (entry) =>
              `<option value="${escapeHtml(entry)}" ${action === entry ? 'selected' : ''}>${escapeHtml(
                entry
              )}</option>`
          )
          .join('')}
      </select>
    </div>
    ${panel(
      tr('adm.audit'),
      table(
        ['', tr('adm.users'), 'action', ''],
        data.entries.map(
          (entry) => `<tr>
            <td class="small muted mono">${datetime(entry.created_at)}</td>
            <td class="small">${
              entry.user_id
                ? `<a href="#/admin/users/${entry.user_id}">${escapeHtml(entry.username || '')}</a>`
                : '<span class="muted">–</span>'
            }</td>
            <td class="mono small">${escapeHtml(entry.action)}</td>
            <td class="small muted mono truncate" style="max-width:22rem">${escapeHtml(entry.detail || '')}</td>
          </tr>`
        )
      )
    )}`;

  $('#action').addEventListener('change', () => {
    go(`/admin/audit?action=${encodeURIComponent($('#action').value)}`);
    draw();
  });
}
