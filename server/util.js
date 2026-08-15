// Kleinkram, den mehrere Module brauchen.

import crypto from 'node:crypto';

export const now = () => Date.now();

export function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Passwort-Hash mit scrypt – kein Zusatzpaket, kein nativer Build. */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return crypto.timingSafeEqual(expected, actual);
}

/** Vergleich ohne Zeitunterschied, auch bei verschiedenen Längen. */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function slugify(text, fallback = 'profil') {
  const slug = String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

/** Gutscheincode: gut vorlesbar, keine verwechselbaren Zeichen. */
export function voucherCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i && i % 4 === 0) out += '-';
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/**
 * Ein Fehler, den der Nutzer zu sehen bekommt – deshalb in beiden Sprachen.
 *
 * Die deutsche Fassung steht als `message` (so liest sie sich auch im Log), die englische in
 * `en`. Welche ausgeliefert wird, entscheidet die Fehlerbehandlung in index.js anhand der
 * Sprache der Anfrage. Fehlt die englische Fassung, bleibt es bei der deutschen – das ist
 * hässlich, aber nie kaputt.
 *
 *   throw bad('Zu wenig Guthaben.', { en: 'Not enough credits.' })
 *   throw bad('Die Passwörter sind nicht gleich.', 'password-mismatch')
 *   throw new HttpError(402, 'Nur mit Tarif.', { en: 'Paid plans only.', code: 'plan' })
 */
export class HttpError extends Error {
  constructor(status, message, options) {
    super(message);
    const extra = typeof options === 'string' ? { code: options } : options || {};
    this.status = status;
    this.code = extra.code || null;
    this.en = extra.en || null;
  }

  /** Die Fassung für eine Sprache. */
  text(lang = 'de') {
    return lang === 'en' && this.en ? this.en : this.message;
  }
}

export const bad = (message, options) => new HttpError(400, message, options);
export const forbidden = (message = 'Keine Berechtigung.', options = { en: 'Not allowed.' }) =>
  new HttpError(403, message, options);
export const notFound = (message = 'Nicht gefunden.', options = { en: 'Not found.' }) =>
  new HttpError(404, message, options);

/** Express-Handler, bei dem geworfene Fehler in der Fehlerbehandlung landen. */
export const wrap = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

/**
 * Feldnamen auf Englisch.
 *
 * Die Prüfungen unten werden überall mit dem deutschen Feldnamen aufgerufen. Ohne diese Tabelle
 * stand der dann auch in der englischen Fassung – Sätze wie "Nachricht is missing." hat jeder
 * englischsprachige Nutzer bei der ersten falschen Eingabe zu sehen bekommen. Die Tabelle sitzt
 * hier statt an knapp hundert Aufrufstellen, damit ein neuer Aufruf nichts vergessen kann: fehlt
 * ein Name, bleibt es beim deutschen Wort, kaputt ist nie etwas.
 */
const FIELD_EN = {
  'Titel (DE)': 'Title (DE)',
  'Titel (EN)': 'Title (EN)',
  Ankündigung: 'Announcement',
  'Anti-AFK': 'Anti-AFK',
  Anzahl: 'Count',
  Aufladung: 'Top-up',
  Bearbeiter: 'Assignee',
  Benutzer: 'User',
  Benutzername: 'Username',
  Betrag: 'Amount',
  Betreff: 'Subject',
  Bezeichnung: 'Label',
  Blöcke: 'Blocks',
  'Chat-Abstand': 'Chat delay',
  Chatverlauf: 'Chat history',
  Einlösungen: 'Redemptions',
  Eintrag: 'Entry',
  Feld: 'Slot',
  Guthaben: 'Credits',
  Gültigkeit: 'Validity',
  Intervall: 'Interval',
  'Join-Delay': 'Join delay',
  Konto: 'Account',
  Macro: 'Macro',
  'Max-Backoff': 'Max backoff',
  Nachricht: 'Message',
  Name: 'Name',
  Nutzer: 'User',
  Paket: 'Package',
  Proxy: 'Proxy',
  Proxys: 'Proxies',
  'Reconnect-Delay': 'Reconnect delay',
  Reihenfolge: 'Order',
  Sekunden: 'Seconds',
  Server: 'Server',
  Sperrzeit: 'Cooldown',
  Tage: 'Days',
  Tarif: 'Plan',
  Verzögerung: 'Delay',
};

const fieldEn = (name) => FIELD_EN[name] ?? name;

export function requireString(value, name, { min = 1, max = 200 } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  const en = fieldEn(name);
  if (text.length < min) throw bad(`${name} fehlt.`, { en: `${en} is missing.` });
  if (text.length > max) {
    throw bad(`${name} ist zu lang (max. ${max} Zeichen).`, {
      en: `${en} is too long (${max} characters max).`,
    });
  }
  return text;
}

export function requireInt(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Math.trunc(Number(value));
  const en = fieldEn(name);
  if (!Number.isFinite(number)) {
    throw bad(`${name} muss eine Zahl sein.`, { en: `${en} has to be a number.` });
  }
  if (number < min || number > max) {
    throw bad(`${name} muss zwischen ${min} und ${max} liegen.`, {
      en: `${en} has to be between ${min} and ${max}.`,
    });
  }
  return number;
}

/** Credits sind ganze Zahlen (1 Credit = 1 Cent) – nur die Tausender bekommen einen Punkt. */
export function formatCredits(credits) {
  return Number(credits || 0).toLocaleString('de-DE');
}

/** Credits als Euro-Betrag – nur zur Anzeige. */
export function formatEuro(credits, lang = 'de') {
  return (Number(credits || 0) / 100).toLocaleString(lang === 'en' ? 'en-GB' : 'de-DE', {
    style: 'currency',
    currency: 'EUR',
  });
}

/** "host:port" zerlegen. Ohne Port bleibt der Port 0 – dann fragt der Client den SRV-Eintrag. */
export function parseAddress(input) {
  const text = String(input || '').trim();
  const match = /^([A-Za-z0-9._-]+)(?::(\d{1,5}))?$/.exec(text);
  if (!match) {
    throw bad('Serveradresse sieht nicht wie "host" oder "host:port" aus.', {
      en: 'That does not look like "host" or "host:port".',
    });
  }
  const port = match[2] ? Number(match[2]) : 0;
  if (port > 65535) throw bad('Port ist zu groß.', { en: 'That port number is too large.' });
  return { host: match[1].toLowerCase(), port };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const MS_LINK = 'https://www.microsoft.com/link';

/**
 * Microsofts Geräteanmeldung nimmt den Code auch als Parameter in der Adresse entgegen. Damit muss
 * ihn niemand abtippen: ein Klick, und im Browser steht er schon im Feld.
 */
export function codeUrl(uri, code) {
  if (!code) return null;
  const base = uri || MS_LINK;
  try {
    const url = new URL(base);
    url.searchParams.set('otc', code);
    return url.toString();
  } catch {
    return `${base}${base.includes('?') ? '&' : '?'}otc=${encodeURIComponent(code)}`;
  }
}
