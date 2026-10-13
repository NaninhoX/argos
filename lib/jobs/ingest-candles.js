// Ingestão de candles: mantém a tabela `candles` em dia com a fonte (Binance), só com candles fechados.
// Idempotente: pode rodar quantas vezes for, de hora em hora ou sob demanda.
//  - série vazia no banco: carrega a semente (snapshot versionado e, para 1h, data/history se existir);
//  - depois, busca tudo o que fechou desde o último candle gravado.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeSnapshot, fromBinance } from '../../engine/index.js';
import { fetchKlines } from '../data/binance.js';
import { snapshotSeries, SYMBOLS, TIMEFRAMES } from '../data/series.js';
import { upsertCandles, TIMEFRAME_SECONDS } from '../repo/candles.js';

/** Séries de partida para um par e tempo gráfico, da mais longa para a mais recente. */
export function seedSeries(symbol, timeframe) {
  const out = [];
  const history = new URL(`../../data/history/${symbol}_${timeframe}.json.gz`, import.meta.url);
  if (fs.existsSync(history)) out.push(decodeSnapshot(JSON.parse(zlib.gunzipSync(fs.readFileSync(history)))));
  out.push(snapshotSeries(symbol, timeframe));
  return out;
}

async function lastOpenTime(db, symbol, timeframe) {
  const { rows } = await db.query(
    'select extract(epoch from max(open_time))::double precision as t from candles where symbol = $1 and timeframe = $2',
    [symbol, timeframe]
  );
  return rows[0] && rows[0].t !== null ? Number(rows[0].t) : null;
}

/**
 * @param {import('../db.js').Db} db
 * @param {{ symbols?: string[], timeframes?: string[], now?: number, fetchImpl?: typeof fetch, seed?: typeof seedSeries, maxPages?: number }} [opts]
 * @returns {Promise<{ series: object[], seeded: number, fetched: number, errors: number }>}
 */
export async function ingestCandles(db, opts = {}) {
  const { symbols = SYMBOLS, timeframes = TIMEFRAMES, now = Date.now(), fetchImpl, seed = seedSeries, maxPages = 60 } = opts;
  const report = [];
  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      const item = { symbol, timeframe, seeded: 0, fetched: 0, last: null, error: null };
      try {
        let last = await lastOpenTime(db, symbol, timeframe);
        if (last === null) {
          for (const d of seed(symbol, timeframe)) item.seeded += (await upsertCandles(db, { symbol, timeframe, series: d, source: 'binance' })).changed;
          last = await lastOpenTime(db, symbol, timeframe);
        }
        const dt = TIMEFRAME_SECONDS[timeframe];
        for (let page = 0; page < maxPages; page++) {
          const startTime = last === null ? undefined : (last + dt) * 1000;
          if (startTime !== undefined && startTime + dt * 1000 > now) break; // o próximo candle ainda não fechou
          const rows = fromBinance(await fetchKlines(symbol, timeframe, { limit: 1000, startTime, fetchImpl }), now);
          if (!rows.length) break;
          const series = rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
          item.fetched += (await upsertCandles(db, { symbol, timeframe, series, source: 'binance' })).changed;
          const newest = rows[rows.length - 1][0];
          if (last !== null && newest <= last) break;
          last = newest;
          if (rows.length < 1000) break;
        }
        item.last = last === null ? null : new Date(last * 1000).toISOString();
      } catch (e) {
        item.error = String((e && e.message) || e); // uma série com erro não impede as outras
      }
      report.push(item);
    }
  }
  return {
    series: report,
    seeded: report.reduce((s, x) => s + x.seeded, 0),
    fetched: report.reduce((s, x) => s + x.fetched, 0),
    errors: report.filter((x) => x.error).length
  };
}
