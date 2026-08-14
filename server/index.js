// Einstiegspunkt: HTTP, WebSocket, Abrechnungstakt, Aufräumarbeiten.

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { config, paths } from './config.js';
import { db, getSetting } from './db.js';
import * as auth from './auth.js';
import { supervisor } from './supervisor.js';
import './macros.js'; // hängt die Macro-Engine in den Supervisor
import * as binaries from './binaries.js';
import * as credits from './credits.js';
import * as notify from './notify.js';
import { router as coreRouter } from './routes/core.js';
import { router as profilesRouter } from './routes/profiles.js';
import { router as billingRouter, admin as adminRouter, stripeWebhook } from './routes/billing.js';
import { HttpError } from './util.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Der Stripe-Webhook braucht den Rohtext für die Signatur – deshalb vor dem JSON-Parser.
app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), stripeWebhook);

app.use(express.json({ limit: '256kb' }));
app.use(auth.attachUser);

app.use('/api', coreRouter);
app.use('/api', billingRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/admin', adminRouter);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    bots: supervisor.runningCount(),
    client: binaries.state.clientVersion,
  });
});

// ---------------------------------------------------------------- Frontend

app.use(
  express.static(paths.public, {
    index: 'index.html',
    maxAge: '1h',
    setHeaders(res, file) {
      if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// Das Dashboard ist eine Seite mit eigenem Router – jede Unteradresse liefert dieselbe Datei.
app.get(/^\/app(\/.*)?$/, (req, res) => {
  res.sendFile(path.join(paths.public, 'app.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Unbekannter Endpunkt.' });
  res.status(404).sendFile(path.join(paths.public, '404.html'));
});

// ---------------------------------------------------------------- Fehler

app.use((error, req, res, _next) => {
  const status = error instanceof HttpError ? error.status : error.status || 500;
  if (status >= 500) console.error('[fehler]', req.method, req.path, error);
  res.status(status).json({ error: error.message || 'Unerwarteter Fehler.', code: error.code || null });
});

// ---------------------------------------------------------------- WebSocket

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

/** user_id -> Menge offener Verbindungen. */
const sockets = new Map();

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/api/ws')) return socket.destroy();
  const value = auth.readCookie(req, 'afk_session');
  const row = value
    ? db
        .prepare(
          `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token = ? AND s.expires_at > ?`
        )
        .get(value, Date.now())
    : null;
  if (!row || row.blocked) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = row.id;
    ws.isAlive = true;
    if (!sockets.has(row.id)) sockets.set(row.id, new Set());
    sockets.get(row.id).add(ws);
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', bots: supervisor.list(ws.userId) }));
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.on('message', (data) => {
    // Der einzige Weg vom Browser hierher ist ein Ping – alles andere geht über die REST-API.
    try {
      if (JSON.parse(data).type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
    } catch {
      /* egal */
    }
  });
  ws.on('close', () => {
    sockets.get(ws.userId)?.delete(ws);
  });
});

function push(userId, message) {
  const set = sockets.get(userId);
  if (!set?.size) return;
  const text = JSON.stringify(message);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(text);
  }
}

supervisor.on('bot-line', ({ userId, key, entry }) => push(userId, { type: 'line', key, entry }));
supervisor.on('bot-state', ({ userId, key, state }) => push(userId, { type: 'state', key, state }));

// Tote Verbindungen alle 30 s aussortieren.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

// ---------------------------------------------------------------- Abrechnung

// Jede Minute: für jeden laufenden Bot abbuchen. Wer nichts mehr hat, dessen Bots gehen aus.
setInterval(() => {
  const usage = supervisor.usage();
  if (!usage.size) return;
  const empty = credits.meterTick(usage, 1);

  for (const [userId, bots] of usage) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) continue;
    const low = Number(getSetting('low_balance_mcr'));
    if (user.credits_mcr > 0 && user.credits_mcr <= low) {
      notify.lowBalance(userId, user.credits_mcr, credits.runtimeHours(user, bots));
    }
  }

  for (const entry of empty) {
    supervisor.stopUser(entry.userId, 'Guthaben aufgebraucht – Bots gestoppt.');
    notify.outOfCredits(entry.userId);
    push(entry.userId, { type: 'credits', balance_mcr: entry.balance, stopped: true });
  }

  // Kontostand im Browser aktuell halten.
  for (const [userId] of usage) {
    const user = db.prepare('SELECT credits_mcr FROM users WHERE id = ?').get(userId);
    if (user) push(userId, { type: 'credits', balance_mcr: user.credits_mcr });
  }
}, 60_000).unref();

// Stündlich: abgelaufene Sitzungen weg, Client-Release nachsehen.
setInterval(() => {
  auth.cleanupSessions();
  binaries.sync().catch(() => {});
}, 3_600_000).unref();

// ---------------------------------------------------------------- Start

const started = async () => {
  await binaries.sync();
  const restored = supervisor.restoreAll();
  server.listen(config.port, config.host, () => {
    console.log(
      `${config.brand}-Panel läuft auf http://${config.host}:${config.port} ` +
        `(Client ${binaries.state.clientVersion || '?'}, Versionen: ${binaries.state.versions.join(', ') || '–'})`
    );
    if (restored) console.log(`${restored} Bot(s) aus dem letzten Lauf wieder gestartet.`);
    if (binaries.state.error) console.warn(`Hinweis zum Client: ${binaries.state.error}`);
  });
};

started();

// Beim Beenden alle Client-Prozesse ordentlich mitnehmen.
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (closing) process.exit(0);
    closing = true;
    console.log('Beende – stoppe alle Bots ...');
    supervisor.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
