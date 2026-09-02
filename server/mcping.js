// Den Zielserver fragen, wie es ihm geht – bevor jemand den Fehler beim Bot sucht.
//
// **Die Frage, die das beantwortet.** Ein Bot kommt nicht ins Spiel. Woran liegt es: am Konto, am
// Panel, am Client – oder daran, dass der Minecraft-Server gerade aus ist? Bis hierher stand im
// Panel nur „Verbindung abgelehnt“, und das ist genau die Auskunft, mit der niemand etwas anfangen
// kann. Ein Blick auf den Server selbst beantwortet sie in einer Sekunde: Er antwortet, oder er
// antwortet nicht.
//
// **Woher die Antwort kommt.** Aus derselben Abfrage, die auch der Minecraft-Launcher macht, wenn
// er in der Serverliste die Spielerzahl und den MOTD anzeigt: „Server List Ping“. Der Server
// bekommt einen Handshake mit `next state = 1` und antwortet mit einem JSON-Block. Das ist kein
// Beitritt: Kein Konto, keine Anmeldung bei Mojang, kein Eintrag in irgendeinem Log über einen
// Spieler. Für den Server sieht es aus wie jemand, der die Serverliste offen hat.
//
// **Keine Bibliothek.** Das Protokoll besteht hier aus drei Dingen: VarInt, String, und ein Paket
// mit Längenpräfix. Zusammen dreißig Zeilen – weniger als die Einbindung eines Pakets, das
// dasselbe tut und dafür ein Update-Risiko mitbringt.
//
// **Was der Server schickt, gehört ihm und nicht uns.** Der MOTD ist Text von einem Fremden, das
// Symbol ein Bild von einem Fremden, die Spielerliste ein Feld, das beliebig lang sein darf.
// Deshalb steht unter jeder Auskunft hier eine Grenze, und alles, was herauskommt, ist entweder
// eine Zahl oder eine Zeichenkette bekannter Länge.

import net from 'node:net';
import dns from 'node:dns/promises';

/** Wie lange auf eine Antwort gewartet wird, insgesamt. */
const TIMEOUT_MS = 5000;

/** Wie groß die Antwort höchstens sein darf. Ein MOTD ist ein Satz, kein Datenstrom. */
const MAX_RESPONSE = 128 * 1024;

/**
 * Die Protokollnummer im Handshake.
 *
 * `-1` heißt „ich sage es nicht“. Genau dafür ist sie da: Der Status-Ping soll unabhängig von der
 * Spielversion funktionieren, und jede echte Zahl wäre entweder zu alt oder zu neu für irgendeinen
 * Server. Die Server, die darauf empfindlich reagieren, reagieren auf jede Zahl empfindlich.
 */
const PROTOCOL_UNKNOWN = -1;

// ---------------------------------------------------------------- Das Protokoll

/** Eine Zahl als VarInt: sieben Bit je Byte, das achte sagt „es kommt noch mehr“. */
function varInt(value) {
  const bytes = [];
  let rest = value >>> 0;
  // Bei negativen Zahlen zählt die Zweierkomplement-Darstellung – `>>> 0` macht daraus die
  // vorzeichenlose 32-Bit-Zahl, und die schreibt Minecraft genauso.
  do {
    let part = rest & 0x7f;
    rest >>>= 7;
    if (rest) part |= 0x80;
    bytes.push(part);
  } while (rest);
  return Buffer.from(bytes);
}

/** Und zurück. Gibt `null`, solange noch nicht genug Bytes da sind. */
function readVarInt(buffer, offset = 0) {
  let result = 0;
  let shift = 0;
  for (let index = 0; index < 5; index += 1) {
    if (offset + index >= buffer.length) return null;
    const byte = buffer[offset + index];
    result |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return { value: result >>> 0, size: index + 1 };
    shift += 7;
  }
  // Fünf Bytes ohne Ende: Das ist kein VarInt mehr, sondern eine Antwort, die nicht von einem
  // Minecraft-Server kommt. Weiterlesen hieße raten.
  throw new Error('Ungültige Antwort vom Server.');
}

/** Ein String: Länge als VarInt, dann UTF-8. */
function mcString(text) {
  const body = Buffer.from(String(text), 'utf8');
  return Buffer.concat([varInt(body.length), body]);
}

/** Ein Paket: Länge als VarInt, dann Kennung und Inhalt. */
const packet = (id, ...parts) => {
  const body = Buffer.concat([varInt(id), ...parts]);
  return Buffer.concat([varInt(body.length), body]);
};

// ---------------------------------------------------------------- Wohin

/**
 * Wo dieser Server wirklich lauscht.
 *
 * Minecraft benutzt SRV-Einträge: `play.example.net` zeigt oft auf einen ganz anderen Rechner und
 * einen ganz anderen Port. Ohne diese Auflösung fragte das Panel Port 25565 auf einer Adresse, an
 * der niemand lauscht – und meldete „offline“ für einen Server, der bestens läuft. Genau das tut
 * der Minecraft-Client auch, und zwar unter derselben Bedingung: **nur ohne ausdrücklichen Port.**
 * Wer `example.net:25566` eingetragen hat, meint diesen Port und keinen anderen.
 */
export async function resolveTarget(host, port = 0) {
  if (port) return { host, port, srv: false };
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    const best = records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
    if (best?.name) return { host: best.name.replace(/\.$/, ''), port: best.port, srv: true };
  } catch {
    // Kein SRV-Eintrag ist der Normalfall, kein Fehler.
  }
  return { host, port: 25565, srv: false };
}

// ---------------------------------------------------------------- Der Ping

/**
 * Einen Minecraft-Server nach seinem Zustand fragen.
 *
 * Gibt immer ein Objekt zurück und wirft nie: „Der Server ist nicht erreichbar“ ist hier ein
 * Ergebnis und kein Fehler – es ist sogar das interessanteste.
 */
export function ping(host, port = 25565, { timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    let buffer = Buffer.alloc(0);
    /** Wie lang das Antwortpaket wird – erst bekannt, wenn das Längenpräfix da ist. */
    let expected = null;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const failed = (message) => finish({ online: false, error: message });

    const timer = setTimeout(() => failed('timeout'), timeout);
    timer.unref?.();

    const socket = net.createConnection({ host, port, timeout });
    socket.setNoDelay(true);

    socket.on('error', (error) => failed(reason(error)));
    socket.on('timeout', () => failed('timeout'));
    // Ein Server, der die Verbindung ohne ein Wort schließt, ist online und redet nicht mit uns –
    // das ist etwas anderes als „nicht erreichbar“ und gehört auch anders dazustehen.
    socket.on('close', () => failed('closed'));

    socket.on('connect', () => {
      socket.write(
        Buffer.concat([
          // Handshake: Protokoll, Adresse, Port, „ich will den Status“ (1).
          packet(0x00, varInt(PROTOCOL_UNKNOWN), mcString(host), portBytes(port), varInt(1)),
          // Status Request: leer.
          packet(0x00),
        ])
      );
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_RESPONSE) return failed('oversize');
      try {
        if (expected === null) {
          const length = readVarInt(buffer);
          if (!length) return; // Das Längenpräfix ist noch nicht vollständig da.
          expected = length.size + length.value;
          if (length.value > MAX_RESPONSE) return failed('oversize');
        }
        if (buffer.length < expected) return; // Noch nicht alles da – weiter sammeln.

        // Länge, Paketkennung, dann der String mit dem JSON.
        let offset = readVarInt(buffer).size;
        const id = readVarInt(buffer, offset);
        offset += id.size;
        if (id.value !== 0x00) return failed('protocol');
        const size = readVarInt(buffer, offset);
        offset += size.size;
        const json = buffer.subarray(offset, offset + size.value).toString('utf8');
        finish({ ...view(JSON.parse(json)), online: true, latency_ms: Date.now() - started });
      } catch {
        failed('malformed');
      }
    });
  });
}

const portBytes = (port) => {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(port & 0xffff);
  return out;
};

/**
 * Aus dem Fehler des Betriebssystems ein Schlüssel, kein Satz.
 *
 * Hier standen fertige deutsche Sätze, und die gingen genau so in den Browser: Wer das Panel auf
 * Englisch benutzte, bekam unter der englischen Überschrift „The Minecraft server did not answer“
 * die Zeile „Diese Adresse gibt es nicht (DNS)“. Der Wortlaut gehört dorthin, wo jeder andere
 * sichtbare Text steht – in `i18n.js`, in beiden Sprachen –, und die Antwort der API sagt nur
 * noch, *was* los war. Die Schlüssel heißen `mcstatus.<name>`.
 */
const REASONS = {
  ENOTFOUND: 'dns',
  EAI_AGAIN: 'dns',
  ECONNREFUSED: 'refused',
  ETIMEDOUT: 'timeout',
  ECONNRESET: 'reset',
  EHOSTUNREACH: 'unreachable',
  ENETUNREACH: 'unreachable',
};

function reason(error) {
  return REASONS[error?.code || ''] || 'unknown';
}

// ---------------------------------------------------------------- Was davon ins Panel darf

const clamp = (value, max) => String(value ?? '').slice(0, max);

/**
 * Die Antwort des Servers auf das, was das Panel wirklich zeigt.
 *
 * Jedes Feld ist einzeln herausgenommen und beschnitten. Der Grund ist einfach: Das hier ist der
 * einzige Ort im Panel, an dem Daten von einem **beliebigen fremden Server** hereinkommen, den
 * sich der Kunde selbst ausgesucht hat. Die Antwort einfach durchzureichen hieße, jedem
 * Serverbetreiber der Welt ein Feld in unserer Oberfläche zu geben.
 */
function view(data) {
  const players = data?.players || {};
  return {
    version: clamp(data?.version?.name, 64),
    protocol: Number.isFinite(data?.version?.protocol) ? data.version.protocol : null,
    online_players: Number.isFinite(players.online) ? players.online : null,
    max_players: Number.isFinite(players.max) ? players.max : null,
    // Die Namensliste ist bei Servern mit vielen Spielern nur ein Ausschnitt, und manche
    // schreiben dort Werbung statt Namen. Zwölf Einträge reichen für den Eindruck „wer ist da“.
    sample: Array.isArray(players.sample)
      ? players.sample.slice(0, 12).map((entry) => clamp(entry?.name, 48)).filter(Boolean)
      : [],
    motd: legacy(data?.description),
    favicon: favicon(data?.favicon),
  };
}

/**
 * Nur ein PNG als Data-URI, und nur eines von vernünftiger Größe.
 *
 * Das Serversymbol ist laut Protokoll ein 64×64-PNG in einer `data:`-Adresse. „Laut Protokoll“ ist
 * hier aber nur eine Bitte an den Server – geliefert wird, was er will. Ein `data:text/html`
 * stünde sonst gleich in einem `src`, und acht Megabyte Base64 in jeder Antwort des Panels.
 */
function favicon(value) {
  const text = String(value || '');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(text)) return '';
  return text.length <= 64 * 1024 ? text : '';
}

/**
 * Eine Chat-Komponente in die §-Schreibweise, die das Panel ohnehin überall benutzt.
 *
 * Der MOTD kommt je nach Server als schlichter Text, als Objekt mit `extra`, oder als Liste davon –
 * alle drei Formen sind erlaubt und alle drei kommen vor. Am Ende steht in jedem Fall dasselbe wie
 * in einer Chatzeile, und `mcText()` im Browser zeichnet es wie jede andere (siehe chatlog.js).
 *
 * Übersetzbare Komponenten (`translate`) fallen weg: Ihren Wortlaut kennt nur das Sprachpaket des
 * Spielclients. Ein Platzhalter wie "chat.type.text" im MOTD wäre schlechter als eine Lücke.
 */
/**
 * Wie tief eine Chat-Komponente geschachtelt sein darf.
 *
 * Was hier hereinkommt, hat ein fremder Server geschickt – und welchen Server ein Bot anspricht,
 * bestimmt der Kunde. Ein `extra` in einem `extra` in einem `extra`, zehntausendfach, ist eine
 * gültige JSON-Antwort und für eine Funktion, die sich selbst aufruft, das Ende des Stapels. Der
 * Absturz träfe nicht die Abfrage, sondern den Prozess – und mit ihm jeden laufenden Bot. Kein
 * echter MOTD ist auch nur annähernd so tief; alles darunter wird abgeschnitten statt beantwortet.
 */
const MAX_DEPTH = 32;

export function legacy(component, inherited = {}, depth = 0) {
  if (component === null || component === undefined || depth > MAX_DEPTH) return '';
  if (typeof component === 'string') return component;
  if (Array.isArray(component)) {
    return component.map((entry) => legacy(entry, inherited, depth + 1)).join('');
  }

  const style = {
    color: component.color ?? inherited.color,
    bold: component.bold ?? inherited.bold,
    italic: component.italic ?? inherited.italic,
    underlined: component.underlined ?? inherited.underlined,
    strikethrough: component.strikethrough ?? inherited.strikethrough,
    obfuscated: component.obfuscated ?? inherited.obfuscated,
  };

  let out = '';
  const text = typeof component.text === 'string' ? component.text : '';
  if (text) out += codes(style) + text;
  for (const child of Array.isArray(component.extra) ? component.extra : []) {
    out += legacy(child, style, depth + 1);
  }
  return out;
}

const NAMED = {
  black: '0', dark_blue: '1', dark_green: '2', dark_aqua: '3',
  dark_red: '4', dark_purple: '5', gold: '6', gray: '7',
  dark_gray: '8', blue: '9', green: 'a', aqua: 'b',
  red: 'c', light_purple: 'd', yellow: 'e', white: 'f',
};

/**
 * Die §-Codes für einen Stil.
 *
 * Die Farbe zuerst: In der alten Schreibweise setzt ein Farbcode alle Auszeichnungen zurück, also
 * müssen fett und kursiv **danach** kommen. Andersherum wäre der Text am Ende schlicht.
 */
function codes(style) {
  let out = '';
  if (style.color) {
    const hex = /^#([0-9a-f]{6})$/i.exec(style.color);
    // Hexfarben in der Schreibweise, die chatlog.js versteht: §x, dann jede Ziffer mit § davor.
    if (hex) out += `§x${[...hex[1].toLowerCase()].map((digit) => `§${digit}`).join('')}`;
    else if (NAMED[style.color]) out += `§${NAMED[style.color]}`;
  }
  if (style.obfuscated) out += '§k';
  if (style.bold) out += '§l';
  if (style.strikethrough) out += '§m';
  if (style.underlined) out += '§n';
  if (style.italic) out += '§o';
  return out;
}

// ---------------------------------------------------------------- Zwischenspeicher

/**
 * Dieselbe Antwort für ein paar Sekunden wiederverwenden.
 *
 * Ein offener Serverplatz im Panel fragt bei jedem Blick nach, und wer zehn Serverplätze auf
 * demselben Minecraft-Server hat, fragte ihn zehnmal in derselben Sekunde. Das ist aus Sicht des
 * Zielservers kein Panel mehr, sondern Last – und aus unserer Sicht zehnmal dieselbe Antwort.
 */
const cache = new Map();
const CACHE_MS = 15_000;

export async function status(host, port = 0, { fresh = false } = {}) {
  const key = `${host}:${port}`;
  const known = cache.get(key);
  if (!fresh && known && Date.now() - known.at < CACHE_MS) return { ...known.value, cached: true };

  const target = await resolveTarget(host, port);
  const value = {
    ...(await ping(target.host, target.port)),
    host: target.host,
    port: target.port,
    srv: target.srv,
    checked_at: Date.now(),
  };
  cache.set(key, { at: Date.now(), value });
  // Der Speicher wächst mit jedem je gefragten Server. Ein paar hundert Einträge sind nichts, ein
  // unbegrenzt wachsendes Map in einem Dienst, der Monate läuft, ist ein Leck.
  if (cache.size > 500) {
    for (const [entry, stored] of cache) {
      if (Date.now() - stored.at > CACHE_MS) cache.delete(entry);
    }
  }
  return { ...value, cached: false };
}
