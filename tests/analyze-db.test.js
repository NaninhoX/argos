// O caminho pelo banco devolve exatamente o mesmo resultado que o caminho pelo snapshot: os candles
// entram e saem do Postgres sem perda, e o motor não sabe de onde vieram.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';
import { upsertCandles } from '../lib/repo/candles.js';
import { handleAnalyze, defaultSeriesLoader } from '../lib/handlers/analyze.js';
import { handleCronCandles } from '../lib/handlers/cron-candles.js';
import { snapshotSeries } from '../lib/data/series.js';

test('analyze pelo banco: mesmo resultHash que pelo snapshot (ETHUSDT 1d)', async () => {
  const db = await createTestDb();
  await migrate(db, { log: () => {} });
  await upsertCandles(db, { symbol: 'ETHUSDT', timeframe: '1d', series: snapshotSeries('ETHUSDT', '1d') });
  const q = { symbol: 'ETHUSDT', tf: '1d', hold: '11' }; // hold fora do padrão: não reaproveita cache de outros testes
  const viaDb = await handleAnalyze({ query: q, deps: { loadSeries: defaultSeriesLoader({}, db) } });
  const viaSnap = await handleAnalyze({ query: { ...q, hold: '11' }, deps: { loadSeries: async (s, tf) => ({ d: snapshotSeries(s, tf), source: 'snapshot' }) } });
  assert.equal(viaDb.status, 200);
  assert.equal(viaDb.body.data.source, 'database');
  assert.equal(viaSnap.body.data.source, 'snapshot');
  assert.equal(viaDb.body.data.hash, viaSnap.body.data.hash);
  assert.equal(viaDb.body.resultHash, viaSnap.body.resultHash);
  assert.deepEqual(viaDb.body.setups, viaSnap.body.setups);
  await db.close();
});

test('analyze pelo banco: série ausente no banco cai para snapshot e diz por quê', async () => {
  const db = await createTestDb();
  await migrate(db, { log: () => {} });
  const r = await handleAnalyze({ query: { symbol: 'SOLUSDT', tf: '1d', live: '0', hold: '9' }, deps: { loadSeries: defaultSeriesLoader({}, db) } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.source, 'snapshot');
  assert.match(r.body.data.dbError, /sem candles no banco/);
  await db.close();
});

test('cron de candles: exige o segredo e relata o que fez', async () => {
  const env = { CRON_SECRET: 's3gredo-de-teste', DATABASE_URL: 'postgres://nao-usado' };
  const ingest = async () => ({ series: [], seeded: 0, fetched: 3, errors: 0 });
  const termometro = async () => ({ series: [], registered: 0, resolved: 0, errors: 0, skipped: 0 }); // o encadeamento tem teste próprio (termometro.test.js)
  assert.equal((await handleCronCandles({ env, deps: { db: {}, ingest, termometro } })).status, 401);
  assert.equal((await handleCronCandles({ authorization: 'Bearer errado', env, deps: { db: {}, ingest, termometro } })).status, 401);
  assert.equal((await handleCronCandles({ authorization: 'Bearer s3gredo-de-teste', env: { CRON_SECRET: 's3gredo-de-teste' } })).status, 503);
  const ok = await handleCronCandles({ authorization: 'Bearer s3gredo-de-teste', env, deps: { db: {}, ingest, termometro } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.fetched, 3);
  const partial = await handleCronCandles({ authorization: 'Bearer s3gredo-de-teste', env, deps: { db: {}, ingest: async () => ({ series: [], seeded: 0, fetched: 0, errors: 1 }), termometro } });
  assert.equal(partial.status, 207);
});
