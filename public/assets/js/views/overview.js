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
