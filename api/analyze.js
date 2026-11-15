// Função da Vercel: GET|POST /api/analyze. Só adapta requisição e resposta; a lógica está no handler.
// Com banco (DATABASE_URL), cada chamada vira uma linha em query_log (lib/query-log.js); falha na gravação não muda a resposta.
import { handleAnalyze, parseAnalyzeInput } from '../lib/handlers/analyze.js';
import { observa } from '../lib/observa.js';
import { bancoDoRegistro, paramsDaConsulta, registrarConsulta } from '../lib/query-log.js';

/** Monta a função com dependências trocáveis (os testes injetam `env`, `db` e o que o handler aceita em `deps`). */
export function createHandler({ env = process.env, db, ...deps } = {}) {
  return observa('/api/analyze', async function handler(req, res) {
    const t0 = performance.now();
    const method = req.method;
    const query = req.query || {};
    const out = await handleAnalyze({ method, query, body: req.body, deps });
    // mesmos parâmetros que o handler validou; recusada (405/400), nada do que o cliente mandou é gravado
    const parsed = method === 'GET' || method === 'POST'
      ? parseAnalyzeInput(method === 'POST' && req.body && typeof req.body === 'object' ? req.body : query)
      : {};
    const forwarded = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
    await registrarConsulta(db === undefined ? await bancoDoRegistro(env) : db, {
      route: '/api/analyze',
      params: paramsDaConsulta(parsed.value),
      status: out.status,
      latencyMs: performance.now() - t0,
      cacheHit: out.status === 200 ? out.body.cacheHit : null,
      engineVersion: out.status === 200 ? out.body.engine : null,
      ip: forwarded || (req.socket && req.socket.remoteAddress) || '',
    });
    for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
    res.status(out.status).json(out.body);
  });
}

export default createHandler();
