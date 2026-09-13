import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/tickets.js', import.meta.url), 'utf8');
const live = source.slice(source.indexOf('  const mergeMessages ='), source.lastIndexOf('\n}'));
const event = { type: 'ticket', event: 'message', message: { ticket_id: 1, audience: { customer: true } } };
const page = (ids, more = false) => ({ messages: ids.map((id) => ({ id })), ticket: { status: 'answered' }, reads: [], has_more: more });

async function setup(minify, request) {
  let paints = 0;
  const calls = [];
  const state = { me: { id: 1 } };
  const thread = { isConnected: true };
  const context = vm.createContext({
    state, thread, id: 1, staff: false, base: '/tickets/1',
    api: (path) => { calls.push(path); return request(path); },
    paint() { paints++; }, paintReads() {}, paintTyping() {}, paintStatus() {},
  });
  const { code } = await transform(`
    let messages = [{ id: 1 }], reads = [];
    const ticket = {}, typers = new Map();
    ${live}
    globalThis.messageIds = () => messages.map(message => message.id).join(',');
  `, { minify, target: 'es2022' });
  vm.runInContext(code, context);
  return { state, calls, thread, ids: context.messageIds, paints: () => paints };
}

for (const minify of [false, true]) {
  const variant = minify ? 'production' : 'source';
  test(`ticket live updates load every pending page (${variant})`, async () => {
    const { state, calls, ids } = await setup(minify, async (path) =>
      path.endsWith('since=1') ? page([2, 3], true) : page([4]));
    await state.onLive(event);
    assert.equal(ids(), '1,2,3,4');
    assert.deepEqual(calls, ['/tickets/1/messages?since=1', '/tickets/1/messages?since=3']);
  });

  test(`ticket live requests share a queue and preserve events during loading (${variant})`, async () => {
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const { state, calls, ids } = await setup(minify, async (path) =>
      path.endsWith('since=1') ? pending : page([3]));
    const first = state.onLive(event);
    const second = state.onLive(event);
    assert.equal(calls.length, 1, 'one request at a time');
    resolve(page([2]));
    await Promise.all([first, second]);
    assert.equal(ids(), '1,2,3');
    assert.equal(calls.length, 2, 'the event during loading triggers another fetch');
  });

  test(`ticket live replies cannot paint after navigation (${variant})`, async () => {
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const { state, thread, ids, paints } = await setup(minify, () => pending);
    const first = state.onLive(event);
    thread.isConnected = false;
    resolve(page([2]));
    await first;
    assert.equal(ids(), '1');
    assert.equal(paints(), 0);
  });
}
