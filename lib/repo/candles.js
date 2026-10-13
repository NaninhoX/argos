// Repositório de candles. Formato do motor: colunas paralelas { t, o, h, l, c, v, n, dt },
// com t em segundos Unix (abertura da barra) e dt = segundos por barra.

/** Segundos por barra de cada intervalo aceito (o mesmo conjunto do check da tabela). */
export const TIMEFRAME_SECONDS = Object.freeze({ '1h': 3600, '4h': 14400, '1d': 86400 });

const CHUNK = 5000; // linhas por comando (um parâmetro jsonb por lote)

function checkTimeframe(timeframe) {
  if (!Object.hasOwn(TIMEFRAME_SECONDS, timeframe)) {
    throw new TypeError(`timeframe inválido: ${timeframe} (aceitos: ${Object.keys(TIMEFRAME_SECONDS).join(', ')})`);
  }
}

/** Aceita série colunar do motor ou lista de linhas { t, o, h, l, c, v }; devolve linhas únicas por t (a última vence). */
function toRows(series) {
  let rows;
  if (Array.isArray(series)) {
    rows = series;
  } else if (series && Array.isArray(series.t)) {
    rows = series.t.map((t, i) => ({ t, o: series.o[i], h: series.h[i], l: series.l[i], c: series.c[i], v: series.v[i] }));
  } else {
    throw new TypeError('series: esperava { t, o, h, l, c, v } colunar ou lista de linhas');
  }
  const byTime = new Map();
  for (const r of rows) {
    for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) {
      if (typeof r[k] !== 'number' || !Number.isFinite(r[k])) throw new TypeError(`candle com ${k} inválido: ${r[k]}`);
    }
    if (!Number.isInteger(r.t)) throw new TypeError(`candle com t não inteiro (esperava segundos Unix): ${r.t}`);
    byTime.set(r.t, { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
  }
  return [...byTime.values()];
}

/**
 * Insere ou atualiza candles em lote (chave: símbolo, intervalo, abertura). Só grava o que mudou.
 * Para atomicidade entre lotes de 5.000 linhas, chame com o `tx` de db.transaction().
 * @param {import('../db.js').Queryable} db
 * @param {{ symbol: string, timeframe: '1h'|'4h'|'1d', series: object|object[], source?: string }} args
 * @returns {Promise<{ total: number, changed: number }>} linhas recebidas (únicas) e linhas inseridas ou alteradas
 */
export async function upsertCandles(db, { symbol, timeframe, series, source = 'binance' }) {
  checkTimeframe(timeframe);
  if (!symbol || typeof symbol !== 'string') throw new TypeError('symbol obrigatório');
  const rows = toRows(series);
  let changed = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const r = await db.query(
      `insert into candles (symbol, timeframe, open_time, open, high, low, close, volume, source)
       select $1::text, $2::text, to_timestamp(x.t), x.o, x.h, x.l, x.c, x.v, $3::text
       from jsonb_to_recordset($4::jsonb) as x(t double precision, o double precision, h double precision,
                                                l double precision, c double precision, v double precision)
       on conflict (symbol, timeframe, open_time) do update
         set open = excluded.open, high = excluded.high, low = excluded.low,
             close = excluded.close, volume = excluded.volume, source = excluded.source
         where (candles.open, candles.high, candles.low, candles.close, candles.volume, candles.source)
               is distinct from (excluded.open, excluded.high, excluded.low, excluded.close, excluded.volume, excluded.source)`,
      [symbol, timeframe, source, JSON.stringify(rows.slice(i, i + CHUNK))],
    );
    changed += r.rowCount;
  }
  return { total: rows.length, changed };
}

/**
 * Lê uma janela de candles no formato do motor, em ordem crescente de tempo.
 * `from` e `to` (segundos Unix, ambos inclusivos) são opcionais; `limit` devolve as últimas N barras da janela.
 * @param {import('../db.js').Queryable} db
 * @param {{ symbol: string, timeframe: '1h'|'4h'|'1d', from?: number, to?: number, limit?: number }} args
 * @returns {Promise<{ t: number[], o: number[], h: number[], l: number[], c: number[], v: number[], n: number, dt: number }>}
 */
export async function readCandles(db, { symbol, timeframe, from, to, limit }) {
  checkTimeframe(timeframe);
  const params = [symbol, timeframe];
  const where = ['symbol = $1', 'timeframe = $2'];
  if (from !== undefined) where.push(`open_time >= to_timestamp($${params.push(from)}::double precision)`);
  if (to !== undefined) where.push(`open_time <= to_timestamp($${params.push(to)}::double precision)`);
  let sql = `select extract(epoch from open_time)::double precision as t, open as o, high as h, low as l, close as c, volume as v
             from candles where ${where.join(' and ')}`;
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit deve ser inteiro >= 1');
    sql += ` order by open_time desc limit $${params.push(limit)}`;
  } else {
    sql += ' order by open_time';
  }
  const { rows } = await db.query(sql, params);
  if (limit !== undefined) rows.reverse();
  return {
    t: rows.map((r) => r.t),
    o: rows.map((r) => r.o),
    h: rows.map((r) => r.h),
    l: rows.map((r) => r.l),
    c: rows.map((r) => r.c),
    v: rows.map((r) => r.v),
    n: rows.length,
    dt: TIMEFRAME_SECONDS[timeframe],
  };
}
