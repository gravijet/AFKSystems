import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/server.js', import.meta.url), 'utf8');
const view = source.slice(source.indexOf('async function tabBoard('), source.indexOf('/** Eine Anzeigetafel'));

for (const minify of [false, true]) {
  test(`scoreboards poll every connected account and stop after leaving (${minify ? 'production' : 'source'})`, async () => {
    const root = { innerHTML: '' }, container = { isConnected: true, innerHTML: '' }, controls = {};
    const calls = [], timers = [];
    let finish = null;
    const state = { bots: new Map([1, 2, 8, 9].map(id => [`16:${id}`, { online: id !== 8, views: {
      board: { rows: [{ text: `Points ${id}` }], at: 1 },
    } }])) };
    const context = vm.createContext({
      root, profile: { id: 16, accounts: [1, 2, 8, 9].map(account_id => ({ account_id, name: `Player${account_id}` })) },
      state, document: { hidden: false },
      $: selector => selector === '#views' ? container : {
        addEventListener: (event, fn) => { controls[event] = fn; },
      },
      escapeHtml: String, tr: key => key, icon: () => '',
      noAccounts: () => assert.fail('has accounts'),
      boardCard: (member, board) => `${member.name}:${board.rows[0].text}:${board.offline}`,
      api: async (url, request) => {
        calls.push(JSON.parse(JSON.stringify({ url, ...request })));
        if (calls.length === 2) await new Promise(resolve => { finish = resolve; });
        return { results: request.body.accounts.map(account_id => ({ account_id, ok: true })) };
      },
      fail: error => assert.fail(error.message), toast: () => assert.fail('no errors'),
      setTimeout: (callback, ms) => { assert.equal(ms, 5000); timers.push(callback); },
    });
    const { code } = await transform(`${view}\nglobalThis.tabBoard = tabBoard;`, { minify, target: 'es2022' });
    vm.runInContext(code, context);
    await vm.runInContext('tabBoard(root, profile)', context);
    assert.deepEqual(calls[0].body.accounts, [1, 2, 9]);
    assert.match(container.innerHTML, /Player8:Points 8:true/);
    state.bots.get('16:8').online = true;
    const pending = timers.shift()();
    assert.deepEqual(calls[1].body.accounts, [1, 2, 8, 9]);
    state.onLive({ type: 'hello' });
    assert.equal(calls.length, 2, 'a reconnect cannot overlap an active read');
    container.isConnected = false;
    finish();
    await pending;
    assert.equal(timers.length, 0, 'navigation during the request stops polling');
    await controls.click();
    assert.equal(calls.length, 2);
  });
}
