// Repositório de auditoria: chamadas de ferramenta da IA (tool_audit) e consultas à API (query_log).
// Nenhum dado pessoal: ip_hash é hash com sal, nunca o IP; args/params não devem conter dado de cliente.
import { isoParam, jsonParam } from './util.js';

/**
 * @param {import('../db.js').Queryable} db
 * @param {{ tool: string, session_id?: string|null, args?: object|null, result_hash?: string|null,
 *           model?: string|null, latency_ms?: number|null, at?: Date|string }} a `at` padrão: now()
 * @returns {Promise<void>}
 */
export async function insertToolAudit(db, a) {
  await db.query(
    `insert into tool_audit (at, session_id, tool, args, result_hash, model, latency_ms)
     values (coalesce($1::timestamptz, now()), $2, $3, $4::jsonb, $5, $6, $7)`,
    [isoParam(a.at, 'at'), a.session_id ?? null, a.tool, jsonParam(a.args), a.result_hash ?? null, a.model ?? null, a.latency_ms ?? null],
  );
}

/**
 * @param {import('../db.js').Queryable} db
 * @param {{ route?: string|null, params?: object|null, status?: number|null, latency_ms?: number|null,
 *           cache_hit?: boolean|null, engine_version?: string|null, ip_hash?: string|null, at?: Date|string }} q
 * @returns {Promise<void>}
 */
export async function insertQueryLog(db, q) {
  await db.query(
    `insert into query_log (at, route, params, status, latency_ms, cache_hit, engine_version, ip_hash)
     values (coalesce($1::timestamptz, now()), $2, $3::jsonb, $4, $5, $6, $7, $8)`,
    [
      isoParam(q.at, 'at'), q.route ?? null, jsonParam(q.params), q.status ?? null, q.latency_ms ?? null,
      q.cache_hit ?? null, q.engine_version ?? null, q.ip_hash ?? null,
    ],
  );
}
