import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/server.js', import.meta.url), 'utf8');
const start = source.indexOf('  let sending = false;');
const sendCode = source.slice(start, source.indexOf("  $('#send').addEventListener", start));
const selection = source.slice(source.indexOf('  let receivers ='), source.indexOf('  const nameOf ='));
const admin = fs.readFileSync(new URL('../public/assets/js/views/admin.js', import.meta.url), 'utf8');
const adminSend = admin.slice(admin.indexOf('async function send('), admin.indexOf('function bindAdminSwitches'));
const compile = async (code, context, minify) => {
  vm.runInContext((await transform(code, { minify, target: 'es2022' })).code, vm.createContext(context));
  return context;
};
async function chat(minify, receivers = [1, 2], sender = '') {
  const input = { value: 'first message' }, button = { disabled: false };
  const requests = [], history = [], writes = [], errors = [];
  let resolve, reject;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const context = await compile(`${sendCode}\nglobalThis.send = send;`, {
    messageInput: input, receivers, profile: { id: 7 }, draftKey: 'draft',
    $: (selector) => selector === '#sender' ? { value: sender } : button,
    api: (path, options) => { requests.push({ path, ...options }); return pending; },
    writeLocal: (...args) => writes.push(args), rememberSent: (text) => history.push(text),
    toast: (text) => errors.push(text), fail: (error) => errors.push(error.message),
    tr: String, nameOf: (id) => `Player ${id}`,
  }, minify);
  return { ...context, input, button, requests, history, writes, errors, resolve, reject };
}

for (const minify of [false, true]) {
  const variant = minify ? 'production' : 'source';
  test(`chat preserves an explicitly empty or stale receiver selection (${variant})`, async () => {
    for (const [stored, expected] of [[null, [1, 2]], ['[]', []], ['[99]', []], ['[2,99]', [2]], ['broken', [1, 2]]]) {
      const boxes = [1, 2].map((id) => ({ dataset: { recv: String(id) }, checked: true }));
      const context = await compile(`${selection}\nglobalThis.receivers = receivers;`, {
        members: [{ account_id: 1 }, { account_id: 2 }], receiverKey: 'receivers',
        $$: () => boxes,
        localStorage: { getItem: () => stored },
      }, minify);
      assert.deepEqual(Array.from(context.receivers), expected);
      assert.deepEqual(boxes.filter((box) => box.checked).map((box) => Number(box.dataset.recv)), expected);
    }
  });

  test(`chat never broadcasts an empty selection and honors an explicit sender (${variant})`, async () => {
    const empty = await chat(minify, []);
    await empty.send();
    assert.equal(empty.requests.length, 0);
    assert.equal(empty.input.value, 'first message');
    assert.equal(empty.errors.length, 1);
    for (const [receivers, sender, expected] of [[[1, 2], '', [1, 2]], [[], '2', [2]]]) {
      const ui = await chat(minify, receivers, sender);
      const work = ui.send();
      assert.deepEqual(Array.from(ui.requests[0].body.accounts), expected);
      ui.resolve({ results: expected.map((account_id) => ({ account_id, ok: true })) });
      await work;
    }
  });

  test(`chat serializes clicks and clears a delivered unchanged draft (${variant})`, async () => {
    const ui = await chat(minify);
    const work = ui.send();
    await ui.send();
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.button.disabled, true);
    ui.resolve({ results: [{ account_id: 1, ok: true }, { account_id: 2, ok: false, error: 'Offline' }] });
    await work;
    assert.equal(ui.input.value, '');
    assert.deepEqual(ui.history, ['first message']);
    assert.deepEqual(ui.errors, ['Player 2: Offline']);
    assert.equal(ui.button.disabled, false);
  });

  test(`late chat success or failure preserves the next draft (${variant})`, async () => {
    for (const outcome of ['success', 'offline', 'network']) {
      const ui = await chat(minify);
      const work = ui.send();
      ui.input.value = 'next message';
      if (outcome === 'network') ui.reject(new Error('Connection lost'));
      else ui.resolve({ results: [{ account_id: 1, ok: outcome === 'success', error: 'Offline' }] });
      await work;
      assert.equal(ui.input.value, 'next message');
      assert.equal(ui.writes.length, 0, 'a late response must not erase the stored next draft');
      assert.equal(ui.button.disabled, false);
    }
  });

  test(`failed chat retains the original text and permits retry (${variant})`, async () => {
    const ui = await chat(minify);
    const work = ui.send();
    ui.resolve({ results: [{ account_id: 1, ok: false, error: 'Offline' }] });
    await work;
    assert.equal(ui.input.value, 'first message');
    assert.deepEqual(ui.history, []);
    await ui.send();
    assert.equal(ui.requests.length, 2);
  });

  test(`admin actions show per-account failures instead of a saved notice (${variant})`, async () => {
    const notices = [];
    const context = await compile(`${adminSend}\nglobalThis.send = send;`, {
      api: async () => ({ ok: false, results: [{ account_id: 2, ok: false, error: 'Sign in again' }] }),
      ok: (text) => notices.push(['ok', text]), toast: (...args) => notices.push(args), tr: String,
      fail: (error) => { throw error; },
    }, minify);
    assert.ok(await context.send('/restart', {}));
    assert.deepEqual(notices, [['2: Sign in again', 'bad']]);
  });
}
