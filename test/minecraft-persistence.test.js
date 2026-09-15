import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-auth-test-'));
process.env.DATA_DIR = root;
process.env.NODE_ENV = 'test';
process.env.SECRET = 'test-only';
const { db } = await import('../server/db.js');
const { userDir, paths } = await import('../server/config.js');
const agents = await import('../server/agents.js');
const mslogin = await import('../server/mslogin.js');
const binaries = await import('../server/binaries.js');
const { Bot, supervisor } = await import('../server/supervisor.js');
const billing = await import('../server/billing.js');
const { writeAtomic } = await import('../server/account-files.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
let serial = 0;
const credentials = (name, revision = 1, uuid = '123456781234123412341234567890ab') => JSON.stringify({
  minecraftProfile: { name, id: uuid },
  msaToken: { refreshToken: `test-refresh-${revision}`, expireTimeMs: revision * 100000 },
  minecraftToken: { token: `test-access-${revision}`, expireTimeMs: revision * 100000 },
});
function user() {
  const n = ++serial;
  const id = db.prepare("INSERT INTO users(email,username,password_hash,created_at) VALUES(?,?,'test',?)")
    .run(`user${n}@example.test`, `user${n}`, Date.now()).lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function account(owner, name = `Player${++serial}`, revision = 1, uuid) {
  const text = credentials(name, revision, uuid);
  const file = path.join(userDir(owner.id), 'afksystems', 'accounts', `${name}.json`);
  writeAtomic(file, text);
  const id = db.prepare("INSERT INTO mc_accounts(user_id,name,kind,status,uuid,created_at) VALUES(?,?,'microsoft','ok',?,?)")
    .run(owner.id, name, JSON.parse(text).minecraftProfile.id, Date.now()).lastInsertRowid;
  return { ...db.prepare('SELECT * FROM mc_accounts WHERE id = ?').get(id), file, text };
}
function node(t) {
  const id = db.prepare("INSERT INTO nodes(name,kind,created_at) VALUES(?,'agent',?)").run(`Node${++serial}`, Date.now()).lastInsertRowid;
  const socket = new EventEmitter();
  socket.OPEN = 1; socket.readyState = 1; socket.messages = [];
  socket.send = (message) => socket.messages.push(JSON.parse(message));
  socket.close = () => { socket.readyState = 3; socket.emit('close'); };
  agents.attach({ id, name: `Node${id}` }, socket);
  t.after(() => socket.close());
  return { id, socket, send: (files, userId) => socket.emit('message', JSON.stringify({ type: 'files', user_id: userId, files })) };
}
function start(location, owner, acc) {
  return agents.spawn(location.id, { file: 'afk-linux', userId: owner.id, args: ['--account', acc.name] });
}

test('locations only receive the selected account; other accounts cannot overwrite refreshed credentials', (t) => {
  const owner = user(), a = account(owner, 'Alpha'), b = account(owner, 'Beta');
  const first = node(t), second = node(t);
  start(first, owner, a); start(second, owner, b);
  assert.deepEqual(Object.keys(first.socket.messages.at(-1).files), ['accounts/Alpha.json']);
  assert.deepEqual(Object.keys(second.socket.messages.at(-1).files), ['accounts/Beta.json']);
  first.send({ 'accounts/Alpha.json': credentials('Alpha', 2) }, owner.id);
  second.send({ 'accounts/Alpha.json': a.text }, owner.id);
  assert.equal(fs.readFileSync(a.file, 'utf8'), credentials('Alpha', 2));
});

test('stale locations cannot roll back a new browser login or a refresh from another location', (t) => {
  const owner = user(), a = account(owner), first = node(t), second = node(t);
  start(first, owner, a); start(second, owner, a);
  const key = `accounts/${a.name}.json`;
  first.send({ [key]: credentials(a.name, 2) }, owner.id);
  second.send({ [key]: credentials(a.name, 3) }, owner.id);
  assert.equal(fs.readFileSync(a.file, 'utf8'), credentials(a.name, 2));
  writeAtomic(a.file, credentials(a.name, 4));
  first.send({ [key]: credentials(a.name, 5) }, owner.id);
  assert.equal(fs.readFileSync(a.file, 'utf8'), credentials(a.name, 4));
});

test('another bot on the same location does not overwrite an unsynchronized refresh', (t) => {
  const owner = user(), a = account(owner), location = node(t);
  start(location, owner, a); start(location, owner, a);
  assert.deepEqual(location.socket.messages.at(-1).files, {});
  location.send({ [`accounts/${a.name}.json`]: credentials(a.name, 2) }, owner.id);
  assert.equal(fs.readFileSync(a.file, 'utf8'), credentials(a.name, 2));
});

test('partial files, wrong identity, older tokens and deleted accounts cannot replace credentials', (t) => {
  const owner = user(), a = account(owner), location = node(t), key = `accounts/${a.name}.json`;
  start(location, owner, a);
  for (const content of ['', '{', '{}', credentials(a.name, 2, 'ffffffffffffffffffffffffffffffff')]) {
    location.send({ [key]: content }, owner.id);
    assert.equal(fs.readFileSync(a.file, 'utf8'), a.text);
  }
  location.send({ [key]: credentials(a.name, 2) }, owner.id);
  location.send({ [key]: a.text }, owner.id);
  assert.equal(fs.readFileSync(a.file, 'utf8'), credentials(a.name, 2));
  db.prepare('DELETE FROM mc_accounts WHERE id = ?').run(a.id);
  fs.unlinkSync(a.file);
  location.send({ [key]: credentials(a.name, 3) }, owner.id);
  assert.equal(fs.existsSync(a.file), false);
});

test('completed jobs cannot write files and one user cannot write another user’s account', (t) => {
  const owner = user(), other = user(), a = account(owner), b = account(other), location = node(t);
  const proc = start(location, owner, a);
  location.send({ [`accounts/${b.name}.json`]: credentials(b.name, 2) }, other.id);
  assert.equal(fs.readFileSync(b.file, 'utf8'), b.text);
  location.socket.emit('message', JSON.stringify({ type: 'exit', job: proc.job, code: 0 }));
  location.send({ [`accounts/${a.name}.json`]: credentials(a.name, 2) }, owner.id);
  assert.equal(fs.readFileSync(a.file, 'utf8'), a.text);
});

function botContext(t) {
  const owner = user(), acc = account(owner), plan = billing.planBySlug('premium');
  const id = db.prepare(`INSERT INTO profiles(user_id,name,slug,host,mc_version,plan_id,paid_until,created_at)
    VALUES(?,'Test',?,'example.test','1.21.1',?,?,?)`).run(owner.id, `test${++serial}`, plan.id, Date.now()+86400000, Date.now()).lastInsertRowid;
  const profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(id);
  db.prepare('INSERT INTO profile_accounts(profile_id,account_id,wanted) VALUES(?,?,1)').run(id,acc.id);
  const bot = new Bot(supervisor, { profile, account: acc, user: owner, plan: billing.featuresOf(profile) });
  db.prepare("INSERT INTO bots(profile_id,account_id,state) VALUES(?,?,'starting')").run(id,acc.id);
  supervisor.bots.set(bot.key, bot);
  t.after(() => { supervisor.cancelRestart(bot.key); bot.cleanup(); supervisor.bots.delete(bot.key); });
  return bot;
}

test('temporary Microsoft outages retry saved credentials without presenting another device login', (t) => {
  for (const reason of ['EOF while parsing a value at line 1 column 0', 'MSA-Refresh fehlgeschlagen: HTTP 503', 'Connection timed out', 'error sending request', 'HTTP 429 Too Many Requests']) {
    const bot = botContext(t), signals = [];
    bot.proc = { kill: (signal) => signals.push(signal) };
    bot.feed('err', Buffer.from(`Konto '${bot.account.name}' ließ sich nicht anmelden: ${reason}\n`));
    assert.deepEqual(signals, ['SIGTERM']);
    assert.equal(bot.stopping, false);
    assert.equal(bot.account.status, 'ok');
    bot.feed('err', Buffer.from('  1. Öffne im Browser: https://microsoft.com/link\n  2. Gib diesen Code ein: TEST-CODE\n'));
    assert.equal(Boolean(bot.auth), false);
    assert.notEqual(bot.state, 'auth');
    assert.equal(bot.wanted(), true);
    bot.cleanup();
    assert.equal(supervisor.planRestart(bot), true, reason);
  }
});

test('revoked credentials still need confirmation; a successful join clears stale account errors', (t) => {
  const bot = botContext(t);
  bot.authenticationFailed('MSA-Refresh fehlgeschlagen: invalid_grant');
  assert.equal(bot.account.status, 'error');
  assert.equal(supervisor.planRestart(bot), false);
  bot.markOnline(bot.account.name);
  const saved = db.prepare('SELECT status,last_error FROM mc_accounts WHERE id=?').get(bot.account.id);
  assert.deepEqual(saved, { status: 'ok', last_error: null });
  assert.equal(bot.account.status, 'ok');
  assert.equal(bot.lastError, null);
});

const fakeBinary = path.join(paths.bin, 'afk-linux');
function loginClient(t, scenario) {
  const before = binaries.state.builds.slim;
  binaries.state.builds.slim = { present: true, caps: {} };
  const instruction = path.join(paths.bin, 'scenario.json');
  fs.writeFileSync(instruction, JSON.stringify(scenario));
  fs.writeFileSync(fakeBinary, `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const scenario=JSON.parse(fs.readFileSync(${JSON.stringify(instruction)},'utf8'));
process.stderr.write('1. Oeffne im Browser: https://microsoft.com/link\\n2. Gib diesen Code ein: TEST-CODE\\n');
const dir=path.join(process.env.XDG_CONFIG_HOME,'afksystems','accounts');
fs.mkdirSync(dir,{recursive:true});
setTimeout(()=>{
 fs.writeFileSync(path.join(dir,scenario.name+'.json'),scenario.content);
 process.stdout.write(scenario.name+'\\n');
 setTimeout(()=>process.exit(0),scenario.exitDelay||0);
},scenario.delay||0);
`, { mode: 0o755 });
  t.after(() => { binaries.state.builds.slim = before; });
}
async function result(session, owner) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const state = mslogin.status(session.id, owner);
    if (['done','error'].includes(state.status)) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Fake client did not finish');
}

test('renewal validates the selected identity and never replaces it with a different Microsoft account', async (t) => {
  const owner = user(), a = account(owner);
  loginClient(t, { name: 'OtherPlayer', content: credentials('OtherPlayer', 2, 'ffffffffffffffffffffffffffffffff') });
  const done = await result(mslogin.begin(owner, a.id), owner);
  assert.equal(done.status, 'error');
  assert.match(done.error, /Microsoft-Konto/);
  assert.equal(fs.readFileSync(a.file,'utf8'), a.text);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mc_accounts WHERE user_id=?').get(owner.id).n, 1);
  assert.equal(fs.existsSync(path.join(userDir(owner.id),'afksystems/accounts/OtherPlayer.json')), false);
});

test('renewal preserves account id and assignments after a Minecraft name change', async (t) => {
  const bot = botContext(t), a = bot.account, owner = db.prepare('SELECT * FROM users WHERE id=?').get(bot.userId);
  loginClient(t, { name: 'RenamedPlayer', content: credentials('RenamedPlayer', 2) });
  const done = await result(mslogin.begin(owner, a.id), owner);
  assert.equal(done.status, 'done');
  assert.equal(done.account.id, a.id);
  assert.equal(done.account.name, 'RenamedPlayer');
  assert.equal(db.prepare('SELECT account_id FROM profile_accounts WHERE profile_id=?').get(bot.profile.id).account_id, a.id);
  assert.equal(fs.existsSync(a.file), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mc_accounts WHERE user_id=?').get(owner.id).n, 1);
});

test('invalid login files never mark an account as renewed', async (t) => {
  const owner = user(), a = account(owner);
  db.prepare("UPDATE mc_accounts SET status='error' WHERE id=?").run(a.id);
  loginClient(t, { name: a.name, content: '{}' });
  assert.equal((await result(mslogin.begin(owner,a.id),owner)).status, 'error');
  assert.equal(fs.readFileSync(a.file,'utf8'),a.text);
  assert.equal(db.prepare('SELECT status FROM mc_accounts WHERE id=?').get(a.id).status, 'error');
});

test('cancelling a login cannot change a stored account even when the client already wrote its file', async (t) => {
  const owner = user(), a = account(owner);
  loginClient(t, { name: a.name, content: credentials(a.name, 2), exitDelay: 1000 });
  const session = mslogin.begin(owner,a.id);
  const home = fs.readdirSync(userDir(owner.id)).find((name) => name.startsWith('.login-'));
  const staged = path.join(userDir(owner.id),home,'afksystems/accounts',`${a.name}.json`);
  for(let n=0;n<100&&!fs.existsSync(staged);n++) await new Promise((resolve)=>setTimeout(resolve,10));
  assert.equal(fs.existsSync(staged),true);
  mslogin.cancel(session.id, owner);
  await new Promise((resolve)=>setTimeout(resolve,100));
  assert.equal(fs.readFileSync(a.file,'utf8'),a.text);
  assert.equal(fs.existsSync(path.join(userDir(owner.id),home)),false);
});

test('renewal targets must belong to the user and still exist', (t) => {
  const owner = user(), other = user(), a = account(other);
  assert.throws(() => mslogin.begin(owner,a.id), {status:404});
});


test('new movement points are synchronized even when no movement file existed at start', (t) => {
  const owner = user(), a = account(owner), location = node(t);
  start(location, owner, a);
  location.send({ 'movement.json': '{"points":[1,2]}' }, owner.id);
  const file = path.join(userDir(owner.id),'afksystems/movement.json');
  assert.equal(fs.readFileSync(file,'utf8'), '{"points":[1,2]}');
  location.send({ 'movement.json': '{"points":[3]}' }, owner.id);
  assert.equal(fs.readFileSync(file,'utf8'), '{"points":[3]}');
});

test('an offline name collision cannot silently report a Microsoft account as connected', async (t) => {
  const owner = user();
  const offline = mslogin.addOffline(owner, 'OfflinePlayer');
  loginClient(t, { name: offline.name, content: credentials(offline.name,2) });
  assert.equal((await result(mslogin.begin(owner),owner)).status,'error');
  assert.equal(db.prepare('SELECT kind FROM mc_accounts WHERE id=?').get(offline.id).kind,'offline');
  assert.equal(fs.existsSync(path.join(userDir(owner.id),'afksystems/accounts/OfflinePlayer.json')),false);
});

test('removing an account during renewal does not resurrect the account', async (t) => {
  const owner = user(), a = account(owner);
  loginClient(t, { name: a.name, content: credentials(a.name,2), delay: 100 });
  const session = mslogin.begin(owner,a.id);
  mslogin.removeAccount(owner,a.id);
  assert.equal((await result(session,owner)).status,'error');
  assert.equal(fs.existsSync(a.file),false);
  assert.equal(db.prepare('SELECT id FROM mc_accounts WHERE id=?').get(a.id),undefined);
});

test('account reconciliation ignores incomplete files and recognizes a restored missing login', () => {
  const owner = user(), a = account(owner);
  const dir = path.dirname(a.file);
  fs.unlinkSync(a.file);
  mslogin.reconcile(owner.id);
  assert.equal(db.prepare('SELECT status FROM mc_accounts WHERE id=?').get(a.id).status,'error');
  writeAtomic(a.file, a.text);
  fs.writeFileSync(path.join(dir,'Broken.json'),'{');
  assert.doesNotThrow(()=>mslogin.reconcile(owner.id));
  assert.equal(db.prepare('SELECT status FROM mc_accounts WHERE id=?').get(a.id).status,'ok');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mc_accounts WHERE user_id=?').get(owner.id).n,1);
});

test('reconciliation keeps a renamed account’s id and does not reapply its old missing-file error', () => {
  const owner = user(), a = account(owner);
  fs.unlinkSync(a.file);
  writeAtomic(path.join(path.dirname(a.file),'ChangedName.json'),credentials('ChangedName',2));
  mslogin.reconcile(owner.id);
  const saved = db.prepare('SELECT id,name,status FROM mc_accounts WHERE id=?').get(a.id);
  assert.deepEqual(saved,{ id:a.id,name:'ChangedName',status:'ok' });
});

test('a fresh browser renewal reaches another bot on a location that still has an older session', (t) => {
  const owner = user(), a = account(owner), location = node(t), key = `accounts/${a.name}.json`;
  start(location, owner, a);
  writeAtomic(a.file, credentials(a.name, 3));
  start(location, owner, a);
  assert.equal(location.socket.messages.at(-1).files[key], credentials(a.name, 3));
  location.send({ [key]: credentials(a.name, 2) }, owner.id);
  assert.equal(fs.readFileSync(a.file,'utf8'), credentials(a.name, 3));
  location.send({ [key]: credentials(a.name, 4) }, owner.id);
  assert.equal(fs.readFileSync(a.file,'utf8'), credentials(a.name, 4));
});
