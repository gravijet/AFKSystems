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
import * as notify from './notify.js';
import * as pages from './pages.js';
import * as landing from './landing.js';
import { router as coreRouter } from './routes/core.js';
import { router as profilesRouter } from './routes/profiles.js';
import { router as billingRouter, stripeWebhook } from './routes/billing.js';
import { admin as adminRouter } from './routes/admin.js';
import { HttpError } from './util.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Der Stripe-Webhook braucht den Rohtext für die Signatur – deshalb vor dem JSON-Parser.
app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), stripeWebhook);

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser);
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
    setHeaders(res) {
      res.setHeader(
        'Cache-Control',
        res.locals.assetCurrent ? 'public, max-age=31536000, immutable' : 'public, max-age=60'
      );
    },
  })
);

// Adressen ohne Fingerabdruck. Die stehen nur noch in Seiten, die vor dem Deployment geladen
// wurden, und in alten Lesezeichen: kurz halten, damit so etwas höchstens Minuten nachhängt.
app.use(
  '/assets',
  express.static(assetsDir, {
    index: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    },
  })
);
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
    '/imprint',
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
  imprint: { view: 'legal', legal: 'imprint' },
  privacy: { view: 'legal', legal: 'privacy' },
  terms: { view: 'legal', legal: 'terms' },
};

/** Eine feste Seite bauen: Kopfdaten, dazu was die Seite an Beweglichem braucht. */
function renderPage(slug, lang) {
  const entry = PAGES[slug];
  const vars = { path: slug ? `/${slug}` : '' };
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
  '/impressum.html': 'imprint',
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
  if (page === 'app') return res.type('html').send(renderApp(lang));
  if (!PAGES[page]) return next();
  res.type('html').send(renderPage(page, lang));
});

// Das Dashboard ist eine Seite mit eigenem Router – jede Unteradresse liefert dieselbe Datei.
app.get(/^\/(en|de)\/app(\/.*)?$/, maintenanceGuard, (req, res) => {
  const lang = req.path.slice(1, 3);
  pages.setLangCookie(res, lang);
  res.type('html').send(renderApp(lang));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Unbekannter Endpunkt.' });
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

// ---------------------------------------------------------------- Laufzeiten

/**
 * Stündlich nachsehen, welcher Serverplatz fällig ist. Verlängert wird automatisch, solange das
 * Guthaben reicht; sonst wird der Platz stillgelegt und die Bots gehen aus – nichts wird gelöscht,
 * und nichts läuft ins Minus.
 */
function billingTick() {
  const { renewed, suspended } = billing.renewDue();

  for (const entry of renewed) {
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(entry.profileId);
    const plan = billing.planOf(profile);
    notify.planRenewed(entry.userId, entry.name, plan.price_credits);
    push(entry.userId, { type: 'credits', balance: billing.balance(entry.userId) });
  }

  for (const entry of suspended) {
    supervisor.stopProfile(entry.profileId, 'Laufzeit abgelaufen – Bots gestoppt.');
    notify.planSuspended(entry.userId, entry.name, entry.reason);
    push(entry.userId, {
      type: 'suspended',
      profile_id: entry.profileId,
      name: entry.name,
      reason: entry.reason,
    });
  }

  // Rechtzeitig Bescheid geben, wenn für die nächste Verlängerung Guthaben fehlt.
  const warnDays = Number(getSetting('renew_warn_days')) || 3;
  for (const row of billing.expiringSoon(warnDays)) {
    const days = Math.max(1, Math.ceil((row.paid_until - Date.now()) / 86_400_000));
    notify.planExpiring(row.user_id, row.name, days, Math.max(0, row.price_credits - row.credits));
  }

  const low = Number(getSetting('low_balance'));
  for (const row of db
    .prepare('SELECT id, credits FROM users WHERE credits > 0 AND credits <= ?')
    .all(low)) {
    if (billing.monthlyCost(row.id) > 0) notify.lowBalance(row.id, row.credits);
  }
}

setInterval(billingTick, 3_600_000).unref();

// Stündlich: abgelaufene Sitzungen weg, Client-Release nachsehen.
setInterval(() => {
  auth.cleanupSessions();
  binaries.sync().catch(() => {});
}, 3_600_000).unref();

// ---------------------------------------------------------------- Start

const started = async () => {
  await binaries.sync();
  billingTick();
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
