// Função da Vercel: GET|POST /api/analyze. Só adapta requisição e resposta; a lógica está no handler.
import { handleAnalyze } from '../lib/handlers/analyze.js';

export default async function handler(req, res) {
  const out = await handleAnalyze({ method: req.method, query: req.query || {}, body: req.body });
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).json(out.body);
}
