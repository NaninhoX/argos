// Termômetro (lib/jobs/termometro.js e handlers) no PGlite: registro prospectivo de gatilhos em aberto e desfechos depois.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../engine/index.js';
import { snapshotSeries } from '../lib/data/series.js';
import { createTestDb } from '../lib/db.js';
import { DEFAULT_CFG } from '../lib/handlers/analyze.js';
import { handleCronCandles } from '../lib/handlers/cron-candles.js';
import { handleCronTermometro } from '../lib/handlers/cron-termometro.js';
import { runTermometro, originRef } from '../lib/jobs/termometro.js';
import { openPredictions } from '../lib/prospective.js';
import { migrate } from '../tools/migrate.mjs';

const SYM = 'BTCUSDT', TF = '1h';
const full = snapshotSeries(SYM, TF);
const prefix = (d, k) => { const out = { ...d, n: k }; for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) out[f] = d[f].slice(0, k); return out; };
const run = (d) => analyze(d, { ...DEFAULT_CFG }, { sym: SYM, tf: TF, source: 'snapshot', win: null });
const loaderAt = (k) => async () => ({ d: prefix(full, k), source: 'snapshot' });
const only = { symbols: [SYM], timeframes: [TF] };

// "hoje" simulado: um corte com gatilhos em aberto que têm probabilidade
let cutN = null;
for (let k = full.n - 200; k > full.n - 1500 && cutN === null; k -= 7) if (openPredictions(run(prefix(full, k))).some((x) => x.p !== null)) cutN = k;

let db;
before(async () => { db = await createTestDb(); });
after(() => db.close());
async function fresh() { await db.exec('drop schema public cascade; create schema public;'); await migrate(db, { log: () => {} }); }

test('há um corte com gatilho em aberto para testar', () => assert.ok(cutN !== null));

test('registra um gatilho em aberto uma vez, com a probabilidade do motor, e repetir não duplica', async () => {
  await fresh();
  const A = run(prefix(full, cutN)), opens = openPredictions(A).filter((x) => x.p !== null);
  const r1 = await runTermometro(db, { ...only, now: 1_790_000_000_000, loadSeries: loaderAt(cutN) });
  assert.equal(r1.errors, 0);
  assert.equal(r1.registered, opens.length);
  const rows = (await db.query("select * from previsoes where origin = 'termometro' order by bar_time, setup_id")).rows;
  assert.equal(rows.length, opens.length);
  for (const o of opens) {
    const row = rows.find((x) => x.origin_ref === originRef(SYM, TF, o.setupId, o.barTime));
    assert.ok(row, o.setupId);
    assert.equal(row.prob, o.p);
    assert.equal(row.base_rate, o.r);
    assert.equal(row.n, o.n);
    assert.equal(new Date(row.bar_time).getTime(), o.barTime * 1000);
    assert.equal(row.payload.prospective.p, o.p);
    assert.equal(row.payload.origin, 'termometro');
  }
  const r2 = await runTermometro(db, { ...only, now: 1_790_000_500_000, loadSeries: loaderAt(cutN + 2) });
  assert.equal((await db.query("select count(*)::int as c from previsoes where origin = 'termometro'")).rows[0].c, rows.length + r2.registered);
  const again = await runTermometro(db, { ...only, now: 1_790_000_900_000, loadSeries: loaderAt(cutN + 2) });
  assert.equal(again.registered, 0, 'mesma série, nada novo');
});

test('quando a janela fecha, grava o desfecho do motor, uma vez só, e só das previsões do Termômetro', async () => {
  await fresh();
  await runTermometro(db, { ...only, now: 1_790_000_000_000, loadSeries: loaderAt(cutN) });
  const pending = (await db.query("select id, bar_time from previsoes where origin = 'termometro'")).rows;
  assert.ok(pending.length > 0);
  assert.equal((await db.query('select count(*)::int as c from desfechos')).rows[0].c, 0);
  const later = run(prefix(full, cutN + 40)); // 40 candles depois: as janelas de 12 já fecharam
  const r = await runTermometro(db, { ...only, now: 1_790_100_000_000, loadSeries: loaderAt(cutN + 40) });
  assert.equal(r.errors, 0, JSON.stringify(r.series));
  const outs = (await db.query('select d.*, p.bar_time as pbar from desfechos d join previsoes p on p.id = d.previsao_id')).rows;
  assert.ok(outs.length > 0);
  for (const d of outs) {
    const i = later.d.t.indexOf(new Date(d.pbar).getTime() / 1000);
    assert.ok(i >= 0 && later.outs[i], 'desfecho existe no motor');
    assert.equal(d.outcome, later.outs[i].type);
    assert.equal(d.ret, later.outs[i].ret);
    assert.equal(d.bars, later.outs[i].bars);
  }
  const before = outs.length;
  await runTermometro(db, { ...only, now: 1_790_200_000_000, loadSeries: loaderAt(cutN + 40) });
  assert.equal((await db.query('select count(*)::int as c from desfechos')).rows[0].c, before, 'repetir não duplica nem falha');
});

test('prazo estourado: pula as séries e diz quantas', async () => {
  await fresh();
  const r = await runTermometro(db, { now: 1_790_000_000_000, loadSeries: loaderAt(cutN), deadline: 0 });
  assert.equal(r.skipped, 9);
  assert.equal(r.registered, 0);
});

test('uma série com erro não impede as outras', async () => {
  await fresh();
  const loader = async (s, tf) => { if (tf === '4h') throw new Error('sem dados'); return { d: prefix(full, cutN), source: 'snapshot' }; };
  const r = await runTermometro(db, { symbols: [SYM], timeframes: ['1h', '4h'], now: 1_790_000_000_000, loadSeries: loader });
  assert.equal(r.errors, 1);
  assert.ok(r.registered > 0);
});

test('handlers: exigem CRON_SECRET e banco; o de candles encadeia o Termômetro sem derrubar a ingestão', async () => {
  const env = { CRON_SECRET: 'segredo-de-teste-123', DATABASE_URL: 'x' };
  assert.equal((await handleCronTermometro({ authorization: 'Bearer errado', env })).status, 401);
  assert.equal((await handleCronTermometro({ authorization: undefined, env })).status, 401);
  assert.equal((await handleCronTermometro({ authorization: 'Bearer segredo-de-teste-123', env: { CRON_SECRET: 'segredo-de-teste-123' } })).status, 503);
  const ok = await handleCronTermometro({ authorization: 'Bearer segredo-de-teste-123', env, deps: { db: {}, termometro: async () => ({ series: [], registered: 0, resolved: 0, errors: 0, skipped: 0 }) } });
  assert.equal(ok.status, 200);
  const chained = await handleCronCandles({ authorization: 'Bearer segredo-de-teste-123', env, deps: { db: {}, ingest: async () => ({ series: [], seeded: 0, fetched: 0, errors: 0 }), termometro: async () => ({ series: [], registered: 3, resolved: 1, errors: 0, skipped: 0 }) } });
  assert.equal(chained.status, 200);
  assert.equal(chained.body.termometro.registered, 3);
  const broken = await handleCronCandles({ authorization: 'Bearer segredo-de-teste-123', env, deps: { db: {}, ingest: async () => ({ series: [], seeded: 0, fetched: 5, errors: 0 }), termometro: async () => { throw new Error('boom'); } } });
  assert.equal(broken.status, 207, 'falha do Termômetro vira 207, não 500');
  assert.equal(broken.body.fetched, 5, 'a ingestão continua no relatório');
  assert.match(broken.body.termometro.error, /boom/);
});
