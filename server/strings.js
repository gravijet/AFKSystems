// Die Texte des Panels – je Sprache einzeln, für den Browser.
//
// **Warum das hier steht.** public/assets/js/i18n.js ist die Quelle für alles Geschriebene, und sie
// führt jeden Text in beiden Sprachen nebeneinander. Für den Server ist das genau richtig: Er
// liefert dieselbe Seite auf Deutsch und auf Englisch aus und braucht beides. Für den Browser ist
// es das nicht. Dort wurden bisher rund tausendvierhundert Schlüssel in zwei Sprachen geladen,
// geparst und zu Objekten gemacht, damit die Hälfte davon nie angesehen wird – hundertdreißig
// Kilobyte übersetztes JavaScript, das mit Abstand größte Stück auf dem Weg zum ersten Bild, und
// gut die Hälfte davon in einer Sprache, die dieser Besucher nicht ausgewählt hat.
//
// Also bekommt der Browser eine Fassung mit **einer** Sprache. Nicht als Datei im Projekt und
// nicht als Bauschritt: beides wären Abschriften, die irgendwann nicht mehr zur Quelle passen.
// Sondern hier, einmal beim Hochfahren aus derselben Tabelle gerechnet, die der Server selbst
// benutzt. Damit kann sie per Konstruktion nicht veralten.
//
// **Die Adresse trägt den Fingerabdruck** wie jede andere Asset-Adresse (siehe assetVersion in
// config.js). Da i18n.js unter public/assets liegt, ändert jeder geänderte Text den Fingerabdruck
// und damit die Adresse – ein Browser bekommt nie eine alte Textfassung zu neuem Code.

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { LANGS, DEFAULT_LANG, S } from '../public/assets/js/i18n.js';

/**
 * Ein ESM-Modul mit den Texten einer Sprache.
 *
 * `t` nimmt hier **keine** Sprache entgegen, anders als das `t` in i18n.js. Im Browser gibt es nur
 * eine: sie steht im ausgelieferten HTML, und ein Wechsel lädt die Seite neu. Ein Argument, das
 * nichts mehr bewirkt, wäre eine Einladung, `t('…', 'en')` zu schreiben und Englisch zu erwarten.
 */
function moduleFor(lang) {
  const table = {};
  for (const key of Object.keys(S)) {
    const text = S[key][lang] ?? S[key][DEFAULT_LANG];
    if (text !== undefined) table[key] = text;
  }
  return `// Aus i18n.js für "${lang}" erzeugt – siehe server/strings.js.
export const LANG = ${JSON.stringify(lang)};
export const LANGS = ${JSON.stringify(LANGS)};
export const DEFAULT_LANG = ${JSON.stringify(DEFAULT_LANG)};
const S = ${JSON.stringify(table)};
export function t(key, vars = null) {
  // \`Object.hasOwn\`, nicht \`S[key]\`: Viele Aufrufe setzen den Schlüssel aus Daten zusammen
  // (\`state.\${zustand}\`). Ein Wert wie \`constructor\` träfe sonst die Prototypenkette – heraus
  // käme kein Text, sondern eine Funktion.
  let text = Object.hasOwn(S, key) ? S[key] : key;
  if (vars) {
    for (const name of Object.keys(vars)) text = text.replaceAll(\`{\${name}}\`, String(vars[name]));
  }
  return text;
}
`;
}

/**
 * Wie gründlich Brotli hier packen darf.
 *
 * Bei den Dateien auf der Platte ist die Antwort "so gründlich wie möglich" – die werden beim
 * Ausrollen gepackt, und dort ist Zeit (siehe assets.js). Hier nicht: Dieses Modul wird beim
 * Hochfahren ausgewertet, **bevor** der Dienst seinen Port aufmacht. Jede Millisekunde ist
 * Ausfallzeit bei einem Neustart.
 *
 * Gemessen an diesem Text: Stufe 11 braucht 133 ms und liefert 22.399 Bytes, Stufe 10 braucht
 * 45 ms und liefert 22.804. Vierhundert Bytes gegen hundert Millisekunden weniger Ausfall bei
 * jedem Neustart – und zwar für beide Sprachen, also gegen zweihundert.
 */
const BROTLI_QUALITY = 10;

/**
 * Die fertigen Antworten, je Sprache: der Text, sein ETag und die gepackten Fassungen.
 *
 * Gepackt wird beim Hochfahren und nicht je Anfrage – aus demselben Grund wie bei den Dateien auf
 * der Platte (siehe assets.js).
 */
const bundles = new Map(
  LANGS.map((lang) => {
    const body = Buffer.from(moduleFor(lang), 'utf8');
    return [
      lang,
      {
        identity: body,
        br: zlib.brotliCompressSync(body, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
          },
        }),
        gzip: zlib.gzipSync(body, { level: zlib.constants.Z_BEST_COMPRESSION }),
        etag: `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`,
      },
    ];
  })
);

/** Der Dateiname, unter dem die Texte einer Sprache stehen. Relativ zu js/, wie ui.js sie sucht. */
export const fileFor = (lang) => `i18n.${LANGS.includes(lang) ? lang : DEFAULT_LANG}.js`;

/** Wie groß die Texte einer Sprache über die Leitung sind – für den Startbericht. */
export const sizeOf = (lang) => bundles.get(LANGS.includes(lang) ? lang : DEFAULT_LANG).br.length;

/**
 * Der Handler für /assets/v/<fingerabdruck>/js/i18n.<sprache>.js.
 *
 * `cacheControl` und `current` kommen von außen, damit hier dieselbe Regel gilt wie für jede
 * andere Asset-Adresse: mit passendem Fingerabdruck ein Jahr, ohne eine Minute.
 *
 * Die Adresse ohne Fingerabdruck gilt ebenfalls – wie bei den Dateien daneben. Sie kommt vor,
 * wenn jemand eine Seite offen hat, die vor dem letzten Deployment geladen wurde: Deren ui.js
 * sucht die Texte relativ zu ihrer eigenen Adresse. Ohne diese Zeile bekäme sie eine 404 – und
 * ohne Texte ist das Panel für sie leer.
 */
export function handler({ cacheControl, current }) {
  return (req, res, next) => {
    const match = /^\/assets(?:\/v\/([A-Za-z0-9_-]{1,64}))?\/js\/i18n\.([a-z]{2})\.js$/.exec(req.path);
    if (!match) return next();
    const [, version, lang] = match;
    const bundle = bundles.get(lang);
    if (!bundle) return next();

    res.setHeader('Content-Type', 'text/javascript; charset=UTF-8');
    res.setHeader('Cache-Control', cacheControl(`i18n.${lang}.js`, current(version)));
    res.setHeader('ETag', bundle.etag);
    res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === bundle.etag) return res.status(304).end();

    const takes = String(req.headers['accept-encoding'] || '').toLowerCase();
    const encoding = takes.includes('br') ? 'br' : takes.includes('gzip') ? 'gzip' : null;
    const body = encoding ? bundle[encoding] : bundle.identity;
    // Gesetzt, bevor `compression` an die Reihe kommt – dann lässt es die Antwort in Ruhe.
    if (encoding) res.setHeader('Content-Encoding', encoding);
    res.setHeader('Content-Length', String(body.length));
    if (req.method === 'HEAD') return res.end();
    res.end(body);
  };
}
