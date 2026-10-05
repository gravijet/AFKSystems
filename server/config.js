// Konfiguration. Alles kommt aus der Umgebung, mit Vorgaben, die auf diesem Server sofort laufen.
// Eine .env wird gelesen, wenn sie neben package.json liegt – ohne Zusatzpaket, das Format ist
// bewusst simpel (KEY=VALUE je Zeile, # ist ein Kommentar).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile();

const num = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
};
const bool = (key, fallback) => {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const config = {
  port: num('PORT', 3010),
  host: process.env.HOST || '127.0.0.1',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3010').replace(/\/+$/, ''),
  brand: process.env.BRAND || 'AFKSystems',

  // Nur bekannte Reverse-Proxies dürfen die Client-IP über X-Forwarded-For bestimmen. Die
  // Vorgabe "loopback" passt zum mitgelieferten nginx und bleibt auch dann sicher, wenn Node
  // versehentlich direkt ins Netz lauscht. Weitere Netze müssen ausdrücklich konfiguriert werden.
  trustProxy: process.env.TRUST_PROXY || 'loopback',

  // Alles Veränderliche liegt unter data/: Datenbank, Client-Binaries, Konten je Nutzer, Logs.
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),

  // Woher die Client-Dateien kommen. Das Release "latest" wird bei jedem Push neu gebaut.
  clientRepo: process.env.CLIENT_REPO || 'gravijet/HugoAFKClient',
  clientTag: process.env.CLIENT_TAG || 'latest',
  githubToken: process.env.GITHUB_TOKEN || '',

  // Sitzungen
  sessionDays: num('SESSION_DAYS', 30),
  secret: process.env.SECRET || '',

  // Wer beim ersten Start Admin wird (sonst: der erste registrierte Nutzer).
  adminEmail: (process.env.ADMIN_EMAIL || '').toLowerCase(),

  registrationOpen: bool('REGISTRATION_OPEN', true),

  // Zahlungen laufen über Stripe. Alles dafür steht in den Einstellungen im Panel (siehe
  // settings-schema.js) und nicht hier: der Betreiber soll seine Kasse einrichten können, ohne
  // eine Datei auf dem Server anzufassen und den Dienst neu zu starten.
  bankTransfer: {
    holder: process.env.BANK_HOLDER || '',
    iban: process.env.BANK_IBAN || '',
    bic: process.env.BANK_BIC || '',
    paypal: process.env.PAYPAL_ME || '',
  },

  // Obergrenzen, damit ein einzelnes Konto den Server nicht auffrisst.
  maxBotsPerUser: num('MAX_BOTS_PER_USER', 25),
  maxBotsTotal: num('MAX_BOTS_TOTAL', 200),
  chatHistoryMax: num('CHAT_HISTORY_MAX', 50000),
};

export const paths = {
  db: path.join(config.dataDir, 'afksystems.db'),
  bin: path.join(config.dataDir, 'bin'),
  users: path.join(config.dataDir, 'users'),
  logs: path.join(config.dataDir, 'logs'),
  // Die Original-Client-JARs von Minecraft, eine je Protokollversion. Sie kommen nicht aus dem
  // Release des Clients und liegen deshalb nicht bei den Bauformen (siehe server/resources.js).
  resources: path.join(config.dataDir, 'mc'),
  // Sicherungen der Datenbank. Sie liegen neben ihr und nicht darin: Wer den Datenbestand
  // wegkopiert, nimmt damit auch die Sicherungen mit (siehe server/backup.js).
  backups: path.join(config.dataDir, 'backups'),
  // Die Minecraft-Köpfe, einmal geholt und danach von hier ausgeliefert. Sie liegen bewusst
  // unter data/ und nicht unter public/: Es ist ein Zwischenspeicher und kein Bestandteil des
  // Projekts, und beim Ausrollen wird er nicht mitkopiert (siehe server/heads.js).
  heads: path.join(config.dataDir, 'heads'),
  // Automatische Schnappschüsse der Live-Ansicht bei Tod/Trennung (siehe server/snapshots.js).
  // Wie `heads`: kein eigener Bestand, entsteht erst mit dem ersten Bild.
  snapshots: path.join(config.dataDir, 'snapshots'),
  public: path.join(ROOT, 'public'),
};

for (const dir of [config.dataDir, paths.bin, paths.users, paths.logs, paths.resources, paths.backups]) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Was unter data/ liegt, geht nur den Dienst etwas an.
 *
 * In der Datenbank stehen Passwort-Hashes, Sitzungen, die Token der Standorte und das Geheimnis
 * des Bots; unter `users/` liegen die Microsoft-Anmeldungen der Kunden; unter `backups/` liegt
 * beides noch einmal. Das systemd-Unit setzt dafür `UMask=0077`, aber das gilt nur für Dateien,
 * die **dieser** Dienst neu anlegt – eine von Hand kopierte Datenbank, ein Bestand aus einer
 * älteren Fassung oder ein Umzug mit `scp` bringt seine eigenen Rechte mit, und die sind
 * gewöhnlich `0644`. Auf einer Maschine mit einem zweiten Benutzer ist das der ganze Betrieb zum
 * Mitlesen.
 *
 * Deshalb wird es bei jedem Start nachgezogen, und zwar nachsichtig: Ein Dateisystem, das keine
 * Rechte kann, und eine Datei, die jemand anderem gehört, sind ein Grund für eine Zeile im
 * Protokoll – nicht dafür, den Dienst nicht hochfahren zu lassen.
 */
export function tighten(target, mode) {
  try {
    fs.chmodSync(target, mode);
  } catch {
    /* fremder Eigentümer oder ein Dateisystem ohne Rechte – der Dienst läuft trotzdem */
  }
}
for (const dir of [config.dataDir, paths.bin, paths.users, paths.logs, paths.resources, paths.backups]) {
  tighten(dir, 0o700);
}
// Die Datenbank selbst wird in db.js nachgezogen, und nicht hier: Sie existiert in diesem Moment
// womöglich noch gar nicht – bei einem ersten Start legt sie erst `new Database(...)` an, und ein
// `chmod` auf eine Datei, die es nicht gibt, schützt nichts.

// Der Sitzungsschlüssel darf nicht bei jedem Neustart wechseln, sonst wäre jeder ausgeloggt.
if (!config.secret) {
  const file = path.join(config.dataDir, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''), {
      mode: 0o600,
    });
  }
  config.secret = fs.readFileSync(file, 'utf8').trim();
}

/**
 * Unsichere Produktionskonfiguration nicht stillschweigend hinnehmen.
 * Entwicklung und Tests dürfen bewusst über HTTP und mit Wegwerf-Schlüsseln laufen; live wären
 * dieselben Werte eine Umgehung der Schutzmechanismen, die der übrige Code voraussetzt.
 */
if (process.env.NODE_ENV === 'production') {
  let publicAddress;
  try {
    publicAddress = new URL(config.publicUrl);
  } catch {
    throw new Error('PUBLIC_URL muss im Produktionsbetrieb eine vollständige HTTPS-Adresse sein.');
  }
  if (
    publicAddress.protocol !== 'https:' ||
    publicAddress.username ||
    publicAddress.password ||
    publicAddress.search ||
    publicAddress.hash
  ) {
    throw new Error('PUBLIC_URL muss im Produktionsbetrieb eine vollständige HTTPS-Adresse ohne Zugangsdaten sein.');
  }
  if (String(config.secret).length < 32) {
    throw new Error('SECRET muss im Produktionsbetrieb mindestens 32 Zeichen lang sein.');
  }
  if (config.trustProxy === 'true') {
    throw new Error('TRUST_PROXY=true vertraut beliebigen Absendern. Bitte nur konkrete Proxy-Netze eintragen.');
  }
  if (!Number.isFinite(config.sessionDays) || config.sessionDays < 1 || config.sessionDays > 30) {
    throw new Error('SESSION_DAYS muss im Produktionsbetrieb zwischen 1 und 30 liegen.');
  }
}

/**
 * Fingerabdruck über alles unter public/assets.
 *
 * Warum es ihn gibt: CSS und JS lagen mit `max-age=7d` im Browser und bei Cloudflare. Die Seiten
 * selbst kommen immer frisch vom Server – nach einem Deployment traf also neues HTML auf altes
 * CSS und altes JavaScript. Das Ergebnis sah aus wie "das CSS lädt nicht" und "anmelden geht
 * nicht", war aber nur ein Cache, der eine Woche lang an der alten Fassung festhielt.
 *
 * Der Fingerabdruck steht deshalb in jeder Adresse: /assets/v/<fingerabdruck>/css/app.css. Ändert
 * sich eine Datei, ändert sich die Adresse, und niemand bekommt mehr eine Mischung aus alt und
 * neu. Erst damit darf man überhaupt lange cachen.
 *
 * Die relativen Importe im JavaScript und die Schriften im CSS erben den Fingerabdruck von selbst,
 * weil sie relativ zur eigenen Adresse aufgelöst werden – ein Bauschritt ist dafür nicht nötig.
 */
export const assetVersion = fingerprint(path.join(paths.public, 'assets'));

function fingerprint(dir) {
  const hash = crypto.createHash('sha256');
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      // Die vorgepackten Fassungen (app.css.br, app.css.gz – siehe server/assets.js) bleiben
      // außen vor. Sie tragen keinen eigenen Inhalt, sondern nur denselben in anderer Form: Sie
      // mitzuzählen hieße, dass derselbe Quellstand vor und nach dem Packen zwei verschiedene
      // Fingerabdrücke bekommt – und das Lesen doppelt so lange dauert.
      if (/\.(?:br|gz)$/.test(entry.name)) continue;
      // Pfad mit hinein: eine umbenannte Datei ist auch eine Änderung.
      hash.update(path.relative(dir, file));
      hash.update(fs.readFileSync(file));
    }
  };
  try {
    walk(dir);
  } catch {
    // Kein Verzeichnis, keine Adressen mit Fingerabdruck – die Seite läuft trotzdem.
    return 'dev';
  }
  return hash.digest('base64url').slice(0, 16);
}

/**
 * Verzeichnis mit den Minecraft-Konten eines Nutzers – **und es wird angelegt**.
 *
 * Für alles, was dort etwas ablegt oder einen Client startet, ist genau das richtig. Wer nur
 * nachsehen will, ob etwas da ist, nimmt `userPath`: Ein `mkdir` bei jedem Blick ist ein
 * Schreibzugriff auf die Platte für eine Frage, die keinen braucht.
 */
export function userDir(userId) {
  const dir = path.join(paths.users, String(userId));
  fs.mkdirSync(path.join(dir, 'afksystems', 'accounts'), { recursive: true });
  return dir;
}

/** Derselbe Pfad, nur ohne ihn anzulegen. */
export const userPath = (userId) => path.join(paths.users, String(userId));
