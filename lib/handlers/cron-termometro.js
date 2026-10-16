// GET /api/cron/termometro — roda o Termômetro sob demanda (o plano gratuito da Vercel só aceita 2 crons, e o Termômetro já
// roda junto de /api/cron/candles). Mesma proteção: só com "Authorization: Bearer <CRON_SECRET>".
import { timingSafeEqual } from 'node:crypto';
import { resolveDb } from '../db.js';
import { runTermometro } from '../jobs/termometro.js';
import { parseTf } from './cron-tf.js';

function authorized(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header), b = Buffer.from('Bearer ' + secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{ authorization?: string, env?: object, deps?: { db?: object, termometro?: typeof runTermometro, now?: number, loadSeries?: Function } }} req
 */
export async function handleCronTermometro({ authorization, query, env = process.env, deps = {} } = {}) {
  if (!authorized(authorization, env.CRON_SECRET)) return { status: 401, body: { error: { code: 'nao_autorizado' } } };
  const tf = parseTf(query);
  if (tf.error) return { status: 400, body: { error: { code: 'requisicao_invalida', message: tf.error } } };
  if (!deps.db && !env.DATABASE_URL) return { status: 503, body: { error: { code: 'banco_ausente', message: 'DATABASE_URL não configurada.' } } };
  const db = deps.db || (await resolveDb(env));
  const report = await (deps.termometro || runTermometro)(db, { env, now: deps.now, loadSeries: deps.loadSeries, deadline: Date.now() + 50_000, ...(tf.timeframes ? { timeframes: tf.timeframes } : {}) });
  (deps.log || console.log)(JSON.stringify({ cron: 'termometro', timeframes: tf.timeframes || 'todos', registered: report.registered, resolved: report.resolved, errors: report.errors, skipped: report.skipped, open: report.series.reduce((s, x) => s + (x.open || 0), 0), refused: report.series.filter((x) => x.error).map((x) => x.symbol + ' ' + x.timeframe + ': ' + x.error) }));
  return { status: report.errors ? 207 : 200, headers: { 'cache-control': 'no-store' }, body: report };
}
