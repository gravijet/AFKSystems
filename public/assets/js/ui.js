// Gemeinsame Bausteine für Startseite und Dashboard: Symbole, API-Aufrufe, Meldungen, Aussehen.

import { t, LANGS, DEFAULT_LANG } from './i18n.js';
import { parseFormatting } from './chatlog.js';

// ---------------------------------------------------------------- Sprache
//
// Die Sprache steht im <html lang="…">, das der Server schon richtig ausliefert. Von dort holen
// wir sie – so gibt es keinen zweiten Ort, an dem sie stehen könnte, und nichts blitzt falsch auf.
//
// Gemerkt wird sie **im Browser** (localStorage `afk-lang`) und zusätzlich im Cookie `lang`, das
// der Server liest. Der Ablauf ist damit:
//
//   1. Erster Besuch: nichts gespeichert – der Server nimmt die Sprache des Browsers
//      (Accept-Language) und schickt einen auf /en oder /de. Was dabei herauskam, merken wir uns.
//   2. Jeder weitere Besuch: die gemerkte Sprache gilt, auch wenn jemand über einen Link in der
//      anderen Sprache hereinkommt – dann wird einmal umgeleitet.
//   3. Umschalten: schreibt beides neu und geht auf dieselbe Seite in der anderen Sprache.
//
// Das gilt für Website und Dashboard gleichermaßen: beide laden diese Datei.

const STORE_KEY = 'afk-lang';

const readStore = () => {
  try {
    const value = localStorage.getItem(STORE_KEY);
    return LANGS.includes(value) ? value : null;
  } catch {
    return null; // privater Modus: dann gilt eben das Cookie
  }
};

const writeStore = (value) => {
  try {
    localStorage.setItem(STORE_KEY, value);
  } catch {
    /* siehe oben */
  }
  document.cookie = `lang=${value}; path=/; max-age=${365 * 86400}; samesite=lax`;
};

const documentLang = document.documentElement.lang;
const pageLang = LANGS.includes(documentLang) ? documentLang : DEFAULT_LANG;
const stored = readStore();

// Steht etwas anderes gespeichert, als gerade ausgeliefert wurde, gehört der Besucher auf die
// gespeicherte Fassung. Einmal umleiten, nicht öfter: danach stimmt <html lang> überein.
if (stored && stored !== pageLang && /^\/(en|de)(\/|$)/.test(location.pathname)) {
  document.cookie = `lang=${stored}; path=/; max-age=${365 * 86400}; samesite=lax`;
  location.replace(
    `/${stored}${location.pathname.replace(/^\/(en|de)/, '')}${location.search}${location.hash}`
  );
}
if (!stored) writeStore(pageLang);

export const lang = pageLang;
export const locale = lang === 'de' ? 'de-DE' : 'en-GB';

/** Ein Text in der Sprache dieser Seite. */
export const tr = (key, vars = null) => t(key, lang, vars);

/** Ein Feld, das der Server in beiden Sprachen liefert: {de, en} oder ein fertiger Text. */
export const pick = (value) =>
  value && typeof value === 'object' ? value[lang] ?? value[DEFAULT_LANG] ?? '' : value ?? '';

/** Adresse innerhalb der Seite, mit Sprache vorne dran. */
export const url = (path = '') => `/${lang}${path}`;

// ---------------------------------------------------------------- Symbole (Lucide, eingebettet)

const PATHS = {
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  gamepad: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  compass: '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  disk: '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.8 10.8 0 0 1-1.899 2.982"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12.18a1 1 0 0 0 .6.9l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 .58-.91"/><path d="M2 17.18a1 1 0 0 0 .6.9l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 .58-.91"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  discord: '<path d="M18.9 5.6A16.6 16.6 0 0 0 14.8 4.4l-.2.4a12.5 12.5 0 0 1 3.7 1.9 15.7 15.7 0 0 0-12.6 0 12.5 12.5 0 0 1 3.7-1.9l-.2-.4A16.6 16.6 0 0 0 5.1 5.6C2.5 9.5 1.8 13.3 2.1 17a16.7 16.7 0 0 0 5.1 2.6l.9-1.3a10.9 10.9 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.4 0l.4.3a10.9 10.9 0 0 1-1.7.8l.9 1.3a16.7 16.7 0 0 0 5.1-2.6c.4-4.3-.7-8.1-3-11.4Z"/><ellipse cx="9" cy="13" rx="1.4" ry="1.7"/><ellipse cx="15" cy="13" rx="1.4" ry="1.7"/>',
  google: '<path d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2a9.7 9.7 0 0 0 3-7.3"/><path d="M12 22a9.5 9.5 0 0 0 6.6-2.4l-3.2-2.5a6 6 0 0 1-8.9-3.1H3.2v2.6A10 10 0 0 0 12 22"/><path d="M6.5 14a5.9 5.9 0 0 1 0-3.8V7.6H3.2a10 10 0 0 0 0 8.9z"/><path d="M12 5.9a5.4 5.4 0 0 1 3.8 1.5l2.8-2.8A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.8 5.6L6.5 10A6 6 0 0 1 12 5.9"/>',
};

export function icon(name, klass = 'icon') {
  return `<svg class="${klass}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

// ---------------------------------------------------------------- Aussehen

export function applyTheme(value) {
  const theme = value || localStorage.getItem('afk-theme') || 'system';
  localStorage.setItem('afk-theme', theme);
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  for (const button of document.querySelectorAll('.themes button')) {
    button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  }
}

export function themeSwitch() {
  return `<div class="themes" role="group" aria-label="${escapeHtml(tr('common.appearance'))}">
    <button data-theme="light" title="${escapeHtml(tr('common.light'))}" aria-pressed="false">${icon('sun')}</button>
    <button data-theme="system" title="${escapeHtml(tr('common.system'))}" aria-pressed="true">${icon('monitor')}</button>
    <button data-theme="dark" title="${escapeHtml(tr('common.dark'))}" aria-pressed="false">${icon('moon')}</button>
  </div>`;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('.themes button');
  if (button) applyTheme(button.dataset.theme);
});

// ---------------------------------------------------------------- API

export class ApiError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, raw = false, keepalive = false } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json', 'accept-language': lang } : { 'accept-language': lang },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    // Für Anfragen, die noch hinausgehen sollen, während die Seite schon geht: "Live-Ansicht
    // stoppen" ist genau das, und ohne diesen Zusatz bricht der Browser sie ab.
    keepalive,
  });
  if (raw) return response;
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new ApiError(data.error || `${tr('common.error')} (${response.status})`, response.status, data.code || null);
  }
  return data;
}

// ---------------------------------------------------------------- Meldungen

let toastBox = null;

export function toast(message, kind = '') {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    document.body.append(toastBox);
  }
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.innerHTML = `${icon(kind === 'bad' ? 'alert' : kind === 'ok' ? 'check' : 'info')}<div>${escapeHtml(message)}</div>`;
  toastBox.append(node);
  setTimeout(() => node.remove(), kind === 'bad' ? 7000 : 4000);
}

export const ok = (message) => toast(message, 'ok');
export const fail = (error) => toast(error?.message || String(error), 'bad');

// ---------------------------------------------------------------- Kleinkram

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Eine Adresse, die in ein `href` darf.
 *
 * `escapeHtml` macht aus `javascript:alert(1)` keinen harmlosen Link – es schützt das Attribut,
 * nicht das Schema. Hier kommen nur Adressen durch, die wirklich irgendwohin führen: absolute
 * `http(s)`-Adressen und Ziele innerhalb dieser Seite. Alles andere wird zu `#`, statt zu einem
 * Knopf, der Code ausführt.
 */
export function safeLink(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '#';
  if (value.startsWith('/') || value.startsWith('#')) return value;
  try {
    const url = new URL(value, location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
  } catch {
    return '#';
  }
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Guthaben. Ein Credit ist ein Cent – gezählt wird in ganzen Credits. */
export function credits(value) {
  return Math.round(Number(value) || 0).toLocaleString(locale);
}

/** Dieselbe Zahl als Geldbetrag: 100 Credits sind ein Euro. */
export function euro(value) {
  return ((Number(value) || 0) / 100).toLocaleString(locale, { style: 'currency', currency: 'EUR' });
}

export function since(timestamp) {
  if (!timestamp) return '–';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function datetime(timestamp) {
  if (!timestamp) return '–';
  return new Date(timestamp).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function date(timestamp) {
  if (!timestamp) return '–';
  return new Date(timestamp).toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function clock(timestamp) {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Text mit Minecraft-Farbcodes (§) als HTML.
 *
 * Damit sieht die Anzeigetafel im Panel aus wie im Spiel, statt "§t§?" zwischen den Wörtern zu
 * zeigen. Das Zerlegen macht chatlog.js – hier wird nur gezeichnet.
 */
export function mcText(raw) {
  return parseFormatting(raw)
    .map((part) => {
      const style = [
        part.color ? `color:${part.color}` : '',
        part.bold ? 'font-weight:700' : '',
        part.italic ? 'font-style:italic' : '',
        part.underline || part.strike
          ? `text-decoration:${[part.underline && 'underline', part.strike && 'line-through']
              .filter(Boolean)
              .join(' ')}`
          : '',
      ]
        .filter(Boolean)
        .join(';');
      // "obfuscated" ist im Spiel flackernder Zeichensalat. Hier bleibt der Text lesbar und wird
      // nur gedämpft – wer eine Anzeigetafel im Panel liest, will sie lesen.
      const klass = part.obfuscated ? ' class="mc-obf"' : '';
      return `<span${klass}${style ? ` style="${style}"` : ''}>${escapeHtml(part.text)}</span>`;
    })
    .join('');
}

/** Byte in etwas, das man vorlesen kann. */
export function bytes(value) {
  const number = Number(value) || 0;
  if (number < 1024) return `${number} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let size = number / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toLocaleString(locale, { maximumFractionDigits: size < 10 ? 1 : 0 })} ${units[unit]}`;
}

/** Ein Balken für eine Auslastung in Prozent. */
export function meter(percent, { label = '', tone = '' } = {}) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const level = tone || (value >= 90 ? 'bad' : value >= 70 ? 'warn' : 'ok');
  return `<div class="meter ${level}" role="img" aria-label="${escapeHtml(label || `${Math.round(value)} %`)}">
    <span style="width:${value.toFixed(1)}%"></span>
  </div>`;
}

export function stateBadge(state, detail = '') {
  const label = tr(`state.${state}`);
  const live = state === 'online' ? ' live' : '';
  return `<span class="state ${escapeHtml(state)}" title="${escapeHtml(detail || label)}">
    <span class="dot${live}"></span>${escapeHtml(label)}</span>`;
}

/** Kopf einer Karte mit Titel und optionalen Knöpfen. */
export function panel(title, bodyHtml, actionsHtml = '') {
  return `<section class="panel">
    <header><h3>${escapeHtml(title)}</h3><div class="row">${actionsHtml}</div></header>
    <div class="body">${bodyHtml}</div>
  </section>`;
}

/** Bestätigungsdialog, der ein Versprechen zurückgibt. */
export function confirmDialog(question, { confirm = tr('common.yes'), danger = true } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <header><h3>${escapeHtml(tr('common.confirm'))}</h3></header>
      <div class="body"><p>${escapeHtml(question)}</p></div>
      <footer>
        <button class="btn" value="no">${escapeHtml(tr('common.cancel'))}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="yes">${escapeHtml(confirm)}</button>
      </footer>`;
    document.body.append(dialog);
    dialog.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      dialog.close();
      resolve(button.value === 'yes');
    });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  });
}

/** Formular-Dialog: Felder rein, Werte raus (oder null bei Abbruch). */
export function formDialog(title, fields, { submit = tr('common.save'), note = '' } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    const body = fields
      .map((field) => {
        if (field.type === 'note') {
          return `<p class="small muted">${escapeHtml(field.label)}</p>`;
        }
        const id = `f-${field.key}`;
        const value = escapeHtml(field.value ?? '');
        if (field.type === 'select') {
          const options = field.options
            .map(
              (option) =>
                `<option value="${escapeHtml(option.value ?? option)}" ${
                  (option.value ?? option) === field.value ? 'selected' : ''
                }>${escapeHtml(option.label ?? option)}</option>`
            )
            .join('');
          return `<div class="field"><label for="${id}">${escapeHtml(field.label)}</label>
            <select id="${id}" name="${field.key}">${options}</select>
            ${field.hint ? `<span class="hint">${escapeHtml(field.hint)}</span>` : ''}</div>`;
        }
        if (field.type === 'checkbox') {
          return `<label class="check"><input type="checkbox" name="${field.key}" ${
            field.value ? 'checked' : ''
          }><span>${escapeHtml(field.label)}</span></label>`;
        }
        if (field.type === 'files') {
          return `<div class="field"><label for="${id}">${escapeHtml(field.label)}</label>
            <input id="${id}" name="${field.key}" type="file" multiple
              ${field.accept ? `accept="${escapeHtml(field.accept)}"` : ''}>
            ${field.hint ? `<span class="hint">${escapeHtml(field.hint)}</span>` : ''}</div>`;
        }
        if (field.type === 'textarea') {
          return `<div class="field"><label for="${id}">${escapeHtml(field.label)}</label>
            <textarea id="${id}" name="${field.key}" placeholder="${escapeHtml(field.placeholder || '')}">${value}</textarea>
            ${field.hint ? `<span class="hint">${escapeHtml(field.hint)}</span>` : ''}</div>`;
        }
        return `<div class="field"><label for="${id}">${escapeHtml(field.label)}</label>
          <input id="${id}" name="${field.key}" type="${field.type || 'text'}" value="${value}"
            placeholder="${escapeHtml(field.placeholder || '')}"
            ${field.required ? 'required' : ''}
            ${field.step !== undefined ? `step="${field.step}"` : ''}
            ${field.min !== undefined ? `min="${field.min}"` : ''}
            ${field.max !== undefined ? `max="${field.max}"` : ''}>
          ${field.hint ? `<span class="hint">${escapeHtml(field.hint)}</span>` : ''}</div>`;
      })
      .join('');

    dialog.innerHTML = `
      <form method="dialog">
        <header><h3>${escapeHtml(title)}</h3></header>
        <div class="body">
          ${note ? `<p class="small muted" style="margin: 0 0 1rem">${escapeHtml(note)}</p>` : ''}
          <div class="stack">${body}</div>
        </div>
        <footer>
          <button class="btn" value="cancel" type="submit" formnovalidate>${escapeHtml(tr('common.cancel'))}</button>
          <button class="btn btn-primary" value="ok" type="submit">${escapeHtml(submit)}</button>
        </footer>
      </form>`;
    document.body.append(dialog);

    // Das Ergebnis bleibt hier in der Umgebung stehen. Über dialog.returnValue ginge es nicht:
    // der Browser überschreibt den Wert nach dem Absenden mit dem des gedrückten Knopfes.
    let result = null;
    const form = dialog.querySelector('form');
    form.addEventListener('submit', (event) => {
      if (event.submitter?.value !== 'ok') return;
      const data = {};
      for (const field of fields) {
        if (field.type === 'note') continue;
        const input = form.elements[field.key];
        if (!input) continue;
        if (field.type === 'checkbox') data[field.key] = input.checked;
        else if (field.type === 'files') data[field.key] = [...(input.files || [])];
        else data[field.key] = input.value;
      }
      result = data;
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    dialog.showModal();
    dialog.querySelector('input, select, textarea')?.focus();
  });
}

/** Eine Dateigröße, wie ein Mensch sie liest. */
export function fileSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

/** Ruft `fn` erst, wenn eine Weile Ruhe war – gegen Neuzeichnen im Sekundentakt. */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    ok(tr('common.copied'));
  } catch {
    toast(text);
  }
}

/** Sprache umschalten: merken und auf dieselbe Seite in der anderen Sprache gehen. */
export function switchLang(next) {
  if (!LANGS.includes(next)) return;
  writeStore(next);
  const rest = location.pathname.replace(/^\/(en|de)/, '');
  location.href = `/${next}${rest}${location.search}${location.hash}`;
}

// Die Sprachwahl in der Kopfleiste sind gewöhnliche Links (/en…, /de…) – damit sie auch dann
// funktionieren, wenn kein JavaScript läuft, und für Suchmaschinen echte Adressen sind. Klickt
// jemand darauf, während JavaScript läuft, merken wir die Wahl vorher.
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-lang]');
  if (button && LANGS.includes(button.dataset.lang)) {
    event.preventDefault();
    switchLang(button.dataset.lang);
    return;
  }
  const link = event.target.closest('.langs a[href^="/"]');
  if (!link) return;
  const wanted = link.getAttribute('href').slice(1, 3);
  if (LANGS.includes(wanted)) writeStore(wanted);
});

applyTheme();
