// Repositório dos agentes (agent_runs, revisao_humana): gravação, validações antes do banco, estado derivado,
// recibo semanal e ausência de UPDATE/DELETE no código.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';
import { inserirAgentRun, registrarRevisao, estadoRelatorio, runsDaRodada, reciboSemanal, STATUS_RUN } from '../lib/repo/agentes.js';

let db;
before(async () => { db = await createTestDb(); await migrate(db, { log: () => {} }); });
after(() => db.close());

const NAO_EXISTE = '00000000-0000-4000-8000-000000000000';
const montagem = (extra = {}) => inserirAgentRun(db, {
  rodadaId: 'R1', agente: 'montagem', entrada: { x: 1 }, saida: { y: 2, relatorio: { relatorioHash: 'h1' } }, status: 'aguardando_aprovacao',
  iniciadoEm: '2026-11-18T10:00:00Z', terminadoEm: '2026-11-18T10:01:00Z', ...extra,
});

test('inserir e ler: rodadaId em input, semana = segunda-feira, ordem de início', async () => {
  const b = await inserirAgentRun(db, { rodadaId: 'RA', agente: 'debate', entrada: { k: 1 }, saida: null, status: 'falhou', iniciadoEm: '2026-11-19T12:00:00Z', custoUsd: 0.5, tokensIn: 10, tokensOut: 5 });
  const a = await inserirAgentRun(db, { rodadaId: 'RA', agente: 'risco', entrada: null, saida: { o: 1 }, status: 'aguardando_aprovacao', iniciadoEm: '2026-11-18T09:00:00Z' });
  assert.match(a, /^[0-9a-f-]{36}$/);
  const runs = await runsDaRodada(db, 'RA');
  assert.deepEqual(runs.map((r) => r.id), [a, b]);
  assert.equal(runs[0].input.rodadaId, 'RA');
  assert.equal(runs[1].input.k, 1);
  assert.equal(runs[0].run_week, '2026-11-16'); // quarta 18/11 -> segunda 16/11
  assert.equal(runs[1].cost_usd, 0.5);
  await inserirAgentRun(db, { rodadaId: 'RD', agente: 'risco', status: 'falhou', iniciadoEm: '2026-11-22T23:59:00Z' });
  assert.equal((await runsDaRodada(db, 'RD'))[0].run_week, '2026-11-16'); // domingo ainda é da semana de 16/11
  assert.deepEqual(await runsDaRodada(db, 'inexistente'), []);
});

test('inserirAgentRun recusa agente fora da lista e dados faltando', async () => {
  await assert.rejects(() => inserirAgentRun(db, { rodadaId: 'R', agente: 'outro', status: 'falhou', iniciadoEm: '2026-11-18T10:00:00Z' }), /agente inválido/);
  await assert.rejects(() => inserirAgentRun(db, { agente: 'risco', status: 'falhou', iniciadoEm: '2026-11-18T10:00:00Z' }), /rodadaId/);
  await assert.rejects(() => inserirAgentRun(db, { rodadaId: 'R', agente: 'risco', status: 'falhou' }), /iniciadoEm/);
});

test('registrarRevisao: decisão fora da lista, e-mail e run que não é montagem são recusados antes do banco', async () => {
  const id = await montagem();
  await assert.rejects(() => registrarRevisao(db, { agentRunId: id, revisor: 'michel', decisao: 'talvez' }), /decisão inválida/);
  await assert.rejects(() => registrarRevisao(db, { agentRunId: id, revisor: 'michel@stratum.com', decisao: 'aprovado' }), /e-mail/);
  const risco = await inserirAgentRun(db, { rodadaId: 'R1', agente: 'risco', status: 'aguardando_aprovacao', iniciadoEm: '2026-11-18T10:00:00Z' });
  await assert.rejects(() => registrarRevisao(db, { agentRunId: risco, revisor: 'michel', decisao: 'aprovado' }), /montagem/);
  const n = await db.query('select count(*)::int as n from revisao_humana where agent_run_id in ($1, $2)', [id, risco]);
  assert.equal(n.rows[0].n, 0);
});

test('FK: revisão sobre execução inexistente é recusada', async () => {
  await assert.rejects(() => registrarRevisao(db, { agentRunId: NAO_EXISTE, revisor: 'michel', decisao: 'aprovado' }), /não existe/);
  await assert.rejects(() => registrarRevisao(db, { agentRunId: 'nao-e-uuid', revisor: 'michel', decisao: 'aprovado' }), /uuid/);
  // a restrição do banco também vale se alguém contornar o repositório
  await assert.rejects(() => db.query(`insert into revisao_humana (agent_run_id, reviewer, decision) values ('${NAO_EXISTE}', 'michel', 'aprovado')`));
});

test('estadoRelatorio: status da linha, depois a revisão mais recente', async () => {
  assert.deepEqual(await estadoRelatorio(db, NAO_EXISTE), { estado: 'inexistente', revisoes: [] });
  assert.equal((await estadoRelatorio(db, 'lixo')).estado, 'inexistente');
  const id = await montagem();
  assert.deepEqual(await estadoRelatorio(db, id), { estado: 'aguardando_aprovacao', revisoes: [] });
  await registrarRevisao(db, { agentRunId: id, revisor: 'michel', decisao: 'rejeitado', notas: 'faltou fonte' });
  let e = await estadoRelatorio(db, id);
  assert.equal(e.estado, 'rejeitado');
  assert.equal(e.revisoes[0].notes, 'faltou fonte');
  await new Promise((r) => setTimeout(r, 5));
  await registrarRevisao(db, { agentRunId: id, revisor: 'michel', decisao: 'aprovado_com_ajustes', mudancas: { secao: 2 } });
  e = await estadoRelatorio(db, id);
  assert.equal(e.estado, 'aprovado_com_ajustes');
  assert.equal(e.revisoes.length, 2);
  assert.deepEqual(e.revisoes[0].changes, { secao: 2 });
  const bloq = await montagem({ status: 'bloqueado' });
  assert.equal((await estadoRelatorio(db, bloq)).estado, 'bloqueado');
});

test('reciboSemanal conta por agente e por estado do relatório', async () => {
  const d = await createTestDb();
  await migrate(d, { log: () => {} });
  const ini = '2026-11-17T10:00:00Z';
  await inserirAgentRun(d, { rodadaId: 'S', agente: 'risco', status: 'aguardando_aprovacao', iniciadoEm: ini, custoUsd: 0.25, tokensIn: 100, tokensOut: 50 });
  await inserirAgentRun(d, { rodadaId: 'S', agente: 'risco', status: 'falhou', iniciadoEm: ini, custoUsd: 0.25, tokensIn: 10, tokensOut: 5 });
  const m1 = await inserirAgentRun(d, { rodadaId: 'S', agente: 'montagem', saida: { relatorio: { relatorioHash: 'h' } }, status: 'aguardando_aprovacao', iniciadoEm: ini });
  const m2 = await inserirAgentRun(d, { rodadaId: 'S', agente: 'montagem', saida: { relatorio: { relatorioHash: 'h' } }, status: 'aguardando_aprovacao', iniciadoEm: ini });
  await inserirAgentRun(d, { rodadaId: 'S', agente: 'montagem', saida: { relatorio: { relatorioHash: 'h' } }, status: 'aguardando_aprovacao', iniciadoEm: ini });
  await inserirAgentRun(d, { rodadaId: 'S', agente: 'montagem', status: 'bloqueado', iniciadoEm: ini });
  await inserirAgentRun(d, { rodadaId: 'T', agente: 'debate', status: 'falhou', iniciadoEm: '2026-11-24T10:00:00Z' }); // outra semana
  await registrarRevisao(d, { agentRunId: m1, revisor: 'michel', decisao: 'aprovado' });
  await registrarRevisao(d, { agentRunId: m2, revisor: 'michel', decisao: 'rejeitado' });
  const r = await reciboSemanal(d, '2026-11-16');
  assert.equal(r.semana, '2026-11-16');
  assert.deepEqual(r.porAgente.risco, { runs: 2, ok: 1, falhou: 1, tokensIn: 110, tokensOut: 55, custoUsd: 0.5 });
  assert.equal(r.porAgente.montagem.runs, 4);
  assert.equal(r.porAgente.montagem.ok, 3);
  assert.equal(r.porAgente.debate, undefined);
  assert.deepEqual(r.relatorios, { aguardando: 1, aprovados: 1, rejeitados: 1 });
  assert.deepEqual((await reciboSemanal(d, '2030-01-07')).porAgente, {});
  await d.close();
});

test('status: só os da lista entram; "aprovado" forjado por SQL vira invalido e não conta no recibo', async () => {
  assert.deepEqual(STATUS_RUN, ['ok', 'falhou', 'bloqueado', 'aguardando_aprovacao']);
  for (const status of ['aprovado', 'aprovado_com_ajustes', 'rejeitado', 'xyz']) {
    await assert.rejects(() => montagem({ status }), /status inválido/);
  }
  const d = await createTestDb();
  await migrate(d, { log: () => {} });
  await d.query(`insert into agent_runs (run_week, agent, input, output, status, started_at)
    values ('2026-11-16', 'montagem', '{}'::jsonb, '{"relatorio":{}}'::jsonb, 'aprovado', '2026-11-17T10:00:00Z')`);
  const id = (await d.query('select id from agent_runs')).rows[0].id;
  assert.equal((await estadoRelatorio(d, id)).estado, 'invalido');
  const r = await reciboSemanal(d, '2026-11-16');
  assert.deepEqual(r.relatorios, { aguardando: 0, aprovados: 0, rejeitados: 0 });
  assert.equal(r.porAgente.montagem.ok, 0);
  await d.close();
});

test('registrarRevisao: aprovar exige aguardando_aprovacao com relatório; rejeitar vale sobre qualquer montagem', async () => {
  const bloq = await montagem({ status: 'bloqueado', saida: { bloqueios: ['x'] } });
  await assert.rejects(() => registrarRevisao(db, { agentRunId: bloq, revisor: 'michel', decisao: 'aprovado' }), /aguardando aprovação/);
  await assert.rejects(() => registrarRevisao(db, { agentRunId: bloq, revisor: 'michel', decisao: 'aprovado_com_ajustes' }), /aguardando aprovação/);
  const semRel = await montagem({ saida: { y: 2 } });
  await assert.rejects(() => registrarRevisao(db, { agentRunId: semRel, revisor: 'michel', decisao: 'aprovado' }), /sem relatório/);
  const comRel = await montagem({ saida: { relatorio: { relatorioHash: 'h1' } } });
  await registrarRevisao(db, { agentRunId: comRel, revisor: 'michel', decisao: 'aprovado' });
  assert.equal((await estadoRelatorio(db, comRel)).estado, 'aprovado');
  await registrarRevisao(db, { agentRunId: bloq, revisor: 'michel', decisao: 'rejeitado' });
  assert.equal((await estadoRelatorio(db, bloq)).estado, 'rejeitado');
  const n = await db.query('select count(*)::int as n from revisao_humana where agent_run_id = $1', [bloq]);
  assert.equal(n.rows[0].n, 1);
  const qualquer = await montagem({ saida: { relatorio: 'qualquer' } });
  await assert.rejects(() => registrarRevisao(db, { agentRunId: qualquer, revisor: 'michel', decisao: 'aprovado' }), /sem relatório/);
});

test('aprovação gravada por SQL sobre run bloqueado é invalido e não conta no recibo', async () => {
  const bloq = await montagem({ status: 'bloqueado', saida: { bloqueios: ['x'] } });
  await db.query(`insert into revisao_humana (agent_run_id, reviewer, decision) values ($1, 'forjado', 'aprovado')`, [bloq]);
  assert.equal((await estadoRelatorio(db, bloq)).estado, 'invalido');
});

test('o repositório só acrescenta: nenhum UPDATE nem DELETE no código', () => {
  const src = readFileSync(new URL('../lib/repo/agentes.js', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(src, /\bupdate\s+(agent_runs|revisao_humana)\b/i);
  assert.doesNotMatch(src, /\bdelete\s+from\b/i);
  assert.doesNotMatch(src, /\btruncate\b/i);
});
