import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/admin.js', import.meta.url), 'utf8');
const start = source.indexOf('  let accounts = data.accounts;');
const polling = source.slice(start, source.indexOf('  // ------------------------------------------------------------ Knöpfe', start));

for (const minify of [false, true]) {
  const variant = minify ? 'production' : 'source';
  test(`admin server polling cannot overwrite a different server after navigation (${variant})`, async () => {
    let resolve, tick, cleared = false, requests = 0, bound = 0;
    const root = { isConnected: true };
    const list = { innerHTML: 'current server' }, count = { textContent: '1/2' };
    const context = vm.createContext({
      root, id: 1, data: { accounts: [] }, state: { route: { name: 'admin', tab: 'servers', id: 2 } },
      api: () => { requests++; return new Promise((done) => { resolve = done; }); },
      $: (selector) => selector === '#botlist' ? list : count,
      accountRows: () => 'old server', bindAccounts: () => { bound++; }, load() {},
      setInterval: (handler) => { tick = handler; return 1; }, clearInterval: () => { cleared = true; },
    });
    const { code } = await transform(`${polling}\nglobalThis.refreshServer = refresh;`, { minify, target: 'es2022' });
    vm.runInContext(code, context);
    const pending = context.refreshServer();
    const second = context.refreshServer();
    assert.equal(requests, 1, 'slow requests do not accumulate');
    await second;
    root.isConnected = false;
    resolve({ accounts: [{ online: true }], features: { max_accounts: 4 } });
    await pending;
    assert.equal(list.innerHTML, 'current server');
    assert.equal(count.textContent, '1/2');
    assert.equal(bound, 1);
    tick();
    assert.equal(cleared, true, 'leaving for another server stops the old interval');
    assert.equal(requests, 1);
  });
}
