// Repositório de previsões (tabela append-only). Os objetos usam os nomes das colunas (snake_case).
// Instantes entram como Date ou string ISO e voltam como Date; params e payload voltam como objetos.
// Atenção: jsonb não preserva a ordem das chaves. Calcule/verifique o hash sobre a forma canônica (chaves ordenadas).
import { UUID_RE, isoParam, jsonParam } from './util.js';
import { dayBounds } from '../previsao.js';

/**
 * @typedef {Object} PrevisaoInput
 * @property {string} [id] gerado pelo banco se omitido
 * @property {string|null} [setup_id]
 * @property {string|null} [symbol]
 * @property {string|null} [timeframe]
 * @property {object} params
 * @property {number|null} [prob] entre 0 e 1; null quando o motor não emite probabilidade
 * @property {number|null} [base_rate]
 * @property {number|null} [n]
 * @property {number|null} [n_eff]
 * @property {string|null} [verdict]
 * @property {Date|string|null} [bar_time]
 * @property {Date|string} data_cut
 * @property {Date|string} emitted_at
 * @property {'demo'|'cliente'|'relatorio'|'termometro'|'indice'} origin
 * @property {string|null} [origin_ref]
 * @property {string} engine_version precisa existir em engine_versions
 * @property {object} payload
 * @property {string} hash SHA-256 hexadecimal (64 caracteres), único
 * @property {string|null} [supersedes] id da previsão que esta corrige
 */

/**
 * Insere uma previsão. Idempotente pelo hash: se já existe previsão com o mesmo hash, não grava de novo
 * e devolve o id existente (`inserted: false`).
 * @param {import('../db.js').Queryable} db
 * @param {PrevisaoInput} p
 * @returns {Promise<{ id: string, inserted: boolean }>}
 */
export async function insertPrevisao(db, p) {
  const r = await db.query(
    `insert into previsoes (id, setup_id, symbol, timeframe, params, prob, base_rate, n, n_eff, verdict, bar_time,
                            data_cut, emitted_at, origin, origin_ref, engine_version, payload, hash, supersedes)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11::timestamptz,
             $12::timestamptz, $13::timestamptz, $14, $15, $16, $17::jsonb, $18, $19::uuid)
     on conflict (hash) do nothing
     returning id`,
    [
      p.id ?? null, p.setup_id ?? null, p.symbol ?? null, p.timeframe ?? null, jsonParam(p.params),
      p.prob ?? null, p.base_rate ?? null, p.n ?? null, p.n_eff ?? null, p.verdict ?? null,
      isoParam(p.bar_time, 'bar_time'), isoParam(p.data_cut, 'data_cut'), isoParam(p.emitted_at, 'emitted_at'),
      p.origin, p.origin_ref ?? null, p.engine_version, jsonParam(p.payload), p.hash, p.supersedes ?? null,
    ],
  );
  if (r.rows.length) return { id: r.rows[0].id, inserted: true };
  const existing = await getPrevisaoByHash(db, p.hash);
  return { id: existing.id, inserted: false };
}

/**
 * @param {import('../db.js').Queryable} db
 * @param {string} id
 * @returns {Promise<object|null>} linha da tabela, ou null se não existe (inclusive id malformado)
 */
export async function getPrevisaoById(db, id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const r = await db.query('select * from previsoes where id = $1::uuid', [id]);
  return r.rows[0] ?? null;
}

/**
 * @param {import('../db.js').Queryable} db
 * @param {string} hash
 * @returns {Promise<object|null>}
 */
export async function getPrevisaoByHash(db, hash) {
  const r = await db.query('select * from previsoes where hash = $1', [hash]);
  return r.rows[0] ?? null;
}

/**
 * Previsão já registrada para a mesma pergunta sobre os mesmos dados (docs/api-proof.md, seção 2): mesmos `origin`,
 * `setup_id`, `symbol`, `timeframe`, `data_cut`, `params` e `payload->>'resultHash'`. Devolve a mais antiga.
 * Os campos da consulta são obrigatórios (não nulos).
 * @param {import('../db.js').Queryable} db
 * @param {{ origin: string, setup_id: string, symbol: string, timeframe: string, data_cut: Date|string, params: object, payload: { resultHash: string } }} p
 * @returns {Promise<object|null>}
 */
export async function findDuplicatePrevisao(db, p) {
  const r = await db.query(
    `select * from previsoes
      where origin = $1 and setup_id = $2 and symbol = $3 and timeframe = $4
        and data_cut = $5::timestamptz and params = $6::jsonb and payload->>'resultHash' = $7
      order by emitted_at, hash collate "C"
      limit 1`,
    [p.origin, p.setup_id, p.symbol, p.timeframe, isoParam(p.data_cut, 'data_cut'), jsonParam(p.params), p.payload.resultHash],
  );
  return r.rows[0] ?? null;
}

/**
 * Previsões emitidas num dia UTC, na ordem das folhas da árvore: `emitted_at` e, no empate, `hash`.
 * @param {import('../db.js').Queryable} db
 * @param {string} day AAAA-MM-DD (UTC)
 * @returns {Promise<{ id: string, hash: string, emitted_at: Date }[]>}
 */
export async function listPrevisoesByDay(db, day) {
  const { from, to } = dayBounds(day);
  const r = await db.query(
    `select id, hash, emitted_at from previsoes
      where emitted_at >= $1::timestamptz and emitted_at < $2::timestamptz
      order by emitted_at, hash collate "C"`,
    [from, to],
  );
  return r.rows;
}

/**
 * Dias UTC já encerrados (anteriores a `today`) que têm previsões e ainda não têm linha em `provas_merkle`.
 * @param {import('../db.js').Queryable} db
 * @param {string} today AAAA-MM-DD (UTC): o dia corrente, que nunca é fechado
 * @returns {Promise<{ day: string, n: number }[]>} em ordem crescente
 */
export async function listClosedDaysWithoutProof(db, today) {
  const r = await db.query(
    `select to_char(p.emitted_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as n
       from previsoes p
      where p.emitted_at < $1::timestamptz
        and not exists (select 1 from provas_merkle m where m.day = (p.emitted_at at time zone 'UTC')::date)
      group by 1
      order by 1`,
    [dayBounds(today).from],
  );
  return r.rows;
}

/**
 * Previsões órfãs: emitidas num dia que já tem raiz (`provas_merkle`) mas ausentes de `previsao_prova`.
 * Nenhuma raiz as cobre; o job as relata em vez de ignorá-las.
 * @param {import('../db.js').Queryable} db
 * @returns {Promise<{ id: string, hash: string, day: string, emitted_at: Date }[]>}
 */
export async function listOrphans(db) {
  const r = await db.query(
    `select p.id, p.hash, to_char(p.emitted_at at time zone 'UTC', 'YYYY-MM-DD') as day, p.emitted_at
       from previsoes p
       join provas_merkle m on m.day = (p.emitted_at at time zone 'UTC')::date
       left join previsao_prova pp on pp.previsao_id = p.id
      where pp.previsao_id is null
      order by p.emitted_at, p.hash collate "C"`,
  );
  return r.rows;
}

/**
 * Desfecho de uma previsão, se já existe.
 * @param {import('../db.js').Queryable} db
 * @param {string} previsaoId
 * @returns {Promise<{ outcome: string, ret: number|null, bars: number|null, bar_time: Date|null, resolved_at: Date|null }|null>}
 */
export async function getDesfechoByPrevisao(db, previsaoId) {
  if (typeof previsaoId !== 'string' || !UUID_RE.test(previsaoId)) return null;
  const r = await db.query(
    'select outcome, ret, bars, bar_time, resolved_at from desfechos where previsao_id = $1::uuid',
    [previsaoId],
  );
  return r.rows[0] ?? null;
}
