// Übersicht: was läuft, was kostet es, wo hakt es.

import {
  icon,
  escapeHtml,
  credits,
  euro,
  since,
  stateBadge,
  todoList,
  tr,
  $,
  $$,
  fail,
  ok,
  api,
  debounce,
} from '../ui.js';
import { state, appbar, refresh, drawSide, draw } from '../app.js';
import * as chart from '../charts.js';

/**
 * Die Zahlen für die Diagramme.
 *
 * Sie werden **einmal** geholt und dann behalten: Die Übersicht zeichnet sich bei jedem
 * Zustandswechsel eines Bots neu, und dabei jedes Mal einen Monat Kontoauszug durchzurechnen wäre
 * Arbeit für Zahlen, die sich in dieser Sekunde nicht geändert haben. Beim nächsten echten Öffnen
 * der Seite ist der Wert ohnehin wieder frisch.
 */
let insights = null;

export async function render(root) {
  const bots = [...state.bots.values()].filter((bot) => bot.state && bot.state !== 'offline');
  const online = bots.filter((bot) => bot.online).length;
  const monthly = state.me.monthly_cost || 0;
  const monthsLeft = monthly > 0 ? Math.floor(state.me.credits / monthly) : null;
  const todos = state.todos || [];
  if (!insights) insights = await api('/me/insights').catch(() => null);

  root.innerHTML = `
    ${appbar(
      tr('dash.hello', { name: state.me.username }),
      `<a class="btn btn-sm" href="#/accounts">${icon('plus')} ${escapeHtml(tr('ov.connectAccount'))}</a>
       <button class="btn btn-primary btn-sm" id="new-profile-2">${icon('server')} ${escapeHtml(tr('dash.newServer'))}</button>`,
      tr('dash.subtitle')
    )}

    ${onboarding()}

    ${todoList(todos)}

    <!-- Die Diagramme stehen dort, wo vorher vier Kacheln mit denselben Zahlen standen.
         Guthaben und Monatskosten hatten damit jeweils zwei Plätze auf derselben Seite – einmal
         als Zahl, einmal als Zahl mit Kurve. Die Kurve kann alles, was die Kachel konnte, und
         beantwortet zusätzlich die Frage, ob es rauf oder runter geht. -->
    ${charts()}

    <section class="panel" style="margin-bottom:1.5rem">
      <header>
        <h3>${escapeHtml(tr('ov.bots'))}</h3>
        <span class="small muted">${escapeHtml(
          tr('ov.inGameLine', { online, n: bots.length, accounts: state.accounts.length })
        )}</span>
        <div class="row">
          <button class="btn btn-sm btn-primary" id="start-all"
            ${state.profiles.some((profile) => profile.active && profile.accounts.length) ? '' : 'disabled'}>${icon(
              'play'
            )} ${escapeHtml(tr('ov.startAll'))}</button>
          <button class="btn btn-sm" id="stop-all" ${bots.length ? '' : 'disabled'}>${icon('stop')} ${escapeHtml(
            tr('ov.stopAll')
          )}</button>
        </div>
      </header>
      <div class="body" style="padding:0">
        ${
          state.profiles.length
            ? `<div class="overview-bot-tools">
                <label class="overview-bot-search">${icon('search')}
                  <input id="bot-search" type="search" autocomplete="off"
                    placeholder="${escapeHtml(tr('ov.searchBots'))}" aria-label="${escapeHtml(
                      tr('ov.searchBots')
                    )}"></label>
                <select id="bot-filter" class="mini" aria-label="${escapeHtml(tr('common.status'))}">
                  <option value="all">${escapeHtml(tr('ov.filter.all'))}</option>
                  <option value="online">${escapeHtml(tr('ov.filter.online'))}</option>
                  <option value="attention">${escapeHtml(tr('ov.filter.attention'))}</option>
                  <option value="offline">${escapeHtml(tr('ov.filter.offline'))}</option>
                </select>
                <select id="bot-sort" class="mini" aria-label="${escapeHtml(tr('common.order'))}">
                  <option value="status">${escapeHtml(tr('ov.sort.status'))}</option>
                  <option value="account">${escapeHtml(tr('ov.sort.account'))}</option>
                  <option value="server">${escapeHtml(tr('ov.sort.server'))}</option>
                </select>
              </div>
              <div class="bulk overview-bulk" data-empty="true" id="bot-bulk">
                <span id="bulk-count">${escapeHtml(tr('ov.selected', { n: 0 }))}</span>
                <div class="row wrap" id="bulk-actions">
                  <button class="btn btn-primary btn-sm" id="bulk-start">${icon('play')} ${escapeHtml(
                    tr('ov.startSelected')
                  )}</button>
                  <button class="btn btn-sm" id="bulk-stop">${icon('stop')} ${escapeHtml(
                    tr('ov.stopSelected')
                  )}</button>
                </div>
                <button class="btn btn-ghost btn-sm" id="bulk-clear">${escapeHtml(tr('ov.clearSelection'))}</button>
              </div>
              <div class="table-wrap"><table class="table overview-bots">
                <thead><tr>
                  <th><input type="checkbox" id="pick-all-bots" aria-label="${escapeHtml(tr('ov.filter.all'))}"></th>
                  <th>${escapeHtml(tr('ov.col.account'))}</th>
                  <th>${escapeHtml(tr('ov.col.server'))}</th>
                  <th>${escapeHtml(tr('common.status'))}</th>
                  <th>${escapeHtml(tr('ov.col.uptime'))}</th>
                  <th></th>
                </tr></thead>
                <tbody id="bot-rows">${rows()}</tbody>
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

    <section class="panel">
      <header><h3>${escapeHtml(tr('ov.quick'))}</h3></header>
      <div class="body stack">
        <a class="row spread" href="#/accounts">
          <span class="row">${icon('users')} ${escapeHtml(tr('ov.connectAccount'))}</span>${icon('arrow')}</a>
        <a class="row spread" href="#/credits">
          <span class="row">${icon('wallet')} ${escapeHtml(tr('bill.topUp'))}</span>${icon('arrow')}</a>
        <a class="row spread" href="#/tickets">
          <span class="row">${icon('ticket')} ${escapeHtml(tr('ov.openTicket'))}</span>${icon('arrow')}</a>
        <!-- Wohin dieser Punkt führt, ist der Punkt: in die Einstellungen. Dort steht neben dem
             Discord-Webhook noch ein Dutzend anderes, und wer nach seinem Passwort sucht, findet
             es nicht unter "Discord-Benachrichtigungen". -->
        <a class="row spread" href="#/settings">
          <span class="row">${icon('settings')} ${escapeHtml(tr('dash.settings'))}</span>${icon('arrow')}</a>
      </div>
    </section>`;

  /** Der Einstieg zeigt nur reale Schritte und verschwindet vollständig, wenn alles läuft. */
  function onboarding() {
    const assigned = state.profiles.some((profile) => profile.accounts.length > 0);
    const firstOnline = [...state.bots.values()].some((bot) => bot.online);
    const steps = [
      {
        done: state.accounts.length > 0,
        icon: 'user',
        title: tr('onboard.account'),
        text: tr('onboard.accountText'),
        href: '#/accounts',
      },
      {
        done: state.profiles.length > 0,
        icon: 'server',
        title: tr('onboard.server'),
        text: tr('onboard.serverText'),
        href: '#/servers',
      },
      {
        done: assigned,
        icon: 'plus',
        title: tr('onboard.assign'),
        text: tr('onboard.assignText'),
        href: state.profiles[0] ? `#/servers/${state.profiles[0].id}/connect` : '#/servers',
      },
      {
        done: firstOnline,
        icon: 'play',
        title: tr('onboard.online'),
        text: tr('onboard.onlineText'),
        href: state.profiles[0] ? `#/servers/${state.profiles[0].id}/connect` : '#/servers',
      },
    ];
    const done = steps.filter((step) => step.done).length;
    if (done === steps.length) return '';
    return `<section class="onboarding">
      <div class="onboarding-head">
        <div><span class="eyebrow">${escapeHtml(tr('onboard.progress', { n: done }))}</span>
          <h2>${escapeHtml(tr('onboard.title'))}</h2></div>
        <div class="onboarding-meter" aria-label="${escapeHtml(tr('onboard.progress', { n: done }))}">
          ${steps.map((step) => `<span class="${step.done ? 'done' : ''}"></span>`).join('')}
        </div>
      </div>
      <ol class="onboarding-steps">
        ${steps
          .map(
            (step, index) => `<li class="${step.done ? 'done' : ''}">
              <a href="${step.href}">
                <span class="onboarding-number">${step.done ? icon('check') : index + 1}</span>
                <span class="grow"><strong>${escapeHtml(step.title)}</strong>
                  <span>${escapeHtml(step.text)}</span></span>
                ${step.done ? '' : icon('arrow')}
              </a>
            </li>`
          )
          .join('')}
      </ol>
    </section>`;
  }

  /**
   * Drei Bilder: Guthaben, Kosten, Laufzeit.
   *
   * Sie stehen zwischen der Bot-Tabelle und dem Schnellzugriff, weil sie die Fragen beantworten,
   * die nach „läuft alles?“ kommen: reicht das Geld noch, wofür geht es drauf, und was hat sich
   * überhaupt gelohnt.
   *
   * An dieser Stelle stand vorher „Was der Client hier kann“ – eine Liste von Bauformen und
   * Protokollversionen. Das ist die Antwort auf eine Frage, die ein Kunde nie stellt: Welche
   * Datei ein Bot benutzt, sucht er sich nicht aus, und ob sie „premiumItems“ heißt, ändert für
   * ihn nichts. Wer es doch wissen will, findet es im Serverplatz unter Einstellungen.
   */
  function charts() {
    if (!insights) return '';
    const paid = insights.slots.filter((slot) => !slot.free_slot);
    const ran = insights.slots.filter((slot) => slot.uptime_sec > 0);
    const spend = insights.spend || [];
    // Nichts bewegt, nichts gelaufen, nichts bezahlt: dann steht hier auch nichts. Ein leeres
    // Achsenkreuz ist keine Auskunft. Wer gerade erst angefangen hat, bekommt stattdessen die
    // Zahlen als Kacheln – sie sind kurz, aber sie stimmen.
    if (!spend.some((month) => month.credits) && !ran.length && !paid.length) {
      return `<div class="grid three" style="margin-bottom:1.5rem">
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
      </div>`;
    }

    const lang = document.documentElement.lang === 'de' ? 'de-DE' : 'en-GB';
    const monthName = (key) => {
      const [year, month] = key.split('-');
      return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(lang, { month: 'short' });
    };
    const asEuro = (value) => `${(value / 100).toFixed(value >= 10_000 ? 0 : 2)} €`;
    const hours = (seconds) => `${Math.round(seconds / 3600).toLocaleString(lang)} h`;

    return `<div class="grid three" style="margin-bottom:1.5rem">
      ${chart.card({
        title: tr('ov.chart.balance'),
        value: credits(insights.balance),
        note: tr('bill.chart.days', { n: (insights.balance_days || []).length }),
        chart: chart.line(
          (insights.balance_days || []).map((entry) => ({
            label: entry.day,
            short: entry.day.slice(8),
            value: entry.credits,
          })),
          { format: asEuro }
        ),
        foot: escapeHtml(
          monthly > 0 ? tr('ov.monthsLeft', { n: monthsLeft }) : tr('ov.monthsPlenty')
        ),
      })}
      ${chart.card({
        title: tr('ov.chart.spend'),
        value: credits(monthly),
        note: tr('bill.chart.perMonth'),
        chart: chart.bars(
          spend.map((month) => ({ label: month.month, short: monthName(month.month), value: month.credits })),
          { format: asEuro }
        ),
        foot: escapeHtml(euro(monthly)),
      })}
      ${chart.card({
        title: tr('ov.chart.uptime'),
        value: hours(insights.slots.reduce((sum, slot) => sum + slot.uptime_sec, 0)),
        note: tr('ov.chart.total'),
        chart: ran.length
          ? chart.hbars(
              ran.map((slot) => ({ label: slot.name, value: slot.uptime_sec })),
              { format: hours }
            )
          : `<p class="small muted">${escapeHtml(tr('ov.chart.noUptime'))}</p>`,
        foot: escapeHtml(
          tr('ov.chart.connections', {
            n: insights.slots.reduce((sum, slot) => sum + slot.connections, 0),
          })
        ),
      })}
    </div>`;
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
      return `<tr><td colspan="6" class="muted small" style="padding:1.5rem;text-align:center">
        ${escapeHtml(tr('ov.noMembers'))}</td></tr>`;
    }
    // Laufende zuerst.
    list.sort((a, b) => Number(b.bot.online) - Number(a.bot.online));
    return list
      .map(
        ({ profile, member, bot }) => {
          const status = bot.online
            ? 'online'
            : bot.state && !['offline', 'stopping'].includes(bot.state)
              ? 'attention'
              : 'offline';
          return `<tr data-bot-row="${profile.id}:${member.account_id}"
            data-search="${escapeHtml(`${member.name} ${profile.name} ${profile.address}`.toLowerCase())}"
            data-status="${status}" data-account="${escapeHtml(member.name.toLowerCase())}"
            data-server="${escapeHtml(profile.name.toLowerCase())}" data-rank="${status === 'online' ? 0 : status === 'attention' ? 1 : 2}">
          <td><input type="checkbox" class="pick-bot" data-pick-bot="${profile.id}:${member.account_id}"
            aria-label="${escapeHtml(member.name)}"></td>
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
        </tr>`;
        }
      )
      .join('');
  }

  for (const id of ['#new-profile-2', '#new-profile-3']) {
    $(id)?.addEventListener('click', () => import('./server.js').then((m) => m.newProfile()));
  }

  // ------------------------------------------------------------ Suchen, sortieren, auswählen

  const selected = new Set();
  const rowNodes = () => $$('[data-bot-row]');

  function updateSelection() {
    for (const checkbox of $$('[data-pick-bot]')) checkbox.checked = selected.has(checkbox.dataset.pickBot);
    const visible = rowNodes().filter((row) => !row.hidden);
    const visiblePicked = visible.filter((row) => selected.has(row.dataset.botRow)).length;
    const all = $('#pick-all-bots');
    if (all) {
      all.checked = Boolean(visible.length) && visiblePicked === visible.length;
      all.indeterminate = visiblePicked > 0 && visiblePicked < visible.length;
    }
    const bulk = $('#bot-bulk');
    if (bulk) bulk.dataset.empty = String(selected.size === 0);
    if ($('#bulk-count')) $('#bulk-count').textContent = tr('ov.selected', { n: selected.size });
  }

  function arrangeRows() {
    const needle = String($('#bot-search')?.value || '').trim().toLowerCase();
    const filter = $('#bot-filter')?.value || 'all';
    const sort = $('#bot-sort')?.value || 'status';
    const rows = rowNodes();
    for (const row of rows) {
      row.hidden = Boolean(needle && !row.dataset.search.includes(needle)) ||
        (filter !== 'all' && row.dataset.status !== filter);
    }
    rows.sort((a, b) => {
      if (sort === 'account') return a.dataset.account.localeCompare(b.dataset.account);
      if (sort === 'server') return a.dataset.server.localeCompare(b.dataset.server);
      return Number(a.dataset.rank) - Number(b.dataset.rank) || a.dataset.account.localeCompare(b.dataset.account);
    });
    const body = $('#bot-rows');
    for (const row of rows) body.append(row);
    body.querySelector('#bot-no-match')?.remove();
    if (rows.length && !rows.some((row) => !row.hidden)) {
      body.insertAdjacentHTML(
        'beforeend',
        `<tr id="bot-no-match"><td colspan="6" class="muted small center" style="padding:1.5rem">${escapeHtml(
          tr('ov.noMatches')
        )}</td></tr>`
      );
    }
    updateSelection();
  }

  $$('[data-pick-bot]').forEach((checkbox) =>
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(checkbox.dataset.pickBot);
      else selected.delete(checkbox.dataset.pickBot);
      updateSelection();
    })
  );
  $('#pick-all-bots')?.addEventListener('change', (event) => {
    for (const row of rowNodes().filter((entry) => !entry.hidden)) {
      if (event.target.checked) selected.add(row.dataset.botRow);
      else selected.delete(row.dataset.botRow);
    }
    updateSelection();
  });
  $('#bulk-clear')?.addEventListener('click', () => {
    selected.clear();
    updateSelection();
  });
  $('#bot-search')?.addEventListener('input', arrangeRows);
  $('#bot-filter')?.addEventListener('change', arrangeRows);
  $('#bot-sort')?.addEventListener('change', arrangeRows);
  arrangeRows();

  async function actSelection(what, keys) {
    const grouped = new Map();
    for (const key of keys) {
      const [profileId, accountId] = key.split(':').map(Number);
      if (!grouped.has(profileId)) grouped.set(profileId, []);
      grouped.get(profileId).push(accountId);
    }
    const buttons = [$('#bulk-start'), $('#bulk-stop'), $('#start-all'), $('#stop-all')].filter(Boolean);
    buttons.forEach((button) => (button.disabled = true));
    let failures = 0;
    await Promise.all(
      [...grouped].map(async ([profileId, accounts]) => {
        try {
          const answer = await api(`/profiles/${profileId}/${what}`, { method: 'POST', body: { accounts } });
          failures += (answer.results || []).filter((entry) => !entry.ok).length;
        } catch (error) {
          failures += accounts.length;
          fail(error);
        }
      })
    );
    if (!failures) ok(what === 'start' ? tr('ov.started') : tr('ov.stoppedAll'));
    buttons.forEach((button) => (button.disabled = false));
  }

  $('#bulk-start')?.addEventListener('click', () => actSelection('start', selected));
  $('#bulk-stop')?.addEventListener('click', () => actSelection('stop', selected));
  $('#start-all')?.addEventListener('click', () => {
    const keys = [];
    for (const profile of state.profiles.filter((entry) => entry.active)) {
      for (const member of profile.accounts) {
        const bot = state.bots.get(`${profile.id}:${member.account_id}`) || member;
        if (!bot.state || bot.state === 'offline') keys.push(`${profile.id}:${member.account_id}`);
      }
    }
    if (keys.length) actSelection('start', keys);
  });

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
      // `member.state !== 'offline'` traf auch auf ein Konto zu, dessen Zustand noch gar nicht
      // feststeht (`undefined`) – der Knopf schickte dann ein "Stopp" an Plätze, auf denen
      // nichts lief. Gefragt ist, ob dort wirklich etwas zu stoppen ist.
      const running = profile.accounts.some((member) => {
        const bot = state.bots.get(`${profile.id}:${member.account_id}`) || member;
        return Boolean(bot.state) && bot.state !== 'offline';
      });
      if (running) {
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
    // Ändert sich das Guthaben, stimmt auch die Kurve nicht mehr – dann eben doch neu holen.
    if (event.type === 'credits' || event.type === 'suspended') insights = null;
    if (event.type === 'state' || event.type === 'credits' || event.type === 'suspended') redraw();
  };
  drawSide();
}
