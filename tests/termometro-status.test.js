// GET /api/termometro/status (handler puro) no PGlite: contagens, alertas de silêncio e proteção por código.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../lib/db.js';
import { handleTermometroStatus } from '../lib/handlers/termometro-status.js';
import { insertDesfecho } from '../lib/repo/desfechos.js';
import { insertPrevisao } from '../lib/repo/previsoes.js';
import { upsertCandles } from '../lib/repo/candles.js';
import { migrate } from '../tools/migrate.mjs';

let db;
before(async () => { db = await createTestDb(); });
after(() => db.close());
async function fresh() { await db.exec('drop schema public cascade; create schema public;'); await migrate(db, { log: () => {} }); }

const HEX = (n) => n.toString(16).padStart(64, '0');
let seq = 0;
async function prev({ symbol = 'BTCUSDT', timeframe = '4h', barTime, emittedAt, origin = 'termometro' }) {
  seq++;
  const r = await insertPrevisao(db, {
    setup_id: 'RSI_OVERSOLD', symbol, timeframe, params: { x: seq }, prob: 0.25, base_rate: 0.25, n: 30, n_eff: 25, verdict: 'SEM_EDGE',
    bar_time: barTime, data_cut: emittedAt, emitted_at: emittedAt, origin, origin_ref: `${symbol}:${timeframe}:${seq}`, engine_version: 'argos-engine 1.1.0',
    payload: { seq }, hash: HEX(seq)
  });
  return r.id;
}
const okEnv = { DATABASE_URL: 'x' };
const call = (over = {}) => handleTermometroStatus({ env: okEnv, deps: { db, ...over.deps }, ...over.req });
const NOW = Date.parse('2026-10-20T00:10:00Z');

test('protege: método, código ausente/errado, produção sem código configurado, banco ausente', async () => {
  assert.equal((await handleTermometroStatus({ method: 'POST', env: okEnv, deps: { db } })).status, 405);
  const env = { ...okEnv, ARGOS_ACCESS_CODE: 'segredo' };
  assert.equal((await handleTermometroStatus({ env, deps: { db } })).status, 401);
  assert.equal((await handleTermometroStatus({ env, code: 'errado', deps: { db } })).status, 401);
  assert.equal((await handleTermometroStatus({ env: { ...okEnv, VERCEL_ENV: 'production' }, deps: { db } })).status, 503, 'falha fechado em produção sem código');
  assert.equal((await handleTermometroStatus({ env: { ARGOS_ACCESS_CODE: 'segredo' }, code: 'segredo' })).body.error.code, 'banco_ausente');
  await fresh();
  const ok = await handleTermometroStatus({ env, code: 'segredo', deps: { db, now: NOW } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['cache-control'], 'no-store');
});

test('banco vazio: alerta sem_registros e sem_candles, nada inventado', async () => {
  await fresh();
  const out = await call({ deps: { now: NOW } });
  assert.equal(out.body.status, 'atencao');
  assert.deepEqual(out.body.alerts.map((a) => a.code).sort(), ['sem_candles', 'sem_registros']);
  assert.equal(out.body.totals.registered, 0);
  assert.equal(out.body.totals.startedAt, null);
});

test('conta registros e desfechos só do Termômetro, por série, por resultado e por dia', async () => {
  await fresh();
  const hour = 3600_000;
  const real = Date.now();
  await upsertCandles(db, { symbol: 'BTCUSDT', timeframe: '4h', series: [{ t: Math.floor((real - 5 * hour) / 1000), o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] });
  const a = await prev({ barTime: new Date(real - 30 * hour), emittedAt: new Date(real - 30 * hour) });
  const b = await prev({ barTime: new Date(real - 20 * hour), emittedAt: new Date(real - 20 * hour) });
  await prev({ symbol: 'ETHUSDT', timeframe: '1h', barTime: new Date(real - 2 * hour), emittedAt: new Date(real - 2 * hour) });
  await prev({ origin: 'demo', barTime: new Date(real - hour), emittedAt: new Date(real - hour) }); // não conta
  await insertDesfecho(db, { previsao_id: a, outcome: 'WIN', ret: 0.02, bars: 5, bar_time: new Date(real - 10 * hour), resolved_at: new Date(real - hour) });
  await insertDesfecho(db, { previsao_id: b, outcome: 'TIMEOUT', ret: 0, bars: 12, bar_time: new Date(real - 5 * hour), resolved_at: new Date(real - hour) });
  const out = (await call({ deps: { now: real } })).body;
  assert.equal(out.totals.registered, 3);
  assert.equal(out.totals.resolved, 2);
  assert.equal(out.totals.open, 1);
  assert.deepEqual(out.totals.outcomes, { TIMEOUT: 1, WIN: 1 });
  const btc = out.series.find((s) => s.symbol === 'BTCUSDT');
  assert.deepEqual([btc.registered, btc.resolved, btc.open], [2, 2, 0]);
  const eth = out.series.find((s) => s.symbol === 'ETHUSDT');
  assert.deepEqual([eth.registered, eth.resolved, eth.open], [1, 0, 1]);
  assert.equal(out.perDay.registered.reduce((s, r) => s + r.n, 0), 3);
  assert.equal(out.perDay.resolved.reduce((s, r) => s + r.n, 0), 2);
  assert.equal(out.candles[0].lagCandles, 0);
  assert.equal(out.status, 'ok', JSON.stringify(out.alerts));
  assert.ok(!JSON.stringify(out).includes('"prob"'), 'nenhuma probabilidade sai por aqui');
});

test('alertas: ingestão parada, sem registro recente e desfecho atrasado', async () => {
  await fresh();
  const hour = 3600_000, real = Date.now();
  await upsertCandles(db, { symbol: 'BTCUSDT', timeframe: '4h', series: [{ t: Math.floor((real - 5 * hour) / 1000), o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] });
  // janela de 12 candles de 4 h fechou há muito (barra de 20 dias atrás) e não há desfecho
  await prev({ barTime: new Date(real - 480 * hour), emittedAt: new Date(real - 480 * hour) });
  const out = (await call({ deps: { now: real + 40 * hour } })).body; // 40 h depois da última inserção de candle
  const codes = out.alerts.map((a) => a.code);
  assert.ok(codes.includes('ingestao_parada'));
  assert.ok(codes.includes('sem_registro_recente'));
  assert.ok(codes.includes('desfecho_atrasado'));
  assert.equal(out.status, 'atencao');
  // limiares por ambiente: com cadência por candle, 3 h já é silêncio
  const strict = (await call({ req: { env: { ...okEnv, ARGOS_INGEST_MAX_AGE_H: '3' } }, deps: { now: real + 4 * hour } })).body;
  assert.ok(strict.alerts.some((a) => a.code === 'ingestao_parada'));
  assert.equal(strict.thresholds.ingestMaxAgeH, 3);
});

test('calibração interna no painel: TIMEOUT conta como não-acerto, abaixo de 30 é insuficiente, com 30 ou mais calcula', async () => {
  await fresh();
  const hour = 3600_000, real = Date.now();
  await upsertCandles(db, { symbol: 'BTCUSDT', timeframe: '4h', series: [{ t: Math.floor((real - 5 * hour) / 1000), o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] });
  const ids = [];
  for (let i = 0; i < 31; i++) ids.push(await prev({ barTime: new Date(real - (100 + i) * hour), emittedAt: new Date(real - (100 + i) * hour) }));
  for (let i = 0; i < 29; i++) await insertDesfecho(db, { previsao_id: ids[i], outcome: i % 4 === 0 ? 'WIN' : i % 4 === 1 ? 'TIMEOUT' : 'LOSS', ret: 0, bars: 12, bar_time: new Date(real - hour), resolved_at: new Date(real - hour) });
  const few = (await call({ deps: { now: real } })).body.calibration;
  assert.equal(few.n, 29);
  assert.equal(few.verdict, 'insuficiente');
  await insertDesfecho(db, { previsao_id: ids[29], outcome: 'LOSS', ret: 0, bars: 12, bar_time: new Date(real - hour), resolved_at: new Date(real - hour) });
  const enough = (await call({ deps: { now: real } })).body.calibration;
  assert.equal(enough.n, 30);
  assert.ok(['dentro_do_acaso', 'acima_do_acaso'].includes(enough.verdict));
  assert.ok(Number.isFinite(enough.ece) && enough.noise.eceP90 > 0);
  // 8 acertos em 30 (p registrado = 0,25): acerto de 26,7%, bem calibrado
  assert.ok(enough.bins.every((b) => b.reliable === (b.n >= 30)));
});
