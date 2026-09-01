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
import * as attachments from '../attachments.js';
import * as roles from '../roles.js';
import * as billing from '../billing.js';
import * as notify from '../notify.js';
import * as profile from '../profile.js';
import { roleMetadataFields } from '../oauth.js';
import { bridge } from '../bridge.js';
import { supervisor } from '../supervisor.js';
import { wrap, requireInt, requireString, bad, notFound, HttpError, safeEqual, safeUrl } from '../util.js';

export const router = express.Router();

/**
 * Wie kurz ein "Geheimnis" sein darf, bevor es keines mehr ist.
 *
 * Hinter diesem einen Wort liegt der ganze Bereich: der Discord-Token, jedes Ticket samt Verlauf,
 * die Discord-IDs aller verknüpften Konten. Ein vierstelliges Passwort davor ist in Minuten
 * geraten – deshalb wird es nicht bloß bemängelt, sondern **nicht angenommen**. Lieber ein Bot,
 * der sich meldet, dass er nicht hereinkommt, als eine Tür, die jeder aufbekommt.
 */
export const MIN_SECRET = 24;

let warned = false;

/** Das gemeinsame Geheimnis prüfen. */
export function checkSecret(value) {
  const secret = String(getSetting('discord_bot_secret') || '').trim();
  if (!secret || !value) return false;
  if (secret.length < MIN_SECRET) {
    if (!warned) {
      warned = true;
      console.warn(
        `[bot] Das Geheimnis zwischen Panel und Bot ist zu kurz (${secret.length} statt ${MIN_SECRET} Zeichen). ` +
          'Der Bot-Bereich bleibt zu, bis unter Administration → Einstellungen → Discord ein langes ' +
          'Geheimnis steht und dasselbe in bot/.env als PANEL_SECRET.'
      );
    }
    return false;
  }
  return safeEqual(value, secret);
}

/**
 * Falsche Versuche bremsen.
 *
 * Ein gemeinsames Geheimnis lässt sich raten, wenn man es beliebig oft versuchen darf. Zwanzig
 * Fehlversuche je Adresse und Viertelstunde reichen für jeden echten Bot (er hat es beim ersten
 * Mal richtig) und für niemanden sonst.
 */
const failures = new Map();
const FAIL_WINDOW_MS = 15 * 60_000;
const FAIL_MAX = 20;

/**
 * Ein Anmeldeversuch des Bots – für HTTP **und** für den WebSocket-Aufbau.
 *
 * Die Bremse stand vorher nur vor den HTTP-Endpunkten. Die Leitung `/api/bot/stream` prüfte
 * dasselbe Geheimnis ohne jede Zählung, und weil dort pro Verbindung geraten werden darf, war die
 * teure Tür vorn verriegelt und die daneben offen. Beide gehen jetzt durch dieselbe Zählung.
 */
export function tryBotSecret(ip, value) {
  const now = Date.now();
  const recent = (failures.get(ip) || []).filter((at) => now - at < FAIL_WINDOW_MS);
  if (recent.length >= FAIL_MAX) {
    failures.set(ip, recent);
    return 'throttled';
  }
  if (!checkSecret(value)) {
    recent.push(now);
    failures.set(ip, recent);
    if (failures.size > 5_000) {
      for (const [key, times] of failures) {
        if (!times.some((at) => now - at < FAIL_WINDOW_MS)) failures.delete(key);
      }
    }
    return 'wrong';
  }
  failures.delete(ip);
  return 'ok';
}

router.use((req, res, next) => {
  const header = String(req.headers.authorization || '');
  const value = header.startsWith('Bearer ') ? header.slice(7) : '';
  const result = tryBotSecret(req.ip, value);
  if (result === 'throttled') {
    return next(new HttpError(429, 'Zu viele Versuche.', { en: 'Too many attempts.' }));
  }
  if (result === 'wrong') {
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
      // Ob der Betreiber einen Webhook für Systemmeldungen hinterlegt hat. Der Bot benutzt ihn
      // nicht (Tickets meldet er über seinen Kanal), aber er darf wissen, dass es ihn gibt.
      system_webhook: Boolean(notify.systemWebhook()),
      // Auch hier geprüft: Der Bot setzt sie als Link in eine Discord-Nachricht.
      invite: safeUrl(getSetting('discord_invite')) || '',
      roles: roles.managed(),
      managed_roles: roles.managedIds(),
      role_metadata: roleMetadataFields(),
      // Kategorien, in denen der Bot keine Kanalrechte setzen darf. Sie kommen aus den
      // Einstellungen, damit sich das ohne neuen Bot-Stand ändern lässt.
      skip_categories: String(getSetting('discord_skip_categories') || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      statuses: tickets.STATUSES,
      max_upload: attachments.MAX_BYTES,
      link_url: `${config.publicUrl}/en/app#/settings`,
      free_guild_id: billing.freeGuildId(),
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

/**
 * Frischer Mitgliedschaftsabgleich aus Discord. `members` enthält nur verknüpfte Panel-Konten;
 * dadurch bleibt die Anfrage klein, auch wenn der Discord-Server viele andere Mitglieder hat.
 */
router.post(
  '/memberships',
  wrap((req, res) => {
    const guildId = String(req.body?.guild_id || '');
    if (!guildId || guildId !== billing.freeGuildId()) {
      throw bad('Falscher Discord-Server.', { en: 'Wrong Discord guild.' });
    }
    const raw = Array.isArray(req.body?.members) ? req.body.members : [];
    if (raw.length > 10_000) throw bad('Zu viele Einträge.', { en: 'Too many entries.' });
    const now = Date.now();
    const update = db.prepare(
      `UPDATE users SET discord_guild_member = ?, discord_guild_checked_at = ?
        WHERE discord_id = ?`
    );
    const changed = [];
    db.transaction(() => {
      for (const entry of raw) {
        const discordId = String(entry?.discord_id || '').trim();
        if (!/^\d{5,25}$/.test(discordId)) continue;
        const before = db
          .prepare('SELECT id, discord_guild_member FROM users WHERE discord_id = ?')
          .get(discordId);
        if (!before) continue;
        const present = entry.present ? 1 : 0;
        update.run(present, now, discordId);
        if (Boolean(before.discord_guild_member) !== Boolean(present)) {
          changed.push({ user_id: before.id, discord_id: discordId, present: Boolean(present) });
        }
      }
    })();

    // Ein Austritt beendet jeden Gratis-Platz sofort. Gewollte Starts werden dabei ebenfalls
    // gelöscht; nach einem erneuten Beitritt entscheidet der Nutzer bewusst, was wieder startet.
    //
    // Andersherum gilt: Wer wieder da ist, bekommt zurück, was noch offen als "soll laufen"
    // dasteht. Das ist der Normalfall nach einem Neustart des Servers – dort ist beim Hochfahren
    // jede Mitgliedschaftsprüfung veraltet, die Bots warten auf den ersten Abgleich des Bots,
    // und genau der ist dieser Aufruf.
    for (const entry of changed) {
      if (!entry.present) continue;
      const started = supervisor.restoreUser(entry.user_id);
      if (started) console.log(`[discord] Mitgliedschaft bestätigt – ${started} Bot(s) wieder gestartet.`);
    }

    for (const entry of changed) {
      if (entry.present) continue;
      const profiles = db
        .prepare(
          `SELECT p.id FROM profiles p JOIN plans pl ON pl.id = p.plan_id
            WHERE p.user_id = ? AND pl.free_slot = 1`
        )
        .all(entry.user_id);
      for (const profile of profiles) {
        supervisor.stopProfile(profile.id, 'Discord membership required for the Free plan.', {
          keepWanted: false,
        });
      }
    }
    res.json({ ok: true, checked: raw.length, changed });
  })
);

// ---------------------------------------------------------------- Tickets

/** Ein Ticket so, wie der Bot es braucht. */
function ticketView(ticket) {
  const rawOwner = db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.user_id);
  const owner = rawOwner
    ? {
        id: rawOwner.id,
        username: rawOwner.username,
        display_name: profile.displayNameOf(rawOwner),
        discord_id: rawOwner.discord_id,
      }
    : null;
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    source: ticket.source,
    channel_id: ticket.discord_channel_id,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    closed_at: ticket.closed_at || null,
    url: `${config.publicUrl}/en/app#/tickets/${ticket.id}`,
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
        author: message.author_name || message.display_name || message.username || null,
        body: message.body,
        created_at: message.created_at,
        discord_id: message.discord_id,
        files: message.files,
      })),
    });
  })
);

/**
 * Tickets für den Abgleich des Bots – `?open=0` nimmt die geschlossenen dazu (fürs Archiv).
 *
 * Sortiert wird **erst nach Zustand**, dann nach Nummer: Was noch läuft, steht vorn und fällt
 * damit nie aus der Grenze heraus. Vorher entschied allein die Nummer, und ein altes offenes
 * Ticket rutschte hinter dreihundert geschlossene – der Bot bekam es nicht mehr zu sehen und
 * legte den fehlenden Kanal deshalb nie an.
 */
router.get(
  '/tickets',
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT * FROM tickets
          WHERE ${req.query.open === '0' ? '1 = 1' : "status != 'closed'"}
          ORDER BY (status = 'closed'), id DESC LIMIT 500`
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
      { subject: body.subject, body: body.body, priority: body.priority },
      { source: 'discord' }
    );
    if (body.channel_id) tickets.setChannel(ticket.id, body.channel_id);
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

/**
 * Eine Nachricht aus Discord in den Verlauf übernehmen – mit ihren Anhängen.
 *
 * Die Dateien selbst holt sich das Panel: Der Bot meldet nur Name, Größe und die Adresse bei
 * Discord. Damit liegt jeder Anhang danach bei uns und überlebt Discords ablaufende Adressen.
 */
router.post(
  '/tickets/:id/messages',
  wrap(async (req, res) => {
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
    // **Wer hier schreiben darf, ist dieselbe Frage wie im Panel.** Geprüft wurde sie nicht: Es
    // genügte, dass irgendein verknüpftes Discord-Konto genannt wurde – und die Nachricht landete
    // im Verlauf eines fremden Tickets, unter dem Namen dieses Kontos, samt Post an alle
    // Beteiligten. Ein Kanal, den jemand versehentlich (oder absichtlich) offen hat, wurde damit
    // zum Schreibzugang zu fremden Support-Gesprächen.
    const participant = tickets.isParticipant(ticket.id, user.id);
    if (!participant && user.role !== 'admin') {
      throw new HttpError(403, 'Du gehörst nicht zu diesem Ticket.', {
        en: 'You are not part of this ticket.',
      });
    }
    // Nur Panel-Administratoren bearbeiten Tickets. Ist ein Administrator selbst Beteiligter,
    // schreibt er in *seinem* Ticket jedoch als Kunde – genau wie in der persönlichen
    // Support-Ansicht im Panel. Sonst würden eigene Antworten als Team-Antwort markiert und der
    // Status/Benachrichtigungen wären widersprüchlich.
    const staff = user.role === 'admin' && !participant;

    // Erst die Anhänge holen, dann die Nachricht schreiben: so hängen sie von Anfang an daran,
    // und der Verlauf im Panel ist nie kurz unvollständig. Eine Datei, die nicht kommt, hält die
    // Nachricht nicht auf – sie wäre sonst ganz verloren.
    const fileIds = [];
    const failed = [];
    for (const entry of (Array.isArray(body.attachments) ? body.attachments : []).slice(
      0,
      attachments.MAX_PER_MESSAGE
    )) {
      try {
        const file = await attachments.fromUrl({
          ticketId: null,
          messageId: null,
          userId: user.id,
          name: entry?.name,
          url: entry?.url,
          size: Number(entry?.size) || 0,
        });
        fileIds.push(file.id);
      } catch (error) {
        failed.push(`${entry?.name || 'Anhang'}: ${error.message}`);
      }
    }

    // Ohne Text, aber mit Bild: das ist in Discord der Normalfall und hier eine gültige Antwort.
    const updated = tickets.reply(ticket, user, String(body.body || ''), {
      authorName: body.author_name || profile.displayNameOf(user),
      discordId: String(body.discord_id || '') || null,
      staff,
      files: fileIds,
      // Welche Zahl in dieser Nachricht welchen Namen hatte. Der Bot löst es auf, das Panel
      // schreibt es an die Nachricht – geprüft wird es in `tickets.packMentions`.
      mentions: body.mentions,
    });
    tickets.notifyParticipants(
      updated,
      'ticket_reply',
      { preview: String(body.body || '').slice(0, 160), author: profile.displayNameOf(user) },
      user.id
    );
    res.json({ ok: true, ticket: ticketView(updated), files: fileIds.length, failed });
  })
);

/**
 * Einen Anhang an den Bot ausliefern, damit er ihn in den Discord-Kanal hängen kann.
 *
 * Der Bot hat schon das gemeinsame Geheimnis; geprüft wird hier nur, dass die Datei wirklich zu
 * diesem Ticket gehört und keine interne Notiz betrifft – die bleibt beim Team, auch in Discord.
 */
router.get(
  '/tickets/:id/files/:fileId',
  wrap((req, res) => {
    const ticketId = requireInt(req.params.id, 'Ticket');
    const file = attachments.byId(requireInt(req.params.fileId, 'Anhang'));
    if (!file || file.ticket_id !== ticketId || file.internal) {
      throw notFound('Diesen Anhang gibt es nicht.', { en: 'No such attachment.' });
    }
    const bytes = attachments.read(file);
    if (!bytes) throw notFound('Diese Datei liegt nicht mehr vor.', { en: 'That file is gone.' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-File-Name', encodeURIComponent(file.name));
    res.send(bytes);
  })
);

router.post(
  '/tickets/:id/status',
  wrap((req, res) => {
    const ticket = tickets.byId(requireInt(req.params.id, 'Ticket'));
    if (!ticket) throw notFound('Dieses Ticket gibt es nicht.', { en: 'No such ticket.' });
    const status = String(req.body?.status || '');
    if (status !== 'closed') {
      throw bad('Discord darf ein Ticket nur schließen.', {
        en: 'Discord may only close a ticket.',
      });
    }
    const by = req.body?.discord_id ? roles.byDiscordId(req.body.discord_id) : null;
    if (
      !by ||
      (by.role !== 'admin' && !tickets.isParticipant(ticket.id, by.id))
    ) {
      throw new HttpError(403, 'Du darfst dieses Ticket nicht schließen.', {
        en: 'You may not close this ticket.',
      });
    }
    // Im Ticket-Kanal drücken beide auf denselben Knopf. Ob das Team schließt oder der Kunde
    // selbst, entscheidet deshalb die Rolle des Discord-Kontos und nicht die Oberfläche.
    const updated = tickets.setStatus(ticket, status, by?.id ?? null, { staff: by?.role === 'admin' });
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
    // Der Zeitstempel steht **hinten**: Vorher konnte der Bot mit einem eigenen `at` im Rumpf die
    // eigene Uhr überschreiben, und im Admin-Bereich stand ein Lebenszeichen aus der Zukunft oder
    // aus dem letzten Jahr. Wann wir etwas gehört haben, wissen wir selbst am besten.
    lastHeartbeat = { ...(req.body || {}), at: Date.now() };
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
