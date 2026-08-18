// Anmeldung: Sitzungen als zufälliges Token im HttpOnly-Cookie, Passwörter als scrypt-Hash.
// Kein Zusatzpaket – die Sitzung steht in der Datenbank und lässt sich damit auch wieder entziehen.

import { db, audit, getSetting } from './db.js';
import { config } from './config.js';
import { token, hashPassword, verifyPassword, HttpError, bad } from './util.js';
import { grant, planOf, isPayingUser, monthlyCost, freeAccess } from './billing.js';
import * as mail from './mail.js';
import * as linkedRoles from './linked-roles.js';

const COOKIE = 'afk_session';
/** So oft höchstens wird "zuletzt gesehen" nachgeführt. */
const SEEN_MS = 5 * 60 * 1000;

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

export function createSession(res, user, req, { impersonatorId = null, parentToken = null } = {}) {
  const value = token(32);
  const expires = Date.now() + config.sessionDays * 86_400_000;
  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, ip, agent, impersonator_id, parent_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    value,
    user.id,
    Date.now(),
    expires,
    req.ip || null,
    String(req.headers['user-agent'] || '').slice(0, 200),
    impersonatorId,
    parentToken
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

/** Ein vorhandenes Sitzungs-Token wieder ins Cookie schreiben (Rückweg aus "Als Nutzer ansehen"). */
export function setSessionCookie(res, value) {
  res.cookie(COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https'),
    maxAge: config.sessionDays * 86_400_000,
    path: '/',
  });
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
        `SELECT u.*, s.impersonator_id, s.parent_token FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`
      )
      .get(value, Date.now());
    if (row) {
      const { impersonator_id: impersonatorId, parent_token: parentToken, ...user } = row;
      req.user = user;
      req.sessionToken = value;
      if (impersonatorId) {
        req.impersonator = db
          .prepare('SELECT id, username FROM users WHERE id = ?')
          .get(impersonatorId);
        req.parentToken = parentToken;
      }
      // Nur alle paar Minuten schreiben. Diese Middleware läuft vor allem anderen, also auch für
      // jede CSS-, JS- und Schriftdatei – ein Seitenaufruf hat sonst ein Dutzend Schreibzugriffe
      // ausgelöst, für eine Zahl, die auf die Minute genau niemanden interessiert.
      if (!user.last_seen_at || Date.now() - user.last_seen_at > SEEN_MS) {
        db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Date.now(), user.id);
      }
    }
  }
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Bitte anmelden.', { en: 'Please log in.' }));
  if (req.user.blocked) {
    return next(new HttpError(403, 'Dieses Konto ist gesperrt.', { en: 'This account is blocked.' }));
  }
  if (mail.verifyRequired() && !req.user.email_verified) {
    return next(
      new HttpError(403, 'Bitte zuerst die E-Mail-Adresse bestätigen.', {
        en: 'Please confirm your email address first.',
        code: 'email-unverified',
      })
    );
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Bitte anmelden.', { en: 'Please log in.' }));
  if (req.user.role !== 'admin') {
    return next(new HttpError(403, 'Nur für Administratoren.', { en: 'Administrators only.' }));
  }
  next();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const USERNAME = /^[a-zA-Z0-9_.-]{3,24}$/;

export function checkPasswordPair(password, repeat) {
  if (String(password || '').length < 8) {
    throw bad('Das Passwort braucht mindestens 8 Zeichen.', {
      en: 'The password needs at least 8 characters.',
    });
  }
  if (String(password) !== String(repeat ?? '')) {
    throw bad('Die beiden Passwörter sind nicht gleich.', {
      en: 'The two passwords are not the same.',
      code: 'password-mismatch',
    });
  }
}

export function register({ email, username, password, password2, language = 'en' }) {
  const mailAddress = String(email || '').trim().toLowerCase();
  const name = String(username || '').trim();
  if (!EMAIL.test(mailAddress)) {
    throw bad('Das ist keine gültige E-Mail-Adresse.', { en: 'That is not a valid email address.' });
  }
  if (!USERNAME.test(name)) {
    throw bad('Benutzername: 3–24 Zeichen, nur Buchstaben, Ziffern, . _ und -', {
      en: 'Username: 3–24 characters – letters, digits, . _ and - only.',
    });
  }
  checkPasswordPair(password, password2);

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mailAddress)) {
    throw bad('Diese E-Mail-Adresse ist schon vergeben.', { en: 'That email address is taken.' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(name)) {
    throw bad('Dieser Benutzername ist schon vergeben.', { en: 'That username is taken.' });
  }

  // Der Erste ist Admin – oder wer in ADMIN_EMAIL steht.
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const role = count === 0 || (config.adminEmail && config.adminEmail === mailAddress) ? 'admin' : 'user';
  const needsVerification = mail.verifyRequired() && role !== 'admin';

  const info = db
    .prepare(
      `INSERT INTO users (email, username, password_hash, role, language, email_verified, verify_token,
                          verify_sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      mailAddress,
      name,
      hashPassword(password),
      role,
      language === 'de' ? 'de' : 'en',
      needsVerification ? 0 : 1,
      needsVerification ? token(24) : null,
      needsVerification ? Date.now() : null,
      Date.now()
    );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const bonus = Number(getSetting('signup_bonus')) || 0;
  if (bonus > 0) grant(user.id, bonus, 'bonus', 'Startguthaben');
  audit(user.id, 'register', { role });
  if (needsVerification) mail.sendVerification(user, user.verify_token);
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
  if (!user || !ok) {
    throw new HttpError(401, 'E-Mail/Benutzername oder Passwort stimmt nicht.', {
      en: 'That email/username and password do not match.',
    });
  }
  if (user.blocked) throw new HttpError(403, 'Dieses Konto ist gesperrt.', { en: 'This account is blocked.' });
  return user;
}

export function changePassword(user, oldPassword, newPassword, repeat) {
  if (!verifyPassword(String(oldPassword || ''), user.password_hash)) {
    throw bad('Das alte Passwort stimmt nicht.', { en: 'The current password is wrong.' });
  }
  checkPasswordPair(newPassword, repeat);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
  // Andere Sitzungen fliegen raus, die aktuelle wird vom Aufrufer neu gesetzt.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  audit(user.id, 'password-change');
  mail.sendTo(user, 'security', {
    title: user.language === 'en' ? 'Your password was changed' : 'Dein Passwort wurde geändert',
    text:
      user.language === 'en'
        ? 'The password of your account was just changed. Every other device was signed out.'
        : 'Das Passwort deines Kontos wurde gerade geändert. Alle anderen Geräte wurden abgemeldet.',
    detail: '',
  });
}

/**
 * Eine Anmeldung von einem Gerät, das dieses Konto noch nie benutzt hat.
 *
 * Das ist die einzige Stelle, an der wir von uns aus schreiben, ohne dass jemand etwas bestellt
 * hat – und sie ist es wert: Wer eine solche Nachricht bekommt und nichts davon weiß, hat genau
 * die Information, die er braucht.
 *
 * Muss **vor** `createSession` laufen: danach gäbe es die neue Sitzung schon, und jedes Gerät
 * wäre bekannt.
 */
export function noticeNewDevice(user, req) {
  const agent = String(req.headers['user-agent'] || '').slice(0, 200);
  if (db.prepare('SELECT 1 FROM sessions WHERE user_id = ? AND agent = ?').get(user.id, agent)) return;
  mail.sendTo(user, 'security', {
    title: user.language === 'en' ? 'New sign-in' : 'Neue Anmeldung',
    text:
      user.language === 'en'
        ? 'Someone just signed in to your account from a device we had not seen before.'
        : 'An deinem Konto hat sich gerade jemand von einem Gerät angemeldet, das wir noch nicht kannten.',
    detail: `${req.ip || '?'} · ${agent || 'unbekannt'}`,
  });
}

// ---------------------------------------------------------------- E-Mail bestätigen

/** Wie lange ein Bestätigungslink gilt. Danach schickt „erneut senden" einen frischen. */
const VERIFY_MS = 7 * 24 * 60 * 60 * 1000;

export function verifyEmail(rawToken) {
  const value = String(rawToken || '').trim();
  if (!value) return null;
  const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(value);
  if (!user) return null;
  // Ein Bestätigungslink meldet an – also ist er ein Schlüssel zum Konto und darf nicht ewig
  // gelten. Wer eine alte Mail wiederfindet oder weitergeleitet hat, bekommt hier eine Absage
  // und über „erneut senden" einen neuen Link.
  if (user.verify_sent_at && Date.now() - user.verify_sent_at > VERIFY_MS) {
    db.prepare('UPDATE users SET verify_token = NULL WHERE id = ?').run(user.id);
    return null;
  }
  db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL WHERE id = ?').run(user.id);
  audit(user.id, 'email-verified');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

export function resendVerification(user) {
  if (user.email_verified) throw bad('Diese Adresse ist schon bestätigt.', { en: 'That address is already confirmed.' });
  if (user.verify_sent_at && Date.now() - user.verify_sent_at < 60_000) {
    throw bad('Gerade erst verschickt. Bitte eine Minute warten.', {
      en: 'Just sent. Please wait a minute.',
    });
  }
  const value = token(24);
  db.prepare('UPDATE users SET verify_token = ?, verify_sent_at = ? WHERE id = ?').run(
    value,
    Date.now(),
    user.id
  );
  return mail.sendVerification({ ...user, verify_token: value }, value);
}

// ---------------------------------------------------------------- Passwort vergessen

const RESET_MS = 60 * 60 * 1000;

export async function requestReset(email) {
  const address = String(email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(address);
  // Nach außen sieht es immer gleich aus – sonst ließe sich hier durchprobieren, wer Kunde ist.
  if (!user || !mail.configured()) return;
  const value = token(24);
  db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(
    value,
    Date.now() + RESET_MS,
    user.id
  );
  await mail.sendReset(user, value);
}

export function applyReset(rawToken, password, repeat) {
  const value = String(rawToken || '').trim();
  const user = value
    ? db.prepare('SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?').get(value, Date.now())
    : null;
  if (!user) throw bad('Dieser Link gilt nicht mehr.', { en: 'This link is no longer valid.', code: 'reset-invalid' });
  checkPasswordPair(password, repeat);
  db.prepare(
    'UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?'
  ).run(hashPassword(password), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  audit(user.id, 'password-reset');
  return user;
}

// ---------------------------------------------------------------- Darstellung

export function publicUser(user) {
  const paying = isPayingUser(user.id);
  const free = freeAccess(user.id);
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    credits: user.credits,
    blocked: Boolean(user.blocked),
    email_verified: Boolean(user.email_verified),
    theme: user.theme,
    language: user.language,
    chat_limit: user.chat_limit,
    discord_webhook: user.discord_webhook || '',
    discord: user.discord_id
      ? { id: user.discord_id, name: user.discord_name, avatar: user.discord_avatar }
      : null,
    discord_moderator: Boolean(user.discord_moderator),
    discord_partner: Boolean(user.discord_partner),
    discord_vip: Boolean(user.discord_vip),
    discord_guild_member: Boolean(user.discord_guild_member),
    discord_guild_checked_at: user.discord_guild_checked_at || null,
    // Linked Roles kann jeder auffrischen, dessen Konto verknüpft ist – veröffentlicht wird nur,
    // was das Panel über genau dieses Konto weiß. Sind gar keine Merkmale eingerichtet, gibt es
    // auch nichts aufzufrischen, und der Punkt taucht nicht auf.
    linked_roles_available: Boolean(user.discord_id) && linkedRoles.fields().length > 0,
    free_access: free,
    google: user.google_id ? { id: user.google_id, email: user.google_email } : null,
    mail_prefs: mail.prefsOf(user),
    paying,
    premium_until: user.premium_until || null,
    proxy_allowance: user.proxy_allowance,
    monthly_cost: monthlyCost(user.id),
    created_at: user.created_at,
    last_seen_at: user.last_seen_at,
  };
}

/** Abgelaufene Sitzungen wegräumen. Läuft im Stundentakt aus index.js. */
export function cleanupSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

export function sessionsOf(userId) {
  return db
    .prepare('SELECT token, created_at, expires_at, ip, agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map((row) => ({ ...row, token: `${row.token.slice(0, 6)}…` }));
}

export { planOf };
