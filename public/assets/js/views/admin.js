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
  api, icon, escapeHtml, credits, euro, datetime, date, clock, since, bytes, meter, mcText, todoList, stateBadge,
  safeLink, lang, tr, avatar, $, $$, ok, fail, toast, confirmDialog, formDialog, copy, debounce,
} from '../ui.js';
import { mergeLines } from '../chatlog.js';
import { countryName } from '../countries.js';
import { state, appbar, draw, go, showPalette, ADMIN_GROUPS } from '../app.js';
import * as chart from '../charts.js';

const ADMIN_ITEMS = ADMIN_GROUPS.flatMap((group) => group.items);

/**
 * Ein zweisprachiges Feld in der Sprache des Panels.
 *
 * Tarife, Zusätze und Ankündigungen liegen in beiden Sprachen in der Datenbank – der Admin-Bereich
 * las an mehreren Stellen aber fest die deutsche Fassung. Ein englischsprachiger Betreiber sah
 * dort deutsche Namen, während dieselbe Sache eine Zeile weiter englisch dastand. Fehlt die
 * Fassung der eigenen Sprache, gilt die andere: ein leerer Name wäre schlechter als ein fremder.
 */
const bilingual = (row, field) =>
  String((lang === 'de' ? row?.[`${field}_de`] : row?.[`${field}_en`]) || row?.[`${field}_de`] || row?.[`${field}_en`] || '');

const accountKindLabel = (kind) =>
  tr(kind === 'offline' ? 'acc.kind.offline' : kind === 'microsoft' ? 'acc.kind.microsoft' : 'common.unknown');

const accountStatusLabel = (status) => {
  const keys = { ok: 'acc.ok', pending: 'acc.pending', error: 'acc.error' };
  return tr(keys[status] || 'state.offline');
};

/**
 * Zeilen, die sich anklicken lassen – und zwar auch mit der Tastatur.
 *
 * Eine Tabellenzeile mit `cursor: pointer` und einem Klick-Ereignis ist für die Maus ein Knopf und
 * für alles andere gar nichts: kein Tab-Stopp, keine Ansage im Screenreader, keine Enter-Taste.
 * Das betraf im Admin-Bereich jede Liste – Nutzer, Serverplätze, Tickets, Post. Hier steht das
 * einmal und gilt überall.
 */
function bindRows(selector, open, root = document) {
  for (const row of $$(selector, root)) {
    if (!row.hasAttribute('role')) row.setAttribute('role', 'button');
    if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '0');
    row.addEventListener('click', (event) => {
      // Ein Bedienelement **in** der Zeile hat seine eigene Bedeutung. Seit die Nutzerliste
      // Häkchen zum Auswählen hat, wäre das sonst: anhaken und dabei die Zeile verlassen – die
      // Auswahl wäre weg, bevor man sie benutzen kann.
      if (event.target.closest('input, button, a, label, select, textarea')) return;
      open(row);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // Nur die Zeile selbst: Ein Knopf **in** der Zeile hat seine eigene Bedeutung, und die soll
      // die Leertaste nicht überschreiben.
      if (event.target !== row) return;
      event.preventDefault();
      open(row);
    });
  }
}

/**
 * Einen Aufruf abschicken und **ehrlich** melden, was daraus wurde.
 *
 * Das Muster `await api(…).catch(fail); ok('Gespeichert.')` stand an einem guten Dutzend Stellen –
 * und es zeigte im Fehlerfall beides nebeneinander: die rote Absage und die grüne Bestätigung.
 * Wer nur auf die zweite sah, hielt eine Änderung für gespeichert, die nie ankam.
 *
 * Gibt `true` zurück, wenn es geklappt hat – damit der Aufrufer entscheiden kann, ob er die
 * Ansicht neu zeichnet.
 */
async function send(path, options, { done = true } = {}) {
  try {
    const result = await api(path, options);
    if (done) ok(tr('adm.saved'));
    return result ?? true;
  } catch (error) {
    fail(error);
    return false;
  }
}

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

  // Die Sprungmarke steht in jeder Admin-Kopfzeile und nicht nur auf einer Tastenkombination:
  // Ein Kürzel, das niemand sieht, kennt auch niemand.
  const searchButton = `<button class="btn btn-sm" id="admin-search" title="${escapeHtml(tr('pal.shortcut'))}">
    ${icon('search')} ${escapeHtml(tr('pal.title'))}</button>`;

  root.innerHTML = `
    ${appbar(tr(entry?.label || 'adm.overview'), searchButton, tr('adm.title'))}
    <div id="admin-body"><div class="empty"><h3>${escapeHtml(tr('common.loading'))}</h3></div></div>`;

  $('#admin-search').addEventListener('click', () => showPalette());

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
    security,
    ops,
    templates,
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

/**
 * Eine Tabelle. Überschriften sind Text und werden entschärft – außer, es steht ausdrücklich
 * `{ html: … }` da: Seit die Nutzerliste ein Kästchen zum Auswählen in der Kopfzeile hat, gibt es
 * eine Überschrift, die keine Beschriftung ist, sondern ein Bedienelement.
 */
const table = (heads, rows) => `<div class="table-wrap"><table class="table">
  <thead><tr>${heads
    .map((head) => `<th>${typeof head === 'string' ? escapeHtml(head) : head.html}</th>`)
    .join('')}</tr></thead>
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

/**
 * Der Knopf, der eine Liste als CSV-Datei herunterlädt.
 *
 * Ein gewöhnlicher Verweis, kein `fetch`: Ein Anhang ist genau das, was ein Browser von sich aus
 * kann. Der Umweg über ein Skript müsste die Antwort erst zu einem Blob machen, daraus eine
 * Adresse erfinden und die dann selbst anklicken – dieselbe Datei, dreimal so viel Code, und ohne
 * den Fortschrittsbalken, den der Browser bei großen Listen ohnehin schon zeigt.
 */
const exportButton = (kind) =>
  `<a class="btn btn-sm" href="/api/admin/export/${kind}" download
      title="${escapeHtml(tr('adm.exportHint'))}">${icon('download')} ${escapeHtml(tr('adm.export'))}</a>`;

/**
 * Die Leiste für Massenaktionen.
 *
 * Sie steht immer an derselben Stelle über der Liste und ist leer, solange nichts ausgewählt ist –
 * eine Leiste, die erst erscheint, schiebt beim ersten Häkchen die halbe Seite nach unten, und
 * dann trifft der zweite Klick eine andere Zeile als gemeint.
 */
const BULK_BUTTONS = [
  ['credits', 'adm.addCredits', 'wallet', ''],
  ['verify-mail', 'adm.verifyMail', 'check', ''],
  ['logout', 'adm.logoutUser', 'key', ''],
  ['stop-bots', 'adm.stopBots', 'stop', ''],
  ['unblock', 'adm.unblock', 'unlock', ''],
  ['block', 'adm.block', 'lock', 'btn-danger'],
];

const bulkBar = () => `<div class="bulk" id="bulk" data-empty="true">
  <span class="small" id="bulk-count"></span>
  <div class="row wrap grow" id="bulk-actions">
    ${BULK_BUTTONS.map(
      ([action, label, symbol, klass]) =>
        `<button class="btn btn-sm ${klass}" data-bulk="${action}">${icon(symbol)} ${escapeHtml(tr(label))}</button>`
    ).join('')}
  </div>
  <button class="btn btn-ghost btn-sm" id="bulk-clear">${escapeHtml(tr('adm.bulk.clear'))}</button>
</div>`;

/**
 * Die Auswahl einer Liste bedienen: Häkchen, „alle“, Zähler, und die Aktionen selbst.
 *
 * `run` bekommt die Kennungen und den Namen der Aktion und entscheidet, was daraus wird – so
 * kennt dieser Baustein weder Nutzer noch Serverplätze, sondern nur Zeilen mit Häkchen.
 */
function bindBulk(run) {
  const bar = $('#bulk');
  if (!bar) return;
  const boxes = () => $$('.pick');
  const chosen = () => boxes().filter((box) => box.checked).map((box) => Number(box.dataset.id));

  const update = () => {
    const count = chosen().length;
    bar.dataset.empty = String(count === 0);
    $('#bulk-count').textContent = count ? tr('adm.bulk.selected', { n: count }) : tr('adm.bulk.hint');
    const all = $('#pick-all');
    if (all) {
      all.checked = count > 0 && count === boxes().length;
      // Teilweise ausgewählt ist ein eigener Zustand und nicht "aus": Das Kästchen zeigt einen
      // Strich statt eines Hakens, und ein Klick darauf wählt dann alles.
      all.indeterminate = count > 0 && count < boxes().length;
    }
  };

  for (const box of boxes()) box.addEventListener('change', update);
  $('#pick-all')?.addEventListener('change', (event) => {
    for (const box of boxes()) box.checked = event.target.checked;
    update();
  });
  $('#bulk-clear').addEventListener('click', () => {
    for (const box of boxes()) box.checked = false;
    update();
  });
  for (const button of $$('[data-bulk]')) {
    button.addEventListener('click', async () => {
      const ids = chosen();
      if (!ids.length) return;
      await run(button.dataset.bulk, ids);
    });
  }
  update();
}

/** Was aus einer Massenaktion wurde – und was nicht. Beides in einem Satz. */
function bulkReport(answer) {
  if (!answer) return;
  const skipped = answer.skipped?.length || 0;
  if (skipped) toast(tr('adm.bulk.doneSome', { done: answer.done, skipped }), answer.done ? '' : 'bad');
  else ok(tr('adm.bulk.done', { done: answer.done }));
}

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
  // Zwei Aufrufe, weil es zwei verschiedene Dinge sind: `/overview` zählt den Zustand von jetzt,
  // `/stats` rechnet Reihen über Wochen. Zusammen wären sie eine Abfrage, die bei jedem Öffnen
  // die halbe Datenbank durchgeht.
  const [data, stats] = await Promise.all([
    api('/admin/overview'),
    api('/admin/stats').catch(() => null),
  ]);

  root.innerHTML = `
    ${todoList(data.todos || [], { title: tr("adm.todo") })}

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
        // Nicht „ungelesen“: Ein Ticket ist nicht erledigt, weil es jemand aufgemacht hat.
        tr('adm.ticketsWaiting', { n: data.tickets?.waiting ?? data.unread_tickets })
      )}
      ${stat(
        tr('adm.attention'),
        data.users_blocked + data.users_unverified + (data.open_topups || 0),
        tr('adm.attentionLine', { blocked: data.users_blocked, unverified: data.users_unverified })
      )}
    </div>

    ${attentionPanel(data.attention || {})}

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
    </div>

    ${statsPanels(stats)}`;

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

/** Arbeitsfähige Hinweise: jede Zahl führt direkt zu der Liste, in der sie behoben wird. */
function attentionPanel(info) {
  const items = [
    ['adm.attentionUnassigned', info.tickets_unassigned, '#/admin/tickets?status=open&assignment=unassigned'],
    ['adm.attentionStale', info.tickets_stale, '#/admin/tickets?status=open&stale=1'],
    ['adm.attentionAccountErrors', info.accounts_error, '#/admin/accounts'],
    ['adm.attentionFailedLogins', info.failed_logins_24h, '#/admin/security'],
    ['adm.attentionDeletions', info.pending_deletions, '#/admin/users?filter=leaving'],
    ['adm.attentionExpiring', info.expiring_slots_7d, '#/admin/servers'],
  ];
  return `<section class="panel" style="margin-bottom:1.5rem">
    <header><h3>${escapeHtml(tr('adm.attentionQueue'))}</h3>
      ${
        info.oldest_waiting_at
          ? `<span class="small muted">${escapeHtml(
              tr('adm.attentionOldest', { age: since(info.oldest_waiting_at) })
            )}</span>`
          : ''
      }</header>
    <div class="body"><div class="grid three" style="gap:.65rem">
      ${items
        .map(
          ([label, count, href]) => `<a class="row spread note ${count ? 'warn' : ''}" href="${href}">
            <span>${escapeHtml(tr(label))}</span><span class="pill ${count ? 'missing' : 'primary'}">${Number(count) || 0}</span>
          </a>`
        )
        .join('')}
    </div></div>
  </section>`;
}

/**
 * Die Diagramme der Administration.
 *
 * Sie beantworten die Fragen, die man am Monatsende stellt und für die sonst jemand die Datenbank
 * aufmachen müsste: Kommt Geld herein und wie viel? Kommen Kunden dazu? Wofür geben sie ihr
 * Guthaben aus? Wie verteilt sich alles auf die Tarife? Wo geht die Arbeit hin?
 *
 * Die Reihenfolge ist die einer Antwort und keine Sammlung: erst das Geld über die Zeit, dann die
 * Kunden, dann die Verteilung, ganz unten die Bestenlisten. Jede Kachel trägt ihre wichtigste Zahl
 * groß über dem Bild – wer nur die sucht, muss die Kurve gar nicht lesen.
 */
function statsPanels(stats) {
  if (!stats) return '';
  const langCode = lang === 'de' ? 'de-DE' : 'en-GB';
  /**
   * Ein Geldformat **je Diagramm**, nicht je Zahl.
   *
   * Vorher entschied jeder Wert für sich, ob er Nachkommastellen bekommt – und in derselben Liste
   * standen dann „294 €“ und „30.00 €“ untereinander. Zwei Schreibweisen für dieselbe Sorte Zahl
   * liest man als zwei verschiedene Sorten Zahl. Die Entscheidung fällt deshalb einmal, am
   * größten Wert der Reihe.
   */
  const euroScale = (values) => {
    const top = Math.max(0, ...values.map((value) => Number(value) || 0));
    const digits = top >= 10_000 ? 0 : 2;
    return (cent) => `${(cent / 100).toFixed(digits)} €`;
  };
  const asEuro = euroScale([stats.totals.revenue_cent]);
  // Je ein Formatierer, nicht einer je Datenpunkt: Die Diagramme hier zeichnen dreißig Tage und
  // sechs Monate, und jede Achsenbeschriftung ging vorher durch einen frisch gebauten `Intl`.
  const numbers = new Intl.NumberFormat(langCode);
  const months = new Intl.DateTimeFormat(langCode, { month: 'short' });
  const count = (value) => numbers.format(Number(value || 0));
  const hours = (seconds) => `${numbers.format(Math.round(seconds / 3600))} h`;
  const dayShort = (key) => key.slice(8);
  const monthShort = (key) => {
    const [year, month] = key.split('-');
    return months.format(new Date(Number(year), Number(month) - 1, 1));
  };

  const revenueDays = stats.revenue_days || [];
  const revenueWindow = revenueDays.reduce((sum, entry) => sum + entry.value, 0);
  const signups = stats.signups || [];
  const newUsers = signups.reduce((sum, entry) => sum + entry.value, 0);
  const spent = stats.spent_days || [];
  const ticketDays = stats.tickets_days || [];

  return `
    <h2 class="section-title">${escapeHtml(tr('adm.stats.title'))}</h2>

    <div class="grid three" style="margin-bottom:1.5rem">
      ${chart.card({
        title: tr('adm.stats.revenue'),
        value: asEuro(revenueWindow),
        note: tr('bill.chart.days', { n: stats.days }),
        chart: chart.bars(
          revenueDays.map((entry) => ({ label: entry.day, short: dayShort(entry.day), value: entry.value })),
          { format: euroScale(revenueDays.map((entry) => entry.value)) }
        ),
        foot: escapeHtml(
          tr('adm.stats.revenueFoot', {
            total: asEuro(stats.totals.revenue_cent),
            back: asEuro(stats.totals.refunded_cent),
          })
        ),
      })}
      ${chart.card({
        title: tr('adm.stats.signups'),
        value: count(newUsers),
        note: tr('bill.chart.days', { n: stats.days }),
        // Balken, keine Linie: Das sind gezählte Ereignisse je Tag und keine Größe, die sich
        // zwischen zwei Tagen stetig ändert. Eine Linie zwischen null und eins behauptet, es habe
        // zwischendurch eine halbe Anmeldung gegeben.
        chart: chart.bars(
          signups.map((entry) => ({ label: entry.day, short: dayShort(entry.day), value: entry.value })),
          { format: count, color: chart.SERIES[2] }
        ),
        foot: escapeHtml(tr('adm.stats.signupsFoot', { total: count(stats.totals.users) })),
      })}
      ${chart.card({
        title: tr('adm.stats.spent'),
        value: count(spent.reduce((sum, entry) => sum + entry.value, 0)),
        note: tr('bill.chart.days', { n: stats.days }),
        chart: chart.bars(
          spent.map((entry) => ({ label: entry.day, short: dayShort(entry.day), value: entry.value })),
          { format: count, color: chart.SERIES[1] }
        ),
        foot: escapeHtml(
          tr('adm.stats.spentFoot', { open: count(stats.totals.credits_outstanding) })
        ),
      })}
    </div>

    <div class="grid three" style="margin-bottom:1.5rem">
      ${chart.card({
        title: tr('adm.stats.months'),
        value: asEuro((stats.revenue_months || []).slice(-1)[0]?.cent || 0),
        note: tr('bill.chart.thisMonth'),
        chart: chart.bars(
          (stats.revenue_months || []).map((entry) => ({
            label: entry.month,
            short: monthShort(entry.month),
            value: entry.cent,
          })),
          { format: euroScale((stats.revenue_months || []).map((entry) => entry.cent)) }
        ),
        foot: escapeHtml(tr('adm.stats.monthsFoot')),
      })}
      ${chart.card({
        title: tr('adm.stats.tickets'),
        value: count(ticketDays.reduce((sum, entry) => sum + entry.value, 0)),
        note: tr('bill.chart.days', { n: stats.days }),
        chart: chart.bars(
          ticketDays.map((entry) => ({ label: entry.day, short: dayShort(entry.day), value: entry.value })),
          { format: count, color: chart.SERIES[3] }
        ),
        foot: chart.stacked(
          (stats.by_ticket_status || []).map((row) => ({
            label: tr(`tk.status.${row.label}`),
            value: row.n,
          })),
          { format: count }
        ),
      })}
      ${chart.card({
        title: tr('adm.stats.plans'),
        value: count(stats.totals.profiles),
        note: tr('adm.servers'),
        chart: chart.hbars(
          (stats.by_plan || []).map((row) => ({ label: row.label, value: row.n })),
          { format: count }
        ),
        foot: chart.stacked(
          (stats.by_bot_state || []).map((row) => ({ label: tr(`state.${row.label}`), value: row.n })),
          { format: count }
        ),
      })}
    </div>

    <div class="grid three" style="margin-bottom:1.5rem">
      ${chart.card({
        title: tr('adm.stats.providers'),
        value: count((stats.by_provider || []).reduce((sum, row) => sum + row.n, 0)),
        note: tr('adm.topups'),
        chart: chart.hbars(
          (stats.by_provider || []).map((row) => ({ label: row.label, value: row.cent })),
          { format: euroScale((stats.by_provider || []).map((row) => row.cent)) }
        ),
      })}
      ${chart.card({
        title: tr('adm.stats.uptime'),
        value: hours(stats.totals.uptime_sec),
        note: tr('ov.chart.total'),
        chart: chart.hbars(
          (stats.top_slots || []).map((row) => ({
            label: `${row.label} · ${row.display_name}`,
            value: row.seconds,
          })),
          { format: hours, color: chart.SERIES[2] }
        ),
      })}
      ${chart.card({
        title: tr('adm.stats.customers'),
        // Die Zahl über einem Diagramm gehört zu dem, was darunter steht. Hier stand die Zahl der
        // laufenden Bots über einer Liste zahlender Kunden – zwei Dinge, die nichts miteinander zu
        // tun haben, in einer Kachel.
        value: count((stats.top_customers || []).length),
        note: tr('adm.stats.customersNote'),
        chart: chart.hbars(
          (stats.top_customers || []).map((row) => ({ label: row.label, value: row.cent })),
          { format: euroScale((stats.top_customers || []).map((row) => row.cent)), color: chart.SERIES[1] }
        ),
        foot: chart.stacked(
          (stats.by_account_status || []).map((row) => ({
            label: accountStatusLabel(row.label),
            value: row.n,
          })),
          { format: count }
        ),
      })}
    </div>`;
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
  // Zwei Bereiche: oben die Messwerte, die sich alle vier Sekunden selbst neu zeichnen, unten
  // die Sicherungen. Getrennt, weil das Neuzeichnen sonst jeden Klick unter dem Zeiger wegzöge –
  // eine Liste von Dateien ändert sich nicht im Sekundentakt.
  root.innerHTML = '<div id="sys-live"></div><div id="sys-webhook"></div><div id="sys-backups"></div>';
  const live = $('#sys-live');

  const paint = (data) => {
    const host = data.host;
    const own = data.afksystems;
    live.innerHTML = `
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
                <td class="small"><a href="#/admin/users/${entry.user_id}">${escapeHtml(entry.display_name || `#${entry.user_id}`)}</a></td>
                <td class="small muted">${entry.bots}</td>
                <td class="mono small">${entry.cpu_percent.toFixed(1)} %</td>
                <td class="mono small">${bytes(entry.rss)}</td>
                <td class="mono small muted">${bytes(entry.disk)}</td>
              </tr>`
            )
        )
      )}`;

    bindRows('[data-server]', (row) => go(`/admin/servers/${row.dataset.server}`));
  };

  paint(await api('/admin/metrics'));
  // Der erste CPU-Wert ist immer leer: er braucht eine zweite Messung zum Vergleichen.
  const tick = async () => {
    if (!root.isConnected) return clearInterval(timer);
    try {
      const data = await api('/admin/metrics');
      if (root.isConnected) paint(data);
    } catch {
      /* beim nächsten Mal wieder */
    }
  };
  timer = setInterval(tick, 4000);
  setTimeout(tick, 1200);

  await systemWebhook($('#sys-webhook'));
  await backups($('#sys-backups'));
}

/**
 * Der Webhook für Systemmeldungen – und was er gerade zu melden hätte.
 *
 * **Die Liste steht auch ohne Webhook da.** Sie ist die eigentliche Auskunft: volle Platte, ein
 * Standort, der sich nicht meldet, eine wiederkehrende Aufgabe, die scheitert. Der Webhook ist
 * nur der Weg, auf dem sie jemanden erreicht, der gerade nicht hinsieht.
 *
 * Und ein Knopf „jetzt schicken“, weil die häufigste Frage an einen Webhook lautet: Kommt da
 * überhaupt etwas an?
 */
async function systemWebhook(root) {
  const data = await api('/admin/system/report').catch(() => null);
  if (!data) return;
  const hours = data.interval_ms ? Math.round(data.interval_ms / 3_600_000) : 0;

  root.innerHTML = panel(
    tr('adm.systemHook'),
    `<div class="stack">
      <p class="small muted" style="margin:0">${escapeHtml(tr('adm.systemHookWhat'))}</p>
      ${
        data.webhook
          ? `<div class="row spread"><span class="muted small">${escapeHtml(tr('adm.systemHookEvery'))}</span>
              <span class="mono">${
                hours ? escapeHtml(tr('adm.systemHookHours', { n: hours })) : escapeHtml(tr('adm.systemHookAlertsOnly'))
              }</span></div>`
          : `<div class="note warn" style="margin:0">${icon('info')}<div>${escapeHtml(
              tr('adm.systemHookMissing')
            )} <a href="#/admin/settings">${escapeHtml(tr('adm.settings'))}</a></div></div>`
      }
      <hr class="rule">
      <div class="strong small">${escapeHtml(tr('adm.systemAlerts'))}</div>
      ${
        data.alerts.length
          ? `<ul class="plain-list stack">${data.alerts
              .map(
                (alert) => `<li class="note ${alert.color === 0xfb2c36 ? 'bad' : 'warn'}" style="margin:0">
                  ${icon('alert')}
                  <div><strong>${escapeHtml(alert.title)}</strong>
                    <p class="small" style="margin:.2rem 0 0">${escapeHtml(alert.text)}</p></div>
                </li>`
              )
              .join('')}</ul>`
          : `<p class="small muted" style="margin:0">${escapeHtml(tr('adm.systemAlertsNone'))}</p>`
      }
    </div>`,
    data.webhook
      ? `<button class="btn btn-sm" id="send-report">${icon('send')} ${escapeHtml(tr('adm.systemSendNow'))}</button>`
      : ''
  );

  $('#send-report')?.addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      await api('/admin/system/report', { method: 'POST' });
      ok(tr('adm.systemSent'));
    } catch (error) {
      fail(error);
    } finally {
      event.target.disabled = false;
    }
  });
}

/**
 * Sicherungen der Datenbank.
 *
 * Der Weg zurück steht in der Doku (docs/verwaltung.md) und nicht als Knopf hier: Eine Datenbank
 * auszutauschen, während das Panel auf ihr arbeitet, geht nicht gut aus – offene Verbindungen
 * zeigen weiter auf die alte Datei. Ein Knopf, der so tut, als ginge das, wäre die gefährlichere
 * Bequemlichkeit, und der rohe Shell-Befehl gehört nicht in die Oberfläche eines Kunden-Panels.
 */
async function backups(root) {
  const data = await api('/admin/backups');

  root.innerHTML = panel(
    tr('bak.title'),
    `<div class="body stack" style="padding:1rem 1.25rem 0">
      <p class="small muted">${escapeHtml(
        data.daily ? tr('bak.dailyOn', { n: data.keep }) : tr('bak.dailyOff')
      )}</p>
    </div>
    ${table(
      [tr('common.name'), tr('bak.size'), tr('common.date'), ''],
      data.entries.map(
        (entry) => `<tr>
          <td class="mono small">${escapeHtml(entry.name)}</td>
          <td class="mono small muted">${bytes(entry.size)}</td>
          <td class="small muted">${datetime(entry.created_at)}</td>
          <td style="text-align:right;white-space:nowrap">
            <a class="btn btn-sm" href="/api/admin/backups/${encodeURIComponent(entry.name)}" download>
              ${icon('download')} ${escapeHtml(tr('bak.download'))}</a>
            <button class="btn btn-ghost btn-sm btn-danger" data-drop="${escapeHtml(entry.name)}">${icon('trash')}</button>
          </td>
        </tr>`
      )
    )}
    <div class="body stack" style="padding:1rem 1.25rem">
      <p class="small muted">${escapeHtml(tr('bak.restore'))}
        ${escapeHtml(tr('adm.detail'))}: <span class="mono">docs/verwaltung.md</span></p>
    </div>`,
    `<span class="small muted">${escapeHtml(bytes(data.total))}</span>
     <button class="btn btn-sm btn-primary" id="bak-now">${icon('disk')} ${escapeHtml(tr('bak.now'))}</button>`
  );

  $('#bak-now').addEventListener('click', async () => {
    const button = $('#bak-now');
    button.disabled = true;
    if (await send('/admin/backups', { method: 'POST' })) await backups(root);
    else button.disabled = false;
  });
  $$('[data-drop]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('bak.dropAsk', { name: button.dataset.drop }), { confirm: tr('common.delete') })))
        return;
      if (await send(`/admin/backups/${encodeURIComponent(button.dataset.drop)}`, { method: 'DELETE' })) {
        await backups(root);
      }
    })
  );
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
//
// **Drei Dinge machen aus einer Liste eine Warteschlange.**
//
// Erstens: Man sieht ihre Größe, bevor man sie liest. Die Kacheln oben sind keine Verzierung,
// sondern die Filter selbst – „vier unbeantwortet“ ist ein Satz und ein Klick zugleich.
//
// Zweitens: Eine Zeile sagt, worum es geht. Vorher stand dort „3 Nachrichten“ – eine Zahl über das
// Ticket und nichts über die Sache. Jetzt steht dort der Anfang der letzten Nachricht, wer sie
// geschrieben hat, und ob der Kunde unsere Antwort gelesen hat.
//
// Drittens: Man räumt sie nicht einzeln auf. Nach einer Störung liegen zwanzig Tickets zum selben
// Thema da; sie zuzuweisen oder zu schließen darf nicht sechzig Klicks kosten.

const TICKET_STATUS_PILL = { open: 'primary', answered: '', closed: '' };
const TICKET_PRIORITY_PILL = { urgent: 'missing', high: 'primary', normal: '', low: '' };

async function staffTicket(root, id) {
  const { renderStaffTicket } = await import('./tickets.js');
  return renderStaffTicket(root, id);
}

/** Die Filter, die in der Adresszeile stehen – an einer Stelle, damit sie nirgends abweichen. */
const ticketQuery = (params) => ({
  status: params.get('status') || 'open',
  priority: params.get('priority') || 'all',
  assignment: params.get('assignment') || 'all',
  sort: params.get('sort') || 'queue',
  stale: params.get('stale') === '1',
  unanswered: params.get('unanswered') === '1',
  q: params.get('q') || '',
});

const ticketHash = (query) =>
  `/admin/tickets?status=${query.status}&priority=${query.priority}&assignment=${query.assignment}` +
  `&sort=${query.sort}&stale=${query.stale ? 1 : 0}&unanswered=${query.unanswered ? 1 : 0}` +
  `&q=${encodeURIComponent(query.q)}`;

async function staffTickets(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const query = ticketQuery(params);
  const { duration } = await import('./tickets.js');

  const data = await api(`/admin/tickets?${ticketHash(query).split('?')[1]}`);
  const counts = data.counts || {};
  /** Was gerade angehakt ist. Nach jedem Neuzeichnen leer – eine Auswahl über Filter hinweg wäre
   *  eine Massenaktion auf Tickets, die man nicht mehr sieht. */
  const picked = new Set();

  /**
   * Eine Kachel ist eine Zahl **und** ein Filter.
   *
   * Getrennt wäre beides schlechter: Eine Zahl ohne Weg dorthin lässt einen suchen, ein Filter
   * ohne Zahl lässt einen raten, ob sich das Klicken lohnt.
   */
  const tile = (key, value, hash, tone = '') =>
    `<a class="tk-tile ${tone} ${Number(value) ? '' : 'is-empty'}" href="#${hash}">
      <span class="tk-tile-value">${Number(value) || 0}</span>
      <span class="tk-tile-label">${escapeHtml(tr(key))}</span>
    </a>`;

  root.innerHTML = `
    ${appbar(tr('adm.allTickets'), '', tr('adm.allTicketsSub'))}

    <div class="tk-tiles">
      ${tile('tk.tileWaiting', counts.waiting, ticketHash({ ...query, status: 'open', stale: false, unanswered: false, assignment: 'all' }), 'primary')}
      ${tile('tk.tileUnanswered', counts.unanswered, ticketHash({ ...query, status: 'open', unanswered: true, stale: false }), 'bad')}
      ${tile('tk.tileStale', counts.stale, ticketHash({ ...query, status: 'open', stale: true, unanswered: false }), 'warn')}
      ${tile('tk.tileUrgent', counts.urgent, ticketHash({ ...query, status: 'open', priority: 'urgent', stale: false, unanswered: false }), 'warn')}
      ${tile('tk.tileUnassigned', counts.unassigned, ticketHash({ ...query, status: 'open', assignment: 'unassigned', stale: false, unanswered: false }))}
      ${tile('tk.tileMine', counts.mine, ticketHash({ ...query, status: 'all', assignment: 'mine', stale: false, unanswered: false }))}
      <!-- Keine Zahl zum Anklicken, sondern die Auskunft, wie gut es gerade läuft: Wie lange ein
           Kunde im Mittel auf die erste Antwort wartet. Ohne sie ist „viel zu tun“ ein Gefühl. -->
      <div class="tk-tile is-static">
        <span class="tk-tile-value">${
          counts.first_reply_median === null || counts.first_reply_median === undefined
            ? '–'
            : escapeHtml(duration(counts.first_reply_median))
        }</span>
        <span class="tk-tile-label">${escapeHtml(tr('tk.tileFirstReply'))}</span>
      </div>
    </div>

    <div class="row spread wrap" style="margin-bottom:1rem;gap:1rem">
      <div class="row wrap">
        <select id="tk-status" class="mini" style="max-width:13rem">
          <option value="all" ${query.status === 'all' ? 'selected' : ''}>${escapeHtml(tr('common.all'))}</option>
          ${(data.statuses || [])
            .map(
              (entry) =>
                `<option value="${entry}" ${query.status === entry ? 'selected' : ''}>${escapeHtml(
                  tr(`tk.status.${entry}`)
                )}</option>`
            )
            .join('')}
        </select>
        <!-- Nach Dringlichkeit filtern konnte der Server längst; hier stand nur nie ein Feld
             dafür, und der Wert kam nie an. -->
        <select id="tk-priority" class="mini" style="max-width:13rem">
          <option value="all" ${query.priority === 'all' ? 'selected' : ''}>${escapeHtml(tr('tk.priority'))}</option>
          ${(data.priorities || [])
            .map(
              (entry) =>
                `<option value="${entry}" ${query.priority === entry ? 'selected' : ''}>${escapeHtml(
                  tr(`tk.priority.${entry}`)
                )}</option>`
            )
            .join('')}
        </select>
        <select id="tk-assignment" class="mini" style="max-width:13rem">
          <option value="all" ${query.assignment === 'all' ? 'selected' : ''}>${escapeHtml(tr('tk.assignmentAll'))}</option>
          <option value="mine" ${query.assignment === 'mine' ? 'selected' : ''}>${escapeHtml(tr('tk.assignmentMine'))}</option>
          <option value="unassigned" ${query.assignment === 'unassigned' ? 'selected' : ''}>${escapeHtml(tr('tk.assignmentNone'))}</option>
        </select>
        <select id="tk-sort" class="mini" style="max-width:13rem">
          ${['queue', 'waiting', 'newest', 'priority']
            .map(
              (entry) =>
                `<option value="${entry}" ${query.sort === entry ? 'selected' : ''}>${escapeHtml(
                  tr(`tk.sort.${entry}`)
                )}</option>`
            )
            .join('')}
        </select>
        <label class="row small"><input id="tk-stale" type="checkbox" ${query.stale ? 'checked' : ''}>
          ${escapeHtml(tr('tk.stale'))}</label>
        <label class="row small"><input id="tk-unanswered" type="checkbox" ${query.unanswered ? 'checked' : ''}>
          ${escapeHtml(tr('tk.unansweredOnly'))}</label>
        <input id="tk-q" type="search" placeholder="${escapeHtml(tr('common.search'))}"
          value="${escapeHtml(query.q)}" style="max-width:16rem">
      </div>
      <div class="row wrap">
        ${exportButton('tickets')}
        <button class="btn btn-sm" id="tk-new-for">${icon('users')} ${escapeHtml(tr('tk.newFor'))}</button>
      </div>
    </div>

    <!-- Die Leiste für mehrere auf einmal. Sie steht erst da, wenn etwas ausgewählt ist: eine
         Massenaktion, die immer sichtbar ist, wird irgendwann versehentlich angeklickt. -->
    <div class="tk-bulk" id="tk-bulk" hidden>
      <span class="strong" id="tk-bulk-count"></span>
      <div class="row wrap grow" style="justify-content:flex-end">
        <button class="btn btn-sm" data-bulk="assign-me">${icon('user')} ${escapeHtml(tr('tk.bulkTakeIt'))}</button>
        <button class="btn btn-sm" data-bulk="unassign">${escapeHtml(tr('tk.bulkUnassign'))}</button>
        <button class="btn btn-sm" data-bulk="urgent">${escapeHtml(tr('tk.bulkUrgent'))}</button>
        <button class="btn btn-sm btn-danger" data-bulk="close">${escapeHtml(tr('tk.bulkClose'))}</button>
        <button class="btn btn-sm btn-ghost" id="tk-bulk-clear">${escapeHtml(tr('common.cancel'))}</button>
      </div>
    </div>

    <section class="panel">
      <div class="body" style="padding:0">
        ${
          data.tickets.length
            ? `<div class="tk-select-all">
                 <label class="row small"><input type="checkbox" id="tk-all">
                   ${escapeHtml(tr('tk.selectAll', { n: data.tickets.length }))}</label>
               </div>
               <ul class="ticket-list">${data.tickets.map(staffRow).join('')}</ul>`
            : `<div class="empty" style="box-shadow:none;background:transparent">
                <h3>${escapeHtml(tr('tk.none'))}</h3>
                <p>${escapeHtml(tr('tk.noneHere'))}</p></div>`
        }
      </div>
    </section>`;

  // Der Klick auf die Zeile öffnet das Ticket – der Klick auf das Kästchen wählt es aus.
  // `bindRows` lässt Bedienelemente in der Zeile schon von sich aus in Ruhe.
  bindRows('[data-open]', (node) => go(`/admin/tickets/${node.dataset.open}`));

  const bulkBar = $('#tk-bulk');
  const paintPicked = () => {
    bulkBar.hidden = picked.size === 0;
    $('#tk-bulk-count').textContent = tr('tk.picked', { n: picked.size });
    for (const box of $$('[data-pick]')) box.checked = picked.has(Number(box.dataset.pick));
    const all = $('#tk-all');
    if (all) all.checked = picked.size > 0 && picked.size === data.tickets.length;
  };

  for (const box of $$('[data-pick]')) {
    box.addEventListener('change', () => {
      const id = Number(box.dataset.pick);
      if (box.checked) picked.add(id);
      else picked.delete(id);
      paintPicked();
    });
  }
  $('#tk-all')?.addEventListener('change', (event) => {
    picked.clear();
    if (event.target.checked) for (const entry of data.tickets) picked.add(entry.id);
    paintPicked();
  });
  $('#tk-bulk-clear').addEventListener('click', () => {
    picked.clear();
    paintPicked();
  });

  const BULK = {
    'assign-me': { action: 'assign', assigned_to: state.me?.id },
    unassign: { action: 'assign', assigned_to: null },
    urgent: { action: 'priority', priority: 'urgent' },
    close: { action: 'status', status: 'closed' },
  };
  for (const button of $$('[data-bulk]')) {
    button.addEventListener('click', async () => {
      const body = BULK[button.dataset.bulk];
      if (!body || !picked.size) return;
      // Schließen trifft den Kunden: Er bekommt Post. Das fragt man einmal nach, bevor es zwanzig
      // Menschen gleichzeitig betrifft.
      if (
        button.dataset.bulk === 'close' &&
        !(await confirmDialog(tr('tk.bulkCloseAsk', { n: picked.size }), { danger: true }))
      ) {
        return;
      }
      try {
        const result = await api('/admin/tickets/bulk', {
          method: 'POST',
          body: { ...body, ids: [...picked] },
        });
        ok(tr('tk.bulkDone', { n: result.done }));
        picked.clear();
        draw();
      } catch (error) {
        fail(error);
      }
    });
  }

  const reload = debounce(() => {
    go(
      ticketHash({
        status: $('#tk-status').value,
        priority: $('#tk-priority').value,
        assignment: $('#tk-assignment').value,
        sort: $('#tk-sort').value,
        stale: $('#tk-stale').checked,
        unanswered: $('#tk-unanswered').checked,
        q: $('#tk-q').value.trim(),
      })
    );
    draw();
  }, 300);
  for (const id of ['#tk-status', '#tk-priority', '#tk-assignment', '#tk-sort', '#tk-stale', '#tk-unanswered']) {
    $(id).addEventListener('change', reload);
  }
  $('#tk-q').addEventListener('input', reload);

  $('#tk-new-for').addEventListener('click', () => ticketForCustomer());

  // Kommt ein Ticket herein oder eine Antwort, ist die Liste sofort veraltet. Eine Lesemarke
  // ändert daran nichts Sichtbares in der Zeile außer dem Haken – und dafür lohnt kein Neuaufbau
  // der ganzen Seite, während jemand gerade etwas anhakt.
  state.onLive = debounce((event) => {
    if (
      event.type === 'ticket' &&
      event.event !== 'typing' &&
      event.message.audience?.staff &&
      state.route.name === 'admin' &&
      state.route.tab === 'tickets' &&
      !picked.size
    ) draw();
  }, 500);
}

/**
 * Eine Zeile der Arbeitsliste.
 *
 * Sie beantwortet vier Fragen, ohne dass man das Ticket öffnet: Worum geht es (Betreff und der
 * Anfang der letzten Nachricht), wer wartet (Kunde, mit Bild), wie lange schon (die Zeit seit
 * seiner letzten Nachricht – nicht seit irgendeiner Bewegung), und wer sich darum kümmert.
 */
function staffRow(ticket) {
  // Dieselbe Regel wie in der Kundenansicht: Die Benachrichtigung steht **am Ticket**. Die Zahl
  // in der Seitenleiste sagt nur, dass etwas wartet, nicht worauf.
  //
  // Und sie steht nur da, wo sie stimmt: „Neu“ heißt, dass wir dran sind und es noch niemand
  // gelesen hat. An einem beantworteten oder geschlossenen Ticket hat das nichts verloren –
  // dort stand vorher trotzdem „Wartet“, weil allein der Ungelesen-Punkt gefragt wurde.
  const unread = Boolean(ticket.unread_staff) && ticket.status === 'open';
  // Wie lange der Kunde schon auf uns wartet. Bei einem offenen Ticket ist das die Zeit seit
  // seiner Nachricht – `updated_at` würde von einer internen Notiz zurückgesetzt, und das Ticket
  // sähe frisch aus, obwohl der Kunde seit gestern wartet.
  const waitingSince = ticket.status === 'open' ? ticket.last_customer_at || ticket.created_at : 0;
  const overdue = waitingSince && Date.now() - waitingSince > 86_400_000;
  const preview = ticket.last_body
    ? `<span class="muted">${escapeHtml(
        ticket.last_role === 'staff' ? tr('tk.staff') : ticket.display_name || tr('tk.customer')
      )}:</span> ${escapeHtml(ticket.last_body.replace(/\s+/g, ' ').trim())}`
    : escapeHtml(tr('tk.onlySubjectShort'));

  return `<li class="ticket-row ${unread ? 'is-unread' : ''}" data-open="${ticket.id}">
    <label class="tk-pick" aria-label="${escapeHtml(tr('tk.pickOne', { id: ticket.id }))}">
      <input type="checkbox" data-pick="${ticket.id}"></label>
    <span class="ticket-dot ${escapeHtml(ticket.status)}"></span>
    ${avatar(ticket, { size: 28, klass: 'tk-avatar' })}
    <div class="grow" style="min-width:0">
      <div class="row" style="gap:.5rem">
        <span class="strong truncate">${escapeHtml(ticket.subject)}</span>
        <span class="small muted mono">#${ticket.id}</span>
        ${unread ? `<span class="pill unread">${icon('bell')} ${escapeHtml(tr('tk.unread'))}</span>` : ''}
        ${
          ticket.status === 'open' && !ticket.first_reply_at
            ? `<span class="pill missing">${escapeHtml(tr('tk.neverAnswered'))}</span>`
            : ''
        }
        ${ticket.discord ? `<span class="pill" title="${escapeHtml(tr('tk.inDiscord'))}">${icon('discord')}</span>` : ''}
        ${ticket.files ? `<span class="pill" title="${escapeHtml(tr('tk.files'))}">${icon('paperclip')} ${ticket.files}</span>` : ''}
        ${ticket.extra_users ? `<span class="pill">${icon('users')} ${ticket.extra_users + 1}</span>` : ''}
      </div>
      <div class="small muted truncate ticket-preview">
        ${
          ticket.last_role === 'staff'
            ? `<span class="receipt-mark ${ticket.seen_at ? 'is-seen' : ''}" title="${escapeHtml(
                ticket.seen_at ? tr('tk.seenShort') : tr('tk.notSeenYet')
              )}">${icon('check')}${ticket.seen_at ? icon('check') : ''}</span>`
            : ''
        }${preview}
      </div>
      <div class="small muted truncate">
        ${escapeHtml(ticket.display_name || `#${ticket.user_id}`)}
        ${
          ticket.assigned_name
            ? ` · <span class="row" style="display:inline-flex;gap:.25rem;vertical-align:middle">${avatar(
                { display_name: ticket.assigned_name, avatar: ticket.assigned_avatar },
                { size: 14 }
              )}${escapeHtml(ticket.assigned_name)}</span>`
            : ` · <span class="warn-text">${escapeHtml(tr('tk.unassigned'))}</span>`
        }
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
      <span class="small mono nowrap ${overdue ? 'bad-text' : 'muted'}"
        title="${escapeHtml(waitingSince ? tr('tk.waitingSince') : tr('tk.lastActivity'))}">${since(
        waitingSince || ticket.updated_at
      )}</span>
    </div>
  </li>`;
}

/**
 * Ein Ticket für einen Kunden – etwa nach einem Gespräch, das woanders stattgefunden hat.
 *
 * Das gehört hierher und nicht in den Support-Bildschirm eines Kunden: dort stand es bisher und
 * war für jeden zu sehen, der zufällig Administrator ist, aber gerade Kunde sein wollte.
 */
async function ticketForCustomer() {
  const { users: list } = await api('/admin/users?filter=all');
  const answer = await formDialog(
    tr('tk.newFor'),
    [
      {
        key: 'user_id',
        label: tr('adm.users'),
        type: 'select',
        value: String(list[0]?.id || ''),
        options: list.map((user) => ({
          value: String(user.id),
          label: `${user.display_name || `#${user.id}`} · ${user.email}`,
        })),
      },
      { key: 'subject', label: tr('tk.subject'), required: true },
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
          ['leaving', tr('adm.filterLeaving')],
          ['dormant', tr('adm.filterDormant')],
          ['account-errors', tr('adm.filterAccountErrors')],
        ]
          .map(
            ([value, label]) =>
              `<option value="${value}" ${filter === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
          )
          .join('')}
      </select>
      <div class="grow"></div>
      ${exportButton('users')}
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('adm.newUser'))}</button>
    </div>

    ${bulkBar()}

    ${panel(
      `${data.users.length} ${tr('adm.users')}`,
      table(
        [
          { html: `<input type="checkbox" id="pick-all" aria-label="${escapeHtml(tr('adm.bulk.all'))}">` },
          '#',
          tr('set.fullName'),
          tr('auth.register.email'),
          tr('common.credits'),
          tr('bill.monthly'),
          tr('adm.profiles'),
          tr('adm.bots'),
          '',
        ],
        data.users.map(
          (user) => `<tr data-user="${user.id}" style="cursor:pointer">
            <td><input type="checkbox" class="pick" data-id="${user.id}"
              aria-label="${escapeHtml(user.display_name || `#${user.id}`)}"></td>
            <td class="mono small muted">${user.id}</td>
            <td><span class="row" style="gap:.4rem">${avatar(user, { size: 22 })}<span>${escapeHtml(
              user.display_name || `#${user.id}`
            )}</span>
              ${user.role === 'admin' ? `<span class="pill primary">admin</span>` : ''}
              ${user.blocked ? `<span class="pill missing">${escapeHtml(tr('adm.block'))}</span>` : ''}
              ${
                user.delete_due_at
                  ? `<span class="pill missing" title="${escapeHtml(
                      tr('adm.leavingOn', { date: date(user.delete_due_at) })
                    )}">${icon('trash')}</span>`
                  : ''
              }
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
  bindRows('[data-user]', (row) => go(`/admin/users/${row.dataset.user}`));

  bindBulk(async (action, ids) => {
    const body = { action, ids };
    if (action === 'credits') {
      const answer = await formDialog(
        tr('adm.addCredits'),
        [
          { key: 'credits_delta', label: tr('common.credits'), type: 'number', value: 100, required: true },
          { key: 'note', label: tr('adm.reason'), value: '' },
        ],
        { submit: tr('common.save'), note: tr('adm.bulk.selected', { n: ids.length }) }
      );
      if (!answer) return;
      body.credits_delta = Number(answer.credits_delta);
      body.note = answer.note;
    } else {
      // Alles andere trifft fremde Konten sofort und sichtbar – einmal nachfragen, mit der Zahl
      // dabei. „Sperren“ für dreißig Leute ist etwas anderes als für einen.
      const label = tr(BULK_BUTTONS.find(([key]) => key === action)[1]);
      const confirmed = await confirmDialog(tr('adm.bulk.ask', { what: label, n: ids.length }), {
        confirm: label,
        danger: action === 'block',
      });
      if (!confirmed) return;
    }
    try {
      bulkReport(await api('/admin/users/bulk', { method: 'POST', body }));
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $('#new').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('adm.newUser'),
      [
        { key: 'email', label: tr('auth.register.email'), type: 'email', required: true },
        { key: 'full_name', label: tr('auth.register.fullName'), required: true },
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

/**
 * Wie die Felder der persönlichen Daten heißen.
 *
 * Dieselben Beschriftungen wie in den Einstellungen des Kunden – ein zweiter Wortschatz für
 * dieselben Felder wäre die sichere Art, dass in der Verwaltung irgendwann „Ort“ steht, wo der
 * Kunde „Stadt“ eingetragen hat.
 */
/**
 * Ein Symbol, das zum Gerät passt – Handy, sonst ein Bildschirm.
 *
 * Dieselbe Unterscheidung wie in den Einstellungen des Kunden. Sie steht bewusst zweimal da und
 * nicht in `ui.js`: Es sind vier Zeichen Regulärausdruck, und ein gemeinsamer Baustein für „welches
 * Bildchen“ wäre eine Abhängigkeit zwischen zwei Bildschirmen, die sonst nichts miteinander zu tun
 * haben.
 */
const deviceIcon = (agent) =>
  /Android|iPhone|iPad|Mobile/.test(String(agent || '')) ? 'gamepad' : 'monitor';

/** Woran ein Anmeldeversuch gescheitert ist – in einem Wort. */
const signInLabel = (entry) => {
  // Der Anmeldecode zuerst: „falsches Passwort“ stünde sonst über einem Versuch, bei dem das
  // Passwort gestimmt hat – und genau diese Zeile ist die interessante.
  if (entry.reason === 'code') return tr(entry.ok ? 'set.signInCodeOk' : 'set.signInCodeWrong');
  if (entry.ok) return tr('set.signInOk');
  if (entry.reason === 'blocked') return tr('set.signInBlocked');
  if (entry.reason === 'throttled') return tr('set.signInThrottled');
  return tr('set.signInFailed');
};

const PROFILE_LABELS = {
  full_name: 'set.fullName',
  company: 'set.company',
  vat_id: 'set.vatId',
  street: 'set.street',
  street2: 'set.street2',
  postal_code: 'set.postalCode',
  city: 'set.city',
  region: 'set.region',
  country: 'set.country',
  phone: 'set.phone',
  billing_email: 'set.billingEmail',
  timezone: 'set.timezone',
};

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
      <div class="row" style="gap:.9rem;min-width:0">
        ${avatar(user, { size: 48 })}
        <div style="min-width:0">
        <h2 style="font-size:1.4rem">${escapeHtml(user.display_name || `#${user.id}`)}
          ${user.role === 'admin' ? '<span class="pill primary">admin</span>' : ''}
          ${(user.discord_roles || [])
            .map((role) => `<span class="pill">${escapeHtml(tr(`role.${role}`))}</span>`)
            .join('')}
          ${user.blocked ? `<span class="pill missing">${escapeHtml(tr('adm.block'))}</span>` : ''}
          ${
            // „Ich komme nicht mehr hinein“ hat zwei verschiedene Antworten, je nachdem, ob
            // dieses Konto einen zweiten Faktor hat. Der Support soll sie nicht erraten müssen.
            user.totp ? `<span class="pill ok">${escapeHtml(tr('adm.totpOn'))}</span>` : ''
          }</h2>
        <p class="small muted mono">${escapeHtml(user.email)} · #${user.id} ·
          ${escapeHtml(tr('common.status'))}: ${user.last_seen_at ? since(user.last_seen_at) : '–'}
          ${user.discord ? ` · Discord ${escapeHtml(user.discord.name || user.discord.id)}` : ''}</p>
        </div>
      </div>
      <div class="row wrap">
        <a class="btn btn-sm" href="#/admin/users">${escapeHtml(tr('common.back'))}</a>
        <button class="btn btn-sm" id="mail">${icon('mail')} ${escapeHtml(tr('adm.sendMail'))}</button>
        <button class="btn btn-sm" id="ticket">${icon('ticket')} ${escapeHtml(tr('adm.openTicket'))}</button>
        <button class="btn btn-sm" id="impersonate">${escapeHtml(tr('adm.impersonate'))}</button>
        <button class="btn btn-sm" id="login-link">${icon('copy')} ${escapeHtml(tr('adm.loginLink'))}</button>
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

    ${
      user.delete_due_at
        ? `<div class="note bad" style="margin-bottom:1.5rem">${icon('alert')}
            <div class="row wrap spread grow" style="gap:.75rem">
              <span>${escapeHtml(tr('adm.leavingOn', { date: date(user.delete_due_at) }))}</span>
              <button class="btn btn-sm" id="undelete">${escapeHtml(tr('adm.cancelDeletion'))}</button>
            </div></div>`
        : ''
    }

    <!-- **Ansehen, nicht ändern.** Name, Firma und Anschrift sind die Angaben des Kunden; sie
         stehen hier, weil die Verwaltung Rückfragen zu Belegen beantworten muss. Ein Formular
         daraus zu machen hieße, dass zwei Stellen dieselbe Wahrheit schreiben – und auf dem
         Beleg steht am Ende, was der Kunde selbst angegeben hat. -->
    ${
      Object.values(user.profile || {}).some(Boolean)
        ? panel(
            tr('set.personal'),
            `<dl class="facts">${Object.entries(user.profile)
              .filter(([, value]) => value)
              .map(
                ([key, value]) => `<div><dt>${escapeHtml(tr(PROFILE_LABELS[key] || 'common.name'))}</dt>
                  <dd>${escapeHtml(key === 'country' ? countryName(value, lang) : value)}</dd></div>`
              )
              .join('')}</dl>`
          )
        : ''
    }

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

    <!-- **Der Block für „ich komme nicht mehr hinein“.** Zweiter Faktor, offene Geräte und die
         letzten Versuche stehen nebeneinander, weil erst der Vergleich die Frage beantwortet:
         Kommt überhaupt etwas an? Von welcher Adresse? Und scheitert es am Passwort oder am
         Code danach? Getrennt wären das drei Bildschirme, zwischen denen niemand hin und her
         sieht. -->
    <section class="panel" style="margin-bottom:1.5rem">
      <header><h3>${escapeHtml(tr('adm.access'))}</h3>
        <span class="small muted">${escapeHtml(tr('adm.accessSub'))}</span></header>
      <div class="body stack">
        <div class="row wrap spread">
          <div style="min-width:0">
            <p class="small strong">${escapeHtml(tr('adm.totp'))}</p>
            ${
              data.totp?.enabled
                ? `<span class="pill ok">${escapeHtml(tr('common.on'))}</span>
                   <span class="small muted">${escapeHtml(
                     tr('adm.totpSince', { when: data.totp.since ? date(data.totp.since) : '–' })
                   )} · ${escapeHtml(
                     tr('adm.totpRecovery', {
                       left: data.totp.recovery_left,
                       total: data.totp.recovery_total,
                     })
                   )}</span>`
                : `<span class="small muted">${escapeHtml(tr('adm.totpOff'))}</span>`
            }
          </div>
          ${
            data.totp?.enabled
              ? `<button class="btn btn-sm btn-danger" id="totp-reset">${escapeHtml(tr('adm.totpReset'))}</button>`
              : ''
          }
        </div>
        <hr class="rule">
        <div>
          <p class="small strong" style="margin-bottom:.25rem">${escapeHtml(tr('adm.sessions'))}</p>
          <p class="small muted" style="margin-bottom:.5rem">${escapeHtml(tr('adm.sessionsSub'))}</p>
          ${
            (data.sessions || []).length
              ? `<ul class="device-list">${data.sessions
                  .map(
                    (session) => `<li class="device">
                      <span class="device-icon">${icon(deviceIcon(session.agent))}</span>
                      <div class="grow" style="min-width:0">
                        <div class="strong truncate">${escapeHtml(session.device || tr('set.deviceUnknown'))}</div>
                        <p class="small muted truncate" title="${escapeHtml(session.agent || '')}">
                          ${escapeHtml(session.ip || '–')} · ${escapeHtml(
                            tr('set.sessionSince', { when: since(session.created_at) })
                          )}</p>
                      </div>
                      <button class="btn btn-sm btn-danger" data-drop-session="${escapeHtml(session.ref)}">${escapeHtml(
                        tr('adm.sessionEnd')
                      )}</button>
                    </li>`
                  )
                  .join('')}</ul>`
              : `<p class="small muted">${escapeHtml(tr('common.none'))}</p>`
          }
        </div>
        <hr class="rule">
        <div>
          <p class="small strong" style="margin-bottom:.5rem">${escapeHtml(tr('adm.signIns'))}</p>
          <p class="small muted" style="margin-bottom:.5rem">${escapeHtml(tr('adm.signInsSub'))}</p>
          ${
            (data.signins || []).length
              ? `<ul class="plain-list">${data.signins
                  .map(
                    (entry) => `<li class="row spread small">
                      <span class="row" style="gap:.5rem;min-width:0">
                        <span class="signin-dot ${entry.ok ? 'ok' : 'bad'}"></span>
                        <span class="mono truncate">${escapeHtml(entry.ip || '–')}</span>
                        <span class="muted truncate">${escapeHtml(signInLabel(entry))}</span>
                      </span>
                      <span class="muted mono">${datetime(entry.created_at)}</span>
                    </li>`
                  )
                  .join('')}</ul>`
              : `<p class="small muted">${escapeHtml(tr('set.signInsNone'))}</p>`
          }
        </div>
      </div>
    </section>

    ${
      data.proxies.length
        ? panel(
            tr('px.title'),
            table(
              [tr('common.name'), tr('srv.address'), tr('common.created')],
              data.proxies.map(
                (proxy) => `<tr>
                  <td>${escapeHtml(proxy.label || `#${proxy.id}`)}</td>
                  <td class="mono small">${escapeHtml(
                    `${proxy.kind === 'http' ? 'http' : 'socks5'}://${proxy.host}:${proxy.port}`
                  )}</td>
                  <td class="small muted mono">${datetime(proxy.created_at)}</td>
                </tr>`
              )
            )
          )
        : ''
    }

    ${
      data.topups.length
        ? panel(
            tr('adm.topups'),
            table(
              ['', tr('bill.method'), tr('common.credits'), tr('bill.amount'), tr('common.status')],
              data.topups.map(
                (topup) => `<tr>
                  <td class="small muted mono">${datetime(topup.created_at)}</td>
                  <td class="small">${escapeHtml(topup.provider)}</td>
                  <td class="mono">${credits(topup.credits)}</td>
                  <td class="mono small muted">${euro(topup.amount_cent)}</td>
                  <td><span class="pill ${topup.status === 'paid' ? 'primary' : 'missing'}">${escapeHtml(
                    topupStatus(topup.status)
                  )}</span></td>
                </tr>`
              )
            )
          )
        : ''
    }

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

    ${
      (data.mails || []).length
        ? panel(
            tr('adm.userMails'),
            table(
              ['', tr('tk.subject'), tr('common.status')],
              data.mails.map(
                (entry) => `<tr>
                  <td class="small muted mono">${datetime(entry.created_at)}</td>
                  <td class="small">${escapeHtml(entry.subject || entry.kind || '')}</td>
                  <td><span class="pill ${entry.status === 'sent' ? 'primary' : 'missing'}">${escapeHtml(
                    entry.status
                  )}</span></td>
                </tr>`
              )
            )
          )
        : ''
    }

    ${panel(
      tr('adm.userAudit'),
      table(
        ['', '', ''],
        (data.audit || []).map(
          (entry) => `<tr>
            <td class="small muted mono">${datetime(entry.created_at)}</td>
            <td class="small">${escapeHtml(entry.action_label || entry.action)}</td>
            <td class="small muted">${escapeHtml(entry.summary || '')}</td>
          </tr>`
        )
      ),
      `<a class="btn btn-sm" href="#/admin/audit?q=${encodeURIComponent(user.username || '')}">${escapeHtml(
        tr('adm.auditAll')
      )}</a>`
    )}

    <section class="panel">
      <header><h3>${escapeHtml(tr('adm.detail'))}</h3></header>
      <div class="body stack">
        <div class="field"><label for="notes">${escapeHtml(tr('adm.notes'))}</label>
          <textarea id="notes" rows="4" placeholder="${escapeHtml(tr('adm.everything'))}">${escapeHtml(
            user.notes || ''
          )}</textarea></div>
        <div class="row">
          <div class="field" style="max-width:10rem"><label for="allowance">${escapeHtml(tr('adm.allowance'))}</label>
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
        { key: 'note', label: tr('adm.reason'), value: '' },
      ],
      { submit: tr('common.save'), note: `${tr('bill.balance')}: ${credits(user.credits)}` }
    );
    if (answer) patch({ credits_delta: Number(answer.credits_delta), note: answer.note });
  });

  $('#mail').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('adm.sendMail'),
      [
        { type: 'note', key: 'note', label: `${user.display_name || `#${user.id}`} · ${user.email}` },
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
        { type: 'note', key: 'note', label: user.display_name || `#${user.id}` },
        { key: 'subject', label: tr('tk.subject'), required: true },
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

  // `.catch(fail)` fängt den Fehler – und danach lief trotzdem `ok('Gespeichert.')`. Der
  // Betreiber sah also beides nebeneinander: die Absage und die Bestätigung. Was schiefging,
  // wird gemeldet; bestätigt wird nur, was geklappt hat.
  const doPost = async (path) => {
    try {
      await api(path, { method: 'POST' });
      ok(tr('adm.saved'));
    } catch (error) {
      fail(error);
    }
  };
  $('#stop').addEventListener('click', () => doPost(`/admin/users/${id}/stop-bots`));
  $('#logout').addEventListener('click', async () => {
    if (!(await confirmDialog(tr('adm.logoutUser')))) return;
    await doPost(`/admin/users/${id}/logout`);
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

  $('#login-link').addEventListener('click', async () => {
    try {
      const result = await api(`/admin/users/${id}/login-link`, { method: 'POST' });
      await copy(result.link);
    } catch (error) {
      fail(error);
    }
  });

  $('#save-notes').addEventListener('click', () =>
    patch({ notes: $('#notes').value, proxy_allowance: Number($('#allowance').value) })
  );

  $('#undelete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(tr('adm.cancelDeletionAsk'), { confirm: tr('adm.cancelDeletion') }))) return;
    if (await send(`/admin/users/${id}/cancel-deletion`, { method: 'POST' })) draw();
  });

  $('#totp-reset')?.addEventListener('click', async () => {
    if (!(await confirmDialog(tr('adm.totpResetAsk'), { confirm: tr('adm.totpReset'), danger: true }))) return;
    if (await send(`/admin/users/${id}/totp-reset`, { method: 'POST' })) draw();
  });

  $$('[data-drop-session]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('adm.sessionEndAsk'), { confirm: tr('adm.sessionEnd'), danger: true }))) return;
      if (
        await send(`/admin/users/${id}/sessions/${encodeURIComponent(button.dataset.dropSession)}`, {
          method: 'DELETE',
        })
      ) {
        draw();
      }
    })
  );

  bindAdminSwitches('[data-discord-role]', (field, enabled) => patch({ [field]: enabled }));
  $$('[data-account-suspend]').forEach((button) => {
    const account = data.accounts.find((entry) => entry.id === Number(button.dataset.accountSuspend));
    button.addEventListener('click', () => changeAccountSuspension(account));
  });

  $$('[data-extend]').forEach((button) =>
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (await send(`/admin/profiles/${button.dataset.extend}`, {
        method: 'PATCH',
        body: { extend_days: 30 },
      })) draw();
    })
  );

  bindRows('[data-server]', (row) => go(`/admin/servers/${row.dataset.server}`));
  bindRows('[data-ticket]', (row) => go(`/admin/tickets/${row.dataset.ticket}`));
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
          <td class="small"><a href="#/admin/users/${profile.user_id}">${escapeHtml(profile.display_name || `#${profile.user_id}`)}</a></td>
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
    ),
    exportButton('profiles')
  );

  bindRows('[data-open]', (row) => go(`/admin/servers/${row.dataset.open}`));
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
      if (await send(`/admin/profiles/${button.dataset.del}`, { method: 'DELETE' })) draw();
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

  /**
   * Die Kontenliste als HTML.
   *
   * Steht als eigene Funktion da, weil sie zweimal gebraucht wird: einmal beim Aufbau der Seite und
   * danach alle paar Sekunden, wenn sich der Zustand der Bots geändert hat. Vorher war die Liste
   * ein Standbild vom Moment des Öffnens – wer hier auf „Neu starten“ drückte, sah bis zum nächsten
   * Seitenwechsel weiterhin "offline" neben einem Bot, der längst wieder im Spiel war.
   */
  const accountRows = (accounts) =>
    accounts
      .map(
        (account) => `<li class="botrow ${account.online ? 'is-on' : ''}">
          <img class="head" src="${escapeHtml(account.head)}" alt="" loading="lazy" decoding="async">
          <div class="grow" style="min-width:0">
            <div class="strong truncate">${escapeHtml(account.name)}</div>
            <div class="small muted truncate">${escapeHtml(account.state)}
              ${account.detail ? `· ${escapeHtml(account.detail)}` : ''}
              ${account.pid ? `· PID ${account.pid}` : ''}</div>
            ${
              account.last_error && account.last_error !== account.detail
                ? `<div class="small bad">${escapeHtml(account.last_error)}</div>`
                : ''
            }
            ${
              // **Womit dieser eine Bot gerade läuft.** Ein Prozess behält seine Client-Datei, auch
              // wenn auf der Platte längst eine neuere liegt – die Zeile sagt beides, und der Knopf
              // in der Kopfzeile löst es auf.
              account.client_version
                ? `<div class="small muted truncate">${escapeHtml(
                    tr('adm.clientRunning', { version: account.client_version })
                  )}${account.build ? ` · ${escapeHtml(account.build)}` : ''}
                    ${
                      account.outdated
                        ? `<span class="pill missing">${escapeHtml(
                            tr('adm.clientOutdated', { version: data.client_version || '?' })
                          )}</span>`
                        : ''
                    }</div>`
                : ''
            }
            <div class="small muted truncate">${
              account.proxy
                ? `${icon('shield')} ${escapeHtml(account.proxy.label || account.proxy.address)}`
                : `<span style="opacity:.7">${escapeHtml(tr('adm.proxyDirect'))}</span>`
            }${account.note ? ` · ${escapeHtml(account.note)}` : ''}</div>
            ${
              account.retry
                ? `<div class="small" style="color:var(--warn-text)">${escapeHtml(
                    tr('adm.retryIn', {
                      n: `${account.retry.tries}/${account.retry.max}`,
                      sec: Math.max(0, Math.round(((account.retry.at || Date.now()) - Date.now()) / 1000)),
                    })
                  )}</div>`
                : ''
            }
            ${
              account.suspended
                ? `<div class="small" style="color:var(--warn-text)">${escapeHtml(
                    account.suspend_reason || tr('acc.suspended')
                  )}</div>`
                : ''
            }
          </div>
          <!-- **Ein Bot einzeln.** Von acht Bots hängt einer; „alle neu starten“ wirft die anderen
               sieben mit aus dem Spiel. Deshalb hier je Zeile – und alles, was zu den Knöpfen
               gehört, in einem Block, damit es beim Umbruch zusammenbleibt. -->
          <div class="row wrap" style="gap:.35rem;margin-left:auto">
            <span class="small muted mono">${account.since ? since(account.since) : '–'}</span>
            <button class="btn btn-ghost btn-sm" title="${escapeHtml(tr('adm.botStart'))}"
              aria-label="${escapeHtml(tr('adm.botStart'))}"
              data-bot="start" data-account="${account.account_id}"
              ${profile.locked || profile.suspended || account.suspended ? 'disabled' : ''}>${icon('play')}</button>
            <button class="btn btn-ghost btn-sm" title="${escapeHtml(tr('adm.botRestart'))}"
              aria-label="${escapeHtml(tr('adm.botRestart'))}"
              data-bot="restart" data-account="${account.account_id}"
              ${profile.locked || profile.suspended || account.suspended ? 'disabled' : ''}>${icon('refresh')}</button>
            <button class="btn btn-ghost btn-sm" title="${escapeHtml(tr('adm.botStop'))}"
              aria-label="${escapeHtml(tr('adm.botStop'))}"
              data-bot="stop" data-account="${account.account_id}">${icon('stop')}</button>
            <button class="btn btn-sm ${account.suspended ? '' : 'btn-danger'}"
              data-account-suspend="${account.account_id}">${escapeHtml(
                account.suspended ? tr('adm.resumeAccount') : tr('adm.suspendAccount')
              )}</button>
          </div>
        </li>`
      )
      .join('') || `<li class="small muted" style="padding:1.25rem">${escapeHtml(tr('srv.noAccounts'))}</li>`;

  root.innerHTML = `
    <div class="row wrap spread" style="margin-bottom:1.25rem">
      <div>
        <h2 style="font-size:1.4rem">${escapeHtml(profile.name)}
          ${profile.locked ? `<span class="pill missing">${escapeHtml(tr('adm.locked'))}</span>` : ''}
          ${profile.suspended ? `<span class="pill missing">${escapeHtml(tr('adm.billingSuspended'))}</span>` : ''}</h2>
        <p class="small muted mono">${escapeHtml(profile.address)} · MC ${escapeHtml(profile.mc_version)} ·
          <a href="#/admin/users/${data.owner?.id}">${escapeHtml(data.owner?.display_name || `#${data.owner?.id}`)}</a></p>
      </div>
      <div class="row wrap">
        <a class="btn btn-sm" href="#/admin/servers">${escapeHtml(tr('common.back'))}</a>
        <button class="btn btn-sm" id="start" ${profile.locked || profile.suspended ? 'disabled' : ''}>
          ${icon('play')} ${escapeHtml(tr('srv.startAll'))}</button>
        <button class="btn btn-sm" id="stop">${icon('stop')} ${escapeHtml(tr('srv.stopAll'))}</button>
        <button class="btn btn-sm" id="restart" ${profile.locked || profile.suspended ? 'disabled' : ''}>
          ${icon('refresh')}</button>
        ${
          data.outdated_bots
            ? `<button class="btn btn-sm" id="rollout" title="${escapeHtml(tr('adm.rolloutHere'))}">
                ${icon('download')} ${escapeHtml(tr('adm.rolloutHere'))}
                <span class="pill missing">${data.outdated_bots}</span></button>`
            : ''
        }
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
          <span class="small muted" id="botcount">${
            data.accounts.filter((a) => a.online).length
          }/${data.features.max_accounts}</span>
        </header>
        <div class="body" style="padding:0">
          <ul class="botlist" id="botlist">${accountRows(data.accounts)}</ul>
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
            <!-- **An wen.** Bisher ging jede Zeile an jeden Bot des Platzes. Für /list ist das
                 egal, für /warp oder ein :pov size ist es der Unterschied zwischen „einem Bot
                 helfen“ und „acht Bots gleichzeitig etwas antun“. Steht der Kasten auf „alle
                 Konten“, bleibt es wie bisher. -->
            ${
              data.accounts.length > 1
                ? `<select id="target" class="mini" style="max-width:9rem"
                     aria-label="${escapeHtml(tr('adm.sendTo'))}">
                    <option value="">${escapeHtml(tr('adm.sendAll'))}</option>
                    ${data.accounts
                      .map(
                        (account) =>
                          `<option value="${account.account_id}">${escapeHtml(account.name)}</option>`
                      )
                      .join('')}
                  </select>`
                : ''
            }
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

      <!-- **Adresse und Protokollversion.** Der Kunde kann beides selbst – aber nicht mehr, sobald
           sein Platz gesperrt ist, und genau dann ruft er an. Übrig blieb bisher der Griff in die
           Datenbank. -->
      <section class="panel">
        <header><h3>${escapeHtml(tr('adm.connection'))}</h3>
          <span class="small muted">${escapeHtml(tr('adm.connectionSub'))}</span></header>
        <div class="body stack">
          <div class="field"><label for="srv-name">${escapeHtml(tr('common.name'))}</label>
            <input id="srv-name" type="text" maxlength="40" value="${escapeHtml(profile.name)}"></div>
          <div class="field"><label for="srv-address">${escapeHtml(tr('srv.address'))}</label>
            <input id="srv-address" type="text" value="${escapeHtml(profile.address)}"
              placeholder="mc.example.net:25565" autocapitalize="off" spellcheck="false"></div>
          <div class="field"><label for="srv-version">${escapeHtml(tr('srv.version'))}</label>
            <select id="srv-version">
              ${
                // Die jetzige Version gehört immer in die Liste – auch wenn der Client sie nicht
                // (mehr) kennt. Sonst stünde im Kasten eine andere, und ein Klick auf „Speichern“
                // stellte den Platz stillschweigend um.
                [...new Set([profile.mc_version, ...(data.client_versions || [])])]
                  .map(
                    (version) =>
                      `<option value="${escapeHtml(version)}" ${
                        version === profile.mc_version ? 'selected' : ''
                      }>${escapeHtml(version)}</option>`
                  )
                  .join('')
              }
            </select></div>
          <p class="small muted">${escapeHtml(tr('adm.connectionRestart'))}</p>
          <div class="row">
            <button class="btn btn-primary btn-sm" id="save-connection">${escapeHtml(tr('common.save'))}</button>
            <div class="grow"></div>
            <span class="small muted">${escapeHtml(tr('srv.macros'))}: ${data.macros} ·
              ${escapeHtml(tr('srv.spam'))}: ${data.spam}</span>
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
                <span>${escapeHtml(bilingual(addon, 'name'))}
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
        // `clock()` schreibt die Uhrzeit in der Sprache des Panels – ein blankes
        // `toLocaleTimeString()` nimmt die des Betriebssystems, und dann stand in der
        // Admin-Konsole "3:07:11 PM", während im Chat des Kunden daneben "15:07:11" steht.
        (entry) => `<div class="line ${entry.type}"><span class="t">${clock(entry.t)}</span>
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

  let chatLoading = false;
  const load = async () => {
    if (!root.isConnected || chatLoading) return;
    chatLoading = true;
    try {
      const fresh = await api(`/admin/servers/${id}/chat`);
      if (!root.isConnected) return;
      lines = fresh.lines;
      paint();
    } catch {
      /* beim nächsten Mal wieder */
    } finally {
      chatLoading = false;
    }
  };
  await load();

  /**
   * Eine Zeile in die Konsole schicken.
   *
   * **Sie heißt `sendChat` und nicht `send`.** So hieß sie einmal – und verdeckte damit in dieser
   * ganzen Funktion den gleichnamigen Baustein oben in dieser Datei, der einen Aufruf abschickt und
   * meldet, was daraus wurde. Jeder Knopf darunter rief also nicht das Backend, sondern diese
   * Funktion hier: `send('/admin/servers/7/start', …)` las das leere Nachrichtenfeld, brach in der
   * ersten Zeile ab und gab `undefined` zurück. „Alle starten“, „Alle stoppen“, Neustart, Sperren,
   * +30 Tage, Abrechnung aussetzen, Tarifwechsel und Standortwechsel taten auf diesem Bildschirm
   * seitdem nichts – ohne Fehlermeldung, denn es *ging* ja nichts schief.
   */
  const sendChat = async () => {
    const text = $('#msg').value.trim();
    if (!text) return;
    $('#msg').value = '';
    // Leer heißt „alle“ – dann bleibt der Aufruf derselbe wie bisher.
    const only = Number($('#target')?.value || 0);
    try {
      const result = await api(`/admin/servers/${id}/send`, {
        method: 'POST',
        body: only ? { text, accounts: [only] } : { text },
      });
      const failed = (result.results || []).filter((entry) => !entry.ok);
      if (failed.length === (result.results || []).length && failed.length) toast(failed[0].error, 'bad');
      setTimeout(load, 600);
    } catch (error) {
      fail(error);
    }
  };
  $('#send').addEventListener('click', sendChat);
  $('#msg').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendChat();
  });

  // ------------------------------------------------------------ Die Kontenliste, laufend

  /**
   * Die Knöpfe an den Kontozeilen anbinden.
   *
   * Muss nach jedem Neuzeichnen der Liste wieder laufen: `innerHTML` ersetzt die Elemente, und mit
   * ihnen sind auch die daran hängenden Ereignisse weg.
   */
  const bindAccounts = () => {
    $$('[data-account-suspend]').forEach((button) => {
      const account = accounts.find((entry) => entry.account_id === Number(button.dataset.accountSuspend));
      button.addEventListener('click', () => changeAccountSuspension(account));
    });
    $$('[data-bot]').forEach((button) =>
      button.addEventListener('click', async () => {
        // Zweimal auf „Neu starten“ zu drücken, weil die Zeile noch nichts anzeigt, wäre ein
        // zweiter Neustart mitten im ersten. Der Knopf geht deshalb sofort aus und kommt mit der
        // nächsten Auffrischung der Liste von selbst wieder.
        button.disabled = true;
        await send(`/admin/servers/${id}/accounts/${button.dataset.account}/${button.dataset.bot}`, {
          method: 'POST',
        });
        refresh();
      })
    );
  };

  /** Zustand, Fassung und Fehler der Bots neu holen – ohne den Rest der Seite anzufassen. */
  let accounts = data.accounts;
  let refreshing = false;
  const refresh = async () => {
    if (!root.isConnected || refreshing) return;
    refreshing = true;
    try {
      const fresh = await api(`/admin/servers/${id}`);
      // Zwischen Absenden und Antwort kann die Seite gewechselt haben – dann gibt es die Liste
      // nicht mehr, und in sie zu schreiben wäre ein Fehler in der Konsole ohne jeden Nutzen.
      if (!root.isConnected) return;
      accounts = fresh.accounts;
      $('#botlist').innerHTML = accountRows(accounts);
      $('#botcount').textContent = `${accounts.filter((entry) => entry.online).length}/${
        fresh.features.max_accounts
      }`;
      bindAccounts();
    } catch {
      /* beim nächsten Mal wieder */
    } finally {
      refreshing = false;
    }
  };
  bindAccounts();

  // Die Konsole hängt am selben Live-Kanal wie beim Kunden – aber nur für dessen eigene Bots.
  // Für fremde Serverplätze kommt hier nichts an, deshalb wird zusätzlich nachgeladen. Die
  // Kontenliste hängt mit dran: Sie war bisher ein Standbild vom Moment des Öffnens, und wer einen
  // Bot startete, sah daneben minutenlang weiter "offline".
  const poll = setInterval(() => {
    if (!root.isConnected) return clearInterval(poll);
    load();
    refresh();
  }, 5000);

  // ------------------------------------------------------------ Knöpfe

  for (const [selector, action] of [['#start', 'start'], ['#stop', 'stop'], ['#restart', 'restart']]) {
    $(selector).addEventListener('click', async () => {
      if (await send(`/admin/servers/${id}/${action}`, { method: 'POST' })) refresh();
    });
  }

  $('#rollout')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog(tr('adm.rolloutHereAsk', { n: data.outdated_bots }), {
      confirm: tr('adm.rolloutHere'),
    });
    if (!confirmed) return;
    const result = await send(`/admin/servers/${id}/client-rollout`, { method: 'POST' }, { done: false });
    if (!result) return;
    ok(tr('adm.rolloutDone', { n: result.restarted }));
    setTimeout(draw, 2000);
  });

  $('#lock').addEventListener('click', async () => {
    if (profile.locked) {
      if (await send(`/admin/servers/${id}/lock`, { method: 'POST', body: { locked: false } })) draw();
      return;
    }
    const answer = await formDialog(
      tr('adm.lock'),
      [{ key: 'reason', label: tr('adm.lockReason'), required: true }],
      { submit: tr('adm.lock') }
    );
    if (!answer) return;
    if (await send(`/admin/servers/${id}/lock`, {
      method: 'POST',
      body: { locked: true, reason: answer.reason },
    })) draw();
  });

  $('#extend').addEventListener('click', async () => {
    if (await send(`/admin/profiles/${id}`, { method: 'PATCH', body: { extend_days: 30 } })) draw();
  });

  $('#suspend').addEventListener('click', async () => {
    if (await send(`/admin/profiles/${id}`, {
      method: 'PATCH',
      body: { suspended: !profile.suspended },
    })) draw();
  });

  $('#plan').addEventListener('change', async (event) => {
    if (await send(`/admin/profiles/${id}`, {
      method: 'PATCH',
      body: { plan_id: Number(event.target.value) },
    })) draw();
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
    if (await send(`/admin/servers/${id}/node`, {
      method: 'POST',
      body: { node_id: Number(answer.node_id) },
    })) draw();
  });

  $('#save-connection').addEventListener('click', async () => {
    const body = {
      name: $('#srv-name').value.trim(),
      address: $('#srv-address').value.trim(),
      mc_version: $('#srv-version').value,
    };
    if (await send(`/admin/profiles/${id}`, { method: 'PATCH', body })) draw();
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
  // Ein Login-Fehler zwischen hunderten gesunden Konten ist praktisch unsichtbar. Die
  // Warteschlange ist nur eine zweite Ansicht derselben Antwort: keine Massen-Reauth, keine
  // Änderung von Zuordnungen und kein Startversuch im Namen des Kunden.
  const needsLogin = data.accounts.filter(
    (account) => !account.suspended && (account.status === 'error' || Boolean(account.last_error))
  );
  root.innerHTML = panel(
    `${data.accounts.length} ${tr('adm.accounts')}`,
    `${
      needsLogin.length
        ? `<section class="note warn" style="margin-bottom:1rem"><div>${icon('alert')}</div><div class="grow">
            <strong>${escapeHtml(tr('adm.accountQueue', { n: needsLogin.length }))}</strong>
            <p class="small" style="margin:.25rem 0 .65rem">${escapeHtml(tr('adm.accountQueueHint'))}</p>
            <div class="stack">${needsLogin
              .map(
                (account) => `<div class="row wrap spread">
                  <span><strong>${escapeHtml(account.name)}</strong><span class="small muted"> · ${escapeHtml(account.last_error || accountStatusLabel(account.status))}</span></span>
                  <span class="row wrap"><a class="btn btn-sm" href="#/admin/users/${account.user_id}">${escapeHtml(tr('adm.openOwner'))}</a>
                    ${account.servers.map((server) => `<a class="btn btn-sm" href="#/admin/servers/${server.id}">${escapeHtml(server.name)}</a>`).join('')}</span>
                </div>`)
              .join('')}</div>
          </div></section>`
        : `<div class="note" style="margin-bottom:1rem">${icon('check')}<div>${escapeHtml(tr('adm.accountQueueNone'))}</div></div>`
    }
    <div class="row wrap" style="margin-bottom:.75rem">
      <label class="account-search">${icon('search')}<input id="account-needle" type="search" autocomplete="off" placeholder="${escapeHtml(tr('common.search'))}"></label>
      <select class="mini" id="account-state" aria-label="${escapeHtml(tr('common.status'))}">
        <option value="all">${escapeHtml(tr('adm.accountFilterAll'))}</option>
        <option value="needs-login">${escapeHtml(tr('adm.accountFilterLogin'))}</option>
        <option value="running">${escapeHtml(tr('adm.accountFilterRunning'))}</option>
        <option value="suspended">${escapeHtml(tr('acc.suspended'))}</option>
      </select>
      <span class="small muted" id="account-result-count"></span>
    </div>
    ${table(
      [tr('adm.users'), tr('ov.col.account'), tr('adm.servers'), tr('common.status'), tr('common.created'), ''],
      data.accounts.map(
        (account) => `<tr data-account-row data-account-name="${escapeHtml(`${account.name} ${account.display_name} ${account.servers.map((server) => server.name).join(' ')}`.toLowerCase())}"
          data-account-state="${account.suspended ? 'suspended' : account.running ? 'running' : account.status === 'error' || account.last_error ? 'needs-login' : 'ready'}">
          <td class="small"><a href="#/admin/users/${account.user_id}">${escapeHtml(account.display_name || `#${account.user_id}`)}</a></td>
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
    )}`
  );

  $$('[data-account-suspend]').forEach((button) => {
    const account = data.accounts.find((entry) => entry.id === Number(button.dataset.accountSuspend));
    button.addEventListener('click', () => changeAccountSuspension(account));
  });

  let accountNeedle = '';
  let accountState = 'all';
  const filterAccounts = () => {
    let visible = 0;
    $$('[data-account-row]').forEach((row) => {
      const matches = (!accountNeedle || row.dataset.accountName.includes(accountNeedle)) &&
        (accountState === 'all' || row.dataset.accountState === accountState);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    $('#account-result-count').textContent = tr('adm.accountFilterCount', { n: visible });
  };
  $('#account-needle').addEventListener('input', (event) => {
    accountNeedle = String(event.target.value || '').trim().toLowerCase();
    filterAccounts();
  });
  $('#account-state').addEventListener('change', (event) => {
    accountState = event.target.value;
    filterAccounts();
  });
  filterAccounts();
}

// ---------------------------------------------------------------- Standorte
//
// Ein Standort ist eine Maschine: dort laufen Prozesse, dort werden CPU, Arbeitsspeicher und
// Platte verbraucht. Deshalb steht auf jeder Karte, was die Maschine gerade tut – und deshalb
// steht das an einem Proxy nirgends: eine Adresse hat keine Auslastung.

/**
 * Der Verlauf eines Standorts als drei Linien mit ihrer jeweiligen Frühwarnschwelle.
 *
 * Eine Stunde ohne Messung ist eine Lücke, keine erfundene Null (siehe `nodes.history` im
 * Server) – Buckets ohne Wert fallen deshalb aus der jeweiligen Reihe heraus statt als 0 %
 * gezeichnet zu werden, was einen Absturz behauptete, der nie stattfand.
 */
function renderNodeHistory(history) {
  const buckets = history.buckets || [];
  if (!buckets.length) {
    return `<p class="small muted" style="margin:.6rem 0 0">${escapeHtml(tr('nd.historyEmpty'))}</p>`;
  }
  const langCode = lang === 'de' ? 'de-DE' : 'en-GB';
  const time = new Intl.DateTimeFormat(langCode, { hour: '2-digit', minute: '2-digit' });
  const pct = (n) => `${Math.round(n)} %`;
  const series = (key) =>
    buckets
      .filter((bucket) => bucket[key] !== null && bucket[key] !== undefined)
      .map((bucket) => {
        const label = time.format(new Date(bucket.at));
        return { label, short: label, value: bucket[key] };
      });
  const metrics = [
    { key: 'cpu', title: tr('nd.historyCpu') },
    { key: 'mem', title: tr('nd.historyRam') },
    { key: 'disk', title: tr('nd.historyDisk') },
  ];
  return `<div class="grid three" style="margin-top:.8rem;gap:.8rem">${metrics
    .map((metric) => {
      const threshold = history.thresholds?.[metric.key] || 0;
      return chart.card({
        title: metric.title,
        chart: chart.line(series(metric.key), { format: pct, threshold }),
        foot: threshold ? escapeHtml(tr('nd.threshold', { n: threshold })) : '',
      });
    })
    .join('')}</div>`;
}

async function nodes(root) {
  const data = await api('/admin/nodes');
  const { users: userList } = await api('/admin/users?filter=all');

  /** Die drei Balken, die einen Standort beschreiben. Fehlen die Zahlen, fehlt der Block. */
  function load(node) {
    const stats = node.resources;
    if (!stats) {
      return `<p class="small muted" style="margin:1rem 0 0">${escapeHtml(
        node.kind === 'egress' ? tr('nd.noResources') : tr('nd.noStats')
      )}</p>`;
    }
    const rows = [
      {
        label: tr('adm.cpu'),
        percent: stats.cpu_percent ?? 0,
        text: `${Math.round(stats.cpu_percent ?? 0)} % ${escapeHtml(tr('nd.ofCores', { n: stats.cores || 1 }))}`,
        limit: node.max_cpu_percent,
      },
      {
        label: tr('adm.ram'),
        percent: stats.memory?.percent ?? 0,
        text: `${bytes(stats.memory?.used || 0)} / ${bytes(stats.memory?.total || 0)}`,
        limit: node.max_mem_percent,
      },
      {
        label: tr('adm.disk'),
        percent: stats.disk?.percent ?? 0,
        text: stats.disk ? `${bytes(stats.disk.used)} / ${bytes(stats.disk.total)}` : '–',
        limit: node.max_disk_percent,
      },
    ];
    return `<div class="node-load">
      ${rows
        .map(
          (row) => `<div>
            <div class="row spread small">
              <span class="muted">${escapeHtml(row.label)}</span>
              <span class="mono">${row.text}${
                row.limit ? ` <span class="muted">· max ${row.limit} %</span>` : ''
              }</span>
            </div>
            ${meter(row.percent, { label: `${row.label} ${Math.round(row.percent)} %` })}
          </div>`
        )
        .join('')}
    </div>`;
  }

  /** Der Einzeiler, mit dem ein neuer Standort eingerichtet wird. */
  const setupCommand = (node) =>
    `sudo PANEL_URL=${data.panel_url} NODE_TOKEN=${node.token} ./install-agent.sh`;

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
                <div class="row wrap" style="gap:.5rem">${icon('pin')}
                  <span class="strong">${escapeHtml(node.name)}</span>
                  <span class="pill">${escapeHtml(tr(`nd.kind.${node.kind}`))}</span>
                  ${
                    node.kind === 'agent'
                      ? `<span class="pill ${node.online ? 'primary' : 'missing'}">${escapeHtml(
                          node.online ? tr('nd.connected') : tr('nd.disconnected')
                        )}</span>`
                      : ''
                  }
                  ${node.full ? `<span class="pill missing">${escapeHtml(tr('nd.full'))}</span>` : ''}
                  ${node.active ? '' : `<span class="pill missing">${escapeHtml(tr('srv.off'))}</span>`}</div>
                <p class="small muted" style="margin:.4rem 0 0">${escapeHtml(node.note || '')}</p>
              </div>
              <span class="pill">${escapeHtml(tr(`nd.access.${node.access}`))}</span>
            </div>

            ${load(node)}

            ${
              node.kind === 'egress'
                ? ''
                : `<details class="node-history" data-history="${node.id}">
                    <summary>${escapeHtml(tr('nd.history'))}</summary>
                    <div data-history-body="${node.id}">
                      <p class="small muted" style="margin:.6rem 0 0">${escapeHtml(tr('nd.historyLoading'))}</p>
                    </div>
                  </details>`
            }

            <dl class="facts" style="margin-top:1rem">
              <div><dt>${escapeHtml(tr('adm.profiles'))}</dt>
                <dd>${node.usage.profiles}${node.max_profiles ? ` / ${node.max_profiles}` : ''}</dd></div>
              <div><dt>${escapeHtml(tr('adm.bots'))}</dt>
                <dd>${node.usage.bots_running}${node.max_bots ? ` / ${node.max_bots}` : ''}</dd></div>
              <div><dt>${escapeHtml(tr('px.title'))}</dt>
                <dd class="mono small">${
                  node.proxy ? `${escapeHtml(node.proxy.kind)}://${escapeHtml(node.proxy.host)}:${node.proxy.port}` : '–'
                }</dd></div>
              <div><dt>${escapeHtml(tr('nd.machine'))}</dt>
                <dd class="small truncate">${escapeHtml(
                  node.resources?.hostname || (node.kind === 'egress' ? tr('nd.viaProxy') : '–')
                )}${node.agent?.version ? ` · Agent ${escapeHtml(node.agent.version)}` : ''}</dd></div>
            </dl>

            ${
              node.kind === 'agent'
                ? `<details class="node-setup" ${node.online ? '' : 'open'}>
                    <summary>${escapeHtml(tr('nd.setup'))}</summary>
                    <p class="small muted" style="margin:.5rem 0">${escapeHtml(tr('nd.setupHint'))}</p>
                    <code class="node-token">${escapeHtml(setupCommand(node))}</code>
                    <div class="row" style="margin-top:.6rem">
                      <button class="btn btn-ghost btn-sm" data-copy="${node.id}">${icon('copy')}
                        ${escapeHtml(tr('common.copy'))}</button>
                      <button class="btn btn-ghost btn-sm" data-token="${node.id}">${icon('refresh')}
                        ${escapeHtml(tr('nd.newToken'))}</button>
                    </div>
                  </details>`
                : ''
            }

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
    ...(node.kind === 'local'
      ? []
      : [
          {
            key: 'kind',
            label: tr('nd.kindLabel'),
            type: 'select',
            value: node.kind || 'agent',
            hint: tr('nd.kindHint'),
            options: data.kinds.map((value) => ({ value, label: tr(`nd.kind.${value}`) })),
          },
        ]),
    { key: 'region', label: 'Region', value: node.region || '', placeholder: 'Falkenstein' },
    {
      key: 'proxy_id',
      label: tr('px.title'),
      type: 'select',
      value: String(node.proxy_id || ''),
      hint: tr('nd.proxyHint'),
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
      key: 'max_cpu_percent',
      label: tr('nd.maxCpu'),
      type: 'number',
      min: 0,
      max: 100,
      hint: tr('nd.maxHint'),
      value: node.max_cpu_percent ?? 0,
    },
    {
      key: 'max_mem_percent',
      label: tr('nd.maxMem'),
      type: 'number',
      min: 0,
      max: 100,
      hint: tr('nd.maxHint'),
      value: node.max_mem_percent ?? 0,
    },
    {
      key: 'max_disk_percent',
      label: tr('nd.maxDisk'),
      type: 'number',
      min: 0,
      max: 100,
      hint: tr('nd.maxHint'),
      value: node.max_disk_percent ?? 0,
    },
    {
      key: 'access',
      label: tr('nd.accessLabel'),
      type: 'select',
      value: node.access || 'all',
      options: data.access.map((value) => ({ value, label: tr(`nd.access.${value}`) })),
    },
    {
      key: 'users',
      label: tr('adm.users'),
      hint: `${tr('nd.access.listed')} — ${tr('nd.usersHint')}`,
      value: (node.users || []).map((user) => user.id).join(', '),
    },
    { key: 'note', label: tr('nd.note'), value: node.note || '' },
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

  $$('[data-copy]').forEach((button) =>
    button.addEventListener('click', () => {
      const node = data.nodes.find((entry) => entry.id === Number(button.dataset.copy));
      navigator.clipboard?.writeText(setupCommand(node)).then(
        () => ok(tr('common.copied')),
        () => fail(new Error(tr('common.error')))
      );
    })
  );

  $$('[data-token]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('nd.newTokenWarn'), { confirm: tr('nd.newToken') }))) return;
      try {
        await api(`/admin/nodes/${button.dataset.token}/token`, { method: 'POST' });
        ok(tr('adm.saved'));
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  // Der Verlauf lädt erst beim ersten Aufklappen – ein Standort, den niemand aufklappt, kostet
  // keine zusätzliche Anfrage.
  $$('[data-history]').forEach((details) => {
    let loaded = false;
    details.addEventListener('toggle', async () => {
      if (!details.open || loaded) return;
      loaded = true;
      const body = details.querySelector(`[data-history-body="${details.dataset.history}"]`);
      try {
        const history = await api(`/admin/nodes/${details.dataset.history}/history?hours=24`);
        body.innerHTML = renderNodeHistory(history);
      } catch (error) {
        body.innerHTML = `<p class="small bad" style="margin:.6rem 0 0">${escapeHtml(tr('common.error'))}</p>`;
      }
    });
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
/**
 * Die Ja/Nein-Merkmale eines Tarifs.
 *
 * Die Beschriftung steht in i18n.js wie jeder andere sichtbare Text (`plan.flag.<merkmal>`) –
 * vorher standen hier deutsche Sätze im Quelltext, und der Admin-Bereich war damit auf Englisch
 * halb deutsch. `fakehost` fehlte ganz: Die Spalte gibt es, der Server nimmt sie entgegen, und
 * `profiles.js` entscheidet daran über den Fake-Host – nur ändern ließ sie sich hier nicht.
 */
const PLAN_FLAG_KEYS = [
  'free_slot',
  'premium',
  'movement',
  'proxy',
  'offline_accounts',
  'fakehost',
  'chat_limit_editable',
  'priority_support',
  'board',
  'menus',
  'pov',
  'addons',
  'highlight',
  'active',
];

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
      label: tr('plan.blurbDe'),
      type: 'textarea',
      value: plan.blurb_de || '',
      hint: tr('plan.blurbHint'),
    },
    { key: 'blurb_en', label: tr('plan.blurbEn'), type: 'textarea', value: plan.blurb_en || '' },
    // Der Wortlaut der Merkmalsliste auf der Preisseite. Leer = die Liste baut sich aus den
    // Zahlen dieses Tarifs zusammen (siehe planLines in server/landing.js).
    {
      key: 'features_de',
      label: tr('plan.featuresDe'),
      type: 'textarea',
      value: plan.features_de || '',
      hint: tr('plan.featuresHint'),
    },
    {
      key: 'features_en',
      label: tr('plan.featuresEn'),
      type: 'textarea',
      value: plan.features_en || '',
      hint: tr('plan.featuresHint'),
    },
    { key: 'price_credits', label: `${tr('common.credits')} / 30 d`, type: 'number', min: 0, value: plan.price_credits ?? 0 },
    { key: 'max_accounts', label: tr('pricing.bots'), type: 'number', min: 1, value: plan.max_accounts ?? 1 },
    { key: 'chat_limit', label: tr('pricing.chatHistory'), type: 'number', min: 20, value: plan.chat_limit ?? 200 },
    { key: 'max_macros', label: tr('plan.macros'), type: 'number', min: 0, value: plan.max_macros ?? 20 },
    // "Zustand" stand über dem Feld für die **Reihenfolge** – ein Wort, das nichts damit zu tun hat.
    { key: 'sort', label: tr('common.order'), type: 'number', min: 0, value: plan.sort ?? 50 },
    {
      key: 'discord_role',
      label: tr('plan.discordRole'),
      value: plan.discord_role || '',
      hint: tr('plan.discordRoleHint'),
    },
    ...PLAN_FLAG_KEYS.map((flag) => ({
      key: flag,
      label: tr(`plan.flag.${flag}`),
      type: 'checkbox',
      value: Boolean(plan[flag]),
    })),
  ];

  $('#new').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('common.create'),
      [{ key: 'slug', label: tr('plan.slug'), required: true }, ...fields()],
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
    { key: 'key', label: tr('ad.key'), value: addon.key || '', required: true, hint: tr('ad.keyHint') },
    { key: 'name_de', label: 'Name (DE)', value: addon.name_de || '', required: true },
    { key: 'name_en', label: 'Name (EN)', value: addon.name_en || '' },
    { key: 'text_de', label: 'Text (DE)', type: 'textarea', value: addon.text_de || '' },
    { key: 'text_en', label: 'Text (EN)', type: 'textarea', value: addon.text_en || '' },
    { key: 'price_credits', label: `${tr('common.credits')} / 30 d`, type: 'number', min: 0, value: addon.price_credits ?? 0 },
    {
      key: 'kind',
      label: tr('ad.kind'),
      type: 'select',
      value: addon.kind || 'flag',
      options: [
        { value: 'flag', label: tr('ad.kind.flag') },
        { value: 'slot', label: tr('ad.kind.slot') },
      ],
    },
    {
      key: 'flag',
      label: tr('ad.flag'),
      value: addon.flag || '',
      hint: 'board · menus · pov · movement · proxy · fakehost · offline_accounts',
    },
    { key: 'amount', label: tr('ad.amount'), type: 'number', min: 1, value: addon.amount ?? 1 },
    { key: 'max_qty', label: tr('ad.maxQty'), type: 'number', min: 1, value: addon.max_qty ?? 1 },
    { key: 'need_cap', label: tr('ad.needCap'), value: addon.need_cap || '' },
    { key: 'sort', label: tr('common.order'), type: 'number', min: 0, value: addon.sort ?? 50 },
    { key: 'available', label: tr('ad.available'), type: 'checkbox', value: addon.available !== 0 },
    { key: 'active', label: tr('ad.visible'), type: 'checkbox', value: addon.active !== 0 },
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

/** Der Zustand einer Aufladung, wie ihn ein Mensch liest – nicht der rohe Datenbankwert. */
const topupStatus = (status) => {
  const label = tr(`adm.topup.${status}`);
  // Ein unbekannter Zustand bleibt sichtbar, statt als leere Zelle zu verschwinden.
  return label === `adm.topup.${status}` ? String(status) : label;
};

async function topups(root) {
  const data = await api('/admin/topups');
  root.innerHTML = panel(
    tr('adm.topups'),
    table(
      ['#', tr('adm.users'), tr('bill.method'), tr('common.credits'), tr('bill.reference'), tr('common.status'), ''],
      data.topups.map(
        (topup) => `<tr>
          <td class="mono small muted">${topup.id}</td>
          <td class="small"><a href="#/admin/users/${topup.user_id}">${escapeHtml(topup.display_name || `#${topup.user_id}`)}</a></td>
          <td class="small">${escapeHtml(topup.provider)}</td>
          <td class="mono">${credits(topup.credits)} <span class="small muted">${euro(topup.amount_cent)}</span></td>
          <td class="mono small">${escapeHtml(topup.reference || '–')}</td>
          <td><span class="pill ${topup.status === 'open' ? 'missing' : ''}">${escapeHtml(
            topupStatus(topup.status)
          )}</span></td>
          <td style="text-align:right;white-space:nowrap">
            ${
              topup.status === 'open'
                ? `<button class="btn btn-sm btn-primary" data-settle="${topup.id}">${escapeHtml(
                    tr('adm.markPaid')
                  )}</button>
                   <button class="btn btn-sm" data-cancel="${topup.id}">${escapeHtml(tr('common.cancel'))}</button>`
                : `${
                    topup.status === 'paid' && topup.provider === 'stripe'
                      ? `<button class="btn btn-sm" data-refund="${topup.id}">${escapeHtml(tr('adm.refund'))}</button> `
                      : ''
                  }<span class="small muted mono">${topup.paid_at ? datetime(topup.paid_at) : ''}</span>`
            }
          </td>
        </tr>`
      )
    ),
    // Der zweite Knopf erscheint nur, wenn es wirklich Belege gelöschter Konten gibt. Ein Knopf,
    // der fast immer eine leere Datei liefert, ist kein Angebot, sondern eine Falle.
    exportButton('topups') +
      (data.archived
        ? ` <a class="btn btn-sm btn-ghost" href="/api/admin/export/receipts" download
             title="${escapeHtml(tr('adm.archivedReceiptsHint'))}">${icon('download')} ${escapeHtml(
            tr('adm.archivedReceipts', { n: data.archived })
          )}</a>`
        : '')
  );

  $$('[data-settle]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api(`/admin/topups/${button.dataset.settle}/settle`, { method: 'POST' })
        .then(() => ok(tr('adm.saved')))
        .catch(fail);
      draw();
    })
  );
  $$('[data-refund]').forEach((button) =>
    button.addEventListener('click', async () => {
      const topup = data.topups.find((entry) => entry.id === Number(button.dataset.refund));
      const answer = await formDialog(
        tr('adm.refund'),
        [
          {
            key: 'amount_cent',
            label: tr('adm.refundAmount'),
            type: 'number',
            value: 0,
            min: 0,
            max: topup.amount_cent,
            hint: tr('adm.refundHint', { full: euro(topup.amount_cent) }),
          },
          {
            key: 'reason',
            label: tr('adm.reason'),
            type: 'select',
            value: 'requested_by_customer',
            options: [
              { value: 'requested_by_customer', label: tr('adm.refundAsked') },
              { value: 'duplicate', label: tr('adm.refundDouble') },
              { value: 'fraudulent', label: tr('adm.refundFraud') },
            ],
          },
        ],
        { submit: tr('adm.refund'), note: `#${topup.id} · ${topup.display_name || `#${topup.user_id}`} · ${euro(topup.amount_cent)}` }
      );
      if (!answer) return;
      const result = await send(
        `/admin/topups/${topup.id}/refund`,
        { method: 'POST', body: { amount_cent: Number(answer.amount_cent) || 0, reason: answer.reason } },
        { done: false }
      );
      // Die Rückbuchung der Credits kommt über den Webhook und nicht aus dieser Antwort – das
      // steht auch so in der Meldung, sonst wartet jemand vergeblich auf eine Zahl, die sich
      // erst in ein paar Sekunden ändert.
      if (result) ok(tr(result.partial ? 'adm.refundPartial' : 'adm.refundDone'));
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
                ? escapeHtml(tr('adm.voucherLeft', { n: voucher.uses_left }))
                : `<span class="pill missing">${escapeHtml(tr('adm.voucherUsedUp'))}</span>`
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
        { key: 'count', label: tr('adm.voucherCount'), type: 'number', min: 1, max: 50, value: 1 },
        { key: 'uses', label: tr('adm.voucherUses'), type: 'number', min: 1, value: 1 },
        {
          key: 'expires_days',
          label: `${tr('common.days')} (0 = ${tr('common.never')})`,
          type: 'number',
          min: 0,
          value: 0,
        },
        { key: 'note', label: tr('adm.note'), value: '' },
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
      label: tr('adm.proxyKind'),
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
        ...userList.users.map((user) => ({ value: String(user.id), label: user.display_name || `#${user.id}` })),
      ],
    },
    { key: 'note', label: tr('adm.note'), value: proxy.note || '' },
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
                    <span class="strong">${escapeHtml(bilingual(entry, 'title'))}</span>
                    ${entry.active ? `<span class="pill primary">live</span>` : ''}
                  </div>
                  <p class="small muted" style="margin:.5rem 0 0">${escapeHtml(bilingual(entry, 'body'))}</p>
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

  // Die Rundmail steht bei den Ankündigungen, weil beides dieselbe Frage beantwortet: „Wie sage
  // ich es allen?“ Der Unterschied ist nur, ob die Nachricht auch im Panel stehen bleibt.
  const mailBox = document.createElement('div');
  mailBox.style.marginTop = '1.5rem';
  root.append(mailBox);
  await broadcastPanel(mailBox);

  const fields = (entry = {}) => [
    { key: 'title_de', label: 'Titel (DE)', value: entry.title_de || '', required: true },
    { key: 'title_en', label: 'Titel (EN)', value: entry.title_en || '' },
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
      const answer = await formDialog(bilingual(entry, 'title'), fields(entry));
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
  // Die Linked-Role-Bedingungen kommen fertig geprüft vom Server – auch dann, wenn noch nie
  // etwas gespeichert wurde. Dann sind es die Vorgaben, und der Editor zeigt, was gerade gilt.
  const meta = data.linked_roles || { max: 5, types: [], sources: [], fields: [] };
  const linked = structuredClone(meta.fields || []);
  const sourceByKey = Object.fromEntries((meta.sources || []).map((entry) => [entry.key, entry]));

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
          ${group.key === 'payments' ? stripeTools(data) : ''}
          ${group.key === 'discord' ? discordTools(data) : ''}
          ${group.key === 'linkedroles' ? linkedRolesTools(data) : ''}
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

    // Die Linked-Role-Bedingungen. Wie die Aufladepakete eine Liste aus Objekten, nur mit fünf
    // Angaben je Eintrag statt vier – und mit zwei Auswahlfeldern, die voneinander abhängen.
    if (entry.type === 'linkedroles') {
      return `<div class="field">
        <label>${escapeHtml(entry.label)}</label>
        <div class="lr-editor" id="linked-roles"></div>
        <button type="button" class="btn btn-sm" id="add-linked" style="align-self:flex-start;margin-top:.6rem">
          ${icon('plus')} ${escapeHtml(tr('adm.lrAdd'))}</button>
        ${help}
      </div>`;
    }

    // Eine Auswahl aus festen Möglichkeiten. Sie stehen in der Beschreibung der Einstellung und
    // kommen von dort mit – das Panel kennt sie nicht selbst.
    if (entry.type === 'select') {
      const current = String(value(entry.key));
      return `<div class="field"><label for="${id}">${escapeHtml(entry.label)}</label>
        <select id="${id}" data-set="${entry.key}">
          ${(entry.options || [])
            .map(
              (option) =>
                `<option value="${escapeHtml(option.value)}" ${
                  option.value === current ? 'selected' : ''
                }>${escapeHtml(option.label)}</option>`
            )
            .join('')}
        </select>
        ${help}</div>`;
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

  /**
   * Der Selbsttest für Stripe.
   *
   * Beim Einrichten ist die Frage nie "läuft der Server", sondern "nimmt Stripe meinen Schlüssel
   * an, und darf dieses Konto kassieren". Der Knopf beantwortet genau das – ohne dass jemand erst
   * etwas kaufen muss.
   *
   * **Der Betriebsmodus steht mit dabei.** Ein Testschlüssel im Echtbetrieb (oder umgekehrt) ist
   * die häufigste Panne beim Umschalten, und sie sieht von außen aus wie "es geht einfach nicht".
   */
  function stripeTools(data) {
    const state_ = data.stripe || {};
    return `<div class="note ${state_.ready ? '' : 'warn'}" style="margin:0">
      ${icon(state_.ready ? 'check' : 'info')}
      <div class="small grow">
        <strong>${escapeHtml(tr('adm.stripeState'))}:</strong>
        ${escapeHtml(
          state_.ready ? tr('adm.stripeReady') : state_.enabled ? tr('adm.stripeKeys') : tr('adm.stripeOff')
        )}
        ${
          state_.ready
            ? ` · <span class="pill ${state_.live ? '' : 'missing'}">${escapeHtml(
                state_.live ? tr('adm.stripeLive') : tr('adm.stripeTestMode')
              )}</span>`
            : ''
        }
        · ${escapeHtml(tr('adm.stripeHook'))}:
        ${escapeHtml(state_.webhook_ready ? tr('adm.stripeSet') : tr('adm.stripeMissing'))}
        <div class="small muted mono" style="margin-top:.35rem">${escapeHtml(state_.webhook_url || '')}</div>
        <div id="stripe-result" class="small muted" style="margin-top:.35rem"></div>
      </div>
      <button type="button" class="btn btn-sm" id="stripe-test">${escapeHtml(tr('adm.stripeTest'))}</button>
    </div>`;
  }

  /**
   * Der Zustand des Bots und die beiden Knöpfe dazu.
   *
   * "Neu laden" ist der Alltag: der Bot holt die Einstellungen erneut und richtet Rollen, Rechte
   * und Linked Roles danach aus, ohne dass jemand etwas merkt. "Neu starten" beendet den Prozess –
   * das braucht es, wenn ein neuer Bot-Token gilt oder der Bot hängt. Dass er zurückkommt, ist
   * Sache des Dienstes; deshalb steht genau das an dem Knopf und nicht bloß "Neustart".
   */
  function discordTools(data) {
    const bot = data.bot || {};
    return `<div class="note ${bot.connected ? '' : 'warn'}" style="margin:0">
      ${icon(bot.connected ? 'check' : 'info')}
      <div class="small grow">
        <strong>${escapeHtml(tr('adm.botStatus'))}:</strong>
        ${escapeHtml(bot.connected ? tr('adm.botConnected') : tr('adm.botAway'))}
        ${
          bot.last_heartbeat
            ? ` · ${escapeHtml(tr('adm.when'))} ${datetime(bot.last_heartbeat.at)}`
            : ''
        }
        <br>${escapeHtml(tr('adm.detail'))}: <span class="mono">docs/discord-bot.md</span>
        <div class="row wrap" style="gap:.5rem;margin-top:.6rem">
          <button type="button" class="btn btn-sm" id="bot-reload" ${bot.connected ? '' : 'disabled'}>
            ${icon('refresh')} ${escapeHtml(tr('adm.botReload'))}</button>
          <button type="button" class="btn btn-sm btn-danger" id="bot-restart" ${
            bot.connected ? '' : 'disabled'
          }>${icon('power')} ${escapeHtml(tr('adm.botRestart'))}</button>
        </div>
        <div class="small muted" style="margin-top:.35rem">${escapeHtml(tr('adm.botRestartHint'))}</div>
      </div>
    </div>`;
  }

  /** Die Adresse, die im Developer Portal als Linked-Roles-Verifizierung eintragen wird. */
  function linkedRolesTools(data) {
    const url = data.linked_roles?.verification_url || '';
    return `<div class="note" style="margin:0">${icon('info')}
      <div class="small grow">
        <strong>${escapeHtml(tr('adm.lrVerifyUrl'))}</strong>
        <div class="mono" style="margin-top:.3rem;word-break:break-all">${escapeHtml(url)}</div>
        <div class="muted" style="margin-top:.35rem">${escapeHtml(tr('adm.lrVerifyHint'))}</div>
      </div>
    </div>`;
  }

  /**
   * Die Bedingungen für Discords Linked Roles.
   *
   * Die **Quelle** ist die eigentliche Angabe: sie sagt, welchen Wert das Panel veröffentlicht.
   * Alles andere hängt daran – der Vergleich muss zur Art des Werts passen (eine Zahl lässt sich
   * nicht mit "ist Ja" prüfen), und Name und Beschreibung sind das, was in Discord im
   * Rollen-Dialog steht. Deshalb füllt eine neu gewählte Quelle die Felder, die noch unberührt
   * sind, gleich mit; wer eigene Worte will, überschreibt sie und behält sie.
   */
  const typesFor = (kind) => (meta.types || []).filter((entry) => entry.kind === kind);

  const paintLinked = () => {
    const box = $('#linked-roles');
    if (!box) return;

    box.innerHTML = linked.length
      ? linked
          .map((row, index) => {
            const source = sourceByKey[row.source];
            const kinds = typesFor(source?.kind);
            return `<div class="lr-card">
              <div class="lr-grid">
                <div class="field">
                  <label for="lr-src-${index}">${escapeHtml(tr('adm.lrSource'))}</label>
                  <select id="lr-src-${index}" data-lr="${index}" data-key="source">
                    ${(meta.sources || [])
                      .map(
                        (entry) =>
                          `<option value="${escapeHtml(entry.key)}" ${
                            entry.key === row.source ? 'selected' : ''
                          }>${escapeHtml(entry.label)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <div class="field">
                  <label for="lr-type-${index}">${escapeHtml(tr('adm.lrType'))}</label>
                  <select id="lr-type-${index}" data-lr="${index}" data-key="type">
                    ${kinds
                      .map(
                        (entry) =>
                          `<option value="${entry.value}" ${
                            Number(entry.value) === Number(row.type) ? 'selected' : ''
                          }>${escapeHtml(entry.label)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <div class="field">
                  <label for="lr-key-${index}">${escapeHtml(tr('adm.lrKey'))}</label>
                  <input id="lr-key-${index}" type="text" data-lr="${index}" data-key="key"
                    value="${escapeHtml(row.key || '')}" spellcheck="false" autocapitalize="off">
                </div>
                <button type="button" class="btn btn-ghost btn-sm btn-danger" data-lr-del="${index}"
                  title="${escapeHtml(tr('common.delete'))}">${icon('x')}</button>
              </div>
              <div class="lr-grid lr-text">
                <div class="field">
                  <label for="lr-name-${index}">${escapeHtml(tr('adm.lrName'))}</label>
                  <input id="lr-name-${index}" type="text" data-lr="${index}" data-key="name"
                    maxlength="100" value="${escapeHtml(row.name || '')}">
                </div>
                <div class="field">
                  <label for="lr-desc-${index}">${escapeHtml(tr('adm.lrDesc'))}</label>
                  <input id="lr-desc-${index}" type="text" data-lr="${index}" data-key="description"
                    maxlength="200" value="${escapeHtml(row.description || '')}">
                </div>
              </div>
              <p class="small muted" style="margin:0">${escapeHtml(source?.help || '')}</p>
            </div>`;
          })
          .join('')
      : `<p class="small muted">${escapeHtml(tr('adm.lrNone'))}</p>`;

    $$('[data-lr]', box).forEach((input) =>
      input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
        const index = Number(input.dataset.lr);
        const key = input.dataset.key;
        const row = linked[index];

        if (key === 'source') {
          const before = sourceByKey[row.source];
          const after = sourceByKey[input.value];
          row.source = input.value;
          // Der Schlüssel, der Name und die Beschreibung folgen der Quelle, solange sie nicht von
          // Hand geändert wurden. Wer "Administrator" gegen "Premium" tauscht, will keine
          // Bedingung, die in Discord weiterhin "Administrator" heißt.
          if (!row.key || row.key === before?.key) row.key = after?.key || row.key;
          if (!row.name || row.name === before?.label) row.name = after?.label || '';
          if (!row.description || row.description === before?.help) row.description = after?.help || '';
          if (!typesFor(after?.kind).some((entry) => Number(entry.value) === Number(row.type))) {
            row.type = typesFor(after?.kind)[0]?.value ?? row.type;
          }
          paintLinked();
          return;
        }

        if (key === 'type') row.type = Number(input.value);
        else if (key === 'key') row.key = input.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
        else row[key] = input.value;

        // Der Schlüssel wird beim Tippen bereinigt – ohne diese Zeile stünde im Feld weiter, was
        // gerade herausgefiltert wurde, und der Wert dahinter wäre ein anderer.
        if (key === 'key' && input.value !== row.key) input.value = row.key;
      })
    );

    $$('[data-lr-del]', box).forEach((button) =>
      button.addEventListener('click', () => {
        linked.splice(Number(button.dataset.lrDel), 1);
        paintLinked();
      })
    );

    const add = $('#add-linked');
    if (add) add.disabled = linked.length >= (meta.max || 5);
  };
  paintLinked();

  $('#add-linked')?.addEventListener('click', () => {
    if (linked.length >= (meta.max || 5)) return;
    // Die erste Quelle, die noch nicht benutzt ist – zwei Bedingungen auf denselben Wert wären
    // in Discord zwei Felder, die immer dasselbe sagen.
    const taken = new Set(linked.map((row) => row.source));
    const source = (meta.sources || []).find((entry) => !taken.has(entry.key)) || meta.sources?.[0];
    if (!source) return;
    linked.push({
      key: source.key,
      source: source.key,
      type: typesFor(source.kind)[0]?.value ?? 7,
      name: source.label,
      description: source.help,
    });
    paintLinked();
  });

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
    if (fields.some((entry) => entry.type === 'linkedroles')) body.discord_role_metadata = linked;
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

  /**
   * Bot neu laden oder neu starten.
   *
   * Der Neustart wird nachgefragt: er unterbricht laufende Ticket-Gespräche für ein paar
   * Sekunden, und wer nur eine geänderte Rolle übernehmen will, ist mit "Neu laden" besser
   * bedient. Ein Knopf, der ohne Rückfrage einen Dienst beendet, gehört an keine Stelle, an der
   * man auch nur etwas speichern wollte.
   */
  for (const [selector, action, ask] of [
    ['#bot-reload', 'reload', false],
    ['#bot-restart', 'restart', true],
  ]) {
    $(selector)?.addEventListener('click', async (event) => {
      if (ask && !(await confirmDialog(tr('adm.botRestartAsk'), { confirm: tr('adm.discordBotRestart') }))) {
        return;
      }
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api(`/admin/bot/${action}`, { method: 'POST' });
        ok(tr(action === 'restart' ? 'adm.botRestarting' : 'adm.botReloading'));
      } catch (error) {
        fail(error);
      } finally {
        button.disabled = false;
      }
    });
  }

  $('#stripe-test')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const box = $('#stripe-result');
    button.disabled = true;
    box.textContent = `${tr('common.loading')} …`;
    try {
      const result = await api('/admin/stripe/test', { method: 'POST' });
      box.innerHTML = `${escapeHtml(result.message)}${
        result.account ? ` <span class="muted">(${escapeHtml(result.account)})</span>` : ''
      }${
        result.checkout_url
          ? ` <a href="${escapeHtml(safeLink(result.checkout_url))}" target="_blank" rel="noopener">${escapeHtml(
              tr('adm.stripeOpen')
            )}</a>`
          : ''
      }`;
      if (result.ok) ok(result.message);
    } catch (error) {
      box.textContent = error.message;
      fail(error);
    } finally {
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- Client, Post, Protokolle

async function client(root) {
  const [clientResponse, rolloutPreview] = await Promise.all([api('/admin/client'), api('/admin/client/rollout-preview')]);
  const data = clientResponse.client;
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

    <!-- Wer läuft noch mit einer Datei, die es so nicht mehr gibt? Ein Bot hält seine Client-Datei
         offen; der Abgleich tauscht sie unter ihm aus. Ohne diesen Kasten stand im Panel
         „Client 2.6.0“, während zwanzig Bots seit zwei Wochen 2.5.0 waren. -->
    ${
      data.outdated
        ? `<div class="note" style="margin-bottom:1.25rem">${icon('download')}
            <div class="grow">
              <strong>${escapeHtml(tr('adm.clientOutdatedCount', { n: data.outdated, total: data.running }))}</strong>
              <div class="small muted mono">${Object.entries(data.outdated_by_version || {})
                .sort((a, b) => b[1] - a[1])
                .map(([version, count]) => `${escapeHtml(version)}: ${count}`)
                .join(' · ')} → ${escapeHtml(data.version || '?')}</div>
            </div>
            <button class="btn btn-sm btn-primary" id="rollout">${icon('refresh')} ${escapeHtml(
              tr('adm.clientRollout')
            )}</button>
          </div>`
        : ''
    }

    ${
      rolloutPreview.bots.length
        ? panel(
            tr('adm.clientRolloutPlan'),
            `<p class="small muted" style="margin:0 0 .8rem">${escapeHtml(
              tr('adm.clientRolloutPlanHint', { seconds: Math.ceil(rolloutPreview.estimated_ms / 1000) })
            )}</p>
             ${table(
               [tr('adm.servers'), tr('ov.col.account'), tr('ops.node'), tr('adm.clientRolloutAfter')],
               rolloutPreview.bots.map(
                 (bot) => `<tr><td>${escapeHtml(bot.profile)}</td><td>${escapeHtml(bot.account)}</td>
                   <td class="small muted">${escapeHtml(bot.node || tr('ops.here'))}</td>
                   <td class="mono small muted">${escapeHtml(tr('adm.clientRolloutAfterValue', { seconds: Math.ceil(bot.starts_after_ms / 1000) }))}</td></tr>`
               )
             )}`
          )
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

    <!-- Die Minecraft-Ressourcen. Sie kommen nicht aus dem Release des Clients und dürfen es auch
         nicht: Es sind die Originaldateien des Spiels. Ohne sie läuft alles wie bisher, nur bleibt
         die Live-Ansicht die farbige Voxelansicht – und genau das steht hier auch, damit niemand
         den Fehler bei einem Kunden sucht, der für die Ansicht bezahlt hat. -->
    <section class="panel" style="margin-bottom:1.5rem">
      <header>
        <h3>${escapeHtml(tr('adm.mc.title'))}</h3>
        <span class="small muted mono">${escapeHtml(data.resources_dir || '')}</span>
      </header>
      <div class="body stack">
        <p class="small muted" style="margin:0">${escapeHtml(tr('adm.mc.lead'))}</p>
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>${escapeHtml(tr('srv.version'))}</th>
            <th>${escapeHtml(tr('common.status'))}</th>
            <th>Byte</th><th>SHA-256</th><th></th>
          </tr></thead>
          <tbody>
            ${
              (data.resources || []).length
                ? ''
                : `<tr><td colspan="5" class="muted small">${escapeHtml(tr('adm.mc.noVersions'))}</td></tr>`
            }
            ${(data.resources || [])
              .map(
                (entry) => `<tr>
                  <td class="mono">${escapeHtml(entry.version)}</td>
                  <td><span class="pill ${entry.present ? 'primary' : 'missing'}">${
                    entry.present ? escapeHtml(tr('adm.mc.there')) : escapeHtml(tr('adm.mc.missing'))
                  }</span></td>
                  <td class="mono small muted">${entry.present ? bytes(entry.size) : '–'}</td>
                  <td class="mono small muted truncate" style="max-width:12rem">${escapeHtml(
                    (entry.sha256 || '–').slice(0, 16)
                  )}</td>
                  <td class="row" style="gap:.35rem;justify-content:flex-end">
                    <button class="btn btn-sm" data-mc-upload="${escapeHtml(entry.version)}">${icon(
                      'paperclip'
                    )} ${escapeHtml(tr('adm.mc.upload'))}</button>
                    <button class="btn btn-sm" data-mc-fetch="${escapeHtml(entry.version)}">${icon(
                      'download'
                    )} ${escapeHtml(tr('adm.mc.fetch'))}</button>
                    ${
                      entry.present
                        ? `<button class="btn btn-ghost btn-sm btn-danger" data-mc-drop="${escapeHtml(
                            entry.version
                          )}" title="${escapeHtml(tr('common.delete'))}">${icon('trash')}</button>`
                        : ''
                    }
                  </td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table></div>
        <p class="small muted" style="margin:0">${escapeHtml(tr('adm.mc.where'))}</p>
      </div>
    </section>

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
    )}

    <input type="file" id="mc-file" accept=".jar,application/java-archive" hidden>`;

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

  $('#rollout')?.addEventListener('click', async (event) => {
    // Das trifft fremde Serverplätze: Jeder betroffene Bot verlässt sein Spiel und kommt wieder,
    // und der Kunde hat nicht darum gebeten. Die Rückfrage nennt deshalb die Zahl.
    if (!(await confirmDialog(tr('adm.clientRolloutAsk', { n: data.outdated }), {
      confirm: tr('adm.clientRollout'),
      danger: false,
    }))) {
      return;
    }
    event.currentTarget.disabled = true;
    try {
      const result = await api('/admin/client/rollout', { method: 'POST' });
      ok(tr('adm.clientRolloutDone', { n: result.restarted }));
      draw();
    } catch (error) {
      fail(error);
      event.currentTarget.disabled = false;
    }
  });

  // ---- Minecraft-Ressourcen -------------------------------------------------------------------
  //
  // Der Rumpf **ist** die Datei, wie beim Ticket-Anhang. Ein Formular mit mehreren Teilen wäre für
  // eine einzelne Datei von vierzig Megabyte nur ein zweiter Parser.
  const picker = $('#mc-file');
  let pending = null;

  for (const button of $$('[data-mc-upload]')) {
    button.addEventListener('click', () => {
      pending = button.dataset.mcUpload;
      picker.value = '';
      picker.click();
    });
  }

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file || !pending) return;
    const version = pending;
    pending = null;
    toast(tr('adm.mc.uploading', { version }));
    try {
      const response = await fetch(`/api/admin/resources/${encodeURIComponent(version)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/java-archive' },
        credentials: 'same-origin',
        body: file,
      });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(answer.error || `${response.status}`);
      ok(tr('adm.saved'));
      draw();
    } catch (error) {
      fail(error);
    }
  });

  for (const button of $$('[data-mc-fetch]')) {
    button.addEventListener('click', async () => {
      const version = button.dataset.mcFetch;
      button.disabled = true;
      toast(tr('adm.mc.fetching', { version }));
      try {
        await api(`/admin/resources/${encodeURIComponent(version)}/fetch`, { method: 'POST' });
        ok(tr('adm.saved'));
        draw();
      } catch (error) {
        fail(error);
        button.disabled = false;
      }
    });
  }

  for (const button of $$('[data-mc-drop]')) {
    button.addEventListener('click', async () => {
      const version = button.dataset.mcDrop;
      if (!(await confirmDialog(tr('adm.mc.dropAsk', { version }), { confirm: tr('common.delete') }))) return;
      try {
        await api(`/admin/resources/${encodeURIComponent(version)}`, { method: 'DELETE' });
        ok(tr('adm.saved'));
        draw();
      } catch (error) {
        fail(error);
      }
    });
  }
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
        <option value="sent" ${status === 'sent' ? 'selected' : ''}>${escapeHtml(tr('adm.mailStatusSent'))}</option>
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
        ['', tr('auth.register.email'), tr('tk.subject'), tr('adm.mailKind'), tr('common.status')],
        data.mails.map(
          (mail) => `<tr data-mail="${mail.id}" style="cursor:pointer">
            <td class="small muted mono">${datetime(mail.created_at)}</td>
            <td class="small">${escapeHtml(mail.recipient)}
              ${
                mail.display_name
                  ? `<a class="small muted" href="#/admin/users/${mail.user_id}">${escapeHtml(mail.display_name)}</a>`
                  : ''
              }</td>
            <td class="small">${escapeHtml(mail.subject)}</td>
            <td class="small muted mono">${escapeHtml(mail.kind)}</td>
            <td><span class="pill ${mail.status === 'sent' ? '' : 'missing'}"
              title="${escapeHtml(mail.error || '')}">${escapeHtml(
                mail.status === 'sent' ? tr('adm.mailStatusSent') : mail.error || tr('common.error')
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

  bindRows('[data-mail]', async (row) => {
    try {
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
    } catch (error) {
      // Eine Nachricht, die sich nicht öffnen lässt, gehört gesagt. Vorher blieb der Klick
      // wirkungslos und der Fehler stand nur in der Browser-Konsole.
      fail(error);
    }
  });
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
          <td class="small"><a href="#/admin/users/${row.user_id}">${escapeHtml(row.display_name || `#${row.user_id}`)}</a></td>
          <td class="small">${escapeHtml(row.kind)} ${
            row.note ? `<span class="muted">· ${escapeHtml(row.note)}</span>` : ''
          }</td>
          <td class="mono" style="color:${row.delta >= 0 ? 'var(--ok)' : 'var(--text)'}">${
            row.delta >= 0 ? '+' : ''
          }${credits(row.delta)}</td>
          <td class="mono small muted">${credits(row.balance)}</td>
        </tr>`
      )
    ),
    exportButton('ledger')
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
                entry.label
              )} (${entry.n})</option>`
          )
          .join('')}
      </select>
      <input id="q" type="search" placeholder="${escapeHtml(tr('common.search'))}"
        value="${escapeHtml(query)}" style="max-width:16rem">
      <div class="grow"></div>
      ${exportButton('audit')}
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
                        ? `<a href="#/admin/users/${entry.user_id}">${escapeHtml(entry.display_name || `#${entry.user_id}`)}</a>`
                        : '<span class="muted">System</span>'
                    }</span>
                    <span class="log-action">${escapeHtml(entry.action_label || entry.action)}</span>
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
                                          // `common.yes` ist die Beschriftung eines
                                          // Bestätigungsknopfes ("Ja, weiter") – als Wert eines
                                          // Ja/Nein-Feldes im Protokoll stand dort ein halber Satz.
                                          field.flag ? escapeHtml(tr('common.on')) : '–'
                                        }</span>`
                                      : field.link
                                        ? `<a href="${escapeHtml(safeLink(field.link))}">${escapeHtml(field.value)}</a>`
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

// ---------------------------------------------------------------- Sicherheit
//
// Drei Listen, die zusammen eine Geschichte ergeben: wer klopft, wer drin ist, wer draußen
// bleibt. Getrennt wären sie drei Bildschirme, zwischen denen niemand hin und her sieht – und
// genau der Vergleich ist die Arbeit: Die Adresse, die achtzigmal danebengetippt hat, ist die,
// die gesperrt gehört.

async function security(root) {
  const data = await api('/admin/security');
  const failed = data.ips.reduce((sum, row) => sum + row.failed, 0);
  const active = data.blocks.filter((block) => !block.expired);

  const reason = (attempt) => {
    if (attempt.ok) {
      // Ein geglückter Versuch mit `code` ist der zweite Schritt einer Anmeldung und nicht ihr
      // Anfang – als schlichtes „angemeldet“ stünde er zweimal in derselben Liste.
      const key = attempt.reason === 'code' ? 'sec.codeOk' : 'sec.ok';
      return `<span class="pill primary">${escapeHtml(tr(key))}</span>`;
    }
    const keys = {
      wrong: 'sec.wrong',
      blocked: 'sec.blockedAccount',
      throttled: 'sec.throttled',
      code: 'sec.codeWrong',
    };
    return `<span class="pill missing">${escapeHtml(tr(keys[attempt.reason] || 'sec.wrong'))}</span>`;
  };

  root.innerHTML = `
    <div class="grid three" style="margin-bottom:1.5rem">
      ${stat(tr('sec.failed48'), String(failed), tr('sec.failedFoot', { n: data.ips.length }))}
      ${stat(tr('sec.sessions'), String(data.sessions.length), tr('sec.sessionsFoot'))}
      ${stat(tr('sec.blocks'), String(active.length), tr('sec.blocksFoot'))}
    </div>

    ${panel(
      tr('sec.busy'),
      table(
        [tr('sec.address'), tr('sec.tries'), tr('sec.failedShort'), tr('sec.accounts'), tr('sec.last'), ''],
        data.ips.map(
          (row) => `<tr>
            <td class="mono small">${escapeHtml(row.ip)}
              ${row.ip === data.own_ip ? `<span class="pill">${escapeHtml(tr('sec.you'))}</span>` : ''}
              ${
                active.some((block) => block.value === row.ip)
                  ? `<span class="pill missing">${escapeHtml(tr('sec.blocked'))}</span>`
                  : ''
              }</td>
            <td class="mono small muted">${row.attempts}</td>
            <td class="mono">${row.failed}</td>
            <td class="mono small muted">${row.accounts}</td>
            <td class="small muted">${since(row.last_at)}</td>
            <td style="text-align:right">
              ${
                row.ip === data.own_ip
                  ? ''
                  : `<button class="btn btn-sm btn-danger" data-block="${escapeHtml(row.ip)}">${escapeHtml(
                      tr('sec.block')
                    )}</button>`
              }
            </td>
          </tr>`
        )
      ),
      `<span class="small muted">${escapeHtml(
        tr('sec.limits', {
          ip: data.limits.per_ip,
          account: data.limits.per_account,
          minutes: data.limits.window_minutes,
        })
      )}</span>`
    )}

    ${panel(
      tr('sec.blocks'),
      table(
        [tr('sec.address'), tr('adm.reason'), tr('sec.until'), ''],
        data.blocks.map(
          (block) => `<tr>
            <td class="mono small">${escapeHtml(block.value)}
              ${block.expired ? `<span class="pill">${escapeHtml(tr('sec.expired'))}</span>` : ''}</td>
            <td class="small muted">${escapeHtml(block.reason || '–')}</td>
            <td class="small muted">${block.expires_at ? datetime(block.expires_at) : tr('sec.forever')}</td>
            <td style="text-align:right">
              <button class="btn btn-sm" data-unblock="${block.id}">${escapeHtml(tr('sec.unblock'))}</button>
            </td>
          </tr>`
        )
      ),
      `<button class="btn btn-sm btn-primary" id="new-block">${icon('plus')} ${escapeHtml(tr('sec.block'))}</button>`
    )}

    ${panel(
      tr('sec.sessions'),
      table(
        [tr('adm.users'), tr('sec.address'), tr('sec.device'), tr('sec.since'), ''],
        data.sessions.map(
          (session) => `<tr>
            <td class="small"><a href="#/admin/users/${session.user_id}">${escapeHtml(session.display_name || `#${session.user_id}`)}</a>
              ${session.role === 'admin' ? '<span class="pill primary">admin</span>' : ''}</td>
            <td class="mono small muted">${escapeHtml(session.ip || '–')}</td>
            <td class="small muted truncate" style="max-width:22rem">${escapeHtml(session.agent || '–')}</td>
            <td class="small muted">${since(session.created_at)}</td>
            <td style="text-align:right">
              <button class="btn btn-sm" data-revoke="${session.id}">${escapeHtml(tr('sec.revoke'))}</button>
            </td>
          </tr>`
        )
      )
    )}

    ${panel(
      tr('sec.attempts'),
      table(
        ['', tr('sec.address'), tr('sec.tried'), ''],
        data.attempts.map(
          (attempt) => `<tr>
            <td class="small muted mono">${datetime(attempt.created_at)}</td>
            <td class="mono small">${escapeHtml(attempt.ip || '–')}</td>
            <td class="small">${
              attempt.user_id
                ? `<a href="#/admin/users/${attempt.user_id}">${escapeHtml(attempt.identifier)}</a>`
                : escapeHtml(attempt.identifier || '–')
            }</td>
            <td style="text-align:right">${reason(attempt)}</td>
          </tr>`
        )
      )
    )}`;

  const block = async (value) => {
    const answer = await formDialog(
      tr('sec.block'),
      [
        { key: 'value', label: tr('sec.address'), value, required: true, hint: tr('sec.cidrHint') },
        { key: 'reason', label: tr('adm.reason'), value: '' },
        { key: 'days', label: tr('sec.days'), type: 'number', value: 0, min: 0, hint: tr('sec.daysHint') },
      ],
      { submit: tr('sec.block') }
    );
    if (!answer) return;
    if (await send('/admin/security/blocks', { method: 'POST', body: { ...answer, days: Number(answer.days) } })) {
      draw();
    }
  };

  $('#new-block').addEventListener('click', () => block(''));
  $$('[data-block]').forEach((button) => button.addEventListener('click', () => block(button.dataset.block)));
  $$('[data-unblock]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (await send(`/admin/security/blocks/${button.dataset.unblock}`, { method: 'DELETE' })) draw();
    })
  );
  $$('[data-revoke]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('sec.revokeAsk')))) return;
      if (await send(`/admin/security/sessions/${button.dataset.revoke}`, { method: 'DELETE' })) draw();
    })
  );
}

// ---------------------------------------------------------------- Betrieb
//
// Was **gerade** läuft, auf allen Standorten zusammen, und was regelmäßig läuft.
//
// Beides stand vorher nirgends an einer Stelle: Laufende Bots waren über die Serverplätze
// verteilt, und wer wissen wollte, ob auf dem zweiten Standort noch etwas lief, klickte sich
// durch fremde Kundenkonten. Die wiederkehrenden Aufgaben gab es überhaupt nur als Zeilen in
// index.js – ob die Abrechnung heute Nacht lief, wusste das journal und sonst niemand.
//
// Die Ansicht lädt sich alle fünf Sekunden selbst nach. Das ist kein Live-Bild über die
// WebSocket-Leitung, und das ist Absicht: Ein Betreiber, der hier zusieht, ist die Ausnahme, und
// eine Ausnahme rechtfertigt keine zweite Zustandsverteilung neben der, die die Kundenansicht
// ohnehin schon hat.

/** Zu welcher Gruppe eine Warnung gehört – für die getrennte Darstellung auf der Betriebsseite. */
const ALERT_GROUPS = {
  'node-offline': 'nodes',
  'node-full': 'nodes',
  'client-error': 'client',
  'client-outdated': 'client',
  'job-failed': 'jobs',
  'proxy-unused': 'proxies',
};
const ALERT_GROUP_ORDER = ['nodes', 'client', 'jobs', 'proxies', 'other'];

/** Eine einzelne Warnzeile – unverändert gegenüber vorher, nur jetzt in einer Gruppe statt in einer langen Liste. */
const alertRow = (alert) =>
  `<a class="note ${alert.severity === 'bad' ? 'bad' : 'warn'}" href="#${alert.route}" style="margin:0;text-decoration:none">
    ${icon('alert')}<div><strong>${escapeHtml(operationAlertText(alert))}</strong>
      <p class="small" style="margin:.2rem 0 0">${escapeHtml(operationAlertHint(alert))}</p></div>
    <span aria-hidden="true">${icon('chevron-right')}</span>
  </a>`;

async function ops(root) {
  let timer = null;
  let onlyRunning = true;

  const paint = (data, jobs, operations) => {
    const bots = data.bots.filter((bot) => (onlyRunning ? bot.state !== 'offline' : true));
    const nodes = data.nodes;

    const grouped = new Map();
    for (const alert of operations.alerts) {
      const group = ALERT_GROUPS[alert.kind] || 'other';
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(alert);
    }
    const groupTitle = (group) =>
      group === 'other' ? tr('ops.attention') : tr(`ops.group.${group}`);

    // Job-Zustände und Proxy-Kapazität als Momentaufnahme: keine erfundene Historie, sondern
    // dieselben Zahlen, die auch die Tabellen darunter und `operations.proxy` schon zeigen –
    // hier nur als Verteilung statt als Einzelwerte.
    const jobsRunning = jobs.filter((job) => job.running).length;
    const jobsFailed = jobs.filter((job) => !job.running && job.last_error).length;
    const jobsOk = jobs.length - jobsRunning - jobsFailed;
    const jobStatus = chart.stacked(
      [
        { label: tr('ops.chart.jobsOk'), value: jobsOk, color: 'var(--ok)' },
        { label: tr('ops.chart.jobsFailed'), value: jobsFailed, color: 'var(--bad)' },
        { label: tr('ops.chart.jobsRunning'), value: jobsRunning, color: 'var(--warn)' },
      ],
      { format: (n) => String(n) }
    );
    const proxy = operations.proxy || { total: 0, assigned: 0, in_use: 0 };
    const proxyUnused = Math.max(0, proxy.assigned - proxy.in_use);
    const proxyFree = Math.max(0, proxy.total - proxy.assigned);
    const proxyCapacity = chart.stacked(
      [
        { label: tr('ops.chart.proxyInUse'), value: proxy.in_use, color: 'var(--ok)' },
        { label: tr('ops.chart.proxyUnused'), value: proxyUnused, color: 'var(--warn)' },
        { label: tr('ops.chart.proxyFree'), value: proxyFree, color: 'var(--chart-1)' },
      ],
      { format: (n) => String(n) }
    );

    root.innerHTML = `
      <div class="grid four" style="margin-bottom:1.5rem">
        ${stat(tr('ops.running'), String(data.running), tr('ops.runningFoot', { n: data.online }))}
        ${stat(tr('adm.nodes'), String(nodes.filter((node) => node.online).length), tr('ops.nodesFoot', { n: nodes.length }))}
        ${stat(tr('ops.slots'), String(new Set(data.bots.map((bot) => bot.profile_id)).size), tr('ops.slotsFoot'))}
        ${stat(tr('ops.errors'), String(data.bots.filter((bot) => bot.last_error).length), tr('ops.errorsFoot'))}
      </div>

      <div class="grid two" style="margin-bottom:1.5rem">
        ${chart.card({ title: tr('ops.chart.jobStatus'), note: tr('ops.jobs'), chart: jobStatus })}
        ${chart.card({ title: tr('ops.chart.proxyCapacity'), note: tr('adm.proxies'), chart: proxyCapacity })}
      </div>

      ${
        operations.alerts.length
          ? ALERT_GROUP_ORDER.filter((group) => grouped.has(group))
              .map((group) =>
                panel(
                  groupTitle(group),
                  `<div class="stack">${grouped
                    .get(group)
                    .map(alertRow)
                    .join('')}</div>`
                )
              )
              .join('')
          : `<div class="note" style="margin-bottom:1.5rem">${icon('check')}<div>${escapeHtml(tr('ops.attentionNone'))}</div></div>`
      }

      ${
        nodes.length
          ? panel(
              tr('adm.nodes'),
              table(
                [tr('common.name'), tr('common.status'), tr('adm.bots'), ''],
                nodes.map(
                  (node) => `<tr>
                    <td>${escapeHtml(node.name)} <span class="small muted">${escapeHtml(node.kind)}</span></td>
                    <td>${
                      node.active
                        ? stateBadge(node.online ? 'online' : 'offline')
                        : `<span class="pill missing">${escapeHtml(tr('common.off'))}</span>`
                    }</td>
                    <td class="mono small">${node.bots}</td>
                    <td style="text-align:right"><a class="btn btn-sm" href="#/admin/nodes">${escapeHtml(
                      tr('common.open')
                    )}</a></td>
                  </tr>`
                )
              )
            )
          : ''
      }

      ${panel(
        `${bots.length} ${tr('adm.bots')}`,
        table(
          [tr('ov.col.account'), tr('adm.servers'), tr('adm.users'), tr('ops.node'), tr('common.status'), tr('ops.uptime'), ''],
          bots.map(
            (bot) => `<tr>
              <td><span class="strong">${escapeHtml(bot.account)}</span>
                ${bot.build ? `<span class="small muted"> · ${escapeHtml(bot.build)}</span>` : ''}</td>
              <td class="small"><a href="#/admin/servers/${bot.profile_id}">${escapeHtml(bot.profile)}</a>
                <span class="muted mono"> ${escapeHtml(bot.port ? `${bot.host}:${bot.port}` : bot.host)}</span></td>
              <td class="small"><a href="#/admin/users/${bot.user_id}">${escapeHtml(bot.display_name || `#${bot.user_id}`)}</a></td>
              <td class="small muted">${escapeHtml(bot.node || tr('ops.here'))}</td>
              <td>${stateBadge(bot.state, bot.detail || '')}
                ${bot.last_error ? `<span class="small muted">${escapeHtml(bot.last_error)}</span>` : ''}</td>
              <td class="mono small muted">${bot.uptime ? uptime(Math.round(bot.uptime / 1000)) : '–'}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn-sm" data-restart="${bot.profile_id}">${icon('refresh')}</button>
                <button class="btn btn-sm btn-danger" data-stop="${bot.profile_id}"
                  data-account="${bot.account_id}">${icon('stop')}</button>
              </td>
            </tr>`
          )
        ),
        `<label class="check small"><input type="checkbox" id="only-running" ${onlyRunning ? 'checked' : ''}>
          <span>${escapeHtml(tr('ops.onlyRunning'))}</span></label>`
      )}

      ${panel(
        tr('ops.jobs'),
        table(
          [tr('common.name'), tr('ops.every'), tr('ops.last'), tr('ops.took'), ''],
          jobs.map(
            (job) => `<tr>
              <td>${escapeHtml(job.label[lang] || job.label.de || job.key)}
                <span class="small muted mono"> ${escapeHtml(job.key)}</span>
                ${job.last_error ? `<div class="small bad">${escapeHtml(job.last_error)}</div>` : ''}</td>
              <td class="small muted">${escapeHtml(interval(job.interval_ms))}</td>
              <td class="small muted">${job.last_at ? since(job.last_at) : tr('ops.never')}</td>
              <td class="mono small muted">${job.last_ms === null ? '–' : `${job.last_ms} ms`}</td>
              <td style="text-align:right">
                ${
                  job.manual
                    ? `<button class="btn btn-sm" data-job="${escapeHtml(job.key)}" ${job.running ? 'disabled' : ''}>
                        ${escapeHtml(tr('ops.runNow'))}</button>`
                    : ''
                }
              </td>
            </tr>`
          )
        )
      )}`;

    $('#only-running').addEventListener('change', async (event) => {
      onlyRunning = event.target.checked;
      const [bots, jobState, operationState] = await Promise.all([api('/admin/bots'), api('/admin/jobs'), api('/admin/operations')]);
      paint(bots, jobState.jobs, operationState);
    });
    $$('[data-stop]').forEach((button) =>
      button.addEventListener('click', async () => {
        if (
          await send(`/admin/bots/${button.dataset.stop}/${button.dataset.account}/stop`, { method: 'POST' }, { done: false })
        ) {
          load();
        }
      })
    );
    $$('[data-restart]').forEach((button) =>
      button.addEventListener('click', async () => {
        if (await send(`/admin/servers/${button.dataset.restart}/restart`, { method: 'POST' }, { done: false })) load();
      })
    );
    $$('[data-job]').forEach((button) =>
      button.addEventListener('click', async () => {
        button.disabled = true;
        const answer = await send(`/admin/jobs/${button.dataset.job}/run`, { method: 'POST' }, { done: false });
        // Ehrlich melden, was daraus wurde: Eine Aufgabe, die mit einem Fehler endet, hat nicht
        // "geklappt", auch wenn der Aufruf durchging.
        if (answer && answer.job) {
          if (answer.job.last_error) toast(answer.job.last_error, 'bad');
          else ok(tr('ops.ranIn', { ms: answer.job.last_ms }));
          const [bots, operationState] = await Promise.all([api('/admin/bots'), api('/admin/operations')]);
          paint(bots, answer.jobs, operationState);
        } else button.disabled = false;
      })
    );
  };

  const load = async () => {
    if (!root.isConnected) return clearInterval(timer);
    try {
      const [bots, jobs, operations] = await Promise.all([api('/admin/bots'), api('/admin/jobs'), api('/admin/operations')]);
      // Steht ein Dialog offen, wäre ein Neuzeichnen ein Griff unter der Hand weg.
      if (!root.isConnected || document.querySelector('dialog[open]')) return;
      paint(bots, jobs.jobs, operations);
    } catch {
      /* beim nächsten Mal wieder */
    }
  };

  await load();
  timer = setInterval(load, 5000);
}

/** Texte bleiben hier, weil die API nur Zustände und keine bereits gerenderten Operator-Sätze liefert. */
function operationAlertText(alert) {
  const names = { 'node-offline': 'ops.alert.nodeOffline', 'node-full': 'ops.alert.nodeFull', 'client-error': 'ops.alert.clientError', 'client-outdated': 'ops.alert.clientOutdated', 'job-failed': 'ops.alert.jobFailed', 'proxy-unused': 'ops.alert.proxyUnused' };
  return tr(names[alert.kind] || 'ops.attention', { name: alert.name || '', n: alert.count || 0 });
}
function operationAlertHint(alert) {
  const hints = { 'node-offline': 'ops.alert.nodeHint', 'node-full': 'ops.alert.nodeFullHint', 'client-error': 'ops.alert.clientHint', 'client-outdated': 'ops.alert.clientOutdatedHint', 'job-failed': 'ops.alert.jobHint', 'proxy-unused': 'ops.alert.proxyHint' };
  return tr(hints[alert.kind] || 'common.open');
}

/** Ein Takt, wie ihn ein Mensch liest: „alle 30 s“, „stündlich“. */
function interval(ms) {
  if (ms >= 3_600_000) return tr('ops.hours', { n: Math.round(ms / 3_600_000) });
  if (ms >= 60_000) return tr('ops.minutes', { n: Math.round(ms / 60_000) });
  return tr('ops.seconds', { n: Math.round(ms / 1000) });
}

// ---------------------------------------------------------------- Textbausteine
//
// Support besteht zu einem guten Teil aus denselben vier Sätzen. Wer sie jedes Mal neu tippt,
// tippt sie jedes Mal ein bisschen anders – mal freundlich, mal knapp, je nach Tageszeit. Ein
// Baustein ist deshalb nicht nur schneller, er ist auch der Grund, warum zwei Kunden dieselbe
// Antwort bekommen.
//
// Der Zähler daneben ist die einzige ehrliche Auskunft darüber, welcher Baustein seinen Platz
// verdient: Einer, den in einem halben Jahr niemand benutzt hat, ist kein Baustein, sondern eine
// Zeile, die beim Suchen im Weg steht.

const TEMPLATE_FIELDS = [
  { key: 'title_de', label: 'tmpl.titleDe', required: true },
  { key: 'title_en', label: 'tmpl.titleEn', required: true },
  { key: 'body_de', label: 'tmpl.bodyDe', type: 'textarea', required: true },
  { key: 'body_en', label: 'tmpl.bodyEn', type: 'textarea', required: true },
  { key: 'category', label: 'tk.category' },
  { key: 'sort', label: 'common.order', type: 'number' },
];

async function templates(root) {
  const data = await api('/admin/ticket-templates');

  root.innerHTML = `
    <div class="row wrap spread" style="margin-bottom:1rem;gap:1rem">
      <p class="small muted" style="margin:0;max-width:46rem">${escapeHtml(tr('tmpl.lead'))}</p>
      <button class="btn btn-primary btn-sm" id="new">${icon('plus')} ${escapeHtml(tr('common.create'))}</button>
    </div>

    ${panel(
      `${data.templates.length} ${tr('adm.templates')}`,
      table(
        [tr('common.name'), tr('tmpl.category'), tr('tmpl.uses'), ''],
        data.templates.map(
          (entry) => `<tr>
            <td><span class="strong">${escapeHtml(bilingual(entry, 'title'))}</span>
              <div class="small muted truncate" style="max-width:38rem">${escapeHtml(
                bilingual(entry, 'body').replace(/\s+/g, ' ')
              )}</div></td>
            <td class="small muted">${escapeHtml(entry.category)}</td>
            <td class="mono small muted">${entry.uses}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-sm" data-edit="${entry.id}">${escapeHtml(tr('common.edit'))}</button>
              <button class="btn btn-ghost btn-sm btn-danger" data-del="${entry.id}">${icon('trash')}</button>
            </td>
          </tr>`
        )
      )
    )}`;

  const form = async (entry = {}) => {
    const answer = await formDialog(
      entry.id ? tr('common.edit') : tr('common.create'),
      TEMPLATE_FIELDS.map((field) => ({
        key: field.key,
        label: tr(field.label),
        type: field.type,
        required: field.required,
        value: entry[field.key] ?? (field.key === 'category' ? 'general' : ''),
        hint: field.key === 'body_de' ? tr('tmpl.placeholders') : '',
      })),
      { submit: tr('common.save') }
    );
    if (!answer) return;
    const path = entry.id ? `/admin/ticket-templates/${entry.id}` : '/admin/ticket-templates';
    if (await send(path, { method: entry.id ? 'PATCH' : 'POST', body: numbers(answer) })) draw();
  };

  $('#new').addEventListener('click', () => form());
  $$('[data-edit]').forEach((button) =>
    button.addEventListener('click', () =>
      form(data.templates.find((entry) => entry.id === Number(button.dataset.edit)))
    )
  );
  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('common.delete'), { confirm: tr('common.delete') }))) return;
      if (await send(`/admin/ticket-templates/${button.dataset.del}`, { method: 'DELETE' })) draw();
    })
  );
}

/**
 * Eine Rundmail an einen ausgewählten Kreis.
 *
 * Eine Nachricht an **alle** ist selten die gemeinte. Wer nicht auswählen kann, schreibt entweder
 * allen – und wird zu der Nachricht, die man ungelesen wegklickt – oder niemandem. Neben jedem
 * Kreis steht deshalb die Zahl der Empfänger, bevor irgendetwas hinausgeht.
 */
async function broadcastPanel(root) {
  const data = await api('/admin/broadcast');
  root.innerHTML = panel(
    tr('bc.title'),
    `<div class="body stack">
      <p class="small muted">${escapeHtml(tr('bc.lead'))}</p>
      <div class="field">
        <label for="bc-segment">${escapeHtml(tr('bc.segment'))}</label>
        <select id="bc-segment">
          ${data.segments
            .map(
              (segment) =>
                `<option value="${escapeHtml(segment.key)}">${escapeHtml(segment.label)} · ${segment.count}</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="row wrap">
        <button class="btn btn-sm" id="bc-test" ${data.configured ? '' : 'disabled'}>
          ${escapeHtml(tr('adm.announceTest'))}</button>
        <button class="btn btn-sm btn-primary" id="bc-send" ${data.configured ? '' : 'disabled'}>
          ${icon('send')} ${escapeHtml(tr('bc.send'))}</button>
      </div>
      ${data.configured ? '' : `<p class="small muted">${escapeHtml(tr('adm.noMail'))}</p>`}
    </div>`
  );

  const compose = async () => {
    const answer = await formDialog(
      tr('bc.title'),
      [
        { key: 'title_de', label: tr('tmpl.titleDe'), required: true },
        { key: 'body_de', label: tr('tmpl.bodyDe'), type: 'textarea', required: true },
        { key: 'title_en', label: tr('tmpl.titleEn') },
        { key: 'body_en', label: tr('tmpl.bodyEn'), type: 'textarea' },
        { key: 'link', label: tr('adm.announceLink'), placeholder: 'https://' },
      ],
      { submit: tr('common.next'), note: tr('bc.bothLangs') }
    );
    return answer;
  };

  $('#bc-test').addEventListener('click', async () => {
    const answer = await compose();
    if (!answer) return;
    const result = await send('/admin/broadcast', { method: 'POST', body: { ...answer, test: true } }, { done: false });
    if (result) ok(tr('bc.tested'));
  });

  $('#bc-send').addEventListener('click', async () => {
    const segment = $('#bc-segment');
    const label = segment.options[segment.selectedIndex].textContent;
    const answer = await compose();
    if (!answer) return;
    // Erst schreiben, dann fragen: Die Rückfrage nennt den Kreis und die Zahl, und sie kommt an
    // der Stelle, an der man sie ernst nimmt – kurz vorm Abschicken.
    if (!(await confirmDialog(tr('bc.ask', { who: label.trim() }), { confirm: tr('bc.send') }))) return;
    const result = await send(
      '/admin/broadcast',
      { method: 'POST', body: { ...answer, segment: segment.value } },
      { done: false }
    );
    if (result) ok(tr('bc.done', { sent: result.sent, skipped: result.skipped }));
  });
}
