import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import express from 'express';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-multi-'));
process.env.DATA_DIR = root;
process.env.NODE_ENV = 'test';
const { db } = await import('../server/db.js');
const { config } = await import('../server/config.js');
const { Bot, supervisor } = await import('../server/supervisor.js');
const { router } = await import('../server/routes/profiles.js');
const { macros } = await import('../server/macros.js');
const billing = await import('../server/billing.js');
const binaries = await import('../server/binaries.js');
after(() => { supervisor.shutdown(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
let serial = 0;
function fixture(t, count = 4) {
  const n = ++serial, now = Date.now();
  const uid = db.prepare("INSERT INTO users(email,username,password_hash,email_verified,created_at) VALUES(?,?,'test',1,?)")
    .run(`multi${n}@example.test`, `multi${n}`, now).lastInsertRowid;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const plan = billing.planBySlug('ultra');
  db.prepare('UPDATE plans SET max_accounts=10 WHERE id=?').run(plan.id);
  const pid = db.prepare(`INSERT INTO profiles(user_id,name,slug,host,mc_version,plan_id,paid_until,created_at)
    VALUES(?,'Multi',?,'multi.example.test','26.1',?,?,?)`).run(uid, `multi${n}`, plan.id, now + 86400000, now).lastInsertRowid;
  const profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(pid);
  const bots = [];
  for (let i = 0; i < count; i++) {
    const aid = db.prepare("INSERT INTO mc_accounts(user_id,name,kind,status,created_at) VALUES(?,?,'offline','ok',?)")
      .run(uid, `Player${n}_${i}`, now).lastInsertRowid;
    db.prepare('INSERT INTO profile_accounts(profile_id,account_id) VALUES(?,?)').run(pid, aid);
    const account = db.prepare('SELECT * FROM mc_accounts WHERE id=?').get(aid);
    const bot = new Bot(supervisor, { profile, user, account, plan: billing.featuresOf(profile) });
    supervisor.bots.set(bot.key, bot);
    bots.push(bot);
  }
  t.after(() => {
    for (const bot of bots) {
      clearTimeout(bot.pendingStart);
      bot.pendingStart = null;
      bot.proc?.stdin.destroy?.();
      bot.proc = null;
      macros.detach(bot);
      supervisor.cancelRestart(bot.key);
      supervisor.bots.delete(bot.key);
    }
  });
  return { user, profile, bots };
}

test('chat API waits for each client write and isolates asynchronous failures between four accounts', async t => {
  const { user, profile, bots } = fixture(t);
  const writes = [], callbacks = [];
  bots.forEach((bot, i) => {
    const input = new Writable({ write(chunk, _encoding, callback) { writes.push([i, String(chunk)]); callbacks[i] = callback; } });
    input.on('error', () => {});
    bot.proc = { stdin: input };
    bot.state = 'online';
  });
  const app = express();
  app.use(express.json(), (req, _res, next) => { req.user = user; next(); }, router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  let complete = false;
  const request = fetch(`http://127.0.0.1:${server.address().port}/${profile.id}/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '/afk', accounts: bots.map(b => b.account.id) }),
  }).then(response => response.json()).then(result => { complete = true; return result; });
  while (writes.length < 4) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(complete, false, 'writing into a pipe must not report delivery before its callback');
  assert.ok(bots.every(bot => !bot.chat.some(row => row.type === 'sent')));
  callbacks[1](Object.assign(new Error('broken pipe'), { code: 'EPIPE' }));
  callbacks[2](); callbacks[0](); callbacks[3]();
  const result = await request;
  assert.deepEqual(result.results.map(row => row.ok), [true, false, true, true]);
  assert.match(result.results[1].error, /broken pipe/);
  assert.deepEqual(bots.map(bot => bot.chat.filter(row => row.type === 'sent').map(row => row.text)),
    [['/afk'], [], ['/afk'], ['/afk']]);
  assert.ok(writes.every(([, text]) => text === '/afk\n'));
});

test('stopping, closed and destroyed client pipes reject commands without a sent record', async t => {
  const { bots } = fixture(t, 1), bot = bots[0];
  const input = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  input.on('error', () => {});
  bot.proc = { stdin: input };
  bot.stopping = true;
  assert.throws(() => bot.send('/afk', { confirm: true }), /läuft gerade nicht/);
  bot.stopping = false;
  input.destroy();
  assert.throws(() => bot.send('/afk', { confirm: true }), /läuft gerade nicht/);
  assert.equal(bot.chat.length, 0);
});

test('login reservations span server slots but keep other destinations independent', t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const previous = config.joinSpacingMs;
  config.joinSpacingMs = 3000;
  supervisor.joins.clear();
  t.after(() => { config.joinSpacingMs = previous; supervisor.joins.clear(); });
  assert.equal(supervisor.joinDelay({ host: 'Same.Example.test.' }), 0);
  assert.equal(supervisor.joinDelay({ host: 'same.example.test', port: 25565 }), 3000);
  assert.equal(supervisor.joinDelay({ host: 'same.example.test' }), 6000);
  assert.equal(supervisor.joinDelay({ host: 'other.example.test' }), 0);
  t.mock.timers.tick(1000);
  assert.equal(supervisor.joinDelay({ host: 'same.example.test' }), 8000);
});

test('queued starts consume capacity, refresh account eligibility and can be cancelled', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { profile, bots } = fixture(t, 2), bot = bots[0];
  const saved = binaries.state.builds;
  binaries.state.builds = { slim: { present: true, caps: {} } };
  t.after(() => { binaries.state.builds = saved; });
  t.mock.method(supervisor, 'joinDelay', () => 3000);
  t.mock.method(supervisor, 'runtimeNode', () => ({ id: 1, kind: 'local' }));
  t.mock.method(supervisor, 'planRestart', () => false);
  let refreshed = 0;
  t.mock.method(supervisor, 'context', () => { refreshed++; return null; });
  bot.start();
  assert.equal(bot.running, true);
  assert.equal(bot.proc, null);
  assert.equal(supervisor.runningOnProfile(profile.id), 1);
  bot.start();
  bot.stop();
  t.mock.timers.tick(3000);
  assert.equal(bot.running, false);
  assert.equal(refreshed, 0, 'stop must cancel the pending spawn');
  // A changed account is rechecked when the slot opens, before any process starts.
  const next = bots[1];
  db.prepare('UPDATE profile_accounts SET wanted=1 WHERE profile_id=? AND account_id=?').run(profile.id, next.account.id);
  t.mock.method(supervisor, 'context', () => {
    refreshed++;
    return { profile, account: { ...next.account, suspended: 1 }, user: db.prepare('SELECT * FROM users WHERE id=?').get(next.userId) };
  });
  next.start();
  t.mock.timers.tick(3000);
  assert.equal(refreshed, 1);
  assert.equal(next.proc, null);
  assert.equal(next.state, 'error');
  assert.match(next.lastError, /stillgelegt/);
});

const settle = () => new Promise(resolve => setImmediate(resolve));
function addMacro(profile, name, event, actions, extra = {}) {
  return db.prepare(`INSERT INTO macros(profile_id,name,event,actions,config,accounts,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(profile.id, name, event, JSON.stringify(actions),
      JSON.stringify(extra.config || {}), JSON.stringify(extra.accounts || []), Date.now()).lastInsertRowid;
}
function onlineWrites(bots, output) {
  for (const bot of bots) {
    bot.state = 'online';
    bot.proc = { stdin: new Writable({ write(chunk, _encoding, callback) {
      output.push([bot.account.id, String(chunk).trim()]); callback();
    } }) };
  }
}

test('four accounts finish join macros in order; slow initialization only delays its own timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { profile, bots } = fixture(t), writes = [];
  onlineWrites(bots, writes);
  for (const bot of bots) bot.profile = { ...profile, join_delay: 1 };
  addMacro(profile, 'Login', 'join', [
    { type: 'chat', text: '/login {player}' }, { type: 'wait', seconds: 2 },
    { type: 'chat', text: '/server target' },
  ], { accounts: [bots[0].account.id] });
  addMacro(profile, 'AFK', 'join', [{ type: 'chat', text: '/afk {player}' }]);
  for (const bot of bots) macros.onJoin(bot);
  assert.deepEqual(writes, []);
  t.mock.timers.tick(1000); await settle();
  assert.deepEqual(writes.filter(([id]) => id === bots[0].account.id).map(([,line]) => line), [`/login ${bots[0].account.name}`]);
  assert.equal(writes.filter(([,line]) => line.startsWith('/afk')).length, 3);
  const timer = { id: 99901, name: 'Timer', actions: '[{"type":"chat","text":"/timer"}]' };
  const timerRuns = bots.map(bot => macros.run(bot, timer));
  await settle();
  assert.equal(writes.filter(([,line]) => line === '/timer').length, 3);
  t.mock.timers.tick(2000); await Promise.all(timerRuns);
  assert.deepEqual(writes.filter(([id]) => id === bots[0].account.id).map(([,line]) => line),
    [`/login ${bots[0].account.name}`, '/server target', `/afk ${bots[0].account.name}`, '/timer']);
});

test('join edits during startup use current text and account selection without frozen client rules', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { profile, bots } = fixture(t), writes = [];
  onlineWrites(bots, writes);
  for (const bot of bots) bot.profile = { ...profile, join_delay: 2 };
  const id = addMacro(profile, 'Join', 'join', [{ type: 'chat', text: '/old' }]);
  for (const bot of bots) macros.onJoin(bot);
  db.prepare('UPDATE macros SET actions=?,accounts=? WHERE id=?').run(
    '[{"type":"chat","text":"/new"}]', JSON.stringify(bots.slice(1).map(bot => bot.account.id)), id);
  macros.reload(profile.id);
  t.mock.timers.tick(2000); await settle();
  assert.deepEqual(writes.map(([id,line]) => [id,line]), bots.slice(1).map(bot => [bot.account.id, '/new']));
  assert.ok(bots.every(bot => !bot.args({ offline: true }).includes('--cmd')));
  db.prepare('UPDATE macros SET enabled=0 WHERE id=?').run(id);
  for (const bot of bots) macros.onJoin(bot, { again: true });
  t.mock.timers.tick(2000); await settle();
  assert.equal(writes.length, 3);
});

test('a stop macro cancels sleeping and queued actions immediately; another account continues', async t => {
  const { bots } = fixture(t, 2), writes = [];
  onlineWrites(bots, writes);
  const slow = { id: 99902, name: 'Slow', actions: '[{"type":"wait","seconds":3600},{"type":"chat","text":"/old"}]' };
  const next = { id: 99903, name: 'Next', actions: '[{"type":"chat","text":"/next"}]' };
  const old = macros.run(bots[0], slow);
  const queued = macros.run(bots[0], next);
  await macros.run(bots[1], next);
  await macros.run(bots[0], { id: 99906, name: 'Stop', actions: '[{"type":"stop_macros"}]' });
  await Promise.all([old, queued]);
  await macros.run(bots[0], { ...next, actions: '[{"type":"chat","text":"/new-session"}]' });
  assert.deepEqual(writes, [[bots[1].account.id, '/next'], [bots[0].account.id, '/new-session']]);
});

test('a failed asynchronous local action stops its macro before the following server command', async t => {
  const { bots } = fixture(t, 1), bot = bots[0], writes = [];
  onlineWrites(bots, writes);
  bot.local = async (_verb, _arg, _need, options) => {
    assert.equal(options.confirm, true);
    throw new Error('remote stdin closed');
  };
  await macros.run(bot, { id: 99904, name: 'Move', actions: '[{"type":"move","blocks":1},{"type":"chat","text":"/wrong-place"}]' });
  assert.deepEqual(writes, []);
  assert.ok(bot.chat.some(line => line.type === 'error' && /remote stdin closed/.test(line.text)));
});

test('editing during a started join macro cannot replay an already issued action', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { profile, bots } = fixture(t, 1), writes = [], bot = bots[0];
  onlineWrites(bots, writes);
  bot.profile = { ...profile, join_delay: 0 };
  addMacro(profile, 'Once', 'join', [
    { type: 'chat', text: '/once' }, { type: 'wait', seconds: 10 },
    { type: 'chat', text: '/old-followup' },
  ]);
  const id = addMacro(profile, 'Next', 'join', [{ type: 'chat', text: '/old-next' }]);
  macros.onJoin(bot); await settle();
  db.prepare('UPDATE macros SET actions=? WHERE id=?').run('[{"type":"chat","text":"/new-next"}]', id);
  macros.reload(profile.id); await settle();
  t.mock.timers.tick(10000); await settle();
  assert.deepEqual(writes.map(([,line]) => line), ['/once', '/new-next']);
});

test('intentional TCP transfer keeps the current macro generation and skips initial join commands', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { profile, bots } = fixture(t, 1), writes = [], bot = bots[0];
  onlineWrites(bots, writes);
  bot.profile = { ...profile, join_delay: 0 };
  addMacro(profile, 'Login', 'join', [
    { type: 'chat', text: '/server target' }, { type: 'wait', seconds: 2 },
    { type: 'chat', text: '/afk' },
  ]);
  macros.onJoin(bot); await settle();
  const generation = macros.slot(bot).generation;
  bot.onEvent('@event transfer host=target.example.test port=25565');
  bot.onEvent('@event connecting host=target.example.test port=25565');
  bot.onEvent(`@event join name=${bot.account.name}`);
  assert.equal(macros.slot(bot).generation, generation);
  t.mock.timers.tick(2000); await settle();
  assert.deepEqual(writes.map(([,line]) => line), ['/server target', '/afk']);
  assert.equal(bot.state, 'online');
  assert.equal(bot.transferring, false);
});

test('a real disconnect cancels old waits before running disconnect actions', async t => {
  const { profile, bots } = fixture(t, 1), writes = [], bot = bots[0];
  onlineWrites(bots, writes);
  addMacro(profile, 'Lost', 'disconnect', [{ type: 'chat', text: '/disconnect-action' }]);
  const old = macros.run(bot, { id: 99905, name: 'Old', actions: '[{"type":"wait","seconds":3600},{"type":"chat","text":"/stale"}]' });
  macros.onDisconnect(bot);
  await old; await settle();
  assert.deepEqual(writes.map(([,line]) => line), ['/disconnect-action']);
});

test('a join macro that cancels macros also cancels the remaining initializers for that account', async t => {
  const { profile, bots } = fixture(t, 2), writes = [];
  onlineWrites(bots, writes);
  for (const bot of bots) bot.profile = { ...profile, join_delay: 0 };
  addMacro(profile, 'Cancel', 'join', [{ type: 'stop_macros' }], { accounts: [bots[0].account.id] });
  addMacro(profile, 'Later', 'join', [{ type: 'chat', text: '/later' }]);
  for (const bot of bots) macros.onJoin(bot);
  await settle();
  assert.deepEqual(writes, [[bots[1].account.id, '/later']]);
});
