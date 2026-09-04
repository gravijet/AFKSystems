// Serverplätze und alles, was daran hängt: Tarif, Konten zuordnen, Bots starten/stoppen, Chat
// lesen und schreiben, Bewegung und Premium-Befehle, Macros und Spam.

import express from 'express';
import { db, audit } from '../db.js';
import { requireUser } from '../auth.js';
import { supervisor } from '../supervisor.js';
import { macros as macroEngine, ACTIONS, EVENT_TYPES } from '../macros.js';
import * as binaries from '../binaries.js';
import * as billing from '../billing.js';
import * as nodes from '../nodes.js';
import * as heads from '../heads.js';
import * as snapshots from '../snapshots.js';
import * as roles from '../roles.js';
import * as schedules from '../schedules.js';
import * as mcping from '../mcping.js';
import { timezoneOf } from '../profile.js';
import { planView, addonView, accountTags } from './core.js';
import { mergeLines, stripFormatting } from '../../public/assets/js/chatlog.js';
import { wrap, requireString, requireInt, bad, notFound, parseAddress, slugify, HttpError, langOf } from '../util.js';

export const router = express.Router();
router.use(requireUser);

/** Einstellungen, die einen Serverplatz beschreiben, aber keine Laufzeit oder Vorgeschichte sind. */
const COPY_SETTINGS = Object.freeze([
  'join_delay', 'chat_delay', 'on_cooldown', 'auto_reconnect', 'reconnect_delay', 'max_backoff',
  'movement', 'antiafk_sec', 'sneak', 'view_distance', 'pov_skip_resources', 'fake_host', 'anti_afk',
  'color', 'note',
]);

// ---------------------------------------------------------------- Hilfen

function ownedProfile(req) {
  const id = requireInt(req.params.id, 'Server');
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!profile) throw notFound('Diesen Server gibt es nicht.', { en: 'No such server.' });
  return profile;
}

function ownedAccount(req, accountId) {
  const account = db
    .prepare('SELECT * FROM mc_accounts WHERE id = ? AND user_id = ?')
    .get(requireInt(accountId, 'Konto'), req.user.id);
  if (!account) throw notFound('Dieses Konto gibt es nicht.', { en: 'No such account.' });
  return account;
}

/** Die Konten eines Serverplatzes samt aktuellem Bot-Zustand. */
function membersOf(profile) {
  const rows = db
    .prepare(
      `SELECT pa.account_id, pa.note, pa.proxy_id, pa.wanted, pa.ordinal,
              a.name, a.uuid, a.status, a.last_error, a.kind, a.suspended, a.suspend_reason, a.tags, a.favorite,
              b.state, b.connections, b.uptime_sec, b.last_error AS bot_error,
              last_state.type AS last_state_type, last_state.detail AS last_state_detail,
              last_state.created_at AS last_state_at
         FROM profile_accounts pa
         JOIN mc_accounts a ON a.id = pa.account_id
    LEFT JOIN bots b ON b.profile_id = pa.profile_id AND b.account_id = pa.account_id
    -- Der Zustand in bots ist nur der letzte Wert. Für die Diagnose brauchen wir zusätzlich
    -- den letzten dokumentierten Zustandswechsel samt Zeitpunkt: Nach einem Neustart des
    -- Panels gibt es kein Live-Objekt mehr, der Kunde soll trotzdem nicht vor einem bloßen
    -- "offline" ohne zeitliche Einordnung stehen. Der vorhandene Index auf
    -- (profile_id, account_id, created_at DESC) macht die kleine korrelierte Suche je Konto
    -- gezielt; alle Ereignisse des Systems zu laden wäre bei einem langen Verlauf unnötig.
    LEFT JOIN bot_events last_state ON last_state.id = (
      SELECT id
        FROM bot_events
       WHERE profile_id = pa.profile_id
         AND account_id = pa.account_id
         AND type IN ('online', 'reconnecting', 'disconnected', 'error', 'auth', 'offline')
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    )
        WHERE pa.profile_id = ?
     ORDER BY pa.ordinal, a.name COLLATE NOCASE`
    )
    .all(profile.id);

  return rows.map((row) => {
    const live = supervisor.get(profile.id, row.account_id);
    // Die Zuordnung darf mehrfach existieren; nur eine laufende Sitzung darf es nicht. Das Panel
    // bekommt den seltenen Altbestand trotzdem zu sehen, statt ihn still als "offline" zu
    // zeichnen. Neue Starts werden zentral im Supervisor verweigert.
    const runningElsewhere = supervisor.runningElsewhere(profile.id, row.account_id);
    return {
      account_id: row.account_id,
      name: row.name,
      uuid: row.uuid,
      kind: row.kind,
      account_status: row.status,
      account_error: row.last_error,
      suspended: Boolean(row.suspended),
      suspend_reason: row.suspend_reason || '',
      tags: accountTags(row.tags),
      favorite: Boolean(row.favorite),
      note: row.note,
      proxy_id: row.proxy_id,
      wanted: Boolean(row.wanted),
      state: live ? live.state : 'offline',
      detail: live ? live.detail : '',
      online: live ? live.online : false,
      running_elsewhere: runningElsewhere,
      since: live ? live.since : null,
      connections: row.connections || 0,
      uptime_sec: row.uptime_sec || 0,
      last_error: live ? live.lastError : row.bot_error,
      // Dieser Zeitpunkt kommt bewusst aus dem dauerhaften Ereignisverlauf und nicht aus dem
      // flüchtigen Bot-Objekt. Damit bleibt die Diagnose auch nach einem Dienstneustart ehrlich.
      last_state: row.last_state_at
        ? { type: row.last_state_type, detail: row.last_state_detail || '', t: row.last_state_at }
        : null,
      retry: live ? live.retry : null,
      menu: live ? live.menu : null,
      // Mit welcher Client-Fassung dieser Bot losgelaufen ist – und ob sie inzwischen abgelöst
      // wurde. Ein Bot hält seine Datei; der Stundentakt tauscht sie unter ihm aus.
      client_version: live ? live.clientVersion : null,
      outdated: live ? live.outdated : false,
      // Ohne diese Zeile wüsste die Live-Ansicht nach jedem Neuladen nicht, welcher Weg gilt:
      // `refresh()` im Browser ersetzt den gemerkten Bot-Zustand durch genau diese Zeile.
      pov: live ? live.povState() : null,
      head: heads.urlFor(row.uuid || row.name),
    };
  });
}

/**
 * Kontenfilter aus der URL, ausschließlich innerhalb dieses Serverplatzes.
 *
 * Eine leere oder fremde Auswahl soll nie stillschweigend zu "alle Konten" werden. Gerade beim
 * Export wäre das eine böse Überraschung: Die Auswahl im Panel ist eine Datenbegrenzung, keine
 * bloße Ansichtseinstellung.
 */
function requestedMemberIds(profile, value) {
  if (value === undefined) return null;
  const parts = String(value).split(',');
  if (!parts.length || parts.some((part) => !/^\d+$/.test(part.trim()))) {
    throw bad('Kontenauswahl ist ungültig.', { en: 'Account selection is invalid.' });
  }
  const ids = [...new Set(parts.map((part) => requireInt(part.trim(), 'Konto', { min: 1 })))];
  const available = new Set(membersOf(profile).map((member) => member.account_id));
  if (ids.some((id) => !available.has(id))) {
    throw bad('Ein ausgewähltes Konto gehört nicht zu diesem Serverplatz.', {
      en: 'A selected account does not belong to this server slot.',
    });
  }
  return ids;
}

function profileView(profile, lang = 'en') {
  const plan = billing.planOf(profile);
  // Einmal holen, dreimal benutzen: Fähigkeiten, Anzeige und Preis fragen dieselbe Liste.
  const booked = billing.addonsOf(profile.id);
  // Was der Platz wirklich kann, steht nicht im Tarif allein: dazugekaufte Zusätze zählen mit.
  const features = billing.featuresOf(profile, booked);
  const members = membersOf(profile);
  const build = binaries.buildFor(profile, features);
  const caps = build ? billing.gateCaps(binaries.caps(build), features) : {};
  const node = profile.node_id ? nodes.byId(profile.node_id) : null;
  return {
    id: profile.id,
    name: profile.name,
    slug: profile.slug,
    host: profile.host,
    port: profile.port,
    address: profile.port ? `${profile.host}:${profile.port}` : profile.host,
    mc_version: profile.mc_version,
    join_delay: profile.join_delay,
    chat_delay: profile.chat_delay,
    chat_limit: profile.chat_limit,
    movement: Boolean(profile.movement),
    fake_host: profile.fake_host || '',
    antiafk_sec: profile.antiafk_sec,
    sneak: Boolean(profile.sneak),
    // 0 heißt "was der Client für richtig hält" – 2 Chunks, in den POV-Bauformen 6.
    view_distance: profile.view_distance || 0,
    pov_skip_resources: Boolean(profile.pov_skip_resources),
    on_cooldown: profile.on_cooldown,
    // Der Wiederanlauf: Fällt ein Bot aus, der im Spiel war, holt ihn das Panel zurück – siehe
    // die Erklärung bei `RESTART_MAX_TRIES` in supervisor.js.
    auto_reconnect: Boolean(profile.auto_reconnect),
    reconnect_delay: profile.reconnect_delay,
    max_backoff: profile.max_backoff,
    anti_afk: JSON.parse(profile.anti_afk || '{}'),
    color: profile.color,
    ordinal: profile.ordinal,
    // Die eigene Notiz des Kunden zu diesem Platz. Sie geht mit, wo der Platz hingeht – und
    // nirgendwo sonst hin.
    note: profile.note || '',
    created_at: profile.created_at,

    plan: planView(plan, lang),
    // Der Tarif sagt, womit der Platz angefangen hat; `features` sagt, was er heute kann.
    features: {
      max_accounts: features.max_accounts,
      board: Boolean(features.board),
      menus: Boolean(features.menus),
      pov: Boolean(features.pov),
      movement: Boolean(features.movement),
      proxy: Boolean(features.proxy),
      premium: Boolean(features.premium),
      max_macros: features.max_macros,
    },
    addons: booked.map((addon) => ({
      id: addon.id,
      key: addon.key,
      name: lang === 'de' ? addon.name_de : addon.name_en,
      qty: addon.qty,
      price_credits: addon.price_credits * addon.qty,
    })),
    monthly_credits: billing.monthlyPrice(profile, booked),
    paid_until: profile.paid_until,
    renew: Boolean(profile.renew),
    suspended: Boolean(profile.suspended),
    locked: Boolean(profile.locked),
    lock_reason: profile.lock_reason || '',
    active: billing.isActive(profile) && !profile.locked,
    free_access: plan.free_slot ? billing.freeAccess(profile.user_id) : null,
    days_left: profile.paid_until
      ? Math.max(0, Math.ceil((profile.paid_until - Date.now()) / 86_400_000))
      : null,
    node: node ? nodes.view(node) : null,

    build,
    caps,
    // Die Client-Fassung, die ein Start **jetzt** benutzen würde. Neben `member.client_version`
    // ergibt das die ganze Auskunft: was liegt bereit, und womit läuft, was gerade läuft.
    client_version: build ? binaries.versionOf(build) : null,
    accounts: members,
    online: members.filter((member) => member.online).length,
    outdated: members.filter((member) => member.outdated).length,
    total: members.length,
  };
}

/**
 * Wie viele Kontonummern eine Anfrage nennen darf.
 *
 * Der Rumpf darf 256 KB groß sein, also passen dort weit über zehntausend Zahlen hinein – und
 * jede einzelne wurde geprüft, oft mit einer eigenen Datenbankabfrage. Ein Serverplatz hat
 * höchstens ein paar Dutzend Konten; alles darüber ist keine Anfrage, sondern eine Last.
 */
const MAX_ACCOUNT_IDS = 200;

const accountIds = (raw) => {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_ACCOUNT_IDS) {
    throw bad(`Höchstens ${MAX_ACCOUNT_IDS} Konten je Anfrage.`, {
      en: `At most ${MAX_ACCOUNT_IDS} accounts per request.`,
    });
  }
  return list;
};

/** Aus dem Wunsch "diese Konten" eine geprüfte Liste machen; leer = alle des Platzes. */
function targets(req, profile) {
  const wanted = accountIds(req.body?.accounts).map(Number);
  const members = db
    .prepare('SELECT account_id FROM profile_accounts WHERE profile_id = ?')
    .all(profile.id)
    .map((row) => row.account_id);
  const list = wanted.length ? members.filter((id) => wanted.includes(id)) : members;
  if (!list.length) throw bad('Keine passenden Konten auf diesem Server.', {
    en: 'No matching accounts on this server.',
  });
  return list;
}

/** Fähigkeiten, die diesem Serverplatz zur Verfügung stehen – Client und Tarif zusammen. */
const capsOf = (profile) => {
  const features = billing.featuresOf(profile);
  const build = binaries.buildFor(profile, features);
  return build ? billing.gateCaps(binaries.caps(build), features) : {};
};

/**
 * Der Text eines Fehlers in der Sprache der Anfrage.
 *
 * Die Endpunkte hier sammeln Teilergebnisse ein ("Konto A ging, Konto B nicht") und geben den
 * Fehler je Konto mit. `error.message` ist bei einem `HttpError` immer die **deutsche** Fassung –
 * ein englischsprachiger Kunde bekam damit die halbe Antwort auf Deutsch, obwohl die englische
 * daneben lag.
 */
const errorText = (error, lang) => (error instanceof HttpError ? error.text(lang) : error.message);

/** Ein suspendierter Serverplatz lässt sich nicht mehr ändern – nur noch ansehen. */
function notLocked(profile) {
  if (profile.locked) {
    throw new HttpError(
      403,
      `"${profile.name}" ist suspendiert${profile.lock_reason ? `: ${profile.lock_reason}` : '.'} Bitte melde dich beim Support.`,
      {
        en: `"${profile.name}" is suspended${profile.lock_reason ? `: ${profile.lock_reason}` : '.'} Please contact support.`,
      }
    );
  }
  return profile;
}

// ---------------------------------------------------------------- Serverplätze

router.get(
  '/',
  wrap((req, res) => {
    const lang = langOf(req);
    const rows = db
      .prepare('SELECT * FROM profiles WHERE user_id = ? ORDER BY ordinal, id')
      .all(req.user.id);
    res.json({
      profiles: rows.map((profile) => profileView(profile, lang)),
      free_slots_left: Math.max(0, billing.freeSlots() - billing.usedFreeSlots(req.user.id)),
      plans: billing.plans().map((plan) => planView(plan, lang)),
      nodes: nodes.visibleFor(req.user),
    });
  })
);

/**
 * Einen Serverplatz anlegen – der Weg, den „neu“ und „kopieren“ sich teilen.
 *
 * **Warum das eine Funktion ist.** Hier stehen die Prüfungen, an denen Geld hängt: Gibt es den
 * Tarif noch, ist der Gratis-Platz frei, reicht das Guthaben, sind die Konten wirklich die des
 * Kunden, passen sie in den Tarif. Ein zweiter Anlegeweg mit einer eigenen Abschrift davon wäre
 * ein zweiter Ort, an dem eine dieser Zeilen fehlen kann – und die Lücke fiele erst auf, wenn
 * jemand darüber einen Platz bekommt, den er nicht bezahlt hat.
 *
 * Gibt den fertigen Serverplatz zurück, wie er in der Datenbank steht.
 */
function createProfile(req, { name, host, port, version, planId, nodeId, accounts }) {
  // Ohne Angabe: der kostenlose Platz, solange einer frei ist – sonst der günstigste bezahlte.
  let plan = planId ? billing.planById(requireInt(planId, 'Tarif')) : null;
  if (!plan) {
    plan = billing.freeSlotAvailable(req.user.id) ? billing.freePlan() : billing.cheapestPaidPlan();
  }
  if (!plan) throw bad('Es ist kein Tarif eingerichtet.', { en: 'No plan is set up.' });
  // `setPlan` prüft das auch – aber nur für bezahlte Tarife, denn für den Gratis-Platz wird es
  // gar nicht erst aufgerufen. Ohne diese Zeile ließ sich ein abgeschalteter Gratis-Tarif über
  // seine Nummer weiter buchen, obwohl der Betreiber ihn gerade aus dem Angebot genommen hat.
  if (!plan.active) {
    throw bad('Dieser Tarif wird nicht mehr angeboten.', { en: 'That plan is no longer offered.' });
  }
  if (plan.free_slot && !billing.freeSlotAvailable(req.user.id)) {
    throw bad(
      `Der kostenlose Serverplatz ist schon vergeben (${billing.freeSlots()} je Konto). Für weitere Server bitte einen bezahlten Tarif wählen.`,
      {
        en: `Your free server slot is taken (${billing.freeSlots()} per account). Pick a paid plan for another server.`,
      }
    );
  }
  if (!plan.free_slot && req.user.credits < plan.price_credits) {
    throw new HttpError(
      402,
      `Zu wenig Guthaben: "${plan.name_de}" kostet ${plan.price_credits} Credits für 30 Tage.`,
      { en: `Not enough credits: "${plan.name_en}" costs ${plan.price_credits} credits for 30 days.` }
    );
  }

  // Die gewünschten Konten **vor** dem Anlegen prüfen: Beides – eine fremde Kontonummer und die
  // Grenze des Tarifs – muss abgelehnt werden, bevor der Platz existiert und bezahlt ist. Die
  // Grenze stand bisher nur in `POST /:id/accounts`; beim Anlegen ließ sich jede Zahl von Konten
  // mitgeben, und der Gratis-Platz kam mit fünfundzwanzig Konten zur Welt, obwohl sein Tarif
  // eines erlaubt. Auffallen konnte das erst beim Starten, mit einer Absage, die niemand mit dem
  // Anlegen in Verbindung brachte.
  const members = [...new Set(accountIds(accounts).map((raw) => ownedAccount(req, raw).id))];
  if (members.length > plan.max_accounts) {
    throw new HttpError(402, `Der Tarif erlaubt ${plan.max_accounts} Konto/Konten auf diesem Server.`, {
      en: `This plan allows ${plan.max_accounts} account(s) on this server.`,
    });
  }

  // Wo der Platz hin soll. Ohne Wunsch nimmt `pick` den ersten freien, den dieses Konto darf.
  const node = nodes.pick(req.user, nodeId);

  let slug = slugify(name);
  let suffix = 1;
  while (db.prepare('SELECT 1 FROM profiles WHERE user_id = ? AND slug = ?').get(req.user.id, slug)) {
    slug = `${slugify(name)}-${++suffix}`;
  }

  const max = db.prepare('SELECT MAX(ordinal) AS m FROM profiles WHERE user_id = ?').get(req.user.id).m;
  const info = db
    .prepare(
      `INSERT INTO profiles (user_id, name, slug, host, port, mc_version, plan_id, node_id, chat_limit, ordinal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      name,
      slug,
      host,
      port,
      version,
      plan.id,
      node.id,
      plan.chat_limit,
      (max ?? 0) + 1,
      Date.now()
    );

  let profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(info.lastInsertRowid);
  // Bezahlt wird erst, wenn der Platz steht – sonst müsste bei einem Fehler zurückgebucht werden.
  if (!plan.free_slot) {
    try {
      profile = billing.setPlan(profile, plan);
    } catch (error) {
      db.prepare('DELETE FROM profiles WHERE id = ?').run(profile.id);
      throw error;
    }
  }

  for (const [ordinal, accountId] of members.entries()) {
    db.prepare(
      'INSERT OR IGNORE INTO profile_accounts (profile_id, account_id, ordinal) VALUES (?, ?, ?)'
    ).run(profile.id, accountId, ordinal);
  }
  roles.changed(req.user.id);
  audit(req.user.id, 'profile-create', { name, host, port, plan: plan.slug });
  return profile;
}

/** Die Protokollversion prüfen: Was der Client nicht sprechen kann, gehört nicht an einen Platz. */
function checkVersion(wanted) {
  const version = String(wanted || binaries.state.defaultVersion);
  if (binaries.state.versions.length && !binaries.state.versions.includes(version)) {
    throw bad(
      `Version "${version}" kann der Client nicht. Möglich: ${binaries.state.versions.join(', ')}`,
      { en: `The client cannot speak "${version}". Available: ${binaries.state.versions.join(', ')}` }
    );
  }
  return version;
}

router.post(
  '/',
  wrap((req, res) => {
    const body = req.body || {};
    const lang = langOf(req);
    const name = requireString(body.name, 'Name', { max: 40 });
    const { host, port } = parseAddress(body.address);
    const profile = createProfile(req, {
      name,
      host,
      port,
      version: checkVersion(body.mc_version),
      planId: body.plan_id,
      nodeId: body.node_id,
      accounts: body.accounts,
    });
    res.json({ profile: profileView(profile, lang), balance: billing.balance(req.user.id) });
  })
);

/**
 * Denselben Serverplatz noch einmal – mit allem, was daran eingestellt ist.
 *
 * **Wofür.** Wer einen Platz eingerichtet hat, hat oft eine halbe Stunde investiert: fünfzehn
 * Makros, ein Zeitplan, vier wiederkehrende Nachrichten, Wartezeiten, die auf genau diesen Server
 * passen. Denselben Aufbau für einen zweiten Server brauchte bisher dieselbe halbe Stunde noch
 * einmal, von Hand, mit den Tippfehlern, die dabei entstehen.
 *
 * **Was nicht mitkommt: die Minecraft-Konten.** Ein Konto kann nur an einer Stelle gleichzeitig im
 * Spiel sein – kopiert stünde es auf zwei Plätzen, und der zweite Start würde von Mojang abgelehnt.
 * Der Kopie fehlen deshalb die Konten, und das ist der eine Handgriff, der danach noch zu tun ist.
 *
 * Und was auch nicht mitkommt: die Zusätze. Sie sind bezahlt, je Platz, und eine Kopie, die
 * ungefragt Zusätze mitbucht, bucht ungefragt Geld ab.
 */
router.get(
  '/:id/copy-preview',
  wrap((req, res) => {
    const source = ownedProfile(req);
    // Der Dialog braucht keine komplette Konfiguration und schon gar keine Makrotexte. Diese vier
    // Zahlen beantworten seine Frage, ohne mehr zu übertragen als dort sichtbar wird.
    const count = (table) =>
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE profile_id = ?`).get(source.id).n;
    res.json({
      sections: {
        settings: COPY_SETTINGS.length,
        macros: count('macros'),
        spam: count('spam'),
        schedules: count('profile_schedules'),
      },
    });
  })
);

router.post(
  '/:id/copy',
  wrap((req, res) => {
    const source = ownedProfile(req);
    const body = req.body || {};
    const lang = langOf(req);
    const name = requireString(body.name ?? `${source.name} (2)`, 'Name', { max: 40 });
    if (body.copy !== undefined && (!body.copy || typeof body.copy !== 'object' || Array.isArray(body.copy))) {
      throw bad('Kopierauswahl ist ungültig.', { en: 'Copy selection is invalid.' });
    }
    // Fehlt die Auswahl (ältere Panel-Versionen/API-Nutzer), bleibt der bisherige vollständige
    // Kopierablauf erhalten. Nur ein ausdrückliches `false` lässt einen Bereich zurück.
    const selection = {
      settings: body.copy?.settings !== false,
      macros: body.copy?.macros !== false,
      spam: body.copy?.spam !== false,
      schedules: body.copy?.schedules !== false,
    };
    const { host, port } =
      body.address === undefined ? { host: source.host, port: source.port } : parseAddress(body.address);

    const copy = createProfile(req, {
      name,
      host,
      port,
      version: checkVersion(body.mc_version ?? source.mc_version),
      // Ohne Wunsch derselbe Tarif wie das Original. Ist das der Gratis-Platz und der ist schon
      // vergeben, sagt `createProfile` das mit dem Satz, der auch sonst dort steht.
      planId: body.plan_id ?? source.plan_id,
      nodeId: body.node_id ?? source.node_id,
      accounts: [],
    });

    // Die Einstellungen. Nur Spalten, die Verhalten beschreiben – nicht `paid_until`, nicht
    // `suspended`, nicht `locked`: Die Kopie ist frisch bezahlt und hat keine Vorgeschichte.
    // `chat_limit` gehört nicht dazu: Es ist vom Tarif gedeckelt, und die Kopie kann einen anderen
    // haben. `createProfile` hat es schon auf das gesetzt, was dieser Tarif hergibt; ein höherer
    // Wert vom Original würde eine Grenze überschreiben, die es aus gutem Grund gibt.
    const carried = selection.settings
      ? COPY_SETTINGS.filter((column) => source[column] !== undefined && source[column] !== null)
      : [];
    if (carried.length) {
      db.prepare(`UPDATE profiles SET ${carried.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`).run(
        ...carried.map((column) => source[column]),
        copy.id
      );
    }

    // Makros, Spam und Zeitpläne. Alle drei hängen an Konten, die es auf der Kopie nicht gibt –
    // deshalb geht die Kontobindung überall verloren: Ein Makro für "alle Konten" ist auf der
    // Kopie richtig, eines für Konto 12 zeigte dort ins Leere.
    const copied = { macros: 0, spam: 0, schedules: 0 };
    db.transaction(() => {
      const macros = selection.macros
        ? db.prepare('SELECT * FROM macros WHERE profile_id = ?').all(source.id)
        : [];
      for (const row of macros) {
        db.prepare(
          `INSERT INTO macros (profile_id, name, event, config, actions, accounts, enabled,
                               cooldown_sec, chance, created_at)
           VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`
        ).run(copy.id, row.name, row.event, row.config, row.actions, row.enabled, row.cooldown_sec, row.chance, Date.now());
        copied.macros += 1;
      }
      const spam = selection.spam ? db.prepare('SELECT * FROM spam WHERE profile_id = ?').all(source.id) : [];
      for (const row of spam) {
        db.prepare(
          `INSERT INTO spam (profile_id, message, interval_sec, accounts, enabled, created_at)
           VALUES (?, ?, ?, '[]', ?, ?)`
        ).run(copy.id, row.message, row.interval_sec, row.enabled, Date.now());
        copied.spam += 1;
      }
      const schedules = selection.schedules
        ? db.prepare('SELECT * FROM profile_schedules WHERE profile_id = ?').all(source.id)
        : [];
      for (const row of schedules) {
        db.prepare(
          `INSERT INTO profile_schedules (profile_id, account_id, action, minutes, days, active, note, created_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`
        ).run(copy.id, row.action, row.minutes, row.days, row.active, row.note, Date.now());
        copied.schedules += 1;
      }
    })();

    audit(req.user.id, 'profile-copy', { from: source.id, to: copy.id, selection, ...copied });
    res.json({
      profile: profileView(db.prepare('SELECT * FROM profiles WHERE id = ?').get(copy.id), lang),
      copied,
      balance: billing.balance(req.user.id),
    });
  })
);

router.get(
  '/:id',
  wrap((req, res) => res.json({ profile: profileView(ownedProfile(req), langOf(req)) }))
);

router.patch(
  '/:id',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    // Für die Grenzen zählt, was der Platz kann – ein dazugekaufter Zusatz gehört dazu.
    const plan = billing.featuresOf(profile);
    const body = req.body || {};
    const set = [];
    const values = [];

    const put = (column, value) => {
      set.push(`${column} = ?`);
      values.push(value);
    };

    if (body.name !== undefined) put('name', requireString(body.name, 'Name', { max: 40 }));
    if (body.address !== undefined) {
      const { host, port } = parseAddress(body.address);
      put('host', host);
      put('port', port);
    }
    if (body.mc_version !== undefined) {
      const version = String(body.mc_version);
      if (binaries.state.versions.length && !binaries.state.versions.includes(version)) {
        throw bad(`Version "${version}" kann der Client nicht.`, {
          en: `The client cannot speak "${version}".`,
        });
      }
      put('mc_version', version);
    }
    // Die eigene Notiz. Sie wird nicht ausgewertet, nur aufbewahrt – deshalb steht hier keine
    // Prüfung außer der Länge. Steuerzeichen fallen weg, Zeilenumbrüche bleiben: Wer sich eine
    // Liste notiert, meint die Umbrüche so.
    if (body.note !== undefined) {
      put(
        'note',
        String(body.note ?? '')
          .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
          .slice(0, 2000)
      );
    }
    if (body.join_delay !== undefined) put('join_delay', requireInt(body.join_delay, 'Join-Delay', { max: 600 }));
    if (body.chat_delay !== undefined) {
      put('chat_delay', requireInt(body.chat_delay, 'Chat-Abstand', { min: 200, max: 60000 }));
    }
    if (body.chat_limit !== undefined) {
      // Den Chatverlauf verlängern darf nur, wessen Tarif das hergibt – er kostet Arbeitsspeicher.
      if (!plan.chat_limit_editable) {
        throw new HttpError(
          402,
          `Der Chatverlauf lässt sich ab einem bezahlten Serverplatz einstellen (hier fest ${plan.chat_limit} Zeilen).`,
          {
            en: `Chat history is adjustable from a paid server slot on (fixed at ${plan.chat_limit} lines here).`,
          }
        );
      }
      put('chat_limit', requireInt(body.chat_limit, 'Chatverlauf', { min: 20, max: plan.chat_limit }));
    }
    if (body.movement !== undefined) {
      if (body.movement && !plan.movement) {
        throw new HttpError(402, 'Bewegung gibt es ab einem bezahlten Serverplatz.', {
          en: 'Movement comes with a paid server slot.',
        });
      }
      put('movement', body.movement ? 1 : 0);
    }
    if (body.fake_host !== undefined) {
      const value = String(body.fake_host || '').trim();
      if (value) {
        if (!plan.fakehost) {
          throw new HttpError(402, 'Fake-Host gibt es ab einem bezahlten Serverplatz.', {
            en: 'The fake host comes with a paid server slot.',
          });
        }
        parseAddress(value); // wirft, wenn es keine Adresse ist
      }
      put('fake_host', value || null);
    }
    if (body.antiafk_sec !== undefined) {
      const seconds = requireInt(body.antiafk_sec, 'Anti-AFK', { max: 3600 });
      if (seconds > 0) {
        if (!plan.premium) {
          throw new HttpError(402, 'Anti-AFK-Bewegung gibt es ab einem bezahlten Serverplatz.', {
            en: 'Anti-AFK movement comes with a paid server slot.',
          });
        }
        if (seconds < 15) {
          throw bad('Anti-AFK geht frühestens alle 15 Sekunden.', {
            en: 'Anti-AFK runs every 15 seconds at the fastest.',
          });
        }
      }
      put('antiafk_sec', seconds);
    }
    if (body.sneak !== undefined) {
      if (body.sneak && !plan.premium) {
        throw new HttpError(402, 'Schleichen gibt es ab einem bezahlten Serverplatz.', {
          en: 'Sneaking comes with a paid server slot.',
        });
      }
      put('sneak', body.sneak ? 1 : 0);
    }
    if (body.view_distance !== undefined) {
      const chunks = requireInt(body.view_distance, 'Sichtweite', { max: 32 });
      if (chunks > 0) {
        if (!plan.premium) {
          throw new HttpError(402, 'Die Sichtweite lässt sich ab einem bezahlten Serverplatz einstellen.', {
            en: 'View distance is adjustable from a paid server slot on.',
          });
        }
        // Der Client selbst nimmt 2 bis 32. Alles darunter wäre keine Sichtweite mehr, sondern
        // ein Bot, der die eigene Position nicht mehr geladen bekommt.
        if (chunks < 2) {
          throw bad('Die Sichtweite geht von 2 bis 32 Chunks (0 = Vorgabe des Clients).', {
            en: 'View distance runs from 2 to 32 chunks (0 = the client’s default).',
          });
        }
      }
      put('view_distance', chunks);
    }
    if (body.pov_skip_resources !== undefined) {
      // Ohne gebuchte Live-Ansicht mit einer Bauform ab 2.6.0 tut die Einstellung nichts – siehe
      // supervisor.js `args()`. Dieselbe Prüfung entscheidet auch, ob der Reiter überhaupt da ist.
      if (body.pov_skip_resources && !capsOf(profile).povresourcesauto) {
        throw new HttpError(
          402,
          'Das braucht eine gebuchte Live-Ansicht mit einer Client-Bauform ab 2.6.0.',
          { en: 'This needs a booked live view with a client build from 2.6.0 on.' }
        );
      }
      put('pov_skip_resources', body.pov_skip_resources ? 1 : 0);
    }
    if (body.on_cooldown !== undefined) {
      put('on_cooldown', requireInt(body.on_cooldown, 'Sperrzeit', { min: 1, max: 3600 }));
    }
    // Der Wiederanlauf steht **jedem** Tarif offen. Er ist keine Leistung, die Rechenzeit kostet,
    // sondern die Entscheidung, einen Ausfall nicht als Kündigung zu lesen – und ein Gratis-Bot,
    // der nach einem Serverneustart aus bleibt, ist genauso kaputt wie ein bezahlter.
    if (body.auto_reconnect !== undefined) put('auto_reconnect', body.auto_reconnect ? 1 : 0);
    if (body.reconnect_delay !== undefined) {
      put('reconnect_delay', requireInt(body.reconnect_delay, 'Wartezeit', { min: 1, max: 3600 }));
    }
    if (body.max_backoff !== undefined) {
      put('max_backoff', requireInt(body.max_backoff, 'Höchstwartezeit', { min: 5, max: 3600 }));
    }
    if (body.color !== undefined) put('color', String(body.color).slice(0, 20));
    if (body.anti_afk !== undefined) {
      const antiAfk = body.anti_afk && typeof body.anti_afk === 'object' ? body.anti_afk : {};
      if (String(antiAfk.command_text || '').trim().startsWith(':')) {
        throw bad('Anti-AFK-Nachrichten dürfen keine örtlichen Client-Befehle sein.', {
          en: 'Anti-AFK messages cannot be local client commands.',
        });
      }
      put('anti_afk', JSON.stringify(antiAfk));
    }
    if (body.ordinal !== undefined) put('ordinal', requireInt(body.ordinal, 'Reihenfolge', { max: 999 }));
    if (body.renew !== undefined) put('renew', body.renew ? 1 : 0);

    if (!set.length) throw bad('Nichts zu ändern.', { en: 'Nothing to change.' });
    values.push(profile.id);
    db.prepare(`UPDATE profiles SET ${set.join(', ')} WHERE id = ?`).run(...values);

    const fresh = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id);
    // Einstellungen greifen erst beim nächsten Start – das sagt das Panel auch so.
    const running = membersOf(fresh).some((member) => member.state !== 'offline');
    res.json({ profile: profileView(fresh, langOf(req)), restart_needed: running });
  })
);

/** Tarif wechseln. Rechnet den Rest des alten Tarifs gut und bucht den neuen voll ab. */
router.get(
  '/:id/plan-preview',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const plan = billing.planById(requireInt(req.query.plan_id, 'Tarif'));
    if (!plan) throw notFound('Diesen Tarif gibt es nicht.', { en: 'No such plan.' });
    const lang = langOf(req);
    const preview = billing.planChangePreview(profile, plan, billing.balance(req.user.id));
    const canUseFree = !plan.free_slot || billing.freeSlotAvailable(req.user.id, profile.id);
    const available = Boolean(plan.active) && canUseFree;
    const labels = {
      premium: lang === 'de' ? 'Premium-Client' : 'Premium client',
      movement: lang === 'de' ? 'Bewegung' : 'Movement',
      proxy: lang === 'de' ? 'Proxy' : 'Proxy',
      offline_accounts: lang === 'de' ? 'Offline-Konten' : 'Offline accounts',
      fakehost: lang === 'de' ? 'Fake-Host' : 'Fake host',
      board: lang === 'de' ? 'Anzeigetafel' : 'Scoreboard',
      menus: lang === 'de' ? 'Menüs' : 'Menus',
      pov: lang === 'de' ? 'Live-Ansicht' : 'Live view',
      priority_support: lang === 'de' ? 'Prioritäts-Support' : 'Priority support',
    };
    const lost = Object.keys(labels)
      .filter((key) => preview.features_before[key] && !preview.features_after[key])
      .map((key) => ({ key, label: labels[key] }));
    const cleared = [
      profile.antiafk_sec > 0 && !preview.features_after.premium ? 'antiafk' : '',
      profile.sneak && !preview.features_after.premium ? 'sneak' : '',
      profile.movement && !preview.features_after.movement ? 'movement' : '',
      profile.fake_host && !preview.features_after.fakehost ? 'fake_host' : '',
    ].filter(Boolean);
    const running = supervisor.runningOnProfile(profile.id);
    res.json({
      available,
      reason: !plan.active
        ? lang === 'de'
          ? 'Dieser Tarif wird nicht mehr angeboten.'
          : 'This plan is no longer offered.'
        : !canUseFree
          ? lang === 'de'
            ? 'Der kostenlose Serverplatz ist bereits vergeben.'
            : 'The free server slot is already taken.'
          : '',
      current: { id: profile.plan_id, name: billing.planOf(profile)[lang === 'de' ? 'name_de' : 'name_en'] },
      target: { id: plan.id, name: plan[lang === 'de' ? 'name_de' : 'name_en'], free_slot: Boolean(plan.free_slot) },
      ...preview,
      removed_addons: preview.removed_addons.map((entry) => {
        const addon = billing.addonById(entry.id);
        return { ...entry, name: addon?.[lang === 'de' ? 'name_de' : 'name_en'] || entry.key };
      }),
      impact: {
        max_accounts: { before: preview.features_before.max_accounts, after: preview.features_after.max_accounts },
        lost,
        cleared,
        running,
        stops_running: running > preview.features_after.max_accounts,
      },
    });
  })
);

router.post(
  '/:id/plan',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const plan = billing.planById(requireInt(req.body?.plan_id, 'Tarif'));
    if (!plan) throw notFound('Diesen Tarif gibt es nicht.', { en: 'No such plan.' });
    const updated = billing.setPlan(profile, plan);
    // Was der neue Tarif nicht mehr hergibt, wird sofort abgeschaltet statt still weiterzulaufen.
    // Gerechnet wird mit den Merkmalen nach dem Wechsel: setPlan hat Zusätze, die der neue Tarif
    // schon mitbringt oder gar nicht erlaubt, bereits abgeräumt.
    const features = billing.featuresOf(updated);
    if (!features.premium) {
      db.prepare('UPDATE profiles SET antiafk_sec = 0, sneak = 0 WHERE id = ?').run(profile.id);
    }
    if (!features.movement) db.prepare('UPDATE profiles SET movement = 0 WHERE id = ?').run(profile.id);
    if (!features.fakehost) db.prepare('UPDATE profiles SET fake_host = NULL WHERE id = ?').run(profile.id);
    if (supervisor.runningOnProfile(profile.id) > features.max_accounts) {
      supervisor.stopProfile(profile.id, 'Tarif gewechselt – bitte neu starten.', { keepWanted: false });
    }
    // Ein anderer Tarif kann eine andere Discord-Rolle bedeuten – der Bot erfährt es sofort.
    roles.changed(req.user.id);
    res.json({
      profile: profileView(db.prepare('SELECT * FROM profiles WHERE id = ?').get(updated.id), langOf(req)),
      balance: billing.balance(req.user.id),
    });
  })
);

// ---------------------------------------------------------------- Zusätze
//
// Ein Serverplatz muss nicht auf den nächstgrößeren Tarif springen, nur weil ein Bot mehr
// gebraucht wird. Bezahlt wird beim Buchen anteilig für den Rest des Monats; ab der nächsten
// Verlängerung steckt der Zusatz im Monatspreis.

router.get(
  '/:id/addons',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const plan = billing.planOf(profile);
    const lang = langOf(req);
    const caps = binaries.anyCaps();
    const booked = Object.fromEntries(billing.addonsOf(profile.id).map((entry) => [entry.id, entry.qty]));
    res.json({
      allowed: Boolean(plan.addons) && !plan.free_slot,
      reason: plan.free_slot
        ? lang === 'de'
          ? 'Auf dem kostenlosen Serverplatz gibt es keine Zusätze. Wähle zuerst einen bezahlten Tarif.'
          : 'The free server slot takes no extras. Pick a paid plan first.'
        : '',
      addons: billing.addons().map((addon) => {
        const qty = booked[addon.id] || 0;
        // Gedeckelt: `max_qty` steht in der Verwaltung und darf bis in die Millionen gehen. Ohne
        // Deckel baute diese Antwort ein Verzeichnis mit einer Zeile je Stück – eine Million
        // Einträge je Aufruf, für eine Auswahlliste, die niemand so weit herunterscrollt.
        const remaining = Math.min(50, Math.max(0, addon.max_qty - qty));
        return {
          ...addonView(addon, lang, caps),
          qty,
          // Was der Tarif schon kann, muss niemand kaufen.
          included: addon.kind === 'flag' && addon.flag ? Boolean(plan[addon.flag]) : false,
          prorated: billing.proratedPrice(profile, addon.price_credits),
          // Der Gesamtpreis wird einmal gerundet. Bei mehreren Stück wäre "Stückpreis × Menge"
          // gelegentlich einen Credit daneben; deshalb liefert der Server die exakten Summen.
          prorated_by_qty: Object.fromEntries(
            Array.from({ length: remaining }, (_, index) => {
              const amount = index + 1;
              return [amount, billing.proratedPrice(profile, addon.price_credits * amount)];
            })
          ),
        };
      }),
      days_left: profile.paid_until
        ? Math.max(0, Math.ceil((profile.paid_until - Date.now()) / 86_400_000))
        : null,
      monthly_credits: billing.monthlyPrice(profile),
    });
  })
);

/** Preis, Guthabenwirkung und künftigen Monat vor einer Zusatzänderung anzeigen. */
router.get(
  '/:id/addons/:addonId/preview',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const addon = billing.addonById(requireInt(req.params.addonId, 'Zusatz'));
    if (!addon) throw notFound('Diesen Zusatz gibt es nicht.', { en: 'No such extra.' });
    const action = String(req.query.action || '');
    if (action !== 'add' && action !== 'remove') {
      throw bad('Aktion muss add oder remove sein.', { en: 'Action must be add or remove.' });
    }
    const qty = requireInt(req.query.qty ?? 1, 'Menge', { min: 1, max: addon.max_qty });
    const booked = billing.addonsOf(profile.id).find((entry) => entry.id === addon.id);
    if (action === 'remove' && !booked) {
      throw notFound('Dieser Zusatz ist nicht gebucht.', { en: 'This extra is not booked.' });
    }
    const plan = billing.planOf(profile);
    const preview = billing.addonChangePreview(profile, addon, qty, action, billing.balance(req.user.id));
    let reason = '';
    if (action === 'add' && (plan.free_slot || !plan.addons)) reason = 'plan';
    else if (action === 'add' && (!addon.active || !addon.available)) reason = 'unavailable';
    else if (action === 'add' && addon.kind === 'flag' && addon.flag && plan[addon.flag]) reason = 'included';
    else if (action === 'add' && (profile.suspended || !profile.paid_until || profile.paid_until <= Date.now())) reason = 'inactive';
    else if (action === 'add' && preview.qty_after > addon.max_qty) reason = 'limit';
    else if (action === 'add' && preview.shortfall) reason = 'credits';
    res.json({
      allowed: !reason,
      reason,
      preview,
      addon: {
        id: addon.id,
        name: addon[langOf(req) === 'de' ? 'name_de' : 'name_en'],
        max_qty: addon.max_qty,
      },
    });
  })
);

router.post(
  '/:id/addons',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const addon = billing.addonById(requireInt(req.body?.addon_id, 'Zusatz'));
    if (!addon) throw notFound('Diesen Zusatz gibt es nicht.', { en: 'No such extra.' });
    if (addon.need_cap && !binaries.anyCaps()[addon.need_cap]) {
      throw bad('Der Client kann das auf diesem Server gerade nicht.', {
        en: 'The client cannot do that on this server right now.',
      });
    }
    const qty = requireInt(req.body?.qty ?? 1, 'Menge', { min: 1, max: addon.max_qty });
    const result = billing.addAddon(profile, addon, qty);
    res.json({
      ...result,
      profile: profileView(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id), langOf(req)),
    });
  })
);

router.delete(
  '/:id/addons/:addonId',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const addon = billing.addonById(requireInt(req.params.addonId, 'Zusatz'));
    if (!addon) throw notFound('Diesen Zusatz gibt es nicht.', { en: 'No such extra.' });
    const qty = requireInt(req.body?.qty ?? 1, 'Menge', { min: 1, max: addon.max_qty });
    const result = billing.removeAddon(profile, addon, qty);
    // Weniger Bots erlaubt als gerade laufen: die überzähligen gehen aus, sonst liefe etwas
    // weiter, das niemand mehr bezahlt.
    const features = billing.featuresOf(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id));
    if (supervisor.runningOnProfile(profile.id) > features.max_accounts) {
      supervisor.stopProfile(profile.id, 'Zusatz abbestellt – bitte neu starten.', { keepWanted: false });
    }
    res.json({
      ...result,
      profile: profileView(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id), langOf(req)),
    });
  })
);

/**
 * Wie es dem Zielserver geht – MOTD, Spielerzahl, Version, Antwortzeit.
 *
 * **Wofür.** „Mein Bot kommt nicht rein“ hat zwei mögliche Ursachen, und die eine liegt nicht bei
 * uns. Bis hierher stand im Panel nur „Verbindung abgelehnt“, und damit fing die Suche beim Konto
 * an, ging über den Client und endete oft bei der Erkenntnis, dass der Minecraft-Server seit einer
 * Stunde aus ist. Diese Zeile beantwortet das vorher.
 *
 * Ohne `fresh`-Schalter: Die Antwort kommt aus einem Zwischenspeicher von fünfzehn Sekunden
 * (mcping.js). Ein Knopf, mit dem sich ein fremder Server aus unserem Netz beliebig oft anpingen
 * lässt, wäre ein Werkzeug und keine Auskunft.
 */
router.get(
  '/:id/status',
  wrap(async (req, res) => {
    const profile = ownedProfile(req);
    res.json({ status: await mcping.status(profile.host, profile.port) });
  })
);

/**
 * Die laufenden Bots dieses Platzes auf die neue Client-Fassung heben.
 *
 * **Warum das ein Knopf ist und kein Automatismus.** Der Stundentakt lädt jedes neue Release und
 * legt die Datei hin – laufende Bots merken davon nichts, sie halten ihre eigene. Sie dafür von
 * selbst neu zu starten hieße: Ein Bot, der seit drei Wochen still im Spiel sitzt, verschwindet
 * eines Nachmittags für zwanzig Sekunden, ohne dass jemand etwas getan hätte. Auf Servern mit
 * Warteschlange oder Beitrittssperre ist das teuer, und niemand hätte es kommen sehen.
 *
 * Deshalb: Das Panel sagt, dass es eine neue Fassung gibt, und der Kunde entscheidet wann.
 */
router.post(
  '/:id/client-update',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const restarted = supervisor.rolloutClient({ profileId: profile.id });
    if (!restarted) {
      throw bad('Hier läuft nichts mit einer alten Fassung.', {
        en: 'Nothing here is running an old version.',
      });
    }
    res.json({
      ok: true,
      restarted,
      profile: profileView(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id), langOf(req)),
    });
  })
);

/** Den Standort wechseln. Laufende Bots starten dabei neu, weil die Adresse im Start steckt. */
router.post(
  '/:id/node',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const node = nodes.pick(req.user, requireInt(req.body?.node_id, 'Standort'));
    nodes.move(profile.id, node.id, req.user.id);
    res.json({
      profile: profileView(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id), langOf(req)),
    });
  })
);

/** Einen stillgelegten Platz wieder anschalten (bezahlt 30 neue Tage). */
router.post(
  '/:id/resume',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    if (!profile.suspended) throw bad('Dieser Server ist nicht stillgelegt.', {
      en: 'This server is not suspended.',
    });
    const updated = billing.resume(profile);
    roles.changed(req.user.id);
    res.json({ profile: profileView(updated, langOf(req)), balance: billing.balance(req.user.id) });
  })
);

router.delete(
  '/:id',
  wrap((req, res) => {
    // Auch hier `notLocked`: Ein gesperrter Platz ist gesperrt, weil mit ihm etwas nicht stimmt.
    // Ohne diese Zeile konnte man ihn löschen, bekam die Restlaufzeit gutgeschrieben und war die
    // Sperre los – die Sperre war damit ein Knopf, den der Gesperrte selbst ausschalten konnte.
    const profile = notLocked(ownedProfile(req));
    for (const member of membersOf(profile)) supervisor.stop(profile.id, member.account_id);
    // Restlaufzeit kommt aufs Guthaben zurück – gelöscht wird schließlich freiwillig.
    const refund = billing.refundValue(profile);
    if (refund > 0) billing.move(req.user.id, refund, 'refund', `Restguthaben "${profile.name}"`);
    db.prepare('DELETE FROM profiles WHERE id = ?').run(profile.id);
    roles.changed(req.user.id);
    audit(req.user.id, 'profile-delete', { name: profile.name, refund });
    res.json({ ok: true, refund, balance: billing.balance(req.user.id) });
  })
);

// ---------------------------------------------------------------- Konten auf dem Platz

router.post(
  '/:id/accounts',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const plan = billing.featuresOf(profile);
    const wanted = Array.isArray(req.body?.accounts)
      ? accountIds(req.body.accounts)
      : [req.body?.account_id];
    // Jedes Konto gehört einmal geprüft und einmal gezählt. Doppelte Einträge in der Anfrage und
    // solche, die schon auf dem Platz sitzen, haben vorher gegen das Tariflimit gezählt – damit
    // ließ sich ein voller Serverplatz melden, obwohl noch Platz war.
    const accounts = [...new Set(wanted.map((raw) => ownedAccount(req, raw).id))];
    const existing = new Set(
      db
        .prepare('SELECT account_id FROM profile_accounts WHERE profile_id = ?')
        .all(profile.id)
        .map((row) => row.account_id)
    );
    const fresh = accounts.filter((id) => !existing.has(id));
    if (existing.size + fresh.length > plan.max_accounts) {
      throw new HttpError(402, `Der Tarif erlaubt ${plan.max_accounts} Konto/Konten auf diesem Server.`, {
        en: `This plan allows ${plan.max_accounts} account(s) on this server.`,
      });
    }
    let ordinal =
      (db.prepare('SELECT MAX(ordinal) AS max_ordinal FROM profile_accounts WHERE profile_id = ?').get(profile.id)
        .max_ordinal ?? -1) + 1;
    // Eine Sammelauswahl ist eine Aktion, nicht eine Reihe halbfertiger Aktionen. Falls die
    // Datenbank den Vorgang nicht vollständig übernehmen kann, bleibt deshalb auch kein Teil
    // der Auswahl auf dem Platz zurück. Die Besitz- und Tarifprüfungen stehen bewusst davor,
    // damit die Transaktion selbst nur noch die bereits geprüften Einträge schreibt.
    const addMember = db.prepare(
      `INSERT INTO profile_accounts (profile_id, account_id, note, ordinal)
       VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, account_id) DO NOTHING`
    );
    db.transaction(() => {
      for (const accountId of fresh) addMember.run(profile.id, accountId, req.body?.note || null, ordinal++);
    })();
    if (fresh.length) audit(req.user.id, 'profile-accounts-attach', { profile: profile.id, accounts: fresh });
    res.json({ profile: profileView(profile, langOf(req)) });
  })
);

router.patch(
  '/:id/accounts/:accountId',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const plan = billing.featuresOf(profile);
    const account = ownedAccount(req, req.params.accountId);
    const body = req.body || {};
    // Die Reihenfolge ist genau die sichtbare Reihenfolge. Alte Bestände können noch mehrfach
    // denselben Ordinalwert haben; der Name macht sie dann stabil, bis die erste Verschiebung
    // daraus eine eindeutige, fortlaufende Ordnung macht.
    const members = db
      .prepare(
        `SELECT pa.account_id
           FROM profile_accounts pa JOIN mc_accounts a ON a.id = pa.account_id
          WHERE pa.profile_id = ?
          ORDER BY pa.ordinal, a.name COLLATE NOCASE`
      )
      .all(profile.id);
    const from = members.findIndex((member) => member.account_id === account.id);
    if (from < 0) {
      throw notFound('Dieses Konto liegt nicht auf diesem Serverplatz.', {
        en: 'This account is not assigned to this server slot.',
      });
    }

    const updates = [];
    let reordered = null;
    if (body.note !== undefined) {
      updates.push(['note', String(body.note || '').slice(0, 200) || null]);
    }
    if (body.proxy_id !== undefined) {
      if (!plan.proxy) {
        throw new HttpError(402, 'Proxys gibt es ab einem bezahlten Serverplatz.', {
          en: 'Proxies come with a paid server slot.',
        });
      }
      const proxyId = body.proxy_id ? requireInt(body.proxy_id, 'Proxy') : null;
      if (
        proxyId &&
        !db.prepare('SELECT 1 FROM proxies WHERE id = ? AND assigned_to = ?').get(proxyId, req.user.id)
      ) {
        throw notFound('Dieser Proxy ist dir nicht zugeteilt.', { en: 'That proxy is not assigned to you.' });
      }
      updates.push(['proxy_id', proxyId]);
    }
    if (body.ordinal !== undefined) {
      const target = requireInt(body.ordinal, 'Reihenfolge', { min: 0, max: members.length - 1 });
      if (target !== from) {
        const ordered = members.map((member) => member.account_id);
        ordered.splice(target, 0, ordered.splice(from, 1)[0]);
        reordered = ordered;
      }
    }
    // Eine Proxy-Prüfung oder eine ungültige Zielposition darf nicht nachträglich nur die Notiz
    // ändern. Alle zulässigen Änderungen dieses Dialogs gehen deshalb gemeinsam in die Datenbank.
    db.transaction(() => {
      for (const [field, value] of updates) {
        db.prepare(`UPDATE profile_accounts SET ${field} = ? WHERE profile_id = ? AND account_id = ?`).run(
          value,
          profile.id,
          account.id
        );
      }
      if (reordered) {
        const setOrdinal = db.prepare(
          'UPDATE profile_accounts SET ordinal = ? WHERE profile_id = ? AND account_id = ?'
        );
        reordered.forEach((accountId, ordinal) => setOrdinal.run(ordinal, profile.id, accountId));
      }
    })();
    if (reordered) audit(req.user.id, 'profile-account-order', { profile: profile.id, account: account.id });
    res.json({ profile: profileView(profile, langOf(req)) });
  })
);

router.delete(
  '/:id/accounts/:accountId',
  wrap((req, res) => {
    // Auch hier `notLocked`: Ein gesperrter Platz ist gesperrt, weil mit ihm etwas nicht stimmt.
    // Ihn leerzuräumen ist eine Änderung wie jede andere – und wer die Konten abzieht, nimmt dem
    // Support genau das weg, was er sich ansehen soll.
    const profile = notLocked(ownedProfile(req));
    const account = ownedAccount(req, req.params.accountId);
    supervisor.stop(profile.id, account.id);
    db.prepare('DELETE FROM profile_accounts WHERE profile_id = ? AND account_id = ?').run(
      profile.id,
      account.id
    );
    res.json({ profile: profileView(profile, langOf(req)) });
  })
);

// ---------------------------------------------------------------- Starten / Stoppen

router.post(
  '/:id/start',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const plan = billing.featuresOf(profile);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const lang = langOf(req);
    const results = [];
    for (const accountId of targets(req, profile)) {
      const account = db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(accountId);
      try {
        const bot = supervisor.start({ profile, account, user, plan });
        supervisor.resetReconnectCount(profile.id, accountId);
        results.push({ account_id: accountId, ok: true, bot });
      } catch (error) {
        results.push({
          account_id: accountId,
          ok: false,
          error: errorText(error, lang),
          status: error instanceof HttpError ? error.status : 500,
        });
      }
    }
    res.json({ results, profile: profileView(profile, lang) });
  })
);

router.post(
  '/:id/stop',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    for (const accountId of targets(req, profile)) {
      supervisor.stop(profile.id, accountId);
      supervisor.resetReconnectCount(profile.id, accountId);
    }
    res.json({ profile: profileView(profile, langOf(req)) });
  })
);

router.post(
  '/:id/restart',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const plan = billing.featuresOf(profile);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const list = targets(req, profile);
    for (const accountId of list) supervisor.stop(profile.id, accountId, { keepWanted: true });
    // Kurz warten, damit der alte Prozess wirklich weg ist, bevor der neue startet.
    setTimeout(() => {
      for (const accountId of list) {
        const account = db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(accountId);
        try {
          supervisor.start({ profile, account, user, plan });
          supervisor.resetReconnectCount(profile.id, accountId);
        } catch {
          /* Fehler steht im Bot-Zustand */
        }
      }
    }, 1500).unref();
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Zeitpläne
//
// Bots zu festen Zeiten starten und stoppen. Die Zeiten stehen in der Zeitzone des Kontos – siehe
// server/schedules.js. Ein stillgelegter Serverplatz lässt sich weiterhin **ansehen**, aber nicht
// mehr ändern (`notLocked`), genau wie jede andere Einstellung daran.

router.get(
  '/:id/schedules',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const zone = timezoneOf(req.user);
    res.json({
      schedules: schedules.listFor(profile.id, zone),
      // Die Zeitzone, in der diese Uhrzeiten gelten. Sie steht im Panel neben der Liste: Eine
      // Uhrzeit ohne Zeitzone ist eine Behauptung, keine Angabe.
      timezone: zone,
      actions: schedules.ACTIONS,
      max: schedules.MAX_PER_PROFILE,
    });
  })
);

router.post(
  '/:id/schedules',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    res.json({ schedule: schedules.create(profile, req.body || {}, req.user.id, timezoneOf(req.user)) });
  })
);

router.patch(
  '/:id/schedules/:scheduleId',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const id = requireInt(req.params.scheduleId, 'Zeitplan');
    res.json({ schedule: schedules.update(profile, id, req.body || {}, req.user.id, timezoneOf(req.user)) });
  })
);

router.delete(
  '/:id/schedules/:scheduleId',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    schedules.remove(profile, requireInt(req.params.scheduleId, 'Zeitplan'), req.user.id);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Ereignisverlauf
//
// Anders als der Chat (`historyOf`, aus dem Speicher des laufenden Prozesses) liest das hier aus
// der Datenbank (`bot_events`, siehe supervisor.js `logEvent`/`eventsOf`) – ein Bot, der gerade
// nicht läuft oder seit dem letzten Neustart des Panels ein neues `Bot`-Objekt ist, hat trotzdem
// seinen Verlauf.

router.get(
  '/:id/events',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const since = Number(req.query.since) || 0;
    const only = requestedMemberIds(profile, req.query.accounts);

    const events = [];
    for (const member of membersOf(profile)) {
      if (only && !only.includes(member.account_id)) continue;
      for (const entry of supervisor.eventsOf(profile.id, member.account_id, since)) {
        events.push({ ...entry, account_id: member.account_id, account: member.name });
      }
    }
    events.sort((a, b) => a.t - b.t);
    res.json({ events, now: Date.now() });
  })
);

/**
 * Ein automatischer Schnappschuss – gezogen von `Bot#captureSnapshot`, sobald ein Bot stirbt oder
 * die Verbindung verliert. Der Dateiname allein öffnet nichts: Er muss zu einer `snapshot`-Zeile
 * dieses Serverplatzes gehören, sonst wäre der Endpunkt eine offene Rateaufgabe auf fremde Bilder.
 */
router.get(
  '/:id/snapshot/:file',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const file = String(req.params.file);
    const row = db
      .prepare("SELECT 1 FROM bot_events WHERE profile_id = ? AND type = 'snapshot' AND detail = ?")
      .get(profile.id, file);
    const body = row ? snapshots.read(file) : null;
    if (!body) throw notFound('Schnappschuss nicht gefunden.', { en: 'Snapshot not found.' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Length', body.length);
    res.end(body);
  })
);

// ---------------------------------------------------------------- Chat

router.get(
  '/:id/chat',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const since = Number(req.query.since) || 0;
    const only = req.query.accounts
      ? String(req.query.accounts).split(',').map(Number).filter(Boolean)
      : null;

    const lines = [];
    for (const member of membersOf(profile)) {
      if (only && !only.includes(member.account_id)) continue;
      for (const entry of supervisor.historyOf(profile.id, member.account_id, since)) {
        lines.push({ ...entry, account_id: member.account_id, account: member.name });
      }
    }
    // Drei Bots auf demselben Server hören denselben Chat. Ohne das Zusammenlegen stünde jede
    // Servernachricht dreimal untereinander – siehe public/assets/js/chatlog.js.
    res.json({ lines: mergeLines(lines).slice(-2000), now: Date.now() });
  })
);

// ---------------------------------------------------------------- Chat-Export
//
// `chat.txt` bleibt als alte, einfache Adresse erhalten. Die Oberfläche nutzt zusätzlich den
// kontrollierten Exportpfad: Format, Zeitraum, Kontenauswahl und Ereignisumfang werden bewusst
// gewählt. Eine Auswahl ist dabei eine Datenbegrenzung, nie nur eine optische Einstellung.
const CHAT_EXPORT_FORMATS = new Set(['txt', 'csv', 'json']);

function exportTimestamp(value, label) {
  if (value === undefined || value === '') return null;
  const text = String(value);
  if (!/^\d{1,16}$/.test(text)) {
    throw bad(`${label} ist ungültig.`, { en: `${label} is invalid.` });
  }
  const timestamp = Number(text);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw bad(`${label} ist ungültig.`, { en: `${label} is invalid.` });
  }
  return timestamp;
}

function csvCell(value) {
  // Chat ist fremder Text. Tabellenprogramme deuten ein führendes =, +, - oder @ gern als
  // Formel; der Export darf deshalb beim Öffnen in Excel oder LibreOffice nichts ausführen.
  const plain = String(value ?? '');
  const text = /^[=+@-]/.test(plain) ? `'${plain}` : plain;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportLines(profile, query) {
  const all = query.all === '1';
  const only = requestedMemberIds(profile, query.accounts);
  const from = exportTimestamp(query.from, 'Startzeit');
  const until = exportTimestamp(query.until, 'Endzeit');
  if (from !== null && until !== null && from > until) {
    throw bad('Die Startzeit liegt nach der Endzeit.', { en: 'The start time is after the end time.' });
  }
  const needle = String(query.q || '').trim();
  if (needle.length > 160) {
    throw bad('Der Suchbegriff ist zu lang.', { en: 'The search term is too long.' });
  }
  const search = needle.toLocaleLowerCase();
  const names = new Map();
  const lines = [];
  for (const member of membersOf(profile)) {
    if (only && !only.includes(member.account_id)) continue;
    names.set(member.account_id, member.name);
    for (const entry of supervisor.historyOf(profile.id, member.account_id)) {
      if (!all && entry.type !== 'chat' && entry.type !== 'sent') continue;
      if (from !== null && entry.t < from) continue;
      if (until !== null && entry.t > until) continue;
      if (search && !stripFormatting(entry.text || '').toLocaleLowerCase().includes(search)) continue;
      lines.push({ ...entry, account_id: member.account_id });
    }
  }
  // Gleichzeitige, identische Serverzeilen mehrerer Bots stehen wie im Panel nur einmal da.
  return mergeLines(lines).map((entry) => {
    const accountIds = entry.accounts?.length ? entry.accounts : entry.account_id ? [entry.account_id] : [];
    return {
      timestamp: entry.t,
      time: new Date(entry.t).toISOString(),
      type: entry.type,
      accounts: accountIds.map((id) => names.get(id) || String(id)),
      text: stripFormatting(entry.text || ''),
    };
  });
}

function sendChatExport(req, res, forcedFormat = '') {
  const profile = ownedProfile(req);
  const format = forcedFormat || String(req.query.format || 'txt').toLowerCase();
  if (!CHAT_EXPORT_FORMATS.has(format)) {
    throw bad('Dieses Exportformat gibt es nicht.', { en: 'That export format is not available.' });
  }
  const lines = exportLines(profile, req.query);
  const generatedAt = new Date().toISOString();
  let contentType;
  let body;
  if (format === 'json') {
    contentType = 'application/json; charset=utf-8';
    body = JSON.stringify(
      {
        exported_at: generatedAt,
        server_slot: {
          id: profile.id,
          name: profile.name,
          address: profile.port ? `${profile.host}:${profile.port}` : profile.host,
        },
        line_count: lines.length,
        // Nur lesbarer Text: Minecraft-Farbcodes helfen weder Tabellenprogrammen noch Tickets.
        lines,
      },
      null,
      2
    );
  } else if (format === 'csv') {
    contentType = 'text/csv; charset=utf-8';
    body = [
      ['timestamp', 'type', 'accounts', 'text'].map(csvCell).join(','),
      ...lines.map((entry) => [entry.time, entry.type, entry.accounts.join(', '), entry.text].map(csvCell).join(',')),
    ].join('\n');
  } else {
    contentType = 'text/plain; charset=utf-8';
    body = lines
      .map((entry) => {
        const who =
          entry.type === 'sent'
            ? `> ${entry.accounts.join(', ')}`
            : entry.type === 'chat'
              ? ''
              : `[${entry.type}] ${entry.accounts.join(', ')}`.trim();
        return `${entry.time.replace('T', ' ').slice(0, 19)}  ${who ? `${who}  ` : ''}${entry.text}`;
      })
      .join('\n');
  }
  const name = `${profile.slug || 'chat'}-${new Date().toISOString().slice(0, 10)}.${format}`;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(`${body}\n`);
}

router.get('/:id/chat.txt', wrap((req, res) => sendChatExport(req, res, 'txt')));
router.get('/:id/chat/export', wrap((req, res) => sendChatExport(req, res)));

/**
 * Anzeigetafel und Menü der Bots dieses Platzes.
 *
 * Sie stehen nicht im Chat, weil sie kein Chat sind: dreizehn Zeilen Seitenleiste zwischen den
 * Nachrichten sind für niemanden zu lesen. Der Client schickt sie auf Anfrage, das Panel hält
 * die letzte Antwort je Bot vor und gibt sie hier aus.
 */
router.get(
  '/:id/views',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const kinds = ['board', 'menu', 'inv', 'position'];
    const wanted = kinds.includes(String(req.query.kind)) ? [String(req.query.kind)] : kinds;
    const out = [];
    for (const member of membersOf(profile)) {
      const bot = supervisor.get(profile.id, member.account_id);
      if (!bot) continue;
      for (const kind of wanted) {
        if (bot.views?.[kind]) {
          out.push({ account_id: member.account_id, account: member.name, kind, view: bot.views[kind] });
        }
      }
    }
    res.json({ views: out });
  })
);

router.post(
  '/:id/chat',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const text = requireString(req.body?.text, 'Nachricht', { max: 256 });
    let local = null;
    if (text.startsWith(':')) {
      const [rawVerb, ...rest] = text.slice(1).trim().split(/\s+/);
      const verb = String(rawVerb || '').toLowerCase();
      const need = LOCAL_VERBS[verb];
      if (!need) throw bad(`Unbekannter örtlicher Befehl "${verb}".`, {
        en: `Unknown local command "${verb}".`,
      });
      local = { verb, arg: localArg(verb, rest.join(' ')), need };
    }
    const lang = langOf(req);
    const results = [];
    for (const accountId of targets(req, profile)) {
      const bot = supervisor.get(profile.id, accountId);
      try {
        if (!bot) throw new HttpError(409, 'Der Bot läuft gerade nicht.', { en: 'That bot is not running.' });
        if (local) bot.local(local.verb, local.arg, local.need);
        else bot.send(text);
        results.push({ account_id: accountId, ok: true });
      } catch (error) {
        results.push({ account_id: accountId, ok: false, error: errorText(error, lang) });
      }
    }
    res.json({ results });
  })
);

// ---------------------------------------------------------------- Örtliche Befehle
//
// Bewegung, Spielerzustand, Anzeigetafel und Menüs laufen alle über denselben Weg: eine Zeile mit
// ':' vorn an den Client. Welche Fähigkeit die Bauform dafür braucht, steht in der Tabelle.

const LOCAL_VERBS = {
  go: 'movement',
  look: 'movement',
  jump: 'movement',
  fall: 'movement',
  home: 'movement',
  route: 'movement',
  stop: 'movement',
  pos: 'movement',
  sneak: 'sneak',
  sprint: 'sneak',
  swing: 'sneak',
  use: 'sneak',
  hand: 'sneak',
  board: 'board',
  menu: 'menu',
  click: 'menu',
  close: 'menu',
  slot: 'items',
  inv: 'items',
  antiafk: 'antiafk',
  // Live-Ansicht: `:pov live|stop|frame|info`.
  pov: 'pov',
};

/** Die Betriebsarten der Live-Ansicht. `size` steht bewusst nicht dabei – siehe `localArg`. */
const POV_MODES = ['live', 'stop', 'frame', 'info'];

/**
 * Das Argument eines örtlichen Befehls prüfen.
 *
 * Nur die Live-Ansicht hat hier etwas zu melden: `:pov size …` gibt es nicht mehr, weil die
 * Auflösung fest auf dem Größten steht, was der Client kann (`POV_SIZE` in supervisor.js). Ohne
 * diese Stelle ließe sie sich am Panel vorbei doch wieder kleiner stellen – und das Bild wäre
 * schlechter, ohne dass es billiger würde.
 */
function localArg(verb, raw) {
  const arg = String(raw || '').slice(0, 60).trim();
  if (verb !== 'pov') return arg;
  const mode = (arg.split(/\s+/)[0] || 'live').toLowerCase();
  if (!POV_MODES.includes(mode)) {
    throw bad(`Für die Live-Ansicht gibt es nur ${POV_MODES.join(', ')}.`, {
      en: `The live view takes only ${POV_MODES.join(', ')}.`,
    });
  }
  return mode;
}

const runLocal = wrap((req, res) => {
  const profile = notLocked(ownedProfile(req));
  const lang = langOf(req);
  const verb = String(req.body?.verb || '').toLowerCase();
  const need = LOCAL_VERBS[verb];
  if (!need) throw bad(`Unbekannter Befehl "${verb}".`, { en: `Unknown command "${verb}".` });
  const arg = localArg(verb, req.body?.arg);
  const results = [];
  // Der erste Fehler im Wortlaut **beider** Sprachen – die Sammelabsage unten braucht ihn, und
  // vorher stand dort zweimal derselbe deutsche Satz, auch im englischen `en`-Feld.
  let first = null;
  for (const accountId of targets(req, profile)) {
    const bot = supervisor.get(profile.id, accountId);
    try {
      if (!bot) throw new HttpError(409, 'Der Bot läuft gerade nicht.', { en: 'That bot is not running.' });
      bot.local(verb, arg, need);
      results.push({ account_id: accountId, ok: true });
    } catch (error) {
      if (!first) first = error;
      results.push({ account_id: accountId, ok: false, error: errorText(error, lang) });
    }
  }
  if (results.every((entry) => !entry.ok)) {
    throw new HttpError(409, first?.message || 'Kein Bot konnte den Befehl annehmen.', {
      en: (first instanceof HttpError && first.en) || 'No bot could take the command.',
    });
  }
  res.json({ results });
});

router.post('/:id/command', runLocal);
// Alter Name, damit offene Tabs und Lesezeichen weiter funktionieren.
router.post('/:id/move', runLocal);

// ---------------------------------------------------------------- Die texturierte Live-Ansicht
//
// Seit Client 2.5.0 bringt jeder POV-Bot seinen eigenen kleinen Webserver mit: fertige PNG-Bilder
// aus echten Blockmodellen, dazu Hotbar, Inventar und das offene Menü als Daten. Er lauscht auf
// dem Localhost der Maschine, auf der der Bot läuft, und ist mit einem Zufallstoken geschützt.
//
// Diese Endpunkte sind die Brücke dorthin. Sie sind bewusst dünn – sie prüfen, wem der Bot gehört,
// und reichen durch. Was sie **nicht** tun, ist ebenso wichtig:
//
//   * Sie geben den Token nie heraus. Er bleibt im Panel (siehe supervisor.js `setWeb`).
//   * Sie nehmen keine Adresse entgegen, nur einen festen Satz Pfade. Sonst wäre das hier ein
//     offener Proxy auf den Localhost des Servers – für jeden angemeldeten Kunden.
//   * Sie geben den Inhaltstyp der Antwort nicht weiter, sondern setzen ihn selbst. Was aus einer
//     fremden Weltdatei kommt, soll im Browser ein Bild sein und nichts anderes.

/** Der Bot hinter `:accountId`, samt Prüfung, dass seine Live-Ansicht überhaupt läuft. */
function povBot(req) {
  const profile = ownedProfile(req);
  const account = ownedAccount(req, req.params.accountId);
  if (!capsOf(profile).pov) {
    throw new HttpError(402, 'Die Live-Ansicht ist für diesen Serverplatz nicht gebucht.', {
      en: 'The live view is not booked for this server slot.',
    });
  }
  const bot = supervisor.get(profile.id, account.id);
  if (!bot?.running) {
    throw new HttpError(409, 'Der Bot läuft gerade nicht.', { en: 'That bot is not running.' });
  }
  return bot;
}

/** Bild, Daten oder Text – mehr Sorten kennt der Viewer nicht, und mehr lassen wir nicht durch. */
function sendUpstream(res, answer, { cache = 'no-store' } = {}) {
  const raw = String(answer.type || '');
  const type = raw.startsWith('image/png')
    ? 'image/png'
    : raw.startsWith('application/json')
      ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8';
  res.status(answer.status);
  res.setHeader('Content-Type', type);
  // Lange liegen bleiben darf nur eine Antwort, die auch eine ist. Ein "keine Ressourcen geladen"
  // einen Tag im Browser zu behalten hieße: Wer die Datei danach hinlegt, sieht sie trotzdem nicht.
  res.setHeader('Cache-Control', answer.status === 200 ? cache : 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Ein PNG aus einer fremden Welt bleibt ein PNG. Die Regel kostet nichts und nimmt der Frage,
  // ob jemand hier je etwas Ausführbares hindurchbekommt, die Grundlage.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(answer.body);
}

/**
 * Eine Anfrage an den Viewer weiterreichen. Geht sie schief, ist das kein Serverfehler: Der Bot
 * ist gerade gegangen, der Standort antwortet nicht, das Bild ist noch nicht zu rechnen. Alles
 * davon ist ein 503 mit dem Satz, den der Client oder die Leitung dazu gesagt hat.
 */
async function through(req, res, target, options = {}) {
  const bot = povBot(req);
  let answer;
  try {
    answer = await bot.webFetch(target, { method: options.method || 'GET' });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, `Die Live-Ansicht antwortet nicht: ${error.message}`, {
      en: `The live view is not answering: ${error.message}`,
    });
  }
  sendUpstream(res, answer, options);
}

/** Wie groß ein Bild sein darf. Der Client deckelt selbst bei 640×360; hier steht dieselbe Zahl. */
const clampFrame = (raw, min, max, fallback) => {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
};

router.get(
  '/:id/pov/:accountId/frame.png',
  wrap(async (req, res) => {
    const width = clampFrame(req.query.w, 160, 640, 426);
    const height = clampFrame(req.query.h, 90, 360, 240);
    await through(req, res, `/api/frame.png?w=${width}&h=${height}`);
  })
);

router.get(
  '/:id/pov/:accountId/state.json',
  wrap(async (req, res) => {
    await through(req, res, '/api/state.json');
  })
);

// Das Bild eines Gegenstands ändert sich innerhalb einer Minecraft-Version nie. Es einen Tag im
// Browser liegen zu lassen ist der Unterschied zwischen "ein Menü öffnet sich" und
// "vierundfünfzig Anfragen, jedes Mal wenn es sich öffnet".
const IMMUTABLE = 'private, max-age=86400';

router.get(
  '/:id/pov/:accountId/item.png',
  wrap(async (req, res) => {
    const id = requireInt(req.query.id ?? 0, 'Gegenstand', { min: 0, max: 100_000 });
    await through(req, res, `/api/item.png?id=${id}`, { cache: IMMUTABLE });
  })
);

// Die GUI-Texturen des Spiels (Truhenfenster, Schnellleiste, Auswahlrahmen) reicht das Panel
// **nicht** durch, obwohl der Viewer sie anbietet. Sie hätten genau einen Zweck: eine nachgebaute
// Minecraft-Oberfläche im Panel. Die Felder des Panels sind für denselben Zweck gemacht, sehen im
// hellen wie im dunklen Schema richtig aus und tragen den Aufklapper mit Name und Lore – und ein
// Durchreicher, den nichts benutzt, ist nur eine Fläche mehr, auf die jemand zielen kann.
// Die Bilder der Gegenstände oben sind die Ausnahme: Sie sind der Inhalt und nicht der Rahmen.

/** Ein Feld im offenen Menü anklicken – links, rechts oder mit Shift. */
router.post(
  '/:id/pov/:accountId/click',
  wrap(async (req, res) => {
    notLocked(ownedProfile(req));
    const slot = requireInt(req.body?.slot, 'Feld', { min: 0, max: 200 });
    const action = ['left', 'right', 'shift'].includes(req.body?.action) ? req.body.action : 'left';
    await through(req, res, `/api/click?slot=${slot}&action=${action}`, { method: 'POST' });
  })
);

router.post(
  '/:id/pov/:accountId/close',
  wrap(async (req, res) => {
    notLocked(ownedProfile(req));
    await through(req, res, '/api/close', { method: 'POST' });
  })
);

/** Das Schnellleistenfeld wechseln. Der Client schickt dafür dasselbe Paket wie das Mausrad. */
router.post(
  '/:id/pov/:accountId/hotbar',
  wrap(async (req, res) => {
    notLocked(ownedProfile(req));
    const slot = requireInt(req.body?.slot, 'Feld', { min: 0, max: 8 });
    await through(req, res, `/api/hotbar?slot=${slot}`, { method: 'POST' });
  })
);

// ---------------------------------------------------------------- Macros

const ACTION_TYPES = new Set(ACTIONS.map((action) => action.type));
const ACTION_NEEDS = Object.fromEntries(ACTIONS.map((action) => [action.type, action.needs || null]));

function cleanActions(input, caps) {
  if (!Array.isArray(input)) throw bad('Die Schrittliste fehlt.', { en: 'The list of steps is missing.' });
  if (input.length > 40) throw bad('Höchstens 40 Schritte je Macro.', { en: 'At most 40 steps per macro.' });
  return input.map((raw) => {
    const type = String(raw?.type || '');
    if (!ACTION_TYPES.has(type)) throw bad(`Unbekannter Schritt "${type}".`, { en: `Unknown step "${type}".` });
    const needs = ACTION_NEEDS[type];
    if (needs && !caps[needs]) {
      throw new HttpError(402, `Der Schritt "${type}" braucht einen bezahlten Serverplatz.`, {
        en: `The step "${type}" needs a paid server slot.`,
      });
    }
    const action = { type };
    if (raw.delay) action.delay = requireInt(raw.delay, 'Verzögerung', { max: 3600 });
    // Ein Text, der mit ':' anfängt, wäre ein örtlicher Client-Befehl am Panel vorbei – für jeden
    // Schritt, der Text ins Spiel schickt, dieselbe Sperre.
    if (type === 'chat' || type === 'chat_random') {
      action.text = requireString(raw.text, 'Text', { max: 256 });
      if (action.text.trim().startsWith(':')) {
        throw bad('Nutze für örtliche Client-Befehle den passenden Macro-Schritt.', {
          en: 'Use the matching macro step for local client commands.',
        });
      }
    }
    if (type === 'notify') action.text = requireString(raw.text, 'Text', { max: 500 });
    if (type === 'run') action.name = requireString(raw.name, 'Name des Macros', { max: 60 });
    if (type === 'wait') action.seconds = requireInt(raw.seconds, 'Sekunden', { min: 1, max: 3600 });
    if (type === 'wait_random') {
      action.min_seconds = requireInt(raw.min_seconds ?? 1, 'Von', { min: 1, max: 3600 });
      action.max_seconds = requireInt(raw.max_seconds ?? action.min_seconds, 'Bis', { min: 1, max: 3600 });
      if (action.max_seconds < action.min_seconds) {
        throw bad('Die obere Grenze der Wartezeit liegt unter der unteren.', {
          en: 'The upper bound of the wait is below the lower one.',
        });
      }
    }
    if (type === 'reconnect') {
      action.seconds = requireInt(raw.seconds ?? 5, 'Pause', { min: 1, max: 600 });
    }
    if (type === 'move') {
      action.direction = WALK_DIRECTIONS.includes(raw.direction) ? raw.direction : 'vor';
      action.blocks = requireInt(raw.blocks ?? 1, 'Blöcke', { min: 1, max: 64 });
    }
    // Beim Springen ist "keine Richtung" eine gültige Antwort: dann springt der Bot auf der Stelle.
    if (type === 'jump') {
      action.direction = WALK_DIRECTIONS.includes(raw.direction) ? raw.direction : '';
    }
    if (type === 'look') {
      action.yaw = requireInt(raw.yaw ?? 0, 'Yaw', { min: -180, max: 180 });
      action.pitch = requireInt(raw.pitch ?? 0, 'Pitch', { min: -90, max: 90 });
    }
    if (type === 'face') {
      action.direction = pickOne(raw.direction, FACE_DIRECTIONS, 'Blickrichtung');
    }
    if (type === 'home') action.mode = pickOne(raw.mode, HOME_MODES, 'Heimatposition');
    if (type === 'route') action.mode = pickOne(raw.mode, ROUTE_MODES, 'Wegpunkte');
    if (type === 'sneak' || type === 'sprint') {
      action.mode = pickOne(raw.mode, ['on', 'off', 'toggle'], 'Schalter');
    }
    if (type === 'antiafk') {
      action.mode = pickOne(raw.mode, ['on', 'off', 'seconds'], 'Anti-AFK');
      if (action.mode === 'seconds') {
        action.seconds = requireInt(raw.seconds ?? 60, 'Sekunden', { min: 15, max: 3600 });
      }
    }
    if (type === 'pov') action.mode = pickOne(raw.mode, ['live', 'stop'], 'Live-Ansicht');
    if (type === 'hand') action.slot = requireInt(raw.slot ?? 1, 'Feld', { min: 1, max: 9 });
    if (type === 'click') {
      action.slot = requireInt(raw.slot ?? 0, 'Feld', { min: 0, max: 100 });
      action.button = ['rechts', 'shift'].includes(raw.button) ? raw.button : '';
    }
    if (type === 'slot_read') action.slot = requireInt(raw.slot ?? 0, 'Feld', { min: 0, max: 100 });
    return action;
  });
}

/** Die Auswahllisten der Schritte – dieselben Wörter, die der Client in `:help` nennt. */
const WALK_DIRECTIONS = ['vor', 'zurück', 'links', 'rechts'];
const FACE_DIRECTIONS = ['nord', 'ost', 'süd', 'west', 'nordost', 'südost', 'südwest', 'nordwest', 'um', 'gerade'];
const HOME_MODES = ['go', 'set', 'on', 'off', 'clear'];
const ROUTE_MODES = ['go', 'rec', 'stop', 'add', 'clear'];

/**
 * Einen Wert aus einer festen Liste nehmen – oder absagen.
 *
 * Bewusst **keine** stille Vorgabe wie bei den Richtungen oben: Dort ist "vor" eine sinnvolle
 * Antwort auf einen fehlenden Wert, hier nicht. Wer `:home xyz` speichert und dafür stumm ein
 * `:home go` bekommt, hat ein Macro, das etwas anderes tut, als er hingeschrieben hat.
 */
function pickOne(value, allowed, label) {
  const wanted = String(value ?? allowed[0]);
  if (!allowed.includes(wanted)) {
    throw bad(`${label}: "${wanted}" gibt es nicht (${allowed.join(', ')}).`, {
      en: `${label}: there is no "${wanted}" (${allowed.join(', ')}).`,
    });
  }
  return wanted;
}

/**
 * Die Einstellungen eines Auslösers prüfen.
 *
 * Vorher wanderte hier alles ungeprüft in die Datenbank. Der reguläre Ausdruck eines Chat-Auslösers
 * wird später gegen **jede** Chatzeile gehalten – ein Muster wie `(a+)+b` hätte damit nicht nur den
 * eigenen Bot, sondern den ganzen Dienst zum Stehen gebracht, weil Node einen Faden hat.
 */
function cleanConfig(input, event) {
  const raw = input && typeof input === 'object' ? input : {};
  const config = {};
  if (event === 'timer') {
    config.interval_sec = requireInt(raw.interval_sec ?? 300, 'Intervall', { min: 5, max: 86_400 });
    // Die Streuung darf den Takt nicht auffressen: Bei 30 s Takt und 30 s Streuung käme eine
    // Wartezeit von null heraus, und das ist kein Takt mehr, sondern eine Schleife.
    const jitter = requireInt(raw.jitter_sec ?? 0, 'Streuung', { min: 0, max: 3600 });
    config.jitter_sec = Math.min(jitter, config.interval_sec - 1);
  }
  if (event === 'menu') {
    if (raw.title) config.title = requireString(raw.title, 'Titel enthält', { max: 120 });
  }
  if (event === 'chat') {
    if (raw.exclude) config.exclude = requireString(raw.exclude, 'Aber nicht, wenn', { max: 200 });
    if (raw.contains) config.contains = requireString(raw.contains, 'Chatzeile enthält', { max: 200 });
    if (raw.regex) {
      const pattern = requireString(raw.regex, 'Regulärer Ausdruck', { max: 200 });
      // Ein Quantor, der auf einer Gruppe mit Quantor sitzt, ist der Klassiker für Muster, an
      // denen sich die Suche festfrisst. Der Rest der Sprache bleibt erlaubt.
      if (/[+*}]\s*\)\s*[+*{]/.test(pattern) || /\(\?R|\\\d{2,}/.test(pattern)) {
        throw bad('Dieser reguläre Ausdruck ist zu aufwendig. Nimm „enthält Text“.', {
          en: 'That regular expression is too expensive. Use “contains text” instead.',
        });
      }
      try {
        new RegExp(pattern, 'i');
      } catch {
        throw bad('Das ist kein gültiger regulärer Ausdruck.', {
          en: 'That is not a valid regular expression.',
        });
      }
      config.regex = pattern;
    }
    if (!config.contains && !config.regex) {
      throw bad('Ein Chat-Auslöser braucht einen Text oder einen regulären Ausdruck.', {
        en: 'A chat trigger needs a text or a regular expression.',
      });
    }
  }
  return config;
}

router.get(
  '/:id/macros',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const rows = db.prepare('SELECT * FROM macros WHERE profile_id = ? ORDER BY id').all(profile.id);
    res.json({
      macros: rows.map((row) => ({
        ...row,
        enabled: Boolean(row.enabled),
        config: JSON.parse(row.config || '{}'),
        actions: JSON.parse(row.actions || '[]'),
        accounts: JSON.parse(row.accounts || '[]'),
      })),
      caps: capsOf(profile),
    });
  })
);

router.post(
  '/:id/macros',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const body = req.body || {};
    const name = requireString(body.name, 'Name', { max: 60 });
    const event = EVENT_TYPES.includes(body.event) ? body.event : 'join';
    const actions = cleanActions(body.actions, capsOf(profile));

    // Wie viele Macros ein Platz haben darf, steht im Tarif: jedes läuft im Panel mit und kostet
    // Arbeitsspeicher und Zeit, sobald eine Chatzeile hereinkommt.
    const limit = billing.featuresOf(profile).max_macros;
    const have = db.prepare('SELECT COUNT(*) AS n FROM macros WHERE profile_id = ?').get(profile.id).n;
    if (have >= limit) {
      throw new HttpError(402, `Dieser Tarif erlaubt ${limit} Macros je Serverplatz.`, {
        en: `This plan allows ${limit} macros per server slot.`,
      });
    }
    const info = db
      .prepare(
        `INSERT INTO macros
           (profile_id, name, event, config, actions, accounts, enabled, cooldown_sec, chance, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        profile.id,
        name,
        event,
        JSON.stringify(cleanConfig(body.config, event)),
        JSON.stringify(actions),
        JSON.stringify(accountIds(body.accounts).map(Number)),
        body.enabled === false ? 0 : 1,
        requireInt(body.cooldown_sec ?? 0, 'Sperrzeit', { min: 0, max: 86_400 }),
        requireInt(body.chance ?? 100, 'Wahrscheinlichkeit', { min: 1, max: 100 }),
        Date.now()
      );
    macroEngine.reload(profile.id);
    res.json({ id: info.lastInsertRowid, restart_hint: event === 'join' });
  })
);

router.patch(
  '/:id/macros/:macroId',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const macroId = requireInt(req.params.macroId, 'Macro');
    const macro = db.prepare('SELECT * FROM macros WHERE id = ? AND profile_id = ?').get(macroId, profile.id);
    if (!macro) throw notFound('Dieses Macro gibt es nicht.', { en: 'No such macro.' });
    const body = req.body || {};
    const set = [];
    const values = [];
    // Die Einstellungen hängen am Auslöser: wird nur einer von beiden geschickt, gilt der
    // gespeicherte Rest.
    const event = body.event !== undefined
      ? EVENT_TYPES.includes(body.event)
        ? body.event
        : 'join'
      : macro.event;
    if (body.name !== undefined) {
      set.push('name = ?');
      values.push(requireString(body.name, 'Name', { max: 60 }));
    }
    if (body.event !== undefined) {
      set.push('event = ?');
      values.push(event);
    }
    if (body.config !== undefined || body.event !== undefined) {
      const raw = body.config !== undefined ? body.config : JSON.parse(macro.config || '{}');
      set.push('config = ?');
      values.push(JSON.stringify(cleanConfig(raw, event)));
    }
    if (body.actions !== undefined) {
      set.push('actions = ?');
      values.push(JSON.stringify(cleanActions(body.actions, capsOf(profile))));
    }
    if (body.accounts !== undefined) {
      set.push('accounts = ?');
      values.push(JSON.stringify(accountIds(body.accounts).map(Number)));
    }
    if (body.enabled !== undefined) {
      set.push('enabled = ?');
      values.push(body.enabled ? 1 : 0);
    }
    if (body.cooldown_sec !== undefined) {
      set.push('cooldown_sec = ?');
      values.push(requireInt(body.cooldown_sec, 'Sperrzeit', { min: 0, max: 86_400 }));
    }
    if (body.chance !== undefined) {
      set.push('chance = ?');
      values.push(requireInt(body.chance, 'Wahrscheinlichkeit', { min: 1, max: 100 }));
    }
    if (!set.length) throw bad('Nichts zu ändern.', { en: 'Nothing to change.' });
    values.push(macroId);
    db.prepare(`UPDATE macros SET ${set.join(', ')} WHERE id = ?`).run(...values);
    macroEngine.reload(profile.id);
    res.json({ ok: true });
  })
);

router.delete(
  '/:id/macros/:macroId',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    db.prepare('DELETE FROM macros WHERE id = ? AND profile_id = ?').run(
      requireInt(req.params.macroId, 'Macro'),
      profile.id
    );
    macroEngine.reload(profile.id);
    res.json({ ok: true });
  })
);

/** Ein Macro sofort ausführen – zum Ausprobieren. */
router.post(
  '/:id/macros/:macroId/test',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const macro = db
      .prepare('SELECT * FROM macros WHERE id = ? AND profile_id = ?')
      .get(requireInt(req.params.macroId, 'Macro'), profile.id);
    if (!macro) throw notFound('Dieses Macro gibt es nicht.', { en: 'No such macro.' });
    let started = 0;
    for (const accountId of targets(req, profile)) {
      const bot = supervisor.get(profile.id, accountId);
      if (bot?.online) {
        // Ausdrücklich mit `force`: Sperrzeit und Wahrscheinlichkeit gehören zum Auslöser, und ein
        // Klick auf "Ausprobieren" ist keiner. Sonst täte der Knopf bei einem Macro mit langer
        // Sperrzeit nichts und meldete trotzdem Erfolg.
        macroEngine.run(bot, macro, {}, { force: true });
        started += 1;
      }
    }
    if (!started) throw new HttpError(409, 'Kein Bot dieses Servers ist gerade im Spiel.', {
      en: 'No bot of this server is in the game right now.',
    });
    res.json({ started });
  })
);

// ---------------------------------------------------------------- Spam

router.get(
  '/:id/spam',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const rows = db.prepare('SELECT * FROM spam WHERE profile_id = ? ORDER BY id').all(profile.id);
    res.json({
      spam: rows.map((row) => ({
        ...row,
        enabled: Boolean(row.enabled),
        accounts: JSON.parse(row.accounts || '[]'),
      })),
    });
  })
);

router.post(
  '/:id/spam',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const message = requireString(req.body?.message, 'Nachricht', { max: 256 });
    if (message.trim().startsWith(':')) {
      throw bad('Wiederholte Nachrichten dürfen keine örtlichen Client-Befehle sein.', {
        en: 'Repeated messages cannot be local client commands.',
      });
    }
    // Wiederholte Nachrichten kosten dasselbe wie Macros: je Eintrag und Bot einen Zeitgeber im
    // Panel. Für Macros stand die Grenze aus dem Tarif längst da, hier stand **keine** – wer wollte,
    // legte zehntausend an, und der Dienst tickte sich zu Tode, ohne dass ein Credit floss.
    const limit = billing.featuresOf(profile).max_macros;
    const have = db.prepare('SELECT COUNT(*) AS n FROM spam WHERE profile_id = ?').get(profile.id).n;
    if (have >= limit) {
      throw new HttpError(402, `Dieser Tarif erlaubt ${limit} wiederholte Nachrichten je Serverplatz.`, {
        en: `This plan allows ${limit} repeated messages per server slot.`,
      });
    }
    const interval = requireInt(req.body?.interval_sec ?? 300, 'Intervall', { min: 5, max: 86400 });
    const info = db
      .prepare(
        `INSERT INTO spam (profile_id, message, interval_sec, accounts, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        profile.id,
        message,
        interval,
        JSON.stringify(accountIds(req.body?.accounts).map(Number)),
        req.body?.enabled === false ? 0 : 1,
        Date.now()
      );
    macroEngine.reload(profile.id);
    res.json({ id: info.lastInsertRowid });
  })
);

router.patch(
  '/:id/spam/:spamId',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const spamId = requireInt(req.params.spamId, 'Eintrag');
    const row = db.prepare('SELECT * FROM spam WHERE id = ? AND profile_id = ?').get(spamId, profile.id);
    if (!row) throw notFound('Diesen Eintrag gibt es nicht.', { en: 'No such entry.' });
    const body = req.body || {};
    const set = [];
    const values = [];
    if (body.message !== undefined) {
      const message = requireString(body.message, 'Nachricht', { max: 256 });
      if (message.trim().startsWith(':')) {
        throw bad('Wiederholte Nachrichten dürfen keine örtlichen Client-Befehle sein.', {
          en: 'Repeated messages cannot be local client commands.',
        });
      }
      set.push('message = ?');
      values.push(message);
    }
    if (body.interval_sec !== undefined) {
      set.push('interval_sec = ?');
      values.push(requireInt(body.interval_sec, 'Intervall', { min: 5, max: 86400 }));
    }
    if (body.accounts !== undefined) {
      set.push('accounts = ?');
      values.push(JSON.stringify(accountIds(body.accounts).map(Number)));
    }
    if (body.enabled !== undefined) {
      set.push('enabled = ?');
      values.push(body.enabled ? 1 : 0);
    }
    if (!set.length) throw bad('Nichts zu ändern.', { en: 'Nothing to change.' });
    values.push(spamId);
    db.prepare(`UPDATE spam SET ${set.join(', ')} WHERE id = ?`).run(...values);
    macroEngine.reload(profile.id);
    res.json({ ok: true });
  })
);

router.delete(
  '/:id/spam/:spamId',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    db.prepare('DELETE FROM spam WHERE id = ? AND profile_id = ?').run(
      requireInt(req.params.spamId, 'Eintrag'),
      profile.id
    );
    macroEngine.reload(profile.id);
    res.json({ ok: true });
  })
);

/** Eine Spam-Nachricht sofort einmal senden. */
router.post(
  '/:id/spam/:spamId/test',
  wrap((req, res) => {
    const profile = notLocked(ownedProfile(req));
    const row = db
      .prepare('SELECT * FROM spam WHERE id = ? AND profile_id = ?')
      .get(requireInt(req.params.spamId, 'Eintrag'), profile.id);
    if (!row) throw notFound('Diesen Eintrag gibt es nicht.', { en: 'No such entry.' });
    const only = JSON.parse(row.accounts || '[]');
    let sent = 0;
    for (const member of membersOf(profile)) {
      if (only.length && !only.includes(member.account_id)) continue;
      const bot = supervisor.get(profile.id, member.account_id);
      if (bot?.online) {
        bot.send(row.message);
        sent += 1;
      }
    }
    if (!sent) throw new HttpError(409, 'Kein Bot dieses Servers ist gerade im Spiel.', {
      en: 'No bot of this server is in the game right now.',
    });
    res.json({ sent });
  })
);

export { profileView, membersOf };
