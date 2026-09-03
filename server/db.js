// SQLite als einzige Datenablage. Ein Schema, das beim Start angelegt wird; Änderungen kommen als
// weitere `migrations`-Einträge dazu, damit ein Update nie von Hand nachgezogen werden muss.
//
// Geldeinheit ist **ein Credit = ein Cent**. 100 Credits = 1 Euro. Ganzzahlig, keine Bruchteile,
// keine Milli-Einheiten: Was im Panel steht, lässt sich ohne Umrechnen mit dem Kontoauszug
// vergleichen. Bezahlt wird nicht nach Stunden, sondern je Serverplatz und Monat – und ein Monat
// sind hier immer genau 30 Tage (siehe MONTH_MS in billing.js).

import fs from 'node:fs';
import Database from 'better-sqlite3';
import { paths, tighten } from './config.js';
import { PRIVACY_DE, PRIVACY_EN, TERMS_DE, TERMS_EN, VAT_NOTE_DE, VAT_NOTE_EN } from './legal.js';
import { referralCode } from './util.js';

export const db = new Database(paths.db);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * Die Datenbank geht nur den Dienst etwas an.
 *
 * Darin stehen Passwort-Hashes, Sitzungen, die Token der Standorte und das Geheimnis des Bots.
 * Das systemd-Unit setzt `UMask=0077`, aber das gilt nur für Dateien, die **dieser** Dienst neu
 * anlegt – eine von Hand kopierte Datenbank, ein Bestand aus einer älteren Fassung oder ein Umzug
 * mit `scp` bringt seine eigenen Rechte mit, und die sind gewöhnlich `0644`. Auf einer Maschine
 * mit einem zweiten Benutzer ist das der ganze Betrieb zum Mitlesen.
 *
 * **Nach** dem Öffnen und nach `journal_mode = WAL`: Erst dann liegen `-wal` und `-shm` da, und
 * die tragen dieselben Daten wie die Hauptdatei. Eine davon mitzunehmen und die anderen zu
 * vergessen wäre sinnlos.
 */
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(`${paths.db}${suffix}`)) tighten(`${paths.db}${suffix}`, 0o600);
}

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

  {
    // Die Tarifbeschreibungen der ersten Fassung lasen sich wie eine Merkmalsliste mit Gedanken-
    // strichen. Auf der Preisseite stehen die Merkmale ohnehin darunter – der Satz darüber soll
    // sagen, für wen der Tarif gedacht ist.
    //
    // Überschrieben wird nur, was noch wörtlich aus der Erstbefüllung stammt: wer seine Texte im
    // Admin-Bereich selbst geschrieben hat, behält sie.
    name: '004-tarif-texte',
    run() {
      const update = db.prepare('UPDATE plans SET blurb_de = ?, blurb_en = ? WHERE slug = ?');
      const alt = {
        free: [
          'Ein Server, dauerhaft kostenlos. Kein Zahlungsmittel nötig.',
          'One server, free forever. No payment details needed.',
        ],
        premium: [
          'Premium-Client: Bewegung, Anti-AFK, Scoreboard, Menüs, Proxys – je Server im Monat.',
          'Premium client: movement, anti-AFK, scoreboard, menus, proxies – per server, monthly.',
        ],
        ultra: [
          'Für ganze Netzwerke: 25 Bots je Server, längster Chatverlauf, Support mit Vorrang.',
          'For whole networks: 25 bots per server, longest chat history, priority support.',
        ],
      };
      for (const [slug, [de, en]] of Object.entries(alt)) {
        const row = db.prepare('SELECT blurb_de, blurb_en FROM plans WHERE slug = ?').get(slug);
        if (!row) continue;
        // **Beide** Fassungen müssen noch die alten sein. Mit `&&` genügte eine – wer nur den
        // deutschen Satz umgeschrieben hatte, bekam ihn hier überschrieben, weil der englische
        // noch im Original stand. Eine Migration darf keine Handarbeit des Betreibers löschen.
        if (row.blurb_de !== de || row.blurb_en !== en) continue;
        const next = PLAN_TEXTS[slug];
        update.run(next.blurb_de, next.blurb_en, slug);
      }
    },
  },

  {
    // Der große Ausbau: Zusätze zum Dazukaufen, Standorte, Tickets mit mehreren Beteiligten und
    // Anbindung an Discord, Post an Kunden mit eigenen Einstellungen, Google-Verknüpfung.
    name: '005-zusaetze-standorte-post',
    sql: `
      -- ---------------------------------------------------------------- Tarife
      -- Anzeigetafel und Menüs hingen bisher am Premium-Client. Jetzt entscheidet der Tarif, was
      -- davon freigeschaltet ist – sonst gäbe es zwischen Premium und Ultra keinen Unterschied
      -- außer der Anzahl Bots, und für Zusätze zum Dazukaufen bliebe nichts übrig.
      ALTER TABLE plans ADD COLUMN board      INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE plans ADD COLUMN menus      INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE plans ADD COLUMN pov        INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE plans ADD COLUMN max_macros INTEGER NOT NULL DEFAULT 20;
      ALTER TABLE plans ADD COLUMN addons     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE plans ADD COLUMN highlight  INTEGER NOT NULL DEFAULT 0;
      -- Welche Discord-Rolle jemand bekommt, der diesen Tarif fährt. Leer = die Rolle aus den
      -- Einstellungen (discord_role_premium / _ultra), damit der einfache Fall ohne Tippen geht.
      ALTER TABLE plans ADD COLUMN discord_role TEXT;

      UPDATE plans SET board = premium, menus = premium;
      UPDATE plans SET addons = 1, max_macros = 40 WHERE free_slot = 0;
      UPDATE plans SET max_macros = 5 WHERE free_slot = 1;

      -- Zusätze: was ein bezahlter Serverplatz dazubuchen kann. Preis je 30 Tage, wie der Tarif.
      CREATE TABLE addons (
        id            INTEGER PRIMARY KEY,
        key           TEXT NOT NULL UNIQUE,
        name_de       TEXT NOT NULL,
        name_en       TEXT NOT NULL,
        text_de       TEXT NOT NULL DEFAULT '',
        text_en       TEXT NOT NULL DEFAULT '',
        price_credits INTEGER NOT NULL DEFAULT 0,
        kind          TEXT NOT NULL DEFAULT 'flag',   -- flag = Merkmal an, slot = mehr Bots
        flag          TEXT,                           -- welches Tarifmerkmal (bei kind = flag)
        amount        INTEGER NOT NULL DEFAULT 1,     -- wie viel je Stück (bei kind = slot)
        max_qty       INTEGER NOT NULL DEFAULT 1,
        need_cap      TEXT,                           -- ohne diese Client-Fähigkeit gibt es das nicht
        available     INTEGER NOT NULL DEFAULT 1,     -- 0 = angekündigt, aber noch nicht kaufbar
        active        INTEGER NOT NULL DEFAULT 1,
        sort          INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE profile_addons (
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        addon_id   INTEGER NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
        qty        INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, addon_id)
      );

      -- ---------------------------------------------------------------- Standorte
      -- Ein Standort ist eine Maschine oder eine Adresse, über die Bots hinausgehen. Der eine,
      -- der immer da ist, heißt "local": das ist dieser Server. Jeder weitere bekommt eine
      -- Ausgangsadresse (Proxy) und darf auf bestimmte Nutzer beschränkt werden.
      CREATE TABLE nodes (
        id           INTEGER PRIMARY KEY,
        name         TEXT NOT NULL,
        kind         TEXT NOT NULL DEFAULT 'egress',  -- local | egress
        region       TEXT NOT NULL DEFAULT '',
        proxy_id     INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
        max_bots     INTEGER NOT NULL DEFAULT 0,      -- 0 = keine Grenze
        max_profiles INTEGER NOT NULL DEFAULT 0,
        access       TEXT NOT NULL DEFAULT 'all',     -- all | listed | admin
        note         TEXT,
        active       INTEGER NOT NULL DEFAULT 1,
        sort         INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );

      CREATE TABLE node_users (
        node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (node_id, user_id)
      );

      ALTER TABLE profiles ADD COLUMN node_id     INTEGER REFERENCES nodes(id) ON DELETE SET NULL;
      ALTER TABLE profiles ADD COLUMN locked      INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE profiles ADD COLUMN lock_reason TEXT;
      ALTER TABLE proxies  ADD COLUMN node_id     INTEGER REFERENCES nodes(id) ON DELETE SET NULL;

      -- ---------------------------------------------------------------- Tickets
      ALTER TABLE tickets ADD COLUMN source             TEXT NOT NULL DEFAULT 'panel'; -- panel | discord | staff
      ALTER TABLE tickets ADD COLUMN discord_channel_id TEXT;
      ALTER TABLE tickets ADD COLUMN reopened           INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE ticket_messages ADD COLUMN discord_id  TEXT;
      ALTER TABLE ticket_messages ADD COLUMN author_name TEXT;
      CREATE INDEX tickets_discord ON tickets(discord_channel_id) WHERE discord_channel_id IS NOT NULL;

      -- Weitere Beteiligte an einem Ticket. Der Ersteller steht weiter in tickets.user_id.
      CREATE TABLE ticket_users (
        ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (ticket_id, user_id)
      );

      -- ---------------------------------------------------------------- Post
      -- Wem eine Nachricht galt, damit sie der Empfänger selbst nachlesen kann: wer wissen will,
      -- ob eine Mail mit seinem Namen echt war, soll das ohne Rückfrage prüfen können.
      ALTER TABLE mails ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE mails ADD COLUMN body    TEXT;

      -- Welche Nachrichten jemand bekommen will. Leer heißt: alle (siehe mail.js).
      ALTER TABLE users ADD COLUMN mail_prefs   TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE users ADD COLUMN google_id    TEXT;
      ALTER TABLE users ADD COLUMN google_email TEXT;
      CREATE UNIQUE INDEX users_google ON users(google_id) WHERE google_id IS NOT NULL;

      -- ---------------------------------------------------------------- Ankündigungen
      ALTER TABLE announcements ADD COLUMN mailed_at INTEGER;
      ALTER TABLE announcements ADD COLUMN link      TEXT;
      -- Mehr als eine darf sichtbar sein; bisher schaltete jede neue alle anderen ab.

      -- ---------------------------------------------------------------- Protokoll
      ALTER TABLE audit ADD COLUMN ip TEXT;
    `,
    run() {
      // Der Standort "dieser Server" muss es geben – an ihm hängt alles, was schon läuft.
      const info = db
        .prepare(
          `INSERT INTO nodes (name, kind, region, access, note, sort, created_at)
           VALUES ('Haupt-Standort', 'local', '', 'all', 'Dieser Server. Bots laufen hier.', 0, ?)`
        )
        .run(Date.now());
      db.prepare('UPDATE profiles SET node_id = ? WHERE node_id IS NULL').run(info.lastInsertRowid);

      // Ultra bekommt, was Premium jetzt nicht mehr von Haus aus hat – das ist der Unterschied,
      // für den er das Doppelte kostet. Auf Premium sind beide als Zusatz kaufbar.
      db.prepare("UPDATE plans SET board = 0, menus = 0 WHERE slug = 'premium'").run();
      db.prepare("UPDATE plans SET board = 1, menus = 1, highlight = 1 WHERE slug = 'ultra'").run();

      const addon = db.prepare(
        `INSERT INTO addons (key, name_de, name_en, text_de, text_en, price_credits, kind, flag,
                             amount, max_qty, need_cap, available, sort)
         VALUES (@key, @name_de, @name_en, @text_de, @text_en, @price_credits, @kind, @flag,
                 @amount, @max_qty, @need_cap, @available, @sort)`
      );
      for (const entry of ADDON_SEED) addon.run(entry);
    },
  },
  {
    name: '006-tarif-merkmale-frei-schreibbar',
    sql: `
      -- ---------------------------------------------------------------- Tarife
      -- Bisher baute die Preisseite die Merkmalsliste eines Tarifs selbst zusammen: "5 Bots",
      -- "Premium-Client", "2000 Zeilen Chatverlauf". Was dort steht, ließ sich nur durch Ändern
      -- von Zahlen beeinflussen – ein eigener Satz war nicht möglich. Diese beiden Felder sind
      -- die Liste im Wortlaut, eine Zeile je Punkt. Leer heißt weiterhin: zusammengebaut.
      ALTER TABLE plans ADD COLUMN features_de TEXT NOT NULL DEFAULT '';
      ALTER TABLE plans ADD COLUMN features_en TEXT NOT NULL DEFAULT '';
    `,
    run() {
      // Die Anzeigetafel gehört ab jetzt zu jedem bezahlten Tarif. Sie war ein Zusatz für 59
      // Credits – für etwas, das nur anzeigt, was der Server ohnehin an den Bot schickt, ist das
      // eine Schranke ohne Gegenwert. Menüs bleiben der Zusatz, der Premium von Ultra trennt.
      db.prepare('UPDATE plans SET board = 1 WHERE free_slot = 0').run();
      db.prepare("UPDATE addons SET active = 0, available = 0 WHERE key = 'board'").run();
      // Wer die Anzeigetafel gekauft hat, hat sie jetzt im Tarif – die Buchung kann weg.
      db.prepare(
        "DELETE FROM profile_addons WHERE addon_id IN (SELECT id FROM addons WHERE key = 'board')"
      ).run();

      // Die Live-Ansicht wird je Konto und Serverplatz bezahlt und steckt in keinem Tarif –
      // auch nicht in Ultra. Sie ist angekündigt, mehr nicht.
      db.prepare('UPDATE plans SET pov = 0').run();
      db.prepare("UPDATE addons SET available = 0, active = 1 WHERE key = 'pov'").run();
    },
  },
  {
    // Discord ist beim Gratis-Tarif keine bloße Zusatzverknüpfung: Der Platz läuft nur, solange
    // das verknüpfte Konto Mitglied des AFKSystems-Servers ist. Außerdem braucht der Admin-Bereich
    // eigene Kennzeichen für die regulär synchronisierten Partner-/VIP-Rollen und für Discord-
    // Moderatoren. Minecraft-Konten lassen sich nun einzeln stilllegen, ohne sie zu löschen.
    name: '007-discord-rollen-sperren-und-premium-merkmale',
    sql: `
      ALTER TABLE users ADD COLUMN discord_moderator    INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN discord_partner      INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN discord_vip          INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN discord_guild_member INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN discord_guild_checked_at INTEGER;

      ALTER TABLE mc_accounts ADD COLUMN suspended     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE mc_accounts ADD COLUMN suspend_reason TEXT;
    `,
    run() {
      const premiumDe = [
        '5 Bots gleichzeitig auf diesem Server',
        'Bewegung, Anti-AFK, Schleichen',
        '50000 Zeilen Chatverlauf',
        'Scoreboard wie im Spiel',
        'Eigene Ausgangsadresse auf Anfrage',
        'Support mit Vorrang',
      ].join('\n');
      const premiumEn = [
        '5 bots at once on this server',
        'Movement, anti-AFK, sneaking',
        '50,000 lines of chat history',
        'Scoreboard as in the game',
        'Dedicated outgoing address on request',
        'Priority support',
      ].join('\n');
      db.prepare(
        `UPDATE plans SET
           features_de = CASE WHEN trim(features_de) = '' THEN ? ELSE features_de END,
           features_en = CASE WHEN trim(features_en) = '' THEN ? ELSE features_en END,
           chat_limit = 50000
         WHERE slug = 'premium'`
      ).run(premiumDe, premiumEn);
      // Bestehende Premium-Plätze standen höchstens auf dem alten Tariflimit von 2000 Zeilen.
      // Eigene höhere Werte bleiben unangetastet.
      db.prepare(
        `UPDATE profiles SET chat_limit = 50000
          WHERE chat_limit <= 2000 AND plan_id IN (SELECT id FROM plans WHERE slug = 'premium')`
      ).run();

      // Ultra darf beim Chatverlauf nicht hinter Premium zurückfallen. Der bisherige Standard
      // waren 10.000 Zeilen; benutzerdefinierte höhere Werte bleiben erhalten.
      db.prepare(
        "UPDATE plans SET chat_limit = 50000 WHERE slug = 'ultra' AND chat_limit < 50000"
      ).run();
      db.prepare(
        `UPDATE profiles SET chat_limit = 50000
          WHERE chat_limit <= 10000 AND plan_id IN (SELECT id FROM plans WHERE slug = 'ultra')`
      ).run();

      db.prepare(
        `UPDATE plans SET
           blurb_de = 'Ein Server ohne Kosten, solange dein verknüpftes Discord-Konto Mitglied bei AFKSystems ist.',
           blurb_en = 'One server at no cost while your linked Discord account is a member of AFKSystems.'
         WHERE slug = 'free'`
      ).run();
    },
  },
  {
    // Vor der klaren Trennung der beiden Ticketansichten wurde eine Antwort eines Admins auf
    // sein eigenes Ticket als Teamantwort gespeichert. Die Historie muss derselben Regel folgen
    // wie neue Tickets, sonst bleiben alte Gespräche und ihre Warteschlangen-Zustände falsch.
    name: '008-admin-eigene-tickets-als-kundenverlauf',
    run() {
      db.prepare(
        `UPDATE ticket_messages
            SET role = 'user'
          WHERE role = 'staff' AND internal = 0
            AND EXISTS (
              SELECT 1 FROM tickets t
                JOIN users owner ON owner.id = t.user_id
               WHERE t.id = ticket_messages.ticket_id
                 AND t.user_id = ticket_messages.user_id
                 AND owner.role = 'admin'
            )`
      ).run();

      // Nur den eindeutig falschen Fall reparieren: Das letzte öffentliche Wort kam vom
      // Ticketinhaber, stand aber wegen der früheren Einordnung auf „beantwortet“.
      db.prepare(
        `UPDATE tickets AS t
            SET status = 'open', unread_staff = 1, unread_user = 0, closed_at = NULL
          WHERE t.status = 'answered' AND t.unread_user = 1
            AND EXISTS (
              SELECT 1 FROM ticket_messages m
               WHERE m.ticket_id = t.id
                 AND m.id = (
                   SELECT MAX(last.id) FROM ticket_messages last
                    WHERE last.ticket_id = t.id
                      AND last.internal = 0
                      AND last.role != 'system'
                 )
                 AND m.role = 'user'
                 AND m.user_id = t.user_id
            )
            AND EXISTS (
              SELECT 1 FROM users owner WHERE owner.id = t.user_id AND owner.role = 'admin'
            )`
      ).run();
    },
  },
  {
    // Standorte sind ab hier **Maschinen**, nicht mehr bloß Ausgangsadressen: auf einem Standort
    // laufen Bot-Prozesse, und darum gehören CPU, Arbeitsspeicher und Platte dazu. Ein Proxy
    // bleibt, was er war – eine Adresse ohne eigene Rechenleistung.
    //
    // Ein entfernter Standort meldet sich mit einem Token beim Panel (er baut die Verbindung auf,
    // nicht umgekehrt). Deshalb braucht er weder eine öffentliche Adresse noch ein Zertifikat
    // noch eine offene Portfreigabe – das ist der Unterschied zwischen "in fünf Minuten fertig"
    // und "ein Nachmittag mit nginx".
    name: '009-standorte-als-maschinen-und-live-ansicht',
    sql: `
      ALTER TABLE nodes ADD COLUMN token           TEXT;
      ALTER TABLE nodes ADD COLUMN agent_version   TEXT;
      ALTER TABLE nodes ADD COLUMN last_seen       INTEGER;
      ALTER TABLE nodes ADD COLUMN max_cpu_percent INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE nodes ADD COLUMN max_mem_percent INTEGER NOT NULL DEFAULT 0;
      -- Der zuletzt gemeldete Zustand. Nach einem Neustart des Panels steht damit sofort etwas da,
      -- statt einer leeren Tabelle bis zur nächsten Meldung.
      ALTER TABLE nodes ADD COLUMN stats           TEXT;
      CREATE UNIQUE INDEX nodes_token ON nodes(token) WHERE token IS NOT NULL;
    `,
    run() {
      // Die Live-Ansicht gibt es jetzt wirklich: das Panel zeichnet die Bilder des Clients.
      db.prepare(
        `UPDATE addons SET available = 1, active = 1, max_qty = 1,
           text_de = 'Sehen, was der Bot sieht – der Client rechnet das Bild aus den geladenen Weltdaten und das Panel zeichnet es. Je Serverplatz buchbar, in keinem Tarif enthalten.',
           text_en = 'See what the bot sees – the client works the picture out from loaded world data and the panel draws it. Booked per server slot, part of no plan.'
         WHERE key = 'pov'`
      ).run();
      // Mehrfachbuchungen aus der Zeit, als der Zusatz je Konto gedacht war, auf eins zusammen-
      // ziehen: freigeschaltet ist er ohnehin für den ganzen Serverplatz.
      db.prepare(
        "UPDATE profile_addons SET qty = 1 WHERE addon_id IN (SELECT id FROM addons WHERE key = 'pov')"
      ).run();

      // Der Haupt-Standort ist diese Maschine – er hat immer Ressourcen und braucht kein Token.
      db.prepare("UPDATE nodes SET kind = 'local' WHERE kind = 'local'").run();
    },
  },
  {
    name: '010-ticket-anhaenge-und-freier-inhalt',
    sql: `
      -- Anhänge eines Tickets. Die Datei selbst liegt unter data/tickets/<ticket>/<id>-<name>;
      -- hier steht, wem sie gehört, wie sie heißt und woher sie kam. Eine Datei ohne Nachricht
      -- gibt es nicht: sie hängt immer an dem Beitrag, mit dem sie geschickt wurde.
      -- ticket_id und message_id sind offen, solange die Datei nur hochgeladen ist: Wer ein neues
      -- Ticket schreibt, hängt seinen Screenshot an, bevor es das Ticket gibt. Erst das Abschicken
      -- verbindet beides. Was nach einem Tag noch offen ist, war ein abgebrochener Entwurf.
      CREATE TABLE ticket_files (
        id         INTEGER PRIMARY KEY,
        ticket_id  INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        message_id INTEGER REFERENCES ticket_messages(id) ON DELETE CASCADE,
        user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        name       TEXT NOT NULL,
        mime       TEXT NOT NULL DEFAULT 'application/octet-stream',
        size       INTEGER NOT NULL DEFAULT 0,
        path       TEXT NOT NULL,
        source     TEXT NOT NULL DEFAULT 'panel',   -- panel | discord
        internal   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX ticket_files_open ON ticket_files(user_id, created_at) WHERE ticket_id IS NULL;
      CREATE INDEX ticket_files_ticket ON ticket_files(ticket_id, id);
      CREATE INDEX ticket_files_message ON ticket_files(message_id);
    `,
    run() {
      const put = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
      );
      // Markieren und Rechtsklick gehören ab hier zur normalen Seite. Der Inhaltsschutz auf der
      // Serverseite (CSS/JS nicht einzeln abrufbar) bleibt davon unberührt – das ist jetzt ein
      // zweiter, eigener Schalter, damit man das eine haben kann, ohne das andere zu ertragen.
      put.run('content_lock_ui', JSON.stringify(0));
      // Kategorien, in denen der Bot keine Kanalrechte anfassen darf.
      put.run('discord_skip_categories', JSON.stringify(DEFAULT_SKIP_CATEGORIES));
    },
  },
  {
    // Zwei Löcher im Guthaben, beide an derselben Stelle: Es fehlte die Erinnerung daran, was
    // wirklich bezahlt wurde.
    //
    //   * **Zusätze.** Beim Abbestellen wurde der *heutige* Listenpreis anteilig gutgeschrieben.
    //     Ein Zusatz, den die Verwaltung von Hand auf einen Platz gelegt hat (ohne Abbuchung),
    //     ließ sich damit gegen echte Credits eintauschen – Geld aus dem Nichts. `paid_credits`
    //     hält fest, was für die gebuchte Menge tatsächlich abgebucht wurde; mehr kommt nie zurück.
    //   * **Gutscheine.** `uses_left` zählt Einlösungen, nicht Personen. Ein Gutschein mit hundert
    //     Einlösungen war deshalb kein Gutschein für hundert Leute, sondern ein Knopf, den ein
    //     einziges Konto hundertmal drücken konnte. Wer wann eingelöst hat, steht ab hier hier.
    name: '011-bezahltes-merken',
    sql: `
      ALTER TABLE profile_addons ADD COLUMN paid_credits INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE voucher_redemptions (
        code       TEXT NOT NULL,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credits    INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (code, user_id)
      );
      CREATE INDEX voucher_redemptions_user ON voucher_redemptions(user_id, created_at DESC);
    `,
    run() {
      // Was schon gebucht ist, gilt als zum heutigen Listenpreis bezahlt: Das ist der Betrag, den
      // die bisherige Rechnung zurückgegeben hätte, also ändert sich für niemanden etwas rückwirkend.
      db.prepare(
        `UPDATE profile_addons SET paid_credits =
           COALESCE((SELECT a.price_credits * profile_addons.qty FROM addons a
                      WHERE a.id = profile_addons.addon_id), 0)`
      ).run();
      // Bereits eingelöste Gutscheine lassen sich nicht mehr einer Person zuordnen – dafür gab es
      // die Tabelle noch nicht. Die Sperre gilt ab jetzt, rückwirkend wird nichts behauptet.
    },
  },
  {
    // Dieselbe Lücke wie bei den Zusätzen, nur eine Ebene höher: **auch die Laufzeit eines
    // Serverplatzes ließ sich in echtes Guthaben verwandeln, ohne dass je etwas bezahlt wurde.**
    //
    // Die Verwaltung darf einen Platz verlängern (`PATCH /admin/profiles/:id` mit `extend_days`)
    // und ihm einen Tarif setzen – beides ausdrücklich **ohne Abbuchung**, das ist der Sinn eines
    // Geschenks. `refundValue()` rechnete danach aber "Monatspreis × Restzeit" und schrieb das
    // beim Löschen oder beim Tarifwechsel gut. Wer einen geschenkten Ultra-Platz sofort löschte,
    // hatte einen Monatspreis in Credits auf dem Konto – und mit Credits lässt sich alles andere
    // bezahlen.
    //
    // `profiles.paid_credits` merkt sich, was für die **laufende** Periode wirklich abgebucht
    // wurde. Mehr als das kann nicht zurückkommen; genau die Regel, die `profile_addons` seit
    // Migration 011 hat.
    name: '012-bezahlte-laufzeit-merken',
    sql: `ALTER TABLE profiles ADD COLUMN paid_credits INTEGER NOT NULL DEFAULT 0;

      -- Welche Discord-Benachrichtigungen ein Kunde bekommen will (Komma-Liste, siehe
      -- notify.js EVENTS). **Leer heißt alles**: Wer einen Webhook einträgt, will Bescheid
      -- wissen, und eine Voreinstellung, die nichts schickt, sähe aus wie ein kaputter Webhook.
      ALTER TABLE users ADD COLUMN discord_events TEXT NOT NULL DEFAULT '';`,
    run() {
      // Bestandsdaten: Ein Platz mit Laufzeit hat sie bisher immer über `setPlan`/`renewDue`
      // bekommen, und dort wurde der volle Monatspreis abgebucht. Für alle bestehenden Plätze gilt
      // deshalb genau der Betrag, den die alte Rechnung zurückgegeben hätte – rückwirkend ändert
      // sich für niemanden etwas.
      db.prepare(
        `UPDATE profiles SET paid_credits =
           COALESCE((SELECT pl.price_credits FROM plans pl WHERE pl.id = profiles.plan_id AND pl.free_slot = 0), 0)
          WHERE paid_until IS NOT NULL`
      ).run();
    },
  },
  {
    // **Von Tebex auf Stripe.**
    //
    // Der Unterschied ist nicht nur ein anderer Anbieter: Tebex war Verkäufer im eigenen Namen und
    // hat die Umsatzsteuer erledigt, Stripe ist bloß der Zahlungsdienstleister. Verkäufer ist ab
    // jetzt der Betreiber selbst – also gehören Preisangabe, Beleg und Umsatzsteuer ins Panel.
    // Deshalb kommen mit dem Anbieter auch die Einstellungen `vat_*` dazu (siehe vat.js).
    //
    // Die alten `tebex_*`-Zeilen werden gelöscht: Ein privater Schlüssel, der nichts mehr
    // aufschließt, gehört nicht in einer Datenbank aufbewahrt. **Bezahlte Aufladungen bleiben
    // unangetastet** – `topups.provider = 'tebex'` ist der wahre Vorgang von damals, und
    // Buchhaltung schreibt man nicht um.
    name: '013-stripe-statt-tebex',
    run() {
      for (const key of [
        'tebex_enabled',
        'tebex_mode',
        'tebex_project_id',
        'tebex_private_key',
        'tebex_store_token',
        'tebex_webhook_secret',
        'tebex_store_url',
      ]) {
        db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      }

      // Die Paket-ID aus dem Tebex-Webstore hat keine Entsprechung mehr: Bei Stripe kommen Name
      // und Preis aus diesem Panel. Der Rest der Pakete bleibt, wie er ist.
      const row = db.prepare("SELECT value FROM settings WHERE key = 'packages'").get();
      if (!row) return;
      try {
        const list = JSON.parse(row.value);
        if (!Array.isArray(list)) return;
        const cleaned = list.map(({ tebex, ...rest }) => rest);
        db.prepare("UPDATE settings SET value = ? WHERE key = 'packages'").run(JSON.stringify(cleaned));
      } catch {
        // Kaputtes JSON: lieber weg damit, dann greifen die Vorgabewerte.
        db.prepare("DELETE FROM settings WHERE key = 'packages'").run();
      }
    },
  },
  {
    // Ein Ticket hatte vier Zustände, von denen zwei dasselbe bedeuteten: `waiting` hieß im Panel
    // „Wartet auf dich“ und war damit `answered` unter anderem Namen. Gesetzt hat ihn nie ein
    // Vorgang, nur ein Mensch von Hand – dafür stand an beantworteten und geschlossenen Tickets
    // weiter „Wartet“, weil der Ungelesen-Punkt des Teams beim Umstellen des Zustands nie
    // gelöscht wurde. Beides wird hier begradigt (siehe tickets.js).
    name: '014-ticket-zustaende-eindeutig',
    run() {
      db.prepare("UPDATE tickets SET status = 'answered' WHERE status = 'waiting'").run();
      // Was beantwortet oder geschlossen ist, liegt nicht mehr beim Team.
      db.prepare(
        "UPDATE tickets SET unread_staff = 0 WHERE unread_staff = 1 AND status IN ('answered', 'closed')"
      ).run();
    },
  },

  {
    // Client 2.5.0: die Live-Ansicht bekommt echte Texturen, und die Sichtweite wird einstellbar.
    //
    // Beides hängt zusammen. Der Client meldet dem Server von jeher eine Sichtweite von 2 Chunks –
    // für einen Bot, der nur dastehen soll, ist das genau richtig und spart auf beiden Seiten
    // Arbeit. Für ein Bild ist es zu wenig: Was der Server nie geschickt hat, kann der Client
    // nicht zeichnen, und die Welt endet drei Schritte vor dem Bot. Ab hier lässt sich die Zahl
    // je Serverplatz hochstellen; 0 heißt weiterhin "was der Client für richtig hält".
    name: '015-texturierte-live-ansicht-und-sichtweite',
    sql: `
      ALTER TABLE profiles ADD COLUMN view_distance INTEGER NOT NULL DEFAULT 0;
    `,
    run() {
      // Der Beschreibungstext des Zusatzes stammt aus Migration 009 und beschreibt nur noch die
      // halbe Sache. Überschrieben wird er nur, wenn er **beide** Male noch der von damals ist –
      // wer ihn selbst umgeschrieben hat, behält seinen Text (dieselbe Regel wie in 004).
      const old = {
        de: 'Sehen, was der Bot sieht – der Client rechnet das Bild aus den geladenen Weltdaten und das Panel zeichnet es. Je Serverplatz buchbar, in keinem Tarif enthalten.',
        en: 'See what the bot sees – the client works the picture out from loaded world data and the panel draws it. Booked per server slot, part of no plan.',
      };
      const row = db.prepare("SELECT text_de, text_en FROM addons WHERE key = 'pov'").get();
      if (row && row.text_de === old.de && row.text_en === old.en) {
        db.prepare(
          `UPDATE addons SET
             text_de = 'Sehen, was der Bot sieht: das Bild aus den geladenen Weltdaten, mit den echten Texturen des Spiels, dazu Hotbar, Inventar und Menüs zum Anklicken. Je Serverplatz buchbar, in keinem Tarif enthalten.',
             text_en = 'See what the bot sees: the picture from loaded world data, with the real textures of the game, plus hotbar, inventory and clickable menus. Booked per server slot, part of no plan.'
           WHERE key = 'pov'`
        ).run();
      }
    },
  },

  {
    // Anmeldeversuche und Adresssperren. Beides gehört in die Datenbank und nicht in den
    // Speicher: Ein Angriff, der einen Neustart überdauert, soll auch im Protokoll überdauern.
    name: '016-anmeldeversuche-und-adresssperren',
    sql: `
      CREATE TABLE login_attempts (
        id         INTEGER PRIMARY KEY,
        ip         TEXT NOT NULL DEFAULT '',
        identifier TEXT NOT NULL DEFAULT '',   -- was eingetippt wurde: Mail oder Benutzername
        ok         INTEGER NOT NULL DEFAULT 0,
        reason     TEXT,                       -- wrong | blocked | throttled
        created_at INTEGER NOT NULL
      );
      CREATE INDEX login_attempts_time ON login_attempts(created_at DESC);
      CREATE INDEX login_attempts_ip ON login_attempts(ip, created_at DESC);
      CREATE INDEX login_attempts_who ON login_attempts(identifier, created_at DESC);

      CREATE TABLE ip_blocks (
        id         INTEGER PRIMARY KEY,
        value      TEXT NOT NULL UNIQUE,       -- 1.2.3.4 oder 1.2.3.0/24 oder 2001:db8::/32
        reason     TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER                     -- NULL = ohne Frist
      );
    `,
  },
  {
    // Das Postfach im Panel ist kein zweiter Discord-Webhook. Es ist die verlässliche Chronik
    // der Dinge, die das eigene Konto betreffen: Antworten vom Support, Gutschriften, auslaufende
    // Plätze und Bots, die Hilfe brauchen. Bisher verschwanden diese Hinweise vollständig, wenn
    // kein Discord-Webhook eingerichtet war. Ab hier bleiben die letzten Ereignisse am Konto und
    // können auf jedem Gerät gelesen werden.
    name: '017-aktivitaetszentrale',
    sql: `
      CREATE TABLE user_notifications (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event      TEXT NOT NULL DEFAULT 'info', -- ticket | billing | bot | account | plan | info
        tone       TEXT NOT NULL DEFAULT 'info', -- info | ok | warn | bad
        title_de   TEXT NOT NULL,
        title_en   TEXT NOT NULL,
        body_de    TEXT NOT NULL DEFAULT '',
        body_en    TEXT NOT NULL DEFAULT '',
        href       TEXT,
        dedupe_key TEXT,
        created_at INTEGER NOT NULL,
        read_at    INTEGER
      );
      CREATE INDEX user_notifications_user
        ON user_notifications(user_id, created_at DESC);
      CREATE INDEX user_notifications_unread
        ON user_notifications(user_id, read_at) WHERE read_at IS NULL;
      CREATE INDEX user_notifications_dedupe
        ON user_notifications(user_id, dedupe_key, created_at DESC);
    `,
  },
  {
    // Textbausteine für Ticketantworten. Sie stehen in der Datenbank und nicht im Quelltext:
    // Was ein Team dreimal am Tag schreibt, hängt vom Betrieb ab und nicht von diesem Programm –
    // und wer den Wortlaut ändern will, soll dafür kein Deployment brauchen.
    name: '018-textbausteine-fuer-tickets',
    sql: `
      CREATE TABLE ticket_templates (
        id         INTEGER PRIMARY KEY,
        title_de   TEXT NOT NULL,
        title_en   TEXT NOT NULL,
        body_de    TEXT NOT NULL,
        body_en    TEXT NOT NULL,
        category   TEXT NOT NULL DEFAULT 'general',
        sort       INTEGER NOT NULL DEFAULT 0,
        uses       INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `,
    run() {
      // Ein paar zum Anfangen – die vier Antworten, die in jedem Support geschrieben werden.
      // Sie sind Beispiele und kein Gesetz: löschen, ändern, eigene dazu.
      const seed = [
        {
          title_de: 'Eingegangen',
          title_en: 'Received',
          body_de: 'Hallo {name},\n\ndanke für deine Nachricht – wir haben sie und sehen uns das an. Wir melden uns, sobald wir mehr wissen.',
          body_en: 'Hi {name},\n\nthanks for your message – we have it and are looking into it. We will get back to you as soon as we know more.',
          category: 'general',
          sort: 10,
        },
        {
          title_de: 'Mehr Angaben nötig',
          title_en: 'Need more detail',
          body_de: 'Hallo {name},\n\ndamit wir das nachstellen können: Um welchen Serverplatz und welches Konto geht es, und wann ist es zuletzt passiert? Ein Bild vom Chat hilft uns sehr.',
          body_en: 'Hi {name},\n\nso we can reproduce it: which server slot and which account is this about, and when did it last happen? A screenshot of the chat helps a lot.',
          category: 'general',
          sort: 20,
        },
        {
          title_de: 'Bot startet nicht',
          title_en: 'Bot does not start',
          body_de: 'Hallo {name},\n\nbitte prüf zuerst: Steht beim Konto ein Fehler, passt die Minecraft-Version des Serverplatzes zum Server, und lässt der Server Bots überhaupt zu? Wenn alles drei stimmt, schreib uns die Meldung, die im Zustand des Bots steht.',
          body_en: 'Hi {name},\n\nplease check these first: does the account show an error, does the server slot\'s Minecraft version match the server, and does that server allow bots at all? If all three are fine, send us the message shown in the bot state.',
          category: 'bug',
          sort: 30,
        },
        {
          title_de: 'Erledigt',
          title_en: 'Sorted',
          body_de: 'Hallo {name},\n\ndas sollte jetzt passen. Melde dich einfach wieder, wenn noch etwas offen ist – wir lassen das Ticket so lange offen.',
          body_en: 'Hi {name},\n\nthis should be sorted now. Just reply if anything is still open – we will leave the ticket open until then.',
          category: 'general',
          sort: 40,
        },
      ];
      const insert = db.prepare(
        `INSERT INTO ticket_templates (title_de, title_en, body_de, body_en, category, sort, created_at)
         VALUES (@title_de, @title_en, @body_de, @body_en, @category, @sort, @created_at)`
      );
      for (const row of seed) insert.run({ ...row, created_at: Date.now() });
    },
  },
  {
    // **Ein Konto war bisher eine E-Mail-Adresse und ein Benutzername.** Für einen Dienst, der
    // Geld einnimmt, ist das zu wenig: Auf einen Beleg gehört, an wen geleistet wurde, und wer
    // als Firma kauft, braucht seine Firmierung und seine Umsatzsteuer-Identifikationsnummer
    // darauf. Bis hierher stand davon nichts irgendwo – auch nicht änderbar.
    //
    // Alles in `users` und nicht in einer zweiten Tabelle: Es ist genau **eine** Adresse je Konto,
    // sie wird zusammen mit dem Konto gelesen und zusammen mit ihm gelöscht. Eine 1:1-Tabelle
    // dafür wäre ein Join, der nie etwas anderes zurückgibt als eine Zeile.
    //
    // Leer statt NULL: Diese Felder werden angezeigt, verglichen und aneinandergehängt. `NULL`
    // müsste an jeder dieser Stellen einzeln abgefangen werden, und "kein Straßenname" und
    // "leerer Straßenname" sind hier dasselbe.
    name: '019-persoenliche-daten-und-rechnungsadresse',
    sql: `
      ALTER TABLE users ADD COLUMN full_name     TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN company       TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN vat_id        TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN street        TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN street2       TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN postal_code   TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN city          TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN region        TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN country       TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN phone         TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN billing_email TEXT NOT NULL DEFAULT '';
      -- Die Zeitzone des Kontos. Sie entscheidet, wann ein Zeitplan zuschlägt (siehe 023) und
      -- was auf einem Beleg als Datum steht. Leer heißt: die des Servers.
      ALTER TABLE users ADD COLUMN timezone      TEXT NOT NULL DEFAULT '';

      -- Ein Benutzername ist im Panel eine Anzeige und in Discord ein Wiedererkennungsmerkmal.
      -- Änderbar soll er sein, aber nicht beliebig oft: Wer sich alle zwei Minuten umbenennt,
      -- macht jeden Verlauf unlesbar. Wann zuletzt, steht hier.
      ALTER TABLE users ADD COLUMN username_changed_at INTEGER;

      -- Eine neue E-Mail-Adresse gilt erst, wenn sie bestätigt wurde. Bis dahin steht sie hier
      -- und die alte bleibt in Kraft – sonst sperrt ein Tippfehler das eigene Konto aus.
      ALTER TABLE users ADD COLUMN pending_email       TEXT;
      ALTER TABLE users ADD COLUMN pending_email_token TEXT;
      ALTER TABLE users ADD COLUMN pending_email_at    INTEGER;
      CREATE UNIQUE INDEX users_pending_email_token
        ON users(pending_email_token) WHERE pending_email_token IS NOT NULL;
    `,
  },
  {
    // Discord schreibt Erwähnungen als Zahlen: `<@1538…>` ist eine Person, `<#1538…>` ein Kanal,
    // `<@&1538…>` eine Rolle. Im Discord-Client steht daran ein Name, im Panel stand eine
    // zwanzigstellige Zahl – und damit eine Nachricht, die niemand mehr lesen konnte.
    //
    // Auflösen kann das nur, wer den Discord-Server sieht: der Bot. Er schickt deshalb zu jeder
    // übernommenen Nachricht mit, **welche Zahl welchen Namen hatte**, und zwar zum Zeitpunkt der
    // Nachricht. Ein Kanal, der später umbenannt oder gelöscht wird, ändert damit den Verlauf
    // nicht – genauso wenig, wie ein umbenannter Kanal eine alte Nachricht in Discord ändert.
    name: '020-discord-erwaehnungen-am-beitrag',
    sql: `
      ALTER TABLE ticket_messages ADD COLUMN mentions TEXT;
    `,
  },
  {
    // Ein Beleg braucht eine Nummer, und diese Nummer darf sich nie wieder ändern. Ebenso wenig
    // wie das, was darauf steht: Wer im Januar an eine Firma geliefert hat und im März umzieht,
    // hat trotzdem im Januar an die alte Anschrift geliefert. Deshalb wird beim Verbuchen ein
    // **Abzug** der Rechnungsdaten festgehalten und nicht auf das Konto verwiesen.
    name: '021-belegnummern',
    sql: `
      ALTER TABLE topups ADD COLUMN receipt_no  TEXT;
      ALTER TABLE topups ADD COLUMN billed_to   TEXT;   -- JSON: Name, Firma, Anschrift, USt-IdNr.
      ALTER TABLE topups ADD COLUMN vat_note    TEXT;   -- der Satz, der damals galt
      CREATE UNIQUE INDEX topups_receipt ON topups(receipt_no) WHERE receipt_no IS NOT NULL;
    `,
  },
  {
    // Ein Konto muss sich auch wieder abschaffen lassen, ohne dafür ein Ticket schreiben zu
    // müssen. Sofort und unwiderruflich wäre allerdings die falsche Voreinstellung: Ein Klick im
    // Ärger, ein fremder Browser, ein Kind am Rechner – und Konten, Serverplätze und Guthaben
    // sind weg. Deshalb eine Frist: Der Wunsch steht an, die Bots gehen aus, und bis zum Stichtag
    // genügt ein Knopf, um alles zurückzuholen.
    name: '022-konto-loeschen-mit-frist',
    sql: `
      ALTER TABLE users ADD COLUMN delete_requested_at INTEGER;
      ALTER TABLE users ADD COLUMN delete_due_at       INTEGER;
      CREATE INDEX users_delete_due ON users(delete_due_at) WHERE delete_due_at IS NOT NULL;
    `,
  },
  {
    // Zeitpläne. Ein AFK-Bot soll oft nicht rund um die Uhr sitzen, sondern zu bestimmten Zeiten –
    // nachts, während der Arbeit, an Wochentagen. Das ließ sich bisher nur von Hand machen, also
    // gar nicht: Wer um 6 Uhr starten will, steht nicht um 6 Uhr auf, um auf einen Knopf zu drücken.
    //
    // Bewusst keine cron-Zeile: "Minute, Stunde, Tag, Monat, Wochentag" ist eine Sprache, die man
    // lernen muss. Hier steht eine Uhrzeit, eine Auswahl von Wochentagen und was passieren soll.
    // Die Zeitzone kommt vom Konto (019) – 6 Uhr heißt 6 Uhr dort, wo der Kunde wohnt, und nicht
    // dort, wo zufällig der Server steht.
    name: '023-zeitplaene',
    sql: `
      CREATE TABLE profile_schedules (
        id         INTEGER PRIMARY KEY,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        -- NULL = alle Konten dieses Serverplatzes. Sonst genau dieses eine.
        account_id INTEGER REFERENCES mc_accounts(id) ON DELETE CASCADE,
        action     TEXT NOT NULL DEFAULT 'start',   -- start | stop | restart
        minutes    INTEGER NOT NULL DEFAULT 0,      -- Minuten seit Mitternacht, Ortszeit des Kontos
        days       TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',  -- 0 = Sonntag, wie Date#getDay
        active     INTEGER NOT NULL DEFAULT 1,
        note       TEXT NOT NULL DEFAULT '',
        last_run_at INTEGER,
        last_result TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX profile_schedules_profile ON profile_schedules(profile_id);
      CREATE INDEX profile_schedules_active ON profile_schedules(active, minutes);
    `,
  },
  {
    // **Der Webhook des Teams meldete Tickets. Das war falsch herum.**
    //
    // Ein neues Ticket steht im Panel, in der Seitenleiste mit Zahl daneben, und – wenn der Bot
    // läuft – als eigener Kanal in Discord, in dem das Gespräch stattfindet. Eine vierte Meldung
    // desselben Vorgangs in einem fünften Kanal hat niemandem etwas gesagt, was er nicht schon
    // wusste; sie hat nur dafür gesorgt, dass der Kanal ungelesen bleibt.
    //
    // Was dort **fehlte**, ist das, was sonst nirgends steht: wie es der Maschine geht. Deshalb
    // heißt die Einstellung ab hier `discord_system_webhook`, und darin kommt der Zustand des
    // Systems an. Der alte Wert zieht um – wer einen Webhook eingetragen hat, soll ihn nicht
    // noch einmal eintragen müssen.
    name: '024-systemwebhook-statt-ticketmeldungen',
    run() {
      const old = db.prepare("SELECT value FROM settings WHERE key = 'discord_staff_webhook'").get();
      if (old) {
        db.prepare(
          `INSERT INTO settings (key, value) VALUES ('discord_system_webhook', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).run(old.value);
        db.prepare("DELETE FROM settings WHERE key = 'discord_staff_webhook'").run();
      }
    },
  },
  {
    // **Ein gelöschtes Konto nimmt seine Belege mit – und das darf es nicht.**
    //
    // `topups` und `ledger` hängen mit `ON DELETE CASCADE` am Konto. Für Serverplätze und Tickets
    // ist das genau richtig; für Zahlungen ist es falsch, und zwar aus zwei Gründen:
    //
    //   * **Der Betreiber muss sie aufheben.** Eine ausgestellte Rechnung ist ein Beleg über einen
    //     Umsatz; handels- und steuerrechtliche Aufbewahrungsfristen gelten für ihn und nicht für
    //     das Konto. Genau das steht auch in der Datenschutzerklärung (legal.js) – ein Programm,
    //     das etwas anderes tut, als dort steht, ist das schlimmere Problem.
    //   * **Die Belegnummer bliebe nicht eindeutig.** Sie ist fortlaufend je Jahr und wird gezählt;
    //     verschwinden Zeilen, zählt sie zurück und vergibt eine Nummer ein zweites Mal.
    //
    // Deshalb dieser Auszug: Beim Löschen eines Kontos wandern die **abgeschlossenen** Zahlungen
    // hierher – ohne Fremdschlüssel, damit nichts sie mitnimmt. Was darin steht, ist genau das,
    // was ohnehin auf dem Beleg gedruckt war und nicht mehr sein darf: Nummer, Betrag, Zahlart,
    // Zeitpunkt und der Abzug der Rechnungsdaten von damals.
    name: '025-belege-ueberleben-das-konto',
    sql: `
      CREATE TABLE receipt_archive (
        id          INTEGER PRIMARY KEY,
        receipt_no  TEXT NOT NULL UNIQUE,
        former_user INTEGER,          -- die Nummer des gelöschten Kontos, für die Zuordnung
        username    TEXT NOT NULL DEFAULT '',
        provider    TEXT NOT NULL DEFAULT '',
        amount_cent INTEGER NOT NULL DEFAULT 0,
        credits     INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'paid',
        billed_to   TEXT,             -- JSON, wie in topups
        vat_note    TEXT,
        created_at  INTEGER NOT NULL,
        paid_at     INTEGER,
        archived_at INTEGER NOT NULL
      );
    `,
  },
  {
    // **Zwei Zahlen, die ein Macro von einem Automaten unterscheiden.**
    //
    // Ein Macro auf „Chat enthält X“ feuerte bisher bei jedem Treffer. Auf einem Server, der die
    // Zeile im Sekundentakt schickt (Werbung, ein Plugin, das jeden Tick meldet), heißt das:
    // derselbe Befehl im Sekundentakt. Das ist für den Server nicht von Spam zu unterscheiden, und
    // der Bot fliegt dafür raus – ausgelöst von einer Einstellung, die ihn im Spiel halten sollte.
    //
    //   * `cooldown_sec` ist die Sperrzeit je Macro. 0 heißt "jedes Mal", wie bisher.
    //   * `chance` ist die Wahrscheinlichkeit in Prozent. 100 heißt "immer", wie bisher. Darunter
    //     wird aus einer Antwort, die auf die Millisekunde jedes Mal gleich kommt, eine, die
    //     aussieht, als säße jemand davor.
    //
    // Beide Vorgaben sind genau das bisherige Verhalten: Kein bestehendes Macro ändert sich.
    name: '026-macros-mit-sperrzeit-und-wahrscheinlichkeit',
    sql: `
      ALTER TABLE macros ADD COLUMN cooldown_sec INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE macros ADD COLUMN chance INTEGER NOT NULL DEFAULT 100;
    `,
  },
  {
    // **Der Anmeldecode und die Geräte, die ihn nicht mehr brauchen.**
    //
    // Bisher gab es an einer Anmeldung genau eine Frage: Stimmt das Passwort? Wer es kennt – aus
    // einem Leck bei einem anderen Dienst, von einem Zettel, aus einem Browser, der es gespeichert
    // hat – ist drin. Der Code per E-Mail macht daraus zwei Fragen, von denen die zweite nur
    // beantworten kann, wer auch an das Postfach kommt.
    //
    // Drei Spalten, drei Aufgaben:
    //
    //   * `users.login_code` ist der Wunsch des Kontoinhabers. **Vorgabe: an.** Wer den Code nicht
    //     will, schaltet ihn ab; die andere Richtung würde ihn niemand einschalten, der ihn nicht
    //     ohnehin schon vermisst. Ohne eingerichteten Postausgang bleibt er wirkungslos, statt
    //     jemanden auszusperren – siehe server/logincode.js.
    //   * `known_devices` sind die Browser, die schon einmal durch diese Prüfung gekommen sind.
    //     Der Schlüssel ist ein Zufallswert in einem eigenen, langlebigen Cookie und **nicht** die
    //     Kennung des Browsers: "Chrome auf Windows" haben Millionen, und ein Merkmal, das
    //     Millionen teilen, erkennt kein Gerät wieder.
    //   * `login_challenges` ist der Code selbst, während er gilt. Gespeichert wird er als
    //     scrypt-Hash wie ein Passwort: Wer die Datenbank liest (eine Sicherung, ein Export, ein
    //     Blick über die Schulter), findet sechs Ziffern sonst im Klartext, und die sind in diesem
    //     Moment der halbe Zugang zum Konto.
    name: '027-anmeldecode-und-bekannte-geraete',
    sql: `
      ALTER TABLE users ADD COLUMN login_code INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE known_devices (
        token      TEXT NOT NULL,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        agent      TEXT,
        ip         TEXT,
        created_at INTEGER NOT NULL,
        last_at    INTEGER NOT NULL,
        PRIMARY KEY (token, user_id)
      );
      CREATE INDEX idx_known_devices_user ON known_devices(user_id, last_at DESC);

      CREATE TABLE login_challenges (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash  TEXT NOT NULL,
        tries      INTEGER NOT NULL DEFAULT 0,
        sent_at    INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        ip         TEXT,
        agent      TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_login_challenges_user ON login_challenges(user_id);
    `,
  },
  {
    // **Ein Notizfeld je Serverplatz.**
    //
    // Wer sechs Serverplätze hat, hat sechs Namen und keine Erinnerung: Warum steht auf diesem die
    // Sichtweite auf 12? Wem gehört der Discord-Server, für den der hier läuft? Welcher Rang war
    // noch mal nötig, damit das Makro funktioniert? Das stand bisher nirgends – Serverplätze haben
    // Felder für alles, was ein Programm braucht, und keines für das, was ein Mensch braucht.
    //
    // Die Notiz gehört dem Kunden. Sie taucht in keiner Auswertung auf, sie wird nicht durchsucht,
    // und der Bot bekommt sie nie zu sehen.
    name: '028-notiz-je-serverplatz',
    sql: `ALTER TABLE profiles ADD COLUMN note TEXT NOT NULL DEFAULT '';`,
  },
  {
    // Der Anmeldename ist eine technische Kennung, nicht die Anrede eines Menschen. Der echte
    // Anzeigename existiert schon als `full_name`; hier kommt nur die Wahl hinzu, welches der
    // bereits freiwillig verknüpften Profilbilder im Panel benutzt wird. Google-Name und -Bild
    // wurden beim OAuth-Abruf bislang gelesen und danach weggeworfen – damit konnte die Auswahl
    // "Google" nie angeboten werden.
    name: '029-anzeigename-und-waehlbare-avatare',
    sql: `
      ALTER TABLE users ADD COLUMN google_name   TEXT;
      ALTER TABLE users ADD COLUMN google_avatar TEXT;
      ALTER TABLE users ADD COLUMN avatar_source TEXT NOT NULL DEFAULT 'auto';
    `,
  },
  {
    /**
     * „Wer ist Administrator?“ – ohne jedes Konto durchzusehen.
     *
     * Diese Frage steht in der Live-Verteilung **jedes** Ticket-Ereignisses, und dazu gehört auch
     * „schreibt gerade …“, das beim Tippen laufend gesendet wird. Sie war die einzige Abfrage im
     * laufenden Betrieb, die dafür die ganze Kontentabelle las: Alles andere im Panel sucht über
     * einen Schlüssel, dafür sorgen schon die `UNIQUE`-Bedingungen des Schemas, die SQLite als
     * Index anlegt.
     *
     * Ein Feld mit zwei Werten ist sonst ein schlechter Index. Hier nicht: Gefragt wird immer nach
     * dem **seltenen**, und weil in der Abfrage nur `id` und `role` vorkommen, beantwortet SQLite
     * sie vollständig aus dem Index, ohne eine einzige Kontozeile anzufassen.
     *
     * (Geprüft und **nicht** angelegt wurde `profiles(plan_id)` für den Minutentakt der
     * Gratis-Plätze: Er wird dadurch nur um ein Sechstel schneller, und auch das erst, wenn die
     * Datenbank Statistiken hat – die Zeit steckt nicht im Finden der Zeilen, sondern im Lesen.
     * Ein Index, der bei jedem Schreibvorgang mitgepflegt werden will, muss mehr einbringen.)
     */
    name: '030-wer-ist-administrator',
    sql: `CREATE INDEX users_role ON users(role);`,
  },
  {
    // CPU und Arbeitsspeicher entschieden bereits, wann eine Standort-Maschine keine weiteren
    // Serverplätze mehr annimmt. Die Platte wurde zwar gemessen und angezeigt, blieb bei dieser
    // Entscheidung aber wirkungslos. Damit "bis voll" für alle drei Ressourcen dasselbe heißt,
    // bekommt auch sie eine frei wählbare Grenze.
    name: '031-festplattengrenze-fuer-standorte',
    sql: `ALTER TABLE nodes ADD COLUMN max_disk_percent INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    // **Zwei-Faktor-Anmeldung mit einer Authenticator-App.**
    //
    // Der Anmeldecode aus Migration 027 fragt nach dem Postfach und sagt selbst, dass er kein
    // zweiter Faktor ist – er geht über denselben Kanal wie „Passwort vergessen“. Hier kommt der
    // Faktor dazu, der das nicht tut: ein Geheimnis in einer App auf einem Gerät des Kunden.
    //
    // `totp_secret` steht verschlüsselt da (AES-256-GCM, Schlüssel aus `config.secret`). Nicht
    // wegen des laufenden Betriebs, sondern wegen der Sicherungen: Die lassen sich im Panel
    // herunterladen, und eine Sicherung mit jedem Zwei-Faktor-Geheimnis im Klartext wäre ein
    // Generalschlüssel in einer Datei. Warum es nicht wie ein Passwort gehasht ist: Der Wert wird
    // im Klartext gebraucht, um den Code auszurechnen.
    //
    // `totp_pending_secret` ist die begonnene, noch nicht bestätigte Einrichtung. Sie steht
    // getrennt, damit zwischen „QR-Code abfotografiert“ und „erster Code eingegeben“ noch kein
    // Konto nach einem Code fragt, das keiner beantworten kann.
    //
    // `totp_last_counter` ist das zuletzt eingelöste Zeitfenster. Ein Code gilt dreißig Sekunden;
    // ohne diese Spalte wäre ein abgefangener Code in dieser Zeit ein zweiter Zugang.
    name: '032-zwei-faktor-anmeldung',
    sql: `
      ALTER TABLE users ADD COLUMN totp_secret TEXT;
      ALTER TABLE users ADD COLUMN totp_enabled_at INTEGER;
      ALTER TABLE users ADD COLUMN totp_last_counter INTEGER;
      ALTER TABLE users ADD COLUMN totp_pending_secret TEXT;
      ALTER TABLE users ADD COLUMN totp_pending_at INTEGER;

      CREATE TABLE recovery_codes (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash  TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        used_at    INTEGER,
        used_ip    TEXT
      );
      CREATE INDEX idx_recovery_codes_user ON recovery_codes(user_id, used_at);

      -- Die Wartemarke der Anmeldung trägt jetzt, wonach sie fragt: 'mail' oder 'totp'.
      -- Beim Anmeldecode steht in code_hash der scrypt-Hash der sechs Ziffern; bei der
      -- Zwei-Faktor-Anmeldung gibt es nichts zu speichern – die Antwort rechnet die App aus.
      ALTER TABLE login_challenges ADD COLUMN kind TEXT NOT NULL DEFAULT 'mail';
    `,
  },
  {
    // Mehr direkt nutzbare Schnellantworten für die häufigsten Supportfälle. Jede steht bewusst
    // vollständig in beiden Sprachen da: Beim Anklicken entscheidet die Sprache des Kunden, nicht
    // die Oberfläche des Administrators. Der Titel schützt bestehende, selbst angelegte Bausteine
    // davor, bei einem Update doppelt aufzutauchen.
    name: '033-mehr-zweisprachige-ticketantworten',
    run() {
      const seed = [
        {
          title_de: 'Standortstörung',
          title_en: 'Location outage',
          body_de: 'Hallo {name},\n\nder zuständige Standort ist gerade ausgefallen. Dein Bot wird automatisch auf einen Ersatzstandort verschoben. Du musst nichts tun; wir überwachen den Wechsel.',
          body_en: 'Hi {name},\n\nthe assigned location is currently down. Your bot is being moved to a replacement location automatically. You do not need to do anything; we are monitoring the switch.',
          category: 'incident',
          sort: 50,
        },
        {
          title_de: 'Minecraft-Konto neu verbinden',
          title_en: 'Reconnect Minecraft account',
          body_de: 'Hallo {name},\n\ndie gespeicherte Microsoft-Anmeldung ist abgelaufen. Öffne im Panel bitte Minecraft-Konten, wähle das betroffene Konto und verbinde es erneut. Danach kannst du den Bot wieder starten.',
          body_en: 'Hi {name},\n\nthe stored Microsoft sign-in has expired. In the panel, open Minecraft accounts, select the affected account and connect it again. You can then start the bot again.',
          category: 'account',
          sort: 60,
        },
        {
          title_de: 'Minecraft-Version prüfen',
          title_en: 'Check Minecraft version',
          body_de: 'Hallo {name},\n\nder Zielserver und dein Serverplatz verwenden unterschiedliche Minecraft-Versionen. Stell beim Serverplatz bitte dieselbe Version ein, die der Zielserver verlangt, und starte danach erneut.',
          body_en: 'Hi {name},\n\nthe target server and your server slot use different Minecraft versions. Set the server slot to the version required by the target server, then start it again.',
          category: 'configuration',
          sort: 70,
        },
        {
          title_de: 'Beleg und Zahlung',
          title_en: 'Receipt and payment',
          body_de: 'Hallo {name},\n\ndeine Belege findest du im Panel unter Guthaben. Nach jeder erfolgreichen Zahlung schicken wir den Beleg zusätzlich an deine hinterlegte Rechnungsadresse. Nenne uns bitte die Belegnummer, falls dort etwas fehlt.',
          body_en: 'Hi {name},\n\nyou can find your receipts under Credits in the panel. After every successful payment we also email the receipt to your saved billing address. Please tell us the receipt number if anything is missing.',
          category: 'billing',
          sort: 80,
        },
        {
          title_de: 'Bitte jetzt testen',
          title_en: 'Please test now',
          body_de: 'Hallo {name},\n\nwir haben die Ursache behoben. Bitte teste es jetzt noch einmal und antworte in {ticket}, falls weiterhin eine Fehlermeldung erscheint.',
          body_en: 'Hi {name},\n\nwe have fixed the cause. Please try again now and reply in {ticket} if you still see an error message.',
          category: 'general',
          sort: 90,
        },
        {
          title_de: 'Ticket wird geschlossen',
          title_en: 'Ticket will be closed',
          body_de: 'Hallo {name},\n\nwir haben keine weitere Rückmeldung erhalten und schließen {ticket} daher. Eine neue Antwort öffnet das Ticket automatisch wieder.',
          body_en: 'Hi {name},\n\nwe have not received another reply, so we are closing {ticket}. A new reply will reopen the ticket automatically.',
          category: 'general',
          sort: 100,
        },
      ];
      const exists = db.prepare('SELECT 1 FROM ticket_templates WHERE title_de = ? OR title_en = ?');
      const insert = db.prepare(
        `INSERT INTO ticket_templates (title_de, title_en, body_de, body_en, category, sort, created_at)
         VALUES (@title_de, @title_en, @body_de, @body_en, @category, @sort, @created_at)`
      );
      for (const row of seed) {
        if (!exists.get(row.title_de, row.title_en)) insert.run({ ...row, created_at: Date.now() });
      }
    },
  },
  {
    // **Wer hat wie weit gelesen – und wie lange hat es gedauert.**
    //
    // Bis hierher wusste ein Ticket nur, ob für eine Seite *irgendetwas* ungelesen ist: ein Punkt,
    // der verschwand, sobald jemand das Ticket aufmachte. Für den Kunden reicht das. Für das Team
    // reicht es nicht: Die häufigste Frage im Support ist „hat er es überhaupt gesehen?“, und
    // darauf antwortet ein gelöschter Punkt nicht. Er sagt nicht, **wer** gelesen hat – bei einem
    // Ticket mit mehreren Beteiligten ist das ein Unterschied –, nicht **wann**, und vor allem
    // nicht **bis wohin**: Wer ein Ticket öffnet, bevor die Antwort geschrieben ist, hat sie nicht
    // gelesen, und der Punkt war trotzdem weg.
    //
    // Deshalb steht hier je Person eine Marke: die letzte Nachricht, die sie gesehen hat, und wann.
    // Daraus folgt beides – „gelesen“ ist `last_message_id >= id der Nachricht`, und die Zeit
    // daneben ist echt und nicht geraten.
    //
    // `staff` gehört zum Schlüssel, weil dieselbe Person zwei Rollen haben kann: Ein Administrator
    // liest sein eigenes Ticket unter „Support“ als Kunde und ein fremdes unter „Alle Tickets“ als
    // Team. Ohne diese Spalte würde das eine das andere überschreiben, und der Kunde bekäme
    // „gelesen“ angezeigt, weil jemand im Admin-Bereich vorbeigeschaut hat.
    //
    // Die drei Zeitstempel am Ticket sind Kennzahlen, keine Verzierung: Wie lange ein Kunde auf
    // die **erste** Antwort gewartet hat, ist die eine Zahl, an der sich ein Support messen lässt.
    // Sie ließe sich jedes Mal aus dem Verlauf errechnen – aber nicht in einer Liste über 300
    // Tickets, und dort wird sie gebraucht.
    name: '034-ticket-lesebestaetigungen-und-kennzahlen',
    sql: `
      CREATE TABLE ticket_reads (
        ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        staff           INTEGER NOT NULL DEFAULT 0,
        last_message_id INTEGER NOT NULL DEFAULT 0,
        read_at         INTEGER NOT NULL,
        PRIMARY KEY (ticket_id, user_id, staff)
      );
      CREATE INDEX ticket_reads_ticket ON ticket_reads(ticket_id, staff);

      ALTER TABLE tickets ADD COLUMN first_reply_at   INTEGER;  -- die erste Antwort des Teams
      ALTER TABLE tickets ADD COLUMN last_customer_at INTEGER;  -- zuletzt hat der Kunde geschrieben
      ALTER TABLE tickets ADD COLUMN last_staff_at    INTEGER;  -- zuletzt hat das Team geschrieben

      -- **Systemzeilen in der Sprache des Lesers.**
      --
      -- „The ticket was closed by Support.“ stand bisher auch in einem durchgehend deutschen
      -- Panel, weil eine Systemzeile fertiger Text in der Datenbank ist. Sie bleibt es – der
      -- Discord-Kanal spiegelt genau diesen Satz, und ein Verlauf, dessen Wortlaut sich mit der
      -- Spracheinstellung des Lesers ändert, ist kein Verlauf mehr.
      --
      -- Daneben steht ab hier, **was** die Zeile sagt: ein Schlüssel und seine Werte. Wer das
      -- lesen kann, zeigt den Satz in seiner Sprache; wer nicht, zeigt den englischen Text wie
      -- bisher. Alte Zeilen haben diese Spalte leer und bleiben deshalb genau so stehen, wie sie
      -- geschrieben wurden.
      ALTER TABLE ticket_messages ADD COLUMN meta TEXT;
    `,
    run() {
      // Die Kennzahlen aus dem Verlauf nachtragen. Ein Ticket, das es schon gibt, soll seine
      // Antwortzeit haben und nicht erst ab dem nächsten Beitrag – sonst steht in der Auswertung
      // ein halbes Jahr lang „keine Angabe“, wo eine Zahl längst im Verlauf steht.
      db.prepare(
        `UPDATE tickets SET
           first_reply_at = (SELECT MIN(m.created_at) FROM ticket_messages m
                              WHERE m.ticket_id = tickets.id AND m.role = 'staff' AND m.internal = 0),
           last_staff_at  = (SELECT MAX(m.created_at) FROM ticket_messages m
                              WHERE m.ticket_id = tickets.id AND m.role = 'staff' AND m.internal = 0),
           last_customer_at = (SELECT MAX(m.created_at) FROM ticket_messages m
                                WHERE m.ticket_id = tickets.id AND m.role = 'user')`
      ).run();

      // Und die Lesemarken: Wessen Punkt nicht mehr steht, hat gelesen – mehr weiß die Datenbank
      // über die Vergangenheit nicht, und mehr zu behaupten wäre falsch. Als Zeitpunkt steht
      // deshalb die letzte Bewegung am Ticket und nicht „jetzt“: „vor drei Monaten gelesen“ ist
      // wahr, „gerade eben gelesen“ wäre eine Erfindung dieses Updates.
      db.prepare(
        `INSERT INTO ticket_reads (ticket_id, user_id, staff, last_message_id, read_at)
         SELECT t.id, t.user_id, 0,
                COALESCE((SELECT MAX(m.id) FROM ticket_messages m
                           WHERE m.ticket_id = t.id AND m.internal = 0), 0),
                t.updated_at
           FROM tickets t WHERE t.unread_user = 0
         ON CONFLICT(ticket_id, user_id, staff) DO NOTHING`
      ).run();
    },
  },
  {
    // **Einmal-Link für den Blick in ein Kundenkonto.**
    //
    // Der Link selbst ist noch keine Anmeldung: Beim Einlösen muss im selben Browser eine
    // Administratorsitzung bestehen. So kann eine Adresse aus Verlauf, Zwischenablage oder
    // Serverprotokoll keinem Außenstehenden ein Kundenkonto öffnen. Der zufällige Wert steht wie
    // bei Sitzungen nur als HMAC in der Datenbank, gilt zehn Minuten und wird beim ersten Aufruf
    // atomar verbraucht.
    name: '035-admin-einmal-links',
    sql: `
      CREATE TABLE admin_login_links (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX admin_login_links_expiry ON admin_login_links(expires_at);
    `,
  },
  {
    // **Eigene API-Token für Kunden.** Dasselbe Muster wie bei Sitzungen: In der Datenbank steht
    // nur der HMAC-Abdruck (siehe auth.js `capabilityDigest`), nie der Wert selbst – eine kopierte
    // Datenbankdatei allein gibt damit kein gültiges Token her. Anders als eine Sitzung läuft ein
    // Token nicht ab; es gilt, bis der Kunde es selbst widerruft.
    name: '036-api-tokens',
    sql: `
      CREATE TABLE api_tokens (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token        TEXT NOT NULL UNIQUE,
        label        TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE INDEX api_tokens_user ON api_tokens(user_id);
    `,
  },
  {
    // **Kunden werben Kunden.** Jedes Konto bekommt einen eigenen Code, über den es andere werben
    // kann. `referred_by` steht fest, sobald sich jemand darüber anmeldet – rückwirkend ändern
    // lässt es sich nicht, sonst könnte ein Konto sich nachträglich einen Werber aussuchen.
    // `referral_rewarded` sorgt dafür, dass die Gutschrift höchstens einmal passiert, auch wenn
    // `settleTopup` aus irgendeinem Grund zweimal für dasselbe Konto anspringt (siehe billing.js).
    // Belohnt wird erst bei der ersten **echten** Aufladung des Geworbenen, nicht bei der
    // Anmeldung: Eine Anmeldung kostet nichts und ließe sich beliebig oft wiederholen, eine
    // Aufladung nicht.
    name: '037-empfehlungen',
    sql: `
      ALTER TABLE users ADD COLUMN referral_code     TEXT;
      ALTER TABLE users ADD COLUMN referred_by       INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN referral_rewarded INTEGER NOT NULL DEFAULT 0;
    `,
    run() {
      const users = db.prepare('SELECT id FROM users WHERE referral_code IS NULL').all();
      const set = db.prepare('UPDATE users SET referral_code = ? WHERE id = ?');
      const taken = db.prepare('SELECT 1 FROM users WHERE referral_code = ?');
      for (const user of users) {
        let code;
        do {
          code = referralCode();
        } while (taken.get(code));
        set.run(code, user.id);
      }
      db.exec('CREATE UNIQUE INDEX users_referral_code ON users(referral_code)');
    },
  },
];

/**
 * Kategorien, in denen der Bot **nichts** an den Rechten ändert.
 *
 * Voreingestellt sind die Bereiche des AFKSystems-Servers, die von Hand geregelt sind: Tickets,
 * das Ticket-Archiv und die internen Kategorien. Dort ist "wer darf hinein" eine Entscheidung,
 * die jemand getroffen hat – kein Zustand, den ein Dienst jede Stunde neu herstellen soll.
 */
const DEFAULT_SKIP_CATEGORIES = [
  '1538534010748280852',
  '1538202844744908814',
  '1538202845432643726',
  '1538202845168275508',
  '1538202843557793884',
].join(',');

/**
 * Die Zusätze aus der Erstbefüllung. Preise sind Credits je 30 Tage, wie beim Tarif – und wie der
 * Tarif lassen sie sich im Admin-Bereich vollständig ändern.
 */
const ADDON_SEED = [
  {
    key: 'slot',
    name_de: 'Ein Bot mehr',
    name_en: 'One more bot',
    text_de: 'Ein zusätzliches Minecraft-Konto darf auf diesem Serverplatz gleichzeitig sitzen.',
    text_en: 'One more Minecraft account may sit on this server slot at the same time.',
    price_credits: 39,
    kind: 'slot',
    flag: null,
    amount: 1,
    max_qty: 20,
    need_cap: null,
    available: 1,
    sort: 10,
  },
  {
    key: 'menus',
    name_de: 'Menüs bedienen',
    name_en: 'Use menus',
    text_de: 'Öffnet der Server ein Menü, siehst du es mit seinen Gegenständen und klickst ein Feld an. Im Ultra-Tarif schon enthalten.',
    text_en: 'When the server opens a menu you see it with its items and can click a slot. Already part of the Ultra plan.',
    price_credits: 59,
    kind: 'flag',
    flag: 'menus',
    amount: 1,
    max_qty: 1,
    need_cap: 'menu',
    available: 1,
    sort: 30,
  },
  {
    key: 'pov',
    name_de: 'Live-Ansicht (POV)',
    name_en: 'Live view (POV)',
    text_de: 'Sehen, was der Bot sieht – je Konto und Serverplatz einzeln zu buchen. In keinem Tarif enthalten, auch nicht in Ultra. Kommt später.',
    text_en: 'See what the bot sees – booked per account and server slot. Part of no plan, not even Ultra. Coming later.',
    price_credits: 199,
    kind: 'flag',
    flag: 'pov',
    amount: 1,
    max_qty: 20,
    need_cap: 'pov',
    available: 0,
    sort: 40,
  },
];

/** Die Beschreibungen der drei Tarife aus der Erstbefüllung – auch von Migration 004 benutzt. */
const PLAN_TEXTS = {
  free: {
    blurb_de: 'Ein Server ohne Kosten, solange dein verknüpftes Discord-Konto Mitglied bei AFKSystems ist.',
    blurb_en: 'One server at no cost while your linked Discord account is a member of AFKSystems.',
  },
  premium: {
    blurb_de: 'Für Server, auf denen der Bot mehr tun soll, als nur dazustehen.',
    blurb_en: 'For servers where the bot should do more than just stand there.',
  },
  ultra: {
    blurb_de: 'Wenn ein Serverplatz viele Konten gleichzeitig tragen muss.',
    blurb_en: 'When one server slot has to carry a lot of accounts at once.',
  },
};

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
    ...PLAN_TEXTS.free,
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
    board: 0,
    menus: 0,
    pov: 0,
    max_macros: 5,
    addons: 0,
    highlight: 0,
    features_de: [
      '1 Bot gleichzeitig auf diesem Server',
      '200 Zeilen Chatverlauf',
      'Discord-Konto und Mitgliedschaft bei AFKSystems erforderlich',
    ].join('\n'),
    features_en: [
      '1 bot at once on this server',
      '200 lines of chat history',
      'Linked Discord account and AFKSystems membership required',
    ].join('\n'),
    sort: 0,
  },
  {
    slug: 'premium',
    name_de: 'Premium',
    name_en: 'Premium',
    ...PLAN_TEXTS.premium,
    price_credits: 249,
    free_slot: 0,
    max_accounts: 5,
    premium: 1,
    movement: 1,
    proxy: 1,
    offline_accounts: 1,
    fakehost: 1,
    chat_limit: 50000,
    chat_limit_editable: 1,
    priority_support: 1,
    // Die Anzeigetafel gehört zu jedem bezahlten Platz. Menüs sind der Zusatz, den Premium
    // dazukaufen kann und der in Ultra schon drinsteckt – das ist der Unterschied der beiden.
    board: 1,
    menus: 0,
    pov: 0,
    max_macros: 40,
    addons: 1,
    highlight: 0,
    features_de: [
      '5 Bots gleichzeitig auf diesem Server',
      'Bewegung, Anti-AFK, Schleichen',
      '50000 Zeilen Chatverlauf',
      'Scoreboard wie im Spiel',
      'Eigene Ausgangsadresse auf Anfrage',
      'Support mit Vorrang',
    ].join('\n'),
    features_en: [
      '5 bots at once on this server',
      'Movement, anti-AFK, sneaking',
      '50,000 lines of chat history',
      'Scoreboard as in the game',
      'Dedicated outgoing address on request',
      'Priority support',
    ].join('\n'),
    sort: 10,
  },
  {
    slug: 'ultra',
    name_de: 'Ultra',
    name_en: 'Ultra',
    ...PLAN_TEXTS.ultra,
    price_credits: 599,
    free_slot: 0,
    max_accounts: 25,
    premium: 1,
    movement: 1,
    proxy: 1,
    offline_accounts: 1,
    fakehost: 1,
    chat_limit: 50000,
    chat_limit_editable: 1,
    priority_support: 1,
    board: 1,
    menus: 1,
    pov: 0,
    max_macros: 200,
    addons: 1,
    highlight: 1,
    features_de: '',
    features_en: '',
    sort: 20,
  },
];

if (!db.prepare('SELECT COUNT(*) AS n FROM plans').get().n) {
  const insert = db.prepare(`INSERT INTO plans
    (slug, name_de, name_en, blurb_de, blurb_en, price_credits, free_slot, max_accounts, premium,
     movement, proxy, offline_accounts, fakehost, chat_limit, chat_limit_editable, priority_support,
     board, menus, pov, max_macros, addons, highlight, features_de, features_en, sort)
    VALUES (@slug, @name_de, @name_en, @blurb_de, @blurb_en, @price_credits, @free_slot,
     @max_accounts, @premium, @movement, @proxy, @offline_accounts, @fakehost, @chat_limit,
     @chat_limit_editable, @priority_support, @board, @menus, @pov, @max_macros, @addons,
     @highlight, @features_de, @features_en, @sort)`);
  db.transaction(() => PLAN_SEED.forEach((plan) => insert.run(plan)))();
}

// Beim allerersten Start gibt es noch keinen Standort – Migration 005 legt ihn nur für Bestände an.
if (!db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n) {
  const info = db
    .prepare(
      `INSERT INTO nodes (name, kind, region, access, note, sort, created_at)
       VALUES ('Haupt-Standort', 'local', '', 'all', 'Dieser Server. Bots laufen hier.', 0, ?)`
    )
    .run(Date.now());
  db.prepare('UPDATE profiles SET node_id = ? WHERE node_id IS NULL').run(info.lastInsertRowid);
}

// Profile ohne Tarif (aus der Zeit der Stundenabrechnung) bekommen den kostenlosen Platz.
const seededFreePlan = db
  .prepare('SELECT id FROM plans WHERE free_slot = 1 ORDER BY sort LIMIT 1')
  .get();
if (seededFreePlan) {
  db.prepare('UPDATE profiles SET plan_id = ? WHERE plan_id IS NULL').run(seededFreePlan.id);
}

// ---------------------------------------------------------------- Vorbereitete Abfragen
//
// **Jedes `db.prepare(...)` übersetzt SQL neu.** Im Panel steht der Aufruf fast überall dort, wo
// die Abfrage gebraucht wird – lesbar, aber teuer: Ein Profil im laufenden Betrieb zeigte das
// Übersetzen als den größten einzelnen Posten der Serverzeit, größer als Kompression, Vorlagen und
// Sitzungsprüfung zusammen. Der Grund ist die Menge, nicht die einzelne Abfrage: Eine Seite im
// Panel löst leicht hundert davon aus, und jede kostet dasselbe wieder.
//
// Derselbe Text ergibt immer dieselbe übersetzte Abfrage, also wird sie behalten. Das ist auch die
// Bedingung, unter der es sicher ist: Ein Statement von better-sqlite3 hält bei `.get()`, `.all()`
// und `.run()` keinen Zustand zwischen den Aufrufen. Zustand hätte nur `.iterate()` – ein halb
// gelesener Cursor ließe sich nicht gleichzeitig ein zweites Mal benutzen –, und `.iterate()` kommt
// in diesem Dienst nicht vor. Dasselbe gilt für `.pluck()`, `.raw()` und `.expand()`: Sie schalten
// ein Statement dauerhaft um, und ein geteiltes Statement träfe damit auch den nächsten Aufrufer.
// Auch die kommen hier nicht vor. Wer eines davon einführt, baut sein Statement mit `prepareOnce`
// (unten exportiert) und bekommt damit wie früher ein eigenes.
//
// Die Obergrenze ist gegen den einen Fall da, in dem der Text *nicht* endlich ist: Ein paar
// Schreibpfade bauen ihr `UPDATE … SET` aus den Feldern zusammen, die sich wirklich geändert haben.
// Das sind Teilmengen, also im schlechtesten Fall viele Varianten. Ohne Deckel wäre der Zwischen-
// speicher ein Leck; mit Deckel fällt die älteste Variante heraus und wird beim nächsten Mal neu
// übersetzt – genau das Verhalten von vorher, aber eben nur für diese Handvoll Abfragen.
const STATEMENT_CACHE_MAX = 500;
const statements = new Map();

/** Das ursprüngliche `prepare` – für alles, was ein Statement für sich allein braucht. */
export const prepareOnce = db.prepare.bind(db);

db.prepare = function cachedPrepare(sql) {
  const hit = statements.get(sql);
  if (hit !== undefined) return hit;
  const statement = prepareOnce(sql);
  if (statements.size >= STATEMENT_CACHE_MAX) {
    // Eine Map behält ihre Einfügereihenfolge: der erste Eintrag ist der älteste.
    statements.delete(statements.keys().next().value);
  }
  statements.set(sql, statement);
  return statement;
};

// ---------------------------------------------------------------- Was sich selten ändert
//
// Ein paar Tabellen sind winzig, ändern sich fast nie und werden trotzdem dauernd gelesen: die
// Tarife, die Zusätze, die Einstellungen. Ein einziger Aufruf von `/api/profiles` fragte den Tarif
// eines Serverplatzes ein halbes Dutzend Mal ab, einmal je Funktion, die ihn braucht.
//
// **Woran erkennt der Zwischenspeicher, dass er alt ist?** Nicht an einer Uhr und nicht an einer
// Liste von Stellen, die sich melden müssen – so etwas vergisst man beim nächsten Endpunkt, und
// dann steht im Panel ein Preis, den es nicht mehr gibt. Sondern an SQLite selbst: `total_changes()`
// zählt jede Zeile, die diese Verbindung jemals eingefügt, geändert oder gelöscht hat. Steht der
// Zähler noch, wo er stand, hat **niemand** geschrieben, und der gemerkte Wert ist mit Sicherheit
// derselbe, den eine neue Abfrage ergäbe.
//
// Das ist bewusst grob: Jede Schreiboperation irgendwo im Dienst wirft alles weg. Das kostet
// nichts – ein Neuaufbau ist eine Abfrage über drei Zeilen –, und es kann per Konstruktion nicht
// veralten. Der Zähler wird zuerst gelesen und danach gebaut; wer dazwischen schreibt, bekommt
// beim nächsten Mal einen Neuaufbau, nie eine alte Antwort.
//
// **`total_changes()` allein reicht nicht.** Es zählt nur, was *diese* Verbindung geschrieben hat.
// Die Datenbank ist aber eine Datei, und es gibt einen zweiten Weg an sie heran:
// `npm run admin:credits` startet einen eigenen Prozess mit eigener Verbindung und bucht Guthaben,
// und der Testlauf schreibt genauso von außen in denselben Bestand. Für diese Schreibvorgänge
// bewegt sich der Zähler hier nicht um einen Strich – ohne die zweite Frage bliebe der Dienst auf
// einer Fassung sitzen, die es nicht mehr gibt, bis ihn jemand neu startet.
//
// Die zweite Frage ist `PRAGMA data_version`: eine Zahl, die sich genau dann ändert, wenn eine
// **andere** Verbindung etwas festgeschrieben hat. Beide zusammen decken jeden Schreibvorgang ab.
//
// Beide werden bei **jedem** Zugriff gestellt. Ein Fenster, in dem eine Änderung noch nicht gilt –
// und sei es nur eine Millisekunde –, wäre hier der falsche Handel: `setSetting` und das Lesen
// desselben Wertes stehen im selben Endpunkt direkt hintereinander, und ein Zwischenspeicher, der
// „meistens stimmt“, ist im Zweifel schlimmer als gar keiner. Gemessen kostet das Paar zusammen
// gut drei Mikrosekunden und im Durchsatz der Endpunkte nichts Messbares.
//
// Die eine Ausnahme, die beide nicht sehen, sind Änderungen am Schema selbst
// (`CREATE`/`ALTER`/`DROP`). Die stehen ausschließlich in den Migrationen weiter oben und laufen
// beim Hochfahren, bevor irgendetwas hiervon zum ersten Mal gefragt wird.
const readChanges = prepareOnce('SELECT total_changes() AS n');
const readForeign = prepareOnce('PRAGMA data_version');

const outsideVersion = () => readForeign.get().data_version;

/**
 * Ein abgeleiteter Wert, der neu berechnet wird, sobald irgendwo geschrieben wurde.
 *
 * Der zurückgegebene Wert wird geteilt – wer ihn verändert, verändert ihn für alle. Also nur für
 * Dinge benutzen, die gelesen und nicht angefasst werden.
 */
export function cached(build) {
  let ownStamp = -1;
  let outsideStamp = -1;
  let value;
  return () => {
    const own = readChanges.get().n;
    const outside = outsideVersion();
    if (own !== ownStamp || outside !== outsideStamp) {
      value = build();
      ownStamp = own;
      outsideStamp = outside;
    }
    return value;
  };
}

// ---------------------------------------------------------------- Einstellungen

const defaults = {
  // Wie viele Serverplätze je Konto nichts kosten. Die Preise selbst stehen in `plans`.
  free_slots: 1,
  // Startguthaben bei der Registrierung, in Credits (= Cent). 0 = keins, der Gratis-Server reicht.
  signup_bonus: 0,
  // Gutschrift für Werber und Geworbenen, wenn Letzterer zum ersten Mal echt auflädt. 0 schaltet
  // das Empfehlungsprogramm ab.
  referral_bonus: 0,
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

  // Bezahlen läuft über Stripe. Alles hier, damit der Betreiber die Kasse einrichten kann, ohne
  // eine Datei auf dem Server anzufassen. Ohne Schlüssel bleibt die Zahlart einfach aus.
  stripe_enabled: 0,
  stripe_secret_key: '', // sk_live_… oder sk_test_…
  stripe_webhook_secret: '', // whsec_… – ohne dieses Geheimnis wird keine Zahlung angenommen

  // Umsatzsteuer. Vorgabe ist die Kleinunternehmerregelung: keine Umsatzsteuer auf den Verkauf,
  // keine auf der Rechnung, dafür der Grund als Satz darunter (siehe vat.js und legal.js).
  vat_mode: 'small_business', // small_business | stripe_tax
  vat_note_de: VAT_NOTE_DE,
  vat_note_en: VAT_NOTE_EN,

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
  discord_login: 0, // 1 = Anmelden (und Registrieren) mit Discord erlaubt
  // Der Zustand der Anlage als Discord-Nachricht: Auslastung, Standorte, Bots, Sicherungen,
  // aufgefallene Aufgaben. **Keine Tickets** – die stehen im Panel und in ihrem eigenen Kanal.
  discord_system_webhook: '',
  // Wie oft der Lagebericht von selbst kommt, in Stunden. 0 = nur Warnungen, kein Bericht.
  system_report_hours: 12,
  discord_invite: '', // öffentlicher Einladungslink, steht auf der Website

  // Der Discord-Bot (bot/). Er läuft als eigener Dienst und spricht über /api/bot mit dem Panel.
  discord_bot_token: '',
  discord_guild_id: '',
  discord_bot_secret: '', // gemeinsames Geheimnis zwischen Bot und Panel
  discord_ticket_channel: '', // Kanal mit dem Knopf "Ticket aufmachen"
  discord_ticket_category: '', // Kategorie, unter der Ticket-Kanäle entstehen
  // Der Gratis-Tarif gilt nur für Mitglieder dieses Servers. Die Prüfung kommt vom Bot und wird
  // nach kurzer Zeit ohne frischen Nachweis absichtlich ungültig (fail closed).
  free_discord_guild_id: '1538202840445485126',
  free_discord_check_minutes: 120,
  discord_role_customer: '',
  discord_role_linked: '', // alter Name; dient bestehenden Installationen als Fallback
  discord_role_premium: '',
  discord_role_ultra: '',
  discord_role_partner: '',
  discord_role_vip: '',
  discord_role_team: '', // normale Rolle; bekommt automatisch, wer Admin oder Mod ist
  // IDs der Discord Linked Roles für Administrator/Moderator. Der Bot braucht sie für
  // Ticket-Kanalrechte, synchronisiert sie aber nicht direkt.
  discord_role_admin: '',
  discord_role_mod: '',

  // Anmelden mit Google. Dieselbe Bauart wie Discord: eigene Anwendung des Betreibers.
  google_client_id: '',
  google_client_secret: '',
  google_login: 0,

  // Welche Nachrichten es überhaupt gibt. Wer keine will, stellt sie am eigenen Konto ab –
  // hier steht nur, was der Betreiber grundsätzlich verschickt.
  mail_topup: 1,
  mail_renewal: 1,
  mail_ticket: 1,
  mail_announcement: 1,
  mail_security: 1, // Anmeldung an neuem Gerät, Passwortwechsel – lässt sich nicht abbestellen

  // Vollständige Vorgaben statt leerer öffentlicher Seiten. Eigene Texte in der Datenbank gehen
  // weiterhin vor. Eine separate Anbieterkennzeichnungsseite wird nicht angeboten.
  legal_privacy: PRIVACY_DE,
  legal_privacy_en: PRIVACY_EN,
  legal_terms: TERMS_DE,
  legal_terms_en: TERMS_EN,

  // Kategorien, in denen der Bot keine Kanalrechte setzt (kommagetrennte IDs). Siehe oben.
  discord_skip_categories: DEFAULT_SKIP_CATEGORIES,

  // Betrieb
  // Inhaltsschutz auf der **Serverseite**: CSS und JavaScript lassen sich nicht einzeln abrufen
  // und liegen in keinem fremden Zwischenspeicher (docs/schutz.md). Am Verhalten der Seite im
  // Browser ändert das nichts.
  content_protection: 1,
  // Bedienung sperren: Rechtsklick, Markieren, Ziehen, Drucken und die Entwicklerwerkzeuge.
  // Aus: die Seite verhält sich wie jede andere Website. Das ist die Vorgabe, denn eine Seite,
  // auf der man eine Serveradresse nicht markieren kann, ärgert vor allem die eigenen Kunden.
  content_lock_ui: 0,
  maintenance: 0,
  maintenance_text: '',
  // Sicherungen der Datenbank: eine je Tag, die letzten vierzehn bleiben liegen. Vierzehn, weil
  // das zwei Wochen sind – lange genug, um einen Fehler zu bemerken, der am Freitag passiert ist.
  backup_daily: 1,
  backup_keep: 14,
  max_bots_per_user: 25,
  support_hours: '',
  // Die Adresse, unter der man den Support **ohne** Konto erreicht: im Fuß jeder öffentlichen
  // Seite, im Support-Bildschirm und als Antwortadresse jeder Nachricht, die von hier hinausgeht.
  // Ein Ticket bleibt der bessere Weg (Verlauf, Zuordnung, Anhänge) – aber wer sein Passwort
  // verloren hat oder gar kein Konto anlegen konnte, hat sonst gar keinen.
  support_email: 'support@afksystems.de',

  // Wer verkauft. Das steht auf jedem Beleg – und zwar als **Absender**, denn Verkäufer ist der
  // Betreiber und nicht Stripe. Leer heißt: Es steht die Marke da und sonst nichts; ein Beleg
  // ohne Absender ist keiner, deshalb gehört das ausgefüllt, bevor Geld hereinkommt.
  company_name: '',
  company_address: '', // mehrzeilig, eine Zeile je Zeile
  company_vat_id: '',
};


const writeSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

const parse = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

/**
 * Alle Einstellungen als Tabelle – gelesen und ausgepackt, solange niemand schreibt.
 *
 * `getSetting` steht an sechsundachtzig Stellen im Dienst, mehrere davon in jedem Seitenaufruf:
 * Wartungsmodus, Inhaltsschutz, Discord-Link, Support-Adresse, Umsatzsteuersatz. Jeder Aufruf war
 * eine Abfrage **und** ein `JSON.parse` – für Werte, die sich ändern, wenn jemand im Admin-Bereich
 * auf Speichern drückt, also praktisch nie. Siehe `cached` weiter oben, warum das nicht veralten
 * kann.
 */
const settings = cached(() => {
  const table = new Map();
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    table.set(row.key, parse(row.value));
  }
  return table;
});

export function getSetting(key) {
  const table = settings();
  return table.has(key) ? table.get(key) : defaults[key];
}

export function setSetting(key, value) {
  writeSetting.run(key, JSON.stringify(value));
}

export function allSettings() {
  return { ...defaults, ...Object.fromEntries(settings()) };
}

export const settingDefaults = defaults;

export function audit(userId, action, detail, ip = null) {
  // `detail` auf Wahrheit zu prüfen verschluckte genau die Werte, die eine Zahl sind: eine `0`
  // (etwa `qty: 0` beim Abnehmen eines Zusatzes) und ein leerer Text fielen aus dem Protokoll
  // heraus, als wäre gar kein Detail übergeben worden.
  const text =
    detail === null || detail === undefined
      ? null
      : typeof detail === 'string'
        ? detail
        : JSON.stringify(detail);
  db.prepare('INSERT INTO audit (user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)').run(
    userId ?? null,
    action,
    text,
    ip,
    Date.now()
  );
}
