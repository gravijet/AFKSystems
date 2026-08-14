// Serverprofile und alles, was daran hängt: Konten zuordnen, Bots starten/stoppen, Chat lesen und
// schreiben, Bewegung steuern, Macros und Spam pflegen.

import express from 'express';
import { db, audit } from '../db.js';
import { requireUser } from '../auth.js';
import { supervisor } from '../supervisor.js';
import { macros as macroEngine, ACTIONS } from '../macros.js';
import * as binaries from '../binaries.js';
import { wrap, requireString, requireInt, bad, notFound, parseAddress, slugify, HttpError } from '../util.js';

export const router = express.Router();
router.use(requireUser);

// ---------------------------------------------------------------- Hilfen

function ownedProfile(req) {
  const id = requireInt(req.params.id, 'Profil');
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!profile) throw notFound('Dieses Serverprofil gibt es nicht.');
  return profile;
}

function ownedAccount(req, accountId) {
  const account = db
    .prepare('SELECT * FROM mc_accounts WHERE id = ? AND user_id = ?')
    .get(requireInt(accountId, 'Konto'), req.user.id);
  if (!account) throw notFound('Dieses Konto gibt es nicht.');
  return account;
}

/** Die Konten eines Profils samt aktuellem Bot-Zustand. */
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
      head: `https://minotar.net/helm/${encodeURIComponent(row.uuid || row.name)}/64.png`,
    };
  });
}

function profileView(profile) {
  const members = membersOf(profile);
  return {
    ...profile,
    auto_reconnect: Boolean(profile.auto_reconnect),
    movement: Boolean(profile.movement),
    anti_afk: JSON.parse(profile.anti_afk || '{}'),
    address: profile.port ? `${profile.host}:${profile.port}` : profile.host,
    accounts: members,
    online: members.filter((member) => member.online).length,
    total: members.length,
    movement_ready: binaries.supportsMovement(profile),
  };
}

/** Aus dem Wunsch "diese Konten" eine geprüfte Liste machen; leer = alle des Profils. */
function targets(req, profile) {
  const wanted = Array.isArray(req.body?.accounts) ? req.body.accounts.map(Number) : [];
  const members = db
    .prepare('SELECT account_id FROM profile_accounts WHERE profile_id = ?')
    .all(profile.id)
    .map((row) => row.account_id);
  const list = wanted.length ? members.filter((id) => wanted.includes(id)) : members;
  if (!list.length) throw bad('Keine passenden Konten in diesem Profil.');
  return list;
}

// ---------------------------------------------------------------- Profile

router.get(
  '/',
  wrap((req, res) => {
    const rows = db
      .prepare('SELECT * FROM profiles WHERE user_id = ? ORDER BY ordinal, id')
      .all(req.user.id);
    res.json({ profiles: rows.map(profileView) });
  })
);

router.post(
  '/',
  wrap((req, res) => {
    const body = req.body || {};
    const name = requireString(body.name, 'Name', { max: 40 });
    const { host, port } = parseAddress(body.address);
    const version = String(body.mc_version || binaries.state.defaultVersion);
    if (binaries.state.versions.length && !binaries.state.versions.includes(version)) {
      throw bad(`Version "${version}" kann der Client nicht. Möglich: ${binaries.state.versions.join(', ')}`);
    }

    let slug = slugify(name);
    let suffix = 1;
    while (db.prepare('SELECT 1 FROM profiles WHERE user_id = ? AND slug = ?').get(req.user.id, slug)) {
      slug = `${slugify(name)}-${++suffix}`;
    }

    const max = db.prepare('SELECT MAX(ordinal) AS m FROM profiles WHERE user_id = ?').get(req.user.id).m;
    const info = db
      .prepare(
        `INSERT INTO profiles (user_id, name, slug, host, port, mc_version, runtime, ordinal, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        name,
        slug,
        host,
        port,
        version,
        body.runtime === 'java' ? 'java' : 'rust',
        (max ?? 0) + 1,
        Date.now()
      );

    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(info.lastInsertRowid);
    // Konten gleich mitnehmen, wenn welche mitgeschickt wurden.
    for (const accountId of Array.isArray(body.accounts) ? body.accounts : []) {
      const account = ownedAccount(req, accountId);
      db.prepare(
        'INSERT OR IGNORE INTO profile_accounts (profile_id, account_id, ordinal) VALUES (?, ?, 0)'
      ).run(profile.id, account.id);
    }
    audit(req.user.id, 'profile-create', { name, host, port });
    res.json({ profile: profileView(profile) });
  })
);

router.get(
  '/:id',
  wrap((req, res) => {
    res.json({ profile: profileView(ownedProfile(req)) });
  })
);

router.patch(
  '/:id',
  wrap((req, res) => {
    const profile = ownedProfile(req);
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
        throw bad(`Version "${version}" kann der Client nicht.`);
      }
      put('mc_version', version);
    }
    if (body.runtime !== undefined) put('runtime', body.runtime === 'java' ? 'java' : 'rust');
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
    if (body.auto_reconnect !== undefined) put('auto_reconnect', body.auto_reconnect ? 1 : 0);
    if (body.movement !== undefined) put('movement', body.movement ? 1 : 0);
    if (body.color !== undefined) put('color', String(body.color).slice(0, 20));
    if (body.anti_afk !== undefined) put('anti_afk', JSON.stringify(body.anti_afk || {}));
    if (body.ordinal !== undefined) put('ordinal', requireInt(body.ordinal, 'Reihenfolge', { max: 999 }));

    if (!set.length) throw bad('Nichts zu ändern.');
    values.push(profile.id);
    db.prepare(`UPDATE profiles SET ${set.join(', ')} WHERE id = ?`).run(...values);

    const fresh = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id);
    // Einstellungen greifen erst beim nächsten Start – das sagt das Panel auch so.
    const running = membersOf(fresh).some((member) => member.state !== 'offline');
    res.json({ profile: profileView(fresh), restart_needed: running });
  })
);

router.delete(
  '/:id',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    for (const member of membersOf(profile)) supervisor.stop(profile.id, member.account_id);
    db.prepare('DELETE FROM profiles WHERE id = ?').run(profile.id);
    audit(req.user.id, 'profile-delete', { name: profile.name });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- Konten im Profil

router.post(
  '/:id/accounts',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const ids = Array.isArray(req.body?.accounts) ? req.body.accounts : [req.body?.account_id];
    for (const raw of ids) {
      const account = ownedAccount(req, raw);
      db.prepare(
        `INSERT INTO profile_accounts (profile_id, account_id, note, ordinal)
         VALUES (?, ?, ?, 0) ON CONFLICT(profile_id, account_id) DO NOTHING`
      ).run(profile.id, account.id, req.body?.note || null);
    }
    res.json({ profile: profileView(profile) });
  })
);

router.patch(
  '/:id/accounts/:accountId',
  wrap((req, res) => {
    const profile = ownedProfile(req);
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
      const proxyId = body.proxy_id ? requireInt(body.proxy_id, 'Proxy') : null;
      if (proxyId && !db.prepare('SELECT 1 FROM proxies WHERE id = ? AND user_id = ?').get(proxyId, req.user.id)) {
        throw notFound('Diesen Proxy gibt es nicht.');
      }
      db.prepare('UPDATE profile_accounts SET proxy_id = ? WHERE profile_id = ? AND account_id = ?').run(
        proxyId,
        profile.id,
        account.id
      );
    }
    res.json({ profile: profileView(profile) });
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
    res.json({ profile: profileView(profile) });
  })
);

// ---------------------------------------------------------------- Starten / Stoppen

router.post(
  '/:id/start',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const results = [];
    for (const accountId of targets(req, profile)) {
      const account = db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(accountId);
      try {
        results.push({ account_id: accountId, ok: true, bot: supervisor.start({ profile, account, user }) });
      } catch (error) {
        results.push({
          account_id: accountId,
          ok: false,
          error: error.message,
          status: error instanceof HttpError ? error.status : 500,
        });
      }
    }
    res.json({ results, profile: profileView(profile) });
  })
);

router.post(
  '/:id/stop',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    for (const accountId of targets(req, profile)) supervisor.stop(profile.id, accountId);
    res.json({ profile: profileView(profile) });
  })
);

router.post(
  '/:id/restart',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const list = targets(req, profile);
    for (const accountId of list) supervisor.stop(profile.id, accountId, { keepWanted: true });
    // Kurz warten, damit der alte Prozess wirklich weg ist, bevor der neue startet.
    setTimeout(() => {
      for (const accountId of list) {
        const account = db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(accountId);
        try {
          supervisor.start({ profile, account, user });
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
    res.json({ lines: lines.slice(-1000), now: Date.now() });
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
        if (!bot) throw new HttpError(409, 'Der Bot läuft gerade nicht.');
        bot.send(text);
        results.push({ account_id: accountId, ok: true });
      } catch (error) {
        results.push({ account_id: accountId, ok: false, error: error.message });
      }
    }
    res.json({ results });
  })
);

// ---------------------------------------------------------------- Bewegung

const MOVE_VERBS = new Set(['go', 'look', 'jump', 'fall', 'home', 'route', 'stop', 'pos']);

router.post(
  '/:id/move',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const verb = String(req.body?.verb || '').toLowerCase();
    if (!MOVE_VERBS.has(verb)) throw bad(`Unbekannter Bewegungsbefehl "${verb}".`);
    if (!binaries.supportsMovement(profile)) {
      throw new HttpError(
        409,
        profile.movement
          ? 'Die Bewegungs-Bauform des Clients liegt nicht auf dem Server (siehe scripts/build-movement.sh).'
          : 'Für dieses Profil ist Bewegung nicht eingeschaltet.'
      );
    }
    const arg = String(req.body?.arg || '').slice(0, 60);
    const results = [];
    for (const accountId of targets(req, profile)) {
      const bot = supervisor.get(profile.id, accountId);
      try {
        if (!bot) throw new HttpError(409, 'Der Bot läuft gerade nicht.');
        bot.move(verb, arg);
        results.push({ account_id: accountId, ok: true });
      } catch (error) {
        results.push({ account_id: accountId, ok: false, error: error.message });
      }
    }
    res.json({ results });
  })
);

// ---------------------------------------------------------------- Macros

const ACTION_TYPES = new Set(ACTIONS.map((action) => action.type));

function cleanActions(input) {
  if (!Array.isArray(input)) throw bad('Die Schrittliste fehlt.');
  if (input.length > 40) throw bad('Höchstens 40 Schritte je Macro.');
  return input.map((raw) => {
    const type = String(raw?.type || '');
    if (!ACTION_TYPES.has(type)) throw bad(`Unbekannter Schritt "${type}".`);
    const action = { type };
    if (raw.delay) action.delay = requireInt(raw.delay, 'Verzögerung', { max: 3600 });
    if (type === 'chat') action.text = requireString(raw.text, 'Text', { max: 256 });
    if (type === 'wait') action.seconds = requireInt(raw.seconds, 'Sekunden', { min: 1, max: 3600 });
    if (type === 'move') {
      action.direction = ['vor', 'zurück', 'links', 'rechts'].includes(raw.direction) ? raw.direction : 'vor';
      action.blocks = requireInt(raw.blocks ?? 1, 'Blöcke', { min: 1, max: 64 });
    }
    if (type === 'look') {
      action.yaw = requireInt(raw.yaw ?? 0, 'Yaw', { min: -180, max: 180 });
      action.pitch = requireInt(raw.pitch ?? 0, 'Pitch', { min: -90, max: 90 });
    }
    return action;
  });
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
    });
  })
);

router.post(
  '/:id/macros',
  wrap((req, res) => {
    const profile = ownedProfile(req);
    const body = req.body || {};
    const name = requireString(body.name, 'Name', { max: 60 });
    const event = ['join', 'timer', 'chat', 'world', 'death', 'disconnect'].includes(body.event) ? body.event : 'join';
    const actions = cleanActions(body.actions);
    const info = db
      .prepare(
        `INSERT INTO macros (profile_id, name, event, config, actions, accounts, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        profile.id,
        name,
        event,
        JSON.stringify(body.config || {}),
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
    if (!macro) throw notFound('Dieses Macro gibt es nicht.');
    const body = req.body || {};
    const set = [];
    const values = [];
    if (body.name !== undefined) {
      set.push('name = ?');
      values.push(requireString(body.name, 'Name', { max: 60 }));
    }
    if (body.event !== undefined) {
      set.push('event = ?');
      values.push(['join', 'timer', 'chat', 'world', 'death', 'disconnect'].includes(body.event) ? body.event : 'join');
    }
    if (body.config !== undefined) {
      set.push('config = ?');
      values.push(JSON.stringify(body.config || {}));
    }
    if (body.actions !== undefined) {
      set.push('actions = ?');
      values.push(JSON.stringify(cleanActions(body.actions)));
    }
    if (body.accounts !== undefined) {
      set.push('accounts = ?');
      values.push(JSON.stringify((body.accounts || []).map(Number)));
    }
    if (body.enabled !== undefined) {
      set.push('enabled = ?');
      values.push(body.enabled ? 1 : 0);
    }
    if (!set.length) throw bad('Nichts zu ändern.');
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
    if (!macro) throw notFound('Dieses Macro gibt es nicht.');
    let started = 0;
    for (const accountId of targets(req, profile)) {
      const bot = supervisor.get(profile.id, accountId);
      if (bot?.online) {
        macroEngine.run(bot, macro);
        started += 1;
      }
    }
    if (!started) throw new HttpError(409, 'Kein Bot dieses Profils ist gerade im Spiel.');
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
    if (!row) throw notFound('Diesen Eintrag gibt es nicht.');
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
    if (!set.length) throw bad('Nichts zu ändern.');
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
    if (!row) throw notFound('Diesen Eintrag gibt es nicht.');
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
    if (!sent) throw new HttpError(409, 'Kein Bot dieses Profils ist gerade im Spiel.');
    res.json({ sent });
  })
);
