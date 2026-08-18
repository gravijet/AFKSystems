// SQLite als einzige Datenablage. Ein Schema, das beim Start angelegt wird; Änderungen kommen als
// weitere `migrations`-Einträge dazu, damit ein Update nie von Hand nachgezogen werden muss.
//
// Geldeinheit ist **ein Credit = ein Cent**. 100 Credits = 1 Euro. Ganzzahlig, keine Bruchteile,
// keine Milli-Einheiten: Was im Panel steht, lässt sich ohne Umrechnen mit dem Kontoauszug
// vergleichen. Bezahlt wird nicht nach Stunden, sondern je Serverplatz und Monat – und ein Monat
// sind hier immer genau 30 Tage (siehe MONTH_MS in billing.js).

import Database from 'better-sqlite3';
import { paths } from './config.js';
import { PRIVACY_DE, PRIVACY_EN, TERMS_DE, TERMS_EN } from './legal.js';

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
        if (row.blurb_de !== de && row.blurb_en !== en) continue;
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
];

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

  // Bezahlen läuft über Tebex. Alles hier, damit der Betreiber seinen Shop einrichten kann, ohne
  // eine Datei auf dem Server anzufassen. Ohne Schlüssel bleibt die Zahlart einfach aus.
  tebex_enabled: 0,
  tebex_mode: 'checkout', // checkout | headless
  tebex_project_id: '',
  tebex_private_key: '',
  tebex_store_token: '',
  tebex_webhook_secret: '',
  tebex_store_url: '',

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
  discord_staff_webhook: '', // neue Tickets und Meldungen ans Team landen hier
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

  // Betrieb
  // Inhaltsschutz: Rechtsklick, Markieren, Ziehen, Drucken und der einzelne Aufruf von CSS/JS
  // sind gesperrt, offene Entwicklerwerkzeuge blenden den Inhalt aus (docs/schutz.md).
  content_protection: 1,
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

export function audit(userId, action, detail, ip = null) {
  db.prepare('INSERT INTO audit (user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)').run(
    userId ?? null,
    action,
    detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null,
    ip,
    Date.now()
  );
}
