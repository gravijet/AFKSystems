import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { prepareClientHome, botScope } from '../agent/client-home.js';

const source = fs.readFileSync(new URL('../agent/index.js', import.meta.url), 'utf8');
const files = source.slice(source.indexOf('const WANTED ='), source.indexOf('function startJob('));
const sync = source.slice(source.indexOf('function pushAccountFiles('), source.indexOf('/**\n * Eine HTTP-Anfrage', source.indexOf('function pushAccountFiles(')));

test('agent snapshots retain each job identity and movement file for four accounts', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-agent-scopes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const jobs = new Map(), messages = [];
  const ctx = vm.createContext({ fs, path, paths: { users: dir }, jobs });
  vm.runInContext(`${files}\n${sync}\nglobalThis.readFiles = readFiles; globalThis.writeFiles = writeFiles; globalThis.pushAccountFiles = pushAccountFiles; globalThis.userHome = userHome;`, ctx);
  const base = ctx.userHome(1);
  for (let id = 1; id <= 4; id++) {
    const home = prepareClientHome(base, botScope(16, id));
    ctx.writeFiles(home, { 'movement.json': `{"home":{"x":${id}}}`, [`accounts/Player${id}.json`]: '{"login":"shared"}' });
    jobs.set(`job${id}`, { userId: 1, home, accountName: `Player${id}` });
  }
  ctx.pushAccountFiles({ send: message => messages.push(JSON.parse(JSON.stringify(message))) });
  assert.equal(messages.length, 4);
  assert.deepEqual(messages.map(message => [message.job, message.files['movement.json']]),
    [1, 2, 3, 4].map(id => [`job${id}`, `{"home":{"x":${id}}}`]));
  for (let index = 0; index < 4; index++) assert.deepEqual(Object.keys(messages[index].files),
    ['movement.json', `accounts/Player${index + 1}.json`]);
  assert.equal(fs.existsSync(path.join(base, 'afksystems/movement.json')), false);
  for (let id = 1; id <= 4; id++) assert.equal(fs.existsSync(path.join(base, `afksystems/accounts/Player${id}.json`)), true);
});
