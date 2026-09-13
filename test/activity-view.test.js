import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/activity.js', import.meta.url), 'utf8');
const view = source.slice(source.indexOf('export async function render')).replace('export ', '');
const notification = (id, event = 'bot') => ({ id, event, title: `Message ${id}`, body: '', created_at: 1, read_at: null });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function setup(minify) {
  const nodes = new Map();
  const element = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', isConnected: true, disabled: false,
      addEventListener(event, handler) { this[event] = handler; },
    });
    return nodes.get(selector);
  };
  const state = { stats: { notifications_unread: 1 } };
  const calls = [];
  let request = async (_path, options) => ({ unread: options?.body?.unread ? 1 : 0 });
  const context = vm.createContext({
    state, root: { innerHTML: '' },
    api: async (path, options) => {
      calls.push({ path, options });
      if (calls.length === 1) return { notifications: [notification(1)], unread: 1, has_more: true };
      return request(path, options);
    },
    $: element, appbar: () => '', icon: () => '', escapeHtml: String, tr: (key) => key,
    datetime: String, safeLink: String, DAY_HEADING: { format: () => 'Today' }, EVENT_ICONS: {},
    updateShellBadges: () => {}, ok: () => {}, fail: (error) => { throw error; },
    confirmDialog: async () => true,
  });
  const { code } = await transform(`${view}\nglobalThis.renderActivity = render;`, { loader: 'js', minify, target: 'es2022' });
  vm.runInContext(code, context);
  await vm.runInContext('renderActivity(root)', context);
  return { nodes, state, calls, respond: (handler) => { request = handler; } };
}

for (const minify of [false, true]) {
  const variant = minify ? 'production' : 'source';
  test(`activity actions follow read/unread changes (${variant})`, async () => {
    const { nodes } = await setup(minify);
    assert.equal(nodes.get('#clear-read').disabled, true);
    await nodes.get('#read-all').click();
    assert.equal(nodes.get('#read-all').disabled, true);
    assert.equal(nodes.get('#clear-read').disabled, false, 'newly read messages can be cleared immediately');
    nodes.get('#activity-list').click({
      preventDefault() {},
      target: { closest: (selector) => selector === '[data-unread]' ? { dataset: { unread: '1' } } : null },
    });
    await settle();
    assert.equal(nodes.get('#read-all').disabled, false, 'marking unread re-enables mark all');
    assert.equal(nodes.get('#clear-read').disabled, true);
  });

  test(`activity keeps the latest filter when requests finish out of order (${variant})`, async () => {
    const { nodes, calls, respond } = await setup(minify);
    const first = deferred();
    const second = deferred();
    respond((path) => path.includes('event=bot') ? first.promise : second.promise);
    const filter = nodes.get('#activity-event');
    const firstChange = filter.change({ target: { value: 'bot' } });
    const secondChange = filter.change({ target: { value: 'billing' } });
    assert.equal(calls.length, 3, 'the latest filter must start its own request');
    second.resolve({ notifications: [notification(22, 'billing')], unread: 1, has_more: false });
    await secondChange;
    first.resolve({ notifications: [notification(11)], unread: 1, has_more: true });
    await firstChange;
    assert.match(nodes.get('#activity-list').innerHTML, /Message 22/);
    assert.doesNotMatch(nodes.get('#activity-list').innerHTML, /Message 11/);
    assert.doesNotMatch(nodes.get('#activity-more').innerHTML, /id="activity-load"/);
  });

  test(`activity ignores page responses after navigating away (${variant})`, async () => {
    const { nodes, respond } = await setup(minify);
    const response = deferred();
    respond(() => response.promise);
    const pending = nodes.get('#activity-event').change({ target: { value: 'bot' } });
    const list = nodes.get('#activity-list');
    const before = list.innerHTML;
    list.isConnected = false;
    response.resolve({ notifications: [notification(99)], unread: 1 });
    await pending;
    assert.equal(list.innerHTML, before);
  });
}
