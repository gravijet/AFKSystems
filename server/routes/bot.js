// Was der Discord-Bot vom Panel braucht.
//
// Der Bot ist kein Nutzer und hat keine Sitzung: er weist sich mit einem gemeinsamen Geheimnis
// aus, das in den Einstellungen steht (`discord_bot_secret`). Ohne Geheimnis ist dieser ganze
// Bereich zu – ein leeres Passwort wäre gar keines.
//
// Der Weg zurück (Panel sagt dem Bot etwas) läuft nicht über HTTP, sondern über die WebSocket-
// Verbindung aus bridge.js. So kommt ein Ticket in Discord an, sobald es hier entsteht, und nicht
// erst beim nächsten Abfragen.

import express from 'express';
import { db, getSetting, audit } from '../db.js';
import { config } from '../config.js';
import * as tickets from '../tickets.js';
import * as roles from '../roles.js';
import { ROLE_METADATA } from '../oauth.js';
import { bridge } from '../bridge.js';
import { wrap, requireInt, requireString, bad, notFound, HttpError, safeEqual } from '../util.js';

export const router = express.Router();

/** Das gemeinsame Geheimnis prüfen. */
export function checkSecret(value) {
  const secret = String(getSetting('discord_bot_secret') || '').trim();
  if (!secret || !value) return false;
  return safeEqual(value, secret);
}

router.use((req, res, next) => {
  const header = String(req.headers.authorization || '');
  const value = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!checkSecret(value)) {
    return next(new HttpError(401, 'Der Bot ist nicht angemeldet.', { en: 'The bot is not signed in.' }));
  }
  next();
});

// ---------------------------------------------------------------- Einrichtung

router.get(
  '/config',
  wrap((req, res) => {
    res.json({
      brand: config.brand,
      panel_url: config.publicUrl,
      logo: `${config.publicUrl}/assets/img/logo-256.png`,
      application_id: String(getSetting('discord_client_id') || ''),
      // Der Token steht im Panel, damit er nur an einer Stelle liegt. Wer bis hierher kommt, hat
      // schon das gemeinsame Geheimnis – für ihn ist er kein neues Geheimnis mehr.
      token: String(getSetting('discord_bot_token') || ''),
      guild_id: String(getSetting('discord_guild_id') || ''),
      ticket_channel: String(getSetting('discord_ticket_channel') || ''),
      ticket_category: String(getSetting('discord_ticket_category') || ''),
      staff_webhook: Boolean(String(getSetting('discord_staff_webhook') || '').trim()),
      invite: String(getSetting('discord_invite') || ''),
      roles: roles.managed(),
      managed_roles: roles.managedIds(),
      role_metadata: ROLE_METADATA,
      categories: tickets.categoriesFor('de'),
      statuses: tickets.STATUSES,
      link_url: `${config.publicUrl}/de/app#/settings`,
      seq: bridge.sequence,
    });
  })
);

// ---------------------------------------------------------------- Konten und Rollen

router.get(
  '/users/:discordId',
  wrap((req, res) => {
    const user = roles.byDiscordId(req.params.discordId);
    if (!user) return res.json({ linked: false });
    res.json({ linked: true, ...roles.targetFor(user), blocked: Boolean(user.blocked) });
  })
);

router.get(
  '/roles',
  wrap((req, res) => {
    res.json({ managed: roles.managedIds(), users: roles.everyone() });
  })
);

// ---------------------------------------------------------------- Tickets

/** Ein Ticket so, wie der Bot es braucht. */
function ticketView(ticket) {
  const owner = db.prepare('SELECT id, username, discord_id FROM users WHERE id = ?').get(ticket.user_id);
  return {
    id: ticket.id,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    source: ticket.source,
    channel_id: ticket.discord_channel_id,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    url: `${config.publicUrl}/de/app#/tickets/${ticket.id}`,
    owner,
    participants: tickets.participants(ticket.id),
  };
}

router.get(
  '/tickets/:id',
  wrap((req, res) => {
    const ticket = tickets.byId(requireInt(req.params.id, 'Ticket'));
    if (!ticket) throw notFound('Dieses Ticket gibt es nicht.', { en: 'No such ticket.' });
    res.json({
      ticket: ticketView(ticket),
      // Der Bot zeigt in Discord nur, was auch der Kunde sieht – interne Notizen bleiben intern.
      messages: tickets.messages(ticket.id).map((message) => ({
        id: message.id,
        role: message.role,
        author: message.author_name || message.username || null,
        body: message.body,
        created_at: message.created_at,
        discord_id: message.discord_id,
      })),
    });
  })
);

/** Offene Tickets mit Discord-Kanal – der Bot räumt damit beim Start auf. */
router.get(
  '/tickets',
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT * FROM tickets
          WHERE ${req.query.open === '0' ? '1 = 1' : "status != 'closed'"}
          ORDER BY id DESC LIMIT 200`
      )
      .all();
    res.json({ tickets: rows.map(ticketView) });
  })
);

/** Ein Ticket aus Discord heraus aufmachen. Geht nur für verknüpfte Konten. */
router.post(
  '/tickets',
  wrap(async (req, res) => {
    const body = req.body || {};
    const user = roles.byDiscordId(requireString(body.discord_id, 'Discord-Konto', { max: 40 }));
    if (!user) {
      throw bad(
        'Dieses Discord-Konto ist mit keinem AFKSystems-Konto verknüpft. Bitte zuerst im Panel verknüpfen.',
        { en: 'That Discord account is not linked to an AFKSystems account yet.' }
      );
    }
    if (user.blocked) throw new HttpError(403, 'Dieses Konto ist gesperrt.', { en: 'This account is blocked.' });

    const ticket = tickets.create(
      user,
      { subject: body.subject, category: body.category, body: body.body, priority: body.priority },
      { source: 'discord' }
    );
    if (body.channel_id) tickets.setChannel(ticket.id, body.channel_id);
    tickets.notifyStaff(ticket, user);
    tickets.notifyParticipants(ticket, 'ticket_opened', {}, null);
    // Damit das Panel es sofort zeigt – dieselbe Meldung wie bei einem Ticket aus dem Panel.
    bridge.emit('ticket.created', { ticket_id: ticket.id, source: 'discord', user_id: user.id });
    res.json({ ticket: ticketView(tickets.byId(ticket.id)) });
  })
);

/** Den Kanal merken, den der Bot für ein Ticket angelegt hat. */
router.patch(
  '/tickets/:id',
  wrap((req, res) => {
    const ticket = tickets.byId(requireInt(req.params.id, 'Ticket'));
    if (!ticket) throw notFound('Dieses Ticket gibt es nicht.', { en: 'No such ticket.' });
    if (req.body?.channel_id !== undefined) tickets.setChannel(ticket.id, req.body.channel_id);
    res.json({ ticket: ticketView(tickets.byId(ticket.id)) });
  })
);

/** Eine Nachricht aus Discord in den Verlauf übernehmen. */
router.post(
  '/tickets/:id/messages',
  wrap((req, res) => {
    const ticket = tickets.byId(requireInt(req.params.id, 'Ticket'));
    if (!ticket) throw notFound('Dieses Ticket gibt es nicht.', { en: 'No such ticket.' });
    const body = req.body || {};

    // Doppelte vermeiden: der Bot schickt die ID der Discord-Nachricht mit, und dieselbe Nachricht
    // kommt nach einem Neustart des Bots gern ein zweites Mal.
    if (body.discord_id) {
      const known = db
        .prepare('SELECT 1 FROM ticket_messages WHERE discord_id = ?')
        .get(String(body.discord_id));
      if (known) return res.json({ ok: true, duplicate: true });
    }

    const user = body.discord_user_id ? roles.byDiscordId(body.discord_user_id) : null;
    if (!user) {
      throw bad('Dieses Discord-Konto ist mit keinem AFKSystems-Konto verknüpft.', {
        en: 'That Discord account is not linked to an AFKSystems account.',
      });
    }
    // Wer im Panel Administrator ist, ist es auch in Discord – der Bot muss dafür nichts wissen.
    const updated = tickets.reply(ticket, user, body.body, {
      authorName: body.author_name || user.username,
      discordId: String(body.discord_id || '') || null,
    });
    if (user.role !== 'admin') tickets.notifyStaffReply(updated, user, body.body);
    tickets.notifyParticipants(
      updated,
      user.role === 'admin' ? 'ticket_reply' : 'ticket_reply',
      { preview: String(body.body).slice(0, 160) },
      user.id
    );
    res.json({ ok: true, ticket: ticketView(updated) });
  })
);

router.post(
  '/tickets/:id/status',
  wrap((req, res) => {
    const ticket = tickets.byId(requireInt(req.params.id, 'Ticket'));
    if (!ticket) throw notFound('Dieses Ticket gibt es nicht.', { en: 'No such ticket.' });
    const status = String(req.body?.status || '');
    if (!tickets.STATUSES.includes(status)) throw bad('Unbekannter Zustand.', { en: 'Unknown status.' });
    const by = req.body?.discord_id ? roles.byDiscordId(req.body.discord_id) : null;
    const updated = tickets.setStatus(ticket, status, by?.id ?? null);
    if (status === 'closed') tickets.notifyParticipants(updated, 'ticket_closed', {}, by?.id ?? null);
    audit(by?.id ?? null, 'ticket-status-discord', { id: ticket.id, status });
    res.json({ ticket: ticketView(updated) });
  })
);

/** Was seit einer bestimmten Stelle passiert ist – falls die WebSocket-Verbindung kurz weg war. */
router.get(
  '/events',
  wrap((req, res) => {
    res.json({ seq: bridge.sequence, events: bridge.since(req.query.since) });
  })
);

/** Ein Lebenszeichen, damit der Admin-Bereich zeigen kann, ob der Bot läuft. */
router.post(
  '/heartbeat',
  wrap((req, res) => {
    lastHeartbeat = { at: Date.now(), ...(req.body || {}) };
    res.json({ ok: true, seq: bridge.sequence });
  })
);

let lastHeartbeat = null;

/** Für den Admin-Bereich: läuft der Bot, und was meldet er? */
export const botState = () => ({
  configured: Boolean(String(getSetting('discord_bot_token') || '').trim()),
  secret_set: Boolean(String(getSetting('discord_bot_secret') || '').trim()),
  connected: bridge.connected,
  last_heartbeat: lastHeartbeat,
});
