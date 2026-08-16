// Der Admin-Bereich. Alles, was der Betreiber im Alltag braucht, ohne je an die Datenbank zu
// müssen: Nutzer, Tarife, Guthaben, Gutscheine, Aufladungen, Proxys, Tickets, Ankündigungen,
// Einstellungen, Client-Dateien, laufende Bots und das Protokoll.

import express from 'express';
import { config, paths } from '../config.js';
import { db, setSetting, allSettings, audit, settingDefaults } from '../db.js';
import * as auth from '../auth.js';
import * as billing from '../billing.js';
import * as binaries from '../binaries.js';
import * as mail from '../mail.js';
import * as oauth from '../oauth.js';
import * as tickets from '../tickets.js';
import * as nodes from '../nodes.js';
import * as metrics from '../metrics.js';
import { supervisor } from '../supervisor.js';
import { planView, ticketView } from './core.js';
import { botState } from './bot.js';
import { bridge } from '../bridge.js';
import { SETTINGS, byKey as settingSchema, schemaFor } from '../settings-schema.js';
import { mergeLines } from '../../public/assets/js/chatlog.js';
import {
  wrap,
  requireInt,
  requireString,
  bad,
  notFound,
  hashPassword,
  parseAddress,
  formatCredits,
} from '../util.js';

export const admin = express.Router();
admin.use(auth.requireUser, auth.requireAdmin);

const langOf = (req) => (String(req.query.lang || req.user?.language || 'en') === 'de' ? 'de' : 'en');

// ---------------------------------------------------------------- Überblick

admin.get(
  '/overview',
  wrap((req, res) => {
    const day = Date.now() - 86_400_000;
    const month = Date.now() - 30 * 86_400_000;
    res.json({
      users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      users_new_30d: db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at > ?').get(month).n,
      users_active_24h: db.prepare('SELECT COUNT(*) AS n FROM users WHERE last_seen_at > ?').get(day).n,
      users_blocked: db.prepare('SELECT COUNT(*) AS n FROM users WHERE blocked = 1').get().n,
      users_unverified: db.prepare('SELECT COUNT(*) AS n FROM users WHERE email_verified = 0').get().n,
      accounts: db.prepare('SELECT COUNT(*) AS n FROM mc_accounts').get().n,
      profiles: db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n,
      profiles_paid: db
        .prepare(
          "SELECT COUNT(*) AS n FROM profiles p JOIN plans pl ON pl.id = p.plan_id WHERE pl.free_slot = 0 AND p.paid_until > ?"
        )
        .get(Date.now()).n,
      profiles_suspended: db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE suspended = 1').get().n,
      bots_running: supervisor.runningCount(),
      bots_online: [...supervisor.bots.values()].filter((bot) => bot.online).length,
      credits_outstanding: db.prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM users').get().n,
      revenue_cent: db
        .prepare("SELECT COALESCE(SUM(amount_cent), 0) AS n FROM topups WHERE status = 'paid'")
        .get().n,
      revenue_30d_cent: db
        .prepare("SELECT COALESCE(SUM(amount_cent), 0) AS n FROM topups WHERE status = 'paid' AND paid_at > ?")
        .get(month).n,
      mrr_credits: db
        .prepare(
          "SELECT COALESCE(SUM(pl.price_credits), 0) AS n FROM profiles p JOIN plans pl ON pl.id = p.plan_id WHERE pl.free_slot = 0 AND p.paid_until > ?"
        )
        .get(Date.now()).n,
      open_topups: db.prepare("SELECT COUNT(*) AS n FROM topups WHERE status = 'open'").get().n,
      tickets: tickets.counts(),
      open_tickets: db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status != 'closed'").get().n,
      unread_tickets: tickets.openForStaff(),
      nodes: nodes.list({ includeInactive: true }).length,
      client: clientState(),
      mail: {
        configured: mail.configured(),
        verify: mail.verifyRequired(),
        sent_24h: db
          .prepare("SELECT COUNT(*) AS n FROM mails WHERE created_at > ? AND status = 'sent'")
          .get(day).n,
        failed_24h: db
          .prepare("SELECT COUNT(*) AS n FROM mails WHERE created_at > ? AND status = 'failed'")
          .get(day).n,
      },
      oauth: oauth.state(),
      bot: botState(),
      settings: safeSettings(),
    });
  })
);

/**
 * Was die Maschine gerade tut.
 *
 * Steht bewusst nicht in /overview: die Werte kommen aus zwei Messungen im Abstand und sollen im
 * Sekundentakt abgefragt werden können, ohne dass dabei jedes Mal die halbe Datenbank gezählt wird.
 */
admin.get(
  '/metrics',
  wrap(async (req, res) => {
    const snapshot = await metrics.snapshot();
    const perProfile = metrics.byProfile();
    res.json({
      ...snapshot,
      profiles: [...perProfile.values()].map((entry) => {
        const row = db
          .prepare('SELECT p.name, p.user_id, u.username FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.id = ?')
          .get(entry.profile_id);
        return {
          ...entry,
          disk: metrics.diskOfProfile(entry.profile_id),
          name: row?.name || `#${entry.profile_id}`,
          user_id: row?.user_id,
          username: row?.username,
        };
      }),
    });
  })
);

function clientState() {
  return {
    tag: binaries.state.tag,
    version: binaries.state.clientVersion,
    versions: binaries.state.versions,
    default_version: binaries.state.defaultVersion,
    checked: binaries.state.checkedAt,
    published: binaries.state.publishedAt,
    error: binaries.state.error,
    builds: binaries.state.builds,
    files: binaries.files(),
    dir: paths.bin,
  };
}

/**
 * Einstellungen ohne Geheimnisse.
 *
 * Ein Geheimnis verlässt diesen Server nicht: Das Panel erfährt nur, **ob** eines hinterlegt ist,
 * nie welches. Vorher kamen zwei davon als Punktreihe zurück und alle anderen im Klartext – ein
 * Bot-Token oder ein Webhook im HTML einer Seite ist so gut wie veröffentlicht.
 */
function safeSettings() {
  const settings = allSettings();
  const out = { ...settings };
  const secrets = {};
  for (const entry of SETTINGS) {
    if (!entry.secret) continue;
    secrets[entry.key] = Boolean(String(settings[entry.key] || '').trim());
    delete out[entry.key];
  }
  return { ...out, secrets };
}

// ---------------------------------------------------------------- Nutzer

const userRow = (row) => ({
  id: row.id,
  email: row.email,
  username: row.username,
  role: row.role,
  credits: row.credits,
  blocked: Boolean(row.blocked),
  email_verified: Boolean(row.email_verified),
  language: row.language,
  discord: row.discord_id ? { id: row.discord_id, name: row.discord_name } : null,
  premium_until: row.premium_until,
  proxy_allowance: row.proxy_allowance,
  notes: row.notes || '',
  created_at: row.created_at,
  last_seen_at: row.last_seen_at,
  accounts: row.accounts ?? undefined,
  profiles: row.profiles ?? undefined,
  paid_profiles: row.paid_profiles ?? undefined,
  monthly: row.monthly ?? undefined,
  bots_running: supervisor.list(row.id).filter((bot) => bot.state !== 'offline').length,
});

admin.get(
  '/users',
  wrap((req, res) => {
    const search = String(req.query.q || '').trim();
    const filter = String(req.query.filter || 'all');
    const where = [];
    const values = [];
    if (search) {
      where.push('(u.username LIKE ? OR u.email LIKE ? OR u.discord_name LIKE ?)');
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (filter === 'admins') where.push("u.role = 'admin'");
    if (filter === 'blocked') where.push('u.blocked = 1');
    if (filter === 'unverified') where.push('u.email_verified = 0');
    if (filter === 'paying') {
      where.push(
        `EXISTS (SELECT 1 FROM profiles p JOIN plans pl ON pl.id = p.plan_id
                  WHERE p.user_id = u.id AND pl.free_slot = 0 AND p.paid_until > ${Date.now()})`
      );
    }

    const rows = db
      .prepare(
        `SELECT u.*,
                (SELECT COUNT(*) FROM mc_accounts a WHERE a.user_id = u.id) AS accounts,
                (SELECT COUNT(*) FROM profiles p WHERE p.user_id = u.id) AS profiles,
                (SELECT COUNT(*) FROM profiles p JOIN plans pl ON pl.id = p.plan_id
                  WHERE p.user_id = u.id AND pl.free_slot = 0 AND p.paid_until > ${Date.now()}) AS paid_profiles,
                (SELECT COALESCE(SUM(pl.price_credits), 0) FROM profiles p JOIN plans pl ON pl.id = p.plan_id
                  WHERE p.user_id = u.id AND pl.free_slot = 0 AND p.paid_until > ${Date.now()}) AS monthly
           FROM users u
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY u.id DESC LIMIT 500`
      )
      .all(...values);
    res.json({ users: rows.map(userRow) });
  })
);

admin.get(
  '/users/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer gibt es nicht.');
    const lang = langOf(req);
    res.json({
      user: userRow(user),
      profiles: db
        .prepare(
          `SELECT p.*, pl.name_de, pl.name_en, pl.price_credits, pl.free_slot
             FROM profiles p LEFT JOIN plans pl ON pl.id = p.plan_id
            WHERE p.user_id = ? ORDER BY p.ordinal, p.id`
        )
        .all(id)
        .map((row) => ({
          id: row.id,
          name: row.name,
          address: row.port ? `${row.host}:${row.port}` : row.host,
          mc_version: row.mc_version,
          plan: lang === 'de' ? row.name_de : row.name_en,
          price_credits: row.price_credits,
          free_slot: Boolean(row.free_slot),
          paid_until: row.paid_until,
          suspended: Boolean(row.suspended),
          online: supervisor.runningOnProfile(row.id),
        })),
      accounts: db.prepare('SELECT * FROM mc_accounts WHERE user_id = ? ORDER BY name').all(id),
      ledger: billing.history(id, 100),
      topups: db.prepare('SELECT * FROM topups WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(id),
      tickets: db
        .prepare('SELECT id, subject, status, category, updated_at FROM tickets WHERE user_id = ? ORDER BY updated_at DESC')
        .all(id),
      proxies: db.prepare('SELECT * FROM proxies WHERE assigned_to = ?').all(id),
      sessions: auth.sessionsOf(id),
      monthly_cost: billing.monthlyCost(id),
      paying: billing.isPayingUser(id),
    });
  })
);

admin.post(
  '/users',
  wrap((req, res) => {
    const body = req.body || {};
    const user = auth.register({
      email: body.email,
      username: body.username,
      password: body.password,
      password2: body.password,
      language: body.language === 'de' ? 'de' : 'en',
    });
    // Von Hand angelegt heißt: der Betreiber steht dafür ein, also gleich bestätigt.
    db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL WHERE id = ?').run(user.id);
    if (body.role === 'admin') db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    audit(req.user.id, 'admin-user-create', { user: user.id });
    res.json({ user: userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
  })
);

admin.patch(
  '/users/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer gibt es nicht.');
    const body = req.body || {};

    if (body.credits_delta !== undefined) {
      const delta = Math.trunc(Number(body.credits_delta));
      if (!Number.isFinite(delta) || delta === 0) throw bad('Betrag fehlt.');
      billing.move(id, delta, 'admin', String(body.note || `durch ${req.user.username}`).slice(0, 200));
      audit(req.user.id, 'admin-credits', { user: id, delta });
    }
    if (body.role !== undefined) {
      if (!['user', 'admin'].includes(body.role)) throw bad('Unbekannte Rolle.');
      if (id === req.user.id && body.role !== 'admin') throw bad('Sich selbst kann man nicht herabstufen.');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, id);
    }
    if (body.blocked !== undefined) {
      db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(body.blocked ? 1 : 0, id);
      if (body.blocked) {
        supervisor.stopUser(id, 'Konto wurde gesperrt.');
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
    }
    if (body.email !== undefined) {
      const address = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(address)) throw bad('Keine gültige E-Mail-Adresse.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(address, id)) {
        throw bad('Diese Adresse hat schon jemand.');
      }
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(address, id);
    }
    if (body.username !== undefined) {
      const name = requireString(body.username, 'Benutzername', { max: 24 });
      if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(name, id)) {
        throw bad('Diesen Namen hat schon jemand.');
      }
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, id);
    }
    if (body.email_verified !== undefined) {
      db.prepare('UPDATE users SET email_verified = ?, verify_token = NULL WHERE id = ?').run(
        body.email_verified ? 1 : 0,
        id
      );
    }
    if (body.password) {
      if (String(body.password).length < 8) throw bad('Das Passwort braucht 8 Zeichen.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      audit(req.user.id, 'admin-password', { user: id });
    }
    if (body.premium_until !== undefined) {
      const until = body.premium_until ? Number(body.premium_until) : null;
      db.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(until, id);
    }
    if (body.premium_days !== undefined) {
      const days = requireInt(body.premium_days, 'Tage', { min: 0, max: 3650 });
      const base = Math.max(Date.now(), user.premium_until || 0);
      db.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(
        days > 0 ? base + days * 86_400_000 : null,
        id
      );
      audit(req.user.id, 'admin-premium', { user: id, days });
    }
    if (body.proxy_allowance !== undefined) {
      db.prepare('UPDATE users SET proxy_allowance = ? WHERE id = ?').run(
        requireInt(body.proxy_allowance, 'Proxys', { max: 100 }),
        id
      );
    }
    if (body.notes !== undefined) {
      db.prepare('UPDATE users SET notes = ? WHERE id = ?').run(
        String(body.notes || '').slice(0, 4000) || null,
        id
      );
    }
    if (body.language !== undefined) {
      db.prepare('UPDATE users SET language = ? WHERE id = ?').run(body.language === 'de' ? 'de' : 'en', id);
    }
    res.json({ user: userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  })
);

admin.post(
  '/users/:id/logout',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(req.user.id, 'admin-logout', { user: id });
    res.json({ ok: true });
  })
);

admin.post(
  '/users/:id/stop-bots',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    supervisor.stopUser(id, `Von ${req.user.username} gestoppt.`);
    res.json({ ok: true });
  })
);

admin.post(
  '/users/:id/verify-mail',
  wrap(async (req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer gibt es nicht.');
    const result = await auth.resendVerification(user);
    if (result && result.ok === false) throw bad(result.error);
    res.json({ ok: true });
  })
);

/**
 * "Als Nutzer ansehen". Es wird eine zweite Sitzung geöffnet, die weiß, wem sie gehört und wohin
 * es zurückgeht – die eigene Admin-Sitzung bleibt bestehen und wird beim Zurückgehen wieder gesetzt.
 */
admin.post(
  '/users/:id/impersonate',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    if (id === req.user.id) throw bad('Sich selbst ansehen bringt nichts.');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer gibt es nicht.');
    auth.createSession(res, user, req, {
      impersonatorId: req.user.id,
      parentToken: req.sessionToken,
    });
    audit(req.user.id, 'admin-impersonate', { user: id });
    res.json({ ok: true, user: auth.publicUser(user) });
  })
);

// ---------------------------------------------------------------- Tarife

admin.get(
  '/plans',
  wrap((req, res) => {
    res.json({
      plans: billing.plans({ includeInactive: true }).map((plan) => ({
        ...plan,
        in_use: db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE plan_id = ?').get(plan.id).n,
      })),
    });
  })
);

const PLAN_TEXT_FIELDS = ['name_de', 'name_en', 'blurb_de', 'blurb_en', 'features_de', 'features_en', 'discord_role'];
const PLAN_NUMBER_FIELDS = ['price_credits', 'max_accounts', 'chat_limit', 'max_macros', 'sort'];
const PLAN_FLAG_FIELDS = [
  'free_slot',
  'premium',
  'movement',
  'proxy',
  'offline_accounts',
  'fakehost',
  'chat_limit_editable',
  'priority_support',
  'board',
  'menus',
  'pov',
  'addons',
  'highlight',
  'active',
];
const PLAN_FIELDS = [...PLAN_TEXT_FIELDS, ...PLAN_NUMBER_FIELDS, ...PLAN_FLAG_FIELDS];

function planValues(body, existing = {}) {
  const out = {};
  for (const field of PLAN_FIELDS) {
    if (body[field] === undefined) continue;
    if (PLAN_TEXT_FIELDS.includes(field)) {
      // Beschreibungen dürfen länger sein als Namen – auf der Preisseite steht ein ganzer Satz.
      // Die Merkmalsliste ist eine Zeile je Punkt und darf entsprechend lang werden.
      const limit = field.startsWith('features') ? 2000 : field.startsWith('blurb') ? 400 : 200;
      out[field] = String(body[field] ?? '').slice(0, limit);
    } else if (PLAN_NUMBER_FIELDS.includes(field)) {
      out[field] = requireInt(body[field], field, { max: 1_000_000 });
    } else {
      out[field] = body[field] ? 1 : 0;
    }
  }
  if (out.name_de !== undefined && !out.name_de.trim()) throw bad('Der Tarif braucht einen Namen.');
  if (out.max_accounts !== undefined && out.max_accounts < 1) throw bad('Mindestens ein Konto je Server.');
  if (out.discord_role !== undefined) {
    const value = String(out.discord_role).trim();
    if (value && !/^\d{5,25}$/.test(value)) throw bad('Eine Discord-Rollen-ID besteht nur aus Ziffern.');
    out.discord_role = value || null;
  }
  return { ...existing, ...out };
}

admin.post(
  '/plans',
  wrap((req, res) => {
    const body = req.body || {};
    const slug = String(body.slug || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');
    if (!slug) throw bad('Der Tarif braucht ein Kürzel (nur a–z, 0–9 und -).');
    if (db.prepare('SELECT 1 FROM plans WHERE slug = ?').get(slug)) throw bad('Dieses Kürzel gibt es schon.');
    const values = planValues(body, {
      name_de: slug,
      name_en: slug,
      blurb_de: '',
      blurb_en: '',
      features_de: '',
      features_en: '',
      discord_role: null,
      price_credits: 0,
      free_slot: 0,
      max_accounts: 1,
      premium: 0,
      movement: 0,
      proxy: 0,
      offline_accounts: 0,
      fakehost: 0,
      chat_limit: 200,
      chat_limit_editable: 0,
      priority_support: 0,
      board: 0,
      menus: 0,
      pov: 0,
      max_macros: 20,
      addons: 0,
      highlight: 0,
      sort: 50,
      active: 1,
    });
    const info = db
      .prepare(
        `INSERT INTO plans (slug, ${PLAN_FIELDS.join(', ')})
         VALUES (@slug, ${PLAN_FIELDS.map((field) => `@${field}`).join(', ')})`
      )
      .run({ slug, ...values });
    audit(req.user.id, 'plan-create', { slug });
    res.json({ plan: billing.planById(info.lastInsertRowid) });
  })
);

admin.patch(
  '/plans/:id',
  wrap((req, res) => {
    const plan = billing.planById(requireInt(req.params.id, 'Tarif'));
    if (!plan) throw notFound('Diesen Tarif gibt es nicht.');
    const values = planValues(req.body || {});
    const keys = Object.keys(values);
    if (!keys.length) throw bad('Nichts zu ändern.');
    // Es muss immer genau einen kostenlosen Tarif geben, sonst gäbe es keinen Gratis-Platz mehr.
    if (values.free_slot === 1) {
      db.prepare('UPDATE plans SET free_slot = 0 WHERE id != ?').run(plan.id);
    } else if (values.free_slot === 0 && plan.free_slot) {
      const others = db.prepare('SELECT COUNT(*) AS n FROM plans WHERE free_slot = 1 AND id != ?').get(plan.id).n;
      if (!others) throw bad('Ein Tarif muss der kostenlose Platz bleiben.');
    }
    db.prepare(`UPDATE plans SET ${keys.map((key) => `${key} = @${key}`).join(', ')} WHERE id = @id`).run({
      ...values,
      id: plan.id,
    });
    audit(req.user.id, 'plan-update', { slug: plan.slug, ...values });
    res.json({ plan: billing.planById(plan.id) });
  })
);

admin.delete(
  '/plans/:id',
  wrap((req, res) => {
    const plan = billing.planById(requireInt(req.params.id, 'Tarif'));
    if (!plan) throw notFound('Diesen Tarif gibt es nicht.');
    const used = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE plan_id = ?').get(plan.id).n;
    if (used) throw bad(`${used} Serverplatz/-plätze nutzen diesen Tarif. Lieber auf "inaktiv" stellen.`);
    if (plan.free_slot) throw bad('Der kostenlose Tarif lässt sich nicht löschen.');
    db.prepare('DELETE FROM plans WHERE id = ?').run(plan.id);
    audit(req.user.id, 'plan-delete', { slug: plan.slug });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Gutscheine

admin.get(
  '/vouchers',
  wrap((req, res) => {
    res.json({
      vouchers: db
        .prepare(
          `SELECT v.*, u.username AS created_by_name FROM vouchers v
             LEFT JOIN users u ON u.id = v.created_by ORDER BY v.created_at DESC LIMIT 300`
        )
        .all(),
    });
  })
);

admin.post(
  '/vouchers',
  wrap((req, res) => {
    const credits = requireInt(req.body?.credits, 'Guthaben', { min: 1, max: 1_000_000 });
    const uses = requireInt(req.body?.uses ?? 1, 'Einlösungen', { min: 1, max: 1000 });
    const count = requireInt(req.body?.count ?? 1, 'Anzahl', { min: 1, max: 50 });
    const days = requireInt(req.body?.expires_days ?? 0, 'Gültigkeit', { max: 3650 });
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push(
        billing.createVoucher({
          credits,
          uses,
          note: String(req.body?.note || '').slice(0, 200),
          createdBy: req.user.id,
          expiresAt: days > 0 ? Date.now() + days * 86_400_000 : null,
        })
      );
    }
    audit(req.user.id, 'voucher-create', { count, credits });
    res.json({ vouchers: list });
  })
);

admin.delete(
  '/vouchers/:code',
  wrap((req, res) => {
    db.prepare('DELETE FROM vouchers WHERE code = ?').run(String(req.params.code).toUpperCase());
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Aufladungen

admin.get(
  '/topups',
  wrap((req, res) => {
    res.json({
      topups: db
        .prepare(
          `SELECT t.*, u.username, u.email FROM topups t JOIN users u ON u.id = t.user_id
            ORDER BY t.status = 'open' DESC, t.id DESC LIMIT 300`
        )
        .all(),
    });
  })
);

admin.post(
  '/topups/:id/settle',
  wrap((req, res) => {
    const topup = billing.settleTopup(
      requireInt(req.params.id, 'Aufladung'),
      `bestätigt von ${req.user.username}`
    );
    audit(req.user.id, 'topup-settle', { id: topup.id });
    res.json({ topup });
  })
);

admin.post(
  '/topups/:id/cancel',
  wrap((req, res) => {
    billing.cancelTopup(requireInt(req.params.id, 'Aufladung'));
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Proxys
//
// Proxys gehören dem Betreiber und werden Nutzern zugeteilt. Ein Nutzer legt selbst keine an –
// er fragt per Ticket, und hier wird zugewiesen.

admin.get(
  '/proxies',
  wrap((req, res) => {
    res.json({
      proxies: db
        .prepare(
          `SELECT p.*, u.username AS assigned_name,
                  (SELECT COUNT(*) FROM profile_accounts pa WHERE pa.proxy_id = p.id) AS in_use
             FROM proxies p LEFT JOIN users u ON u.id = p.assigned_to ORDER BY p.id`
        )
        .all()
        .map((row) => ({ ...row, password: row.password ? '••••' : '' })),
    });
  })
);

admin.post(
  '/proxies',
  wrap((req, res) => {
    const body = req.body || {};
    const label = requireString(body.label, 'Bezeichnung', { max: 60 });
    const { host, port } = parseAddress(body.address || `${body.host}:${body.port}`);
    if (!port) throw bad('Ein Proxy braucht einen Port.');
    const kind = ['socks5', 'socks4', 'http'].includes(body.kind) ? body.kind : 'socks5';
    const assigned = body.assigned_to ? requireInt(body.assigned_to, 'Nutzer') : null;
    const info = db
      .prepare(
        `INSERT INTO proxies (user_id, assigned_to, pool, label, kind, host, port, username, password, note, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        assigned,
        label,
        kind,
        host,
        port,
        body.username ? String(body.username).slice(0, 100) : null,
        body.password ? String(body.password).slice(0, 200) : null,
        body.note ? String(body.note).slice(0, 200) : null,
        Date.now()
      );
    audit(req.user.id, 'proxy-create', { label, host, port });
    res.json({ id: info.lastInsertRowid });
  })
);

admin.patch(
  '/proxies/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Proxy');
    const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(id);
    if (!proxy) throw notFound('Diesen Proxy gibt es nicht.');
    const body = req.body || {};
    const set = [];
    const values = [];
    if (body.label !== undefined) {
      set.push('label = ?');
      values.push(requireString(body.label, 'Bezeichnung', { max: 60 }));
    }
    if (body.assigned_to !== undefined) {
      const target = body.assigned_to ? requireInt(body.assigned_to, 'Nutzer') : null;
      if (target && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(target)) {
        throw notFound('Diesen Nutzer gibt es nicht.');
      }
      // Wechselt der Besitzer, dürfen die alten Zuordnungen nicht bleiben.
      if (target !== proxy.assigned_to) {
        db.prepare('UPDATE profile_accounts SET proxy_id = NULL WHERE proxy_id = ?').run(id);
      }
      set.push('assigned_to = ?');
      values.push(target);
    }
    if (body.address !== undefined) {
      const { host, port } = parseAddress(body.address);
      set.push('host = ?', 'port = ?');
      values.push(host, port);
    }
    if (body.kind !== undefined) {
      set.push('kind = ?');
      values.push(['socks5', 'socks4', 'http'].includes(body.kind) ? body.kind : 'socks5');
    }
    if (body.username !== undefined) {
      set.push('username = ?');
      values.push(String(body.username || '').slice(0, 100) || null);
    }
    if (body.password !== undefined && body.password !== '••••') {
      set.push('password = ?');
      values.push(String(body.password || '').slice(0, 200) || null);
    }
    if (body.note !== undefined) {
      set.push('note = ?');
      values.push(String(body.note || '').slice(0, 200) || null);
    }
    if (!set.length) throw bad('Nichts zu ändern.');
    values.push(id);
    db.prepare(`UPDATE proxies SET ${set.join(', ')} WHERE id = ?`).run(...values);
    res.json({ ok: true });
  })
);

admin.delete(
  '/proxies/:id',
  wrap((req, res) => {
    db.prepare('DELETE FROM proxies WHERE id = ?').run(requireInt(req.params.id, 'Proxy'));
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Tickets

admin.get(
  '/tickets',
  wrap((req, res) => {
    res.json({
      tickets: tickets.listAll({
        status: req.query.status,
        category: req.query.category,
        search: String(req.query.q || '').trim(),
      }),
      categories: tickets.categoriesFor(langOf(req)),
      statuses: tickets.STATUSES,
      priorities: tickets.PRIORITIES,
    });
  })
);

admin.get(
  '/tickets/:id',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    tickets.markRead(ticket, req.user);
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.user_id);
    res.json({
      ticket: ticketView(ticket),
      messages: tickets.messages(ticket.id, { staff: true }),
      participants: tickets.participants(ticket.id),
      user: owner ? userRow(owner) : null,
      paying: owner ? billing.isPayingUser(owner.id) : false,
      staff: db.prepare("SELECT id, username FROM users WHERE role = 'admin' ORDER BY username").all(),
      me: req.user.id,
    });
  })
);

/** Nachschlag für den Live-Verlauf – dieselbe Form wie beim Kunden. */
admin.get(
  '/tickets/:id/messages',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    const since = Number(req.query.since) || 0;
    tickets.markRead(ticket, req.user);
    const all = tickets.messages(ticket.id, { staff: true });
    res.json({
      ticket: ticketView(ticket),
      messages: since ? all.filter((message) => message.id > since) : all,
    });
  })
);

admin.post(
  '/tickets/:id/reply',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    const internal = Boolean(req.body?.internal);
    const updated = tickets.reply(ticket, req.user, req.body?.body, { internal });
    // Interne Notizen sieht nur das Team – dafür gibt es keine Post an den Kunden.
    if (!internal) tickets.notifyUser(updated, req.body?.body || '');
    res.json({
      ticket: ticketView(updated),
      messages: tickets.messages(ticket.id, { staff: true }),
    });
  })
);

admin.patch(
  '/tickets/:id',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    const body = req.body || {};
    if (body.status !== undefined) {
      const updated = tickets.setStatus(ticket, body.status, req.user.id);
      if (body.status === 'closed') tickets.notifyParticipants(updated, 'ticket_closed', {}, req.user.id);
    }
    if (body.priority !== undefined) {
      if (!tickets.PRIORITIES.includes(body.priority)) throw bad('Unbekannte Dringlichkeit.');
      db.prepare('UPDATE tickets SET priority = ? WHERE id = ?').run(body.priority, ticket.id);
      audit(req.user.id, 'ticket-priority', { id: ticket.id, priority: body.priority }, req.ip);
    }
    if (body.category !== undefined) {
      if (!tickets.CATEGORIES.some((entry) => entry.key === body.category)) throw bad('Unbekannte Kategorie.');
      db.prepare('UPDATE tickets SET category = ? WHERE id = ?').run(body.category, ticket.id);
    }
    if (body.subject !== undefined) {
      db.prepare('UPDATE tickets SET subject = ? WHERE id = ?').run(
        requireString(body.subject, 'Betreff', { max: 120 }),
        ticket.id
      );
    }
    if (body.assigned_to !== undefined) {
      const target = body.assigned_to ? requireInt(body.assigned_to, 'Bearbeiter') : null;
      db.prepare('UPDATE tickets SET assigned_to = ? WHERE id = ?').run(target, ticket.id);
    }
    res.json({ ticket: ticketView(db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id)) });
  })
);

/** Jemanden zu einem Ticket dazuholen – oder wieder herausnehmen. */
admin.post(
  '/tickets/:id/users',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    const userId = requireInt(req.body?.user_id, 'Nutzer');
    const participants = tickets.addUser(ticket, userId, req.user.id);
    const added = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (added) {
      mail.sendTo(added, 'ticket_opened', {
        id: ticket.id,
        subject: ticket.subject,
        by: req.user.username,
      });
    }
    res.json({ participants });
  })
);

admin.delete(
  '/tickets/:id/users/:userId',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    res.json({
      participants: tickets.removeUser(ticket, requireInt(req.params.userId, 'Nutzer'), req.user.id),
    });
  })
);

// ---------------------------------------------------------------- Ankündigungen

admin.get(
  '/announcements',
  wrap((req, res) => {
    res.json({
      announcements: db
        .prepare(
          `SELECT a.*, u.username AS created_by_name FROM announcements a
             LEFT JOIN users u ON u.id = a.created_by ORDER BY a.id DESC LIMIT 50`
        )
        .all()
        .map((row) => ({ ...row, active: Boolean(row.active) })),
      recipients: db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE blocked = 0 AND email_verified = 1")
        .get().n,
      mail_ready: mail.configured(),
    });
  })
);

admin.post(
  '/announcements',
  wrap((req, res) => {
    const body = req.body || {};
    const titleDe = requireString(body.title_de, 'Titel (DE)', { max: 120 });
    const titleEn = requireString(body.title_en || body.title_de, 'Titel (EN)', { max: 120 });
    const info = db
      .prepare(
        `INSERT INTO announcements (title_de, title_en, body_de, body_en, kind, link, active, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        titleDe,
        titleEn,
        String(body.body_de || '').slice(0, 4000),
        String(body.body_en || body.body_de || '').slice(0, 4000),
        ['info', 'warn', 'bad'].includes(body.kind) ? body.kind : 'info',
        String(body.link || '').slice(0, 300) || null,
        body.active === false ? 0 : 1,
        Date.now(),
        req.user.id
      );
    // Mehrere dürfen gleichzeitig sichtbar sein: Wartungsarbeiten und eine neue Funktion sind
    // zwei Nachrichten, und die zweite soll die erste nicht abschalten.
    audit(req.user.id, 'announcement-create', { id: info.lastInsertRowid, title: titleDe }, req.ip);
    res.json({ id: info.lastInsertRowid });
  })
);

admin.patch(
  '/announcements/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Ankündigung');
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    if (!row) throw notFound('Diese Ankündigung gibt es nicht.');
    const body = req.body || {};
    const set = [];
    const values = [];
    const put = (column, value) => {
      set.push(`${column} = ?`);
      values.push(value);
    };
    if (body.title_de !== undefined) put('title_de', requireString(body.title_de, 'Titel (DE)', { max: 120 }));
    if (body.title_en !== undefined) put('title_en', requireString(body.title_en, 'Titel (EN)', { max: 120 }));
    if (body.body_de !== undefined) put('body_de', String(body.body_de || '').slice(0, 4000));
    if (body.body_en !== undefined) put('body_en', String(body.body_en || '').slice(0, 4000));
    if (body.kind !== undefined) put('kind', ['info', 'warn', 'bad'].includes(body.kind) ? body.kind : 'info');
    if (body.link !== undefined) put('link', String(body.link || '').slice(0, 300) || null);
    if (body.active !== undefined) put('active', body.active ? 1 : 0);
    if (!set.length) throw bad('Nichts zu ändern.');
    values.push(id);
    db.prepare(`UPDATE announcements SET ${set.join(', ')} WHERE id = ?`).run(...values);
    res.json({ ok: true });
  })
);

/**
 * Eine Ankündigung als E-Mail verschicken.
 *
 * Jeder bekommt sie in seiner Sprache, und nur, wer Ankündigungen bestellt hat. Verschickt wird
 * in Ruhe – ein Mailserver, der auf einen Schlag hundert Nachrichten bekommt, hält uns sonst für
 * einen Absender, den man besser sperrt.
 */
admin.post(
  '/announcements/:id/mail',
  wrap(async (req, res) => {
    if (!mail.configured()) throw bad('Es ist kein SMTP-Server hinterlegt.');
    const id = requireInt(req.params.id, 'Ankündigung');
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    if (!row) throw notFound('Diese Ankündigung gibt es nicht.');
    if (row.mailed_at && !req.body?.again) {
      throw bad('Diese Ankündigung wurde schon verschickt. Mit "noch einmal" geht es trotzdem.');
    }

    const test = Boolean(req.body?.test);
    const recipients = test
      ? [db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)]
      : db.prepare('SELECT * FROM users WHERE blocked = 0 AND email_verified = 1').all();

    let sent = 0;
    let skipped = 0;
    for (const user of recipients) {
      const result = await mail.sendTo(
        user,
        'announcement',
        {
          title: user.language === 'en' ? row.title_en : row.title_de,
          body: (user.language === 'en' ? row.body_en : row.body_de) || '',
          link: row.link || '',
        },
        { force: test }
      );
      if (result.ok) sent += 1;
      else skipped += 1;
      // Ein kurzer Abstand hält den Versand unauffällig, ohne dass es spürbar dauert.
      if (!test) await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (!test) db.prepare('UPDATE announcements SET mailed_at = ? WHERE id = ?').run(Date.now(), id);
    audit(req.user.id, 'announcement-mail', { id, sent, skipped, test }, req.ip);
    res.json({ sent, skipped, test });
  })
);

admin.delete(
  '/announcements/:id',
  wrap((req, res) => {
    db.prepare('DELETE FROM announcements WHERE id = ?').run(requireInt(req.params.id, 'Ankündigung'));
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Einstellungen

admin.get(
  '/settings',
  wrap((req, res) =>
    res.json({
      settings: safeSettings(),
      defaults: settingDefaults,
      schema: schemaFor(langOf(req)),
      mail_categories: mail.categoriesFor(langOf(req)),
      oauth: oauth.state(),
      bot: botState(),
    })
  )
);

admin.patch(
  '/settings',
  wrap((req, res) => {
    const changed = [];
    for (const [key, value] of Object.entries(req.body || {})) {
      const entry = settingSchema[key];
      // Nur, was in der Beschreibung steht. Ein unbekannter Schlüssel ist ein Tippfehler oder ein
      // Versuch – beides gehört nicht in die Tabelle.
      if (!entry) continue;

      if (entry.type === 'packages') {
        if (!Array.isArray(value)) {
          throw bad('Pakete müssen eine Liste sein.', { en: 'Packages have to be a list.' });
        }
        setSetting(
          key,
          value.map((pack) => ({
            cent: requireInt(pack.cent, 'Betrag', { min: 100, max: 1_000_000 }),
            credits: requireInt(pack.credits, 'Credits', { min: 1, max: 1_000_000 }),
            label: String(pack.label || `${(pack.cent / 100).toFixed(2)} €`).slice(0, 40),
          }))
        );
      } else if (entry.type === 'number' || entry.type === 'switch') {
        const limits = entry.type === 'switch' ? { min: 0, max: 1 } : { min: entry.min ?? 0, max: entry.max ?? 10_000_000 };
        setSetting(key, requireInt(entry.type === 'switch' ? (value ? 1 : 0) : value, entry.de.label, limits));
      } else if (entry.secret) {
        // Leer heißt "nicht angefasst": das Formular kennt den Wert nicht und kann ihn deshalb
        // auch nicht zurückschicken. Löschen geht über den eigenen Knopf (DELETE unten).
        const text = String(value || '').trim();
        if (!text) continue;
        setSetting(key, text.slice(0, 500));
      } else {
        setSetting(key, String(value ?? '').slice(0, entry.type === 'textarea' ? 20_000 : 500));
      }
      changed.push(key);
    }
    audit(req.user.id, 'admin-settings', { keys: changed }, req.ip);
    res.json({ settings: safeSettings() });
  })
);

/** Ein Geheimnis löschen. Ohne diesen Weg ließe sich ein einmal gesetztes nie wieder entfernen. */
admin.delete(
  '/settings/:key',
  wrap((req, res) => {
    const entry = settingSchema[req.params.key];
    if (!entry?.secret) throw notFound('Dieses Feld gibt es nicht.');
    setSetting(entry.key, '');
    audit(req.user.id, 'admin-settings-clear', { key: entry.key }, req.ip);
    res.json({ settings: safeSettings() });
  })
);

admin.post(
  '/settings/mail-test',
  wrap(async (req, res) => {
    await mail.verifyConnection();
    const to = String(req.body?.to || req.user.email);
    const result = await mail.send({
      to,
      subject: `${config.brand}: Testnachricht`,
      text: 'Wenn du das liest, ist der Versand richtig eingerichtet.',
      kind: 'test',
    });
    if (!result.ok) throw bad(result.error);
    res.json({ ok: true, to });
  })
);

admin.get(
  '/mails',
  wrap((req, res) => {
    const status = String(req.query.status || 'all');
    const search = String(req.query.q || '').trim();
    const where = [];
    const values = [];
    if (status === 'failed' || status === 'sent') {
      where.push('m.status = ?');
      values.push(status);
    }
    if (search) {
      where.push('(m.recipient LIKE ? OR m.subject LIKE ? OR u.username LIKE ?)');
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    res.json({
      mails: db
        .prepare(
          `SELECT m.*, u.username FROM mails m LEFT JOIN users u ON u.id = m.user_id
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY m.id DESC LIMIT 200`
        )
        .all(...values),
      failed: db.prepare("SELECT COUNT(*) AS n FROM mails WHERE status = 'failed'").get().n,
      configured: mail.configured(),
    });
  })
);

/** Eine verschickte Nachricht im Wortlaut – zum Nachlesen, was ein Kunde bekommen hat. */
admin.get(
  '/mails/:id',
  wrap((req, res) => {
    const row = db.prepare('SELECT * FROM mails WHERE id = ?').get(requireInt(req.params.id, 'Nachricht'));
    if (!row) throw notFound('Diese Nachricht gibt es nicht.');
    res.json({ mail: row });
  })
);

// ---------------------------------------------------------------- Client und Bots

admin.get('/client', wrap((req, res) => res.json({ client: clientState() })));

admin.post(
  '/client/sync',
  wrap(async (req, res) => {
    await binaries.sync({ force: Boolean(req.body?.force) });
    audit(req.user.id, 'client-sync', { tag: binaries.state.tag });
    res.json({ client: clientState() });
  })
);

admin.get(
  '/bots',
  wrap((req, res) => {
    const rows = [...supervisor.bots.values()].map((bot) => ({
      ...bot.snapshot(),
      user_id: bot.userId,
      username: db.prepare('SELECT username FROM users WHERE id = ?').get(bot.userId)?.username,
      profile: bot.profile.name,
      host: bot.profile.host,
      version: bot.profile.mc_version,
      plan: bot.plan?.slug,
    }));
    res.json({ bots: rows });
  })
);

admin.post(
  '/bots/:profileId/:accountId/stop',
  wrap((req, res) => {
    supervisor.stop(requireInt(req.params.profileId, 'Server'), requireInt(req.params.accountId, 'Konto'));
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Serverplätze

admin.get(
  '/profiles',
  wrap((req, res) => {
    const lang = langOf(req);
    res.json({
      profiles: db
        .prepare(
          `SELECT p.*, u.username, pl.name_de, pl.name_en, pl.price_credits, pl.free_slot
             FROM profiles p JOIN users u ON u.id = p.user_id LEFT JOIN plans pl ON pl.id = p.plan_id
            ORDER BY p.id DESC LIMIT 500`
        )
        .all()
        .map((row) => ({
          id: row.id,
          user_id: row.user_id,
          username: row.username,
          name: row.name,
          address: row.port ? `${row.host}:${row.port}` : row.host,
          mc_version: row.mc_version,
          plan: lang === 'de' ? row.name_de : row.name_en,
          price_credits: row.price_credits,
          free_slot: Boolean(row.free_slot),
          paid_until: row.paid_until,
          suspended: Boolean(row.suspended),
          online: supervisor.runningOnProfile(row.id),
        })),
    });
  })
);

admin.patch(
  '/profiles/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!profile) throw notFound('Diesen Server gibt es nicht.');
    const body = req.body || {};
    if (body.extend_days !== undefined) {
      const days = requireInt(body.extend_days, 'Tage', { min: 1, max: 3650 });
      const base = Math.max(Date.now(), profile.paid_until || 0);
      db.prepare('UPDATE profiles SET paid_until = ?, suspended = 0 WHERE id = ?').run(
        base + days * 86_400_000,
        id
      );
      audit(req.user.id, 'admin-extend', { profile: id, days });
    }
    if (body.suspended !== undefined) {
      db.prepare('UPDATE profiles SET suspended = ? WHERE id = ?').run(body.suspended ? 1 : 0, id);
      if (body.suspended) supervisor.stopProfile(id, 'Von der Verwaltung stillgelegt.');
    }
    if (body.plan_id !== undefined) {
      const plan = billing.planById(requireInt(body.plan_id, 'Tarif'));
      if (!plan) throw notFound('Diesen Tarif gibt es nicht.');
      // Vom Admin gesetzt heißt: ohne Abbuchung, dafür mit klarer Laufzeit.
      db.prepare('UPDATE profiles SET plan_id = ?, suspended = 0, paid_until = ? WHERE id = ?').run(
        plan.id,
        plan.free_slot ? null : Math.max(Date.now(), profile.paid_until || 0) + billing.MONTH_MS,
        id
      );
      audit(req.user.id, 'admin-plan', { profile: id, plan: plan.slug });
    }
    res.json({ ok: true });
  })
);

admin.delete(
  '/profiles/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    supervisor.stopProfile(id, 'Von der Verwaltung gelöscht.', { keepWanted: false });
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    audit(req.user.id, 'admin-profile-delete', { profile: id });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Protokoll

/**
 * Das Protokoll.
 *
 * `detail` steht in der Datenbank als JSON – eine Zeile wie
 * {"slug":"premium","name_de":"Premium",…} ist zwar vollständig, aber nichts, was jemand liest.
 * Deshalb kommt sie hier **zerlegt** heraus: Feld für Feld, mit Beschriftung, und für alles, was
 * auf einen Datensatz zeigt (Nutzer, Serverplatz, Tarif, Ticket), gleich die Adresse dazu. Was
 * das Panel daraus macht, ist eine Tabelle zum Aufklappen statt einer Textwurst.
 */
const DETAIL_LABELS = {
  de: {
    slug: 'Kürzel', name_de: 'Name (DE)', name_en: 'Name (EN)', blurb_de: 'Text (DE)',
    blurb_en: 'Text (EN)', price_credits: 'Preis', free_slot: 'Gratis-Platz', max_accounts: 'Bots',
    premium: 'Premium-Client', movement: 'Bewegung', proxy: 'Proxys', offline_accounts: 'Offline-Konten',
    fakehost: 'Fake-Host', chat_limit: 'Chatverlauf', chat_limit_editable: 'Chatverlauf änderbar',
    priority_support: 'Support mit Vorrang', board: 'Anzeigetafel', menus: 'Menüs', pov: 'Live-Ansicht',
    max_macros: 'Macros', addons: 'Zusätze buchbar', highlight: 'Hervorgehoben', sort: 'Reihenfolge',
    active: 'Aktiv', user: 'Nutzer', profile: 'Serverplatz', plan: 'Tarif', ticket: 'Ticket',
    node: 'Standort', addon: 'Zusatz', credits: 'Credits', delta: 'Änderung', days: 'Tage',
    price: 'Preis', qty: 'Menge', refund: 'Gutschrift', status: 'Zustand', keys: 'Felder',
    key: 'Feld', count: 'Anzahl', id: 'Nummer', code: 'Code', name: 'Name', host: 'Host',
    port: 'Port', label: 'Bezeichnung', role: 'Rolle', via: 'Über', source: 'Herkunft',
    owner: 'Gehört', access: 'Zugang', external: 'Fremdkonto', tag: 'Release', category: 'Kategorie',
    title: 'Titel', discord_role: 'Discord-Rolle', subject: 'Betreff', reason: 'Grund',
    text: 'Text', locked: 'Gesperrt', sent: 'Verschickt', skipped: 'Übersprungen', test: 'Testlauf',
    provider: 'Anbieter', to: 'An', new: 'Neu', priority: 'Dringlichkeit', note: 'Notiz',
    proxy_id: 'Proxy', max_bots: 'Bots höchstens', max_profiles: 'Server höchstens', region: 'Region',
  },
  en: {
    slug: 'Slug', name_de: 'Name (DE)', name_en: 'Name (EN)', blurb_de: 'Text (DE)',
    blurb_en: 'Text (EN)', price_credits: 'Price', free_slot: 'Free slot', max_accounts: 'Bots',
    premium: 'Premium client', movement: 'Movement', proxy: 'Proxies', offline_accounts: 'Offline accounts',
    fakehost: 'Fake host', chat_limit: 'Chat history', chat_limit_editable: 'Chat history editable',
    priority_support: 'Priority support', board: 'Scoreboard', menus: 'Menus', pov: 'Live view',
    max_macros: 'Macros', addons: 'Extras bookable', highlight: 'Highlighted', sort: 'Order',
    active: 'Active', user: 'User', profile: 'Server slot', plan: 'Plan', ticket: 'Ticket',
    node: 'Location', addon: 'Extra', credits: 'Credits', delta: 'Change', days: 'Days',
    price: 'Price', qty: 'Quantity', refund: 'Refund', status: 'Status', keys: 'Fields',
    key: 'Field', count: 'Count', id: 'Number', code: 'Code', name: 'Name', host: 'Host',
    port: 'Port', label: 'Label', role: 'Role', via: 'Via', source: 'Source',
    owner: 'Owner', access: 'Access', external: 'External account', tag: 'Release', category: 'Category',
    title: 'Title', discord_role: 'Discord role', subject: 'Subject', reason: 'Reason',
    text: 'Text', locked: 'Locked', sent: 'Sent', skipped: 'Skipped', test: 'Test run',
    provider: 'Provider', to: 'To', new: 'New', priority: 'Priority', note: 'Note',
    proxy_id: 'Proxy', max_bots: 'Max bots', max_profiles: 'Max servers', region: 'Region',
  },
};

/** Auf welche Ansicht ein Feld zeigt. */
const DETAIL_LINKS = {
  user: (value) => `#/admin/users/${value}`,
  owner: (value) => `#/admin/users/${value}`,
  profile: (value) => `#/admin/servers/${value}`,
  ticket: (value) => `#/tickets/${value}`,
};

/** Flags, die als Ja/Nein gemeint sind und nicht als Zahl. */
const DETAIL_FLAGS = new Set([
  'free_slot', 'premium', 'movement', 'proxy', 'offline_accounts', 'fakehost',
  'chat_limit_editable', 'priority_support', 'board', 'menus', 'pov', 'addons',
  'highlight', 'active',
]);

function explainDetail(raw, lang = 'de') {
  if (!raw) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { text: String(raw), fields: [] };
  }
  if (value === null || typeof value !== 'object') return { text: String(value), fields: [] };
  const labels = DETAIL_LABELS[lang === 'en' ? 'en' : 'de'];
  const fields = Object.entries(value)
    .filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')
    .map(([key, entry]) => ({
      key,
      label: labels[key] || key,
      value: Array.isArray(entry) ? entry.join(', ') : typeof entry === 'object' ? JSON.stringify(entry) : String(entry),
      flag: DETAIL_FLAGS.has(key) ? Boolean(Number(entry)) : null,
      link: DETAIL_LINKS[key] && /^\d+$/.test(String(entry)) ? DETAIL_LINKS[key](entry) : null,
    }));
  return { text: '', fields };
}

/** Kurze Zusammenfassung für die Zeile selbst – damit man nicht jede aufklappen muss. */
function summarize(entry, lang = 'de') {
  const detail = entry.detail_parsed;
  if (!detail) return '';
  if (detail.text) return detail.text.slice(0, 120);
  const first = detail.fields.slice(0, 3).map((field) => `${field.label}: ${field.value}`);
  const rest = detail.fields.length - first.length;
  return first.join(' · ') + (rest > 0 ? ` · +${rest}` : '');
}

admin.get(
  '/audit',
  wrap((req, res) => {
    const lang = langOf(req);
    const action = String(req.query.action || '').trim();
    const search = String(req.query.q || '').trim();
    const userId = req.query.user ? Number(req.query.user) : null;
    const where = [];
    const values = [];
    if (action) {
      where.push('a.action = ?');
      values.push(action);
    }
    if (userId) {
      where.push('a.user_id = ?');
      values.push(userId);
    }
    if (search) {
      where.push('(a.detail LIKE ? OR u.username LIKE ? OR a.action LIKE ?)');
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const entries = db
      .prepare(
        `SELECT a.*, u.username FROM audit a LEFT JOIN users u ON u.id = a.user_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY a.id DESC LIMIT 300`
      )
      .all(...values)
      .map((row) => {
        const parsed = explainDetail(row.detail, lang);
        const out = { ...row, detail_parsed: parsed };
        return { ...out, summary: summarize(out, lang) };
      });

    res.json({
      entries,
      actions: db
        .prepare('SELECT action, COUNT(*) AS n FROM audit GROUP BY action ORDER BY action')
        .all(),
    });
  })
);

admin.get(
  '/ledger',
  wrap((req, res) => {
    res.json({
      entries: db
        .prepare(
          `SELECT l.*, u.username FROM ledger l JOIN users u ON u.id = l.user_id
            ORDER BY l.id DESC LIMIT 300`
        )
        .all(),
      total: formatCredits(db.prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM users').get().n),
    });
  })
);

// ---------------------------------------------------------------- Standorte
//
// Wie ein Standort angelegt wird und was dazugehört, steht Schritt für Schritt in
// docs/standorte.md – hier stehen nur die Endpunkte.

admin.get(
  '/nodes',
  wrap((req, res) => {
    res.json({
      nodes: nodes.list({ includeInactive: true }).map(nodes.adminView),
      proxies: db
        .prepare('SELECT id, label, kind, host, port FROM proxies ORDER BY label COLLATE NOCASE')
        .all(),
      access: nodes.ACCESS,
    });
  })
);

admin.post(
  '/nodes',
  wrap((req, res) => res.json({ node: nodes.adminView(nodes.create(req.body || {}, req.user.id)) }))
);

admin.patch(
  '/nodes/:id',
  wrap((req, res) =>
    res.json({
      node: nodes.adminView(nodes.update(requireInt(req.params.id, 'Standort'), req.body || {}, req.user.id)),
    })
  )
);

admin.delete(
  '/nodes/:id',
  wrap((req, res) => {
    nodes.remove(requireInt(req.params.id, 'Standort'), req.user.id);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Zusätze

admin.get(
  '/addons',
  wrap((req, res) => {
    res.json({
      addons: billing.addons({ includeInactive: true }).map((addon) => ({
        ...addon,
        in_use: db.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM profile_addons WHERE addon_id = ?').get(addon.id).n,
      })),
      caps: binaries.anyCaps(),
    });
  })
);

const ADDON_TEXTS = ['key', 'name_de', 'name_en', 'text_de', 'text_en', 'flag', 'need_cap'];
const ADDON_NUMBERS = ['price_credits', 'amount', 'max_qty', 'sort'];
const ADDON_FLAGS = ['available', 'active'];

function addonValues(body, existing = {}) {
  const out = {};
  for (const field of [...ADDON_TEXTS, ...ADDON_NUMBERS, ...ADDON_FLAGS]) {
    if (body[field] === undefined) continue;
    if (ADDON_TEXTS.includes(field)) out[field] = String(body[field] ?? '').slice(0, 400) || null;
    else if (ADDON_NUMBERS.includes(field)) out[field] = requireInt(body[field], field, { max: 1_000_000 });
    else out[field] = body[field] ? 1 : 0;
  }
  if (body.kind !== undefined) {
    if (!['flag', 'slot'].includes(body.kind)) throw bad('Ein Zusatz ist entweder "flag" oder "slot".');
    out.kind = body.kind;
  }
  if (out.key !== undefined) {
    out.key = String(out.key).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!out.key) throw bad('Der Zusatz braucht ein Kürzel (nur a–z, 0–9 und -).');
  }
  if (out.name_de !== undefined && !String(out.name_de).trim()) throw bad('Der Zusatz braucht einen Namen.');
  return { ...existing, ...out };
}

const ADDON_COLUMNS = [...ADDON_TEXTS, ...ADDON_NUMBERS, ...ADDON_FLAGS, 'kind'];

admin.post(
  '/addons',
  wrap((req, res) => {
    const values = addonValues(req.body || {}, {
      key: '',
      name_de: '',
      name_en: '',
      text_de: '',
      text_en: '',
      price_credits: 0,
      kind: 'flag',
      flag: null,
      amount: 1,
      max_qty: 1,
      need_cap: null,
      available: 1,
      active: 1,
      sort: 50,
    });
    if (db.prepare('SELECT 1 FROM addons WHERE key = ?').get(values.key)) {
      throw bad('Dieses Kürzel gibt es schon.');
    }
    const info = db
      .prepare(
        `INSERT INTO addons (${ADDON_COLUMNS.join(', ')})
         VALUES (${ADDON_COLUMNS.map((column) => `@${column}`).join(', ')})`
      )
      .run(values);
    audit(req.user.id, 'addon-create', { key: values.key }, req.ip);
    res.json({ addon: billing.addonById(info.lastInsertRowid) });
  })
);

admin.patch(
  '/addons/:id',
  wrap((req, res) => {
    const addon = billing.addonById(requireInt(req.params.id, 'Zusatz'));
    if (!addon) throw notFound('Diesen Zusatz gibt es nicht.');
    const values = addonValues(req.body || {});
    const keys = Object.keys(values);
    if (!keys.length) throw bad('Nichts zu ändern.');
    db.prepare(`UPDATE addons SET ${keys.map((key) => `${key} = @${key}`).join(', ')} WHERE id = @id`).run({
      ...values,
      id: addon.id,
    });
    audit(req.user.id, 'addon-update', { key: addon.key, ...values }, req.ip);
    res.json({ addon: billing.addonById(addon.id) });
  })
);

admin.delete(
  '/addons/:id',
  wrap((req, res) => {
    const addon = billing.addonById(requireInt(req.params.id, 'Zusatz'));
    if (!addon) throw notFound('Diesen Zusatz gibt es nicht.');
    const used = db.prepare('SELECT COUNT(*) AS n FROM profile_addons WHERE addon_id = ?').get(addon.id).n;
    if (used) throw bad(`${used} Serverplätze haben diesen Zusatz gebucht. Lieber auf "nicht buchbar" stellen.`);
    db.prepare('DELETE FROM addons WHERE id = ?').run(addon.id);
    audit(req.user.id, 'addon-delete', { key: addon.key }, req.ip);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Ein Serverplatz
//
// Der Betreiber sieht hier dasselbe wie der Kunde – Konten, Zustand, Chat, Anzeigetafel – und
// dazu, was den Kunden nichts angeht: welchem Konto der Platz gehört, was er verbraucht, auf
// welchem Standort er liegt, und die Knöpfe zum Sperren.

admin.get(
  '/servers/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!profile) throw notFound('Diesen Server gibt es nicht.');
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(profile.user_id);
    const lang = langOf(req);
    const features = billing.featuresOf(profile);
    const build = binaries.buildFor(profile, features);
    const usage = metrics.byProfile().get(profile.id) || { bots: 0, rss: 0, cpu_percent: 0 };

    const accounts = db
      .prepare(
        `SELECT pa.account_id, pa.note, pa.proxy_id, pa.wanted, a.name, a.uuid, a.kind, a.status,
                a.last_error, b.state, b.connections, b.uptime_sec
           FROM profile_accounts pa JOIN mc_accounts a ON a.id = pa.account_id
      LEFT JOIN bots b ON b.profile_id = pa.profile_id AND b.account_id = pa.account_id
          WHERE pa.profile_id = ? ORDER BY a.name COLLATE NOCASE`
      )
      .all(profile.id)
      .map((row) => {
        const live = supervisor.get(profile.id, row.account_id);
        return {
          ...row,
          wanted: Boolean(row.wanted),
          state: live ? live.state : 'offline',
          detail: live ? live.detail : '',
          online: live ? live.online : false,
          since: live ? live.since : null,
          pid: live?.proc?.pid || null,
          views: live ? live.views : null,
          head: `https://minotar.net/helm/${encodeURIComponent(row.uuid || row.name)}/64.png`,
        };
      });

    res.json({
      profile: {
        ...profile,
        address: profile.port ? `${profile.host}:${profile.port}` : profile.host,
        suspended: Boolean(profile.suspended),
        locked: Boolean(profile.locked),
        renew: Boolean(profile.renew),
        auto_reconnect: Boolean(profile.auto_reconnect),
        movement: Boolean(profile.movement),
        sneak: Boolean(profile.sneak),
        active: billing.isActive(profile),
        days_left: profile.paid_until
          ? Math.max(0, Math.ceil((profile.paid_until - Date.now()) / 86_400_000))
          : null,
        build,
        caps: build ? billing.gateCaps(binaries.caps(build), features) : {},
      },
      owner: owner ? userRow(owner) : null,
      plan: planView(billing.planOf(profile), lang),
      plans: billing.plans({ includeInactive: true }).map((plan) => planView(plan, lang)),
      features,
      addons: billing.addonsOf(profile.id),
      all_addons: billing.addons({ includeInactive: true }),
      monthly_credits: billing.monthlyPrice(profile),
      node: profile.node_id ? nodes.adminView(nodes.byId(profile.node_id)) : null,
      nodes: nodes.list({ includeInactive: true }).map((node) => ({ id: node.id, name: node.name })),
      accounts,
      macros: db.prepare('SELECT COUNT(*) AS n FROM macros WHERE profile_id = ?').get(profile.id).n,
      spam: db.prepare('SELECT COUNT(*) AS n FROM spam WHERE profile_id = ?').get(profile.id).n,
      usage: { ...usage, disk: metrics.diskOfProfile(profile.id) },
    });
  })
);

/** Chatverlauf eines Serverplatzes – dieselbe Sicht, die auch der Kunde hat. */
admin.get(
  '/servers/:id/chat',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const since = Number(req.query.since) || 0;
    const lines = [];
    for (const row of db.prepare('SELECT account_id FROM profile_accounts WHERE profile_id = ?').all(id)) {
      const account = db.prepare('SELECT name FROM mc_accounts WHERE id = ?').get(row.account_id);
      for (const entry of supervisor.historyOf(id, row.account_id, since)) {
        lines.push({ ...entry, account_id: row.account_id, account: account?.name });
      }
    }
    res.json({ lines: mergeLines(lines).slice(-2000), now: Date.now() });
  })
);

/**
 * Etwas an einen Bot schicken – Chat, Serverbefehl oder ein örtlicher Befehl wie `:board`.
 *
 * Das ist der Grund, warum ein Administrator hier mehr kann als der Kunde: Wenn jemand meldet,
 * dass ein Bot nicht mehr mitkommt, hilft es, selbst hineinzuschreiben, statt danach zu fragen.
 * Jede solche Zeile steht im Protokoll, mit Serverplatz und Text.
 */
admin.post(
  '/servers/:id/send',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const text = requireString(req.body?.text, 'Nachricht', { max: 256 });
    const only = Array.isArray(req.body?.accounts) ? req.body.accounts.map(Number) : null;
    const results = [];
    for (const row of db.prepare('SELECT account_id FROM profile_accounts WHERE profile_id = ?').all(id)) {
      if (only?.length && !only.includes(row.account_id)) continue;
      const bot = supervisor.get(id, row.account_id);
      try {
        if (!bot?.running) throw new Error('Der Bot läuft gerade nicht.');
        // Örtliche Befehle laufen über `local`, damit Abfragen wie `:board` als Ansicht ankommen.
        if (text.startsWith(':')) {
          const [verb, ...rest] = text.slice(1).split(' ');
          bot.local(verb.toLowerCase(), rest.join(' '), 'events');
        } else {
          bot.send(text);
        }
        results.push({ account_id: row.account_id, ok: true });
      } catch (error) {
        results.push({ account_id: row.account_id, ok: false, error: error.message });
      }
    }
    audit(req.user.id, 'admin-server-send', { profile: id, text }, req.ip);
    res.json({ results });
  })
);

admin.post(
  '/servers/:id/:action(start|stop|restart)',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const action = req.params.action;
    const rows = db.prepare('SELECT account_id FROM profile_accounts WHERE profile_id = ?').all(id);
    if (action === 'stop') {
      supervisor.stopProfile(id, `Von ${req.user.username} gestoppt.`, { keepWanted: false });
    } else {
      for (const row of rows) {
        if (action === 'restart') supervisor.stop(id, row.account_id, { keepWanted: true });
        const context = supervisor.context(id, row.account_id);
        if (!context) continue;
        setTimeout(
          () => {
            try {
              supervisor.start(context);
            } catch {
              /* der Zustand des Bots sagt, warum */
            }
          },
          action === 'restart' ? 1500 : 0
        ).unref();
      }
    }
    audit(req.user.id, `admin-server-${action}`, { profile: id }, req.ip);
    res.json({ ok: true });
  })
);

/**
 * Einen Serverplatz sperren.
 *
 * Gesperrt heißt: Bots aus, nichts lässt sich mehr ändern, gelöscht wird nichts. Das ist der
 * Knopf für den Fall, dass ein Platz Ärger macht – zwischen "nichts tun" und "Konto sperren"
 * lag vorher nichts.
 */
admin.post(
  '/servers/:id/lock',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!profile) throw notFound('Diesen Server gibt es nicht.');
    const locked = req.body?.locked !== false;
    const reason = String(req.body?.reason || '').slice(0, 200) || null;
    db.prepare('UPDATE profiles SET locked = ?, lock_reason = ? WHERE id = ?').run(
      locked ? 1 : 0,
      locked ? reason : null,
      id
    );
    if (locked) supervisor.stopProfile(id, `Gesperrt${reason ? `: ${reason}` : '.'}`, { keepWanted: false });
    audit(req.user.id, locked ? 'admin-server-lock' : 'admin-server-unlock', { profile: id, reason }, req.ip);
    res.json({ ok: true, locked, reason });
  })
);

/** Einen Serverplatz auf einen anderen Standort schieben. */
admin.post(
  '/servers/:id/node',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const node = nodes.move(id, requireInt(req.body?.node_id, 'Standort'), req.user.id);
    res.json({ ok: true, node: nodes.view(node) });
  })
);

/** Einen Zusatz von Hand auf einen Serverplatz legen oder wieder abnehmen – ohne Abbuchung. */
admin.post(
  '/servers/:id/addons',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const addon = billing.addonById(requireInt(req.body?.addon_id, 'Zusatz'));
    if (!addon) throw notFound('Diesen Zusatz gibt es nicht.');
    const qty = requireInt(req.body?.qty ?? 1, 'Menge', { min: 0, max: addon.max_qty });
    if (qty > 0) {
      db.prepare(
        `INSERT INTO profile_addons (profile_id, addon_id, qty, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(profile_id, addon_id) DO UPDATE SET qty = ?`
      ).run(id, addon.id, qty, Date.now(), qty);
    } else {
      db.prepare('DELETE FROM profile_addons WHERE profile_id = ? AND addon_id = ?').run(id, addon.id);
    }
    audit(req.user.id, 'admin-server-addon', { profile: id, addon: addon.key, qty }, req.ip);
    res.json({ ok: true, addons: billing.addonsOf(id) });
  })
);

// ---------------------------------------------------------------- Post an Kunden

/**
 * Eine Nachricht an genau einen Kunden.
 *
 * Sie geht denselben Weg wie jede andere: dieselbe Vorlage, dasselbe Protokoll, und der Empfänger
 * findet sie in seinen Einstellungen wieder. Ein Postfach, aus dem heraus sich nichts nachweisen
 * lässt, wäre für den Kunden wertlos.
 */
admin.post(
  '/users/:id/mail',
  wrap(async (req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer gibt es nicht.');
    const subject = requireString(req.body?.subject, 'Betreff', { max: 160 });
    const body = requireString(req.body?.body, 'Nachricht', { max: 8000 });
    const category = ['announcement', 'security', 'billing', 'server', 'ticket'].includes(req.body?.category)
      ? req.body.category
      : 'announcement';
    const result = await mail.sendTo(
      user,
      'direct',
      { subject, body, category },
      { force: Boolean(req.body?.force) }
    );
    if (!result.ok) {
      throw bad(
        result.skipped
          ? 'Dieser Kunde hat Nachrichten dieser Sorte abbestellt. Mit "trotzdem senden" geht es.'
          : `E-Mail ließ sich nicht verschicken: ${result.error}`
      );
    }
    audit(req.user.id, 'admin-mail', { user: id, subject }, req.ip);
    res.json({ ok: true });
  })
);

/** Ein Ticket für einen Kunden aufmachen – etwa nach einem Gespräch außerhalb des Panels. */
admin.post(
  '/users/:id/ticket',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!owner) throw notFound('Benutzer gibt es nicht.');
    const ticket = tickets.create(owner, req.body || {}, {
      by: req.user.id,
      source: 'staff',
      staffPriority: true,
    });
    tickets.notifyParticipants(ticket, 'ticket_opened', { by: req.user.username }, null);
    bridge.emit('ticket.created', { ticket_id: ticket.id, source: 'staff', user_id: owner.id });
    audit(req.user.id, 'admin-ticket-create', { ticket: ticket.id, owner: id }, req.ip);
    res.json({ ticket: ticketView(ticket) });
  })
);
