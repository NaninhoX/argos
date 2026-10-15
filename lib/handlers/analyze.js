// GET|POST /api/analyze — roda o motor no servidor e devolve o resumo da análise.
// Handler puro: recebe dados já extraídos da requisição e devolve { status, headers, body }.
import { analyze, sliceSeries } from '../../engine/index.js';
import { summarize, withProvenance } from '../analysis-summary.js';
import { loadSeries, loadSeriesFromDb, SYMBOLS, TIMEFRAMES } from '../data/series.js';
import { DISCLAIMER_PADRAO } from '../compliance.js';
import { resolveDb } from '../db.js';

/**
 * Fonte de séries padrão: a base de candles quando DATABASE_URL existe; se o banco falhar ou estiver vazio,
 * cai para snapshot + Binance e registra o motivo em `dbError`. Sem banco configurado, snapshot + Binance.
 */
export function defaultSeriesLoader(env = process.env, db) {
  if (!db && !env.DATABASE_URL) return loadSeries;
  return async (symbol, timeframe, opts) => {
    try {
      const conn = db || (await resolveDb(env));
      return await loadSeriesFromDb(conn, symbol, timeframe);
    } catch (e) {
      return { ...(await loadSeries(symbol, timeframe, opts)), dbError: String((e && e.message) || e) };
    }
  };
}

export const DEFAULT_CFG = Object.freeze({ mode: 'atr', tgt: 2, stp: 1, hold: 12 });

const bad = (message) => ({ status: 400, body: { error: { code: 'requisicao_invalida', message } } });
const first = (v) => (Array.isArray(v) ? v[0] : v);

/** Valida e normaliza os parâmetros. Devolve { value } ou { error }. */
export function parseAnalyzeInput(raw = {}) {
  const symbol = String(first(raw.symbol) || '').toUpperCase();
  const timeframe = String(first(raw.tf ?? raw.timeframe) || '').toLowerCase();
  if (!SYMBOLS.includes(symbol)) return { error: `symbol deve ser um de: ${SYMBOLS.join(', ')}` };
  if (!TIMEFRAMES.includes(timeframe)) return { error: `tf deve ser um de: ${TIMEFRAMES.join(', ')}` };

  const src = raw.cfg && typeof raw.cfg === 'object' ? raw.cfg : raw;
  const mode = String(first(src.mode) ?? DEFAULT_CFG.mode);
  const tgt = Number(first(src.tgt) ?? DEFAULT_CFG.tgt);
  const stp = Number(first(src.stp) ?? DEFAULT_CFG.stp);
  const hold = Number(first(src.hold) ?? DEFAULT_CFG.hold);
  if (mode !== 'atr' && mode !== 'pct') return { error: "mode deve ser 'atr' ou 'pct'" };
  if (!(tgt > 0 && tgt <= 50)) return { error: 'tgt deve estar entre 0 e 50' };
  if (!(stp > 0 && stp <= 50)) return { error: 'stp deve estar entre 0 e 50' };
  if (!(Number.isInteger(hold) && hold >= 1 && hold <= 200)) return { error: 'hold deve ser inteiro entre 1 e 200' };

  const wRaw = first(raw.windowDays ?? raw.win);
  let windowDays = null;
  if (wRaw !== undefined && wRaw !== null && wRaw !== '' && wRaw !== 'all') {
    windowDays = Number(wRaw);
    if (!(Number.isFinite(windowDays) && windowDays >= 30 && windowDays <= 5000)) return { error: 'windowDays deve estar entre 30 e 5000' };
  }
  const live = !['0', 'false', false].includes(first(raw.live));
  const brief = ['1', 'true', true].includes(first(raw.brief));
  // source=snapshot: só o snapshot versionado, sem base de candles nem Binance. É a leitura reprodutível que o Query do
  // navegador compara com o cálculo local (mesmos candles, mesmo resultHash).
  const sRaw = first(raw.source);
  if (sRaw !== undefined && sRaw !== '' && sRaw !== 'snapshot') return { error: "source, se informado, deve ser 'snapshot'" };
  const snapshotOnly = sRaw === 'snapshot';
  return { value: { symbol, timeframe, cfg: { mode, tgt, stp, hold }, windowDays, live, brief, snapshotOnly } };
}

const cache = new Map(); // instância quente: evita recalcular a mesma consulta sobre os mesmos dados

/**
 * @param {{ method?: string, query?: object, body?: object, deps?: { loadSeries?: typeof loadSeries, now?: () => number } }} req
 */
export async function handleAnalyze({ method = 'GET', query = {}, body, deps = {} } = {}) {
  if (method !== 'GET' && method !== 'POST') return { status: 405, headers: { allow: 'GET, POST' }, body: { error: { code: 'metodo_nao_permitido', message: 'use GET ou POST' } } };
  const parsed = parseAnalyzeInput(method === 'POST' && body && typeof body === 'object' ? body : query);
  if (parsed.error) return bad(parsed.error);
  const { symbol, timeframe, cfg, windowDays, live, brief, snapshotOnly } = parsed.value;
  const now = deps.now ? deps.now() : Date.now();
  const t0 = performance.now();

  let series;
  try {
    series = await (snapshotOnly ? (deps.loadSeries || loadSeries) : (deps.loadSeries || defaultSeriesLoader()))(symbol, timeframe, { live: snapshotOnly ? false : live, now });
  } catch (e) {
    return { status: 503, body: { error: { code: 'dados_indisponiveis', message: 'Não foi possível carregar os candles. Nenhum resultado foi calculado.' } } };
  }
  let d = series.d;
  // mesma janela da demo: N dias + 200 candles de aquecimento da MM200
  if (windowDays) d = sliceSeries(d, Math.round((windowDays * 86400) / d.dt) + 200);

  const key = [snapshotOnly ? 'snap' : 'auto', symbol, timeframe, cfg.mode, cfg.tgt, cfg.stp, cfg.hold, windowDays || 'all', d.n, d.t[d.n - 1]].join('|');
  let summary = cache.get(key);
  const cacheHit = !!summary;
  if (!summary) {
    const A = analyze(d, { ...cfg }, { sym: symbol, tf: timeframe, source: series.source, win: windowDays });
    summary = summarize(A, { symbol, timeframe, source: series.source, liveError: series.liveError, dbError: series.dbError, windowDays });
    cache.set(key, summary);
    while (cache.size > 16) cache.delete(cache.keys().next().value);
  }
  summary = withProvenance(summary, series); // o cache guarda o resultado; a fonte é a desta chamada
  // brief=1: só a identificação do resultado (para monitorar e comparar ambientes sem baixar o resumo inteiro)
  if (brief) summary = { engine: summary.engine, input: summary.input, data: summary.data, resultHash: summary.resultHash };
  return {
    status: 200,
    headers: { 'cache-control': 'public, max-age=60' },
    body: { ...summary, disclaimer: DISCLAIMER_PADRAO, ms: Math.round(performance.now() - t0), cacheHit }
  };
}
