// Agente de Risco do Relatório Estratégico: regras determinísticas sobre o summary do motor.
// Puro: sem rede, sem relógio, sem aleatório, sem LLM. Todo limiar vem do motor (fonteLimiar);
// nenhum limiar novo é criado aqui. Os textos descrevem a evidência; não orientam operação.

export const VERSAO_REGRAS = 'risco-1';

// Origem dos limiares (arquivo:linha de engine/index.js, motor 1.3.0).
const F_NEFF = 'engine/index.js:528 (verdictOf: nEff < 10)';
const F_Q = 'engine/index.js:530 (verdictOf: q < 0.05)';
const F_ABAIXO = 'engine/index.js:531 (verdictOf: winRate < base)';
const F_WF = 'engine/index.js:463 (walkForward: queda de treino para teste > 0.15)';
const F_REGIME = 'engine/index.js:309 (regimeSeries: Chow p < 0.01)';
const F_CALIB = 'engine/index.js:523 (calibStatus: k "bad" ou "na")';
const F_FONTE = 'lib/analysis-summary.js:66 (withProvenance: avisos de fonte)';

const LIM = { nEffMin: 10, q: 0.05, queda: 0.15 };

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Mesma regra de engine/index.js verdictOf, sobre os campos do summary. */
function veredito(s) {
  if (!(num(s.nEff) !== null && s.nEff >= LIM.nEffMin)) return 'INSUFICIENTE';
  const q = num(s.q) !== null ? s.q : s.pTwo;
  if (!(q < LIM.q)) return 'SEM_EDGE';
  if (s.winRate < s.base) return 'ABAIXO';
  if (s.wf && s.wf.available && !s.wf.consistent) return 'EDGE_SENSIVEL';
  return 'EDGE';
}

function vetosDe(s, key) {
  const c = `setups[id=${s.id}]`;
  switch (key) {
    case 'INSUFICIENTE':
      return ['evidencia_insuficiente', `${c}.nEff`, s.nEff ?? null, LIM.nEffMin, F_NEFF];
    case 'SEM_EDGE': {
      const usaQ = num(s.q) !== null;
      return ['sem_edge_q', `${c}.${usaQ ? 'q' : 'pTwo'}`, (usaQ ? s.q : s.pTwo) ?? null, LIM.q, F_Q];
    }
    case 'ABAIXO':
      return ['abaixo_da_base', `${c}.winRate`, s.winRate, s.base, F_ABAIXO];
    case 'EDGE_SENSIVEL': {
      const falhas = [];
      s.wf.walks.forEach((w, i) => {
        if (w.overfit) falhas.push({ janela: i + 1, fromTime: w.fromTime ?? null, toTime: w.toTime ?? null, trainWR: w.trainWR, testWR: w.testWR, dropPP: w.dropPP });
      });
      return ['walk_forward_inconsistente', `${c}.wf.walks`, falhas, LIM.queda, F_WF];
    }
    default:
      return null;
  }
}

const ESTADO = { INSUFICIENTE: 'evidencia_insuficiente', SEM_EDGE: 'sem_edge', ABAIXO: 'sem_edge', EDGE_SENSIVEL: 'veto_risco', EDGE: 'em_avaliacao' };

/**
 * @param {object[]} summaries saídas de summarize(), uma por série
 * @returns {{agente:'risco', versaoRegras:string, teses:object[], avisos:object[]}}
 */
export function avaliarRisco(summaries) {
  const teses = [];
  const avisos = [];
  for (const sm of Array.isArray(summaries) ? summaries : []) {
    const serie = { symbol: sm.input.symbol, timeframe: sm.input.timeframe };
    for (const s of sm.setups || []) {
      const key = veredito(s);
      const v = vetosDe(s, key);
      teses.push({
        serie: { ...serie }, setupId: s.id, estado: ESTADO[key],
        vetos: v ? [{ regra: v[0], campo: v[1], valor: v[2], limiar: v[3], fonteLimiar: v[4] }] : []
      });
    }
    const reg = sm.regime && sm.regime.current;
    if (reg && reg.regime === 'STRUCTURAL_BREAK') {
      avisos.push({ serie: { ...serie }, regra: 'regime_quebra_estrutural', campo: 'regime.current.regime', valor: reg.regime, limiar: 'STRUCTURAL_BREAK', fonteLimiar: F_REGIME });
    }
    const k = sm.calibration && sm.calibration.status && sm.calibration.status.k;
    if (k === 'bad' || k === 'na') {
      avisos.push({ serie: { ...serie }, regra: 'calibracao_fraca', campo: 'calibration.status.k', valor: k, limiar: ['bad', 'na'], fonteLimiar: F_CALIB });
    }
    for (const campo of ['liveError', 'dbError']) {
      const val = sm.data && sm.data[campo];
      if (val) avisos.push({ serie: { ...serie }, regra: campo === 'liveError' ? 'falha_fonte_ao_vivo' : 'banco_indisponivel', campo: `data.${campo}`, valor: val, limiar: 'ausente', fonteLimiar: F_FONTE });
    }
  }
  return { agente: 'risco', versaoRegras: VERSAO_REGRAS, teses, avisos };
}
