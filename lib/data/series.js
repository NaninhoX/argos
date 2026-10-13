// Fonte de séries para o motor. Hoje: snapshot versionado + candles recentes da Binance, com a mesma
// regra de junção da demo v1.1 (refreshLive). Quando a base de candles existir, este módulo passa a ler do banco
// e a Binance vira reserva. O motor nunca sabe de onde o dado veio.
import fs from 'node:fs';
import { decodeSnapshot, fromBinance, mergeSeries, sliceSeries } from '../../engine/index.js';
import { fetchKlines } from './binance.js';
import { readCandles } from '../repo/candles.js';

export const SYMBOLS = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
export const TIMEFRAMES = Object.freeze(['1h', '4h', '1d']);
/** Tamanho máximo da série por tempo gráfico, igual ao da demo. */
export const SERIES_CAP = Object.freeze({ '1h': 5200, '4h': 26000, '1d': 4200 });

const SNAPSHOT_FILE = new URL('../../data/snapshot-v1.1.json', import.meta.url);
let snapshot;

export function loadSnapshot() {
  if (!snapshot) snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  return snapshot;
}

/** Série do snapshot, já no formato do motor. */
export function snapshotSeries(symbol, timeframe) {
  const s = loadSnapshot().series[`${symbol}_${timeframe}`];
  if (!s) throw new RangeError(`série não disponível: ${symbol} ${timeframe}`);
  return decodeSnapshot(s);
}

/**
 * Série lida da base de candles (fonte única quando o banco existe). Usa todo o histórico gravado:
 * para 1h isso é jan/2022 em diante, a mesma janela do estudo de referência, e não os 5.000 candles do snapshot.
 * @param {import('../db.js').Queryable} db
 */
export async function loadSeriesFromDb(db, symbol, timeframe) {
  const d = await readCandles(db, { symbol, timeframe });
  if (!d.n) throw new Error(`sem candles no banco para ${symbol} ${timeframe}`);
  return { d, source: 'database' };
}

/**
 * Série para análise sem banco: snapshot + candles fechados mais recentes. Se a rede falhar, devolve o snapshot
 * e diz isso em `source` e `liveError`; nunca devolve dado inventado.
 * @param {string} symbol
 * @param {string} timeframe
 * @param {{ live?: boolean, now?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ d: object, source: 'live' | 'snapshot', liveError?: string }>}
 */
export async function loadSeries(symbol, timeframe, opts = {}) {
  const { live = true, now = Date.now(), fetchImpl } = opts;
  const snapD = snapshotSeries(symbol, timeframe);
  if (!live) return { d: snapD, source: 'snapshot' };
  try {
    let rows = fromBinance(await fetchKlines(symbol, timeframe, { limit: 1000, fetchImpl }), now);
    if (!rows.length) return { d: snapD, source: 'snapshot', liveError: 'nenhum candle fechado recebido' };
    const dt = snapD.dt, snapEnd = snapD.t[snapD.n - 1];
    if (rows[0][0] > snapEnd + dt) {
      try {
        rows = fromBinance(await fetchKlines(symbol, timeframe, { limit: 1000, endTime: rows[0][0] * 1000 - 1, fetchImpl }), now).concat(rows);
      } catch { /* segue com 1000 */ }
    }
    const empty = { t: [], o: [], h: [], l: [], c: [], v: [], n: 0, dt };
    let merged = rows[0][0] <= snapEnd + dt ? mergeSeries(snapD, rows, dt) : mergeSeries(empty, rows, dt);
    merged = sliceSeries(merged, SERIES_CAP[timeframe]);
    return { d: merged, source: 'live' };
  } catch (e) {
    return { d: snapD, source: 'snapshot', liveError: String((e && e.message) || e) };
  }
}
