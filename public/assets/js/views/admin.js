// Administration: Überblick, Nutzer, Guthaben aufbuchen, Gutscheine, Aufladungen, Bots, Client,
// Einstellungen. Nur für Konten mit der Rolle "admin".

import {
  api, icon, escapeHtml, credits, euro, datetime, since, stateBadge,
  $, $$, ok, fail, copy, confirmDialog, formDialog,
} from '../ui.js';
import { state, appbar, draw } from '../app.js';

const TABS = [
  { key: 'uebersicht', label: 'Überblick' },
  { key: 'nutzer', label: 'Nutzer' },
  { key: 'guthaben', label: 'Aufladungen' },
  { key: 'gutscheine', label: 'Gutscheine' },
  { key: 'bots', label: 'Bots' },
  { key: 'system', label: 'System' },
];

export async function render(root, route) {
  if (state.me.role !== 'admin') {
    root.innerHTML = `<div class="empty"><h3>Nur für Administratoren</h3>
      <p>Dieser Bereich ist für dein Konto nicht freigegeben.</p><a class="btn" href="#/">Zur Übersicht</a></div>`;
    return;
  }

  root.innerHTML = `
    ${appbar('Administration', '', 'Betrieb, Nutzer und Geld')}
    <nav class="tabs">${TABS.map(
      (tab) => `<a class="${route.tab === tab.key ? 'active' : ''}" href="#/admin/${tab.key}">${tab.label}</a>`
    ).join('')}</nav>
    <div id="admin-body"><div class="empty"><h3>Wird geladen …</h3></div></div>`;

  const body = $('#admin-body');
  const views = {
    uebersicht: overview,
    nutzer: users,
    guthaben: topups,
    gutscheine: vouchers,
    bots: bots,
    system: system,
  };
  await (views[route.tab] || overview)(body);
}

// ---------------------------------------------------------------- Überblick

async function overview(root) {
  const data = await api('/admin/overview');
  root.innerHTML = `
    <div class="grid four" style="margin-bottom:1.5rem">
      <div class="stat"><div class="k">Nutzer</div><div class="v">${data.users}</div>
        <div class="s">${data.accounts} Minecraft-Konten</div></div>
      <div class="stat"><div class="k">Bots</div><div class="v">${data.bots_running}</div>
        <div class="s">${data.bots_online} davon im Spiel</div></div>
      <div class="stat"><div class="k">Guthaben im Umlauf</div><div class="v">${credits(data.balance_mcr)}</div>
        <div class="s">${euro(data.revenue_cent)} eingenommen</div></div>
      <div class="stat"><div class="k">Verbrauch 24 h</div><div class="v">${credits(data.usage_24h_mcr)}</div>
        <div class="s">Credits abgebucht</div></div>
    </div>

    ${
      data.open_topups
        ? `<div class="note warn" style="margin-bottom:1.5rem">${icon('alert')}
            <div><strong>${data.open_topups} offene Aufladung(en)</strong> warten auf Bestätigung.
            <a href="#/admin/guthaben" style="color:var(--primary)">Ansehen</a></div></div>`
        : ''
    }

    <div class="grid two">
      <section class="panel">
        <header><h3>Client</h3>
          <button class="btn btn-sm" id="sync">${icon('refresh')} Jetzt abgleichen</button></header>
        <div class="body stack">
          <div class="row spread"><span class="muted small">Version</span>
            <span class="mono">${escapeHtml(data.client.version || '–')}</span></div>
          <div class="row spread"><span class="muted small">Release</span>
            <span class="mono">${escapeHtml(data.client.tag || '–')}</span></div>
          <div class="row spread"><span class="muted small">Minecraft-Versionen</span>
            <span class="mono">${data.client.versions.map(escapeHtml).join(', ') || '–'}</span></div>
          <div class="row spread"><span class="muted small">Bewegungs-Bauform</span>
            <span>${data.client.movement ? '<span class="pill primary">vorhanden</span>' : '<span class="pill missing">fehlt</span>'}</span></div>
          <div class="row spread"><span class="muted small">Zuletzt geprüft</span>
            <span class="small">${datetime(data.client.checked)}</span></div>
          ${data.client.error ? `<div class="note bad">${icon('alert')}<div>${escapeHtml(data.client.error)}</div></div>` : ''}
        </div>
      </section>

      <section class="panel">
        <header><h3>Tarif</h3><a class="small" href="#/admin/system" style="color:var(--primary)">Ändern</a></header>
        <div class="body stack">
          <div class="row spread"><span class="muted small">Preis je Bot und Stunde</span>
            <span class="mono">${data.settings.rate_mcr_hour} mcr</span></div>
          <div class="row spread"><span class="muted small">Monat je Bot</span>
            <span class="mono">${((data.settings.rate_mcr_hour * 730) / 1000).toFixed(2)} Credits</span></div>
          <div class="row spread"><span class="muted small">Ein Credit kostet</span>
            <span class="mono">${euro(data.settings.credit_cent)}</span></div>
          <div class="row spread"><span class="muted small">Startguthaben</span>
            <span class="mono">${credits(data.settings.signup_bonus_mcr)} Credits</span></div>
          <div class="row spread"><span class="muted small">Kulanz bei leerem Konto</span>
            <span class="mono">${data.settings.grace_minutes} min</span></div>
        </div>
      </section>
    </div>`;

  $('#sync').addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      await api('/admin/client/sync', { method: 'POST', body: {} });
      ok('Client abgeglichen.');
      draw();
    } catch (error) {
      fail(error);
      event.target.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- Nutzer

async function users(root) {
  const { users: list } = await api('/admin/users');
  root.innerHTML = `
    <section class="panel"><div class="table-wrap"><table class="table">
      <thead><tr>
        <th>Nutzer</th><th>Rolle</th><th style="text-align:right">Guthaben</th><th>Bots</th>
        <th>Konten</th><th>Zuletzt da</th><th></th>
      </tr></thead>
      <tbody>${list
        .map(
          (user) => `<tr>
            <td>
              <div class="strong">${escapeHtml(user.username)}${user.blocked ? ' <span class="pill missing">gesperrt</span>' : ''}</div>
              <div class="small muted">${escapeHtml(user.email)}</div>
            </td>
            <td><span class="pill ${user.role === 'admin' ? 'primary' : ''}">${user.role}</span></td>
            <td class="mono" style="text-align:right">${credits(user.credits_mcr)}</td>
            <td class="mono">${user.bots_running}</td>
            <td class="mono">${user.accounts}/${user.profiles}</td>
            <td class="small muted nowrap">${user.last_seen_at ? datetime(user.last_seen_at) : '–'}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-sm btn-primary" data-credit="${user.id}">Guthaben</button>
              <button class="btn btn-sm" data-edit="${user.id}">Ändern</button>
            </td>
          </tr>`
        )
        .join('')}</tbody>
    </table></div></section>`;

  $$('[data-credit]').forEach((button) =>
    button.addEventListener('click', async () => {
      const user = list.find((entry) => entry.id === Number(button.dataset.credit));
      const form = await formDialog(
        `Guthaben für ${user.username}`,
        [
          {
            key: 'credits',
            label: 'Credits (negativ zum Abziehen)',
            type: 'number',
            value: 10,
            hint: `Aktuell: ${credits(user.credits_mcr)} Credits.`,
          },
          { key: 'note', label: 'Notiz für den Kontoauszug', value: '' },
        ],
        { submit: 'Buchen' }
      );
      if (!form) return;
      try {
        await api(`/admin/users/${user.id}`, {
          method: 'PATCH',
          body: {
            credits_delta_mcr: Math.round(Number(form.credits) * 1000),
            note: form.note || `durch ${state.me.username}`,
          },
        });
        ok('Gebucht.');
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  $$('[data-edit]').forEach((button) =>
    button.addEventListener('click', async () => {
      const user = list.find((entry) => entry.id === Number(button.dataset.edit));
      const form = await formDialog(
        `${user.username} ändern`,
        [
          {
            key: 'role',
            label: 'Rolle',
            type: 'select',
            value: user.role,
            options: [
              { value: 'user', label: 'Nutzer' },
              { value: 'admin', label: 'Administrator' },
            ],
          },
          {
            key: 'rate_mcr_hour',
            label: 'Eigener Tarif (mcr je Bot und Stunde, leer = Standard)',
            type: 'number',
            value: user.rate_mcr_hour ?? '',
          },
          { key: 'blocked', label: 'Konto sperren (stoppt alle Bots)', type: 'checkbox', value: user.blocked },
        ],
        { submit: 'Speichern' }
      );
      if (!form) return;
      try {
        await api(`/admin/users/${user.id}`, {
          method: 'PATCH',
          body: {
            role: form.role,
            blocked: form.blocked,
            rate_mcr_hour: form.rate_mcr_hour === '' ? null : Number(form.rate_mcr_hour),
          },
        });
        ok('Gespeichert.');
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );
}

// ---------------------------------------------------------------- Aufladungen

async function topups(root) {
  const { topups: list } = await api('/admin/topups');
  const open = list.filter((entry) => entry.status === 'open');

  root.innerHTML = `
    ${
      open.length
        ? `<div class="note" style="margin-bottom:1.25rem">${icon('info')}
            <div>Bestätige eine Aufladung erst, wenn das Geld wirklich da ist. Mit dem Klick wird das
            Guthaben sofort gutgeschrieben.</div></div>`
        : ''
    }
    <section class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>Datum</th><th>Nutzer</th><th>Betrag</th><th>Credits</th><th>Weg</th>
        <th>Verwendungszweck</th><th>Status</th><th></th></tr></thead>
      <tbody>${
        list.length
          ? list
              .map(
                (entry) => `<tr>
                  <td class="small muted nowrap">${datetime(entry.created_at)}</td>
                  <td><div class="strong small">${escapeHtml(entry.username)}</div>
                    <div class="small muted">${escapeHtml(entry.email)}</div></td>
                  <td class="mono">${euro(entry.amount_cent)}</td>
                  <td class="mono">${credits(entry.credits_mcr, 0)}</td>
                  <td class="small">${escapeHtml(entry.provider)}</td>
                  <td class="mono small">${escapeHtml(entry.reference || '–')}</td>
                  <td><span class="pill ${entry.status === 'paid' ? 'primary' : entry.status === 'open' ? 'missing' : ''}">
                    ${entry.status === 'paid' ? 'bezahlt' : entry.status === 'open' ? 'offen' : 'storniert'}</span></td>
                  <td style="text-align:right;white-space:nowrap">
                    ${
                      entry.status === 'open'
                        ? `<button class="btn btn-sm btn-primary" data-settle="${entry.id}">Bestätigen</button>
                           <button class="btn btn-sm btn-danger" data-cancel="${entry.id}">Storno</button>`
                        : '–'
                    }
                  </td>
                </tr>`
              )
              .join('')
          : '<tr><td colspan="8" class="muted small" style="padding:1.25rem">Noch keine Aufladungen.</td></tr>'
      }</tbody>
    </table></div></section>`;

  $$('[data-settle]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog('Zahlung ist eingegangen und das Guthaben wird jetzt gutgeschrieben?', {
        confirm: 'Bestätigen',
        danger: false,
      }))) return;
      try {
        await api(`/admin/topups/${button.dataset.settle}/settle`, { method: 'POST' });
        ok('Guthaben gutgeschrieben.');
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  $$('[data-cancel]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api(`/admin/topups/${button.dataset.cancel}/cancel`, { method: 'POST' });
      draw();
    })
  );
}

// ---------------------------------------------------------------- Gutscheine

async function vouchers(root) {
  const { vouchers: list } = await api('/admin/vouchers');
  root.innerHTML = `
    <div class="row spread" style="margin-bottom:1rem">
      <p class="small muted">Gutscheine sind der einfachste Weg, jemandem Guthaben zu geben, ohne sein Konto
        zu kennen – etwa als Gewinn oder Entschädigung.</p>
      <button class="btn btn-primary btn-sm" id="new-voucher">${icon('plus')} Gutscheine erzeugen</button>
    </div>

    <section class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>Code</th><th>Wert</th><th>Übrig</th><th>Notiz</th><th>Erstellt</th><th></th></tr></thead>
      <tbody>${
        list.length
          ? list
              .map(
                (voucher) => `<tr>
                  <td class="mono strong">${escapeHtml(voucher.code)}</td>
                  <td class="mono">${credits(voucher.credits_mcr, 0)}</td>
                  <td class="mono">${voucher.uses_left}</td>
                  <td class="small muted">${escapeHtml(voucher.note || '')}</td>
                  <td class="small muted nowrap">${datetime(voucher.created_at)}</td>
                  <td style="text-align:right;white-space:nowrap">
                    <button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(voucher.code)}">${icon('copy')}</button>
                    <button class="btn btn-ghost btn-sm btn-danger" data-del="${escapeHtml(voucher.code)}">${icon('trash')}</button>
                  </td>
                </tr>`
              )
              .join('')
          : '<tr><td colspan="6" class="muted small" style="padding:1.25rem">Noch keine Gutscheine.</td></tr>'
      }</tbody>
    </table></div></section>`;

  $('#new-voucher').addEventListener('click', async () => {
    const form = await formDialog(
      'Gutscheine erzeugen',
      [
        { key: 'credits', label: 'Wert in Credits', type: 'number', value: 10, min: 1 },
        { key: 'count', label: 'Anzahl Codes', type: 'number', value: 1, min: 1, max: 50 },
        { key: 'uses', label: 'Einlösungen je Code', type: 'number', value: 1, min: 1 },
        { key: 'note', label: 'Notiz', value: '' },
      ],
      { submit: 'Erzeugen' }
    );
    if (!form) return;
    try {
      const result = await api('/admin/vouchers', {
        method: 'POST',
        body: {
          credits_mcr: Math.round(Number(form.credits) * 1000),
          count: Number(form.count),
          uses: Number(form.uses),
          note: form.note,
        },
      });
      await copy(result.vouchers.map((voucher) => voucher.code).join('\n'));
      ok(`${result.vouchers.length} Code(s) erzeugt und in die Zwischenablage gelegt.`);
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $$('[data-copy]').forEach((button) => button.addEventListener('click', () => copy(button.dataset.copy)));
  $$('[data-del]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog('Diesen Gutschein löschen?', { confirm: 'Löschen' }))) return;
      await api(`/admin/vouchers/${button.dataset.del}`, { method: 'DELETE' });
      draw();
    })
  );
}

// ---------------------------------------------------------------- Bots

async function bots(root) {
  const { bots: list } = await api('/admin/bots');
  root.innerHTML = `
    <section class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>Konto</th><th>Profil</th><th>Server</th><th>Version</th><th>Zustand</th>
        <th>Läuft seit</th><th></th></tr></thead>
      <tbody>${
        list.length
          ? list
              .map(
                (bot) => `<tr>
                  <td class="strong">${escapeHtml(bot.account)}</td>
                  <td>${escapeHtml(bot.profile)}</td>
                  <td class="mono small">${escapeHtml(bot.host)}</td>
                  <td class="mono small">${escapeHtml(bot.version)}</td>
                  <td>${stateBadge(bot.state, bot.detail || '')}</td>
                  <td class="mono small muted">${bot.state !== 'offline' ? since(bot.since) : '–'}</td>
                  <td style="text-align:right">
                    ${
                      bot.state !== 'offline'
                        ? `<button class="btn btn-sm btn-danger" data-stop="${bot.profile_id}:${bot.account_id}">Stoppen</button>`
                        : '–'
                    }</td>
                </tr>`
              )
              .join('')
          : '<tr><td colspan="7" class="muted small" style="padding:1.25rem">Gerade läuft kein Bot.</td></tr>'
      }</tbody>
    </table></div></section>`;

  $$('[data-stop]').forEach((button) =>
    button.addEventListener('click', async () => {
      const [profileId, accountId] = button.dataset.stop.split(':');
      await api(`/admin/bots/${profileId}/${accountId}/stop`, { method: 'POST' });
      ok('Gestoppt.');
      draw();
    })
  );
}

// ---------------------------------------------------------------- System

async function system(root) {
  const { settings } = await api('/admin/settings');
  const { entries } = await api('/admin/audit');

  root.innerHTML = `
    <div class="grid two" style="align-items:start">
      <section class="panel">
        <header><h3>Tarif und Guthaben</h3></header>
        <div class="body stack">
          <div class="field"><label for="rate">Preis je Bot und Stunde (mcr)</label>
            <input id="rate" type="number" min="0" max="100000" value="${settings.rate_mcr_hour}">
            <span class="hint">1000 mcr = 1 Credit. Bei ${settings.rate_mcr_hour} mcr kostet ein Bot im Monat
              ${((settings.rate_mcr_hour * 730) / 1000).toFixed(2)} Credits.</span></div>
          <div class="field"><label for="credit_cent">Ein Credit kostet (Cent)</label>
            <input id="credit_cent" type="number" min="1" max="10000" value="${settings.credit_cent}"></div>
          <div class="field"><label for="bonus">Startguthaben (mcr)</label>
            <input id="bonus" type="number" min="0" max="1000000" value="${settings.signup_bonus_mcr}"></div>
          <div class="field"><label for="low">Warnschwelle (mcr)</label>
            <input id="low" type="number" min="0" max="1000000" value="${settings.low_balance_mcr}"></div>
          <div class="field"><label for="grace">Kulanz bei leerem Konto (Minuten)</label>
            <input id="grace" type="number" min="0" max="1440" value="${settings.grace_minutes}"></div>
          <button class="btn btn-primary" id="save">Speichern</button>
        </div>
      </section>

      <section class="panel">
        <header><h3>Aufladepakete</h3></header>
        <div class="body stack">
          <p class="small muted">Ein Paket je Zeile: <span class="mono">Betrag in Euro : Credits</span>.
            Der Unterschied ist der Bonus.</p>
          <textarea id="packages" rows="6" class="mono">${settings.packages
            .map((pack) => `${(pack.cent / 100).toFixed(2)}:${(pack.credits_mcr / 1000).toFixed(2)}`)
            .join('\n')}</textarea>
          <button class="btn btn-primary" id="save-packages">Pakete speichern</button>
        </div>
      </section>
    </div>

    <section class="panel" style="margin-top:1.5rem">
      <header><h3>Letzte Ereignisse</h3></header>
      <div class="body" style="padding:0"><div class="table-wrap"><table class="table">
        <thead><tr><th>Zeitpunkt</th><th>Nutzer</th><th>Was</th><th>Details</th></tr></thead>
        <tbody>${entries
          .slice(0, 60)
          .map(
            (entry) => `<tr>
              <td class="small muted nowrap">${datetime(entry.created_at)}</td>
              <td class="small">${escapeHtml(entry.username || '–')}</td>
              <td class="small mono">${escapeHtml(entry.action)}</td>
              <td class="small muted truncate" style="max-width:26rem">${escapeHtml(entry.detail || '')}</td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div></div>
    </section>`;

  $('#save').addEventListener('click', async () => {
    try {
      await api('/admin/settings', {
        method: 'PATCH',
        body: {
          rate_mcr_hour: Number($('#rate').value),
          credit_cent: Number($('#credit_cent').value),
          signup_bonus_mcr: Number($('#bonus').value),
          low_balance_mcr: Number($('#low').value),
          grace_minutes: Number($('#grace').value),
        },
      });
      ok('Gespeichert.');
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $('#save-packages').addEventListener('click', async () => {
    const packages = [];
    for (const raw of $('#packages').value.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const [euroText, creditText] = line.split(':');
      const cent = Math.round(Number(String(euroText).replace(',', '.')) * 100);
      const creditsMcr = Math.round(Number(String(creditText).replace(',', '.')) * 1000);
      if (!cent || !creditsMcr) return fail(new Error(`Zeile nicht verstanden: "${line}"`));
      packages.push({ cent, credits_mcr: creditsMcr, label: `${(cent / 100).toFixed(2)} €` });
    }
    try {
      await api('/admin/settings', { method: 'PATCH', body: { packages } });
      ok('Pakete gespeichert.');
      draw();
    } catch (error) {
      fail(error);
    }
  });
}
