// Die Minecraft-Köpfe – über diesen Server statt aus dem Browser des Kunden.
//
// **Was vorher passierte.** Im Panel steht neben jedem Minecraft-Konto sein Kopf, und die Adresse
// dazu war `https://minotar.net/helm/<name>/64.png`, direkt im `src`. Damit schickte der Browser
// jedes Kunden bei jedem Seitenaufruf eine Anfrage zu einem fremden Anbieter, und in dieser
// Anfrage standen zwei Dinge: der Name des Minecraft-Kontos und die IP-Adresse des Kunden.
//
// Das passt nicht zu dem, was das Panel sonst tut. Ein paar Zeilen weiter bekommt Gravatar
// ausdrücklich nur den MD5-Abdruck der E-Mail-Adresse und nie die Adresse selbst, und der
// Kunde kann Profilbilder ganz abschalten. Beim Kopf gab es diese Wahl nicht: Er kam bei jedem
// Aufruf, bei jedem Konto, für jeden Kunden.
//
// **Was jetzt passiert.** Der Browser fragt `/api/heads/<name>.png` auf dieser Maschine. Von
// dort holt der Server das Bild einmal, legt es auf die Platte und liefert es fortan von dort.
// Für den Fremden sieht das aus wie ein Server, der ein Bild holt – nicht wie tausend Kunden,
// die ihre Kontenliste öffnen.
//
// Zwei Nebenwirkungen, die genauso viel wert sind:
//
//   * **Es geht auch, wenn der Fremde nicht antwortet.** Ist Minotar langsam oder aus, kommt der
//     Kopf aus dem Zwischenspeicher; und war er noch nie da, kommt ein neutraler Kopf statt eines
//     kaputten Bildsymbols. Eine Kontenliste voller zerbrochener Bilder sieht aus, als wäre das
//     Panel kaputt, und nicht der Bildserver.
//   * **Es ist schneller.** Ein Kunde mit zwanzig Konten öffnete zwanzig Verbindungen zu einem
//     fremden Host. Jetzt liegen zwanzig Dateien hier, mit langer Haltbarkeit im Browser.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from './config.js';

/** Woher die Köpfe kommen. Eine Adresse, ein Host – mehr wird nie geholt. */
const SOURCE = (value) => `https://minotar.net/helm/${encodeURIComponent(value)}/64.png`;

/** Wie lange eine Datei gilt, bevor sie neu geholt wird. Ein Skin ändert sich selten. */
const MAX_AGE_MS = 7 * 86_400_000;

/** Wie lange ein Fehlschlag nachwirkt. Ohne das klopft jede Seite erneut an einen toten Host. */
const FAIL_MS = 10 * 60_000;

/** Wie lange gewartet wird. Ein Bild ist Beiwerk; die Seite darf darauf nicht stehen bleiben. */
const TIMEOUT_MS = 4000;

/** Größer als das kann ein Kopf von 64 × 64 nicht sein – alles darüber ist keine Antwort für uns. */
const MAX_BYTES = 64 * 1024;

const dir = () => paths.heads;

/**
 * Was als Name durchgeht.
 *
 * Minecraft-Namen sind drei bis sechzehn Zeichen aus Buchstaben, Ziffern und Unterstrich; dazu
 * kommt die UUID, mit und ohne Bindestriche. Alles andere wird gar nicht erst geholt: Diese
 * Zeichenkette landet in einer Adresse zu einem fremden Host, und was dorthin geht, gehört
 * vorher geprüft und nicht hinterher entschärft.
 */
const VALID = /^[A-Za-z0-9_]{1,16}$|^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/;

export const valid = (name) => VALID.test(String(name || ''));

/**
 * Die Adresse, die im Panel in einem `src` steht.
 *
 * Immer eine Zeichenkette, nie `null`. Ein leeres `src` ist im Browser keine Leerstelle, sondern
 * die aktuelle Seite: Er lädt sie ein zweites Mal, um daraus ein Bild zu machen. Was kein
 * gültiger Name ist, bekommt hier trotzdem eine Adresse – und von dort den neutralen Kopf.
 */
export const urlFor = (name) => `/api/heads/${encodeURIComponent(String(name ?? ''))}.png`;

/**
 * Der Dateiname auf der Platte.
 *
 * Ein Abdruck und nicht der Name selbst: Namen unterscheiden sich auf manchen Dateisystemen
 * nicht in der Groß-/Kleinschreibung, und dann wäre `Steve` dieselbe Datei wie `steve`. Beim
 * Abdruck ist das eine Entscheidung, die hier steht (kleingeschrieben, also derselbe Kopf) und
 * keine, die das Dateisystem für uns trifft.
 */
const fileFor = (name) =>
  path.join(dir(), `${crypto.createHash('sha256').update(String(name).toLowerCase()).digest('hex').slice(0, 32)}.png`);

/**
 * Der neutrale Kopf, wenn es keinen gibt.
 *
 * Ein PNG aus einem einzigen grauen Pixel, das der Browser auf die Kantenlänge des Bildes zieht –
 * eine ruhige Fläche an der Stelle, an der sonst ein Kopf steht. Es liegt als Bytes hier und
 * nicht als Datei im Projekt, damit es nicht fehlen kann: Genau in dem Moment, in dem es
 * gebraucht wird, ist die Außenwelt ohnehin gerade nicht erreichbar.
 */
let fallbackCache = null;
function fallback() {
  if (fallbackCache) return fallbackCache;
  fallbackCache = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mM8UA8AAgcBQvKZfSAAAAAASUVORK5CYII=',
    'base64'
  );
  return fallbackCache;
}

/** Wann zuletzt vergeblich angeklopft wurde, je Name. */
const failed = new Map();

/** Wer gerade schon holt. Zwanzig Konten auf einer Seite sind sonst zwanzig gleiche Anfragen. */
const inFlight = new Map();

async function download(name) {
  const response = await fetch(SOURCE(name), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'image/png' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_BYTES) throw new Error('zu groß');
  // Wirklich ein PNG? Was von einem fremden Host kommt, wird nicht auf sein Wort hin
  // weitergereicht – und ein Bildhost, der plötzlich HTML liefert, ist ein Bildhost mit einer
  // Störungsseite.
  if (body.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('kein PNG');
  return body;
}

/**
 * Den Kopf zu einem Namen – aus dem Zwischenspeicher, sonst geholt, sonst der neutrale.
 *
 * Gibt immer etwas zurück und wirft nie. Ein Kopf ist Beiwerk; eine Kontenliste, die wegen eines
 * fremden Bildservers eine Fehlerseite zeigt, wäre die Störung, die aus einer Kleinigkeit eine
 * Störung macht.
 */
export async function headFor(name) {
  if (!valid(name)) return { body: fallback(), fresh: false };
  const file = fileFor(name);

  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs < MAX_AGE_MS) {
      return { body: fs.readFileSync(file), fresh: true };
    }
  } catch {
    // Noch nicht da – das ist der Normalfall beim ersten Mal.
  }

  const lastFail = failed.get(name) || 0;
  if (Date.now() - lastFail < FAIL_MS) {
    // Eine alte Datei ist besser als der neutrale Kopf, auch wenn sie über ihre Zeit ist.
    try {
      return { body: fs.readFileSync(file), fresh: true };
    } catch {
      return { body: fallback(), fresh: false };
    }
  }

  let pending = inFlight.get(name);
  if (!pending) {
    pending = download(name)
      .then((body) => {
        fs.mkdirSync(dir(), { recursive: true });
        // Erst daneben schreiben, dann umbenennen: Ein Abbruch mitten im Schreiben hinterlässt
        // sonst eine halbe Datei, die ab dann als gültiger Zwischenspeicher gilt.
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, body);
        fs.renameSync(temporary, file);
        failed.delete(name);
        return body;
      })
      .catch(() => {
        failed.set(name, Date.now());
        // Die Landkarte der Fehlschläge darf nicht wachsen, solange jemand Namen erfinden kann.
        if (failed.size > 5000) failed.clear();
        return null;
      })
      .finally(() => inFlight.delete(name));
    inFlight.set(name, pending);
  }

  const body = await pending;
  if (body) return { body, fresh: true };
  try {
    return { body: fs.readFileSync(file), fresh: true };
  } catch {
    return { body: fallback(), fresh: false };
  }
}

/** Alte Dateien wegräumen. Läuft im Stundentakt mit dem übrigen Aufräumen aus index.js. */
export function cleanup() {
  let gone = 0;
  try {
    const limit = Date.now() - 30 * 86_400_000;
    for (const entry of fs.readdirSync(dir())) {
      const file = path.join(dir(), entry);
      try {
        if (fs.statSync(file).mtimeMs < limit) {
          fs.unlinkSync(file);
          gone += 1;
        }
      } catch {
        /* schon weg */
      }
    }
  } catch {
    // Das Verzeichnis gibt es erst, wenn der erste Kopf geholt wurde.
  }
  return gone;
}
