// Die Leitung zu den Standorten.
//
// Ein Standort ist eine **Maschine**: dort laufen Bot-Prozesse, dort werden CPU, Arbeitsspeicher
// und Platte verbraucht. Ein Proxy ist dagegen nur eine Ausgangsadresse und hat nichts davon.
//
// Richtung der Verbindung: **der Standort meldet sich beim Panel**, nicht umgekehrt. Das ist der
// einzige Entwurf, bei dem ein neuer Standort ohne öffentliche Adresse, ohne Zertifikat und ohne
// eine einzige Portfreigabe auskommt – der Rechner baut eine WebSocket-Verbindung nach draußen
// auf und hält sie offen. Alles Weitere läuft darüber:
//
//     Panel  ->  spawn / stdin / kill / sync        (was der Standort tun soll)
//     Panel  <-  hello / metrics / out / err / exit / files
//
// Die Ausgabe eines entfernten Bots sieht im Panel exakt so aus wie die eines örtlichen: dafür
// gibt es `RemoteProcess`, das sich nach außen verhält wie ein Kindprozess von `child_process`.
// Der Supervisor merkt deshalb nicht, wo sein Bot läuft.

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { userDir } from './config.js';

/** Wie lange ein Standort ohne Lebenszeichen noch als erreichbar gilt. */
const OFFLINE_AFTER_MS = 90_000;

/** node_id -> NodeLink */
const links = new Map();

export const events = new EventEmitter();
events.setMaxListeners(0);

/**
 * Eine offene Verbindung zu einem Standort.
 *
 * Sie überlebt einzelne Bots: läuft der Standort weiter, während ein Bot endet, bleibt die
 * Leitung stehen. Bricht dagegen die Leitung ab, gelten alle Bots darauf als beendet – ein
 * Prozess, von dem wir nichts mehr hören, ist für das Panel kein laufender Bot.
 */
class NodeLink {
  constructor(node, socket) {
    this.nodeId = node.id;
    this.name = node.name;
    this.socket = socket;
    this.jobs = new Map();
    this.info = { version: null, hostname: '', platform: '', cores: 0, binaries: [] };
    this.metrics = null;
    this.seenAt = Date.now();

    socket.on('message', (data) => this.onMessage(data));
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }

  get online() {
    return this.socket.readyState === this.socket.OPEN && Date.now() - this.seenAt < OFFLINE_AFTER_MS;
  }

  send(message) {
    if (this.socket.readyState !== this.socket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** Läuft auf diesem Standort gerade ein Auftrag für dieses Konto? */
  servesUser(userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return false;
    for (const job of this.jobs.values()) {
      if (job.userId === id) return true;
    }
    return false;
  }

  onMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    this.seenAt = Date.now();

    switch (message.type) {
      case 'hello':
        this.info = {
          version: message.version || null,
          hostname: message.hostname || '',
          platform: message.platform || '',
          cores: Number(message.cores) || 0,
          binaries: Array.isArray(message.binaries) ? message.binaries : [],
        };
        db.prepare('UPDATE nodes SET agent_version = ?, last_seen = ? WHERE id = ?').run(
          this.info.version,
          Date.now(),
          this.nodeId
        );
        console.log(`[standort] "${this.name}" verbunden (Agent ${this.info.version || '?'})`);
        events.emit('node-online', { nodeId: this.nodeId });
        break;

      case 'metrics':
        this.metrics = message.stats || null;
        // Auch in die Datenbank, damit nach einem Neustart des Panels sofort etwas dasteht.
        db.prepare('UPDATE nodes SET stats = ?, last_seen = ? WHERE id = ?').run(
          JSON.stringify(this.metrics),
          Date.now(),
          this.nodeId
        );
        break;

      case 'out':
      case 'err': {
        const job = this.jobs.get(message.job);
        if (!job) break;
        const stream = message.type === 'out' ? job.stdout : job.stderr;
        stream.emit('data', Buffer.from(String(message.data || ''), 'utf8'));
        break;
      }

      case 'files':
        // Der Client schreibt aufgefrischte Microsoft-Token in seine Kontodatei. Käme sie nicht
        // zurück, müsste dasselbe Konto beim nächsten Start neu angemeldet werden.
        //
        // **Nur für Konten, für die dieser Standort gerade wirklich arbeitet.** Die Kontonummer
        // steht in der Nachricht, kommt also von der anderen Maschine – ohne diese Prüfung schrieb
        // ein Standort mit einem Bot eines beliebigen Kunden die Anmeldedatei *jedes* Kunden neu.
        // Ein übernommener oder schlicht fehlerhafter Standort hätte damit alle Minecraft-Konten
        // des Panels überschreiben können.
        if (this.servesUser(message.user_id)) writeBackFiles(message.user_id, message.files);
        break;

      case 'exit': {
        const job = this.jobs.get(message.job);
        if (!job) break;
        this.jobs.delete(message.job);
        job.stdin.writable = false;
        job.emit('exit', message.code ?? null, message.signal || null);
        break;
      }

      case 'error': {
        const job = message.job ? this.jobs.get(message.job) : null;
        if (job) {
          this.jobs.delete(message.job);
          job.stdin.writable = false;
          job.emit('error', new Error(message.error || 'Der Standort meldet einen Fehler.'));
        } else {
          console.warn(`[standort] "${this.name}": ${message.error}`);
        }
        break;
      }

      case 'pong':
        break;

      default:
        break;
    }
  }

  close() {
    if (links.get(this.nodeId) === this) links.delete(this.nodeId);
    for (const [, job] of this.jobs) {
      job.stdin.writable = false;
      job.emit('exit', null, 'LINK');
    }
    this.jobs.clear();
    events.emit('node-offline', { nodeId: this.nodeId });
  }
}

/**
 * Ein Prozess auf einem anderen Rechner, der sich wie ein örtlicher anfühlt.
 *
 * Genau die Teile von `ChildProcess`, die der Supervisor benutzt: `stdout`/`stderr` mit
 * `data`-Ereignissen, `stdin.write`, `kill` und `exit`. Mehr braucht es nicht, und mehr
 * vorzutäuschen wäre gelogen – eine PID etwa gibt es hier nicht, die gehört dem anderen Rechner.
 */
class RemoteProcess extends EventEmitter {
  constructor(link, job, userId = null) {
    super();
    this.link = link;
    this.job = job;
    // Wem dieser Auftrag gehört. Der Standort schickt Kontodateien zurück und nennt dabei selbst
    // eine Kontonummer – hier steht, welche das sein darf (siehe NodeLink#servesUser).
    this.userId = Number(userId) || null;
    this.pid = null;
    this.killed = false;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = {
      writable: true,
      write: (text) => link.send({ type: 'stdin', job, data: String(text) }),
    };
  }

  kill(signal = 'SIGTERM') {
    if (signal === 'SIGKILL') this.killed = true;
    this.link.send({ type: 'kill', job: this.job, signal });
  }
}

// ---------------------------------------------------------------- Öffentliche Schnittstelle

/** Eine neue Verbindung annehmen. Wird von index.js beim WebSocket-Upgrade aufgerufen. */
export function attach(node, socket) {
  links.get(node.id)?.socket.close(4000, 'ersetzt');
  const link = new NodeLink(node, socket);
  links.set(node.id, link);
  return link;
}

export const linkOf = (nodeId) => {
  const link = links.get(Number(nodeId));
  return link && link.online ? link : null;
};

export const isOnline = (nodeId) => Boolean(linkOf(nodeId));

/** Der zuletzt gemeldete Zustand eines Standorts – aus der Leitung oder aus der Datenbank. */
export function stats(nodeId) {
  const link = links.get(Number(nodeId));
  if (link?.metrics) return link.metrics;
  const row = db.prepare('SELECT stats FROM nodes WHERE id = ?').get(nodeId);
  if (!row?.stats) return null;
  try {
    return JSON.parse(row.stats);
  } catch {
    return null;
  }
}

/** Was der Standort über sich selbst sagt (Agent-Version, Rechnername, vorhandene Client-Dateien). */
export function info(nodeId) {
  const link = links.get(Number(nodeId));
  return link ? { ...link.info, online: link.online, seen_at: link.seenAt } : null;
}

/** Wie viele Bots auf diesem Standort gerade wirklich laufen (aus Sicht der Leitung). */
export function jobCount(nodeId) {
  return links.get(Number(nodeId))?.jobs.size || 0;
}

/**
 * Einen Client auf einem Standort starten.
 *
 * `files` ist das Kontoverzeichnis des Nutzers – die gespeicherten Microsoft-Anmeldungen und die
 * gemerkten Bewegungspunkte. Sie reisen mit, weil der Client sie zum Anmelden braucht und der
 * andere Rechner keine Datenbank hat.
 */
export function spawn(nodeId, { file, args, userId, env = {} }) {
  const link = linkOf(nodeId);
  if (!link) {
    const node = db.prepare('SELECT name FROM nodes WHERE id = ?').get(nodeId);
    throw new Error(`Der Standort "${node?.name || nodeId}" ist gerade nicht erreichbar.`);
  }
  const job = crypto.randomUUID();
  const proc = new RemoteProcess(link, job, userId);
  link.jobs.set(job, proc);
  link.send({
    type: 'spawn',
    job,
    file,
    args,
    env,
    user_id: userId,
    files: readUserFiles(userId),
  });
  return proc;
}

/** Allen Standorten sagen, dass es neue Client-Dateien gibt. */
export function syncAll() {
  for (const link of links.values()) link.send({ type: 'sync' });
}

/** Ein Ping-Takt, damit tote Leitungen auffallen. Wird von index.js gestartet. */
export function heartbeat() {
  for (const link of links.values()) {
    if (!link.online) {
      link.socket.terminate?.();
      link.close();
      continue;
    }
    link.send({ type: 'ping', t: Date.now() });
  }
}

// ---------------------------------------------------------------- Dateien

/** Nur das, was der Client wirklich liest: Konten und die gemerkten Bewegungspunkte. */
const WANTED = /^(accounts\/[A-Za-z0-9._-]{1,64}\.json|movement\.json)$/;

function readUserFiles(userId) {
  const base = path.join(userDir(userId), 'afksystems');
  const out = {};
  const walk = (dir, prefix) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'accounts') walk(path.join(dir, entry.name), relative);
        continue;
      }
      if (!WANTED.test(relative)) continue;
      try {
        out[relative] = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      } catch {
        /* gerade gelöscht */
      }
    }
  };
  walk(base, '');
  return out;
}

/**
 * Dateien, die der Standort zurückschickt, in das Kontoverzeichnis schreiben.
 *
 * Die Pfade kommen von einem anderen Rechner – deshalb werden sie hier gegen eine feste Liste
 * geprüft und nicht bloß zusammengesetzt. Ein Standort, der `../../etc/passwd` schickt, schreibt
 * damit nichts; er schreibt gar nichts.
 */
function writeBackFiles(userId, files) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0 || !files || typeof files !== 'object') return;
  const base = path.join(userDir(id), 'afksystems');
  for (const [name, content] of Object.entries(files)) {
    if (!WANTED.test(name) || typeof content !== 'string' || content.length > 256 * 1024) continue;
    const target = path.join(base, name);
    if (!target.startsWith(base + path.sep)) continue;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { mode: 0o600 });
    } catch {
      /* Platte voll oder Rechte falsch – der Bot läuft trotzdem weiter */
    }
  }
}
