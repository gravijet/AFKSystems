// Anonyme Reichweiten-Statistik: wie viele Aufrufe, von wo, wie viel davon Suchmaschinen und
// andere automatisierte Abrufer statt echter Besucher.
//
// Es gibt bewusst **keine** Kennung, die zwei Besuche derselben Person verbindet. Für "wie viele
// verschiedene Leute" reicht ein Wert, der sich mit dem Kalendertag jede Nacht ändert und aus IP
// und grober Browserkennung entsteht (HMAC-Muster wie `capabilityDigest` in auth.js, nur mit dem
// Tag statt eines festen Zwecks als Eingabe) – niemand kann daraus rückwärts auf eine IP
// schließen, und die Verbindung zwischen zwei Tagen verschwindet von selbst. Es wird keine rohe
// IP-Adresse gespeichert, und es gibt kein Cookie – die Datenschutzerklärung verspricht "keine
// Tracking-Cookies", und das bleibt so.
//
// "Bot" heißt hier: ein Suchmaschinen-Crawler oder ein Werkzeug außerhalb eines Browsers, das die
// Webseite abruft. Nicht gemeint sind die Minecraft-AFK-Bots des Produkts (Tabelle `bots`) – die
// haben ihre eigene Übersicht.

import { createHmac } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

/** Sechs Monate reichen für jede sinnvolle Rückschau; danach wächst die Tabelle ohne Nutzen weiter. */
const KEEP_MS = 180 * 86_400_000;

/**
 * Bekannte Suchmaschinen-, Vorschau- und Werkzeug-Kennungen.
 *
 * Zum Einordnen für die Statistik, nicht zum Aussperren – das Aussperren einzelner Werkzeuge
 * erledigt `protect.js` für die Werk-Dateien, die öffentlichen Seiten selbst bleiben für jeden
 * Crawler offen.
 */
const BOTS =
  /(bot|crawl|spider|slurp|archiver|facebookexternalhit|whatsapp|telegrambot|discordbot|slackbot|preview|headless|lighthouse|pingdom|uptimerobot|ahrefs|semrush|mj12bot|dotbot|curl|wget|python-requests|scrapy|go-http-client|node-fetch|okhttp|axios|httpie|libwww)/i;

/** Ob eine Browserkennung zu einem der bekannten Muster passt. */
export const isBot = (userAgent) => BOTS.test(String(userAgent || ''));

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Täglich wechselnder, nicht auf eine Person zurückführbarer Kennwert für "eindeutige Besucher". */
function visitorHash(req, day) {
  const ua = String(req.headers['user-agent'] || '').slice(0, 80);
  return createHmac('sha256', config.secret).update(`${day}:${req.ip}:${ua}`).digest('hex').slice(0, 16);
}

/** Nur der Hostname der verweisenden Seite – eigene Adresse zählt als "direkt", nicht als Quelle. */
function referrerHost(req) {
  const raw = req.headers.referer || req.headers.referrer;
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '');
    const own = new URL(config.publicUrl).hostname.replace(/^www\./, '');
    return host === own ? null : host;
  } catch {
    return null;
  }
}

/**
 * Einen Seitenaufruf verbuchen.
 *
 * Darf nie eine Seitenauslieferung stören – ein Fehler hier kostet höchstens diese eine Zeile
 * Statistik, niemals die Seite selbst.
 */
export function track(req, path) {
  try {
    const ua = req.headers['user-agent'];
    db.prepare(
      `INSERT INTO page_views (path, referrer_host, country, lang, is_bot, visitor_hash, logged_in, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      path,
      referrerHost(req),
      String(req.headers['cf-ipcountry'] || '').toUpperCase().slice(0, 2) || null,
      req.params?.lang || null,
      isBot(ua) ? 1 : 0,
      visitorHash(req, dayKey()),
      req.user ? 1 : 0,
      Date.now()
    );
  } catch (error) {
    console.error('Seitenaufruf konnte nicht verbucht werden:', error);
  }
}

/** Zeilen älter als die Aufbewahrungsfrist weg. Läuft im Stundentakt aus index.js. */
export function cleanup() {
  db.prepare('DELETE FROM page_views WHERE created_at < ?').run(Date.now() - KEEP_MS);
}

const topN = (map, n = 10) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, value]) => ({ label, value }));

/**
 * Die Besucher-Statistik der Administration – lückenlose Tagesreihe wie bei `/admin/stats`, keine
 * eigene Rollup-Tabelle: `page_views` ist bereits das Rohereignis, ein zweiter Zwischenstand daneben
 * würde irgendwann auseinanderlaufen.
 *
 * Bestenlisten (Quellen, Seiten, Länder) zählen nur echte Besuche: Ein Crawler, der in einer Nacht
 * jede Adresse einmal abruft, soll nicht "die beliebteste Seite" verzerren.
 */
export function summary({ days = 30 } = {}) {
  const span = Math.min(90, Math.max(7, Number(days) || 30));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (span - 1));
  const from = start.getTime();

  const buckets = new Map();
  for (let i = 0; i < span; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    buckets.set(dayKey(date), { views: 0, visitors: new Set() });
  }

  const rows = db
    .prepare(
      'SELECT path, referrer_host, country, is_bot, visitor_hash, created_at FROM page_views WHERE created_at >= ?'
    )
    .all(from);

  const referrers = new Map();
  const paths = new Map();
  const countries = new Map();
  const allVisitors = new Set();
  let bots = 0;
  let humans = 0;

  for (const row of rows) {
    const bucket = buckets.get(dayKey(new Date(row.created_at)));
    if (bucket) bucket.views += 1;
    if (row.is_bot) {
      bots += 1;
      continue;
    }
    humans += 1;
    allVisitors.add(row.visitor_hash);
    if (bucket) bucket.visitors.add(row.visitor_hash);
    const ref = row.referrer_host || 'direkt';
    referrers.set(ref, (referrers.get(ref) || 0) + 1);
    paths.set(row.path, (paths.get(row.path) || 0) + 1);
    if (row.country) countries.set(row.country, (countries.get(row.country) || 0) + 1);
  }

  return {
    days: span,
    views_days: [...buckets].map(([day, bucket]) => ({ day, value: bucket.views })),
    visitor_days: [...buckets].map(([day, bucket]) => ({ day, value: bucket.visitors.size })),
    totals: { views: rows.length, visitors: allVisitors.size, bots, humans },
    top_referrers: topN(referrers),
    top_paths: topN(paths),
    top_countries: topN(countries),
  };
}
