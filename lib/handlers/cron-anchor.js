// GET /api/cron/anchor — job diário (00:10 UTC) que fecha o dia anterior e o ancora no OpenTimestamps.
// A Vercel chama com "Authorization: Bearer <CRON_SECRET>"; qualquer outra chamada é recusada.
import { timingSafeEqual } from 'node:crypto';
import { resolveDb } from '../db.js';
import { anchorDays } from '../jobs/anchor-day.js';

function authorized(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header), b = Buffer.from('Bearer ' + secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{ authorization?: string, env?: object, deps?: { db?: object, anchor?: typeof anchorDays, now?: (() => number) | number, stamp?: Function } }} req
 */
export async function handleCronAnchor({ authorization, env = process.env, deps = {} } = {}) {
  if (!authorized(authorization, env.CRON_SECRET)) return { status: 401, body: { error: { code: 'nao_autorizado' } } };
  if (!deps.db && !env.DATABASE_URL) return { status: 503, body: { error: { code: 'banco_ausente', message: 'DATABASE_URL não configurada.' } } };
  const db = deps.db || (await resolveDb(env));
  const report = await (deps.anchor || anchorDays)(db, { now: deps.now, stamp: deps.stamp, upgrade: deps.upgrade });
  return { status: report.errors ? 207 : 200, headers: { 'cache-control': 'no-store' }, body: report };
}
