// Motor 1.3.0: os 7 setups do estudo v1.2 (ficha docs/estudo-v1.2-pre-registro.json) e a garantia de que o
// resto do motor não mudou.
//
// REGRA DESTE ARQUIVO: o estudo v1.2 roda uma vez só, por decisão de Michel. Nenhum teste aqui calcula
// desfecho, taxa de acerto nem p dos 7 setups sobre as 9 séries reais (snapshot ou data/history). Sobre as
// séries reais só se CONTA gatilho (sanidade, sem taxa). analyzeSetupsV12 roda apenas em série sintética.
// (analyze() e analyzeSpec() das 9 séries reais são o motor antigo e entram só na conferência de paridade.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as engine from '../engine/index.js';
import { hashCanonical } from '../lib/canonical.js';

const CFG = Object.freeze({ mode: 'atr', tgt: 2, stp: 1, hold: 12 });
const snapshot = JSON.parse(fs.readFileSync(new URL('../data/snapshot-v1.1.json', import.meta.url), 'utf8'));
const ficha = JSON.parse(fs.readFileSync(new URL('../docs/estudo-v1.2-pre-registro.json', import.meta.url), 'utf8'));
const h = (v) => hashCanonical(v, { nonFinite: 'tag' });
const IDS_V12 = ['EMA_9_21', 'MACD_ZERO', 'RSI_50', 'CLOSE_SMA200', 'ADX_DI', 'BB_UPPER', 'BREAKOUT_55'];
const IDS_V11 = ['RSI_OVERSOLD', 'MACD_CROSS', 'GOLDEN_CROSS', 'BB_LOWER', 'BREAKOUT_20', 'EMA_PULLBACK', 'BULL_ENGULFING', 'HAMMER'];
const idxOf = (arr) => arr.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// ------------------------------------------------------------ metadados
test('SETUPS_V12: ids, nomes e grupos são os da ficha, na ordem da ficha', () => {
  assert.deepEqual(engine.SETUPS_V12.map((s) => s.id), IDS_V12);
  assert.deepEqual(ficha.setups.map((s) => s.id), IDS_V12);
  for (let k = 0; k < IDS_V12.length; k++) {
    // a ficha está em ASCII (sem acento); o motor segue a grafia acentuada dos outros setups
    assert.equal(semAcento(engine.SETUPS_V12[k].nome), ficha.setups[k].nome, ficha.setups[k].id + ' nome');
    assert.equal(semAcento(engine.SETUPS_V12[k].grupo), ficha.setups[k].grupo, ficha.setups[k].id + ' grupo');
  }
});

test('superfície 1.3.0: VERSION e os 4 nomes novos nos exports e no objeto default', () => {
  assert.equal(engine.VERSION, 'argos-engine 1.3.0');
  assert.equal(engine.default.VERSION, engine.VERSION);
  for (const nome of ['computeIndicatorsV12', 'SETUPS_V12', 'detectSetupsV12', 'analyzeSetupsV12']) {
    assert.notEqual(engine[nome], undefined, `export ${nome}`);
    assert.equal(engine.default[nome], engine[nome], `default.${nome}`);
  }
  assert.equal(engine.evaluateSetup, undefined, 'evaluateSetup não é exportado');
  assert.equal(engine.default.evaluateSetup, undefined);
});

// ------------------------------------------------ bordas das convenções (índices à mão)
// Série de n candles em que só os campos usados por detectSetupsV12 existem. Tudo que não é dado vem NaN
// (comparação com NaN é falsa), de modo que só dispara o que o caso monta.
function fake(n, o = {}) {
  const nan = () => new Array(n).fill(NaN);
  const d = { n, c: o.c || new Array(n).fill(0) };
  const ind = { macd: { line: o.macd || nan() }, rsi: o.rsi || nan(), sma200: o.sma200 || nan(), diPlus: o.diPlus || nan(), diMinus: o.diMinus || nan(), adx: o.adx || nan(), bb: { upper: o.bbUpper || nan() } };
  const v12 = { ema9: o.ema9 || nan(), ema21: o.ema21 || nan(), hh55: o.hh55 || nan() };
  return engine.detectSetupsV12(d, ind, v12);
}

test('EMA_9_21: ema9[i-1] <= ema21[i-1] e ema9[i] > ema21[i]', () => {
  const f = (p9, p21, c9, c21) => idxOf(fake(2, { ema9: [p9, c9], ema21: [p21, c21] }).EMA_9_21);
  assert.deepEqual(f(4, 5, 6, 5), [1], 'estava abaixo, passa para cima');
  assert.deepEqual(f(5, 5, 6, 5), [1], 'estava igual (<=), passa para cima');
  assert.deepEqual(f(6, 5, 7, 5), [], 'já estava acima: não é o primeiro candle');
  assert.deepEqual(f(4, 5, 5, 5), [], 'chega a igual: precisa de > estrito');
  assert.deepEqual(f(NaN, 5, 6, 5), [], 'anterior sem valor (aquecimento)');
  assert.deepEqual(f(4, 5, 6, NaN), [], 'atual sem valor');
});

test('MACD_ZERO: macd[i-1] <= 0 e macd[i] > 0', () => {
  const f = (p, c) => idxOf(fake(2, { macd: [p, c] }).MACD_ZERO);
  assert.deepEqual(f(-1, 1), [1]);
  assert.deepEqual(f(0, 1), [1], 'zero exato antes conta (<=)');
  assert.deepEqual(f(0.5, 1), [], 'já positivo');
  assert.deepEqual(f(-1, 0), [], 'chega a zero: precisa de > estrito');
  assert.deepEqual(f(NaN, 1), []);
});

test('RSI_50: rsi[i-1] < 50 e rsi[i] >= 50 (mesma convenção do RSI Oversold)', () => {
  const f = (p, c) => idxOf(fake(2, { rsi: [p, c] }).RSI_50);
  assert.deepEqual(f(49, 51), [1]);
  assert.deepEqual(f(49, 50), [1], '50 exato agora conta (>=)');
  assert.deepEqual(f(50, 51), [], '50 exato antes não conta (< estrito): já estava em 50');
  assert.deepEqual(f(49, 49.99), []);
  assert.deepEqual(f(NaN, 51), []);
  // espelho: o RSI Oversold de detectSetups tem a mesma forma com 30
  const rsiOversold = (p, c) => { const d = { n: 2, c: [0, 0], o: [0, 0], h: [0, 0], l: [0, 0] }; const ind = { rsi: [p, c], macd: { line: [NaN, NaN], signal: [NaN, NaN] }, sma50: [NaN, NaN], sma200: [NaN, NaN], bb: { lower: [NaN, NaN] }, hh20: [NaN, NaN], ema20: [NaN, NaN], ema50: [NaN, NaN] }; return idxOf(engine.detectSetups(d, ind).RSI_OVERSOLD); };
  assert.deepEqual(rsiOversold(29, 30), [1]);
  assert.deepEqual(rsiOversold(30, 31), []);
});

test('CLOSE_SMA200: c[i-1] <= sma200[i-1] e c[i] > sma200[i]', () => {
  const f = (pc, cc, ps, cs) => idxOf(fake(2, { c: [pc, cc], sma200: [ps, cs] }).CLOSE_SMA200);
  assert.deepEqual(f(9, 11, 10, 10), [1]);
  assert.deepEqual(f(10, 11, 10, 10), [1], 'fechamento igual à média antes conta (<=)');
  assert.deepEqual(f(11, 12, 10, 10), [], 'já estava acima');
  assert.deepEqual(f(9, 10, 10, 10), [], 'chega a igual: precisa de > estrito');
  assert.deepEqual(f(9, 11, NaN, NaN), [], 'sem SMA200 (aquecimento)');
});

test('ADX_DI: DI+ cruza acima de DI- (<= antes, > agora) com ADX > 25 estrito', () => {
  const f = (pp, pm, cp, cm, adx) => idxOf(fake(2, { diPlus: [pp, cp], diMinus: [pm, cm], adx: [NaN, adx] }).ADX_DI);
  assert.deepEqual(f(10, 10, 12, 11, 26), [1], 'igual antes (<=), acima agora, ADX 26');
  assert.deepEqual(f(9, 10, 12, 11, 30), [1], 'abaixo antes, acima agora');
  assert.deepEqual(f(10, 10, 12, 11, 25), [], 'ADX = 25 não basta (> estrito)');
  assert.deepEqual(f(10, 10, 12, 11, 24.9), []);
  assert.deepEqual(f(11, 10, 12, 10, 40), [], 'DI+ já estava acima');
  assert.deepEqual(f(9, 10, 11, 11, 40), [], 'chega a igual: precisa de > estrito');
  assert.deepEqual(f(10, 10, 12, 11, NaN), [], 'ADX sem valor');
});

test('BB_UPPER: fechamento acima da banda superior, só o primeiro candle da sequência', () => {
  const f = (pc, cc, pu, cu) => idxOf(fake(2, { c: [pc, cc], bbUpper: [pu, cu] }).BB_UPPER);
  assert.deepEqual(f(9, 11, 10, 10), [1]);
  assert.deepEqual(f(10, 11, 10, 10), [1], 'fechamento igual à banda antes não conta como "acima" (> estrito)');
  assert.deepEqual(f(11, 12, 10, 10), [], 'continuação da sequência');
  assert.deepEqual(f(9, 10, 10, 10), [], 'igual à banda agora: precisa de > estrito');
  // espelho do BB_LOWER: banda anterior sem valor (primeiro candle com banda) conta como "não estava acima"
  assert.deepEqual(f(9, 11, NaN, 10), [1]);
  assert.deepEqual(f(9, 11, 10, NaN), []);
});

test('BREAKOUT_55: fechamento > máxima dos 55 anteriores, primeiro candle, a partir do índice 56', () => {
  const N = 60;
  const arrs = (over) => { const c = new Array(N).fill(5), hh = new Array(N).fill(10); for (const [i, v] of Object.entries(over.c || {})) c[i] = v; for (const [i, v] of Object.entries(over.hh || {})) hh[i] = v; return { c, hh55: hh }; };
  const f = (over) => idxOf(fake(N, arrs(over)).BREAKOUT_55);
  assert.deepEqual(f({ c: { 57: 11 } }), [57], 'rompe a máxima anterior');
  assert.deepEqual(f({ c: { 57: 10 } }), [], 'igual à máxima: precisa de > estrito');
  assert.deepEqual(f({ c: { 56: 11, 57: 12 } }), [56], 'continuação (57 já tinha 56 acima) não repete');
  assert.deepEqual(f({ c: { 56: 11 } }), [56], 'índice 56 é o primeiro permitido');
  assert.deepEqual(f({ c: { 55: 11 } }), [], 'antes do índice 56 nunca dispara (mesma guarda do BREAKOUT_20)');
  // a máxima usada é a do candle ANTERIOR (hh55[i-1]), não a do próprio candle
  assert.deepEqual(f({ c: { 57: 11 }, hh: { 57: 20 } }), [57]);
  assert.deepEqual(f({ c: { 57: 11 }, hh: { 56: 12 } }), [], 'máxima de i-1 maior que o fechamento');
});

// ------------------------------------------------ séries sintéticas de candles montados à mão
/** Série a partir de linhas [o, h, l, c]. */
function serie(rows) {
  const n = rows.length;
  return { n, dt: 3600, t: rows.map((_, i) => 1.7e9 + i * 3600), o: rows.map((r) => r[0]), h: rows.map((r) => r[1]), l: rows.map((r) => r[2]), c: rows.map((r) => r[3]), v: rows.map(() => 1) };
}
/** Candle que abre no fechamento anterior e fecha em `c`, com pavio de 0,5 (sem ganho de máxima/mínima espúrio). */
function passo(prev, c) { return [prev, Math.max(prev, c) + 0.5, Math.min(prev, c) - 0.5, c]; }
/** Cai 1 por candle (100, 99, ...) por `queda` candles e depois salta para `topo` e fica lá até completar n. */
function quedaESalto(queda, topo, n) {
  const rows = []; let prev = 100;
  for (let i = 0; i < n; i++) { const c = i < queda ? 100 - i : topo; rows.push(passo(i === 0 ? c : prev, c)); prev = c; }
  return serie(rows);
}
const detectar = (d) => engine.detectSetupsV12(d, engine.computeIndicators(d));

test('queda de 40 candles e salto no candle 40: EMA 9/21, MACD zero, RSI 50, ADX/DI e Bollinger disparam só no 40', () => {
  const d = quedaESalto(40, 300, 70);
  const S = detectar(d);
  assert.deepEqual(Object.keys(S), IDS_V12);
  assert.deepEqual(idxOf(S.EMA_9_21), [40]);
  assert.deepEqual(idxOf(S.MACD_ZERO), [40]);
  assert.deepEqual(idxOf(S.RSI_50), [40]);
  assert.deepEqual(idxOf(S.ADX_DI), [40]);
  assert.deepEqual(idxOf(S.BB_UPPER), [40]);
  assert.deepEqual(idxOf(S.CLOSE_SMA200), [], 'série curta demais para a SMA200');
  assert.deepEqual(idxOf(S.BREAKOUT_55), [], 'o salto veio antes do índice 56');
  // e as mesmas posições com o v12 passado à parte
  assert.deepEqual(engine.detectSetupsV12(d, engine.computeIndicators(d), engine.computeIndicatorsV12(d)), S);
});

test('sem salto (queda contínua), nenhum dos 5 gatilhos de momento dispara', () => {
  const S = detectar(quedaESalto(70, 0, 70));
  for (const id of ['EMA_9_21', 'MACD_ZERO', 'RSI_50', 'ADX_DI', 'BB_UPPER', 'CLOSE_SMA200', 'BREAKOUT_55']) assert.deepEqual(idxOf(S[id]), [], id);
});

test('EMA_9_21 no aquecimento: sem EMA(21) no candle anterior não há cruzamento', () => {
  // primeira EMA(21) válida é o índice 20; o salto no 20 não dispara porque ema21[19] ainda não existe
  const rows = []; let prev = 100;
  for (let i = 0; i < 30; i++) { const c = i < 20 ? 100 - i : 300; rows.push(passo(i === 0 ? c : prev, c)); prev = c; }
  const ind = engine.computeIndicatorsV12(serie(rows));
  assert.ok(Number.isNaN(ind.ema21[19]) && Number.isFinite(ind.ema21[20]));
  assert.ok(Number.isNaN(ind.ema9[7]) && Number.isFinite(ind.ema9[8]));
  assert.deepEqual(idxOf(detectar(serie(rows)).EMA_9_21), []);
});

test('CLOSE_SMA200: série plana em 100 e fechamento 101 no candle 230 → só o 230', () => {
  const rows = []; for (let i = 0; i < 260; i++) rows.push([100, 101, 99, i < 230 ? 100 : 101]);
  const S = detectar(serie(rows));
  // plana: fechamento = SMA (<=, não dispara porque o atual não é > SMA); candle 230: 101 > 100,005
  assert.deepEqual(idxOf(S.CLOSE_SMA200), [230]);
});

test('BB_UPPER: pico isolado dispara no candle do pico e não na continuação', () => {
  const plano = (n, pico) => { const rows = []; for (let i = 0; i < n; i++) rows.push(i === pico ? [100, 111, 99, 110] : i === pico + 1 ? [110, 112, 100, 111] : [100, 101, 99, 100]); return serie(rows); };
  assert.deepEqual(idxOf(detectar(plano(60, 30)).BB_UPPER), [30], 'pico no 30 (111 no 31 é continuação)');
  // fechamento exatamente igual à banda superior não conta (> estrito): série plana, banda = 100
  assert.deepEqual(idxOf(detectar(plano(60, 1000)).BB_UPPER), []);
  // primeiro candle com banda (19): sem banda no anterior, o pico conta (espelho do BB_LOWER)
  assert.deepEqual(idxOf(detectar(plano(30, 19)).BB_UPPER), [19]);
});

test('BREAKOUT_55: rompe no candle 70, não repete no 71, e fechamento igual à máxima não rompe', () => {
  const base = (c70) => { const rows = []; for (let i = 0; i < 80; i++) rows.push(i < 70 ? [100, 101, 99, 100] : i === 70 ? [100, 103, 99, c70] : i === 71 ? [c70, 105, 101, 104] : [104, 105, 103, 104]); return serie(rows); };
  assert.deepEqual(idxOf(detectar(base(102)).BREAKOUT_55), [70]);
  // fechamento 101 = máxima dos 55 anteriores (101), sem rompimento depois: precisa de > estrito
  const igual = []; for (let i = 0; i < 80; i++) igual.push(i === 70 ? [100, 101, 99, 101] : [100, 101, 99, 100]);
  assert.deepEqual(idxOf(detectar(serie(igual)).BREAKOUT_55), []);
  // guarda do aquecimento: máxima de 55 só existe a partir do índice 54; o primeiro candle permitido é o 56
  const pico = (k) => { const rows = []; for (let i = 0; i < 70; i++) rows.push(i === k ? [100, 103, 99, 102] : [100, 101, 99, 100]); return serie(rows); };
  assert.deepEqual(idxOf(detectar(pico(55)).BREAKOUT_55), [], 'índice 55 não dispara (guarda i >= 56)');
  assert.deepEqual(idxOf(detectar(pico(56)).BREAKOUT_55), [56]);
});

test('computeIndicatorsV12: ema9, ema21 e hh55 (máxima das máximas) sem tocar em computeIndicators', () => {
  const d = quedaESalto(40, 300, 70);
  const v = engine.computeIndicatorsV12(d);
  assert.deepEqual(Object.keys(v), ['ema9', 'ema21', 'hh55']);
  for (const k of Object.keys(v)) assert.equal(v[k].length, d.n);
  // hh55: NaN até o índice 53, máxima das máximas dos 55 candles que terminam no índice a partir do 54
  assert.ok(Number.isNaN(v.hh55[53]));
  assert.equal(v.hh55[54], Math.max(...d.h.slice(0, 55)));
  assert.equal(v.hh55[69], Math.max(...d.h.slice(15, 70)));
  // EMA com semente por SMA: primeiro valor = média simples dos primeiros `len` fechamentos
  assert.equal(v.ema9[8], d.c.slice(0, 9).reduce((s, x) => s + x, 0) / 9);
  assert.equal(v.ema21[20], d.c.slice(0, 21).reduce((s, x) => s + x, 0) / 21);
  // computeIndicators continua com as mesmas chaves do 1.2.0 (nenhum array a mais)
  assert.deepEqual(Object.keys(engine.computeIndicators(d)), ['ema20', 'ema50', 'sma50', 'sma200', 'rsi', 'macd', 'bb', 'bbw', 'atr', 'adx', 'diPlus', 'diMinus', 'rv30', 'rvPct', 'volAvg', 'hh20', 'll20', 'logret']);
});

// ----------------------------------------- contagem de gatilhos nas séries reais (sanidade, sem taxa)
test('séries reais: os 7 gatilhos aparecem (contagem não nula por setup) em todas as 9 séries, sem desfecho', () => {
  const total = Object.fromEntries(IDS_V12.map((id) => [id, 0]));
  const zeros = [];
  for (const key of Object.keys(snapshot.series)) {
    const d = engine.decodeSnapshot(snapshot.series[key]);
    const S = engine.detectSetupsV12(d, engine.computeIndicators(d));
    assert.deepEqual(Object.keys(S), IDS_V12);
    for (const id of IDS_V12) {
      assert.equal(S[id].length, d.n);
      const apos = idxOf(S[id]).filter((i) => i >= 200).length; // aquecimento de 200, como no analyze()
      total[id] += apos;
      if (apos === 0) zeros.push(key + ' ' + id);
    }
  }
  for (const id of IDS_V12) assert.ok(total[id] > 0, `${id}: nenhum gatilho em nenhuma série real`);
  assert.deepEqual(zeros, [], 'célula(s) sem nenhum gatilho depois do aquecimento');
});

// ------------------------------------------------ 1.3.0 não mexe no resto do motor
// Hash de analyze()/analyzeSpec() do motor 1.2.0 (commit 1a75ed1), regra 2×ATR/1×ATR/12, `ms` zerado.
// O resultado de analyze() não traz VERSION (só o resumo de lib/analysis-summary.js traz); por isso a
// normalização de VERSION é desnecessária aqui. Procedimento para refazer (SÓ se a regra mudar de propósito):
//   git show 1a75ed1:engine/index.js > <fora do repositório>/engine-1.2.0.mjs
//   importar o arquivo, rodar analyze(decodeSnapshot(snapshot.series[k]), {mode:'atr',tgt:2,stp:1,hold:12}, {sym, tf}),
//   e hashCanonical({ ...A, ms: 0 }, { nonFinite: 'tag' }); analyzeSpec igual, com o spec abaixo e meta {}.
// Estes números NÃO podem ser "ajustados para passar": diferença se investiga (CLAUDE.md).
const REF_1_2_0 = {
  'BTCUSDT_1d analyze': '7acfb64437100e443bdc7e1efb3bc3a2992228eb4e86a809f34df7389b26fa2e',
  'ETHUSDT_4h analyze': '8663beb82c4007a8d27fa6860ded9ccfc20b805b1b4c0d75dd0d25562fed64bb',
  'BTCUSDT_1d analyzeSpec ema9/21': 'feed1481cf966c3b22c7b4a63d0c170460aea1083a319997fe5b41b981c1b5bc'
};
const semMs = (x) => h({ ...x, ms: 0 });

test('motor intacto: detectSetups devolve exatamente os 8 ids do 1.2.0 e SETUPS tem 8 itens', () => {
  assert.deepEqual(engine.SETUPS.map((s) => s.id), IDS_V11);
  const d = engine.decodeSnapshot(snapshot.series.BTCUSDT_1d);
  const S = engine.detectSetups(d, engine.computeIndicators(d));
  assert.deepEqual(Object.keys(S), IDS_V11);
  for (const id of IDS_V12) assert.equal(S[id], undefined, `detectSetups não pode ganhar ${id}`);
  assert.deepEqual(Object.keys(engine.SPEC_TYPES), ['rsi_cross_up', 'rsi_below', 'macd_cross_up', 'ma_cross_up', 'price_cross_ma_up', 'bb_lower', 'breakout']);
});

test('motor intacto: analyze() e analyzeSpec() têm o mesmo hash do motor 1.2.0 (BTCUSDT_1d e ETHUSDT_4h)', { timeout: 280000 }, () => {
  for (const key of ['BTCUSDT_1d', 'ETHUSDT_4h']) {
    const [sym, tf] = key.split('_');
    const A = engine.analyze(engine.decodeSnapshot(snapshot.series[key]), { ...CFG }, { sym, tf });
    assert.equal(A.setups.length, 8);
    assert.deepEqual(A.setups.map((s) => s.id), IDS_V11);
    assert.equal(semMs(A), REF_1_2_0[key + ' analyze'], `${key} analyze()`);
  }
  const S = engine.analyzeSpec(engine.decodeSnapshot(snapshot.series.BTCUSDT_1d), { ...CFG }, { type: 'ma_cross_up', kind: 'ema', fast: 9, slow: 21 }, {});
  assert.equal(semMs(S), REF_1_2_0['BTCUSDT_1d analyzeSpec ema9/21']);
});

// ------------------------------------------------ analyzeSetupsV12 em série sintética
/** Passeio determinístico (mulberry32 local; nenhum Math.random) com onda lenta, para haver cruzamentos. */
function passeio(n, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rows = []; let prev = 100;
  for (let i = 0; i < n; i++) {
    const c = Math.max(5, 100 + 30 * Math.sin(i / 37) + 12 * Math.sin(i / 9) + (rnd() - 0.5) * 6);
    const o = i === 0 ? c : prev;
    rows.push([o, Math.max(o, c) + rnd() * 2, Math.min(o, c) - rnd() * 2, c]);
    prev = c;
  }
  return serie(rows);
}

test('analyzeSetupsV12 em série sintética: roda sem erro, 7 linhas, contagem coerente com detectSetupsV12', () => {
  const d = passeio(1200, 7);
  const R = engine.analyzeSetupsV12(d, { ...CFG }, { iters: 50, meta: { sym: 'SINT', tf: '1h' } });
  assert.deepEqual(R.meta, { sym: 'SINT', tf: '1h' });
  assert.equal(R.iters, 50);
  assert.equal(R.warm, 200);
  assert.deepEqual(R.setups.map((s) => s.id), IDS_V12);
  const S = engine.detectSetupsV12(d, engine.computeIndicators(d));
  let comGatilho = 0;
  for (const s of R.setups) {
    const esperado = idxOf(S[s.id]).filter((i) => i >= 200); // aquecimento de 200 como no analyze()
    assert.deepEqual(s.triggers, esperado, `${s.id} triggers`);
    assert.equal(s.nRaw, esperado.length, `${s.id} nRaw`);
    assert.ok(s.n <= s.nRaw && s.n >= 0, `${s.id} n`);
    assert.ok(s.wins <= s.n);
    for (const campo of ['id', 'nome', 'grupo', 'def', 'n', 'nRaw', 'wins', 'winRate', 'ci', 'method', 'nEff', 'base', 'pTwo', 'pHigh', 'pLow', 'q', 'family', 'verdict', 'wf']) assert.ok(campo in s, `${s.id} sem ${campo}`);
    assert.ok(['wilson', 'bayes_beta_binomial'].includes(s.method) || s.n === 0);
    assert.ok(Number.isNaN(s.q) && s.family === 1, 'sem correção de família: o chamador aplica applyFamily');
    assert.equal(s.base, R.base.rate);
    if (s.nRaw > 0) comGatilho++;
  }
  assert.ok(comGatilho >= 4, 'a série sintética precisa exercitar vários setups (' + comGatilho + ')');
  // a taxa-base é a de analyze(): mesma série, mesma regra, mesmo aquecimento
  const A = engine.analyze(d, { ...CFG }, {});
  assert.equal(h(R.base), h(A.base));
  // o chamador escolhe a família (a ficha usa 135 e 63); aqui, 7 só para provar o contrato
  const lista = engine.applyFamily(R.setups.map((s) => ({ ...s })));
  for (const s of lista) assert.ok(s.family === 7 && Number.isFinite(s.q) && s.verdict && s.verdict.key);
  // determinismo: mesma entrada, mesmo resultado (semente fixa do teste de permutação)
  assert.equal(h(R.setups), h(engine.analyzeSetupsV12(d, { ...CFG }, { iters: 50 }).setups));
});

test('analyzeSetupsV12: iters padrão é 3000 e opts é opcional (série curta, sem desfecho suficiente, não quebra)', () => {
  const d = passeio(260, 3);
  const R = engine.analyzeSetupsV12(d, { ...CFG });
  assert.equal(R.iters, 3000);
  assert.equal(R.meta, undefined);
  assert.equal(R.setups.length, 7);
});
