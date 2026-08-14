// Minecraft-Konten: verbinden (Microsoft-Gerätecode), auffrischen, entfernen.

import { api, icon, escapeHtml, datetime, $, $$, ok, fail, confirmDialog, copy } from '../ui.js';
import { state, appbar, refresh, draw } from '../app.js';

export async function render(root) {
  await refresh({ profiles: false, me: false });

  const cards = state.accounts
    .map((account) => {
      const used = state.profiles.filter((profile) =>
        profile.accounts.some((member) => member.account_id === account.id)
      );
      const broken = account.status === 'error';
      return `<article class="card">
        <div class="row spread" style="align-items:flex-start">
          <div class="row">
            <img class="head lg" src="${escapeHtml(account.head)}" alt="" loading="lazy">
            <div>
              <div class="strong">${escapeHtml(account.name)}</div>
              <div class="small muted">${account.kind === 'microsoft' ? 'Microsoft/Java' : escapeHtml(account.kind)}
                · ${account.connections} Verbindung(en)</div>
            </div>
          </div>
          ${broken ? '<span class="pill missing">Anmeldung nötig</span>' : '<span class="pill primary">bereit</span>'}
        </div>

        ${broken ? `<p class="small" style="margin-top:.75rem;color:var(--bad)">${escapeHtml(account.last_error || '')}</p>` : ''}

        <div class="small muted" style="margin-top:.9rem">
          ${used.length ? `In ${used.length} Profil(en): ${used.map((profile) => escapeHtml(profile.name)).join(', ')}` : 'Noch keinem Serverprofil zugeordnet.'}
        </div>
        <div class="small muted">Verbunden am ${datetime(account.created_at)}</div>

        <div class="row" style="margin-top:1rem">
          <button class="btn btn-sm" data-relogin="${account.id}">${icon('refresh')} Neu anmelden</button>
          <button class="btn btn-sm btn-danger" data-remove="${account.id}">${icon('trash')} Entfernen</button>
        </div>
      </article>`;
    })
    .join('');

  root.innerHTML = `
    ${appbar('Minecraft-Konten', `
      <button class="btn btn-primary btn-sm" id="add">${icon('plus')} Konto verbinden</button>`,
      'Die Konten, die deine Bots benutzen')}

    <div class="note" style="margin-bottom:1.5rem">${icon('shield')}
      <div>Die Anmeldung läuft über den Gerätecode von Microsoft: Du bekommst einen Code, gibst ihn bei
      Microsoft ein und bestätigst dort. <strong>Dein Passwort wird nie an dieses Panel übertragen.</strong>
      Gespeichert wird nur der Token, den der Client zum Beitreten braucht.</div></div>

    ${
      state.accounts.length
        ? `<div class="grid two">${cards}</div>`
        : `<div class="empty">
            <h3>Noch kein Konto verbunden</h3>
            <p>Verbinde dein erstes Minecraft-Konto. Ohne Konto kann kein Bot einem Server beitreten.</p>
            <button class="btn btn-primary" id="add-2">${icon('plus')} Konto verbinden</button>
          </div>`
    }

    <section class="panel" style="margin-top:1.5rem">
      <header><h3>Andere Kontoarten</h3></header>
      <div class="body stack">
        <div class="row spread">
          <div><div class="strong small">Offline / Cracked</div>
            <div class="small muted">Der Client meldet sich immer bei Microsoft an – einen Offline-Modus gibt es nicht.</div></div>
          <span class="pill missing">nicht möglich</span>
        </div>
        <div class="row spread">
          <div><div class="strong small">Bedrock</div>
            <div class="small muted">Der Client spricht nur das Java-Protokoll.</div></div>
          <span class="pill missing">nicht möglich</span>
        </div>
      </div>
    </section>`;

  for (const id of ['#add', '#add-2']) $(id)?.addEventListener('click', startLogin);
  $$('[data-relogin]').forEach((button) => button.addEventListener('click', startLogin));

  $$('[data-remove]').forEach((button) =>
    button.addEventListener('click', async () => {
      const account = state.accounts.find((entry) => entry.id === Number(button.dataset.remove));
      const sure = await confirmDialog(
        `Konto "${account.name}" entfernen? Laufende Bots damit werden gestoppt und die Anmeldung auf dem Server gelöscht.`,
        { confirm: 'Entfernen' }
      );
      if (!sure) return;
      try {
        await api(`/accounts/${account.id}`, { method: 'DELETE' });
        ok('Konto entfernt.');
        await refresh();
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );
}

/**
 * Der Gerätecode-Ablauf: Panel startet `afk --login`, zeigt Code und Adresse, fragt im Sekundentakt
 * nach dem Ergebnis. Beendet der Nutzer den Dialog, wird der Vorgang abgebrochen.
 */
async function startLogin() {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <header><h3>Minecraft-Konto verbinden</h3></header>
    <div class="body" id="login-body">
      <p class="muted">Anmeldung wird vorbereitet …</p>
    </div>
    <footer><button class="btn" id="login-close">Abbrechen</button></footer>`;
  document.body.append(dialog);
  dialog.showModal();

  let session = null;
  let timer = null;
  let done = false;

  const stop = () => {
    clearInterval(timer);
    if (session && !done) api(`/accounts/login/${session.id}`, { method: 'DELETE' }).catch(() => {});
  };
  dialog.addEventListener('close', () => {
    stop();
    dialog.remove();
  });
  $('#login-close', dialog).addEventListener('click', () => dialog.close());

  try {
    session = await api('/accounts/login', { method: 'POST' });
  } catch (error) {
    $('#login-body', dialog).innerHTML = `<p style="color:var(--bad)">${escapeHtml(error.message)}</p>`;
    return;
  }

  const paint = (data) => {
    const body = $('#login-body', dialog);
    if (data.status === 'code') {
      body.innerHTML = `
        <div class="stack" style="gap:1.25rem">
          <div class="note">${icon('info')}<div>Erst den Code kopieren, dann die Microsoft-Seite öffnen und
            dort einfügen. Das Fenster hier bleibt offen, bis es fertig ist.</div></div>
          <div class="field">
            <label>Dein Code</label>
            <div class="row">
              <div class="mono strong" style="flex:1;font-size:1.6rem;letter-spacing:.12em;
                padding:.6rem .9rem;border-radius:.75rem;background:var(--surface);
                box-shadow:inset 0 0 0 1px var(--line)">${escapeHtml(data.user_code)}</div>
              <button class="btn" id="copy-code">${icon('copy')} Kopieren</button>
            </div>
          </div>
          <a class="btn btn-primary btn-block" href="${escapeHtml(data.verification_uri)}" target="_blank" rel="noopener">
            Microsoft-Seite öffnen ${icon('arrow')}</a>
          <p class="small muted row" style="gap:.5rem">${icon('clock')} Warte auf die Bestätigung …</p>
        </div>`;
      $('#copy-code', dialog)?.addEventListener('click', () => copy(data.user_code));
      return;
    }
    if (data.status === 'done') {
      done = true;
      body.innerHTML = `<div class="stack center" style="gap:1rem;padding:1rem 0">
        <div style="color:var(--ok)">${icon('check', 'icon')}</div>
        <h3>${escapeHtml(data.account.name)} ist verbunden</h3>
        <p class="muted small">Du kannst das Konto jetzt einem Serverprofil zuordnen und starten.</p></div>`;
      $('#login-close', dialog).textContent = 'Fertig';
      $('#login-close', dialog).classList.add('btn-primary');
      return;
    }
    if (data.status === 'error') {
      body.innerHTML = `<div class="note bad">${icon('alert')}<div>${escapeHtml(data.error || 'Anmeldung fehlgeschlagen.')}</div></div>`;
      return;
    }
    body.innerHTML = `<p class="muted row" style="gap:.5rem">${icon('clock')} Der Client fordert gerade einen Code an …</p>`;
  };

  paint(session);
  timer = setInterval(async () => {
    try {
      const data = await api(`/accounts/login/${session.id}`);
      paint(data);
      if (data.status === 'done') {
        clearInterval(timer);
        ok(`Konto ${data.account.name} verbunden.`);
        await refresh();
        if (state.route.name === 'konten') draw();
      }
      if (data.status === 'error') clearInterval(timer);
    } catch (error) {
      clearInterval(timer);
      $('#login-body', dialog).innerHTML = `<div class="note bad">${icon('alert')}<div>${escapeHtml(error.message)}</div></div>`;
    }
  }, 2000);
}
