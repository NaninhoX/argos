// GET /api/candles: candles fechados da base depois de `since`, para o navegador completar o snapshot.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { handleCandles } from '../lib/handlers/candles.js';
import { createTestDb } from '../lib/db.js';
import { upsertCandles } from '../lib/repo/candles.js';
import { migrate } from '../tools/migrate.mjs';

const DT = 3600, T0 = 1_760_000_000 - (1_760_000_000 % 3600); // hora cheia
let db;
before(async () => {
  db = await createTestDb();
  await migrate(db, { log: () => {} });
  const t = Array.from({ length: 10 }, (_, i) => T0 + i * DT);
  await upsertCandles(db, { symbol: 'BTCUSDT', timeframe: '1h', series: { t, o: t.map(() => 1), h: t.map(() => 2), l: t.map(() => 0.5), c: t.map(() => 1.5), v: t.map(() => 10), n: 10, dt: DT } });
});
after(() => db.close());
const call = (query, extra = {}) => handleCandles({ query, deps: { db, now: () => (T0 + 20 * DT) * 1000, ...extra } });

test('candles: devolve só o que vem depois de since, em ordem, no formato de linha do motor', async () => {
  const out = await call({ symbol: 'btcusdt', tf: '1h', since: String(T0 + 4 * DT) });
  assert.equal(out.status, 200);
  assert.equal(out.body.source, 'database');
  assert.deepEqual(out.body.rows.map((r) => r[0]), [5, 6, 7, 8, 9].map((i) => T0 + i * DT));
  assert.deepEqual(out.body.rows[0], [T0 + 5 * DT, 1, 2, 0.5, 1.5, 10]);
  assert.match(out.headers['cache-control'], /max-age=60/);
});

test('candles: candle ainda aberto não sai', async () => {
  const out = await handleCandles({ query: { symbol: 'BTCUSDT', tf: '1h', since: String(T0) }, deps: { db, now: () => (T0 + 9 * DT + 60) * 1000 } });
  assert.equal(out.body.rows.at(-1)[0], T0 + 8 * DT, 'o candle de T0+9h ainda está aberto');
});

test('candles: valida os parâmetros e responde sem banco', async () => {
  for (const q of [{}, { symbol: 'DOGEUSDT', tf: '1h' }, { symbol: 'BTCUSDT', tf: '5m' }, { symbol: 'BTCUSDT', tf: '1h', since: '-1' }, { symbol: 'BTCUSDT', tf: '1h', since: 'abc' }, { symbol: 'BTCUSDT', tf: '1h', since: '1.5' }]) {
    assert.equal((await call(q)).status, 400, JSON.stringify(q));
  }
  assert.equal((await handleCandles({ method: 'POST', query: {} })).status, 405);
  const none = await handleCandles({ query: { symbol: 'BTCUSDT', tf: '1h' }, env: {} });
  assert.equal(none.status, 503);
  assert.equal(none.body.error.code, 'sem_banco');
  const broken = await handleCandles({ query: { symbol: 'BTCUSDT', tf: '1h' }, deps: { db: { query: async () => { throw new Error('boom'); } } } });
  assert.equal(broken.status, 503);
  assert.equal(JSON.stringify(broken.body).includes('boom'), false);
});
