// Guthaben aufladen und einsehen – und der Admin-Bereich.
//
// Bezahlt wird nie direkt für einen Bot, sondern immer nur Guthaben. Wie das Geld hereinkommt,
// hängt davon ab, was eingerichtet ist: Stripe (mit Schlüssel), Überweisung/PayPal (der Admin
// bestätigt den Eingang), Gutschein – oder der Admin bucht direkt auf.

import express from 'express';
import { config } from '../config.js';
import { db, getSetting, setSetting, audit, allSettings } from '../db.js';
import { requireUser, requireAdmin, publicUser } from '../auth.js';
import * as credits from '../credits.js';
import { supervisor } from '../supervisor.js';
import * as binaries from '../binaries.js';
import { wrap, requireInt, requireString, bad, notFound, token, formatCredits } from '../util.js';

export const router = express.Router();

// ---------------------------------------------------------------- Guthaben (Nutzer)

router.get(
  '/billing',
  requireUser,
  wrap((req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const running = supervisor.list(user.id).filter((bot) => bot.state !== 'offline').length;
    res.json({
      balance_mcr: user.credits_mcr,
      balance: formatCredits(user.credits_mcr),
      rate_mcr_hour: credits.hourlyRate(user),
      credit_cent: Number(getSetting('credit_cent')),
      running,
      hours_left: Number.isFinite(credits.runtimeHours(user, running || 1))
        ? Number(credits.runtimeHours(user, running || 1).toFixed(1))
        : null,
      low_balance_mcr: Number(getSetting('low_balance_mcr')),
      packages: credits.packages(),
      history: credits.history(user.id, 60),
      usage: credits.usageByDay(user.id, 14),
      topups: db
        .prepare('SELECT * FROM topups WHERE user_id = ? ORDER BY id DESC LIMIT 20')
        .all(user.id),
      methods: {
        stripe: Boolean(config.stripeSecret),
        transfer: Boolean(config.bankTransfer.iban),
        paypal: Boolean(config.bankTransfer.paypal),
        voucher: true,
      },
      bank: config.bankTransfer.iban
        ? { holder: config.bankTransfer.holder, iban: config.bankTransfer.iban, bic: config.bankTransfer.bic }
        : null,
      paypal: config.bankTransfer.paypal || null,
    });
  })
);

router.post(
  '/billing/voucher',
  requireUser,
  wrap((req, res) => {
    const result = credits.redeemVoucher(req.user.id, req.body?.code);
    res.json({ ...result, balance: formatCredits(result.balance_mcr) });
  })
);

/** Aufladung anstoßen. Bei Stripe kommt eine Bezahlseite zurück, sonst eine Zahlungsanweisung. */
router.post(
  '/billing/topup',
  requireUser,
  wrap(async (req, res) => {
    const list = credits.packages();
    const index = requireInt(req.body?.package ?? 0, 'Paket', { min: 0, max: list.length - 1 });
    const chosen = list[index];
    const provider = String(req.body?.provider || (config.stripeSecret ? 'stripe' : 'transfer'));

    if (provider === 'stripe') {
      if (!config.stripeSecret) throw bad('Kartenzahlung ist auf diesem Server nicht eingerichtet.');
      const topup = credits.createTopup({
        userId: req.user.id,
        provider: 'stripe',
        amountCent: chosen.cent,
        creditsMcr: chosen.credits_mcr,
      });
      const session = await stripeCheckout(req.user, chosen, topup);
      db.prepare('UPDATE topups SET external_id = ? WHERE id = ?').run(session.id, topup.id);
      res.json({ topup, redirect: session.url });
      return;
    }

    if (provider === 'transfer' || provider === 'paypal') {
      const reference = `AFK-${req.user.id}-${token(4).toUpperCase().slice(0, 6)}`;
      const topup = credits.createTopup({
        userId: req.user.id,
        provider,
        amountCent: chosen.cent,
        creditsMcr: chosen.credits_mcr,
        reference,
      });
      res.json({
        topup,
        instructions: {
          amount: (chosen.cent / 100).toFixed(2),
          reference,
          bank: provider === 'transfer' ? config.bankTransfer : null,
          paypal: provider === 'paypal' ? config.bankTransfer.paypal : null,
          note: 'Nach dem Eingang schaltet ein Administrator das Guthaben frei.',
        },
      });
      return;
    }

    throw bad('Unbekannte Zahlungsart.');
  })
);

router.delete(
  '/billing/topup/:id',
  requireUser,
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Aufladung');
    const topup = db.prepare('SELECT * FROM topups WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!topup) throw notFound('Aufladung gibt es nicht.');
    credits.cancelTopup(id);
    res.json({ ok: true });
  })
);

/** Stripe-Checkout ohne SDK – die API nimmt ein Formular entgegen. */
async function stripeCheckout(user, chosen, topup) {
  const body = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[0]': 'card',
    client_reference_id: String(topup.id),
    customer_email: user.email,
    success_url: `${config.publicUrl}/app/#/guthaben?bezahlt=${topup.id}`,
    cancel_url: `${config.publicUrl}/app/#/guthaben?abbruch=${topup.id}`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(chosen.cent),
    'line_items[0][price_data][product_data][name]': `${config.brand} Guthaben ${chosen.credits} Credits`,
    'metadata[topup_id]': String(topup.id),
    'metadata[user_id]': String(user.id),
  });
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.stripeSecret}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await response.json();
  if (!response.ok) throw bad(`Stripe: ${data?.error?.message || response.status}`);
  return data;
}

// ---------------------------------------------------------------- Admin

export const admin = express.Router();
admin.use(requireUser, requireAdmin);

admin.get(
  '/overview',
  wrap((req, res) => {
    const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const balance = db.prepare('SELECT COALESCE(SUM(credits_mcr), 0) AS n FROM users').get().n;
    const day = Date.now() - 86_400_000;
    res.json({
      users,
      accounts: db.prepare('SELECT COUNT(*) AS n FROM mc_accounts').get().n,
      profiles: db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n,
      bots_running: supervisor.runningCount(),
      bots_online: [...supervisor.bots.values()].filter((bot) => bot.online).length,
      balance_mcr: balance,
      revenue_cent: db
        .prepare("SELECT COALESCE(SUM(amount_cent), 0) AS n FROM topups WHERE status = 'paid'")
        .get().n,
      usage_24h_mcr: -db
        .prepare("SELECT COALESCE(SUM(delta_mcr), 0) AS n FROM ledger WHERE kind = 'usage' AND created_at > ?")
        .get(day).n,
      open_topups: db.prepare("SELECT COUNT(*) AS n FROM topups WHERE status = 'open'").get().n,
      client: {
        tag: binaries.state.tag,
        version: binaries.state.clientVersion,
        versions: binaries.state.versions,
        movement: binaries.state.movement,
        checked: binaries.state.checkedAt,
        error: binaries.state.error,
      },
      settings: allSettings(),
    });
  })
);

admin.get(
  '/users',
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT u.*,
                (SELECT COUNT(*) FROM mc_accounts a WHERE a.user_id = u.id) AS accounts,
                (SELECT COUNT(*) FROM profiles p WHERE p.user_id = u.id) AS profiles
           FROM users u ORDER BY u.id`
      )
      .all();
    res.json({
      users: rows.map((row) => ({
        ...publicUser(row),
        blocked: Boolean(row.blocked),
        accounts: row.accounts,
        profiles: row.profiles,
        last_seen_at: row.last_seen_at,
        bots_running: supervisor.list(row.id).filter((bot) => bot.state !== 'offline').length,
      })),
    });
  })
);

admin.patch(
  '/users/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer gibt es nicht.');
    const body = req.body || {};

    if (body.credits_delta_mcr !== undefined) {
      const delta = Math.trunc(Number(body.credits_delta_mcr));
      if (!Number.isFinite(delta) || delta === 0) throw bad('Betrag fehlt.');
      credits.move(id, delta, 'admin', String(body.note || `durch ${req.user.username}`).slice(0, 200));
      audit(req.user.id, 'admin-credits', { user: id, delta });
    }
    if (body.role !== undefined) {
      if (!['user', 'admin'].includes(body.role)) throw bad('Unbekannte Rolle.');
      if (id === req.user.id && body.role !== 'admin') throw bad('Sich selbst kann man nicht herabstufen.');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, id);
    }
    if (body.blocked !== undefined) {
      db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(body.blocked ? 1 : 0, id);
      if (body.blocked) supervisor.stopUser(id, 'Konto wurde gesperrt.');
    }
    if (body.rate_mcr_hour !== undefined) {
      const rate = body.rate_mcr_hour === null ? null : requireInt(body.rate_mcr_hour, 'Tarif', { max: 100000 });
      db.prepare('UPDATE users SET rate_mcr_hour = ? WHERE id = ?').run(rate, id);
    }
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  })
);

admin.delete(
  '/users/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    if (id === req.user.id) throw bad('Das eigene Konto lässt sich hier nicht löschen.');
    supervisor.stopUser(id, 'Konto wurde gelöscht.');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit(req.user.id, 'admin-user-delete', { user: id });
    res.json({ ok: true });
  })
);

// ------------------------------------------------ Gutscheine und Aufladungen

admin.get(
  '/vouchers',
  wrap((req, res) => {
    res.json({ vouchers: db.prepare('SELECT * FROM vouchers ORDER BY created_at DESC LIMIT 200').all() });
  })
);

admin.post(
  '/vouchers',
  wrap((req, res) => {
    const creditsMcr = requireInt(req.body?.credits_mcr, 'Guthaben', { min: 1, max: 10_000_000 });
    const uses = requireInt(req.body?.uses ?? 1, 'Einlösungen', { min: 1, max: 1000 });
    const count = requireInt(req.body?.count ?? 1, 'Anzahl', { min: 1, max: 50 });
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push(
        credits.createVoucher({
          creditsMcr,
          uses,
          note: String(req.body?.note || '').slice(0, 200),
          createdBy: req.user.id,
          expiresAt: req.body?.expires_at ? Number(req.body.expires_at) : null,
        })
      );
    }
    audit(req.user.id, 'voucher-create', { count, credits_mcr: creditsMcr });
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

admin.get(
  '/topups',
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT t.*, u.username, u.email FROM topups t JOIN users u ON u.id = t.user_id
         ORDER BY t.status = 'open' DESC, t.id DESC LIMIT 200`
      )
      .all();
    res.json({ topups: rows });
  })
);

admin.post(
  '/topups/:id/settle',
  wrap((req, res) => {
    const topup = credits.settleTopup(requireInt(req.params.id, 'Aufladung'), `bestätigt von ${req.user.username}`);
    res.json({ topup });
  })
);

admin.post(
  '/topups/:id/cancel',
  wrap((req, res) => {
    credits.cancelTopup(requireInt(req.params.id, 'Aufladung'));
    res.json({ ok: true });
  })
);

// ------------------------------------------------ Einstellungen, Client, Bots

admin.get(
  '/settings',
  wrap((req, res) => {
    res.json({ settings: allSettings() });
  })
);

admin.patch(
  '/settings',
  wrap((req, res) => {
    const allowed = [
      'rate_mcr_hour',
      'credit_cent',
      'signup_bonus_mcr',
      'low_balance_mcr',
      'grace_minutes',
      'packages',
    ];
    for (const [key, value] of Object.entries(req.body || {})) {
      if (!allowed.includes(key)) continue;
      if (key === 'packages') {
        if (!Array.isArray(value)) throw bad('Pakete müssen eine Liste sein.');
        setSetting(key, value.map((entry) => ({
          cent: requireInt(entry.cent, 'Betrag', { min: 100, max: 1_000_000 }),
          credits_mcr: requireInt(entry.credits_mcr, 'Guthaben', { min: 1, max: 100_000_000 }),
          label: String(entry.label || `${(entry.cent / 100).toFixed(2)} €`).slice(0, 40),
        })));
      } else {
        setSetting(key, requireInt(value, key, { max: 10_000_000 }));
      }
    }
    audit(req.user.id, 'admin-settings', req.body);
    res.json({ settings: allSettings() });
  })
);

admin.post(
  '/client/sync',
  wrap(async (req, res) => {
    const state = await binaries.sync({ force: Boolean(req.body?.force) });
    audit(req.user.id, 'client-sync', { tag: state.tag });
    res.json({ client: { ...state, assets: state.assets.map((asset) => asset.name) } });
  })
);

admin.get(
  '/bots',
  wrap((req, res) => {
    const rows = [...supervisor.bots.values()].map((bot) => ({
      ...bot.snapshot(),
      user_id: bot.userId,
      profile: bot.profile.name,
      host: bot.profile.host,
      version: bot.profile.mc_version,
    }));
    res.json({ bots: rows });
  })
);

admin.post(
  '/bots/:profileId/:accountId/stop',
  wrap((req, res) => {
    supervisor.stop(requireInt(req.params.profileId, 'Profil'), requireInt(req.params.accountId, 'Konto'));
    res.json({ ok: true });
  })
);

admin.get(
  '/audit',
  wrap((req, res) => {
    res.json({
      entries: db
        .prepare(
          `SELECT a.*, u.username FROM audit a LEFT JOIN users u ON u.id = a.user_id
           ORDER BY a.id DESC LIMIT 200`
        )
        .all(),
    });
  })
);

// ---------------------------------------------------------------- Stripe-Webhook

/**
 * Wird von Stripe aufgerufen, sobald eine Zahlung durch ist. Die Signatur wird geprüft, damit
 * niemand sich selbst Guthaben zurufen kann.
 */
export const stripeWebhook = wrap(async (req, res) => {
  if (!config.stripeSecret) return res.status(404).end();
  const signature = req.headers['stripe-signature'];
  const raw = req.body; // rohe Bytes, siehe index.js

  if (config.stripeWebhookSecret) {
    const { createHmac, timingSafeEqual } = await import('node:crypto');
    const parts = Object.fromEntries(
      String(signature || '')
        .split(',')
        .map((part) => part.split('='))
    );
    const expected = createHmac('sha256', config.stripeWebhookSecret)
      .update(`${parts.t}.${raw}`)
      .digest('hex');
    const given = Buffer.from(String(parts.v1 || ''), 'utf8');
    const mine = Buffer.from(expected, 'utf8');
    if (given.length !== mine.length || !timingSafeEqual(given, mine)) {
      return res.status(400).json({ error: 'Signatur stimmt nicht.' });
    }
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Kein gültiges JSON.' });
  }

  if (event.type === 'checkout.session.completed') {
    const id = Number(event.data?.object?.metadata?.topup_id);
    if (id) {
      try {
        credits.settleTopup(id, 'Stripe');
      } catch {
        /* schon gebucht */
      }
    }
  }
  res.json({ received: true });
});
