// Registro canônico de previsão (lib/previsao.js): hash estável, linha de `previsoes`, ida e volta pelo jsonb e manifesto do dia.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { handleAnalyze } from '../lib/handlers/analyze.js';
import { snapshotSeries } from '../lib/data/series.js';
import { canonicalize, sha256Hex } from '../lib/canonical.js';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';
import { anchorPending, buildPrevisao, clockMs, dayBounds, dayManifest, isValidDay, utcDay } from '../lib/previsao.js';
import { findDuplicatePrevisao, getPrevisaoById, insertPrevisao, listPrevisoesByDay } from '../lib/repo/previsoes.js';

// Sem rede nos testes: a série vem só do snapshot.
const offline = { loadSeries: async (s, tf) => ({ d: snapshotSeries(s, tf), source: 'snapshot' }) };
const EMITTED = '2026-10-12T15:04:05.123Z';

let summary;
let db;
before(async () => {
  summary = (await handleAnalyze({ query: { symbol: 'BTCUSDT', tf: '4h' }, deps: offline })).body;
  db = await createTestDb();
  await migrate(db, { log: () => {} });
});
after(() => db.close());

// mesma estrutura, chaves em ordem inversa em todos os níveis (o jsonb do Postgres também reordena)
const reorder = (v) => (Array.isArray(v) ? v.map(reorder)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reorder(v[k])])) : v);

test('buildPrevisao: registro argos.previsao/1 só com saída do motor', () => {
  const p = buildPrevisao({ summary, setupId: 'BULL_ENGULFING', emittedAt: new Date(EMITTED) });
  const r = p.record;
  assert.equal(r.schema, 'argos.previsao/1');
  assert.equal(r.engine, 'argos-engine 1.1.0');
  assert.equal(r.origin, 'demo');
  assert.equal(r.originRef, null);
  assert.equal(r.emittedAt, EMITTED);
  assert.deepEqual(r.input, summary.input);
  assert.equal(r.resultHash, summary.resultHash);
  assert.deepEqual(r.regime, summary.regime.current);
  assert.deepEqual(r.base, summary.base);
  assert.deepEqual(r.setup, summary.setups.find((s) => s.id === 'BULL_ENGULFING'));
  assert.deepEqual(Object.keys(r).sort(), ['base', 'data', 'emittedAt', 'engine', 'input', 'origin', 'originRef', 'regime', 'resultHash', 'schema', 'setup']);

  // data = summary.data sem a origem dos candles
  assert.deepEqual(Object.keys(r.data).sort(), ['candles', 'from', 'hash', 'to', 'warmupCandles']);
  assert.equal(r.data.hash, summary.data.hash);

  assert.equal(p.canonical, canonicalize(r));
  assert.equal(p.hash, sha256Hex(p.canonical));
  assert.match(p.hash, /^[0-9a-f]{64}$/);
  assert.ok(!p.canonical.endsWith('\n'));
  assert.deepEqual(JSON.parse(p.canonical), r);
  assert.ok(!/"disclaimer"|"ms"|"cacheHit"/.test(p.canonical), 'nada do envelope da resposta entra no registro');
});

test('buildPrevisao: a origem dos candles não muda o hash; emittedAt aceita Date, ISO e ms', () => {
  const a = buildPrevisao({ summary, setupId: 'MACD_CROSS', emittedAt: EMITTED });
  const withNoise = { ...summary, data: { ...summary.data, source: 'live', liveError: 'rede fora', dbError: 'sem banco' } };
  const b = buildPrevisao({ summary: withNoise, setupId: 'MACD_CROSS', emittedAt: Date.parse(EMITTED) });
  const c = buildPrevisao({ summary: { ...summary, data: { ...summary.data, source: 'database' } }, setupId: 'MACD_CROSS', emittedAt: new Date(EMITTED) });
  assert.equal(a.hash, b.hash);
  assert.equal(a.hash, c.hash);
  assert.equal(a.canonical, b.canonical);
});

test('buildPrevisao: hash estável e independente da ordem das chaves', () => {
  for (const setupId of summary.setups.map((s) => s.id)) {
    const a = buildPrevisao({ summary, setupId, emittedAt: EMITTED });
    const b = buildPrevisao({ summary: reorder(summary), setupId, emittedAt: EMITTED });
    const again = buildPrevisao({ summary, setupId, emittedAt: EMITTED });
    assert.equal(a.canonical, b.canonical, setupId);
    assert.equal(a.hash, b.hash, setupId);
    assert.equal(a.hash, again.hash, setupId);
  }
  // o contrário também vale: qualquer mudança de conteúdo muda o hash
  const base = buildPrevisao({ summary, setupId: 'HAMMER', emittedAt: EMITTED });
  assert.notEqual(base.hash, buildPrevisao({ summary, setupId: 'HAMMER', emittedAt: '2026-10-12T15:04:05.124Z' }).hash);
  assert.notEqual(base.hash, buildPrevisao({ summary, setupId: 'BB_LOWER', emittedAt: EMITTED }).hash);
  assert.notEqual(base.hash, buildPrevisao({ summary, setupId: 'HAMMER', emittedAt: EMITTED, origin: 'cliente', originRef: 'rel-1' }).hash);
  const nudged = structuredClone(summary);
  nudged.setups.find((s) => s.id === 'HAMMER').winRate += 1e-12;
  assert.notEqual(base.hash, buildPrevisao({ summary: nudged, setupId: 'HAMMER', emittedAt: EMITTED }).hash);
});

test('buildPrevisao: linha de previsoes (prob, bar_time só com gatilho ativo, colunas do contrato)', () => {
  const active = summary.setups.find((s) => s.id === 'BULL_ENGULFING');
  assert.equal(active.activeNow, true);
  const a = buildPrevisao({ summary, setupId: 'BULL_ENGULFING', emittedAt: EMITTED }).row;
  assert.equal(a.setup_id, 'BULL_ENGULFING');
  assert.equal(a.symbol, 'BTCUSDT');
  assert.equal(a.timeframe, '4h');
  assert.deepEqual(a.params, { cfg: { hold: 12, mode: 'atr', stp: 1, tgt: 2 }, windowDays: null });
  assert.equal(a.prob, active.winRate);
  assert.equal(a.base_rate, active.base);
  assert.equal(a.n, active.n);
  assert.equal(a.n_eff, active.nEff);
  assert.equal(a.verdict, active.verdict.key);
  assert.equal(a.bar_time, active.lastTriggerTime);
  assert.equal(a.data_cut, summary.data.to);
  assert.equal(a.emitted_at, EMITTED);
  assert.equal(a.origin, 'demo');
  assert.equal(a.origin_ref, null);
  assert.equal(a.engine_version, 'argos-engine 1.1.0');
  assert.equal(a.payload.schema, 'argos.previsao/1');
  assert.match(a.hash, /^[0-9a-f]{64}$/);

  const idle = summary.setups.find((s) => !s.activeNow);
  const b = buildPrevisao({ summary, setupId: idle.id, emittedAt: EMITTED }).row;
  assert.equal(b.bar_time, null, 'sem gatilho ativo, não há desfecho a esperar');
  assert.equal(b.prob, idle.winRate);

  // prob só vale com n > 0 e dentro de [0, 1]
  const mutate = (patch) => {
    const s = structuredClone(summary);
    Object.assign(s.setups.find((x) => x.id === 'HAMMER'), patch);
    return buildPrevisao({ summary: s, setupId: 'HAMMER', emittedAt: EMITTED }).row;
  };
  assert.equal(mutate({ n: 0, winRate: 0.3 }).prob, null);
  assert.equal(mutate({ winRate: null }).prob, null);
  assert.equal(mutate({ winRate: 1.2 }).prob, null);
  assert.equal(mutate({ winRate: 0 }).prob, 0);
  assert.equal(mutate({ base: null }).base_rate, null);
});

test('buildPrevisao: recusa setup inexistente, origem inválida, data inválida e número não finito', () => {
  assert.throws(() => buildPrevisao({ summary, setupId: 'NAO_EXISTE', emittedAt: EMITTED }), /setup inexistente/);
  assert.throws(() => buildPrevisao({ summary, setupId: 'HAMMER', origin: 'cliente-x', emittedAt: EMITTED }), /origem inválida/);
  assert.throws(() => buildPrevisao({ summary, setupId: 'HAMMER', emittedAt: 'ontem' }), /emittedAt inválido/);
  assert.throws(() => buildPrevisao({ summary: null, setupId: 'HAMMER', emittedAt: EMITTED }), /summary obrigatório/);
  const nan = structuredClone(summary);
  nan.base.rate = NaN;
  assert.throws(() => buildPrevisao({ summary: nan, setupId: 'HAMMER', emittedAt: EMITTED }), /não finito/);
});

test('o texto canônico refeito a partir do payload lido do banco (jsonb) tem o mesmo hash', async () => {
  for (const [i, setup] of summary.setups.entries()) {
    const p = buildPrevisao({ summary, setupId: setup.id, emittedAt: new Date(Date.parse(EMITTED) + i) });
    const { id, inserted } = await insertPrevisao(db, p.row);
    assert.equal(inserted, true);
    const row = await getPrevisaoById(db, id);
    assert.equal(canonicalize(row.payload), p.canonical, setup.id);
    assert.equal(sha256Hex(canonicalize(row.payload)), p.hash, setup.id);
    assert.equal(row.hash, p.hash);
    assert.deepEqual(row.payload, p.record);
    assert.equal(row.prob, p.row.prob);
    assert.deepEqual(row.params, p.row.params);
    assert.equal(row.emitted_at.toISOString(), p.record.emittedAt);
    assert.equal(row.data_cut.toISOString(), p.record.data.to);
    assert.equal(row.bar_time === null ? null : row.bar_time.toISOString(), p.row.bar_time);
  }
  // o jsonb não preserva a ordem das chaves: o payload voltou reordenado, e mesmo assim o hash confere
  const row = await getPrevisaoById(db, (await findDuplicatePrevisao(db, buildPrevisao({ summary, setupId: 'HAMMER', emittedAt: EMITTED }).row)).id);
  assert.notEqual(JSON.stringify(row.payload), canonicalize(row.payload), 'jsonb reordena as chaves');
});

test('findDuplicatePrevisao: mesma pergunta sobre os mesmos dados acha a existente; outra pergunta não', async () => {
  const own = structuredClone(summary); // pergunta própria deste teste: as outras já gravaram BTCUSDT 4h
  own.input.symbol = 'SOLUSDT';
  const mk = (patch = {}, setupId = 'GOLDEN_CROSS', s = own) => buildPrevisao({ summary: s, setupId, emittedAt: '2026-10-12T16:00:00.000Z', ...patch });
  const first = mk();
  const { id } = await insertPrevisao(db, first.row);
  // emitida mais tarde: o hash é outro, a pergunta é a mesma
  const later = mk({ emittedAt: '2026-10-12T18:30:00.000Z' });
  assert.notEqual(later.hash, first.hash);
  const dup = await findDuplicatePrevisao(db, later.row);
  assert.equal(dup.id, id);
  assert.equal(dup.hash, first.hash);

  assert.equal(await findDuplicatePrevisao(db, mk({}, 'BB_LOWER').row), null, 'outro setup');
  const cfg = structuredClone(own);
  cfg.input.cfg.hold = 13;
  assert.equal(await findDuplicatePrevisao(db, mk({}, 'GOLDEN_CROSS', cfg).row), null, 'outra regra de saída');
  const win = structuredClone(own);
  win.input.windowDays = 365;
  assert.equal(await findDuplicatePrevisao(db, mk({}, 'GOLDEN_CROSS', win).row), null, 'outra janela');
  const data = structuredClone(own);
  data.resultHash = 'a'.repeat(64);
  assert.equal(await findDuplicatePrevisao(db, mk({}, 'GOLDEN_CROSS', data).row), null, 'outro resultado');
  const cut = structuredClone(own);
  cut.data.to = '2026-09-26T16:00:00.000Z';
  assert.equal(await findDuplicatePrevisao(db, mk({}, 'GOLDEN_CROSS', cut).row), null, 'outro corte de dados');
  assert.equal(await findDuplicatePrevisao(db, mk({ origin: 'cliente' }).row), null, 'outra origem');
});

test('listPrevisoesByDay: dia UTC, ordenado por emitted_at e, no empate, por hash', async () => {
  const day = '2025-03-10';
  const items = [
    ['HAMMER', `${day}T23:59:59.999Z`],
    ['BB_LOWER', `${day}T10:00:00.000Z`],
    ['MACD_CROSS', `${day}T10:00:00.000Z`], // empate de instante: desempata o hash
    ['RSI_OVERSOLD', `${day}T00:00:00.000Z`],
    ['HAMMER', '2025-03-09T23:59:59.999Z'], // dia anterior
    ['HAMMER', '2025-03-11T00:00:00.000Z']  // dia seguinte
  ].map(([setupId, emittedAt]) => buildPrevisao({ summary, setupId, emittedAt }));
  for (const p of [items[3], items[0], items[5], items[2], items[1], items[4]]) await insertPrevisao(db, p.row); // fora de ordem
  const rows = await listPrevisoesByDay(db, day);
  const tied = [items[1], items[2]].sort((a, b) => (a.hash < b.hash ? -1 : 1));
  assert.deepEqual(rows.map((r) => r.hash), [items[3].hash, tied[0].hash, tied[1].hash, items[0].hash]);
  assert.ok(rows.every((r) => r.emitted_at instanceof Date));
  assert.deepEqual(await listPrevisoesByDay(db, '2001-01-01'), []);
});

test('dayManifest: texto canônico argos.raiz/1 sem quebra de linha e o SHA-256 dele', () => {
  const root = 'ab'.repeat(32);
  const { manifest, manifestSha256 } = dayManifest({ day: '2026-10-12', nLeaves: 3, root });
  assert.equal(manifest, `{"day":"2026-10-12","nLeaves":3,"root":"${root}","schema":"argos.raiz/1"}`);
  assert.ok(!manifest.endsWith('\n'));
  assert.equal(manifestSha256, sha256Hex(Buffer.from(manifest, 'utf8')));
  assert.match(manifestSha256, /^[0-9a-f]{64}$/);
  // outro dia, outra contagem ou outra raiz: outro digest
  assert.notEqual(manifestSha256, dayManifest({ day: '2026-10-13', nLeaves: 3, root }).manifestSha256);
  assert.notEqual(manifestSha256, dayManifest({ day: '2026-10-12', nLeaves: 4, root }).manifestSha256);
  assert.notEqual(manifestSha256, dayManifest({ day: '2026-10-12', nLeaves: 3, root: 'cd'.repeat(32) }).manifestSha256);
  assert.throws(() => dayManifest({ day: '2026-13-40', nLeaves: 3, root }), /dia inválido/);
  assert.throws(() => dayManifest({ day: '2026-10-12', nLeaves: 0, root }), /nLeaves/);
  assert.throws(() => dayManifest({ day: '2026-10-12', nLeaves: 3, root: 'XYZ' }), /raiz/);
});

test('dia UTC, janela do dia, pendência de âncora e relógio injetável', () => {
  assert.equal(utcDay('2026-10-12T23:59:59.999Z'), '2026-10-12');
  assert.equal(utcDay(Date.parse('2026-10-13T00:00:00.000Z')), '2026-10-13');
  assert.equal(utcDay(new Date('2026-10-12T21:30:00-03:00')), '2026-10-13'); // o dia é sempre o UTC
  assert.deepEqual(dayBounds('2026-12-31'), { from: '2026-12-31T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' });
  assert.equal(isValidDay('2026-02-29'), false);
  assert.equal(isValidDay('2028-02-29'), true);
  assert.equal(isValidDay('2026-1-1'), false);
  assert.equal(isValidDay(20261012), false);
  assert.deepEqual(anchorPending('2026-10-12T15:04:05.123Z'), { day: '2026-10-12', expectedAfter: '2026-10-13T00:10:00.000Z' });
  assert.deepEqual(anchorPending(new Date('2026-12-31T23:59:59.999Z')), { day: '2026-12-31', expectedAfter: '2027-01-01T00:10:00.000Z' });
  assert.equal(clockMs(() => 5), 5);
  assert.equal(clockMs(7), 7);
  assert.equal(clockMs(new Date(9)), 9);
  assert.ok(Math.abs(clockMs() - Date.now()) < 1000);
  assert.throws(() => clockMs('x'), /relógio/);
});
