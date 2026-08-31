// Die Client-Dateien. Sie kommen aus dem Release "latest" von gravijet/HugoAFKClient – dort liegt
// nach jedem Push der frische Stand.
//
// Der Release enthält sieben Rust-Bauformen. Optionen wie Proxy, Events und Offline-Modus werden
// aus `--help` erkannt; einkompilierte Module stehen zusätzlich am stabilen Release-Dateinamen,
// weil die knappe Hilfe nicht jeden lokalen Befehl einzeln auflistet.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, paths } from './config.js';

const run = promisify(execFile);

const MANIFEST = path.join(paths.bin, 'manifest.json');

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
    features: { local: true, pov: true },
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
  /** build -> { present, version, caps: {…} } */
  builds: {},
  error: null,
};

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
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub ${response.status} für ${url}`);
  return response.json();
}

async function download(url, target) {
  const headers = { 'user-agent': 'afksystems-panel', accept: 'application/octet-stream' };
  if (config.githubToken) headers.authorization = `Bearer ${config.githubToken}`;
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok) throw new Error(`Download ${response.status}: ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const temp = `${target}.neu`;
  fs.writeFileSync(temp, buffer);
  fs.renameSync(temp, target);
  return buffer.length;
}

/** Release abrufen und alles holen, was sich geändert hat. */
export async function sync({ force = false } = {}) {
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
      const target = path.join(paths.bin, asset.name);
      const known = manifest[asset.name];
      if (!force && fs.existsSync(target) && known && known.updated_at === asset.updated_at) continue;
      try {
        // Über die API-Adresse, nicht über browser_download_url: nur so klappt der Download auch
        // bei einem privaten Repository (mit Token im Kopf).
        await download(asset.url, target);
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
        entry.versions = line[1].split('|').map((v) => v.trim()).filter(Boolean);
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
    state.error = 'Die schlanke Bauform (afk-linux) fehlt – Gratis-Plätze können nicht starten.';
  }
  return state;
}

/** Fähigkeiten einer Bauform (fehlt sie, kann sie nichts). */
export function caps(build = 'slim') {
  return state.builds[build]?.caps || {};
}

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
  else if (plan?.menus) want = 'items';
  else if (profile?.movement && plan?.movement) want = 'move';

  const order = {
    ultra: ['ultra', 'premiumItems', 'premium', 'move', 'slim'],
    pov: ['pov', 'ultra', 'slim'],
    premiumItems: ['premiumItems', 'ultra', 'premium', 'move', 'slim'],
    premium: ['premium', 'premiumItems', 'ultra', 'move', 'slim'],
    items: ['items', 'premiumItems', 'ultra', 'slim'],
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
  for (const key of ['slim', 'move', 'premium', 'premiumItems', 'items', 'ultra', 'pov']) {
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
