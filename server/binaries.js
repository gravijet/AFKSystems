// Die Client-Dateien. Sie kommen aus dem Release "latest" von gravijet/HugoAFKClient – dort liegt
// nach jedem Push der frische Stand.
//
// Es gibt drei Bauformen derselben Quelle. Welche ein Serverplatz benutzt, entscheidet sein Tarif:
//
//   schlank   afk-linux           kein Zustand im Speicher, keine Bewegung – der Gratis-Platz
//   Bewegung  afk-linux-move      dazu :go/:look/:home (liegt nicht im Release, siehe scripts/)
//   Premium   premium-afk-linux   dazu Anti-AFK, Schleichen, Anzeigetafel, Menüs
//
// Was eine Datei wirklich kann, wird **nicht hier gepflegt**, sondern aus ihrer eigenen `--help`
// gelesen. Kommt im Client etwas dazu, taucht es nach dem nächsten Abgleich von selbst im Panel
// auf – und was fehlt, bleibt im Panel abgeschaltet, statt einen Knopf anzubieten, der nichts tut.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, paths } from './config.js';

const run = promisify(execFile);

const MANIFEST = path.join(paths.bin, 'manifest.json');

export const BUILDS = {
  slim: { file: 'afk-linux', label_de: 'Schlank', label_en: 'Slim' },
  move: { file: 'afk-linux-move', label_de: 'Bewegung', label_en: 'Movement' },
  premium: { file: 'premium-afk-linux', label_de: 'Premium', label_en: 'Premium' },
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
  // Bewegung und alle anderen örtlichen Befehle hängen an ':' – die Hilfe sagt es in der Fußzeile.
  local: /(Ö|Oe)rtliche Befehle beginnen mit/,
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
      if (!asset.name.endsWith('.jar') && !asset.name.endsWith('.exe')) fs.chmodSync(target, 0o755);
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
    const entry = { key, file: build.file, present: fs.existsSync(file), caps: {}, version: null };
    state.builds[key] = entry;
    if (!entry.present) continue;
    try {
      fs.chmodSync(file, 0o755);
      const { stdout } = await run(file, ['--help'], { timeout: 15_000 });
      const help = stdout;
      // "AFKSystems 2.0.0 – schlanker Minecraft-AFK-Client"
      entry.version = /^AFKSystems\s+(\S+)/m.exec(help)?.[1] || null;
      for (const [cap, probe] of Object.entries(PROBES)) entry.caps[cap] = probe.test(help);
      // Die Premium-Bauform bringt Bewegung mit; die schlanke hat sie nie.
      entry.caps.movement = entry.caps.local;
      entry.caps.premium = entry.caps.antiafk && entry.caps.sneak;
      entry.caps.board = entry.caps.premium;
      entry.caps.menu = entry.caps.premium;

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
  const any = [state.builds.slim, state.builds.premium, state.builds.move].find((b) => b?.present);
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
  const want = plan?.premium ? 'premium' : profile?.movement && plan?.movement ? 'move' : 'slim';
  const order = { premium: ['premium', 'move', 'slim'], move: ['move', 'premium', 'slim'], slim: ['slim'] };
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
  return { command: path.join(paths.bin, BUILDS[build].file), build, caps: caps(build) };
}

/** Der Weg für Aufgaben ohne Profil (Anmeldung, Kontenliste). Nimmt, was da ist. */
export function anyCommand() {
  for (const key of ['slim', 'premium', 'move']) {
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
