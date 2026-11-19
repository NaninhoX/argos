// Montagem do Relatório Estratégico (agente 3): texto fixo em código, sem LLM, síncrono e determinístico.
// Entra o que o motor, o Risco e o Debate produziram; sai o relatório no contrato de `validarRelatorio`
// ou uma lista de bloqueios. Sem rede, sem relógio, sem acaso: `geradoEm` e `rodadaId` vêm de fora.
//
// Regra central: todo número escrito no texto de um bloco tem de ser de uma Prova citada nesse bloco, com a
// mesma formatação (`formatarProva`). Nada de nível de preço de `technical`, de `analyzeSetupsV12` ou do estudo v1.2.
import { REGIMES } from '../../engine/index.js';
import { hashCanonical } from '../canonical.js';
import { DISCLAIMER_PADRAO, scanText } from '../compliance.js';
import { SECOES, provaId, resolverCaminho, validarProva, validarRelatorio, validarRiscoSaida, validarDebateSaida } from './contratos.js';

export const VERSAO_RELATORIO = '1';

/**
 * Faixa de incerteza (decisão D4 pendente): prova com `ic95: null` só vale para unidade `contagem` ou `p`,
 * ou para um caminho desta lista (o motor ainda não calcula intervalo para eles). `[id=...]` vale como `[]`.
 * Fora o que a tarefa pediu (`calibration.*`), entram `base.rate`, `setups[].base` e `regime.current.confidence`,
 * que também não têm intervalo no summary.
 */
export const ISENCOES_IC_PENDENTES = [
  'calibration.ece', 'calibration.bss', 'calibration.brier', 'calibration.brierRef',
  'base.rate', 'setups[].base', 'regime.current.confidence'
];

const ROTULO_ESTADO = {
  evidencia_insuficiente: 'evidência insuficiente',
  sem_edge: 'sem vantagem demonstrável',
  veto_risco: 'vetada pelo Risco',
  em_avaliacao: 'em avaliação'
};
const SEM_DADO = 'Sem dado do motor para esta seção.';
const LITERAIS_FIXOS = ['IC 95%', 'D4', 'D5', 'D9'];

// ---------- formatação (uma só precisão por unidade, em todo lugar) ----------

const virgula = (s) => s.replace('.', ',');

/** @param {number} v @param {'fracao'|'pp'|'contagem'|'p'} unidade */
export function formatarValor(v, unidade) {
  if (unidade === 'fracao') return virgula((v * 100).toFixed(1)) + '%';
  if (unidade === 'pp') return virgula(v.toFixed(1)) + ' pp';
  if (unidade === 'p') return virgula(v.toFixed(3));
  return Number.isInteger(v) ? String(v) : virgula(v.toFixed(1));
}

/** Texto do valor de uma prova. */
export const formatarProva = (p) => formatarValor(p.valor, p.unidade);

const ehNum = (x) => typeof x === 'number' && Number.isFinite(x);
const rotuloSerie = (s) => `${s.input.symbol} ${s.input.timeframe}`;

// ---------- provas ----------

const FRACAO = new Set(['winRate', 'base', 'rate', 'confidence', 'ece', 'bss', 'brier', 'brierRef', 'share']);
const CONTAGEM = new Set(['n', 'nEff', 'nRaw', 'wins', 'runs', 'median', 'mean', 'bars', 'candles', 'w']);
const PVAL = new Set(['pTwo', 'q', 'pHigh', 'pLow']);

/** Unidade pelo último segmento do caminho; null se não houver regra. */
export function unidadePorCaminho(caminho) {
  if (/^regime\.transitions\.[A-Z_]+\.[A-Z_]+$/.test(caminho)) return 'contagem';
  const ult = caminho.split('.').pop().replace(/\[.*\]$/, '');
  if (FRACAO.has(ult)) return 'fracao';
  if (CONTAGEM.has(ult)) return 'contagem';
  if (PVAL.has(ult)) return 'p';
  return null;
}

const normalizar = (c) => c.replace(/\[id=[^\]]+\]/g, '[]');

function montarProva(summary, caminho, unidade) {
  const valor = resolverCaminho(summary, caminho);
  if (!ehNum(valor)) return null;
  const m = /^(setups\[id=[^\]]+\])\.winRate$/.exec(caminho);
  let ic95 = null; let n = null; let nEff = null; let pBruto = null; let pAjustado = null;
  if (m) {
    const s = resolverCaminho(summary, m[1]);
    if (Array.isArray(s.ci) && s.ci.length === 2 && s.ci.every(ehNum)) ic95 = [s.ci[0], s.ci[1]];
    if (Number.isInteger(s.n)) n = s.n;
    if (ehNum(s.nEff)) nEff = s.nEff;
    if (ehNum(s.pTwo)) pBruto = s.pTwo;
    if (ehNum(s.q)) pAjustado = s.q;
  }
  return {
    id: '', valor, unidade, ic95, n, nEff, pBruto, pAjustado,
    origem: { resultHash: summary.resultHash, seriesHash: summary.data.hash, engine: summary.engine, caminho }
  };
}

/**
 * Cria provas lendo cada valor do summary por `resolverCaminho`.
 * `caminhos`: textos (valem para todos os summaries) ou `{ caminho, unidade?, serie? }` (`serie` = "SIMBOLO tf").
 * Caminho que não resolve para número finito, ou sem unidade conhecida, não gera prova.
 * @param {object[]} summaries
 * @param {(string | { caminho: string, unidade?: string, serie?: string })[]} caminhos
 */
export function extrairProvas(summaries, caminhos) {
  const reg = novoRegistro([]);
  for (const c of caminhos) for (const s of summaries) reg.obter(s, c);
  return reg.lista();
}

function novoRegistro(base) {
  const porChave = new Map();
  const porId = new Map();
  let max = 0;
  const chave = (p) => `${p.origem.resultHash}|${p.origem.caminho}`;
  for (const p of base) {
    porChave.set(chave(p), p);
    porId.set(p.id, p);
    max = Math.max(max, Number(String(p.id).slice(1)) || 0);
  }
  const reg = {
    ausentes: [],
    obter(summary, entrada) {
      const e = typeof entrada === 'string' ? { caminho: entrada } : entrada;
      if (e.serie && e.serie !== rotuloSerie(summary)) return null;
      let unidade = e.unidade ?? unidadePorCaminho(e.caminho);
      if (!unidade) { reg.ausentes.push(`${rotuloSerie(summary)}: ${e.caminho} (unidade desconhecida)`); return null; }
      const nova = montarProva(summary, e.caminho, unidade);
      if (!nova) { reg.ausentes.push(`${rotuloSerie(summary)}: ${e.caminho}`); return null; }
      const k = chave(nova);
      if (porChave.has(k)) return porChave.get(k);
      max += 1;
      nova.id = provaId(max);
      porChave.set(k, nova);
      porId.set(nova.id, nova);
      return nova;
    },
    porId: (id) => porId.get(id),
    lista: () => [...porId.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  };
  return reg;
}

/** Motivo de recusa de uma prova, ou null. Aplica a regra da faixa de incerteza (D4). */
function motivoProva(p) {
  const v = validarProva(p);
  if (!v.ok) return `prova ${p?.id ?? '?'} inválida: ${v.erros.join('; ')}`;
  if (p.ic95 === null && p.unidade !== 'contagem' && p.unidade !== 'p' && !ISENCOES_IC_PENDENTES.includes(normalizar(p.origem.caminho))) {
    return `prova ${p.id} (${p.origem.caminho}) sem intervalo de confiança e fora de ISENCOES_IC_PENDENTES`;
  }
  return null;
}

// ---------- verificação de texto ----------

// Sinal conta: "-0,4" e "0,4" são números diferentes. O sinal vale colado ao número ou com um espaço, fora de
// palavra ("BTC-4" não é negativo). Antes de procurar, o texto passa por NFKC (dígito de largura total e
// sobrescrito viram ASCII) e toda variante de traço vira hífen; algarismo de outra escrita (\p{N}) também conta.
const TRACOS = /[‐-―−﹘﹣－]/g;
const NUMERO = /(?:(?<![\p{L}\p{N}_])- ?)?\p{N}+(?:,\p{N}+)?/gu;

/** Números de um texto, com sinal normalizado (qualquer traço vira hífen colado ao número). */
export function numerosDoTexto(texto) {
  const t = String(texto ?? '').normalize('NFKC').replace(TRACOS, '-');
  return (t.match(NUMERO) ?? []).map((x) => x.replace(/^- /, '-'));
}

/** Verdadeiro se o texto tem algarismo de qualquer escrita, inclusive sobrescrito e de largura total. */
export const temAlgarismo = (texto) => { const t = String(texto ?? ''); return /\p{N}/u.test(t) || /\p{N}/u.test(t.normalize('NFKC')); };

function tokensDe(p) {
  const t = [formatarProva(p)];
  if (p.ic95) t.push(formatarValor(p.ic95[0], p.unidade), formatarValor(p.ic95[1], p.unidade));
  if (p.n !== null) t.push(formatarValor(p.n, 'contagem'));
  if (p.nEff !== null) t.push(formatarValor(p.nEff, 'contagem'));
  if (p.pBruto !== null) t.push(formatarValor(p.pBruto, 'p'));
  if (p.pAjustado !== null) t.push(formatarValor(p.pAjustado, 'p'));
  return t.flatMap(numerosDoTexto);
}

function mascarar(texto, literais) {
  let s = texto;
  for (const l of [...LITERAIS_FIXOS, ...literais].filter(Boolean).sort((a, b) => b.length - a.length)) s = s.split(l).join(' ');
  return s;
}

// ---------- montagem ----------

const ESTADOS_DEBATE = ['em_avaliacao', 'veto_risco'];

/** Contexto de uma montagem: registro de provas, bloqueios e o construtor de blocos conferidos. */
function criarContexto(summaries, provasBase) {
  const bloqueios = [];
  const bloquear = (secao, motivo, trecho = '') => bloqueios.push({ secao, motivo, trecho });
  const reg = novoRegistro(Array.isArray(provasBase) ? provasBase : []);
  const literaisGerais = [
    ...summaries.map((s) => `${s.input.symbol} ${s.input.timeframe}`),
    ...summaries.flatMap((s) => s.setups.flatMap((x) => [x.id, x.nome]))
  ];
  const usadas = new Set();

  /** Monta um bloco e confere número, prova, conformidade. `extras`: números permitidos sem prova (limiar de regra). */
  const bloco = (secao, texto, provas, { literais = [], extras = [] } = {}) => {
    const ids = [...new Set(provas.map((p) => p.id))];
    for (const p of provas) {
      const m = motivoProva(p);
      if (m) bloquear(secao, m, texto.slice(0, 80));
      usadas.add(p.id);
    }
    const permitidos = new Set([...provas.flatMap(tokensDe), ...extras]);
    for (const tok of numerosDoTexto(mascarar(texto, [...literaisGerais, ...literais]))) {
      if (!permitidos.has(tok)) bloquear(secao, `número sem prova no bloco: ${tok}`, texto.slice(0, 120));
    }
    for (const f of scanText(texto)) bloquear(secao, `compliance (${f.rule})`, f.excerpt);
    return { texto, provas: ids };
  };
  const semDado = (secao, extra = '') => bloco(secao, SEM_DADO + extra, []);
  const porSerie = new Map(summaries.map((s) => [`${s.input.symbol}|${s.input.timeframe}`, s]));
  const achar = (serie) => porSerie.get(`${serie.symbol}|${serie.timeframe}`);
  return { bloqueios, bloquear, reg, usadas, bloco, semDado, achar };
}

/** Seções 1 e 2: regime e teses. */
function secoes12(ctx, summaries, risco) {
  const { reg, bloco, semDado, bloquear, bloqueios, achar } = ctx;
  // ----- 1. Contexto de Regime
  const s1 = summaries.map((s) => {
    const cur = s.regime.current;
    const conf = reg.obter(s, 'regime.current.confidence');
    const barras = reg.obter(s, 'regime.current.bars');
    if (!conf || !barras || typeof cur.label !== 'string') return semDado(1, ` (${rotuloSerie(s)})`);
    return bloco(1, `${rotuloSerie(s)}: regime atual "${cur.label}", confiança ${formatarProva(conf)}, em curso há ${formatarProva(barras)} barras.`, [conf, barras]);
  });

  // ----- 2. Teses em Avaliação
  const s2 = [];
  for (const t of risco.teses) {
    const s = achar(t.serie);
    const rot = `${t.serie.symbol} ${t.serie.timeframe}`;
    const cam = `setups[id=${t.setupId}]`;
    if (!s || !resolverCaminho(s, cam)) { bloquear(2, `tese sem summary ou setup correspondente: ${rot} ${t.setupId}`, rot); continue; }
    const wr = reg.obter(s, `${cam}.winRate`);
    const base = reg.obter(s, `${cam}.base`);
    if (!wr || !base) { bloquear(2, `dado do motor ausente para ${rot} ${t.setupId}`, `${cam}.winRate/base`); continue; }
    const nome = resolverCaminho(s, cam).nome ?? t.setupId;
    const nTxt = wr.nEff !== null ? `N efetivo ${formatarValor(wr.nEff, 'contagem')}` : `N efetivo não calculado pelo motor (N bruto ${formatarValor(wr.n ?? 0, 'contagem')})`;
    const ic = wr.ic95 ? `${formatarValor(wr.ic95[0], 'fracao')} a ${formatarValor(wr.ic95[1], 'fracao')}` : 'sem intervalo calculado pelo motor';
    const pAj = wr.pAjustado !== null
      ? `p ajustado na família de setups da série: ${formatarValor(wr.pAjustado, 'p')} (decisão D5 pendente)`
      : 'p ajustado não calculado pelo motor (decisão D5 pendente)';
    s2.push(bloco(2, `${rot} · ${nome}: estado ${ROTULO_ESTADO[t.estado]}. ${nTxt}. Taxa de acerto ${formatarProva(wr)} (IC 95% ${ic}), taxa-base ${formatarProva(base)}. ${pAj}.`, [wr, base], { literais: [nome] }));
  }
  if (s2.length === 0 && bloqueios.every((b) => b.secao !== 2)) s2.push(semDado(2));
  return { s1, s2 };
}

/** Seções 4, 5 e 6. */
function secoes456(ctx, summaries, risco) {
  const { reg, bloco, semDado, bloquear, bloqueios, achar } = ctx;
  // ----- 4. Avaliação de Risco e vetos
  const s4 = [];
  const regraTexto = (v, escopo, summary, setupId) => {
    const cands = (setupId ? [`setups[id=${setupId}].${v.campo}`] : []).concat([v.campo, `calibration.${v.campo}`, `regime.current.${v.campo}`, `data.${v.campo}`]);
    let prova = null;
    if (ehNum(v.valor)) {
      const cam = cands.find((c) => { try { return ehNum(resolverCaminho(summary, c)); } catch { return false; } });
      if (!cam) { bloquear(4, `valor do veto sem prova: campo "${v.campo}" não resolve no summary`, escopo); return null; }
      prova = reg.obter(summary, cam);
      if (!prova) { bloquear(4, `campo "${v.campo}" sem unidade conhecida`, escopo); return null; }
      if (Math.abs(prova.valor - v.valor) > 1e-9) { bloquear(4, `valor do veto difere do motor: ${v.valor} contra ${prova.valor}`, escopo); return null; }
    }
    const un = prova ? prova.unidade : 'contagem';
    const lim = ehNum(v.limiar) ? formatarValor(v.limiar, un) : String(v.limiar);
    const val = prova ? formatarProva(prova) : String(v.valor);
    return { prova, texto: `${escopo}: regra ${v.regra}, campo ${v.campo}, valor ${val}, limiar ${lim}, fonte do limiar ${v.fonteLimiar}.`, extras: numerosDoTexto(lim), literais: [v.regra, v.campo, v.fonteLimiar] };
  };
  for (const t of risco.teses) {
    const s = achar(t.serie);
    const rot = `${t.serie.symbol} ${t.serie.timeframe}`;
    if (!s) { bloquear(4, `veto sem summary da série ${rot}`, rot); continue; }
    for (const v of t.vetos) {
      const r = regraTexto(v, `Veto em ${rot} · ${t.setupId}`, s, t.setupId);
      if (r) s4.push(bloco(4, r.texto, r.prova ? [r.prova] : [], { extras: r.extras, literais: r.literais }));
    }
  }
  for (const a of risco.avisos) {
    const s = achar(a.serie);
    const rot = `${a.serie.symbol} ${a.serie.timeframe}`;
    if (!s) { bloquear(4, `aviso sem summary da série ${rot}`, rot); continue; }
    const r = regraTexto(a, `Aviso em ${rot}`, s, null);
    if (r) s4.push(bloco(4, r.texto, r.prova ? [r.prova] : [], { extras: r.extras, literais: r.literais }));
  }
  if (s4.length === 0 && bloqueios.every((b) => b.secao !== 4)) s4.push(bloco(4, 'O Risco não registrou vetos nem avisos para as teses avaliadas.', []));

  // ----- 5. Cenário Teórico (descrição histórica condicional, nunca instrução)
  const s5 = [];
  for (const s of summaries) {
    const cur = s.regime.current;
    const rot = rotuloSerie(s);
    const trans = s.regime.transitions?.[cur.regime];
    const teses = [...new Set(risco.teses.filter((t) => t.serie.symbol === s.input.symbol && t.serie.timeframe === s.input.timeframe).map((t) => t.setupId))];
    const destinos = trans && typeof trans === 'object' ? Object.keys(trans).sort() : [];
    if (destinos.length === 0 || teses.length === 0) { s5.push(semDado(5, ` (${rot})`)); continue; }
    const mediana = reg.obter(s, `regime.durations.${cur.regime}.median`);
    const corridas = reg.obter(s, `regime.durations.${cur.regime}.runs`);
    if (mediana && corridas) {
      s5.push(bloco(5, `${rot}: no regime "${cur.label}", a duração mediana histórica foi ${formatarProva(mediana)} barras em ${formatarProva(corridas)} ocorrências. Descrição do histórico, não previsão.`, [mediana, corridas]));
    }
    for (const dest of destinos) {
      const nTr = reg.obter(s, `regime.transitions.${cur.regime}.${dest}`);
      const rotDest = REGIMES[dest]?.label;
      if (!nTr || !rotDest) continue;
      const partes = []; const provas = [nTr];
      for (const sid of teses) {
        const w = reg.obter(s, `setups[id=${sid}].byRegime.${dest}.w`);
        const n = reg.obter(s, `setups[id=${sid}].byRegime.${dest}.n`);
        if (!w || !n) continue;
        const nome = resolverCaminho(s, `setups[id=${sid}]`).nome ?? sid;
        partes.push(`${nome} teve ${formatarProva(w)} acertos em ${formatarProva(n)} ocorrências`);
        provas.push(w, n);
      }
      if (partes.length === 0) continue;
      s5.push(bloco(5, `${rot}: se o regime mudar para "${rotDest}" (${formatarProva(nTr)} transições a partir de "${cur.label}" no histórico), os setups avaliados nesse regime foram assim: ${partes.join('; ')}. Leitura histórica condicional, sem previsão.`, provas, { literais: teses.map((sid) => resolverCaminho(s, `setups[id=${sid}]`).nome).filter(Boolean) }));
    }
  }
  if (s5.length === 0 || s5.every((b) => b.texto.startsWith(SEM_DADO))) { s5.length = 0; s5.push(semDado(5)); }

  // ----- 6. Calibração
  const s6 = summaries.map((s) => {
    const ece = reg.obter(s, 'calibration.ece');
    const bss = reg.obter(s, 'calibration.bss');
    const n = reg.obter(s, 'calibration.n');
    if (!ece || !bss || !n) return bloco(6, `${rotuloSerie(s)}: sem dado do motor para a calibração (previsões insuficientes).`, []);
    return bloco(6, `${rotuloSerie(s)}: ECE ${formatarProva(ece)} e BSS ${formatarProva(bss)} sobre ${formatarProva(n)} previsões; sem intervalo calculado pelo motor (decisão D4 pendente).`, [ece, bss, n]);
  });
  return { s4, s5, s6 };
}

/**
 * Seções determinísticas (1, 2, 4, 5 e 6), exatamente como `montarRelatorio` as monta. Função pura, sem LLM.
 * @param {{ summaries: object[], risco: object, provas?: object[] }} entrada
 * @returns {{ secoes: { 1: object[], 2: object[], 4: object[], 5: object[], 6: object[] }, provas: object[], bloqueios: { secao: number, motivo: string, trecho: string }[] }}
 */
export function montarSecoesDeterministicas({ summaries, risco, provas } = {}) {
  const ctx = criarContexto(summaries ?? [], provas);
  const { s1, s2 } = secoes12(ctx, summaries, risco);
  const { s4, s5, s6 } = secoes456(ctx, summaries, risco);
  return { secoes: { 1: s1, 2: s2, 4: s4, 5: s5, 6: s6 }, provas: ctx.reg.lista().filter((p) => ctx.usadas.has(p.id)), bloqueios: ctx.bloqueios };
}

/**
 * @param {{ summaries: object[], risco: object, debate: object, meta: { geradoEm: string, rodadaId: string, provas?: object[] } }} entrada
 * @returns {{ ok: true, relatorio: object } | { ok: false, bloqueios: { secao: number, motivo: string, trecho: string }[] }}
 */
export function montarRelatorio({ summaries, risco, debate, meta }) {
  if (!Array.isArray(summaries) || summaries.length === 0) return { ok: false, bloqueios: [{ secao: 0, motivo: 'sem summaries do motor', trecho: '' }] };
  const invalidos = [];
  const vr = validarRiscoSaida(risco);
  if (!vr.ok) invalidos.push({ secao: 4, motivo: 'saída do Risco inválida', trecho: vr.erros.join('; ') });
  const vd = validarDebateSaida(debate);
  if (!vd.ok) invalidos.push({ secao: 3, motivo: 'saída do Debate inválida', trecho: vd.erros.join('; ') });
  if (invalidos.length) return { ok: false, bloqueios: invalidos };
  const motores = [...new Set(summaries.map((s) => s.engine))];
  if (motores.length !== 1) return { ok: false, bloqueios: [{ secao: 0, motivo: 'summaries de versões diferentes do motor', trecho: motores.join(' | ') }] };

  const ctx = criarContexto(summaries, meta?.provas);
  const { reg, bloco, semDado, bloquear } = ctx;
  const { s1, s2 } = secoes12(ctx, summaries, risco);
  // ----- 3. Debate
  const s3 = [];
  if (debate.status === 'falhou') bloquear(3, 'debate falhou', 'status "falhou"');
  else {
    const provasDe = (ids, trecho) => ids.map((id) => {
      const p = reg.porId(id);
      if (!p) bloquear(3, `prova citada não existe: ${id}`, trecho.slice(0, 80));
      return p;
    }).filter(Boolean);
    const estadosDe = (setupId) => risco.teses.filter((t) => t.setupId === setupId).map((t) => t.estado);
    for (const it of debate.itens) {
      const lit = [it.setupId];
      const estados = estadosDe(it.setupId);
      if (!estados.some((e) => ESTADOS_DEBATE.includes(e))) {
        bloquear(3, `item de Debate para setup fora de em_avaliacao/veto_risco no Risco: ${it.setupId} (${estados.join(', ') || 'sem tese'})`, it.setupId);
      }
      for (const [rotulo, lista] of [['Prós', it.pros], ['Contras', it.contras]]) {
        for (const a of lista) {
          if (a.provas.length === 0) bloquear(3, `argumento sem prova em ${it.setupId}`, a.texto.slice(0, 80));
          s3.push(bloco(3, `${rotulo} (${it.setupId}): ${a.texto}`, provasDe(a.provas, a.texto), { literais: lit }));
        }
      }
      for (const m of it.preMortem) {
        if (temAlgarismo(m.metrica)) bloquear(3, 'número na métrica do Pré-Mortem (o número vem só da prova em provaLimiar)', String(m.metrica).slice(0, 80));
        let ps = [];
        if (/^P[1-9][0-9]*$/.test(m.provaLimiar)) ps = provasDe([m.provaLimiar], m.texto);
        else {
          const achada = reg.lista().find((p) => p.origem.caminho === m.provaLimiar);
          if (achada) ps = [achada]; else bloquear(3, `provaLimiar sem prova: ${m.provaLimiar}`, m.texto.slice(0, 80));
        }
        s3.push(bloco(3, `Pré-Mortem (${it.setupId}, métrica ${m.metrica}): ${m.texto}`, ps, { literais: lit })); // metrica não é literal: número nela só vale se vier da prova citada
      }
    }
    if (s3.length === 0) s3.push(semDado(3));
  }
  const { s4, s5, s6 } = secoes456(ctx, summaries, risco);
  if (ctx.bloqueios.length) return { ok: false, bloqueios: ctx.bloqueios };

  const blocosPorSecao = [s1, s2, s3, s4, s5, s6];
  const relatorio = {
    versao: VERSAO_RELATORIO,
    rodadaId: meta.rodadaId,
    geradoEm: meta.geradoEm,
    estado: 'aguardando_aprovacao',
    secoes: SECOES.map((sec, i) => ({ n: sec.n, titulo: sec.titulo, blocos: blocosPorSecao[i] })),
    provas: reg.lista().filter((p) => ctx.usadas.has(p.id)),
    disclaimer: DISCLAIMER_PADRAO,
    motor: motores[0]
  };
  const completo = { ...relatorio, relatorioHash: hashCanonical(relatorio) };
  const v = validarRelatorio(completo);
  if (!v.ok) return { ok: false, bloqueios: v.erros.map((e) => ({ secao: 0, motivo: 'relatório fora do contrato', trecho: e })) };
  return { ok: true, relatorio: completo };
}
