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

/** Was `--help` verrät. Jeder Schlüssel ist eine Zeichenkette, die in der Hilfe stehen muss. */
const PROBES = {
  proxy: /--proxy\b/,
  fakehost: /--fakehost\b/,
  offline: /--offline\b/,
  events: /--events\b/,
  macros: /--on\s+</,
  oncooldown: /--on-cooldown\b/,
  antiafk: /--antiafk\b/,
  sneak: /--sneak\b/,
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

    for (const asset of release.assets) {
      const target = path.join(paths.bin, asset.name);
      const known = manifest[asset.name];
      if (!force && fs.existsSync(target) && known && known.updated_at === asset.updated_at) continue;
      // Über die API-Adresse, nicht über browser_download_url: nur so klappt der Download auch
      // bei einem privaten Repository (mit Token im Kopf).
      await download(asset.url, target);
      manifest[asset.name] = { updated_at: asset.updated_at, size: asset.size };
      if (Object.values(BUILDS).some((build) => build.file === asset.name)) fs.chmodSync(target, 0o755);
    }
    manifest._release = { tag: release.tag_name, published_at: release.published_at };
    writeManifest(manifest);
    state.error = null;
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
      fs.chmodSync(file, 0o755);
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
  // Der AFKSystems-Tarif Ultra nutzt auch dann die dafür gebaute Datei, wenn einzelne darin
  // enthaltene Funktionen (derzeit die Terminal-POV) im Webpanel noch nicht freigeschaltet sind.
  // gateCaps() hält solche Funktionen trotzdem aus der Oberfläche heraus.
  if (plan?.slug === 'ultra' || (plan?.pov && plan?.premium)) want = 'ultra';
  else if (plan?.pov) want = 'pov';
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
