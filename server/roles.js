// Welche Discord-Rolle wem zusteht.
//
// Das Panel entscheidet es, der Bot führt es aus – so gibt es nur eine Stelle, an der die Regeln
// stehen, und der Bot bleibt austauschbar.
//
// Es geht immer nur um **verwaltete** Rollen: die aus den Einstellungen und die, die an einem
// Tarif hängen. Alles andere, was jemand in Discord an Rollen trägt, fasst der Bot nicht an –
// sonst nähme er beim ersten Abgleich jedem seine Farbe weg.
//
// Zwei Regeln sind fest verdrahtet, weil sie in Discord und nicht hier zu Hause sind:
//   * Wer Admin oder Discord-Mod ist, bekommt zusätzlich die Team-Rolle.
//   * Wer sein Konto verknüpft hat, bekommt die Rolle dafür – unabhängig vom Tarif.

import { db, getSetting } from './db.js';
import { bridge } from './bridge.js';

const setting = (key) => String(getSetting(key) || '').trim();

/** Alle Rollen, die der Bot anfassen darf – mehr nicht, und in dieser Reihenfolge. */
export function managed() {
  const planRoles = db
    .prepare("SELECT id, slug, discord_role FROM plans WHERE discord_role IS NOT NULL AND discord_role != ''")
    .all();
  return {
    linked: setting('discord_role_linked'),
    premium: setting('discord_role_premium'),
    ultra: setting('discord_role_ultra'),
    team: setting('discord_role_team'),
    admin: setting('discord_role_admin'),
    mod: setting('discord_role_mod'),
    plans: Object.fromEntries(planRoles.map((plan) => [plan.id, String(plan.discord_role).trim()])),
  };
}

/** Die Menge aller Rollen-IDs, die der Bot verwalten darf. */
export function managedIds() {
  const roles = managed();
  return [
    roles.linked,
    roles.premium,
    roles.ultra,
    roles.team,
    ...Object.values(roles.plans),
  ].filter(Boolean);
}

/**
 * Der beste gültige Tarif eines Kontos.
 *
 * "Bester" heißt: der teuerste, der gerade läuft. Wer einen Ultra- und einen Premium-Platz hat,
 * ist Ultra-Kunde – zwei Rollen gleichzeitig wären in Discord nur verwirrend.
 */
export function bestPlan(userId) {
  return db
    .prepare(
      `SELECT pl.* FROM profiles p JOIN plans pl ON pl.id = p.plan_id
        WHERE p.user_id = ? AND p.suspended = 0 AND pl.free_slot = 0 AND p.paid_until > ?
        ORDER BY pl.price_credits DESC, pl.sort DESC LIMIT 1`
    )
    .get(userId, Date.now());
}

/**
 * Welche Rollen dieses Konto haben soll. Der Bot vergleicht das mit dem, was der Nutzer trägt,
 * und gleicht die Differenz innerhalb der verwalteten Rollen ab.
 */
export function targetFor(user) {
  const roles = managed();
  const wanted = new Set();
  if (!user?.discord_id) return { discord_id: null, roles: [] };

  if (roles.linked) wanted.add(roles.linked);

  const plan = bestPlan(user.id);
  if (plan) {
    // Am Tarif hinterlegt schlägt die allgemeine Einstellung – so lässt sich ein neuer Tarif mit
    // eigener Rolle anlegen, ohne dass jemand Code anfassen muss.
    const own = roles.plans[plan.id];
    if (own) wanted.add(own);
    else if (plan.slug === 'ultra' && roles.ultra) wanted.add(roles.ultra);
    else if (roles.premium) wanted.add(roles.premium);
  }

  return {
    discord_id: user.discord_id,
    user_id: user.id,
    username: user.username,
    plan: plan ? plan.slug : null,
    staff: user.role === 'admin',
    roles: [...wanted],
  };
}

export function targetForUserId(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return user ? targetFor(user) : null;
}

export const byDiscordId = (discordId) =>
  db.prepare('SELECT * FROM users WHERE discord_id = ?').get(String(discordId));

/**
 * Dem Bot sagen, dass sich für ein Konto etwas geändert hat.
 *
 * Der stündliche Abgleich würde es auch merken – aber wer gerade Premium gekauft hat, will die
 * Rolle jetzt und nicht in fünfzig Minuten.
 */
export function changed(userId) {
  const user = db.prepare('SELECT discord_id FROM users WHERE id = ?').get(userId);
  if (user?.discord_id) bridge.emit('roles.changed', { discord_id: user.discord_id, user_id: userId });
}

/** Alle verknüpften Konten mit ihren Soll-Rollen – für den vollständigen Abgleich des Bots. */
export function everyone() {
  return db
    .prepare('SELECT * FROM users WHERE discord_id IS NOT NULL AND blocked = 0')
    .all()
    .map(targetFor);
}
