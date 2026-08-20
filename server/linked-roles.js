// Discords „Linked Roles“ – welche Bedingungen es gibt und was hinter ihnen steckt.
//
// Eine Linked Role vergibt **Discord**, nicht der Bot. Discord fragt dazu für jedes verknüpfte
// Konto eine Handvoll Zahlen und Ja/Nein-Werte bei uns ab; im Rollen-Dialog stellt der Betreiber
// dann eine Bedingung darauf ein („Premium ist Ja“). Wir liefern nur die Werte.
//
// Vorher standen die beiden Merkmale (Administrator, Discord Moderator) fest im Quelltext. Wer
// eine dritte Bedingung wollte – „mindestens ein bezahlter Server“, „seit 90 Tagen dabei“ –,
// musste den Code anfassen und neu ausrollen. Jetzt stehen sie in den Einstellungen: Schlüssel,
// Name, Beschreibung, Vergleichsart und **woher der Wert kommt**.
//
// Das letzte ist der Kern. Ein Name allein sagt nichts darüber, was verglichen wird; ein frei
// eingetippter Schlüssel wäre für Discord bloß ein Feld, das immer leer bleibt. Deshalb wählt der
// Betreiber aus den Quellen unten aus – alles, was das Panel über ein Konto sicher weiß.
//
// Zwei Grenzen kommen von Discord und lassen sich nicht verhandeln:
//   * höchstens **fünf** Merkmale je Anwendung,
//   * der Schlüssel besteht aus Kleinbuchstaben, Ziffern und Unterstrich.

import { db, getSetting } from './db.js';
import { bestPlan } from './roles.js';

/** Discord nimmt nicht mehr als fünf Merkmale je Anwendung an. */
export const MAX_FIELDS = 5;

const DAY = 86_400_000;

/**
 * Die Vergleichsarten, die Discord kennt.
 *
 * `kind` sagt, welche Art von Wert dazugehört – eine Zahl lässt sich nicht mit „ist Ja“
 * vergleichen, und ein Datum nicht mit „ist mindestens 3“. Das Panel lässt deshalb nur
 * Kombinationen zu, die zusammenpassen.
 */
export const TYPES = [
  { value: 2, kind: 'number', de: 'Zahl ist mindestens …', en: 'Number is at least …' },
  { value: 1, kind: 'number', de: 'Zahl ist höchstens …', en: 'Number is at most …' },
  { value: 3, kind: 'number', de: 'Zahl ist genau …', en: 'Number equals …' },
  { value: 4, kind: 'number', de: 'Zahl ist nicht …', en: 'Number does not equal …' },
  { value: 6, kind: 'date', de: 'Datum liegt mindestens … Tage zurück', en: 'Date is at least … days ago' },
  { value: 5, kind: 'date', de: 'Datum liegt höchstens … Tage zurück', en: 'Date is at most … days ago' },
  { value: 7, kind: 'boolean', de: 'Ja/Nein ist gleich', en: 'Yes/no equals' },
  { value: 8, kind: 'boolean', de: 'Ja/Nein ist ungleich', en: 'Yes/no does not equal' },
];

export const typeByValue = Object.fromEntries(TYPES.map((entry) => [entry.value, entry]));

// ---------------------------------------------------------------- Quellen

const flag = (value) => (value ? 1 : 0);
const days = (from) => (from ? Math.max(0, Math.floor((Date.now() - Number(from)) / DAY)) : 0);
const isoDay = (at) => new Date(Number(at) || Date.now()).toISOString();

const count = (sql, ...args) => Number(db.prepare(sql).get(...args)?.n || 0);

/**
 * Woraus ein Merkmal seinen Wert zieht.
 *
 * Jede Quelle bekommt das Konto und gibt genau einen Wert zurück – eine 0/1 für Ja/Nein, eine
 * ganze Zahl, oder ein Datum als ISO-Zeichenkette. Was hier nicht steht, kann Discord nicht
 * abfragen; das ist Absicht, denn jedes Feld verlässt das Haus und landet bei Discord.
 */
export const SOURCES = [
  {
    key: 'administrator',
    kind: 'boolean',
    de: { label: 'Administrator', help: 'Das Panel-Konto hat die Rolle „Administrator“.' },
    en: { label: 'Administrator', help: 'The panel account has the administrator role.' },
    value: (user) => flag(user.role === 'admin'),
  },
  {
    key: 'discord_moderator',
    kind: 'boolean',
    de: { label: 'Discord-Moderator', help: 'Im Benutzerprofil als Discord-Moderator gesetzt.' },
    en: { label: 'Discord moderator', help: 'Marked as a Discord moderator in the user profile.' },
    value: (user) => flag(user.discord_moderator),
  },
  {
    key: 'team',
    kind: 'boolean',
    de: { label: 'Team', help: 'Administrator oder Discord-Moderator – beides zusammen.' },
    en: { label: 'Team', help: 'Administrator or Discord moderator – either one.' },
    value: (user) => flag(user.role === 'admin' || user.discord_moderator),
  },
  {
    key: 'partner',
    kind: 'boolean',
    de: { label: 'Partner', help: 'Im Benutzerprofil vergeben.' },
    en: { label: 'Partner', help: 'Assigned in the user profile.' },
    value: (user) => flag(user.discord_partner),
  },
  {
    key: 'vip',
    kind: 'boolean',
    de: { label: 'VIP', help: 'Im Benutzerprofil vergeben.' },
    en: { label: 'VIP', help: 'Assigned in the user profile.' },
    value: (user) => flag(user.discord_vip),
  },
  {
    key: 'customer',
    kind: 'boolean',
    de: { label: 'Konto verknüpft', help: 'Es gibt ein Panel-Konto zu diesem Discord-Konto.' },
    en: { label: 'Account linked', help: 'There is a panel account for this Discord account.' },
    value: (user) => flag(user.discord_id),
  },
  {
    key: 'premium',
    kind: 'boolean',
    de: { label: 'Bezahlter Tarif läuft', help: 'Mindestens ein bezahlter Serverplatz ist gültig.' },
    en: { label: 'Paid plan running', help: 'At least one paid server slot is valid.' },
    value: (user) =>
      flag(bestPlan(user.id) || (user.premium_until && user.premium_until > Date.now())),
  },
  {
    key: 'ultra',
    kind: 'boolean',
    de: { label: 'Ultra-Tarif läuft', help: 'Der beste gültige Tarif ist Ultra.' },
    en: { label: 'Ultra plan running', help: 'The best valid plan is Ultra.' },
    value: (user) => flag(bestPlan(user.id)?.slug === 'ultra'),
  },
  {
    key: 'guild_member',
    kind: 'boolean',
    de: { label: 'Auf dem Pflichtserver', help: 'Zuletzt als Mitglied des Gratis-Pflichtservers gesehen.' },
    en: { label: 'On the required server', help: 'Last seen as a member of the required free-plan guild.' },
    value: (user) => flag(user.discord_guild_member),
  },
  {
    key: 'email_verified',
    kind: 'boolean',
    de: { label: 'E-Mail bestätigt', help: 'Die Adresse des Kontos ist bestätigt.' },
    en: { label: 'Email confirmed', help: "The account's address is confirmed." },
    value: (user) => flag(user.email_verified),
  },
  {
    key: 'credits',
    kind: 'number',
    de: { label: 'Guthaben in Credits', help: '1 Credit = 1 Cent.' },
    en: { label: 'Balance in credits', help: '1 credit = 1 cent.' },
    value: (user) => Math.max(0, Number(user.credits) || 0),
  },
  {
    key: 'servers',
    kind: 'number',
    de: { label: 'Serverplätze', help: 'Wie viele Plätze das Konto hat – bezahlte und kostenlose.' },
    en: { label: 'Server slots', help: 'How many slots the account has – paid and free.' },
    value: (user) => count('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?', user.id),
  },
  {
    key: 'paid_servers',
    kind: 'number',
    de: { label: 'Bezahlte Serverplätze', help: 'Nur gültige, nicht stillgelegte Plätze mit einem bezahlten Tarif.' },
    en: { label: 'Paid server slots', help: 'Only valid, non-suspended slots on a paid plan.' },
    value: (user) =>
      count(
        `SELECT COUNT(*) AS n FROM profiles p JOIN plans pl ON pl.id = p.plan_id
          WHERE p.user_id = ? AND p.suspended = 0 AND p.locked = 0
            AND pl.free_slot = 0 AND p.paid_until > ?`,
        user.id,
        Date.now()
      ),
  },
  {
    key: 'plan_days',
    kind: 'number',
    de: { label: 'Resttage im Tarif', help: 'Tage, die der am längsten laufende bezahlte Platz noch hat.' },
    en: { label: 'Days left on the plan', help: 'Days remaining on the longest-running paid slot.' },
    value: (user) => {
      const until = db
        .prepare(
          `SELECT MAX(p.paid_until) AS until FROM profiles p JOIN plans pl ON pl.id = p.plan_id
            WHERE p.user_id = ? AND p.suspended = 0 AND pl.free_slot = 0`
        )
        .get(user.id)?.until;
      return until ? Math.max(0, Math.ceil((Number(until) - Date.now()) / DAY)) : 0;
    },
  },
  {
    key: 'account_age_days',
    kind: 'number',
    de: { label: 'Kontoalter in Tagen', help: 'Tage seit der Registrierung.' },
    en: { label: 'Account age in days', help: 'Days since the account was created.' },
    value: (user) => days(user.created_at),
  },
  {
    key: 'member_since',
    kind: 'date',
    de: { label: 'Kunde seit', help: 'Der Tag der Registrierung. Discord vergleicht in Tagen.' },
    en: { label: 'Customer since', help: 'The day the account was created. Discord compares in days.' },
    value: (user) => isoDay(user.created_at),
  },
  {
    key: 'plan_until',
    kind: 'date',
    de: { label: 'Tarif läuft bis', help: 'Ende des am längsten laufenden bezahlten Platzes.' },
    en: { label: 'Plan runs until', help: 'End of the longest-running paid slot.' },
    value: (user) => {
      const until = db
        .prepare(
          `SELECT MAX(p.paid_until) AS until FROM profiles p JOIN plans pl ON pl.id = p.plan_id
            WHERE p.user_id = ? AND p.suspended = 0 AND pl.free_slot = 0`
        )
        .get(user.id)?.until;
      return isoDay(until || Date.now());
    },
  },
];

export const sourceByKey = Object.fromEntries(SOURCES.map((entry) => [entry.key, entry]));

// ---------------------------------------------------------------- Merkmale

/**
 * Was ohne eigene Einstellung gilt: genau das, was vorher fest im Quelltext stand. Eine
 * bestehende Installation merkt vom Umbau also nichts, bis jemand etwas ändert.
 */
export const DEFAULT_FIELDS = [
  {
    key: 'administrator',
    source: 'administrator',
    type: 7,
    name: 'Administrator',
    description: 'Runs the panel.',
  },
  {
    key: 'discord_moderator',
    source: 'discord_moderator',
    type: 7,
    name: 'Discord Moderator',
    description: 'Moderates the Discord server.',
  },
];

const KEY_PATTERN = /^[a-z0-9_]{1,50}$/;

/**
 * Ein Eintrag aus den Einstellungen in die Form bringen, in der er benutzbar ist. Was nicht
 * zusammenpasst, fliegt raus statt in einen halben Zustand zu geraten: ein Merkmal ohne gültige
 * Quelle würde bei Discord als Feld stehen, das nie einen Wert bekommt.
 */
/** Nachschlagen ohne Prototypenkette: `constructor` ist kein eingerichtetes Merkmal. */
const lookup = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

function clean(entry) {
  const key = String(entry?.key || '').trim().toLowerCase();
  const source = lookup(sourceByKey, String(entry?.source || '').trim());
  const type = lookup(typeByValue, String(Number(entry?.type)));
  if (!KEY_PATTERN.test(key) || !source || !type) return null;
  if (type.kind !== source.kind) return null;
  return {
    key,
    source: source.key,
    type: type.value,
    // Discords Grenzen: Name 100, Beschreibung 200 Zeichen. Leer geht nicht – dann zeigt der
    // Rollen-Dialog eine Bedingung ohne Beschriftung.
    name: (String(entry?.name || '').trim() || source.de.label).slice(0, 100),
    description: (String(entry?.description || '').trim() || source.de.help).slice(0, 200),
  };
}

/**
 * Die eingestellten Merkmale, geprüft und entdoppelt.
 *
 * Ohne eigene Einstellung gelten die Vorgaben. Eine **leere Liste** ist dagegen eine Aussage:
 * „ich will keine Linked Roles“ – die wird respektiert.
 */
export function fields() {
  const stored = getSetting('discord_role_metadata');
  if (!Array.isArray(stored)) return DEFAULT_FIELDS.map(clean).filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const entry of stored) {
    const field = clean(entry);
    if (!field || seen.has(field.key)) continue;
    seen.add(field.key);
    out.push(field);
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/** Was der Betreiber gerade sieht, wenn er die Einstellung noch nie angefasst hat. */
export const configured = () => Array.isArray(getSetting('discord_role_metadata'));

/**
 * Prüfen, was aus dem Admin-Bereich hereinkommt. Wirft mit einer Begründung, statt still etwas
 * anderes zu speichern – wer eine Bedingung einstellt und sie danach in Discord nicht findet,
 * sucht sonst am falschen Ende.
 */
export function validate(raw, { fail }) {
  if (!Array.isArray(raw)) {
    throw fail('Linked Roles müssen eine Liste sein.', { en: 'Linked roles have to be a list.' });
  }
  if (raw.length > MAX_FIELDS) {
    throw fail(`Discord nimmt höchstens ${MAX_FIELDS} Merkmale an.`, {
      en: `Discord accepts at most ${MAX_FIELDS} requirements.`,
    });
  }
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const key = String(entry?.key || '').trim().toLowerCase();
    if (!KEY_PATTERN.test(key)) {
      throw fail(`„${key || '–'}“ ist kein gültiger Schlüssel: Kleinbuchstaben, Ziffern, Unterstrich.`, {
        en: `"${key || '–'}" is not a valid key: lower-case letters, digits, underscore.`,
      });
    }
    if (seen.has(key)) {
      throw fail(`Den Schlüssel „${key}“ gibt es zweimal.`, { en: `The key "${key}" appears twice.` });
    }
    const source = lookup(sourceByKey, String(entry?.source || '').trim());
    if (!source) {
      throw fail(`„${key}“ hat keine gültige Quelle.`, { en: `"${key}" has no valid source.` });
    }
    const type = lookup(typeByValue, String(Number(entry?.type)));
    if (!type) {
      throw fail(`„${key}“ hat keine gültige Vergleichsart.`, { en: `"${key}" has no valid comparison.` });
    }
    if (type.kind !== source.kind) {
      throw fail(`„${key}“: „${source.de.label}“ passt nicht zu „${type.de}“.`, {
        en: `"${key}": "${source.en.label}" does not fit "${type.en}".`,
      });
    }
    seen.add(key);
    out.push(clean({ ...entry, key, source: source.key, type: type.value }));
  }
  return out;
}

/**
 * Die Werte, die Discord über ein Konto bekommen soll.
 *
 * Nur die eingestellten Merkmale – und wirklich nur die. Ein Feld, das Discord nicht kennt, würde
 * die ganze Anfrage scheitern lassen.
 */
export function valuesFor(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const out = {};
  for (const field of fields()) {
    const source = lookup(sourceByKey, field.source);
    if (!source) continue;
    try {
      out[field.key] = source.value(user);
    } catch {
      // Eine Quelle, die gerade nicht rechnen kann (gelöschter Tarif, kaputte Zeile), darf nicht
      // die ganze Verknüpfung verhindern. Sie meldet dann den neutralen Wert.
      out[field.key] = source.kind === 'date' ? isoDay(Date.now()) : 0;
    }
  }
  return out;
}

/** Wie das Ganze an den Browser geht – Beschriftungen in einer Sprache. */
export function schemaFor(lang = 'de') {
  const key = lang === 'en' ? 'en' : 'de';
  return {
    max: MAX_FIELDS,
    types: TYPES.map((entry) => ({ value: entry.value, kind: entry.kind, label: entry[key] })),
    sources: SOURCES.map((entry) => ({ key: entry.key, kind: entry.kind, ...entry[key] })),
    defaults: DEFAULT_FIELDS,
  };
}
