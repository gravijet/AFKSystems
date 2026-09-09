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
import { StringDecoder } from 'node:string_decoder';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths, userDir } from './config.js';
import { db, getSetting } from './db.js';
import * as binaries from './binaries.js';
import * as agents from './agents.js';
import * as resources from './resources.js';
import * as snapshots from './snapshots.js';
import * as notify from './notify.js';
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
// So sieht ein Bild des Clients wirklich aus (mitgeschnitten aus `ultra-afk-linux 2.0.0`):
//
//     ESC[2J ESC[H                                            einmal, beim ersten Bild
//     ESC[H POV  x=9.5 y=-60.0 z=-8.5  Blick 0/0  Chunks 213  (:pov stop)
//     ESC[38;2;r;g;bm ESC[48;2;r;g;bm ▀  …je Zelle…  ESC[0m   eine Zeichenzeile
//     …                                                       Höhe/2 solcher Zeilen
//
// Zwei Eigenschaften bestimmen alles Weitere:
//
//   * **Die `POV`-Zeile steht vorn.** Sie beginnt ein Bild, sie beendet keines. Wer sie als
//     Schlusszeile liest, sammelt nie eine einzige Bildzeile ein – das Panel wartete deshalb
//     ewig auf „das erste Bild“, während jede Bildzeile hinten als Statusmeldung im Chatverlauf
//     landete: gut sechshundert Zeilen je Sekunde und Bot, an jeden offenen Browser.
//   * **Ein Zeichen sind zwei Bildpunkte.** `▀` ist der obere Halbblock: die Vordergrundfarbe
//     malt den oberen Punkt, die Hintergrundfarbe den unteren. Eine Zeichenzeile ist also zwei
//     Bildzeilen, und wer die Hintergrundfarbe wegwirft, wirft das halbe Bild weg.
//
// Heraus kommen Bildzeilen aus Farbläufen (`[["4182d2", 160], …]`). Der Browser zeichnet sie auf
// ein Canvas, ohne irgendetwas über den Client wissen zu müssen.

/**
 * Die Bildgröße. Sie steht **nicht** zur Wahl.
 *
 * Der Client kann 24×12 bis 160×80. Alles unterhalb des Größten ist ein schlechteres Bild für
 * denselben Preis – die Rechenzeit dafür fällt beim Kunden ohnehin an, sobald die Ansicht läuft.
 * Deshalb setzt das Panel die größte Größe und nimmt von außen keine andere an.
 */
export const POV_SIZE = { width: 160, height: 80 };

/**
 * Wie oft der Client zeichnen soll.
 *
 * Er kann bis zwanzig Bilder je Sekunde; an den Browser gehen davon höchstens fünf (siehe
 * `POV_MIN_GAP_MS`). Die übrigen fünfzehn wären Rechenzeit für Bilder, die das Panel gleich
 * wieder wegwirft – bei 160×80 sind das je Bild gut 300 Kilobyte, die durch eine Pipe müssen und
 * dann in den Papierkorb gehen. Fünf ist deshalb kein Sparen an der Ansicht, sondern das Ende
 * einer Doppelarbeit: Die Auflösung bleibt die volle, nur wird sie nicht dreimal umsonst gerechnet.
 */
export const POV_FPS = 5;

// ---------------------------------------------------------------- Live-Ansicht (texturiert)
//
// Client 2.5.0 kann dasselbe Bild noch einmal ganz anders: `--pov-web <port>` startet im Client
// einen kleinen HTTP-Server, der fertige PNG-Bilder aus echten Blockmodellen und Texturen liefert,
// dazu Hotbar, Inventar und das offene Menü als JSON. Die Halbblöcke oben bleiben – sie sind das,
// was ohne Original-JAR übrig ist, und ein zugesagtes Format, das nichts kostet.
//
// Drei Dinge unterscheiden den Viewer vom ANSI-Strom, und alle drei sind Vorteile:
//
//   * **Er wird gezogen, nicht geschoben.** Der Client rechnet ein Bild, wenn jemand eines abholt.
//     Ein Browser, der nicht fragt, kostet nichts – die Bremse `POV_MIN_GAP_MS` oben gibt es hier
//     gar nicht erst zu bauen.
//   * **Er hat einen Zugriffstoken.** Der Client würfelt ihn beim Start und schreibt die fertige
//     Adresse einmal auf die Fehlerausgabe. Von dort liest ihn dieses Panel – und nur dieses.
//   * **Er lauscht auf 127.0.0.1.** Aus dem Netz ist er nicht erreichbar, auch nicht auf einem
//     Standort. Was der Kunde im Browser sieht, geht deshalb durch das Panel (siehe `webFetch`).
//
// Der Port kommt aus einem festen Bereich, damit man ihn in einer Firewall wiedererkennt. Jeder
// laufende Bot bekommt eine eigene Nummer, auch auf verschiedenen Maschinen: Zwei Bots mit
// derselben Nummer auf demselben Standort könnten sich sonst gegenseitig den Port wegnehmen, und
// die Nummer global eindeutig zu vergeben kostet nichts.
const WEB_PORT_MIN = 42100;
const WEB_PORT_MAX = 42999;
const usedWebPorts = new Set();

function takeWebPort() {
  for (let port = WEB_PORT_MIN; port <= WEB_PORT_MAX; port++) {
    if (usedWebPorts.has(port)) continue;
    usedWebPorts.add(port);
    return port;
  }
  // Neunhundert gleichzeitige Bots mit Live-Ansicht sind weit jenseits von `MAX_BOTS_TOTAL`.
  // Trotzdem: kein Port heißt keine texturierte Ansicht, nicht "kein Bot".
  return null;
}

/** Was der Client beim Start über seinen Viewer sagt. */
const WEB_READY = /^Browser-POV:\s*(https?:\/\/\S+)$/;
const WEB_WARN = /^Browser-POV startet ohne Texturen:\s*(.+)$/;

/** So lange darf eine Anfrage an den Viewer dauern. Ein Bild rechnet er in Millisekunden. */
const WEB_TIMEOUT_MS = 8000;

/** Die Kopfzeile eines Bildes. Davor stehen je nach Lage `ESC[2J` und `ESC[H`. */
const POV_HEAD = /^(?:\x1b\[[0-9;?]*[A-Za-z])*POV\s+x=/;

/** Höchstens so oft geht ein Bild an den Browser. Der Client zeichnet schneller, als es nützt. */
const POV_MIN_GAP_MS = 200;

/** Mehr Bildzeilen als die größte Bildgröße hergibt, kann kein Bild haben. */
const POV_MAX_ROWS = POV_SIZE.height;

/** `▀` – der obere Halbblock, das einzige Zeichen, aus dem ein Bild besteht. */
const HALF_BLOCK = 0x2580;

const SGR_FOREGROUND = '\x1b[38;2;';
const SGR_BACKGROUND = '\x1b[48;2;';
const SGR_RESET = '\x1b[0m';

/**
 * `ESC[38;2;r;g;bm` ab `at` lesen und als `rrggbb` zurückgeben – oder `null`, wenn dort etwas
 * anderes steht. Ziffern werden direkt aus den Zeichencodes gerechnet: das ist der heißeste Pfad
 * im Panel (160 Zellen je Zeile, 40 Zeilen je Bild, ein Bild alle 60 ms **je Bot**), und er soll
 * dabei nichts anlegen, was er nicht braucht.
 */
function readColor(raw, at, prefix) {
  if (!raw.startsWith(prefix, at)) return null;
  let index = at + prefix.length;
  let hex = '';
  for (let part = 0; part < 3; part++) {
    let value = 0;
    let digits = 0;
    while (index < raw.length) {
      const code = raw.charCodeAt(index);
      if (code < 48 || code > 57) break;
      value = value * 10 + (code - 48);
      digits += 1;
      index += 1;
    }
    // Nach r und g steht ein Semikolon, nach b das abschließende 'm'.
    if (!digits || value > 255 || raw.charCodeAt(index) !== (part < 2 ? 59 : 109)) return null;
    index += 1;
    hex += value < 16 ? `0${value.toString(16)}` : value.toString(16);
  }
  return { hex, next: index };
}

/**
 * Eine Zeichenzeile in ihre zwei Bildzeilen zerlegen: `{ top, bottom }`, jede als Farbläufe.
 *
 * `null` heißt „das war keine Bildzeile“ – dann ist das Bild zu Ende und die Zeile geht ihren
 * gewohnten Weg als Meldung. Die Prüfung ist streng: Es gibt genau eine Schreibweise, und alles
 * andere ist keine. Ohne diese Strenge verschwände eine Chatzeile, in der jemand `▀` schreibt.
 */
function povRow(raw) {
  const length = raw.length;
  const top = [];
  const bottom = [];
  let index = 0;
  const add = (runs, hex) => {
    const last = runs[runs.length - 1];
    if (last && last[0] === hex) last[1] += 1;
    else runs.push([hex, 1]);
  };
  while (index < length) {
    if (raw.startsWith(SGR_RESET, index)) {
      index += SGR_RESET.length;
      continue;
    }
    const foreground = readColor(raw, index, SGR_FOREGROUND);
    if (!foreground) return null;
    const background = readColor(raw, foreground.next, SGR_BACKGROUND);
    if (!background) return null;
    if (raw.charCodeAt(background.next) !== HALF_BLOCK) return null;
    index = background.next + 1;
    add(top, foreground.hex);
    add(bottom, background.hex);
  }
  return top.length ? { top, bottom } : null;
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

// ---------------------------------------------------------------- Wiederanlauf
//
// **Was von selbst zurückkommt und was nicht.**
//
// Der Client beendet sich nach einem Kick oder einem Netzabbruch; einen eigenen Reconnect hat er
// nicht. Bis hierher hieß das: Ein Bot, der nachts um drei rausflog, war am Morgen aus, und der
// Startwunsch war gleich mit gelöscht. Für einen Dienst, dessen ganzer Zweck es ist, dass jemand
// im Spiel steht, war das die falsche Vorgabe.
//
// Es geht dabei nicht um "immer neu starten". Ein Server, der jeden Beitritt ablehnt – falsche
// Adresse, falsche Version, Bann, Whitelist –, lehnt ihn auch beim zwanzigsten Mal ab; ein Panel,
// das trotzdem weiterstartet, ist eine Neustartschleife im Minutentakt und für den Minecraft-Server
// nicht von einem Angriff zu unterscheiden. Die Trennlinie ist deshalb genau die aus der Frage:
// **war er vorher im Spiel?** War er es, ist das Aus eine Störung und die Verbindung kommt zurück.
// War er es nie, ist es eine Absage, und die wiederholt sich nicht von selbst.
//
// Drei Größen halten das im Rahmen:
//
//   * `reconnect_delay` (Vorgabe 5 s) verdoppelt sich mit jedem Fehlversuch bis `max_backoff`
//     (Vorgabe 60 s). Ein Server, der gerade neu startet, wird damit nicht bestürmt.
//   * `RESTART_MAX_TRIES` beendet die Kette. Danach bleibt der Bot aus und der Kunde erfährt es –
//     ein Wiederanlauf, der ewig scheitert, ist eine Störung, die niemandem gemeldet wird.
//   * `RESTART_STABLE_MS`: Wer so lange im Spiel stand, hat die Kette hinter sich gelassen. Der
//     nächste Ausfall fängt wieder bei Versuch eins an. Ohne diese Zeile wäre ein Bot, der einmal
//     im Monat kurz die Verbindung verliert, nach acht Monaten "aufgegeben" – und ein Server, der
//     im Minutentakt kickt, liefe trotzdem ewig weiter, weil jeder Versuch ja "online" war.
//
// Der Neustart nach einem **VPS-Neustart** braucht davon nichts: Der Wunsch (`wanted`) steht in
// der Datenbank, `restoreAll()` löst ihn beim Hochfahren ein, und die systemd-Einheit fährt das
// Panel hoch. Der Beitrag dieser Stelle dazu ist ein einziger: den Wunsch **stehen zu lassen**,
// statt ihn beim Absturz zu löschen.

/** So oft wird ein Bot nacheinander neu gestartet, bevor das Panel es aufgibt. */
const RESTART_MAX_TRIES = 8;

/** So lange muss ein Bot im Spiel gestanden haben, damit die Versuchskette wieder bei null steht. */
const RESTART_STABLE_MS = 5 * 60 * 1000;

/** Ab dieser Größe wird das Protokoll eines Bots umgelegt (siehe Bot#rotateLog). */
const LOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Welche Zustände einen Eintrag im Ereignisverlauf wert sind (siehe Bot#logEvent).
 *
 * `starting`, `connecting` und `stopping` fehlen absichtlich: Sie stehen zwischen zwei anderen
 * Einträgen immer nur Sekundenbruchteile und sagen nichts, was `online`/`disconnected` nicht
 * ohnehin sagt. Mit ihnen bestünde der Verlauf zur Hälfte aus Rauschen.
 */
const TIMELINE_STATES = new Set(['online', 'reconnecting', 'disconnected', 'error', 'auth', 'offline']);

/** So lange bleibt ein Eintrag im Ereignisverlauf stehen, bevor ihn das Aufräumen holt. */
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Wie lang eine Zeile ohne Zeilenumbruch werden darf, bevor der Puffer vorn beschnitten wird.
 *
 * Großzügig gewählt: Eine Bildzeile der Live-Ansicht sind 160 Zellen zu je gut dreißig Zeichen
 * Steuersequenz, also einige Kilobyte. Alles jenseits davon ist keine Zeile mehr, sondern ein
 * Client, der schreibt und nie umbricht – und dessen Puffer sonst den Speicher auffrisst.
 */
const MAX_LINE_BYTES = 256 * 1024;

function classify(line) {
  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(line);
    if (match) return { kind: pattern.kind, match };
  }
  return null;
}

/**
 * Die Trennmeldung eines Servers als Satz.
 *
 * Minecraft schickt sie als Chat-Komponente: `{"text":"…"}`, oft mit `extra` und Farben darin.
 * Roh im Panel sähe das aus wie ein Fehler im Panel – dabei ist es die Antwort des Servers und
 * meist die ganze Erklärung ("Du bist gebannt", "falsche Version", "Server voll").
 */
const DISCONNECT_MESSAGES = {
  'multiplayer.requiredTexturePrompt.disconnect':
    'Der Server verlangt ein Resource-Pack. Der Client hat das verpflichtende Pack nicht bestätigt.',
};

function disconnectText(raw) {
  // `@event` muss einzeilig sein. Der Client ersetzt deshalb Steuerzeichen durch Leerzeichen;
  // von einer ANSI-Farbe blieb auf diesem Weg bisher beispielsweise `[0m` stehen. Das ist weder
  // Teil der Servermeldung noch für einen Menschen hilfreich. Echte Escape-Sequenzen und solche
  // verwaisten Enden werden hier gleichermaßen entfernt.
  const text = stripAnsi(String(raw || ''))
    .replace(/\[[0-9;?]*m/g, '')
    .trim();
  if (!text) return '';
  if (!text.startsWith('{') && !text.startsWith('[')) {
    return (DISCONNECT_MESSAGES[text] || text).slice(0, 300);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return text.slice(0, 300);
  }
  // Die Tiefe ist begrenzt, und zwar aus demselben Grund wie in mcping.js: Diese Zeile kommt von
  // einem fremden Minecraft-Server, den der Kunde selbst aussucht. Eine tausendfach geschachtelte
  // Abschiedsmeldung wäre für eine Funktion, die sich selbst aufruft, das Ende des Stapels – und
  // dieser Aufruf hängt in der Verarbeitung der Client-Ausgabe, ohne Netz darunter. Der Prozess
  // hält jeden laufenden Bot; er darf an einer Textumwandlung nicht sterben.
  const walk = (node, depth = 0) => {
    if (node === null || node === undefined || depth > 32) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map((entry) => walk(entry, depth + 1)).join('');
    if (typeof node !== 'object') return String(node);
    return [
      node.text ?? '',
      ...(Array.isArray(node.extra) ? node.extra.map((entry) => walk(entry, depth + 1)) : []),
    ].join('');
  };
  const rendered = walk(data).replace(/\s+/g, ' ').trim();
  return (DISCONNECT_MESSAGES[rendered] || rendered).slice(0, 300);
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
  /**
   * Die Antwort auf `:home` oder `:route` – **ohne sie zu deuten**.
   *
   * Der Client schreibt dort eine kleine Übersicht als Text: die gemerkte Heimatposition, die
   * Wegpunkte, ob eine Aufzeichnung läuft. Sie zu zerlegen hieße, Meldungstexte festzunageln, und
   * genau das tut dieses Panel sonst nirgends (siehe `@event` in docs/aufbau.md). Hier ist es auch
   * nicht nötig: Die Zeilen sind für Menschen geschrieben und werden von Menschen gelesen.
   *
   * Der Gewinn liegt woanders: Bisher fielen diese Zeilen als Statusmeldungen in den Chatverlauf,
   * also in einen anderen Reiter. Wer im Bewegungs-Reiter auf "Zeigen" drückte, bekam dort
   * scheinbar keine Antwort.
   */
  if (kind === 'movement') {
    return rows.length ? { empty: false, lines: rows, at: Date.now() } : { empty: true, lines: [] };
  }
  if (kind === 'board') {
    // Beide Sprachen: welche der Client spricht, hängt an seiner Umgebung, und eine Tafel, die als
    // "no sidebar" gemeldet wurde, stand vorher als eine Zeile Fließtext in der Anzeige.
    if (!rows.length || rows.some((line) => /keine Seitenleiste|no sidebar/i.test(line))) {
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
  if (!rows.length || /kein Men(ü|ue) offen|no menu open/i.test(text)) {
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
    /** Neuverbindungen seit dem letzten menschlichen Start/Stopp (siehe `planRestart`). */
    this.reconnectCount = 0;
    this.lastError = null;
    /** Warum der Server zuletzt getrennt hat – der Grund überlebt das Ende des Prozesses. */
    this.lastReason = null;
    this.chat = [];
    this.proc = null;
    this.build = null;
    /**
     * Welche Client-Datei dieser Lauf benutzt – die Fassung und der Abdruck vom Startzeitpunkt.
     *
     * Beides wird **einmal beim Start** festgehalten und danach nie mehr angefasst. Genau darin
     * liegt der Sinn: Der Stundentakt tauscht die Datei auf der Platte aus, dieser Prozess läuft
     * mit der alten weiter, und nur der Vergleich der beiden Abdrücke sagt, dass das so ist.
     */
    this.clientVersion = null;
    this.clientStamp = null;
    this.menu = null;
    // Anzeigetafel und Menü als Daten. Sie kommen als gewöhnliche Textzeilen aus
    // dem Client; gesammelt werden sie nur, wenn das Panel gerade danach gefragt hat (siehe
    // `capture`). Ohne das stünden dreizehn Zeilen Seitenleiste zwischen den Chatnachrichten.
    this.views = { board: null, menu: null, inv: null, position: null, movement: null, pov: null };
    this.capture = null;
    // Live-Ansicht: `povWanted` ist der Schalter (`:pov live`), `povRows` das Bild, das gerade
    // Zeile für Zeile hereinkommt. Solange niemand die Ansicht angefordert hat, kostet die
    // Erkennung genau eine Abfrage je Zeile.
    this.povWanted = false;
    this.povRows = null;
    // Ein Bild, das wegen der Bremse ohnehin niemand bekommt, wird nicht zerlegt, sondern nur
    // überlesen – `povSkip` sagt, dass gerade eines vorbeizieht.
    this.povSkip = false;
    this.povStatus = '';
    this.povSentAt = 0;
    // Der texturierte Viewer des Clients: `webPort` ist die Nummer, die wir vergeben haben,
    // `web` steht erst, wenn der Client seine Adresse samt Token gemeldet hat. `webNote` ist der
    // Satz, mit dem er erklärt, warum es keine Texturen gibt – der gehört dem Kunden.
    this.webPort = null;
    this.web = null;
    this.webNote = '';
    this.stopping = false;
    // Seit wann dieser Lauf im Spiel steht – die eine Auskunft, an der der Wiederanlauf hängt.
    // `null` heißt "noch nie", und das ist etwas anderes als "gerade nicht": Wer nie drin war,
    // wird nicht neu gestartet (siehe die Erklärung bei RESTART_MAX_TRIES).
    this.onlineSince = null;
    this.stableTimer = null;
    /**
     * Der wartende Wiederanlauf, so wie das Panel ihn anzeigt: `{ tries, max, at }` oder `null`.
     *
     * Die Buchführung dazu führt der Supervisor (`Supervisor#retry`) – er kennt den Zeitgeber und
     * überlebt den Bot. Was hier steht, ist nur die Auskunft **dieses** Bots über sich selbst, und
     * die gehört in seinen `snapshot()`, ohne dass der dafür zurück in den Supervisor greifen muss.
     */
    this.retry = null;
    this.timers = new Set();
    this.buffers = { out: '', err: '' };
    /**
     * Je Kanal ein Decoder, kein `chunk.toString('utf8')`.
     *
     * Ein Datenstück endet dort, wo das Betriebssystem es abschneidet, und das ist mitten in einem
     * Zeichen genauso wahrscheinlich wie anderswo. `toString` macht aus so einem angefangenen
     * Zeichen ein Fragezeichen; der Decoder hält es zurück, bis der Rest kommt. Bei Chatzeilen fiel
     * das kaum auf – ein zerbrochenes „ä“ alle paar tausend Zeilen. Bei der Live-Ansicht fällt es
     * sofort auf: Ein Bild sind 240 Kilobyte aus Halbblöcken zu je drei Byte, also alle 64 Kilobyte
     * ein zerbrochenes Zeichen – und die Zeile, in der es steckt, ist damit keine Bildzeile mehr.
     * Das Bild brach mittendrin ab, und der Rest stand als Zeichensalat im Chatverlauf.
     */
    this.decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') };
    this.usesEvents = false;
    this.logFile = path.join(paths.logs, `bot-${profile.id}-${account.id}.log`);
  }

  get online() {
    return this.state === 'online';
  }

  /**
   * Läuft dieser Bot mit einer Client-Datei, die es so nicht mehr gibt?
   *
   * Nur für **laufende** Bots eine sinnvolle Frage: Ein ausgeschalteter startet ohnehin mit dem,
   * was gerade da liegt. Und nur, wenn beide Abdrücke bekannt sind – fehlt einer (die Bauform ist
   * verschwunden, der Bot kommt aus einem Lauf vor dieser Änderung), ist die ehrliche Antwort
   * „weiß ich nicht“, und die heißt hier „nein“: Ein Neustart, der aus einer Unsicherheit folgt,
   * wirft einen Bot aus dem Spiel, ohne dass jemand etwas davon hat.
   */
  get outdated() {
    if (!this.running || !this.clientStamp) return false;
    const now = binaries.stampFor(this.build);
    return Boolean(now) && now !== this.clientStamp;
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

  /**
   * Soll dieser Bot den texturierten Viewer mitbringen?
   *
   * Drei Bedingungen, und jede einzelne ist ein Nein: Die Live-Ansicht muss gebucht sein (`pov`
   * kommt schon durch `gateCaps` gefiltert), und die Bauform muss `--pov-web` samt
   * `--pov-resources` kennen – also mindestens Client 2.5.0.
   *
   * **Die vierte Bedingung ist mit 2.6.0 weggefallen.** Bis dahin musste für die Protokollversion
   * dieses Serverplatzes eine Original-JAR von Minecraft bereitliegen, sonst gab es keine
   * Texturen; ab 2.6.0 sucht der Client sie selbst (eigene Ablage, vorhandene
   * Minecraft-Installation, zuletzt Mojang). Eine hinterlegte Datei bleibt trotzdem der bessere
   * Weg – siehe `args()` –, sie ist nur keine Voraussetzung mehr.
   */
  wantsWebView(caps) {
    if (!caps.pov || !caps.povweb || !caps.povresources) return false;
    return resources.has(this.profile.mc_version) || Boolean(caps.povresourcesauto);
  }

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

    // ---- Der Wiederanlauf gehört dem Panel ------------------------------------------------
    //
    // **Ab Client 2.6.0 verbindet sich der Client nach einem Kick von selbst neu.** Ohne diese
    // Zeile gäbe es damit zwei Antworten auf dieselbe Frage – und die des Clients wäre die
    // falsche, aus drei Gründen, von denen jeder für sich reicht:
    //
    //   1. **Der Kunde hat das Sagen.** Wer `auto_reconnect` abschaltet, will einen Bot, der aus
    //      bleibt. Ein Client, der trotzdem weiter anklopft, macht aus dieser Einstellung eine
    //      Anzeige ohne Wirkung.
    //   2. **Zwischen zwei Versuchen wird gerechnet.** `Supervisor#start` prüft bei jedem Start
    //      Laufzeit, Guthaben, Sperren, Kontogrenzen und die Discord-Mitgliedschaft des
    //      Gratis-Tarifs. Ein Serverplatz, dessen Laufzeit mitten in der Nacht endet, würde vom
    //      Client bis zum Morgen weiter verbunden – bezahlt hat ihn niemand mehr.
    //   3. **Aufgeben muss sichtbar sein.** Nach acht erfolglosen Versuchen bekommt der Kunde eine
    //      Nachricht (siehe `RESTART_MAX_TRIES`). Ein Client, der still weiterprobiert, hat
    //      niemanden, der das meldet – und ein Bot, der seit zwei Tagen jede Minute abgewiesen
    //      wird, ist für den Minecraft-Server nicht von einem Angriff zu unterscheiden.
    //
    // Deshalb: Der Prozess endet nach einem Abbruch, wie er es immer getan hat, und was danach
    // passiert, entscheidet der Supervisor. Genau das empfehlen auch die Release-Notes zu 2.6.0
    // jedem, der eine Aufsicht davor gesetzt hat.
    //
    // Kennt die Bauform die Option nicht (2.5.0 und älter), ist ohnehin alles wie bisher – und
    // mitschicken dürfte man sie dann nicht: Eine unbekannte Option bricht den Start ab.
    if (caps.noreconnect) args.push('--no-reconnect');

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

    // **Sichtweite.** Sie sagt dem Server, wie viele Chunks er schicken soll. Ein AFK-Bot braucht
    // davon nichts – deshalb steht der Client auf 2, und deshalb ist das hier auch die Vorgabe.
    // Für die Live-Ansicht ist sie dagegen die eine Zahl, die zählt: Was nicht geladen ist, kann
    // der Client nicht zeichnen, und in 2 Chunks endet die Welt drei Schritte vor dem Bot. Sie
    // kostet Arbeitsspeicher auf der Maschine und Datenverkehr vom Minecraft-Server, also gibt es
    // sie ab einem bezahlten Platz und nur, wenn jemand sie ausdrücklich hochstellt.
    if (caps.viewdistance && this.plan.premium && profile.view_distance > 0) {
      args.push('--view-distance', String(Math.min(32, Math.max(2, profile.view_distance))));
    }

    // ---- Live-Ansicht ---------------------------------------------------------------------
    //
    // Die Einstellungen der Ansicht gehören auf die Kommandozeile und nicht in einen Befehl
    // hinterher. Vorher schickte das Panel `:pov size 160 80` erst, wenn der Bot im Spiel war –
    // die Bauform `pov-afk-linux` hatte da längst zu zeichnen begonnen, und die ersten Bilder
    // kamen in 64×32 an. Ein Kunde, der die Live-Ansicht bezahlt, soll sie nicht erst ab dem
    // dritten Bild in voller Auflösung bekommen.
    //
    // Geschickt wird nur, was die Bauform laut ihrer eigenen Hilfe versteht: Eine ältere Datei
    // bricht bei einer unbekannten Option beim Start ab, und dann läuft gar kein Bot mehr.
    if (caps.pov) {
      // `aus` heißt nicht "abgeschaltet", sondern "wartet". Gezeichnet wird erst, wenn wirklich
      // jemand zusieht – ein Bild aus geladenen Chunks zu rechnen ist das Teuerste, was dieses
      // Panel anstoßen kann, und für einen leeren Browser lohnt es sich nie.
      if (caps.povstart) args.push('--pov', 'aus');
      if (caps.povsize) args.push('--pov-size', `${POV_SIZE.width}x${POV_SIZE.height}`);
      if (caps.povfps) args.push('--pov-fps', String(POV_FPS));

      // Der texturierte Viewer. Er kommt **zusätzlich** zu den Zeilen oben, nicht statt ihrer:
      // Kommt keine Textur zustande, bleibt die Voxelansicht, und dafür müssen die Einstellungen
      // dieser Ansicht schon in der Befehlszeile stehen.
      //
      // Auf einem Standort hängt die Datei nicht hier, sondern dort – deshalb setzt sie dort auch
      // der Standort selbst ein (siehe agent/index.js). Das Panel schickt nur die Nummer und die
      // Version; welchen Pfad seine JAR hat, weiß nur die andere Maschine.
      if (this.webPort && !this.remote) {
        // Wer das ausdrücklich abgeschaltet hat, bekommt weder die hinterlegte Datei noch die
        // Selbsthilfe des Clients: Der Viewer läuft trotzdem, nur ohne Texturen – siehe
        // docs/live-ansicht.md. Das geht nur mit einer Bauform, die `aus` auch versteht (2.6.0+);
        // eine ältere kennt nur den zwingenden Dateipfad und bräche an einer unbekannten Option ab.
        if (profile.pov_skip_resources && caps.povresourcesauto) {
          args.push('--pov-web', `127.0.0.1:${this.webPort}`, '--pov-resources', 'aus');
        } else {
          const jar = resources.pathFor(profile.mc_version);
          // **Die hinterlegte Datei geht vor, auch wenn der Client sich selbst helfen könnte.**
          // Sie liegt einmal auf dieser Maschine und gilt für alle. Die Selbsthilfe des Clients
          // legt sie dagegen unter `XDG_CONFIG_HOME` ab, und das ist hier das Verzeichnis **eines
          // Kunden** (siehe `userDir`): Bei dreißig Kunden mit Live-Ansicht wären das dreißigmal
          // dieselben dreißig Megabyte und dreißig Downloads bei Mojang.
          if (jar) args.push('--pov-web', `127.0.0.1:${this.webPort}`, '--pov-resources', jar);
          // Ohne hinterlegte Datei: Ab 2.6.0 findet der Client selbst eine, also bekommt der Kunde
          // seine Texturen trotzdem. Ohne `--pov-resources` gilt dort die Vorgabe `auto`.
          else if (caps.povresourcesauto) args.push('--pov-web', `127.0.0.1:${this.webPort}`);
        }
      }
    }

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
    // Roh, nicht URL-kodiert: `Proxy::parse` im Client zerlegt von Hand (letztes '@' trennt die
    // Adresse, erster ':' trennt Nutzer und Passwort) und dekodiert dabei nichts. Ein `%2F` käme
    // als literales `%2F` beim Proxy an, nicht als '/' – ein Passwort mit Schrägstrich würde die
    // Anmeldung dann abgelehnt bekommen, obwohl es stimmt.
    const auth = row.username ? `${row.username}:${row.password || ''}@` : '';
    return `${row.kind === 'http' ? 'http' : 'socks5'}://${auth}${row.host}:${row.port}`;
  }

  /** Der Standort, auf dem dieser Bot laufen soll. Ohne Eintrag: diese Maschine. */
  node() {
    if (!this.profile.node_id) return null;
    return db.prepare('SELECT * FROM nodes WHERE id = ?').get(this.profile.node_id) || null;
  }

  start({ excludeNodeIds = [] } = {}) {
    if (this.proc) return this;
    const { command, file, build } = binaries.command(this.profile, this.plan);
    this.build = build;
    this.clientVersion = binaries.versionOf(build);
    this.clientStamp = binaries.stampFor(build);
    // `this.caps` erst nach `this.build` lesen – es hängt an der Bauform, die gerade gewählt wurde.
    const caps = this.caps;

    // **Wohin, bevor womit.** Der Standort steht schon vor den Argumenten fest, denn er entscheidet
    // mit: Der Pfad zur Minecraft-JAR gilt nur auf der Maschine, auf der der Bot wirklich läuft.
    const assignedNode = this.node();
    const node = this.supervisor.runtimeNode(this.profile, this.userId, {
      file,
      excludeNodeIds,
    });
    if (!node) {
      const message = assignedNode
        ? `Der Standort "${assignedNode.name}" ist nicht verfügbar und es gibt gerade keinen erreichbaren Ersatzstandort.`
        : 'Es gibt gerade keinen erreichbaren Standort.';
      this.setState('error', message);
      this.lastError = message;
      throw new HttpError(503, message, {
        en: assignedNode
          ? `Location "${assignedNode.name}" is unavailable and no replacement location is reachable right now.`
          : 'No location is reachable right now.',
      });
    }
    this.nodeId = node?.id || null;
    this.remote = node?.kind === 'agent';
    this.webPort = this.wantsWebView(caps) ? takeWebPort() : null;

    const args = this.args(caps);
    this.usesEvents = Boolean(caps.events);
    const home = userDir(this.userId);

    this.stopping = false;
    this.lastReason = null;
    this.onlineSince = null;
    // Das Warten ist vorbei – dieser Start **ist** der Versuch, auf den gewartet wurde. Die
    // Versuchskette selbst läuft im Supervisor weiter, bis der Bot lange genug gestanden hat.
    this.retry = null;
    // Gezeichnet wird erst auf Anforderung – auch bei `pov-afk-linux`, das von Haus aus sofort
    // loslegt: Dafür steht `--pov aus` in den Argumenten. Kann die Bauform diese Option nicht
    // (Client älter als 2.1.0), fängt sie trotzdem an, und dann muss das Panel ab der ersten
    // Zeile mitlesen – sonst stünden Hunderte Bildzeilen je Sekunde im Chatverlauf.
    this.povWanted = build === 'pov' && Boolean(caps.pov) && !caps.povstart;
    this.povSkip = false;
    this.povRows = null;
    this.setState('starting', `${this.profile.host} · MC ${this.profile.mc_version}`);

    // Örtlich oder auf einem Standort? Beides sieht von hier aus gleich aus: `agents.spawn`
    // liefert ein Objekt mit stdout/stderr/stdin/kill, genau wie `child_process.spawn`. Nur so
    // bleibt der ganze Rest dieser Klasse frei von der Frage, wo der Prozess wirklich liegt.
    if (this.remote) {
      try {
        this.proc = agents.spawn(node.id, {
          file,
          args,
          userId: this.userId,
          // Die zwei Argumente für den texturierten Viewer setzt der Standort selbst ein – er
          // allein weiß, ob und wo seine Kopie der Minecraft-JAR liegt.
          //
          // `auto` ist die eine Auskunft, die er **nicht** selbst hat: ob diese Bauform sich ihre
          // JAR notfalls selbst besorgen kann (Client 2.6.0). Der Standort ruft kein `--help` auf,
          // er führt nur aus, was hier steht. Ohne diese Zeile bliebe seine Live-Ansicht ohne
          // hinterlegte Datei bei der Voxelansicht, während sie hier texturiert wäre.
          pov: this.webPort
            ? {
                port: this.webPort,
                mc: this.profile.mc_version,
                auto: Boolean(caps.povresourcesauto),
              }
            : null,
        });
      } catch (error) {
        // Hier endet der Start, bevor es einen Prozess gibt – `cleanup()` läuft also nie, und die
        // Portnummer bliebe für immer vergeben. Ein Standort, der eine Stunde lang nicht erreichbar
        // ist, hätte den ganzen Bereich aufgebraucht, ohne dass ein einziger Bot lief.
        if (this.webPort) usedWebPorts.delete(this.webPort);
        this.webPort = null;
        const attempted = [...new Set([...excludeNodeIds.map(Number), node.id])];
        const fallback = this.supervisor.runtimeNode(this.profile, this.userId, {
          file,
          excludeNodeIds: attempted,
        });
        this.supervisor.emit('node-start-failed', {
          nodeId: node.id,
          nodeName: node.name,
          error: error.message,
          fallbackName: fallback?.name || null,
        });
        if (fallback) {
          this.push('system', `Standort "${node.name}" ist ausgefallen – Wechsel zu "${fallback.name}".`);
          return this.start({ excludeNodeIds: attempted });
        }
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
      const failedNode = node;
      const attempted = [...new Set([...excludeNodeIds.map(Number), failedNode.id])];
      this.cleanup();
      if (this.remote && this.wanted()) {
        const fallback = this.supervisor.runtimeNode(this.profile, this.userId, {
          file,
          excludeNodeIds: attempted,
        });
        this.supervisor.emit('node-start-failed', {
          nodeId: failedNode.id,
          nodeName: failedNode.name,
          error: error.message,
          fallbackName: fallback?.name || null,
        });
        if (fallback) {
          this.push(
            'system',
            `Start auf "${failedNode.name}" fehlgeschlagen – Wechsel zu "${fallback.name}".`
          );
          try {
            this.start({ excludeNodeIds: attempted });
            return;
          } catch (fallbackError) {
            error = fallbackError;
          }
        }
      }
      this.lastError = error.message;
      this.push('error', `Start fehlgeschlagen: ${error.message}`);
      this.setState('error', error.message);
    });
    this.proc.on('exit', (code, signal) => {
      // Sagt der Server, warum er getrennt hat, dann ist **das** der Grund. Der Rust-Client endet
      // nach jedem Kick mit Fehlerstatus; "Code 1" ist die Folge, nicht die Ursache – und genau
      // das stand vorher im Panel, während die eigentliche Antwort des Servers verlorenging.
      const reason = this.stopping
        ? 'gestoppt'
        : signal === 'LINK'
          ? 'Die Verbindung zum Standort ist abgerissen.'
          : this.lastReason || `Client beendet (${signal || `Code ${code}`})`;
      if (!this.stopping && code !== 0) this.lastError = reason;
      // **Vor dem Aufräumen fragen, ob er im Spiel war.** `cleanup()` löscht die Antwort, und ohne
      // sie ist jeder Ausfall gleich – der gekickte Bot wie der, den der Server nie hereingelassen
      // hat. Genau dieser Unterschied entscheidet über den Wiederanlauf.
      const wasOnline = this.onlineSince ? Date.now() - this.onlineSince : 0;
      this.push('system', reason);
      this.setState(this.stopping ? 'offline' : code === 0 ? 'offline' : 'error', reason);
      this.cleanup();
      // Gestoppt heißt gestoppt. Und `LINK` heißt, dass die Leitung zum Standort abgerissen ist:
      // Das ist keine Entscheidung des Kunden und kein Ende der Sitzung im Spiel – der Wunsch
      // bleibt stehen, und `restoreNode()` fährt den Bot wieder hoch, sobald der Standort zurück
      // ist. Beides ist hier fertig.
      if (this.stopping || signal === 'LINK') return;
      // Der Client beendet sich nach Kick oder Netzabbruch von selbst. War der Bot vorher im
      // Spiel, ist das eine Störung und keine Absage – dann bleibt der Wunsch stehen und der
      // Wiederanlauf holt ihn zurück. Sonst wird der Wunsch gelöscht, so wie bisher.
      if (this.supervisor.planRestart(this, { wasOnline })) return;
      db.prepare(
        'UPDATE profile_accounts SET wanted = 0 WHERE profile_id = ? AND account_id = ?'
      ).run(this.profile.id, this.account.id);
    });

    db.prepare(
      `UPDATE bots SET state = ?, started_at = ?, stopped_at = NULL, last_error = NULL
       WHERE profile_id = ? AND account_id = ?`
    ).run('starting', this.startedAt, this.profile.id, this.account.id);
    return this;
  }

  stop({ intended = true } = {}) {
    this.stopping = intended;
    // Wer stoppt, meint es. Eine noch laufende Versuchskette würde den Bot Sekunden später wieder
    // hochfahren – und der Knopf im Panel sähe aus, als hätte er nicht funktioniert.
    if (intended) this.supervisor.cancelRestart(this.key);
    clearTimeout(this.authTimer);
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    if (!this.proc) {
      this.setState('offline', 'gestoppt');
      return;
    }
    this.setState('stopping', '');
    const proc = this.proc;
    proc.kill('SIGTERM');
    // **Nicht `proc.killed` fragen.** Node setzt das Merkmal, sobald ein Signal *abgeschickt*
    // wurde – nach dem SIGTERM oben ist es also immer `true`, und der Nachschlag darunter kam nie.
    // Ein Client, der auf SIGTERM nicht hört (weil er gerade in einer Schleife hängt), blieb damit
    // für immer stehen und belegte seinen Platz. Ob der Prozess wirklich weg ist, sagt sein
    // Ende: `exitCode`/`signalCode` bei einem Kindprozess, `this.proc` bei einem entfernten.
    setTimeout(() => {
      // Weg ist er, wenn `cleanup()` ihn abgehängt hat – das gilt für einen Kindprozess wie für
      // einen entfernten gleichermaßen, denn beide melden ihr Ende über dasselbe `exit`.
      if (this.proc !== proc) return;
      // Zusätzlich, falls das Ereignis noch unterwegs ist: Bei einem `ChildProcess` steht nach dem
      // Ende eine Zahl bzw. ein Signalname da. Ein `RemoteProcess` kennt beides nicht – dort ist
      // es `undefined`, und `!= null` ist genau der Vergleich, der das mit abdeckt.
      if (proc.exitCode !== undefined && proc.exitCode !== null) return;
      if (proc.signalCode !== undefined && proc.signalCode !== null) return;
      try {
        proc.kill('SIGKILL');
      } catch {
        /* schon weg */
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
    this.onlineSince = null;
    clearTimeout(this.stableTimer);
    this.stableTimer = null;
    this.auth = null;
    this.menu = null;
    this.views = { board: null, menu: null, inv: null, position: null, movement: null, pov: null };
    this.povWanted = false;
    this.povRows = null;
    this.povSkip = false;
    this.povStatus = '';
    // Auch der Zeitstempel: Er beantwortet in `snapshot()` die Frage "ist schon ein Bild
    // angekommen?", und für einen beendeten Prozess lautet die Antwort nein.
    this.povSentAt = 0;
    // Der Viewer ist mit seinem Prozess gegangen. Die Portnummer zurück in den Topf – sonst wäre
    // der Bereich nach ein paar hundert Starts leer, obwohl kein einziger Bot mehr läuft.
    if (this.webPort) usedWebPorts.delete(this.webPort);
    this.webPort = null;
    this.web = null;
    this.webNote = '';
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
    this.buffers[stream] += Buffer.isBuffer(chunk)
      ? this.decoders[stream].write(chunk)
      : String(chunk);
    const lines = this.buffers[stream].split('\n');
    this.buffers[stream] = lines.pop();
    // Ein Rest ohne Zeilenumbruch wächst sonst unbegrenzt weiter. Der Normalfall dafür ist kein
    // Angriff, sondern ein Client, der etwas ohne `\n` schreibt und dann hängt – und ein Puffer,
    // der Megabyte um Megabyte im Arbeitsspeicher liegt, nimmt am Ende den ganzen Dienst mit.
    // Eine Bildzeile der Live-Ansicht ist das Längste, was hier legitim vorkommt.
    if (this.buffers[stream].length > MAX_LINE_BYTES) {
      this.buffers[stream] = this.buffers[stream].slice(-MAX_LINE_BYTES);
    }
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
   * Ein Bild beginnt mit seiner Kopfzeile, danach kommen die Bildzeilen, und mit der ersten
   * Zeile, die keine mehr ist, ist es zu Ende. Solange niemand die Ansicht angefordert hat,
   * kostet die Erkennung genau einen Vergleich je Zeile.
   */
  povFeed(raw) {
    if (!this.povWanted) return false;

    // Die Kopfzeile beginnt ein Bild – und hier, nur hier, entscheidet sich, ob das nächste
    // überhaupt eingesammelt wird. Der Client zeichnet gut fünfzehn Bilder in der Sekunde, an den
    // Browser gehen fünf. Die übrigen gar nicht erst zu zerlegen ist der Unterschied zwischen
    // „kostet etwas“ und „kostet ein Zehntel Kern, sobald jemand zusieht“.
    if (POV_HEAD.test(raw)) {
      this.flushPov();
      this.povStatus = stripAnsi(raw).trim();
      const keep = Date.now() - this.povSentAt >= POV_MIN_GAP_MS;
      this.povRows = keep ? [] : null;
      this.povSkip = !keep;
      return true;
    }

    // Ein Bild, das ohnehin niemand bekommt: nur noch feststellen, wo es zu Ende ist.
    if (this.povSkip) {
      if (raw.startsWith(SGR_FOREGROUND)) return true;
      this.povSkip = false;
      return false;
    }

    if (!this.povRows) return false;
    const row = povRow(raw);
    if (!row) {
      // Keine Bildzeile mehr: Das Bild ist vollständig, und diese Zeile ist eine Meldung.
      this.flushPov();
      return false;
    }
    this.povRows.push(row.top, row.bottom);
    // Bei voller Höhe gleich abschicken statt bis zum nächsten Bild zu warten – das sind zwei
    // Zehntelsekunden weniger Verzug, und mehr Zeilen kann ein Bild nicht haben.
    if (this.povRows.length >= POV_MAX_ROWS) {
      this.flushPov();
      this.povSkip = true;
    }
    return true;
  }

  /** Das gesammelte Bild an den Browser geben. */
  flushPov() {
    const rows = this.povRows;
    this.povRows = null;
    if (!rows || !rows.length) return;
    this.povSentAt = Date.now();
    this.views.pov = {
      empty: false,
      width: rows[0].reduce((sum, run) => sum + run[1], 0),
      height: rows.length,
      rows,
      status: this.povStatus,
      at: this.povSentAt,
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
        const again = this.cameBack();
        const first = this.markOnline(event.name);
        // `pov-afk-linux` beginnt gleich nach dem Beitritt von selbst zu zeichnen – erst jetzt
        // nimmt der Client örtliche Befehle an, und erst jetzt lässt sich die Größe setzen.
        if (this.povWanted) this.applyPovSize();
        if (first) this.supervisor.macros.onJoin(this, { again });
        break;
      }
      case 'world':
        this.logEvent('world', event.grund || event.text || '');
        this.supervisor.macros.onWorldChange(this);
        break;
      case 'death':
        this.logEvent('death');
        // Ohne await: Ein Bild ziehen dauert, und die Zeilenverarbeitung soll darauf nicht warten.
        // `captureSnapshot` fängt seine Fehler selbst ab und wirft nie.
        this.captureSnapshot();
        this.supervisor.macros.onDeath(this);
        break;
      // Der Client meldet das, wenn seine eigene Ausgabe schneller war, als das Panel sie abholen
      // konnte – ohne diesen Zweig fiel die Zeile bisher auf den `default`-Fall und war spurlos
      // weg. Für jemanden, der später fragt "warum fehlt hier ein Stück Chat", ist genau das der
      // Unterschied zwischen "nichts passiert" und "wir haben's, aber verloren".
      case 'output':
        // Nur für die Auswertung festgehalten (siehe server.js, Filter auf 'dropped') – kein
        // Ereignis, das für den Kunden im Chat-Verlauf etwas bedeutet.
        this.logEvent('dropped', event.text || '');
        break;
      case 'disconnect': {
        // Der Grund ist das Wertvollste, was in dieser Sitzung noch passiert – er sagt, warum es
        // nicht ging. `lastReason` überlebt das Prozessende und ersetzt dort das nichtssagende
        // "Client beendet (Code 1)".
        const reason = disconnectText(event.text);
        this.lastReason = reason || null;
        this.lastError = reason || null;
        this.setState('disconnected', reason || '');
        this.captureSnapshot();
        this.supervisor.macros.onDisconnect(this);
        break;
      }
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
        // Ein aufgehendes Fenster ist ein Ereignis, das der Client von sich aus meldet – damit
        // lässt sich ein Menü bedienen, ohne dass jemand davor sitzt. Beim Schließen ist nichts
        // aufgegangen, also gibt es auch nichts auszulösen.
        if (this.menu) this.supervisor.macros.onMenu(this, this.menu.title);
        break;
      }
      // **Wohin ein Feld gehört, entscheidet die laufende Abfrage.** `:menu` und `:inv` schreiben
      // beide `@event slot`-Zeilen, und beide meinen etwas anderes: einmal das offene Fenster des
      // Servers, einmal das eigene Inventar. Ohne diese Unterscheidung landete das Inventar in der
      // Menüansicht und überschrieb sie – ein Menü mit sechsundvierzig Feldern, das es nie gab.
      case 'slot': {
        const slot = /^(\d+)\s+(\d+)\s+([\s\S]*)$/.exec(event.text || '');
        if (!slot) break;
        const kind = this.capture?.kind === 'inv' ? 'inv' : 'menu';
        const index = Number(slot[1]);
        const current = this.views[kind] && !this.views[kind].empty ? this.views[kind] : {};
        const items = { ...(current.items || {}) };
        items[index] = {
          ...(items[index] || {}),
          count: Number(slot[2]) || 1,
          name: slot[3],
          lore: [],
        };
        this.views[kind] =
          kind === 'inv'
            ? { empty: false, items, at: Date.now() }
            : {
                empty: false,
                title: current.title || this.menu?.title || '',
                slots: current.slots || this.menu?.slots || 0,
                items,
                at: Date.now(),
              };
        this.emitView(kind);
        break;
      }
      case 'lore': {
        const lore = /^(\d+)\s+([\s\S]*)$/.exec(event.text || '');
        if (!lore) break;
        const kind = this.capture?.kind === 'inv' ? 'inv' : 'menu';
        if (!this.views[kind] || this.views[kind].empty) break;
        const index = Number(lore[1]);
        const items = { ...(this.views[kind].items || {}) };
        const item = items[index];
        if (!item) break;
        items[index] = { ...item, lore: [...(item.lore || []), lore[2]] };
        this.views[kind] = { ...this.views[kind], items, at: Date.now() };
        this.emitView(kind);
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
    // **Vor allem anderen: die Adresse des texturierten Viewers.**
    //
    // Sie steht genau einmal da, gleich beim Start, und enthält den Zugriffstoken dieses Laufs.
    // Danach ist sie unwiederbringlich – der Client würfelt ihn beim nächsten Start neu. Sie steht
    // deshalb vor der Abfrage-Sammlung: Käme sie zufällig in ein `:board`, verschwände sie darin.
    if (this.webPort) {
      const ready = WEB_READY.exec(line);
      if (ready) return this.setWeb(ready[1]);
      const warned = WEB_WARN.exec(line);
      if (warned) {
        this.webNote = warned[1];
        this.push('status', line);
        return;
      }
    }

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
        const again = this.cameBack();
        if (this.markOnline(hit.match[1])) this.supervisor.macros.onJoin(this, { again });
        break;
      }
      case 'disconnected': {
        const reason = disconnectText(hit.match[1]);
        this.lastReason = reason || null;
        this.lastError = reason || null;
        this.setState('disconnected', reason || '');
        this.captureSnapshot();
        this.supervisor.macros.onDisconnect(this);
        break;
      }
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
    // Dasselbe fürs Inventar: Was der Bot weggelegt hat, ist weg, und ein Feld, über das nichts
    // mehr gemeldet wird, ist leer – nicht "so wie beim letzten Mal".
    if (kind === 'inv') this.views.inv = { empty: false, items: {}, at: Date.now() };
    this.capture = { kind, lines: [], until: Date.now() + 2000, timer: null };
    this.capture.timer = setTimeout(() => this.finishCapture(), 2000);
    this.capture.timer.unref?.();
  }

  finishCapture() {
    const capture = this.capture;
    if (!capture) return;
    clearTimeout(capture.timer);
    this.capture = null;
    // Das Inventar steht schon vollständig da: Es kam als `@event slot`, also mit Farbcodes und
    // ohne Umweg über den Fließtext. Die Textzeilen daneben sind dieselbe Auskunft für ein
    // Terminal – sie noch einmal zu zerlegen brächte nichts als eine zweite Fehlerquelle.
    if (capture.kind === 'inv') {
      if (!this.views.inv || !Object.keys(this.views.inv.items || {}).length) {
        this.views.inv = { empty: true, items: {}, at: Date.now() };
      }
      this.emitView('inv');
      return;
    }
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

  /**
   * Der Bot steht im Spiel – die Buchführung dazu.
   *
   * Sie stand zweimal da, einmal für `@event join` und einmal für die Textzeile älterer Bauformen,
   * und die zweite Fassung hätte jede Ergänzung hier stillschweigend verpasst.
   *
   * `stableTimer` ist der Teil, der über den Wiederanlauf entscheidet: Steht der Bot lange genug,
   * gilt die Versuchskette als überstanden und wird gelöscht. Das ist dieselbe Aussage wie "es
   * läuft wieder" – nur eine, die ohne Zutun eines Menschen zustande kommt.
   */
  /**
   * Ist das eine Wiederkehr und kein erster Beitritt?
   *
   * Die Antwort steht in der Datenbank und nicht im Speicher: Ein Bot, der nach einem Kick vom
   * Wiederanlauf zurückgeholt wird, ist ein **neuer Prozess** mit einem neuen `Bot`-Objekt, und
   * jede Zählung im Speicher fienge dort wieder bei null an. `bots.connections` zählt dagegen über
   * alle Läufe hinweg – wer schon einmal drin war, kommt zurück und tritt nicht erstmals bei.
   *
   * **Vor `markOnline()` zu fragen** ist Absicht: Die Zeile darin zählt gerade diesen Beitritt mit.
   */
  cameBack() {
    const row = db
      .prepare('SELECT connections FROM bots WHERE profile_id = ? AND account_id = ?')
      .get(this.profile.id, this.account.id);
    return (row?.connections || 0) > 0;
  }

  markOnline(name) {
    const first = this.state !== 'online';
    this.setState('online', name || this.account.name);
    if (!this.onlineSince) this.onlineSince = Date.now();
    clearTimeout(this.stableTimer);
    this.stableTimer = setTimeout(() => this.supervisor.cancelRestart(this.key), RESTART_STABLE_MS);
    this.stableTimer.unref?.();
    this.connections += 1;
    db.prepare(
      'UPDATE bots SET connections = connections + 1, state = ? WHERE profile_id = ? AND account_id = ?'
    ).run('online', this.profile.id, this.account.id);
    db.prepare('UPDATE mc_accounts SET connections = connections + 1 WHERE id = ?').run(this.account.id);
    return first;
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
    if (TIMELINE_STATES.has(state)) this.logEvent(state, detail);
    this.supervisor.emit('bot-state', { userId: this.userId, key: this.key, state: this.snapshot() });
  }

  /**
   * Einen Eintrag im dauerhaften Ereignisverlauf dieses Bots ablegen.
   *
   * Anders als `state`/`detail` auf `bots` (die jeder Übergang überschreibt) bleibt hier jeder
   * Übergang für sich stehen – die einzige Stelle, an der sich im Nachhinein nachvollziehen lässt,
   * *wie oft* und *warum* ein Bot in der letzten Stunde die Verbindung verloren hat, statt nur, wo
   * er gerade steht.
   */
  logEvent(type, detail = '') {
    db.prepare(
      'INSERT INTO bot_events (user_id, profile_id, account_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(this.userId, this.profile.id, this.account.id, type, detail || null, Date.now());
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
    if (verb === 'board' || verb === 'menu' || verb === 'inv') this.beginCapture(verb);
    if (verb === 'pos' || verb === 'position') this.beginCapture('position');
    // `:home` und `:route` ohne Argument sind Abfragen und keine Befehle – ihre Antwort gehört in
    // den Reiter, in dem gefragt wurde, und nicht zwischen die Chatnachrichten.
    if ((verb === 'home' || verb === 'route') && !arg) this.beginCapture('movement');
    if (verb === 'pov') {
      // Erst die Größe, dann der Befehl: `:pov live` zeichnet sonst in der Größe, die der Client
      // gerade für richtig hält – bei `pov-afk-linux` sind das 64×32.
      if (arg === 'live' || arg === 'frame') this.applyPovSize();
      this.setPov(arg);
    }
    return this.send(`:${verb}${arg ? ` ${arg}` : ''}`, { local: true });
  }

  /**
   * Was `:pov …` im Panel bedeutet.
   *
   * Der Client zeichnet, sobald er soll; das Panel muss nur wissen, ob es die Bildzeilen ab jetzt
   * als Bild lesen soll oder als gewöhnliche Ausgabe. Ohne diesen Schalter würde jede Zeile jedes
   * Bots gegen die Bilderkennung laufen, auch wenn niemand die Ansicht offen hat.
   */
  /**
   * Die Live-Ansicht schalten. `mode` ist `live`, `frame`, `info` oder `stop`.
   *
   * Eine Bildgröße nimmt diese Stelle bewusst nicht entgegen: Sie steht fest auf dem Größten,
   * was der Client kann (POV_SIZE), und wird davor gesetzt – siehe `applyPovSize`.
   */
  setPov(mode) {
    if (mode === 'stop') {
      this.povWanted = false;
      this.povRows = null;
      this.povSkip = false;
      this.povSentAt = 0;
      this.views.pov = { empty: true };
      this.emitView('pov');
      return;
    }
    // live, frame und info liefern alle Bildzeilen – ab jetzt zuhören.
    if (this.povWanted) return;
    this.povWanted = true;
    // Der Browser soll sofort erfahren, dass die Ansicht bestellt ist: Zwischen dem Befehl und
    // dem ersten Bild vergeht knapp eine Sekunde, und in dieser Zeit ist "wird gestartet" die
    // richtige Auskunft – nicht "warte auf das erste Bild", was auch dastand, wenn nie jemand
    // etwas bestellt hatte.
    this.supervisor.emit('bot-state', { userId: this.userId, key: this.key, state: this.snapshot() });
  }

  /**
   * Dem Client die volle Bildgröße sagen – **nur, wenn er sie nicht schon von der Kommandozeile hat.**
   *
   * Seit Client 2.1.0 steht `--pov-size 160x80` in den Startargumenten (siehe `args`), und damit
   * stimmt die Größe schon beim allerersten Bild. Diese Zeile bleibt für ältere Bauformen: Dort
   * gibt es die Option nicht, und ohne sie käme das Bild in der Vorgabe des Clients (64×32) –
   * dieselbe Rechenzeit für ein Viertel der Fläche.
   */
  applyPovSize() {
    if (binaries.caps(this.build || 'slim').povsize) return;
    try {
      this.send(`:pov size ${POV_SIZE.width} ${POV_SIZE.height}`, { local: true });
    } catch {
      // Der Bot ist schon wieder weg – dann gibt es auch nichts zu zeichnen.
    }
  }

  /**
   * Eine laufende Ansicht abschalten, ohne dass jemand einen Befehl geschickt hat.
   *
   * Der Fall dafür ist der zugeschlagene Laptop: Der Browser kommt nicht mehr dazu, „Stopp“ zu
   * sagen, und der Client raycastet weiter für niemanden. Wer zusieht, weiß das Panel an den
   * offenen WebSocket-Verbindungen des Kontos (siehe index.js).
   */
  stopPovIfRunning() {
    if (!this.povWanted || !this.running) return false;
    try {
      this.send(':pov stop', { local: true });
    } catch {
      // Läuft nicht mehr – dann zeichnet auch nichts mehr.
    }
    this.setPov('stop');
    return true;
  }

  // ------------------------------------------------------------ Der Viewer des Clients

  /**
   * Die Adresse des Viewers merken – und den Token dabei **nicht** weitererzählen.
   *
   * Der Client schreibt die vollständige Adresse auf die Fehlerausgabe, damit ein Mensch am
   * Terminal sie anklicken kann. Hier sitzt kein Mensch am Terminal: Die Zeile ginge über die
   * Live-Leitung in jeden offenen Browser dieses Kontos und stünde im Protokoll. Der Token gehört
   * aber allein dem Panel – er ist der Schlüssel zu einem Dienst, der die Weltdaten eines fremden
   * Minecraft-Servers ausliefert und Klicks im Spiel annimmt. Was der Kunde stattdessen sieht, ist
   * der Satz darunter: dass die Ansicht mit Texturen bereitsteht.
   */
  setWeb(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return;
    }
    const token = url.searchParams.get('token');
    if (!token) return;
    this.web = {
      port: Number(url.port) || this.webPort,
      token,
      since: Date.now(),
    };
    this.push('status', 'Live-Ansicht mit Texturen bereit.');
    this.supervisor.emit('bot-state', { userId: this.userId, key: this.key, state: this.snapshot() });
  }

  /**
   * Eine Anfrage an den Viewer dieses Bots stellen.
   *
   * Örtlich ist das ein gewöhnliches `fetch` auf 127.0.0.1; auf einem Standort geht dieselbe
   * Anfrage über die bestehende Leitung dorthin (siehe agents.js). Beide Wege geben dasselbe
   * zurück – Status, Inhaltstyp und Bytes –, damit der Endpunkt im Panel nicht wissen muss, auf
   * welcher Maschine das Bild gerechnet wurde.
   */
  async webFetch(target, { method = 'GET' } = {}) {
    if (!this.web) {
      throw new HttpError(409, 'Für diesen Bot läuft keine texturierte Live-Ansicht.', {
        en: 'No textured live view is running for this bot.',
      });
    }
    const route = target.startsWith('/') ? target : `/${target}`;
    const path = `${route}${route.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.web.token)}`;

    if (this.remote) {
      return agents.request(this.nodeId, this.proc?.job, { method, path, timeout: WEB_TIMEOUT_MS });
    }
    const response = await fetch(`http://127.0.0.1:${this.web.port}${path}`, {
      method,
      signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
    });
    return {
      status: response.status,
      type: response.headers.get('content-type') || 'application/octet-stream',
      body: Buffer.from(await response.arrayBuffer()),
    };
  }

  /**
   * Ein Bild ziehen, ohne dass jemand zusieht – für den Augenblick, in dem es niemand mehr könnte.
   *
   * Wer stirbt oder die Verbindung verliert, hat selten jemanden zufällig vor dem Bildschirm
   * sitzen. Ohne das hier wäre die Antwort auf "was ist da eigentlich passiert" immer ein
   * Achselzucken, obwohl der Client die Welt bis zu diesem Moment längst geladen hatte. Läuft
   * gerade kein texturierter Viewer, kostet der Aufruf nichts als eine geprüfte Bedingung.
   */
  async captureSnapshot() {
    if (!this.web) return;
    try {
      const answer = await this.webFetch('/api/frame.png?w=426&h=240');
      if (answer.status !== 200 || !answer.body?.length) return;
      const name = snapshots.save(answer.body);
      this.logEvent('snapshot', name);
    } catch {
      // Kein Bild ist keinen eigenen Fehler wert – das Ereignis, das den Versuch ausgelöst hat
      // (Tod, Trennung), steht ohnehin schon im Verlauf.
    }
  }

  /**
   * Was die Live-Ansicht dieses Bots gerade kann und tut.
   *
   * `on` heißt "das Panel hört zu", `frames` heißt "es ist auch schon etwas angekommen". Die
   * Oberfläche kann damit "noch nicht gestartet" von "gestartet, wartet auf das erste Bild"
   * unterscheiden – vorher stand beides unter demselben Satz, und wer nie auf "Live starten"
   * gedrückt hatte, wartete auf ein Bild, das niemand bestellt hatte.
   *
   * `web` ist die zweite Frage: Läuft für diesen Bot der texturierte Viewer? Nur dann holt der
   * Browser Bilder ab, statt auf Halbblockzeilen zu warten. `pending` heißt: bestellt, aber der
   * Client hat seine Adresse noch nicht gemeldet – das dauert einen Wimpernschlag und ist der
   * Unterschied zwischen "gleich" und "gibt es hier nicht".
   *
   * Steht **an beiden Stellen**, an denen ein Browser einen Bot kennenlernt: im Zustandswechsel
   * über die Live-Leitung und in der Kontenliste eines Serverplatzes. Ohne das Zweite wüsste die
   * Oberfläche nach jedem Neuladen nicht, welcher Weg gilt, bis sich der Zustand zufällig ändert.
   */
  povState() {
    return {
      on: this.povWanted,
      frames: Boolean(this.povSentAt),
      fps: POV_FPS,
      ...POV_SIZE,
      web: Boolean(this.web),
      pending: Boolean(this.webPort && !this.web),
      note: this.webNote,
    };
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
      reconnect_count: this.reconnectCount,
      last_error: this.lastError,
      build: this.build,
      // Mit welcher Client-Fassung dieser Lauf gestartet ist, und ob sie inzwischen abgelöst
      // wurde. Beides gehört in die Ansicht: „läuft“ und „läuft mit dem Client von letzter Woche“
      // sind zwei verschiedene Auskünfte.
      client_version: this.clientVersion,
      outdated: this.outdated,
      menu: this.menu,
      // Ohne das Bild: ein Zustandswechsel wird bei laufender Live-Ansicht sonst zu einem
      // Datenpaket von zig Kilobyte. Bilder gehen ihren eigenen Weg (`bot-view`).
      views: {
        board: this.views.board,
        menu: this.views.menu,
        inv: this.views.inv,
        position: this.views.position,
        movement: this.views.movement,
      },
      pov: this.povState(),
      // Wartet gerade ein Wiederanlauf? Dann gehört das in die Anzeige: „Fehler“ allein sähe aus,
      // als wäre der Bot endgültig aus, während er in Wahrheit gleich wiederkommt.
      retry: this.retry,
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
    /**
     * Wer gerade auf seinen nächsten Versuch wartet: key -> { tries, at, timer }.
     *
     * Absichtlich **nur im Speicher**. Was einen Neustart des Panels überleben muss, ist der
     * Wunsch (`profile_accounts.wanted`), und der steht in der Datenbank; die Wartezeit dagegen
     * gilt für diesen Lauf. Nach einem Neustart des Servers ist die richtige Wartezeit ohnehin
     * keine – da soll alles sofort hochfahren, und genau das tut `restoreAll()`.
     */
    this.retry = new Map();
  }

  // ------------------------------------------------------------ Wiederanlauf
  //
  // Warum es ihn gibt und wo seine Grenzen liegen, steht oben bei `RESTART_MAX_TRIES`.

  /**
   * Ein Bot ist weg, ohne dass jemand ihn gestoppt hat. Kommt er von selbst zurück?
   *
   * Gibt `true` zurück, wenn ein Versuch liegt – dann bleibt der Startwunsch stehen. Bei `false`
   * löscht der Aufrufer ihn, und der Bot bleibt aus, bis ein Mensch etwas tut.
   */
  planRestart(bot, { wasOnline = 0 } = {}) {
    const chain = this.retry.get(bot.key);
    // **Ohne laufende Kette braucht es einen Grund, überhaupt eine anzufangen: Er war im Spiel.**
    // Wer es nie hinein geschafft hat, hat ein Problem, das ein zweiter Versuch nicht löst.
    // Läuft die Kette dagegen schon, zählt sie weiter – dass *dieser* Versuch nicht bis ins Spiel
    // kam, ist genau der Fall, für den es sie gibt.
    if (!chain && !wasOnline) return false;
    // Eine abgelaufene Microsoft-Anmeldung wiederholt sich nicht von selbst. Sie braucht einen
    // Menschen mit einem Browser, und bis dahin wäre jeder Versuch nur ein weiterer Gerätecode.
    if (bot.state === 'auth') return false;

    // Frisch aus der Datenbank und nicht aus `bot.profile`: Wer den Schalter eben erst umgelegt
    // hat, meint diesen Ausfall und nicht den nächsten.
    const profile = db
      .prepare('SELECT auto_reconnect, reconnect_delay, max_backoff FROM profiles WHERE id = ?')
      .get(bot.profile.id);
    if (!profile?.auto_reconnect) return false;

    const tries = (chain?.tries || 0) + 1;
    if (tries > RESTART_MAX_TRIES) {
      this.cancelRestart(bot.key);
      bot.push(
        'error',
        `Nach ${RESTART_MAX_TRIES} Versuchen aufgegeben. Der Bot bleibt aus, bis du ihn wieder startest.`
      );
      notify.botGaveUp(bot.userId, bot.account.name, bot.lastError || '');
      return false;
    }

    // Zählt, auch wenn dieser Versuch am Ende selbst wieder scheitert – "wie oft hat der Bot es
    // versucht" ist die Frage, nicht "wie oft hat es geklappt". Zurückgesetzt wird sie nur, wenn
    // ein Mensch den Bot selbst startet oder stoppt (siehe `resetReconnectCount`).
    bot.reconnectCount = (bot.reconnectCount || 0) + 1;
    db.prepare('UPDATE bots SET reconnect_count = reconnect_count + 1 WHERE profile_id = ? AND account_id = ?').run(
      bot.profile.id,
      bot.account.id
    );

    const base = Math.max(1, profile.reconnect_delay || 5);
    const cap = Math.max(base, profile.max_backoff || 60);
    // Verdoppeln, bis die Obergrenze erreicht ist. `2 ** (tries - 1)` wächst schnell; deshalb
    // steht die Obergrenze davor und nicht dahinter.
    const seconds = Math.min(cap, base * 2 ** (tries - 1));
    const entry = { tries, at: Date.now() + seconds * 1000, timer: null };
    entry.timer = setTimeout(() => this.runRestart(bot.key), seconds * 1000);
    entry.timer.unref?.();
    this.retry.set(bot.key, entry);
    bot.push('system', `Neuer Versuch in ${seconds} s (${tries}/${RESTART_MAX_TRIES}).`);
    // Erst die Auskunft setzen, dann den Zustand: `setState` verschickt den Schnappschuss, und in
    // dem soll schon stehen, der wievielte Versuch da wartet.
    bot.retry = { tries, max: RESTART_MAX_TRIES, at: entry.at };
    bot.setState('reconnecting', `Versuch ${tries}/${RESTART_MAX_TRIES}, in ${seconds} s`);
    return true;
  }

  /** Der Versuch selbst. Klappt er nicht, legt der Ausgang des Prozesses den nächsten. */
  runRestart(key) {
    const entry = this.retry.get(key);
    if (!entry) return;
    entry.timer = null;
    const [profileId, accountId] = key.split(':').map(Number);
    // In der Wartezeit kann alles passiert sein: gestoppt, gelöscht, stillgelegt. Der Wunsch ist
    // die Frage, die das beantwortet – wer ihn gelöscht hat, wollte keinen Bot mehr.
    const wanted = db
      .prepare('SELECT wanted FROM profile_accounts WHERE profile_id = ? AND account_id = ?')
      .get(profileId, accountId);
    if (!wanted?.wanted) return this.cancelRestart(key);
    const context = this.context(profileId, accountId);
    if (!context) return this.cancelRestart(key);
    try {
      this.start(context);
    } catch (error) {
      // Der Start ging gar nicht erst los – es gibt also keinen Prozess, dessen Ende den nächsten
      // Versuch legen könnte. Manche Gründe vergehen von selbst (Standort weg, Anlage ausgelastet),
      // andere nicht (Guthaben alle, Konto stillgelegt). Beide laufen hier in dieselbe Grenze:
      // Es wird weiter versucht, aber nicht endlos.
      const bot = this.get(profileId, accountId);
      if (bot) {
        bot.lastError = error.message;
        bot.push('error', error.message);
      }
      if (entry.tries >= RESTART_MAX_TRIES) {
        this.cancelRestart(key);
        db.prepare(
          'UPDATE profile_accounts SET wanted = 0 WHERE profile_id = ? AND account_id = ?'
        ).run(profileId, accountId);
        notify.botGaveUp(context.user.id, context.account.name, error.message);
        return;
      }
      const seconds = Math.min(
        Math.max(1, context.profile.max_backoff || 60),
        Math.max(1, context.profile.reconnect_delay || 5) * 2 ** entry.tries
      );
      entry.tries += 1;
      entry.at = Date.now() + seconds * 1000;
      entry.timer = setTimeout(() => this.runRestart(key), seconds * 1000);
      entry.timer.unref?.();
    }
  }

  /**
   * Den Neuverbindungs-Zähler auf null – nur, wenn ein Mensch den Bot selbst startet oder stoppt.
   *
   * Nicht Teil von `start()`/`stop()` selbst: Beide laufen auch aus dem Wiederanlauf, einem
   * Zeitplan und der Wiederherstellung beim Hochfahren, und jeder dieser Läufe würde die Zahl
   * sonst genau dann auf null setzen, wenn sie am interessantesten wäre. Die Anrufer in
   * `routes/profiles.js` (`/start`, `/restart`) rufen das deshalb ausdrücklich selbst auf.
   */
  resetReconnectCount(profileId, accountId) {
    db.prepare('UPDATE bots SET reconnect_count = 0 WHERE profile_id = ? AND account_id = ?').run(
      profileId,
      accountId
    );
    const bot = this.get(profileId, accountId);
    if (bot) bot.reconnectCount = 0;
  }

  /** Die Versuchskette dieses Bots beenden – gestoppt, aufgegeben oder lange genug gelaufen. */
  cancelRestart(key) {
    const bot = this.bots.get(key);
    if (bot) bot.retry = null;
    const entry = this.retry.get(key);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.retry.delete(key);
    return true;
  }

  /**
   * Wartet dieser Bot gerade auf seinen nächsten Versuch?
   *
   * Der Takt „Bots wieder hochfahren“ läuft jede Minute und startet alles, was laufen soll und
   * nicht läuft. Ohne diese Frage würde er die Wartezeit überholen – aus fünf Minuten Abstand
   * würden sechzig Sekunden, und die ganze Bremse wäre umsonst.
   */
  waitingForRestart(key) {
    const entry = this.retry.get(key);
    return Boolean(entry?.timer && Date.now() < entry.at);
  }

  get(profileId, accountId) {
    return this.bots.get(`${profileId}:${accountId}`);
  }

  list(userId) {
    return [...this.bots.values()]
      .filter((bot) => bot.userId === userId)
      .map((bot) => bot.snapshot());
  }

  // ------------------------------------------------------------ Neue Client-Fassung ausrollen
  //
  // Der Stundentakt holt jedes neue Release und legt die Datei hin. Damit läuft niemand
  // automatisch mit dem neuen Client: Ein laufender Prozess hält seine Datei, und ein Bot, der seit
  // drei Wochen im Spiel sitzt, sitzt dort mit dem Client von vor drei Wochen. Was hier steht, ist
  // die Antwort darauf – und zwar eine, die jemand auslöst und nicht der Takt.
  //
  // **Warum das nicht von selbst passiert.** Ein Neustart wirft den Bot aus dem Spiel. Auf manchen
  // Servern kostet das den Platz in einer Warteschlange, auf anderen eine Strafe für zu häufiges
  // Beitreten, und wer gerade zusieht, sieht seinen Bot ohne erkennbaren Grund verschwinden.
  // Diese Entscheidung gehört dem, dem der Serverplatz gehört; das Panel sagt ihm nur, dass sie
  // ansteht.

  /**
   * Die laufenden Bots, unter denen die Client-Datei gewechselt hat.
   *
   * `userId` grenzt auf ein Konto ein, `profileId` auf einen Serverplatz. Ohne beides: alle, und
   * das ist die Sicht der Verwaltung.
   */
  outdated({ userId = null, profileId = null } = {}) {
    return [...this.bots.values()].filter(
      (bot) =>
        bot.outdated &&
        (userId === null || bot.userId === userId) &&
        (profileId === null || bot.profile.id === profileId)
    );
  }

  /**
   * Jeden davon neu starten – gestaffelt.
   *
   * **Der Abstand ist kein Schmuck.** Zwanzig Bots gleichzeitig neu zu starten heißt: zwanzig
   * Minecraft-Clients, die im selben Augenblick beim selben Server anklopfen. Das sieht von dort
   * aus wie ein Angriff, und die üblichen Schutzmaßnahmen (Verbindungsgrenze je Adresse,
   * Beitrittssperre) treffen dann genau die Bots, die gerade wiederkommen wollten. Ein paar
   * Sekunden dazwischen kosten nichts und ersparen das.
   *
   * Gibt zurück, wie viele angestoßen wurden. Fertig sind sie später – `reconnect` wartet auf das
   * Ende des alten Prozesses und startet dann.
   */
  rolloutClient({ userId = null, profileId = null, spacingMs = 3000 } = {}) {
    const due = this.outdated({ userId, profileId });
    due.forEach((bot, index) => {
      const run = () => {
        // In der Zwischenzeit kann jemand den Bot von Hand gestoppt oder selbst neu gestartet
        // haben. Dann ist hier nichts mehr zu tun – und ein Start gegen den Wunsch des Kunden
        // wäre das Gegenteil von dem, was dieser Knopf verspricht.
        if (!bot.running || !bot.outdated) return;
        bot.push('system', 'Neue Client-Fassung – der Bot startet neu.');
        this.reconnect(bot.profile.id, bot.account.id);
      };
      if (index === 0) run();
      else setTimeout(run, index * spacingMs).unref?.();
    });
    return due.length;
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

  /**
   * Andere tatsächlich laufende Sitzungen desselben Minecraft-Kontos.
   *
   * Ein Konto darf mehreren Serverplätzen zugeordnet sein – genau dafür gibt es die zentrale
   * Kontenliste. Zwei gleichzeitige Minecraft-Anmeldungen mit derselben Identität sind dagegen
   * keine zweite Nutzung, sondern eine Rennsituation: Der zweite Zielserver wirft meist eine der
   * beiden Sitzungen mit "already logged in" hinaus. Die Antwort muss aus dem Supervisor kommen,
   * nicht nur aus einem einzelnen HTTP-Knopf, weil auch Zeitpläne, Wiederanläufe und
   * Standortwechsel Bots starten können.
   *
   * `running` meint hier einen noch vorhandenen Prozess, also auch `starting` und `auth`.
   * Gerade in diesen Sekunden wäre ein zweiter Start sonst möglich, obwohl die erste Anmeldung
   * bereits unterwegs ist.
   */
  runningElsewhere(profileId, accountId) {
    const matches = [];
    for (const bot of this.bots.values()) {
      if (!bot.running || bot.profile.id === profileId || bot.account.id !== accountId) continue;
      matches.push({
        profile_id: bot.profile.id,
        profile_name: bot.profile.name,
        state: bot.state,
        online: bot.online,
      });
    }
    return matches.sort((a, b) => a.profile_name.localeCompare(b.profile_name) || a.profile_id - b.profile_id);
  }

  /**
   * Alle tatsächlich laufenden Sitzungen, nach Minecraft-Konto gruppiert.
   *
   * Die normale Einzelprüfung oben bleibt für einen Startvorgang ideal: Dort geht es um genau
   * ein Konto und die Antwort muss keinen weiteren Speicher anlegen. Die Profilliste dagegen
   * beschreibt unter Umständen viele Zuordnungen auf einmal. Für jede davon erneut durch alle
   * laufenden Bots zu laufen, wächst mit `Zuordnungen × Bots`. Dieser Index wird nur für solche
   * Sammelansichten gebaut; aus ihm lässt sich die gleiche Antwort wie mit `runningElsewhere`
   * bilden, aber ohne den wiederholten vollständigen Rundgang.
   */
  runningByAccount() {
    const grouped = new Map();
    for (const bot of this.bots.values()) {
      if (!bot.running) continue;
      const accountId = bot.account.id;
      const entries = grouped.get(accountId) || [];
      entries.push({
        profile_id: bot.profile.id,
        profile_name: bot.profile.name,
        state: bot.state,
        online: bot.online,
      });
      grouped.set(accountId, entries);
    }
    for (const entries of grouped.values()) {
      entries.sort((a, b) => a.profile_name.localeCompare(b.profile_name) || a.profile_id - b.profile_id);
    }
    return grouped;
  }

  /** Befehle, die der Client selbst takten soll: Beitrittsbefehle und Dauer-Wiederholungen. */
  joinCommands(profileId, accountId) {
    const out = [];
    for (const macro of this.enabledMacros(profileId, accountId)) {
      if (!clientCanTake(macro)) continue;
      const actions = JSON.parse(macro.actions || '[]');
      const settings = JSON.parse(macro.config || '{}');
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
      if (!clientCanTake(macro)) continue;
      const actions = JSON.parse(macro.actions || '[]');
      const settings = JSON.parse(macro.config || '{}');
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
    const already = this.get(profile.id, account.id);
    // Ein zweiter Klick auf "Start" ist kein neuer Start. Diese Rückgabe steht vor den globalen
    // Kapazitätsprüfungen: Bei voller Auslastung muss ein bereits laufender eigener Bot nicht
    // plötzlich als abgelehnt erscheinen.
    if (already?.running) return already.snapshot();
    const elsewhere = this.runningElsewhere(profile.id, account.id);
    if (elsewhere.length) {
      const names = elsewhere.map((entry) => `"${entry.profile_name}"`).join(', ');
      throw new HttpError(
        409,
        `Konto "${account.name}" läuft bereits auf ${names}. Stoppe es dort, bevor du es hier startest.`,
        {
          en: `Account "${account.name}" is already running on ${names}. Stop it there before starting it here.`,
          code: 'account-running-elsewhere',
        }
      );
    }
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
    // Ein Konto, das zur Löschung angemeldet ist, startet nichts mehr – auch nicht über den
    // Wiederanlauf, einen Zeitplan oder einen Standort, der zurückkommt. Diese Prüfung steht
    // deshalb **hier** und nicht an den vier Stellen, die einen Bot hochfahren: Eine davon wäre
    // sonst irgendwann vergessen, und dann liefe auf einem gekündigten Konto weiter, was jeden
    // Monat Geld kostet. Der Widerruf im Panel hebt sie sofort wieder auf.
    if (user.delete_due_at) {
      throw new HttpError(403, 'Dieses Konto ist zur Löschung angemeldet.', {
        en: 'This account is scheduled for deletion.',
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

  /**
   * Trennen und wiederkommen – derselbe Weg wie der Wiederanlauf, nur bewusst ausgelöst.
   *
   * Gebraucht wird das vom Macro-Schritt „Neu verbinden“: Es gibt Server, auf denen ein Bot nach
   * einigen Stunden zwar noch verbunden ist, aber nichts mehr empfängt, und es gibt Unterserver,
   * die man nur beim Beitritt wählen kann. Ein Client-Neustart ist dafür das einzige Mittel – der
   * Client selbst kennt keinen Reconnect.
   *
   * **Der neue Start wartet auf das Ende des alten.** `Bot#start()` tut nichts, solange noch ein
   * Prozess läuft; ein Start gleich nach dem `kill` wäre deshalb ein „Neu verbinden“, das trennt
   * und nicht wiederkommt.
   */
  reconnect(profileId, accountId) {
    const bot = this.get(profileId, accountId);
    if (!bot?.proc) return false;
    db.prepare('UPDATE profile_accounts SET wanted = 1 WHERE profile_id = ? AND account_id = ?').run(
      profileId,
      accountId
    );
    bot.proc.once('exit', () => {
      // Eine Sekunde Luft: Der Minecraft-Server räumt die alte Sitzung nicht in dem Moment ab, in
      // dem unser Prozess endet, und ein Beitritt in diese Lücke wird als "already logged in"
      // abgewiesen.
      setTimeout(() => {
        const context = this.context(profileId, accountId);
        if (!context) return;
        try {
          this.start(context);
        } catch (error) {
          bot.lastError = error.message;
          bot.push('error', error.message);
        }
      }, 1000).unref?.();
    });
    bot.push('system', 'Neu verbinden ...');
    bot.stop();
    return true;
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

  /**
   * Alle laufenden Live-Ansichten eines Kontos abschalten.
   *
   * Sie kostet auf der Maschine deutlich mehr als ein stiller Bot – der Client raycastet je Bild
   * 12 800 Strahlen. Sobald niemand mehr zusieht, hat sie deshalb aufzuhören, auch wenn der
   * Browser dazu nichts mehr gesagt hat. Aufgerufen aus index.js, wenn die letzte Verbindung
   * dieses Kontos zu ist.
   */
  stopPovForUser(userId) {
    let stopped = 0;
    for (const bot of this.bots.values()) {
      if (bot.userId !== userId) continue;
      if (bot.stopPovIfRunning()) stopped += 1;
    }
    return stopped;
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

  /**
   * Die Maschine für diesen konkreten Lauf.
   *
   * Der Serverplatz bleibt seinem gewünschten Standort zugeordnet; nur der Prozess darf
   * vorübergehend woanders laufen. So springt ein ausgefallener Agent auf einen erreichbaren
   * Ersatz, ohne dass eine Störung die Konfiguration des Kunden dauerhaft umschreibt.
   */
  runtimeNode(profile, userId, { file = '', excludeNodeIds = [] } = {}) {
    const assigned = profile.node_id
      ? db.prepare('SELECT * FROM nodes WHERE id = ?').get(profile.node_id)
      : db.prepare("SELECT * FROM nodes WHERE kind = 'local' ORDER BY id LIMIT 1").get();
    // `egress` und der lokale Standort laufen beide auf dieser Maschine. Nur ein entfernter
    // Agent kann ausfallen und braucht daher eine andere Ausführungsmaschine.
    if (!assigned || assigned.kind !== 'agent') return assigned;

    const excluded = new Set(excludeNodeIds.map(Number));
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    const candidates = [
      assigned,
      ...db
        .prepare(
          `SELECT * FROM nodes
            WHERE active = 1 AND kind IN ('local', 'agent') AND id != ?
            ORDER BY sort, id`
        )
        .all(assigned.id),
    ];

    for (const node of candidates) {
      if (!node.active || excluded.has(node.id)) continue;
      if (
        user?.role !== 'admin' &&
        node.access !== 'all' &&
        !db.prepare('SELECT 1 FROM node_users WHERE node_id = ? AND user_id = ?').get(node.id, userId)
      )
        continue;
      if (node.max_bots > 0 && this.runningOnNode(node.id) >= node.max_bots) continue;

      if (node.kind === 'agent') {
        if (!agents.isOnline(node.id)) continue;
        const info = agents.info(node.id);
        const wantedFile = path.basename(String(file || ''));
        if (wantedFile && info?.binaries?.length && !info.binaries.includes(wantedFile)) continue;
        const stats = agents.stats(node.id);
        if (stats) {
          if (node.max_cpu_percent > 0 && (stats.cpu_percent ?? 0) >= node.max_cpu_percent) continue;
          if (node.max_mem_percent > 0 && (stats.memory?.percent ?? 0) >= node.max_mem_percent) continue;
          if (node.max_disk_percent > 0 && (stats.disk?.percent ?? 0) >= node.max_disk_percent) continue;
        }
      }
      return node;
    }
    return null;
  }

  /** Wie viele Bots gerade auf einem Standort laufen – für die Auslastungsanzeige und die Grenze. */
  runningOnNode(nodeId) {
    let count = 0;
    for (const bot of this.bots.values()) {
      if (bot.running && bot.nodeId === nodeId) count += 1;
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
      if (this.waitingForRestart(`${row.profile_id}:${row.account_id}`)) continue;
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

  /**
   * Alles wieder hochfahren, was laufen soll, aber nicht läuft.
   *
   * Das ist der Weg zurück nach **jeder** Unterbrechung: nach einem Neustart des Dienstes, nach
   * einem Neustart des ganzen Servers, nachdem ein Standort wieder da ist, und nachdem eine
   * Discord-Mitgliedschaft wieder bestätigt wurde. Der Wunsch (`wanted`) steht in der Datenbank
   * und überlebt all das; hier wird er eingelöst.
   *
   * Ein abgestürzter Client kommt hier **nicht** wieder hoch: Endet ein Client von sich aus,
   * löscht er den Wunsch mit. Sonst hätte ein Server, der jeden Beitritt ablehnt, eine
   * Neustartschleife im Minutentakt.
   */
  restoreAll() {
    const rows = db
      .prepare('SELECT profile_id, account_id FROM profile_accounts WHERE wanted = 1')
      .all();
    let started = 0;
    for (const row of rows) {
      if (this.get(row.profile_id, row.account_id)?.running) continue;
      if (this.waitingForRestart(`${row.profile_id}:${row.account_id}`)) continue;
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

  /** Dasselbe für ein einzelnes Konto – etwa, wenn seine Discord-Mitgliedschaft zurück ist. */
  restoreUser(userId) {
    const rows = db
      .prepare(
        `SELECT pa.profile_id, pa.account_id FROM profile_accounts pa
           JOIN profiles p ON p.id = pa.profile_id
          WHERE pa.wanted = 1 AND p.user_id = ?`
      )
      .all(userId);
    let started = 0;
    for (const row of rows) {
      if (this.get(row.profile_id, row.account_id)?.running) continue;
      if (this.waitingForRestart(`${row.profile_id}:${row.account_id}`)) continue;
      const context = this.context(row.profile_id, row.account_id);
      if (!context || !isActive(context.profile)) continue;
      if (context.user.blocked || context.profile.locked || context.account.suspended) continue;
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
    // Erst die Versuchsketten, dann die Prozesse: Sonst legte jedes Stoppen hier noch einen
    // Versuch, der beim Herunterfahren nichts mehr zu suchen hat.
    for (const key of [...this.retry.keys()]) this.cancelRestart(key);
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

  /**
   * Der dauerhafte Ereignisverlauf eines Bots – anders als `historyOf()` aus der Datenbank und
   * nicht aus dem Speicher des laufenden Prozesses, also auch dann da, wenn der Bot gerade nicht
   * läuft oder seit dem letzten Neustart des Panels ein neues `Bot`-Objekt ist.
   */
  eventsOf(profileId, accountId, since = 0) {
    // `id ASC` als zweiter Schlüssel: Zwei Übergänge in derselben Millisekunde sind auf einem
    // schnellen Testlauf keine Seltenheit, und ohne ihn kehrt der `created_at DESC`-Index (der für
    // die Anzeige gedacht ist) ihre Reihenfolge bei einer Gleichheit einfach um.
    return db
      .prepare(
        `SELECT type, detail, created_at AS t FROM bot_events
         WHERE profile_id = ? AND account_id = ? AND created_at > ?
         ORDER BY created_at ASC, id ASC LIMIT 1000`
      )
      .all(profileId, accountId, since);
  }

  /**
   * Ereignisse jenseits der Aufbewahrungsfrist weg – Teil des stündlichen Aufräumens in index.js.
   *
   * Ein Schnappschuss lebt genau so lange wie seine Zeile: Ohne sie wäre er ein Bild, das nichts
   * mehr referenziert, und die Zeile ohne ihn ein toter Verweis. Erst die Dateien, dann die Zeilen
   * – sonst überlebte ein Bild seine eigene Zeile um einen Prozessabsturz mitten im Aufräumen.
   */
  cleanupEvents() {
    const cutoff = Date.now() - EVENT_RETENTION_MS;
    for (const row of db.prepare("SELECT detail FROM bot_events WHERE created_at < ? AND type = 'snapshot'").all(cutoff)) {
      if (row.detail) snapshots.remove(row.detail);
    }
    return db.prepare('DELETE FROM bot_events WHERE created_at < ?').run(cutoff).changes;
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

/**
 * Darf dieses Macro dem Client mitgegeben werden (`--cmd`, `--on`)?
 *
 * **Diese Frage muss an einer Stelle beantwortet werden.** Sie wird an zwei gestellt: hier, wenn
 * die Startargumente gebaut werden, und in macros.js, wenn das Panel entscheidet, ob es selbst
 * takten muss. Wären es zwei Antworten, liefe ein Macro, das die eine für den Client hält und die
 * andere nicht, **doppelt** – einmal vom Client und einmal vom Panel, bei jedem Auslöser.
 *
 * Sperrzeit, Wahrscheinlichkeit, Streuung und Ausschluss kennt der Client nicht. Er schickte die
 * Zeile stumpf jedes Mal und exakt im Takt – also genau das, was diese vier verhindern sollen.
 * Wer eines davon gesetzt hat, hat es gemeint, und dann taktet das Panel.
 */
function clientCanTake(macro) {
  if (Number(macro.cooldown_sec) > 0) return false;
  if (Number(macro.chance ?? 100) < 100) return false;
  let config;
  try {
    config = JSON.parse(macro.config || '{}');
  } catch {
    return false;
  }
  if (Number(config.jitter_sec) > 0 || config.exclude) return false;
  try {
    return simpleChatMacro(JSON.parse(macro.actions || '[]'));
  } catch {
    return false;
  }
}

export const supervisor = new Supervisor();
export { Bot, simpleChatMacro, clientCanTake, disconnectText, parseEvent, parseView };
