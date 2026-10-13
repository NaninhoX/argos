// A previsão prospectiva usa a mesma conta da calibração prequencial do motor. Este teste é a prova:
// para todo gatilho já encerrado, probabilityAt devolve exatamente o p e o r de A.preds.
import test from 'node:test';
import assert from 'node:assert/strict';

import { analyze } from '../engine/index.js';
import { snapshotSeries } from '../lib/data/series.js';
import { openPredictions, probabilityAt } from '../lib/prospective.js';

const CFG = { mode: 'atr', tgt: 2, stp: 1, hold: 12 };
const run = (symbol, tf, d = snapshotSeries(symbol, tf)) => analyze(d, { ...CFG }, { sym: symbol, tf, source: 'snapshot', win: null });

for (const [symbol, tf] of [['BTCUSDT', '4h'], ['ETHUSDT', '1d'], ['SOLUSDT', '1h']]) {
  test(`equivalência com a calibração do motor: ${symbol} ${tf}`, () => {
    const A = run(symbol, tf);
    const bySetup = Object.fromEntries(A.setups.map((s) => [s.id, s.triggers]));
    assert.ok(A.preds.length > 100);
    for (const pred of A.preds) {
      const got = probabilityAt(bySetup[pred.sid], A.outs, A.cfg.hold, A.base, pred.t);
      assert.ok(got, `${pred.sid} em ${pred.t}`);
      assert.equal(got.p, pred.p);
      assert.equal(got.r, pred.r);
    }
    // e não emite onde o motor não emitiu
    let emitted = 0;
    for (const s of A.setups) for (const t of s.triggers) if (A.outs[t] && probabilityAt(s.triggers, A.outs, A.cfg.hold, A.base, t)) emitted++;
    assert.equal(emitted, A.preds.length);
  });
}

/** Os primeiros `k` candles da série (sliceSeries do motor corta pelo fim; aqui o corte é o "hoje" simulado). */
function prefix(d, k) {
  const out = { ...d, n: k };
  for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) out[f] = d[f].slice(0, k);
  return out;
}

test('gatilhos em aberto: só os da janela final, sem desfecho, e a previsão não muda quando o futuro chega', () => {
  const full = snapshotSeries('BTCUSDT', '1h');
  // simula "hoje" num ponto com gatilhos recentes e compara com o que a série sabe 100 candles depois
  let cut = null, open = null;
  for (let k = full.n - 200; k > full.n - 1200 && !open; k -= 7) {
    const A = run('BTCUSDT', '1h', prefix(full, k));
    const o = openPredictions(A).filter((x) => x.p !== null);
    if (o.length) { cut = A; open = o; }
  }
  assert.ok(open, 'nenhum corte com gatilho em aberto');
  for (const x of openPredictions(cut)) {
    assert.ok(x.index + cut.cfg.hold >= cut.d.n);
    assert.equal(cut.outs[x.index], null);
    assert.equal(x.resolvesAt, x.barTime + cut.cfg.hold * cut.d.dt);
  }
  // a mesma série com mais candles: os gatilhos em aberto viram encerrados com a MESMA probabilidade
  const later = run('BTCUSDT', '1h', prefix(full, cut.d.n + 100));
  for (const x of open) {
    const pred = later.preds.find((p) => p.sid === x.setupId && later.d.t[p.t] === x.barTime);
    assert.ok(pred, `gatilho ${x.setupId} em ${x.barTime} deveria estar na calibração posterior`);
    assert.equal(pred.p, x.p);
  }
});
