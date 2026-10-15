// GET /api/health — estado do serviço. Só diz se cada configuração existe; nunca devolve valor de segredo.
import { VERSION } from '../../engine/index.js';
import { loadSnapshot } from '../data/series.js';
import { llmReady } from '../ai/provider.js';

export function handleHealth({ env = process.env, now = Date.now() } = {}) {
  let snapshotCut = null;
  let ok = true;
  try { snapshotCut = loadSnapshot().cut; } catch { ok = false; }
  return {
    status: ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
    body: {
      ok,
      engine: VERSION,
      time: new Date(now).toISOString(),
      snapshotCut,
      database: env.DATABASE_URL ? 'configurado' : 'ausente',
      llm: llmReady(env) ? 'configurado' : 'ausente'
    }
  };
}
