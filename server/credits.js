// Guthaben. Es gibt kein Abo und keine Rechnung – nur ein Konto in Milli-Credits, von dem im
// Minutentakt abgebucht wird, solange Bots laufen. Aufgeladen wird per Gutschein, Überweisung/
// PayPal (der Admin bestätigt), Stripe (wenn ein Schlüssel hinterlegt ist) oder direkt vom Admin.

import { db, getSetting, audit } from './db.js';
import { voucherCode, bad, notFound } from './util.js';

const readUser = db.prepare('SELECT * FROM users WHERE id = ?');
const updateBalance = db.prepare('UPDATE users SET credits_mcr = ? WHERE id = ?');
const insertLedger = db.prepare(
  `INSERT INTO ledger (user_id, delta_mcr, balance_mcr, kind, note, ref, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

/** Guthaben ändern (positiv = gutschreiben, negativ = abbuchen). Gibt den neuen Stand zurück. */
export const move = db.transaction((userId, deltaMcr, kind, note, ref = null) => {
  const user = readUser.get(userId);
  if (!user) throw notFound('Benutzer gibt es nicht.');
  const balance = user.credits_mcr + Math.round(deltaMcr);
  updateBalance.run(balance, userId);
  insertLedger.run(userId, Math.round(deltaMcr), balance, kind, note || null, ref, Date.now());
  return balance;
});

export const grant = (userId, mcr, kind = 'admin', note = '') => move(userId, Math.abs(mcr), kind, note);
export const charge = (userId, mcr, kind = 'usage', note = '') => move(userId, -Math.abs(mcr), kind, note);

export function balance(userId) {
  const user = readUser.get(userId);
  return user ? user.credits_mcr : 0;
}

/** Tarif eines Nutzers je Bot und Stunde – eigener Wert schlägt den globalen. */
export function hourlyRate(user) {
  const own = typeof user === 'object' ? user.rate_mcr_hour : null;
  return own ?? Number(getSetting('rate_mcr_hour')) ?? 7;
}

/**
 * Ein Abrechnungsschritt. `usage` ist eine Map user_id -> Anzahl laufender Bots.
 * Abgerechnet wird anteilig für `minutes` Minuten. Zurück kommen die Nutzer, deren Guthaben
 * aufgebraucht ist – deren Bots stoppt der Aufrufer.
 */
export function meterTick(usage, minutes = 1) {
  const empty = [];
  for (const [userId, bots] of usage) {
    if (!bots) continue;
    const user = readUser.get(userId);
    if (!user) continue;
    const cost = Math.max(1, Math.round((hourlyRate(user) * bots * minutes) / 60));
    const after = user.credits_mcr - cost;
    move(userId, -cost, 'usage', `${bots} Bot(s), ${minutes} min`);
    if (after <= 0) empty.push({ userId, balance: after, bots });
  }
  return empty;
}

/**
 * Reicht das Guthaben, um `bots` Bots noch mindestens die Kulanzzeit laufen zu lassen?
 * Verhindert, dass jemand mit leerem Konto neue Bots startet.
 */
export function canStart(user, additionalBots = 1) {
  const grace = Number(getSetting('grace_minutes')) || 5;
  const needed = Math.max(1, Math.round((hourlyRate(user) * additionalBots * grace) / 60));
  return user.credits_mcr >= needed;
}

/** Wie lange reicht das Guthaben bei so vielen laufenden Bots noch (in Stunden)? */
export function runtimeHours(user, bots) {
  const rate = hourlyRate(user) * Math.max(bots, 1);
  if (rate <= 0) return Infinity;
  return user.credits_mcr / rate;
}

// ---------------------------------------------------------------- Gutscheine

export function createVoucher({ creditsMcr, uses = 1, note = '', createdBy = null, expiresAt = null }) {
  const code = voucherCode();
  db.prepare(
    `INSERT INTO vouchers (code, credits_mcr, uses_left, note, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(code, Math.round(creditsMcr), uses, note || null, createdBy, Date.now(), expiresAt);
  return db.prepare('SELECT * FROM vouchers WHERE code = ?').get(code);
}

export const redeemVoucher = db.transaction((userId, rawCode) => {
  const code = String(rawCode || '').trim().toUpperCase();
  const voucher = db.prepare('SELECT * FROM vouchers WHERE code = ?').get(code);
  if (!voucher) throw bad('Diesen Gutscheincode gibt es nicht.');
  if (voucher.uses_left <= 0) throw bad('Dieser Gutschein ist schon eingelöst.');
  if (voucher.expires_at && voucher.expires_at < Date.now()) throw bad('Dieser Gutschein ist abgelaufen.');

  db.prepare('UPDATE vouchers SET uses_left = uses_left - 1 WHERE code = ?').run(code);
  const balanceAfter = move(userId, voucher.credits_mcr, 'voucher', `Gutschein ${code}`, code);
  audit(userId, 'voucher-redeem', { code, credits_mcr: voucher.credits_mcr });
  return { credits_mcr: voucher.credits_mcr, balance_mcr: balanceAfter };
});

// ---------------------------------------------------------------- Aufladungen

/** Aufladepakete aus den Einstellungen, um den Euro-Preis ergänzt. */
export function packages() {
  const list = getSetting('packages') || [];
  return list.map((entry) => ({
    ...entry,
    euro: (entry.cent / 100).toFixed(2),
    credits: entry.credits_mcr / 1000,
    bonus_mcr: Math.max(0, entry.credits_mcr - entry.cent * 10),
  }));
}

export function createTopup({ userId, provider, amountCent, creditsMcr, reference = null, externalId = null }) {
  const info = db
    .prepare(
      `INSERT INTO topups (user_id, provider, amount_cent, credits_mcr, status, reference, external_id, created_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`
    )
    .run(userId, provider, amountCent, creditsMcr, reference, externalId, Date.now());
  return db.prepare('SELECT * FROM topups WHERE id = ?').get(info.lastInsertRowid);
}

export const settleTopup = db.transaction((topupId, note = '') => {
  const topup = db.prepare('SELECT * FROM topups WHERE id = ?').get(topupId);
  if (!topup) throw notFound('Aufladung gibt es nicht.');
  if (topup.status === 'paid') return topup;
  db.prepare('UPDATE topups SET status = ?, paid_at = ? WHERE id = ?').run('paid', Date.now(), topupId);
  move(
    topup.user_id,
    topup.credits_mcr,
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

/** Kurzer Kontoauszug für das Dashboard. */
export function history(userId, limit = 50) {
  return db
    .prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, limit);
}

/**
 * Verbrauchsbuchungen der letzten Tage zu Tageswerten zusammenfassen – Grundlage für die
 * Verbrauchskurve im Dashboard.
 */
export function usageByDay(userId, days = 14) {
  const since = Date.now() - days * 86_400_000;
  const rows = db
    .prepare(
      `SELECT created_at, delta_mcr FROM ledger
       WHERE user_id = ? AND kind = 'usage' AND created_at >= ?`
    )
    .all(userId, since);
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    buckets.set(day, 0);
  }
  for (const row of rows) {
    const day = new Date(row.created_at).toISOString().slice(0, 10);
    if (buckets.has(day)) buckets.set(day, buckets.get(day) - row.delta_mcr);
  }
  return [...buckets].map(([day, mcr]) => ({ day, mcr }));
}
