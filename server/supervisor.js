// Die Bot-Laufzeit: je Kombination aus Serverplatz und Minecraft-Konto ein Client-Prozess.
//
// Der Client ist bewusst pipe-fähig gebaut, deshalb braucht es hier kein eigenes Protokoll:
//   * Standardausgabe  -> Chat, eine Zeile je Nachricht
//   * Standardfehler    -> Zustand; mit `--events` zusätzlich maschinenlesbare `@event`-Zeilen
//   * Standardeingabe   -> was hier hineingeschrieben wird, geht als Chat/Befehl raus
//
// Wo der Client `--events` beherrscht, hängt das Panel den Zustand daran und nicht mehr an
// deutschen Fließtextzeilen: Ereignisse sind stabil, Meldungstexte nicht.

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths, userDir } from './config.js';
import { db, getSetting } from './db.js';
import * as binaries from './binaries.js';
import { featuresOf, isActive, gateCaps } from './billing.js';
import { HttpError, codeUrl, MS_LINK } from './util.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (text) => text.replace(ANSI, '');

/**
 * Zustandszeilen des Clients für den Fall, dass `--events` fehlt. Sobald der Client Ereignisse
 * schickt, gewinnen die – hier bleibt dann nur, was es als Ereignis nicht gibt (Anmeldung).
 */
const PATTERNS = [
  { re: /^Verbinde zu (\S+?):(\d+) \(MC ([^)]+)\)/, kind: 'connecting' },
  { re: /^Verbunden und im Spiel als (.+)\.$/, kind: 'online' },
  { re: /^Getrennt: (.*)$/, kind: 'disconnected' },
  { re: /^Reconnect-Versuch (\d+) in (\d+) s/, kind: 'reconnecting' },
  { re: /^Gestorben – respawne automatisch\.$/, kind: 'death' },
  { re: /^Unterserver gewechselt/, kind: 'worldchange' },
  { re: /^Melde Konto '(.+)' an \.\.\.$/, kind: 'auth' },
  { re: /^Login fehlgeschlagen: (.*)$/, kind: 'authfail' },
  { re: /^Konto '(.+)' ließ sich nicht anmelden: (.*)$/, kind: 'authstale' },
  // Der Client fragt mitten im Lauf einen neuen Gerätecode an, wenn der gespeicherte Token nicht
  // mehr taugt. Ohne diese beiden Zeilen stünde der Bot stumm da und wartete auf jemanden, der
  // vor keinem Terminal sitzt.
  { re: /^\s*1\.\s*(?:Öffne im Browser|Oeffne im Browser):\s*(\S+)$/, kind: 'authuri' },
  { re: /^\s*2\.\s*Gib diesen Code ein:\s*(\S+)$/, kind: 'authcode' },
  { re: /^Auto-Reconnect ist aus – beende\.$/, kind: 'giveup' },
];

/** So lange darf ein Bot auf eine neue Microsoft-Anmeldung warten, bevor er aufgibt. */
const AUTH_WAIT_MS = 10 * 60 * 1000;

/** Ab dieser Größe wird das Protokoll eines Bots umgelegt (siehe Bot#rotateLog). */
const LOG_MAX_BYTES = 5 * 1024 * 1024;

function classify(line) {
  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(line);
    if (match) return { kind: pattern.kind, match };
  }
  return null;
}

/**
 * "@event world grund=unterserver" -> { type: 'world', grund: 'unterserver' }
 * "@event disconnect Server startet neu" -> { type: 'disconnect', text: 'Server startet neu' }
 *
 * Der Name des Ereignisses heißt hier `type`, nicht `name` – sonst überschriebe ihn das Feld
 * `name=` aus `@event join name=Steve`.
 */
function parseEvent(line) {
  const rest = line.slice('@event'.length).trim();
  if (!rest) return null;
  const space = rest.indexOf(' ');
  if (space < 0) return { type: rest, text: '' };
  const event = { type: rest.slice(0, space), text: '' };
  const tail = rest.slice(space + 1).trim();
  if (/^[a-zA-Z_]+=/.test(tail)) {
    for (const part of tail.split(/\s+/)) {
      const eq = part.indexOf('=');
      if (eq > 0) event[part.slice(0, eq)] = part.slice(eq + 1);
    }
  } else {
    event.text = tail;
  }
  return event;
}

/**
 * Die Antwort auf `:board` oder `:menu` in Daten übersetzen.
 *
 * Der Client schreibt sie als Text – die Anzeigetafel Zeile für Zeile mit der Punktzahl hinten.
 * Hier wird daraus etwas, das sich als Tafel zeichnen lässt; die Farbcodes (§) bleiben stehen und
 * werden erst im Browser zu Farben.
 */
function parseView(kind, lines) {
  const rows = lines.filter((line) => line.trim().length);
  if (kind === 'board') {
    if (!rows.length || rows.some((line) => /keine Seitenleiste/i.test(line))) {
      return { empty: true, title: '', rows: [] };
    }
    const [head, ...rest] = rows;
    return {
      empty: false,
      title: head.trim(),
      // "Ping: 16ms§s§? 12" – hinten steht die Punktzahl, die Minecraft rechts anzeigt.
      rows: rest.map((line) => {
        const match = /^(.*?)[ \t]+(-?\d+)$/.exec(line);
        return match ? { text: match[1], score: Number(match[2]) } : { text: line, score: null };
      }),
    };
  }

  const text = rows.join(' ');
  if (!rows.length || /kein Men(ü|ue) offen/i.test(text)) {
    return { empty: true, title: '', slots: 0, items: {} };
  }
  return {
    empty: false,
    title: /[»"„]([^»"“]{1,64})[«"“]/.exec(text)?.[1] || '',
    slots: Number(/(\d+)\s*Feld/.exec(text)?.[1]) || 0,
    items: menuItems(rows),
  };
}

/**
 * Die Gegenstände in einem Menü, sofern der Client sie meldet.
 *
 * Er schreibt je belegtem Feld eine Zeile. Beide Schreibweisen, die dabei vorkommen können,
 * werden gelesen – die knappe und die mit Beschreibungstext:
 *
 *     12  minecraft:diamond_sword x1  §bSchärfe V
 *     12 | minecraft:diamond_sword | 1 | §bScharfes Schwert | §7Schaden 7 | §7Haltbarkeit 1561
 *
 * Meldet er gar nichts davon (ältere Bauformen lesen den Inhalt nicht aus), kommt ein leeres
 * Verzeichnis zurück und das Panel zeigt die Felder wie bisher nur mit ihrer Nummer.
 */
function menuItems(rows) {
  const items = {};
  for (const raw of rows) {
    const line = raw.trim();
    // Mit senkrechten Strichen: Feld | Kennung | Anzahl | Name | Beschreibung …
    const piped = line.split('|').map((part) => part.trim());
    if (piped.length >= 3 && /^\d+$/.test(piped[0])) {
      const [slot, id, count, name, ...lore] = piped;
      items[Number(slot)] = {
        id,
        count: Number(count) || 1,
        name: name || id,
        lore: lore.filter(Boolean),
      };
      continue;
    }
    const short = /^(\d+)[.:)\s]+\s*([a-z0-9_.:]+)(?:\s*[x×]\s*(\d+))?\s*(.*)$/i.exec(line);
    if (!short) continue;
    const [, slot, id, count, rest] = short;
    if (!id.includes(':') && !id.includes('_')) continue; // eine Fließtextzeile, kein Gegenstand
    items[Number(slot)] = {
      id,
      count: Number(count) || 1,
      name: rest.trim() || id,
      lore: [],
    };
  }
  return items;
}

class Bot extends EventEmitter {
  constructor(supervisor, { profile, account, user, plan }) {
    super();
    this.supervisor = supervisor;
    this.profile = profile;
    this.account = account;
    this.plan = plan;
    this.userId = user.id;
    this.key = `${profile.id}:${account.id}`;
    this.state = 'offline';
    this.detail = '';
    this.since = Date.now();
    this.startedAt = null;
    this.connections = 0;
    this.lastError = null;
    this.chat = [];
    this.proc = null;
    this.build = null;
    this.menu = null;
    // Anzeigetafel und Menü als Daten. Sie kommen als gewöhnliche Textzeilen aus
    // dem Client; gesammelt werden sie nur, wenn das Panel gerade danach gefragt hat (siehe
    // `capture`). Ohne das stünden dreizehn Zeilen Seitenleiste zwischen den Chatnachrichten.
    this.views = { board: null, menu: null };
    this.capture = null;
    this.stopping = false;
    this.timers = new Set();
    this.buffers = { out: '', err: '' };
    this.usesEvents = false;
    this.logFile = path.join(paths.logs, `bot-${profile.id}-${account.id}.log`);
  }

  get online() {
    return this.state === 'online';
  }

  get running() {
    return Boolean(this.proc) && !this.stopping;
  }

  /** Wie viele Zeilen Chatverlauf dieser Platz vorhält – der Tarif setzt die Obergrenze. */
  get chatLimit() {
    return Math.min(this.profile.chat_limit || 200, this.plan.chat_limit, config.chatHistoryMax);
  }

  /**
   * Was dieser Bot wirklich kann: die Fähigkeiten seiner Bauform, beschnitten auf das, was der
   * Tarif samt gebuchten Zusätzen freigibt. Der Premium-Client liegt für jeden bezahlten Platz
   * bereit – Anzeigetafel und Menüs hat trotzdem nur, wer sie im Tarif hat oder dazugebucht.
   */
  get caps() {
    return gateCaps(binaries.caps(this.build || 'slim'), this.plan);
  }

  // ------------------------------------------------------------ Start / Stopp

  args(caps) {
    const profile = this.profile;
    const target = profile.port ? `${profile.host}:${profile.port}` : profile.host;
    const args = [
      target,
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

    if (this.account.kind === 'offline' && caps.offline) args.push('--offline', this.account.name);
    else args.push('--account', this.account.name);

    if (!profile.auto_reconnect) args.push('--no-reconnect');
    if (caps.events) args.push('--events');

    // Proxy und Fake-Host darf nur, wessen Tarif das hergibt – sonst stünde im Panel eine
    // Einstellung, die für den Gratis-Platz nichts täte.
    if (caps.proxy && this.plan.proxy) {
      const proxy = this.proxy();
      if (proxy) args.push('--proxy', proxy);
    }
    if (caps.fakehost && this.plan.fakehost && profile.fake_host) {
      args.push('--fakehost', profile.fake_host);
    }
    if (caps.antiafk && this.plan.premium && profile.antiafk_sec > 0) {
      args.push('--antiafk', String(Math.max(15, profile.antiafk_sec)));
    }
    if (caps.sneak && this.plan.premium && profile.sneak) args.push('--sneak');

    // Befehle, die schon der Client selbst takten kann (Beitritt + Wiederholung). Alles, was
    // sich zur Laufzeit ändern können soll, taktet dagegen das Panel über die Standardeingabe.
    for (const entry of this.supervisor.joinCommands(profile.id, this.account.id)) {
      args.push('--cmd', entry);
    }
    // Reine "Auslöser -> eine Chatzeile"-Macros gibt der Client zuverlässiger selbst ab, weil er
    // Beitritt, Weltwechsel und Tod im Protokoll sieht statt im Meldungstext.
    if (caps.macros) {
      for (const rule of this.supervisor.clientMacros(profile.id, this.account.id)) {
        args.push('--on', rule);
      }
      if (caps.oncooldown && profile.on_cooldown) {
        args.push('--on-cooldown', String(profile.on_cooldown));
      }
    }
    return args;
  }

  /**
   * Ausgangsadresse dieses Bots als URL für `--proxy`, oder null.
   *
   * Zuerst gilt, was am Konto steht. Steht dort nichts, gilt die Adresse des Standorts, auf dem
   * der Serverplatz liegt – genau dafür gibt es Standorte: ein zweiter VPS oder eine zweite IP
   * ist eine zweite Ausgangsadresse, und die soll man nicht an jedem Konto einzeln eintragen.
   */
  proxy() {
    const link = db
      .prepare('SELECT proxy_id FROM profile_accounts WHERE profile_id = ? AND account_id = ?')
      .get(this.profile.id, this.account.id);
    let proxyId = link?.proxy_id || null;
    if (!proxyId && this.profile.node_id) {
      proxyId =
        db.prepare('SELECT proxy_id FROM nodes WHERE id = ? AND active = 1').get(this.profile.node_id)
          ?.proxy_id || null;
    }
    if (!proxyId) return null;
    const row = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId);
    if (!row) return null;
    const auth = row.username
      ? `${encodeURIComponent(row.username)}:${encodeURIComponent(row.password || '')}@`
      : '';
    return `${row.kind === 'http' ? 'http' : 'socks5'}://${auth}${row.host}:${row.port}`;
  }

  start() {
    if (this.proc) return this;
    const { command, build } = binaries.command(this.profile, this.plan);
    this.build = build;
    // `this.caps` erst nach `this.build` lesen – es hängt an der Bauform, die gerade gewählt wurde.
    const caps = this.caps;
    const args = this.args(caps);
    this.usesEvents = Boolean(caps.events);
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
      const reason = this.stopping ? 'gestoppt' : `Client beendet (${signal || `Code ${code}`})`;
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
    this.menu = null;
    this.views = { board: null, menu: null };
    if (this.capture) {
      clearTimeout(this.capture.timer);
      this.capture = null;
    }
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
      else if (line.startsWith('@event ')) this.onEvent(line);
      else this.onStatus(line);
    }
  }

  onChat(line) {
    this.push('chat', line);
    this.supervisor.macros.onChat(this, line);
  }

  /** Maschinenlesbares Ereignis – das ist der verlässliche Weg. */
  onEvent(line) {
    const event = parseEvent(line);
    if (!event) return;
    switch (event.type) {
      case 'connecting':
        this.setState(
          'connecting',
          `${event.host || this.profile.host}${event.port ? `:${event.port}` : ''}`
        );
        break;
      case 'join': {
        const first = this.state !== 'online';
        this.setState('online', event.name || this.account.name);
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
      case 'world':
        this.supervisor.macros.onWorldChange(this);
        break;
      case 'death':
        this.supervisor.macros.onDeath(this);
        break;
      case 'disconnect':
        this.lastError = event.text || null;
        this.setState('disconnected', event.text || '');
        this.supervisor.macros.onDisconnect(this);
        break;
      case 'reconnect':
        this.setState('reconnecting', `Versuch ${event.versuch || '?'}, in ${event.in || '?'}`);
        break;
      case 'menu': {
        this.menu =
          event.text === 'close'
            ? null
            : {
                id: event.id || null,
                // Der Client gibt Titel und Feldzahl mit, wenn er sie kennt. Sonst holt sie die
                // erste `:menu`-Abfrage nach.
                title: event.titel || event.title || '',
                slots: Number(event.felder || event.slots) || 0,
                at: Date.now(),
              };
        if (!this.menu) this.views.menu = { empty: true, title: '', slots: 0 };
        this.supervisor.emit('bot-state', {
          userId: this.userId,
          key: this.key,
          state: this.snapshot(),
        });
        break;
      }
      default:
        break;
    }
  }

  onStatus(line) {
    // Läuft gerade eine Abfrage (`:board`, `:menu`), gehört die Zeile dorthin und nicht
    // in die Ausgabe – sonst stünde die halbe Seitenleiste als Fließtext im Protokoll.
    if (this.capture && Date.now() < this.capture.until) {
      this.capture.lines.push(line);
      clearTimeout(this.capture.timer);
      this.capture.timer = setTimeout(() => this.finishCapture(), 400);
      this.capture.timer.unref?.();
      return;
    }

    const hit = classify(line);
    if (!hit) {
      this.push('status', line);
      return;
    }
    // Meldet der Client Ereignisse, zählen hier nur noch Anmeldung und Aufgabe – den Rest hat
    // `@event` schon gemeldet, und zweimal derselbe Zustandswechsel wäre nur Rauschen.
    const authOnly = ['auth', 'authfail', 'authstale', 'authuri', 'authcode', 'giveup'];
    if (this.usesEvents && !authOnly.includes(hit.kind)) {
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
        // Steht der Code schon fest, gleich die fertige Adresse mitgeben.
        if (this.auth.code) this.auth.uri_complete = codeUrl(hit.match[1], this.auth.code);
        break;
      case 'authcode':
        this.auth = {
          ...(this.auth || {}),
          code: hit.match[1],
          uri_complete: codeUrl(this.auth?.uri || MS_LINK, hit.match[1]),
          since: Date.now(),
        };
        this.markAccountBroken('Die Anmeldung ist abgelaufen – bitte neu verbinden.');
        this.setState('auth', `Code ${hit.match[1]}`);
        this.push(
          'error',
          `Die Anmeldung für "${this.account.name}" ist abgelaufen. Neuer Code: ${hit.match[1]}`
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

  // ------------------------------------------------------------ Abfragen einsammeln

  /**
   * Ab jetzt gehören die nächsten Ausgabezeilen zu einer Abfrage. Der Client kennt dafür kein
   * Ereignis – er schreibt die Seitenleiste als Text hin. Da aber immer das Panel danach fragt,
   * weiß es auch, wann eine Antwort zu erwarten ist: zwei Sekunden, oder bis 400 ms Ruhe ist.
   */
  beginCapture(kind) {
    if (this.capture) {
      clearTimeout(this.capture.timer);
      this.finishCapture();
    }
    this.capture = { kind, lines: [], until: Date.now() + 2000, timer: null };
    this.capture.timer = setTimeout(() => this.finishCapture(), 2000);
    this.capture.timer.unref?.();
  }

  finishCapture() {
    const capture = this.capture;
    if (!capture) return;
    clearTimeout(capture.timer);
    this.capture = null;
    const view = parseView(capture.kind, capture.lines);
    this.views[capture.kind] = view;
    if (capture.kind === 'menu' && view && !view.empty) {
      this.menu = { ...(this.menu || {}), title: view.title, slots: view.slots, at: Date.now() };
    }
    this.supervisor.emit('bot-view', {
      userId: this.userId,
      key: this.key,
      kind: capture.kind,
      view,
    });
  }

  /** Konto als "braucht neue Anmeldung" kennzeichnen – das Panel zeigt es an prominenter Stelle. */
  markAccountBroken(reason) {
    db.prepare('UPDATE mc_accounts SET status = ?, last_error = ? WHERE id = ?').run(
      'error',
      reason,
      this.account.id
    );
  }

  /**
   * Die Datei umlegen, bevor sie zu groß wird.
   *
   * Ein Bot auf einem gesprächigen Server schreibt jede Chatzeile mit. Ohne diese Bremse wuchs die
   * Datei unbegrenzt weiter – bei mehreren Bots über Wochen bis die Platte voll war. Es bleiben
   * immer die laufende Datei und eine vorherige.
   */
  rotateLog(bytes) {
    if (this.logBytes === undefined) {
      try {
        this.logBytes = fs.statSync(this.logFile).size;
      } catch {
        this.logBytes = 0;
      }
    }
    this.logBytes += bytes;
    if (this.logBytes <= LOG_MAX_BYTES) return;
    try {
      fs.renameSync(this.logFile, `${this.logFile}.1`);
    } catch {
      /* Datei ist gerade nicht da – dann fängt sie eben neu an. */
    }
    this.logBytes = bytes;
  }

  push(type, text) {
    const entry = { t: Date.now(), type, text };
    this.chat.push(entry);
    // Die Grenze aus dem Tarif zählt **Chatzeilen**, nicht Zustandsmeldungen. Sonst hätte ein
    // Bot, der eine Stunde lang neu verbindet, einen vollen Puffer aus Verbindungsmeldungen und
    // keinen Chat mehr darin – gerade dann, wenn man nachlesen will, was passiert ist.
    const limit = this.chatLimit;
    let over = this.chat.filter((line) => line.type === 'chat' || line.type === 'sent').length - limit;
    while (over > 0) {
      const index = this.chat.findIndex((line) => line.type === 'chat' || line.type === 'sent');
      if (index < 0) break;
      this.chat.splice(0, index + 1);
      over -= 1;
    }
    // Zustandsmeldungen dürfen den Puffer trotzdem nicht unbegrenzt füllen.
    const hardLimit = limit + 200;
    if (this.chat.length > hardLimit) this.chat.splice(0, this.chat.length - hardLimit);
    if (type === 'chat' || type === 'error') {
      const record = `${new Date(entry.t).toISOString()} ${type} ${text}\n`;
      this.rotateLog(Buffer.byteLength(record));
      fs.appendFile(this.logFile, record, () => {});
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
      throw new HttpError(409, 'Der Bot läuft gerade nicht.', { en: 'That bot is not running.' });
    }
    const line = String(text).replace(/[\r\n]+/g, ' ').trim();
    if (!line) return false;
    this.proc.stdin.write(`${line}\n`);
    // Örtliche Befehle (`:go vor 5`, `:board`) gehen nie an den Server und gehören deshalb auch
    // nicht in den Chatverlauf. Dort stand vorher "Gesendet: :go vor 3" zwischen den Nachrichten
    // der Mitspieler – zu lesen war der Chat damit nicht mehr.
    if (!line.startsWith(':')) this.push('sent', line);
    return true;
  }

  /**
   * Örtlicher Befehl (`:go vor 5`, `:board`, `:click 13`). Er geht nie an den Server.
   * `need` sagt, welche Fähigkeit die Bauform dafür mitbringen muss.
   */
  local(verb, arg = '', need = 'movement') {
    if (!this.caps[need]) {
      throw new HttpError(
        409,
        need === 'movement'
          ? 'Bewegung gibt es ab einem bezahlten Serverplatz (Premium-Client).'
          : 'Dieser Befehl braucht den Premium-Client.',
        {
          en:
            need === 'movement'
              ? 'Movement needs a paid server slot (premium client).'
              : 'This command needs the premium client.',
        }
      );
    }
    // Abfragen, deren Antwort als Ansicht gehört und nicht als Textzeilen.
    if (verb === 'board' || verb === 'menu') this.beginCapture(verb);
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
      build: this.build,
      menu: this.menu,
      views: this.views,
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

  runningCount(userId) {
    let count = 0;
    for (const bot of this.bots.values()) {
      if (bot.running && (userId === undefined || bot.userId === userId)) count += 1;
    }
    return count;
  }

  runningOnProfile(profileId) {
    let count = 0;
    for (const bot of this.bots.values()) {
      if (bot.running && bot.profile.id === profileId) count += 1;
    }
    return count;
  }

  /** Befehle, die der Client selbst takten soll: Beitrittsbefehle und Dauer-Wiederholungen. */
  joinCommands(profileId, accountId) {
    const out = [];
    for (const macro of this.enabledMacros(profileId, accountId)) {
      const actions = JSON.parse(macro.actions || '[]');
      const settings = JSON.parse(macro.config || '{}');
      if (!simpleChatMacro(actions)) continue;
      if (macro.event === 'join') {
        for (const action of actions) out.push(action.text);
      } else if (macro.event === 'timer' && settings.interval_sec) {
        for (const action of actions) {
          out.push(`${Math.max(5, settings.interval_sec)}:${action.text}`);
        }
      }
    }
    return out;
  }

  /**
   * Macros, die der Client mit `--on` selbst auslösen kann: Weltwechsel, Tod und Chat-Treffer.
   * Der Client sieht diese Ereignisse im Protokoll, das Panel nur in Meldungstexten – deshalb
   * bekommt er sie, sobald er sie versteht.
   */
  clientMacros(profileId, accountId) {
    const out = [];
    for (const macro of this.enabledMacros(profileId, accountId)) {
      const actions = JSON.parse(macro.actions || '[]');
      const settings = JSON.parse(macro.config || '{}');
      if (!simpleChatMacro(actions)) continue;
      let trigger = null;
      if (macro.event === 'world') trigger = 'world';
      else if (macro.event === 'death') trigger = 'death';
      else if (macro.event === 'chat' && settings.contains && !settings.regex) {
        trigger = `chat:${settings.contains}`;
      }
      if (!trigger) continue;
      for (const action of actions) out.push(`${trigger}=${action.text}`);
    }
    return out;
  }

  enabledMacros(profileId, accountId) {
    return db
      .prepare('SELECT * FROM macros WHERE profile_id = ? AND enabled = 1')
      .all(profileId)
      .filter((macro) => {
        const accounts = JSON.parse(macro.accounts || '[]');
        return !accounts.length || accounts.includes(accountId);
      });
  }

  /** Bot anlegen (falls nötig) und starten. */
  start({ profile, account, user, plan }) {
    const tariff = plan || featuresOf(profile);
    const maxPerUser = Number(getSetting('max_bots_per_user')) || config.maxBotsPerUser;
    if (this.runningCount() >= config.maxBotsTotal) {
      throw new HttpError(429, 'Der Server ist ausgelastet. Bitte später erneut versuchen.', {
        en: 'The server is at capacity. Please try again later.',
      });
    }
    if (this.runningCount(user.id) >= maxPerUser) {
      throw new HttpError(429, `Mehr als ${maxPerUser} Bots gleichzeitig gehen nicht.`, {
        en: `More than ${maxPerUser} bots at once is not possible.`,
      });
    }
    if (profile.locked) {
      throw new HttpError(
        403,
        `"${profile.name}" ist gesperrt${profile.lock_reason ? `: ${profile.lock_reason}` : '.'}`,
        {
          en: `"${profile.name}" is locked${profile.lock_reason ? `: ${profile.lock_reason}` : '.'}`,
        }
      );
    }
    if (profile.suspended) {
      throw new HttpError(
        402,
        `"${profile.name}" ist stillgelegt. Laufzeit verlängern, dann geht es weiter.`,
        { en: `"${profile.name}" is suspended. Renew it and it carries on.` }
      );
    }
    if (!isActive(profile)) {
      throw new HttpError(402, `Für "${profile.name}" ist die bezahlte Laufzeit abgelaufen.`, {
        en: `The paid month for "${profile.name}" has run out.`,
      });
    }
    const already = this.get(profile.id, account.id);
    if (!already?.running && this.runningOnProfile(profile.id) >= tariff.max_accounts) {
      throw new HttpError(
        402,
        `Der Tarif "${tariff.name_de}" erlaubt ${tariff.max_accounts} Bot(s) gleichzeitig auf diesem Server.`,
        {
          en: `Plan "${tariff.name_en}" allows ${tariff.max_accounts} bot(s) at once on this server.`,
        }
      );
    }
    if (account.status === 'error') {
      throw new HttpError(
        409,
        `Konto "${account.name}" ist nicht angemeldet: ${account.last_error || 'unbekannt'}`,
        { en: `Account "${account.name}" is not signed in: ${account.last_error || 'unknown'}` }
      );
    }
    if (account.kind === 'offline' && !tariff.offline_accounts) {
      throw new HttpError(402, 'Offline-Konten gibt es ab einem bezahlten Serverplatz.', {
        en: 'Offline accounts come with a paid server slot.',
      });
    }

    const accountFile = path.join(userDir(user.id), 'afksystems', 'accounts', `${account.name}.json`);
    if (account.kind === 'microsoft' && !fs.existsSync(accountFile)) {
      throw new HttpError(409, `Für "${account.name}" liegt keine Anmeldung vor. Bitte neu verbinden.`, {
        en: `There is no sign-in stored for "${account.name}". Please connect it again.`,
      });
    }

    db.prepare(
      `INSERT INTO bots (profile_id, account_id, state) VALUES (?, ?, 'starting')
       ON CONFLICT(profile_id, account_id) DO UPDATE SET state = 'starting'`
    ).run(profile.id, account.id);
    db.prepare('UPDATE profile_accounts SET wanted = 1 WHERE profile_id = ? AND account_id = ?').run(
      profile.id,
      account.id
    );

    let bot = already;
    if (bot && bot.running) return bot.snapshot();
    if (!bot) {
      bot = new Bot(this, { profile, account, user, plan: tariff });
      this.bots.set(bot.key, bot);
    } else {
      bot.profile = profile;
      bot.account = account;
      bot.plan = tariff;
    }
    bot.start();
    this.macros.attach(bot);
    return bot.snapshot();
  }

  stop(profileId, accountId, { keepWanted = false } = {}) {
    if (!keepWanted) {
      db.prepare('UPDATE profile_accounts SET wanted = 0 WHERE profile_id = ? AND account_id = ?').run(
        profileId,
        accountId
      );
    }
    const bot = this.get(profileId, accountId);
    if (!bot) return null;
    bot.stop();
    return bot.snapshot();
  }

  /** Alle Bots eines Serverplatzes anhalten – etwa, wenn die Laufzeit abgelaufen ist. */
  stopProfile(profileId, reason = '', { keepWanted = true } = {}) {
    for (const bot of this.bots.values()) {
      if (bot.profile.id !== profileId || !bot.running) continue;
      if (reason) bot.push('system', reason);
      if (!keepWanted) {
        db.prepare(
          'UPDATE profile_accounts SET wanted = 0 WHERE profile_id = ? AND account_id = ?'
        ).run(bot.profile.id, bot.account.id);
      }
      bot.stop();
    }
  }

  stopUser(userId, reason = '') {
    for (const bot of this.bots.values()) {
      if (bot.userId !== userId || !bot.running) continue;
      if (reason) bot.push('system', reason);
      db.prepare('UPDATE profile_accounts SET wanted = 0 WHERE profile_id = ? AND account_id = ?').run(
        bot.profile.id,
        bot.account.id
      );
      bot.stop();
    }
  }

  scheduleRestart(bot) {
    const attempts = (this.restarts.get(bot.key) || 0) + 1;
    this.restarts.set(bot.key, attempts);
    // Nach fünf Fehlversuchen bleibt es aus – sonst dreht sich das ewig im Kreis.
    if (attempts > 5) {
      bot.push('error', 'Fünf Startversuche fehlgeschlagen – bleibt aus.');
      db.prepare('UPDATE profile_accounts SET wanted = 0 WHERE profile_id = ? AND account_id = ?').run(
        bot.profile.id,
        bot.account.id
      );
      return;
    }
    const delay = Math.min(60_000, 5000 * attempts);
    bot.push('system', `Neustart in ${Math.round(delay / 1000)} s (Versuch ${attempts}).`);
    setTimeout(() => {
      if (!bot.wanted()) return;
      const fresh = this.context(bot.profile.id, bot.account.id);
      if (!fresh || !isActive(fresh.profile)) return;
      bot.profile = fresh.profile;
      bot.account = fresh.account;
      bot.plan = fresh.plan;
      bot.start();
      this.macros.attach(bot);
    }, delay).unref();
  }

  /** Serverplatz, Konto, Nutzer und Tarif frisch aus der Datenbank holen. */
  context(profileId, accountId) {
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    const account = db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(accountId);
    if (!profile || !account) return null;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(profile.user_id);
    if (!user) return null;
    return { profile, account, user, plan: featuresOf(profile) };
  }

  /** Wie viele Bots gerade auf einem Standort laufen – für die Auslastungsanzeige und die Grenze. */
  runningOnNode(nodeId) {
    let count = 0;
    for (const bot of this.bots.values()) {
      if (bot.running && bot.profile.node_id === nodeId) count += 1;
    }
    return count;
  }

  /** Die Betriebssystem-Prozesse aller Bots – Grundlage für die Ressourcenanzeige im Admin-Bereich. */
  pids() {
    const out = [];
    for (const bot of this.bots.values()) {
      if (bot.proc?.pid) {
        out.push({ pid: bot.proc.pid, key: bot.key, userId: bot.userId, profileId: bot.profile.id });
      }
    }
    return out;
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
      if (context.user.blocked || context.profile.locked || !isActive(context.profile)) continue;
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

/** Ein Macro, das nichts als Chatzeilen ohne Wartezeit sendet – nur das kann der Client selbst. */
function simpleChatMacro(actions) {
  return actions.length > 0 && actions.every((action) => action.type === 'chat' && !action.delay);
}

export const supervisor = new Supervisor();
export { Bot, simpleChatMacro, parseEvent };
