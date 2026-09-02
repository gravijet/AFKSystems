// Anhänge an Tickets: Screenshots und Dateien, bis 20 MB, in beide Richtungen.
//
// Ein Ticket ist ein Gespräch, und in einem Gespräch über "der Bot verbindet nicht" ist ein
// Bildschirmfoto oft die halbe Antwort. Deshalb hängen Dateien hier an derselben Stelle wie der
// Text – und zwar egal, ob sie im Panel oder im Discord-Kanal geschickt wurden.
//
// Vier Entscheidungen, die den Rest erklären:
//
//   1. **Die Datei liegt bei uns.** Auch die aus Discord: Discords Adressen laufen inzwischen ab,
//      und ein Ticket, in dem nach zwei Wochen nur noch ein toter Link steht, ist kein Verlauf.
//      Der Bot meldet die Adresse, das Panel holt sich die Datei einmal und behält sie.
//   2. **Der Dateiname bestimmt nie den Pfad.** Auf der Platte heißt jede Datei nach einem
//      Zufallswert; wie sie wirklich heißt, steht in der Datenbank. Damit gibt es keinen Weg,
//      über einen Namen aus dem Verzeichnis herauszulaufen.
//   3. **Ausgeliefert wird nur, was ein Bild ist – alles andere als Download.** Der Inhaltstyp
//      kommt aus den ersten Bytes der Datei, nicht aus dem, was der Browser behauptet hat. Ein
//      als "image/png" hochgeladenes SVG mit Skript wäre sonst ein Skript auf unserer Adresse.
//   4. **Rechte hängen am Ticket.** Wer das Ticket sehen darf, sieht seine Anhänge; interne
//      Notizen tragen ihre Dateien mit sich und bleiben beim Team.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { bad } from './util.js';

/** 20 MB. Mehr nimmt weder das Panel an noch holt es aus Discord. */
export const MAX_BYTES = 20 * 1024 * 1024;

/** Wie viele Dateien an einer Nachricht hängen dürfen. */
export const MAX_PER_MESSAGE = 10;

const ROOT = path.join(config.dataDir, 'tickets');

/**
 * Was gefahrlos im Browser angezeigt werden darf.
 *
 * Bewusst kurz und ohne SVG: SVG ist ein Dokument, kein Bild – es darf Skripte enthalten, und die
 * liefen dann unter unserer Adresse mit den Rechten unserer Sitzung.
 */
const INLINE = new Map([
  ['image/png', ['png']],
  ['image/jpeg', ['jpg', 'jpeg']],
  ['image/gif', ['gif']],
  ['image/webp', ['webp']],
]);

/** Der Inhaltstyp aus den ersten Bytes. Was hier nicht erkannt wird, ist ein Download. */
export function sniff(buffer) {
  const head = buffer.subarray(0, 16);
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 6 && head.subarray(0, 6).toString('latin1').match(/^GIF8[79]a$/)) return 'image/gif';
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

/** Der Name, den der Kunde sieht. Ohne Pfadanteile, ohne Steuerzeichen, nicht endlos lang. */
export function safeName(raw, fallback = 'anhang') {
  const base = String(raw || '')
    .split(/[\\/]/)
    .pop()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return base || fallback;
}

/**
 * Der Ort auf der Platte: zwei Zeichen des Zufallswerts als Unterverzeichnis, damit nicht
 * zehntausend Dateien nebeneinander liegen. Die Ticketnummer steht bewusst **nicht** im Pfad –
 * eine Datei wird hochgeladen, bevor es das Ticket gibt.
 */
const relativePath = (id, mime) => {
  const extension = INLINE.get(mime)?.[0] || 'bin';
  return path.join(id.slice(0, 2), `${id}.${extension}`);
};

/**
 * Eine Datei ablegen.
 *
 * `ticketId` darf offen bleiben: Wer ein neues Ticket schreibt, hängt seinen Screenshot an, bevor
 * es das Ticket gibt. Erst `claim()` beim Abschicken verbindet beides.
 *
 * Erst auf die Platte, dann in die Datenbank: ein Eintrag ohne Datei wäre ein toter Anhang im
 * Verlauf, eine Datei ohne Eintrag nur ein paar ungenutzte Bytes, die das Aufräumen mitnimmt.
 */
export function store({
  ticketId = null,
  messageId = null,
  userId = null,
  name,
  buffer,
  source = 'panel',
  internal = false,
}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw bad('Die Datei ist leer.', { en: 'That file is empty.' });
  }
  if (buffer.length > MAX_BYTES) {
    throw bad('Die Datei ist größer als 20 MB.', { en: 'That file is larger than 20 MB.' });
  }
  const mime = sniff(buffer);
  const id = crypto.randomBytes(12).toString('hex');
  const relative = relativePath(id, mime);
  const absolute = path.join(ROOT, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, buffer, { mode: 0o600 });

  const info = db
    .prepare(
      `INSERT INTO ticket_files (ticket_id, message_id, user_id, name, mime, size, path, source, internal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ticketId,
      messageId,
      userId,
      safeName(name),
      mime,
      buffer.length,
      relative,
      source === 'discord' ? 'discord' : 'panel',
      internal ? 1 : 0,
      Date.now()
    );
  return byId(info.lastInsertRowid);
}

export const byId = (id) => db.prepare('SELECT * FROM ticket_files WHERE id = ?').get(id);

/** Die Anhänge eines Tickets. Ohne `staff` bleiben die aus internen Notizen außen vor. */
export function listFor(ticketId, { staff = false } = {}) {
  const rows = db
    .prepare('SELECT * FROM ticket_files WHERE ticket_id = ? ORDER BY id')
    .all(ticketId);
  return staff ? rows : rows.filter((row) => !row.internal);
}

/** Anhänge zu einer Menge von Nachrichten, gebündelt nach Nachricht. */
export function byMessage(ticketId, { staff = false } = {}) {
  const out = new Map();
  for (const row of listFor(ticketId, { staff })) {
    const key = row.message_id || 0;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(view(row));
  }
  return out;
}

/**
 * Anhänge nur für Nachrichten, die gerade angezeigt werden.
 *
 * Ein langer Ticketverlauf darf nicht bei jedem Nachladen alle alten Screenshots aus der
 * Datenbank ziehen. Die Ticket-Ansicht lädt ihren Verlauf seitenweise; dieselbe Grenze muss für
 * die zugehörigen Dateien gelten, sonst spart die Seitierung genau dort nichts, wo Tickets teuer
 * werden.
 */
export function byMessages(messageIds, { staff = false } = {}) {
  const ids = [...new Set((messageIds || []).map(Number).filter(Number.isInteger))];
  const out = new Map();
  if (!ids.length) return out;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT * FROM ticket_files
        WHERE message_id IN (${placeholders}) ${staff ? '' : 'AND internal = 0'}
        ORDER BY id`
    )
    .all(...ids);
  for (const row of rows) {
    if (!out.has(row.message_id)) out.set(row.message_id, []);
    out.get(row.message_id).push(view(row));
  }
  return out;
}

/** Wie ein Anhang im Panel und im Bot aussieht – nie mit dem Pfad auf der Platte. */
export const view = (row) => ({
  id: row.id,
  name: row.name,
  size: row.size,
  mime: row.mime,
  image: INLINE.has(row.mime),
  source: row.source,
  created_at: row.created_at,
});

export const isInline = (mime) => INLINE.has(mime);

/** Der volle Pfad einer abgelegten Datei – nur für die Ausliefer-Route. */
export const fileOf = (row) => path.join(ROOT, row.path);

/** Die Bytes einer Datei. `null`, wenn sie (etwa nach einem Plattenwechsel) fehlt. */
export function read(row) {
  try {
    return fs.readFileSync(fileOf(row));
  } catch {
    return null;
  }
}

/**
 * Hochgeladene Dateien an eine geschriebene Nachricht hängen.
 *
 * Genommen wird nur, was **diesem** Konto gehört und noch an keinem Ticket hängt. Damit lässt
 * sich mit einer fremden Datei-ID nichts in ein eigenes Ticket ziehen und nichts aus einem
 * fremden Ticket abziehen.
 */
export function claim(ids, { ticketId, messageId, userId, internal = false }) {
  const wanted = [...new Set((ids || []).map(Number).filter(Number.isInteger))].slice(0, MAX_PER_MESSAGE);
  if (!wanted.length) return [];
  const take = db.prepare(
    `UPDATE ticket_files SET ticket_id = ?, message_id = ?, internal = ?
      WHERE id = ? AND ticket_id IS NULL AND user_id IS ?`
  );
  const out = [];
  for (const id of wanted) {
    if (take.run(ticketId, messageId, internal ? 1 : 0, id, userId ?? null).changes) out.push(byId(id));
  }
  return out;
}

/**
 * Eine Datei aus Discord übernehmen.
 *
 * Discord liefert seine Anhänge über eine Adresse mit Ablaufdatum aus. Wir holen sie einmal und
 * legen sie zu uns – danach ist der Anhang so dauerhaft wie das Ticket selbst.
 */
export async function fromUrl({ ticketId, messageId, userId, name, url, size = 0 }) {
  if (size && size > MAX_BYTES) {
    throw bad('Die Datei ist größer als 20 MB.', { en: 'That file is larger than 20 MB.' });
  }
  // Nur von Discord – und nach jeder Weiterleitung erneut prüfen. `fetch` folgt sonst automatisch
  // auch einem 302 auf 127.0.0.1 oder einen Cloud-Metadaten-Endpunkt und würde aus einer erlaubten
  // Discord-Adresse nachträglich ein SSRF-Werkzeug machen.
  const allowed = (raw) => {
    let address;
    try {
      address = new URL(String(raw));
    } catch {
      return null;
    }
    const host = address.hostname.toLowerCase();
    if (
      address.protocol !== 'https:' ||
      address.username ||
      address.password ||
      address.port ||
      !/(^|\.)(discordapp\.(com|net)|discord\.com)$/.test(host)
    ) {
      return null;
    }
    return address;
  };

  let address = allowed(url);
  if (!address) {
    throw bad('Diese Adresse gehört nicht zu Discord.', { en: 'That address does not belong to Discord.' });
  }
  let response;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    response = await fetch(address, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    address = location ? allowed(new URL(location, address)) : null;
    if (!address || redirects === 3) {
      await response.body?.cancel?.().catch?.(() => {});
      throw bad('Unsichere Weiterleitung beim Discord-Anhang.', {
        en: 'Unsafe redirect while fetching the Discord attachment.',
      });
    }
  }
  if (!response.ok) {
    throw bad(`Der Anhang ließ sich nicht laden (${response.status}).`, {
      en: `The attachment could not be fetched (${response.status}).`,
    });
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) {
    throw bad('Die Datei ist größer als 20 MB.', { en: 'That file is larger than 20 MB.' });
  }
  // **Beim Lesen mitzählen, nicht erst danach.** Die Kopfzeile oben ist eine Behauptung der
  // Gegenstelle; fehlt sie oder stimmt sie nicht, lag der ganze Körper trotzdem im Arbeitsspeicher,
  // bevor `store()` ihn ablehnen konnte. Ein einziger Anhang hätte damit so viel Speicher belegen
  // können, wie die andere Seite schickt – und der Dienst hält jeden laufenden Bot.
  const buffer = await readCapped(response, MAX_BYTES);
  return store({ ticketId, messageId, userId, name, buffer, source: 'discord' });
}

/**
 * Den Körper einer Antwort lesen und dabei mitzählen – bei Überschreitung abbrechen.
 *
 * `response.arrayBuffer()` liest, bis nichts mehr kommt: Wer die Länge verschweigt, bestimmt damit,
 * wie viel Arbeitsspeicher hier belegt wird. Ein Zähler über den Datenstücken beendet das nach dem
 * ersten Stück, das die Grenze reißt.
 */
async function readCapped(response, limit) {
  if (!response.body) return Buffer.alloc(0);
  const parts = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > limit) {
      // Den Rest gar nicht erst holen.
      await response.body.cancel?.().catch?.(() => {});
      throw bad('Die Datei ist größer als 20 MB.', { en: 'That file is larger than 20 MB.' });
    }
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts, total);
}

/**
 * Dateien, die niemand mehr braucht.
 *
 * Zwei Fälle, eine Stelle:
 *
 *   * **Abgebrochene Entwürfe.** Wer einen Anhang wählt und den Reiter schließt, hinterlässt einen
 *     Eintrag ohne Ticket. Nach einem Tag ist klar, dass daraus nichts mehr wird.
 *   * **Verwaiste Bytes.** Löscht jemand ein Konto, nimmt die Datenbank Tickets, Nachrichten und
 *     die Einträge hier mit (ON DELETE CASCADE) – die Dateien auf der Platte kennt sie nicht.
 *     Deshalb wird auch aufgeräumt, was in keinem Eintrag mehr vorkommt.
 */
export function sweepOrphans(maxAgeMs = 24 * 60 * 60 * 1000) {
  const rows = db
    .prepare('SELECT * FROM ticket_files WHERE ticket_id IS NULL AND created_at < ?')
    .all(Date.now() - maxAgeMs);
  for (const row of rows) {
    try {
      fs.unlinkSync(fileOf(row));
    } catch {
      /* schon weg */
    }
    db.prepare('DELETE FROM ticket_files WHERE id = ?').run(row.id);
  }

  // Und jetzt die andere Richtung: Was liegt da, wozu es keinen Eintrag mehr gibt?
  const known = new Set(db.prepare('SELECT path FROM ticket_files').all().map((row) => row.path));
  let stale = 0;
  let folders = [];
  try {
    folders = fs.readdirSync(ROOT, { withFileTypes: true });
  } catch {
    return rows.length; // Es gab noch nie einen Anhang.
  }
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const dir = path.join(ROOT, folder.name);
    for (const name of fs.readdirSync(dir)) {
      if (known.has(path.join(folder.name, name))) continue;
      try {
        fs.unlinkSync(path.join(dir, name));
        stale += 1;
      } catch {
        /* schon weg */
      }
    }
  }
  return rows.length + stale;
}
