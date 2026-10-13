// Repositórios de previsões, desfechos e auditoria no PGlite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';
import { getPrevisaoByHash, getPrevisaoById, insertPrevisao } from '../lib/repo/previsoes.js';
import { insertDesfecho } from '../lib/repo/desfechos.js';
import { insertQueryLog, insertToolAudit } from '../lib/repo/audit.js';

const ENGINE = 'argos-engine 1.1.0';
let db;
let seq = 0;
const hash = () => (0x1000 + ++seq).toString(16).padStart(64, 'a');

before(async () => {
  db = await createTestDb();
  await migrate(db);
});
after(() => db.close());

const base = () => ({
  setup_id: 'S-breakout',
  symbol: 'BTCUSDT',
  timeframe: '1d',
  params: { alvo_atr: 2, stop_atr: 1, horizonte: 20 },
  prob: 0.20689655172413793,
  base_rate: 69130.2,
  n: 120,
  n_eff: 48,
  verdict: 'ROBUSTO',
  bar_time: new Date('2026-10-01T00:00:00Z'),
  data_cut: '2026-10-01T00:00:00Z',
  emitted_at: '2026-10-01T00:05:00.250Z',
  origin: 'demo',
  origin_ref: 'rel-42',
  engine_version: ENGINE,
  payload: { q: 0.1 + 0.2, lista: [1, 2.5, { z: 1e-7 }], texto: 'ação', nulo: null },
  hash: hash(),
});

test('inserir e buscar por id e por hash; doubles e jsonb voltam idênticos', async () => {
  const p = base();
  const r = await insertPrevisao(db, p);
  assert.equal(r.inserted, true);
  assert.match(r.id, /^[0-9a-f-]{36}$/);

  const porId = await getPrevisaoById(db, r.id);
  const porHash = await getPrevisaoByHash(db, p.hash);
  assert.deepEqual(porId, porHash);
  assert.equal(porId.prob, 0.20689655172413793);
  assert.equal(porId.base_rate, 69130.2);
  assert.equal(porId.n, 120);
  assert.equal(porId.n_eff, 48);
  assert.equal(porId.symbol, 'BTCUSDT');
  assert.equal(porId.origin, 'demo');
  assert.equal(porId.origin_ref, 'rel-42');
  assert.equal(porId.supersedes, null);
  assert.deepEqual(porId.params, p.params);
  assert.deepEqual(porId.payload, p.payload);
  assert.equal(porId.payload.q, 0.30000000000000004);
  assert.ok(porId.bar_time instanceof Date);
  assert.equal(porId.bar_time.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(porId.emitted_at.toISOString(), '2026-10-01T00:05:00.250Z');
  assert.equal(porId.data_cut.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.ok(porId.created_at instanceof Date);
});

test('inserir é idempotente pelo hash e devolve o id existente', async () => {
  const p = base();
  const a = await insertPrevisao(db, p);
  const b = await insertPrevisao(db, p);
  assert.deepEqual(b, { id: a.id, inserted: false });
  const n = await db.query('select count(*)::int as n from previsoes where hash = $1', [p.hash]);
  assert.equal(n.rows[0].n, 1);
});

test('prob nula e campos opcionais ausentes são aceitos; id explícito e supersedes', async () => {
  const minimo = {
    params: {}, data_cut: new Date('2026-10-02T00:00:00Z'), emitted_at: new Date('2026-10-02T00:01:00Z'),
    origin: 'termometro', engine_version: ENGINE, payload: { x: 1 }, hash: hash(),
  };
  const r = await insertPrevisao(db, minimo);
  const row = await getPrevisaoById(db, r.id);
  assert.equal(row.prob, null);
  assert.equal(row.setup_id, null);
  assert.equal(row.bar_time, null);

  const id = '11111111-2222-4333-8444-555555555555';
  const corr = await insertPrevisao(db, { ...minimo, hash: hash(), id, supersedes: r.id });
  assert.equal(corr.id, id);
  assert.equal((await getPrevisaoById(db, id)).supersedes, r.id);
});

test('buscas que não acham devolvem null (inclusive id malformado)', async () => {
  assert.equal(await getPrevisaoById(db, '00000000-0000-4000-8000-000000000000'), null);
  assert.equal(await getPrevisaoById(db, 'não-é-uuid'), null);
  assert.equal(await getPrevisaoById(db, undefined), null);
  assert.equal(await getPrevisaoByHash(db, 'f'.repeat(64)), null);
});

test('rejeita número não finito no payload em vez de gravar null em silêncio', async () => {
  await assert.rejects(() => insertPrevisao(db, { ...base(), hash: hash(), payload: { x: NaN } }), /não finito/);
  await assert.rejects(() => insertPrevisao(db, { ...base(), hash: hash(), data_cut: 'ontem' }), /data inválida/);
});

test('constraints do banco chegam como erro (prob fora de [0,1], origem inválida)', async () => {
  await assert.rejects(() => insertPrevisao(db, { ...base(), hash: hash(), prob: 1.5 }), /check/i);
  await assert.rejects(() => insertPrevisao(db, { ...base(), hash: hash(), origin: 'outra' }), /check/i);
});

test('desfecho: inserir, ida e volta de double, e um só por previsão', async () => {
  const { id } = await insertPrevisao(db, { ...base(), hash: hash() });
  const out = await insertDesfecho(db, {
    previsao_id: id, outcome: 'LOSS', ret: -0.20689655172413793, bars: 7,
    bar_time: new Date('2026-10-08T00:00:00Z'), resolved_at: '2026-10-08T00:01:00Z',
  });
  assert.deepEqual(out, { previsao_id: id });
  const r = await db.query('select * from desfechos where previsao_id = $1', [id]);
  assert.equal(r.rows[0].outcome, 'LOSS');
  assert.equal(r.rows[0].ret, -0.20689655172413793);
  assert.equal(r.rows[0].bars, 7);
  assert.equal(r.rows[0].bar_time.toISOString(), '2026-10-08T00:00:00.000Z');

  await assert.rejects(() => insertDesfecho(db, { previsao_id: id, outcome: 'WIN' }), /duplicate key/);
  await assert.rejects(
    () => insertDesfecho(db, { previsao_id: '00000000-0000-4000-8000-000000000000', outcome: 'WIN' }),
    /foreign key|violates/i,
  );
  await assert.rejects(() => insertDesfecho(db, { previsao_id: id, outcome: 'EMPATE' }), /duplicate key|check/i);
});

test('pendentes de desfecho: anti-junção encontra só as sem desfecho', async () => {
  const a = await insertPrevisao(db, { ...base(), hash: hash(), setup_id: 'PEND-A', symbol: 'PENDUSDT' });
  const b = await insertPrevisao(db, { ...base(), hash: hash(), setup_id: 'PEND-A', symbol: 'PENDUSDT' });
  await insertDesfecho(db, { previsao_id: a.id, outcome: 'WIN' });
  const r = await db.query(
    `select p.id from previsoes p left join desfechos d on d.previsao_id = p.id
     where d.previsao_id is null and p.symbol = 'PENDUSDT' and p.setup_id = 'PEND-A'`,
  );
  assert.deepEqual(r.rows.map((x) => x.id), [b.id]);
});

test('auditoria: tool_audit e query_log gravam sem dado pessoal e aceitam campos opcionais', async () => {
  await insertToolAudit(db, {
    session_id: 's-1', tool: 'consultar_setup', args: { symbol: 'BTCUSDT', lista: [1, 2] },
    result_hash: 'a'.repeat(64), model: 'modelo-x', latency_ms: 321,
  });
  await insertToolAudit(db, { tool: 'minimo', at: new Date('2026-10-03T12:00:00Z') });
  const t = await db.query('select * from tool_audit order by id');
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0].args, { symbol: 'BTCUSDT', lista: [1, 2] });
  assert.equal(t.rows[0].latency_ms, 321);
  assert.ok(t.rows[0].at instanceof Date);
  assert.equal(t.rows[1].args, null);
  assert.equal(t.rows[1].at.toISOString(), '2026-10-03T12:00:00.000Z');

  await insertQueryLog(db, {
    route: '/api/previsoes', params: { symbol: 'BTCUSDT' }, status: 200, latency_ms: 12,
    cache_hit: true, engine_version: ENGINE, ip_hash: 'b'.repeat(64),
  });
  await insertQueryLog(db, { route: '/api/saude' });
  const q = await db.query('select * from query_log order by id');
  assert.equal(q.rows.length, 2);
  assert.equal(q.rows[0].cache_hit, true);
  assert.deepEqual(q.rows[0].params, { symbol: 'BTCUSDT' });
  assert.equal(q.rows[1].status, null);

  const cols = await db.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name in ('query_log', 'tool_audit')",
  );
  const nomes = cols.rows.map((c) => c.column_name);
  assert.ok(!nomes.includes('ip'), 'nada de coluna ip');
  assert.ok(nomes.includes('ip_hash'));
});

test('repositórios funcionam dentro de db.transaction (tx) e respeitam rollback', async () => {
  const p = { ...base(), hash: hash() };
  await assert.rejects(() => db.transaction(async (tx) => {
    await insertPrevisao(tx, p);
    throw new Error('desfaz');
  }), /desfaz/);
  assert.equal(await getPrevisaoByHash(db, p.hash), null);

  const r = await db.transaction((tx) => insertPrevisao(tx, p));
  assert.equal(r.inserted, true);
  assert.equal((await getPrevisaoByHash(db, p.hash)).id, r.id);
});
