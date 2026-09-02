// Die festen Seiten in zwei Sprachen: /en/… und /de/….
//
// Kein Bauschritt, keine Template-Engine als Abhängigkeit. Die Vorlagen liegen unter
// public/pages/ und kennen genau zwei Dinge:
//
//   {{> name}}   fügt public/pages/_name.html ein
//   {{schluessel}} setzt einen Text aus public/assets/js/i18n.js in der aktuellen Sprache ein
//
// Der Vorteil gegenüber "alles im Browser übersetzen": die Seite steht sofort richtig da, ohne
// dass für einen Wimpernschlag die falsche Sprache aufblitzt, und Suchmaschinen bekommen echte
// Adressen statt einer Seite mit Schalter.

import fs from 'node:fs';
import path from 'node:path';
import { assetVersion, config, paths } from './config.js';
import { LANGS, DEFAULT_LANG, t, pickLang } from '../public/assets/js/i18n.js';
import * as strings from './strings.js';

const DIR = path.join(paths.public, 'pages');
const cache = new Map();
const PRODUCTION = process.env.NODE_ENV === 'production';

function read(file) {
  if (PRODUCTION && cache.has(file)) return cache.get(file);
  const text = fs.readFileSync(path.join(DIR, file), 'utf8');
  cache.set(file, text);
  return text;
}

/** Vorlage einlesen und Einschübe auflösen (zwei Ebenen reichen hier). */
function template(name) {
  let html = read(`${name}.html`);
  for (let round = 0; round < 3 && html.includes('{{>'); round++) {
    html = html.replace(/\{\{>\s*([a-z0-9_-]+)\s*\}\}/gi, (_, partial) => read(`_${partial}.html`));
  }
  return html;
}

export const escape = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Eine Seite bauen. `vars` schlägt die Sprachdatei – so kommen Werte aus der Datenbank
 * (Rechtstexte, Wartungstext) an dieselbe Stelle wie ein fester Text.
 */
export function render(name, lang, vars = {}) {
  const values = {
    lang,
    brand: config.brand,
    year: String(new Date().getFullYear()),
    origin: config.publicUrl,
    // Vorne an jede CSS-, JS- und Bildadresse. Siehe assetVersion in config.js.
    assets: `/assets/v/${assetVersion}`,
    // Welche Textdatei zu dieser Seite gehört. Sie steht am <html>, damit ui.js sie laden kann,
    // ohne selbst zu wissen, welche Sprachen es gibt – siehe server/strings.js.
    stringsFile: strings.fileFor(lang),
    // Kopfdaten. Jede Seite darf sie überschreiben; ohne Angabe steht die Startseite da.
    title: t('meta.title', lang),
    description: t('meta.description', lang),
    robotsTag: '',
    resourceHints: '',
    shieldScript: '',
    // Ob der Inhaltsschutz (shield.js) gilt. Der Wert kommt aus den Einstellungen; index.js
    // setzt ihn bei jeder Seite mit.
    shield: '1',
    bodyClass: 'site',
    path: '',
    ogLocale: lang === 'de' ? 'de_DE' : 'en_GB',
    enCurrent: lang === 'en' ? 'aria-current="true"' : '',
    deCurrent: lang === 'de' ? 'aria-current="true"' : '',
    ...vars,
  };
  // Nur laden, wenn die Bedienungssperre wirklich aktiv ist. Dann bleibt das Skript bewusst im
  // Kopf und synchron, damit kein ungeschütztes erstes Bild aufblitzt. Im Normalbetrieb spart das
  // eine blockierende Datei auf jeder öffentlichen Seite und im Panel.
  if (values.shield === '1') {
    values.shieldScript = `<!-- Vor dem ersten Inhalt: die aktivierte Bedienungssperre gilt sofort. -->
    <script src="${values.assets}/js/shield.js"></script>`;
  }
  // Titel und Beschreibung landen in Attributen – die dürfen keine Anführungszeichen mitbringen.
  values.title = escape(values.title);
  values.description = escape(values.description);
  // Der Punkt in der Kopfleiste, auf dem man gerade steht.
  for (const slug of ['features', 'pricing', 'faq']) {
    const key = `cur${slug[0].toUpperCase()}${slug.slice(1)}`;
    values[key] = values.path === `/${slug}` ? 'aria-current="page"' : '';
  }
  // `Object.hasOwn`, nicht `in`: `in` läuft die Prototypenkette mit hoch, und damit war
  // `{{constructor}}` in einer Vorlage kein unbekannter Platzhalter, sondern der Quelltext der
  // Object-Funktion, mitten in der ausgelieferten Seite. Dasselbe galt für `{{toString}}`,
  // `{{valueOf}}` und `{{__proto__}}`.
  return template(name).replace(/\{\{([a-z0-9_.-]+)\}\}/gi, (match, key) => {
    if (Object.hasOwn(values, key)) return String(values[key] ?? '');
    const text = t(key, lang);
    return text === key ? match : escape(text);
  });
}

/**
 * `<link rel="modulepreload">` für den ganzen Modulbaum einer Seite.
 *
 * **Warum das nötig ist.** Ein Browser findet ein Modul erst, wenn er das Modul gelesen hat, das
 * es importiert. Beim Panel hieß das: erst app.js holen, daraus ui.js erfahren, daraus i18n
 * erfahren – die größte Datei von allen wurde also erst in der dritten Runde überhaupt angefragt.
 * Auf einer Mobilfunkverbindung sind das zwei volle Umläufe, in denen nichts passiert, bevor das
 * größte Stück überhaupt losgeht.
 *
 * Diese Zeilen stehen im `<head>` und nennen den ganzen Baum sofort. Der Browser lädt alles
 * nebeneinander, und wenn app.js ankommt, liegt der Rest schon da.
 *
 * Genannt wird nur, was für das erste Bild wirklich gebraucht wird. Die einzelnen Ansichten des
 * Panels (views/) holt app.js absichtlich erst, wenn jemand hinsieht – sie hier aufzuzählen würde
 * genau das rückgängig machen.
 */
export function preload(lang, modules) {
  const base = `/assets/v/${assetVersion}/js`;
  return [...modules, strings.fileFor(lang)]
    .map((file) => `<link rel="modulepreload" href="${base}/${file}" />`)
    .join('\n    ');
}

/**
 * Die Sprache für diese Anfrage: was in der Adresse steht, sonst was gespeichert ist, sonst was
 * der Browser mitbringt. Gespeichert wird sie im Cookie `lang` (und am Konto, wenn angemeldet).
 */
export function langFor(req) {
  // Steht die Sprache in der Adresse, dann gilt sie. Sie ist die ausdrücklichste Angabe, die es
  // gibt – ausdrücklicher als ein Cookie vom letzten Besuch.
  //
  // Den bekannten Seiten fiel das nie auf: Ihre Route liest `:lang` selbst aus dem Pfad. Die
  // 404-Seite und die Fehlerseite kommen aber hier vorbei, und dort stand es falsch: Wer einem
  // deutschen Link auf eine Seite folgte, die es nicht gibt, las „Nothing here“, obwohl `/de/` in
  // der Adresse stand. Die Route setzt das Sprach-Cookie zwar auf Deutsch, aber das steht in der
  // **Antwort** – die Anfrage, die hier ankommt, trägt es noch nicht.
  const path = String(req.path || '');
  const prefix = path.slice(1, 3);
  if (path[0] === '/' && LANGS.includes(prefix) && (path.length === 3 || path[3] === '/')) {
    return prefix;
  }
  const cookie = readLangCookie(req);
  if (cookie) return cookie;
  if (req.user?.language && LANGS.includes(req.user.language)) return req.user.language;
  const header = String(req.headers['accept-language'] || '');
  const wanted = header
    .split(',')
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean);
  return pickLang(wanted);
}

function readLangCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== 'lang') continue;
    const value = part.slice(eq + 1).trim();
    return LANGS.includes(value) ? value : null;
  }
  return null;
}

export function setLangCookie(res, lang) {
  res.cookie('lang', lang, {
    httpOnly: false, // das Frontend liest sie auch, um die Sprache umzuschalten
    sameSite: 'lax',
    // Kein Geheimnis, aber trotzdem: Ein Cookie ohne `Secure` reist auch über eine unverschlüsselte
    // Verbindung, und wer die mitliest, sieht daran, dass hier jemand ist – und wer sie umschreiben
    // kann, setzt Cookies für die ganze Domain. Auf einer Website, die ausschließlich über HTTPS
    // läuft, gibt es keinen Grund, eines davon auszulassen.
    secure: config.publicUrl.startsWith('https'),
    maxAge: 365 * 86_400_000,
    path: '/',
  });
}

export { LANGS, DEFAULT_LANG, t };
export { escape as escapeHtml };
