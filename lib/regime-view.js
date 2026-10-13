// Recorte descritivo do banco de setups por regime de mercado.
//
// Módulo puro: recebe o motor (REGIMES, effectiveN, wilson, bayesWR) e o resultado de `E.analyze`, e devolve,
// para cada setup e cada regime, os gatilhos encerrados cujo regime no candle do gatilho é aquele, com a
// taxa de acerto, o intervalo de 95% e a taxa-base condicional ao regime (entradas aleatórias do motor que
// caíram no mesmo regime). Não calcula p-valor e não cria teste novo: o motor 1.1 não testa por regime, e o
// teste estatístico e o veredito valem para o conjunto completo de gatilhos. O recorte é só descrição.
//
// O mesmo arquivo vai ao navegador: tools/build-web.mjs o converte em web/js/regime-view.js (global
// `ArgosRegimeView`). Por isso só `export function` e `export const` no nível do arquivo, sem import.

/** Abaixo deste N efetivo o recorte é rotulado como evidência insuficiente (mesmo corte do motor, evidenceTier). */
export const MIN_EFFECTIVE = 10;

/** Mesmo corte do motor (evaluateSetup): com N efetivo abaixo de 25 o intervalo é Bayes Beta-Binomial; senão, Wilson. */
const WILSON_MIN_EFFECTIVE = 25;

/**
 * @typedef {{ n: number, wins: number, winRate: number, ci: [number, number], method: 'bayes_beta_binomial' | 'wilson',
 *   nEff: number, base: { rate: number, n: number }, insufficient: boolean }} RegimeCell
 * @typedef {{ regimes: string[], current: string, bySetup: Record<string, Record<string, RegimeCell>> }} RegimeView
 */

/**
 * @param {{ REGIMES: Record<string, unknown>, effectiveN: (rets: number[]) => { nEff: number }, wilson: (k: number, n: number) => number[], bayesWR: (k: number, n: number) => { lo: number, hi: number } }} E motor
 * @param {{ setups: { id: string, triggers: number[] }[], outs: ({ type: string, ret: number } | null)[], reg: { regime: string }[], base: { idx: number[] }, d: { n: number } }} A resultado de E.analyze
 * @returns {RegimeView}
 */
export function regimeView(E, A) {
  // Regimes apresentáveis: todos menos o aquecimento (UNKNOWN). O aquecimento entra em bySetup só para que a
  // soma dos regimes feche com o total de cada setup (na prática fica vazio: o motor só avalia depois do candle 200).
  const all = Object.keys(E.REGIMES);
  const regimes = all.filter((r) => r !== 'UNKNOWN');
  const last = A.reg[A.d.n - 1];
  const current = last ? last.regime : 'UNKNOWN';

  // Taxa-base condicional: as mesmas entradas aleatórias da taxa-base do motor (A.base.idx = candles com desfecho
  // depois do aquecimento), separadas pelo regime do candle de entrada.
  const baseBy = {};
  for (const r of all) baseBy[r] = { wins: 0, n: 0 };
  for (const i of A.base.idx) {
    const r = A.reg[i].regime;
    const b = baseBy[r] || (baseBy[r] = { wins: 0, n: 0 });
    b.n++;
    if (A.outs[i].type === 'WIN') b.wins++;
  }
  const baseOf = (r) => { const b = baseBy[r] || { wins: 0, n: 0 }; return { rate: b.n ? b.wins / b.n : NaN, n: b.n }; };

  const bySetup = {};
  for (const s of A.setups) {
    const picked = {};
    for (const r of all) picked[r] = [];
    for (const i of s.triggers) {
      const o = A.outs[i];
      if (!o) continue; // gatilho sem desfecho (janela futura incompleta): fora, como no motor
      const r = A.reg[i].regime;
      (picked[r] || (picked[r] = [])).push(i);
    }
    const cells = {};
    for (const r of Object.keys(picked)) {
      const idx = picked[r];
      const n = idx.length;
      const wins = idx.filter((i) => A.outs[i].type === 'WIN').length;
      const nEff = E.effectiveN(idx.map((i) => A.outs[i].ret)).nEff;
      const small = nEff < WILSON_MIN_EFFECTIVE;
      const ci = n ? (small ? (() => { const b = E.bayesWR(wins, n); return [b.lo, b.hi]; })() : E.wilson(wins, n)) : [NaN, NaN];
      cells[r] = { n, wins, winRate: n ? wins / n : NaN, ci, method: small ? 'bayes_beta_binomial' : 'wilson', nEff, base: baseOf(r), insufficient: nEff < MIN_EFFECTIVE };
    }
    bySetup[s.id] = cells;
  }
  return { regimes, current, bySetup };
}
