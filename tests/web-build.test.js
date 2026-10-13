// O motor que vai ao navegador (web/js/engine.js) é gerado de engine/index.js. Este teste monta o texto
// gerado em memória, executa-o como o navegador faria e confere que se comporta como o módulo.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../engine/index.js';
import { hashCanonical } from '../lib/canonical.js';
import { snapshotSeries } from '../lib/data/series.js';
import * as regimeViewModule from '../lib/regime-view.js';
import { browserEngineSource, browserRegimeViewSource, browserModuleSource } from '../tools/build-web.mjs';

const h = (v) => hashCanonical(v, { nonFinite: 'tag' });

test('build do navegador: mesmo motor, mesma superfície, mesmo resultado', () => {
  const win = {};
  new Function('window', browserEngineSource())(win);
  const B = win.ArgosEngine;
  assert.deepEqual(Object.keys(B).sort(), Object.keys(engine.default).sort());
  assert.equal(B.VERSION, engine.VERSION);
  const cfg = { mode: 'atr', tgt: 2, stp: 1, hold: 12 };
  const { ms: _a, ...fromBrowser } = B.analyze(snapshotSeries('BTCUSDT', '1d'), { ...cfg }, {});
  const { ms: _b, ...fromModule } = engine.analyze(snapshotSeries('BTCUSDT', '1d'), { ...cfg }, {});
  assert.equal(h(fromBrowser), h(fromModule));
});

test('build do navegador: recorte por regime sai de lib/regime-view.js e dá o mesmo resultado no navegador', () => {
  const win = {};
  new Function('window', browserEngineSource())(win);
  const src = browserRegimeViewSource();
  assert.match(src, /^\/\* ARQUIVO GERADO por tools\/build-web\.mjs/);
  assert.doesNotMatch(src, /^\s*(export|import)\s/m);
  new Function('window', src)(win);
  assert.deepEqual(Object.keys(win.ArgosRegimeView).sort(), ['MIN_EFFECTIVE', 'regimeView']);
  assert.equal(win.ArgosRegimeView.MIN_EFFECTIVE, regimeViewModule.MIN_EFFECTIVE);
  const cfg = { mode: 'atr', tgt: 2, stp: 1, hold: 12 };
  const fromBrowser = win.ArgosRegimeView.regimeView(win.ArgosEngine, win.ArgosEngine.analyze(snapshotSeries('BTCUSDT', '1d'), { ...cfg }, {}));
  const fromModule = regimeViewModule.regimeView(engine, engine.analyze(snapshotSeries('BTCUSDT', '1d'), { ...cfg }, {}));
  assert.equal(h(fromBrowser), h(fromModule));
});

test('build do navegador: módulo de lib/ com import ou export de outro formato é recusado', () => {
  assert.throws(() => browserModuleSource("import x from './x.js';\nexport function f() {}\n", 'lib/x.js', 'X'), /import não é suportado/);
  assert.throws(() => browserModuleSource('function f() {}\nexport { f };\n', 'lib/x.js', 'X'), /use só "export function"/);
  assert.throws(() => browserModuleSource('const a = 1;\n', 'lib/x.js', 'X'), /nenhum export/);
  const w = {};
  new Function('window', browserModuleSource('export const A = 1;\nexport async function g() { return A; }\n', 'lib/x.js', 'X'))(w);
  assert.deepEqual(Object.keys(w.X), ['A', 'g']);
});

test('build do navegador: recusa módulo com export fora do bloco final', () => {
  assert.throws(() => browserEngineSource('export function x() {}\nexport const VERSION = \'v\';\nexport {\n  x\n};\n'), /export ou import fora do bloco final/);
});
