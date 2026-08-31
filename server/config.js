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
  publicUrl: (process.env.PUBLIC_URL || 'https://afksystems.de').replace(/\/+$/, ''),
  brand: process.env.BRAND || 'AFKSystems',

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
  public: path.join(ROOT, 'public'),
};

for (const dir of [config.dataDir, paths.bin, paths.users, paths.logs, paths.resources, paths.backups]) {
  fs.mkdirSync(dir, { recursive: true });
}

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

/** Verzeichnis mit den Minecraft-Konten eines Nutzers (wird dem Client als XDG_CONFIG_HOME gegeben). */
export function userDir(userId) {
  const dir = path.join(paths.users, String(userId));
  fs.mkdirSync(path.join(dir, 'afksystems', 'accounts'), { recursive: true });
  return dir;
}
