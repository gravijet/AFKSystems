// Sicherungen der Datenbank – aus dem Panel heraus, ohne SSH.
//
// In dieser einen Datei steht alles, was AFKSystems weiß: Konten, Guthaben, Buchungen, Tarife,
// Tickets, Serverplätze. Sie ist ein paar hundert Kilobyte groß, und wer sie verliert, verliert
// den Betrieb – nicht ein Bild, nicht ein Protokoll, sondern alles. Eine Sicherung davon war
// bisher eine Sache für die Kommandozeile, und Sicherungen, für die man sich anmelden muss,
// macht niemand regelmäßig.
//
// **`VACUUM INTO` und nicht `cp`.** SQLite schreibt hier im WAL-Modus: Neben der Datenbankdatei
// steht ein Schreibprotokoll, und die eigentliche Datei ist zwischen zwei Checkpoints nicht auf
// dem neuesten Stand. Eine Kopie mit `cp` erwischt deshalb im schlimmsten Fall eine Datei ohne
// die letzten Buchungen – oder, wenn sie mitten in einen Schreibvorgang fällt, eine kaputte.
// `VACUUM INTO` schreibt dagegen eine in sich abgeschlossene, aufgeräumte Datei aus dem Zustand
// **jetzt**, ohne den laufenden Betrieb anzuhalten. Das Ergebnis lässt sich sofort öffnen.
//
// **Keine Rückspielung von hier aus.** Eine Datenbank auszutauschen, während das Panel auf ihr
// arbeitet, geht nicht gut aus: Offene Verbindungen zeigen weiter auf die alte Datei, laufende
// Bots schreiben in beide. Der Weg zurück steht deshalb als Befehl in der Ansicht und wird von
// Hand gegangen – mit angehaltenem Dienst, wie es sich gehört (siehe docs/aufbau.md).
//
// **Eine Sicherung ist ein Generalschlüssel.** Passwort-Hashes, Sitzungen, Token für Standorte
// und Bot – alles darin. Sie liegt deshalb nicht unter den öffentlichen Dateien, der Download
// geht nur mit Administratorsitzung und steht im Protokoll.

import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting } from './db.js';
import { paths, config } from './config.js';

/** Wie eine Sicherungsdatei heißen darf – daran wird auch beim Herunterladen geprüft. */
const NAME = /^[a-z0-9-]+-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?\.db$/;

const stamp = (at = new Date()) =>
  [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, '0'),
    String(at.getDate()).padStart(2, '0'),
    String(at.getHours()).padStart(2, '0') + String(at.getMinutes()).padStart(2, '0'),
  ].join('-');

const prefix = () => String(config.brand).toLowerCase().replace(/\W+/g, '-');

/**
 * Eine Sicherung anlegen.
 *
 * Der Name trägt Datum und Uhrzeit, damit die Liste sich von selbst sortiert und niemand raten
 * muss, welche die neuere ist. Zwei Sicherungen in derselben Minute bekommen eine Nummer dazu –
 * das ist kein erfundener Fall, sondern das, was passiert, wenn jemand zweimal auf den Knopf
 * drückt, weil beim ersten Mal nichts zu sehen war.
 */
export function create({ automatic = false } = {}) {
  fs.mkdirSync(paths.backups, { recursive: true });
  let name = `${prefix()}-${stamp()}.db`;
  let counter = 1;
  while (fs.existsSync(path.join(paths.backups, name))) {
    name = `${prefix()}-${stamp()}-${counter++}.db`;
  }
  const target = path.join(paths.backups, name);
  // Der Pfad steht in einfachen Anführungszeichen im SQL – ein Apostroph darin wäre eine Lücke.
  // Er kommt aus dieser Datei und enthält keinen, aber das gilt nur, solange es jemand prüft.
  if (target.includes("'")) throw new Error('Sicherungspfad mit Apostroph.');
  db.exec(`VACUUM INTO '${target}'`);
  // Eine Sicherung ist ein Generalschlüssel (siehe oben) – sie liegt deshalb so eng wie die
  // Datenbank selbst. `VACUUM INTO` richtet sich nach der umask des Prozesses, und die ist beim
  // Start von Hand oder aus einer fremden Umgebung nicht zwingend die aus dem systemd-Unit.
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    /* Dateisystem ohne Rechte – die Sicherung ist trotzdem geschrieben */
  }
  const info = fs.statSync(target);
  prune();
  return { name, size: info.size, created_at: info.mtimeMs, automatic };
}

/** Was da ist – neueste zuerst. */
export function list() {
  if (!fs.existsSync(paths.backups)) return [];
  return fs
    .readdirSync(paths.backups)
    .filter((name) => NAME.test(name))
    .map((name) => {
      const info = fs.statSync(path.join(paths.backups, name));
      return { name, size: info.size, created_at: info.mtimeMs };
    })
    .sort((a, b) => b.created_at - a.created_at);
}

/** Der Pfad zu einer Sicherung – oder nichts, wenn der Name nicht zu einer gehört. */
export function fileFor(name) {
  if (!NAME.test(String(name || ''))) return null;
  const target = path.join(paths.backups, name);
  return fs.existsSync(target) ? target : null;
}

export function remove(name) {
  const target = fileFor(name);
  if (!target) return false;
  fs.unlinkSync(target);
  return true;
}

/**
 * Alte Sicherungen wegräumen.
 *
 * Wie viele bleiben, sagt eine Einstellung. Ohne Grenze läuft die Platte irgendwann voll, und
 * das merkt der Betreiber an dem Tag, an dem der Client-Download nicht mehr passt – nicht an dem,
 * an dem die Sicherungen zu viel werden.
 */
export function prune() {
  const keep = Math.max(1, Number(getSetting('backup_keep')) || 14);
  const gone = list().slice(keep);
  for (const entry of gone) fs.unlinkSync(path.join(paths.backups, entry.name));
  return gone.length;
}

/** Zusammen mit `list()` alles, was die Ansicht wissen muss. */
export function state() {
  const entries = list();
  return {
    entries,
    total: entries.reduce((sum, entry) => sum + entry.size, 0),
    keep: Math.max(1, Number(getSetting('backup_keep')) || 14),
    daily: Boolean(Number(getSetting('backup_daily'))),
    dir: paths.backups,
    db: paths.db,
  };
}

/**
 * Der Takt: höchstens eine Sicherung am Tag, und nur wenn der Betreiber sie eingeschaltet hat.
 *
 * Läuft aus dem Stundentakt in index.js. Die Entscheidung fällt an der jüngsten Sicherung und
 * nicht an einer gemerkten Uhrzeit: Ein Panel, das nachts neu startet, hätte die sonst vergessen
 * und macht mit dieser Regel einfach beim nächsten Durchlauf weiter.
 */
export function dailyTick() {
  if (!Number(getSetting('backup_daily'))) return null;
  const newest = list()[0];
  if (newest && Date.now() - newest.created_at < 20 * 3_600_000) return null;
  return create({ automatic: true });
}
