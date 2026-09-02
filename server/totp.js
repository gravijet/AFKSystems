// Zwei-Faktor-Anmeldung: sechs Ziffern aus einer Authenticator-App.
//
// **Warum es das zusätzlich zum Anmeldecode gibt.** Der Anmeldecode (`logincode.js`) schickt sechs
// Ziffern per E-Mail. Er hilft gegen ein gestohlenes Passwort, und er sagt selbst, dass er kein
// zweiter Faktor ist: Er geht an dieselbe Adresse, über die auch „Passwort vergessen“ läuft. Wer
// das Postfach hat, kam damit immer noch ins Konto.
//
// Hier ist es anders. Das Geheimnis liegt in einer App auf einem Gerät, das dem Kunden gehört;
// es reist nicht durch fremde Mailserver und lässt sich nicht durch Zugriff auf ein Postfach
// nachbilden. Damit das auch stimmt und nicht nur behauptet ist, hängt an drei Stellen dieselbe
// Frage:
//
//   1. **Bei jeder Anmeldung mit Passwort** – nicht nur bei unbekannten Browsern. „Zwei Faktoren“
//      heißt zwei Faktoren, und ein Konto, das an bekannten Geräten nur nach dem Passwort fragt,
//      hat einen.
//   2. **Auch nach einer Anmeldung über Discord oder Google.** Sonst genügte ein übernommenes
//      Discord-Konto, um an der eigenen Zwei-Faktor-Anmeldung vorbeizukommen.
//   3. **Auch beim Zurücksetzen des Passworts.** Das ist der eigentliche Punkt: Ohne diese Frage
//      wäre der Postfachzugang weiterhin ein Generalschlüssel, und die Zwei-Faktor-Anmeldung wäre
//      genau die Behauptung, die der Anmeldecode zu Recht nicht aufstellt.
//
// **Wiederherstellungscodes** sind der Ausweg, wenn das Telefon weg ist – zehn Stück, jeder genau
// einmal einlösbar, als scrypt-Hash gespeichert wie ein Passwort. Ohne sie wäre ein verlorenes
// Telefon ein verlorenes Konto, und die einzige Rettung ein Administrator, der die Zwei-Faktor-
// Anmeldung auf Zuruf abschaltet – womit ein Anruf der zweite Faktor wäre.
//
// **Das Geheimnis liegt verschlüsselt in der Datenbank.** Nicht wegen des laufenden Betriebs –
// wer die Datei lesen kann, kann meist auch den Schlüssel lesen –, sondern wegen der Sicherungen:
// Sie lassen sich im Panel herunterladen und liegen danach irgendwo. Eine Sicherung, die jedes
// Zwei-Faktor-Geheimnis im Klartext enthält, ist ein Generalschlüssel in einer Datei. Passwörter
// stehen dort als scrypt-Hash, Sitzungen als HMAC – hier passt nur eine Verschlüsselung, weil der
// Wert im Klartext gebraucht wird, um zu rechnen.

import crypto from 'node:crypto';
import { db, audit } from './db.js';
import { config } from './config.js';
import { hashPassword, verifyPassword, bad, HttpError } from './util.js';
import * as qr from './qr.js';

/** Wie viele Sekunden ein Code gilt. Dreißig ist der Wert, den jede App voraussetzt. */
const PERIOD = 30;

/** Wie viele Ziffern. Sechs, ebenfalls die Vorgabe von RFC 6238 und jeder App. */
const DIGITS = 6;

/**
 * Wie viele Zeitfenster daneben noch zählen.
 *
 * Eins nach vorn und eins zurück, also ±30 Sekunden. Das deckt eine Uhr ab, die ein wenig
 * nachgeht, und den Fall, dass jemand die letzte Sekunde eines Fensters zum Abtippen braucht.
 * Mehr wäre kein Komfort, sondern ein längeres Zeitfenster für einen abgefangenen Code.
 */
const WINDOW = 1;

/** Wie viele Wiederherstellungscodes es gibt. */
const RECOVERY_COUNT = 10;

/** Wie lange eine begonnene Einrichtung offen bleibt, bevor sie verfällt. */
const SETUP_MS = 15 * 60_000;

// ---------------------------------------------------------------- Base32
//
// Authenticator-Apps lesen das Geheimnis als Base32 nach RFC 4648, ohne Füllzeichen. Nicht als
// Hex und nicht als Base64 – das ist keine Geschmacksfrage, sondern das, was die Apps können.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function unbase32(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of String(text).toUpperCase().replace(/[\s-]/g, '')) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw bad('Das Geheimnis ist keine gültige Base32-Zeichenkette.', {
      en: 'The secret is not a valid base32 string.',
    });
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------- Der Code selbst

/**
 * Ein neues Geheimnis: 20 zufällige Byte.
 *
 * Zwanzig, weil HMAC-SHA1 mit einem Schlüssel dieser Länge arbeitet und jede App damit
 * zurechtkommt. Mehr brächte hier nichts: Der Angriff auf ein TOTP führt nicht über das
 * Erraten des Geheimnisses, sondern über das Abfangen eines Codes.
 */
export const newSecret = () => base32(crypto.randomBytes(20));

/** Der Code für ein bestimmtes Zeitfenster. RFC 4226, „dynamic truncation“. */
export function codeFor(secret, counter) {
  const key = unbase32(secret);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', key).update(message).digest();
  // Die letzten vier Bit sagen, ab welchem Byte gelesen wird. Das oberste Bit fällt weg, damit
  // die Zahl in jeder Sprache dieselbe ist – auch dort, wo Ganzzahlen vorzeichenbehaftet sind.
  const offset = digest[digest.length - 1] & 0x0f;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Stimmt dieser Code – und zu welchem Zeitfenster gehört er?
 *
 * Zurück kommt die Nummer des Fensters, nicht `true`. Der Aufrufer braucht sie: Ein Code gilt
 * dreißig Sekunden, und wer ihn in dieser Zeit abfängt, könnte ihn ein zweites Mal einlösen.
 * `users.totp_last_counter` merkt sich deshalb das zuletzt benutzte Fenster, und ein Code aus
 * demselben oder einem älteren Fenster wird nicht mehr angenommen.
 */
export function check(secret, input, { now = Date.now() } = {}) {
  const code = String(input || '').replace(/\D/g, '');
  if (code.length !== DIGITS) return null;
  const counter = Math.floor(now / 1000 / PERIOD);
  for (let offset = -WINDOW; offset <= WINDOW; offset += 1) {
    const candidate = counter + offset;
    if (candidate < 0) continue;
    // Zeichenweise gleich lang und in konstanter Zeit: Ein Vergleich, der beim ersten
    // abweichenden Zeichen abbricht, verrät über die Laufzeit, wie viele Ziffern stimmten.
    const expected = Buffer.from(codeFor(secret, candidate));
    const got = Buffer.from(code);
    if (expected.length === got.length && crypto.timingSafeEqual(expected, got)) return candidate;
  }
  return null;
}

/**
 * Die Adresse für die App.
 *
 * `issuer` steht zweimal darin – einmal als Namensraum vor dem Doppelpunkt, einmal als
 * Parameter. Das ist nicht doppelt gemoppelt, sondern die Empfehlung von Google: Ältere Apps
 * lesen nur den Namensraum, neuere nur den Parameter.
 */
export function uri({ secret, account, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params}`;
}

// ---------------------------------------------------------------- Das Geheimnis aufbewahren

/**
 * Der Schlüssel für die Verschlüsselung – abgeleitet aus `config.secret`, nicht er selbst.
 *
 * Aus demselben Geheimnis mehrere Dinge zu machen, ohne sie zu trennen, ist die Art von
 * Sparsamkeit, die später weh tut. `hkdf` mit einem eigenen Verwendungszweck sorgt dafür, dass
 * dieser Schlüssel nichts mit den HMACs der Sitzungen zu tun hat.
 */
let cachedKey = null;
function key() {
  if (!cachedKey) {
    cachedKey = Buffer.from(
      crypto.hkdfSync('sha256', Buffer.from(config.secret), Buffer.alloc(0), Buffer.from('totp-secret'), 32)
    );
  }
  return cachedKey;
}

/** AES-256-GCM. Der Zufallswert und die Prüfsumme reisen mit, alles zusammen als Base64. */
function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

/**
 * Und zurück. Gibt `null`, wenn nichts dasteht oder der Wert nicht zu diesem Schlüssel passt.
 *
 * Kein Werfen: Wer `config.secret` austauscht, hat kein kaputtes Panel, sondern Konten, deren
 * Zwei-Faktor-Anmeldung nicht mehr aufgeht – und die Aufrufer hier behandeln das als „nicht
 * eingerichtet“ statt als Serverfehler.
 */
function open(sealed) {
  const text = String(sealed || '');
  if (!text.startsWith('v1:')) return null;
  try {
    const raw = Buffer.from(text.slice(3), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Was ein Konto davon hat

/** Ist die Zwei-Faktor-Anmeldung für dieses Konto scharf? */
export const enabled = (user) => Boolean(user?.totp_enabled_at && user?.totp_secret);

/** Das Geheimnis eines Kontos im Klartext – nur innerhalb dieses Moduls und der Prüfung. */
const secretOf = (user) => (enabled(user) ? open(user.totp_secret) : null);

/** Wie viele Wiederherstellungscodes noch nicht eingelöst sind. */
export function recoveryLeft(userId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .get(userId).n;
}

/** Der Zustand für die Einstellungen. Ohne Geheimnis – das verlässt den Server nur einmal. */
export function statusOf(user) {
  return {
    enabled: enabled(user),
    since: user?.totp_enabled_at || null,
    recovery_left: enabled(user) ? recoveryLeft(user.id) : 0,
    recovery_total: RECOVERY_COUNT,
  };
}

// ---------------------------------------------------------------- Einrichten

/**
 * Die Einrichtung beginnen: ein Geheimnis, das noch nicht gilt.
 *
 * Es liegt in `totp_pending_secret` und nicht in `totp_secret`, und das ist der wichtige Teil:
 * Zwischen „ich habe den QR-Code abfotografiert“ und „ich habe den ersten Code eingegeben“ darf
 * das Konto nicht bereits nach einem Code fragen. Sonst sperrt sich jemand aus, der die App
 * gleich nach dem Scannen wieder gelöscht hat.
 *
 * Der Rückweg trägt das Geheimnis im Klartext – anders geht es nicht, die App muss es bekommen.
 * Er ist deshalb an das Passwort gebunden (siehe die Route) und passiert genau einmal.
 */
export function begin(user, { issuer }) {
  const secret = newSecret();
  db.prepare('UPDATE users SET totp_pending_secret = ?, totp_pending_at = ? WHERE id = ?').run(
    seal(secret),
    Date.now(),
    user.id
  );
  const address = uri({ secret, account: user.email || user.username, issuer });
  return {
    secret,
    uri: address,
    // Als SVG und nicht als Adresse zu einem Bild: Ein QR-Code, den der Browser erst nachlädt,
    // wäre eine zweite Anfrage mit dem Geheimnis darin – und läge danach im Zwischenspeicher.
    qr: qr.svg(address, { label: issuer }),
    digits: DIGITS,
    period: PERIOD,
  };
}

const pendingSecretOf = (user) => {
  if (!user?.totp_pending_secret) return null;
  if (Date.now() - (user.totp_pending_at || 0) > SETUP_MS) return null;
  return open(user.totp_pending_secret);
};

/** Die begonnene Einrichtung wegwerfen. */
export function cancel(userId) {
  db.prepare('UPDATE users SET totp_pending_secret = NULL, totp_pending_at = NULL WHERE id = ?').run(userId);
}

/**
 * Scharf schalten – aber nur gegen einen Code aus der App.
 *
 * Ohne diese Probe schaltete jemand die Zwei-Faktor-Anmeldung ein, dessen App das Geheimnis nie
 * bekommen hat (falsch abfotografiert, App abgestürzt, Uhr zwei Minuten daneben), und stünde
 * beim nächsten Anmelden vor einem Feld, das er nie richtig ausfüllen kann.
 */
export function enable(user, code, ip = null) {
  const secret = pendingSecretOf(user);
  if (!secret) {
    throw bad('Die Einrichtung ist abgelaufen. Bitte noch einmal beginnen.', {
      en: 'The setup has expired. Please start again.',
      code: 'totp-setup-expired',
    });
  }
  const counter = check(secret, code);
  if (counter === null) {
    throw bad('Dieser Code stimmt nicht. Steht die Uhr des Geräts richtig?', {
      en: 'That code is wrong. Is the clock on your device correct?',
      code: 'totp-wrong',
    });
  }
  const now = Date.now();
  db.prepare(
    `UPDATE users SET totp_secret = ?, totp_enabled_at = ?, totp_last_counter = ?,
                      totp_pending_secret = NULL, totp_pending_at = NULL
      WHERE id = ?`
  ).run(seal(secret), now, counter, user.id);
  audit(user.id, 'totp-enabled', null, ip);
  return newRecoveryCodes(user.id);
}

/**
 * Abschalten. Der Aufrufer hat vorher Passwort **und** einen gültigen Code verlangt.
 *
 * Beides, weil das Abschalten die Umkehrung des Einschaltens ist: Wer nur das Passwort hätte,
 * könnte die Zwei-Faktor-Anmeldung entfernen und wäre damit an ihr vorbei.
 */
export function disable(userId, ip = null) {
  db.prepare(
    `UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_counter = NULL,
                      totp_pending_secret = NULL, totp_pending_at = NULL
      WHERE id = ?`
  ).run(userId);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
  audit(userId, 'totp-disabled', null, ip);
}

// ---------------------------------------------------------------- Wiederherstellungscodes

/**
 * Zehn neue Codes. Die alten verfallen dabei – auch die noch nicht benutzten.
 *
 * Wer sich neue ausstellen lässt, tut das, weil er den alten Zettel nicht mehr findet oder weil
 * ihn jemand gesehen hat. Ein Satz, der danach weitergilt, wäre in beiden Fällen falsch.
 *
 * Die Schreibweise ist absichtlich anders als die der Codes aus der App: Buchstaben und Ziffern
 * in zwei Gruppen. Wer sie irgendwo notiert hat, verwechselt sie damit nicht mit den sechs
 * Ziffern, die alle dreißig Sekunden neu sind.
 */
export function newRecoveryCodes(userId) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I, O, 0, 1
  const codes = [];
  for (let index = 0; index < RECOVERY_COUNT; index += 1) {
    let text = '';
    for (let position = 0; position < 10; position += 1) {
      if (position === 5) text += '-';
      text += alphabet[crypto.randomInt(0, alphabet.length)];
    }
    codes.push(text);
  }
  const now = Date.now();
  const insert = db.prepare(
    'INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)'
  );
  db.transaction(() => {
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
    for (const code of codes) insert.run(userId, hashPassword(normalize(code)), now);
  })();
  return codes;
}

/** Groß, ohne Trennzeichen – damit ein abgetippter Code an der Schreibweise nicht scheitert. */
const normalize = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Einen Wiederherstellungscode einlösen. Jeder genau einmal.
 *
 * Durchsucht werden alle offenen Codes des Kontos, weil ein scrypt-Hash keinen Index kennt – bei
 * zehn Einträgen ist das genau zehn Vergleiche, und die kosten zusammen so viel wie eine
 * Passwortprüfung.
 */
export function redeemRecovery(userId, input, ip = null) {
  const value = normalize(input);
  if (value.length !== 10) return false;
  const rows = db
    .prepare('SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .all(userId);
  for (const row of rows) {
    if (!verifyPassword(value, row.code_hash)) continue;
    db.prepare('UPDATE recovery_codes SET used_at = ?, used_ip = ? WHERE id = ?').run(Date.now(), ip, row.id);
    audit(userId, 'totp-recovery-used', { left: rows.length - 1 }, ip);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- Prüfen bei der Anmeldung

/**
 * Der zweite Schritt: sechs Ziffern aus der App oder ein Wiederherstellungscode.
 *
 * Ein einmal benutztes Zeitfenster wird nicht noch einmal angenommen. Ohne diese Sperre wäre ein
 * abgefangener Code dreißig Sekunden lang ein zweiter Zugang – und dreißig Sekunden reichen.
 */
export function verify(user, input, ip = null) {
  const secret = secretOf(user);
  if (!secret) {
    throw new HttpError(500, 'Für dieses Konto lässt sich das Geheimnis nicht lesen.', {
      en: 'The secret for this account cannot be read.',
    });
  }
  const text = String(input || '').trim();

  // Ein Wiederherstellungscode ist zehn Zeichen lang und enthält Buchstaben; ein Code aus der App
  // hat sechs Ziffern. Verwechseln kann man sie nicht, also wird auch nicht geraten.
  if (/[A-Za-z]/.test(text)) {
    if (redeemRecovery(user.id, text, ip)) return { kind: 'recovery', left: recoveryLeft(user.id) };
    return null;
  }

  const counter = check(secret, text);
  if (counter === null) return null;
  if (user.totp_last_counter !== null && counter <= user.totp_last_counter) {
    // Derselbe Code ein zweites Mal. Für den Kontoinhaber ist das ein Doppelklick, für einen
    // Mitleser die zweite Anmeldung – und unterscheiden lässt sich das hier nicht.
    audit(user.id, 'totp-replay', null, ip);
    return null;
  }
  db.prepare('UPDATE users SET totp_last_counter = ? WHERE id = ?').run(counter, user.id);
  return { kind: 'app' };
}

/** Abgelaufene Einrichtungen wegräumen. Läuft im Stundentakt aus index.js. */
export function cleanup() {
  db.prepare(
    'UPDATE users SET totp_pending_secret = NULL, totp_pending_at = NULL WHERE totp_pending_at < ?'
  ).run(Date.now() - SETUP_MS);
}

export { PERIOD, DIGITS, RECOVERY_COUNT };
