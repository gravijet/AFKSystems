// Wer klopft, wer kommt herein, und wer bleibt draußen.
//
// Drei Dinge stehen hier, und sie hängen zusammen:
//
//   1. **Anmeldeversuche werden aufgeschrieben** – die geglückten und die gescheiterten, mit
//      Adresse, Zeitpunkt und dem, was eingetippt wurde. Ohne das ist ein Angriff auf ein Konto
//      unsichtbar: Der Betreiber erfährt davon erst, wenn er stattgefunden hat.
//   2. **Zu viele Fehlversuche bremsen** – je Adresse und je Konto, mit einer klaren Wartezeit.
//   3. **Adressen lassen sich sperren** – von Hand, einzeln oder als Netz, mit Grund und Frist.
//
// Warum das nicht der kleine Zähler in index.js sein kann, der dort schon steht: Der schützt die
// Maschine (dreißig teure Passwortprüfungen je Viertelstunde und Adresse) und lebt im Speicher.
// Er kann nicht sagen, **welches** Konto angegriffen wurde, er ist nach einem Neustart leer, und
// im Admin-Bereich taucht er nicht auf. Beides nebeneinander ist kein Widerspruch: das eine ist
// eine Sicherung gegen Last, das andere ein Protokoll mit Konsequenzen.
//
// **Eine Sperre ist nie eine Falle für den Betreiber.** Zwei Regeln sorgen dafür: Die eigene
// Adresse lässt sich nicht sperren, und eine bestehende Administrator-Sitzung kommt durch jede
// Sperre hindurch. Wer sich selbst ausschließt, hat sonst keinen Weg zurück außer SSH – und die
// Sperre steht ausgerechnet in der Datenbank, an die er dann nicht mehr herankommt.

import { db, audit } from './db.js';
import { HttpError } from './util.js';

// ---------------------------------------------------------------- Adressen vergleichen

/**
 * Eine IP-Adresse als Zahl, dazu ihre Länge in Bit.
 *
 * IPv4 und IPv6 stehen hier nebeneinander, weil ein Server beides bekommt – und weil dieselbe
 * Adresse in zwei Schreibweisen ankommen kann: Node liefert eine IPv4-Adresse über einen
 * IPv6-Socket als `::ffff:1.2.3.4`. Das ist dieselbe Adresse, und eine Sperre auf `1.2.3.4` muss
 * sie treffen, sonst sperrt der Betreiber ins Leere.
 */
function parseIp(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return null;
  const mapped = text.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const value = mapped ? mapped[1] : text;

  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    const parts = value.split('.').map(Number);
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    return { bits: 32, value: parts.reduce((sum, part) => (sum << 8n) + BigInt(part), 0n) };
  }

  if (!/^[0-9a-f:]+$/.test(value) || !value.includes(':')) return null;
  const [head, tail = null] = value.split('::');
  const left = head ? head.split(':').filter(Boolean) : [];
  const right = tail ? tail.split(':').filter(Boolean) : [];
  if (tail === null && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array(tail === null ? 0 : missing).fill('0'), ...right];
  if (groups.length !== 8) return null;
  let out = 0n;
  for (const group of groups) {
    if (group.length > 4) return null;
    out = (out << 16n) + BigInt(parseInt(group, 16) || 0);
  }
  return { bits: 128, value: out };
}

/**
 * Trifft eine Sperre diese Adresse?
 *
 * `value` ist entweder eine Adresse oder ein Netz in CIDR-Schreibweise. Verglichen wird über den
 * gemeinsamen Anfang der beiden Zahlen – und nur, wenn beide dieselbe Sorte Adresse sind: Ein
 * IPv4-Netz kann keine IPv6-Adresse enthalten, auch wenn die Zahlen zufällig passen.
 */
export function ipMatches(pattern, ip) {
  const [text, size] = String(pattern || '').split('/');
  const rule = parseIp(text);
  const address = parseIp(ip);
  if (!rule || !address || rule.bits !== address.bits) return false;
  const prefix = size === undefined ? rule.bits : Number(size);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > rule.bits) return false;
  if (prefix === 0) return true;
  const shift = BigInt(rule.bits - prefix);
  return rule.value >> shift === address.value >> shift;
}

/** Sieht die Angabe nach einer Adresse oder einem Netz aus? Sonst hat sie hier nichts verloren. */
export function validBlock(value) {
  const [text, size] = String(value || '').trim().split('/');
  const address = parseIp(text);
  if (!address) return null;
  if (size !== undefined) {
    const prefix = Number(size);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > address.bits) return null;
    return `${text.trim().toLowerCase()}/${prefix}`;
  }
  return text.trim().toLowerCase();
}

// ---------------------------------------------------------------- Sperren

/**
 * Die Sperrliste im Speicher.
 *
 * Sie wird bei jeder Anfrage gefragt, und eine Datenbankabfrage je Bild, Stylesheet und
 * API-Aufruf wäre Arbeit für nichts: Die Liste ändert sich, wenn ein Mensch etwas eintippt, also
 * ein paarmal im Jahr. Geschrieben wird immer über die Funktionen hier, deshalb kann sie nicht
 * hinter der Datenbank zurückbleiben.
 */
let cache = null;

function load() {
  cache = db.prepare('SELECT * FROM ip_blocks ORDER BY created_at DESC').all();
  return cache;
}

export function listBlocks() {
  const now = Date.now();
  return (cache ?? load()).map((row) => ({ ...row, expired: Boolean(row.expires_at && row.expires_at < now) }));
}

/** Die Sperre, die auf diese Adresse passt – oder nichts. Abgelaufene zählen nicht. */
export function blockFor(ip) {
  const now = Date.now();
  for (const row of cache ?? load()) {
    if (row.expires_at && row.expires_at < now) continue;
    if (ipMatches(row.value, ip)) return row;
  }
  return null;
}

export function addBlock({ value, reason = '', days = 0, by = null, ownIp = null }) {
  const clean = validBlock(value);
  if (!clean) {
    throw new HttpError(400, 'Das ist keine Adresse und kein Netz.', {
      en: 'That is neither an address nor a network.',
    });
  }
  // Die Adresse, von der aus gerade gearbeitet wird, ist tabu. Diese Prüfung ist der Grund, warum
  // eine Sperrliste im Panel überhaupt verantwortbar ist.
  if (ownIp && ipMatches(clean, ownIp)) {
    throw new HttpError(400, 'Das ist deine eigene Adresse.', { en: 'That is your own address.' });
  }
  const existing = db.prepare('SELECT id FROM ip_blocks WHERE value = ?').get(clean);
  const expires = days > 0 ? Date.now() + days * 86_400_000 : null;
  if (existing) {
    db.prepare('UPDATE ip_blocks SET reason = ?, expires_at = ?, created_at = ? WHERE id = ?').run(
      String(reason).slice(0, 200),
      expires,
      Date.now(),
      existing.id
    );
  } else {
    db.prepare(
      'INSERT INTO ip_blocks (value, reason, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(clean, String(reason).slice(0, 200), by, Date.now(), expires);
  }
  load();
  audit(by, 'ip-block', { value: clean, days });
  return clean;
}

export function removeBlock(id, by = null) {
  const row = db.prepare('SELECT * FROM ip_blocks WHERE id = ?').get(id);
  if (!row) return false;
  db.prepare('DELETE FROM ip_blocks WHERE id = ?').run(id);
  load();
  audit(by, 'ip-unblock', { value: row.value });
  return true;
}

// ---------------------------------------------------------------- Anmeldeversuche

/** Wie lange ein Versuch aufgehoben wird. Danach sagt er nichts mehr und geht beim Aufräumen weg. */
const KEEP_MS = 30 * 86_400_000;

/** Das Fenster, über das gezählt wird, und die Grenzen darin. */
export const WINDOW_MS = 15 * 60_000;
export const MAX_PER_IP = 10;
export const MAX_PER_ACCOUNT = 20;

export function record({ ip, identifier, ok, reason = null }) {
  db.prepare(
    'INSERT INTO login_attempts (ip, identifier, ok, reason, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(
    String(ip || '').slice(0, 60),
    String(identifier || '').slice(0, 120),
    ok ? 1 : 0,
    reason,
    Date.now()
  );
}

/**
 * Ist jetzt Schluss?
 *
 * Gezählt wird zweierlei: die Fehlversuche **dieser Adresse** und die Fehlversuche **an diesem
 * Konto**. Das erste bremst den, der eine Liste von Passwörtern durchprobiert. Das zweite bremst
 * den, der dasselbe von vielen Adressen aus tut – und es ist bewusst viel großzügiger, denn eine
 * scharfe Grenze je Konto wäre eine Waffe gegen den Kontoinhaber: Wer ein fremdes Konto ärgern
 * will, tippt zwanzigmal falsch, und der Richtige kommt nicht mehr hinein.
 *
 * Geglückte Anmeldungen setzen den Zähler nicht zurück – das täte sonst der Angreifer für sich
 * selbst, sobald er ein einziges Passwort erraten hat.
 */
export function tooMany(ip, identifier) {
  const since = Date.now() - WINDOW_MS;
  const fromIp = db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ok = 0 AND created_at > ?')
    .get(String(ip || ''), since).n;
  if (fromIp >= MAX_PER_IP) return { scope: 'ip', count: fromIp };
  const value = String(identifier || '').trim().toLowerCase();
  if (!value) return null;
  const onAccount = db
    .prepare(
      'SELECT COUNT(*) AS n FROM login_attempts WHERE identifier = ? COLLATE NOCASE AND ok = 0 AND created_at > ?'
    )
    .get(value, since).n;
  return onAccount >= MAX_PER_ACCOUNT ? { scope: 'account', count: onAccount } : null;
}

/** Die letzten Versuche, für die Ansicht. */
export function attempts(limit = 200) {
  return db
    .prepare(
      `SELECT a.*, u.id AS user_id, u.username FROM login_attempts a
         LEFT JOIN users u ON u.email = a.identifier COLLATE NOCASE
                           OR u.username = a.identifier COLLATE NOCASE
        ORDER BY a.id DESC LIMIT ?`
    )
    .all(Math.min(500, Math.max(1, limit)));
}

/**
 * Auffällige Adressen der letzten Tage.
 *
 * Eine Liste von Einzelversuchen sagt wenig – dieselbe Adresse achtzigmal untereinander ist die
 * eigentliche Nachricht. Deshalb steht sie zusammengefasst da, mit dem, was sie probiert hat.
 */
export function busyIps(hours = 48, limit = 25) {
  const since = Date.now() - hours * 3_600_000;
  return db
    .prepare(
      `SELECT ip,
              COUNT(*) AS attempts,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
              COUNT(DISTINCT identifier) AS accounts,
              MAX(created_at) AS last_at
         FROM login_attempts
        WHERE created_at > ? AND ip != ''
        GROUP BY ip
       HAVING failed > 0
        ORDER BY failed DESC, last_at DESC
        LIMIT ?`
    )
    .all(since, limit);
}

/**
 * Alle offenen Sitzungen, quer über alle Konten.
 *
 * Ohne Token: Eine Sitzungskennung ist ein Passwortersatz, und eine Ansicht, die sie zeigt, macht
 * aus jedem Blick über die Schulter eine Übernahme. Abgemeldet wird deshalb über die Zeilennummer
 * und nicht über den Schlüssel.
 */
export function sessions(limit = 200) {
  return db
    .prepare(
      `SELECT s.rowid AS id, s.user_id, s.created_at, s.expires_at, s.ip, s.agent,
              u.username, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.expires_at > ?
        ORDER BY s.created_at DESC LIMIT ?`
    )
    .all(Date.now(), limit);
}

export function revokeSession(id, by = null) {
  const row = db.prepare('SELECT rowid AS id, user_id FROM sessions WHERE rowid = ?').get(id);
  if (!row) return false;
  db.prepare('DELETE FROM sessions WHERE rowid = ?').run(id);
  audit(by, 'session-revoke', { user: row.user_id });
  return true;
}

/** Alte Versuche und abgelaufene Sperren wegräumen. Läuft im Stundentakt aus index.js. */
export function cleanup() {
  db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(Date.now() - KEEP_MS);
  const gone = db.prepare('DELETE FROM ip_blocks WHERE expires_at IS NOT NULL AND expires_at < ?').run(
    Date.now() - 86_400_000
  );
  if (gone.changes) load();
}
