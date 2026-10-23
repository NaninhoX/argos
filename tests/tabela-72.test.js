// Tabela dos 72 testes (web/js/tabela-72.js): chave de ordenação em pt-BR e CSV. Script do navegador carregado sem DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../web/js/tabela-72.js', import.meta.url), 'utf8');
const mod = { exports: {} };
new Function('window', 'module', SRC)({}, mod);
const T = mod.exports;

test('tabela dos 72: a chave de ordenação lê números em pt-BR', () => {
  assert.equal(T.sortKey('1.569 (1.569)'), 1569);
  assert.equal(T.sortKey('20,7%'), 20.7);
  assert.equal(T.sortKey('17,7%–24,1%'), 17.7);
  assert.equal(T.sortKey('0,036'), 0.036);
  assert.ok(T.sortKey('< 0,001') < 0.001, '"< 0,001" vem antes de 0,001');
  assert.ok(T.sortKey('< 0,001') > 0);
  assert.equal(T.sortKey('−3,8'), -3.8);
  assert.equal(T.sortKey('Sem vantagem demonstrável'), 'sem vantagem demonstrável');
  assert.equal(T.sortKey('BTC/USDT 1h'), 'btc/usdt 1h');
});

test('tabela dos 72: CSV com ponto e vírgula, BOM, aspas quando precisa e uma linha por teste', () => {
  const csv = T.toCSV(['Série', 'Acerto', 'Nota'], [['BTC/USDT 1h', '20,7%', 'a;b'], ['ETH/USDT 4h', '32,3%', 'diz "sim"']]);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.deepEqual(lines, ['Série;Acerto;Nota', 'BTC/USDT 1h;20,7%;"a;b"', 'ETH/USDT 4h;32,3%;"diz ""sim"""']);
});

test('tabela dos 72: o HTML traz as 72 linhas que o script melhora', () => {
  const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const table = /<table class="mx-full">([\s\S]*?)<\/table>/.exec(html);
  assert.ok(table, 'table.mx-full existe');
  assert.equal((table[1].match(/<tr>/g) || []).length, 73, 'cabeçalho + 72 testes');
});
