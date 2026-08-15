// Guthaben und Tarife.
//
// Es gibt kein Abo bei einem Zahlungsdienst und keine Rechnung, sondern ein Guthabenkonto:
// **1 Credit = 1 Cent**, 100 Credits = 1 Euro. Ausgegeben wird es nicht nach Stunden, sondern je
// Serverplatz und Monat – und ein Monat ist hier immer genau 30 Tage, damit der Preis auf der
// Seite und die Abbuchung im Kontoauszug dieselbe Zahl sind.
//
// Ein Serverplatz je Konto ist dauerhaft kostenlos. Jeder weitere bekommt einen bezahlten Tarif;
// läuft er ab und es ist zu wenig Guthaben da, wird der Server stillgelegt (Bots aus) statt
// gelöscht – aufladen und weitermachen genügt.

import { db, getSetting, audit } from './db.js';
import { voucherCode, bad, notFound } from './util.js';

/** Ein Monat sind hier immer 30 Tage. Keine Kalenderrechnerei, kein Februar-Sonderfall. */
export const MONTH_MS = 30 * 86_400_000;
export const MONTH_DAYS = 30;

const readUser = db.prepare('SELECT * FROM users WHERE id = ?');
const updateBalance = db.prepare('UPDATE users SET credits = ? WHERE id = ?');
const insertLedger = db.prepare(
  `INSERT INTO ledger (user_id, delta, balance, kind, note, ref, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

// ---------------------------------------------------------------- Guthaben

/** Guthaben ändern (positiv = gutschreiben, negativ = abbuchen). Gibt den neuen Stand zurück. */
export const move = db.transaction((userId, delta, kind, note, ref = null) => {
  const user = readUser.get(userId);
  if (!user) throw notFound('Benutzer gibt es nicht.', { en: 'No such user.' });
  const balance = user.credits + Math.round(delta);
  updateBalance.run(balance, userId);
  insertLedger.run(userId, Math.round(delta), balance, kind, note || null, ref, Date.now());
  return balance;
});

export const grant = (userId, amount, kind = 'admin', note = '') =>
  move(userId, Math.abs(amount), kind, note);
export const charge = (userId, amount, kind = 'plan', note = '') =>
  move(userId, -Math.abs(amount), kind, note);

export function balance(userId) {
  const user = readUser.get(userId);
  return user ? user.credits : 0;
}

/** Credits als Euro-Betrag – nur zur Anzeige, gerechnet wird immer in Credits. */
export const euro = (credits) => credits / 100;

// ---------------------------------------------------------------- Tarife

export function plans({ includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE active = 1';
  return db.prepare(`SELECT * FROM plans ${where} ORDER BY sort, id`).all();
}

export const planById = (id) => db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
export const planBySlug = (slug) => db.prepare('SELECT * FROM plans WHERE slug = ?').get(slug);

export function freePlan() {
  return db.prepare('SELECT * FROM plans WHERE free_slot = 1 AND active = 1 ORDER BY sort').get();
}

export function cheapestPaidPlan() {
  return db
    .prepare('SELECT * FROM plans WHERE free_slot = 0 AND active = 1 ORDER BY price_credits, sort')
    .get();
}

/** Der Tarif eines Profils – nie null: fehlt er, gilt der kostenlose Platz. */
export function planOf(profile) {
  return (profile.plan_id && planById(profile.plan_id)) || freePlan() || plans()[0];
}

/** Wie viele kostenlose Plätze ein Konto hat (Einstellung, Vorgabe 1). */
export const freeSlots = () => Math.max(0, Number(getSetting('free_slots')) || 0);

/** Wie viele kostenlose Plätze schon belegt sind – ohne `exceptProfileId`. */
export function usedFreeSlots(userId, exceptProfileId = 0) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM profiles p JOIN plans pl ON pl.id = p.plan_id
        WHERE p.user_id = ? AND pl.free_slot = 1 AND p.id != ?`
    )
    .get(userId, exceptProfileId).n;
}

export const freeSlotAvailable = (userId, exceptProfileId = 0) =>
  usedFreeSlots(userId, exceptProfileId) < freeSlots();

/** Ist dieses Profil bezahlt und gültig? */
export function isActive(profile) {
  const plan = planOf(profile);
  if (profile.suspended) return false;
  if (plan.free_slot) return true;
  return Boolean(profile.paid_until && profile.paid_until > Date.now());
}

/**
 * Zahlt dieser Nutzer? Entscheidet über Proxys, Chatverlauf und den Premium-Client.
 * Wahr, sobald mindestens ein Serverplatz mit bezahltem Tarif gültig ist – oder ein Administrator
 * Premium bis zu einem Datum eingetragen hat.
 */
export function isPayingUser(userId) {
  const user = readUser.get(userId);
  if (user?.premium_until && user.premium_until > Date.now()) return true;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM profiles p JOIN plans pl ON pl.id = p.plan_id
          WHERE p.user_id = ? AND pl.free_slot = 0 AND p.paid_until > ? LIMIT 1`
      )
      .get(userId, Date.now())
  );
}

/** Was ein Konto insgesamt im Monat kostet (nur gültige, bezahlte Plätze). */
export function monthlyCost(userId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(pl.price_credits), 0) AS n FROM profiles p JOIN plans pl ON pl.id = p.plan_id
        WHERE p.user_id = ? AND pl.free_slot = 0 AND p.paid_until > ?`
    )
    .get(userId, Date.now()).n;
}

/** Guthaben-Rest eines Platzes, wenn er jetzt gewechselt wird (auf ganze Credits abgerundet). */
export function refundValue(profile) {
  const plan = planOf(profile);
  if (plan.free_slot || !profile.paid_until) return 0;
  const left = profile.paid_until - Date.now();
  if (left <= 0) return 0;
  return Math.floor((plan.price_credits * left) / MONTH_MS);
}

/**
 * Einen Serverplatz auf einen Tarif setzen. Beim Wechsel wird der nicht verbrauchte Rest des
 * alten Tarifs gutgeschrieben und der neue voll berechnet – so gibt es keine Mischperioden, in
 * denen niemand mehr sagen kann, wofür gerade bezahlt wird.
 */
export const setPlan = db.transaction((profile, plan, { by = null } = {}) => {
  const user = readUser.get(profile.user_id);
  if (!user) throw notFound('Benutzer gibt es nicht.', { en: 'No such user.' });
  const current = planOf(profile);
  if (!plan.active) throw bad('Dieser Tarif wird nicht mehr angeboten.', { en: 'That plan is no longer offered.' });

  if (plan.free_slot) {
    if (!freeSlotAvailable(profile.user_id, profile.id)) {
      throw bad(
        `Der kostenlose Serverplatz ist schon vergeben. Es gibt ${freeSlots()} davon je Konto.`,
        { en: `Your free server slot is taken – there ${freeSlots() === 1 ? 'is one' : `are ${freeSlots()}`} per account.` }
      );
    }
    const refund = refundValue(profile);
    if (refund > 0) move(profile.user_id, refund, 'refund', `Restguthaben "${profile.name}"`);
    db.prepare(
      'UPDATE profiles SET plan_id = ?, paid_until = NULL, suspended = 0, chat_limit = ? WHERE id = ?'
    ).run(plan.id, Math.min(profile.chat_limit || plan.chat_limit, plan.chat_limit), profile.id);
    audit(by ?? profile.user_id, 'plan-set', { profile: profile.id, plan: plan.slug });
    return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id);
  }

  const refund = current.free_slot ? 0 : refundValue(profile);
  const price = plan.price_credits;
  if (user.credits + refund < price) {
    throw bad(
      `Zu wenig Guthaben: "${plan.name_de}" kostet ${price} Credits für 30 Tage, vorhanden sind ${
        user.credits + refund
      }.`,
      {
        en: `Not enough credits: "${plan.name_en}" costs ${price} credits for 30 days, you have ${
          user.credits + refund
        }.`,
      }
    );
  }
  if (refund > 0) move(profile.user_id, refund, 'refund', `Restguthaben "${profile.name}"`);
  move(profile.user_id, -price, 'plan', `${plan.name_de} · ${profile.name} · 30 Tage`, String(profile.id));
  db.prepare(
    'UPDATE profiles SET plan_id = ?, paid_until = ?, suspended = 0, renew = 1, chat_limit = ? WHERE id = ?'
  ).run(
    plan.id,
    Date.now() + MONTH_MS,
    Math.min(profile.chat_limit || plan.chat_limit, plan.chat_limit),
    profile.id
  );
  audit(by ?? profile.user_id, 'plan-set', { profile: profile.id, plan: plan.slug, price });
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id);
});

/** Verlängerung ein-/ausschalten. Aus heißt: am Ende der Laufzeit wird der Platz stillgelegt. */
export function setRenew(profileId, renew) {
  db.prepare('UPDATE profiles SET renew = ? WHERE id = ?').run(renew ? 1 : 0, profileId);
}

/**
 * Fällige Verlängerungen abarbeiten. Läuft stündlich aus index.js.
 * Gibt zurück, was sich geändert hat, damit der Aufrufer Bots stoppen und benachrichtigen kann.
 */
export function renewDue(now = Date.now()) {
  const due = db
    .prepare(
      `SELECT p.*, pl.price_credits, pl.name_de, pl.free_slot FROM profiles p
         JOIN plans pl ON pl.id = p.plan_id
        WHERE pl.free_slot = 0 AND p.suspended = 0 AND p.paid_until IS NOT NULL AND p.paid_until <= ?`
    )
    .all(now);

  const renewed = [];
  const suspended = [];
  for (const profile of due) {
    const user = readUser.get(profile.user_id);
    if (!user) continue;
    if (profile.renew && user.credits >= profile.price_credits) {
      move(
        profile.user_id,
        -profile.price_credits,
        'plan',
        `${profile.name_de} · ${profile.name} · Verlängerung`,
        String(profile.id)
      );
      // Ab jetzt weiterrechnen, nicht ab dem alten Ende – sonst schrumpft die Laufzeit bei
      // jedem Ausfall des Dienstes um die Zeit, die er stand.
      db.prepare('UPDATE profiles SET paid_until = ? WHERE id = ?').run(now + MONTH_MS, profile.id);
      renewed.push({ userId: profile.user_id, profileId: profile.id, name: profile.name });
    } else {
      db.prepare('UPDATE profiles SET suspended = 1 WHERE id = ?').run(profile.id);
      suspended.push({
        userId: profile.user_id,
        profileId: profile.id,
        name: profile.name,
        reason: profile.renew ? 'no-credits' : 'cancelled',
      });
    }
  }
  return { renewed, suspended };
}

/** Wer läuft demnächst ab und hat zu wenig Guthaben? Grundlage für die Warnungen. */
export function expiringSoon(days = 3) {
  const until = Date.now() + days * 86_400_000;
  return db
    .prepare(
      `SELECT p.id, p.name, p.user_id, p.paid_until, p.renew, pl.price_credits, u.credits
         FROM profiles p JOIN plans pl ON pl.id = p.plan_id JOIN users u ON u.id = p.user_id
        WHERE pl.free_slot = 0 AND p.suspended = 0 AND p.paid_until BETWEEN ? AND ?`
    )
    .all(Date.now(), until);
}

/** Einen stillgelegten Platz wieder anschalten – bezahlt eine neue Laufzeit. */
export function resume(profile) {
  const plan = planOf(profile);
  if (plan.free_slot) {
    db.prepare('UPDATE profiles SET suspended = 0 WHERE id = ?').run(profile.id);
    return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id);
  }
  return setPlan({ ...profile, paid_until: null }, plan);
}

// ---------------------------------------------------------------- Gutscheine

export function createVoucher({ credits, uses = 1, note = '', createdBy = null, expiresAt = null }) {
  const code = voucherCode();
  db.prepare(
    `INSERT INTO vouchers (code, credits, uses_left, note, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(code, Math.round(credits), uses, note || null, createdBy, Date.now(), expiresAt);
  return db.prepare('SELECT * FROM vouchers WHERE code = ?').get(code);
}

export const redeemVoucher = db.transaction((userId, rawCode) => {
  const code = String(rawCode || '').trim().toUpperCase();
  const voucher = db.prepare('SELECT * FROM vouchers WHERE code = ?').get(code);
  if (!voucher) throw bad('Diesen Gutscheincode gibt es nicht.', { en: 'No such voucher code.' });
  if (voucher.uses_left <= 0) throw bad('Dieser Gutschein ist schon eingelöst.', { en: 'That voucher is used up.' });
  if (voucher.expires_at && voucher.expires_at < Date.now()) {
    throw bad('Dieser Gutschein ist abgelaufen.', { en: 'That voucher has expired.' });
  }
  db.prepare('UPDATE vouchers SET uses_left = uses_left - 1 WHERE code = ?').run(code);
  const after = move(userId, voucher.credits, 'voucher', `Gutschein ${code}`, code);
  audit(userId, 'voucher-redeem', { code, credits: voucher.credits });
  return { credits: voucher.credits, balance: after };
});

// ---------------------------------------------------------------- Aufladungen

/** Aufladepakete aus den Einstellungen, um Euro-Preis und Bonus ergänzt. */
export function packages() {
  const list = getSetting('packages') || [];
  return list.map((entry, index) => ({
    index,
    cent: entry.cent,
    credits: entry.credits,
    label: entry.label || `${(entry.cent / 100).toFixed(2)} €`,
    euro: (entry.cent / 100).toFixed(2),
    bonus: Math.max(0, entry.credits - entry.cent),
  }));
}

export function createTopup({ userId, provider, amountCent, credits, reference = null, externalId = null }) {
  const info = db
    .prepare(
      `INSERT INTO topups (user_id, provider, amount_cent, credits, status, reference, external_id, created_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`
    )
    .run(userId, provider, amountCent, credits, reference, externalId, Date.now());
  return db.prepare('SELECT * FROM topups WHERE id = ?').get(info.lastInsertRowid);
}

export const settleTopup = db.transaction((topupId, note = '') => {
  const topup = db.prepare('SELECT * FROM topups WHERE id = ?').get(topupId);
  if (!topup) throw notFound('Aufladung gibt es nicht.', { en: 'No such top-up.' });
  if (topup.status === 'paid') return topup;
  db.prepare('UPDATE topups SET status = ?, paid_at = ? WHERE id = ?').run('paid', Date.now(), topupId);
  move(
    topup.user_id,
    topup.credits,
    'topup',
    note || `Aufladung ${(topup.amount_cent / 100).toFixed(2)} € (${topup.provider})`,
    String(topupId)
  );
  audit(topup.user_id, 'topup-paid', { id: topupId, provider: topup.provider });
  return db.prepare('SELECT * FROM topups WHERE id = ?').get(topupId);
});

export function cancelTopup(topupId) {
  db.prepare("UPDATE topups SET status = 'cancelled' WHERE id = ? AND status = 'open'").run(topupId);
}

// ---------------------------------------------------------------- Auswertung

export function history(userId, limit = 60) {
  return db.prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
}

/** Ausgaben je Monat für die kleine Kurve im Guthaben-Bereich. */
export function spendByMonth(userId, months = 6) {
  const rows = db
    .prepare("SELECT created_at, delta FROM ledger WHERE user_id = ? AND kind = 'plan' AND delta < 0")
    .all(userId);
  const buckets = new Map();
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(date.toISOString().slice(0, 7), 0);
  }
  for (const row of rows) {
    const month = new Date(row.created_at).toISOString().slice(0, 7);
    if (buckets.has(month)) buckets.set(month, buckets.get(month) - row.delta);
  }
  return [...buckets].map(([month, credits]) => ({ month, credits }));
}
