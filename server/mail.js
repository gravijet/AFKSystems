// E-Mail. Die Zugangsdaten trägt der Administrator im Panel ein, nicht in einer Datei – dadurch
// lässt sich der Versand ein- und ausschalten, ohne den Dienst anzufassen.
//
// Ist kein SMTP hinterlegt, gibt es keine E-Mail-Funktionen: keine Bestätigungspflicht bei der
// Registrierung, kein "Passwort vergessen". Sie werden dann im Frontend gar nicht erst angeboten,
// statt einen Knopf zu zeigen, der ins Leere läuft.

import nodemailer from 'nodemailer';
import { db, getSetting } from './db.js';
import { config } from './config.js';

/** Ist der Versand eingerichtet? */
export function configured() {
  return Boolean(String(getSetting('smtp_host') || '').trim());
}

/** Muss die Adresse bei der Registrierung bestätigt werden? Ohne SMTP niemals. */
export function verifyRequired() {
  return configured() && Boolean(Number(getSetting('email_verify')));
}

let cached = null;
let cachedKey = '';

function transport() {
  const settings = {
    host: String(getSetting('smtp_host') || '').trim(),
    port: Number(getSetting('smtp_port')) || 587,
    secure: Boolean(Number(getSetting('smtp_secure'))),
    user: String(getSetting('smtp_user') || ''),
    pass: String(getSetting('smtp_pass') || ''),
  };
  const key = JSON.stringify(settings);
  if (cached && cachedKey === key) return cached;
  cached = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.user ? { user: settings.user, pass: settings.pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  cachedKey = key;
  return cached;
}

function sender() {
  const from = String(getSetting('smtp_from') || getSetting('smtp_user') || '').trim();
  const name = String(getSetting('smtp_from_name') || config.brand).trim();
  return name ? `${name} <${from}>` : from;
}

/**
 * Eine Nachricht verschicken. Wirft nie – der Aufruf steht meistens mitten in einer
 * Registrierung, und die soll nicht an einem stummen Mailserver scheitern.
 */
export async function send({ to, subject, text, html, kind = 'mail' }) {
  if (!configured()) return { ok: false, error: 'SMTP ist nicht eingerichtet.' };
  try {
    await transport().sendMail({ from: sender(), to, subject, text, html: html || undefined });
    db.prepare(
      "INSERT INTO mails (recipient, subject, kind, status, created_at) VALUES (?, ?, ?, 'sent', ?)"
    ).run(to, subject, kind, Date.now());
    return { ok: true };
  } catch (error) {
    db.prepare(
      "INSERT INTO mails (recipient, subject, kind, status, error, created_at) VALUES (?, ?, ?, 'failed', ?, ?)"
    ).run(to, subject, kind, String(error.message).slice(0, 400), Date.now());
    return { ok: false, error: error.message };
  }
}

/** Verbindung prüfen, ohne etwas zu verschicken – für den Knopf im Admin-Bereich. */
export async function verifyConnection() {
  if (!configured()) throw new Error('Es ist kein SMTP-Server hinterlegt.');
  await transport().verify();
  return true;
}

// ---------------------------------------------------------------- Vorlagen
//
// Bewusst schlicht: eine Anrede, ein Satz, ein Link. HTML nur, damit der Link klickbar ist.

const wrap = (title, body, action) => `<!doctype html>
<html><body style="margin:0;background:#f2f5f9;padding:32px 16px;
  font:16px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171717">
  <div style="max-width:34rem;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
    <div style="font-weight:700;letter-spacing:-.02em;font-size:1.1rem;margin-bottom:1.5rem">${config.brand}</div>
    <h1 style="font-size:1.35rem;margin:0 0 1rem;letter-spacing:-.02em">${title}</h1>
    ${body}
    ${
      action
        ? `<p style="margin:1.75rem 0 0"><a href="${action.url}"
             style="display:inline-block;background:#206cfe;color:#fff;text-decoration:none;
             padding:.7rem 1.2rem;border-radius:10px;font-weight:600">${action.label}</a></p>
           <p style="margin:1.25rem 0 0;font-size:.8125rem;color:#6b7280;word-break:break-all">
             Falls der Knopf nicht geht: ${action.url}</p>`
        : ''
    }
  </div>
  <p style="max-width:34rem;margin:1rem auto 0;font-size:.75rem;color:#6b7280;text-align:center">
    ${config.publicUrl.replace(/^https?:\/\//, '')}</p>
</body></html>`;

const T = {
  verify: {
    de: {
      subject: `${config.brand}: E-Mail-Adresse bestätigen`,
      title: 'Fast fertig',
      body: (name) =>
        `<p>Hallo ${name}, dein Konto ist angelegt. Bestätige noch kurz diese Adresse, dann kann es losgehen.</p>`,
      label: 'Adresse bestätigen',
      text: (name, url) =>
        `Hallo ${name},\n\ndein Konto bei ${config.brand} ist angelegt. Bitte bestätige deine Adresse:\n${url}\n`,
    },
    en: {
      subject: `${config.brand}: confirm your email address`,
      title: 'Almost there',
      body: (name) =>
        `<p>Hi ${name}, your account is created. Confirm this address and you're ready to go.</p>`,
      label: 'Confirm address',
      text: (name, url) =>
        `Hi ${name},\n\nyour ${config.brand} account is created. Please confirm your address:\n${url}\n`,
    },
  },
  reset: {
    de: {
      subject: `${config.brand}: Passwort zurücksetzen`,
      title: 'Neues Passwort setzen',
      body: () =>
        `<p>Jemand hat für dieses Konto ein neues Passwort angefordert. Der Link gilt eine Stunde.
         Warst du das nicht, kannst du diese Nachricht ignorieren – es ändert sich nichts.</p>`,
      label: 'Passwort setzen',
      text: (name, url) => `Neues Passwort für ${config.brand} setzen (gilt eine Stunde):\n${url}\n`,
    },
    en: {
      subject: `${config.brand}: reset your password`,
      title: 'Set a new password',
      body: () =>
        `<p>Someone asked for a new password for this account. The link is valid for one hour.
         If that wasn't you, ignore this message – nothing changes.</p>`,
      label: 'Set password',
      text: (name, url) => `Set a new ${config.brand} password (valid for one hour):\n${url}\n`,
    },
  },
  ticket: {
    de: {
      subject: (id, subject) => `${config.brand}: Antwort auf Ticket #${id} – ${subject}`,
      title: 'Es gibt eine Antwort',
      body: (name) => `<p>Hallo ${name}, auf dein Ticket wurde geantwortet.</p>`,
      label: 'Ticket öffnen',
      text: (name, url) => `Auf dein Ticket wurde geantwortet:\n${url}\n`,
    },
    en: {
      subject: (id, subject) => `${config.brand}: reply to ticket #${id} – ${subject}`,
      title: 'You have a reply',
      body: (name) => `<p>Hi ${name}, your ticket has a reply.</p>`,
      label: 'Open ticket',
      text: (name, url) => `Your ticket has a reply:\n${url}\n`,
    },
  },
};

const lang = (user) => (user?.language === 'en' ? 'en' : 'de');

export function sendVerification(user, token) {
  const t = T.verify[lang(user)];
  const url = `${config.publicUrl}/${lang(user)}/verify?token=${encodeURIComponent(token)}`;
  return send({
    to: user.email,
    subject: t.subject,
    text: t.text(user.username, url),
    html: wrap(t.title, t.body(user.username), { url, label: t.label }),
    kind: 'verify',
  });
}

export function sendReset(user, token) {
  const t = T.reset[lang(user)];
  const url = `${config.publicUrl}/${lang(user)}/reset?token=${encodeURIComponent(token)}`;
  return send({
    to: user.email,
    subject: t.subject,
    text: t.text(user.username, url),
    html: wrap(t.title, t.body(user.username), { url, label: t.label }),
    kind: 'reset',
  });
}

export function sendTicketReply(user, ticket) {
  const t = T.ticket[lang(user)];
  const url = `${config.publicUrl}/${lang(user)}/app#/tickets/${ticket.id}`;
  return send({
    to: user.email,
    subject: t.subject(ticket.id, ticket.subject),
    text: t.text(user.username, url),
    html: wrap(t.title, t.body(user.username), { url, label: t.label }),
    kind: 'ticket',
  });
}
