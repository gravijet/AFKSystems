// Automatische Schnappschüsse der Live-Ansicht – ein Bild, das das Panel selbst zieht, sobald ein
// Bot stirbt oder die Verbindung verliert, statt darauf zu hoffen, dass gerade jemand hinsieht.
//
// Liegen als PNG unter data/snapshots/<zufälliger Name>.png; welcher Bot wann welches Bild bekommen
// hat, steht in `bot_events` (Typ "snapshot", `detail` trägt den Dateinamen). Das Verzeichnis ist
// deshalb kein eigener Bestand: Räumt `supervisor.cleanupEvents()` eine Zeile weg, räumt es auch die
// Datei dahinter weg (siehe dort).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from './config.js';

const dir = () => paths.snapshots;

/** Ein von hier vergebener Dateiname – nie ein Pfad, den jemand von außen mitgegeben hat. */
const NAME = /^[0-9a-f]{32}\.png$/;
export const valid = (name) => NAME.test(String(name || ''));

/** Ein Bild ablegen. Gibt den Dateinamen zurück, den `bot_events.detail` trägt. */
export function save(buffer) {
  fs.mkdirSync(dir(), { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}.png`;
  fs.writeFileSync(path.join(dir(), name), buffer);
  return name;
}

/** Ein Bild lesen – `null`, wenn es (mehr) da ist, nicht ein geworfener Fehler. */
export function read(name) {
  if (!valid(name)) return null;
  try {
    return fs.readFileSync(path.join(dir(), name));
  } catch {
    return null;
  }
}

/** Ein Bild wegräumen, wenn die Ereigniszeile dazu verfällt. Fehlt es schon, ist das kein Fehler. */
export function remove(name) {
  if (!valid(name)) return;
  try {
    fs.unlinkSync(path.join(dir(), name));
  } catch {
    /* schon weg */
  }
}
