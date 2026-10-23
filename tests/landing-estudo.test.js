// Confere os números escritos à mão em web/index.html (seção #estudo) contra o
// estudo publicado v1.1 em tests/fixtures/study-v1.1-matrix.json. O HTML não é
// gerado: se alguém editar um número, este teste aponta a célula divergente.
// Sem DOM: o HTML é lido como texto, com expressões regulares.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(raiz, 'web', 'index.html'), 'utf8');
const motor = readFileSync(join(raiz, 'engine', 'index.js'), 'utf8');
const fixture = JSON.parse(readFileSync(join(raiz, 'tests', 'fixtures', 'study-v1.1-matrix.json'), 'utf8'));

// Código do veredito no fixture -> texto que a tabela mostra.
const TEXTO_VEREDITO = {
  EDGE: 'Vantagem estatística presente',
  EDGE_SENSIVEL: 'Vantagem presente, sensível a subperíodos',
  SEM_EDGE: 'Sem vantagem demonstrável',
  ABAIXO: 'Abaixo do acaso',
  INSUFICIENTE: 'Evidência insuficiente',
};

// Código do veredito -> símbolo da grade (legenda da seção #estudo).
const SIMBOLO_VEREDITO = {
  EDGE: '▲',
  EDGE_SENSIVEL: '◆',
  ABAIXO: '▼',
  SEM_EDGE: '·',
  INSUFICIENTE: '○',
};

const SERIE_PARA_SYM = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT' };

// Nome em português de cada setup, lido de SETUPS em engine/index.js (regex, sem importar o motor).
const nomeDeSetup = new Map();
for (const m of motor.matchAll(/\{ id: '([A-Z0-9_]+)', nome: '([^']+)'/g)) {
  nomeDeSetup.set(m[1], m[2]);
}

const estudo = html.match(/<section id="estudo">([\s\S]*?)<\/section>/);
if (!estudo) throw new Error('seção #estudo não encontrada em web/index.html');
const secao = estudo[1];

// Entidades que aparecem no HTML e no fixture (o fixture grava "&lt; 0,001").
function decodificar(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function textoDe(celula) {
  return decodificar(celula.replace(/<[^>]+>/g, '')).trim();
}

// Remove o "efetivo" do fixture: a tabela escreve "617 (542)".
function nFormatado(shownN) {
  return shownN.replace(/ \(efetivo /, ' (');
}

function chaveCelula(sym, tf, id) {
  return `${sym}|${tf}|${id}`;
}

// Faixa de valores de (acerto − base) em pontos percentuais compatível com o fixture.
// O fixture guarda acerto e base com 3 casas (0,207), mas a tela mostra 1 casa em % (20,7%),
// então cada um pode estar até 0,05 pp longe do valor real: a diferença fica a ±0,1 pp.
// Quando a faixa cobre dois décimos, o número do HTML é aceito se cair nela.
function faixaDiferenca(winRate, base) {
  const centro = (winRate - base) * 100;
  return { min: centro - 0.1 - 1e-9, max: centro + 0.1 + 1e-9, centro };
}

// Formato pt-BR com sinal "+" ou "−" (U+2212), uma casa.
const FORMATO_NUMERO = /^(\+|−)?\d+,\d$/;

function valorDeNumero(texto) {
  const sinal = texto.startsWith('−') ? -1 : 1;
  return sinal * Number(texto.replace(/^[+−]/, '').replace(',', '.'));
}

// ---------------------------------------------------------------- tabela de 72 linhas

const tabelaBloco = secao.match(/<table class="mx-full">([\s\S]*?)<\/table>/);
if (!tabelaBloco) throw new Error('tabela class="mx-full" não encontrada em #estudo');
const corpo = tabelaBloco[1].match(/<tbody>([\s\S]*?)<\/tbody>/);
if (!corpo) throw new Error('tbody da tabela mx-full não encontrado');

const linhasTabela = new Map();
let totalLinhas = 0;
for (const tr of corpo[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
  totalLinhas++;
  const celulas = [...tr[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => textoDe(m[1]));
  if (celulas.length !== 9) {
    throw new Error(`linha ${totalLinhas} da tabela tem ${celulas.length} colunas, esperadas 9`);
  }
  const [serie, setup, n, acerto, ic, base, p, pAjustado, veredito] = celulas;
  const m = serie.match(/^(BTC|ETH|SOL)\/USDT (1h|4h|1D)$/);
  if (!m) throw new Error(`série não reconhecida na tabela: "${serie}"`);
  const tf = m[2].toLowerCase();
  const id = [...nomeDeSetup].find(([, nome]) => nome === setup)?.[0];
  if (!id) throw new Error(`setup não encontrado em engine/index.js: "${setup}"`);
  linhasTabela.set(chaveCelula(SERIE_PARA_SYM[m[1]], tf, id), {
    serie, setup, n, acerto, ic, base, p, pAjustado, veredito,
  });
}

// Grade colorida: <button class="mx-cell ..." data-sym data-tf data-id data-v ...><i>símbolo</i><b>número</b></button>
const celulasGrade = [...secao.matchAll(
  /<button type="button" class="mx-cell ([^"]*)"([^>]*)>\s*<i aria-hidden="true">([^<]*)<\/i><b>([^<]*)<\/b>/g,
)].map((m) => {
  const attr = (nome) => decodificar((m[2].match(new RegExp(`${nome}="([^"]*)"`)) || [])[1] || '');
  return {
    classes: m[1],
    sym: attr('data-sym'),
    tf: attr('data-tf'),
    id: attr('data-id'),
    v: attr('data-v'),
    simbolo: m[3],
    numero: m[4],
  };
});

function celulaFixture(c) {
  return `${c.sym.slice(0, 3)}/USDT ${c.tf === '1d' ? '1D' : c.tf} · ${nomeDeSetup.get(c.id)}`;
}

// ---------------------------------------------------------------- testes

test('fixture e motor: 72 combinações únicas, 8 setups com nome conhecido', () => {
  assert.equal(fixture.cells.length, 72);
  const chaves = new Set(fixture.cells.map((c) => chaveCelula(c.sym, c.tf, c.id)));
  assert.equal(chaves.size, 72, 'combinações sym/tf/id repetidas no fixture');
  assert.equal(nomeDeSetup.size, 8, `esperava 8 setups em engine/index.js, achei ${nomeDeSetup.size}`);
  for (const c of fixture.cells) {
    assert.ok(nomeDeSetup.has(c.id), `setup ${c.id} sem nome em engine/index.js`);
    assert.ok(TEXTO_VEREDITO[c.verdict], `veredito ${c.verdict} sem texto mapeado`);
  }
});

test('tabela: 72 linhas no HTML, uma para cada combinação do fixture', () => {
  assert.equal(totalLinhas, 72, `a tabela tem ${totalLinhas} linhas`);
  const faltando = fixture.cells
    .filter((c) => !linhasTabela.has(chaveCelula(c.sym, c.tf, c.id)))
    .map(celulaFixture);
  assert.deepEqual(faltando, [], 'combinações ausentes na tabela');
});

test('tabela: cada célula bate com o fixture (série, setup, N, acerto, IC, base, p, p ajustado, veredito)', () => {
  const divergencias = [];
  let comparacoes = 0;
  for (const c of fixture.cells) {
    const linha = linhasTabela.get(chaveCelula(c.sym, c.tf, c.id));
    if (!linha) continue; // já coberto pelo teste anterior
    const rotulo = celulaFixture(c);
    const esperado = {
      Série: [linha.serie, `${c.sym.slice(0, 3)}/USDT ${c.tf === '1d' ? '1D' : c.tf}`],
      Setup: [linha.setup, nomeDeSetup.get(c.id)],
      'N (efetivo)': [linha.n, nFormatado(c.shown.n)],
      Acerto: [linha.acerto, c.shown.wr],
      'IC 95%': [linha.ic.replace(/\s+/g, ''), c.shown.ci.replace(/\s+/g, '')],
      Base: [linha.base, c.shown.base],
      p: [linha.p, decodificar(c.shown.p)],
      'p ajustado': [linha.pAjustado, c.shown.q],
      Veredito: [linha.veredito, TEXTO_VEREDITO[c.verdict]],
    };
    for (const [campo, [html, fx]] of Object.entries(esperado)) {
      comparacoes++;
      if (html !== fx) {
        divergencias.push(`${rotulo} · ${campo}: HTML "${html}", fixture "${fx}"`);
      }
    }
  }
  assert.equal(comparacoes, 72 * 9);
  assert.deepEqual(divergencias, [], `divergências na tabela:\n${divergencias.join('\n')}`);
});

test('grade: 72 células, uma para cada combinação do fixture', () => {
  assert.equal(celulasGrade.length, 72, `a grade tem ${celulasGrade.length} células`);
  const chaves = new Set(celulasGrade.map((g) => chaveCelula(g.sym, g.tf, g.id)));
  assert.equal(chaves.size, 72, 'células repetidas na grade');
  const faltando = fixture.cells
    .filter((c) => !chaves.has(chaveCelula(c.sym, c.tf, c.id)))
    .map(celulaFixture);
  assert.deepEqual(faltando, [], 'combinações ausentes na grade');
});

test('grade: número de cada célula é (acerto − base) em pontos percentuais, uma casa, pt-BR', () => {
  const divergencias = [];
  for (const g of celulasGrade) {
    const c = fixture.cells.find((x) => x.sym === g.sym && x.tf === g.tf && x.id === g.id);
    if (!c) continue;
    if (!FORMATO_NUMERO.test(g.numero)) {
      divergencias.push(`${celulaFixture(c)}: formato "${g.numero}" fora de pt-BR com uma casa`);
      continue;
    }
    const { min, max, centro } = faixaDiferenca(c.winRate, c.base);
    const valor = valorDeNumero(g.numero);
    if (valor < min || valor > max) {
      divergencias.push(
        `${celulaFixture(c)}: HTML "${g.numero}", fora da faixa ${min.toFixed(2)} a ${max.toFixed(2)} ` +
        `(centro ${centro.toFixed(2)}; acerto ${c.winRate}, base ${c.base})`,
      );
    }
  }
  assert.deepEqual(divergencias, [], `números divergentes na grade:\n${divergencias.join('\n')}`);
});

test('grade: símbolo e data-v de cada célula batem com o veredito do fixture', () => {
  const divergencias = [];
  for (const g of celulasGrade) {
    const c = fixture.cells.find((x) => x.sym === g.sym && x.tf === g.tf && x.id === g.id);
    if (!c) continue;
    const simboloEsperado = SIMBOLO_VEREDITO[c.verdict];
    if (g.simbolo !== simboloEsperado) {
      divergencias.push(`${celulaFixture(c)}: símbolo HTML "${g.simbolo}", esperado "${simboloEsperado}" (${c.verdict})`);
    }
    if (g.v !== c.verdict) {
      divergencias.push(`${celulaFixture(c)}: data-v HTML "${g.v}", fixture "${c.verdict}"`);
    }
  }
  assert.deepEqual(divergencias, [], `símbolos ou vereditos divergentes na grade:\n${divergencias.join('\n')}`);
});
