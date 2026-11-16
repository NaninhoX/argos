// Função da Vercel: POST /api/argos-ai. Só adapta requisição e resposta; a lógica está no handler.
import { handleArgosAi } from '../lib/handlers/argos-ai.js';
import { scanText, withDisclaimer } from '../lib/compliance.js';
import { resolveDb } from '../lib/db.js';
import { observa } from '../lib/observa.js';
import { insertToolAudit } from '../lib/repo/audit.js';
import { registrarConsulta } from '../lib/query-log.js';

// Uma requisição é a conversa inteira: até 6 rodadas de ferramentas mais 2 tentativas de texto no provedor, cada
// chamada com limite de 90 s. O mesmo valor está em vercel.json; mude os dois juntos.
export const config = { maxDuration: 200 };

// Auditoria padrão: uma linha JSON por evento no log da função (sem texto gerado, sem IP, sem chave). As rejeições
// entram só como contagens: os números crus e os trechos sinalizados ficam no evento (que segue inteiro para a
// auditoria no banco), mas nunca no log. É onde se confere, em produção, que todo número veio de ferramenta e por
// que um texto foi recusado.
export function logAudit(event) {
  const saida = { ...event };
  if ('rejections' in saida) {
    const { tentativas, numerosSemOrigem, termosSinalizados } = paramsDaResposta(event).rejeicoes;
    saida.rejections = { tentativas, numerosSemOrigem, termosSinalizados };
  }
  console.log(JSON.stringify({ argos_ai: saida }));
}

const ROTA = '/api/argos-ai';
const inteiro = (n) => (Number.isFinite(n) && n >= 0 ? Math.min(Math.trunc(n), 1_000_000) : 0);
const soma = (rejeicoes, campo) => rejeicoes.reduce((s, r) => s + (r && Array.isArray(r[campo]) ? r[campo].length : 0), 0);

/**
 * `params` da linha de query_log de uma resposta do Argos AI (evento `response` do handler). Só identificadores e
 * contagens: requestId (liga a linha às de tool_audit, que usam o mesmo valor em session_id), acessoRef ('geral',
 * 'acesso:<id>' ou 'aberto'; nunca o código nem hash dele), toolCalls, código do resultado, tentativas e quantas
 * rejeições houve por tipo. NUNCA entram o texto das rejeições, texto gerado, prompt, código de acesso, IP nem hash do IP.
 * @param {object} event
 * @returns {{ requestId: string | null, acessoRef: string | null, toolCalls: number, codigo: string | null, tentativas: number,
 *             rejeicoes: { tentativas: number, numerosSemOrigem: number, termosSinalizados: number } }}
 */
export function paramsDaResposta(event) {
  const rej = Array.isArray(event.rejections) ? event.rejections : [];
  const ref = typeof event.acessoRef === 'string' && /^(geral|aberto|acesso:\d{1,12})$/.test(event.acessoRef) ? event.acessoRef : null;
  return {
    requestId: typeof event.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(event.requestId) ? event.requestId : null,
    acessoRef: ref,
    toolCalls: inteiro(event.toolCalls),
    codigo: typeof event.code === 'string' && /^[a-z_]{1,40}$/.test(event.code) ? event.code : null,
    tentativas: inteiro(event.attempts),
    rejeicoes: { tentativas: rej.length, numerosSemOrigem: soma(rej, 'unknownNumbers'), termosSinalizados: soma(rej, 'flaggedTerms') },
  };
}

// Auditoria no banco, quando há banco. Falha de banco não derruba a resposta.
// - tool_call -> tool_audit: o que o motor entregou ao modelo, só em hash. Sem texto gerado, sem IP, sem chave.
// - response -> query_log (route '/api/argos-ai'), uma linha por requisição que chegou ao handler (inclui 401, 429, 4xx e
//   5xx), com status e latency_ms do evento, params de `paramsDaResposta` e ip_hash por hashDoIp (nulo sem
//   ARGOS_IP_HASH_KEY). `ip` é o IP da requisição, usado só para o HMAC. A retenção de 90 dias de query_log (lib/query-log.js)
//   vale para essas linhas; a gravação espera no máximo LIMITE_GRAVACAO_MS e nunca lança.
export function dbAudit(env, resolve = resolveDb, { ip = null } = {}) {
  return async (event) => {
    if (!env.DATABASE_URL) return;
    if (event.type === 'response') {
      try {
        const db = await resolve(env);
        await registrarConsulta(db, { route: ROTA, params: paramsDaResposta(event), status: event.status, latencyMs: inteiro(event.durationMs), ip }, { chave: env.ARGOS_IP_HASH_KEY });
      } catch { /* o registro é informação, não trava a rota */ }
      return;
    }
    if (event.type !== 'tool_call') return;
    try {
      const db = await resolve(env);
      const { symbol, timeframe } = event.context || {};
      await insertToolAudit(db, { at: event.at, session_id: event.requestId, tool: event.name, args: { ...event.arguments, symbol, timeframe }, result_hash: event.resultHash, model: event.model, latency_ms: event.latencyMs });
    } catch { /* a auditoria em log (acima) continua valendo */ }
  };
}

/** Monta a função com dependências trocáveis (os testes injetam `fetchImpl`, `env` e `audit`). */
export function createHandler({ env = process.env, ...deps } = {}) {
  return observa('/api/argos-ai', async function handler(req, res) {
    res.setHeader('cache-control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      return res.status(405).json({ error: 'Use POST.', code: 'bad_request' });
    }
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { body = undefined; }
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwarded || (req.socket && req.socket.remoteAddress) || '';
    const auditoriaNoBanco = dbAudit(env, resolveDb, { ip });
    const out = await handleArgosAi({
      body,
      ip,
      code: req.headers['x-argos-code'],
      env,
      // banco (quando há): códigos de cliente, uso por cliente e limite de chamadas compartilhado (lib/acesso.js)
      deps: { scanText, withDisclaimer, audit: async (e) => { logAudit(e); await auditoriaNoBanco(e); },db: env.DATABASE_URL ? await resolveDb(env).catch(() => null) : null, ...deps }
    });
    for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
    if (out.sse) {
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      return res.status(200).end(out.sse);
    }
    return res.status(out.status).json(out.body);
  });
}

export default createHandler();
