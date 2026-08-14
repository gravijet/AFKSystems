// Die Client-Dateien. Sie kommen aus dem Release "latest" von gravijet/HugoAFKClient – dort liegt
// nach jedem Push der frische Stand: `afk-linux` (Rust, alle Protokolle in einer Datei),
// `afk-windows.exe` (nur zum Weitergeben an Nutzer) und je eine `afk-<version>.jar`.
//
// Welche Minecraft-Versionen es gibt, wird **nicht** hier gepflegt, sondern aus `afk-linux --help`
// gelesen. Kommt im Client eine Version dazu, taucht sie nach dem nächsten Abgleich von selbst im
// Panel auf.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, paths } from './config.js';

const run = promisify(execFile);

const MANIFEST = path.join(paths.bin, 'manifest.json');

/** Bekannte Bauformen. `movement` liegt nicht im Release – wer sie will, baut sie selbst. */
export const RUNTIMES = {
  rust: { file: 'afk-linux', label: 'Rust (schlank)' },
  movement: { file: 'afk-linux-move', label: 'Rust (mit Bewegung)' },
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
  movement: false,
  error: null,
};

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return {};
  }
}

function writeManifest(data) {
  fs.writeFileSync(MANIFEST, JSON.stringify(data, null, 2));
}

async function github(url) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'afksystems-panel',
  };
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

/**
 * Release abrufen und alles holen, was sich geändert hat. `force` lädt auch dann, wenn der
 * Zeitstempel gleich geblieben ist.
 */
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
      url: asset.browser_download_url,
    }));

    for (const asset of release.assets) {
      const target = path.join(paths.bin, asset.name);
      const known = manifest[asset.name];
      const current = fs.existsSync(target);
      if (!force && current && known && known.updated_at === asset.updated_at) continue;
      // Über die API-Adresse, nicht über browser_download_url: nur so klappt der Download auch
      // bei einem privaten Repository (mit Token im Kopf).
      await download(asset.url, target);
      manifest[asset.name] = { updated_at: asset.updated_at, size: asset.size };
      if (!asset.name.endsWith('.jar') && !asset.name.endsWith('.exe')) {
        fs.chmodSync(target, 0o755);
      }
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

/** Versionen und Bauform aus dem Client selbst lesen. */
export async function detect() {
  const slim = path.join(paths.bin, RUNTIMES.rust.file);
  state.ready = fs.existsSync(slim);
  state.movement = fs.existsSync(path.join(paths.bin, RUNTIMES.movement.file));

  if (!state.ready) return state;
  try {
    fs.chmodSync(slim, 0o755);
    const { stdout } = await run(slim, ['--help'], { timeout: 10_000 });
    // "AFKSystems 1.2.3 – schlanker Minecraft-AFK-Client"
    const version = /^AFKSystems\s+(\S+)/m.exec(stdout);
    if (version) state.clientVersion = version[1];
    // "-m, --mc <version>   Protokoll: 1.21.1 | 1.21.11 | 26.1 | 26.2  (Standard: 26.1)"
    const line = /Protokoll:\s*([^\n(]+?)\s*\(Standard:\s*([^)]+)\)/.exec(stdout);
    if (line) {
      state.versions = line[1]
        .split('|')
        .map((entry) => entry.trim())
        .filter(Boolean);
      state.defaultVersion = line[2].trim();
    }
  } catch (error) {
    state.error = `Client ließ sich nicht abfragen: ${error.message}`;
  }

  // Jars zählen als eigene Bauform je Version.
  state.jars = fs
    .readdirSync(paths.bin)
    .filter((name) => /^afk-.*\.jar$/.test(name))
    .map((name) => ({ name, version: name.replace(/^afk-/, '').replace(/\.jar$/, '') }));

  if (!state.versions.length && state.jars.length) {
    state.versions = state.jars.map((jar) => jar.version).filter((v) => !v.endsWith('-move'));
  }
  return state;
}

/** Pfad zur Windows-Datei, die Nutzer im Panel herunterladen können (falls vorhanden). */
export function downloadable() {
  return fs
    .readdirSync(paths.bin)
    .filter((name) => name !== 'manifest.json' && !name.endsWith('.neu'))
    .map((name) => {
      const stat = fs.statSync(path.join(paths.bin, name));
      return { name, size: stat.size, changed: stat.mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Startbefehl für ein Profil. Rust ist der Normalfall; `java` nutzt die Jar zur Version, und
 * `movement` die selbst gebaute Bauform mit Bewegung.
 */
export function command(profile) {
  const wantsMovement = Boolean(profile.movement);
  if (profile.runtime === 'java') {
    const jar = path.join(paths.bin, `afk-${profile.mc_version}${wantsMovement ? '-move' : ''}.jar`);
    if (!fs.existsSync(jar)) throw new Error(`Jar fehlt: ${path.basename(jar)}`);
    return {
      command: 'java',
      leading: [
        '-XX:+UseSerialGC',
        '-XX:TieredStopAtLevel=1',
        '-Xmx96m',
        '-Dio.netty.eventLoopThreads=1',
        '-jar',
        jar,
      ],
    };
  }

  const file = path.join(paths.bin, wantsMovement ? RUNTIMES.movement.file : RUNTIMES.rust.file);
  if (!fs.existsSync(file)) {
    throw new Error(
      wantsMovement
        ? 'Die Bewegungs-Bauform (afk-linux-move) liegt nicht in data/bin – siehe scripts/build-movement.sh.'
        : 'Der Client (afk-linux) wurde noch nicht geladen.'
    );
  }
  return { command: file, leading: [] };
}

export function supportsMovement(profile) {
  if (!profile.movement) return false;
  return profile.runtime === 'java'
    ? fs.existsSync(path.join(paths.bin, `afk-${profile.mc_version}-move.jar`))
    : state.movement;
}

// Direktaufruf: node server/binaries.js --update
if (process.argv[1] && process.argv[1].endsWith('binaries.js')) {
  const force = process.argv.includes('--force');
  sync({ force }).then(() => {
    console.log(JSON.stringify({ ...state, assets: state.assets.map((a) => a.name) }, null, 2));
  });
}
