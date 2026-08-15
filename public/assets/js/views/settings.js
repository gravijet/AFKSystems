// Eigenes Konto: Sprache, Discord, Benachrichtigungen, Passwort, Sitzungen.

import { api, icon, escapeHtml, datetime, tr, url, $, ok, fail, confirmDialog } from '../ui.js';
import { state, appbar, refresh, draw } from '../app.js';

export async function render(root) {
  const me = state.me;
  const sessions = await api('/me/sessions').catch(() => ({ sessions: [] }));
  const discord = state.meta?.discord || {};
  const flash = new URLSearchParams(location.hash.split('?')[1] || '').get('discord');

  root.innerHTML = `
    ${appbar(tr('set.title'), '', tr('set.sub'))}

    ${
      flash
        ? `<div class="note ${flash === 'ok' ? '' : 'bad'}" style="margin-bottom:1.25rem">${icon(
            flash === 'ok' ? 'check' : 'alert'
          )}<div>${escapeHtml(flash === 'ok' ? tr('adm.saved') : flash)}</div></div>`
        : ''
    }

    <div class="grid two" style="align-items:start">
      <section class="panel">
        <header><h3>${escapeHtml(tr('set.account'))}</h3></header>
        <div class="body stack">
          <div class="row spread"><span class="muted small">${escapeHtml(tr('auth.register.username'))}</span>
            <span class="mono">${escapeHtml(me.username)}</span></div>
          <div class="row spread"><span class="muted small">${escapeHtml(tr('auth.register.email'))}</span>
            <span class="mono">${escapeHtml(me.email)}</span></div>
          <div class="row spread"><span class="muted small">${escapeHtml(tr('set.role'))}</span>
            <span class="pill ${me.role === 'admin' ? 'primary' : ''}">${escapeHtml(
              tr(me.role === 'admin' ? 'set.role.admin' : 'set.role.user')
            )}</span></div>
          <div class="field">
            <label for="language">${escapeHtml(tr('set.language'))}</label>
            <select id="language">
              <option value="en" ${me.language === 'en' ? 'selected' : ''}>English</option>
              <option value="de" ${me.language === 'de' ? 'selected' : ''}>Deutsch</option>
            </select>
            <span class="hint">${escapeHtml(tr('set.languageHint'))}</span>
          </div>
          <button class="btn btn-primary" id="save-language">${escapeHtml(tr('common.save'))}</button>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('set.discord'))}</h3></header>
        <div class="body stack">
          ${
            !discord.available
              ? `<p class="small muted">${escapeHtml(tr('set.discordOff'))}</p>`
              : me.discord
                ? `<div class="row spread">
                     <span class="row">${icon('message')} ${escapeHtml(
                       tr('set.discordLinked', { name: me.discord.name })
                     )}</span>
                     <button class="btn btn-sm btn-danger" id="unlink">${escapeHtml(tr('set.discordUnlink'))}</button>
                   </div>`
                : `<a class="btn" href="/api/auth/discord/start?mode=link">${icon('message')} ${escapeHtml(
                    tr('set.discordLink')
                  )}</a>`
          }

          <hr class="rule">

          <p class="small muted">${escapeHtml(tr('set.webhookHint'))}</p>
          <div class="field">
            <label for="webhook">${escapeHtml(tr('set.webhook'))}</label>
            <input id="webhook" type="url" placeholder="https://discord.com/api/webhooks/…"
              value="${escapeHtml(me.discord_webhook || '')}">
          </div>
          <div class="row">
            <button class="btn btn-primary" id="save-hook">${escapeHtml(tr('common.save'))}</button>
            <button class="btn" id="test-hook" ${me.discord_webhook ? '' : 'disabled'}>${escapeHtml(
              tr('set.webhookTest')
            )}</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('set.password'))}</h3></header>
        <div class="body stack">
          <div class="field"><label for="old">${escapeHtml(tr('set.passwordOld'))}</label>
            <input id="old" type="password" autocomplete="current-password"></div>
          <div class="field"><label for="new">${escapeHtml(tr('set.passwordNew'))}</label>
            <input id="new" type="password" autocomplete="new-password" minlength="8"></div>
          <div class="field"><label for="new2">${escapeHtml(tr('set.passwordNew2'))}</label>
            <input id="new2" type="password" autocomplete="new-password" minlength="8">
            <span class="hint">${escapeHtml(tr('set.passwordHint'))}</span></div>
          <button class="btn btn-primary" id="save-password">${escapeHtml(tr('set.password'))}</button>
        </div>
      </section>

      <section class="panel">
        <header><h3>${escapeHtml(tr('set.sessions'))}</h3></header>
        <div class="body stack">
          ${
            (sessions.sessions || [])
              .map(
                (session) => `<div class="row spread small">
                  <span class="mono truncate" title="${escapeHtml(session.agent || '')}">${escapeHtml(
                    session.ip || '–'
                  )}</span>
                  <span class="muted mono">${datetime(session.created_at)}</span>
                </div>`
              )
              .join('') || `<p class="small muted">${escapeHtml(tr('common.none'))}</p>`
          }
          <button class="btn" id="logout-all">${escapeHtml(tr('set.logoutAll'))}</button>
        </div>
      </section>
    </div>`;

  $('#save-language').addEventListener('click', async () => {
    const next = $('#language').value;
    try {
      await api('/me', { method: 'PATCH', body: { language: next } });
      // Die Sprache steckt in der Adresse – also gleich dorthin wechseln.
      location.href = `/${next}/app${location.hash}`;
    } catch (error) {
      fail(error);
    }
  });

  $('#unlink')?.addEventListener('click', async () => {
    if (!(await confirmDialog(tr('set.discordUnlink')))) return;
    try {
      await api('/auth/discord', { method: 'DELETE' });
      await refresh({ profiles: false, accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $('#save-hook').addEventListener('click', async () => {
    try {
      await api('/me', { method: 'PATCH', body: { discord_webhook: $('#webhook').value } });
      await refresh({ profiles: false, accounts: false });
      ok(tr('srv.saved'));
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $('#test-hook').addEventListener('click', async () => {
    // Der Server schickt die Nachricht – der Browser darf den Webhook nicht direkt ansprechen.
    try {
      await api('/me/discord-test', { method: 'POST' });
      ok(tr('srv.saved'));
    } catch (error) {
      fail(error);
    }
  });

  $('#save-password').addEventListener('click', async () => {
    try {
      await api('/me/password', {
        method: 'POST',
        body: {
          old_password: $('#old').value,
          new_password: $('#new').value,
          new_password2: $('#new2').value,
        },
      });
      for (const id of ['#old', '#new', '#new2']) $(id).value = '';
      ok(tr('set.passwordOk'));
    } catch (error) {
      fail(error);
    }
  });

  $('#logout-all').addEventListener('click', async () => {
    if (!(await confirmDialog(tr('set.logoutAllAsk')))) return;
    await api('/auth/logout', { method: 'POST' });
    location.href = url('/login');
  });
}
