import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/accounts.js', import.meta.url), 'utf8');
const login = source.slice(source.indexOf('async function startLogin'));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function setup(minify, request) {
  const listeners = {};
  const body = { innerHTML: '' };
  const button = { addEventListener() {}, classList: { add() {} } };
  const dialog = {
    showModal() {}, remove() {},
    addEventListener: (event, handler) => { listeners[event] = handler; },
    close: () => listeners.close(),
  };
  const calls = [], timers = new Map();
  let refreshed = 0, serial = 0;
  const context = vm.createContext({
    document: { createElement: () => dialog, body: { append() {} } },
    $: (selector) => selector === '#login-body' ? body : button,
    api: (path, options) => { calls.push({ path, method: options?.method || 'GET' }); return request(path, options); },
    icon: () => '', escapeHtml: String, tr: String, ok() {}, draw() {},
    refresh: async () => { refreshed++; }, state: { route: { name: 'accounts' } },
    setInterval: (handler) => { const id = ++serial; timers.set(id, handler); return id; },
    clearInterval: (id) => timers.delete(id),
  });
  const { code } = await transform(`${login}\nglobalThis.login = startLogin;`, { minify, target: 'es2022' });
  vm.runInContext(code, context);
  return { start: context.login, dialog, body, calls, timers, refreshed: () => refreshed };
}

for (const minify of [false, true]) {
  const variant = minify ? 'production' : 'source';
  test(`closing Microsoft login before creation cancels the eventual session (${variant})`, async () => {
    const pending = deferred();
    const ui = await setup(minify, (_path, options) => options?.method === 'POST' ? pending.promise : Promise.resolve({}));
    const started = ui.start();
    ui.dialog.close();
    pending.resolve({ id: 'late', status: 'pending' });
    await started;
    assert.deepEqual(ui.calls.map((call) => `${call.method} ${call.path}`), ['POST /accounts/login', 'DELETE /accounts/login/late']);
    assert.equal(ui.timers.size, 0);
  });

  test(`a closed Microsoft login ignores a late creation failure (${variant})`, async () => {
    const pending = deferred();
    const ui = await setup(minify, () => pending.promise);
    const started = ui.start();
    ui.dialog.close();
    pending.reject(new Error('late failure'));
    await started;
    assert.equal(ui.body.innerHTML, '');
    assert.equal(ui.timers.size, 0);
  });

  test(`Microsoft login serializes polling and ignores completion after closing (${variant})`, async () => {
    const pending = deferred();
    const ui = await setup(minify, (_path, options) => options?.method
      ? Promise.resolve({ id: 'session', status: 'pending' }) : pending.promise);
    await ui.start();
    const tick = [...ui.timers.values()][0];
    const first = tick();
    const second = tick();
    assert.equal(ui.calls.filter((call) => call.method === 'GET').length, 1);
    await second;
    const before = ui.body.innerHTML;
    ui.dialog.close();
    pending.resolve({ status: 'done', account: { name: 'Player' } });
    await first;
    assert.equal(ui.body.innerHTML, before);
    assert.equal(ui.refreshed(), 0);
    assert.equal(ui.timers.size, 0);
  });

  test(`Microsoft login completes and refreshes an open panel (${variant})`, async () => {
    const ui = await setup(minify, (_path, options) => Promise.resolve(options?.method
      ? { id: 'session', status: 'pending' } : { status: 'done', account: { name: 'Player' } }));
    await ui.start();
    await [...ui.timers.values()][0]();
    assert.equal(ui.refreshed(), 1);
    assert.equal(ui.timers.size, 0);
    ui.dialog.close();
    assert.equal(ui.calls.some((call) => call.method === 'DELETE'), false);
  });
  test(`renewal sends the selected account id (${variant})`, async () => {
    let body;
    const ui = await setup(minify, (_path, options) => { body = options?.body; return Promise.resolve({ id: 'selected', status: 'starting' }); });
    await ui.start({ account: { id: 42, name: 'Player' } });
    assert.equal(body.account_id, 42);
    ui.dialog.close();
  });

  test(`temporary polling failures keep a Microsoft login alive (${variant})`, async () => {
    let polls = 0;
    const ui = await setup(minify, (_path, options) => {
      if (options?.method === 'POST') return Promise.resolve({ id: 'retry', status: 'starting' });
      if (++polls === 1) return Promise.reject(Object.assign(new Error('offline'), { status: 0 }));
      return Promise.resolve({ status: 'done', account: { id: 1, name: 'Player' } });
    });
    await ui.start();
    await [...ui.timers.values()][0]();
    assert.equal(ui.timers.size, 1);
    await [...ui.timers.values()][0]();
    assert.equal(ui.refreshed(), 1);
    assert.equal(ui.timers.size, 0);
    ui.dialog.close();
  });

  test(`expired polling sessions show the error and stop polling (${variant})`, async () => {
    const ui = await setup(minify, (_path, options) => options?.method === 'POST'
      ? Promise.resolve({ id: 'expired', status: 'starting' })
      : Promise.reject(Object.assign(new Error('expired'), { status: 404 })));
    await ui.start();
    await [...ui.timers.values()][0]();
    assert.equal(ui.timers.size, 0);
    assert.match(ui.body.innerHTML, /expired/);
  });

}
