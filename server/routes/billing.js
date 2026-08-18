// Guthaben aufladen und einsehen.
//
// Bezahlt wird nie direkt für einen Bot, sondern immer nur Guthaben – ein Credit ist ein Cent.
// Wie das Geld hereinkommt, hängt davon ab, was eingerichtet ist: **Tebex** (Karte, PayPal und
// alles Weitere, samt Umsatzsteuer), Überweisung/PayPal von Hand (der Admin bestätigt den
// Eingang), Gutschein – oder der Admin bucht direkt auf.
//
// Guthaben entsteht an genau einer Stelle: `billing.settleTopup`. Weder die Rückkehr des Browsers
// von der Bezahlseite noch ein Klick im Panel bucht etwas – nur der geprüfte Webhook von Tebex,
// die Bestätigung eines Admins oder ein eingelöster Gutschein.

import express from 'express';
import { config } from '../config.js';
import { db, getSetting } from '../db.js';
import { requireUser } from '../auth.js';
import * as billing from '../billing.js';
import * as tebex from '../tebex.js';
import * as notify from '../notify.js';
import { planView } from './core.js';
import { wrap, requireInt, bad, notFound, token, formatCredits, langOf } from '../util.js';

export const router = express.Router();

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
        tebex: tebex.configured(),
        transfer: Boolean(config.bankTransfer.iban),
        paypal: Boolean(config.bankTransfer.paypal),
        voucher: true,
      },
      tebex_store: tebex.status().store,
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

/**
 * Aufladung anstoßen.
 *
 * Bei Tebex kommt eine Bezahladresse zurück, sonst eine Zahlungsanweisung mit Verwendungszweck.
 * In beiden Fällen entsteht hier eine **offene** Aufladung – gebucht wird sie erst, wenn das Geld
 * wirklich da ist.
 */
router.post(
  '/billing/topup',
  requireUser,
  wrap(async (req, res) => {
    const list = billing.packages();
    // Ohne Aufladepakete gäbe es unten "Paket muss zwischen 0 und -1 liegen" – eine Meldung, aus
    // der niemand liest, dass der Betreiber schlicht keine eingerichtet hat.
    if (!list.length) {
      throw bad('Es sind keine Aufladepakete eingerichtet.', { en: 'No top-up packages are set up.' });
    }
    const index = requireInt(req.body?.package ?? 0, 'Paket', { min: 0, max: list.length - 1 });
    const chosen = list[index];
    const provider = String(req.body?.provider || (tebex.configured() ? 'tebex' : 'transfer'));

    if (provider === 'tebex') {
      const topup = billing.createTopup({
        userId: req.user.id,
        provider: 'tebex',
        amountCent: chosen.cent,
        credits: chosen.credits,
      });
      try {
        const checkout = await tebex.createCheckout({
          user: req.user,
          pack: chosen,
          topup,
          lang: langOf(req),
        });
        if (checkout.reference) {
          db.prepare('UPDATE topups SET external_id = ? WHERE id = ?').run(checkout.reference, topup.id);
        }
        res.json({ topup, redirect: checkout.url });
      } catch (error) {
        // Eine offene Aufladung, zu der es keine Bezahlseite gibt, wäre eine Karteileiche in der
        // Liste des Kunden. Weg damit, bevor der Fehler nach oben geht.
        billing.cancelTopup(topup.id);
        throw error;
      }
      return;
    }

    if (provider === 'transfer' || provider === 'paypal') {
      // Nur Ziffern und Großbuchstaben: base64url bringt "-" und "_" mit, und die kommen im
      // Verwendungszweck einer Überweisung nicht überall heil an.
      const reference = `AFK-${req.user.id}-${token(8).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6)}`;
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

// ---------------------------------------------------------------- Tebex-Webhook
//
// Die einzige Stelle, an der eine Zahlung zu Guthaben wird. Sie ist deshalb dreifach abgesichert:
//
//   1. **Unterschrift.** Ohne hinterlegtes Webhook-Geheimnis wird gar nichts angenommen.
//   2. **Betrag.** Der Webhook enthält den Warenkorb *zum Zeitpunkt der Zahlung* – wir vergleichen
//      ihn mit dem, was die Aufladung kosten sollte, und buchen sonst nicht.
//   3. **Einmaligkeit.** `settleTopup` bucht eine bereits bezahlte Aufladung nicht ein zweites Mal.

export const tebexWebhook = wrap(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));

  if (!tebex.verify(raw, req.headers['x-signature'])) {
    // Kein Hinweis darauf, *was* nicht stimmte: wer hier herumprobiert, soll nichts lernen.
    if (!tebex.webhookReady()) console.warn('[tebex] Webhook abgelehnt: tebex_webhook_secret fehlt.');
    return res.status(401).json({ error: 'Signatur stimmt nicht.' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Kein gültiges JSON.' });
  }

  // Beim Einrichten schickt Tebex einmal eine Prüfnachricht. Sie will ihre eigene ID zurück –
  // erst danach schickt Tebex überhaupt echte Meldungen an diese Adresse.
  if (event.type === 'validation.webhook') {
    console.log('[tebex] Webhook bestätigt.');
    return res.json({ id: event.id });
  }

  const payment = tebex.readPayment(event);

  if (event.type === 'payment.completed') {
    const topup = payment.topupId
      ? db.prepare("SELECT * FROM topups WHERE id = ? AND provider = 'tebex'").get(payment.topupId)
      : null;
    if (!topup) {
      console.warn(`[tebex] Zahlung ${payment.transaction} ohne zugehörige Aufladung.`);
      return res.json({ received: true });
    }
    // Bezahlt wurde in der Währung des Tebex-Stores. Steht dort etwas anderes als Euro, stimmt
    // der Vergleich nicht mehr – dann lieber nicht buchen und den Betreiber hinsehen lassen.
    const mismatch =
      payment.amountCent !== topup.amount_cent || (payment.currency && payment.currency !== 'EUR');
    if (mismatch) {
      console.warn(
        `[tebex] Betrag passt nicht: erwartet ${topup.amount_cent} Cent EUR, ` +
          `bezahlt ${payment.amountCent} ${payment.currency || '?'} (${payment.transaction}).`
      );
      notify.staff({
        title: 'Tebex: Betrag passt nicht',
        description:
          `Zahlung \`${payment.transaction}\` zu Aufladung #${topup.id}: erwartet ` +
          `${(topup.amount_cent / 100).toFixed(2)} € EUR, bezahlt ` +
          `${(payment.amountCent / 100).toFixed(2)} ${payment.currency || '?'}. **Nicht gebucht.**`,
      });
      return res.json({ received: true });
    }
    db.prepare('UPDATE topups SET external_id = ? WHERE id = ?').run(payment.transaction, topup.id);
    try {
      billing.settleTopup(topup.id, `Tebex ${payment.transaction}`);
    } catch (error) {
      console.error('[tebex] Buchung fehlgeschlagen:', error.message);
    }
    return res.json({ received: true });
  }

  // Rückerstattung, Rücklastschrift, verlorener Streitfall: das Geld ist wieder weg, also auch
  // die Credits. Höchstens so viele, wie noch da sind – ins Minus geht es hier nie.
  if (['payment.refunded', 'payment.dispute.lost', 'payment.dispute.opened'].includes(event.type)) {
    const revoke = event.type !== 'payment.dispute.opened';
    const topup = payment.topupId
      ? db.prepare("SELECT * FROM topups WHERE id = ? AND provider = 'tebex'").get(payment.topupId)
      : null;
    if (!topup) {
      notify.staff({
        title: `Tebex: ${event.type}`,
        description: `Zahlung \`${payment.transaction || 'unbekannt'}\` – keine Aufladung dazu gefunden.`,
      });
    } else if (revoke) {
      const result = billing.refundTopup(topup.id, `Tebex ${event.type} ${payment.transaction || ''}`.trim());
      notify.staff({
        title: `Tebex: ${event.type}`,
        description:
          `Aufladung #${topup.id}: ${result.taken} Credits abgezogen` +
          (result.missing ? `, ${result.missing} Credits waren schon ausgegeben.` : '.'),
      });
    } else {
      // Ein eröffneter Streitfall nimmt noch nichts zurück – aber er gehört auf den Tisch, und
      // zwar mit der Aufladung, um die es geht. Vorher stand hier "keine Aufladung dazu gefunden",
      // obwohl sie gefunden wurde: eine Meldung, die genau das Gegenteil dessen sagte, was war.
      notify.staff({
        title: `Tebex: ${event.type}`,
        description:
          `Aufladung #${topup.id} über ${(topup.amount_cent / 100).toFixed(2)} € ` +
          `(Zahlung \`${payment.transaction || 'unbekannt'}\`). Noch nichts zurückgebucht – ` +
          'das entscheidet der Ausgang des Streitfalls.',
      });
    }
    return res.json({ received: true });
  }

  res.json({ received: true });
});
