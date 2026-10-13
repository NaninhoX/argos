// Tabelas append-only (previsoes, desfechos, regimes) e restrições do esquema, no PGlite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';

const ENGINE = 'argos-engine 1.1.0';
let db;
let seq = 0;
const hash = () => (++seq).toString(16).padStart(64, '0');

before(async () => {
  db = await createTestDb();
  await migrate(db);
});
after(() => db.close());

async function novaPrevisao(extra = {}) {
  const h = extra.hash ?? hash();
  const r = await db.query(
    `insert into previsoes (params, data_cut, emitted_at, origin, engine_version, payload, hash, prob, supersedes)
     values ('{"alvo":2}', '2026-10-01T00:00:00Z', '2026-10-01T00:05:00Z', $1, $2, '{}', $3, $4, $5) returning id`,
    [extra.origin ?? 'demo', extra.engine_version ?? ENGINE, h, extra.prob ?? 0.5, extra.supersedes ?? null],
  );
  return r.rows[0].id;
}

/** Espera que a instrução seja recusada pelo gatilho append-only. */
async function recusada(sql, params = []) {
  await assert.rejects(() => db.query(sql, params), (err) => {
    assert.equal(err.code, '23001', `código inesperado: ${err.code} (${err.message})`);
    assert.match(err.message, /append-only/);
    return true;
  });
}

test('previsoes recusa UPDATE, DELETE e TRUNCATE', async () => {
  const id = await novaPrevisao();
  await recusada('update previsoes set verdict = $1 where id = $2', ['X', id]);
  await recusada('update previsoes set prob = 0.9');
  await recusada('delete from previsoes where id = $1', [id]);
  await recusada('delete from previsoes');
  // TRUNCATE simples já cai na checagem de chave estrangeira do Postgres (desfechos e previsao_prova a referenciam),
  // que roda antes dos gatilhos; com as tabelas dependentes na lista ou com CASCADE, quem recusa é o gatilho.
  await assert.rejects(() => db.query('truncate previsoes'), /foreign key/);
  await recusada('truncate previsoes, desfechos, previsao_prova');
  await recusada('truncate table previsoes restart identity cascade');
  const r = await db.query('select count(*)::int as n from previsoes where id = $1', [id]);
  assert.equal(r.rows[0].n, 1, 'a linha precisa continuar lá');
});

test('upsert (ON CONFLICT DO UPDATE) em previsoes também é recusado', async () => {
  const h = hash();
  await novaPrevisao({ hash: h });
  await recusada(
    `insert into previsoes (params, data_cut, emitted_at, origin, engine_version, payload, hash)
     values ('{}', now(), now(), 'demo', $1, '{}', $2)
     on conflict (hash) do update set verdict = 'X'`,
    [ENGINE, h],
  );
});

test('correção é uma nova linha que aponta para a anterior em supersedes', async () => {
  const antiga = await novaPrevisao();
  const nova = await novaPrevisao({ supersedes: antiga });
  const r = await db.query('select supersedes from previsoes where id = $1', [nova]);
  assert.equal(r.rows[0].supersedes, antiga);
  await assert.rejects(() => novaPrevisao({ supersedes: '00000000-0000-4000-8000-000000000000' }), /foreign key|violates/i);
});

test('desfechos recusa UPDATE, DELETE e TRUNCATE', async () => {
  const id = await novaPrevisao();
  await db.query("insert into desfechos (previsao_id, outcome, ret, bars) values ($1, 'WIN', 0.02, 5)", [id]);
  await recusada("update desfechos set outcome = 'LOSS' where previsao_id = $1", [id]);
  await recusada('delete from desfechos where previsao_id = $1', [id]);
  await recusada('delete from desfechos');
  await recusada('truncate desfechos'); // ninguém referencia desfechos: aqui o gatilho é a única defesa
  await recusada('truncate table desfechos restart identity cascade');
  const r = await db.query('select outcome from desfechos where previsao_id = $1', [id]);
  assert.deepEqual(r.rows, [{ outcome: 'WIN' }]);
});

test('regimes (append-only) recusa UPDATE, DELETE e TRUNCATE', async () => {
  await db.query(
    "insert into regimes (symbol, timeframe, bar_time, regime, engine_version) values ('BTCUSDT', '1d', '2026-10-01T00:00:00Z', 'TREND', $1)",
    [ENGINE],
  );
  await recusada("update regimes set regime = 'RANGE'");
  await recusada('delete from regimes');
  await recusada('truncate regimes');
});

test('catálogo: 6 gatilhos append-only (2 por tabela), como descrito em docs/db.md', async () => {
  const r = await db.query(
    `select c.relname, count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal and c.relname in ('previsoes', 'desfechos', 'regimes') group by 1 order by 1`,
  );
  assert.deepEqual(r.rows, [{ relname: 'desfechos', n: 2 }, { relname: 'previsoes', n: 2 }, { relname: 'regimes', n: 2 }]);
});

test('só um desfecho por previsão', async () => {
  const id = await novaPrevisao();
  await db.query("insert into desfechos (previsao_id, outcome) values ($1, 'TIMEOUT')", [id]);
  await assert.rejects(() => db.query("insert into desfechos (previsao_id, outcome) values ($1, 'WIN')", [id]), /duplicate key/);
});

test('restrições de previsoes: prob, hash, origem, versão do motor', async () => {
  await assert.rejects(() => novaPrevisao({ prob: 1.01 }), /check/i);
  await assert.rejects(() => novaPrevisao({ prob: -0.01 }), /check/i);
  await novaPrevisao({ prob: 0 });
  await novaPrevisao({ prob: 1 });
  const semProb = await db.query(
    `insert into previsoes (params, prob, data_cut, emitted_at, origin, engine_version, payload, hash)
     values ('{}', null, now(), now(), 'termometro', $1, '{}', $2) returning prob`,
    [ENGINE, hash()],
  );
  assert.equal(semProb.rows[0].prob, null, 'prob nula é aceita (motor sem probabilidade)');
  await assert.rejects(() => novaPrevisao({ hash: 'abc' }), /check/i);
  await assert.rejects(() => novaPrevisao({ hash: 'f'.repeat(65) }), /check/i);
  await assert.rejects(() => novaPrevisao({ origin: 'outra' }), /check/i);
  await assert.rejects(() => novaPrevisao({ engine_version: 'argos-engine 9.9.9' }), /foreign key|violates/i);
  const h = hash();
  await novaPrevisao({ hash: h });
  await assert.rejects(() => novaPrevisao({ hash: h }), /duplicate key/);
});

test('restrições de desfechos, candles e provas', async () => {
  const id = await novaPrevisao();
  await assert.rejects(() => db.query("insert into desfechos (previsao_id, outcome) values ($1, 'EMPATE')", [id]), /check/i);
  await assert.rejects(
    () => db.query("insert into candles values ('BTCUSDT', '15m', now(), 1, 1, 1, 1, 1)"),
    /check/i,
  );
  await assert.rejects(
    () => db.query("insert into provas_merkle (day, root, status) values ('2026-10-01', 'r', 'qualquer')"),
    /check/i,
  );
  await assert.rejects(
    () => db.query("insert into revisao_humana (decision) values ('talvez')"),
    /check/i,
  );
});

test('provas_merkle é atualizável e carimba updated_at; previsao_prova liga a previsão ao dia', async () => {
  await db.query("insert into provas_merkle (day, root, n_leaves) values ('2026-10-01', 'raiz', 2)");
  const antes = await db.query("select status, created_at, updated_at from provas_merkle where day = '2026-10-01'");
  assert.equal(antes.rows[0].status, 'pendente');
  await new Promise((r) => setTimeout(r, 15));
  await db.query("update provas_merkle set status = 'ancorada', ots = $1 where day = '2026-10-01'", [Buffer.from([1, 2, 3])]);
  const depois = await db.query("select status, ots, created_at, updated_at from provas_merkle where day = '2026-10-01'");
  assert.equal(depois.rows[0].status, 'ancorada');
  assert.deepEqual([...depois.rows[0].ots], [1, 2, 3]);
  assert.ok(depois.rows[0].updated_at > antes.rows[0].updated_at, 'updated_at deve avançar');
  assert.deepEqual(depois.rows[0].created_at, antes.rows[0].created_at);

  const a = await novaPrevisao();
  const b = await novaPrevisao();
  await db.query("insert into previsao_prova values ($1, '2026-10-01', 0, '[]')", [a]);
  await assert.rejects(
    () => db.query("insert into previsao_prova values ($1, '2026-10-01', 0, '[]')", [b]),
    /duplicate key/,
    'folha repetida no mesmo dia',
  );
  await assert.rejects(
    () => db.query("insert into previsao_prova values ($1, '2026-10-02', 0, '[]')", [b]),
    /foreign key|violates/i,
    'dia sem árvore',
  );
});

test('resultados_matriz: unicidade pela chave composta', async () => {
  const ins = () => db.query(
    `insert into resultados_matriz (engine_version, data_cut, symbol, timeframe, setup_id, cfg, cfg_hash, result)
     values ($1, '2026-10-01T00:00:00Z', 'BTCUSDT', '1d', 'S1', '{}', 'h1', '{}')`,
    [ENGINE],
  );
  await ins();
  await assert.rejects(ins, /duplicate key/);
});

test('plano_calibracao: chave (id, version) e prob entre 0 e 1', async () => {
  await db.query("insert into plano_calibracao (id, version, prob) values ('H1', 1, 0.6)");
  await db.query("insert into plano_calibracao (id, version, prob) values ('H1', 2, 0.7)");
  await assert.rejects(() => db.query("insert into plano_calibracao (id, version, prob) values ('H1', 2, 0.7)"), /duplicate key/);
  await assert.rejects(() => db.query("insert into plano_calibracao (id, version, prob) values ('H2', 1, 1.5)"), /check/i);
});
