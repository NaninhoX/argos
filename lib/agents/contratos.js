// Contratos dos agentes do Relatório Estratégico: constantes, id de prova, leitura de valor do summary
// por caminho e validadores de forma. Tudo puro: sem rede, sem relógio, sem aleatório. Os validadores
// nunca lançam; devolvem { ok: true } ou { ok: false, erros: [string] }.

export const AGENTES = ['risco', 'debate', 'montagem', 'revisao'];

export const SECOES = [
  { n: 1, titulo: 'Contexto de Regime' },
  { n: 2, titulo: 'Teses em Avaliação' },
  { n: 3, titulo: 'Debate' },
  { n: 4, titulo: 'Avaliação de Risco e vetos' },
  { n: 5, titulo: 'Cenário Teórico' },
  { n: 6, titulo: 'Calibração' }
];

export const ESTADOS_TESE = ['evidencia_insuficiente', 'sem_edge', 'veto_risco', 'em_avaliacao'];
export const ESTADOS_RELATORIO = ['aguardando_aprovacao', 'bloqueado', 'falhou'];
/** Igual ao check de revisao_humana em db/migrations/001_init.sql. */
export const DECISOES = ['aprovado', 'aprovado_com_ajustes', 'rejeitado'];
export const UNIDADES = ['fracao', 'pp', 'contagem', 'p'];

/** @param {number} n inteiro >= 1 @returns {string} */
export function provaId(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`provaId: n inteiro >= 1 esperado, veio ${String(n)}`);
  return 'P' + n;
}

const SEGMENTO = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(?:id=([^\]]+)|(\d+))\])?$/;

function dividirCaminho(caminho) {
  const partes = [];
  let atual = '';
  let dentro = false;
  for (const ch of caminho) {
    if (ch === '[') dentro = true;
    else if (ch === ']') dentro = false;
    if (ch === '.' && !dentro) { partes.push(atual); atual = ''; } else atual += ch;
  }
  partes.push(atual);
  return partes;
}

/**
 * Lê um valor do summary por caminho: `calibration.ece`, `setups[id=RSI_OVERSOLD].winRate`, `x[3]`.
 * Devolve undefined se não achar; lança só por sintaxe inválida.
 * @param {object} summary saída de summarize()
 * @param {string} caminho
 */
export function resolverCaminho(summary, caminho) {
  if (typeof caminho !== 'string' || caminho === '') throw new Error('resolverCaminho: caminho vazio ou não textual');
  const segmentos = dividirCaminho(caminho).map((s) => {
    const m = SEGMENTO.exec(s);
    if (!m) throw new Error(`resolverCaminho: sintaxe inválida em "${s}" (caminho "${caminho}")`);
    return { nome: m[1], id: m[2], idx: m[3] === undefined ? undefined : Number(m[3]) };
  });
  let cur = summary;
  for (const seg of segmentos) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, seg.nome)) return undefined;
    cur = cur[seg.nome];
    if (seg.id !== undefined) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur.find((x) => x !== null && typeof x === 'object' && String(x.id) === seg.id);
    } else if (seg.idx !== undefined) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg.idx];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

// ---------- auxiliares de validação ----------

const ehObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const ehTexto = (x) => typeof x === 'string' && x.length > 0;
const ehNumFinito = (x) => typeof x === 'number' && Number.isFinite(x);
const ehInt = (x) => Number.isInteger(x);
const HEX64 = /^[0-9a-f]{64}$/;
const ID_PROVA = /^P[1-9][0-9]*$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const resultado = (erros) => (erros.length ? { ok: false, erros } : { ok: true });

function listaDe(x, caminho, erros) {
  if (!Array.isArray(x)) { erros.push(`${caminho}: lista esperada`); return []; }
  return x;
}

function checarTextos(o, campos, caminho, erros) {
  for (const c of campos) if (!ehTexto(o[c])) erros.push(`${caminho}.${c}: texto não vazio esperado`);
}

function checarVeto(v, caminho, erros) {
  if (!ehObj(v)) { erros.push(`${caminho}: objeto esperado`); return; }
  checarTextos(v, ['regra', 'campo', 'fonteLimiar'], caminho, erros);
  if (v.valor === undefined) erros.push(`${caminho}.valor: obrigatório`);
  if (v.limiar === undefined) erros.push(`${caminho}.limiar: obrigatório`);
}

function checarSerie(s, caminho, erros) {
  if (!ehObj(s)) { erros.push(`${caminho}: objeto esperado`); return; }
  checarTextos(s, ['symbol', 'timeframe'], caminho, erros);
}

// ---------- validadores ----------

/** @param {unknown} p */
export function validarProva(p) {
  const erros = [];
  if (!ehObj(p)) return { ok: false, erros: ['prova: objeto esperado'] };
  if (typeof p.id !== 'string' || !ID_PROVA.test(p.id)) erros.push('id: formato "P<n>" esperado');
  if (!ehNumFinito(p.valor)) erros.push('valor: número finito esperado');
  if (!UNIDADES.includes(p.unidade)) erros.push(`unidade: uma de ${UNIDADES.join(', ')}`);
  if (p.ic95 !== null) {
    if (!Array.isArray(p.ic95) || p.ic95.length !== 2 || !p.ic95.every(ehNumFinito)) erros.push('ic95: [lo, hi] finitos ou null');
    else if (p.ic95[0] > p.ic95[1]) erros.push('ic95: lo deve ser <= hi');
  }
  if (p.n !== null && !(ehInt(p.n) && p.n >= 0)) erros.push('n: inteiro >= 0 ou null');
  for (const c of ['nEff', 'pBruto', 'pAjustado']) {
    if (p[c] !== null && !ehNumFinito(p[c])) erros.push(`${c}: número finito ou null`);
  }
  if (!ehObj(p.origem)) erros.push('origem: objeto esperado');
  else {
    if (typeof p.origem.resultHash !== 'string' || !HEX64.test(p.origem.resultHash)) erros.push('origem.resultHash: hex de 64 caracteres esperado');
    checarTextos(p.origem, ['seriesHash', 'engine', 'caminho'], 'origem', erros);
  }
  return resultado(erros);
}

/** @param {unknown} o */
export function validarRiscoSaida(o) {
  const erros = [];
  if (!ehObj(o)) return { ok: false, erros: ['saída de risco: objeto esperado'] };
  if (o.agente !== 'risco') erros.push('agente: "risco" esperado');
  if (!ehTexto(o.versaoRegras)) erros.push('versaoRegras: texto não vazio esperado');
  listaDe(o.teses, 'teses', erros).forEach((t, i) => {
    const c = `teses[${i}]`;
    if (!ehObj(t)) { erros.push(`${c}: objeto esperado`); return; }
    checarSerie(t.serie, `${c}.serie`, erros);
    if (!ehTexto(t.setupId)) erros.push(`${c}.setupId: texto não vazio esperado`);
    if (!ESTADOS_TESE.includes(t.estado)) erros.push(`${c}.estado: uma de ${ESTADOS_TESE.join(', ')}`);
    listaDe(t.vetos, `${c}.vetos`, erros).forEach((v, j) => checarVeto(v, `${c}.vetos[${j}]`, erros));
  });
  listaDe(o.avisos, 'avisos', erros).forEach((a, i) => {
    checarVeto(a, `avisos[${i}]`, erros);
    if (ehObj(a)) checarSerie(a.serie, `avisos[${i}].serie`, erros);
  });
  return resultado(erros);
}

function checarArgumentos(lista, caminho, erros) {
  listaDe(lista, caminho, erros).forEach((a, i) => {
    const c = `${caminho}[${i}]`;
    if (!ehObj(a)) { erros.push(`${c}: objeto esperado`); return; }
    if (!ehTexto(a.texto)) erros.push(`${c}.texto: texto não vazio esperado`);
    if (!Array.isArray(a.provas) || !a.provas.every((id) => typeof id === 'string' && ID_PROVA.test(id))) erros.push(`${c}.provas: lista de ids "P<n>" esperada`);
  });
}

/** @param {unknown} o */
export function validarDebateSaida(o) {
  const erros = [];
  if (!ehObj(o)) return { ok: false, erros: ['saída de debate: objeto esperado'] };
  if (o.agente !== 'debate') erros.push('agente: "debate" esperado');
  if (!['ok', 'falhou'].includes(o.status)) erros.push('status: "ok" ou "falhou" esperado');
  listaDe(o.itens, 'itens', erros).forEach((it, i) => {
    const c = `itens[${i}]`;
    if (!ehObj(it)) { erros.push(`${c}: objeto esperado`); return; }
    if (!ehTexto(it.setupId)) erros.push(`${c}.setupId: texto não vazio esperado`);
    checarArgumentos(it.pros, `${c}.pros`, erros);
    checarArgumentos(it.contras, `${c}.contras`, erros);
    listaDe(it.preMortem, `${c}.preMortem`, erros).forEach((m, j) => {
      const cm = `${c}.preMortem[${j}]`;
      if (!ehObj(m)) { erros.push(`${cm}: objeto esperado`); return; }
      checarTextos(m, ['metrica', 'provaLimiar', 'texto'], cm, erros);
    });
  });
  if (!ehObj(o.uso)) erros.push('uso: objeto esperado');
  else for (const c of ['tokensIn', 'tokensOut']) if (!(ehInt(o.uso[c]) && o.uso[c] >= 0)) erros.push(`uso.${c}: inteiro >= 0 esperado`);
  return resultado(erros);
}

/** @param {unknown} r */
export function validarRelatorio(r) {
  const erros = [];
  if (!ehObj(r)) return { ok: false, erros: ['relatório: objeto esperado'] };
  checarTextos(r, ['versao', 'rodadaId', 'disclaimer', 'motor'], 'relatório', erros);
  if (typeof r.geradoEm !== 'string' || !ISO.test(r.geradoEm) || Number.isNaN(Date.parse(r.geradoEm))) erros.push('geradoEm: data ISO esperada');
  if (!ESTADOS_RELATORIO.includes(r.estado)) erros.push(`estado: um de ${ESTADOS_RELATORIO.join(', ')}`);
  if (typeof r.relatorioHash !== 'string' || !HEX64.test(r.relatorioHash)) erros.push('relatorioHash: hex de 64 caracteres esperado');

  const ids = new Set();
  listaDe(r.provas, 'provas', erros).forEach((p, i) => {
    const v = validarProva(p);
    if (!v.ok) v.erros.forEach((e) => erros.push(`provas[${i}].${e}`));
    else if (ids.has(p.id)) erros.push(`provas[${i}].id: "${p.id}" repetido`);
    else ids.add(p.id);
  });

  if (!Array.isArray(r.secoes)) erros.push('secoes: lista esperada');
  else {
    if (r.secoes.length !== SECOES.length) erros.push(`secoes: ${SECOES.length} itens esperados, vieram ${r.secoes.length}`);
    r.secoes.forEach((s, i) => {
      const c = `secoes[${i}]`;
      if (!ehObj(s)) { erros.push(`${c}: objeto esperado`); return; }
      const esperado = SECOES[i];
      if (esperado && s.n !== esperado.n) erros.push(`${c}.n: ${esperado.n} esperado`);
      if (esperado && s.titulo !== esperado.titulo) erros.push(`${c}.titulo: "${esperado.titulo}" esperado`);
      listaDe(s.blocos, `${c}.blocos`, erros).forEach((b, j) => {
        const cb = `${c}.blocos[${j}]`;
        if (!ehObj(b)) { erros.push(`${cb}: objeto esperado`); return; }
        if (!ehTexto(b.texto)) erros.push(`${cb}.texto: texto não vazio esperado`);
        if (!Array.isArray(b.provas)) erros.push(`${cb}.provas: lista esperada`);
        else b.provas.forEach((id) => { if (!ids.has(id)) erros.push(`${cb}.provas: "${String(id)}" não existe em provas`); });
      });
    });
  }
  return resultado(erros);
}

/** @param {unknown} o */
export function validarRevisaoSaida(o) {
  const erros = [];
  if (!ehObj(o)) return { ok: false, erros: ['saída de revisão: objeto esperado'] };
  if (o.agente !== 'revisao') erros.push('agente: "revisao" esperado');
  if (typeof o.aprovadoPorRegras !== 'boolean') erros.push('aprovadoPorRegras: booleano esperado');
  listaDe(o.achados, 'achados', erros).forEach((a, i) => {
    if (!ehObj(a)) { erros.push(`achados[${i}]: objeto esperado`); return; }
    checarTextos(a, ['regra', 'detalhe'], `achados[${i}]`, erros);
    if (!(ehInt(a.secao) || ehTexto(a.secao))) erros.push(`achados[${i}].secao: inteiro ou texto esperado`);
  });
  if (o.llm !== null) {
    if (!ehObj(o.llm)) erros.push('llm: objeto ou null esperado');
    else {
      if (!ehTexto(o.llm.status)) erros.push('llm.status: texto não vazio esperado');
      if (!Array.isArray(o.llm.achados)) erros.push('llm.achados: lista esperada');
    }
  }
  return resultado(erros);
}
