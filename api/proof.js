// Função da Vercel: GET /api/proof. Só adapta requisição e resposta; a lógica está no handler.
// O corpo pode ser objeto (JSON), texto (manifesto) ou Buffer (recibo .ots).
import { handleProof } from '../lib/handlers/proof.js';

export default async function handler(req, res) {
  const out = await handleProof({ method: req.method, query: req.query || {} });
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  if (typeof out.body === 'string' || Buffer.isBuffer(out.body)) return res.status(out.status).send(out.body);
  return res.status(out.status).json(out.body);
}
