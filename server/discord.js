// Discord-Verknüpfung über eine **eigene** Anwendung des Betreibers.
//
// Der Administrator trägt Client-ID und Secret im Panel ein; die Weiterleitungsadresse steht
// unten und muss bei Discord genauso hinterlegt sein. Ohne Zugangsdaten taucht der ganze Bereich
// im Panel nicht auf.
//
// Verknüpft wird nur die Identität (ID, Name, Bild). Für Benachrichtigungen bleibt es beim
// Webhook: eine Direktnachricht bräuchte einen laufenden Bot mit gemeinsamem Server, und den
// setzt hier niemand voraus.

import crypto from 'node:crypto';
import { db, getSetting, audit } from './db.js';
import { config } from './config.js';
import { bad, HttpError } from './util.js';

const AUTHORIZE = 'https://discord.com/api/oauth2/authorize';
const TOKEN = 'https://discord.com/api/oauth2/token';
const ME = 'https://discord.com/api/users/@me';

export const redirectUri = () => `${config.publicUrl}/api/auth/discord/callback`;

export function configured() {
  return Boolean(String(getSetting('discord_client_id') || '').trim() && String(getSetting('discord_client_secret') || '').trim());
}

export const loginEnabled = () => configured() && Boolean(Number(getSetting('discord_login')));

/** Kurzlebige Zustände gegen Rückfragen von fremden Seiten. */
const states = new Map();

function newState(payload) {
  const value = crypto.randomBytes(16).toString('base64url');
  states.set(value, { ...payload, at: Date.now() });
  // Aufräumen, damit die Karte nicht wächst.
  for (const [key, entry] of states) {
    if (Date.now() - entry.at > 10 * 60 * 1000) states.delete(key);
  }
  return value;
}

/** Adresse, auf die der Browser geschickt wird. `mode`: link (verknüpfen) oder login. */
export function startUrl({ mode = 'link', userId = null, lang = 'en' }) {
  if (!configured()) {
    throw bad('Discord ist auf diesem Server nicht eingerichtet.', {
      en: 'Discord is not set up on this server.',
    });
  }
  if (mode === 'login' && !loginEnabled()) {
    throw bad('Anmelden mit Discord ist ausgeschaltet.', { en: 'Signing in with Discord is switched off.' });
  }
  const state = newState({ mode, userId, lang });
  const params = new URLSearchParams({
    client_id: String(getSetting('discord_client_id')),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'identify',
    prompt: 'consent',
    state,
  });
  return `${AUTHORIZE}?${params}`;
}

async function exchange(code) {
  const body = new URLSearchParams({
    client_id: String(getSetting('discord_client_id')),
    client_secret: String(getSetting('discord_client_secret')),
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  });
  const response = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json();
  if (!response.ok) throw bad(`Discord: ${data?.error_description || data?.error || response.status}`);
  return data.access_token;
}

async function identity(accessToken) {
  const response = await fetch(ME, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw bad(`Discord antwortet mit ${response.status}.`, {
      en: `Discord answered with ${response.status}.`,
    });
  }
  const user = await response.json();
  return {
    id: user.id,
    name: user.global_name || user.username,
    avatar: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : null,
  };
}

/**
 * Rückweg von Discord. Gibt zurück, was der Aufrufer tun soll:
 *   { action: 'linked', userId, lang }  – Verknüpfung steht
 *   { action: 'login',  userId, lang }  – anmelden
 */
export async function callback({ code, state }) {
  const entry = state ? states.get(state) : null;
  if (!entry) {
    throw new HttpError(400, 'Die Anfrage ist abgelaufen. Bitte noch einmal versuchen.', {
      en: 'That request has expired. Please try again.',
    });
  }
  states.delete(state);
  const account = await identity(await exchange(code));

  if (entry.mode === 'link') {
    const taken = db.prepare('SELECT id FROM users WHERE discord_id = ? AND id != ?').get(account.id, entry.userId);
    if (taken) {
      throw bad('Dieses Discord-Konto ist schon mit einem anderen Konto verknüpft.', {
        en: 'That Discord account is already linked to someone else.',
      });
    }
    db.prepare(
      'UPDATE users SET discord_id = ?, discord_name = ?, discord_avatar = ? WHERE id = ?'
    ).run(account.id, account.name, account.avatar, entry.userId);
    audit(entry.userId, 'discord-link', { discord: account.id });
    return { action: 'linked', userId: entry.userId, lang: entry.lang, account };
  }

  const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(account.id);
  if (!user) {
    throw bad(
      'Zu diesem Discord-Konto gibt es hier kein Konto. Melde dich einmal normal an und verknüpfe es in den Einstellungen.',
      {
        en: 'No account here belongs to that Discord account. Log in normally once and link it in the settings.',
      }
    );
  }
  if (user.blocked) throw new HttpError(403, 'Dieses Konto ist gesperrt.', { en: 'This account is blocked.' });
  // Namen auffrischen, sie ändern sich bei Discord gern.
  db.prepare('UPDATE users SET discord_name = ?, discord_avatar = ? WHERE id = ?').run(
    account.name,
    account.avatar,
    user.id
  );
  return { action: 'login', userId: user.id, lang: entry.lang, account };
}

export function unlink(userId) {
  db.prepare(
    'UPDATE users SET discord_id = NULL, discord_name = NULL, discord_avatar = NULL WHERE id = ?'
  ).run(userId);
  audit(userId, 'discord-unlink');
}
