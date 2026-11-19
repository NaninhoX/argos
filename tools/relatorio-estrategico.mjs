// Relatório Estratégico: gera, consulta, aprova e dá o recibo semanal.
//
// Uso:
//   node tools/relatorio-estrategico.mjs gerar --serie BTCUSDT:4h [--serie ETHUSDT:4h ...] [--sem-llm] [--saida <arquivo fora do repositório>]
//   node tools/relatorio-estrategico.mjs estado --run <id>
//   node tools/relatorio-estrategico.mjs aprovar --run <id> --revisor <id> --decisao aprovado|aprovado_com_ajustes|rejeitado [--notas "..."]
//   node tools/relatorio-estrategico.mjs recibo --semana AAAA-MM-DD
//
// ATENÇÃO (decisão de Michel): rodar contra o Neon de produção (DATABASE_URL real) ou com chave real de LLM
// (ARGOS_LLM_API_KEY etc.) gasta crédito e grava em produção. Nada disso é feito por padrão nem em teste.
// Sem DATABASE_URL, `gerar` roda em memória e imprime só o resumo. O texto inteiro só sai com --saida, e o
// arquivo é recusado se estiver dentro do repositório. Com --sem-llm o Debate falha por desenho: se houver tese
// em avaliação ou vetada, o relatório fica bloqueado na seção 3; sem tese para debater (ex.: BTCUSDT 4h do
// snapshot), chega a `aguardando_aprovacao`. Sem chave de LLM no ambiente, o comportamento é o mesmo de --sem-llm.
// Aprovar é ato de pessoa: só o subcomando `aprovar` chama registrarRevisao.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as engine from '../engine/index.js';
import { snapshotSeries } from '../lib/data/series.js';
import { summarize } from '../lib/analysis-summary.js';
import { resolveDb } from '../lib/db.js';
import { llmReady, providerFromEnv, ProviderError } from '../lib/ai/provider.js';
import { rodarPipeline } from '../lib/agents/pipeline.js';
import { estadoRelatorio, registrarRevisao, reciboSemanal } from '../lib/repo/agentes.js';
import { caminhoSeguro } from './backup-neon.mjs';

/** Provedor que sempre falha: o Debate fica "falhou" e a Montagem bloqueia a seção 3. */
export const provedorSemLlm = { model: 'sem-llm', async chat() { throw new ProviderError('not_configured'); } };

function opcoes(args) {
  const o = { serie: [], flags: new Set() };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) throw new Error('argumento inesperado: ' + a);
    const nome = a.slice(2);
    if (nome === 'sem-llm') { o.flags.add(nome); continue; }
    const v = args[++i];
    if (v === undefined || v.startsWith('--')) throw new Error('faltou o valor de --' + nome);
    if (nome === 'serie') o.serie.push(v); else o[nome] = v;
  }
  return o;
}

/** Summary de uma série do snapshot embutido (mesma configuração dos testes dos agentes). */
export function summaryDoSnapshot(symbol, timeframe) {
  return summarize(
    engine.analyze(snapshotSeries(symbol, timeframe), { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, {}),
    { symbol, timeframe, source: 'snapshot' }
  );
}

export async function main(argv = process.argv.slice(2), log = console.log, env = process.env) {
  const [cmd, ...resto] = argv;
  const o = opcoes(resto);
  if (cmd === 'gerar') {
    if (o.serie.length === 0) throw new Error('informe ao menos uma --serie SIMBOLO:tf');
    const saida = o.saida ? caminhoSeguro(o.saida) : null; // recusa o repositório antes de qualquer trabalho
    const db = env.DATABASE_URL ? await resolveDb(env) : undefined;
    try {
      const provider = o.flags.has('sem-llm') || !llmReady(env) ? provedorSemLlm : providerFromEnv(env);
      const r = await rodarPipeline({
        series: o.serie,
        deps: { db, provider, now: () => new Date(), loadSeries: async (s, tf) => summaryDoSnapshot(s, tf) }
      });
      log(`estado: ${r.estado}`);
      log(`rodada: ${r.rodadaId}`);
      if (r.montagemRunId) log(`run da montagem (use em estado/aprovar): ${r.montagemRunId}`);
      if (!db) log('sem DATABASE_URL: nada foi gravado (execução em memória)');
      if (r.relatorio) log(`provas: ${r.relatorio.provas.length}  hash: ${r.relatorio.relatorioHash}`);
      if (r.motivo) log('motivo: ' + r.motivo);
      for (const b of r.bloqueios || []) log(`bloqueio (seção ${b.secao}): ${b.motivo}`);
      if (saida && r.relatorio) {
        fs.writeFileSync(saida, JSON.stringify(r.relatorio, null, 2), { flag: 'wx' });
        log('relatório gravado em ' + saida);
      }
      return r;
    } finally {
      if (db) await db.close();
    }
  }
  if (cmd === 'estado' || cmd === 'aprovar' || cmd === 'recibo') {
    const db = await resolveDb(env); // lança sem DATABASE_URL
    try {
      if (cmd === 'estado') {
        if (!o.run) throw new Error('informe --run <id>');
        const e = await estadoRelatorio(db, o.run);
        log(`estado: ${e.estado}`);
        for (const v of e.revisoes) log(`revisão: ${v.decision} por ${v.reviewer}`);
        return e;
      }
      if (cmd === 'aprovar') {
        if (!o.run || !o.revisor || !o.decisao) throw new Error('informe --run, --revisor e --decisao');
        const id = await registrarRevisao(db, { agentRunId: o.run, revisor: o.revisor, decisao: o.decisao, notas: o.notas ?? null });
        log(`revisão registrada: ${id}`);
        return id;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.semana || '')) throw new Error('informe --semana AAAA-MM-DD (segunda-feira)');
      const rec = await reciboSemanal(db, o.semana);
      log(JSON.stringify(rec, null, 2));
      return rec;
    } finally {
      await db.close();
    }
  }
  log('uso: node tools/relatorio-estrategico.mjs gerar|estado|aprovar|recibo (veja o topo do arquivo)');
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Falha:', err.message);
    process.exit(1);
  });
}
