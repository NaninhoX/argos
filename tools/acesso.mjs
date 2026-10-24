// Códigos de acesso por cliente (tabela `acessos`, migração 002). Só o SHA-256 do código fica no banco: o código
// aparece uma única vez, na saída do comando `criar`. Quem roda é Michel, com DATABASE_URL de produção no ambiente.
//
// Uso:
//   node tools/acesso.mjs criar --rotulo "Fundo X" [--dias 90]   cria e mostra o código uma vez
//   node tools/acesso.mjs listar                                  rótulo, criação, validade e situação (nunca o código)
//   node tools/acesso.mjs revogar --id 3                          deixa de valer na hora (a linha fica, para o histórico)
//   node tools/acesso.mjs uso [--dias 30]                         chamadas por cliente, rota e dia
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDb } from '../lib/db.js';
import { hashCodigo } from '../lib/acesso.js';

const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789'; // sem 0/o e 1/l, para ditar sem erro

/** Código novo: "arg_" mais 26 caracteres (cerca de 130 bits de acaso). */
export function novoCodigo(bytes = randomBytes(26)) {
  return 'arg_' + Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
}

/** Argumentos "--chave valor" em objeto. */
export function lerArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; } else out._.push(argv[i]);
  }
  return out;
}

/**
 * Executa um comando contra o banco. Devolve o texto a mostrar.
 * @param {{ query: Function }} db
 * @param {string[]} argv
 * @param {{ now?: number, codigo?: string }} [opts] relógio e código fixos, para os testes
 */
export async function executar(db, argv, opts = {}) {
  const a = lerArgs(argv), cmd = a._[0], now = opts.now ?? Date.now();
  if (cmd === 'criar') {
    const rotulo = String(a.rotulo || '').trim();
    if (!rotulo || rotulo.length > 80) throw new Error('--rotulo é obrigatório (até 80 caracteres)');
    const dias = a.dias === undefined ? null : Number(a.dias);
    if (dias !== null && !(Number.isInteger(dias) && dias > 0)) throw new Error('--dias deve ser um número inteiro positivo');
    const codigo = opts.codigo || novoCodigo();
    const expira = dias ? new Date(now + dias * 86_400_000).toISOString() : null;
    const r = await db.query('insert into acessos (rotulo, codigo_hash, criado_em, expira_em) values ($1, $2, $3, $4) returning id', [rotulo, hashCodigo(codigo), new Date(now).toISOString(), expira]);
    return [
      `Acesso ${r.rows[0].id} criado para "${rotulo}"` + (expira ? `, válido até ${expira.slice(0, 10)}` : ', sem data de validade') + '.',
      '',
      `Código (aparece só agora; o banco guarda só o hash): ${codigo}`,
      '',
      'Entregue ao cliente por um canal seguro. Ele digita o código na plataforma (campo "código de acesso").'
    ].join('\n');
  }
  if (cmd === 'listar') {
    const r = await db.query("select id, rotulo, to_char(criado_em at time zone 'UTC', 'YYYY-MM-DD') as criado, to_char(expira_em at time zone 'UTC', 'YYYY-MM-DD') as expira, revogado_em is not null as revogado, (expira_em is not null and expira_em <= $1) as vencido from acessos order by id", [new Date(now).toISOString()]);
    if (!r.rows.length) return 'Nenhum código de cliente cadastrado.';
    return r.rows.map((x) => `${x.id}\t${x.rotulo}\tcriado ${x.criado}\t${x.expira ? 'vale até ' + x.expira : 'sem validade'}\t${x.revogado ? 'REVOGADO' : x.vencido ? 'VENCIDO' : 'ativo'}`).join('\n');
  }
  if (cmd === 'revogar') {
    const id = Number(a.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error('--id é obrigatório');
    const r = await db.query('update acessos set revogado_em = $2 where id = $1 and revogado_em is null returning rotulo', [id, new Date(now).toISOString()]);
    return r.rows.length ? `Acesso ${id} ("${r.rows[0].rotulo}") revogado.` : `Nada a fazer: o acesso ${id} não existe ou já estava revogado.`;
  }
  if (cmd === 'uso') {
    const dias = a.dias === undefined ? 30 : Number(a.dias);
    const desde = new Date(now - dias * 86_400_000).toISOString().slice(0, 10);
    const r = await db.query("select u.acesso_ref, coalesce(a.rotulo, case when u.acesso_ref = 'geral' then 'código geral' else u.acesso_ref end) as quem, u.rota, sum(u.chamadas)::int as chamadas from acessos_uso u left join acessos a on u.acesso_ref = 'acesso:' || a.id where u.dia >= $1::date group by 1, 2, 3 order by 4 desc", [desde]);
    if (!r.rows.length) return `Nenhuma chamada registrada desde ${desde}.`;
    return [`Chamadas desde ${desde}:`].concat(r.rows.map((x) => `${x.quem}\t${x.rota}\t${x.chamadas}`)).join('\n');
  }
  throw new Error('comando desconhecido. Use: criar, listar, revogar ou uso');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não configurada.'); process.exit(1); }
  const db = await resolveDb(process.env);
  try { console.log(await executar(db, process.argv.slice(2))); }
  catch (e) { console.error('Erro: ' + e.message); process.exitCode = 1; }
  finally { await db.close(); }
}
