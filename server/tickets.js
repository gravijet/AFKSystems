// Support-Tickets. Ein Ticket ist ein Betreff und ein Verlauf aus Nachrichten – mehr braucht es
// nicht, und weniger würde beim Nachfragen nerven.
//
// Eine Kategorie gibt es bewusst **nicht** mehr. Sie stand als Pflichtfeld vor jedem Ticket
// ("Allgemeine Frage", "Missbrauch melden") und hat nichts entschieden: gelesen wurde ohnehin
// alles, sortiert wurde nach Zeit und Tarif. Wer schreibt, soll den Betreff und die Sache
// hinschreiben, nicht erst ein Schubfach wählen. Die Spalte bleibt in der Datenbank, damit alte
// Tickets ihren Eintrag behalten.
//
// Vier Dinge kommen dazu, die ein Ticket vom Briefkasten unterscheiden:
//
//   * An einem Ticket dürfen **mehrere Kunden** hängen. Wer zu zweit einen Serverplatz betreibt,
//     soll nicht zwei Tickets über dieselbe Sache aufmachen müssen; das Team kann jemanden
//     dazuholen.
//   * Ein geschlossenes Ticket geht **durch eine Antwort wieder auf**. Ein Kunde, bei dem etwas
//     doch nicht stimmt, soll nicht bei null anfangen und den Verlauf verlieren.
//   * Jedes Ticket kann einen **Kanal in Discord** haben. Was hier steht, steht dort, und
//     umgekehrt – der Abgleich läuft über bridge.js.
//   * An jede Nachricht dürfen **Dateien** (attachments.js): Screenshots und Anhänge bis 20 MB,
//     im Panel wie im Discord-Kanal, in beide Richtungen.
//
// ---------------------------------------------------------------- Wer ist dran?
//
// Ein Ticket hat **zwei** Angaben, die oft verwechselt wurden, und genau daraus kam der Unsinn,
// dass an einem beantworteten oder geschlossenen Ticket „Wartet“ stand:
//
//   `status`        Bei wem der Vorgang liegt. `open` = bei uns, `answered` = beim Kunden,
//                   `closed` = bei niemandem mehr. Das ist die einzige Wahrheit darüber, ob noch
//                   jemand etwas tun muss – die Warteschlange des Teams sind die offenen Tickets.
//   `unread_*`      Ob für diese Seite etwas **Ungelesenes** dasteht. Das ist ein Punkt an der
//                   Zeile, kein Zustand: gesetzt wird er nur, wenn die andere Seite schreibt,
//                   gelöscht, sobald man das Ticket aufmacht.
//
// Einen vierten Zustand `waiting` gab es früher; er hieß im Panel „Wartet auf dich“ und war
// damit dasselbe wie `answered`, nur mit anderem Namen. Zwei Wörter für einen Zustand heißt:
// beide stehen irgendwann falsch da. Bestehende Tickets sind auf `answered` umgestellt
// (Migration 014), und wer den alten Namen noch schickt – ein alter Bot etwa –, bekommt ihn
// stillschweigend darauf abgebildet.
//
// Daraus folgt der Rest von selbst:
//
//   * Der Kunde schreibt  → `open`, und beim Team steht ein ungelesener Punkt.
//   * Das Team antwortet  → `answered`, ungelesen beim Kunden, beim Team nichts mehr.
//   * Zustand von Hand    → das Team hat entschieden; ungelesen ist danach beim Team nichts.
//   * Geschlossen         → für das Team ist nichts mehr offen. Schließt das Team, ist das für
//                           den Kunden eine Neuigkeit; schließt er selbst, weiß er es schon.
//
// ---------------------------------------------------------------- Hat er es gelesen?
//
// Der Punkt oben beantwortet die Frage nicht, die im Support am häufigsten gestellt wird. Er ist
// ein Ja/Nein für eine ganze Seite: Er sagt nicht, **wer** von mehreren Beteiligten gelesen hat,
// nicht **wann**, und vor allem nicht **bis wohin** – wer ein Ticket aufmacht, bevor die Antwort
// geschrieben ist, hat sie nicht gelesen, und der Punkt war trotzdem weg.
//
// Deshalb steht in `ticket_reads` je Person und Rolle eine Marke: die höchste Nachricht, die sie
// gesehen hat, und wann. Daraus ergibt sich alles Weitere von selbst – „gelesen“ heißt
// `last_message_id >= id`, „gelesen um“ ist eine echte Uhrzeit, und beides gilt je Beteiligtem
// einzeln. Die Marke geht nur vorwärts: Ein zweiter Blick auf ein altes Ticket macht eine bereits
// gelesene Antwort nicht wieder ungelesen.
//
// Dieselbe Person kann zwei Rollen haben – ein Administrator ist unter „Support“ Kunde und unter
// „Alle Tickets“ Team –, deshalb gehört `staff` zum Schlüssel. Sonst stünde beim Kunden „gelesen“,
// weil jemand im Admin-Bereich vorbeigesehen hat.
//
// ---------------------------------------------------------------- Wie lange hat es gedauert?
//
// Drei Zeitstempel am Ticket, aus denen sich die Zahlen ergeben, an denen ein Support gemessen
// wird: `first_reply_at` (die erste Antwort des Teams – die eine Zahl, die der Kunde spürt),
// `last_customer_at` und `last_staff_at` (wer zuletzt am Zug war und seit wann). Sie ließen sich
// jedes Mal aus dem Verlauf errechnen, aber nicht in einer Liste über dreihundert Tickets – und
// genau dort werden sie gebraucht.

import { db, audit } from './db.js';
import { bad, notFound, forbidden, requireString } from './util.js';
import * as files from './attachments.js';
import { avatarOf, displayNameOf as profileName } from './profile.js';
import { isPayingUser } from './billing.js';
import * as mail from './mail.js';
import * as notify from './notify.js';
import { bridge } from './bridge.js';

export const STATUSES = ['open', 'answered', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

/** Alte Namen, die es nicht mehr gibt – siehe oben. */
const RENAMED = { waiting: 'answered' };
export const normalizeStatus = (status) => RENAMED[status] || String(status || '');

const ticketRow = db.prepare('SELECT * FROM tickets WHERE id = ?');
export const byId = (id) => ticketRow.get(id);
export const byChannel = (channelId) =>
  db.prepare('SELECT * FROM tickets WHERE discord_channel_id = ?').get(String(channelId));

// ---------------------------------------------------------------- Beteiligte

/** Alle Kunden, die dieses Ticket sehen dürfen – der Ersteller zuerst. */
export function participants(ticketId) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.discord_name, u.google_name, u.email, u.language,
              u.discord_id, u.discord_avatar, u.google_avatar, u.avatar_source, 1 AS owner FROM tickets t
         JOIN users u ON u.id = t.user_id WHERE t.id = ?
       UNION
       SELECT u.id, u.username, u.full_name, u.discord_name, u.google_name, u.email, u.language,
              u.discord_id, u.discord_avatar, u.google_avatar, u.avatar_source, 0 AS owner FROM ticket_users tu
         JOIN users u ON u.id = tu.user_id WHERE tu.ticket_id = ?
       ORDER BY owner DESC, u.username`
    )
    .all(ticketId, ticketId)
    // Das Bild statt des Bild-Kürzels: Wer diese Liste zeichnet, soll die Adresse von Discords
    // Bildserver nicht selbst zusammensetzen müssen – sonst stünde sie an drei Stellen im Panel.
    .map((row) => ({ ...row, display_name: profileName(row), avatar: avatarOf(row) }));
}

/** Dieselben Spalten, aus denen `participants` Name und Bild baut – für jeden anderen Join. */
const PERSON_COLUMNS = `u.username, u.full_name, u.discord_name, u.google_name, u.email,
                        u.discord_id, u.discord_avatar, u.google_avatar, u.avatar_source`;

export const isParticipant = (ticketId, userId) =>
  Boolean(
    db
      .prepare(
        `SELECT 1 FROM tickets WHERE id = ? AND user_id = ?
         UNION SELECT 1 FROM ticket_users WHERE ticket_id = ? AND user_id = ?`
      )
      .get(ticketId, userId, ticketId, userId)
  );

export function get(id, user) {
  const ticket = ticketRow.get(id);
  if (!ticket) throw notFound('Dieses Ticket gibt es nicht.', { en: 'No such ticket.' });
  if (user.role !== 'admin' && !isParticipant(ticket.id, user.id)) throw forbidden();
  return ticket;
}

/**
 * Die Kundenseite "Support" bleibt auch für Administratoren eine persönliche Ansicht.
 * Admin-Rechte gelten ausschließlich unter /admin/tickets; sonst könnte ein Admin durch das
 * Ändern der URL fremde Tickets samt internen Notizen im eigenen Support öffnen.
 */
export function getForParticipant(id, user) {
  const ticket = ticketRow.get(id);
  if (!ticket) throw notFound('Dieses Ticket gibt es nicht.', { en: 'No such ticket.' });
  if (!isParticipant(ticket.id, user.id)) throw forbidden();
  return ticket;
}

/**
 * Jemanden dazuholen – oder wieder herausnehmen.
 *
 * Der Discord-Kanal gehört zum Ticket und nicht daneben: Wer hier dazukommt, bekommt dort Zugang,
 * und wer herausgenommen wird, verliert ihn. Vorher stand der Zusatz nur im Panel, und der
 * Dazugeholte sah im Discord-Kanal desselben Vorgangs nichts – bei einem Ticket, das dort läuft,
 * heißt das: Er war dabei und wusste es nicht.
 */
export function addUser(ticket, userId, by) {
  if (ticket.user_id === userId) return participants(ticket.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw notFound('Diesen Nutzer gibt es nicht.', { en: 'No such user.' });
  db.prepare(
    `INSERT INTO ticket_users (ticket_id, user_id, added_by, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(ticket_id, user_id) DO NOTHING`
  ).run(ticket.id, userId, by, Date.now());
  system(ticket, `${profileName(user)} was added to the ticket.`, {
    meta: { key: 'added', vars: { who: profileName(user) } },
  });
  audit(by, 'ticket-add-user', { ticket: ticket.id, user: userId });
  if (user.discord_id) {
    bridge.emit('ticket.access', { ticket_id: ticket.id, discord_id: user.discord_id, allow: true });
  }
  return participants(ticket.id);
}

export function removeUser(ticket, userId, by) {
  if (ticket.user_id === userId) {
    throw bad('Der Ersteller lässt sich nicht entfernen.', { en: 'The author cannot be removed.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  db.prepare('DELETE FROM ticket_users WHERE ticket_id = ? AND user_id = ?').run(ticket.id, userId);
  if (user) {
    system(ticket, `${profileName(user)} was removed from the ticket.`, {
      meta: { key: 'removed', vars: { who: profileName(user) } },
    });
  }
  audit(by, 'ticket-remove-user', { ticket: ticket.id, user: userId });
  if (user?.discord_id) {
    bridge.emit('ticket.access', { ticket_id: ticket.id, discord_id: user.discord_id, allow: false });
  }
  return participants(ticket.id);
}

// ---------------------------------------------------------------- Lesen

/**
 * Die Erwähnungen einer Nachricht aus Discord, wie sie in der Datenbank landen.
 *
 * Discord schreibt Erwähnungen als Zahlen (`<@1538…>`); wer den Namen dazu kennt, ist der Bot.
 * Er schickt ihn mit, und hier wird geprüft, was davon eine Auflösung sein kann: eine ID aus
 * Ziffern, eine bekannte Art, ein Name, der in eine Zeile passt. Alles andere fällt weg – aus
 * diesem Feld wird später HTML gebaut, und was hier ungeprüft hineinkäme, stünde dort ungeprüft
 * wieder heraus.
 *
 * Höchstens fünfzig Einträge: Mehr Erwähnungen hat keine Nachricht, die ein Mensch geschrieben hat.
 */
const MENTION_KINDS = ['user', 'role', 'channel'];

export function packMentions(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [id, entry] of Object.entries(raw).slice(0, 50)) {
    if (!/^\d{15,25}$/.test(String(id))) continue;
    const kind = MENTION_KINDS.includes(entry?.type) ? entry.type : 'user';
    const name = String(entry?.name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!name) continue;
    const color = /^#[0-9a-fA-F]{6}$/.test(String(entry?.color || '')) ? String(entry.color) : undefined;
    out[id] = color ? { type: kind, name, color } : { type: kind, name };
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/**
 * Und wieder heraus. Kaputtes JSON ist kein Grund, eine Nachricht nicht anzuzeigen.
 *
 * Dasselbe gilt für jedes andere Beiwerk an einer Nachricht, das als JSON in einer Spalte steht –
 * deshalb heißt die Funktion nach dem, was sie tut, und `unpackMentions` ist nur noch der Name,
 * unter dem sie schon aufgerufen wird.
 */
export function unpackJson(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export const unpackMentions = unpackJson;

export function messages(ticketId, { staff = false, before = null, after = null, limit = null, newest = false } = {}) {
  const where = ['m.ticket_id = ?'];
  const values = [ticketId];
  if (!staff) where.push('m.internal = 0');
  if (Number.isInteger(before) && before > 0) {
    where.push('m.id < ?');
    values.push(before);
  }
  if (Number.isInteger(after) && after >= 0) {
    where.push('m.id > ?');
    values.push(after);
  }
  const capped = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 250) : null;
  const reverse = Boolean(capped && newest && !(Number.isInteger(after) && after >= 0));
  const rows = db
    .prepare(
      `SELECT m.*, u.username, u.full_name, u.discord_name, u.google_name,
              u.discord_id AS author_discord_id, u.discord_avatar AS author_avatar,
              u.google_avatar AS author_google_avatar, u.avatar_source AS author_avatar_source,
              u.email AS author_email
         FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE ${where.join(' AND ')} ORDER BY m.id ${reverse ? 'DESC' : 'ASC'}${capped ? ' LIMIT ?' : ''}`
    )
    .all(...values, ...(capped ? [capped] : []));
  // Für den Browser bleibt der Verlauf immer chronologisch. Nur die Abfrage nach der jüngsten
  // Seite läuft rückwärts, damit SQLite nicht erst tausende alte Zeilen lesen muss.
  if (reverse) rows.reverse();
  const visible = rows;
  // Anhänge gehören zur Nachricht, nicht daneben. Sie hier anzuhängen heißt: jede Oberfläche,
  // die Nachrichten liest, hat sie automatisch – ohne einen zweiten Aufruf und ohne dass jemand
  // das Nachladen vergessen kann.
  const attachments = files.byMessages(visible.map((row) => row.id), { staff });
  return visible.map((row) => {
    // Die zwei Discord-Spalten sind nur da, um daraus ein Bild zu bauen – sie selbst gehören
    // nicht in die Antwort. Deshalb werden sie hier ausgepackt und fallen gelassen.
    const {
      author_discord_id: discordId,
      author_avatar: avatarHash,
      author_google_avatar: googleAvatar,
      author_avatar_source: avatarSource,
      author_email: email,
      ...rest
    } = row;
    return {
      ...rest,
      display_name: row.user_id ? profileName(row) : row.author_name || 'Konto',
      // Aufgelöst und nicht als Zeichenkette: Wer diese Liste liest, soll nicht selbst noch
      // einmal `JSON.parse` in ein `try` packen müssen. Das gilt für beide Felder – `meta` sagt
      // bei einer Systemzeile, **was** sie aussagt, damit sie in der Sprache des Lesers stehen
      // kann statt in der, in der sie geschrieben wurde.
      mentions: unpackMentions(row.mentions),
      meta: unpackJson(row.meta),
      avatar: avatarOf({
        ...row,
        email,
        discord_id: discordId,
        discord_avatar: avatarHash,
        google_avatar: googleAvatar,
        avatar_source: avatarSource,
      }),
      files: attachments.get(row.id) || [],
    };
  });
}

// ---------------------------------------------------------------- Gelesen bis hierher
//
// Siehe die Erklärung oben. Drei Funktionen genügen dafür: die Marke setzen, die Marken lesen,
// und – für die Liste – die eine Frage „hat die andere Seite die letzte Nachricht gesehen?“.

/** Die jüngste Nachricht, die diese Seite überhaupt sehen darf. */
const newestVisible = db.prepare(
  `SELECT MAX(id) AS id FROM ticket_messages WHERE ticket_id = ? AND (internal = 0 OR ? = 1)`
);

const readMark = db.prepare(
  'SELECT last_message_id FROM ticket_reads WHERE ticket_id = ? AND user_id = ? AND staff = ?'
);

/**
 * „Bis hierher gesehen.“
 *
 * Die Marke geht ausschließlich vorwärts (`WHERE excluded.last_message_id > …`): Wer ein altes
 * Ticket noch einmal aufmacht, während inzwischen nichts dazugekommen ist, verschiebt nichts –
 * und wer es öffnet, *bevor* die Antwort geschrieben ist, hat sie damit nicht gelesen.
 *
 * Gemeldet wird nur, was sich wirklich geändert hat. Sonst ginge bei jedem Nachladen des Verlaufs
 * – und das ist ein Aufruf alle paar Sekunden – eine Live-Meldung an alle Beteiligten hinaus.
 *
 * Zurück kommt der Stand **davor**. Daraus zeichnet die Oberfläche den Strich „Neue Nachrichten“
 * an der richtigen Stelle: Öffnen heißt gelesen, aber wo man aufgehört hat, weiß danach niemand
 * mehr – außer man merkt es sich in dem Moment, in dem man es überschreibt.
 */
export function see(ticket, user, { staff = false, upto = null } = {}) {
  const before = readMark.get(ticket.id, user.id, staff ? 1 : 0)?.last_message_id ?? 0;
  const newest = Number.isInteger(upto) ? upto : newestVisible.get(ticket.id, staff ? 1 : 0)?.id || 0;
  if (!newest || before >= newest) return before;
  const now = Date.now();
  db.prepare(
    `INSERT INTO ticket_reads (ticket_id, user_id, staff, last_message_id, read_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ticket_id, user_id, staff) DO UPDATE
        SET last_message_id = excluded.last_message_id, read_at = excluded.read_at
      WHERE excluded.last_message_id > ticket_reads.last_message_id`
  ).run(ticket.id, user.id, staff ? 1 : 0, newest, now);
  const mark = {
    ticket_id: ticket.id,
    user_id: user.id,
    staff,
    last_message_id: newest,
    read_at: now,
    name: profileName(user),
  };
  // Live an die andere Seite. Das ist der ganze Sinn der Sache: Wer eine Antwort geschrieben hat,
  // soll sehen, dass sie angekommen ist – ohne die Seite neu zu laden.
  bridge.emit('ticket.read', mark);
  return before;
}

/** Alle Lesemarken eines Tickets, mit Name und Bild – die jüngste zuerst. */
export function reads(ticketId) {
  return db
    .prepare(
      `SELECT r.user_id, r.staff, r.last_message_id, r.read_at, u.id, ${PERSON_COLUMNS}
         FROM ticket_reads r JOIN users u ON u.id = r.user_id
        WHERE r.ticket_id = ? ORDER BY r.read_at DESC`
    )
    .all(ticketId)
    .map((row) => ({
      user_id: row.user_id,
      staff: Boolean(row.staff),
      last_message_id: row.last_message_id,
      read_at: row.read_at,
      display_name: profileName(row),
      avatar: avatarOf(row),
    }));
}

/**
 * Die Lesemarke einer Seite als zwei Spalten für eine Liste.
 *
 * Beide Werte kommen aus **derselben** Zeile – die am weitesten gelesene. Getrennte
 * `MAX()`-Aufrufe hätten sonst die Nachricht des einen mit der Uhrzeit des anderen kombiniert.
 */
const readOf = (staff) => `
  (SELECT r.last_message_id FROM ticket_reads r
     WHERE r.ticket_id = t.id AND r.staff = ${staff}
     ORDER BY r.last_message_id DESC, r.read_at DESC, r.user_id LIMIT 1)`;
const readAtOf = (staff) => `
  (SELECT r.read_at FROM ticket_reads r
     WHERE r.ticket_id = t.id AND r.staff = ${staff}
     ORDER BY r.last_message_id DESC, r.read_at DESC, r.user_id LIMIT 1)`;

/** Die letzte Nachricht, die beide Seiten sehen – für die Vorschau in der Liste. */
const LAST_MESSAGE = `
  (SELECT m.id FROM ticket_messages m
    WHERE m.ticket_id = t.id AND m.internal = 0 AND m.role != 'system'
    ORDER BY m.id DESC LIMIT 1)`;

// ---------------------------------------------------------------- Listen

export function listFor(user) {
  return db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.internal = 0) AS messages,
              (t.user_id != ?) AS shared,
              last.id AS last_id, last.body AS last_body, last.role AS last_role,
              last.created_at AS last_at,
              ${readOf(1)} AS staff_read_id, ${readAtOf(1)} AS staff_read_at
         FROM tickets t
         LEFT JOIN ticket_messages last ON last.id = ${LAST_MESSAGE}
        WHERE t.user_id = ? OR EXISTS (SELECT 1 FROM ticket_users tu WHERE tu.ticket_id = t.id AND tu.user_id = ?)
        ORDER BY t.status = 'closed', t.updated_at DESC`
    )
    .all(user.id, user.id, user.id)
    .map((row) => ({
      ...row,
      // Der Kunde sieht an seiner eigenen letzten Nachricht, ob das Team sie schon gelesen hat.
      // Das ist dieselbe Auskunft, die das Team über ihn bekommt – eine Lesebestätigung, die nur
      // in eine Richtung geht, ist eine Einbahnstraße, die niemand erklären möchte.
      seen_at: row.last_role === 'user' && row.staff_read_id >= row.last_id ? row.staff_read_at : null,
    }));
}

/**
 * Wonach die Arbeitsliste des Teams sortiert ist.
 *
 * `queue` ist die Voreinstellung und die einzige, die eine Meinung hat: zuerst, was bei uns liegt,
 * darin das Dringendste, darin das Älteste. Die anderen drei beantworten je eine Frage, die man
 * beim Aufräumen stellt – „wer wartet am längsten?“, „was ist neu?“, „was ist wichtig?“.
 */
const SORTS = {
  queue: `CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END,
          CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
          t.updated_at DESC`,
  // Am längsten unbeantwortet zuerst: Wer seit gestern wartet, steht über dem von vor zehn Minuten.
  waiting: `CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END,
            COALESCE(t.last_customer_at, t.created_at) ASC`,
  newest: 't.created_at DESC',
  priority: `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
             t.updated_at DESC`,
};

export function listAll({
  status = null,
  priority = null,
  search = '',
  assignment = '',
  stale = false,
  unanswered = false,
  staffId = null,
  sort = 'queue',
} = {}) {
  const where = [];
  const values = [];
  // Beide Werte kommen aus der Adresszeile und können damit alles sein – auch eine Liste
  // (`?status=a&status=b` gibt Express als Array heraus). Ein Array bindet SQLite nicht, und die
  // ganze Ticketübersicht antwortete mit einem Serverfehler. Geprüft wird gegen die Liste der
  // Zustände, die es wirklich gibt; alles andere heißt schlicht "kein Filter".
  const wantedStatus = STATUSES.includes(normalizeStatus(status)) ? normalizeStatus(status) : null;
  const wantedPriority = PRIORITIES.includes(priority) ? priority : null;
  if (wantedStatus) {
    where.push('t.status = ?');
    values.push(wantedStatus);
  }
  if (wantedPriority) {
    where.push('t.priority = ?');
    values.push(wantedPriority);
  }
  if (assignment === 'unassigned') where.push('t.assigned_to IS NULL');
  if (assignment === 'mine' && Number.isInteger(staffId)) {
    where.push('t.assigned_to = ?');
    values.push(staffId);
  }
  if (stale) {
    // Ein Tag ohne Bewegung ist keine harte SLA, aber ein sehr brauchbarer Arbeitsfilter.
    where.push("t.status = 'open' AND t.updated_at < ?");
    values.push(Date.now() - 86_400_000);
  }
  // Nie beantwortet: Das ist der schlimmste Fall im Support und war bisher aus keiner Liste
  // herauszufiltern – ein Ticket, auf das nie jemand geantwortet hat, sah aus wie jedes andere.
  if (unanswered) where.push("t.status = 'open' AND t.first_reply_at IS NULL");
  if (search) {
    where.push('(t.subject LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR t.id = ?)');
    values.push(`%${search}%`, `%${search}%`, `%${search}%`, Number(search) || 0);
  }
  return db
    .prepare(
      `SELECT t.*, ${PERSON_COLUMNS},
              (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages,
              (SELECT COUNT(*) FROM ticket_users tu WHERE tu.ticket_id = t.id) AS extra_users,
              (SELECT COUNT(*) FROM ticket_files f WHERE f.ticket_id = t.id) AS files,
              COALESCE(NULLIF(a.full_name, ''), a.discord_name, a.google_name, 'Konto #' || a.id) AS assigned_name,
              a.discord_id AS a_discord_id, a.discord_avatar AS a_discord_avatar,
              a.google_avatar AS a_google_avatar, a.avatar_source AS a_avatar_source,
              a.email AS a_email,
              -- Die letzte Nachricht, die auch der Kunde sieht: Sie steht als Vorschau in der
              -- Zeile, damit man eine Warteschlange lesen kann, ohne dreißig Tickets zu öffnen.
              last.id AS last_id, last.body AS last_body, last.role AS last_role,
              last.created_at AS last_at,
              ${readOf(0)} AS customer_read_id, ${readAtOf(0)} AS customer_read_at
         FROM tickets t JOIN users u ON u.id = t.user_id
         LEFT JOIN users a ON a.id = t.assigned_to
         LEFT JOIN ticket_messages last ON last.id = ${LAST_MESSAGE}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${SORTS[sort] || SORTS.queue}
        LIMIT 300`
    )
    .all(...values)
    .map((row) => {
      const {
        a_discord_id: assignedDiscord,
        a_discord_avatar: assignedAvatar,
        a_google_avatar: assignedGoogle,
        a_avatar_source: assignedSource,
        a_email: assignedMail,
        ...rest
      } = row;
      // `t.*` bringt die Nummer des **Tickets** als `id` mit. Ohne diese Zeile hieß ein Kunde
      // ohne hinterlegten Namen „Konto #14“ – und gemeint war Ticket 14, nicht Konto 14.
      const person = { ...row, id: row.user_id };
      return {
        ...rest,
        display_name: profileName(person),
        avatar: avatarOf(person),
        assigned_avatar: row.assigned_to
          ? avatarOf({
              email: assignedMail,
              discord_id: assignedDiscord,
              discord_avatar: assignedAvatar,
              google_avatar: assignedGoogle,
              avatar_source: assignedSource,
            })
          : null,
        // Die Frage, für die es diese Tabelle gibt: Hat der Kunde unsere letzte Antwort gesehen?
        // Nur an einer Teamantwort ist sie sinnvoll – an seiner eigenen Nachricht wäre sie eine
        // Selbstverständlichkeit.
        seen_at:
          row.last_role === 'staff' && row.customer_read_id >= row.last_id ? row.customer_read_at : null,
      };
    });
}

/**
 * Ein einzelnes Ticket mit dem, was in der Liste aus einem Join kommt: Name und Bild des
 * Bearbeiters.
 *
 * Ohne das antwortet jede Route, die *ein* Ticket zurückgibt – das Zuweisen etwa –, mit einer
 * Zeile ohne diese beiden Felder. Die Oberfläche schreibt sie über den vorherigen Stand und
 * zeichnet „noch niemand“ an ein Ticket, das man gerade eben zugewiesen hat.
 */
export function withAssignee(ticket) {
  if (!ticket?.assigned_to) return ticket;
  const person = db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.assigned_to);
  if (!person) return ticket;
  return { ...ticket, assigned_name: profileName(person), assigned_avatar: avatarOf(person) };
}

/**
 * Die Zahlen für den Admin-Bereich.
 *
 * `open` ist alles, was noch läuft (offen **und** beantwortet); `waiting` ist davon der Teil, der
 * bei uns liegt. Vorher zählte die zweite Zahl ungelesene Tickets – dann verschwand sie, sobald
 * jemand ein Ticket nur aufgemacht hatte, obwohl die Antwort weiter ausstand.
 *
 * Dazu die drei, die sagen, *wie gut* der Support gerade läuft und nicht nur *wie viel* ansteht:
 * nie beantwortet, seit über einem Tag ohne Bewegung, und die mittlere Zeit bis zur ersten
 * Antwort über die letzten dreißig Tage. Der Median und nicht der Durchschnitt: Ein einziges
 * Ticket, das über Weihnachten liegen blieb, zieht einen Durchschnitt so weit hoch, dass er
 * nichts mehr über den Alltag sagt.
 */
export function counts(staffId = null) {
  const day = 86_400_000;
  const base = db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'closed')                       AS open,
         COUNT(*) FILTER (WHERE status = 'open')                          AS waiting,
         COUNT(*) FILTER (WHERE unread_staff = 1 AND status = 'open')     AS unread,
         COUNT(*) FILTER (WHERE priority IN ('high','urgent') AND status = 'open') AS urgent,
         COUNT(*) FILTER (WHERE status = 'open' AND first_reply_at IS NULL) AS unanswered,
         COUNT(*) FILTER (WHERE status = 'open' AND updated_at < ?)       AS stale,
         COUNT(*) FILTER (WHERE status = 'open' AND assigned_to IS NULL)  AS unassigned,
         COUNT(*) FILTER (WHERE status != 'closed' AND assigned_to = ?)   AS mine,
         COUNT(*) FILTER (WHERE closed_at >= ?)                           AS closed_week
       FROM tickets`
    )
    .get(Date.now() - day, staffId ?? -1, Date.now() - 7 * day);

  const waits = db
    .prepare(
      `SELECT first_reply_at - created_at AS wait FROM tickets
        WHERE first_reply_at IS NOT NULL AND created_at >= ?
        ORDER BY wait`
    )
    .all(Date.now() - 30 * day)
    .map((row) => row.wait)
    .filter((value) => value >= 0);

  return {
    ...base,
    first_reply_median: waits.length ? waits[Math.floor(waits.length / 2)] : null,
    first_reply_count: waits.length,
  };
}

// ---------------------------------------------------------------- Schreiben

/**
 * Eine Systemzeile in den Verlauf – "X wurde hinzugefügt", "wieder geöffnet".
 *
 * `internal` macht daraus eine Zeile, die nur das Team sieht. Das ist für die Vorgänge da, die
 * den Kunden nichts angehen und ihn nur beunruhigen würden: **wer** von uns ein Ticket
 * übernommen hat, ist Arbeitsteilung und keine Auskunft an ihn. Dass es geschlossen wurde, ist
 * eine Auskunft an ihn – deshalb steht das offen im Verlauf.
 */
export function system(ticket, text, { internal = false, meta = null } = {}) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO ticket_messages (ticket_id, role, body, internal, meta, created_at)
       VALUES (?, 'system', ?, ?, ?, ?)`
    )
    .run(ticket.id, text, internal ? 1 : 0, meta ? JSON.stringify(meta) : null, now);
  db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, ticket.id);
  bridge.emit('ticket.message', {
    ticket_id: ticket.id,
    message_id: info.lastInsertRowid,
    role: 'system',
    internal,
    // Der Bot spiegelt `body`: Im Discord-Kanal steht derselbe Satz wie bisher.
    body: text,
    created_at: now,
  });
  return info.lastInsertRowid;
}

/** Wer etwas getan hat, als lesbarer Name – für die Zeilen im Verlauf. */
const nameOf = (userId) => {
  const row = userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId) : null;
  return row ? profileName(row) : 'the system';
};

/**
 * Ein neues Ticket mit der ersten Nachricht.
 *
 * `owner` ist, wem das Ticket gehört; `by` wer es angelegt hat. Beide sind meist dieselbe Person –
 * anders nur, wenn ein Administrator für einen Kunden eines aufmacht.
 */
export const create = db.transaction((owner, { subject, body, priority, files: fileIds }, options = {}) => {
  const { by = owner.id, source = 'panel', staffPriority = false } = options;
  const title = requireString(subject, 'Betreff', { max: 120 });
  // Der Betreff genügt. Wer auf "Abschicken" drückt, hat gesagt, worum es geht – dann darf das
  // Ticket nicht daran scheitern, dass das zweite Feld noch leer war. Fehlt der Text, steht das
  // Ticket eben nur mit seinem Betreff da und das Team fragt nach. Ein Screenshot allein zählt
  // dabei genauso: wer ein Bild anhängt, hat etwas gesagt.
  const text = requireString(body, 'Nachricht', { min: 0, max: 8000 });

  const open = db
    .prepare("SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND status != 'closed'")
    .get(owner.id).n;
  if (open >= 10 && by === owner.id) {
    throw bad('Es sind schon zehn Tickets offen. Bitte erst die alten abschließen.', {
      en: 'Ten tickets are already open. Please close a few first.',
    });
  }

  // Wer zahlt, wird zuerst gelesen – das ist keine Willkür, sondern steht so im Tarif. "urgent"
  // vergibt nur das Team: sonst stünde nach kurzer Zeit jedes Ticket dort.
  const wanted = PRIORITIES.includes(priority) ? priority : 'normal';
  const allowed = staffPriority
    ? PRIORITIES
    : isPayingUser(owner.id)
      ? ['low', 'normal', 'high']
      : ['low', 'normal'];
  const boost = allowed.includes(wanted) ? wanted : 'normal';
  const now = Date.now();
  // Angehängte Dateien gehören an die erste Nachricht. Gibt es keinen Text, entsteht sie trotzdem –
  // sonst hinge der Screenshot an nichts und stünde nirgends im Verlauf.
  const chosen = Array.isArray(fileIds) ? fileIds : [];

  // Wer schreibt, bestimmt, bei wem das Ticket liegt. Der Kunde macht eines auf: dann sind wir
  // dran, und beim Team steht es ungelesen. Macht das Team eines für einen Kunden auf, ist es
  // nicht seine eigene Warteschlange – es weiß ja, dass es das Ticket gerade geschrieben hat.
  // Steht dabei schon eine Nachricht, ist der Kunde am Zug; ohne Text ist es eine Notiz, die das
  // Team selbst abarbeitet.
  const staffCreated = by !== owner.id;
  const status = staffCreated && (text || chosen.length) ? 'answered' : 'open';

  const wrote = Boolean(text || chosen.length);
  const info = db
    .prepare(
      `INSERT INTO tickets (user_id, subject, category, status, priority, source, unread_staff,
                            unread_user, created_at, updated_at, first_reply_at,
                            last_customer_at, last_staff_at)
       VALUES (?, ?, 'general', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      owner.id,
      title,
      status,
      boost,
      source,
      staffCreated ? 0 : 1,
      staffCreated ? 1 : 0,
      now,
      now,
      // Ein Ticket, das das Team selbst mit einer Nachricht anlegt, ist bereits beantwortet: Der
      // Kunde hat nie gewartet. Die Wartezeit auf die erste Antwort ist hier also null und nicht
      // "steht noch aus" – sonst stünde jedes vom Team eröffnete Ticket für immer in der Liste
      // der unbeantworteten.
      staffCreated && wrote ? now : null,
      staffCreated ? null : wrote ? now : null,
      staffCreated && wrote ? now : null
    );
  const id = info.lastInsertRowid;
  let messageId = null;
  if (wrote) {
    messageId = db
      .prepare(
        `INSERT INTO ticket_messages (ticket_id, user_id, role, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, by, by === owner.id ? 'user' : 'staff', text, now).lastInsertRowid;
    // Wer schreibt, hat gelesen. Ohne diese Marke stünde an der eigenen ersten Nachricht
    // "noch nicht gelesen" – über sich selbst.
    if (messageId) {
      db.prepare(
        `INSERT INTO ticket_reads (ticket_id, user_id, staff, last_message_id, read_at)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(ticket_id, user_id, staff) DO NOTHING`
      ).run(id, by, staffCreated ? 1 : 0, messageId, now);
    }
  }
  const attached = files.claim(chosen, { ticketId: id, messageId, userId: by });
  audit(by, 'ticket-create', { id, owner: owner.id, source, files: attached.length });
  return ticketRow.get(id);
});

/**
 * Eine Antwort anhängen. `internal` sieht nur das Team.
 *
 * Ist das Ticket geschlossen und schreibt jemand hinein, geht es wieder auf. Vorher stand hier ein
 * "Bitte ein neues aufmachen" – das kostet den Verlauf und macht aus einer Rückfrage ein zweites
 * Ticket, das niemand mit dem ersten in Verbindung bringt. Das galt bislang nur für den Kunden:
 * Schrieb das **Team** in ein geschlossenes Ticket, ging es genauso wieder auf – aber ohne die
 * Zeile im Verlauf und ohne Zählung, sodass hinterher niemand sah, warum ein geschlossener
 * Vorgang wieder offen war.
 */
export const reply = db.transaction((ticket, user, body, {
  internal = false,
  authorName = null,
  discordId = null,
  staff = null,
  files: fileIds = [],
  mentions = null,
} = {}) => {
  // Eine Antwort, die nur aus einem Screenshot besteht, ist eine Antwort. Ohne Anhang bleibt der
  // Text Pflicht – eine leere Nachricht sagt niemandem etwas.
  const chosen = Array.isArray(fileIds) ? fileIds : [];
  const text = requireString(body, 'Nachricht', { min: chosen.length ? 0 : 1, max: 8000 });
  // Der Absender-Modus ist immer eine Entscheidung der aufrufenden Oberfläche – nie eine
  // Nebenwirkung der Konto-Rolle. Ein Admin ist unter „Meine Tickets“ Kunde, unter
  // „Administration → Alle Tickets“ Support.
  if (typeof staff !== 'boolean') {
    throw new TypeError('Ticket replies require an explicit customer or staff mode.');
  }
  const isStaff = staff;
  const now = Date.now();
  const reopened = ticket.status === 'closed' && !internal;

  const info = db
    .prepare(
      `INSERT INTO ticket_messages (ticket_id, user_id, role, body, internal, author_name, discord_id, mentions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ticket.id,
      user.id,
      isStaff ? 'staff' : 'user',
      text,
      internal ? 1 : 0,
      authorName,
      discordId,
      packMentions(mentions),
      now
    );
  const attached = files.claim(chosen, {
    ticketId: ticket.id,
    messageId: info.lastInsertRowid,
    userId: user.id,
    internal,
  });

  if (internal) {
    // Eine interne Notiz ist kein Zug im Gespräch: Sie ändert weder, bei wem das Ticket liegt,
    // noch steht sie dem Kunden als ungelesen im Weg – und sie zählt deshalb auch nicht als
    // Antwort. Wer eine Notiz schreibt, hat dem Kunden nichts gesagt.
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, ticket.id);
  } else if (isStaff) {
    db.prepare(
      `UPDATE tickets SET status = 'answered', unread_user = 1, unread_staff = 0, closed_at = NULL,
              updated_at = ?, reopened = reopened + ?,
              first_reply_at = COALESCE(first_reply_at, ?), last_staff_at = ?
        WHERE id = ?`
    ).run(now, reopened ? 1 : 0, now, now, ticket.id);
  } else {
    db.prepare(
      `UPDATE tickets SET status = 'open', unread_staff = 1, unread_user = 0, closed_at = NULL,
              updated_at = ?, reopened = reopened + ?, last_customer_at = ?
        WHERE id = ?`
    ).run(now, reopened ? 1 : 0, now, ticket.id);
  }
  if (reopened) {
    db.prepare(
      `INSERT INTO ticket_messages (ticket_id, role, body, meta, created_at)
       VALUES (?, 'system', ?, ?, ?)`
    ).run(
      ticket.id,
      'The ticket was reopened by a new reply.',
      JSON.stringify({ key: 'reopened' }),
      now + 1
    );
  }
  // Wer schreibt, hat alles davor gelesen. Ohne das stünde an der eigenen Antwort „ungelesen“ –
  // und die Marke des Teams bliebe auf der Kundennachricht stehen, die man gerade beantwortet hat.
  db.prepare(
    `INSERT INTO ticket_reads (ticket_id, user_id, staff, last_message_id, read_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ticket_id, user_id, staff) DO UPDATE
        SET last_message_id = excluded.last_message_id, read_at = excluded.read_at
      WHERE excluded.last_message_id > ticket_reads.last_message_id`
  ).run(ticket.id, user.id, isStaff ? 1 : 0, info.lastInsertRowid, now);

  const fresh = ticketRow.get(ticket.id);
  bridge.emit('ticket.message', {
    ticket_id: ticket.id,
    message_id: info.lastInsertRowid,
    role: isStaff ? 'staff' : 'user',
    internal,
    author: authorName || profileName(user),
    user_id: user.id,
    // Nachrichten aus Discord stehen dort bereits als Original. Die ID reist mit dem Ereignis
    // zurück zum Bot, damit er sie nicht noch einmal als Panel-Embed in denselben Kanal spiegelt.
    discord_id: discordId,
    body: text,
    files: attached.map(files.view),
    created_at: now,
    status: fresh.status,
    reopened,
  });
  return fresh;
});

/**
 * Den Zustand von Hand setzen.
 *
 * `staff` sagt, wer das tut – nicht die Rolle des Kontos, sondern die Oberfläche: Ein Admin, der
 * unter „Support“ sein eigenes Ticket schließt, ist hier Kunde.
 *
 * **Ungelesen beim Team ist danach nichts.** Ein Zustandswechsel ist eine Entscheidung; wer sie
 * trifft, hat das Ticket vor sich. Genau daran hing der Fehler, dass an einem beantworteten oder
 * geschlossenen Ticket weiter „Wartet“ stand: Der Punkt wurde beim Antworten gelöscht, beim
 * Umstellen des Zustands aber nie.
 *
 * Beim Schließen kommt es darauf an, wer schließt. Das Team schließt: für den Kunden ist das eine
 * Neuigkeit, er bekommt Post und den Punkt. Der Kunde schließt selbst: dann weiß er es bereits.
 *
 * **Und es steht im Verlauf.** Ein Ticket, das plötzlich geschlossen ist, ohne dass irgendwo
 * stünde, wer es wann geschlossen hat, ist für beide Seiten eine Zumutung: Der Kunde sieht nur,
 * dass sein Anliegen weg ist, und das Team weiß beim nächsten Öffnen nicht, ob jemand es
 * abgeschlossen oder nur weggeklickt hat. Der Wechsel ist eine Entscheidung – die gehört an die
 * Stelle, an der man den Vorgang später nachliest, und nicht nur ins Protokoll.
 */
export function setStatus(ticket, status, by, { staff = true } = {}) {
  const wanted = normalizeStatus(status);
  if (!STATUSES.includes(wanted)) throw bad('Unbekannter Zustand.', { en: 'Unknown status.' });
  const now = Date.now();
  const closed = wanted === 'closed';
  const changed = ticket.status !== wanted;
  db.prepare(
    `UPDATE tickets SET status = ?, closed_at = ?, unread_staff = 0,
            unread_user = COALESCE(?, unread_user), updated_at = ? WHERE id = ?`
  ).run(wanted, closed ? now : null, closed ? (staff ? 1 : 0) : null, now, ticket.id);
  if (changed) {
    const who = staff ? 'Support' : nameOf(by);
    system(
      ticket,
      wanted === 'closed'
        ? `The ticket was closed by ${who}.`
        : wanted === 'open'
          ? `${who} set the ticket back to open.`
          : `${who} marked the ticket as answered.`,
      { meta: { key: `status.${wanted}`, vars: { who } } }
    );
  }
  audit(by, 'ticket-status', { id: ticket.id, status: wanted });
  const fresh = ticketRow.get(ticket.id);
  bridge.emit('ticket.status', { ticket_id: ticket.id, status: wanted, by });
  return fresh;
}

/**
 * Wer das Ticket übernimmt.
 *
 * Das stand bisher als nacktes `UPDATE` in der Route: kein Protokolleintrag, keine Zeile im
 * Verlauf, keine Prüfung, ob es das Konto überhaupt gibt. Ein Ticket wechselte damit lautlos den
 * Zuständigen – und wer später fragte, warum niemand geantwortet hat, fand nichts.
 *
 * Die Zeile ist **intern**: Wie wir die Arbeit unter uns aufteilen, ist unsere Sache und keine
 * Auskunft an den Kunden.
 */
export function setAssignee(ticket, userId, by) {
  const target = userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId) : null;
  if (userId && !target) throw notFound('Diesen Nutzer gibt es nicht.', { en: 'No such user.' });
  const wanted = target ? target.id : null;
  if ((ticket.assigned_to ?? null) === wanted) return ticketRow.get(ticket.id);
  db.prepare('UPDATE tickets SET assigned_to = ? WHERE id = ?').run(wanted, ticket.id);
  system(
    ticket,
    target
      ? by === target.id
        ? `${profileName(target)} took the ticket.`
        : `${nameOf(by)} assigned the ticket to ${profileName(target)}.`
      : `${nameOf(by)} removed the assignment.`,
    {
      internal: true,
      meta: target
        ? by === target.id
          ? { key: 'took', vars: { who: profileName(target) } }
          : { key: 'assigned', vars: { by: nameOf(by), who: profileName(target) } }
        : { key: 'unassigned', vars: { by: nameOf(by) } },
    }
  );
  audit(by, 'ticket-assign', { id: ticket.id, user: wanted });
  return ticketRow.get(ticket.id);
}

/**
 * Die Dringlichkeit ändern – das darf nur das Team.
 *
 * Sie steht als Zeile im Verlauf und nicht bloß im Protokoll: Wer ein Ticket später aufmacht,
 * soll sehen, dass es jemand hochgestuft hat, statt sich zu fragen, warum es plötzlich oben
 * steht. Über dieselbe Zeile erfährt es auch der Discord-Kanal.
 */
export function setPriority(ticket, priority, by) {
  if (!PRIORITIES.includes(priority)) {
    throw bad('Unbekannte Dringlichkeit.', { en: 'Unknown priority.' });
  }
  if (ticket.priority === priority) return ticketRow.get(ticket.id);
  db.prepare('UPDATE tickets SET priority = ? WHERE id = ?').run(priority, ticket.id);
  system(ticket, `Priority changed from ${ticket.priority} to ${priority}.`, {
    meta: { key: 'priority', vars: { from: ticket.priority, to: priority } },
  });
  audit(by, 'ticket-priority', { id: ticket.id, priority });
  return ticketRow.get(ticket.id);
}

/**
 * Gesehen: der Punkt geht weg **und** die Lesemarke rückt vor.
 *
 * Beides zusammen, weil es dasselbe Ereignis ist – jemand hat dieses Ticket vor sich. Der Punkt
 * ist die grobe Auskunft für die eigene Seite ("hier ist etwas Neues"), die Marke die genaue für
 * die andere ("bis hierher hat er gelesen, um 14:32").
 */
export function markRead(ticket, user, { staff = user.role === 'admin' } = {}) {
  if (staff) {
    db.prepare('UPDATE tickets SET unread_staff = 0 WHERE id = ?').run(ticket.id);
  } else if (isParticipant(ticket.id, user.id)) {
    db.prepare('UPDATE tickets SET unread_user = 0 WHERE id = ?').run(ticket.id);
  } else {
    return 0;
  }
  return see(ticket, user, { staff });
}

export const unreadFor = (user) =>
  db
    .prepare(
      `SELECT COUNT(*) AS n FROM tickets t
        WHERE t.unread_user = 1
          AND (t.user_id = ? OR EXISTS (SELECT 1 FROM ticket_users tu WHERE tu.ticket_id = t.id AND tu.user_id = ?))`
    )
    .get(user.id, user.id).n;

/**
 * Wie viele Tickets bei **uns** liegen – die Zahl an der Seitenleiste des Teams.
 *
 * Das sind die offenen, nicht die ungelesenen. Ein Ticket, das jemand aufgemacht und wieder
 * zugeklappt hat, ohne zu antworten, ist nicht erledigt; die Zahl darf davon nicht kleiner
 * werden. Und ein beantwortetes oder geschlossenes Ticket taucht hier gar nicht erst auf.
 */
export const openForStaff = () =>
  db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status = 'open'").get().n;

/** Den Discord-Kanal merken, den der Bot für dieses Ticket angelegt hat. */
export function setChannel(ticketId, channelId) {
  db.prepare('UPDATE tickets SET discord_channel_id = ? WHERE id = ?').run(
    channelId ? String(channelId) : null,
    ticketId
  );
}

// ---------------------------------------------------------------- Bescheid geben
//
// **Was hier nicht mehr steht: der Webhook ans Team.**
//
// Ein neues Ticket und jede Antwort darauf gingen früher zusätzlich an einen Discord-Webhook des
// Betreibers. Dieselbe Nachricht stand zu diesem Zeitpunkt aber schon an drei Stellen: im Panel
// als Ticket, mit einer Zahl daneben in der Seitenleiste des Teams, und – sobald der Bot läuft –
// als eigener Kanal in Discord, in dem das Gespräch tatsächlich stattfindet. Die vierte Kopie in
// einem Kanal, in dem man nicht antworten kann, war kein Hinweis mehr, sondern Rauschen; und ein
// Kanal, der ständig rauscht, wird nicht mehr gelesen – auch dann nicht, wenn dort einmal etwas
// steht, das wirklich niemand sonst sagt.
//
// Genau dafür ist der Webhook jetzt da: für den Zustand der Anlage (server/systemreport.js).
// Ticketmeldungen bleiben, wo sie hingehören – im Panel und im Ticket-Kanal.

/**
 * Alle Beteiligten außer einem benachrichtigen. Wer selbst geschrieben hat, bekommt keine Post
 * über die eigene Nachricht.
 *
 * **Zwei Wege, ein Aufruf.** Bis hierher ging von hier nur E-Mail hinaus, und der Discord-Webhook
 * aus den Einstellungen des Kunden meldete ausschließlich Bots und Guthaben – ausgerechnet die
 * Antwort auf sein eigenes Ticket kam dort nie an. Wer einen Webhook einträgt, will Bescheid
 * wissen; welcher der beiden Wege ihn erreicht, ist seine Entscheidung und nicht unsere.
 *
 * Der Webhook wirft nie und wartet nicht: `notify.*` fängt jeden Fehler und läuft nebenher. Ein
 * Discord, das gerade nicht antwortet, darf keine Antwort im Panel aufhalten.
 */
export function notifyParticipants(ticket, kind, vars = {}, exceptUserId = null) {
  const hook = { ticket_reply: 'reply', ticket_opened: 'opened', ticket_closed: 'closed' }[kind];
  for (const person of participants(ticket.id)) {
    if (person.id === exceptUserId) continue;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(person.id);
    if (!user) continue;
    if (mail.configured()) mail.sendTo(user, kind, { id: ticket.id, subject: ticket.subject, ...vars });
    if (hook === 'reply') notify.ticketReply(user.id, ticket, vars.author || 'Support', vars.preview || '');
    else if (hook === 'opened') notify.ticketOpened(user.id, ticket);
    else if (hook === 'closed') notify.ticketClosed(user.id, ticket);
  }
}

/** Kurzform für den häufigsten Fall: das Team hat geantwortet. */
export const notifyUser = (ticket, preview = '', author = '') =>
  notifyParticipants(ticket, 'ticket_reply', {
    preview: String(preview).slice(0, 160),
    author: author || undefined,
  });
