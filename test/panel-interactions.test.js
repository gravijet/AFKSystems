import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const read = (file) => fs.readFileSync(new URL(`../public/assets/js/${file}`, import.meta.url), 'utf8');
const live = read('views/live.js');
const settings = read('views/settings.js');
const app = read('app.js');
const inventory = live.slice(live.indexOf('const ARMOR')).replace('export ', '');
const totp = settings.slice(settings.indexOf('function totpSetupDialog'), settings.indexOf('function recoveryDialog'));
const news = app.slice(app.indexOf('function announcements()'), app.indexOf('function banner()'));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const node = () => ({
  innerHTML: '', value: '', disabled: false, isConnected: true,
  addEventListener(event, handler) { this[event] = handler; },
  classList: { add() {}, remove() {} }, focus() {},
});
async function compile(source, context, minify) {
  const { code } = await transform(source, { minify, target: 'es2022' });
  vm.runInContext(code, vm.createContext(context));
  return context;
}

async function inventoryUI(minify, online = true) {
  const root = node(), list = node(), refresh = node();
  const state = { route: { name: 'server', id: 1, tab: 'inventory' }, bots: new Map([
    ['1:1', { online, pov: { web: true } }],
  ]) };
  const pending = deferred(), timers = new Map(), events = {};
  let requests = 0, serial = 0;
  const context = await compile(`${inventory}\nglobalThis.render = tabInventory;`, {
    state, icon: () => '', escapeHtml: String, tr: String, accountLabel: () => 'Bot',
    anyOnline: () => online, itemSlot: () => '<slot>',
    $: (selector) => selector === '#inv-views' ? list : refresh, $$: () => [],
    api: () => { requests++; return pending.promise; }, fail: (error) => { throw error; },
    setTimeout: (handler) => { const id = ++serial; timers.set(id, handler); return id; },
    clearTimeout: (id) => timers.delete(id),
    window: { addEventListener: (event, handler) => { events[event] = handler; } },
  }, minify);
  await context.render(root, { id: 1, accounts: [{ account_id: 1 }] });
  return { root, list, refresh, state, pending, timers, events, requests: () => requests };
}

async function totpUI(minify) {
  const nodes = new Map();
  const element = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, node());
    return nodes.get(selector);
  };
  let closed = 0, requests = 0;
  const pending = deferred();
  const dialog = { ...node(), showModal() {}, remove() {}, close() { closed++; this.closeEvent?.(); } };
  dialog.addEventListener = (event, handler) => { dialog[event === 'close' ? 'closeEvent' : event] = handler; };
  const context = await compile(`${totp}\nglobalThis.open = totpSetupDialog;`, {
    $: element, tr: String, escapeHtml: String, icon: () => '',
    document: { createElement: () => dialog, body: { append() {} } },
    api: () => { requests++; return pending.promise; },
  }, minify);
  const result = context.open({ qr: '', secret: 'test' });
  return { nodes, dialog, pending, result, closed: () => closed, requests: () => requests };
}

for (const minify of [false, true]) {
  const variant = minify ? 'production' : 'source';
  test(`inventory ignores late JSON after leaving or replacing its view (${variant})`, async () => {
    for (const leave of ['navigate', 'redraw']) {
      const ui = await inventoryUI(minify);
      const body = deferred();
      ui.pending.resolve({ ok: true, json: () => body.promise });
      await settle();
      ui.root.isConnected = false;
      if (leave === 'navigate') {
        ui.events.hashchange();
        ui.state.route.id = 2;
      }
      ui.list.innerHTML = 'new inventory';
      body.resolve({ selected_hotbar: 0, menu: { inventory: [{ name: 'old item' }] } });
      await settle();
      assert.equal(ui.list.innerHTML, 'new inventory');
      assert.equal(ui.timers.size, 0);
    }
  });

  test(`inventory refresh keeps a single request and timer chain (${variant})`, async () => {
    const ui = await inventoryUI(minify);
    ui.refresh.click();
    ui.refresh.click();
    assert.equal(ui.requests(), 1);
    ui.pending.resolve({ ok: true, json: async () => ({ menu: { inventory: [{}] } }) });
    await settle();
    assert.match(ui.list.innerHTML, /inv-card/);
    assert.equal(ui.timers.size, 1);
    ui.refresh.click();
    await settle();
    assert.equal(ui.requests(), 2);
    assert.equal(ui.timers.size, 1, 'manual refresh replaces the scheduled refresh');
    ui.events.hashchange();
    assert.equal(ui.timers.size, 0);
  });

  test(`inventory starts updating after an initially offline bot joins (${variant})`, async () => {
    const ui = await inventoryUI(minify, false);
    assert.equal(ui.requests(), 0);
    ui.state.bots.get('1:1').online = true;
    ui.state.onLive({ type: 'state', key: '1:1' });
    assert.equal(ui.requests(), 1);
    ui.pending.resolve({ ok: true, json: async () => ({ menu: { inventory: [{}] } }) });
    await settle();
    assert.match(ui.list.innerHTML, /inv-card/);
    ui.state.bots.get('1:1').online = false;
    ui.state.onLive({ type: 'state', key: '1:1' });
    assert.doesNotMatch(ui.list.innerHTML, /inv-card/);
    ui.events.hashchange();
  });

  test(`TOTP activation preserves recovery codes when cancellation is attempted (${variant})`, async () => {
    const ui = await totpUI(minify);
    const field = ui.nodes.get('#totp-first');
    field.value = '123456';
    field.input({ target: field });
    ui.nodes.get('#totp-cancel').click();
    let prevented = false;
    ui.dialog.cancel({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(ui.closed(), 0);
    const response = { recovery: ['one-time-code'] };
    ui.pending.resolve(response);
    assert.equal(await ui.result, response);
    assert.equal(ui.closed(), 1);
  });

  test(`TOTP serializes automatic submission and allows retry after failure (${variant})`, async () => {
    const ui = await totpUI(minify);
    const field = ui.nodes.get('#totp-first'), button = ui.nodes.get('#totp-confirm');
    field.value = '123456';
    field.input({ target: field });
    field.input({ target: field });
    assert.equal(ui.requests(), 1);
    assert.equal(field.disabled, true);
    ui.pending.reject(new Error('Wrong code'));
    await settle();
    assert.equal(field.disabled, false);
    assert.equal(button.disabled, false);
    assert.equal(ui.nodes.get('#totp-cancel').disabled, false);
    assert.equal(ui.nodes.get('#totp-dialog-error').textContent, 'Wrong code');
    ui.nodes.get('#totp-cancel').click();
    assert.equal(await ui.result, null);
  });

  test(`TOTP can be cancelled before submitting (${variant})`, async () => {
    const ui = await totpUI(minify);
    ui.dialog.cancel({ preventDefault() {} });
    assert.equal(await ui.result, null);
    assert.equal(ui.requests(), 0);
  });

  test(`announcements tolerate malformed stored dismissals and preserve valid ones (${variant})`, async () => {
    for (const stored of ['null', '{}', '42', '"1"', 'invalid', '[1, null, {}]']) {
      let rendered = '';
      const context = await compile(`${news}\nglobalThis.show = announcements;`, {
        state: { meta: { announcements: [
          { id: 1, title: 'First', kind: 'info' }, { id: 2, title: 'Second', kind: 'info' },
        ] } },
        localStorage: { getItem: () => stored }, icon: () => '', escapeHtml: String, tr: String,
        document: { querySelectorAll: () => [], createElement: () => ({ querySelectorAll: () => [] }) },
        $: () => ({ prepend: (box) => { rendered = box.innerHTML; } }),
      }, minify);
      context.show();
      assert.match(rendered, /Second/);
      if (stored.startsWith('[')) assert.doesNotMatch(rendered, /First/);
      else assert.match(rendered, /First/);
    }
  });
}
