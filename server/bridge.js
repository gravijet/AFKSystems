// Die Leitung zwischen Panel und Discord-Bot.
//
// Der Bot ist ein eigener Prozess (bot/) und darf irgendwo laufen – heute neben dem Panel, später
// in einem Panel wie Featherpanel. Er hält eine WebSocket-Verbindung hierher offen und bekommt
// darüber alles, was in Discord nachgezogen werden muss: ein neues Ticket, eine Antwort, ein
// geänderter Zustand, eine Rolle, die jemand bekommen oder verlieren soll.
//
// In die andere Richtung – Discord sagt dem Panel etwas – geht es über gewöhnliche Aufrufe an
// /api/bot (siehe routes/bot.js). Beides zusammen ergibt den Abgleich in beide Richtungen: Wer
// hier ein Ticket aufmacht, bekommt dort einen Kanal, und wer dort schreibt, steht hier im
// Verlauf.
//
// Dieses Modul kennt weder Tickets noch Rollen. Es hält nur die Verbindungen und verteilt, was
// ihm gegeben wird – sonst hinge am Ende jedes Modul an jedem anderen.

import { EventEmitter } from 'node:events';

class Bridge extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    /** Offene Bot-Verbindungen. Mehr als eine ist erlaubt (Neustart mit Überlappung). */
    this.sockets = new Set();
    /** Die letzten Ereignisse, damit ein Bot nach einem kurzen Aussetzer nichts verpasst. */
    this.recent = [];
    this.sequence = 0;

    // Alles, was hier emittiert wird, geht auch an die Bots – ein zweiter Aufruf je Ereignis wäre
    // eine Fehlerquelle, die niemand braucht.
    this.on('newListener', () => {});
  }

  get connected() {
    return this.sockets.size;
  }

  add(socket) {
    this.sockets.add(socket);
  }

  remove(socket) {
    this.sockets.delete(socket);
  }

  /**
   * Ein Ereignis verteilen. Es geht an alle verbundenen Bots und landet zusätzlich im kurzen
   * Gedächtnis, damit ein Bot, der gerade neu startet, die letzten Sekunden nachholen kann.
   */
  emit(type, payload) {
    if (type === 'newListener' || type === 'removeListener') return super.emit(type, payload);
    const message = { seq: ++this.sequence, type, at: Date.now(), ...payload };
    this.recent.push(message);
    if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);
    const text = JSON.stringify(message);
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(text);
    }
    return super.emit(type, message);
  }

  /** Was seit `seq` passiert ist – für den Bot beim Verbinden. */
  since(seq = 0) {
    return this.recent.filter((entry) => entry.seq > Number(seq || 0));
  }
}

export const bridge = new Bridge();
