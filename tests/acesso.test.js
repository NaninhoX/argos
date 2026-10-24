// Acesso por cliente (lib/acesso.js, tools/acesso.mjs, migração 002): código geral, código de cliente com validade e
// revogação, uso por cliente e limite de chamadas no banco. Banco: PGlite em memória.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';
import { autorizar, consumirLimite, hashCodigo, registrarUso } from '../lib/acesso.js';
import { executar, novoCodigo } from '../tools/acesso.mjs';

let db;
before(async () => { db = await createTestDb(); await migrate(db); });
after(async () => { await db.close(); });

const PROD = { VERCEL_ENV: 'production' };
const T0 = Date.UTC(2026, 9, 24, 12);

test('acesso: fora de produção e sem código geral, a rota fica aberta (como antes)', async () => {
  assert.deepEqual(await autorizar({ code: '', env: {}, db: null }), { ok: true, ref: 'aberto' });
});

test('acesso: em produção sem código geral e sem código de cliente ativo, 503; com código geral, só ele vale', async () => {
  assert.equal((await autorizar({ code: 'x', env: PROD, db: null })).status, 503);
  assert.equal((await autorizar({ code: 'x', env: PROD, db, nowMs: T0 })).status, 503, 'tabela vazia ainda é "não configurado"');
  const env = { ...PROD, ARGOS_ACCESS_CODE: 'segredo-geral' };
  assert.deepEqual(await autorizar({ code: 'segredo-geral', env, db }), { ok: true, ref: 'geral' });
  assert.equal((await autorizar({ code: 'errado', env, db })).status, 401);
  assert.equal((await autorizar({ code: '', env, db })).status, 401);
});

test('acesso: código de cliente criado pela ferramenta vale, guarda só o hash, vence e pode ser revogado', async () => {
  const codigo = novoCodigo();
  assert.match(codigo, /^arg_[a-z2-9]{26}$/);
  const saida = await executar(db, ['criar', '--rotulo', 'Fundo Teste', '--dias', '30'], { now: T0, codigo });
  assert.match(saida, /Acesso \d+ criado para "Fundo Teste", válido até 2026-11-23/);
  assert.ok(saida.includes(codigo), 'o código aparece uma vez na saída');
  const linhas = (await db.query('select codigo_hash from acessos')).rows;
  assert.ok(linhas.every((r) => r.codigo_hash !== codigo), 'o banco nunca guarda o código');
  assert.ok(linhas.some((r) => r.codigo_hash === hashCodigo(codigo)));

  const ok = await autorizar({ code: codigo, env: PROD, db, nowMs: T0 });
  assert.equal(ok.ok, true);
  assert.match(ok.ref, /^acesso:\d+$/);
  assert.equal((await autorizar({ code: 'arg_naoexiste', env: PROD, db, nowMs: T0 })).status, 401, 'com cliente ativo, código errado é 401');
  assert.equal((await autorizar({ code: codigo, env: PROD, db, nowMs: T0 + 31 * 86_400_000 })).ok, false, 'vencido');

  assert.match(await executar(db, ['listar'], { now: T0 }), /Fundo Teste\tcriado 2026-10-24\tvale até 2026-11-23\tativo/);
  const id = ok.ref.split(':')[1];
  assert.match(await executar(db, ['revogar', '--id', id], { now: T0 }), /revogado/);
  assert.equal((await autorizar({ code: codigo, env: PROD, db, nowMs: T0 })).ok, false, 'revogado não vale');
  assert.match(await executar(db, ['revogar', '--id', id], { now: T0 }), /Nada a fazer/);
});

test('acesso: uso por cliente conta chamadas por rota e dia, e o código geral aparece como "código geral"', async () => {
  await registrarUso(db, 'geral', 'argos-ai', T0);
  await registrarUso(db, 'geral', 'argos-ai', T0);
  await registrarUso(db, 'aberto', 'argos-ai', T0); // desenvolvimento: não conta
  const r = await db.query("select chamadas from acessos_uso where acesso_ref = 'geral' and rota = 'argos-ai'");
  assert.equal(r.rows[0].chamadas, 2);
  assert.match(await executar(db, ['uso', '--dias', '7'], { now: T0 }), /código geral\targos-ai\t2/);
});

test('acesso: limite de chamadas no banco vale por janela e recomeça na janela seguinte', async () => {
  const lim = { limit: 2, windowMs: 60_000 };
  assert.equal((await consumirLimite(db, 'argos-ai:abc', lim, T0)).ok, true);
  assert.equal((await consumirLimite(db, 'argos-ai:abc', lim, T0 + 1000)).ok, true);
  const terceiro = await consumirLimite(db, 'argos-ai:abc', lim, T0 + 2000);
  assert.equal(terceiro.ok, false);
  assert.equal(terceiro.retryAfterS, 58);
  assert.equal((await consumirLimite(db, 'argos-ai:outro', lim, T0 + 2000)).ok, true, 'chave diferente, contagem própria');
  assert.equal((await consumirLimite(db, 'argos-ai:abc', lim, T0 + 60_000)).ok, true, 'janela nova');
  assert.equal((await consumirLimite({ query: async () => { throw new Error('fora'); } }, 'k', lim, T0)).ok, true, 'banco fora não derruba a rota');
});
