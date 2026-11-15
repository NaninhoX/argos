// query_log em /api/analyze: uma linha por chamada, cache_hit, falha de banco que não derruba a resposta,
// sem banco não grava, e nada de dado pessoal (IP só em HMAC com chave, nulo sem chave; sem código de acesso em params;
// retenção de 90 dias).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';
import { snapshotSeries } from '../lib/data/series.js';
import { hashCodigo } from '../lib/acesso.js';
import { createHandler } from '../api/analyze.js';
import { createHmac } from 'node:crypto';
import { hashDoIp, paramsDaConsulta, registrarConsulta, RETENCAO_DIAS } from '../lib/query-log.js';

// Sem rede nos testes: a série vem só do snapshot.
const offline = { loadSeries: async (s, tf) => ({ d: snapshotSeries(s, tf), source: 'snapshot' }) };
const IP = '203.0.113.77';
const CODIGO = 'codigo-secreto-de-teste';

function req(query, extra = {}) {
  return { method: 'GET', query, headers: { 'x-forwarded-for': `${IP}, 10.0.0.1`, 'x-argos-code': CODIGO }, ...extra };
}
function resFalso() {
  const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(s) { r.code = s; return r; }, json(b) { r.body = b; return r; } };
  return r;
}
async function bancoMigrado() {
  const db = await createTestDb();
  await migrate(db, { log: () => {} });
  return db;
}

test('query_log: uma linha por chamada; cache_hit false na primeira e true na segunda', async () => {
  const db = await bancoMigrado();
  const handler = createHandler({ env: {}, db, ...offline });
  const q = { symbol: 'BTCUSDT', tf: '1d', hold: '13' }; // hold fora do padrão: não reaproveita cache de outros testes
  const r1 = resFalso();
  const r2 = resFalso();
  await handler(req(q), r1);
  await handler(req(q), r2);
  assert.equal(r1.code, 200);
  assert.equal(r1.body.cacheHit, false);
  assert.equal(r2.body.cacheHit, true);
  const { rows } = await db.query('select * from query_log order by id');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => x.cache_hit), [false, true]);
  for (const x of rows) {
    assert.equal(x.route, '/api/analyze');
    assert.equal(x.status, 200);
    assert.match(x.engine_version, /^argos-engine /);
    assert.ok(Number.isInteger(Number(x.latency_ms)) && Number(x.latency_ms) >= 0);
  }
  assert.deepEqual(rows[0].params, { symbol: 'BTCUSDT', tf: '1d', cfg: { mode: 'atr', tgt: 2, stp: 1, hold: 13 }, windowDays: null, live: true, brief: false, snapshotOnly: false });
  await db.close();
});

test('query_log: ip_hash é HMAC com chave; sem chave é nulo; IP e código não aparecem em nenhuma coluna', async () => {
  const CHAVE = 'chave-de-teste-ip';
  const agora = new Date('2026-11-15T12:00:00Z');
  const db = await bancoMigrado();
  await registrarConsulta(db, { route: '/api/analyze', status: 200, latencyMs: 1, ip: IP }, { chave: CHAVE, agora, sorteio: () => 1 });
  await registrarConsulta(db, { route: '/api/analyze', status: 200, latencyMs: 1, ip: IP }, { chave: '', agora, sorteio: () => 1 });
  const { rows } = await db.query('select * from query_log order by id');
  assert.equal(rows.length, 2);
  const esperado = createHmac('sha256', CHAVE).update(`2026-11|${IP}`).digest('hex').slice(0, 32);
  assert.equal(rows[0].ip_hash, esperado);
  assert.match(rows[0].ip_hash, /^[0-9a-f]{32}$/);
  assert.notEqual(rows[0].ip_hash, hashCodigo(IP).slice(0, 32)); // não é o SHA-256 puro
  assert.equal(rows[1].ip_hash, null); // sem chave, nada de hash
  const tudo = JSON.stringify(rows);
  assert.ok(!tudo.includes(IP));
  assert.ok(!tudo.includes('10.0.0.1'));
  assert.ok(!tudo.includes(CODIGO));
  assert.ok(!/ip|code|codigo|x-argos/i.test(JSON.stringify(rows[0].params)));
  await db.close();
});

test('query_log: requisição recusada grava status e nada do que o cliente mandou', async () => {
  const db = await bancoMigrado();
  const handler = createHandler({ env: {}, db, ...offline });
  const r = resFalso();
  await handler(req({ symbol: 'NAO-EXISTE', tf: '1d', email: 'pessoa@exemplo.com' }), r);
  assert.equal(r.code, 400);
  const { rows } = await db.query('select * from query_log');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 400);
  assert.equal(rows[0].params, null);
  assert.equal(rows[0].cache_hit, null);
  assert.ok(!JSON.stringify(rows).includes('pessoa@exemplo.com'));
  await db.close();
});

test('query_log: falha na gravação não derruba a resposta', async () => {
  const quebrado = { query: async () => { throw new Error('banco fora do ar'); }, exec: async () => {} };
  const handler = createHandler({ env: {}, db: quebrado, ...offline });
  const r = resFalso();
  await handler(req({ symbol: 'SOLUSDT', tf: '1d', hold: '15' }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.setups.length, 8);
  // tabela inexistente (banco sem migração) também é engolida
  const semTabela = await createTestDb();
  const h2 = createHandler({ env: {}, db: semTabela, ...offline });
  const r2 = resFalso();
  await h2(req({ symbol: 'SOLUSDT', tf: '1d', hold: '15' }), r2);
  assert.equal(r2.code, 200);
  await semTabela.close();
  assert.equal(await registrarConsulta(quebrado, { route: '/api/analyze', status: 200, latencyMs: 1 }), false);
});

test('query_log: sem banco, não grava e a resposta sai igual', async () => {
  let chamadas = 0;
  const espiao = { query: async () => { chamadas++; return { rows: [], rowCount: 0 }; } };
  // db null explícito e env sem DATABASE_URL: nenhum dos dois caminhos toca no banco
  const h1 = createHandler({ env: {}, db: null, ...offline });
  const h2 = createHandler({ env: {}, ...offline });
  const r1 = resFalso();
  const r2 = resFalso();
  await h1(req({ symbol: 'BTCUSDT', tf: '1d', hold: '16' }), r1);
  await h2(req({ symbol: 'BTCUSDT', tf: '1d', hold: '16' }), r2);
  assert.equal(r1.code, 200);
  assert.equal(r2.code, 200);
  assert.equal(chamadas, 0);
  assert.equal(await registrarConsulta(null, { route: '/api/analyze', status: 200, latencyMs: 1 }), false);
  assert.equal(await registrarConsulta(espiao, { route: '/api/analyze', status: 200, latencyMs: 1 }), true);
  assert.equal(chamadas, 1);
});

test('query_log: DATABASE_URL pglite://memory abre o banco e grava', async () => {
  const { resolveDb } = await import('../lib/db.js');
  const env = { DATABASE_URL: 'pglite://memory' };
  const handler = createHandler({ env, ...offline });
  const r = resFalso();
  await handler(req({ symbol: 'BTCUSDT', tf: '1d', hold: '17' }), r);
  assert.equal(r.code, 200);
  const db = await resolveDb(env);
  const { rows } = await db.query('select cache_hit, route from query_log');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].route, '/api/analyze');
  await db.close();
});

test('query_log: hashDoIp e paramsDaConsulta', () => {
  assert.equal(hashDoIp(''), null);
  assert.equal(hashDoIp(undefined), null);
  const nov = new Date('2026-11-15T00:00:00Z');
  const dez = new Date('2026-12-01T00:00:00Z');
  assert.equal(hashDoIp('', 'k', nov), null);
  assert.equal(hashDoIp(IP, undefined, nov), null);
  assert.equal(hashDoIp(IP, '', nov), null);
  assert.notEqual(hashDoIp(IP, 'k', nov), IP);
  assert.equal(hashDoIp(IP, 'k', nov), hashDoIp(` ${IP} `, 'k', nov));
  assert.notEqual(hashDoIp(IP, 'k', nov), hashDoIp(IP, 'k', dez)); // o mês entra no hash
  assert.notEqual(hashDoIp(IP, 'k', nov), hashDoIp(IP, 'outra', nov));
  assert.equal(paramsDaConsulta(null), null);
});

test('query_log: retenção apaga linha de 100 dias e mantém a de 10 dias', async () => {
  assert.equal(RETENCAO_DIAS, 90);
  const db = await bancoMigrado();
  await db.query(`insert into query_log (at, route) values (now() - interval '100 days', 'velha'), (now() - interval '10 days', 'recente')`);
  // sorteio perdido: nada é apagado
  await registrarConsulta(db, { route: 'nova1', status: 200, latencyMs: 1 }, { sorteio: () => 0.5 });
  assert.equal((await db.query(`select 1 from query_log where route = 'velha'`)).rows.length, 1);
  // sorteio premiado: a velha some, a recente e a nova ficam
  await registrarConsulta(db, { route: 'nova2', status: 200, latencyMs: 1 }, { sorteio: () => 0 });
  const { rows } = await db.query('select route from query_log order by id');
  assert.deepEqual(rows.map((x) => x.route).sort(), ['nova1', 'nova2', 'recente']);
  // falha na limpeza é engolida
  const semLimpeza = { query: async (sql) => { if (/^\s*delete/i.test(sql)) throw new Error('falhou'); return { rows: [], rowCount: 0 }; } };
  assert.equal(await registrarConsulta(semLimpeza, { route: 'x', status: 200, latencyMs: 1 }, { sorteio: () => 0 }), true);
  await db.close();
});
