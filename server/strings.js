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
/**
 * Welche Texte eine nachgeladene Ansicht wirklich braucht.
 *
 * `i18n.js` bleibt die einzige Quelle. Der Unterschied ist nur der Lieferweg: Der Rahmen des
 * Panels lädt beim ersten Bild seine wenigen Texte; die Texte einer Ansicht kommen zeitgleich mit
 * ihrem ohnehin lazy geladenen Modul. So muss ein Kunde auf der Übersicht weder die Verwaltung
 * noch den Editor für Serverplätze parsen.
 *
 * Präfixe sind absichtlich vollständig (etwa `srv` statt einer zufälligen Auswahl von
 * Servermeldungen). Das macht neue Zustände innerhalb eines Bereichs robust. Einzelne Schlüssel
 * stehen dort, wo eine allgemeine Komponente nur einen Satz aus einem fremden Bereich zeigt.
 */
const SCOPE_RULES = Object.freeze({
  auth: { prefixes: ['auth'], keys: ['common.error'] },
  panel: {
    prefixes: ['common', 'dash', 'nav', 'discord', 'join', 'keys', 'todo', 'state', 'pal', 'tab'],
    keys: [
      'srv.favorite',
      'srv.favoriteAdd',
      'srv.favoriteRemove',
      // Der Reiter "Zusätze" eines Serverplatzes steht in der Seitenleiste – also im
      // Panel-Rahmen selbst (siehe TABS in app.js) – und nicht erst in der lazy geladenen
      // "server"-Ansicht, zu der sein Präfix sonst gehört. Ohne diesen Schlüssel zeigte die
      // Leiste beim allerersten Aufruf eines Serverplatzes in einer Sitzung "ad.title" statt
      // der Beschriftung, weil der Rahmen zu dem Zeitpunkt noch nichts aus dem "server"-Bereich
      // geladen hat.
      'ad.title',
      'adm.viewingAs',
      'adm.backToAdmin',
      'adm.group.work',
      'adm.group.money',
      'adm.group.platform',
      'adm.group.logs',
      'adm.overview',
      'adm.ops',
      'adm.allTickets',
      'adm.templates',
      'adm.users',
      'adm.servers',
      'adm.accounts',
      'adm.plans',
      'adm.addons',
      'adm.topups',
      'adm.vouchers',
      'adm.ledger',
      'adm.settings',
      'adm.nodes',
      'adm.proxies',
      'adm.announce',
      'adm.client',
      'adm.system',
      'adm.security',
      'adm.mails',
      'adm.audit',
    ],
  },
  overview: { prefixes: ['bill', 'onboard', 'ov'], keys: [] },
  accounts: { prefixes: ['acc', 'act', 'faq', 'rules'], keys: ['srv.saved'] },
  activity: { prefixes: ['act', 'set.hook'], keys: [] },
  billing: { prefixes: ['bill', 'ov', 'pricing', 'srv', 'tk'], keys: [] },
  proxies: { prefixes: ['px'], keys: [] },
  settings: { prefixes: ['adm', 'auth', 'bill', 'set', 'srv'], keys: [] },
  tickets: { prefixes: ['adm', 'sec', 'tk', 'tmpl'], keys: [] },
  server: {
    prefixes: [
      'acc', 'act', 'ad', 'adm', 'ch', 'error', 'faq', 'inv', 'join', 'mcstatus', 'nd', 'ov',
      'plan', 'pov', 'pricing', 'px', 'sch', 'srv', 'tk', 'vw',
    ],
    keys: [],
  },
  admin: {
    prefixes: [
      'acc', 'ad', 'adm', 'auth', 'bak', 'bc', 'bill', 'ch', 'error', 'nd', 'ops', 'ov', 'plan',
      'pricing', 'px', 'role', 'sec', 'set', 'srv', 'tk', 'tmpl',
    ],
    keys: [],
  },
  palette: { prefixes: ['acc', 'bill', 'ov', 'srv'], keys: [] },
});

const scopeNames = new Set(Object.keys(SCOPE_RULES));

function inScope(key, scope) {
  if (!scope) return true;
  const rule = SCOPE_RULES[scope];
  if (!rule) return false;
  return rule.keys.includes(key) || rule.prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`));
}

function moduleFor(lang, scope = '') {
  const table = {};
  for (const key of Object.keys(S)) {
    if (!inScope(key, scope)) continue;
    const text = S[key][lang] ?? S[key][DEFAULT_LANG];
    if (text !== undefined) table[key] = text;
  }
  return `// Aus i18n.js für "${lang}"${scope ? ` (${scope})` : ''} erzeugt – siehe server/strings.js.
export const LANG = ${JSON.stringify(lang)};
export const LANGS = ${JSON.stringify(LANGS)};
export const DEFAULT_LANG = ${JSON.stringify(DEFAULT_LANG)};
export const STRINGS = Object.freeze(${JSON.stringify(table)});
export function t(key, vars = null) {
  // \`Object.hasOwn\`, nicht \`S[key]\`: Viele Aufrufe setzen den Schlüssel aus Daten zusammen
  // (\`state.\${zustand}\`). Ein Wert wie \`constructor\` träfe sonst die Prototypenkette – heraus
  // käme kein Text, sondern eine Funktion.
  let text = Object.hasOwn(STRINGS, key) ? STRINGS[key] : key;
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
 * Die fertigen Antworten, je Bereich: der Text, sein ETag und die gepackten Fassungen.
 *
 * Gepackt wird bei der ersten Anfrage danach und nicht bei jeder – aus demselben Grund wie bei
 * den Dateien auf der Platte (siehe assets.js). Anders als dort gibt es jetzt aber nicht mehr
 * zwei Fassungen je Sprache, sondern eine je Bereich: der feste Rahmen und jede der elf
 * Ansichten, mal zwei Sprachen. Alle beim Hochfahren zu packen hätte genau die Ausfallzeit
 * zurückgebracht, die dieser Datei eigentlich wichtig ist – gemessen das Sechsfache der
 * bisherigen Zeit, für Bereiche, die ein einzelner Neustart oft gar nicht anfragt. Stattdessen
 * entsteht ein Eintrag hier erst bei seiner ersten wirklichen Anfrage und bleibt danach so lange
 * im Speicher wie zuvor die ganze Tabelle.
 */
const bundles = new Map();

function bundleFor(lang, scope) {
  const key = scope ? `${scope}.${lang}` : lang;
  const cached = bundles.get(key);
  if (cached) return cached;
  const body = Buffer.from(moduleFor(lang, scope), 'utf8');
  const bundle = {
    identity: body,
    br: zlib.brotliCompressSync(body, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
      },
    }),
    gzip: zlib.gzipSync(body, { level: zlib.constants.Z_BEST_COMPRESSION }),
    etag: `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`,
  };
  bundles.set(key, bundle);
  return bundle;
}

/** Der Dateiname, unter dem die Texte einer Sprache stehen. Relativ zu js/, wie ui.js sie sucht. */
export const fileFor = (lang, scope = '') =>
  `i18n.${scopeNames.has(scope) ? `${scope}.` : ''}${LANGS.includes(lang) ? lang : DEFAULT_LANG}.js`;

/** Wie groß ein Sprachbereich über die Leitung ist – für Startbericht und Prüfungen. */
export const sizeOf = (lang, scope = '') => {
  const safeLang = LANGS.includes(lang) ? lang : DEFAULT_LANG;
  const safeScope = scopeNames.has(scope) ? scope : '';
  return bundleFor(safeLang, safeScope).br.length;
};

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
    const match = /^\/assets(?:\/v\/([A-Za-z0-9_-]{1,64}))?\/js\/i18n(?:\.([a-z-]+))?\.([a-z]{2})\.js$/.exec(req.path);
    if (!match) return next();
    const [, version, scope = '', lang] = match;
    if (scope && !scopeNames.has(scope)) return next();
    if (!LANGS.includes(lang)) return next();
    const bundle = bundleFor(lang, scope);

    res.setHeader('Content-Type', 'text/javascript; charset=UTF-8');
    res.setHeader('Cache-Control', cacheControl(fileFor(lang, scope), current(version)));
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
