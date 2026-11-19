// Repositório dos agentes do Relatório Estratégico: execuções (agent_runs) e revisão humana (revisao_humana).
// As duas tabelas são tratadas como só-acréscimo: aqui só há INSERT e SELECT. O estado de um relatório
// nunca é gravado: deriva-se do status da execução de montagem e da revisão mais recente.
// Sem relógio interno: a semana vem de `iniciadoEm`, informado por quem chama.
import { AGENTES, DECISOES } from '../agents/contratos.js';
import { isoParam, jsonParam, UUID_RE } from './util.js';

/** Segunda-feira (UTC) da semana do instante, como 'YYYY-MM-DD'. */
function segundaDaSemana(iso) {
  const d = new Date(iso);
  const volta = (d.getUTCDay() + 6) % 7; // domingo = 0 -> volta 6
  const seg = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - volta));
  return seg.toISOString().slice(0, 10);
}

/** Status que uma execução pode ter. Aprovação e rejeição só existem em `revisao_humana`, nunca aqui. */
export const STATUS_RUN = ['ok', 'falhou', 'bloqueado', 'aguardando_aprovacao'];

/**
 * Estado de uma montagem a partir do status gravado e da última decisão humana. Status fora da lista é
 * `invalido`. Aprovação só vale sobre montagem que esperava aprovação: aprovação gravada por fora sobre run
 * bloqueado ou falho é `invalido` e nunca conta como aprovada. Rejeição vale sobre qualquer montagem.
 * @param {string} status
 * @param {string|null} decisao
 */
function estadoDe(status, decisao) {
  if (!STATUS_RUN.includes(status)) return 'invalido';
  if (!decisao) return status;
  if (decisao === 'rejeitado' || status === 'aguardando_aprovacao') return decisao;
  return 'invalido';
}

const SELECT_RUN = `select id, to_char(run_week, 'YYYY-MM-DD') as run_week, agent, input, output, status,
       cost_usd, tokens_in, tokens_out, started_at, finished_at from agent_runs`;

/**
 * Grava uma execução de agente. `rodadaId` vai em `input.rodadaId` (não há coluna própria).
 * @param {import('../db.js').Queryable} db
 * @param {{ rodadaId: string, agente: string, entrada?: object|null, saida?: object|null, status: string,
 *           custoUsd?: number|null, tokensIn?: number|null, tokensOut?: number|null,
 *           iniciadoEm: Date|string, terminadoEm?: Date|string|null }} r
 * @returns {Promise<string>} id (uuid) da execução
 */
export async function inserirAgentRun(db, r) {
  if (!AGENTES.includes(r.agente)) throw new Error(`inserirAgentRun: agente inválido "${String(r.agente)}" (aceitos: ${AGENTES.join(', ')})`);
  if (typeof r.rodadaId !== 'string' || r.rodadaId === '') throw new Error('inserirAgentRun: rodadaId obrigatório');
  if (!STATUS_RUN.includes(r.status)) throw new Error(`inserirAgentRun: status inválido "${String(r.status)}" (aceitos: ${STATUS_RUN.join(', ')})`);
  const inicio = isoParam(r.iniciadoEm, 'iniciadoEm');
  if (inicio === null) throw new Error('inserirAgentRun: iniciadoEm obrigatório');
  const fim = isoParam(r.terminadoEm, 'terminadoEm');
  const entrada = { ...(r.entrada ?? {}), rodadaId: r.rodadaId };
  const res = await db.query(
    `insert into agent_runs (run_week, agent, input, output, status, cost_usd, tokens_in, tokens_out, started_at, finished_at)
     values ($1::date, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)
     returning id`,
    [segundaDaSemana(inicio), r.agente, jsonParam(entrada), jsonParam(r.saida), r.status,
      r.custoUsd ?? null, r.tokensIn ?? null, r.tokensOut ?? null, inicio, fim],
  );
  return res.rows[0].id;
}

/**
 * Registra a decisão de um revisor humano sobre um relatório (execução de montagem).
 * @param {import('../db.js').Queryable} db
 * @param {{ agentRunId: string, revisor: string, decisao: string, mudancas?: object|null, notas?: string|null }} r
 * @returns {Promise<string>} id (uuid) da revisão
 */
export async function registrarRevisao(db, r) {
  if (!DECISOES.includes(r.decisao)) throw new Error(`registrarRevisao: decisão inválida "${String(r.decisao)}" (aceitas: ${DECISOES.join(', ')})`);
  if (typeof r.revisor !== 'string' || r.revisor.trim() === '') throw new Error('registrarRevisao: revisor obrigatório');
  if (r.revisor.includes('@')) throw new Error('registrarRevisao: revisor deve ser identificador interno, nunca e-mail');
  if (typeof r.agentRunId !== 'string' || !UUID_RE.test(r.agentRunId)) throw new Error('registrarRevisao: agentRunId deve ser uuid');
  const run = await db.query('select agent, status, output from agent_runs where id = $1', [r.agentRunId]);
  if (run.rows.length === 0) throw new Error(`registrarRevisao: execução ${r.agentRunId} não existe`);
  if (run.rows[0].agent !== 'montagem') throw new Error(`registrarRevisao: só se revisa execução de montagem (esta é "${run.rows[0].agent}")`);
  if (r.decisao !== 'rejeitado') {
    if (run.rows[0].status !== 'aguardando_aprovacao') throw new Error(`registrarRevisao: só se aprova montagem aguardando aprovação (esta está "${run.rows[0].status}")`);
    const saida = run.rows[0].output;
    if (saida === null || typeof saida !== 'object' || saida.relatorio === null || typeof saida.relatorio !== 'object' || typeof saida.relatorio.relatorioHash !== 'string') throw new Error('registrarRevisao: montagem sem relatório não pode ser aprovada');
  }
  const res = await db.query(
    `insert into revisao_humana (agent_run_id, reviewer, decision, changes, notes)
     values ($1, $2, $3, $4::jsonb, $5) returning id`,
    [r.agentRunId, r.revisor, r.decisao, jsonParam(r.mudancas), r.notas ?? null],
  );
  return res.rows[0].id;
}

/**
 * Estado atual de um relatório: sem revisão vale o status da execução; com revisão, a decisão da mais recente
 * (por `at`, desempate por id). `revisoes` vem da mais recente para a mais antiga.
 * @param {import('../db.js').Queryable} db
 * @param {string} agentRunId
 * @returns {Promise<{ estado: string, revisoes: object[] }>}
 */
export async function estadoRelatorio(db, agentRunId) {
  if (typeof agentRunId !== 'string' || !UUID_RE.test(agentRunId)) return { estado: 'inexistente', revisoes: [] };
  const run = await db.query('select status from agent_runs where id = $1', [agentRunId]);
  if (run.rows.length === 0) return { estado: 'inexistente', revisoes: [] };
  const rev = await db.query(
    `select id, agent_run_id, reviewer, decision, changes, notes, at from revisao_humana
      where agent_run_id = $1 order by at desc, id desc`,
    [agentRunId],
  );
  const revisoes = rev.rows;
  const status = run.rows[0].status;
  const estado = estadoDe(status, revisoes.length > 0 ? revisoes[0].decision : null);
  return { estado, revisoes };
}

/**
 * Execuções de uma rodada, em ordem de início.
 * @param {import('../db.js').Queryable} db
 * @param {string} rodadaId
 * @returns {Promise<object[]>}
 */
export async function runsDaRodada(db, rodadaId) {
  const res = await db.query(`${SELECT_RUN} where input->>'rodadaId' = $1 order by started_at, id`, [rodadaId]);
  return res.rows;
}

/**
 * Recibo da semana: contagens, tokens e custo por agente, e relatórios por estado. Sem texto de saída.
 * `ok` = execuções que não falharam nem foram bloqueadas.
 * @param {import('../db.js').Queryable} db
 * @param {string} semana segunda-feira, 'YYYY-MM-DD'
 * @returns {Promise<{ semana: string, porAgente: object, relatorios: { aguardando: number, aprovados: number, rejeitados: number } }>}
 */
export async function reciboSemanal(db, semana) {
  const res = await db.query(
    `select r.agent, r.status, r.cost_usd, r.tokens_in, r.tokens_out,
            (select v.decision from revisao_humana v where v.agent_run_id = r.id order by v.at desc, v.id desc limit 1) as decisao
       from agent_runs r where r.run_week = $1::date`,
    [semana],
  );
  const porAgente = {};
  const relatorios = { aguardando: 0, aprovados: 0, rejeitados: 0 };
  for (const l of res.rows) {
    const a = (porAgente[l.agent] ??= { runs: 0, ok: 0, falhou: 0, tokensIn: 0, tokensOut: 0, custoUsd: 0 });
    a.runs += 1;
    if (l.status === 'falhou') a.falhou += 1;
    else if (l.status === 'ok' || l.status === 'aguardando_aprovacao') a.ok += 1;
    a.tokensIn += Number(l.tokens_in ?? 0);
    a.tokensOut += Number(l.tokens_out ?? 0);
    a.custoUsd += Number(l.cost_usd ?? 0);
    if (l.agent === 'montagem') {
      const estado = estadoDe(l.status, l.decisao ?? null);
      if (estado === 'aguardando_aprovacao') relatorios.aguardando += 1;
      else if (estado === 'aprovado' || estado === 'aprovado_com_ajustes') relatorios.aprovados += 1;
      else if (estado === 'rejeitado') relatorios.rejeitados += 1;
    }
  }
  return { semana, porAgente, relatorios };
}
