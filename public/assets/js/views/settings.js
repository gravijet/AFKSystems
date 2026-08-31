// Das eigene Konto.
//
// Vier Bereiche, jeder mit einem Satz, der sagt, wofür er da ist: Konto, verknüpfte Konten,
// Nachrichten, Sicherheit. Vorher standen hier vier gleich aussehende Kästen ohne Erklärung, und
// die wichtigste Frage – "war diese E-Mail wirklich von euch?" – ließ sich gar nicht beantworten.

import {
  api, icon, themeSwitch, escapeHtml, datetime, credits, safeLink, tr, url, switchLang, $, $$, ok, fail,
  confirmDialog,
} from '../ui.js';
import { state, appbar, refresh, draw, showShortcuts } from '../app.js';
import { preferences, setPreference } from '../preferences.js';

export async function render(root) {
  const me = state.me;
  const [sessions, mails] = await Promise.all([
    api('/me/sessions').catch(() => ({ sessions: [] })),
    api('/me/mails').catch(() => ({ mails: [], categories: [] })),
  ]);
  const providers = state.meta?.oauth || {};
  const params = new URLSearchParams(location.hash.split('?')[1] || '');

  root.innerHTML = `
    ${appbar(tr('set.title'), '', tr('set.sub'))}
    ${flash(params)}

    <div class="settings">
      ${section('user', tr('set.account'), tr('set.accountSub'), accountBody(me))}
      ${section('sliders', tr('set.experience'), tr('set.experienceSub'), experienceBody(me))}
      ${section('globe', tr('set.linked'), tr('set.linkedSub'), linkedBody(me, providers))}
      ${section('send', tr('set.notify'), tr('set.notifySub'), notifyBody(me))}
      ${section('shield', tr('set.security'), tr('set.securitySub'), securityBody(sessions.sessions || []))}
      <!-- Ein Briefumschlag fürs Postfach und eine Uhr für gar nichts: Vorher stand über den
           verschickten Nachrichten eine Uhr und über den Einstellungen dazu der Umschlag. -->
      ${section('mail', tr('set.mailsTitle'), tr('set.mailsSub'), mailsBody(mails.mails || []))}
    </div>`;

  bind(me, mails.mails || []);
}

// ---------------------------------------------------------------- Panel auf diesem Gerät

function experienceBody(me) {
  const value = preferences(me.id);
  const choices = (name, options) => `<div class="preference-choice" role="group">
    ${options
      .map(
        ([key, label]) => `<button type="button" data-device-pref="${name}" data-value="${key}"
          aria-pressed="${value[name] === key}">${escapeHtml(label)}</button>`
      )
      .join('')}
  </div>`;
  return `
    <div class="preference-row">
      <div class="grow"><div class="strong">${escapeHtml(tr('set.theme'))}</div>
        <p class="small muted">${escapeHtml(tr('set.deviceSaved'))}</p></div>
      ${themeSwitch()}
    </div>
    <div class="preference-row">
      <div class="grow"><div class="strong">${escapeHtml(tr('set.density'))}</div></div>
      ${choices('density', [
        ['comfortable', tr('set.density.comfortable')],
        ['compact', tr('set.density.compact')],
      ])}
    </div>
    <div class="preference-row">
      <div class="grow"><div class="strong">${escapeHtml(tr('set.motion'))}</div></div>
      ${choices('motion', [
        ['system', tr('set.motion.system')],
        ['reduced', tr('set.motion.reduced')],
      ])}
    </div>
    <div class="preference-row wrap">
      <label class="grow strong" for="start-page">${escapeHtml(tr('set.startPage'))}</label>
      <select id="start-page" style="max-width:18rem">
        <option value="overview" ${value.start === 'overview' ? 'selected' : ''}>${escapeHtml(
          tr('set.start.overview')
        )}</option>
        <option value="last" ${value.start === 'last' ? 'selected' : ''}>${escapeHtml(tr('set.start.last'))}</option>
      </select>
    </div>
    <button class="btn" type="button" id="show-shortcuts">${icon('keyboard')} ${escapeHtml(
      tr('set.shortcuts')
    )}</button>`;
}

/** Ein Bereich: Symbol, Überschrift, ein Satz Erklärung, Inhalt. */
function section(symbol, title, lead, body) {
  return `<section class="setting-card">
    <div class="setting-head">
      <span class="setting-icon">${icon(symbol)}</span>
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(lead)}</p>
      </div>
    </div>
    <div class="setting-body">${body}</div>
  </section>`;
}

function flash(params) {
  if (params.get('welcome')) {
    return `<div class="note" style="margin-bottom:1.25rem">${icon('check')}<div>${escapeHtml(
      tr('set.welcome')
    )}</div></div>`;
  }
  if (params.get('link')) {
    return `<div class="note" style="margin-bottom:1.25rem">${icon('check')}<div>${escapeHtml(
      tr('set.linkOk')
    )}</div></div>`;
  }
  if (params.get('error')) {
    return `<div class="note bad" style="margin-bottom:1.25rem">${icon('alert')}<div>${escapeHtml(
      params.get('error')
    )}</div></div>`;
  }
  return '';
}

// ---------------------------------------------------------------- Konto

/**
 * Der Kontokasten.
 *
 * Das Guthaben geht durch `credits()` – das schreibt die Zahl in der Sprache des Panels. Ein
 * blankes `toLocaleString()` nimmt dagegen die des Betriebssystems: Auf einem englischen Rechner
 * stand im deutschen Panel "1,234" und einen Klick weiter, im Guthaben-Bereich, "1.234".
 */
function accountBody(me) {
  return `
    <dl class="facts">
      <div><dt>${escapeHtml(tr('auth.register.username'))}</dt><dd class="mono">${escapeHtml(me.username)}</dd></div>
      <div><dt>${escapeHtml(tr('auth.register.email'))}</dt><dd class="mono">${escapeHtml(me.email)}</dd></div>
      <div><dt>${escapeHtml(tr('set.role'))}</dt>
        <dd><span class="pill ${me.role === 'admin' ? 'primary' : ''}">${escapeHtml(
          tr(me.role === 'admin' ? 'set.role.admin' : 'set.role.user')
        )}</span></dd></div>
      <div><dt>${escapeHtml(tr('bill.balance'))}</dt>
        <dd class="mono"><a href="#/credits">${credits(me.credits)}</a></dd></div>
    </dl>

    <div class="row wrap" style="gap:1rem;align-items:flex-end">
      <div class="field" style="max-width:14rem">
        <label for="language">${escapeHtml(tr('set.language'))}</label>
        <select id="language">
          <option value="en" ${me.language === 'en' ? 'selected' : ''}>English</option>
          <option value="de" ${me.language === 'de' ? 'selected' : ''}>Deutsch</option>
        </select>
        <span class="hint">${escapeHtml(tr('set.languageHint'))}</span>
      </div>
      <button class="btn btn-primary" id="save-language">${escapeHtml(tr('common.save'))}</button>
    </div>`;
}

// ---------------------------------------------------------------- Verknüpfungen

function linkedBody(me, providers) {
  const row = (key, symbol, label, what, linkedAs, extra = '') => {
    const provider = providers[key] || {};
    if (!provider.available) {
      return `<div class="link-row">
        <span class="link-icon">${icon(symbol)}</span>
        <div class="grow"><div class="strong">${escapeHtml(label)}</div>
          <p class="small muted">${escapeHtml(tr('set.providerOff'))}</p></div>
      </div>`;
    }
    return `<div class="link-row ${linkedAs ? 'is-linked' : ''}">
      <span class="link-icon">${icon(symbol)}</span>
      <div class="grow" style="min-width:0">
        <div class="strong">${escapeHtml(label)}</div>
        <p class="small muted">${escapeHtml(linkedAs ? tr('set.linkedAs', { name: linkedAs }) : what)}</p>
        ${extra}
      </div>
      ${
        linkedAs
          ? `<button class="btn btn-sm btn-danger" data-unlink="${key}">${escapeHtml(tr('set.unlink'))}</button>`
          : `<a class="btn btn-sm btn-primary" href="/api/auth/${key}/start?mode=link">${escapeHtml(
              tr('set.link')
            )}</a>`
      }
    </div>`;
  };

  const invite = state.meta?.free_plan?.invite || state.meta?.discord_invite || '';
  const access = me.free_access || {};
  const membership = me.discord
    ? `<p class="small ${access.ok ? '' : 'muted'}" style="margin:.4rem 0 0">
        ${icon(access.ok ? 'check' : 'alert')} ${escapeHtml(
          tr(access.ok ? 'set.freeDiscordOk' : 'set.freeDiscordMissing')
        )}
        ${
          !access.ok && invite
            ? ` · <a href="${escapeHtml(safeLink(invite))}" target="_blank" rel="noopener">${escapeHtml(
                tr('discord.join')
              )}</a>`
            : ''
        }</p>`
    : `<p class="small muted" style="margin:.4rem 0 0">${escapeHtml(tr('set.freeDiscordLink'))}</p>`;
  const linkedRoles =
    me.discord && me.linked_roles_available
      ? `<p class="small" style="margin:.4rem 0 0">
          <a href="/api/auth/discord/start?mode=verify">${escapeHtml(tr('set.verifyRoles'))}</a>
          <span class="muted"> — ${escapeHtml(tr('set.verifyRolesHint'))}</span></p>`
      : '';

  return `
    ${row(
      'discord',
      'discord',
      'Discord',
      tr('set.discordWhat'),
      me.discord?.name,
      `${membership}${linkedRoles}`
    )}
    ${row('google', 'google', 'Google', tr('set.googleWhat'), me.google?.email)}

    <hr class="rule">

    <p class="small muted">${escapeHtml(tr('set.webhookWhat'))}</p>
    <div class="row wrap" style="gap:.75rem;align-items:flex-end">
      <div class="field grow">
        <label for="webhook">${escapeHtml(tr('set.webhook'))}</label>
        <input id="webhook" type="url" placeholder="https://discord.com/api/webhooks/…"
          value="${escapeHtml(me.discord_webhook || '')}">
      </div>
      <button class="btn btn-primary" id="save-hook">${escapeHtml(tr('common.save'))}</button>
      <button class="btn" id="test-hook" ${me.discord_webhook ? '' : 'disabled'}>${escapeHtml(
        tr('set.webhookTest')
      )}</button>
    </div>

    <!-- Was der Webhook meldet. Nichts angehakt heißt **alles** – wer einen Webhook einträgt,
         will Bescheid wissen, und eine Voreinstellung, die nichts schickt, sähe aus wie ein
         kaputter Webhook. -->
    <ul class="switch-list" style="margin-top:1rem" id="hook-events">
      ${WEBHOOK_EVENTS.map(
        (key) => `<li>
          <div class="grow">
            <div class="strong">${escapeHtml(tr(`set.hook.${key}`))}</div>
            <p class="small muted">${escapeHtml(tr(`set.hook.${key}.what`))}</p>
          </div>
          <span class="switch" role="switch" tabindex="0" data-hook="${key}"
            aria-label="${escapeHtml(tr(`set.hook.${key}`))}"
            aria-checked="${wantsEvent(me, key)}"></span>
        </li>`
      ).join('')}
    </ul>`;
}

/**
 * Die Ereignisarten, die ein Webhook melden kann – dieselbe Liste wie `EVENTS` in server/notify.js.
 * Was hier nicht steht, gibt es nicht.
 */
const WEBHOOK_EVENTS = ['ticket', 'billing', 'plan', 'bot', 'account'];

/** Leer heißt alles – siehe `wants()` in server/notify.js. Die Regel steht auf beiden Seiten gleich. */
const wantsEvent = (me, key) => {
  const raw = String(me.discord_events || '').trim();
  return !raw || raw.split(',').includes(key);
};

// ---------------------------------------------------------------- Nachrichten

function notifyBody(me) {
  const categories = state.meta?.mail_categories || [];
  if (!state.meta?.mail_ready) {
    return `<div class="note warn">${icon('info')}<div>${escapeHtml(tr('set.providerOff'))}</div></div>`;
  }
  return `
    <ul class="switch-list">
      ${categories
        .map(
          (entry) => `<li>
            <div class="grow">
              <div class="strong">${escapeHtml(entry.name)}</div>
              <p class="small muted">${escapeHtml(entry.text)}</p>
            </div>
            ${
              entry.locked
                ? `<span class="pill" title="${escapeHtml(tr('set.notifySub'))}">${icon('lock')}</span>`
                : `<span class="switch" role="switch" tabindex="0"
                     aria-checked="${me.mail_prefs?.[entry.key] !== false}" data-pref="${entry.key}"></span>`
            }
          </li>`
        )
        .join('')}
    </ul>`;
}

// ---------------------------------------------------------------- Sicherheit

function securityBody(sessions) {
  return `
    <div class="grid two" style="gap:1.5rem">
      <div class="stack">
        <h3 class="small strong" style="margin:0">${escapeHtml(tr('set.password'))}</h3>
        <div class="field"><label for="old">${escapeHtml(tr('set.passwordOld'))}</label>
          <input id="old" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="new">${escapeHtml(tr('set.passwordNew'))}</label>
          <input id="new" type="password" autocomplete="new-password" minlength="8"></div>
        <div class="field"><label for="new2">${escapeHtml(tr('set.passwordNew2'))}</label>
          <input id="new2" type="password" autocomplete="new-password" minlength="8">
          <span class="hint">${escapeHtml(tr('set.passwordHint'))}</span></div>
        <button class="btn btn-primary" id="save-password">${escapeHtml(tr('set.password'))}</button>
      </div>

      <div class="stack">
        <h3 class="small strong" style="margin:0">${escapeHtml(tr('set.sessions'))}</h3>
        <ul class="plain-list">
          ${
            sessions
              .map(
                (session) => `<li class="row spread small">
                  <span class="mono truncate" title="${escapeHtml(session.agent || '')}">${escapeHtml(
                    session.ip || '–'
                  )}</span>
                  <span class="muted mono">${datetime(session.created_at)}</span>
                </li>`
              )
              .join('') || `<li class="small muted">${escapeHtml(tr('common.none'))}</li>`
          }
        </ul>
        <button class="btn" id="logout-all">${escapeHtml(tr('set.logoutAll'))}</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- Postfach

function mailsBody(mails) {
  if (!mails.length) return `<p class="small muted">${escapeHtml(tr('set.mailsNone'))}</p>`;
  return `<ul class="plain-list mail-list">
    ${mails
      .map(
        // Die Zeile ist anklickbar – dann muss sie auch mit der Tastatur erreichbar sein und sich
        // wie ein Knopf ankündigen. Ein `<li>` mit `cursor: pointer` ist für einen Screenreader
        // und für jeden, der nicht mit der Maus bedient, schlicht nicht vorhanden.
        (entry) => `<li class="row spread" data-mail="${entry.id}" role="button" tabindex="0">
          <span class="grow truncate">${escapeHtml(entry.subject)}
            ${
              entry.status !== 'sent'
                ? `<span class="pill missing">${escapeHtml(tr('set.mailFailed'))}</span>`
                : ''
            }</span>
          <span class="small muted mono nowrap">${datetime(entry.created_at)}</span>
        </li>`
      )
      .join('')}
  </ul>`;
}

// ---------------------------------------------------------------- Verhalten

function bind(me, mails) {
  $$('[data-device-pref]').forEach((button) =>
    button.addEventListener('click', () => {
      setPreference(me.id, button.dataset.devicePref, button.dataset.value);
      for (const sibling of $$(`[data-device-pref="${button.dataset.devicePref}"]`)) {
        sibling.setAttribute('aria-pressed', String(sibling === button));
      }
    })
  );
  $('#start-page')?.addEventListener('change', (event) => setPreference(me.id, 'start', event.target.value));
  $('#show-shortcuts')?.addEventListener('click', showShortcuts);

  $('#save-language').addEventListener('click', async () => {
    const next = $('#language').value;
    try {
      await api('/me', { method: 'PATCH', body: { language: next } });
      // Am Konto **und** im Browser merken: das Konto entscheidet, was in E-Mails steht, der
      // Browser, was dieses Gerät anzeigt – auch abgemeldet. switchLang macht beides und geht
      // gleich auf dieselbe Stelle in der neuen Sprache.
      switchLang(next);
    } catch (error) {
      fail(error);
    }
  });

  $$('[data-unlink]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!(await confirmDialog(tr('set.unlink')))) return;
      try {
        await api(`/auth/${button.dataset.unlink}`, { method: 'DELETE' });
        await refresh({ profiles: false, accounts: false });
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

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
      ok(tr('set.webhookSent'));
    } catch (error) {
      fail(error);
    }
  });

  // Welche Ereignisse der Webhook meldet. Gespeichert wird die Liste dessen, was **an** ist –
  // alles an heißt: leere Liste, und leer heißt beim Server "alles" (siehe notify.js).
  $$('[data-hook]').forEach((node) => {
    const toggle = async () => {
      const next = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(next));
      const on = $$('[data-hook]')
        .filter((entry) => entry.getAttribute('aria-checked') === 'true')
        .map((entry) => entry.dataset.hook);
      try {
        await api('/me', {
          method: 'PATCH',
          body: { discord_events: on.length === WEBHOOK_EVENTS.length ? '' : on.join(',') },
        });
        me.discord_events = on.length === WEBHOOK_EVENTS.length ? '' : on.join(',');
      } catch (error) {
        node.setAttribute('aria-checked', String(!next));
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

  // Die Schalter speichern sofort. Ein "Speichern"-Knopf für fünf Ja/Nein-Fragen wäre eine Hürde
  // ohne Zweck – und wer eine Sorte abbestellt, will das jetzt und nicht nach einem Klick mehr.
  $$('[data-pref]').forEach((node) => {
    const toggle = async () => {
      const next = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', String(next));
      const prefs = { ...(me.mail_prefs || {}), [node.dataset.pref]: next };
      try {
        await api('/me', { method: 'PATCH', body: { mail_prefs: prefs } });
        me.mail_prefs = prefs;
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
    // Erst alle anderen Sitzungen, dann die eigene. Der Knopf heißt "auf allen Geräten abmelden",
    // und genau darauf verlässt sich, wer ihn drückt, weil ihm ein fremdes Gerät nicht geheuer ist.
    try {
      await api('/me/sessions', { method: 'DELETE' });
    } catch (error) {
      fail(error);
      return;
    }
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = url('/login');
  });

  $$('[data-mail]').forEach((row) => {
    const open = async () => {
      const entry = mails.find((item) => item.id === Number(row.dataset.mail));
      try {
        const data = await api(`/me/mails/${row.dataset.mail}`);
        showMail(data.mail, entry);
      } catch (error) {
        fail(error);
      }
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
  });
}

/** Eine verschickte Nachricht im Wortlaut. */
function showMail(mail, meta) {
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
          ? `<div class="note bad">${icon('alert')}<div>${escapeHtml(mail.error || tr('set.mailFailed'))}</div></div>`
          : ''
      }
      <pre class="mail-body">${escapeHtml(mail.body || '')}</pre>
    </div>
    <footer><button class="btn btn-primary" id="close">${escapeHtml(tr('common.close'))}</button></footer>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  $('#close', dialog).addEventListener('click', () => dialog.close());
  dialog.showModal();
}
