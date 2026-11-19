import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../engine/index.js';
import { snapshotSeries } from '../lib/data/series.js';
import { summarize } from '../lib/analysis-summary.js';
import { DISCLAIMER_PADRAO, scanText } from '../lib/compliance.js';
import { SECOES, validarRelatorio } from '../lib/agents/contratos.js';
import { montarRelatorio, montarSecoesDeterministicas, numerosDoTexto, extrairProvas, ISENCOES_IC_PENDENTES } from '../lib/agents/montagem.js';
import { hashCanonical } from '../lib/canonical.js';

const summary = summarize(
  engine.analyze(snapshotSeries('BTCUSDT', '4h'), { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, {}),
  { symbol: 'BTCUSDT', timeframe: '4h', source: 'snapshot' }
);
const serie = { symbol: 'BTCUSDT', timeframe: '4h' };
const CAMINHOS = ['setups[id=RSI_OVERSOLD].winRate', 'setups[id=RSI_OVERSOLD].base', 'base.rate'];
const clone = (x) => JSON.parse(JSON.stringify(x));

const provas = extrairProvas([summary], CAMINHOS);
const meta = () => ({ geradoEm: '2026-11-19T12:00:00.000Z', rodadaId: 'r-1', provas: clone(provas) });
const risco = () => ({
  agente: 'risco', versaoRegras: '1',
  teses: [
    { serie, setupId: 'RSI_OVERSOLD', estado: 'veto_risco', vetos: [{ regra: 'n_minimo', campo: 'n', valor: 290, limiar: 30, fonteLimiar: 'regras.json' }] },
    { serie, setupId: 'BREAKOUT_20', estado: 'em_avaliacao', vetos: [] }
  ],
  avisos: []
});
const debate = (texto = 'A taxa de acerto ficou abaixo da taxa-base.') => ({
  agente: 'debate', status: 'ok',
  itens: [{ setupId: 'RSI_OVERSOLD', pros: [{ texto: 'Amostra grande.', provas: [provas[0].id] }], contras: [{ texto, provas: [provas[0].id] }], preMortem: [{ metrica: 'winRate', provaLimiar: provas[1].id, texto: 'Se a taxa passar da taxa-base, a leitura muda.' }] }],
  uso: { tokensIn: 1, tokensOut: 1 }
});
const montar = (o = {}) => montarRelatorio({ summaries: [summary], risco: risco(), debate: debate(), meta: meta(), ...o });

test('relatório válido: 6 seções na ordem, disclaimer, contrato', () => {
  const r = montar();
  assert.equal(r.ok, true, JSON.stringify(r.bloqueios));
  const rel = r.relatorio;
  assert.deepEqual(rel.secoes.map((s) => s.titulo), SECOES.map((s) => s.titulo));
  assert.equal(rel.disclaimer, DISCLAIMER_PADRAO);
  assert.equal(rel.estado, 'aguardando_aprovacao');
  assert.equal(rel.motor, summary.engine);
  assert.deepEqual(validarRelatorio(rel), { ok: true });
  assert.ok(rel.secoes.every((s) => s.blocos.length > 0));
  assert.match(rel.secoes[1].blocos[0].texto, /p ajustado na família de setups da série/);
  assert.match(rel.secoes[5].blocos[0].texto, /sem intervalo calculado pelo motor/);
  const { relatorioHash, ...resto } = rel;
  assert.equal(relatorioHash, hashCanonical(resto));
});

test('determinismo: mesma entrada, mesmo hash; geradoEm muda o hash', () => {
  const a = montar().relatorio.relatorioHash;
  assert.equal(montar().relatorio.relatorioHash, a);
  const m = meta(); m.geradoEm = '2026-11-19T12:00:01.000Z';
  assert.notEqual(montar({ meta: m }).relatorio.relatorioHash, a);
});

test('nenhum texto do relatório é acusado pelo scanText', () => {
  const rel = montar().relatorio;
  for (const s of rel.secoes) for (const b of s.blocos) assert.deepEqual(scanText(b.texto), [], b.texto);
});

test('número sem prova no texto do Debate bloqueia', () => {
  const r = montar({ debate: debate('A taxa de acerto foi 99,9% no período.') });
  assert.equal(r.ok, false);
  assert.ok(r.bloqueios.some((b) => b.secao === 3 && /número sem prova/.test(b.motivo)));
});

test('número da prova citada é aceito no Debate', () => {
  const txt = `A taxa de acerto foi ${(provas[0].valor * 100).toFixed(1).replace('.', ',')}%.`;
  assert.equal(montar({ debate: debate(txt) }).ok, true);
});

test('debate falhou bloqueia na seção 3', () => {
  const d = debate(); d.status = 'falhou';
  const r = montar({ debate: d });
  assert.equal(r.ok, false);
  assert.ok(r.bloqueios.some((b) => b.secao === 3 && /debate falhou/.test(b.motivo)));
});

test('texto proibido injetado bloqueia', () => {
  const r = montar({ debate: debate('Compre agora, recomendamos a entrada.') });
  assert.equal(r.ok, false);
  assert.ok(r.bloqueios.some((b) => b.secao === 3 && /compliance/.test(b.motivo)));
});

test('prova inexistente e veto com valor diferente do motor bloqueiam', () => {
  const d = debate(); d.itens[0].contras[0].provas = ['P999'];
  assert.ok(montar({ debate: d }).bloqueios.some((b) => /não existe/.test(b.motivo)));
  const rk = risco(); rk.teses[0].vetos[0].valor = 291;
  assert.ok(montar({ risco: rk }).bloqueios.some((b) => b.secao === 4 && /difere do motor/.test(b.motivo)));
});

test('IC nulo: aceito para contagem, p e lista de isenções; recusado para fração fora da lista', () => {
  assert.ok(ISENCOES_IC_PENDENTES.includes('calibration.ece'));
  const ps = extrairProvas([summary], ['calibration.n', 'setups[id=RSI_OVERSOLD].q', 'setups[id=RSI_OVERSOLD].share']);
  assert.equal(ps.length, 2); // share não existe no setup: sem prova
  const fora = clone(provas[0]); fora.ic95 = null;
  const m = meta(); m.provas = [fora, ...m.provas.slice(1)];
  const r = montar({ meta: m });
  assert.equal(r.ok, false);
  assert.ok(r.bloqueios.some((b) => /fora de ISENCOES_IC_PENDENTES/.test(b.motivo)));
});

test('extrairProvas preenche origem e campos do setup', () => {
  const p = provas[0];
  assert.equal(p.origem.resultHash, summary.resultHash);
  assert.equal(p.origem.seriesHash, summary.data.hash);
  assert.equal(p.origem.engine, summary.engine);
  assert.equal(p.origem.caminho, CAMINHOS[0]);
  assert.equal(p.n, 290);
  assert.equal(p.ic95.length, 2);
  assert.equal(typeof p.pAjustado, 'number');
});

test('B1: número no campo metrica do Pré-Mortem não é mascarado e bloqueia', () => {
  const d = debate(); d.itens[0].preMortem[0].metrica = 'alvo 68250';
  const r = montar({ debate: d });
  assert.equal(r.ok, false);
  assert.ok(r.bloqueios.some((b) => b.secao === 3 && /número sem prova no bloco: 68250/.test(b.motivo)));
  const ok = debate(); ok.itens[0].preMortem[0].metrica = 'taxa-base';
  assert.equal(montar({ debate: ok }).ok, true);
});

test('sinal: "0,4" no lugar de "-0,4" (e o inverso) bloqueia; menos tipográfico conta como sinal', () => {
  assert.deepEqual(numerosDoTexto('BSS -0,4% e −1,5 e 3-4 e BTC-4'), ['-0,4', '-1,5', '3', '4', '4']);
  const neg = clone(provas[0]); neg.valor = -0.004; neg.ic95 = [-0.01, 0.002];
  const m = meta(); m.provas = [neg, ...m.provas.slice(1)];
  const semSinal = montar({ meta: m, debate: debate('A taxa de acerto foi 0,4%.') });
  assert.equal(semSinal.ok, false);
  assert.ok(semSinal.bloqueios.some((b) => /número sem prova no bloco: 0,4/.test(b.motivo)));
  assert.equal(montar({ meta: m, debate: debate('A taxa de acerto foi -0,4%.') }).ok, true);
  assert.equal(montar({ meta: m, debate: debate('A taxa de acerto foi −0,4%.') }).ok, true);
});

test('timeframe: só "BTCUSDT 4h" é literal; "4h" solto bloqueia', () => {
  assert.equal(montar({ debate: debate('A taxa de acerto abaixo da taxa-base em BTCUSDT 4h.') }).ok, true);
  const r = montar({ debate: debate('Janela das próximas 4h.') });
  assert.equal(r.ok, false);
  assert.ok(r.bloqueios.some((b) => b.secao === 3 && /número sem prova no bloco: 4/.test(b.motivo)));
});

test('Debate para setup fora de em_avaliacao/veto_risco, ou sem tese, bloqueia', () => {
  const rk = risco(); rk.teses[0].estado = 'sem_edge'; rk.teses[0].vetos = [];
  const r = montar({ risco: rk });
  assert.equal(r.ok, false);
  assert.ok(r.bloqueios.some((b) => b.secao === 3 && /fora de em_avaliacao\/veto_risco/.test(b.motivo)));
  const d = debate(); d.itens[0].setupId = 'NAO_EXISTE';
  assert.ok(montar({ debate: d }).bloqueios.some((b) => /sem tese/.test(b.motivo)));
});

test('argumento com provas vazias bloqueia (pró e contra)', () => {
  const d = debate(); d.itens[0].pros[0].provas = [];
  assert.ok(montar({ debate: d }).bloqueios.some((b) => b.secao === 3 && /argumento sem prova/.test(b.motivo)));
  const e = debate(); e.itens[0].contras[0].provas = [];
  assert.ok(montar({ debate: e }).bloqueios.some((b) => b.secao === 3 && /argumento sem prova/.test(b.motivo)));
});

test('montarSecoesDeterministicas: idêntica às seções 1, 2, 4, 5 e 6 de montarRelatorio', () => {
  const rel = montar().relatorio;
  const det = montarSecoesDeterministicas({ summaries: [summary], risco: risco(), provas: clone(provas) });
  assert.deepEqual(det.bloqueios, []);
  for (const n of [1, 2, 4, 5, 6]) assert.deepEqual(det.secoes[n], rel.secoes[n - 1].blocos, `seção ${n}`);
  const ids = new Set(det.provas.map((p) => p.id));
  for (const n of [1, 2, 4, 5, 6]) for (const b of det.secoes[n]) for (const id of b.provas) assert.ok(ids.has(id));
});
