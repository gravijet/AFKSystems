// Die Leitung zum Panel.
//
// Zwei Wege: gewöhnliche Aufrufe für alles, was der Bot wissen oder melden will, und eine
// WebSocket-Verbindung, über die das Panel von sich aus meldet, wenn dort etwas passiert. Beides
// nutzt dasselbe Geheimnis; ohne das läuft nichts, und das ist Absicht.
//
// Die Verbindung darf abreißen, ohne dass der Bot etwas verliert: jedes Ereignis hat eine
// laufende Nummer, und nach dem Wiederverbinden fragt er nach, was seitdem war.

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

export class Panel extends EventEmitter {
  constructor({ url, secret }) {
    super();
    this.url = String(url || '').replace(/\/+$/, '');
    this.secret = secret;
    this.socket = null;
    this.seq = 0;
    this.retry = 0;
    this.closing = false;
  }

  get headers() {
    return {
      authorization: `Bearer ${this.secret}`,
      'content-type': 'application/json',
      // Discords primary language is English, including errors relayed to interactions and logs.
      'accept-language': 'en',
    };
  }

  async call(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${this.url}/api/bot${path}`, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text.slice(0, 200) };
    }
    if (!response.ok) {
      const error = new Error(data.error || `Panel responded with ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  /**
   * Eine Datei beim Panel abholen – Anhänge eines Tickets.
   *
   * Bewusst nicht über `call()`: dort kommt JSON zurück, hier sind es Bytes. Zeit bekommt der
   * Abruf mehr als ein gewöhnlicher Aufruf, denn 20 MB brauchen mehr als eine Sekunde.
   */
  async download(path) {
    const response = await fetch(`${this.url}/api/bot${path}`, {
      headers: { authorization: `Bearer ${this.secret}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Panel responded with ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  /** Die Verbindung offen halten. Bricht sie ab, wird sie mit wachsender Pause neu aufgebaut. */
  connect() {
    if (this.closing) return;
    const address = `${this.url.replace(/^http/, 'ws')}/api/bot/stream`;
    this.socket = new WebSocket(address, { headers: { authorization: `Bearer ${this.secret}` } });

    this.socket.on('open', async () => {
      this.retry = 0;
      console.log('[panel] connected');
      // Was während der Unterbrechung passiert ist, nachholen – sonst fehlte in Discord genau
      // die eine Antwort, die währenddessen geschrieben wurde.
      if (this.seq) {
        try {
          const missed = await this.call(`/events?since=${this.seq}`);
          for (const event of missed.events || []) this.handle(event);
        } catch (error) {
          console.warn('[panel] event recovery failed:', error.message);
        }
      }
      this.emit('ready');
    });

    this.socket.on('message', (raw) => {
      try {
        this.handle(JSON.parse(raw));
      } catch {
        /* keine gültige Nachricht – ignorieren */
      }
    });

    this.socket.on('close', () => {
      if (this.closing) return;
      this.retry += 1;
      const wait = Math.min(60_000, 2000 * 2 ** Math.min(this.retry, 5));
      console.warn(`[panel] connection lost – retrying in ${Math.round(wait / 1000)} s`);
      setTimeout(() => this.connect(), wait).unref?.();
    });

    this.socket.on('error', (error) => {
      const hint = /Unexpected server response: 404/.test(error.message)
        ? ' (the reverse proxy must pass WebSocket upgrades for /api/bot/stream)'
        : '';
      console.warn('[panel] error:', `${error.message}${hint}`);
    });
  }

  handle(message) {
    if (message.seq) this.seq = Math.max(this.seq, message.seq);
    if (message.type && message.type !== 'hello') this.emit(message.type, message);
  }

  close() {
    this.closing = true;
    this.socket?.close();
  }
}
