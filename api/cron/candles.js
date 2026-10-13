// Função da Vercel: GET /api/cron/candles (agendada em vercel.json).
import { handleCronCandles } from '../../lib/handlers/cron-candles.js';

export default async function handler(req, res) {
  const out = await handleCronCandles({ authorization: req.headers.authorization });
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).json(out.body);
}
