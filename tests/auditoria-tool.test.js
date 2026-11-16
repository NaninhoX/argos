// tools/auditoria.mjs: só leitura, junta query_log e tool_audit por requestId, agrega por período, nunca mostra
// ip_hash inteiro nem mais de 12 caracteres do hash do resultado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';
import { insertQueryLog, insertToolAudit } from '../lib/repo/audit.js';
import { executar, ErroDeUso } from '../tools/auditoria.mjs';

const FERRAMENTA = fileURLToPath(new URL('../tools/auditoria.mjs', import.meta.url));
const RID1 = '11111111-1111-4111-8111-111111111111';
const RID2 = '22222222-2222-4222-8222-222222222222';
const IP_HASH = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const RES_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function semeado() {
  const db = await createTestDb();
  await migrate(db, { log: () => {} });
  const params = (requestId, codigo, toolCalls) => ({ requestId, acessoRef: 'geral', toolCalls, codigo, tentativas: 1, rejeicoes: { tentativas: 0, numerosSemOrigem: 1, termosSinalizados: 2 } });
  await insertQueryLog(db, { at: '2026-11-10T12:00:00Z', route: '/api/argos-ai', params: params(RID1, null, 2), status: 200, latency_ms: 100, ip_hash: IP_HASH });
  await insertQueryLog(db, { at: '2026-11-11T23:59:00Z', route: '/api/argos-ai', params: params(RID2, 'numero_sem_origem', 0), status: 422, latency_ms: 300, ip_hash: IP_HASH });
  await insertQueryLog(db, { at: '2026-11-11T10:00:00Z', route: '/api/analyze', params: { requestId: null }, status: 200, latency_ms: 20, cache_hit: true });
  await insertQueryLog(db, { at: '2026-11-20T10:00:00Z', route: '/api/argos-ai', params: params('33333333-3333-4333-8333-333333333333', null, 0), status: 200, latency_ms: 999 });
  await insertToolAudit(db, { at: '2026-11-10T12:00:01Z', session_id: RID1, tool: 'estudo', args: { symbol: 'BTCUSDT', timeframe: '1d' }, result_hash: RES_HASH, model: 'm', latency_ms: 5 });
  await insertToolAudit(db, { at: '2026-11-10T12:00:02Z', session_id: RID1, tool: 'veredito', args: { symbol: 'ETHUSDT' }, result_hash: RES_HASH, model: 'm', latency_ms: 7 });
  await insertToolAudit(db, { at: '2026-11-10T12:00:03Z', session_id: 'outra', tool: 'estudo', args: {}, result_hash: 'x', model: 'm', latency_ms: 1 });
  return db;
}

test('requisicao junta query_log e tool_audit e esconde hashes', async () => {
  const db = await semeado();
  const out = await executar(db, ['requisicao', '--id', RID1]);
  assert.match(out, /query_log \(1\)/);
  assert.match(out, /tool_audit \(2\)/);
  assert.match(out, /status=200/);
  assert.match(out, /acessoRef=geral toolCalls=2/);
  assert.match(out, /numerosSemOrigem=1, termosSinalizados=2/);
  assert.match(out, /estudo/);
  assert.match(out, /veredito/);
  assert.match(out, /ip=abcdef01$/m, 'ip_hash com 8 caracteres');
  assert.ok(!out.includes(IP_HASH.slice(0, 9)), 'ip_hash inteiro não aparece');
  assert.ok(out.includes('resultado=' + RES_HASH.slice(0, 12)));
  assert.ok(!out.includes(RES_HASH.slice(0, 13)), 'hash do resultado cortado em 12');
  assert.ok(!out.includes('outra'), 'não mistura outra sessão');
  await db.close();
});

test('requisicao com id inexistente devolve mensagem clara', async () => {
  const db = await semeado();
  const out = await executar(db, ['requisicao', '--id', '99999999-9999-4999-8999-999999999999']);
  assert.match(out, /nenhum registro/);
  await db.close();
});

test('periodo agrega por status, código, latência e chamadas de ferramenta', async () => {
  const db = await semeado();
  const out = await executar(db, ['periodo', '--de', '2026-11-10', '--ate', '2026-11-11', '--rota', '/api/argos-ai']);
  assert.match(out, /Requisições: 2\b/);
  assert.match(out, /p50 200 ms, p95 290 ms/);
  assert.match(out, /Chamadas de ferramenta: 2\b/);
  assert.match(out, /\n {2}200\t1/);
  assert.match(out, /\n {2}422\t1/);
  assert.match(out, /numero_sem_origem\t1/);
  assert.match(out, /sem código\t1/);
  assert.ok(!out.includes('#'), 'sem linhas individuais por padrão');
  assert.ok(!out.includes(RID1));
  const todas = await executar(db, ['periodo', '--de', '2026-11-10', '--ate', '2026-11-11']);
  assert.match(todas, /Requisições: 3\b/);
  await db.close();
});

test('periodo --linhas lista linhas, com teto de 200 e ip curto', async () => {
  const db = await semeado();
  const out = await executar(db, ['periodo', '--de', '2026-11-10', '--ate', '2026-11-11', '--linhas', '2']);
  assert.match(out, /Últimas 2 linhas/);
  assert.ok(out.includes('ip=abcdef01 '));
  assert.ok(!out.includes(IP_HASH.slice(0, 9)));
  await assert.rejects(executar(db, ['periodo', '--de', '2026-11-10', '--ate', '2026-11-11', '--linhas', '201']), ErroDeUso);
  await db.close();
});

test('periodo sem registros avisa', async () => {
  const db = await semeado();
  assert.match(await executar(db, ['periodo', '--de', '2025-01-01', '--ate', '2025-01-02']), /nenhum registro/);
  await db.close();
});

test('argumento inválido lança ErroDeUso', async () => {
  const db = await semeado();
  for (const argv of [[], ['x'], ['requisicao'], ['requisicao', '--id', "a'; b"], ['periodo'], ['periodo', '--de', '2026-13-01', '--ate', '2026-11-01'],
    ['periodo', '--de', '2026-11-05', '--ate', '2026-11-01'], ['periodo', '--de', '2026-11-01', '--ate', '2026-11-02', '--rota', 'api'],
    ['periodo', '--de', '2026-11-01', '--ate', '2026-11-02', '--linhas', '0']]) {
    await assert.rejects(executar(db, argv), ErroDeUso, JSON.stringify(argv));
  }
  await db.close();
});

test('linha de comando: id inexistente sai com 0; argumento inválido sai com 1 e mostra o uso', () => {
  const env = { ...process.env, DATABASE_URL: 'pglite://memory' };
  const ok = spawnSync(process.execPath, [FERRAMENTA, 'requisicao', '--id', 'abc-123'], { env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /nenhum registro/);
  const ruim = spawnSync(process.execPath, [FERRAMENTA, 'periodo', '--de', 'ontem'], { env, encoding: 'utf8' });
  assert.equal(ruim.status, 1);
  assert.match(ruim.stderr, /Uso:/);
  const sem = spawnSync(process.execPath, [FERRAMENTA, 'requisicao', '--id', 'x'], { env: { ...process.env, DATABASE_URL: '' }, encoding: 'utf8' });
  assert.equal(sem.status, 1);
});

test('código-fonte só tem leitura: nenhum verbo de escrita fora de comentários', () => {
  const src = readFileSync(FERRAMENTA, 'utf8');
  const semComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
  const achados = semComentarios.match(/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|merge|copy)\b/gi);
  assert.equal(achados, null, 'verbos de escrita: ' + achados);
  assert.match(semComentarios, /\bselect\b/i);
});
