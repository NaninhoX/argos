// Camada de banco: a mesma interface sobre Neon (produção) e PGlite (testes).
//
//   const db = createDb({ connectionString })   // Neon; síncrono, não conecta até a primeira consulta
//   const db = await createTestDb()             // PGlite em memória, vazio (rode `migrate(db)` em seguida)
//   const db = await resolveDb(process.env)     // DATABASE_URL: Neon, ou PGlite migrado se começar com `pglite:` (dev local)
//
//   await db.query(text, params)  -> { rows, rowCount }
//   await db.exec(sql)            -> executa script com vários comandos, sem parâmetros
//   await db.transaction(async (tx) => { ... })  -> tx tem query() e exec(); COMMIT ao retornar, ROLLBACK ao lançar
//   await db.close()
//
// Diferenças que os repositórios absorvem (não dependa delas fora de lib/repo):
//   * bigint/bigserial: Neon devolve string; PGlite devolve number (ou BigInt acima de 2^53).
//   * tipo `date`: Neon devolve Date em hora local; PGlite em UTC. Converta com to_char() na consulta.
//   * jsonb: passe JSON.stringify(valor) com cast ($1::jsonb); array JS cru vira array Postgres no driver do Neon.
//   * Dentro de transaction(), use só `tx`; chamar `db.query` ali dentro trava no PGlite (conexão única).
//
// Neon: query() vai por HTTP (sem estado, serve para função serverless). exec() e transaction() abrem uma
// conexão WebSocket curta (uma por chamada) e a fecham; exigem WebSocket global (Node >= 22).

import { neon, Client } from '@neondatabase/serverless';

/**
 * @typedef {{ rows: any[], rowCount: number }} QueryResult
 * @typedef {{ query(text: string, params?: any[]): Promise<QueryResult>, exec(sql: string): Promise<void> }} Queryable
 * @typedef {Queryable & { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>, close(): Promise<void> }} Db
 */

/**
 * Banco de produção (Neon Postgres).
 * @param {{ connectionString: string }} opts
 * @returns {Db}
 */
export function createDb({ connectionString } = {}) {
  if (!connectionString || typeof connectionString !== 'string') {
    throw new TypeError('createDb: connectionString obrigatória (variável DATABASE_URL)');
  }
  const sql = neon(connectionString);

  /** Cliente WebSocket de vida curta, para exec() e transaction(). */
  async function withClient(fn) {
    if (typeof globalThis.WebSocket === 'undefined') {
      throw new Error('WebSocket global ausente: exec() e transaction() no Neon exigem Node >= 22');
    }
    const client = new Client({ connectionString });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  const clientQueryable = (client) => ({
    async query(text, params = []) {
      const r = await client.query(text, params);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
    async exec(script) {
      await client.query(script); // sem parâmetros: protocolo simples, aceita vários comandos
    },
  });

  return {
    async query(text, params = []) {
      const r = await sql.query(text, params, { fullResults: true });
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
    exec: (script) => withClient((client) => clientQueryable(client).exec(script)),
    transaction: (fn) =>
      withClient(async (client) => {
        await client.query('BEGIN');
        try {
          const out = await fn(clientQueryable(client));
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        }
      }),
    async close() {}, // HTTP é sem estado; conexões WebSocket já são fechadas a cada chamada
  };
}

/**
 * Banco de teste: PGlite (Postgres em WASM) em memória, fuso UTC. Vazio: aplique as migrações com migrate(db).
 * @returns {Promise<Db>}
 */
export async function createTestDb() {
  const { PGlite } = await import('@electric-sql/pglite'); // devDependency: só carrega nos testes
  const pg = new PGlite();
  await pg.exec("set time zone 'UTC'");
  return pgliteDb(pg);
}

/** Interface Db sobre uma instância de PGlite (a mesma para o banco de teste e o de desenvolvimento local). */
function pgliteDb(pg) {
  const wrap = (q) => ({
    async query(text, params = []) {
      const r = await q.query(text, params);
      return { rows: r.rows, rowCount: Math.max(r.affectedRows ?? 0, r.rows.length) };
    },
    async exec(script) {
      await q.exec(script);
    },
  });

  return {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    async close() {
      await pg.close();
    },
  };
}

const resolved = new Map(); // URL -> Promise<Db>

/**
 * Banco a partir de DATABASE_URL, memoizado por URL (uma instância por processo).
 *   pglite://memory  -> PGlite em memória, com as migrações aplicadas (só desenvolvimento local)
 *   pglite://<pasta> -> PGlite persistido na pasta indicada, com as migrações aplicadas (só desenvolvimento local)
 *   qualquer outra   -> createDb (Neon)
 * PGlite é devDependency: carrega por import dinâmico e nunca é usado em produção.
 * @param {{ DATABASE_URL?: string }} [env]
 * @returns {Promise<Db>}
 */
export async function resolveDb(env = process.env) {
  const url = env && env.DATABASE_URL;
  if (!url || typeof url !== 'string') throw new TypeError('resolveDb: DATABASE_URL ausente');
  let pending = resolved.get(url);
  if (!pending) {
    pending = /^pglite:/i.test(url) ? openPglite(url) : Promise.resolve(createDb({ connectionString: url }));
    resolved.set(url, pending);
    pending.catch(() => { if (resolved.get(url) === pending) resolved.delete(url); }); // falha não fica memoizada
  }
  return pending;
}

async function openPglite(url) {
  const rest = url.replace(/^pglite:/i, '').replace(/^\/\//, '');
  const dir = rest === '' || rest.toLowerCase() === 'memory' ? undefined : rest;
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(dir);
  await pg.exec("set time zone 'UTC'");
  const db = pgliteDb(pg);
  const close = db.close;
  db.close = async () => { resolved.delete(url); await close(); }; // fechado, sai da memoização
  const { migrate } = await import('../tools/migrate.mjs'); // import dinâmico: migrate.mjs importa este módulo
  await migrate(db);
  return db;
}
