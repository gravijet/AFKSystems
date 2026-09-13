import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/overview.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function render');
const loading = source.slice(start, source.indexOf('  root.innerHTML =', start)).replace('export ', '');

for (const minify of [false, true]) {
  test(`returning to the overview refreshes its cached charts and activity (${minify ? 'production' : 'source'})`, async () => {
    const calls = [];
    let showingOverview = false;
    const context = vm.createContext({
      state: { bots: new Map(), profiles: [], me: { credits: 0 }, todos: [] },
      stopPovThumbnails() {},
      root: { querySelector: () => showingOverview ? {} : null },
      api: async (path) => { calls.push(path); return {}; },
    });
    const { code } = await transform(`let insights = null, notificationPreview = null;
      ${loading}}
      globalThis.loadOverview = render;
    `, { minify, target: 'es2022' });
    vm.runInContext(code, context);
    await context.loadOverview(context.root);
    assert.equal(calls.length, 2);
    showingOverview = true;
    await context.loadOverview(context.root);
    assert.equal(calls.length, 2, 'bot redraws keep cached analytics');
    showingOverview = false;
    await context.loadOverview(context.root);
    assert.equal(calls.length, 4, 'reopening after another page fetches current values');
  });
}
