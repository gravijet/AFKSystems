// Discord-Benachrichtigungen. Wer in den Einstellungen einen Webhook hinterlegt, bekommt Bescheid,
// wenn ein Bot abbricht, ein Konto seine Anmeldung verliert, ein Serverplatz abläuft oder das
// Guthaben knapp wird.
// Bewusst geräuscharm: dieselbe Nachricht kommt höchstens alle 10 Minuten.

import { db } from './db.js';
import { config } from './config.js';
import { formatCredits, formatEuro } from './util.js';

const lastSent = new Map();
const QUIET_MS = 10 * 60 * 1000;

export async function notify(userId, title, text, { key = title, color = 0x206cfe } = {}) {
  const user = db.prepare('SELECT discord_webhook, username FROM users WHERE id = ?').get(userId);
  if (!user?.discord_webhook) return false;

  const mapKey = `${userId}:${key}`;
  const now = Date.now();
  if (now - (lastSent.get(mapKey) || 0) < QUIET_MS) return false;
  lastSent.set(mapKey, now);

  try {
    const response = await fetch(user.discord_webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: config.brand,
        embeds: [
          {
            title,
            description: text,
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
    'Guthaben wird knapp',
    `Noch ${formatCredits(credits)} Credits (${formatEuro(credits)}). Für die nächste Verlängerung könnte es zu wenig sein.`,
    { key: 'low-balance', color: 0xfcbb00 }
  );

export const planRenewed = (userId, name, price) =>
  notify(userId, 'Serverplatz verlängert', `"${name}" läuft weitere 30 Tage. Abgebucht: ${price} Credits.`, {
    key: `renew-${name}`,
    color: 0x00bb7f,
  });

export const planSuspended = (userId, name, reason) =>
  notify(
    userId,
    'Serverplatz stillgelegt',
    reason === 'no-credits'
      ? `"${name}" ließ sich nicht verlängern – das Guthaben reicht nicht. Die Bots sind aus, gelöscht ist nichts.`
      : `"${name}" ist ausgelaufen, weil die Verlängerung abgeschaltet war. Die Bots sind aus.`,
    { key: `suspend-${name}`, color: 0xfb2c36 }
  );

export const planExpiring = (userId, name, days, missing) =>
  notify(
    userId,
    'Serverplatz läuft bald ab',
    missing > 0
      ? `"${name}" wird in ${days} Tag(en) verlängert – es fehlen noch ${missing} Credits.`
      : `"${name}" wird in ${days} Tag(en) automatisch verlängert.`,
    { key: `expire-${name}`, color: missing > 0 ? 0xfcbb00 : 0x206cfe }
  );

export const botTrouble = (userId, name, reason) =>
  notify(userId, `Bot "${name}" hat ein Problem`, reason, { key: `bot-${name}`, color: 0xfb2c36 });
