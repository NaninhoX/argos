// Endurecimento do V3 depois da segunda validação (19/11/2026): algarismo Unicode, variantes de traço no sinal,
// prova adulterada em campo que não é o valor, setup do v1.2 sem caixa e conselho brando por sinônimo.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../engine/index.js';
import { SETUPS_V12 } from '../engine/index.js';
import { snapshotSeries } from '../lib/data/series.js';
import { summarize } from '../lib/analysis-summary.js';
import { avaliarRisco } from '../lib/agents/risco.js';
import { montarRelatorio, extrairProvas, formatarProva, numerosDoTexto, temAlgarismo } from '../lib/agents/montagem.js';
import { rodarDebate } from '../lib/agents/debate.js';
import { revisarRelatorio } from '../lib/agents/revisao.js';
import { hashCanonical } from '../lib/canonical.js';
import { scanText } from '../lib/compliance.js';

const summary = summarize(
  engine.analyze(snapshotSeries('ETHUSDT', '4h'), { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, {}),
  { symbol: 'ETHUSDT', timeframe: '4h', source: 'snapshot' }
);
const clone = (x) => JSON.parse(JSON.stringify(x));
const risco = avaliarRisco([summary]);
const provas = extrairProvas([summary], ['setups[id=BREAKOUT_20].winRate', 'setups[id=BREAKOUT_20].base']);
const meta = { geradoEm: '2026-11-19T12:00:00.000Z', rodadaId: 'r-end', provas: clone(provas) };
const debate = (pm = 'winRate', proTexto = 'Amostra grande.') => ({
  agente: 'debate', status: 'ok',
  itens: [{
    setupId: 'BREAKOUT_20',
    pros: [{ texto: proTexto, provas: [provas[1].id] }],
    contras: [{ texto: 'A taxa de acerto está registrada.', provas: [provas[0].id] }],
    preMortem: [{ metrica: pm, provaLimiar: provas[1].id, texto: 'Se a taxa passar da taxa-base, a leitura muda.' }]
  }],
  uso: { tokensIn: 1, tokensOut: 1 }
});
const montar = (d) => montarRelatorio({ summaries: [summary], risco, debate: d, meta: clone(meta) });
const reassinar = (r) => { const { relatorioHash, ...resto } = r; r.relatorioHash = hashCanonical(resto); return r; };
const revisar = (r) => revisarRelatorio(r, { summaries: [summary], risco });

test('numerosDoTexto: NFKC, toda variante de traço e espaço depois do sinal', () => {
  assert.deepEqual(numerosDoTexto('queda por ７ semanas'), ['7']);
  assert.deepEqual(numerosDoTexto('expoente ⁷'), ['7']);
  for (const t of ['–20,7', '‐20,7', '－20,7', '−20,7', '- 20,7', '− 20,7']) assert.deepEqual(numerosDoTexto(`taxa de ${t}%`), ['-20,7'], t);
  assert.deepEqual(numerosDoTexto('BTC-4'), ['4']);
  assert.deepEqual(numerosDoTexto('+0,4'), ['0,4']);
});

test('temAlgarismo pega largura total, sobrescrito e outras escritas', () => {
  for (const t of ['７0', '⁷', '٣', 'Ⅶ', '70k', '1e3']) assert.equal(temAlgarismo(t), true, t);
  assert.equal(temAlgarismo('winRate'), false);
});

test('B1: algarismo Unicode na métrica do Pré-Mortem para no Debate, na Montagem e na Revisão', async () => {
  const resp = clone(debate('queda por ７ semanas'));
  const prov = { model: 'm', async chat() { return { content: JSON.stringify({ itens: resp.itens }), usage: {} }; } };
  const teses = risco.teses.filter((t) => t.setupId === 'BREAKOUT_20');
  const deb = await rodarDebate({ teses, provas: clone(provas), provider: prov });
  assert.equal(deb.status, 'falhou');
  const m = montar(debate('queda por ⁷ semanas'));
  assert.equal(m.ok, false);
  assert.ok(m.bloqueios.some((b) => /métrica do Pré-Mortem/.test(b.motivo)));
  const ok = montar(debate());
  assert.equal(ok.ok, true);
  const r = clone(ok.relatorio);
  const b = r.secoes[2].blocos.find((x) => x.texto.startsWith('Pré-Mortem'));
  b.texto = b.texto.replace('métrica winRate', 'métrica queda por ７ semanas');
  const out = await revisar(reassinar(r));
  assert.equal(out.aprovadoPorRegras, false);
  assert.ok(out.achados.some((a) => a.regra === 'numero_sem_prova' && a.secao === 3));
});

test('sinal com meia-risca ou espaço na seção 3 é número sem prova', async () => {
  const fmt = formatarProva(provas[1]);
  assert.equal(montar(debate('winRate', `Taxa-base de ${fmt}.`)).ok, true, 'controle: o número certo passa');
  for (const sinal of ['–', '- ', '－']) {
    assert.equal(montar(debate('winRate', `Taxa-base de ${sinal}${fmt}.`)).ok, false, `Montagem com "${sinal}"`);
  }
  const r = clone(montar(debate('winRate', `Taxa-base de ${fmt}.`)).relatorio);
  const b = r.secoes[2].blocos.find((x) => x.texto.includes(fmt));
  b.texto = b.texto.replace(fmt, `– ${fmt}`);
  const out = await revisar(reassinar(r));
  assert.equal(out.aprovadoPorRegras, false, 'Revisão');
});

test('prova adulterada fora do valor (n, nEff, pBruto, ic95) reprova, mesmo com hash refeito', async () => {
  const ok = montar(debate());
  for (const [campo, val] of [['n', 99999], ['nEff', 1], ['pBruto', 0.0001], ['ic95', [0.1, 0.9]]]) {
    const r = clone(ok.relatorio);
    const p = r.provas.find((x) => x.origem.caminho.endsWith('.winRate') && x[campo] !== undefined);
    assert.ok(p, campo);
    p[campo] = val;
    const out = await revisar(reassinar(r));
    assert.equal(out.aprovadoPorRegras, false, campo);
  }
});

test('setup do v1.2 no texto é pego sem caixa e com o id escrito com espaço', async () => {
  const ok = montar(debate());
  const s = SETUPS_V12[0];
  for (const t of [s.nome.toLowerCase(), s.id.toUpperCase(), s.id.replace(/_/g, ' ')]) {
    const r = clone(ok.relatorio);
    r.secoes[2].blocos[0].texto += ` Compare com ${t}.`;
    const out = await revisar(reassinar(r));
    assert.ok(out.achados.some((a) => a.regra === 'setup_v12'), t);
  }
});

test('conselho brando por sinônimo e com espaço não separável é acusado', () => {
  for (const f of ['É a hora certa de se posicionar.', 'Ótima hora para se posicionar.', 'Aproveite o movimento.',
    'Aproveite o momento.', 'Mantenha-se atento.', 'Momento oportuno.', 'Momento favorável.',
    'Janela de entrada aberta.', 'Ocasião propícia.', 'Convém estar posicionado.', 'Aproveite a janela.']) {
    assert.ok(scanText(f).some((x) => x.rule === 'conselho-brando'), f);
  }
  assert.deepEqual(scanText('O registro sai na hora do fechamento do candle.'), []);
});
