// Termômetro (lib/jobs/termometro.js e handlers) no PGlite: registro prospectivo do gatilho do último candle e desfechos depois.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../engine/index.js';
import { snapshotSeries } from '../lib/data/series.js';
import { createTestDb } from '../lib/db.js';
import { DEFAULT_CFG } from '../lib/handlers/analyze.js';
import { handleCronCandles } from '../lib/handlers/cron-candles.js';
import { handleCronTermometro } from '../lib/handlers/cron-termometro.js';
import { runTermometro, originRef, whyNotFresh } from '../lib/jobs/termometro.js';
import { openPredictions } from '../lib/prospective.js';
import { migrate } from '../tools/migrate.mjs';

const SYM = 'BTCUSDT', TF = '1h';
const full = snapshotSeries(SYM, TF);
const prefix = (d, k) => { const out = { ...d, n: k }; for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) out[f] = d[f].slice(0, k); return out; };
const run = (d) => analyze(d, { ...DEFAULT_CFG }, { sym: SYM, tf: TF, source: 'snapshot', win: null });
/** "Agora" de uma série: cinco minutos depois do fechamento do último candle (como o cron das 00h05 UTC). */
const nowFor = (d) => (d.t[d.n - 1] + d.dt) * 1000 + 5 * 60_000;
/** Loader que se comporta como o banco: série em dia, com source 'database'. */
const loaderAt = (k) => async () => ({ d: prefix(full, k), source: 'database' });
const only = { symbols: [SYM], timeframes: [TF] };
const lastBarOpens = (A) => openPredictions(A).filter((x) => x.p !== null && x.index === A.d.n - 1);

// "hoje" simulado: um corte em que algum setup dispara no último candle e tem probabilidade
let cutN = null;
for (let k = full.n - 100; k > full.n - 4000 && cutN === null; k--) if (lastBarOpens(run(prefix(full, k))).length) cutN = k;

let db;
before(async () => { db = await createTestDb(); });
after(() => db.close());
async function fresh() { await db.exec('drop schema public cascade; create schema public;'); await migrate(db, { log: () => {} }); }
const count = async (sql) => (await db.query(sql)).rows[0].c;

test('há um corte com gatilho no último candle para testar', () => assert.ok(cutN !== null));

test('registra só o gatilho do último candle, com a probabilidade do motor, e repetir não duplica', async () => {
  await fresh();
  const d = prefix(full, cutN), A = run(d), opens = lastBarOpens(A);
  const r1 = await runTermometro(db, { ...only, now: nowFor(d), loadSeries: loaderAt(cutN) });
  assert.equal(r1.errors, 0, JSON.stringify(r1.series));
  assert.equal(r1.registered, opens.length);
  // gatilhos mais antigos ainda em aberto existem, mas NÃO são registrados (já andaram candles)
  assert.ok(openPredictions(A).filter((x) => x.p !== null).length >= opens.length);
  const rows = (await db.query("select * from previsoes where origin = 'termometro' order by setup_id")).rows;
  assert.equal(rows.length, opens.length);
  for (const o of opens) {
    const row = rows.find((x) => x.origin_ref === originRef(SYM, TF, o.setupId, o.barTime));
    assert.ok(row, o.setupId);
    assert.equal(row.prob, o.p);
    assert.equal(row.base_rate, o.r);
    assert.equal(row.n, o.n);
    assert.equal(new Date(row.bar_time).getTime(), o.barTime * 1000);
    assert.equal(row.payload.prospective.p, o.p);
    assert.equal(row.payload.prospective.elapsedBars, 0);
    assert.equal(row.payload.origin, 'termometro');
  }
  const again = await runTermometro(db, { ...only, now: nowFor(d) + 60_000, loadSeries: loaderAt(cutN) });
  assert.equal(again.registered, 0, 'mesma série, nada novo');
  assert.equal(await count("select count(*)::int as c from previsoes where origin = 'termometro'"), rows.length);
});

test('quando a janela fecha, grava o desfecho do motor, uma vez só, também com duas execuções simultâneas', async () => {
  await fresh();
  await runTermometro(db, { ...only, now: nowFor(prefix(full, cutN)), loadSeries: loaderAt(cutN) });
  assert.ok((await count("select count(*)::int as c from previsoes where origin = 'termometro'")) > 0);
  assert.equal(await count('select count(*)::int as c from desfechos'), 0);
  const later = run(prefix(full, cutN + 40)); // 40 candles depois: as janelas de 12 já fecharam
  const opts = { ...only, now: nowFor(later.d), loadSeries: loaderAt(cutN + 40) };
  const [r1, r2] = await Promise.all([runTermometro(db, opts), runTermometro(db, opts)]);
  assert.equal(r1.errors + r2.errors, 0, JSON.stringify([r1.series, r2.series]));
  const outs = (await db.query('select d.*, p.bar_time as pbar from desfechos d join previsoes p on p.id = d.previsao_id')).rows;
  assert.ok(outs.length > 0);
  assert.equal(r1.resolved + r2.resolved, outs.length, 'cada desfecho foi gravado por uma execução só');
  for (const d of outs) {
    const i = later.d.t.indexOf(new Date(d.pbar).getTime() / 1000);
    assert.ok(i >= 0 && later.outs[i], 'desfecho existe no motor');
    assert.equal(d.outcome, later.outs[i].type);
    assert.equal(d.ret, later.outs[i].ret);
    assert.equal(d.bars, later.outs[i].bars);
  }
  const before = outs.length;
  await runTermometro(db, opts);
  assert.equal(await count('select count(*)::int as c from desfechos'), before, 'repetir não duplica nem falha');
});

test('recusa série de fallback, série atrasada e série sem banco: nada é registrado', async () => {
  await fresh();
  const d = prefix(full, cutN), now = nowFor(d);
  const snap = async () => ({ d, source: 'snapshot' });
  const dbErr = async () => ({ d, source: 'snapshot', dbError: 'sem candles no banco' });
  const stale = loaderAt(cutN);
  for (const [loader, nowMs, why] of [[snap, now, 'serie_fora_do_banco'], [dbErr, now, 'serie_fora_do_banco'], [stale, now + 2 * d.dt * 1000, 'serie_atrasada']]) {
    const r = await runTermometro(db, { ...only, now: nowMs, loadSeries: loader });
    assert.equal(r.registered, 0);
    assert.equal(r.series[0].error, why);
  }
  assert.equal(await count('select count(*)::int as c from previsoes'), 0);
  assert.equal(whyNotFresh({ d, source: 'database' }, now), null);
  assert.equal(whyNotFresh({ d, source: 'database' }, (d.t[d.n - 1] + d.dt) * 1000 - 1), 'candle_ainda_aberto');
});

test('previsão com regra de saída diferente da padrão não recebe desfecho; janela com buraco também não', async () => {
  await fresh();
  const d = prefix(full, cutN);
  await runTermometro(db, { ...only, now: nowFor(d), loadSeries: loaderAt(cutN) });
  await db.exec("alter table previsoes disable trigger previsoes_append_only"); // só no teste: simula um registro com outra regra
  await db.exec(`update previsoes set params = jsonb_set(params, '{cfg,tgt}', '3') where origin = 'termometro'`);
  await db.exec('alter table previsoes enable trigger previsoes_append_only');
  const later = prefix(full, cutN + 40);
  const r = await runTermometro(db, { ...only, now: nowFor(later), loadSeries: loaderAt(cutN + 40) });
  assert.equal(r.resolved, 0);
  assert.equal(await count('select count(*)::int as c from desfechos'), 0);
  // buraco: apaga um candle dentro da janela
  await fresh();
  await runTermometro(db, { ...only, now: nowFor(d), loadSeries: loaderAt(cutN) });
  const holey = prefix(full, cutN + 40);
  const skip = cutN + 3; // um candle dentro das 12 barras seguintes ao gatilho
  for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) holey[f] = holey[f].filter((_, j) => j !== skip);
  holey.n -= 1;
  const r2 = await runTermometro(db, { ...only, now: nowFor(holey), loadSeries: async () => ({ d: holey, source: 'database' }) });
  assert.equal(r2.resolved, 0, 'janela com buraco não vira desfecho');
});

test('prazo estourado: pula as séries e diz quantas', async () => {
  await fresh();
  const r = await runTermometro(db, { now: nowFor(prefix(full, cutN)), loadSeries: loaderAt(cutN), deadline: 0 });
  assert.equal(r.skipped, 9);
  assert.equal(r.registered, 0);
});

test('uma série com erro não impede as outras', async () => {
  await fresh();
  const d = prefix(full, cutN);
  const loader = async (s, tf) => { if (tf === '4h') throw new Error('sem dados'); return { d, source: 'database' }; };
  const r = await runTermometro(db, { symbols: [SYM], timeframes: ['1h', '4h'], now: nowFor(d), loadSeries: loader });
  assert.equal(r.errors, 1);
  assert.ok(r.registered > 0);
});

test('handlers: exigem CRON_SECRET e banco; o de candles encadeia o Termômetro sem derrubar a ingestão', async () => {
  const env = { CRON_SECRET: 'segredo-de-teste-123', DATABASE_URL: 'x' };
  assert.equal((await handleCronTermometro({ authorization: 'Bearer errado', env })).status, 401);
  assert.equal((await handleCronTermometro({ authorization: undefined, env })).status, 401);
  assert.equal((await handleCronTermometro({ authorization: 'Bearer segredo-de-teste-123', env: { CRON_SECRET: 'segredo-de-teste-123' } })).status, 503);
  const ok = await handleCronTermometro({ authorization: 'Bearer segredo-de-teste-123', env, deps: { db: {}, log() {}, termometro: async () => ({ series: [], registered: 0, resolved: 0, errors: 0, skipped: 0 }) } });
  assert.equal(ok.status, 200);
  const lines = [];
  const chained = await handleCronCandles({ authorization: 'Bearer segredo-de-teste-123', env, deps: { db: {}, log: (l) => lines.push(l), ingest: async () => ({ series: [], seeded: 0, fetched: 0, errors: 0 }), termometro: async () => ({ series: [], registered: 3, resolved: 1, errors: 0, skipped: 0 }) } });
  assert.equal(chained.status, 200);
  assert.equal(chained.body.termometro.registered, 3);
  assert.equal(JSON.parse(lines[0]).termometro.registered, 3, 'o log traz o resumo');
  const broken = await handleCronCandles({ authorization: 'Bearer segredo-de-teste-123', env, deps: { db: {}, log() {}, ingest: async () => ({ series: [], seeded: 0, fetched: 5, errors: 0 }), termometro: async () => { throw new Error('boom'); } } });
  assert.equal(broken.status, 207, 'falha do Termômetro vira 207, não 500');
  assert.equal(broken.body.fetched, 5, 'a ingestão continua no relatório');
  assert.match(broken.body.termometro.error, /boom/);
});
