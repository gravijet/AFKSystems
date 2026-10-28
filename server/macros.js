// Macros und Spam: was auf ein Ereignis hin passieren soll.
//
// Ein Macro besteht aus einem Auslöser (Beitritt, Wiederkehr, Zeittakt, Chatzeile, Weltwechsel,
// Tod, Menü, Verbindungsabbruch) und einer Kette von Schritten, die der Reihe nach laufen.
//
// Das Panel verwaltet sämtliche Macros in einer eigenen Warteschlange je Bot. Dadurch gelten
// Accountauswahl, Änderungen und Abbrüche auch beim nächsten Beitritt desselben Prozesses.
// Der Client übernimmt weiterhin Spielbereitschaft und den Mindestabstand der Chatpakete.
//
// Welche Schritte es gibt, richtet sich danach, was die Bauform des Bots kann. Schritte, die kein
// Client beherrscht (Blöcke abbauen, schlagen), gibt es hier bewusst nicht: Ein Knopf, der eine
// Fehlermeldung auslöst, ist schlimmer als kein Knopf.
//
// ---------------------------------------------------------------------------------------------
//
// **Drei Dinge, die ein Macro von einem Automaten unterscheiden** – und der Grund, warum es sie
// gibt, steht nicht in der Bedienung, sondern im Betrieb:
//
//   * **Sperrzeit (`cooldown_sec`).** Ein Macro auf „Chat enthält X“ feuert bei jedem Treffer.
//     Schickt der Server die Zeile im Sekundentakt, geht derselbe Befehl im Sekundentakt hinaus –
//     für den Server nicht von Spam zu unterscheiden, und der Bot fliegt genau dafür raus.
//   * **Wahrscheinlichkeit (`chance`).** Eine Antwort, die auf die Millisekunde genau immer gleich
//     kommt, ist als Automat zu erkennen. Unter 100 % ist sie es nicht mehr.
//   * **Streuung beim Zeittakt (`jitter_sec`).** Dasselbe für Wiederholungen: „alle 300 s“ ist ein
//     Muster, „alle 300 s ± 30 s“ ist keines.
//
// Alle drei haben als Vorgabe genau das alte Verhalten (0, 100 %, 0) – ein bestehendes Macro
// ändert sich durch sie nicht.

import { db } from './db.js';
import { supervisor, clientCanTake } from './supervisor.js';
import * as notify from './notify.js';
import { stripFormatting } from '../public/assets/js/chatlog.js';

/** Die Richtungen, in die der Client laufen kann – relativ zur Blickrichtung, nicht zur Karte. */
const WALK = {
  options: ['vor', 'zurück', 'links', 'rechts'],
  labels: { de: ['vor', 'zurück', 'links', 'rechts'], en: ['forward', 'back', 'left', 'right'] },
};

/**
 * Die Blickrichtungen, die `:look` als Wort versteht.
 *
 * Sie sind das Gegenstück zu `look` mit Zahlen: Wer eine Kiste im Norden anschauen will, weiß die
 * Himmelsrichtung und nicht den Gierwinkel. `um` dreht auf der Stelle, `gerade` setzt die Neigung
 * auf null – beides Dinge, die man sonst aus zwei Zahlen ausrechnen müsste.
 */
const FACE = {
  options: ['nord', 'ost', 'süd', 'west', 'nordost', 'südost', 'südwest', 'nordwest', 'um', 'gerade'],
  labels: {
    de: ['Norden', 'Osten', 'Süden', 'Westen', 'Nordosten', 'Südosten', 'Südwesten', 'Nordwesten', 'umdrehen', 'geradeaus'],
    en: ['north', 'east', 'south', 'west', 'north-east', 'south-east', 'south-west', 'north-west', 'turn around', 'level out'],
  },
};

const ONOFF = {
  options: ['on', 'off', 'toggle'],
  labels: { de: ['an', 'aus', 'umschalten'], en: ['on', 'off', 'toggle'] },
};

/** Alle Schritte, die das Panel ausführen kann. Das Frontend baut daraus seine Auswahl. */
export const ACTIONS = [
  {
    type: 'chat',
    de: 'Chat / Befehl',
    en: 'Chat / command',
    fields: [{ key: 'text', de: 'Text', en: 'Text', type: 'text' }],
  },
  {
    // Eine von mehreren Zeilen, per Zufall. Getrennt mit `|`, weil ein einzeiliges Feld das ist,
    // was der Editor überall sonst auch zeigt – und weil eine Chatzeile ohnehin keine Umbrüche hat.
    type: 'chat_random',
    de: 'Chat: eine Zeile per Zufall',
    en: 'Chat: one line at random',
    fields: [
      {
        key: 'text',
        de: 'Zeilen, getrennt mit |',
        en: 'Lines separated by |',
        type: 'text',
        hint_de: 'z. B.  Hi|Moin|Hallo zusammen',
        hint_en: 'e.g.  Hi|Hey|Hello there',
      },
    ],
  },
  {
    type: 'wait',
    de: 'Warten',
    en: 'Wait',
    fields: [{ key: 'seconds', de: 'Sekunden', en: 'Seconds', type: 'number', min: 1, max: 3600 }],
  },
  {
    type: 'wait_random',
    de: 'Zufällig warten',
    en: 'Wait a random time',
    fields: [
      { key: 'min_seconds', de: 'Von (s)', en: 'From (s)', type: 'number', min: 1, max: 3600 },
      { key: 'max_seconds', de: 'Bis (s)', en: 'To (s)', type: 'number', min: 1, max: 3600 },
    ],
  },
  {
    type: 'move',
    de: 'Gehen',
    en: 'Walk',
    needs: 'movement',
    fields: [
      { key: 'direction', de: 'Richtung', en: 'Direction', type: 'select', ...WALK },
      { key: 'blocks', de: 'Blöcke', en: 'Blocks', type: 'number', min: 1, max: 64 },
    ],
  },
  {
    type: 'look',
    de: 'Blickrichtung (Winkel)',
    en: 'Look direction (angles)',
    needs: 'movement',
    fields: [
      { key: 'yaw', de: 'Links/Rechts (Yaw)', en: 'Left/right (yaw)', type: 'number', min: -180, max: 180 },
      { key: 'pitch', de: 'Hoch/Runter (Pitch)', en: 'Up/down (pitch)', type: 'number', min: -90, max: 90 },
    ],
  },
  {
    type: 'face',
    de: 'Blickrichtung (Himmelsrichtung)',
    en: 'Look direction (compass)',
    needs: 'movement',
    fields: [{ key: 'direction', de: 'Richtung', en: 'Direction', type: 'select', ...FACE }],
  },
  {
    type: 'jump',
    de: 'Springen',
    en: 'Jump',
    needs: 'movement',
    fields: [
      {
        key: 'direction',
        de: 'Richtung (optional)',
        en: 'Direction (optional)',
        type: 'select',
        options: ['', ...WALK.options],
        labels: {
          de: ['auf der Stelle', ...WALK.labels.de],
          en: ['on the spot', ...WALK.labels.en],
        },
      },
    ],
  },
  {
    type: 'fall',
    de: 'Fallen lassen',
    en: 'Let go / fall',
    needs: 'movement',
    fields: [],
  },
  {
    type: 'home',
    de: 'Heimatposition',
    en: 'Home position',
    needs: 'movement',
    fields: [
      {
        key: 'mode',
        de: 'Was',
        en: 'What',
        type: 'select',
        options: ['go', 'set', 'on', 'off', 'clear'],
        labels: {
          de: ['hinlaufen', 'hier setzen', 'bei Beitritt an', 'bei Beitritt aus', 'löschen'],
          en: ['walk there', 'set here', 'on join: yes', 'on join: no', 'clear'],
        },
      },
    ],
  },
  {
    type: 'route',
    de: 'Wegpunkte',
    en: 'Waypoints',
    needs: 'movement',
    fields: [
      {
        key: 'mode',
        de: 'Was',
        en: 'What',
        type: 'select',
        options: ['go', 'rec', 'stop', 'add', 'clear'],
        labels: {
          de: ['Strecke ablaufen', 'Aufzeichnung starten', 'Aufzeichnung beenden', 'Punkt hinzufügen', 'löschen'],
          en: ['walk the route', 'start recording', 'stop recording', 'add a point', 'clear'],
        },
      },
    ],
  },
  { type: 'stop', de: 'Bewegung stoppen', en: 'Stop moving', needs: 'movement', fields: [] },
  {
    type: 'sneak',
    de: 'Schleichen',
    en: 'Sneak',
    needs: 'sneak',
    fields: [{ key: 'mode', de: 'Was', en: 'What', type: 'select', ...ONOFF }],
  },
  {
    type: 'sprint',
    de: 'Sprinten',
    en: 'Sprint',
    needs: 'sneak',
    fields: [{ key: 'mode', de: 'Was', en: 'What', type: 'select', ...ONOFF }],
  },
  { type: 'swing', de: 'Arm schwingen', en: 'Swing arm', needs: 'sneak', fields: [] },
  { type: 'use', de: 'Gegenstand benutzen', en: 'Use item', needs: 'sneak', fields: [] },
  {
    type: 'hand',
    de: 'Schnellleiste wählen',
    en: 'Pick hotbar slot',
    needs: 'sneak',
    fields: [{ key: 'slot', de: 'Feld (1–9)', en: 'Slot (1–9)', type: 'number', min: 1, max: 9 }],
  },
  {
    type: 'click',
    de: 'Menüfeld anklicken',
    en: 'Click menu slot',
    needs: 'menu',
    fields: [
      { key: 'slot', de: 'Feld', en: 'Slot', type: 'number', min: 0, max: 100 },
      {
        key: 'button',
        de: 'Taste',
        en: 'Button',
        type: 'select',
        options: ['', 'rechts', 'shift'],
        labels: { de: ['links', 'rechts', 'shift'], en: ['left', 'right', 'shift'] },
      },
    ],
  },
  { type: 'close', de: 'Menü schließen', en: 'Close menu', needs: 'menu', fields: [] },
  // ---- Abfragen. Sie schicken nichts an den Server, sie holen einen Schnappschuss in die
  //      Ansicht des Panels. Ein Macro, das nach dem Öffnen eines Menüs `menu_read` ausführt,
  //      sorgt dafür, dass im Panel steht, was im Fenster liegt – ohne dass jemand zusieht.
  { type: 'board_read', de: 'Anzeigetafel abfragen', en: 'Read the scoreboard', needs: 'board', fields: [] },
  { type: 'menu_read', de: 'Offenes Menü abfragen', en: 'Read the open menu', needs: 'menu', fields: [] },
  { type: 'inv_read', de: 'Inventar abfragen', en: 'Read the inventory', needs: 'items', fields: [] },
  {
    type: 'slot_read',
    de: 'Feld genauer ansehen',
    en: 'Inspect one slot',
    needs: 'items',
    fields: [{ key: 'slot', de: 'Feld', en: 'Slot', type: 'number', min: 0, max: 100 }],
  },
  { type: 'position', de: 'Position abfragen', en: 'Read the position', needs: 'movement', fields: [] },
  {
    type: 'antiafk',
    de: 'Anti-AFK-Bewegung',
    en: 'Anti-AFK movement',
    needs: 'antiafk',
    fields: [
      {
        key: 'mode',
        de: 'Was',
        en: 'What',
        type: 'select',
        options: ['on', 'off', 'seconds'],
        labels: { de: ['an', 'aus', 'alle … Sekunden'], en: ['on', 'off', 'every … seconds'] },
      },
      { key: 'seconds', de: 'Sekunden', en: 'Seconds', type: 'number', min: 15, max: 3600 },
    ],
  },
  {
    type: 'pov',
    de: 'Live-Ansicht',
    en: 'Live view',
    needs: 'pov',
    fields: [
      {
        key: 'mode',
        de: 'Was',
        en: 'What',
        type: 'select',
        options: ['live', 'stop'],
        labels: { de: ['starten', 'stoppen'], en: ['start', 'stop'] },
      },
    ],
  },
  // ---- Schritte, die nichts ins Spiel schicken, sondern etwas mit dem Bot oder mit dir tun.
  {
    // Der Grund, warum es diesen Schritt gibt: Ein Macro auf „Chat enthält 'du wurdest gebannt'“
    // ist nur dann etwas wert, wenn es jemanden erreicht. Sonst steht die Zeile im Verlauf, und
    // gelesen wird sie, wenn ohnehin schon alles vorbei ist.
    type: 'notify',
    de: 'Mir Bescheid geben',
    en: 'Send me a notice',
    fields: [{ key: 'text', de: 'Text', en: 'Text', type: 'text' }],
  },
  {
    // Trennen **und wiederkommen**. Der Client kennt keinen eigenen Reconnect; was hier passiert,
    // ist derselbe Weg wie beim Wiederanlauf nach einem Absturz – Prozess beenden, Startwunsch
    // stehen lassen, nach ein paar Sekunden neu starten.
    type: 'reconnect',
    de: 'Neu verbinden',
    en: 'Reconnect',
    fields: [
      { key: 'seconds', de: 'Pause vorher (s)', en: 'Pause first (s)', type: 'number', min: 1, max: 600 },
    ],
  },
  { type: 'disconnect', de: 'Trennen', en: 'Disconnect', fields: [] },
  {
    type: 'run',
    de: 'Anderes Macro ausführen',
    en: 'Run another macro',
    fields: [{ key: 'name', de: 'Name des Macros', en: 'Name of the macro', type: 'text' }],
  },
  {
    type: 'stop_macros',
    de: 'Andere Macros abbrechen',
    en: 'Cancel the other macros',
    fields: [],
  },
];

export const EVENTS = [
  { type: 'join', de: 'Beim Beitritt', en: 'On join', config: [] },
  {
    // **Die Wiederkehr.** `join` feuert beim ersten Beitritt eines Clientlaufs; dieser hier feuert,
    // wenn der Bot nach einem Ausfall zurückkommt – nach einem Kick, nach einem Serverneustart,
    // nach dem Wiederanlauf des Panels. Das ist meistens der Moment, in dem etwas anderes zu tun
    // ist als beim ersten Mal: sich zurückmelden, an den alten Platz laufen, den AFK-Modus wieder
    // einschalten. Ohne diesen Auslöser lief dafür jedes Mal das Beitrittsmacro mit.
    type: 'rejoin',
    de: 'Bei der Wiederkehr',
    en: 'On coming back',
    config: [],
  },
  {
    type: 'timer',
    de: 'Im Zeittakt',
    en: 'On a timer',
    config: [
      { key: 'interval_sec', de: 'Alle … Sekunden', en: 'Every … seconds', type: 'number', min: 5, max: 86400 },
      {
        key: 'jitter_sec',
        de: 'Streuung (± Sekunden)',
        en: 'Spread (± seconds)',
        type: 'number',
        min: 0,
        max: 3600,
        hint_de: 'Macht aus einem Takt eine Gewohnheit. 0 = exakt.',
        hint_en: 'Turns a metronome into a habit. 0 = exact.',
      },
    ],
  },
  {
    type: 'chat',
    de: 'Bei Chat-Nachricht',
    en: 'On chat message',
    config: [
      { key: 'contains', de: 'Enthält Text', en: 'Contains text', type: 'text' },
      { key: 'regex', de: 'oder regulärer Ausdruck', en: 'or regular expression', type: 'text' },
      {
        key: 'exclude',
        de: 'Aber nicht, wenn die Zeile das enthält',
        en: 'But not when the line contains this',
        type: 'text',
        hint_de: 'Damit trifft „Willkommen“ nicht auch die eigene Begrüßung.',
        hint_en: 'So that “welcome” does not also match your own greeting.',
      },
    ],
  },
  { type: 'world', de: 'Bei Weltwechsel', en: 'On world change', config: [] },
  { type: 'death', de: 'Bei Tod', en: 'On death', config: [] },
  {
    // Der Client meldet ein geöffnetes Fenster von sich aus (`@event menu open`). Damit lässt sich
    // ein Menü bedienen, ohne dass jemand davor sitzt: Fenster auf -> Feld anklicken -> schließen.
    type: 'menu',
    de: 'Wenn ein Menü aufgeht',
    en: 'When a menu opens',
    config: [
      {
        key: 'title',
        de: 'Titel enthält (leer = jedes)',
        en: 'Title contains (empty = any)',
        type: 'text',
      },
    ],
  },
  { type: 'disconnect', de: 'Bei Verbindungsabbruch', en: 'On disconnect', config: [] },
];

// Muster einmal übersetzen und behalten: onChat läuft für jede einzelne Chatzeile jedes Bots,
// und `new RegExp` bei jedem Aufruf war reine Arbeit für nichts. Geprüft wird das Muster schon
// beim Speichern (siehe cleanConfig in routes/profiles.js), hier bleibt nur der Notausgang.
const patterns = new Map();

function compiled(source) {
  if (!patterns.has(source)) {
    try {
      patterns.set(source, new RegExp(source, 'i'));
    } catch {
      patterns.set(source, null);
    }
  }
  return patterns.get(source);
}

/** So tief darf ein Macro andere Macros aufrufen. Darüber ist es keine Kette mehr, sondern ein Kreis. */
const MAX_DEPTH = 3;

/**
 * Die Platzhalter, die in jedem Text eines Schritts stehen dürfen.
 *
 * `{line}` gab es schon; die anderen kamen mit den regulären Ausdrücken dazu. Wer auf
 * `Spieler (\w+) hat dich angeschrieben` wartet, will in der Antwort den Namen einsetzen können –
 * ohne `{1}` bliebe von der ganzen Gruppe nur die Erkenntnis, dass sie zutraf.
 */
function fill(text, bot, context = {}) {
  return String(text ?? '')
    .replace(/\{(line|player|server|[1-9])\}/g, (_match, key) => {
      if (key === 'line') return context.line || '';
      if (key === 'player') return bot.account?.name || '';
      if (key === 'server') return bot.profile?.name || '';
      return context.groups?.[Number(key)] ?? '';
    });
}

/** Eine ganze Zahl zwischen zwei Grenzen – für Streuung und Zufallspausen. */
const between = (low, high) => low + Math.floor(Math.random() * (high - low + 1));

class MacroEngine {
  constructor() {
    // key -> { timers: Set<Timeout>, running: Set<string>, lastRun: Map<string, number>, generation: number }
    this.state = new Map();
  }

  slot(bot) {
    if (!this.state.has(bot.key)) {
      this.state.set(bot.key, {
        timers: new Set(),
        running: new Set(),
        // Wann dieses Macro zuletzt lief – die Grundlage der Sperrzeit. Im Speicher und nicht in
        // der Datenbank: Eine Sperrzeit gilt für diesen Lauf, und ein neu gestarteter Bot soll
        // nicht darauf warten, dass eine Sperre von vor einer Stunde abläuft.
        lastRun: new Map(),
        // Hochgezählt von `stop_macros`. Jeder laufende Ablauf merkt sich den Stand von seinem
        // Beginn und hört auf, sobald er nicht mehr stimmt – das ist ein Abbruch, der keine
        // halbe Aktion mitten im Schritt abschneidet.
        generation: 0,
        queue: [],
        runner: null,
        readyAt: 0,
        abort: new AbortController(),
      });
    }
    return this.state.get(bot.key);
  }

  /** Wird beim Start eines Bots aufgerufen: Zeittakte einrichten. */
  attach(bot) {
    this.detach(bot);
    const slot = this.slot(bot);

    for (const macro of this.macrosFor(bot, 'timer')) {
      if (this.handledByClient(bot, macro)) continue;
      const config = JSON.parse(macro.config || '{}');
      const seconds = Math.max(5, Number(config.interval_sec) || 300);
      const jitter = Math.max(0, Math.min(seconds - 1, Number(config.jitter_sec) || 0));
      this.tick(bot, slot, seconds, jitter, () => {
        if (bot.online) this.run(bot, macro);
      });
    }

    for (const entry of this.spamFor(bot)) {
      const seconds = Math.max(5, entry.interval_sec);
      const timer = setInterval(() => {
        if (bot.online) this.run(bot, {
          id: `spam:${entry.id}`, name: 'Wiederholung',
          actions: JSON.stringify([{ type: 'chat', text: entry.message }]),
        }, { quiet: true });
      }, seconds * 1000);
      timer.unref();
      slot.timers.add(timer);
    }

    this.attachAntiAfk(bot, slot);
  }

  /**
   * Ein Takt, der streuen kann.
   *
   * Ohne Streuung ist das ein `setInterval` und nichts weiter. Mit Streuung geht das nicht mehr:
   * Ein Intervall hat genau einen Abstand, und ein Abstand, der sich jedes Mal ändert, ist eine
   * Kette einzelner Wartezeiten. Deshalb legt jeder Durchlauf den nächsten – und legt ihn auch
   * dann, wenn der Schritt selbst gescheitert ist, sonst stünde der Takt nach dem ersten Fehler.
   */
  tick(bot, slot, seconds, jitter, work) {
    const next = () => {
      const wait = jitter ? between(seconds - jitter, seconds + jitter) : seconds;
      const timer = setTimeout(() => {
        slot.timers.delete(timer);
        // Der nächste Takt zuerst: Was `work` tut, kann eine Minute dauern (Wartezeiten im Macro),
        // und der Takt ist der Abstand zwischen zwei Anfängen und nicht zwischen Ende und Anfang.
        next();
        try {
          work();
        } catch {
          /* Ein Fehler im Schritt beendet nicht den Takt. */
        }
      }, wait * 1000);
      timer.unref?.();
      slot.timers.add(timer);
    };
    next();
  }

  /**
   * Anti-AFK aus dem Panel: ein Befehl im Takt, gegen Plugins, die auf Aktivität schauen.
   * Die *Bewegung* dagegen macht der Premium-Client selbst (`--antiafk`) – dort gehört sie hin,
   * weil sie zwischen zwei Paketen liegen muss und nicht zwischen zwei HTTP-Aufrufen.
   */
  attachAntiAfk(bot, slot) {
    let settings;
    try {
      settings = JSON.parse(bot.profile.anti_afk || '{}');
    } catch {
      return;
    }
    if (!settings.command || !settings.command_text) return;
    const seconds = Math.min(3600, Math.max(30, Number(settings.interval_sec) || 240));
    const timer = setInterval(() => {
      if (bot.online) this.run(bot, {
        id: 'anti-afk', name: 'Anti-AFK',
        actions: JSON.stringify([{ type: 'chat', text: String(settings.command_text) }]),
      }, { quiet: true });
    }, seconds * 1000);
    timer.unref();
    slot.timers.add(timer);
  }

  detach(bot) {
    const slot = this.state.get(bot.key);
    if (!slot) return;
    // `clearTimeout` und `clearInterval` sind in Node dasselbe – hier liegen beide Arten im Topf
    // (Spam und Anti-AFK takten fest, ein Zeitmacro mit Streuung legt sich selbst neu).
    for (const timer of slot.timers) clearTimeout(timer);
    slot.timers.clear();
    this.cancel(slot);
  }

  cancel(slot) {
    slot.generation += 1;
    slot.abort.abort();
    slot.abort = new AbortController();
    for (const entry of slot.queue.splice(0)) entry.resolve();
    slot.running.clear();
    slot.runner = null;
    slot.readyAt = 0;
    slot.joinContext = null;
  }

  /** Nach dem Ändern von Macros/Spam die Takte eines Serverplatzes neu aufziehen. */
  reload(profileId) {
    for (const bot of supervisor.bots.values()) {
      if (bot.profile.id !== profileId) continue;
      if (!bot.running) continue;
      const joining = this.slot(bot).joinContext;
      if (joining) this.onJoin(bot, { again: joining.again, completed: new Set([...joining.completed, ...joining.started]) });
      else this.attach(bot);
    }
  }

  /** Alle Macros werden vom Panel verwaltet, auch feste Beitrittsbefehle. */
  handledByClient(bot, macro) {
    return clientCanTake(macro);
  }

  macrosFor(bot, event) {
    return db
      .prepare('SELECT * FROM macros WHERE profile_id = ? AND event = ? AND enabled = 1 ORDER BY id')
      .all(bot.profile.id, event)
      .filter((macro) => {
        const accounts = JSON.parse(macro.accounts || '[]');
        return !accounts.length || accounts.includes(bot.account.id);
      });
  }

  spamFor(bot) {
    return db
      .prepare('SELECT * FROM spam WHERE profile_id = ? AND enabled = 1')
      .all(bot.profile.id)
      .filter((entry) => {
        const accounts = JSON.parse(entry.accounts || '[]');
        return !accounts.length || accounts.includes(bot.account.id);
      });
  }

  // ------------------------------------------------------------ Auslöser

  /**
   * Der Bot ist im Spiel.
   *
   * `again` sagt, ob das eine Wiederkehr war – dann laufen die `rejoin`-Macros **zusätzlich** zu
   * den Beitrittsmacros. Zusätzlich und nicht statt: Was beim ersten Beitritt nötig war (sich beim
   * AFK-Plugin abmelden, in den richtigen Unterserver wechseln), ist es nach einem Kick genauso.
   */
  onJoin(bot, { again = false, completed = new Set() } = {}) {
    this.attach(bot);
    const slot = this.slot(bot);
    slot.readyAt = Date.now() + Math.max(0, Number(bot.profile.join_delay) || 0) * 1000;
    const list = [...this.macrosFor(bot, 'join'), ...(again ? this.macrosFor(bot, 'rejoin') : [])]
      .filter(macro => !completed.has(String(macro.id)));
    // Änderungen während der Startpause dürfen die Initialisierung nicht ersatzlos abbrechen.
    // Bereits abgeschlossene Beitrittsmacros werden dabei nicht wiederholt.
    const joining = {
      again, completed: new Set(completed), started: new Set(),
      pending: new Set(list.map(macro => String(macro.id))),
    };
    slot.joinContext = list.length ? joining : null;
    const generation = slot.generation;
    for (const macro of list) {
      if (slot.generation !== generation) break;
      this.run(bot, macro, { joining });
    }
  }

  onChat(bot, line) {
    const macros = this.macrosFor(bot, 'chat');
    if (!macros.length) return;
    const lower = line.toLowerCase();
    for (const macro of macros) {
      if (this.handledByClient(bot, macro)) continue;
      const config = JSON.parse(macro.config || '{}');
      // Der Ausschluss zuerst: Er ist billiger als ein regulärer Ausdruck und beantwortet die
      // Frage abschließend. Sein Zweck ist die eigene Antwort – ohne ihn löst ein Macro auf
      // "Willkommen" auch dann aus, wenn der Bot selbst gerade "Willkommen!" geschrieben hat.
      if (config.exclude && lower.includes(String(config.exclude).toLowerCase())) continue;
      let hit = false;
      let groups = null;
      if (config.contains) hit = lower.includes(String(config.contains).toLowerCase());
      if (!hit && config.regex) {
        const match = compiled(config.regex)?.exec(line) || null;
        hit = Boolean(match);
        groups = match;
      }
      if (hit) this.run(bot, macro, { line, groups });
    }
  }

  onWorldChange(bot) {
    for (const macro of this.macrosFor(bot, 'world')) {
      if (this.handledByClient(bot, macro)) continue;
      this.run(bot, macro);
    }
  }

  onDeath(bot) {
    for (const macro of this.macrosFor(bot, 'death')) {
      if (this.handledByClient(bot, macro)) continue;
      this.run(bot, macro);
    }
  }

  /**
   * Ein Fenster ist aufgegangen. `title` ist der Titel, wie der Server ihn schickt – also mit
   * Farbcodes darin.
   *
   * **Verglichen wird ohne sie.** Ein Titel wie `§6Server §eShop` enthält "Shop", aber `§6Server
   * §eShop` enthält nicht "Server Shop": Zwischen den Wörtern steht ein Farbwechsel. Wer im Panel
   * "Server Shop" einträgt, meint, was er im Spiel liest, und nicht, was auf der Leitung steht.
   */
  onMenu(bot, title = '') {
    const plain = stripFormatting(String(title || '')).toLowerCase();
    for (const macro of this.macrosFor(bot, 'menu')) {
      const config = JSON.parse(macro.config || '{}');
      if (config.title && !plain.includes(String(config.title).toLowerCase())) continue;
      this.run(bot, macro, { line: title });
    }
  }

  onDisconnect(bot) {
    // Eine echte Trennung beendet auch wartende Aktionen. Die Abbruch-Auslöser dürfen nicht
    // hinter einer langen Pause der alten Sitzung warten. Transfers melden diesen Auslöser nicht.
    this.detach(bot);
    // Den Abbruch sieht der Client zwar auch, aber `--on` kennt ihn nicht – also immer hier.
    for (const macro of this.macrosFor(bot, 'disconnect')) this.run(bot, macro);
  }

  // ------------------------------------------------------------ Ausführung

  /**
   * Darf dieses Macro jetzt laufen? Sperrzeit und Wahrscheinlichkeit, in dieser Reihenfolge.
   *
   * Erst die Sperrzeit, dann der Würfel: Andersherum verbrauchte ein ausgewürfeltes "nein" die
   * Sperrzeit nicht, und bei 50 % und 60 s Sperre liefe das Macro im Mittel doppelt so oft wie
   * beabsichtigt.
   */
  allowed(slot, macro) {
    const cooldown = Math.max(0, Number(macro.cooldown_sec) || 0) * 1000;
    if (cooldown) {
      const last = slot.lastRun.get(String(macro.id)) || 0;
      if (Date.now() - last < cooldown) return false;
    }
    const chance = macro.chance === null || macro.chance === undefined ? 100 : Number(macro.chance);
    if (chance < 100 && Math.random() * 100 >= chance) return false;
    slot.lastRun.set(String(macro.id), Date.now());
    return true;
  }

  /**
   * Ein Macro ausführen.
   *
   * `force` überspringt Sperrzeit und Würfel. Das ist der Knopf „Ausprobieren“ im Panel: Wer ihn
   * drückt, hat sich entschieden, und ein Macro, das daraufhin nichts tut, weil es vor acht Minuten
   * schon lief, sieht aus wie ein kaputtes Macro. Die beiden Zahlen gehören zum **Auslöser**, und
   * ein Klick ist keiner.
   */
  run(bot, macro, context = {}, { force = false } = {}) {
    const slot = this.slot(bot);
    const id = String(macro.id);
    // Steuer-Macros müssen eine laufende Pause sofort beenden können. Innerhalb einer
    // Beitrittsgruppe bleiben sie dagegen an ihrer konfigurierten Position in der Folge.
    let firstAction;
    try { firstAction = JSON.parse(macro.actions || '[]')[0]?.type; } catch { /* execute meldet den Fehler */ }
    if (!context.joining && ['stop_macros', 'disconnect', 'reconnect'].includes(firstAction)) this.cancel(slot);
    // Auch wartende Läufe zählen: ein Chat-/Zeit-Auslöser darf die Queue nicht auffüllen.
    if (slot.running.has(id) || (!force && !this.allowed(slot, macro))) {
      context.joining?.pending.delete(id);
      if (context.joining && !context.joining.pending.size) slot.joinContext = null;
      return Promise.resolve();
    }
    slot.running.add(id);
    const done = new Promise(resolve => slot.queue.push({ macro, context, resolve, generation: slot.generation }));
    this.drain(bot, slot);
    return done;
  }

  async drain(bot, slot) {
    if (slot.runner) return;
    const runner = { generation: slot.generation };
    slot.runner = runner;
    try {
      while (slot.runner === runner && slot.queue.length) {
        const entry = slot.queue.shift();
        try {
          await this.execute(bot, slot, entry);
        } finally {
          if (slot.generation === entry.generation) slot.running.delete(String(entry.macro.id));
          entry.resolve();
        }
      }
    } finally {
      // Ein alter, abgebrochener Ablauf darf den Runner des neuen Prozesslaufs nicht löschen.
      if (slot.runner === runner) slot.runner = null;
    }
  }

  async execute(bot, slot, { macro, context, generation }) {
    const active = () => bot.running && slot.generation === generation;
    context = { ...context, active, signal: slot.abort.signal };
    try {
      const delay = slot.readyAt - Date.now();
      if (delay > 0) await wait(delay, context.signal);
      if (!active()) return;
      context.joining?.started.add(String(macro.id));
      if (!context.quiet) bot.push('system', `Macro "${macro.name}" läuft.`);
      const actions = JSON.parse(macro.actions || '[]');
      for (const action of actions) {
        if (!active()) break;
        if (action.delay) await wait(Number(action.delay) * 1000, context.signal);
        if (!active()) break;
        await this.step(bot, action, context);
      }
    } catch (error) {
      if (active()) bot.push('error', `Macro "${macro.name}": ${error.message}`);
    } finally {
      if (active() && context.joining && slot.joinContext === context.joining) {
        context.joining.completed.add(String(macro.id));
        context.joining.pending.delete(String(macro.id));
        if (!context.joining.pending.size) slot.joinContext = null;
      }
    }
  }

  async step(bot, action, context) {
    const local = (verb, arg = '', need = 'movement') => bot.local(verb, arg, need, { confirm: true });
    switch (action.type) {
      case 'chat': {
        const text = fill(action.text, bot, context);
        if (text) await bot.send(text, { confirm: true });
        break;
      }
      case 'chat_random': {
        const lines = String(action.text || '')
          .split('|')
          .map((line) => line.trim())
          .filter(Boolean);
        if (!lines.length) break;
        const text = fill(lines[between(0, lines.length - 1)], bot, context);
        if (text) await bot.send(text, { confirm: true });
        break;
      }
      case 'wait':
        await wait(Math.min(3600, Math.max(1, Number(action.seconds) || 1)) * 1000, context.signal);
        break;
      case 'wait_random': {
        const low = Math.min(3600, Math.max(1, Number(action.min_seconds) || 1));
        // Eine obere Grenze unter der unteren ist kein Bereich – dann ist es eben eine feste Pause.
        const high = Math.min(3600, Math.max(low, Number(action.max_seconds) || low));
        await wait(between(low, high) * 1000, context.signal);
        break;
      }
      case 'move':
        await local('go', `${action.direction || 'vor'} ${Number(action.blocks) || 1}`);
        break;
      case 'look':
        await local('look', `${Number(action.yaw) || 0} ${Number(action.pitch) || 0}`);
        break;
      case 'face':
        await local('look', String(action.direction || 'nord'));
        break;
      case 'jump':
        // Ohne Richtung springt der Client auf der Stelle – dann darf auch kein Wort dahinterstehen.
        await local('jump', WALK.options.includes(action.direction) ? action.direction : '');
        break;
      case 'fall':
        await local('fall');
        break;
      case 'home':
        await local('home', HOME_MODES.includes(action.mode) ? action.mode : 'go');
        break;
      case 'route':
        await local('route', ROUTE_MODES.includes(action.mode) ? action.mode : 'go');
        break;
      case 'stop':
        await local('stop');
        break;
      case 'sneak':
        await local('sneak', switchArg(action.mode), 'sneak');
        break;
      case 'sprint':
        await local('sprint', switchArg(action.mode), 'sneak');
        break;
      case 'swing':
        await local('swing', '', 'sneak');
        break;
      case 'use':
        await local('use', '', 'sneak');
        break;
      case 'hand':
        await local('hand', String(Math.min(9, Math.max(1, Number(action.slot) || 1))), 'sneak');
        break;
      case 'click':
        await local('click', `${Number(action.slot) || 0}${action.button ? ` ${action.button}` : ''}`, 'menu');
        break;
      case 'close':
        await local('close', '', 'menu');
        break;
      case 'board_read':
        await local('board', '', 'board');
        break;
      case 'menu_read':
        await local('menu', '', 'menu');
        break;
      case 'inv_read':
        await local('inv', '', 'items');
        break;
      case 'slot_read':
        await local('slot', String(Math.min(100, Math.max(0, Number(action.slot) || 0))), 'items');
        break;
      case 'position':
        await local('pos', '', 'movement');
        break;
      case 'antiafk':
        await local(
          'antiafk',
          action.mode === 'seconds'
            ? String(Math.min(3600, Math.max(15, Number(action.seconds) || 60)))
            : action.mode === 'off'
              ? 'off'
              : 'on',
          'antiafk'
        );
        break;
      case 'pov':
        await local('pov', action.mode === 'stop' ? 'stop' : 'live', 'pov');
        break;
      case 'notify':
        notify.macroSaid(bot.userId, bot.profile.name, fill(action.text, bot, context));
        break;
      case 'reconnect': {
        // Der Supervisor hält den Wunsch auch dann, wenn der Client in der Pause endet.
        const pause = Math.min(600, Math.max(1, Number(action.seconds) || 5));
        supervisor.reconnect(bot.profile.id, bot.account.id, { delaySeconds: pause });
        this.cancel(this.slot(bot));
        break;
      }
      case 'disconnect':
        supervisor.stop(bot.profile.id, bot.account.id);
        break;
      case 'run':
        await this.runByName(bot, action.name, context);
        break;
      case 'stop_macros': {
        // Alle laufenden Abläufe dieses Bots hören beim nächsten Schritt auf – dieser hier
        // eingeschlossen. Das ist gewollt: „Brich alles ab“ meint auch sich selbst, und was
        // danach noch im Macro stünde, wäre eine Ausnahme, die niemand erwartet.
        this.cancel(this.slot(bot));
        break;
      }
      default:
        throw new Error(`Unbekannter Schritt: ${action.type}`);
    }
  }

  /**
   * Ein anderes Macro desselben Serverplatzes ausführen – nach Namen, nicht nach Nummer.
   *
   * Nach Namen, weil ein Mensch das schreibt und Namen im Editor stehen; eine Nummer wäre eine
   * Angabe, die niemand nachschlagen kann. Gibt es den Namen nicht, ist das ein Fehler im Ablauf
   * und wird als solcher gemeldet – nicht still übergangen.
   */
  async runByName(bot, name, context) {
    const wanted = String(name || '').trim();
    if (!wanted) return;
    const depth = (context.depth || 0) + 1;
    if (depth > MAX_DEPTH) {
      throw new Error(`Macros rufen sich zu tief auf (mehr als ${MAX_DEPTH}).`);
    }
    const macro = db
      .prepare('SELECT * FROM macros WHERE profile_id = ? AND name = ? AND enabled = 1')
      .get(bot.profile.id, wanted);
    if (!macro) throw new Error(`Macro "${wanted}" gibt es nicht (oder es ist aus).`);
    // **Sperrzeit und Würfel gelten hier nicht.** Wer ein Macro ausdrücklich aufruft, hat sich
    // schon entschieden; die beiden Zahlen gehören zum Auslöser und nicht zum Ablauf. Deshalb
    // nicht `run()`, sondern die Schritte selbst.
    const slot = this.slot(bot);
    const generation = slot.generation;
    for (const action of JSON.parse(macro.actions || '[]')) {
      if (!bot.running || slot.generation !== generation) break;
      if (action.delay) await wait(Number(action.delay) * 1000, context.signal);
      if (!bot.running || slot.generation !== generation || (context.active && !context.active())) break;
      await this.step(bot, action, { ...context, depth });
    }
  }
}

/** Die Betriebsarten von `:home` und `:route`, genau wie der Client sie in `:help` nennt. */
const HOME_MODES = ['go', 'set', 'on', 'off', 'clear', 'delay', 'speed'];
const ROUTE_MODES = ['go', 'rec', 'stop', 'add', 'del', 'clear'];

/** `:sneak` und `:sprint` nehmen `on`, `off` – oder nichts, und das heißt beim Client "umschalten". */
const switchArg = (mode) => (mode === 'on' || mode === 'off' ? mode : '');

const wait = (ms, signal) => new Promise(resolve => {
  if (signal?.aborted) return resolve();
  const finish = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', finish);
    resolve();
  };
  const timer = setTimeout(finish, ms);
  signal?.addEventListener('abort', finish, { once: true });
});

/** Ein Feld in einer Sprache, so wie das Frontend es braucht. */
const fieldFor = (field, key) => ({
  key: field.key,
  label: field[key],
  type: field.type,
  min: field.min,
  max: field.max,
  options: field.options,
  option_labels: field.labels?.[key] || field.options,
  hint: field[`hint_${key}`] || '',
});

/** ACTIONS/EVENTS in einer Sprache, wie das Frontend sie braucht. */
export function actionsFor(lang = 'de') {
  const key = lang === 'en' ? 'en' : 'de';
  return ACTIONS.map((action) => ({
    type: action.type,
    label: action[key],
    needs: action.needs || null,
    fields: (action.fields || []).map((field) => fieldFor(field, key)),
  }));
}

export function eventsFor(lang = 'de') {
  const key = lang === 'en' ? 'en' : 'de';
  return EVENTS.map((event) => ({
    type: event.type,
    label: event[key],
    config: (event.config || []).map((field) => fieldFor(field, key)),
  }));
}

export const EVENT_TYPES = EVENTS.map((event) => event.type);

export const macros = new MacroEngine();
supervisor.macros = macros;
