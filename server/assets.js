// Statische Dateien ausliefern, ohne sie jedes Mal neu zu packen.
//
// **Das Problem.** CSS und JavaScript gehen komprimiert über die Leitung – ohne das wäre die große
// Sprachdatei des Panels ein Vielfaches ihrer Größe. Bisher erledigte das `compression` bei jeder
// Anfrage neu: Ein Besucher, dessen Browser das Stylesheet noch nicht hat, kostete den Server
// gemessen gut zwei Millisekunden reine Rechenzeit für das Stylesheet und noch einmal gut vier für
// die Sprachdatei – für zwei Dateien, die sich zwischen zwei Deployments **nicht ein einziges Mal**
// ändern. Bei jedem Besucher wieder, für exakt dasselbe Ergebnis.
//
// **Die Lösung.** Einmal beim Ausrollen packen und das Ergebnis danebenlegen: `app.css`,
// `app.css.br`, `app.css.gz`. Zur Laufzeit wird nur noch die passende Datei geöffnet und
// hinausgeschrieben – dieselbe Arbeit wie bei einem Bild.
//
// Und weil das Packen nun einmalig ist statt millionenfach, darf es gründlich sein: Brotli auf
// höchster Stufe ist zu teuer, um es je Anfrage zu tun, aber es liefert für dieselben Dateien
// spürbar weniger Bytes als das gzip-Mittelmaß, mit dem eine Kompression zur Laufzeit rechnen muss.
// Der Besucher bekommt also gleichzeitig eine schnellere Antwort und eine kleinere.
//
// **Ohne vorgepackte Dateien läuft alles wie bisher.** In der Entwicklung gibt es sie nicht; dann
// findet dieses Modul nichts, reicht die Anfrage weiter, und `compression` packt wie gehabt. Es
// gibt keinen Zustand, der zwischen beiden Fällen auseinanderlaufen könnte: Die gepackten Dateien
// werden aus dem Original erzeugt und tragen keinen eigenen Inhalt.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Was sich zu packen lohnt.
 *
 * Bilder und Schriften stehen nicht dabei: WebP, PNG und WOFF2 sind bereits komprimiert, und ein
 * zweiter Durchgang macht sie nur größer.
 */
const COMPRESSIBLE = /\.(?:css|js|mjs|map|json|svg|txt|xml|webmanifest)$/i;

/**
 * Unter dieser Größe lohnt es nicht.
 *
 * Derselbe Schwellwert wie bei `compression` in index.js: Bei ein paar hundert Bytes kostet der
 * Kopf des Kompressionsformats mehr, als der Inhalt einspart.
 */
const MIN_BYTES = 1024;

/** Die Endungen, die eine gepackte Fassung trägt – in der Reihenfolge, in der wir sie anbieten. */
const ENCODINGS = [
  { suffix: '.br', name: 'br' },
  { suffix: '.gz', name: 'gzip' },
];

/** Ist das eine von uns erzeugte gepackte Fassung? */
export const isPacked = (file) => ENCODINGS.some((entry) => file.endsWith(entry.suffix));

/** Der Name der Originaldatei zu einer gepackten Fassung. */
export const unpackedName = (file) => {
  for (const entry of ENCODINGS) {
    if (file.endsWith(entry.suffix)) return file.slice(0, -entry.suffix.length);
  }
  return file;
};

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

/**
 * Für jede passende Datei unter `dir` eine Brotli- und eine gzip-Fassung anlegen.
 *
 * Läuft beim Ausrollen (siehe scripts/protect-assets.mjs), nicht im Betrieb. Eine gepackte Fassung,
 * die am Ende größer wäre als das Original, wird nicht geschrieben – dann liefert der Server lieber
 * das Original aus.
 */
export function pack(dir) {
  let written = 0;
  let saved = 0;
  for (const file of filesUnder(dir)) {
    if (isPacked(file) || !COMPRESSIBLE.test(file)) continue;
    const source = fs.readFileSync(file);
    if (source.length < MIN_BYTES) continue;
    const packed = {
      '.br': zlib.brotliCompressSync(source, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
        },
      }),
      '.gz': zlib.gzipSync(source, { level: zlib.constants.Z_BEST_COMPRESSION }),
    };
    for (const [suffix, body] of Object.entries(packed)) {
      if (body.length >= source.length) {
        fs.rmSync(`${file}${suffix}`, { force: true });
        continue;
      }
      fs.writeFileSync(`${file}${suffix}`, body);
      written += 1;
    }
    saved += source.length - packed['.br'].length;
  }
  return { written, saved };
}

/** Welche Kodierungen dieser Browser annimmt. */
function accepted(header) {
  const raw = String(header || '').toLowerCase();
  if (!raw) return new Set();
  const names = new Set();
  for (const part of raw.split(',')) {
    const [name, ...params] = part.trim().split(';');
    // `br;q=0` heißt "nimm ich ausdrücklich nicht".
    if (params.some((param) => /^\s*q=0(?:\.0+)?\s*$/.test(param))) continue;
    names.add(name.trim());
  }
  return names;
}

/**
 * Vor `express.static`: Gibt es zu dieser Datei eine gepackte Fassung, die der Browser annimmt,
 * wird sie statt des Originals ausgeliefert.
 *
 * Die Umschreibung passiert an `req.url`, damit `express.static` danach seine gewohnte Arbeit tut –
 * Datum, ETag, Bereichsanfragen, `304 Not Modified`. Was der Browser bekommt, ist dann eine ganz
 * gewöhnliche komprimierte Antwort; nur dass niemand sie in diesem Moment berechnet hat.
 *
 * `res.locals.assetOriginal` merkt sich den ursprünglichen Namen: Die Kopfzeilen danach
 * (Inhaltstyp, Haltbarkeit, Inhaltsschutz) hängen an `.css` und `.js` und dürfen sich von einem
 * angehängten `.br` nicht verwirren lassen.
 */
export function preferPacked(root) {
  return (req, res, next) => {
    // Bereichsanfragen bleiben außen vor: Wer einen Ausschnitt anfragt, soll nicht ungefragt den
    // Ausschnitt einer anderen Darstellung bekommen. Für CSS und JavaScript kommt das ohnehin nicht
    // vor – hier steht es, damit es auch dann stimmt, wenn doch.
    if (req.headers.range || (req.method !== 'GET' && req.method !== 'HEAD')) return next();

    const [pathname] = req.url.split('?');
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return next(); // kaputtes Prozent-Encoding: soll express.static beantworten, nicht wir
    }
    if (!COMPRESSIBLE.test(decoded)) return next();

    // `path.join` normalisiert – ein `..` im Pfad landet damit außerhalb von `root` und fällt hier
    // auf. express.static prüft das ebenfalls; diese Zeile ist dafür da, dass wir nicht vorher
    // schon eine Datei außerhalb anfassen.
    const target = path.join(root, decoded);
    if (target !== root && !target.startsWith(root + path.sep)) return next();

    const takes = accepted(req.headers['accept-encoding']);
    for (const { suffix, name } of ENCODINGS) {
      if (!takes.has(name)) continue;
      if (!fs.existsSync(`${target}${suffix}`)) continue;
      res.locals.assetOriginal = decoded;
      res.setHeader('Content-Encoding', name);
      // Ohne `Vary` legt ein Zwischenspeicher die Brotli-Fassung für einen Browser ab, der sie
      // nicht versteht.
      res.setHeader('Vary', 'Accept-Encoding');
      req.url = `${pathname}${suffix}${req.url.slice(pathname.length)}`;
      return next();
    }
    next();
  };
}
