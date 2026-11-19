#!/usr/bin/env node
/**
 * Estudo v1.2 (7 setups novos × 9 séries = 63 células), exatamente como manda a ficha registrada
 * docs/estudo-v1.2-pre-registro.json (SHA-256 canônico 98e8e113...). Só leitura sobre engine/: usa
 * analyzeSetupsV12 (as 63 novas) e analyze() (as 72 do v1.1, só para o recálculo rotulado na família 135).
 *
 * ESTE ESTUDO RODA UMA VEZ SÓ. Nada aqui tem grade, escolha ou ajuste: a regra de saída, os sorteios e as
 * famílias são os da ficha. Mudar qualquer coisa depois de ver resultado é outro estudo, com outro registro.
 *
 * Uso:
 *   node tools/estudo-v12.mjs --saida <arquivo.json>   estudo completo (63 novas + 72 do v1.1); o arquivo fica fora do repositório
 *   node tools/estudo-v12.mjs --so-fumaca              ETHUSDT_1d, 50 sorteios: só prova que executa (sem taxa, p, q nem veredito)
 *   node tools/estudo-v12.mjs --ajuda
 *
 * O console nunca recebe número de resultado: só progresso. Os resultados vão para o arquivo de saída.
 * Alvo e stop são parâmetros do teste, nunca orientação a ninguém.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as engine from '../engine/index.js';
import { seriesHash } from '../lib/analysis-summary.js';
import { hashCanonical } from '../lib/canonical.js';
import { dentroDoRepo } from './backup-neon.mjs';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FICHA = path.join(RAIZ, 'docs', 'estudo-v1.2-pre-registro.json');
export const HASH_FICHA = '98e8e1134d3cf5c9c9f4a91582d4a11284efa9f3dede5bf4057f6a6db7730357';
const MATRIZ_V11 = path.join(RAIZ, 'tests', 'fixtures', 'study-v1.1-matrix.json');
/** Regra de saída padrão da ficha: alvo 2×ATR, stop 1×ATR, prazo de 12 candles (empate no mesmo candle conta como perda, no motor). */
export const CFG = Object.freeze({ mode: 'atr', tgt: 2, stp: 1, hold: 12 });
/** Sorteios do teste de permutação: o padrão do motor, como diz a ficha (3.000). */
export const SORTEIOS = 3000;
export const ATIVOS = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
export const TEMPOS = Object.freeze(['1h', '4h', '1d']);
/** Ordem fixa das chaves de veredito do motor (verdictOf). */
export const VEREDITOS = Object.freeze(['INSUFICIENTE', 'SEM_EDGE', 'ABAIXO', 'EDGE_SENSIVEL', 'EDGE']);
export const ROTULO_RECALCULO = 'recálculo, não substitui o publicado';
/** Versão do motor que a ficha e o estudo pressupõem (os 7 setups novos entram na 1.3.0). */
export const VERSAO_MOTOR = 'argos-engine 1.3.0';
const ARQUIVO_MOTOR = path.join(RAIZ, 'engine', 'index.js');
const ARQUIVO_SCRIPT = fileURLToPath(import.meta.url);

const agora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ------------------------------------------------------------------ ficha

/**
 * Lê a ficha e confere o hash canônico registrado. Lança erro se divergir (a ficha não pode ser editada).
 * Confere também que a regra de saída, as séries e os setups da ficha são os que o script usa.
 * @param {string} [arquivo] caminho da ficha (padrão: a do repositório; o teste passa uma cópia alterada)
 * @param {string} [hashEsperado]
 * @returns {any} ficha canônica
 */
export function carregaFicha(arquivo = FICHA, hashEsperado = HASH_FICHA) {
  return confereFicha(JSON.parse(fs.readFileSync(arquivo, 'utf8')), hashEsperado);
}

/**
 * Confere uma ficha já lida: hash canônico, regra de saída, séries e ids dos setups. Lança erro se algo divergir.
 * @param {any} ficha objeto da ficha
 * @param {string} [hashEsperado]
 * @returns {any} a mesma ficha
 */
export function confereFicha(ficha, hashEsperado = HASH_FICHA) {
  const h = hashCanonical(ficha);
  if (h !== hashEsperado) throw new Error(`hash da ficha diverge do registrado (${h} ≠ ${hashEsperado}); a ficha não pode ser editada.`);
  const x = ficha.exit_rule || {};
  if (x.target_atr !== CFG.tgt || x.stop_atr !== CFG.stp || x.hold_candles !== CFG.hold) throw new Error('a regra de saída da ficha não é a do script (alvo 2, stop 1, prazo 12).');
  const s = ficha.series || {};
  if (JSON.stringify(s.symbols) !== JSON.stringify(ATIVOS) || JSON.stringify(s.timeframes) !== JSON.stringify(TEMPOS)) throw new Error('as séries da ficha não são as do script.');
  const ids = (ficha.setups || []).map((e) => e.id);
  if (JSON.stringify(ids) !== JSON.stringify(engine.SETUPS_V12.map((e) => e.id))) throw new Error('os setups da ficha não são os de engine.SETUPS_V12.');
  return ficha;
}

// ------------------------------------------------------------------ séries

const isoDe = (t) => new Date(t * 1000).toISOString();

/**
 * Dados que a ficha manda registrar de cada série: seriesHash, nº de candles, primeiro e último candle.
 * @param {{n: number, dt: number, t: number[]}} d série decodificada
 * @returns {{seriesHash: string, candles: number, primeiroCandle: string, ultimoCandle: string, dtSegundos: number}}
 */
export function registroDaSerie(d) {
  return { seriesHash: seriesHash(d), candles: d.n, primeiroCandle: isoDe(d.t[0]), ultimoCandle: isoDe(d.t[d.n - 1]), dtSegundos: d.dt };
}

/**
 * Lança erro se a série tiver candle depois do corte da ficha (o corte vale até o fim do dia, em UTC).
 * @param {{n: number, t: number[]}} d série decodificada
 * @param {string} corte AAAA-MM-DD
 */
export function confereCorte(d, corte) {
  const limite = Date.parse(corte + 'T00:00:00Z') / 1000 + 86400;
  if (d.t[d.n - 1] >= limite) throw new Error(`a série tem candle depois do corte ${corte} (${isoDe(d.t[d.n - 1])}); estudo recusado.`);
}

/**
 * Carrega uma série como tests/study-v1.1.test.js: 1h de data/history/<SYM>_1h.json.gz; 4h e 1d do snapshot.
 * @param {string} sym ativo
 * @param {string} tf tempo gráfico
 * @param {{snap?: any}} cache snapshot já lido
 * @param {string} [raiz] raiz do repositório
 * @returns {object} série decodificada
 */
export function carregaSerie(sym, tf, cache, raiz = RAIZ) {
  let compact;
  if (tf === '1h') compact = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(raiz, 'data', 'history', `${sym}_1h.json.gz`))));
  else {
    if (!cache.snap) cache.snap = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'snapshot-v1.1.json'), 'utf8'));
    compact = cache.snap.series[`${sym}_${tf}`];
  }
  if (!compact) throw new Error(`série ${sym} ${tf} ausente nos dados`);
  return engine.decodeSnapshot(compact);
}

// ------------------------------------------------------------------ saída

/**
 * Valida o caminho de saída: recusa dentro do repositório e recusa sobrescrever. Devolve o caminho absoluto.
 * @param {string} v caminho dado em --saida
 * @param {string} [raiz] raiz do repositório
 * @returns {string}
 */
export function validaSaida(v, raiz = RAIZ) {
  if (!v || typeof v !== 'string' || v.startsWith('--')) throw new Error('--saida exige um caminho de arquivo');
  const abs = path.resolve(v);
  if (dentroDoRepo(abs, raiz)) throw new Error('recuso gravar dentro do repositório (a ficha, o motor e o código não se tocam); use um caminho fora dele.');
  if (fs.existsSync(abs)) throw new Error('o arquivo de saída já existe; o estudo roda uma vez só e não sobrescreve.');
  return abs;
}

// ------------------------------------------------------------------ cálculo

/**
 * Roda as duas análises de uma série: os 7 setups novos (analyzeSetupsV12, `iters` sorteios) e os 8 do v1.1 (analyze()).
 * @param {object} d série decodificada
 * @param {string} sym ativo
 * @param {string} tf tempo gráfico
 * @param {number} [iters] sorteios do teste de permutação (a ficha: 3000)
 * @returns {{serie: string, novas: object[], v11: object[]}} linhas do motor (sem correção de família)
 */
export function calculaSerie(d, sym, tf, iters = SORTEIOS) {
  const serie = `${sym}_${tf}`;
  const novas = engine.analyzeSetupsV12(d, { ...CFG }, { iters, meta: { sym, tf } }).setups.map((s) => ({ ...s, serie, sym, tf }));
  const v11 = engine.analyze(d, { ...CFG }, { sym, tf }).setups.map((s) => ({ ...s, serie, sym, tf }));
  return { serie, novas, v11 };
}

/**
 * Aplica as duas famílias de correção (Benjamini-Hochberg do motor) em CÓPIAS das linhas.
 * Oficial: 135 = novas (63) + v1.1 (72), nessa ordem. Sensibilidade: 63 = só as novas.
 * Os valores de entrada não são alterados.
 * @param {object[]} novas as 63 linhas novas
 * @param {object[]} v11 as 72 linhas do v1.1
 * @returns {{f135: {novas: object[], v11: object[]}, f63: object[]}}
 */
export function montaFamilias(novas, v11) {
  if (novas.length !== 63) throw new Error(`esperadas 63 células novas, recebidas ${novas.length}`);
  if (v11.length !== 72) throw new Error(`esperadas 72 células do v1.1, recebidas ${v11.length}`);
  const lista135 = engine.applyFamily([...novas.map((r) => ({ ...r })), ...v11.map((r) => ({ ...r }))]);
  const f63 = engine.applyFamily(novas.map((r) => ({ ...r })));
  return { f135: { novas: lista135.slice(0, 63), v11: lista135.slice(63) }, f63 };
}

/** @param {number} q @param {number} familia @returns {string} "q = 0,042, família 135" */
export function rotuloQ(q, familia) {
  if (!Number.isFinite(q)) return `q indisponível, família ${familia}`;
  const txt = q < 0.0005 ? 'q < 0,001' : 'q = ' + q.toFixed(3).replace('.', ',');
  return `${txt}, família ${familia}`;
}

/** Bloco de uma família para uma célula: q, família, veredito do motor e o rótulo textual. */
function blocoFamilia(r) {
  return { q: r.q, familia: r.family, veredito: { key: r.verdict.key, label: r.verdict.label }, rotuloQ: rotuloQ(r.q, r.family) };
}

/** Walk-forward como o motor entrega; só acrescenta o horário dos candles de cada janela (o motor dá índices). */
function wfComHorario(wf, d) {
  if (!wf || !wf.available || !d) return wf;
  return { ...wf, walks: wf.walks.map((w) => ({ ...w, fromTime: isoDe(d.t[w.from]), toTime: isoDe(d.t[w.to]) })) };
}

/**
 * Registro de uma célula nova com o resultado nas duas famílias.
 * @param {object} base linha original do motor (analyzeSetupsV12)
 * @param {object} r135 mesma linha depois de applyFamily na família 135 (oficial)
 * @param {object} r63 mesma linha depois de applyFamily na família 63 (sensibilidade)
 * @param {object} [d] série (para o horário das janelas do walk-forward)
 */
export function celulaNova(base, r135, r63, d) {
  return {
    serie: base.serie, sym: base.sym, tf: base.tf, setup: base.id, nome: base.nome,
    nRaw: base.nRaw, n: base.n, nEff: base.nEff, wins: base.wins, winRate: base.winRate, ci: base.ci, method: base.method,
    base: base.base, diferencaParaBasePP: base.alphaPP, pHigh: base.pHigh, pLow: base.pLow, pTwo: base.pTwo,
    oficial135: blocoFamilia(r135), sensibilidade63: blocoFamilia(r63),
    wf: wfComHorario(base.wf, d)
  };
}

/**
 * Registro de uma célula do v1.1: valor publicado da matriz ao lado do recálculo na família 135.
 * @param {object} pub célula da matriz publicada (tests/fixtures/study-v1.1-matrix.json)
 * @param {object} r135 linha do motor depois de applyFamily na família 135
 */
export function celulaV11(pub, r135) {
  return {
    serie: `${pub.sym}_${pub.tf}`, sym: pub.sym, tf: pub.tf, setup: pub.id,
    publicado: { familia: 72, q: pub.q, qEhLimiteSuperior: !!pub.qIsUpperBound, veredito: pub.verdict, rotuloQ: rotuloQ(pub.q, 72) },
    recalculo135: { rotulo: ROTULO_RECALCULO, ...blocoFamilia(r135) }
  };
}

/**
 * Conta vereditos (todas as cinco chaves, zeradas se ausentes).
 * @param {object[]} itens
 * @param {(x: object) => string} chave função que devolve a chave de veredito do item
 * @returns {Record<string, number>}
 */
export function contaVereditos(itens, chave) {
  const c = Object.fromEntries(VEREDITOS.map((k) => [k, 0]));
  for (const it of itens) {
    const k = chave(it);
    if (!(k in c)) throw new Error('chave de veredito desconhecida: ' + k);
    c[k]++;
  }
  return c;
}

/**
 * Contagem de vereditos de uma família: total e por setup (as 9 séries de cada setup).
 * @param {object[]} celulas células novas já montadas
 * @param {(c: object) => string} chave
 */
export function contagemPorFamilia(celulas, chave) {
  const ids = [...new Set(celulas.map((c) => c.setup))];
  return { total: contaVereditos(celulas, chave), porSetup: Object.fromEntries(ids.map((id) => [id, contaVereditos(celulas.filter((c) => c.setup === id), chave)])) };
}

/**
 * Monta o bloco de resultados a partir das células novas (já com as duas famílias) e das 72 do v1.1.
 * @param {object[]} novas 63 células de celulaNova
 * @param {object[]} v11 72 células de celulaV11
 */
export function montaResultados(novas, v11) {
  return {
    celulasNovas: novas,
    contagem: {
      oficial135: contagemPorFamilia(novas, (c) => c.oficial135.veredito.key),
      sensibilidade63: contagemPorFamilia(novas, (c) => c.sensibilidade63.veredito.key)
    },
    recalculoV11: {
      rotulo: ROTULO_RECALCULO,
      nota: 'Os valores publicados do v1.1 (família 72) não mudam. O recálculo na família 135 existe só para comparação.',
      celulas: v11,
      contagemPublicada: contaVereditos(v11, (c) => c.publicado.veredito),
      contagemRecalculo135: contaVereditos(v11, (c) => c.recalculo135.veredito.key)
    }
  };
}

/**
 * Texto do modo --so-fumaca. Só diz que executou, quantos gatilhos cada setup teve e o tempo.
 * NÃO inclui taxa de acerto, p, q nem veredito (o estudo roda uma vez só e quem roda a fumaça não pode ver resultado).
 * @param {string} serie ex.: "ETHUSDT_1d"
 * @param {Record<string, number>} gatilhos id do setup → nº de gatilhos brutos
 * @param {number} ms tempo em milissegundos
 * @returns {string}
 */
export function formataFumaca(serie, gatilhos, ms) {
  const lista = Object.entries(gatilhos).map(([id, n]) => `${id} ${Math.trunc(n)}`).join(', ');
  return `executou: ${serie}, gatilhos por setup: ${lista}, ${Math.round(ms)} ms`;
}

// ------------------------------------------------------------------ modos

/** Modo --so-fumaca: ETHUSDT 1d, 50 sorteios, imprime só "executou", gatilhos e tempo. */
export function fumaca(log = console.log) {
  carregaFicha();
  const t0 = agora();
  const d = carregaSerie('ETHUSDT', '1d', {});
  const r = engine.analyzeSetupsV12(d, { ...CFG }, { iters: 50 });
  const gatilhos = Object.fromEntries(r.setups.map((s) => [s.id, s.nRaw]));
  log(formataFumaca('ETHUSDT_1d', gatilhos, agora() - t0));
}

/** SHA-256 (hex) do conteúdo em bytes de um arquivo. */
export function sha256Arquivo(arquivo) {
  return createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
}

/** Lança erro se o motor carregado não for a versão que a ficha pressupõe. */
export function confereMotor(versao = engine.VERSION) {
  if (versao !== VERSAO_MOTOR) throw new Error(`versão do motor inesperada (${versao}); o estudo exige ${VERSAO_MOTOR}.`);
}

/**
 * Parte PURA do estudo: confere a ficha (hash, regra, séries e ids), monta as famílias 135 e 63, os vereditos
 * e o documento de saída a partir das análises JÁ calculadas. Não lê arquivo, relógio nem a pasta data/.
 * @param {object} p
 * @param {any} p.ficha ficha lida (o hash é conferido aqui de novo)
 * @param {{cells: object[]}} p.matriz matriz publicada do v1.1 (72 células)
 * @param {Record<string, {d: object, novas: object[], v11: object[]}>} p.analises por série (`ATIVO_tf`): série decodificada e saída de calculaSerie
 * @param {{versaoDoMotor: string, sha256Motor: string, sha256Script: string, executadoEmUTC: string, node: string, tempoSegundos: number}} p.execucao
 * @returns {object} documento pronto para gravar
 */
export function montaDocumento({ ficha, matriz, analises, execucao }) {
  confereFicha(ficha);
  confereMotor(execucao.versaoDoMotor);
  if (matriz.cells.length !== 72) throw new Error(`esperadas 72 células na matriz publicada do v1.1, obtidas ${matriz.cells.length}`);
  const series = {}, brutasNovas = [], v11PorChave = new Map(), seriesDec = {};
  for (const tf of TEMPOS) for (const sym of ATIVOS) {
    const key = `${sym}_${tf}`, a = analises[key];
    if (!a) throw new Error(`análise ausente: ${key}`);
    confereCorte(a.d, ficha.series.cutoff);
    series[key] = registroDaSerie(a.d);
    seriesDec[key] = a.d;
    brutasNovas.push(...a.novas);
    for (const s of a.v11) v11PorChave.set(`${key}|${s.id}`, s);
  }
  if (brutasNovas.length !== 63) throw new Error(`esperadas 63 células novas, obtidas ${brutasNovas.length}`);
  // as 72 do v1.1 na ordem da matriz publicada, como tests/study-v1.1.test.js
  const brutasV11 = matriz.cells.map((c) => {
    const s = v11PorChave.get(`${c.sym}_${c.tf}|${c.id}`);
    if (!s) throw new Error(`célula do v1.1 sem linha no motor: ${c.sym} ${c.tf} ${c.id}`);
    return s;
  });

  const { f135, f63 } = montaFamilias(brutasNovas, brutasV11);
  const novas = brutasNovas.map((b, k) => celulaNova(b, f135.novas[k], f63[k], seriesDec[b.serie]));
  const v11 = matriz.cells.map((c, k) => celulaV11(c, f135.v11[k]));
  const res = montaResultados(novas, v11);

  return {
    meta: {
      estudo: ficha.study, versaoDoMotor: execucao.versaoDoMotor, fichaHash: HASH_FICHA,
      sha256Motor: execucao.sha256Motor, sha256Script: execucao.sha256Script,
      executadoEmUTC: execucao.executadoEmUTC, node: execucao.node, tempoSegundos: execucao.tempoSegundos,
      regraDeSaida: { mode: CFG.mode, alvoATR: CFG.tgt, stopATR: CFG.stp, prazoCandles: CFG.hold, empateNoMesmoCandle: ficha.exit_rule.tie_same_candle },
      sorteios: SORTEIOS, corte: ficha.series.cutoff, familiaOficial: 135, familiaSensibilidade: 63,
      series,
      nota: 'NaN e infinito saem como null no JSON. Todo p ajustado vem com a família ("q = 0,xxx, família 135"). A diferença para a base é em pontos percentuais (taxa de acerto menos taxa-base).'
    },
    ...res
  };
}

/**
 * Grava o documento. Nunca sobrescreve (flag 'wx'): o estudo roda uma vez só.
 * @param {string} saida caminho absoluto já validado por validaSaida
 * @param {object} doc
 */
export function gravaSaida(saida, doc) {
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, JSON.stringify(doc, null, 1), { flag: 'wx' });
}

/**
 * Estudo completo. Lê as 9 séries, chama o motor, monta o documento (montaDocumento) e grava UM arquivo JSON.
 * Só imprime progresso.
 * @param {string} saida caminho absoluto já validado por validaSaida
 * @param {(m: string) => void} [log] progresso (stderr por padrão)
 */
export function estudo(saida, log = (m) => console.error(m)) {
  const ficha = carregaFicha();
  confereMotor();
  const inicio = agora();
  const matriz = JSON.parse(fs.readFileSync(MATRIZ_V11, 'utf8'));
  const cache = {}, analises = {};
  for (const tf of TEMPOS) for (const sym of ATIVOS) {
    const key = `${sym}_${tf}`, t0 = agora();
    const d = carregaSerie(sym, tf, cache);
    confereCorte(d, ficha.series.cutoff);
    const r = calculaSerie(d, sym, tf, SORTEIOS);
    analises[key] = { d, novas: r.novas, v11: r.v11 };
    log(`[${key}] concluída em ${Math.round(agora() - t0)} ms`);
  }
  const doc = montaDocumento({
    ficha, matriz, analises,
    execucao: {
      versaoDoMotor: engine.VERSION, sha256Motor: sha256Arquivo(ARQUIVO_MOTOR), sha256Script: sha256Arquivo(ARQUIVO_SCRIPT),
      executadoEmUTC: new Date().toISOString(), node: process.version, tempoSegundos: Math.round((agora() - inicio) / 1000)
    }
  });
  gravaSaida(saida, doc);
  log(`Estudo concluído em ${Math.round((agora() - inicio) / 1000)} s: 63 células novas e 72 recalculadas. Saída: ${saida}`);
}

export function uso() {
  return `Estudo v1.2 (ficha docs/estudo-v1.2-pre-registro.json, hash ${HASH_FICHA.slice(0, 8)}...)

Uso:
  node tools/estudo-v12.mjs --saida <arquivo.json>   estudo completo (63 células novas + 72 recalculadas); roda uma vez só
                                                    o arquivo fica FORA do repositório e não pode já existir
  node tools/estudo-v12.mjs --so-fumaca              ETHUSDT_1d, 50 sorteios; imprime só "executou", gatilhos por setup e tempo
  node tools/estudo-v12.mjs --ajuda                  esta mensagem

O console só recebe progresso. Taxa de acerto, p, q e vereditos ficam só no arquivo de saída.`;
}

/**
 * @param {string[]} args
 * @param {{fumaca?: Function, estudo?: Function, validaSaida?: Function}} [deps] injeção (os testes passam funções falsas: nunca chegam a data/)
 * @returns {number} código de saída
 */
export function main(args = process.argv.slice(2), deps = {}) {
  const { fumaca: rodaFumaca = fumaca, estudo: rodaEstudo = estudo, validaSaida: valida = validaSaida } = deps;
  try {
    if (args.includes('--ajuda') || args.includes('-h') || args.length === 0) { console.log(uso()); return 0; }
    const fuma = args.includes('--so-fumaca'), temSaida = args.includes('--saida');
    if (fuma && temSaida) throw new Error('escolha um modo: --so-fumaca ou --saida.');
    if (fuma) { rodaFumaca(); return 0; }
    if (temSaida) { rodaEstudo(valida(args[args.indexOf('--saida') + 1])); return 0; }
    console.log(uso());
    return 1;
  } catch (e) {
    console.error('ERRO: ' + (e && e.message ? e.message : e));
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
