// Übersicht: was läuft, was kostet es, wo hakt es.

import {
  icon,
  escapeHtml,
  credits,
  euro,
  since,
  stateBadge,
  safeLink,
  tr,
  $,
  $$,
  fail,
  ok,
  api,
  debounce,
} from '../ui.js';
import { state, appbar, refresh, drawSide, draw } from '../app.js';

export async function render(root) {
  const bots = [...state.bots.values()].filter((bot) => bot.state && bot.state !== 'offline');
  const online = bots.filter((bot) => bot.online).length;
  const monthly = state.me.monthly_cost || 0;
  const paidSlots = state.profiles.filter((profile) => !profile.plan?.free_slot).length;
  const monthsLeft = monthly > 0 ? Math.floor(state.me.credits / monthly) : null;
  const todos = state.todos || [];

  root.innerHTML = `
    ${appbar(
      tr('dash.hello', { name: state.me.username }),
      `<a class="btn btn-sm" href="#/accounts">${icon('plus')} ${escapeHtml(tr('ov.connectAccount'))}</a>
       <button class="btn btn-primary btn-sm" id="new-profile-2">${icon('server')} ${escapeHtml(tr('dash.newServer'))}</button>`,
      tr('dash.subtitle')
    )}

    ${todoPanel(todos)}

    <div class="grid four" style="margin-bottom:1.5rem">
      <div class="stat"><div class="k">${escapeHtml(tr('ov.inGame'))}</div><div class="v">${online}</div>
        <div class="s">${escapeHtml(tr('ov.ofRunning', { n: bots.length }))}</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('ov.balance'))}</div>
        <div class="v">${credits(state.me.credits)}</div>
        <div class="s">${escapeHtml(euro(state.me.credits))}</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('ov.monthly'))}</div>
        <div class="v">${credits(monthly)}</div>
        <div class="s">${escapeHtml(
          monthly > 0 ? tr('ov.monthsLeft', { n: monthsLeft }) : tr('ov.monthsPlenty')
        )}</div></div>
      <div class="stat"><div class="k">${escapeHtml(tr('ov.accounts'))}</div>
        <div class="v">${state.accounts.length}</div>
        <div class="s">${escapeHtml(tr('ov.serversCount', { n: state.profiles.length }))}</div></div>
    </div>

    <section class="panel" style="margin-bottom:1.5rem">
      <header>
        <h3>${escapeHtml(tr('ov.bots'))}</h3>
        <div class="row">
          <button class="btn btn-sm" id="stop-all" ${bots.length ? '' : 'disabled'}>${icon('stop')} ${escapeHtml(
            tr('ov.stopAll')
          )}</button>
        </div>
      </header>
      <div class="body" style="padding:0">
        ${
          state.profiles.length
            ? `<div class="table-wrap"><table class="table">
                <thead><tr>
                  <th>${escapeHtml(tr('ov.col.account'))}</th>
                  <th>${escapeHtml(tr('ov.col.server'))}</th>
                  <th>${escapeHtml(tr('common.status'))}</th>
                  <th>${escapeHtml(tr('ov.col.uptime'))}</th>
                  <th></th>
                </tr></thead>
                <tbody>${rows()}</tbody>
              </table></div>`
            : `<div class="empty" style="box-shadow:none;background:transparent">
                <h3>${escapeHtml(tr('ov.noServer.title'))}</h3>
                <p>${escapeHtml(tr('ov.noServer.text'))}</p>
                <button class="btn btn-primary" id="new-profile-3">${icon('plus')} ${escapeHtml(
                  tr('dash.newServer')
                )}</button>
              </div>`
        }
      </div>
    </section>

    <div class="grid two">
      <section class="panel">
        <header><h3>${escapeHtml(tr('ov.client'))}</h3></header>
        <div class="body stack">
          <div class="row spread"><span class="muted small">${escapeHtml(tr('ov.clientVersions'))}</span>
            <span class="mono">${state.meta.versions.map(escapeHtml).join(', ') || '–'}</span></div>
          <div class="row spread"><span class="muted small">${escapeHtml(tr('ov.builds'))}</span>
            <span class="row" style="gap:.35rem">${Object.entries(state.meta.builds || {})
              .map(
                ([name, present]) =>
                  `<span class="pill ${present ? 'primary' : 'missing'}">${escapeHtml(name)}</span>`
              )
              .join('')}</span></div>
          <div class="row spread"><span class="muted small">${escapeHtml(tr('bill.slots'))}</span>
            <span class="mono">${escapeHtml(
              tr('bill.slotsLine', {
                paid: paidSlots,
                free: state.profiles.length - paidSlots,
              })
            )}</span></div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('ov.quick'))}</h3></header>
        <div class="body stack">
          <a class="row spread" href="#/accounts">
            <span class="row">${icon('users')} ${escapeHtml(tr('ov.connectAccount'))}</span>${icon('arrow')}</a>
          <a class="row spread" href="#/credits">
            <span class="row">${icon('wallet')} ${escapeHtml(tr('bill.topUp'))}</span>${icon('arrow')}</a>
          <a class="row spread" href="#/tickets">
            <span class="row">${icon('ticket')} ${escapeHtml(tr('ov.openTicket'))}</span>${icon('arrow')}</a>
          <a class="row spread" href="#/settings">
            <span class="row">${icon('settings')} ${escapeHtml(tr('set.webhook'))}</span>${icon('arrow')}</a>
        </div>
      </section>
    </div>`;

  /**
   * Was offen ist – ganz oben, weil es der Grund ist, warum jemand hierher kommt.
   *
   * Ist nichts offen, steht hier auch nichts. Ein leerer Kasten mit "alles erledigt" wäre eine
   * Zeile, die jeden Tag da ist und nie etwas sagt – dann sieht man auch nicht mehr hin, wenn
   * einmal etwas darin steht. Die Zahl in der Seitenleiste erfüllt denselben Zweck ohne Fläche.
   *
   * Der Inhalt kommt vollständig vom Server (server/todos.js). Hier steht nur, wie er aussieht.
   */
  function todoPanel(list) {
    if (!list.length) return '';
    return `<section class="panel todo" style="margin-bottom:1.5rem">
      <header>
        <h3>${escapeHtml(tr('todo.title'))}</h3>
        <span class="small muted">${escapeHtml(tr('todo.count', { n: list.length }))}</span>
      </header>
      <ul class="todo-list">
        ${list.map(todoItem).join('')}
      </ul>
    </section>`;
  }

  function todoItem(entry) {
    const external = entry.external
      ? ' target="_blank" rel="noopener"'
      : '';
    return `<li class="todo-item ${entry.kind === 'info' ? '' : entry.kind}">
      <span class="todo-mark">${icon(entry.kind === 'bad' ? 'alert' : entry.kind === 'warn' ? 'clock' : 'info')}</span>
      <div class="todo-text">
        <strong>${escapeHtml(entry.title)}</strong>
        <p class="small muted">${escapeHtml(entry.text)}</p>
      </div>
      <a class="btn btn-sm ${entry.kind === 'bad' ? 'btn-primary' : ''}"
        href="${escapeHtml(safeLink(entry.href))}"${external}>${escapeHtml(entry.label)}</a>
    </li>`;
  }

  function rows() {
    const list = [];
    for (const profile of state.profiles) {
      for (const member of profile.accounts) {
        const bot = state.bots.get(`${profile.id}:${member.account_id}`) || member;
        list.push({ profile, member, bot });
      }
    }
    if (!list.length) {
      return `<tr><td colspan="5" class="muted small" style="padding:1.5rem;text-align:center">
        ${escapeHtml(tr('ov.noMembers'))}</td></tr>`;
    }
    // Laufende zuerst.
    list.sort((a, b) => Number(b.bot.online) - Number(a.bot.online));
    return list
      .map(
        ({ profile, member, bot }) => `<tr>
          <td><span class="row"><img class="head" src="${escapeHtml(member.head)}" alt="" loading="lazy">
            ${escapeHtml(member.name)}</span></td>
          <td><a href="#/servers/${profile.id}/connect" class="row" style="gap:.4rem">
            ${escapeHtml(profile.name)}<span class="small muted mono">${escapeHtml(profile.address)}</span></a></td>
          <td>${stateBadge(bot.state || 'offline', bot.detail || '')}</td>
          <td class="mono small muted">${bot.since && bot.state !== 'offline' ? since(bot.since) : '–'}</td>
          <td style="text-align:right">
            ${
              bot.state && bot.state !== 'offline'
                ? `<button class="btn btn-sm" data-stop="${profile.id}:${member.account_id}">${escapeHtml(
                    tr('ov.stop')
                  )}</button>`
                : `<button class="btn btn-sm btn-primary" data-start="${profile.id}:${member.account_id}"
                     ${profile.active ? '' : 'disabled'}>${escapeHtml(tr('ov.start'))}</button>`
            }
          </td>
        </tr>`
      )
      .join('');
  }

  for (const id of ['#new-profile-2', '#new-profile-3']) {
    $(id)?.addEventListener('click', () => import('./server.js').then((m) => m.newProfile()));
  }

  $$('[data-start]').forEach((button) =>
    button.addEventListener('click', async () => {
      const [profileId, accountId] = button.dataset.start.split(':').map(Number);
      button.disabled = true;
      try {
        const result = await api(`/profiles/${profileId}/start`, {
          method: 'POST',
          body: { accounts: [accountId] },
        });
        const failed = result.results.find((entry) => !entry.ok);
        if (failed) throw new Error(failed.error);
        ok(tr('ov.started'));
      } catch (error) {
        fail(error);
        button.disabled = false;
      }
    })
  );

  $$('[data-stop]').forEach((button) =>
    button.addEventListener('click', async () => {
      const [profileId, accountId] = button.dataset.stop.split(':').map(Number);
      button.disabled = true;
      try {
        await api(`/profiles/${profileId}/stop`, { method: 'POST', body: { accounts: [accountId] } });
      } catch (error) {
        fail(error);
        button.disabled = false;
      }
    })
  );

  $('#stop-all')?.addEventListener('click', async () => {
    for (const profile of state.profiles) {
      if (profile.accounts.some((member) => member.state !== 'offline')) {
        await api(`/profiles/${profile.id}/stop`, { method: 'POST', body: {} }).catch(() => {});
      }
    }
    ok(tr('ov.stoppedAll'));
  });

  // Zustandswechsel: neu zeichnen, aber gebündelt – beim Start mehrerer Bots kommen viele
  // Meldungen kurz hintereinander.
  const redraw = debounce(() => {
    if (state.route.name !== 'overview') return;
    refresh({ accounts: false }).then(() => {
      if (state.route.name === 'overview') draw();
    });
  }, 600);
  state.onLive = (event) => {
    if (event.type === 'state' || event.type === 'credits' || event.type === 'suspended') redraw();
  };
  drawSide();
}
