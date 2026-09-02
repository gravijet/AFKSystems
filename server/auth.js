// Anmeldung: Sitzungen als zufälliges Token im HttpOnly-Cookie, Passwörter als scrypt-Hash.
// Kein Zusatzpaket – die Sitzung steht in der Datenbank und lässt sich damit auch wieder entziehen.

import { createHash, createHmac } from 'node:crypto';
import { db, audit, getSetting } from './db.js';
import { config } from './config.js';
import { token, hashPassword, verifyPassword, passwordNeedsRehash, deviceOf, HttpError, bad } from './util.js';
import { grant, planOf, isPayingUser, monthlyCost, freeAccess } from './billing.js';
import * as mail from './mail.js';
import * as linkedRoles from './linked-roles.js';
import * as profile from './profile.js';
import * as logincode from './logincode.js';
import * as totp from './totp.js';

const COOKIE = 'afk_session';
/** So oft höchstens wird "zuletzt gesehen" nachgeführt. */
const SEEN_MS = 5 * 60 * 1000;

/**
 * Zugangstoken werden nur als schlüsselgebundener Abdruck gespeichert.
 *
 * Ein gewöhnlicher SHA-Hash genügt bei zufälligen Tokens zwar gegen Zurückrechnen, aber ein HMAC
 * trennt zusätzlich Datenbank und Schlüssel: Eine kopierte SQLite-Datei allein enthält damit
 * weder offene Sitzungen noch gültige Links zum Zurücksetzen. Der zweite Kandidat hält bereits
 * laufende Sitzungen aus älteren Versionen bis zu ihrem normalen Ablauf am Leben.
 */
const capabilityDigest = (purpose, value) =>
  `h1:${createHmac('sha256', config.secret)
    .update(String(purpose))
    .update('\0')
    .update(String(value))
    .digest('hex')}`;

const capabilityCandidates = (purpose, raw) => {
  const value = String(raw || '').trim();
  if (!value || value.startsWith('h1:')) return [];
  return [capabilityDigest(purpose, value), value];
};

const storedSessionToken = (raw) => capabilityDigest('session', raw);

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        // Ein kaputtes Prozent-Encoding ist kein Serverfehler und darf insbesondere beim
        // WebSocket-Upgrade nicht als ungefangene Ausnahme den Prozess beenden.
        return null;
      }
    }
  }
  return null;
}

/**
 * Wie lange eine geliehene Ansicht („Als Nutzer ansehen“) gilt.
 *
 * Eine Impersonation ist ein Generalschlüssel zu einem fremden Konto, und sie war bisher genauso
 * langlebig wie eine gewöhnliche Anmeldung: dreißig Tage. Wer im Support einmal in ein Konto
 * hineingesehen und den Reiter zugemacht hat, ließ damit einen Monat lang ein gültiges Cookie für
 * ein fremdes Konto in seinem Browser liegen. Eine Stunde reicht für jede Rückfrage, und wer
 * länger braucht, drückt noch einmal auf den Knopf – das steht dann auch noch einmal im Protokoll.
 */
export const IMPERSONATION_MS = 60 * 60 * 1000;

export function createSession(
  res,
  user,
  req,
  { impersonatorId = null, parentToken = null, maxAgeMs = null } = {}
) {
  const value = token(32);
  const lifetime = Number.isFinite(maxAgeMs) && maxAgeMs > 0
    ? Math.min(maxAgeMs, config.sessionDays * 86_400_000)
    : config.sessionDays * 86_400_000;
  const expires = Date.now() + lifetime;
  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, ip, agent, impersonator_id, parent_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    storedSessionToken(value),
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
    maxAge: lifetime,
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
  const candidates = capabilityCandidates('session', value);
  if (candidates.length) db.prepare('DELETE FROM sessions WHERE token IN (?, ?)').run(...candidates);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Hängt req.user an, wenn eine gültige Sitzung vorliegt. Wirft nie. */
export function attachUser(req, _res, next) {
  const value = readCookie(req, COOKIE);
  const candidates = capabilityCandidates('session', value);
  if (candidates.length) {
    const row = db
      .prepare(
        `SELECT u.*, s.token AS session_storage_token, s.impersonator_id, s.parent_token
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token IN (?, ?) AND s.expires_at > ?`
      )
      .get(...candidates, Date.now());
    if (row) {
      const {
        session_storage_token: sessionStorageToken,
        impersonator_id: impersonatorId,
        parent_token: parentToken,
        ...user
      } = row;
      req.user = user;
      req.sessionToken = value;
      req.sessionStorageToken = sessionStorageToken;
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
  // Auch hier, nicht nur in `requireUser`: Der Admin-Router hängt beide hintereinander, aber diese
  // Funktion wird auch einzeln benutzt, und eine Rechteprüfung, die von der Reihenfolge ihrer
  // Nachbarn abhängt, ist keine.
  if (req.user.blocked) {
    return next(new HttpError(403, 'Dieses Konto ist gesperrt.', { en: 'This account is blocked.' }));
  }
  if (req.user.role !== 'admin') {
    return next(new HttpError(403, 'Nur für Administratoren.', { en: 'Administrators only.' }));
  }
  next();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const USERNAME = /^[a-zA-Z0-9_.-]{3,24}$/;

/**
 * Passwörter, die zwölf Zeichen haben und trotzdem keine sind.
 *
 * Die Längengrenze allein ist eine Rechenaufgabe, kein Schutz: `passwortpasswort`,
 * `123456789012` und `qwertzuiopü` erfüllen sie und stehen trotzdem in jeder Liste, mit der ein
 * Angreifer anfängt. Die Sammlung hier ist bewusst kurz – sie ersetzt keine Prüfung gegen ein
 * Leck, sondern fängt die Handvoll Muster ab, die Menschen tatsächlich eintippen, wenn ihnen ein
 * Formular „mindestens zwölf Zeichen“ sagt.
 */
const WEAK_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789012345',
  '1234567890',
  'passwortpasswort',
  'passwordpassword',
  'passwort1234',
  'password1234',
  'passwort12345',
  'password12345',
  'qwertzuiopasdf',
  'qwertyuiopasdf',
  'administrator',
  'minecraft123',
  'minecraftminecraft',
  'letmeinletmein',
  'iloveyouiloveyou',
  'willkommen123',
  'welcome123456',
  'afksystems123',
  'geheimgeheim',
  'aaaaaaaaaaaa',
]);

/**
 * Steckt der Kontoname oder der Postfachname im Passwort?
 *
 * `hugo` mit dem Passwort `hugohugohugo` hat zwölf Zeichen und ist trotzdem der erste Versuch, den
 * jemand macht, der den Namen kennt – und den Namen kennt bei einem Panel, in dem er unter jeder
 * Ticketantwort steht, jeder. Geprüft wird in beide Richtungen und ohne Rücksicht auf Groß- und
 * Kleinschreibung; kurze Bruchstücke (unter vier Zeichen) zählen nicht, sonst scheitert jedes
 * Passwort an einem Konto namens `ab`.
 */
function containsIdentity(value, identity = {}) {
  const needles = [identity.username, String(identity.email || '').split('@')[0]]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter((entry) => entry.length >= 4);
  const haystack = value.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

export function checkPasswordPair(password, repeat, identity = null) {
  const value = String(password || '');
  if (value.length < 12) {
    throw bad('Das Passwort braucht mindestens 12 Zeichen.', {
      en: 'The password needs at least 12 characters.',
    });
  }
  if (value.length > 256) {
    throw bad('Das Passwort darf höchstens 256 Zeichen lang sein.', {
      en: 'The password may be at most 256 characters long.',
    });
  }
  if (String(password) !== String(repeat ?? '')) {
    throw bad('Die beiden Passwörter sind nicht gleich.', {
      en: 'The two passwords are not the same.',
      code: 'password-mismatch',
    });
  }
  const plain = value.toLowerCase();
  if (WEAK_PASSWORDS.has(plain) || /^(.)\1+$/.test(value)) {
    throw bad('Dieses Passwort ist zu leicht zu erraten. Bitte ein anderes wählen.', {
      en: 'That password is too easy to guess. Please choose a different one.',
      code: 'password-weak',
    });
  }
  if (identity && containsIdentity(value, identity)) {
    throw bad('Das Passwort darf nicht den Benutzernamen oder die E-Mail-Adresse enthalten.', {
      en: 'The password must not contain your username or email address.',
      code: 'password-weak',
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
  checkPasswordPair(password, password2, { username: name, email: mailAddress });

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mailAddress)) {
    throw bad('Diese E-Mail-Adresse ist schon vergeben.', { en: 'That email address is taken.' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(name)) {
    throw bad('Dieser Benutzername ist schon vergeben.', { en: 'That username is taken.' });
  }

  // Der Erste ist Admin – oder wer in ADMIN_EMAIL steht.
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  // Auf einem leeren Produktionssystem darf nicht der erste Besucher allein durch Schnelligkeit
  // Administrator werden. Die Entwicklung behält den bequemen ersten Admin; live muss die
  // vorgesehene Adresse ausdrücklich in ADMIN_EMAIL stehen.
  if (count === 0 && process.env.NODE_ENV === 'production' && !config.adminEmail) {
    throw new HttpError(
      503,
      'Die Registrierung ist noch nicht sicher eingerichtet. ADMIN_EMAIL fehlt.',
      { en: 'Registration has not been securely configured yet. ADMIN_EMAIL is missing.' }
    );
  }
  const role = count === 0 || (config.adminEmail && config.adminEmail === mailAddress) ? 'admin' : 'user';
  const needsVerification = mail.verifyRequired() && role !== 'admin';
  const verificationToken = needsVerification ? token(24) : null;

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
      verificationToken ? capabilityDigest('verify-email', verificationToken) : null,
      needsVerification ? Date.now() : null,
      Date.now()
    );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const bonus = Number(getSetting('signup_bonus')) || 0;
  if (bonus > 0) grant(user.id, bonus, 'bonus', 'Startguthaben');
  audit(user.id, 'register', { role });
  if (needsVerification) mail.sendVerification(user, verificationToken);
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
  // Alte, schwächere Parameter werden ohne Zwangs-Reset beim nächsten richtigen Login angehoben.
  if (passwordNeedsRehash(user.password_hash)) {
    user.password_hash = hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(user.password_hash, user.id);
  }
  return user;
}

/**
 * Stimmt dieses Passwort zu diesem Konto?
 *
 * Für die Stellen, an denen ein Passwort nicht geändert, sondern **bestätigt** wird: eine neue
 * E-Mail-Adresse, eine Kontolöschung. Die Prüfung steht hier und nicht dort, damit es keine
 * zweite Stelle gibt, an der ein `verifyPassword` mit einer eigenen Auslegung von "leer" steht.
 */
export const checkPassword = (user, password) =>
  verifyPassword(String(password || ''), user.password_hash);

/**
 * Die Absage, wenn ein Passwort bestätigt werden soll und nicht stimmt.
 *
 * Der zweite Satz ist der wichtige. Wer sich **nur** über Discord oder Google anmeldet, hat hier
 * nie eines gesetzt: Sein gespeicherter Hash gehört einem Zufallswert, den niemand kennt (siehe
 * oauth.js). Ohne diesen Hinweis stünde so jemand vor einem Feld, in das er nichts eintragen kann,
 * das je passt – und der Weg dorthin ("Passwort vergessen") liegt an einer Stelle, an der er ihn
 * nicht sucht.
 */
export const wrongPassword = () =>
  bad('Das Passwort stimmt nicht. Wer sich nur über Discord oder Google anmeldet, setzt sich zuerst über „Passwort vergessen“ eines.', {
    en: 'That password is wrong. If you only ever sign in through Discord or Google, set one first via “Forgot password”.',
  });

export function changePassword(user, oldPassword, newPassword, repeat) {
  if (!verifyPassword(String(oldPassword || ''), user.password_hash)) {
    throw bad('Das alte Passwort stimmt nicht.', { en: 'The current password is wrong.' });
  }
  checkPasswordPair(newPassword, repeat, { username: user.username, email: user.email });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
  // Andere Sitzungen fliegen raus, die aktuelle wird vom Aufrufer neu gesetzt.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  // Und alle bekannten Browser mit. Der häufigste Grund für einen Passwortwechsel ist der
  // Verdacht, dass jemand anderes das alte kennt – dann sitzt dieser andere womöglich an einem
  // Browser, der hier als bekannt geführt wird, und käme mit dem nächsten Versuch ohne
  // Anmeldecode herein. Das eigene Gerät ist mit dabei: Es meldet sich gleich neu an und ist
  // damit sofort wieder bekannt.
  logincode.forgetAll(user.id);
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

// ---------------------------------------------------------------- Name und Adresse ändern

/**
 * Wie lange ein Benutzername stehen bleiben muss, bevor er wieder geändert werden darf.
 *
 * Er ist keine Anmeldung allein – er steht unter jeder Ticketantwort, in Discord und in den
 * Protokollen der Verwaltung. Wer ihn stündlich wechselt, macht jeden Verlauf unlesbar und jede
 * Rückfrage („wer war das?“) unbeantwortbar. Dreißig Tage sind lang genug dafür und kurz genug,
 * dass ein Tippfehler im Namen nicht ein Jahr lang bleibt.
 */
export const USERNAME_PAUSE_MS = 30 * 86_400_000;

export function changeUsername(user, wanted) {
  const name = String(wanted || '').trim();
  if (name === user.username) {
    throw bad('Der Benutzername ist schon so.', { en: 'That is already the username.' });
  }
  if (!USERNAME.test(name)) {
    throw bad('Benutzername: 3–24 Zeichen, nur Buchstaben, Ziffern, . _ und -', {
      en: 'Username: 3–24 characters – letters, digits, . _ and - only.',
    });
  }
  // `COLLATE NOCASE` **und** der Vergleich mit sich selbst: Wer nur die Groß-/Kleinschreibung
  // ändern will ("hugo" -> "Hugo"), stieße sonst auf seinen eigenen Namen als "schon vergeben".
  const taken = db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?')
    .get(name, user.id);
  if (taken) throw bad('Dieser Benutzername ist schon vergeben.', { en: 'That username is taken.' });

  const since = user.username_changed_at ? Date.now() - user.username_changed_at : Infinity;
  if (since < USERNAME_PAUSE_MS) {
    const days = Math.ceil((USERNAME_PAUSE_MS - since) / 86_400_000);
    throw bad(`Der Benutzername lässt sich erst in ${days} Tag(en) wieder ändern.`, {
      en: `The username can be changed again in ${days} day(s).`,
    });
  }

  db.prepare('UPDATE users SET username = ?, username_changed_at = ? WHERE id = ?').run(
    name,
    Date.now(),
    user.id
  );
  audit(user.id, 'username-change', { from: user.username, to: name });
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

/** Wie lange der Bestätigungslink für eine neue E-Mail-Adresse gilt. */
const EMAIL_CHANGE_MS = 24 * 60 * 60 * 1000;

/**
 * Eine neue E-Mail-Adresse **beantragen**. Sie gilt erst, wenn sie bestätigt wurde.
 *
 * Drei Dinge machen den Unterschied zwischen „geht“ und „sicher“:
 *
 *   1. **Das Passwort.** Die E-Mail-Adresse ist der Weg zurück ins Konto ("Passwort vergessen").
 *      Wer sie ändern darf, ohne das Passwort zu kennen, übernimmt jedes Konto, an dessen offenem
 *      Browser er einmal saß.
 *   2. **Die Bestätigung an die neue Adresse.** Ein Tippfehler würde sonst das Konto aussperren:
 *      Die alte Adresse wäre weg, die neue erreicht niemanden.
 *   3. **Die Nachricht an die alte Adresse.** Sie ist die einzige Warnung, die ein Kunde bekommt,
 *      wenn jemand anderes gerade dabei ist, ihm das Konto wegzunehmen.
 */
export async function requestEmailChange(user, wanted, password, { onToken = null } = {}) {
  if (!checkPassword(user, password)) throw wrongPassword();
  const address = String(wanted || '').trim().toLowerCase();
  if (!EMAIL.test(address)) {
    throw bad('Das ist keine gültige E-Mail-Adresse.', { en: 'That is not a valid email address.' });
  }
  if (address === String(user.email || '').toLowerCase()) {
    throw bad('Das ist schon die Adresse dieses Kontos.', { en: 'That is already this account’s address.' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(address, user.id)) {
    // Dieselbe Absage wie bei der Registrierung. Sie verrät, dass es diese Adresse gibt – das tut
    // die Registrierung aber auch, und ohne sie liefe der Kunde in eine Bestätigung, die nie geht.
    throw bad('Diese E-Mail-Adresse ist schon vergeben.', { en: 'That email address is taken.' });
  }
  if (!mail.configured()) {
    throw bad('Ohne eingerichteten Postausgang lässt sich die Adresse nicht bestätigen.', {
      en: 'Without a working mail server the new address cannot be confirmed.',
    });
  }
  if (user.pending_email_at && Date.now() - user.pending_email_at < 60_000) {
    throw bad('Gerade erst verschickt. Bitte eine Minute warten.', { en: 'Just sent. Please wait a minute.' });
  }

  const value = token(24);
  db.prepare(
    'UPDATE users SET pending_email = ?, pending_email_token = ?, pending_email_at = ? WHERE id = ?'
  ).run(address, capabilityDigest('email-change', value), Date.now(), user.id);
  // Kleiner Test-/Integrationshaken für den Mail-Transport. Der HTTP-Aufrufer kann ihn nicht
  // setzen; produktiv bleibt der Klartext ausschließlich in der Nachricht an die neue Adresse.
  if (typeof onToken === 'function') onToken(value);
  audit(user.id, 'email-change-requested', { to: address });

  // An die neue Adresse: der Link. An die alte: die Warnung. Beides geht nebenher hinaus – ein
  // hängender Mailserver darf den Antrag nicht aufhalten, er steht schon in der Datenbank.
  const url = `${config.publicUrl}/${user.language === 'de' ? 'de' : 'en'}/verify?email=${encodeURIComponent(value)}`;
  mail.sendTo({ ...user, email: address }, 'email_change', { url, address }).catch(() => {});
  mail
    .sendTo(user, 'security', {
      title: user.language === 'en' ? 'A new email address was requested' : 'Eine neue E-Mail-Adresse wurde beantragt',
      text:
        user.language === 'en'
          ? `Someone asked to move this account to ${address}. It only takes effect once that address confirms it.`
          : `Für dieses Konto wurde ${address} als neue Adresse beantragt. Sie gilt erst, wenn sie dort bestätigt wird.`,
      detail: '',
    })
    .catch(() => {});
  return address;
}

/** Den Bestätigungslink aus der Nachricht an die neue Adresse einlösen. */
export function confirmEmailChange(rawToken) {
  const candidates = capabilityCandidates('email-change', rawToken);
  if (!candidates.length) return null;
  const user = db.prepare('SELECT * FROM users WHERE pending_email_token IN (?, ?)').get(...candidates);
  if (!user) return null;
  const clear = () =>
    db
      .prepare('UPDATE users SET pending_email = NULL, pending_email_token = NULL, pending_email_at = NULL WHERE id = ?')
      .run(user.id);
  if (!user.pending_email || Date.now() - (user.pending_email_at || 0) > EMAIL_CHANGE_MS) {
    clear();
    return null;
  }
  // In der Zwischenzeit kann jemand anderes dieselbe Adresse registriert haben. Dann ist der
  // Antrag hinfällig – und zwar mit einer Absage und nicht mit einem Datenbankfehler.
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(user.pending_email, user.id)) {
    clear();
    throw bad('Diese E-Mail-Adresse ist inzwischen vergeben.', { en: 'That email address has since been taken.' });
  }
  db.prepare(
    `UPDATE users SET email = pending_email, email_verified = 1,
       pending_email = NULL, pending_email_token = NULL, pending_email_at = NULL
     WHERE id = ?`
  ).run(user.id);
  audit(user.id, 'email-changed', { to: user.pending_email });
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

/** Einen laufenden Antrag zurückziehen – etwa nach einem Tippfehler in der neuen Adresse. */
export function cancelEmailChange(userId) {
  return db
    .prepare('UPDATE users SET pending_email = NULL, pending_email_token = NULL, pending_email_at = NULL WHERE id = ?')
    .run(userId).changes;
}

/**
 * Eine Anmeldung von einem Gerät, das dieses Konto noch nie benutzt hat.
 *
 * Das ist die einzige Stelle, an der wir von uns aus schreiben, ohne dass jemand etwas bestellt
 * hat – und sie ist es wert: Wer eine solche Nachricht bekommt und nichts davon weiß, hat genau
 * die Information, die er braucht.
 *
 * **Woran „neu“ hängt.** Früher an der Browserkennung: Gab es keine Sitzung mit genau diesem
 * `User-Agent`, war das Gerät neu. Das schwieg bei jedem Fremden mit einem verbreiteten Browser
 * und schrieb bei jedem Chrome-Update, obwohl niemand das Gerät gewechselt hatte. Jetzt zählt der
 * Zufallswert im Gerätecookie (logincode.js) – dieselbe Auskunft, an der auch der Anmeldecode
 * hängt, damit „neues Gerät“ nicht zweierlei bedeutet.
 *
 * Muss **vor** `logincode.remember` laufen: danach wäre jedes Gerät bekannt.
 */
export function noticeNewDevice(user, req) {
  const agent = String(req.headers['user-agent'] || '').slice(0, 200);
  if (logincode.isKnownDevice(user, req)) return;
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

/** Wie lange ein Bestätigungslink gilt. Danach schickt „erneut senden“ einen frischen. */
const VERIFY_MS = 7 * 24 * 60 * 60 * 1000;

export function verifyEmail(rawToken) {
  const candidates = capabilityCandidates('verify-email', rawToken);
  if (!candidates.length) return null;
  const user = db.prepare('SELECT * FROM users WHERE verify_token IN (?, ?)').get(...candidates);
  if (!user) return null;
  // Ein Bestätigungslink meldet an (siehe unten) – er ist damit ein zweiter Weg ins Konto, und der
  // muss dieselbe Tür sein wie das Anmeldeformular. Ohne diese Zeile kam ein gesperrtes Konto über
  // eine alte Bestätigungsmail wieder herein: `login()` weist es ab, `/auth/verify` legte ihm eine
  // Sitzung an.
  if (user.blocked) {
    throw new HttpError(403, 'Dieses Konto ist gesperrt.', { en: 'This account is blocked.' });
  }
  // Ein Bestätigungslink meldet an – also ist er ein Schlüssel zum Konto und darf nicht ewig
  // gelten. Wer eine alte Mail wiederfindet oder weitergeleitet hat, bekommt hier eine Absage
  // und über „erneut senden“ einen neuen Link.
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
    capabilityDigest('verify-email', value),
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
    capabilityDigest('password-reset', value),
    Date.now() + RESET_MS,
    user.id
  );
  await mail.sendReset(user, value);
}

export function applyReset(rawToken, password, repeat, code = null) {
  const candidates = capabilityCandidates('password-reset', rawToken);
  const user = candidates.length
    ? db.prepare('SELECT * FROM users WHERE reset_token IN (?, ?) AND reset_expires > ?').get(
        ...candidates,
        Date.now()
      )
    : null;
  if (!user) throw bad('Dieser Link gilt nicht mehr.', { en: 'This link is no longer valid.', code: 'reset-invalid' });
  // Ein gesperrtes Konto bekommt kein neues Passwort. Anmelden könnte es sich damit zwar ohnehin
  // nicht, aber ein Zurücksetzen, das "erledigt" meldet und nichts nützt, ist eine Auskunft über
  // ein Konto, die niemandem zusteht – und die Sperre bliebe eine Frage der Reihenfolge.
  if (user.blocked) {
    throw new HttpError(403, 'Dieses Konto ist gesperrt.', { en: 'This account is blocked.' });
  }

  // **Der zweite Faktor gilt auch hier.** Das ist der Punkt, an dem sich entscheidet, ob die
  // Zwei-Faktor-Anmeldung etwas bedeutet oder nur so heißt: Ohne diese Frage bliebe das Postfach
  // ein Generalschlüssel – Link anfordern, Passwort setzen, drin. Genau das ist die Schwäche, die
  // der Anmeldecode an sich selbst benennt (siehe logincode.js), und sie hier stehen zu lassen
  // hieße, den stärkeren Faktor an der schwächsten Stelle vorbeizuführen.
  //
  // Ein Wiederherstellungscode zählt genauso: Wer sein Telefon **und** sein Passwort verloren
  // hat, kommt über den Zettel zurück, den er beim Einrichten bekommen hat.
  if (totp.enabled(user)) {
    if (!totp.verify(user, code)) {
      throw bad('Für dieses Konto ist die Zwei-Faktor-Anmeldung eingeschaltet. Bitte den Code aus der App eingeben.', {
        en: 'This account has two-factor sign-in switched on. Please enter the code from your app.',
        code: 'totp-required',
      });
    }
  }

  checkPasswordPair(password, repeat, { username: user.username, email: user.email });
  db.prepare(
    'UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?'
  ).run(hashPassword(password), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  // Wie beim Passwortwechsel: Wer zurücksetzt, hat den Zugang meist verloren oder fürchtet ihn
  // verloren zu haben. Ein Browser, der bis eben als bekannt galt, ist danach keiner mehr.
  logincode.forgetAll(user.id);
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
    display_name: profile.displayNameOf(user),
    role: user.role,
    credits: user.credits,
    blocked: Boolean(user.blocked),
    email_verified: Boolean(user.email_verified),
    // Ob dieses Konto bei einer Anmeldung von einem unbekannten Browser einen Code per E-Mail
    // verlangt. Kommt mit `/me`, weil die Einstellungen es sonst einzeln nachholen müssten.
    login_code: Boolean(user.login_code),
    // Ob die Zwei-Faktor-Anmeldung scharf ist. Nur das – das Geheimnis verlässt den Server genau
    // einmal, beim Einrichten, und danach nie wieder (siehe totp.js).
    totp: Boolean(user.totp_enabled_at && user.totp_secret),
    theme: user.theme,
    language: user.language,
    chat_limit: user.chat_limit,
    discord_webhook: user.discord_webhook || '',
    // Welche Ereignisarten der Webhook meldet. Leer heißt alles – siehe notify.js.
    discord_events: user.discord_events || '',
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
    google: user.google_id
      ? { id: user.google_id, name: user.google_name, email: user.google_email, avatar: user.google_avatar }
      : null,
    mail_prefs: mail.prefsOf(user),
    paying,
    premium_until: user.premium_until || null,
    proxy_allowance: user.proxy_allowance,
    monthly_cost: monthlyCost(user.id),
    created_at: user.created_at,
    last_seen_at: user.last_seen_at,
    // Name, Anschrift, Firmierung, Zeitzone – alles, was über den Anmeldenamen hinausgeht.
    // Es kommt mit `/me` und nicht aus einem eigenen Aufruf: Das Panel holt `/me` ohnehin bei
    // jedem Zustandswechsel, und die Einstellungen bräuchten sonst eine zweite Anfrage für
    // Felder, die längst da sind.
    profile: profile.profileOf(user),
    // Eine noch nicht bestätigte neue Adresse. Bis sie bestätigt ist, gilt die alte – aber
    // sichtbar muss sein, dass eine zweite unterwegs ist, sonst wartet jemand auf eine
    // Bestätigungsmail, von der er nicht mehr weiß, wohin sie ging.
    pending_email: user.pending_email || null,
    username_changed_at: user.username_changed_at || null,
    // Steht ein Löschtermin an, gehört er in jede Ansicht – nicht nur in die, in der er gesetzt
    // wurde. Wer sein Konto zur Löschung angemeldet hat, soll das nicht vergessen können.
    delete_due_at: user.delete_due_at || null,
    avatar: profile.avatarOf(user),
    avatar_source: profile.AVATAR_SOURCES.includes(user.avatar_source) ? user.avatar_source : 'auto',
    avatar_choices: profile.avatarChoices(user),
  };
}


/** Abgelaufene Sitzungen wegräumen. Läuft im Stundentakt aus index.js. */
export function cleanupSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

/**
 * Aus einem User-Agent das, was ein Mensch daran wiedererkennt: Browser und System.
 *
 * Steht in util.js und wird hier nur weitergereicht: Die bekannten Geräte (logincode.js) brauchen
 * dieselbe Auskunft, und ein Import von dort nach hier wäre ein Kreis – auth.js braucht seinerseits
 * das Vergessen der Geräte beim Passwortwechsel.
 */
export { deviceOf };

/**
 * Ein Kennzeichen für eine Sitzung, das **nicht** die Sitzung ist.
 *
 * Die Liste der offenen Sitzungen geht in den Browser, damit man eine davon beenden kann. Das
 * Token selbst darf dabei nicht mitreisen: Es *ist* die Anmeldung, und eine Seite, die alle
 * Token des Kontos im Speicher hält, verschenkt bei der ersten Lücke gleich jedes Gerät mit.
 * Der Kurzabdruck reicht zum Wiederfinden und lässt sich nicht zurückrechnen.
 */
const sessionRef = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);

export function sessionsOf(userId, currentToken = null) {
  const current = new Set(capabilityCandidates('session', currentToken));
  return db
    .prepare('SELECT token, created_at, expires_at, ip, agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map((row) => ({
      ref: sessionRef(row.token),
      created_at: row.created_at,
      expires_at: row.expires_at,
      ip: row.ip,
      agent: row.agent,
      device: deviceOf(row.agent),
      current: current.has(row.token),
    }));
}

/**
 * Eine einzelne Sitzung beenden.
 *
 * Gesucht wird über den Kurzabdruck, und zwar **nur innerhalb der eigenen Sitzungen**: Damit ist
 * ausgeschlossen, dass ein geratener Abdruck ein fremdes Gerät abmeldet. Die eigene Sitzung
 * bleibt, wo sie ist – wer sich hier selbst abmeldet, drückt danach auf "Abmelden" und wundert
 * sich, warum die Liste leer ist.
 */
export function endSession(userId, ref, exceptToken = null) {
  const wanted = String(ref || '');
  const except = new Set(capabilityCandidates('session', exceptToken));
  const row = db
    .prepare('SELECT token FROM sessions WHERE user_id = ?')
    .all(userId)
    .find((entry) => sessionRef(entry.token) === wanted && !except.has(entry.token));
  if (!row) return false;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(row.token);
  audit(userId, 'session-revoked');
  return true;
}

/**
 * Alle Sitzungen dieses Kontos beenden – außer der, an der gerade jemand sitzt.
 *
 * Der Vergleich läuft über den **gespeicherten** Wert und nicht über das Cookie. In der Datenbank
 * steht ein HMAC (siehe oben); wer dort das rohe Cookie einsetzt, vergleicht zwei Dinge, die nie
 * gleich sein können – und meldet damit auch den ab, der gerade auf „alle anderen abmelden“
 * gedrückt hat. Genau das war der Fehler an dieser Stelle: Der Knopf hat funktioniert, nur eben
 * einen Schritt zu weit, und der Kunde stand danach selbst vor der Anmeldeseite.
 */
export function endOtherSessions(userId, currentStorageToken = null) {
  if (!currentStorageToken) {
    return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
  }
  return db
    .prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?')
    .run(userId, currentStorageToken).changes;
}

/** Eine Browser-WebSocket-Sitzung mit derselben Logik wie die HTTP-Middleware nachschlagen. */
export function userForSession(rawToken) {
  const candidates = capabilityCandidates('session', rawToken);
  if (!candidates.length) return null;
  return db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token IN (?, ?) AND s.expires_at > ?`
    )
    .get(...candidates, Date.now());
}

/**
 * Aus einer geliehenen Ansicht sicher ins Administratorkonto zurückkehren.
 *
 * Im Kind steht nur der bereits gehashte Datenbankwert der Elternsitzung. Beim Rückweg wird diese
 * Sitzungskennung rotiert; dadurch muss niemals ein gültiges Admin-Cookie in SQLite liegen.
 */
export function returnToImpersonator(req, res) {
  if (!req.user || !req.impersonator || !req.parentToken) return false;
  const parent = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.user_id = ? AND s.expires_at > ?`
    )
    .get(req.parentToken, req.impersonator.id, Date.now());
  if (!parent) return false;

  const current = capabilityCandidates('session', req.sessionToken);
  const rotate = db.transaction(() => {
    if (current.length) db.prepare('DELETE FROM sessions WHERE token IN (?, ?)').run(...current);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.parentToken);
  });
  rotate();
  createSession(res, parent, req);
  return true;
}

export { planOf };
