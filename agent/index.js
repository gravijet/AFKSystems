// Der AFKSystems-Standort-Agent.
//
// Ein Standort ist eine Maschine, auf der Bots laufen. Dieses Programm ist alles, was dafür auf
// ihr liegen muss: es meldet sich beim Panel, holt sich die Client-Dateien, startet auf Zuruf
// Prozesse und reicht deren Ein- und Ausgabe durch. Es hat keine Datenbank, keine offene
// Portfreigabe und keinen Zustand, den man abgleichen müsste.
//
// Die Verbindung geht **von hier nach draußen**. Das ist der ganze Trick: ein neuer Standort
// braucht deshalb keine öffentliche Adresse, kein TLS-Zertifikat und keine Firewall-Regel für
// eingehenden Verkehr. Nur ausgehendes HTTPS – und das kann jeder VPS ab der ersten Minute.
//
//     Panel  ->  spawn / stdin / kill / sync / ping / http
//     Panel  <-  hello / metrics / out / err / exit / files / error / pong / httpres
//
// `http` ist der einzige Auftrag, der keinen Prozess betrifft: Der Client bringt seit 2.5.0 einen
// eigenen kleinen Webserver für die texturierte Live-Ansicht mit, und der lauscht auf **diesem**
// Localhost. Das Panel kann ihn nicht erreichen – also holt dieser Agent das Bild ab und reicht es
// durch die bestehende Leitung zurück. Kein zweiter Port, keine Freigabe, kein Zertifikat.
//
// Start:  PANEL_URL=https://example.invalid NODE_TOKEN=… node index.js
// Die Werte dürfen auch in einer `.env` neben dieser Datei stehen.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const run = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- Konfiguration

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile();

const config = {
  // 1.1.0: holt die Minecraft-Ressourcen mit und reicht den Viewer des Clients durch (`http`).
  version: '1.1.0',
  panel: (process.env.PANEL_URL || 'https://example.invalid').replace(/\/+$/, ''),
  token: process.env.NODE_TOKEN || '',
  dataDir: process.env.AGENT_DATA_DIR || path.join(ROOT, 'data'),
  // Wie viele Bots dieser Standort höchstens gleichzeitig hält. 0 = so viele, wie das Panel
  // schickt; die eigentliche Obergrenze steht im Panel am Standort.
  maxJobs: Number(process.env.AGENT_MAX_JOBS) || 0,
};

if (!config.token) {
  console.error('NODE_TOKEN fehlt. Es steht im Panel unter Administration → Standorte.');
  process.exit(1);
}

const paths = {
  bin: path.join(config.dataDir, 'bin'),
  users: path.join(config.dataDir, 'users'),
  // Die Original-Client-JARs von Minecraft, je Protokollversion eine. Sie kommen vom Panel und
  // werden von der texturierten Live-Ansicht gelesen – nie kopiert, nur gelesen.
  resources: path.join(config.dataDir, 'mc'),
};
for (const dir of [config.dataDir, paths.bin, paths.users, paths.resources]) {
  fs.mkdirSync(dir, { recursive: true });
}

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

// ---------------------------------------------------------------- Messwerte
//
// Alles aus /proc und `df`. Kein Fremdprogramm, nichts wird gespeichert. Zwei Messungen braucht
// es für die CPU-Last: in /proc stehen Summen seit dem Hochfahren, interessant ist die Differenz.

const CLOCK_TICKS = 100;
const PAGE_SIZE = 4096;
let lastCpu = null;
const lastProcCpu = new Map();

const readFile = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

function cpuPercent() {
  const parts = readFile('/proc/stat').split('\n')[0].split(/\s+/).slice(1).map(Number).filter(Number.isFinite);
  if (parts.length < 4) return null;
  const total = parts.reduce((sum, value) => sum + value, 0);
  const idle = parts[3] + (parts[4] || 0);
  const previous = lastCpu;
  lastCpu = { total, idle };
  if (!previous) return null;
  const deltaTotal = total - previous.total;
  if (deltaTotal <= 0) return null;
  return Math.max(0, Math.min(100, ((deltaTotal - (idle - previous.idle)) / deltaTotal) * 100));
}

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

async function disk() {
  try {
    const { stdout } = await run('df', ['-kP', config.dataDir], { timeout: 5000 });
    const row = stdout.trim().split('\n').pop().split(/\s+/);
    const total = Number(row[1]) * 1024;
    const used = Number(row[2]) * 1024;
    if (!Number.isFinite(total) || !total) return null;
    return { total, used, free: Number(row[3]) * 1024, percent: (used / total) * 100, mount: row[5] || '/' };
  } catch {
    return null;
  }
}

/** CPU-Zeit und Speicher eines Prozesses. Ohne zweite Messung gibt es keinen Prozentwert. */
function processStats(pid) {
  const stat = readFile(`/proc/${pid}/stat`);
  if (!stat) return null;
  const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const ticks = Number(after[11]) + Number(after[12]);
  if (!Number.isFinite(ticks)) return null;
  const rss = Number(after[21]) * PAGE_SIZE;
  const at = Date.now();
  const previous = lastProcCpu.get(pid);
  lastProcCpu.set(pid, { at, ticks });
  let percent = null;
  if (previous && at > previous.at) {
    percent = Math.max(0, ((ticks - previous.ticks) / CLOCK_TICKS / ((at - previous.at) / 1000)) * 100);
  }
  return { rss, cpu_percent: percent };
}

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

async function metrics() {
  const mem = memory();
  const cores = os.cpus().length || 1;
  let botRss = 0;
  let botCpu = 0;
  for (const job of jobs.values()) {
    if (!job.proc?.pid) continue;
    const stats = processStats(job.proc.pid);
    if (!stats) continue;
    botRss += stats.rss;
    botCpu += stats.cpu_percent || 0;
  }
  const own = processStats(process.pid);
  return {
    at: Date.now(),
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cores,
    uptime_sec: Math.round(os.uptime()),
    agent_uptime_sec: Math.round(process.uptime()),
    load: os.loadavg().map((value) => Math.round(value * 100) / 100),
    cpu_percent: cpuPercent(),
    memory: mem,
    disk: await disk(),
    bots: jobs.size,
    // Wie viel davon auf AFKSystems geht. Prozentwerte je Prozess beziehen sich auf einen Kern;
    // geteilt durch die Kernzahl steht dieselbe Zahl neben der Maschinenauslastung.
    afksystems: {
      cpu_percent: Math.round((((own?.cpu_percent || 0) + botCpu) / cores) * 100) / 100,
      memory_bytes: (own?.rss || 0) + botRss,
      memory_percent: mem.total ? (((own?.rss || 0) + botRss) / mem.total) * 100 : 0,
      bots_memory_bytes: botRss,
      disk: { data: dirSize(config.dataDir), binaries: dirSize(paths.bin), accounts: dirSize(paths.users) },
    },
  };
}

// ---------------------------------------------------------------- Client-Dateien

const sha256 = async (file) => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
};

/**
 * Die Client-Dateien vom Panel holen – aber nur, was fehlt oder sich geändert hat.
 *
 * Damit gibt es hier nie eine andere Fassung als im Panel, und niemand muss auf diesem Rechner
 * einen GitHub-Zugang einrichten.
 */
async function syncBinaries() {
  // Mit Zeitlimit: Ein Panel, das die Verbindung annimmt und dann schweigt, ließ diesen Aufruf
  // sonst ewig offen – und mit ihm den ganzen Verbindungsaufbau, in dem er steht. Der Standort
  // hätte danach nie ein `hello` geschickt und stünde im Panel für immer als "nicht erreichbar".
  const response = await fetch(`${config.panel}/api/node/manifest`, {
    headers: { authorization: `Bearer ${config.token}`, 'user-agent': 'afksystems-agent' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Manifest ${response.status}`);
  const manifest = await response.json();
  let loaded = 0;

  for (const entry of manifest.files || []) {
    const target = path.join(paths.bin, entry.name);
    if (fs.existsSync(target) && fs.statSync(target).size === entry.size) {
      if ((await sha256(target)) === entry.sha256) continue;
    }
    const file = await fetch(`${config.panel}/api/node/binaries/${encodeURIComponent(entry.name)}`, {
      headers: { authorization: `Bearer ${config.token}`, 'user-agent': 'afksystems-agent' },
      // Eine Client-Datei sind ein paar Dutzend Megabyte – großzügiger als das Manifest.
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!file.ok) throw new Error(`Download ${entry.name}: ${file.status}`);
    const temp = `${target}.neu`;
    fs.writeFileSync(temp, Buffer.from(await file.arrayBuffer()));
    fs.chmodSync(temp, 0o755);
    fs.renameSync(temp, target);
    loaded += 1;
  }
  if (loaded) log(`${loaded} Client-Datei(en) geholt.`);
  await syncResources(manifest.resources || []);
  return fs.readdirSync(paths.bin).filter((name) => !name.endsWith('.neu'));
}

/** Wie eine Versionsangabe aussehen darf – sie wird hier zu einem Dateinamen. */
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/;

/**
 * Die Minecraft-Client-JARs abgleichen, genau wie die Bauformen: nur, was fehlt oder abweicht.
 *
 * Sie sind mit 20 bis 40 MB je Version die größten Dateien auf diesem Rechner, und sie ändern sich
 * praktisch nie. Deshalb wird der Fingerabdruck erst gebildet, wenn schon die Größe passt.
 *
 * Ein Fehlschlag ist kein Grund, den Start abzubrechen: Ohne JAR läuft die Live-Ansicht als
 * farbige Voxelansicht weiter, und Bots, die gar keine Ansicht gebucht haben, merken nichts davon.
 */
async function syncResources(wanted) {
  const keep = new Set();
  for (const entry of wanted) {
    const version = String(entry?.version || '');
    if (!VERSION.test(version)) continue;
    keep.add(version);
    const target = path.join(paths.resources, `${version}.jar`);
    try {
      if (fs.existsSync(target) && fs.statSync(target).size === entry.size) {
        if ((await sha256(target)) === entry.sha256) continue;
      }
      const file = await fetch(`${config.panel}/api/node/resources/${encodeURIComponent(version)}`, {
        headers: { authorization: `Bearer ${config.token}`, 'user-agent': 'afksystems-agent' },
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!file.ok) throw new Error(`Status ${file.status}`);
      const temp = `${target}.neu`;
      fs.writeFileSync(temp, Buffer.from(await file.arrayBuffer()));
      fs.renameSync(temp, target);
      log(`Minecraft-Ressourcen für ${version} geholt.`);
    } catch (error) {
      log(`Ressourcen für ${version} nicht geholt: ${error.message}`);
    }
  }
  // Was das Panel nicht mehr führt, gehört auch hier nicht mehr hin. Vierzig Megabyte je Version
  // bleiben sonst für immer liegen, für eine Minecraft-Fassung, die niemand mehr spielt.
  try {
    for (const name of fs.readdirSync(paths.resources)) {
      if (!name.endsWith('.jar') || keep.has(name.slice(0, -4))) continue;
      fs.unlinkSync(path.join(paths.resources, name));
      log(`Ressourcen ${name} entfernt – das Panel führt sie nicht mehr.`);
    }
  } catch {
    /* noch kein Verzeichnis */
  }
}

/** Welche Versionen dieser Standort texturiert zeichnen kann. */
function resourceVersions() {
  try {
    return fs
      .readdirSync(paths.resources)
      .filter((name) => name.endsWith('.jar'))
      .map((name) => name.slice(0, -4));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- Bots

/** job-id -> { proc, userId, home, povPort } */
const jobs = new Map();

/** Nur Konten und die gemerkten Bewegungspunkte reisen zwischen Panel und Standort. */
const WANTED = /^(accounts\/[A-Za-z0-9._-]{1,64}\.json|movement\.json)$/;

function userHome(userId) {
  const home = path.join(paths.users, String(Number(userId) || 0));
  fs.mkdirSync(path.join(home, 'afksystems', 'accounts'), { recursive: true });
  return home;
}

/** Die Dateien, die das Panel mitgeschickt hat, ins Kontoverzeichnis legen. */
function writeFiles(home, files) {
  const base = path.join(home, 'afksystems');
  for (const [name, content] of Object.entries(files || {})) {
    if (!WANTED.test(name) || typeof content !== 'string') continue;
    const target = path.join(base, name);
    if (!target.startsWith(base + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { mode: 0o600 });
  }
}

/** Und der Rückweg: was der Client dort geändert hat (aufgefrischte Microsoft-Token). */
function readFiles(home) {
  const base = path.join(home, 'afksystems');
  const out = {};
  const add = (relative) => {
    try {
      out[relative] = fs.readFileSync(path.join(base, relative), 'utf8');
    } catch {
      /* gibt es nicht */
    }
  };
  add('movement.json');
  try {
    for (const name of fs.readdirSync(path.join(base, 'accounts'))) {
      if (WANTED.test(`accounts/${name}`)) add(`accounts/${name}`);
    }
  } catch {
    /* noch kein Konto */
  }
  return out;
}

function startJob(link, message) {
  const { job, file, args, user_id: userId } = message;
  if (jobs.has(job)) return;
  if (config.maxJobs && jobs.size >= config.maxJobs) {
    link.send({ type: 'error', job, error: `Dieser Standort nimmt höchstens ${config.maxJobs} Bots.` });
    return;
  }
  const binary = path.join(paths.bin, path.basename(String(file || '')));
  if (!fs.existsSync(binary)) {
    link.send({ type: 'error', job, error: `Die Client-Datei "${file}" liegt auf diesem Standort nicht.` });
    return;
  }

  const home = userHome(userId);
  try {
    writeFiles(home, message.files);
    fs.chmodSync(binary, 0o755);
  } catch (error) {
    link.send({ type: 'error', job, error: `Vorbereitung fehlgeschlagen: ${error.message}` });
    return;
  }

  // Der texturierte Viewer. Das Panel schickt Portnummer, Minecraft-Version und – seit Client
  // 2.6.0 – ob diese Bauform sich ihre JAR notfalls selbst besorgen kann (`auto`). **Den Pfad
  // setzt dieser Rechner ein**, denn nur er weiß, wo seine Kopie liegt und ob sie überhaupt schon
  // angekommen ist.
  //
  // Drei Fälle, in dieser Reihenfolge:
  //
  //   1. **Die JAR liegt hier.** Sie geht vor: eine Datei für alle Kunden dieses Rechners.
  //   2. **Sie liegt nicht hier, aber der Client kann sich selbst helfen.** Dann startet der
  //      Viewer trotzdem; ohne `--pov-resources` gilt dort die Vorgabe `auto`, und der Client
  //      sucht sich eine (eigene Ablage, Minecraft-Installation, zuletzt Mojang).
  //   3. **Weder noch.** Kein `--pov-web`: Dann bleibt die farbige Voxelansicht, statt dass ein
  //      Viewer ohne Texturen ins Leere läuft.
  const full = Array.isArray(args) ? args.map(String) : [];
  let povPort = null;
  const pov = message.pov;
  if (pov?.port && VERSION.test(String(pov.mc || ''))) {
    const jar = path.join(paths.resources, `${pov.mc}.jar`);
    if (fs.existsSync(jar)) {
      povPort = Number(pov.port);
      full.push('--pov-web', `127.0.0.1:${povPort}`, '--pov-resources', jar);
    } else if (pov.auto) {
      povPort = Number(pov.port);
      full.push('--pov-web', `127.0.0.1:${povPort}`);
      log(
        `Keine Minecraft-Ressourcen für ${pov.mc} – der Client sucht sich selbst eine. ` +
          'Eine hier hinterlegte JAR spart je Kunde einen eigenen Download.'
      );
    } else {
      log(`Keine Minecraft-Ressourcen für ${pov.mc} – Bot startet ohne texturierte Ansicht.`);
    }
  }

  const proc = spawn(binary, full, {
    cwd: home,
    env: { ...process.env, ...(message.env || {}), XDG_CONFIG_HOME: home, HOME: home, TERM: 'dumb' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  jobs.set(job, { proc, userId, home, povPort });

  // **Je Kanal ein Decoder, kein `chunk.toString('utf8')`.**
  //
  // Ein Datenstück endet dort, wo das Betriebssystem es abschneidet, und das ist mitten in einem
  // Zeichen genauso wahrscheinlich wie anderswo. `toString` macht daraus ein Fragezeichen, der
  // Decoder hält den Anfang zurück, bis der Rest kommt. Im Panel steht diese Stelle längst richtig
  // (supervisor.js) – hier fehlte sie, und damit hatte jeder Bot auf einem Standort genau den
  // Fehler, der örtlich schon behoben war: zerbrochene Umlaute im Chat und, viel sichtbarer, ein
  // Bild der Live-Ansicht, das alle 64 Kilobyte mittendrin abriss.
  const decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') };
  proc.stdout.on('data', (chunk) => link.send({ type: 'out', job, data: decoders.out.write(chunk) }));
  proc.stderr.on('data', (chunk) => link.send({ type: 'err', job, data: decoders.err.write(chunk) }));
  proc.on('error', (error) => {
    jobs.delete(job);
    link.send({ type: 'error', job, error: error.message });
  });
  proc.on('exit', (code, signal) => {
    jobs.delete(job);
    lastProcCpu.delete(proc.pid);
    // Erst die Dateien, dann das Ende: sonst wäre der aufgefrischte Token unterwegs, während das
    // Panel den Bot schon abgeräumt hat.
    link.send({ type: 'files', job, user_id: userId, files: readFiles(home) });
    link.send({ type: 'exit', job, code, signal });
  });
  log(`Bot gestartet: ${path.basename(binary)} (Auftrag ${job.slice(0, 8)})`);
}

/**
 * Kontodateien regelmäßig zurückschicken.
 *
 * Der Client schreibt einen aufgefrischten Microsoft-Token, sobald der alte abläuft – also
 * mitten im Lauf. Käme er erst beim Beenden zurück, wäre er nach einem harten Neustart weg und
 * das Konto müsste neu verbunden werden.
 */
function pushAccountFiles(link) {
  const seen = new Set();
  for (const job of jobs.values()) {
    if (seen.has(job.userId)) continue;
    seen.add(job.userId);
    link.send({ type: 'files', user_id: job.userId, files: readFiles(job.home) });
  }
}

/**
 * Eine HTTP-Anfrage an den Viewer eines Bots ausführen und die Antwort zurückschicken.
 *
 * Drei Sicherungen, und jede hat einen Grund:
 *
 *   1. **Das Ziel bestimmt der Auftrag, nicht die Nachricht.** Die Portnummer steht hier am Job –
 *      das Panel kann also nicht irgendeinen lauschenden Dienst dieser Maschine ansprechen.
 *   2. **Nur GET und POST**, und nur der Pfad kommt von außen. Ein vollständiges `http://…` in
 *      der Nachricht hätte diesen Agenten zu einem offenen Proxy gemacht.
 *   3. **Eine Obergrenze für die Antwort.** Ein Bild sind ein paar hundert Kilobyte; alles
 *      darüber passt ohnehin nicht mehr durch die Leitung und wäre nur ein Weg, sie zu füllen.
 */
const HTTP_MAX_BYTES = 2 * 1024 * 1024;

async function relay(link, message) {
  const answer = (fields) => link.send({ type: 'httpres', id: message.id, ...fields });
  const job = jobs.get(message.job);
  if (!job?.povPort) return answer({ error: 'Für diesen Bot läuft hier keine Live-Ansicht.' });
  const method = message.method === 'POST' ? 'POST' : 'GET';
  const route = String(message.path || '');
  if (!route.startsWith('/')) return answer({ error: 'Ungültiger Pfad.' });

  try {
    const response = await fetch(`http://127.0.0.1:${job.povPort}${route}`, {
      method,
      signal: AbortSignal.timeout(8000),
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > HTTP_MAX_BYTES) return answer({ error: 'Antwort zu groß.' });
    answer({
      status: response.status,
      ctype: response.headers.get('content-type') || 'application/octet-stream',
      body: body.toString('base64'),
    });
  } catch (error) {
    answer({ error: error.message });
  }
}

function stopAll(signal = 'SIGTERM') {
  for (const job of jobs.values()) {
    try {
      job.proc.kill(signal);
    } catch {
      /* schon weg */
    }
  }
}

// ---------------------------------------------------------------- Leitung

let socket = null;
let retry = 0;
let timers = [];

const link = {
  send(message) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  },
};

function connect() {
  const address = `${config.panel.replace(/^http/, 'ws')}/api/node/stream`;
  socket = new WebSocket(address, {
    headers: { authorization: `Bearer ${config.token}`, 'user-agent': 'afksystems-agent' },
    handshakeTimeout: 20_000,
  });

  socket.on('open', async () => {
    retry = 0;
    log(`Verbunden mit ${config.panel}`);
    let binaries = [];
    try {
      binaries = await syncBinaries();
    } catch (error) {
      log(`Client-Dateien konnten nicht geholt werden: ${error.message}`);
      binaries = fs.existsSync(paths.bin) ? fs.readdirSync(paths.bin) : [];
    }
    link.send({
      type: 'hello',
      version: config.version,
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      cores: os.cpus().length || 1,
      binaries,
      mc: resourceVersions(),
    });
    // Einmal sofort messen, damit im Panel nicht bis zum ersten Takt ein leerer Kasten steht.
    metrics().then((stats) => link.send({ type: 'metrics', stats })).catch(() => {});

    timers.push(
      setInterval(() => {
        metrics().then((stats) => link.send({ type: 'metrics', stats })).catch(() => {});
      }, 15_000)
    );
    timers.push(setInterval(() => pushAccountFiles(link), 5 * 60_000));
  });

  socket.on('message', async (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    switch (message.type) {
      case 'spawn':
        startJob(link, message);
        break;
      case 'stdin': {
        const job = jobs.get(message.job);
        if (job?.proc.stdin.writable) job.proc.stdin.write(String(message.data));
        break;
      }
      case 'kill': {
        const job = jobs.get(message.job);
        if (!job) break;
        try {
          job.proc.kill(message.signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
        } catch {
          /* schon weg */
        }
        break;
      }
      case 'http':
        relay(link, message);
        break;
      case 'sync':
        try {
          const binaries = await syncBinaries();
          link.send({
            type: 'hello',
            version: config.version,
            hostname: os.hostname(),
            binaries,
            mc: resourceVersions(),
          });
        } catch (error) {
          link.send({ type: 'error', error: `Abgleich fehlgeschlagen: ${error.message}` });
        }
        break;
      case 'ping':
        link.send({ type: 'pong', t: message.t });
        break;
      default:
        break;
    }
  });

  const down = (why) => {
    for (const timer of timers) clearInterval(timer);
    timers = [];
    if (socket) socket.removeAllListeners();
    socket = null;
    // **Die Bots gehen mit.** Ein Bot ohne Leitung zum Panel ist keiner, den noch jemand lesen
    // oder steuern könnte – er säße unsichtbar auf einem Minecraft-Server. Außerdem wäre er beim
    // Wiederaufbau der Leitung ein Doppelgänger: das Panel hält ihn längst für beendet und würde
    // ihn ein zweites Mal starten. Der Wunsch bleibt im Panel stehen; sobald die Verbindung wieder
    // steht, fährt es sie von selbst hoch.
    if (jobs.size) log(`${jobs.size} Bot(s) gestoppt – keine Leitung zum Panel.`);
    stopAll();
    retry += 1;
    const wait = Math.min(60_000, 1000 * 2 ** Math.min(retry, 6));
    log(`Verbindung ${why}. Neuer Versuch in ${Math.round(wait / 1000)} s.`);
    setTimeout(connect, wait);
  };

  socket.on('close', (code) => down(`geschlossen (${code})`));
  socket.on('error', (error) => down(`gestört (${error.message})`));
}

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // Zweimal Strg-C heißt "jetzt". Ohne diese Zeile lief nur ein zweiter Zeitgeber los und der
    // Dienst blieb dieselben drei Sekunden stehen, obwohl jemand offensichtlich nicht warten will.
    if (closing) process.exit(0);
    closing = true;
    log('Beende – stoppe alle Bots ...');
    stopAll();
    // **Nicht `unref()`.** Der Zeitgeber ist das Einzige, was den Prozess in diesem Moment noch
    // offen hält: Mit `unref()` beendete Node sich sofort, die Bots bekamen ihr SIGTERM zwar
    // abgeschickt, aber niemand wartete darauf – und wer nicht sofort ging, blieb als Waise auf
    // der Maschine stehen, ohne Leitung und ohne jemanden, der ihn noch beenden könnte.
    setTimeout(() => process.exit(0), 3000);
  });
}

log(`AFKSystems-Standort-Agent ${config.version} – Panel ${config.panel}`);
connect();
