// Die Bot-Laufzeit: je Kombination aus Serverprofil und Minecraft-Konto ein Client-Prozess.
//
// Der Client ist bewusst pipe-fähig gebaut, deshalb braucht es hier kein eigenes Protokoll:
//   * Standardausgabe  -> Chat, eine Zeile je Nachricht
//   * Standardfehler    -> Verbindungszustand ("Verbinde zu …", "Verbunden und im Spiel als …")
//   * Standardeingabe   -> was hier hineingeschrieben wird, geht als Chat/Befehl raus
//
// Aus den Zustandszeilen wird der Status im Panel; aus der Standardausgabe der Live-Chat.

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths, userDir } from './config.js';
import { db } from './db.js';
import * as binaries from './binaries.js';
import { canStart } from './credits.js';
import { HttpError } from './util.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (text) => text.replace(ANSI, '');

/** Zustandszeilen des Clients, aus denen das Panel den Status ableitet. */
const PATTERNS = [
  { re: /^Verbinde zu (\S+?):(\d+) \(MC ([^)]+)\)/, kind: 'connecting' },
  { re: /^Verbunden und im Spiel als (.+)\.$/, kind: 'online' },
  { re: /^Getrennt: (.*)$/, kind: 'disconnected' },
  { re: /^Reconnect-Versuch (\d+) in (\d+) s/, kind: 'reconnecting' },
  { re: /^Gestorben – respawne automatisch\.$/, kind: 'death' },
  // Der Wechsel auf einen Unterserver (Velocity/BungeeCord) ist kein neuer Beitritt – der Client
  // sagt es aber an, und genau daran hängt das Panel die Weltwechsel-Macros.
  { re: /^Unterserver gewechselt/, kind: 'worldchange' },
  { re: /^Befehl: (.*)$/, kind: 'command' },
  { re: /^Melde Konto '(.+)' an \.\.\.$/, kind: 'auth' },
  { re: /^Login fehlgeschlagen: (.*)$/, kind: 'authfail' },
  { re: /^Konto '(.+)' ließ sich nicht anmelden: (.*)$/, kind: 'authstale' },
  // Der Client fragt mitten im Lauf einen neuen Gerätecode an, wenn der gespeicherte Token nicht
  // mehr taugt. Ohne diese beiden Zeilen stünde der Bot stumm da und wartete auf jemanden, der vor
  // keinem Terminal sitzt.
  { re: /^\s*1\. Öffne im Browser:\s*(\S+)$/, kind: 'authuri' },
  { re: /^\s*2\. Gib diesen Code ein:\s*(\S+)$/, kind: 'authcode' },
  { re: /^Auto-Reconnect ist aus – beende\.$/, kind: 'giveup' },
];

/** So lange darf ein Bot auf eine neue Microsoft-Anmeldung warten, bevor er aufgibt. */
const AUTH_WAIT_MS = 10 * 60 * 1000;

function classify(line) {
  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(line);
    if (match) return { kind: pattern.kind, match };
  }
  return null;
}

class Bot extends EventEmitter {
  constructor(supervisor, { profile, account, user }) {
    super();
    this.supervisor = supervisor;
    this.profile = profile;
    this.account = account;
    this.userId = user.id;
    this.key = `${profile.id}:${account.id}`;
    this.state = 'offline';
    this.detail = '';
    this.since = Date.now();
    this.startedAt = null;
    this.connections = 0;
    this.lastError = null;
    this.chat = [];
    this.chatLimit = Math.min(user.chat_limit || 200, config.chatHistoryMax);
    this.proc = null;
    this.stopping = false;
    this.timers = new Set();
    this.buffers = { out: '', err: '' };
    this.logFile = path.join(paths.logs, `bot-${profile.id}-${account.id}.log`);
  }

  get online() {
    return this.state === 'online';
  }

  get running() {
    return Boolean(this.proc) && !this.stopping;
  }

  // ------------------------------------------------------------ Start / Stopp

  args() {
    const profile = this.profile;
    const target = profile.port ? `${profile.host}:${profile.port}` : profile.host;
    const args = [
      target,
      '--account',
      this.account.name,
      '--mc',
      profile.mc_version,
      '--join-delay',
      String(profile.join_delay),
      '--reconnect-delay',
      String(profile.reconnect_delay),
      '--max-backoff',
      String(profile.max_backoff),
      '--chat-delay',
      String(profile.chat_delay),
      '--no-color',
    ];
    if (!profile.auto_reconnect) args.push('--no-reconnect');

    // Befehle, die schon der Client selbst takten kann (Beitritt + Wiederholung). Alles, was
    // sich zur Laufzeit ändern können soll (Spam, Macros), taktet dagegen das Panel über stdin.
    for (const entry of this.supervisor.joinCommands(profile.id, this.account.id)) {
      args.push('--cmd', entry);
    }
    return args;
  }

  start() {
    if (this.proc) return this;
    const { command, leading } = binaries.command(this.profile);
    const args = [...leading, ...this.args()];
    const home = userDir(this.userId);

    this.stopping = false;
    this.setState('starting', `${this.profile.host} · MC ${this.profile.mc_version}`);

    this.proc = spawn(command, args, {
      cwd: home,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: home,
        HOME: home,
        // Der Client richtet sich nach der Umgebung; ohne TERM bleibt alles zeilenweise.
        TERM: 'dumb',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.startedAt = Date.now();
    this.proc.stdout.on('data', (chunk) => this.feed('out', chunk));
    this.proc.stderr.on('data', (chunk) => this.feed('err', chunk));
    this.proc.on('error', (error) => {
      this.lastError = error.message;
      this.push('error', `Start fehlgeschlagen: ${error.message}`);
      this.setState('error', error.message);
      this.cleanup();
    });
    this.proc.on('exit', (code, signal) => {
      const reason = this.stopping
        ? 'gestoppt'
        : `Client beendet (${signal || `Code ${code}`})`;
      if (!this.stopping && code !== 0) this.lastError = reason;
      this.push('system', reason);
      this.setState(this.stopping ? 'offline' : code === 0 ? 'offline' : 'error', reason);
      this.cleanup();
      // Ein Absturz, obwohl der Bot laufen soll: nach kurzer Pause noch einmal versuchen.
      if (!this.stopping && this.wanted()) this.supervisor.scheduleRestart(this);
    });

    db.prepare(
      `UPDATE bots SET state = ?, started_at = ?, stopped_at = NULL, last_error = NULL
       WHERE profile_id = ? AND account_id = ?`
    ).run('starting', this.startedAt, this.profile.id, this.account.id);
    return this;
  }

  stop({ intended = true } = {}) {
    this.stopping = intended;
    clearTimeout(this.authTimer);
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    if (!this.proc) {
      this.setState('offline', 'gestoppt');
      return;
    }
    this.setState('stopping', '');
    this.proc.kill('SIGTERM');
    const proc = this.proc;
    setTimeout(() => {
      if (proc && !proc.killed) {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* schon weg */
        }
      }
    }, 5000).unref();
  }

  cleanup() {
    if (this.startedAt) {
      const seconds = Math.round((Date.now() - this.startedAt) / 1000);
      db.prepare(
        `UPDATE bots SET uptime_sec = uptime_sec + ?, stopped_at = ?, state = ?, last_error = ?
         WHERE profile_id = ? AND account_id = ?`
      ).run(seconds, Date.now(), this.state, this.lastError, this.profile.id, this.account.id);
    }
    this.proc = null;
    this.startedAt = null;
    this.auth = null;
    clearTimeout(this.authTimer);
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
  }

  wanted() {
    const row = db
      .prepare('SELECT wanted FROM profile_accounts WHERE profile_id = ? AND account_id = ?')
      .get(this.profile.id, this.account.id);
    return Boolean(row && row.wanted);
  }

  // ------------------------------------------------------------ Ein-/Ausgabe

  feed(stream, chunk) {
    this.buffers[stream] += chunk.toString('utf8');
    const lines = this.buffers[stream].split('\n');
    this.buffers[stream] = lines.pop();
    for (const raw of lines) {
      const line = stripAnsi(raw).replace(/\r$/, '');
      if (!line.trim()) continue;
      if (stream === 'out') this.onChat(line);
      else this.onStatus(line);
    }
  }

  onChat(line) {
    this.push('chat', line);
    this.supervisor.macros.onChat(this, line);
  }

  onStatus(line) {
    const hit = classify(line);
    if (!hit) {
      this.push('status', line);
      return;
    }
    switch (hit.kind) {
      case 'connecting':
        this.setState('connecting', `${hit.match[1]}:${hit.match[2]}`);
        break;
      case 'online': {
        const first = this.state !== 'online';
        this.setState('online', hit.match[1]);
        this.connections += 1;
        db.prepare(
          'UPDATE bots SET connections = connections + 1, state = ? WHERE profile_id = ? AND account_id = ?'
        ).run('online', this.profile.id, this.account.id);
        db.prepare('UPDATE mc_accounts SET connections = connections + 1 WHERE id = ?').run(
          this.account.id
        );
        if (first) this.supervisor.macros.onJoin(this);
        break;
      }
      case 'disconnected':
        this.lastError = hit.match[1];
        this.setState('disconnected', hit.match[1]);
        this.supervisor.macros.onDisconnect(this);
        break;
      case 'reconnecting':
        this.setState('reconnecting', `Versuch ${hit.match[1]}, in ${hit.match[2]} s`);
        break;
      case 'death':
        this.supervisor.macros.onDeath(this);
        break;
      case 'worldchange':
        this.setState('online', 'Unterserver gewechselt');
        this.supervisor.macros.onWorldChange(this);
        break;
      case 'authfail':
        this.lastError = hit.match[1];
        this.markAccountBroken(hit.match[1]);
        this.setState('error', hit.match[1]);
        break;
      case 'authstale':
        this.lastError = hit.match[2];
        this.markAccountBroken(hit.match[2]);
        break;
      case 'authuri':
        this.auth = { ...(this.auth || {}), uri: hit.match[1] };
        break;
      case 'authcode':
        this.auth = { ...(this.auth || {}), code: hit.match[1], since: Date.now() };
        this.markAccountBroken('Die Anmeldung ist abgelaufen – bitte neu verbinden.');
        this.setState('auth', `Code ${hit.match[1]}`);
        this.push(
          'error',
          `Die Anmeldung für "${this.account.name}" ist abgelaufen. Neuer Code: ${hit.match[1]} auf ${
            this.auth.uri || 'https://www.microsoft.com/link'
          }`
        );
        // Wartet niemand auf, wird abgebrochen – sonst hinge der Bot ewig und belegte einen Platz.
        clearTimeout(this.authTimer);
        this.authTimer = setTimeout(() => {
          if (this.state === 'auth') {
            this.push('error', 'Niemand hat die Anmeldung bestätigt – Bot gestoppt.');
            this.stop();
          }
        }, AUTH_WAIT_MS);
        this.authTimer.unref();
        break;
      default:
        break;
    }
    this.push('status', line);
  }

  /** Konto als "braucht neue Anmeldung" kennzeichnen – das Panel zeigt es an prominenter Stelle. */
  markAccountBroken(reason) {
    db.prepare('UPDATE mc_accounts SET status = ?, last_error = ? WHERE id = ?').run(
      'error',
      reason,
      this.account.id
    );
  }

  push(type, text) {
    const entry = { t: Date.now(), type, text };
    this.chat.push(entry);
    if (this.chat.length > this.chatLimit) this.chat.splice(0, this.chat.length - this.chatLimit);
    if (type === 'chat' || type === 'error') {
      fs.appendFile(this.logFile, `${new Date(entry.t).toISOString()} ${type} ${text}\n`, () => {});
    }
    this.supervisor.emit('bot-line', { userId: this.userId, key: this.key, entry });
  }

  setState(state, detail = '') {
    if (this.state === state && this.detail === detail) return;
    this.state = state;
    this.detail = detail;
    this.since = Date.now();
    db.prepare('UPDATE bots SET state = ? WHERE profile_id = ? AND account_id = ?').run(
      state,
      this.profile.id,
      this.account.id
    );
    this.supervisor.emit('bot-state', { userId: this.userId, key: this.key, state: this.snapshot() });
  }

  /** Eine Zeile an den Client schicken. Mit '/' vorn ist es ein Serverbefehl. */
  send(text) {
    if (!this.proc || !this.proc.stdin.writable) {
      throw new HttpError(409, 'Der Bot läuft gerade nicht.');
    }
    const line = String(text).replace(/[\r\n]+/g, ' ').trim();
    if (!line) return false;
    this.proc.stdin.write(`${line}\n`);
    this.push('sent', line);
    return true;
  }

  /** Bewegungsbefehl (`:go vor 5`) – nur mit der Bewegungs-Bauform. */
  move(verb, arg = '') {
    if (!binaries.supportsMovement(this.profile)) {
      throw new HttpError(
        409,
        'Dieses Profil läuft ohne Bewegungs-Bauform. In den Profileinstellungen "Bewegung" einschalten.'
      );
    }
    return this.send(`:${verb}${arg ? ` ${arg}` : ''}`);
  }

  snapshot() {
    return {
      key: this.key,
      profile_id: this.profile.id,
      account_id: this.account.id,
      account: this.account.name,
      state: this.state,
      detail: this.detail,
      since: this.since,
      online: this.online,
      connections: this.connections,
      last_error: this.lastError,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      // Nur gesetzt, wenn der Client gerade auf eine neue Microsoft-Anmeldung wartet.
      auth: this.state === 'auth' ? this.auth : null,
    };
  }
}

class Supervisor extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.bots = new Map();
    this.restarts = new Map();
    this.macros = null; // wird von macros.js gesetzt
  }

  get(profileId, accountId) {
    return this.bots.get(`${profileId}:${accountId}`);
  }

  list(userId) {
    return [...this.bots.values()]
      .filter((bot) => bot.userId === userId)
      .map((bot) => bot.snapshot());
  }

  /**
   * user_id -> Anzahl abzurechnender Bots. Wartet ein Bot auf eine neue Microsoft-Anmeldung,
   * zählt er nicht mit: dafür kann der Nutzer nichts, und im Spiel ist er ohnehin nicht.
   */
  usage() {
    const map = new Map();
    for (const bot of this.bots.values()) {
      if (!bot.running || bot.state === 'auth') continue;
      map.set(bot.userId, (map.get(bot.userId) || 0) + 1);
    }
    return map;
  }

  runningCount(userId) {
    let count = 0;
    for (const bot of this.bots.values()) {
      if (bot.running && (userId === undefined || bot.userId === userId)) count += 1;
    }
    return count;
  }

  /** Befehle, die der Client selbst takten soll: Beitrittsbefehle und Dauer-Wiederholungen. */
  joinCommands(profileId, accountId) {
    const out = [];
    const rows = db
      .prepare('SELECT * FROM macros WHERE profile_id = ? AND enabled = 1')
      .all(profileId);
    for (const macro of rows) {
      const accounts = JSON.parse(macro.accounts || '[]');
      if (accounts.length && !accounts.includes(accountId)) continue;
      const actions = JSON.parse(macro.actions || '[]');
      const settings = JSON.parse(macro.config || '{}');
      // Nur der einfachste Fall geht an den Client: ein Macro, das nichts als Chatzeilen sendet.
      // Alles andere (Warten, Bewegung, Bedingungen) taktet das Panel, damit es ohne Neustart
      // änderbar bleibt.
      const simple = actions.length > 0 && actions.every((a) => a.type === 'chat' && !a.delay);
      if (!simple) continue;
      if (macro.event === 'join') {
        for (const action of actions) out.push(action.text);
      } else if (macro.event === 'timer' && settings.interval_sec) {
        for (const action of actions) out.push(`${Math.max(5, settings.interval_sec)}:${action.text}`);
      }
    }
    return out;
  }

  /** Bot anlegen (falls nötig) und starten. */
  start({ profile, account, user }) {
    if (this.runningCount() >= config.maxBotsTotal) {
      throw new HttpError(429, 'Der Server ist ausgelastet. Bitte später erneut versuchen.');
    }
    if (this.runningCount(user.id) >= config.maxBotsPerUser) {
      throw new HttpError(429, `Mehr als ${config.maxBotsPerUser} Bots gleichzeitig gehen nicht.`);
    }
    if (!canStart(user, 1)) {
      throw new HttpError(402, 'Zu wenig Guthaben. Bitte zuerst aufladen.');
    }
    if (account.status === 'error') {
      throw new HttpError(409, `Konto "${account.name}" ist nicht angemeldet: ${account.last_error || 'unbekannt'}`);
    }

    const accountFile = path.join(
      userDir(user.id),
      'afksystems',
      'accounts',
      `${account.name}.json`
    );
    if (account.kind === 'microsoft' && !fs.existsSync(accountFile)) {
      throw new HttpError(409, `Für "${account.name}" liegt keine Anmeldung vor. Bitte neu verbinden.`);
    }

    db.prepare(
      `INSERT INTO bots (profile_id, account_id, state) VALUES (?, ?, 'starting')
       ON CONFLICT(profile_id, account_id) DO UPDATE SET state = 'starting'`
    ).run(profile.id, account.id);
    db.prepare(
      'UPDATE profile_accounts SET wanted = 1 WHERE profile_id = ? AND account_id = ?'
    ).run(profile.id, account.id);

    let bot = this.get(profile.id, account.id);
    if (bot && bot.running) return bot.snapshot();
    if (!bot) {
      bot = new Bot(this, { profile, account, user });
      this.bots.set(bot.key, bot);
    } else {
      bot.profile = profile;
      bot.account = account;
    }
    bot.start();
    this.macros.attach(bot);
    return bot.snapshot();
  }

  stop(profileId, accountId, { keepWanted = false } = {}) {
    if (!keepWanted) {
      db.prepare(
        'UPDATE profile_accounts SET wanted = 0 WHERE profile_id = ? AND account_id = ?'
      ).run(profileId, accountId);
    }
    const bot = this.get(profileId, accountId);
    if (!bot) return null;
    bot.stop();
    return bot.snapshot();
  }

  stopUser(userId, reason = '') {
    for (const bot of this.bots.values()) {
      if (bot.userId !== userId || !bot.running) continue;
      if (reason) bot.push('system', reason);
      db.prepare(
        'UPDATE profile_accounts SET wanted = 0 WHERE profile_id = ? AND account_id = ?'
      ).run(bot.profile.id, bot.account.id);
      bot.stop();
    }
  }

  scheduleRestart(bot) {
    const attempts = (this.restarts.get(bot.key) || 0) + 1;
    this.restarts.set(bot.key, attempts);
    // Nach fünf Fehlversuchen bleibt es aus – sonst dreht sich das ewig im Kreis.
    if (attempts > 5) {
      bot.push('error', 'Fünf Startversuche fehlgeschlagen – bleibt aus.');
      db.prepare(
        'UPDATE profile_accounts SET wanted = 0 WHERE profile_id = ? AND account_id = ?'
      ).run(bot.profile.id, bot.account.id);
      return;
    }
    const delay = Math.min(60_000, 5000 * attempts);
    bot.push('system', `Neustart in ${Math.round(delay / 1000)} s (Versuch ${attempts}).`);
    setTimeout(() => {
      if (!bot.wanted()) return;
      const fresh = this.context(bot.profile.id, bot.account.id);
      if (!fresh) return;
      bot.profile = fresh.profile;
      bot.account = fresh.account;
      bot.start();
      this.macros.attach(bot);
    }, delay).unref();
  }

  /** Profil, Konto und Nutzer frisch aus der Datenbank holen. */
  context(profileId, accountId) {
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    const account = db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(accountId);
    if (!profile || !account) return null;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(profile.user_id);
    if (!user) return null;
    return { profile, account, user };
  }

  /** Nach einem Neustart des Dienstes alles wieder hochfahren, was laufen soll. */
  restoreAll() {
    const rows = db
      .prepare('SELECT profile_id, account_id FROM profile_accounts WHERE wanted = 1')
      .all();
    let started = 0;
    for (const row of rows) {
      const context = this.context(row.profile_id, row.account_id);
      if (!context) continue;
      if (context.user.blocked || !canStart(context.user, 1)) continue;
      try {
        this.start(context);
        started += 1;
      } catch {
        /* einer weniger, der Rest läuft trotzdem */
      }
    }
    return started;
  }

  shutdown() {
    for (const bot of this.bots.values()) {
      if (bot.proc) bot.stop({ intended: true });
    }
  }

  /** Chatverlauf eines Bots, optional nur ab einem Zeitpunkt. */
  historyOf(profileId, accountId, since = 0) {
    const bot = this.get(profileId, accountId);
    if (!bot) return [];
    return since ? bot.chat.filter((entry) => entry.t > since) : bot.chat;
  }
}

export const supervisor = new Supervisor();
export { Bot };
