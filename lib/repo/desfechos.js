// Repositório de desfechos (tabela append-only). Cada previsão tem no máximo um desfecho.
import { isoParam } from './util.js';

/**
 * Insere o desfecho de uma previsão. Segundo desfecho para a mesma previsão viola a chave primária e lança erro
 * (não é silenciado: um desfecho divergente indicaria falha no resolvedor).
 * @param {import('../db.js').Queryable} db
 * @param {{ previsao_id: string, outcome: 'WIN'|'LOSS'|'TIMEOUT', ret?: number|null, bars?: number|null,
 *           bar_time?: Date|string|null, resolved_at?: Date|string|null }} d
 * @returns {Promise<{ previsao_id: string }>}
 */
export async function insertDesfecho(db, d) {
  await db.query(
    `insert into desfechos (previsao_id, outcome, ret, bars, bar_time, resolved_at)
     values ($1::uuid, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
    [d.previsao_id, d.outcome, d.ret ?? null, d.bars ?? null, isoParam(d.bar_time, 'bar_time'), isoParam(d.resolved_at, 'resolved_at')],
  );
  return { previsao_id: d.previsao_id };
}
