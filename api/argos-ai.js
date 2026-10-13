// Função da Vercel: POST /api/argos-ai. Só adapta requisição e resposta; a lógica está no handler.
import { handleArgosAi } from '../lib/handlers/argos-ai.js';
import { scanText, withDisclaimer } from '../lib/compliance.js';

// Até duas chamadas ao provedor por requisição (a segunda só se a verificação reprovar o texto), cada uma com
// limite de 90 s. O mesmo valor está em vercel.json; mude os dois juntos.
export const config = { maxDuration: 200 };

// Auditoria padrão: uma linha JSON por evento no log da função (sem texto gerado, sem IP, sem chave).
// É onde se confere, em produção, que todo número veio de ferramenta e por que um texto foi recusado.
const logAudit = (event) => console.log(JSON.stringify({ argos_ai: event }));

/** Monta a função com dependências trocáveis (os testes injetam `fetchImpl`, `env` e `audit`). */
export function createHandler({ env = process.env, ...deps } = {}) {
  return async function handler(req, res) {
    res.setHeader('cache-control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      return res.status(405).json({ error: 'Use POST.', code: 'bad_request' });
    }
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { body = undefined; }
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const out = await handleArgosAi({
      body,
      ip: forwarded || (req.socket && req.socket.remoteAddress) || '',
      code: req.headers['x-argos-code'],
      env,
      deps: { scanText, withDisclaimer, audit: logAudit, ...deps }
    });
    for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
    if (out.sse) {
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      return res.status(200).end(out.sse);
    }
    return res.status(out.status).json(out.body);
  };
}

export default createHandler();
