// Previsão prospectiva: a probabilidade que o motor emite para um gatilho que ainda não tem desfecho.
// É a mesma conta da calibração prequencial do motor (`prequential` em engine/index.js), aplicada ao
// presente: Laplace (w + 1) / (n + 2) sobre os gatilhos do mesmo setup cuja janela já tinha fechado no
// candle do gatilho (i + hold <= t), exigindo n >= 10, com referência = taxa-base conhecida até t - hold.
// Não é lógica nova: tests/prospective.test.js confere, gatilho a gatilho, que esta função devolve os
// mesmos p e r de `A.preds` para todo gatilho já encerrado.

export const MIN_HISTORY = 10;

/**
 * Probabilidade conhecida no candle `t` para um gatilho do setup, só com o que já tinha fechado até ali.
 * @param {number[]} triggers índices dos gatilhos do setup, em ordem crescente
 * @param {(object|null)[]} outs desfechos por candle (`A.outs`)
 * @param {number} hold prazo da regra de saída, em candles
 * @param {{ upTo(j: number): number }} base `A.base`
 * @param {number} t índice do candle do gatilho
 * @returns {{ p: number, r: number, n: number, w: number } | null} null: histórico insuficiente (o motor não emite)
 */
export function probabilityAt(triggers, outs, hold, base, t, minN = MIN_HISTORY) {
  let n = 0, w = 0;
  for (const i of triggers) {
    if (i + hold > t) break;
    if (!outs[i]) continue;
    n++;
    if (outs[i].type === 'WIN') w++;
  }
  if (n < minN) return null;
  const r = base.upTo(t - hold);
  if (!Number.isFinite(r)) return null;
  return { p: (w + 1) / (n + 2), r, n, w };
}

/**
 * Gatilhos em aberto no fim da série (a janela de `hold` candles ainda não se completou), com a
 * probabilidade emitida para cada um. `p: null` quando o setup ainda não tem 10 gatilhos encerrados.
 * @param {object} A resultado de engine.analyze
 * @returns {{ setupId: string, index: number, barTime: number, resolvesAt: number, p: number | null, r: number | null, n: number | null, w: number | null }[]}
 */
export function openPredictions(A) {
  const { d, outs, base, cfg } = A;
  const out = [];
  for (const s of A.setups) {
    for (const t of s.triggers) {
      if (t + cfg.hold < d.n) continue; // janela completa: o desfecho já existe
      const pr = probabilityAt(s.triggers, outs, cfg.hold, base, t) || { p: null, r: null, n: null, w: null };
      out.push({ setupId: s.id, index: t, barTime: d.t[t], resolvesAt: d.t[t] + cfg.hold * d.dt, ...pr });
    }
  }
  return out.sort((a, b) => a.index - b.index || (a.setupId < b.setupId ? -1 : a.setupId > b.setupId ? 1 : 0));
}
