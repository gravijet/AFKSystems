// Support-Tickets. Ein Ticket ist ein Betreff, eine Kategorie und ein Verlauf aus Nachrichten –
// mehr braucht es nicht, und weniger würde beim Nachfragen nerven.
//
// Die Kategorie `proxy` ist der Weg, über den Proxys vergeben werden: Proxys gibt es nur für
// bezahlte Serverplätze, und zugeteilt werden sie von Hand, weil dahinter echte IP-Adressen
// stehen, die jemand kaufen und pflegen muss.

import { db, getSetting, audit } from './db.js';
import { config } from './config.js';
import { bad, notFound, forbidden, requireString } from './util.js';
import { isPayingUser } from './billing.js';
import * as mail from './mail.js';

export const CATEGORIES = [
  { key: 'general', de: 'Allgemeine Frage', en: 'General question' },
  { key: 'proxy', de: 'Proxy anfragen', en: 'Request a proxy' },
  { key: 'billing', de: 'Guthaben und Tarife', en: 'Credits and plans' },
  { key: 'bug', de: 'Etwas geht nicht', en: 'Something is broken' },
  { key: 'abuse', de: 'Missbrauch melden', en: 'Report abuse' },
];

export const STATUSES = ['open', 'waiting', 'answered', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const categoriesFor = (lang = 'de') =>
  CATEGORIES.map((entry) => ({ key: entry.key, label: entry[lang === 'en' ? 'en' : 'de'] }));

const ticketRow = db.prepare('SELECT * FROM tickets WHERE id = ?');

export function get(id, user) {
  const ticket = ticketRow.get(id);
  if (!ticket) throw notFound('Dieses Ticket gibt es nicht.', { en: 'No such ticket.' });
  if (ticket.user_id !== user.id && user.role !== 'admin') throw forbidden();
  return ticket;
}

export function messages(ticketId, { staff = false } = {}) {
  const rows = db
    .prepare('SELECT m.*, u.username FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.ticket_id = ? ORDER BY m.id')
    .all(ticketId);
  return staff ? rows : rows.filter((row) => !row.internal);
}

export function listFor(user) {
  return db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.internal = 0) AS messages
         FROM tickets t WHERE t.user_id = ? ORDER BY t.status = 'closed', t.updated_at DESC`
    )
    .all(user.id);
}

export function listAll({ status = null, category = null, search = '' } = {}) {
  const where = [];
  const values = [];
  if (status && status !== 'all') {
    where.push('t.status = ?');
    values.push(status);
  }
  if (category && category !== 'all') {
    where.push('t.category = ?');
    values.push(category);
  }
  if (search) {
    where.push('(t.subject LIKE ? OR u.username LIKE ? OR u.email LIKE ?)');
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  return db
    .prepare(
      `SELECT t.*, u.username, u.email,
              (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages
         FROM tickets t JOIN users u ON u.id = t.user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.status = 'closed', t.priority = 'urgent' DESC, t.updated_at DESC
        LIMIT 300`
    )
    .all(...values);
}

/** Ein neues Ticket mit der ersten Nachricht. */
export const create = db.transaction((user, { subject, category, body, priority }) => {
  const title = requireString(subject, 'Betreff', { max: 120 });
  const text = requireString(body, 'Nachricht', { max: 8000 });
  const kind = CATEGORIES.some((entry) => entry.key === category) ? category : 'general';

  const open = db
    .prepare("SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND status != 'closed'")
    .get(user.id).n;
  if (open >= 10) {
    throw bad('Es sind schon zehn Tickets offen. Bitte erst die alten abschließen.', {
      en: 'Ten tickets are already open. Please close a few first.',
    });
  }

  // Wer zahlt, wird zuerst gelesen – das ist keine Willkür, sondern steht so im Tarif. "urgent"
  // vergibt nur das Team: sonst stünde nach kurzer Zeit jedes Ticket dort.
  const wanted = PRIORITIES.includes(priority) ? priority : 'normal';
  const allowed = isPayingUser(user.id) ? ['low', 'normal', 'high'] : ['low', 'normal'];
  const boost = allowed.includes(wanted) ? wanted : 'normal';
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO tickets (user_id, subject, category, status, priority, unread_staff, created_at, updated_at)
       VALUES (?, ?, ?, 'open', ?, 1, ?, ?)`
    )
    .run(user.id, title, kind, boost, now, now);
  db.prepare(
    "INSERT INTO ticket_messages (ticket_id, user_id, role, body, created_at) VALUES (?, ?, 'user', ?, ?)"
  ).run(info.lastInsertRowid, user.id, text, now);
  audit(user.id, 'ticket-create', { id: info.lastInsertRowid, category: kind });
  return ticketRow.get(info.lastInsertRowid);
});

/** Eine Antwort anhängen. `internal` sieht nur das Team. */
export const reply = db.transaction((ticket, user, body, { internal = false } = {}) => {
  const text = requireString(body, 'Nachricht', { max: 8000 });
  if (ticket.status === 'closed' && user.role !== 'admin') {
    throw bad('Dieses Ticket ist geschlossen. Bitte ein neues aufmachen.', {
      en: 'This ticket is closed. Please open a new one.',
    });
  }
  const staff = user.role === 'admin';
  const now = Date.now();
  db.prepare(
    'INSERT INTO ticket_messages (ticket_id, user_id, role, body, internal, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(ticket.id, user.id, staff ? 'staff' : 'user', text, internal ? 1 : 0, now);

  if (internal) {
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, ticket.id);
  } else if (staff) {
    db.prepare(
      "UPDATE tickets SET status = 'answered', unread_user = 1, unread_staff = 0, updated_at = ? WHERE id = ?"
    ).run(now, ticket.id);
  } else {
    db.prepare(
      "UPDATE tickets SET status = 'open', unread_staff = 1, unread_user = 0, updated_at = ? WHERE id = ?"
    ).run(now, ticket.id);
  }
  return ticketRow.get(ticket.id);
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
  return ticketRow.get(ticket.id);
}

export function markRead(ticket, user) {
  if (user.role === 'admin') db.prepare('UPDATE tickets SET unread_staff = 0 WHERE id = ?').run(ticket.id);
  if (ticket.user_id === user.id) db.prepare('UPDATE tickets SET unread_user = 0 WHERE id = ?').run(ticket.id);
}

export const unreadFor = (user) =>
  db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND unread_user = 1").get(user.id).n;

export const openForStaff = () =>
  db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE unread_staff = 1 AND status != 'closed'").get().n;

/** Das Team über ein neues Ticket informieren – über den Webhook aus den Einstellungen. */
export async function notifyStaff(ticket, user) {
  const hook = String(getSetting('discord_staff_webhook') || '').trim();
  if (!hook) return false;
  try {
    const response = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: `${config.brand} Support`,
        embeds: [
          {
            title: `#${ticket.id} · ${ticket.subject}`,
            description: `Von **${user.username}** · Kategorie \`${ticket.category}\``,
            // Ohne Sprache in der Adresse: /app leitet auf die Sprache weiter, die der Öffnende
            // eingestellt hat. Vorher stand hier fest /de/.
            url: `${config.publicUrl}/app#/admin/tickets`,
            color: 0x206cfe,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Den Nutzer über eine Antwort informieren, wenn Post eingerichtet ist. */
export function notifyUser(ticket) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.user_id);
  if (!user || !mail.configured()) return;
  mail.sendTicketReply(user, ticket);
}
