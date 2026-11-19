import test from 'node:test';
import assert from 'node:assert/strict';
import { rodarDebate, explicarVeto } from '../lib/agents/debate.js';
import { validarDebateSaida } from '../lib/agents/contratos.js';
import { ProviderError } from '../lib/ai/provider.js';

const HASH = 'a'.repeat(64);
const prova = (id, extra = {}) => ({ id, valor: 0.207, unidade: 'fracao', ic95: [0.164, 0.257], n: 290, nEff: 210, pBruto: 0.025, pAjustado: 0.1, origem: { resultHash: HASH, seriesHash: 'h', engine: '1.2.0', caminho: 'setups[id=RSI_OVERSOLD].winRate' }, ...extra });
const PROVAS = [prova('P1'), prova('P2', { valor: 0.265, ic95: null, nEff: null, pBruto: null, pAjustado: null })];
const SERIE = { symbol: 'BTCUSDT', timeframe: '4h' };
const TESES = [
  { serie: SERIE, setupId: 'RSI_OVERSOLD', estado: 'em_avaliacao', vetos: [] },
  { serie: SERIE, setupId: 'EMA_X', estado: 'sem_edge', vetos: [] }
];
const BOM = { itens: [{ setupId: 'RSI_OVERSOLD', pros: [{ texto: 'A taxa de acerto foi 20,7% em 290 casos.', provas: ['P1'] }], contras: [{ texto: 'A taxa-base foi 26,5%.', provas: ['P2'] }], preMortem: [{ metrica: 'taxa-base', provaLimiar: 'P2', texto: 'Se a taxa de acerto ficar abaixo de 26,5%, a tese perde sustentação.' }] }] };

function simulado(...respostas) {
  const calls = [];
  return {
    model: 'm',
    calls,
    async chat(req) {
      calls.push(req);
      const r = respostas[Math.min(calls.length - 1, respostas.length - 1)];
      if (r instanceof Error) throw r;
      return { content: typeof r === 'string' ? r : JSON.stringify(r), usage: { prompt_tokens: 100, completion_tokens: 50 } };
    }
  };
}
const run = (provider, limites) => rodarDebate({ teses: TESES, provas: PROVAS, provider, limites });
const comTexto = (texto) => { const b = structuredClone(BOM); b.itens[0].pros[0].texto = texto; return b; };

test('debate: caminho feliz passa no contrato e soma o uso; só debate teses elegíveis', async () => {
  const p = simulado(BOM);
  const out = await run(p);
  assert.equal(out.status, 'ok');
  assert.deepEqual(validarDebateSaida(out), { ok: true });
  assert.deepEqual(out.uso, { tokensIn: 100, tokensOut: 50 });
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].maxTokens, 1500);
  assert.ok(!p.calls[0].messages[1].content.includes('EMA_X'));
});

test('debate: sem tese elegível não chama o provedor', async () => {
  const p = simulado(BOM);
  const out = await rodarDebate({ teses: [TESES[1]], provas: PROVAS, provider: p });
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.itens, []);
  assert.equal(p.calls.length, 0);
});

test('debate: número inventado -> reparo -> falhou, sem devolver o texto', async () => {
  const ruim = comTexto('A taxa de acerto foi 31,4%.');
  const p = simulado(ruim, ruim);
  const out = await run(p);
  assert.equal(out.status, 'falhou');
  assert.deepEqual(out.itens, []);
  assert.equal(p.calls.length, 2);
  assert.match(p.calls[1].messages.at(-1).content, /31,4/);
});

test('debate: número inventado e corrigido no reparo -> ok', async () => {
  const out = await run(simulado(comTexto('A taxa de acerto foi 31,4%.'), BOM));
  assert.equal(out.status, 'ok');
});

test('debate: termo proibido -> falhou', async () => {
  const ruim = comTexto('Compre agora, a taxa foi 20,7%.');
  const out = await run(simulado(ruim, ruim));
  assert.equal(out.status, 'falhou');
  assert.deepEqual(out.itens, []);
});

test('debate: id de prova inexistente -> falhou; provaLimiar inexistente também', async () => {
  const a = structuredClone(BOM);
  a.itens[0].pros[0].provas = ['P9'];
  assert.equal((await run(simulado(a, a))).status, 'falhou');
  const b = structuredClone(BOM);
  b.itens[0].preMortem[0].provaLimiar = 'P7';
  assert.equal((await run(simulado(b, b))).status, 'falhou');
});

test('debate: JSON quebrado uma vez -> reparo ok; duas -> falhou', async () => {
  const p = simulado('{itens: [', BOM);
  assert.equal((await run(p)).status, 'ok');
  assert.equal(p.calls.length, 2);
  assert.equal((await run(simulado('lixo', 'lixo'))).status, 'falhou');
});

test('debate: JSON em cerca de código é aceito', async () => {
  assert.equal((await run(simulado('```json\n' + JSON.stringify(BOM) + '\n```'))).status, 'ok');
});

test('debate: saldo insuficiente -> falhou sem retentar', async () => {
  const p = simulado(new ProviderError('insufficient_balance'));
  const out = await run(p);
  assert.equal(out.status, 'falhou');
  assert.equal(p.calls.length, 1);
});

test('debate: transitório 2x -> ok na 3a; 3x -> falhou', async () => {
  const t = () => new ProviderError('timeout');
  const p = simulado(t(), t(), BOM);
  assert.equal((await run(p)).status, 'ok');
  assert.equal(p.calls.length, 3);
  const q = simulado(t(), t(), t(), BOM);
  assert.equal((await run(q, { maxChamadas: 10 })).status, 'falhou');
  assert.equal(q.calls.length, 3);
});

test('debate: teto de chamadas -> falhou', async () => {
  const p = simulado(new ProviderError('upstream_error'), BOM);
  const out = await run(p, { maxChamadas: 1 });
  assert.equal(out.status, 'falhou');
  assert.equal(p.calls.length, 1);
});

test('explicarVeto: texto do provedor aprovado passa', async () => {
  const veto = { regra: 'n_minimo', campo: 'n', valor: 12, limiar: 30 };
  const t = await explicarVeto({ veto, provider: simulado('A amostra tem 12 casos e o mínimo é 30.') });
  assert.equal(t, 'A amostra tem 12 casos e o mínimo é 30.');
});

test('explicarVeto: cai no texto fixo se o provedor falha, inventa número ou usa termo proibido', async () => {
  const veto = { regra: 'n_minimo', campo: 'n', valor: 12, limiar: 30 };
  const fixo = await explicarVeto({ veto, provider: simulado(new ProviderError('insufficient_balance')) });
  assert.match(fixo, /n_minimo/);
  assert.match(fixo, /12/);
  assert.match(fixo, /30/);
  assert.equal(await explicarVeto({ veto, provider: simulado('A amostra tem 99 casos.') }), fixo);
  assert.equal(await explicarVeto({ veto, provider: simulado('Compre agora, são 12 casos.') }), fixo);
});

test('debate: dígito no campo metrica do Pré-Mortem é recusado, vai ao reparo e reprova de novo -> falhou', async () => {
  const ruim = structuredClone(BOM); ruim.itens[0].preMortem[0].metrica = 'alvo 68250';
  const p = simulado(ruim, ruim);
  const out = await run(p);
  assert.equal(out.status, 'falhou');
  assert.deepEqual(out.itens, []);
  assert.equal(p.calls.length, 2);
  assert.match(p.calls[1].messages.at(-1).content, /métrica sem dígito/);
  // um número que existe nas provas também é recusado na métrica (o número vem de provaLimiar)
  const pool = structuredClone(BOM); pool.itens[0].preMortem[0].metrica = 'taxa 26,5';
  assert.equal((await run(simulado(pool, pool))).status, 'falhou');
});
