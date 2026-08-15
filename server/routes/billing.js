// Guthaben aufladen und einsehen.
//
// Bezahlt wird nie direkt für einen Bot, sondern immer nur Guthaben – ein Credit ist ein Cent.
// Wie das Geld hereinkommt, hängt davon ab, was eingerichtet ist: Stripe (mit Schlüssel),
// Überweisung/PayPal (der Admin bestätigt den Eingang), Gutschein – oder der Admin bucht direkt auf.

import express from 'express';
import { config } from '../config.js';
import { db, getSetting } from '../db.js';
import { requireUser } from '../auth.js';
import * as billing from '../billing.js';
import { planView } from './core.js';
import { wrap, requireInt, bad, notFound, token, formatCredits } from '../util.js';

export const router = express.Router();

const langOf = (req) => (String(req.query.lang || req.user?.language || 'en') === 'de' ? 'de' : 'en');

router.get(
  '/billing',
  requireUser,
  wrap((req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const lang = langOf(req);
    const slots = db
      .prepare(
        `SELECT p.id, p.name, p.paid_until, p.renew, p.suspended, pl.price_credits, pl.free_slot,
                pl.name_de, pl.name_en
           FROM profiles p JOIN plans pl ON pl.id = p.plan_id WHERE p.user_id = ? ORDER BY p.ordinal, p.id`
      )
      .all(user.id)
      .map((row) => ({
        id: row.id,
        name: row.name,
        plan: lang === 'de' ? row.name_de : row.name_en,
        price_credits: row.price_credits,
        free_slot: Boolean(row.free_slot),
        paid_until: row.paid_until,
        renew: Boolean(row.renew),
        suspended: Boolean(row.suspended),
        days_left: row.paid_until
          ? Math.max(0, Math.ceil((row.paid_until - Date.now()) / 86_400_000))
          : null,
      }));

    const monthly = billing.monthlyCost(user.id);
    res.json({
      balance: user.credits,
      balance_text: formatCredits(user.credits),
      balance_euro: (user.credits / 100).toFixed(2),
      monthly_cost: monthly,
      months_left: monthly > 0 ? Math.floor(user.credits / monthly) : null,
      low_balance: Number(getSetting('low_balance')),
      month_days: billing.MONTH_DAYS,
      free_slots: billing.freeSlots(),
      free_slots_left: Math.max(0, billing.freeSlots() - billing.usedFreeSlots(user.id)),
      slots,
      plans: billing.plans().map((plan) => planView(plan, lang)),
      packages: billing.packages(),
      history: billing.history(user.id, 80),
      spend: billing.spendByMonth(user.id, 6),
      topups: db.prepare('SELECT * FROM topups WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(user.id),
      methods: {
        stripe: Boolean(config.stripeSecret),
        transfer: Boolean(config.bankTransfer.iban),
        paypal: Boolean(config.bankTransfer.paypal),
        voucher: true,
      },
      bank: config.bankTransfer.iban
        ? {
            holder: config.bankTransfer.holder,
            iban: config.bankTransfer.iban,
            bic: config.bankTransfer.bic,
          }
        : null,
      paypal: config.bankTransfer.paypal || null,
    });
  })
);

router.post(
  '/billing/voucher',
  requireUser,
  wrap((req, res) => {
    const result = billing.redeemVoucher(req.user.id, req.body?.code);
    res.json({ ...result, balance_text: formatCredits(result.balance) });
  })
);

/** Aufladung anstoßen. Bei Stripe kommt eine Bezahlseite zurück, sonst eine Zahlungsanweisung. */
router.post(
  '/billing/topup',
  requireUser,
  wrap(async (req, res) => {
    const list = billing.packages();
    const index = requireInt(req.body?.package ?? 0, 'Paket', { min: 0, max: list.length - 1 });
    const chosen = list[index];
    const provider = String(req.body?.provider || (config.stripeSecret ? 'stripe' : 'transfer'));

    if (provider === 'stripe') {
      if (!config.stripeSecret) {
        throw bad('Kartenzahlung ist auf diesem Server nicht eingerichtet.', {
          en: 'Card payments are not set up on this server.',
        });
      }
      const topup = billing.createTopup({
        userId: req.user.id,
        provider: 'stripe',
        amountCent: chosen.cent,
        credits: chosen.credits,
      });
      const session = await stripeCheckout(req.user, chosen, topup, langOf(req));
      db.prepare('UPDATE topups SET external_id = ? WHERE id = ?').run(session.id, topup.id);
      res.json({ topup, redirect: session.url });
      return;
    }

    if (provider === 'transfer' || provider === 'paypal') {
      const reference = `AFK-${req.user.id}-${token(4).toUpperCase().slice(0, 6)}`;
      const topup = billing.createTopup({
        userId: req.user.id,
        provider,
        amountCent: chosen.cent,
        credits: chosen.credits,
        reference,
      });
      res.json({
        topup,
        instructions: {
          amount: (chosen.cent / 100).toFixed(2),
          reference,
          bank: provider === 'transfer' ? config.bankTransfer : null,
          paypal: provider === 'paypal' ? config.bankTransfer.paypal : null,
        },
      });
      return;
    }

    throw bad('Unbekannte Zahlungsart.', { en: 'Unknown payment method.' });
  })
);

router.delete(
  '/billing/topup/:id',
  requireUser,
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Aufladung');
    const topup = db.prepare('SELECT * FROM topups WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!topup) throw notFound('Aufladung gibt es nicht.', { en: 'No such top-up.' });
    billing.cancelTopup(id);
    res.json({ ok: true });
  })
);

/** Stripe-Checkout ohne SDK – die API nimmt ein Formular entgegen. */
async function stripeCheckout(user, chosen, topup, lang) {
  const body = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[0]': 'card',
    client_reference_id: String(topup.id),
    customer_email: user.email,
    success_url: `${config.publicUrl}/${lang}/app#/credits?paid=${topup.id}`,
    cancel_url: `${config.publicUrl}/${lang}/app#/credits?cancelled=${topup.id}`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(chosen.cent),
    'line_items[0][price_data][product_data][name]': `${config.brand} · ${chosen.credits} Credits`,
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
        billing.settleTopup(id, 'Stripe');
      } catch {
        /* schon gebucht */
      }
    }
  }
  res.json({ received: true });
});
