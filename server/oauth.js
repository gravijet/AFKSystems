// Anmelden und Verknüpfen über fremde Konten: Discord und Google.
//
// Beide funktionieren gleich – eine Anwendung des Betreibers, eine Weiterleitung, ein Code, der
// gegen ein Token getauscht wird, und am Ende eine Identität aus ID, Name und E-Mail-Adresse.
// Deshalb steht hier ein Anbieter-Verzeichnis statt zweier fast gleicher Dateien.
//
// Zugangsdaten trägt der Administrator im Panel ein. Ohne sie taucht der ganze Bereich nicht auf,
// statt einen Knopf zu zeigen, der in eine Fehlerseite läuft.
//
// Was verknüpft wird, ist nur die Identität. Ein Passwort sieht AFKSystems nie – weder das von
// Discord noch das von Google, und bei Minecraft ebenso wenig.

import crypto from 'node:crypto';
import { db, getSetting, audit } from './db.js';
import { config } from './config.js';
import { bad, HttpError, hashPassword, token as randomToken } from './util.js';
import * as mail from './mail.js';
import { grant, freeGuildId } from './billing.js';
import { bridge } from './bridge.js';

// ---------------------------------------------------------------- Anbieter

export const PROVIDERS = {
  discord: {
    key: 'discord',
    label: 'Discord',
    authorize: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    me: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    extra: { prompt: 'consent' },
    columns: { id: 'discord_id', name: 'discord_name', avatar: 'discord_avatar', email: null },
    settings: { id: 'discord_client_id', secret: 'discord_client_secret', login: 'discord_login' },
    identify: (raw) => ({
      id: raw.id,
      name: raw.global_name || raw.username,
      email: raw.verified ? (raw.email || '').toLowerCase() : '',
      avatar: raw.avatar ? `https://cdn.discordapp.com/avatars/${raw.id}/${raw.avatar}.png?size=64` : null,
    }),
  },
  google: {
    key: 'google',
    label: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    me: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    // Ohne "consent" bekommt man beim zweiten Mal keine Zustimmungsseite mehr zu sehen; das ist
    // hier gewollt, weil nur Name und Adresse gelesen werden.
    extra: { access_type: 'online', prompt: 'select_account' },
    columns: { id: 'google_id', name: null, avatar: null, email: 'google_email' },
    settings: { id: 'google_client_id', secret: 'google_client_secret', login: 'google_login' },
    identify: (raw) => ({
      id: raw.sub,
      name: raw.name || raw.email,
      email: raw.email_verified ? String(raw.email || '').toLowerCase() : '',
      avatar: raw.picture || null,
    }),
  },
};

const provider = (key) => {
  const entry = PROVIDERS[key];
  if (!entry) throw bad('Unbekannter Anbieter.', { en: 'Unknown provider.' });
  return entry;
};

export const redirectUri = (key) => `${config.publicUrl}/api/auth/${key}/callback`;

export function configured(key) {
  const entry = provider(key);
  return Boolean(
    String(getSetting(entry.settings.id) || '').trim() &&
      String(getSetting(entry.settings.secret) || '').trim()
  );
}

export const loginEnabled = (key) =>
  configured(key) && Boolean(Number(getSetting(provider(key).settings.login)));

/** Was das Frontend über die Anbieter wissen muss. */
export const state = () =>
  Object.fromEntries(
    Object.keys(PROVIDERS).map((key) => [
      key,
      { available: configured(key), login: loginEnabled(key), redirect: redirectUri(key) },
    ])
  );

// ---------------------------------------------------------------- Ablauf

/** Kurzlebige Zustände gegen Rückfragen von fremden Seiten. */
const states = new Map();

function newState(payload) {
  const value = crypto.randomBytes(16).toString('base64url');
  states.set(value, { ...payload, at: Date.now() });
  for (const [key, entry] of states) {
    if (Date.now() - entry.at > 10 * 60 * 1000) states.delete(key);
  }
  return value;
}

/**
 * Adresse, auf die der Browser geschickt wird.
 * `mode`: link (verknüpfen), login (anmelden oder anlegen), verify (Discord-Linked-Roles).
 */
export function startUrl(key, { mode = 'link', userId = null, lang = 'en', next = '' } = {}) {
  const entry = provider(key);
  if (!configured(key)) {
    throw bad(`${entry.label} ist auf diesem Server nicht eingerichtet.`, {
      en: `${entry.label} is not set up on this server.`,
    });
  }
  if (mode === 'login' && !loginEnabled(key)) {
    throw bad(`Anmelden mit ${entry.label} ist ausgeschaltet.`, {
      en: `Signing in with ${entry.label} is switched off.`,
    });
  }
  if (mode === 'verify') {
    if (key !== 'discord') {
      throw bad('Linked Roles gibt es nur für Discord.', { en: 'Linked Roles are only available for Discord.' });
    }
    const user = db
      .prepare('SELECT role, discord_moderator, discord_id FROM users WHERE id = ?')
      .get(userId);
    if (!user || (user.role !== 'admin' && !user.discord_moderator)) {
      throw new HttpError(403, 'Linked Roles sind nur für Administratoren und Discord-Moderatoren.', {
        en: 'Linked Roles are only available to administrators and Discord moderators.',
      });
    }
    if (!user.discord_id) {
      throw new HttpError(409, 'Verknüpfe zuerst dein Discord-Konto.', {
        en: 'Link your Discord account first.',
      });
    }
  }
  const params = new URLSearchParams({
    client_id: String(getSetting(entry.settings.id)),
    redirect_uri: redirectUri(key),
    response_type: 'code',
    scope: mode === 'verify' ? 'identify role_connections.write' : entry.scope,
    state: newState({ provider: key, mode, userId, lang, next }),
    ...entry.extra,
  });
  return `${entry.authorize}?${params}`;
}

async function exchange(entry, code) {
  const body = new URLSearchParams({
    client_id: String(getSetting(entry.settings.id)),
    client_secret: String(getSetting(entry.settings.secret)),
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(entry.key),
  });
  const response = await fetch(entry.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw bad(`${entry.label}: ${data?.error_description || data?.error || response.status}`);
  }
  return data.access_token;
}

async function identity(entry, accessToken) {
  const response = await fetch(entry.me, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw bad(`${entry.label} antwortet mit ${response.status}.`, {
      en: `${entry.label} answered with ${response.status}.`,
    });
  }
  return entry.identify(await response.json());
}

/**
 * Rückweg vom Anbieter. Gibt zurück, was der Aufrufer tun soll:
 *   { action: 'linked',   userId, lang }  – Verknüpfung steht
 *   { action: 'login',    userId, lang }  – anmelden
 *   { action: 'created',  userId, lang }  – Konto wurde gerade angelegt
 *   { action: 'verified', userId, lang }  – Discord-Linked-Roles geschrieben
 */
export async function callback({ code, state: value }) {
  const entry = value ? states.get(value) : null;
  if (!entry) {
    throw new HttpError(400, 'Die Anfrage ist abgelaufen. Bitte noch einmal versuchen.', {
      en: 'That request has expired. Please try again.',
    });
  }
  states.delete(value);
  const which = provider(entry.provider);
  const accessToken = await exchange(which, code);

  if (entry.mode === 'verify') {
    const account = await identity(which, accessToken);
    const user = db.prepare('SELECT discord_id FROM users WHERE id = ?').get(entry.userId);
    if (!user?.discord_id || String(user.discord_id) !== String(account.id)) {
      throw new HttpError(
        403,
        'Bestätige bitte dasselbe Discord-Konto, das im Panel verknüpft ist.',
        { en: 'Please authorize the same Discord account that is linked in the panel.' }
      );
    }
    await writeRoleConnection(accessToken, entry.userId);
    return { action: 'verified', userId: entry.userId, lang: entry.lang, provider: which.key };
  }

  const account = await identity(which, accessToken);
  const columns = which.columns;

  if (entry.mode === 'link') {
    const taken = db
      .prepare(`SELECT id FROM users WHERE ${columns.id} = ? AND id != ?`)
      .get(account.id, entry.userId);
    if (taken) {
      throw bad(`Dieses ${which.label}-Konto ist schon mit einem anderen Konto verknüpft.`, {
        en: `That ${which.label} account is already linked to someone else.`,
      });
    }
    writeIdentity(entry.userId, which, account);
    audit(entry.userId, `${which.key}-link`, { external: account.id });
    // Der Bot vergibt die Rolle für "Konto verknüpft" – und die soll sofort da sein.
    if (which.key === 'discord') {
      await refreshDiscordMembership(entry.userId, account.id);
      bridge.emit('roles.changed', { discord_id: account.id, user_id: entry.userId });
    }
    notifySecurity(entry.userId, {
      de: `${which.label}-Konto verknüpft`,
      en: `${which.label} account linked`,
      detail: account.name,
    });
    return { action: 'linked', userId: entry.userId, lang: entry.lang, account, provider: which.key };
  }

  // Anmelden. Gibt es zu dieser Identität schon ein Konto, ist alles klar.
  let user = db.prepare(`SELECT * FROM users WHERE ${columns.id} = ?`).get(account.id);
  let created = false;

  if (!user && account.email) {
    // Gleiche Adresse, aber noch nicht verknüpft: das ist derselbe Mensch – also verknüpfen statt
    // ein zweites Konto anzulegen, das er nie wieder findet.
    const byMail = db.prepare('SELECT * FROM users WHERE email = ?').get(account.email);
    if (byMail) {
      writeIdentity(byMail.id, which, account);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(byMail.id);
      audit(user.id, `${which.key}-link`, { external: account.id, via: 'login' });
    }
  }

  if (!user) {
    if (!account.email) {
      throw bad(
        `${which.label} hat keine bestätigte E-Mail-Adresse mitgeschickt. Lege bitte ein Konto mit E-Mail an und verknüpfe ${which.label} danach in den Einstellungen.`,
        {
          en: `${which.label} did not send a confirmed email address. Please create an account with an email and link ${which.label} in the settings afterwards.`,
        }
      );
    }
    // Hier entsteht ein neues Konto – also gilt dasselbe wie im Formular: ist die Registrierung
    // zu, entsteht keines. Ohne diese Prüfung war "Registrierung offen: aus" eine Tür, die nur
    // vorne verschlossen war.
    if (!Number(getSetting('registration_open')) || !config.registrationOpen) {
      throw bad('Neue Konten sind gerade nicht möglich.', {
        en: 'New accounts are closed at the moment.',
      });
    }
    user = createFromIdentity(which, account, entry.lang);
    created = true;
  }

  if (user.blocked) {
    throw new HttpError(403, 'Dieses Konto ist gesperrt.', { en: 'This account is blocked.' });
  }
  // Namen auffrischen, sie ändern sich gern.
  writeIdentity(user.id, which, account);
  if (which.key === 'discord') {
    await refreshDiscordMembership(user.id, account.id);
    bridge.emit('roles.changed', { discord_id: account.id, user_id: user.id });
  }
  return {
    action: created ? 'created' : 'login',
    userId: user.id,
    lang: entry.lang,
    account,
    provider: which.key,
  };
}

function writeIdentity(userId, which, account) {
  const columns = which.columns;
  const set = [`${columns.id} = ?`];
  const values = [account.id];
  if (columns.name) {
    set.push(`${columns.name} = ?`);
    values.push(account.name);
  }
  if (columns.avatar) {
    set.push(`${columns.avatar} = ?`);
    values.push(account.avatar);
  }
  if (columns.email) {
    set.push(`${columns.email} = ?`);
    values.push(account.email || null);
  }
  values.push(userId);
  db.prepare(`UPDATE users SET ${set.join(', ')} WHERE id = ?`).run(...values);
}

/** Aus einer fremden Identität ein Konto machen. Der Benutzername wird eindeutig gemacht. */
function createFromIdentity(which, account, lang) {
  const base =
    String(account.name || account.email.split('@')[0])
      .replace(/[^a-zA-Z0-9_.-]/g, '')
      .slice(0, 20) || which.key;
  let username = base.length >= 3 ? base : `${base}-user`;
  let suffix = 1;
  while (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
    username = `${base}${++suffix}`;
  }

  // Es gibt kein Passwort – wer eines will, setzt es über "Passwort vergessen". Der gespeicherte
  // Hash ist deshalb der eines Zufallswerts, den niemand kennt, und kein leeres Feld: sonst wäre
  // die Prüfung eine Frage der Auslegung statt ein klares Nein.
  const info = db
    .prepare(
      `INSERT INTO users (email, username, password_hash, role, language, email_verified, created_at)
       VALUES (?, ?, ?, 'user', ?, 1, ?)`
    )
    .run(account.email, username, hashPassword(randomToken(32)), lang === 'de' ? 'de' : 'en', Date.now());
  writeIdentity(info.lastInsertRowid, which, account);
  // Das Startguthaben gilt für jedes neue Konto, egal auf welchem Weg es entstanden ist. Vorher
  // bekam es nur, wer sich über das Formular anmeldete.
  const bonus = Number(getSetting('signup_bonus')) || 0;
  if (bonus > 0) grant(info.lastInsertRowid, bonus, 'bonus', 'Startguthaben');
  audit(info.lastInsertRowid, 'register', { via: which.key });
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

export function unlink(key, userId) {
  const which = provider(key);
  const columns = which.columns;
  const before =
    which.key === 'discord'
      ? db.prepare('SELECT discord_id FROM users WHERE id = ?').get(userId)
      : null;
  const set = [`${columns.id} = NULL`];
  const values = [];
  if (columns.name) set.push(`${columns.name} = NULL`);
  if (columns.avatar) set.push(`${columns.avatar} = NULL`);
  if (columns.email) set.push(`${columns.email} = NULL`);
  if (which.key === 'discord') {
    set.push('discord_guild_member = 0');
    set.push('discord_guild_checked_at = ?');
  }
  if (which.key === 'discord') values.push(Date.now());
  values.push(userId);
  db.prepare(`UPDATE users SET ${set.join(', ')} WHERE id = ?`).run(...values);
  if (before?.discord_id) {
    bridge.emit('roles.changed', { discord_id: before.discord_id, user_id: userId });
  }
  audit(userId, `${which.key}-unlink`);
  notifySecurity(userId, {
    de: `${which.label}-Konto getrennt`,
    en: `${which.label} account unlinked`,
    detail: '',
  });
}

function notifySecurity(userId, { de, en, detail }) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return;
  mail.sendTo(user, 'security', {
    title: user.language === 'en' ? en : de,
    text:
      user.language === 'en'
        ? 'A linked account on your profile has changed.'
        : 'An deinem Konto hat sich eine Verknüpfung geändert.',
    detail,
  });
}

// ---------------------------------------------------------------- Discord-Mitgliedschaft und Linked Roles

/**
 * Die Mitgliedschaft direkt über den Bot-Token prüfen. Das macht eine neue Verknüpfung sofort
 * nutzbar; danach hält der Discord-Bot den Wert mit Gateway-Ereignissen und Vollabgleichen aktuell.
 */
export async function refreshDiscordMembership(userId, discordId = null) {
  const guildId = freeGuildId();
  const token = String(getSetting('discord_bot_token') || '').trim();
  const id =
    String(discordId || db.prepare('SELECT discord_id FROM users WHERE id = ?').get(userId)?.discord_id || '').trim();
  if (!guildId || !token || !id) return { checked: false, member: false };

  let response;
  try {
    response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${id}`, {
      headers: { authorization: `Bot ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { checked: false, member: false };
  }
  if (response.status !== 200 && response.status !== 404) {
    return { checked: false, member: false, status: response.status };
  }
  const member = response.status === 200;
  db.prepare(
    'UPDATE users SET discord_guild_member = ?, discord_guild_checked_at = ? WHERE id = ? AND discord_id = ?'
  ).run(member ? 1 : 0, Date.now(), userId, id);
  return { checked: true, member };
}

/**
 * Team ist die einzige Discord Linked Role. Customer, Tarife, Partner, VIP, Administrator und
 * Discord Moderator sind normale Serverrollen; sie synchronisiert der Bot ohne OAuth-Zustimmung
 * für `role_connections.write`.
 */
export const ROLE_METADATA = [
  {
    key: 'team',
    name: 'Team',
    type: 7,
    description: 'AFKSystems team member',
  },
];

/** Die Werte, die Discord über einen Nutzer bekommen soll. */
export function roleMetadataFor(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  return {
    team: user.role === 'admin' || Boolean(user.discord_moderator) ? 1 : 0,
  };
}

async function writeRoleConnection(accessToken, userId) {
  const applicationId = String(getSetting('discord_client_id') || '').trim();
  if (!applicationId) throw bad('Discord ist nicht eingerichtet.', { en: 'Discord is not set up.' });
  const user = db.prepare('SELECT username, role, discord_moderator FROM users WHERE id = ?').get(userId);
  if (!user || (user.role !== 'admin' && !user.discord_moderator)) {
    throw new HttpError(403, 'Die Linked Role Team ist nur für Administratoren und Discord-Moderatoren.', {
      en: 'The Team linked role is only available to administrators and Discord moderators.',
    });
  }
  const response = await fetch(
    `https://discord.com/api/v10/users/@me/applications/${applicationId}/role-connection`,
    {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        platform_name: config.brand,
        platform_username: user?.username || '',
        metadata: roleMetadataFor(userId),
      }),
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!response.ok) {
    throw bad(`Discord hat die Verknüpfung abgelehnt (${response.status}).`, {
      en: `Discord rejected the connection (${response.status}).`,
    });
  }
  audit(userId, 'discord-role-connection');
  return true;
}
