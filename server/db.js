// SQLite als einzige Datenablage. Ein Schema, das beim Start angelegt wird; Änderungen kommen als
// weitere `migrations`-Einträge dazu, damit ein Update nie von Hand nachgezogen werden muss.
//
// Geldeinheit ist **ein Credit = ein Cent**. 100 Credits = 1 Euro. Ganzzahlig, keine Bruchteile,
// keine Milli-Einheiten: Was im Panel steht, lässt sich ohne Umrechnen mit dem Kontoauszug
// vergleichen. Bezahlt wird nicht nach Stunden, sondern je Serverplatz und Monat – und ein Monat
// sind hier immer genau 30 Tage (siehe MONTH_MS in billing.js).

import Database from 'better-sqlite3';
import { paths } from './config.js';

export const db = new Database(paths.db);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const migrations = [
  {
    name: '001-grundschema',
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',   -- user | admin
        credits_mcr   INTEGER NOT NULL DEFAULT 0,
        rate_mcr_hour INTEGER,
        blocked       INTEGER NOT NULL DEFAULT 0,
        discord_webhook TEXT,
        theme         TEXT NOT NULL DEFAULT 'system',
        language      TEXT NOT NULL DEFAULT 'de',
        chat_limit    INTEGER NOT NULL DEFAULT 200,
        created_at    INTEGER NOT NULL,
        last_seen_at  INTEGER
      );

      CREATE TABLE sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        ip         TEXT,
        agent      TEXT
      );
      CREATE INDEX sessions_user ON sessions(user_id);

      CREATE TABLE ledger (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        delta_mcr     INTEGER NOT NULL,
        balance_mcr   INTEGER NOT NULL,
        kind          TEXT NOT NULL,
        note          TEXT,
        ref           TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX ledger_user ON ledger(user_id, created_at DESC);

      CREATE TABLE vouchers (
        code       TEXT PRIMARY KEY,
        credits_mcr INTEGER NOT NULL,
        uses_left  INTEGER NOT NULL DEFAULT 1,
        note       TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER
      );

      CREATE TABLE topups (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider    TEXT NOT NULL,
        amount_cent INTEGER NOT NULL,
        credits_mcr INTEGER NOT NULL,
        status      TEXT NOT NULL,
        reference   TEXT,
        external_id TEXT,
        created_at  INTEGER NOT NULL,
        paid_at     INTEGER
      );
      CREATE INDEX topups_user ON topups(user_id, created_at DESC);

      CREATE TABLE mc_accounts (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        kind          TEXT NOT NULL DEFAULT 'microsoft',  -- microsoft | offline
        uuid          TEXT,
        status        TEXT NOT NULL DEFAULT 'ok',         -- ok | pending | error
        last_error    TEXT,
        connections   INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        UNIQUE(user_id, name)
      );

      CREATE TABLE profiles (
        id              INTEGER PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        slug            TEXT NOT NULL,
        host            TEXT NOT NULL,
        port            INTEGER NOT NULL DEFAULT 0,
        mc_version      TEXT NOT NULL DEFAULT '26.1',
        runtime         TEXT NOT NULL DEFAULT 'rust',
        join_delay      INTEGER NOT NULL DEFAULT 4,
        reconnect_delay INTEGER NOT NULL DEFAULT 5,
        max_backoff     INTEGER NOT NULL DEFAULT 60,
        chat_delay      INTEGER NOT NULL DEFAULT 1000,
        auto_reconnect  INTEGER NOT NULL DEFAULT 1,
        movement        INTEGER NOT NULL DEFAULT 0,
        anti_afk        TEXT NOT NULL DEFAULT '{}',
        color           TEXT NOT NULL DEFAULT 'neutral',
        ordinal         INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL,
        UNIQUE(user_id, slug)
      );

      CREATE TABLE profile_accounts (
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES mc_accounts(id) ON DELETE CASCADE,
        note       TEXT,
        proxy_id   INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
        wanted     INTEGER NOT NULL DEFAULT 0,
        ordinal    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (profile_id, account_id)
      );

      CREATE TABLE proxies (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label      TEXT NOT NULL,
        kind       TEXT NOT NULL DEFAULT 'socks5',
        host       TEXT NOT NULL,
        port       INTEGER NOT NULL,
        username   TEXT,
        password   TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE spam (
        id           INTEGER PRIMARY KEY,
        profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        message      TEXT NOT NULL,
        interval_sec INTEGER NOT NULL DEFAULT 300,
        accounts     TEXT NOT NULL DEFAULT '[]',
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   INTEGER NOT NULL
      );

      CREATE TABLE macros (
        id         INTEGER PRIMARY KEY,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        event      TEXT NOT NULL DEFAULT 'join',   -- join | timer | chat | world | death | disconnect
        config     TEXT NOT NULL DEFAULT '{}',
        actions    TEXT NOT NULL DEFAULT '[]',
        accounts   TEXT NOT NULL DEFAULT '[]',
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE bots (
        id           INTEGER PRIMARY KEY,
        profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        account_id   INTEGER NOT NULL REFERENCES mc_accounts(id) ON DELETE CASCADE,
        state        TEXT NOT NULL DEFAULT 'offline',
        started_at   INTEGER,
        stopped_at   INTEGER,
        uptime_sec   INTEGER NOT NULL DEFAULT 0,
        connections  INTEGER NOT NULL DEFAULT 0,
        last_error   TEXT,
        UNIQUE(profile_id, account_id)
      );

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE audit (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action     TEXT NOT NULL,
        detail     TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX audit_time ON audit(created_at DESC);
    `,
  },

  {
    // Weg von der Abrechnung im Minutentakt: ein Credit ist jetzt ein Cent, und bezahlt wird je
    // Serverplatz und Monat. Dazu Tickets, E-Mail-Bestätigung, Discord-Verknüpfung und alles,
    // was der neue Client zusätzlich kann.
    name: '002-plaene-tickets-konten',
    sql: `
      -- ---------------------------------------------------------------- Geld
      ALTER TABLE users  RENAME COLUMN credits_mcr TO credits;
      ALTER TABLE ledger RENAME COLUMN delta_mcr   TO delta;
      ALTER TABLE ledger RENAME COLUMN balance_mcr TO balance;
      ALTER TABLE vouchers RENAME COLUMN credits_mcr TO credits;
      ALTER TABLE topups   RENAME COLUMN credits_mcr TO credits;

      -- 1000 mcr entsprachen 1 Credit zu 100 Cent; ein Credit ist jetzt ein Cent.
      UPDATE users    SET credits = credits / 10;
      UPDATE ledger   SET delta = delta / 10, balance = balance / 10;
      UPDATE vouchers SET credits = credits / 10;
      UPDATE topups   SET credits = credits / 10;

      -- ---------------------------------------------------------------- Tarife
      CREATE TABLE plans (
        id                  INTEGER PRIMARY KEY,
        slug                TEXT NOT NULL UNIQUE,
        name_de             TEXT NOT NULL,
        name_en             TEXT NOT NULL,
        blurb_de            TEXT NOT NULL DEFAULT '',
        blurb_en            TEXT NOT NULL DEFAULT '',
        price_credits       INTEGER NOT NULL DEFAULT 0,  -- je Serverplatz und 30 Tage
        free_slot           INTEGER NOT NULL DEFAULT 0,  -- 1 = der eine kostenlose Platz je Konto
        max_accounts        INTEGER NOT NULL DEFAULT 1,  -- Bots gleichzeitig auf diesem Server
        premium             INTEGER NOT NULL DEFAULT 0,  -- Premium-Client statt schlankem
        movement            INTEGER NOT NULL DEFAULT 0,  -- Bewegungsbefehle erlaubt
        proxy               INTEGER NOT NULL DEFAULT 0,  -- Proxys erlaubt (Zuteilung per Ticket)
        offline_accounts    INTEGER NOT NULL DEFAULT 0,  -- Offline-/Cracked-Konten erlaubt
        fakehost            INTEGER NOT NULL DEFAULT 0,
        chat_limit          INTEGER NOT NULL DEFAULT 200,
        chat_limit_editable INTEGER NOT NULL DEFAULT 0,
        priority_support    INTEGER NOT NULL DEFAULT 0,
        sort                INTEGER NOT NULL DEFAULT 0,
        active              INTEGER NOT NULL DEFAULT 1
      );

      ALTER TABLE profiles ADD COLUMN plan_id     INTEGER REFERENCES plans(id);
      ALTER TABLE profiles ADD COLUMN paid_until  INTEGER;
      ALTER TABLE profiles ADD COLUMN suspended   INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE profiles ADD COLUMN chat_limit  INTEGER NOT NULL DEFAULT 200;
      ALTER TABLE profiles ADD COLUMN fake_host   TEXT;
      ALTER TABLE profiles ADD COLUMN antiafk_sec INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE profiles ADD COLUMN sneak       INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE profiles ADD COLUMN on_cooldown INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE profiles ADD COLUMN renew       INTEGER NOT NULL DEFAULT 1;

      -- ---------------------------------------------------------------- Konto
      ALTER TABLE users ADD COLUMN email_verified  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN verify_token    TEXT;
      ALTER TABLE users ADD COLUMN verify_sent_at  INTEGER;
      ALTER TABLE users ADD COLUMN reset_token     TEXT;
      ALTER TABLE users ADD COLUMN reset_expires   INTEGER;
      ALTER TABLE users ADD COLUMN discord_id      TEXT;
      ALTER TABLE users ADD COLUMN discord_name    TEXT;
      ALTER TABLE users ADD COLUMN discord_avatar  TEXT;
      ALTER TABLE users ADD COLUMN notes           TEXT;
      ALTER TABLE users ADD COLUMN premium_until   INTEGER;
      ALTER TABLE users ADD COLUMN proxy_allowance INTEGER NOT NULL DEFAULT 0;
      CREATE UNIQUE INDEX users_discord ON users(discord_id) WHERE discord_id IS NOT NULL;

      -- Wer schon da war, konnte seine Adresse nie bestätigen – also gilt sie als bestätigt.
      UPDATE users SET email_verified = 1;

      -- "Als Nutzer ansehen": die Sitzung merkt sich, wer sie geöffnet hat und wohin es zurückgeht.
      ALTER TABLE sessions ADD COLUMN impersonator_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE sessions ADD COLUMN parent_token    TEXT;

      -- ---------------------------------------------------------------- Proxys
      ALTER TABLE proxies ADD COLUMN assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE proxies ADD COLUMN pool        INTEGER NOT NULL DEFAULT 0;  -- 1 = vom Betreiber
      ALTER TABLE proxies ADD COLUMN note        TEXT;
      UPDATE proxies SET assigned_to = user_id;

      -- ---------------------------------------------------------------- Tickets
      CREATE TABLE tickets (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject      TEXT NOT NULL,
        category     TEXT NOT NULL DEFAULT 'general', -- general | proxy | billing | bug | abuse
        status       TEXT NOT NULL DEFAULT 'open',    -- open | waiting | answered | closed
        priority     TEXT NOT NULL DEFAULT 'normal',  -- low | normal | high | urgent
        assigned_to  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        unread_user  INTEGER NOT NULL DEFAULT 0,
        unread_staff INTEGER NOT NULL DEFAULT 1,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        closed_at    INTEGER
      );
      CREATE INDEX tickets_user ON tickets(user_id, updated_at DESC);

      CREATE TABLE ticket_messages (
        id         INTEGER PRIMARY KEY,
        ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        role       TEXT NOT NULL DEFAULT 'user',   -- user | staff | system
        body       TEXT NOT NULL,
        internal   INTEGER NOT NULL DEFAULT 0,     -- nur für das Team sichtbar
        created_at INTEGER NOT NULL
      );
      CREATE INDEX ticket_messages_ticket ON ticket_messages(ticket_id, id);

      -- ---------------------------------------------------------------- Ankündigungen
      CREATE TABLE announcements (
        id         INTEGER PRIMARY KEY,
        title_de   TEXT NOT NULL,
        title_en   TEXT NOT NULL,
        body_de    TEXT NOT NULL DEFAULT '',
        body_en    TEXT NOT NULL DEFAULT '',
        kind       TEXT NOT NULL DEFAULT 'info',   -- info | warn | bad
        active     INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );

      -- ---------------------------------------------------------------- Post
      CREATE TABLE mails (
        id         INTEGER PRIMARY KEY,
        recipient  TEXT NOT NULL,
        subject    TEXT NOT NULL,
        kind       TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'sent',   -- sent | failed
        error      TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX mails_time ON mails(created_at DESC);
    `,
  },

  {
    // Aufräumen nach dem Wechsel von Milli-Credits auf Cent.
    //
    // Die Tabellen hat 002 erledigt, die Einstellungen nicht: `packages` ist JSON und stand noch
    // in Milli-Credits da (1000 mcr = 1 Cent). Ohne diesen Schritt hätte jedes Aufladepaket im
    // Panel keine Credit-Menge mehr gehabt. Die übrigen Schlüssel gehören zur Stundenabrechnung
    // und werden nicht mehr gelesen – sie fliegen raus, statt als Karteileichen zu verwirren.
    name: '003-pakete-in-cent',
    run() {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'packages'").get();
      if (row) {
        try {
          const list = JSON.parse(row.value);
          if (Array.isArray(list)) {
            const fixed = list.map((entry) => ({
              cent: Number(entry.cent) || 0,
              credits:
                entry.credits !== undefined
                  ? Number(entry.credits)
                  : Math.round(Number(entry.credits_mcr || 0) / 1000),
              label: entry.label || `${((Number(entry.cent) || 0) / 100).toFixed(2)} €`,
            }));
            db.prepare("UPDATE settings SET value = ? WHERE key = 'packages'").run(
              JSON.stringify(fixed)
            );
          }
        } catch {
          // Kaputtes JSON: lieber weg damit, dann greifen die Vorgabewerte.
          db.prepare("DELETE FROM settings WHERE key = 'packages'").run();
        }
      }
      for (const key of ['credit_cent', 'rate_mcr_hour', 'low_balance_mcr', 'signup_bonus_mcr', 'grace_minutes']) {
        db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      }
    },
  },
];

db.exec(`CREATE TABLE IF NOT EXISTS migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
)`);

const applied = new Set(db.prepare('SELECT name FROM migrations').all().map((row) => row.name));
for (const migration of migrations) {
  if (applied.has(migration.name)) continue;
  db.transaction(() => {
    if (migration.sql) db.exec(migration.sql);
    // Manches lässt sich in SQL nicht ausdrücken – etwa JSON in den Einstellungen umrechnen.
    if (migration.run) migration.run();
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
      migration.name,
      Date.now()
    );
  })();
}

// ---------------------------------------------------------------- Tarife anlegen

/**
 * Die Tarife stehen in der Datenbank, damit der Betreiber sie im Admin-Bereich ändern kann. Beim
 * allerersten Start werden diese drei angelegt – danach nie wieder angefasst.
 */
const PLAN_SEED = [
  {
    slug: 'free',
    name_de: 'Gratis',
    name_en: 'Free',
    blurb_de: 'Ein Server, dauerhaft kostenlos. Kein Zahlungsmittel nötig.',
    blurb_en: 'One server, free forever. No payment details needed.',
    price_credits: 0,
    free_slot: 1,
    max_accounts: 1,
    premium: 0,
    movement: 0,
    proxy: 0,
    offline_accounts: 0,
    fakehost: 0,
    chat_limit: 200,
    chat_limit_editable: 0,
    priority_support: 0,
    sort: 0,
  },
  {
    slug: 'premium',
    name_de: 'Premium',
    name_en: 'Premium',
    blurb_de: 'Premium-Client: Bewegung, Anti-AFK, Scoreboard, Menüs, Proxys – je Server im Monat.',
    blurb_en: 'Premium client: movement, anti-AFK, scoreboard, menus, proxies – per server, monthly.',
    price_credits: 249,
    free_slot: 0,
    max_accounts: 5,
    premium: 1,
    movement: 1,
    proxy: 1,
    offline_accounts: 1,
    fakehost: 1,
    chat_limit: 2000,
    chat_limit_editable: 1,
    priority_support: 1,
    sort: 10,
  },
  {
    slug: 'ultra',
    name_de: 'Ultra',
    name_en: 'Ultra',
    blurb_de: 'Für ganze Netzwerke: 25 Bots je Server, längster Chatverlauf, Support mit Vorrang.',
    blurb_en: 'For whole networks: 25 bots per server, longest chat history, priority support.',
    price_credits: 599,
    free_slot: 0,
    max_accounts: 25,
    premium: 1,
    movement: 1,
    proxy: 1,
    offline_accounts: 1,
    fakehost: 1,
    chat_limit: 10000,
    chat_limit_editable: 1,
    priority_support: 1,
    sort: 20,
  },
];

if (!db.prepare('SELECT COUNT(*) AS n FROM plans').get().n) {
  const insert = db.prepare(`INSERT INTO plans
    (slug, name_de, name_en, blurb_de, blurb_en, price_credits, free_slot, max_accounts, premium,
     movement, proxy, offline_accounts, fakehost, chat_limit, chat_limit_editable, priority_support, sort)
    VALUES (@slug, @name_de, @name_en, @blurb_de, @blurb_en, @price_credits, @free_slot,
     @max_accounts, @premium, @movement, @proxy, @offline_accounts, @fakehost, @chat_limit,
     @chat_limit_editable, @priority_support, @sort)`);
  db.transaction(() => PLAN_SEED.forEach((plan) => insert.run(plan)))();
}

// Profile ohne Tarif (aus der Zeit der Stundenabrechnung) bekommen den kostenlosen Platz.
const seededFreePlan = db
  .prepare('SELECT id FROM plans WHERE free_slot = 1 ORDER BY sort LIMIT 1')
  .get();
if (seededFreePlan) {
  db.prepare('UPDATE profiles SET plan_id = ? WHERE plan_id IS NULL').run(seededFreePlan.id);
}

// ---------------------------------------------------------------- Einstellungen

const defaults = {
  // Wie viele Serverplätze je Konto nichts kosten. Die Preise selbst stehen in `plans`.
  free_slots: 1,
  // Startguthaben bei der Registrierung, in Credits (= Cent). 0 = keins, der Gratis-Server reicht.
  signup_bonus: 0,
  // Ab hier warnt das Panel (und schickt eine Discord-Nachricht, wenn hinterlegt).
  low_balance: 200,
  // Wie viele Tage vor Ablauf gewarnt wird.
  renew_warn_days: 3,
  // Aufladepakete: Betrag in Cent -> Credits. 1 Credit = 1 Cent, alles darüber ist Bonus.
  packages: [
    { cent: 500, credits: 500, label: '5 €' },
    { cent: 1000, credits: 1050, label: '10 €' },
    { cent: 2500, credits: 2700, label: '25 €' },
    { cent: 5000, credits: 5600, label: '50 €' },
  ],

  // Registrierung und Post
  registration_open: 1,
  email_verify: 0, // erst sinnvoll, wenn SMTP eingerichtet ist – sonst bleibt es unsichtbar
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: 0, // 1 = TLS ab Verbindungsaufbau (Port 465)
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  smtp_from_name: '',

  // Discord-Verknüpfung über eine eigene Anwendung des Betreibers
  discord_client_id: '',
  discord_client_secret: '',
  discord_login: 0, // 1 = Anmelden mit Discord erlaubt
  discord_staff_webhook: '', // neue Tickets landen hier

  // Rechtstexte. Leer heißt: die Seite sagt, dass der Betreiber sie noch ausfüllen muss.
  // Die _en-Fassung ist freiwillig; fehlt sie, steht überall der deutsche Text.
  legal_imprint: '',
  legal_imprint_en: '',
  legal_privacy: '',
  legal_privacy_en: '',
  legal_terms: '',
  legal_terms_en: '',

  // Betrieb
  maintenance: 0,
  maintenance_text: '',
  max_bots_per_user: 25,
  support_hours: '',
};

const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const writeSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

export function getSetting(key) {
  const row = readSetting.get(key);
  if (!row) return defaults[key];
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(key, value) {
  writeSetting.run(key, JSON.stringify(value));
}

export function allSettings() {
  const out = { ...defaults };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}

export const settingDefaults = defaults;

export function audit(userId, action, detail) {
  db.prepare('INSERT INTO audit (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)').run(
    userId ?? null,
    action,
    detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null,
    Date.now()
  );
}
