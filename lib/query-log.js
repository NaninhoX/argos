// Registro das consultas a /api/analyze em query_log (rota, parâmetros do motor, status, latência, cache, versão, ip_hash).
// Sem dado pessoal: o IP entra só como HMAC-SHA256 com chave (ARGOS_IP_HASH_KEY) e o mês UTC misturado, então o hash muda
// todo mês e não se desfaz por tabela de IPs. Sem chave, ip_hash fica nulo: nunca se grava IP nem hash sem sal. O código de
// acesso nunca é lido e `params` leva apenas os parâmetros já validados do motor. As linhas são apagadas depois de 90 dias
// (limpeza ocasional, 1% das gravações). `cache_hit` mede só o cache da instância: respostas servidas pela CDN não chegam à
// função e, portanto, não aparecem aqui. Falha de banco (ou demora) não derruba a resposta.
import { createHmac } from 'node:crypto';
import { resolveDb } from './db.js';
import { insertQueryLog } from './repo/audit.js';

/** Tempo máximo, em ms, que a gravação (e a limpeza) pode somar à resposta. */
export const LIMITE_GRAVACAO_MS = 500;

/** Prazo de retenção de query_log, em dias. */
export const RETENCAO_DIAS = 90;

/** Chance, por chamada, de rodar a limpeza das linhas vencidas. */
export const CHANCE_LIMPEZA = 0.01;

/**
 * Hash do IP para o campo ip_hash: HMAC-SHA256(chave, 'AAAA-MM|ip') em hex, 32 primeiros caracteres. O mês UTC entra na
 * mensagem, então o mesmo IP gera hashes diferentes em meses diferentes. Sem IP ou sem chave devolve null.
 * @param {string | null | undefined} ip
 * @param {string | null | undefined} [chave] chave do HMAC; padrão: process.env.ARGOS_IP_HASH_KEY
 * @param {Date} [agora] relógio (injetável nos testes)
 * @returns {string | null}
 */
export function hashDoIp(ip, chave = process.env.ARGOS_IP_HASH_KEY, agora = new Date()) {
  const v = String(ip || '').trim();
  const k = String(chave || '');
  if (!v || !k) return null;
  const mes = agora.toISOString().slice(0, 7);
  return createHmac('sha256', k).update(`${mes}|${v}`).digest('hex').slice(0, 32);
}

/**
 * Parâmetros do motor que vão para `params`: só o que o validador aceitou (símbolo, tempo gráfico, configuração,
 * janela e modos). Nada vem de cabeçalho, IP ou corpo cru.
 * @param {{ symbol: string, timeframe: string, cfg: object, windowDays: number | null, live: boolean, brief: boolean, snapshotOnly: boolean } | null | undefined} valor
 *   `value` de parseAnalyzeInput; ausente quando a requisição foi recusada (nada é gravado do que o cliente mandou)
 * @returns {object | null}
 */
export function paramsDaConsulta(valor) {
  if (!valor) return null;
  const { symbol, timeframe, cfg, windowDays, live, brief, snapshotOnly } = valor;
  return { symbol, tf: timeframe, cfg: { mode: cfg.mode, tgt: cfg.tgt, stp: cfg.stp, hold: cfg.hold }, windowDays, live, brief, snapshotOnly };
}

/**
 * Grava uma linha em query_log. Nunca lança: qualquer falha (sem tabela, banco fora, demora) é engolida.
 * Sem banco (db nulo), não grava. Depois de gravar, com chance de 1% apaga as linhas com mais de 90 dias.
 * @param {import('./db.js').Queryable | null | undefined} db
 * @param {{ route: string, params?: object | null, status: number, latencyMs: number, cacheHit?: boolean | null,
 *           engineVersion?: string | null, ip?: string | null }} q
 * @param {{ chave?: string | null, agora?: Date, sorteio?: () => number }} [opcoes] injeção para testes:
 *   chave do HMAC, relógio e sorteio (número em [0, 1)) da limpeza
 * @returns {Promise<boolean>} true se gravou
 */
export async function registrarConsulta(db, q, opcoes = {}) {
  if (!db) return false;
  const { chave = process.env.ARGOS_IP_HASH_KEY, agora = new Date(), sorteio = Math.random } = opcoes;
  let timer;
  try {
    const gravar = (async () => {
      await insertQueryLog(db, {
        route: q.route,
        params: q.params ?? null,
        status: q.status,
        latency_ms: Math.max(0, Math.round(q.latencyMs)),
        cache_hit: typeof q.cacheHit === 'boolean' ? q.cacheHit : null,
        engine_version: q.engineVersion ?? null,
        ip_hash: hashDoIp(q.ip, chave, agora),
      });
      return true;
    })();
    const limpeza = gravar.then(async (ok) => {
      try {
        if (sorteio() < CHANCE_LIMPEZA) {
          await db.query(`delete from query_log where at < now() - interval '${RETENCAO_DIAS} days'`);
        }
      } catch { /* a limpeza é best-effort */ }
      return ok;
    });
    gravar.catch(() => {}); // se a corrida abaixo vencer pelo tempo, a falha tardia não vira rejeição solta
    limpeza.catch(() => {});
    const limite = new Promise((resolve) => { timer = setTimeout(() => resolve(false), LIMITE_GRAVACAO_MS); });
    return await Promise.race([limpeza, limite]);
  } catch {
    return false; // o registro é informação, não trava a rota
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Banco para o registro: só quando DATABASE_URL existe; se não abrir, null (e nada é gravado).
 * @param {{ DATABASE_URL?: string }} env
 * @returns {Promise<import('./db.js').Db | null>}
 */
export async function bancoDoRegistro(env) {
  if (!env || !env.DATABASE_URL) return null;
  try { return await resolveDb(env); } catch { return null; }
}
