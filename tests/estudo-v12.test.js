// Script do estudo v1.2 (tools/estudo-v12.mjs): só a mecânica, com SÉRIES SINTÉTICAS.
//
// REGRA DESTE ARQUIVO: o estudo v1.2 roda uma vez só, por decisão de Michel. Nenhum teste aqui roda o estudo real,
// lê resultado real nem grava arquivo de resultado. Séries reais não são carregadas; as contas usam random walk
// sintético com semente fixa. A ficha real só é lida para conferir o hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as engine from '../engine/index.js';
import { hashCanonical } from '../lib/canonical.js';
import {
  RAIZ, FICHA, HASH_FICHA, CFG, SORTEIOS, ATIVOS, TEMPOS, VEREDITOS, ROTULO_RECALCULO,
  carregaFicha, confereFicha, confereMotor, VERSAO_MOTOR, montaDocumento, gravaSaida, sha256Arquivo, validaSaida, registroDaSerie, confereCorte, calculaSerie, montaFamilias, rotuloQ,
  celulaNova, celulaV11, contaVereditos, contagemPorFamilia, montaResultados, formataFumaca, uso, main
} from '../tools/estudo-v12.mjs';

const TEXTO_SCRIPT = fs.readFileSync(new URL('../tools/estudo-v12.mjs', import.meta.url), 'utf8');

/** Random walk sintético (mulberry32), no formato de engine.decodeSnapshot. */
function sintetica(n, semente, dt = 3600) {
  let a = semente >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const t = [], o = [], h = [], l = [], c = [], v = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    const op = px, cl = op * (1 + (rnd() - 0.5) * 0.04);
    t.push(1640995200 + i * dt); o.push(op); c.push(cl);
    h.push(Math.max(op, cl) * (1 + rnd() * 0.01)); l.push(Math.min(op, cl) * (1 - rnd() * 0.01)); v.push(1000 + rnd() * 500);
    px = cl;
  }
  return { t, o, h, l, c, v, n, dt };
}

/** Linha de motor falsa, só com o que applyFamily e verdictOf leem. */
const linha = (k, pTwo, extra = {}) => ({ id: 'S' + (k % 7), serie: 'X_1h', sym: 'X', tf: '1h', pTwo, nEff: 50, winRate: 0.4, base: 0.3, wf: { available: true, consistent: true }, ...extra });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estudo-v12-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ------------------------------------------------------------ ficha
test('ficha: o hash canônico da ficha registrada confere', () => {
  assert.equal(HASH_FICHA, '98e8e1134d3cf5c9c9f4a91582d4a11284efa9f3dede5bf4057f6a6db7730357');
  const f = carregaFicha();
  assert.equal(f.study, 'argos-estudo-v1.2');
  assert.deepEqual(CFG, { mode: 'atr', tgt: 2, stp: 1, hold: 12 });
  assert.equal(SORTEIOS, 3000);
});

test('ficha: cópia alterada (fora de docs/) aborta por hash divergente', () => {
  const f = JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  f.exit_rule.hold_candles = 24;
  const alterada = path.join(tmp, 'ficha-alterada.json');
  fs.writeFileSync(alterada, JSON.stringify(f));
  assert.throws(() => carregaFicha(alterada), /hash da ficha diverge/);
  // a cópia idêntica, fora de docs/, passa
  const igual = path.join(tmp, 'ficha-igual.json');
  fs.copyFileSync(FICHA, igual);
  assert.equal(carregaFicha(igual).study, 'argos-estudo-v1.2');
});

// ------------------------------------------------------------ saída
test('saída: recusa caminho dentro do repositório', () => {
  for (const rel of ['resultado-v12.json', path.join('docs', 'resultado-v12.json'), path.join('tools', 'x', 'y.json'), path.join('tests', '..', 'z.json')]) {
    const alvo = path.join(RAIZ, rel);
    assert.throws(() => validaSaida(alvo), /dentro do reposit/, rel);
    assert.equal(fs.existsSync(alvo), false, 'não pode ter criado nada: ' + rel);
  }
});

test('saída: recusa sobrescrever arquivo existente e aceita caminho novo fora do repositório', () => {
  const existente = path.join(tmp, 'ja-existe.json');
  fs.writeFileSync(existente, '{}');
  assert.throws(() => validaSaida(existente), /já existe/);
  assert.equal(fs.readFileSync(existente, 'utf8'), '{}');
  const novo = path.join(tmp, 'novo', 'saida.json');
  assert.equal(validaSaida(novo), path.resolve(novo));
  assert.equal(fs.existsSync(novo), false, 'validar não cria o arquivo');
});

test('saída: --saida sem caminho é recusado', () => {
  assert.throws(() => validaSaida(undefined), /exige um caminho/);
  assert.throws(() => validaSaida('--so-fumaca'), /exige um caminho/);
});

// ------------------------------------------------------------ séries
test('registroDaSerie e confereCorte: série sintética', () => {
  const d = sintetica(300, 1);
  const r = registroDaSerie(d);
  assert.equal(r.candles, 300);
  assert.match(r.seriesHash, /^[0-9a-f]{64}$/);
  assert.equal(r.primeiroCandle, '2022-01-01T00:00:00.000Z');
  assert.equal(r.ultimoCandle, new Date((1640995200 + 299 * 3600) * 1000).toISOString());
  assert.equal(registroDaSerie(sintetica(300, 1)).seriesHash, r.seriesHash, 'determinístico');
  assert.notEqual(registroDaSerie(sintetica(300, 2)).seriesHash, r.seriesHash);
  confereCorte(d, '2022-01-13'); // último candle em 13/01 11:00: o corte vale até o fim do dia
  assert.throws(() => confereCorte(d, '2022-01-12'), /depois do corte/);
  assert.throws(() => confereCorte(d, '2022-01-10'), /depois do corte/);
});

// ------------------------------------------------------------ famílias
test('famílias: 135 = 63 novas + 72 do v1.1; 63 = só as novas; entradas intactas', () => {
  const novas = Array.from({ length: 63 }, (_, k) => linha(k, (k + 1) / 200));
  const v11 = Array.from({ length: 72 }, (_, k) => linha(100 + k, (k + 1) / 150));
  const copiaNovas = JSON.stringify(novas), copiaV11 = JSON.stringify(v11);
  const { f135, f63 } = montaFamilias(novas, v11);
  assert.equal(f135.novas.length, 63);
  assert.equal(f135.v11.length, 72);
  assert.equal(f63.length, 63);
  assert.equal(f135.novas.length + f135.v11.length, 135);
  for (const r of [...f135.novas, ...f135.v11]) assert.equal(r.family, 135);
  for (const r of f63) assert.equal(r.family, 63);
  // q = BH sobre as listas certas
  const q135 = engine.bhAdjust([...novas, ...v11].map((r) => r.pTwo));
  const q63 = engine.bhAdjust(novas.map((r) => r.pTwo));
  [...f135.novas, ...f135.v11].forEach((r, k) => assert.equal(r.q, q135[k]));
  f63.forEach((r, k) => assert.equal(r.q, q63[k]));
  // as famílias são independentes: com 135 o q das novas nunca é menor que com 63
  f63.forEach((r, k) => assert.ok(f135.novas[k].q >= r.q - 1e-12));
  // entradas não foram alteradas (cópias)
  assert.equal(JSON.stringify(novas), copiaNovas);
  assert.equal(JSON.stringify(v11), copiaV11);
  assert.ok(novas.every((r) => r.q === undefined && r.family === undefined));
});

test('famílias: tamanhos errados são recusados', () => {
  const l = (n) => Array.from({ length: n }, (_, k) => linha(k, 0.5));
  assert.throws(() => montaFamilias(l(62), l(72)), /63 células novas/);
  assert.throws(() => montaFamilias(l(63), l(71)), /72 células do v1\.1/);
});

test('rotuloQ: sempre com a família', () => {
  assert.equal(rotuloQ(0.0421, 135), 'q = 0,042, família 135');
  assert.equal(rotuloQ(1, 63), 'q = 1,000, família 63');
  assert.equal(rotuloQ(0.0001, 135), 'q < 0,001, família 135');
  assert.equal(rotuloQ(NaN, 135), 'q indisponível, família 135');
});

// ------------------------------------------------------------ contagem
test('contaVereditos e contagemPorFamilia', () => {
  const itens = [{ k: 'EDGE' }, { k: 'SEM_EDGE' }, { k: 'SEM_EDGE' }, { k: 'INSUFICIENTE' }];
  const c = contaVereditos(itens, (x) => x.k);
  assert.deepEqual(Object.keys(c), [...VEREDITOS]);
  assert.deepEqual(c, { INSUFICIENTE: 1, SEM_EDGE: 2, ABAIXO: 0, EDGE_SENSIVEL: 0, EDGE: 1 });
  assert.throws(() => contaVereditos([{ k: 'OUTRO' }], (x) => x.k), /desconhecida/);
  const cels = [];
  for (const id of ['A', 'B']) for (let k = 0; k < 9; k++) cels.push({ setup: id, k: k < 3 ? 'EDGE' : 'SEM_EDGE' });
  const f = contagemPorFamilia(cels, (x) => x.k);
  assert.equal(f.total.EDGE, 6);
  assert.equal(f.total.SEM_EDGE, 12);
  assert.deepEqual(Object.keys(f.porSetup), ['A', 'B']);
  assert.equal(Object.values(f.porSetup.A).reduce((a, b) => a + b, 0), 9);
});

// ------------------------------------------------------------ fluxo completo, só sintético
/** 9 análises sintéticas no formato que estudo() entrega a montaDocumento, e a matriz "publicada" correspondente. */
function analisesSinteticas(iters = 20) {
  const analises = {};
  let semente = 10, cont = 0;
  for (const tf of TEMPOS) for (const sym of ATIVOS) {
    const d = sintetica(900, semente++);
    const r = calculaSerie(d, sym, tf, iters);
    // p fabricados (só aqui, em dado sintético): pequenos e crescentes nas novas, para que a família 135 e a 63 deem q diferentes
    r.novas.forEach((x) => { x.pTwo = 0.0004 * ++cont; });
    r.v11.forEach((x) => { x.pTwo = 0.5; });
    analises[`${sym}_${tf}`] = { d, novas: r.novas, v11: r.v11 };
  }
  const matriz = { cells: Object.values(analises).flatMap((a) => a.v11.map((r) => ({ sym: r.sym, tf: r.tf, id: r.id, q: 0.5, verdict: 'SEM_EDGE' }))) };
  return { analises, matriz };
}
const EXECUCAO = { versaoDoMotor: engine.VERSION, sha256Motor: 'a'.repeat(64), sha256Script: 'b'.repeat(64), executadoEmUTC: '2026-11-19T00:00:00.000Z', node: process.version, tempoSegundos: 1 };
const soma = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('montaDocumento (miolo de estudo): 9 séries sintéticas, 63 novas + 72 recalculadas, famílias e contagens', () => {
  const { analises, matriz } = analisesSinteticas();
  const ficha = carregaFicha();
  const doc = montaDocumento({ ficha, matriz, analises, execucao: EXECUCAO });
  const novasBrutas = TEMPOS.flatMap((tf) => ATIVOS.flatMap((sym) => analises[`${sym}_${tf}`].novas));
  const v11Brutas = matriz.cells.map((c) => analises[`${c.sym}_${c.tf}`].v11.find((r) => r.id === c.id));
  assert.equal(doc.celulasNovas.length, 63);
  assert.deepEqual([...new Set(doc.celulasNovas.map((c) => c.setup))], engine.SETUPS_V12.map((s) => s.id));

  // família OFICIAL = 135: q e rótulo calculados à parte, aqui no teste, sobre as 135 linhas
  const q135 = engine.bhAdjust([...novasBrutas, ...v11Brutas].map((r) => r.pTwo));
  const q63 = engine.bhAdjust(novasBrutas.map((r) => r.pTwo));
  doc.celulasNovas.forEach((c, k) => {
    assert.equal(c.oficial135.familia, 135, 'oficial é a família 135');
    assert.equal(c.oficial135.q, q135[k], 'q oficial = BH sobre 135');
    assert.match(c.oficial135.rotuloQ, /família 135$/);
    assert.equal(c.sensibilidade63.familia, 63);
    assert.equal(c.sensibilidade63.q, q63[k], 'q da sensibilidade = BH sobre 63');
    assert.match(c.sensibilidade63.rotuloQ, /família 63$/);
    assert.equal(c.diferencaParaBasePP, novasBrutas[k].alphaPP);
  });
  assert.ok(q135.some((q, k) => k < 63 && q !== q63[k]), 'o sintético precisa distinguir 135 de 63');
  doc.recalculoV11.celulas.forEach((c, k) => {
    assert.equal(c.recalculo135.familia, 135);
    assert.equal(c.recalculo135.q, q135[63 + k]);
    assert.equal(c.publicado.familia, 72);
    assert.equal(c.recalculo135.rotulo, ROTULO_RECALCULO);
  });

  // contagens
  assert.equal(soma(doc.contagem.oficial135.total), 63);
  assert.equal(soma(doc.contagem.sensibilidade63.total), 63);
  for (const id of engine.SETUPS_V12.map((s) => s.id)) {
    assert.equal(soma(doc.contagem.oficial135.porSetup[id]), 9);
    assert.equal(soma(doc.contagem.sensibilidade63.porSetup[id]), 9);
  }
  assert.equal(soma(doc.recalculoV11.contagemRecalculo135), 72);
  // veredito vem de verdictOf com o q da família certa
  doc.celulasNovas.forEach((c, k) => {
    assert.equal(c.oficial135.veredito.key, engine.verdictOf({ ...novasBrutas[k], q: q135[k] }).key);
    assert.equal(c.sensibilidade63.veredito.key, engine.verdictOf({ ...novasBrutas[k], q: q63[k] }).key);
  });

  // meta
  const m = doc.meta;
  assert.equal(m.fichaHash, HASH_FICHA);
  assert.equal(m.versaoDoMotor, 'argos-engine 1.3.0');
  assert.equal(m.sha256Motor, EXECUCAO.sha256Motor);
  assert.equal(m.sha256Script, EXECUCAO.sha256Script);
  assert.equal(m.familiaOficial, 135);
  assert.equal(m.familiaSensibilidade, 63);
  assert.equal(m.sorteios, 3000);
  assert.deepEqual(m.regraDeSaida, { mode: 'atr', alvoATR: 2, stopATR: 1, prazoCandles: 12, empateNoMesmoCandle: 'perda' });
  assert.equal(Object.keys(m.series).length, 9);
  for (const s of Object.values(m.series)) assert.match(s.seriesHash, /^[0-9a-f]{64}$/);
  assert.doesNotThrow(() => JSON.stringify(doc));
});

test('montaDocumento: a conferência do hash da ficha acontece DENTRO do fluxo', () => {
  const { analises, matriz } = analisesSinteticas(5);
  const ficha = JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  ficha.question = ficha.question + ' ';
  assert.throws(() => montaDocumento({ ficha, matriz, analises, execucao: EXECUCAO }), /hash da ficha diverge/);
});

test('montaDocumento: exige o motor 1.3.0 e as 9 análises', () => {
  const { analises, matriz } = analisesSinteticas(5);
  const ficha = carregaFicha();
  assert.throws(() => montaDocumento({ ficha, matriz, analises, execucao: { ...EXECUCAO, versaoDoMotor: 'argos-engine 1.2.0' } }), /versão do motor inesperada/);
  const sem = { ...analises }; delete sem.BTCUSDT_1h;
  assert.throws(() => montaDocumento({ ficha, matriz, analises: sem, execucao: EXECUCAO }), /análise ausente/);
  assert.throws(() => confereMotor('argos-engine 1.2.0'), /argos-engine 1\.3\.0/);
  assert.doesNotThrow(() => confereMotor());
  assert.equal(VERSAO_MOTOR, 'argos-engine 1.3.0');
  assert.equal(VERSAO_MOTOR, engine.VERSION);
});

test('confereFicha: ids dos setups contra SETUPS_V12, regra de saída e séries (divergência aborta)', () => {
  const base = JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  // o hash esperado é recalculado para a ficha alterada: assim só a checagem específica pode abortar
  const com = (mut) => { const f = structuredClone(base); mut(f); return f; };
  const confere = (f) => confereFicha(f, hashCanonical(f));
  assert.doesNotThrow(() => confere(structuredClone(base)));
  assert.throws(() => confere(com((f) => { f.setups.reverse(); })), /setups da ficha/);
  assert.throws(() => confere(com((f) => { f.setups[0].id = 'EMA_9_22'; })), /setups da ficha/);
  assert.throws(() => confere(com((f) => { f.setups.pop(); })), /setups da ficha/);
  assert.throws(() => confere(com((f) => { f.exit_rule.target_atr = 3; })), /regra de saída/);
  assert.throws(() => confere(com((f) => { f.series.timeframes = ['1h', '4h']; })), /séries da ficha/);
  assert.throws(() => confereFicha(com((f) => { f.setups.reverse(); })), /hash da ficha diverge/);
});

test('gravaSaida: não sobrescreve arquivo existente (flag wx)', () => {
  const alvo = path.join(tmp, 'subdir-novo', 'doc.json');
  gravaSaida(alvo, { a: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(alvo, 'utf8')), { a: 1 });
  assert.throws(() => gravaSaida(alvo, { a: 2 }), { code: 'EEXIST' });
  assert.deepEqual(JSON.parse(fs.readFileSync(alvo, 'utf8')), { a: 1 }, 'conteúdo original intacto');
});

test('sha256Arquivo: SHA-256 dos bytes do arquivo', () => {
  const f = path.join(tmp, 'bytes.bin');
  fs.writeFileSync(f, Buffer.from([1, 2, 3]));
  assert.equal(sha256Arquivo(f), createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex'));
  assert.match(sha256Arquivo(fileURLToPath(new URL('../tools/estudo-v12.mjs', import.meta.url))), /^[0-9a-f]{64}$/);
});

// ------------------------------------------------------------ fumaça: nada que pareça resultado
test('formataFumaca: só "executou", gatilhos e tempo; nada de taxa, p, q ou veredito', () => {
  const txt = formataFumaca('ETHUSDT_1d', { EMA_9_21: 31, MACD_ZERO: 28, RSI_50: 55, CLOSE_SMA200: 9, ADX_DI: 12, BB_UPPER: 40, BREAKOUT_55: 22 }, 123.6);
  assert.match(txt, /^executou: ETHUSDT_1d, gatilhos por setup: EMA_9_21 31, MACD_ZERO 28/);
  assert.match(txt, /124 ms$/);
  assert.doesNotMatch(txt, /taxa|acerto|veredito|vantagem|edge|win|\bp\s*[=<>]|\bq\s*[=<>]|%|\d[.,]\d/i);
  // contagem não inteira não vaza como decimal
  assert.doesNotMatch(formataFumaca('S', { A: 3.9 }, 5), /\d[.,]\d/);
});

test('fumaca(): o corpo da função não lê taxa, p, q nem veredito', () => {
  const ini = TEXTO_SCRIPT.indexOf('export function fumaca(');
  const fim = TEXTO_SCRIPT.indexOf('\n}\n', ini);
  assert.ok(ini > 0 && fim > ini);
  const corpo = TEXTO_SCRIPT.slice(ini, fim);
  assert.doesNotMatch(corpo, /winRate|pTwo|pHigh|pLow|\.q\b|verdict|alphaPP|\.ci\b|wf\b|\.base\b/);
  assert.match(corpo, /nRaw/);
  assert.match(corpo, /iters: 50/);
  assert.match(corpo, /ETHUSDT/);
});

test('console do modo normal: o código só emite progresso (sem taxa, p, q, veredito)', () => {
  const ini = TEXTO_SCRIPT.indexOf('export function estudo(');
  const fim = TEXTO_SCRIPT.indexOf('\nexport function uso', ini);
  const corpo = TEXTO_SCRIPT.slice(ini, fim);
  const logs = corpo.split('\n').filter((l) => /\blog\(/.test(l));
  assert.ok(logs.length >= 2);
  for (const l of logs) assert.doesNotMatch(l, /winRate|pTwo|\.q\b|verdict|veredito|contagem|alphaPP/, l);
});

// ------------------------------------------------------------ linha de comando
// main recebe funções falsas no lugar de estudo() e fumaca(): estes testes nunca leem data/ nem gravam resultado,
// mesmo que validaSaida regrida.
test('main: --ajuda, modo duplo e saída dentro do repositório (sem rodar o estudo)', (t) => {
  const out = [], err = [];
  t.mock.method(console, 'log', (m) => out.push(String(m)));
  t.mock.method(console, 'error', (m) => err.push(String(m)));
  const chamadas = [];
  const deps = { estudo: (s) => chamadas.push(['estudo', s]), fumaca: () => chamadas.push(['fumaca']) };
  assert.equal(main(['--ajuda'], deps), 0);
  assert.match(out.join('\n'), /--so-fumaca/);
  assert.equal(main(['--so-fumaca', '--saida', path.join(tmp, 'x.json')], deps), 1);
  assert.match(err.join('\n'), /escolha um modo/);
  const dentro = path.join(RAIZ, 'resultado-nao-deve-existir.json');
  assert.equal(main(['--saida', dentro], deps), 1);
  assert.equal(fs.existsSync(dentro), false);
  assert.equal(main(['--saida'], deps), 1);
  assert.deepEqual(chamadas, [], 'nenhum modo real foi acionado');
  assert.ok(uso().includes(HASH_FICHA.slice(0, 8)));
});

test('main: saída válida aciona só o estudo injetado; --so-fumaca só a fumaça injetada', () => {
  const chamadas = [];
  const deps = { estudo: (s) => chamadas.push(['estudo', s]), fumaca: () => chamadas.push(['fumaca']) };
  const alvo = path.join(tmp, 'main-ok.json');
  assert.equal(main(['--saida', alvo], deps), 0);
  assert.equal(main(['--so-fumaca'], deps), 0);
  assert.deepEqual(chamadas, [['estudo', path.resolve(alvo)], ['fumaca']]);
  assert.equal(fs.existsSync(alvo), false, 'o estudo falso não grava nada');
});
