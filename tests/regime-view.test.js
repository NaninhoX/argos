// Recorte por regime (lib/regime-view.js): descritivo, sem teste novo. Confere, nas 9 séries do snapshot, que o recorte
// reproduz o que o motor já guarda em `byRegime` (n e acertos por regime), que a soma dos regimes fecha com o total do
// setup, que o intervalo segue a regra do motor e que a taxa-base condicional parte das entradas aleatórias do motor.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../engine/index.js';
import { hashCanonical } from '../lib/canonical.js';
import { SYMBOLS, TIMEFRAMES, snapshotSeries } from '../lib/data/series.js';
import { regimeView, MIN_EFFECTIVE } from '../lib/regime-view.js';

const CFG = Object.freeze({ mode: 'atr', tgt: 2, stp: 1, hold: 12 });
const h = (v) => hashCanonical(v, { nonFinite: 'tag' });
const same = (a, b) => (Number.isNaN(a) ? Number.isNaN(b) : a === b);

const cache = new Map();
function analysisFor(sym, tf) {
  const k = `${sym}_${tf}`;
  if (!cache.has(k)) cache.set(k, engine.analyze(snapshotSeries(sym, tf), { ...CFG }, { sym, tf }));
  return cache.get(k);
}

test('recorte por regime: o corte de evidência é 10 gatilhos efetivos', () => {
  assert.equal(MIN_EFFECTIVE, 10);
});

for (const sym of SYMBOLS) {
  for (const tf of TIMEFRAMES) {
    test(`recorte por regime ${sym} ${tf}: bate com byRegime do motor e a soma fecha com o total`, () => {
      const A = analysisFor(sym, tf);
      const V = regimeView(engine, A);
      assert.deepEqual(V.regimes, Object.keys(engine.REGIMES).filter((r) => r !== 'UNKNOWN'));
      assert.equal(V.current, A.tech.regime.regime);
      assert.deepEqual(Object.keys(V.bySetup), A.setups.map((s) => s.id));
      for (const s of A.setups) {
        const cells = V.bySetup[s.id];
        let n = 0, wins = 0;
        for (const [r, c] of Object.entries(cells)) {
          const eng = s.byRegime[r] || { n: 0, w: 0 };
          assert.equal(c.n, eng.n, `${s.id} ${r}: n`);
          assert.equal(c.wins, eng.w, `${s.id} ${r}: acertos`);
          n += c.n; wins += c.wins;
        }
        for (const r of Object.keys(s.byRegime)) assert.ok(r in cells, `${s.id}: regime ${r} do motor ausente no recorte`);
        assert.equal(n, s.n, `${s.id}: soma dos regimes (com UNKNOWN) = n do setup`);
        assert.equal(wins, s.wins, `${s.id}: soma dos acertos`);
        assert.equal(cells.UNKNOWN.n, 0, `${s.id}: nenhum gatilho no aquecimento`);
      }
    });

    test(`recorte por regime ${sym} ${tf}: N efetivo, intervalo e rótulo de evidência seguem a regra do motor`, () => {
      const A = analysisFor(sym, tf);
      const V = regimeView(engine, A);
      for (const s of A.setups) {
        for (const [r, c] of Object.entries(V.bySetup[s.id])) {
          // recalculado aqui, de forma independente: gatilhos encerrados do setup que caíram no regime
          const idx = s.triggers.filter((i) => A.outs[i] && A.reg[i].regime === r);
          const nEff = engine.effectiveN(idx.map((i) => A.outs[i].ret)).nEff;
          const where = `${s.id} ${r}`;
          assert.equal(c.n, idx.length, `${where}: n`);
          assert.equal(c.nEff, nEff, `${where}: N efetivo`);
          assert.equal(c.insufficient, nEff < 10, `${where}: insuficiente`);
          assert.equal(c.method, nEff < 25 ? 'bayes_beta_binomial' : 'wilson', `${where}: método do IC`);
          if (c.n === 0) {
            assert.ok(Number.isNaN(c.winRate) && Number.isNaN(c.ci[0]) && Number.isNaN(c.ci[1]), `${where}: vazio dá NaN, como no motor`);
            assert.equal(c.insufficient, true, `${where}: vazio é insuficiente`);
            continue;
          }
          assert.equal(c.winRate, c.wins / c.n, `${where}: taxa de acerto`);
          const want = nEff < 25 ? (() => { const b = engine.bayesWR(c.wins, c.n); return [b.lo, b.hi]; })() : engine.wilson(c.wins, c.n);
          assert.ok(same(c.ci[0], want[0]) && same(c.ci[1], want[1]), `${where}: IC ${c.ci} × ${want}`);
          // o intervalo de Wilson sempre contém a taxa observada; o de Bayes não (0 acertos em poucos gatilhos fica acima de 0)
          if (c.method === 'wilson') assert.ok(c.ci[0] <= c.winRate + 1e-12 && c.winRate <= c.ci[1] + 1e-12, `${where}: taxa dentro do IC`);
        }
      }
    });

    test(`recorte por regime ${sym} ${tf}: taxa-base condicional parte das entradas aleatórias do motor`, () => {
      const A = analysisFor(sym, tf);
      const V = regimeView(engine, A);
      const total = A.base.idx.length;
      assert.equal(total, A.base.n);
      const first = V.bySetup[A.setups[0].id];
      let n = 0, wins = 0;
      for (const [r, c] of Object.entries(first)) {
        const inRegime = A.base.idx.filter((i) => A.reg[i].regime === r);
        const w = inRegime.filter((i) => A.outs[i].type === 'WIN').length;
        assert.equal(c.base.n, inRegime.length, `base ${r}: n`);
        assert.ok(same(c.base.rate, inRegime.length ? w / inRegime.length : NaN), `base ${r}: taxa`);
        n += c.base.n; wins += w;
      }
      assert.equal(n, total, 'soma dos base.n por regime = entradas aleatórias encerradas');
      assert.ok(Math.abs(wins / n - A.base.rate) < 1e-12, 'a taxa-base geral é a média das taxas por regime, ponderada por n');
      // a base não depende do setup
      for (const s of A.setups) for (const r of Object.keys(first)) {
        assert.ok(same(V.bySetup[s.id][r].base.rate, first[r].base.rate) && V.bySetup[s.id][r].base.n === first[r].base.n, `${s.id} ${r}: base igual em todos os setups`);
      }
    });
  }
}

test('recorte por regime: não altera a análise do motor e é determinístico', () => {
  const A = analysisFor('BTCUSDT', '4h');
  const before = h({ setups: A.setups, base: { rate: A.base.rate, n: A.base.n, idx: A.base.idx }, reg: A.reg, outs: A.outs });
  const a = regimeView(engine, A), b = regimeView(engine, A);
  assert.equal(h(a), h(b));
  assert.equal(h({ setups: A.setups, base: { rate: A.base.rate, n: A.base.n, idx: A.base.idx }, reg: A.reg, outs: A.outs }), before);
});

test('recorte por regime: não devolve p-valor nem veredito (o motor 1.1 não testa por regime)', () => {
  const V = regimeView(engine, analysisFor('ETHUSDT', '1d'));
  for (const cells of Object.values(V.bySetup)) for (const c of Object.values(cells)) {
    assert.deepEqual(Object.keys(c).sort(), ['base', 'ci', 'insufficient', 'method', 'n', 'nEff', 'wins', 'winRate'].sort());
  }
});

test('recorte por regime: análise sintética mínima (gatilho sem desfecho fica fora; regime sem gatilho é vazio)', () => {
  const mk = (type, ret) => ({ type, ret });
  const A = {
    d: { n: 8 },
    reg: [{ regime: 'UNKNOWN' }, { regime: 'UNKNOWN' }, { regime: 'BULL_TREND' }, { regime: 'BULL_TREND' }, { regime: 'BEAR_TREND' }, { regime: 'BULL_TREND' }, { regime: 'BEAR_TREND' }, { regime: 'BULL_TREND' }],
    outs: [null, null, mk('WIN', 0.02), mk('LOSS', -0.01), mk('LOSS', -0.01), mk('WIN', 0.02), mk('TIMEOUT', 0.001), null],
    base: { idx: [2, 3, 4, 5, 6] },
    setups: [{ id: 'X', triggers: [2, 3, 4, 7] }]
  };
  const V = regimeView(engine, A);
  assert.equal(V.current, 'BULL_TREND');
  const x = V.bySetup.X;
  assert.deepEqual([x.BULL_TREND.n, x.BULL_TREND.wins], [2, 1]);
  assert.deepEqual([x.BEAR_TREND.n, x.BEAR_TREND.wins], [1, 0]);
  assert.equal(x.LOW_VOL_RANGING.n, 0);
  assert.equal(x.BULL_TREND.insufficient, true);
  assert.deepEqual(x.BULL_TREND.base, { rate: 2 / 3, n: 3 });
  assert.deepEqual(x.BEAR_TREND.base, { rate: 0, n: 2 });
  assert.equal(x.HIGH_VOL_RANGING.base.n, 0);
  assert.ok(Number.isNaN(x.HIGH_VOL_RANGING.base.rate));
});
