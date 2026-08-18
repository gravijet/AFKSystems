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
import * as agents from './agents.js';
import { featuresOf, isActive, gateCaps, freeAccess } from './billing.js';
import { HttpError, codeUrl, MS_LINK } from './util.js';
import { stripFormatting } from '../public/assets/js/chatlog.js';

// Jede Steuersequenz, nicht nur Farben: die Live-Ansicht setzt den Cursor mit `ESC[H` nach oben
// und löscht mit `ESC[2J`. Blieben die stehen, stünde `[H` als Text in einer Statusmeldung.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const stripAnsi = (text) => text.replace(ANSI, '');

/**
 * Die Farben des Clients zurück in Minecraft-Farbcodes.
 *
 * Der Client bekommt vom Server `§`-Codes bzw. Chat-Komponenten und schreibt sie als ANSI-Farben
 * auf die Standardausgabe – das ist für ein Terminal richtig und für ein Webpanel unbrauchbar.
 * Diese Tabelle ist der Rückweg: aus `ESC[91m` wird wieder `§c`, aus `ESC[38;2;r;g;bm` die
 * moderne Schreibweise `§x§r§r§g§g§b§b`. Damit läuft die Chatzeile durch dieselbe Anzeige wie
 * Anzeigetafel und Gegenstände (chatlog.parseFormatting), und der Chat sieht aus wie im Spiel.
 *
 * Früher startete das Panel den Client mit `--no-color`. Dann kam die Zeile ohne jede Farbe an –
 * die Information war schon weg, bevor sie hier ankam.
 */
const ANSI_COLORS = {
  30: '0', 34: '1', 32: '2', 36: '3', 31: '4', 35: '5', 33: '6', 37: '7',
  90: '8', 94: '9', 92: 'a', 96: 'b', 91: 'c', 95: 'd', 93: 'e', 97: 'f',
};
const ANSI_STYLES = { 1: 'l', 3: 'o', 4: 'n', 9: 'm' };

/** Eine SGR-Anweisung ("1;38;2;255;0;0") in `§`-Codes übersetzen. */
function sgrToMinecraft(params) {
  const parts = params.split(';');
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const code = Number(parts[i]);
    if (!Number.isFinite(code)) continue;
    // Echtfarbe: 38;2;r;g;b. Minecraft schreibt sie als §x gefolgt von sechs §-Ziffern.
    if (code === 38 && Number(parts[i + 1]) === 2) {
      const hex = [parts[i + 2], parts[i + 3], parts[i + 4]]
        .map((value) => Math.max(0, Math.min(255, Number(value) || 0)).toString(16).padStart(2, '0'))
        .join('');
      out += `§x${[...hex].map((char) => `§${char}`).join('')}`;
      i += 4;
      continue;
    }
    if (code === 0) out += '§r';
    else if (ANSI_COLORS[code]) out += `§${ANSI_COLORS[code]}`;
    else if (ANSI_STYLES[code]) out += `§${ANSI_STYLES[code]}`;
    // 39 (Standardfarbe), 22 (nicht mehr fett) und alles Unbekannte fällt weg: ein Farbcode setzt
    // in Minecraft ohnehin alles zurück, was davor stand.
  }
  return out;
}

/** ANSI-gefärbter Text -> derselbe Text mit `§`-Codes. Alles andere an Steuerzeichen fällt weg. */
export function ansiToMinecraft(raw) {
  const text = String(raw ?? '');
  if (!text.includes('\x1b')) return text;
  let out = '';
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf('\x1b[', index);
    if (start < 0) {
      out += text.slice(index);
      break;
    }
    out += text.slice(index, start);
    const match = /^\x1b\[([0-9;?]*)([A-Za-z])/.exec(text.slice(start));
    if (!match) {
      // Ein abgeschnittenes Escape am Zeilenende – der Rest kommt mit dem nächsten Stück.
      out += text.slice(start + 2);
      break;
    }
    if (match[2] === 'm') out += sgrToMinecraft(match[1]);
    index = start + match[0].length;
  }
  return out;
}

// ---------------------------------------------------------------- Live-Ansicht (POV)
//
// Die POV-Bauformen zeichnen ein Bild ins Terminal: Cursor nach oben (`ESC[H`), dann Zeile für
// Zeile Zeichen aus einer Helligkeitsrampe, jedes in seiner Echtfarbe, darunter eine Fußzeile mit
// der Position. Das ist kein Chat und darf nicht durch die Chatverarbeitung laufen; hier wird das
// Bild wieder in Daten zerlegt, die der Browser als Raster zeichnen kann.

/** Die Zeichen, aus denen der Client ein Bild baut (dunkel nach hell) – plus Leerraum. */
const POV_RAMP = new Set([...' .:-=+*#%@']);

/** "POV  x=12 y=64 z=-8  gier=90  (:pov stop)" – die Zeile unter dem Bild. */
const POV_FOOTER = /^POV\s/;

/** Höchstens so oft geht ein Bild an den Browser. Der Client zeichnet schneller, als es nützt. */
const POV_MIN_GAP_MS = 200;

const isPovRow = (text) => text.length > 0 && [...text].every((char) => POV_RAMP.has(char));

/**
 * Eine gefärbte Bildzeile in Abschnitte zerlegen: [["7f9b3a", "  ..#"], …].
 *
 * Ohne diese Bündelung wären es 80 Einzelzellen je Zeile; so sind es meist ein paar Dutzend, und
 * das Bild passt auch bei mehreren Bildern je Sekunde durch die Leitung.
 */
function povCells(raw) {
  const runs = [];
  let color = null;
  let index = 0;
  const push = (text) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last[0] === color) last[1] += text;
    else runs.push([color, text]);
  };
  while (index < raw.length) {
    const start = raw.indexOf('\x1b[', index);
    if (start < 0) {
      push(raw.slice(index));
      break;
    }
    push(raw.slice(index, start));
    const match = /^\x1b\[([0-9;?]*)([A-Za-z])/.exec(raw.slice(start));
    if (!match) break;
    if (match[2] === 'm') {
      const parts = match[1].split(';').map(Number);
      if (parts[0] === 38 && parts[1] === 2) {
        color = [parts[2], parts[3], parts[4]]
          .map((value) => Math.max(0, Math.min(255, value || 0)).toString(16).padStart(2, '0'))
          .join('');
      } else if (parts[0] === 0 || Number.isNaN(parts[0])) {
        color = null;
      }
    }
    index = start + match[0].length;
  }
  return runs;
}

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
  if (kind === 'position') {
    const text = rows.join(' ');
    const match = /x=(-?\d+(?:[.,]\d+)?)\s+y=(-?\d+(?:[.,]\d+)?)\s+z=(-?\d+(?:[.,]\d+)?).*?(?:Blick|look)\s+(-?\d+(?:[.,]\d+)?)°(?:\s*\([^)]*\))?\s*\/\s*(-?\d+(?:[.,]\d+)?)°/i.exec(
      text
    );
    if (!match) return { empty: true, text };
    const number = (value) => Number(value.replace(',', '.'));
    return {
      empty: false,
      x: number(match[1]),
      y: number(match[2]),
      z: number(match[3]),
      yaw: number(match[4]),
      pitch: number(match[5]),
      text,
    };
  }
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
    this.views = { board: null, menu: null, position: null, pov: null };
    this.capture = null;
    // Live-Ansicht: `povWanted` ist der Schalter (`:pov live`), `povRows` das Bild, das gerade
    // Zeile für Zeile hereinkommt. Solange niemand die Ansicht angefordert hat, kostet die
    // Erkennung genau eine Abfrage je Zeile.
    this.povWanted = false;
    this.povRows = null;
    this.povStatus = '';
    this.povSentAt = 0;
    this.povSize = { width: 80, height: 40 };
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
      '--chat-delay',
      String(profile.chat_delay),
    ];
    // Kein `--no-color`: der Client schreibt Chatfarben als ANSI, und genau daraus baut
    // `ansiToMinecraft` die `§`-Codes wieder auf. Mit `--no-color` wäre die Farbe schon weg,
    // bevor das Panel die Zeile überhaupt sieht – und der Chat stünde grau im Browser.

    if (this.account.kind === 'offline' && caps.offline) args.push('--offline', this.account.name);
    else args.push('--account', this.account.name);

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

  /** Der Standort, auf dem dieser Bot laufen soll. Ohne Eintrag: diese Maschine. */
  node() {
    if (!this.profile.node_id) return null;
    return db.prepare('SELECT * FROM nodes WHERE id = ?').get(this.profile.node_id) || null;
  }

  start() {
    if (this.proc) return this;
    const { command, file, build } = binaries.command(this.profile, this.plan);
    this.build = build;
    // `this.caps` erst nach `this.build` lesen – es hängt an der Bauform, die gerade gewählt wurde.
    const caps = this.caps;
    const args = this.args(caps);
    this.usesEvents = Boolean(caps.events);
    const home = userDir(this.userId);

    this.stopping = false;
    // `pov-afk-linux` beginnt gleich nach dem Beitritt zu zeichnen; da wartet niemand auf
    // `:pov live`. Bei `ultra-afk-linux` bleibt die Ansicht aus, bis sie jemand einschaltet.
    this.povWanted = build === 'pov' && Boolean(caps.pov);
    this.setState('starting', `${this.profile.host} · MC ${this.profile.mc_version}`);

    // Örtlich oder auf einem Standort? Beides sieht von hier aus gleich aus: `agents.spawn`
    // liefert ein Objekt mit stdout/stderr/stdin/kill, genau wie `child_process.spawn`. Nur so
    // bleibt der ganze Rest dieser Klasse frei von der Frage, wo der Prozess wirklich liegt.
    const node = this.node();
    this.nodeId = node?.id || null;
    this.remote = node?.kind === 'agent';
    if (this.remote) {
      try {
        this.proc = agents.spawn(node.id, { file, args, userId: this.userId });
      } catch (error) {
        this.setState('error', error.message);
        this.lastError = error.message;
        throw new HttpError(503, error.message, {
          en: `Location "${node.name}" is not reachable right now.`,
        });
      }
    } else {
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
    }

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
        : signal === 'LINK'
          ? 'Die Verbindung zum Standort ist abgerissen.'
          : `Client beendet (${signal || `Code ${code}`})`;
      if (!this.stopping && code !== 0) this.lastError = reason;
      this.push('system', reason);
      this.setState(this.stopping ? 'offline' : code === 0 ? 'offline' : 'error', reason);
      this.cleanup();
      // Der neue Rust-Client beendet nach Kick oder Netzabbruch absichtlich die Sitzung. Das Panel
      // respektiert das: kein versteckter Prozess-Neustart, sondern ein bewusster neuer Start.
      //
      // Ausnahme: `LINK` heißt, dass die Leitung zum Standort abgerissen ist. Das ist keine
      // Entscheidung des Kunden und kein Ende der Sitzung im Spiel – der Wunsch bleibt stehen,
      // und `restoreNode()` fährt den Bot wieder hoch, sobald der Standort zurück ist.
      if (!this.stopping && signal !== 'LINK') {
        db.prepare(
          'UPDATE profile_accounts SET wanted = 0 WHERE profile_id = ? AND account_id = ?'
        ).run(this.profile.id, this.account.id);
      }
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
    this.views = { board: null, menu: null, position: null, pov: null };
    this.povWanted = false;
    this.povRows = null;
    this.povStatus = '';
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
      const source = raw.replace(/\r$/, '');
      // Zuerst die Live-Ansicht: ein Bild besteht aus vielen Zeilen, die weder Chat noch Zustand
      // sind. Welcher der beiden Kanäle es trägt, entscheidet der Client – deshalb beide fragen.
      if (this.povFeed(source)) continue;
      const line = stripAnsi(source);
      if (!line.trim()) continue;
      if (stream === 'out') this.onChat(source);
      else if (line.startsWith('@event ')) this.onEvent(line);
      else this.onStatus(line);
    }
  }

  /**
   * Eine Chatzeile, wie sie hereinkam – mit Farben.
   *
   * Im Verlauf steht sie mit `§`-Codes: der Browser macht daraus dieselben Farben, die im Spiel
   * zu sehen wären. Macros dagegen bekommen den nackten Text; sonst fände "willkommen" nichts
   * mehr, sobald der Server das Wort einfärbt.
   */
  onChat(raw) {
    const colored = ansiToMinecraft(raw);
    this.push('chat', colored);
    this.supervisor.macros.onChat(this, stripFormatting(colored));
  }

  // ------------------------------------------------------------ Live-Ansicht

  /**
   * Gehört diese Rohzeile zu einem POV-Bild? Dann wird sie hier verbraucht (Rückgabe `true`).
   *
   * Ein Bild beginnt mit `ESC[H`, besteht danach nur aus Zeichen der Helligkeitsrampe und endet
   * an der Fußzeile mit der Position. Kommt nach `ESC[H` etwas anderes – etwa die Meldung
   * "Live-POV gestartet." –, ist es kein Bild und die Zeile geht ihren gewohnten Weg.
   */
  povFeed(raw) {
    if (!this.povWanted) return false;
    let body = raw;
    const home = raw.lastIndexOf('\x1b[H');
    if (home >= 0) {
      this.flushPov();
      this.povRows = [];
      body = raw.slice(home + 3);
      if (!stripAnsi(body).trim()) return true;
    }
    if (!this.povRows) return false;

    const text = stripAnsi(body);
    if (POV_FOOTER.test(text)) {
      this.povStatus = text.trim();
      this.flushPov();
      return true;
    }
    if (!isPovRow(text)) {
      this.povRows = null;
      return false;
    }
    // Ein Bild bleibt ein Bild: mehr als 120 Zeilen kann keine eingestellte Größe ergeben, und
    // ohne diese Grenze könnte ein hängender Client den Speicher volllaufen lassen.
    if (this.povRows.length < 120) this.povRows.push(povCells(body));
    return true;
  }

  /** Das gesammelte Bild an den Browser geben – höchstens alle POV_MIN_GAP_MS. */
  flushPov() {
    const rows = this.povRows;
    this.povRows = null;
    if (!rows || !rows.length) return;
    const now = Date.now();
    if (now - this.povSentAt < POV_MIN_GAP_MS) return;
    this.povSentAt = now;
    this.views.pov = {
      empty: false,
      width: Math.max(...rows.map((row) => row.reduce((sum, run) => sum + run[1].length, 0))),
      height: rows.length,
      rows,
      status: this.povStatus,
      at: now,
    };
    this.emitView('pov');
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
        const opened = /^open\s+id=(-?\d+)\s*([\s\S]*)$/i.exec(event.text || '');
        this.menu =
          event.text === 'close'
            ? null
            : {
                id: opened ? Number(opened[1]) : Number(event.id) || null,
                // Neue Rust-Clients schreiben `open id=7 <§-Titel>`. Die benannten Felder bleiben
                // als Rückwärtskompatibilität für ältere Clients erhalten.
                title: opened ? opened[2] : event.titel || event.title || '',
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
      case 'slot': {
        const slot = /^(\d+)\s+(\d+)\s+([\s\S]*)$/.exec(event.text || '');
        if (!slot) break;
        const index = Number(slot[1]);
        const current = this.views.menu && !this.views.menu.empty ? this.views.menu : {};
        const items = { ...(current.items || {}) };
        items[index] = {
          ...(items[index] || {}),
          count: Number(slot[2]) || 1,
          name: slot[3],
          lore: [],
        };
        this.views.menu = {
          empty: false,
          title: current.title || this.menu?.title || '',
          slots: current.slots || this.menu?.slots || 0,
          items,
          at: Date.now(),
        };
        this.emitView('menu');
        break;
      }
      case 'lore': {
        const lore = /^(\d+)\s+([\s\S]*)$/.exec(event.text || '');
        if (!lore || !this.views.menu || this.views.menu.empty) break;
        const index = Number(lore[1]);
        const items = { ...(this.views.menu.items || {}) };
        const item = items[index];
        if (!item) break;
        items[index] = { ...item, lore: [...(item.lore || []), lore[2]] };
        this.views.menu = { ...this.views.menu, items, at: Date.now() };
        this.emitView('menu');
        break;
      }
      case 'board': {
        const text = event.text || '';
        const title = /^(?:titel|title)\s+([\s\S]*)$/i.exec(text);
        if (title) {
          if (this.capture?.kind === 'board') {
            clearTimeout(this.capture.timer);
            this.capture = null;
          }
          this.views.board = { empty: false, title: title[1], rows: [], at: Date.now() };
        } else {
          const line = /^(?:zeile|line)\s+wert=(-?\d+)\s+zahl=([\s\S]*?)\s+text=([\s\S]*)$/i.exec(text);
          if (!line) break;
          if (!this.views.board || this.views.board.empty) {
            this.views.board = { empty: false, title: '', rows: [], at: Date.now() };
          }
          this.views.board.rows.push({
            score: Number(line[1]),
            number: line[2],
            hidden: line[2] === '',
            text: line[3],
          });
          this.views.board.rows = this.views.board.rows.slice(0, 15);
          this.views.board.at = Date.now();
        }
        this.emitView('board');
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
   * einzelnes Abschlussereignis. Strukturierte Board-/Item-Zeilen ergänzen den Text; die ruhige
   * Textphase markiert nach spätestens zwei Sekunden das Ende des Schnappschusses.
   */
  beginCapture(kind) {
    if (this.capture) {
      clearTimeout(this.capture.timer);
      this.finishCapture();
    }
    if (kind === 'menu') {
      // Jede Abfrage ist ein vollständiger Schnappschuss. Alte Felder dürfen nicht stehen bleiben,
      // wenn der Server inzwischen ein anderes Menü oder einen leeren Slot geschickt hat.
      this.views.menu = {
        empty: false,
        title: this.menu?.title || '',
        slots: this.menu?.slots || 0,
        items: {},
        at: Date.now(),
      };
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
    if (capture.kind === 'menu' && !view.empty) {
      const structured = this.views.menu && !this.views.menu.empty ? this.views.menu : null;
      view.title = view.title || structured?.title || this.menu?.title || '';
      view.slots = view.slots || structured?.slots || this.menu?.slots || 0;
      view.items = { ...(view.items || {}), ...(structured?.items || {}) };
      view.at = Date.now();
    }
    this.views[capture.kind] = view;
    if (capture.kind === 'menu' && view && !view.empty) {
      this.menu = { ...(this.menu || {}), title: view.title, slots: view.slots, at: Date.now() };
    }
    this.emitView(capture.kind);
  }

  emitView(kind) {
    this.supervisor.emit('bot-view', {
      userId: this.userId,
      key: this.key,
      kind,
      view: this.views[kind],
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
      // Ins Protokoll kommt der nackte Text. Wer eine Datei mit `grep` durchsucht, will nicht
      // gegen "§a" antreten müssen – die Farben stehen ohnehin im Verlauf des Panels.
      const record = `${new Date(entry.t).toISOString()} ${type} ${stripFormatting(text)}\n`;
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
  send(text, { local = false } = {}) {
    if (!this.proc || !this.proc.stdin.writable) {
      throw new HttpError(409, 'Der Bot läuft gerade nicht.', { en: 'That bot is not running.' });
    }
    const line = String(text).replace(/[\r\n]+/g, ' ').trim();
    if (!line) return false;
    if (line.startsWith(':') && !local) {
      throw new HttpError(400, 'Örtliche Client-Befehle müssen über die geprüfte Befehlsfunktion laufen.', {
        en: 'Local client commands must use the checked command endpoint.',
      });
    }
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
      const messages = {
        movement: [
          'Bewegung gibt es ab einem bezahlten Serverplatz (Premium-Client).',
          'Movement needs a paid server slot (premium client).',
        ],
        pov: [
          'Die Live-Ansicht ist für diesen Serverplatz nicht gebucht.',
          'The live view is not booked for this server slot.',
        ],
      };
      const message = messages[need] || [
        'Dieser Befehl braucht den Premium-Client.',
        'This command needs the premium client.',
      ];
      throw new HttpError(409, message[0], { en: message[1] });
    }
    // Abfragen, deren Antwort als Ansicht gehört und nicht als Textzeilen.
    if (verb === 'board' || verb === 'menu') this.beginCapture(verb);
    if (verb === 'pos' || verb === 'position') this.beginCapture('position');
    if (verb === 'pov') this.setPov(arg);
    return this.send(`:${verb}${arg ? ` ${arg}` : ''}`, { local: true });
  }

  /**
   * Was `:pov …` im Panel bedeutet.
   *
   * Der Client zeichnet, sobald er soll; das Panel muss nur wissen, ob es die Bildzeilen ab jetzt
   * als Bild lesen soll oder als gewöhnliche Ausgabe. Ohne diesen Schalter würde jede Zeile jedes
   * Bots gegen die Bilderkennung laufen, auch wenn niemand die Ansicht offen hat.
   */
  setPov(arg) {
    const [mode, width, height] = String(arg || 'live').trim().split(/\s+/);
    if (mode === 'stop') {
      this.povWanted = false;
      this.povRows = null;
      this.views.pov = { empty: true };
      this.emitView('pov');
      return;
    }
    if (mode === 'size') {
      this.povSize = {
        width: Math.max(24, Math.min(160, Number(width) || this.povSize.width)),
        height: Math.max(12, Math.min(80, Number(height) || this.povSize.height)),
      };
      return;
    }
    // live, frame und info liefern alle Bildzeilen – ab jetzt zuhören.
    this.povWanted = true;
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
      // Ohne das Bild: ein Zustandswechsel wird bei laufender Live-Ansicht sonst zu einem
      // Datenpaket von zig Kilobyte. Bilder gehen ihren eigenen Weg (`bot-view`).
      views: { board: this.views.board, menu: this.views.menu, position: this.views.position },
      pov: this.povWanted ? { on: true, ...this.povSize } : { on: false, ...this.povSize },
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
        `"${profile.name}" ist suspendiert${profile.lock_reason ? `: ${profile.lock_reason}` : '.'}`,
        {
          en: `"${profile.name}" is suspended${profile.lock_reason ? `: ${profile.lock_reason}` : '.'}`,
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
      const access = tariff.free_slot ? freeAccess(profile.user_id) : null;
      if (access && !access.ok) {
        const messages = {
          'discord-link': [
            'Für den Gratis-Tarif muss ein Discord-Konto verknüpft sein.',
            'The Free plan requires a linked Discord account.',
          ],
          'discord-join': [
            'Für den Gratis-Tarif musst du Mitglied im AFKSystems-Discord sein.',
            'The Free plan requires membership in the AFKSystems Discord guild.',
          ],
          'discord-check': [
            'Die Discord-Mitgliedschaft konnte nicht aktuell bestätigt werden.',
            'Discord membership could not be confirmed recently.',
          ],
          'not-configured': [
            'Der Gratis-Tarif ist derzeit nicht verfügbar.',
            'The Free plan is currently unavailable.',
          ],
        };
        const message = messages[access.reason] || messages['discord-check'];
        throw new HttpError(403, message[0], { en: message[1], code: access.reason });
      }
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
    if (account.suspended) {
      throw new HttpError(
        403,
        `Konto "${account.name}" wurde stillgelegt${account.suspend_reason ? `: ${account.suspend_reason}` : '.'}`,
        {
          en: `Account "${account.name}" was suspended${account.suspend_reason ? `: ${account.suspend_reason}` : '.'}`,
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
    if (!keepWanted) {
      db.prepare('UPDATE profile_accounts SET wanted = 0 WHERE profile_id = ?').run(profileId);
    }
    for (const bot of this.bots.values()) {
      if (bot.profile.id !== profileId || !bot.running) continue;
      if (reason) bot.push('system', reason);
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

  /**
   * Die Bots eines Standorts wieder hochfahren, nachdem er sich zurückgemeldet hat.
   *
   * Beim Abriss der Leitung stoppt der Standort seine Prozesse – ein Bot, den niemand mehr lesen
   * oder steuern kann, ist kein laufender Bot. Umgekehrt bleibt der **Wunsch** stehen, und hier
   * wird er wieder eingelöst.
   */
  restoreNode(nodeId) {
    const rows = db
      .prepare(
        `SELECT pa.profile_id, pa.account_id FROM profile_accounts pa
           JOIN profiles p ON p.id = pa.profile_id
          WHERE pa.wanted = 1 AND p.node_id = ?`
      )
      .all(nodeId);
    let started = 0;
    for (const row of rows) {
      if (this.get(row.profile_id, row.account_id)?.running) continue;
      const context = this.context(row.profile_id, row.account_id);
      if (!context) continue;
      if (context.user.blocked || context.profile.locked || context.account.suspended) continue;
      if (!isActive(context.profile)) continue;
      try {
        this.start(context);
        started += 1;
      } catch {
        /* einer weniger, der Rest läuft trotzdem */
      }
    }
    return started;
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
      if (
        context.user.blocked ||
        context.profile.locked ||
        context.account.suspended ||
        !isActive(context.profile)
      )
        continue;
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
  return (
    actions.length > 0 &&
    actions.every(
      (action) => action.type === 'chat' && !action.delay && !String(action.text || '').trim().startsWith(':')
    )
  );
}

export const supervisor = new Supervisor();
export { Bot, simpleChatMacro, parseEvent, parseView };
