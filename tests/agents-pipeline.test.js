// Pipeline do Relatório Estratégico, offline: snapshot real, banco em memória com migrações e provedor simulado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';
import { rodarPipeline } from '../lib/agents/pipeline.js';
import { estadoRelatorio, registrarRevisao, runsDaRodada } from '../lib/repo/agentes.js';
import { hashCanonical } from '../lib/canonical.js';
import { main as ferramenta, summaryDoSnapshot, provedorSemLlm } from '../tools/relatorio-estrategico.mjs';

let db;
before(async () => { db = await createTestDb(); await migrate(db, { log: () => {} }); });
after(() => db.close());

// BTCUSDT 4h não tem tese elegível ao Debate no snapshot; ETHUSDT 4h tem (BREAKOUT_20 em avaliação).
const SERIES = ['BTCUSDT:4h', 'ETHUSDT:4h'];
const loadSeries = async (s, tf) => summaryDoSnapshot(s, tf);
const T0 = Date.parse('2026-11-19T12:00:00.000Z');
const relogio = () => { let i = 0; return () => new Date(T0 + 1000 * i++); };
const fixo = () => new Date(T0);

/** Debate simulado: lê teses e provas do pedido e responde com texto sem número, citando as provas. */
function debateSimulado() {
  return {
    model: 'sim',
    async chat({ messages }) {
      const pedido = JSON.parse(messages[1].content.split('\n').slice(1).join('\n'));
      const itens = pedido.teses.map((t) => {
        const ps = pedido.provas.filter((p) => p.caminho.includes(`id=${t.setupId}]`));
        return {
          setupId: t.setupId,
          pros: [{ texto: 'A taxa de acerto está registrada no histórico.', provas: [ps[0].id] }],
          contras: [{ texto: 'A taxa-base é a referência de comparação.', provas: [ps[1].id] }],
          preMortem: [{ metrica: 'taxa-base', provaLimiar: ps[1].id, texto: 'Se a taxa de acerto não superar a taxa-base, a leitura perde sustentação.' }]
        };
      });
      return { content: JSON.stringify({ itens }), usage: { prompt_tokens: 100, completion_tokens: 50 } };
    }
  };
}

const rodar = (extra = {}, provider = debateSimulado()) =>
  rodarPipeline({ series: SERIES, deps: { db, provider, loadSeries, now: relogio(), ...extra } });

test('ponta a ponta com debate válido: aguardando_aprovacao, runs gravados, nada aprovado', async () => {
  const r = await rodar({ rodadaId: 'rodada-ok' });
  assert.equal(r.estado, 'aguardando_aprovacao', JSON.stringify(r.bloqueios ?? r.motivo));
  assert.equal(r.revisao.aprovadoPorRegras, true);
  assert.ok(r.relatorio.provas.length > 0);
  const runs = await runsDaRodada(db, 'rodada-ok');
  assert.deepEqual(runs.map((x) => x.agent).sort(), ['debate', 'montagem', 'revisao', 'risco']);
  assert.equal(runs.length, r.runs.length);
  assert.equal(r.relatorio.secoes[2].blocos.some((b) => b.texto.startsWith('Prós (BREAKOUT_20)')), true);
  const deb = runs.find((x) => x.agent === 'debate');
  assert.equal(deb.tokens_in, 100);
  assert.ok(deb.finished_at && deb.started_at);
  const e = await estadoRelatorio(db, r.montagemRunId);
  assert.equal(e.estado, 'aguardando_aprovacao');
  assert.deepEqual(e.revisoes, []);
  // só a pessoa aprova
  await registrarRevisao(db, { agentRunId: r.montagemRunId, revisor: 'michel', decisao: 'aprovado' });
  assert.equal((await estadoRelatorio(db, r.montagemRunId)).estado, 'aprovado');
});

test('sem LLM: Debate falha, Montagem bloqueia a seção 3 e nada fica aprovado', async () => {
  const r = await rodar({ rodadaId: 'rodada-sem-llm' }, provedorSemLlm);
  assert.equal(r.estado, 'bloqueado');
  assert.ok(r.bloqueios.some((b) => b.secao === 3 && /debate falhou/.test(b.motivo)));
  assert.equal(r.relatorio, undefined);
  const runs = await runsDaRodada(db, 'rodada-sem-llm');
  assert.equal(runs.find((x) => x.agent === 'debate').status, 'falhou');
  assert.equal((await estadoRelatorio(db, r.montagemRunId)).estado, 'bloqueado');
});

test('exceção no provedor vira Debate falhou, não derruba o pipeline', async () => {
  const quebrado = { async chat() { throw new Error('boom'); } };
  const r = await rodar({ rodadaId: 'rodada-boom' }, quebrado);
  assert.equal(r.estado, 'bloqueado');
});

test('saída da Montagem adulterada entre etapas: a Revisão reprova e o estado é bloqueado', async () => {
  const { montarRelatorio } = await import('../lib/agents/montagem.js');
  const adulterada = (entrada) => {
    const m = montarRelatorio(entrada);
    const rel = structuredClone(m.relatorio);
    rel.provas[0].valor += 0.01;
    const { relatorioHash, ...resto } = rel;
    rel.relatorioHash = hashCanonical(resto); // hash refeito: só a conferência contra o summary pega
    return { ok: true, relatorio: rel };
  };
  const r = await rodar({ rodadaId: 'rodada-adulterada', montar: adulterada });
  assert.equal(r.estado, 'bloqueado');
  assert.equal(r.revisao.aprovadoPorRegras, false);
  assert.ok(r.bloqueios.length > 0);
  assert.equal((await estadoRelatorio(db, r.montagemRunId)).estado, 'bloqueado');
});

test('sem banco: roda igual e devolve os registros em memória', async () => {
  const r = await rodarPipeline({ series: SERIES, deps: { provider: debateSimulado(), loadSeries, now: relogio() } });
  assert.equal(r.estado, 'aguardando_aprovacao');
  assert.deepEqual(r.registros.map((x) => x.agente), ['risco', 'debate', 'montagem', 'revisao']);
  assert.equal(r.montagemRunId, null);
});

test('falha ao carregar série: estado falhou, sem relatório', async () => {
  const r = await rodarPipeline({ series: ['BTCUSDT:4h'], deps: { loadSeries: async () => { throw new Error('sem dado'); }, now: fixo } });
  assert.equal(r.estado, 'falhou');
  assert.match(r.motivo, /sem dado/);
});

test('determinismo: mesmo input, mesmo now e mesmo rodadaId dão o mesmo relatorioHash', async () => {
  const a = await rodarPipeline({ series: SERIES, deps: { provider: debateSimulado(), loadSeries, now: fixo, rodadaId: 'fixa' } });
  const b = await rodarPipeline({ series: SERIES, deps: { provider: debateSimulado(), loadSeries, now: fixo, rodadaId: 'fixa' } });
  assert.equal(a.relatorio.relatorioHash, b.relatorio.relatorioHash);
  const c = await rodarPipeline({ series: SERIES, deps: { provider: debateSimulado(), loadSeries, now: fixo, rodadaId: 'outra' } });
  assert.notEqual(c.relatorio.relatorioHash, a.relatorio.relatorioHash);
});

test('ferramenta: --saida dentro do repositório é recusada; sem banco só imprime resumo', async () => {
  const linhas = [];
  await assert.rejects(() => ferramenta(['gerar', '--serie', 'BTCUSDT:4h', '--saida', './relatorio-saida.json'], (l) => linhas.push(l), {}), /dentro do repositório/);
  assert.deepEqual(linhas, []);
  const r = await ferramenta(['gerar', '--serie', 'BTCUSDT:4h', '--sem-llm'], (l) => linhas.push(l), {});
  assert.equal(r.estado, 'aguardando_aprovacao'); // BTC 4h não tem tese para o Debate: nada a bloquear
  const texto = linhas.join('\n');
  assert.match(texto, /estado: aguardando_aprovacao/);
  assert.match(texto, /sem DATABASE_URL/);
  assert.ok(!texto.includes('Contexto de Regime'));
  await assert.rejects(() => ferramenta(['estado', '--run', 'x'], () => {}, {}), /DATABASE_URL/);
});

test('pipeline passa risco e debate à Revisão', async () => {
  let recebido;
  const r = await rodar({ rodadaId: 'rodada-args', revisar: async (rel, o) => { recebido = o; return { agente: 'revisao', aprovadoPorRegras: true, achados: [], llm: null }; } });
  assert.equal(r.estado, 'aguardando_aprovacao');
  assert.equal(recebido.risco.teses.length > 0, true);
  assert.equal(recebido.debate.agente, 'debate');
  assert.equal(Array.isArray(recebido.summaries), true);
});
