// Discord-Benachrichtigungen. Wer in den Einstellungen einen Webhook hinterlegt, bekommt Bescheid,
// wenn ein Bot abbricht, ein Konto seine Anmeldung verliert, ein Serverplatz abläuft oder das
// Guthaben knapp wird.
//
// Discord uses English as AFKSystems' primary language. Equal messages have a cooldown; the
// default ten minutes suits events such as a bot disconnecting, while scheduled warnings use a
// longer interval.

import { db, getSetting } from './db.js';
import { config } from './config.js';
import { formatCredits, formatEuro } from './util.js';

const lastSent = new Map();
const QUIET_MS = 10 * 60 * 1000;
const DAILY_MS = 20 * 60 * 60 * 1000;

/**
 * Wie lange dieselbe Meldung zurückgehalten wird – je nach Art.
 *
 * Eine Sperrzeit hat genau einen Zweck: zu verhindern, dass ein Zustand, der alle paar Sekunden
 * neu auffällt, alle paar Sekunden gemeldet wird. Ein Bot, der abbricht und neu startet, ist so
 * ein Fall; **eine Antwort im Ticket ist es nicht.** Sie passiert einmal, sie ist gemeint, und
 * wer sie zehn Minuten später bekommt, hat sie zu spät bekommen.
 *
 * Vorher galt für alles dieselbe Viertelstunde, und Tickets kamen überhaupt nicht an – der
 * Webhook des Kunden wurde für Support gar nicht benutzt, nur für Bots und Guthaben. Deshalb hier
 * eine Tabelle statt einer Zahl: Was ein Ereignis ist, kommt sofort; was ein Zustand ist, wartet.
 */
export const QUIET = {
  /** Ereignisse: passieren einmal und sind dann durch. */
  event: 0,
  /** Zustände, die sich schnell wiederholen können (Bot weg, Konto kaputt). */
  state: QUIET_MS,
  /** Wiederkehrende Warnungen, die sonst stündlich kämen. */
  daily: DAILY_MS,
};

const readUser = db.prepare(
  'SELECT discord_webhook, discord_events, username, language FROM users WHERE id = ?'
);

const insertNotification = db.prepare(
  `INSERT INTO user_notifications
     (user_id, event, tone, title_de, title_en, body_de, body_en, href, dedupe_key, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

/** Die Farbe des Webhooks wird im Panel als ruhiger, semantischer Zustand weiterverwendet. */
const toneOf = (color) => {
  if (color === COLORS.ok) return 'ok';
  if (color === COLORS.warn) return 'warn';
  if (color === COLORS.bad) return 'bad';
  return 'info';
};

/**
 * Ein Ereignis für das Postfach im Panel aufheben.
 *
 * Die Sperrzeit wird zusätzlich in SQLite geprüft. Der Speicher oben ist der schnelle Weg im
 * laufenden Prozess; die Datenbank verhindert, dass ein Neustart aus einer täglichen Warnung
 * plötzlich zwei macht. Je Konto bleiben höchstens 250 Einträge – genug für eine Chronik, ohne
 * aus einer Statusliste ein endlos wachsendes Archiv zu machen.
 */
function remember(userId, title, body, { event, color, url, key, quiet }, now) {
  const dedupeKey = String(key ?? pick(title, 'de')).slice(0, 300);
  if (quiet > 0) {
    const last = db
      .prepare(
        `SELECT created_at FROM user_notifications
          WHERE user_id = ? AND dedupe_key = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId, dedupeKey);
    if (last && now - last.created_at < quiet) return false;
  }
  insertNotification.run(
    userId,
    EVENTS.includes(event) ? event : 'info',
    toneOf(color),
    pick(title, 'de'),
    pick(title, 'en'),
    pick(body, 'de'),
    pick(body, 'en'),
    url || null,
    dedupeKey,
    now
  );
  db.prepare(
    `DELETE FROM user_notifications
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM user_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 250
      )`
  ).run(userId, userId);
  return true;
}

/**
 * Welche Ereignisse ein Kunde über seinen Webhook bekommen will.
 *
 * Gespeichert als Komma-Liste in `users.discord_events`. Leer heißt **alles** – wer einen Webhook
 * einträgt, will Bescheid wissen, und eine Voreinstellung, die nichts schickt, sähe aus wie ein
 * kaputter Webhook. Wer weniger will, hakt es in den Einstellungen ab.
 */
export const EVENTS = ['ticket', 'billing', 'bot', 'account', 'plan'];

/** Gehört diese Art Meldung zu dem, was dieser Kunde bestellt hat? */
function wants(user, event) {
  if (!event) return true;
  const raw = String(user?.discord_events ?? '').trim();
  if (!raw) return true;
  return raw.split(',').map((entry) => entry.trim()).includes(event);
}

/**
 * Wie jede Nachricht von uns in Discord aussieht: derselbe Name, dasselbe Bild, derselbe Fuß.
 *
 * Das steht hier an einer Stelle, weil es sonst an jeder Aufrufstelle einzeln stünde – und dann
 * hieße die eine Hälfte "AFKSystems" und die andere "Captain Hook" mit grauem Fragezeichen.
 */
export const IDENTITY = {
  username: config.brand,
  avatar_url: `${config.publicUrl}/assets/img/logo-256.png`,
};

export const FOOTER = {
  text: config.brand,
  icon_url: IDENTITY.avatar_url,
};

export const COLORS = { info: 0x206cfe, ok: 0x00bb7f, warn: 0xfcbb00, bad: 0xfb2c36 };

/** Eine fertige Nachricht an einen Webhook schicken. Wirft nie. */
export async function post(url, { embeds = [], content = '' } = {}) {
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...IDENTITY,
        content: content || undefined,
        embeds: embeds.map((embed) => ({
          color: COLORS.info,
          footer: FOOTER,
          timestamp: new Date().toISOString(),
          ...embed,
        })),
      }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Eine Meldung ans Team – über den Webhook aus den Einstellungen. */
export const staff = (embed) => post(String(getSetting('discord_staff_webhook') || '').trim(), { embeds: [embed] });

/** `text` ist entweder ein Text oder {de, en}. */
const pick = (value, lang) =>
  value && typeof value === 'object' ? value[lang] ?? value.de ?? '' : String(value ?? '');

/**
 * Eine Meldung an den Webhook eines Kunden.
 *
 * `event` sagt, wozu sie gehört (siehe `EVENTS`) – wer diese Art abbestellt hat, bekommt sie
 * nicht. `quiet` ist die Sperrzeit für **dieselbe** Meldung; für ein einmaliges Ereignis steht
 * dort 0, sonst wäre die zweite Antwort im selben Ticket verschluckt.
 *
 * `url` hängt einen Knopf an die Nachricht. Eine Benachrichtigung, die sagt "es ist etwas
 * passiert", aber nicht, wo, ist eine halbe Nachricht.
 */
export async function notify(
  userId,
  title,
  text,
  { key = null, color = COLORS.info, quiet = QUIET_MS, event = null, url = null } = {}
) {
  const user = readUser.get(userId);
  if (!user) return false;

  const mapKey = `${userId}:${key ?? pick(title, 'de')}`;
  const now = Date.now();
  if (quiet > 0 && now - (lastSent.get(mapKey) || 0) < quiet) return false;
  // Das Postfach im Panel ist unabhängig von Discord: Auch ohne Webhook bleibt die Meldung da.
  // Gibt es sie seit einem Neustart schon in SQLite, beendet `remember` auch den Webhook-Weg –
  // sonst käme dieselbe Warnung zwar nicht zweimal ins Panel, aber trotzdem zweimal nach Discord.
  if (!remember(userId, title, text, { event, color, url, key, quiet }, now)) return false;
  lastSent.set(mapKey, now);
  // Aufräumen, sonst wächst diese Tabelle für immer: Der Schlüssel enthält den Serverplatznamen
  // (und bei der Testnachricht sogar einen Zeitstempel), also entsteht bei jedem umbenannten Platz
  // ein neuer Eintrag, den niemand je wieder liest. Über Monate ist das ein stiller Speicherfraß
  // in einem Dienst, der nicht neu startet.
  if (lastSent.size > 5_000) {
    for (const [entry, at] of lastSent) {
      if (now - at > DAILY_MS) lastSent.delete(entry);
    }
  }

  if (!user.discord_webhook || !wants(user, event)) return false;
  const lang = 'en';

  return post(user.discord_webhook, {
    embeds: [{ title: pick(title, lang), description: pick(text, lang), color, url: url || undefined }],
  });
}

// ---------------------------------------------------------------- Aktivitätszentrale im Panel

/** Absolute Panel-Adressen werden beim Lesen wieder zu einer Route im gerade geöffneten Panel. */
function panelHref(value) {
  const raw = String(value || '');
  const hash = raw.indexOf('#/');
  return hash >= 0 ? raw.slice(hash) : raw;
}

export function unreadFor(userId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ? AND read_at IS NULL')
    .get(userId).n;
}

export function notificationsFor(userId, lang = 'en', { limit = 100, event = '' } = {}) {
  const wanted = EVENTS.includes(event) ? event : '';
  const rows = wanted
    ? db
        .prepare(
          `SELECT * FROM user_notifications
            WHERE user_id = ? AND event = ? ORDER BY created_at DESC LIMIT ?`
        )
        .all(userId, wanted, limit)
    : db
        .prepare(
          'SELECT * FROM user_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
        )
        .all(userId, limit);
  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    tone: row.tone,
    title: lang === 'de' ? row.title_de : row.title_en,
    body: lang === 'de' ? row.body_de : row.body_en,
    href: panelHref(row.href),
    created_at: row.created_at,
    read_at: row.read_at,
  }));
}

export function markRead(userId, ids = null) {
  const now = Date.now();
  if (!ids?.length) {
    return db
      .prepare('UPDATE user_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
      .run(now, userId).changes;
  }
  const clean = [...new Set(ids)].filter(Number.isInteger).slice(0, 100);
  if (!clean.length) return 0;
  const placeholders = clean.map(() => '?').join(',');
  return db
    .prepare(
      `UPDATE user_notifications SET read_at = COALESCE(read_at, ?)
        WHERE user_id = ? AND id IN (${placeholders})`
    )
    .run(now, userId, ...clean).changes;
}

export function removeRead(userId) {
  return db
    .prepare('DELETE FROM user_notifications WHERE user_id = ? AND read_at IS NOT NULL')
    .run(userId).changes;
}

// ---------------------------------------------------------------- Support
//
// Der Webhook des Kunden meldete bisher genau vier Dinge, und alle vier hatten mit Geld oder mit
// einem abgestürzten Bot zu tun. Das Wichtigste fehlte: **die Antwort auf sein Ticket.** Wer eine
// Frage gestellt hat, wartet darauf – und erfuhr davon nur, wenn er von sich aus ins Panel sah
// oder eine E-Mail bekam.
//
// Sperrzeit 0: Jede Antwort ist eine eigene Nachricht. Zwei Antworten hintereinander sind zwei
// Ereignisse und nicht dasselbe Ereignis zweimal.

const ticketUrl = (id) => `${config.publicUrl}/en/app#/tickets/${id}`;

export const ticketReply = (userId, ticket, author, preview) =>
  notify(
    userId,
    { de: `Antwort im Ticket #${ticket.id}`, en: `Reply on ticket #${ticket.id}` },
    {
      de: `**${ticket.subject}**\n${author} hat geantwortet:\n>>> ${String(preview).slice(0, 400)}`,
      en: `**${ticket.subject}**\n${author} replied:\n>>> ${String(preview).slice(0, 400)}`,
    },
    {
      key: `ticket-reply-${ticket.id}-${Date.now()}`,
      color: COLORS.info,
      quiet: QUIET.event,
      event: 'ticket',
      url: ticketUrl(ticket.id),
    }
  );

export const ticketOpened = (userId, ticket) =>
  notify(
    userId,
    { de: `Ticket #${ticket.id} angelegt`, en: `Ticket #${ticket.id} opened` },
    { de: `**${ticket.subject}**\nWir melden uns.`, en: `**${ticket.subject}**\nWe will get back to you.` },
    {
      key: `ticket-open-${ticket.id}`,
      color: COLORS.ok,
      quiet: QUIET.event,
      event: 'ticket',
      url: ticketUrl(ticket.id),
    }
  );

export const ticketClosed = (userId, ticket) =>
  notify(
    userId,
    { de: `Ticket #${ticket.id} geschlossen`, en: `Ticket #${ticket.id} closed` },
    {
      de: `**${ticket.subject}**\nEine neue Antwort macht es wieder auf.`,
      en: `**${ticket.subject}**\nA new reply opens it again.`,
    },
    {
      key: `ticket-closed-${ticket.id}`,
      color: COLORS.info,
      quiet: QUIET.event,
      event: 'ticket',
      url: ticketUrl(ticket.id),
    }
  );

// ---------------------------------------------------------------- Geld

export const topupPaid = (userId, credits, balance) =>
  notify(
    userId,
    { de: 'Guthaben gutgeschrieben', en: 'Credits added' },
    {
      de: `${formatCredits(credits, 'de')} Credits sind da. Neuer Stand: ${formatCredits(balance, 'de')} (${formatEuro(balance, 'de')}).`,
      en: `${formatCredits(credits, 'en')} credits have arrived. New balance: ${formatCredits(balance, 'en')} (${formatEuro(balance, 'en')}).`,
    },
    {
      key: `topup-${credits}-${Date.now()}`,
      color: COLORS.ok,
      quiet: QUIET.event,
      event: 'billing',
      url: `${config.publicUrl}/en/app#/credits`,
    }
  );

// ---------------------------------------------------------------- Konten und Bots

export const accountBroken = (userId, name, reason) =>
  notify(
    userId,
    { de: `Konto "${name}" muss neu verbunden werden`, en: `Account "${name}" needs reconnecting` },
    {
      de: `Die gespeicherte Microsoft-Anmeldung geht nicht mehr.${reason ? `\n${reason}` : ''}`,
      en: `The stored Microsoft sign-in no longer works.${reason ? `\n${reason}` : ''}`,
    },
    {
      key: `account-${name}`,
      color: COLORS.warn,
      quiet: QUIET.state,
      event: 'account',
      url: `${config.publicUrl}/en/app#/accounts`,
    }
  );

export const botOnline = (userId, profile, account) =>
  notify(
    userId,
    { de: `Bot "${account}" ist im Spiel`, en: `Bot "${account}" is in game` },
    { de: `Auf "${profile}".`, en: `On "${profile}".` },
    {
      key: `online-${profile}-${account}`,
      color: COLORS.ok,
      quiet: QUIET.state,
      event: 'bot',
      url: `${config.publicUrl}/en/app#/servers`,
    }
  );

export const lowBalance = (userId, credits) =>
  notify(
    userId,
    { de: 'Guthaben wird knapp', en: 'Credits are running low' },
    {
      de: `Noch ${formatCredits(credits, 'de')} Credits (${formatEuro(credits, 'de')}). Für die nächste Verlängerung könnte es zu wenig sein.`,
      en: `${formatCredits(credits, 'en')} credits left (${formatEuro(credits, 'en')}). That may not cover the next renewal.`,
    },
    {
      key: 'low-balance',
      color: COLORS.warn,
      quiet: QUIET.daily,
      event: 'billing',
      url: `${config.publicUrl}/en/app#/credits`,
    }
  );

export const planRenewed = (userId, name, price) =>
  notify(
    userId,
    { de: 'Serverplatz verlängert', en: 'Server slot renewed' },
    {
      de: `"${name}" läuft weitere 30 Tage. Abgebucht: ${price} Credits.`,
      en: `"${name}" runs for another 30 days. ${price} credits were charged.`,
    },
    {
      key: `renew-${name}`,
      color: COLORS.ok,
      quiet: QUIET.event,
      event: 'plan',
      url: `${config.publicUrl}/en/app#/servers`,
    }
  );

export const planSuspended = (userId, name, reason) =>
  notify(
    userId,
    { de: 'Serverplatz stillgelegt', en: 'Server slot suspended' },
    reason === 'no-credits'
      ? {
          de: `"${name}" ließ sich nicht verlängern – das Guthaben reicht nicht. Die Bots sind aus, gelöscht ist nichts.`,
          en: `"${name}" could not be renewed, there are not enough credits. The bots are stopped, nothing was deleted.`,
        }
      : {
          de: `"${name}" ist ausgelaufen, weil die Verlängerung abgeschaltet war. Die Bots sind aus.`,
          en: `"${name}" ran out because renewal was switched off. The bots are stopped.`,
        },
    {
      key: `suspend-${name}`,
      color: COLORS.bad,
      quiet: QUIET.event,
      event: 'plan',
      url: `${config.publicUrl}/en/app#/servers`,
    }
  );

export const planExpiring = (userId, name, days, missing) =>
  notify(
    userId,
    { de: 'Serverplatz läuft bald ab', en: 'Server slot expires soon' },
    {
      de: `"${name}" wird in ${days} Tag(en) verlängert – es fehlen noch ${missing} Credits.`,
      en: `"${name}" renews in ${days} day(s) and is ${missing} credits short.`,
    },
    {
      key: `expire-${name}`,
      color: COLORS.warn,
      quiet: QUIET.daily,
      event: 'plan',
      url: `${config.publicUrl}/en/app#/servers`,
    }
  );

export const botTrouble = (userId, name, reason) =>
  notify(
    userId,
    { de: `Bot "${name}" hat ein Problem`, en: `Bot "${name}" has a problem` },
    {
      de: String(reason || 'Der Client wurde beendet.'),
      en: 'The client stopped unexpectedly. Open the panel for the full reason.',
    },
    {
      key: `bot-${name}`,
      color: COLORS.bad,
      quiet: QUIET.state,
      event: 'bot',
      url: `${config.publicUrl}/en/app#/servers`,
    }
  );
