// Macros und Spam: was auf ein Ereignis hin passieren soll.
//
// Ein Macro besteht aus einem Auslöser (Beitritt, Zeittakt, Chatzeile, Weltwechsel, Tod,
// Verbindungsabbruch) und einer Kette von Schritten, die der Reihe nach laufen.
//
// Wer taktet, hängt davon ab, wer es besser kann:
//   * Der **Client** bekommt beim Start alles, was er selbst im Protokoll sieht und ohne Zutun
//     abarbeiten kann – Beitrittsbefehle, Wiederholungen, und mit `--on` auch Weltwechsel, Tod
//     und einfache Chat-Treffer. Das überlebt jeden Reconnect ohne Zutun des Panels.
//   * Das **Panel** taktet alles, was sich zur Laufzeit ändern soll oder mehr als eine Chatzeile
//     ist: Wartezeiten, Bewegung, reguläre Ausdrücke, Spam.
//
// Welche Schritte es gibt, richtet sich danach, was die Bauform des Bots kann. Schritte, die kein
// Client beherrscht (Blöcke abbauen, schlagen), gibt es hier bewusst nicht.

import { db } from './db.js';
import { supervisor, simpleChatMacro } from './supervisor.js';

/** Alle Schritte, die das Panel ausführen kann. Das Frontend baut daraus seine Auswahl. */
export const ACTIONS = [
  {
    type: 'chat',
    de: 'Chat / Befehl',
    en: 'Chat / command',
    fields: [{ key: 'text', de: 'Text', en: 'Text', type: 'text' }],
  },
  {
    type: 'wait',
    de: 'Warten',
    en: 'Wait',
    fields: [{ key: 'seconds', de: 'Sekunden', en: 'Seconds', type: 'number', min: 1, max: 3600 }],
  },
  {
    type: 'move',
    de: 'Gehen',
    en: 'Walk',
    needs: 'movement',
    fields: [
      {
        key: 'direction',
        de: 'Richtung',
        en: 'Direction',
        type: 'select',
        options: ['vor', 'zurück', 'links', 'rechts'],
        labels: { de: ['vor', 'zurück', 'links', 'rechts'], en: ['forward', 'back', 'left', 'right'] },
      },
      { key: 'blocks', de: 'Blöcke', en: 'Blocks', type: 'number', min: 1, max: 64 },
    ],
  },
  {
    type: 'look',
    de: 'Blickrichtung',
    en: 'Look direction',
    needs: 'movement',
    fields: [
      { key: 'yaw', de: 'Links/Rechts (Yaw)', en: 'Left/right (yaw)', type: 'number', min: -180, max: 180 },
      { key: 'pitch', de: 'Hoch/Runter (Pitch)', en: 'Up/down (pitch)', type: 'number', min: -90, max: 90 },
    ],
  },
  { type: 'jump', de: 'Springen', en: 'Jump', needs: 'movement', fields: [] },
  { type: 'home', de: 'Nach Hause laufen', en: 'Walk home', needs: 'movement', fields: [] },
  { type: 'stop', de: 'Bewegung stoppen', en: 'Stop moving', needs: 'movement', fields: [] },
  { type: 'sneak', de: 'Schleichen an/aus', en: 'Toggle sneak', needs: 'sneak', fields: [] },
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
  { type: 'disconnect', de: 'Trennen', en: 'Disconnect', fields: [] },
];

export const EVENTS = [
  { type: 'join', de: 'Beim Beitritt', en: 'On join', config: [] },
  {
    type: 'timer',
    de: 'Im Zeittakt',
    en: 'On a timer',
    config: [
      { key: 'interval_sec', de: 'Alle … Sekunden', en: 'Every … seconds', type: 'number', min: 5, max: 86400 },
    ],
  },
  {
    type: 'chat',
    de: 'Bei Chat-Nachricht',
    en: 'On chat message',
    config: [
      { key: 'contains', de: 'Enthält Text', en: 'Contains text', type: 'text' },
      { key: 'regex', de: 'oder regulärer Ausdruck', en: 'or regular expression', type: 'text' },
    ],
  },
  { type: 'world', de: 'Bei Weltwechsel', en: 'On world change', config: [] },
  { type: 'death', de: 'Bei Tod', en: 'On death', config: [] },
  { type: 'disconnect', de: 'Bei Verbindungsabbruch', en: 'On disconnect', config: [] },
];

class MacroEngine {
  constructor() {
    // key -> { timers: Set<Timeout>, running: Set<string> }
    this.state = new Map();
  }

  slot(bot) {
    if (!this.state.has(bot.key)) this.state.set(bot.key, { timers: new Set(), running: new Set() });
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
      const timer = setInterval(() => {
        if (bot.online) this.run(bot, macro);
      }, seconds * 1000);
      timer.unref();
      slot.timers.add(timer);
    }

    for (const entry of this.spamFor(bot)) {
      const seconds = Math.max(5, entry.interval_sec);
      const timer = setInterval(() => {
        if (bot.online) {
          try {
            bot.send(entry.message);
          } catch {
            /* Bot gerade weg */
          }
        }
      }, seconds * 1000);
      timer.unref();
      slot.timers.add(timer);
    }

    this.attachAntiAfk(bot, slot);
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
      if (!bot.online) return;
      try {
        bot.send(String(settings.command_text));
      } catch {
        /* Bot gerade weg */
      }
    }, seconds * 1000);
    timer.unref();
    slot.timers.add(timer);
  }

  detach(bot) {
    const slot = this.state.get(bot.key);
    if (!slot) return;
    for (const timer of slot.timers) clearInterval(timer);
    slot.timers.clear();
  }

  /** Nach dem Ändern von Macros/Spam die Takte eines Serverplatzes neu aufziehen. */
  reload(profileId) {
    for (const bot of supervisor.bots.values()) {
      if (bot.profile.id !== profileId) continue;
      if (bot.running) this.attach(bot);
    }
  }

  /**
   * Erledigt das schon der Client? Beitritt und Zeittakt immer (über `--cmd`), Weltwechsel, Tod
   * und einfache Chat-Treffer nur, wenn seine Bauform `--on` versteht.
   */
  handledByClient(bot, macro) {
    const actions = JSON.parse(macro.actions || '[]');
    if (!simpleChatMacro(actions)) return false;
    if (macro.event === 'join' || macro.event === 'timer') return true;
    if (!bot.caps.macros) return false;
    if (macro.event === 'world' || macro.event === 'death') return true;
    if (macro.event === 'chat') {
      const config = JSON.parse(macro.config || '{}');
      return Boolean(config.contains && !config.regex);
    }
    return false;
  }

  macrosFor(bot, event) {
    return db
      .prepare('SELECT * FROM macros WHERE profile_id = ? AND event = ? AND enabled = 1')
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

  onJoin(bot) {
    this.attach(bot);
    for (const macro of this.macrosFor(bot, 'join')) {
      if (this.handledByClient(bot, macro)) continue;
      this.run(bot, macro);
    }
  }

  onChat(bot, line) {
    const macros = this.macrosFor(bot, 'chat');
    if (!macros.length) return;
    for (const macro of macros) {
      if (this.handledByClient(bot, macro)) continue;
      const config = JSON.parse(macro.config || '{}');
      let hit = false;
      if (config.contains) hit = line.toLowerCase().includes(String(config.contains).toLowerCase());
      if (!hit && config.regex) {
        try {
          hit = new RegExp(config.regex, 'i').test(line);
        } catch {
          hit = false;
        }
      }
      if (hit) this.run(bot, macro, { line });
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

  onDisconnect(bot) {
    // Den Abbruch sieht der Client zwar auch, aber `--on` kennt ihn nicht – also immer hier.
    for (const macro of this.macrosFor(bot, 'disconnect')) this.run(bot, macro);
  }

  // ------------------------------------------------------------ Ausführung

  async run(bot, macro, context = {}) {
    const slot = this.slot(bot);
    // Ein Macro läuft nie zweimal gleichzeitig – sonst überholen sich Wartezeiten.
    if (slot.running.has(String(macro.id))) return;
    slot.running.add(String(macro.id));
    bot.push('system', `Macro "${macro.name}" läuft.`);

    try {
      const actions = JSON.parse(macro.actions || '[]');
      for (const action of actions) {
        if (!bot.running) break;
        if (action.delay) await wait(Number(action.delay) * 1000);
        await this.step(bot, action, context);
      }
    } catch (error) {
      bot.push('error', `Macro "${macro.name}": ${error.message}`);
    } finally {
      slot.running.delete(String(macro.id));
    }
  }

  async step(bot, action, context) {
    switch (action.type) {
      case 'chat': {
        const text = String(action.text || '').replace(/\{line\}/g, context.line || '');
        if (text) bot.send(text);
        break;
      }
      case 'wait':
        await wait(Math.min(3600, Math.max(1, Number(action.seconds) || 1)) * 1000);
        break;
      case 'move':
        bot.local('go', `${action.direction || 'vor'} ${Number(action.blocks) || 1}`);
        break;
      case 'look':
        bot.local('look', `${Number(action.yaw) || 0} ${Number(action.pitch) || 0}`);
        break;
      case 'jump':
        bot.local('jump');
        break;
      case 'home':
        bot.local('home', 'go');
        break;
      case 'stop':
        bot.local('stop');
        break;
      case 'sneak':
        bot.local('sneak', '', 'sneak');
        break;
      case 'swing':
        bot.local('swing', '', 'sneak');
        break;
      case 'use':
        bot.local('use', '', 'sneak');
        break;
      case 'hand':
        bot.local('hand', String(Math.min(9, Math.max(1, Number(action.slot) || 1))), 'sneak');
        break;
      case 'click':
        bot.local('click', `${Number(action.slot) || 0}${action.button ? ` ${action.button}` : ''}`, 'menu');
        break;
      case 'close':
        bot.local('close', '', 'menu');
        break;
      case 'disconnect':
        supervisor.stop(bot.profile.id, bot.account.id);
        break;
      default:
        throw new Error(`Unbekannter Schritt: ${action.type}`);
    }
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** ACTIONS/EVENTS in einer Sprache, wie das Frontend sie braucht. */
export function actionsFor(lang = 'de') {
  const key = lang === 'en' ? 'en' : 'de';
  return ACTIONS.map((action) => ({
    type: action.type,
    label: action[key],
    needs: action.needs || null,
    fields: (action.fields || []).map((field) => ({
      key: field.key,
      label: field[key],
      type: field.type,
      min: field.min,
      max: field.max,
      options: field.options,
      option_labels: field.labels?.[key] || field.options,
    })),
  }));
}

export function eventsFor(lang = 'de') {
  const key = lang === 'en' ? 'en' : 'de';
  return EVENTS.map((event) => ({
    type: event.type,
    label: event[key],
    config: (event.config || []).map((field) => ({
      key: field.key,
      label: field[key],
      type: field.type,
      min: field.min,
      max: field.max,
    })),
  }));
}

export const EVENT_TYPES = EVENTS.map((event) => event.type);

export const macros = new MacroEngine();
supervisor.macros = macros;
