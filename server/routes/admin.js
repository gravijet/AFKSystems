// Der Admin-Bereich. Alles, was der Betreiber im Alltag braucht, ohne je an die Datenbank zu
// müssen: Nutzer, Tarife, Guthaben, Gutscheine, Aufladungen, Proxys, Tickets, Ankündigungen,
// Einstellungen, Client-Dateien, laufende Bots und das Protokoll.

import express from 'express';
import { config, paths } from '../config.js';
import { db, getSetting, setSetting, allSettings, audit, settingDefaults } from '../db.js';
import * as auth from '../auth.js';
import * as billing from '../billing.js';
import * as binaries from '../binaries.js';
import * as mail from '../mail.js';
import * as discord from '../discord.js';
import * as tickets from '../tickets.js';
import { supervisor } from '../supervisor.js';
import { planView } from './core.js';
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
      open_tickets: db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status != 'closed'").get().n,
      unread_tickets: tickets.openForStaff(),
      client: clientState(),
      mail: { configured: mail.configured(), verify: mail.verifyRequired() },
      discord: { configured: discord.configured(), login: discord.loginEnabled(), redirect: discord.redirectUri() },
      settings: safeSettings(),
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

/** Einstellungen ohne Geheimnisse – Passwörter kommen nur als "gesetzt/nicht gesetzt" zurück. */
function safeSettings() {
  const settings = allSettings();
  return {
    ...settings,
    smtp_pass: settings.smtp_pass ? '••••••••' : '',
    discord_client_secret: settings.discord_client_secret ? '••••••••' : '',
  };
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

const PLAN_FIELDS = [
  'name_de',
  'name_en',
  'blurb_de',
  'blurb_en',
  'price_credits',
  'free_slot',
  'max_accounts',
  'premium',
  'movement',
  'proxy',
  'offline_accounts',
  'fakehost',
  'chat_limit',
  'chat_limit_editable',
  'priority_support',
  'sort',
  'active',
];

function planValues(body, existing = {}) {
  const out = {};
  for (const field of PLAN_FIELDS) {
    if (body[field] === undefined) continue;
    if (['name_de', 'name_en', 'blurb_de', 'blurb_en'].includes(field)) {
      out[field] = String(body[field]).slice(0, 200);
    } else if (['price_credits', 'max_accounts', 'chat_limit', 'sort'].includes(field)) {
      out[field] = requireInt(body[field], field, { max: 1_000_000 });
    } else {
      out[field] = body[field] ? 1 : 0;
    }
  }
  if (out.name_de !== undefined && !out.name_de.trim()) throw bad('Der Tarif braucht einen Namen.');
  if (out.max_accounts !== undefined && out.max_accounts < 1) throw bad('Mindestens ein Konto je Server.');
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
      ticket,
      messages: tickets.messages(ticket.id, { staff: true }),
      user: owner ? userRow(owner) : null,
      paying: owner ? billing.isPayingUser(owner.id) : false,
    });
  })
);

admin.post(
  '/tickets/:id/reply',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    const updated = tickets.reply(ticket, req.user, req.body?.body, {
      internal: Boolean(req.body?.internal),
    });
    if (!req.body?.internal) tickets.notifyUser(updated);
    res.json({ ticket: updated, messages: tickets.messages(ticket.id, { staff: true }) });
  })
);

admin.patch(
  '/tickets/:id',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    const body = req.body || {};
    if (body.status !== undefined) tickets.setStatus(ticket, body.status, req.user.id);
    if (body.priority !== undefined) {
      if (!tickets.PRIORITIES.includes(body.priority)) throw bad('Unbekannte Dringlichkeit.');
      db.prepare('UPDATE tickets SET priority = ? WHERE id = ?').run(body.priority, ticket.id);
    }
    if (body.assigned_to !== undefined) {
      const target = body.assigned_to ? requireInt(body.assigned_to, 'Bearbeiter') : null;
      db.prepare('UPDATE tickets SET assigned_to = ? WHERE id = ?').run(target, ticket.id);
    }
    res.json({ ticket: db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id) });
  })
);

// ---------------------------------------------------------------- Ankündigungen

admin.get(
  '/announcements',
  wrap((req, res) => {
    res.json({
      announcements: db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 50').all(),
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
        `INSERT INTO announcements (title_de, title_en, body_de, body_en, kind, active, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        titleDe,
        titleEn,
        String(body.body_de || '').slice(0, 2000),
        String(body.body_en || body.body_de || '').slice(0, 2000),
        ['info', 'warn', 'bad'].includes(body.kind) ? body.kind : 'info',
        Date.now(),
        req.user.id
      );
    // Immer nur eine sichtbar – sonst stapeln sie sich im Dashboard.
    db.prepare('UPDATE announcements SET active = 0 WHERE id != ?').run(info.lastInsertRowid);
    res.json({ id: info.lastInsertRowid });
  })
);

admin.patch(
  '/announcements/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Ankündigung');
    const active = req.body?.active ? 1 : 0;
    if (active) db.prepare('UPDATE announcements SET active = 0').run();
    db.prepare('UPDATE announcements SET active = ? WHERE id = ?').run(active, id);
    res.json({ ok: true });
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

const NUMBERS = new Set([
  'free_slots',
  'signup_bonus',
  'low_balance',
  'renew_warn_days',
  'registration_open',
  'email_verify',
  'smtp_port',
  'smtp_secure',
  'discord_login',
  'maintenance',
  'max_bots_per_user',
]);
const TEXTS = new Set([
  'smtp_host',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'smtp_from_name',
  'discord_client_id',
  'discord_client_secret',
  'discord_staff_webhook',
  'maintenance_text',
  'support_hours',
]);

admin.get('/settings', wrap((req, res) => res.json({ settings: safeSettings(), defaults: settingDefaults })));

admin.patch(
  '/settings',
  wrap((req, res) => {
    for (const [key, value] of Object.entries(req.body || {})) {
      if (key === 'packages') {
        if (!Array.isArray(value)) throw bad('Pakete müssen eine Liste sein.');
        setSetting(
          key,
          value.map((entry) => ({
            cent: requireInt(entry.cent, 'Betrag', { min: 100, max: 1_000_000 }),
            credits: requireInt(entry.credits, 'Credits', { min: 1, max: 1_000_000 }),
            label: String(entry.label || `${(entry.cent / 100).toFixed(2)} €`).slice(0, 40),
          }))
        );
      } else if (NUMBERS.has(key)) {
        setSetting(key, requireInt(value, key, { max: 10_000_000 }));
      } else if (TEXTS.has(key)) {
        // Ein Feld voller Punkte heißt "nicht angefasst" – so lässt sich das Formular sicher
        // zurückschicken, ohne das Geheimnis vorher anzuzeigen.
        if (String(value).startsWith('••')) continue;
        setSetting(key, String(value).slice(0, 500));
      }
    }
    audit(req.user.id, 'admin-settings', Object.keys(req.body || {}));
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
    res.json({ mails: db.prepare('SELECT * FROM mails ORDER BY id DESC LIMIT 100').all() });
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

admin.get(
  '/audit',
  wrap((req, res) => {
    const action = String(req.query.action || '').trim();
    const userId = req.query.user ? Number(req.query.user) : null;
    const where = [];
    const values = [];
    if (action) {
      where.push('a.action LIKE ?');
      values.push(`%${action}%`);
    }
    if (userId) {
      where.push('a.user_id = ?');
      values.push(userId);
    }
    res.json({
      entries: db
        .prepare(
          `SELECT a.*, u.username FROM audit a LEFT JOIN users u ON u.id = a.user_id
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY a.id DESC LIMIT 300`
        )
        .all(...values),
      actions: db.prepare('SELECT DISTINCT action FROM audit ORDER BY action').all().map((row) => row.action),
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
