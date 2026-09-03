// Guthaben aufladen und einsehen.
//
// Bezahlt wird nie direkt für einen Bot, sondern immer nur Guthaben – ein Credit ist ein Cent.
// Wie das Geld hereinkommt, hängt davon ab, was eingerichtet ist: **Stripe** (Karte, PayPal und
// alles Weitere), Überweisung/PayPal von Hand (der Admin bestätigt den Eingang), Gutschein – oder
// der Admin bucht direkt auf.
//
// Verkäufer ist bei jedem dieser Wege AFKSystems selbst: Preis, Beleg und Umsatzsteuer kommen aus
// diesem Panel und nicht vom Zahlungsdienst. Was zur Umsatzsteuer auf Kasse und Beleg steht, sagt
// `vat.js` – und zwar für alle Zahlarten derselbe Satz.
//
// Guthaben entsteht an genau einer Stelle: `billing.settleTopup`. Weder die Rückkehr des Browsers
// von der Bezahlseite noch ein Klick im Panel bucht etwas – nur der geprüfte Webhook von Stripe,
// die Bestätigung eines Admins oder ein eingelöster Gutschein.

import express from 'express';
import { config } from '../config.js';
import { db, getSetting } from '../db.js';
import { requireUser, newReferralCode } from '../auth.js';
import * as billing from '../billing.js';
import * as stripe from '../stripe.js';
import * as vat from '../vat.js';
import * as receipt from '../receipt.js';
import * as notify from '../notify.js';
import { planView } from './core.js';
import { wrap, requireInt, bad, notFound, token, formatCredits, langOf } from '../util.js';

export const router = express.Router();

router.get(
  '/billing',
  requireUser,
  wrap((req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    // Sollte eigentlich nie fehlen (Migration 037 vergibt ihn an jedes Konto, register() und
    // createFromIdentity() an jedes neue) – aber ein fehlender Code darf keinen kaputten Link
    // zeigen, sondern heilt sich hier selbst.
    if (!user.referral_code) {
      user.referral_code = newReferralCode();
      db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(user.referral_code, user.id);
    }
    const lang = langOf(req);
    const slots = db
      .prepare(
        // Der Preis ist Tarif **plus** gebuchte Zusätze – dieselbe Rechnung wie in
        // `billing.monthlyPrice`. Ohne die Zusätze stünde neben einem Platz mit Live-Ansicht die
        // Hälfte dessen, was am Monatsende wirklich abgebucht wird.
        `SELECT p.id, p.name, p.paid_until, p.renew, p.suspended, pl.free_slot, pl.name_de, pl.name_en,
                pl.price_credits + COALESCE((SELECT SUM(a.price_credits * pa.qty)
                    FROM profile_addons pa JOIN addons a ON a.id = pa.addon_id
                   WHERE pa.profile_id = p.id), 0) AS price_credits
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
    // Der Monatswert allein beantwortet nicht, welcher Platz als Nächstes nicht mehr gedeckt ist.
    // Deshalb werden die kommenden Verlängerungen zeitlich durchgespielt: dieselbe Geldbörse,
    // aber jede Fälligkeit in ihrer wirklichen Reihenfolge. Einzahlungen und Tarifänderungen in
    // der Zukunft sind bewusst nicht geraten – die Prognose zeigt genau den Stand von jetzt.
    let projectedBalance = user.credits;
    const forecastBySlot = new Map();
    const renewalQueue = [];
    for (const slot of [...slots]
      .filter((slot) => !slot.free_slot && slot.renew && !slot.suspended && slot.paid_until)
      .sort((a, b) => a.paid_until - b.paid_until || a.id - b.id)) {
      const before = projectedBalance;
      const covered = before >= slot.price_credits;
      const forecast = {
        before_credits: before,
        cost_credits: slot.price_credits,
        covered,
        shortfall_credits: covered ? 0 : slot.price_credits - before,
      };
      forecastBySlot.set(slot.id, forecast);
      renewalQueue.push({
        id: slot.id,
        name: slot.name,
        due_at: slot.paid_until,
        due_in_days: Math.max(0, Math.ceil((slot.paid_until - Date.now()) / 86_400_000)),
        ...forecast,
      });
      projectedBalance = Math.max(0, before - slot.price_credits);
    }
    // `months_left` is a useful coarse number, but it hides the actual order of renewals. Keep a
    // compact, explicitly non-speculative runway alongside it: no guessed future deposits, price
    // changes, or renewals beyond the next due event per slot. This lets the UI say which exact
    // renewal needs money and when, rather than turning a low balance into a generic warning.
    const firstUncovered = renewalQueue.find((entry) => !entry.covered) || null;
    const coveredRenewals = renewalQueue.filter((entry) => entry.covered);
    const lastCovered = coveredRenewals.at(-1) || null;
    const nextRenewal = renewalQueue[0] || null;
    res.json({
      balance: user.credits,
      balance_text: formatCredits(user.credits, lang),
      balance_euro: (user.credits / 100).toFixed(2),
      monthly_cost: monthly,
      months_left: monthly > 0 ? Math.floor(user.credits / monthly) : null,
      low_balance: Number(getSetting('low_balance')),
      month_days: billing.MONTH_DAYS,
      runway: {
        renewal_count: renewalQueue.length,
        covered_count: coveredRenewals.length,
        next: nextRenewal,
        first_uncovered: firstUncovered,
        covered_until: lastCovered?.due_at || null,
        balance_after_covered: projectedBalance,
      },
      free_slots: billing.freeSlots(),
      free_slots_left: Math.max(0, billing.freeSlots() - billing.usedFreeSlots(user.id)),
      slots: slots.map((slot) => ({ ...slot, forecast: forecastBySlot.get(slot.id) || null })),
      plans: billing.plans().map((plan) => planView(plan, lang)),
      packages: billing.packages(),
      history: billing.history(user.id, 80),
      spend: billing.spendByMonth(user.id, 6),
      // Für die Diagramme: der Verlauf des Guthabens, wofür es draufging, und was jeder einzelne
      // Serverplatz im Monat kostet. Alles drei aus denselben Zeilen, aus denen auch der
      // Kontoauszug darunter kommt – zwei Quellen für dieselbe Zahl gehen sonst auseinander.
      balance_days: billing.balanceByDay(user.id, 30),
      spend_kinds: billing.spendByKind(user.id, 6),
      slot_costs: slots
        .filter((row) => !row.free_slot)
        .map((row) => ({ label: row.name, credits: row.price_credits })),
      topups: db.prepare('SELECT * FROM topups WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(user.id),
      // Die Belege kommen mit derselben Antwort: Der Guthaben-Bereich zeigt sie direkt darunter,
      // und eine zweite Anfrage für eine Liste, die aus derselben Tabelle stammt, wäre eine
      // Anfrage mehr für dieselbe Sache.
      receipts: receipt.listFor(user.id),
      methods: {
        stripe: stripe.configured(),
        transfer: Boolean(config.bankTransfer.iban),
        paypal: Boolean(config.bankTransfer.paypal),
        voucher: true,
      },
      // Der Umsatzsteuerhinweis gehört neben die Preise und nicht nur auf den Beleg: Was beim
      // Bezahlen steht, muss vorher schon dagestanden haben.
      vat: vat.view(lang),
      bank: config.bankTransfer.iban
        ? {
            holder: config.bankTransfer.holder,
            iban: config.bankTransfer.iban,
            bic: config.bankTransfer.bic,
          }
        : null,
      paypal: config.bankTransfer.paypal || null,
      // 0 = das Empfehlungsprogramm ist aus (Vorgabe, siehe settings-schema.js) – das Frontend
      // blendet den ganzen Kasten dann aus, statt eine Prämie von null Credits zu bewerben.
      referral: {
        code: user.referral_code,
        url: `${config.publicUrl}/${lang}/register?ref=${user.referral_code}`,
        bonus: Number(getSetting('referral_bonus')) || 0,
        referred: db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?').get(user.id).n,
        rewarded: db
          .prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ? AND referral_rewarded = 1')
          .get(user.id).n,
      },
    });
  })
);

router.post(
  '/billing/voucher',
  requireUser,
  wrap((req, res) => {
    const result = billing.redeemVoucher(req.user.id, req.body?.code);
    res.json({ ...result, balance_text: formatCredits(result.balance, langOf(req)) });
  })
);

// ---------------------------------------------------------------- Belege
//
// Ein Beleg entsteht beim Verbuchen einer Zahlung und ändert sich danach nie wieder – Nummer,
// Anschrift und Steuerhinweis stehen als Abzug an der Aufladung (siehe billing.js `settle`).
// Hier wird nur noch gelesen.

router.get(
  '/billing/receipts',
  requireUser,
  wrap((req, res) => res.json({ receipts: receipt.listFor(req.user.id) }))
);

/**
 * Der Beleg selbst – als **Seite**, nicht als JSON.
 *
 * Er ist ein Dokument: Man öffnet ihn, druckt ihn, schickt ihn weiter. Deshalb kommt hier fertiges
 * HTML heraus und kein Datensatz, den irgendeine Ansicht noch einmal zusammenbauen müsste.
 *
 * Er hängt an keinem Stylesheet dieses Servers (alles steht darin) und braucht kein JavaScript.
 * Die Content-Security-Policy dieses Servers erlaubt ohnehin kein Inline-Skript – das ist hier
 * keine Einschränkung, sondern das Richtige: In einem Dokument mit den Angaben eines Kunden hat
 * nichts Ausführbares etwas verloren.
 */
router.get(
  '/billing/receipts/:id',
  requireUser,
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Beleg');
    // Ein Administrator darf jeden Beleg sehen – er beantwortet damit Rückfragen, ohne sich als
    // der Kunde ausgeben zu müssen. Jeder andere sieht nur seine eigenen.
    const row = receipt.byId(id, req.user.role === 'admin' ? null : req.user.id);
    if (!row || !row.receipt_no) {
      throw notFound('Diesen Beleg gibt es nicht.', { en: 'No such receipt.' });
    }
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Ein Beleg ist persönlich: Er darf in keinem gemeinsamen Zwischenspeicher landen.
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.query.download === '1') {
      const name = `receipt-${String(row.receipt_no).replace(/[^A-Za-z0-9._-]/g, '-')}.html`;
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    }
    res.send(receipt.html(row, owner, langOf(req)));
  })
);

/**
 * Aufladung anstoßen.
 *
 * Bei Stripe kommt eine Bezahladresse zurück, sonst eine Zahlungsanweisung mit Verwendungszweck.
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
    // Jede Aufladung legt eine Zeile im Kontoauszug an und – bei Stripe – eine Kasse bei einem
    // fremden Dienst. Ohne Grenze ist dieser Endpunkt ein Knopf, mit dem sich beides ohne einen
    // Cent beliebig oft auslösen lässt.
    const open = db
      .prepare("SELECT COUNT(*) AS n FROM topups WHERE user_id = ? AND status = 'open'")
      .get(req.user.id).n;
    if (open >= 10) {
      throw bad('Es sind schon zehn Aufladungen offen. Bitte erst eine davon abschließen.', {
        en: 'Ten top-ups are already open. Please finish one of them first.',
      });
    }
    const index = requireInt(req.body?.package ?? 0, 'Paket', { min: 0, max: list.length - 1 });
    const chosen = list[index];
    const provider = String(req.body?.provider || (stripe.configured() ? 'stripe' : 'transfer'));

    if (provider === 'stripe') {
      const topup = billing.createTopup({
        userId: req.user.id,
        provider: 'stripe',
        amountCent: chosen.cent,
        credits: chosen.credits,
      });
      try {
        const checkout = await stripe.createCheckout({
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
  wrap(async (req, res) => {
    const id = requireInt(req.params.id, 'Aufladung');
    const topup = db.prepare('SELECT * FROM topups WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!topup) throw notFound('Aufladung gibt es nicht.', { en: 'No such top-up.' });

    // Eine Stripe-Aufladung wird **zuerst bei Stripe geschlossen** und dann hier. Sonst bliebe die
    // Bezahlseite offen, und zehn Minuten später käme Geld zu einer Aufladung herein, die im Panel
    // längst als zurückgezogen gilt – `settleTopup` verweigert die dann zu Recht, und das Geld
    // stünde ohne Credits da. Stripe lehnt das Schließen ab, sobald bezahlt wurde: genau die
    // Antwort, die wir hier hören wollen, und dann bleibt die Aufladung offen.
    if (topup.provider === 'stripe' && topup.status === 'open' && topup.external_id && stripe.keyed()) {
      try {
        await stripe.expireCheckout(topup.external_id);
      } catch (error) {
        throw bad(
          `Diese Zahlung lässt sich nicht mehr zurückziehen: ${error.message}`,
          { en: `This payment can no longer be withdrawn: ${error.message}` }
        );
      }
    }
    billing.cancelTopup(id);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Stripe-Webhook
//
// Die einzige Stelle, an der eine Zahlung zu Guthaben wird. Sie ist deshalb vierfach abgesichert:
//
//   1. **Unterschrift und Alter.** Ohne hinterlegtes Signaturgeheimnis wird gar nichts angenommen,
//      und eine mitgeschnittene, echt unterschriebene Meldung verfällt nach fünf Minuten.
//   2. **Betriebsart.** Eine Meldung aus dem Testmodus darf auf einem Konto im Echtbetrieb kein
//      Guthaben erzeugen – und umgekehrt. Testzahlungen kosten nichts; Credits daraus wären
//      Geld aus dem Nichts.
//   3. **Betrag und Währung.** Verglichen wird mit dem, was die Aufladung kosten sollte. Was nicht
//      zusammenpasst, wird nicht gebucht, sondern gemeldet.
//   4. **Einmaligkeit.** `settleTopup` bucht eine bereits bezahlte Aufladung nicht ein zweites Mal.
//      Stripe wiederholt Meldungen ausdrücklich, bis eine 2xx-Antwort kommt.

/**
 * Die Aufladung zu einer Meldung finden.
 *
 * Zwei Wege, weil nicht jede Meldung dasselbe weiß: Eine bezahlte Kasse trägt die Nummer der
 * Aufladung in `metadata`, ein Streitfall kennt dagegen nur die Zahlung darunter. Deren Nummer
 * steht seit dem Verbuchen in `external_id` – siehe `settleFrom` weiter unten.
 */
function topupFor(payment) {
  if (payment.topupId) {
    const row = db
      .prepare("SELECT * FROM topups WHERE id = ? AND provider = 'stripe'")
      .get(payment.topupId);
    if (row) return row;
  }
  if (payment.paymentIntent) {
    return (
      db
        .prepare("SELECT * FROM topups WHERE external_id = ? AND provider = 'stripe'")
        .get(payment.paymentIntent) || null
    );
  }
  return null;
}

/**
 * Eine bezahlte Kasse verbuchen – oder begründet nicht verbuchen.
 *
 * Gibt zurück, was im Log stehen soll; gebucht wird nur, wenn Konto, Betrag und Währung zu der
 * Aufladung passen, die wir selbst angelegt haben.
 */
function settleFrom(payment) {
  const topup = topupFor(payment);
  if (!topup) {
    console.warn(`[stripe] Zahlung ${payment.paymentIntent || payment.session} ohne zugehörige Aufladung.`);
    return;
  }

  // Die Aufladung muss zu dem Konto gehören, das in der Kasse steht. `metadata` reist über Stripe
  // und kommt so zurück, wie wir sie hingeschickt haben – passt sie trotzdem nicht zusammen, ist
  // das kein Zahlungsvorgang, den wir zuordnen können.
  if (payment.userId && payment.userId !== topup.user_id) {
    console.warn(
      `[stripe] Zahlung ${payment.paymentIntent}: Aufladung #${topup.id} gehört Konto ` +
        `${topup.user_id}, in der Kasse steht ${payment.userId}. Nicht gebucht.`
    );
    notify.system({
      title: 'Stripe: Konto passt nicht',
      description:
        `Zahlung \`${payment.paymentIntent}\` nennt Konto ${payment.userId}, Aufladung ` +
        `#${topup.id} gehört Konto ${topup.user_id}. **Nicht gebucht.**`,
    });
    return;
  }

  // Bezahlt wird in Euro. Steht dort etwas anderes – weil jemand die Währung im Stripe-Konto
  // umgestellt hat –, stimmt der Vergleich nicht mehr; dann lieber nicht buchen und hinsehen lassen.
  if (payment.amountCent !== topup.amount_cent || (payment.currency && payment.currency !== 'EUR')) {
    console.warn(
      `[stripe] Betrag passt nicht: erwartet ${topup.amount_cent} Cent EUR, ` +
        `bezahlt ${payment.amountCent} ${payment.currency || '?'} (${payment.paymentIntent}).`
    );
    notify.system({
      title: 'Stripe: Betrag passt nicht',
      description:
        `Zahlung \`${payment.paymentIntent}\` zu Aufladung #${topup.id}: erwartet ` +
        `${(topup.amount_cent / 100).toFixed(2)} € EUR, bezahlt ` +
        `${(payment.amountCent / 100).toFixed(2)} ${payment.currency || '?'}. **Nicht gebucht.**`,
    });
    return;
  }

  // Ab hier steht in `external_id` die **Zahlung** und nicht mehr die Kasse: Eine Erstattung oder
  // ein Streitfall meldet später nur diese Nummer, und ohne sie fände `topupFor` die Aufladung
  // nicht wieder.
  const reference = payment.paymentIntent || payment.session;
  if (reference) db.prepare('UPDATE topups SET external_id = ? WHERE id = ?').run(reference, topup.id);
  try {
    billing.settleTopup(topup.id, `Stripe ${reference || ''}`.trim());
  } catch (error) {
    console.error('[stripe] Buchung fehlgeschlagen:', error.message);
  }
}

/** Geld zurück: Erstattung oder verlorener Streitfall. Höchstens so viel, wie noch da ist. */
function revokeFrom(payment, topup, reason) {
  const result = billing.refundTopup(topup.id, `Stripe ${reason} ${payment.paymentIntent || ''}`.trim());
  notify.system({
    title: `Stripe: ${reason}`,
    description:
      `Aufladung #${topup.id}: ${result.taken} Credits abgezogen` +
      (result.missing ? `, ${result.missing} Credits waren schon ausgegeben.` : '.'),
  });
}

export const stripeWebhook = wrap(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));

  if (!stripe.verify(raw, req.headers['stripe-signature'])) {
    // Kein Hinweis darauf, *was* nicht stimmte: wer hier herumprobiert, soll nichts lernen.
    if (!stripe.webhookReady()) {
      console.warn('[stripe] Webhook abgelehnt: stripe_webhook_secret fehlt.');
    }
    return res.status(401).json({ error: 'Signatur stimmt nicht.' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Kein gültiges JSON.' });
  }

  // Test und Echtbetrieb haben bei Stripe getrennte Schlüssel, Endpunkte und Geheimnisse – aber
  // dasselbe Panel dahinter. Wer beim Umschalten das falsche Geheimnis stehen lässt, hätte sonst
  // einen Endpunkt, der kostenlose Testzahlungen mit echten Credits belohnt.
  if (!stripe.livemodeMatches(event)) {
    console.warn(
      `[stripe] ${event.type} verworfen: Meldung ist ${event.livemode ? 'aus dem Echtbetrieb' : 'aus dem Testmodus'}, ` +
        `der hinterlegte Schlüssel ${stripe.live() ? 'nicht' : 'aber echt'}.`
    );
    return res.json({ received: true, ignored: 'livemode' });
  }

  const payment = stripe.readEvent(event);

  switch (payment.type) {
    // Die Kasse ist durch. Bei Karte und Wallets ist damit auch bezahlt; bei Zahlarten mit
    // Verzögerung (Lastschrift, manche Überweisungsverfahren) steht hier `unpaid`, und das Geld
    // kommt erst mit `async_payment_succeeded`. Dann bleibt die Aufladung offen – zu Recht.
    case 'checkout.session.completed':
      if (payment.paymentStatus === 'paid') settleFrom(payment);
      else console.log(`[stripe] Kasse ${payment.session} abgeschlossen, Zahlung noch unterwegs.`);
      return res.json({ received: true });

    case 'checkout.session.async_payment_succeeded':
      settleFrom(payment);
      return res.json({ received: true });

    // Die verzögerte Zahlung ist geplatzt. Die Aufladung ist damit erledigt und nicht etwa offen:
    // Wer es noch einmal versuchen will, lädt neu auf.
    case 'checkout.session.async_payment_failed': {
      const failed = topupFor(payment);
      if (failed) {
        billing.cancelTopup(failed.id);
        notify.system({
          title: 'Stripe: Zahlung fehlgeschlagen',
          description: `Aufladung #${failed.id} über ${(failed.amount_cent / 100).toFixed(2)} € wurde nicht bezahlt.`,
        });
      }
      return res.json({ received: true });
    }

    // Die Bezahlseite ist abgelaufen (Vorgabe: nach 24 Stunden). Ohne diesen Zweig blieben offene
    // Aufladungen für immer in der Liste des Kunden stehen und liefen irgendwann gegen die Grenze
    // von zehn offenen Vorgängen.
    case 'checkout.session.expired': {
      const stale = topupFor(payment);
      if (stale) billing.cancelTopup(stale.id);
      return res.json({ received: true });
    }

    // Erstattung. **Nur die vollständige** nimmt automatisch Credits zurück: Bei einer Teil-
    // erstattung ist die Frage, wie viele Credits das sind, keine Rechenaufgabe, sondern eine
    // Entscheidung – die trifft ein Mensch.
    case 'charge.refunded': {
      const topup = topupFor(payment);
      if (!topup) {
        notify.system({
          title: 'Stripe: Erstattung',
          description: `Zahlung \`${payment.paymentIntent || 'unbekannt'}\` – keine Aufladung dazu gefunden.`,
        });
      } else if (payment.amountRefunded >= payment.amountCent) {
        revokeFrom(payment, topup, 'Erstattung');
      } else {
        notify.system({
          title: 'Stripe: Teilerstattung',
          description:
            `Aufladung #${topup.id}: ${(payment.amountRefunded / 100).toFixed(2)} € von ` +
            `${(payment.amountCent / 100).toFixed(2)} € erstattet. **Nichts zurückgebucht** – ` +
            'das entscheidet der Betreiber.',
        });
      }
      return res.json({ received: true });
    }

    // Ein eröffneter Streitfall nimmt noch nichts zurück – aber er gehört auf den Tisch, und zwar
    // mit der Aufladung, um die es geht.
    case 'charge.dispute.created': {
      const topup = topupFor(payment);
      notify.system({
        title: 'Stripe: Streitfall eröffnet',
        description: topup
          ? `Aufladung #${topup.id} über ${(topup.amount_cent / 100).toFixed(2)} € ` +
            `(Zahlung \`${payment.paymentIntent || 'unbekannt'}\`). Noch nichts zurückgebucht – ` +
            'das entscheidet der Ausgang.'
          : `Zahlung \`${payment.paymentIntent || 'unbekannt'}\` – keine Aufladung dazu gefunden.`,
      });
      return res.json({ received: true });
    }

    // Entschieden. Verloren heißt: Das Geld ist weg, also auch die Credits. Gewonnen heißt:
    // nichts zu tun, aber sagen sollte man es.
    case 'charge.dispute.closed': {
      const topup = topupFor(payment);
      if (topup && payment.disputeStatus === 'lost') revokeFrom(payment, topup, 'Streitfall verloren');
      else {
        notify.system({
          title: `Stripe: Streitfall ${payment.disputeStatus || 'geschlossen'}`,
          description: topup
            ? `Aufladung #${topup.id} – nichts zurückgebucht.`
            : `Zahlung \`${payment.paymentIntent || 'unbekannt'}\` – keine Aufladung dazu gefunden.`,
        });
      }
      return res.json({ received: true });
    }

    default:
      // Stripe schickt gern mehr, als hier abonniert ist. Eine 2xx-Antwort heißt "angekommen"
      // und nicht "verstanden" – sonst wiederholt Stripe die Meldung tagelang.
      return res.json({ received: true });
  }
});
