// Estado da análise na URL (web/js/url-state.js): ler e montar os parâmetros da pergunta da tela Ao vivo.
// O módulo é um script clássico do navegador; aqui ele roda como o navegador o faria (new Function com `window`).
// Casos: válidos, inválidos (valor ruim é ignorado, nunca quebra) e hostis (injeção, protótipo, tamanho, tipos errados).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'web', 'js', 'url-state.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const { parse, build } = win.ArgosUrlState;

const FULL = '?symbol=ETHUSDT&tf=1d&mode=pct&tgt=2.5&stp=1&hold=20&win=365&setup=RSI_OVERSOLD&regime=BULL_TREND';
const FULL_VIEW = { sym: 'ETHUSDT', tf: '1d', cfg: { mode: 'pct', tgt: 2.5, stp: 1, hold: 20 }, win: 365, setup: 'RSI_OVERSOLD', regime: 'BULL_TREND' };

test('url-state: o módulo expõe só parse e build em window.ArgosUrlState', () => {
  assert.deepEqual(Object.keys(win.ArgosUrlState).sort(), ['build', 'parse']);
});

// ---------------------------------------------------------------- válidos
test('url-state: lê a pergunta completa', () => {
  assert.deepEqual(parse(FULL), FULL_VIEW);
});

test('url-state: aceita sem "?", com #hash de navegação e normaliza maiúsculas e minúsculas', () => {
  assert.deepEqual(parse(FULL.slice(1) + '#ao-vivo'), FULL_VIEW);
  assert.deepEqual(parse('?symbol=btcusdt&tf=1D&mode=ATR&setup=macd_cross&regime=bull_trend'), { sym: 'BTCUSDT', tf: '1d', cfg: { mode: 'atr' }, setup: 'MACD_CROSS', regime: 'BULL_TREND' });
});

test('url-state: pergunta parcial: só o que veio, e a regra de saída vem por campo', () => {
  assert.deepEqual(parse('?symbol=SOLUSDT'), { sym: 'SOLUSDT' });
  assert.deepEqual(parse('?tgt=3&hold=8'), { cfg: { tgt: 3, hold: 8 } });
  assert.deepEqual(parse(''), {});
  assert.deepEqual(parse('?'), {});
});

test('url-state: janela vazia ou "all" é a série inteira (ausente); recorte ALL e CURRENT valem', () => {
  assert.deepEqual(parse('?win=all'), {});
  assert.deepEqual(parse('?win='), {});
  assert.deepEqual(parse('?regime=ALL'), { regime: 'ALL' });
  assert.deepEqual(parse('?regime=current'), { regime: 'CURRENT' });
});

test('url-state: limites da regra de saída e da janela', () => {
  assert.deepEqual(parse('?tgt=0.2&stp=20&hold=2&win=30'), { cfg: { tgt: 0.2, stp: 20, hold: 2 }, win: 30 });
  assert.deepEqual(parse('?hold=60&win=5000&tgt=0.1234'), { cfg: { hold: 60 }, win: 5000 }, 'tgt abaixo de 0,2 é ignorado');
  assert.deepEqual(parse('?tgt=0.2345&stp=19.9999'), { cfg: { tgt: 0.2345, stp: 19.9999 } });
});

test('url-state: listas fechadas do chamador (setups e regimes do motor)', () => {
  const opts = { setups: ['RSI_OVERSOLD', 'HAMMER'], regimes: ['ALL', 'BULL_TREND'] };
  assert.deepEqual(parse('?setup=hammer&regime=BULL_TREND', opts), { setup: 'HAMMER', regime: 'BULL_TREND' });
  assert.deepEqual(parse('?setup=GOLDEN_CROSS&regime=BEAR_TREND', opts), {});
});

test('url-state: monta a consulta na ordem fixa e ela volta igual ao ler', () => {
  assert.equal(build(FULL_VIEW), FULL.slice(1));
  assert.deepEqual(parse('?' + build(FULL_VIEW)), FULL_VIEW);
  const mid = { sym: 'BTCUSDT', tf: '4h', cfg: { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, setup: 'MACD_CROSS' };
  assert.equal(build(mid), 'symbol=BTCUSDT&tf=4h&mode=atr&tgt=2&stp=1&hold=12&setup=MACD_CROSS');
  assert.deepEqual(parse('?' + build(mid)), mid);
});

test('url-state: recorte ALL, janela nula e campos ausentes não entram na consulta', () => {
  assert.equal(build({ sym: 'BTCUSDT', tf: '1h', regime: 'ALL', win: null }), 'symbol=BTCUSDT&tf=1h');
  assert.equal(build({ sym: 'BTCUSDT', tf: '1h', regime: 'CURRENT' }), 'symbol=BTCUSDT&tf=1h&regime=CURRENT');
});

test('url-state: arredonda número do estado a 4 casas (sem ruído de ponto flutuante)', () => {
  assert.equal(build({ cfg: { tgt: 0.1 + 0.2, stp: 1.5 } }), 'tgt=0.3&stp=1.5');
});

test('url-state: build mantém parâmetros alheios e troca os nossos', () => {
  const keep = '?utm_source=news&symbol=SOLUSDT&tf=1d&ref=a%20b';
  const qs = build({ sym: 'BTCUSDT', tf: '4h' }, { keep });
  assert.equal(qs, 'symbol=BTCUSDT&tf=4h&utm_source=news&ref=a+b');
  assert.deepEqual(parse('?' + qs), { sym: 'BTCUSDT', tf: '4h' });
  assert.equal(build({ sym: 'BTCUSDT' }, { keep: '?x=1#ao-vivo' }), 'symbol=BTCUSDT&x=1');
});

// -------------------------------------------------------------- inválidos
test('url-state: valor inválido é ignorado, campo a campo, sem afetar os válidos', () => {
  const r = parse('?symbol=DOGEUSDT&tf=15m&mode=abs&tgt=abc&stp=-1&hold=1&win=29&setup=1ABC&regime=BANANA');
  assert.deepEqual(r, {});
  assert.deepEqual(parse('?symbol=BTCUSDT&tf=15m&tgt=2&stp=0&hold=61'), { sym: 'BTCUSDT', cfg: { tgt: 2 } });
});

test('url-state: números fora do formato ou do intervalo', () => {
  for (const bad of ['0', '0.0', '0.1', '20.0001', '21', '100', '-2', '+2', '1e1', '1e3', '0x10', '2,5', ' 2', '2 ', '2.', '.5', 'NaN', 'Infinity', '-Infinity', '2.12345', '007x', '']) {
    assert.deepEqual(parse('?tgt=' + encodeURIComponent(bad)), {}, `tgt=${JSON.stringify(bad)}`);
  }
  for (const bad of ['1', '61', '2.5', '-3', '12abc', '1e1', '0x0C', 'abc', '', '012345']) {
    assert.deepEqual(parse('?hold=' + encodeURIComponent(bad)), {}, `hold=${JSON.stringify(bad)}`);
  }
  for (const bad of ['0', '29', '5001', '99999', '3.5', '-30', 'abc', '1e3']) {
    assert.deepEqual(parse('?win=' + encodeURIComponent(bad)), {}, `win=${JSON.stringify(bad)}`);
  }
});

test('url-state: id de setup fora do formato', () => {
  for (const bad of ['A', '1ABC', 'ab cd', 'RSI-OVERSOLD', 'RSI.OVERSOLD', '../etc/passwd', 'X'.repeat(41), '', '%00']) {
    assert.deepEqual(parse('?setup=' + encodeURIComponent(bad)), {}, `setup=${JSON.stringify(bad)}`);
  }
});

test('url-state: parâmetro repetido vale o primeiro', () => {
  assert.deepEqual(parse('?symbol=ETHUSDT&symbol=SOLUSDT'), { sym: 'ETHUSDT' });
  assert.deepEqual(parse('?symbol=lixo&symbol=SOLUSDT'), {});
});

test('url-state: build ignora valor inválido do estado', () => {
  assert.equal(build({ sym: 'XRPUSDT', tf: '3h', cfg: { mode: 'x', tgt: NaN, stp: Infinity, hold: 2.5 }, win: -1, setup: 'a b', regime: 'nada' }), '');
  assert.equal(build({ sym: 'BTCUSDT', cfg: { tgt: 99, stp: '3', hold: '12; DROP' } }), 'symbol=BTCUSDT&stp=3');
});

// ----------------------------------------------------------------- hostis
test('url-state: tentativas de injeção viram nada e nunca chegam ao resultado', () => {
  const evil = [
    '<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "' OR 1=1 --", 'javascript:alert(1)', '{{7*7}}', '${7*7}', '`id`',
    '%3Cscript%3E', '\u0000', '‮', '😀', '../../etc/passwd', 'BTCUSDT\nX-Evil: 1', 'BTCUSDT\r\n'
  ];
  for (const e of evil) {
    for (const k of ['symbol', 'tf', 'mode', 'tgt', 'stp', 'hold', 'win', 'setup', 'regime']) {
      const r = parse('?' + k + '=' + encodeURIComponent(e));
      assert.deepEqual(r, {}, `${k}=${JSON.stringify(e)}`);
    }
  }
});

test('url-state: __proto__, constructor e afins não poluem nem passam', () => {
  const r = parse('?__proto__[polluted]=1&constructor[prototype][polluted]=1&setup=__proto__&regime=constructor&symbol=toString&tf=hasOwnProperty&mode=__proto__');
  assert.deepEqual(r, {});
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(parse('?setup=constructor', { setups: ['RSI_OVERSOLD'] }), {});
  assert.deepEqual(parse('?regime=toString', { regimes: ['ALL'] }), {});
});

test('url-state: consulta enorme é descartada inteira, sem custo nem erro', () => {
  const big = '?symbol=BTCUSDT&x=' + 'a'.repeat(1e6);
  const t0 = Date.now();
  assert.deepEqual(parse(big), {});
  assert.ok(Date.now() - t0 < 500);
  assert.deepEqual(parse('?setup=' + 'A'.repeat(1e5)), {});
  assert.deepEqual(parse('?symbol=' + 'B'.repeat(65)), {});
  assert.equal(build({ sym: 'BTCUSDT' }, { keep: '?x=' + 'a'.repeat(1e6) }), 'symbol=BTCUSDT');
});

test('url-state: entrada de tipo errado não lança', () => {
  for (const v of [undefined, null, 0, 1, NaN, true, {}, [], ['?symbol=BTCUSDT'], () => '', Symbol.iterator, 10n, { toString: () => '?symbol=BTCUSDT' }]) {
    assert.deepEqual(parse(v), {});
    assert.deepEqual(parse('?symbol=BTCUSDT', v), { sym: 'BTCUSDT' });
  }
  for (const v of [undefined, null, 0, 'texto', [], () => 1, true]) {
    assert.equal(build(v), '');
  }
  assert.equal(build({ sym: 'BTCUSDT', cfg: 'texto' }), 'symbol=BTCUSDT');
  assert.equal(build({ sym: 'BTCUSDT' }, { keep: { x: 1 } }), 'symbol=BTCUSDT');
});

test('url-state: percentuais quebrados, caracteres soltos e chaves estranhas não lançam', () => {
  for (const s of ['?symbol=%E0%A4%A', '?%=%&=&&&', '?symbol', '?=symbol', '?symbol[]=BTCUSDT', '?a=%zz&symbol=ETHUSDT', '?\ud800=1', '#', '?#', '?symbol=BTCUSDT#?tf=1d']) {
    assert.doesNotThrow(() => parse(s), s);
  }
  assert.deepEqual(parse('?a=%zz&symbol=ETHUSDT'), { sym: 'ETHUSDT' });
  assert.deepEqual(parse('?symbol[]=BTCUSDT'), {});
  assert.deepEqual(parse('?symbol=BTCUSDT#?tf=1d'), { sym: 'BTCUSDT' });
});

test('url-state: view com getter que lança ou objeto exótico não derruba o build', () => {
  const view = {};
  Object.defineProperty(view, 'sym', { get() { throw new Error('boom'); } });
  assert.equal(build(view), '');
  assert.equal(build(Object.create(null)), '');
  assert.equal(build(new Proxy({}, { get() { throw new Error('boom'); } })), '');
});

test('url-state: a consulta montada só tem caracteres seguros, mesmo com parâmetro alheio hostil', () => {
  const qs = build({ sym: 'BTCUSDT', tf: '4h' }, { keep: '?x=%3Cscript%3Ealert(1)%3C/script%3E&y=%22%27' });
  assert.match(qs, /^[A-Za-z0-9_.*=&%+-]+$/);
  assert.doesNotMatch(qs, /[<>"' ]/);
});

// ------------------------------------------------------- arquivos do front
test('live.js e url-state.js passam na checagem de sintaxe do Node', () => {
  for (const f of ['live.js', 'url-state.js']) {
    const r = spawnSync(process.execPath, ['--check', path.join(root, 'web', 'js', f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});
