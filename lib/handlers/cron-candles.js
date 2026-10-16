// GET /api/cron/candles — job agendado que mantém a base de candles em dia.
// A Vercel chama com "Authorization: Bearer <CRON_SECRET>"; qualquer outra chamada é recusada.
import { timingSafeEqual } from 'node:crypto';
import { resolveDb } from '../db.js';
import { ingestCandles } from '../jobs/ingest-candles.js';
import { runTermometro } from '../jobs/termometro.js';
import { parseTf } from './cron-tf.js';

// A função da Vercel (plano gratuito) dura até 60 s: o Termômetro para entre séries aos 50 s e retoma no dia seguinte.
const BUDGET_MS = 50_000;

// Para o log: quantos gatilhos estavam em aberto nas 9 séries e por que alguma série foi recusada (sem registrar nada).
const openCount = (r) => (Array.isArray(r.series) ? r.series.reduce((s, x) => s + (x.open || 0), 0) : null);
const refusals = (r) => (Array.isArray(r.series) ? r.series.filter((x) => x.error).map((x) => x.symbol + ' ' + x.timeframe + ': ' + x.error) : []);

function authorized(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header), b = Buffer.from('Bearer ' + secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{ authorization?: string, query?: { tf?: string | string[] }, env?: object, deps?: { db?: object, ingest?: typeof ingestCandles, now?: number, fetchImpl?: typeof fetch } }} req
 */
export async function handleCronCandles({ authorization, query, env = process.env, deps = {} } = {}) {
  if (!authorized(authorization, env.CRON_SECRET)) return { status: 401, body: { error: { code: 'nao_autorizado' } } };
  const tf = parseTf(query); // disparo por candle: ?tf=1h ou ?tf=4h roda só esse tempo gráfico (ingestão e Termômetro)
  if (tf.error) return { status: 400, body: { error: { code: 'requisicao_invalida', message: tf.error } } };
  if (!deps.db && !env.DATABASE_URL) return { status: 503, body: { error: { code: 'banco_ausente', message: 'DATABASE_URL não configurada.' } } };
  const db = deps.db || (await resolveDb(env));
  const t0 = Date.now();
  const report = await (deps.ingest || ingestCandles)(db, { now: deps.now, fetchImpl: deps.fetchImpl, ...(tf.timeframes ? { timeframes: tf.timeframes } : {}) });
  // Termômetro: o registro prospectivo roda logo depois dos candles novos. Uma falha dele não derruba a ingestão.
  let termometro = null;
  try {
    termometro = await (deps.termometro || runTermometro)(db, { env, now: deps.now, loadSeries: deps.loadSeries, deadline: t0 + BUDGET_MS, ...(tf.timeframes ? { timeframes: tf.timeframes } : {}) });
  } catch (e) {
    termometro = { error: String((e && e.message) || e) };
  }
  const log = deps.log || console.log;
  log(JSON.stringify({ cron: 'candles', timeframes: tf.timeframes || 'todos', status: report.errors ? 'erro' : 'ok', fetched: report.fetched, seeded: report.seeded, errors: report.errors, termometro: termometro && (termometro.error ? { error: termometro.error } : { registered: termometro.registered, resolved: termometro.resolved, errors: termometro.errors, skipped: termometro.skipped, open: openCount(termometro), refused: refusals(termometro) }), ms: Date.now() - t0 }));
  const failed = report.errors || (termometro && (termometro.error || termometro.errors || termometro.skipped));
  return { status: failed ? 207 : 200, headers: { 'cache-control': 'no-store' }, body: { ...report, termometro } };
}
