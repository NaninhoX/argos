// Função da Vercel: GET /api/termometro/status. Só adapta requisição e resposta; a lógica está no handler.
import { handleTermometroStatus } from '../../lib/handlers/termometro-status.js';

export default async function handler(req, res) {
  const out = await handleTermometroStatus({ method: req.method, code: req.headers['x-argos-code'] });
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).json(out.body);
}
