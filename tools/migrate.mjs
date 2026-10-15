// Aplica as migrações pendentes de db/migrations (ordem do nome do arquivo) e registra em schema_migrations.
// Idempotente: migração já registrada não roda de novo. Cada arquivo roda numa transação própria,
// junto com o registro; se falhar, nada daquele arquivo fica no banco.
// Uso: DATABASE_URL=postgres://... node tools/migrate.mjs
// Com --if-configured (usado no build da Vercel): sem DATABASE_URL, ou com banco em memória, sai sem erro e sem fazer nada.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../lib/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS_DIR = path.join(root, 'db', 'migrations');

// Impede duas execuções simultâneas (ex.: dois deploys) de aplicarem a mesma migração.
const LOCK_KEY = 727401;

// A tabela de controle pertence ao executor (precisa existir antes da primeira migração), não às migrações.
const BOOTSTRAP = `create table if not exists schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
)`;

/**
 * Aplica as migrações pendentes.
 * @param {import('../lib/db.js').Db} db
 * @param {{ dir?: string, log?: (msg: string) => void }} [opts]
 * @returns {Promise<{ applied: string[], skipped: string[] }>} versões aplicadas agora e já existentes
 */
export async function migrate(db, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  const skipped = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const script = fs.readFileSync(path.join(dir, file), 'utf8');
    const done = await db.transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]);
      await tx.exec(BOOTSTRAP);
      const seen = await tx.query('select 1 from schema_migrations where version = $1', [version]);
      if (seen.rows.length) return false;
      await tx.exec(script);
      await tx.query('insert into schema_migrations (version) values ($1)', [version]);
      return true;
    });
    (done ? applied : skipped).push(version);
    log(`${done ? 'aplicada' : 'já aplicada'}: ${version}`);
  }
  return { applied, skipped };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (process.argv.includes('--if-configured') && (!connectionString || connectionString.startsWith('pglite:'))) {
    console.log('migração pulada: DATABASE_URL ausente ou em memória.');
    return;
  }
  if (!connectionString) {
    console.error('DATABASE_URL não definida.');
    process.exit(1);
  }
  const db = createDb({ connectionString });
  try {
    const { applied, skipped } = await migrate(db, { log: console.log });
    console.log(`${applied.length} aplicada(s), ${skipped.length} já existente(s).`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Falha na migração:', err.message);
    process.exit(1);
  });
}
