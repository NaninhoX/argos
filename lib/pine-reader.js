// Leitor de Pine Script do Sandbox.
//
// Lê o texto de um script Pine (v4, v5 ou v6) e extrai a regra de entrada no formato que o motor testa
// (`SPEC_TYPES` de engine/index.js). Princípio único: uma regra testada tem de ser a regra do script. Na dúvida o
// leitor recusa e explica; nunca aproxima, nunca escolhe "a parte que entendeu" de uma regra composta.
//
// Módulo puro: sem DOM, sem rede, sem import. O mesmo arquivo vai ao navegador: tools/build-web.mjs o converte em
// web/js/pine-reader.js (global `ArgosPineReader`). Por isso só `export function` e `export const` no nível do arquivo.
//
// Como lê: separa o script em comandos (juntando linhas de continuação), monta uma tabela de variáveis e a lista de
// pontos de entrada (strategy.entry, alertcondition, alert, plotshape/plotchar), avalia a condição do ponto de entrada
// numa representação simbólica (indicadores, não números) e compara com os padrões que o motor sabe testar.
// Desenhos (plot, hline, bgcolor...), saídas do script (strategy.exit...) e variáveis sem uso na regra são ignorados e
// listados em `ignored`. Tudo que influencia a regra e não é coberto vai para `unsupported` e a leitura é recusada.

/** Tamanho máximo do script aceito (em caracteres). Acima disso a leitura é recusada, sem processar o texto. */
export const MAX_SCRIPT_CHARS = 20000;

/** Maior período aceito em médias, RSI, Bollinger, MACD e máxima. */
const MAX_PERIOD = 400;
const MAX_DEPTH = 60;
const MAX_NODES = 3000;

/** Padrões que o motor testa e que o leitor sabe reconhecer. Mostrados quando a leitura é recusada. */
export const SUPPORTED_PATTERNS = Object.freeze([
  'RSI cruzando um nível para cima: ta.crossover(ta.rsi(close, N), nível)',
  'RSI entrando abaixo de um nível: ta.crossunder(ta.rsi(close, N), nível) ou ta.rsi(close, N) < nível',
  'MACD cruzando a linha de sinal para cima: ta.crossover(linha, sinal) com ta.macd(close, rápida, lenta, sinal)',
  'Duas médias do mesmo tipo (SMA ou EMA) cruzando para cima: ta.crossover(ta.ema(close, 9), ta.ema(close, 21))',
  'Fechamento cruzando uma média (SMA ou EMA) para cima: ta.crossover(close, ta.sma(close, N))',
  'Fechamento abaixo da banda inferior de Bollinger: ta.bb(close, N, mult) ou ta.sma(close, N) - mult * ta.stdev(close, N)',
  'Rompimento da máxima de N candles: ta.crossover(close, ta.highest(high, N)[1])',
  'Pontos de entrada: strategy.entry(..., strategy.long), alertcondition(), alert() dentro de if, plotshape() e plotchar()',
  'Períodos e níveis podem vir de input.int, input.float ou input(), lidos pelo valor padrão, e de variáveis intermediárias simples',
  'Sintaxe das versões 4, 5 e 6 (ta.rsi ou rsi, ta.crossover ou crossover)'
]);

/**
 * Exemplos da galeria do Sandbox. Cada um é lido sem recusa e dá a regra descrita em `rule` (conferido em teste).
 * @type {ReadonlyArray<{ id: string, title: string, note: string, code: string }>}
 */
export const PINE_EXAMPLES = Object.freeze([
  {
    id: 'rsi',
    title: 'RSI cruza 30',
    note: 'Pine v5, indicador com alerta e períodos em input',
    code: '//@version=5\nindicator("RSI cruza 30", overlay=false)\nperiodo = input.int(14, "Período do RSI", minval=2)\nnivel = input.float(30, "Nível")\nr = ta.rsi(close, periodo)\nsinal = ta.crossover(r, nivel)\nplot(r, "RSI")\nhline(nivel)\nalertcondition(sinal, title="RSI cruza 30 para cima")'
  },
  {
    id: 'ema',
    title: 'Cruzamento EMA 9/21',
    note: 'Pine v5, estratégia com strategy.entry',
    code: '//@version=5\nstrategy("EMA 9/21", overlay=true)\nrapida = ta.ema(close, 9)\nlenta = ta.ema(close, 21)\nplot(rapida, "EMA 9")\nplot(lenta, "EMA 21")\nif ta.crossover(rapida, lenta)\n    strategy.entry("L", strategy.long)'
  },
  {
    id: 'macd',
    title: 'MACD cruza o sinal',
    note: 'Pine v4, sem prefixo ta.',
    code: '//@version=4\nstudy("MACD cruza o sinal", overlay=false)\n[linha, sinal, hist] = macd(close, 12, 26, 9)\nplot(hist, style=plot.style_histogram)\nalertcondition(crossover(linha, sinal), title="MACD cruza o sinal")'
  },
  {
    id: 'bb',
    title: 'Bollinger inferior',
    note: 'Pine v5, marcação com plotshape',
    code: '//@version=5\nindicator("Bollinger inferior", overlay=true)\n[basis, upper, lower] = ta.bb(close, 20, 2.0)\ntoque = close < lower and close[1] >= lower[1]\nplotshape(toque, style=shape.triangleup, location=location.belowbar)'
  },
  {
    id: 'brk',
    title: 'Rompimento de 55',
    note: 'Pine v5, máxima de 55 candles',
    code: '//@version=5\nindicator("Rompimento de 55", overlay=true)\ntopo = ta.highest(high, 55)\nrompe = ta.crossover(close, topo[1])\nalertcondition(rompe, title="Rompimento de 55 candles")'
  },
  {
    id: 'sma200',
    title: 'Fechamento cruza a SMA 200',
    note: 'Pine v6, estratégia com período em input',
    code: '//@version=6\nstrategy("Fechamento cruza a SMA 200", overlay=true)\nperiodo = input.int(200, "Período da média")\nmedia = ta.sma(close, periodo)\nif ta.crossover(close, media)\n    strategy.entry("L", strategy.long)'
  }
]);

// ------------------------------------------------------------------ erros internos

class Unsupported extends Error {
  /** @param {string} construct construção não coberta (vai para `unsupported`) @param {string} [reason] frase que explica */
  constructor(construct, reason) {
    super(construct);
    this.construct = construct;
    this.reason = reason || '';
  }
}
const no = (construct, reason) => { throw new Unsupported(construct, reason); };

const fmtInt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const plural = (n, one, many) => (n === 1 ? one : many);

// ------------------------------------------------------------------ texto → comandos

const ch = (...codes) => String.fromCharCode(...codes);
const RE_INVISIBLE = new RegExp('[' + ch(0x200b) + '-' + ch(0x200d) + ch(0x2060) + ch(0xfeff) + ']', 'g');
const RE_NBSP = new RegExp(ch(0xa0), 'g');
const RE_DQUOTE = new RegExp('[' + ch(0x201c, 0x201d) + ']', 'g');
const RE_SQUOTE = new RegExp('[' + ch(0x2018, 0x2019) + ']', 'g');
const RE_NUL = new RegExp(ch(0), 'g');

/** Normaliza o texto colado: quebras de linha, caracteres invisíveis, aspas tipográficas, tabulação. */
function normalizeSource(code) {
  return code
    .replace(/\r\n?/g, '\n')
    .replace(RE_INVISIBLE, '')
    .replace(RE_NBSP, ' ')
    .replace(RE_DQUOTE, '"')
    .replace(RE_SQUOTE, "'")
    .replace(/\t/g, '    ')
    .replace(RE_NUL, '');
}

/** Tira o comentário `//` do fim da linha, sem cortar `//` que está dentro de texto entre aspas. */
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/** Variação de profundidade de parênteses e colchetes numa linha (texto entre aspas não conta). */
function depthDelta(line) {
  let q = null;
  let d = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '[') d++;
    else if (c === ')' || c === ']') d--;
  }
  return d;
}

const ENDS_OPEN = /(?:[,(\[+\-*\/%?:<>=!]|\band|\bor|\bnot)\s*$/;
const STARTS_CONT = /^(?:and|or)\b/;

/** Junta linhas de continuação (parênteses abertos, operador no fim, `and`/`or` no começo da linha seguinte). */
function logicalLines(lines) {
  const out = [];
  let cur = null;
  let depth = 0;
  let last = '';
  const isOpen = () => depth > 0 || (!/=>\s*$/.test(last) && ENDS_OPEN.test(last));
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const text = raw.trim();
    if (!text) continue;
    const indent = raw.length - raw.replace(/^ +/, '').length;
    if (cur && (isOpen() || (STARTS_CONT.test(text) && indent > cur.indent))) {
      cur.text += ' ' + text;
      depth += depthDelta(text);
      last = text;
      continue;
    }
    if (cur) out.push(cur);
    cur = { indent, text, line: i + 1 };
    depth = depthDelta(text);
    last = text;
  }
  if (cur) out.push(cur);
  return out;
}

/** Divide por `sep` no nível de fora (ignora separador dentro de parênteses, colchetes e texto entre aspas). */
function splitTop(text, sep) {
  const parts = [];
  let q = null;
  let d = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '[') d++;
    else if (c === ')' || c === ']') d--;
    else if (c === sep && d === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** `nome(arg1, nome=arg2)` → { name, args: [{ name, text }] }; `null` se o texto não é uma chamada completa. */
function parseCall(text) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\(/.exec(text);
  if (!m) return null;
  const open = m[0].length - 1;
  let q = null;
  let d = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '[') d++;
    else if (c === ')' || c === ']') { d--; if (d === 0) { close = i; break; } }
  }
  if (close < 0) return null;
  const inner = text.slice(open + 1, close);
  const args = /\S/.test(inner)
    ? splitTop(inner, ',').map((a) => {
      const nm = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
      return nm ? { name: nm[1], text: nm[2].trim() } : { name: null, text: a.trim() };
    })
    : [];
  return { name: m[1], args, rest: text.slice(close + 1).trim() };
}

// ------------------------------------------------------------------ expressões

const NUM_RE = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const ID_RE = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/y;

function tokenize(s) {
  if (s.length > MAX_SCRIPT_CHARS) no('expressão longa demais');
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && s[i + 1] >= '0' && s[i + 1] <= '9')) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(s);
      if (!m) no('número ilegível');
      toks.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
    } else if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
      ID_RE.lastIndex = i;
      const m = ID_RE.exec(s);
      toks.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let v = '';
      while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; v += s[j] === undefined ? '' : s[j]; j++; }
      if (j >= s.length) no('texto entre aspas sem fim');
      toks.push({ t: 'str', v });
      i = j + 1;
    } else {
      const two = s.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '==' || two === '!=') { toks.push({ t: 'op', v: two }); i += 2; }
      else if ('+-*/%<>()[],?:=!'.includes(c)) { toks.push({ t: 'op', v: c }); i++; }
      else no(`caractere não reconhecido (código ${c.charCodeAt(0).toString(16).toUpperCase()})`);
    }
  }
  return toks;
}

/** Texto → árvore. Lança `Unsupported` se não for uma expressão que o leitor entenda. */
function parseExpr(text) {
  const toks = tokenize(text);
  let p = 0;
  let depth = 0;
  let nodes = 0;
  const isOp = (v) => p < toks.length && toks[p].t === 'op' && toks[p].v === v;
  const isKw = (v) => p < toks.length && toks[p].t === 'id' && toks[p].v === v;
  const mk = (o) => { if (++nodes > MAX_NODES) no('expressão grande demais'); return o; };
  const enter = () => { if (++depth > MAX_DEPTH) no('expressão aninhada demais'); };
  const expectOp = (v) => { if (!isOp(v)) no('expressão incompleta'); p++; };

  function ternary() {
    enter();
    const c = orE();
    let r = c;
    if (isOp('?')) { p++; const a = ternary(); expectOp(':'); const b = ternary(); r = mk({ n: 'tern', c, a, b }); }
    depth--;
    return r;
  }
  function orE() { let l = andE(); while (isKw('or')) { p++; l = mk({ n: 'bin', op: 'or', l, r: andE() }); } return l; }
  function andE() { let l = eqE(); while (isKw('and')) { p++; l = mk({ n: 'bin', op: 'and', l, r: eqE() }); } return l; }
  function eqE() { let l = relE(); while (isOp('==') || isOp('!=')) { const op = toks[p++].v; l = mk({ n: 'bin', op, l, r: relE() }); } return l; }
  function relE() { let l = addE(); while (isOp('<') || isOp('<=') || isOp('>') || isOp('>=')) { const op = toks[p++].v; l = mk({ n: 'bin', op, l, r: addE() }); } return l; }
  function addE() { let l = mulE(); while (isOp('+') || isOp('-')) { const op = toks[p++].v; l = mk({ n: 'bin', op, l, r: mulE() }); } return l; }
  function mulE() { let l = unaryE(); while (isOp('*') || isOp('/') || isOp('%')) { const op = toks[p++].v; l = mk({ n: 'bin', op, l, r: unaryE() }); } return l; }
  function unaryE() {
    enter();
    let r;
    if (isOp('-') || isOp('+')) { const op = toks[p++].v; r = mk({ n: 'un', op, x: unaryE() }); }
    else if (isKw('not')) { p++; r = mk({ n: 'un', op: 'not', x: unaryE() }); }
    else r = postfix();
    depth--;
    return r;
  }
  function postfix() {
    let e = primary();
    while (isOp('[')) { p++; const idx = ternary(); expectOp(']'); e = mk({ n: 'idx', base: e, idx }); }
    return e;
  }
  function arg() {
    if (toks[p] && toks[p].t === 'id' && toks[p + 1] && toks[p + 1].t === 'op' && toks[p + 1].v === '=') {
      const name = toks[p].v;
      p += 2;
      return { name, e: ternary() };
    }
    return { name: null, e: ternary() };
  }
  function primary() {
    const t = toks[p];
    if (!t) no('expressão incompleta');
    if (t.t === 'num') { p++; return mk({ n: 'num', v: t.v }); }
    if (t.t === 'str') { p++; return mk({ n: 'str', v: t.v }); }
    if (t.t === 'id') {
      p++;
      if (t.v === 'true' || t.v === 'false') return mk({ n: 'bool', v: t.v === 'true' });
      if (isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) { for (;;) { args.push(arg()); if (isOp(',')) { p++; continue; } break; } }
        expectOp(')');
        return mk({ n: 'call', fn: t.v, args });
      }
      return mk({ n: 'id', name: t.v });
    }
    if (t.t === 'op' && t.v === '(') { p++; const e = ternary(); expectOp(')'); return e; }
    return no('expressão não reconhecida');
  }

  const e = ternary();
  if (p < toks.length) no('texto depois do fim da expressão');
  return e;
}

// ------------------------------------------------------------------ valores simbólicos
// num   { k:'num', v }                      constante
// bool  { k:'bool', v }                     constante
// flag  { k:'flag', name }                  barstate.isconfirmed
// src   { k:'src', name, shift }            close, high...
// ind   { k:'ind', ind, ...parâmetros, shift }  rsi, sma, ema, stdev, highest, macd_line/signal/hist, bb_basis/upper/lower
// arith { k:'arith', op, l, r }             só para reconhecer Bollinger e MACD escritos à mão
// cmp   { k:'cmp', op, l, r }               comparação
// cross { k:'cross', dir:'over'|'under', l, r }
// and   { k:'and', items }

const SRC_NAMES = new Set(['close', 'open', 'high', 'low', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4']);
const isSeries = (x) => x.k === 'src' || x.k === 'ind';
const isInd = (x, name) => x.k === 'ind' && x.ind === name;
const isCond = (x) => x.k === 'cmp' || x.k === 'cross' || x.k === 'and' || x.k === 'flag' || x.k === 'bool';
const sig = (x) => JSON.stringify(x, (k, v) => (k === 'shift' ? undefined : v));
const at = (s, n) => (n ? `${s}[${n}]` : s);
const numText = (v) => String(v);

/** Descrição curta e legível de um valor simbólico, para as mensagens. */
function show(x) {
  switch (x.k) {
    case 'num': return numText(x.v);
    case 'bool': return String(x.v);
    case 'flag': return x.name;
    case 'src': return at(x.name, x.shift);
    case 'arith': return `(${show(x.l)} ${x.op} ${show(x.r)})`;
    case 'cmp': return `${show(x.l)} ${x.op} ${show(x.r)}`;
    case 'cross': return `${x.dir === 'over' ? 'cruzamento para cima' : 'cruzamento para baixo'} de ${show(x.l)} com ${show(x.r)}`;
    case 'and': return x.items.map(show).join(' e ');
    case 'ind': {
      const base = {
        rsi: `RSI(${x.len})`, sma: `SMA(${x.len})`, ema: `EMA(${x.len})`, stdev: `desvio-padrão(${x.len})`,
        highest: `máxima de ${x.src} em ${x.len} candles`,
        macd_line: `linha MACD(${x.fast}, ${x.slow})`, macd_signal: `sinal MACD(${x.fast}, ${x.slow}, ${x.signal})`, macd_hist: `histograma MACD(${x.fast}, ${x.slow}, ${x.signal})`,
        bb_basis: `base de Bollinger(${x.len}, ${x.mult})`, bb_upper: `banda superior de Bollinger(${x.len}, ${x.mult})`, bb_lower: `banda inferior de Bollinger(${x.len}, ${x.mult})`
      }[x.ind] || x.ind;
      return at(base, x.shift);
    }
    default: return '?';
  }
}

/** Nomes iguais aos de SPEC_TYPES.nome em engine/index.js (conferido em teste). */
export function describeSpec(spec) {
  switch (spec.type) {
    case 'rsi_cross_up': return 'RSI(' + spec.len + ') cruza acima de ' + spec.level;
    case 'rsi_below': return 'RSI(' + spec.len + ') entra abaixo de ' + spec.level;
    case 'macd_cross_up': return 'MACD(' + spec.fast + ', ' + spec.slow + ', ' + spec.signal + ') cruza acima do sinal';
    case 'ma_cross_up': return spec.kind.toUpperCase() + spec.fast + ' cruza acima da ' + spec.kind.toUpperCase() + spec.slow;
    case 'price_cross_ma_up': return 'Fechamento cruza acima da ' + spec.kind.toUpperCase() + spec.len;
    case 'bb_lower': return 'Fechamento abaixo da Bollinger inferior (' + spec.len + ', ' + spec.mult + ')';
    case 'breakout': return 'Rompimento da máxima de ' + spec.len + ' candles';
    default: return String(spec.type);
  }
}

// ------------------------------------------------------------------ avaliação

/**
 * Cria o avaliador de expressões sobre o modelo do script (variáveis, listas, funções do usuário).
 * Avalia sob demanda: só o que a regra de entrada usa é lido, então um indicador não coberto que só desenha no gráfico
 * não impede a leitura.
 */
function makeEvaluator(model) {
  const memo = new Map();
  const tupleMemo = new Map();
  const busy = new Set();
  let chain = 0;
  const used = [];
  const inputs = [];
  let line = 0;

  const bad = (construct, reason) => no(line ? `${construct} (linha ${line})` : construct, reason);
  const markUsed = (name) => { if (!used.includes(name)) used.push(name); };
  // Texto → árvore; o erro de leitura sai com a linha do comando
  function parse(text) {
    try { return parseExpr(text); } catch (e) {
      if (e instanceof Unsupported) bad(`expressão que o leitor não entende: ${e.construct}`, e.reason);
      throw e;
    }
  }

  function bind(n, names, aliases = {}) {
    const out = {};
    n.args.forEach((a, i) => {
      if (a.name) {
        const k = aliases[a.name] || a.name;
        if (!names.includes(k)) bad(`parâmetro ${a.name} de ${n.fn}`);
        out[k] = a.e;
      } else {
        if (i >= names.length) bad(`argumentos demais em ${n.fn}`);
        out[names[i]] = a.e;
      }
    });
    return out;
  }
  const needNum = (ast, what) => {
    if (!ast) bad(`${what} ausente`);
    const v = ev(ast, 0);
    if (v.k !== 'num') bad(`${what} que depende do preço`);
    return v.v;
  };
  const needPeriod = (ast, what) => {
    const v = needNum(ast, what);
    if (!Number.isInteger(v) || v < 1 || v > MAX_PERIOD) bad(`${what} fora de 1 a ${MAX_PERIOD}`, `O período ${numText(v)} não é um inteiro de 1 a ${MAX_PERIOD}.`);
    return v;
  };
  const needClose = (ast, fn) => {
    if (!ast) bad(`fonte de ${fn} ausente`);
    const v = ev(ast, 0);
    if (v.k !== 'src' || v.shift !== 0) bad(`${fn} sobre algo que não é a série de preço`);
    if (v.name !== 'close') bad(`${fn} sobre ${v.name}, só o fechamento (close) é coberto`);
  };

  const ALIAS = { series: 'source', src: 'source', source1: 'source', len: 'length', fastlength: 'fastlen', slowlength: 'slowlen', siglength: 'siglen', signallength: 'siglen', fast_length: 'fastlen', slow_length: 'slowlen', signal_length: 'siglen' };

  function ev(n, d) {
    if (d > 200) bad('expressão aninhada demais');
    switch (n.n) {
      case 'num': return { k: 'num', v: n.v };
      case 'bool': return { k: 'bool', v: n.v };
      case 'str': return bad('texto usado como valor');
      case 'id': return evId(n.name, d);
      case 'call': return evCall(n, d);
      case 'idx': return evIdx(n, d);
      case 'un': return evUn(n, d);
      case 'bin': return evBin(n, d);
      case 'tern': return bad('operador condicional ?:');
      default: return bad('expressão não reconhecida');
    }
  }

  function evId(name, d) {
    if (SRC_NAMES.has(name)) return { k: 'src', name, shift: 0 };
    if (name === 'barstate.isconfirmed') return { k: 'flag', name };
    if (model.defs.has(name)) {
      if (model.multi.has(name)) bad(`variável "${name}" definida mais de uma vez`);
      if (model.reassigned.has(name)) bad(`variável "${name}" reatribuída com := ou +=`);
      if (memo.has(name)) { markUsed(name); return memo.get(name); }
      if (busy.has(name)) bad(`variável "${name}" que depende de si mesma`);
      if (chain >= 40) bad('cadeia de variáveis longa demais');
      busy.add(name);
      chain++;
      const def = model.defs.get(name);
      const saved = line;
      line = def.line;
      let v;
      try { v = ev(parse(def.text), d + 1); } finally { busy.delete(name); chain--; line = saved; }
      memo.set(name, v);
      markUsed(name);
      if (def.isInput && (v.k === 'num' || v.k === 'src' || v.k === 'bool')) inputs.push(`${name} = ${v.k === 'src' ? v.name : String(v.v)}`);
      return v;
    }
    if (model.tuples.has(name)) {
      if (model.multi.has(name)) bad(`variável "${name}" definida mais de uma vez`);
      const t = model.tuples.get(name);
      let comps = tupleMemo.get(t.key);
      if (!comps) {
        const saved = line;
        line = t.line;
        try { comps = evTuple(t, d + 1); } finally { line = saved; }
        tupleMemo.set(t.key, comps);
      }
      markUsed(name);
      return comps[t.idx];
    }
    if (model.userFns.has(name)) bad(`função "${name}" definida no script`);
    if (name.startsWith('strategy.')) {
      return bad(`uso de ${name}`, 'A regra depende do estado da estratégia (posição, caixa, ordens). O motor testa cada gatilho como evento independente e não simula a posição aberta.');
    }
    return bad(name.includes('.') ? `uso de ${name}` : `nome sem definição no script: ${name}`);
  }

  function evTuple(t, d) {
    const call = parse(t.rhs);
    if (call.n !== 'call') bad('lista de variáveis que não recebe uma chamada');
    const f = call.fn.startsWith('ta.') ? call.fn.slice(3) : call.fn;
    if (f === 'macd') {
      const a = bind(call, ['source', 'fastlen', 'slowlen', 'siglen'], ALIAS);
      needClose(a.source, call.fn);
      const p = { src: 'close', fast: needPeriod(a.fastlen, 'período rápido do MACD'), slow: needPeriod(a.slowlen, 'período lento do MACD'), signal: needPeriod(a.siglen, 'período do sinal do MACD'), shift: 0 };
      return [{ k: 'ind', ind: 'macd_line', ...p }, { k: 'ind', ind: 'macd_signal', ...p }, { k: 'ind', ind: 'macd_hist', ...p }];
    }
    if (f === 'bb') {
      const a = bind(call, ['source', 'length', 'mult'], ALIAS);
      needClose(a.source, call.fn);
      const len = needPeriod(a.length, 'período da Bollinger');
      const mult = needNum(a.mult, 'multiplicador da Bollinger');
      if (!(mult > 0 && mult <= 10)) bad('multiplicador da Bollinger fora de 0 a 10');
      const p = { src: 'close', len, mult, shift: 0 };
      return [{ k: 'ind', ind: 'bb_basis', ...p }, { k: 'ind', ind: 'bb_upper', ...p }, { k: 'ind', ind: 'bb_lower', ...p }];
    }
    return bad(`lista de retornos de ${call.fn}`);
  }

  function evCall(n, d) {
    const raw = n.fn;
    if (model.userFns.has(raw)) bad(`função "${raw}" definida no script`);
    const f = raw.startsWith('ta.') ? raw.slice(3) : raw;
    if (f === 'rsi') {
      const a = bind(n, ['source', 'length'], ALIAS);
      needClose(a.source, raw);
      return { k: 'ind', ind: 'rsi', len: needPeriod(a.length, 'período do RSI'), src: 'close', shift: 0 };
    }
    if (f === 'sma' || f === 'ema') {
      const a = bind(n, ['source', 'length'], ALIAS);
      if (!a.source) bad(`fonte de ${raw} ausente`);
      const s = ev(a.source, d + 1);
      const len = needPeriod(a.length, `período da ${f.toUpperCase()}`);
      if (s.k === 'src' && s.shift === 0) {
        if (s.name !== 'close') bad(`${raw} sobre ${s.name}, só o fechamento (close) é coberto`);
        return { k: 'ind', ind: f, len, src: 'close', shift: 0 };
      }
      if (f === 'ema' && isInd(s, 'macd_line') && s.shift === 0) return { k: 'ind', ind: 'macd_signal', fast: s.fast, slow: s.slow, signal: len, src: 'close', shift: 0 };
      return bad(`${raw} sobre ${show(s)}`);
    }
    if (f === 'stdev') {
      const a = bind(n, ['source', 'length', 'biased'], ALIAS);
      needClose(a.source, raw);
      if (a.biased) { const b = ev(a.biased, d + 1); if (!(b.k === 'bool' && b.v === true)) bad('desvio-padrão amostral (biased=false)'); }
      return { k: 'ind', ind: 'stdev', len: needPeriod(a.length, 'período do desvio-padrão'), src: 'close', shift: 0 };
    }
    if (f === 'highest') {
      const one = n.args.length === 1 && !n.args[0].name;
      const a = one ? { length: n.args[0].e } : bind(n, ['source', 'length'], ALIAS);
      let src = 'high';
      if (a.source) {
        const s = ev(a.source, d + 1);
        if (s.k !== 'src' || s.shift !== 0) bad(`${raw} sobre algo que não é a série de preço`);
        src = s.name;
      }
      return { k: 'ind', ind: 'highest', len: needPeriod(a.length, 'período da máxima'), src, shift: 0 };
    }
    if (f === 'crossover' || f === 'crossunder') {
      if (n.args.length !== 2 || n.args.some((a) => a.name)) bad(`${raw} com argumentos que não são dois valores`);
      const l = ev(n.args[0].e, d + 1);
      const r = ev(n.args[1].e, d + 1);
      for (const x of [l, r]) if (!(isSeries(x) || x.k === 'num' || x.k === 'arith')) bad(`${raw} entre valores que não são séries`);
      if (l.k === 'num' && r.k === 'num') bad(`${raw} entre duas constantes`);
      return { k: 'cross', dir: f === 'crossover' ? 'over' : 'under', l, r };
    }
    if (f === 'cross') return bad('cruzamento nos dois sentidos (cross)');
    if (raw === 'input' || raw.startsWith('input.')) {
      const kind = raw === 'input' ? 'input' : raw.slice(6);
      // defval nomeado ou o primeiro argumento posicional; os demais (title, minval, group...) não influenciam o valor
      const first = n.args.find((x) => x.name === 'defval') || n.args.find((x) => !x.name);
      if (!first) bad(`${raw} sem valor padrão`);
      if (kind === 'int' || kind === 'float') { const v = ev(first.e, d + 1); if (v.k !== 'num') bad(`${raw} com valor padrão que não é número`); return v; }
      if (kind === 'bool') { const v = ev(first.e, d + 1); if (v.k !== 'bool') bad(`${raw} com valor padrão que não é verdadeiro/falso`); return v; }
      if (kind === 'source') { const v = ev(first.e, d + 1); if (v.k !== 'src') bad(`${raw} com valor padrão que não é uma série de preço`); return v; }
      if (kind === 'input') { const v = ev(first.e, d + 1); if (v.k === 'num' || v.k === 'bool' || v.k === 'src') return v; return bad('input() com valor padrão não numérico'); }
      return bad(`${raw}`);
    }
    if (f === 'macd' || f === 'bb') return bad(`${raw} fora de uma atribuição em lista [a, b, c]`);
    return bad(raw.startsWith('ta.') ? `indicador ${raw}` : `função ${raw}`);
  }

  function evIdx(n, d) {
    const base = ev(n.base, d + 1);
    const idx = ev(n.idx, d + 1);
    if (idx.k !== 'num' || !Number.isInteger(idx.v) || idx.v < 0 || idx.v > 100) bad('índice de histórico que não é um inteiro fixo');
    if (base.k === 'src' || base.k === 'ind') return { ...base, shift: base.shift + idx.v };
    if (base.k === 'num') return base;
    return bad('histórico ([n]) de condição ou de cálculo composto');
  }

  function evUn(n, d) {
    if (n.op === 'not') return bad('negação (not)');
    const x = ev(n.x, d + 1);
    if (x.k !== 'num') return bad('sinal sobre uma série');
    return { k: 'num', v: n.op === '-' ? -x.v : x.v };
  }

  function arith(op, l, r) {
    if (l.k === 'num' && r.k === 'num') {
      const v = op === '+' ? l.v + r.v : op === '-' ? l.v - r.v : op === '*' ? l.v * r.v : op === '/' ? l.v / r.v : l.v % r.v;
      if (!Number.isFinite(v)) bad('conta com resultado inválido');
      return { k: 'num', v };
    }
    if (op === '*') {
      const dev = isInd(l, 'stdev') ? l : isInd(r, 'stdev') ? r : null;
      const m = l.k === 'num' ? l : r.k === 'num' ? r : null;
      if (dev && m) return { k: 'arith', op, l: m, r: dev };
    }
    if (op === '-' && isInd(l, 'ema') && isInd(r, 'ema') && l.shift === 0 && r.shift === 0) return { k: 'ind', ind: 'macd_line', fast: l.len, slow: r.len, src: 'close', shift: 0 };
    if ((op === '-' || op === '+') && isInd(l, 'sma') && l.shift === 0 && r.k === 'arith' && r.op === '*' && r.r.len === l.len && r.r.shift === 0) {
      return { k: 'ind', ind: op === '-' ? 'bb_lower' : 'bb_upper', len: l.len, mult: r.l.v, src: 'close', shift: 0 };
    }
    return bad(`conta entre séries: ${show(l)} ${op} ${show(r)}`);
  }

  function evBin(n, d) {
    if (n.op === 'or') return bad('alternativas com "or"');
    const l = ev(n.l, d + 1);
    const r = ev(n.r, d + 1);
    if (n.op === '==' || n.op === '!=') return bad('igualdade (== ou !=)');
    if (n.op === 'and') {
      if (!isCond(l) || !isCond(r)) bad('"and" com valor que não é uma condição');
      return { k: 'and', items: [...(l.k === 'and' ? l.items : [l]), ...(r.k === 'and' ? r.items : [r])] };
    }
    if (n.op === '<' || n.op === '<=' || n.op === '>' || n.op === '>=') {
      for (const x of [l, r]) if (!(isSeries(x) || x.k === 'num')) bad(`comparação com ${x.k === 'arith' ? 'cálculo composto' : 'valor que não é série'}`);
      if (l.k === 'num' && r.k === 'num') {
        const v = n.op === '<' ? l.v < r.v : n.op === '<=' ? l.v <= r.v : n.op === '>' ? l.v > r.v : l.v >= r.v;
        return { k: 'bool', v };
      }
      return { k: 'cmp', op: n.op, l, r };
    }
    return arith(n.op, l, r);
  }

  return { ev, parse, used, inputs, setLine: (n) => { line = n; } };
}

// ------------------------------------------------------------------ de condição para regra do motor

const FLIP = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' };

/** Junta duas comparações que formam um cruzamento escrito à mão: `x[1] <= y[1] and x > y`. */
function pairCrossings(items) {
  const list = items.slice();
  const tryPair = (a, b) => {
    const sameO = sig(a.l) === sig(b.l) && sig(a.r) === sig(b.r);
    const swapO = sig(a.l) === sig(b.r) && sig(a.r) === sig(b.l);
    if (!sameO && !swapO) return null;
    const bop = swapO ? FLIP[b.op] : b.op;
    const bl = swapO ? b.r : b.l;
    const br = swapO ? b.l : b.r;
    const lagged = (x, y) => (x.k === 'num' && y.k === 'num' && x.v === y.v) || (isSeries(x) && isSeries(y) && y.shift === x.shift + 1);
    if (!lagged(a.l, bl) || !lagged(a.r, br)) return null;
    if ((a.op === '>' || a.op === '>=') && (bop === '<=' || bop === '<')) return { k: 'cross', dir: 'over', l: a.l, r: a.r };
    if ((a.op === '<' || a.op === '<=') && (bop === '>=' || bop === '>')) return { k: 'cross', dir: 'under', l: a.l, r: a.r };
    return null;
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i === j || list[i].k !== 'cmp' || list[j].k !== 'cmp') continue;
      const c = tryPair(list[i], list[j]);
      if (c) {
        const keep = list.filter((_, idx) => idx !== i && idx !== j);
        keep.splice(Math.min(i, j), 0, c);
        return pairCrossings(keep);
      }
    }
  }
  return list;
}

const MA_KIND = { sma: 'sma', ema: 'ema' };

/** Cruzamento → regra do motor. */
function ruleFromCross(c) {
  let { dir, l, r } = c;
  if (l.k === 'num' && isSeries(r)) { [l, r] = [r, l]; dir = dir === 'over' ? 'under' : 'over'; }
  if (l.k === 'arith' || r.k === 'arith') no('cruzamento com cálculo composto');
  const what = `${dir === 'over' ? 'cruzamento para cima' : 'cruzamento para baixo'} entre ${show(l)} e ${show(r)}`;
  if (isSeries(l) && r.k === 'num') {
    if (isInd(l, 'rsi') && l.shift === 0) {
      return dir === 'over'
        ? { spec: { type: 'rsi_cross_up', len: l.len, level: r.v }, form: 'cross' }
        : { spec: { type: 'rsi_below', len: l.len, level: r.v }, form: 'cross' };
    }
    if (isInd(l, 'macd_hist') && l.shift === 0 && r.v === 0 && dir === 'over') return { spec: { type: 'macd_cross_up', fast: l.fast, slow: l.slow, signal: l.signal }, form: 'cross' };
    return no(what);
  }
  if (isSeries(l) && isSeries(r)) {
    if (dir === 'over' && isInd(l, 'macd_line') && isInd(r, 'macd_signal') && l.shift === 0 && r.shift === 0 && l.fast === r.fast && l.slow === r.slow && (l.signal === undefined || l.signal === r.signal)) {
      return { spec: { type: 'macd_cross_up', fast: r.fast, slow: r.slow, signal: r.signal }, form: 'cross' };
    }
    if (dir === 'over' && MA_KIND[l.ind] && MA_KIND[r.ind] && l.shift === 0 && r.shift === 0) {
      if (l.ind !== r.ind) no(`${what} (médias de tipos diferentes)`, 'O motor cruza médias do mesmo tipo (duas SMA ou duas EMA).');
      return { spec: { type: 'ma_cross_up', kind: l.ind, fast: l.len, slow: r.len }, form: 'cross' };
    }
    if (dir === 'over' && l.k === 'src' && l.name === 'close' && l.shift === 0 && MA_KIND[r.ind] && r.shift === 0) return { spec: { type: 'price_cross_ma_up', kind: r.ind, len: r.len }, form: 'cross' };
    if (dir === 'under' && l.k === 'src' && l.name === 'close' && l.shift === 0 && isInd(r, 'bb_lower') && r.shift === 0) return { spec: { type: 'bb_lower', len: r.len, mult: r.mult }, form: 'cross' };
    if (dir === 'over' && l.k === 'src' && l.name === 'close' && l.shift === 0 && isInd(r, 'highest')) {
      if (r.src !== 'high') no(`${what} (máxima de ${r.src})`, 'O motor testa o rompimento da máxima dos candles (high), não da máxima dos fechamentos.');
      if (r.shift !== 1) no(`${what} (máxima sem [1])`, 'O rompimento é medido contra a máxima dos N candles anteriores: ta.highest(high, N)[1].');
      return { spec: { type: 'breakout', len: r.len }, form: 'cross' };
    }
  }
  return no(what);
}

/** Comparação de estado (vale em todo candle) → regra do motor; o motor conta o primeiro candle de cada sequência. */
function ruleFromLevel(c) {
  let { op, l, r } = c;
  if (l.k === 'num' && isSeries(r)) { [l, r] = [r, l]; op = FLIP[op]; }
  if (isInd(l, 'rsi') && l.shift === 0 && r.k === 'num' && (op === '<' || op === '<=')) return { spec: { type: 'rsi_below', len: l.len, level: r.v }, form: 'state' };
  if (l.k === 'src' && l.name === 'close' && l.shift === 0 && isInd(r, 'bb_lower') && r.shift === 0 && (op === '<' || op === '<=')) return { spec: { type: 'bb_lower', len: r.len, mult: r.mult }, form: 'state' };
  if (l.k === 'src' && l.name === 'close' && l.shift === 0 && isInd(r, 'highest') && (op === '>' || op === '>=')) {
    if (r.src !== 'high') no(`${show(c)} (máxima de ${r.src})`, 'O motor testa o rompimento da máxima dos candles (high), não da máxima dos fechamentos.');
    if (r.shift !== 1) no(`${show(c)} (máxima sem [1])`, 'O rompimento é medido contra a máxima dos N candles anteriores: ta.highest(high, N)[1].');
    return { spec: { type: 'breakout', len: r.len }, form: 'state' };
  }
  return no(`condição de estado: ${show(c)}`, 'Uma condição que vale em vários candles seguidos não é um cruzamento; o motor testa eventos.');
}

/** Faixas aceitas. Fora delas o motor roda, mas o resultado não faria sentido (ou o parâmetro não é o do script). */
function validateSpec(spec) {
  const int = (v, what) => { if (!Number.isInteger(v) || v < 1 || v > MAX_PERIOD) no(`${what} fora de 1 a ${MAX_PERIOD}`); };
  if (spec.type === 'rsi_cross_up' || spec.type === 'rsi_below') {
    int(spec.len, 'período do RSI');
    if (!(spec.level > 0 && spec.level < 100)) no('nível do RSI fora de 0 a 100');
  } else if (spec.type === 'macd_cross_up') {
    int(spec.fast, 'período rápido do MACD'); int(spec.slow, 'período lento do MACD'); int(spec.signal, 'período do sinal do MACD');
  } else if (spec.type === 'ma_cross_up') {
    int(spec.fast, 'período da média'); int(spec.slow, 'período da média');
    if (spec.fast === spec.slow) no('duas médias com o mesmo período', 'Duas médias iguais nunca se cruzam.');
  } else if (spec.type === 'price_cross_ma_up') int(spec.len, 'período da média');
  else if (spec.type === 'bb_lower') {
    int(spec.len, 'período da Bollinger');
    if (!(spec.mult > 0 && spec.mult <= 10)) no('multiplicador da Bollinger fora de 0 a 10');
  } else if (spec.type === 'breakout') int(spec.len, 'período da máxima');
}

/** Frases do que foi entendido sobre o gatilho. */
function triggerText(spec, form) {
  switch (spec.type) {
    case 'rsi_cross_up': return [`Gatilho: o candle em que o RSI passa de abaixo para acima de ${spec.level}.`, 'Se o RSI cair exatamente sobre o nível, vale a definição do motor (anterior abaixo, atual igual ou acima).'];
    case 'rsi_below':
      return form === 'state'
        ? [`Gatilho: o primeiro candle em que o RSI fica abaixo de ${spec.level}.`, 'O script vale em todo candle abaixo do nível; o motor conta só o primeiro de cada sequência.']
        : [`Gatilho: o candle em que o RSI passa de acima para abaixo de ${spec.level}.`];
    case 'macd_cross_up': return ['Gatilho: o candle em que a linha MACD passa de baixo para cima da linha de sinal.'];
    case 'ma_cross_up': return [`Gatilho: o candle em que a ${spec.kind.toUpperCase()} ${spec.fast} passa de baixo para cima da ${spec.kind.toUpperCase()} ${spec.slow}.`];
    case 'price_cross_ma_up': return [`Gatilho: o candle em que o fechamento passa de baixo para cima da ${spec.kind.toUpperCase()} ${spec.len}.`];
    case 'bb_lower':
      return form === 'state'
        ? ['Gatilho: o primeiro candle em que o fechamento fica abaixo da banda inferior de Bollinger.', 'O script vale em todo candle abaixo da banda; o motor conta só o primeiro de cada sequência.']
        : ['Gatilho: o primeiro candle em que o fechamento fica abaixo da banda inferior de Bollinger.'];
    case 'breakout':
      return form === 'state'
        ? [`Gatilho: o primeiro candle em que o fechamento supera a máxima dos ${spec.len} candles anteriores.`, 'O script vale em todo candle acima da máxima; o motor conta só o primeiro de cada sequência.']
        : [`Gatilho: o primeiro candle em que o fechamento supera a máxima dos ${spec.len} candles anteriores.`];
    default: return [];
  }
}

// ------------------------------------------------------------------ varredura do script

const ENTRY_TOKEN = /(?:^|[^\w.])(strategy\.(?:entry|order)|alertcondition|plotshape|plotchar|alert)\s*\(/;
const ENTRY_START = /^(strategy\.(?:entry|order)|alertcondition|plotshape|plotchar|alert)\s*\(/;
const DISPLAY_RE = /^(?:plot|plotarrow|plotbar|plotcandle|hline|bgcolor|barcolor|fill|label|line|box|table|linefill|polyline|log|chart)(?:\.|$)/;
const EXIT_NAMES = new Set(['strategy.exit', 'strategy.close', 'strategy.close_all', 'strategy.cancel', 'strategy.cancel_all']);
const DECL_NAMES = new Set(['indicator', 'study', 'strategy', 'library']);
const TIER = { 'strategy.entry': 1, 'strategy.order': 1, alertcondition: 2, alert: 2, plotshape: 3, plotchar: 3 };
const LETTER = 'a-z' + ch(0xe0) + '-' + ch(0xff);
const SELL_RE = new RegExp('(?:^|[^' + LETTER + '])(?:sell|short|venda|vender|bear|bearish)(?![' + LETTER + '])', 'i');
const BUY_RE = new RegExp('(?:^|[^' + LETTER + '])(?:buy|long|compra|comprar|bull|bullish)(?![' + LETTER + '])', 'i');
const RE_TUPLE = /^\[\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*\]\s*=\s*(.+)$/;
const RE_ASSIGN = /^(?:(?:var|varip)\s+)?(?:(?:const|input|simple|series)\s+)?(?:(?:int|float|bool|string|color)\s+)?([A-Za-z_]\w*)\s*(:=|\+=|-=|\*=|\/=|%=|=(?!=))\s*(.+)$/;
const RE_FUNC = /^([A-Za-z_]\w*)\s*\(([^()]*)\)\s*=>\s*(.*)$/;
const RE_IF = /^if(?![A-Za-z0-9_])\s*(.*)$/;
const RE_ELSE = /^else(?![A-Za-z0-9_])/;
const RE_LOOP = /^(?:for|while|switch)(?![A-Za-z0-9_])|^(?:method|type|enum)\s+[A-Za-z_]/;
const CAPITAL_ARGS = ['initial_capital', 'commission_value', 'commission_type', 'default_qty_type', 'default_qty_value', 'pyramiding', 'slippage', 'margin_long', 'margin_short', 'currency', 'calc_on_every_tick', 'process_orders_on_close'];

function hintDirection(text, extra) {
  const norm = `${text} ${extra || ''}`.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' ');
  const sell = SELL_RE.test(norm) || /down|abovebar/i.test(extra || '');
  const buy = BUY_RE.test(norm) || /(?:^|[^a-z])(?:\w*up|belowbar)(?![a-z])/i.test(extra || '');
  if (sell && !buy) return 'short';
  if (buy && !sell) return 'long';
  return 'unspecified';
}

/** Percorre os comandos e monta o modelo do script. */
function scan(stmts) {
  const model = { defs: new Map(), multi: new Set(), reassigned: new Set(), tuples: new Map(), userFns: new Set() };
  const info = { entries: [], hidden: [], display: new Set(), exits: new Set(), misc: new Set(), decl: null, declArgs: [], imports: 0, library: false, statements: 0 };
  const stack = [];
  for (const st of stmts) {
    info.statements++;
    while (stack.length && stack[stack.length - 1].indent >= st.indent) stack.pop();
    const text = st.text;
    const skipping = stack.some((b) => b.kind === 'skip');
    const inElse = stack.some((b) => b.kind === 'else');

    if (skipping) {
      const m = ENTRY_TOKEN.exec(text);
      if (m) info.hidden.push(`${m[1]} dentro de laço, função ou switch (linha ${st.line})`);
      continue;
    }

    let m;
    if ((m = RE_IF.exec(text))) {
      stack.push({ indent: st.indent, kind: 'if', cond: m[1], line: st.line });
      continue;
    }
    if (RE_ELSE.test(text)) {
      stack.push({ indent: st.indent, kind: 'else', line: st.line });
      continue;
    }
    if (RE_LOOP.test(text)) {
      stack.push({ indent: st.indent, kind: 'skip', line: st.line });
      const mm = ENTRY_TOKEN.exec(text);
      if (mm) info.hidden.push(`${mm[1]} dentro de laço, função ou switch (linha ${st.line})`);
      continue;
    }
    if ((m = RE_FUNC.exec(text)) && !DECL_NAMES.has(m[1])) {
      model.userFns.add(m[1]);
      stack.push({ indent: st.indent, kind: 'skip', line: st.line });
      const mm = ENTRY_TOKEN.exec(m[3]);
      if (mm) info.hidden.push(`${mm[1]} dentro de função (linha ${st.line})`);
      continue;
    }
    if (/^import(?![A-Za-z0-9_])/.test(text)) { info.imports++; continue; }
    if ((m = RE_TUPLE.exec(text))) {
      m[1].split(',').map((s) => s.trim()).forEach((name, idx) => {
        if (name === '_') return;
        if (model.defs.has(name) || model.tuples.has(name)) model.multi.add(name);
        model.tuples.set(name, { key: `L${st.line}`, rhs: m[2], idx, line: st.line });
      });
      continue;
    }
    if ((m = RE_ASSIGN.exec(text))) {
      const [, name, op, rhs] = m;
      if (op !== '=') model.reassigned.add(name);
      else if (model.defs.has(name) || model.tuples.has(name)) model.multi.add(name);
      else model.defs.set(name, { text: rhs, line: st.line, isInput: /^input(?:\.\w+)?\s*\(/.test(rhs) });
      continue;
    }
    const call = parseCall(text);
    if (!call) {
      const mm = ENTRY_START.exec(text);
      if (mm) info.hidden.push(`${mm[1]} com parênteses desencontrados (linha ${st.line})`);
      continue; // expressão solta: sem efeito na regra
    }
    const { name } = call;
    if (DECL_NAMES.has(name)) {
      if (name === 'library') info.library = true;
      else { info.decl = name; info.declArgs = call.args.map((a) => a.name).filter(Boolean); }
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(TIER, name)) {
      if (inElse) { info.hidden.push(`${name} dentro de else (linha ${st.line})`); continue; }
      info.entries.push({ fn: name, args: call.args, conds: stack.filter((b) => b.kind === 'if').map((b) => b.cond), line: st.line });
      continue;
    }
    if (EXIT_NAMES.has(name)) { info.exits.add(name); continue; }
    if (DISPLAY_RE.test(name)) { info.display.add(name.split('.')[0]); continue; }
    if (info.misc.size < 20) info.misc.add(name);
  }
  return { model, info };
}

/** Condição do ponto de entrada (texto) e direção. Lança `Unsupported` se o ponto de entrada tem algo fora do que é coberto. */
function entryParts(e) {
  const named = (k) => { const a = e.args.find((x) => x.name === k); return a ? a.text : null; };
  const pos = (i) => { const a = e.args[i]; return a && !a.name ? a.text : null; };
  const pick = (k, i) => (named(k) !== null ? named(k) : pos(i));
  const strs = (t) => { const out = []; if (t) t.replace(/"([^"]*)"|'([^']*)'/g, (_, a, b) => { out.push(a || b || ''); return ''; }); return out.join(' '); };
  let condText = null;
  let dir = 'unspecified';
  let declared = false;
  let when = null;
  let hint = '';
  let style = '';
  if (e.fn === 'strategy.order') no(`strategy.order (linha ${e.line})`, 'strategy.order não é um ponto de entrada coberto.');
  if (e.fn === 'strategy.entry') {
    const d = (pick('direction', 1) || '').trim();
    declared = true;
    if (d === 'strategy.long') dir = 'long';
    else if (d === 'strategy.short') dir = 'short';
    else no(`direção de strategy.entry não reconhecida (linha ${e.line})`, 'A direção de strategy.entry precisa ser strategy.long ou strategy.short.');
    for (const [k, i] of [['limit', 3], ['stop', 4]]) {
      const v = pick(k, i);
      if (v !== null && v.trim() !== 'na' && v.trim() !== '') no(`ordem ${k} de entrada (linha ${e.line})`, 'O motor assume entrada no fechamento do candle do gatilho; ordens com preço limite ou de parada mudam essa entrada.');
    }
    when = named('when');
    hint = strs(pick('id', 0));
  } else if (e.fn === 'alertcondition') {
    condText = pick('condition', 0);
    hint = `${strs(pick('title', 1))} ${strs(pick('message', 2))}`;
  } else if (e.fn === 'plotshape' || e.fn === 'plotchar') {
    condText = pick('series', 0);
    hint = strs(pick('title', 1));
    style = `${named('style') || (e.fn === 'plotshape' ? pos(2) : '') || ''} ${named('location') || pos(3) || ''}`;
  } else if (e.fn === 'alert') {
    hint = strs(pick('message', 0));
  }
  const conds = e.conds.slice();
  if (when !== null) conds.push(when);
  if (condText !== null) conds.push(condText);
  if (dir === 'unspecified') {
    const idName = condText && /^[A-Za-z_]\w*$/.test(condText.trim()) ? condText.trim() : '';
    dir = hintDirection(`${hint} ${idName}`, style);
  }
  return { conds, dir, declared };
}

// ------------------------------------------------------------------ leitura

const refuse = (reason, unsupported) => ({ ok: false, reason, unsupported: unsupported.slice(0, 12), supported: SUPPORTED_PATTERNS.slice() });

/**
 * Lê um script Pine e devolve a regra de entrada no formato do motor.
 * @param {unknown} code texto do script
 * @returns {{ ok: true, spec: object, understood: string[], ignored: string[], direction: 'long' }
 *   | { ok: false, reason: string, unsupported: string[], supported: string[] }}
 */
export function readPine(code) {
  try {
    return read(code);
  } catch (e) {
    if (e instanceof Unsupported) return refuse(e.reason || 'A regra de entrada usa algo que o motor não testa.', [e.construct]);
    return refuse('O leitor não conseguiu interpretar este texto como um script Pine com segurança.', ['texto fora do formato de um script Pine']);
  }
}

function read(code) {
  if (typeof code !== 'string') return refuse('Nenhum script informado.', []);
  if (code.length > MAX_SCRIPT_CHARS) return refuse(`O script tem ${fmtInt(code.length)} caracteres e o limite desta leitura é ${fmtInt(MAX_SCRIPT_CHARS)}.`, ['script maior que o limite']);
  const src = normalizeSource(code);
  if (!/\S/.test(src)) return refuse('Nenhum script informado.', []);

  const vm = /^[ ]*\/\/[ ]*@version[ ]*=[ ]*(\d+)/m.exec(src);
  const version = vm ? parseInt(vm[1], 10) : null;
  if (version !== null && (version < 4 || version > 6)) {
    return refuse(`O script declara a versão ${version} do Pine. O leitor cobre as versões 4, 5 e 6.`, [`//@version=${version}`]);
  }

  const lines = src.split('\n').map(stripComment);
  if (!lines.some((l) => /\S/.test(l))) return refuse('O texto só tem comentários, sem nenhum comando Pine.', []);

  const stmts = logicalLines(lines);
  const { model, info } = scan(stmts);
  if (info.library) return refuse('O texto é uma biblioteca Pine (library), não um indicador ou estratégia com ponto de entrada.', ['library()']);
  if (!info.entries.length && !info.hidden.length) {
    const recognised = info.decl || version !== null || info.display.size || /(?:^|[^\w.])(?:ta\.\w+|rsi|sma|ema|macd|crossover|crossunder)\s*\(/.test(src);
    return refuse(
      recognised
        ? 'Não encontrei um ponto de entrada. O leitor procura strategy.entry, alertcondition, alert dentro de if, plotshape ou plotchar.'
        : 'O texto não parece um script Pine: nenhuma declaração, atribuição ou ponto de entrada foi reconhecido.',
      []
    );
  }
  if (info.hidden.length) return refuse('Há pontos de entrada em estruturas que o leitor não acompanha (laço, função, switch ou else).', info.hidden);

  // Prioridade entre os portadores da regra: ordens de estratégia > alertas > marcações no gráfico.
  const tier = Math.min(...info.entries.map((e) => TIER[e.fn]));
  const chosen = info.entries.filter((e) => TIER[e.fn] === tier);
  const lower = info.entries.filter((e) => TIER[e.fn] > tier);

  const evalr = makeEvaluator(model);
  const longs = [];
  const shorts = [];
  const failures = [];
  const flags = new Set();
  for (const e of chosen) {
    try {
      const { conds, dir, declared } = entryParts(e);
      if (dir === 'short') { shorts.push(e); continue; }
      evalr.setLine(e.line);
      if (!conds.length) no(`${e.fn} sem condição (linha ${e.line})`, 'Um ponto de entrada sem condição entra em todo candle; não há regra para testar.');
      let items = [];
      for (const c of conds) {
        const v = evalr.ev(evalr.parse(c), 0);
        if (!isCond(v)) no(`condição que não é verdadeira/falsa (linha ${e.line})`);
        items.push(...(v.k === 'and' ? v.items : [v]));
      }
      const seen = new Set();
      items = items.filter((x) => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; });
      const rest = [];
      for (const x of items) {
        if (x.k === 'flag') flags.add(x.name);
        else if (x.k === 'bool' && x.v === true) continue;
        else if (x.k === 'bool') no(`condição sempre falsa (linha ${e.line})`);
        else rest.push(x);
      }
      if (!rest.length) no(`condição sempre verdadeira (linha ${e.line})`, 'Uma condição sempre verdadeira entra em todo candle; não há regra para testar.');
      const paired = pairCrossings(rest);
      if (paired.length > 1) {
        no(`condições combinadas com "and": ${paired.map(show).join('; ')} (linha ${e.line})`, 'A regra combina mais de uma condição. O motor testa uma condição por vez; testar só uma delas seria testar outra regra.');
      }
      const only = paired[0];
      const rule = only.k === 'cross' ? ruleFromCross(only) : only.k === 'cmp' ? ruleFromLevel(only) : no(`condição não reconhecida (linha ${e.line})`);
      validateSpec(rule.spec);
      longs.push({ e, dir, declared, ...rule });
    } catch (err) {
      if (!(err instanceof Unsupported)) throw err;
      failures.push(err);
    }
  }
  if (failures.length) {
    const first = failures.find((f) => f.reason) || failures[0];
    return refuse(first.reason || 'A regra de entrada usa algo que o motor não testa. Testar uma versão aproximada seria testar outra regra, por isso o Argos não a executa.', failures.map((f) => f.construct));
  }
  if (!longs.length) {
    return refuse('O script só descreve entradas de venda (short). O Argos testa apenas compras teóricas (long).', shorts.map((e) => `${e.fn} de venda (linha ${e.line})`));
  }
  const distinct = [];
  for (const r of longs) if (!distinct.some((d) => JSON.stringify(d.spec) === JSON.stringify(r.spec))) distinct.push(r);
  if (distinct.length > 1) {
    return refuse('O script tem mais de uma regra de entrada de compra. O Argos testa uma regra por vez, para que cada teste entre na conta da sessão.', distinct.map((r) => `${describeSpec(r.spec)} (linha ${r.e.line})`));
  }

  // ---- sucesso
  const win = distinct[0];
  const spec = win.spec;
  const understood = [];
  understood.push(version === null ? 'Versão do Pine não declarada: lida pela sintaxe da v5.' : `Pine v${version}${info.decl ? `, ${info.decl === 'strategy' ? 'estratégia' : 'indicador'}` : ''}.`);
  const carrier = { 'strategy.entry': 'strategy.entry (compra)', alertcondition: 'alertcondition()', alert: 'alert() dentro de if', plotshape: 'plotshape()', plotchar: 'plotchar()' }[win.e.fn];
  understood.push(`Ponto de entrada: ${carrier}.`);
  understood.push(`Regra: ${describeSpec(spec)}.`);
  understood.push(...triggerText(spec, win.form));
  if (evalr.inputs.length) understood.push(`Valores padrão lidos de input: ${evalr.inputs.join(', ')}.`);
  const vars = evalr.used.filter((n) => !evalr.inputs.some((s) => s.startsWith(`${n} = `)));
  if (vars.length) understood.push(`Variáveis intermediárias resolvidas: ${vars.slice(0, 8).join(', ')}${vars.length > 8 ? ` e mais ${vars.length - 8}` : ''}.`);
  understood.push(win.declared
    ? 'Direção: compra teórica (long), como declarada em strategy.entry.'
    : win.dir === 'long'
      ? 'Direção: compra teórica (long), pelo que o script indica (nome, título ou estilo da marcação).'
      : 'Direção: compra teórica (long). O script não declara a direção; o motor testa o que acontece depois do gatilho.');
  understood.push('Entrada teórica no fechamento do candle do gatilho.');

  const ignored = [];
  if (info.decl) ignored.push(`Declaração ${info.decl}(): título, overlay e demais argumentos.`);
  if (info.decl === 'strategy' && info.declArgs.some((a) => CAPITAL_ARGS.includes(a))) ignored.push('Capital, comissão e tamanho de ordem da estratégia: o teste mede a regra de entrada, não o resultado financeiro.');
  if (info.display.size) ignored.push(`Desenhos e marcações no gráfico: ${[...info.display].join(', ')}.`);
  if (info.exits.size) ignored.push(`Saídas do script (${[...info.exits].join(', ')}): o teste usa o alvo, o stop e o prazo definidos na tela.`);
  if (shorts.length) ignored.push(`Entradas de venda (short) ${plural(shorts.length, 'na linha', 'nas linhas')} ${shorts.map((e) => e.line).join(', ')}: o Argos avalia apenas compras teóricas.`);
  if (lower.length) ignored.push(`${[...new Set(lower.map((e) => e.fn))].join(', ')}: ${plural(lower.length, 'marcação', 'marcações')} sem uso como entrada, porque o script já tem ${[...new Set(chosen.map((e) => e.fn))].join(' e ')}.`);
  if (flags.size) ignored.push(`${[...flags].join(', ')}: o motor só usa candles fechados.`);
  if (info.imports) ignored.push('Importação de biblioteca, sem uso na regra.');
  const unusedVars = [...model.defs.keys(), ...model.tuples.keys()].filter((n) => !evalr.used.includes(n));
  if (unusedVars.length) ignored.push(`Variáveis que não entram na regra: ${unusedVars.slice(0, 8).join(', ')}${unusedVars.length > 8 ? ` e mais ${unusedVars.length - 8}` : ''}.`);
  if (info.misc.size) ignored.push(`Outras chamadas sem efeito na regra de entrada: ${[...info.misc].slice(0, 8).join(', ')}.`);

  return { ok: true, spec, understood, ignored, direction: 'long' };
}
