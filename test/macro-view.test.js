import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/views/server.js', import.meta.url), 'utf8');
const view = source.slice(source.indexOf('async function tabMacros('), source.indexOf('/** Vorlagen wählen'));

for (const minify of [false, true]) {
  test(`macro cards render named actions and bind controls (${minify ? 'production' : 'source'})`, async () => {
    const root = { innerHTML: '' };
    const controls = new Map();
    const element = (selector) => {
      if (!controls.has(selector)) controls.set(selector, { addEventListener: (event, handler) => {
        controls.get(selector)[event] = handler;
      } });
      return controls.get(selector);
    };
    const context = vm.createContext({
      root,
      profile: { id: 1, accounts: [] },
      api: async () => ({ macros: [{
        id: 1, name: 'Wiederverbinden', event: 'join', config: {}, accounts: [],
        actions: [{ type: 'reconnect' }, { type: 'jump' }], enabled: true, chance: 100,
      }] }),
      state: { meta: {
        events: [{ type: 'join', label: 'Beim Beitritt' }],
        actions: [{ type: 'reconnect', label: 'Neu verbinden' }, { type: 'jump', label: 'Springen' }],
      } },
      escapeHtml: (value) => String(value), tr: (key) => key, icon: () => '',
      $: element, $$: () => [], bindSwitches: () => {},
    });
    const { code } = await transform(`${view}\nglobalThis.renderMacros = tabMacros;`, {
      loader: 'js', minify, target: 'es2022',
    });
    vm.runInContext(code, context);
    await vm.runInContext('renderMacros(root, profile)', context);
    assert.match(root.innerHTML, /Neu verbinden → Springen/);
    assert.match(root.innerHTML, /data-macro-edit="1"/);
    assert.equal(typeof controls.get('#add-macro').click, 'function');
    assert.equal(typeof controls.get('#macro-templates').click, 'function');
  });
}
