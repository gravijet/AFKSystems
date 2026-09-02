// Das, was ein Konto über den Anmeldenamen hinaus ausmacht: Name, Anschrift, Firmierung,
// Umsatzsteuer-Identifikationsnummer, Telefonnummer, Zeitzone.
//
// **Warum das hier steht und nicht in der Route.** Diese Felder werden an vier Stellen gebraucht:
// wenn der Kunde sie ändert (`PATCH /me`), wenn die Verwaltung sie ansieht, wenn ein Beleg
// entsteht, und wenn eine Bezahlseite bei Stripe die Adresse für die Zahlungsbestätigung nimmt.
// Läge die Prüfung in der Route, hätten die anderen drei Stellen keine – und ein Beleg mit einer
// Anschrift, die niemand geprüft hat, ist ein Beleg mit einer beliebigen Zeichenkette darauf.
//
// **Ändern darf sie nur der Kunde.** Die Verwaltung sieht sie, weil sie Rückfragen zu Belegen
// beantworten muss; sie zu überschreiben wäre eine zweite Wahrheit über etwas, das auf einer
// Rechnung steht und dort dem Kunden gehört.
//
// **Geprüft wird streng, aber nicht klug.** Ob es die Straße gibt, weiß dieses Programm nicht und
// soll es nicht wissen. Es prüft, was sich ohne Weltwissen prüfen lässt: Länge, erlaubte Zeichen,
// dass ein Land ein Land ist, dass eine Zeitzone existiert. Alles andere ist die Angabe des
// Kunden – und die ist auf einem Beleg genau das, was dort hingehört.

import crypto from 'node:crypto';
import { db, audit } from './db.js';
import { bad } from './util.js';
import { isCountry, countryName, addressLines } from '../public/assets/js/countries.js';

export { countryName, addressLines };

/**
 * Die Felder der Rechnungsadresse mit ihrer Höchstlänge.
 *
 * Die Grenzen sind großzügig, aber es gibt sie: Ohne sie steht in `street` irgendwann ein Text von
 * einem Viertelmegabyte (so viel lässt der Rumpf zu), der bei jedem Beleg, jeder Kasse und jeder
 * Kontoabfrage mitgelesen wird.
 */
export const FIELDS = {
  full_name: 120,
  company: 120,
  vat_id: 32,
  street: 160,
  street2: 160,
  postal_code: 24,
  city: 100,
  region: 100,
  country: 2,
  phone: 40,
  billing_email: 200,
  timezone: 64,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * Steuerbare Zeichen heraus, Leerraum zusammen, außen weg.
 *
 * Ein Zeilenumbruch in "Ort" ist kein Ort, sondern eine zweite Zeile, die später auf einem Beleg
 * die Anschrift auseinanderreißt. Und ein Nullbyte in einer Adresse ist nie eine Adresse.
 */
const tidy = (value, max) =>
  String(value ?? '')
    // Steuerzeichen (auch das Nullbyte) fallen weg, jeder Rest von Leerraum wird ein Leerzeichen.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Gibt es diese Zeitzone auf diesem Rechner?
 *
 * `Intl.DateTimeFormat` wirft bei einem unbekannten Namen – das ist die einzige Prüfung, die
 * wirklich stimmt, denn die Liste der Zeitzonen ändert sich mit der Zeitzonendatenbank und nicht
 * mit diesem Programm. Eine eigene Liste hier wäre ab dem nächsten Datenbank-Update falsch.
 */
export function isTimezone(value) {
  const name = String(value || '').trim();
  if (!name) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * Eine Umsatzsteuer-Identifikationsnummer, wie sie geschrieben wird: Länderkürzel und Zeichen.
 *
 * Geprüft wird die **Form**, nicht die Gültigkeit. Ob die Nummer bei der Steuerverwaltung
 * existiert, beantwortet nur eine Abfrage bei ihr (VIES) – und die hier einzubauen hieße, dass
 * eine Anschrift sich nicht speichern lässt, wenn ein fremder Dienst gerade nicht antwortet.
 * Was die Form ausschließt, ist der Tippfehler: "DE 12" ist keine, "Hallo" auch nicht.
 */
const VAT = /^[A-Z]{2}[A-Z0-9+*.-]{6,20}$/;

/** Ein Wert kommt in die Datenbank – geprüft, zurechtgeschnitten, in der richtigen Schreibweise. */
function clean(key, raw) {
  const value = tidy(raw, FIELDS[key]);
  if (!value) return '';

  if (key === 'country') {
    const code = value.toUpperCase();
    if (!isCountry(code)) {
      throw bad('Dieses Land kennen wir nicht.', { en: 'We do not know that country.' });
    }
    return code;
  }
  if (key === 'billing_email') {
    const address = value.toLowerCase();
    if (!EMAIL.test(address)) {
      throw bad('Das ist keine gültige E-Mail-Adresse für Belege.', {
        en: 'That is not a valid email address for receipts.',
      });
    }
    return address;
  }
  if (key === 'vat_id') {
    // Leerzeichen und Punkte schreibt jeder anders; auf dem Beleg steht sie ohne.
    const code = value.replace(/[\s.]/g, '').toUpperCase();
    if (!VAT.test(code)) {
      throw bad('Diese Umsatzsteuer-Identifikationsnummer sieht nicht richtig aus (z. B. ATU12345678).', {
        en: 'That VAT ID does not look right (for example ATU12345678).',
      });
    }
    return code;
  }
  if (key === 'phone') {
    // Ziffern, Leerzeichen, Klammern, Bindestrich, führendes Plus – mehr steht in keiner Nummer.
    if (!/^\+?[\d\s()/-]{4,}$/.test(value)) {
      throw bad('Diese Telefonnummer sieht nicht richtig aus.', {
        en: 'That phone number does not look right.',
      });
    }
    return value;
  }
  if (key === 'timezone') {
    if (!isTimezone(value)) {
      throw bad('Diese Zeitzone gibt es nicht.', { en: 'There is no such time zone.' });
    }
    return value;
  }
  return value;
}

/**
 * Was von einem Änderungswunsch übrig bleibt: Feldname -> geprüfter Wert.
 *
 * Nur Felder, die auch wirklich im Rumpf standen. `undefined` heißt "nicht angefasst" und `''`
 * heißt "leeren" – das ist ein Unterschied, und ohne ihn löscht jedes Speichern eines einzelnen
 * Feldes den ganzen Rest.
 */
export function readChanges(body = {}) {
  const out = {};
  for (const key of Object.keys(FIELDS)) {
    if (body[key] === undefined) continue;
    out[key] = clean(key, body[key]);
  }
  return out;
}

/**
 * Eine Anschrift, die vollständig genug ist, um auf einem Beleg zu stehen.
 *
 * Straße, Ort und Land – ohne eines davon ist es keine Anschrift, sondern ein Fragment. Die
 * Postleitzahl steht bewusst **nicht** in dieser Liste: Es gibt Länder ohne (Irland kannte lange
 * keine, Hongkong hat keine), und ein Pflichtfeld, das in manchen Ländern nicht ausfüllbar ist,
 * sperrt genau die Kunden aus, die es betrifft.
 */
export const hasAddress = (user) =>
  Boolean(String(user?.street || '').trim() && String(user?.city || '').trim() && String(user?.country || '').trim());

/** Der Name, der auf einem Beleg steht: die Firma, sonst der bürgerliche Name, sonst das Konto. */
export const billingName = (user) =>
  String(user?.company || '').trim() ||
  String(user?.full_name || '').trim() ||
  `Konto #${Number(user?.id) || '–'}`;

/**
 * Der Name eines Menschen in Gesprächen und Oberflächen.
 *
 * `username` bleibt die eindeutige Anmeldekennung. Wo ein Mensch angesprochen oder als Absender
 * gezeigt wird, gilt dagegen der selbst eingetragene Name, danach der Name eines freiwillig
 * verknüpften Kontos. Die Anmeldekennung bleibt außerhalb von Anmeldung und Kontoverwaltung
 * unsichtbar; fehlt ein echter Name, steht dort eine neutrale Kontonummer. So verhindert diese
 * eine Funktion, dass
 * Ticket, Mail und Administration jeweils eine andere Rangfolge erfinden.
 */
export const displayNameOf = (user) =>
  String(user?.full_name || '').trim() ||
  String(user?.discord_name || '').trim() ||
  String(user?.google_name || '').trim() ||
  `Konto #${Number(user?.id) || '–'}`;

/**
 * Der Abzug fürs Archiv: Was auf dem Beleg dieser Aufladung stehen wird, so wie es **heute** ist.
 *
 * Ein Beleg darf sich nie wieder ändern. Wer im Januar unter seiner alten Anschrift gekauft hat
 * und im März umzieht, hat trotzdem im Januar unter der alten gekauft; würde der Beleg auf das
 * Konto verweisen, änderte der Umzug rückwirkend jede Rechnung des Vorjahres.
 */
export function billingSnapshot(user) {
  const snapshot = {
    account_name: billingName(user),
    email: String(user?.billing_email || user?.email || ''),
    // **Die Sprache gehört dazu.** Ein Beleg ist ein Dokument aus einem Moment, und der Satz zur
    // Umsatzsteuer darauf ist genau der, der damals galt – in genau der Sprache, in der er galt.
    // Ohne diese Zeile stünde auf einem deutschen Beleg der englische Steuerhinweis, sobald der
    // Kunde das Panel später umstellt.
    lang: user?.language === 'de' ? 'de' : 'en',
  };
  for (const key of ['full_name', 'company', 'vat_id', 'street', 'street2', 'postal_code', 'city', 'region', 'country']) {
    const value = String(user?.[key] || '').trim();
    if (value) snapshot[key] = value;
  }
  return snapshot;
}

/**
 * Das Bild, das im Panel neben dem Namen steht.
 *
 * Die Quelle ist eine Kontoeinstellung. "auto" nimmt Discord, Google, dann Gravatar; "initials"
 * bleibt vollständig lokal. So entscheidet der Kunde ausdrücklich, wenn er die Vorgabe nicht
 * will. Bei Gravatar geht nur der standardisierte MD5-Abdruck der Adresse in die Bild-URL.
 */
export const AVATAR_SOURCES = ['auto', 'discord', 'google', 'gravatar', 'initials'];

const discordAvatar = (user) => {
  if (!user?.discord_id || !user?.discord_avatar) return null;
  // Neue OAuth-Verknüpfungen speichern bereits die vollständige Adresse; ältere Datensätze
  // enthalten nur den Discord-Hash. Beide bleiben nach dem Update gültig.
  if (/^https:\/\/cdn\.discordapp\.com\//.test(user.discord_avatar)) return user.discord_avatar;
  return `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.discord_avatar}.png?size=128`;
};

const googleAvatar = (user) =>
  /^https:\/\/[^/]*googleusercontent\.com\//.test(String(user?.google_avatar || ''))
    ? String(user.google_avatar)
    : null;

const gravatarAvatar = (user) => {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return null;
  const hash = crypto.createHash('md5').update(email).digest('hex');
  // `d=identicon` liefert auch ohne hinterlegtes Gravatar ein stabiles Standardbild.
  return `https://www.gravatar.com/avatar/${hash}?s=256&d=identicon`;
};

export function avatarChoices(user) {
  return {
    discord: discordAvatar(user),
    google: googleAvatar(user),
    gravatar: gravatarAvatar(user),
  };
}

export function avatarOf(user) {
  const source = AVATAR_SOURCES.includes(user?.avatar_source) ? user.avatar_source : 'auto';
  if (source === 'initials') return null;
  const choices = avatarChoices(user);
  if (source !== 'auto') return choices[source] || null;
  return choices.discord || choices.google || choices.gravatar || null;
}

/** Eine Avatar-Auswahl prüfen und speichern. Fehlende Anbieter werden nicht still vorgetäuscht. */
export function setAvatarSource(userId, raw) {
  const source = String(raw || '').trim();
  if (!AVATAR_SOURCES.includes(source)) {
    throw bad('Unbekannte Profilbild-Quelle.', { en: 'Unknown profile-picture source.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return;
  if (!['auto', 'initials'].includes(source) && !avatarChoices(user)[source]) {
    throw bad('Für diese Quelle ist kein Profilbild verfügbar.', {
      en: 'No profile picture is available from that source.',
    });
  }
  if (user.avatar_source === source) return;
  db.prepare('UPDATE users SET avatar_source = ? WHERE id = ?').run(source, userId);
  audit(userId, 'avatar-change', { source });
}

/** Wie ein Konto seine Daten sieht – dieselbe Form, in der es sie auch schickt. */
export function profileOf(user) {
  const out = {};
  for (const key of Object.keys(FIELDS)) out[key] = String(user?.[key] || '');
  return out;
}

/**
 * Die Zeitzone, in der dieses Konto lebt.
 *
 * Ohne eigene Angabe die des Servers. Das ist keine Vermutung über den Kunden, sondern die
 * einzige Zeit, über die beide Seiten sicher dasselbe wissen – und sie steht im Panel dabei.
 */
// Die Zeitzone des Servers ändert sich im laufenden Betrieb nicht – ein Neustart holt sie neu.
// Sie einmal je Aufruf zu erfragen ist teurer, als es aussieht: `Intl.DateTimeFormat()` baut dafür
// einen vollständigen Formatierer (gemessen über hundert Mikrosekunden), und `/api/meta` fragt
// danach bei jedem Panelaufruf.
const SERVER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export const timezoneOf = (user) =>
  isTimezone(user?.timezone) ? user.timezone : SERVER_TIMEZONE;

// ---------------------------------------------------------------- Schreiben

const writable = Object.keys(FIELDS);

/**
 * Änderungen an den persönlichen Daten schreiben. Gibt zurück, was sich wirklich geändert hat –
 * das steht so im Protokoll, und ein "geändert", bei dem nichts anders ist, gehört dort nicht hin.
 */
export function applyChanges(userId, changes) {
  const keys = Object.keys(changes).filter((key) => writable.includes(key));
  if (!keys.length) return [];
  const before = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const touched = keys.filter((key) => String(before?.[key] || '') !== changes[key]);
  if (!touched.length) return [];
  db.prepare(`UPDATE users SET ${touched.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`).run(
    ...touched.map((key) => changes[key]),
    userId
  );
  // **Was sich geändert hat, nicht worauf.** Eine Anschrift gehört dem Kunden; sie in ein
  // Protokoll zu schreiben, das jeder Administrator liest, wäre eine zweite Kopie davon an einer
  // Stelle, an der niemand sie sucht und niemand sie löscht.
  audit(userId, 'profile-change', { fields: touched });
  return touched;
}
