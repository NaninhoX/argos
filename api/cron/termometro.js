import { handleCronTermometro } from '../../lib/handlers/cron-termometro.js';
import { observa } from '../../lib/observa.js';

async function handler(req, res) {
  const out = await handleCronTermometro({ authorization: req.headers.authorization, query: req.query || {} });
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).json(out.body);
}

export default observa('/api/cron/termometro', handler);
