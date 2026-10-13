// Baixa o histórico de candles fechados de um par na API pública da Binance e grava em data/history/
// no formato compacto do snapshot ({ t0, dt, g, r }), comprimido com gzip.
// Serve para reproduzir o estudo de referência (1h desde jan/2022) e, depois, para a carga inicial do banco.
// Uso: node tools/fetch-history.mjs BTCUSDT 1h 2022-01-01T00:00:00Z 2026-09-26T23:59:59Z
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { fetchKlines } from '../lib/data/binance.js';
import { fromBinance } from '../engine/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DT = { '1h': 3600, '4h': 14400, '1d': 86400 };

/** Linhas [t, o, h, l, c, v] de todos os candles fechados em [startMs, endMs], em ordem. */
export async function fetchRange(symbol, tf, startMs, endMs, opts = {}) {
  const rows = new Map();
  let end = endMs;
  for (;;) {
    const batch = fromBinance(await fetchKlines(symbol, tf, { limit: 1000, endTime: end, fetchImpl: opts.fetchImpl }), endMs + 1);
    if (!batch.length) break;
    for (const r of batch) if (r[0] * 1000 >= startMs) rows.set(r[0], r);
    const first = batch[0][0] * 1000;
    if (first <= startMs || batch.length < 2) break;
    end = first - 1;
    if (opts.onProgress) opts.onProgress(rows.size);
  }
  return Array.from(rows.values()).sort((a, b) => a[0] - b[0]);
}

/** Converte linhas [t, o, h, l, c, v] no formato compacto que engine.decodeSnapshot lê. */
export function toCompact(rows, dt) {
  const g = [];
  for (let i = 1; i < rows.length; i++) if (rows[i][0] - rows[i - 1][0] !== dt) g.push([i, rows[i][0]]);
  return { t0: rows[0][0], dt, g, r: rows.map((r) => r.slice(1)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [symbol, tf, start, end] = process.argv.slice(2);
  if (!symbol || !DT[tf] || !start || !end) { console.error('uso: node tools/fetch-history.mjs SIMBOLO 1h|4h|1d INICIO_ISO FIM_ISO'); process.exit(1); }
  const rows = await fetchRange(symbol, tf, Date.parse(start), Date.parse(end));
  if (!rows.length) { console.error('nenhum candle recebido'); process.exit(1); }
  const compact = { source: 'Binance Spot · API pública (/api/v3/klines)', symbol, timeframe: tf, start, end, fetched: new Date().toISOString(), ...toCompact(rows, DT[tf]) };
  const file = path.join(root, 'data', 'history', `${symbol}_${tf}.json.gz`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(compact), { level: 9 }));
  const iso = (t) => new Date(t * 1000).toISOString();
  console.log(`${symbol} ${tf}: ${rows.length} candles, ${iso(rows[0][0])} → ${iso(rows[rows.length - 1][0])}, ${compact.g.length} lacunas, ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
}
