// O motor que vai ao navegador (web/js/engine.js) é gerado de engine/index.js. Este teste monta o texto
// gerado em memória, executa-o como o navegador faria e confere que se comporta como o módulo.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../engine/index.js';
import { hashCanonical } from '../lib/canonical.js';
import { snapshotSeries } from '../lib/data/series.js';
import { createHash } from 'node:crypto';
import * as regimeViewModule from '../lib/regime-view.js';
import * as pineReaderModule from '../lib/pine-reader.js';
import { summarize, seriesHash } from '../lib/analysis-summary.js';
import { canonicalize } from '../lib/canonical.js';
import { browserEngineSource, browserRegimeViewSource, browserPineReaderSource, browserSummarySource, browserModuleSource, buildWeb } from '../tools/build-web.mjs';

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

test('build do navegador: leitor de Pine sai de lib/pine-reader.js e lê igual ao módulo', () => {
  const src = browserPineReaderSource();
  assert.match(src, /^\/\* ARQUIVO GERADO por tools\/build-web\.mjs/);
  assert.doesNotMatch(src, /^\s*(export|import)\s/m);
  const win = {};
  new Function('window', src)(win);
  assert.deepEqual(Object.keys(win.ArgosPineReader).sort(), Object.keys(pineReaderModule).sort());
  for (const ex of pineReaderModule.PINE_EXAMPLES) {
    assert.equal(h(win.ArgosPineReader.readPine(ex.code)), h(pineReaderModule.readPine(ex.code)), ex.id);
  }
  for (const bad of ['', '<script>1</script>', 'indicator("x")\nalertcondition(close > ta.atr(14))']) {
    assert.equal(h(win.ArgosPineReader.readPine(bad)), h(pineReaderModule.readPine(bad)));
  }
});

test('build do navegador: SHA-256 em JS puro bate com node:crypto (tamanhos de borda e UTF-8)', () => {
  const win = {};
  new Function('window', browserEngineSource())(win);
  new Function('window', browserSummarySource())(win);
  const lens = [0, 1, 3, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 100_003];
  for (const n of lens) {
    const t = 'aé📈'.repeat(Math.ceil(n / 3)).slice(0, n);
    assert.equal(win.ArgosSummary.sha256Hex(t), createHash('sha256').update(t).digest('hex'), `texto de ${n} caracteres`);
  }
  const bytes = new Uint8Array(70_000).map((_, i) => (i * 31 + 7) & 255);
  assert.equal(win.ArgosSummary.sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'));
});

test('build do navegador: resumo e resultHash do navegador são idênticos aos do servidor (lib/analysis-summary.js)', () => {
  const src = browserSummarySource();
  assert.match(src, /^\/\* ARQUIVO GERADO por tools\/build-web\.mjs/);
  assert.doesNotMatch(src, /^\s*(export|import)\s/m);
  assert.doesNotMatch(src, /node:crypto/);
  const win = {};
  new Function('window', browserEngineSource())(win);
  new Function('window', src)(win);
  assert.deepEqual(Object.keys(win.ArgosSummary).sort(), ['canonicalize', 'hashCanonical', 'seriesHash', 'sha256Hex', 'summarize', 'withProvenance']);
  const cases = [
    { sym: 'BTCUSDT', tf: '1d', cfg: { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, windowDays: null },
    { sym: 'ETHUSDT', tf: '4h', cfg: { mode: 'pct', tgt: 3, stp: 1.5, hold: 7 }, windowDays: 365 },
    { sym: 'SOLUSDT', tf: '1h', cfg: { mode: 'atr', tgt: 1.5, stp: 1, hold: 24 }, windowDays: null }
  ];
  for (const c of cases) {
    const full = snapshotSeries(c.sym, c.tf);
    const d = c.windowDays ? engine.sliceSeries(full, Math.round((c.windowDays * 86400) / full.dt) + 200) : full;
    const ctx = { symbol: c.sym, timeframe: c.tf, source: 'snapshot', windowDays: c.windowDays };
    const fromModule = summarize(engine.analyze(d, { ...c.cfg }, {}), ctx);
    const A = win.ArgosEngine.analyze(d, { ...c.cfg }, {});
    const fromBrowser = win.ArgosSummary.summarize(A, ctx);
    assert.equal(fromBrowser.data.hash, fromModule.data.hash, `${c.sym} ${c.tf}: hash da série`);
    assert.equal(win.ArgosSummary.seriesHash(d), seriesHash(d));
    assert.equal(fromBrowser.resultHash, fromModule.resultHash, `${c.sym} ${c.tf}: resultHash`);
    assert.equal(canonicalize(fromBrowser, { nonFinite: 'null' }), canonicalize(fromModule, { nonFinite: 'null' }), `${c.sym} ${c.tf}: resumo inteiro`);
  }
});

test('build do navegador: buildWeb lista os arquivos gerados, incluindo o leitor de Pine e o resumo', () => {
  const out = buildWeb();
  for (const f of ['js/engine.js', 'js/regime-view.js', 'js/pine-reader.js', 'js/analysis-summary.js', 'data/snapshot/BTCUSDT_4h.js', 'data/snapshot/SOLUSDT_1d.js', 'data/study.js']) assert.ok(out.includes(f), f);
});

test('build do navegador: import inesperado em lib/analysis-summary.js é recusado, não ignorado', () => {
  const canonical = "import { createHash } from 'node:crypto';\nexport function canonicalize() {}\nexport function sha256Hex() {}\n";
  assert.throws(() => browserSummarySource(canonical, "import x from './y.js';\nexport function summarize() {}\n"), /import esperada/);
  assert.throws(() => browserSummarySource("export function canonicalize() {}\n", 'export function summarize() {}\n'), /import esperada/);
});
