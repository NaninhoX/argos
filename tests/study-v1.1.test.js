// Reprodução do estudo de referência v1.1: o motor, rodando sobre os candles até o corte de 26/09/2026,
// deve chegar aos números publicados na matriz do site (tests/fixtures/study-v1.1-matrix.json), na precisão
// em que foram exibidos, e ao resumo publicado (contagem de vereditos e calibração).
//
// Dados: 4h e 1D vêm do snapshot embutido na demo (histórico completo). 1h vem de data/history/*_1h.json.gz
// (jan/2022 ao corte, baixado da API pública da Binance por tools/fetch-history.mjs); sem esses arquivos,
// as 24 células de 1h e as conferências que dependem dos 72 testes são puladas.
// Se este teste falhar, a diferença se investiga. Não se ajusta o teste.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as engine from '../engine/index.js';
import { loadLegacy, DEFAULT_CFG } from './helpers/legacy.js';

const { snapshot, study } = loadLegacy();
const matrix = JSON.parse(fs.readFileSync(new URL('./fixtures/study-v1.1-matrix.json', import.meta.url), 'utf8'));
const EPS = 1e-9;
const near = (got, shown, halfUnit, what) =>
  assert.ok(Math.abs(got - shown) <= halfUnit + EPS, `${what}: motor ${got} × publicado ${shown}`);

const historyFile = (sym) => new URL(`../data/history/${sym}_1h.json.gz`, import.meta.url);
const hasHistory = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].every((s) => fs.existsSync(historyFile(s)));
const needsHistory = hasHistory ? {} : { skip: 'requer data/history/*_1h.json.gz (node tools/fetch-history.mjs)' };

const analyses = new Map();
function analysisFor(sym, tf) {
  const key = `${sym}_${tf}`;
  if (!analyses.has(key)) {
    const compact = tf === '1h' ? JSON.parse(zlib.gunzipSync(fs.readFileSync(historyFile(sym)))) : snapshot.series[key];
    analyses.set(key, engine.analyze(engine.decodeSnapshot(compact), { ...DEFAULT_CFG }, { sym, tf }));
  }
  return analyses.get(key);
}
const setupFor = (cell) => analysisFor(cell.sym, cell.tf).setups.find((x) => x.id === cell.id);

test('estudo v1.1: fixture tem 72 células e o resumo publicado', () => {
  assert.equal(matrix.cells.length, 72);
  const counts = {};
  for (const c of matrix.cells) counts[c.verdict] = (counts[c.verdict] || 0) + 1;
  assert.deepEqual(counts, study.counts);
});

test('estudo v1.1: histórico de 1h termina igual ao snapshot da demo', needsHistory, () => {
  for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
    const h = engine.decodeSnapshot(JSON.parse(zlib.gunzipSync(fs.readFileSync(historyFile(sym)))));
    const s = engine.decodeSnapshot(snapshot.series[`${sym}_1h`]);
    const off = h.n - s.n;
    assert.ok(off > 0);
    for (let i = 0; i < s.n; i++) {
      const j = i + off;
      assert.ok(h.t[j] === s.t[i] && h.o[j] === s.o[i] && h.h[j] === s.h[i] && h.l[j] === s.l[i] && h.c[j] === s.c[i], `${sym} candle ${i}`);
    }
  }
});

let checked = 0;
for (const cell of matrix.cells) {
  const opts = cell.tf === '1h' ? needsHistory : {};
  test(`estudo v1.1 · ${cell.sym} ${cell.tf} · ${cell.id}`, opts, () => {
    const s = setupFor(cell);
    assert.equal(s.n, cell.n, 'gatilhos com desfecho');
    assert.equal(s.nEff, cell.nEff, 'N efetivo');
    near(s.winRate, cell.winRate, 0.0005, 'taxa de acerto');
    near(s.ci[0], cell.ci[0], 0.0005, 'IC inferior');
    near(s.ci[1], cell.ci[1], 0.0005, 'IC superior');
    near(s.base, cell.base, 0.0005, 'taxa-base');
    if (cell.pIsUpperBound) assert.ok(s.pTwo < cell.p + EPS, `p: motor ${s.pTwo} × publicado < ${cell.p}`);
    else near(s.pTwo, cell.p, 0.0005, 'p bruto');
    checked++;
  });
}

test('estudo v1.1: células conferidas contra a matriz publicada', () => {
  assert.equal(checked, hasHistory ? 72 : 48);
});

test('estudo v1.1: p ajustado (Benjamini-Hochberg sobre os 72 testes) e veredito de cada célula', needsHistory, () => {
  const family = engine.applyFamily(matrix.cells.map((cell) => ({ ...setupFor(cell) })));
  const counts = {};
  family.forEach((s, k) => {
    const cell = matrix.cells[k], where = `${cell.sym} ${cell.tf} ${cell.id}`;
    assert.equal(s.family, 72);
    if (cell.qIsUpperBound) assert.ok(s.q < cell.q + EPS, `${where} q: motor ${s.q} × publicado < ${cell.q}`);
    else near(s.q, cell.q, 0.0005, `${where} p ajustado`);
    assert.equal(s.verdict.key, cell.verdict, `${where} veredito`);
    counts[s.verdict.key] = (counts[s.verdict.key] || 0) + 1;
  });
  assert.deepEqual(counts, study.counts);
});

test('estudo v1.1: calibração agregada das 9 séries (N, Brier, referência, BSS, ECE)', needsHistory, () => {
  const preds = [];
  for (const key of Object.keys(snapshot.series)) {
    const [sym, tf] = key.split('_');
    for (const p of analysisFor(sym, tf).preds) preds.push(p);
  }
  const c = engine.calibSummary(preds, null);
  assert.equal(c.n, study.calib.n);
  near(c.brier, study.calib.brier, 1e-9, 'Brier');
  near(c.brierRef, study.calib.ref, 1e-9, 'Brier de referência');
  near(c.bss, study.calib.bss, 1e-9, 'BSS');
  near(c.ece, study.calib.ece, 1e-9, 'ECE');
});
