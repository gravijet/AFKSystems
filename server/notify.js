// Discord-Benachrichtigungen. Wer im Profil einen Webhook hinterlegt, bekommt Bescheid, wenn ein
// Bot abbricht, ein Konto seine Anmeldung verliert oder das Guthaben knapp wird.
// Bewusst geräuscharm: dieselbe Nachricht kommt höchstens alle 10 Minuten.

import { db } from './db.js';
import { config } from './config.js';
import { formatCredits } from './util.js';

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

export const lowBalance = (userId, mcr, hours) =>
  notify(
    userId,
    'Guthaben wird knapp',
    `Noch ${formatCredits(mcr)} Credits – das reicht etwa ${hours.toFixed(1)} Stunden.`,
    { key: 'low-balance', color: 0xfcbb00 }
  );

export const outOfCredits = (userId) =>
  notify(userId, 'Guthaben aufgebraucht', 'Alle Bots wurden gestoppt. Nach dem Aufladen laufen sie wieder.', {
    key: 'no-credits',
    color: 0xfb2c36,
  });

export const botTrouble = (userId, name, reason) =>
  notify(userId, `Bot "${name}" hat ein Problem`, reason, { key: `bot-${name}`, color: 0xfb2c36 });
