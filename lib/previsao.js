// Registro de previsão `argos.previsao/1` e manifesto do dia `argos.raiz/1` (contrato: docs/api-proof.md, seções 1 e 4).
// O registro só carrega saída do motor: quem chama passa o resumo da análise (`handleAnalyze`), nunca números do cliente.
import { canonicalize, sha256Hex } from './canonical.js';

export const SCHEMA_PREVISAO = 'argos.previsao/1';
export const SCHEMA_RAIZ = 'argos.raiz/1';
export const ORIGINS = Object.freeze(['demo', 'cliente', 'relatorio', 'termometro', 'indice']);

const DAY_MS = 86_400_000;
const HEX64 = /^[0-9a-f]{64}$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Hora (UTC) em que o job fecha o dia anterior: `10 0 * * *` em vercel.json. */
const ANCHOR_AT_MS = 10 * 60_000;

/**
 * Relógio injetável: função que devolve ms, número em ms, Date, ou nada (usa o relógio do sistema).
 * @param {(() => number) | number | Date | undefined | null} now
 */
export function clockMs(now) {
  const v = typeof now === 'function' ? now() : now;
  if (v === undefined || v === null) return Date.now();
  const ms = v instanceof Date ? v.getTime() : Number(v);
  if (!Number.isFinite(ms)) throw new TypeError('relógio inválido');
  return ms;
}

/** Dia UTC (AAAA-MM-DD) de um instante (Date, ISO ou ms). */
export function utcDay(instant) {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) throw new TypeError('instante inválido');
  return d.toISOString().slice(0, 10);
}

/** `true` se a string é uma data de calendário válida no formato AAAA-MM-DD. */
export function isValidDay(day) {
  if (typeof day !== 'string' || !DAY_RE.test(day)) return false;
  const t = Date.parse(day + 'T00:00:00.000Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === day;
}

/** Limites [from, to) do dia UTC, em ISO. */
export function dayBounds(day) {
  if (!isValidDay(day)) throw new TypeError('dia inválido: ' + day);
  const from = Date.parse(day + 'T00:00:00.000Z');
  return { from: new Date(from).toISOString(), to: new Date(from + DAY_MS).toISOString() };
}

/** Pendência de âncora de uma previsão emitida em `emittedAt`: o dia dela e quando o job passa a poder fechá-lo. */
export function anchorPending(emittedAt) {
  const day = utcDay(emittedAt);
  return { day, expectedAfter: new Date(Date.parse(day + 'T00:00:00.000Z') + DAY_MS + ANCHOR_AT_MS).toISOString() };
}

const finiteOrNull = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const intOrNull = (x) => (Number.isInteger(x) ? x : null);

/**
 * Monta o registro canônico de uma previsão e a linha de `previsoes`.
 * @param {object} args
 * @param {object} args.summary corpo de handleAnalyze (lib/analysis-summary.js)
 * @param {string} args.setupId precisa existir em summary.setups
 * @param {'demo'|'cliente'|'relatorio'|'termometro'|'indice'} [args.origin]
 * @param {string|null} [args.originRef]
 * @param {Date|string|number} args.emittedAt relógio do servidor no momento do registro
 * @returns {{ record: object, canonical: string, hash: string, row: object }}
 */
export function buildPrevisao({ summary, setupId, origin = 'demo', originRef = null, emittedAt }) {
  if (!summary || typeof summary !== 'object') throw new TypeError('buildPrevisao: summary obrigatório');
  if (!ORIGINS.includes(origin)) throw new RangeError('buildPrevisao: origem inválida: ' + origin);
  const setup = (summary.setups || []).find((s) => s && s.id === setupId);
  if (!setup) throw new RangeError('buildPrevisao: setup inexistente no resumo: ' + setupId);
  const emitted = new Date(emittedAt);
  if (Number.isNaN(emitted.getTime())) throw new TypeError('buildPrevisao: emittedAt inválido');
  const emittedIso = emitted.toISOString();

  // A origem dos candles (source, liveError, dbError) não entra no hash: o mesmo resultado vale de qualquer fonte.
  const { source: _s, liveError: _l, dbError: _d, ...data } = summary.data;
  const record = {
    schema: SCHEMA_PREVISAO,
    engine: summary.engine,
    origin,
    originRef: originRef ?? null,
    emittedAt: emittedIso,
    input: summary.input,
    data,
    resultHash: summary.resultHash,
    regime: summary.regime.current,
    base: summary.base,
    setup
  };
  const canonical = canonicalize(record); // número não finito lança erro: previsão registrada não tem NaN
  const hash = sha256Hex(canonical);

  const hasProb = typeof setup.winRate === 'number' && Number.isFinite(setup.winRate) && setup.winRate >= 0 && setup.winRate <= 1 && setup.n > 0;
  const row = {
    setup_id: setup.id,
    symbol: record.input.symbol,
    timeframe: record.input.timeframe,
    params: { cfg: record.input.cfg, windowDays: record.input.windowDays ?? null },
    prob: hasProb ? setup.winRate : null,
    base_rate: finiteOrNull(setup.base),
    n: intOrNull(setup.n),
    n_eff: intOrNull(setup.nEff),
    verdict: (setup.verdict && setup.verdict.key) || null,
    bar_time: setup.activeNow ? setup.lastTriggerTime ?? null : null, // só previsão com gatilho ativo recebe desfecho
    data_cut: data.to,
    emitted_at: emittedIso,
    origin,
    origin_ref: originRef ?? null,
    engine_version: summary.engine,
    payload: record,
    hash
  };
  return { record, canonical, hash, row };
}

/**
 * Manifesto da raiz do dia: o texto que se baixa e cujo SHA-256 vai ao OpenTimestamps.
 * @param {{ day: string, nLeaves: number, root: string }} args
 * @returns {{ manifest: string, manifestSha256: string }}
 */
export function dayManifest({ day, nLeaves, root }) {
  if (!isValidDay(day)) throw new TypeError('dayManifest: dia inválido: ' + day);
  if (!Number.isInteger(nLeaves) || nLeaves < 1) throw new RangeError('dayManifest: nLeaves deve ser inteiro positivo');
  if (typeof root !== 'string' || !HEX64.test(root)) throw new TypeError('dayManifest: raiz deve ser SHA-256 em hexadecimal minúsculo');
  const manifest = canonicalize({ schema: SCHEMA_RAIZ, day, nLeaves, root }); // sem quebra de linha no fim
  return { manifest, manifestSha256: sha256Hex(manifest) };
}
