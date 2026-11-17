#!/usr/bin/env node
/**
 * Estudo de combinações de setups (pares e trios), exatamente como manda a ficha
 * docs/estudo-combinacoes-pre-registro.json (hash 76bcee77...). Só leitura sobre
 * engine/: o cálculo usa a cópia experimental tools/experimental/motor-confluencia.mjs.
 *
 * Uso:
 *   node tools/estudo-combinacoes.mjs --saida <arquivo.json>   roda o estudo completo (84 x 9 = 756 células)
 *   node tools/estudo-combinacoes.mjs --so-fumaca              ETHUSDT_1d, P01, 100 sorteios: só prova que executa
 *
 * Alvo e stop são parâmetros do teste, nunca orientação a ninguém.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as engine from '../engine/index.js';
import * as exp from './experimental/motor-confluencia.mjs';
import { seriesHash } from '../lib/analysis-summary.js';
import { hashCanonical } from '../lib/canonical.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FICHA = path.join(RAIZ, 'docs', 'estudo-combinacoes-pre-registro.json');
const HASH_FICHA = '76bcee77d3355117fb60908f9b996f3b1456017bcd17ea1cc61dec42990e33d8';
/** Regra de saída padrão da ficha: alvo 2×ATR, stop 1×ATR, prazo de 12 candles. */
const CFG = Object.freeze({ mode: 'atr', tgt: 2, stp: 1, hold: 12 });
const JANELA = 3, REFRATARIO = 12, SORTEIOS = 100000;

function uso() {
  console.log(`Estudo de combinações de setups (ficha docs/estudo-combinacoes-pre-registro.json)

Uso:
  node tools/estudo-combinacoes.mjs --saida <arquivo.json>   estudo completo (756 células); o caminho não pode ficar em docs/
  node tools/estudo-combinacoes.mjs --so-fumaca              ETHUSDT_1d, combinação P01, 100 sorteios; imprime só "executou", gatilhos e tempo
`);
}

/** @param {string} msg */
function aborta(msg) {
  console.error('ERRO: ' + msg);
  process.exit(1);
}

/**
 * Lê a ficha e confere o hash canônico registrado.
 * @returns {any} ficha canônica
 */
function carregaFicha() {
  const ficha = JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  const h = hashCanonical(ficha);
  if (h !== HASH_FICHA) aborta(`hash da ficha diverge do registrado (${h} ≠ ${HASH_FICHA}); a ficha não pode ser editada.`);
  return ficha;
}

/**
 * Carrega uma série como tests/study-v1.1.test.js (1h: histórico .json.gz; 4h e 1d: snapshot) e confere o seriesHash.
 * @param {any} ficha ficha canônica
 * @param {string} sym ativo
 * @param {string} tf tempo gráfico
 * @param {{snap?: any}} cache snapshot já lido
 * @returns {object} série decodificada
 */
function carregaSerie(ficha, sym, tf, cache) {
  let compact;
  if (tf === '1h') compact = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAIZ, 'data', 'history', `${sym}_1h.json.gz`))));
  else {
    if (!cache.snap) cache.snap = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', 'snapshot-v1.1.json'), 'utf8'));
    compact = cache.snap.series[`${sym}_${tf}`];
  }
  const d = engine.decodeSnapshot(compact);
  const decl = ficha.dados.series.find((s) => s.ativo === sym && s.tempoGrafico === tf);
  if (!decl) aborta(`série ${sym} ${tf} não consta na ficha`);
  const h = seriesHash(d);
  if (h !== decl.seriesHash) aborta(`seriesHash de ${sym} ${tf} diverge da ficha (${h} ≠ ${decl.seriesHash}); dados alterados, estudo recusado.`);
  if (d.n !== decl.candles) aborta(`número de candles de ${sym} ${tf} diverge da ficha (${d.n} ≠ ${decl.candles})`);
  return d;
}

const agora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function fumaca() {
  const ficha = carregaFicha();
  const t0 = agora();
  const d = carregaSerie(ficha, 'ETHUSDT', '1d', {});
  const p01 = ficha.combinacoes.find((c) => c.id === 'P01');
  const r = exp.analyzeConfluence(d, CFG, p01.setups, { window: JANELA, refractory: REFRATARIO, iters: 100 });
  console.log(`executou: ETHUSDT_1d ${p01.id} (${p01.setups.join('+')}), gatilhos brutos ${r.nRaw}, ${Math.round(agora() - t0)} ms`);
}

/** Condição (iv) e demais campos de uma célula. */
function montaCelula(comb, key, sym, tf, r, comps) {
  const cond = {
    i: null, // definida depois da família de 756 (o veredito de família 1 não vale)
    ii: Number.isFinite(r.ci[0]) && r.ci[0] > r.base,
    iii: !!(r.wf && r.wf.available && r.wf.consistent && r.n >= 20),
    iv: comb.setups.every((id) => r.alphaPP > comps[id].alphaPP)
  };
  return {
    id: comb.id, serie: key, sym, tf, setups: comb.setups,
    nRaw: r.nRaw, n: r.n, wins: r.wins, winRate: r.winRate, ci: r.ci, method: r.method, nEff: r.nEff, base: r.base, alphaPP: r.alphaPP,
    pHigh: r.pHigh, pLow: r.pLow, pTwo: r.pTwo, q: NaN, familia: 756,
    verdict: null, wf: { available: !!(r.wf && r.wf.available), consistent: r.wf && r.wf.available ? r.wf.consistent : null },
    componentesAlphaPP: Object.fromEntries(comb.setups.map((id) => [id, comps[id].alphaPP])),
    condicoes: cond, cumpreQuatro: false, candidata: false
  };
}

function estudo(saida) {
  const ficha = carregaFicha();
  const inicio = agora();
  const ativos = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'], tfs = ['1h', '4h', '1d'], cache = {};
  const celulas = [], componentes = [], v11 = [];
  const brutos = []; // objetos de trabalho (com wf e pTwo) na mesma ordem de `celulas`
  for (const tf of tfs) for (const sym of ativos) {
    const key = `${sym}_${tf}`, t0 = agora();
    const d = carregaSerie(ficha, sym, tf, cache);
    const ctx = exp.confluenceContext(d, CFG); // contexto uma vez por série
    // componentes isolados (condição iv): refratário 12, 1 sorteio (o p não é usado)
    const comps = {};
    for (const id of ficha.setupsComponentes) {
      const r = exp.analyzeConfluence(d, CFG, [id], { window: JANELA, refractory: REFRATARIO, iters: 1, ctx });
      comps[id] = { alphaPP: r.alphaPP, nRaw: r.nRaw, n: r.n, wins: r.wins, winRate: r.winRate, nEff: r.nEff };
      componentes.push({ serie: key, sym, tf, id, ...comps[id] });
    }
    for (const comb of ficha.combinacoes) {
      const r = exp.analyzeConfluence(d, CFG, comb.setups, { window: JANELA, refractory: REFRATARIO, iters: SORTEIOS, ctx });
      celulas.push(montaCelula(comb, key, sym, tf, r, comps));
      brutos.push(r);
    }
    // v1.1 oficial (engine.analyze) sobre a mesma série, só para a sensibilidade da família 828
    for (const s of engine.analyze(d, { ...CFG }, { sym, tf }).setups) v11.push({ pTwo: s.pTwo, nEff: s.nEff, winRate: s.winRate, base: s.base, wf: s.wf });
    console.error(`[${key}] ${Math.round(agora() - t0)} ms`);
  }
  if (celulas.length !== 756) aborta(`esperadas 756 células, obtidas ${celulas.length}`);
  if (v11.length !== 72) aborta(`esperadas 72 células do v1.1, obtidas ${v11.length}`);
  // as contagens de gatilhos têm de fechar com a ficha registrada (84 combinações, soma nas 9 séries)
  for (const comb of ficha.combinacoes) {
    const s = celulas.filter((c) => c.id === comb.id).reduce((a, c) => a + c.nRaw, 0);
    if (s !== comb.gatilhosSomados9Series) aborta(`gatilhos de ${comb.id} (${s}) divergem da ficha (${comb.gatilhosSomados9Series})`);
  }

  // família oficial 756 (Benjamini-Hochberg do motor)
  engine.applyFamily(brutos);
  brutos.forEach((r, k) => {
    const c = celulas[k];
    c.q = r.q; c.familia = r.family; c.verdict = { key: r.verdict.key, label: r.verdict.label };
    c.condicoes.i = r.verdict.key === 'EDGE';
    c.cumpreQuatro = c.condicoes.i && c.condicoes.ii && c.condicoes.iii && c.condicoes.iv;
  });
  // candidatas ao Estágio 2: cumpre (i)-(iv) e alphaPP > 0 no mesmo tempo gráfico em outro ativo com nEff >= 10
  for (const c of celulas) {
    if (!c.cumpreQuatro) continue;
    c.candidata = celulas.some((o) => o.id === c.id && o.tf === c.tf && o.sym !== c.sym && o.alphaPP > 0 && o.nEff >= 10);
  }

  // sensibilidade: família 828 (756 + 72 do v1.1); a 891 é condicional ao v1.2 ter sido executado
  const fam828 = [...brutos.map((r) => ({ pTwo: r.pTwo, nEff: r.nEff, winRate: r.winRate, base: r.base, wf: r.wf })), ...v11.map((s) => ({ ...s }))];
  engine.applyFamily(fam828);
  const mudam = [];
  celulas.forEach((c, k) => { if (fam828[k].verdict.key !== c.verdict.key) mudam.push({ id: c.id, serie: c.serie, de: c.verdict.key, para: fam828[k].verdict.key, q756: c.q, q828: fam828[k].q }); });

  const contagem = (f) => celulas.filter(f).length;
  const vereditos = {};
  for (const c of celulas) vereditos[c.verdict.key] = (vereditos[c.verdict.key] || 0) + 1;
  const candidatas = celulas.filter((c) => c.candidata).map((c) => ({ id: c.id, serie: c.serie, alphaPP: c.alphaPP, q: c.q, n: c.n, nEff: c.nEff }));
  const resumo = {
    celulas: celulas.length, vereditos,
    condicoes: { i: contagem((c) => c.condicoes.i), ii: contagem((c) => c.condicoes.ii), iii: contagem((c) => c.condicoes.iii), iv: contagem((c) => c.condicoes.iv) },
    cumpremAsQuatro: contagem((c) => c.cumpreQuatro), candidatasEstagio2: candidatas.length, candidatas,
    gatilhosBrutosSomados: celulas.reduce((s, c) => s + c.nRaw, 0),
    sensibilidade828: { tamanho: 828, celulasQueMudamDeVeredito: mudam.length, mudancas: mudam },
    familia891: 'NÃO reportada: é condicional ao estudo v1.2 ter sido executado, e ele não foi (ficha, seção "Família de correção").'
  };
  const doc = {
    estudo: ficha.estudo, fichaHash: HASH_FICHA, motor: 'tools/experimental/motor-confluencia.mjs (cópia de argos-engine 1.1.0 + adições do 1.2.0)',
    cfg: CFG, janela: JANELA, refratario: REFRATARIO, sorteios: SORTEIOS, semente: 42, familiaOficial: 756,
    nota: 'NaN sai como null no JSON. Todo p ajustado é "q, família 756, combinações".',
    resumo, componentes, celulas
  };
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, JSON.stringify(doc, null, 1), { flag: 'wx' }); // nunca sobrescreve: o estudo roda uma vez só

  console.log(`Estudo concluído em ${Math.round((agora() - inicio) / 1000)} s. Saída: ${saida}`);
  console.log(`Células: ${resumo.celulas} (família oficial 756, combinações); gatilhos brutos somados: ${resumo.gatilhosBrutosSomados}`);
  console.log('Vereditos: ' + Object.entries(vereditos).map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log(`Condições cumpridas: (i) ${resumo.condicoes.i} · (ii) ${resumo.condicoes.ii} · (iii) ${resumo.condicoes.iii} · (iv) ${resumo.condicoes.iv}`);
  console.log(`Cumprem as quatro: ${resumo.cumpremAsQuatro} · candidatas ao Estágio 2: ${resumo.candidatasEstagio2}${candidatas.length ? ' (' + candidatas.map((c) => `${c.id} ${c.serie}`).join(', ') + ')' : ''}`);
  console.log(`Sensibilidade família 828: ${mudam.length} células mudam de veredito. Família 891: não reportada (v1.2 não foi executado).`);
}

const args = process.argv.slice(2);
if (args.includes('--so-fumaca')) fumaca();
else if (args.includes('--saida')) {
  const v = args[args.indexOf('--saida') + 1];
  if (!v || v.startsWith('--')) aborta('--saida exige um caminho de arquivo');
  const abs = path.resolve(v);
  const rel = path.relative(RAIZ, abs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) aborta('recuso gravar dentro do repositório (a ficha, o motor e o código não se tocam); use um caminho fora dele.');
  if (fs.existsSync(abs)) aborta('o arquivo de saída já existe; o estudo roda uma vez só e não sobrescreve.');
  estudo(abs);
} else uso();
