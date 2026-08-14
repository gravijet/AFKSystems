// SQLite als einzige Datenablage. Ein Schema, das beim Start angelegt wird; Änderungen kommen als
// weitere `migrations`-Einträge dazu, damit ein Update nie von Hand nachgezogen werden muss.
//
// Geldeinheit ist überall **Milli-Credit** (mcr): 1000 mcr = 1 Credit. Ganzzahlig, damit sich beim
// Abrechnen im Minutentakt nichts wegrundet. Was ein Credit in Euro kostet, steht in den
// Einstellungen (`credit_cent`), damit der Betreiber es ohne Codeänderung anpassen kann.

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
        rate_mcr_hour INTEGER,                        -- eigener Tarif, sonst der globale
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

      -- Jede Guthabenbewegung, auch die Abrechnung im Minutentakt. Der Kontostand in users ist
      -- nur die schnelle Zusammenfassung; die Wahrheit steht hier.
      CREATE TABLE ledger (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        delta_mcr     INTEGER NOT NULL,
        balance_mcr   INTEGER NOT NULL,
        kind          TEXT NOT NULL,   -- topup | voucher | admin | usage | refund | bonus
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
        provider    TEXT NOT NULL,           -- stripe | transfer | paypal | admin
        amount_cent INTEGER NOT NULL,
        credits_mcr INTEGER NOT NULL,
        status      TEXT NOT NULL,           -- open | paid | cancelled
        reference   TEXT,
        external_id TEXT,
        created_at  INTEGER NOT NULL,
        paid_at     INTEGER
      );
      CREATE INDEX topups_user ON topups(user_id, created_at DESC);

      -- Ein Minecraft-Konto. 'name' ist der Dateiname im Client-Verzeichnis des Nutzers und damit
      -- das, was als --account übergeben wird.
      CREATE TABLE mc_accounts (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,          -- Kontoname im Client (= Minecraft-Name)
        kind          TEXT NOT NULL DEFAULT 'microsoft',  -- microsoft | offline
        uuid          TEXT,
        status        TEXT NOT NULL DEFAULT 'ok',         -- ok | pending | error
        last_error    TEXT,
        connections   INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        UNIQUE(user_id, name)
      );

      -- Serverprofil: ein Server samt aller Einstellungen, die der Client beim Start bekommt.
      CREATE TABLE profiles (
        id              INTEGER PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        slug            TEXT NOT NULL,
        host            TEXT NOT NULL,
        port            INTEGER NOT NULL DEFAULT 0,       -- 0 = SRV-Eintrag fragen
        mc_version      TEXT NOT NULL DEFAULT '26.1',
        runtime         TEXT NOT NULL DEFAULT 'rust',     -- rust | java
        join_delay      INTEGER NOT NULL DEFAULT 4,
        reconnect_delay INTEGER NOT NULL DEFAULT 5,
        max_backoff     INTEGER NOT NULL DEFAULT 60,
        chat_delay      INTEGER NOT NULL DEFAULT 1000,
        auto_reconnect  INTEGER NOT NULL DEFAULT 1,
        movement        INTEGER NOT NULL DEFAULT 0,       -- Bewegungs-Bauform verwenden
        anti_afk        TEXT NOT NULL DEFAULT '{}',       -- JSON
        color           TEXT NOT NULL DEFAULT 'neutral',
        ordinal         INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL,
        UNIQUE(user_id, slug)
      );

      -- Welches Konto gehört zu welchem Profil (mit Notiz und gewünschtem Zustand).
      CREATE TABLE profile_accounts (
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES mc_accounts(id) ON DELETE CASCADE,
        note       TEXT,
        proxy_id   INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
        wanted     INTEGER NOT NULL DEFAULT 0,   -- 1 = soll laufen (überlebt Neustarts)
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

      -- Wiederholte Nachrichten/Befehle ("Spam") – vom Panel getaktet, damit sie ohne Neustart
      -- des Bots geändert werden können.
      CREATE TABLE spam (
        id           INTEGER PRIMARY KEY,
        profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        message      TEXT NOT NULL,
        interval_sec INTEGER NOT NULL DEFAULT 300,
        accounts     TEXT NOT NULL DEFAULT '[]',   -- JSON: Konto-IDs, leer = alle
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   INTEGER NOT NULL
      );

      -- Macro: ein Auslöser und eine Kette von Schritten.
      CREATE TABLE macros (
        id         INTEGER PRIMARY KEY,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        event      TEXT NOT NULL DEFAULT 'join',   -- join | timer | chat | death | disconnect
        config     TEXT NOT NULL DEFAULT '{}',     -- JSON je Auslöser
        actions    TEXT NOT NULL DEFAULT '[]',     -- JSON: Schrittliste
        accounts   TEXT NOT NULL DEFAULT '[]',     -- JSON: Konto-IDs, leer = alle
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      -- Gewünschter Zustand + Statistik je Bot (Profil × Konto).
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
];

db.exec(`CREATE TABLE IF NOT EXISTS migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
)`);

const applied = new Set(db.prepare('SELECT name FROM migrations').all().map((row) => row.name));
for (const migration of migrations) {
  if (applied.has(migration.name)) continue;
  db.transaction(() => {
    db.exec(migration.sql);
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
      migration.name,
      Date.now()
    );
  })();
}

// ---------------------------------------------------------------- Einstellungen

const defaults = {
  // Was ein laufender Bot kostet: 7 mcr je Stunde ≈ 5,11 Credits im Monat.
  rate_mcr_hour: 7,
  // Ein Credit kostet 100 Cent. Damit ist der Monatspreis eines Bots ≈ 5,11 €.
  credit_cent: 100,
  // Startguthaben bei der Registrierung (200 mcr ≈ 28 Stunden zum Ausprobieren).
  signup_bonus_mcr: 200,
  // Ab hier warnt das Panel (und schickt eine Discord-Nachricht, wenn hinterlegt).
  low_balance_mcr: 500,
  // Aufladepakete: Betrag in Cent -> Credits (mit Bonus bei größeren Paketen).
  packages: [
    { cent: 500, credits_mcr: 5000, label: '5 €' },
    { cent: 1000, credits_mcr: 10500, label: '10 €' },
    { cent: 2500, credits_mcr: 27000, label: '25 €' },
    { cent: 5000, credits_mcr: 55000, label: '50 €' },
  ],
  // Ohne Guthaben laufen Bots noch so viele Minuten weiter, bevor sie gestoppt werden.
  grace_minutes: 5,
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

export function audit(userId, action, detail) {
  db.prepare('INSERT INTO audit (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)').run(
    userId ?? null,
    action,
    detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null,
    Date.now()
  );
}
