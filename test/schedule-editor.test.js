import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/server.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function edit(entry)', source.indexOf('async function tabSchedule('));
const edit = source.slice(start, source.indexOf('  function bind()', start));
const time = source.slice(source.indexOf('const WEEK_ORDER'), source.indexOf('async function tabSchedule('));
const accounts = source.slice(source.indexOf('function automationAccounts('), source.indexOf('async function editSpam('));
const togglesStart = source.indexOf("    $$('[data-sch-toggle]').forEach");
const toggles = source.slice(togglesStart, source.indexOf('\n  }', togglesStart));
const compile = async (code, context, minify) => {
  vm.runInContext((await transform(code, { minify, target: 'es2022' })).code, vm.createContext(context));
  return context;
};
const element = () => ({
  value: '', disabled: false, dataset: {}, attrs: {},
  addEventListener(key, handler) { this[key] = handler; },
  getAttribute(key) { return this.attrs[key]; },
  setAttribute(key, value) { this.attrs[key] = value; },
  removeAttribute(key) { delete this.attrs[key]; },
});
const sample = { id: 4, account_id: 99, action: 'restart', minutes: 18 * 60 + 3, days: [1], note: 'Keep this note', active: true };

async function setup(minify, entry = sample) {
  const fields = new Map(), dayButtons = [];
  const form = element(), save = { value: 'ok', disabled: false };
  let closed = 0, rendered = 0;
  const dialog = {
    ...element(), showModal() {}, remove() {},
    close() { closed++; this.closedEvent?.(); },
    querySelector: (selector) => selector === 'form' ? form : fields.get(selector),
    querySelectorAll: () => dayButtons,
  };
  dialog.addEventListener = (key, handler) => { dialog[key === 'close' ? 'closedEvent' : key] = handler; };
  Object.defineProperty(dialog, 'innerHTML', { set(html) {
    for (const match of html.matchAll(/<(select|input)\b([^>]*)>(?:([\s\S]*?)<\/select>)?/g)) {
      const id = match[2].match(/\bid="([^"]+)"/)?.[1];
      if (!id) continue;
      const node = element();
      node.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || '';
      if (match[1] === 'select') {
        const options = [...match[3].matchAll(/<option\b([^>]*)>/g)];
        const selected = options.find(([_, attrs]) => /\bselected\b/.test(attrs)) || options[0];
        node.value = selected?.[1].match(/\bvalue="([^"]*)"/)?.[1] || '';
      }
      fields.set(`#${id}`, node);
    }
    fields.set('#sch-preflight', { querySelector: () => ({ textContent: '' }) });
    for (const match of html.matchAll(/data-day="(\d+)"/g)) {
      const node = element(); node.dataset.day = match[1]; dayButtons.push(node);
    }
  } });
  const calls = [], errors = [], data = { schedules: entry ? [entry] : [] };
  const context = await compile(`${accounts}\n${time}\n${edit}\nglobalThis.edit = edit;`, {
    document: { createElement: () => dialog, body: { append() {} } },
    profile: { id: 7, accounts: [{ account_id: 1, name: 'Alice' }, { account_id: 2, name: 'Bob' }] },
    data, locale: 'en', escapeHtml: String, accountLabel: (member) => member.name, tr: String, icon: () => '',
    toast: (text) => errors.push(text), fail: (error) => errors.push(error.message), ok() {},
    paint: () => { rendered++; },
    api: (path, options) => new Promise((resolve, reject) => calls.push({ path, ...options, resolve, reject })),
  }, minify);
  context.edit(entry);
  const submit = async () => {
    let prevented = false;
    await form.submit({ submitter: save, preventDefault() { prevented = true; } });
    if (!prevented) dialog.close();
  };
  return { fields, dayButtons, calls, errors, dialog, submit, save, data, closed: () => closed, rendered: () => rendered };
}

for (const minify of [false, true]) {
  const variant = minify ? 'production' : 'source';
  test(`editing a detached schedule never broadens its account selection (${variant})`, async () => {
    const ui = await setup(minify);
    assert.equal(ui.fields.get('#sch-account').value, '99');
    assert.equal(ui.fields.get('#sch-minute').value, '3');
    const work = ui.submit();
    assert.equal(ui.calls[0].body.account_id, 99);
    ui.calls[0].reject(new Error('Account no longer assigned'));
    await work;
    assert.equal(ui.closed(), 0);
    assert.equal(ui.fields.get('#sch-note').value, 'Keep this note');
    assert.equal(ui.save.disabled, false);
  });

  test(`invalid weekdays and failed saves keep the schedule dialog editable (${variant})`, async () => {
    const ui = await setup(minify);
    const monday = ui.dayButtons.find((node) => node.dataset.day === '1');
    monday.click();
    await ui.submit();
    assert.equal(ui.calls.length, 0);
    assert.equal(ui.closed(), 0);
    assert.deepEqual(ui.errors, ['sch.daysBad']);
    monday.click();
    const work = ui.submit();
    await ui.submit();
    assert.equal(ui.calls.length, 1);
    ui.calls[0].reject(new Error('Network failed'));
    await work;
    assert.equal(ui.closed(), 0);
    const retry = ui.submit();
    ui.calls[1].resolve({ schedule: sample });
    await retry;
    assert.equal(ui.closed(), 1);
    assert.equal(ui.data.schedules.length, 1);
  });

  test(`creating a schedule uses its save response without a fallible reload (${variant})`, async () => {
    const ui = await setup(minify, null);
    const work = ui.submit();
    assert.equal(ui.calls[0].method, 'POST');
    ui.calls[0].resolve({ schedule: { ...sample, account_id: null } });
    await work;
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.closed(), 1);
    assert.equal(ui.data.schedules.length, 1);
    assert.equal(ui.rendered(), 1);
  });

  test(`schedule toggles update the next run from the server and serialize clicks (${variant})`, async () => {
    const node = element(); node.dataset.schToggle = '4';
    const entry = { ...sample, next_at: 1000 }, calls = [];
    await compile(toggles, {
      $$: () => [node], data: { schedules: [entry] }, profile: { id: 7 }, paint() {}, fail() {},
      api: (_path, options) => new Promise((resolve) => calls.push({ ...options, resolve })),
    }, minify);
    const first = node.click();
    await node.click();
    assert.equal(calls.length, 1);
    calls[0].resolve({ schedule: { ...sample, active: false, next_at: null } });
    await first;
    assert.equal(entry.next_at, null);
    const second = node.click();
    calls[1].resolve({ schedule: { ...sample, active: true, next_at: 2000 } });
    await second;
    assert.equal(entry.next_at, 2000);
  });
}
