// Der zweite Schritt bei der Anmeldung: sechs Ziffern per E-Mail, wenn der Browser neu ist.
//
// **Wogegen das hilft.** Ein Passwort ist ein Wissen, und Wissen wandert: Es steht in der Liste
// aus einem Leck bei einem anderen Dienst, in dem Browser, an dem jemand anders auch sitzt, auf
// einem Zettel. Wer es hat, war bisher drin. Der Code fragt zusätzlich nach einem **Besitz** – dem
// Postfach –, und der wandert nicht mit.
//
// **Wogegen es nicht hilft.** Wer das Postfach hat, kommt so oder so ins Konto: Über „Passwort
// vergessen“ führt der Weg seit jeher dorthin. Der Code ist deshalb kein zweiter Faktor im
// strengen Sinn, sondern eine zweite Frage über denselben Kanal, den das Konto ohnehin als
// Rückweg benutzt. Das ist ehrlich gesagt und gehört so ins Panel geschrieben; ein Häkchen, das
// „Zwei-Faktor“ verspricht und dann eine E-Mail schickt, wäre eine Behauptung, die nicht stimmt.
//
// ---------------------------------------------------------------------------------------------
//
// **Warum ein eigenes Cookie und nicht die Browserkennung.**
//
// „Neues Gerät“ hieß im Panel bisher: Es gibt keine Sitzung mit genau diesem `User-Agent`. Das ist
// aus zwei Richtungen falsch. Von der einen: „Chrome auf Windows“ schicken Millionen Browser
// zeichengleich – wer das Passwort hat und zufällig dieselbe verbreitete Fassung benutzt, gilt
// damit als bekannt. Von der anderen: Der `User-Agent` ändert sich bei **jeder** Aktualisierung
// des Browsers, und die Sitzungen verschwinden beim Abmelden – dasselbe Gerät wäre nach jedem
// Abmelden und nach jedem Chrome-Update wieder fremd, und der Kunde bekäme bei jeder Anmeldung
// einen Code. Das ist die zuverlässigste Art, eine Sicherheitsfunktion abschalten zu lassen.
//
// Hier steht deshalb ein Zufallswert in einem eigenen, langlebigen Cookie, und dazu in der
// Datenbank die Liste, für welche Konten dieser Wert schon einmal durch die Prüfung gekommen ist.
// Ein Wert, den nur dieser Browser hat, beantwortet die Frage „warst du das schon mal?“ – und
// genau diese Frage soll er beantworten.
//
// Das Cookie ist **kein Zugang**: Wer es stiehlt, hat damit nur die Auskunft, dass dieser Browser
// bekannt ist. Ohne Passwort öffnet es nichts.

import crypto from 'node:crypto';
import { db, audit } from './db.js';
import { config } from './config.js';
import { token, hashPassword, verifyPassword, deviceOf, HttpError, bad } from './util.js';
import * as mail from './mail.js';

/** Wie lange ein Code gilt. Lang genug für ein Postfach, das nicht sofort abholt. */
export const CODE_MS = 15 * 60_000;

/** So oft darf danebengetippt werden, bevor der Code verfällt. */
export const MAX_TRIES = 5;

/** Und so lange muss zwischen zwei Nachrichten liegen, damit der Knopf kein Postfach flutet. */
const RESEND_MS = 60_000;

/** Wie lange ein Browser als bekannt gilt, ohne dass sich jemand anmeldet. */
const DEVICE_DAYS = 400;

export const DEVICE_COOKIE = 'afk_device';

/** Wie bei Sitzungen: Datenbankkopie und Cookie/Challenge allein sollen jeweils wertlos sein. */
const capabilityDigest = (purpose, value) =>
  `h1:${crypto.createHmac('sha256', config.secret)
    .update(String(purpose))
    .update('\0')
    .update(String(value))
    .digest('hex')}`;

const candidates = (purpose, raw) => {
  const value = String(raw || '').trim();
  if (!value || value.startsWith('h1:')) return [];
  return [capabilityDigest(purpose, value), value];
};

// ---------------------------------------------------------------- Der Browser

/**
 * Den Zufallswert dieses Browsers lesen – und einen anlegen, wenn er keinen hat.
 *
 * Das Cookie wird **bei jeder Anmeldung** neu gesetzt, auch wenn es schon da war: Nur so verlängert
 * sich seine Laufzeit, und ein Browser, der alle vierzehn Tage vorbeikommt, bleibt bekannt.
 *
 * `sameSite: 'lax'` wie beim Sitzungscookie, `httpOnly`, und die Laufzeit in Tagen statt Minuten –
 * das ist der einzige Unterschied. Ein Merkmal, das den Sinn verliert, sobald der Browser
 * geschlossen wird, erkennt nichts wieder.
 */
export function deviceToken(req, res) {
  const existing = readCookie(req, DEVICE_COOKIE);
  const value = /^[A-Za-z0-9_-]{20,64}$/.test(String(existing || '')) ? existing : token(24);
  res.cookie(DEVICE_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https'),
    maxAge: DEVICE_DAYS * 86_400_000,
    path: '/',
  });
  return value;
}

/** Dasselbe, aber ohne etwas zu setzen – für die Frage, ob dieser Browser bekannt ist. */
export function readDeviceToken(req) {
  const value = readCookie(req, DEVICE_COOKIE);
  return /^[A-Za-z0-9_-]{20,64}$/.test(String(value || '')) ? value : null;
}

function readCookie(req, name) {
  const header = req?.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        // Ein kaputtes Prozent-Encoding (`afk_device=%`) ist kein Serverfehler. Ohne dieses
        // `catch` warf `decodeURIComponent` mitten in der Anmeldung, und weil diese Funktion an
        // *jeder* Anmeldung hängt (isKnownDevice), sperrte ein einziges verhunztes Cookie das
        // Konto aus seinem eigenen Browser aus – mit einer 500 und ohne Hinweis, was zu tun wäre.
        // Wie in auth.js: kein lesbarer Wert heißt "kein bekanntes Gerät", und das ist die
        // vorsichtige Antwort.
        return null;
      }
    }
  }
  return null;
}

/** War dieser Browser an diesem Konto schon einmal angemeldet? */
export function isKnownDevice(user, req) {
  const value = readDeviceToken(req);
  if (!value) return false;
  const keys = candidates('known-device', value);
  const row = db
    .prepare('SELECT last_at FROM known_devices WHERE token IN (?, ?) AND user_id = ?')
    .get(...keys, user.id);
  if (!row) return false;
  // Ein Browser, der ein gutes Jahr nicht da war, ist keiner mehr, den wir kennen wollen. Die
  // Zeile bleibt liegen, bis `cleanup()` sie holt – die Auskunft hier ist trotzdem schon „nein“.
  return Date.now() - row.last_at < DEVICE_DAYS * 86_400_000;
}

/**
 * Diesen Browser für dieses Konto merken. Wird nach **jeder** geglückten Anmeldung aufgerufen –
 * auch nach einer über Discord, Google oder einen Bestätigungslink: Wer da hindurchgekommen ist,
 * hat mehr vorgewiesen als ein Passwort, und beim nächsten Mal noch einen Code zu verlangen wäre
 * eine Hürde ohne Gewinn.
 */
export function remember(user, req, res) {
  const value = deviceToken(req, res);
  const stored = capabilityDigest('known-device', value);
  const now = Date.now();
  db.prepare(
    `INSERT INTO known_devices (token, user_id, agent, ip, created_at, last_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(token, user_id) DO UPDATE SET last_at = excluded.last_at,
                                               agent   = excluded.agent,
                                               ip      = excluded.ip`
  ).run(
    stored,
    user.id,
    String(req.headers['user-agent'] || '').slice(0, 200),
    req.ip || null,
    now,
    now
  );
  return value;
}

/**
 * Die bekannten Browser eines Kontos, für die Einstellungen.
 *
 * Ohne den Zufallswert selbst – er steht im Cookie und ist damit ein Merkmal dieses Browsers.
 * Zum Wiederfinden genügt ein kurzer Abdruck, genau wie bei den Sitzungen (siehe auth.js).
 */
export function devicesOf(userId, currentToken = null) {
  const current = new Set(candidates('known-device', currentToken));
  return db
    .prepare('SELECT * FROM known_devices WHERE user_id = ? ORDER BY last_at DESC')
    .all(userId)
    .map((row) => ({
      ref: ref(row.token),
      agent: row.agent,
      device: deviceOf(row.agent),
      ip: row.ip,
      created_at: row.created_at,
      last_at: row.last_at,
      current: current.has(row.token),
    }));
}

const ref = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);

/**
 * Einen Browser vergessen: Beim nächsten Mal fragt er wieder nach einem Code.
 *
 * Gesucht wird über den kurzen Abdruck und nur in den eigenen Zeilen – ein geratener Abdruck kann
 * damit kein fremdes Gerät treffen.
 */
export function forget(userId, wantedRef) {
  const row = db
    .prepare('SELECT token FROM known_devices WHERE user_id = ?')
    .all(userId)
    .find((entry) => ref(entry.token) === String(wantedRef || ''));
  if (!row) return false;
  db.prepare('DELETE FROM known_devices WHERE token = ? AND user_id = ?').run(row.token, userId);
  audit(userId, 'device-forgotten');
  return true;
}

/**
 * Alle vergessen.
 *
 * Wird auch von `changePassword` und `applyReset` aufgerufen, und das ist der eigentliche Grund,
 * warum es diese Funktion gibt: Wer sein Passwort ändert, weil er glaubt, jemand anderes kenne es,
 * meldet damit alle Sitzungen ab – der Browser des anderen bliebe aber „bekannt“ und käme mit dem
 * nächsten geratenen Passwort ohne Code herein. Ein Passwortwechsel setzt hier deshalb alles auf
 * Anfang, das eigene Gerät eingeschlossen.
 */
export function forgetAll(userId) {
  return db.prepare('DELETE FROM known_devices WHERE user_id = ?').run(userId).changes;
}

// ---------------------------------------------------------------- Der Code

/**
 * Braucht diese Anmeldung einen Code?
 *
 * Vier Bedingungen, und jede einzelne ist ein Nein:
 *
 *   1. Der Kontoinhaber will ihn (`users.login_code`).
 *   2. Es gibt einen Postausgang. **Ohne SMTP kein Code** – sonst stünde jemand vor einem Feld,
 *      in das nie etwas eintreffen wird, und käme nie wieder in sein Konto.
 *   3. Die Adresse des Kontos ist bestätigt. Eine unbestätigte Adresse ist eine Behauptung; einen
 *      Zugang daran zu hängen hieße, das Konto an ein Postfach zu binden, von dem niemand weiß, ob
 *      es dem Kontoinhaber gehört.
 *   4. Dieser Browser ist noch nicht bekannt.
 */
export function required(user, req) {
  if (!user?.login_code) return false;
  if (!mail.configured()) return false;
  if (!user.email_verified) return false;
  return !isKnownDevice(user, req);
}

/** Sechs Ziffern, gleichverteilt. `randomInt` und nicht `random()` – das hier ist ein Schlüssel. */
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Den Code erzeugen, verschicken und die Wartemarke zurückgeben.
 *
 * **Schlägt geschlossen fehl, wenn die Nachricht nicht hinausging.** Wer den Anmeldecode
 * eingeschaltet hat, hat sich bewusst für eine zweite Schranke entschieden. Ein klemmender
 * Postausgang darf diese Schranke nicht unbemerkt entfernen und ausgerechnet in einem
 * Störungsfall jedes Konto auf reines Passwort zurückstufen. Der offene Datensatz wird dabei
 * entfernt; ein späterer Versuch beginnt mit einem frischen Code.
 */
export async function start(user, req) {
  // Ältere Marken desselben Kontos verfallen. Wer zweimal hintereinander anmeldet, hat sonst zwei
  // gültige Codes im Postfach und weiß nicht, welcher der richtige ist. Nur die eigene Sorte:
  // In derselben Tabelle liegt auch die Marke der Zwei-Faktor-Anmeldung.
  db.prepare("DELETE FROM login_challenges WHERE user_id = ? AND kind = 'mail'").run(user.id);

  const code = newCode();
  const value = token(24);
  const stored = capabilityDigest('login-challenge', value);
  const now = Date.now();
  db.prepare(
    `INSERT INTO login_challenges (token, user_id, code_hash, sent_at, expires_at, ip, agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    stored,
    user.id,
    hashPassword(code),
    now,
    now + CODE_MS,
    req.ip || null,
    String(req.headers['user-agent'] || '').slice(0, 200),
    now
  );

  const sent = await deliver(user, code, req);
  if (!sent.ok) {
    db.prepare('DELETE FROM login_challenges WHERE token = ?').run(stored);
    console.error(`[anmeldecode] Nachricht an #${user.id} ging nicht hinaus: ${sent.error}`);
    audit(user.id, 'login-code-failed', { error: String(sent.error || '').slice(0, 200) }, req.ip);
    throw new HttpError(
      503,
      'Der Anmeldecode konnte nicht verschickt werden. Bitte später erneut versuchen.',
      {
        en: 'The sign-in code could not be sent. Please try again later.',
        code: 'login-code-delivery',
      }
    );
  }
  audit(user.id, 'login-code-sent', null, req.ip);
  return { token: value, expires_at: now + CODE_MS, hint: maskEmail(user.email) };
}

const deliver = (user, code, req) =>
  mail.sendTo(
    user,
    'login_code',
    {
      code,
      minutes: Math.round(CODE_MS / 60_000),
      device: deviceOf(req.headers['user-agent']) || '',
      ip: req.ip || '',
    },
    // `force`: Diese Nachricht **ist** die Anmeldung. Sie gehört zur Kategorie „Sicherheit“, die
    // sich ohnehin nicht abbestellen lässt – aber selbst wenn der Betreiber den Sicherheitsversand
    // für alle abschaltet, darf das keinen Kunden vor seinem eigenen Konto stehen lassen.
    { force: true }
  );

/**
 * Die Adresse so weit unkenntlich, dass sie beim Wiedererkennen hilft und beim Ausspähen nicht.
 *
 * Auf der Anmeldeseite steht „wir haben an h•••@example.com geschrieben“. Wer sein Postfach kennt,
 * weiß damit, wo er nachsehen muss. Wer nur das Passwort erraten hat, erfährt nicht, welche
 * Adresse er als Nächstes angreifen müsste.
 */
export function maskEmail(address) {
  const [name = '', host = ''] = String(address || '').split('@');
  if (!host) return '';
  const head = name.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(2, Math.min(6, name.length - 1)))}@${host}`;
}

/**
 * Die offene Marke, sofern sie noch gilt. Abgelaufene werden gleich mit weggeräumt.
 *
 * `kind` gehört zwingend dazu. In derselben Tabelle liegen zwei Sorten Wartemarke – der Code aus
 * der E-Mail und der zweite Schritt der Zwei-Faktor-Anmeldung (`totp.js`) –, und ohne diese
 * Bedingung ließe sich eine Marke der einen Sorte am Endpunkt der anderen einlösen. Bei der
 * Zwei-Faktor-Marke steht in `code_hash` nichts; sie an `/auth/login/code` vorbeizureichen hieße,
 * eine Anmeldung gegen einen leeren Hash zu prüfen.
 */
function open(rawToken, kind = 'mail') {
  const keys = candidates('login-challenge', rawToken);
  if (!keys.length) return null;
  const row = db
    .prepare('SELECT * FROM login_challenges WHERE token IN (?, ?) AND kind = ?')
    .get(...keys, kind);
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM login_challenges WHERE token = ?').run(row.token);
    return null;
  }
  return row;
}

// ---------------------------------------------------------------- Die Marke für den zweiten Faktor
//
// Die Zwei-Faktor-Anmeldung braucht dieselbe Wartemarke wie der Anmeldecode: eine Kennung, die
// „das Passwort stimmte“ bedeutet und sonst nichts – keine Sitzung, kein Cookie, kein Konto. Was
// sie nicht braucht, ist ein gespeicherter Code: Den rechnet die App aus, und geprüft wird gegen
// das Geheimnis des Kontos.
//
// Deshalb liegt sie in derselben Tabelle und nicht in einer zweiten daneben. Ablauf, Aufräumen
// und die Frage „zu welchem Konto gehört diese Marke“ gibt es damit genau einmal.

/** Eine Wartemarke ohne Code – für den zweiten Schritt, der nichts zu verschicken hat. */
export function startPending(user, req, kind) {
  db.prepare('DELETE FROM login_challenges WHERE user_id = ? AND kind = ?').run(user.id, kind);
  const value = token(24);
  const now = Date.now();
  db.prepare(
    `INSERT INTO login_challenges
       (token, user_id, code_hash, sent_at, expires_at, ip, agent, created_at, kind)
     VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)`
  ).run(
    capabilityDigest('login-challenge', value),
    user.id,
    now,
    now + CODE_MS,
    req.ip || null,
    String(req.headers?.['user-agent'] || '').slice(0, 200),
    now,
    kind
  );
  return { token: value, expires_at: now + CODE_MS };
}

/**
 * Das Konto hinter einer offenen Marke – oder `null`.
 *
 * Die Marke wird dabei **nicht** verbraucht: Wer sich beim Code vertippt, soll es noch einmal
 * versuchen dürfen. Verbraucht wird sie erst durch `finishPending`.
 */
export function pendingUser(rawToken, kind) {
  const row = open(rawToken, kind);
  if (!row) return null;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  return user || null;
}

/** Die Marke einlösen, damit sie kein zweites Mal gilt. */
export function finishPending(rawToken, kind) {
  const keys = candidates('login-challenge', rawToken);
  if (keys.length) {
    db.prepare('DELETE FROM login_challenges WHERE token IN (?, ?) AND kind = ?').run(...keys, kind);
  }
}

/** Wie oft an dieser Marke schon danebengetippt wurde – und einer mehr. */
export function countTry(rawToken, kind) {
  const row = open(rawToken, kind);
  if (!row) return null;
  const tries = row.tries + 1;
  if (tries > MAX_TRIES) {
    db.prepare('DELETE FROM login_challenges WHERE token = ?').run(row.token);
    return null;
  }
  db.prepare('UPDATE login_challenges SET tries = ? WHERE token = ?').run(tries, row.token);
  return MAX_TRIES - tries;
}

/**
 * Zu wem gehört diese Marke? Nur die Anmeldeadresse, und nur fürs Protokoll.
 *
 * Ein falscher Code gehört in dieselbe Liste wie ein falsches Passwort – der Kunde sieht sie in
 * seinen Einstellungen, und „jemand hat dreimal einen Code geraten“ ist genau die Zeile, an der
 * er merkt, dass sein Passwort in fremden Händen ist. Ohne diese Auskunft stünden die Versuche
 * dort ohne Konto, und damit in niemandes Liste.
 */
export function identifierFor(rawToken, kind = 'mail') {
  const keys = candidates('login-challenge', rawToken);
  if (!keys.length) return '';
  const row = db
    .prepare(
      `SELECT u.email FROM login_challenges c JOIN users u ON u.id = c.user_id
        WHERE c.token IN (?, ?) AND c.kind = ?`
    )
    .get(...keys, kind);
  return row?.email || '';
}

const expired = () =>
  new HttpError(410, 'Dieser Code gilt nicht mehr. Bitte melde dich noch einmal an.', {
    en: 'That code is no longer valid. Please sign in again.',
    code: 'login-code-expired',
  });

/**
 * Den Code einlösen. Gibt das Konto zurück – oder wirft.
 *
 * Der Zähler steht **vor** der Prüfung: Wer abbricht, weil ihm das Ergebnis nicht gefällt, hat
 * seinen Versuch trotzdem verbraucht. Nach dem fünften ist die Marke weg, und es geht nur noch
 * über eine neue Anmeldung – die wiederum unter der gewöhnlichen Bremse aus security.js steht.
 */
export function redeem(rawToken, rawCode) {
  const row = open(rawToken);
  if (!row) throw expired();

  const code = String(rawCode || '').replace(/\D/g, '');
  if (code.length !== 6) {
    throw bad('Der Code besteht aus sechs Ziffern.', { en: 'The code is six digits.' });
  }

  const tries = row.tries + 1;
  if (tries > MAX_TRIES) {
    db.prepare('DELETE FROM login_challenges WHERE token = ?').run(row.token);
    throw expired();
  }
  db.prepare('UPDATE login_challenges SET tries = ? WHERE token = ?').run(tries, row.token);

  if (!verifyPassword(code, row.code_hash)) {
    const left = MAX_TRIES - tries;
    if (left <= 0) {
      db.prepare('DELETE FROM login_challenges WHERE token = ?').run(row.token);
      throw expired();
    }
    throw bad(`Dieser Code stimmt nicht. Noch ${left} Versuch(e).`, {
      en: `That code is wrong. ${left} attempt(s) left.`,
      code: 'login-code-wrong',
    });
  }

  db.prepare('DELETE FROM login_challenges WHERE token = ?').run(row.token);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user) throw expired();
  // Zwischen dem Anfordern des Codes und dem Eintippen liegen Minuten. In dieser Zeit kann ein
  // Konto gesperrt worden sein – dann ist der richtige Code die richtige Antwort auf eine Frage,
  // die niemand mehr stellt.
  if (user.blocked) {
    throw new HttpError(403, 'Dieses Konto ist gesperrt.', { en: 'This account is blocked.' });
  }
  return user;
}

/**
 * Noch einmal schicken – dieselbe Marke, ein frischer Code, **dieselbe Frist**.
 *
 * Drei Entscheidungen stecken darin:
 *
 *   * **Die Marke bleibt.** Der Browser wartet auf sie; eine neue hieße, die halb ausgefüllte
 *     Anmeldeseite wegzuwerfen.
 *   * **Der Code ist neu.** Der alte steht nirgends mehr im Klartext – gespeichert ist nur sein
 *     scrypt-Hash, und das ist der Sinn davon. Ein zweites Mal denselben zu schicken hieße, ihn im
 *     Klartext aufzubewahren, damit ein Knopf ihn wiederholen kann.
 *   * **Die Frist läuft weiter.** Sonst ließe sie sich durch Drücken beliebig verlängern.
 *
 * Der Versuchszähler beginnt von vorn: Wer nach drei Fehlversuchen merkt, dass er in die falsche
 * Nachricht gesehen hat, soll nicht mit zwei Versuchen dastehen. Eine Minute Sperre zwischen zwei
 * Nachrichten begrenzt, was daraus zu holen wäre – und die Bremse aus security.js gilt zusätzlich.
 */
export async function resend(rawToken) {
  const row = open(rawToken);
  if (!row) throw expired();
  if (Date.now() - row.sent_at < RESEND_MS) {
    const wait = Math.ceil((RESEND_MS - (Date.now() - row.sent_at)) / 1000);
    throw bad(`Gerade erst verschickt. Bitte noch ${wait} Sekunden warten.`, {
      en: `Just sent. Please wait another ${wait} seconds.`,
    });
  }
  // Der Klartext des Codes steht nirgends mehr – gespeichert ist nur sein Hash. Ein zweites Mal
  // verschicken heißt deshalb: ein neuer Code an derselben Marke, mit der alten Frist.
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user) throw expired();
  const code = newCode();
  const sent = await deliver(user, code, { headers: { 'user-agent': row.agent || '' }, ip: row.ip });
  if (!sent.ok) {
    throw bad('Die Nachricht ließ sich nicht verschicken. Bitte später noch einmal.', {
      en: 'The message could not be sent. Please try again later.',
    });
  }
  db.prepare('UPDATE login_challenges SET code_hash = ?, sent_at = ?, tries = 0 WHERE token = ?').run(
    hashPassword(code),
    Date.now(),
    row.token
  );
  return { expires_at: row.expires_at, hint: maskEmail(user.email) };
}

/** Abgelaufene Marken und lange stillgelegte Geräte weg. Läuft im Stundentakt aus index.js. */
export function cleanup() {
  db.prepare('DELETE FROM login_challenges WHERE expires_at < ?').run(Date.now());
  db.prepare('DELETE FROM known_devices WHERE last_at < ?').run(
    Date.now() - DEVICE_DAYS * 86_400_000
  );
}
