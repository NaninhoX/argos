// GET /api/proof — prova de uma previsão (?id= ou ?hash=) ou do dia (?day=, com ?format=manifest|ots).
// Contrato: docs/api-proof.md, seção 3. Handler puro: recebe a consulta já extraída e devolve { status, headers, body }.
// `body` é objeto (JSON), string (manifesto) ou Buffer (recibo .ots). Só lê o banco.
import { canonicalize, sha256Hex } from '../canonical.js';
import { DISCLAIMER_PADRAO } from '../compliance.js';
import { resolveDb } from '../db.js';
import { anchorPending, dayManifest, isValidDay } from '../previsao.js';
import { getDesfechoByPrevisao, getPrevisaoByHash, getPrevisaoById } from '../repo/previsoes.js';
import { getDayLeaves, getProva, getProvaForPrevisao } from '../repo/provas.js';
import { UUID_RE } from '../repo/util.js';

const first = (v) => (Array.isArray(v) ? v[0] : v);
const iso = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());
const NO_STORE = { 'cache-control': 'no-store' };

const failure = (status, code, message, headers = {}) => ({ status, headers: { ...NO_STORE, ...headers }, body: { error: { code, message } } });
const bad = (message) => failure(400, 'requisicao_invalida', message);
const missing = (message) => failure(404, 'nao_encontrado', message);

export const manifestUrl = (day) => `/api/proof?day=${day}&format=manifest`;
export const otsUrl = (day) => `/api/proof?day=${day}&format=ots`;

/** Raiz do dia como o contrato a descreve (seção 3.1, campo `anchor`), a partir da linha de getProvaForPrevisao. */
function anchorOf(p) {
  const nLeaves = p.n_leaves;
  const { manifest, manifestSha256 } = dayManifest({ day: p.day, nLeaves, root: p.root });
  return {
    day: p.day,
    root: p.root,
    nLeaves,
    leafIndex: p.leaf_index,
    proof: p.proof,
    status: p.status,
    manifest,
    manifestSha256,
    manifestUrl: manifestUrl(p.day),
    otsUrl: p.has_ots ? otsUrl(p.day) : null
  };
}

/**
 * Estado da âncora de uma previsão, nos campos `anchor` e `anchorPending` da resposta.
 *  - dia fechado e previsão na árvore: `anchor` preenchido, `anchorPending` null;
 *  - dia ainda sem raiz: `anchor` null, `anchorPending` com o dia e quando o job pode fechá-lo;
 *  - dia com raiz mas previsão fora da árvore (órfã): os dois null; o job a relata em `orphans`.
 * @param {import('../db.js').Queryable} db
 * @param {{ id: string, emitted_at: Date|string }} previsao
 */
export async function describeAnchor(db, previsao) {
  const p = await getProvaForPrevisao(db, previsao.id);
  if (p) return { anchor: anchorOf(p), anchorPending: null };
  const pending = anchorPending(previsao.emitted_at);
  const dayRow = await getProva(db, pending.day);
  return { anchor: null, anchorPending: dayRow ? null : pending };
}

async function byPrevisao(db, row) {
  // Refaz o texto canônico a partir do payload (jsonb perde a ordem das chaves) e confere o hash gravado.
  const canonical = canonicalize(row.payload);
  const desfecho = await getDesfechoByPrevisao(db, row.id);
  return {
    status: 200,
    headers: NO_STORE,
    body: {
      previsao: {
        id: row.id,
        hash: row.hash,
        emittedAt: iso(row.emitted_at),
        dataCut: iso(row.data_cut),
        origin: row.origin,
        engine: row.engine_version,
        setupId: row.setup_id,
        symbol: row.symbol,
        timeframe: row.timeframe,
        verdict: row.verdict,
        supersedes: row.supersedes ?? null
      },
      canonical,
      hashOk: sha256Hex(canonical) === row.hash,
      ...(await describeAnchor(db, row)),
      desfecho: desfecho
        ? { outcome: desfecho.outcome, ret: desfecho.ret, bars: desfecho.bars, barTime: iso(desfecho.bar_time), resolvedAt: iso(desfecho.resolved_at) }
        : null,
      disclaimer: DISCLAIMER_PADRAO
    }
  };
}

async function byDay(db, day, format) {
  const withOts = format === 'ots';
  const prova = await getProva(db, day, { withOts });
  if (!prova) return missing(`Não há raiz para ${day}: o dia ainda está em aberto, não teve previsões ou o job ainda não o fechou.`);
  const leaves = await getDayLeaves(db, day);
  const nLeaves = prova.n_leaves ?? leaves.length;
  const { manifest, manifestSha256 } = dayManifest({ day, nLeaves, root: prova.root });

  if (format === 'manifest') {
    return {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="argos-raiz-${day}.json"`, 'cache-control': 'public, max-age=300' },
      body: manifest
    };
  }
  if (format === 'ots') {
    if (!prova.ots) return missing(`O recibo OpenTimestamps de ${day} ainda não existe.`);
    return {
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="argos-raiz-${day}.json.ots"`, ...NO_STORE },
      body: prova.ots
    };
  }
  return {
    status: 200,
    headers: NO_STORE,
    body: {
      day,
      root: prova.root,
      nLeaves,
      status: prova.status,
      leaves,
      manifest,
      manifestSha256,
      manifestUrl: manifestUrl(day),
      otsUrl: prova.has_ots ? otsUrl(day) : null,
      disclaimer: DISCLAIMER_PADRAO
    }
  };
}

/**
 * @param {{ method?: string, query?: object, env?: object, deps?: { db?: import('../db.js').Queryable } }} req
 */
export async function handleProof({ method = 'GET', query = {}, env = process.env, deps = {} } = {}) {
  if (method !== 'GET') return failure(405, 'metodo_nao_permitido', 'use GET', { allow: 'GET' });

  const id = first(query.id), hash = first(query.hash), day = first(query.day), format = first(query.format);
  const given = [id, hash, day].filter((v) => v !== undefined && v !== '');
  if (given.length !== 1) return bad('informe exatamente um entre id, hash e day');
  if (format !== undefined && format !== '' && (day === undefined || day === '' || !['manifest', 'ots'].includes(format))) {
    return bad("format só vale com day e deve ser 'manifest' ou 'ots'");
  }
  if (id !== undefined && id !== '' && !UUID_RE.test(String(id))) return bad('id deve ser um UUID');
  if (hash !== undefined && hash !== '' && !/^[0-9a-f]{64}$/i.test(String(hash))) return bad('hash deve ter 64 caracteres hexadecimais');
  if (day !== undefined && day !== '' && !isValidDay(String(day))) return bad('day deve estar no formato AAAA-MM-DD');

  if (!deps.db && !env.DATABASE_URL) return failure(503, 'banco_ausente', 'DATABASE_URL não configurada.');
  try {
    const db = deps.db || (await resolveDb(env));
    if (day) return await byDay(db, String(day), format || undefined);
    const row = id ? await getPrevisaoById(db, String(id)) : await getPrevisaoByHash(db, String(hash).toLowerCase());
    if (!row) return missing('Previsão não encontrada.');
    return await byPrevisao(db, row);
  } catch {
    return failure(500, 'erro_interno', 'Não foi possível consultar a prova agora.');
  }
}
