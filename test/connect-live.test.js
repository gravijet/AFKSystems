import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { mergeLines } from '../public/assets/js/chatlog.js';

const source = fs.readFileSync(new URL('../public/assets/js/views/server.js', import.meta.url), 'utf8');
const historyStart = source.indexOf('    const data = await api(`/profiles/${profile.id}/chat`)');
const history = source.slice(historyStart, source.indexOf('  } catch {', historyStart));
const refreshStart = source.indexOf('  const refreshBots = debounce(');
const live = source.slice(refreshStart, source.indexOf('\n  state.onLive =', refreshStart));
async function compile(code, context, minify) {
  vm.runInContext((await transform(code, { minify, target: 'es2022' })).code, vm.createContext(context));
  return context;
}

for (const minify of [false, true]) {
  const variant = minify ? 'production' : 'source';
  test(`reloaded multi-account history preserves shared and account-specific messages (${variant})`, async () => {
    const state = { lines: new Map() };
    const lines = [
      { t: 100, type: 'chat', text: 'shared', account_id: 1, accounts: [1, 2] },
      { t: 200, type: 'chat', text: 'private', account_id: 2, accounts: [2] },
      { t: 300, type: 'sent', text: 'own command', account_id: 2, accounts: [2] },
      { t: 400, type: 'chat', text: 'old API response', account_id: 1 },
      { t: 500, type: 'chat', text: 'detached account', account_id: 99, accounts: [99] },
    ];
    const context = await compile(`globalThis.load = async () => { ${history} };`, {
      api: async () => ({ lines }), profile: { id: 16 },
      members: [{ account_id: 1 }, { account_id: 2 }], state,
    }, minify);
    await context.load();
    await context.load();
    assert.deepEqual(Array.from(state.lines.get('16:1'), line => line.text), ['shared', 'old API response']);
    assert.deepEqual(Array.from(state.lines.get('16:2'), line => line.text), ['shared', 'private', 'own command']);
    assert.equal(state.lines.has('16:99'), false);
    const combined = mergeLines([...state.lines].flatMap(([key, rows]) =>
      rows.map(row => ({ ...row, account_id: Number(key.split(':')[1]) }))));
    assert.equal(combined.filter(line => line.text === 'shared').length, 1);
    assert.deepEqual(combined[0].accounts, [1, 2]);
  });

  test(`live account refresh ignores a response after leaving the view (${variant})`, async () => {
    let active = true, finish, paints = 0;
    const pending = new Promise(resolve => { finish = resolve; });
    const profile = { id: 16 }, members = [{ account_id: 1 }];
    const context = await compile(`${live}\nglobalThis.reload = refreshBots;`, {
      debounce: handler => handler, currentView: () => active, refresh: () => pending,
      profileById: () => ({ accounts: [{ account_id: 2 }], online: 1 }), profile, members,
      paintBots: () => paints++, paintAuth: () => paints++, paintDiagnosis: () => paints++,
      fail: error => { throw error; },
    }, minify);
    const work = context.reload();
    active = false;
    finish();
    await work;
    assert.equal(paints, 0);
    assert.equal(members[0].account_id, 1);
  });

  test(`live account refresh retains members even when the response shares their array (${variant})`, async () => {
    const members = [{ account_id: 1 }, { account_id: 2 }];
    let paints = 0;
    const context = await compile(`${live}\nglobalThis.reload = refreshBots;`, {
      debounce: handler => handler, currentView: () => true, refresh: async () => {},
      profileById: () => ({ accounts: members, online: 2 }), profile: { id: 16 }, members,
      paintBots: () => paints++, paintAuth: () => paints++, paintDiagnosis: () => paints++,
      fail: error => { throw error; },
    }, minify);
    await context.reload();
    assert.equal(members.length, 2);
    assert.equal(paints, 3);
  });
}
