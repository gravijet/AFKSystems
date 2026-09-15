import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const read = (file) => fs.readFileSync(new URL(`../public/assets/js/views/${file}.js`, import.meta.url), 'utf8');
const settings = read('settings'), server = read('server'), parts = read('parts');
const switches = settings.slice(settings.indexOf('function switchList('), settings.indexOf('function showMail('));
const categories = settings.slice(settings.indexOf('const WEBHOOK_EVENTS'), settings.indexOf('function mailsBody('));
const handlers = settings.slice(settings.indexOf("  switchList('[data-hook]'"), settings.indexOf("  $$('[data-mail]')"));
const serverSwitches = server.slice(server.indexOf('function bindSwitches('));
const runner = parts.slice(parts.indexOf('export function commandRunner('), parts.indexOf('/** Ist auf')).replace('export ', '');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const node = (key, value) => ({
  dataset: { [key]: value }, attrs: { 'aria-checked': 'true' },
  getAttribute(key) { return this.attrs[key]; },
  setAttribute(key, value) { this.attrs[key] = value; },
  removeAttribute(key) { delete this.attrs[key]; },
  addEventListener(key, handler) { this[key] = handler; },
});
const compile = async (code, context, minify) => {
  vm.runInContext((await transform(code, { minify, target: 'es2022' })).code, vm.createContext(context));
  return context;
};

async function setup(minify) {
  const hooks = ['ticket', 'billing', 'plan', 'bot', 'account'].map((key) => node('hook', key));
  const prefs = ['billing', 'tickets'].map((key) => node('pref', key));
  const me = { discord_events: '', mail_prefs: {} }, calls = [], errors = [];
  await compile(`${categories}\n${switches}\n${handlers}`, {
    me, $$: (selector) => selector === '[data-hook]' ? hooks : prefs,
    api: (_path, { body }) => new Promise((resolve, reject) => calls.push({ body, resolve, reject })),
    fail: (error) => errors.push(error.message),
  }, minify);
  return { hooks, prefs, me, calls, errors };
}

for (const minify of [false, true]) {
  const variant = minify ? 'production' : 'source';
  test(`webhook switches can disable every category and re-enable exactly one (${variant})`, async () => {
    const ui = await setup(minify);
    for (const hook of ui.hooks) {
      const work = hook.click();
      await settle();
      ui.calls.at(-1).resolve({});
      await work;
    }
    assert.equal(ui.me.discord_events, 'none');
    const work = ui.hooks[3].click();
    await settle();
    assert.equal(ui.calls.at(-1).body.discord_events, 'bot');
    ui.calls.at(-1).resolve({});
    await work;
    assert.equal(ui.me.discord_events, 'bot');
  });

  test(`concurrent mail choices retain both values and recover after a rejected save (${variant})`, async () => {
    for (const rejected of [false, true]) {
      const ui = await setup(minify);
      const first = ui.prefs[0].click(), second = ui.prefs[1].click();
      await settle();
      assert.equal(ui.calls.length, 1);
      if (rejected) ui.calls[0].reject(new Error('Failed'));
      else ui.calls[0].resolve({});
      await first;
      await settle();
      const expected = rejected ? { tickets: false } : { billing: false, tickets: false };
      assert.deepEqual({ ...ui.calls[1].body.mail_prefs }, expected);
      ui.calls[1].resolve({});
      await second;
      assert.deepEqual({ ...ui.me.mail_prefs }, expected);
      assert.equal(ui.prefs[0].getAttribute('aria-checked'), rejected ? 'true' : 'false');
    }
  });

  test(`rapid macro and preference toggles cannot race their own pending save (${variant})`, async () => {
    for (const type of ['macro', 'preference']) {
      const toggle = node('macroToggle', '9');
      const calls = [];
      await compile(type === 'macro' ? `${serverSwitches}\nbindSwitches('all', save);` : `${switches}\nswitchList('all', save);`, {
        $$: () => [toggle], fail() {},
        save: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
      }, minify);
      const work = toggle.click();
      await toggle.click();
      await settle();
      assert.equal(calls.length, 1);
      assert.equal(toggle.getAttribute('aria-checked'), 'false');
      calls[0].reject(new Error('Failed'));
      await work;
      assert.equal(toggle.getAttribute('aria-checked'), 'true');
      const retry = toggle.click();
      await settle();
      assert.equal(calls.length, 2);
      calls[1].resolve(false);
      await retry;
      assert.equal(toggle.getAttribute('aria-checked'), 'false');
    }
  });

  test(`multi-account commands report individual failures and tolerate empty results (${variant})`, async () => {
    const notices = [];
    let results = [{ account_id: 1, ok: true }, { account_id: 2, ok: false, error: 'Offline' }];
    const context = await compile(`${runner}\nglobalThis.run = commandRunner(profile);`, {
      profile: { id: 1, accounts: [{ account_id: 1, name: 'Alice' }, { account_id: 2, name: 'Bob' }] },
      $$: () => [{ dataset: { target: '1' } }, { dataset: { target: '2' } }],
      api: async () => ({ results }), toast: (text) => notices.push(text), tr: String,
      fail: (error) => { throw error; },
    }, minify);
    assert.equal(await context.run('jump'), true);
    assert.deepEqual(notices, ['Bob: Offline']);
    results = [];
    assert.equal(await context.run('jump'), false);
  });
}
