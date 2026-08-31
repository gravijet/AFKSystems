// Die Original-Client-JARs von Minecraft – eine je Protokollversion.
//
// Warum das Panel sie überhaupt braucht: Seit Client 2.5.0 hat die Live-Ansicht neben der
// Terminalausgabe aus Halbblöcken einen **texturierten** Modus. Der Client rechnet das Bild
// weiterhin selbst aus den geladenen Chunks – aber welche Farbe eine Eichenholzstufe hat, welches
// Modell eine Treppe, wie ein Truhenfenster aussieht und welches Symbol ein Gegenstand trägt,
// steht in den Ressourcen des echten Spiels. Der Client liest sie mit `--pov-resources <jar>` und
// legt dabei **keine Kopie** an: er greift beim Zeichnen in die Datei, die hier liegt.
//
// Deshalb liegt hier nichts im Repository und nichts im Release des Clients. Wer die texturierte
// Ansicht anbieten will, legt die JAR selbst hin – dieselbe Datei, die der offizielle Launcher
// unter `~/.minecraft/versions/<version>/<version>.jar` ablegt. Sie lässt sich im Admin-Bereich
// hochladen oder, wo Mojang sie öffentlich anbietet, direkt von dort holen.
//
// Fehlt sie, ist nichts kaputt: Der Bot startet ohne `--pov-web`, und die Live-Ansicht bleibt die
// farbige Voxelansicht, die sie vorher war (siehe docs/live-ansicht.md).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from './config.js';

/** Wie eine Versionsangabe aussehen darf. Sie wird zum Dateinamen – also nichts mit Pfad darin. */
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/;

/**
 * Obergrenze für eine hochgeladene Datei.
 *
 * Eine Client-JAR ist je nach Version 20 bis 40 MB groß. 128 MB lassen jeder künftigen Version
 * Luft und sind immer noch weit von "jemand lädt hier ein Abbild seiner Platte hoch" entfernt.
 */
export const MAX_BYTES = 128 * 1024 * 1024;

/** Woran man eine Client-JAR erkennt: genau die Verzeichnisse, aus denen der Viewer liest. */
const MARKERS = ['assets/minecraft/textures/block/', 'assets/minecraft/models/block/'];

const file = (version) => path.join(paths.resources, `${version}.jar`);

/** Fingerabdrücke, gemerkt bis sich Größe oder Zeitstempel ändern (wie in routes/node.js). */
const digests = new Map();

function digest(version) {
  const target = file(version);
  const stat = fs.statSync(target);
  const key = `${stat.size}:${stat.mtimeMs}`;
  const known = digests.get(version);
  if (known?.key === key) return known.sha256;
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  digests.set(version, { key, sha256 });
  return sha256;
}

export const validVersion = (raw) => VERSION.test(String(raw || ''));

/** Der Pfad zur JAR dieser Version – oder null, wenn keine dort liegt. */
export function pathFor(version) {
  if (!validVersion(version)) return null;
  const target = file(version);
  return fs.existsSync(target) ? target : null;
}

export const has = (version) => Boolean(pathFor(version));

/**
 * Ist das wirklich eine Minecraft-Client-JAR?
 *
 * Die Prüfung ist bewusst grob und ehrlich: ZIP-Kennung am Anfang, und im Inhalt müssen die beiden
 * Verzeichnisse vorkommen, aus denen der Viewer wirklich liest. Dateinamen stehen in einem ZIP im
 * Klartext, das genügt dafür. Was hier durchkommt, ist kein Beweis – aber die drei Fälle, die
 * wirklich vorkommen, fängt es ab: die Server-JAR statt der Client-JAR, das ganze
 * `versions`-Verzeichnis als ZIP, und eine Datei, die beim Hochladen kaputtgegangen ist.
 */
export function looksLikeClientJar(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1024) return false;
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false; // "PK"
  return MARKERS.every((marker) => buffer.includes(marker));
}

/**
 * Eine JAR ablegen. Erst daneben schreiben, dann umbenennen: ein laufender Client hat die alte
 * Datei offen, und eine halb geschriebene Datei unter demselben Namen wäre für ihn Datenmüll.
 */
export function store(version, buffer) {
  if (!validVersion(version)) throw new Error(`"${version}" ist keine gültige Versionsangabe.`);
  if (!looksLikeClientJar(buffer)) {
    throw new Error(
      'Das sieht nicht nach einer Minecraft-Client-JAR aus. Gebraucht wird die Datei aus ' +
        '~/.minecraft/versions/<version>/<version>.jar – nicht die Server-JAR.'
    );
  }
  fs.mkdirSync(paths.resources, { recursive: true });
  const target = file(version);
  const temp = `${target}.neu`;
  fs.writeFileSync(temp, buffer);
  fs.renameSync(temp, target);
  digests.delete(version);
  return info(version);
}

export function remove(version) {
  if (!validVersion(version)) return false;
  try {
    fs.unlinkSync(file(version));
    digests.delete(version);
    return true;
  } catch {
    return false;
  }
}

/** Was über eine Version zu sagen ist – auch, wenn keine Datei da ist. */
export function info(version) {
  const entry = { version, present: false, size: 0, sha256: null, changed: null };
  if (!validVersion(version)) return entry;
  let stat;
  try {
    stat = fs.statSync(file(version));
  } catch {
    return entry;
  }
  return {
    version,
    present: true,
    size: stat.size,
    sha256: digest(version),
    changed: stat.mtimeMs,
  };
}

/** Alle Versionen, die der Client sprechen kann, mit dem Zustand ihrer JAR. */
export function list(versions = []) {
  const known = new Set(versions.filter(validVersion));
  // Auch was hier liegt, ohne dass der Client es (noch) spricht: sonst verschwände eine
  // hochgeladene Datei aus der Anzeige, sobald eine Client-Fassung eine Version fallen lässt –
  // und niemand käme darauf, dass sie noch Platz belegt.
  try {
    for (const name of fs.readdirSync(paths.resources)) {
      if (name.endsWith('.jar')) known.add(name.slice(0, -4));
    }
  } catch {
    /* noch kein Verzeichnis – dann gibt es eben nur die Versionen des Clients */
  }
  return [...known].sort().map(info);
}

// ---------------------------------------------------------------- Von Mojang holen
//
// Denselben Weg geht der offizielle Launcher: ein Verzeichnis aller Versionen, darin je eine
// JSON-Datei mit der Adresse und dem SHA-1 der Client-JAR. Das ist bequemer als "lade dir den
// Launcher herunter, starte die Version einmal und such die Datei" – aber es geht nur für
// Versionen, die dort auch stehen. Snapshots und alles, was Mojang nicht (mehr) anbietet, muss
// hochgeladen werden, und das sagt die Fehlermeldung dann auch.

const MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

async function json(url, timeoutMs = 30_000) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'afksystems-panel' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} für ${url}`);
  return response.json();
}

/** Die Client-JAR einer Version bei Mojang holen und ablegen. */
export async function fetchFromMojang(version) {
  if (!validVersion(version)) throw new Error(`"${version}" ist keine gültige Versionsangabe.`);
  const manifest = await json(MANIFEST);
  const entry = (manifest.versions || []).find((candidate) => candidate.id === version);
  if (!entry) {
    throw new Error(
      `Mojang führt "${version}" nicht im Verzeichnis. Bitte die Datei aus dem Launcher hochladen.`
    );
  }
  const detail = await json(entry.url);
  const download = detail?.downloads?.client;
  if (!download?.url) throw new Error(`Für "${version}" bietet Mojang keine Client-JAR an.`);

  const response = await fetch(download.url, {
    headers: { 'user-agent': 'afksystems-panel' },
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok) throw new Error(`Download ${response.status} für "${version}".`);
  const buffer = Buffer.from(await response.arrayBuffer());

  // Mojang nennt den SHA-1 der Datei. Ihn zu prüfen kostet nichts und beantwortet die einzige
  // Frage, die bei einem Download über die Leitung offen bleibt: ob alles angekommen ist.
  if (download.sha1) {
    const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
    if (sha1 !== download.sha1) {
      throw new Error('Die geladene Datei stimmt nicht mit dem Fingerabdruck von Mojang überein.');
    }
  }
  return store(version, buffer);
}
