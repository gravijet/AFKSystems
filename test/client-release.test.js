import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-release-test-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.SECRET = 'test-only';
const binaries = await import('../server/binaries.js');
const { paths } = await import('../server/config.js');
const { db } = await import('../server/db.js');
const billing = await import('../server/billing.js');
const { Bot, supervisor } = await import('../server/supervisor.js');
const { router } = await import('../server/routes/profiles.js');
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const hash = content => `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
const executable = Buffer.from('#!/bin/sh\nprintf "AFKSystems 2.8.0\\n--pov-web <port>\\n--pov-resources <jar|auto|aus>\\nProtokoll: 1.8.9 | 26.1 (Standard: 26.1)\\n"\n');

function release(t, { body = executable, size = executable.length, digest = hash(executable), name = 'items-web-afk-linux' } = {}) {
  const original = globalThis.fetch;
  let downloads = 0, requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.ok(options.signal, 'every GitHub operation has a deadline');
    if (String(url).includes('/releases/')) return Response.json({ tag_name: 'latest', published_at: '2026-09-15', assets: [
      { name, size, digest, updated_at: '2026-09-15', url: 'https://example.test/asset' },
    ] });
    downloads++;
    return new Response(body);
  };
  t.after(() => { globalThis.fetch = original; });
  return { downloads: () => downloads, requests: () => requests };
}

test('2.8 browser-menu build is detected without pretending to have a camera', async t => {
  release(t);
  await binaries.sync({ force: true });
  const build = binaries.state.builds.itemsWeb;
  assert.equal(build.present, true);
  assert.equal(build.version, '2.8.0');
  assert.equal(build.caps.webmenu, true);
  assert.equal(build.caps.povweb, true);
  assert.equal(build.caps.povresourcesauto, true);
  assert.equal(Boolean(build.caps.pov), false);
  assert.equal(build.caps.povsize, false);
  assert.equal(binaries.anyCommand().build, 'itemsWeb');
});

for (const body of [Buffer.from('short'), Buffer.alloc(executable.length, 32)]) test(`invalid GitHub download (${body.length} bytes) preserves the last usable client`, async t => {
  const file = path.join(paths.bin, 'items-web-afk-linux');
    const old = fs.readFileSync(file);
    release(t, { body });
    await binaries.sync({ force: true });
    assert.deepEqual(fs.readFileSync(file), old);
    assert.match(binaries.state.error, /Nicht geladen/);
    assert.equal(binaries.state.builds.itemsWeb.present, true);
    assert.equal(fs.readdirSync(paths.bin).some(name => name.endsWith('.neu')), false);
});

test('client sync repairs local damage despite an unchanged release timestamp', async t => {
  const file = path.join(paths.bin, 'items-web-afk-linux');
  const mock = release(t);
  for (const corrupt of [Buffer.from('short'), Buffer.alloc(executable.length, 32)]) {
    fs.writeFileSync(file, corrupt);
    await binaries.sync();
    assert.deepEqual(fs.readFileSync(file), executable);
  }
  assert.equal(mock.downloads(), 2);
  await binaries.sync();
  assert.equal(mock.downloads(), 2, 'intact files are not downloaded again');
});

test('overlapping automatic and manual syncs share one download', async t => {
  const mock = release(t);
  const first = binaries.sync({ force: true });
  const second = binaries.sync({ force: true });
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(mock.downloads(), 1);
});

test('release paths cannot escape the binary directory', async t => {
  const mock = release(t, { name: '../outside' });
  await binaries.sync({ force: true });
  assert.equal(mock.downloads(), 0);
  assert.equal(fs.existsSync(path.join(dir, 'outside')), false);
  assert.match(binaries.state.error, /Ungültiger Release-Dateiname/);
});

function fixture() {
  const userId = db.prepare("INSERT INTO users(email,username,password_hash,email_verified,created_at) VALUES('menu@example.test','menu','test',1,?)").run(Date.now()).lastInsertRowid;
  const planId = db.prepare("INSERT INTO plans(slug,name_de,name_en,menus,offline_accounts) VALUES('menu-only','Menü','Menu',1,1)").run().lastInsertRowid;
  const profileId = db.prepare("INSERT INTO profiles(user_id,name,slug,host,plan_id,paid_until,created_at) VALUES(?,'Menu','menu','example.test',?,?,?)").run(userId, planId, Date.now()+86400000, Date.now()).lastInsertRowid;
  const accountId = db.prepare("INSERT INTO mc_accounts(user_id,name,kind,created_at) VALUES(?,'Player','offline',?)").run(userId, Date.now()).lastInsertRowid;
  db.prepare('INSERT INTO profile_accounts(profile_id,account_id) VALUES(?,?)').run(profileId, accountId);
  return { user: db.prepare('SELECT * FROM users WHERE id=?').get(userId), profile: db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId), account: db.prepare('SELECT * FROM mc_accounts WHERE id=?').get(accountId) };
}

test('menu-only plans start the viewer and can use its API without buying the camera', async t => {
  const { user, profile, account } = fixture();
  const plan = billing.featuresOf(profile);
  assert.equal(Boolean(plan.pov), false);
  const bot = new Bot({ emit() {}, joinCommands: () => [], clientMacros: () => [] }, { user, profile, account, plan });
  bot.build = 'itemsWeb';
  assert.equal(bot.wantsWebView(bot.caps), true);
  bot.webPort = 42101;
  const args = bot.args(bot.caps);
  assert.ok(args.includes('--pov-web'));
  for (const option of ['--pov', '--pov-size', '--pov-fps']) assert.equal(args.includes(option), false);
  assert.equal(bot.wantsWebView(billing.gateCaps(binaries.caps('itemsWeb'), {})), false);
  bot.web = { port: 42101, token: 'never-return-this' };
  let requests = [];
  bot.webFetch = async (target, options) => { requests.push({ target, options }); return { status: 200, type: 'application/json', body: Buffer.from('{}') }; };
  await bot.captureSnapshot();
  assert.equal(requests.length, 0, 'menu-only clients never request camera snapshots');
  bot.proc = { stdin: { writable: true } };
  const oldGet = supervisor.get;
  supervisor.get = (p, a) => p === profile.id && a === account.id ? bot : null;
  t.after(() => { supervisor.get = oldGet; });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/profiles', router);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/profiles/${profile.id}/pov/${account.id}`;
  for (const suffix of ['state.json', 'item.png?id=1']) assert.equal((await fetch(`${base}/${suffix}`)).status, 200);
  for (const [suffix, body] of [['click', { slot: 2 }], ['hotbar', { slot: 4 }], ['close', {}]]) {
    assert.equal((await fetch(`${base}/${suffix}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 200);
  }
  assert.equal((await fetch(`${base}/frame.png`)).status, 402);
  assert.equal((await fetch(base.replace(`/profiles/${profile.id}/`, '/profiles/99999/')+'/state.json')).status, 404);
  assert.equal((await fetch(base.replace(`/pov/${account.id}`, '/pov/99999')+'/state.json')).status, 404);
  assert.equal(requests.length, 5);
});
