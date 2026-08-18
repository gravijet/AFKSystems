// Einstiegspunkt: HTTP, die Seiten in zwei Sprachen, WebSocket, Verlängerungen, Aufräumarbeiten.

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { assetVersion, config, paths } from './config.js';
import { db, getSetting } from './db.js';
import * as auth from './auth.js';
import { supervisor } from './supervisor.js';
import './macros.js'; // hängt die Macro-Engine in den Supervisor
import * as binaries from './binaries.js';
import * as billing from './billing.js';
import * as roles from './roles.js';
import * as notify from './notify.js';
import * as mail from './mail.js';
import * as metrics from './metrics.js';
import * as nodes from './nodes.js';
import * as pages from './pages.js';
import * as protect from './protect.js';
import * as landing from './landing.js';
import * as tickets from './tickets.js';
import * as attachments from './attachments.js';
import { bridge } from './bridge.js';
import { router as coreRouter } from './routes/core.js';
import { router as profilesRouter } from './routes/profiles.js';
import { router as billingRouter, tebexWebhook } from './routes/billing.js';
import { admin as adminRouter } from './routes/admin.js';
import { router as botRouter, checkSecret } from './routes/bot.js';
import { router as nodeRouter, nodeByToken } from './routes/node.js';
import * as agents from './agents.js';
import { HttpError } from './util.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const websocketOrigin = config.publicUrl.replace(/^http/, 'ws');
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // Minecraft-Köpfe kommen von Minotar. Ohne diese explizite, eng begrenzte Ausnahme blockiert
  // der Browser sie trotz korrekter API-Antwort mit der Content-Security-Policy.
  "img-src 'self' data: https://minotar.net",
  "font-src 'self'",
  `connect-src 'self' ${websocketOrigin}`,
  "media-src 'none'",
  "manifest-src 'self'",
].join('; ');

/** Browser-Härtung für Website, Panel und auch Fehlerantworten. */
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (req.path.startsWith('/api/') || /^\/(en|de)\/app(?:\/|$)/.test(req.path)) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

function allowedOrigins(req) {
  const origins = new Set([new URL(config.publicUrl).origin]);
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const protocol = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http'))
    .split(',')[0]
    .trim();
  if (host && /^(https?|wss?)$/.test(protocol)) origins.add(`${protocol.replace(/^ws/, 'http')}://${host}`);
  return origins;
}

function trustedOrigin(req) {
  const origin = String(req.headers.origin || '');
  return Boolean(origin && allowedOrigins(req).has(origin));
}

// Der Tebex-Webhook braucht den **rohen** Rumpf für die Unterschrift – deshalb steht er vor dem
// JSON-Parser. Aus wieder eingesetztem JSON käme ein anderer Hash heraus, und keine echte
// Zahlungsmeldung käme je durch.
app.post('/api/tebex/webhook', express.raw({ type: '*/*', limit: '1mb' }), tebexWebhook);

// Browser dürfen schreibende API-Anfragen nur aus derselben Website schicken. Dienst-zu-Dienst-
// Aufrufe (Discord-Bot, Tebex, Standorte) tragen keinen Browser-Origin und haben eigene
// Unterschriften bzw. Token.
app.use('/api', (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    return next(new HttpError(403, 'Anfrage von einer fremden Website abgelehnt.', { en: 'Cross-site request rejected.' }));
  }
  if (req.headers.origin && !trustedOrigin(req)) {
    return next(new HttpError(403, 'Anfrage von einer fremden Website abgelehnt.', { en: 'Cross-site request rejected.' }));
  }
  next();
});

// Anmeldung und Wiederherstellung sind absichtlich teure Vorgänge. Ein kleines, lokales Fenster
// bremst Passwort-Raten und verhindert, dass fremde Websites den Prozess als CPU-DoS missbrauchen.
const authAttempts = new Map();
const AUTH_WINDOW_MS = 15 * 60_000;
const AUTH_MAX = 30;
app.use('/api/auth', (req, _res, next) => {
  if (req.method !== 'POST') return next();
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  const recent = (authAttempts.get(key) || []).filter((at) => now - at < AUTH_WINDOW_MS);
  if (recent.length >= AUTH_MAX) {
    return next(new HttpError(429, 'Zu viele Versuche. Bitte später erneut versuchen.', {
      en: 'Too many attempts. Please try again later.',
    }));
  }
  recent.push(now);
  authAttempts.set(key, recent);
  if (authAttempts.size > 5_000) {
    for (const [entry, times] of authAttempts) {
      if (!times.some((at) => now - at < AUTH_WINDOW_MS)) authAttempts.delete(entry);
    }
  }
  next();
});

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser);
app.use(auth.attachUser);

app.use('/api', coreRouter);
app.use('/api', billingRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/bot', botRouter);
// Die Standorte holen sich hier ihre Client-Dateien – mit ihrem Token, nicht mit einer Sitzung.
app.use('/api/node', nodeRouter);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    bots: supervisor.runningCount(),
    client: binaries.state.clientVersion,
  });
});

/** Winziger Cookie-Setzer, damit `res.cookie` ohne cookie-parser funktioniert. */
function cookieParser(req, res, next) {
  res.cookie = (name, value, options = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    parts.push(`Path=${options.path || '/'}`);
    if (options.maxAge) parts.push(`Max-Age=${Math.round(options.maxAge / 1000)}`);
    if (options.httpOnly) parts.push('HttpOnly');
    if (options.secure) parts.push('Secure');
    parts.push(`SameSite=${options.sameSite === 'lax' ? 'Lax' : options.sameSite || 'Lax'}`);
    const existing = res.getHeader('Set-Cookie');
    const list = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
    res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
    return res;
  };
  res.clearCookie = (name, options = {}) =>
    res.cookie(name, '', { ...options, maxAge: 0, path: options.path || '/' });
  next();
}

// ---------------------------------------------------------------- Statische Dateien

const assetsDir = path.join(paths.public, 'assets');

/**
 * Adressen mit Fingerabdruck: /assets/v/<version>/css/app.css
 *
 * Stimmt der Fingerabdruck mit dieser Fassung überein, darf die Datei ein Jahr liegen bleiben –
 * sie kann sich unter dieser Adresse nicht mehr ändern. Passt er nicht (jemand hat eine alte Seite
 * offen, während wir neu ausgerollt haben), liefern wir die aktuelle Datei aus, aber nur mit einer
 * Minute Haltbarkeit.
 */
// Der Inhaltsschutz sitzt vor beiden Asset-Handlern: eine Datei, die einzeln aufgerufen wird,
// kommt gar nicht erst bis zum Ausliefern. Siehe server/protect.js.
app.use('/assets', protect.assetGuard(allowedOrigins));

app.use(
  '/assets/v',
  (req, res, next) => {
    const match = /^\/([A-Za-z0-9_-]{1,64})(\/.+)$/.exec(req.url);
    if (!match) return next();
    req.url = match[2];
    res.locals.assetCurrent = match[1] === assetVersion;
    next();
  },
  express.static(assetsDir, {
    index: false,
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', protect.cacheControl(filePath, res.locals.assetCurrent));
    },
  })
);

// Adressen ohne Fingerabdruck. Die stehen nur noch in Seiten, die vor dem Deployment geladen
// wurden, und in alten Lesezeichen: kurz halten, damit so etwas höchstens Minuten nachhängt.
app.use(
  '/assets',
  express.static(assetsDir, {
    index: false,
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', protect.cacheControl(filePath, false));
    },
  })
);
// Browser fragen die Adresse von sich aus ab, egal was im HTML steht.
app.get('/favicon.ico', (req, res) => res.redirect(301, `/assets/v/${assetVersion}/img/favicon-32.png`));

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${config.publicUrl}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  const paths_ = [
    '',
    '/features',
    '/pricing',
    '/faq',
    '/register',
    '/privacy',
    '/terms',
  ];
  const urls = pages.LANGS.flatMap((lang) =>
    paths_.map(
      (page) =>
        `<url><loc>${config.publicUrl}/${lang}${page}</loc>${pages.LANGS.filter((other) => other !== lang)
          .map(
            (other) =>
              `<xhtml:link rel="alternate" hreflang="${other}" href="${config.publicUrl}/${other}${page}"/>`
          )
          .join('')}</url>`
    )
  );
  res
    .type('application/xml')
    .send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join(
        ''
      )}</urlset>`
    );
});

// ---------------------------------------------------------------- Seiten

/** Wartungsmodus: alles außer der API und dem Admin-Bereich zeigt eine Notiz. */
function maintenanceGuard(req, res, next) {
  if (!Number(getSetting('maintenance'))) return next();
  if (req.user?.role === 'admin') return next();
  const lang = pages.langFor(req);
  res
    .status(503)
    .type('html')
    .send(
      pages.render('maintenance', lang, {
        robotsTag: NOINDEX,
        title: `${pages.t('error.maintenance.title', lang)} – ${config.brand}`,
        text: String(getSetting('maintenance_text') || ''),
      })
    );
}

const NOINDEX = '<meta name="robots" content="noindex, nofollow" />';

const PAGES = {
  '': { view: 'landing', vars: landing.homeVars },
  features: {
    view: 'features',
    title: 'features.title',
    description: 'meta.features.description',
    vars: landing.featureVars,
  },
  pricing: {
    view: 'pricing',
    title: 'pricing.title',
    description: 'meta.pricing.description',
    vars: landing.pricingVars,
  },
  faq: { view: 'faq', title: 'faq.title', description: 'meta.faq.description' },
  login: { view: 'login', title: 'auth.login.title', noindex: true },
  register: { view: 'register', title: 'auth.register.title' },
  forgot: { view: 'forgot', title: 'auth.forgot.title', noindex: true },
  reset: { view: 'reset', title: 'auth.reset.title', noindex: true },
  verify: { view: 'verify', title: 'auth.verify.title', noindex: true },
  privacy: { view: 'legal', legal: 'privacy' },
  terms: { view: 'legal', legal: 'terms' },
};

/** Eine feste Seite bauen: Kopfdaten, dazu was die Seite an Beweglichem braucht. */
function renderPage(slug, lang) {
  const entry = PAGES[slug];
  // Was auf jeder Seite vorkommt (Discord in der Kopfleiste, der Inhaltsschutz), steht an einer
  // Stelle.
  const vars = {
    path: slug ? `/${slug}` : '',
    // Nur die Bedienungssperre steht am <html>. Der Schutz der Dateien ist eine Sache des
    // Servers und geht den Browser nichts an.
    shield: protect.uiLocked() ? '1' : '0',
    ...landing.commonVars(lang),
  };
  if (entry.noindex) vars.robotsTag = NOINDEX;
  if (entry.title) vars.title = `${pages.t(entry.title, lang)} – ${config.brand}`;
  if (entry.description) vars.description = pages.t(entry.description, lang);
  if (entry.legal) Object.assign(vars, landing.legalVars(entry.legal, lang));
  if (entry.vars) Object.assign(vars, entry.vars(lang));
  return pages.render(entry.view, lang, vars);
}

/** Das Dashboard – eine Seite, der Rest steht im Browser-Router. */
const renderApp = (lang) =>
  pages.render('app', lang, {
    shield: protect.uiLocked() ? '1' : '0',
    // Nicht "app": so heißt schon das Raster im Inneren der Seite (.app in app.css). Stand beides
    // da, war der <body> selbst ein Raster mit einer 17,5-rem-Spalte – und das ganze Dashboard
    // stand am PC zusammengequetscht am linken Rand.
    bodyClass: 'dash',
    robotsTag: NOINDEX,
    path: '/app',
    title: `${pages.t('nav.dashboard', lang)} – ${config.brand}`,
  });

// Ohne Sprache in der Adresse: dorthin schicken, wo die Sprache drinsteht.
app.get('/', (req, res) => res.redirect(302, `/${pages.langFor(req)}`));
for (const [slug, name] of Object.entries(PAGES)) {
  if (!slug) continue;
  app.get(`/${slug}`, (req, res) => res.redirect(301, `/${pages.langFor(req)}/${slug}`));
}
// Alte Adressen aus der ersten Fassung.
for (const [from, to] of Object.entries({
  '/index.html': '',
  '/login.html': 'login',
  '/register.html': 'register',
  '/datenschutz.html': 'privacy',
  '/agb.html': 'terms',
})) {
  app.get(from, (req, res) => res.redirect(301, `/${pages.langFor(req)}/${to}`));
}
app.get(/^\/app(\/.*)?$/, (req, res) => res.redirect(302, `/${pages.langFor(req)}/app`));

app.get('/:lang(en|de)', maintenanceGuard, (req, res) => {
  pages.setLangCookie(res, req.params.lang);
  res.type('html').send(renderPage('', req.params.lang));
});

app.get('/:lang(en|de)/:page', maintenanceGuard, (req, res, next) => {
  const { lang, page } = req.params;
  pages.setLangCookie(res, lang);
  if (page === 'app') {
    if (protect.enabled() && /(httrack|wget|curl|scrapy)/i.test(String(req.headers['user-agent'] || ''))) {
      return res.status(403).type('text/plain').send('Nicht erlaubt.');
    }
    return res.type('html').send(renderApp(lang));
  }
  if (!PAGES[page]) return next();
  res.type('html').send(renderPage(page, lang));
});

// Das Dashboard ist eine Seite mit eigenem Router – jede Unteradresse liefert dieselbe Datei.
app.get(/^\/(en|de)\/app(\/.*)?$/, protect.panelGuard, maintenanceGuard, (req, res) => {
  const lang = req.path.slice(1, 3);
  pages.setLangCookie(res, lang);
  res.type('html').send(renderApp(lang));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    const lang = pages.langFor(req);
    return res.status(404).json({ error: lang === 'en' ? 'Unknown endpoint.' : 'Unbekannter Endpunkt.' });
  }
  const lang = pages.langFor(req);
  res
    .status(404)
    .type('html')
    .send(
      pages.render('404', lang, {
        robotsTag: NOINDEX,
        title: `${pages.t('error.404.title', lang)} – ${config.brand}`,
      })
    );
});

// ---------------------------------------------------------------- Fehler

app.use((error, req, res, _next) => {
  const status = error instanceof HttpError ? error.status : error.status || 500;
  if (status >= 500) console.error('[fehler]', req.method, req.path, error);
  if (!req.path.startsWith('/api/')) {
    const lang = pages.langFor(req);
    return res
      .status(status)
      .type('html')
      .send(pages.render('404', lang, { robotsTag: NOINDEX, title: `${config.brand}` }));
  }
  // Fehlermeldungen kommen in der Sprache der Anfrage zurück – das Frontend zeigt sie roh an.
  const lang = pages.langFor(req);
  const text =
    error instanceof HttpError
      ? error.text(lang)
      : lang === 'en'
        ? 'Something went wrong.'
        : 'Unerwarteter Fehler.';
  res.status(status).json({ error: text, code: error.code || null });
});

// ---------------------------------------------------------------- WebSocket

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
/** Eigener Server für die Bot-Leitung: andere Anmeldung, andere Nachrichten. */
const botSockets = new WebSocketServer({ noServer: true });
/** Und einer für die Standorte. Sie melden sich mit dem Token ihres Eintrags an. */
const nodeSockets = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

/** user_id -> Menge offener Verbindungen. */
const sockets = new Map();

/**
 * Niemand sieht mehr zu – Live-Ansichten abschalten.
 *
 * Der Browser stoppt sie beim Verlassen des Reiters selbst; ein zugeschlagener Laptop kommt dazu
 * nicht mehr. Dann rechnet der Client weiter für niemanden, und das ist das Teuerste, was dieses
 * Panel anstoßen kann. Die kurze Schonfrist ist für den Normalfall da: Ein Neuladen der Seite
 * schließt die Verbindung und baut sie eine Sekunde später wieder auf – dafür soll niemand seine
 * Ansicht neu starten müssen.
 */
const POV_IDLE_MS = 20_000;
const povIdleTimers = new Map();

function idlePov(userId) {
  clearTimeout(povIdleTimers.get(userId));
  const timer = setTimeout(() => {
    povIdleTimers.delete(userId);
    if (sockets.get(userId)?.size) return;
    const stopped = supervisor.stopPovForUser(userId);
    if (stopped) console.log(`[pov] ${stopped} Live-Ansicht(en) beendet – niemand sieht mehr zu.`);
  }, POV_IDLE_MS);
  timer.unref();
  povIdleTimers.set(userId, timer);
}

server.on('upgrade', (req, socket, head) => {
  // Die Leitung zum Discord-Bot. Sie hängt nicht an einer Sitzung, sondern am gemeinsamen
  // Geheimnis – der Bot ist kein Nutzer.
  if (req.url.startsWith('/api/bot/stream')) {
    const header = String(req.headers.authorization || '');
    if (!checkSecret(header.startsWith('Bearer ') ? header.slice(7) : '')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    return botSockets.handleUpgrade(req, socket, head, (ws) => {
      bridge.add(ws);
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      ws.on('close', () => bridge.remove(ws));
      ws.send(JSON.stringify({ type: 'hello', seq: bridge.sequence }));
      console.log('[bot] connected');
    });
  }

  // Die Leitung zu einem Standort. Der andere Rechner ruft an, nicht wir – so braucht er weder
  // eine öffentliche Adresse noch ein Zertifikat noch eine offene Portfreigabe.
  if (req.url.startsWith('/api/node/stream')) {
    const node = nodeByToken(req);
    if (!node) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    return nodeSockets.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      agents.attach(node, ws);
      ws.send(JSON.stringify({ type: 'welcome', node: { id: node.id, name: node.name } }));
    });
  }

  if (!req.url.startsWith('/api/ws')) return socket.destroy();
  if (!trustedOrigin(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
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
    // Wer wieder da ist, hat seine Ansicht nicht aufgegeben (siehe idlePov).
    clearTimeout(povIdleTimers.get(row.id));
    povIdleTimers.delete(row.id);
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
    const open = sockets.get(ws.userId);
    open?.delete(ws);
    if (open && !open.size) {
      sockets.delete(ws.userId);
      idlePov(ws.userId);
    }
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

/**
 * Ein Standort ist zurück – die Bots, die dort laufen sollen, wieder hochfahren.
 *
 * Kurz warten: der Agent meldet sich, bevor er seine Client-Dateien abgeglichen hat. Ein Start in
 * derselben Sekunde träfe womöglich auf eine Datei, die gerade ersetzt wird.
 */
agents.events.on('node-online', ({ nodeId }) => {
  setTimeout(() => {
    const started = supervisor.restoreNode(nodeId);
    if (started) console.log(`[standort ${nodeId}] ${started} Bot(s) wieder gestartet.`);
  }, 4000).unref();
});

supervisor.on('bot-line', ({ userId, key, entry }) => push(userId, { type: 'line', key, entry }));
supervisor.on('bot-state', ({ userId, key, state }) => push(userId, { type: 'state', key, state }));
// Anzeigetafel und Menü. Sie gehen denselben Weg wie ein Zustandswechsel, damit die
// Ansicht ohne Nachfragen aktuell ist.
supervisor.on('bot-view', ({ userId, key, kind, view }) => push(userId, { type: 'view', key, kind, view }));

/**
 * Ticket-Ereignisse an die Beteiligten und ans Team.
 *
 * Damit ist der Support-Chat live: Wer ein Ticket offen hat, sieht eine Antwort in dem Moment,
 * in dem sie geschrieben wird, und dass gerade jemand tippt – ohne die Seite neu zu laden.
 */
for (const type of ['ticket.message', 'ticket.status', 'ticket.typing', 'ticket.created']) {
  bridge.on(type, (message) => {
    const ticket = tickets.byId(message.ticket_id);
    if (!ticket) return;
    const payload = { ...message, type: 'ticket', event: type.split('.')[1] };
    // Das Team sieht jedes Ticket, die Beteiligten ihres – wer beides ist, bekommt es einmal.
    // Der Browser bekommt zusätzlich die Zielgruppe mit. Ohne diese Trennung konnte ein Admin
    // beim Eintreffen *fremder* Team-Tickets seinen persönlichen Support-Zähler erhöhen.
    const staff = new Set(db.prepare("SELECT id FROM users WHERE role = 'admin'").all().map((row) => row.id));
    const customers = new Set();
    if (!message.internal) {
      // Interne Notizen bleiben beim Team. Der Kunde erfährt nicht einmal, dass es sie gibt.
      for (const person of tickets.participants(ticket.id)) customers.add(person.id);
    }
    const receivers = new Set([...staff, ...customers]);
    for (const id of receivers) {
      push(id, {
        ...payload,
        audience: { customer: customers.has(id), staff: staff.has(id) },
      });
    }
  });
}

// Tote Verbindungen alle 30 s aussortieren – Browser, Bot wie Standort.
setInterval(() => {
  agents.heartbeat();
  for (const ws of [...wss.clients, ...botSockets.clients, ...nodeSockets.clients]) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

// ---------------------------------------------------------------- Laufzeiten

/**
 * Stündlich nachsehen, welcher Serverplatz fällig ist. Verlängert wird automatisch, solange das
 * Guthaben reicht; sonst wird der Platz stillgelegt und die Bots gehen aus – nichts wird gelöscht,
 * und nichts läuft ins Minus.
 */
function billingTick() {
  const { renewed, suspended } = billing.renewDue();
  const userById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  for (const entry of renewed) {
    const balance = billing.balance(entry.userId);
    notify.planRenewed(entry.userId, entry.name, entry.price);
    const user = userById(entry.userId);
    if (user) mail.sendTo(user, 'renewed', { name: entry.name, price: entry.price, balance });
    push(entry.userId, { type: 'credits', balance });
    roles.changed(entry.userId);
  }

  for (const entry of suspended) {
    supervisor.stopProfile(entry.profileId, 'Laufzeit abgelaufen – Bots gestoppt.');
    notify.planSuspended(entry.userId, entry.name, entry.reason);
    const user = userById(entry.userId);
    if (user) {
      mail.sendTo(user, 'suspended', {
        name: entry.name,
        reason: entry.reason,
        profile_id: entry.profileId,
      });
    }
    push(entry.userId, {
      type: 'suspended',
      profile_id: entry.profileId,
      name: entry.name,
      reason: entry.reason,
    });
    roles.changed(entry.userId);
  }

  // Rechtzeitig Bescheid geben, wenn für die nächste Verlängerung Guthaben fehlt.
  const warnDays = Number(getSetting('renew_warn_days')) || 3;
  for (const row of billing.expiringSoon(warnDays)) {
    const days = Math.max(1, Math.ceil((row.paid_until - Date.now()) / 86_400_000));
    const missing = Math.max(0, row.price_credits - row.credits);
    notify.planExpiring(row.user_id, row.name, days, missing);
    // Eine Nachricht je Tag und Serverplatz: der Takt hier ist stündlich, und 24 gleichlautende
    // E-Mails über dasselbe fehlende Guthaben wären das Gegenteil einer Warnung.
    if (onceADay(`expiring:${row.id}`)) {
      const user = userById(row.user_id);
      if (user) mail.sendTo(user, 'expiring', { name: row.name, days, missing });
    }
  }

  const low = Number(getSetting('low_balance'));
  for (const row of db
    .prepare('SELECT id, credits FROM users WHERE credits > 0 AND credits <= ?')
    .all(low)) {
    const monthly = billing.monthlyCost(row.id);
    if (monthly <= 0) continue;
    notify.lowBalance(row.id, row.credits);
    if (onceADay(`low:${row.id}`)) {
      const user = userById(row.id);
      if (user) mail.sendTo(user, 'low_balance', { balance: row.credits, monthly });
    }
  }
}

/**
 * Gratis-Plätze nur laufen lassen, solange Discord die Mitgliedschaft frisch bestätigt hat.
 * Gateway-Austritte stoppen bereits im Bot-Endpunkt; dieser Takt ist das Sicherheitsnetz für
 * einen ausgefallenen Bot oder einen veralteten positiven Cachewert.
 *
 * **Zwei Arten von Nein.** Wer nicht verknüpft ist oder ausgetreten ist, hat keinen Anspruch –
 * da verfällt der Startwunsch, und nach einem erneuten Beitritt entscheidet der Kunde bewusst neu.
 * "Konnte gerade nicht bestätigt werden" ist dagegen **unsere** Lücke, nicht seine: der Bot war
 * kurz weg, oder der Server ist eben erst hochgefahren und der erste Abgleich steht noch aus. Dann
 * gehen die Bots zwar aus (der Gratis-Platz läuft nie ohne Nachweis), aber der Wunsch bleibt
 * stehen – und `restoreAll()` fährt sie wieder hoch, sobald der Nachweis da ist. Ohne diese
 * Unterscheidung war jeder Neustart des Servers das Ende jedes Gratis-Bots: beim Hochfahren ist
 * jede Prüfung veraltet, und der Wunsch war weg, bevor der Bot sich überhaupt melden konnte.
 */
function enforceFreePlans() {
  const profiles = db
    .prepare(
      `SELECT p.* FROM profiles p JOIN plans pl ON pl.id = p.plan_id
        WHERE pl.free_slot = 1`
    )
    .all();
  let stopped = 0;
  for (const profile of profiles) {
    const access = billing.freeAccess(profile.user_id);
    if (access.ok) continue;
    const definite = access.reason === 'discord-link' || access.reason === 'discord-join';
    const wanted = db
      .prepare('SELECT 1 FROM profile_accounts WHERE profile_id = ? AND wanted = 1 LIMIT 1')
      .get(profile.id);
    if (wanted || supervisor.runningOnProfile(profile.id)) stopped += 1;
    supervisor.stopProfile(profile.id, 'Discord membership required for the Free plan.', {
      keepWanted: !definite,
    });
  }
  return stopped;
}

/** Sperrzeit für Nachrichten, die aus dem Stundentakt kommen. */
const lastMailed = new Map();
function onceADay(key) {
  const now = Date.now();
  if (now - (lastMailed.get(key) || 0) < 20 * 60 * 60 * 1000) return false;
  lastMailed.set(key, now);
  return true;
}

setInterval(billingTick, 3_600_000).unref();
setInterval(enforceFreePlans, 60_000).unref();
/**
 * Und danach: hochfahren, was laufen soll und gerade nicht läuft.
 *
 * Derselbe Takt, aber in der anderen Richtung. Er ist das Netz für alles, was einen Bot
 * vorübergehend unmöglich gemacht hat und wieder vorbei ist – eine noch nicht bestätigte
 * Discord-Mitgliedschaft nach dem Hochfahren, ein Standort, der zurückkommt, ein Serverplatz, der
 * nach dem Aufladen fortgesetzt wurde. Ein abgestürzter Client kommt so nicht wieder: der löscht
 * seinen Startwunsch selbst.
 */
setInterval(() => {
  const started = supervisor.restoreAll();
  if (started) console.log(`${started} Bot(s) wieder gestartet.`);
}, 60_000).unref();

/**
 * Der eigene Zustand als Standort-Meldung.
 *
 * Entfernte Standorte melden sich alle 15 Sekunden von selbst; der Haupt-Standort ist diese
 * Maschine und muss deshalb selbst nachsehen. Ohne diesen Takt stünde in der Standort-Übersicht
 * neben jedem fremden Rechner eine Auslastung und neben dem eigenen ein Strich.
 */
function localNodeTick() {
  metrics
    .snapshot()
    .then((snapshot) => nodes.setLocalStats(metrics.asNodeStats(snapshot)))
    .catch(() => {});
}
localNodeTick();
setInterval(localNodeTick, 15_000).unref();

// Stündlich: abgelaufene Sitzungen weg, Client-Release nachsehen, liegengebliebene Anhänge weg.
setInterval(() => {
  auth.cleanupSessions();
  attachments.sweepOrphans();
  binaries.sync().then(() => agents.syncAll()).catch(() => {});
}, 3_600_000).unref();

// ---------------------------------------------------------------- Start

const started = async () => {
  // Tests exercise the real HTTP/WebSocket stack against an isolated database. They only need
  // local detection; contacting GitHub on every test run would make that stack test flaky.
  if (process.env.NODE_ENV === 'test') await binaries.detect();
  else await binaries.sync();
  billingTick();
  enforceFreePlans();
  const restored = supervisor.restoreAll();
  server.listen(config.port, config.host, () => {
    console.log(
      `${config.brand}-Panel läuft auf http://${config.host}:${config.port} ` +
        `(Client ${binaries.state.clientVersion || '?'}, Versionen: ${
          binaries.state.versions.join(', ') || '–'
        })`
    );
    const builds = Object.entries(binaries.state.builds)
      .filter(([, entry]) => entry.present)
      .map(([key]) => key);
    console.log(`Bauformen: ${builds.join(', ') || 'keine'}`);
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
