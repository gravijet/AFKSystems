// Gemeinsame Bausteine für Startseite und Dashboard: Symbole, API-Aufrufe, Meldungen, Aussehen.

import { parseFormatting } from './chatlog.js';

// ---------------------------------------------------------------- Sprache
//
// Die Sprache steht im <html lang="…">, das der Server schon richtig ausliefert. Von dort holen
// wir sie – so gibt es keinen zweiten Ort, an dem sie stehen könnte, und nichts blitzt falsch auf.
//
// **Die Texte kommen einsprachig und abschnittsweise.** Der Server rechnet aus i18n.js eine
// einsprachige Fassung für den Panel-Rahmen und eine für jede lazy geladene Ansicht. Welche gilt,
// entscheidet die Stelle, die auch die Seite ausliefert; hier steht keine zweite Textquelle und
// keine zweite Sprachliste. Das erste Bild muss so weder die Verwaltung noch den Servereditor
// parsen, und beim Wechsel in eine Ansicht liegen ihre Texte parallel zu ihrem Modul bereit.
//
// Ein `await` auf Modulebene: Jedes Modul, das ui.js benutzt, wartet damit auf die Texte. Das ist
// richtig so – ohne sie hätte es nichts zu zeichnen –, und es kostet nichts, weil der <head> die
// Datei mit `modulepreload` schon anfordert, während das HTML noch gelesen wird.
const documentElement = document.documentElement;
const stringsUrl =
  documentElement.dataset.strings ||
  // Rückfalltür für eine Seite, die noch aus einem Zwischenspeicher stammt: dann steht das
  // Attribut nicht da, und die Adresse ergibt sich aus der eigenen.
  new URL(`./i18n.${documentElement.lang === 'de' ? 'de' : 'en'}.js`, import.meta.url).pathname;
const initialStrings = await import(stringsUrl);
const { LANGS, DEFAULT_LANG, LANG } = initialStrings;
// Der Wörterbestand wächst nur um die Texte einer gerade geöffneten Ansicht. Ein Objekt ohne
// Prototyp verhindert dabei, dass ein unbekannter dynamischer Schlüssel wie `constructor` einen
// geerbten Wert statt seiner eigenen Bezeichnung zurückgibt.
const strings = Object.assign(Object.create(null), initialStrings.STRINGS || {});
const stringLoads = new Map();
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

// `LANG` sagt, in welcher Sprache die geladenen Texte wirklich stehen. Das ist die verlässlichere
// Auskunft als das Attribut am <html>: Beides kommt vom Server und stimmt überein, aber wenn es
// das einmal nicht täte, sollen Beschriftungen und Sprachkennzeichnung nicht auseinanderlaufen.
const pageLang = LANG;
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

/** Ein Text in der Sprache dieser Seite. Eine andere gibt es im Browser nicht. */
export const tr = (key, vars = null) => {
  let text = Object.hasOwn(strings, key) ? strings[key] : key;
  if (vars) {
    for (const name of Object.keys(vars)) text = text.replaceAll(`{${name}}`, String(vars[name]));
  }
  return text;
};

/** Lädt die Texte einer Ansicht nur einmal und teilt sie danach mit allen Komponenten. */
export function ensureStrings(scope) {
  if (!scope) return Promise.resolve();
  if (stringLoads.has(scope)) return stringLoads.get(scope);
  const job = import(new URL(`./i18n.${scope}.${lang}.js`, import.meta.url))
    .then((module) => Object.assign(strings, module.STRINGS || {}))
    .catch((error) => {
      // Ein hängen gebliebener Fehlschlag darf keine Dauerkarte sein: Ohne diese Zeile blieb ein
      // einziger Netzwerkaussetzer beim Laden einer Ansicht für den Rest der Sitzung bestehen –
      // jeder weitere Versuch bekam dasselbe abgelehnte Versprechen zurück, ohne die Adresse noch
      // einmal anzufragen.
      stringLoads.delete(scope);
      throw error;
    });
  stringLoads.set(scope, job);
  return job;
}

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
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  bookmark: '<path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  keyboard: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/><path d="M7 16h10"/>',
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
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.8 10.8 0 0 1-1.899 2.982"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12.18a1 1 0 0 0 .6.9l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 .58-.91"/><path d="M2 17.18a1 1 0 0 0 .6.9l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 .58-.91"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  discord: '<path d="M18.9 5.6A16.6 16.6 0 0 0 14.8 4.4l-.2.4a12.5 12.5 0 0 1 3.7 1.9 15.7 15.7 0 0 0-12.6 0 12.5 12.5 0 0 1 3.7-1.9l-.2-.4A16.6 16.6 0 0 0 5.1 5.6C2.5 9.5 1.8 13.3 2.1 17a16.7 16.7 0 0 0 5.1 2.6l.9-1.3a10.9 10.9 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.4 0l.4.3a10.9 10.9 0 0 1-1.7.8l.9 1.3a16.7 16.7 0 0 0 5.1-2.6c.4-4.3-.7-8.1-3-11.4Z"/><ellipse cx="9" cy="13" rx="1.4" ry="1.7"/><ellipse cx="15" cy="13" rx="1.4" ry="1.7"/>',
  google: '<path d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2a9.7 9.7 0 0 0 3-7.3"/><path d="M12 22a9.5 9.5 0 0 0 6.6-2.4l-3.2-2.5a6 6 0 0 1-8.9-3.1H3.2v2.6A10 10 0 0 0 12 22"/><path d="M6.5 14a5.9 5.9 0 0 1 0-3.8V7.6H3.2a10 10 0 0 0 0 8.9z"/><path d="M12 5.9a5.4 5.4 0 0 1 3.8 1.5l2.8-2.8A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.8 5.6L6.5 10A6 6 0 0 1 12 5.9"/>',
};

export function icon(name, klass = 'icon') {
  return `<svg class="${klass}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

// ---------------------------------------------------------------- Aussehen

/**
 * Der lokale Speicher darf fehlen.
 *
 * Im privaten Modus mancher Browser wirft schon der Zugriff. Diese Datei läuft ganz unten
 * `applyTheme()` auf Modulebene – eine geworfene Ausnahme dort riss das ganze Modul mit, und
 * damit **jede** Seite, die es lädt: Startseite wie Dashboard blieben leer.
 */
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* dann merkt sich dieses Gerät die Wahl eben nicht */
    }
  },
};

export function applyTheme(value) {
  const theme = value || store.get('afk-theme') || 'system';
  store.set('afk-theme', theme);
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  for (const button of document.querySelectorAll('.themes button')) {
    button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  }
}

export function themeSwitch() {
  const current = store.get('afk-theme') || 'system';
  return `<div class="themes" role="group" aria-label="${escapeHtml(tr('common.appearance'))}">
    <button data-theme="light" title="${escapeHtml(tr('common.light'))}" aria-pressed="${current === 'light'}">${icon('sun')}</button>
    <button data-theme="system" title="${escapeHtml(tr('common.system'))}" aria-pressed="${current === 'system'}">${icon('monitor')}</button>
    <button data-theme="dark" title="${escapeHtml(tr('common.dark'))}" aria-pressed="${current === 'dark'}">${icon('moon')}</button>
  </div>`;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('.themes button');
  if (button) applyTheme(button.dataset.theme);
});

/**
 * Spoiler aus Discord aufdecken.
 *
 * Einmal für die ganze Seite, nicht je Nachricht: Der Ticketverlauf wird bei jeder Antwort neu
 * gezeichnet, und ein Behandler je Element müsste dabei jedes Mal neu angehängt werden – einer
 * davon würde irgendwann vergessen, und dann bliebe ein Spoiler für immer verdeckt.
 */
document.addEventListener('click', (event) => {
  const spoiler = event.target.closest('.dc-spoiler:not(.is-open)');
  if (spoiler) spoiler.classList.add('is-open');
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const spoiler = event.target.closest?.('.dc-spoiler:not(.is-open)');
  if (!spoiler) return;
  event.preventDefault();
  spoiler.classList.add('is-open');
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
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json', 'accept-language': lang } : { 'accept-language': lang },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      // Für Anfragen, die noch hinausgehen sollen, während die Seite schon geht: "Live-Ansicht
      // stoppen" ist genau das, und ohne diesen Zusatz bricht der Browser sie ab.
      keepalive,
    });
  } catch {
    // fetch() selbst schlägt fehl, bevor eine Antwort da ist (offline, abgebrochen, DNS) – der
    // Browser meldet das in technischem Englisch. Das zeigen wir nie roh an.
    throw new ApiError(tr('common.offline'), 0, 'offline');
  }
  if (raw) return response;
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new ApiError(data.error || tr('common.error'), response.status, data.code || null);
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
  // Höchstens fünf auf einmal. Wer zwanzig Bots gleichzeitig startet und zwanzig Absagen bekommt,
  // hatte sonst eine Wand aus Meldungen über dem halben Bildschirm – und darunter die Knöpfe,
  // mit denen er darauf reagieren wollte.
  while (toastBox.children.length > 5) toastBox.firstElementChild.remove();
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

/**
 * Was gerade zu tun ist – als Kasten.
 *
 * Steht hier und nicht in einer Ansicht, weil es **zwei** Listen dieser Art gibt: die des Kunden
 * (Übersicht) und die des Teams (Administration). Der Inhalt kommt in beiden Fällen vollständig
 * vom Server (server/todos.js); hier steht nur, wie er aussieht, und das soll in beiden gleich sein.
 *
 * Ist nichts offen, kommt gar nichts. Ein leerer Kasten mit "alles erledigt" wäre eine Zeile, die
 * jeden Tag dasteht und nie etwas sagt – dann sieht man auch nicht mehr hin, wenn einmal etwas
 * darin steht. Die Zahl in der Seitenleiste erfüllt denselben Zweck ohne Fläche.
 */
export function todoList(list, { title = tr('todo.title') } = {}) {
  if (!list?.length) return '';
  const item = (entry) => `<li class="todo-item ${entry.kind === 'info' ? '' : entry.kind}">
    <span class="todo-mark">${icon(
      entry.kind === 'bad' ? 'alert' : entry.kind === 'warn' ? 'clock' : 'info'
    )}</span>
    <div class="todo-text">
      <strong>${escapeHtml(entry.title)}</strong>
      <p class="small muted">${escapeHtml(entry.text)}</p>
    </div>
    <a class="btn btn-sm ${entry.kind === 'bad' ? 'btn-primary' : ''}"
      href="${escapeHtml(safeLink(entry.href))}"${
        entry.external ? ' target="_blank" rel="noopener"' : ''
      }>${escapeHtml(entry.label)}</a>
  </li>`;

  return `<section class="panel todo" style="margin-bottom:1.5rem">
    <header>
      <h3>${escapeHtml(title)}</h3>
      <span class="small muted">${escapeHtml(tr('todo.count', { n: list.length }))}</span>
    </header>
    <ul class="todo-list">${list.map(item).join('')}</ul>
  </section>`;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// ---------------------------------------------------------------- Zahlen, Datum, Uhrzeit
//
// **Formatierer werden einmal gebaut.** `zahl.toLocaleString(…)` und `datum.toLocaleString(…)`
// lesen sich wie eine Zeichenkettenoperation, sind aber jedes Mal der vollständige Bau eines
// `Intl`-Objekts: gemessen rund sechzig Mikrosekunden für eine Zahl und über hundert für ein
// Datum, gegenüber ein bis vier für einen Formatierer, der schon dasteht.
//
// Bei einer Zahl merkt das niemand. Diese Funktionen stehen aber genau dort, wo Listen gezeichnet
// werden: eine Uhrzeit je Chatzeile (bis zu fünfzigtausend im Verlauf eines Serverplatzes), ein
// Datum je Zeile im Kontoauszug, ein Betrag je Zeile in der Nutzerliste des Admin-Bereichs. Zwei
// Bildschirmseiten Chat waren damit ein Zehntel einer Sekunde, in der der Browser nichts anderes
// tun konnte – nicht scrollen, nicht auf einen Klick reagieren.
//
// Die Sprache steht für die Dauer dieser Seite fest (ein Wechsel lädt neu), also reicht je Format
// genau einer.
const nf = (options) => new Intl.NumberFormat(locale, options);
const df = (options) => new Intl.DateTimeFormat(locale, options);

const FORMATS = {
  credits: nf(),
  euro: nf({ style: 'currency', currency: 'EUR' }),
  datetime: df({ day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
  date: df({ day: '2-digit', month: '2-digit', year: 'numeric' }),
  clock: df({ hour: '2-digit', minute: '2-digit', second: '2-digit' }),
};

/** Guthaben. Ein Credit ist ein Cent – gezählt wird in ganzen Credits. */
export function credits(value) {
  return FORMATS.credits.format(Math.round(Number(value) || 0));
}

/** Dieselbe Zahl als Geldbetrag: 100 Credits sind ein Euro. */
export function euro(value) {
  return FORMATS.euro.format((Number(value) || 0) / 100);
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
  return FORMATS.datetime.format(new Date(timestamp));
}

export function date(timestamp) {
  if (!timestamp) return '–';
  return FORMATS.date.format(new Date(timestamp));
}

export function clock(timestamp) {
  return FORMATS.clock.format(new Date(timestamp));
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

// ---------------------------------------------------------------- Profilbilder
//
// Ein Gesicht neben einem Namen macht eine Liste lesbar – man sucht nicht mehr Buchstabe für
// Buchstabe, sondern erkennt. Der Server entscheidet aus der Kontoeinstellung, ob die fertige URL
// von Discord, Google oder Gravatar kommt. Fehlt sie (oder ist "Initialen" gewählt), zeichnet das
// Panel selbst: der erste Buchstabe auf einer stabil aus dem Anzeigenamen berechneten Farbe.

/**
 * Eine Zahl aus einem Text – klein, stabil, ohne Anspruch auf Kryptografie.
 *
 * Das ist der FNV-1a-Grundgedanke: multiplizieren und mischen. Er wird hier für eine Farbe
 * benutzt und für nichts anderes; entscheidend ist allein, dass derselbe Name immer dieselbe
 * Zahl ergibt und ähnliche Namen nicht dieselbe.
 */
function hueOf(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text || '?')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 360;
}

/**
 * Das Bild neben einem Namen.
 *
 * `person` ist alles, was einen sichtbaren Namen und vielleicht ein `avatar` hat – das
 * eigene Konto, ein Beteiligter an einem Ticket, eine Zeile in der Nutzerliste.
 */
export function avatar(person, { size = 32, klass = '' } = {}) {
  const name = String(person?.display_name || person?.name || '?');
  const letter = [...name][0]?.toUpperCase() || '?';
  const style = `--avatar-size:${size}px`;
  if (person?.avatar) {
    return `<img class="avatar ${klass}" style="${style}" src="${escapeHtml(safeLink(person.avatar))}"
      alt="" width="${size}" height="${size}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  }
  const hue = hueOf(name.toLowerCase());
  return `<span class="avatar ${klass}" style="${style};--avatar-hue:${hue}" aria-hidden="true">${escapeHtml(
    letter
  )}</span>`;
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

/**
 * Ja/Nein, als Versprechen.
 *
 * **Aufgelöst wird beim Schließen, nicht beim Klick.** Ein `<dialog>` lässt sich auch mit der
 * Escape-Taste schließen, und dabei fällt kein Klick an: Das Versprechen wurde dann nie
 * aufgelöst. Jeder Aufrufer wartet mit `await` darauf – der Ablauf blieb also mitten im Schritt
 * stehen, und mit ihm ein Knopf, der auf seine Antwort wartete. Dass dabei meistens genau das
 * herauskam, was ein "Abbrechen" bewirkt hätte, war Zufall und kein Entwurf.
 *
 * `extra` hängt zusätzlich einen **Link** in den Fuß – für den Fall, dass die eigentliche Antwort
 * gar nicht "ja" oder "nein" ist, sondern "erst dort hin". Der Discord-Beitritt ist genau so ein
 * Fall: "Trotzdem anlegen" ist eine gültige Wahl, aber die richtige ist, vorher beizutreten.
 */
export function confirmDialog(
  question,
  { confirm = tr('common.yes'), danger = true, title = tr('common.confirm'), extra = null } = {}
) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = `
      <header><h3>${escapeHtml(title)}</h3></header>
      <div class="body"><p style="white-space:pre-line">${escapeHtml(question)}</p></div>
      <footer>
        ${
          extra
            ? `<a class="btn btn-primary" href="${escapeHtml(safeLink(extra.href))}"${
                extra.external ? ' target="_blank" rel="noopener"' : ''
              }>${escapeHtml(extra.label)}</a>`
            : ''
        }
        <button class="btn" value="no">${escapeHtml(tr('common.cancel'))}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="yes">${escapeHtml(confirm)}</button>
      </footer>`;
    document.body.append(dialog);
    // Das Ergebnis bleibt hier in der Umgebung stehen – wie im Formular-Dialog darunter.
    let answer = false;
    dialog.addEventListener('click', (event) => {
      // Ein Link im Fuß, der im Panel bleibt, muss den Dialog schließen: Sonst stünde er weiterhin
      // über der Seite, zu der er gerade geführt hat. Ein Link in einen neuen Tab lässt ihn stehen.
      const link = event.target.closest('a[href]');
      if (link) {
        if (link.target !== '_blank') dialog.close();
        return;
      }
      const button = event.target.closest('button');
      if (!button) return;
      answer = button.value === 'yes';
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    dialog.showModal();
    // Der harmlose Knopf bekommt die Aufmerksamkeit: Wer mit der Tastatur bedient und sofort
    // Enter drückt, soll nichts löschen, was er nicht gelesen hat.
    dialog.querySelector('button[value="no"]')?.focus();
  });
}

/**
 * Formular-Dialog: Felder rein, Werte raus (oder null bei Abbruch).
 *
 * Mit `draftKey` bleiben Textfelder auf diesem Gerät erhalten. Der Aufrufer löscht den Schlüssel
 * erst, wenn seine eigentliche Serveranfrage erfolgreich war – das Schließen des Dialogs allein
 * ist noch kein Erfolg und darf einen längeren Text deshalb nicht vernichten.
 */
export function formDialog(
  title,
  fields,
  { submit = tr('common.save'), note = '', draftKey = '', draftLabel = tr('common.draftSaved') } = {}
) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    let savedDraft = {};
    if (draftKey) {
      try {
        const parsed = JSON.parse(localStorage.getItem(draftKey) || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) savedDraft = parsed;
      } catch {
        savedDraft = {};
      }
    }
    const activeFields = fields.map((field) =>
      draftKey && field.type !== 'files' && field.type !== 'note' && Object.hasOwn(savedDraft, field.key)
        ? { ...field, value: savedDraft[field.key] }
        : field
    );
    const body = activeFields
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
                  String(option.value ?? option) === String(field.value ?? '') ? 'selected' : ''
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
            <textarea id="${id}" name="${field.key}" placeholder="${escapeHtml(field.placeholder || '')}"
              ${field.maxLength !== undefined ? `maxlength="${field.maxLength}"` : ''}>${value}</textarea>
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
          ${draftKey ? `<span class="form-draft-status small muted" aria-live="polite"></span>` : ''}
          <button class="btn" value="cancel" type="submit" formnovalidate>${escapeHtml(tr('common.cancel'))}</button>
          <button class="btn btn-primary" value="ok" type="submit">${escapeHtml(submit)}</button>
        </footer>
      </form>`;
    document.body.append(dialog);

    // Das Ergebnis bleibt hier in der Umgebung stehen. Über dialog.returnValue ginge es nicht:
    // der Browser überschreibt den Wert nach dem Absenden mit dem des gedrückten Knopfes.
    let result = null;
    const form = dialog.querySelector('form');
    const draftStatus = dialog.querySelector('.form-draft-status');
    const readValues = () => {
      const data = {};
      for (const field of activeFields) {
        if (field.type === 'note' || field.type === 'files') continue;
        const input = form.elements[field.key];
        if (!input) continue;
        data[field.key] = field.type === 'checkbox' ? input.checked : input.value;
      }
      return data;
    };
    const storeDraft = () => {
      if (!draftKey) return;
      const data = readValues();
      const hasContent = Object.values(data).some(
        (value) => value === true || (typeof value === 'string' && value.trim())
      );
      try {
        if (hasContent) localStorage.setItem(draftKey, JSON.stringify(data));
        else localStorage.removeItem(draftKey);
      } catch {
        /* Komfortfunktion: Ein gesperrter Gerätespeicher darf das Formular nicht beeinflussen. */
      }
      if (draftStatus) draftStatus.textContent = hasContent ? draftLabel : '';
    };
    if (draftKey) {
      form.addEventListener('input', storeDraft);
      form.addEventListener('change', storeDraft);
      const hasSavedContent = Object.values(savedDraft).some(
        (value) => value === true || (typeof value === 'string' && value.trim())
      );
      if (draftStatus) draftStatus.textContent = hasSavedContent ? draftLabel : '';
    }
    form.addEventListener('submit', (event) => {
      if (event.submitter?.value !== 'ok') return;
      const data = {};
      for (const field of activeFields) {
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

// Innerhalb des Dashboards steht die Sprachwahl als Auswahlfeld unter Einstellungen (siehe
// views/settings.js) und ruft `switchLang()` direkt auf. Die Sprachlinks der öffentlichen Seiten
// (`_nav.html`, `.language-picker [data-language]`) bedient stattdessen `landing.js` – ui.js wird
// dort gar nicht geladen. Ein früherer Klick-Handler hier zielte auf `[data-lang]`/`.langs`,
// Attribute und Klassen, die es in keiner Vorlage je gab, und griff deshalb nie.

applyTheme();
