import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/server.js', import.meta.url), 'utf8');
const menu = source.slice(source.indexOf('async function tabMenu('), source.indexOf('// ---------------------------------------------------------------- Zusätze'));
const parts = fs.readFileSync(new URL('../public/assets/js/views/parts.js', import.meta.url), 'utf8');
const item = parts.slice(parts.indexOf('export function itemSlot')).replace('export ', '');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { resolve, promise };
};
const node = () => ({ innerHTML: '', isConnected: true, dataset: {}, addEventListener(event, handler) { this[event] = handler; } });
async function setup(minify, online = true) {
  const root = node(), list = node(), refresh = node(), close = node(), slot = node();
  slot.dataset = { slot: '2', account: '7', inspect: '0' };
  const state = { route: { name: 'server', id: 1, tab: 'menu' }, bots: new Map([
    ['1:7', { online, pov: { web: true } }], ['1:8', { online: false }],
  ]) };
  const pending = deferred(), timers = new Map(), events = {}, calls = [];
  let serial = 0;
  const context = vm.createContext({
    state, icon: () => '', escapeHtml: String, mcText: String, tr: String,
    accountPicker: () => '', commandRunner: () => async () => true,
    anyOnline: () => online, itemSlot: () => '<slot>',
    $: selector => selector === '#views' ? list : selector === '#get-menu' ? refresh : close,
    $$: () => [slot],
    api: (url, options) => { calls.push({ url, options }); return options?.method ? Promise.resolve({ results: [{ ok: true }] }) : pending.promise; },
    fail: error => { throw error; },
    setTimeout: handler => { const id = ++serial; timers.set(id, handler); return id; },
    clearTimeout: id => timers.delete(id),
    window: { addEventListener: (event, handler) => { events[event] = handler; } },
  });
  const { code } = await transform(`${menu}\nglobalThis.render = tabMenu;`, { minify, target: 'es2022' });
  vm.runInContext(code, context);
  await context.render(root, { id: 1, accounts: [{ account_id: 7, name: 'Alpha' }, { account_id: 8, name: 'Beta' }] });
  return { root, list, refresh, slot, state, pending, timers, events, calls };
}

for (const minify of [false, true]) {
  const variant = minify ? 'production' : 'source';
  test(`menu begins polling when the bot joins after opening the tab (${variant})`, async () => {
    const ui = await setup(minify, false);
    assert.equal(ui.calls.length, 0);
    assert.equal(ui.timers.size, 1);
    ui.state.bots.get('1:7').online = true;
    ui.state.onLive({ type: 'state', key: '1:7' });
    assert.equal(ui.calls.length, 1);
    ui.pending.resolve({ ok: true, json: async () => ({ textures: true, menu: { open: true, title: 'Joined menu', slots: 9, items: [] } }) });
    await settle();
    assert.match(ui.list.innerHTML, /Joined menu/);
    assert.match(ui.list.innerHTML, /Alpha/);
    assert.doesNotMatch(ui.list.innerHTML, /Beta/);
    ui.events.hashchange();
    assert.equal(ui.timers.size, 0);
  });

  test(`menu refresh serializes requests and keeps one timer (${variant})`, async () => {
    const ui = await setup(minify);
    ui.refresh.click(); ui.refresh.click();
    ui.state.onLive({ type: 'state', key: '1:7' });
    assert.equal(ui.calls.length, 1);
    ui.pending.resolve({ ok: true, json: async () => ({ menu: { open: false } }) });
    await settle();
    assert.equal(ui.timers.size, 1);
    ui.events.hashchange();
  });

  test(`menu ignores late JSON after navigation or replacing its view (${variant})`, async () => {
    for (const replacement of [false, true]) {
      const ui = await setup(minify), body = deferred();
      ui.pending.resolve({ ok: true, json: () => body.promise });
      await settle();
      if (replacement) ui.root.isConnected = false;
      else { ui.state.route.tab = 'board'; ui.events.hashchange(); }
      ui.list.innerHTML = 'new page';
      body.resolve({ menu: { open: true, title: 'Old menu' } });
      await settle();
      assert.equal(ui.list.innerHTML, 'new page');
      assert.equal(ui.timers.size, 0);
    }
  });

  test(`disconnected accounts never regain clickable stale menus (${variant})`, async () => {
    const ui = await setup(minify);
    ui.state.bots.get('1:7').online = false;
    ui.state.onLive({ type: 'state', key: '1:7' });
    ui.pending.resolve({ ok: true, json: async () => ({ menu: { open: true, title: 'Stale menu' } }) });
    await settle();
    assert.doesNotMatch(ui.list.innerHTML, /Stale menu/);
    ui.events.hashchange();
  });

  test(`right-click uses only the clicked account and prevents the browser menu (${variant})`, async () => {
    const ui = await setup(minify);
    let prevented = false;
    await ui.slot.contextmenu({ type: 'contextmenu', preventDefault: () => { prevented = true; }, currentTarget: ui.slot });
    assert.equal(prevented, true);
    const sent = ui.calls.find(call => call.options?.method === 'POST');
    assert.equal(sent.options.body.verb, 'click');
    assert.equal(sent.options.body.arg, '2 rechts');
    assert.deepEqual([...sent.options.body.accounts], [7]);
    ui.events.hashchange();
    ui.pending.resolve({ ok: false });
    await settle();
  });

  test(`item icons wait for textures and separate Minecraft versions in the cache (${variant})`, async () => {
    const context = vm.createContext({ tr: String, escapeHtml: String, mcText: String, itemGlyph: () => 'fallback' });
    const { code } = await transform(`${item}\nglobalThis.slot = itemSlot;`, { minify, target: 'es2022' });
    vm.runInContext(code, context);
    const options = { item: { id: 1, name: 'Stone' }, index: 0, accountId: 1, profileId: 1, version: '26.1' };
    assert.doesNotMatch(context.slot({ ...options, textures: false }), /<img/);
    assert.match(context.slot({ ...options, textures: true }), /<img/);
    assert.match(context.slot(options), /v=26.1/);
    assert.match(context.slot({ ...options, version: '1.8.9' }), /v=1.8.9/);
  });
}
