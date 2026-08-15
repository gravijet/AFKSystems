// E-Mail. Die Zugangsdaten trägt der Administrator im Panel ein, nicht in einer Datei – dadurch
// lässt sich der Versand ein- und ausschalten, ohne den Dienst anzufassen.
//
// Ist kein SMTP hinterlegt, gibt es keine E-Mail-Funktionen: keine Bestätigungspflicht bei der
// Registrierung, kein "Passwort vergessen". Sie werden dann im Frontend gar nicht erst angeboten,
// statt einen Knopf zu zeigen, der ins Leere läuft.
//
// Jede Nachricht gehört zu einer **Kategorie**. Der Kunde stellt in seinen Einstellungen ein,
// welche er bekommen will; der Betreiber kann eine Kategorie für alle abschalten. Zwei Kategorien
// lassen sich nicht abbestellen: was das Konto absichert (Anmeldung, Passwort) und was ohne
// Nachricht gar nicht ginge (Adresse bestätigen, Passwort zurücksetzen).

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

// ---------------------------------------------------------------- Kategorien

export const CATEGORIES = [
  {
    key: 'account',
    locked: true,
    setting: null,
    de: { name: 'Konto', text: 'Adresse bestätigen und Passwort zurücksetzen. Ohne diese Nachrichten geht beides nicht.' },
    en: { name: 'Account', text: 'Confirming your address and resetting your password. Neither works without these.' },
  },
  {
    key: 'security',
    locked: true,
    setting: 'mail_security',
    de: { name: 'Sicherheit', text: 'Anmeldung von einem neuen Gerät, geändertes Passwort, neu verknüpftes Konto.' },
    en: { name: 'Security', text: 'A sign-in from a new device, a changed password, a newly linked account.' },
  },
  {
    key: 'billing',
    locked: false,
    setting: 'mail_topup',
    de: { name: 'Guthaben', text: 'Aufladung gutgeschrieben, Guthaben wird knapp.' },
    en: { name: 'Credits', text: 'A top-up was credited, your balance is running low.' },
  },
  {
    key: 'server',
    locked: false,
    setting: 'mail_renewal',
    de: { name: 'Serverplätze', text: 'Verlängerung, baldiges Ablaufen, Stilllegung.' },
    en: { name: 'Server slots', text: 'Renewals, slots running out soon, suspensions.' },
  },
  {
    key: 'ticket',
    locked: false,
    setting: 'mail_ticket',
    de: { name: 'Support', text: 'Antwort auf ein Ticket, neues Ticket, geschlossenes Ticket.' },
    en: { name: 'Support', text: 'A reply to a ticket, a new ticket, a closed ticket.' },
  },
  {
    key: 'announcement',
    locked: false,
    setting: 'mail_announcement',
    de: { name: 'Ankündigungen', text: 'Wartungsarbeiten, neue Funktionen, Änderungen am Dienst.' },
    en: { name: 'Announcements', text: 'Maintenance, new features, changes to the service.' },
  },
];

export const categoriesFor = (lang = 'de') =>
  CATEGORIES.map((entry) => ({
    key: entry.key,
    locked: entry.locked,
    enabled: Boolean(Number(getSetting(entry.setting ?? 'mail_security') ?? 1)),
    ...entry[lang === 'en' ? 'en' : 'de'],
  }));

/** Die Einstellungen eines Kontos, ergänzt um alles, was noch nicht darinsteht (= an). */
export function prefsOf(user) {
  let stored = {};
  try {
    stored = JSON.parse(user?.mail_prefs || '{}') || {};
  } catch {
    stored = {};
  }
  const out = {};
  for (const entry of CATEGORIES) {
    out[entry.key] = entry.locked ? true : stored[entry.key] !== false;
  }
  return out;
}

/** Will dieser Kunde eine Nachricht dieser Kategorie – und schickt der Betreiber sie überhaupt? */
export function wants(user, category) {
  const entry = CATEGORIES.find((item) => item.key === category);
  if (!entry) return false;
  if (entry.setting && !Number(getSetting(entry.setting) ?? 1)) return false;
  if (entry.locked) return true;
  return prefsOf(user)[category] !== false;
}

// ---------------------------------------------------------------- Versand

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
 * Registrierung oder einer Verlängerung, und die soll nicht an einem stummen Mailserver scheitern.
 *
 * Was verschickt wurde, steht danach in `mails`: der Empfänger kann es in seinen Einstellungen
 * nachlesen. Wer eine Nachricht mit unserem Namen bekommt und sich fragt, ob sie echt war, soll
 * das ohne Rückfrage prüfen können.
 */
export async function send({ to, subject, text, html, kind = 'mail', userId = null }) {
  if (!configured()) return { ok: false, error: 'SMTP ist nicht eingerichtet.' };
  const record = db.prepare(
    `INSERT INTO mails (user_id, recipient, subject, kind, status, error, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  try {
    await transport().sendMail({ from: sender(), to, subject, text, html: html || undefined });
    record.run(userId, to, subject, kind, 'sent', null, String(text || '').slice(0, 4000), Date.now());
    return { ok: true };
  } catch (error) {
    record.run(
      userId,
      to,
      subject,
      kind,
      'failed',
      String(error.message).slice(0, 400),
      String(text || '').slice(0, 4000),
      Date.now()
    );
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

const escape = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const HOST = config.publicUrl.replace(/^https?:\/\//, '');

/**
 * Der Rahmen um jede Nachricht: Logo, Überschrift, Text, ein Knopf. Bewusst schlicht – E-Mail-
 * Programme können weniger als jeder Browser, und eine Nachricht, die überall ankommt, ist mehr
 * wert als eine, die in dreien von zehn zerfällt.
 */
function wrap({ title, body, action, footer }) {
  return `<!doctype html>
<html><body style="margin:0;background:#f2f5f9;padding:32px 16px;
  font:16px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171717">
  <div style="max-width:34rem;margin:0 auto;background:#fff;border-radius:16px;padding:32px">
    <img src="${config.publicUrl}/assets/img/logo-256.png" width="44" height="44" alt="${escape(config.brand)}"
      style="display:block;border:0;margin-bottom:1.25rem">
    <h1 style="font-size:1.35rem;margin:0 0 1rem;letter-spacing:-.02em">${escape(title)}</h1>
    ${body}
    ${
      action
        ? `<p style="margin:1.75rem 0 0"><a href="${action.url}"
             style="display:inline-block;background:#206cfe;color:#fff;text-decoration:none;
             padding:.7rem 1.2rem;border-radius:10px;font-weight:600">${escape(action.label)}</a></p>
           <p style="margin:1.25rem 0 0;font-size:.8125rem;color:#6b7280;word-break:break-all">
             ${escape(action.fallback)}: ${action.url}</p>`
        : ''
    }
  </div>
  <p style="max-width:34rem;margin:1rem auto 0;font-size:.75rem;color:#6b7280;text-align:center">
    ${escape(footer || HOST)}</p>
</body></html>`;
}

const money = (credits, lang) =>
  (Number(credits || 0) / 100).toLocaleString(lang === 'en' ? 'en-GB' : 'de-DE', {
    style: 'currency',
    currency: 'EUR',
  });

/**
 * Alle Vorlagen an einer Stelle. `subject`, `lines` und `action` sind Funktionen der Werte, die
 * der Aufrufer mitgibt – so steht der ganze Text einer Nachricht beisammen und nicht verstreut
 * über die Module, die sie auslösen.
 */
const T = {
  verify: {
    category: 'account',
    de: {
      subject: () => `${config.brand}: E-Mail-Adresse bestätigen`,
      title: () => 'Fast fertig',
      lines: (v) => [
        `Hallo ${v.name}, dein Konto ist angelegt.`,
        'Bestätige noch kurz diese Adresse, dann kann es losgehen.',
      ],
      action: (v) => ({ url: v.url, label: 'Adresse bestätigen' }),
    },
    en: {
      subject: () => `${config.brand}: confirm your email address`,
      title: () => 'Almost there',
      lines: (v) => [`Hi ${v.name}, your account is created.`, "Confirm this address and you're ready to go."],
      action: (v) => ({ url: v.url, label: 'Confirm address' }),
    },
  },

  reset: {
    category: 'account',
    de: {
      subject: () => `${config.brand}: Passwort zurücksetzen`,
      title: () => 'Neues Passwort setzen',
      lines: () => [
        'Jemand hat für dieses Konto ein neues Passwort angefordert. Der Link gilt eine Stunde.',
        'Warst du das nicht, kannst du diese Nachricht ignorieren – es ändert sich nichts.',
      ],
      action: (v) => ({ url: v.url, label: 'Passwort setzen' }),
    },
    en: {
      subject: () => `${config.brand}: reset your password`,
      title: () => 'Set a new password',
      lines: () => [
        'Someone asked for a new password for this account. The link is valid for one hour.',
        "If that wasn't you, ignore this message – nothing changes.",
      ],
      action: (v) => ({ url: v.url, label: 'Set password' }),
    },
  },

  security: {
    category: 'security',
    de: {
      subject: (v) => `${config.brand}: ${v.title}`,
      title: (v) => v.title,
      lines: (v) => [v.text, v.detail ? `Gerät: ${v.detail}` : '', 'Warst du das nicht, ändere sofort dein Passwort.'],
      action: (v) => ({ url: `${v.base}/app#/settings`, label: 'Einstellungen öffnen' }),
    },
    en: {
      subject: (v) => `${config.brand}: ${v.title}`,
      title: (v) => v.title,
      lines: (v) => [v.text, v.detail ? `Device: ${v.detail}` : '', "If that wasn't you, change your password now."],
      action: (v) => ({ url: `${v.base}/app#/settings`, label: 'Open settings' }),
    },
  },

  topup: {
    category: 'billing',
    de: {
      subject: (v) => `${config.brand}: ${v.credits} Credits gutgeschrieben`,
      title: () => 'Guthaben ist da',
      lines: (v) => [
        `Deine Aufladung über ${money(v.amount_cent, 'de')} ist angekommen.`,
        `Gutgeschrieben: <b>${v.credits} Credits</b>. Neuer Stand: <b>${v.balance} Credits</b> (${money(v.balance, 'de')}).`,
      ],
      action: (v) => ({ url: `${v.base}/app#/credits`, label: 'Guthaben ansehen' }),
    },
    en: {
      subject: (v) => `${config.brand}: ${v.credits} credits added`,
      title: () => 'Your credits arrived',
      lines: (v) => [
        `Your top-up of ${money(v.amount_cent, 'en')} came through.`,
        `Added: <b>${v.credits} credits</b>. New balance: <b>${v.balance} credits</b> (${money(v.balance, 'en')}).`,
      ],
      action: (v) => ({ url: `${v.base}/app#/credits`, label: 'View credits' }),
    },
  },

  renewed: {
    category: 'server',
    de: {
      subject: (v) => `${config.brand}: "${v.name}" läuft weitere 30 Tage`,
      title: () => 'Serverplatz verlängert',
      lines: (v) => [
        `"${v.name}" wurde um 30 Tage verlängert.`,
        `Abgebucht: <b>${v.price} Credits</b>. Neuer Stand: ${v.balance} Credits.`,
      ],
      action: (v) => ({ url: `${v.base}/app#/credits`, label: 'Guthaben ansehen' }),
    },
    en: {
      subject: (v) => `${config.brand}: "${v.name}" runs for another 30 days`,
      title: () => 'Server slot renewed',
      lines: (v) => [
        `"${v.name}" was renewed for 30 days.`,
        `Charged: <b>${v.price} credits</b>. New balance: ${v.balance} credits.`,
      ],
      action: (v) => ({ url: `${v.base}/app#/credits`, label: 'View credits' }),
    },
  },

  expiring: {
    category: 'server',
    de: {
      subject: (v) => `${config.brand}: "${v.name}" läuft in ${v.days} Tag(en) ab`,
      title: () => 'Guthaben reicht nicht für die Verlängerung',
      lines: (v) => [
        `"${v.name}" wird in ${v.days} Tag(en) verlängert – dafür fehlen noch <b>${v.missing} Credits</b>.`,
        'Reicht das Guthaben dann nicht, wird der Platz stillgelegt. Gelöscht wird nichts.',
      ],
      action: (v) => ({ url: `${v.base}/app#/credits`, label: 'Guthaben aufladen' }),
    },
    en: {
      subject: (v) => `${config.brand}: "${v.name}" expires in ${v.days} day(s)`,
      title: () => 'Not enough credits for the renewal',
      lines: (v) => [
        `"${v.name}" renews in ${v.days} day(s) and is <b>${v.missing} credits</b> short.`,
        'If the balance does not cover it, the slot is suspended. Nothing is deleted.',
      ],
      action: (v) => ({ url: `${v.base}/app#/credits`, label: 'Top up credits' }),
    },
  },

  suspended: {
    category: 'server',
    de: {
      subject: (v) => `${config.brand}: "${v.name}" ist stillgelegt`,
      title: () => 'Serverplatz stillgelegt',
      lines: (v) => [
        v.reason === 'no-credits'
          ? `"${v.name}" ließ sich nicht verlängern – das Guthaben reichte nicht.`
          : `"${v.name}" ist ausgelaufen, weil die Verlängerung abgeschaltet war.`,
        'Die Bots sind aus, gelöscht wurde nichts. Nach dem Aufladen genügt „Fortsetzen“.',
      ],
      action: (v) => ({ url: `${v.base}/app#/servers/${v.profile_id}/plan`, label: 'Fortsetzen' }),
    },
    en: {
      subject: (v) => `${config.brand}: "${v.name}" is suspended`,
      title: () => 'Server slot suspended',
      lines: (v) => [
        v.reason === 'no-credits'
          ? `"${v.name}" could not be renewed – there were not enough credits.`
          : `"${v.name}" ran out because renewal was switched off.`,
        'The bots are stopped and nothing was deleted. After topping up, just press “Resume”.',
      ],
      action: (v) => ({ url: `${v.base}/app#/servers/${v.profile_id}/plan`, label: 'Resume' }),
    },
  },

  ticket_reply: {
    category: 'ticket',
    de: {
      subject: (v) => `${config.brand}: Antwort auf Ticket #${v.id} – ${v.subject}`,
      title: () => 'Es gibt eine Antwort',
      lines: (v) => [`Auf dein Ticket „${v.subject}“ wurde geantwortet.`, v.preview ? `„${v.preview}“` : ''],
      action: (v) => ({ url: `${v.base}/app#/tickets/${v.id}`, label: 'Ticket öffnen' }),
    },
    en: {
      subject: (v) => `${config.brand}: reply to ticket #${v.id} – ${v.subject}`,
      title: () => 'You have a reply',
      lines: (v) => [`Your ticket “${v.subject}” has a reply.`, v.preview ? `“${v.preview}”` : ''],
      action: (v) => ({ url: `${v.base}/app#/tickets/${v.id}`, label: 'Open ticket' }),
    },
  },

  ticket_opened: {
    category: 'ticket',
    de: {
      subject: (v) => `${config.brand}: Ticket #${v.id} angelegt – ${v.subject}`,
      title: () => 'Dein Ticket ist da',
      lines: (v) => [
        `Wir haben dein Ticket „${v.subject}“ bekommen und melden uns.`,
        v.by ? `Angelegt von ${v.by}.` : '',
      ],
      action: (v) => ({ url: `${v.base}/app#/tickets/${v.id}`, label: 'Ticket öffnen' }),
    },
    en: {
      subject: (v) => `${config.brand}: ticket #${v.id} created – ${v.subject}`,
      title: () => 'Your ticket is in',
      lines: (v) => [`We got your ticket “${v.subject}” and will get back to you.`, v.by ? `Created by ${v.by}.` : ''],
      action: (v) => ({ url: `${v.base}/app#/tickets/${v.id}`, label: 'Open ticket' }),
    },
  },

  ticket_closed: {
    category: 'ticket',
    de: {
      subject: (v) => `${config.brand}: Ticket #${v.id} geschlossen`,
      title: () => 'Ticket geschlossen',
      lines: (v) => [
        `„${v.subject}“ ist erledigt und wurde geschlossen.`,
        'Passt etwas noch nicht? Antworte einfach darauf – das Ticket geht wieder auf.',
      ],
      action: (v) => ({ url: `${v.base}/app#/tickets/${v.id}`, label: 'Ticket öffnen' }),
    },
    en: {
      subject: (v) => `${config.brand}: ticket #${v.id} closed`,
      title: () => 'Ticket closed',
      lines: (v) => [
        `“${v.subject}” is done and has been closed.`,
        'Still not right? Just reply to it – the ticket opens again.',
      ],
      action: (v) => ({ url: `${v.base}/app#/tickets/${v.id}`, label: 'Open ticket' }),
    },
  },

  low_balance: {
    category: 'billing',
    de: {
      subject: () => `${config.brand}: Guthaben wird knapp`,
      title: () => 'Guthaben wird knapp',
      lines: (v) => [
        `Noch <b>${v.balance} Credits</b> (${money(v.balance, 'de')}) auf dem Konto.`,
        `Deine Serverplätze kosten ${v.monthly} Credits im Monat.`,
      ],
      action: (v) => ({ url: `${v.base}/app#/credits`, label: 'Guthaben aufladen' }),
    },
    en: {
      subject: () => `${config.brand}: credits are running low`,
      title: () => 'Credits are running low',
      lines: (v) => [
        `<b>${v.balance} credits</b> (${money(v.balance, 'en')}) left on your account.`,
        `Your server slots cost ${v.monthly} credits a month.`,
      ],
      action: (v) => ({ url: `${v.base}/app#/credits`, label: 'Top up credits' }),
    },
  },

  announcement: {
    category: 'announcement',
    de: {
      subject: (v) => `${config.brand}: ${v.title}`,
      title: (v) => v.title,
      lines: (v) => v.body.split(/\n{2,}/),
      action: (v) => (v.link ? { url: v.link, label: 'Mehr dazu' } : { url: `${v.base}/app`, label: 'Zum Panel' }),
    },
    en: {
      subject: (v) => `${config.brand}: ${v.title}`,
      title: (v) => v.title,
      lines: (v) => v.body.split(/\n{2,}/),
      action: (v) => (v.link ? { url: v.link, label: 'Read more' } : { url: `${v.base}/app`, label: 'Open the panel' }),
    },
  },

  direct: {
    // Eine Nachricht, die ein Administrator von Hand schreibt. Sie gehört zur Kategorie, die er
    // wählt – "security" kommt immer an, "announcement" respektiert die Einstellung des Kunden.
    category: 'announcement',
    de: {
      subject: (v) => v.subject,
      title: (v) => v.subject,
      lines: (v) => v.body.split(/\n{2,}/),
      action: (v) => ({ url: `${v.base}/app`, label: 'Zum Panel' }),
    },
    en: {
      subject: (v) => v.subject,
      title: (v) => v.subject,
      lines: (v) => v.body.split(/\n{2,}/),
      action: (v) => ({ url: `${v.base}/app`, label: 'Open the panel' }),
    },
  },
};

const langOf = (user) => (user?.language === 'en' ? 'en' : 'de');

const FOOT = {
  de: (host) => `${host} · Welche Nachrichten du bekommst, stellst du im Panel unter Einstellungen ein.`,
  en: (host) => `${host} · You choose which messages you get under Settings in the panel.`,
};

const FALLBACK = { de: 'Falls der Knopf nicht geht', en: 'If the button does not work' };

/**
 * Eine Vorlage an einen Kunden schicken. Prüft vorher, ob er diese Kategorie überhaupt will –
 * der Aufrufer muss sich also nicht darum kümmern und kann die Nachricht einfach auslösen.
 */
export async function sendTo(user, kind, vars = {}, { force = false } = {}) {
  const template = T[kind];
  if (!template) return { ok: false, error: `Unbekannte Vorlage "${kind}".` };
  if (!configured()) return { ok: false, error: 'SMTP ist nicht eingerichtet.' };
  const category = vars.category || template.category;
  if (!force && !wants(user, category)) return { ok: false, error: 'abbestellt', skipped: true };

  const lang = langOf(user);
  const shape = template[lang];
  // Die Werte des Aufrufers stehen **hinten**: `name` ist in der Anrede der Benutzername, in
  // einer Nachricht über einen Serverplatz aber dessen Name. Andersherum stand in jeder
  // Verlängerungsmail der Kontoname statt des Servers.
  const values = { base: `${config.publicUrl}/${lang}`, name: user.username, ...vars };
  const lines = shape.lines(values).filter(Boolean);
  const action = shape.action ? shape.action(values) : null;

  const html = wrap({
    title: shape.title(values),
    body: lines.map((line) => `<p style="margin:0 0 .85rem">${line}</p>`).join(''),
    action: action && { ...action, fallback: FALLBACK[lang] },
    footer: FOOT[lang](HOST),
  });
  // Die Nur-Text-Fassung ist kein Beiwerk: sie steht später in den Einstellungen des Kunden als
  // das, was er bekommen hat, und manche Programme zeigen ohnehin nur sie.
  const text = [
    shape.title(values),
    '',
    ...lines.map((line) => line.replace(/<[^>]+>/g, '')),
    action ? `\n${action.label}: ${action.url}` : '',
    `\n${FOOT[lang](HOST)}`,
  ].join('\n');

  return send({ to: user.email, subject: shape.subject(values), text, html, kind, userId: user.id });
}

/** Die letzten Nachrichten an ein Konto – der Kunde sieht sie in seinen Einstellungen. */
export function historyFor(userId, limit = 25) {
  return db
    .prepare(
      `SELECT id, subject, kind, status, created_at FROM mails
        WHERE user_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(userId, limit);
}

export const mailById = (id, userId) =>
  db.prepare('SELECT * FROM mails WHERE id = ? AND user_id = ?').get(id, userId);

// ---------------------------------------------------------------- Kurze Wege

export const sendVerification = (user, token) =>
  sendTo(user, 'verify', {
    url: `${config.publicUrl}/${langOf(user)}/verify?token=${encodeURIComponent(token)}`,
  });

export const sendReset = (user, token) =>
  sendTo(user, 'reset', {
    url: `${config.publicUrl}/${langOf(user)}/reset?token=${encodeURIComponent(token)}`,
  });

export const sendTicketReply = (user, ticket, preview = '') =>
  sendTo(user, 'ticket_reply', { id: ticket.id, subject: ticket.subject, preview: preview.slice(0, 160) });
