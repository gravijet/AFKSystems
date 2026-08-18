// Inhaltsschutz auf der Serverseite.
//
// **Zwei Schalter, zwei Dinge.** `content_protection` ist das hier: CSS und JavaScript lassen sich
// nicht einzeln abrufen und liegen in keinem fremden Zwischenspeicher. `content_lock_ui` ist das
// andere: Rechtsklick, Markieren, Ziehen, Drucken und Entwicklerwerkzeuge im Browser. Das war
// einmal ein Schalter, und das war falsch – wer seine Dateien nicht als Sammlung verschenken will,
// will deswegen noch lange nicht, dass seine Kunden eine Serveradresse nicht markieren können.
// Deshalb ist die Bedienung ab Werk frei und der Rest an.
//
// Was hier möglich ist und was nicht, gehört gleich am Anfang gesagt: Ein Browser **muss** CSS,
// JavaScript und Bilder bekommen, sonst gibt es keine Seite. Es gibt keinen Schalter, der eine
// Website unkopierbar macht – wer entschlossen genug ist, bekommt jede Datei. Was es gibt, ist
// eine Reihe von Hürden, die den bequemen Weg verschließen:
//
//   1. **Kein direkter Aufruf einer Asset-Adresse.** `/assets/…/app.css` im Browser öffnen und
//      "Speichern unter" – das war der einfachste Weg an das ganze Design. Solche Anfragen tragen
//      `Sec-Fetch-Dest: document`; als Stylesheet geladen tragen sie `style`. Die Unterscheidung
//      ist eindeutig, und mehr braucht es dafür nicht.
//   2. **Kein `curl`, kein `wget`, kein Website-Kopierer.** Werkzeuge außerhalb eines Browsers
//      schicken weder `Sec-Fetch-*` noch einen eigenen Referer. Für CSS und JavaScript reicht das
//      als Unterscheidung.
//   3. **Kein Archiv.** `X-Robots-Tag: noarchive` hält die Dateien aus den Zwischenspeichern der
//      Suchmaschinen heraus.
//
// Was **nicht** eingeschränkt wird: die öffentlichen Seiten selbst. Sie sollen gefunden werden,
// und ein Suchmaschinen-Crawler ist genau der Fall, den Punkt 2 sonst aussperren würde.
//
// Abschalten lässt sich das Ganze in den Einstellungen (`content_protection`) – wenn eine
// Umgebung damit nicht zurechtkommt, ist eine Seite, die lädt, mehr wert als eine, die schützt.

import { getSetting } from './db.js';

export const enabled = () => Boolean(Number(getSetting('content_protection') ?? 1));

/**
 * Ist die **Bedienung** gesperrt (Rechtsklick, Markieren, Ziehen, Drucken)?
 *
 * Aus ist die Vorgabe: eine ganz normale Seite. Wer sie einschaltet, bekommt das alte Verhalten
 * zurück – dann greift shield.js im Browser und die `.shielded`-Regeln im CSS.
 */
export const uiLocked = () => Boolean(Number(getSetting('content_lock_ui') ?? 0));

/** Werkzeuge, die eine Website am Stück mitnehmen. Kein Schutzwall, aber die erste Hürde. */
const COPIERS =
  /(httrack|webcopier|webzip|teleport ?pro|offline ?explorer|sitesucker|wget|curl|scrapy|python-requests|libwww|okhttp|go-http-client|node-fetch|axios|httpie|aria2|idm)/i;

/** Wie eine Datei angefragt wurde. Fehlt die Angabe, war es kein moderner Browser. */
const dest = (req) => String(req.headers['sec-fetch-dest'] || '').toLowerCase();

function sameOriginReferer(req, origins) {
  const referer = req.headers.referer;
  if (!referer) return false;
  try {
    return origins.has(new URL(referer).origin);
  } catch {
    return false;
  }
}

/**
 * Die Prüfung für alles unter /assets.
 *
 * `allowedOrigins` kommt aus index.js, damit hier dieselbe Vorstellung davon gilt, was "diese
 * Website" ist – hinter Cloudflare ist das nicht immer die konfigurierte Adresse.
 */
export function assetGuard(allowedOrigins) {
  return (req, res, next) => {
    // Bilder und Schriften bleiben frei: sie stehen in E-Mails (das Logo!), in Vorschaubildern
    // sozialer Netze und in Lesezeichen. Eine Schrift, die nur mit Referer lädt, ist eine Schrift,
    // die irgendwann nicht lädt.
    const isCode = /\.(?:css|js|mjs|map)$/i.test(req.path);
    res.setHeader('X-Robots-Tag', 'noarchive, noimageindex');
    if (!isCode || !enabled()) return next();

    const how = dest(req);
    // So lädt ein Browser eine Datei, die zu einer Seite gehört.
    if (['style', 'script', 'worker', 'serviceworker', 'empty'].includes(how)) return next();
    // Ältere Browser schicken kein Sec-Fetch-Dest, aber einen Referer von der eigenen Seite.
    if (!how && sameOriginReferer(req, allowedOrigins(req))) return next();

    // **Wichtig:** nicht zwischenspeicherbar. Läge diese Absage in einem CDN, bekäme sie danach
    // jeder Besucher – und die Seite wäre für alle kaputt, weil ein Einziger sie einzeln geholt hat.
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).type('text/plain').send('Diese Datei gehört zu einer Seite und wird nicht einzeln ausgeliefert.');
  };
}

/**
 * Wie lange eine Datei liegen bleiben darf – und **wo**.
 *
 * CSS und JavaScript bekommen `private`: der Browser darf sie behalten, ein CDN davor nicht.
 * Ohne das wäre der Schutz oben eine Attrappe – Cloudflare würde die Datei einmal vom Server
 * holen und sie danach jedem ausliefern, der die Adresse kennt, ganz ohne die Prüfung.
 *
 * Bilder und Schriften bleiben `public`: das Vorschaubild für soziale Netze und das Logo in einer
 * E-Mail müssen von überall ladbar sein, und schützenswert ist an ihnen nichts.
 */
export function cacheControl(pathname, current) {
  const isCode = /\.(?:css|js|mjs|map)$/i.test(pathname);
  const age = current ? 'max-age=31536000, immutable' : 'max-age=60';
  if (!isCode) return `public, ${age}`;
  return enabled() ? `private, ${age}` : `public, ${age}`;
}

/**
 * Website-Kopierer vom Dashboard fernhalten.
 *
 * Nur vom Dashboard: Die öffentlichen Seiten sollen von Suchmaschinen gelesen werden, und deren
 * Kennungen von echten Kopierern zu unterscheiden ist ein Spiel, das man nicht gewinnt. Hinter
 * der Anmeldung gibt es dagegen nichts, was ein Werkzeug ohne Browser zu suchen hätte.
 */
export function panelGuard(req, res, next) {
  if (!enabled()) return next();
  if (COPIERS.test(String(req.headers['user-agent'] || ''))) {
    return res.status(403).type('text/plain').send('Nicht erlaubt.');
  }
  next();
}
