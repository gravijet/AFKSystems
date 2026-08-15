// Discord-Benachrichtigungen. Wer in den Einstellungen einen Webhook hinterlegt, bekommt Bescheid,
// wenn ein Bot abbricht, ein Konto seine Anmeldung verliert, ein Serverplatz abläuft oder das
// Guthaben knapp wird.
//
// Zwei Dinge halten es leise:
//   * jede Nachricht kommt in der Sprache des Kontos, nicht immer auf Deutsch;
//   * gleiche Nachrichten haben eine Sperrzeit. Die Vorgabe von zehn Minuten passt für Ereignisse
//     (ein Bot fliegt raus). Warnungen, die aus dem Stundentakt kommen, setzen sie höher – sonst
//     stünden drei Tage vor Ablauf 72 gleichlautende Nachrichten im Kanal.

import { db } from './db.js';
import { config } from './config.js';
import { formatCredits, formatEuro } from './util.js';

const lastSent = new Map();
const QUIET_MS = 10 * 60 * 1000;
const DAILY_MS = 20 * 60 * 60 * 1000;

const readUser = db.prepare('SELECT discord_webhook, username, language FROM users WHERE id = ?');

/** `text` ist entweder ein Text oder {de, en}. */
const pick = (value, lang) =>
  value && typeof value === 'object' ? value[lang] ?? value.de ?? '' : String(value ?? '');

export async function notify(userId, title, text, { key = null, color = 0x206cfe, quiet = QUIET_MS } = {}) {
  const user = readUser.get(userId);
  if (!user?.discord_webhook) return false;
  const lang = user.language === 'de' ? 'de' : 'en';

  const mapKey = `${userId}:${key ?? pick(title, 'de')}`;
  const now = Date.now();
  if (now - (lastSent.get(mapKey) || 0) < quiet) return false;
  lastSent.set(mapKey, now);

  try {
    const response = await fetch(user.discord_webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: config.brand,
        embeds: [
          {
            title: pick(title, lang),
            description: pick(text, lang),
            color,
            footer: { text: config.publicUrl.replace(/^https?:\/\//, '') },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const lowBalance = (userId, credits) =>
  notify(
    userId,
    { de: 'Guthaben wird knapp', en: 'Credits are running low' },
    {
      de: `Noch ${formatCredits(credits)} Credits (${formatEuro(credits, 'de')}). Für die nächste Verlängerung könnte es zu wenig sein.`,
      en: `${formatCredits(credits)} credits left (${formatEuro(credits, 'en')}). That may not cover the next renewal.`,
    },
    { key: 'low-balance', color: 0xfcbb00, quiet: DAILY_MS }
  );

export const planRenewed = (userId, name, price) =>
  notify(
    userId,
    { de: 'Serverplatz verlängert', en: 'Server slot renewed' },
    {
      de: `"${name}" läuft weitere 30 Tage. Abgebucht: ${price} Credits.`,
      en: `"${name}" runs for another 30 days. ${price} credits were charged.`,
    },
    { key: `renew-${name}`, color: 0x00bb7f }
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
    { key: `suspend-${name}`, color: 0xfb2c36 }
  );

export const planExpiring = (userId, name, days, missing) =>
  notify(
    userId,
    { de: 'Serverplatz läuft bald ab', en: 'Server slot expires soon' },
    {
      de: `"${name}" wird in ${days} Tag(en) verlängert – es fehlen noch ${missing} Credits.`,
      en: `"${name}" renews in ${days} day(s) and is ${missing} credits short.`,
    },
    { key: `expire-${name}`, color: 0xfcbb00, quiet: DAILY_MS }
  );

export const botTrouble = (userId, name, reason) =>
  notify(
    userId,
    { de: `Bot "${name}" hat ein Problem`, en: `Bot "${name}" has a problem` },
    reason,
    { key: `bot-${name}`, color: 0xfb2c36 }
  );
