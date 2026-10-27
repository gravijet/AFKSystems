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
