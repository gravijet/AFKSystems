// Eigene Einstellungen: Aussehen, Chatverlauf, Discord-Benachrichtigungen, Passwort.

import { api, icon, escapeHtml, $, ok, fail, confirmDialog } from '../ui.js';
import { state, appbar, refresh, draw } from '../app.js';

export async function render(root) {
  const me = state.me;

  root.innerHTML = `
    ${appbar('Einstellungen', '', 'Gilt für dein Konto in diesem Panel')}

    <div class="grid two" style="align-items:start">
      <section class="panel">
        <header><h3>Anzeige</h3></header>
        <div class="body stack">
          <div class="field">
            <label for="chat_limit">Chatverlauf je Bot</label>
            <input id="chat_limit" type="number" min="20" max="1000" value="${me.chat_limit}">
            <span class="hint">So viele Zeilen hält der Server je Bot vor. Mehr heißt mehr Arbeitsspeicher.</span>
          </div>
          <div class="field">
            <label>Aussehen</label>
            <p class="small muted">Hell, dunkel oder wie das System – umzustellen unten links in der Seitenleiste.
              Die Wahl liegt in diesem Browser.</p>
          </div>
          <button class="btn btn-primary" id="save-display">Speichern</button>
        </div>
      </section>

      <section class="panel">
        <header><h3>Discord-Benachrichtigungen</h3></header>
        <div class="body stack">
          <p class="small muted">Trage einen Webhook deines Discord-Servers ein, dann meldet sich das Panel bei
            Verbindungsabbrüchen, Kontoproblemen und knappem Guthaben. Höchstens eine Nachricht je Thema alle
            zehn Minuten.</p>
          <div class="field">
            <label for="webhook">Webhook-Adresse</label>
            <input id="webhook" type="url" placeholder="https://discord.com/api/webhooks/…"
              value="${escapeHtml(me.discord_webhook || '')}">
          </div>
          <div class="row">
            <button class="btn btn-primary" id="save-hook">Speichern</button>
            <button class="btn" id="test-hook" ${me.discord_webhook ? '' : 'disabled'}>Testnachricht</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <header><h3>Passwort ändern</h3></header>
        <div class="body stack">
          <div class="field"><label for="old">Aktuelles Passwort</label>
            <input id="old" type="password" autocomplete="current-password"></div>
          <div class="field"><label for="new">Neues Passwort</label>
            <input id="new" type="password" autocomplete="new-password" minlength="8">
            <span class="hint">Mindestens 8 Zeichen. Andere Sitzungen werden abgemeldet.</span></div>
          <button class="btn btn-primary" id="save-password">Passwort ändern</button>
        </div>
      </section>

      <section class="panel">
        <header><h3>Konto</h3></header>
        <div class="body stack">
          <div class="row spread"><span class="muted small">Benutzername</span>
            <span class="mono">${escapeHtml(me.username)}</span></div>
          <div class="row spread"><span class="muted small">E-Mail</span>
            <span class="mono">${escapeHtml(me.email)}</span></div>
          <div class="row spread"><span class="muted small">Rolle</span>
            <span class="pill ${me.role === 'admin' ? 'primary' : ''}">${me.role === 'admin' ? 'Administrator' : 'Nutzer'}</span></div>
          <div class="row spread"><span class="muted small">Tarif</span>
            <span class="mono">${me.rate_mcr_hour} mcr je Bot und Stunde</span></div>
          <button class="btn" id="logout-all">Auf allen Geräten abmelden</button>
        </div>
      </section>
    </div>`;

  $('#save-display').addEventListener('click', async () => {
    try {
      await api('/me', { method: 'PATCH', body: { chat_limit: Number($('#chat_limit').value) } });
      await refresh({ profiles: false, accounts: false });
      ok('Gespeichert.');
    } catch (error) {
      fail(error);
    }
  });

  $('#save-hook').addEventListener('click', async () => {
    try {
      await api('/me', { method: 'PATCH', body: { discord_webhook: $('#webhook').value } });
      await refresh({ profiles: false, accounts: false });
      ok('Gespeichert.');
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $('#test-hook').addEventListener('click', async () => {
    // Der Server schickt die Nachricht – der Browser darf den Webhook nicht direkt ansprechen.
    try {
      await api('/me/discord-test', { method: 'POST' });
      ok('Testnachricht raus. Schau in deinen Discord-Kanal.');
    } catch (error) {
      fail(error);
    }
  });

  $('#save-password').addEventListener('click', async () => {
    try {
      await api('/me/password', {
        method: 'POST',
        body: { old_password: $('#old').value, new_password: $('#new').value },
      });
      $('#old').value = '';
      $('#new').value = '';
      ok('Passwort geändert.');
    } catch (error) {
      fail(error);
    }
  });

  $('#logout-all').addEventListener('click', async () => {
    if (!(await confirmDialog('Auf allen Geräten abmelden? Du musst dich danach neu anmelden.'))) return;
    await api('/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  });
}
