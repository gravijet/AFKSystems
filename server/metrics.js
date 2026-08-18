// Was die Maschine gerade tut – und welchen Anteil daran AFKSystems hat.
//
// Alles kommt aus /proc und aus `statfs`; es läuft kein Fremdprogramm und es wird nichts
// gespeichert. Zwei Zahlen braucht es für CPU-Last: die Werte in /proc sind Summen seit dem
// Hochfahren, interessant ist die Differenz zwischen zwei Messungen. Deshalb merkt sich dieses
// Modul die letzte Messung und rechnet beim nächsten Aufruf die Auslastung dazwischen aus.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, paths } from './config.js';
import { supervisor } from './supervisor.js';

const run = promisify(execFile);
const CLOCK_TICKS = 100; // getconf CLK_TCK – auf Linux seit jeher 100
const PAGE_SIZE = 4096;

/** Letzte Messung je Schlüssel: { at, ticks } bzw. { at, total, idle }. */
const last = new Map();

const readFile = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

// ---------------------------------------------------------------- Maschine

/** Auslastung aller Kerne seit der letzten Messung, in Prozent. */
function cpuPercent() {
  const line = readFile('/proc/stat').split('\n')[0];
  const parts = line.split(/\s+/).slice(1).map(Number).filter(Number.isFinite);
  if (parts.length < 4) return null;
  const total = parts.reduce((sum, value) => sum + value, 0);
  const idle = parts[3] + (parts[4] || 0);
  const previous = last.get('cpu');
  last.set('cpu', { total, idle });
  if (!previous) return null; // die erste Messung hat nichts, womit sie sich vergleichen könnte
  const deltaTotal = total - previous.total;
  const deltaIdle = idle - previous.idle;
  if (deltaTotal <= 0) return null;
  return Math.max(0, Math.min(100, ((deltaTotal - deltaIdle) / deltaTotal) * 100));
}

/** Arbeitsspeicher in Byte. `available` ist das, was wirklich noch zu vergeben ist. */
function memory() {
  const info = {};
  for (const line of readFile('/proc/meminfo').split('\n')) {
    const match = /^(\w+):\s+(\d+) kB$/.exec(line);
    if (match) info[match[1]] = Number(match[2]) * 1024;
  }
  const total = info.MemTotal || os.totalmem();
  const available = info.MemAvailable ?? os.freemem();
  return {
    total,
    available,
    used: total - available,
    percent: total ? ((total - available) / total) * 100 : 0,
    swap_total: info.SwapTotal || 0,
    swap_used: (info.SwapTotal || 0) - (info.SwapFree || 0),
  };
}

/** Belegung der Platte, auf der die Daten liegen. */
async function disk() {
  try {
    const { stdout } = await run('df', ['-kP', config.dataDir], { timeout: 5000 });
    const row = stdout.trim().split('\n').pop().split(/\s+/);
    const total = Number(row[1]) * 1024;
    const used = Number(row[2]) * 1024;
    const free = Number(row[3]) * 1024;
    if (!Number.isFinite(total) || !total) return null;
    return { total, used, free, percent: (used / total) * 100, mount: row[5] || '/' };
  } catch {
    return null;
  }
}

/** Wie groß ein Verzeichnis ist. Ohne `du`, damit auch ein knapper Container das schafft. */
function dirSize(dir, depth = 0) {
  let bytes = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Tiefer als ein paar Ebenen geht es hier nirgends – die Grenze ist nur ein Sicherheitsnetz.
      if (depth < 6) bytes += dirSize(full, depth + 1);
    } else {
      try {
        bytes += fs.statSync(full).size;
      } catch {
        /* gerade gelöscht */
      }
    }
  }
  return bytes;
}

// ---------------------------------------------------------------- Prozesse

/** CPU-Zeit und Speicher eines Prozesses aus /proc/<pid>. */
function processStats(pid) {
  const stat = readFile(`/proc/${pid}/stat`);
  if (!stat) return null;
  // Der Prozessname steht in Klammern und darf Leerzeichen enthalten – erst danach zählen Felder.
  const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const utime = Number(after[11]);
  const stime = Number(after[12]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
  const ticks = utime + stime;
  const rss = Number(after[21]) * PAGE_SIZE;

  const previous = last.get(`pid:${pid}`);
  const at = Date.now();
  last.set(`pid:${pid}`, { at, ticks });
  let percent = null;
  if (previous && at > previous.at) {
    const seconds = (at - previous.at) / 1000;
    percent = Math.max(0, ((ticks - previous.ticks) / CLOCK_TICKS / seconds) * 100);
  }
  return { pid, rss, cpu_seconds: ticks / CLOCK_TICKS, cpu_percent: percent };
}

/** Der Panel-Prozess selbst plus alle Bot-Prozesse. */
export function ownProcesses() {
  const own = processStats(process.pid);
  const bots = [];
  for (const entry of supervisor.pids()) {
    const stats = processStats(entry.pid);
    if (stats) bots.push({ ...entry, ...stats });
  }
  return { panel: own, bots };
}

/** Verbrauch je Serverplatz: die Summe seiner Bot-Prozesse. */
export function byProfile() {
  const out = new Map();
  for (const bot of ownProcesses().bots) {
    const entry = out.get(bot.profileId) || { profile_id: bot.profileId, bots: 0, rss: 0, cpu_percent: 0 };
    entry.bots += 1;
    entry.rss += bot.rss;
    if (bot.cpu_percent !== null) entry.cpu_percent += bot.cpu_percent;
    out.set(bot.profileId, entry);
  }
  return out;
}

/** Wie viel Platz die Dateien eines Serverplatzes belegen (Protokolle je Bot). */
export function diskOfProfile(profileId) {
  let bytes = 0;
  try {
    for (const name of fs.readdirSync(paths.logs)) {
      if (!name.startsWith(`bot-${profileId}-`)) continue;
      bytes += fs.statSync(path.join(paths.logs, name)).size;
    }
  } catch {
    /* noch kein Protokoll */
  }
  return bytes;
}

/** Wie viel Platz die Minecraft-Konten eines Nutzers belegen. */
export const diskOfUser = (userId) => dirSize(path.join(paths.users, String(userId)));

// ---------------------------------------------------------------- Gesamtbild

/**
 * Dieselben Zahlen in der Form, die ein Standort meldet.
 *
 * Der Haupt-Standort ist diese Maschine. Damit die Standort-Ansicht nicht zwei Formate kennen
 * muss – eines für "hier" und eines für "dort" –, wird der eigene Zustand hier in dasselbe
 * Format gebracht, das agent/index.js schickt.
 */
export function asNodeStats(snapshot_) {
  return {
    at: snapshot_.at,
    hostname: snapshot_.host.hostname,
    platform: snapshot_.host.platform,
    cores: snapshot_.host.cores,
    uptime_sec: snapshot_.host.uptime_sec,
    agent_uptime_sec: snapshot_.afksystems.uptime_sec,
    load: snapshot_.host.load,
    cpu_percent: snapshot_.host.cpu_percent,
    memory: snapshot_.host.memory,
    disk: snapshot_.host.disk,
    bots: snapshot_.afksystems.bots,
    afksystems: {
      cpu_percent: snapshot_.afksystems.cpu_percent,
      memory_bytes: snapshot_.afksystems.memory_bytes,
      memory_percent: snapshot_.afksystems.memory_percent,
      bots_memory_bytes: snapshot_.afksystems.bots_memory_bytes,
      disk: snapshot_.afksystems.disk,
    },
  };
}

/**
 * Alles auf einmal, für den Admin-Bereich: was die Maschine tut, was davon auf AFKSystems geht,
 * und wie viel Platz die eigenen Verzeichnisse brauchen.
 */
export async function snapshot() {
  const { panel, bots } = ownProcesses();
  const mem = memory();
  const botRss = bots.reduce((sum, bot) => sum + bot.rss, 0);
  const botCpu = bots.reduce((sum, bot) => sum + (bot.cpu_percent || 0), 0);
  const cores = os.cpus().length || 1;

  return {
    at: Date.now(),
    host: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      cores,
      uptime_sec: Math.round(os.uptime()),
      load: os.loadavg().map((value) => Math.round(value * 100) / 100),
      cpu_percent: cpuPercent(),
      memory: mem,
      disk: await disk(),
    },
    afksystems: {
      uptime_sec: Math.round(process.uptime()),
      // Prozentwerte je Prozess beziehen sich auf einen Kern – geteilt durch die Kernzahl steht
      // dieselbe Zahl neben der Maschinenauslastung und lässt sich damit vergleichen.
      cpu_percent: Math.round(((panel?.cpu_percent || 0) + botCpu) / cores / 0.01) / 100,
      memory_bytes: (panel?.rss || 0) + botRss,
      memory_percent: mem.total ? (((panel?.rss || 0) + botRss) / mem.total) * 100 : 0,
      panel_memory_bytes: panel?.rss || 0,
      bots_memory_bytes: botRss,
      bots: bots.length,
      disk: {
        data: dirSize(config.dataDir),
        logs: dirSize(paths.logs),
        accounts: dirSize(paths.users),
        binaries: dirSize(paths.bin),
      },
    },
  };
}
