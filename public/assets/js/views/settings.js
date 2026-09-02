// Das eigene Konto.
//
// **Warum hier Reiter stehen.** Bis vor Kurzem waren das vier Kästen untereinander, und das ging
// auch: Konto, Verknüpfungen, Nachrichten, Sicherheit. Dazugekommen sind seither der Name, die
// Rechnungsadresse, die offenen Geräte, die Anmeldeversuche, der Datenexport und die Löschung des
// Kontos. Untereinander wäre das eine Seite, auf der man scrollt, bis man findet – und auf der
// „Konto löschen“ zufällig unter „Farbschema“ steht.
//
// Also dieselbe Aufteilung wie beim Serverplatz: eine Reiterleiste, ein Reiter je Frage.
//
//   Konto          – wer du hier bist: Bild, Name, Adresse, Sprache, verknüpfte Konten
//   Persönliches   – Name, Telefon, Zeitzone und die Rechnungsadresse
//   Nachrichten    – was per E-Mail kommt, was über Discord, und was schon verschickt wurde
//   Sicherheit     – Passwort, angemeldete Geräte, Anmeldeversuche
//   Darstellung    – was dieses Gerät anders macht als die anderen
//   Deine Daten    – alles mitnehmen oder alles löschen
//
// Jeder Reiter ist eine eigene Adresse (`#/settings/security`) – damit lässt sich darauf
// verlinken, und der Zurück-Knopf des Browsers tut das Erwartbare.

import {
  api, icon, themeSwitch, escapeHtml, datetime, date, since, credits, safeLink, tr, url, switchLang,
  avatar, $, $$, ok, fail, toast, confirmDialog, formDialog, lang,
} from '../ui.js';
import { state, appbar, refresh, draw, go, showShortcuts } from '../app.js';
import { preferences, setPreference } from '../preferences.js';
import { countryList, addressLines } from '../countries.js';

/** Die Reiter. Reihenfolge und Namen stehen nur hier – Leiste und Router lesen dieselbe Liste. */
const TABS = [
  { key: 'account', label: 'set.tab.account' },
  { key: 'personal', label: 'set.tab.personal' },
  { key: 'messages', label: 'set.tab.messages' },
  { key: 'security', label: 'set.tab.security' },
  { key: 'display', label: 'set.tab.display' },
  { key: 'data', label: 'set.tab.data' },
];

export async function render(root, route = {}) {
  const me = state.me;
  const current = TABS.some((tab) => tab.key === route.tab) ? route.tab : 'account';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');

  root.innerHTML = `
    ${appbar(tr('set.title'), '', tr('set.sub'))}
    ${flash(params)}
    ${deletionBanner(me)}
    <nav class="tabs">${TABS.map(
      (tab) =>
        `<a class="${current === tab.key ? 'active' : ''}" href="#/settings/${tab.key}">${escapeHtml(
          tr(tab.label)
        )}</a>`
    ).join('')}</nav>
    <div class="settings" id="settings-body"></div>`;

  const body = $('#settings-body');
  const views = {
    account: tabAccount,
    personal: tabPersonal,
    messages: tabMessages,
    security: tabSecurity,
    display: tabDisplay,
    data: tabData,
  };
  await views[current](body, me);
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

/**
 * Der Streifen über allem, solange eine Löschung ansteht.
 *
 * Er steht auf **jedem** Reiter der Einstellungen und nicht nur auf dem, auf dem die Löschung
 * beantragt wurde: Ein Termin, an dem alles weg ist, gehört nicht hinter einen Klick. Weggeklickt
 * werden kann er nicht – was weg ist, kommt nicht wieder, und dann läuft die Frist ohne Zuschauer.
 */
function deletionBanner(me) {
  if (!me.delete_due_at) return '';
  return `<div class="note bad" style="margin-bottom:1.25rem">${icon('alert')}
    <div class="grow">${escapeHtml(tr('set.deletePending', { date: date(me.delete_due_at) }))}</div>
    <button class="btn btn-sm" data-cancel-delete>${escapeHtml(tr('set.deleteCancel'))}</button>
  </div>`;
}

// ================================================================ Reiter: Konto

async function tabAccount(root, me) {
  const providers = state.meta?.oauth || {};
  root.innerHTML = `
    ${section('user', tr('set.identity'), tr('set.identitySub'), identityBody(me))}
    ${section('globe', tr('set.linked'), tr('set.linkedSub'), linkedBody(me, providers))}`;
  bindCommon();
  bindIdentity(me);
  bindLinked();
}

/**
 * Der Kopf des Kontos: Bild, Name, Adresse.
 *
 * Das Guthaben geht durch `credits()` – das schreibt die Zahl in der Sprache des Panels. Ein
 * blankes `toLocaleString()` nimmt dagegen die des Betriebssystems: Auf einem englischen Rechner
 * stand im deutschen Panel "1,234" und einen Klick weiter, im Guthaben-Bereich, "1.234".
 */
function identityBody(me) {
  const nextChange = me.username_changed_at ? me.username_changed_at + 30 * 86_400_000 : 0;
  return `
    <div class="identity">
      ${avatar(me, { size: 64, klass: 'identity-avatar' })}
      <div class="grow" style="min-width:0">
        <div class="identity-name">${escapeHtml(me.display_name || me.username)}</div>
        ${
          me.display_name && me.display_name !== me.username
            ? `<div class="small muted mono">@${escapeHtml(me.username)}</div>`
            : ''
        }
        <div class="small muted truncate">${escapeHtml(me.email)}</div>
        <div class="row wrap" style="gap:.4rem;margin-top:.5rem">
          <span class="pill ${me.role === 'admin' ? 'primary' : ''}">${escapeHtml(
            tr(me.role === 'admin' ? 'set.role.admin' : 'set.role.user')
          )}</span>
          ${me.paying ? `<span class="pill">${escapeHtml(tr('adm.paying'))}</span>` : ''}
          ${
            me.email_verified
              ? ''
              : `<span class="pill missing">${escapeHtml(tr('set.emailUnverified'))}</span>`
          }
        </div>
      </div>
    </div>

    <dl class="facts">
      <div><dt>${escapeHtml(tr('auth.register.username'))}</dt>
        <dd class="mono">${escapeHtml(me.username)}</dd></div>
      <div><dt>${escapeHtml(tr('auth.register.email'))}</dt>
        <dd class="mono truncate">${escapeHtml(me.email)}</dd></div>
      <div><dt>${escapeHtml(tr('set.memberSince'))}</dt><dd>${date(me.created_at)}</dd></div>
      <div><dt>${escapeHtml(tr('bill.balance'))}</dt>
        <dd class="mono"><a href="#/credits">${credits(me.credits)}</a></dd></div>
    </dl>

    ${
      me.pending_email
        ? `<div class="note warn">${icon('mail')}
            <div class="grow">${escapeHtml(tr('set.emailPending', { email: me.pending_email }))}</div>
            <button class="btn btn-sm" id="cancel-email">${escapeHtml(tr('set.emailCancel'))}</button>
          </div>`
        : ''
    }

    <div class="row wrap" style="gap:.6rem">
      <button class="btn" id="change-username">${icon('user')} ${escapeHtml(tr('set.changeUsername'))}</button>
      <button class="btn" id="change-email">${icon('mail')} ${escapeHtml(tr('set.changeEmail'))}</button>
    </div>
    <p class="small muted" style="margin:.6rem 0 0">${escapeHtml(tr('set.usernameNote'))}${
      nextChange > Date.now() ? ` ${tr('set.usernameNext', { date: date(nextChange) })}` : ''
    }</p>

    <div class="row wrap" style="gap:.75rem;align-items:flex-end;margin-top:1rem">
      <div class="field" style="max-width:18rem">
        <label for="avatar-source">${escapeHtml(tr('set.avatarSource'))}</label>
        <select id="avatar-source">
          ${[
            ['auto', 'set.avatarAuto', true],
            ['discord', 'Discord', Boolean(me.avatar_choices?.discord)],
            ['google', 'Google', Boolean(me.avatar_choices?.google)],
            ['gravatar', 'Gravatar', Boolean(me.avatar_choices?.gravatar)],
            ['initials', 'set.avatarInitials', true],
          ]
            .map(
              ([value, label, available]) =>
                `<option value="${value}" ${me.avatar_source === value ? 'selected' : ''} ${
                  available ? '' : 'disabled'
                }>${escapeHtml(label.includes('.') ? tr(label) : label)}</option>`
            )
            .join('')}
        </select>
        <span class="hint">${escapeHtml(tr('set.avatarHint'))}</span>
      </div>
      <button class="btn" id="save-avatar">${escapeHtml(tr('common.save'))}</button>
    </div>

    <hr class="rule">

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

function bindIdentity(me) {
  $('#save-avatar').addEventListener('click', async () => {
    try {
      await api('/me', { method: 'PATCH', body: { avatar_source: $('#avatar-source').value } });
      ok(tr('set.avatarSaved'));
      await refresh({ profiles: false, accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  });

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

  $('#change-username').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('set.changeUsername'),
      [{ key: 'username', label: tr('auth.register.username'), value: me.username, required: true }],
      { submit: tr('common.save'), note: tr('set.usernameNote') }
    );
    if (!answer || answer.username === me.username) return;
    try {
      await api('/me/username', { method: 'POST', body: { username: answer.username } });
      ok(tr('set.usernameOk'));
      await refresh({ profiles: false, accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $('#change-email').addEventListener('click', async () => {
    const answer = await formDialog(
      tr('set.changeEmail'),
      [
        { key: 'email', label: tr('set.emailNew'), type: 'email', required: true },
        {
          key: 'password',
          label: tr('set.emailPassword'),
          type: 'password',
          required: true,
          hint: tr('set.emailPasswordHint'),
        },
      ],
      { submit: tr('common.next'), note: tr('set.emailNote') }
    );
    if (!answer) return;
    try {
      const result = await api('/me/email', {
        method: 'POST',
        body: { email: answer.email, password: answer.password },
      });
      ok(tr('set.emailSent', { email: result.pending_email }));
      await refresh({ profiles: false, accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  });

  $('#cancel-email')?.addEventListener('click', async () => {
    try {
      await api('/me/email', { method: 'DELETE' });
      ok(tr('set.emailCancelled'));
      await refresh({ profiles: false, accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  });
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
    ${row('discord', 'discord', 'Discord', tr('set.discordWhat'), me.discord?.name, `${membership}${linkedRoles}`)}
    ${row('google', 'google', 'Google', tr('set.googleWhat'), me.google?.email)}`;
}

function bindLinked() {
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
}

// ================================================================ Reiter: Persönliches

async function tabPersonal(root, me) {
  const value = me.profile || {};
  root.innerHTML = `
    ${section('user', tr('set.personal'), tr('set.personalSub'), personalBody(value))}
    ${section('wallet', tr('set.billing'), tr('set.billingSub'), billingBody(me, value))}`;
  bindCommon();
  bindPersonal(me);
}

/** Ein beschriftetes Feld – dieselbe Form wie überall im Panel, damit nichts herausfällt. */
function field(key, label, value, { type = 'text', hint = '', placeholder = '', width = '' } = {}) {
  return `<div class="field" ${width ? `style="max-width:${width}"` : ''}>
    <label for="p-${key}">${escapeHtml(label)}</label>
    <input id="p-${key}" data-profile="${key}" type="${type}" value="${escapeHtml(value || '')}"
      placeholder="${escapeHtml(placeholder)}" autocomplete="${AUTOCOMPLETE[key] || 'off'}">
    ${hint ? `<span class="hint">${escapeHtml(hint)}</span>` : ''}
  </div>`;
}

/**
 * Was der Browser hier ausfüllen darf.
 *
 * Ohne diese Angaben bietet ein Browser bei „Straße“ gern die E-Mail-Adresse an und speichert das
 * Ergebnis auch noch. Die Namen stammen aus der HTML-Spezifikation und sind das, worauf jeder
 * Passwortmanager und jede Adressverwaltung hört.
 */
const AUTOCOMPLETE = {
  full_name: 'name',
  phone: 'tel',
  company: 'organization',
  street: 'address-line1',
  street2: 'address-line2',
  postal_code: 'postal-code',
  city: 'address-level2',
  region: 'address-level1',
  country: 'country',
  billing_email: 'email',
};

function personalBody(value) {
  return `
    <div class="grid two" style="gap:1rem">
      ${field('full_name', tr('set.fullName'), value.full_name, { hint: tr('set.fullNameHint') })}
      ${field('phone', tr('set.phone'), value.phone, { type: 'tel', hint: tr('set.phoneHint') })}
    </div>
    <div class="row wrap" style="gap:.75rem;align-items:flex-end;margin-top:1rem">
      <div class="field grow" style="max-width:20rem">
        <label for="p-timezone">${escapeHtml(tr('set.timezone'))}</label>
        <select id="p-timezone" data-profile="timezone">
          <option value="">${escapeHtml(
            tr('set.timezoneServer', { zone: state.meta?.server_timezone || guessZone() })
          )}</option>
          ${zoneOptions(value.timezone)}
        </select>
        <span class="hint">${escapeHtml(tr('set.timezoneHint'))}</span>
      </div>
      <button class="btn" type="button" id="detect-zone">${icon('pin')} ${escapeHtml(
        tr('set.timezoneDetect')
      )}</button>
    </div>`;
}

/** Die Zeitzone dieses Geräts – der Browser weiß sie, also fragen wir nicht danach. */
const guessZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * Die Zeitzonen als Auswahlliste.
 *
 * Eine Auswahlliste und kein Textfeld mit Vorschlägen (`<datalist>`): Die zeichnet jeder Browser
 * anders – Chrome hängt einen eigenen Pfeil daran, Firefox nichts –, und eine Zeitzone ist ohnehin
 * eine Wahl aus einer festen Liste und keine freie Eingabe. Die Liste kommt aus
 * `Intl.supportedValuesOf`, also aus derselben Zeitzonendatenbank, gegen die der Server prüft.
 *
 * Der bereits gespeicherte Wert wird mit aufgenommen, falls er nicht darin steht (eine ältere
 * Schreibweise, ein Kürzel aus der Zeit davor). Sonst spränge die Anzeige beim Öffnen still auf
 * etwas anderes, und das nächste Speichern übernähme es.
 */
function zoneOptions(current = '') {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [guessZone()];
  }
  if (current && !zones.includes(current)) zones = [current, ...zones];
  return zones
    .map(
      (zone) =>
        `<option value="${escapeHtml(zone)}" ${zone === current ? 'selected' : ''}>${escapeHtml(zone)}</option>`
    )
    .join('');
}

function billingBody(me, value) {
  const countries = countryList(lang);
  return `
    <div class="grid two" style="gap:1rem">
      ${field('company', tr('set.company'), value.company, { hint: tr('set.companyHint') })}
      ${field('vat_id', tr('set.vatId'), value.vat_id, { hint: tr('set.vatIdHint'), placeholder: 'ATU12345678' })}
    </div>
    <div class="grid two" style="gap:1rem;margin-top:1rem">
      ${field('street', tr('set.street'), value.street)}
      ${field('street2', tr('set.street2'), value.street2, { hint: tr('set.street2Hint') })}
    </div>
    <div class="address-grid">
      ${field('postal_code', tr('set.postalCode'), value.postal_code)}
      ${field('city', tr('set.city'), value.city)}
      ${field('region', tr('set.region'), value.region)}
      <div class="field">
        <label for="p-country">${escapeHtml(tr('set.country'))}</label>
        <select id="p-country" data-profile="country" autocomplete="country">
          <option value="">${escapeHtml(tr('set.countryPick'))}</option>
          ${countries
            .map(
              (entry) =>
                `<option value="${entry.code}" ${entry.code === value.country ? 'selected' : ''}>${escapeHtml(
                  entry.name
                )}</option>`
            )
            .join('')}
        </select>
      </div>
    </div>
    <div style="margin-top:1rem;max-width:26rem">
      ${field('billing_email', tr('set.billingEmail'), value.billing_email, {
        type: 'email',
        hint: tr('set.billingEmailHint'),
        placeholder: me.email,
      })}
    </div>

    <hr class="rule">

    <div class="row wrap spread" style="gap:1rem;align-items:flex-start">
      <div class="receipt-preview" id="address-preview">
        <span class="small muted">${escapeHtml(tr('set.addressPreview'))}</span>
        ${addressPreview(me, value)}
      </div>
      <button class="btn btn-primary" id="save-profile">${escapeHtml(tr('common.save'))}</button>
    </div>`;
}

/** Wie die Anschrift auf einem Beleg aussieht – dieselbe Reihenfolge wie dort (countries.js). */
function addressPreview(me, value) {
  const lines = addressLines(value, lang);
  if (!lines.length) {
    return `<p class="small muted" style="margin:.35rem 0 0">${escapeHtml(tr('set.addressEmpty'))}</p>`;
  }
  return `<address>${lines.map((line) => escapeHtml(line)).join('<br>')}${
    value.vat_id ? `<br><span class="small muted">${escapeHtml(tr('set.vatId'))} ${escapeHtml(value.vat_id)}</span>` : ''
  }</address>`;
}

function bindPersonal(me) {
  const read = () => {
    const out = {};
    for (const node of $$('[data-profile]')) out[node.dataset.profile] = node.value.trim();
    return out;
  };

  // Die Vorschau geht mit, während getippt wird. Sie ist der einzige Ort, an dem sichtbar wird,
  // wozu diese Felder gut sind – eine Vorschau, die erst nach dem Speichern stimmt, käme zu spät.
  const repaint = () => {
    const box = $('#address-preview');
    if (!box) return;
    box.innerHTML = `<span class="small muted">${escapeHtml(tr('set.addressPreview'))}</span>${addressPreview(
      me,
      read()
    )}`;
  };
  for (const node of $$('[data-profile]')) {
    node.addEventListener('input', repaint);
    node.addEventListener('change', repaint);
  }

  // Die Zeitzone dieses Geräts übernehmen. Steht sie nicht in der Liste (ein Browser mit einer
  // älteren Zeitzonendatenbank als dieser Server), wird sie dafür angelegt – sonst täte der Knopf
  // sichtbar nichts.
  $('#detect-zone')?.addEventListener('click', () => {
    const field = $('#p-timezone');
    const zone = guessZone();
    if (![...field.options].some((option) => option.value === zone)) {
      field.add(new Option(zone, zone), 1);
    }
    field.value = zone;
    repaint();
  });

  $('#save-profile').addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      const result = await api('/me', { method: 'PATCH', body: read() });
      state.me = result.user;
      ok(tr('set.saved'));
    } catch (error) {
      fail(error);
    } finally {
      event.target.disabled = false;
    }
  });
}

// ================================================================ Reiter: Nachrichten

async function tabMessages(root, me) {
  const mails = await api('/me/mails').catch(() => ({ mails: [], categories: [] }));
  root.innerHTML = `
    ${section('send', tr('set.notify'), tr('set.notifySub'), notifyBody(me))}
    ${section('discord', tr('set.webhook'), tr('set.webhookWhat'), webhookBody(me))}
    ${section('mail', tr('set.mailsTitle'), tr('set.mailsSub'), mailsBody(mails.mails || []))}`;
  bindCommon();
  bindMessages(me, mails.mails || []);
}

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

function webhookBody(me) {
  return `
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

function bindMessages(me, mails) {
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
  switchList('[data-hook]', async (node, next) => {
    const on = $$('[data-hook]')
      .filter((entry) => entry.getAttribute('aria-checked') === 'true')
      .map((entry) => entry.dataset.hook);
    const value = on.length === WEBHOOK_EVENTS.length ? '' : on.join(',');
    await api('/me', { method: 'PATCH', body: { discord_events: value } });
    me.discord_events = value;
    return next;
  });

  // Die Schalter speichern sofort. Ein "Speichern"-Knopf für fünf Ja/Nein-Fragen wäre eine Hürde
  // ohne Zweck – und wer eine Sorte abbestellt, will das jetzt und nicht nach einem Klick mehr.
  switchList('[data-pref]', async (node, next) => {
    const prefs = { ...(me.mail_prefs || {}), [node.dataset.pref]: next };
    await api('/me', { method: 'PATCH', body: { mail_prefs: prefs } });
    me.mail_prefs = prefs;
    return next;
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

/**
 * Ein Ja/Nein-Schalter, der sofort speichert – mit Tastatur und mit Rückweg.
 *
 * Der Rückweg ist der Punkt: Schlägt das Speichern fehl, springt der Schalter zurück auf den
 * Wert, der wirklich gilt. Ein Schalter, der „an“ zeigt, während der Server „aus“ gespeichert
 * hat, ist schlimmer als gar keiner.
 */
function switchList(selector, save) {
  $$(selector).forEach((node) => {
    const toggle = async () => {
      const before = node.getAttribute('aria-checked') === 'true';
      node.setAttribute('aria-checked', String(!before));
      try {
        // Der Schalter springt sofort um – das ist richtig, denn er soll sich anfühlen wie ein
        // Schalter und nicht wie ein Formular. Gibt `save` ein Ja/Nein zurück, gilt aber das:
        // Manche Schalter fragen nach ("den Anmeldecode wirklich abschalten?"), und ein Abbruch
        // dort ist kein Fehler, den man werfen könnte – er ist eine Antwort.
        const answer = await save(node, !before);
        if (typeof answer === 'boolean') node.setAttribute('aria-checked', String(answer));
      } catch (error) {
        node.setAttribute('aria-checked', String(before));
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

/** Eine verschickte Nachricht im Wortlaut. */
function showMail(mail) {
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

// ================================================================ Reiter: Sicherheit

async function tabSecurity(root) {
  const [sessions, signins, devices] = await Promise.all([
    api('/me/sessions').catch(() => ({ sessions: [] })),
    api('/me/signins').catch(() => ({ attempts: [] })),
    api('/me/devices').catch(() => ({ devices: [], login_code: false, mail_ready: false })),
  ]);
  root.innerHTML = `
    ${section('key', tr('set.password'), tr('set.securitySub'), passwordBody())}
    ${section('lock', tr('set.loginCode'), tr('set.loginCodeSub'), loginCodeBody(devices))}
    ${section('monitor', tr('set.sessions'), tr('set.sessionsSub'), sessionsBody(sessions.sessions || []))}
    ${section('shield', tr('set.signIns'), tr('set.signInsSub'), signinsBody(signins.attempts || []))}`;
  bindCommon();
  bindSecurity();
}

/**
 * Der Anmeldecode und die Browser, die ihn nicht mehr brauchen.
 *
 * Beides gehört in einen Kasten, denn beides ist eine Antwort auf dieselbe Frage. Der Schalter
 * sagt „frag nach, wenn ein Browser neu ist“; die Liste darunter sagt, welche Browser das gerade
 * nicht sind. Ohne die Liste wäre der Schalter eine Behauptung, die sich nicht nachprüfen lässt –
 * und niemand hätte einen Weg, einem fremden Rechner das Vertrauen wieder zu entziehen.
 */
function loginCodeBody(data) {
  const devices = data.devices || [];
  return `
    <ul class="switch-list">
      <li>
        <div class="grow">
          <div class="strong">${escapeHtml(tr('set.loginCodeAsk'))}</div>
          <p class="small muted">${escapeHtml(tr('set.loginCodeWhat'))}</p>
        </div>
        <span class="switch" role="switch" tabindex="0" data-login-code="1"
          aria-label="${escapeHtml(tr('set.loginCodeAsk'))}"
          aria-checked="${Boolean(data.login_code)}"></span>
      </li>
    </ul>
    ${
      data.mail_ready
        ? ''
        : `<div class="note warn" style="margin-top:1rem">${icon('info')}
            <div>${escapeHtml(tr('set.loginCodeNoMail'))}</div></div>`
    }
    <h4 style="margin:1.5rem 0 .5rem">${escapeHtml(tr('set.devices'))}</h4>
    <p class="small muted" style="margin:0 0 .75rem">${escapeHtml(tr('set.devicesSub'))}</p>
    ${
      devices.length
        ? `<ul class="device-list">
            ${devices
              .map(
                (entry) => `<li class="device ${entry.current ? 'is-current' : ''}">
                  <span class="device-icon">${icon(deviceIcon(entry.agent))}</span>
                  <div class="grow" style="min-width:0">
                    <div class="row" style="gap:.5rem">
                      <span class="strong truncate">${escapeHtml(entry.device || tr('set.deviceUnknown'))}</span>
                      ${
                        entry.current
                          ? `<span class="pill primary">${escapeHtml(tr('set.deviceCurrent'))}</span>`
                          : ''
                      }
                    </div>
                    <p class="small muted truncate" title="${escapeHtml(entry.agent || '')}">
                      ${escapeHtml(entry.ip || '–')} · ${escapeHtml(
                        tr('set.deviceLastSeen', { when: since(entry.last_at) })
                      )}</p>
                  </div>
                  <button class="btn btn-sm ${entry.current ? '' : 'btn-danger'}"
                    data-forget-device="${escapeHtml(entry.ref)}">${escapeHtml(tr('set.deviceForget'))}</button>
                </li>`
              )
              .join('')}
          </ul>
          <button class="btn" id="forget-devices" style="margin-top:1rem">${escapeHtml(
            tr('set.devicesForgetAll')
          )}</button>`
        : `<p class="small muted">${escapeHtml(tr('common.none'))}</p>`
    }`;
}

function passwordBody() {
  return `
    <div class="stack" style="max-width:26rem">
      <div class="field"><label for="old">${escapeHtml(tr('set.passwordOld'))}</label>
        <input id="old" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="new">${escapeHtml(tr('set.passwordNew'))}</label>
        <input id="new" type="password" autocomplete="new-password" minlength="12" maxlength="256"></div>
      <div class="field"><label for="new2">${escapeHtml(tr('set.passwordNew2'))}</label>
        <input id="new2" type="password" autocomplete="new-password" minlength="12" maxlength="256">
        <span class="hint">${escapeHtml(tr('set.passwordHint'))}</span></div>
      <div><button class="btn btn-primary" id="save-password">${escapeHtml(tr('set.password'))}</button></div>
    </div>`;
}

function sessionsBody(sessions) {
  if (!sessions.length) return `<p class="small muted">${escapeHtml(tr('common.none'))}</p>`;
  return `
    <ul class="device-list">
      ${sessions
        .map(
          (session) => `<li class="device ${session.current ? 'is-current' : ''}">
            <span class="device-icon">${icon(deviceIcon(session.agent))}</span>
            <div class="grow" style="min-width:0">
              <div class="row" style="gap:.5rem">
                <span class="strong truncate">${escapeHtml(session.device || tr('set.deviceUnknown'))}</span>
                ${
                  session.current
                    ? `<span class="pill primary">${escapeHtml(tr('set.sessionCurrent'))}</span>`
                    : ''
                }
              </div>
              <p class="small muted truncate" title="${escapeHtml(session.agent || '')}">
                ${escapeHtml(session.ip || '–')} · ${escapeHtml(
                  tr('set.sessionSince', { when: since(session.created_at) })
                )}</p>
            </div>
            ${
              session.current
                ? ''
                : `<button class="btn btn-sm btn-danger" data-drop-session="${escapeHtml(session.ref)}">${escapeHtml(
                    tr('set.sessionEnd')
                  )}</button>`
            }
          </li>`
        )
        .join('')}
    </ul>
    <button class="btn" id="logout-all" style="margin-top:1rem">${escapeHtml(tr('set.logoutAll'))}</button>`;
}

/** Ein Symbol, das zum Gerät passt – Handy, Rechner, sonst ein Fenster. */
const deviceIcon = (agent) =>
  /Android|iPhone|iPad|Mobile/.test(String(agent || '')) ? 'gamepad' : 'monitor';

function signinsBody(attempts) {
  if (!attempts.length) return `<p class="small muted">${escapeHtml(tr('set.signInsNone'))}</p>`;
  const label = (entry) => {
    // Der Anmeldecode zuerst: „falsches Passwort“ stünde sonst unter einem Versuch, bei dem das
    // Passwort gestimmt hat – und genau das ist die Zeile, die jemanden aufhorchen lassen soll.
    if (entry.reason === 'code') return tr(entry.ok ? 'set.signInCodeOk' : 'set.signInCodeWrong');
    if (entry.ok) return tr('set.signInOk');
    if (entry.reason === 'blocked') return tr('set.signInBlocked');
    if (entry.reason === 'throttled') return tr('set.signInThrottled');
    return tr('set.signInFailed');
  };
  return `<ul class="plain-list">
    ${attempts
      .map(
        (entry) => `<li class="row spread small">
          <span class="row" style="gap:.5rem;min-width:0">
            <span class="signin-dot ${entry.ok ? 'ok' : 'bad'}"></span>
            <span class="mono truncate">${escapeHtml(entry.ip || '–')}</span>
            <span class="muted">${escapeHtml(label(entry))}</span>
          </span>
          <span class="muted mono nowrap">${datetime(entry.created_at)}</span>
        </li>`
      )
      .join('')}
  </ul>`;
}

function bindSecurity() {
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

  $$('[data-drop-session]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        await api(`/me/sessions/${encodeURIComponent(button.dataset.dropSession)}`, { method: 'DELETE' });
        ok(tr('set.sessionEnded'));
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  // Der Anmeldecode. Ausschalten ist die Entscheidung, auf die zweite Frage zu verzichten – die
  // Rückfrage davor ist deshalb keine Förmlichkeit, sondern der einzige Moment, in dem jemand
  // merkt, dass er sie gerade abschafft. Einschalten braucht keine.
  switchList('[data-login-code]', async (node, next) => {
    if (!next && !(await confirmDialog(tr('set.loginCodeOffAsk'), { confirm: tr('common.disable') }))) {
      return !next;
    }
    await api('/me', { method: 'PATCH', body: { login_code: next } });
    await refresh({ profiles: false, accounts: false });
    return next;
  });

  $$('[data-forget-device]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        await api(`/me/devices/${encodeURIComponent(button.dataset.forgetDevice)}`, { method: 'DELETE' });
        ok(tr('set.deviceForgotten'));
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );

  $('#forget-devices')?.addEventListener('click', async () => {
    if (!(await confirmDialog(tr('set.devicesForgetAllAsk'), { confirm: tr('set.deviceForget') }))) return;
    try {
      await api('/me/devices', { method: 'DELETE' });
      ok(tr('set.deviceForgotten'));
      draw();
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
}

// ================================================================ Reiter: Darstellung

async function tabDisplay(root, me) {
  root.innerHTML = section('sliders', tr('set.experience'), tr('set.experienceSub'), experienceBody(me));
  bindCommon();
  bindDisplay(me);
}

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

function bindDisplay(me) {
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
}

// ================================================================ Reiter: Deine Daten

async function tabData(root, me) {
  // Die Frist kommt vom Server (account.GRACE_DAYS über /meta) und steht nicht hier: Sonst
  // stünde im Panel eine andere Zahl, sobald sie dort geändert wird.
  const days = state.meta?.delete_grace_days ?? 14;
  root.innerHTML = `
    ${section('download', tr('set.export'), tr('set.dataSub'), exportBody())}
    ${section('trash', tr('set.deleteTitle'), tr('set.deleteWhat', { days }), deleteBody(me, days))}`;
  bindCommon();
  bindData(days);
}

function exportBody() {
  return `
    <p class="small muted" style="margin:0 0 1rem">${escapeHtml(tr('set.exportWhat'))}</p>
    <a class="btn btn-primary" href="/api/me/export" download>${icon('download')} ${escapeHtml(
      tr('set.export')
    )}</a>`;
}

function deleteBody(me, days) {
  if (me.role === 'admin') {
    return `<div class="note">${icon('info')}<div>${escapeHtml(tr('set.deleteAdmin'))}</div></div>`;
  }
  if (me.delete_due_at) {
    return `<div class="note bad" style="margin:0 0 1rem">${icon('alert')}
        <div>${escapeHtml(tr('set.deletePending', { date: date(me.delete_due_at) }))}</div></div>
      <button class="btn btn-primary" data-cancel-delete>${escapeHtml(tr('set.deleteCancel'))}</button>`;
  }
  return `
    ${
      me.credits > 0
        ? `<div class="note warn" style="margin:0 0 1rem">${icon('wallet')}
            <div>${escapeHtml(tr('set.deleteCredits', { credits: credits(me.credits) }))}</div></div>`
        : ''
    }
    <button class="btn btn-danger" id="delete-account">${icon('trash')} ${escapeHtml(
      tr('set.deleteAsk')
    )}</button>`;
}

function bindData(days) {
  $('#delete-account')?.addEventListener('click', async () => {
    const word = tr('set.deleteConfirmWord');
    const answer = await formDialog(
      tr('set.deleteTitle'),
      [
        { type: 'note', label: tr('set.deleteWhat', { days }) },
        { key: 'confirm', label: tr('set.deleteConfirmHint', { word }), required: true },
        { key: 'password', label: tr('set.emailPassword'), type: 'password', required: true },
      ],
      { submit: tr('set.deleteAsk') }
    );
    if (!answer) return;
    // Das Wort wird **im Browser** geprüft und nicht am Server: Es ist keine Sicherheitsfrage
    // (das ist das Passwort daneben), sondern eine Bremse gegen den unbedachten Klick – und die
    // gehört dorthin, wo geklickt wird. Am Server stünde sie außerdem in einer von zwei Sprachen.
    if (answer.confirm.trim().toUpperCase() !== word.toUpperCase()) {
      return toast(tr('set.deleteConfirmHint', { word }), 'bad');
    }
    try {
      const result = await api('/me/delete', { method: 'POST', body: { password: answer.password } });
      ok(tr('set.deleteScheduled', { date: date(result.deletion.due_at) }));
      await refresh({ profiles: false, accounts: false });
      draw();
    } catch (error) {
      fail(error);
    }
  });
}

/** Was auf jedem Reiter gleich ist: der Widerruf der Löschung im Streifen ganz oben. */
function bindCommon() {
  $$('[data-cancel-delete]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        await api('/me/delete', { method: 'DELETE' });
        ok(tr('set.deleteCancelled'));
        await refresh({ profiles: false, accounts: false });
        draw();
      } catch (error) {
        fail(error);
      }
    })
  );
}
