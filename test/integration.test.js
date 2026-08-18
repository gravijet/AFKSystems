import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'afksystems-test-'));
process.env.DATA_DIR = TEST_DIR;
process.env.NODE_ENV = 'test';
process.env.SECRET = 'test-session-secret';
process.env.PUBLIC_URL = 'http://127.0.0.1';

const { db, setSetting } = await import('../server/db.js');
const billing = await import('../server/billing.js');
const roles = await import('../server/roles.js');
const oauth = await import('../server/oauth.js');
const binaries = await import('../server/binaries.js');
const tickets = await import('../server/tickets.js');
const { Tickets } = await import('../bot/handlers/tickets.js');
const { Bot, simpleChatMacro, parseEvent, parseView, ansiToMinecraft } = await import(
  '../server/supervisor.js'
);
const { parseFormatting } = await import('../public/assets/js/chatlog.js');
const { Roles } = await import('../bot/handlers/roles.js');
const { ChannelAccess } = await import('../bot/handlers/channelAccess.js');
const { Panel } = await import('../bot/panel.js');

let sequence = 0;
let serverProcess = null;

function createUser(overrides = {}) {
  sequence += 1;
  const email = overrides.email || `user${sequence}@example.test`;
  const username = overrides.username || `user${sequence}`;
  const info = db
    .prepare(
      `INSERT INTO users
        (email, username, password_hash, role, credits, language, email_verified, created_at)
       VALUES (?, ?, 'test', ?, ?, 'en', 1, ?)`
    )
    .run(email, username, overrides.role || 'user', overrides.credits || 0, Date.now());
  if (overrides.discordId) {
    db.prepare(
      `UPDATE users SET discord_id = ?, discord_name = ?, discord_guild_member = ?,
                        discord_guild_checked_at = ?, discord_moderator = ?,
                        discord_partner = ?, discord_vip = ? WHERE id = ?`
    ).run(
      overrides.discordId,
      username,
      overrides.member ? 1 : 0,
      overrides.checkedAt ?? Date.now(),
      overrides.moderator ? 1 : 0,
      overrides.partner ? 1 : 0,
      overrides.vip ? 1 : 0,
      info.lastInsertRowid
    );
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

function createProfile(user, plan, overrides = {}) {
  sequence += 1;
  const info = db
    .prepare(
      `INSERT INTO profiles
        (user_id, name, slug, host, mc_version, plan_id, paid_until, chat_limit, created_at)
       VALUES (?, ?, ?, 'mc.example.test', '26.1', ?, ?, ?, ?)`
    )
    .run(
      user.id,
      overrides.name || `Server ${sequence}`,
      overrides.slug || `server-${sequence}`,
      plan.id,
      plan.free_slot ? null : overrides.paidUntil || Date.now() + billing.MONTH_MS,
      plan.chat_limit,
      Date.now()
    );
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(info.lastInsertRowid);
}

function createAccount(user, overrides = {}) {
  sequence += 1;
  const info = db
    .prepare(
      `INSERT INTO mc_accounts (user_id, name, kind, status, created_at)
       VALUES (?, ?, 'offline', 'ok', ?)`
    )
    .run(user.id, overrides.name || `Player${sequence}`, Date.now());
  return db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(info.lastInsertRowid);
}

function createSession(user, token) {
  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(token, user.id, Date.now(), Date.now() + 60_000);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(base, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Panel exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Panel did not become healthy in time');
}

async function api(base, pathname, { token, method = 'GET', body, botSecret } = {}) {
  const headers = { 'accept-language': 'en' };
  if (token) headers.cookie = `afk_session=${token}`;
  if (botSecret) headers.authorization = `Bearer ${botSecret}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function browserSocket(base, token) {
  const socket = new WebSocket(base.replace(/^http/, 'ws') + '/api/ws', {
    headers: { cookie: `afk_session=${token}`, origin: base },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser WebSocket hello timed out')), 5_000);
    socket.once('message', (raw) => {
      clearTimeout(timer);
      const message = JSON.parse(raw.toString());
      if (message.type === 'hello') resolve();
      else reject(new Error('Browser WebSocket did not send hello'));
    });
    socket.once('error', reject);
  });
  return socket;
}

function nextTicketEvent(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Ticket WebSocket event timed out')), 5_000);
    const receive = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'ticket') return;
      clearTimeout(timer);
      socket.off('message', receive);
      resolve(message);
    };
    socket.on('message', receive);
  });
}

test('migration seeds the exact Premium feature list and Discord-bound Free plan', () => {
  const premium = billing.planBySlug('premium');
  assert.equal(premium.chat_limit, 50_000);
  assert.deepEqual(premium.features_de.split('\n'), [
    '5 Bots gleichzeitig auf diesem Server',
    'Bewegung, Anti-AFK, Schleichen',
    '50000 Zeilen Chatverlauf',
    'Scoreboard wie im Spiel',
    'Eigene Ausgangsadresse auf Anfrage',
    'Support mit Vorrang',
  ]);
  assert.match(billing.planBySlug('free').blurb_en, /linked Discord account/i);
  assert.equal(billing.freeGuildId(), '1538202840445485126');
  assert.ok(billing.planBySlug('ultra').chat_limit >= premium.chat_limit);
});

test('Free access fails closed for link, membership and stale checks', () => {
  const user = createUser();
  assert.equal(billing.freeAccess(user.id).reason, 'discord-link');

  db.prepare(
    'UPDATE users SET discord_id = ?, discord_guild_member = 0, discord_guild_checked_at = ? WHERE id = ?'
  ).run('200000000000000001', Date.now(), user.id);
  assert.equal(billing.freeAccess(user.id).reason, 'discord-join');

  db.prepare('UPDATE users SET discord_guild_member = 1 WHERE id = ?').run(user.id);
  assert.equal(billing.freeAccess(user.id).ok, true);
  assert.equal(
    billing.freeAccess(user.id, Date.now() + 121 * 60_000).reason,
    'discord-check'
  );
});

test('Admin and moderator are Linked Roles; Ultra includes Premium and staff receive Team', () => {
  setSetting('discord_role_customer', '10001');
  setSetting('discord_role_premium', '10002');
  setSetting('discord_role_ultra', '10003');
  setSetting('discord_role_partner', '10004');
  setSetting('discord_role_vip', '10005');
  setSetting('discord_role_team', '10006');
  setSetting('discord_role_admin', '19998');
  setSetting('discord_role_mod', '19999');

  const user = createUser({
    discordId: '200000000000000002',
    member: true,
    moderator: true,
    partner: true,
    vip: true,
  });
  const profile = createProfile(user, billing.planBySlug('ultra'));
  const target = roles.targetFor(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));

  assert.deepEqual(new Set(target.roles), new Set(['10001', '10002', '10003', '10004', '10005', '10006']));
  assert.equal(target.roles.includes('19998'), false);
  assert.equal(target.roles.includes('19999'), false);
  assert.deepEqual(
    new Set(target.badges),
    new Set(['customer', 'ultra', 'partner', 'vip', 'moderator', 'team'])
  );
  assert.equal(roles.managedIds().includes('10006'), true);
  assert.equal(roles.managedIds().includes('19998'), false);
  assert.equal(roles.managedIds().includes('19999'), false);
  assert.deepEqual(oauth.ROLE_METADATA.map((entry) => entry.key), ['administrator', 'discord_moderator']);
  assert.deepEqual(oauth.ROLE_METADATA.map((entry) => entry.description), ['Administrator', 'Discord Moderator']);
  assert.deepEqual(oauth.roleMetadataFor(user.id), { administrator: 0, discord_moderator: 1 });

  db.prepare('UPDATE profiles SET locked = 1 WHERE id = ?').run(profile.id);
  const suspended = roles.targetFor(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
  assert.equal(suspended.badges.includes('ultra'), false);
  assert.equal(suspended.roles.includes('10003'), false);

  db.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(Date.now() + 60_000, user.id);
  const manualPremium = roles.targetFor(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
  assert.equal(manualPremium.badges.includes('premium'), true);
  assert.equal(manualPremium.roles.includes('10002'), true);
});

test('Discord moderators may view public and role-based channels, never admin-only or member-only channels', () => {
  const access = new ChannelAccess({
    config: { roles: { team: '10006', admin: '19998', mod: '19999' } },
    client: { user: { id: '90000' } },
  });
  const guild = { roles: { everyone: { id: '10000' } } };
  const channel = ({ publicView = false, overwrites = [] } = {}) => ({
    permissionOverwrites: { cache: new Map(overwrites.map((entry) => [entry.id, entry])) },
    permissionsFor: () => ({ has: () => publicView }),
    isThread: () => false,
  });
  const role = (id) => ({ id, type: 0, allow: { has: () => true } }); // OverwriteType.Role
  const member = (id) => ({ id, type: 1, allow: { has: () => true } }); // OverwriteType.Member

  assert.equal(access.shouldGrant(channel({ publicView: true }), guild), true);
  assert.equal(access.shouldGrant(channel({ overwrites: [role('10002')] }), guild), true);
  assert.equal(access.shouldGrant(channel({ overwrites: [role('19998')] }), guild), false);
  assert.equal(access.shouldGrant(channel({ overwrites: [member('200000000000000002')] }), guild), false);
});

test('upgrading a Free server applies the full Premium chat-history allowance', () => {
  const user = createUser({ credits: 10_000 });
  const profile = createProfile(user, billing.planBySlug('free'));
  assert.equal(profile.chat_limit, 200);

  const upgraded = billing.setPlan(profile, billing.planBySlug('premium'));
  assert.equal(upgraded.chat_limit, 50_000);
});

test('Free membership is read from the configured required guild only', async () => {
  const calls = [];
  const linked = { discord_id: '200000000000000099', roles: [] };
  const mainMembers = new Map();
  const requiredMembers = new Map([[linked.discord_id, { id: linked.discord_id }]]);
  const bot = {
    config: {
      guild_id: '300000000000000001',
      free_guild_id: '300000000000000002',
      managed_roles: [],
    },
    guild: async () => ({ id: '300000000000000001', members: { fetch: async () => mainMembers } }),
    client: {
      guilds: {
        fetch: async (id) =>
          id === '300000000000000002'
            ? { id, members: { fetch: async () => requiredMembers } }
            : null,
      },
    },
    panel: {
      call: async (pathname, options) => {
        if (pathname === '/roles') return { users: [linked] };
        calls.push({ pathname, options });
        return { ok: true };
      },
    },
  };
  const discordRoles = new Roles(bot);
  await discordRoles.syncAll();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, '/memberships');
  assert.deepEqual(calls[0].options.body, {
    guild_id: '300000000000000002',
    members: [{ discord_id: linked.discord_id, present: true }],
  });

  await discordRoles.membership(linked.discord_id, false, '300000000000000001');
  assert.equal(calls.length, 1, 'an event from another guild must be ignored');
});

test('Discord role sync keeps roles on transport errors and removes replaced role IDs', async () => {
  const added = [];
  const removed = [];
  const member = {
    id: '200000000000000088',
    user: { bot: false, tag: 'RoleTest' },
    roles: {
      cache: new Map([['old-role', {}]]),
      add: async (ids) => added.push(...ids),
      remove: async (ids) => removed.push(...ids),
    },
  };
  const bot = {
    config: { managed_roles: ['old-role'] },
    panel: { call: async () => { throw new Error('temporary panel outage'); } },
  };
  const discordRoles = new Roles(bot);

  assert.equal(await discordRoles.sync(member), null);
  assert.deepEqual(removed, [], 'an unavailable panel must not revoke roles');

  const previous = discordRoles.configuredIds();
  bot.config = { managed_roles: ['new-role'] };
  const current = discordRoles.configuredIds();
  discordRoles.retire([...previous].filter((id) => !current.has(id)));
  await discordRoles.sync(member, { linked: true, roles: ['new-role'] });

  assert.deepEqual(added, ['new-role']);
  assert.deepEqual(removed, ['old-role']);
  discordRoles.clearRetired();
  assert.deepEqual([...discordRoles.managedIds()], ['new-role']);
});

test('a linked-account event refreshes Free guild membership immediately', async () => {
  const membershipCalls = [];
  const member = {
    id: '200000000000000077',
    user: { bot: false, tag: 'FreeMember' },
    roles: { cache: new Map(), add: async () => {}, remove: async () => {} },
  };
  const guild = { id: '300000000000000077', members: { fetch: async () => member } };
  const bot = {
    config: {
      guild_id: guild.id,
      free_guild_id: guild.id,
      managed_roles: [],
    },
    guild: async () => guild,
    client: { guilds: { fetch: async () => guild } },
    panel: {
      call: async (pathname, options) => {
        if (pathname.startsWith('/users/')) return { linked: true, roles: [] };
        membershipCalls.push({ pathname, options });
        return { ok: true };
      },
    },
  };

  await new Roles(bot).syncOne(member.id);
  assert.deepEqual(membershipCalls, [
    {
      pathname: '/memberships',
      options: {
        method: 'POST',
        body: {
          guild_id: guild.id,
          members: [{ discord_id: member.id, present: true }],
        },
      },
    },
  ]);
});

test('several One more bot add-ons are charged and applied in one booking', () => {
  const user = createUser({ credits: 10_000 });
  const premium = billing.planBySlug('premium');
  const profile = createProfile(user, premium);
  const addon = billing.addonByKey('slot');
  const before = billing.balance(user.id);
  const result = billing.addAddon(profile, addon, 3);

  assert.equal(result.qty, 3);
  assert.ok(result.charged > 0 && result.charged <= addon.price_credits * 3);
  assert.equal(billing.balance(user.id), before - result.charged);
  assert.equal(billing.featuresOf(profile).max_accounts, premium.max_accounts + addon.amount * 3);
  assert.throws(() => billing.addAddon(profile, addon, addon.max_qty), /höchstens|At most/);
});

test('new Rust build selection covers all released feature combinations', () => {
  const previous = binaries.state.builds;
  binaries.state.builds = Object.fromEntries(
    Object.entries(binaries.BUILDS).map(([key, build]) => [
      key,
      { present: true, caps: { ...build.features, events: true } },
    ])
  );
  try {
    assert.equal(binaries.buildFor({ movement: 0 }, { premium: 0, movement: 0 }), 'slim');
    assert.equal(binaries.buildFor({ movement: 1 }, { premium: 0, movement: 1 }), 'move');
    assert.equal(binaries.buildFor({}, { premium: 1, menus: 0 }), 'premium');
    assert.equal(binaries.buildFor({}, { premium: 1, menus: 1 }), 'premiumItems');
    assert.equal(binaries.buildFor({}, { premium: 1, menus: 1, pov: 1 }), 'ultra');
    assert.equal(binaries.buildFor({}, { slug: 'ultra', premium: 1, menus: 1, pov: 0 }), 'ultra');
    assert.equal(binaries.buildFor({}, { premium: 0, menus: 1 }), 'items');
    assert.equal(binaries.buildFor({}, { premium: 0, pov: 1 }), 'pov');
  } finally {
    binaries.state.builds = previous;
  }
});

test('coordinates, formatted Scoreboards and item menus are parsed without losing data', () => {
  assert.deepEqual(parseEvent('@event board titel §r§6My Board'), {
    type: 'board',
    text: 'titel §r§6My Board',
  });
  assert.deepEqual(parseView('position', ['x=-12.5  y=64.0  z=8.3  ·  Blick 90° (Westen) / -16°']), {
    empty: false,
    x: -12.5,
    y: 64,
    z: 8.3,
    yaw: 90,
    pitch: -16,
    text: 'x=-12.5  y=64.0  z=8.3  ·  Blick 90° (Westen) / -16°',
  });

  const formatted = parseFormatting('§x§1§2§3§4§5§6RGB §lbold');
  assert.equal(formatted[0].color, '#123456');
  assert.equal(formatted.at(-1).bold, true);
  const resetByRgb = parseFormatting('§lbold §x§1§2§3§4§5§6plain');
  assert.equal(resetByRgb.at(-1).bold, false);

  const emitted = [];
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('premium'));
  const bot = new Bot(
    { emit: (...args) => emitted.push(args), macros: {} },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );
  bot.onEvent('@event board titel §r§6My Board');
  bot.onEvent('@event board zeile wert=10 zahl=§x§f§f§0§0§0§010 text=§r§aRank: §6Player§r');
  bot.onEvent('@event board zeile wert=9 zahl= text=§r§bHidden number');
  assert.equal(bot.views.board.title, '§r§6My Board');
  assert.equal(bot.views.board.rows[0].number, '§x§f§f§0§0§0§010');
  assert.equal(bot.views.board.rows[0].text, '§r§aRank: §6Player§r');
  assert.equal(bot.views.board.rows[1].hidden, true);
  assert.equal(emitted.at(-1)[0], 'bot-view');

  bot.onEvent('@event menu open id=7 §6Server Shop');
  bot.beginCapture('menu');
  bot.onEvent('@event slot 3 2 §aEmerald');
  bot.onEvent('@event lore 3 §7Trade currency');
  bot.capture.lines.push('Server Shop', 'Fenster 7 · 27 Felder (0 bis 26)');
  bot.finishCapture();
  assert.equal(bot.views.menu.title, '§6Server Shop');
  assert.equal(bot.views.menu.slots, 27);
  assert.equal(bot.views.menu.items[3].name, '§aEmerald');
  assert.deepEqual(bot.views.menu.items[3].lore, ['§7Trade currency']);

  bot.proc = { stdin: { writable: true, write: () => {} } };
  assert.throws(() => bot.send(':pov live'), /geprüfte Befehlsfunktion/);
  assert.equal(simpleChatMacro([{ type: 'chat', text: ':pov live' }]), false);
});

test('chat colours survive the way from the client to the panel', () => {
  // Der Client schreibt Minecraft-Farben als ANSI. Ohne diese Rückübersetzung käme die Chatzeile
  // grau im Browser an – oder mit "[91m" als Text mittendrin.
  assert.equal(ansiToMinecraft('\u001b[91mHallo\u001b[0m Welt'), '§cHallo§r Welt');
  assert.equal(ansiToMinecraft('\u001b[92m\u001b[1mfett grün'), '§a§lfett grün');
  assert.equal(ansiToMinecraft('\u001b[38;2;255;0;64mHex'), '§x§f§f§0§0§4§0Hex');
  // Alles, was keine Farbe ist – Cursorbefehle der Live-Ansicht –, fällt weg.
  assert.equal(ansiToMinecraft('\u001b[2J\u001b[HText'), 'Text');
  assert.equal(ansiToMinecraft('ohne alles'), 'ohne alles');

  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('premium'));
  const bot = new Bot(
    { emit: () => {}, macros: { onChat: (_, line) => heard.push(line) } },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );
  const heard = [];
  bot.feed('out', Buffer.from('\u001b[93m[Rang] \u001b[97mSteve\u001b[0m: hallo\n', 'utf8'));
  const line = bot.chat.at(-1);
  assert.equal(line.type, 'chat');
  assert.equal(line.text, '§e[Rang] §fSteve§r: hallo');
  // Macros sehen den nackten Text – sonst fände "hallo" nichts mehr, sobald der Server färbt.
  assert.deepEqual(heard, ['[Rang] Steve: hallo']);
});

test('a POV frame becomes a picture and never lands in the chat', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('premium'));
  const views = [];
  const bot = new Bot(
    { emit: (type, payload) => type === 'bot-view' && views.push(payload), macros: { onChat: () => {} } },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );

  // Ohne angeforderte Ansicht ist jede Zeile gewöhnliche Ausgabe – die Erkennung kostet dann nichts.
  bot.feed('err', Buffer.from('\u001b[2J\u001b[H\u001b[38;2;10;20;30m###\n', 'utf8'));
  assert.equal(bot.views.pov, null);

  bot.povWanted = true;
  const before = bot.chat.length;
  const frame =
    '\u001b[2J\u001b[H\n' +
    '\u001b[38;2;10;20;30m..\u001b[38;2;200;30;40m##\n' +
    '\u001b[38;2;10;20;30m====\n' +
    'POV  x=12 y=64 z=-8  (:pov stop)\n';
  bot.feed('err', Buffer.from(frame, 'utf8'));

  assert.equal(bot.views.pov.empty, false);
  assert.equal(bot.views.pov.height, 2);
  assert.equal(bot.views.pov.width, 4);
  assert.deepEqual(bot.views.pov.rows[0], [['0a141e', '..'], ['c81e28', '##']]);
  assert.match(bot.views.pov.status, /^POV {2}x=12/);
  assert.equal(views.at(-1).kind, 'pov');
  // Und keine einzige Zeile des Bildes steht im Chatverlauf.
  assert.equal(bot.chat.length, before);

  // Eine Meldung, die genauso beginnt, ist trotzdem eine Meldung.
  bot.povSentAt = 0;
  bot.feed('err', Buffer.from('\u001b[2J\u001b[HLive-POV beendet.\n', 'utf8'));
  assert.equal(bot.chat.at(-1).text, 'Live-POV beendet.');
});

test('HTTP permissions, suspensions, plan fields and the Discord WebSocket work end to end', async () => {
  const BOT_SECRET = 'bot-test-secret';
  const USER_TOKEN = 'user-test-session';
  const ADMIN_TOKEN = 'admin-test-session';
  setSetting('discord_bot_secret', BOT_SECRET);

  const user = createUser({
    discordId: '200000000000000003',
    member: true,
    checkedAt: Date.now(),
  });
  const admin = createUser({ role: 'admin', discordId: '200000000000000004', member: true });
  createSession(user, USER_TOKEN);
  createSession(admin, ADMIN_TOKEN);
  const openTicket = tickets.create(user, {
    subject: 'Still open',
    category: 'general',
    body: 'Open body',
  });
  const closingTicket = tickets.create(user, {
    subject: 'Close through API',
    category: 'general',
    body: 'Close body',
  });
  const adminOwnTicket = tickets.create(admin, {
    subject: 'Admin needs support too',
    category: 'general',
    body: 'Personal support request',
  });
  tickets.reply(adminOwnTicket, admin, 'Internal team context', { internal: true, staff: true });
  assert.throws(
    () => tickets.reply(openTicket, user, 'A reply without an actor mode must fail.'),
    /explicit customer or staff mode/
  );
  const profile = createProfile(user, billing.freePlan());
  const account = createAccount(user, { name: 'SuspendMe' });
  db.prepare(
    'INSERT INTO profile_accounts (profile_id, account_id, wanted) VALUES (?, ?, 0)'
  ).run(profile.id, account.id);

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: TEST_DIR,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      PUBLIC_URL: base,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  serverProcess.stdout.on('data', (chunk) => (childOutput += chunk));
  serverProcess.stderr.on('data', (chunk) => (childOutput += chunk));
  await waitForHealth(base, serverProcess);

  const englishHome = await (await fetch(`${base}/en`)).text();
  const germanHome = await (await fetch(`${base}/de`)).text();
  assert.match(englishHome, /href="\/en"[^>]*aria-current="true"[^>]*>EN<\/a>/);
  assert.doesNotMatch(englishHome, /href="\/de"[^>]*aria-current="true"/);
  assert.match(germanHome, /href="\/de"[^>]*aria-current="true"[^>]*>DE<\/a>/);
  assert.doesNotMatch(germanHome, /href="\/en"[^>]*aria-current="true"/);
  assert.match(germanHome, /class="site-menu-toggle"[^>]*aria-expanded="false"/);
  assert.match(germanHome, /class="site-menu" id="site-menu"/);
  assert.doesNotMatch(germanHome, /class="hero-product"|play\.example\.net|Vorschau des AFKSystems-Panels/);
  assert.doesNotMatch(germanHome, /Live-Steuerung|class="hl"/);
  assert.doesNotMatch(englishHome, /Live control|class="hl"/);
  assert.doesNotMatch(germanHome, /\{\{[^}]+\}\}/);

  const appShell = await (await fetch(`${base}/en/app`)).text();
  assert.match(appShell, /class="mobile-nav" id="mobile-nav"/);
  assert.match(appShell, /id="side-backdrop"[^>]*aria-label="Close"/);
  assert.equal((await fetch(`${base}/en/app`)).headers.get('cache-control'), 'no-store');
  const homeResponse = await fetch(`${base}/en`);
  assert.equal(homeResponse.headers.get('x-frame-options'), 'DENY');
  assert.match(homeResponse.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(homeResponse.headers.get('content-security-policy'), /script-src[^;]*unsafe-inline/);
  assert.match(homeResponse.headers.get('permissions-policy'), /camera=\(\)/);
  const stylesheetPath = englishHome.match(/href="([^"]+\/css\/app\.css)"/)?.[1];
  assert.ok(stylesheetPath);
  // Inhaltsschutz: einzeln aufgerufen kommt die Datei nicht heraus, als Stylesheet einer Seite
  // schon. Genau das ist der Unterschied zwischen "Speichern unter" und "die Seite lädt".
  assert.equal((await fetch(`${base}${stylesheetPath}`)).status, 403);
  assert.equal(
    (await fetch(`${base}${stylesheetPath}`, { headers: { 'sec-fetch-dest': 'document' } })).status,
    403
  );
  const stylesheetResponse = await fetch(`${base}${stylesheetPath}`, {
    headers: { 'sec-fetch-dest': 'style' },
  });
  assert.equal(stylesheetResponse.status, 200);
  assert.equal(stylesheetResponse.headers.get('x-robots-tag'), 'noarchive, noimageindex');
  const stylesheet = await stylesheetResponse.text();
  assert.match(stylesheet, /\.mobile-nav\s*\{/);
  assert.match(stylesheet, /\.side-section\s*>\s*summary/);
  // Die schmale Schiene der Seitenleiste (früher: side-collapsed).
  assert.match(stylesheet, /body\.side-rail/);
  assert.match(stylesheet, /\.side-find/);
  assert.match(stylesheet, /@media \(max-width: 640px\)/);
  assert.match(stylesheet, /\.site-menu\.open/);

  const privacyResponse = await fetch(`${base}/de/privacy`);
  const privacy = await privacyResponse.text();
  assert.equal(privacyResponse.status, 200);
  assert.match(privacy, /<h2>1\. Verantwortlicher und Kontakt<\/h2>/);
  assert.match(privacy, /Art\. 6 Abs\. 1 lit\. b DSGVO/);
  const terms = await (await fetch(`${base}/en/terms`)).text();
  assert.match(terms, /<h2>5\. Prices, credits and renewal<\/h2>/);
  assert.equal((await fetch(`${base}/en/imprint`)).status, 404);
  assert.doesNotMatch(await (await fetch(`${base}/sitemap.xml`)).text(), /imprint/);

  const crossSite = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: `afk_session=${USER_TOKEN}`, origin: 'https://evil.example' },
  });
  assert.equal(crossSite.status, 403);

  for (const page of ['login', 'register']) {
    const html = await (await fetch(`${base}/en/${page}`)).text();
    assert.equal((html.match(/class="oauth-icon"/g) || []).length, 2);
    assert.doesNotMatch(html, /\{\{[^}]+\}\}/);
  }

  // "Support" ist auch für Admins persönlich. Fremde Tickets und interne Teamnotizen sind nur
  // über den separaten Admin-Bereich erreichbar; eine eigene Antwort bleibt eine Kundenantwort.
  const adminSupport = await api(base, '/api/tickets', { token: ADMIN_TOKEN });
  assert.equal(adminSupport.response.status, 200);
  assert.deepEqual(adminSupport.data.tickets.map((entry) => entry.id), [adminOwnTicket.id]);

  const foreignThroughSupport = await api(base, `/api/tickets/${openTicket.id}`, { token: ADMIN_TOKEN });
  assert.equal(foreignThroughSupport.response.status, 403);

  const ownThroughSupport = await api(base, `/api/tickets/${adminOwnTicket.id}`, { token: ADMIN_TOKEN });
  assert.equal(ownThroughSupport.response.status, 200);
  assert.equal(ownThroughSupport.data.messages.some((message) => message.internal), false);
  assert.equal(db.prepare('SELECT unread_staff FROM tickets WHERE id = ?').get(adminOwnTicket.id).unread_staff, 1);

  const throughAdminTab = await api(base, `/api/admin/tickets/${openTicket.id}`, { token: ADMIN_TOKEN });
  assert.equal(throughAdminTab.response.status, 200);
  assert.equal(throughAdminTab.data.ticket.id, openTicket.id);

  // Das Browser-Live-Ereignis trennt persönliche und Team-Warteschlange. So kann ein Admin bei
  // fremden Tickets keinen persönlichen „Meine Tickets“-Zähler mehr bekommen.
  const customerSocket = await browserSocket(base, USER_TOKEN);
  const staffSocket = await browserSocket(base, ADMIN_TOKEN);
  const customerEvent = nextTicketEvent(customerSocket);
  const staffEvent = nextTicketEvent(staffSocket);
  const customerReply = await api(base, `/api/tickets/${openTicket.id}/reply`, {
    token: USER_TOKEN,
    method: 'POST',
    body: { body: 'Reply from the customer side' },
  });
  assert.equal(customerReply.response.status, 200);
  assert.deepEqual((await customerEvent).audience, { customer: true, staff: false });
  assert.deepEqual((await staffEvent).audience, { customer: false, staff: true });
  customerSocket.close();
  staffSocket.close();

  const adminCustomerReply = await api(base, `/api/tickets/${adminOwnTicket.id}/reply`, {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { body: 'Reply from my personal support view' },
  });
  assert.equal(adminCustomerReply.response.status, 200);
  const lastOwnMessage = db
    .prepare('SELECT role, internal FROM ticket_messages WHERE ticket_id = ? ORDER BY id DESC LIMIT 1')
    .get(adminOwnTicket.id);
  assert.deepEqual(lastOwnMessage, { role: 'user', internal: 0 });

  const staffReply = await api(base, `/api/admin/tickets/${openTicket.id}/reply`, {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { body: 'Reply from the support queue' },
  });
  assert.equal(staffReply.response.status, 200);
  assert.equal(
    db.prepare('SELECT role FROM ticket_messages WHERE ticket_id = ? ORDER BY id DESC LIMIT 1').get(openTicket.id).role,
    'staff'
  );

  // Ein Admin kann im eigenen Ticket auch aus Discord als Kunde schreiben. Die Discord-ID muss
  // dabei im Bridge-Ereignis stehen, damit der Bot die bereits vorhandene Nachricht nicht erneut
  // als Embed in den gleichen Kanal zurückspiegelt.
  const discordOwnReply = await api(base, `/api/bot/tickets/${adminOwnTicket.id}/messages`, {
    botSecret: BOT_SECRET,
    method: 'POST',
    body: {
      discord_id: '300000000000000004',
      discord_user_id: admin.discord_id,
      author_name: 'Admin test',
      body: 'Reply from my own Discord ticket',
    },
  });
  assert.equal(discordOwnReply.response.status, 200);
  const discordOwnMessage = db
    .prepare('SELECT role, discord_id FROM ticket_messages WHERE ticket_id = ? ORDER BY id DESC LIMIT 1')
    .get(adminOwnTicket.id);
  assert.deepEqual(discordOwnMessage, { role: 'user', discord_id: '300000000000000004' });
  const relayed = [];
  await Tickets.prototype.onPanelMessage.call(
    {
      channelOf: async () => ({ id: 'ticket-channel' }),
      relayToDiscord: async (_channel, entry) => relayed.push(entry),
      reopenChannel: async () => {},
    },
    {
      ticket_id: adminOwnTicket.id,
      role: 'user',
      author: 'Admin test',
      body: 'Reply from my own Discord ticket',
      created_at: Date.now(),
      discord_id: '300000000000000004',
    }
  );
  assert.equal(relayed[0].discord_id, '300000000000000004');

  const refusedStatus = await api(base, `/api/tickets/${closingTicket.id}/status`, {
    token: USER_TOKEN,
    method: 'POST',
    body: { status: 'open' },
  });
  assert.equal(refusedStatus.response.status, 400);
  assert.equal(refusedStatus.data.error, 'You cannot set that status.');

  const closedStatus = await api(base, `/api/tickets/${closingTicket.id}/status`, {
    token: USER_TOKEN,
    method: 'POST',
    body: { status: 'closed' },
  });
  assert.equal(closedStatus.response.status, 200);
  assert.equal(closedStatus.data.ticket.status, 'closed');

  const userInfo = await api(base, `/api/admin/users/${user.id}?lang=en`, { token: ADMIN_TOKEN });
  assert.equal(userInfo.response.status, 200);
  assert.deepEqual(userInfo.data.tickets.map((entry) => entry.id), [openTicket.id]);

  const premium = billing.planBySlug('premium');
  const premiumFeatures = premium.features_de;
  const savedPlan = await api(base, `/api/admin/plans/${premium.id}`, {
    token: ADMIN_TOKEN,
    method: 'PATCH',
    body: { features_de: premiumFeatures, features_en: premium.features_en },
  });
  assert.equal(savedPlan.response.status, 200);
  assert.equal(savedPlan.data.plan.features_de, premiumFeatures);

  // Örtliche Client-Befehle dürfen nicht als Chatzeile hineinrutschen: Was mit ':' anfängt, geht
  // durch dieselbe Prüfung wie der Befehlsendpunkt, und was dort nicht steht, gibt es nicht.
  // (':pov' steht dort inzwischen – deshalb hier ein Verb, das es wirklich nicht gibt.)
  const blockedLocalBypass = await api(base, `/api/profiles/${profile.id}/chat`, {
    token: USER_TOKEN,
    method: 'POST',
    body: { text: ':teleport 0 64 0', accounts: [account.id] },
  });
  assert.equal(blockedLocalBypass.response.status, 400);
  assert.equal(blockedLocalBypass.data.error, 'Unknown local command "teleport".');

  db.prepare(
    'UPDATE profile_accounts SET wanted = 1 WHERE profile_id = ? AND account_id = ?'
  ).run(profile.id, account.id);
  const suspendedAccount = await api(base, `/api/admin/accounts/${account.id}/suspension`, {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { suspended: true, reason: 'Test suspension' },
  });
  assert.equal(suspendedAccount.response.status, 200);
  assert.equal(db.prepare('SELECT suspended FROM mc_accounts WHERE id = ?').get(account.id).suspended, 1);
  assert.equal(
    db.prepare('SELECT wanted FROM profile_accounts WHERE account_id = ?').get(account.id).wanted,
    0
  );

  const accountList = await api(base, '/api/admin/accounts', { token: ADMIN_TOKEN });
  assert.equal(accountList.response.status, 200);
  const listedAccount = accountList.data.accounts.find((entry) => entry.id === account.id);
  assert.ok(listedAccount);
  assert.equal(listedAccount.suspended, true);
  assert.equal(listedAccount.suspend_reason, 'Test suspension');
  assert.deepEqual(listedAccount.servers, [{ id: profile.id, name: profile.name }]);
  assert.equal(listedAccount.running, 0);
  assert.equal(listedAccount.online, 0);

  const suspendedServer = await api(base, `/api/admin/servers/${profile.id}/lock`, {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { locked: true, reason: 'Server test' },
  });
  assert.equal(suspendedServer.response.status, 200);
  assert.equal(db.prepare('SELECT locked FROM profiles WHERE id = ?').get(profile.id).locked, 1);

  const lockedChat = await api(base, `/api/profiles/${profile.id}/chat`, {
    token: USER_TOKEN,
    method: 'POST',
    body: { text: '/list', accounts: [account.id] },
  });
  assert.equal(lockedChat.response.status, 403);

  db.prepare(
    `UPDATE users SET discord_guild_member = 1, discord_guild_checked_at = ? WHERE id = ?`
  ).run(Date.now(), user.id);
  db.prepare(
    'UPDATE profile_accounts SET wanted = 1 WHERE profile_id = ? AND account_id = ?'
  ).run(profile.id, account.id);
  const membership = await api(base, '/api/bot/memberships', {
    botSecret: BOT_SECRET,
    method: 'POST',
    body: {
      guild_id: '1538202840445485126',
      members: [{ discord_id: user.discord_id, present: false }],
    },
  });
  assert.equal(membership.response.status, 200);
  assert.equal(db.prepare('SELECT discord_guild_member FROM users WHERE id = ?').get(user.id).discord_guild_member, 0);
  assert.equal(
    db.prepare('SELECT wanted FROM profile_accounts WHERE account_id = ?').get(account.id).wanted,
    0
  );

  const configResponse = await api(base, '/api/bot/config', { botSecret: BOT_SECRET });
  assert.equal(configResponse.response.status, 200);
  assert.equal(configResponse.data.free_guild_id, '1538202840445485126');
  assert.ok(configResponse.data.categories.every((entry) => !/[äöüß]/i.test(entry.label)));

  const hello = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/bot/stream`, {
      headers: { authorization: `Bearer ${BOT_SECRET}` },
    });
    const timer = setTimeout(() => reject(new Error('WebSocket hello timed out')), 5_000);
    socket.once('message', (raw) => {
      clearTimeout(timer);
      const message = JSON.parse(raw.toString());
      socket.close();
      resolve(message);
    });
    socket.once('error', reject);
  });
  assert.equal(hello.type, 'hello');

  // Exercise the exact connector used by the Discord service, not just a generic WebSocket.
  const panel = new Panel({ url: base, secret: BOT_SECRET });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Discord panel connector timed out')), 5_000);
    panel.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
    panel.connect();
  });
  assert.equal(panel.socket.readyState, WebSocket.OPEN);
  panel.close();

  const unauthorized = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/bot/stream`, {
      headers: { authorization: 'Bearer wrong' },
    });
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once('open', () => reject(new Error('Unauthorized WebSocket unexpectedly opened')));
    socket.once('error', () => {});
  });
  assert.equal(unauthorized, 401);

  for (const filename of ['nginx-afksystems.de.conf', 'nginx-afksystems.de-ssl.conf']) {
    const nginx = fs.readFileSync(path.join(ROOT, 'deploy', filename), 'utf8');
    assert.match(nginx, /location = \/api\/bot\/stream/);
    assert.match(nginx, /proxy_set_header\s+Upgrade \$http_upgrade/);
    assert.match(nginx, /proxy_set_header\s+Authorization \$http_authorization/);
  }

  assert.doesNotMatch(childOutput, /Unexpected server response: 404/);
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3_000);
      serverProcess.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  db.close();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});
