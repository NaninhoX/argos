import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveDb } from '../lib/db.js';
import { contar, apagarTudo, relatorio } from '../tools/limpar-limite-taxa.mjs';

async function banco() {
  const db = await resolveDb({ DATABASE_URL: 'pglite://memory' });
  await db.query("insert into limite_taxa (chave, janela, contagem) values ('argos-ai:aaaa', '2026-11-10T12:00:00Z', 3), ('argos-ai:bbbb', '2026-11-15T12:00:00Z', 1)");
  return db;
}

test('limpeza do limite: contar não escreve nada e não mostra chaves', async () => {
  const db = await banco();
  const antes = await contar(db);
  assert.equal(antes.linhas, 2);
  assert.equal(antes.maisAntiga, '2026-11-10T12:00:00.000Z');
  assert.equal(antes.maisRecente, '2026-11-15T12:00:00.000Z');
  assert.equal((await contar(db)).linhas, 2, 'contar é só leitura');
  const txt = relatorio(antes, null);
  assert.ok(!/argos-ai:/.test(txt), 'a saída não mostra chaves');
  assert.match(txt, /Nada foi apagado/);
  await db.close();
});

test('limpeza do limite: apagarTudo devolve quantas saíram e deixa a tabela vazia', async () => {
  const db = await banco();
  assert.equal(await apagarTudo(db), 2);
  assert.equal((await contar(db)).linhas, 0);
  assert.equal(await apagarTudo(db), 0, 'rodar de novo não apaga nada');
  assert.match(relatorio(await contar(db), 2), /Apagadas: 2/);
  await db.close();
});

test('limpeza do limite: só toca limite_taxa (nenhuma outra tabela no código)', () => {
  const src = readFileSync(new URL('../tools/limpar-limite-taxa.mjs', import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const tabelas = [...src.matchAll(/\b(?:from|into|update|table)\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase()).filter((t) => !['d', 'node', 'import'].includes(t));
  assert.ok(tabelas.length > 0);
  assert.ok(tabelas.every((t) => t === 'limite_taxa'), 'só limite_taxa: ' + tabelas.join(','));
});
