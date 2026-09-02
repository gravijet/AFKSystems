// Einstiegspunkt: HTTP, die Seiten in zwei Sprachen, WebSocket, Verlängerungen, Aufräumarbeiten.

import express from 'express';
import compression from 'compression';
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
import * as assets from './assets.js';
import * as strings from './strings.js';
import * as landing from './landing.js';
import * as tickets from './tickets.js';
import * as attachments from './attachments.js';
import { bridge } from './bridge.js';
import { router as coreRouter } from './routes/core.js';
import { router as profilesRouter } from './routes/profiles.js';
import { router as billingRouter, stripeWebhook } from './routes/billing.js';
import { admin as adminRouter } from './routes/admin.js';
import { router as botRouter, tryBotSecret } from './routes/bot.js';
import { router as nodeRouter, tryNodeToken } from './routes/node.js';
import * as agents from './agents.js';
import * as security from './security.js';
import * as logincode from './logincode.js';
import * as totp from './totp.js';
import * as heads from './heads.js';
import * as backup from './backup.js';
import * as account from './account.js';
import * as schedules from './schedules.js';
import * as systemreport from './systemreport.js';
import * as jobs from './jobs.js';
import { HttpError, langOf, slidingWindow } from './util.js';

const app = express();
app.disable('x-powered-by');
// Eine feste Hop-Anzahl vertraut bei direkter Erreichbarkeit des Node-Ports dem vom Angreifer
// gesetzten X-Forwarded-For. Standardmäßig zählt deshalb nur ein Proxy auf derselben Maschine;
// Container-/Netzwerkaufbauten können TRUST_PROXY ausdrücklich auf ihr Netz setzen.
const trustProxy = /^\d+$/.test(config.trustProxy)
  ? Number(config.trustProxy)
  : config.trustProxy === 'true'
    ? true
    : config.trustProxy === 'false'
      ? false
      : config.trustProxy;
app.set('trust proxy', trustProxy);

// HTML, CSS, JavaScript und JSON bestehen fast nur aus Text. Ohne Kompression ging insbesondere
// die große Sprachdatei des Panels in voller Größe über die Leitung. `compression` handelt die
// passende Kodierung über Accept-Encoding aus und lässt bereits komprimierte Bilder/Schriften in
// Ruhe. Der kleine Schwellwert spart bei winzigen Antworten mehr CPU, als Bytes zu gewinnen wären.
app.use(compression({ threshold: 1024 }));

const websocketOrigin = config.publicUrl.replace(/^http/, 'ws');
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // Profilbilder verknüpfter Konten kommen von Discord, Google und Gravatar. Ohne diese eng
  // begrenzten Ausnahmen blockiert der Browser sie trotz korrekter API-Antwort mit der
  // Content-Security-Policy. Es sind reine Bildhosts – kein Skript, kein Rahmen.
  //
  // **Minotar steht hier nicht mehr.** Die Minecraft-Köpfe holt seit heads.js dieser Server und
  // liefert sie unter `/api/heads/…` aus; der Browser des Kunden spricht mit niemandem sonst.
  // Damit ist die Zeile hier auch eine Zusicherung: Was ein Kunde beim Öffnen seiner Kontenliste
  // an Fremde schickt, ist genau das, was er selbst verknüpft hat.
  "img-src 'self' data: https://cdn.discordapp.com https://gravatar.com https://*.gravatar.com https://*.googleusercontent.com",
  "font-src 'self'",
  `connect-src 'self' ${websocketOrigin}`,
  "media-src 'none'",
  "manifest-src 'self'",
  // `default-src` deckt das mit ab – aber nur, solange niemand `default-src` aufweicht. Diese drei
  // Zeilen stehen ausdrücklich da, damit ein späterer Zusatz an der Vorgabe oben nicht nebenbei
  // fremde Rahmen oder einen fremden Worker erlaubt.
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'self'",
  // Wer über einen alten `http://`-Link hereinkommt, lädt die Unterressourcen trotzdem verschlüsselt.
  ...(config.publicUrl.startsWith('https://') ? ['upgrade-insecure-requests'] : []),
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
  if (config.publicUrl.startsWith('https://')) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  if (
    req.path.startsWith('/api/') ||
    /^\/(en|de)\/(?:app(?:\/|$)|login\/?$|register\/?$|forgot\/?$|reset\/?$|verify\/?$)/.test(req.path)
  ) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

/**
 * Was für diesen Server "die eigene Website" ist.
 *
 * Live gelten ausschließlich die konfigurierte öffentliche Adresse und ihr fester www-Alias.
 * Weder `Host` noch `X-Forwarded-Host` dürfen sich dort selbst auf die Positivliste schreiben:
 * beide sind Eingangsdaten einer Anfrage und damit keine Vertrauensquelle. Nur lokale Entwicklung
 * und Tests ergänzen ihren wechselnden Host samt Port, weil sie keine feste öffentliche Adresse
 * haben.
 */
function allowedOrigins(req) {
  const origins = new Set([new URL(config.publicUrl).origin]);
  const publicAddress = new URL(config.publicUrl);
  // Die feste www-Variante ist ein bekannter Alias, nicht eine Behauptung aus der Anfrage.
  if (!publicAddress.hostname.startsWith('www.') && !publicAddress.port) {
    origins.add(`${publicAddress.protocol}//www.${publicAddress.hostname}`);
  }
  // Nur Entwicklung und Integrationstests laufen auf einem zufälligen lokalen Port. Live darf
  // ein frei gewählter Host-Kopf niemals seine eigene Herkunft auf die Positivliste schreiben.
  if (process.env.NODE_ENV !== 'production') {
    const host = String(req?.headers?.host || '').split(',')[0].trim();
    if (host) {
      origins.add(`https://${host}`);
      origins.add(`http://${host}`);
    }
  }
  return origins;
}

function trustedOrigin(req) {
  const origin = String(req.headers.origin || '');
  return Boolean(origin && allowedOrigins(req).has(origin));
}

// Der Stripe-Webhook braucht den **rohen** Rumpf für die Unterschrift – deshalb steht er vor dem
// JSON-Parser. Aus wieder eingesetztem JSON käme ein anderer Hash heraus, und keine echte
// Zahlungsmeldung käme je durch.
app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), stripeWebhook);

/**
 * Schreibende API-Aufrufe nur aus dieser Website.
 *
 * Diese Bereiche gehören nicht dazu: Der Discord-Bot, die Standorte und Stripe sprechen Dienst zu
 * Dienst, tragen keinen Browser-Origin und weisen sich mit eigenem Token bzw. Unterschrift aus.
 */
const SERVICE_API = /^\/(bot|node|stripe)(\/|$)/;

/**
 * Browser dürfen schreibende API-Anfragen nur aus derselben Website schicken.
 *
 * **Fehlt jeder Hinweis, ist das ein Nein.** Vorher galt: ohne `Origin` durchlassen. Das war die
 * ganze Lücke – ein Formular auf einer fremden Seite mit
 * `enctype="text/plain"` schickt keinen brauchbaren `Origin`-Ersatz, aber es schickt das Cookie
 * mit, und der Server sah nichts, woran er es hätte erkennen können. Jeder Browser, der seit
 * Jahren im Umlauf ist, hängt an eine schreibende Anfrage entweder `Origin` oder `Sec-Fetch-Site`;
 * wer beides nicht schickt, ist kein Browser – und dann gehört er in einen der Dienst-Bereiche
 * oben, nicht auf die Endpunkte mit Sitzungs-Cookie.
 */
app.use('/api', (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (SERVICE_API.test(req.path)) return next();
  const reject = () =>
    next(
      new HttpError(403, 'Anfrage von einer fremden Website abgelehnt.', {
        en: 'Cross-site request rejected.',
      })
    );

  const site = String(req.headers['sec-fetch-site'] || '');
  if (site === 'cross-site') return reject();
  if (req.headers.origin) return trustedOrigin(req) ? next() : reject();
  // Kein Origin: dann muss der Browser wenigstens sagen, dass die Anfrage von hier kommt.
  if (site === 'same-origin' || site === 'same-site' || site === 'none') return next();
  reject();
});

/**
 * Eine allgemeine Bremse für die ganze API.
 *
 * Bisher war nur die Anmeldung gedeckelt, und das war die halbe Miete: Passwörter durchprobieren
 * ging nicht mehr, alles andere schon. Wer eine Ticketnummer, eine Anhangsnummer oder eine
 * Kontonummer durchzählen wollte, durfte das so schnell, wie die Leitung hergab – und jeder dieser
 * Aufrufe ist eine Datenbankabfrage, ein paar davon sind teuer.
 *
 * Die Grenze ist bewusst hoch angesetzt (fünfzehn Anfragen je Sekunde und Adresse im Schnitt): Das
 * Panel selbst kommt dort nie hin – seine laufenden Meldungen kommen über den WebSocket –, ein
 * Anschluss mit vielen Menschen dahinter ebenso wenig, und ein Werkzeug, das eine Liste
 * durchzählt, sofort. Die Dienst-Bereiche bleiben außen vor: Der Discord-Bot und die Standorte
 * sprechen im Takt ihrer eigenen Ereignisse und weisen sich ohnehin mit einem Token aus.
 */
const apiWindow = slidingWindow({ windowMs: 60_000, max: 900 });
app.use('/api', (req, _res, next) => {
  if (SERVICE_API.test(req.path)) return next();
  if (apiWindow(req.ip)) return next();
  next(
    new HttpError(429, 'Zu viele Anfragen. Bitte einen Moment warten.', {
      en: 'Too many requests. Please wait a moment.',
    })
  );
});

// Anmeldung und Wiederherstellung sind absichtlich teure Vorgänge. Ein kleines, lokales Fenster
// bremst Passwort-Raten und verhindert, dass fremde Websites den Prozess als CPU-DoS missbrauchen.
//
// **Zwei Zähler, nicht einer.** Der erste zählt je Endpunkt: dreißig Versuche an `/auth/login`.
// Allein war er zu umgehen – es gibt ein Dutzend Endpunkte unter `/api/auth`, und wer sie
// abwechselnd benutzt, hat dreißig Versuche **je Adresse und Pfad**. Der zweite zählt deshalb
// alles zusammen, was von einer Adresse an die Anmeldung geht.
const authPath = slidingWindow({ windowMs: 15 * 60_000, max: 30, cap: 5_000 });
const authTotal = slidingWindow({ windowMs: 15 * 60_000, max: 120, cap: 5_000 });
app.use('/api/auth', (req, _res, next) => {
  if (req.method !== 'POST') return next();
  if (authPath(`${req.ip}:${req.path}`) && authTotal(req.ip)) return next();
  next(
    new HttpError(429, 'Zu viele Versuche. Bitte später erneut versuchen.', {
      en: 'Too many attempts. Please try again later.',
    })
  );
});

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser);
app.use(auth.attachUser);

/**
 * Gesperrte Adressen.
 *
 * Die Prüfung steht **hinter** `attachUser`, und das ist Absicht: Eine bestehende
 * Administrator-Sitzung kommt durch jede Sperre hindurch. Wer sich mit einem zu weiten Netz
 * selbst aussperrt, hätte sonst nur noch SSH – und die Sperre, die ihn draußen hält, steht
 * ausgerechnet in der Datenbank, an die er dann nicht mehr herankommt. Die zweite Sicherung ist
 * in security.js: Die eigene Adresse lässt sich gar nicht erst eintragen.
 *
 * Geantwortet wird knapp und ohne Begründung. Wer gesperrt ist, hat kein Anrecht darauf zu
 * erfahren, warum – und eine ausführliche Antwort wäre eine Anleitung, es anders zu versuchen.
 */
app.use((req, res, next) => {
  if (req.user?.role === 'admin') return next();
  if (!security.blockFor(req.ip)) return next();
  res.status(403).type('text/plain').send('Forbidden');
});

app.use('/api', coreRouter);
app.use('/api', billingRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/bot', botRouter);
// Die Standorte holen sich hier ihre Client-Dateien – mit ihrem Token, nicht mit einer Sitzung.
app.use('/api/node', nodeRouter);

/**
 * Läuft der Dienst?
 *
 * Diese Adresse ist absichtlich offen: `install.sh`, `cutover.sh`, der Discord-Bot und jeder
 * Standort prüfen damit, ob das Panel überhaupt antwortet. Was sie dafür brauchen, ist ein 200 –
 * mehr nicht.
 *
 * Die Zahlen dahinter (Laufzeit, laufende Bots, Client-Fassung) standen bisher für jeden im Netz
 * da. Das ist keine große Lücke, aber es ist auch keine Auskunft, die irgendwem außerhalb zusteht:
 * „Wie viele Bots laufen gerade?“ ist eine Geschäftszahl, und „seit wann läuft der Prozess?“ sagt
 * einem Angreifer, ob ein Neustart nach einer Aktualisierung noch aussteht. Beides gibt es
 * weiterhin – für eine Administratorsitzung und für Aufrufe von dieser Maschine selbst, und das
 * sind genau die beiden Fälle, für die es gedacht war.
 */
app.get('/api/health', (req, res) => {
  // `req.ip` und **nicht** `req.socket.remoteAddress`: Hinter nginx kommt jede Anfrage von
  // 127.0.0.1 – die Socket-Adresse hätte also die ganze Welt für „von dieser Maschine“ gehalten
  // und genau die Auskunft weitergegeben, die hier zurückgehalten werden soll. `req.ip` ist die
  // Adresse, die `trust proxy` durchlässt, und die ist bei einem Aufruf über den vHost die des
  // Besuchers und nur bei einem echten `curl localhost:3010` die Loopback-Adresse.
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip || '');
  if (req.user?.role !== 'admin' && !local) return res.json({ ok: true });
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    bots: supervisor.runningCount(),
    client: binaries.state.clientVersion,
  });
});

/**
 * Winziger Cookie-Setzer, damit `res.cookie` ohne cookie-parser funktioniert.
 *
 * `maxAge` wird auch bei **0** geschrieben. Vorher stand dort `if (options.maxAge)`, und damit fiel
 * genau der Fall heraus, für den es `clearCookie` gibt: Ein Cookie mit leerem Wert und ohne
 * `Max-Age` ist kein gelöschtes Cookie, sondern ein Sitzungs-Cookie, das bis zum Schließen des
 * Browsers liegen bleibt. Beim Abmelden war die Sitzung serverseitig weg und im Browser stand
 * weiter ein `afk_session=`, und das kurzlebige Merkmal der OAuth-Anmeldung wurde nie zurückgenommen.
 */
function cookieParser(req, res, next) {
  res.cookie = (name, value, options = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    parts.push(`Path=${options.path || '/'}`);
    if (options.maxAge !== undefined && options.maxAge !== null) {
      const seconds = Math.round(Number(options.maxAge) / 1000);
      parts.push(`Max-Age=${Number.isFinite(seconds) ? Math.max(0, seconds) : 0}`);
      if (seconds <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    }
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

// Die Texte des Panels, je Sprache einzeln. Sie liegen nicht als Datei da, sondern werden beim
// Hochfahren aus derselben Tabelle gerechnet, die der Server für die festen Seiten benutzt –
// siehe server/strings.js. Steht **vor** den Dateihandlern, weil es zu diesen Adressen keine
// Dateien gibt.
app.use(
  strings.handler({
    cacheControl: protect.cacheControl,
    current: (version) => version === assetVersion,
  })
);

/**
 * Die Kopfzeilen einer Asset-Antwort.
 *
 * `filePath` ist die Datei, die wirklich gelesen wird – und das kann eine vorgepackte `app.css.br`
 * sein (siehe assets.js). Für Inhaltstyp und Haltbarkeit zählt aber immer das Original: Ein `.br`
 * am Ende macht aus einem Stylesheet weder einen anderen Typ noch eine Datei, die ein fremder
 * Zwischenspeicher behalten dürfte. Deshalb steht der ursprüngliche Name in `res.locals`.
 */
function assetHeaders(res, filePath, current) {
  const original = res.locals.assetOriginal || filePath;
  // Vor `send`: Steht der Typ schon, lässt `send` ihn stehen – sonst käme für app.css.br
  // "application/brotli" heraus und der Browser hielte das Stylesheet für einen Download.
  const type = express.static.mime.lookup(original);
  if (type && !res.getHeader('Content-Type')) {
    const charset = express.static.mime.charsets.lookup(type);
    res.setHeader('Content-Type', type + (charset ? `; charset=${charset}` : ''));
  }
  res.setHeader('Cache-Control', protect.cacheControl(original, current));
}

app.use(
  '/assets/v',
  (req, res, next) => {
    const match = /^\/([A-Za-z0-9_-]{1,64})(\/.+)$/.exec(req.url);
    if (!match) return next();
    req.url = match[2];
    res.locals.assetCurrent = match[1] === assetVersion;
    next();
  },
  assets.preferPacked(assetsDir),
  express.static(assetsDir, {
    index: false,
    setHeaders(res, filePath) {
      assetHeaders(res, filePath, res.locals.assetCurrent);
    },
  })
);

// Adressen ohne Fingerabdruck. Die stehen nur noch in Seiten, die vor dem Deployment geladen
// wurden, und in alten Lesezeichen: kurz halten, damit so etwas höchstens Minuten nachhängt.
app.use(
  '/assets',
  assets.preferPacked(assetsDir),
  express.static(assetsDir, {
    index: false,
    setHeaders(res, filePath) {
      assetHeaders(res, filePath, false);
    },
  })
);
// Browser fragen die Adresse von sich aus ab, egal was im HTML steht.
//
// **302, nicht 301.** Das Ziel trägt den Fingerabdruck der Dateien und ändert sich mit jedem
// Deployment. Eine dauerhafte Weiterleitung hätte der Browser für immer behalten – und danach
// jedes Mal die Adresse einer Fassung abgerufen, die es längst nicht mehr gibt.
app.get('/favicon.ico', (req, res) => res.redirect(302, `/assets/v/${assetVersion}/img/favicon-32.png`));

app.get('/robots.txt', (req, res) => {
  // Was hinter der Anmeldung liegt, gehört in keinen Index: das Dashboard ist für jeden Crawler
  // eine leere Seite, und die API antwortet ihm mit 401. Beides zu sammeln kostet ihn Zeit und
  // uns Anfragen, und in den Suchergebnissen soll es ohnehin nicht stehen.
  res
    .type('text/plain')
    .send(
      `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /en/app\nDisallow: /de/app\n` +
        `Disallow: /assets/\nSitemap: ${config.publicUrl}/sitemap.xml\n`
    );
});
app.get('/sitemap.xml', (req, res) => {
  const paths_ = [
    '',
    '/features',
    '/pricing',
    '/faq',
    // Eine geschlossene Registrierung gehört nicht in die Sitemap: Wer über die Suche darauf
    // stößt, findet ein Formular, das ihm absagt.
    ...(Number(getSetting('registration_open')) && config.registrationOpen ? ['/register'] : []),
    '/privacy',
    '/terms',
    '/imprint',
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
        shield: protect.uiLocked() ? '1' : '0',
        title: `${pages.t('error.maintenance.title', lang)} – ${config.brand}`,
        // Maskiert: Der Wartungstext ist ein Feld für einen Satz ("wir sind in einer Stunde
        // zurück") und wurde roh in die Seite gesetzt. Was dort steht, geht damit als HTML an
        // jeden Besucher – auf einer Seite, die absichtlich niemand angemeldet sieht.
        text: pages.escape(getSetting('maintenance_text') || ''),
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
  // **Hier ausdrücklich keine Ladehinweise für JavaScript.** Es lag nahe, den Anmeldeseiten
  // dieselben `modulepreload`-Zeilen zu geben wie dem Dashboard – gemessen war es falsch: Auf einer
  // gedrosselten Leitung (1,6 Mbit/s, 150 ms Umlauf) kam das erste Bild dadurch 108 ms **später**,
  // weil das vorgezogene JavaScript dem Stylesheet die Bandbreite wegnimmt, und das Stylesheet ist
  // es, worauf das erste Bild wartet.
  //
  // Auf dieser Seite bringt das nichts ein: Das Formular kommt fertig vom Server, und das Skript
  // wird erst beim Absenden gebraucht – Sekunden später, in denen jemand seine Zugangsdaten
  // eintippt. Im Dashboard liegt es andersherum (siehe renderApp): Dort ist das erste Bild nur ein
  // Platzhalter, und die 80 ms, die es später kommt, sparen eine halbe Sekunde, bis wirklich etwas
  // dasteht.
  login: { view: 'login', title: 'auth.login.title', noindex: true },
  register: { view: 'register', title: 'auth.register.title' },
  forgot: { view: 'forgot', title: 'auth.forgot.title', noindex: true },
  reset: { view: 'reset', title: 'auth.reset.title', noindex: true },
  verify: { view: 'verify', title: 'auth.verify.title', noindex: true },
  privacy: { view: 'legal', legal: 'privacy' },
  terms: { view: 'legal', legal: 'terms' },
  imprint: { view: 'legal', legal: 'imprint' },
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
    // Der Browser holt das Modul und seinen statischen Abhängigkeitsbaum direkt nach dem kritischen
    // Stylesheet. Das konkrete Ansichtsmodul wählt app.js anschließend passend zur URL, damit ein
    // direkter Aufruf der Einstellungen nicht nebenbei die Übersicht lädt.
    resourceHints: pages.preload(lang, ['app.js', 'ui.js', 'preferences.js', 'chatlog.js']),
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
  '/impressum.html': 'imprint',
})) {
  app.get(from, (req, res) => res.redirect(301, `/${pages.langFor(req)}/${to}`));
}
// Der Rest der Adresse bleibt erhalten: `/app/servers/7` landete vorher stumpf auf `/de/app` und
// nahm damit genau die Stelle mit, zu der jemand wollte.
app.get(/^\/app(\/.*)?$/, (req, res) =>
  res.redirect(302, `/${pages.langFor(req)}/app${req.params[0] || ''}`)
);

// Das Dashboard ist eine Seite mit eigenem Router – jede Unteradresse liefert dieselbe Datei.
//
// Diese Regel steht **vor** der allgemeinen Seitenregel darunter: Sonst fing `/:lang/:page` die
// nackte Adresse `/de/app` ab, und der Inhaltsschutz galt nur für Unteradressen. Eine Prüfung, die
// von der Reihenfolge zweier Routen abhängt, ist keine.
app.get(/^\/(en|de)\/app(\/.*)?$/, protect.panelGuard, maintenanceGuard, (req, res) => {
  const lang = req.path.slice(1, 3);
  pages.setLangCookie(res, lang);
  res.type('html').send(renderApp(lang));
});

app.get('/:lang(en|de)', maintenanceGuard, (req, res) => {
  pages.setLangCookie(res, req.params.lang);
  res.type('html').send(renderPage('', req.params.lang));
});

app.get('/:lang(en|de)/:page', maintenanceGuard, (req, res, next) => {
  const { lang, page } = req.params;
  // Auch bei einer unbekannten Seite: Wer über einen deutschen Link hereinkommt, soll die
  // Fehlerseite auf Deutsch sehen und danach auf Deutsch weitersurfen.
  pages.setLangCookie(res, lang);
  if (!PAGES[page]) return next();
  res.type('html').send(renderPage(page, lang));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    // Wie unten in der Fehlerbehandlung: die Sprache der Anfrage, nicht die der ausgelieferten
    // Seite.
    const lang = langOf(req);
    return res.status(404).json({ error: lang === 'en' ? 'Unknown endpoint.' : 'Unbekannter Endpunkt.' });
  }
  const lang = pages.langFor(req);
  res
    .status(404)
    .type('html')
    .send(
      // Auch die Fehlerseite hat Kopf und Fuß, und beide brauchen ihre Platzhalter: ohne sie
      // stand auf der 404-Seite als einziger Seite der Website wörtlich `{{footerDiscord}}`.
      pages.render('404', lang, {
        ...landing.commonVars(lang),
        shield: protect.uiLocked() ? '1' : '0',
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
      .send(
        pages.render('404', lang, {
          ...landing.commonVars(lang),
          shield: protect.uiLocked() ? '1' : '0',
          robotsTag: NOINDEX,
          title: `${config.brand}`,
        })
      );
  }
  // Fehlermeldungen kommen in der Sprache der **Anfrage** zurück – das Frontend zeigt sie roh an.
  //
  // Deshalb `langOf` und nicht `langFor`: `langFor` beantwortet die Frage "welche Seite liefere
  // ich aus" und sieht zuerst im Sprach-Cookie nach. Für eine API-Antwort ist das die falsche
  // Quelle – das Panel schickt in jedem Aufruf die Sprache mit, in der es gerade angezeigt wird
  // (`Accept-Language`), und genau die soll gelten. Vorher kam in ein englisch angezeigtes Panel
  // die Liste auf Englisch und die Fehlermeldung daneben auf Deutsch, weil am Konto Deutsch stand.
  const lang = langOf(req);
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
// Langsame oder kopfzeilenreiche Verbindungen sollen keine Ressourcen unbegrenzt festhalten.
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

// Der Browser schickt ausschließlich kleine Ping-Nachrichten; der Discord-Bot strukturierte
// Ereignisse. Die ws-Vorgabe von 100 MB wäre für beide ein unnötig großer DoS-Hebel.
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
/** Eigener Server für die Bot-Leitung: andere Anmeldung, andere Nachrichten. */
const botSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
/**
 * Und einer für die Standorte. Sie melden sich mit dem Token ihres Eintrags an.
 *
 * Sechs Megabyte, nicht vier: Seit der texturierten Live-Ansicht reisen auch Bilder durch diese
 * Leitung. Der Standort deckelt eine Antwort bei zwei Megabyte, und Base64 macht daraus ein
 * Drittel mehr – dazwischen muss Luft bleiben, sonst wirft ausgerechnet das größte Bild die
 * ganze Verbindung ab und mit ihr jeden Bot auf dieser Maschine.
 */
const nodeSockets = new WebSocketServer({ noServer: true, maxPayload: 6 * 1024 * 1024 });

/** user_id -> Menge offener Verbindungen. */
const sockets = new Map();

/**
 * Wie viele Leitungen ein Konto gleichzeitig offen halten darf.
 *
 * Ein Mensch hat das Panel in zwei, drei Reitern offen, auf dem Rechner und auf dem Handy – zwölf
 * ist dafür reichlich. Ein Skript mit einem gültigen Cookie hatte dagegen gar keine Grenze: Jede
 * Verbindung ist ein offener Socket samt Puffer, und jede Zustandsmeldung eines Bots wird an jede
 * einzelne davon geschrieben. Ein Konto konnte damit den Speicher des Dienstes belegen und jede
 * Meldung vervielfachen, die für alle anderen mitläuft.
 *
 * Übrig bleiben die **jüngsten**: Wer eine dreizehnte aufmacht, verliert seine älteste. Anders
 * herum („die dreizehnte wird abgewiesen“) sperrte eine Handvoll hängengebliebener Leitungen den
 * Kunden aus seinem eigenen Panel aus, und das merkt er erst, wenn nichts mehr live nachkommt.
 */
const MAX_SOCKETS_PER_USER = 12;

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
  let upgradePath;
  try {
    upgradePath = new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    return socket.destroy();
  }
  // Die Leitung zum Discord-Bot. Sie hängt nicht an einer Sitzung, sondern am gemeinsamen
  // Geheimnis – der Bot ist kein Nutzer.
  if (upgradePath === '/api/bot/stream') {
    const header = String(req.headers.authorization || '');
    // Dieselbe Zählung wie bei den HTTP-Endpunkten des Bots: Ohne sie war der Aufbau einer
    // Leitung ein Ratefeld ohne Grenze, während dieselbe Prüfung nebenan nach zwanzig Fehlversuchen
    // zumachte.
    const result = tryBotSecret(req.socket.remoteAddress || 'unknown', header.startsWith('Bearer ') ? header.slice(7) : '');
    if (result !== 'ok') {
      socket.write(
        result === 'throttled'
          ? 'HTTP/1.1 429 Too Many Requests\r\n\r\n'
          : 'HTTP/1.1 401 Unauthorized\r\n\r\n'
      );
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
  if (upgradePath === '/api/node/stream') {
    // Dieselbe Zählung wie bei den HTTP-Endpunkten des Standorts: Ohne sie wäre der Aufbau einer
    // Leitung ein Ratefeld ohne Grenze, während dieselbe Prüfung nebenan nach zwanzig
    // Fehlversuchen zumacht.
    const { status, node } = tryNodeToken(req.socket.remoteAddress || 'unknown', req);
    if (!node) {
      socket.write(
        status === 'throttled'
          ? 'HTTP/1.1 429 Too Many Requests\r\n\r\n'
          : 'HTTP/1.1 401 Unauthorized\r\n\r\n'
      );
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

  if (upgradePath !== '/api/ws') return socket.destroy();
  if (!trustedOrigin(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  const value = auth.readCookie(req, 'afk_session');
  const row = auth.userForSession(value);
  if (!row || row.blocked) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = row.id;
    // Der rohe Wert bleibt ausschließlich im Serverprozess. Im 30-Sekunden-Takt wird damit
    // geprüft, ob Abmeldung, Passwortwechsel, Sperre oder gezielter Sitzungsentzug inzwischen
    // wirksam wurden; eine bereits offene Leitung darf diese Entscheidungen nicht überleben.
    ws.sessionToken = value;
    ws.isAlive = true;
    if (!sockets.has(row.id)) sockets.set(row.id, new Set());
    const open = sockets.get(row.id);
    // Eine Menge behält ihre Einfügereihenfolge – die ältesten stehen vorn.
    while (open.size >= MAX_SOCKETS_PER_USER) {
      const oldest = open.values().next().value;
      open.delete(oldest);
      try {
        oldest.close(1013, 'Zu viele offene Verbindungen.');
      } catch {
        oldest.terminate?.();
      }
    }
    open.add(ws);
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
// Ein Zustandswechsel ist gleichzeitig die Quelle für Live-Anzeige und persönliche Aktivität.
// Gemeldet werden nur Kanten, keine Zustände: hundert identische Snapshots eines Online-Bots sind
// eine Verbindung, nicht hundert Meldungen. Erfolgreiches Onlinekommen und erwartetes Stoppen
// bleiben still; Hilfe braucht nur ein echter Fehler oder eine abgelaufene Microsoft-Anmeldung.
const lastBotNoticeState = new Map();
supervisor.on('bot-state', ({ userId, key, state }) => {
  push(userId, { type: 'state', key, state });
  const before = lastBotNoticeState.get(key) || {};
  lastBotNoticeState.set(key, { state: state.state });
  const profileName = () =>
    db.prepare('SELECT name FROM profiles WHERE id = ? AND user_id = ?').get(state.profile_id, userId)?.name ||
    'Server';
  // Onlinekommen ist der erwartete Erfolg eines Starts und keine Nachricht. Besonders Zeitpläne
  // und automatische Wiederverbindungen erzeugten sonst täglich eine Aktivität, obwohl nichts
  // zu tun war. Nur Zustände, bei denen ein Mensch eingreifen muss, verlassen die Live-Ansicht.
  if (state.state === 'auth' && before.state !== 'auth') {
    notify.accountBroken(userId, state.account || 'Minecraft', state.detail || state.last_error || '');
  } else if (state.state === 'error' && before.state !== 'error') {
    notify.botTrouble(userId, state.account || 'Bot', state.detail || state.last_error || '');
  }
});
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
    // **Zuerst: sieht überhaupt jemand zu?** Was hier folgt, sind drei Abfragen – das Ticket, das
    // Team, die Beteiligten –, und am Ende steht `push`, das ohne offene Leitung nichts tut. Zu
    // diesen Ereignissen gehört auch „schreibt gerade …“, das beim Tippen laufend kommt: Ein
    // Support-Mitarbeiter, der eine Antwort schreibt, während niemand das Panel offen hat, löste
    // damit im Sekundentakt Arbeit aus, deren Ergebnis nirgendwo hinging.
    if (!sockets.size) return;
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

// Die wiederkehrenden Aufgaben stehen ab hier in server/jobs.js statt in anonymen Intervallen:
// Ein Fehler darin darf weiterhin höchstens einen Durchlauf kosten (ohne Aufrufer beendete er
// sonst den Prozess und mit ihm jeden Bot) – nur ist jetzt auch nachlesbar, wann eine Aufgabe
// zuletzt lief, wie lange sie brauchte und was dabei herauskam.

// Tote Verbindungen alle 30 s aussortieren – Browser, Bot wie Standort.
jobs.every(
  'verbindungen',
  30_000,
  () => {
    agents.heartbeat();
    for (const ws of [...wss.clients, ...botSockets.clients, ...nodeSockets.clients]) {
      if (wss.clients.has(ws)) {
        const current = auth.userForSession(ws.sessionToken);
        if (!current || current.blocked || current.id !== ws.userId) {
          ws.close(4001, 'Sitzung beendet.');
          continue;
        }
      }
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  },
  {
    label: { de: 'Tote Verbindungen aussortieren', en: 'Drop dead connections' },
    // Von Hand anzustoßen bringt hier nichts: Der Takt ist die halbe Bedeutung der Aufgabe.
    manual: false,
  }
);

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

  // `Number()` auf eine Einstellung, die auch Text sein kann, ergibt `NaN` – und `NaN` bindet
  // SQLite nicht. Diese Zeile warf dann mitten im Stundentakt, und weil sie aus einem `setInterval`
  // kommt, ging der ganze Prozess mit: keine Verlängerungen mehr, keine Warnungen, keine Bots.
  const low = Number(getSetting('low_balance'));
  const lowBalance = Number.isFinite(low) ? low : 0;
  for (const row of db
    .prepare('SELECT id, credits FROM users WHERE credits > 0 AND credits <= ?')
    .all(lowBalance)) {
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
const DAY_MS = 20 * 60 * 60 * 1000;
function onceADay(key) {
  const now = Date.now();
  if (now - (lastMailed.get(key) || 0) < DAY_MS) return false;
  lastMailed.set(key, now);
  // Je Serverplatz und je Konto ein Schlüssel, und der Dienst startet monatelang nicht neu:
  // gelöschte Plätze und Konten stünden hier für immer. Aufgeräumt wird, wenn es sich lohnt –
  // ein Eintrag, der älter ist als seine Sperrzeit, sagt ohnehin nichts mehr.
  if (lastMailed.size > 5_000) {
    for (const [entry, at] of lastMailed) {
      if (now - at > DAY_MS) lastMailed.delete(entry);
    }
  }
  return true;
}

jobs.every('abrechnung', 3_600_000, billingTick, {
  label: { de: 'Abrechnung: verlängern, mahnen, suspendieren', en: 'Billing: renew, warn, suspend' },
});
jobs.every('gratis-plaetze', 60_000, enforceFreePlans, {
  label: { de: 'Gratis-Plätze prüfen', en: 'Check free slots' },
});
/**
 * Und danach: hochfahren, was laufen soll und gerade nicht läuft.
 *
 * Derselbe Takt, aber in der anderen Richtung. Er ist das Netz für alles, was einen Bot
 * vorübergehend unmöglich gemacht hat und wieder vorbei ist – eine noch nicht bestätigte
 * Discord-Mitgliedschaft nach dem Hochfahren, ein Standort, der zurückkommt, ein Serverplatz, der
 * nach dem Aufladen fortgesetzt wurde. Ein abgestürzter Client kommt so nicht wieder: der löscht
 * seinen Startwunsch selbst.
 */
jobs.every(
  'wiederanlauf',
  60_000,
  () => {
    const started = supervisor.restoreAll();
    if (started) console.log(`${started} Bot(s) wieder gestartet.`);
  },
  { label: { de: 'Bots wieder hochfahren', en: 'Bring bots back up' } }
);

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
jobs.every('standort-eigen', 15_000, localNodeTick, {
  label: { de: 'Eigene Auslastung melden', en: 'Report own load' },
  manual: false,
});

/**
 * Zeitpläne: Was fällig ist, wird ausgeführt.
 *
 * Jede Minute – seltener ginge nicht, denn ein Zeitplan ist auf die Minute genau. Was in dieser
 * Minute nicht fällig ist, kostet nichts: Der Takt liest eine Handvoll Zeilen und rechnet daran
 * eine Uhrzeit aus.
 */
jobs.every(
  'zeitplaene',
  60_000,
  () => {
    const done = schedules.tick();
    if (done) console.log(`${done} Zeitplan/Zeitpläne ausgeführt.`);
  },
  { label: { de: 'Zeitpläne der Serverplätze', en: 'Server slot schedules' } }
);

/**
 * Der Zustand der Anlage in den Webhook des Betreibers.
 *
 * Der Takt ist eng (alle fünf Minuten), der **Bericht** kommt trotzdem nur alle paar Stunden:
 * Warnungen sollen sofort da sein, ein Lagebericht nicht. Was wie oft hinausgeht, entscheidet
 * `systemreport.tick()` – siehe die Erklärung dort.
 */
jobs.every(
  'systembericht',
  5 * 60_000,
  () => systemreport.tick(),
  { label: { de: 'Systembericht und Warnungen', en: 'System report and alerts' } }
);

/**
 * Konten, deren Frist abgelaufen ist, wirklich löschen.
 *
 * Eigene Aufgabe und nicht Teil des Aufräumens: Das Aufräumen darf jederzeit ohne Folgen laufen,
 * diese hier nicht. Sie steht deshalb mit eigenem Namen in der Liste im Admin-Bereich, mit
 * eigenem letzten Lauf und eigenem Fehler – und der Knopf "jetzt laufen" daneben tut genau eine
 * nachvollziehbare Sache.
 */
jobs.every(
  'kontoloeschungen',
  3_600_000,
  () => {
    const done = account.runDueDeletions();
    if (done) console.log(`${done} Konto/Konten nach Ablauf der Frist gelöscht.`);
  },
  { label: { de: 'Fällige Kontolöschungen ausführen', en: 'Carry out due account deletions' } }
);

// Stündlich: abgelaufene Sitzungen weg, Client-Release nachsehen, liegengebliebene Anhänge weg.
jobs.every(
  'aufraeumen',
  3_600_000,
  () => {
    auth.cleanupSessions();
    security.cleanup();
    // Abgelaufene Anmeldecodes und Browser, die seit über einem Jahr nicht mehr da waren.
    logincode.cleanup();
    // Und angefangene Einrichtungen der Zwei-Faktor-Anmeldung, die nie bestätigt wurden.
    totp.cleanup();
    // Köpfe von Konten, die es längst nicht mehr gibt. Sie kosten nichts als Platz, aber der
    // Zwischenspeicher soll nicht ewig alles behalten, was einmal jemand angelegt hat.
    heads.cleanup();
    // Höchstens eine Sicherung am Tag, und nur wenn sie eingeschaltet ist. Die Entscheidung
    // fällt an der jüngsten Datei – ein Neustart um drei Uhr nachts vergisst so keinen Tag.
    const made = backup.dailyTick();
    if (made) console.log(`Sicherung angelegt: ${made.name}`);
    attachments.sweepOrphans();
    // Der Client. Was sich am Release geändert hat, liegt danach auf der Platte – **laufende Bots
    // wechseln dabei nicht mit**: Ein Prozess hält seine Datei, und ein Bot, der seit zwei Wochen
    // im Spiel sitzt, sitzt dort mit der Datei von vor zwei Wochen. Das ist Absicht (ein Neustart
    // wirft ihn aus dem Spiel, und den Zeitpunkt dafür soll ein Mensch wählen) – aber es muss
    // jemandem auffallen, und genau dafür stehen die beiden Zeilen darunter.
    const before = binaries.state.clientVersion;
    return binaries.sync().then(() => {
      agents.syncAll();
      const after = binaries.state.clientVersion;
      if (!after || after === before) return;
      const running = supervisor.runningCount();
      console.log(
        `Neue Client-Fassung: ${before || '–'} → ${after}.` +
          (running ? ` ${running} laufende(r) Bot(s) benutzen weiter die alte, bis sie neu starten.` : '')
      );
      systemreport.event(
        'New client version',
        [
          `${before || 'none'} → ${after}`,
          running
            ? `${running} bot(s) are still running the old file. Roll them over under Admin · Client.`
            : 'Nothing is running, so the next start uses it.',
        ].join('\n')
      );
    });
  },
  { label: { de: 'Aufräumen, sichern, Client abgleichen', en: 'Clean up, back up, sync client' } }
);

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
    // Und ein Wort in den Webhook des Betreibers. Wer nachts einen Neustart sieht, den niemand
    // ausgelöst hat, weiß damit mehr als jeder Bericht am Morgen ihm sagen könnte. Im Testlauf
    // bleibt es aus – dort gibt es keinen Webhook, und ein Aufruf ins Netz macht Tests langsam.
    if (process.env.NODE_ENV !== 'test') systemreport.announceStart();
  });
};

// Ein Fehler beim Hochfahren gehört ins Protokoll und nicht in eine unbehandelte Zurückweisung:
// Node beendet den Prozess dann kommentarlos, und im Journal steht nichts, woran sich ablesen
// ließe, warum der Dienst nicht kam.
started().catch((error) => {
  console.error('[start] Der Dienst konnte nicht hochfahren:', error);
  process.exitCode = 1;
});

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
