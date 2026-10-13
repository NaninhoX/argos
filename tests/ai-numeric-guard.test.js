import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNumbers, extractNumbers, collectToolNumbers, DEFAULT_EXCEPTIONS } from '../lib/ai/numeric-guard.js';

const raws = (r) => r.unknown.map((u) => u.raw);

test('guarda: lê números em pt-BR (milhar, decimal, unidades)', () => {
  const t = extractNumbers('Fechou em 67.234,51, com 20,7% e −5,8 p.p.; p = 0,025; N = 290; alvo 2×ATR; 1.234 candles; 0.148; 67,2 mil');
  assert.deepEqual(t.map((x) => [x.value, x.decimals, x.unit]), [
    [67234.51, 2, ''], [20.7, 1, '%'], [5.8, 1, 'pp'], [0.025, 3, ''], [290, 0, ''], [2, 0, 'x'], [1234, 0, ''], [0.148, 3, ''], [67200, 1, 'scale']
  ]);
});

test('guarda: aceita o arredondamento da precisão exibida e recusa o resto', () => {
  const tools = [{ winRate: 0.2069, brier: 0.148, n: 290 }];
  for (const ok of ['20,7%', '21%', '0,148', '0,15', '290', '0,2069', '0,21', '0.148', '20,69 %']) assert.equal(checkNumbers('valor ' + ok, tools).ok, true, ok);
  for (const bad of ['20,6%', '20%', '20,8%', '0,14', '0,149', '291', '289', '0,22', '2,07%']) assert.deepEqual(raws(checkNumbers('valor ' + bad, tools)), [bad], bad);
});

test('guarda: milhar, escala por extenso e sinal', () => {
  const tools = [{ fechamento: 67234.51, diferenca_pp: -5.8, variacao_pct: -3.21 }];
  for (const ok of ['67.234,51', '67.235', 'US$ 67.234,5', '67,2 mil', '67 mil', '−5,8 p.p.', '5,8 pontos percentuais', 'queda de 3,2%', '-3,21%']) assert.equal(checkNumbers(ok, tools).ok, true, ok);
  for (const bad of ['67.234,52', '68 mil', '67,3 mil', '5,9 p.p.', '6,7 mil']) assert.equal(checkNumbers(bad, tools).ok, false, bad);
});

test('guarda: percentual casa com fração ou com pontos; sem unidade, só com o próprio valor', () => {
  const tools = [{ taxa_acerto_pct: 54.3, confianca: 0.72 }];
  assert.equal(checkNumbers('taxa de 54,3% e confiança de 72%', tools).ok, true);
  assert.deepEqual(raws(checkNumbers('taxa de 0,543', tools)), ['0,543']);
  assert.deepEqual(raws(checkNumbers('confiança de 72', tools)), ['72']);
});

test('guarda: usa números dentro de strings e de nomes de chave dos resultados', () => {
  const tools = [JSON.stringify({ indicadores: { rsi14: 41.3, mm200: 61250.1 }, regime: { criterio: 'ADX 27,3 (> 25), preço +4,2% vs. MM200 e volatilidade no percentil 43 (< 60).' }, janela: { inicio: '12/03/2024' } })];
  assert.deepEqual(collectToolNumbers(tools).sort((a, b) => a - b), [3, 4.2, 12, 14, 25, 27.3, 41.3, 43, 60, 200, 2024, 61250.1]);
  assert.equal(checkNumbers('RSI de 14 períodos em 41,3; ADX 27,3, acima de 25; preço 4,2% acima da MM200 desde 12/03/2024.', tools).ok, true);
  assert.deepEqual(raws(checkNumbers('RSI de 21 períodos em 41,3 e sobrecompra acima de 70.', tools)), ['21', '70']);
});

test('guarda: resultado de ferramenta que não é JSON é lido como texto', () => {
  assert.equal(checkNumbers('taxa de 48,7%', ['taxa-base: 48,7%']).ok, true);
  assert.equal(checkNumbers('taxa de 48,8%', ['taxa-base: 48,7%']).ok, false);
});

test('guarda: sem resultado de ferramenta, qualquer número de medida é bloqueado', () => {
  assert.deepEqual(raws(checkNumbers('A taxa de acerto é de 61,5% com p = 0,031.', [])), ['61,5%', '0,031']);
  assert.deepEqual(raws(checkNumbers('Alta de 3% em 12 candles.', undefined)), ['3%', '12']);
  assert.deepEqual(checkNumbers('Texto sem número algum.', []), { ok: true, unknown: [] });
});

test('guarda: exceções estruturais padrão', () => {
  const texto = ['## 1. Contexto de Regime', '1. primeiro item', '12) décimo segundo item', 'Dos 8 setups, 2 dispararam (ver seção 3).', 'IC 95%, a faixa onde a taxa real provavelmente está; intervalo de confiança de 95%; 95% de confiança.', 'O p ajustado ficou acima de 0,05 (limiar de 0,05; p < 0,05 não foi atingido).'].join('\n');
  assert.deepEqual(checkNumbers(texto, []), { ok: true, unknown: [] });
});

test('guarda: as exceções não cobrem número de medida', () => {
  assert.deepEqual(raws(checkNumbers('Acerto de 95%.', [])), ['95%']);
  assert.deepEqual(raws(checkNumbers('O p ajustado é 0,05.', [])), ['0,05']);
  assert.deepEqual(raws(checkNumbers('Foram 12 setups.', [])), ['12']);
  assert.deepEqual(raws(checkNumbers('Subiu 3% e 2 p.p., com alvo 2×ATR e US$ 5.', [])), ['3%', '2 p.p.', '2×', '5']);
  assert.deepEqual(raws(checkNumbers('O índice foi 3,0.', [])), ['3,0']);
  assert.deepEqual(raws(checkNumbers('Ficou em 61,5%.\n2. item', [])), ['61,5%']);
});

test('guarda: exceções são configuráveis', () => {
  assert.equal(DEFAULT_EXCEPTIONS.smallIntMax, 10);
  assert.deepEqual(raws(checkNumbers('Dos 8 setups.', [], { smallIntMax: -1 })), ['8']);
  assert.deepEqual(raws(checkNumbers('IC 95%.', [], { patterns: [] })), ['95%']);
  assert.equal(checkNumbers('RSI acima de 70.', [], { patterns: [/acima de 70/] }).ok, true);
  assert.equal(checkNumbers('Foram 12 setups.', [], { smallIntMax: 12 }).ok, true);
});

test('guarda: "confiança de 95%" solto não é exceção (o motor também emite confiança de regime)', () => {
  const tools = [{ regime: { confianca_pct: 62 }, intervalo_pct: [16.4, 25.7] }];
  assert.deepEqual(raws(checkNumbers('O regime tem confiança de 95%.', tools)), ['95%']);
  // limite conhecido: se a ferramenta traz a chave "ic95_pct", o 95 entra na fonte pelo nome da chave
  assert.equal(checkNumbers('O regime tem confiança de 95%.', [{ regime: { confianca_pct: 62 }, ic95_pct: [16.4, 25.7] }]).ok, true);
  assert.equal(checkNumbers('Intervalo de confiança de 95%: 16,4% a 25,7%. IC 95%. Nível de confiança de 95%.', tools).ok, true);
  assert.equal(checkNumbers('O regime tem confiança de 62%.', tools).ok, true);
});

test('guarda: notação científica, "por cento", dígitos de largura total e de outro alfabeto', () => {
  const tools = [{ p: 0.0009, taxa_pct: 61.5, n: 290 }];
  assert.equal(checkNumbers('p de 9e-4 e taxa de 61,5 por cento em 290 casos', tools).ok, true);
  assert.deepEqual(raws(checkNumbers('p de 7e-4', tools)), ['7e-4']);
  assert.deepEqual(raws(checkNumbers('taxa de 72 por cento', tools)), ['72 por cento']);
  assert.deepEqual(raws(checkNumbers('taxa de ７２%', tools)), ['72%']);          // largura total: normalizado e conferido
  assert.equal(checkNumbers('taxa de ６１,５%', tools).ok, true);
  assert.deepEqual(raws(checkNumbers('taxa de ٧٢%', tools)), ['٧٢']);            // árabe-índico: bloqueado direto
  assert.deepEqual(raws(checkNumbers('taxa de sessenta e um por cento', tools)), ['um por cento']);
});

test('guarda: hash em resultado de ferramenta não vira fonte de número', () => {
  const tools = [{ hash: '3e5a29c4f1b07d6e8a9c2f4b6d8e0a1c3e5a29c4f1b07d6e8a9c2f4b6d8e0a1c', n: 41 }];
  assert.deepEqual(raws(checkNumbers('taxa de 29% em 41 gatilhos', tools)), ['29%']);
});
