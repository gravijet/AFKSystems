// Guthaben und Tarife.
//
// Es gibt kein Abo bei einem Zahlungsdienst und keine Rechnung, sondern ein Guthabenkonto:
// **1 Credit = 1 Cent**, 100 Credits = 1 Euro. Ausgegeben wird es nicht nach Stunden, sondern je
// Serverplatz und Monat – und ein Monat ist hier immer genau 30 Tage, damit der Preis auf der
// Seite und die Abbuchung im Kontoauszug dieselbe Zahl sind.
//
// Ein Serverplatz je Konto kostet nichts, solange ein verknüpftes Discord-Konto seine Mitgliedschaft
// im AFKSystems-Server bestätigt. Jeder weitere bekommt einen bezahlten Tarif; läuft er ab und es
// ist zu wenig Guthaben da, wird der Server stillgelegt (Bots aus) statt gelöscht.

import { db, cached, getSetting, audit } from './db.js';
import { voucherCode, bad, notFound } from './util.js';
import * as mail from './mail.js';
import * as notify from './notify.js';
import * as profile from './profile.js';
import * as vat from './vat.js';

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

/**
 * Guthaben ändern (positiv = gutschreiben, negativ = abbuchen). Gibt den neuen Stand zurück.
 *
 * **Unter null geht es hier nicht.** Das steht an einem Dutzend Stellen als Absicht im Text und war
 * an keiner einzigen durchgesetzt: Jeder Aufrufer prüfte selbst, ob das Guthaben reicht, und wer es
 * vergaß (oder zwischen Prüfung und Abbuchung etwas anderes abbuchte), schrieb einen negativen
 * Stand in die Datenbank. Ein negativer Stand ist keine Schuld, sondern ein kaputter Kontoauszug:
 * jede Rechnung, die auf „Guthaben ≥ Preis“ prüft, rechnet danach mit Vorzeichen, und der Kunde
 * lädt auf und sieht nichts davon. Deshalb ist es ab hier ein Fehler und keine stille Zahl.
 *
 * Wer bewusst nur nimmt, was da ist (Rückerstattung, Rücklastschrift), deckelt vorher selbst und
 * sagt es mit `allowZero` – siehe `refundTopup`.
 */
export const move = db.transaction((userId, delta, kind, note, ref = null) => {
  const user = readUser.get(userId);
  if (!user) throw notFound('Benutzer gibt es nicht.', { en: 'No such user.' });
  const amount = Math.round(Number(delta));
  if (!Number.isFinite(amount)) {
    throw bad('Ungültiger Betrag.', { en: 'Invalid amount.' });
  }
  const balance = user.credits + amount;
  if (balance < 0) {
    throw bad(
      `Zu wenig Guthaben: es fehlen ${-balance} Credits.`,
      { en: `Not enough credits: ${-balance} short.` }
    );
  }
  updateBalance.run(balance, userId);
  insertLedger.run(userId, amount, balance, kind, note || null, ref, Date.now());
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

/**
 * Tarife und Zusätze stehen einmal im Speicher.
 *
 * Drei Zeilen, geändert wird daran vielleicht einmal im Quartal – gelesen dagegen dauernd: Eine
 * einzige Antwort auf `/api/profiles` fragte den Tarif eines Serverplatzes sechsmal ab (einmal für
 * `planOf`, einmal in `featuresOf`, einmal in `monthlyPrice`, einmal in `isActive` …), und das je
 * Serverplatz. Bei acht Plätzen waren das fünfzig Abfragen für dreimal dieselbe Zeile.
 *
 * Der Zwischenspeicher fällt weg, sobald irgendwo in der Datenbank geschrieben wird – auch dann,
 * wenn es die Tarife gar nicht betraf. Das ist Absicht: So gibt es keine Liste von Stellen, die
 * eine Preisänderung melden müssen, und damit auch keine, die man vergessen kann. Siehe `cached`
 * in db.js.
 */
const planTable = cached(() => db.prepare('SELECT * FROM plans ORDER BY sort, id').all());
const addonTable = cached(() => db.prepare('SELECT * FROM addons ORDER BY sort, id').all());

export function plans({ includeInactive = false } = {}) {
  const all = planTable();
  return includeInactive ? all : all.filter((plan) => plan.active);
}

// `Number`/`String`: In SQL glich `WHERE id = ?` eine "3" aus einer Adresse noch mit der Zahl 3 ab,
// im Vergleich hier nicht mehr. Die Umwandlung hält genau diesen Unterschied heraus.
export const planById = (id) => planTable().find((plan) => plan.id === Number(id));
export const planBySlug = (slug) => planTable().find((plan) => plan.slug === String(slug));

export function freePlan() {
  return planTable().find((plan) => plan.free_slot && plan.active);
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

// ---------------------------------------------------------------- Zusätze
//
// Ein Zusatz hängt am Serverplatz, nicht am Konto: Wer auf einem Server die Anzeigetafel braucht
// und auf dem anderen nicht, soll auch nur einmal zahlen. Abgerechnet wird im selben Takt wie der
// Tarif – der Platz hat ein Ablaufdatum, und alles, was dranhängt, endet mit ihm.

export const addons = ({ includeInactive = false } = {}) => {
  const all = addonTable();
  return includeInactive ? all : all.filter((addon) => addon.active);
};

export const addonById = (id) => addonTable().find((addon) => addon.id === Number(id));
export const addonByKey = (key) => addonTable().find((addon) => addon.key === String(key));

/** Die gebuchten Zusätze eines Serverplatzes, jeweils mit Menge. */
export function addonsOf(profileId) {
  return db
    .prepare(
      `SELECT a.*, pa.qty FROM profile_addons pa JOIN addons a ON a.id = pa.addon_id
        WHERE pa.profile_id = ? ORDER BY a.sort, a.id`
    )
    .all(profileId);
}

/**
 * Tarif plus gebuchte Zusätze. Das ist das, woran sich alles andere hält – der rohe Tarif sagt
 * nur, womit jemand angefangen hat.
 *
 * `booked` darf mitgegeben werden, wenn der Aufrufer die Zusätze ohnehin schon geholt hat. Das ist
 * kein Umweg, sondern der Grund, warum diese Antwort schnell ist: Die Ansicht eines Serverplatzes
 * braucht dieselbe Liste dreimal – für die Fähigkeiten, für die Anzeige und für den Preis –, und
 * ohne diesen Weg wären das drei Abfragen je Platz statt einer. Im Profil war genau das der größte
 * Posten von /api/profiles.
 */
export function featuresOf(profile, booked = addonsOf(profile.id)) {
  const plan = planOf(profile);
  const merged = { ...plan };
  for (const entry of booked) {
    if (entry.kind === 'slot') merged.max_accounts += entry.amount * entry.qty;
    else if (entry.flag) merged[entry.flag] = 1;
  }
  return merged;
}

/**
 * Welche Fähigkeit hinter welchem Tarifmerkmal steht.
 *
 * Der Client sagt, was seine Bauform **könnte**; der Tarif sagt, was davon freigeschaltet ist.
 * Erst beides zusammen ergibt, was ein Serverplatz kann – ohne diese Tabelle hätte jeder mit dem
 * Premium-Client automatisch auch Anzeigetafel und Menüs, und zwischen Premium und Ultra bliebe
 * kein Unterschied.
 */
const CAP_GATES = {
  local: 'movement',
  movement: 'movement',
  sneak: 'premium',
  antiafk: 'premium',
  premium: 'premium',
  board: 'board',
  menu: 'menus',
  items: 'menus',
  proxy: 'proxy',
  fakehost: 'fakehost',
  offline: 'offline_accounts',
  pov: 'pov',
};

/** Fähigkeiten des Clients, beschnitten auf das, was der Tarif (samt Zusätzen) hergibt. */
export function gateCaps(clientCaps = {}, features = {}) {
  const out = {};
  for (const [key, value] of Object.entries(clientCaps)) {
    const gate = CAP_GATES[key];
    out[key] = Boolean(value) && (gate === undefined || Boolean(features[gate]));
  }
  return out;
}

/** Was ein Serverplatz je 30 Tage kostet: Tarif plus Zusätze. */
export function monthlyPrice(profile, booked = null) {
  const plan = planOf(profile);
  if (plan.free_slot) return 0;
  return (
    plan.price_credits +
    (booked ?? addonsOf(profile.id)).reduce((sum, entry) => sum + entry.price_credits * entry.qty, 0)
  );
}

/** Anteiliger Preis für den Rest der laufenden Periode – für Zusätze, die mittendrin dazukommen. */
export function proratedPrice(profile, credits) {
  const until = Number(profile.paid_until);
  const amount = Number(credits);
  // Ein kaputtes Datum oder ein kaputter Preis darf hier keine Zahl erzeugen, mit der danach
  // gerechnet und gebucht wird: `NaN` bindet SQLite nicht, und ein Preis von `NaN` bestünde jede
  // Prüfung "Guthaben < Preis" (jeder Vergleich mit NaN ist falsch).
  if (!Number.isFinite(until) || !until || !Number.isFinite(amount)) return 0;
  const left = until - Date.now();
  if (left <= 0) return 0;
  return Math.ceil((amount * Math.min(left, MONTH_MS)) / MONTH_MS);
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

/** Der Discord-Server, dessen Mitgliedschaft den Gratis-Tarif freischaltet. */
export const freeGuildId = () => String(getSetting('free_discord_guild_id') || '').trim();

/**
 * Darf ein Nutzer den Gratis-Tarif gerade ausführen?
 *
 * Der Bot meldet Beitritt/Austritt sofort und gleicht stündlich vollständig ab. Ein alter positiver
 * Wert darf trotzdem nicht unbegrenzt weitergelten, falls der Bot ausfällt: nach der eingestellten
 * Frist wird deshalb fail-closed gestoppt.
 */
export function freeAccess(userId, now = Date.now()) {
  const user = readUser.get(userId);
  const guildId = freeGuildId();
  const maxAge = Math.max(5, Number(getSetting('free_discord_check_minutes')) || 120) * 60_000;
  const checkedAt = Number(user?.discord_guild_checked_at) || 0;
  let reason = null;
  if (!guildId) reason = 'not-configured';
  else if (!user?.discord_id) reason = 'discord-link';
  else if (!checkedAt || now - checkedAt > maxAge) reason = 'discord-check';
  else if (!user.discord_guild_member) reason = 'discord-join';
  return {
    ok: !reason,
    reason,
    guild_id: guildId,
    discord_id: user?.discord_id || null,
    checked_at: checkedAt || null,
  };
}

/** Ist dieses Profil bezahlt und gültig? */
export function isActive(profile) {
  const plan = planOf(profile);
  if (profile.suspended) return false;
  if (plan.free_slot) return freeAccess(profile.user_id).ok;
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

/** Was ein Konto insgesamt im Monat kostet (nur gültige, bezahlte Plätze, Zusätze eingerechnet). */
export function monthlyCost(userId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(pl.price_credits + COALESCE(
                (SELECT SUM(a.price_credits * pa.qty) FROM profile_addons pa
                   JOIN addons a ON a.id = pa.addon_id WHERE pa.profile_id = p.id), 0)), 0) AS n
         FROM profiles p JOIN plans pl ON pl.id = p.plan_id
        WHERE p.user_id = ? AND pl.free_slot = 0 AND p.paid_until > ?`
    )
    .get(userId, Date.now()).n;
}

/**
 * Die Zusätze eines Platzes gelten als für die ganze laufende Periode bezahlt.
 *
 * Aufgerufen wird das genau dort, wo der volle Monatspreis abgebucht wurde: beim Tarifwechsel und
 * bei der Verlängerung. Ohne diese Zeile bliebe an einem Zusatz der anteilige Betrag stehen, mit
 * dem er einmal mittendrin dazugekauft wurde – und der Deckel in `removeAddon` gäbe nach einer
 * frisch bezahlten Verlängerung weniger zurück, als der Kunde eben bezahlt hat.
 */
function markAddonsPaidForPeriod(profileId) {
  db.prepare(
    `UPDATE profile_addons SET paid_credits =
       COALESCE((SELECT a.price_credits * profile_addons.qty FROM addons a
                  WHERE a.id = profile_addons.addon_id), 0)
      WHERE profile_id = ?`
  ).run(profileId);
}

/**
 * Guthaben-Rest eines Platzes, wenn er jetzt gewechselt oder gelöscht wird (abgerundet).
 *
 * Zwei Deckel, und beide sind nötig:
 *
 *   1. **Die Restzeit gilt höchstens einen Monat**, genau wie in `proratedPrice`. Ohne diesen
 *      Deckel war der Restwert „Monatspreis × Restzeit ÷ 30 Tage“, und das stimmt nur, solange die
 *      Restzeit nie über 30 Tage hinausgeht. Sie geht aber hinaus: Ein Administrator kann eine
 *      Laufzeit um bis zu zehn Jahre verlängern, und wer danach den Platz löschte, bekam den
 *      zwölffachen Monatspreis gutgeschrieben.
 *   2. **Nie mehr, als für diese Periode wirklich abgebucht wurde.** Dasselbe Verlängern ist
 *      ausdrücklich *ohne* Abbuchung gedacht – ein Geschenk der Verwaltung, kein Kauf. Mit dem
 *      ersten Deckel allein blieb daraus trotzdem echtes Guthaben: geschenkten Ultra-Platz
 *      anlegen lassen, sofort löschen, einen Monatspreis in Credits auf dem Konto. Credits sind
 *      Zahlungsmittel für alles Weitere, also war das Geld aus dem Nichts. `profiles.paid_credits`
 *      und `profile_addons.paid_credits` sagen, was hingegangen ist; mehr kommt nicht zurück.
 *
 * Getrennt gerechnet für Tarif und Zusätze, weil beide ihre eigene Erinnerung haben: Ein Zusatz,
 * der mitten in der Periode dazukam, hat auch nur den Rest der Periode gekostet.
 */
export function refundValue(profile) {
  const plan = planOf(profile);
  const until = Number(profile.paid_until);
  if (plan.free_slot || !Number.isFinite(until) || !until) return 0;
  const left = Math.min(until - Date.now(), MONTH_MS);
  if (left <= 0) return 0;
  /** Anteil an der Restzeit – abgerundet, denn zurück gibt es höchstens das Bezahlte. */
  const share = (amount) => Math.max(0, Math.floor((Math.max(0, amount) * left) / MONTH_MS));

  // Der Listenpreis von heute ist die zweite Obergrenze: Wurde der Tarif nach dem Kauf billiger,
  // kommt der neue Preis zurück und nicht der alte.
  const paidForPlan = Math.max(0, Number(profile.paid_credits) || 0);
  let refund = Math.min(share(plan.price_credits), share(paidForPlan));

  for (const entry of addonsOf(profile.id)) {
    const paid = Math.max(0, Number(entry.paid_credits) || 0);
    refund += Math.min(share(entry.price_credits * entry.qty), paid);
  }
  return refund;
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
    // Zusätze gibt es auf dem Gratis-Platz nicht – der Rest ist im Restguthaben schon drin.
    db.prepare('DELETE FROM profile_addons WHERE profile_id = ?').run(profile.id);
    db.prepare(
      'UPDATE profiles SET plan_id = ?, paid_until = NULL, suspended = 0, chat_limit = ?, paid_credits = 0 WHERE id = ?'
    ).run(plan.id, Math.min(profile.chat_limit || plan.chat_limit, plan.chat_limit), profile.id);
    audit(by ?? profile.user_id, 'plan-set', { profile: profile.id, plan: plan.slug });
    return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id);
  }

  const refund = current.free_slot ? 0 : refundValue(profile);

  // Was der neue Tarif schon von Haus aus mitbringt, muss niemand als Zusatz weiterbezahlen.
  for (const entry of addonsOf(profile.id)) {
    const redundant = entry.kind === 'flag' && entry.flag && plan[entry.flag];
    const forbidden = !plan.addons;
    if (redundant || forbidden) {
      db.prepare('DELETE FROM profile_addons WHERE profile_id = ? AND addon_id = ?').run(
        profile.id,
        entry.id
      );
    }
  }

  const price = plan.price_credits + addonsOf(profile.id).reduce((sum, e) => sum + e.price_credits * e.qty, 0);
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
  // Beim Wechsel vom Gratis-Platz gilt das Limit des gebuchten Tarifs sofort. Wer auf einem
  // bezahlten Platz bewusst einen kürzeren Verlauf eingestellt hat, behält diese Wahl.
  const chatLimit = current.free_slot
    ? plan.chat_limit
    : Math.min(profile.chat_limit || plan.chat_limit, plan.chat_limit);
  // `paid_credits` ist der Tarifanteil dieser Abbuchung – die Zusätze führen ihren eigenen Betrag
  // (siehe `markAddonsPaidForPeriod` gleich darunter). Beides zusammen ergibt genau `price`.
  db.prepare(
    'UPDATE profiles SET plan_id = ?, paid_until = ?, suspended = 0, renew = 1, chat_limit = ?, paid_credits = ? WHERE id = ?'
  ).run(
    plan.id,
    Date.now() + MONTH_MS,
    chatLimit,
    plan.price_credits,
    profile.id
  );
  // Der Preis oben enthielt die Zusätze zum vollen Monatspreis – dann steht das auch an ihnen.
  markAddonsPaidForPeriod(profile.id);
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
    // Ein Platz je Durchgang, und ein kaputter nimmt die anderen nicht mit. `move()` wirft, wenn
    // etwas nicht stimmt (fehlender Nutzer, unmöglicher Preis) – ohne diese Klammer blieb der
    // ganze Rest der fälligen Plätze bis zur nächsten Stunde liegen, und die Kunden dahinter
    // wussten nicht, warum ihre Bots standen.
    try {
      const result = renewOne(profile, now);
      if (result?.renewed) renewed.push(result.renewed);
      if (result?.suspended) suspended.push(result.suspended);
    } catch (error) {
      console.error(`[abrechnung] Serverplatz #${profile.id} ließ sich nicht abrechnen:`, error.message);
    }
  }
  return { renewed, suspended };
}

/**
 * Genau ein fälliger Serverplatz – verlängern oder stilllegen.
 *
 * Als eigene Transaktion, damit Abbuchung und neues Ablaufdatum zusammen gelten oder gar nicht.
 * Gemeldet wird über den Rückgabewert und nicht über eine mitgereichte Liste: Wird die Transaktion
 * zurückgerollt, soll auch nichts gemeldet worden sein.
 */
const renewOne = db.transaction((profile, now) => {
  const user = readUser.get(profile.user_id);
  if (!user) return null;
  // Der Preis kommt aus Tarif **und** Zusätzen – sonst liefe ein dazugekaufter Bot-Platz nach
  // dem ersten Monat gratis weiter.
  const price = monthlyPrice(profile);
  if (profile.renew && user.credits >= price) {
    move(
      profile.user_id,
      -price,
      'plan',
      `${profile.name_de} · ${profile.name} · Verlängerung`,
      String(profile.id)
    );
    // Ab jetzt weiterrechnen, nicht ab dem alten Ende – sonst schrumpft die Laufzeit bei
    // jedem Ausfall des Dienstes um die Zeit, die er stand.
    db.prepare('UPDATE profiles SET paid_until = ?, paid_credits = ? WHERE id = ?').run(
      now + MONTH_MS,
      profile.price_credits,
      profile.id
    );
    // `price` kam aus `monthlyPrice` und enthielt die Zusätze zum vollen Preis.
    markAddonsPaidForPeriod(profile.id);
    return { renewed: { userId: profile.user_id, profileId: profile.id, name: profile.name, price } };
  }
  db.prepare('UPDATE profiles SET suspended = 1 WHERE id = ?').run(profile.id);
  return {
    suspended: {
      userId: profile.user_id,
      profileId: profile.id,
      name: profile.name,
      reason: profile.renew ? 'no-credits' : 'cancelled',
    },
  };
});

/**
 * Wer läuft demnächst ab und hat zu wenig Guthaben? Grundlage für die Warnungen.
 *
 * Das Guthaben gehört mit in die Bedingung: ohne sie kam hier jeder Platz heraus, der demnächst
 * fällig ist, und der Nutzer bekam stündlich eine Nachricht darüber, dass alles in Ordnung ist.
 */
export function expiringSoon(days = 3) {
  const until = Date.now() + days * 86_400_000;
  // Der Vergleich steht als eigener Ausdruck da und nicht als Verweis auf den Spaltennamen oben.
  // `price_credits` gibt es zweimal: als Alias dieser Rechnung **und** als Spalte in `plans`. In
  // der WHERE-Bedingung gewinnt die Spalte – die Warnung rechnete also mit dem nackten Tarifpreis
  // und übersah genau die Fälle, in denen die dazugebuchten Zusätze das Guthaben sprengen. Wer
  // einen Tarif für 249 und Zusätze für 200 Credits fährt und 300 auf dem Konto hat, bekam keine
  // Warnung und stand am nächsten Morgen still.
  return db
    .prepare(
      `SELECT p.id, p.name, p.user_id, p.paid_until, p.renew, u.credits,
              pl.price_credits + COALESCE((SELECT SUM(a.price_credits * pa.qty)
                  FROM profile_addons pa JOIN addons a ON a.id = pa.addon_id
                 WHERE pa.profile_id = p.id), 0) AS price_credits
         FROM profiles p JOIN plans pl ON pl.id = p.plan_id JOIN users u ON u.id = p.user_id
        WHERE pl.free_slot = 0 AND p.suspended = 0 AND p.renew = 1
          AND p.paid_until BETWEEN ? AND ?
          AND u.credits < pl.price_credits + COALESCE((SELECT SUM(a.price_credits * pa.qty)
                  FROM profile_addons pa JOIN addons a ON a.id = pa.addon_id
                 WHERE pa.profile_id = p.id), 0)`
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

// ---------------------------------------------------------------- Zusätze buchen

/**
 * Einen Zusatz auf einen Serverplatz buchen. Bezahlt wird nur der Rest der laufenden Periode –
 * ab der nächsten Verlängerung steckt er im Monatspreis.
 */
export const addAddon = db.transaction((profile, addon, qty = 1) => {
  const plan = planOf(profile);
  if (plan.free_slot || !plan.addons) {
    throw bad('Auf dem kostenlosen Serverplatz gibt es keine Zusätze. Wähle vorher einen Tarif.', {
      en: 'The free server slot takes no extras. Pick a paid plan first.',
    });
  }
  // Auf einem stillgelegten Platz ist die Laufzeit abgelaufen: `proratedPrice` wäre 0, der Zusatz
  // also gratis, und beim Fortsetzen zahlte man ihn zwar mit – dazwischen aber stünde er
  // freigeschaltet da, ohne dass je etwas dafür abgebucht wurde. Erst fortsetzen, dann buchen.
  if (profile.suspended || !profile.paid_until || profile.paid_until <= Date.now()) {
    throw bad('Dieser Serverplatz läuft gerade nicht. Setze ihn zuerst fort.', {
      en: 'This server slot is not running. Resume it first.',
    });
  }
  if (!addon.active || !addon.available) {
    throw bad('Dieser Zusatz ist gerade nicht buchbar.', { en: 'That extra cannot be booked right now.' });
  }
  if (addon.kind === 'flag' && addon.flag && plan[addon.flag]) {
    throw bad('Das kann dieser Tarif schon.', { en: 'Your plan already includes that.' });
  }

  const have = db
    .prepare('SELECT qty, paid_credits FROM profile_addons WHERE profile_id = ? AND addon_id = ?')
    .get(profile.id, addon.id);
  const wanted = Math.max(1, Math.trunc(qty));
  const next = (have?.qty || 0) + wanted;
  if (next > addon.max_qty) {
    throw bad(`Von "${addon.name_de}" gehen höchstens ${addon.max_qty}.`, {
      en: `At most ${addon.max_qty} × "${addon.name_en}".`,
    });
  }

  const price = proratedPrice(profile, addon.price_credits * wanted);
  const user = readUser.get(profile.user_id);
  if (user.credits < price) {
    throw bad(`Zu wenig Guthaben: es fehlen ${price - user.credits} Credits.`, {
      en: `Not enough credits: ${price - user.credits} short.`,
    });
  }
  if (price > 0) {
    move(
      profile.user_id,
      -price,
      'addon',
      `${addon.name_de} · ${profile.name} · anteilig`,
      String(profile.id)
    );
  }
  // Was wirklich abgebucht wurde, bleibt am Eintrag stehen – daraus rechnet `removeAddon` seine
  // Gutschrift, und nicht aus dem Listenpreis von heute.
  const paid = (have?.paid_credits || 0) + price;
  db.prepare(
    `INSERT INTO profile_addons (profile_id, addon_id, qty, paid_credits, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(profile_id, addon_id) DO UPDATE SET qty = ?, paid_credits = ?`
  ).run(profile.id, addon.id, next, paid, Date.now(), next, paid);
  audit(profile.user_id, 'addon-add', { profile: profile.id, addon: addon.key, qty: next, price });
  return { qty: next, charged: price, balance: balance(profile.user_id) };
});

/**
 * Einen Zusatz abbestellen. Der nicht verbrauchte Rest kommt aufs Guthaben zurück.
 *
 * **Höchstens das, was dafür bezahlt wurde.** Vorher stand hier der anteilige *Listenpreis von
 * heute*, ganz gleich, ob je etwas abgebucht worden war. Zwei Wege führten damit zu Credits aus
 * dem Nichts: Ein Zusatz, den die Verwaltung von Hand auf einen Platz legte (`POST
 * /admin/servers/:id/addons` bucht bewusst nichts ab), ließ sich vom Kunden sofort gegen echtes
 * Guthaben abbestellen; und wurde ein Preis nachträglich erhöht, bekam jeder Altbucher die
 * Differenz geschenkt. `paid_credits` sagt, was der Platz für diese Stücke wirklich gezahlt hat –
 * mehr kann nicht zurückkommen.
 */
export const removeAddon = db.transaction((profile, addon, qty = 1) => {
  const have = db
    .prepare('SELECT qty, paid_credits FROM profile_addons WHERE profile_id = ? AND addon_id = ?')
    .get(profile.id, addon.id);
  if (!have) throw notFound('Dieser Zusatz ist nicht gebucht.', { en: 'That extra is not booked.' });
  const drop = Math.min(have.qty, Math.max(1, Math.trunc(qty)));
  const rest = have.qty - drop;
  // Der Anteil am Bezahlten, der auf die abbestellten Stücke entfällt.
  const paidShare = Math.floor((Math.max(0, have.paid_credits || 0) * drop) / have.qty);
  if (rest > 0) {
    db.prepare(
      'UPDATE profile_addons SET qty = ?, paid_credits = ? WHERE profile_id = ? AND addon_id = ?'
    ).run(rest, Math.max(0, (have.paid_credits || 0) - paidShare), profile.id, addon.id);
  } else {
    db.prepare('DELETE FROM profile_addons WHERE profile_id = ? AND addon_id = ?').run(
      profile.id,
      addon.id
    );
  }
  const refund = Math.min(proratedPrice(profile, addon.price_credits * drop), paidShare);
  if (refund > 0) {
    move(profile.user_id, refund, 'refund', `${addon.name_de} · ${profile.name} · Rest`, String(profile.id));
  }
  audit(profile.user_id, 'addon-remove', { profile: profile.id, addon: addon.key, qty: drop, refund });
  return { qty: rest, refund, balance: balance(profile.user_id) };
});

// ---------------------------------------------------------------- Gutscheine

export function createVoucher({ credits, uses = 1, note = '', createdBy = null, expiresAt = null }) {
  const code = voucherCode();
  db.prepare(
    `INSERT INTO vouchers (code, credits, uses_left, note, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(code, Math.round(credits), uses, note || null, createdBy, Date.now(), expiresAt);
  return db.prepare('SELECT * FROM vouchers WHERE code = ?').get(code);
}

/**
 * Einen Gutschein einlösen.
 *
 * Drei Dinge, die vorher fehlten und jedes für sich Guthaben verschenkt haben:
 *
 *   1. **Einmal je Konto.** `uses_left` zählt Einlösungen, nicht Personen. Ein Gutschein für
 *      hundert Leute war deshalb ein Knopf, den ein einziges Konto hundertmal drücken konnte –
 *      hundertmal Guthaben aus einem Code, der für eine Aktion gedacht war. Wer schon eingelöst
 *      hat, steht ab jetzt in `voucher_redemptions`.
 *   2. **Der Zähler wird in der Bedingung geprüft, nicht davor.** `SET uses_left = uses_left - 1`
 *      ohne `WHERE uses_left > 0` zählt fröhlich ins Negative, sobald zwei Anfragen zwischen Lesen
 *      und Schreiben aneinander vorbeikommen.
 *   3. **Kein negatives Guthaben.** Ein Gutschein über einen negativen Betrag (Tippfehler in der
 *      Verwaltung) hätte hier abgebucht statt gutgeschrieben.
 */
export const redeemVoucher = db.transaction((userId, rawCode) => {
  const code = String(rawCode || '').trim().toUpperCase();
  const voucher = db.prepare('SELECT * FROM vouchers WHERE code = ?').get(code);
  if (!voucher) throw bad('Diesen Gutscheincode gibt es nicht.', { en: 'No such voucher code.' });
  if (voucher.expires_at && voucher.expires_at < Date.now()) {
    throw bad('Dieser Gutschein ist abgelaufen.', { en: 'That voucher has expired.' });
  }
  if (
    db.prepare('SELECT 1 FROM voucher_redemptions WHERE code = ? AND user_id = ?').get(code, userId)
  ) {
    throw bad('Diesen Gutschein hast du schon eingelöst.', {
      en: 'You have already redeemed that voucher.',
    });
  }
  const credits = Math.max(0, Math.round(Number(voucher.credits) || 0));
  if (credits <= 0) {
    throw bad('Dieser Gutschein bringt kein Guthaben.', { en: 'That voucher carries no credits.' });
  }
  const taken = db
    .prepare('UPDATE vouchers SET uses_left = uses_left - 1 WHERE code = ? AND uses_left > 0')
    .run(code).changes;
  if (!taken) throw bad('Dieser Gutschein ist schon eingelöst.', { en: 'That voucher is used up.' });
  db.prepare(
    'INSERT INTO voucher_redemptions (code, user_id, credits, created_at) VALUES (?, ?, ?, ?)'
  ).run(code, userId, credits, Date.now());
  const after = move(userId, credits, 'voucher', `Gutschein ${code}`, code);
  audit(userId, 'voucher-redeem', { code, credits });
  return { credits, balance: after };
});

// ---------------------------------------------------------------- Aufladungen

/**
 * Aufladepakete aus den Einstellungen, um Euro-Preis und Bonus ergänzt.
 *
 * Die Werte kommen aus einer JSON-Spalte und sind damit alles, was jemals dort hineingeschrieben
 * wurde – auch aus einer Fassung vor der heutigen Prüfung. Ein Paket ohne Betrag hätte hier eine
 * Aufladung über `NaN` Cent erzeugt: `createTopup` schreibt sie, die Datenbank nimmt sie, und im
 * Kontoauszug steht danach eine Zeile, die niemand mehr zuordnen kann. Was nicht rechnet, fällt
 * deshalb hier heraus, statt später Geld zu berühren.
 */
export function packages() {
  const raw = getSetting('packages');
  const list = (Array.isArray(raw) ? raw : []).filter((entry) => {
    const cent = Math.round(Number(entry?.cent));
    const credits = Math.round(Number(entry?.credits));
    return Number.isFinite(cent) && cent > 0 && Number.isFinite(credits) && credits > 0;
  });
  return list.map((entry, index) => ({
    index,
    cent: Math.round(Number(entry.cent)),
    credits: Math.round(Number(entry.credits)),
    label: entry.label || `${(entry.cent / 100).toFixed(2)} €`,
    euro: (entry.cent / 100).toFixed(2),
    bonus: Math.max(0, Math.round(Number(entry.credits)) - Math.round(Number(entry.cent))),
  }));
}

export function createTopup({ userId, provider, amountCent, credits, reference = null, externalId = null }) {
  // Eine Aufladung ohne Betrag ist keine. Sie hier abzulehnen ist die letzte Stelle, an der das
  // ohne Folgen geht – danach steht sie im Kontoauszug und wartet auf eine Zahlung, die zu ihr
  // nicht passen kann.
  const cents = Math.round(Number(amountCent));
  const value = Math.round(Number(credits));
  if (!Number.isFinite(cents) || cents <= 0 || !Number.isFinite(value) || value <= 0) {
    throw bad('Dieses Aufladepaket ist nicht gültig eingerichtet.', {
      en: 'That top-up package is not set up correctly.',
    });
  }
  const info = db
    .prepare(
      `INSERT INTO topups (user_id, provider, amount_cent, credits, status, reference, external_id, created_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`
    )
    .run(userId, provider, cents, value, reference, externalId, Date.now());
  return db.prepare('SELECT * FROM topups WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * Die nächste Belegnummer: `AFK-2026-0001`.
 *
 * Fortlaufend **je Jahr**, mit vier Stellen und ohne Lücken, solange nichts gelöscht wird. Gezählt
 * wird, was es schon gibt, und nicht ein Zähler in den Einstellungen: Ein Zähler, der neben den
 * Daten steht, geht bei einer Wiederherstellung aus einer Sicherung auseinander, und dann gäbe es
 * eine Nummer zweimal. Die Belege selbst sind die Wahrheit darüber, wie viele es gibt.
 */
export function nextReceiptNumber(at = Date.now()) {
  const year = new Date(at).getFullYear();
  const prefix = `AFK-${year}-`;
  // **Beide Tabellen.** Ein gelöschtes Konto nimmt seine Aufladungen mit (`ON DELETE CASCADE`),
  // seine Belege aber nicht: die stehen danach im Archiv (Migration 025). Zählte hier nur
  // `topups`, ginge die Nummer nach jeder Kontolöschung zurück und wäre ein zweites Mal vergeben –
  // in zwei Tabellen, zwischen denen niemand mehr die Verbindung sieht.
  const used =
    db.prepare('SELECT COUNT(*) AS n FROM topups WHERE receipt_no LIKE ?').get(`${prefix}%`).n +
    db.prepare('SELECT COUNT(*) AS n FROM receipt_archive WHERE receipt_no LIKE ?').get(`${prefix}%`).n;
  return `${prefix}${String(used + 1).padStart(4, '0')}`;
}

const settle = db.transaction((topupId, note = '', force = false) => {
  const topup = db.prepare('SELECT * FROM topups WHERE id = ?').get(topupId);
  if (!topup) throw notFound('Aufladung gibt es nicht.', { en: 'No such top-up.' });
  // Schon gebucht **oder schon zurückgenommen**: In beiden Fällen darf hier nichts mehr entstehen.
  // Ohne den zweiten Fall schrieb ein Klick auf „als bezahlt buchen“ eine zurückerstattete
  // Aufladung ein zweites Mal gut – das Geld war weg und die Credits waren wieder da.
  //
  // **Abgebrochen zählt genauso.** Eine Aufladung, die der Kunde selbst zurückgezogen hat
  // (`DELETE /billing/topup/:id`), ist erledigt. Sie danach noch zu buchen hieße: Guthaben für
  // einen Vorgang, den beide Seiten für beendet hielten – und weil das Abbrechen dem Kunden offen
  // steht, war das ein Weg, den er selbst öffnen konnte. Kommt das Geld dennoch später an (eine
  // Überweisung, die schon unterwegs war), bucht die Verwaltung sie mit „trotzdem buchen“ – dann
  // steht eine Entscheidung eines Menschen dahinter und nicht ein Klick des Kunden.
  if (topup.status === 'paid' || topup.status === 'refunded') return { topup, already: true };
  if (topup.status === 'cancelled' && !force) return { topup, already: true };

  // **Der Beleg entsteht hier und nur hier.** Genau in dem Moment, in dem aus einer Bestellung
  // eine Zahlung wird, bekommt sie ihre Nummer und einen Abzug der Rechnungsdaten. Beides ist ab
  // dann unveränderlich: Wer im Januar unter seiner alten Anschrift gekauft hat und im März
  // umzieht, hat trotzdem im Januar unter der alten gekauft – ein Beleg, der auf das Konto
  // verweist, änderte rückwirkend jede Rechnung des Vorjahres.
  //
  // Die Nummer ist fortlaufend je Jahr. Sie wird in derselben Transaktion vergeben wie die
  // Buchung, also kann es sie nie zweimal geben – und ein `UNIQUE`-Index steht zusätzlich davor.
  const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(topup.user_id);
  const paidAt = Date.now();
  const receipt = topup.receipt_no || nextReceiptNumber(paidAt);
  db.prepare(
    `UPDATE topups SET status = 'paid', paid_at = ?, receipt_no = ?,
            billed_to = COALESCE(billed_to, ?), vat_note = COALESCE(vat_note, ?)
      WHERE id = ?`
  ).run(
    paidAt,
    receipt,
    JSON.stringify(profile.billingSnapshot(buyer || {})),
    vat.note(buyer?.language === 'en' ? 'en' : 'de'),
    topupId
  );
  const balance = move(
    topup.user_id,
    topup.credits,
    'topup',
    note || `Aufladung ${(topup.amount_cent / 100).toFixed(2)} € (${topup.provider})`,
    String(topupId)
  );
  audit(topup.user_id, 'topup-paid', { id: topupId, provider: topup.provider });
  return { topup: db.prepare('SELECT * FROM topups WHERE id = ?').get(topupId), balance, already: false };
});

/**
 * Eine Aufladung als bezahlt verbuchen.
 *
 * Der Beleg per E-Mail gehört dazu und steht deshalb hier und nicht an den drei Stellen, die
 * aufladen können (Stripe-Webhook, Admin-Bestätigung, Gutschrift von Hand). Er geht nach der
 * Transaktion raus – ein hängender Mailserver darf keine Buchung aufhalten.
 */
export function settleTopup(topupId, note = '', { force = false } = {}) {
  const { topup, balance, already } = settle(topupId, note, force);
  if (!already) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(topup.user_id);
    if (user) {
      mail.sendTo(user, 'topup', {
        credits: topup.credits,
        amount_cent: topup.amount_cent,
        balance,
      });
      // Und über Discord, wenn ein Webhook hinterlegt ist. Zwischen dem Bezahlen bei Stripe und der
      // Gutschrift liegen Sekunden bis Minuten – wer in dieser Zeit nicht im Panel sitzt, erfährt
      // sonst gar nicht, dass sein Geld angekommen ist.
      notify.topupPaid(user.id, topup.credits, balance);
    }
  }
  return topup;
}

export function cancelTopup(topupId) {
  db.prepare("UPDATE topups SET status = 'cancelled' WHERE id = ? AND status = 'open'").run(topupId);
}

/**
 * Eine bezahlte Aufladung zurücknehmen – Rückerstattung, Rücklastschrift, verlorener Fall.
 *
 * Abgezogen wird höchstens, was noch da ist: **ins Minus geht es hier nie**, das ist im ganzen
 * Panel so und bleibt auch hier so. Was nicht mehr abzuziehen war, steht in der Rückgabe und
 * gehört auf den Tisch des Betreibers, nicht in eine stille Schuld beim Kunden.
 */
export const refundTopup = db.transaction((topupId, note = '') => {
  const topup = db.prepare('SELECT * FROM topups WHERE id = ?').get(topupId);
  if (!topup) throw notFound('Aufladung gibt es nicht.', { en: 'No such top-up.' });
  if (topup.status === 'refunded') return { topup, taken: 0, missing: 0, already: true };
  // **Nur eine bezahlte Aufladung wird zurückgenommen.** Vorher wurde der Zustand *vor* dieser
  // Prüfung auf "refunded" gesetzt – eine noch offene Aufladung war damit für immer tot, und
  // `settleTopup` verweigerte sie später zu Recht. Das traf den echten Fall: Stripe meldet einen
  // eröffneten Streitfall oder eine Rücklastschrift zu einem Vorgang, dessen Zahlungsmeldung noch
  // unterwegs ist. Das Geld kam an, die Credits nie.
  if (topup.status !== 'paid') {
    db.prepare("UPDATE topups SET status = 'cancelled' WHERE id = ? AND status = 'open'").run(topupId);
    return {
      topup: db.prepare('SELECT * FROM topups WHERE id = ?').get(topupId),
      taken: 0,
      missing: 0,
      already: false,
    };
  }
  db.prepare("UPDATE topups SET status = 'refunded' WHERE id = ?").run(topupId);

  const have = balance(topup.user_id);
  const take = Math.min(have, topup.credits);
  if (take > 0) {
    move(topup.user_id, -take, 'refund', note || `Rückerstattung ${(topup.amount_cent / 100).toFixed(2)} €`, String(topupId));
  }
  audit(topup.user_id, 'topup-refunded', { id: topupId, taken: take, missing: topup.credits - take });
  return {
    topup: db.prepare('SELECT * FROM topups WHERE id = ?').get(topupId),
    taken: take,
    missing: topup.credits - take,
    already: false,
  };
});

// ---------------------------------------------------------------- Auswertung

export function history(userId, limit = 60) {
  return db.prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
}

/**
 * Der Guthabenstand je Tag – für die Kurve im Guthaben-Bereich.
 *
 * Gerechnet wird **nicht** aus den Bewegungen, sondern gelesen: `ledger.balance` hält an jeder
 * Zeile den Stand danach fest. Der Stand eines Tages ist damit der der letzten Bewegung dieses
 * Tages, und Tage ohne Bewegung erben den Stand des Vortages. Aus den Beträgen zu summieren
 * hieße dagegen, dieselbe Rechnung ein zweites Mal zu schreiben – und zwei Rechnungen für
 * dieselbe Zahl gehen irgendwann auseinander.
 *
 * Vor der ersten Bewegung im Zeitraum steht der Stand, den das Konto damals hatte: der Stand
 * *vor* der ersten Bewegung danach (`balance - delta`), sonst der heutige.
 */
export function balanceByDay(userId, days = 30) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const from = start.getTime();

  const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const rows = db
    .prepare('SELECT created_at, balance, delta FROM ledger WHERE user_id = ? AND created_at >= ? ORDER BY id')
    .all(userId, from);

  const lastOfDay = new Map();
  for (const row of rows) lastOfDay.set(key(new Date(row.created_at)), row.balance);

  // Womit die Kurve beginnt: der Stand vor der ersten Bewegung im Zeitraum.
  let running = rows.length ? rows[0].balance - rows[0].delta : balance(userId);
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const name = key(date);
    if (lastOfDay.has(name)) running = lastOfDay.get(name);
    out.push({ day: name, credits: running });
  }
  return out;
}

/**
 * Wofür das Guthaben draufgeht – je Art, über die letzten Monate.
 *
 * Nur Abbuchungen: Aufladungen und Gutschriften stehen im Kontoauszug und gehören nicht in eine
 * Frage, die "wohin ist es gegangen" heißt.
 */
export function spendByKind(userId, months = 6) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  start.setMonth(start.getMonth() - (months - 1));
  const rows = db
    .prepare('SELECT kind, SUM(-delta) AS credits FROM ledger WHERE user_id = ? AND delta < 0 AND created_at >= ? GROUP BY kind')
    .all(userId, start.getTime());
  return rows.map((row) => ({ kind: row.kind, credits: row.credits })).sort((a, b) => b.credits - a.credits);
}

/** Ausgaben je Monat für die kleine Kurve im Guthaben-Bereich. */
export function spendByMonth(userId, months = 6) {
  const rows = db
    .prepare("SELECT created_at, delta FROM ledger WHERE user_id = ? AND kind = 'plan' AND delta < 0")
    .all(userId);
  // Beide Seiten in Ortszeit rechnen. Über toISOString() gingen die Körbe in jeder Zeitzone
  // östlich von UTC um einen Monat daneben: der 1. um 00:00 Uhr in Berlin ist dort noch der
  // Vormonat, 22:00 Uhr.
  const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const buckets = new Map();
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    buckets.set(key(new Date(now.getFullYear(), now.getMonth() - i, 1)), 0);
  }
  for (const row of rows) {
    const month = key(new Date(row.created_at));
    if (buckets.has(month)) buckets.set(month, buckets.get(month) - row.delta);
  }
  return [...buckets].map(([month, credits]) => ({ month, credits }));
}
