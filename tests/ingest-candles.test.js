import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';
import { ingestCandles } from '../lib/jobs/ingest-candles.js';
import { readCandles } from '../lib/repo/candles.js';
import { snapshotSeries } from '../lib/data/series.js';
import { hashCanonical } from '../lib/canonical.js';

const DAY = 86400;
const snap = snapshotSeries('BTCUSDT', '1d');
const last = snap.t[snap.n - 1];
const kline = (t, c) => [t * 1000, '100', '110', '90', String(c), '5', (t + DAY) * 1000 - 1];
// fonte simulada: três candles depois do snapshot; respeita startTime como a Binance
const source = (calls) => async (url) => {
  calls.push(url);
  const start = Number(new URL(url).searchParams.get('startTime') || 0);
  const all = [kline(last + DAY, 101), kline(last + 2 * DAY, 102), kline(last + 3 * DAY, 103)];
  return { ok: true, json: async () => all.filter((k) => k[0] >= start) };
};
const only = { symbols: ['BTCUSDT'], timeframes: ['1d'], seed: (s, tf) => [snapshotSeries(s, tf)] };

test('ingestão: banco vazio recebe a semente e os candles fechados novos; o aberto fica de fora', async () => {
  const db = await createTestDb();
  await migrate(db, { log: () => {} });
  const calls = [];
  const now = (last + 4 * DAY) * 1000 - 5000; // o terceiro candle novo ainda está aberto
  const r = await ingestCandles(db, { ...only, now, fetchImpl: source(calls) });
  assert.equal(r.errors, 0);
  assert.equal(r.seeded, snap.n);
  assert.equal(r.fetched, 2);
  const d = await readCandles(db, { symbol: 'BTCUSDT', timeframe: '1d' });
  assert.equal(d.n, snap.n + 2);
  assert.equal(d.c[d.n - 1], 102);
  // o que saiu do banco é, candle a candle, o que entrou: o motor recebe a mesma série
  const head = { ...d, t: d.t.slice(0, snap.n), o: d.o.slice(0, snap.n), h: d.h.slice(0, snap.n), l: d.l.slice(0, snap.n), c: d.c.slice(0, snap.n), v: d.v.slice(0, snap.n), n: snap.n };
  assert.equal(hashCanonical([head.dt, head.t, head.o, head.h, head.l, head.c, head.v]), hashCanonical([snap.dt, snap.t, snap.o, snap.h, snap.l, snap.c, snap.v]));
  await db.close();
});

test('ingestão: rodar de novo não grava nada; quando o candle fecha, entra só ele', async () => {
  const db = await createTestDb();
  await migrate(db, { log: () => {} });
  const calls = [];
  const fetchImpl = source(calls);
  await ingestCandles(db, { ...only, now: (last + 4 * DAY) * 1000 - 5000, fetchImpl });
  const again = await ingestCandles(db, { ...only, now: (last + 4 * DAY) * 1000 - 4000, fetchImpl });
  assert.equal(again.seeded, 0);
  assert.equal(again.fetched, 0);
  const later = await ingestCandles(db, { ...only, now: (last + 4 * DAY) * 1000 + 1000, fetchImpl });
  assert.equal(later.fetched, 1);
  assert.equal(later.series[0].last, new Date((last + 3 * DAY) * 1000).toISOString());
  await db.close();
});

test('ingestão: fonte fora do ar é relatada por série e não derruba o job', async () => {
  const db = await createTestDb();
  await migrate(db, { log: () => {} });
  const r = await ingestCandles(db, { ...only, now: (last + 9 * DAY) * 1000, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(r.errors, 1);
  assert.match(r.series[0].error, /offline/);
  assert.equal(r.seeded, snap.n); // a semente foi gravada antes da falha de rede
  await db.close();
});
