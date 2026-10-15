// Termômetro: registro prospectivo diário e desfechos das previsões de origem `termometro`.
// Para cada uma das 9 séries (3 ativos × 3 tempos gráficos), com a regra de saída padrão:
//  1. registra a probabilidade que o motor emite para o gatilho do ÚLTIMO candle fechado (lib/prospective.js), uma vez por gatilho;
//  2. grava o desfecho das previsões cuja janela já fechou, lido do mesmo motor sobre os candles de hoje.
// Nenhum número nasce aqui: p, r, n e w vêm de `openPredictions` (mesma conta da calibração do motor) e o desfecho
// vem de `A.outs`. A tabela `previsoes` é append-only: um gatilho tem no máximo uma previsão e um desfecho.
//
// Rigor do "antes do resultado" (revisão do Opus, 15/10/2026):
//  - só registra gatilho do último candle fechado (`elapsedBars === 0`): o motor só dá desfecho com a janela inteira,
//    mas alvo ou stop podem ter sido atingidos antes; gatilho mais antigo poderia já estar decidido;
//  - só registra com série vinda do banco e em dia: série de fallback (snapshot) ou atrasada em relação ao relógio
//    faria gatilhos antigos parecerem novos, e o registro não guarda a fonte;
//  - só resolve se a janela não tem buraco de candles (o prazo conta candles, não tempo).
// Idempotente: rodar de novo no mesmo dia não duplica nada. Com prazo (`deadline`), para e diz o que faltou.
import { analyze } from '../../engine/index.js';
import { summarize } from '../analysis-summary.js';
import { SYMBOLS, TIMEFRAMES } from '../data/series.js';
import { DEFAULT_CFG, defaultSeriesLoader } from '../handlers/analyze.js';
import { buildPrevisao, clockMs } from '../previsao.js';
import { openPredictions } from '../prospective.js';
import { insertDesfecho } from '../repo/desfechos.js';
import { insertPrevisao } from '../repo/previsoes.js';

export const ORIGIN = 'termometro';

/** Chave estável de um gatilho: ativo, tempo gráfico, setup e instante do candle. */
export const originRef = (symbol, timeframe, setupId, barTimeSec) => `${symbol}:${timeframe}:${setupId}:${new Date(barTimeSec * 1000).toISOString()}`;

const sameCfg = (a) => !!a && a.mode === DEFAULT_CFG.mode && a.tgt === DEFAULT_CFG.tgt && a.stp === DEFAULT_CFG.stp && a.hold === DEFAULT_CFG.hold;

/**
 * A série serve para registrar? Vinda do banco, sem erro de banco, e com o último candle sendo o mais recente já fechado
 * (menos de um candle de atraso em relação ao relógio).
 * @returns {string|null} motivo da recusa, ou null
 */
export function whyNotFresh(series, nowMs) {
  if (!series || series.source !== 'database' || series.dbError) return 'serie_fora_do_banco';
  const { d } = series;
  const closeMs = (d.t[d.n - 1] + d.dt) * 1000;
  if (nowMs - closeMs >= d.dt * 1000) return 'serie_atrasada';
  if (closeMs > nowMs) return 'candle_ainda_aberto';
  return null;
}

async function register(db, { summary, opens, symbol, timeframe, emittedAt, d, deadline }) {
  let registered = 0;
  for (const o of opens) {
    if (Date.now() > deadline) break;
    if (o.p === null) continue; // histórico insuficiente (menos de 10 gatilhos encerrados): o motor não emite
    if (d.n - 1 - o.index !== 0) continue; // só o gatilho do último candle fechado: nenhum candle andou depois dele
    const ref = originRef(symbol, timeframe, o.setupId, o.barTime);
    const built = buildPrevisao({ summary, setupId: o.setupId, origin: ORIGIN, originRef: ref, emittedAt, prospective: { ...o, elapsedBars: 0 } });
    const inserted = await db.transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', ['termometro|' + ref]);
      const dup = await tx.query('select 1 from previsoes where origin = $1 and origin_ref = $2 limit 1', [ORIGIN, ref]);
      if (dup.rows.length) return false;
      return (await insertPrevisao(tx, built.row)).inserted;
    });
    if (inserted) registered++;
  }
  return registered;
}

/** A janela [i, i+hold] tem todos os candles, sem buraco? */
function windowIsContiguous(d, i, hold) {
  for (let j = i; j < i + hold; j++) if (d.t[j + 1] - d.t[j] !== d.dt) return false;
  return true;
}

async function resolve(db, { A, symbol, timeframe, resolvedAt, deadline }) {
  const { rows } = await db.query(
    `select p.id, p.bar_time, p.params
       from previsoes p left join desfechos d on d.previsao_id = p.id
      where p.origin = $1 and p.symbol = $2 and p.timeframe = $3 and p.bar_time is not null and d.previsao_id is null
      order by p.bar_time`,
    [ORIGIN, symbol, timeframe]
  );
  if (!rows.length) return 0;
  const at = new Map();
  for (let i = 0; i < A.d.n; i++) at.set(A.d.t[i], i);
  let resolved = 0;
  for (const r of rows) {
    if (Date.now() > deadline) break;
    if (!sameCfg(r.params && r.params.cfg)) continue; // regra de saída diferente da padrão: não se mistura
    const i = at.get(Math.round(new Date(r.bar_time).getTime() / 1000));
    const out = i === undefined ? null : A.outs[i];
    if (!out) continue; // janela ainda aberta
    if (!windowIsContiguous(A.d, i, A.cfg.hold)) continue; // buraco na série: o desfecho não é confiável
    // trava por previsão: duas execuções simultâneas não disputam a mesma chave primária
    const done = await db.transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', ['desfecho|' + r.id]);
      const seen = await tx.query('select 1 from desfechos where previsao_id = $1::uuid', [r.id]);
      if (seen.rows.length) return false;
      await insertDesfecho(tx, { previsao_id: r.id, outcome: out.type, ret: out.ret, bars: out.bars, bar_time: r.bar_time, resolved_at: new Date(resolvedAt).toISOString() });
      return true;
    });
    if (done) resolved++;
  }
  return resolved;
}

/**
 * @param {import('../db.js').Db} db
 * @param {{ env?: object, now?: (() => number) | number, loadSeries?: Function, symbols?: string[], timeframes?: string[], deadline?: number }} [opts]
 * @returns {Promise<{ series: object[], registered: number, resolved: number, errors: number, skipped: number }>}
 */
export async function runTermometro(db, opts = {}) {
  const { env = process.env, symbols = SYMBOLS, timeframes = TIMEFRAMES, deadline = Infinity } = opts;
  const loadSeries = opts.loadSeries || defaultSeriesLoader(env, db);
  const nowMs = clockMs(opts.now);
  const report = [];
  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      const item = { symbol, timeframe, open: 0, registered: 0, resolved: 0, error: null, skipped: false };
      if (Date.now() > deadline) { item.skipped = true; report.push(item); continue; } // o próximo dia retoma: tudo é idempotente
      try {
        const series = await loadSeries(symbol, timeframe, { live: false, now: nowMs });
        const refusal = whyNotFresh(series, nowMs);
        if (refusal) { item.error = refusal; report.push(item); continue; } // nada é registrado nem resolvido com série em dúvida
        const A = analyze(series.d, { ...DEFAULT_CFG }, { sym: symbol, tf: timeframe, source: series.source, win: null });
        const opens = openPredictions(A);
        item.open = opens.length;
        const summary = summarize(A, { symbol, timeframe, source: series.source, liveError: series.liveError, dbError: series.dbError, windowDays: null });
        item.registered = await register(db, { summary, opens, symbol, timeframe, emittedAt: nowMs, d: A.d, deadline });
        item.resolved = await resolve(db, { A, symbol, timeframe, resolvedAt: nowMs, deadline });
      } catch (e) {
        item.error = String((e && e.message) || e); // uma série com erro não impede as outras
      }
      report.push(item);
    }
  }
  return {
    series: report,
    registered: report.reduce((s, x) => s + x.registered, 0),
    resolved: report.reduce((s, x) => s + x.resolved, 0),
    errors: report.filter((x) => x.error).length,
    skipped: report.filter((x) => x.skipped).length
  };
}
