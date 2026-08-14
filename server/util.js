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

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}

export const bad = (message, code) => new HttpError(400, message, code);
export const forbidden = (message = 'Keine Berechtigung.') => new HttpError(403, message);
export const notFound = (message = 'Nicht gefunden.') => new HttpError(404, message);

/** Express-Handler, bei dem geworfene Fehler in der Fehlerbehandlung landen. */
export const wrap = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export function requireString(value, name, { min = 1, max = 200 } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min) throw bad(`${name} fehlt.`);
  if (text.length > max) throw bad(`${name} ist zu lang (max. ${max} Zeichen).`);
  return text;
}

export function requireInt(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) throw bad(`${name} muss eine Zahl sein.`);
  if (number < min || number > max) throw bad(`${name} muss zwischen ${min} und ${max} liegen.`);
  return number;
}

/** Guthaben in Milli-Credits als lesbaren Betrag ausgeben (1000 mcr = 1 Credit). */
export function formatCredits(milli) {
  return (milli / 1000).toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

/** "host:port" zerlegen. Ohne Port bleibt der Port 0 – dann fragt der Client den SRV-Eintrag. */
export function parseAddress(input) {
  const text = String(input || '').trim();
  const match = /^([A-Za-z0-9._-]+)(?::(\d{1,5}))?$/.exec(text);
  if (!match) throw bad('Serveradresse sieht nicht wie "host" oder "host:port" aus.');
  const port = match[2] ? Number(match[2]) : 0;
  if (port > 65535) throw bad('Port ist zu groß.');
  return { host: match[1].toLowerCase(), port };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
