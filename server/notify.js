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

const readUser = db.prepare('SELECT discord_webhook, username, language FROM users WHERE id = ?');

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

export async function notify(userId, title, text, { key = null, color = COLORS.info, quiet = QUIET_MS } = {}) {
  const user = readUser.get(userId);
  if (!user?.discord_webhook) return false;
  const lang = 'en';

  const mapKey = `${userId}:${key ?? pick(title, 'de')}`;
  const now = Date.now();
  if (now - (lastSent.get(mapKey) || 0) < quiet) return false;
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

  return post(user.discord_webhook, {
    embeds: [{ title: pick(title, lang), description: pick(text, lang), color }],
  });
}

export const lowBalance = (userId, credits) =>
  notify(
    userId,
    { de: 'Guthaben wird knapp', en: 'Credits are running low' },
    {
      de: `Noch ${formatCredits(credits)} Credits (${formatEuro(credits, 'de')}). Für die nächste Verlängerung könnte es zu wenig sein.`,
      en: `${formatCredits(credits)} credits left (${formatEuro(credits, 'en')}). That may not cover the next renewal.`,
    },
    { key: 'low-balance', color: COLORS.warn, quiet: DAILY_MS }
  );

export const planRenewed = (userId, name, price) =>
  notify(
    userId,
    { de: 'Serverplatz verlängert', en: 'Server slot renewed' },
    {
      de: `"${name}" läuft weitere 30 Tage. Abgebucht: ${price} Credits.`,
      en: `"${name}" runs for another 30 days. ${price} credits were charged.`,
    },
    { key: `renew-${name}`, color: COLORS.ok }
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
    { key: `suspend-${name}`, color: COLORS.bad }
  );

export const planExpiring = (userId, name, days, missing) =>
  notify(
    userId,
    { de: 'Serverplatz läuft bald ab', en: 'Server slot expires soon' },
    {
      de: `"${name}" wird in ${days} Tag(en) verlängert – es fehlen noch ${missing} Credits.`,
      en: `"${name}" renews in ${days} day(s) and is ${missing} credits short.`,
    },
    { key: `expire-${name}`, color: COLORS.warn, quiet: DAILY_MS }
  );

export const botTrouble = (userId, name, reason) =>
  notify(
    userId,
    { de: `Bot "${name}" hat ein Problem`, en: `Bot "${name}" has a problem` },
    {
      de: String(reason || 'Der Client wurde beendet.'),
      en: 'The client stopped unexpectedly. Open the panel for the full reason.',
    },
    { key: `bot-${name}`, color: COLORS.bad }
  );
