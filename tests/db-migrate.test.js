// Migrações no PGlite: aplicam, reaplicam sem erro, respeitam ordem e atomicidade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDb, createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';

const TABLES = [
  'schema_migrations', 'engine_versions', 'candles', 'regimes', 'previsoes', 'desfechos', 'provas_merkle',
  'previsao_prova', 'resultados_matriz', 'query_log', 'tool_audit', 'agent_runs', 'revisao_humana', 'plano_calibracao',
];

async function tableNames(db) {
  const r = await db.query("select table_name from information_schema.tables where table_schema = 'public' order by 1");
  return r.rows.map((x) => x.table_name);
}

test('migração aplica o esquema completo e semeia a versão do motor', async () => {
  const db = await createTestDb();
  try {
    const res = await migrate(db);
    assert.deepEqual(res.applied, ['001_init']);
    assert.deepEqual(res.skipped, []);
    const names = await tableNames(db);
    for (const t of TABLES) assert.ok(names.includes(t), `tabela ausente: ${t}`);
    const ev = await db.query('select version, commit_sha from engine_versions');
    assert.deepEqual(ev.rows, [{ version: 'argos-engine 1.1.0', commit_sha: null }]);
    const sm = await db.query('select version from schema_migrations');
    assert.deepEqual(sm.rows, [{ version: '001_init' }]);
  } finally {
    await db.close();
  }
});

test('reaplicar não faz nada e não dá erro', async () => {
  const db = await createTestDb();
  try {
    await migrate(db);
    const again = await migrate(db);
    assert.deepEqual(again.applied, []);
    assert.deepEqual(again.skipped, ['001_init']);
    const sm = await db.query('select count(*)::int as n from schema_migrations');
    assert.equal(sm.rows[0].n, 1);
    const ev = await db.query('select count(*)::int as n from engine_versions');
    assert.equal(ev.rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test('migrações pendentes entram em ordem; só as novas rodam depois', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argos-mig-'));
  const db = await createTestDb();
  try {
    fs.writeFileSync(path.join(dir, '002_b.sql'), 'create table b (x int); insert into b values (2);');
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'create table a (x int); insert into a values (1);');
    const first = await migrate(db, { dir });
    assert.deepEqual(first.applied, ['001_a', '002_b']);

    fs.writeFileSync(path.join(dir, '003_c.sql'), 'create table c (x int);');
    const second = await migrate(db, { dir });
    assert.deepEqual(second.applied, ['003_c']);
    assert.deepEqual(second.skipped, ['001_a', '002_b']);

    const log = await db.query('select version from schema_migrations order by applied_at, version');
    assert.deepEqual(log.rows.map((x) => x.version), ['001_a', '002_b', '003_c']);
  } finally {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migração que falha desfaz tudo daquele arquivo e não é registrada', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argos-mig-'));
  const db = await createTestDb();
  try {
    fs.writeFileSync(path.join(dir, '001_ok.sql'), 'create table ok (x int);');
    fs.writeFileSync(path.join(dir, '002_ruim.sql'), 'create table meio (x int); select 1 / 0;');
    await assert.rejects(() => migrate(db, { dir }), /division by zero/);
    const names = await tableNames(db);
    assert.ok(names.includes('ok'));
    assert.ok(!names.includes('meio'), 'a tabela da migração falha não pode sobrar');
    const log = await db.query('select version from schema_migrations');
    assert.deepEqual(log.rows.map((x) => x.version), ['001_ok'] );
  } finally {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createDb exige connectionString e expõe a mesma interface do banco de teste', async () => {
  assert.throws(() => createDb({}), /connectionString/);
  assert.throws(() => createDb(), /connectionString/);
  const neonDb = createDb({ connectionString: 'postgres://u:p@ep-teste.neon.invalid/db' }); // não conecta
  const testDb = await createTestDb();
  try {
    for (const m of ['query', 'exec', 'transaction', 'close']) {
      assert.equal(typeof neonDb[m], 'function', `createDb sem ${m}`);
      assert.equal(typeof testDb[m], 'function', `createTestDb sem ${m}`);
    }
  } finally {
    await testDb.close();
  }
});

test('transaction do banco de teste faz rollback ao lançar erro', async () => {
  const db = await createTestDb();
  try {
    await db.exec('create table t (x int)');
    await assert.rejects(
      () => db.transaction(async (tx) => { await tx.query('insert into t values ($1)', [1]); throw new Error('falha'); }),
      /falha/,
    );
    const out = await db.transaction(async (tx) => { await tx.query('insert into t values ($1)', [2]); return 'ok'; });
    assert.equal(out, 'ok');
    const r = await db.query('select x from t');
    assert.deepEqual(r.rows, [{ x: 2 }]);
  } finally {
    await db.close();
  }
});

test('CLI sem DATABASE_URL falha com mensagem clara', () => {
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'migrate.mjs');
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const r = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DATABASE_URL/);
});

test('migrate.mjs --if-configured: sem DATABASE_URL, ou com banco em memória, sai sem erro e sem tocar em nada', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('../tools/migrate.mjs', import.meta.url));
  for (const url of [undefined, 'pglite://memory']) {
    const env = { ...process.env }; delete env.DATABASE_URL; if (url) env.DATABASE_URL = url;
    const r = spawnSync(process.execPath, [script, '--if-configured'], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /migração pulada/);
  }
  const bare = spawnSync(process.execPath, [script], { env: (() => { const e = { ...process.env }; delete e.DATABASE_URL; return e; })(), encoding: 'utf8' });
  assert.equal(bare.status, 1, 'sem a flag, a falta de DATABASE_URL continua sendo erro');
});
