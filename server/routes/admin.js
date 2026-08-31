// Der Admin-Bereich. Alles, was der Betreiber im Alltag braucht, ohne je an die Datenbank zu
// müssen: Nutzer, Tarife, Guthaben, Gutscheine, Aufladungen, Proxys, Tickets, Ankündigungen,
// Einstellungen, Client-Dateien, laufende Bots und das Protokoll.

import express from 'express';
import { config, paths } from '../config.js';
import { db, setSetting, allSettings, audit, settingDefaults } from '../db.js';
import * as auth from '../auth.js';
import * as billing from '../billing.js';
import * as binaries from '../binaries.js';
import * as resources from '../resources.js';
import * as mail from '../mail.js';
import * as oauth from '../oauth.js';
import * as tickets from '../tickets.js';
import * as roles from '../roles.js';
import * as linkedRoles from '../linked-roles.js';
import * as nodes from '../nodes.js';
import * as agents from '../agents.js';
import * as metrics from '../metrics.js';
import * as stripe from '../stripe.js';
import { supervisor } from '../supervisor.js';
import { staffTodos } from '../todos.js';
import { planView, ticketView } from './core.js';
import { botState, MIN_SECRET } from './bot.js';
import { bridge } from '../bridge.js';
import { SETTINGS, byKey as settingSchema, schemaFor } from '../settings-schema.js';
import { mergeLines } from '../../public/assets/js/chatlog.js';
import { wrap, requireInt, requireString, bad, notFound, hashPassword, parseAddress, formatCredits, langOf } from '../util.js';

export const admin = express.Router();
admin.use(auth.requireUser, auth.requireAdmin);

// ---------------------------------------------------------------- Überblick

admin.get(
  '/overview',
  wrap((req, res) => {
    const day = Date.now() - 86_400_000;
    const month = Date.now() - 30 * 86_400_000;
    res.json({
      // Was das Team gerade zu tun hat – dieselbe Sorte Liste wie beim Kunden, nur für die andere
      // Seite des Schreibtisches. Sie steht in server/todos.js und nicht hier: Ob etwas zu tun
      // ist, entscheidet die Datenbank und nicht die Oberfläche.
      todos: staffTodos(langOf(req)),
      users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      users_new_30d: db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at > ?').get(month).n,
      users_active_24h: db.prepare('SELECT COUNT(*) AS n FROM users WHERE last_seen_at > ?').get(day).n,
      users_blocked: db.prepare('SELECT COUNT(*) AS n FROM users WHERE blocked = 1').get().n,
      users_unverified: db.prepare('SELECT COUNT(*) AS n FROM users WHERE email_verified = 0').get().n,
      accounts: db.prepare('SELECT COUNT(*) AS n FROM mc_accounts').get().n,
      profiles: db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n,
      profiles_paid: db
        .prepare(
          "SELECT COUNT(*) AS n FROM profiles p JOIN plans pl ON pl.id = p.plan_id WHERE pl.free_slot = 0 AND p.paid_until > ?"
        )
        .get(Date.now()).n,
      profiles_suspended: db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE suspended = 1').get().n,
      bots_running: supervisor.runningCount(),
      bots_online: [...supervisor.bots.values()].filter((bot) => bot.online).length,
      credits_outstanding: db.prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM users').get().n,
      revenue_cent: db
        .prepare("SELECT COALESCE(SUM(amount_cent), 0) AS n FROM topups WHERE status = 'paid'")
        .get().n,
      revenue_30d_cent: db
        .prepare("SELECT COALESCE(SUM(amount_cent), 0) AS n FROM topups WHERE status = 'paid' AND paid_at > ?")
        .get(month).n,
      open_topups: db.prepare("SELECT COUNT(*) AS n FROM topups WHERE status = 'open'").get().n,
      tickets: tickets.counts(),
      open_tickets: db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status != 'closed'").get().n,
      unread_tickets: tickets.openForStaff(),
      nodes: nodes.list({ includeInactive: true }).length,
      client: clientState(),
      mail: {
        configured: mail.configured(),
        verify: mail.verifyRequired(),
        sent_24h: db
          .prepare("SELECT COUNT(*) AS n FROM mails WHERE created_at > ? AND status = 'sent'")
          .get(day).n,
        failed_24h: db
          .prepare("SELECT COUNT(*) AS n FROM mails WHERE created_at > ? AND status = 'failed'")
          .get(day).n,
      },
      oauth: oauth.state(),
      bot: botState(),
      settings: safeSettings(),
    });
  })
);

/**
 * Zahlen über die Zeit – die Grundlage der Diagramme im Admin-Bereich.
 *
 * Alles kommt aus Tabellen, die ohnehin geführt werden: `topups` weiß, wann welches Geld kam,
 * `users` wann sich jemand angemeldet hat, `ledger` wohin die Credits gehen, `tickets` wie viel
 * Arbeit hereinkommt. Es gibt **keine** eigene Statistiktabelle: eine zweite Buchführung neben der
 * ersten geht irgendwann auseinander, und dann glaubt niemand mehr einer von beiden.
 *
 * Alle Reihen sind lückenlos: Ein Tag ohne Umsatz ist eine Null und kein fehlender Punkt. Sonst
 * schöbe sich die Kurve an einer ruhigen Woche zusammen und sähe aus wie ein Einbruch.
 */
admin.get(
  '/stats',
  wrap((req, res) => {
    const lang = langOf(req);
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));

    /** Ein Korb je Tag, von vor `days` Tagen bis heute – in Ortszeit, nicht in UTC. */
    const dayKey = (date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const from = start.getTime();

    const series = (rows, field = 'value') => {
      const buckets = new Map();
      for (let i = 0; i < days; i++) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        buckets.set(dayKey(date), 0);
      }
      for (const row of rows) {
        const key = dayKey(new Date(row.at));
        if (buckets.has(key)) buckets.set(key, buckets.get(key) + (row[field] || 0));
      }
      return [...buckets].map(([day, value]) => ({ day, value }));
    };

    // Zwölf Monatskörbe für den langen Blick aufs Geld.
    const monthStart = new Date();
    monthStart.setHours(0, 0, 0, 0);
    monthStart.setDate(1);
    monthStart.setMonth(monthStart.getMonth() - 11);
    const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const months = new Map();
    for (let i = 0; i < 12; i++) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth() + i, 1);
      months.set(monthKey(date), 0);
    }
    for (const row of db
      .prepare("SELECT paid_at AS at, amount_cent FROM topups WHERE status = 'paid' AND paid_at >= ?")
      .all(monthStart.getTime())) {
      const key = monthKey(new Date(row.at));
      if (months.has(key)) months.set(key, months.get(key) + row.amount_cent);
    }

    const bots = [...supervisor.bots.values()];
    const planName = (row) => (lang === 'de' ? row.name_de : row.name_en) || row.slug;

    res.json({
      days,
      // --- über die Zeit ------------------------------------------------------------------
      revenue_days: series(
        db
          .prepare("SELECT paid_at AS at, amount_cent AS value FROM topups WHERE status = 'paid' AND paid_at >= ?")
          .all(from)
      ),
      revenue_months: [...months].map(([month, cent]) => ({ month, cent })),
      signups: series(db.prepare('SELECT created_at AS at, 1 AS value FROM users WHERE created_at >= ?').all(from)),
      tickets_days: series(
        db.prepare('SELECT created_at AS at, 1 AS value FROM tickets WHERE created_at >= ?').all(from)
      ),
      // Was an Credits ausgegeben wurde (Tarife und Zusätze) – das ist die Gegenrichtung zum Umsatz
      // und zeigt, ob gekauftes Guthaben auch benutzt wird.
      spent_days: series(
        db
          .prepare("SELECT created_at AS at, -delta AS value FROM ledger WHERE delta < 0 AND kind IN ('plan','addon') AND created_at >= ?")
          .all(from)
      ),
      // --- wie es sich gerade verteilt ----------------------------------------------------
      by_plan: db
        .prepare(
          `SELECT pl.slug, pl.name_de, pl.name_en, pl.price_credits, COUNT(p.id) AS n
             FROM plans pl LEFT JOIN profiles p ON p.plan_id = pl.id
            GROUP BY pl.id ORDER BY pl.sort, pl.id`
        )
        .all()
        .map((row) => ({ label: planName(row), slug: row.slug, n: row.n, price_credits: row.price_credits })),
      by_provider: db
        .prepare(
          "SELECT provider AS label, COUNT(*) AS n, COALESCE(SUM(amount_cent), 0) AS cent FROM topups WHERE status = 'paid' GROUP BY provider ORDER BY cent DESC"
        )
        .all(),
      by_ticket_status: db
        .prepare('SELECT status AS label, COUNT(*) AS n FROM tickets GROUP BY status')
        .all(),
      by_bot_state: Object.entries(
        bots.reduce((out, bot) => {
          out[bot.state] = (out[bot.state] || 0) + 1;
          return out;
        }, {})
      ).map(([label, n]) => ({ label, n })),
      by_account_status: db
        .prepare('SELECT status AS label, COUNT(*) AS n FROM mc_accounts GROUP BY status')
        .all(),
      // --- Bestenlisten -------------------------------------------------------------------
      top_slots: db
        .prepare(
          `SELECT p.name AS label, u.username, COALESCE(SUM(b.uptime_sec), 0) AS seconds
             FROM profiles p JOIN users u ON u.id = p.user_id
        LEFT JOIN bots b ON b.profile_id = p.id
            GROUP BY p.id HAVING seconds > 0 ORDER BY seconds DESC LIMIT 8`
        )
        .all(),
      top_customers: db
        .prepare(
          `SELECT u.username AS label, COALESCE(SUM(t.amount_cent), 0) AS cent
             FROM users u JOIN topups t ON t.user_id = u.id AND t.status = 'paid'
            GROUP BY u.id ORDER BY cent DESC LIMIT 8`
        )
        .all(),
      // --- Summen, die neben den Kurven stehen --------------------------------------------
      totals: {
        revenue_cent: db.prepare("SELECT COALESCE(SUM(amount_cent), 0) AS n FROM topups WHERE status = 'paid'").get().n,
        refunded_cent: db
          .prepare("SELECT COALESCE(SUM(amount_cent), 0) AS n FROM topups WHERE status = 'refunded'")
          .get().n,
        credits_outstanding: db.prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM users').get().n,
        users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
        profiles: db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n,
        bots_online: bots.filter((bot) => bot.online).length,
        uptime_sec: db.prepare('SELECT COALESCE(SUM(uptime_sec), 0) AS n FROM bots').get().n,
      },
    });
  })
);

/**
 * Was die Maschine gerade tut.
 *
 * Steht bewusst nicht in /overview: die Werte kommen aus zwei Messungen im Abstand und sollen im
 * Sekundentakt abgefragt werden können, ohne dass dabei jedes Mal die halbe Datenbank gezählt wird.
 */
admin.get(
  '/metrics',
  wrap(async (req, res) => {
    const snapshot = await metrics.snapshot();
    const perProfile = metrics.byProfile();
    res.json({
      ...snapshot,
      profiles: [...perProfile.values()].map((entry) => {
        const row = db
          .prepare('SELECT p.name, p.user_id, u.username FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.id = ?')
          .get(entry.profile_id);
        return {
          ...entry,
          disk: metrics.diskOfProfile(entry.profile_id),
          name: row?.name || `#${entry.profile_id}`,
          user_id: row?.user_id,
          username: row?.username,
        };
      }),
    });
  })
);

// ---------------------------------------------------------------- Suche über alles

/**
 * Eine Suche für den ganzen Admin-Bereich.
 *
 * Der Betreiber hat selten eine Tabelle im Kopf, sondern einen Anhaltspunkt: eine Mailadresse aus
 * einer Beschwerde, den Namen eines Bots aus einem Screenshot, eine Ticketnummer aus Discord, den
 * Gutscheincode von einem Zettel. Vorher hieß das: erraten, in welcher Liste das Ding wohl steht,
 * dorthin klicken, dort noch einmal suchen. Ein Anhaltspunkt gehört aber nicht zu einer Tabelle,
 * sondern zu einer Sache – deshalb fragt diese Stelle alle Tabellen und sortiert die Antwort nach
 * Art, nicht nach Herkunft.
 *
 * Jeder Treffer bringt seinen eigenen Weg mit (`route`). Damit weiß die Oberfläche nicht, wie ein
 * Nutzer, ein Serverplatz oder ein Ticket adressiert wird – das steht hier, an einer Stelle, und
 * kann nicht zwischen Palette und Liste auseinanderlaufen.
 *
 * Absichtlich ohne Volltextindex: Bei dieser Größe ist `LIKE` über ein paar tausend Zeilen schnell
 * genug, und ein Index, der beim Schreiben gepflegt werden muss, ist ein zweiter Datenbestand, der
 * irgendwann nicht mehr zum ersten passt.
 */
const SEARCH_LIMIT = 6;

admin.get(
  '/search',
  wrap((req, res) => {
    const raw = String(req.query.q || '').trim();
    // Eine reine Zahl ist meistens eine Nummer und keine Zeichenkette: Wer "412" eintippt, meint
    // Ticket 412 oder Nutzer 412 – und will ihn oben sehen, nicht hinter jedem Namen, in dem
    // zufällig eine 412 vorkommt.
    const id = /^\d{1,9}$/.test(raw) ? Number(raw) : null;
    // Ein einzelnes Zeichen ist keine Suche: `LIKE '%a%'` liest jede Zeile jeder Tabelle und
    // liefert alles zurück, was ein a enthält – das ist keine Antwort, sondern ein Ausdruck der
    // Datenbank. **Eine einzelne Ziffer** ist trotzdem eine gültige Frage, weil Ticket 7 und
    // Nutzer 7 wirklich so heißen; dann wird nur nach der Nummer gesucht und nach nichts sonst.
    if (!raw || (raw.length < 2 && id === null)) return res.json({ query: raw, groups: [] });

    const lang = langOf(req);
    // `spalte LIKE NULL` ist in SQL nie wahr. Das ist der ehrlichste Weg, den Textteil einer
    // Suche stillzulegen, ohne dafür ein zweites Abfragegerüst danebenzustellen.
    const like =
      raw.length < 2 ? null : `%${raw.replace(/[%_]/g, (char) => `\\${char}`)}%`;
    const groups = [];
    const add = (kind, label, rows) => {
      if (rows.length) groups.push({ kind, label, hits: rows });
    };

    add(
      'users',
      lang === 'de' ? 'Nutzer' : 'Users',
      db
        .prepare(
          `SELECT id, username, email, credits, blocked, role FROM users
            WHERE id = ? OR username LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'
               OR discord_name LIKE ? ESCAPE '\\' OR discord_id = ?
            ORDER BY (id = ?) DESC, last_seen_at DESC LIMIT ?`
        )
        .all(id ?? -1, like, like, like, raw, id ?? -1, SEARCH_LIMIT)
        .map((row) => ({
          id: row.id,
          title: row.username,
          sub: row.email,
          route: `/admin/users/${row.id}`,
          tags: [row.role === 'admin' ? 'admin' : '', row.blocked ? 'blocked' : ''].filter(Boolean),
          value: formatCredits(row.credits, lang),
        }))
    );

    add(
      'servers',
      lang === 'de' ? 'Serverplätze' : 'Server slots',
      db
        .prepare(
          `SELECT p.id, p.name, p.host, p.port, p.suspended, p.locked, u.username FROM profiles p
             JOIN users u ON u.id = p.user_id
            WHERE p.id = ? OR p.name LIKE ? ESCAPE '\\' OR p.host LIKE ? ESCAPE '\\'
            ORDER BY (p.id = ?) DESC, p.id DESC LIMIT ?`
        )
        .all(id ?? -1, like, like, id ?? -1, SEARCH_LIMIT)
        .map((row) => ({
          id: row.id,
          title: row.name,
          sub: `${row.port ? `${row.host}:${row.port}` : row.host} · ${row.username}`,
          route: `/admin/servers/${row.id}`,
          tags: [row.suspended ? 'suspended' : '', row.locked ? 'locked' : ''].filter(Boolean),
          value: supervisor.runningOnProfile(row.id) ? 'online' : '',
        }))
    );

    add(
      'accounts',
      lang === 'de' ? 'Accounts' : 'Accounts',
      db
        .prepare(
          `SELECT a.id, a.name, a.kind, a.status, a.suspended, a.user_id, u.username FROM mc_accounts a
             JOIN users u ON u.id = a.user_id
            WHERE a.name LIKE ? ESCAPE '\\' OR a.uuid LIKE ? ESCAPE '\\'
            ORDER BY a.name LIMIT ?`
        )
        .all(like, like, SEARCH_LIMIT)
        .map((row) => ({
          id: row.id,
          title: row.name,
          sub: `${row.kind} · ${row.username}`,
          // Ein Account hat keine eigene Seite; er gehört zu seinem Nutzer, und dort steht er.
          route: `/admin/users/${row.user_id}`,
          tags: [row.suspended ? 'suspended' : '', row.status === 'error' ? 'error' : ''].filter(Boolean),
          value: '',
        }))
    );

    add(
      'tickets',
      lang === 'de' ? 'Tickets' : 'Tickets',
      db
        .prepare(
          `SELECT t.id, t.subject, t.status, t.priority, u.username FROM tickets t
             JOIN users u ON u.id = t.user_id
            WHERE t.id = ? OR t.subject LIKE ? ESCAPE '\\'
               OR EXISTS (SELECT 1 FROM ticket_messages m WHERE m.ticket_id = t.id AND m.body LIKE ? ESCAPE '\\')
            ORDER BY (t.id = ?) DESC, t.updated_at DESC LIMIT ?`
        )
        .all(id ?? -1, like, like, id ?? -1, SEARCH_LIMIT)
        .map((row) => ({
          id: row.id,
          title: `#${row.id} ${row.subject}`,
          sub: row.username,
          route: `/admin/tickets/${row.id}`,
          tags: [row.status, row.priority === 'urgent' || row.priority === 'high' ? row.priority : ''].filter(Boolean),
          value: '',
        }))
    );

    add(
      'vouchers',
      lang === 'de' ? 'Gutscheine' : 'Vouchers',
      db
        .prepare(
          `SELECT code, credits, uses_left FROM vouchers WHERE code LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`
        )
        .all(like, SEARCH_LIMIT)
        .map((row) => ({
          id: row.code,
          title: row.code,
          sub: formatCredits(row.credits, lang),
          route: '/admin/vouchers',
          tags: row.uses_left > 0 ? [] : ['used'],
          value: '',
        }))
    );

    add(
      'nodes',
      lang === 'de' ? 'Standorte' : 'Locations',
      db
        .prepare(
          `SELECT id, name, kind, region, active FROM nodes
            WHERE name LIKE ? ESCAPE '\\' OR region LIKE ? ESCAPE '\\' ORDER BY sort, id LIMIT ?`
        )
        .all(like, like, SEARCH_LIMIT)
        .map((row) => ({
          id: row.id,
          title: row.name,
          sub: `${row.kind}${row.region ? ` · ${row.region}` : ''}`,
          route: '/admin/nodes',
          tags: row.active ? [] : ['inactive'],
          value: '',
        }))
    );

    add(
      'topups',
      lang === 'de' ? 'Aufladungen' : 'Top-ups',
      db
        .prepare(
          `SELECT t.id, t.amount_cent, t.credits, t.status, t.provider, t.reference, u.username FROM topups t
             JOIN users u ON u.id = t.user_id
            WHERE t.id = ? OR t.reference LIKE ? ESCAPE '\\' OR t.external_id LIKE ? ESCAPE '\\'
            ORDER BY (t.id = ?) DESC, t.id DESC LIMIT ?`
        )
        .all(id ?? -1, like, like, id ?? -1, SEARCH_LIMIT)
        .map((row) => ({
          id: row.id,
          title: `#${row.id} ${formatCredits(row.credits, lang)}`,
          sub: `${row.provider} · ${row.username}`,
          route: '/admin/topups',
          tags: [row.status],
          value: '',
        }))
    );

    res.json({ query: raw, groups });
  })
);

function clientState() {
  return {
    tag: binaries.state.tag,
    version: binaries.state.clientVersion,
    versions: binaries.state.versions,
    default_version: binaries.state.defaultVersion,
    checked: binaries.state.checkedAt,
    published: binaries.state.publishedAt,
    error: binaries.state.error,
    builds: binaries.state.builds,
    files: binaries.files(),
    dir: paths.bin,
    // Die Minecraft-Ressourcen gehören dazu, auch wenn sie nicht aus dem Release kommen: Ohne sie
    // gibt es die texturierte Live-Ansicht nicht, und der einzige Ort, an dem das auffällt, wäre
    // sonst ein Kunde, der einen Zusatz bezahlt hat und ein Voxelbild bekommt.
    resources: resources.list(binaries.state.versions),
    resources_dir: paths.resources,
  };
}

/**
 * Einstellungen ohne Geheimnisse.
 *
 * Ein Geheimnis verlässt diesen Server nicht: Das Panel erfährt nur, **ob** eines hinterlegt ist,
 * nie welches. Vorher kamen zwei davon als Punktreihe zurück und alle anderen im Klartext – ein
 * Bot-Token oder ein Webhook im HTML einer Seite ist so gut wie veröffentlicht.
 */
function safeSettings() {
  const settings = allSettings();
  const out = { ...settings };
  const secrets = {};
  for (const entry of SETTINGS) {
    if (!entry.secret) continue;
    secrets[entry.key] = Boolean(String(settings[entry.key] || '').trim());
    delete out[entry.key];
  }
  return { ...out, secrets };
}

// ---------------------------------------------------------------- Nutzer

const userRow = (row) => ({
  id: row.id,
  email: row.email,
  username: row.username,
  role: row.role,
  credits: row.credits,
  blocked: Boolean(row.blocked),
  email_verified: Boolean(row.email_verified),
  language: row.language,
  discord: row.discord_id ? { id: row.discord_id, name: row.discord_name } : null,
  discord_moderator: Boolean(row.discord_moderator),
  discord_partner: Boolean(row.discord_partner),
  discord_vip: Boolean(row.discord_vip),
  discord_guild_member: Boolean(row.discord_guild_member),
  discord_guild_checked_at: row.discord_guild_checked_at || null,
  discord_roles: roles.targetFor(row).badges,
  premium_until: row.premium_until,
  proxy_allowance: row.proxy_allowance,
  notes: row.notes || '',
  created_at: row.created_at,
  last_seen_at: row.last_seen_at,
  accounts: row.accounts ?? undefined,
  profiles: row.profiles ?? undefined,
  paid_profiles: row.paid_profiles ?? undefined,
  monthly: row.monthly ?? undefined,
  bots_running: supervisor.list(row.id).filter((bot) => bot.state !== 'offline').length,
});

admin.get(
  '/users',
  wrap((req, res) => {
    const search = String(req.query.q || '').trim();
    const filter = String(req.query.filter || 'all');
    const where = [];
    const values = [];
    if (search) {
      where.push('(u.username LIKE ? OR u.email LIKE ? OR u.discord_name LIKE ?)');
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (filter === 'admins') where.push("u.role = 'admin'");
    if (filter === 'blocked') where.push('u.blocked = 1');
    if (filter === 'unverified') where.push('u.email_verified = 0');
    if (filter === 'paying') {
      where.push(
        `EXISTS (SELECT 1 FROM profiles p JOIN plans pl ON pl.id = p.plan_id
                  WHERE p.user_id = u.id AND pl.free_slot = 0 AND p.paid_until > ${Date.now()})`
      );
    }

    const rows = db
      .prepare(
        `SELECT u.*,
                (SELECT COUNT(*) FROM mc_accounts a WHERE a.user_id = u.id) AS accounts,
                (SELECT COUNT(*) FROM profiles p WHERE p.user_id = u.id) AS profiles,
                (SELECT COUNT(*) FROM profiles p JOIN plans pl ON pl.id = p.plan_id
                  WHERE p.user_id = u.id AND pl.free_slot = 0 AND p.paid_until > ${Date.now()}) AS paid_profiles,
                -- Die Zusätze gehören mit hinein. Ohne sie stand in der Nutzerliste ein anderer
                -- Monatsbetrag als überall sonst im Panel (billing.monthlyCost rechnet sie mit) –
                -- wer die Liste zum Abgleich benutzte, verglich zwei verschiedene Zahlen.
                (SELECT COALESCE(SUM(pl.price_credits + COALESCE(
                          (SELECT SUM(a.price_credits * pa.qty) FROM profile_addons pa
                             JOIN addons a ON a.id = pa.addon_id WHERE pa.profile_id = p.id), 0)), 0)
                   FROM profiles p JOIN plans pl ON pl.id = p.plan_id
                  WHERE p.user_id = u.id AND pl.free_slot = 0 AND p.paid_until > ${Date.now()}) AS monthly
           FROM users u
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY u.id DESC LIMIT 500`
      )
      .all(...values);
    res.json({ users: rows.map(userRow) });
  })
);

admin.get(
  '/users/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer gibt es nicht.');
    const lang = langOf(req);
    res.json({
      user: userRow(user),
      profiles: db
        .prepare(
          `SELECT p.*, pl.name_de, pl.name_en, pl.price_credits, pl.free_slot
             FROM profiles p LEFT JOIN plans pl ON pl.id = p.plan_id
            WHERE p.user_id = ? ORDER BY p.ordinal, p.id`
        )
        .all(id)
        .map((row) => ({
          id: row.id,
          name: row.name,
          address: row.port ? `${row.host}:${row.port}` : row.host,
          mc_version: row.mc_version,
          plan: lang === 'de' ? row.name_de : row.name_en,
          price_credits: row.price_credits,
          free_slot: Boolean(row.free_slot),
          paid_until: row.paid_until,
          suspended: Boolean(row.suspended),
          locked: Boolean(row.locked),
          lock_reason: row.lock_reason || '',
          online: supervisor.runningOnProfile(row.id),
        })),
      accounts: db
        .prepare('SELECT * FROM mc_accounts WHERE user_id = ? ORDER BY name')
        .all(id)
        .map((account) => ({
          ...account,
          suspended: Boolean(account.suspended),
          suspend_reason: account.suspend_reason || '',
        })),
      ledger: billing.history(id, 100),
      topups: db.prepare('SELECT * FROM topups WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(id),
      tickets: db
        .prepare(
          "SELECT id, subject, status, category, updated_at FROM tickets WHERE user_id = ? AND status != 'closed' ORDER BY updated_at DESC"
        )
        .all(id),
      proxies: db.prepare('SELECT * FROM proxies WHERE assigned_to = ?').all(id),
      sessions: auth.sessionsOf(id),
      monthly_cost: billing.monthlyCost(id),
      paying: billing.isPayingUser(id),
    });
  })
);

admin.post(
  '/users',
  wrap((req, res) => {
    const body = req.body || {};
    const user = auth.register({
      email: body.email,
      username: body.username,
      password: body.password,
      password2: body.password,
      language: body.language === 'de' ? 'de' : 'en',
    });
    // Von Hand angelegt heißt: der Betreiber steht dafür ein, also gleich bestätigt.
    db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL WHERE id = ?').run(user.id);
    if (body.role === 'admin') db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    audit(req.user.id, 'admin-user-create', { user: user.id });
    res.json({ user: userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
  })
);

admin.patch(
  '/users/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer gibt es nicht.');
    const body = req.body || {};
    let discordRolesChanged = false;

    if (body.credits_delta !== undefined) {
      const delta = Math.trunc(Number(body.credits_delta));
      if (!Number.isFinite(delta) || delta === 0) throw bad('Betrag fehlt.');
      // Ins Minus geht es nirgends im Panel – auch hier nicht. Ein negativer Stand wäre eine
      // stille Schuld beim Kunden: Aufladen fühlt sich danach an wie Bezahlen für nichts, und
      // jede Rechnung, die auf „Guthaben ≥ Preis“ prüft, rechnet plötzlich mit Vorzeichen.
      if (delta < 0 && user.credits + delta < 0) {
        throw bad(
          `Das würde auf ${user.credits + delta} Credits führen. Höchstens ${user.credits} lassen sich abziehen.`,
          {
            en: `That would leave ${user.credits + delta} credits. At most ${user.credits} can be taken.`,
          }
        );
      }
      billing.move(id, delta, 'admin', String(body.note || `durch ${req.user.username}`).slice(0, 200));
      audit(req.user.id, 'admin-credits', { user: id, delta });
    }
    if (body.role !== undefined) {
      if (!['user', 'admin'].includes(body.role)) throw bad('Unbekannte Rolle.');
      if (id === req.user.id && body.role !== 'admin') throw bad('Sich selbst kann man nicht herabstufen.');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, id);
      discordRolesChanged = true;
    }
    if (body.blocked !== undefined) {
      db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(body.blocked ? 1 : 0, id);
      if (body.blocked) {
        supervisor.stopUser(id, 'Konto wurde gesperrt.');
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
      discordRolesChanged = true;
    }
    if (body.email !== undefined) {
      const address = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(address)) throw bad('Keine gültige E-Mail-Adresse.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(address, id)) {
        throw bad('Diese Adresse hat schon jemand.');
      }
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(address, id);
    }
    if (body.username !== undefined) {
      const name = requireString(body.username, 'Benutzername', { max: 24 });
      if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(name, id)) {
        throw bad('Diesen Namen hat schon jemand.');
      }
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, id);
    }
    if (body.email_verified !== undefined) {
      db.prepare('UPDATE users SET email_verified = ?, verify_token = NULL WHERE id = ?').run(
        body.email_verified ? 1 : 0,
        id
      );
    }
    if (body.password) {
      if (String(body.password).length < 8) throw bad('Das Passwort braucht 8 Zeichen.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      audit(req.user.id, 'admin-password', { user: id });
    }
    if (body.premium_until !== undefined) {
      // `Number("morgen")` ist `NaN`, und `NaN` bindet SQLite nicht: Der Aufruf flog mit einem
      // Serverfehler heraus, **nachdem** ein vorheriges Feld derselben Anfrage (etwa eine
      // Gutschrift) schon geschrieben war. Eine halb ausgeführte Änderung ist schlimmer als eine
      // abgelehnte – also hier prüfen und mit einem Satz absagen.
      let until = null;
      if (body.premium_until) {
        until = Math.trunc(Number(body.premium_until));
        if (!Number.isFinite(until) || until < 0) throw bad('Kein gültiges Datum für Premium.');
      }
      db.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(until, id);
      discordRolesChanged = true;
    }
    if (body.premium_days !== undefined) {
      const days = requireInt(body.premium_days, 'Tage', { min: 0, max: 3650 });
      const base = Math.max(Date.now(), user.premium_until || 0);
      db.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(
        days > 0 ? base + days * 86_400_000 : null,
        id
      );
      discordRolesChanged = true;
      audit(req.user.id, 'admin-premium', { user: id, days });
    }
    if (body.proxy_allowance !== undefined) {
      db.prepare('UPDATE users SET proxy_allowance = ? WHERE id = ?').run(
        requireInt(body.proxy_allowance, 'Proxys', { max: 100 }),
        id
      );
    }
    if (body.notes !== undefined) {
      db.prepare('UPDATE users SET notes = ? WHERE id = ?').run(
        String(body.notes || '').slice(0, 4000) || null,
        id
      );
    }
    if (body.language !== undefined) {
      db.prepare('UPDATE users SET language = ? WHERE id = ?').run(body.language === 'de' ? 'de' : 'en', id);
    }
    for (const field of ['discord_moderator', 'discord_partner', 'discord_vip']) {
      if (body[field] === undefined) continue;
      db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(body[field] ? 1 : 0, id);
      discordRolesChanged = true;
    }
    if (discordRolesChanged) roles.changed(id);
    res.json({ user: userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  })
);

admin.post(
  '/users/:id/logout',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(req.user.id, 'admin-logout', { user: id });
    res.json({ ok: true });
  })
);

admin.post(
  '/users/:id/stop-bots',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    supervisor.stopUser(id, `Von ${req.user.username} gestoppt.`);
    res.json({ ok: true });
  })
);

admin.post(
  '/users/:id/verify-mail',
  wrap(async (req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer gibt es nicht.');
    const result = await auth.resendVerification(user);
    if (result && result.ok === false) throw bad(result.error);
    res.json({ ok: true });
  })
);

/**
 * "Als Nutzer ansehen". Es wird eine zweite Sitzung geöffnet, die weiß, wem sie gehört und wohin
 * es zurückgeht – die eigene Admin-Sitzung bleibt bestehen und wird beim Zurückgehen wieder gesetzt.
 */
admin.post(
  '/users/:id/impersonate',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    if (id === req.user.id) throw bad('Sich selbst ansehen bringt nichts.');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer gibt es nicht.');
    auth.createSession(res, user, req, {
      impersonatorId: req.user.id,
      parentToken: req.sessionToken,
    });
    audit(req.user.id, 'admin-impersonate', { user: id });
    res.json({ ok: true, user: auth.publicUser(user) });
  })
);

// ---------------------------------------------------------------- Tarife

admin.get(
  '/plans',
  wrap((req, res) => {
    res.json({
      plans: billing.plans({ includeInactive: true }).map((plan) => ({
        ...plan,
        in_use: db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE plan_id = ?').get(plan.id).n,
      })),
    });
  })
);

const PLAN_TEXT_FIELDS = ['name_de', 'name_en', 'blurb_de', 'blurb_en', 'features_de', 'features_en', 'discord_role'];
const PLAN_NUMBER_FIELDS = ['price_credits', 'max_accounts', 'chat_limit', 'max_macros', 'sort'];
const PLAN_FLAG_FIELDS = [
  'free_slot',
  'premium',
  'movement',
  'proxy',
  'offline_accounts',
  'fakehost',
  'chat_limit_editable',
  'priority_support',
  'board',
  'menus',
  'pov',
  'addons',
  'highlight',
  'active',
];
const PLAN_FIELDS = [...PLAN_TEXT_FIELDS, ...PLAN_NUMBER_FIELDS, ...PLAN_FLAG_FIELDS];

function planValues(body, existing = {}) {
  const out = {};
  for (const field of PLAN_FIELDS) {
    if (body[field] === undefined) continue;
    if (PLAN_TEXT_FIELDS.includes(field)) {
      // Beschreibungen dürfen länger sein als Namen – auf der Preisseite steht ein ganzer Satz.
      // Die Merkmalsliste ist eine Zeile je Punkt und darf entsprechend lang werden.
      const limit = field.startsWith('features') ? 2000 : field.startsWith('blurb') ? 400 : 200;
      out[field] = String(body[field] ?? '').slice(0, limit);
    } else if (PLAN_NUMBER_FIELDS.includes(field)) {
      out[field] = requireInt(body[field], field, { max: 1_000_000 });
    } else {
      out[field] = body[field] ? 1 : 0;
    }
  }
  if (out.name_de !== undefined && !out.name_de.trim()) throw bad('Der Tarif braucht einen Namen.');
  if (out.max_accounts !== undefined && out.max_accounts < 1) throw bad('Mindestens ein Konto je Server.');
  if (out.discord_role !== undefined) {
    const value = String(out.discord_role).trim();
    if (value && !/^\d{5,25}$/.test(value)) throw bad('Eine Discord-Rollen-ID besteht nur aus Ziffern.');
    out.discord_role = value || null;
  }
  return { ...existing, ...out };
}

admin.post(
  '/plans',
  wrap((req, res) => {
    const body = req.body || {};
    const slug = String(body.slug || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');
    if (!slug) throw bad('Der Tarif braucht ein Kürzel (nur a–z, 0–9 und -).');
    if (db.prepare('SELECT 1 FROM plans WHERE slug = ?').get(slug)) throw bad('Dieses Kürzel gibt es schon.');
    const values = planValues(body, {
      name_de: slug,
      name_en: slug,
      blurb_de: '',
      blurb_en: '',
      features_de: '',
      features_en: '',
      discord_role: null,
      price_credits: 0,
      free_slot: 0,
      max_accounts: 1,
      premium: 0,
      movement: 0,
      proxy: 0,
      offline_accounts: 0,
      fakehost: 0,
      chat_limit: 200,
      chat_limit_editable: 0,
      priority_support: 0,
      board: 0,
      menus: 0,
      pov: 0,
      max_macros: 20,
      addons: 0,
      highlight: 0,
      sort: 50,
      active: 1,
    });
    const info = db
      .prepare(
        `INSERT INTO plans (slug, ${PLAN_FIELDS.join(', ')})
         VALUES (@slug, ${PLAN_FIELDS.map((field) => `@${field}`).join(', ')})`
      )
      .run({ slug, ...values });
    audit(req.user.id, 'plan-create', { slug });
    bridge.emit('discord.config', { keys: ['plans'] });
    res.json({ plan: billing.planById(info.lastInsertRowid) });
  })
);

admin.patch(
  '/plans/:id',
  wrap((req, res) => {
    const plan = billing.planById(requireInt(req.params.id, 'Tarif'));
    if (!plan) throw notFound('Diesen Tarif gibt es nicht.');
    const values = planValues(req.body || {});
    const keys = Object.keys(values);
    if (!keys.length) throw bad('Nichts zu ändern.');
    // Es muss immer genau einen kostenlosen Tarif geben, sonst gäbe es keinen Gratis-Platz mehr.
    if (values.free_slot === 1) {
      db.prepare('UPDATE plans SET free_slot = 0 WHERE id != ?').run(plan.id);
    } else if (values.free_slot === 0 && plan.free_slot) {
      const others = db.prepare('SELECT COUNT(*) AS n FROM plans WHERE free_slot = 1 AND id != ?').get(plan.id).n;
      if (!others) throw bad('Ein Tarif muss der kostenlose Platz bleiben.');
    }
    db.prepare(`UPDATE plans SET ${keys.map((key) => `${key} = @${key}`).join(', ')} WHERE id = @id`).run({
      ...values,
      id: plan.id,
    });
    audit(req.user.id, 'plan-update', { slug: plan.slug, ...values });
    if (values.discord_role !== undefined) bridge.emit('discord.config', { keys: ['plans'] });
    res.json({ plan: billing.planById(plan.id) });
  })
);

admin.delete(
  '/plans/:id',
  wrap((req, res) => {
    const plan = billing.planById(requireInt(req.params.id, 'Tarif'));
    if (!plan) throw notFound('Diesen Tarif gibt es nicht.');
    const used = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE plan_id = ?').get(plan.id).n;
    if (used) throw bad(`${used} Serverplatz/-plätze nutzen diesen Tarif. Lieber auf "inaktiv" stellen.`);
    if (plan.free_slot) throw bad('Der kostenlose Tarif lässt sich nicht löschen.');
    db.prepare('DELETE FROM plans WHERE id = ?').run(plan.id);
    audit(req.user.id, 'plan-delete', { slug: plan.slug });
    bridge.emit('discord.config', { keys: ['plans'] });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Gutscheine

admin.get(
  '/vouchers',
  wrap((req, res) => {
    res.json({
      vouchers: db
        .prepare(
          `SELECT v.*, u.username AS created_by_name FROM vouchers v
             LEFT JOIN users u ON u.id = v.created_by ORDER BY v.created_at DESC LIMIT 300`
        )
        .all(),
    });
  })
);

admin.post(
  '/vouchers',
  wrap((req, res) => {
    const credits = requireInt(req.body?.credits, 'Guthaben', { min: 1, max: 1_000_000 });
    const uses = requireInt(req.body?.uses ?? 1, 'Einlösungen', { min: 1, max: 1000 });
    const count = requireInt(req.body?.count ?? 1, 'Anzahl', { min: 1, max: 50 });
    const days = requireInt(req.body?.expires_days ?? 0, 'Gültigkeit', { max: 3650 });
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push(
        billing.createVoucher({
          credits,
          uses,
          note: String(req.body?.note || '').slice(0, 200),
          createdBy: req.user.id,
          expiresAt: days > 0 ? Date.now() + days * 86_400_000 : null,
        })
      );
    }
    audit(req.user.id, 'voucher-create', { count, credits });
    res.json({ vouchers: list });
  })
);

admin.delete(
  '/vouchers/:code',
  wrap((req, res) => {
    db.prepare('DELETE FROM vouchers WHERE code = ?').run(String(req.params.code).toUpperCase());
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Aufladungen

admin.get(
  '/topups',
  wrap((req, res) => {
    res.json({
      topups: db
        .prepare(
          `SELECT t.*, u.username, u.email FROM topups t JOIN users u ON u.id = t.user_id
            ORDER BY t.status = 'open' DESC, t.id DESC LIMIT 300`
        )
        .all(),
    });
  })
);

admin.post(
  '/topups/:id/settle',
  wrap((req, res) => {
    // `force` gilt nur für zurückgezogene Aufladungen: Eine Überweisung, die schon unterwegs war,
    // als der Kunde die Aufladung abgebrochen hat, kommt trotzdem an. Bezahlte und zurückerstattete
    // bucht auch das nicht ein zweites Mal.
    const topup = billing.settleTopup(
      requireInt(req.params.id, 'Aufladung'),
      `bestätigt von ${req.user.username}`,
      { force: Boolean(req.body?.force) }
    );
    audit(req.user.id, 'topup-settle', { id: topup.id, force: Boolean(req.body?.force) }, req.ip);
    res.json({ topup });
  })
);

admin.post(
  '/topups/:id/cancel',
  wrap((req, res) => {
    billing.cancelTopup(requireInt(req.params.id, 'Aufladung'));
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Proxys
//
// Proxys gehören dem Betreiber und werden Nutzern zugeteilt. Ein Nutzer legt selbst keine an –
// er fragt per Ticket, und hier wird zugewiesen.

admin.get(
  '/proxies',
  wrap((req, res) => {
    res.json({
      proxies: db
        .prepare(
          `SELECT p.*, u.username AS assigned_name,
                  (SELECT COUNT(*) FROM profile_accounts pa WHERE pa.proxy_id = p.id) AS in_use
             FROM proxies p LEFT JOIN users u ON u.id = p.assigned_to ORDER BY p.id`
        )
        .all()
        .map((row) => ({ ...row, password: row.password ? '••••' : '' })),
    });
  })
);

admin.post(
  '/proxies',
  wrap((req, res) => {
    const body = req.body || {};
    const label = requireString(body.label, 'Bezeichnung', { max: 60 });
    const { host, port } = parseAddress(body.address || `${body.host}:${body.port}`);
    if (!port) throw bad('Ein Proxy braucht einen Port.');
    const kind = ['socks5', 'socks4', 'http'].includes(body.kind) ? body.kind : 'socks5';
    const assigned = body.assigned_to ? requireInt(body.assigned_to, 'Nutzer') : null;
    const info = db
      .prepare(
        `INSERT INTO proxies (user_id, assigned_to, pool, label, kind, host, port, username, password, note, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        assigned,
        label,
        kind,
        host,
        port,
        body.username ? String(body.username).slice(0, 100) : null,
        body.password ? String(body.password).slice(0, 200) : null,
        body.note ? String(body.note).slice(0, 200) : null,
        Date.now()
      );
    audit(req.user.id, 'proxy-create', { label, host, port });
    res.json({ id: info.lastInsertRowid });
  })
);

admin.patch(
  '/proxies/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Proxy');
    const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(id);
    if (!proxy) throw notFound('Diesen Proxy gibt es nicht.');
    const body = req.body || {};
    const set = [];
    const values = [];
    if (body.label !== undefined) {
      set.push('label = ?');
      values.push(requireString(body.label, 'Bezeichnung', { max: 60 }));
    }
    if (body.assigned_to !== undefined) {
      const target = body.assigned_to ? requireInt(body.assigned_to, 'Nutzer') : null;
      if (target && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(target)) {
        throw notFound('Diesen Nutzer gibt es nicht.');
      }
      // Wechselt der Besitzer, dürfen die alten Zuordnungen nicht bleiben.
      if (target !== proxy.assigned_to) {
        db.prepare('UPDATE profile_accounts SET proxy_id = NULL WHERE proxy_id = ?').run(id);
      }
      set.push('assigned_to = ?');
      values.push(target);
    }
    if (body.address !== undefined) {
      const { host, port } = parseAddress(body.address);
      set.push('host = ?', 'port = ?');
      values.push(host, port);
    }
    if (body.kind !== undefined) {
      set.push('kind = ?');
      values.push(['socks5', 'socks4', 'http'].includes(body.kind) ? body.kind : 'socks5');
    }
    if (body.username !== undefined) {
      set.push('username = ?');
      values.push(String(body.username || '').slice(0, 100) || null);
    }
    if (body.password !== undefined && body.password !== '••••') {
      set.push('password = ?');
      values.push(String(body.password || '').slice(0, 200) || null);
    }
    if (body.note !== undefined) {
      set.push('note = ?');
      values.push(String(body.note || '').slice(0, 200) || null);
    }
    if (!set.length) throw bad('Nichts zu ändern.');
    values.push(id);
    db.prepare(`UPDATE proxies SET ${set.join(', ')} WHERE id = ?`).run(...values);
    res.json({ ok: true });
  })
);

admin.delete(
  '/proxies/:id',
  wrap((req, res) => {
    db.prepare('DELETE FROM proxies WHERE id = ?').run(requireInt(req.params.id, 'Proxy'));
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Tickets

admin.get(
  '/tickets',
  wrap((req, res) => {
    res.json({
      tickets: tickets.listAll({
        status: req.query.status === undefined ? null : String(req.query.status),
        // `listAll` kann nach Dringlichkeit filtern; hier wurde der Wert nie durchgereicht,
        // also blieb der Filter im Panel wirkungslos.
        priority: req.query.priority === undefined ? null : String(req.query.priority),
        search: String(req.query.q || '').trim(),
      }),
      statuses: tickets.STATUSES,
      priorities: tickets.PRIORITIES,
    });
  })
);

admin.get(
  '/tickets/:id',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    tickets.markRead(ticket, req.user);
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.user_id);
    res.json({
      ticket: ticketView(ticket),
      messages: tickets.messages(ticket.id, { staff: true }),
      participants: tickets.participants(ticket.id),
      user: owner ? userRow(owner) : null,
      paying: owner ? billing.isPayingUser(owner.id) : false,
      staff: db.prepare("SELECT id, username FROM users WHERE role = 'admin' ORDER BY username").all(),
      me: req.user.id,
    });
  })
);

/** Nachschlag für den Live-Verlauf – dieselbe Form wie beim Kunden. */
admin.get(
  '/tickets/:id/messages',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    const since = Number(req.query.since) || 0;
    tickets.markRead(ticket, req.user);
    const all = tickets.messages(ticket.id, { staff: true });
    res.json({
      ticket: ticketView(ticket),
      messages: since ? all.filter((message) => message.id > since) : all,
    });
  })
);

admin.post(
  '/tickets/:id/reply',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    const internal = Boolean(req.body?.internal);
    // Nur diese Admin-Route schreibt als Support. Unter „Meine Tickets“ schreibt derselbe
    // Benutzer bewusst als Kunde.
    const updated = tickets.reply(ticket, req.user, req.body?.body, {
      internal,
      staff: true,
      files: req.body?.files,
    });
    // Interne Notizen sieht nur das Team – dafür gibt es keine Post an den Kunden.
    if (!internal) tickets.notifyUser(updated, req.body?.body || '', req.user.username);
    res.json({
      ticket: ticketView(updated),
      messages: tickets.messages(ticket.id, { staff: true }),
    });
  })
);

admin.post(
  '/tickets/:id/typing',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    bridge.emit('ticket.typing', {
      ticket_id: ticket.id,
      user_id: req.user.id,
      name: req.user.username,
      staff: true,
    });
    res.json({ ok: true });
  })
);

admin.patch(
  '/tickets/:id',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    const body = req.body || {};
    if (body.status !== undefined) {
      const updated = tickets.setStatus(ticket, body.status, req.user.id, { staff: true });
      if (updated.status === 'closed') tickets.notifyParticipants(updated, 'ticket_closed', {}, req.user.id);
    }
    // Die Dringlichkeit setzt ausschließlich das Team – ein Kunde hätte sonst nach kurzer Zeit
    // jedes seiner Tickets auf „dringend“. Was gesetzt wurde, steht im Verlauf (siehe tickets.js).
    if (body.priority !== undefined) tickets.setPriority(ticket, body.priority, req.user.id);
    if (body.subject !== undefined) {
      db.prepare('UPDATE tickets SET subject = ? WHERE id = ?').run(
        requireString(body.subject, 'Betreff', { max: 120 }),
        ticket.id
      );
    }
    if (body.assigned_to !== undefined) {
      const target = body.assigned_to ? requireInt(body.assigned_to, 'Bearbeiter') : null;
      db.prepare('UPDATE tickets SET assigned_to = ? WHERE id = ?').run(target, ticket.id);
    }
    res.json({ ticket: ticketView(db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id)) });
  })
);

/** Jemanden zu einem Ticket dazuholen – oder wieder herausnehmen. */
admin.post(
  '/tickets/:id/users',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    const userId = requireInt(req.body?.user_id, 'Nutzer');
    const participants = tickets.addUser(ticket, userId, req.user.id);
    const added = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (added) {
      mail.sendTo(added, 'ticket_opened', {
        id: ticket.id,
        subject: ticket.subject,
        by: req.user.username,
      });
    }
    res.json({ participants });
  })
);

admin.delete(
  '/tickets/:id/users/:userId',
  wrap((req, res) => {
    const ticket = tickets.get(requireInt(req.params.id, 'Ticket'), req.user);
    res.json({
      participants: tickets.removeUser(ticket, requireInt(req.params.userId, 'Nutzer'), req.user.id),
    });
  })
);

// ---------------------------------------------------------------- Ankündigungen

admin.get(
  '/announcements',
  wrap((req, res) => {
    res.json({
      announcements: db
        .prepare(
          `SELECT a.*, u.username AS created_by_name FROM announcements a
             LEFT JOIN users u ON u.id = a.created_by ORDER BY a.id DESC LIMIT 50`
        )
        .all()
        .map((row) => ({ ...row, active: Boolean(row.active) })),
      recipients: db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE blocked = 0 AND email_verified = 1")
        .get().n,
      mail_ready: mail.configured(),
    });
  })
);

admin.post(
  '/announcements',
  wrap((req, res) => {
    const body = req.body || {};
    const titleDe = requireString(body.title_de, 'Titel (DE)', { max: 120 });
    const titleEn = requireString(body.title_en || body.title_de, 'Titel (EN)', { max: 120 });
    const info = db
      .prepare(
        `INSERT INTO announcements (title_de, title_en, body_de, body_en, kind, link, active, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        titleDe,
        titleEn,
        String(body.body_de || '').slice(0, 4000),
        String(body.body_en || body.body_de || '').slice(0, 4000),
        ['info', 'warn', 'bad'].includes(body.kind) ? body.kind : 'info',
        String(body.link || '').slice(0, 300) || null,
        body.active === false ? 0 : 1,
        Date.now(),
        req.user.id
      );
    // Mehrere dürfen gleichzeitig sichtbar sein: Wartungsarbeiten und eine neue Funktion sind
    // zwei Nachrichten, und die zweite soll die erste nicht abschalten.
    audit(req.user.id, 'announcement-create', { id: info.lastInsertRowid, title: titleDe }, req.ip);
    res.json({ id: info.lastInsertRowid });
  })
);

admin.patch(
  '/announcements/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Ankündigung');
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    if (!row) throw notFound('Diese Ankündigung gibt es nicht.');
    const body = req.body || {};
    const set = [];
    const values = [];
    const put = (column, value) => {
      set.push(`${column} = ?`);
      values.push(value);
    };
    if (body.title_de !== undefined) put('title_de', requireString(body.title_de, 'Titel (DE)', { max: 120 }));
    if (body.title_en !== undefined) put('title_en', requireString(body.title_en, 'Titel (EN)', { max: 120 }));
    if (body.body_de !== undefined) put('body_de', String(body.body_de || '').slice(0, 4000));
    if (body.body_en !== undefined) put('body_en', String(body.body_en || '').slice(0, 4000));
    if (body.kind !== undefined) put('kind', ['info', 'warn', 'bad'].includes(body.kind) ? body.kind : 'info');
    if (body.link !== undefined) put('link', String(body.link || '').slice(0, 300) || null);
    if (body.active !== undefined) put('active', body.active ? 1 : 0);
    if (!set.length) throw bad('Nichts zu ändern.');
    values.push(id);
    db.prepare(`UPDATE announcements SET ${set.join(', ')} WHERE id = ?`).run(...values);
    res.json({ ok: true });
  })
);

/**
 * Eine Ankündigung als E-Mail verschicken.
 *
 * Jeder bekommt sie in seiner Sprache, und nur, wer Ankündigungen bestellt hat. Verschickt wird
 * in Ruhe – ein Mailserver, der auf einen Schlag hundert Nachrichten bekommt, hält uns sonst für
 * einen Absender, den man besser sperrt.
 */
admin.post(
  '/announcements/:id/mail',
  wrap(async (req, res) => {
    if (!mail.configured()) throw bad('Es ist kein SMTP-Server hinterlegt.');
    const id = requireInt(req.params.id, 'Ankündigung');
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    if (!row) throw notFound('Diese Ankündigung gibt es nicht.');
    if (row.mailed_at && !req.body?.again) {
      throw bad('Diese Ankündigung wurde schon verschickt. Mit "noch einmal" geht es trotzdem.');
    }

    const test = Boolean(req.body?.test);
    const recipients = test
      ? [db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)]
      : db.prepare('SELECT * FROM users WHERE blocked = 0 AND email_verified = 1').all();

    let sent = 0;
    let skipped = 0;
    for (const user of recipients) {
      const result = await mail.sendTo(
        user,
        'announcement',
        {
          title: user.language === 'en' ? row.title_en : row.title_de,
          body: (user.language === 'en' ? row.body_en : row.body_de) || '',
          link: row.link || '',
        },
        { force: test }
      );
      if (result.ok) sent += 1;
      else skipped += 1;
      // Ein kurzer Abstand hält den Versand unauffällig, ohne dass es spürbar dauert.
      if (!test) await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (!test) db.prepare('UPDATE announcements SET mailed_at = ? WHERE id = ?').run(Date.now(), id);
    audit(req.user.id, 'announcement-mail', { id, sent, skipped, test }, req.ip);
    res.json({ sent, skipped, test });
  })
);

admin.delete(
  '/announcements/:id',
  wrap((req, res) => {
    db.prepare('DELETE FROM announcements WHERE id = ?').run(requireInt(req.params.id, 'Ankündigung'));
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Einstellungen

admin.get(
  '/settings',
  wrap((req, res) =>
    res.json({
      settings: safeSettings(),
      defaults: settingDefaults,
      schema: schemaFor(langOf(req)),
      mail_categories: mail.categoriesFor(langOf(req)),
      oauth: oauth.state(),
      bot: botState(),
      stripe: stripe.status(),
      // Was der Editor für die Linked Roles braucht: die Quellen, die Vergleichsarten und das,
      // was gerade gilt (auch wenn noch nie etwas gespeichert wurde – dann sind es die Vorgaben).
      linked_roles: {
        ...linkedRoles.schemaFor(langOf(req)),
        fields: linkedRoles.fields(),
        verification_url: `${config.publicUrl}/api/auth/discord/start?mode=verify`,
      },
    })
  )
);

admin.patch(
  '/settings',
  wrap((req, res) => {
    const changed = [];
    for (const [key, value] of Object.entries(req.body || {})) {
      // Nur, was in der Beschreibung steht. Ein unbekannter Schlüssel ist ein Tippfehler oder ein
      // Versuch – beides gehört nicht in die Tabelle.
      //
      // `Object.hasOwn` statt einer bloßen Wahrheitsprüfung: Ohne sie war `constructor` ein
      // "bekannter" Schlüssel (er kommt aus der Prototypenkette), fiel durch jede Fallunter-
      // scheidung darunter hindurch und landete als Zeile in den Einstellungen.
      if (!Object.hasOwn(settingSchema, key)) continue;
      const entry = settingSchema[key];
      if (!entry) continue;

      if (entry.type === 'linkedroles') {
        // Was Discord ablehnt, soll gar nicht erst in der Tabelle landen: eine halb gültige Liste
        // hieße, dass im Rollen-Dialog eine Bedingung steht, die nie einen Wert bekommt.
        setSetting(key, linkedRoles.validate(value, { fail: bad }));
      } else if (entry.type === 'packages') {
        if (!Array.isArray(value)) {
          throw bad('Pakete müssen eine Liste sein.', { en: 'Packages have to be a list.' });
        }
        setSetting(
          key,
          value.map((pack) => ({
            cent: requireInt(pack.cent, 'Betrag', { min: 100, max: 1_000_000 }),
            credits: requireInt(pack.credits, 'Credits', { min: 1, max: 1_000_000 }),
            label: String(pack.label || `${(pack.cent / 100).toFixed(2)} €`).slice(0, 40),
          }))
        );
      } else if (entry.type === 'select') {
        // Nur, was in der Beschreibung steht. Ein fremder Wert wäre eine Betriebsart, die es
        // nirgends gibt – und die Wirkung hätte niemand vorhergesagt.
        const allowed = (entry.options || []).map((option) => option.value);
        const wanted = String(value ?? '');
        if (!allowed.includes(wanted)) {
          throw bad(`Unbekannter Wert für "${entry.de.label}".`, {
            en: `Unknown value for "${entry.en.label}".`,
          });
        }
        setSetting(key, wanted);
      } else if (entry.type === 'number' || entry.type === 'switch') {
        const limits = entry.type === 'switch' ? { min: 0, max: 1 } : { min: entry.min ?? 0, max: entry.max ?? 10_000_000 };
        setSetting(key, requireInt(entry.type === 'switch' ? (value ? 1 : 0) : value, entry.de.label, limits));
      } else if (entry.secret) {
        // Leer heißt "nicht angefasst": das Formular kennt den Wert nicht und kann ihn deshalb
        // auch nicht zurückschicken. Löschen geht über den eigenen Knopf (DELETE unten).
        const text = String(value || '').trim();
        if (!text) continue;
        // Hinter dem Geheimnis zwischen Panel und Bot liegt der ganze Bot-Bereich: der
        // Discord-Token, jedes Ticket, die Discord-IDs aller Konten. "1234" ist dafür kein
        // Passwort, sondern eine offene Tür – deshalb wird es hier gar nicht erst angenommen.
        if (key === 'discord_bot_secret' && text.length < MIN_SECRET) {
          throw bad(
            `Das Geheimnis zwischen Panel und Bot braucht mindestens ${MIN_SECRET} Zeichen.`,
            { en: `The panel ↔ bot secret needs at least ${MIN_SECRET} characters.` }
          );
        }
        setSetting(key, text.slice(0, 500));
      } else {
        setSetting(key, String(value ?? '').slice(0, entry.type === 'textarea' ? 20_000 : 500));
      }
      changed.push(key);
    }
    audit(req.user.id, 'admin-settings', { keys: changed }, req.ip);
    if (changed.some((key) => key.startsWith('discord_') || key.startsWith('free_discord_'))) {
      bridge.emit('discord.config', { keys: changed });
    }
    res.json({ settings: safeSettings() });
  })
);

/** Ein Geheimnis löschen. Ohne diesen Weg ließe sich ein einmal gesetztes nie wieder entfernen. */
admin.delete(
  '/settings/:key',
  wrap((req, res) => {
    const entry = Object.hasOwn(settingSchema, req.params.key) ? settingSchema[req.params.key] : null;
    if (!entry?.secret) throw notFound('Dieses Feld gibt es nicht.');
    setSetting(entry.key, '');
    audit(req.user.id, 'admin-settings-clear', { key: entry.key }, req.ip);
    if (entry.key.startsWith('discord_') || entry.key.startsWith('free_discord_')) {
      bridge.emit('discord.config', { keys: [entry.key] });
    }
    res.json({ settings: safeSettings() });
  })
);

// ---------------------------------------------------------------- Der Discord-Bot

/**
 * Zwei Knöpfe für den Bot, und der Unterschied zwischen ihnen ist wichtig.
 *
 * **Neu laden** schickt ihm nur die Nachricht, dass sich etwas geändert hat: er holt die
 * Einstellungen erneut, meldet die Linked Roles bei Discord an, richtet Kanalrechte und Rollen
 * neu aus – ohne Unterbrechung. Das reicht für alles, was im Panel eingestellt wird, und ist
 * deshalb der Weg, der nach dem Speichern von selbst geht.
 *
 * **Neu starten** beendet den Prozess. Nötig ist das, wenn der Bot selbst hängt oder ein neuer
 * Bot-Token gilt – Discord lässt einen laufenden Anmeldevorgang nicht wechseln. Dass er
 * anschließend wiederkommt, ist Sache des Dienstes (`Restart=always` in der systemd-Unit); wer
 * ihn von Hand gestartet hat, muss ihn auch von Hand wieder starten.
 *
 * Die Sperre von 20 Sekunden ist keine Schikane: Discord sperrt einen Token, der zu oft
 * hintereinander eine Verbindung aufbaut, und die systemd-Unit gibt nach zehn Starts in fünf
 * Minuten auf. Ein doppelt geklickter Knopf soll den Bot nicht für den Rest des Tages abschalten.
 */
const BOT_COMMAND_PAUSE_MS = 20_000;
let lastBotCommand = 0;

admin.post(
  '/bot/:action(restart|reload)',
  wrap((req, res) => {
    const action = req.params.action;
    if (!bridge.connected) {
      throw bad('Der Bot ist gerade nicht verbunden – es gibt niemanden, der den Befehl annimmt.', {
        en: 'The bot is not connected right now – nobody is there to take the command.',
      });
    }
    const since = Date.now() - lastBotCommand;
    if (since < BOT_COMMAND_PAUSE_MS) {
      throw bad(`Bitte noch ${Math.ceil((BOT_COMMAND_PAUSE_MS - since) / 1000)} Sekunden warten.`, {
        en: `Please wait another ${Math.ceil((BOT_COMMAND_PAUSE_MS - since) / 1000)} seconds.`,
      });
    }
    lastBotCommand = Date.now();

    if (action === 'restart') bridge.emit('bot.restart', { by: req.user.username });
    else bridge.emit('discord.config', { by: req.user.username, keys: [] });

    audit(req.user.id, `admin-bot-${action}`, null, req.ip);
    res.json({ ok: true, action });
  })
);

admin.post(
  '/settings/mail-test',
  wrap(async (req, res) => {
    await mail.verifyConnection();
    const to = String(req.body?.to || req.user.email);
    const result = await mail.send({
      to,
      subject: `${config.brand}: Testnachricht`,
      text: 'Wenn du das liest, ist der Versand richtig eingerichtet.',
      kind: 'test',
    });
    if (!result.ok) throw bad(result.error);
    res.json({ ok: true, to });
  })
);

admin.get(
  '/mails',
  wrap((req, res) => {
    const status = String(req.query.status || 'all');
    const search = String(req.query.q || '').trim();
    const where = [];
    const values = [];
    if (status === 'failed' || status === 'sent') {
      where.push('m.status = ?');
      values.push(status);
    }
    if (search) {
      where.push('(m.recipient LIKE ? OR m.subject LIKE ? OR u.username LIKE ?)');
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    res.json({
      mails: db
        .prepare(
          `SELECT m.*, u.username FROM mails m LEFT JOIN users u ON u.id = m.user_id
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY m.id DESC LIMIT 200`
        )
        .all(...values),
      failed: db.prepare("SELECT COUNT(*) AS n FROM mails WHERE status = 'failed'").get().n,
      configured: mail.configured(),
    });
  })
);

/** Eine verschickte Nachricht im Wortlaut – zum Nachlesen, was ein Kunde bekommen hat. */
admin.get(
  '/mails/:id',
  wrap((req, res) => {
    const row = db.prepare('SELECT * FROM mails WHERE id = ?').get(requireInt(req.params.id, 'Nachricht'));
    if (!row) throw notFound('Diese Nachricht gibt es nicht.');
    res.json({ mail: row });
  })
);

/**
 * Stripe prüfen, ohne dass Geld fließt.
 *
 * Beantwortet die zwei Fragen, an denen beim Einrichten alles hängt: Nimmt Stripe den Schlüssel
 * an, darf dieses Konto überhaupt kassieren – und kommt eine Bezahlseite zustande? Was hier
 * **nicht** geprüft werden kann, ist der Weg des Geldes zurück; dafür gibt es "Send test webhook"
 * bei Stripe und den einen echten kleinen Kauf.
 */
admin.post(
  '/stripe/test',
  wrap(async (req, res) => {
    const result = await stripe.selfTest({ lang: langOf(req) });
    audit(req.user.id, 'stripe-test', { ok: result.ok, live: result.live }, req.ip);
    res.json(result);
  })
);

// ---------------------------------------------------------------- Client und Bots

admin.get('/client', wrap((req, res) => res.json({ client: clientState() })));

admin.post(
  '/client/sync',
  wrap(async (req, res) => {
    await binaries.sync({ force: Boolean(req.body?.force) });
    // Die Standorte holen sich ihre Dateien vom Panel. Ohne diesen Zuruf hätten sie bis zum
    // nächsten Stundentakt noch die alte Fassung – und ein Bot dort andere Fähigkeiten als hier.
    agents.syncAll();
    audit(req.user.id, 'client-sync', { tag: binaries.state.tag });
    res.json({ client: clientState() });
  })
);

// ---------------------------------------------------------------- Minecraft-Ressourcen
//
// Eine Original-Client-JAR je Protokollversion. Warum sie hier landen und nicht im Release des
// Clients, steht in server/resources.js: Der Viewer liest beim Zeichnen aus ihnen, wir verteilen
// sie nicht weiter, und der Betreiber legt sie deshalb selbst hin.

admin.post(
  '/resources/:version',
  express.raw({ type: '*/*', limit: resources.MAX_BYTES }),
  wrap((req, res) => {
    const version = String(req.params.version || '');
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      throw bad('Es ist keine Datei angekommen.', { en: 'No file arrived.' });
    }
    let entry;
    try {
      entry = resources.store(version, req.body);
    } catch (error) {
      throw bad(error.message, { en: error.message });
    }
    // Die Standorte holen sich dieselbe Datei – sonst zeichnete die Ansicht nur hier texturiert.
    agents.syncAll();
    audit(req.user.id, 'resource-upload', { version, size: entry.size }, req.ip);
    res.json({ resource: entry, client: clientState() });
  })
);

/** Dieselbe Datei, aber von Mojang geholt – für Versionen, die dort öffentlich stehen. */
admin.post(
  '/resources/:version/fetch',
  wrap(async (req, res) => {
    const version = String(req.params.version || '');
    let entry;
    try {
      entry = await resources.fetchFromMojang(version);
    } catch (error) {
      throw bad(error.message, { en: error.message });
    }
    agents.syncAll();
    audit(req.user.id, 'resource-fetch', { version, size: entry.size }, req.ip);
    res.json({ resource: entry, client: clientState() });
  })
);

admin.delete(
  '/resources/:version',
  wrap((req, res) => {
    const version = String(req.params.version || '');
    if (!resources.remove(version)) {
      throw notFound('Für diese Version liegt hier keine Datei.', { en: 'No file here for that version.' });
    }
    agents.syncAll();
    audit(req.user.id, 'resource-delete', { version }, req.ip);
    res.json({ client: clientState() });
  })
);

admin.get(
  '/bots',
  wrap((req, res) => {
    const rows = [...supervisor.bots.values()].map((bot) => ({
      ...bot.snapshot(),
      user_id: bot.userId,
      username: db.prepare('SELECT username FROM users WHERE id = ?').get(bot.userId)?.username,
      profile: bot.profile.name,
      host: bot.profile.host,
      version: bot.profile.mc_version,
      plan: bot.plan?.slug,
    }));
    res.json({ bots: rows });
  })
);

/** Alle Minecraft-Konten, nicht nur Prozesse, die seit dem letzten Dienststart einmal liefen. */
admin.get(
  '/accounts',
  wrap((req, res) => {
    const accounts = db
      .prepare(
        `SELECT a.id, a.user_id, a.name, a.kind, a.uuid, a.status, a.last_error,
                a.connections, a.suspended, a.suspend_reason, a.created_at, u.username
           FROM mc_accounts a JOIN users u ON u.id = a.user_id
          ORDER BY a.id DESC LIMIT 1000`
      )
      .all();
    const servers = new Map();
    for (const row of db
      .prepare(
        `SELECT pa.account_id, p.id, p.name
           FROM profile_accounts pa JOIN profiles p ON p.id = pa.profile_id
          ORDER BY p.name, p.id`
      )
      .all()) {
      if (!servers.has(row.account_id)) servers.set(row.account_id, []);
      servers.get(row.account_id).push({ id: row.id, name: row.name });
    }
    const processes = new Map();
    for (const bot of supervisor.bots.values()) {
      if (!bot.running) continue;
      const current = processes.get(bot.account.id) || { running: 0, online: 0 };
      current.running += 1;
      if (bot.online) current.online += 1;
      processes.set(bot.account.id, current);
    }
    res.json({
      accounts: accounts.map((account) => ({
        ...account,
        suspended: Boolean(account.suspended),
        suspend_reason: account.suspend_reason || '',
        servers: servers.get(account.id) || [],
        ...(processes.get(account.id) || { running: 0, online: 0 }),
      })),
    });
  })
);

admin.post(
  '/bots/:profileId/:accountId/stop',
  wrap((req, res) => {
    supervisor.stop(requireInt(req.params.profileId, 'Server'), requireInt(req.params.accountId, 'Konto'));
    res.json({ ok: true });
  })
);

/** Ein einzelnes Minecraft-Konto stilllegen, ohne Anmeldung oder Zuordnungen zu löschen. */
admin.post(
  '/accounts/:id/suspension',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Konto');
    const account = db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(id);
    if (!account) throw notFound('Dieses Minecraft-Konto gibt es nicht.');
    const suspended = req.body?.suspended !== false;
    const reason = String(req.body?.reason || '').trim().slice(0, 200) || null;
    db.prepare('UPDATE mc_accounts SET suspended = ?, suspend_reason = ? WHERE id = ?').run(
      suspended ? 1 : 0,
      suspended ? reason : null,
      id
    );
    if (suspended) {
      for (const row of db.prepare('SELECT profile_id FROM profile_accounts WHERE account_id = ?').all(id)) {
        supervisor.stop(row.profile_id, id, { keepWanted: false });
      }
    }
    audit(
      req.user.id,
      suspended ? 'admin-account-suspend' : 'admin-account-resume',
      { account: id, owner: account.user_id, reason },
      req.ip
    );
    res.json({ ok: true, suspended, reason: suspended ? reason : null });
  })
);

// ---------------------------------------------------------------- Serverplätze

admin.get(
  '/profiles',
  wrap((req, res) => {
    const lang = langOf(req);
    res.json({
      profiles: db
        .prepare(
          `SELECT p.*, u.username, pl.name_de, pl.name_en, pl.price_credits, pl.free_slot
             FROM profiles p JOIN users u ON u.id = p.user_id LEFT JOIN plans pl ON pl.id = p.plan_id
            ORDER BY p.id DESC LIMIT 500`
        )
        .all()
        .map((row) => ({
          id: row.id,
          user_id: row.user_id,
          username: row.username,
          name: row.name,
          address: row.port ? `${row.host}:${row.port}` : row.host,
          mc_version: row.mc_version,
          plan: lang === 'de' ? row.name_de : row.name_en,
          price_credits: row.price_credits,
          free_slot: Boolean(row.free_slot),
          paid_until: row.paid_until,
          suspended: Boolean(row.suspended),
          locked: Boolean(row.locked),
          online: supervisor.runningOnProfile(row.id),
        })),
    });
  })
);

admin.patch(
  '/profiles/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!profile) throw notFound('Diesen Server gibt es nicht.');
    const body = req.body || {};
    if (body.extend_days !== undefined) {
      const days = requireInt(body.extend_days, 'Tage', { min: 1, max: 3650 });
      const base = Math.max(Date.now(), profile.paid_until || 0);
      db.prepare('UPDATE profiles SET paid_until = ?, suspended = 0 WHERE id = ?').run(
        base + days * 86_400_000,
        id
      );
      audit(req.user.id, 'admin-extend', { profile: id, days });
    }
    if (body.suspended !== undefined) {
      db.prepare('UPDATE profiles SET suspended = ? WHERE id = ?').run(body.suspended ? 1 : 0, id);
      if (body.suspended) supervisor.stopProfile(id, 'Von der Verwaltung stillgelegt.');
    }
    if (body.plan_id !== undefined) {
      const plan = billing.planById(requireInt(body.plan_id, 'Tarif'));
      if (!plan) throw notFound('Diesen Tarif gibt es nicht.');
      const current = billing.planOf(profile);
      const chatLimit = current.free_slot
        ? plan.chat_limit
        : Math.min(profile.chat_limit || plan.chat_limit, plan.chat_limit);
      // Vom Admin gesetzt heißt: ohne Abbuchung, dafür mit klarer Laufzeit.
      db.prepare(
        'UPDATE profiles SET plan_id = ?, suspended = 0, paid_until = ?, chat_limit = ? WHERE id = ?'
      ).run(
        plan.id,
        plan.free_slot ? null : Math.max(Date.now(), profile.paid_until || 0) + billing.MONTH_MS,
        chatLimit,
        id
      );
      audit(req.user.id, 'admin-plan', { profile: id, plan: plan.slug });
    }
    if (body.extend_days !== undefined || body.suspended !== undefined || body.plan_id !== undefined) {
      roles.changed(profile.user_id);
    }
    res.json({ ok: true });
  })
);

admin.delete(
  '/profiles/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const profile = db.prepare('SELECT user_id FROM profiles WHERE id = ?').get(id);
    if (!profile) throw notFound('Diesen Server gibt es nicht.');
    supervisor.stopProfile(id, 'Von der Verwaltung gelöscht.', { keepWanted: false });
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    roles.changed(profile.user_id);
    audit(req.user.id, 'admin-profile-delete', { profile: id });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Protokoll

/**
 * Das Protokoll.
 *
 * `detail` steht in der Datenbank als JSON – eine Zeile wie
 * {"slug":"premium","name_de":"Premium",…} ist zwar vollständig, aber nichts, was jemand liest.
 * Deshalb kommt sie hier **zerlegt** heraus: Feld für Feld, mit Beschriftung, und für alles, was
 * auf einen Datensatz zeigt (Nutzer, Serverplatz, Tarif, Ticket), gleich die Adresse dazu. Was
 * das Panel daraus macht, ist eine Tabelle zum Aufklappen statt einer Textwurst.
 */
const DETAIL_LABELS = {
  de: {
    slug: 'Kürzel', name_de: 'Name (DE)', name_en: 'Name (EN)', blurb_de: 'Text (DE)',
    blurb_en: 'Text (EN)', price_credits: 'Preis', free_slot: 'Gratis-Platz', max_accounts: 'Bots',
    premium: 'Premium-Client', movement: 'Bewegung', proxy: 'Proxys', offline_accounts: 'Offline-Konten',
    fakehost: 'Fake-Host', chat_limit: 'Chatverlauf', chat_limit_editable: 'Chatverlauf änderbar',
    priority_support: 'Support mit Vorrang', board: 'Scoreboard', menus: 'Menüs', pov: 'Live-Ansicht',
    max_macros: 'Macros', addons: 'Zusätze buchbar', highlight: 'Hervorgehoben', sort: 'Reihenfolge',
    active: 'Aktiv', user: 'Nutzer', profile: 'Serverplatz', plan: 'Tarif', ticket: 'Ticket',
    node: 'Standort', addon: 'Zusatz', credits: 'Credits', delta: 'Änderung', days: 'Tage',
    price: 'Preis', qty: 'Menge', refund: 'Gutschrift', status: 'Zustand', keys: 'Felder',
    key: 'Feld', count: 'Anzahl', id: 'Nummer', code: 'Code', name: 'Name', host: 'Host',
    port: 'Port', label: 'Bezeichnung', role: 'Rolle', via: 'Über', source: 'Herkunft',
    owner: 'Gehört', access: 'Zugang', external: 'Fremdkonto', tag: 'Release', category: 'Kategorie',
    title: 'Titel', discord_role: 'Discord-Rolle', subject: 'Betreff', reason: 'Grund',
    text: 'Text', locked: 'Gesperrt', sent: 'Verschickt', skipped: 'Übersprungen', test: 'Testlauf',
    provider: 'Anbieter', to: 'An', new: 'Neu', priority: 'Dringlichkeit', note: 'Notiz',
    proxy_id: 'Proxy', max_bots: 'Bots höchstens', max_profiles: 'Server höchstens', region: 'Region',
  },
  en: {
    slug: 'Slug', name_de: 'Name (DE)', name_en: 'Name (EN)', blurb_de: 'Text (DE)',
    blurb_en: 'Text (EN)', price_credits: 'Price', free_slot: 'Free slot', max_accounts: 'Bots',
    premium: 'Premium client', movement: 'Movement', proxy: 'Proxies', offline_accounts: 'Offline accounts',
    fakehost: 'Fake host', chat_limit: 'Chat history', chat_limit_editable: 'Chat history editable',
    priority_support: 'Priority support', board: 'Scoreboard', menus: 'Menus', pov: 'Live view',
    max_macros: 'Macros', addons: 'Extras bookable', highlight: 'Highlighted', sort: 'Order',
    active: 'Active', user: 'User', profile: 'Server slot', plan: 'Plan', ticket: 'Ticket',
    node: 'Location', addon: 'Extra', credits: 'Credits', delta: 'Change', days: 'Days',
    price: 'Price', qty: 'Quantity', refund: 'Refund', status: 'Status', keys: 'Fields',
    key: 'Field', count: 'Count', id: 'Number', code: 'Code', name: 'Name', host: 'Host',
    port: 'Port', label: 'Label', role: 'Role', via: 'Via', source: 'Source',
    owner: 'Owner', access: 'Access', external: 'External account', tag: 'Release', category: 'Category',
    title: 'Title', discord_role: 'Discord role', subject: 'Subject', reason: 'Reason',
    text: 'Text', locked: 'Locked', sent: 'Sent', skipped: 'Skipped', test: 'Test run',
    provider: 'Provider', to: 'To', new: 'New', priority: 'Priority', note: 'Note',
    proxy_id: 'Proxy', max_bots: 'Max bots', max_profiles: 'Max servers', region: 'Region',
  },
};

/** Auf welche Ansicht ein Feld zeigt. */
const DETAIL_LINKS = {
  user: (value) => `#/admin/users/${value}`,
  owner: (value) => `#/admin/users/${value}`,
  profile: (value) => `#/admin/servers/${value}`,
  ticket: (value) => `#/admin/tickets/${value}`,
};

/** Flags, die als Ja/Nein gemeint sind und nicht als Zahl. */
const DETAIL_FLAGS = new Set([
  'free_slot', 'premium', 'movement', 'proxy', 'offline_accounts', 'fakehost',
  'chat_limit_editable', 'priority_support', 'board', 'menus', 'pov', 'addons',
  'highlight', 'active',
]);

function explainDetail(raw, lang = 'de') {
  if (!raw) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { text: String(raw), fields: [] };
  }
  if (value === null || typeof value !== 'object') return { text: String(value), fields: [] };
  const labels = DETAIL_LABELS[lang === 'en' ? 'en' : 'de'];
  // `Object.hasOwn` statt einer bloßen Wahrheitsprüfung: Ein Protokolleintrag mit dem Feld
  // `constructor` (oder `toString`) traf sonst die Prototypenkette – die Beschriftung war dann
  // der Quelltext einer Funktion und der "Link" ein Aufruf des Object-Konstruktors.
  const labelOf = (key) => (Object.hasOwn(labels, key) ? labels[key] : key);
  const linkOf = (key, entry) =>
    Object.hasOwn(DETAIL_LINKS, key) && /^\d+$/.test(String(entry)) ? DETAIL_LINKS[key](entry) : null;
  const fields = Object.entries(value)
    .filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')
    .map(([key, entry]) => ({
      key,
      label: labelOf(key),
      value: Array.isArray(entry) ? entry.join(', ') : typeof entry === 'object' ? JSON.stringify(entry) : String(entry),
      flag: DETAIL_FLAGS.has(key) ? Boolean(Number(entry)) : null,
      link: linkOf(key, entry),
    }));
  return { text: '', fields };
}

/** Kurze Zusammenfassung für die Zeile selbst – damit man nicht jede aufklappen muss. */
function summarize(entry, lang = 'de') {
  const detail = entry.detail_parsed;
  if (!detail) return '';
  if (detail.text) return detail.text.slice(0, 120);
  const first = detail.fields.slice(0, 3).map((field) => `${field.label}: ${field.value}`);
  const rest = detail.fields.length - first.length;
  return first.join(' · ') + (rest > 0 ? ` · +${rest}` : '');
}

admin.get(
  '/audit',
  wrap((req, res) => {
    const lang = langOf(req);
    const action = String(req.query.action || '').trim();
    const search = String(req.query.q || '').trim();
    // `Number("abc")` ist `NaN`, und damit hätte die Bedingung stillschweigend nie zugetroffen:
    // Das Protokoll wäre leer geblieben, ohne dass irgendwo stünde, warum.
    const wantedUser = Number(req.query.user);
    const userId = Number.isInteger(wantedUser) && wantedUser > 0 ? wantedUser : null;
    const where = [];
    const values = [];
    if (action) {
      where.push('a.action = ?');
      values.push(action);
    }
    if (userId) {
      where.push('a.user_id = ?');
      values.push(userId);
    }
    if (search) {
      where.push('(a.detail LIKE ? OR u.username LIKE ? OR a.action LIKE ?)');
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const entries = db
      .prepare(
        `SELECT a.*, u.username FROM audit a LEFT JOIN users u ON u.id = a.user_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY a.id DESC LIMIT 300`
      )
      .all(...values)
      .map((row) => {
        const parsed = explainDetail(row.detail, lang);
        const out = { ...row, detail_parsed: parsed };
        return { ...out, summary: summarize(out, lang) };
      });

    res.json({
      entries,
      actions: db
        .prepare('SELECT action, COUNT(*) AS n FROM audit GROUP BY action ORDER BY action')
        .all(),
    });
  })
);

admin.get(
  '/ledger',
  wrap((req, res) => {
    res.json({
      entries: db
        .prepare(
          `SELECT l.*, u.username FROM ledger l JOIN users u ON u.id = l.user_id
            ORDER BY l.id DESC LIMIT 300`
        )
        .all(),
      total: formatCredits(
        db.prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM users').get().n,
        langOf(req)
      ),
    });
  })
);

// ---------------------------------------------------------------- Standorte
//
// Wie ein Standort angelegt wird und was dazugehört, steht Schritt für Schritt in
// docs/standorte.md – hier stehen nur die Endpunkte.

admin.get(
  '/nodes',
  wrap((req, res) => {
    res.json({
      nodes: nodes.list({ includeInactive: true }).map(nodes.adminView),
      proxies: db
        .prepare('SELECT id, label, kind, host, port FROM proxies ORDER BY label COLLATE NOCASE')
        .all(),
      access: nodes.ACCESS,
      kinds: nodes.KINDS,
      // Der Befehl zum Einrichten – mit der Adresse, unter der dieses Panel wirklich erreichbar
      // ist. Ohne sie müsste man sie beim Aufsetzen von Hand abtippen, und genau dabei geht es
      // schief.
      panel_url: config.publicUrl,
    });
  })
);

/** Ein neues Token. Der Standort fliegt damit sofort heraus – das ist der Sinn. */
admin.post(
  '/nodes/:id/token',
  wrap((req, res) => {
    const node = nodes.rotateToken(requireInt(req.params.id, 'Standort'), req.user.id);
    res.json({ node: nodes.adminView(node) });
  })
);

admin.post(
  '/nodes',
  wrap((req, res) => res.json({ node: nodes.adminView(nodes.create(req.body || {}, req.user.id)) }))
);

admin.patch(
  '/nodes/:id',
  wrap((req, res) =>
    res.json({
      node: nodes.adminView(nodes.update(requireInt(req.params.id, 'Standort'), req.body || {}, req.user.id)),
    })
  )
);

admin.delete(
  '/nodes/:id',
  wrap((req, res) => {
    nodes.remove(requireInt(req.params.id, 'Standort'), req.user.id);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Zusätze

admin.get(
  '/addons',
  wrap((req, res) => {
    res.json({
      addons: billing.addons({ includeInactive: true }).map((addon) => ({
        ...addon,
        in_use: db.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM profile_addons WHERE addon_id = ?').get(addon.id).n,
      })),
      caps: binaries.anyCaps(),
    });
  })
);

const ADDON_TEXTS = ['key', 'name_de', 'name_en', 'text_de', 'text_en', 'flag', 'need_cap'];
const ADDON_NUMBERS = ['price_credits', 'amount', 'max_qty', 'sort'];
const ADDON_FLAGS = ['available', 'active'];

function addonValues(body, existing = {}) {
  const out = {};
  for (const field of [...ADDON_TEXTS, ...ADDON_NUMBERS, ...ADDON_FLAGS]) {
    if (body[field] === undefined) continue;
    if (ADDON_TEXTS.includes(field)) out[field] = String(body[field] ?? '').slice(0, 400) || null;
    else if (ADDON_NUMBERS.includes(field)) out[field] = requireInt(body[field], field, { max: 1_000_000 });
    else out[field] = body[field] ? 1 : 0;
  }
  if (body.kind !== undefined) {
    if (!['flag', 'slot'].includes(body.kind)) throw bad('Ein Zusatz ist entweder "flag" oder "slot".');
    out.kind = body.kind;
  }
  if (out.key !== undefined) {
    out.key = String(out.key).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!out.key) throw bad('Der Zusatz braucht ein Kürzel (nur a–z, 0–9 und -).');
  }
  if (out.name_de !== undefined && !String(out.name_de).trim()) throw bad('Der Zusatz braucht einen Namen.');
  return { ...existing, ...out };
}

const ADDON_COLUMNS = [...ADDON_TEXTS, ...ADDON_NUMBERS, ...ADDON_FLAGS, 'kind'];

admin.post(
  '/addons',
  wrap((req, res) => {
    const values = addonValues(req.body || {}, {
      key: '',
      name_de: '',
      name_en: '',
      text_de: '',
      text_en: '',
      price_credits: 0,
      kind: 'flag',
      flag: null,
      amount: 1,
      max_qty: 1,
      need_cap: null,
      available: 1,
      active: 1,
      sort: 50,
    });
    if (db.prepare('SELECT 1 FROM addons WHERE key = ?').get(values.key)) {
      throw bad('Dieses Kürzel gibt es schon.');
    }
    const info = db
      .prepare(
        `INSERT INTO addons (${ADDON_COLUMNS.join(', ')})
         VALUES (${ADDON_COLUMNS.map((column) => `@${column}`).join(', ')})`
      )
      .run(values);
    audit(req.user.id, 'addon-create', { key: values.key }, req.ip);
    res.json({ addon: billing.addonById(info.lastInsertRowid) });
  })
);

admin.patch(
  '/addons/:id',
  wrap((req, res) => {
    const addon = billing.addonById(requireInt(req.params.id, 'Zusatz'));
    if (!addon) throw notFound('Diesen Zusatz gibt es nicht.');
    const values = addonValues(req.body || {});
    const keys = Object.keys(values);
    if (!keys.length) throw bad('Nichts zu ändern.');
    db.prepare(`UPDATE addons SET ${keys.map((key) => `${key} = @${key}`).join(', ')} WHERE id = @id`).run({
      ...values,
      id: addon.id,
    });
    audit(req.user.id, 'addon-update', { key: addon.key, ...values }, req.ip);
    res.json({ addon: billing.addonById(addon.id) });
  })
);

admin.delete(
  '/addons/:id',
  wrap((req, res) => {
    const addon = billing.addonById(requireInt(req.params.id, 'Zusatz'));
    if (!addon) throw notFound('Diesen Zusatz gibt es nicht.');
    const used = db.prepare('SELECT COUNT(*) AS n FROM profile_addons WHERE addon_id = ?').get(addon.id).n;
    if (used) throw bad(`${used} Serverplätze haben diesen Zusatz gebucht. Lieber auf "nicht buchbar" stellen.`);
    db.prepare('DELETE FROM addons WHERE id = ?').run(addon.id);
    audit(req.user.id, 'addon-delete', { key: addon.key }, req.ip);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Ein Serverplatz
//
// Der Betreiber sieht hier dasselbe wie der Kunde – Konten, Zustand, Chat, Anzeigetafel – und
// dazu, was den Kunden nichts angeht: welchem Konto der Platz gehört, was er verbraucht, auf
// welchem Standort er liegt, und die Knöpfe zum Sperren.

admin.get(
  '/servers/:id',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!profile) throw notFound('Diesen Server gibt es nicht.');
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(profile.user_id);
    const lang = langOf(req);
    const features = billing.featuresOf(profile);
    const build = binaries.buildFor(profile, features);
    const usage = metrics.byProfile().get(profile.id) || { bots: 0, rss: 0, cpu_percent: 0 };

    const accounts = db
      .prepare(
        `SELECT pa.account_id, pa.note, pa.proxy_id, pa.wanted, a.name, a.uuid, a.kind, a.status,
                a.last_error, a.suspended, a.suspend_reason, b.state, b.connections, b.uptime_sec
           FROM profile_accounts pa JOIN mc_accounts a ON a.id = pa.account_id
      LEFT JOIN bots b ON b.profile_id = pa.profile_id AND b.account_id = pa.account_id
          WHERE pa.profile_id = ? ORDER BY a.name COLLATE NOCASE`
      )
      .all(profile.id)
      .map((row) => {
        const live = supervisor.get(profile.id, row.account_id);
        return {
          ...row,
          suspended: Boolean(row.suspended),
          suspend_reason: row.suspend_reason || '',
          wanted: Boolean(row.wanted),
          state: live ? live.state : 'offline',
          detail: live ? live.detail : '',
          online: live ? live.online : false,
          since: live ? live.since : null,
          pid: live?.proc?.pid || null,
          views: live ? live.views : null,
          head: `https://minotar.net/helm/${encodeURIComponent(row.uuid || row.name)}/64.png`,
        };
      });

    res.json({
      profile: {
        ...profile,
        address: profile.port ? `${profile.host}:${profile.port}` : profile.host,
        suspended: Boolean(profile.suspended),
        locked: Boolean(profile.locked),
        renew: Boolean(profile.renew),
        movement: Boolean(profile.movement),
        sneak: Boolean(profile.sneak),
        active: billing.isActive(profile),
        days_left: profile.paid_until
          ? Math.max(0, Math.ceil((profile.paid_until - Date.now()) / 86_400_000))
          : null,
        build,
        caps: build ? billing.gateCaps(binaries.caps(build), features) : {},
      },
      owner: owner ? userRow(owner) : null,
      plan: planView(billing.planOf(profile), lang),
      plans: billing.plans({ includeInactive: true }).map((plan) => planView(plan, lang)),
      features,
      addons: billing.addonsOf(profile.id),
      all_addons: billing.addons({ includeInactive: true }),
      monthly_credits: billing.monthlyPrice(profile),
      node: profile.node_id ? nodes.adminView(nodes.byId(profile.node_id)) : null,
      nodes: nodes.list({ includeInactive: true }).map((node) => ({ id: node.id, name: node.name })),
      accounts,
      macros: db.prepare('SELECT COUNT(*) AS n FROM macros WHERE profile_id = ?').get(profile.id).n,
      spam: db.prepare('SELECT COUNT(*) AS n FROM spam WHERE profile_id = ?').get(profile.id).n,
      usage: { ...usage, disk: metrics.diskOfProfile(profile.id) },
    });
  })
);

/** Chatverlauf eines Serverplatzes – dieselbe Sicht, die auch der Kunde hat. */
admin.get(
  '/servers/:id/chat',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const since = Number(req.query.since) || 0;
    const lines = [];
    for (const row of db.prepare('SELECT account_id FROM profile_accounts WHERE profile_id = ?').all(id)) {
      const account = db.prepare('SELECT name FROM mc_accounts WHERE id = ?').get(row.account_id);
      for (const entry of supervisor.historyOf(id, row.account_id, since)) {
        lines.push({ ...entry, account_id: row.account_id, account: account?.name });
      }
    }
    res.json({ lines: mergeLines(lines).slice(-2000), now: Date.now() });
  })
);

/**
 * Etwas an einen Bot schicken – Chat, Serverbefehl oder ein örtlicher Befehl wie `:board`.
 *
 * Das ist der Grund, warum ein Administrator hier mehr kann als der Kunde: Wenn jemand meldet,
 * dass ein Bot nicht mehr mitkommt, hilft es, selbst hineinzuschreiben, statt danach zu fragen.
 * Jede solche Zeile steht im Protokoll, mit Serverplatz und Text.
 */
admin.post(
  '/servers/:id/send',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const text = requireString(req.body?.text, 'Nachricht', { max: 256 });
    const only = Array.isArray(req.body?.accounts) ? req.body.accounts.map(Number) : null;
    const results = [];
    for (const row of db.prepare('SELECT account_id FROM profile_accounts WHERE profile_id = ?').all(id)) {
      if (only?.length && !only.includes(row.account_id)) continue;
      const bot = supervisor.get(id, row.account_id);
      try {
        if (!bot?.running) throw new Error('Der Bot läuft gerade nicht.');
        // Örtliche Befehle laufen über `local`, damit Abfragen wie `:board` als Ansicht ankommen.
        if (text.startsWith(':')) {
          const [verb, ...rest] = text.slice(1).split(' ');
          bot.local(verb.toLowerCase(), rest.join(' '), 'events');
        } else {
          bot.send(text);
        }
        results.push({ account_id: row.account_id, ok: true });
      } catch (error) {
        results.push({ account_id: row.account_id, ok: false, error: error.message });
      }
    }
    audit(req.user.id, 'admin-server-send', { profile: id, text }, req.ip);
    res.json({ results });
  })
);

admin.post(
  '/servers/:id/:action(start|stop|restart)',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const action = req.params.action;
    const rows = db.prepare('SELECT account_id FROM profile_accounts WHERE profile_id = ?').all(id);
    if (action === 'stop') {
      supervisor.stopProfile(id, `Von ${req.user.username} gestoppt.`, { keepWanted: false });
    } else {
      for (const row of rows) {
        if (action === 'restart') supervisor.stop(id, row.account_id, { keepWanted: true });
        const context = supervisor.context(id, row.account_id);
        if (!context) continue;
        setTimeout(
          () => {
            try {
              supervisor.start(context);
            } catch {
              /* der Zustand des Bots sagt, warum */
            }
          },
          action === 'restart' ? 1500 : 0
        ).unref();
      }
    }
    audit(req.user.id, `admin-server-${action}`, { profile: id }, req.ip);
    res.json({ ok: true });
  })
);

/**
 * Einen Serverplatz sperren.
 *
 * Gesperrt heißt: Bots aus, nichts lässt sich mehr ändern, gelöscht wird nichts. Das ist der
 * Knopf für den Fall, dass ein Platz Ärger macht – zwischen "nichts tun" und "Konto sperren"
 * lag vorher nichts.
 */
admin.post(
  '/servers/:id/lock',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!profile) throw notFound('Diesen Server gibt es nicht.');
    const locked = req.body?.locked !== false;
    const reason = String(req.body?.reason || '').slice(0, 200) || null;
    db.prepare('UPDATE profiles SET locked = ?, lock_reason = ? WHERE id = ?').run(
      locked ? 1 : 0,
      locked ? reason : null,
      id
    );
    if (locked) supervisor.stopProfile(id, `Gesperrt${reason ? `: ${reason}` : '.'}`, { keepWanted: false });
    roles.changed(profile.user_id);
    audit(req.user.id, locked ? 'admin-server-lock' : 'admin-server-unlock', { profile: id, reason }, req.ip);
    res.json({ ok: true, locked, reason });
  })
);

/** Einen Serverplatz auf einen anderen Standort schieben. */
admin.post(
  '/servers/:id/node',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    const node = nodes.move(id, requireInt(req.body?.node_id, 'Standort'), req.user.id);
    res.json({ ok: true, node: nodes.view(node) });
  })
);

/** Einen Zusatz von Hand auf einen Serverplatz legen oder wieder abnehmen – ohne Abbuchung. */
admin.post(
  '/servers/:id/addons',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Server');
    // Ohne diese Zeile legte eine erfundene Nummer eine Zeile an, die zu keinem Serverplatz gehört
    // und die niemand je wieder sieht.
    if (!db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(id)) {
      throw notFound('Diesen Server gibt es nicht.');
    }
    const addon = billing.addonById(requireInt(req.body?.addon_id, 'Zusatz'));
    if (!addon) throw notFound('Diesen Zusatz gibt es nicht.');
    const qty = requireInt(req.body?.qty ?? 1, 'Menge', { min: 0, max: addon.max_qty });
    if (qty > 0) {
      // `paid_credits` bleibt bei 0: Von Hand gelegt heißt geschenkt, und was nie bezahlt wurde,
      // kommt beim Abbestellen auch nicht als Guthaben zurück (billing.removeAddon, refundValue).
      db.prepare(
        `INSERT INTO profile_addons (profile_id, addon_id, qty, paid_credits, created_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(profile_id, addon_id) DO UPDATE SET qty = ?`
      ).run(id, addon.id, qty, Date.now(), qty);
    } else {
      db.prepare('DELETE FROM profile_addons WHERE profile_id = ? AND addon_id = ?').run(id, addon.id);
    }
    audit(req.user.id, 'admin-server-addon', { profile: id, addon: addon.key, qty }, req.ip);
    res.json({ ok: true, addons: billing.addonsOf(id) });
  })
);

// ---------------------------------------------------------------- Post an Kunden

/**
 * Eine Nachricht an genau einen Kunden.
 *
 * Sie geht denselben Weg wie jede andere: dieselbe Vorlage, dasselbe Protokoll, und der Empfänger
 * findet sie in seinen Einstellungen wieder. Ein Postfach, aus dem heraus sich nichts nachweisen
 * lässt, wäre für den Kunden wertlos.
 */
admin.post(
  '/users/:id/mail',
  wrap(async (req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Benutzer gibt es nicht.');
    const subject = requireString(req.body?.subject, 'Betreff', { max: 160 });
    const body = requireString(req.body?.body, 'Nachricht', { max: 8000 });
    const category = ['announcement', 'security', 'billing', 'server', 'ticket'].includes(req.body?.category)
      ? req.body.category
      : 'announcement';
    const result = await mail.sendTo(
      user,
      'direct',
      { subject, body, category },
      { force: Boolean(req.body?.force) }
    );
    if (!result.ok) {
      throw bad(
        result.skipped
          ? 'Dieser Kunde hat Nachrichten dieser Sorte abbestellt. Mit "trotzdem senden" geht es.'
          : `E-Mail ließ sich nicht verschicken: ${result.error}`
      );
    }
    audit(req.user.id, 'admin-mail', { user: id, subject }, req.ip);
    res.json({ ok: true });
  })
);

/** Ein Ticket für einen Kunden aufmachen – etwa nach einem Gespräch außerhalb des Panels. */
admin.post(
  '/users/:id/ticket',
  wrap((req, res) => {
    const id = requireInt(req.params.id, 'Benutzer');
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!owner) throw notFound('Benutzer gibt es nicht.');
    const ticket = tickets.create(owner, req.body || {}, {
      by: req.user.id,
      source: 'staff',
      staffPriority: true,
    });
    tickets.notifyParticipants(ticket, 'ticket_opened', { by: req.user.username }, null);
    bridge.emit('ticket.created', { ticket_id: ticket.id, source: 'staff', user_id: owner.id });
    audit(req.user.id, 'admin-ticket-create', { ticket: ticket.id, owner: id }, req.ip);
    res.json({ ticket: ticketView(ticket) });
  })
);
