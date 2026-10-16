import { handleCronTermometro } from '../../lib/handlers/cron-termometro.js';

export default async function handler(req, res) {
  const out = await handleCronTermometro({ authorization: req.headers.authorization, query: req.query || {} });
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).json(out.body);
}
