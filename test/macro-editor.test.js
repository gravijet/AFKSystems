import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/server.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function automationAccounts('), source.indexOf('// ---------------------------------------------------------------- Bewegung'));
const editor = source.slice(source.indexOf('async function editMacro('), source.indexOf('// ---------------------------------------------------------------- Tarif'));

function harness() {
  const controls = new Map();
  const element = (attrs = {}) => ({ ...attrs, handlers: {},
    addEventListener(event, handler) { this.handlers[event] = handler; },
    focus() {}, close() {}, showModal() {}, remove() {},
  });
  const attributes = (tag) => {
    const out = {};
    for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g)) out[match[1]] = match[2];
    return out;
  };
  const parse = (html) => {
    for (const key of [...controls.keys()]) if (!['#editor', '#save', '#cancel'].includes(key)) controls.delete(key);
    for (const match of html.matchAll(/<(select)\b([^>]*)>([\s\S]*?)<\/select>|<(input|button)\b([^>]*)>/g)) {
      const kind = match[1] || match[4];
      const tag = match[2] || match[5];
      const attrs = attributes(tag);
      const node = element({ value: attrs.value || '', type: attrs.type || kind, checked: /\bchecked\b/.test(tag), dataset: {} });
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) {
        node.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
      if (kind === 'select') {
        const options = [...(match[3] || '').matchAll(/<option\b([^>]*)>/g)];
        const selected = options.find((entry) => /\bselected\b/.test(entry[1])) || options[0];
        node.value = selected ? attributes(selected[1]).value : '';
      }
      // Boolean data attributes have no value in the editor's markup.
      if (/\bdata-macro-account\b/.test(tag)) node.dataset.macroAccount = '';
      controls.set(attrs.id ? `#${attrs.id}` : `node${controls.size}`, node);
    }
  };
  const area = element();
  Object.defineProperty(area, 'innerHTML', { set: parse });
  controls.set('#editor', area);
  controls.set('#save', element());
  controls.set('#cancel', element());
  const dialog = element();
  const selectAll = (selector) => {
    const key = selector.slice(1, -1).slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return [...controls.values()].filter((node) => Object.hasOwn(node.dataset || {}, key));
  };
  const calls = [];
  const context = vm.createContext({
    document: { createElement: () => dialog, body: { append() {} } },
    $: (selector) => controls.get(selector), $$: selectAll,
    state: { meta: {
      events: [{ type: 'chat', label: 'Chat', config: [{ key: 'contains', label: 'Contains', type: 'text' }] }, { type: 'join', label: 'Join', config: [] }],
      actions: [{ type: 'chat', label: 'Chat', fields: [{ key: 'text', type: 'text', label: 'Text' }] }],
    } },
    structuredClone, requestAnimationFrame: () => {}, escapeHtml: String, tr: (key) => key,
    icon: () => '', accountLabel: (member) => member.name, ok() {}, draw() {}, fail(error) { throw error; },
    api: async (url, request) => { calls.push({ url, ...JSON.parse(JSON.stringify(request)) }); },
    formDialog: async (_title, fields) => Object.fromEntries(fields.filter((field) => field.key).map((field) => [field.key, field.value])),
  });
  return { controls, selectAll, calls, context };
}

for (const minify of [false, true]) {
  const label = minify ? 'production' : 'source';
  const { code } = await transform(`${helpers}\n${editor}\nglobalThis.edit = editMacro; globalThis.spam = editSpam;`, { minify, target: 'es2022' });
  const profile = { id: 1, caps: {}, accounts: [1, 2, 3].map((id) => ({ account_id: id, name: `Bot${id}` })) };
  const draft = { id: 1, name: 'Old', event: 'chat', config: { contains: 'old' }, accounts: [1, 2], actions: [{ type: 'chat', text: '/afk' }] };

  test(`macro editor preserves multi-account selection and all fields when steps change (${label})`, async () => {
    const h = harness(); vm.runInContext(code, h.context);
    await h.context.edit(profile, draft);
    assert.equal(h.selectAll('[data-macro-account]').filter((node) => node.checked).length, 2);
    h.controls.get('#name').value = 'Changed';
    h.controls.get('#cooldown').value = '120';
    h.controls.get('#chance').value = '75';
    h.selectAll('[data-config]')[0].value = 'new trigger';
    const boxes = h.selectAll('[data-macro-account]'); boxes[0].checked = false; boxes[2].checked = true;
    h.controls.get('#add-step').handlers.click();
    assert.equal(h.controls.get('#name').value, 'Changed');
    assert.equal(h.controls.get('#cooldown').value, '120');
    assert.equal(h.selectAll('[data-config]')[0].value, 'new trigger');
    h.selectAll('[data-up]')[1].handlers.click();
    await h.controls.get('#save').handlers.click();
    assert.deepEqual(h.calls[0].body.accounts, [2, 3]);
    assert.equal(h.calls[0].body.name, 'Changed');
    assert.equal(h.calls[0].body.cooldown_sec, 120);
    assert.equal(h.calls[0].body.chance, 75);
    assert.equal(h.calls[0].body.config.contains, 'new trigger');
  });

  test(`macro editor keeps detached targets and serializes saving (${label})`, async () => {
    const h = harness(); vm.runInContext(code, h.context);
    let finish;
    h.context.api = async () => { h.calls.push(1); await new Promise((resolve) => { finish = resolve; }); };
    await h.context.edit(profile, { ...draft, accounts: [2, 99] });
    assert.deepEqual(h.selectAll('[data-macro-account]').filter((node) => node.checked).map((node) => Number(node.value)), [2, 99]);
    const first = h.controls.get('#save').handlers.click();
    await h.controls.get('#save').handlers.click();
    assert.equal(h.calls.length, 1);
    finish(); await first;
  });

  test(`repeated messages retain all explicit targets and the all-accounts default (${label})`, async () => {
    const h = harness(); vm.runInContext(code, h.context);
    for (const accounts of [[1, 2], [2, 99], []]) {
      await h.context.spam(profile, profile.accounts, { id: 5, message: '/afk', interval_sec: 30, accounts });
      assert.deepEqual(h.calls.at(-1).body.accounts, accounts);
    }
  });
}
