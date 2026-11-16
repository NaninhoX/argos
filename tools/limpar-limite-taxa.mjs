// Limpeza única da tabela `limite_taxa` (migração 002). Quem roda é Michel, com a DATABASE_URL de produção no ambiente.
//
// Por quê: até 15/11 a chave do limite do Argos AI era "argos-ai:" + SHA-256 do IP, que se desfaz por força bruta no espaço
// IPv4. Essas linhas ficaram no Neon e entram nos backups. A tabela só guarda contadores de janelas de 1 minuto, então
// nenhuma linha tem valor depois de alguns minutos: apagar tudo não perde histórico nem afrouxa o limite.
//
// Uso:
//   node tools/limpar-limite-taxa.mjs             só conta (linhas, janela mais antiga e mais recente). Não apaga nada.
//   node tools/limpar-limite-taxa.mjs --apagar    apaga todas as linhas de limite_taxa e mostra quantas saíram
//
// Rode ANTES de criar ARGOS_IP_HASH_KEY na Vercel (as linhas novas, com HMAC, têm o mesmo formato das antigas).
// Nunca imprime a DATABASE_URL nem as chaves da tabela.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDb } from '../lib/db.js';

/**
 * Conta as linhas de limite_taxa. Não escreve nada.
 * @param {import('../lib/db.js').Queryable} db
 * @returns {Promise<{ linhas: number, maisAntiga: string | null, maisRecente: string | null }>}
 */
export async function contar(db) {
  const { rows } = await db.query('select count(*)::int as n, min(janela) as de, max(janela) as ate from limite_taxa');
  const r = rows[0] || {};
  return { linhas: Number(r.n || 0), maisAntiga: r.de ? new Date(r.de).toISOString() : null, maisRecente: r.ate ? new Date(r.ate).toISOString() : null };
}

/**
 * Apaga todas as linhas de limite_taxa (contadores de 1 minuto, sem histórico). Devolve quantas saíram.
 * @param {import('../lib/db.js').Queryable} db
 * @returns {Promise<number>}
 */
export async function apagarTudo(db) {
  const { rows } = await db.query('with d as (delete from limite_taxa returning 1) select count(*)::int as n from d');
  return Number((rows[0] || {}).n || 0);
}

/** Texto de saída (sem chaves nem URL). */
export function relatorio(antes, apagadas) {
  const linhas = [`limite_taxa: ${antes.linhas} linha(s); janela mais antiga ${antes.maisAntiga || '-'}, mais recente ${antes.maisRecente || '-'}.`];
  if (apagadas == null) linhas.push('Nada foi apagado. Para apagar: node tools/limpar-limite-taxa.mjs --apagar');
  else linhas.push(`Apagadas: ${apagadas}.`);
  return linhas.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const apagar = process.argv.slice(2).includes('--apagar');
  const extra = process.argv.slice(2).filter((a) => a !== '--apagar');
  if (extra.length) { console.error('Argumento desconhecido. Uso: node tools/limpar-limite-taxa.mjs [--apagar]'); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não configurada.'); process.exit(1); }
  let db = null;
  try {
    db = await resolveDb(process.env);
    const antes = await contar(db);
    console.log(relatorio(antes, apagar ? await apagarTudo(db) : null));
  } catch (e) {
    console.error('Erro: ' + (db ? e.message : 'não foi possível abrir o banco.'));
    process.exitCode = 1;
  } finally { if (db) await db.close(); }
}
