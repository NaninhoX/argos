// GET /api/candles?symbol=&tf=&since= — candles fechados da base, depois de `since` (segundos Unix, exclusivo).
// Serve para o navegador completar o snapshot versionado com os candles novos sem depender da Binance (que pode estar
// bloqueada ou lenta no celular): snapshot + estes candles = a mesma série que o servidor analisa. Só leitura, sem dado de cliente.
import { SYMBOLS, TIMEFRAMES } from '../data/series.js';
import { resolveDb } from '../db.js';
import { readCandles, TIMEFRAME_SECONDS } from '../repo/candles.js';

const MAX_ROWS = 3000;
const bad = (message) => ({ status: 400, body: { error: { code: 'requisicao_invalida', message } } });
const first = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * @param {{ method?: string, query?: object, env?: object, deps?: { db?: object, now?: () => number } }} req
 * @returns {Promise<{ status: number, headers?: object, body: object }>}
 */
export async function handleCandles({ method = 'GET', query = {}, env = process.env, deps = {} } = {}) {
  if (method !== 'GET') return { status: 405, headers: { allow: 'GET' }, body: { error: { code: 'metodo_nao_permitido', message: 'use GET' } } };
  const symbol = String(first(query.symbol) || '').toUpperCase();
  const timeframe = String(first(query.tf ?? query.timeframe) || '').toLowerCase();
  if (!SYMBOLS.includes(symbol)) return bad(`symbol deve ser um de: ${SYMBOLS.join(', ')}`);
  if (!TIMEFRAMES.includes(timeframe)) return bad(`tf deve ser um de: ${TIMEFRAMES.join(', ')}`);
  const sRaw = first(query.since);
  const since = sRaw === undefined || sRaw === '' ? 0 : Number(sRaw);
  if (!Number.isInteger(since) || since < 0 || since > 4_102_444_800) return bad('since deve ser inteiro em segundos Unix');
  if (!deps.db && !env.DATABASE_URL) return { status: 503, body: { error: { code: 'sem_banco', message: 'Base de candles indisponível neste ambiente.' } } };
  const now = deps.now ? deps.now() : Date.now();
  let d;
  try {
    const db = deps.db || (await resolveDb(env));
    d = await readCandles(db, { symbol, timeframe, from: since + 1, limit: MAX_ROWS });
  } catch {
    return { status: 503, body: { error: { code: 'dados_indisponiveis', message: 'Não foi possível ler a base de candles.' } } };
  }
  const dt = TIMEFRAME_SECONDS[timeframe];
  const rows = [];
  for (let i = 0; i < d.n; i++) {
    if ((d.t[i] + dt) * 1000 > now) continue; // candle ainda aberto nunca sai daqui
    rows.push([d.t[i], d.o[i], d.h[i], d.l[i], d.c[i], d.v[i]]);
  }
  return { status: 200, headers: { 'cache-control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300' }, body: { symbol, timeframe, dt, source: 'database', rows } };
}
