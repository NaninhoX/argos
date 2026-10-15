// Função da Vercel: GET /api/candles. Só adapta requisição e resposta; a lógica está no handler.
import { handleCandles } from '../lib/handlers/candles.js';

export default async function handler(req, res) {
  const out = await handleCandles({ method: req.method, query: req.query || {} });
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).json(out.body);
}
