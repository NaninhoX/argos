// Leitor de Pine Script (lib/pine-reader.js): aceita só o que o motor testa e recusa o resto com motivo.
// Princípio verificado aqui: nenhum script é lido "mais ou menos". Ou o spec é exatamente a regra do script, ou há recusa.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../engine/index.js';
import { snapshotSeries } from '../lib/data/series.js';
import { readPine, describeSpec, MAX_SCRIPT_CHARS, SUPPORTED_PATTERNS, PINE_EXAMPLES } from '../lib/pine-reader.js';

const RSI = (extra = '') => `//@version=5\nindicator("x")\nr = ta.rsi(close, 14)\n${extra}`;
const accepted = (code) => { const r = readPine(code); assert.equal(r.ok, true, r.ok ? '' : `recusou: ${r.reason} ${JSON.stringify(r.unsupported)}`); return r; };
const refused = (code) => {
  const r = readPine(code);
  assert.equal(r.ok, false, r.ok ? `aceitou: ${JSON.stringify(r.spec)}` : '');
  assert.equal(typeof r.reason, 'string');
  assert.ok(r.reason.length > 10);
  assert.ok(Array.isArray(r.unsupported));
  assert.deepEqual(r.supported, SUPPORTED_PATTERNS);
  return r;
};
const specOf = (code) => accepted(code).spec;

// ------------------------------------------------------------------ aceitos: spec exato

test('RSI v5: ta.crossover em alertcondition, com variável intermediária', () => {
  assert.deepEqual(specOf(RSI('sinal = ta.crossover(r, 30)\nalertcondition(sinal, title="RSI cruza 30")')), { type: 'rsi_cross_up', len: 14, level: 30 });
});

test('RSI v4: rsi() e crossover() sem prefixo ta., study()', () => {
  assert.deepEqual(specOf('//@version=4\nstudy("x")\nr = rsi(close, 14)\nalertcondition(crossover(r, 30))'), { type: 'rsi_cross_up', len: 14, level: 30 });
});

test('RSI: período e nível vindos de input.int, input.float e input() lidos pelo valor padrão', () => {
  const v5 = '//@version=5\nindicator("x")\nlen = input.int(21, "Período", minval=2, group="RSI")\nlvl = input.float(35.5, title="Nível")\nalertcondition(ta.crossover(ta.rsi(close, len), lvl))';
  assert.deepEqual(specOf(v5), { type: 'rsi_cross_up', len: 21, level: 35.5 });
  const v4 = '//@version=4\nstudy("x")\nlen = input(14, minval=1, title="Len")\nlvl = input(title="Nível", type=input.float, defval=25)\nsrc = input(close, "Fonte")\nalertcondition(crossover(rsi(src, len), lvl))';
  assert.deepEqual(specOf(v4), { type: 'rsi_cross_up', len: 14, level: 25 });
});

test('RSI: argumentos nomeados (length=, series=)', () => {
  assert.deepEqual(specOf('//@version=5\nindicator("x")\nalertcondition(ta.crossover(ta.rsi(series=close, length=9), 40))'), { type: 'rsi_cross_up', len: 9, level: 40 });
});

test('RSI: cruzamento escrito à mão, nas duas grafias de igualdade, vira rsi_cross_up', () => {
  const want = { type: 'rsi_cross_up', len: 14, level: 30 };
  assert.deepEqual(specOf(RSI('alertcondition(r[1] < 30 and r >= 30)')), want);
  assert.deepEqual(specOf(RSI('alertcondition(r > 30 and r[1] <= 30)')), want);
  assert.deepEqual(specOf(RSI('alertcondition(30 >= r[1] and 30 < r)')), want);
});

test('RSI: ta.crossunder do nível é rsi_below, e o nível pode vir antes do RSI', () => {
  assert.deepEqual(specOf(RSI('alertcondition(ta.crossunder(r, 70))')), { type: 'rsi_below', len: 14, level: 70 });
  assert.deepEqual(specOf(RSI('alertcondition(ta.crossover(70, r))')), { type: 'rsi_below', len: 14, level: 70 });
});

test('RSI abaixo do nível como estado: aceito, e a leitura avisa que só o primeiro candle da sequência conta', () => {
  const r = accepted(RSI('plotshape(r < 30, style=shape.triangleup, location=location.belowbar)'));
  assert.deepEqual(r.spec, { type: 'rsi_below', len: 14, level: 30 });
  assert.ok(r.understood.some((s) => /só o primeiro de cada sequência/.test(s)));
});

test('médias: cruzamento de EMA em strategy.entry dentro de if', () => {
  const code = '//@version=5\nstrategy("x", overlay=true)\nf = ta.ema(close, 9)\ns = ta.ema(close, 21)\nif ta.crossover(f, s)\n    strategy.entry("L", strategy.long)';
  const r = accepted(code);
  assert.deepEqual(r.spec, { type: 'ma_cross_up', kind: 'ema', fast: 9, slow: 21 });
  assert.ok(r.understood.some((s) => /strategy\.entry/.test(s)));
});

test('médias: SMA 50/200 em alertcondition, v4 sem prefixo', () => {
  assert.deepEqual(specOf('//@version=4\nstudy("x")\nalertcondition(crossover(sma(close, 50), sma(close, 200)))'), { type: 'ma_cross_up', kind: 'sma', fast: 50, slow: 200 });
});

test('strategy.entry com when= (v4) e sem if', () => {
  const code = '//@version=4\nstrategy("x")\nf = ema(close, 12)\ns = ema(close, 26)\nstrategy.entry("L", strategy.long, when = crossover(f, s))';
  assert.deepEqual(specOf(code), { type: 'ma_cross_up', kind: 'ema', fast: 12, slow: 26 });
});

test('fechamento cruzando média: SMA 200 (v6, período em input) e EMA 20 (v4)', () => {
  assert.deepEqual(specOf('//@version=6\nstrategy("x")\nn = input.int(200)\nif ta.crossover(close, ta.sma(close, n))\n    strategy.entry("L", strategy.long)'), { type: 'price_cross_ma_up', kind: 'sma', len: 200 });
  assert.deepEqual(specOf('//@version=4\nstudy("x")\nalertcondition(crossover(close, ema(close, 20)))'), { type: 'price_cross_ma_up', kind: 'ema', len: 20 });
});

test('MACD: lista [linha, sinal, hist] em v5, com _ descartando valores', () => {
  const code = '//@version=5\nindicator("x")\n[m, s, _] = ta.macd(close, 12, 26, 9)\nalertcondition(ta.crossover(m, s))';
  assert.deepEqual(specOf(code), { type: 'macd_cross_up', fast: 12, slow: 26, signal: 9 });
});

test('MACD: v4 e parâmetros diferentes dos clássicos', () => {
  assert.deepEqual(specOf('//@version=4\nstudy("x")\n[a, b, h] = macd(close, 8, 17, 9)\nalertcondition(crossover(a, b))'), { type: 'macd_cross_up', fast: 8, slow: 17, signal: 9 });
});

test('MACD: histograma cruzando zero é o mesmo cruzamento da linha com o sinal', () => {
  const code = '//@version=5\nindicator("x")\n[m, s, h] = ta.macd(close, 12, 26, 9)\nalertcondition(ta.crossover(h, 0))';
  assert.deepEqual(specOf(code), { type: 'macd_cross_up', fast: 12, slow: 26, signal: 9 });
});

test('MACD escrito à mão com duas EMA e a EMA da linha', () => {
  const code = '//@version=5\nindicator("x")\nlinha = ta.ema(close, 12) - ta.ema(close, 26)\nsinal = ta.ema(linha, 9)\nalertcondition(ta.crossover(linha, sinal))';
  assert.deepEqual(specOf(code), { type: 'macd_cross_up', fast: 12, slow: 26, signal: 9 });
});

test('Bollinger: ta.bb com toque escrito como close < lower e close[1] >= lower[1], marcado com plotshape', () => {
  const code = '//@version=5\nindicator("x")\n[basis, upper, lower] = ta.bb(close, 20, 2.0)\ntoque = close < lower and close[1] >= lower[1]\nplotshape(toque, style=shape.triangleup, location=location.belowbar)';
  assert.deepEqual(specOf(code), { type: 'bb_lower', len: 20, mult: 2 });
});

test('Bollinger: crossunder do fechamento com a banda inferior, e multiplicador diferente', () => {
  const code = '//@version=5\nindicator("x")\n[b, u, l] = ta.bb(close, 30, 2.5)\nalertcondition(ta.crossunder(close, l))';
  assert.deepEqual(specOf(code), { type: 'bb_lower', len: 30, mult: 2.5 });
});

test('Bollinger escrita à mão: SMA menos múltiplo do desvio-padrão', () => {
  const code = '//@version=5\nindicator("x")\nbasis = ta.sma(close, 20)\ndev = 2 * ta.stdev(close, 20)\nlower = basis - dev\nalertcondition(ta.crossunder(close, lower))';
  assert.deepEqual(specOf(code), { type: 'bb_lower', len: 20, mult: 2 });
});

test('Bollinger como estado (close < lower): aceito com aviso de primeiro candle', () => {
  const r = accepted('//@version=5\nindicator("x")\n[b, u, l] = ta.bb(close, 20, 2)\nalertcondition(close < l)');
  assert.deepEqual(r.spec, { type: 'bb_lower', len: 20, mult: 2 });
  assert.ok(r.understood.some((s) => /só o primeiro de cada sequência/.test(s)));
});

test('rompimento: crossover com ta.highest(high, N)[1], via variável', () => {
  const code = '//@version=5\nindicator("x")\ntopo = ta.highest(high, 55)\nrompe = ta.crossover(close, topo[1])\nalertcondition(rompe)';
  assert.deepEqual(specOf(code), { type: 'breakout', len: 55 });
});

test('rompimento: close > ta.highest(high, N)[1] como estado e highest(N) de um argumento (v4)', () => {
  assert.deepEqual(specOf('//@version=5\nindicator("x")\nalertcondition(close > ta.highest(high, 20)[1])'), { type: 'breakout', len: 20 });
  assert.deepEqual(specOf('//@version=4\nstudy("x")\nalertcondition(crossover(close, highest(30)[1]))'), { type: 'breakout', len: 30 });
});

test('alert() dentro de if serve como ponto de entrada', () => {
  const code = RSI('if ta.crossover(r, 30)\n    alert("RSI cruzou 30", alert.freq_once_per_bar_close)');
  const r = accepted(code);
  assert.deepEqual(r.spec, { type: 'rsi_cross_up', len: 14, level: 30 });
  assert.ok(r.understood.some((s) => /alert\(\) dentro de if/.test(s)));
});

test('ifs aninhados somam as condições; filtro de candle fechado é ignorado e listado', () => {
  const code = RSI('if barstate.isconfirmed\n    if ta.crossover(r, 30)\n        strategy.entry("L", strategy.long)');
  const r = accepted(code);
  assert.deepEqual(r.spec, { type: 'rsi_cross_up', len: 14, level: 30 });
  assert.ok(r.ignored.some((s) => /barstate\.isconfirmed/.test(s)));
});

// ------------------------------------------------------------------ o que é ignorado vem listado

test('plot, hline, strategy.exit e variáveis sem uso aparecem em `ignored`; as entradas de venda também', () => {
  const code = [
    '//@version=5', 'strategy("x", overlay=true, initial_capital=10000, commission_value=0.1)',
    'f = ta.sma(close, 50)', 's = ta.sma(close, 200)', 'extra = ta.atr(14)',
    'plot(f)', 'plot(s)', 'hline(0)',
    'if ta.crossover(f, s)', '    strategy.entry("L", strategy.long)', '    strategy.exit("X", "L", stop=close * 0.9)',
    'if ta.crossunder(f, s)', '    strategy.entry("S", strategy.short)'
  ].join('\n');
  const r = accepted(code);
  assert.deepEqual(r.spec, { type: 'ma_cross_up', kind: 'sma', fast: 50, slow: 200 });
  const txt = r.ignored.join(' | ');
  assert.match(txt, /plot, hline/);
  assert.match(txt, /strategy\.exit/);
  assert.match(txt, /Entradas de venda \(short\) na linha 13/);
  assert.match(txt, /Capital, comissão/);
  assert.match(txt, /extra/);
});

test('plotshape ao lado de strategy.entry: a entrada da estratégia manda e o plotshape é listado como ignorado', () => {
  const code = RSI('c = ta.crossover(r, 30)\nplotshape(c)\nif c\n    strategy.entry("L", strategy.long)');
  const r = accepted(code);
  assert.deepEqual(r.spec, { type: 'rsi_cross_up', len: 14, level: 30 });
  assert.ok(r.ignored.some((s) => /^plotshape/.test(s)));
});

test('a mesma regra em alertcondition e em plotshape não é "duas regras"', () => {
  const r = accepted(RSI('c = ta.crossover(r, 30)\nalertcondition(c)\nalertcondition(c, title="de novo")'));
  assert.deepEqual(r.spec, { type: 'rsi_cross_up', len: 14, level: 30 });
});

test('alertcondition de venda (pelo nome) é separado da compra', () => {
  const code = '//@version=5\nindicator("x")\nf = ta.sma(close, 50)\ns = ta.sma(close, 200)\ncompra = ta.crossover(f, s)\nvenda = ta.crossunder(f, s)\nalertcondition(compra, title="Compra")\nalertcondition(venda, title="Venda")';
  const r = accepted(code);
  assert.deepEqual(r.spec, { type: 'ma_cross_up', kind: 'sma', fast: 50, slow: 200 });
  assert.ok(r.ignored.some((s) => /Entradas de venda/.test(s)));
});

// ------------------------------------------------------------------ formato do texto

test('comentário com // dentro de texto entre aspas não corta a linha; comentários no fim da linha são ignorados', () => {
  const code = '//@version=5 // versão\nindicator("RSI // teste") // título\nr = ta.rsi(close, 14) // período\n// alertcondition(ta.crossover(r, 99))\nalertcondition(ta.crossover(r, 30), title="http://exemplo.com") // alerta';
  assert.deepEqual(specOf(code), { type: 'rsi_cross_up', len: 14, level: 30 });
});

test('linhas de continuação: parênteses abertos, operador no fim e and no começo', () => {
  const code = RSI('sinal = ta.crossover(\n     r,\n     30\n)\nalertcondition(sinal,\n     title="x")');
  assert.deepEqual(specOf(code), { type: 'rsi_cross_up', len: 14, level: 30 });
  const code2 = RSI('alertcondition(r[1] < 30 and\n     r >= 30)');
  assert.deepEqual(specOf(code2), { type: 'rsi_cross_up', len: 14, level: 30 });
});

test('quebra de linha do Windows, tabulação, aspas tipográficas e espaço invisível', () => {
  const ch = String.fromCharCode;
  const code = '//@version=5\r\nindicator(' + ch(0x201c) + 'RSI' + ch(0x201d) + ')\r\nr = ta.rsi(close,' + ch(0x200b) + ' 14)\r\nif ta.crossover(r, 30)\r\n\tstrategy.entry("L", strategy.long)\r\n';
  assert.deepEqual(specOf(code), { type: 'rsi_cross_up', len: 14, level: 30 });
});

test('script sem //@version: aceito, e a leitura diz que assumiu a sintaxe da v5', () => {
  const r = accepted('indicator("x")\nr = ta.rsi(close, 14)\nalertcondition(ta.crossover(r, 30))');
  assert.match(r.understood[0], /não declarada/);
});

test('tipos declarados, var e nomes em português com acento no comentário', () => {
  const code = '//@version=5\nindicator("x")\nvar int periodo = 14\nfloat nivel = 30.0\nfloat valor = ta.rsi(close, periodo)\nbool sinal = ta.crossover(valor, nivel)\nalertcondition(sinal) // sinal de saída da sobrevenda';
  assert.deepEqual(specOf(code), { type: 'rsi_cross_up', len: 14, level: 30 });
});

// ------------------------------------------------------------------ recusados, com motivo

test('só entradas de venda (strategy.short): recusa dizendo que o Argos testa compras', () => {
  const r = refused('//@version=5\nstrategy("x")\nf = ta.ema(close, 9)\ns = ta.ema(close, 21)\nif ta.crossunder(f, s)\n    strategy.entry("S", strategy.short)');
  assert.match(r.reason, /venda \(short\)/);
});

test('cruzamento de médias para baixo, sem declarar direção: recusado (o motor só cruza para cima)', () => {
  const r = refused('//@version=5\nindicator("x")\nalertcondition(ta.crossunder(ta.sma(close, 50), ta.sma(close, 200)))');
  assert.match(r.unsupported.join(' '), /cruzamento para baixo/);
});

test('médias de tipos diferentes (SMA e EMA): recusado com a razão', () => {
  const r = refused('//@version=5\nindicator("x")\nalertcondition(ta.crossover(ta.ema(close, 9), ta.sma(close, 21)))');
  assert.match(r.reason, /mesmo tipo/);
});

test('filtro extra com and (fechamento acima da SMA 200): recusado, sem testar "só o cruzamento"', () => {
  const r = refused(RSI('alertcondition(ta.crossover(r, 30) and close > ta.sma(close, 200))'));
  assert.match(r.reason, /mais de uma condição/);
  assert.match(r.unsupported.join(' '), /SMA\(200\)/);
});

test('alternativas com or, negação e condicional ?: são recusadas', () => {
  assert.match(refused(RSI('alertcondition(ta.crossover(r, 30) or ta.crossover(r, 40))')).unsupported.join(' '), /or/);
  assert.match(refused(RSI('alertcondition(not ta.crossover(r, 30))')).unsupported.join(' '), /not/);
  assert.match(refused(RSI('alertcondition(close > open ? ta.crossover(r, 30) : false)')).unsupported.join(' '), /\?:/);
});

test('duas regras de compra diferentes: recusado, listando as duas', () => {
  const r = refused(RSI('if ta.crossover(r, 30)\n    strategy.entry("A", strategy.long)\nif ta.crossover(close, ta.sma(close, 200))\n    strategy.entry("B", strategy.long)'));
  assert.match(r.reason, /mais de uma regra/);
  assert.equal(r.unsupported.length, 2);
});

test('indicador fora do que o motor testa (ta.atr, ta.stoch, request.security): recusado e citado', () => {
  assert.match(refused('//@version=5\nindicator("x")\nalertcondition(close > ta.atr(14))').unsupported.join(' '), /ta\.atr/);
  assert.match(refused('//@version=5\nindicator("x")\nk = ta.stoch(close, high, low, 14)\nalertcondition(ta.crossover(k, 20))').unsupported.join(' '), /ta\.stoch/);
  assert.match(refused('//@version=5\nindicator("x")\nd = request.security(syminfo.tickerid, "D", close)\nalertcondition(ta.crossover(close, d))').unsupported.join(' '), /request\.security/);
});

test('variável reatribuída com := não é lida: o valor depende do fluxo do script', () => {
  const r = refused(RSI('sinal = false\nsinal := ta.crossover(r, 30)\nalertcondition(sinal)'));
  assert.match(r.unsupported.join(' '), /reatribuída/);
});

test('RSI ou média sobre outra fonte que não o fechamento: recusado', () => {
  assert.match(refused('//@version=5\nindicator("x")\nalertcondition(ta.crossover(ta.rsi(hl2, 14), 30))').unsupported.join(' '), /hl2/);
  assert.match(refused('//@version=5\nindicator("x")\nalertcondition(ta.crossover(close, ta.sma(open, 20)))').unsupported.join(' '), /open/);
});

test('rompimento da máxima dos fechamentos, ou sem [1]: recusado, porque o motor mede a máxima dos candles anteriores', () => {
  assert.match(refused('//@version=5\nindicator("x")\nalertcondition(ta.crossover(close, ta.highest(close, 20)[1]))').unsupported.join(' '), /máxima de close/);
  assert.match(refused('//@version=5\nindicator("x")\nalertcondition(ta.crossover(close, ta.highest(high, 20)))').unsupported.join(' '), /sem \[1\]/);
});

test('RSI acima do nível como estado não é cruzamento: recusado', () => {
  assert.match(refused(RSI('alertcondition(r > 30)')).unsupported.join(' '), /condição de estado/);
});

test('ta.cross (dois sentidos) e igualdade são recusados', () => {
  assert.match(refused(RSI('alertcondition(ta.cross(r, 30))')).unsupported.join(' '), /dois sentidos/);
  assert.match(refused(RSI('alertcondition(r == 30)')).unsupported.join(' '), /igualdade/);
});

test('filtro de posição (strategy.position_size) é recusado, com a razão', () => {
  const r = refused(RSI('if ta.crossover(r, 30) and strategy.position_size == 0\n    strategy.entry("L", strategy.long)'));
  assert.match(r.unsupported.join(' '), /strategy\.position_size/);
  assert.match(r.reason, /posição aberta/);
});

test('entrada dentro de else, de laço ou de função: recusada', () => {
  assert.match(refused(RSI('if r > 70\n    x = 1\nelse\n    strategy.entry("L", strategy.long)')).unsupported.join(' '), /dentro de else/);
  assert.match(refused(RSI('for i = 0 to 3\n    strategy.entry("L", strategy.long)')).unsupported.join(' '), /laço/);
  assert.match(refused(RSI('f(x) =>\n    alertcondition(x)\nf(1)')).unsupported.join(' '), /função/);
});

test('função definida no script e usada na regra é recusada', () => {
  const r = refused(RSI('forte(x) => x > 50\nalertcondition(forte(r))'));
  assert.match(r.unsupported.join(' '), /forte/);
});

test('ordem limite na entrada muda o preço de entrada: recusada', () => {
  const r = refused(RSI('if ta.crossover(r, 30)\n    strategy.entry("L", strategy.long, limit=close * 0.99)'));
  assert.match(r.unsupported.join(' '), /limit/);
});

test('entrada sem condição (todo candle) e condição sempre verdadeira são recusadas', () => {
  assert.match(refused('//@version=5\nstrategy("x")\nstrategy.entry("L", strategy.long)').reason, /sem condição|todo candle/);
  assert.match(refused(RSI('alertcondition(true)')).reason, /todo candle/);
});

test('parâmetros fora da faixa: nível de RSI, período zero ou gigante, médias iguais', () => {
  assert.match(refused(RSI('alertcondition(ta.crossover(r, 130))')).unsupported.join(' '), /nível do RSI/);
  assert.match(refused('//@version=5\nindicator("x")\nalertcondition(ta.crossover(ta.rsi(close, 0), 30))').unsupported.join(' '), /1 a 400/);
  assert.match(refused('//@version=5\nindicator("x")\nalertcondition(ta.crossover(ta.rsi(close, 5000), 30))').unsupported.join(' '), /1 a 400/);
  assert.match(refused('//@version=5\nindicator("x")\nalertcondition(ta.crossover(ta.sma(close, 20), ta.sma(close, 20)))').reason, /nunca se cruzam/);
  assert.match(refused('//@version=5\nindicator("x")\nalertcondition(ta.crossover(ta.rsi(close, 14.5), 30))').unsupported.join(' '), /1 a 400/);
});

test('versão do Pine fora de 4 a 6 é recusada com a versão citada', () => {
  assert.match(refused('//@version=3\nstudy("x")\nalertcondition(crossover(rsi(close, 14), 30))').reason, /versão 3/);
  assert.match(refused('//@version=7\nindicator("x")\nalertcondition(ta.crossover(ta.rsi(close, 14), 30))').reason, /versão 7/);
});

test('sem ponto de entrada: só desenho, ou só atribuições', () => {
  assert.match(refused('//@version=5\nindicator("x")\nplot(ta.rsi(close, 14))').reason, /ponto de entrada/);
  assert.match(refused('//@version=5\nr = ta.rsi(close, 14)').reason, /ponto de entrada/);
});

test('biblioteca (library) é recusada', () => {
  assert.match(refused('//@version=5\nlibrary("x")\nexport f(x) => x').reason, /biblioteca/);
});

// ------------------------------------------------------------------ entrada hostil

test('entrada que não é texto, vazia, em branco ou só comentários', () => {
  for (const v of [undefined, null, 42, {}, [], true, Symbol('x')]) assert.equal(readPine(v).ok, false);
  assert.match(refused('').reason, /Nenhum script/);
  assert.match(refused('   \n\t \r\n  ').reason, /Nenhum script/);
  assert.match(refused('// só um comentário\n//@version=5\n// outro').reason, /comentários/);
});

test('texto enorme é recusado pelo tamanho, sem processar', () => {
  const t0 = Date.now();
  const r = refused('a'.repeat(MAX_SCRIPT_CHARS + 1));
  assert.match(r.reason, /limite/);
  assert.match(r.reason, /20\.000/);
  assert.ok(Date.now() - t0 < 200);
  assert.equal(readPine('x'.repeat(5_000_000)).ok, false);
});

test('HTML, script e injeção de texto: recusados, sem eco do texto bruto na razão', () => {
  for (const html of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg/onload=alert(1)>', '<!DOCTYPE html><html><body><h1>oi</h1></body></html>']) {
    const r = refused(html);
    assert.doesNotMatch(r.reason, /<|>/);
    for (const u of r.unsupported) assert.doesNotMatch(u, /<script|onerror|onload/i);
  }
});

test('Unicode, emoji, direção de texto, byte nulo e caracteres de controle não quebram a leitura', () => {
  const ch = String.fromCharCode;
  const lixo = ['🚀📈💥', 'عربى' + ch(0x202e, 0x202d) + 'texto', 'ｒｓｉ(ｃｌｏｓｅ，１４)', 'a' + ch(0) + 'b' + ch(1) + 'c' + ch(0x7f), ch(0xd800) + ' sozinho', 'ç ã é ñ ü', 'é'.repeat(5000)];
  for (const t of lixo) { const r = readPine(t); assert.equal(r.ok, false); assert.equal(typeof r.reason, 'string'); }
  // o caractere inválido dentro de uma expressão da regra vira recusa, não erro
  const r = readPine(RSI('alertcondition(ta.crossover(r, 3ç0))'));
  assert.equal(r.ok, false);
  // Unicode em título e comentário não atrapalha uma regra válida
  assert.deepEqual(specOf(RSI('alertcondition(ta.crossover(r, 30), title="RSI 📈 cruza ‘30’") // ação')), { type: 'rsi_cross_up', len: 14, level: 30 });
});

test('aninhamento absurdo de parênteses, colchetes e operadores não estoura a pilha nem trava', () => {
  const t0 = Date.now();
  for (const code of [
    RSI(`alertcondition(${'('.repeat(9000)}r${')'.repeat(9000)})`),
    RSI(`alertcondition(${'('.repeat(15000)}`),
    RSI(`alertcondition(${'-'.repeat(15000)}1)`),
    RSI(`alertcondition(r${'[1]'.repeat(5000)} > 30)`),
    RSI(`x = ${'1 + '.repeat(4000)}1\nalertcondition(x)`),
    RSI(`alertcondition(${'ta.crossover('.repeat(2000)}r, 30${')'.repeat(2000)})`)
  ]) {
    const r = readPine(code);
    assert.equal(typeof r.ok, 'boolean');
    if (!r.ok) assert.equal(typeof r.reason, 'string');
  }
  assert.ok(Date.now() - t0 < 5000, 'a leitura de entradas patológicas demorou demais');
});

test('cadeia longa de variáveis e variável que depende de si mesma são recusadas', () => {
  const chain = Array.from({ length: 120 }, (_, i) => `v${i} = v${i + 1}`).join('\n');
  assert.equal(readPine(`//@version=5\nindicator("x")\n${chain}\nv120 = ta.rsi(close, 14)\nalertcondition(ta.crossover(v0, 30))`).ok, false);
  assert.match(refused(RSI('a = b\nb = a\nalertcondition(ta.crossover(a, 30))')).unsupported.join(' '), /depende de si mesma/);
});

test('nomes de variável perigosos (__proto__, constructor, toString) não contaminam nem quebram nada', () => {
  assert.deepEqual(specOf('//@version=5\nindicator("x")\n__proto__ = 1\nconstructor = 2\ntoString = ta.rsi(close, 14)\nalertcondition(ta.crossover(toString, 30))'), { type: 'rsi_cross_up', len: 14, level: 30 });
  assert.equal(readPine('//@version=5\nindicator("x")\nalertcondition(constructor)').ok, false);
  assert.equal(({}).polluted, undefined);
});

test('muitas linhas e uma linha de quase 20 mil caracteres', () => {
  const many = RSI(Array.from({ length: 1400 }, (_, k) => `v${k} = ${k}`).join('\n') + '\nalertcondition(ta.crossover(r, 30))');
  assert.ok(many.length < MAX_SCRIPT_CHARS);
  const m = accepted(many);
  assert.deepEqual(m.spec, { type: 'rsi_cross_up', len: 14, level: 30 });
  assert.ok(m.ignored.some((x) => /e mais \d+/.test(x)));
  const wide = RSI(`alertcondition(ta.crossover(r, 30)${' '.repeat(19000)})`);
  assert.deepEqual(specOf(wide), { type: 'rsi_cross_up', len: 14, level: 30 });
});

test('mutação aleatória de scripts válidos nunca lança e sempre devolve o formato prometido', () => {
  let seed = 20261012;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const alphabet = ['(', ')', '[', ']', ',', '=', '<', '>', ' ', '\n', '"', '/', ':', '?', 'and', 'or', 'not', '0', '999', 'ta.', 'é', '#', '.', '-'];
  const bases = PINE_EXAMPLES.map((e) => e.code);
  let accepted_ = 0;
  for (let n = 0; n < 1500; n++) {
    let s = bases[Math.floor(rnd() * bases.length)];
    const muts = 1 + Math.floor(rnd() * 5);
    for (let m = 0; m < muts; m++) {
      const i = Math.floor(rnd() * (s.length + 1));
      const op = Math.floor(rnd() * 3);
      if (op === 0) s = s.slice(0, i) + alphabet[Math.floor(rnd() * alphabet.length)] + s.slice(i);
      else if (op === 1) s = s.slice(0, i) + s.slice(i + 1 + Math.floor(rnd() * 8));
      else s = s.slice(0, i) + s.slice(Math.max(0, i - 15), i) + s.slice(i);
    }
    const r = readPine(s);
    assert.equal(typeof r.ok, 'boolean');
    if (r.ok) {
      accepted_++;
      assert.ok(engine.SPEC_TYPES[r.spec.type], 'tipo de spec desconhecido');
      assert.ok(Array.isArray(r.understood) && Array.isArray(r.ignored));
    } else {
      assert.equal(typeof r.reason, 'string');
      assert.ok(Array.isArray(r.unsupported) && Array.isArray(r.supported));
    }
  }
  assert.ok(accepted_ > 0, 'a mutação nunca produziu um script válido: o teste não exercita o caminho de sucesso');
});

// ------------------------------------------------------------------ galeria e motor

const GALLERY_SPEC = {
  rsi: { type: 'rsi_cross_up', len: 14, level: 30 },
  ema: { type: 'ma_cross_up', kind: 'ema', fast: 9, slow: 21 },
  macd: { type: 'macd_cross_up', fast: 12, slow: 26, signal: 9 },
  bb: { type: 'bb_lower', len: 20, mult: 2 },
  brk: { type: 'breakout', len: 55 },
  sma200: { type: 'price_cross_ma_up', kind: 'sma', len: 200 }
};

test('galeria do Sandbox: 6 exemplos, cada um lido sem recusa e com o spec esperado', () => {
  assert.equal(PINE_EXAMPLES.length, 6);
  assert.deepEqual(PINE_EXAMPLES.map((e) => e.id).sort(), Object.keys(GALLERY_SPEC).sort());
  for (const ex of PINE_EXAMPLES) {
    const r = accepted(ex.code);
    assert.deepEqual(r.spec, GALLERY_SPEC[ex.id], ex.id);
    assert.ok(ex.title && ex.note);
    assert.ok(r.understood.length >= 4);
  }
});

test('os nomes que o leitor escreve são os mesmos de SPEC_TYPES.nome do motor', () => {
  const samples = [
    { type: 'rsi_cross_up', len: 14, level: 30 }, { type: 'rsi_below', len: 9, level: 25.5 }, { type: 'macd_cross_up', fast: 12, slow: 26, signal: 9 },
    { type: 'ma_cross_up', kind: 'ema', fast: 9, slow: 21 }, { type: 'price_cross_ma_up', kind: 'sma', len: 200 },
    { type: 'bb_lower', len: 20, mult: 2.5 }, { type: 'breakout', len: 55 }
  ];
  assert.deepEqual(samples.map((s) => s.type).sort(), Object.keys(engine.SPEC_TYPES).sort());
  for (const s of samples) assert.equal(describeSpec(s), engine.SPEC_TYPES[s.type].nome(s), s.type);
});

test('o spec lido roda no motor: analyzeSpec não lança e devolve as estatísticas do setup', () => {
  const d = snapshotSeries('BTCUSDT', '1d');
  const cfg = { mode: 'atr', tgt: 2, stp: 1, hold: 12 };
  for (const ex of PINE_EXAMPLES) {
    const { spec } = accepted(ex.code);
    let res;
    assert.doesNotThrow(() => { res = engine.analyzeSpec(d, cfg, spec, { sym: 'BTCUSDT', tf: '1d' }); }, ex.id);
    assert.equal(res.setup.id, 'CUSTOM');
    assert.equal(res.setup.nome, describeSpec(spec));
    assert.ok(res.setup.n >= 0 && res.setup.n === res.setup.wins + res.setup.n - res.setup.wins);
    assert.ok(Number.isFinite(res.setup.nRaw));
    assert.ok(res.setup.verdict && res.setup.verdict.key);
  }
});

test('scripts equivalentes aos setups do banco dão os mesmos gatilhos que o motor usa nesses setups', () => {
  const d = snapshotSeries('BTCUSDT', '1d');
  const A = engine.analyze(d, { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, {});
  const same = (code, id) => {
    const { spec } = accepted(code);
    const mine = engine.triggersFromSpec(d, spec);
    for (let i = 0; i < d.n; i++) assert.equal(i >= 200 ? mine[i] : false, A.trig[id][i], `${id} no candle ${i}`);
    assert.ok(A.trig[id].some(Boolean), `${id}: sem nenhum gatilho para comparar`);
  };
  same(PINE_EXAMPLES.find((e) => e.id === 'rsi').code, 'RSI_OVERSOLD');
  same(PINE_EXAMPLES.find((e) => e.id === 'macd').code, 'MACD_CROSS');
  same(PINE_EXAMPLES.find((e) => e.id === 'bb').code, 'BB_LOWER');
  same('//@version=5\nindicator("x")\nalertcondition(ta.crossover(ta.sma(close, 50), ta.sma(close, 200)))', 'GOLDEN_CROSS');
  same('//@version=5\nindicator("x")\nalertcondition(ta.crossover(close, ta.highest(high, 20)[1]))', 'BREAKOUT_20');
});

// ------------------------------------------------------------------ scripts no formato do TradingView

test('estratégia típica do TradingView (if com parênteses, entrada de compra e de venda, margens)', () => {
  const code = [
    '//@version=5', 'strategy("RSI Strategy", overlay=true, margin_long=100, margin_short=100)',
    'rsiLength = input.int(14, "RSI Length")', 'oversold = input.int(30, "Oversold")', 'overbought = input.int(70, "Overbought")',
    'rsiValue = ta.rsi(close, rsiLength)', 'longCondition = ta.crossover(rsiValue, oversold)',
    'if (longCondition)', '    strategy.entry("Long", strategy.long)',
    'shortCondition = ta.crossunder(rsiValue, overbought)', 'if (shortCondition)', '    strategy.entry("Short", strategy.short)'
  ].join('\n');
  const r = accepted(code);
  assert.deepEqual(r.spec, { type: 'rsi_cross_up', len: 14, level: 30 });
  assert.ok(r.ignored.some((s) => /Entradas de venda \(short\) na linha 12/.test(s)));
  assert.ok(r.ignored.some((s) => /overbought, shortCondition/.test(s)));
});

test('indicador com compra e venda: plotshape de compra vira regra, o de venda e o bgcolor ficam como ignorados', () => {
  const code = [
    '//@version=5', 'indicator("Buy Sell", overlay=true)', 'fast = ta.ema(close, 9)', 'slow = ta.ema(close, 21)',
    'buy = ta.crossover(fast, slow)', 'sell = ta.crossunder(fast, slow)',
    'plotshape(buy, title="Buy", location=location.belowbar, color=color.green, style=shape.labelup, text="BUY")',
    'plotshape(sell, title="Sell", location=location.abovebar, color=color.red, style=shape.labeldown, text="SELL")',
    'bgcolor(buy ? color.new(color.green, 80) : na)'
  ].join('\n');
  const r = accepted(code);
  assert.deepEqual(r.spec, { type: 'ma_cross_up', kind: 'ema', fast: 9, slow: 21 });
  assert.ok(r.ignored.some((s) => /Entradas de venda/.test(s)));
  assert.ok(r.ignored.some((s) => /bgcolor/.test(s)));
});

test('MACD v4 com inputs, lista de retornos e strategy.entry com when=', () => {
  const code = '//@version=4\nstrategy("MACD", overlay=true)\nfast = input(12, minval=1)\nslow = input(26, minval=1)\nsig = input(9, minval=1)\n[macdLine, signalLine, histLine] = macd(close, fast, slow, sig)\nlongCondition = crossover(macdLine, signalLine)\nstrategy.entry("MACD Long", strategy.long, when=longCondition)';
  assert.deepEqual(specOf(code), { type: 'macd_cross_up', fast: 12, slow: 26, signal: 9 });
});

test('expressão que o leitor não entende vira recusa com a linha, não erro', () => {
  const r = refused('//@version=4\nstudy("x")\nfast = input(12, minval=1), slow = input(26, minval=1)\nalertcondition(crossover(rsi(close, fast), 30))');
  assert.match(r.unsupported.join(' '), /expressão que o leitor não entende.*\(linha 3\)/);
});

test('volume e outras séries fora do fechamento recusam o script inteiro, sem testar só a parte entendida', () => {
  const r = refused('//@version=5\nindicator("x")\nalertcondition(ta.crossover(close, ta.sma(close, 50)) and volume > ta.sma(volume, 20))');
  assert.match(r.unsupported.join(' '), /volume/);
});
