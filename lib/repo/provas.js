// Repositório da ancoragem: `provas_merkle` (uma raiz por dia, status e recibo OpenTimestamps) e `previsao_prova`
// (posição e caminho de Merkle de cada previsão). Dias entram e saem como texto AAAA-MM-DD (UTC).
// Neon e PGlite divergem em `date` (Date local vs UTC) e em `bytea` (Buffer vs Uint8Array): aqui o dia sai por
// to_char() e o recibo viaja em hexadecimal (encode/decode no SQL), então o resultado é o mesmo nos dois.
import { UUID_RE, jsonParam } from './util.js';

const CHUNK = 100; // folhas por INSERT (4 parâmetros cada)

/**
 * Grava a raiz do dia (status `pendente`) e o caminho de cada folha. Chame dentro de `db.transaction` (use o `tx`).
 * Se o dia já tem raiz (outra execução do job chegou antes), não grava nada.
 * @param {import('../db.js').Queryable} db
 * @param {{ day: string, root: string, n_leaves: number, leaves: { previsao_id: string, leaf_index: number, proof: object[] }[] }} p
 * @returns {Promise<{ inserted: boolean }>}
 */
export async function insertProva(db, p) {
  const r = await db.query(
    `insert into provas_merkle (day, root, n_leaves) values ($1::date, $2, $3)
     on conflict (day) do nothing returning day`,
    [p.day, p.root, p.n_leaves],
  );
  if (!r.rows.length) return { inserted: false };
  for (let i = 0; i < p.leaves.length; i += CHUNK) {
    const params = [];
    const tuples = p.leaves.slice(i, i + CHUNK).map((l, k) => {
      params.push(l.previsao_id, p.day, l.leaf_index, jsonParam(l.proof));
      const b = k * 4;
      return `($${b + 1}::uuid, $${b + 2}::date, $${b + 3}::int, $${b + 4}::jsonb)`;
    });
    await db.query(`insert into previsao_prova (previsao_id, day, leaf_index, proof) values ${tuples.join(', ')}`, params);
  }
  return { inserted: true };
}

/**
 * Raiz de um dia.
 * @param {import('../db.js').Queryable} db
 * @param {string} day
 * @param {{ withOts?: boolean }} [opts] `withOts`: traz também os bytes do recibo (`ots`, Buffer ou null)
 * @returns {Promise<{ day: string, root: string, n_leaves: number|null, status: string, has_ots: boolean,
 *   created_at: Date, updated_at: Date, ots?: Buffer|null }|null>}
 */
export async function getProva(db, day, { withOts = false } = {}) {
  const r = await db.query(
    `select to_char(day, 'YYYY-MM-DD') as day, root, n_leaves, status, (ots is not null) as has_ots,
            created_at, updated_at${withOts ? ", encode(ots, 'hex') as ots_hex" : ''}
       from provas_merkle where day = $1::date`,
    [day],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (withOts) {
    row.ots = row.ots_hex === null || row.ots_hex === undefined ? null : Buffer.from(row.ots_hex, 'hex');
    delete row.ots_hex;
  }
  return row;
}

/**
 * Raiz e caminho de uma previsão (sem os bytes do recibo). Null se a previsão ainda não entrou em nenhuma raiz.
 * @param {import('../db.js').Queryable} db
 * @param {string} previsaoId
 * @returns {Promise<{ day: string, root: string, n_leaves: number|null, status: string, has_ots: boolean,
 *   leaf_index: number, proof: { side: 'L'|'R', hash: string }[] }|null>}
 */
export async function getProvaForPrevisao(db, previsaoId) {
  if (typeof previsaoId !== 'string' || !UUID_RE.test(previsaoId)) return null;
  const r = await db.query(
    `select to_char(m.day, 'YYYY-MM-DD') as day, m.root, m.n_leaves, m.status, (m.ots is not null) as has_ots,
            pp.leaf_index, pp.proof
       from previsao_prova pp join provas_merkle m on m.day = pp.day
      where pp.previsao_id = $1::uuid`,
    [previsaoId],
  );
  return r.rows[0] ?? null;
}

/**
 * Hashes das folhas de um dia fechado, na ordem da árvore.
 * @param {import('../db.js').Queryable} db
 * @param {string} day
 * @returns {Promise<string[]>}
 */
export async function getDayLeaves(db, day) {
  const r = await db.query(
    `select p.hash from previsao_prova pp join previsoes p on p.id = pp.previsao_id
      where pp.day = $1::date order by pp.leaf_index`,
    [day],
  );
  return r.rows.map((x) => x.hash);
}

/**
 * Dias à espera de carimbo: status `pendente` ou `falhou`, do mais antigo para o mais novo.
 * @param {import('../db.js').Queryable} db
 * @returns {Promise<{ day: string, root: string, n_leaves: number|null, status: string }[]>}
 */
export async function listDaysToStamp(db) {
  const r = await db.query(
    `select to_char(day, 'YYYY-MM-DD') as day, root, n_leaves, status
       from provas_merkle where status in ('pendente', 'falhou') order by day`,
  );
  return r.rows;
}

/**
 * Guarda o recibo e passa o dia a `ancorada`. Só age em dia `pendente` ou `falhou` (nunca regride uma âncora).
 * @param {import('../db.js').Queryable} db
 * @param {string} day
 * @param {Buffer|Uint8Array} ots bytes do arquivo .ots
 * @returns {Promise<boolean>} se alguma linha mudou
 */
export async function markAnchored(db, day, ots) {
  const bytes = Buffer.from(ots);
  if (!bytes.length) throw new RangeError('recibo OpenTimestamps vazio');
  const r = await db.query(
    `update provas_merkle set status = 'ancorada', ots = decode($2, 'hex')
      where day = $1::date and status in ('pendente', 'falhou') returning day`,
    [day, bytes.toString('hex')],
  );
  return r.rows.length > 0;
}

/**
 * Dias `ancorada`, com o recibo, para tentar completá-lo com o bloco do Bitcoin.
 * @param {import('../db.js').Queryable} db
 * @returns {Promise<{ day: string, root: string, n_leaves: number|null, ots: Buffer, updated_at: Date }[]>}
 */
export async function listDaysToUpgrade(db) {
  const r = await db.query(
    `select to_char(day, 'YYYY-MM-DD') as day, root, n_leaves, encode(ots, 'hex') as ots_hex, updated_at
       from provas_merkle where status = 'ancorada' and ots is not null order by day`,
  );
  return r.rows.map(({ ots_hex, ...row }) => ({ ...row, ots: Buffer.from(ots_hex, 'hex') }));
}

/**
 * Grava o recibo completado (com atestação Bitcoin) e passa o dia de `ancorada` a `confirmada`.
 * @param {import('../db.js').Queryable} db
 * @param {string} day
 * @param {Buffer|Uint8Array} ots
 * @returns {Promise<boolean>} se alguma linha mudou
 */
export async function markConfirmed(db, day, ots) {
  const bytes = Buffer.from(ots);
  if (!bytes.length) throw new RangeError('recibo OpenTimestamps vazio');
  const r = await db.query(
    `update provas_merkle set status = 'confirmada', ots = decode($2, 'hex')
      where day = $1::date and status = 'ancorada' returning day`,
    [day, bytes.toString('hex')],
  );
  return r.rows.length > 0;
}

/**
 * Marca `falhou` um dia `pendente` cujo carimbo não saiu (um dia já `falhou` não é tocado de novo).
 * @param {import('../db.js').Queryable} db
 * @param {string} day
 * @returns {Promise<boolean>}
 */
export async function markFailed(db, day) {
  const r = await db.query(
    "update provas_merkle set status = 'falhou' where day = $1::date and status = 'pendente' returning day",
    [day],
  );
  return r.rows.length > 0;
}
