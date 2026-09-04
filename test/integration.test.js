import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'afksystems-test-'));
process.env.DATA_DIR = TEST_DIR;
process.env.NODE_ENV = 'test';
process.env.SECRET = 'test-session-secret';
process.env.PUBLIC_URL = 'http://127.0.0.1';

const { db, cached, prepareOnce, setSetting } = await import('../server/db.js');
const assets = await import('../server/assets.js');
const strings = await import('../server/strings.js');
const { t, S } = await import('../public/assets/js/i18n.js');
const billing = await import('../server/billing.js');
const stripe = await import('../server/stripe.js');
const vat = await import('../server/vat.js');
const roles = await import('../server/roles.js');
const security = await import('../server/security.js');
const backup = await import('../server/backup.js');
const oauth = await import('../server/oauth.js');
const binaries = await import('../server/binaries.js');
const resources = await import('../server/resources.js');
const snapshots = await import('../server/snapshots.js');
const tickets = await import('../server/tickets.js');
const { Tickets, resolveMentions } = await import('../bot/handlers/tickets.js');
const { Bot, supervisor, simpleChatMacro, disconnectText, parseEvent, parseView, ansiToMinecraft, POV_SIZE, POV_FPS } =
  await import('../server/supervisor.js');
const { macros: macroEngine } = await import('../server/macros.js');
const notify = await import('../server/notify.js');
const auth = await import('../server/auth.js');
const logincode = await import('../server/logincode.js');
const totp = await import('../server/totp.js');
const qr = await import('../server/qr.js');
const profile = await import('../server/profile.js');
const account = await import('../server/account.js');
const receipt = await import('../server/receipt.js');
const schedules = await import('../server/schedules.js');
const systemreport = await import('../server/systemreport.js');
const exportCsv = await import('../server/export.js');
const { hashPassword, formatCredits, formatDay, formatEuro, slidingWindow } = await import('../server/util.js');
const { renderDiscord } = await import('../public/assets/js/discord.js');
const { staffTodos } = await import('../server/todos.js');
const { parseFormatting, mergeLines, WINDOW_MS } = await import('../public/assets/js/chatlog.js');
const { Roles } = await import('../bot/handlers/roles.js');
const { ChannelAccess } = await import('../bot/handlers/channelAccess.js');
const { Panel } = await import('../bot/panel.js');
const linkedRoles = await import('../server/linked-roles.js');

let sequence = 0;
let serverProcess = null;

/**
 * Etwas, das die Prüfung in resources.js für eine Client-JAR hält.
 *
 * Eine echte wäre siebenundzwanzig Megabyte groß und gehört Mojang. Geprüft wird ohnehin nur, was
 * hier steht: die ZIP-Kennung am Anfang und die beiden Verzeichnisse, aus denen der Viewer liest.
 */
const fakeClientJar = () =>
  Buffer.concat([
    Buffer.from('PK'),
    Buffer.alloc(1024, 0x20),
    Buffer.from('assets/minecraft/textures/block/stone.png'),
    Buffer.from('assets/minecraft/models/block/stone.json'),
  ]);

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

/**
 * Ein Serverplatz, wie `billing.setPlan` ihn hinterlässt.
 *
 * `paidCredits` sagt, was für die laufende Periode wirklich abgebucht wurde – ohne Angabe der
 * Monatspreis des Tarifs, denn genau das tut eine gewöhnliche Buchung. Wer den Fall "von der
 * Verwaltung geschenkt" prüfen will, übergibt ausdrücklich 0.
 */
function createProfile(user, plan, overrides = {}) {
  sequence += 1;
  const info = db
    .prepare(
      `INSERT INTO profiles
        (user_id, name, slug, host, mc_version, plan_id, paid_until, paid_credits, chat_limit, created_at)
       VALUES (?, ?, ?, 'mc.example.test', '26.1', ?, ?, ?, ?, ?)`
    )
    .run(
      user.id,
      overrides.name || `Server ${sequence}`,
      overrides.slug || `server-${sequence}`,
      plan.id,
      plan.free_slot ? null : overrides.paidUntil || Date.now() + billing.MONTH_MS,
      plan.free_slot ? 0 : (overrides.paidCredits ?? plan.price_credits),
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

async function api(base, pathname, { token, method = 'GET', body, botSecret, origin = base } = {}) {
  const headers = { 'accept-language': 'en' };
  if (token) headers.cookie = `afk_session=${token}`;
  if (botSecret) headers.authorization = `Bearer ${botSecret}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  // Das Panel ist die einzige Oberfläche dieser API, und ein Browser schickt bei jeder
  // schreibenden Anfrage einen Origin mit. Der Test tut dasselbe – sonst prüfte er einen Client,
  // den es nicht gibt. Dass ein Aufruf *ohne* diesen Nachweis abgelehnt wird, steht weiter unten
  // als eigene Zusicherung.
  if (origin) headers.origin = origin;
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
  // Ohne eigene Einstellung gilt weiterhin genau das, was früher fest im Quelltext stand.
  assert.deepEqual(oauth.roleMetadataFields().map((entry) => entry.key), [
    'administrator',
    'discord_moderator',
  ]);
  // Der Name ist das, was Discord im Rollen-Dialog als Bedingung anzeigt: genau der Rollenname,
  // ohne Marke davor. Den Namen der Anwendung setzt Discord selbst davor.
  assert.deepEqual(oauth.roleMetadataFields().map((entry) => entry.name), [
    'Administrator',
    'Discord Moderator',
  ]);
  assert.ok(oauth.roleMetadataFields().every((entry) => entry.description && entry.description !== entry.name));
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

test('Linked-role requirements are configurable and only publish values that fit their comparison', () => {
  const user = createUser({ discordId: '200000000000000042', member: true });
  const plan = billing.planBySlug('ultra');
  createProfile(user, plan);

  const fail = (message, alt) => Object.assign(new Error(message), alt);

  // Ein Schlüssel, den Discord nicht annimmt, darf gar nicht erst gespeichert werden.
  assert.throws(() => linkedRoles.validate([{ key: 'Groß!', source: 'premium', type: 7 }], { fail }));
  // Eine Zahl lässt sich nicht mit "ist Ja" vergleichen – sonst stünde in Discord eine Bedingung,
  // die nie zutrifft.
  assert.throws(() => linkedRoles.validate([{ key: 'credits', source: 'credits', type: 7 }], { fail }));
  // Derselbe Schlüssel zweimal wäre bei Discord ein Feld, das sich selbst überschreibt.
  assert.throws(() =>
    linkedRoles.validate(
      [
        { key: 'premium', source: 'premium', type: 7 },
        { key: 'premium', source: 'ultra', type: 7 },
      ],
      { fail }
    )
  );
  // Mehr als fünf nimmt Discord nicht an.
  assert.throws(() =>
    linkedRoles.validate(
      linkedRoles.SOURCES.slice(0, 6).map((entry) => ({
        key: entry.key,
        source: entry.key,
        type: entry.kind === 'boolean' ? 7 : entry.kind === 'date' ? 6 : 2,
      })),
      { fail }
    )
  );

  setSetting(
    'discord_role_metadata',
    linkedRoles.validate(
      [
        { key: 'paid', source: 'premium', type: 7, name: 'Kunde', description: 'Bezahlt gerade.' },
        { key: 'slots', source: 'paid_servers', type: 2, name: 'Serverplätze' },
        { key: 'seit', source: 'member_since', type: 6, name: 'Dabei seit' },
      ],
      { fail }
    )
  );

  assert.deepEqual(oauth.roleMetadataFields().map((entry) => entry.key), ['paid', 'slots', 'seit']);
  // Ohne eigene Beschreibung springt die der Quelle ein: eine Bedingung ohne Zeile darunter
  // erklärt im Rollen-Dialog gar nichts.
  assert.ok(oauth.roleMetadataFields().every((entry) => entry.description));

  const values = oauth.roleMetadataFor(user.id);
  assert.deepEqual(Object.keys(values), ['paid', 'slots', 'seit']);
  assert.equal(values.paid, 1);
  assert.equal(values.slots, 1);
  assert.equal(String(values.seit), new Date(user.created_at).toISOString());

  // Eine leere Liste ist eine Aussage und keine fehlende Einstellung: Discord räumt dann auf.
  setSetting('discord_role_metadata', []);
  assert.deepEqual(oauth.roleMetadataFields(), []);
  assert.deepEqual(oauth.roleMetadataFor(user.id), {});

  db.prepare('DELETE FROM settings WHERE key = ?').run('discord_role_metadata');
  assert.deepEqual(oauth.roleMetadataFields().map((entry) => entry.key), [
    'administrator',
    'discord_moderator',
  ]);
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

test('a long-extended slot never refunds more than one month', () => {
  const user = createUser({ credits: 10_000 });
  const premium = billing.planBySlug('premium');
  // So sieht ein Platz aus, dessen Laufzeit ein Administrator um ein Jahr verlängert hat
  // (admin.patch /profiles/:id, bis zu 3650 Tage). Bezahlt ist trotzdem je 30 Tage.
  const profile = createProfile(user, premium, {
    paidUntil: Date.now() + 365 * 86_400_000,
  });
  const refund = billing.refundValue(profile);
  assert.ok(refund > 0);
  assert.ok(
    refund <= premium.price_credits,
    `Restwert ${refund} darf den Monatspreis ${premium.price_credits} nicht übersteigen`
  );

  // Und die Probe aufs Exempel: Löschen darf kein Guthaben erzeugen.
  const before = billing.balance(user.id);
  billing.move(user.id, billing.refundValue(profile), 'refund', 'Test');
  assert.ok(billing.balance(user.id) - before <= premium.price_credits);
});

test('a slot the staff handed out for free never turns into credits', () => {
  const user = createUser({ credits: 0 });
  const ultra = billing.planBySlug('ultra');
  // Genau das, was `PATCH /admin/profiles/:id` tut: Laufzeit und Tarif setzen, **ohne Abbuchung**.
  const profile = createProfile(user, ultra, {
    paidUntil: Date.now() + billing.MONTH_MS,
    paidCredits: 0,
  });

  assert.equal(billing.refundValue(profile), 0, 'geschenkte Laufzeit ist kein Guthaben');

  // Und dasselbe für einen Zusatz, den die Verwaltung von Hand auf den Platz gelegt hat.
  const addon = billing.addonByKey('pov');
  db.prepare(
    'INSERT INTO profile_addons (profile_id, addon_id, qty, paid_credits, created_at) VALUES (?, ?, 1, 0, ?)'
  ).run(profile.id, addon.id, Date.now());
  assert.equal(billing.refundValue(profile), 0, 'ein geschenkter Zusatz ist ebenfalls kein Guthaben');

  // Der Tarifwechsel ist derselbe Weg: Er schreibt den Restwert gut, bevor er abbucht. Für einen
  // geschenkten Platz ist dieser Restwert null – abgebucht wird also der volle neue Monatspreis
  // samt der Zusätze, die mitgehen.
  billing.grant(user.id, 10_000, 'admin', 'Test');
  const before = billing.balance(user.id);
  const premium = billing.planBySlug('premium');
  billing.setPlan(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id), premium);
  assert.equal(
    billing.balance(user.id),
    before - (premium.price_credits + addon.price_credits),
    'beim Wechsel kommt für Geschenktes nichts zurück'
  );
});

test('what was really paid comes back, and never more than that', () => {
  const user = createUser({ credits: 10_000 });
  const premium = billing.planBySlug('premium');
  const profile = createProfile(user, premium);
  // Ein voller Monat steht noch offen, also ist der Restwert der volle Monatspreis – abgerundet
  // auf den Bruchteil einer Sekunde, die zwischen dem Anlegen und dieser Zeile vergangen ist.
  const full = billing.refundValue(profile);
  assert.ok(
    full <= premium.price_credits && full >= premium.price_credits - 1,
    `Restwert ${full} sollte beim Monatspreis ${premium.price_credits} liegen`
  );

  // Ein Zusatz mitten in der Periode kostet anteilig – und genau das kommt auch zurück.
  const addon = billing.addonByKey('slot');
  const { charged } = billing.addAddon(profile, addon, 1);
  const fresh = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id);
  const refund = billing.refundValue(fresh);
  assert.ok(
    refund <= premium.price_credits + charged,
    `Restwert ${refund} darf nicht über dem Bezahlten (${premium.price_credits} + ${charged}) liegen`
  );
  assert.ok(refund > premium.price_credits - 5, 'der Tarifanteil gehört weiterhin dazu');
});

test('a refunded top-up is never credited a second time', () => {
  const user = createUser();
  const topup = billing.createTopup({
    userId: user.id,
    provider: 'transfer',
    amountCent: 1000,
    credits: 1000,
  });
  billing.settleTopup(topup.id);
  assert.equal(billing.balance(user.id), 1000);

  // Rücklastschrift: Das Geld ist weg, die Credits auch.
  billing.refundTopup(topup.id);
  assert.equal(billing.balance(user.id), 0);

  // Ein Klick auf "als bezahlt buchen" darf sie jetzt nicht zurückholen.
  billing.settleTopup(topup.id);
  assert.equal(billing.balance(user.id), 0);
});

test('a top-up that was never paid stays open after a dispute and can still be settled', () => {
  const user = createUser();
  const topup = billing.createTopup({
    userId: user.id,
    provider: 'stripe',
    amountCent: 1000,
    credits: 1000,
  });
  // Stripe meldet einen Streitfall, bevor "bezahlt" ankommt. Vorher wurde die Aufladung dabei auf
  // "refunded" gesetzt – und `settleTopup` verweigerte sie danach für immer. Das Geld war da, die
  // Credits kamen nie.
  billing.refundTopup(topup.id);
  assert.equal(billing.balance(user.id), 0);
  billing.settleTopup(topup.id, '', { force: true });
  assert.equal(billing.balance(user.id), 1000);
});

// ---------------------------------------------------------------- Stripe
//
// Der Webhook ist die einzige Stelle, an der eine Zahlung zu Guthaben wird. Was ihn schützt, ist
// die Unterschrift – also gehört genau die geprüft, und zwar in allen vier Fällen, in denen sie
// nicht gelten darf.

test('a Stripe webhook is only accepted with a fresh, correctly signed body', () => {
  const secret = 'whsec_test_geheimnis';
  const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' }));
  const now = 1_760_000_000_000;
  const sign = (at, key = secret, payload = body) =>
    crypto
      .createHmac('sha256', key)
      .update(`${Math.floor(at / 1000)}.`)
      .update(payload)
      .digest('hex');
  const header = (at, key, payload) =>
    `t=${Math.floor(at / 1000)},v1=${sign(at, key, payload)}`;

  // Ohne hinterlegtes Geheimnis kommt gar nichts durch – auch keine echte Meldung.
  setSetting('stripe_webhook_secret', '');
  assert.equal(stripe.verify(body, header(now), { now }), false);

  setSetting('stripe_webhook_secret', secret);
  assert.equal(stripe.verify(body, header(now), { now }), true);

  // Falsches Geheimnis, veränderter Rumpf, fehlende Unterschrift: alles drei ein Nein.
  assert.equal(stripe.verify(body, header(now, 'whsec_falsch'), { now }), false);
  assert.equal(stripe.verify(Buffer.from('{"id":"evt_2"}'), header(now), { now }), false);
  assert.equal(stripe.verify(body, '', { now }), false);

  // Eine mitgeschnittene, echt unterschriebene Meldung verfällt: Ohne die Altersprüfung ließe sie
  // sich für immer wieder einspielen, und jedes Mal entstünde dasselbe Guthaben neu.
  const old = now - (stripe.TOLERANCE_SECONDS + 60) * 1000;
  assert.equal(stripe.verify(body, header(old), { now }), false);
  assert.equal(stripe.verify(body, header(old), { now: old }), true);

  // Beim Schlüsselwechsel schickt Stripe kurzzeitig zwei Unterschriften. Eine gültige genügt.
  assert.equal(
    stripe.verify(body, `t=${Math.floor(now / 1000)},v1=${sign(now, 'whsec_alt')},v1=${sign(now)}`, { now }),
    true
  );
  setSetting('stripe_webhook_secret', '');
});

test('Stripe parameters are form-encoded the way Stripe expects them', () => {
  const encoded = stripe.encode({
    mode: 'payment',
    metadata: { topup_id: '7' },
    line_items: [{ quantity: 1, price_data: { unit_amount: 1000, currency: 'eur' } }],
    // Nicht gesetzte Felder sind bei Stripe etwas anderes als leere – sie dürfen gar nicht mit.
    cancel_url: undefined,
  });
  assert.equal(encoded.get('mode'), 'payment');
  assert.equal(encoded.get('metadata[topup_id]'), '7');
  assert.equal(encoded.get('line_items[0][price_data][unit_amount]'), '1000');
  assert.equal(encoded.has('cancel_url'), false);
});

test('the small-business rule shows no VAT but says why', () => {
  setSetting('vat_mode', 'small_business');
  assert.match(vat.note('de'), /§ 6 Abs\. 1 Z 27 UStG/);
  assert.equal(vat.view('de').shows_vat, false);

  // Ein leeres Feld ist keine Angabe: dann gilt wieder die Vorgabe. Unter einem Preis darf nie
  // gar nichts stehen – "nichts" heißt auf einer Rechnung nicht "steuerfrei", sondern "ungeklärt".
  setSetting('vat_note_de', '   ');
  assert.match(vat.note('de'), /Kleinunternehmerregelung/);

  // Mit Stripe Tax gilt der eigene Satz nicht mehr: Dort wird die Steuer ausgewiesen, und ein
  // stehengebliebener Kleinunternehmer-Hinweis wäre dann schlicht falsch.
  setSetting('vat_note_de', 'Eigener Satz.');
  setSetting('vat_mode', 'stripe_tax');
  assert.doesNotMatch(vat.note('de'), /Kleinunternehmer|Eigener Satz/);
  assert.equal(vat.view('de').shows_vat, true);

  setSetting('vat_mode', 'small_business');
  setSetting('vat_note_de', '');
});

test('a voucher is worth one redemption per account, and its counter never goes negative', () => {
  const voucher = billing.createVoucher({ credits: 500, uses: 2 });
  const greedy = createUser();
  const other = createUser();

  assert.equal(billing.redeemVoucher(greedy.id, voucher.code).credits, 500);
  // Derselbe Code, dasselbe Konto: `uses_left` zählt Einlösungen, nicht Personen – ohne diese
  // Sperre war ein Gutschein für zwei Leute ein Knopf, den einer zweimal drückte.
  assert.throws(() => billing.redeemVoucher(greedy.id, voucher.code), /schon eingelöst|already/i);
  assert.equal(billing.balance(greedy.id), 500);

  assert.equal(billing.redeemVoucher(other.id, voucher.code).credits, 500);
  const third = createUser();
  assert.throws(() => billing.redeemVoucher(third.id, voucher.code), /eingelöst|used up/i);
  assert.ok(db.prepare('SELECT uses_left FROM vouchers WHERE code = ?').get(voucher.code).uses_left >= 0);
});

test('an add-on never refunds more credits than were charged for it', () => {
  const user = createUser({ credits: 10_000 });
  const premium = billing.planBySlug('premium');
  const profile = createProfile(user, premium);
  const addon = billing.addonByKey('slot');

  // So legt die Verwaltung einen Zusatz von Hand auf einen Platz: ohne Abbuchung.
  db.prepare(
    `INSERT INTO profile_addons (profile_id, addon_id, qty, created_at) VALUES (?, ?, 1, ?)`
  ).run(profile.id, addon.id, Date.now());

  const before = billing.balance(user.id);
  const result = billing.removeAddon(profile, addon, 1);
  assert.equal(result.refund, 0, 'ein geschenkter Zusatz darf kein Guthaben erzeugen');
  assert.equal(billing.balance(user.id), before);

  // Und der gekaufte Fall bleibt fair: zurück kommt höchstens, was hingegangen ist.
  const bought = billing.addAddon(profile, addon, 2);
  const back = billing.removeAddon(profile, addon, 2);
  assert.ok(back.refund <= bought.charged, `${back.refund} > ${bought.charged}`);
});

test('credits never fall below zero', () => {
  const user = createUser({ credits: 100 });
  assert.throws(() => billing.move(user.id, -101, 'plan', 'zu viel'), /Guthaben|credits/i);
  assert.equal(billing.balance(user.id), 100, 'die abgelehnte Buchung darf nichts hinterlassen');
  assert.equal(billing.move(user.id, -100, 'plan', 'genau passend'), 0);
});

test('the expiry warning counts booked add-ons, not just the plan price', () => {
  const premium = billing.planBySlug('premium');
  const addon = billing.addonByKey('slot');
  // Guthaben reicht für den Tarif, nicht für Tarif plus Zusatz. Vorher verglich die Abfrage mit
  // der Tarifspalte statt mit der Summe – und genau dieser Kunde wurde nie gewarnt.
  const user = createUser({ credits: premium.price_credits + addon.price_credits - 1 });
  const profile = createProfile(user, premium, { paidUntil: Date.now() + 2 * 86_400_000 });
  db.prepare(
    `INSERT INTO profile_addons (profile_id, addon_id, qty, paid_credits, created_at)
     VALUES (?, ?, 1, 0, ?)`
  ).run(profile.id, addon.id, Date.now());

  const due = billing.expiringSoon(3).filter((row) => row.id === profile.id);
  assert.equal(due.length, 1, 'der Platz fehlt in der Warnung');
  assert.equal(due[0].price_credits, premium.price_credits + addon.price_credits);
});

test('mail templates never put customer text into the HTML unescaped', async () => {
  const mail = await import('../server/mail.js');
  const user = createUser();
  // Der Betreff kommt vom Kunden. Er darf in einer Nachricht **von uns** kein HTML werden –
  // sonst steht darin, was jemand hineinschreibt, bis hin zu einem Link, der woanders hinführt.
  const message = mail.render(user, 'ticket_reply', {
    id: 7,
    subject: '<img src=x onerror=alert(1)>',
    preview: 'hallo',
  });
  assert.ok(!message.html.includes('<img src=x'), 'Kundentext steht roh im HTML');
  assert.ok(message.html.includes('&lt;img src=x'), 'Kundentext ist nicht geschützt');
  // Die Nur-Text-Fassung bleibt lesbar – dort schadet ein spitzes Klammernpaar niemandem.
  assert.ok(message.text.includes('<img src=x'));
  // Und der Rahmen der Nachricht steht weiterhin: die Vorlage darf ihre eigenen Auszeichnungen
  // behalten, geschützt wird nur, was eingesetzt wird.
  assert.ok(message.html.includes('<p style='));

  const receiptMail = mail.render(user, 'topup', {
    amount_cent: 500,
    credits: 500,
    balance: 900,
    receipt: 'AFK-2026-0042',
  });
  assert.match(receiptMail.text, /AFK-2026-0042/);
  const alertMail = mail.render(user, 'system_alert', {
    title: 'Standort ausgefallen',
    text: 'Xeon 1 übernimmt.',
  });
  assert.match(alertMail.subject, /system alert/i);
  assert.match(alertMail.text, /Xeon 1 übernimmt/);
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
    // Ultra ohne gebuchte Live-Ansicht bekommt die Premium-Items-Datei: dieselben sichtbaren
    // Fähigkeiten, ohne den Weltspeicher, den nur die Live-Ansicht braucht.
    assert.equal(binaries.buildFor({}, { slug: 'ultra', premium: 1, menus: 1, pov: 0 }), 'premiumItems');
    assert.equal(binaries.buildFor({}, { slug: 'ultra', premium: 1, menus: 1, pov: 1 }), 'ultra');
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
    { emit: (...args) => emitted.push(args), macros: { onMenu: () => {} } },
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

/**
 * Ein Minecraft-Server, der genau eine Sache kann: auf den Status-Ping antworten.
 *
 * Damit lässt sich das Protokoll wirklich prüfen und nicht nur die Textumwandlung: Längenpräfix,
 * Paketkennung, UTF-8-String, und die Antwort in Stücken, wie sie über ein Netz auch käme.
 */
function fakeMinecraftServer(json, { chunked = false } = {}) {
  const varInt = (value) => {
    const bytes = [];
    let rest = value >>> 0;
    do {
      let part = rest & 0x7f;
      rest >>>= 7;
      if (rest) part |= 0x80;
      bytes.push(part);
    } while (rest);
    return Buffer.from(bytes);
  };
  const body = Buffer.from(JSON.stringify(json), 'utf8');
  const inner = Buffer.concat([varInt(0x00), varInt(body.length), body]);
  const packet = Buffer.concat([varInt(inner.length), inner]);

  const server = net.createServer((socket) => {
    socket.once('data', () => {
      if (!chunked) return socket.write(packet);
      // In zwei Stücken, mit einer Naht mitten im JSON: Genau daran ist schon mancher Parser
      // gescheitert, der die Antwort für ein einziges `data`-Ereignis hielt.
      socket.write(packet.subarray(0, 6));
      setTimeout(() => socket.write(packet.subarray(6)), 20);
    });
    socket.on('error', () => {});
  });
  return server;
}

const listenOn = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

test('the Minecraft ping reads a real status packet and lets nothing from a stranger through raw', async () => {
  const mcping = await import('../server/mcping.js');

  // Die Textumwandlung zuerst, ohne Netz. Der MOTD kommt in drei erlaubten Formen, und alle drei
  // kommen im Alltag vor.
  assert.equal(mcping.legacy('schlichter Text'), 'schlichter Text');
  assert.equal(
    mcping.legacy({ text: 'A ', color: 'gold', extra: [{ text: 'B', bold: true }] }),
    '§6A §6§lB'
  );
  // Eine Hexfarbe in der Schreibweise, die chatlog.js versteht – sonst käme sie im Panel als
  // Zeichensalat an.
  assert.equal(mcping.legacy({ text: 'C', color: '#ff0040' }), '§x§f§f§0§0§4§0C');
  assert.deepEqual(parseFormatting(mcping.legacy({ text: 'C', color: '#ff0040' }))[0].color, '#ff0040');
  // Übersetzbare Komponenten haben keinen Wortlaut, den wir kennen – lieber nichts als "chat.type".
  assert.equal(mcping.legacy({ translate: 'chat.type.text' }), '');
  assert.equal(mcping.legacy(['eins', { text: 'zwei' }]), 'einszwei');

  const server = fakeMinecraftServer({
    version: { name: '§aPaper 1.21', protocol: 767 },
    players: {
      online: 7,
      max: 20,
      // Mehr Namen, als angezeigt werden sollen – bei großen Servern steht dort gern Werbung.
      sample: Array.from({ length: 40 }, (_, index) => ({ name: `spieler${index}` })),
    },
    description: { text: '', extra: [{ text: 'Hallo', color: 'green' }] },
    // Ein "Symbol", das keines ist. Es landet im Panel in einem src-Attribut.
    favicon: 'data:text/html,<script>alert(1)</script>',
  });
  const port = await listenOn(server);
  try {
    const result = await mcping.ping('127.0.0.1', port);
    assert.equal(result.online, true);
    assert.equal(result.version, '§aPaper 1.21');
    assert.equal(result.protocol, 767);
    assert.equal(result.online_players, 7);
    assert.equal(result.max_players, 20);
    assert.equal(result.motd, '§aHallo');
    // Zwölf, nicht vierzig.
    assert.equal(result.sample.length, 12);
    // **Kein fremdes data:-Etwas ins src.** Nur PNG, sonst nichts.
    assert.equal(result.favicon, '');
    assert.ok(result.latency_ms >= 0);
  } finally {
    server.close();
  }

  // Dieselbe Antwort, in Stücken über die Leitung – das Ergebnis muss dasselbe sein.
  const split = fakeMinecraftServer(
    { version: { name: '1.21' }, players: { online: 1, max: 2 }, description: 'geteilt' },
    { chunked: true }
  );
  const splitPort = await listenOn(split);
  try {
    const result = await mcping.ping('127.0.0.1', splitPort);
    assert.equal(result.online, true);
    assert.equal(result.motd, 'geteilt');
  } finally {
    split.close();
  }

  // Und etwas, das kein Minecraft-Server ist: eine Auskunft, kein Absturz.
  const noise = net.createServer((socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  const noisePort = await listenOn(noise);
  try {
    const result = await mcping.ping('127.0.0.1', noisePort);
    assert.equal(result.online, false);
    assert.ok(result.error);
  } finally {
    noise.close();
  }

  // Ein Port, auf dem nichts lauscht: derselbe ruhige Weg.
  const dead = net.createServer();
  const deadPort = await listenOn(dead);
  await new Promise((resolve) => dead.close(resolve));
  const gone = await mcping.ping('127.0.0.1', deadPort);
  assert.equal(gone.online, false);

  // **Der Grund ist ein Schlüssel und kein Satz.** Vorher standen hier fertige deutsche Sätze,
  // und die gingen genau so in den Browser: Wer das Panel auf Englisch benutzte, bekam unter der
  // englischen Überschrift eine deutsche Begründung. Der Wortlaut steht seither in i18n.js, und
  // dieser Test hält beides zusammen – ein neuer Grund ohne Übersetzung fällt hier auf und nicht
  // erst bei einem Kunden, dessen Server gerade aus ist.
  const { S: STRINGS } = await import('../public/assets/js/i18n.js');
  assert.equal(gone.error, 'refused');
  for (const key of ['dns', 'refused', 'timeout', 'reset', 'unreachable', 'closed', 'oversize', 'protocol', 'malformed', 'unknown']) {
    const entry = STRINGS[`mcstatus.${key}`];
    assert.ok(entry, `mcstatus.${key} fehlt in i18n.js`);
    assert.ok(entry.de && entry.en, `mcstatus.${key} fehlt eine Sprache`);
  }
  // Und was der Ping wirklich zurückgibt, ist genau einer davon.
  const reasons = fs.readFileSync(new URL('../server/mcping.js', import.meta.url), 'utf8');
  for (const [, key] of reasons.matchAll(/failed\('([a-z]+)'\)/g)) {
    assert.ok(STRINGS[`mcstatus.${key}`], `mcping meldet "${key}", i18n.js kennt es nicht`);
  }
});

/**
 * Eine Bauform vortäuschen, ohne eine echte Client-Datei zu brauchen.
 *
 * `args()` liest ausschließlich `binaries.caps(build)`; woher die Fähigkeiten kommen, ist ihm egal.
 * Ein echtes Release dafür herunterzuladen hieße, jeden Testlauf von GitHub abhängig zu machen.
 */
function withBuild(key, caps, run) {
  const before = binaries.state.builds[key];
  binaries.state.builds[key] = { key, file: 'x', present: true, caps, version: '9.9.9', stamp: '1:1' };
  try {
    return run();
  } finally {
    if (before) binaries.state.builds[key] = before;
    else delete binaries.state.builds[key];
  }
}

test('the panel keeps the reconnect to itself, and hands the viewer its own Minecraft jar first', async () => {
  const resources = await import('../server/resources.js');
  const user = createUser();
  const account = createAccount(user, { name: 'Steve' });
  const profile = createProfile(user, billing.planBySlug('ultra'));
  // Ein Supervisor-Doppel: `args()` fragt ihn nach den Befehlen, die der Client selbst taktet.
  const fake = { emit: () => {}, macros: { onMenu: () => {} }, joinCommands: () => [], clientMacros: () => [] };
  // Live-Ansicht gebucht – sonst filtert `gateCaps` sie weg und die POV-Zeilen fallen ganz aus.
  const plan = { ...billing.featuresOf(profile), pov: 1, premium: 1 };
  const build = (caps) =>
    withBuild('ultra', caps, () => {
      const bot = new Bot(fake, { profile, account, user, plan });
      bot.build = 'ultra';
      const own = bot.caps;
      bot.webPort = bot.wantsWebView(own) ? 42101 : null;
      return { args: bot.args(own), viewer: Boolean(bot.webPort) };
    });

  const BASE = { local: true, events: true, macros: true };
  const POV = { ...BASE, pov: true, povweb: true, povresources: true };

  // **Client 2.6.0 verbindet sich von selbst neu – das Panel schaltet es ab.** Ohne diese Zeile
  // liefe der Prozess nach einem Kick weiter, und damit nichts, was daran hängt: kein Prüfen von
  // Guthaben und Laufzeit vor dem nächsten Versuch, kein Aufgeben nach acht Fehlversuchen, und
  // ein abgeschaltetes `auto_reconnect` wäre eine Anzeige ohne Wirkung.
  assert.ok(build({ ...BASE, noreconnect: true }).args.includes('--no-reconnect'));
  // Einer älteren Bauform darf sie **nicht** mitgegeben werden: Eine unbekannte Option bricht den
  // Start ab, und dann liefe gar kein Bot mehr.
  assert.ok(!build(BASE).args.includes('--no-reconnect'));

  resources.remove(profile.mc_version);

  // Bis 2.5.0 war die hinterlegte Original-JAR Pflicht: ohne sie kein texturierter Viewer.
  const old = build(POV);
  assert.equal(old.viewer, false);
  assert.ok(!old.args.includes('--pov-web'));

  // Ab 2.6.0 sucht der Client sich selbst eine – der Kunde bekommt seine Texturen trotzdem.
  const auto = build({ ...POV, povresourcesauto: true });
  assert.equal(auto.viewer, true);
  assert.ok(auto.args.includes('--pov-web'));
  // Ohne `--pov-resources`: dort gilt dann die Vorgabe `auto`.
  assert.ok(!auto.args.includes('--pov-resources'));

  // Liegt eine hier, geht sie vor – sie gilt für alle Kunden dieser Maschine, während die
  // Selbsthilfe des Clients unter dem Konto **eines** Kunden landet.
  resources.store(profile.mc_version, fakeClientJar());
  const own = build({ ...POV, povresourcesauto: true });
  const at = own.args.indexOf('--pov-resources');
  assert.ok(at > 0);
  assert.equal(own.args[at + 1], resources.pathFor(profile.mc_version));

  // Ausdrücklich abgeschaltet geht vor der hinterlegten Datei: Wer die 30 MB nicht will, will sie
  // auch dann nicht, wenn eine Datei bereitläge. `args()` liest das Profil-Objekt direkt, das
  // `build()` festhält – deshalb hier setzen und nicht nur in der Datenbank.
  profile.pov_skip_resources = 1;
  const skipped = build({ ...POV, povresourcesauto: true });
  const skippedAt = skipped.args.indexOf('--pov-resources');
  assert.ok(skippedAt > 0);
  assert.equal(skipped.args[skippedAt + 1], 'aus');
  assert.ok(skipped.args.includes('--pov-web'));

  // Eine ältere Bauform kennt `aus` nicht – ihr bleibt die Einstellung verborgen, statt sie an
  // einer unbekannten Option scheitern zu lassen.
  const oldBuild = build(POV);
  assert.ok(!oldBuild.args.includes('aus'));
  const oldAt = oldBuild.args.indexOf('--pov-resources');
  assert.equal(oldBuild.args[oldAt + 1], resources.pathFor(profile.mc_version));

  profile.pov_skip_resources = 0;
  resources.remove(profile.mc_version);
});

test('a running bot knows it holds an outdated client file, and only while it runs', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('premium'));
  const bot = new Bot(
    { emit: () => {}, macros: { onMenu: () => {} } },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );

  // Eine Client-Datei, wie sie auf der Platte liegt – und der Abdruck, den `detect()` daraus
  // gelesen hätte. Ein echtes Release herunterzuladen wäre für diese Frage ein Umweg über das
  // Netz; geprüft wird hier der Vergleich zweier Abdrücke.
  const binFile = path.join(TEST_DIR, 'bin', 'afk-linux');
  fs.mkdirSync(path.dirname(binFile), { recursive: true });
  fs.writeFileSync(binFile, 'ich bin ein client');
  const before = binaries.state.builds.slim;
  binaries.state.builds.slim = {
    key: 'slim',
    file: 'afk-linux',
    present: true,
    caps: {},
    version: '9.9.0',
    stamp: binaries.stampOf(binFile),
  };
  assert.ok(binaries.stampOf(binFile), 'eine vorhandene Datei hat einen Abdruck');
  assert.equal(binaries.stampOf(path.join(TEST_DIR, 'gibt-es-nicht')), null);

  // So sieht ein Bot aus, der gerade gestartet ist: Er hat sich die Bauform und deren Abdruck
  // gemerkt. Der Abdruck stammt von der Datei, wie sie **in diesem Moment** dalag.
  bot.build = 'slim';
  bot.clientStamp = binaries.stampFor('slim');
  bot.clientVersion = binaries.versionOf('slim');
  bot.proc = { stdin: { writable: true, write: () => {} } };
  assert.equal(bot.clientVersion, '9.9.0');

  // Solange die Datei dieselbe ist, ist nichts veraltet.
  assert.equal(bot.outdated, false);
  assert.equal(bot.snapshot().outdated, false);

  // Der Abgleich hat die Datei ersetzt: Größe und Änderungszeit sind andere.
  bot.clientStamp = '1:1';
  assert.equal(bot.outdated, true);
  assert.equal(bot.snapshot().client_version, bot.clientVersion);

  // **Nur laufende Bots.** Ein ausgeschalteter startet ohnehin mit dem, was jetzt daliegt – ihn
  // als veraltet zu zählen hieße, einen Knopf anzubieten, der nichts tut.
  bot.proc = null;
  assert.equal(bot.outdated, false);

  // Und nur, wenn überhaupt ein Abdruck bekannt ist. „Weiß ich nicht“ heißt hier „nein“: Ein
  // Neustart aus einer Unsicherheit heraus wirft einen Bot ohne Gegenwert aus dem Spiel.
  bot.proc = { stdin: { writable: true, write: () => {} } };
  bot.clientStamp = null;
  assert.equal(bot.outdated, false);

  // Und jetzt der Weg, den es im Betrieb wirklich gibt: Der Abgleich schreibt eine neue Datei an
  // dieselbe Stelle, `detect()` liest einen neuen Abdruck – und der laufende Bot hält den alten.
  bot.clientStamp = binaries.stampFor('slim');
  assert.equal(bot.outdated, false);
  fs.writeFileSync(binFile, 'ich bin ein neuerer client, und laenger');
  binaries.state.builds.slim.stamp = binaries.stampOf(binFile);
  binaries.state.builds.slim.version = '9.9.1';
  assert.equal(bot.outdated, true);
  // Der Bot nennt weiter seine eigene Fassung – nicht die, die auf der Platte liegt.
  assert.equal(bot.snapshot().client_version, '9.9.0');

  bot.proc = null;
  if (before) binaries.state.builds.slim = before;
  else delete binaries.state.builds.slim;
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

test('technical resource-pack disconnects become a clean diagnosis', () => {
  const expected =
    'Der Server verlangt ein Resource-Pack. Der Client hat das verpflichtende Pack nicht bestätigt.';
  assert.equal(disconnectText('\u001b[0mmultiplayer.requiredTexturePrompt.disconnect\u001b[0m'), expected);
  // Ereigniszeilen ersetzen das ESC-Steuerzeichen, bevor sie über die Pipe gehen; auch dieses
  // tatsächlich im Betrieb beobachtete Fragment darf nicht im Panel oder in Aktivitäten stehen.
  assert.equal(disconnectText('[0mmultiplayer.requiredTexturePrompt.disconnect [0m'), expected);
  assert.equal(disconnectText('{"text":"Du bist nicht auf der Whitelist"}'), 'Du bist nicht auf der Whitelist');
});

/**
 * Eine echte Bildzeile des Clients bauen: je Zelle Vordergrund-, Hintergrundfarbe und der obere
 * Halbblock, am Ende ein Reset. Genau so kommt es aus `ultra-afk-linux 2.0.0` heraus – der Test
 * davor hatte sich ein Format ausgedacht (eine Helligkeitsrampe, die `POV`-Zeile als Schluss),
 * und weil er das prüfte, blieb der echte Fehler unsichtbar: Das Panel wartete ewig auf "das
 * erste Bild", während jede Bildzeile hinten als Statuszeile im Chatverlauf landete.
 */
const povLine = (cells) =>
  `${cells
    .map(([top, bottom]) => `\u001b[38;2;${top.join(';')}m\u001b[48;2;${bottom.join(';')}m▀`)
    .join('')}\u001b[0m`;

const povHead = (prefix = '\u001b[H') =>
  `${prefix}POV  x=9.5 y=-60.0 z=-8.5  Blick 0/0  Chunks 213  (:pov stop)`;

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
  bot.feed('err', Buffer.from(`${povHead('\u001b[2J\u001b[H')}\n`, 'utf8'));
  assert.equal(bot.views.pov, null);

  bot.povWanted = true;
  const before = bot.chat.length;
  const blue = [65, 130, 210];
  const green = [70, 135, 70];
  const stone = [130, 130, 130];
  const frame =
    `${povHead('\u001b[2J\u001b[H')}\n` +
    `${povLine([[blue, blue], [blue, green], [stone, stone]])}\n` +
    `${povLine([[green, green], [green, green], [stone, blue]])}\n`;
  bot.feed('err', Buffer.from(frame, 'utf8'));

  // Ein Bild ist erst vollständig, wenn etwas kommt, das keine Bildzeile mehr ist – hier die
  // Kopfzeile des nächsten Bildes. Bis dahin könnte noch eine Zeile folgen.
  assert.equal(bot.views.pov, null);
  bot.feed('err', Buffer.from(`${povHead()}\n`, 'utf8'));

  assert.equal(bot.views.pov.empty, false);
  // Zwei Zeichenzeilen sind vier Bildzeilen: Der Halbblock trägt oben die Vorder-, unten die
  // Hintergrundfarbe. Wer die Hintergrundfarbe wegwirft, wirft das halbe Bild weg.
  assert.equal(bot.views.pov.height, 4);
  assert.equal(bot.views.pov.width, 3);
  assert.deepEqual(bot.views.pov.rows[0], [['4182d2', 2], ['828282', 1]]);
  assert.deepEqual(bot.views.pov.rows[1], [['4182d2', 1], ['468746', 1], ['828282', 1]]);
  assert.deepEqual(bot.views.pov.rows[2], [['468746', 2], ['828282', 1]]);
  assert.deepEqual(bot.views.pov.rows[3], [['468746', 2], ['4182d2', 1]]);
  assert.match(bot.views.pov.status, /^POV {2}x=9\.5/);
  assert.equal(views.at(-1).kind, 'pov');
  // Und keine einzige Zeile des Bildes steht im Chatverlauf.
  assert.equal(bot.chat.length, before);

  // Eine Meldung, die genauso beginnt, ist trotzdem eine Meldung.
  bot.povSentAt = 0;
  bot.feed('err', Buffer.from('\u001b[0m\u001b[2J\u001b[H\u001b[90mLive-POV beendet.\u001b[0m\n', 'utf8'));
  assert.equal(bot.chat.at(-1).text, 'Live-POV beendet.');
});

test('frames beyond five per second are dropped without being taken apart', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('premium'));
  const sent = [];
  const bot = new Bot(
    { emit: (type, payload) => type === 'bot-view' && sent.push(payload), macros: { onChat: () => {} } },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );
  bot.povWanted = true;
  const row = povLine([[[1, 2, 3], [4, 5, 6]]]);

  // Erstes Bild: geht durch, sobald die Kopfzeile des zweiten es abschließt.
  bot.feed('err', Buffer.from(`${povHead()}\n${row}\n`, 'utf8'));
  bot.feed('err', Buffer.from(`${povHead()}\n${row}\n`, 'utf8'));
  assert.equal(sent.length, 1);
  const before = bot.chat.length;

  // Das zweite kam zu schnell: verworfen – und seine Zeilen dürfen trotzdem nicht im Chat landen.
  bot.feed('err', Buffer.from(`${povHead()}\n${row}\n${row}\n`, 'utf8'));
  assert.equal(sent.length, 1);
  assert.equal(bot.chat.length, before);

  // Nach der Sperrzeit wieder.
  bot.povSentAt = 0;
  bot.feed('err', Buffer.from(`${povHead()}\n${row}\n${povHead()}\n`, 'utf8'));
  assert.equal(sent.length, 2);
});

test('a picture survives a chunk boundary inside a character', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('premium'));
  const views = [];
  const bot = new Bot(
    { emit: (type, payload) => type === 'bot-view' && views.push(payload), macros: { onChat: () => {} } },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );
  bot.povWanted = true;

  const cells = Array.from({ length: 20 }, (_, i) => [
    [i, 2 * i, 3 * i],
    [3 * i, 2 * i, i],
  ]);
  const text = `${povHead()}\n${povLine(cells)}\n${povLine(cells)}\n${povHead()}\n`;
  const bytes = Buffer.from(text, 'utf8');

  // Byte für Byte einspeisen: Damit endet jedes Datenstück garantiert auch einmal mitten im
  // Halbblock, der drei Byte lang ist. `chunk.toString('utf8')` machte daraus ein Fragezeichen –
  // die Zeile war damit keine Bildzeile mehr, das Bild brach ab und der Rest landete im Chat.
  for (const byte of bytes) bot.feed('err', Buffer.from([byte]));

  assert.equal(views.length, 1);
  assert.equal(views[0].view.width, 20);
  assert.equal(views[0].view.height, 4);
  assert.equal(bot.chat.length, 0);
  assert.equal(views[0].view.rows[0][0][0], '000000');
  assert.equal(views[0].view.rows[1][0][0], '000000');
  assert.equal(views[0].view.rows[0].at(-1)[0], '132639');
  assert.equal(views[0].view.rows[1].at(-1)[0], '392613');
});

test('a chat line is never swallowed as part of a picture', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('premium'));
  const bot = new Bot(
    { emit: () => {}, macros: { onChat: () => {} } },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );
  bot.povWanted = true;
  bot.feed('err', Buffer.from(`${povHead()}\n`, 'utf8'));
  // Jemand schreibt den Halbblock in den Chat, während ein Bild läuft. Das sieht einer Bildzeile
  // ähnlich, ist aber keine – und darf deshalb nicht verschwinden.
  bot.feed('out', Buffer.from('<Steve> ▀▀▀ sieht aus wie ein Bild\n', 'utf8'));
  assert.match(bot.chat.at(-1).text, /sieht aus wie ein Bild/);
});

/**
 * Die Einstellungen der Live-Ansicht gehören auf die Kommandozeile.
 *
 * Vorher schickte das Panel `:pov size 160 80` erst, wenn der Bot im Spiel war – bis dahin
 * zeichnete `pov-afk-linux` längst in seiner eigenen Vorgabe (64×32). Und **nur**, wenn die Datei
 * die Option laut ihrer Hilfe kennt: Eine ältere Bauform bricht bei einer unbekannten Option beim
 * Start ab, und dann liefe gar kein Bot mehr, nicht nur die Ansicht nicht.
 */
test('the live view is set up on the command line, but only where the client understands it', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('ultra'));
  const bot = new Bot(
    { emit: () => {}, macros: { onChat: () => {} }, joinCommands: () => [], clientMacros: () => [] },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );

  const modern = bot.args({ pov: true, povstart: true, povsize: true, povfps: true });
  assert.deepEqual(
    modern.slice(modern.indexOf('--pov')),
    ['--pov', 'aus', '--pov-size', '160x80', '--pov-fps', String(POV_FPS)]
  );
  assert.equal(`${POV_SIZE.width}x${POV_SIZE.height}`, '160x80');

  // Dieselbe Bauform, aber ohne die Optionen in der Hilfe: dann steht keine davon im Aufruf.
  const older = bot.args({ pov: true });
  assert.ok(!older.some((entry) => String(entry).startsWith('--pov')));

  // Und ohne gebuchte Live-Ansicht überhaupt nicht – `gateCaps` hat `pov` dann schon abgeräumt.
  const withoutAddon = bot.args({ povstart: true, povsize: true, povfps: true });
  assert.ok(!withoutAddon.some((entry) => String(entry).startsWith('--pov')));
});

/**
 * Der texturierte Viewer (Client 2.5.0) kommt nur, wenn wirklich alles dafür da ist.
 *
 * Vier Bedingungen, und jede einzelne ist ein Nein. Die vierte ist die, die im Betrieb wirklich
 * fehlt: eine Original-Client-JAR für **diese** Protokollversion. Ohne sie startet der Viewer
 * zwar, kann aber kein Bild rechnen – der Kunde sähe statt der bezahlten Ansicht eine
 * Fehlermeldung, wo er vorher wenigstens die Voxelansicht hatte.
 */
test('the textured viewer is only started where the client, the plan and the resources allow it', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('ultra'), { mcVersion: '26.1' });
  db.prepare("UPDATE profiles SET mc_version = '26.1' WHERE id = ?").run(profile.id);
  const fresh = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id);
  const bot = new Bot(
    { emit: () => {}, macros: { onChat: () => {} }, joinCommands: () => [], clientMacros: () => [] },
    { profile: fresh, account, user, plan: { ...billing.featuresOf(fresh), pov: 1 } }
  );
  const able = { pov: true, povstart: true, povsize: true, povfps: true, povweb: true, povresources: true };

  // Ohne JAR: keine Frage nach einem Port, und damit kein Viewer.
  assert.equal(resources.has('26.1'), false);
  assert.equal(bot.wantsWebView(able), false);

  const jar = fakeClientJar();
  resources.store('26.1', jar);
  try {
    assert.equal(bot.wantsWebView(able), true);
    // Eine ältere Client-Datei kennt die Optionen nicht – sie mitzuschicken bräche den Start.
    assert.equal(bot.wantsWebView({ ...able, povweb: false }), false);
    // Und ohne gebuchte Live-Ansicht ist der Viewer nur Rechenzeit für niemanden.
    assert.equal(bot.wantsWebView({ ...able, pov: false }), false);

    bot.webPort = 42_100;
    const args = bot.args(able);
    assert.deepEqual(args.slice(args.indexOf('--pov-web'), args.indexOf('--pov-web') + 2), [
      '--pov-web',
      '127.0.0.1:42100',
    ]);
    assert.equal(args[args.indexOf('--pov-resources') + 1], resources.pathFor('26.1'));

    // Auf einem Standort setzt sie der Standort selbst ein: Der Pfad gilt nur auf seiner Maschine.
    bot.remote = true;
    const remote = bot.args(able);
    assert.ok(!remote.includes('--pov-web'));
    assert.ok(!remote.includes('--pov-resources'));
  } finally {
    resources.remove('26.1');
  }
});

/** Was keine Client-JAR ist, kommt nicht in das Verzeichnis, aus dem der Client liest. */
test('only a real Minecraft client JAR is accepted as resources', () => {
  assert.equal(resources.looksLikeClientJar(Buffer.alloc(0)), false);
  assert.equal(resources.looksLikeClientJar(Buffer.alloc(4096, 0x41)), false);
  // Eine ZIP-Datei ohne die Verzeichnisse, aus denen gezeichnet wird – etwa die Server-JAR.
  const server = Buffer.concat([Buffer.from('PK'), Buffer.alloc(4096, 0x20)]);
  assert.equal(resources.looksLikeClientJar(server), false);
  assert.equal(resources.looksLikeClientJar(fakeClientJar()), true);
  assert.throws(() => resources.store('26.1', server), /Client-JAR/);
  // Eine Versionsangabe wird zum Dateinamen – und darf deshalb kein Pfad sein.
  assert.equal(resources.validVersion('../../etc/passwd'), false);
  assert.equal(resources.validVersion('26.1'), true);
});

/**
 * Der Zugriffstoken des Viewers verlässt das Panel nicht.
 *
 * Der Client schreibt die vollständige Adresse auf die Fehlerausgabe, damit ein Mensch am Terminal
 * sie anklicken kann. Hier sitzt keiner: Die Zeile ginge über die Live-Leitung in jeden offenen
 * Browser dieses Kontos. Mit dem Token kann man die Weltdaten eines fremden Minecraft-Servers
 * abholen und im Spiel klicken – er gehört allein dem Panel.
 */
test('the viewer token is picked up but never repeated to the browser', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('ultra'));
  const lines = [];
  const bot = new Bot(
    {
      emit: (event, payload) => {
        if (event === 'bot-line') lines.push(payload.entry);
      },
      macros: { onChat: () => {} },
      joinCommands: () => [],
      clientMacros: () => [],
    },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );
  bot.webPort = 42_101;
  const token = 'a'.repeat(32);

  bot.feed('err', Buffer.from(`[90mBrowser-POV: http://127.0.0.1:42101/?token=${token}[0m\n`, 'utf8'));

  assert.equal(bot.web.token, token);
  assert.equal(bot.web.port, 42_101);
  assert.equal(bot.povState().web, true);
  assert.equal(bot.povState().pending, false);
  assert.ok(lines.length);
  for (const entry of lines) assert.ok(!entry.text.includes(token), entry.text);

  // Und der Satz, mit dem der Client erklärt, warum es keine Texturen gibt, gehört dem Kunden.
  bot.feed('err', Buffer.from('Browser-POV startet ohne Texturen: Datei fehlt\n', 'utf8'));
  assert.equal(bot.webNote, 'Datei fehlt');
});

/**
 * `:menu` und `:inv` schreiben beide `@event slot`-Zeilen und meinen etwas anderes.
 *
 * Ohne die Unterscheidung landete das eigene Inventar in der Menüansicht und überschrieb sie –
 * ein Menü mit sechsundvierzig Feldern, das es nie gab.
 */
test('the inventory lands in the inventory and not in the open menu', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('ultra'));
  const bot = new Bot(
    { emit: () => {}, macros: { onChat: () => {} }, joinCommands: () => [], clientMacros: () => [] },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );

  // Ein `:menu` schreibt beides: die Übersicht als Text und die Felder als Ereignis.
  bot.beginCapture('menu');
  bot.onStatus('    Fenster 7  ·  27 Felder (0 bis 26)');
  bot.onEvent('@event slot 3 1 §bTruhenfeld');
  bot.finishCapture();
  assert.equal(bot.views.menu.items[3].name, '§bTruhenfeld');
  assert.equal(bot.views.menu.slots, 27);
  assert.equal(bot.views.inv, null);

  bot.beginCapture('inv');
  bot.onEvent('@event slot 36 64 §fPflasterstein');
  bot.onEvent('@event lore 36 §7Ein Stapel');
  bot.finishCapture();
  assert.equal(bot.views.inv.items[36].count, 64);
  assert.deepEqual(bot.views.inv.items[36].lore, ['§7Ein Stapel']);
  // Das Menü von vorhin ist unberührt geblieben.
  assert.equal(bot.views.menu.items[3].name, '§bTruhenfeld');
  assert.equal(bot.views.menu.items[36], undefined);

  // Eine Abfrage ohne ein einziges Feld heißt "leer" und nicht "wie beim letzten Mal".
  bot.beginCapture('inv');
  bot.finishCapture();
  assert.equal(bot.views.inv.empty, true);
});

/**
 * Die Sichtweite steht nur im Aufruf, wenn sie jemand hochgestellt hat.
 *
 * Für einen stehenden Bot ist sie eine Zahl ohne Wirkung und für den Minecraft-Server unnötige
 * Arbeit; für die Live-Ansicht ist sie die eine Zahl, die zählt.
 */
test('view distance is only sent when it was raised, and only on a paid slot', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('ultra'));
  db.prepare('UPDATE profiles SET view_distance = 12 WHERE id = ?').run(profile.id);
  const raised = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id);
  const context = { profile: raised, account, user, plan: billing.featuresOf(raised) };
  const stub = { emit: () => {}, macros: { onChat: () => {} }, joinCommands: () => [], clientMacros: () => [] };

  const bot = new Bot(stub, context);
  const args = bot.args({ viewdistance: true });
  assert.equal(args[args.indexOf('--view-distance') + 1], '12');

  // Eine ältere Client-Datei kennt die Option nicht.
  assert.ok(!bot.args({}).includes('--view-distance'));

  // Und der Gratis-Tarif auch nicht: Chunks kosten Arbeitsspeicher auf unserer Maschine.
  const free = new Bot(stub, { ...context, plan: { ...context.plan, premium: 0 } });
  assert.ok(!free.args({ viewdistance: true }).includes('--view-distance'));

  db.prepare('UPDATE profiles SET view_distance = 0 WHERE id = ?').run(profile.id);
  const standard = new Bot(stub, {
    ...context,
    profile: db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id),
  });
  assert.ok(!standard.args({ viewdistance: true }).includes('--view-distance'));
});

/**
 * Jede Datei, die in den Browser geht, muss sich überhaupt lesen lassen.
 *
 * **Der Grund für diesen Test ist ein Backtick.** Die Oberfläche baut ihr HTML in Template-Strings,
 * und in einem davon stand ein Kommentar mit `so einem` Zeichen darin. Damit war der String zu
 * Ende, der Rest der Datei war Unsinn, und **kein einziger Test schlug an**: Der Server liefert
 * diese Dateien nur aus, er liest sie nie. Aufgefallen wäre es erst im Browser eines Kunden, an
 * einer weißen Seite ohne Fehlermeldung.
 *
 * Geprüft wird nur die Syntax – ob der Code das Richtige tut, sagt er nicht. Aber „lässt sich
 * lesen“ ist die Grundlage, ohne die jede andere Aussage über diese Dateien hinfällig ist.
 */
test('every browser file parses', async () => {
  const { transform } = await import('esbuild');
  const root = path.join(ROOT, 'public', 'assets', 'js');
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith('.js') ? [full] : [];
    });

  const files = walk(root);
  assert.ok(files.length > 10, 'die Oberfläche besteht aus mehr als einer Handvoll Dateien');
  for (const file of files) {
    // Nacheinander und mit dem Dateinamen in der Meldung: Bei zwanzig Dateien ist "Unexpected
    // token" ohne den Namen keine Auskunft, sondern eine Suche.
    // eslint-disable-next-line no-await-in-loop
    await assert.doesNotReject(
      () => transform(fs.readFileSync(file, 'utf8'), { loader: 'js', format: 'esm' }),
      `${path.relative(ROOT, file)} lässt sich nicht lesen`
    );
  }
});

/**
 * Was ein Macro von einem Automaten unterscheidet.
 *
 * Vier Dinge werden hier festgehalten, und alle vier haben denselben Hintergrund: Ein Macro
 * schickt Zeilen an einen fremden Server, und ein Server, der etwas für Spam hält, wirft den Bot
 * raus. Platzhalter machen aus einer festen Zeile eine Antwort; Ausschluss verhindert, dass der
 * Bot auf sich selbst antwortet; die Sperrzeit verhindert den Sekundentakt; und die Kette hat
 * einen Boden, damit ein Macro, das sich selbst aufruft, den Dienst nicht anhält.
 */
test('a macro fills in its placeholders, honours its exclusion, its cooldown and the chain limit', async () => {
  const user = createUser();
  const account = createAccount(user, { name: 'Steve' });
  const profile = createProfile(user, billing.planBySlug('premium'), { name: 'Zuhause' });

  const sent = [];
  const trouble = [];
  const bot = {
    key: `${profile.id}:${account.id}`,
    profile,
    account,
    userId: user.id,
    online: true,
    running: true,
    caps: { macros: true, movement: true },
    push: (type, text) => {
      if (type === 'error') trouble.push(text);
    },
    send: (text) => sent.push(text),
    local: (verb, arg) => sent.push(`:${verb}${arg ? ` ${arg}` : ''}`),
  };

  const addMacro = (name, event, config, actions, extra = {}) =>
    db
      .prepare(
        `INSERT INTO macros
           (profile_id, name, event, config, actions, accounts, enabled, cooldown_sec, chance, created_at)
         VALUES (?, ?, ?, ?, ?, '[]', 1, ?, ?, ?)`
      )
      .run(
        profile.id,
        name,
        event,
        JSON.stringify(config),
        JSON.stringify(actions),
        extra.cooldown_sec ?? 0,
        extra.chance ?? 100,
        Date.now()
      ).lastInsertRowid;

  // Der Ablauf ist asynchron, aber ohne Wartezeit im Macro auch sofort fertig. Eine Runde durch
  // die Ereignisschleife genügt, damit `run()` durch ist.
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  // ---- Platzhalter: die Gruppen des Ausdrucks, das Konto, der Serverplatz.
  addMacro('Antwort', 'chat', { regex: '(\\w+) hat dich angeschrieben', exclude: 'bin AFK' }, [
    { type: 'chat', text: '/msg {1} bin AFK ({player} auf {server})' },
  ]);
  macroEngine.onChat(bot, 'Notch hat dich angeschrieben');
  await settle();
  assert.deepEqual(sent, ['/msg Notch bin AFK (Steve auf Zuhause)']);

  // ---- Ausschluss: die eigene Antwort löst nicht noch einmal aus.
  sent.length = 0;
  macroEngine.onChat(bot, 'Notch hat dich angeschrieben – bin AFK');
  await settle();
  assert.deepEqual(sent, []);

  // ---- Sperrzeit: derselbe Treffer noch einmal, aber innerhalb der Sperre.
  sent.length = 0;
  const limited = addMacro('Begrüßung', 'chat', { contains: 'willkommen' }, [
    { type: 'chat', text: 'Danke!' },
  ], { cooldown_sec: 600 });
  macroEngine.onChat(bot, 'Willkommen auf dem Server');
  await settle();
  macroEngine.onChat(bot, 'Willkommen auf dem Server');
  await settle();
  assert.deepEqual(sent, ['Danke!']);

  // Und dasselbe Macro geht **nicht** an den Client: Der kennt keine Sperrzeit und schickte die
  // Zeile bei jedem Treffer – also genau das, was die Sperrzeit verhindern soll.
  const row = db.prepare('SELECT * FROM macros WHERE id = ?').get(limited);
  assert.equal(macroEngine.handledByClient(bot, row), false);
  assert.equal(
    macroEngine.handledByClient(bot, { ...row, cooldown_sec: 0 }),
    true,
    'ohne Sperrzeit ist es wieder eine reine Chatkette für den Client'
  );

  // **Dieselbe Antwort auf beiden Seiten.** Gäbe der Supervisor das Macro trotzdem als `--cmd`
  // mit, liefe es doppelt: einmal vom Client und einmal vom Panel, bei jedem Beitritt.
  addMacro('Ankunft', 'join', {}, [{ type: 'chat', text: '/afk' }]);
  addMacro('Ankunft langsam', 'join', {}, [{ type: 'chat', text: '/hallo' }], { cooldown_sec: 60 });
  assert.deepEqual(supervisor.joinCommands(profile.id, account.id), ['/afk']);

  // ---- Die Kette hat einen Boden. Ein Macro, das sich selbst aufruft, endet mit einer Meldung
  //      und nicht mit einem stehenden Dienst.
  sent.length = 0;
  addMacro('Kreis', 'death', {}, [{ type: 'run', name: 'Kreis' }]);
  macroEngine.onDeath(bot);
  await settle();
  assert.ok(
    trouble.some((line) => /zu tief/.test(line)),
    `erwartet: Hinweis auf die Tiefe, bekommen: ${JSON.stringify(trouble)}`
  );
});

/**
 * Der Wiederanlauf – und vor allem die Fälle, in denen es ihn nicht gibt.
 *
 * Die eine Regel, an der alles hängt: **War der Bot im Spiel?** War er es, ist ein Ausfall eine
 * Störung und die Verbindung kommt zurück. War er es nie, ist es eine Absage – falsche Adresse,
 * falsche Version, Bann –, und die wiederholt sich nicht von selbst. Ohne diesen Unterschied wäre
 * der Wiederanlauf eine Neustartschleife im Minutentakt gegen einen Server, der ohnehin nein sagt.
 */
test('a bot that was in game comes back on its own – one that never got in does not', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('premium'));
  // Kurze Zeiten, damit der Test keine Minute wartet: Der erste Versuch läge sonst bei 5 s.
  db.prepare('UPDATE profiles SET reconnect_delay = 1, max_backoff = 2 WHERE id = ?').run(profile.id);

  const lines = [];
  // Der Bot meldet sich beim Supervisor an, wie ein echter auch: `cancelRestart` räumt die
  // Anzeige über die Bot-Liste ab, und ein Test, der daran vorbeigeht, prüft etwas anderes als
  // den Betrieb.
  const fake = () => {
    const bot = {
      key: `${profile.id}:${account.id}`,
      state: 'error',
      userId: user.id,
      profile,
      account,
      lastError: 'Kick: Server startet neu',
      retry: null,
      push: (type, text) => lines.push(`${type} ${text}`),
      setState(state) {
        this.state = state;
      },
    };
    supervisor.bots.set(bot.key, bot);
    return bot;
  };
  after(() => supervisor.bots.delete(`${profile.id}:${account.id}`));

  // Nie im Spiel gewesen: keine Kette. Der Aufrufer löscht daraufhin den Startwunsch.
  assert.equal(supervisor.planRestart(fake(), { wasOnline: 0 }), false);
  assert.equal(supervisor.waitingForRestart(`${profile.id}:${account.id}`), false);

  // Im Spiel gewesen: ein Versuch wartet, und der Bot sagt auch, der wievielte es ist.
  const bot = fake();
  assert.equal(supervisor.planRestart(bot, { wasOnline: 30_000 }), true);
  assert.equal(supervisor.waitingForRestart(bot.key), true);
  assert.equal(bot.retry.tries, 1);
  assert.equal(bot.state, 'reconnecting');

  // Der zweite Fehlversuch zählt weiter – **auch ohne "war online"**. Dass gerade dieser Versuch
  // nicht bis ins Spiel kam, ist genau der Fall, für den es die Kette gibt.
  const second = fake();
  assert.equal(supervisor.planRestart(second, { wasOnline: 0 }), true);
  assert.equal(second.retry.tries, 2);

  // Und sie endet: Nach der achten Absage bleibt der Bot aus.
  let last = second;
  for (let n = 3; n <= 8; n += 1) {
    last = fake();
    assert.equal(supervisor.planRestart(last, { wasOnline: 0 }), true, `Versuch ${n}`);
  }
  assert.equal(supervisor.planRestart(fake(), { wasOnline: 0 }), false);
  assert.equal(supervisor.waitingForRestart(last.key), false);
  assert.ok(lines.some((line) => line.startsWith('error') && /aufgegeben/.test(line)));

  // Wer stoppt, meint es: eine wartende Kette wird abgeräumt.
  const stopped = fake();
  assert.equal(supervisor.planRestart(stopped, { wasOnline: 30_000 }), true);
  assert.equal(supervisor.cancelRestart(stopped.key), true);
  assert.equal(supervisor.waitingForRestart(stopped.key), false);
  assert.equal(stopped.retry, null);

  // Ausgeschaltet heißt ausgeschaltet – und zwar ab sofort, nicht ab dem nächsten Start.
  db.prepare('UPDATE profiles SET auto_reconnect = 0 WHERE id = ?').run(profile.id);
  assert.equal(supervisor.planRestart(fake(), { wasOnline: 30_000 }), false);

  // Eine abgelaufene Microsoft-Anmeldung braucht einen Menschen mit einem Browser.
  db.prepare('UPDATE profiles SET auto_reconnect = 1 WHERE id = ?').run(profile.id);
  const waitingForLogin = fake();
  waitingForLogin.state = 'auth';
  assert.equal(supervisor.planRestart(waitingForLogin, { wasOnline: 30_000 }), false);
});

/**
 * Eine Zuordnung ist absichtlich wiederverwendbar, eine Minecraft-Sitzung aber nicht. Die Regel
 * sitzt im Supervisor, damit nicht nur der Startknopf, sondern auch Zeitpläne und Wiederanläufe
 * denselben Schutz haben.
 */
test('one Minecraft account cannot start on two server slots at the same time', () => {
  const user = createUser();
  const account = createAccount(user, { name: 'OnlyOneSession' });
  const first = createProfile(user, billing.planBySlug('premium'), { name: 'Erster Platz' });
  const second = createProfile(user, billing.planBySlug('premium'), { name: 'Zweiter Platz' });
  const plan = billing.featuresOf(first);
  const live = new Bot(supervisor, { profile: first, account, user, plan });
  // Ein Prozessobjekt genügt: Der Schutz muss greifen, bevor der zweite Start irgendeinen
  // Client, eine Datenbankzeile oder einen Startwunsch erzeugt.
  live.proc = {};
  supervisor.bots.set(live.key, live);
  try {
    assert.deepEqual(supervisor.runningElsewhere(second.id, account.id), [
      { profile_id: first.id, profile_name: first.name, state: 'offline', online: false },
    ]);
    assert.throws(
      () => supervisor.start({ profile: second, account, user, plan: billing.featuresOf(second) }),
      (error) => error.status === 409 && error.code === 'account-running-elsewhere' && /Erster Platz/.test(error.message)
    );
    assert.equal(
      db.prepare('SELECT wanted FROM profile_accounts WHERE profile_id = ? AND account_id = ?').get(second.id, account.id),
      undefined,
      'eine abgewiesene zweite Sitzung hinterlässt keinen Startwunsch'
    );
  } finally {
    supervisor.bots.delete(live.key);
  }
});

/**
 * Bisher überschrieb jeder Zustandswechsel den vorherigen in `bots.state` – im Nachhinein ließ
 * sich nur sagen, wo ein Bot gerade steht, nie, was in der letzten Stunde wirklich passiert ist.
 * `bot_events` hält jeden nennenswerten Übergang für sich fest.
 */
test('meaningful bot transitions land in a durable timeline, transient ones do not, and old rows sweep away', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('premium'));
  const bot = new Bot(
    { emit: () => {}, macros: { onWorldChange: () => {}, onDeath: () => {}, onDisconnect: () => {} } },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );

  // `connecting`/`starting` sind Sekundenbruchteile zwischen zwei anderen Einträgen – Rauschen.
  bot.setState('connecting', 'spielserver.de:25565');
  bot.setState('starting');
  assert.equal(supervisor.eventsOf(profile.id, account.id).length, 0);

  bot.setState('online', 'Steve');
  bot.onEvent('@event world grund=unterserver');
  bot.onEvent('@event death');
  bot.onEvent('@event output ausgelassen');
  bot.setState('reconnecting', 'Versuch 1, in 5 s');

  // Ein schneller Testlauf erzeugt alle fünf Zeilen leicht in derselben Millisekunde – genau der
  // Fall, den auch eine echte Neuverbindungsschleife auslöst. Die Zeitstempel deshalb auseinander-
  // ziehen (statt sich auf `Date.now()` zu verlassen), damit Reihenfolge und `since`-Filter beide
  // etwas Eindeutiges zum Prüfen haben.
  const ids = db
    .prepare('SELECT id FROM bot_events WHERE profile_id = ? AND account_id = ? ORDER BY id ASC')
    .all(profile.id, account.id)
    .map((row) => row.id);
  assert.equal(ids.length, 5);
  const base = Date.now() - 5000;
  ids.forEach((id, index) => db.prepare('UPDATE bot_events SET created_at = ? WHERE id = ?').run(base + index * 1000, id));

  const events = supervisor.eventsOf(profile.id, account.id);
  assert.deepEqual(events.map((entry) => entry.type), ['online', 'world', 'death', 'dropped', 'reconnecting']);
  assert.equal(events[1].detail, 'unterserver');
  assert.equal(events[3].detail, 'ausgelassen');
  assert.equal(events[4].detail, 'Versuch 1, in 5 s');

  // Nur ab einem Zeitpunkt – wie beim Chatverlauf.
  const later = supervisor.eventsOf(profile.id, account.id, events[2].t);
  assert.deepEqual(later.map((entry) => entry.type), ['dropped', 'reconnecting']);

  // Uralte Zeilen räumt das stündliche Aufräumen weg, frische bleiben stehen.
  db.prepare("UPDATE bot_events SET created_at = ? WHERE type = 'world'").run(
    Date.now() - 40 * 24 * 60 * 60 * 1000
  );
  supervisor.cleanupEvents();
  const survivors = supervisor.eventsOf(profile.id, account.id).map((entry) => entry.type);
  assert.ok(!survivors.includes('world'));
  assert.ok(survivors.includes('online') && survivors.includes('reconnecting'));
});

/**
 * Stirbt ein Bot oder verliert die Verbindung, sitzt selten jemand zufällig davor. Der Bot zieht
 * sich deshalb selbst ein Bild aus seinem eigenen (noch laufenden) texturierten Viewer.
 */
test('a bot pulls its own snapshot when it dies or disconnects, and cleanup takes the file with the row', async () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('premium'));
  const bot = new Bot(
    { emit: () => {}, macros: { onDeath: () => {}, onDisconnect: () => {} } },
    { profile, account, user, plan: billing.featuresOf(profile) }
  );

  // Kein Viewer, kein Bild – und kein Fehler dabei.
  bot.onEvent('@event death');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.eventsOf(profile.id, account.id).some((entry) => entry.type === 'snapshot'), false);

  // Ein laufender Viewer: `captureSnapshot` holt sich sein Bild über `webFetch` – hier gestellt,
  // damit der Test nicht wirklich auf 127.0.0.1 klopft.
  bot.web = { port: 1, token: 'x', since: Date.now() };
  const png = Buffer.from('ich bin ein bild');
  bot.webFetch = async () => ({ status: 200, type: 'image/png', body: png });

  bot.onEvent('@event death');
  // `captureSnapshot` läuft ohne `await` mit – auf die Mikrotask-Warteschlange warten, bis sie fertig ist.
  await new Promise((resolve) => setImmediate(resolve));

  const snap = supervisor.eventsOf(profile.id, account.id).find((entry) => entry.type === 'snapshot');
  assert.ok(snap, 'eine snapshot-Zeile steht im Verlauf');
  assert.ok(snapshots.valid(snap.detail));
  assert.deepEqual(snapshots.read(snap.detail), png);

  // Uralt machen und aufräumen: Datei und Zeile verschwinden zusammen, nicht nur eines von beiden.
  db.prepare("UPDATE bot_events SET created_at = ? WHERE type = 'snapshot'").run(
    Date.now() - 40 * 24 * 60 * 60 * 1000
  );
  supervisor.cleanupEvents();
  assert.equal(snapshots.read(snap.detail), null);
  assert.equal(supervisor.eventsOf(profile.id, account.id).some((entry) => entry.type === 'snapshot'), false);
});

/**
 * Die Zahl soll etwas über die Stabilität *seit gerade eben* sagen, nicht über die ganze
 * Lebenszeit des Bots – deshalb zählt jeder Wiederanlaufversuch, aber nur ein Mensch, der den Bot
 * selbst startet oder stoppt, darf sie auf null zurücksetzen (siehe `resetReconnectCount`).
 */
test('the reconnect counter climbs with every retry and only a human start or stop resets it', () => {
  const user = createUser();
  const account = createAccount(user);
  const profile = createProfile(user, billing.planBySlug('premium'));
  db.prepare('UPDATE profiles SET reconnect_delay = 1, max_backoff = 2 WHERE id = ?').run(profile.id);
  db.prepare("INSERT INTO bots (profile_id, account_id, state) VALUES (?, ?, 'online')").run(
    profile.id,
    account.id
  );

  const bot = new Bot({ emit: () => {}, macros: {} }, { profile, account, user, plan: billing.featuresOf(profile) });
  supervisor.bots.set(bot.key, bot);
  after(() => supervisor.bots.delete(bot.key));

  const stored = () =>
    db
      .prepare('SELECT reconnect_count FROM bots WHERE profile_id = ? AND account_id = ?')
      .get(profile.id, account.id).reconnect_count;

  assert.equal(supervisor.planRestart(bot, { wasOnline: 30_000 }), true);
  assert.equal(supervisor.planRestart(bot, { wasOnline: 0 }), true);
  assert.equal(bot.reconnectCount, 2);
  assert.equal(bot.snapshot().reconnect_count, 2);
  assert.equal(stored(), 2);

  supervisor.cancelRestart(bot.key);
  supervisor.resetReconnectCount(profile.id, account.id);
  assert.equal(bot.reconnectCount, 0);
  assert.equal(stored(), 0);
});

/**
 * Der Webhook eines Kunden meldet, was er bestellt hat – und leer heißt alles.
 *
 * Die Regel steht auf beiden Seiten (server/notify.js und views/settings.js) und ist die einzige
 * Stelle, an der eine Voreinstellung "nichts" bedeuten könnte. Sie darf es nicht: Wer einen
 * Webhook einträgt, will Bescheid wissen, und ein stummer Webhook sieht aus wie ein kaputter.
 */
test('a customer webhook sends what the customer asked for, and everything by default', async () => {
  const user = createUser();
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true };
  };
  try {
    db.prepare('UPDATE users SET discord_webhook = ? WHERE id = ?').run(
      'https://discord.com/api/webhooks/1/abc',
      user.id
    );
    const ticket = { id: 7, subject: 'Der Bot startet nicht' };

    // Ohne Auswahl: alles.
    await notify.ticketReply(user.id, ticket, 'Support', 'Schau mal in die Konsole.');
    assert.equal(sent.length, 1);
    assert.match(sent[0].embeds[0].title, /#7/);

    // Nur Guthaben bestellt – Support kommt dann nicht mehr an.
    db.prepare("UPDATE users SET discord_events = 'billing' WHERE id = ?").run(user.id);
    await notify.ticketReply(user.id, ticket, 'Support', 'Und noch etwas.');
    assert.equal(sent.length, 1, 'abbestellte Art darf nicht hinausgehen');

    await notify.topupPaid(user.id, 1000, 1000);
    assert.equal(sent.length, 2, 'bestellte Art muss hinausgehen');

    // Zwei Antworten hintereinander sind zwei Nachrichten und nicht dieselbe zweimal.
    db.prepare("UPDATE users SET discord_events = '' WHERE id = ?").run(user.id);
    await notify.ticketReply(user.id, ticket, 'Support', 'Erste');
    await notify.ticketReply(user.id, ticket, 'Support', 'Zweite');
    assert.equal(sent.length, 4);
  } finally {
    globalThis.fetch = original;
  }
});

test('account activity is kept without Discord, deduplicated and readable on every device', async () => {
  const user = createUser();

  await notify.botTrouble(user.id, 'Steve', 'Verbindung abgebrochen.');
  // Derselbe Zustand in derselben Sperrzeit ist ein Ereignis, keine Wand aus Wiederholungen.
  await notify.botTrouble(user.id, 'Steve', 'Verbindung abgebrochen.');

  const german = notify.notificationsFor(user.id, 'de');
  const english = notify.notificationsFor(user.id, 'en');
  assert.equal(german.length, 1);
  assert.equal(notify.unreadFor(user.id), 1);
  assert.match(german[0].title, /Steve/);
  assert.match(english[0].title, /problem/i);
  assert.equal(german[0].event, 'bot');
  assert.equal(german[0].tone, 'bad');
  assert.equal(german[0].href, '#/servers');

  assert.equal(notify.markRead(user.id, [german[0].id]), 1);
  assert.equal(notify.unreadFor(user.id), 0);
  assert.ok(notify.notificationsFor(user.id, 'de')[0].read_at);
  assert.equal(notify.removeRead(user.id), 1);
  assert.equal(notify.notificationsFor(user.id, 'de').length, 0);
});

test('account activity paginates without duplicates and can be put back on the unread list', () => {
  const user = createUser();
  const insert = db.prepare(
    `INSERT INTO user_notifications
       (user_id, event, tone, title_de, title_en, body_de, body_en, created_at, read_at)
     VALUES (?, ?, 'info', ?, ?, '', '', ?, ?)`
  );
  for (let index = 0; index < 7; index++) {
    insert.run(
      user.id,
      index % 2 ? 'billing' : 'ticket',
      `Meldung ${index}`,
      `Notice ${index}`,
      Date.now() + index,
      index < 2 ? Date.now() : null
    );
  }

  const first = notify.notificationsFor(user.id, 'en', { limit: 3 });
  const second = notify.notificationsFor(user.id, 'en', { limit: 3, before: first.at(-1).id });
  assert.equal(first.length, 3);
  assert.equal(second.length, 3);
  assert.ok(first.every((entry) => !second.some((other) => other.id === entry.id)));
  assert.deepEqual(
    [...first, ...second].map((entry) => entry.id),
    [...first, ...second].map((entry) => entry.id).sort((a, b) => b - a)
  );

  const billing = notify.notificationsFor(user.id, 'de', { limit: 10, event: 'billing' });
  assert.equal(billing.length, 3);
  assert.ok(billing.every((entry) => entry.event === 'billing'));

  const alreadyRead = notify.notificationsFor(user.id, 'en', { limit: 10 }).find((entry) => entry.read_at);
  assert.equal(notify.markUnread(user.id, [alreadyRead.id]), 1);
  assert.equal(
    notify.notificationsFor(user.id, 'en', { limit: 10 }).find((entry) => entry.id === alreadyRead.id).read_at,
    null
  );
  // Fremde und ungültige IDs verändern nichts.
  assert.equal(notify.markUnread(user.id, [alreadyRead.id, -1, 999_999]), 0);
});

/** Die To-do-Liste des Teams zählt Warteschlangen – und schweigt, wenn nichts wartet. */
test('the staff to-do list names what is waiting', () => {
  const owner = createUser();
  const before = staffTodos('de').length;

  const info = db
    .prepare(
      `INSERT INTO tickets (user_id, subject, category, status, priority, source, unread_staff, unread_user, created_at, updated_at)
       VALUES (?, 'Warten auf Antwort', 'general', 'open', 'urgent', 'panel', 1, 0, ?, ?)`
    )
    .run(owner.id, Date.now(), Date.now());
  const after = staffTodos('de');
  const entry = after.find((row) => row.key === 'staff-tickets');
  assert.ok(entry, 'ein wartendes Ticket gehört auf die Liste');
  assert.equal(entry.kind, 'bad', 'dringend heißt dringend');
  assert.match(entry.href, /^#\/admin\/tickets/);
  assert.ok(after.length > before);

  db.prepare('DELETE FROM tickets WHERE id = ?').run(info.lastInsertRowid);
  assert.ok(!staffTodos('de').some((row) => row.key === 'staff-tickets'));
});

/**
 * Der Zustand eines Tickets sagt, **wer am Zug ist** – und der Ungelesen-Punkt des Teams steht
 * nur dort, wo etwas offen ist. Beides lief auseinander: Der Punkt wurde beim Antworten gelöscht,
 * beim Umstellen des Zustands aber nie, und so stand an beantworteten und geschlossenen Tickets
 * weiter „Wartet“.
 */
test('a ticket knows who is on the clock, and nothing waits on an answered or closed one', () => {
  const owner = createUser();
  const staff = createUser({ role: 'admin' });
  const row = (id) => db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  const queue = () => tickets.openForStaff();

  const before = queue();
  const ticket = tickets.create(owner, { subject: 'Der Bot startet nicht', body: 'Er hängt.' });
  assert.equal(row(ticket.id).status, 'open');
  assert.equal(row(ticket.id).unread_staff, 1);
  assert.equal(row(ticket.id).unread_user, 0);
  assert.equal(queue(), before + 1, 'ein offenes Ticket liegt bei uns');

  // Das Team antwortet: jetzt ist der Kunde dran, und in der Warteschlange steht es nicht mehr.
  tickets.reply(ticket, staff, 'Schau mal in die Konsole.', { staff: true });
  assert.deepEqual(
    { status: row(ticket.id).status, staff: row(ticket.id).unread_staff, user: row(ticket.id).unread_user },
    { status: 'answered', staff: 0, user: 1 }
  );
  assert.equal(queue(), before);

  // Der Kunde schreibt zurück: wieder bei uns.
  tickets.reply(row(ticket.id), owner, 'Da steht nichts.', { staff: false });
  assert.equal(row(ticket.id).status, 'open');
  assert.equal(row(ticket.id).unread_staff, 1);

  // Von Hand auf „beantwortet“, ohne zu antworten. Auch dann wartet beim Team nichts mehr –
  // genau daran hing das „Wartet“ an einem beantworteten Ticket.
  tickets.setStatus(row(ticket.id), 'answered', staff.id, { staff: true });
  assert.equal(row(ticket.id).unread_staff, 0);
  assert.equal(queue(), before);

  // Den vierten Zustand gibt es nicht mehr; wer ihn noch schickt, meint „beantwortet“.
  assert.ok(!tickets.STATUSES.includes('waiting'));
  tickets.setStatus(row(ticket.id), 'waiting', staff.id, { staff: true });
  assert.equal(row(ticket.id).status, 'answered');

  // Das Team schließt: für den Kunden ist das eine Neuigkeit, für uns ist es erledigt.
  tickets.setStatus(row(ticket.id), 'closed', staff.id, { staff: true });
  assert.deepEqual(
    { status: row(ticket.id).status, staff: row(ticket.id).unread_staff, user: row(ticket.id).unread_user },
    { status: 'closed', staff: 0, user: 1 }
  );
  assert.ok(row(ticket.id).closed_at);

  // Eine Antwort des Teams macht ein geschlossenes Ticket wieder auf – mit Zeile im Verlauf und
  // gezählt. Vorher galt beides nur für die Antwort eines Kunden.
  tickets.reply(row(ticket.id), staff, 'Nachtrag.', { staff: true });
  assert.equal(row(ticket.id).status, 'answered');
  assert.equal(row(ticket.id).closed_at, null);
  assert.equal(row(ticket.id).reopened, 1);
  assert.match(lastSystemLine(ticket.id), /reopened/);

  // Der Kunde schließt selbst: er weiß es bereits, also steht bei ihm nichts Ungelesenes.
  tickets.setStatus(row(ticket.id), 'closed', owner.id, { staff: false });
  assert.equal(row(ticket.id).unread_user, 0);

  // Und ein Ticket, das das Team für einen Kunden schreibt, landet nicht in der eigenen
  // Warteschlange: Der Kunde ist am Zug, nicht wir.
  const forCustomer = tickets.create(
    owner,
    { subject: 'Nach dem Gespräch', body: 'Schick mir bitte den Screenshot.' },
    { by: staff.id, source: 'staff', staffPriority: true }
  );
  assert.deepEqual(
    { status: forCustomer.status, staff: forCustomer.unread_staff, user: forCustomer.unread_user },
    { status: 'answered', staff: 0, user: 1 }
  );
  assert.equal(queue(), before);
});

const lastSystemLine = (ticketId) =>
  db
    .prepare("SELECT body FROM ticket_messages WHERE ticket_id = ? AND role = 'system' ORDER BY id DESC LIMIT 1")
    .get(ticketId).body;

/** Die Dringlichkeit setzt das Team – und was gesetzt wurde, steht im Verlauf. */
test('an administrator changes the priority and the ticket history says so', () => {
  const owner = createUser();
  const staff = createUser({ role: 'admin' });
  const ticket = tickets.create(owner, { subject: 'Proxy bitte', body: 'Für den zweiten Platz.' });
  assert.equal(ticket.priority, 'normal');

  const raised = tickets.setPriority(ticket, 'urgent', staff.id);
  assert.equal(raised.priority, 'urgent');
  assert.match(lastSystemLine(ticket.id), /normal to urgent/);

  // Dieselbe Dringlichkeit noch einmal schreibt keine zweite Zeile.
  const lines = db
    .prepare("SELECT COUNT(*) AS n FROM ticket_messages WHERE ticket_id = ? AND role = 'system'")
    .get(ticket.id).n;
  tickets.setPriority(raised, 'urgent', staff.id);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM ticket_messages WHERE ticket_id = ? AND role = 'system'")
      .get(ticket.id).n,
    lines
  );
  assert.throws(() => tickets.setPriority(raised, 'sofort', staff.id), /Dringlichkeit/);
});

/**
 * **Bis wohin hat die andere Seite gelesen?**
 *
 * Der Ungelesen-Punkt beantwortet das nicht: Er verschwindet, sobald jemand ein Ticket aufmacht –
 * auch dann, wenn die Antwort erst danach geschrieben wird. Die Marke je Person hält deshalb die
 * Nummer der letzten gesehenen Nachricht und geht nur vorwärts.
 */
test('a read mark says who saw how far, moves only forward, and knows two roles per person', () => {
  const owner = createUser();
  const staff = createUser({ role: 'admin' });
  const row = (id) => db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  const markOf = (ticketId, userId, asStaff) =>
    tickets.reads(ticketId).find((entry) => entry.user_id === userId && entry.staff === asStaff);

  const ticket = tickets.create(owner, { subject: 'Bot hängt', body: 'Beim Login.' });

  // Wer schreibt, hat gelesen: Die erste Nachricht steht nicht als ungelesen beim eigenen Autor.
  const first = db
    .prepare('SELECT MAX(id) AS id FROM ticket_messages WHERE ticket_id = ?')
    .get(ticket.id).id;
  assert.equal(markOf(ticket.id, owner.id, false).last_message_id, first);
  assert.equal(markOf(ticket.id, staff.id, true), undefined);

  // Das Team liest – und bekommt zurück, wo es vorher stand. Daraus entsteht der Strich
  // „Neue Nachrichten“ im Verlauf.
  assert.equal(tickets.markRead(row(ticket.id), staff, { staff: true }), 0);
  assert.equal(markOf(ticket.id, staff.id, true).last_message_id, first);

  // Ein zweites Öffnen ohne neue Nachricht verschiebt nichts.
  const at = markOf(ticket.id, staff.id, true).read_at;
  assert.equal(tickets.markRead(row(ticket.id), staff, { staff: true }), first);
  assert.equal(markOf(ticket.id, staff.id, true).read_at, at);

  // Die Antwort des Teams steht beim Kunden als ungelesen: Seine Marke bleibt auf der ersten
  // Nachricht stehen, obwohl er das Ticket längst offen hatte.
  tickets.reply(row(ticket.id), staff, 'Schau in die Konsole.', { staff: true });
  const second = db
    .prepare('SELECT MAX(id) AS id FROM ticket_messages WHERE ticket_id = ?')
    .get(ticket.id).id;
  assert.equal(markOf(ticket.id, owner.id, false).last_message_id, first);
  assert.equal(markOf(ticket.id, staff.id, true).last_message_id, second);

  // Erst wenn er sie aufmacht, rückt sie vor – und die Teamliste sagt „gelesen“.
  const listed = () => tickets.listAll({ status: null }).find((entry) => entry.id === ticket.id);
  assert.equal(listed().seen_at, null);
  tickets.markRead(row(ticket.id), owner, { staff: false });
  assert.equal(markOf(ticket.id, owner.id, false).last_message_id, second);
  assert.ok(listed().seen_at);

  // Derselbe Mensch in zwei Rollen: Ein Administrator, der sein *eigenes* Ticket unter „Support“
  // liest, darf damit nicht die Marke des Teams setzen – und umgekehrt.
  const own = tickets.create(staff, { subject: 'Eigenes', body: 'Frage.' });
  tickets.markRead(row(own.id), staff, { staff: false });
  assert.ok(markOf(own.id, staff.id, false));
  assert.equal(markOf(own.id, staff.id, true), undefined);
});

/**
 * Die Zahlen, an denen sich ein Support messen lässt: Wann kam die erste Antwort, wer war zuletzt
 * am Zug. Eine **interne Notiz** zählt dabei nicht als Antwort – wer eine Notiz schreibt, hat dem
 * Kunden nichts gesagt.
 */
test('a ticket records when the team first answered, and an internal note is not an answer', () => {
  const owner = createUser();
  const staff = createUser({ role: 'admin' });
  const row = (id) => db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);

  const ticket = tickets.create(owner, { subject: 'Proxy', body: 'Bitte einen.' });
  assert.equal(row(ticket.id).first_reply_at, null);
  assert.ok(row(ticket.id).last_customer_at);
  assert.equal(row(ticket.id).last_staff_at, null);

  tickets.reply(row(ticket.id), staff, 'Kümmere mich.', { staff: true, internal: true });
  assert.equal(row(ticket.id).first_reply_at, null);
  assert.equal(row(ticket.id).last_staff_at, null);

  tickets.reply(row(ticket.id), staff, 'Ist eingerichtet.', { staff: true });
  const answered = row(ticket.id).first_reply_at;
  assert.ok(answered);

  // Die erste Antwort bleibt die erste, auch nach der zweiten.
  tickets.reply(row(ticket.id), staff, 'Und noch etwas.', { staff: true });
  assert.equal(row(ticket.id).first_reply_at, answered);
  assert.ok(row(ticket.id).last_staff_at >= answered);

  // Ein Ticket, das das Team selbst mit einer Nachricht aufmacht, hat nie auf eine Antwort
  // gewartet – es steht deshalb nicht in der Liste der unbeantworteten.
  const staffMade = tickets.create(owner, { subject: 'Hinweis', body: 'Wir haben umgestellt.' }, { by: staff.id });
  assert.ok(row(staffMade.id).first_reply_at);
  assert.ok(!tickets.listAll({ unanswered: true }).some((entry) => entry.id === staffMade.id));
});

/**
 * Ein Zustandswechsel und ein Wechsel der Zuständigkeit sind Entscheidungen – sie gehören in den
 * Verlauf. Wer ein Ticket später aufmacht, soll sehen, wer es geschlossen hat, statt sich zu
 * fragen, ob es jemand abgeschlossen oder nur weggeklickt hat. **Wer** von uns es übernommen hat,
 * ist dagegen Arbeitsteilung und bleibt intern.
 */
test('status and assignment write a line in the history, and the assignment line stays internal', () => {
  const owner = createUser();
  const staff = createUser({ role: 'admin' });
  const row = (id) => db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  const seenBy = (ticketId, asStaff) =>
    tickets.messages(ticketId, { staff: asStaff }).filter((entry) => entry.role === 'system');

  const ticket = tickets.create(owner, { subject: 'Frage', body: 'Kurz.' });

  tickets.setAssignee(row(ticket.id), staff.id, staff.id);
  assert.equal(row(ticket.id).assigned_to, staff.id);
  assert.equal(seenBy(ticket.id, false).length, 0, 'die Zuweisung geht den Kunden nichts an');
  assert.equal(seenBy(ticket.id, true).at(-1).meta.key, 'took');

  // Dieselbe Zuweisung noch einmal schreibt keine zweite Zeile.
  const lines = seenBy(ticket.id, true).length;
  tickets.setAssignee(row(ticket.id), staff.id, staff.id);
  assert.equal(seenBy(ticket.id, true).length, lines);

  tickets.setStatus(row(ticket.id), 'closed', staff.id, { staff: true });
  const closed = seenBy(ticket.id, false).at(-1);
  assert.equal(closed.meta.key, 'status.closed');
  assert.match(closed.body, /closed/);

  // Und derselbe Zustand noch einmal bleibt still.
  const after = seenBy(ticket.id, false).length;
  tickets.setStatus(row(ticket.id), 'closed', staff.id, { staff: true });
  assert.equal(seenBy(ticket.id, false).length, after);
});

/**
 * Ein Ticket aus dem Panel bekommt einen Kanal in Discord – auch dann, wenn der Bot in dem
 * Moment nicht lief, in dem es entstand. Der Abgleich füllt die Lücken.
 */
test('the reconcile pass opens the Discord channels that are missing', async () => {
  const list = [
    { id: 901, status: 'open', channel_id: null, owner: { discord_id: '400000000000000001' } },
    { id: 902, status: 'open', channel_id: 'deleted-by-hand', owner: {} },
    { id: 903, status: 'closed', channel_id: null, owner: {} },
    { id: 904, status: 'answered', channel_id: 'still-there', owner: {} },
  ];
  const opened = [];
  const released = [];
  const renamed = [];
  const fake = {
    opening: new Set(),
    ensureChannel: Tickets.prototype.ensureChannel,
    bot: {
      panel: {
        call: async (path, options) => {
          if (path.startsWith('/tickets?')) return { tickets: list };
          const match = /^\/tickets\/(\d+)$/.exec(path);
          if (!match) throw new Error(`unexpected call: ${path}`);
          if (options?.method === 'PATCH') {
            released.push(Number(match[1]));
            return {};
          }
          return { ticket: list.find((entry) => entry.id === Number(match[1])) };
        },
      },
      client: {
        channels: {
          fetch: async (id) => (id === 'still-there' ? { id, isTextBased: () => true } : null),
        },
      },
    },
    openChannel: async (ticket) => {
      opened.push(ticket.id);
      return { id: `channel-${ticket.id}` };
    },
    archiveChannel: async () => {},
    reopenChannel: async (_channel, id) => renamed.push(id),
  };

  const count = await Tickets.prototype.reconcileChannels.call(fake);
  // Das offene ohne Kanal und das mit einem, den es in Discord nicht mehr gibt.
  assert.deepEqual(opened, [901, 902]);
  assert.equal(count, 2);
  // Für das gelöschte wird die tote Zuordnung im Panel vorher gelöst.
  assert.deepEqual(released, [902]);
  // Ein geschlossenes Ticket bekommt keinen neuen Kanal, ein vorhandener wird nur eingeordnet.
  assert.deepEqual(renamed, [904]);
});

test('a ticket channel replaces member messages with a bot embed', async () => {
  const calls = [];
  const relayed = [];
  const deleted = [];
  const source = {
    id: 'discord-message-1',
    author: { bot: false, id: '400000000000000001', username: 'customer' },
    member: { displayName: 'Customer' },
    content: 'The bot does not connect.',
    attachments: new Map(),
    channel: { name: 'ticket-77' },
    delete: async () => deleted.push('source'),
  };
  const fake = {
    mine: new Set(),
    bot: {
      panel: {
        call: async (path, options) => {
          calls.push({ path, options });
          return {
            ticket: { url: 'https://example.test/en/app#/tickets/77' },
            message: {
              role: 'staff',
              author: 'Team',
              body: 'The bot does not connect.',
              files: [],
              created_at: Date.now(),
            },
            failed: [],
          };
        },
      },
    },
    ticketUrl: (id) => `https://example.test/en/app#/tickets/${id}`,
    relayToDiscord: async (channel, entry, ticket) => relayed.push({ channel, entry, ticket }),
    notice: async () => assert.fail('a successful sync needs no error notice'),
  };

  await Tickets.prototype.onMessage.call(fake, source);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/tickets/77/messages');
  assert.deepEqual(deleted, ['source']);
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].entry.author, 'Team');
  assert.equal(relayed[0].entry.discord_id, undefined, 'the replacement must not be skipped as an original');
});

/** Die Kontakt-Adresse: im Fuß jeder Seite – aber nur, wenn dort wirklich eine steht. */
test('the contact address is offered in the footer, and only when it is one', async () => {
  const landing = await import('../server/landing.js');
  setSetting('support_email', 'support@afksystems.de');
  assert.match(landing.commonVars('de').footerSupport, /mailto:support@afksystems\.de/);
  assert.equal(landing.commonVars('de').supportMail, 'support@afksystems.de');

  setSetting('support_email', 'schreib uns doch einfach');
  assert.equal(landing.commonVars('de').footerSupport, '');
  assert.equal(landing.commonVars('en').supportMail, '');
  setSetting('support_email', 'support@afksystems.de');
});

test('a self-written legal text that still names the old payment provider is flagged', () => {
  // Selbst geschriebene Rechtstexte werden von einer Migration nicht angefasst – wer seinen Text
  // selbst verfasst hat, behält ihn. Dann muss aber jemand darauf hingewiesen werden: In der
  // Datenschutzerklärung stünde sonst ein Empfänger, an den nichts mehr geht.
  assert.ok(!staffTodos('de').some((row) => row.key === 'staff-legal-provider'));
  setSetting('legal_privacy', 'Zahlungen laufen über Tebex (Tebex Limited).');
  const entry = staffTodos('de').find((row) => row.key === 'staff-legal-provider');
  assert.ok(entry, 'ein veralteter Zahlungsanbieter im Rechtstext gehört auf die Liste');
  assert.match(entry.href, /group=legal/);

  // Die Systemvorgabe nennt Stripe – ein leeres Feld darf die Warnung nicht auslösen.
  setSetting('legal_privacy', '');
  assert.ok(!staffTodos('de').some((row) => row.key === 'staff-legal-provider'));
});

test('an address block matches single addresses and whole networks, in both address families', () => {
  assert.ok(security.ipMatches('203.0.113.7', '203.0.113.7'));
  assert.ok(!security.ipMatches('203.0.113.7', '203.0.113.8'));
  assert.ok(security.ipMatches('203.0.113.0/24', '203.0.113.200'));
  assert.ok(!security.ipMatches('203.0.113.0/24', '203.0.114.1'));
  assert.ok(security.ipMatches('0.0.0.0/0', '8.8.8.8'));

  // Dieselbe Adresse in zwei Schreibweisen: Node liefert IPv4 über einen IPv6-Socket so. Eine
  // Sperre, die das nicht erkennt, sperrt ins Leere.
  assert.ok(security.ipMatches('203.0.113.7', '::ffff:203.0.113.7'));

  assert.ok(security.ipMatches('2001:db8::/32', '2001:db8:1234::1'));
  assert.ok(!security.ipMatches('2001:db8::/32', '2001:db9::1'));
  // Ein IPv4-Netz enthält keine IPv6-Adresse, auch wenn die Zahlen zufällig passen.
  assert.ok(!security.ipMatches('0.0.0.0/0', '2001:db8::1'));

  assert.equal(security.validBlock('203.0.113.0/24'), '203.0.113.0/24');
  assert.equal(security.validBlock('203.0.113.999'), null);
  assert.equal(security.validBlock('203.0.113.0/33'), null);
  assert.equal(security.validBlock('kein netz'), null);
});

test('the block list keeps the operator out of their own trap', () => {
  const admin = createUser({ role: 'admin' });
  assert.throws(
    () => security.addBlock({ value: '198.51.100.0/24', by: admin.id, ownIp: '198.51.100.12' }),
    /eigene Adresse/
  );
  security.addBlock({ value: '198.51.100.0/24', by: admin.id, ownIp: '203.0.113.5', reason: 'Bot-Netz' });
  assert.ok(security.blockFor('198.51.100.77'));
  assert.ok(!security.blockFor('203.0.113.5'));

  // Abgelaufen ist wie nicht gesperrt – ohne dass jemand aufräumen muss.
  db.prepare(
    'INSERT INTO ip_blocks (value, reason, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run('198.51.101.200', 'abgelaufen', admin.id, Date.now() - 86_400_000, Date.now() - 1_000);
  // Der nächste Eintrag lädt die Liste neu; danach steht die abgelaufene Sperre zwar noch da,
  // greift aber nicht mehr.
  security.addBlock({ value: '198.51.101.201', by: admin.id });
  assert.ok(security.listBlocks().find((entry) => entry.value === '198.51.101.200').expired);
  assert.ok(!security.blockFor('198.51.101.200'));
  assert.ok(security.blockFor('198.51.101.201'));

  const row = security.listBlocks().find((entry) => entry.value === '198.51.100.0/24');
  assert.ok(security.removeBlock(row.id, admin.id));
  assert.ok(!security.blockFor('198.51.100.77'));
});

test('failed sign-ins are counted per address and per account, and success does not clear them', () => {
  db.prepare('DELETE FROM login_attempts').run();
  const ip = '192.0.2.44';
  for (let i = 0; i < security.MAX_PER_IP - 1; i++) {
    security.record({ ip, identifier: `opfer${i}@example.test`, ok: false, reason: 'wrong' });
  }
  assert.equal(security.tooMany(ip, 'jemand@example.test'), null);
  security.record({ ip, identifier: 'noch-einer@example.test', ok: false, reason: 'wrong' });
  assert.equal(security.tooMany(ip, 'jemand@example.test').scope, 'ip');

  // Eine geglückte Anmeldung setzt nichts zurück: Sonst räumte der Angreifer beim ersten
  // erratenen Passwort seinen eigenen Zähler ab.
  security.record({ ip, identifier: 'jemand@example.test', ok: true });
  assert.equal(security.tooMany(ip, 'jemand@example.test').scope, 'ip');

  // Von vielen Adressen auf **ein** Konto: die zweite, großzügigere Grenze.
  db.prepare('DELETE FROM login_attempts').run();
  for (let i = 0; i < security.MAX_PER_ACCOUNT; i++) {
    security.record({ ip: `192.0.2.${i + 100}`, identifier: 'ziel@example.test', ok: false, reason: 'wrong' });
  }
  assert.equal(security.tooMany('192.0.2.250', 'ziel@example.test').scope, 'account');
  assert.equal(security.tooMany('192.0.2.250', 'jemand-anderes@example.test'), null);
  db.prepare('DELETE FROM login_attempts').run();
});

test('a backup is a complete, openable database and the oldest ones make room', () => {
  const made = backup.create();
  assert.match(made.name, /-\d{4}-\d{2}-\d{2}-\d{4}\.db$/);
  assert.ok(made.size > 0);

  // Der Sinn der Sache: Die Datei lässt sich öffnen und enthält, was die Datenbank enthält – und
  // zwar den Stand von **jetzt**, nicht den vom letzten Checkpoint des Schreibprotokolls.
  const marker = `sicherung-${Date.now()}@example.test`;
  createUser({ email: marker });
  const second = backup.create();
  const copy = new Database(path.join(TEST_DIR, 'backups', second.name), { readonly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(marker).n, 1);
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  copy.close();

  // Zwei Sicherungen in derselben Minute sind kein Fehlerfall, sondern zweimal geklickt.
  assert.notEqual(made.name, second.name);

  setSetting('backup_keep', '1');
  backup.create();
  assert.equal(backup.list().length, 1, 'ältere werden weggeräumt, sobald eine neue da ist');
  setSetting('backup_keep', '14');

  assert.equal(backup.fileFor('../../etc/passwd'), null);
  assert.equal(backup.fileFor('irgendwas.db'), null);
});

// ---------------------------------------------------------------- Persönliche Daten

test('personal details are checked, tidied and stored in one canonical shape', () => {
  const user = createUser();

  const clean = profile.readChanges({
    full_name: '  Hugo   Muster ',
    company: 'Muster GmbH',
    vat_id: 'atu 123.456.78',
    street: 'Hauptstraße 1',
    postal_code: '1010',
    city: 'Wien',
    country: 'at',
    phone: '+43 660 1234567',
    timezone: 'Europe/Vienna',
  });
  // Zusammengezogener Leerraum, Land und Steuernummer in fester Schreibweise.
  assert.equal(clean.full_name, 'Hugo Muster');
  assert.equal(clean.country, 'AT');
  assert.equal(clean.vat_id, 'ATU12345678');

  // Steuerzeichen haben in einer Anschrift nichts verloren – sie brächen jeden Beleg auseinander.
  assert.equal(profile.readChanges({ city: 'Wien\u0000\nGraz' }).city, 'Wien Graz');

  for (const [field, value] of [
    ['country', 'XX'],
    ['vat_id', 'hallo'],
    ['phone', 'ruf mich an'],
    ['timezone', 'Mittelerde/Auenland'],
    ['billing_email', 'keine adresse'],
  ]) {
    assert.throws(() => profile.readChanges({ [field]: value }), `${field} sollte abgelehnt werden`);
  }

  // Ein Feld, das gar nicht im Rumpf stand, wird nicht angefasst – sonst löscht jedes Speichern
  // eines einzelnen Feldes den ganzen Rest.
  profile.applyChanges(user.id, clean);
  profile.applyChanges(user.id, profile.readChanges({ city: 'Graz' }));
  const stored = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  assert.equal(stored.city, 'Graz');
  assert.equal(stored.street, 'Hauptstraße 1');

  // Die Anschrift auf dem Beleg: Firma, Name, Straße, PLZ + Ort, Land – in dieser Reihenfolge.
  assert.deepEqual(profile.addressLines(stored, 'de'), [
    'Muster GmbH',
    'Hugo Muster',
    'Hauptstraße 1',
    '1010 Graz',
    'Österreich',
  ]);
  // In den Vereinigten Staaten steht der Ort vorn und die Postleitzahl hinter dem Bundesstaat.
  assert.deepEqual(
    profile.addressLines(
      { full_name: 'Jane Doe', street: '1 Main St', city: 'Springfield', region: 'IL', postal_code: '62704', country: 'US' },
      'en'
    ),
    ['Jane Doe', '1 Main St', 'Springfield, IL 62704', 'United States']
  );
});

test('the username has a cooldown and the email only moves once the new address confirms', async () => {
  const user = createUser({ username: 'umzugsfall' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword('passwort123'), user.id);
  const fresh = () => db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

  const renamed = auth.changeUsername(fresh(), 'Umzugsfall2');
  assert.equal(renamed.username, 'Umzugsfall2');
  // Zweimal hintereinander geht nicht – ein Name, der stündlich wechselt, macht jeden Verlauf
  // unlesbar.
  assert.throws(() => auth.changeUsername(fresh(), 'Umzugsfall3'), /30 Tag|30 day/);

  // Nur die Schreibweise ändern: Der eigene Name darf dabei nicht als "schon vergeben" gelten.
  db.prepare('UPDATE users SET username_changed_at = NULL WHERE id = ?').run(user.id);
  assert.equal(auth.changeUsername(fresh(), 'UMZUGSFALL2').username, 'UMZUGSFALL2');

  // Die E-Mail-Adresse braucht das Passwort **und** eine Bestätigung an der neuen Adresse.
  setSetting('smtp_host', 'localhost');
  await assert.rejects(
    () => auth.requestEmailChange(fresh(), 'neu@example.test', 'falsch'),
    /Passwort|password/
  );
  let emailChangeToken = null;
  await auth.requestEmailChange(fresh(), 'neu@example.test', 'passwort123', {
    onToken: (value) => (emailChangeToken = value),
  });
  assert.equal(fresh().pending_email, 'neu@example.test');
  assert.notEqual(fresh().pending_email_token, emailChangeToken);
  // Bis zur Bestätigung gilt die alte Adresse – ein Tippfehler sperrt also niemanden aus.
  assert.notEqual(fresh().email, 'neu@example.test');

  const confirmed = auth.confirmEmailChange(emailChangeToken);
  assert.equal(confirmed.email, 'neu@example.test');
  assert.equal(fresh().pending_email, null);
  // Ein zweites Mal löst derselbe Link nichts mehr aus.
  assert.equal(auth.confirmEmailChange('gibt-es-nicht'), null);
  setSetting('smtp_host', '');
});

test('open sessions are listed without their tokens and can be ended one at a time', () => {
  const user = createUser();
  createSession(user, 'sitzung-eins');
  createSession(user, 'sitzung-zwei');
  db.prepare('UPDATE sessions SET agent = ? WHERE token = ?').run(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    'sitzung-eins'
  );

  const list = auth.sessionsOf(user.id, 'sitzung-eins');
  assert.equal(list.length, 2);
  // **Kein Token in der Antwort.** Es ist die Anmeldung selbst; eine Seite, die alle Token des
  // Kontos im Speicher hält, verschenkt bei der ersten Lücke jedes Gerät mit.
  for (const entry of list) {
    assert.ok(!('token' in entry));
    assert.match(entry.ref, /^[0-9a-f]{16}$/);
  }
  assert.equal(list.find((entry) => entry.current)?.device, 'Chrome · Linux');

  const other = list.find((entry) => !entry.current);
  // Die eigene Sitzung bleibt, auch wenn ihr Abdruck genannt wird.
  assert.equal(auth.endSession(user.id, list.find((entry) => entry.current).ref, 'sitzung-eins'), false);
  assert.equal(auth.endSession(user.id, other.ref, 'sitzung-eins'), true);
  assert.equal(auth.sessionsOf(user.id, 'sitzung-eins').length, 1);
  // Ein geratener Abdruck meldet kein fremdes Gerät ab.
  assert.equal(auth.endSession(user.id, '0'.repeat(16), 'sitzung-eins'), false);

  // Neue Sitzungen liegen nicht als benutzbares Cookie in der Datenbank. Eine kopierte SQLite-
  // Datei allein darf keine laufende Anmeldung übernehmen können.
  const cookies = {};
  const raw = auth.createSession(
    { cookie: (name, value) => (cookies[name] = value) },
    user,
    { ip: '198.51.100.8', headers: { 'user-agent': 'Test browser' } }
  );
  const stored = db
    .prepare('SELECT token FROM sessions WHERE user_id = ? AND ip = ?')
    .get(user.id, '198.51.100.8').token;
  assert.equal(cookies.afk_session, raw);
  assert.notEqual(stored, raw);
  assert.match(stored, /^h1:[0-9a-f]{64}$/);
});

test('"log out everywhere else" keeps the browser that pressed it', () => {
  const user = createUser();
  const jar = {};
  const res = { cookie: (name, value) => (jar[name] = value) };
  const req = { ip: '198.51.100.9', headers: { 'user-agent': 'Test browser' } };

  auth.createSession(res, user, req);
  const mine = db
    .prepare('SELECT token FROM sessions WHERE user_id = ? ORDER BY rowid DESC LIMIT 1')
    .get(user.id).token;
  auth.createSession(res, user, req);
  auth.createSession(res, user, req);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 3);

  // Verglichen wird der **gespeicherte** Wert. Mit dem rohen Cookie träfe `token != ?` auf jede
  // Zeile zu – der Knopf hätte dann auch die Sitzung mitgenommen, an der gerade jemand sitzt.
  assert.equal(auth.endOtherSessions(user.id, mine), 2);
  const left = db.prepare('SELECT token FROM sessions WHERE user_id = ?').all(user.id);
  assert.deepEqual(left.map((row) => row.token), [mine]);

  // Ohne bekannte eigene Sitzung heißt "alle anderen" eben: alle.
  assert.equal(auth.endOtherSessions(user.id, null), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 0);
});

test('a borrowed view expires after an hour, an ordinary sign-in after the usual time', () => {
  const user = createUser();
  const res = { cookie: () => {} };
  const req = { ip: '198.51.100.10', headers: { 'user-agent': 'Test browser' } };
  const expiryOf = () =>
    db.prepare('SELECT expires_at FROM sessions WHERE user_id = ? ORDER BY rowid DESC LIMIT 1').get(user.id)
      .expires_at;

  auth.createSession(res, user, req);
  const ordinary = expiryOf() - Date.now();
  assert.ok(ordinary > 20 * 86_400_000, `eine gewöhnliche Sitzung hält lange (${ordinary} ms)`);

  auth.createSession(res, user, req, { impersonatorId: 1, maxAgeMs: auth.IMPERSONATION_MS });
  const borrowed = expiryOf() - Date.now();
  assert.ok(borrowed <= auth.IMPERSONATION_MS, `eine geliehene Ansicht nicht (${borrowed} ms)`);
  assert.ok(borrowed > 55 * 60_000);

  // Und niemand verlängert sich damit über die normale Grenze hinaus.
  auth.createSession(res, user, req, { maxAgeMs: 400 * 86_400_000 });
  assert.ok(expiryOf() - Date.now() <= 31 * 86_400_000);
});

test('a password needs more than twelve characters to be one', () => {
  const identity = { username: 'hugo', email: 'hugo@example.test' };
  // Lang genug und trotzdem in jeder Liste, mit der ein Angreifer anfängt.
  assert.throws(() => auth.checkPasswordPair('123456789012', '123456789012'), /erraten/);
  assert.throws(() => auth.checkPasswordPair('aaaaaaaaaaaa', 'aaaaaaaaaaaa'), /erraten/);
  assert.throws(() => auth.checkPasswordPair('PasswortPasswort', 'PasswortPasswort'), /erraten/);
  // Der eigene Name ist das Erste, was jemand probiert, der ihn kennt – und ihn kennt jeder.
  assert.throws(() => auth.checkPasswordPair('hugohugohugo', 'hugohugohugo', identity), /Benutzernamen/);
  assert.throws(() => auth.checkPasswordPair('bitte-hugo-rein', 'bitte-hugo-rein', identity), /Benutzernamen/);
  // Zu kurz und ungleich bleiben, was sie waren.
  assert.throws(() => auth.checkPasswordPair('kurz', 'kurz'), /12 Zeichen/);
  assert.throws(() => auth.checkPasswordPair('richtig-langes-passwort', 'anderes'), /nicht gleich/);
  // Und ein gewöhnliches gutes Passwort kommt durch, auch mit Identität daneben.
  assert.doesNotThrow(() => auth.checkPasswordPair('Weizenfeld-Kartoffel-7', 'Weizenfeld-Kartoffel-7', identity));
});

test('a location token cannot be guessed without limit or locked out by strangers', async () => {
  const { tryNodeToken } = await import('../server/routes/node.js');
  const nodes = await import('../server/nodes.js');
  const node = nodes.create({ name: 'Bremse', kind: 'agent' }, null);
  const withToken = (value) => ({ headers: { authorization: `Bearer ${value}` } });
  const ip = '203.0.113.77';

  // Zwanzig Fehlversuche je Adresse und Viertelstunde – danach bleiben weitere falsche Werte zu.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal(tryNodeToken(ip, withToken(`falsch-${attempt}-${'x'.repeat(20)}`)).status, 'wrong');
  }
  assert.equal(tryNodeToken(ip, withToken(`noch-falsch-${'x'.repeat(20)}`)).status, 'throttled');
  // Das echte, zufällige Token bleibt gültig. Sonst könnten Fremde mit zwanzig Verbindungen den
  // ganzen Standort und alle Bots darauf aussperren, ohne das Token zu kennen.
  assert.equal(tryNodeToken(ip, withToken(node.token)).status, 'ok');
  // Eine andere Adresse hat ihren eigenen Zähler und kommt weiterhin herein.
  const other = tryNodeToken('203.0.113.78', withToken(node.token));
  assert.equal(other.status, 'ok');
  assert.equal(other.node.id, node.id);
  // Und ein geglückter Versuch löscht den Zähler dieser Adresse wieder.
  assert.equal(tryNodeToken('203.0.113.78', withToken('zu-kurz')).status, 'wrong');
  assert.equal(tryNodeToken('203.0.113.78', withToken(node.token)).status, 'ok');
});

test('a location stops taking server slots at its disk limit', async () => {
  const nodes = await import('../server/nodes.js');
  const node = nodes.create(
    { name: 'Plattengrenze', kind: 'agent', max_cpu_percent: 100, max_mem_percent: 100, max_disk_percent: 90 },
    null
  );
  db.prepare('UPDATE nodes SET stats = ? WHERE id = ?').run(
    JSON.stringify({
      cpu_percent: 20,
      memory: { percent: 30 },
      disk: { percent: 90, used: 90, total: 100 },
    }),
    node.id
  );
  assert.equal(nodes.isFull(nodes.byId(node.id)), true);

  db.prepare('UPDATE nodes SET max_disk_percent = 91 WHERE id = ?').run(node.id);
  assert.equal(nodes.isFull(nodes.byId(node.id)), false);
});

test('an offline agent location falls back to an eligible local location without moving the slot', async () => {
  const nodes = await import('../server/nodes.js');
  const user = createUser();
  const assigned = nodes.create({ name: 'Ausgefallener Standort', kind: 'agent', access: 'all' }, null);
  const slot = createProfile(user, billing.planBySlug('premium'));
  db.prepare('UPDATE profiles SET node_id = ? WHERE id = ?').run(assigned.id, slot.id);
  const current = db.prepare('SELECT * FROM profiles WHERE id = ?').get(slot.id);

  const replacement = supervisor.runtimeNode(current, user.id, { file: 'afk-linux' });
  assert.equal(replacement.kind, 'local');
  assert.equal(current.node_id, assigned.id, 'die feste Zuordnung bleibt unverändert');
  assert.equal(
    supervisor.runtimeNode(current, user.id, {
      file: 'afk-linux',
      excludeNodeIds: [assigned.id, replacement.id],
    }),
    null
  );
});

test('wrong bot secrets cannot lock the real Discord bot out', async () => {
  const { tryBotSecret } = await import('../server/routes/bot.js');
  const secret = `richtiger-bot-schluessel-${'x'.repeat(32)}`;
  const ip = '203.0.113.79';
  setSetting('discord_bot_secret', secret);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal(tryBotSecret(ip, `falsch-${attempt}-${'x'.repeat(24)}`), 'wrong');
  }
  assert.equal(tryBotSecret(ip, `noch-falsch-${'x'.repeat(24)}`), 'throttled');
  assert.equal(tryBotSecret(ip, secret), 'ok');
});

/**
 * Zwei Anfragen und eine Antwort nachgebaut – mehr braucht der Anmeldecode nicht.
 *
 * Er liest genau drei Dinge aus einer Anfrage (Cookie, Browserkennung, Adresse) und schreibt genau
 * eines in die Antwort (das Gerätecookie). Ein echter HTTP-Server dafür wäre ein Umweg über den
 * halben Express-Stapel, um am Ende dieselben drei Felder zu setzen.
 */
const fakeRes = () => {
  const jar = {};
  return { jar, cookie: (name, value) => { jar[name] = value; } };
};
const fakeReq = (res = null, agent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36') => ({
  headers: { 'user-agent': agent, cookie: res?.jar?.afk_device ? `afk_device=${res.jar.afk_device}` : '' },
  ip: '198.51.100.7',
});

/**
 * Der Code selbst, gegen die Vektoren aus RFC 6238.
 *
 * Sie sind für ein Geheimnis aus zwanzig Byte ASCII ("12345678901234567890") und feste Zeiten
 * angegeben. Wer hier etwas ändert und sie noch bestehen, hat nichts kaputt gemacht; wer sie
 * bricht, hat jede Authenticator-App der Welt gegen sich.
 */
test('the app code follows RFC 6238 down to the published vectors', () => {
  const secret = totp.base32(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(totp.unbase32(secret), Buffer.from('12345678901234567890'));

  // Zeit → Zähler → Code. Die Werte stehen im Anhang B von RFC 6238 (SHA-1, 8 Stellen); hier
  // zählen die letzten sechs, denn sechs Stellen sind das, was die Apps zeigen.
  const vectors = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];
  for (const [seconds, expected] of vectors) {
    assert.equal(totp.codeFor(secret, Math.floor(seconds / 30)), expected, `t=${seconds}`);
  }

  // Die Toleranz von ±1 Fenster, und keines mehr. Ein Fenster ist dreißig Sekunden; wer eine
  // Minute zurückliegt, hat einen Code aus einer anderen Minute.
  const now = 1_700_000_000_000;
  const counter = Math.floor(now / 1000 / 30);
  assert.equal(totp.check(secret, totp.codeFor(secret, counter), { now }), counter);
  assert.equal(totp.check(secret, totp.codeFor(secret, counter - 1), { now }), counter - 1);
  assert.equal(totp.check(secret, totp.codeFor(secret, counter + 1), { now }), counter + 1);
  assert.equal(totp.check(secret, totp.codeFor(secret, counter - 2), { now }), null);
  assert.equal(totp.check(secret, totp.codeFor(secret, counter + 2), { now }), null);
  assert.equal(totp.check(secret, '000000', { now }), null);
  assert.equal(totp.check(secret, '', { now }), null);
  assert.equal(totp.check(secret, '12345', { now }), null);

  // Die Adresse, die eine App abfotografiert. Der Aussteller steht zweimal darin, und das ist
  // Absicht – ältere Apps lesen den Namensraum, neuere den Parameter.
  const address = totp.uri({ secret, account: 'a@b.example', issuer: 'AFKSystems' });
  assert.match(address, /^otpauth:\/\/totp\/AFKSystems:a%40b\.example\?/);
  const params = new URL(address.replace('otpauth://', 'https://')).searchParams;
  assert.equal(params.get('secret'), secret);
  assert.equal(params.get('issuer'), 'AFKSystems');
  assert.equal(params.get('algorithm'), 'SHA1');
  assert.equal(params.get('digits'), '6');
  assert.equal(params.get('period'), '30');
});

/**
 * Der QR-Code, gegen feste Bilder.
 *
 * Ein falscher QR-Code sieht aus wie ein richtiger – man merkt es erst an der Kamera, die nichts
 * findet. Die vier Vorlagen hier stammen aus einem Abgleich Modul für Modul gegen eine fremde
 * Erzeugung (siehe den Kopf von qr.js); sie decken die Fassungen 1, 6, 7 und 10 ab und damit
 * beide Längen des Zeichenzählers, den Sprung zur zweiten Blockgruppe und die Fassungsinformation,
 * die es erst ab Fassung 7 gibt.
 */
test('the QR code still draws exactly the picture that was checked against a reference', () => {
  const hexOf = (modules) => {
    let bits = '';
    for (const row of modules) for (const value of row) bits += value;
    let out = '';
    for (let index = 0; index < bits.length; index += 4) {
      out += parseInt(bits.slice(index, index + 4).padEnd(4, '0'), 2).toString(16);
    }
    return out;
  };

  const golden = [
    {
      text: 'AFKSystems',
      size: 21,
      hex: 'fe0bfc11906ea2bb7535dbadaec14507faafe01700be2be7e76f229504084aebb922006f43f8b1505b9dba8f6dd6452ebd910440cfe91d0',
    },
    {
      text: 'otpauth://totp/AFKSystems:admin%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=AFKSystems&algorithm=SHA1&digits=6&period=30',
      size: 49,
      hex: 'fea1398a58bfc10ce7fefdd06e9873547a6bb7564c93a4a5dbae7a3fe582ec17f8b10cd107faaaaaaaaafe0192bc40a8008bd9c3e2bbfcb6176f1f2dbc26c4cc2c1afd8a0dab72fe9361bbe6f96bcb8902a0c9b09319bcb949682fb9a8904e9bf3553a8575c3b8c93818365967b270f031cf75999ca331f027bb5125086b6becea6a25c3b2d37c3e0ccf9b8bf8312c1c7bd1161ac632b3a9ab9c4a971365c6b3ecc1ff29be9223399ab342477e7bd94ca910c9bc057653421800a14bd829d828f6779eeca2c5b679da1e3e3ee6f6e314c2f5a15151918f34e6da49c44a28009f6f8d31c3a94dba9f651d9de52cdb28e0fd2f52d17de3c6e3f6fcfa806f27132d453faa84ad48ab904292c43d314ba936fe2d9fcdd042e0f25506e9cc50f99b4f049c44d9382efee68466ed7b8',
    },
    {
      text: 'x'.repeat(120),
      size: 45,
      hex: 'fe0857564bfc12082fe6906ebaea2a74bb7582f40635dba8bdfd63aec16c247e4107faaaaaaaafe01d01153c00be054f8353e000fd7ab0e8d0c0017f2bedc8e04153c5cc27de2035049c1be7ab0e8ead3c77f2bec0b636153c5cdb5ee203504ea9ba7ab0e8dc92077f2bede9646153c5c7fcfef835fcdc59e46b0c4d6ad0abf2eacb14df153d1cffd1bf834fc988efd2b040d6eb01df2d4cb08d4b53efcf6e098834ac906eed2b040c2c819df2d4d71944b53efc5ee038834acb07e2d2b040c2c8f9df2d4cf19b4b53efc9be63f834fc8070ac6b044ff84cebf2aad05a13153d1cbab24f835fcdd48906b094eea2c29f2e0d04f13e53dacfeaa558347d0',
    },
    {
      text: 'x'.repeat(200),
      size: 57,
      hex: 'fe01e3d60d673fc11d9f7e53e6906ea8630a5ca7cbb7576b204b0625dbae9abbf0d612ec15da67113e5107faaaaaaaaaaafe016b50c7e53c00be351d7f58353e0c7954db06b0e8facd12a729f2bed4a6e5c83e53c5cb3351af3583504d67916b306b0e8fedd128d29f2bed3aa65ad3e53c5c8f351b03583504c66a1adb06b0e8f7cd3c2729f2bed03a6c89be53c5c8e951561583504c0a605da06b0e8e7d72426a9f2bed00760890e53c5c8fed3563d83504e0aa11db46b0e8f7f52c2fe9f2bec91661847e53d1c7aedb52b5834acdc6591f106b0c4e3f42c3fa9f2fec1b4a1cfbe53efc53e9b1895834acbea5d24106b0402c8ccdfda9f2d4e794c117be53efc6789b7115834ac289756d506b040ed84e8a7a9f2d4c314cb0dbe53efc67f1bd095834acacbf46c106b040fc9af8bda9f2d4c219c20f8e53efc63f9bd0a5834accce766c306b040e998e6bca9f2d4df2b820ffe53efc0264bd3f5834fc806976d106b044ff9a67aaa9f2aad05ab2047e53d1cbae1bcff5835fcdd69b4b406b0942eab8788a9f2e0904a1262fe53dacfec6375d58347d0',
    },
  ];

  for (const entry of golden) {
    const modules = qr.matrix(entry.text);
    assert.equal(modules.length, entry.size, `Größe für ${entry.text.length} Zeichen`);
    assert.equal(hexOf(modules), entry.hex, `Bild für ${entry.text.length} Zeichen`);
  }

  // Die drei Sucher sitzen dort, wo ein Leser sie sucht, und der Rahmen ist da: Ohne die vier
  // hellen Module ringsum findet keine Kamera den Code, auch wenn jedes Modul stimmt.
  const svg = qr.svg('AFKSystems');
  assert.match(svg, /viewBox="0 0 29 29"/); // 21 Module + zweimal vier Rand
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /fill="#ffffff"/); // heller Grund, auch im Dunkelmodus

  // Was nicht mehr hineinpasst, wird abgelehnt statt falsch gezeichnet.
  assert.throws(() => qr.matrix('y'.repeat(214)), /keine Fassung/);
});

/**
 * Die Zwei-Faktor-Anmeldung als Ganzes: einschalten, einlösen, wiederherstellen, abschalten.
 *
 * Vier Zusagen stehen hier auf dem Prüfstand, und jede ist eine, die sonst niemandem auffiele:
 * Das Geheimnis liegt verschlüsselt in der Datenbank. Ein Code gilt genau einmal. Ein
 * Wiederherstellungscode auch. Und das Zurücksetzen des Passworts kommt nicht daran vorbei –
 * ohne das wäre das Postfach weiterhin ein Generalschlüssel und die ganze Funktion eine
 * Behauptung.
 */
test('two-factor sign-in is stored sealed, spent once, and password reset cannot walk around it', () => {
  const read = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const { id } = createUser({ username: 'zweifaktor' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword('passwortpasswort1'), id);

  assert.equal(totp.enabled(read(id)), false);
  assert.deepEqual(totp.statusOf(read(id)), {
    enabled: false,
    since: null,
    recovery_left: 0,
    recovery_total: totp.RECOVERY_COUNT,
  });

  // Einrichten. Das Geheimnis steht danach als **vorgemerkt** in der Datenbank, nicht als gültig:
  // Zwischen „abfotografiert“ und „bestätigt“ darf kein Konto nach einem Code fragen, den noch
  // niemand beantworten kann.
  const setup = totp.begin(read(id), { issuer: 'AFKSystems' });
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.uri, /^otpauth:\/\/totp\//);
  assert.match(setup.qr, /^<svg /);
  assert.equal(totp.enabled(read(id)), false);
  // **Verschlüsselt, nicht im Klartext.** Sicherungen lassen sich im Panel herunterladen; eine
  // Sicherung mit jedem Zwei-Faktor-Geheimnis im Klartext wäre ein Generalschlüssel in einer Datei.
  const stored = read(id).totp_pending_secret;
  assert.match(stored, /^v1:/);
  assert.equal(stored.includes(setup.secret), false);

  // Ein falscher Code schaltet nicht scharf.
  assert.throws(() => totp.enable(read(id), '000000'), /code-Fehler|stimmt nicht|wrong/i);
  assert.equal(totp.enabled(read(id)), false);

  const counter = Math.floor(Date.now() / 1000 / 30);
  const codes = totp.enable(read(id), totp.codeFor(setup.secret, counter));
  assert.equal(codes.length, totp.RECOVERY_COUNT);
  assert.equal(totp.enabled(read(id)), true);
  assert.match(read(id).totp_secret, /^v1:/);
  assert.equal(read(id).totp_pending_secret, null);
  assert.equal(totp.statusOf(read(id)).recovery_left, totp.RECOVERY_COUNT);

  // **Der Code, mit dem eingeschaltet wurde, ist verbraucht.** Sonst wäre ein abgefangener Code
  // dreißig Sekunden lang ein zweiter Zugang – und dreißig Sekunden reichen.
  assert.equal(totp.verify(read(id), totp.codeFor(setup.secret, counter)), null);
  assert.ok(totp.verify(read(id), totp.codeFor(setup.secret, counter + 1)));
  // Und derselbe danach auch nicht mehr.
  assert.equal(totp.verify(read(id), totp.codeFor(setup.secret, counter + 1)), null);

  // Wiederherstellungscodes: jeder genau einmal, Schreibweise egal.
  assert.equal(totp.redeemRecovery(id, codes[0].toLowerCase()), true);
  assert.equal(totp.redeemRecovery(id, codes[0]), false);
  assert.equal(totp.redeemRecovery(id, codes[1].replace('-', '')), true);
  assert.equal(totp.statusOf(read(id)).recovery_left, totp.RECOVERY_COUNT - 2);
  assert.equal(totp.redeemRecovery(id, 'GIBTESNICHT'), false);

  // Neue Codes werfen die alten weg – auch die unbenutzten. Wer sich neue ausstellen lässt, tut
  // das, weil der alte Zettel weg ist oder ihn jemand gesehen hat.
  const second = totp.newRecoveryCodes(id);
  assert.equal(totp.statusOf(read(id)).recovery_left, totp.RECOVERY_COUNT);
  assert.equal(totp.redeemRecovery(id, codes[2]), false);
  assert.equal(totp.redeemRecovery(id, second[0]), true);

  // **Das Zurücksetzen des Passworts kommt nicht vorbei.** Das ist der Punkt, an dem sich
  // entscheidet, ob die Zwei-Faktor-Anmeldung etwas bedeutet oder nur so heißt.
  const setReset = (token) =>
    db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(
      token,
      Date.now() + 600_000,
      id
    );
  setReset('reset-ohne-code');
  assert.throws(
    () => auth.applyReset('reset-ohne-code', 'neuespasswort123', 'neuespasswort123'),
    (error) => error.code === 'totp-required'
  );
  // Mit einem Wiederherstellungscode geht es – wer Telefon **und** Passwort verloren hat, kommt
  // über den Zettel zurück.
  assert.ok(auth.applyReset('reset-ohne-code', 'neuespasswort123', 'neuespasswort123', second[1]));
  assert.equal(totp.statusOf(read(id)).recovery_left, totp.RECOVERY_COUNT - 2);

  // Abschalten nimmt die Wiederherstellungscodes mit. Ein Zettel, der nach dem Abschalten weiter
  // gälte, wäre ein Zugang, von dem niemand mehr weiß, dass es ihn gibt.
  totp.disable(id);
  assert.equal(totp.enabled(read(id)), false);
  assert.equal(read(id).totp_secret, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?').get(id).n, 0);
  setReset('reset-danach');
  assert.ok(auth.applyReset('reset-danach', 'nochmalpasswort123', 'nochmalpasswort123'));
});

/**
 * Die Minecraft-Köpfe kommen über diesen Server – und nichts davon geht ins Netz, wenn es
 * nicht muss.
 *
 * Geprüft wird hier ohne Netz, und das ist Absicht: Ein Test, der einen fremden Bildserver
 * braucht, ist ein Test, der bei dessen Wartungsfenster rot wird. Was hier zählt, sind die drei
 * Entscheidungen, die dieses Modul trifft, bevor es überhaupt jemanden fragt.
 */
test('Minecraft heads are served from here, never from the customer browser', async () => {
  const heads = await import('../server/heads.js');
  const { paths } = await import('../server/config.js');

  // Was als Name durchgeht. Alles andere landet nie in einer Adresse zu einem fremden Host.
  for (const good of ['Steve', 'a', 'ein_langer_name', '0123456789abcdef', 'f84c6a79-0a4e-45e0-879b-cd49ebd4c4e2', 'f84c6a790a4e45e0879bcd49ebd4c4e2']) {
    assert.equal(heads.valid(good), true, good);
  }
  for (const bad of ['', '../../etc/passwd', 'a b', 'zu-lang-fuer-minecraft', 'Steve/../x', 'Ünicode', 'a'.repeat(17)]) {
    assert.equal(heads.valid(bad), false, bad);
  }

  // Die Adresse zeigt auf diese Maschine und auf sonst nichts.
  assert.equal(heads.urlFor('Steve'), '/api/heads/Steve.png');
  assert.equal(heads.urlFor('../x'), '/api/heads/..%2Fx.png');
  assert.equal(heads.urlFor(null), '/api/heads/.png');

  // Ein unmöglicher Name fragt gar nicht erst nach: Zurück kommt sofort der neutrale Kopf, und
  // zwar als echtes PNG – ein `src`, das kaputt ist, sieht aus wie ein kaputtes Panel.
  const nothing = await heads.headFor('../../etc/passwd');
  assert.equal(nothing.fresh, false);
  assert.equal(nothing.body.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

  // Was auf der Platte liegt, wird von dort geliefert – ohne jede Anfrage nach draußen.
  // Der Dateiname ist der Abdruck des kleingeschriebenen Namens; `Steve` und `steve` sind
  // derselbe Kopf, und das entscheidet dieses Modul und nicht das Dateisystem.
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('abgelegt')]);
  const file = path.join(
    paths.heads,
    `${crypto.createHash('sha256').update('cachetest').digest('hex').slice(0, 32)}.png`
  );
  fs.mkdirSync(paths.heads, { recursive: true });
  fs.writeFileSync(file, png);
  const cached = await heads.headFor('CacheTest');
  assert.equal(cached.fresh, true);
  assert.deepEqual(cached.body, png);

  // Und eine Datei, die über ihre Zeit ist, wird nicht einfach weggeworfen: Solange der fremde
  // Host nichts Besseres liefert, ist ein alter Kopf besser als gar keiner.
  const old = Date.now() - 40 * 86_400_000;
  fs.utimesSync(file, old / 1000, old / 1000);
  assert.equal(heads.cleanup(), 1);
  assert.equal(fs.existsSync(file), false);
});

test('the sign-in code fails closed and only asks unknown browsers', async () => {
  const user = () => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const { id } = createUser({ username: 'codefall' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword('passwort123'), id);

  // Ohne Postausgang bleibt der Code aus – sonst stünde jemand vor einem Feld, in das nie etwas
  // eintrifft. Das ist die Bedingung, die den Kunden nicht aussperrt, und sie kommt zuerst.
  setSetting('smtp_host', '');
  assert.equal(logincode.required(user(), fakeReq()), false);

  setSetting('smtp_host', 'localhost');
  assert.equal(logincode.required(user(), fakeReq()), true);

  // Ein eingeschalteter zweiter Schritt darf bei einem kaputten Postausgang nicht unbemerkt auf
  // das Passwort allein zurückfallen. Port 1 auf Loopback lehnt sofort ab und hält den Test lokal.
  setSetting('smtp_host', '127.0.0.1');
  setSetting('smtp_port', 1);
  await assert.rejects(
    () => logincode.start(user(), fakeReq()),
    (error) => error?.status === 503 && error?.code === 'login-code-delivery'
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM login_challenges WHERE user_id = ?').get(id).n, 0);
  setSetting('smtp_host', 'localhost');
  setSetting('smtp_port', 587);

  // Abgeschaltet: nie.
  db.prepare('UPDATE users SET login_code = 0 WHERE id = ?').run(id);
  assert.equal(logincode.required(user(), fakeReq()), false);
  db.prepare('UPDATE users SET login_code = 1 WHERE id = ?').run(id);

  // Eine unbestätigte Adresse trägt keinen Zugang: An ein Postfach, von dem niemand weiß, ob es
  // dem Kontoinhaber gehört, darf die Anmeldung nicht gebunden werden.
  db.prepare('UPDATE users SET email_verified = 0 WHERE id = ?').run(id);
  assert.equal(logincode.required(user(), fakeReq()), false);
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(id);

  // Gemerkt: derselbe Browser fragt nicht mehr.
  const res = fakeRes();
  logincode.remember(user(), fakeReq(), res);
  assert.match(res.jar.afk_device, /^[A-Za-z0-9_-]{20,64}$/);
  assert.match(
    db.prepare('SELECT token FROM known_devices WHERE user_id = ?').get(id).token,
    /^h1:[0-9a-f]{64}$/
  );
  assert.equal(logincode.required(user(), fakeReq(res)), false);

  // Ein anderer Browser mit demselben `User-Agent` ist trotzdem ein anderer. Genau hier lag die
  // Lücke der alten Erkennung: "Chrome auf Windows" haben Millionen.
  assert.equal(logincode.required(user(), fakeReq()), true);

  const list = logincode.devicesOf(id, res.jar.afk_device);
  assert.equal(list.length, 1);
  assert.equal(list[0].current, true);
  assert.equal(list[0].device, 'Chrome · Windows');
  // Der Zufallswert selbst bleibt drinnen – er steht im Cookie und ist ein Merkmal, keine Auskunft.
  assert.ok(!('token' in list[0]));

  // Ein Passwortwechsel wirft jeden bekannten Browser hinaus. Das ist der Fall, für den es das
  // gibt: Wer wechselt, glaubt oft, jemand anderes kenne das alte – und der sitzt vielleicht an
  // einem Browser, der hier als bekannt geführt wird.
  auth.changePassword(user(), 'passwort123', 'nochbesser99', 'nochbesser99');
  assert.equal(logincode.devicesOf(id).length, 0);
  assert.equal(logincode.required(user(), fakeReq(res)), true);

  // Einzeln vergessen geht über den kurzen Abdruck, und ein geratener trifft nichts.
  const res2 = fakeRes();
  logincode.remember(user(), fakeReq(), res2);
  assert.equal(logincode.forget(id, '0'.repeat(16)), false);
  assert.equal(logincode.forget(id, logincode.devicesOf(id)[0].ref), true);
  assert.equal(logincode.devicesOf(id).length, 0);

  setSetting('smtp_host', '');
});

test('a sign-in code is spent once, counts its attempts down and dies with the fifth', () => {
  const { id } = createUser({ username: 'codeversuche' });

  /** Eine Marke wie `start()` sie anlegt – nur mit einem Code, den der Test kennt. */
  const challenge = (code, { expiresIn = 15 * 60_000, tries = 0 } = {}) => {
    const value = crypto.randomUUID();
    db.prepare(
      `INSERT INTO login_challenges (token, user_id, code_hash, tries, sent_at, expires_at, ip, agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '', '', ?)`
    ).run(value, id, hashPassword(code), tries, Date.now(), Date.now() + expiresIn, Date.now());
    return value;
  };

  // Der richtige Code lässt genau einmal herein – danach ist die Marke verbraucht.
  const good = challenge('123456');
  assert.equal(logincode.redeem(good, '123456').id, id);
  assert.throws(() => logincode.redeem(good, '123456'), /gilt nicht mehr|no longer valid/);

  // Vier Fehlversuche zählen herunter, der fünfte nimmt die Marke mit. Ohne diese Grenze wären
  // sechs Ziffern in einer Viertelstunde durchprobierbar.
  const counted = challenge('654321');
  for (let left = 4; left >= 1; left -= 1) {
    assert.throws(() => logincode.redeem(counted, '000000'), new RegExp(`${left} `));
  }
  assert.throws(() => logincode.redeem(counted, '000000'), /gilt nicht mehr|no longer valid/);
  // Und danach hilft auch der richtige nicht mehr.
  assert.throws(() => logincode.redeem(counted, '654321'), /gilt nicht mehr|no longer valid/);

  // Abgelaufen ist abgelaufen.
  assert.throws(() => logincode.redeem(challenge('111111', { expiresIn: -1 }), '111111'), /gilt nicht mehr|no longer valid/);
  // Etwas, das keine sechs Ziffern ist, verbraucht keinen Versuch – es ist ein Vertipper.
  const typo = challenge('222222');
  assert.throws(() => logincode.redeem(typo, 'abc'), /sechs Ziffern|six digits/);
  assert.equal(logincode.redeem(typo, '222222').id, id);

  // Ein gesperrtes Konto kommt auch mit dem richtigen Code nicht herein: Zwischen dem Anfordern
  // und dem Eintippen liegen Minuten, und in denen kann sich das ändern.
  db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').run(id);
  assert.throws(() => logincode.redeem(challenge('333333'), '333333'), /gesperrt|blocked/);
  db.prepare('UPDATE users SET blocked = 0 WHERE id = ?').run(id);

  // Die halb verdeckte Adresse hilft beim Wiedererkennen und verrät nichts.
  assert.equal(logincode.maskEmail('hugo@example.test'), 'h•••@example.test');
  assert.equal(logincode.maskEmail('kaputt'), '');
});

test('the data export carries the account but no keys, and deletion waits out its grace period', () => {
  const user = createUser({ credits: 500 });
  const slot = createProfile(user, billing.planBySlug('premium'));
  createAccount(user, { name: 'ExportBot' });
  tickets.create(user, { subject: 'Frage zum Export', body: 'Hallo' });
  db.prepare('UPDATE mc_accounts SET tags = ?, favorite = 1 WHERE user_id = ?').run(
    JSON.stringify(['Farm', 'Hauptkonto']),
    user.id
  );

  const dump = account.exportFor(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
  assert.equal(dump.account.username, user.username);
  assert.equal(dump.server_slots.length, 1);
  assert.equal(dump.minecraft_accounts.length, 1);
  assert.deepEqual(dump.minecraft_accounts[0].tags, ['Farm', 'Hauptkonto']);
  assert.equal(dump.minecraft_accounts[0].favorite, true);
  assert.equal(dump.tickets.length, 1);
  assert.deepEqual(dump.included, account.EXPORT_PARTS);
  const profileOnly = account.exportFor(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id), ['profile']);
  assert.deepEqual(profileOnly.included, ['profile']);
  assert.equal(profileOnly.account.username, user.username);
  assert.equal(profileOnly.minecraft_accounts, undefined);
  // Schlüssel sind keine Auskunft: Die Datei liegt danach im Download-Ordner und geht per Mail
  // weiter – ein Passwort-Hash oder ein Sitzungs-Token darin wäre der Zugang, nicht die Auskunft.
  const asText = JSON.stringify(dump);
  assert.doesNotMatch(asText, /password_hash|verify_token|reset_token|pending_email_token|discord_webhook/);

  // Ein Administrator kann sich hier nicht selbst löschen – sonst bleibt niemand übrig, der
  // andere hereinlässt.
  const boss = createUser({ role: 'admin' });
  assert.throws(() => account.requestDeletion(boss, { verified: true }), /Administrator/);

  const pending = account.requestDeletion(
    db.prepare('SELECT * FROM users WHERE id = ?').get(user.id),
    { verified: true }
  );
  assert.ok(pending.due_at > Date.now());
  // Vor dem Stichtag passiert nichts, und nichts ist weg.
  assert.equal(account.runDueDeletions(), 0);
  assert.ok(db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(slot.id));
  // Ein Widerruf genügt.
  assert.equal(account.cancelDeletion(user.id), true);
  assert.equal(db.prepare('SELECT delete_due_at FROM users WHERE id = ?').get(user.id).delete_due_at, null);

  // Eine bezahlte Aufladung mit Beleg – die darf die Löschung **nicht** mitnehmen.
  const paid = billing.createTopup({
    userId: user.id,
    amountCent: 500,
    credits: 500,
    provider: 'transfer',
  });
  billing.settleTopup(paid.id, 'Test');
  const number = db.prepare('SELECT receipt_no FROM topups WHERE id = ?').get(paid.id).receipt_no;

  // Und wenn die Frist wirklich abgelaufen ist, geht das Konto mit allem, was daran hängt.
  account.requestDeletion(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id), { verified: true });
  db.prepare('UPDATE users SET delete_due_at = ? WHERE id = ?').run(Date.now() - 1000, user.id);
  assert.equal(account.runDueDeletions(), 1);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(user.id), undefined);
  assert.equal(db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(slot.id), undefined);

  // Der Beleg steht danach im Archiv – mit derselben Nummer und derselben Anschrift.
  const kept = db.prepare('SELECT * FROM receipt_archive WHERE receipt_no = ?').get(number);
  assert.ok(kept, 'ein ausgestellter Beleg gehört dem Betreiber und nicht dem Konto');
  assert.equal(kept.amount_cent, 500);
  assert.equal(kept.former_user, user.id);
  // Und die nächste Nummer zählt ihn mit: Sonst wäre sie ein zweites Mal vergeben.
  assert.notEqual(billing.nextReceiptNumber(), number);

  // Zum Archiv gehört kein Konto mehr, also auch keine Liste im Panel. Die Ausfuhr ist der
  // einzige Weg dorthin – wenn die fehlt, sind die Belege zwar da, aber für niemanden.
  const csv = exportCsv.build('receipts');
  assert.ok(csv.rows >= 1);
  assert.match(csv.body.split('\r\n')[0], /^﻿receipt_no,/);
  assert.ok(csv.body.includes(number));
});

// ---------------------------------------------------------------- Belege

test('a settled top-up gets a receipt number and freezes the address it was billed to', () => {
  const buyer = createUser({ username: 'belegkunde' });
  profile.applyChanges(
    buyer.id,
    profile.readChanges({
      full_name: 'Hugo Muster',
      company: 'Muster GmbH',
      street: 'Hauptstraße 1',
      postal_code: '1010',
      city: 'Wien',
      country: 'AT',
    })
  );
  const topup = billing.createTopup({ userId: buyer.id, amountCent: 500, credits: 500, provider: 'transfer' });
  billing.settleTopup(topup.id, 'Test');

  const paid = db.prepare('SELECT * FROM topups WHERE id = ?').get(topup.id);
  assert.match(paid.receipt_no, /^AFK-\d{4}-\d{4}$/);
  assert.ok(paid.vat_note, 'der Steuerhinweis von damals gehört auf den Beleg');
  const frozen = JSON.parse(paid.billed_to);
  assert.equal(frozen.company, 'Muster GmbH');
  assert.equal(frozen.city, 'Wien');

  // Der Umzug danach ändert den Beleg nicht – sonst änderte er rückwirkend jede alte Rechnung.
  profile.applyChanges(buyer.id, profile.readChanges({ city: 'Graz' }));
  const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(buyer.id);
  const page = receipt.html(db.prepare('SELECT * FROM topups WHERE id = ?').get(topup.id), owner, 'de');
  assert.match(page, /Muster GmbH/);
  assert.match(page, /1010 Wien/);
  assert.doesNotMatch(page, /Graz/);
  // Und keine Skripte: Auf einem Dokument mit den Angaben eines Kunden hat nichts Ausführbares
  // etwas verloren – die Content-Security-Policy dieses Servers ließe es ohnehin nicht zu.
  assert.doesNotMatch(page, /<script|onclick=/i);

  // Zweiter Beleg, nächste Nummer – fortlaufend und ohne Lücke.
  const second = billing.createTopup({ userId: buyer.id, amountCent: 1000, credits: 1050, provider: 'voucher' });
  billing.settleTopup(second.id, 'Test');
  const numbers = db
    .prepare("SELECT receipt_no FROM topups WHERE receipt_no LIKE 'AFK-%' ORDER BY id")
    .all()
    .map((row) => row.receipt_no);
  assert.equal(new Set(numbers).size, numbers.length, 'jede Nummer gibt es genau einmal');

  // Und die Liste zeigt nur, was wirklich eine Nummer hat.
  const open = billing.createTopup({ userId: buyer.id, amountCent: 500, credits: 500, provider: 'transfer' });
  assert.ok(!receipt.listFor(buyer.id).some((entry) => entry.id === open.id));
});

// ---------------------------------------------------------------- Discord-Darstellung

test('Discord messages are rendered with names instead of numbers, and nothing escapes', () => {
  const mentions = {
    '153820284044548513': { type: 'user', name: 'Hugo' },
    '153820284474490881': { type: 'channel', name: 'support' },
    '153820284044548514': { type: 'role', name: 'Team', color: '#206cfe' },
  };
  const html = renderDiscord(
    'Hallo <@153820284044548513>, sieh in <#153820284474490881> — <@&153820284044548514> **dringend**!',
    { mentions, locale: 'de', unknown: 'unbekannt' }
  );
  assert.match(html, />@Hugo</);
  assert.match(html, />#support</);
  assert.match(html, />@Team</);
  assert.match(html, /--dc-role:#206cfe/);
  // Im **Text** steht keine Zahl mehr. Im `title` bleibt sie stehen – wer im Support eine
  // Erwähnung nachschlagen muss, braucht genau sie, und ein Tooltip stört niemanden beim Lesen.
  assert.doesNotMatch(html.replace(/title="[^"]*"/g, ''), /15382028/);
  assert.match(html, /<strong>dringend<\/strong>/);

  // Ohne Auflösung bleibt es eine Erwähnung – sie heißt dann nur nicht beim Namen.
  assert.match(renderDiscord('<@999999999999999999>', { unknown: 'unbekannt' }), />@unbekannt</);

  // Alles, was nach HTML aussieht, kommt als Text wieder heraus.
  const attack = renderDiscord('<script>alert(1)</script> <img src=x onerror=alert(1)>', {});
  // Kein echtes Element und kein echtes Attribut – die Wörter selbst dürfen als Text dastehen,
  // sie sind ja das, was jemand geschrieben hat.
  assert.doesNotMatch(attack, /<script/i);
  assert.doesNotMatch(attack, /<img(?![^>]*class="dc-emoji")/i);
  assert.match(attack, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  // Und eine Adresse mit einem anderen Schema wird kein Link.
  assert.doesNotMatch(renderDiscord('[hier](javascript:alert(1))', {}), /<a /);

  // Codeblöcke stehen für sich und nicht in einem Absatz – sonst wäre es ungültiges HTML.
  const code = renderDiscord('davor ```js\nconst x = 1 < 2;\n``` danach', {});
  assert.doesNotMatch(code, /<p[^>]*><pre/);
  assert.match(code, /<pre class="dc-code"><code>const x = 1 &lt; 2;<\/code><\/pre>/);

  // Ein Unterstrich mitten im Wort ist kein Kursivsatz – so heißen Serverplätze und Dateien.
  assert.doesNotMatch(renderDiscord('mein_server_name', {}), /<em>/);
  assert.match(renderDiscord('_kursiv_', {}), /<em>kursiv<\/em>/);

  // Was der Bot mitschickt, wird geprüft, bevor es in die Datenbank geht: Aus diesem Feld wird
  // später HTML gebaut.
  const packed = JSON.parse(
    tickets.packMentions({
      '153820284044548513': { type: 'user', name: 'Hugo' },
      '12': { type: 'user', name: 'zu kurze ID' },
      '153820284044548515': { type: 'unfug', name: 'Rolle', color: 'javascript:alert(1)' },
    })
  );
  assert.deepEqual(Object.keys(packed), ['153820284044548513', '153820284044548515']);
  assert.equal(packed['153820284044548515'].type, 'user', 'unbekannte Arten werden zu "user"');
  assert.ok(!('color' in packed['153820284044548515']), 'eine Farbe, die keine ist, fällt weg');
  assert.equal(tickets.packMentions(null), null);
  assert.equal(tickets.unpackMentions('kein json'), null);
});

test('Discord mention names are fetched when the event cache is empty', async () => {
  const userId = '123456789012345678';
  const roleId = '223456789012345678';
  const channelId = '323456789012345678';
  const message = {
    content: `<@${userId}> bitte in <#${channelId}> an <@&${roleId}>`,
    mentions: { users: new Map(), roles: new Map(), channels: new Map() },
    guild: {
      members: { fetch: async (id) => (id === userId ? { displayName: 'Richtiger Name', user: {} } : null) },
      roles: { fetch: async (id) => (id === roleId ? { name: 'Support', hexColor: '#206CFE' } : null) },
    },
    client: {
      users: { fetch: async () => null },
      channels: { fetch: async (id) => (id === channelId ? { name: 'hilfe' } : null) },
    },
  };

  assert.deepEqual(await resolveMentions(message), {
    [userId]: { type: 'user', name: 'Richtiger Name' },
    [roleId]: { type: 'role', name: 'Support', color: '#206CFE' },
    [channelId]: { type: 'channel', name: 'hilfe' },
  });
});

test('display names and selectable avatar providers replace the login name without hiding it', () => {
  const user = createUser({ username: 'login-name', email: 'avatar@example.test' });
  db.prepare(
    `UPDATE users SET full_name = ?, discord_name = ?, discord_id = ?, discord_avatar = ?,
                      google_name = ?, google_avatar = ? WHERE id = ?`
  ).run(
    'Benjamin Berger',
    'Discord Benjamin',
    '123456789012345678',
    'avatarhash',
    'Google Benjamin',
    'https://lh3.googleusercontent.com/a/example',
    user.id
  );
  const fresh = () => db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

  assert.equal(profile.displayNameOf(fresh()), 'Benjamin Berger');
  assert.match(profile.avatarOf(fresh()), /^https:\/\/cdn\.discordapp\.com\/avatars\//);

  profile.setAvatarSource(user.id, 'google');
  assert.equal(profile.avatarOf(fresh()), 'https://lh3.googleusercontent.com/a/example');
  profile.setAvatarSource(user.id, 'gravatar');
  assert.match(profile.avatarOf(fresh()), /^https:\/\/www\.gravatar\.com\/avatar\/[a-f0-9]{32}/);
  profile.setAvatarSource(user.id, 'initials');
  assert.equal(profile.avatarOf(fresh()), null);
  assert.throws(() => profile.setAvatarSource(user.id, 'somewhere-else'));

  const shown = auth.publicUser(fresh());
  assert.equal(shown.display_name, 'Benjamin Berger');
  assert.equal(shown.username, 'login-name');
  assert.equal(shown.avatar_source, 'initials');

  const unnamed = createUser({ username: 'not-visible' });
  assert.equal(profile.displayNameOf(unnamed), `Konto #${unnamed.id}`);
});

test('going online is deliberately not a notification event', () => {
  assert.equal('botOnline' in notify, false);
});

// ---------------------------------------------------------------- Tempo

test('cached values follow every write, including one from another process', () => {
  let built = 0;
  const value = cached(() => {
    built += 1;
    return db.prepare("SELECT value FROM settings WHERE key = 'free_slots'").get()?.value ?? null;
  });

  assert.equal(value(), value());
  assert.equal(built, 1, 'ohne Schreibvorgang wird nicht neu gebaut');

  setSetting('free_slots', 7);
  assert.equal(JSON.parse(value()), 7);
  assert.equal(built, 2, 'ein eigener Schreibvorgang baut neu');

  // Ein zweiter Prozess mit eigener Verbindung – so schreibt `npm run admin:credits`. Für
  // `total_changes()` dieser Verbindung passiert dabei nichts; erkannt wird es über
  // `PRAGMA data_version`. Genau das ist der Fall, den ein reiner Zähler übersehen würde.
  const outside = new Database(path.join(TEST_DIR, 'afksystems.db'));
  outside.pragma('busy_timeout = 5000');
  outside.prepare("UPDATE settings SET value = '9' WHERE key = 'free_slots'").run();
  outside.close();

  assert.equal(JSON.parse(value()), 9, 'auch eine fremde Verbindung wird bemerkt');
  setSetting('free_slots', 1);
});

test('the same query text is only translated once', () => {
  const sql = 'SELECT 1 AS eins';
  assert.strictEqual(db.prepare(sql), db.prepare(sql));
  // `prepareOnce` bleibt der Weg an dem Zwischenspeicher vorbei – für alles, was sein Statement
  // umschaltet (`pluck`, `raw`) und es deshalb nicht teilen darf.
  assert.notStrictEqual(prepareOnce(sql), db.prepare(sql));
  assert.equal(db.prepare(sql).get().eins, 1);
});

test('assets are packed once and served without compressing them again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afksystems-assets-'));
  const style = path.join(dir, 'app.css');
  fs.writeFileSync(style, `.a{color:red}\n`.repeat(400)); // groß genug, dass Packen lohnt
  fs.writeFileSync(path.join(dir, 'tiny.css'), '.a{color:red}');
  fs.writeFileSync(path.join(dir, 'logo.webp'), Buffer.alloc(4096, 7));

  const { written } = assets.pack(dir);
  assert.equal(written, 2, 'eine Brotli- und eine gzip-Fassung');
  assert.ok(fs.existsSync(`${style}.br`) && fs.existsSync(`${style}.gz`));
  assert.equal(zlib.brotliDecompressSync(fs.readFileSync(`${style}.br`)).toString(), fs.readFileSync(style, 'utf8'));
  // Was schon komprimiert ist oder zu klein, bleibt liegen.
  assert.equal(fs.existsSync(path.join(dir, 'tiny.css.br')), false);
  assert.equal(fs.existsSync(path.join(dir, 'logo.webp.br')), false);

  const middleware = assets.preferPacked(dir);
  const ask = (url, headers = {}, method = 'GET') => {
    const sent = {};
    const req = { url, method, headers };
    const res = { locals: {}, setHeader: (name, value) => (sent[name.toLowerCase()] = value) };
    middleware(req, res, () => {});
    return { url: req.url, sent, locals: res.locals };
  };

  const brotli = ask('/app.css', { 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(brotli.url, '/app.css.br');
  assert.equal(brotli.sent['content-encoding'], 'br');
  assert.equal(brotli.sent.vary, 'Accept-Encoding');
  // Der ursprüngliche Name muss erhalten bleiben: Inhaltstyp und Inhaltsschutz hängen an ".css".
  assert.equal(brotli.locals.assetOriginal, '/app.css');

  // Was der Browser nicht annimmt, wird ihm auch nicht geschickt.
  assert.equal(ask('/app.css', { 'accept-encoding': 'gzip' }).url, '/app.css.gz');
  assert.equal(ask('/app.css', { 'accept-encoding': 'br;q=0, gzip' }).url, '/app.css.gz');
  assert.equal(ask('/app.css', { 'accept-encoding': 'identity' }).url, '/app.css');
  assert.equal(ask('/app.css', {}).url, '/app.css');
  // Eine Bereichsanfrage bekommt das Original – ein Ausschnitt einer anderen Darstellung wäre falsch.
  assert.equal(ask('/app.css', { 'accept-encoding': 'br', range: 'bytes=0-10' }).url, '/app.css');
  // Nichts, was nicht gepackt dasteht, und nichts außerhalb des Verzeichnisses.
  assert.equal(ask('/tiny.css', { 'accept-encoding': 'br' }).url, '/tiny.css');
  assert.equal(ask('/../secret.css', { 'accept-encoding': 'br' }).url, '/../secret.css');
  // Der Abfrageteil der Adresse bleibt hinter der Endung stehen.
  assert.equal(ask('/app.css?v=1', { 'accept-encoding': 'br' }).url, '/app.css.br?v=1');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the browser gets one language of the texts, and it really is a module', async () => {
  const { fileFor } = strings;
  const handler = strings.handler({
    cacheControl: (_name, current) =>
      current ? 'private, max-age=31536000, immutable' : 'private, max-age=60',
    current: (version) => version === 'jetzt',
  });

  const ask = (url, headers = {}) => {
    let sent = null;
    let passed = false;
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return this.headers[name.toLowerCase()];
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      end(body) {
        sent = body ?? null;
        return this;
      },
    };
    handler({ url, path: url, method: 'GET', headers }, res, () => {
      passed = true;
    });
    return { res, sent, passed };
  };

  assert.equal(fileFor('de'), 'i18n.de.js');
  assert.equal(fileFor('en'), 'i18n.en.js');
  assert.equal(fileFor('de', 'auth'), 'i18n.auth.de.js');
  assert.equal(fileFor('kl'), 'i18n.en.js', 'eine unbekannte Sprache fällt auf die Vorgabe zurück');

  const german = ask('/assets/v/jetzt/js/i18n.de.js', { 'accept-encoding': 'identity' });
  assert.equal(german.res.statusCode, 200);
  assert.equal(german.res.headers['content-type'], 'text/javascript; charset=UTF-8');
  assert.match(german.res.headers['cache-control'], /immutable/);
  assert.equal(german.res.headers.vary, 'Accept-Encoding');

  // Wirklich ein Modul, und wirklich nur eine Sprache darin.
  const source = german.sent.toString();
  const module = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  assert.equal(module.LANG, 'de');
  assert.equal(module.t('nav.dashboard'), t('nav.dashboard', 'de'));
  assert.equal(module.t('bill.title'), t('bill.title', 'de'));
  assert.equal(module.t('den.gibt.es.nicht'), 'den.gibt.es.nicht');
  assert.equal(module.t('common.switchLanguage', { language: 'X' }), t('common.switchLanguage', 'de', { language: 'X' }));
  // Der Zugriff darf nicht an der Prototypenkette landen.
  assert.equal(module.t('constructor'), 'constructor');
  // Und kein englischer Text hat sich hineinverirrt.
  assert.equal(source.includes(S['nav.features'].en) && S['nav.features'].en !== S['nav.features'].de, false);

  const english = ask('/assets/v/jetzt/js/i18n.en.js', { 'accept-encoding': 'identity' });
  const englishModule = await import(`data:text/javascript,${encodeURIComponent(english.sent.toString())}`);
  assert.equal(englishModule.LANG, 'en');
  assert.equal(englishModule.t('nav.dashboard'), t('nav.dashboard', 'en'));

  // Formulare bekommen nur ihre wenigen Laufzeittexte. Panel-Beschriftungen dort mitzuliefern
  // wäre Transfer und Parse-Arbeit für Inhalte, die auf diesen Seiten gar nicht existieren.
  const authGerman = ask('/assets/v/jetzt/js/i18n.auth.de.js', { 'accept-encoding': 'identity' });
  assert.equal(authGerman.passed, false);
  const authSource = authGerman.sent.toString();
  const authModule = await import(`data:text/javascript,${encodeURIComponent(authSource)}`);
  assert.equal(authModule.t('auth.working'), t('auth.working', 'de'));
  assert.equal(authModule.t('common.error'), t('common.error', 'de'));
  assert.equal(authModule.t('nav.dashboard'), 'nav.dashboard');
  assert.ok(authGerman.sent.length < german.sent.length / 4);

  // Gepackt kommt es kleiner heraus – und entpackt ist es dasselbe.
  const packed = ask('/assets/v/jetzt/js/i18n.de.js', { 'accept-encoding': 'br, gzip' });
  assert.equal(packed.res.headers['content-encoding'], 'br');
  assert.ok(packed.sent.length < german.sent.length);
  assert.equal(zlib.brotliDecompressSync(packed.sent).toString(), source);

  // Ein zweiter Abruf mit demselben ETag holt nichts mehr.
  const again = ask('/assets/v/jetzt/js/i18n.de.js', { 'if-none-match': german.res.headers.etag });
  assert.equal(again.res.statusCode, 304);
  assert.equal(again.sent, null);

  // Ein alter Fingerabdruck bekommt dieselbe Datei, aber nur kurz haltbar.
  assert.match(ask('/assets/v/frueher/js/i18n.de.js').res.headers['cache-control'], /max-age=60/);
  // Und die Adresse ganz ohne Fingerabdruck ebenso – eine Seite aus der Zeit vor dem letzten
  // Deployment sucht die Texte dort, und ohne Texte wäre das Panel für sie leer.
  const bookmarked = ask('/assets/js/i18n.de.js', { 'accept-encoding': 'identity' });
  assert.equal(bookmarked.passed, false);
  assert.equal(bookmarked.sent.toString(), source);
  assert.match(bookmarked.res.headers['cache-control'], /max-age=60/);
  // Alles andere geht diesen Handler nichts an.
  assert.equal(ask('/assets/v/jetzt/js/i18n.kl.js').passed, true);
  assert.equal(ask('/assets/v/jetzt/js/app.js').passed, true);
  assert.equal(ask('/assets/v/jetzt/js/views/i18n.de.js').passed, true);
});

/**
 * Jede Fehlermeldung, die ein Mensch zu sehen bekommt, gibt es in beiden Sprachen.
 *
 * Das Panel hat zwei echte Sprachen, und `HttpError` trägt beide Fassungen – aber nur, wenn die
 * Aufrufstelle die englische mitgibt. Fünfundfünfzig Stellen in der Verwaltung taten das nicht:
 * Wer das Panel auf Englisch benutzte, bekam dort deutsche Sätze wie "Diesen Tarif gibt es
 * nicht." Dasselbe galt für die Feldnamen der Eingabeprüfungen – "Sichtweite has to be a number."
 *
 * Beides ist nichts, was beim Programmieren auffällt: Der Weg funktioniert ja, er antwortet nur
 * in der falschen Sprache, und wer ihn baut, liest ohnehin Deutsch. Deshalb steht die Prüfung
 * hier und nicht in einer Sichtprüfung, die jemand einmal macht.
 */
test('every error a person reads exists in both languages', () => {
  const dir = fileURLToPath(new URL('../server', import.meta.url));
  const files = [];
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(dir);

  /** Vom Aufruf bis zur schließenden Klammer – Zeichenketten zählen dabei nicht mit. */
  const callAt = (source, from) => {
    let index = from;
    let depth = 1;
    let quote = null;
    let escaped = false;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = null;
      } else if (char === "'" || char === '"' || char === '`') quote = char;
      else if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      index += 1;
    }
    return source.slice(from, index);
  };

  const missing = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const calls = /(?:new HttpError\(|(?<![\w.])(?:bad|forbidden|notFound)\()/g;
    let match;
    while ((match = calls.exec(source))) {
      // Beispiele in Kommentaren sind keine Aufrufe.
      const lineStart = source.lastIndexOf('\n', match.index) + 1;
      if (/^\s*(\*|\/\/)/.test(source.slice(lineStart, match.index))) continue;
      const call = callAt(source, calls.lastIndex);
      // Ohne festen Text gibt es nichts zu übersetzen: `bad(result.error)` reicht eine fremde
      // Meldung durch, `forbidden()` nimmt die zweisprachige Vorgabe.
      if (!/['"`]/.test(call)) continue;
      if (/\ben\s*:/.test(call)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      missing.push(`${path.relative(dir, file)}:${line}  ${call.replace(/\s+/g, ' ').slice(0, 70)}`);
    }
  }
  assert.deepEqual(missing, [], `Fehlermeldungen ohne englische Fassung:\n${missing.join('\n')}`);

  // Und die Feldnamen der Eingabeprüfungen. Sie stehen im Aufruf auf Deutsch; die Tabelle in
  // util.js macht daraus das englische Wort.
  const utilSource = fs.readFileSync(path.join(dir, 'util.js'), 'utf8');
  const table = utilSource.slice(utilSource.indexOf('const FIELD_EN'), utilSource.indexOf('const fieldEn'));
  const known = new Set([...table.matchAll(/^\s*'?([^':\n]+?)'?:\s*'/gm)].map((entry) => entry[1].trim()));
  const untranslated = new Set();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, name] of source.matchAll(/require(?:String|Int)\([^,]+,\s*'([^']+)'/g)) {
      if (!known.has(name)) untranslated.add(name);
    }
  }
  assert.deepEqual([...untranslated], [], 'Feldnamen ohne englische Fassung');
});

test('merging only the tail of a chat history gives exactly the full result', () => {
  // Worauf sich der Chat-Reiter verlässt (public/assets/js/views/server.js, `collect`): Wer von
  // jedem Konto nur das Ende des Verlaufs zusammenlegt, bekommt ab `WINDOW_MS` nach dem spätesten
  // Schnitt dasselbe wie beim Zusammenlegen des ganzen Verlaufs. Ohne diese Eigenschaft müsste
  // jede eingehende Chatzeile den kompletten Verlauf anfassen – bei zwanzigtausend Zeilen im
  // Browser gemessene 146 Millisekunden, in denen der Reiter stillsteht.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (let round = 0; round < 20; round++) {
    const accounts = 1 + Math.floor(rnd() * 4);
    const buffers = Array.from({ length: accounts }, (_, i) => ({ id: i + 1, all: [] }));
    let at = 1_700_000_000_000;
    for (let i = 0; i < 900; i++) {
      // Enge Zeitabstände sind der schwierige Fall: Dann greift das Zusammenlege-Fenster wirklich.
      at += Math.floor(rnd() * 1800);
      const text = `§7Spieler${Math.floor(rnd() * 20)}: Nachricht ${i}`;
      for (const buffer of buffers) {
        if (rnd() < 0.08) continue; // ein Konto war kurz weg
        buffer.all.push({ t: at + Math.floor(rnd() * 80), type: 'chat', text });
      }
    }
    for (const buffer of buffers) buffer.all.sort((a, b) => a.t - b.t);

    const withAccount = (buffer) => buffer.all.map((entry) => ({ ...entry, account_id: buffer.id }));
    const full = mergeLines(buffers.flatMap(withAccount));

    const tail = 200;
    let cut = -Infinity;
    const partial = [];
    for (const buffer of buffers) {
      const start = Math.max(0, buffer.all.length - tail);
      if (start > 0) cut = Math.max(cut, buffer.all[start].t);
      for (let i = start; i < buffer.all.length; i++) {
        partial.push({ ...buffer.all[i], account_id: buffer.id });
      }
    }
    assert.notEqual(cut, -Infinity, 'der Ausschnitt muss wirklich abgeschnitten sein');

    const key = (entry) => `${entry.t}|${entry.text}|${[...entry.accounts].sort().join(',')}`;
    const expected = full.filter((entry) => entry.t >= cut + WINDOW_MS).map(key);
    const actual = mergeLines(partial).filter((entry) => entry.t >= cut + WINDOW_MS).map(key);
    assert.deepEqual(actual, expected, `Runde ${round} mit ${accounts} Konten`);
    assert.ok(expected.length > 100, 'der Vergleich muss etwas zu vergleichen haben');
  }
});

test('the sliding window counts a window, forgets what fell out of it and sweeps itself', () => {
  let clock = 1_000_000;
  const realNow = Date.now;
  Date.now = () => clock;
  try {
    const allow = slidingWindow({ windowMs: 1000, max: 3 });
    assert.deepEqual([allow('a'), allow('a'), allow('a'), allow('a')], [true, true, true, false]);
    // Ein anderer Schlüssel hat sein eigenes Fenster.
    assert.equal(allow('b'), true);

    // Eine halbe Sekunde später ist noch nichts abgelaufen.
    clock += 500;
    assert.equal(allow('a'), false);
    // Nach einer vollen Sekunde sind die ersten drei aus dem Fenster – aber nur die.
    clock += 501;
    assert.deepEqual([allow('a'), allow('a'), allow('a')], [true, true, true]);
    assert.equal(allow('a'), false);

    // Die Tabelle darf nicht endlos wachsen: Wer über die Obergrenze hinaus Schlüssel erzeugt,
    // lässt die abgelaufenen wegkehren. Ohne das wäre der Zähler ein Speicherleck von außen.
    const swept = slidingWindow({ windowMs: 1000, max: 5, cap: 10 });
    for (let i = 0; i < 10; i++) swept(`alt-${i}`);
    clock += 2000;
    for (let i = 0; i < 3; i++) swept(`neu-${i}`);
    // Ein alter Schlüssel ist weg – er fängt bei null an und darf wieder voll zählen.
    for (let i = 0; i < 5; i++) assert.equal(swept('alt-0'), true, `Versuch ${i + 1} nach dem Kehren`);
  } finally {
    Date.now = realNow;
  }
});

test('numbers and dates are formatted through one cached formatter per language', () => {
  // Gleiches Ergebnis wie das frühere `toLocaleString` – nur eben ohne es jedes Mal neu zu bauen.
  assert.equal(formatCredits(1234, 'de'), (1234).toLocaleString('de-DE'));
  assert.equal(formatCredits(1234, 'en'), (1234).toLocaleString('en-GB'));
  assert.equal(
    formatEuro(249, 'de'),
    (2.49).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
  );
  assert.equal(
    formatEuro(249, 'en'),
    (2.49).toLocaleString('en-GB', { style: 'currency', currency: 'EUR' })
  );
  const at = Date.parse('2026-03-07T12:00:00Z');
  assert.equal(
    formatDay(at, 'de'),
    new Date(at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  );
  // Zweimal derselbe Aufruf muss dasselbe ergeben – ein geteilter Formatierer darf keinen
  // Zustand mitschleppen.
  assert.equal(formatEuro(100, 'de'), formatEuro(100, 'de'));
});

// ---------------------------------------------------------------- Zeitpläne

test('a schedule fires once per occurrence, in the account time zone, and not too late', () => {
  const user = createUser({ username: 'zeitplaner' });
  db.prepare("UPDATE users SET timezone = 'Europe/Vienna' WHERE id = ?").run(user.id);
  const slot = createProfile(user, billing.planBySlug('premium'));

  const add = (minutes, days) =>
    db
      .prepare(
        `INSERT INTO profile_schedules (profile_id, action, minutes, days, active, created_at)
         VALUES (?, 'stop', ?, ?, 1, ?)`
      )
      .run(slot.id, minutes, days, Date.now()).lastInsertRowid;

  // Dienstag, 1. September 2026, 18:00:30 Ortszeit Wien (= 16:00:30 UTC).
  const now = Date.parse('2026-09-01T16:00:30Z');
  const due = add(18 * 60, '2'); // genau jetzt
  const wrongDay = add(18 * 60, '3'); // Mittwoch
  const tooOld = add(17 * 60, '2'); // eine Stunde her – außerhalb der Nachlauffrist
  const later = add(19 * 60, '2'); // noch nicht

  assert.equal(schedules.tick(now), 1);
  const result = (id) => db.prepare('SELECT last_run_at FROM profile_schedules WHERE id = ?').get(id).last_run_at;
  assert.ok(result(due));
  for (const id of [wrongDay, tooOld, later]) assert.equal(result(id), null);

  // Derselbe Zeitpunkt löst kein zweites Mal aus – das ist es, was aus einem Minutentakt genau
  // eine Ausführung je Zeitpunkt macht.
  assert.equal(schedules.tick(now + 30_000), 0);

  // Wann er das nächste Mal dran ist, rechnet der Server aus – in der Zeitzone des Kontos und
  // nicht in der des Browsers, der gerade hinsieht.
  const upcoming = schedules.nextAt(
    { minutes: 18 * 60, days: '2' },
    'Europe/Vienna',
    Date.parse('2026-09-01T16:30:00Z')
  );
  assert.ok(upcoming > Date.parse('2026-09-01T16:30:00Z'));
  // Nächster Dienstag, wieder 18:00 Ortszeit.
  assert.equal(
    new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', weekday: 'long', hour: '2-digit', minute: '2-digit' })
      .format(upcoming),
    'Dienstag, 18:00'
  );

  // Und der Wochentag zählt zum Zeitpunkt, nicht zu jetzt: Freitag 23:55, nachgeholt um
  // Samstag 00:02 Ortszeit, gehört immer noch zum Freitag.
  db.prepare('DELETE FROM profile_schedules WHERE profile_id = ?').run(slot.id);
  const friday = add(23 * 60 + 55, '5');
  const saturday = add(23 * 60 + 55, '6');
  assert.equal(schedules.tick(Date.parse('2026-09-04T22:02:00Z')), 1);
  assert.ok(result(friday));
  assert.equal(result(saturday), null);
});

test('a schedule takes a weekday, a real time and only accounts that sit on this slot', () => {
  const user = createUser();
  const slot = createProfile(user, billing.planBySlug('premium'));
  const stranger = createAccount(createUser(), { name: 'Fremd' });

  assert.throws(() => schedules.create(slot, { minutes: 60, days: '' }, user.id), /Wochentag|weekday/);
  assert.throws(() => schedules.create(slot, { minutes: 2000, days: '1' }, user.id), /Uhrzeit|Time/i);
  assert.throws(
    () => schedules.create(slot, { minutes: 60, days: '1', account_id: stranger.id }, user.id),
    /sitzt nicht|not on this/
  );

  const made = schedules.create(slot, { minutes: 6 * 60, days: '1,1,7,-2,5', action: 'unfug' }, user.id);
  // Doppelte und unmögliche Tage fallen weg, eine unbekannte Aktion wird zur harmlosen.
  assert.deepEqual(made.days, [1, 5]);
  assert.equal(made.action, 'start');
  // Der Schalter allein lässt den Rest, wie er war.
  const off = schedules.update(slot, made.id, { active: false }, user.id);
  assert.equal(off.active, false);
  assert.deepEqual(off.days, [1, 5]);
  assert.equal(off.minutes, 360);
});

// ---------------------------------------------------------------- Systembericht

test('the system report reads the machine and names what is out of order', async () => {
  const data = await systemreport.collect();
  assert.ok(data.host.hostname);
  assert.ok(Number.isFinite(data.counts.users));
  assert.ok(Array.isArray(data.nodes.offline));

  const embed = systemreport.embed(data);
  assert.match(embed.title, /system report/i);
  // Vier beschriftete Felder statt eines Absatzes mit acht Zahlen darin.
  assert.ok(embed.fields.length >= 4);
  assert.ok(embed.fields.some((field) => field.name === 'Load'));

  // Ohne Client kann kein Bot starten – das gehört gemeldet, auch ohne Webhook.
  const alerts = await systemreport.findAlerts();
  assert.ok(Array.isArray(alerts));
  // Jede Warnung steht in beiden Sprachen da: Discord bekommt Englisch, das Panel die Sprache
  // dessen, der gerade hinsieht.
  for (const alert of alerts) {
    assert.ok(systemreport.alertText(alert.title, 'de'), `${alert.key} ohne deutsche Überschrift`);
    assert.ok(systemreport.alertText(alert.title, 'en'), `${alert.key} ohne englische Überschrift`);
    assert.notEqual(systemreport.alertText(alert.title, 'de'), systemreport.alertText(alert.title, 'en'));
  }
  // Und ohne Webhook geht nichts hinaus.
  assert.equal(await systemreport.send(), false);

  // Der Takt kommt aus den Einstellungen; 0 heißt "nur Warnungen".
  setSetting('system_report_hours', 0);
  assert.equal(systemreport.reportInterval(), 0);
  setSetting('system_report_hours', 6);
  assert.equal(systemreport.reportInterval(), 6 * 3_600_000);
  setSetting('system_report_hours', 12);
});

test('HTTP permissions, suspensions, plan fields and the Discord WebSocket work end to end', async () => {
  // Mindestens 24 Zeichen – kürzer nimmt das Panel bewusst nicht an (routes/bot.js).
  const BOT_SECRET = 'bot-test-secret-long-enough-0123456789';
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

  // Der Name bleibt die Microsoft-Identität. Für die eigene Arbeitsordnung gibt es stattdessen
  // synchronisierte Tags und einen Favoriten: Duplikate verschwinden, ohne dass der erste
  // geschriebene, lesbare Tag verloren geht.
  const organizedAccount = await api(base, `/api/accounts/${account.id}`, {
    token: USER_TOKEN,
    method: 'PATCH',
    body: { tags: 'Farm, Hauptkonto, farm', favorite: true },
  });
  assert.equal(organizedAccount.response.status, 200);
  assert.deepEqual(organizedAccount.data.account.tags, ['Farm', 'Hauptkonto']);
  assert.equal(organizedAccount.data.account.favorite, true);
  const organizedList = await api(base, '/api/accounts', { token: USER_TOKEN });
  const listedOrganized = organizedList.data.accounts.find((entry) => entry.id === account.id);
  assert.deepEqual(listedOrganized.tags, ['Farm', 'Hauptkonto']);
  assert.equal(listedOrganized.favorite, true);
  const tooManyTags = await api(base, `/api/accounts/${account.id}`, {
    token: USER_TOKEN,
    method: 'PATCH',
    body: { tags: 'eins, zwei, drei, vier, fünf, sechs' },
  });
  assert.equal(tooManyTags.response.status, 400);
  const foreignOrganization = await api(base, `/api/accounts/${account.id}`, {
    token: ADMIN_TOKEN,
    method: 'PATCH',
    body: { favorite: false },
  });
  assert.equal(foreignOrganization.response.status, 404);

  // Die Verbindungsdiagnose braucht den letzten dokumentierten Zustand auch dann, wenn nach einem
  // Dienstneustart kein Live-Bot mehr im Speicher steht. Der Profil-Endpunkt liefert genau den
  // letzten Zustandswechsel dieses eigenen Kontos – weder einen älteren noch fremde Ereignisse.
  const olderState = Date.now() - 2_000;
  const lastState = Date.now() - 1_000;
  db.prepare(
    'INSERT INTO bot_events (user_id, profile_id, account_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(user.id, profile.id, account.id, 'online', 'SuspendMe', olderState);
  db.prepare(
    'INSERT INTO bot_events (user_id, profile_id, account_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(user.id, profile.id, account.id, 'error', 'Connection reset', lastState);
  const profilesWithHistory = await api(base, '/api/profiles', { token: USER_TOKEN });
  assert.equal(profilesWithHistory.response.status, 200);
  const diagnosticAccount = profilesWithHistory.data.profiles
    .find((entry) => entry.id === profile.id)
    ?.accounts.find((entry) => entry.account_id === account.id);
  assert.deepEqual(diagnosticAccount?.tags, ['Farm', 'Hauptkonto']);
  assert.equal(diagnosticAccount?.favorite, true);
  assert.deepEqual(diagnosticAccount?.last_state, {
    type: 'error',
    detail: 'Connection reset',
    t: lastState,
  });

  // Die Reihenfolge gehört zum Serverplatz, nicht zum Minecraft-Konto. Der Kunde kann seine
  // tägliche Arbeitsreihenfolge deshalb ändern, ohne Namen, Anmeldung oder andere Plätze zu
  // berühren; der Server schreibt danach eine eindeutige fortlaufende Reihenfolge zurück.
  const orderProfile = createProfile(user, billing.planBySlug('premium'), { name: 'Order test' });
  const secondOrderAccount = createAccount(user, { name: 'Middle order' });
  const thirdOrderAccount = createAccount(user, { name: 'First order' });
  for (const [ordinal, accountId] of [account.id, secondOrderAccount.id, thirdOrderAccount.id].entries()) {
    db.prepare('INSERT INTO profile_accounts (profile_id, account_id, ordinal) VALUES (?, ?, ?)').run(
      orderProfile.id,
      accountId,
      ordinal
    );
  }
  const movedOrderAccount = await api(base, `/api/profiles/${orderProfile.id}/accounts/${thirdOrderAccount.id}`, {
    token: USER_TOKEN,
    method: 'PATCH',
    body: { ordinal: 0 },
  });
  assert.equal(movedOrderAccount.response.status, 200);
  assert.deepEqual(
    movedOrderAccount.data.profile.accounts.map((entry) => entry.account_id),
    [thirdOrderAccount.id, account.id, secondOrderAccount.id]
  );
  assert.deepEqual(
    db
      .prepare('SELECT account_id, ordinal FROM profile_accounts WHERE profile_id = ? ORDER BY ordinal')
      .all(orderProfile.id),
    [
      { account_id: thirdOrderAccount.id, ordinal: 0 },
      { account_id: account.id, ordinal: 1 },
      { account_id: secondOrderAccount.id, ordinal: 2 },
    ]
  );
  const impossibleOrder = await api(base, `/api/profiles/${orderProfile.id}/accounts/${account.id}`, {
    token: USER_TOKEN,
    method: 'PATCH',
    body: { ordinal: 3 },
  });
  assert.equal(impossibleOrder.response.status, 400);
  const atomicOrder = await api(base, `/api/profiles/${orderProfile.id}/accounts/${account.id}`, {
    token: USER_TOKEN,
    method: 'PATCH',
    body: { note: 'must not be saved', ordinal: 3 },
  });
  assert.equal(atomicOrder.response.status, 400);
  assert.equal(
    db
      .prepare('SELECT note FROM profile_accounts WHERE profile_id = ? AND account_id = ?')
      .get(orderProfile.id, account.id).note,
    null
  );
  const unattachedOrderAccount = createAccount(user);
  const unassignedOrder = await api(base, `/api/profiles/${orderProfile.id}/accounts/${unattachedOrderAccount.id}`, {
    token: USER_TOKEN,
    method: 'PATCH',
    body: { ordinal: 0 },
  });
  assert.equal(unassignedOrder.response.status, 404);
  const appendedOrderAccount = await api(base, `/api/profiles/${orderProfile.id}/accounts`, {
    token: USER_TOKEN,
    method: 'POST',
    body: { account_id: unattachedOrderAccount.id },
  });
  assert.equal(appendedOrderAccount.response.status, 200);
  assert.deepEqual(
    appendedOrderAccount.data.profile.accounts.map((entry) => entry.account_id),
    [thirdOrderAccount.id, account.id, secondOrderAccount.id, unattachedOrderAccount.id]
  );
  db.prepare('DELETE FROM profiles WHERE id = ?').run(orderProfile.id);
  assert.equal(diagnosticAccount?.retry, null);

  const englishHome = await (await fetch(`${base}/en`)).text();
  const germanHome = await (await fetch(`${base}/de`)).text();
  assert.match(englishHome, /class="language-picker" role="group" aria-label="Language"/);
  assert.match(englishHome, /href="\/de"[^>]*data-language="de"[^>]*>Deutsch<\/a>/);
  assert.match(englishHome, /href="\/en"[^>]*data-language="en" aria-current="true">English<\/a>/);
  assert.match(germanHome, /class="language-picker" role="group" aria-label="Sprache"/);
  assert.match(germanHome, /href="\/de"[^>]*data-language="de" aria-current="true">Deutsch<\/a>/);
  assert.match(germanHome, /href="\/en"[^>]*data-language="en"[^>]*>English<\/a>/);
  assert.match(germanHome, /class="site-menu-toggle"[^>]*aria-expanded="false"/);
  // Support verlinkt auf feste, gepflegte FAQ-Abschnitte statt auf erzeugte Antworten. Die Anker
  // gehören deshalb zur öffentlichen Seite und nicht nur zu einer zufälligen Panelansicht.
  const faq = await (await fetch(`${base}/en/faq`)).text();
  assert.match(faq, /<details id="faq-account-security">/);
  assert.match(faq, /<details id="faq-balance">/);
  assert.match(faq, /<details id="faq-rules">/);
  assert.match(faq, /<details id="faq-renewal">/);
  assert.match(germanHome, /class="site-menu" id="site-menu"/);
  assert.doesNotMatch(germanHome, /\/js\/shield\.js/);
  setSetting('content_lock_ui', 1);
  const lockedHome = await (await fetch(`${base}/de`)).text();
  setSetting('content_lock_ui', 0);
  assert.match(lockedHome, /\/js\/shield\.js/);
  assert.doesNotMatch(germanHome, /class="hero-product"|play\.example\.net|Vorschau des AFKSystems-Panels/);
  assert.doesNotMatch(germanHome, /Live-Steuerung|class="hl"/);
  assert.doesNotMatch(englishHome, /Live control|class="hl"/);
  assert.doesNotMatch(germanHome, /\{\{[^}]+\}\}/);

  const appShell = await (await fetch(`${base}/en/app`)).text();
  assert.match(appShell, /class="mobile-nav" id="mobile-nav"/);
  assert.match(appShell, /id="side-backdrop"[^>]*aria-label="Close"/);
  assert.match(appShell, /class="side boot-side"[^>]*aria-busy="true"/);
  assert.match(appShell, /rel="modulepreload"[^>]*\/js\/app\.js/);
  assert.equal((await fetch(`${base}/en/app`)).headers.get('cache-control'), 'no-store');
  const homeResponse = await fetch(`${base}/en`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(homeResponse.headers.get('content-encoding'), 'gzip');
  assert.equal(homeResponse.headers.get('x-frame-options'), 'DENY');
  assert.match(homeResponse.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(homeResponse.headers.get('content-security-policy'), /script-src[^;]*unsafe-inline/);
  assert.match(homeResponse.headers.get('permissions-policy'), /camera=\(\)/);
  const headerMeta = await (
    await fetch(`${base}/api/meta?scope=header`, { headers: { cookie: `afk_session=${USER_TOKEN}` } })
  ).json();
  assert.deepEqual(Object.keys(headerMeta).sort(), ['registration_open', 'user']);
  assert.equal(headerMeta.user.id, user.id);
  const panelMeta = await (
    await fetch(`${base}/api/meta?scope=panel`, { headers: { cookie: `afk_session=${USER_TOKEN}` } })
  ).json();
  assert.deepEqual(Object.keys(panelMeta).sort(), ['announcements', 'discord_invite']);
  const authMeta = await (
    await fetch(`${base}/api/meta?scope=auth`, { headers: { cookie: `afk_session=${USER_TOKEN}` } })
  ).json();
  assert.deepEqual(Object.keys(authMeta).sort(), ['mail_ready', 'oauth', 'registration_open', 'user']);
  assert.equal(authMeta.user.id, user.id);
  const fullMeta = await (
    await fetch(`${base}/api/meta`, { headers: { cookie: `afk_session=${USER_TOKEN}` } })
  ).json();
  assert.ok(fullMeta.plans.length > 0);
  assert.ok(JSON.stringify(panelMeta).length < JSON.stringify(fullMeta).length / 4);
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
  // Die entfernte Impressumsseite verschwindet aus Route, Fuß und Sitemap.
  const imprint = await fetch(`${base}/de/imprint`);
  assert.equal(imprint.status, 404);
  assert.doesNotMatch(await (await fetch(`${base}/sitemap.xml`)).text(), /\/imprint<\/loc>/);

  // Die Sprache in der Adresse schlägt Cookie und Browsereinstellung. Für die bekannten Seiten war
  // das immer so – ihre Route liest sie selbst aus dem Pfad. Die Fehlerseite kam aber woanders her
  // und antwortete auf `/de/…` englisch, wenn der Browser englisch sprach.
  const wrongLang = { 'accept-language': 'en-US,en', cookie: 'lang=en' };
  const missingDe = await fetch(`${base}/de/gibt-es-nicht`, { headers: wrongLang });
  assert.equal(missingDe.status, 404);
  assert.match(await missingDe.text(), /<h1>Hier ist nichts<\/h1>/);
  assert.match(
    await (await fetch(`${base}/en/gibt-es-nicht`, { headers: { cookie: 'lang=de' } })).text(),
    /<h1>Nothing here<\/h1>/
  );
  // Ohne Sprache im Pfad bleibt es beim Cookie – sonst wäre die Weiterleitung von `/` beliebig.
  const rootRedirect = await fetch(`${base}/`, { headers: wrongLang, redirect: 'manual' });
  assert.equal(rootRedirect.headers.get('location'), '/en');

  const crossSite = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: `afk_session=${USER_TOKEN}`, origin: 'https://evil.example' },
  });
  assert.equal(crossSite.status, 403);

  // Ohne jeden Hinweis auf die Herkunft ist eine schreibende Anfrage ebenfalls nichts, worauf sich
  // ein Sitzungs-Cookie ausgeben lässt. Vorher kam sie durch: Es wurde nur geprüft, ob ein
  // vorhandener Origin passt – und ein Formular auf einer fremden Seite schickt keinen.
  const noHint = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: `afk_session=${USER_TOKEN}` },
  });
  assert.equal(noHint.status, 403);

  // Ein gefälschtes `X-Forwarded-Host` schreibt sich nicht selbst in die Liste der erlaubten
  // Herkünfte. Vorher wurde genau diese Kopfzeile geglaubt, und damit war die Prüfung darüber
  // eine Frage danach, was der Angreifer behauptet.
  const forgedHost = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: {
      cookie: `afk_session=${USER_TOKEN}`,
      origin: 'https://evil.example',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(forgedHost.status, 403);

  // Und der Gegenbeweis: mit echtem Origin geht dieselbe Anfrage durch. Die Sitzung dieses
  // Kontos wird dabei bewusst nicht benutzt – sonst wäre sie danach weg.
  const sameSite = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { origin: base },
  });
  assert.equal(sameSite.status, 200);

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

  // „Answered“ bedeutet „der Kunde ist am Zug“, nicht „der Discord-Kanal ist gesperrt“. Eine
  // normale, verknüpfte Person kann dort direkt nachfragen und das Ticket wird wieder offen.
  assert.equal(db.prepare('SELECT status FROM tickets WHERE id = ?').get(openTicket.id).status, 'answered');
  const discordAnsweredReply = await api(base, `/api/bot/tickets/${openTicket.id}/messages`, {
    botSecret: BOT_SECRET,
    method: 'POST',
    body: {
      discord_id: '300000000000000005',
      discord_user_id: user.discord_id,
      author_name: 'Customer test',
      body: 'I can still reply from Discord after an answer.',
    },
  });
  assert.equal(discordAnsweredReply.response.status, 200);
  assert.equal(discordAnsweredReply.data.ticket.status, 'open');

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
      ticketUrl: (id) => `https://example.test/en/app#/tickets/${id}`,
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

  // Diagnosekontext kommt vollständig vom Server, wird ans neue Ticket gehängt und enthält keine
  // fremden Plätze: Der Kunde sieht vor dem Versand genau diesen Auszug.
  const diagnosticPreview = await api(base, `/api/tickets/diagnostics?profile_id=${profile.id}`, {
    token: USER_TOKEN,
  });
  assert.equal(diagnosticPreview.response.status, 200);
  assert.match(diagnosticPreview.data.diagnostic.preview, /Diagnostic context/);
  assert.match(diagnosticPreview.data.diagnostic.preview, /SuspendMe/);
  const diagnosticTicket = await api(base, '/api/tickets', {
    token: USER_TOKEN,
    method: 'POST',
    body: { subject: 'Diagnostic context', body: 'Please inspect this.', diagnostic_profile_id: profile.id },
  });
  assert.equal(diagnosticTicket.response.status, 200);
  const diagnosticThread = await api(base, `/api/tickets/${diagnosticTicket.data.ticket.id}`, { token: USER_TOKEN });
  assert.match(diagnosticThread.data.messages.at(-1).body, /generated by the panel/);

  // Die Kundenseite der Verwaltung beantwortet „ich komme nicht mehr hinein“ selbst: Hat das Konto
  // einen zweiten Faktor, welche Geräte sind offen, und was hat die Verwaltung zuletzt daran
  // geändert. Alles drei stand vorher in der Datenbank und nirgends auf dem Bildschirm.
  assert.equal(userInfo.data.totp.enabled, false);
  assert.ok(Array.isArray(userInfo.data.signins));
  assert.ok(Array.isArray(userInfo.data.audit));
  assert.ok(Array.isArray(userInfo.data.mails));
  assert.equal(userInfo.data.deletion, null);
  assert.ok(userInfo.data.sessions.length >= 1, 'die offenen Sitzungen des Kunden gehören in die Ansicht');
  // Und der Kurzabdruck ist ein Abdruck: Das Sitzungstoken selbst darf die Antwort nie verlassen.
  assert.ok(!JSON.stringify(userInfo.data.sessions).includes(USER_TOKEN));
  const knownRefs = new Set(userInfo.data.sessions.map((entry) => entry.ref));

  // Ohne zweiten Faktor gibt es nichts abzunehmen – und die Absage sagt das, statt still
  // „gespeichert“ zu melden.
  const noTotp = await api(base, `/api/admin/users/${user.id}/totp-reset`, {
    token: ADMIN_TOKEN,
    method: 'POST',
  });
  assert.equal(noTotp.response.status, 400);

  // Ein einzelnes Gerät abmelden, ohne den Kunden aus allen übrigen zu werfen. Ein erfundener
  // Abdruck trifft nichts; danach ist genau diese eine Sitzung weg.
  assert.equal(
    (
      await api(base, `/api/admin/users/${user.id}/sessions/deadbeefdeadbeef`, {
        token: ADMIN_TOKEN,
        method: 'DELETE',
      })
    ).response.status,
    404
  );
  createSession(user, 'user-second-device');
  const secondRef = (await api(base, `/api/admin/users/${user.id}`, { token: ADMIN_TOKEN })).data.sessions.find(
    (entry) => !knownRefs.has(entry.ref)
  ).ref;
  const droppedSession = await api(base, `/api/admin/users/${user.id}/sessions/${secondRef}`, {
    token: ADMIN_TOKEN,
    method: 'DELETE',
  });
  assert.equal(droppedSession.response.status, 200);
  assert.ok(!droppedSession.data.sessions.some((entry) => entry.ref === secondRef));
  // Das zuerst geöffnete Gerät des Kunden ist noch da – „ein Gerät abmelden“ heißt genau eines.
  assert.equal((await api(base, '/api/me', { token: USER_TOKEN })).response.status, 200);

  // Ein Admin kann einen kurzlebigen Einmal-Link erzeugen. Der Link allein reicht nicht: Ohne
  // Sitzung geht es zur Anmeldung, als gewöhnlicher Nutzer gibt es eine Absage, und erst ein
  // angemeldeter Admin verbraucht ihn und erhält die geliehene Kundensitzung.
  const oneTime = await api(base, `/api/admin/users/${user.id}/login-link`, {
    token: ADMIN_TOKEN,
    method: 'POST',
  });
  assert.equal(oneTime.response.status, 200);
  const oneTimePath = new URL(oneTime.data.link).pathname;
  const anonymousLink = await fetch(`${base}${oneTimePath}`, { redirect: 'manual' });
  assert.equal(anonymousLink.status, 302);
  assert.match(anonymousLink.headers.get('location'), /\/login\?next=/);
  assert.equal(
    (
      await fetch(`${base}${oneTimePath}`, {
        headers: { cookie: `afk_session=${USER_TOKEN}` },
        redirect: 'manual',
      })
    ).status,
    403
  );
  const openedLink = await fetch(`${base}${oneTimePath}`, {
    headers: { cookie: `afk_session=${ADMIN_TOKEN}` },
    redirect: 'manual',
  });
  assert.equal(openedLink.status, 302);
  assert.equal(openedLink.headers.get('location'), '/en/app');
  const borrowedCookie = openedLink.headers.get('set-cookie')?.match(/afk_session=([^;]+)/)?.[1];
  assert.ok(borrowedCookie);
  const borrowedMe = await api(base, '/api/me', { token: borrowedCookie });
  assert.equal(borrowedMe.data.user.id, user.id);
  assert.equal(borrowedMe.data.impersonator.id, admin.id);
  assert.equal(
    (
      await fetch(`${base}${oneTimePath}`, {
        headers: { cookie: `afk_session=${ADMIN_TOKEN}` },
        redirect: 'manual',
      })
    ).status,
    410
  );

  // Die Suche über alles: ein Anhaltspunkt, Treffer aus mehreren Tabellen, und jeder bringt den
  // Weg zu sich selbst mit. Ein Kunde darf sie nicht einmal ansehen – sie zeigt fremde Mailadressen.
  const searchByMail = await api(base, `/api/admin/search?q=${encodeURIComponent(user.email)}`, {
    token: ADMIN_TOKEN,
  });
  assert.equal(searchByMail.response.status, 200);
  const foundUser = searchByMail.data.groups.find((group) => group.kind === 'users');
  assert.deepEqual(foundUser.hits.map((hit) => hit.id), [user.id]);
  assert.equal(foundUser.hits[0].route, `/admin/users/${user.id}`);

  const searchByName = await api(base, '/api/admin/search?q=SuspendMe', { token: ADMIN_TOKEN });
  const foundAccount = searchByName.data.groups.find((group) => group.kind === 'accounts');
  // Ein Account hat keine eigene Seite – der Treffer führt dorthin, wo er wirklich steht.
  assert.equal(foundAccount.hits[0].route, `/admin/users/${user.id}`);

  // Eine bloße Nummer findet die Sache mit dieser Nummer – auch wenn sie nur ein Zeichen lang
  // ist. Ticket 7 heißt wirklich 7, und wer das eintippt, meint nichts anderes.
  const searchByTicketId = await api(base, `/api/admin/search?q=${openTicket.id}`, { token: ADMIN_TOKEN });
  const foundTicket = searchByTicketId.data.groups.find((group) => group.kind === 'tickets');
  assert.equal(foundTicket.hits[0].id, openTicket.id);

  // Ein einzelner Buchstabe ist dagegen keine Suche, sondern eine Anfrage über die halbe Datenbank.
  const searchTooShort = await api(base, '/api/admin/search?q=a', { token: ADMIN_TOKEN });
  assert.deepEqual(searchTooShort.data.groups, []);

  const searchAsUser = await api(base, '/api/admin/search?q=SuspendMe', { token: USER_TOKEN });
  assert.equal(searchAsUser.response.status, 403);

  // Massenaktionen: was nicht geht, wird übersprungen und aufgezählt – nicht abgebrochen. Sonst
  // bliebe die halbe Auswahl geändert und niemand wüsste welche Hälfte.
  const poorUser = createUser({ credits: 0 });
  const richUser = createUser({ credits: 500 });
  const bulkCredits = await api(base, '/api/admin/users/bulk', {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { action: 'credits', ids: [richUser.id, poorUser.id], credits_delta: -200, note: 'Rückbuchung' },
  });
  assert.equal(bulkCredits.response.status, 200);
  assert.equal(bulkCredits.data.done, 1);
  assert.deepEqual(bulkCredits.data.skipped.map((entry) => entry.reason), ['negative']);
  assert.equal(db.prepare('SELECT credits FROM users WHERE id = ?').get(richUser.id).credits, 300);
  assert.equal(db.prepare('SELECT credits FROM users WHERE id = ?').get(poorUser.id).credits, 0);

  // Sich selbst sperrt niemand aus – auch nicht versehentlich als Teil einer Auswahl.
  const bulkBlock = await api(base, '/api/admin/users/bulk', {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { action: 'block', ids: [admin.id, poorUser.id] },
  });
  assert.equal(bulkBlock.data.done, 1);
  assert.deepEqual(bulkBlock.data.skipped.map((entry) => entry.reason), ['self']);
  assert.equal(db.prepare('SELECT blocked FROM users WHERE id = ?').get(admin.id).blocked, 0);
  assert.equal(db.prepare('SELECT blocked FROM users WHERE id = ?').get(poorUser.id).blocked, 1);

  const bulkUnknown = await api(base, '/api/admin/users/bulk', {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { action: 'delete-everything', ids: [poorUser.id] },
  });
  assert.equal(bulkUnknown.response.status, 400);

  // Ausfuhr: eine Datei zum Mitnehmen, mit Kopfzeile, als Anhang und ohne Zwischenspeicher.
  const csvResponse = await fetch(`${base}/api/admin/export/users`, {
    headers: { cookie: `afk_session=${ADMIN_TOKEN}` },
  });
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get('content-type'), /text\/csv/);
  assert.match(csvResponse.headers.get('content-disposition'), /attachment; filename="[\w-]+-users-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.equal(csvResponse.headers.get('cache-control'), 'no-store');
  // Als Bytes gelesen, nicht als Text: `text()` schluckt die BOM nach Vorschrift, und genau die
  // ist hier der Unterschied zwischen "Serverplätze" und "Serverplätze" in Excel.
  const csvBytes = Buffer.from(await csvResponse.arrayBuffer());
  assert.deepEqual([...csvBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = csvBytes.toString('utf8').slice(1);
  assert.match(csv.split('\r\n')[0], /^id,username,email,role,credits/);
  assert.ok(csv.includes(user.email));

  // Ein Feld, das mit = anfängt, ist für Excel eine Formel. Es kommt entschärft heraus – sonst
  // wäre eine Notiz im Buchungsprotokoll ein Angriff auf den, der die Datei öffnet.
  billing.move(richUser.id, 5, 'admin', '=1+1');
  const ledgerCsv = await (
    await fetch(`${base}/api/admin/export/ledger`, { headers: { cookie: `afk_session=${ADMIN_TOKEN}` } })
  ).text();
  assert.ok(ledgerCsv.includes("'=1+1"));

  const csvAsUser = await fetch(`${base}/api/admin/export/users`, {
    headers: { cookie: `afk_session=${USER_TOKEN}` },
  });
  assert.equal(csvAsUser.status, 403);
  const csvUnknown = await fetch(`${base}/api/admin/export/passwords`, {
    headers: { cookie: `afk_session=${ADMIN_TOKEN}` },
  });
  assert.equal(csvUnknown.status, 404);

  // Textbausteine: aus der Erstbefüllung kommen welche mit, und der Zähler daneben ist die
  // einzige ehrliche Auskunft darüber, welcher davon seinen Platz verdient.
  const templates = await api(base, '/api/admin/ticket-templates', { token: ADMIN_TOKEN });
  assert.equal(templates.response.status, 200);
  assert.ok(templates.data.templates.length >= 10);
  const first = templates.data.templates[0];
  assert.match(first.body_de, /\{name\}/);
  await api(base, `/api/admin/ticket-templates/${first.id}/used`, { token: ADMIN_TOKEN, method: 'POST' });
  assert.equal(
    db.prepare('SELECT uses FROM ticket_templates WHERE id = ?').get(first.id).uses,
    1
  );
  const ownTemplate = await api(base, '/api/admin/ticket-templates', {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: {
      title_de: 'Eigener Baustein',
      title_en: 'Own canned reply',
      body_de: 'Hallo {name}, alles klar.',
      body_en: 'Hi {name}, all sorted.',
    },
  });
  assert.equal(ownTemplate.response.status, 200);
  assert.equal(ownTemplate.data.template.body_en, 'Hi {name}, all sorted.');
  // Eine einsprachige Vorlage wird abgewiesen: Sonst bekäme ein englischer Kunde deutschen Text.
  const oneLanguage = await api(base, '/api/admin/ticket-templates', {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { title_de: 'Nur deutsch', body_de: 'Hallo {name}.' },
  });
  assert.equal(oneLanguage.response.status, 400);
  const templateAsUser = await api(base, '/api/admin/ticket-templates', { token: USER_TOKEN });
  assert.equal(templateAsUser.response.status, 403);

  // Erstatten geht nur, wo es etwas zu erstatten gibt. Diese drei Absagen kommen, **bevor**
  // irgendetwas zu Stripe geht – deshalb prüfen sie sich ohne Netz und ohne Schlüssel.
  const cashTopup = db
    .prepare(
      `INSERT INTO topups (user_id, provider, amount_cent, credits, status, created_at, paid_at)
       VALUES (?, 'transfer', 500, 500, 'paid', ?, ?)`
    )
    .run(user.id, Date.now(), Date.now()).lastInsertRowid;
  const openTopup = db
    .prepare(
      `INSERT INTO topups (user_id, provider, amount_cent, credits, status, created_at)
       VALUES (?, 'stripe', 500, 500, 'open', ?)`
    )
    .run(user.id, Date.now()).lastInsertRowid;
  const paidTopup = db
    .prepare(
      `INSERT INTO topups (user_id, provider, amount_cent, credits, status, external_id, created_at, paid_at)
       VALUES (?, 'stripe', 500, 500, 'paid', 'pi_test_123', ?, ?)`
    )
    .run(user.id, Date.now(), Date.now()).lastInsertRowid;

  for (const [id, body] of [
    [cashTopup, {}],
    [openTopup, {}],
    [paidTopup, { amount_cent: 900 }],
  ]) {
    const refused = await api(base, `/api/admin/topups/${id}/refund`, {
      token: ADMIN_TOKEN,
      method: 'POST',
      body,
    });
    assert.equal(refused.response.status, 400, `Aufladung ${id} hätte abgelehnt werden müssen`);
  }

  // Rundmail: Jeder Empfängerkreis kommt mit seiner Zahl, bevor irgendetwas hinausgeht.
  const broadcast = await api(base, '/api/admin/broadcast', { token: ADMIN_TOKEN });
  assert.equal(broadcast.response.status, 200);
  const groups = Object.fromEntries(broadcast.data.segments.map((entry) => [entry.key, entry.count]));
  const confirmed = db
    .prepare('SELECT COUNT(*) AS n FROM users WHERE blocked = 0 AND email_verified = 1')
    .get().n;
  assert.equal(groups.all, confirmed);
  assert.ok(groups.all >= groups.paying);
  // Gesperrte und unbestätigte Adressen sind überall ausgenommen – außer im Kreis, der sie meint.
  // richUser und nicht poorUser: Der ist ein paar Zeilen weiter oben gesperrt worden und zählt
  // deshalb ohnehin nirgends mit – die Prüfung hätte nichts geprüft.
  db.prepare('UPDATE users SET email_verified = 0 WHERE id = ?').run(richUser.id);
  const afterUnverify = await api(base, '/api/admin/broadcast', { token: ADMIN_TOKEN });
  const after = Object.fromEntries(afterUnverify.data.segments.map((entry) => [entry.key, entry.count]));
  assert.equal(after.all, groups.all - 1);
  assert.equal(after.unverified, groups.unverified + 1);
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(richUser.id);

  const badSegment = await api(base, '/api/admin/broadcast', {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { title_de: 'Hallo', body_de: 'Text', segment: 'alle-mit-einem-a' },
  });
  // Ohne SMTP kommt die Absage schon vorher – beides ist eine Absage und kein Versand.
  assert.ok(badSegment.response.status === 400);

  // Passwort-Raten: Zehn Fehlversuche von derselben Adresse, dann macht die Tür nicht mehr auf –
  // und zwar bevor überhaupt ein Passwort geprüft wird.
  db.prepare('DELETE FROM login_attempts').run();
  let throttled = null;
  for (let attempt = 0; attempt < 11; attempt++) {
    const tried = await api(base, '/api/auth/login', {
      method: 'POST',
      body: { login: user.email, password: 'das-ist-es-nicht' },
    });
    if (tried.response.status === 429) {
      throttled = attempt;
      break;
    }
    assert.equal(tried.response.status, 401);
  }
  assert.equal(throttled, 10, 'nach zehn Fehlversuchen ist Schluss');
  const written = db.prepare('SELECT reason, ok FROM login_attempts ORDER BY id').all();
  assert.equal(written.length, 11);
  assert.equal(written.at(-1).reason, 'throttled');
  assert.ok(written.every((row) => row.ok === 0));

  // Der Admin-Bereich zeigt genau das – zusammengefasst nach Adresse, nicht als elf Zeilen.
  const securityView = await api(base, '/api/admin/security', { token: ADMIN_TOKEN });
  assert.equal(securityView.response.status, 200);
  assert.equal(securityView.data.ips[0].failed, 11);
  assert.ok(
    securityView.data.sessions.some((session) => session.display_name === admin.discord_name)
  );
  // Sitzungsschlüssel sind Passwortersatz und haben in einer Ansicht nichts verloren.
  assert.ok(!JSON.stringify(securityView.data.sessions).includes(ADMIN_TOKEN));

  // Eine Sperre auf ein fremdes Netz stört den laufenden Betrieb nicht – und die eigene Adresse
  // lässt sich gar nicht erst eintragen.
  const blockOther = await api(base, '/api/admin/security/blocks', {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { value: '203.0.113.0/24', reason: 'Testnetz', days: 2 },
  });
  assert.equal(blockOther.response.status, 200);
  const blockSelf = await api(base, '/api/admin/security/blocks', {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { value: '127.0.0.1' },
  });
  assert.equal(blockSelf.response.status, 400);
  const stillWorks = await api(base, '/api/admin/overview', { token: ADMIN_TOKEN });
  assert.equal(stillWorks.response.status, 200);
  db.prepare('DELETE FROM login_attempts').run();

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

  // Der Verlauf zum Mitnehmen. Eine Textdatei, die man an ein Ticket hängen kann – deshalb mit
  // Dateinamen im Kopf und nicht als JSON, das im Browser landet.
  const exported = await fetch(`${base}/api/profiles/${profile.id}/chat.txt`, {
    headers: { cookie: `afk_session=${USER_TOKEN}` },
  });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type'), /^text\/plain/);
  assert.match(exported.headers.get('content-disposition'), /attachment; filename\*=UTF-8''/);

  // Der Export folgt der Kontenauswahl. Das ist nicht nur ein Filter für das Auge: Wer einen
  // Verlauf weitergibt, gibt damit auch nur die ausgewählte Bot-Sicht weiter.
  const otherAccount = createAccount(user, { name: 'OnlyInOtherExport' });
  db.prepare('INSERT INTO profile_accounts (profile_id, account_id, wanted) VALUES (?, ?, 0)').run(
    profile.id,
    otherAccount.id
  );
  const selectedExport = await fetch(`${base}/api/profiles/${profile.id}/chat.txt?accounts=${otherAccount.id}`, {
    headers: { cookie: `afk_session=${USER_TOKEN}` },
  });
  assert.equal(selectedExport.status, 200);
  assert.match(selectedExport.headers.get('content-type'), /^text\/plain/);
  // Der kontrollierte Export bleibt auf derselben eigenen Kontenauswahl, kann aber in ein
  // Tabellen- oder Strukturformat wechseln. Die JSON-Hülle enthält nur lesbare Chatdaten und
  // den eigenen Serverplatz, keine Microsoft-Anmeldung oder andere Konten.
  const csvExport = await fetch(
    `${base}/api/profiles/${profile.id}/chat/export?format=csv&accounts=${otherAccount.id}`,
    { headers: { cookie: `afk_session=${USER_TOKEN}` } }
  );
  assert.equal(csvExport.status, 200);
  assert.match(csvExport.headers.get('content-type'), /^text\/csv/);
  assert.match(await csvExport.text(), /^timestamp,type,accounts,text/m);
  const jsonExport = await fetch(
    `${base}/api/profiles/${profile.id}/chat/export?format=json&accounts=${otherAccount.id}&all=1`,
    { headers: { cookie: `afk_session=${USER_TOKEN}` } }
  );
  assert.equal(jsonExport.status, 200);
  assert.match(jsonExport.headers.get('content-type'), /^application\/json/);
  const jsonBody = await jsonExport.json();
  assert.equal(jsonBody.server_slot.id, profile.id);
  assert.equal(jsonBody.server_slot.name, profile.name);
  assert.ok(Array.isArray(jsonBody.lines));
  const invalidExportFormat = await api(base, `/api/profiles/${profile.id}/chat/export?format=html`, {
    token: USER_TOKEN,
  });
  assert.equal(invalidExportFormat.response.status, 400);
  const invalidExportRange = await api(
    base,
    `/api/profiles/${profile.id}/chat/export?format=json&from=2&until=1`,
    { token: USER_TOKEN }
  );
  assert.equal(invalidExportRange.response.status, 400);
  // Die Guthabenwarnung gehört dem Kunden: -1 nimmt wieder die Betreiberempfehlung, jede
  // nichtnegative ganze Zahl ist eine nachvollziehbare persönliche Schwelle.
  const personalWarning = await api(base, '/api/me', {
    token: USER_TOKEN,
    method: 'PATCH',
    body: { low_balance_warning: 321 },
  });
  assert.equal(personalWarning.response.status, 200);
  assert.equal(personalWarning.data.user.low_balance_warning, 321);
  const billingWithPersonalWarning = await api(base, '/api/billing', { token: USER_TOKEN });
  assert.equal(billingWithPersonalWarning.response.status, 200);
  assert.equal(billingWithPersonalWarning.data.low_balance, 321);
  assert.equal(billingWithPersonalWarning.data.personal_low_balance, 321);
  const invalidPersonalWarning = await api(base, '/api/me', {
    token: USER_TOKEN,
    method: 'PATCH',
    body: { low_balance_warning: -2 },
  });
  assert.equal(invalidPersonalWarning.response.status, 400);
  // Die persönliche Microsoft-Prüfung zeigt nur die eigenen wirklich fehlerhaften Anmeldungen
  // samt ihren tatsächlichen Serverplatz-Auswirkungen. Sie liefert weder Zugangsdaten noch eine
  // Sammelaktion, die Konten oder Bots umhängen könnte.
  const reviewAccount = createAccount(user, { name: 'NeedsMicrosoftReview' });
  db.prepare("UPDATE mc_accounts SET kind = 'microsoft', status = 'error', last_error = 'Sign-in expired' WHERE id = ?").run(
    reviewAccount.id
  );
  db.prepare('INSERT INTO profile_accounts (profile_id, account_id, wanted) VALUES (?, ?, 1)').run(
    profile.id,
    reviewAccount.id
  );
  const loginReview = await api(base, '/api/accounts/review', { token: USER_TOKEN });
  assert.equal(loginReview.response.status, 200);
  const reviewed = loginReview.data.accounts.find((entry) => entry.id === reviewAccount.id);
  assert.ok(reviewed);
  assert.deepEqual(reviewed.slots.map((slot) => slot.id), [profile.id]);
  assert.equal(reviewed.impact.slots, 1);
  assert.equal(reviewed.impact.waiting_to_start, 1);
  assert.equal(Object.hasOwn(reviewed, 'token'), false);
  const otherLoginReview = await api(base, '/api/accounts/review', { token: ADMIN_TOKEN });
  assert.equal(otherLoginReview.response.status, 200);
  assert.equal(otherLoginReview.data.accounts.some((entry) => entry.id === reviewAccount.id), false);
  const invalidSelection = await api(base, `/api/profiles/${profile.id}/chat.txt?accounts=999999`, {
    token: USER_TOKEN,
  });
  assert.equal(invalidSelection.response.status, 400);
  // Und nur der eigene: Der Verlauf eines fremden Serverplatzes ist niemandes Sache.
  const foreignExport = await fetch(`${base}/api/profiles/${profile.id}/chat.txt`, {
    headers: { cookie: `afk_session=${ADMIN_TOKEN}` },
  });
  assert.equal(foreignExport.status, 404);

  // Ein Startfehler bleibt in `bots`, auch wenn der Prozess längst weg und nach einem Neustart
  // kein Live-Objekt mehr vorhanden ist. Die Adminansicht braucht genau diesen Grund – bereinigt
  // und erklärt statt nur des Zustandswortes „error“.
  db.prepare(
    `INSERT INTO bots (profile_id, account_id, state, last_error)
     VALUES (?, ?, 'error', '[0mmultiplayer.requiredTexturePrompt.disconnect [0m')`
  ).run(profile.id, account.id);
  const failedServer = await api(base, `/api/admin/servers/${profile.id}`, { token: ADMIN_TOKEN });
  assert.equal(failedServer.response.status, 200);
  assert.equal(
    failedServer.data.accounts.find((entry) => entry.account_id === account.id).last_error,
    'Der Server verlangt ein Resource-Pack. Der Client hat das verpflichtende Pack nicht bestätigt.'
  );

  // Ein einzelner Bot lässt sich einzeln stoppen – von acht Bots auf einem Platz hängt eben oft
  // genau einer, und „alle neu starten“ wirft die anderen sieben mit aus dem Spiel.
  const stoppedOne = await api(base, `/api/admin/servers/${profile.id}/accounts/${account.id}/stop`, {
    token: ADMIN_TOKEN,
    method: 'POST',
  });
  assert.equal(stoppedOne.response.status, 200);
  // Ein Konto, das nicht auf diesem Platz sitzt, ist auch über diesen Weg keins.
  assert.equal(
    (
      await api(base, `/api/admin/servers/${profile.id}/accounts/999999/restart`, {
        token: ADMIN_TOKEN,
        method: 'POST',
      })
    ).response.status,
    404
  );
  // Und ein Kunde kommt an diese Knöpfe gar nicht heran.
  assert.equal(
    (
      await api(base, `/api/admin/servers/${profile.id}/accounts/${account.id}/stop`, {
        token: USER_TOKEN,
        method: 'POST',
      })
    ).response.status,
    403
  );

  // Die Bots eines einzelnen Platzes auf die Datei heben, die jetzt auf der Platte liegt. Läuft
  // hier keiner, ist es null – der Aufruf ist trotzdem gültig und meldet ehrlich die Zahl.
  const rollout = await api(base, `/api/admin/servers/${profile.id}/client-rollout`, {
    token: ADMIN_TOKEN,
    method: 'POST',
  });
  assert.equal(rollout.response.status, 200);
  assert.equal(rollout.data.restarted, 0);

  // Adresse und Protokollversion darf die Verwaltung auch dann ändern, wenn der Platz gesperrt ist –
  // der Kunde kann es dann nämlich nicht mehr, und genau deshalb ruft er an.
  await api(base, `/api/admin/servers/${profile.id}/lock`, {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { locked: true, reason: 'Test' },
  });
  const nameBeforeMove = failedServer.data.profile.name;
  const readdressed = await api(base, `/api/admin/profiles/${profile.id}`, {
    token: ADMIN_TOKEN,
    method: 'PATCH',
    body: { address: 'umzug.example.net:25566', name: 'Nach dem Umzug' },
  });
  assert.equal(readdressed.response.status, 200);
  const afterMove = await api(base, `/api/admin/servers/${profile.id}`, { token: ADMIN_TOKEN });
  assert.equal(afterMove.data.profile.address, 'umzug.example.net:25566');
  assert.equal(afterMove.data.profile.name, 'Nach dem Umzug');
  // Zurück auf den alten Namen: Weiter unten prüft dieser Test die Kontenliste des Kunden, und
  // dort steht derselbe Serverplatz noch einmal.
  await api(base, `/api/admin/profiles/${profile.id}`, {
    token: ADMIN_TOKEN,
    method: 'PATCH',
    body: { name: nameBeforeMove },
  });
  // Eine Protokollversion, die der Client nicht spricht, wird abgelehnt statt gespeichert.
  assert.equal(
    (
      await api(base, `/api/admin/profiles/${profile.id}`, {
        token: ADMIN_TOKEN,
        method: 'PATCH',
        body: { mc_version: '1.7.10' },
      })
    ).response.status,
    binaries.state.versions.length ? 400 : 200
  );
  await api(base, `/api/admin/servers/${profile.id}/lock`, {
    token: ADMIN_TOKEN,
    method: 'POST',
    body: { locked: false },
  });

  // Die texturierte Live-Ansicht ist ein Zusatz. Ohne ihn gibt es sie auch nicht über den Umweg
  // der Bild-Endpunkte – sonst wäre der bezahlte Teil des Zusatzes nur eine Schaltfläche.
  const povGate = await api(base, `/api/profiles/${profile.id}/pov/${account.id}/state.json`, {
    token: USER_TOKEN,
  });
  assert.equal(povGate.response.status, 402);
  // Und es gibt genau die Pfade, die im Router stehen – keinen Durchreicher auf eine Adresse aus
  // der Anfrage. Sonst wäre das hier ein offener Proxy auf den Localhost des Servers.
  const noPassthrough = await fetch(
    `${base}/api/profiles/${profile.id}/pov/${account.id}/assets/minecraft/textures/gui/x.png`,
    { headers: { cookie: `afk_session=${USER_TOKEN}` } }
  );
  assert.equal(noPassthrough.status, 404);

  // Die Minecraft-Ressourcen: hochladen, wiederfinden, wegräumen. Der Rumpf ist die Datei.
  const uploaded = await fetch(`${base}/api/admin/resources/26.2`, {
    method: 'POST',
    headers: {
      cookie: `afk_session=${ADMIN_TOKEN}`,
      origin: base,
      'content-type': 'application/java-archive',
    },
    body: fakeClientJar(),
  });
  assert.equal(uploaded.status, 200);
  const clientState = await api(base, '/api/admin/client', { token: ADMIN_TOKEN });
  assert.equal(
    clientState.data.client.resources.find((entry) => entry.version === '26.2')?.present,
    true
  );
  const rejected = await fetch(`${base}/api/admin/resources/26.1`, {
    method: 'POST',
    headers: {
      cookie: `afk_session=${ADMIN_TOKEN}`,
      origin: base,
      'content-type': 'application/java-archive',
    },
    body: Buffer.alloc(4096, 0x41),
  });
  assert.equal(rejected.status, 400);
  const dropped = await api(base, '/api/admin/resources/26.2', {
    token: ADMIN_TOKEN,
    method: 'DELETE',
  });
  assert.equal(dropped.response.status, 200);
  // Ein Kunde hat mit alldem nichts zu tun.
  const forbiddenUpload = await api(base, '/api/admin/resources/26.2', {
    token: USER_TOKEN,
    method: 'DELETE',
  });
  assert.equal(forbiddenUpload.response.status, 403);

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
  // Kategorien für Tickets gibt es nicht mehr; die Liste hier sind Discord-Kategorien, in denen
  // der Bot keine Rechte setzen darf.
  assert.ok(Array.isArray(configResponse.data.skip_categories));
  assert.ok(configResponse.data.skip_categories.includes('1538202844744908814'));
  assert.equal(configResponse.data.max_upload, 20 * 1024 * 1024);

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
    // Ein Screenshot darf 20 MB haben. Ohne einen eigenen Block gilt die Grenze des Servers
    // (4 MB), und nginx lehnt ihn mit 413 ab, bevor das Panel ihn überhaupt sieht.
    assert.match(nginx, /location = \/api\/tickets\/files/);
    assert.match(nginx, /client_max_body_size\s+21M/);
  }

  // Ein zu kurzes Geheimnis ist keines. Hinter dem Bot-Bereich liegen der Discord-Token und
  // jedes Ticket – deshalb bleibt er zu, auch wenn der Aufrufer das kurze Wort kennt.
  setSetting('discord_bot_secret', '1234');
  const weakSecret = await api(base, '/api/bot/config', { botSecret: '1234' });
  assert.equal(weakSecret.response.status, 401);
  setSetting('discord_bot_secret', BOT_SECRET);
  const strongSecret = await api(base, '/api/bot/config', { botSecret: BOT_SECRET });
  assert.equal(strongSecret.response.status, 200);

  // ------------------------------------------------------------ Anhänge
  //
  // Hochladen, an ein Ticket hängen, wieder herunterladen – und vor allem: **nicht** an fremde
  // Anhänge kommen. Ein Anhang hängt am Ticket, nicht an der Kenntnis seiner Nummer.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const upload = async (token, name, bytes) => {
    const response = await fetch(`${base}/api/tickets/files`, {
      method: 'POST',
      headers: {
        cookie: `afk_session=${token}`,
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(name),
        origin: base,
      },
      body: bytes,
    });
    return { response, data: await response.json().catch(() => ({})) };
  };

  const shot = await upload(USER_TOKEN, 'bild schön.png', png);
  assert.equal(shot.response.status, 200);
  // Der Inhaltstyp kommt aus den Bytes, nicht aus dem, was der Browser behauptet hat.
  assert.equal(shot.data.file.mime, 'image/png');
  assert.equal(shot.data.file.image, true);

  const disguised = await upload(USER_TOKEN, 'böse.png', Buffer.from('<svg onload=alert(1)>'));
  assert.equal(disguised.response.status, 200);
  assert.equal(disguised.data.file.mime, 'application/octet-stream');
  assert.equal(disguised.data.file.image, false);

  const withFile = await api(base, '/api/tickets', {
    token: USER_TOKEN,
    method: 'POST',
    body: { subject: 'Screenshot', body: '', files: [shot.data.file.id] },
  });
  assert.equal(withFile.response.status, 200);
  const withFileMessages = await api(base, `/api/tickets/${withFile.data.ticket.id}`, {
    token: USER_TOKEN,
  });
  assert.equal(withFileMessages.data.messages.at(-1).files.length, 1);
  assert.equal(withFileMessages.data.messages.at(-1).files[0].name, 'bild schön.png');

  const download = await fetch(`${base}/api/tickets/files/${shot.data.file.id}`, {
    headers: { cookie: `afk_session=${USER_TOKEN}` },
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await download.arrayBuffer()).equals(png), true);

  // Was kein Bild ist, wird nie im Browser dargestellt – sonst wäre ein hochgeladenes SVG ein
  // Skript auf unserer Adresse.
  const risky = await fetch(`${base}/api/tickets/files/${disguised.data.file.id}`, {
    headers: { cookie: `afk_session=${USER_TOKEN}` },
  });
  assert.equal(risky.headers.get('content-type'), 'application/octet-stream');
  assert.match(risky.headers.get('content-disposition'), /^attachment;/);

  // Ein fremdes Konto kommt weder an den Anhang noch an die noch nicht abgeschickte Datei.
  const stranger = createUser({ username: 'stranger' });
  createSession(stranger, 'stranger-session');
  const stolen = await fetch(`${base}/api/tickets/files/${shot.data.file.id}`, {
    headers: { cookie: 'afk_session=stranger-session' },
  });
  assert.equal(stolen.status, 403);

  // Und eine fremde Datei lässt sich nicht in ein eigenes Ticket ziehen.
  const strangerUpload = await upload('stranger-session', 'fremd.png', png);
  const hijack = await api(base, '/api/tickets', {
    token: USER_TOKEN,
    method: 'POST',
    body: { subject: 'Fremde Datei', body: 'x', files: [strangerUpload.data.file.id] },
  });
  assert.equal(hijack.response.status, 200);
  const hijacked = await api(base, `/api/tickets/${hijack.data.ticket.id}`, { token: USER_TOKEN });
  assert.equal(hijacked.data.messages.at(-1).files.length, 0);

  // Ein Minecraft-Konto eines anderen Kontos lässt sich nicht löschen – und die Absage muss
  // kommen, **bevor** irgendetwas passiert. Vorher stoppte der Endpunkt erst alle Bots dieser
  // Kontonummer und prüfte danach, wem sie gehört: Eine geratene Zahl legte damit fremde Bots
  // still, samt ihres Startwunsches, und die 404 kam erst hinterher.
  const victimAccount = createAccount(stranger, { name: 'VictimBot' });
  const victimProfile = createProfile(stranger, billing.planBySlug('premium'));
  db.prepare(
    'INSERT INTO profile_accounts (profile_id, account_id, wanted, ordinal) VALUES (?, ?, 1, 0)'
  ).run(victimProfile.id, victimAccount.id);

  const theft = await api(base, `/api/accounts/${victimAccount.id}`, {
    token: USER_TOKEN,
    method: 'DELETE',
  });
  assert.equal(theft.response.status, 404);
  // Das Konto steht noch, und der Startwunsch des fremden Bots ebenfalls.
  assert.ok(db.prepare('SELECT 1 FROM mc_accounts WHERE id = ?').get(victimAccount.id));
  assert.equal(
    db
      .prepare('SELECT wanted FROM profile_accounts WHERE profile_id = ? AND account_id = ?')
      .get(victimProfile.id, victimAccount.id).wanted,
    1
  );

  // Was zu tun ist, kommt mit `/me` und ist genau das, was für dieses Konto offen ist.
  const suspendedProfile = createProfile(stranger, billing.planBySlug('premium'));
  db.prepare('UPDATE profiles SET suspended = 1 WHERE id = ?').run(suspendedProfile.id);
  const answered = tickets.create(stranger, { subject: 'Antwort bitte lesen', body: 'Frage' });
  tickets.reply(answered, admin, 'Hier ist die Antwort.', { staff: true });

  const mine = await api(base, '/api/me', { token: 'stranger-session' });
  assert.equal(mine.response.status, 200);
  const keys = mine.data.todos.map((entry) => entry.key);
  assert.ok(keys.includes(`profile-suspended-${suspendedProfile.id}`), 'stillgelegter Platz fehlt');
  assert.ok(keys.includes(`ticket-${answered.id}`), 'beantwortetes Ticket fehlt');
  assert.equal(mine.data.stats.todos, mine.data.todos.length);
  // Jeder Eintrag sagt, was zu tun ist und wohin es führt – sonst wäre er eine Meldung, kein To-do.
  for (const entry of mine.data.todos) {
    assert.ok(entry.title && entry.text && entry.href && entry.label, `unvollständig: ${entry.key}`);
    assert.ok(['bad', 'warn', 'info'].includes(entry.kind));
  }
  // Und nichts davon gehört jemand anderem.
  assert.ok(!mine.data.todos.some((entry) => entry.key.endsWith(`-${profile.id}`)));

  // Ein Serverplatz, den die Verwaltung gesperrt hat, lässt sich vom Kunden nicht mehr löschen –
  // sonst wäre die Sperre ein Knopf, den der Gesperrte selbst ausschalten kann (samt Gutschrift).
  db.prepare("UPDATE profiles SET locked = 1, lock_reason = 'Missbrauch' WHERE id = ?").run(
    suspendedProfile.id
  );
  const escape_ = await api(base, `/api/profiles/${suspendedProfile.id}`, {
    token: 'stranger-session',
    method: 'DELETE',
  });
  assert.equal(escape_.response.status, 403);
  assert.ok(db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(suspendedProfile.id));

  // ------------------------------------------------------------ Das eigene Konto über HTTP
  //
  // Die Prüfungen selbst stehen weiter oben als eigene Tests; hier geht es um den Weg dorthin:
  // Kommen die Felder an, kommen sie richtig zurück, und ist eine Absage eine Absage.

  const patched = await api(base, '/api/me', {
    token: 'stranger-session',
    method: 'PATCH',
    body: {
      full_name: 'Hugo Muster',
      company: 'Muster GmbH',
      street: 'Hauptstraße 1',
      postal_code: '1010',
      city: 'Wien',
      country: 'at',
      timezone: 'Europe/Vienna',
    },
  });
  assert.equal(patched.response.status, 200);
  assert.equal(patched.data.user.profile.country, 'AT');
  assert.equal(patched.data.user.profile.timezone, 'Europe/Vienna');

  const wrongCountry = await api(base, '/api/me', {
    token: 'stranger-session',
    method: 'PATCH',
    body: { country: 'XX' },
  });
  assert.equal(wrongCountry.response.status, 400);
  // Und die vorherige Angabe steht noch – eine abgelehnte Änderung ändert nichts.
  assert.equal(
    db.prepare('SELECT country FROM users WHERE id = ?').get(stranger.id).country,
    'AT'
  );

  // Der Datenexport ist eine **Datei** und keine Antwort zum Ansehen: Der Wert dieser Auskunft
  // liegt darin, sie zu haben.
  const exportResponse = await fetch(`${base}/api/me/export`, {
    headers: { cookie: 'afk_session=stranger-session' },
  });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-disposition') || '', /attachment; filename="afksystems-/);
  const myData = JSON.parse(await exportResponse.text());
  assert.equal(myData.account.id, stranger.id);
  assert.equal(myData.account.city, 'Wien');
  assert.deepEqual(myData.included, [
    'profile',
    'minecraft',
    'servers',
    'automation',
    'billing',
    'support',
    'activity',
    'security',
  ]);

  // Ein Download muss nicht jedes Detail enthalten. Die Auswahl begrenzt die Abfragen auf die
  // angeforderten Bereiche; ein fremder Bereich ist keine stillschweigende leere Antwort.
  const partialExport = await fetch(`${base}/api/me/export?parts=profile,billing`, {
    headers: { cookie: 'afk_session=stranger-session' },
  });
  assert.equal(partialExport.status, 200);
  const selectedData = JSON.parse(await partialExport.text());
  assert.deepEqual(selectedData.included, ['profile', 'billing']);
  assert.equal(selectedData.account.id, stranger.id);
  assert.ok(Array.isArray(selectedData.ledger));
  assert.equal(selectedData.minecraft_accounts, undefined);
  const invalidExport = await fetch(`${base}/api/me/export?parts=profile,not-a-category`, {
    headers: { cookie: 'afk_session=stranger-session' },
  });
  assert.equal(invalidExport.status, 400);

  // Ein gesunder Serverplatz mit einem Konto darauf – daran lässt sich zeigen, dass die
  // angemeldete Löschung den Start verhindert und nicht irgendetwas anderes.
  const leavingProfile = createProfile(stranger, billing.planBySlug('premium'));
  const leavingAccount = createAccount(stranger, { name: 'AbschiedsBot' });
  db.prepare('INSERT INTO profile_accounts (profile_id, account_id, wanted) VALUES (?, ?, 0)').run(
    leavingProfile.id,
    leavingAccount.id
  );

  // Eine Löschung ohne Passwort ist keine Löschung.
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword('passwort123'), stranger.id);
  const noPassword = await api(base, '/api/me/delete', {
    token: 'stranger-session',
    method: 'POST',
    body: { password: 'falsch' },
  });
  assert.equal(noPassword.response.status, 400);
  const scheduled = await api(base, '/api/me/delete', {
    token: 'stranger-session',
    method: 'POST',
    body: { password: 'passwort123' },
  });
  assert.equal(scheduled.response.status, 200);
  assert.ok(scheduled.data.deletion.due_at > Date.now());
  // Ein Konto, das gelöscht werden soll, startet keine Bots mehr – auch nicht über den Knopf.
  // Geprüft wird am **Grund** und nicht am Fehlschlag: Ohne Client scheitert hier ohnehin jeder
  // Start, und dann bewiese ein bloßes "hat nicht geklappt" gar nichts.
  const blockedStart = await api(base, `/api/profiles/${leavingProfile.id}/start`, {
    token: 'stranger-session',
    method: 'POST',
    body: {},
  });
  assert.equal(blockedStart.response.status, 200);
  assert.ok(
    blockedStart.data.results.every((entry) => !entry.ok && /deletion|Löschung/.test(entry.error)),
    'der Grund muss die angemeldete Löschung sein'
  );
  const cancelled = await api(base, '/api/me/delete', { token: 'stranger-session', method: 'DELETE' });
  assert.equal(cancelled.response.status, 200);
  assert.equal(db.prepare('SELECT delete_due_at FROM users WHERE id = ?').get(stranger.id).delete_due_at, null);

  // Sitzungen: eine Liste ohne Token, und eine fremde Sitzung lässt sich nicht abmelden.
  const sessions = await api(base, '/api/me/sessions', { token: 'stranger-session' });
  assert.equal(sessions.response.status, 200);
  assert.ok(sessions.data.sessions.every((entry) => !('token' in entry) && entry.ref));
  const notMine = await api(base, '/api/me/sessions/deadbeefdeadbeef', {
    token: 'stranger-session',
    method: 'DELETE',
  });
  assert.equal(notMine.response.status, 404);

  // Der Beleg: ein Dokument, das nur seinem Konto gehört.
  const bought = billing.createTopup({
    userId: stranger.id,
    amountCent: 500,
    credits: 500,
    provider: 'transfer',
  });
  billing.settleTopup(bought.id, 'Test');
  const page = await fetch(`${base}/api/billing/receipts/${bought.id}`, {
    headers: { cookie: 'afk_session=stranger-session' },
  });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
  assert.equal(page.headers.get('content-disposition'), null);
  // Persönlich heißt: in keinem gemeinsamen Zwischenspeicher.
  assert.match(page.headers.get('cache-control') || '', /private|no-store/);
  const receiptPage = await page.text();
  assert.match(receiptPage, /Hugo Muster/);
  const downloadedReceipt = await fetch(`${base}/api/billing/receipts/${bought.id}?download=1`, {
    headers: { cookie: 'afk_session=stranger-session' },
  });
  assert.equal(downloadedReceipt.status, 200);
  assert.match(downloadedReceipt.headers.get('content-disposition') || '', /^attachment; filename\*=UTF-8''/);
  const foreign = await fetch(`${base}/api/billing/receipts/${bought.id}`, {
    headers: { cookie: `afk_session=${USER_TOKEN}` },
  });
  assert.equal(foreign.status, 404);

  // Zeitpläne: anlegen, ändern, löschen – und nur am eigenen Serverplatz. Eigener Platz, weil
  // die Prüfungen oben `profile` inzwischen gesperrt haben und ein gesperrter Platz sich zu Recht
  // nicht mehr ändern lässt.
  const planned = createProfile(user, billing.planBySlug('premium'), { name: 'Zeitplan-Platz' });
  const madeSchedule = await api(base, `/api/profiles/${planned.id}/schedules`, {
    token: USER_TOKEN,
    method: 'POST',
    body: { action: 'start', minutes: 18 * 60, days: '1,2,3,4,5' },
  });
  assert.equal(madeSchedule.response.status, 200);
  assert.deepEqual(madeSchedule.data.schedule.days, [1, 2, 3, 4, 5]);
  const scheduleList = await api(base, `/api/profiles/${planned.id}/schedules`, { token: USER_TOKEN });
  assert.equal(scheduleList.data.schedules.length, 1);
  assert.ok(scheduleList.data.timezone, 'ohne Zeitzone ist eine Uhrzeit eine Behauptung');
  const foreignSchedule = await api(base, `/api/profiles/${planned.id}/schedules`, {
    token: 'stranger-session',
    method: 'POST',
    body: { action: 'stop', minutes: 60, days: '1' },
  });
  assert.equal(foreignSchedule.response.status, 404);
  // Kopieren: derselbe Aufbau noch einmal, ohne die Konten – und bezahlt wie jeder neue Platz.
  await api(base, `/api/profiles/${planned.id}`, {
    token: USER_TOKEN,
    method: 'PATCH',
    body: { note: 'Zeile eins\nZeile zwei', join_delay: 11 },
  });
  await api(base, `/api/profiles/${planned.id}/macros`, {
    token: USER_TOKEN,
    method: 'POST',
    body: { name: 'Beim Beitritt', event: 'join', actions: [{ type: 'chat', text: '/afk' }] },
  });
  await api(base, `/api/profiles/${planned.id}/spam`, {
    token: USER_TOKEN,
    method: 'POST',
    body: { message: '/afk', interval_sec: 300 },
  });
  const copyPreview = await api(base, `/api/profiles/${planned.id}/copy-preview`, { token: USER_TOKEN });
  assert.equal(copyPreview.response.status, 200);
  assert.deepEqual(copyPreview.data.sections, { settings: 15, macros: 1, spam: 1, schedules: 1 });
  // Genug Guthaben für einen zweiten bezahlten Platz – die Kopie ist einer und kostet auch so viel.
  const copyPlan = billing.planBySlug('premium');
  billing.grant(user.id, copyPlan.price_credits * 2, 'bonus', 'Guthaben für den Kopiertest');
  const billingForecast = await api(base, '/api/billing', { token: USER_TOKEN });
  assert.equal(billingForecast.response.status, 200);
  const plannedForecast = billingForecast.data.slots.find((slot) => slot.id === planned.id).forecast;
  assert.equal(plannedForecast.cost_credits, copyPlan.price_credits);
  assert.equal(plannedForecast.covered, true);
  assert.equal(billingForecast.data.runway.next.id, planned.id);
  assert.equal(billingForecast.data.runway.renewal_count, 1);
  assert.equal(billingForecast.data.runway.covered_count, 1);
  assert.equal(billingForecast.data.runway.first_uncovered, null);
  // Ein Tarifwechsel ist nie nur ein neuer Preis: Die Vorschau zeigt die Restgutschrift, die
  // neue Periode und den künftigen Monat getrennt – und bucht beim bloßen Ansehen nichts.
  const richerPlan = billing.planBySlug('ultra');
  const planPreview = await api(base, `/api/profiles/${planned.id}/plan-preview?plan_id=${richerPlan.id}`, {
    token: USER_TOKEN,
  });
  assert.equal(planPreview.response.status, 200);
  assert.equal(planPreview.data.current.id, copyPlan.id);
  assert.equal(planPreview.data.target.id, richerPlan.id);
  assert.equal(planPreview.data.charge, richerPlan.price_credits);
  assert.equal(planPreview.data.monthly_after, richerPlan.price_credits);
  assert.ok(planPreview.data.refund >= 0);
  assert.equal(
    planPreview.data.balance_after,
    planPreview.data.balance_before + planPreview.data.refund - planPreview.data.charge
  );
  const unavailableFree = await api(base, `/api/profiles/${planned.id}/plan-preview?plan_id=${billing.freePlan().id}`, {
    token: USER_TOKEN,
  });
  assert.equal(unavailableFree.response.status, 200);
  assert.equal(unavailableFree.data.available, false, 'der schon belegte Gratisplatz wird nicht schön gerechnet');

  // Auch ein Zusatzdialog rechnet vom Server: die anteilige Zahlung jetzt und der Monatsbetrag
  // danach sind zwei verschiedene Zahlen. Eine Vorschau darf dabei keine Zusatzzeile anlegen.
  const addonForPreview = billing.addons().find((entry) => entry.available && entry.active && entry.max_qty > 0);
  const addonPreview = await api(
    base,
    `/api/profiles/${planned.id}/addons/${addonForPreview.id}/preview?action=add&qty=1`,
    { token: USER_TOKEN }
  );
  assert.equal(addonPreview.response.status, 200);
  assert.equal(addonPreview.data.preview.qty_before, 0);
  assert.equal(addonPreview.data.preview.qty_after, 1);
  assert.equal(
    addonPreview.data.preview.monthly_after,
    addonPreview.data.preview.monthly_before + addonForPreview.price_credits
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profile_addons WHERE profile_id = ?').get(planned.id).n, 0);
  const beforeCopy = db.prepare('SELECT credits FROM users WHERE id = ?').get(user.id).credits;
  const copied = await api(base, `/api/profiles/${planned.id}/copy`, {
    token: USER_TOKEN,
    method: 'POST',
    body: { name: 'Zeitplan-Platz Kopie', address: 'zweiter.example.test', plan_id: copyPlan.id },
  });
  assert.equal(copied.response.status, 200);
  // Der Zeitplan von oben ist gelöscht, Makro und Spam nicht – genau das muss dastehen.
  assert.deepEqual(copied.data.copied, { macros: 1, spam: 1, schedules: 1 });
  assert.equal(copied.data.profile.note, 'Zeile eins\nZeile zwei');
  assert.equal(copied.data.profile.join_delay, 11);
  assert.equal(copied.data.profile.host, 'zweiter.example.test');
  // **Ohne Konten.** Ein Minecraft-Konto kann nur in einem Spiel gleichzeitig sein; kopiert stünde
  // es auf zwei Plätzen, und der zweite Start würde abgewiesen.
  assert.equal(copied.data.profile.accounts.length, 0);
  // Eine Kopie ist ein Serverplatz und kostet wie einer.
  assert.equal(
    db.prepare('SELECT credits FROM users WHERE id = ?').get(user.id).credits,
    beforeCopy - copyPlan.price_credits
  );
  // Und die Kopie hat wirklich eigene Zeilen – nicht dieselben noch einmal verlinkt.
  const copiedMacros = db.prepare('SELECT * FROM macros WHERE profile_id = ?').all(copied.data.profile.id);
  assert.equal(copiedMacros.length, 1);
  assert.equal(copiedMacros[0].name, 'Beim Beitritt');
  // Die Kontobindung geht dabei verloren: Ein Makro für ein Konto, das hier nicht sitzt, zeigte
  // ins Leere.
  assert.equal(copiedMacros[0].accounts, '[]');
  // Die Auswahl ist eine echte Kopiergrenze, nicht nur ein Hinweis im Dialog. Eine frische
  // Grundkonfiguration darf weder Automationen noch persönliche Einstellungen mitnehmen.
  const selectiveCopy = await api(base, `/api/profiles/${planned.id}/copy`, {
    token: USER_TOKEN,
    method: 'POST',
    body: {
      name: 'Leere Zeitplan-Kopie',
      address: 'leer.example.test',
      plan_id: copyPlan.id,
      copy: { settings: false, macros: false, spam: false, schedules: false },
    },
  });
  assert.equal(selectiveCopy.response.status, 200);
  assert.deepEqual(selectiveCopy.data.copied, { macros: 0, spam: 0, schedules: 0 });
  assert.equal(selectiveCopy.data.profile.note, '');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM macros WHERE profile_id = ?').get(selectiveCopy.data.profile.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM spam WHERE profile_id = ?').get(selectiveCopy.data.profile.id).n, 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM profile_schedules WHERE profile_id = ?').get(selectiveCopy.data.profile.id).n,
    0
  );
  const forecastAfterCopies = await api(base, '/api/billing', { token: USER_TOKEN });
  const uncovered = forecastAfterCopies.data.slots.find((slot) => slot.id === planned.id).forecast;
  assert.equal(uncovered.covered, false);
  assert.equal(uncovered.shortfall_credits, copyPlan.price_credits);
  assert.equal(forecastAfterCopies.data.runway.first_uncovered.id, planned.id);
  assert.equal(forecastAfterCopies.data.runway.first_uncovered.shortfall_credits, copyPlan.price_credits);
  const malformedCopySelection = await api(base, `/api/profiles/${planned.id}/copy`, {
    token: USER_TOKEN,
    method: 'POST',
    body: { name: 'Kaputte Kopie', copy: [] },
  });
  assert.equal(malformedCopySelection.response.status, 400);
  // Ein fremder Platz lässt sich nicht kopieren.
  const foreignCopy = await api(base, `/api/profiles/${planned.id}/copy`, {
    token: 'stranger-session',
    method: 'POST',
    body: { name: 'Geklaut', address: 'x.example.test' },
  });
  assert.equal(foreignCopy.response.status, 404);

  const goneSchedule = await api(
    base,
    `/api/profiles/${planned.id}/schedules/${madeSchedule.data.schedule.id}`,
    { token: USER_TOKEN, method: 'DELETE' }
  );
  assert.equal(goneSchedule.response.status, 200);

  // Der Systembericht steht der Verwaltung offen und sonst niemandem.
  const report = await api(base, '/api/admin/system/report', { token: ADMIN_TOKEN });
  assert.equal(report.response.status, 200);
  const operations = await api(base, '/api/admin/operations', { token: ADMIN_TOKEN });
  assert.equal(operations.response.status, 200);
  assert.ok(Array.isArray(operations.data.alerts));
  assert.equal(typeof operations.data.proxy.total, 'number');
  const rolloutPreview = await api(base, '/api/admin/client/rollout-preview', { token: ADMIN_TOKEN });
  assert.equal(rolloutPreview.response.status, 200);
  assert.equal(rolloutPreview.data.spacing_ms, 5000);
  assert.ok(Array.isArray(rolloutPreview.data.bots));
  assert.equal(report.data.webhook, false);
  assert.ok(Array.isArray(report.data.alerts));
  const notStaff = await api(base, '/api/admin/system/report', { token: USER_TOKEN });
  assert.equal(notStaff.response.status, 403);
  // Ohne hinterlegten Webhook gibt es nichts zu schicken, und das sagt die Absage auch.
  const noHook = await api(base, '/api/admin/system/report', { token: ADMIN_TOKEN, method: 'POST' });
  assert.equal(noHook.response.status, 400);

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
