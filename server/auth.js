// Anmeldung: Sitzungen als zufälliges Token im HttpOnly-Cookie, Passwörter als scrypt-Hash.
// Kein Zusatzpaket – die Sitzung steht in der Datenbank und lässt sich damit auch wieder entziehen.

import { db, audit, getSetting } from './db.js';
import { config } from './config.js';
import { token, hashPassword, verifyPassword, HttpError, bad } from './util.js';
import { grant } from './credits.js';

const COOKIE = 'afk_session';

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function createSession(res, user, req) {
  const value = token(32);
  const expires = Date.now() + config.sessionDays * 86_400_000;
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at, ip, agent) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    value,
    user.id,
    Date.now(),
    expires,
    req.ip || null,
    String(req.headers['user-agent'] || '').slice(0, 200)
  );
  res.cookie(COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https'),
    maxAge: config.sessionDays * 86_400_000,
    path: '/',
  });
  return value;
}

export function destroySession(req, res) {
  const value = readCookie(req, COOKIE);
  if (value) db.prepare('DELETE FROM sessions WHERE token = ?').run(value);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Hängt req.user an, wenn eine gültige Sitzung vorliegt. Wirft nie. */
export function attachUser(req, _res, next) {
  const value = readCookie(req, COOKIE);
  if (value) {
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`
      )
      .get(value, Date.now());
    if (row) {
      req.user = row;
      req.sessionToken = value;
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Date.now(), row.id);
    }
  }
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Bitte anmelden.'));
  if (req.user.blocked) return next(new HttpError(403, 'Dieses Konto ist gesperrt.'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Bitte anmelden.'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Nur für Administratoren.'));
  next();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const USERNAME = /^[a-zA-Z0-9_.-]{3,24}$/;

export function register({ email, username, password }) {
  const mail = String(email || '').trim().toLowerCase();
  const name = String(username || '').trim();
  if (!EMAIL.test(mail)) throw bad('Das ist keine gültige E-Mail-Adresse.');
  if (!USERNAME.test(name)) {
    throw bad('Benutzername: 3–24 Zeichen, nur Buchstaben, Ziffern, . _ und -');
  }
  if (String(password || '').length < 8) throw bad('Das Passwort braucht mindestens 8 Zeichen.');

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) {
    throw bad('Diese E-Mail-Adresse ist schon vergeben.');
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(name)) {
    throw bad('Dieser Benutzername ist schon vergeben.');
  }

  // Der Erste ist Admin – oder wer in ADMIN_EMAIL steht.
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const role = count === 0 || (config.adminEmail && config.adminEmail === mail) ? 'admin' : 'user';

  const info = db
    .prepare(
      `INSERT INTO users (email, username, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(mail, name, hashPassword(password), role, Date.now());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const bonus = Number(getSetting('signup_bonus_mcr')) || 0;
  if (bonus > 0) grant(user.id, bonus, 'bonus', 'Startguthaben');
  audit(user.id, 'register', { role });
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

export function login({ login: identifier, password }) {
  const value = String(identifier || '').trim();
  const user = db
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE')
    .get(value.toLowerCase(), value);
  // Immer hashen, damit ein unbekannter Name nicht schneller antwortet als ein falsches Passwort.
  const stored = user ? user.password_hash : hashPassword('platzhalter');
  const ok = verifyPassword(String(password || ''), stored);
  if (!user || !ok) throw new HttpError(401, 'E-Mail/Benutzername oder Passwort stimmt nicht.');
  if (user.blocked) throw new HttpError(403, 'Dieses Konto ist gesperrt.');
  return user;
}

export function changePassword(user, oldPassword, newPassword) {
  if (!verifyPassword(String(oldPassword || ''), user.password_hash)) {
    throw bad('Das alte Passwort stimmt nicht.');
  }
  if (String(newPassword || '').length < 8) throw bad('Das neue Passwort braucht 8 Zeichen.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    hashPassword(newPassword),
    user.id
  );
  // Andere Sitzungen fliegen raus, die aktuelle bleibt.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  audit(user.id, 'password-change');
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    credits_mcr: user.credits_mcr,
    rate_mcr_hour: user.rate_mcr_hour ?? Number(getSetting('rate_mcr_hour')),
    theme: user.theme,
    language: user.language,
    chat_limit: user.chat_limit,
    discord_webhook: user.discord_webhook || '',
    created_at: user.created_at,
  };
}

/** Abgelaufene Sitzungen wegräumen. Läuft im Stundentakt aus index.js. */
export function cleanupSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}
