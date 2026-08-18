// Anmeldung, eigenes Konto, Minecraft-Konten, Proxys, Tickets und die Metadaten fürs Frontend.

import express from 'express';
import { config } from '../config.js';
import { db, getSetting, audit } from '../db.js';
import * as auth from '../auth.js';
import * as mslogin from '../mslogin.js';
import * as binaries from '../binaries.js';
import * as notify from '../notify.js';
import * as mail from '../mail.js';
import * as oauth from '../oauth.js';
import * as tickets from '../tickets.js';
import * as attachments from '../attachments.js';
import * as nodes from '../nodes.js';
import { features } from '../features.js';
import { actionsFor, eventsFor } from '../macros.js';
import { supervisor } from '../supervisor.js';
import * as billing from '../billing.js';
import * as tebex from '../tebex.js';
import { setLangCookie } from '../pages.js';
import { bridge } from '../bridge.js';
import { wrap, requireInt, bad, notFound, forbidden, token, HttpError } from '../util.js';

export const router = express.Router();

/** Sprache dieser Anfrage – bestimmt, in welcher Sprache Listen zurückkommen. */
const langOf = (req) => (String(req.query.lang || req.user?.language || 'en') === 'de' ? 'de' : 'en');

// ---------------------------------------------------------------- Metadaten

router.get(
  '/meta',
  wrap((req, res) => {
    const lang = langOf(req);
    const caps = binaries.anyCaps();
    res.json({
      brand: config.brand,
      lang,
      registration_open: Boolean(Number(getSetting('registration_open'))) && config.registrationOpen,
      email_verify: mail.verifyRequired(),
      mail_ready: mail.configured(),
      oauth: oauth.state(),
      discord_invite: String(getSetting('discord_invite') || ''),
      free_plan: {
        guild_id: billing.freeGuildId(),
        invite: String(getSetting('discord_invite') || ''),
      },
      maintenance: Boolean(Number(getSetting('maintenance'))),
      maintenance_text: String(getSetting('maintenance_text') || ''),
      // Alle sichtbaren Ankündigungen, neueste zuerst. Bisher kam nur eine mit – gab es zwei,
      // sah niemand die zweite, und im Panel stand nirgends, dass es sie überhaupt gibt.
      announcements: db
        .prepare('SELECT * FROM announcements WHERE active = 1 ORDER BY id DESC LIMIT 5')
        .all()
        .map((row) => announcementView(row, lang)),
      versions: binaries.state.versions,
      default_version: binaries.state.defaultVersion,
      client_version: binaries.state.clientVersion,
      caps,
      builds: Object.fromEntries(
        Object.entries(binaries.state.builds).map(([key, entry]) => [key, entry.present])
      ),
      features: features(caps, lang),
      actions: actionsFor(lang),
      events: eventsFor(lang),
      plans: billing.plans().map((plan) => planView(plan, lang)),
      addons: billing.addons().map((addon) => addonView(addon, lang, caps)),
      free_slots: billing.freeSlots(),
      month_days: billing.MONTH_DAYS,
      packages: billing.packages(),
      mail_categories: mail.categoriesFor(lang),
      low_balance: Number(getSetting('low_balance')),
      signup_bonus: Number(getSetting('signup_bonus')),
      support_hours: String(getSetting('support_hours') || ''),
      payment: {
        tebex: tebex.configured(),
        transfer: Boolean(config.bankTransfer.iban),
        paypal: Boolean(config.bankTransfer.paypal),
        voucher: true,
      },
      user: req.user ? auth.publicUser(req.user) : null,
    });
  })
);

export function planView(plan, lang = 'en') {
  return {
    id: plan.id,
    slug: plan.slug,
    name: lang === 'de' ? plan.name_de : plan.name_en,
    blurb: lang === 'de' ? plan.blurb_de : plan.blurb_en,
    // Der Wortlaut der Merkmalsliste, wenn der Betreiber einen hinterlegt hat – eine Zeile je
    // Punkt. Sonst leer, und das Panel baut die Liste wie bisher aus den Zahlen.
    features: String((lang === 'de' ? plan.features_de : plan.features_en) || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    price_credits: plan.price_credits,
    price_euro: (plan.price_credits / 100).toFixed(2),
    free_slot: Boolean(plan.free_slot),
    max_accounts: plan.max_accounts,
    premium: Boolean(plan.premium),
    movement: Boolean(plan.movement),
    proxy: Boolean(plan.proxy),
    offline_accounts: Boolean(plan.offline_accounts),
    fakehost: Boolean(plan.fakehost),
    chat_limit: plan.chat_limit,
    chat_limit_editable: Boolean(plan.chat_limit_editable),
    priority_support: Boolean(plan.priority_support),
    board: Boolean(plan.board),
    menus: Boolean(plan.menus),
    pov: Boolean(plan.pov),
    max_macros: plan.max_macros,
    addons: Boolean(plan.addons),
    highlight: Boolean(plan.highlight),
    active: Boolean(plan.active),
  };
}

/** Ein Zusatz, wie ihn das Panel zeigt. `caps` sagt, ob der Client das überhaupt kann. */
export function addonView(addon, lang = 'en', caps = {}) {
  return {
    id: addon.id,
    key: addon.key,
    name: lang === 'de' ? addon.name_de : addon.name_en,
    text: lang === 'de' ? addon.text_de : addon.text_en,
    price_credits: addon.price_credits,
    price_euro: (addon.price_credits / 100).toFixed(2),
    kind: addon.kind,
    flag: addon.flag,
    amount: addon.amount,
    max_qty: addon.max_qty,
    // Ohne die passende Fähigkeit im Client wäre es ein Knopf, der nichts einlöst.
    available: Boolean(addon.available) && (!addon.need_cap || Boolean(caps[addon.need_cap])),
    announced: !addon.available,
  };
}

export function announcementView(row, lang = 'en') {
  return {
    id: row.id,
    title: lang === 'de' ? row.title_de : row.title_en,
    body: lang === 'de' ? row.body_de : row.body_en,
    kind: row.kind,
    link: row.link || '',
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------- Anmeldung

router.post(
  '/auth/register',
  wrap((req, res) => {
    if (!Number(getSetting('registration_open')) || !config.registrationOpen) {
      throw bad('Die Registrierung ist gerade geschlossen.', { en: 'Registration is closed at the moment.' });
    }
    const user = auth.register({ ...(req.body || {}), language: langOf(req) });
    const pending = mail.verifyRequired() && !user.email_verified;
    if (!pending) auth.createSession(res, user, req);
    setLangCookie(res, user.language);
    res.json({ user: auth.publicUser(user), verify_pending: pending });
  })
);

router.post(
  '/auth/login',
  wrap((req, res) => {
    const user = auth.login(req.body || {});
    // Vor dem Anlegen der Sitzung: danach wäre jedes Gerät bekannt (siehe auth.noticeNewDevice).
    auth.noticeNewDevice(user, req);
    auth.createSession(res, user, req);
    audit(user.id, 'login', null, req.ip);
    res.json({
      user: auth.publicUser(user),
      verify_pending: mail.verifyRequired() && !user.email_verified,
    });
  })
);

router.post(
  '/auth/logout',
  wrap((req, res) => {
    auth.destroySession(req, res);
    res.json({ ok: true });
  })
);

router.post(
  '/auth/verify',
  wrap((req, res) => {
    const user = auth.verifyEmail(req.body?.token);
    if (!user) throw bad('Dieser Link gilt nicht mehr.', { en: 'This link is no longer valid.', code: 'verify-invalid' });
    auth.createSession(res, user, req);
    res.json({ user: auth.publicUser(user) });
  })
);

router.post(
  '/auth/verify/resend',
  wrap(async (req, res) => {
    if (!req.user) throw new HttpError(401, 'Bitte anmelden.', { en: 'Please log in.' });
    const result = await auth.resendVerification(req.user);
    if (result && result.ok === false) {
      throw bad(`E-Mail ließ sich nicht verschicken: ${result.error}`, {
        en: `The email could not be sent: ${result.error}`,
      });
    }
    res.json({ ok: true });
  })
);

router.post(
  '/auth/forgot',
  wrap(async (req, res) => {
    if (!mail.configured()) {
      throw bad('Das Zurücksetzen per E-Mail ist hier nicht eingerichtet.', {
        en: 'Password reset by email is not set up on this server.',
      });
    }
    await auth.requestReset(req.body?.email);
    res.json({ ok: true });
  })
);

router.post(
  '/auth/reset',
  wrap((req, res) => {
    auth.applyReset(req.body?.token, req.body?.password, req.body?.password2);
    res.json({ ok: true });
  })
);

/**
 * Zurück aus "Als Nutzer ansehen". Die geliehene Sitzung wird gelöscht und das Cookie wieder auf
 * die eigene Admin-Sitzung gesetzt – deshalb steht das hier und nicht im Admin-Bereich: wer sich
 * gerade als Nutzer ansieht, ist in diesem Moment kein Admin.
 */
router.post(
  '/auth/return',
  wrap((req, res) => {
    if (!req.user || !req.impersonator || !req.parentToken) {
      throw bad('Diese Sitzung wurde nicht von einem Administrator geöffnet.', {
        en: 'This session was not opened by an administrator.',
      });
    }
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    auth.setSessionCookie(res, req.parentToken);
    res.json({ ok: true });
  })
);

// ------------------------------------------------ Discord und Google
//
// Drei Wege, ein Ablauf: `link` verknüpft ein fremdes Konto mit dem hiesigen, `login` meldet an
// (und legt beim ersten Mal ein Konto an), `verify` schreibt die Werte für Discords Linked Roles.

const PROVIDER = /^(discord|google)$/;

/** Das Merkmal, das Start und Rückweg einer Anmeldung an denselben Browser bindet. */
const OAUTH_COOKIE = 'afk_oauth';

router.get(
  '/auth/:provider/start',
  wrap((req, res) => {
    if (!PROVIDER.test(req.params.provider)) throw notFound('Unbekannter Anbieter.', { en: 'Unknown provider.' });
    const mode = ['login', 'verify'].includes(req.query.mode) ? req.query.mode : 'link';
    if (mode !== 'login' && !req.user) {
      throw new HttpError(401, 'Bitte anmelden.', { en: 'Please log in.' });
    }
    // Ein Merkmal dieses Browsers reist im Cookie mit und muss beim Rückweg wieder da sein.
    // Sonst könnte jemand seine eigene, fertige Anmeldung einem anderen unterschieben.
    const binding = token(24);
    res.cookie(OAUTH_COOKIE, binding, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.publicUrl.startsWith('https'),
      maxAge: 10 * 60_000,
      path: '/api/auth',
    });
    res.redirect(
      oauth.startUrl(req.params.provider, { mode, userId: req.user?.id, lang: langOf(req), binding })
    );
  })
);

router.get(
  '/auth/:provider/callback',
  wrap(async (req, res) => {
    const lang = langOf(req);
    const key = req.params.provider;
    if (!PROVIDER.test(key)) return res.redirect(`/${lang}`);
    const binding = auth.readCookie(req, OAUTH_COOKIE);
    res.clearCookie(OAUTH_COOKIE, { path: '/api/auth' });
    try {
      const result = await oauth.callback({ code: req.query.code, state: req.query.state, binding });
      if (result.action === 'login' || result.action === 'created') {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId);
        auth.createSession(res, user, req);
        audit(user.id, `login-${key}`, null, req.ip);
        setLangCookie(res, user.language);
        return res.redirect(
          `/${user.language}/app${result.action === 'created' ? '#/settings?welcome=1' : ''}`
        );
      }
      res.redirect(`/${result.lang || lang}/app#/settings?link=${key}`);
    } catch (error) {
      res.redirect(`/${lang}/app#/settings?error=${encodeURIComponent(error.message)}`);
    }
  })
);

router.delete(
  '/auth/:provider',
  auth.requireUser,
  wrap((req, res) => {
    if (!PROVIDER.test(req.params.provider)) throw notFound('Unbekannter Anbieter.', { en: 'Unknown provider.' });
    // Wer sich über Discord oder Google angemeldet hat, hat hier kein Passwort. Ausgesperrt ist er
    // trotzdem nicht: die E-Mail-Adresse steht am Konto, und "Passwort vergessen" setzt eines.
    oauth.unlink(req.params.provider, req.user.id);
    if (req.params.provider === 'discord') {
      const freeProfiles = db
        .prepare(
          `SELECT p.id FROM profiles p JOIN plans pl ON pl.id = p.plan_id
            WHERE p.user_id = ? AND pl.free_slot = 1`
        )
        .all(req.user.id);
      for (const profile of freeProfiles) {
        supervisor.stopProfile(profile.id, 'Für den Gratis-Tarif muss Discord verknüpft bleiben.', {
          keepWanted: false,
        });
      }
    }
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Eigenes Konto

router.get(
  '/me',
  auth.requireUser,
  wrap((req, res) => {
    const bots = supervisor.list(req.user.id);
    const profiles = db
      .prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?')
      .get(req.user.id).n;
    res.json({
      user: auth.publicUser(req.user),
      impersonator: req.impersonator || null,
      stats: {
        accounts: db.prepare('SELECT COUNT(*) AS n FROM mc_accounts WHERE user_id = ?').get(req.user.id).n,
        profiles,
        bots_running: bots.filter((bot) => bot.state !== 'offline' && bot.state !== 'error').length,
        bots_online: bots.filter((bot) => bot.online).length,
        monthly_cost: billing.monthlyCost(req.user.id),
        free_slots_left: Math.max(0, billing.freeSlots() - billing.usedFreeSlots(req.user.id)),
        tickets_unread: tickets.unreadFor(req.user),
        staff_tickets: req.user.role === 'admin' ? tickets.openForStaff() : 0,
      },
    });
  })
);

router.patch(
  '/me',
  auth.requireUser,
  wrap((req, res) => {
    const body = req.body || {};
    const fields = [];
    const values = [];
    if (body.theme !== undefined) {
      if (!['light', 'dark', 'system'].includes(body.theme)) {
        throw bad('Unbekanntes Aussehen.', { en: 'Unknown appearance.' });
      }
      fields.push('theme = ?');
      values.push(body.theme);
    }
    if (body.discord_webhook !== undefined) {
      const hook = String(body.discord_webhook || '').trim();
      if (hook && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(hook)) {
        throw bad('Das sieht nicht nach einem Discord-Webhook aus.', {
          en: 'That does not look like a Discord webhook.',
        });
      }
      fields.push('discord_webhook = ?');
      values.push(hook || null);
    }
    if (body.language !== undefined) {
      const lang = body.language === 'de' ? 'de' : 'en';
      fields.push('language = ?');
      values.push(lang);
      setLangCookie(res, lang);
    }
    if (body.mail_prefs !== undefined) {
      // Nur bekannte Kategorien, und die festen lassen sich nicht abstellen – sonst stünde in der
      // Datenbank irgendwann ein Wunsch, den es gar nicht gibt.
      const wanted = body.mail_prefs && typeof body.mail_prefs === 'object' ? body.mail_prefs : {};
      const clean = {};
      for (const entry of mail.CATEGORIES) {
        if (entry.locked) continue;
        clean[entry.key] = wanted[entry.key] !== false;
      }
      fields.push('mail_prefs = ?');
      values.push(JSON.stringify(clean));
    }
    if (!fields.length) throw bad('Nichts zu ändern.', { en: 'Nothing to change.' });
    values.push(req.user.id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    res.json({ user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  })
);

router.get(
  '/me/sessions',
  auth.requireUser,
  wrap((req, res) => res.json({ sessions: auth.sessionsOf(req.user.id) }))
);

/**
 * Die letzten Nachrichten an dieses Konto.
 *
 * Damit lässt sich prüfen, ob eine E-Mail mit unserem Namen wirklich von uns kam: Wer eine
 * bekommt, die zu Guthaben oder Passwort auffordert, sieht hier nach – steht sie nicht drin,
 * war sie es nicht.
 */
router.get(
  '/me/mails',
  auth.requireUser,
  wrap((req, res) =>
    res.json({ mails: mail.historyFor(req.user.id, 25), categories: mail.categoriesFor(langOf(req)) })
  )
);

router.get(
  '/me/mails/:id',
  auth.requireUser,
  wrap((req, res) => {
    const row = mail.mailById(requireInt(req.params.id, 'Nachricht'), req.user.id);
    if (!row) throw notFound('Diese Nachricht gibt es nicht.', { en: 'No such message.' });
    res.json({ mail: row });
  })
);

router.delete(
  '/me/sessions',
  auth.requireUser,
  wrap((req, res) => {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(
      req.user.id,
      req.sessionToken
    );
    res.json({ ok: true });
  })
);

router.post(
  '/me/discord-test',
  auth.requireUser,
  wrap(async (req, res) => {
    if (!req.user.discord_webhook) throw bad('Es ist kein Webhook hinterlegt.', { en: 'No webhook is stored.' });
    const sent = await notify.notify(
      req.user.id,
      { de: 'Testnachricht', en: 'Test message' },
      {
        de: 'Wenn du das liest, funktioniert die Benachrichtigung.',
        en: 'If you can read this, notifications are working.',
      },
      { key: `test-${Date.now()}` }
    );
    if (!sent) {
      throw bad('Discord hat die Nachricht nicht angenommen. Stimmt die Adresse noch?', {
        en: 'Discord did not accept the message. Is the address still right?',
      });
    }
    res.json({ ok: true });
  })
);

router.post(
  '/me/password',
  auth.requireUser,
  wrap((req, res) => {
    auth.changePassword(
      req.user,
      req.body?.old_password,
      req.body?.new_password,
      req.body?.new_password2
    );
    auth.createSession(res, req.user, req);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Minecraft-Konten

const accountView = (row) => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  uuid: row.uuid,
  status: row.status,
  last_error: row.last_error,
  suspended: Boolean(row.suspended),
  suspend_reason: row.suspend_reason || '',
  connections: row.connections,
  created_at: row.created_at,
  // Kopfbild aus dem öffentlichen Skin-Dienst; ohne UUID nimmt der Dienst den Namen.
  head: `https://minotar.net/helm/${encodeURIComponent(row.uuid || row.name)}/64.png`,
});

router.get(
  '/accounts',
  auth.requireUser,
  wrap((req, res) => {
    mslogin.reconcile(req.user.id);
    const rows = db
      .prepare('SELECT * FROM mc_accounts WHERE user_id = ? ORDER BY name COLLATE NOCASE')
      .all(req.user.id);
    res.json({
      accounts: rows.map(accountView),
      offline_allowed: billing.isPayingUser(req.user.id) && Boolean(binaries.anyCaps().offline),
    });
  })
);

router.post(
  '/accounts/login',
  auth.requireUser,
  wrap((req, res) => {
    if (!binaries.state.ready) {
      throw bad('Der Client ist noch nicht geladen. Bitte kurz warten.', {
        en: 'The client has not been downloaded yet. One moment.',
      });
    }
    res.json(mslogin.begin(req.user));
  })
);

router.get(
  '/accounts/login/:id',
  auth.requireUser,
  wrap((req, res) => res.json(mslogin.status(req.params.id, req.user)))
);

router.delete(
  '/accounts/login/:id',
  auth.requireUser,
  wrap((req, res) => {
    mslogin.cancel(req.params.id, req.user);
    res.json({ ok: true });
  })
);

router.post(
  '/accounts/offline',
  auth.requireUser,
  wrap((req, res) => {
    if (!binaries.anyCaps().offline) {
      throw bad('Der Client kann keine Offline-Konten.', { en: 'This client cannot do offline accounts.' });
    }
    if (!billing.isPayingUser(req.user.id)) {
      throw new HttpError(402, 'Offline-Konten gibt es ab einem bezahlten Serverplatz.', {
        en: 'Offline accounts come with a paid server slot.',
      });
    }
    res.json({ account: accountView(mslogin.addOffline(req.user, req.body?.name)) });
  })
);

router.delete(
  '/accounts/:id',
  auth.requireUser,
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Konto');
    // Laufende Bots dieses Kontos zuerst anhalten.
    for (const row of db.prepare('SELECT profile_id FROM profile_accounts WHERE account_id = ?').all(id)) {
      supervisor.stop(row.profile_id, id);
    }
    res.json({ account: accountView(mslogin.removeAccount(req.user, id)) });
  })
);

// ---------------------------------------------------------------- Proxys
//
// Proxys legt der Betreiber an und teilt sie zu; ein Nutzer sieht nur seine eigenen. Der Weg
// dorthin führt über ein Ticket, weil hinter jedem Proxy eine echte IP-Adresse steckt.

router.get(
  '/proxies',
  auth.requireUser,
  wrap((req, res) => {
    const paying = billing.isPayingUser(req.user.id);
    const lang = langOf(req);
    const rows = paying
      ? db
          .prepare(
            `SELECT id, label, kind, host, port, username, note, created_at FROM proxies
              WHERE assigned_to = ? ORDER BY id`
          )
          .all(req.user.id)
      : [];
    res.json({
      proxies: rows,
      allowed: paying,
      supported: Boolean(binaries.anyCaps().proxy),
      // Der Hinweis stand nur auf Deutsch da, egal in welcher Sprache das Panel lief.
      hint: paying
        ? lang === 'de'
          ? 'Proxys werden von Hand zugeteilt – mach dafür ein Ticket auf und schreib dazu, für welchen Serverplatz.'
          : 'Proxies are assigned by hand. Open a ticket and say which server slot it is for.'
        : lang === 'de'
          ? 'Proxys gibt es ab einem bezahlten Serverplatz.'
          : 'Proxies come with a paid server slot.',
    });
  })
);

// ---------------------------------------------------------------- Tickets

export const ticketView = (row) => ({
  id: row.id,
  subject: row.subject,
  status: row.status,
  priority: row.priority,
  source: row.source,
  messages: row.messages ?? undefined,
  shared: Boolean(row.shared),
  extra_users: row.extra_users ?? undefined,
  unread_user: Boolean(row.unread_user),
  unread_staff: Boolean(row.unread_staff),
  discord: Boolean(row.discord_channel_id),
  assigned_to: row.assigned_to ?? null,
  assigned_name: row.assigned_name ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  closed_at: row.closed_at,
  username: row.username,
  email: row.email,
});

/**
 * Einen Anhang hochladen.
 *
 * Ohne Ticketnummer: Wer ein neues Ticket schreibt, hängt seinen Screenshot an, bevor es das
 * Ticket gibt. Die Datei gehört bis zum Abschicken nur dem Hochladenden; erst `files.claim()`
 * beim Anlegen oder Antworten verbindet sie mit einem Ticket. Was liegen bleibt, räumt der
 * tägliche Durchlauf weg.
 *
 * Der Rumpf ist die Datei selbst – kein Formular, keine Zusatzbibliothek. Wie sie heißt, steht im
 * Kopf `X-File-Name`; was sie ist, entscheidet ohnehin der Inhalt und nicht der Absender.
 */
router.post(
  '/tickets/files',
  auth.requireUser,
  express.raw({ type: '*/*', limit: attachments.MAX_BYTES }),
  wrap((req, res) => {
    const open = db
      .prepare('SELECT COUNT(*) AS n FROM ticket_files WHERE user_id = ? AND ticket_id IS NULL')
      .get(req.user.id).n;
    if (open >= 50) {
      throw bad('Zu viele offene Anhänge. Bitte erst das Ticket abschicken.', {
        en: 'Too many pending attachments. Please send the ticket first.',
      });
    }
    let name = 'anhang';
    try {
      name = decodeURIComponent(String(req.headers['x-file-name'] || '')) || name;
    } catch {
      name = String(req.headers['x-file-name'] || '') || name;
    }
    const file = attachments.store({
      userId: req.user.id,
      name,
      buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
    });
    res.json({ file: attachments.view(file) });
  })
);

/**
 * Einen Anhang herunterladen.
 *
 * Wer ihn sehen darf, entscheidet das Ticket: Beteiligte sehen die Anhänge ihres Tickets,
 * Administratoren jedes – interne Notizen samt ihren Dateien allerdings nur die. Eine noch nicht
 * abgeschickte Datei gehört allein dem, der sie hochgeladen hat.
 */
router.get(
  '/tickets/files/:fileId',
  auth.requireUser,
  wrap((req, res) => {
    const file = attachments.byId(requireInt(req.params.fileId, 'Anhang'));
    if (!file) throw notFound('Diesen Anhang gibt es nicht.', { en: 'No such attachment.' });
    const admin = req.user.role === 'admin';
    const allowed = file.ticket_id
      ? (admin || (!file.internal && tickets.isParticipant(file.ticket_id, req.user.id)))
      : file.user_id === req.user.id;
    if (!allowed) throw forbidden();
    const bytes = attachments.read(file);
    if (!bytes) throw notFound('Diese Datei liegt nicht mehr vor.', { en: 'That file is gone.' });
    // Bilder dürfen im Verlauf stehen, alles andere wird heruntergeladen. Der Inhaltstyp kommt
    // aus den Bytes (attachments.sniff) – nie aus dem, was beim Hochladen behauptet wurde.
    const inline = attachments.isInline(file.mime) && req.query.download !== '1';
    res.setHeader('Content-Type', inline ? file.mime : 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(bytes);
  })
);

router.get(
  '/tickets',
  auth.requireUser,
  wrap((req, res) => {
    res.json({
      tickets: tickets.listFor(req.user).map(ticketView),
      priority_allowed: billing.isPayingUser(req.user.id),
      max_upload: attachments.MAX_BYTES,
    });
  })
);

router.post(
  '/tickets',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.create(req.user, req.body || {});
    // Das Team bekommt Bescheid – über den Webhook und, wenn er läuft, als Kanal in Discord.
    tickets.notifyStaff(ticket, req.user);
    tickets.notifyParticipants(ticket, 'ticket_opened', {}, null);
    bridge.emit('ticket.created', { ticket_id: ticket.id, source: 'panel', user_id: req.user.id });
    res.json({ ticket: ticketView(ticket) });
  })
);

router.get(
  '/tickets/:id',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    tickets.markRead(ticket, req.user, { staff: false });
    res.json({
      ticket: ticketView(ticket),
      messages: tickets.messages(ticket.id, { staff: false }),
      participants: tickets.participants(ticket.id),
      me: req.user.id,
    });
  })
);

/** Nur die Nachrichten ab einer bestimmten – der Live-Verlauf holt sich damit den Nachschlag. */
router.get(
  '/tickets/:id/messages',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    const since = Number(req.query.since) || 0;
    tickets.markRead(ticket, req.user, { staff: false });
    const all = tickets.messages(ticket.id, { staff: false });
    res.json({
      ticket: ticketView(ticket),
      messages: since ? all.filter((message) => message.id > since) : all,
    });
  })
);

router.post(
  '/tickets/:id/reply',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    const updated = tickets.reply(ticket, req.user, req.body?.body, {
      staff: false,
      files: req.body?.files,
    });
    tickets.notifyStaffReply(updated, req.user, req.body?.body || '');
    // Alle anderen Beteiligten bekommen Post – der Schreiber nicht.
    tickets.notifyParticipants(
      updated,
      'ticket_reply',
      { preview: String(req.body?.body || '').slice(0, 160) },
      req.user.id
    );
    res.json({
      ticket: ticketView(updated),
      messages: tickets.messages(ticket.id, { staff: false }),
    });
  })
);

/**
 * Zustand ändern. Ein Kunde darf ausschließlich schließen. Eine neue Antwort auf ein bereits
 * geschlossenes Ticket öffnet es weiterhin automatisch, aber es gibt keinen manuellen "Offen"-
 * Schalter mehr.
 */
router.post(
  '/tickets/:id/status',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    const wanted = String(req.body?.status || '');
    if (wanted !== 'closed') {
      throw bad('Diesen Zustand darfst du nicht setzen.', { en: 'You cannot set that status.' });
    }
    const updated = tickets.setStatus(ticket, wanted, req.user.id);
    tickets.notifyParticipants(updated, 'ticket_closed', {}, req.user.id);
    res.json({ ticket: ticketView(updated) });
  })
);

// Alter Name, damit nichts bricht, was ihn noch benutzt.
router.post(
  '/tickets/:id/close',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    const updated = tickets.setStatus(ticket, 'closed', req.user.id);
    tickets.notifyParticipants(updated, 'ticket_closed', {}, req.user.id);
    res.json({ ticket: ticketView(updated) });
  })
);

/**
 * "schreibt gerade …".
 *
 * Es wird nichts gespeichert: die Meldung geht an alle, die dieses Ticket offen haben, und ist
 * nach ein paar Sekunden vorbei. Genau deshalb steht sie hier und nicht in der Datenbank.
 */
router.post(
  '/tickets/:id/typing',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.getForParticipant(requireInt(req.params.id, 'Ticket'), req.user);
    bridge.emit('ticket.typing', {
      ticket_id: ticket.id,
      user_id: req.user.id,
      name: req.user.username,
      staff: false,
    });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Ankündigungen

router.get(
  '/announcements',
  wrap((req, res) => {
    const lang = langOf(req);
    res.json({
      announcements: db
        .prepare('SELECT * FROM announcements WHERE active = 1 ORDER BY id DESC LIMIT 20')
        .all()
        .map((row) => announcementView(row, lang)),
    });
  })
);

// ---------------------------------------------------------------- Standorte

router.get(
  '/nodes',
  auth.requireUser,
  wrap((req, res) => res.json({ nodes: nodes.visibleFor(req.user) }))
);
