import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENTES, SECOES, ESTADOS_TESE, ESTADOS_RELATORIO, DECISOES, UNIDADES,
  provaId, resolverCaminho, validarProva, validarRiscoSaida, validarDebateSaida, validarRelatorio, validarRevisaoSaida
} from '../lib/agents/contratos.js';

const H = 'a'.repeat(64);
const clone = (x) => JSON.parse(JSON.stringify(x));
const prova = (id = 'P1') => ({
  id, valor: 0.42, unidade: 'fracao', ic95: [0.3, 0.5], n: 120, nEff: 90.5, pBruto: 0.01, pAjustado: 0.04,
  origem: { resultHash: H, seriesHash: 'abc', engine: '1.2.0', caminho: 'setups[id=RSI_OVERSOLD].winRate' }
});
const veto = { regra: 'n_minimo', campo: 'n', valor: 10, limiar: 30, fonteLimiar: 'regras.json' };
const risco = () => ({
  agente: 'risco', versaoRegras: '1',
  teses: [{ serie: { symbol: 'BTCUSDT', timeframe: '1d' }, setupId: 'RSI_OVERSOLD', estado: 'veto_risco', vetos: [veto] }],
  avisos: [{ ...veto, serie: { symbol: 'BTCUSDT', timeframe: '1d' } }]
});
const debate = () => ({
  agente: 'debate', status: 'ok',
  itens: [{ setupId: 'RSI_OVERSOLD', pros: [{ texto: 'a', provas: ['P1'] }], contras: [{ texto: 'b', provas: [] }], preMortem: [{ metrica: 'winRate', provaLimiar: 'P1', texto: 'c' }] }],
  uso: { tokensIn: 100, tokensOut: 50 }
});
const relatorio = () => ({
  versao: '1', rodadaId: 'r1', geradoEm: '2026-11-19T10:00:00.000Z', estado: 'aguardando_aprovacao',
  secoes: SECOES.map((s) => ({ n: s.n, titulo: s.titulo, blocos: [{ texto: 'texto', provas: ['P1'] }] })),
  provas: [prova('P1')], disclaimer: 'aviso', motor: '1.2.0', relatorioHash: H
});
const revisao = () => ({ agente: 'revisao', aprovadoPorRegras: true, achados: [{ regra: 'r', secao: 2, detalhe: 'd' }], llm: { status: 'ok', achados: [] } });

function falha(fn, obj, mexer) {
  const o = clone(obj());
  mexer(o);
  const r = fn(o);
  assert.equal(r.ok, false);
  assert.ok(r.erros.length > 0);
}

test('constantes: listas fixas', () => {
  assert.deepEqual(AGENTES, ['risco', 'debate', 'montagem', 'revisao']);
  assert.equal(SECOES.length, 6);
  assert.deepEqual(DECISOES, ['aprovado', 'aprovado_com_ajustes', 'rejeitado']);
  assert.equal(ESTADOS_TESE.length, 4);
  assert.equal(ESTADOS_RELATORIO.length, 3);
  assert.equal(UNIDADES.length, 4);
});

test('provaId: P + n; lança para n inválido', () => {
  assert.equal(provaId(1), 'P1');
  assert.equal(provaId(12), 'P12');
  assert.throws(() => provaId(0));
  assert.throws(() => provaId(1.5));
  assert.throws(() => provaId('1'));
});

const summary = {
  calibration: { ece: 0.05 },
  regime: { current: { regime: 'TREND_UP' } },
  setups: [{ id: 'RSI_OVERSOLD', winRate: 0.4 }, { id: 'MACD', winRate: 0.5 }],
  lista: [10, 20, 30, 40]
};

test('resolverCaminho: nome, id e índice', () => {
  assert.equal(resolverCaminho(summary, 'calibration.ece'), 0.05);
  assert.equal(resolverCaminho(summary, 'regime.current.regime'), 'TREND_UP');
  assert.equal(resolverCaminho(summary, 'setups[id=RSI_OVERSOLD].winRate'), 0.4);
  assert.equal(resolverCaminho(summary, 'setups[id=MACD].winRate'), 0.5);
  assert.equal(resolverCaminho(summary, 'lista[3]'), 40);
  assert.equal(resolverCaminho(summary, 'setups[1].id'), 'MACD');
});

test('resolverCaminho: ausente devolve undefined; sintaxe inválida lança', () => {
  assert.equal(resolverCaminho(summary, 'calibration.nao'), undefined);
  assert.equal(resolverCaminho(summary, 'setups[id=XYZ].winRate'), undefined);
  assert.equal(resolverCaminho(summary, 'lista[9]'), undefined);
  assert.equal(resolverCaminho(summary, 'calibration[id=a]'), undefined);
  assert.equal(resolverCaminho(summary, 'x.y.z'), undefined);
  assert.throws(() => resolverCaminho(summary, 'setups[id=RSI'));
  assert.throws(() => resolverCaminho(summary, 'a..b'));
  assert.throws(() => resolverCaminho(summary, ''));
  assert.throws(() => resolverCaminho(summary, 'a[x]'));
});

test('validarProva', () => {
  assert.deepEqual(validarProva(prova()), { ok: true });
  assert.deepEqual(validarProva({ ...prova(), ic95: null, n: null, nEff: null, pBruto: null, pAjustado: null }), { ok: true });
  falha(validarProva, prova, (o) => { delete o.valor; });
  falha(validarProva, prova, (o) => { o.unidade = 'percentual'; });
  falha(validarProva, prova, (o) => { o.ic95 = [0.9, 0.1]; });
  falha(validarProva, prova, (o) => { o.id = 'X1'; });
  falha(validarProva, prova, (o) => { o.origem.resultHash = 'zz'; });
  assert.equal(validarProva(null).ok, false);
  assert.equal(validarProva({ ...prova(), valor: NaN }).ok, false);
});

test('validarRiscoSaida', () => {
  assert.deepEqual(validarRiscoSaida(risco()), { ok: true });
  falha(validarRiscoSaida, risco, (o) => { delete o.versaoRegras; });
  falha(validarRiscoSaida, risco, (o) => { o.teses[0].estado = 'outro'; });
  falha(validarRiscoSaida, risco, (o) => { o.agente = 'debate'; });
  falha(validarRiscoSaida, risco, (o) => { o.teses[0].vetos[0].fonteLimiar = 3; });
  falha(validarRiscoSaida, risco, (o) => { o.avisos = 'x'; });
});

test('validarDebateSaida', () => {
  assert.deepEqual(validarDebateSaida(debate()), { ok: true });
  falha(validarDebateSaida, debate, (o) => { o.status = 'talvez'; });
  falha(validarDebateSaida, debate, (o) => { delete o.uso; });
  falha(validarDebateSaida, debate, (o) => { o.itens[0].pros[0].provas = ['x']; });
  falha(validarDebateSaida, debate, (o) => { o.uso.tokensIn = 1.5; });
  falha(validarDebateSaida, debate, (o) => { delete o.itens[0].preMortem[0].provaLimiar; });
});

test('validarRelatorio', () => {
  assert.deepEqual(validarRelatorio(relatorio()), { ok: true });
  falha(validarRelatorio, relatorio, (o) => { o.estado = 'publicado'; });
  falha(validarRelatorio, relatorio, (o) => { o.secoes.pop(); });
  falha(validarRelatorio, relatorio, (o) => { o.secoes[0].blocos[0].provas = ['P9']; });
  falha(validarRelatorio, relatorio, (o) => { o.geradoEm = 'ontem'; });
  falha(validarRelatorio, relatorio, (o) => { o.relatorioHash = 'abc'; });
  falha(validarRelatorio, relatorio, (o) => { [o.secoes[0], o.secoes[1]] = [o.secoes[1], o.secoes[0]]; });
  falha(validarRelatorio, relatorio, (o) => { delete o.disclaimer; });
  falha(validarRelatorio, relatorio, (o) => { o.provas.push(prova('P1')); });
});

test('validarRevisaoSaida', () => {
  assert.deepEqual(validarRevisaoSaida(revisao()), { ok: true });
  assert.deepEqual(validarRevisaoSaida({ ...revisao(), llm: null }), { ok: true });
  falha(validarRevisaoSaida, revisao, (o) => { o.aprovadoPorRegras = 'sim'; });
  falha(validarRevisaoSaida, revisao, (o) => { delete o.achados; });
  falha(validarRevisaoSaida, revisao, (o) => { o.agente = 'risco'; });
  falha(validarRevisaoSaida, revisao, (o) => { o.achados[0].regra = ''; });
  falha(validarRevisaoSaida, revisao, (o) => { o.llm = { achados: [] }; });
});
