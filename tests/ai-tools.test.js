// Ferramentas do Argos AI no servidor (lib/ai/tools.js), sobre o motor de verdade e a série do snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleArgosAi } from '../lib/handlers/argos-ai.js';
import { createToolRunner, parseContext, TOOL_DEFS, TOOL_NAMES } from '../lib/ai/tools.js';
import { snapshotSeries } from '../lib/data/series.js';
import { DEFAULT_CFG } from '../lib/handlers/analyze.js';

const CTX = parseContext({ symbol: 'BTCUSDT', timeframe: '4h' }).value;
function runnerWith(context = CTX) {
  let loads = 0;
  const loadSeries = async (symbol, timeframe) => { loads++; return { d: snapshotSeries(symbol, timeframe), source: 'snapshot' }; };
  const runner = createToolRunner({ context, loadSeries });
  return { runner, loads: () => loads };
}
const parse = (out) => JSON.parse(out.content);

test('contexto: valida ativo, tempo gráfico, regra de saída e janela como o /api/analyze', () => {
  assert.deepEqual(parseContext({ symbol: 'btcusdt', timeframe: '4H' }).value, { symbol: 'BTCUSDT', timeframe: '4h', cfg: { ...DEFAULT_CFG }, windowDays: null });
  assert.deepEqual(parseContext({ symbol: 'ETHUSDT', timeframe: '1d', cfg: { mode: 'pct', tgt: 3, stp: 1.5, hold: 8 }, windowDays: 365 }).value.cfg, { mode: 'pct', tgt: 3, stp: 1.5, hold: 8 });
  for (const bad of [undefined, null, 'BTC', [], {}, { symbol: 'DOGEUSDT', timeframe: '4h' }, { symbol: 'BTCUSDT', timeframe: '5m' }, { symbol: 'BTCUSDT', timeframe: '4h', cfg: { hold: 0 } }, { symbol: 'BTCUSDT', timeframe: '4h', windowDays: 5 }]) {
    assert.ok(parseContext(bad).error, JSON.stringify(bad));
  }
});

test('catálogo: quatro ferramentas fixas, sem ativo nem série como argumento', () => {
  assert.deepEqual(TOOL_NAMES, ['obter_leitura_tecnica', 'consultar_banco_de_setups', 'detalhar_setup', 'verificar_vocabulario']);
  for (const t of TOOL_DEFS) {
    assert.equal(t.type, 'function');
    const props = Object.keys(t.function.parameters.properties);
    for (const p of props) assert.ok(['setup_id', 'texto'].includes(p), p);
  }
  assert.throws(() => Object.assign(TOOL_DEFS, { x: 1 }), TypeError); // congelado
});

test('ferramentas: leitura técnica, banco de setups e detalhe saem do motor, sobre o recorte pedido', async () => {
  const { runner, loads } = runnerWith();
  const leitura = parse(await runner.run('obter_leitura_tecnica', '{}'));
  assert.equal(leitura.ativo, 'BTC/USDT');
  assert.equal(leitura.tempo_grafico, '4h');
  assert.match(leitura.fonte, /snapshot real/);
  assert.ok(leitura.indicadores.rsi14 > 0 && leitura.indicadores.rsi14 < 100);
  assert.ok(leitura.regime.nome && leitura.regime.criterio);
  assert.match(leitura.regra_de_saida, /alvo 2×ATR · stop 1×ATR · 12 candles/);

  const banco = parse(await runner.run('consultar_banco_de_setups', ''));
  assert.equal(banco.length, 8);
  assert.ok(banco.every((s) => s.id && typeof s.p_ajustado_bh === 'number' && s.veredito));

  const detalhe = parse(await runner.run('detalhar_setup', JSON.stringify({ setup_id: ' rsi_oversold ' })));
  assert.equal(detalhe.id, 'RSI_OVERSOLD');
  assert.ok('walk_forward' in detalhe && 'por_regime' in detalhe);

  assert.equal(loads(), 1, 'a série é carregada e analisada uma vez por requisição');
});

test('ferramentas: id desconhecido e argumentos ruins viram erro para o modelo, não quebram', async () => {
  const { runner } = runnerWith();
  const unknown = parse(await runner.run('detalhar_setup', '{"setup_id":"NAO_EXISTE"}'));
  assert.match(unknown.erro, /setup_id desconhecido/);
  assert.match(parse(await runner.run('detalhar_setup', 'isto não é json')).erro, /fora de JSON/);
  assert.match(parse(await runner.run('detalhar_setup', '[1,2]')).erro, /setup_id desconhecido/);
});

test('ferramentas: nome fora do catálogo é recusado; ativo não é argumento', async () => {
  const { runner } = runnerWith();
  await assert.rejects(runner.run('executar_ordem', '{}'), /fora do catálogo/);
  const leitura = parse(await runner.run('obter_leitura_tecnica', JSON.stringify({ symbol: 'ETHUSDT', timeframe: '1h' })));
  assert.equal(leitura.ativo, 'BTC/USDT', 'o argumento extra é ignorado: o recorte é o do contexto');
});

test('ferramentas: verificar_vocabulario usa o verificador da casa', async () => {
  const { runner } = runnerWith();
  const flagged = parse(await runner.run('verificar_vocabulario', JSON.stringify({ texto: 'Compre agora, lucro garantido.' })));
  assert.equal(flagged.aprovado, false);
  assert.ok(flagged.regras_acionadas.length >= 1);
  const clean = parse(await runner.run('verificar_vocabulario', JSON.stringify({ texto: 'O motor não encontrou vantagem demonstrável.' })));
  assert.deepEqual(clean, { aprovado: true, regras_acionadas: [] });
  // o trecho sinalizado (com dígitos escolhidos pelo modelo) não volta, e o resultado não vale como fonte de número
  const echo = await runner.run('verificar_vocabulario', JSON.stringify({ texto: 'retorno de 912,7% ao mês, alvo 70.000' }));
  assert.equal(echo.content.includes('912'), false);
  assert.equal(echo.content.includes('70.000'), false);
  assert.equal(echo.evidence, false);
});

test('ferramentas: série indisponível é erro lançado, não resultado inventado', async () => {
  const runner = createToolRunner({ context: CTX, loadSeries: async () => { throw new Error('sem candles'); } });
  await assert.rejects(runner.run('obter_leitura_tecnica', '{}'), /sem candles/);
});

test('ponta a ponta com o motor real: número do motor passa; número inventado é barrado', async () => {
  const { runner } = runnerWith();
  const banco = parse(await runner.run('consultar_banco_de_setups', '{}'));
  const s = banco[0];
  const nf = (x, d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
  const honest = 'O setup ' + s.id + ' teve ' + nf(s.n_com_desfecho, 0) + ' gatilhos com desfecho e taxa de acerto de ' + nf(s.taxa_acerto_pct, 1) + '%.';
  const invented = honest.replace(nf(s.taxa_acerto_pct, 1), nf(s.taxa_acerto_pct + 7.3, 1));
  const call = (id, name) => ({ id, type: 'function', function: { name, arguments: '{}' } });
  const provider = (final) => {
    let n = 0;
    return { model: 'teste', chat: async () => (n++ === 0 ? { toolCalls: [call('c1', 'consultar_banco_de_setups')], content: '', finishReason: 'tool_calls' } : { toolCalls: [], content: final, finishReason: 'stop' }) };
  };
  const loadSeries = async (symbol, timeframe) => ({ d: snapshotSeries(symbol, timeframe), source: 'snapshot' });
  const ask = (final) => handleArgosAi({ body: { messages: [{ role: 'user', content: 'Redija.' }], context: { symbol: 'BTCUSDT', timeframe: '4h' } }, ip: '198.51.100.9', env: {}, deps: { provider: provider(final), loadSeries, rateStore: new Map() } });
  const ok = await ask(honest);
  assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 300));
  const bad = await ask(invented);
  assert.equal(bad.status, 502);
  assert.equal(bad.body.code, 'refused');
});
