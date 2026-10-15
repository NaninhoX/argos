import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAnalyze, parseAnalyzeInput } from '../lib/handlers/analyze.js';
import { handleHealth } from '../lib/handlers/health.js';
import { loadSeries, snapshotSeries } from '../lib/data/series.js';
import { DISCLAIMER_PADRAO } from '../lib/compliance.js';

// Sem rede nos testes: a série vem só do snapshot.
const offline = { loadSeries: async (s, tf) => ({ d: snapshotSeries(s, tf), source: 'snapshot' }) };

test('analyze: BTCUSDT 4h reproduz o caso de referência do estudo (RSI Oversold: N 290, 20,7% contra 26,5%)', async () => {
  const r = await handleAnalyze({ query: { symbol: 'BTCUSDT', tf: '4h' }, deps: offline });
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.engine, 'argos-engine 1.1.0');
  assert.deepEqual(b.input.cfg, { mode: 'atr', tgt: 2, stp: 1, hold: 12 });
  const rsi = b.setups.find((s) => s.id === 'RSI_OVERSOLD');
  assert.equal(rsi.n, 290);
  assert.equal((rsi.winRate * 100).toFixed(1), '20.7');
  assert.equal((rsi.base * 100).toFixed(1), '26.5');
  assert.equal(rsi.pTwo.toFixed(3), '0.025');
  assert.equal(b.setups.length, 8);
  assert.equal(b.disclaimer, DISCLAIMER_PADRAO);
  assert.match(b.data.hash, /^[0-9a-f]{64}$/);
  assert.match(b.resultHash, /^[0-9a-f]{64}$/);
});

test('analyze: resposta é JSON puro (sem NaN, sem séries inteiras) e pequena', async () => {
  const r = await handleAnalyze({ query: { symbol: 'SOLUSDT', tf: '1d' }, deps: offline });
  const text = JSON.stringify(r.body);
  assert.deepEqual(JSON.parse(text), r.body);
  assert.ok(text.length < 200_000, `resposta com ${text.length} caracteres`);
  for (const s of r.body.setups) assert.equal('triggers' in s, false);
});

test('analyze: mesma entrada, mesmo resultHash; regra de saída diferente, hash diferente', async () => {
  const q = { symbol: 'ETHUSDT', tf: '1d' };
  const a = await handleAnalyze({ query: q, deps: offline });
  const b = await handleAnalyze({ query: { ...q }, deps: offline });
  const c = await handleAnalyze({ query: { ...q, mode: 'pct', tgt: '3', stp: '1.5', hold: '7' }, deps: offline });
  assert.equal(a.body.resultHash, b.body.resultHash);
  assert.equal(b.body.cacheHit, true);
  assert.equal(a.body.data.hash, c.body.data.hash);
  assert.notEqual(a.body.resultHash, c.body.resultHash);
});

test('analyze: POST com corpo JSON e janela em dias', async () => {
  const r = await handleAnalyze({ method: 'POST', body: { symbol: 'btcusdt', timeframe: '1D', cfg: { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, windowDays: 730 }, deps: offline });
  assert.equal(r.status, 200);
  assert.equal(r.body.input.windowDays, 730);
  assert.equal(r.body.data.candles, 930);
});

test('analyze: parâmetros inválidos devolvem 400 com mensagem', async () => {
  for (const q of [{}, { symbol: 'DOGEUSDT', tf: '4h' }, { symbol: 'BTCUSDT', tf: '15m' }, { symbol: 'BTCUSDT', tf: '4h', mode: 'x' }, { symbol: 'BTCUSDT', tf: '4h', hold: '0' }, { symbol: 'BTCUSDT', tf: '4h', tgt: '-1' }, { symbol: 'BTCUSDT', tf: '4h', windowDays: '5' }]) {
    const r = await handleAnalyze({ query: q, deps: offline });
    assert.equal(r.status, 400, JSON.stringify(q));
    assert.equal(r.body.error.code, 'requisicao_invalida');
  }
  assert.equal((await handleAnalyze({ method: 'DELETE' })).status, 405);
  assert.equal(parseAnalyzeInput({ symbol: 'BTCUSDT', tf: '4h', live: '0' }).value.live, false);
});

test('analyze: falha ao carregar dados devolve 503 e nenhum número', async () => {
  const r = await handleAnalyze({ query: { symbol: 'BTCUSDT', tf: '4h' }, deps: { loadSeries: async () => { throw new Error('fora'); } } });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'dados_indisponiveis');
  assert.equal('setups' in r.body, false);
});

test('série: rede fora cai para o snapshot e avisa; candle ainda aberto nunca entra', async () => {
  const down = await loadSeries('BTCUSDT', '1d', { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(down.source, 'snapshot');
  assert.match(down.liveError, /offline/);

  const snap = snapshotSeries('BTCUSDT', '1d');
  const last = snap.t[snap.n - 1], day = 86400;
  const kline = (t, c) => [t * 1000, '100', '110', '90', String(c), '5', (t + day) * 1000 - 1];
  const now = (last + 4 * day) * 1000 - 5000; // 5 s antes de o terceiro candle novo fechar: ele ainda está aberto
  const fetchImpl = async () => ({ ok: true, json: async () => [kline(last + day, 101), kline(last + 2 * day, 102), kline(last + 3 * day, 103)] });
  const live = await loadSeries('BTCUSDT', '1d', { fetchImpl, now });
  assert.equal(live.source, 'live');
  assert.equal(live.d.n, snap.n + 2);
  assert.equal(live.d.c[live.d.n - 1], 102);
});

test('health: informa versão e presença de configuração, sem valores', () => {
  const r = handleHealth({ env: { DEEPSEEK_API_KEY: 'sk-segredo', ARGOS_LLM_MODEL: 'modelo-teste', DATABASE_URL: 'postgres://u:senha@h/db' }, now: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.engine, 'argos-engine 1.1.0');
  assert.equal(r.body.llm, 'configurado');
  assert.equal(r.body.database, 'configurado');
  assert.equal(JSON.stringify(r.body).includes('segredo'), false);
  assert.equal(JSON.stringify(r.body).includes('senha'), false);
});

test('analyze: brief=1 devolve só a identificação do resultado, com o mesmo hash do resumo completo', async () => {
  const full = await handleAnalyze({ query: { symbol: 'SOLUSDT', tf: '1d' }, deps: offline });
  const brief = await handleAnalyze({ query: { symbol: 'SOLUSDT', tf: '1d', brief: '1' }, deps: offline });
  assert.equal(brief.status, 200);
  assert.deepEqual(Object.keys(brief.body).sort(), ['cacheHit', 'data', 'disclaimer', 'engine', 'input', 'ms', 'resultHash']);
  assert.equal(brief.body.resultHash, full.body.resultHash);
  assert.deepEqual(brief.body.data, full.body.data);
  assert.ok(JSON.stringify(brief.body).length < 2500);
});

test('source=snapshot lê só o snapshot versionado, mesmo havendo base de candles, e entra na chave de cache', async () => {
  const { snapshotSeries } = await import('../lib/data/series.js');
  const dbLike = async (symbol, timeframe) => { const d = snapshotSeries(symbol, timeframe); const cut = { ...d, n: d.n - 5 }; for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) cut[f] = d[f].slice(0, d.n - 5); return { d: cut, source: 'database' }; };
  const q = { symbol: 'BTCUSDT', tf: '1d' };
  const fromDb = await handleAnalyze({ query: q, deps: { loadSeries: dbLike } });
  const snap = await handleAnalyze({ query: { ...q, source: 'snapshot' } });
  assert.equal(fromDb.body.data.source, 'database');
  assert.equal(snap.status, 200);
  assert.equal(snap.body.data.source, 'snapshot');
  assert.notEqual(snap.body.resultHash, fromDb.body.resultHash);
  const again = await handleAnalyze({ query: { ...q, source: 'snapshot' } });
  assert.equal(again.body.resultHash, snap.body.resultHash, 'reprodutível');
  const bad = await handleAnalyze({ query: { ...q, source: 'banco' } });
  assert.equal(bad.status, 400);
});
