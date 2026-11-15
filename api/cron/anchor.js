// Função da Vercel: GET /api/cron/anchor (agendada em vercel.json).
import { handleCronAnchor } from '../../lib/handlers/cron-anchor.js';
import { upgradeOts } from '../../lib/ots.js';
import { observa } from '../../lib/observa.js';

async function handler(req, res) {
  // Em produção o job também completa os recibos já ancorados com o bloco do Bitcoin.
  const out = await handleCronAnchor({ authorization: req.headers.authorization, deps: { upgrade: (ots) => upgradeOts(ots) } });
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).json(out.body);
}

export default observa('/api/cron/anchor', handler);
