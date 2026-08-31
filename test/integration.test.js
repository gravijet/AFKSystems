import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
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
const stripe = await import('../server/stripe.js');
const vat = await import('../server/vat.js');
const roles = await import('../server/roles.js');
const oauth = await import('../server/oauth.js');
const binaries = await import('../server/binaries.js');
const resources = await import('../server/resources.js');
const tickets = await import('../server/tickets.js');
const { Tickets } = await import('../bot/handlers/tickets.js');
const { Bot, simpleChatMacro, parseEvent, parseView, ansiToMinecraft, POV_SIZE, POV_FPS } =
  await import('../server/supervisor.js');
const notify = await import('../server/notify.js');
const { staffTodos } = await import('../server/todos.js');
const { parseFormatting } = await import('../public/assets/js/chatlog.js');
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
  // Und nur der eigene: Der Verlauf eines fremden Serverplatzes ist niemandes Sache.
  const foreignExport = await fetch(`${base}/api/profiles/${profile.id}/chat.txt`, {
    headers: { cookie: `afk_session=${ADMIN_TOKEN}` },
  });
  assert.equal(foreignExport.status, 404);

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
