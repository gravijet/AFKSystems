// Serverplätze und alles, was daran hängt: Tarif, Konten zuordnen, Bots starten/stoppen, Chat
// lesen und schreiben, Bewegung und Premium-Befehle, Macros und Spam.

import express from 'express';
import { db, audit } from '../db.js';
import { requireUser } from '../auth.js';
import { supervisor } from '../supervisor.js';
import { macros as macroEngine, ACTIONS, EVENT_TYPES } from '../macros.js';
import * as binaries from '../binaries.js';
import * as billing from '../billing.js';
import { planView } from './core.js';
import {
  wrap,
  requireString,
  requireInt,
  bad,
  notFound,
  parseAddress,
  slugify,
  HttpError,
} from '../util.js';

export const router = express.Router();
router.use(requireUser);

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
              a.name, a.uuid, a.status, a.last_error, a.kind,
              b.state, b.connections, b.uptime_sec, b.last_error AS bot_error
         FROM profile_accounts pa
         JOIN mc_accounts a ON a.id = pa.account_id
    LEFT JOIN bots b ON b.profile_id = pa.profile_id AND b.account_id = pa.account_id
        WHERE pa.profile_id = ?
     ORDER BY pa.ordinal, a.name COLLATE NOCASE`
    )
    .all(profile.id);

  return rows.map((row) => {
    const live = supervisor.get(profile.id, row.account_id);
    return {
      account_id: row.account_id,
      name: row.name,
      uuid: row.uuid,
      kind: row.kind,
      account_status: row.status,
      account_error: row.last_error,
      note: row.note,
      proxy_id: row.proxy_id,
      wanted: Boolean(row.wanted),
      state: live ? live.state : 'offline',
      detail: live ? live.detail : '',
      online: live ? live.online : false,
      since: live ? live.since : null,
      connections: row.connections || 0,
      uptime_sec: row.uptime_sec || 0,
      last_error: live ? live.lastError : row.bot_error,
      menu: live ? live.menu : null,
      head: `https://minotar.net/helm/${encodeURIComponent(row.uuid || row.name)}/64.png`,
    };
  });
}

function profileView(profile, lang = 'en') {
  const plan = billing.planOf(profile);
  const members = membersOf(profile);
  const build = binaries.buildFor(profile, plan);
  const caps = build ? binaries.caps(build) : {};
  return {
    id: profile.id,
    name: profile.name,
    slug: profile.slug,
    host: profile.host,
    port: profile.port,
    address: profile.port ? `${profile.host}:${profile.port}` : profile.host,
    mc_version: profile.mc_version,
    join_delay: profile.join_delay,
    reconnect_delay: profile.reconnect_delay,
    max_backoff: profile.max_backoff,
    chat_delay: profile.chat_delay,
    chat_limit: profile.chat_limit,
    auto_reconnect: Boolean(profile.auto_reconnect),
    movement: Boolean(profile.movement),
    fake_host: profile.fake_host || '',
    antiafk_sec: profile.antiafk_sec,
    sneak: Boolean(profile.sneak),
    on_cooldown: profile.on_cooldown,
    anti_afk: JSON.parse(profile.anti_afk || '{}'),
    color: profile.color,
    ordinal: profile.ordinal,
    created_at: profile.created_at,

    plan: planView(plan, lang),
    paid_until: profile.paid_until,
    renew: Boolean(profile.renew),
    suspended: Boolean(profile.suspended),
    active: billing.isActive(profile),
    days_left: profile.paid_until
      ? Math.max(0, Math.ceil((profile.paid_until - Date.now()) / 86_400_000))
      : null,

    build,
    caps,
    accounts: members,
    online: members.filter((member) => member.online).length,
    total: members.length,
  };
}

/** Aus dem Wunsch "diese Konten" eine geprüfte Liste machen; leer = alle des Platzes. */
function targets(req, profile) {
  const wanted = Array.isArray(req.body?.accounts) ? req.body.accounts.map(Number) : [];
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

const langOf = (req) => (String(req.query.lang || req.user?.language || 'en') === 'de' ? 'de' : 'en');

/** Fähigkeiten, die diesem Serverplatz zur Verfügung stehen. */
const capsOf = (profile) => {
  const build = binaries.buildFor(profile, billing.planOf(profile));
  return build ? binaries.caps(build) : {};
};

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
    });
  })
);

router.post(
  '/',
  wrap((req, res) => {
    const body = req.body || {};
    const lang = langOf(req);
    const name = requireString(body.name, 'Name', { max: 40 });
    const { host, port } = parseAddress(body.address);
    const version = String(body.mc_version || binaries.state.defaultVersion);
    if (binaries.state.versions.length && !binaries.state.versions.includes(version)) {
      throw bad(
        `Version "${version}" kann der Client nicht. Möglich: ${binaries.state.versions.join(', ')}`,
        {
          en: `The client cannot speak "${version}". Available: ${binaries.state.versions.join(', ')}`,
        }
      );
    }

    // Ohne Angabe: der kostenlose Platz, solange einer frei ist – sonst der günstigste bezahlte.
    let plan = body.plan_id ? billing.planById(requireInt(body.plan_id, 'Tarif')) : null;
    if (!plan) {
      plan = billing.freeSlotAvailable(req.user.id) ? billing.freePlan() : billing.cheapestPaidPlan();
    }
    if (!plan) throw bad('Es ist kein Tarif eingerichtet.', { en: 'No plan is set up.' });
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

    let slug = slugify(name);
    let suffix = 1;
    while (db.prepare('SELECT 1 FROM profiles WHERE user_id = ? AND slug = ?').get(req.user.id, slug)) {
      slug = `${slugify(name)}-${++suffix}`;
    }

    const max = db.prepare('SELECT MAX(ordinal) AS m FROM profiles WHERE user_id = ?').get(req.user.id).m;
    const info = db
      .prepare(
        `INSERT INTO profiles (user_id, name, slug, host, port, mc_version, plan_id, chat_limit, ordinal, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        name,
        slug,
        host,
        port,
        version,
        plan.id,
        Math.min(200, plan.chat_limit),
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

    for (const accountId of Array.isArray(body.accounts) ? body.accounts : []) {
      const account = ownedAccount(req, accountId);
      db.prepare(
        'INSERT OR IGNORE INTO profile_accounts (profile_id, account_id, ordinal) VALUES (?, ?, 0)'
      ).run(profile.id, account.id);
    }
    audit(req.user.id, 'profile-create', { name, host, port, plan: plan.slug });
    res.json({ profile: profileView(profile, lang), balance: billing.balance(req.user.id) });
  })
);

router.get(
  '/:id',
  wrap((req, res) => res.json({ profile: profileView(ownedProfile(req), langOf(req)) }))
);

router.patch(
  '/:id',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const plan = billing.planOf(profile);
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
    if (body.join_delay !== undefined) put('join_delay', requireInt(body.join_delay, 'Join-Delay', { max: 600 }));
    if (body.reconnect_delay !== undefined) {
      put('reconnect_delay', requireInt(body.reconnect_delay, 'Reconnect-Delay', { min: 1, max: 600 }));
    }
    if (body.max_backoff !== undefined) {
      put('max_backoff', requireInt(body.max_backoff, 'Max-Backoff', { min: 1, max: 3600 }));
    }
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
    if (body.auto_reconnect !== undefined) put('auto_reconnect', body.auto_reconnect ? 1 : 0);
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
    if (body.on_cooldown !== undefined) {
      put('on_cooldown', requireInt(body.on_cooldown, 'Sperrzeit', { min: 1, max: 3600 }));
    }
    if (body.color !== undefined) put('color', String(body.color).slice(0, 20));
    if (body.anti_afk !== undefined) put('anti_afk', JSON.stringify(body.anti_afk || {}));
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
router.post(
  '/:id/plan',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const plan = billing.planById(requireInt(req.body?.plan_id, 'Tarif'));
    if (!plan) throw notFound('Diesen Tarif gibt es nicht.', { en: 'No such plan.' });
    const updated = billing.setPlan(profile, plan);
    // Was der neue Tarif nicht mehr hergibt, wird sofort abgeschaltet statt still weiterzulaufen.
    if (!plan.premium) {
      db.prepare('UPDATE profiles SET antiafk_sec = 0, sneak = 0 WHERE id = ?').run(profile.id);
    }
    if (!plan.movement) db.prepare('UPDATE profiles SET movement = 0 WHERE id = ?').run(profile.id);
    if (!plan.fakehost) db.prepare('UPDATE profiles SET fake_host = NULL WHERE id = ?').run(profile.id);
    if (supervisor.runningOnProfile(profile.id) > plan.max_accounts) {
      supervisor.stopProfile(profile.id, 'Tarif gewechselt – bitte neu starten.', { keepWanted: false });
    }
    res.json({
      profile: profileView(db.prepare('SELECT * FROM profiles WHERE id = ?').get(updated.id), langOf(req)),
      balance: billing.balance(req.user.id),
    });
  })
);

/** Einen stillgelegten Platz wieder anschalten (bezahlt 30 neue Tage). */
router.post(
  '/:id/resume',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    if (!profile.suspended) throw bad('Dieser Server ist nicht stillgelegt.', {
      en: 'This server is not suspended.',
    });
    const updated = billing.resume(profile);
    res.json({ profile: profileView(updated, langOf(req)), balance: billing.balance(req.user.id) });
  })
);

router.delete(
  '/:id',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    for (const member of membersOf(profile)) supervisor.stop(profile.id, member.account_id);
    // Restlaufzeit kommt aufs Guthaben zurück – gelöscht wird schließlich freiwillig.
    const refund = billing.refundValue(profile);
    if (refund > 0) billing.move(req.user.id, refund, 'refund', `Restguthaben "${profile.name}"`);
    db.prepare('DELETE FROM profiles WHERE id = ?').run(profile.id);
    audit(req.user.id, 'profile-delete', { name: profile.name, refund });
    res.json({ ok: true, refund, balance: billing.balance(req.user.id) });
  })
);

// ---------------------------------------------------------------- Konten auf dem Platz

router.post(
  '/:id/accounts',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const plan = billing.planOf(profile);
    const wanted = Array.isArray(req.body?.accounts) ? req.body.accounts : [req.body?.account_id];
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
    for (const accountId of fresh) {
      db.prepare(
        `INSERT INTO profile_accounts (profile_id, account_id, note, ordinal)
         VALUES (?, ?, ?, 0) ON CONFLICT(profile_id, account_id) DO NOTHING`
      ).run(profile.id, accountId, req.body?.note || null);
    }
    res.json({ profile: profileView(profile, langOf(req)) });
  })
);

router.patch(
  '/:id/accounts/:accountId',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const plan = billing.planOf(profile);
    const account = ownedAccount(req, req.params.accountId);
    const body = req.body || {};
    if (body.note !== undefined) {
      db.prepare('UPDATE profile_accounts SET note = ? WHERE profile_id = ? AND account_id = ?').run(
        String(body.note || '').slice(0, 200) || null,
        profile.id,
        account.id
      );
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
      db.prepare('UPDATE profile_accounts SET proxy_id = ? WHERE profile_id = ? AND account_id = ?').run(
        proxyId,
        profile.id,
        account.id
      );
    }
    res.json({ profile: profileView(profile, langOf(req)) });
  })
);

router.delete(
  '/:id/accounts/:accountId',
  wrap((req, res) => {
    const profile = ownedProfile(req);
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
    const profile = ownedProfile(req);
    const plan = billing.planOf(profile);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const results = [];
    for (const accountId of targets(req, profile)) {
      const account = db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(accountId);
      try {
        results.push({
          account_id: accountId,
          ok: true,
          bot: supervisor.start({ profile, account, user, plan }),
        });
      } catch (error) {
        results.push({
          account_id: accountId,
          ok: false,
          error: error.message,
          status: error instanceof HttpError ? error.status : 500,
        });
      }
    }
    res.json({ results, profile: profileView(profile, langOf(req)) });
  })
);

router.post(
  '/:id/stop',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    for (const accountId of targets(req, profile)) supervisor.stop(profile.id, accountId);
    res.json({ profile: profileView(profile, langOf(req)) });
  })
);

router.post(
  '/:id/restart',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const plan = billing.planOf(profile);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const list = targets(req, profile);
    for (const accountId of list) supervisor.stop(profile.id, accountId, { keepWanted: true });
    // Kurz warten, damit der alte Prozess wirklich weg ist, bevor der neue startet.
    setTimeout(() => {
      for (const accountId of list) {
        const account = db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(accountId);
        try {
          supervisor.start({ profile, account, user, plan });
        } catch {
          /* Fehler steht im Bot-Zustand */
        }
      }
    }, 1500).unref();
    res.json({ ok: true });
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
    lines.sort((a, b) => a.t - b.t);
    res.json({ lines: lines.slice(-2000), now: Date.now() });
  })
);

router.post(
  '/:id/chat',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const text = requireString(req.body?.text, 'Nachricht', { max: 256 });
    const results = [];
    for (const accountId of targets(req, profile)) {
      const bot = supervisor.get(profile.id, accountId);
      try {
        if (!bot) throw new HttpError(409, 'Der Bot läuft gerade nicht.', { en: 'That bot is not running.' });
        bot.send(text);
        results.push({ account_id: accountId, ok: true });
      } catch (error) {
        results.push({ account_id: accountId, ok: false, error: error.message });
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
  tab: 'board',
  menu: 'menu',
  click: 'menu',
  close: 'menu',
  antiafk: 'antiafk',
};

const runLocal = wrap((req, res) => {
  const profile = ownedProfile(req);
  const verb = String(req.body?.verb || '').toLowerCase();
  const need = LOCAL_VERBS[verb];
  if (!need) throw bad(`Unbekannter Befehl "${verb}".`, { en: `Unknown command "${verb}".` });
  const arg = String(req.body?.arg || '').slice(0, 60);
  const results = [];
  for (const accountId of targets(req, profile)) {
    const bot = supervisor.get(profile.id, accountId);
    try {
      if (!bot) throw new HttpError(409, 'Der Bot läuft gerade nicht.', { en: 'That bot is not running.' });
      bot.local(verb, arg, need);
      results.push({ account_id: accountId, ok: true });
    } catch (error) {
      results.push({ account_id: accountId, ok: false, error: error.message });
    }
  }
  if (results.every((entry) => !entry.ok)) {
    throw new HttpError(409, results[0]?.error || 'Kein Bot konnte den Befehl annehmen.', {
      en: results[0]?.error || 'No bot could take the command.',
    });
  }
  res.json({ results });
});

router.post('/:id/command', runLocal);
// Alter Name, damit offene Tabs und Lesezeichen weiter funktionieren.
router.post('/:id/move', runLocal);

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
    if (type === 'chat') action.text = requireString(raw.text, 'Text', { max: 256 });
    if (type === 'wait') action.seconds = requireInt(raw.seconds, 'Sekunden', { min: 1, max: 3600 });
    if (type === 'move') {
      action.direction = ['vor', 'zurück', 'links', 'rechts'].includes(raw.direction)
        ? raw.direction
        : 'vor';
      action.blocks = requireInt(raw.blocks ?? 1, 'Blöcke', { min: 1, max: 64 });
    }
    if (type === 'look') {
      action.yaw = requireInt(raw.yaw ?? 0, 'Yaw', { min: -180, max: 180 });
      action.pitch = requireInt(raw.pitch ?? 0, 'Pitch', { min: -90, max: 90 });
    }
    if (type === 'hand') action.slot = requireInt(raw.slot ?? 1, 'Feld', { min: 1, max: 9 });
    if (type === 'click') {
      action.slot = requireInt(raw.slot ?? 0, 'Feld', { min: 0, max: 100 });
      action.button = ['rechts', 'shift'].includes(raw.button) ? raw.button : '';
    }
    return action;
  });
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
  }
  if (event === 'chat') {
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
    const profile = ownedProfile(req);
    const body = req.body || {};
    const name = requireString(body.name, 'Name', { max: 60 });
    const event = EVENT_TYPES.includes(body.event) ? body.event : 'join';
    const actions = cleanActions(body.actions, capsOf(profile));
    const info = db
      .prepare(
        `INSERT INTO macros (profile_id, name, event, config, actions, accounts, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        profile.id,
        name,
        event,
        JSON.stringify(cleanConfig(body.config, event)),
        JSON.stringify(actions),
        JSON.stringify((body.accounts || []).map(Number)),
        body.enabled === false ? 0 : 1,
        Date.now()
      );
    macroEngine.reload(profile.id);
    res.json({ id: info.lastInsertRowid, restart_hint: event === 'join' });
  })
);

router.patch(
  '/:id/macros/:macroId',
  wrap((req, res) => {
    const profile = ownedProfile(req);
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
      values.push(JSON.stringify((body.accounts || []).map(Number)));
    }
    if (body.enabled !== undefined) {
      set.push('enabled = ?');
      values.push(body.enabled ? 1 : 0);
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
    const profile = ownedProfile(req);
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
    const profile = ownedProfile(req);
    const macro = db
      .prepare('SELECT * FROM macros WHERE id = ? AND profile_id = ?')
      .get(requireInt(req.params.macroId, 'Macro'), profile.id);
    if (!macro) throw notFound('Dieses Macro gibt es nicht.', { en: 'No such macro.' });
    let started = 0;
    for (const accountId of targets(req, profile)) {
      const bot = supervisor.get(profile.id, accountId);
      if (bot?.online) {
        macroEngine.run(bot, macro);
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
    const profile = ownedProfile(req);
    const message = requireString(req.body?.message, 'Nachricht', { max: 256 });
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
        JSON.stringify((req.body?.accounts || []).map(Number)),
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
    const profile = ownedProfile(req);
    const spamId = requireInt(req.params.spamId, 'Eintrag');
    const row = db.prepare('SELECT * FROM spam WHERE id = ? AND profile_id = ?').get(spamId, profile.id);
    if (!row) throw notFound('Diesen Eintrag gibt es nicht.', { en: 'No such entry.' });
    const body = req.body || {};
    const set = [];
    const values = [];
    if (body.message !== undefined) {
      set.push('message = ?');
      values.push(requireString(body.message, 'Nachricht', { max: 256 }));
    }
    if (body.interval_sec !== undefined) {
      set.push('interval_sec = ?');
      values.push(requireInt(body.interval_sec, 'Intervall', { min: 5, max: 86400 }));
    }
    if (body.accounts !== undefined) {
      set.push('accounts = ?');
      values.push(JSON.stringify((body.accounts || []).map(Number)));
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
    const profile = ownedProfile(req);
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
    const profile = ownedProfile(req);
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
