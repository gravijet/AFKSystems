// Serverplätze: Liste, Anlegen – und die Registerkarten eines Platzes.
//
// Welche Reiter es gibt, entscheidet nicht diese Datei, sondern der Client: `profile.caps` sagt,
// was die Bauform hinter dem Tarif wirklich kann. Was sie nicht kann, wird gar nicht erst
// angeboten – ein Knopf, der nichts tut, ist schlimmer als kein Knopf.

import {
  api, icon, escapeHtml, since, clock, credits, date, stateBadge, tr, $, $$, ok, fail, toast,
  confirmDialog, formDialog, debounce,
} from '../ui.js';
import { state, appbar, refresh, draw, profileById, tabsFor, linesOf } from '../app.js';

export async function render(root, route) {
  if (route.name === 'servers') return renderList(root);
  return renderProfile(root, route);
}

// ---------------------------------------------------------------- Liste

async function renderList(root) {
  root.innerHTML = `
    ${appbar(
      tr('dash.servers'),
      `<button class="btn btn-primary btn-sm" id="add">${icon('plus')} ${escapeHtml(tr('dash.newServer'))}</button>`,
      tr('pricing.title')
    )}
    ${
      state.profiles.length
        ? `<div class="grid two">${state.profiles.map(card).join('')}</div>`
        : `<div class="empty"><h3>${escapeHtml(tr('ov.noServer.title'))}</h3>
            <p>${escapeHtml(tr('ov.noServer.text'))}</p>
            <button class="btn btn-primary" id="add-2">${icon('plus')} ${escapeHtml(tr('dash.newServer'))}</button></div>`
    }`;

  $('#add')?.addEventListener('click', newProfile);
  $('#add-2')?.addEventListener('click', newProfile);
}

function card(profile) {
  return `<a class="card" href="#/servers/${profile.id}/connect" style="display:block">
    <div class="row spread">
      <div class="row">
        <span class="dot ${profile.online ? 'live' : ''}"
          style="color:${profile.online ? 'var(--ok)' : 'var(--text-2)'}"></span>
        <div>
          <div class="strong">${escapeHtml(profile.name)}</div>
          <div class="small muted mono">${escapeHtml(profile.address)}</div>
        </div>
      </div>
      <span class="pill ${profile.plan.free_slot ? '' : 'primary'}">${escapeHtml(profile.plan.name)}</span>
    </div>
    <div class="row spread" style="margin-top:1rem">
      <span class="small muted">${profile.online}/${profile.total} · MC ${escapeHtml(profile.mc_version)}</span>
      ${
        profile.suspended
          ? `<span class="pill missing">${escapeHtml(tr('tk.status.closed'))}</span>`
          : `<span class="small" style="color:var(--primary)">${escapeHtml(tr('common.open'))} ${icon('arrow')}</span>`
      }
    </div>
  </a>`;
}

export async function newProfile() {
  const plans = state.meta.plans || [];
  const freeLeft = state.stats?.free_slots_left ?? 0;
  const options = plans
    .filter((plan) => !plan.free_slot || freeLeft > 0)
    .map((plan) => ({
      value: String(plan.id),
      label: plan.free_slot
        ? `${plan.name} – ${tr('common.free')}`
        : `${plan.name} – ${plan.price_credits} ${tr('common.credits')} / ${state.meta.month_days} ${tr('common.days')}`,
    }));

  const data = await formDialog(
    tr('srv.new'),
    [
      { key: 'name', label: tr('srv.name'), placeholder: 'SMP', required: true },
      {
        key: 'address',
        label: tr('srv.address'),
        placeholder: 'play.example.net',
        hint: tr('srv.addressHint'),
        required: true,
      },
      {
        key: 'mc_version',
        label: tr('srv.version'),
        type: 'select',
        value: state.meta.default_version,
        options: state.meta.versions,
      },
      { key: 'plan_id', label: tr('srv.plan'), type: 'select', value: options[0]?.value, options },
    ],
    {
      submit: tr('common.create'),
      note: freeLeft > 0 ? tr('srv.planFreeLeft', { n: freeLeft }) : tr('srv.planNoFree'),
    }
  );
  if (!data) return;
  try {
    const result = await api('/profiles', {
      method: 'POST',
      body: { ...data, plan_id: Number(data.plan_id) },
    });
    await refresh();
    ok(tr('srv.created'));
    location.hash = `#/servers/${result.profile.id}/connect`;
    draw();
  } catch (error) {
    fail(error);
  }
}

// ---------------------------------------------------------------- Ein Serverplatz

async function renderProfile(root, route) {
  let profile = profileById(route.id);
  if (!profile) {
    await refresh({ accounts: false });
    profile = profileById(route.id);
  }
  if (!profile) {
    root.innerHTML = `<div class="empty"><h3>${escapeHtml(tr('error.404.title'))}</h3>
      <a class="btn" href="#/servers">${escapeHtml(tr('common.back'))}</a></div>`;
    return;
  }

  const tabs = tabsFor(profile);
  const current = tabs.some((tab) => tab.key === route.tab) ? route.tab : 'connect';

  root.innerHTML = `
    ${appbar(
      profile.name,
      `<span class="pill">MC ${escapeHtml(profile.mc_version)}</span>
       <span class="pill ${profile.plan.free_slot ? '' : 'primary'}">${escapeHtml(profile.plan.name)}</span>
       <span class="pill">${profile.online}/${profile.total}</span>`,
      `<span class="mono">${escapeHtml(profile.address)}</span>`
    )}
    ${
      profile.suspended
        ? `<div class="note warn" style="margin-bottom:1.25rem">${icon('alert')}
            <div>${escapeHtml(tr('srv.suspended'))}
            <a href="#/servers/${profile.id}/plan" style="color:var(--primary)">${escapeHtml(
              tr('srv.resume')
            )}</a></div></div>`
        : ''
    }
    <nav class="tabs">${tabs
      .map(
        (tab) =>
          `<a class="${current === tab.key ? 'active' : ''}" href="#/servers/${profile.id}/${tab.key}">${escapeHtml(
            tr(tab.label)
          )}</a>`
      )
      .join('')}</nav>
    <div id="tab-body"></div>`;

  const views = {
    connect: tabConnect,
    chat: tabChat,
    movement: tabMovement,
    board: tabBoard,
    menu: tabMenu,
    macros: tabMacros,
    proxies: tabProxies,
    plan: tabPlan,
    settings: tabSettings,
  };
  await (views[current] || tabConnect)($('#tab-body'), profile);
}

// ---------------------------------------------------------------- Verbinden

async function tabConnect(root, profile) {
  const free = state.accounts.filter(
    (account) => !profile.accounts.some((member) => member.account_id === account.id)
  );

  const paint = () => {
    // Wartet ein Bot auf eine neue Microsoft-Anmeldung, gehört der Link nach ganz oben.
    const waiting = profile.accounts
      .map((member) => state.bots.get(`${profile.id}:${member.account_id}`))
      .filter((bot) => bot && bot.state === 'auth' && bot.auth?.code);

    root.innerHTML = `
      ${waiting
        .map(
          (bot) => `<div class="note warn" style="margin-bottom:1rem">${icon('key')}
            <div><strong>${escapeHtml(bot.account)}</strong> — ${escapeHtml(tr('acc.ms.step'))}
            <a class="btn btn-sm btn-primary" style="margin-left:.5rem"
               href="${escapeHtml(bot.auth.uri_complete || bot.auth.uri || 'https://www.microsoft.com/link')}"
               target="_blank" rel="noopener">${escapeHtml(tr('acc.ms.open'))}</a>
            <span class="mono strong" style="margin-left:.5rem;letter-spacing:.1em">${escapeHtml(
              bot.auth.code
            )}</span></div></div>`
        )
        .join('')}

      <div class="row wrap" style="margin-bottom:1rem">
        <button class="btn btn-primary btn-sm" id="start" ${profile.active ? '' : 'disabled'}>${icon('play')} ${escapeHtml(
          tr('srv.startAll')
        )}</button>
        <button class="btn btn-sm" id="stop">${icon('stop')} ${escapeHtml(tr('srv.stopAll'))}</button>
        <button class="btn btn-sm" id="restart">${icon('refresh')}</button>
        <div class="grow"></div>
        <button class="btn btn-sm" id="attach" ${free.length ? '' : 'disabled'}>${icon('plus')} ${escapeHtml(
          tr('srv.addAccounts')
        )}</button>
      </div>

      ${
        profile.accounts.length
          ? `<section class="panel"><div class="table-wrap"><table class="table">
              <thead><tr>
                <th style="width:2rem"><input type="checkbox" id="all" aria-label="${escapeHtml(
                  tr('common.all')
                )}"></th>
                <th>${escapeHtml(tr('ov.col.account'))}</th>
                <th>${escapeHtml(tr('common.status'))}</th>
                <th>${escapeHtml(tr('ov.col.uptime'))}</th>
                <th></th><th></th>
              </tr></thead>
              <tbody>${profile.accounts.map(row).join('')}</tbody>
            </table></div></section>`
          : `<div class="empty"><h3>${escapeHtml(tr('srv.noAccounts'))}</h3>
              ${
                state.accounts.length
                  ? `<button class="btn btn-primary" id="attach-2">${icon('plus')} ${escapeHtml(
                      tr('srv.addAccounts')
                    )}</button>`
                  : `<a class="btn btn-primary" href="#/accounts">${icon('users')} ${escapeHtml(
                      tr('ov.connectAccount')
                    )}</a>`
              }
            </div>`
      }`;

    $('#all')?.addEventListener('change', (event) => {
      $$('[data-pick]').forEach((box) => {
        box.checked = event.target.checked;
      });
    });

    $('#start')?.addEventListener('click', () => act('start'));
    $('#stop')?.addEventListener('click', () => act('stop'));
    $('#restart')?.addEventListener('click', () => act('restart'));
    $('#attach')?.addEventListener('click', attach);
    $('#attach-2')?.addEventListener('click', attach);

    $$('[data-toggle]').forEach((button) =>
      button.addEventListener('click', async () => {
        const accountId = Number(button.dataset.toggle);
        const member = profile.accounts.find((entry) => entry.account_id === accountId);
        button.disabled = true;
        try {
          if (member.state && member.state !== 'offline') {
            await api(`/profiles/${profile.id}/stop`, { method: 'POST', body: { accounts: [accountId] } });
          } else {
            const result = await api(`/profiles/${profile.id}/start`, {
              method: 'POST',
              body: { accounts: [accountId] },
            });
            const failed = result.results.find((entry) => !entry.ok);
            if (failed) throw new Error(failed.error);
          }
        } catch (error) {
          fail(error);
        } finally {
          button.disabled = false;
        }
      })
    );

    $$('[data-note]').forEach((button) =>
      button.addEventListener('click', async () => {
        const accountId = Number(button.dataset.note);
        const member = profile.accounts.find((entry) => entry.account_id === accountId);
        const data = await formDialog(member.name, [
          { key: 'note', label: tr('common.edit'), value: member.note || '' },
        ]);
        if (!data) return;
        await api(`/profiles/${profile.id}/accounts/${accountId}`, { method: 'PATCH', body: data });
        await refresh({ accounts: false });
        draw();
      })
    );

    $$('[data-detach]').forEach((button) =>
      button.addEventListener('click', async () => {
        const accountId = Number(button.dataset.detach);
        const member = profile.accounts.find((entry) => entry.account_id === accountId);
        if (!(await confirmDialog(`${member.name} — ${tr('srv.remove')}?`, { confirm: tr('common.delete') })))
          return;
        await api(`/profiles/${profile.id}/accounts/${accountId}`, { method: 'DELETE' });
        await refresh({ accounts: false });
        draw();
      })
    );
  };

  function row(member) {
    const bot = state.bots.get(`${profile.id}:${member.account_id}`) || member;
    const running = bot.state && bot.state !== 'offline';
    return `<tr>
      <td><input type="checkbox" data-pick="${member.account_id}" aria-label="${escapeHtml(member.name)}"></td>
      <td><span class="row"><img class="head" src="${escapeHtml(member.head)}" alt="" loading="lazy">
        <span>${escapeHtml(member.name)}
        ${
          member.account_status === 'error'
            ? `<span class="pill missing" style="margin-left:.4rem">${escapeHtml(tr('acc.error'))}</span>`
            : ''
        }</span></span></td>
      <td>${stateBadge(bot.state || 'offline', bot.detail || bot.last_error || '')}</td>
      <td class="mono small muted">${running && bot.since ? since(bot.since) : '–'}</td>
      <td class="small muted">${escapeHtml(member.note || '')}
        <button class="btn btn-ghost btn-sm" data-note="${member.account_id}">${icon('settings')}</button></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm ${running ? '' : 'btn-primary'}" data-toggle="${member.account_id}"
          ${running || profile.active ? '' : 'disabled'}>
          ${escapeHtml(running ? tr('ov.stop') : tr('ov.start'))}</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-detach="${member.account_id}">${icon('x')}</button>
      </td>
    </tr>`;
  }

  function picked() {
    const ids = $$('[data-pick]:checked').map((box) => Number(box.dataset.pick));
    return ids.length ? ids : profile.accounts.map((member) => member.account_id);
  }

  async function act(what) {
    const accounts = picked();
    if (!accounts.length) return toast(tr('srv.noAccounts'));
    try {
      const result = await api(`/profiles/${profile.id}/${what}`, { method: 'POST', body: { accounts } });
      const failures = (result.results || []).filter((entry) => !entry.ok);
      for (const failure of failures) {
        const member = profile.accounts.find((entry) => entry.account_id === failure.account_id);
        toast(`${member?.name || failure.account_id}: ${failure.error}`, 'bad');
      }
      if (!failures.length) ok(what === 'stop' ? tr('ov.stoppedAll') : tr('ov.started'));
    } catch (error) {
      fail(error);
    }
  }

  async function attach() {
    if (!free.length) return toast(tr('common.none'));
    const data = await formDialog(
      tr('srv.addAccounts'),
      [
        {
          key: 'account_id',
          label: tr('ov.col.account'),
          type: 'select',
          value: free[0].id,
          options: free.map((account) => ({ value: account.id, label: account.name })),
        },
        { key: 'note', label: `${tr('common.edit')} (${tr('common.optional')})`, value: '' },
      ],
      { submit: tr('common.create') }
    );
    if (!data) return;
    try {
      await api(`/profiles/${profile.id}/accounts`, {
        method: 'POST',
        body: { account_id: Number(data.account_id), note: data.note },
      });
      await refresh({ accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  }

  paint();

  const redraw = debounce(async () => {
    if (state.route.tab !== 'connect') return;
    await refresh({ accounts: false });
    const fresh = profileById(profile.id);
    if (fresh) {
      profile.accounts = fresh.accounts;
      profile.online = fresh.online;
      paint();
    }
  }, 500);
  state.onLive = (event) => {
    if (event.type === 'state') redraw();
  };
}

// ---------------------------------------------------------------- Chat

async function tabChat(root, profile) {
  const members = profile.accounts;
  if (!members.length) return noAccounts(root, profile);

  const spam = (await api(`/profiles/${profile.id}/spam`)).spam;
  const receiverKey = `afk-chat-recv-${profile.id}`;
  let receivers = JSON.parse(localStorage.getItem(receiverKey) || '[]');
  if (!receivers.length) receivers = members.map((member) => member.account_id);

  root.innerHTML = `
    <div class="stack" style="gap:1.25rem">
      <section class="panel">
        <header>
          <h3>${escapeHtml(tr('tab.chat'))}</h3>
          <div class="row">
            <label class="check small"><input type="checkbox" id="autoscroll" checked> ${escapeHtml(
              tr('dash.live')
            )}</label>
            <button class="btn btn-ghost btn-sm" id="clear">${escapeHtml(tr('common.delete'))}</button>
          </div>
        </header>
        <div class="body" style="padding:0">
          <div class="row wrap" style="padding:.75rem 1.1rem;box-shadow:inset 0 -1px 0 var(--line-soft)">
            ${members
              .map(
                (member) => `<label class="check small">
                  <input type="checkbox" data-recv="${member.account_id}"
                    ${receivers.includes(member.account_id) ? 'checked' : ''}>
                  ${escapeHtml(member.name)}</label>`
              )
              .join('')}
          </div>
          <div class="console" id="chat" data-empty="${escapeHtml(tr('srv.chatEmpty'))}" style="height:min(52vh,32rem);border-radius:0;box-shadow:none"></div>
          <div class="row" style="padding:.75rem 1.1rem;gap:.5rem">
            <input type="text" id="msg" placeholder="${escapeHtml(tr('srv.chatPlaceholder'))}"
              autocomplete="off" aria-label="${escapeHtml(tr('tab.chat'))}">
            <select id="sender" style="width:auto;min-width:9rem">
              <option value="">${escapeHtml(tr('srv.chatAll'))}</option>
              ${members
                .map((member) => `<option value="${member.account_id}">${escapeHtml(member.name)}</option>`)
                .join('')}
            </select>
            <button class="btn btn-primary" id="send">${escapeHtml(tr('srv.chatSend'))}</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('srv.spam'))}</h3>
          <button class="btn btn-sm btn-primary" id="add-spam">${icon('plus')}</button></header>
        <div class="body" style="padding:0">
          ${
            spam.length
              ? `<div class="table-wrap"><table class="table">
                  <thead><tr><th>${escapeHtml(tr('tk.message'))}</th><th></th>
                    <th>${escapeHtml(tr('ov.col.account'))}</th><th></th><th></th></tr></thead>
                  <tbody>${spam.map(spamRow).join('')}</tbody></table></div>`
              : `<p class="muted small" style="padding:1.25rem">${escapeHtml(tr('common.none'))}
                 <span class="mono">/afk</span> · 300 s</p>`
          }
        </div>
      </section>
    </div>`;

  function spamRow(entry) {
    const names = entry.accounts.length
      ? entry.accounts
          .map((id) => members.find((member) => member.account_id === id)?.name || id)
          .join(', ')
      : tr('common.all');
    return `<tr>
      <td class="mono">${escapeHtml(entry.message)}</td>
      <td class="mono small">${entry.interval_sec} s</td>
      <td class="small muted">${escapeHtml(names)}</td>
      <td><span class="switch" role="switch" tabindex="0" aria-checked="${entry.enabled}"
        data-spam-toggle="${entry.id}"></span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" data-spam-test="${entry.id}">${escapeHtml(tr('srv.chatSend'))}</button>
        <button class="btn btn-sm" data-spam-edit="${entry.id}">${escapeHtml(tr('common.edit'))}</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-spam-del="${entry.id}">${icon('trash')}</button>
      </td>
    </tr>`;
  }

  const box = $('#chat');
  const autoscroll = $('#autoscroll');

  const paint = () => {
    const lines = [];
    for (const member of members) {
      if (!receivers.includes(member.account_id)) continue;
      for (const entry of linesOf(`${profile.id}:${member.account_id}`)) {
        lines.push({ ...entry, who: member.name });
      }
    }
    lines.sort((a, b) => a.t - b.t);
    box.innerHTML = lines
      .slice(-400)
      .map(
        (entry) => `<div class="line ${entry.type}">
          <span class="t">${clock(entry.t)}</span>
          ${members.length > 1 ? `<span class="who">${escapeHtml(entry.who)}</span>` : ''}
          <span class="msg">${escapeHtml(entry.text)}</span></div>`
      )
      .join('');
    if (autoscroll.checked) box.scrollTop = box.scrollHeight;
  };

  // Verlauf vom Server holen – der Zwischenspeicher im Browser ist nach einem Neuladen leer.
  try {
    const data = await api(`/profiles/${profile.id}/chat`);
    for (const line of data.lines) {
      const key = `${profile.id}:${line.account_id}`;
      const list = state.lines.get(key) || [];
      if (!list.some((entry) => entry.t === line.t && entry.text === line.text)) {
        list.push({ t: line.t, type: line.type, text: line.text });
      }
      state.lines.set(key, list);
    }
    for (const [key, list] of state.lines) {
      list.sort((a, b) => a.t - b.t);
      state.lines.set(key, list);
    }
  } catch {
    /* Verlauf ist nur Beiwerk */
  }
  paint();

  $$('[data-recv]').forEach((node) =>
    node.addEventListener('change', () => {
      receivers = $$('[data-recv]:checked').map((entry) => Number(entry.dataset.recv));
      localStorage.setItem(receiverKey, JSON.stringify(receivers));
      paint();
    })
  );

  $('#clear').addEventListener('click', () => {
    for (const member of members) state.lines.set(`${profile.id}:${member.account_id}`, []);
    paint();
  });

  const send = async () => {
    const input = $('#msg');
    const text = input.value.trim();
    if (!text) return;
    const sender = $('#sender').value;
    const accounts = sender ? [Number(sender)] : receivers;
    input.value = '';
    try {
      const result = await api(`/profiles/${profile.id}/chat`, { method: 'POST', body: { text, accounts } });
      const failures = result.results.filter((entry) => !entry.ok);
      if (failures.length === result.results.length) toast(failures[0].error, 'bad');
    } catch (error) {
      fail(error);
      input.value = text;
    }
  };
  $('#send').addEventListener('click', send);
  $('#msg').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send();
  });

  $('#add-spam').addEventListener('click', () => editSpam(profile, members, null));
  $$('[data-spam-edit]').forEach((button) =>
    button.addEventListener('click', () =>
      editSpam(profile, members, spam.find((entry) => entry.id === Number(button.dataset.spamEdit)))
    )
  );
  $$('[data-spam-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      await api(`/profiles/${profile.id}/spam/${button.dataset.spamDel}`, { method: 'DELETE' });
      draw();
    })
  );
  $$('[data-spam-test]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        await api(`/profiles/${profile.id}/spam/${button.dataset.spamTest}/test`, { method: 'POST' });
        ok(tr('srv.saved'));
      } catch (error) {
        fail(error);
      }
    })
  );
  bindSwitches('[data-spam-toggle]', (id, enabled) =>
    api(`/profiles/${profile.id}/spam/${id}`, { method: 'PATCH', body: { enabled } })
  );

  state.onLive = (event) => {
    if (event.type === 'line' && event.key.startsWith(`${profile.id}:`)) paint();
  };
}

async function editSpam(profile, members, entry) {
  const data = await formDialog(
    tr('srv.spam'),
    [
      { key: 'message', label: tr('tk.message'), value: entry?.message || '/afk', required: true },
      {
        key: 'interval_sec',
        label: `${tr('common.month')} (s)`,
        type: 'number',
        min: 5,
        max: 86400,
        value: entry?.interval_sec ?? 300,
      },
      {
        key: 'accounts',
        label: tr('ov.col.account'),
        type: 'select',
        value: entry?.accounts?.length === 1 ? String(entry.accounts[0]) : '',
        options: [
          { value: '', label: tr('common.all') },
          ...members.map((member) => ({ value: String(member.account_id), label: member.name })),
        ],
      },
    ],
    { submit: tr('common.save') }
  );
  if (!data) return;
  const body = {
    message: data.message,
    interval_sec: Number(data.interval_sec),
    accounts: data.accounts ? [Number(data.accounts)] : [],
  };
  try {
    if (entry) await api(`/profiles/${profile.id}/spam/${entry.id}`, { method: 'PATCH', body });
    else await api(`/profiles/${profile.id}/spam`, { method: 'POST', body });
    ok(tr('srv.saved'));
    draw();
  } catch (error) {
    fail(error);
  }
}

// ---------------------------------------------------------------- Bewegung

async function tabMovement(root, profile) {
  const members = profile.accounts;
  if (!members.length) return noAccounts(root, profile);

  root.innerHTML = `
    ${accountPicker(members)}

    <div class="grid two">
      <section class="panel">
        <header><h3>${escapeHtml(tr('srv.walk'))}</h3></header>
        <div class="body stack">
          <div class="padgrid">
            <span></span>
            <button class="btn" data-go="vor">↑</button>
            <span></span>
            <button class="btn" data-go="links">←</button>
            <button class="btn btn-danger" data-verb="stop">■</button>
            <button class="btn" data-go="rechts">→</button>
            <span></span>
            <button class="btn" data-go="zurück">↓</button>
            <span></span>
          </div>
          <div class="field" style="max-width:12rem">
            <label for="blocks">${escapeHtml(tr('srv.blocks'))}</label>
            <input id="blocks" type="number" min="1" max="64" value="3">
          </div>
          <div class="row wrap">
            <button class="btn btn-sm" data-verb="jump">${escapeHtml(tr('srv.jump'))}</button>
            <button class="btn btn-sm" data-verb="fall">${escapeHtml(tr('srv.fall'))}</button>
            <button class="btn btn-sm" data-verb="pos">${escapeHtml(tr('srv.pos'))}</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('srv.look'))}</h3></header>
        <div class="body stack">
          <div class="row wrap">
            <button class="btn btn-sm" data-look="nord">N</button>
            <button class="btn btn-sm" data-look="ost">E</button>
            <button class="btn btn-sm" data-look="sued">S</button>
            <button class="btn btn-sm" data-look="west">W</button>
            <button class="btn btn-sm" data-look="hoch">↑</button>
            <button class="btn btn-sm" data-look="runter">↓</button>
            <button class="btn btn-sm" data-look="gerade">—</button>
            <button class="btn btn-sm" data-look="um">↺</button>
          </div>
          <div class="row">
            <div class="field"><label for="yaw">Yaw</label>
              <input id="yaw" type="number" min="-180" max="180" value="0"></div>
            <div class="field"><label for="pitch">Pitch</label>
              <input id="pitch" type="number" min="-90" max="90" value="0"></div>
            <button class="btn" id="look-exact" style="align-self:flex-end">${escapeHtml(tr('common.save'))}</button>
          </div>
          <p class="small muted">${escapeHtml(tr('srv.lookHint'))}</p>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('srv.home'))}</h3></header>
        <div class="body stack">
          <p class="small muted">${escapeHtml(tr('srv.homeHint'))}</p>
          <div class="row wrap">
            <button class="btn btn-sm" data-home="set">${escapeHtml(tr('srv.homeSet'))}</button>
            <button class="btn btn-sm" data-home="go">${escapeHtml(tr('srv.homeGo'))}</button>
            <button class="btn btn-sm" data-home="on">${escapeHtml(tr('srv.on'))}</button>
            <button class="btn btn-sm" data-home="off">${escapeHtml(tr('srv.off'))}</button>
            <button class="btn btn-sm" data-home="">${escapeHtml(tr('common.status'))}</button>
            <button class="btn btn-sm btn-danger" data-home="clear">${escapeHtml(tr('common.delete'))}</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('srv.route'))}</h3></header>
        <div class="body stack">
          <p class="small muted">${escapeHtml(tr('srv.routeHint'))}</p>
          <div class="row wrap">
            <button class="btn btn-sm" data-route="rec">${escapeHtml(tr('srv.recStart'))}</button>
            <button class="btn btn-sm" data-route="stop">${escapeHtml(tr('srv.recStop'))}</button>
            <button class="btn btn-sm" data-route="">${escapeHtml(tr('common.status'))}</button>
          </div>
        </div>
      </section>

      ${
        profile.caps.sneak
          ? `<section class="panel">
              <header><h3>${escapeHtml(tr('srv.body'))}</h3></header>
              <div class="body stack">
                <div class="row wrap">
                  <button class="btn btn-sm" data-cmd="sneak|on">${escapeHtml(tr('srv.sneakOn'))}</button>
                  <button class="btn btn-sm" data-cmd="sneak|off">${escapeHtml(tr('srv.sneakOff'))}</button>
                  <button class="btn btn-sm" data-cmd="sprint|on">${escapeHtml(tr('srv.sprintOn'))}</button>
                  <button class="btn btn-sm" data-cmd="sprint|off">${escapeHtml(tr('srv.sprintOff'))}</button>
                  <button class="btn btn-sm" data-cmd="swing|">${escapeHtml(tr('srv.swing'))}</button>
                  <button class="btn btn-sm" data-cmd="use|">${escapeHtml(tr('srv.use'))}</button>
                </div>
                <div class="row">
                  <div class="field" style="max-width:8rem"><label for="slot">${escapeHtml(tr('srv.slot'))}</label>
                    <input id="slot" type="number" min="1" max="9" value="1"></div>
                  <button class="btn" id="hand" style="align-self:flex-end">${escapeHtml(tr('srv.hand'))}</button>
                </div>
              </div>
            </section>`
          : ''
      }

      ${
        profile.caps.antiafk
          ? `<section class="panel">
              <header><h3>${escapeHtml(tr('srv.antiafk'))}</h3></header>
              <div class="body stack">
                <p class="small muted">${escapeHtml(tr('srv.antiafkHint'))}</p>
                <div class="row wrap">
                  <button class="btn btn-sm" data-cmd="antiafk|on">${escapeHtml(tr('srv.on'))}</button>
                  <button class="btn btn-sm" data-cmd="antiafk|off">${escapeHtml(tr('srv.off'))}</button>
                  <button class="btn btn-sm" data-cmd="antiafk|">${escapeHtml(tr('common.status'))}</button>
                </div>
              </div>
            </section>`
          : ''
      }
    </div>

    ${logPanel()}`;

  const run = commandRunner(profile);

  $$('[data-go]').forEach((button) =>
    button.addEventListener('click', () => run('go', `${button.dataset.go} ${$('#blocks').value || 1}`))
  );
  $$('[data-verb]').forEach((button) => button.addEventListener('click', () => run(button.dataset.verb)));
  $$('[data-look]').forEach((button) => button.addEventListener('click', () => run('look', button.dataset.look)));
  $('#look-exact').addEventListener('click', () => run('look', `${$('#yaw').value} ${$('#pitch').value}`));
  $$('[data-home]').forEach((button) => button.addEventListener('click', () => run('home', button.dataset.home)));
  $$('[data-route]').forEach((button) => button.addEventListener('click', () => run('route', button.dataset.route)));
  $$('[data-cmd]').forEach((button) =>
    button.addEventListener('click', () => {
      const [verb, arg] = button.dataset.cmd.split('|');
      run(verb, arg);
    })
  );
  $('#hand')?.addEventListener('click', () => run('hand', $('#slot').value));

  bindLog(profile, members);
}

// ---------------------------------------------------------------- Anzeigetafel

async function tabBoard(root, profile) {
  const members = profile.accounts;
  if (!members.length) return noAccounts(root, profile);

  root.innerHTML = `
    ${accountPicker(members)}
    <div class="row wrap" style="margin-bottom:1rem">
      <button class="btn btn-primary btn-sm" data-cmd="board|">${escapeHtml(tr('tab.board'))}</button>
      <button class="btn btn-sm" data-cmd="tab|">${escapeHtml(tr('srv.tabList'))}</button>
    </div>
    <p class="small muted" style="margin-bottom:1rem">${escapeHtml(tr('srv.boardHint'))}</p>
    ${logPanel('28rem')}`;

  const run = commandRunner(profile);
  $$('[data-cmd]').forEach((button) =>
    button.addEventListener('click', () => {
      const [verb, arg] = button.dataset.cmd.split('|');
      run(verb, arg);
    })
  );
  bindLog(profile, members);
}

// ---------------------------------------------------------------- Menüs

async function tabMenu(root, profile) {
  const members = profile.accounts;
  if (!members.length) return noAccounts(root, profile);

  const open = members
    .map((member) => ({ member, bot: state.bots.get(`${profile.id}:${member.account_id}`) }))
    .filter((entry) => entry.bot?.menu);

  root.innerHTML = `
    ${accountPicker(members)}

    ${
      open.length
        ? `<section class="panel" style="margin-bottom:1.25rem">
            <header><h3>${escapeHtml(tr('srv.menuOpen'))}</h3></header>
            <div class="body stack">
              ${open
                .map(
                  (entry) => `<div class="row spread">
                    <span>${escapeHtml(entry.member.name)}</span>
                    <span class="mono small muted">${escapeHtml(entry.bot.menu.title || '')} ·
                      ${entry.bot.menu.slots || '?'} ${escapeHtml(tr('srv.slot'))}</span>
                  </div>`
                )
                .join('')}
            </div>
          </section>`
        : ''
    }

    <div class="grid two">
      <section class="panel">
        <header><h3>${escapeHtml(tr('tab.menu'))}</h3></header>
        <div class="body stack">
          <p class="small muted">${escapeHtml(tr('srv.menuHint'))}</p>
          <div class="row wrap">
            <button class="btn btn-sm" data-cmd="menu|">${escapeHtml(tr('common.status'))}</button>
            <button class="btn btn-sm btn-danger" data-cmd="close|">${escapeHtml(tr('srv.menuClose'))}</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('srv.menuClick'))}</h3></header>
        <div class="body stack">
          <div class="row">
            <div class="field" style="max-width:8rem"><label for="mslot">${escapeHtml(tr('srv.slot'))}</label>
              <input id="mslot" type="number" min="0" max="100" value="0"></div>
            <div class="field" style="max-width:10rem"><label for="mbutton">${escapeHtml(tr('srv.button'))}</label>
              <select id="mbutton">
                <option value="">${escapeHtml(tr('srv.left'))}</option>
                <option value="rechts">${escapeHtml(tr('srv.right'))}</option>
                <option value="shift">Shift</option>
              </select></div>
            <button class="btn btn-primary" id="click" style="align-self:flex-end">${escapeHtml(
              tr('srv.menuClick')
            )}</button>
          </div>
        </div>
      </section>
    </div>

    ${logPanel()}`;

  const run = commandRunner(profile);
  $$('[data-cmd]').forEach((button) =>
    button.addEventListener('click', () => {
      const [verb, arg] = button.dataset.cmd.split('|');
      run(verb, arg);
    })
  );
  $('#click').addEventListener('click', () =>
    run('click', `${$('#mslot').value} ${$('#mbutton').value}`.trim())
  );
  bindLog(profile, members);
}

// ---------------------------------------------------------------- Proxys

async function tabProxies(root, profile) {
  const data = await api('/proxies');

  if (!data.allowed) {
    root.innerHTML = `
      <div class="note warn" style="margin-bottom:1.25rem">${icon('info')}
        <div>${escapeHtml(tr('srv.proxyFree'))}</div></div>
      <a class="btn btn-primary" href="#/proxies">${icon('globe')} ${escapeHtml(tr('px.title'))}</a>`;
    return;
  }

  root.innerHTML = `
    ${
      data.proxies.length
        ? `<section class="panel"><div class="table-wrap"><table class="table">
            <thead><tr><th>${escapeHtml(tr('ov.col.account'))}</th><th>${escapeHtml(
              tr('px.title')
            )}</th></tr></thead>
            <tbody>${profile.accounts
              .map(
                (member) => `<tr>
                  <td><span class="row"><img class="head" src="${escapeHtml(member.head)}" alt="">${escapeHtml(
                    member.name
                  )}</span></td>
                  <td><select data-proxy="${member.account_id}" style="max-width:22rem">
                    <option value="">${escapeHtml(tr('common.none'))}</option>
                    ${data.proxies
                      .map(
                        (proxy) =>
                          `<option value="${proxy.id}" ${member.proxy_id === proxy.id ? 'selected' : ''}>
                            ${escapeHtml(proxy.label || `#${proxy.id}`)} · ${escapeHtml(proxy.kind)}://${escapeHtml(
                              proxy.host
                            )}:${proxy.port}</option>`
                      )
                      .join('')}
                  </select></td>
                </tr>`
              )
              .join('')}</tbody></table></div></section>`
        : `<div class="empty"><h3>${escapeHtml(tr('px.none'))}</h3>
            <p>${escapeHtml(tr('px.requestNote'))}</p>
            <a class="btn btn-primary" href="#/proxies">${escapeHtml(tr('px.request'))}</a></div>`
    }`;

  $$('[data-proxy]').forEach((select) =>
    select.addEventListener('change', async () => {
      try {
        await api(`/profiles/${profile.id}/accounts/${select.dataset.proxy}`, {
          method: 'PATCH',
          body: { proxy_id: select.value ? Number(select.value) : null },
        });
        ok(tr('srv.saved'));
      } catch (error) {
        fail(error);
      }
    })
  );
}

// ---------------------------------------------------------------- Macros

async function tabMacros(root, profile) {
  const { macros } = await api(`/profiles/${profile.id}/macros`);
  const events = Object.fromEntries(state.meta.events.map((event) => [event.type, event.label]));

  root.innerHTML = `
    <div class="row spread" style="margin-bottom:1rem">
      <p class="small muted" style="max-width:44rem">${escapeHtml(tr('srv.macroHint'))}</p>
      <button class="btn btn-primary btn-sm" id="add-macro">${icon('plus')} ${escapeHtml(
        tr('srv.newMacro')
      )}</button>
    </div>

    ${
      macros.length
        ? `<div class="stack">${macros.map(macroCard).join('')}</div>`
        : `<div class="empty"><h3>${escapeHtml(tr('common.none'))}</h3>
            <p>${escapeHtml(tr('srv.macroExample'))}</p>
            <button class="btn btn-primary" id="add-macro-2">${icon('plus')} ${escapeHtml(
              tr('srv.newMacro')
            )}</button></div>`
    }`;

  function macroCard(macro) {
    const summary = macro.actions
      .map((action) => {
        if (action.type === 'chat') return `"${action.text}"`;
        if (action.type === 'wait') return `${action.seconds} s`;
        if (action.type === 'move') return `${action.direction} ${action.blocks}`;
        if (action.type === 'look') return `${action.yaw}/${action.pitch}`;
        return action.type;
      })
      .join(' → ');
    const when =
      macro.event === 'timer'
        ? `${macro.config.interval_sec || 300} s`
        : macro.event === 'chat'
          ? `"${macro.config.contains || macro.config.regex || '…'}"`
          : events[macro.event] || macro.event;
    return `<article class="card">
      <div class="row spread">
        <div>
          <div class="strong">${escapeHtml(macro.name)}</div>
          <div class="small muted">${escapeHtml(when)} · ${macro.actions.length} ·
            ${escapeHtml(macro.accounts.length ? `${macro.accounts.length}` : tr('common.all'))}</div>
        </div>
        <span class="switch" role="switch" tabindex="0" aria-checked="${macro.enabled}"
          data-macro-toggle="${macro.id}"></span>
      </div>
      <p class="small mono muted" style="margin-top:.75rem">${escapeHtml(summary || '–')}</p>
      <div class="row" style="margin-top:1rem">
        <button class="btn btn-sm" data-macro-test="${macro.id}">${escapeHtml(tr('srv.chatSend'))}</button>
        <button class="btn btn-sm" data-macro-edit="${macro.id}">${escapeHtml(tr('common.edit'))}</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-macro-del="${macro.id}">${icon('trash')}</button>
      </div>
    </article>`;
  }

  $('#add-macro')?.addEventListener('click', () => editMacro(profile, null));
  $('#add-macro-2')?.addEventListener('click', () => editMacro(profile, null));
  $$('[data-macro-edit]').forEach((button) =>
    button.addEventListener('click', () =>
      editMacro(profile, macros.find((macro) => macro.id === Number(button.dataset.macroEdit)))
    )
  );
  $$('[data-macro-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      await api(`/profiles/${profile.id}/macros/${button.dataset.macroDel}`, { method: 'DELETE' });
      draw();
    })
  );
  $$('[data-macro-test]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        await api(`/profiles/${profile.id}/macros/${button.dataset.macroTest}/test`, { method: 'POST' });
        ok(tr('srv.saved'));
      } catch (error) {
        fail(error);
      }
    })
  );
  bindSwitches('[data-macro-toggle]', (id, enabled) =>
    api(`/profiles/${profile.id}/macros/${id}`, { method: 'PATCH', body: { enabled } })
  );
}

/** Macro-Editor: Auslöser oben, darunter die Schritte in der Reihenfolge, in der sie laufen. */
async function editMacro(profile, macro) {
  const actions = structuredClone(macro?.actions || [{ type: 'chat', text: '/afk' }]);
  // Nur Schritte anbieten, die dieser Serverplatz auch ausführen kann.
  const available = state.meta.actions.filter((action) => !action.needs || profile.caps[action.needs]);

  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <header><h3>${escapeHtml(macro ? tr('common.edit') : tr('srv.newMacro'))}</h3></header>
    <div class="body"><div class="stack" id="editor"></div></div>
    <footer>
      <button class="btn" id="cancel">${escapeHtml(tr('common.cancel'))}</button>
      <button class="btn btn-primary" id="save">${escapeHtml(tr('common.save'))}</button>
    </footer>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
  $('#cancel', dialog).addEventListener('click', () => dialog.close());

  const paint = () => {
    const event = $('#event', dialog)?.value || macro?.event || 'join';
    $('#editor', dialog).innerHTML = `
      <div class="field">
        <label for="name">${escapeHtml(tr('common.name'))}</label>
        <input id="name" value="${escapeHtml(macro?.name || '')}">
      </div>

      <div class="field">
        <label for="event">${escapeHtml(tr('srv.trigger'))}</label>
        <select id="event">
          ${state.meta.events
            .map(
              (entry) =>
                `<option value="${entry.type}" ${entry.type === event ? 'selected' : ''}>${escapeHtml(
                  entry.label
                )}</option>`
            )
            .join('')}
        </select>
      </div>

      ${
        event === 'timer'
          ? `<div class="field"><label for="interval">${escapeHtml(tr('srv.intervalSec'))}</label>
              <input id="interval" type="number" min="5" max="86400"
                value="${macro?.config?.interval_sec ?? 300}"></div>`
          : ''
      }
      ${
        event === 'chat'
          ? `<div class="field"><label for="contains">${escapeHtml(tr('srv.chatContains'))}</label>
              <input id="contains" value="${escapeHtml(macro?.config?.contains || '')}">
              <span class="hint">${escapeHtml(tr('srv.chatContainsHint'))}</span></div>
             <div class="field"><label for="regex">${escapeHtml(tr('srv.chatRegex'))}</label>
              <input id="regex" value="${escapeHtml(macro?.config?.regex || '')}">
              <span class="hint">${escapeHtml(tr('srv.chatRegexHint'))}</span></div>`
          : ''
      }

      <div class="field">
        <label for="accounts">${escapeHtml(tr('ov.col.account'))}</label>
        <select id="accounts">
          <option value="">${escapeHtml(tr('common.all'))}</option>
          ${profile.accounts
            .map(
              (member) =>
                `<option value="${member.account_id}" ${
                  macro?.accounts?.length === 1 && macro.accounts[0] === member.account_id ? 'selected' : ''
                }>${escapeHtml(member.name)}</option>`
            )
            .join('')}
        </select>
      </div>

      <div>
        <div class="row spread" style="margin-bottom:.5rem">
          <span class="strong small">${escapeHtml(tr('srv.steps'))}</span>
          <button class="btn btn-sm" id="add-step">${icon('plus')}</button>
        </div>
        <div class="stack" id="steps">${
          actions.map(stepRow).join('') || `<p class="small muted">${escapeHtml(tr('common.none'))}</p>`
        }</div>
      </div>`;

    $('#event', dialog).addEventListener('change', paint);
    $('#add-step', dialog).addEventListener('click', () => {
      actions.push({ type: 'chat', text: '' });
      paint();
    });
    bindSteps();
  };

  function stepRow(action, index) {
    const definition = available.find((entry) => entry.type === action.type) || available[0];
    const fields = (definition.fields || [])
      .map((field) => {
        const value = action[field.key] ?? (field.type === 'number' ? field.min ?? 1 : '');
        if (field.type === 'select') {
          return `<div class="field"><label>${escapeHtml(field.label)}</label>
            <select data-step="${index}" data-key="${field.key}">
              ${field.options
                .map(
                  (option) =>
                    `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(
                      option
                    )}</option>`
                )
                .join('')}</select></div>`;
        }
        return `<div class="field"><label>${escapeHtml(field.label)}</label>
          <input data-step="${index}" data-key="${field.key}" type="${
            field.type === 'number' ? 'number' : 'text'
          }" value="${escapeHtml(value)}"
            ${field.min !== undefined ? `min="${field.min}"` : ''}
            ${field.max !== undefined ? `max="${field.max}"` : ''}></div>`;
      })
      .join('');

    return `<div class="card tight">
      <div class="row spread">
        <div class="row">
          <span class="mono small muted">${String(index + 1).padStart(2, '0')}</span>
          <select data-step="${index}" data-key="type" style="width:auto">
            ${available
              .map(
                (entry) =>
                  `<option value="${entry.type}" ${entry.type === action.type ? 'selected' : ''}>${escapeHtml(
                    entry.label
                  )}</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="row">
          <button class="btn btn-ghost btn-sm" data-up="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn-ghost btn-sm" data-down="${index}" ${
            index === actions.length - 1 ? 'disabled' : ''
          }>↓</button>
          <button class="btn btn-ghost btn-sm btn-danger" data-del-step="${index}">${icon('x')}</button>
        </div>
      </div>
      ${fields ? `<div class="row wrap" style="margin-top:.6rem;align-items:flex-end">${fields}</div>` : ''}
      <div class="field" style="margin-top:.6rem;max-width:12rem">
        <label>${escapeHtml(tr('srv.waitBefore'))}</label>
        <input data-step="${index}" data-key="delay" type="number" min="0" max="3600" value="${
          action.delay ?? 0
        }">
      </div>
    </div>`;
  }

  function bindSteps() {
    $$('[data-step]', dialog).forEach((input) =>
      input.addEventListener('change', () => {
        const index = Number(input.dataset.step);
        const key = input.dataset.key;
        if (key === 'type') {
          actions[index] = { type: input.value };
          paint();
          return;
        }
        const value = input.type === 'number' ? Number(input.value) : input.value;
        if (key === 'delay' && !value) delete actions[index].delay;
        else actions[index][key] = value;
      })
    );
    $$('[data-del-step]', dialog).forEach((button) =>
      button.addEventListener('click', () => {
        actions.splice(Number(button.dataset.delStep), 1);
        paint();
      })
    );
    $$('[data-up]', dialog).forEach((button) =>
      button.addEventListener('click', () => {
        const index = Number(button.dataset.up);
        [actions[index - 1], actions[index]] = [actions[index], actions[index - 1]];
        paint();
      })
    );
    $$('[data-down]', dialog).forEach((button) =>
      button.addEventListener('click', () => {
        const index = Number(button.dataset.down);
        [actions[index + 1], actions[index]] = [actions[index], actions[index + 1]];
        paint();
      })
    );
  }

  paint();

  $('#save', dialog).addEventListener('click', async () => {
    const event = $('#event', dialog).value;
    const config = {};
    if (event === 'timer') config.interval_sec = Number($('#interval', dialog).value);
    if (event === 'chat') {
      // Beide Felder mitschicken, sonst verschwindet beim Speichern still, was gerade nicht
      // im Formular stand.
      config.contains = $('#contains', dialog).value.trim();
      config.regex = $('#regex', dialog).value.trim();
    }
    const accountValue = $('#accounts', dialog).value;

    const body = {
      name: $('#name', dialog).value,
      event,
      config,
      accounts: accountValue ? [Number(accountValue)] : [],
      actions: actions.map((action) => {
        const clean = { type: action.type };
        if (action.delay) clean.delay = Number(action.delay);
        for (const field of state.meta.actions.find((entry) => entry.type === action.type)?.fields || []) {
          clean[field.key] =
            field.type === 'number' ? Number(action[field.key] ?? field.min ?? 1) : action[field.key] ?? '';
        }
        return clean;
      }),
    };

    try {
      if (macro) await api(`/profiles/${profile.id}/macros/${macro.id}`, { method: 'PATCH', body });
      else await api(`/profiles/${profile.id}/macros`, { method: 'POST', body });
      dialog.close();
      ok(tr('srv.saved'));
      draw();
    } catch (error) {
      fail(error);
    }
  });
}

// ---------------------------------------------------------------- Tarif

async function tabPlan(root, profile) {
  const plans = state.meta.plans || [];
  const freeLeft = state.stats?.free_slots_left ?? 0;

  root.innerHTML = `
    <div class="grid four" style="margin-bottom:1.5rem">
      <div class="stat"><div class="k">${escapeHtml(tr('srv.plan'))}</div>
        <div class="v" style="font-size:1.5rem">${escapeHtml(profile.plan.name)}</div>
        <div class="s">${
          profile.plan.free_slot
            ? escapeHtml(tr('common.forever'))
            : `${credits(profile.plan.price_credits)} / ${state.meta.month_days} ${escapeHtml(tr('common.days'))}`
        }</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('common.status'))}</div>
        <div class="v" style="font-size:1.5rem">${
          profile.suspended ? escapeHtml(tr('tk.status.closed')) : escapeHtml(tr('state.online'))
        }</div>
        <div class="s">${
          profile.paid_until ? escapeHtml(tr('srv.daysLeft', { n: profile.days_left })) : '–'
        }</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('common.month'))}</div>
        <div class="v" style="font-size:1.5rem">${
          profile.paid_until ? date(profile.paid_until) : '–'
        }</div>
        <div class="s">${escapeHtml(profile.renew ? tr('srv.renewOn') : tr('srv.renewOff'))}</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('ov.builds'))}</div>
        <div class="v" style="font-size:1.5rem">${escapeHtml(profile.build || '–')}</div>
        <div class="s">${Object.keys(profile.caps)
          .filter((key) => profile.caps[key])
          .slice(0, 4)
          .map(escapeHtml)
          .join(', ')}</div></div>
    </div>

    ${
      profile.suspended
        ? `<div class="note warn" style="margin-bottom:1.25rem">${icon('alert')}
            <div>${escapeHtml(tr('srv.suspended'))}</div></div>
           <button class="btn btn-primary" id="resume" style="margin-bottom:1.5rem">${escapeHtml(
             tr('srv.resume')
           )}</button>`
        : ''
    }

    <div class="plans-grid">
      ${plans
        .map(
          (plan) => `<article class="card ${plan.id === profile.plan.id ? 'is-current' : ''}">
            <div class="row spread">
              <h3>${escapeHtml(plan.name)}</h3>
              ${
                plan.id === profile.plan.id
                  ? `<span class="pill primary">${escapeHtml(tr('common.status'))}</span>`
                  : ''
              }
            </div>
            <p class="price-line">${
              plan.free_slot
                ? escapeHtml(tr('common.free'))
                : `${credits(plan.price_credits)} <span class="small muted">${escapeHtml(
                    tr('pricing.perServer')
                  )}</span>`
            }</p>
            <p class="small muted">${escapeHtml(plan.blurb || '')}</p>
            <ul class="small stack" style="margin:1rem 0 0;padding:0;list-style:none">
              <li>${plan.max_accounts} ${escapeHtml(
                tr(plan.max_accounts === 1 ? 'pricing.bot' : 'pricing.bots')
              )}</li>
              <li>${escapeHtml(tr(plan.premium ? 'pricing.premiumClient' : 'pricing.slimClient'))}</li>
              <li>${plan.chat_limit} ${escapeHtml(tr('pricing.chatHistory'))}</li>
              ${plan.proxy ? `<li>${escapeHtml(tr('pricing.proxyOnRequest'))}</li>` : ''}
            </ul>
            ${
              plan.id === profile.plan.id
                ? ''
                : `<button class="btn btn-primary btn-block" style="margin-top:1.25rem"
                     data-plan="${plan.id}"
                     ${plan.free_slot && freeLeft <= 0 ? 'disabled' : ''}>${escapeHtml(
                       tr('srv.changePlan')
                     )}</button>`
            }
          </article>`
        )
        .join('')}
    </div>

    ${
      profile.plan.free_slot
        ? ''
        : `<section class="panel" style="margin-top:1.5rem">
            <header><h3>${escapeHtml(tr('srv.renewOn'))}</h3></header>
            <div class="body row spread">
              <p class="small muted" style="max-width:34rem">${escapeHtml(tr('faq.3.a'))}</p>
              <span class="switch" role="switch" tabindex="0" aria-checked="${profile.renew}"
                data-renew="${profile.id}"></span>
            </div>
          </section>`
    }`;

  $('#resume')?.addEventListener('click', async () => {
    try {
      await api(`/profiles/${profile.id}/resume`, { method: 'POST' });
      await refresh({ accounts: false });
      ok(tr('srv.saved'));
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $$('[data-plan]').forEach((button) =>
    button.addEventListener('click', async () => {
      const plan = plans.find((entry) => entry.id === Number(button.dataset.plan));
      const question = plan.free_slot
        ? tr('srv.changePlan')
        : `${tr('srv.changePlan')}: ${plan.name} — ${plan.price_credits} ${tr('common.credits')}`;
      if (!(await confirmDialog(question, { confirm: tr('srv.changePlan'), danger: false }))) return;
      try {
        await api(`/profiles/${profile.id}/plan`, { method: 'POST', body: { plan_id: plan.id } });
        await refresh({ accounts: false });
        ok(tr('srv.planChanged'));
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  bindSwitches('[data-renew]', (id, enabled) =>
    api(`/profiles/${id}`, { method: 'PATCH', body: { renew: enabled } })
  );
}

// ---------------------------------------------------------------- Einstellungen

async function tabSettings(root, profile) {
  const plan = profile.plan;

  root.innerHTML = `
    <div class="grid two" style="align-items:start">
      <section class="panel">
        <header><h3>${escapeHtml(tr('dash.servers'))}</h3></header>
        <div class="body stack">
          <div class="field"><label for="name">${escapeHtml(tr('srv.name'))}</label>
            <input id="name" value="${escapeHtml(profile.name)}"></div>
          <div class="field"><label for="address">${escapeHtml(tr('srv.address'))}</label>
            <input id="address" value="${escapeHtml(profile.address)}">
            <span class="hint">${escapeHtml(tr('srv.addressHint'))}</span></div>
          <div class="field"><label for="mc_version">${escapeHtml(tr('srv.version'))}</label>
            <select id="mc_version">${state.meta.versions
              .map(
                (version) =>
                  `<option ${version === profile.mc_version ? 'selected' : ''}>${escapeHtml(version)}</option>`
              )
              .join('')}</select></div>
          <div class="field"><label for="chat_limit">${escapeHtml(tr('srv.chatLimit'))}</label>
            <input id="chat_limit" type="number" min="20" max="${plan.chat_limit}"
              value="${profile.chat_limit}" ${plan.chat_limit_editable ? '' : 'disabled'}>
            <span class="hint">${escapeHtml(
              plan.chat_limit_editable
                ? `≤ ${plan.chat_limit}`
                : tr('srv.chatLimitLocked', { n: plan.chat_limit })
            )}</span></div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('srv.behaviour'))}</h3></header>
        <div class="body stack">
          <div class="field"><label for="join_delay">${escapeHtml(tr('srv.joinDelay'))}</label>
            <input id="join_delay" type="number" min="0" max="600" value="${profile.join_delay}"></div>
          <label class="check"><input type="checkbox" id="auto_reconnect" ${
            profile.auto_reconnect ? 'checked' : ''
          }> ${escapeHtml(tr('srv.autoReconnect'))}</label>
          <div class="row">
            <div class="field"><label for="reconnect_delay">${escapeHtml(tr('srv.firstWait'))}</label>
              <input id="reconnect_delay" type="number" min="1" max="600" value="${profile.reconnect_delay}"></div>
            <div class="field"><label for="max_backoff">${escapeHtml(tr('srv.maxWait'))}</label>
              <input id="max_backoff" type="number" min="1" max="3600" value="${profile.max_backoff}"></div>
          </div>
          <div class="field"><label for="chat_delay">${escapeHtml(tr('srv.chatDelay'))}</label>
            <input id="chat_delay" type="number" min="200" max="60000" value="${profile.chat_delay}"></div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('tab.movement'))}</h3>
          ${plan.premium ? '' : `<span class="pill missing">${escapeHtml(tr('common.paidSlot'))}</span>`}
        </header>
        <div class="body stack">
          <label class="check"><input type="checkbox" id="movement" ${profile.movement ? 'checked' : ''}
            ${plan.movement ? '' : 'disabled'}> ${escapeHtml(tr('srv.useMovement'))}</label>
          <div class="field"><label for="antiafk_sec">${escapeHtml(tr('srv.antiafk'))} (s)</label>
            <input id="antiafk_sec" type="number" min="0" max="3600" value="${profile.antiafk_sec || 0}"
              ${plan.premium ? '' : 'disabled'}>
            <span class="hint">${escapeHtml(tr('srv.antiafkHint'))}</span></div>
          <label class="check"><input type="checkbox" id="sneak" ${profile.sneak ? 'checked' : ''}
            ${plan.premium ? '' : 'disabled'}> ${escapeHtml(tr('srv.sneakAlways'))}</label>
          ${plan.premium ? '' : `<p class="small muted">${escapeHtml(tr('srv.premiumOnly'))}</p>`}
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('srv.network'))}</h3></header>
        <div class="body stack">
          <div class="field"><label for="fake_host">${escapeHtml(tr('srv.fakehost'))}</label>
            <input id="fake_host" value="${escapeHtml(profile.fake_host || '')}"
              ${plan.fakehost ? '' : 'disabled'} placeholder="hub.example.net">
            <span class="hint">${escapeHtml(tr('srv.fakehostHint'))}</span></div>
          <div class="field"><label for="on_cooldown">${escapeHtml(tr('srv.onCooldown'))}</label>
            <input id="on_cooldown" type="number" min="1" max="3600" value="${profile.on_cooldown || 5}"></div>
        </div>
      </section>
    </div>

    <div class="row" style="margin-top:1.25rem">
      <button class="btn btn-primary" id="save">${escapeHtml(tr('common.save'))}</button>
      <span class="small muted" id="hint"></span>
    </div>

    <section class="panel" style="margin-top:2rem">
      <header><h3>${escapeHtml(tr('srv.danger'))}</h3></header>
      <div class="body row spread wrap" style="gap:1rem">
        <p class="small muted" style="max-width:38rem">${escapeHtml(tr('srv.deleteHint'))}</p>
        <button class="btn btn-danger" id="delete">${icon('trash')} ${escapeHtml(tr('common.delete'))}</button>
      </div>
    </section>`;

  $('#save').addEventListener('click', async () => {
    const body = {
      name: $('#name').value,
      address: $('#address').value,
      mc_version: $('#mc_version').value,
      join_delay: Number($('#join_delay').value),
      auto_reconnect: $('#auto_reconnect').checked,
      reconnect_delay: Number($('#reconnect_delay').value),
      max_backoff: Number($('#max_backoff').value),
      chat_delay: Number($('#chat_delay').value),
      on_cooldown: Number($('#on_cooldown').value),
    };
    if (plan.chat_limit_editable) body.chat_limit = Number($('#chat_limit').value);
    if (plan.movement) body.movement = $('#movement').checked;
    if (plan.premium) {
      body.antiafk_sec = Number($('#antiafk_sec').value);
      body.sneak = $('#sneak').checked;
    }
    if (plan.fakehost) body.fake_host = $('#fake_host').value;

    try {
      const result = await api(`/profiles/${profile.id}`, { method: 'PATCH', body });
      await refresh({ accounts: false });
      ok(tr('srv.saved'));
      $('#hint').textContent = result.restart_needed ? tr('srv.restartNeeded') : '';
    } catch (error) {
      fail(error);
    }
  });

  $('#delete').addEventListener('click', async () => {
    if (!(await confirmDialog(tr('srv.deleteAsk', { name: profile.name }), { confirm: tr('common.delete') })))
      return;
    await api(`/profiles/${profile.id}`, { method: 'DELETE' });
    await refresh();
    location.hash = '#/servers';
    draw();
  });
}

// ---------------------------------------------------------------- Gemeinsames

function noAccounts(root, profile) {
  root.innerHTML = `<div class="empty"><h3>${escapeHtml(tr('srv.noAccounts'))}</h3>
    <a class="btn btn-primary" href="#/servers/${profile.id}/connect">${escapeHtml(tr('tab.connect'))}</a></div>`;
}

function accountPicker(members) {
  return `<div class="row wrap" style="margin-bottom:1rem">
    ${members
      .map(
        (member) => `<label class="check small"><input type="checkbox" data-target="${member.account_id}" checked>
          ${escapeHtml(member.name)}</label>`
      )
      .join('')}
  </div>`;
}

/** Einen örtlichen Befehl an die ausgewählten Konten schicken. */
function commandRunner(profile) {
  return async (verb, arg = '') => {
    const accounts = $$('[data-target]:checked').map((box) => Number(box.dataset.target));
    if (!accounts.length) return toast(tr('srv.noAccounts'));
    try {
      const result = await api(`/profiles/${profile.id}/command`, {
        method: 'POST',
        body: { verb, arg, accounts },
      });
      const failures = result.results.filter((entry) => !entry.ok);
      if (failures.length === result.results.length) toast(failures[0].error, 'bad');
    } catch (error) {
      fail(error);
    }
  };
}

const logPanel = (height = '12rem') => `
  <section class="panel" style="margin-top:1.25rem">
    <header><h3>${escapeHtml(tr('srv.answers'))}</h3></header>
    <div class="body" style="padding:0">
      <div class="console" id="cmd-log" data-empty="${escapeHtml(tr('srv.logEmpty'))}" style="height:${height};border-radius:0;box-shadow:none"></div>
    </div>
  </section>`;

/** Die Antworten des Clients laufen als Zustandszeilen ein – hier gesammelt anzeigen. */
function bindLog(profile, members) {
  const log = $('#cmd-log');
  const paint = () => {
    const lines = [];
    for (const member of members) {
      for (const entry of linesOf(`${profile.id}:${member.account_id}`)) {
        if (entry.type === 'chat' || entry.type === 'sent') continue;
        lines.push({ ...entry, who: member.name });
      }
    }
    lines.sort((a, b) => a.t - b.t);
    log.innerHTML = lines
      .slice(-120)
      .map(
        (entry) => `<div class="line ${entry.type}"><span class="t">${clock(entry.t)}</span>
          <span class="who">${escapeHtml(entry.who)}</span><span class="msg">${escapeHtml(
            entry.text
          )}</span></div>`
      )
      .join('');
    log.scrollTop = log.scrollHeight;
  };
  paint();
  state.onLive = (event) => {
    if (event.type === 'line' && event.key.startsWith(`${profile.id}:`)) paint();
  };
}

/** Schalter, die sofort speichern – mit Tastatur bedienbar. */
function bindSwitches(selector, save) {
  $$(selector).forEach((node) => {
    const key = Object.values(node.dataset)[0];
    const toggle = async () => {
      const enabled = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(enabled));
      try {
        await save(key, enabled);
      } catch (error) {
        node.setAttribute('aria-checked', String(!enabled));
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
