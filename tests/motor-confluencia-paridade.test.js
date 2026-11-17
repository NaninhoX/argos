// Paridade da cópia experimental do motor (tools/experimental/motor-confluencia.mjs) com engine/,
// e correção da confluência do estudo de combinações (docs/estudo-combinacoes-pre-registro.md).
// Só gatilhos e paridade: nenhuma taxa de acerto de combinação é conferida aqui.
// As séries de 1h do histórico são pesadas e ficam de fora do teste automático.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as engine from '../engine/index.js';
import * as exp from '../tools/experimental/motor-confluencia.mjs';
import { hashCanonical } from '../lib/canonical.js';

const CFG = Object.freeze({ mode: 'atr', tgt: 2, stp: 1, hold: 12 });
const snapshot = JSON.parse(fs.readFileSync(new URL('../data/snapshot-v1.1.json', import.meta.url), 'utf8'));
const ficha = JSON.parse(fs.readFileSync(new URL('../docs/estudo-combinacoes-pre-registro.json', import.meta.url), 'utf8'));
const serie = (key) => engine.decodeSnapshot(snapshot.series[key]);
const SLOW = { timeout: 280000 };

// ---------------------------------------------------------------- (a)
for (const key of ['BTCUSDT_1d', 'ETHUSDT_4h', 'SOLUSDT_1d', 'BTCUSDT_4h']) {
  test(`cópia experimental · analyze() idêntico ao motor · ${key}`, SLOW, () => {
    const [sym, tf] = key.split('_');
    const a = engine.analyze(serie(key), { ...CFG }, { sym, tf });
    const b = exp.analyze(serie(key), { ...CFG }, { sym, tf });
    const h = (x) => hashCanonical({ ...x, ms: 0 }, { nonFinite: 'tag' });
    assert.equal(h(b), h(a), 'hash canônico de analyze() (sem o campo ms)');
    assert.deepEqual(b.setups.map((s) => s.id), a.setups.map((s) => s.id));
    for (let k = 0; k < a.setups.length; k++) assert.equal(hashCanonical(b.setups[k], { nonFinite: 'tag' }), hashCanonical(a.setups[k], { nonFinite: 'tag' }), `setup ${a.setups[k].id}`);
  });
}

// ---------------------------------------------------------------- (b)
test('cópia experimental · componente isolado (janela 0, refratário 0, 3000 sorteios) = setup do motor', SLOW, () => {
  const d = serie('BTCUSDT_1d');
  const A = engine.analyze(d, { ...CFG }, { sym: 'BTCUSDT', tf: '1d' });
  assert.equal(A.setups.length, 8);
  const ctx = exp.confluenceContext(d, CFG);
  for (const s of A.setups) {
    const r = exp.analyzeConfluence(d, CFG, [s.id], { window: 0, refractory: 0, iters: 3000, ctx });
    for (const campo of ['nRaw', 'n', 'wins', 'winRate', 'nEff', 'base', 'alphaPP', 'pHigh', 'pLow', 'pTwo', 'wf', 'ci']) {
      assert.deepStrictEqual(r[campo], s[campo], `${s.id}.${campo}`);
    }
    // sem contexto pré-computado o resultado é o mesmo
    const r2 = exp.analyzeConfluence(d, CFG, [s.id], { window: 0, refractory: 0, iters: 3000 });
    assert.deepStrictEqual(r2.pTwo, r.pTwo);
  }
});

// ---------------------------------------------------------------- (c)
/** Monta gatilhos à mão: id -> array booleano de n candles com verdadeiro nos índices dados. */
function mk(n, spec) {
  const o = {};
  for (const [id, idx] of Object.entries(spec)) { o[id] = new Array(n).fill(false); idx.forEach((i) => (o[id][i] = true)); }
  return o;
}
const idxOf = (arr) => arr.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

test('confluenceTriggers · par: janela de 4 candles (o atual e os 3 anteriores)', () => {
  const t = mk(300, { A: [210], B: [213] });
  assert.deepEqual(idxOf(exp.confluenceTriggers(t, ['A', 'B'], 3, 0, 200)), [213]); // A a 3 candles: dentro
  const t2 = mk(300, { A: [210], B: [214] });
  assert.deepEqual(idxOf(exp.confluenceTriggers(t2, ['A', 'B'], 3, 0, 200)), []); // A a 4 candles: fora
});

test('confluenceTriggers · pelo menos um membro dispara exatamente em i', () => {
  const t = mk(300, { A: [210], B: [211] });
  // só 211: em 210 B ainda não apareceu; em 212 e 213 nenhum dispara, embora ambos estejam na janela
  assert.deepEqual(idxOf(exp.confluenceTriggers(t, ['A', 'B'], 3, 0, 200)), [211]);
});

test('confluenceTriggers · ordem dos membros é irrelevante', () => {
  const t = mk(300, { A: [210, 250], B: [212, 249], C: [211, 252] });
  const x = idxOf(exp.confluenceTriggers(t, ['A', 'B', 'C'], 3, 0, 200));
  for (const ord of [['C', 'B', 'A'], ['B', 'A', 'C'], ['B', 'C', 'A']]) assert.deepEqual(idxOf(exp.confluenceTriggers(t, ord, 3, 0, 200)), x);
  assert.deepEqual(idxOf(exp.confluenceTriggers(t, ['B', 'A'], 3, 0, 200)), idxOf(exp.confluenceTriggers(t, ['A', 'B'], 3, 0, 200)));
});

test('confluenceTriggers · trio exige os três na janela', () => {
  const t = mk(300, { A: [210], B: [212], C: [213] });
  assert.deepEqual(idxOf(exp.confluenceTriggers(t, ['A', 'B', 'C'], 3, 0, 200)), [213]);
  const t2 = mk(300, { A: [210], B: [212], C: [214] }); // A a 4 candles de C
  assert.deepEqual(idxOf(exp.confluenceTriggers(t2, ['A', 'B', 'C'], 3, 0, 200)), []);
  const t3 = mk(300, { A: [210], B: [212], C: [] }); // falta C
  assert.deepEqual(idxOf(exp.confluenceTriggers(t3, ['A', 'B', 'C'], 3, 0, 200)), []);
});

test('confluenceTriggers · refratário de 12: a 5 candles não conta, a 12 conta (conta o último gatilho CONTADO)', () => {
  const t = mk(300, { A: [210, 215, 222], B: [210, 215, 222] });
  assert.deepEqual(idxOf(exp.confluenceTriggers(t, ['A', 'B'], 3, 12, 200)), [210, 222]); // 215 cai; 222 - 210 = 12 conta
  const t2 = mk(300, { A: [210, 221], B: [210, 221] });
  assert.deepEqual(idxOf(exp.confluenceTriggers(t2, ['A', 'B'], 3, 12, 200)), [210]); // 11 candles: não conta
  assert.deepEqual(idxOf(exp.confluenceTriggers(t, ['A', 'B'], 3, 0, 200)), [210, 215, 222]); // refratário 0: sem período
});

test('confluenceTriggers · aquecimento: nada antes do índice 200, e gatilho de membro antes dele não vale', () => {
  const t = mk(300, { A: [150, 190, 205], B: [150, 190] });
  assert.deepEqual(idxOf(exp.confluenceTriggers(t, ['A', 'B'], 3, 0, 200)), []); // B só existia antes do aquecimento
  const t2 = mk(300, { A: [200], B: [198, 200] });
  assert.deepEqual(idxOf(exp.confluenceTriggers(t2, ['A', 'B'], 3, 0, 200)), [200]); // 198 é zerado, 200 conta
  const t3 = mk(300, { A: [199], B: [199] });
  assert.deepEqual(idxOf(exp.confluenceTriggers(t3, ['A', 'B'], 3, 0, 200)), []);
  // gatilho de membro antes do aquecimento não vale nem como "membro presente na janela": B em 198 está dentro da janela
  // de A em 201 (198..201), mas foi zerado e não pode completar o par (distingue "zerar antes" de "só suprimir a saída")
  const t4 = mk(300, { A: [201], B: [198] });
  assert.deepEqual(idxOf(exp.confluenceTriggers(t4, ['A', 'B'], 3, 0, 200)), []);
  // membro único com refratário 12
  assert.deepEqual(idxOf(exp.confluenceTriggers(mk(300, { A: [210, 215, 222, 233] }), ['A'], 3, 12, 200)), [210, 222]);
});

test('confluenceTriggers · não altera os gatilhos recebidos; membro único e janela 0 devolvem o próprio gatilho', () => {
  const t = mk(300, { A: [150, 210, 300 - 1], B: [210] });
  const copia = JSON.stringify(t);
  exp.confluenceTriggers(t, ['A', 'B'], 3, 12, 200);
  assert.equal(JSON.stringify(t), copia);
  assert.deepEqual(idxOf(exp.confluenceTriggers(t, ['A'], 0, 0, 200)), [210, 299]);
  assert.throws(() => exp.confluenceTriggers(t, ['A', 'ZZ'], 3, 12, 200), /desconhecido/);
});

// ---------------------------------------------------------------- (d)
const SCRATCH_COMBOS = 'C:/Users/ramon/AppData/Local/Temp/claude/b4c8ee347e133976/af689699-29bc-4dee-9e0f-3acf2946a261/scratchpad/combos.json';
const temRef = fs.existsSync(SCRATCH_COMBOS);
const contagem = (arr) => arr.reduce((s, x) => s + (x ? 1 : 0), 0);

test('contagem de gatilhos · P01, P12, T32 em BTCUSDT_1d e ETHUSDT_4h = script de contagem de referência',
  { ...SLOW, skip: temRef ? false : 'requer o combos.json de referência do scratchpad' }, () => {
    const ref = JSON.parse(fs.readFileSync(SCRATCH_COMBOS, 'utf8'));
    const igual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    for (const key of ['BTCUSDT_1d', 'ETHUSDT_4h']) {
      const d = serie(key);
      const ctx = exp.confluenceContext(d, CFG);
      for (const id of ['P01', 'P12', 'T32']) {
        const comb = ficha.combinacoes.find((c) => c.id === id);
        const lista = id.startsWith('P') ? ref.pares : ref.trios;
        const campo = id.startsWith('P') ? 'pares_k3' : 'trios_k3';
        const k = lista.findIndex((m) => igual(m, comb.setups));
        assert.ok(k >= 0, `${id} não está no combos.json`);
        const esperado = ref.series[key][campo][k];
        const arr = exp.confluenceTriggers(ctx.trig, comb.setups, 3, 12, 200);
        assert.equal(contagem(arr), esperado, `${key} ${id}`);
        const r = exp.analyzeConfluence(d, CFG, comb.setups, { window: 3, refractory: 12, iters: 10, ctx });
        assert.equal(r.nRaw, esperado, `${key} ${id} (nRaw)`);
      }
    }
  });

test('contagem de gatilhos · soma por série (pares e trios) das séries de 4h e 1d = ficha registrada', SLOW, () => {
  const somas = ficha.poderEEfeitoMinimo.somasPorSerieJanela4Refratario12;
  assert.ok(somas, 'a ficha tem somasPorSerieJanela4Refratario12');
  for (const key of ['BTCUSDT_4h', 'BTCUSDT_1d', 'ETHUSDT_4h', 'ETHUSDT_1d', 'SOLUSDT_4h', 'SOLUSDT_1d']) {
    const d = serie(key);
    const ctx = exp.confluenceContext(d, CFG);
    let pares = 0, trios = 0;
    for (const comb of ficha.combinacoes) {
      const n = contagem(exp.confluenceTriggers(ctx.trig, comb.setups, 3, 12, 200));
      if (comb.id.startsWith('P')) pares += n; else trios += n;
    }
    const esp = somas[key];
    assert.ok(esp, `a ficha tem a soma de ${key}`);
    assert.deepEqual([pares, trios], [esp.pares ?? esp[0], esp.trios ?? esp[1]], key);
  }
});

test('ficha · 84 combinações (28 pares + 56 trios) com ids P01..P28 e T01..T56', () => {
  assert.equal(ficha.combinacoes.length, 84);
  assert.deepEqual(ficha.combinacoes.slice(0, 28).map((c) => c.id), Array.from({ length: 28 }, (_, i) => 'P' + String(i + 1).padStart(2, '0')));
  assert.deepEqual(ficha.combinacoes.slice(28).map((c) => c.id), Array.from({ length: 56 }, (_, i) => 'T' + String(i + 1).padStart(2, '0')));
});
