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

import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { db, getSetting } from './db.js';
import { config, ROOT } from './config.js';
import * as vat from './vat.js';
import { displayNameOf } from './profile.js';
import { safeUrl } from './util.js';

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
    // Eine Kategorie ohne eigenen Schalter (das Konto: Adresse bestätigen, Passwort zurücksetzen)
    // ist immer an. Vorher stand dort ersatzweise `mail_security` – wer den Sicherheitsversand
    // abschaltete, sah im Panel auch "Konto" als abgeschaltet, obwohl diese Nachrichten weiter
    // gehen und gehen müssen.
    enabled: entry.setting ? Boolean(Number(getSetting(entry.setting) ?? 1)) : true,
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
 * Wohin eine **Antwort** auf unsere Post geht.
 *
 * Auf "Antworten" zu drücken ist das Erste, was jemand tut, der etwas fragen will – und die
 * Absenderadresse ist bei den meisten Einrichtungen ein Postfach, das niemand liest. Steht eine
 * Kontakt-Adresse in den Einstellungen, geht die Antwort dorthin. Ohne Eintrag bleibt es beim
 * Absender: Lieber keine Antwortadresse als eine, die ins Nichts zeigt.
 */
function replyTo() {
  const address = String(getSetting('support_email') || '').trim();
  return /^[^\s<>"@]+@[^\s<>"@]+\.[^\s<>"@]+$/.test(address) ? address : undefined;
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
    await transport().sendMail({
      from: sender(),
      replyTo: replyTo(),
      to,
      subject,
      text,
      html: html || undefined,
      // Nur anhängen, wenn die Nachricht das Logo auch einbindet: eine reine Textnachricht soll
      // nicht mit einem Anhang ankommen, den niemand zu sehen bekommt.
      attachments: logoAttachment(html),
    });
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

/**
 * Das Logo als Anhang, wenn die Nachricht es einbindet.
 *
 * `contentDisposition: 'inline'` ist der Unterschied zwischen "Bild in der Kopfleiste" und
 * "Datei zum Herunterladen am Ende der Nachricht".
 */
function logoAttachment(html) {
  if (!String(html || '').includes(`cid:${LOGO_CID}`)) return undefined;
  return [
    {
      filename: 'afksystems.png',
      path: LOGO_FILE,
      cid: LOGO_CID,
      contentType: 'image/png',
      contentDisposition: 'inline',
    },
  ];
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
 * Das Logo für die Kopfleiste.
 *
 * Es liegt als Anhang bei und wird über `cid:` eingebunden, nicht über eine Adresse. Ein Bild aus
 * dem Netz lädt kein E-Mail-Programm ungefragt: bei Outlook, Thunderbird und der Gmail-App steht
 * dort erst einmal nichts, und wer nicht auf "Bilder anzeigen" klickt, sieht in der Kopfleiste
 * eine leere Fläche. Als Anhang ist es immer da.
 *
 * `logo-mail.png` ist nicht dasselbe wie `logo-256.png`: Es hat seinen dunklen Untergrund fest
 * eingebacken (siehe unten). Fehlt die Datei, bleibt die Adresse als Rückfallweg.
 */
const LOGO_CID = 'afk-logo';
const LOGO_FILE = path.join(ROOT, 'public', 'assets', 'img', 'logo-mail.png');
const LOGO_SRC = fs.existsSync(LOGO_FILE)
  ? `cid:${LOGO_CID}`
  : `${config.publicUrl}/assets/img/logo-256.png`;

/**
 * Der Rahmen um jede Nachricht: Kopfleiste mit Logo, Überschrift, Text, ein Knopf.
 *
 * Bewusst schlicht – E-Mail-Programme können weniger als jeder Browser, und eine Nachricht, die
 * überall ankommt, ist mehr wert als eine, die in dreien von zehn zerfällt. Deshalb Tabellen für
 * das Grundgerüst und keine Datei ohne Ersatzdarstellung.
 *
 * ## Der Dunkelmodus
 *
 * Das Logo ist eine Plakette mit weißer Schrift und hellem Rand. Auf Weiß verschwand die halbe
 * Zeichnung – deshalb stand es schon bisher auf einer dunklen Leiste. Nur hilft das nichts, wenn
 * das E-Mail-Programm selbst umfärbt: Gmail und Outlook drehen im Dunkelmodus die Farben einer
 * Nachricht um, die ihnen nichts anderes sagt. Aus der dunklen Leiste wurde dabei eine helle, und
 * darauf war vom weißen Logo nur noch ein Fleck übrig.
 *
 * Drei Dinge zusammen lösen das, und keines davon allein:
 *
 *  * **Das Logo bringt seinen Untergrund mit.** `logo-mail.png` hat die Farbe der Kopfleiste
 *    deckend eingebacken. Bilder färbt kein Programm um – was auch immer mit der Leiste geschieht,
 *    das Logo sitzt weiter auf seinem eigenen Dunkel.
 *  * **Die Nachricht sagt, dass sie beide Modi kann** (`color-scheme`). Damit hört Gmail auf,
 *    blind umzudrehen, und Apple Mail lässt die Farben ganz in Ruhe.
 *  * **Für den Dunkelmodus stehen eigene Farben da** – als Medienabfrage und zusätzlich über die
 *    Kennzeichen, die Outlook.com an die Elemente hängt (`[data-ogsc]`). Wer beides nicht kann,
 *    bekommt die helle Fassung, die inline an jedem Element steht.
 */
function wrap({ title, body, action, footer }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .m-body { background:#0b0d11 !important; color:#e8ecf3 !important }
    .m-card { background:#151922 !important;
      box-shadow:0 1px 2px rgba(0,0,0,.5),0 12px 32px rgba(0,0,0,.45) !important }
    .m-head { background:#0f1218 !important }
    .m-text, .m-text p { color:#e8ecf3 !important }
    .m-muted { color:#98a3b3 !important }
    .m-btn { background:#3d86ff !important; color:#0b0d11 !important }
  }
  /* Outlook.com benennt die Farben nicht um, sondern hängt diese Kennzeichen an. */
  [data-ogsc] .m-body { background:#0b0d11 !important; color:#e8ecf3 !important }
  [data-ogsc] .m-card { background:#151922 !important }
  [data-ogsc] .m-head { background:#0f1218 !important }
  [data-ogsc] .m-text, [data-ogsc] .m-text p { color:#e8ecf3 !important }
  [data-ogsc] .m-muted { color:#98a3b3 !important }
  [data-ogsc] .m-btn { background:#3d86ff !important; color:#0b0d11 !important }
</style></head>
<body class="m-body" style="margin:0;background:#eef1f6;padding:32px 16px;
  font:17px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#15181d;
  -webkit-font-smoothing:antialiased">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="m-card"
    style="max-width:40rem;margin:0 auto;border-collapse:separate;border-spacing:0;
    background:#ffffff;border-radius:18px;overflow:hidden;
    box-shadow:0 1px 2px rgba(15,23,42,.06),0 12px 32px rgba(15,23,42,.08)">
    <tr>
      <td class="m-head" style="background:#12151b;padding:22px 36px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle;padding-right:14px;line-height:0">
              <img src="${LOGO_SRC}" width="56" height="56" alt="${escape(config.brand)}"
                style="display:block;border:0;width:56px;height:56px">
            </td>
            <td style="vertical-align:middle;color:#ffffff;font-size:1.05rem;font-weight:700;
              letter-spacing:-.01em">${escape(config.brand)}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td class="m-text" style="padding:36px;color:#15181d">
        <h1 style="font-size:1.6rem;line-height:1.25;margin:0 0 1.1rem;letter-spacing:-.02em;
          font-weight:700;color:inherit">${escape(title)}</h1>
        ${body}
        ${
          action
            ? `<p style="margin:2rem 0 0"><a href="${escape(action.url)}" class="m-btn"
                 style="display:inline-block;background:#206cfe;color:#ffffff;text-decoration:none;
                 padding:.85rem 1.5rem;border-radius:12px;font-weight:600;font-size:1rem">${escape(
                   action.label
                 )}</a></p>
               <p class="m-muted" style="margin:1.4rem 0 0;font-size:.85rem;line-height:1.5;color:#5b6472;
                 word-break:break-all">${escape(action.fallback)}: ${escape(action.url)}</p>`
            : ''
        }
      </td>
    </tr>
  </table>
  <p class="m-muted" style="max-width:40rem;margin:1.25rem auto 0;font-size:.8125rem;color:#5b6472;text-align:center">
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

  // Die Bestätigung an die **neue** Adresse. Sie gehört zur Kategorie "Konto" und damit zu dem,
  // was sich nicht abbestellen lässt: Ohne diese Nachricht ließe sich die Adresse gar nicht
  // wechseln, und wer sie abbestellt hätte, säße bei jedem Umzug fest.
  email_change: {
    category: 'account',
    de: {
      subject: () => `${config.brand}: neue E-Mail-Adresse bestätigen`,
      title: () => 'Neue Adresse bestätigen',
      lines: (v) => [
        `Für dein Konto <b>${v.name}</b> wurde diese Adresse als neue E-Mail-Adresse eingetragen.`,
        'Bestätige sie hier – bis dahin bleibt die alte Adresse in Kraft. Der Link gilt einen Tag.',
        'Hast du das nicht beantragt, brauchst du nichts zu tun: Ohne Bestätigung ändert sich nichts.',
      ],
      action: (v) => ({ url: v.url, label: 'Adresse bestätigen' }),
    },
    en: {
      subject: () => `${config.brand}: confirm your new email address`,
      title: () => 'Confirm the new address',
      lines: (v) => [
        `This address was entered as the new email address for your account <b>${v.name}</b>.`,
        'Confirm it here – until then the old address stays in charge. The link is valid for one day.',
        'If you did not ask for this, do nothing: without a confirmation nothing changes.',
      ],
      action: (v) => ({ url: v.url, label: 'Confirm address' }),
    },
  },

  // Konto löschen: der Termin steht, und bis dahin genügt ein Knopf. Die Nachricht ist die
  // einzige Stelle, an der die Frist steht, wenn jemand sich danach nicht mehr anmeldet.
  account_delete: {
    category: 'account',
    de: {
      subject: () => `${config.brand}: Konto wird gelöscht`,
      title: () => 'Dein Konto ist zur Löschung vorgemerkt',
      lines: (v) => [
        `Am <b>${v.due}</b> werden dein Konto und alles daran gelöscht: Serverplätze, Minecraft-Konten, Tickets, Guthaben.`,
        'Bis dahin sind die Bots aus, aber nichts ist weg. Ein Klick im Panel holt alles zurück.',
        v.credits > 0
          ? `Achtung: Auf dem Konto liegen noch <b>${v.credits} Credits</b>. Sie verfallen mit der Löschung.`
          : '',
      ],
      action: (v) => ({ url: `${v.base}/app#/settings`, label: 'Löschung widerrufen' }),
    },
    en: {
      subject: () => `${config.brand}: your account is scheduled for deletion`,
      title: () => 'Your account is scheduled for deletion',
      lines: (v) => [
        `On <b>${v.due}</b> your account and everything on it will be deleted: server slots, Minecraft accounts, tickets, credits.`,
        'Until then the bots are off, but nothing is gone. One click in the panel brings it all back.',
        v.credits > 0
          ? `Note: there are still <b>${v.credits} credits</b> on the account. They expire with the deletion.`
          : '',
      ],
      action: (v) => ({ url: `${v.base}/app#/settings`, label: 'Cancel the deletion' }),
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

  // **Der Anmeldecode.** Die einzige Vorlage, in der der Inhalt selbst der Schlüssel ist – überall
  // sonst steht hier ein Link oder eine Auskunft. Deshalb drei Dinge anders als sonst:
  //
  //   * Der Code steht groß und für sich, mit Abstand zwischen den Ziffern. Er wird abgetippt,
  //     oft von einem Telefon auf einen Rechner, und Ziffern in einer Reihe verliest man.
  //   * Es gibt **keinen Knopf**. Ein Link in einer Nachricht, die den Zugang enthält, ist genau
  //     das, was Phishing nachbaut – wer gelernt hat, hier nicht zu klicken, ist besser dran.
  //   * Gerät und Adresse stehen dabei. Wer diese Nachricht bekommt, ohne sich anzumelden, soll
  //     sofort sehen, dass jemand anderes sein Passwort kennt.
  login_code: {
    category: 'security',
    de: {
      subject: (v) => `${v.code} ist dein Anmeldecode für ${config.brand}`,
      title: () => 'Dein Anmeldecode',
      lines: (v) => [
        `<b style="font-size:2rem;letter-spacing:.35em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${v.code}</b>`,
        `Der Code gilt ${v.minutes} Minuten und nur für diese eine Anmeldung.`,
        [v.device, v.ip].filter(Boolean).length
          ? `Angefragt von: ${[v.device, v.ip].filter(Boolean).join(' · ')}`
          : '',
        'Hast du dich gerade nicht angemeldet, ändere bitte sofort dein Passwort – jemand anderes kennt es.',
      ],
      action: () => null,
    },
    en: {
      subject: (v) => `${v.code} is your ${config.brand} sign-in code`,
      title: () => 'Your sign-in code',
      lines: (v) => [
        `<b style="font-size:2rem;letter-spacing:.35em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${v.code}</b>`,
        `The code is valid for ${v.minutes} minutes and for this one sign-in only.`,
        [v.device, v.ip].filter(Boolean).length
          ? `Requested from: ${[v.device, v.ip].filter(Boolean).join(' · ')}`
          : '',
        "If you did not just sign in, change your password right away – somebody else knows it.",
      ],
      action: () => null,
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

  // Diese Nachricht ist der **Beleg** über die Aufladung – deshalb steht darin, was auf einen
  // Beleg gehört: Leistung, Betrag und wie es um die Umsatzsteuer steht. Der Satz dazu kommt aus
  // `vat.js` und ist derselbe wie auf der Preisseite und an der Kasse. Bei der
  // Kleinunternehmerregelung wird ausdrücklich **keine** Steuer ausgewiesen: Wer sie irrtümlich
  // ausweist, schuldet sie allein aufgrund der Rechnung.
  topup: {
    category: 'billing',
    de: {
      subject: (v) => `${config.brand}: Beleg über ${money(v.amount_cent, 'de')}`,
      title: () => 'Guthaben ist da',
      lines: (v) => [
        `Deine Aufladung über ${money(v.amount_cent, 'de')} ist angekommen.`,
        `Leistung: <b>${v.credits} Credits</b> Guthaben bei ${config.brand}.`,
        `Gesamtbetrag: <b>${money(v.amount_cent, 'de')}</b>`,
        vat.note('de'),
        `Neuer Stand: <b>${v.balance} Credits</b> (${money(v.balance, 'de')}).`,
      ],
      action: (v) => ({ url: `${v.base}/app#/credits`, label: 'Guthaben ansehen' }),
    },
    en: {
      subject: (v) => `${config.brand}: receipt for ${money(v.amount_cent, 'en')}`,
      title: () => 'Your credits arrived',
      lines: (v) => [
        `Your top-up of ${money(v.amount_cent, 'en')} came through.`,
        `Item: <b>${v.credits} credits</b> of ${config.brand} balance.`,
        `Total: <b>${money(v.amount_cent, 'en')}</b>`,
        vat.note('en'),
        `New balance: <b>${v.balance} credits</b> (${money(v.balance, 'en')}).`,
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
 * Eine Vorlage ausfüllen: Betreff, Nur-Text-Fassung und HTML.
 *
 * Getrennt vom Verschicken, weil beides verschiedene Fragen sind. "Steht der richtige Name in der
 * Verlängerungsmail?" und "kommt Kundentext geschützt ins HTML?" lassen sich so beantworten, ohne
 * einen Mailserver zu brauchen – und beim Verschicken bleibt nur noch das Verschicken.
 */
export function render(user, kind, vars = {}) {
  const template = T[kind];
  if (!template) return null;
  const lang = langOf(user);
  const shape = template[lang];
  // Die Werte des Aufrufers stehen **hinten**: `name` ist in der Anrede der Benutzername, in
  // einer Nachricht über einen Serverplatz aber dessen Name. Andersherum stand in jeder
  // Verlängerungsmail der Kontoname statt des Servers.
  const values = { base: `${config.publicUrl}/${lang}`, name: displayNameOf(user), ...vars };

  // Die Vorlagen bauen ihre Zeilen absichtlich mit ein wenig HTML (`<b>` um Beträge). Was aber
  // von außen kommt – ein Ticketbetreff, ein Serverplatzname, der Textausschnitt einer Antwort –
  // ging bisher ungeprüft mit hinein. Damit ließ sich in eine Nachricht **von uns** alles
  // schreiben, was HTML hergibt, bis hin zu einem Link, der woanders hinführt, als er behauptet.
  //
  // Deshalb zwei Durchläufe: einmal mit geschützten Werten für die HTML-Fassung, einmal mit den
  // rohen für die Textfassung. Die Vorlage selbst bleibt dieselbe und darf ihre Auszeichnungen
  // behalten – geschützt wird, was eingesetzt wird.
  const safe = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? escape(value) : value])
  );
  const lines = shape.lines(safe).filter(Boolean);
  const plainLines = shape.lines(values).filter(Boolean);
  // Titel und Betreff gehen roh weiter – `wrap` schützt den Titel selbst.
  //
  // Die **Adresse** ging bisher ebenfalls roh ins `href`, und das war eine Lücke mit zwei Seiten:
  // Der Knopf einer Ankündigung nimmt seine Adresse aus den Einstellungen, und ein
  // Anführungszeichen darin brach aus dem Attribut aus, ein `javascript:` davor brauchte nicht
  // einmal das. Beides steht danach in einer E-Mail **von uns**, mit unserem Logo darüber. Also:
  // nur http(s), und maskiert eingesetzt.
  const raw = shape.action ? shape.action(values) : null;
  const action = raw && safeUrl(raw.url) ? { ...raw, url: safeUrl(raw.url) } : null;

  const html = wrap({
    title: shape.title(values),
    body: lines.map((line) => `<p style="margin:0 0 1.05rem;line-height:1.6">${line}</p>`).join(''),
    action: action && { ...action, fallback: FALLBACK[lang] },
    footer: FOOT[lang](HOST),
  });
  // Die Nur-Text-Fassung ist kein Beiwerk: sie steht später in den Einstellungen des Kunden als
  // das, was er bekommen hat, und manche Programme zeigen ohnehin nur sie.
  const text = [
    shape.title(values),
    '',
    // Nur die Auszeichnung der Vorlage entfernen, nicht alles zwischen spitzen Klammern: Ein
    // Ticketbetreff wie "<urgent> Server weg" verlor sonst genau das Wort, um das es ging. Die
    // Vorlagen benutzen ausschließlich <b>, mit oder ohne Attribute (der Anmeldecode steht in
    // einem großgesetzten); käme eine andere Auszeichnung hinzu, stünde sie sichtbar in der
    // Textfassung – und das ist besser, als sie stillschweigend mitsamt Kundentext zu schlucken.
    ...plainLines.map((line) => line.replace(/<\/?b(?:\s[^>]*)?>/g, '')),
    action ? `\n${action.label}: ${action.url}` : '',
    `\n${FOOT[lang](HOST)}`,
  ].join('\n');

  // Der Betreff geht als Kopfzeile hinaus, und in ihm steckt Kundentext (ein Ticketbetreff, der
  // Name eines Serverplatzes). Zeilenumbrüche haben dort nichts verloren: eine Kopfzeile endet an
  // genau der Stelle, und was danach steht, wäre eine weitere – geschrieben von dem, der den
  // Betreff getippt hat.
  const subject = String(shape.subject(values)).replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  return { subject, text, html };
}

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
  // **Wirft nie.** Fast jeder Aufruf steht mitten in etwas anderem – einer Verlängerung im
  // Stundentakt, einem Passwortwechsel, einer Ticketantwort – und wartet das Ergebnis nicht ab.
  // Eine geworfene Ausnahme wäre dort eine unbehandelte Zurückweisung, und die beendet in Node den
  // ganzen Prozess: eine Vorlage mit einem fehlenden Feld hätte jeden laufenden Bot mitgenommen.
  try {
    const { subject, text, html } = render(user, kind, vars);
    return await send({ to: user.email, subject, text, html, kind, userId: user.id });
  } catch (error) {
    console.error(`[mail] Vorlage "${kind}" ließ sich nicht bauen:`, error);
    return { ok: false, error: error.message };
  }
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
