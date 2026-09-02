// Minecraft-Konten: verbinden (Microsoft-Gerätecode), auffrischen, entfernen.

import { api, icon, escapeHtml, datetime, tr, $, $$, ok, fail, confirmDialog, formDialog } from '../ui.js';
import { state, appbar, refresh, draw } from '../app.js';

export async function render(root) {
  const data = await api('/accounts');
  state.accounts = data.accounts;
  await refresh({ accounts: false, me: false });

  const cards = state.accounts
    .map((account) => {
      const used = state.profiles.filter((profile) =>
        profile.accounts.some((member) => member.account_id === account.id)
      );
      const broken = account.status === 'error';
      const suspended = account.suspended;
      return `<article class="card">
        <div class="row spread" style="align-items:flex-start">
          <div class="row">
            <img class="head lg" src="${escapeHtml(account.head)}" alt="" loading="lazy" decoding="async">
            <div>
              <div class="strong">${escapeHtml(account.name)}</div>
              <div class="small muted">${escapeHtml(
                tr(account.kind === 'offline' ? 'acc.kind.offline' : 'acc.kind.microsoft')
              )} · ${account.connections}×</div>
            </div>
          </div>
          ${
            suspended
              ? `<span class="pill missing">${escapeHtml(tr('acc.suspended'))}</span>`
              : broken
              ? `<span class="pill missing">${escapeHtml(tr('acc.error'))}</span>`
              : `<span class="pill primary">${escapeHtml(tr('acc.ok'))}</span>`
          }
        </div>

        ${
          suspended
            ? `<p class="small" style="margin-top:.75rem;color:var(--warn-text)">${escapeHtml(
                account.suspend_reason || tr('acc.suspendedHint')
              )}</p>`
            : broken
            ? `<p class="small" style="margin-top:.75rem;color:var(--bad-text)">${escapeHtml(account.last_error || '')}</p>`
            : ''
        }

        <div class="small muted" style="margin-top:.9rem">
          ${
            used.length
              ? `${escapeHtml(tr('acc.usedOn', { n: used.length }))}: ${used
                  .map((profile) => escapeHtml(profile.name))
                  .join(', ')}`
              : escapeHtml(tr('common.none'))
          }
        </div>
        <div class="small muted mono">${datetime(account.created_at)}</div>

        <div class="row" style="margin-top:1rem">
          ${
            account.kind === 'offline'
              ? ''
              : `<button class="btn btn-sm" data-relogin="${account.id}" ${suspended ? 'disabled' : ''}>${icon('refresh')} ${escapeHtml(
                  tr('acc.renew')
                )}</button>`
          }
          <button class="btn btn-sm btn-danger" data-remove="${account.id}">${icon('trash')} ${escapeHtml(
            tr('common.delete')
          )}</button>
        </div>
      </article>`;
    })
    .join('');

  root.innerHTML = `
    ${appbar(
      tr('acc.title'),
      `${
        data.offline_allowed
          ? `<button class="btn btn-sm" id="add-offline">${icon('plus')} ${escapeHtml(tr('acc.addOffline'))}</button>`
          : ''
      }
       <button class="btn btn-primary btn-sm" id="add">${icon('plus')} ${escapeHtml(tr('acc.add'))}</button>`,
      tr('acc.sub')
    )}

    <div class="note" style="margin-bottom:1rem">${icon('shield')}
      <div>${escapeHtml(tr('faq.2.a'))}</div></div>

    <div class="note warn" style="margin-bottom:1.5rem">${icon('alert')}
      <div><strong>${escapeHtml(tr('rules.title'))}</strong><br>${escapeHtml(tr('rules.text'))}</div></div>

    ${
      state.accounts.length
        ? `<div class="grid two">${cards}</div>`
        : `<div class="empty">
            <h3>${escapeHtml(tr('acc.none.title'))}</h3>
            <p>${escapeHtml(tr('acc.none.text'))}</p>
            <button class="btn btn-primary" id="add-2">${icon('plus')} ${escapeHtml(tr('acc.add'))}</button>
          </div>`
    }`;

  for (const id of ['#add', '#add-2']) $(id)?.addEventListener('click', startLogin);
  $$('[data-relogin]').forEach((button) => button.addEventListener('click', startLogin));

  $('#add-offline')?.addEventListener('click', async () => {
    const answer = await formDialog(
      tr('acc.addOffline'),
      [{ key: 'name', label: tr('acc.offlineName'), hint: tr('acc.offlineHint'), required: true }],
      { submit: tr('common.create') }
    );
    if (!answer) return;
    try {
      await api('/accounts/offline', { method: 'POST', body: { name: answer.name } });
      ok(tr('srv.saved'));
      await refresh();
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $$('[data-remove]').forEach((button) =>
    button.addEventListener('click', async () => {
      const account = state.accounts.find((entry) => entry.id === Number(button.dataset.remove));
      const sure = await confirmDialog(tr('acc.removeAsk', { name: account.name }), {
        confirm: tr('common.delete'),
      });
      if (!sure) return;
      try {
        await api(`/accounts/${account.id}`, { method: 'DELETE' });
        ok(tr('srv.saved'));
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
 * nach dem Ergebnis. Der Link enthält den Code bereits – abtippen muss ihn niemand mehr.
 */
async function startLogin() {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <header><h3>${escapeHtml(tr('acc.ms.title'))}</h3></header>
    <div class="body" id="login-body">
      <p class="muted">${escapeHtml(tr('common.loading'))}</p>
    </div>
    <footer><button class="btn" id="login-close">${escapeHtml(tr('common.cancel'))}</button></footer>`;
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
    $('#login-body', dialog).innerHTML = `<p style="color:var(--bad-text)">${escapeHtml(error.message)}</p>`;
    return;
  }

  const paint = (data) => {
    const body = $('#login-body', dialog);
    if (data.status === 'code') {
      // Microsoft nimmt den Code als Parameter in der Adresse entgegen: ein Klick, und er steht
      // drüben schon im Feld. Deshalb gibt es hier keinen Code zum Abschreiben – er wäre nur eine
      // Zeile, die niemand braucht und die aussieht, als müsste man etwas tun.
      const link = data.verification_uri_complete || data.verification_uri;
      body.innerHTML = `
        <div class="stack center" style="gap:1.25rem;padding:.5rem 0">
          <a class="btn btn-primary btn-block btn-lg" href="${escapeHtml(link)}" target="_blank" rel="noopener">
            ${escapeHtml(tr('acc.ms.open'))} ${icon('external')}</a>
          <p class="muted small" style="text-align:center;margin:0">${escapeHtml(tr('acc.ms.step'))}</p>
          <p class="small muted row" style="gap:.5rem">${icon('clock')} ${escapeHtml(tr('acc.ms.waiting'))}</p>
        </div>`;
      return;
    }
    if (data.status === 'done') {
      done = true;
      body.innerHTML = `<div class="stack center" style="gap:1rem;padding:1rem 0">
        <div style="color:var(--ok-text)">${icon('check')}</div>
        <h3>${escapeHtml(tr('acc.ms.done', { name: data.account.name }))}</h3></div>`;
      $('#login-close', dialog).textContent = tr('common.close');
      $('#login-close', dialog).classList.add('btn-primary');
      return;
    }
    if (data.status === 'error') {
      body.innerHTML = `<div class="note bad">${icon('alert')}<div>${escapeHtml(
        data.error || tr('common.error')
      )}</div></div>`;
      return;
    }
    body.innerHTML = `<p class="muted row" style="gap:.5rem">${icon('clock')} ${escapeHtml(
      tr('common.loading')
    )}</p>`;
  };

  paint(session);
  timer = setInterval(async () => {
    try {
      const data = await api(`/accounts/login/${session.id}`);
      paint(data);
      if (data.status === 'done') {
        clearInterval(timer);
        ok(tr('acc.ms.done', { name: data.account.name }));
        await refresh();
        if (state.route.name === 'accounts') draw();
      }
      if (data.status === 'error') clearInterval(timer);
    } catch (error) {
      clearInterval(timer);
      $('#login-body', dialog).innerHTML = `<div class="note bad">${icon('alert')}<div>${escapeHtml(
        error.message
      )}</div></div>`;
    }
  }, 2000);
}
