// Acesso às rotas fechadas (Argos AI, registro de previsão, saúde do Termômetro) e limite de chamadas.
//
// Dois tipos de código, no cabeçalho x-argos-code:
//   * o código geral, ARGOS_ACCESS_CODE (variável de ambiente), como antes;
//   * um código por cliente, na tabela `acessos` (migração 002): só o SHA-256 fica no banco, com validade e revogação.
//     Criar, listar e revogar: tools/acesso.mjs.
// Sem código geral, a rota fica aberta fora de produção (desenvolvimento). Em produção é sempre fechada: vale o código
// geral ou um código de cliente; sem código geral e sem nenhum código de cliente ativo, responde 503 (nada configurado).

import { createHash, timingSafeEqual } from 'node:crypto';

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
 * @returns {Promise<{ ok: true, ref: string } | { ok: false, status: 401 | 503, code: 'unauthorized' | 'not_configured' }>}
 *   ref: 'geral' (código geral), 'acesso:<id>' (código de cliente) ou 'aberto' (fora de produção, sem nenhum código configurado)
 */
export async function autorizar({ code, env = {}, db = null, nowMs = Date.now() } = {}) {
  const given = Array.isArray(code) ? code[0] || '' : code || '';
  const geral = env.ARGOS_ACCESS_CODE;
  if (geral && given && sameCode(given, geral)) return { ok: true, ref: 'geral' };
  if (db && given) {
    try {
      const r = await db.query(
        'select id from acessos where codigo_hash = $1 and revogado_em is null and (expira_em is null or expira_em > $2) limit 1',
        [hashCodigo(given), new Date(nowMs).toISOString()]
      );
      if (r.rows.length) return { ok: true, ref: 'acesso:' + r.rows[0].id };
    } catch { /* sem a tabela ou sem banco agora: vale só o código geral */ }
  }
  // fora de produção e sem código geral configurado, a rota fica aberta (desenvolvimento local e testes), como antes
  if (!geral && env.VERCEL_ENV !== 'production') return { ok: true, ref: 'aberto' };
  // em produção, sem código geral e sem nenhum código de cliente ativo, a rota não está configurada: falha fechado (503)
  if (!geral && !(await temCodigoAtivo(db, nowMs))) return { ok: false, status: 503, code: 'not_configured' };
  return { ok: false, status: 401, code: 'unauthorized' };
}

async function temCodigoAtivo(db, nowMs) {
  if (!db) return false;
  try {
    const r = await db.query('select 1 from acessos where revogado_em is null and (expira_em is null or expira_em > $1) limit 1', [new Date(nowMs).toISOString()]);
    return r.rows.length > 0;
  } catch { return false; }
}

/** Conta uma chamada do cliente na rota, no dia (UTC). Falha de banco não derruba a resposta. */
export async function registrarUso(db, ref, rota, nowMs = Date.now()) {
  if (!db || !ref || ref === 'aberto') return;
  try {
    await db.query(
      'insert into acessos_uso (acesso_ref, rota, dia, chamadas) values ($1, $2, $3::date, 1) ' +
      'on conflict (acesso_ref, rota, dia) do update set chamadas = acessos_uso.chamadas + 1',
      [ref, rota, new Date(nowMs).toISOString().slice(0, 10)]
    );
  } catch { /* o uso é informação, não trava a rota */ }
}

/**
 * Limite de chamadas por janela fixa, no banco (vale para todas as instâncias da função).
 * @param {{ query: Function }} db
 * @param {string} chave rota mais um identificador já em hash (nunca o IP)
 * @param {{ limit: number, windowMs: number }} limite
 * @param {number} [nowMs]
 * @returns {Promise<{ ok: boolean, retryAfterS: number }>} se o banco falhar, deixa passar (ok: true): o limite não pode derrubar a rota
 */
export async function consumirLimite(db, chave, { limit, windowMs }, nowMs = Date.now()) {
  const inicio = Math.floor(nowMs / windowMs) * windowMs;
  const retryAfterS = Math.max(1, Math.ceil((inicio + windowMs - nowMs) / 1000));
  try {
    const r = await db.query(
      'insert into limite_taxa (chave, janela, contagem) values ($1, $2, 1) ' +
      'on conflict (chave, janela) do update set contagem = limite_taxa.contagem + 1 returning contagem',
      [chave, new Date(inicio).toISOString()]
    );
    // limpeza ocasional das janelas velhas (uma em cada cem chamadas, mais de um dia atrás)
    if (Math.random() < 0.01) await db.query('delete from limite_taxa where janela < $1', [new Date(nowMs - 86_400_000).toISOString()]);
    return { ok: Number(r.rows[0].contagem) <= limit, retryAfterS };
  } catch {
    return { ok: true, retryAfterS };
  }
}
