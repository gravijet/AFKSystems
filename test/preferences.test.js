import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../public/assets/js/preferences.js', import.meta.url), 'utf8');

for (const minify of [false, true]) {
  for (const blockedReads of [false, true]) {
    test(`display choices survive unavailable storage (${minify ? 'production' : 'source'}, reads ${blockedReads ? 'blocked' : 'allowed'})`, async () => {
      const dataset = {};
      const stored = new Map([['afk-preferences-1', '{"v":2,"density":"comfortable"}']]);
      let writable = false;
      const context = vm.createContext({
        localStorage: {
          getItem(key) {
            if (blockedReads) throw new Error('Storage blocked');
            return stored.get(key) || null;
          },
          setItem(key, value) {
            if (!writable) throw new Error('Quota exceeded');
            stored.set(key, value);
          },
        },
        document: { documentElement: { dataset, removeAttribute() { delete dataset.motion; } } },
        window: { dispatchEvent() {} }, CustomEvent: class {},
      });
      const { code } = await transform(source, { format: 'iife', globalName: 'prefs', minify, target: 'es2022' });
      vm.runInContext(code, context);
      const { prefs } = context;
      prefs.setPreference(1, 'motion', 'reduced');
      assert.equal(dataset.motion, 'reduced');
      prefs.setPreference(1, 'density', 'comfortable');
      assert.equal(dataset.density, 'comfortable');
      assert.equal(prefs.preferences(1).motion, 'reduced');
      assert.equal(prefs.toggleFavoriteServer(1, 42), true);
      assert.equal(prefs.isFavoriteServer(1, 42), true);
      assert.equal(prefs.toggleFavoriteServer(1, 42), false);
      assert.equal(prefs.preferences(2).motion, 'system', 'fallback stays scoped to the account');
      writable = true;
      prefs.setPreference(1, 'start', 'last');
      assert.equal(prefs.preferences(1).motion, 'reduced', 'recovering storage retains earlier choices');
      assert.equal(JSON.parse(stored.get('afk-preferences-1')).motion, 'reduced');
      if (!blockedReads) {
        stored.set('afk-preferences-1', '{"v":2,"motion":"system"}');
        assert.equal(prefs.preferences(1).motion, 'system', 'successful reads pick up changes from other tabs');
      }
    });
  }
}
