// POST /api/previsoes — registra uma previsão com hash canônico. Contrato: docs/api-proof.md, seções 1 e 2.
// O cliente envia só a pergunta (ativo, tempo gráfico, regra de saída, setup). O servidor roda o motor
// (handleAnalyze) e monta o registro apenas com a saída do motor: número vindo do corpo nunca entra.
// Handler puro: recebe corpo, código de acesso e ambiente; devolve { status, headers, body }.
import { createHash, timingSafeEqual } from 'node:crypto';
import { canonicalize } from '../canonical.js';
import { DISCLAIMER_PADRAO } from '../compliance.js';
import { resolveDb } from '../db.js';
import { buildPrevisao, anchorPending, clockMs } from '../previsao.js';
import { findDuplicatePrevisao, getPrevisaoById, insertPrevisao } from '../repo/previsoes.js';
import { defaultSeriesLoader, handleAnalyze, parseAnalyzeInput } from './analyze.js';
import { describeAnchor } from './proof.js';

const NO_STORE = { 'cache-control': 'no-store' };
const failure = (status, code, message, headers = {}) => ({ status, headers: { ...NO_STORE, ...headers }, body: { error: { code, message } } });
const bad = (message) => failure(400, 'requisicao_invalida', message);

function sameCode(given, expected) {
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(given), h(expected));
}

/**
 * @param {object} req
 * @param {string} [req.method]
 * @param {unknown} [req.body] corpo JSON (objeto ou texto): { symbol, tf, cfg?, windowDays?, setupId, live? }
 * @param {string | string[]} [req.code] cabeçalho x-argos-code; só é exigido se env.ARGOS_ACCESS_CODE existir
 * @param {Record<string, string | undefined>} [req.env]
 * @param {object} [req.deps]
 * @param {import('../db.js').Db} [req.deps.db] padrão: resolveDb(env), que exige DATABASE_URL
 * @param {(() => number) | number} [req.deps.now] relógio em ms
 * @param {Function} [req.deps.loadSeries] fonte de candles (mesma assinatura de lib/data/series.js)
 */
export async function handlePrevisoes({ method = 'POST', body, code, env = process.env, deps = {} } = {}) {
  if (method !== 'POST') return failure(405, 'metodo_nao_permitido', 'use POST', { allow: 'POST' });
  // Falha fechado: em produção, sem código de acesso configurado, nada é gravado (o registro é permanente e append-only).
  if (!env.ARGOS_ACCESS_CODE && env.VERCEL_ENV === 'production') return failure(503, 'not_configured', 'O servidor não tem o código de acesso configurado.');
  if (env.ARGOS_ACCESS_CODE && !sameCode(Array.isArray(code) ? code[0] || '' : code || '', env.ARGOS_ACCESS_CODE)) {
    return failure(401, 'nao_autorizado', 'Código de acesso ausente ou incorreto.');
  }

  let input = body;
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = undefined; } }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('o corpo deve ser um objeto JSON');
  const parsed = parseAnalyzeInput(input);
  if (parsed.error) return bad(parsed.error);
  const { symbol, timeframe, cfg, windowDays, live } = parsed.value;
  const setupId = input.setupId;
  if (typeof setupId !== 'string' || !setupId) return bad('setupId é obrigatório');

  if (!deps.db && !env.DATABASE_URL) return failure(503, 'banco_ausente', 'DATABASE_URL não configurada.');

  try {
    const db = deps.db || (await resolveDb(env));
    // Só os campos validados seguem para a análise; o resto do corpo do cliente é descartado aqui.
    const analysis = await handleAnalyze({
      method: 'POST',
      body: { symbol, tf: timeframe, cfg, windowDays, live },
      deps: { loadSeries: deps.loadSeries || defaultSeriesLoader(env, db), now: () => clockMs(deps.now) }
    });
    if (analysis.status !== 200) return { status: analysis.status, headers: NO_STORE, body: analysis.body };
    const summary = analysis.body;
    if (!summary.setups.some((s) => s.id === setupId)) {
      return bad(`setupId inexistente: ${setupId}. Disponíveis: ${summary.setups.map((s) => s.id).join(', ')}`);
    }

    const built = buildPrevisao({ summary, setupId, origin: 'demo', originRef: null, emittedAt: clockMs(deps.now) });

    // Mesma pergunta sobre os mesmos dados não gera registro novo (seção 2). A checagem é repetida sob trava,
    // dentro da transação, para que duas chamadas simultâneas não registrem a mesma pergunta duas vezes.
    let row = await findDuplicatePrevisao(db, built.row);
    let inserted = false;
    if (!row) {
      const lockKey = ['previsao', built.row.origin, built.row.setup_id, built.row.symbol, built.row.timeframe, built.row.data_cut, canonicalize(built.row.params), summary.resultHash].join('|');
      const res = await db.transaction(async (tx) => {
        await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
        const dup = await findDuplicatePrevisao(tx, built.row);
        if (dup) return { row: dup, inserted: false };
        const ins = await insertPrevisao(tx, built.row);
        return { row: await getPrevisaoById(tx, ins.id), inserted: ins.inserted };
      });
      row = res.row;
      inserted = res.inserted;
    }

    // Recém-registrada: o dia dela ainda não pode estar fechado. Já existente: o dia pode ter sido ancorado.
    const pending = inserted ? anchorPending(row.emitted_at) : (await describeAnchor(db, row)).anchorPending;
    return {
      status: inserted ? 201 : 200,
      headers: NO_STORE,
      body: {
        id: row.id,
        hash: row.hash,
        inserted,
        emittedAt: new Date(row.emitted_at).toISOString(),
        canonical: canonicalize(row.payload),
        verifyUrl: `/verificar.html?id=${row.id}`,
        anchorPending: pending,
        disclaimer: DISCLAIMER_PADRAO
      }
    };
  } catch (e) {
    console.error('[previsoes]', (e && e.message) || e);
    return failure(500, 'erro_interno', 'Não foi possível concluir o registro agora. Tente de novo em instantes.');
  }
}
