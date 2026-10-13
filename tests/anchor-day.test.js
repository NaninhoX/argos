// Job diário de ancoragem (lib/jobs/anchor-day.js) e o handler do cron, no PGlite. O carimbo é sempre falso: nada vai à rede.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { handleAnalyze } from '../lib/handlers/analyze.js';
import { handleCronAnchor } from '../lib/handlers/cron-anchor.js';
import { snapshotSeries } from '../lib/data/series.js';
import { createTestDb } from '../lib/db.js';
import { anchorDays } from '../lib/jobs/anchor-day.js';
import { merkleRoot, verifyProof } from '../lib/merkle.js';
import { buildPrevisao, dayManifest } from '../lib/previsao.js';
import { insertPrevisao, listClosedDaysWithoutProof, listOrphans } from '../lib/repo/previsoes.js';
import { getDayLeaves, getProva, getProvaForPrevisao } from '../lib/repo/provas.js';
import { migrate } from '../tools/migrate.mjs';

const offline = { loadSeries: async (s, tf) => ({ d: snapshotSeries(s, tf), source: 'snapshot' }) };
const SETUPS = ['RSI_OVERSOLD', 'MACD_CROSS', 'GOLDEN_CROSS', 'BB_LOWER', 'BREAKOUT_20', 'EMA_PULLBACK', 'BULL_ENGULFING', 'HAMMER'];
const at = (iso) => Date.parse(iso);

let summary;
let shared;
before(async () => {
  summary = (await handleAnalyze({ query: { symbol: 'BTCUSDT', tf: '4h' }, deps: offline })).body;
  shared = await createTestDb(); // criar o PGlite custa ~1 s: uma instância para o arquivo, esquema recriado a cada teste
});
after(() => shared.close());

/** Banco vazio e migrado. As tabelas append-only não aceitam TRUNCATE, então o esquema inteiro é recriado. */
async function freshDb() {
  await shared.exec('drop schema public cascade; create schema public;');
  await migrate(shared, { log: () => {} });
  return shared;
}

/** Grava `emittedAt.length` previsões (setups em rodízio) e devolve { id, hash, emittedAt }. */
async function seed(db, emittedAts) {
  const out = [];
  for (const [i, emittedAt] of emittedAts.entries()) {
    const p = buildPrevisao({ summary, setupId: SETUPS[i % SETUPS.length], emittedAt });
    const { id } = await insertPrevisao(db, p.row);
    out.push({ id, hash: p.hash, emittedAt });
  }
  return out;
}

const hoursOn = (day, n) => Array.from({ length: n }, (_, i) => `${day}T${String(8 + i).padStart(2, '0')}:00:00.000Z`);

/** Carimbo falso: devolve um recibo que contém o digest, para o teste conferir o que foi carimbado. */
function fakeStamp(calls = []) {
  const fn = async (digest) => {
    calls.push(digest);
    return { ots: Buffer.concat([Buffer.from('OTS-FALSO:'), Buffer.from(digest, 'hex')]), calendars: ['https://calendario.teste'], errors: [] };
  };
  fn.calls = calls;
  return fn;
}

const snapshotTables = async (db) => ({
  provas: (await db.query('select * from provas_merkle order by day')).rows,
  folhas: (await db.query('select * from previsao_prova order by day, leaf_index')).rows
});

test('fecha o dia encerrado, grava raiz e caminhos e carimba o digest do manifesto', async () => {
  const db = await freshDb();
  const stamp = fakeStamp();
  const day = '2026-10-10';
  const items = await seed(db, hoursOn(day, 3));
  const r = await anchorDays(db, { now: at('2026-10-11T00:10:00.000Z'), stamp });

  const leaves = items.map((x) => x.hash); // já emitidas em ordem crescente de instante
  const root = merkleRoot(leaves);
  assert.equal(r.errors, 0);
  assert.deepEqual(r.orphans, []);
  assert.deepEqual(r.days, [{ day, nLeaves: 3, root, status: 'ancorada', calendars: ['https://calendario.teste'] }]);

  const { manifestSha256 } = dayManifest({ day, nLeaves: 3, root });
  assert.deepEqual(stamp.calls, [manifestSha256], 'o que vai ao OpenTimestamps é o SHA-256 do manifesto');

  const prova = await getProva(db, day, { withOts: true });
  assert.equal(prova.day, day);
  assert.equal(prova.root, root);
  assert.equal(prova.n_leaves, 3);
  assert.equal(prova.status, 'ancorada');
  assert.equal(prova.has_ots, true);
  assert.ok(Buffer.isBuffer(prova.ots));
  assert.deepEqual(prova.ots, Buffer.concat([Buffer.from('OTS-FALSO:'), Buffer.from(manifestSha256, 'hex')]));
  assert.deepEqual(await getDayLeaves(db, day), leaves);

  for (const [i, x] of items.entries()) {
    const p = await getProvaForPrevisao(db, x.id);
    assert.equal(p.day, day);
    assert.equal(p.leaf_index, i);
    assert.equal(p.root, root);
    assert.equal(verifyProof(x.hash, p.proof, p.root), true);
  }
});

test('o dia corrente não é fechado, nem às 23:59:59; às 00:00:00 do dia seguinte já é', async () => {
  const db = await freshDb();
  const stamp = fakeStamp();
  await seed(db, [...hoursOn('2026-10-12', 2), '2026-10-12T23:59:59.999Z']);
  const open = await anchorDays(db, { now: at('2026-10-12T23:59:59.999Z'), stamp });
  assert.deepEqual(open, { days: [], orphans: [], errors: 0 });
  assert.equal((await snapshotTables(db)).provas.length, 0);
  assert.equal(stamp.calls.length, 0, 'nada a carimbar');
  assert.deepEqual(await listClosedDaysWithoutProof(db, '2026-10-12'), []);

  const closed = await anchorDays(db, { now: at('2026-10-13T00:00:00.000Z'), stamp });
  assert.equal(closed.days.length, 1);
  assert.equal(closed.days[0].day, '2026-10-12');
  assert.equal(closed.days[0].nLeaves, 3);
});

test('fronteira do dia UTC: 23:59:59.999 e 00:00:00.000 caem em dias diferentes', async () => {
  const db = await freshDb();
  const items = await seed(db, ['2026-10-01T23:59:59.999Z', '2026-10-02T00:00:00.000Z']);
  assert.deepEqual((await listClosedDaysWithoutProof(db, '2026-10-05')).map((d) => [d.day, d.n]), [['2026-10-01', 1], ['2026-10-02', 1]]);
  const r = await anchorDays(db, { now: at('2026-10-05T00:10:00.000Z'), stamp: fakeStamp() });
  assert.deepEqual(r.days.map((d) => [d.day, d.nLeaves]), [['2026-10-01', 1], ['2026-10-02', 1]]);
  assert.deepEqual(await getDayLeaves(db, '2026-10-01'), [items[0].hash]);
  assert.deepEqual(await getDayLeaves(db, '2026-10-02'), [items[1].hash]);
});

test('idempotente: rodar duas vezes não muda nada e não carimba de novo', async () => {
  const db = await freshDb();
  const stamp = fakeStamp();
  await seed(db, hoursOn('2026-10-09', 5));
  await seed(db, hoursOn('2026-10-10', 2));
  const now = at('2026-10-11T00:10:00.000Z');
  const a = await anchorDays(db, { now, stamp });
  assert.equal(a.days.length, 2);
  const before = await snapshotTables(db);
  const calls = stamp.calls.length;

  const b = await anchorDays(db, { now: at('2026-10-11T06:00:00.000Z'), stamp });
  assert.deepEqual(b, { days: [], orphans: [], errors: 0 });
  assert.deepEqual(await snapshotTables(db), before, 'inclusive updated_at e os bytes do recibo');
  assert.equal(stamp.calls.length, calls);
  const c = await anchorDays(db, { now: at('2026-10-20T00:10:00.000Z'), stamp });
  assert.deepEqual(c, { days: [], orphans: [], errors: 0 });
  assert.deepEqual(await snapshotTables(db), before);
});

test('falhou é retentado na execução seguinte; depois de ancorada, para de ser tocada', async () => {
  const db = await freshDb();
  const day = '2026-10-10';
  const items = await seed(db, hoursOn(day, 2));
  const down = async () => { throw new Error('nenhum calendário respondeu'); };

  const r1 = await anchorDays(db, { now: at('2026-10-11T00:10:00.000Z'), stamp: down });
  assert.equal(r1.errors, 1);
  assert.equal(r1.days.length, 1);
  assert.equal(r1.days[0].status, 'falhou');
  assert.match(r1.days[0].error, /nenhum calendário respondeu/);
  assert.equal(r1.days[0].nLeaves, 2);
  assert.equal(r1.days[0].root, merkleRoot(items.map((x) => x.hash)));
  const falhou = await getProva(db, day);
  assert.equal(falhou.status, 'falhou');
  assert.equal(falhou.has_ots, false);
  // a árvore já está gravada: a falha foi só do carimbo
  assert.equal((await getProvaForPrevisao(db, items[0].id)).status, 'falhou');

  // continua falhando: segue falhou, sem acumular nada
  const r2 = await anchorDays(db, { now: at('2026-10-12T00:10:00.000Z'), stamp: down });
  assert.equal(r2.errors, 1);
  assert.equal(r2.days[0].status, 'falhou');

  const stamp = fakeStamp();
  const r3 = await anchorDays(db, { now: at('2026-10-13T00:10:00.000Z'), stamp });
  assert.equal(r3.errors, 0);
  assert.equal(r3.days.length, 1);
  assert.equal(r3.days[0].status, 'ancorada');
  assert.equal(r3.days[0].error, undefined);
  assert.equal(stamp.calls.length, 1);
  const ok = await getProva(db, day);
  assert.equal(ok.status, 'ancorada');
  assert.equal(ok.has_ots, true);

  const r4 = await anchorDays(db, { now: at('2026-10-14T00:10:00.000Z'), stamp });
  assert.deepEqual(r4, { days: [], orphans: [], errors: 0 });
  assert.equal(stamp.calls.length, 1);
});

test('o carimbo de um dia que falha não impede os outros dias', async () => {
  const db = await freshDb();
  await seed(db, hoursOn('2026-10-08', 1));
  await seed(db, hoursOn('2026-10-09', 2));
  let n = 0;
  const flaky = async (digest) => {
    if (++n === 1) throw new Error('timeout');
    return fakeStamp()(digest);
  };
  const r = await anchorDays(db, { now: at('2026-10-10T00:10:00.000Z'), stamp: flaky });
  assert.deepEqual(r.days.map((d) => [d.day, d.status]), [['2026-10-08', 'falhou'], ['2026-10-09', 'ancorada']]);
  assert.equal(r.errors, 1);
});

test('recibo vazio ou carimbo que devolve lixo conta como falha, não como âncora', async () => {
  const db = await freshDb();
  await seed(db, hoursOn('2026-10-08', 1));
  const r = await anchorDays(db, { now: at('2026-10-10T00:10:00.000Z'), stamp: async () => ({ ots: Buffer.alloc(0) }) });
  assert.equal(r.days[0].status, 'falhou');
  assert.equal(r.errors, 1);
  assert.equal((await getProva(db, '2026-10-08')).has_ots, false);
});

test('raiz adulterada em provas_merkle não é carimbada', async () => {
  const db = await freshDb();
  const stamp = fakeStamp();
  await seed(db, hoursOn('2026-10-08', 2));
  await anchorDays(db, { now: at('2026-10-10T00:10:00.000Z'), stamp: async () => { throw new Error('fora'); } });
  await db.query("update provas_merkle set root = $1 where day = '2026-10-08'", ['0'.repeat(64)]); // a tabela é atualizável
  const r = await anchorDays(db, { now: at('2026-10-11T00:10:00.000Z'), stamp });
  assert.equal(r.days[0].status, 'falhou');
  assert.match(r.days[0].error, /não confere/);
  assert.equal(stamp.calls.length, 0);
});

test('previsão órfã (dia já fechado, fora da árvore) é relatada, nunca ignorada nem absorvida', async () => {
  const db = await freshDb();
  const stamp = fakeStamp();
  const [a, b] = await seed(db, hoursOn('2026-10-10', 2));
  const first = await anchorDays(db, { now: at('2026-10-11T00:10:00.000Z'), stamp });
  const root = first.days[0].root;
  assert.deepEqual(first.orphans, []);

  // chega depois do fechamento, com emitted_at dentro do dia fechado
  const [late] = await seed(db, ['2026-10-10T23:59:59.000Z']);
  const second = await anchorDays(db, { now: at('2026-10-12T00:10:00.000Z'), stamp });
  assert.equal(second.errors, 1);
  assert.deepEqual(second.days, []);
  assert.deepEqual(second.orphans, [{ id: late.id, hash: late.hash, day: '2026-10-10', emittedAt: '2026-10-10T23:59:59.000Z' }]);
  assert.deepEqual((await listOrphans(db)).map((o) => o.id), [late.id]);

  // a raiz do dia não mudou, e a órfã segue relatada nas execuções seguintes
  const prova = await getProva(db, '2026-10-10');
  assert.equal(prova.root, root);
  assert.equal(prova.n_leaves, 2);
  assert.deepEqual(await getDayLeaves(db, '2026-10-10'), [a.hash, b.hash]);
  assert.equal(await getProvaForPrevisao(db, late.id), null);
  const third = await anchorDays(db, { now: at('2026-10-13T00:10:00.000Z'), stamp });
  assert.equal(third.orphans.length, 1);
  assert.equal(third.errors, 1);
});

test('a tabela previsoes continua append-only: o job não a altera e ela segue recusando mutação', async () => {
  const db = await freshDb();
  const items = await seed(db, hoursOn('2026-10-10', 3));
  const before = (await db.query('select * from previsoes order by hash')).rows;
  await anchorDays(db, { now: at('2026-10-11T00:10:00.000Z'), stamp: fakeStamp() });
  assert.deepEqual((await db.query('select * from previsoes order by hash')).rows, before);

  const recusada = (sql, params = []) => assert.rejects(() => db.query(sql, params), (e) => {
    assert.equal(e.code, '23001');
    assert.match(e.message, /append-only/);
    return true;
  });
  await recusada('update previsoes set verdict = $1 where id = $2', ['X', items[0].id]);
  await recusada('delete from previsoes where id = $1', [items[0].id]);
  await recusada('truncate previsoes, desfechos, previsao_prova');
  assert.equal((await db.query('select count(*)::int as n from previsoes')).rows[0].n, 3);
});

test('cron: exige o segredo, relata o que fez e responde 207 quando há erro', async () => {
  const db = await freshDb();
  await seed(db, hoursOn('2026-10-10', 2));
  const env = { CRON_SECRET: 's3gredo-de-teste', DATABASE_URL: 'postgres://nao-usado' };
  const bearer = 'Bearer s3gredo-de-teste';
  const stamp = fakeStamp();

  assert.equal((await handleCronAnchor({ env, deps: { db } })).status, 401);
  assert.equal((await handleCronAnchor({ authorization: 'Bearer errado', env, deps: { db } })).status, 401);
  assert.equal((await handleCronAnchor({ authorization: bearer, env: {} })).status, 401, 'sem CRON_SECRET no ambiente nada passa');
  assert.equal((await handleCronAnchor({ authorization: bearer, env: { CRON_SECRET: 's3gredo-de-teste' } })).status, 503);
  assert.equal((await db.query('select count(*)::int as n from provas_merkle')).rows[0].n, 0);

  const fail = await handleCronAnchor({ authorization: bearer, env, deps: { db, now: () => at('2026-10-11T00:10:00.000Z'), stamp: async () => { throw new Error('fora'); } } });
  assert.equal(fail.status, 207);
  assert.equal(fail.headers['cache-control'], 'no-store');
  assert.equal(fail.body.errors, 1);
  assert.equal(fail.body.days[0].status, 'falhou');

  const ok = await handleCronAnchor({ authorization: bearer, env, deps: { db, now: at('2026-10-12T00:10:00.000Z'), stamp } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.errors, 0);
  assert.deepEqual(ok.body.orphans, []);
  assert.equal(ok.body.days[0].status, 'ancorada');
  assert.deepEqual(ok.body.days[0].calendars, ['https://calendario.teste']);

  const again = await handleCronAnchor({ authorization: bearer, env, deps: { db, now: at('2026-10-12T00:20:00.000Z'), stamp } });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { days: [], orphans: [], errors: 0 });

  // deps.anchor substitui o job (mesmo padrão do cron de candles)
  const custom = await handleCronAnchor({ authorization: bearer, env, deps: { db, anchor: async () => ({ days: [], orphans: [], errors: 2 }) } });
  assert.equal(custom.status, 207);
});

test('recibo ancorado: completa com o bloco do Bitcoin, alerta depois de 24 horas e não consulta o dia recém-carimbado', async () => {
  const db = await freshDb();
  await seed(db, ['2026-10-10T12:00:00.000Z']);
  const asked = [];
  const pending = async (ots) => { asked.push(Buffer.from(ots).toString()); return { ots, confirmed: false }; };

  // execução que carimba: o dia recém-carimbado não é consultado
  const first = await anchorDays(db, { now: at('2026-10-11T00:10:00.000Z'), stamp: fakeStamp(), upgrade: pending });
  assert.equal(first.days[0].status, 'ancorada');
  assert.equal(asked.length, 0);

  // dentro das 24 horas, ainda pendente: nada a relatar
  const soon = await anchorDays(db, { now: () => Date.now() + 3_600_000, stamp: fakeStamp(), upgrade: pending });
  assert.deepEqual(soon, { days: [], orphans: [], errors: 0 });
  assert.equal(asked.length, 1);

  // mais de 24 horas sem confirmação: alerta, e o dia continua ancorado
  const late = await anchorDays(db, { now: () => Date.now() + 25 * 3_600_000, stamp: fakeStamp(), upgrade: pending });
  assert.equal(late.errors, 1);
  assert.match(late.days[0].error, /sem confirmação no Bitcoin/);
  assert.equal((await getProva(db, '2026-10-10')).status, 'ancorada');

  // o calendário entrega o bloco: recibo completo gravado, status confirmada, e o dia sai da fila
  const done = await anchorDays(db, { now: () => Date.now() + 26 * 3_600_000, stamp: fakeStamp(), upgrade: async () => ({ ots: Buffer.from('recibo-completo'), confirmed: true }) });
  assert.deepEqual(done.days.map((d) => [d.day, d.status, d.error]), [['2026-10-10', 'confirmada', undefined]]);
  const prova = await getProva(db, '2026-10-10', { withOts: true });
  assert.equal(prova.status, 'confirmada');
  assert.equal(prova.ots.toString(), 'recibo-completo');
  const after = await anchorDays(db, { now: () => Date.now() + 27 * 3_600_000, stamp: fakeStamp(), upgrade: async () => { throw new Error('não deveria consultar'); } });
  assert.deepEqual(after, { days: [], orphans: [], errors: 0 });
});
