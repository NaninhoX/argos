// Job diário de ancoragem (docs/api-proof.md, seção 5). Idempotente: pode rodar quantas vezes for.
//  1. cada dia UTC já encerrado, com previsões e sem raiz: monta a árvore de Merkle, grava `provas_merkle`
//     (status `pendente`) e o caminho de cada folha em `previsao_prova`, numa transação;
//  2. cada dia `pendente` ou `falhou`: carimba o SHA-256 do manifesto no OpenTimestamps e passa a `ancorada`
//     (nenhum calendário respondeu: `falhou`, retentado na execução seguinte);
//  3. cada dia `ancorada` de execuções anteriores: pergunta aos calendários se o carimbo já chegou a um bloco do
//     Bitcoin; se chegou, grava o recibo completo e passa a `confirmada`. Sem confirmação em 24 horas: alerta (ADR 0005);
//  4. previsão de dia já fechado e fora da árvore é órfã: entra em `orphans`, nunca é ignorada.
// O dia corrente nunca é fechado. Este job só escreve em `provas_merkle` e `previsao_prova`; `previsoes` não é tocada.
import { merkleProof, merkleRoot } from '../merkle.js';
import { clockMs, dayManifest, utcDay } from '../previsao.js';
import { listClosedDaysWithoutProof, listOrphans, listPrevisoesByDay } from '../repo/previsoes.js';
import { getDayLeaves, insertProva, listDaysToStamp, listDaysToUpgrade, markAnchored, markConfirmed, markFailed } from '../repo/provas.js';

const message = (e) => String((e && e.message) || e);
const CONFIRM_ALERT_MS = 24 * 3_600_000;

/** Carimbo padrão: `stampDigest` de lib/ots.js, carregado só quando há dia a carimbar. */
async function defaultStamp(digestHex) {
  const { stampDigest } = await import('../ots.js');
  return stampDigest(digestHex);
}

/**
 * @param {import('../db.js').Db} db
 * @param {{ now?: (() => number) | number, stamp?: (digestHex: string) => Promise<{ ots: Buffer, calendars?: string[] }>,
 *   upgrade?: (ots: Buffer) => Promise<{ ots: Buffer, confirmed: boolean }> }} [opts] sem `upgrade`, o passo 3 não roda
 *   (a função agendada em api/cron/anchor.js passa `upgradeOts` de lib/ots.js)
 * @returns {Promise<{ days: { day: string, nLeaves: number|null, root: string, status: string, calendars: string[], error?: string }[],
 *   orphans: { id: string, hash: string, day: string, emittedAt: string }[], errors: number }>}
 */
export async function anchorDays(db, opts = {}) {
  const nowMs = clockMs(opts.now);
  const today = utcDay(nowMs);
  const stamp = opts.stamp || defaultStamp;
  const upgrade = opts.upgrade || null;
  const days = new Map();
  const entry = (day, init) => {
    if (!days.has(day)) days.set(day, { day, nLeaves: null, root: null, status: 'pendente', calendars: [] });
    return Object.assign(days.get(day), init);
  };

  // 1. fecha os dias encerrados
  for (const { day } of await listClosedDaysWithoutProof(db, today)) {
    try {
      const closed = await db.transaction(async (tx) => {
        const rows = await listPrevisoesByDay(tx, day);
        if (!rows.length) return null;
        const hashes = rows.map((r) => r.hash);
        const root = merkleRoot(hashes);
        const leaves = rows.map((r, i) => ({ previsao_id: r.id, leaf_index: i, proof: merkleProof(hashes, i) }));
        const { inserted } = await insertProva(tx, { day, root, n_leaves: hashes.length, leaves });
        return inserted ? { root, nLeaves: hashes.length } : null; // não inseriu: outra execução fechou o dia antes
      });
      if (closed) entry(day, { root: closed.root, nLeaves: closed.nLeaves, status: 'pendente' });
    } catch (e) {
      entry(day, { status: 'falhou', error: message(e) }); // sem raiz gravada: a próxima execução tenta de novo
    }
  }

  // 3 (lido antes do passo 2, para não consultar o dia que acabou de ser carimbado: o Bitcoin leva horas)
  const toUpgrade = upgrade ? await listDaysToUpgrade(db) : [];

  // 2. carimba os dias pendentes ou que falharam antes
  for (const prova of await listDaysToStamp(db)) {
    const e = entry(prova.day, { root: prova.root, nLeaves: prova.n_leaves, status: prova.status });
    try {
      // a linha de provas_merkle é atualizável: confere a raiz contra as folhas antes de carimbar
      const leaves = await getDayLeaves(db, prova.day);
      if (!leaves.length || merkleRoot(leaves) !== prova.root || (prova.n_leaves !== null && leaves.length !== prova.n_leaves)) {
        throw new Error('a raiz gravada não confere com as folhas do dia');
      }
      const { manifestSha256 } = dayManifest({ day: prova.day, nLeaves: leaves.length, root: prova.root });
      const res = await stamp(manifestSha256);
      if (!res || !res.ots || !res.ots.length) throw new Error('carimbo sem recibo');
      await markAnchored(db, prova.day, res.ots);
      e.status = 'ancorada';
      e.calendars = Array.isArray(res.calendars) ? res.calendars : [];
    } catch (err) {
      e.error = message(err);
      e.status = 'falhou';
      try { await markFailed(db, prova.day); } catch { /* o erro original é o que importa */ }
    }
  }

  // 3. completa os recibos ancorados em execuções anteriores
  //    (dia ainda pendente dentro das 24 horas não entra no relatório: não há o que relatar)
  for (const prova of toUpgrade) {
    const base = { root: prova.root, nLeaves: prova.n_leaves, status: 'ancorada' };
    try {
      const up = await upgrade(prova.ots);
      if (up && up.confirmed) {
        await markConfirmed(db, prova.day, up.ots);
        entry(prova.day, { ...base, status: 'confirmada' });
      } else if (nowMs - new Date(prova.updated_at).getTime() > CONFIRM_ALERT_MS) {
        entry(prova.day, { ...base, error: 'carimbo sem confirmação no Bitcoin há mais de 24 horas' });
      }
    } catch (err) {
      entry(prova.day, { ...base, error: message(err) }); // o recibo gravado continua valendo; a próxima execução tenta de novo
    }
  }

  // 4. previsões de dia fechado que ficaram fora da árvore
  const orphans = (await listOrphans(db)).map((o) => ({ id: o.id, hash: o.hash, day: o.day, emittedAt: new Date(o.emitted_at).toISOString() }));

  const list = [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  return { days: list, orphans, errors: list.filter((d) => d.error).length + orphans.length };
}
