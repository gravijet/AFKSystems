// Anmeldung, eigenes Konto, Minecraft-Konten, Proxys, Tickets und die Metadaten fürs Frontend.

import express from 'express';
import { config } from '../config.js';
import { db, getSetting, audit } from '../db.js';
import * as auth from '../auth.js';
import * as mslogin from '../mslogin.js';
import * as binaries from '../binaries.js';
import * as notify from '../notify.js';
import * as mail from '../mail.js';
import * as discord from '../discord.js';
import * as tickets from '../tickets.js';
import { features } from '../features.js';
import { actionsFor, eventsFor } from '../macros.js';
import { supervisor } from '../supervisor.js';
import * as billing from '../billing.js';
import { setLangCookie } from '../pages.js';
import { wrap, requireString, requireInt, bad, notFound, HttpError } from '../util.js';

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
      discord: { available: discord.configured(), login: discord.loginEnabled() },
      maintenance: Boolean(Number(getSetting('maintenance'))),
      maintenance_text: String(getSetting('maintenance_text') || ''),
      announcement: db
        .prepare('SELECT * FROM announcements WHERE active = 1 ORDER BY id DESC LIMIT 1')
        .get() || null,
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
      free_slots: billing.freeSlots(),
      month_days: billing.MONTH_DAYS,
      packages: billing.packages(),
      low_balance: Number(getSetting('low_balance')),
      signup_bonus: Number(getSetting('signup_bonus')),
      ticket_categories: tickets.categoriesFor(lang),
      support_hours: String(getSetting('support_hours') || ''),
      payment: {
        stripe: Boolean(config.stripeSecret),
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
    active: Boolean(plan.active),
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
    auth.createSession(res, user, req);
    audit(user.id, 'login');
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

// ------------------------------------------------ Discord

router.get(
  '/auth/discord/start',
  wrap((req, res) => {
    const mode = req.query.mode === 'login' ? 'login' : 'link';
    if (mode === 'link' && !req.user) throw new HttpError(401, 'Bitte anmelden.', { en: 'Please log in.' });
    res.redirect(discord.startUrl({ mode, userId: req.user?.id, lang: langOf(req) }));
  })
);

router.get(
  '/auth/discord/callback',
  wrap(async (req, res) => {
    const lang = langOf(req);
    try {
      const result = await discord.callback({ code: req.query.code, state: req.query.state });
      if (result.action === 'login') {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId);
        auth.createSession(res, user, req);
        audit(user.id, 'login-discord');
      }
      res.redirect(`/${result.lang || lang}/app#/settings?discord=ok`);
    } catch (error) {
      res.redirect(`/${lang}/app#/settings?discord=${encodeURIComponent(error.message)}`);
    }
  })
);

router.delete(
  '/auth/discord',
  auth.requireUser,
  wrap((req, res) => {
    discord.unlink(req.user.id);
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
      'Testnachricht',
      'Wenn du das liest, funktioniert die Benachrichtigung.',
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
      hint: paying
        ? 'Proxys werden von Hand zugeteilt – mach dafür ein Ticket der Kategorie „Proxy anfragen“ auf.'
        : 'Proxys gibt es ab einem bezahlten Serverplatz.',
    });
  })
);

// ---------------------------------------------------------------- Tickets

const ticketView = (row) => ({
  id: row.id,
  subject: row.subject,
  category: row.category,
  status: row.status,
  priority: row.priority,
  messages: row.messages ?? undefined,
  unread_user: Boolean(row.unread_user),
  unread_staff: Boolean(row.unread_staff),
  created_at: row.created_at,
  updated_at: row.updated_at,
  closed_at: row.closed_at,
  username: row.username,
  email: row.email,
});

router.get(
  '/tickets',
  auth.requireUser,
  wrap((req, res) => {
    res.json({
      tickets: tickets.listFor(req.user).map(ticketView),
      categories: tickets.categoriesFor(langOf(req)),
      priority_allowed: billing.isPayingUser(req.user.id),
    });
  })
);

router.post(
  '/tickets',
  auth.requireUser,
  wrap(async (req, res) => {
    const ticket = tickets.create(req.user, req.body || {});
    tickets.notifyStaff(ticket, req.user);
    res.json({ ticket: ticketView(ticket) });
  })
);

router.get(
  '/tickets/:id',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    tickets.markRead(ticket, req.user);
    res.json({
      ticket: ticketView(ticket),
      messages: tickets.messages(ticket.id, { staff: req.user.role === 'admin' }),
    });
  })
);

router.post(
  '/tickets/:id/reply',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    const updated = tickets.reply(ticket, req.user, req.body?.body);
    res.json({
      ticket: ticketView(updated),
      messages: tickets.messages(ticket.id, { staff: req.user.role === 'admin' }),
    });
  })
);

router.post(
  '/tickets/:id/close',
  auth.requireUser,
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    res.json({ ticket: ticketView(tickets.setStatus(ticket, 'closed', req.user.id)) });
  })
);
