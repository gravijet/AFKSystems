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

import { db, audit } from './db.js';
import { config } from './config.js';
import { bad, notFound, forbidden, requireString } from './util.js';
import * as files from './attachments.js';
import { isPayingUser } from './billing.js';
import * as mail from './mail.js';
import * as notify from './notify.js';
import { bridge } from './bridge.js';

export const STATUSES = ['open', 'waiting', 'answered', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const ticketRow = db.prepare('SELECT * FROM tickets WHERE id = ?');
export const byId = (id) => ticketRow.get(id);
export const byChannel = (channelId) =>
  db.prepare('SELECT * FROM tickets WHERE discord_channel_id = ?').get(String(channelId));

// ---------------------------------------------------------------- Beteiligte

/** Alle Kunden, die dieses Ticket sehen dürfen – der Ersteller zuerst. */
export function participants(ticketId) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.email, u.language, u.discord_id, 1 AS owner FROM tickets t
         JOIN users u ON u.id = t.user_id WHERE t.id = ?
       UNION
       SELECT u.id, u.username, u.email, u.language, u.discord_id, 0 AS owner FROM ticket_users tu
         JOIN users u ON u.id = tu.user_id WHERE tu.ticket_id = ?
       ORDER BY owner DESC, u.username`
    )
    .all(ticketId, ticketId);
}

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

export function addUser(ticket, userId, by) {
  if (ticket.user_id === userId) return participants(ticket.id);
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) throw notFound('Diesen Nutzer gibt es nicht.', { en: 'No such user.' });
  db.prepare(
    `INSERT INTO ticket_users (ticket_id, user_id, added_by, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(ticket_id, user_id) DO NOTHING`
  ).run(ticket.id, userId, by, Date.now());
  system(ticket, `${user.username} was added to the ticket.`);
  audit(by, 'ticket-add-user', { ticket: ticket.id, user: userId });
  return participants(ticket.id);
}

export function removeUser(ticket, userId, by) {
  if (ticket.user_id === userId) {
    throw bad('Der Ersteller lässt sich nicht entfernen.', { en: 'The author cannot be removed.' });
  }
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  db.prepare('DELETE FROM ticket_users WHERE ticket_id = ? AND user_id = ?').run(ticket.id, userId);
  if (user) system(ticket, `${user.username} was removed from the ticket.`);
  audit(by, 'ticket-remove-user', { ticket: ticket.id, user: userId });
  return participants(ticket.id);
}

// ---------------------------------------------------------------- Lesen

export function messages(ticketId, { staff = false } = {}) {
  const rows = db
    .prepare(
      `SELECT m.*, u.username FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.ticket_id = ? ORDER BY m.id`
    )
    .all(ticketId);
  const visible = staff ? rows : rows.filter((row) => !row.internal);
  // Anhänge gehören zur Nachricht, nicht daneben. Sie hier anzuhängen heißt: jede Oberfläche,
  // die Nachrichten liest, hat sie automatisch – ohne einen zweiten Aufruf und ohne dass jemand
  // das Nachladen vergessen kann.
  const attachments = files.byMessage(ticketId, { staff });
  return visible.map((row) => ({ ...row, files: attachments.get(row.id) || [] }));
}

export function listFor(user) {
  return db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.internal = 0) AS messages,
              (t.user_id != ?) AS shared
         FROM tickets t
        WHERE t.user_id = ? OR EXISTS (SELECT 1 FROM ticket_users tu WHERE tu.ticket_id = t.id AND tu.user_id = ?)
        ORDER BY t.status = 'closed', t.updated_at DESC`
    )
    .all(user.id, user.id, user.id);
}

export function listAll({ status = null, priority = null, search = '' } = {}) {
  const where = [];
  const values = [];
  // Beide Werte kommen aus der Adresszeile und können damit alles sein – auch eine Liste
  // (`?status=a&status=b` gibt Express als Array heraus). Ein Array bindet SQLite nicht, und die
  // ganze Ticketübersicht antwortete mit einem Serverfehler. Geprüft wird gegen die Liste der
  // Zustände, die es wirklich gibt; alles andere heißt schlicht "kein Filter".
  const wantedStatus = STATUSES.includes(status) ? status : null;
  const wantedPriority = PRIORITIES.includes(priority) ? priority : null;
  if (wantedStatus) {
    where.push('t.status = ?');
    values.push(wantedStatus);
  }
  if (wantedPriority) {
    where.push('t.priority = ?');
    values.push(wantedPriority);
  }
  if (search) {
    where.push('(t.subject LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR t.id = ?)');
    values.push(`%${search}%`, `%${search}%`, `%${search}%`, Number(search) || 0);
  }
  return db
    .prepare(
      `SELECT t.*, u.username, u.email,
              (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages,
              (SELECT COUNT(*) FROM ticket_users tu WHERE tu.ticket_id = t.id) AS extra_users,
              a.username AS assigned_name
         FROM tickets t JOIN users u ON u.id = t.user_id
         LEFT JOIN users a ON a.id = t.assigned_to
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.status = 'closed',
                 CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                 t.updated_at DESC
        LIMIT 300`
    )
    .all(...values);
}

export const counts = () =>
  db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'closed')                     AS open,
         COUNT(*) FILTER (WHERE unread_staff = 1 AND status != 'closed') AS unread,
         COUNT(*) FILTER (WHERE priority IN ('high','urgent') AND status != 'closed') AS urgent
       FROM tickets`
    )
    .get();

// ---------------------------------------------------------------- Schreiben

/** Eine Systemzeile in den Verlauf – "X wurde hinzugefügt", "wieder geöffnet". */
export function system(ticket, text) {
  const now = Date.now();
  const info = db
    .prepare(
      "INSERT INTO ticket_messages (ticket_id, role, body, created_at) VALUES (?, 'system', ?, ?)"
    )
    .run(ticket.id, text, now);
  db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, ticket.id);
  bridge.emit('ticket.message', {
    ticket_id: ticket.id,
    message_id: info.lastInsertRowid,
    role: 'system',
    body: text,
    created_at: now,
  });
  return info.lastInsertRowid;
}

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

  const info = db
    .prepare(
      `INSERT INTO tickets (user_id, subject, category, status, priority, source, unread_staff,
                            unread_user, created_at, updated_at)
       VALUES (?, ?, 'general', 'open', ?, ?, 1, ?, ?, ?)`
    )
    .run(owner.id, title, boost, source, by === owner.id ? 0 : 1, now, now);
  const id = info.lastInsertRowid;
  // Angehängte Dateien gehören an die erste Nachricht. Gibt es keinen Text, entsteht sie trotzdem –
  // sonst hinge der Screenshot an nichts und stünde nirgends im Verlauf.
  const chosen = Array.isArray(fileIds) ? fileIds : [];
  let messageId = null;
  if (text || chosen.length) {
    messageId = db
      .prepare(
        `INSERT INTO ticket_messages (ticket_id, user_id, role, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, by, by === owner.id ? 'user' : 'staff', text, now).lastInsertRowid;
  }
  const attached = files.claim(chosen, { ticketId: id, messageId, userId: by });
  audit(by, 'ticket-create', { id, owner: owner.id, source, files: attached.length });
  return ticketRow.get(id);
});

/**
 * Eine Antwort anhängen. `internal` sieht nur das Team.
 *
 * Ist das Ticket geschlossen und antwortet ein Kunde, geht es wieder auf. Vorher stand hier ein
 * "Bitte ein neues aufmachen" – das kostet den Verlauf und macht aus einer Rückfrage ein zweites
 * Ticket, das niemand mit dem ersten in Verbindung bringt.
 */
export const reply = db.transaction((ticket, user, body, {
  internal = false,
  authorName = null,
  discordId = null,
  staff = null,
  files: fileIds = [],
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
      `INSERT INTO ticket_messages (ticket_id, user_id, role, body, internal, author_name, discord_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(ticket.id, user.id, isStaff ? 'staff' : 'user', text, internal ? 1 : 0, authorName, discordId, now);
  const attached = files.claim(chosen, {
    ticketId: ticket.id,
    messageId: info.lastInsertRowid,
    userId: user.id,
    internal,
  });

  if (internal) {
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, ticket.id);
  } else if (isStaff) {
    db.prepare(
      "UPDATE tickets SET status = 'answered', unread_user = 1, unread_staff = 0, closed_at = NULL, updated_at = ? WHERE id = ?"
    ).run(now, ticket.id);
  } else {
    db.prepare(
      "UPDATE tickets SET status = 'open', unread_staff = 1, unread_user = 0, closed_at = NULL, updated_at = ?, reopened = reopened + ? WHERE id = ?"
    ).run(now, reopened ? 1 : 0, ticket.id);
  }
  if (reopened) {
    db.prepare(
      "INSERT INTO ticket_messages (ticket_id, role, body, created_at) VALUES (?, 'system', ?, ?)"
    ).run(ticket.id, 'The ticket was reopened by a new reply.', now + 1);
  }

  const fresh = ticketRow.get(ticket.id);
  bridge.emit('ticket.message', {
    ticket_id: ticket.id,
    message_id: info.lastInsertRowid,
    role: isStaff ? 'staff' : 'user',
    internal,
    author: authorName || user.username,
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

export function setStatus(ticket, status, by) {
  if (!STATUSES.includes(status)) throw bad('Unbekannter Zustand.', { en: 'Unknown status.' });
  db.prepare('UPDATE tickets SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?').run(
    status,
    status === 'closed' ? Date.now() : null,
    Date.now(),
    ticket.id
  );
  audit(by, 'ticket-status', { id: ticket.id, status });
  const fresh = ticketRow.get(ticket.id);
  bridge.emit('ticket.status', { ticket_id: ticket.id, status, by });
  return fresh;
}

export function markRead(ticket, user, { staff = user.role === 'admin' } = {}) {
  if (staff) {
    db.prepare('UPDATE tickets SET unread_staff = 0 WHERE id = ?').run(ticket.id);
  } else if (isParticipant(ticket.id, user.id)) {
    db.prepare('UPDATE tickets SET unread_user = 0 WHERE id = ?').run(ticket.id);
  }
}

export const unreadFor = (user) =>
  db
    .prepare(
      `SELECT COUNT(*) AS n FROM tickets t
        WHERE t.unread_user = 1
          AND (t.user_id = ? OR EXISTS (SELECT 1 FROM ticket_users tu WHERE tu.ticket_id = t.id AND tu.user_id = ?))`
    )
    .get(user.id, user.id).n;

export const openForStaff = () =>
  db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE unread_staff = 1 AND status != 'closed'").get().n;

/** Den Discord-Kanal merken, den der Bot für dieses Ticket angelegt hat. */
export function setChannel(ticketId, channelId) {
  db.prepare('UPDATE tickets SET discord_channel_id = ? WHERE id = ?').run(
    channelId ? String(channelId) : null,
    ticketId
  );
}

// ---------------------------------------------------------------- Bescheid geben

/** Das Team über ein neues Ticket informieren – Webhook und, wenn er läuft, der Bot. */
export async function notifyStaff(ticket, user) {
  const paying = isPayingUser(user.id);
  return notify.staff({
    title: `New ticket #${ticket.id}: ${ticket.subject}`,
    url: `${config.publicUrl}/en/app#/admin/tickets/${ticket.id}`,
    description: [
      `**From** ${user.username}${paying ? ' · paying customer' : ''}`,
      `**Priority** ${ticket.priority}`,
      ticket.source === 'discord' ? '**Via** Discord' : null,
    ]
      .filter(Boolean)
      .join('\n'),
    color: ticket.priority === 'urgent' ? notify.COLORS.bad : notify.COLORS.info,
  });
}

/** Das Team über eine Kundenantwort informieren. */
export const notifyStaffReply = (ticket, user, body) =>
  notify.staff({
    title: `Reply to #${ticket.id}: ${ticket.subject}`,
    url: `${config.publicUrl}/en/app#/admin/tickets/${ticket.id}`,
    description: `**${user.username}**\n${String(body).slice(0, 400)}`,
    color: notify.COLORS.warn,
  });

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
