// Übersicht: was läuft, was kostet es, wo hakt es.

import { icon, escapeHtml, credits, since, stateBadge, $, $$, fail, ok, api, debounce } from '../ui.js';
import { state, appbar, refresh, drawSide, draw } from '../app.js';

export async function render(root) {
  const bots = [...state.bots.values()].filter((bot) => bot.state && bot.state !== 'offline');
  const online = bots.filter((bot) => bot.online).length;
  const rate = state.me.rate_mcr_hour * Math.max(bots.length, 1);
  const hours = state.me.credits_mcr / rate;
  const broken = state.accounts.filter((account) => account.status === 'error');

  root.innerHTML = `
    ${appbar(`Hallo, ${state.me.username}`, `
      <a class="btn btn-sm" href="#/konten">${icon('plus')} Konto verbinden</a>
      <button class="btn btn-primary btn-sm" id="new-profile-2">${icon('server')} Serverprofil</button>`,
      'Alles Wichtige auf einen Blick')}

    ${
      state.me.credits_mcr <= 0
        ? `<div class="note bad" style="margin-bottom:1.25rem">${icon('alert')}
            <div><strong>Kein Guthaben.</strong> Bots lassen sich erst wieder starten, wenn du aufgeladen hast.
            <a href="#/guthaben" style="color:var(--primary)">Zum Guthaben</a></div></div>`
        : hours < 24 && bots.length
          ? `<div class="note warn" style="margin-bottom:1.25rem">${icon('alert')}
              <div><strong>Guthaben wird knapp.</strong> Bei ${bots.length} laufenden Bot(s) reicht es noch etwa
              ${hours.toFixed(1)} Stunden. <a href="#/guthaben" style="color:var(--primary)">Aufladen</a></div></div>`
          : ''
    }

    ${
      broken.length
        ? `<div class="note warn" style="margin-bottom:1.25rem">${icon('key')}
            <div><strong>${broken.length} Konto/Konten brauchen eine neue Anmeldung:</strong>
            ${broken.map((account) => escapeHtml(account.name)).join(', ')}.
            <a href="#/konten" style="color:var(--primary)">Jetzt erneuern</a></div></div>`
        : ''
    }

    <div class="grid four" style="margin-bottom:1.5rem">
      <div class="stat"><div class="k">Im Spiel</div><div class="v">${online}</div>
        <div class="s">von ${bots.length} laufenden Bots</div></div>
      <div class="stat"><div class="k">Guthaben</div><div class="v">${credits(state.me.credits_mcr)}</div>
        <div class="s">${hours < 48 ? `~${hours.toFixed(1)} h Restlaufzeit` : `~${Math.round(hours / 24)} Tage Restlaufzeit`}</div></div>
      <div class="stat"><div class="k">Verbrauch</div><div class="v">${(rate / 1000).toFixed(3)}</div>
        <div class="s">Credits je Stunde gerade</div></div>
      <div class="stat"><div class="k">Konten</div><div class="v">${state.accounts.length}</div>
        <div class="s">${state.profiles.length} Serverprofil(e)</div></div>
    </div>

    <section class="panel" style="margin-bottom:1.5rem">
      <header>
        <h3>Bots</h3>
        <div class="row">
          <button class="btn btn-sm" id="stop-all" ${bots.length ? '' : 'disabled'}>${icon('stop')} Alle stoppen</button>
        </div>
      </header>
      <div class="body" style="padding:0">
        ${
          state.profiles.length
            ? `<div class="table-wrap"><table class="table">
                <thead><tr>
                  <th>Konto</th><th>Serverprofil</th><th>Zustand</th><th>Läuft seit</th><th></th>
                </tr></thead>
                <tbody>${rows()}</tbody>
              </table></div>`
            : `<div class="empty" style="box-shadow:none;background:transparent">
                <h3>Noch kein Serverprofil</h3>
                <p>Ein Serverprofil ist ein Minecraft-Server samt Einstellungen. Danach ordnest du ihm Konten zu und startest sie.</p>
                <button class="btn btn-primary" id="new-profile-3">${icon('plus')} Serverprofil anlegen</button>
              </div>`
        }
      </div>
    </section>

    <div class="grid two">
      <section class="panel">
        <header><h3>Was der Client hier kann</h3>
          <a class="small" href="#/downloads" style="color:var(--primary)">Downloads</a></header>
        <div class="body stack">
          <div class="row spread"><span class="muted small">Client-Version</span>
            <span class="mono">${escapeHtml(state.meta.client_version || '–')}</span></div>
          <div class="row spread"><span class="muted small">Minecraft-Versionen</span>
            <span class="mono">${state.meta.versions.map(escapeHtml).join(', ')}</span></div>
          <div class="row spread"><span class="muted small">Bewegungs-Bauform</span>
            <span>${state.meta.movement_available ? '<span class="pill primary">vorhanden</span>' : '<span class="pill missing">nicht installiert</span>'}</span></div>
          <div class="row spread"><span class="muted small">Tarif</span>
            <span class="mono">${state.me.rate_mcr_hour} mcr/h je Bot</span></div>
        </div>
      </section>

      <section class="panel">
        <header><h3>Schnellzugriff</h3></header>
        <div class="body stack">
          <a class="row spread" href="#/konten">
            <span class="row">${icon('users')} Minecraft-Konto verbinden</span>${icon('arrow')}</a>
          <a class="row spread" href="#/guthaben">
            <span class="row">${icon('wallet')} Guthaben aufladen</span>${icon('arrow')}</a>
          <a class="row spread" href="#/downloads">
            <span class="row">${icon('download')} Client herunterladen</span>${icon('arrow')}</a>
          <a class="row spread" href="#/einstellungen">
            <span class="row">${icon('settings')} Discord-Benachrichtigungen</span>${icon('arrow')}</a>
        </div>
      </section>
    </div>`;

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
        Diesen Profilen ist noch kein Konto zugeordnet.</td></tr>`;
    }
    // Laufende zuerst.
    list.sort((a, b) => Number(b.bot.online) - Number(a.bot.online));
    return list
      .map(
        ({ profile, member, bot }) => `<tr>
          <td><span class="row"><img class="head" src="${escapeHtml(member.head)}" alt="" loading="lazy">
            ${escapeHtml(member.name)}</span></td>
          <td><a href="#/server/${profile.id}/verbinden" class="row" style="gap:.4rem">
            ${escapeHtml(profile.name)}<span class="small muted mono">${escapeHtml(profile.address)}</span></a></td>
          <td>${stateBadge(bot.state || 'offline', bot.detail || '')}</td>
          <td class="mono small muted">${bot.since && bot.state !== 'offline' ? since(bot.since) : '–'}</td>
          <td style="text-align:right">
            ${
              bot.state && bot.state !== 'offline'
                ? `<button class="btn btn-sm" data-stop="${profile.id}:${member.account_id}">Stoppen</button>`
                : `<button class="btn btn-sm btn-primary" data-start="${profile.id}:${member.account_id}">Starten</button>`
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
        ok('Bot gestartet.');
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
    ok('Alle Bots gestoppt.');
  });

  // Zustandswechsel: neu zeichnen, aber gebündelt – beim Start mehrerer Bots kommen viele
  // Meldungen kurz hintereinander.
  const redraw = debounce(() => {
    if (state.route.name !== 'uebersicht') return;
    refresh({ accounts: false }).then(() => {
      if (state.route.name === 'uebersicht') draw();
    });
  }, 600);
  state.onLive = (event) => {
    if (event.type === 'state' || event.type === 'credits') redraw();
  };
  drawSide();
}
