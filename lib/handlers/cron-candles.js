// GET /api/cron/candles — job agendado que mantém a base de candles em dia.
// A Vercel chama com "Authorization: Bearer <CRON_SECRET>"; qualquer outra chamada é recusada.
import { timingSafeEqual } from 'node:crypto';
import { resolveDb } from '../db.js';
import { ingestCandles } from '../jobs/ingest-candles.js';
import { runTermometro } from '../jobs/termometro.js';

// A função da Vercel (plano gratuito) dura até 60 s: o Termômetro para entre séries aos 50 s e retoma no dia seguinte.
const BUDGET_MS = 50_000;

function authorized(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header), b = Buffer.from('Bearer ' + secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{ authorization?: string, env?: object, deps?: { db?: object, ingest?: typeof ingestCandles, now?: number, fetchImpl?: typeof fetch } }} req
 */
export async function handleCronCandles({ authorization, env = process.env, deps = {} } = {}) {
  if (!authorized(authorization, env.CRON_SECRET)) return { status: 401, body: { error: { code: 'nao_autorizado' } } };
  if (!deps.db && !env.DATABASE_URL) return { status: 503, body: { error: { code: 'banco_ausente', message: 'DATABASE_URL não configurada.' } } };
  const db = deps.db || (await resolveDb(env));
  const t0 = Date.now();
  const report = await (deps.ingest || ingestCandles)(db, { now: deps.now, fetchImpl: deps.fetchImpl });
  // Termômetro: o registro prospectivo roda logo depois dos candles novos. Uma falha dele não derruba a ingestão.
  let termometro = null;
  try {
    termometro = await (deps.termometro || runTermometro)(db, { env, now: deps.now, loadSeries: deps.loadSeries, deadline: t0 + BUDGET_MS });
  } catch (e) {
    termometro = { error: String((e && e.message) || e) };
  }
  const failed = report.errors || (termometro && (termometro.error || termometro.errors));
  return { status: failed ? 207 : 200, headers: { 'cache-control': 'no-store' }, body: { ...report, termometro } };
}
