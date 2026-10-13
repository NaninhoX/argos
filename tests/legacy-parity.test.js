// Teste de paridade: o módulo engine/ devolve exatamente o mesmo resultado que o motor embutido no HTML
// da demo v1.1, para as 9 séries do snapshot × 8 setups (72 combinações), mais a análise completa de cada série.
// Compara o hash do JSON canônico; NaN é preservado como marca, e o campo `ms` (tempo de execução) fica de fora.
// Se este teste falhar, a diferença se investiga. Não se ajusta o teste.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../engine/index.js';
import { hashCanonical } from '../lib/canonical.js';
import { loadLegacy, DEFAULT_CFG } from './helpers/legacy.js';

const { engine: legacy, snapshot } = loadLegacy();
const h = (v) => hashCanonical(v, { nonFinite: 'tag' });
const strip = (A) => { const { ms, ...rest } = A; return rest; };
const keys = Object.keys(snapshot.series);

test('paridade: superfície pública igual à do motor legado', () => {
  assert.deepEqual(Object.keys(engine.default).sort(), Object.keys(legacy).sort());
  assert.equal(engine.VERSION, legacy.VERSION);
  assert.equal(h(engine.SETUPS), h(legacy.SETUPS));
  assert.equal(h(engine.REGIMES), h(legacy.REGIMES));
});

let matched = 0;
for (const key of keys) {
  test(`paridade ${key}: 8 setups e análise completa`, () => {
    const [sym, tf] = key.split('_');
    const meta = { sym, tf };
    const dL = legacy.decodeSnapshot(snapshot.series[key]);
    const dN = engine.decodeSnapshot(snapshot.series[key]);
    assert.equal(h(dN), h(dL), 'decodeSnapshot difere');
    const AL = legacy.analyze(dL, { ...DEFAULT_CFG }, meta);
    const AN = engine.analyze(dN, { ...DEFAULT_CFG }, meta);
    assert.equal(AN.setups.length, 8);
    for (const sL of AL.setups) {
      const sN = AN.setups.find((x) => x.id === sL.id);
      assert.ok(sN, `setup ${sL.id} ausente`);
      assert.equal(h(sN), h(sL), `${key} · ${sL.id} difere`);
      matched++;
    }
    assert.equal(h(strip(AN)), h(strip(AL)), `${key}: análise completa difere`);
  });
}

test('paridade: 72 de 72 combinações idênticas', () => {
  assert.equal(matched, keys.length * 8);
  assert.equal(matched, 72);
});

test('paridade: regra de saída percentual e janela recortada (BTCUSDT_1d)', () => {
  const cfg = { mode: 'pct', tgt: 3, stp: 1.5, hold: 7 };
  const s = snapshot.series.BTCUSDT_1d;
  const dL = legacy.sliceSeries(legacy.decodeSnapshot(s), 1500);
  const dN = engine.sliceSeries(engine.decodeSnapshot(s), 1500);
  assert.equal(h(strip(engine.analyze(dN, { ...cfg }, {}))), h(strip(legacy.analyze(dL, { ...cfg }, {}))));
});

test('paridade: setups próprios do Sandbox (analyzeSpec, ETHUSDT_1d)', () => {
  const specs = [
    { type: 'rsi_cross_up', len: 14, level: 30 },
    { type: 'rsi_below', len: 7, level: 25 },
    { type: 'macd_cross_up', fast: 12, slow: 26, signal: 9 },
    { type: 'ma_cross_up', kind: 'ema', fast: 9, slow: 21 },
    { type: 'price_cross_ma_up', kind: 'sma', len: 50 },
    { type: 'bb_lower', len: 20, mult: 2 },
    { type: 'breakout', len: 55 }
  ];
  const s = snapshot.series.ETHUSDT_1d;
  const dL = legacy.decodeSnapshot(s), dN = engine.decodeSnapshot(s);
  for (const spec of specs) {
    const L = legacy.analyzeSpec(dL, { ...DEFAULT_CFG }, { ...spec }, {});
    const N = engine.analyzeSpec(dN, { ...DEFAULT_CFG }, { ...spec }, {});
    assert.equal(h(strip(N)), h(strip(L)), `spec ${spec.type} difere`);
  }
});
