import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// Opt in with the actual installed client. All accounts and traffic stay in this
// temporary database and loopback Minecraft server.
const client = process.env.AFK_TEST_CLIENT;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-multi-client-'));
process.env.DATA_DIR = root;
process.env.NODE_ENV = 'test';
const { db } = await import('../server/db.js');
const binaries = await import('../server/binaries.js');
const billing = await import('../server/billing.js');
const { supervisor } = await import('../server/supervisor.js');
const { macros } = await import('../server/macros.js');
after(() => { supervisor.shutdown(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });

function vi(value) {
  const bytes = [];
  do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; bytes.push(byte); } while (value);
  return Buffer.from(bytes);
}
const str = value => Buffer.concat([vi(Buffer.byteLength(value)), Buffer.from(value)]);
const int = value => { const b = Buffer.alloc(4); b.writeInt32BE(value); return b; };
const double = value => { const b = Buffer.alloc(8); b.writeDoubleBE(value); return b; };
function readVi(b, offset = 0) {
  let value = 0;
  for (let n = 0; n < 5 && offset + n < b.length; n++) {
    value |= (b[offset + n] & 127) << (7 * n);
    if (!(b[offset + n] & 128)) return [value, offset + n + 1];
  }
  return null;
}
function readString(b, offset = 0) { const [n, start] = readVi(b, offset); return b.subarray(start, start + n).toString(); }
async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (check()) return; await new Promise(r => setTimeout(r, 20)); }
  assert.fail(`Timed out: ${typeof label === 'function' ? JSON.stringify(label()) : label}`);
}
async function minecraft(t) {
  const received = [], sockets = new Set();
  let lastLogin = 0;
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let pending = Buffer.alloc(0), stage = 'handshake', name;
    const send = (id, ...parts) => { const b = Buffer.concat([vi(id), ...parts]); socket.write(Buffer.concat([vi(b.length), b])); };
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length) {
        const size = readVi(pending);
        if (!size || pending.length < size[1] + size[0]) return;
        const b = pending.subarray(size[1], size[1] + size[0]);
        pending = pending.subarray(size[1] + size[0]);
        const [id, start] = readVi(b), payload = b.subarray(start);
        if (stage === 'handshake') stage = 'login';
        else if (stage === 'login') {
          name = readString(payload);
          const now = Date.now();
          if (now - lastLogin < 2000) {
            send(0, str(JSON.stringify({ text: 'You are logging in too fast, try again later.' })));
            socket.end();
            return;
          }
          lastLogin = now;
          send(2, Buffer.alloc(16, 7), str(name), vi(0), Buffer.from([1]));
          stage = 'ack';
        } else if (stage === 'ack') {
          send(7, str('minecraft:dimension_type'), vi(1), str('minecraft:overworld'),
            // Anonymous NBT compound: min_y=-64, height=384.
            Buffer.from([1, 10, 3, 0, 5]), Buffer.from('min_y'), int(-64),
            Buffer.from([3, 0, 6]), Buffer.from('height'), int(384), Buffer.from([0]));
          send(3);
          stage = 'config';
        } else if (stage === 'config' && id === 3) {
          send(49, int(42), Buffer.from([0]), vi(1), str('minecraft:overworld'), vi(20), vi(8), vi(8),
            Buffer.from([0, 1, 0]), vi(0), str('minecraft:overworld'), Buffer.alloc(8),
            Buffer.from([0, 255, 0, 0, 0]), vi(0), vi(63), Buffer.from([0]));
          send(72, vi(1), double(8), double(16), double(8), Buffer.alloc(36));
          stage = 'game';
        } else if (stage === 'game' && (id === 7 || id === 9)) {
          received.push({ name, text: readString(payload), at: Date.now() });
        }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r)); });
  return { port: server.address().port, received };
}

test('four real clients deliver commands despite destination login limits', { skip: !client }, async t => {
  const mc = await minecraft(t);
  fs.symlinkSync(path.resolve(client), path.join(root, 'bin', 'afk-linux'));
  await binaries.detect();
  const now = Date.now();
  const uid = db.prepare("INSERT INTO users(email,username,password_hash,created_at) VALUES('multi@example.test','multi','test',?)").run(now).lastInsertRowid;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const plan = billing.planBySlug('ultra');
  db.prepare('UPDATE plans SET max_accounts=10 WHERE id=?').run(plan.id);
  const pid = db.prepare(`INSERT INTO profiles(user_id,name,slug,host,port,mc_version,plan_id,paid_until,join_delay,chat_delay,created_at)
    VALUES(?,'Multi','multi','127.0.0.1',?,'26.1',?,?,0,50,?)`).run(uid, mc.port, plan.id, now + 86400000, now).lastInsertRowid;
  const profile = db.prepare('SELECT * FROM profiles WHERE id=?').get(pid);
  db.prepare(`INSERT INTO macros(profile_id,name,event,actions,created_at) VALUES(?,'Join','join',?,?)`)
    .run(pid, JSON.stringify([{ type: 'chat', text: '/join-test' }]), now);
  const bots = [];
  t.after(async () => {
    for (const bot of bots) bot.stop();
    await until(() => bots.every(bot => !bot.proc), 'clients stop');
  });
  for (let i = 0; i < 4; i++) {
    const aid = db.prepare("INSERT INTO mc_accounts(user_id,name,kind,status,created_at) VALUES(?,?,'offline','ok',?)")
      .run(uid, `Multi${i}`, now).lastInsertRowid;
    db.prepare('INSERT INTO profile_accounts(profile_id,account_id) VALUES(?,?)').run(pid, aid);
    const account = db.prepare('SELECT * FROM mc_accounts WHERE id=?').get(aid);
    supervisor.start({ profile, account, user });
    bots.push(supervisor.get(pid, aid));
  }
  await until(() => mc.received.filter(r => r.text === 'join-test').length === 4,
    () => bots.map(b => ({ state: b.state, lines: b.chat.slice(-5) })));
  await Promise.all(bots.map(async bot => {
    await bot.send(`/manual-${bot.account.name}`, { confirm: true });
    await bot.send(`chat-${bot.account.name}`, { confirm: true });
  }));
  await until(() => mc.received.filter(r => r.text.startsWith('manual-') || r.text.startsWith('chat-')).length === 8, 'manual commands');
  for (const bot of bots) assert.deepEqual(mc.received.filter(r => r.name === bot.account.name).map(r => r.text),
    ['join-test', `manual-${bot.account.name}`, `chat-${bot.account.name}`]);
  const timer = db.prepare(`INSERT INTO macros(profile_id,name,event,config,actions,accounts,created_at)
    VALUES(?,'Timer','timer','{"interval_sec":5}',?,?,?)`).run(pid,
      JSON.stringify([{ type: 'chat', text: '/timer-one' }]), JSON.stringify([bots[0].account.id]), now).lastInsertRowid;
  macros.reload(pid);
  await until(() => mc.received.some(r => r.text === 'timer-one'), 'first account timer');
  assert.deepEqual(mc.received.filter(r => r.text === 'timer-one').map(r => r.name), ['Multi0']);
  db.prepare('UPDATE macros SET accounts=?,actions=? WHERE id=?').run(JSON.stringify(bots.slice(1).map(b => b.account.id)),
    JSON.stringify([{ type: 'chat', text: '/timer-rest' }]), timer);
  macros.reload(pid);
  await until(() => mc.received.filter(r => r.text === 'timer-rest').length === 3, 'other account timers');
  assert.deepEqual(mc.received.filter(r => r.text === 'timer-rest').map(r => r.name).sort(), ['Multi1', 'Multi2', 'Multi3']);
  bots[0].stop();
  await until(() => !bots[0].proc, 'first account stops');
  await Promise.all(bots.slice(1).map(bot => bot.send('/after-stop', { confirm: true })));
  await until(() => mc.received.filter(r => r.text === 'after-stop').length === 3, 'remaining accounts keep sending');
  assert.deepEqual(mc.received.filter(r => r.text === 'after-stop').map(r => r.name).sort(), ['Multi1', 'Multi2', 'Multi3']);
});
