// Função da Vercel: POST /api/previsoes. Só adapta requisição e resposta; a lógica está no handler.
import { handlePrevisoes } from '../lib/handlers/previsoes.js';

export default async function handler(req, res) {
  const out = await handlePrevisoes({ method: req.method, body: req.body, code: req.headers['x-argos-code'] });
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).json(out.body);
}
