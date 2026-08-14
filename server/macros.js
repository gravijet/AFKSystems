// Macros und Spam: was auf ein Ereignis hin passieren soll.
//
// Ein Macro besteht aus einem Auslöser (Beitritt, Zeittakt, Chatzeile, Tod, Verbindungsabbruch) und
// einer Kette von Schritten, die der Reihe nach laufen. Getaktet wird hier im Panel statt im
// Client, damit eine Änderung sofort greift, ohne den Bot neu zu starten – nur der einfachste Fall
// (reine Chatzeilen ohne Wartezeit) wandert beim Start als `--cmd` in den Client, weil der das
// zuverlässiger direkt nach dem Beitritt schickt.
//
// Welche Schritte es gibt, richtet sich danach, was der Client kann: Chat/Befehl und Warten immer,
// Bewegung nur in der Bewegungs-Bauform. Schritte, die der Client nicht kann (Inventar, Blöcke,
// Schlagen), gibt es hier bewusst nicht – sie stünden sonst im Panel und täten nichts.

import { db } from './db.js';
import * as binaries from './binaries.js';
import { supervisor } from './supervisor.js';

/** Alle Schritte, die das Panel ausführen kann. Das Frontend baut daraus seine Auswahl. */
export const ACTIONS = [
  { type: 'chat', label: 'Chat / Befehl', fields: [{ key: 'text', label: 'Text', type: 'text' }] },
  {
    type: 'wait',
    label: 'Warten',
    fields: [{ key: 'seconds', label: 'Sekunden', type: 'number', min: 1, max: 3600 }],
  },
  {
    type: 'move',
    label: 'Gehen',
    needs: 'movement',
    fields: [
      {
        key: 'direction',
        label: 'Richtung',
        type: 'select',
        options: ['vor', 'zurück', 'links', 'rechts'],
      },
      { key: 'blocks', label: 'Blöcke', type: 'number', min: 1, max: 64 },
    ],
  },
  {
    type: 'look',
    label: 'Blickrichtung',
    needs: 'movement',
    fields: [
      { key: 'yaw', label: 'Links/Rechts (Yaw)', type: 'number', min: -180, max: 180 },
      { key: 'pitch', label: 'Hoch/Runter (Pitch)', type: 'number', min: -90, max: 90 },
    ],
  },
  { type: 'jump', label: 'Springen', needs: 'movement', fields: [] },
  { type: 'home', label: 'Nach Hause laufen', needs: 'movement', fields: [] },
  { type: 'stop', label: 'Bewegung stoppen', needs: 'movement', fields: [] },
  { type: 'disconnect', label: 'Trennen', fields: [] },
];

export const EVENTS = [
  { type: 'join', label: 'Beim Beitritt', config: [] },
  {
    type: 'timer',
    label: 'Im Zeittakt',
    config: [{ key: 'interval_sec', label: 'Alle … Sekunden', type: 'number', min: 5, max: 86400 }],
  },
  {
    type: 'chat',
    label: 'Bei Chat-Nachricht',
    config: [
      { key: 'contains', label: 'Enthält Text', type: 'text' },
      { key: 'regex', label: 'oder regulärer Ausdruck', type: 'text' },
    ],
  },
  {
    type: 'world',
    label: 'Bei Weltwechsel (Unterserver)',
    config: [],
  },
  { type: 'death', label: 'Bei Tod', config: [] },
  { type: 'disconnect', label: 'Bei Verbindungsabbruch', config: [] },
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
      const config = JSON.parse(macro.config || '{}');
      const seconds = Math.max(5, Number(config.interval_sec) || 300);
      // Die einfachen Fälle laufen schon im Client (--cmd 300:/afk) – hier nur der Rest.
      if (this.handledByClient(macro)) continue;
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
   * Anti-AFK: gegen Server, die zusätzlich zum Zeitüberschreitungs-Kick auf Bewegung prüfen.
   * Der Befehl-Takt geht immer; Umsehen, Springen und Laufen nur mit der Bewegungs-Bauform.
   * Damit nicht alle Bots im selben Moment zappeln, bekommt jeder einen eigenen Versatz.
   */
  attachAntiAfk(bot, slot) {
    let settings;
    try {
      settings = JSON.parse(bot.profile.anti_afk || '{}');
    } catch {
      return;
    }
    const seconds = Math.min(3600, Math.max(30, Number(settings.interval_sec) || 240));
    const movement = binaries.supportsMovement(bot.profile);
    const steps = [];

    if (settings.command && settings.command_text) {
      steps.push(() => bot.send(String(settings.command_text)));
    }
    if (movement && settings.look) {
      // Ein kleiner Schwenk hin und zurück – kein Kreiseln, das auffiele.
      let flip = false;
      steps.push(() => {
        bot.move('look', flip ? 'links 25' : 'rechts 25');
        flip = !flip;
      });
    }
    if (movement && settings.jump) steps.push(() => bot.move('jump'));
    if (movement && settings.walk) {
      let forward = true;
      steps.push(() => {
        bot.move('go', forward ? 'vor 1' : 'zurück 1');
        forward = !forward;
      });
    }
    if (!steps.length) return;

    let index = 0;
    const timer = setInterval(() => {
      if (!bot.online) return;
      try {
        steps[index % steps.length]();
      } catch {
        /* Bot gerade weg */
      }
      index += 1;
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

  /** Nach dem Ändern von Macros/Spam die Takte eines Profils neu aufziehen. */
  reload(profileId) {
    for (const bot of supervisor.bots.values()) {
      if (bot.profile.id !== profileId) continue;
      if (bot.running) this.attach(bot);
    }
  }

  handledByClient(macro) {
    const actions = JSON.parse(macro.actions || '[]');
    return actions.length > 0 && actions.every((action) => action.type === 'chat' && !action.delay);
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
      if (this.handledByClient(macro)) continue; // erledigt der Client per --cmd
      this.run(bot, macro);
    }
  }

  onChat(bot, line) {
    const macros = this.macrosFor(bot, 'chat');
    if (!macros.length) return;
    for (const macro of macros) {
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

  /**
   * Wechsel auf einen Unterserver. Anders als beim Beitritt schickt der Client hier nichts von
   * selbst – die Befehle kommen also immer aus dem Panel, auch die einfachen.
   */
  onWorldChange(bot) {
    for (const macro of this.macrosFor(bot, 'world')) this.run(bot, macro);
  }

  onDeath(bot) {
    for (const macro of this.macrosFor(bot, 'death')) this.run(bot, macro);
  }

  onDisconnect(bot) {
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
    const movement = binaries.supportsMovement(bot.profile);
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
        if (!movement) throw new Error('Bewegung ist für dieses Profil nicht aktiv.');
        bot.move('go', `${action.direction || 'vor'} ${Number(action.blocks) || 1}`);
        break;
      case 'look':
        if (!movement) throw new Error('Bewegung ist für dieses Profil nicht aktiv.');
        bot.move('look', `${Number(action.yaw) || 0} ${Number(action.pitch) || 0}`);
        break;
      case 'jump':
        if (!movement) throw new Error('Bewegung ist für dieses Profil nicht aktiv.');
        bot.move('jump');
        break;
      case 'home':
        if (!movement) throw new Error('Bewegung ist für dieses Profil nicht aktiv.');
        bot.move('home', 'go');
        break;
      case 'stop':
        if (!movement) throw new Error('Bewegung ist für dieses Profil nicht aktiv.');
        bot.move('stop');
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

export const macros = new MacroEngine();
supervisor.macros = macros;
