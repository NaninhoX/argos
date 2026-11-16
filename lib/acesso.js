// Acesso às rotas fechadas (Argos AI, registro de previsão, saúde do Termômetro) e limite de chamadas.
//
// Dois tipos de código, no cabeçalho x-argos-code:
//   * o código geral, ARGOS_ACCESS_CODE (variável de ambiente), como antes;
//   * um código por cliente, na tabela `acessos` (migração 002): só o SHA-256 fica no banco, com validade e revogação.
//     Criar, listar e revogar: tools/acesso.mjs.
// Sem código geral, a rota fica aberta fora de produção (desenvolvimento). Em produção é sempre fechada: vale o código
// geral ou um código de cliente; sem código geral e sem nenhum código de cliente ativo, responde 503 (nada configurado).

import { createHash, timingSafeEqual } from 'node:crypto';

/** Prazo da consulta do limite de chamadas ao banco: passou disso, vale o limite em memória (a função não espera o banco). */
export const PRAZO_LIMITE_MS = 500;

/** Prazo de cada consulta de acesso ao banco (código de cliente, uso), no mesmo desenho de PRAZO_LIMITE_MS. */
export const PRAZO_ACESSO_MS = 500;

const FALHOU = Symbol('falhou');

/** Roda `fn` com prazo: devolve o valor, ou FALHOU se lançar ou passar do prazo (exceto tabela inexistente, abaixo). Timer sempre limpo; rejeição tardia engolida. */
async function comPrazo(fn, prazoMs) {
  // tabela inexistente (42P01, migração 002 ainda não aplicada) não é banco fora: é "nenhum código de cliente"
  const consulta = (async () => fn())().catch((e) => (e && e.code === '42P01' ? { rows: [] } : FALHOU));
  let timer;
  const prazo = new Promise((resolve) => { timer = setTimeout(() => resolve(FALHOU), prazoMs); });
  try { return await Promise.race([consulta, prazo]); } finally { clearTimeout(timer); }
}

/** SHA-256 em hexadecimal: é o que a tabela `acessos` guarda no lugar do código. */
export function hashCodigo(code) {
  return createHash('sha256').update(String(code)).digest('hex');
}

function sameCode(given, expected) {
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(given), h(expected));
}

/**
 * Confere o código de acesso.
 * @param {object} args
 * @param {string | string[]} [args.code] valor do cabeçalho x-argos-code
 * @param {Record<string, string | undefined>} [args.env]
 * @param {{ query: Function } | null} [args.db] banco, quando há (códigos por cliente)
 * @param {number} [args.nowMs]
 * @param {number} [args.prazoMs] prazo de cada consulta ao banco (padrão PRAZO_ACESSO_MS)
 * @returns {Promise<{ ok: true, ref: string } | { ok: false, status: 401 | 503, code: 'unauthorized' | 'not_configured' | 'indisponivel' }>}
 *   ref: 'geral' (código geral), 'acesso:<id>' (código de cliente) ou 'aberto' (fora de produção, sem nenhum código configurado).
 *   Banco que falha ou passa do prazo ao consultar código de cliente: falha fechada, 503 'indisponivel' (nunca libera).
 *   O código geral não depende do banco.
 */
export async function autorizar({ code, env = {}, db = null, nowMs = Date.now(), prazoMs = PRAZO_ACESSO_MS } = {}) {
  const given = Array.isArray(code) ? code[0] || '' : code || '';
  const geral = env.ARGOS_ACCESS_CODE;
  if (geral && given && sameCode(given, geral)) return { ok: true, ref: 'geral' };
  const indisponivel = { ok: false, status: 503, code: 'indisponivel' };
  if (db && given) {
    const r = await comPrazo(() => db.query(
      'select id from acessos where codigo_hash = $1 and revogado_em is null and (expira_em is null or expira_em > $2) limit 1',
      [hashCodigo(given), new Date(nowMs).toISOString()]
    ), prazoMs);
    if (r === FALHOU) return indisponivel;
    if (r.rows.length) return { ok: true, ref: 'acesso:' + r.rows[0].id };
  }
  // fora de produção e sem código geral configurado, a rota fica aberta (desenvolvimento local e testes), como antes
  if (!geral && env.VERCEL_ENV !== 'production') return { ok: true, ref: 'aberto' };
  // em produção, sem código geral e sem nenhum código de cliente ativo, a rota não está configurada: falha fechado (503)
  if (!geral) {
    const ativo = await temCodigoAtivo(db, nowMs, prazoMs);
    if (ativo === FALHOU) return indisponivel;
    if (!ativo) return { ok: false, status: 503, code: 'not_configured' };
  }
  return { ok: false, status: 401, code: 'unauthorized' };
}

async function temCodigoAtivo(db, nowMs, prazoMs) {
  if (!db) return false;
  const r = await comPrazo(() => db.query('select 1 from acessos where revogado_em is null and (expira_em is null or expira_em > $1) limit 1', [new Date(nowMs).toISOString()]), prazoMs);
  return r === FALHOU ? FALHOU : r.rows.length > 0;
}

/** Conta uma chamada do cliente na rota, no dia (UTC). Falha ou demora do banco (passou do prazo) só deixa de contar: nunca atrasa nem derruba a resposta. */
export async function registrarUso(db, ref, rota, nowMs = Date.now(), { prazoMs = PRAZO_ACESSO_MS } = {}) {
  if (!db || !ref || ref === 'aberto') return;
  await comPrazo(() => db.query(
    'insert into acessos_uso (acesso_ref, rota, dia, chamadas) values ($1, $2, $3::date, 1) ' +
    'on conflict (acesso_ref, rota, dia) do update set chamadas = acessos_uso.chamadas + 1',
    [ref, rota, new Date(nowMs).toISOString().slice(0, 10)]
  ), prazoMs); // o uso é informação, não trava a rota
}

/**
 * Limite de chamadas por janela fixa, no banco (vale para todas as instâncias da função).
 * @param {{ query: Function }} db
 * @param {string} chave rota mais um identificador já em hash (nunca o IP)
 * @param {{ limit: number, windowMs: number }} limite
 * @param {number} [nowMs]
 * @param {{ prazoMs?: number }} [opcoes] prazo da consulta ao banco (padrão PRAZO_LIMITE_MS)
 * @returns {Promise<{ ok: boolean, retryAfterS: number, indisponivel?: true }>} se o banco falhar ou passar do prazo,
 *   devolve ok: false com indisponivel: true (não é excesso de uso): quem chama cai para o limite em memória, nunca
 *   libera sem limite
 */
export async function consumirLimite(db, chave, { limit, windowMs }, nowMs = Date.now(), { prazoMs = PRAZO_LIMITE_MS } = {}) {
  const inicio = Math.floor(nowMs / windowMs) * windowMs;
  const retryAfterS = Math.max(1, Math.ceil((inicio + windowMs - nowMs) / 1000));
  const indisponivel = { ok: false, retryAfterS, indisponivel: true };
  const consulta = (async () => {
    const r = await db.query(
      'insert into limite_taxa (chave, janela, contagem) values ($1, $2, 1) ' +
      'on conflict (chave, janela) do update set contagem = limite_taxa.contagem + 1 returning contagem',
      [chave, new Date(inicio).toISOString()]
    );
    // limpeza ocasional das janelas velhas (uma em cada cem chamadas, mais de um dia atrás)
    if (Math.random() < 0.01) await db.query('delete from limite_taxa where janela < $1', [new Date(nowMs - 86_400_000).toISOString()]);
    return { ok: Number(r.rows[0].contagem) <= limit, retryAfterS };
  })().catch(() => indisponivel); // também engole a rejeição de uma consulta que termina depois do prazo
  let timer;
  const prazo = new Promise((resolve) => { timer = setTimeout(() => resolve(indisponivel), prazoMs); });
  try { return await Promise.race([consulta, prazo]); } finally { clearTimeout(timer); }
}
