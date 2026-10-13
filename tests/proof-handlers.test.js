// POST /api/previsoes e GET /api/proof (handlers puros) de ponta a ponta no PGlite, com o job de ancoragem e carimbo falso.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleAnalyze } from '../lib/handlers/analyze.js';
import { handlePrevisoes } from '../lib/handlers/previsoes.js';
import { handleProof } from '../lib/handlers/proof.js';
import { snapshotSeries } from '../lib/data/series.js';
import { DISCLAIMER_PADRAO } from '../lib/compliance.js';
import { canonicalize, sha256Hex } from '../lib/canonical.js';
import { createTestDb, resolveDb } from '../lib/db.js';
import { anchorDays } from '../lib/jobs/anchor-day.js';
import { merkleRoot, verifyProof } from '../lib/merkle.js';
import { buildPrevisao, dayManifest } from '../lib/previsao.js';
import { insertDesfecho } from '../lib/repo/desfechos.js';
import { getPrevisaoByHash, getPrevisaoById, insertPrevisao } from '../lib/repo/previsoes.js';
import { migrate } from '../tools/migrate.mjs';

const offline = async (s, tf) => ({ d: snapshotSeries(s, tf), source: 'snapshot' });
const at = (iso) => Date.parse(iso);
const T0 = at('2026-10-12T15:04:05.123Z');
const Q = { symbol: 'BTCUSDT', tf: '4h', setupId: 'BULL_ENGULFING' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;

let summary;
let shared;
let clock = T0;
before(async () => {
  summary = (await handleAnalyze({ query: { symbol: 'BTCUSDT', tf: '4h' }, deps: { loadSeries: offline } })).body;
  shared = await createTestDb(); // criar o PGlite custa ~1 s: uma instância para o arquivo, esquema recriado a cada teste
});
after(() => shared.close());

async function freshDb() {
  await shared.exec('drop schema public cascade; create schema public;');
  await migrate(shared, { log: () => {} });
  clock = T0;
  return shared;
}

const post = (db, body, over = {}) => handlePrevisoes({ body, env: {}, deps: { db, now: () => clock, loadSeries: offline }, ...over });
const get = (db, query, over = {}) => handleProof({ query, env: {}, deps: { db }, ...over });

function fakeStamp(calls = []) {
  const fn = async (digest) => {
    calls.push(digest);
    return { ots: Buffer.concat([Buffer.from('OTS-FALSO:'), Buffer.from(digest, 'hex')]), calendars: ['https://calendario.teste'], errors: [] };
  };
  fn.calls = calls;
  return fn;
}
const baseline = (setupId = 'BULL_ENGULFING', emittedAt = T0) => buildPrevisao({ summary, setupId, emittedAt });
const count = async (db, table = 'previsoes') => (await db.query(`select count(*)::int as n from ${table}`)).rows[0].n;

// ---------------------------------------------------------------------------------------------- POST /api/previsoes

test('POST: registra, devolve o texto canônico exato e o hash confere (201)', async () => {
  const db = await freshDb();
  const r = await post(db, Q);
  assert.equal(r.status, 201);
  assert.equal(r.headers['cache-control'], 'no-store');
  const b = r.body;
  assert.match(b.id, UUID);
  assert.match(b.hash, HEX);
  assert.equal(b.inserted, true);
  assert.equal(b.emittedAt, '2026-10-12T15:04:05.123Z');
  assert.equal(b.verifyUrl, `/verificar.html?id=${b.id}`);
  assert.deepEqual(b.anchorPending, { day: '2026-10-12', expectedAfter: '2026-10-13T00:10:00.000Z' });
  assert.equal(b.disclaimer, DISCLAIMER_PADRAO);
  assert.equal(sha256Hex(b.canonical), b.hash);

  // o texto é o que o servidor monta a partir da saída do motor, e nada mais
  const want = baseline();
  assert.equal(b.canonical, want.canonical);
  assert.equal(b.hash, want.hash);
  const rec = JSON.parse(b.canonical);
  assert.equal(rec.schema, 'argos.previsao/1');
  assert.equal(rec.origin, 'demo');
  assert.equal(rec.originRef, null);
  assert.equal(rec.setup.id, 'BULL_ENGULFING');
  assert.equal(rec.input.symbol, 'BTCUSDT');

  const row = await getPrevisaoById(db, b.id);
  assert.equal(row.hash, b.hash);
  assert.equal(row.origin, 'demo');
  assert.equal(row.origin_ref, null);
  assert.equal(row.emitted_at.toISOString(), b.emittedAt);
  assert.equal(row.setup_id, 'BULL_ENGULFING');
  assert.equal(row.engine_version, 'argos-engine 1.1.0');
  assert.equal(canonicalize(row.payload), b.canonical);
  assert.equal(await count(db), 1);
});

test('POST: o cliente não consegue injetar número (campos extras do corpo são ignorados)', async () => {
  const db = await freshDb();
  const body = {
    ...Q,
    prob: 0.99, winRate: 0.99, base: { rate: 0.99, n: 1 }, n: 1, verdict: 'EDGE', regime: { regime: 'TREND' },
    setup: { id: 'BULL_ENGULFING', winRate: 0.99, n: 1 }, resultHash: 'f'.repeat(64), hash: 'a'.repeat(64),
    data: { hash: 'e'.repeat(64), candles: 1 }, input: { symbol: 'ETHUSDT' }, engine: 'argos-engine 9.9.9',
    emittedAt: '2000-01-01T00:00:00.000Z', emitted_at: '2000-01-01T00:00:00.000Z', origin: 'cliente', originRef: 'x', origin_ref: 'x',
    payload: { prob: 0.99 }, params: { cfg: { tgt: 99 } }, id: '11111111-2222-4333-8444-555555555555', canonical: '{}',
    cfg: { mode: 'atr', tgt: 2, stp: 1, hold: 12, prob: 0.99, winRate: 0.99 }
  };
  const r = await post(db, body);
  assert.equal(r.status, 201);
  const want = baseline();
  assert.equal(r.body.canonical, want.canonical, 'o registro é o mesmo que o servidor monta sem os extras');
  assert.equal(r.body.hash, want.hash);
  assert.notEqual(r.body.id, body.id);
  assert.equal(r.body.emittedAt, '2026-10-12T15:04:05.123Z', 'a data é o relógio do servidor');
  const engineWin = summary.setups.find((s) => s.id === 'BULL_ENGULFING').winRate;
  const row = await getPrevisaoById(db, r.body.id);
  assert.equal(row.prob, engineWin);
  assert.equal(row.payload.setup.winRate, engineWin);
  assert.equal(row.origin, 'demo');
  assert.equal(row.origin_ref, null);
  assert.equal(row.payload.engine, 'argos-engine 1.1.0');
  assert.ok(!r.body.canonical.includes('0.99'));
});

test('POST: aceita o corpo como texto JSON e as mesmas formas de /api/analyze (cfg aninhado ou solto)', async () => {
  const db = await freshDb();
  const a = await post(db, JSON.stringify(Q));
  assert.equal(a.status, 201);
  const b = await post(db, { ...Q, cfg: { mode: 'atr', tgt: 2, stp: 1, hold: 12 } });
  assert.equal(b.status, 200, 'cfg explícito igual ao padrão é a mesma pergunta');
  assert.equal(b.body.id, a.body.id);
  const c = await post(db, { ...Q, mode: 'atr', tgt: '2', stp: '1', hold: '12', tf: '4H', symbol: 'btcusdt' });
  assert.equal(c.status, 200);
  assert.equal(c.body.id, a.body.id);
});

test('POST: pergunta repetida sobre os mesmos dados devolve o mesmo id (200, inserted false)', async () => {
  const db = await freshDb();
  const first = await post(db, Q);
  clock = T0 + 3_600_000; // uma hora depois, mesmos candles
  const again = await post(db, Q);
  assert.equal(again.status, 200);
  assert.equal(again.body.inserted, false);
  assert.equal(again.body.id, first.body.id);
  assert.equal(again.body.hash, first.body.hash);
  assert.equal(again.body.emittedAt, first.body.emittedAt, 'vale o registro original, não a hora da repetição');
  assert.equal(again.body.canonical, first.body.canonical);
  assert.deepEqual(again.body.anchorPending, first.body.anchorPending);
  assert.equal(again.body.disclaimer, DISCLAIMER_PADRAO);
  assert.equal(await count(db), 1);

  // outra pergunta ou outros dados: registro novo
  const ids = new Set([first.body.id]);
  const variants = [
    { ...Q, setupId: 'HAMMER' },
    { ...Q, cfg: { mode: 'atr', tgt: 2, stp: 1, hold: 13 } },
    { ...Q, cfg: { mode: 'pct', tgt: 3, stp: 1.5, hold: 12 } },
    { ...Q, windowDays: 730 },
    { ...Q, tf: '1d' },
    { ...Q, symbol: 'ETHUSDT' }
  ];
  for (const v of variants) {
    const r = await post(db, v);
    assert.equal(r.status, 201, JSON.stringify(v));
    ids.add(r.body.id);
  }
  // dados novos (um candle a menos no fim): outro data_cut e outro resultHash
  const trimmed = async (s, tf) => {
    const d = (await offline(s, tf)).d, n = d.n - 1;
    return { d: { ...d, n, t: d.t.slice(0, n), o: d.o.slice(0, n), h: d.h.slice(0, n), l: d.l.slice(0, n), c: d.c.slice(0, n), v: d.v.slice(0, n) }, source: 'database' };
  };
  const newer = await handlePrevisoes({ body: Q, env: {}, deps: { db, now: () => clock, loadSeries: trimmed } });
  assert.equal(newer.status, 201);
  assert.notEqual(newer.body.id, first.body.id);
  ids.add(newer.body.id);
  assert.equal(ids.size, variants.length + 2);
  assert.equal(await count(db), variants.length + 2);
});

test('POST: duas chamadas simultâneas da mesma pergunta registram uma só vez', async () => {
  const db = await freshDb();
  // relógio que anda a cada leitura: cada chamada teria um emittedAt (e um hash) próprio, então só a checagem sob trava as une
  const ticking = () => (clock += 1);
  const rs = await Promise.all([1, 2, 3].map(() => post(db, Q, { deps: { db, now: ticking, loadSeries: offline } })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 200, 201]);
  assert.equal(new Set(rs.map((r) => r.body.id)).size, 1);
  assert.equal(await count(db), 1);
});

test('POST: requisição inválida devolve 400 e não grava nada', async () => {
  const db = await freshDb();
  const invalid = [
    undefined, null, 'não é json', [], 7,
    {}, { ...Q, setupId: undefined }, { ...Q, setupId: '' }, { ...Q, setupId: 42 }, { ...Q, setupId: 'NAO_EXISTE' }, { ...Q, setupId: 'bull_engulfing' },
    { ...Q, symbol: 'DOGEUSDT' }, { ...Q, tf: '15m' }, { ...Q, cfg: { mode: 'x' } }, { ...Q, cfg: { hold: 0 } }, { ...Q, cfg: { tgt: -1 } },
    { ...Q, windowDays: 5 }
  ];
  for (const body of invalid) {
    const r = await post(db, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.code, 'requisicao_invalida');
    assert.equal(typeof r.body.error.message, 'string');
  }
  const unknown = await post(db, { ...Q, setupId: 'NAO_EXISTE' });
  assert.match(unknown.body.error.message, /setupId inexistente: NAO_EXISTE/);
  assert.match(unknown.body.error.message, /BULL_ENGULFING/, 'a mensagem lista os setups válidos');
  assert.equal(await count(db), 0);
});

test('POST: método diferente de POST devolve 405 com allow', async () => {
  const db = await freshDb();
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const r = await post(db, Q, { method });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'POST');
    assert.equal(r.body.error.code, 'metodo_nao_permitido');
  }
  assert.equal(await count(db), 0);
});

test('POST: sem banco configurado devolve 503 banco_ausente', async () => {
  const r = await handlePrevisoes({ body: Q, env: {}, deps: { now: () => clock, loadSeries: offline } });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'banco_ausente');
  const r2 = await handlePrevisoes({ body: Q, env: { DATABASE_URL: '' }, deps: { loadSeries: offline } });
  assert.equal(r2.status, 503);
  // a validação vem antes: corpo ruim continua sendo 400, mesmo sem banco
  assert.equal((await handlePrevisoes({ body: {}, env: {} })).status, 400);
});

test('POST: candles indisponíveis devolvem 503 dados_indisponiveis e nenhum registro', async () => {
  const db = await freshDb();
  const r = await post(db, Q, { deps: { db, now: () => clock, loadSeries: async () => { throw new Error('fora'); } } });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'dados_indisponiveis');
  assert.equal(await count(db), 0);
});

test('POST: código de acesso (x-argos-code) só é exigido quando ARGOS_ACCESS_CODE existe', async () => {
  const db = await freshDb();
  const env = { ARGOS_ACCESS_CODE: 'codigo-de-teste' };
  const wrong = [undefined, '', 'errado', 'codigo-de-teste ', 'codigo-de-test', ['errado'], 'x'.repeat(5000)];
  for (const code of wrong) {
    const r = await post(db, Q, { env, code });
    assert.equal(r.status, 401, String(code).slice(0, 20));
    assert.equal(r.body.error.code, 'nao_autorizado');
  }
  assert.equal(await count(db), 0);
  const ok = await post(db, Q, { env, code: 'codigo-de-teste' });
  assert.equal(ok.status, 201);
  const array = await post(db, Q, { env, code: ['codigo-de-teste'] });
  assert.equal(array.status, 200);
  // sem a variável de ambiente, o cabeçalho é dispensado
  assert.equal((await post(db, { ...Q, setupId: 'HAMMER' }, { env: {}, code: 'qualquer' })).status, 201);
  // o código é checado antes de validar o corpo e antes de rodar o motor: corpo ruim com código errado é 401, não 400
  assert.equal((await post(db, {}, { env, code: 'errado' })).status, 401);
  assert.equal((await post(db, {}, { env, code: 'codigo-de-teste' })).status, 400);
});

test('POST: erro inesperado no banco vira 500 sem vazar a mensagem interna', async (t) => {
  t.mock.method(console, 'error', () => {});
  const broken = { query: async () => { throw new Error('senha=segredo host=interno'); }, transaction: async () => { throw new Error('x'); } };
  const r = await post(broken, Q);
  assert.equal(r.status, 500);
  assert.equal(r.body.error.code, 'erro_interno');
  assert.ok(!JSON.stringify(r.body).includes('segredo'));
  const p = await get(broken, { id: '11111111-2222-4333-8444-555555555555' });
  assert.equal(p.status, 500);
  assert.ok(!JSON.stringify(p.body).includes('segredo'));
});

// ---------------------------------------------------------------------------------------------- GET /api/proof

test('GET /api/proof por id e por hash: antes e depois da ancoragem', async () => {
  const db = await freshDb();
  const stamp = fakeStamp();
  const created = (await post(db, Q)).body;

  for (const q of [{ id: created.id }, { hash: created.hash }, { hash: created.hash.toUpperCase() }]) {
    const r = await get(db, q);
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    const b = r.body;
    assert.deepEqual(b.previsao, {
      id: created.id, hash: created.hash, emittedAt: '2026-10-12T15:04:05.123Z', dataCut: summary.data.to, origin: 'demo',
      engine: 'argos-engine 1.1.0', setupId: 'BULL_ENGULFING', symbol: 'BTCUSDT', timeframe: '4h',
      verdict: summary.setups.find((s) => s.id === 'BULL_ENGULFING').verdict.key, supersedes: null
    });
    assert.equal(b.canonical, created.canonical, 'texto canônico refeito a partir do payload do banco');
    assert.equal(b.hashOk, true);
    assert.equal(sha256Hex(b.canonical), b.previsao.hash);
    assert.equal(b.anchor, null);
    assert.deepEqual(b.anchorPending, { day: '2026-10-12', expectedAfter: '2026-10-13T00:10:00.000Z' });
    assert.equal(b.desfecho, null);
    assert.equal(b.disclaimer, DISCLAIMER_PADRAO);
  }

  // durante o dia o job não fecha nada
  assert.deepEqual(await anchorDays(db, { now: at('2026-10-12T23:59:00.000Z'), stamp }), { days: [], orphans: [], errors: 0 });
  assert.equal((await get(db, { id: created.id })).body.anchor, null);

  const report = await anchorDays(db, { now: at('2026-10-13T00:10:00.000Z'), stamp });
  assert.equal(report.days.length, 1);

  const b = (await get(db, { id: created.id })).body;
  assert.equal(b.anchorPending, null);
  assert.equal(b.hashOk, true);
  const a = b.anchor;
  assert.equal(a.day, '2026-10-12');
  assert.equal(a.nLeaves, 1);
  assert.equal(a.leafIndex, 0);
  assert.deepEqual(a.proof, []);
  assert.equal(a.status, 'ancorada');
  assert.equal(a.root, merkleRoot([created.hash]));
  assert.equal(verifyProof(created.hash, a.proof, a.root), true);
  assert.equal(a.manifest, canonicalize({ schema: 'argos.raiz/1', day: '2026-10-12', nLeaves: 1, root: a.root }));
  assert.equal(a.manifestSha256, sha256Hex(a.manifest));
  assert.equal(a.manifestUrl, '/api/proof?day=2026-10-12&format=manifest');
  assert.equal(a.otsUrl, '/api/proof?day=2026-10-12&format=ots');
  assert.deepEqual(stamp.calls, [a.manifestSha256]);

  // a mesma pergunta repetida depois do fechamento do dia: o registro original, já ancorado, sem pendência
  clock = at('2026-10-14T09:00:00.000Z');
  const dup = await post(db, Q);
  assert.equal(dup.status, 200);
  assert.equal(dup.body.id, created.id);
  assert.equal(dup.body.anchorPending, null);
});

test('GET /api/proof: desfecho aparece quando existe', async () => {
  const db = await freshDb();
  const created = (await post(db, Q)).body;
  await insertDesfecho(db, { previsao_id: created.id, outcome: 'WIN', ret: 0.0123456789, bars: 4, bar_time: '2026-10-12T20:00:00Z', resolved_at: '2026-10-12T20:05:00Z' });
  const b = (await get(db, { id: created.id })).body;
  assert.deepEqual(b.desfecho, { outcome: 'WIN', ret: 0.0123456789, bars: 4, barTime: '2026-10-12T20:00:00.000Z', resolvedAt: '2026-10-12T20:05:00.000Z' });
});

test('GET /api/proof: dias com 1, 2, 3 e 5 previsões; toda folha verifica contra a raiz', async () => {
  const db = await freshDb();
  const stamp = fakeStamp();
  const setups = summary.setups.map((s) => s.id);
  const plan = { '2026-10-01': 1, '2026-10-02': 2, '2026-10-03': 3, '2026-10-04': 5 };
  const days = {};
  for (const [day, n] of Object.entries(plan)) {
    const items = Array.from({ length: n }, (_, i) => {
      // no dia de 3 previsões, duas têm o mesmo instante: o desempate é o hash
      const sec = day === '2026-10-03' && i === 2 ? 1 : i;
      return buildPrevisao({ summary, setupId: setups[(i + n) % setups.length], emittedAt: `${day}T12:00:0${sec}.000Z` });
    });
    days[day] = items;
    for (const p of [...items].reverse()) await insertPrevisao(db, p.row); // inserção fora de ordem
  }
  const expected = (items) => [...items].sort((a, b) => (a.record.emittedAt < b.record.emittedAt ? -1 : a.record.emittedAt > b.record.emittedAt ? 1 : a.hash < b.hash ? -1 : 1));

  assert.equal((await get(db, { day: '2026-10-01' })).status, 404, 'antes de o job rodar o dia não tem raiz');

  const report = await anchorDays(db, { now: at('2026-10-05T00:10:00.000Z'), stamp });
  assert.equal(report.errors, 0);
  assert.deepEqual(report.days.map((d) => [d.day, d.nLeaves, d.status]), [['2026-10-01', 1, 'ancorada'], ['2026-10-02', 2, 'ancorada'], ['2026-10-03', 3, 'ancorada'], ['2026-10-04', 5, 'ancorada']]);

  for (const [day, items] of Object.entries(days)) {
    const order = expected(items).map((p) => p.hash);
    const d = (await get(db, { day })).body;
    assert.equal(d.day, day);
    assert.equal(d.nLeaves, items.length);
    assert.deepEqual(d.leaves, order, 'folhas na ordem da árvore');
    assert.equal(merkleRoot(d.leaves), d.root, 'qualquer pessoa refaz a raiz a partir das folhas');
    assert.equal(d.status, 'ancorada');
    assert.equal(d.manifest, canonicalize({ schema: 'argos.raiz/1', day, nLeaves: items.length, root: d.root }));
    assert.equal(d.manifestSha256, sha256Hex(d.manifest));
    assert.equal(d.manifestSha256, dayManifest({ day, nLeaves: items.length, root: d.root }).manifestSha256);
    assert.equal(d.manifestUrl, `/api/proof?day=${day}&format=manifest`);
    assert.equal(d.otsUrl, `/api/proof?day=${day}&format=ots`);
    assert.equal(d.disclaimer, DISCLAIMER_PADRAO);
    assert.ok(stamp.calls.includes(d.manifestSha256), 'o digest do manifesto foi carimbado');

    for (const p of items) {
      const r = (await get(db, { hash: p.hash })).body;
      assert.equal(r.hashOk, true);
      assert.equal(r.anchorPending, null);
      assert.equal(r.anchor.day, day);
      assert.equal(r.anchor.root, d.root);
      assert.equal(r.anchor.nLeaves, items.length);
      assert.equal(r.anchor.leafIndex, order.indexOf(p.hash));
      assert.equal(r.anchor.manifestSha256, d.manifestSha256);
      assert.equal(verifyProof(p.hash, r.anchor.proof, r.anchor.root), true, `${day} folha ${r.anchor.leafIndex}`);
      for (const other of order.filter((h) => h !== p.hash)) assert.equal(verifyProof(other, r.anchor.proof, r.anchor.root), false, 'o caminho não serve a outra folha');
      assert.equal(verifyProof(p.hash, r.anchor.proof, 'f'.repeat(64)), false, 'nem a outra raiz');
    }
  }
});

test('GET /api/proof?day=: format=manifest e format=ots (cabeçalhos e bytes)', async () => {
  const db = await freshDb();
  const created = (await post(db, Q)).body;
  const day = '2026-10-12';

  // dia ainda em aberto: nada a baixar
  assert.equal((await get(db, { day })).status, 404);
  assert.equal((await get(db, { day, format: 'manifest' })).status, 404);

  // dia fechado, carimbo falhou: manifesto existe, recibo ainda não
  await anchorDays(db, { now: at('2026-10-13T00:10:00.000Z'), stamp: async () => { throw new Error('nenhum calendário respondeu'); } });
  const pending = (await get(db, { day })).body;
  assert.equal(pending.status, 'falhou');
  assert.equal(pending.otsUrl, null);
  assert.equal(pending.nLeaves, 1);
  assert.deepEqual(pending.leaves, [created.hash]);
  assert.equal((await get(db, { id: created.id })).body.anchor.otsUrl, null);
  const m0 = await get(db, { day, format: 'manifest' });
  assert.equal(m0.status, 200);
  const o0 = await get(db, { day, format: 'ots' });
  assert.equal(o0.status, 404);
  assert.equal(o0.body.error.code, 'nao_encontrado');

  const stamp = fakeStamp();
  await anchorDays(db, { now: at('2026-10-14T00:10:00.000Z'), stamp });

  const m = await get(db, { day, format: 'manifest' });
  assert.equal(m.status, 200);
  assert.equal(m.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(m.headers['content-disposition'], 'attachment; filename="argos-raiz-2026-10-12.json"');
  assert.equal(typeof m.body, 'string');
  assert.equal(m.body, m0.body, 'o manifesto não muda');
  assert.equal(m.body, canonicalize({ schema: 'argos.raiz/1', day, nLeaves: 1, root: merkleRoot([created.hash]) }));
  assert.ok(!m.body.endsWith('\n'));
  assert.equal(sha256Hex(Buffer.from(m.body, 'utf8')), (await get(db, { day })).body.manifestSha256);

  const o = await get(db, { day, format: 'ots' });
  assert.equal(o.status, 200);
  assert.equal(o.headers['content-type'], 'application/octet-stream');
  assert.equal(o.headers['content-disposition'], 'attachment; filename="argos-raiz-2026-10-12.json.ots"');
  assert.ok(Buffer.isBuffer(o.body));
  assert.deepEqual(o.body, Buffer.concat([Buffer.from('OTS-FALSO:'), Buffer.from(sha256Hex(m.body), 'hex')]), 'bytes do recibo, sem alteração');

  const j = (await get(db, { day })).body;
  assert.equal(j.status, 'ancorada');
  assert.equal(j.otsUrl, '/api/proof?day=2026-10-12&format=ots');
});

test('GET /api/proof: previsão órfã (dia fechado, fora da árvore) não finge estar pendente', async () => {
  const db = await freshDb();
  await insertPrevisao(db, buildPrevisao({ summary, setupId: 'HAMMER', emittedAt: '2026-10-10T10:00:00.000Z' }).row);
  await anchorDays(db, { now: at('2026-10-11T00:10:00.000Z'), stamp: fakeStamp() });
  const late = buildPrevisao({ summary, setupId: 'HAMMER', emittedAt: '2026-10-10T23:00:00.000Z' });
  const { id } = await insertPrevisao(db, late.row);
  const b = (await get(db, { id })).body;
  assert.equal(b.hashOk, true);
  assert.equal(b.anchor, null);
  assert.equal(b.anchorPending, null);
});

test('GET /api/proof: hashOk é falso se o conteúdo gravado não bate com o hash', async () => {
  const db = await freshDb();
  const created = (await post(db, Q)).body;
  // simula adulteração por quem tem acesso de dono: desliga o gatilho append-only só neste teste
  await db.exec('alter table previsoes disable trigger previsoes_append_only');
  await db.query(`update previsoes set payload = jsonb_set(payload, '{setup,winRate}', '0.99') where id = $1`, [created.id]);
  await db.exec('alter table previsoes enable trigger previsoes_append_only');
  const b = (await get(db, { id: created.id })).body;
  assert.equal(b.hashOk, false);
  assert.notEqual(sha256Hex(b.canonical), b.previsao.hash);
});

test('GET /api/proof: parâmetros malformados, ausentes e inexistentes', async () => {
  const db = await freshDb();
  const created = (await post(db, Q)).body;
  const day = '2026-10-12';
  const bad = [
    {}, { id: '' }, { id: 'não-é-uuid' }, { hash: 'abc' }, { hash: 'z'.repeat(64) }, { hash: 'a'.repeat(63) }, { day: '12/10/2026' }, { day: '2026-02-30' }, { day: '2026-10-12T00:00' },
    { id: created.id, hash: created.hash }, { id: created.id, day }, { hash: created.hash, day },
    { id: created.id, format: 'ots' }, { hash: created.hash, format: 'manifest' }, { day, format: 'pdf' }, { day, format: 'json' }, { format: 'ots' }
  ];
  for (const q of bad) {
    const r = await get(db, q);
    assert.equal(r.status, 400, JSON.stringify(q));
    assert.equal(r.body.error.code, 'requisicao_invalida');
  }
  for (const q of [{ id: '00000000-0000-4000-8000-000000000000' }, { hash: 'f'.repeat(64) }, { day: '2001-01-01' }, { day: '2001-01-01', format: 'ots' }, { day: '2001-01-01', format: 'manifest' }]) {
    const r = await get(db, q);
    assert.equal(r.status, 404, JSON.stringify(q));
    assert.equal(r.body.error.code, 'nao_encontrado');
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const r = await get(db, { id: created.id }, { method });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET');
  }
  // valores repetidos na consulta (?id=a&id=b) valem o primeiro, como nos outros endpoints
  assert.equal((await get(db, { id: [created.id, 'outro'] })).status, 200);
  const none = await handleProof({ query: { id: created.id }, env: {} });
  assert.equal(none.status, 503);
  assert.equal(none.body.error.code, 'banco_ausente');
});

// ---------------------------------------------------------------------------------------------- resolveDb

test('resolveDb: pglite://memory abre PGlite migrado, memoizado por URL, e serve os handlers sem deps.db', async () => {
  const env = { DATABASE_URL: 'pglite://memory' };
  const db = await resolveDb(env);
  assert.equal(await resolveDb(env), db, 'mesma instância para a mesma URL');
  const other = await resolveDb({ DATABASE_URL: 'pglite:memory' });
  assert.notEqual(other, db, 'URL diferente, instância diferente (e banco vazio e separado)');
  await other.close();
  assert.equal(typeof db.transaction, 'function');
  assert.equal((await db.query("show timezone")).rows[0].TimeZone, 'UTC');
  assert.equal((await db.query("select count(*)::int as n from schema_migrations")).rows[0].n, 1);
  assert.equal(await count(db), 0);

  clock = T0;
  const r = await handlePrevisoes({ body: Q, env, deps: { now: () => clock, loadSeries: offline } });
  assert.equal(r.status, 201);
  const p = await handleProof({ query: { id: r.body.id }, env });
  assert.equal(p.status, 200);
  assert.equal(p.body.canonical, r.body.canonical);
  assert.equal(await count(db), 1);
  await db.close();
  await assert.rejects(() => resolveDb({}), /DATABASE_URL ausente/);
});

test('resolveDb: pglite://<pasta> persiste em disco entre aberturas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argos-pglite-'));
  const env = { DATABASE_URL: 'pglite://' + dir.replace(/\\/g, '/') };
  try {
    const a = await resolveDb(env);
    const r = await handlePrevisoes({ body: Q, env, deps: { now: () => T0, loadSeries: offline } });
    assert.equal(r.status, 201);
    await a.close();
    const b = await resolveDb(env); // fechado saiu da memoização: abre de novo, agora lendo o disco
    assert.notEqual(b, a);
    const row = await getPrevisaoByHash(b, r.body.hash);
    assert.equal(row.id, r.body.id);
    assert.equal((await b.query('select count(*)::int as n from schema_migrations')).rows[0].n, 1, 'migrações não são reaplicadas');
    await b.close();
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* o sistema pode segurar o arquivo por um instante */ }
  }
});

test('resolveDb: URL que não é pglite usa createDb (Neon) e não conecta até a primeira consulta', async () => {
  const env = { DATABASE_URL: 'postgres://usuario:senha@host.invalido/db' };
  const db = await resolveDb(env);
  assert.equal(typeof db.query, 'function');
  assert.equal(typeof db.transaction, 'function');
  assert.equal(await resolveDb(env), db);
});
