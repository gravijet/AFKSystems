// Die Client-Dateien. Sie kommen aus dem Release "latest" von gravijet/HugoAFKClient – dort liegt
// nach jedem Push der frische Stand.
//
// Der Release enthält acht Rust-Bauformen. Optionen wie Proxy, Events und Offline-Modus werden
// aus `--help` erkannt; einkompilierte Module stehen zusätzlich am stabilen Release-Dateinamen,
// weil die knappe Hilfe nicht jeden lokalen Befehl einzeln auflistet.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, paths } from './config.js';

const run = promisify(execFile);

const MANIFEST = path.join(paths.bin, 'manifest.json');

// Minecraft 1.8.8 und 1.8.9 sprechen beide Protokoll 47. Der Rust-Client benennt diesen
// Modus 1.8.9; im Panel darf der Nutzer seine tatsächliche Serverversion wählen.
// Quelle: PrismarineJS/minecraft-data, data/pc/common/protocolVersions.json.
export const clientProtocol = (version) => version === '1.8.8' ? '1.8.9' : version;

export function supportedVersions(versions) {
  return [...new Set(versions.flatMap((version) => version === '1.8.9' ? ['1.8.8', version] : [version]))];
}

export const BUILDS = {
  slim: { file: 'afk-linux', label_de: 'Basis', label_en: 'Base', features: {} },
  move: {
    file: 'afk-linux-move',
    label_de: 'Bewegung',
    label_en: 'Movement',
    features: { local: true, movement: true },
  },
  items: {
    file: 'items-afk-linux',
    label_de: 'Gegenstände',
    label_en: 'Items',
    features: { local: true, menu: true, items: true },
  },
  itemsWeb: {
    file: 'items-web-afk-linux',
    label_de: 'Gegenstände + Browser-Menü',
    label_en: 'Items + browser menu',
    features: { local: true, menu: true, items: true, webmenu: true },
  },
  premium: {
    file: 'premium-afk-linux',
    label_de: 'Premium',
    label_en: 'Premium',
    features: {
      local: true,
      movement: true,
      premium: true,
      board: true,
      menu: true,
      state: true,
      sneak: true,
      antiafk: true,
    },
  },
  premiumItems: {
    file: 'premium-items-afk-linux',
    label_de: 'Premium + Gegenstände',
    label_en: 'Premium + items',
    features: {
      local: true,
      movement: true,
      premium: true,
      board: true,
      menu: true,
      items: true,
      state: true,
      sneak: true,
      antiafk: true,
    },
  },
  pov: {
    file: 'pov-afk-linux',
    label_de: 'POV',
    label_en: 'POV',
    features: { local: true, pov: true, menu: true, items: true, webmenu: true },
  },
  ultra: {
    file: 'ultra-afk-linux',
    label_de: 'Ultra',
    label_en: 'Ultra',
    features: {
      local: true,
      movement: true,
      premium: true,
      board: true,
      menu: true,
      items: true,
      state: true,
      sneak: true,
      antiafk: true,
      pov: true,
      webmenu: true,
    },
  },
};

/**
 * Was `--help` verrät. Jeder Schlüssel ist ein Muster, das in der Hilfe stehen muss.
 *
 * Der Grund für dieses Verfahren steht in docs/aufbau.md: Es gibt nirgends eine gepflegte Liste
 * von Fähigkeiten, die veralten könnte. Bekommt der Client eine neue Option, taucht sie in seiner
 * Hilfe auf, und das Panel benutzt sie – bekommt er sie nicht, bleibt der Knopf dafür aus.
 *
 * Die Einträge ab `viewdistance` kamen mit Client 2.1.0 bis 2.5.0 dazu. Sie einfach mitzuschicken
 * wäre riskant: Eine ältere Bauform, die `--pov-size` nicht kennt, bricht damit beim Start ab, und
 * dann liefe gar kein Bot mehr.
 */
const PROBES = {
  proxy: /--proxy\b/,
  fakehost: /--fakehost\b/,
  offline: /--offline\b/,
  events: /--events\b/,
  macros: /--on\s+</,
  oncooldown: /--on-cooldown\b/,
  antiafk: /--antiafk\b/,
  sneak: /--sneak\b/,
  /** `--view-distance <2-32>`: wie viele Chunks der Client anfordert. */
  viewdistance: /--view-distance\b/,
  /** `--pov an|aus`: ob die Live-Ansicht schon beim Beitritt läuft. */
  povstart: /--pov\s+an\|aus/,
  /** `--pov-size <b>x<h>`: die Bildgröße von Anfang an, ohne Umweg über `:pov size`. */
  povsize: /--pov-size\b/,
  /** `--pov-fps <1-20>`: wie oft gezeichnet wird. */
  povfps: /--pov-fps\b/,
  /**
   * `--pov-web <port|ip:port>`: der eigene HTTP-Viewer des Clients (ab 2.5.0).
   *
   * Das ist die Live-Ansicht **mit echten Texturen**: keine Halbblöcke im Terminal, sondern ein
   * fertiges PNG, dazu Hotbar, Menü und Inventar als Daten. Er lauscht auf 127.0.0.1 und gibt beim
   * Start eine Adresse mit Zugriffstoken aus – das Panel liest sie mit und reicht die Anfragen
   * seiner Kunden durch (siehe supervisor.js `webFetch`).
   */
  povweb: /--pov-web\b/,
  /** `--pov-resources <client.jar>`: woher der Viewer Blockmodelle, Texturen und GUI nimmt. */
  povresources: /--pov-resources\b/,
  /**
   * `--pov-resources <jar|auto|aus>`: ab 2.6.0 **findet der Client die JAR selbst**.
   *
   * Bis 2.5.0 war der Pfad Pflicht: Ohne hinterlegte Original-JAR gab es keinen texturierten
   * Viewer. Ab 2.6.0 sucht der Client in seiner eigenen Ablage, in einer vorhandenen
   * Minecraft-Installation und lädt sie zuletzt von Mojang – geprüft an der SHA-1 aus dem
   * öffentlichen Versionsmanifest.
   *
   * Erkannt an der Schreibweise der Werte in der Hilfe und nicht an `--pov-resources` allein: Die
   * Option gab es vorher auch, sie konnte nur weniger. Ohne diesen Unterschied schickte das Panel
   * einer 2.5.0-Datei `--pov-web` ohne Pfad, und der Viewer stünde ohne Texturen da.
   */
  povresourcesauto: /--pov-resources\s+<jar\|auto\|aus>/,
  /**
   * `--no-reconnect`: **ab 2.6.0 verbindet sich der Client nach einem Kick von selbst neu.**
   *
   * Für dieses Panel ist das die wichtigste Zeile des ganzen Release. Es *ist* die Aufsicht, von
   * der die Release-Notes sprechen – warum es deshalb immer `--no-reconnect` schickt, steht in
   * supervisor.js bei `args()`.
   */
  noreconnect: /--no-reconnect\b/,
};

export const state = {
  ready: false,
  tag: null,
  publishedAt: null,
  checkedAt: null,
  assets: [],
  versions: [],
  defaultVersion: '26.1',
  clientVersion: null,
  /** build -> { present, version, stamp, caps: {…} } */
  builds: {},
  error: null,
};

/**
 * Der Fingerabdruck einer Client-Datei: Fassung, Größe, Änderungszeit.
 *
 * **Wozu.** Ein Bot läuft tage- und wochenlang. Der Stundentakt holt in dieser Zeit jedes neue
 * Release – die Datei auf der Platte ist danach die neue, der laufende Prozess aber immer noch der
 * alte: Er hält seine Datei offen und merkt von der Ablösung nichts. Bisher stand das nirgends,
 * und das Ergebnis war ein Panel, das „Client 2.6.0“ meldete, während zwanzig Bots seit vierzehn
 * Tagen 2.5.0 waren – samt der Fehler, wegen derer 2.6.0 gebaut wurde.
 *
 * Die Fassungsnummer allein reicht dafür nicht: Ein Release ohne Versionssprung (ein Fix, ein
 * neuer Bau derselben Nummer) wäre daran nicht zu erkennen. Größe und Änderungszeit erkennen jede
 * ausgetauschte Datei, und die Nummer davor macht den Abdruck für Menschen lesbar.
 */
export function stampOf(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return null;
  }
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return {};
  }
}

const writeManifest = (data) => fs.writeFileSync(MANIFEST, JSON.stringify(data, null, 2));

async function github(url) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'afksystems-panel' };
  if (config.githubToken) headers.authorization = `Bearer ${config.githubToken}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GitHub ${response.status} für ${url}`);
  return response.json();
}

async function download(asset, target) {
  const headers = { 'user-agent': 'afksystems-panel', accept: 'application/octet-stream' };
  if (config.githubToken) headers.authorization = `Bearer ${config.githubToken}`;
  const response = await fetch(asset.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length !== asset.size) throw new Error('Die Dateigröße stimmt nicht mit dem Release überein.');
  if (asset.digest && asset.digest !== `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`) {
    throw new Error('Die SHA-256-Prüfsumme stimmt nicht mit dem Release überein.');
  }
  const temp = `${target}.${crypto.randomUUID()}.neu`;
  try {
    fs.writeFileSync(temp, buffer, { mode: Object.values(BUILDS).some(b => b.file === asset.name) ? 0o755 : 0o600, flag: 'wx' });
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return buffer.length;
}

/** Release abrufen und alles holen, was sich geändert hat. */
let syncing = null;
export function sync(options = {}) {
  if (syncing) return syncing;
  syncing = syncRelease(options).finally(() => { syncing = null; });
  return syncing;
}

async function syncRelease({ force = false } = {}) {
  const manifest = readManifest();
  try {
    const release = await github(
      `https://api.github.com/repos/${config.clientRepo}/releases/tags/${config.clientTag}`
    );
    state.tag = release.tag_name;
    state.publishedAt = release.published_at;
    state.assets = release.assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      updated_at: asset.updated_at,
    }));

    // **Jede Datei für sich.** Vorher stand der ganze Durchlauf in einem einzigen `try`: Ein
    // Download, der scheiterte (Netz weg, Datei gerade ersetzt, GitHub antwortet mit 502), brach
    // die Schleife ab – und alles, was in der alphabetischen Reihenfolge dahinter lag, wurde nie
    // geholt. Die Bauform am Ende der Liste ist `ultra-afk-linux`, also ausgerechnet die für
    // Premium-Kunden mit Live-Ansicht. Sichtbar war davon nur ein Satz in `state.error`.
    const failed = [];
    for (const asset of release.assets) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.name)) {
        failed.push('Ungültiger Release-Dateiname');
        continue;
      }
      const target = path.join(paths.bin, asset.name);
      const known = manifest[asset.name];
      if (!force && fs.existsSync(target) && known && known.updated_at === asset.updated_at &&
          fs.statSync(target).size === asset.size && (!asset.digest ||
          asset.digest === `sha256:${crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')}`)) continue;
      try {
        // Über die API-Adresse, nicht über browser_download_url: nur so klappt der Download auch
        // bei einem privaten Repository (mit Token im Kopf).
        await download(asset, target);
        manifest[asset.name] = { updated_at: asset.updated_at, size: asset.size };
        if (Object.values(BUILDS).some((build) => build.file === asset.name)) fs.chmodSync(target, 0o755);
      } catch (error) {
        failed.push(`${asset.name} (${error.message})`);
      }
    }
    manifest._release = { tag: release.tag_name, published_at: release.published_at };
    writeManifest(manifest);
    state.error = failed.length ? `Nicht geladen: ${failed.join(', ')}` : null;
  } catch (error) {
    // Ohne Netz läuft das Panel mit dem weiter, was schon da ist.
    state.error = error.message;
  }

  state.checkedAt = Date.now();
  await detect();
  return state;
}

/** Versionen und Fähigkeiten aus den Dateien selbst lesen. */
export async function detect() {
  state.builds = {};
  for (const [key, build] of Object.entries(BUILDS)) {
    const file = path.join(paths.bin, build.file);
    const entry = {
      key,
      file: build.file,
      present: fs.existsSync(file),
      caps: { ...build.features },
      version: null,
      stamp: stampOf(file),
    };
    state.builds[key] = entry;
    if (!entry.present) continue;
    try {
      // Ausführbar machen, falls sie es noch nicht ist – aber nur dann, und ein Fehlschlag ist
      // kein Grund, die Datei für nicht vorhanden zu erklären. Gehört sie einem anderen Benutzer
      // und ist längst ausführbar (Verzeichnis von der Platte übernommen, Datei aus einem Paket,
      // Verknüpfung auf eine Ablage), warf `chmod` EPERM – und weil das im selben `try` stand,
      // galten danach **alle** Bauformen als fehlend und kein einziger Bot ließ sich starten.
      // Ob eine Datei taugt, beantwortet ohnehin erst der Aufruf darunter.
      try {
        if (!(fs.statSync(file).mode & 0o111)) fs.chmodSync(file, 0o755);
      } catch {
        // Rechte lassen sich nicht setzen. Wenn sie stimmen, merkt es niemand; wenn nicht,
        // scheitert gleich der `--help`-Aufruf mit einer Meldung, die das sagt.
      }
      const { stdout } = await run(file, ['--help'], { timeout: 15_000 });
      const help = stdout;
      // "AFKSystems 2.0.0 – schlanker Minecraft-AFK-Client"
      entry.version = /^AFKSystems\s+(\S+)/m.exec(help)?.[1] || null;
      for (const [cap, probe] of Object.entries(PROBES)) entry.caps[cap] = probe.test(help);

      // "-m, --mc <version>  Protokoll: 1.21.1 | 1.21.11 | 26.1 | 26.2  (Standard: 26.1)"
      const line = /Protokoll:\s*([^\n(]+?)\s*\(Standard:\s*([^)]+)\)/.exec(help);
      if (line) {
        entry.versions = supportedVersions(line[1].split('|').map((v) => v.trim()).filter(Boolean));
        entry.defaultVersion = line[2].trim();
      }
    } catch (error) {
      entry.present = false;
      entry.error = error.message;
    }
  }

  const slim = state.builds.slim;
  const any = Object.values(state.builds).find((build) => build?.present);
  state.ready = Boolean(any);
  state.clientVersion = any?.version || null;
  state.versions = any?.versions || [];
  state.defaultVersion = any?.defaultVersion || state.defaultVersion;
  if (!state.ready && !state.error) state.error = 'Es liegt keine Client-Datei in data/bin.';
  if (state.ready && !slim?.present) {
    const missing = 'Die schlanke Bauform (afk-linux) fehlt – Gratis-Plätze können nicht starten.';
    if (!state.error?.includes(missing)) state.error = [state.error, missing].filter(Boolean).join(' ');
  }
  return state;
}

/** Fähigkeiten einer Bauform (fehlt sie, kann sie nichts). */
export function caps(build = 'slim') {
  return state.builds[build]?.caps || {};
}

/**
 * Fassung und Abdruck einer Bauform, so wie sie **jetzt** auf der Platte liegt.
 *
 * Ein Bot merkt sich beim Start, was hier stand; wer die beiden später vergleicht, weiß, ob unter
 * ihm die Datei gewechselt hat.
 */
export const versionOf = (build) => state.builds[build]?.version || null;
export const stampFor = (build) => state.builds[build]?.stamp || null;

/** Alles, was irgendeine vorhandene Bauform kann – für die Feature-Liste auf der Startseite. */
export function anyCaps() {
  const out = {};
  for (const entry of Object.values(state.builds)) {
    if (!entry.present) continue;
    for (const [cap, value] of Object.entries(entry.caps)) out[cap] = out[cap] || value;
  }
  return out;
}

/**
 * Welche Bauform ein Serverplatz benutzt. Premium-Tarife bekommen den Premium-Client automatisch;
 * ist er nicht da, wird die nächstbeste vorhandene genommen, damit ein fehlender Download nicht
 * gleich alle Bots stilllegt.
 */
export function buildFor(profile, plan) {
  let want = 'slim';
  // **Die Live-Ansicht entscheidet, nicht der Tarifname.** Bis hierher bekam der Ultra-Tarif immer
  // `ultra-afk-linux`, auch ohne gebuchte Live-Ansicht – "die Datei zum Tarif". Der Unterschied
  // dieser Bauform zu `premium-items-afk-linux` ist aber genau eine Sache: Sie hält die geladene
  // Welt vor, um daraus Bilder rechnen zu können. Wer keine Live-Ansicht gebucht hat, bekommt aus
  // dieser Arbeit nichts – `gateCaps()` blendet sie ohnehin aus –, zahlt sie aber in
  // Arbeitsspeicher und Rechenzeit mit, und trägt jeden Fehler mit, der nur in diesem Teil steckt.
  // An den sichtbaren Fähigkeiten ändert das nichts: Beide Bauformen können Premium, Anzeigetafel,
  // Menüs, Gegenstände und Bewegung.
  if (plan?.pov) want = plan?.premium ? 'ultra' : 'pov';
  else if (plan?.premium && plan?.menus) want = 'premiumItems';
  else if (plan?.premium) want = 'premium';
  else if (plan?.menus) want = 'itemsWeb';
  else if (profile?.movement && plan?.movement) want = 'move';

  const order = {
    ultra: ['ultra', 'premiumItems', 'premium', 'move', 'slim'],
    pov: ['pov', 'ultra', 'slim'],
    premiumItems: ['premiumItems', 'ultra', 'premium', 'move', 'slim'],
    premium: ['premium', 'premiumItems', 'ultra', 'move', 'slim'],
    items: ['items', 'premiumItems', 'ultra', 'slim'],
    itemsWeb: ['itemsWeb', 'items', 'premiumItems', 'ultra', 'slim'],
    move: ['move', 'premium', 'premiumItems', 'ultra', 'slim'],
    slim: ['slim'],
  };
  for (const key of order[want]) {
    if (state.builds[key]?.present) return key;
  }
  return null;
}

/** Startbefehl für einen Serverplatz. */
export function command(profile, plan) {
  const build = buildFor(profile, plan);
  if (!build) {
    throw new Error('Der Client wurde noch nicht geladen. Im Admin-Bereich "Client abgleichen".');
  }
  return {
    command: path.join(paths.bin, BUILDS[build].file),
    file: BUILDS[build].file,
    build,
    caps: caps(build),
  };
}

/** Der Weg für Aufgaben ohne Profil (Anmeldung, Kontenliste). Nimmt, was da ist. */
export function anyCommand() {
  for (const key of ['slim', 'move', 'premium', 'premiumItems', 'items', 'itemsWeb', 'ultra', 'pov']) {
    if (state.builds[key]?.present) {
      return { command: path.join(paths.bin, BUILDS[key].file), build: key, caps: caps(key) };
    }
  }
  throw new Error('Der Client wurde noch nicht geladen.');
}

/** Dateien in data/bin – nur für den Admin-Bereich. */
export function files() {
  return fs
    .readdirSync(paths.bin)
    .filter((name) => name !== 'manifest.json' && !name.endsWith('.neu'))
    .map((name) => {
      const stat = fs.statSync(path.join(paths.bin, name));
      return { name, size: stat.size, changed: stat.mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Direktaufruf: node server/binaries.js [--force]
if (process.argv[1] && process.argv[1].endsWith('binaries.js')) {
  sync({ force: process.argv.includes('--force') }).then(() => {
    console.log(JSON.stringify({ ...state, assets: state.assets.map((a) => a.name) }, null, 2));
  });
}
