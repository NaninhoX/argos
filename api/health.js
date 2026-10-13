// Função da Vercel: GET /api/health.
import { handleHealth } from '../lib/handlers/health.js';

export default function handler(req, res) {
  const out = handleHealth();
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).json(out.body);
}
