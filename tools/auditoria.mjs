// Trilha do Argos AI, SÓ DE LEITURA (tabelas `query_log` e `tool_audit`). Este arquivo só faz consultas de leitura.
// Nunca mostra o ip_hash inteiro (8 caracteres), o hash do resultado inteiro (12) nem texto de resultado de ferramenta.
// Quem roda é Michel, com DATABASE_URL no ambiente (ou pglite://memory, para teste).
//
// Uso:
//   node tools/auditoria.mjs requisicao --id <requestId>
//   node tools/auditoria.mjs periodo --de AAAA-MM-DD --ate AAAA-MM-DD [--rota /api/argos-ai] [--linhas N]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDb } from '../lib/db.js';

export const USO = [
  'Uso:',
  '  node tools/auditoria.mjs requisicao --id <requestId>',
  '  node tools/auditoria.mjs periodo --de AAAA-MM-DD --ate AAAA-MM-DD [--rota /api/argos-ai] [--linhas N]',
  '  (--linhas N mostra até N linhas individuais, no máximo 200; por padrão só os totais)',
].join('\n');

export const MAX_LINHAS = 200;

/** Erro de argumento: o programa mostra a mensagem e o uso, e sai com código 1. */
export class ErroDeUso extends Error {}

/** Argumentos "--chave valor" em objeto. */
export function lerArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; } else out._.push(argv[i]);
  }
  return out;
}

const curto = (s, n) => (s == null ? '-' : String(s).slice(0, n));
const num = (v) => (v == null ? '-' : String(Math.round(Number(v) * 10) / 10));

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function formatarParams(p) {
  if (!p || typeof p !== 'object') return '-';
  const r = p.rejeicoes && typeof p.rejeicoes === 'object' ? p.rejeicoes : {};
  return [
    `acessoRef=${p.acessoRef ?? '-'}`, `toolCalls=${p.toolCalls ?? '-'}`, `codigo=${p.codigo ?? '-'}`, `tentativas=${p.tentativas ?? '-'}`,
    `rejeicoes(tentativas=${r.tentativas ?? '-'}, numerosSemOrigem=${r.numerosSemOrigem ?? '-'}, termosSinalizados=${r.termosSinalizados ?? '-'})`,
  ].join(' ');
}

async function requisicao(db, a) {
  const id = a.id;
  if (typeof id !== 'string' || !/^[0-9A-Za-z-]{1,64}$/.test(id)) throw new ErroDeUso('--id é obrigatório (requestId, só letras, números e hífen)');
  const q = await db.query(
    `select id, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as quando, route, status, latency_ms, cache_hit, engine_version, ip_hash, params
       from query_log where params->>'requestId' = $1 order by at, id`, [id]);
  const t = await db.query(
    `select id, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as quando, tool, args, result_hash, model, latency_ms
       from tool_audit where session_id = $1 order by at, id`, [id]);
  if (!q.rows.length && !t.rows.length) return `Requisição ${id}: nenhum registro.`;
  const out = [`Requisição ${id}`, '', `query_log (${q.rows.length})`];
  if (!q.rows.length) out.push('  nenhum registro');
  for (const x of q.rows) {
    out.push(`  #${x.id} ${x.quando} ${x.route ?? '-'} status=${x.status ?? '-'} latência=${x.latency_ms ?? '-'}ms cache_hit=${x.cache_hit ?? '-'} motor=${x.engine_version ?? '-'} ip=${curto(x.ip_hash, 8)}`);
    out.push(`     ${formatarParams(x.params)}`);
  }
  out.push('', `tool_audit (${t.rows.length})`);
  if (!t.rows.length) out.push('  nenhum registro');
  for (const x of t.rows) {
    out.push(`  #${x.id} ${x.quando} ${x.tool} modelo=${x.model ?? '-'} latência=${x.latency_ms ?? '-'}ms resultado=${curto(x.result_hash, 12)} args=${curto(JSON.stringify(x.args ?? null), 200)}`);
  }
  return out.join('\n');
}

async function periodo(db, a) {
  if (!dataValida(a.de) || !dataValida(a.ate)) throw new ErroDeUso('--de e --ate são obrigatórios, no formato AAAA-MM-DD');
  if (a.de > a.ate) throw new ErroDeUso('--de não pode ser depois de --ate');
  let linhas = 0;
  if (a.linhas !== undefined) {
    linhas = Number(a.linhas);
    if (!Number.isInteger(linhas) || linhas < 1 || linhas > MAX_LINHAS) throw new ErroDeUso(`--linhas deve ser um inteiro de 1 a ${MAX_LINHAS}`);
  }
  if (a.rota !== undefined && (typeof a.rota !== 'string' || !/^\/[\w\-./]{0,100}$/.test(a.rota))) throw new ErroDeUso('--rota deve ser um caminho, como /api/argos-ai');
  const rota = a.rota ?? null;
  // Intervalo [de, ate + 1 dia) em UTC: o dia final entra inteiro.
  const base = `from query_log where at >= $1::date and at < ($2::date + 1) and ($3::text is null or route = $3::text)`;
  const p = [a.de, a.ate, rota];
  const tot = await db.query(
    `select count(*)::int as n, percentile_cont(0.5) within group (order by latency_ms) as p50, percentile_cont(0.95) within group (order by latency_ms) as p95 ${base}`, p);
  const n = tot.rows[0].n;
  const cab = `Período ${a.de} a ${a.ate} (UTC)` + (rota ? `, rota ${rota}` : ', todas as rotas');
  if (!n) return `${cab}: nenhum registro.`;
  const porStatus = await db.query(`select coalesce(status::text, 'sem status') as k, count(*)::int as n ${base} group by 1 order by 2 desc, 1`, p);
  const porCodigo = await db.query(`select coalesce(params->>'codigo', 'sem código') as k, count(*)::int as n ${base} group by 1 order by 2 desc, 1`, p);
  const ferr = await db.query(
    `select count(*)::int as n from tool_audit where session_id in (select params->>'requestId' ${base} and params->>'requestId' is not null)`, p);
  const out = [
    cab, '',
    `Requisições: ${n}`,
    `Latência: p50 ${num(tot.rows[0].p50)} ms, p95 ${num(tot.rows[0].p95)} ms`,
    `Chamadas de ferramenta: ${ferr.rows[0].n}`,
    '', 'Por status:', ...porStatus.rows.map((x) => `  ${x.k}\t${x.n}`),
    '', 'Por código:', ...porCodigo.rows.map((x) => `  ${x.k}\t${x.n}`),
  ];
  if (linhas) {
    const l = await db.query(
      `select id, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as quando, route, status, latency_ms, ip_hash, params->>'codigo' as codigo, params->>'requestId' as rid ${base} order by at desc, id desc limit ${linhas}`, p);
    out.push('', `Últimas ${l.rows.length} linhas:`);
    for (const x of l.rows) out.push(`  #${x.id} ${x.quando} ${x.route ?? '-'} status=${x.status ?? '-'} latência=${x.latency_ms ?? '-'}ms codigo=${x.codigo ?? '-'} ip=${curto(x.ip_hash, 8)} req=${x.rid ?? '-'}`);
  }
  return out.join('\n');
}

/**
 * Executa um comando contra o banco. Devolve o texto a mostrar; ErroDeUso para argumento inválido.
 * @param {{ query: Function }} db
 * @param {string[]} argv
 */
export async function executar(db, argv) {
  const a = lerArgs(argv), cmd = a._[0];
  if (cmd === 'requisicao') return requisicao(db, a);
  if (cmd === 'periodo') return periodo(db, a);
  throw new ErroDeUso('comando desconhecido. Use: requisicao ou periodo');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não configurada.'); process.exit(1); }
  const argv = process.argv.slice(2);
  let db = null;
  try {
    db = await resolveDb(process.env);
    console.log(await executar(db, argv));
  } catch (e) {
    if (e instanceof ErroDeUso) console.error('Erro: ' + e.message + '\n\n' + USO); else console.error('Erro: ' + (db ? e.message : 'não foi possível abrir o banco.'));
    process.exitCode = 1;
  } finally { if (db) await db.close(); }
}
