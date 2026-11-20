// Regressão do Relatório Estratégico nas 9 séries de referência (9 × 8 setups = os 72 casos da paridade) e "rollback"
// da camada de linguagem (roadmap S7 a S10, 19/11/2026):
//  - com Debate simulado, toda série chega a 'aguardando_aprovacao' e passa nas regras da Revisão (todo número sai do motor);
//  - desligar o LLM (provedor sem chave): série sem tese em debate sai igual; série com tese fica 'bloqueado' SÓ pela seção 3
//    (por desenho, o relatório não sai pela metade), e as seções 1, 2, 4, 5 e 6 continuam disponíveis, com o mesmo texto,
//    por montarSecoesDeterministicas (o caminho que a Revisão usa e que o relatório do motor dispensa o LLM);
//  - a mesma rodada repetida dá o mesmo relatorioHash, e o resultHash de cada série é o do motor rodado à parte.
// Se este teste falhar, a diferença se investiga. Não se ajusta o teste.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../engine/index.js';
import { summarize } from '../lib/analysis-summary.js';
import { hashCanonical } from '../lib/canonical.js';
import { rodarPipeline } from '../lib/agents/pipeline.js';
import { avaliarRisco } from '../lib/agents/risco.js';
import { montarSecoesDeterministicas } from '../lib/agents/montagem.js';
import { summaryDoSnapshot, provedorSemLlm } from '../tools/relatorio-estrategico.mjs';
import { snapshotSeries } from '../lib/data/series.js';

const SIMBOLOS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'], TFS = ['1h', '4h', '1d'];
const T0 = Date.parse('2026-11-19T12:00:00.000Z');
const fixo = () => new Date(T0);
const loadSeries = async (s, tf) => summaryDoSnapshot(s, tf);

/** Debate simulado (o mesmo de agents-pipeline): texto sem número, citando as provas. */
const debateSimulado = {
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
    return { content: JSON.stringify({ itens }), usage: { prompt_tokens: 1, completion_tokens: 1 } };
  }
};

const rodar = (serie, provider, rodadaId) => rodarPipeline({ series: [serie], deps: { provider, loadSeries, now: fixo, rodadaId } });
const textosSemSecao3 = (rel) => rel.secoes.filter((_, i) => i !== 2).map((x) => x.blocos.map((b) => b.texto));

let casos = 0;
for (const s of SIMBOLOS) for (const tf of TFS) {
  const serie = `${s}:${tf}`;
  test(`regressão ${serie}: números do motor, LLM desligável sem mudar as seções do motor`, async () => {
    // o summary que entra no pipeline é o do motor rodado à parte
    const A = engine.analyze(snapshotSeries(s, tf), { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, {});
    assert.equal(A.setups.length >= 8, true);
    const sum = summarize(A, { symbol: s, timeframe: tf, source: 'snapshot' });
    assert.equal(summaryDoSnapshot(s, tf).resultHash, sum.resultHash);

    const comLlm = await rodar(serie, debateSimulado, 'r-' + serie);
    assert.equal(comLlm.estado, 'aguardando_aprovacao', JSON.stringify(comLlm.bloqueios ?? comLlm.motivo));
    assert.equal(comLlm.revisao.aprovadoPorRegras, true);
    assert.equal(comLlm.relatorio.secoes.length, 6);

    const semLlm = await rodar(serie, provedorSemLlm, 'r-' + serie);
    const det = montarSecoesDeterministicas({ summaries: [sum], risco: avaliarRisco([sum]) });
    assert.deepEqual(det.bloqueios, []);
    assert.ok([1, 2, 4, 5, 6].every((n) => det.secoes[n].length > 0), 'toda seção do motor tem conteúdo');
    const textosDet = [1, 2, 4, 5, 6].map((n) => det.secoes[n].map((b) => b.texto));
    assert.deepEqual(textosSemSecao3(comLlm.relatorio), textosDet, 'com LLM, uma seção do motor saiu diferente da montagem determinística');
    if (semLlm.estado === 'bloqueado') {
      assert.ok(semLlm.bloqueios.length > 0 && semLlm.bloqueios.every((b) => b.secao === 3), JSON.stringify(semLlm.bloqueios));
    } else {
      assert.equal(semLlm.estado, 'aguardando_aprovacao', semLlm.motivo);
      assert.deepEqual(textosSemSecao3(semLlm.relatorio), textosDet, 'desligar o LLM mudou uma seção que vem só do motor');
    }

    const denovo = await rodar(serie, debateSimulado, 'r-' + serie);
    assert.equal(denovo.relatorio.relatorioHash, comLlm.relatorio.relatorioHash);
    casos += A.setups.filter((x) => engine.SETUPS.some((y) => y.id === x.id)).length;
  });
}

test('os 72 casos de referência (9 séries × 8 setups) passaram pelo pipeline', () => {
  assert.equal(casos, 72);
});
