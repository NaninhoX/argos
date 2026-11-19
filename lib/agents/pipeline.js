// Pipeline do Relatório Estratégico: summaries -> Risco -> provas -> Debate -> Montagem -> Revisão.
// Cada agente grava uma linha em agent_runs quando há banco; sem banco roda igual e devolve os registros em memória.
// Nada aqui aprova relatório: o estado final é 'aguardando_aprovacao', 'bloqueado' ou 'falhou'. Aprovar é
// registrarRevisao (lib/repo/agentes.js), chamada por pessoa. Sem relógio nem LLM próprios: tudo entra por `deps`.
import { randomUUID } from 'node:crypto';
import { avaliarRisco } from './risco.js';
import { rodarDebate } from './debate.js';
import { extrairProvas, montarRelatorio } from './montagem.js';
import { revisarRelatorio } from './revisao.js';
import { inserirAgentRun } from '../repo/agentes.js';

const ESTADOS_COM_DEBATE = ['em_avaliacao', 'veto_risco'];
const iso = (x) => new Date(x).toISOString();
const msg = (e) => String((e && e.message) || e).slice(0, 300);

/** Aceita { symbol, timeframe } ou "SIMBOLO:tf". */
function normalizarSerie(s) {
  if (typeof s === 'string') {
    const [symbol, timeframe] = s.split(':');
    return { symbol, timeframe };
  }
  return { symbol: s && s.symbol, timeframe: s && s.timeframe };
}

/**
 * `montar` e `revisar` só existem para teste (injetar adulteração entre etapas); o padrão são os módulos reais.
 * A Revisão roda só pelas regras (sem LLM): o passo LLM dela é opcional e aqui fica desligado.
 * @param {{ series: ({symbol:string,timeframe:string}|string)[], deps: {
 *   db?: import('../db.js').Queryable, provider?: { chat: Function },
 *   loadSeries: (symbol: string, timeframe: string) => object | Promise<object>,
 *   now: () => Date | string, rodadaId?: string, montar?: Function, revisar?: Function } }} args
 * @returns {Promise<{ rodadaId: string, estado: 'aguardando_aprovacao'|'bloqueado'|'falhou', relatorio?: object,
 *   revisao?: object, bloqueios?: object[], motivo?: string, montagemRunId: string|null, runs: string[], registros: object[] }>}
 */
export async function rodarPipeline({ series, deps } = {}) {
  const { db, provider, loadSeries, now } = deps || {};
  if (typeof loadSeries !== 'function' || typeof now !== 'function') throw new TypeError('rodarPipeline: deps.loadSeries e deps.now são obrigatórios');
  const rodadaId = deps.rodadaId || randomUUID();
  const montar = deps.montar || montarRelatorio;
  const revisar = deps.revisar || revisarRelatorio;
  const registros = [];
  const runs = [];
  let montagemRunId = null;

  /** Grava (ou só guarda em memória) a execução de um agente. Devolve o id, ou null sem banco. */
  async function registrar(agente, { entrada, saida, status, tokensIn = null, tokensOut = null, inicio, fim }) {
    const reg = { rodadaId, agente, entrada, saida, status, tokensIn, tokensOut, iniciadoEm: iso(inicio), terminadoEm: iso(fim) };
    registros.push(reg);
    if (!db) { runs.push(`${rodadaId}:${agente}`); return null; }
    const id = await inserirAgentRun(db, reg);
    runs.push(id);
    return id;
  }
  const resultado = (extra) => ({ rodadaId, montagemRunId, runs, registros, ...extra });

  // ----- summaries
  const lista = (Array.isArray(series) ? series : []).map(normalizarSerie);
  if (lista.length === 0 || lista.some((s) => !s.symbol || !s.timeframe)) return resultado({ estado: 'falhou', motivo: 'séries inválidas ou ausentes' });
  let summaries;
  try {
    summaries = [];
    for (const s of lista) summaries.push(await loadSeries(s.symbol, s.timeframe));
  } catch (e) {
    return resultado({ estado: 'falhou', motivo: 'summaries: ' + msg(e) });
  }
  const geradoEm = iso(now());

  // ----- Risco
  let risco;
  {
    const inicio = now();
    try {
      risco = avaliarRisco(summaries);
    } catch (e) {
      await registrar('risco', { entrada: { series: lista }, saida: { erro: msg(e) }, status: 'falhou', inicio, fim: now() });
      return resultado({ estado: 'falhou', motivo: 'risco: ' + msg(e) });
    }
    await registrar('risco', { entrada: { series: lista }, saida: risco, status: 'ok', inicio, fim: now() });
  }

  // ----- provas (determinísticas; não são agente e não gravam linha própria)
  const caminhos = [];
  for (const t of risco.teses) {
    if (!ESTADOS_COM_DEBATE.includes(t.estado)) continue;
    const serie = `${t.serie.symbol} ${t.serie.timeframe}`;
    caminhos.push({ caminho: `setups[id=${t.setupId}].winRate`, serie }, { caminho: `setups[id=${t.setupId}].base`, serie });
  }
  const provas = extrairProvas(summaries, caminhos);

  // ----- Debate (exceção vira "falhou": a Montagem bloqueia a seção 3)
  let debate;
  {
    const inicio = now();
    try {
      debate = await rodarDebate({ teses: risco.teses, provas, provider });
    } catch (e) {
      debate = { agente: 'debate', status: 'falhou', itens: [], uso: { tokensIn: 0, tokensOut: 0 }, motivo: msg(e) };
    }
    await registrar('debate', {
      entrada: { teses: risco.teses.filter((t) => ESTADOS_COM_DEBATE.includes(t.estado)).length, provas: provas.length },
      saida: debate, status: debate.status === 'ok' ? 'ok' : 'falhou',
      tokensIn: debate.uso?.tokensIn ?? null, tokensOut: debate.uso?.tokensOut ?? null, inicio, fim: now()
    });
  }

  // ----- Montagem e Revisão (a linha da Montagem leva o estado final: só se grava depois da Revisão)
  const inicioMontagem = now();
  const entradaMontagem = { series: lista, provas: provas.length, debate: debate.status };
  let montagem;
  try {
    montagem = montar({ summaries, risco, debate, meta: { geradoEm, rodadaId, provas } });
  } catch (e) {
    montagemRunId = await registrar('montagem', { entrada: entradaMontagem, saida: { erro: msg(e) }, status: 'falhou', inicio: inicioMontagem, fim: now() });
    return resultado({ estado: 'falhou', motivo: 'montagem: ' + msg(e) });
  }
  if (!montagem.ok) {
    montagemRunId = await registrar('montagem', { entrada: entradaMontagem, saida: { bloqueios: montagem.bloqueios }, status: 'bloqueado', inicio: inicioMontagem, fim: now() });
    return resultado({ estado: 'bloqueado', bloqueios: montagem.bloqueios });
  }

  const inicioRevisao = now();
  let revisao;
  try {
    revisao = await revisar(montagem.relatorio, { summaries, risco, debate });
  } catch (e) {
    montagemRunId = await registrar('montagem', { entrada: entradaMontagem, saida: { relatorio: montagem.relatorio }, status: 'falhou', inicio: inicioMontagem, fim: inicioRevisao });
    await registrar('revisao', { entrada: { relatorioHash: montagem.relatorio.relatorioHash }, saida: { erro: msg(e) }, status: 'falhou', inicio: inicioRevisao, fim: now() });
    return resultado({ estado: 'falhou', relatorio: montagem.relatorio, motivo: 'revisão: ' + msg(e) });
  }
  const aprovadoPorRegras = !!revisao && revisao.aprovadoPorRegras === true;
  const estado = aprovadoPorRegras ? 'aguardando_aprovacao' : 'bloqueado';
  montagemRunId = await registrar('montagem', {
    entrada: entradaMontagem, saida: { relatorio: montagem.relatorio }, status: estado, inicio: inicioMontagem, fim: inicioRevisao
  });
  await registrar('revisao', {
    entrada: { relatorioHash: montagem.relatorio.relatorioHash }, saida: revisao, status: aprovadoPorRegras ? 'ok' : 'bloqueado',
    inicio: inicioRevisao, fim: now()
  });
  return resultado({
    estado, relatorio: montagem.relatorio, revisao,
    ...(aprovadoPorRegras ? {} : { bloqueios: (revisao?.achados || []).map((a) => ({ secao: a.secao, motivo: `${a.regra}: ${a.detalhe}`, trecho: '' })) })
  });
}
