import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/tickets.js', import.meta.url), 'utf8');
const start = source.indexOf('  let sending = false;');
const code = source.slice(start, source.indexOf("  $('#send').addEventListener", start));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const success = { messages: [{ id: 2 }], ticket: { status: 'open' }, reads: [] };
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function setup(minify, refreshFails = false) {
  const upload = deferred(), response = deferred();
  const input = { value: 'Original answer' }, button = { disabled: false };
  const file = { name: 'first.png' }, extra = { name: 'second.png' };
  const requests = [], stored = [], errors = [];
  const context = vm.createContext({
    input, file, extra, id: 1, staff: false, messages: [{ id: 1 }], ticket: {}, reads: [],
    $: () => button,
    uploadFiles: () => upload.promise,
    api: (path, options) => { requests.push(options.body); return response.promise; },
    refresh: async () => { if (refreshFails) throw new Error('Refresh failed'); },
    setStoredDraft: (text) => stored.push(text), fail: (error) => errors.push(error.message),
    mergeMessages() {}, paintDraft() {}, paintPending() {}, paint() {}, paintReads() {}, paintStatus() {},
  });
  vm.runInContext((await transform(`let pending = [file];\n${code}
    globalThis.send = send;
    globalThis.addFile = () => pending.push(extra);
    globalThis.files = () => pending.map(file => file.name);`, { minify, target: 'es2022' })).code, context);
  return { ...context, input, button, upload, response, requests, stored, errors };
}

for (const minify of [false, true]) {
  const variant = minify ? 'production' : 'source';
  test(`ticket upload or reply failure preserves new text and added files (${variant})`, async () => {
    for (const stage of ['upload', 'reply']) {
      const ui = await setup(minify);
      const work = ui.send();
      ui.input.value = 'Next draft';
      ui.addFile();
      if (stage === 'upload') ui.upload.reject(new Error('Upload failed'));
      else {
        ui.upload.resolve([7]);
        await settle();
        ui.response.reject(new Error('Reply failed'));
      }
      await work;
      assert.equal(ui.input.value, 'Next draft');
      assert.deepEqual(Array.from(ui.files()), ['first.png', 'second.png']);
      assert.equal(ui.button.disabled, false);
    }
  });

  test(`late ticket success preserves the next stored draft and its attachment (${variant})`, async () => {
    const ui = await setup(minify);
    const work = ui.send();
    ui.upload.resolve([7]);
    await settle();
    ui.input.value = 'Next draft';
    ui.addFile();
    ui.response.resolve(success);
    await work;
    assert.equal(ui.requests[0].body, 'Original answer');
    assert.equal(ui.input.value, 'Next draft');
    assert.deepEqual(ui.stored, ['Next draft']);
    assert.deepEqual(Array.from(ui.files()), ['second.png']);
  });

  test(`refresh failure cannot restore a sent ticket answer for duplicate submission (${variant})`, async () => {
    const ui = await setup(minify, true);
    const work = ui.send();
    ui.upload.resolve([7]);
    await settle();
    ui.response.resolve(success);
    await work;
    assert.equal(ui.input.value, '');
    assert.deepEqual(Array.from(ui.files()), []);
    await ui.send();
    assert.equal(ui.requests.length, 1);
    assert.deepEqual(ui.errors, ['Refresh failed']);
  });

  test(`ticket send is single-flight and retains the original draft on failure (${variant})`, async () => {
    const ui = await setup(minify);
    const work = ui.send();
    await ui.send(true);
    assert.equal(ui.button.disabled, true);
    ui.upload.resolve([7]);
    await settle();
    assert.equal(ui.requests.length, 1);
    ui.response.reject(new Error('Reply failed'));
    await work;
    assert.equal(ui.input.value, 'Original answer');
    assert.deepEqual(Array.from(ui.files()), ['first.png']);
  });
}
