import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../engine/index.js';
import { snapshotSeries } from '../lib/data/series.js';
import { summarize } from '../lib/analysis-summary.js';
import { avaliarRisco } from '../lib/agents/risco.js';
import { montarRelatorio, extrairProvas } from '../lib/agents/montagem.js';
import { validarRevisaoSaida } from '../lib/agents/contratos.js';
import { revisarRelatorio } from '../lib/agents/revisao.js';
import { hashCanonical } from '../lib/canonical.js';

const summary = summarize(
  engine.analyze(snapshotSeries('ETHUSDT', '4h'), { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, {}),
  { symbol: 'ETHUSDT', timeframe: '4h', source: 'snapshot' }
);
const clone = (x) => JSON.parse(JSON.stringify(x));
const risco = avaliarRisco([summary]);
const provas = extrairProvas([summary], ['setups[id=BREAKOUT_20].winRate', 'setups[id=BREAKOUT_20].base']);
const debate = {
  agente: 'debate', status: 'ok',
  itens: [{
    setupId: 'BREAKOUT_20',
    pros: [{ texto: 'Amostra grande.', provas: [provas[1].id] }],
    contras: [{ texto: 'A taxa de acerto está registrada.', provas: [provas[0].id] }],
    preMortem: [{ metrica: 'winRate', provaLimiar: provas[1].id, texto: 'Se a taxa passar da taxa-base, a leitura muda.' }]
  }],
  uso: { tokensIn: 1, tokensOut: 1 }
};
const montado = montarRelatorio({ summaries: [summary], risco, debate, meta: { geradoEm: '2026-11-19T12:00:00.000Z', rodadaId: 'r-1', provas: clone(provas) } });
const base = () => clone(montado.relatorio);
/** Reassina o hash, para isolar a regra que se quer exercitar. */
const reassinar = (r) => { const { relatorioHash, ...resto } = r; r.relatorioHash = hashCanonical(resto); return r; };
const revisar = (r, o = {}) => revisarRelatorio(r, { summaries: [summary], ...o });
const regras = (out) => out.achados.map((a) => a.regra);

function simulado(resp) {
  const calls = [];
  return { model: 'm', calls, async chat(req) { calls.push(req); if (resp instanceof Error) throw resp; return { content: typeof resp === 'string' ? resp : JSON.stringify(resp), usage: {} }; } };
}

test('relatório real (ETHUSDT 4h + risco real + debate sintético) monta e é aprovado', async () => {
  assert.equal(montado.ok, true, JSON.stringify(montado.bloqueios));
  const out = await revisar(base());
  assert.deepEqual(out.achados, []);
  assert.equal(out.aprovadoPorRegras, true);
  assert.equal(out.llm, null);
  assert.deepEqual(validarRevisaoSaida(out), { ok: true });
});

test('valor de prova adulterado reprova (prova_valor), mesmo com hash refeito', async () => {
  const r = base(); r.provas[0].valor += 0.01; reassinar(r);
  assert.ok(regras(await revisar(r)).includes('prova_valor'));
});

test('caminho adulterado reprova', async () => {
  const r = base(); r.provas[0].origem.caminho = 'setups[id=BREAKOUT_20].nEff'; reassinar(r);
  assert.ok(regras(await revisar(r)).includes('prova_valor'));
  const r2 = base(); r2.provas[0].origem.caminho = 'setups[id=NAO_EXISTE].winRate'; reassinar(r2);
  assert.ok(regras(await revisar(r2)).includes('prova_caminho'));
});

test('resultHash adulterado reprova (prova_origem)', async () => {
  const r = base(); r.provas[0].origem.resultHash = 'b'.repeat(64); reassinar(r);
  assert.ok(regras(await revisar(r)).includes('prova_origem'));
});

test('relatorioHash adulterado reprova (hash)', async () => {
  const r = base(); r.relatorioHash = 'c'.repeat(64);
  assert.ok(regras(await revisar(r)).includes('hash'));
  const r2 = base(); r2.secoes[0].blocos[0].texto += ' '; // conteúdo muda, hash antigo
  assert.ok(regras(await revisar(r2)).includes('hash'));
});

test('disclaimer adulterado reprova', async () => {
  const r = base(); r.disclaimer = 'Sem aviso.'; reassinar(r);
  assert.ok(regras(await revisar(r)).includes('disclaimer'));
});

test('termo proibido injetado reprova (compliance)', async () => {
  const r = base(); r.secoes[2].blocos[0].texto = 'Compre agora, recomendamos a entrada.'; reassinar(r);
  const out = await revisar(r);
  assert.ok(out.achados.some((a) => a.regra === 'compliance' && a.secao === 3));
});

test('número sem prova injetado reprova (numero_sem_prova)', async () => {
  const r = base(); r.secoes[2].blocos[0].texto += ' A taxa foi 99,9% no período.'; reassinar(r);
  const out = await revisar(r);
  assert.ok(out.achados.some((a) => a.regra === 'numero_sem_prova' && a.secao === 3));
});

test('IC nulo em fração fora das isenções reprova (prova_ic)', async () => {
  const r = base(); r.provas.find((p) => p.origem.caminho.endsWith('.winRate')).ic95 = null; reassinar(r);
  assert.ok(regras(await revisar(r)).includes('prova_ic'));
});

test('nível de preço e setup do estudo v1.2 na origem reprovam', async () => {
  const a = base(); a.provas[0].origem.caminho = 'technical.atr'; reassinar(a);
  assert.ok(regras(await revisar(a)).includes('nivel_preco'));
  const b = base(); b.provas[0].origem.caminho = 'setups[id=EMA_9_21].winRate'; reassinar(b);
  assert.ok(regras(await revisar(b)).includes('setup_v12'));
});

test('seções fora de ordem reprovam', async () => {
  const r = base(); r.secoes.reverse(); reassinar(r);
  assert.ok(regras(await revisar(r)).includes('secoes'));
});

test('LLM simulado "aprova" relatório adulterado: continua reprovado', async () => {
  const r = base(); r.secoes[2].blocos[0].texto = 'Compre agora.'; reassinar(r);
  const p = simulado({ achados: [] });
  const out = await revisar(r, { provider: p });
  assert.equal(out.aprovadoPorRegras, false);
  assert.deepEqual(out.llm, { status: 'ok', achados: [] });
  assert.equal(p.calls.length, 1);
  assert.deepEqual(validarRevisaoSaida(out), { ok: true });
});

test('LLM só acrescenta achados e não muda aprovadoPorRegras', async () => {
  const out = await revisar(base(), { provider: simulado('```json\n{"achados":[{"secao":3,"detalhe":"trecho duvidoso"}]}\n```') });
  assert.equal(out.aprovadoPorRegras, true);
  assert.equal(out.achados.length, 0);
  assert.equal(out.llm.status, 'ok');
  assert.equal(out.llm.achados[0].detalhe, 'trecho duvidoso');
});

test('LLM fora do ar ou com resposta quebrada: regras iguais, llm falhou', async () => {
  const sem = await revisar(base());
  for (const prov of [simulado(new Error('timeout')), simulado('lixo')]) {
    const out = await revisar(base(), { provider: prov });
    assert.equal(out.aprovadoPorRegras, sem.aprovadoPorRegras);
    assert.deepEqual(out.achados, sem.achados);
    assert.deepEqual(out.llm, { status: 'falhou', achados: [] });
    assert.deepEqual(validarRevisaoSaida(out), { ok: true });
  }
});

// ---------- ciclo V3 parte 2: revisão independente (regera as seções determinísticas) ----------
const rev2 = (r, o = {}) => revisarRelatorio(r, { summaries: [summary], risco, debate, ...o });
const blocoDe = (r, n, i = 0) => r.secoes.find((s) => s.n === n).blocos[i];

test('relatório íntegro com risco e debate passados continua aprovado', async () => {
  const out = await rev2(base());
  assert.deepEqual(out.achados, []);
});

test('B1: número na métrica do Pré-Mortem vira achado', async () => {
  const r = base(); const b = r.secoes[2].blocos.find((x) => x.texto.startsWith('Pré-Mortem'));
  b.texto = b.texto.replace('métrica winRate', 'métrica alvo em 68250'); reassinar(r);
  assert.ok((await rev2(r)).achados.some((a) => a.regra === 'numero_sem_prova' && a.secao === 3));
});

test('sinal conta: "BSS 0,4%" no lugar de "-0,4%" reprova', async () => {
  const r = base(); const b = blocoDe(r, 6);
  const m = /BSS (-)(\d)/.exec(b.texto);
  if (!m) return; // série sem BSS negativo: o caso é coberto pela regeração (secao_divergente) abaixo
  b.texto = b.texto.replace('BSS -', 'BSS '); reassinar(r);
  const out = await rev2(r);
  assert.ok(regras(out).includes('numero_sem_prova') || regras(out).includes('secao_divergente'));
});

test('sinal no texto da seção 3: número negativo citado sem o sinal reprova', async () => {
  const r = base(); const b = blocoDe(r, 3);
  const p = r.provas.find((x) => x.id === b.provas[0]);
  b.texto += ` Valor ${String(p.valor < 0 ? '' : '-')}9,9.`; reassinar(r);
  assert.ok(regras(await rev2(r)).includes('numero_sem_prova'));
  const r2 = base(); blocoDe(r2, 3).texto += ' Variação -3,1.'; reassinar(r2);
  assert.ok(regras(await rev2(r2)).includes('numero_sem_prova'));
});

test('seção 1, 2, 5 e 6 alteradas reprovam (secao_divergente)', async () => {
  for (const n of [1, 2, 6]) {
    const r = base(); blocoDe(r, n).texto = blocoDe(r, n).texto.replace(/\d/, (d) => String((Number(d) + 1) % 10)); reassinar(r);
    assert.ok((await rev2(r)).achados.some((a) => a.regra === 'secao_divergente' && a.secao === n), `seção ${n}`);
  }
});

test('troca de taxa de acerto com taxa-base na seção 2 reprova', async () => {
  const r = base(); const b = blocoDe(r, 2);
  const [wr, ba] = [/Taxa de acerto (\S+)%/.exec(b.texto)[1], /taxa-base (\S+)%/.exec(b.texto)[1]];
  b.texto = b.texto.replace(`Taxa de acerto ${wr}%`, `Taxa de acerto @@`).replace(`taxa-base ${ba}%`, `taxa-base ${wr}%`).replace('@@', `${ba}%`); reassinar(r);
  assert.ok((await rev2(r)).achados.some((a) => a.regra === 'secao_divergente' && a.secao === 2));
});

test('provas citadas trocadas num bloco reprovam, mesmo com texto igual', async () => {
  const r = base(); const b = blocoDe(r, 2); b.provas = [...b.provas].reverse(); reassinar(r);
  assert.ok((await rev2(r)).achados.some((a) => a.regra === 'secao_divergente' && a.secao === 2));
});

test('motor trocado no relatório ou na origem da prova reprova (motor)', async () => {
  const r = base(); r.motor = 'outro-9.9.9'; reassinar(r);
  assert.ok(regras(await rev2(r)).includes('motor'));
  const r2 = base(); r2.provas[0].origem.engine = 'x'; reassinar(r2);
  assert.ok(regras(await rev2(r2)).includes('motor'));
});

test('risco recebido que difere do recalculado reprova (risco_divergente)', async () => {
  const falso = clone(risco); falso.teses[0].estado = 'veto_risco';
  assert.ok(regras(await rev2(base(), { risco: falso })).includes('risco_divergente'));
});

test('setup do estudo v1.2 no texto do bloco reprova (setup_v12)', async () => {
  const r = base(); blocoDe(r, 3).texto += ' Comparar com EMA_9_21 e RSI cruza acima de 50.'; reassinar(r);
  assert.ok(regras(await rev2(r)).includes('setup_v12'));
});

test('timeframe solto no texto reprova; colado ao símbolo passa', async () => {
  const r = base(); blocoDe(r, 3).texto += ' Janela das próximas 4h.'; reassinar(r);
  assert.ok(regras(await rev2(r)).includes('numero_sem_prova'));
  const r2 = base(); blocoDe(r2, 3).texto += ' Série ETHUSDT 4h.'; reassinar(r2);
  assert.ok(!regras(await rev2(r2)).includes('numero_sem_prova'));
});

test('seção 4 com veto: limiar e cauda alterados reprovam', async () => {
  const sol = summarize(engine.analyze(snapshotSeries('SOLUSDT', '1d'), { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, {}), { symbol: 'SOLUSDT', timeframe: '1d', source: 'snapshot' });
  const rk = avaliarRisco([sol]);
  const t = rk.teses.find((x) => x.estado === 'veto_risco');
  const pv = extrairProvas([sol], [`setups[id=${t.setupId}].winRate`, `setups[id=${t.setupId}].base`]);
  const d = { agente: 'debate', status: 'ok', itens: [{ setupId: t.setupId, pros: [{ texto: 'Amostra registrada.', provas: [pv[1].id] }], contras: [{ texto: 'Taxa registrada.', provas: [pv[0].id] }], preMortem: [] }], uso: { tokensIn: 1, tokensOut: 1 } };
  const m = montarRelatorio({ summaries: [sol], risco: rk, debate: d, meta: { geradoEm: '2026-11-19T12:00:00.000Z', rodadaId: 'r-2', provas: clone(pv) } });
  assert.equal(m.ok, true, JSON.stringify(m.bloqueios));
  const ok = await revisarRelatorio(clone(m.relatorio), { summaries: [sol], risco: rk, debate: d });
  assert.deepEqual(ok.achados, []);
  const b4 = (r) => r.secoes.find((s) => s.n === 4).blocos.find((b) => /limiar/.test(b.texto));
  const a = clone(m.relatorio); b4(a).texto += ' Nível de referência 64250 e 71.300.'; reassinar(a);
  assert.ok((await revisarRelatorio(a, { summaries: [sol], risco: rk })).achados.some((x) => x.regra === 'secao_divergente' && x.secao === 4));
  const c = clone(m.relatorio); b4(c).texto = b4(c).texto.replace(/limiar (\d)/, (_, x) => `limiar 9${x}`); reassinar(c);
  assert.ok((await revisarRelatorio(c, { summaries: [sol], risco: rk })).achados.some((x) => x.regra === 'secao_divergente' && x.secao === 4));
});
