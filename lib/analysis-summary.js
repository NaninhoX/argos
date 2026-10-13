// Resumo serializável de uma análise do motor. O objeto que `analyze` devolve carrega séries inteiras
// (indicadores, regime por candle, desfechos); aqui fica só o que se publica: estatísticas por setup,
// regime, calibração e leitura técnica, com tempos em ISO e sem NaN (vira null).
import { REGIMES, VERSION } from '../engine/index.js';
import { canonicalize, sha256Hex } from './canonical.js';

const iso = (unixSec) => (Number.isFinite(unixSec) ? new Date(unixSec * 1000).toISOString() : null);

/** Hash dos candles usados: quem tiver a mesma série e a mesma regra de saída reproduz o mesmo resultado. */
export function seriesHash(d) {
  return sha256Hex(canonicalize([d.dt, d.t, d.o, d.h, d.l, d.c, d.v]));
}

function setupSummary(s, d) {
  const { triggers, wf, ...rest } = s;
  const walk = wf && wf.available
    ? { ...wf, walks: wf.walks.map(({ from, to, ...w }) => ({ ...w, fromTime: iso(d.t[from]), toTime: iso(d.t[to]) })) }
    : wf;
  return { ...rest, wf: walk, lastTriggerTime: s.lastTrigger >= 0 ? iso(d.t[s.lastTrigger]) : null };
}

/**
 * @param {object} A resultado de engine.analyze
 * @param {{ symbol: string, timeframe: string, source: string, liveError?: string, windowDays?: number | null }} ctx
 */
export function summarize(A, ctx) {
  const d = A.d;
  const cur = A.rstats.current;
  const { regime: regimeNow, time, ...tech } = A.tech;
  const core = {
    engine: VERSION,
    input: { symbol: ctx.symbol, timeframe: ctx.timeframe, cfg: A.cfg, windowDays: ctx.windowDays ?? null },
    data: {
      source: ctx.source,
      candles: d.n,
      from: iso(d.t[0]),
      to: iso(d.t[d.n - 1]),
      warmupCandles: A.warm,
      hash: seriesHash(d)
    },
    regime: {
      current: { ...regimeNow, label: (REGIMES[regimeNow.regime] || REGIMES.UNKNOWN).label, since: cur ? iso(d.t[cur.start]) : null, bars: cur ? cur.end - cur.start + 1 : null },
      share: A.rstats.share,
      durations: A.rstats.durations,
      transitions: A.rstats.transitions
    },
    base: { rate: A.base.rate, n: A.base.n },
    setups: A.setups.map((s) => setupSummary(s, d)),
    calibration: { ...A.calib, rolling: A.calib.rolling.map((r) => ({ ...r, time: iso(r.time) })) },
    technical: { time: iso(time), ...tech }
  };
  const clean = JSON.parse(canonicalize(core, { nonFinite: 'null' }));
  // O hash do resultado depende dos candles (data.hash), da regra e do motor, não de onde os candles vieram.
  const resultHash = sha256Hex(canonicalize({ ...clean, data: { ...clean.data, source: undefined } }));
  return withProvenance({ ...clean, resultHash }, ctx);
}

/**
 * Marca de onde os candles vieram nesta chamada e os avisos de fonte (rede ou banco fora).
 * Fica fora do hash e fora do cache: o mesmo resultado pode ser servido a partir de fontes diferentes.
 * @param {object} summary
 * @param {{ source: string, liveError?: string, dbError?: string }} ctx
 */
export function withProvenance(summary, ctx) {
  const { liveError: _l, dbError: _d, ...data } = summary.data;
  data.source = ctx.source;
  if (ctx.liveError) data.liveError = ctx.liveError;
  if (ctx.dbError) data.dbError = ctx.dbError;
  return { ...summary, data };
}
