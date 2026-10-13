// Candles no PGlite: unicidade, upsert, ida e volta de double sem perda e leitura no formato do motor.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';
import { readCandles, upsertCandles, TIMEFRAME_SECONDS } from '../lib/repo/candles.js';

let db;
before(async () => {
  db = await createTestDb();
  await migrate(db);
});
after(() => db.close());

const T0 = Date.UTC(2026, 0, 1) / 1000; // 2026-01-01T00:00:00Z em segundos

/** Série colunar do motor com n barras de dt segundos a partir de t0. */
function serie(n, { t0 = T0, dt = 3600, base = 100 } = {}) {
  const s = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (let i = 0; i < n; i++) {
    s.t.push(t0 + i * dt);
    s.o.push(base + i);
    s.h.push(base + i + 2);
    s.l.push(base + i - 1);
    s.c.push(base + i + 0.5);
    s.v.push(10 + i);
  }
  return s;
}

test('chave primária recusa candle duplicado (símbolo, intervalo, abertura)', async () => {
  const ins = (symbol, tf) => db.query(
    "insert into candles (symbol, timeframe, open_time, open, high, low, close, volume) values ($1, $2, '2026-01-01T00:00:00Z', 1, 2, 0.5, 1.5, 10)",
    [symbol, tf],
  );
  await ins('DUPUSDT', '1h');
  await assert.rejects(() => ins('DUPUSDT', '1h'), (e) => e.code === '23505');
  await ins('DUPUSDT', '4h'); // outro intervalo: permitido
  await ins('OUTROUSDT', '1h'); // outro símbolo: permitido
});

test('upsert insere, é idempotente e só altera o que mudou', async () => {
  const s = serie(10);
  const a = await upsertCandles(db, { symbol: 'UPSUSDT', timeframe: '1h', series: s });
  assert.deepEqual(a, { total: 10, changed: 10 });

  const b = await upsertCandles(db, { symbol: 'UPSUSDT', timeframe: '1h', series: s });
  assert.deepEqual(b, { total: 10, changed: 0 }, 'reenvio idêntico não grava nada');

  const revisado = serie(10);
  revisado.c[3] = 999.25;
  revisado.v[7] = 77777;
  const c = await upsertCandles(db, { symbol: 'UPSUSDT', timeframe: '1h', series: revisado });
  assert.deepEqual(c, { total: 10, changed: 2 });

  const n = await db.query("select count(*)::int as n from candles where symbol = 'UPSUSDT'");
  assert.equal(n.rows[0].n, 10, 'sem linhas duplicadas');
  const d = await readCandles(db, { symbol: 'UPSUSDT', timeframe: '1h' });
  assert.deepEqual(d.c, revisado.c);
  assert.deepEqual(d.v, revisado.v);

  // lote com barras novas e antigas misturadas
  const mix = serie(12);
  mix.c[3] = 999.25;
  mix.v[7] = 77777;
  const e = await upsertCandles(db, { symbol: 'UPSUSDT', timeframe: '1h', series: mix });
  assert.deepEqual(e, { total: 12, changed: 2 }, 'só as 2 barras novas');
});

test('upsert aceita lista de linhas e deduplica t repetido dentro do lote (a última vence)', async () => {
  const rows = [
    { t: T0, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    { t: T0, o: 1, h: 2, l: 0.5, c: 1.75, v: 11 },
    { t: T0 + 3600, o: 2, h: 3, l: 1, c: 2.5, v: 12 },
  ];
  const r = await upsertCandles(db, { symbol: 'LISTAUSDT', timeframe: '1h', series: rows, source: 'teste' });
  assert.deepEqual(r, { total: 2, changed: 2 });
  const d = await readCandles(db, { symbol: 'LISTAUSDT', timeframe: '1h' });
  assert.deepEqual(d.c, [1.75, 2.5]);
  const src = await db.query("select distinct source from candles where symbol = 'LISTAUSDT'");
  assert.deepEqual(src.rows, [{ source: 'teste' }]);
});

test('ida e volta de double sem perda de nenhum bit', async () => {
  const especiais = [
    69130.2, 0.20689655172413793, 0.1 + 0.2, 1 / 3, 1e-7, 123456789.12345679, Number.MIN_VALUE, 1e21,
    Number.MAX_SAFE_INTEGER, 5e-324, 1.7976931348623157e308, 0.30000000000000004,
  ];
  // mais 500 valores pseudoaleatórios determinísticos (LCG), em escalas variadas
  let x = 123456789;
  const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
  const todos = [...especiais];
  for (let i = 0; i < 500; i++) todos.push((rnd() - 0.5) * 10 ** Math.floor(rnd() * 12 - 4));

  const n = todos.length;
  const s = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (let i = 0; i < n; i++) {
    s.t.push(T0 + i * 86400);
    s.o.push(todos[i]);
    s.h.push(todos[(i + 1) % n]);
    s.l.push(todos[(i + 2) % n]);
    s.c.push(todos[(i + 3) % n]);
    s.v.push(Math.abs(todos[(i + 4) % n]));
  }
  await upsertCandles(db, { symbol: 'DBLUSDT', timeframe: '1d', series: s });
  const d = await readCandles(db, { symbol: 'DBLUSDT', timeframe: '1d' });
  assert.equal(d.n, n);
  for (let i = 0; i < n; i++) {
    for (const k of ['o', 'h', 'l', 'c', 'v']) {
      assert.ok(Object.is(d[k][i], s[k][i]), `${k}[${i}]: gravou ${s[k][i]}, voltou ${d[k][i]}`);
    }
  }
  const i1 = especiais.indexOf(69130.2);
  const i2 = especiais.indexOf(0.20689655172413793);
  assert.equal(d.o[i1], 69130.2);
  assert.equal(d.o[i2], 0.20689655172413793);
});

test('leitura de janela devolve o formato do motor { t, o, h, l, c, v, n, dt }', async () => {
  const s = serie(48, { dt: 3600, base: 50000 });
  await upsertCandles(db, { symbol: 'JANUSDT', timeframe: '1h', series: s });
  await upsertCandles(db, { symbol: 'JANUSDT', timeframe: '4h', series: serie(5, { dt: 14400 }) }); // não deve vazar

  const all = await readCandles(db, { symbol: 'JANUSDT', timeframe: '1h' });
  assert.deepEqual(Object.keys(all).sort(), ['c', 'dt', 'h', 'l', 'n', 'o', 't', 'v']);
  assert.equal(all.n, 48);
  assert.equal(all.dt, 3600);
  assert.deepEqual({ t: all.t, o: all.o, h: all.h, l: all.l, c: all.c, v: all.v }, s, 'mesmos arrays que entraram');
  assert.ok(all.t.every((t) => Number.isInteger(t)), 't em segundos Unix inteiros');
  assert.ok(all.t.every((t, i) => i === 0 || t - all.t[i - 1] === all.dt));

  // janela [from, to], ambos inclusivos
  const w = await readCandles(db, { symbol: 'JANUSDT', timeframe: '1h', from: T0 + 10 * 3600, to: T0 + 19 * 3600 });
  assert.equal(w.n, 10);
  assert.equal(w.t[0], T0 + 10 * 3600);
  assert.equal(w.t[9], T0 + 19 * 3600);
  assert.deepEqual(w.c, s.c.slice(10, 20));

  // só limite inferior e só limite superior
  assert.equal((await readCandles(db, { symbol: 'JANUSDT', timeframe: '1h', from: T0 + 40 * 3600 })).n, 8);
  assert.equal((await readCandles(db, { symbol: 'JANUSDT', timeframe: '1h', to: T0 + 2 * 3600 })).n, 3);

  // limit: últimas N barras da janela, ainda em ordem crescente
  const ult = await readCandles(db, { symbol: 'JANUSDT', timeframe: '1h', to: T0 + 29 * 3600, limit: 5 });
  assert.deepEqual(ult.t, [25, 26, 27, 28, 29].map((i) => T0 + i * 3600));
  assert.deepEqual(ult.o, s.o.slice(25, 30));

  // intervalo diferente e janela vazia
  const h4 = await readCandles(db, { symbol: 'JANUSDT', timeframe: '4h' });
  assert.equal(h4.n, 5);
  assert.equal(h4.dt, 14400);
  const vazio = await readCandles(db, { symbol: 'JANUSDT', timeframe: '1h', from: T0 + 1e6 });
  assert.deepEqual(vazio, { t: [], o: [], h: [], l: [], c: [], v: [], n: 0, dt: 3600 });
  const semSimbolo = await readCandles(db, { symbol: 'NADAUSDT', timeframe: '1d' });
  assert.equal(semSimbolo.n, 0);
  assert.equal(semSimbolo.dt, TIMEFRAME_SECONDS['1d']);
});

test('lote grande (mais de um bloco de 5.000) entra inteiro', async () => {
  const s = serie(5200, { dt: 3600 });
  const r = await upsertCandles(db, { symbol: 'BIGUSDT', timeframe: '1h', series: s });
  assert.deepEqual(r, { total: 5200, changed: 5200 });
  const d = await readCandles(db, { symbol: 'BIGUSDT', timeframe: '1h' });
  assert.equal(d.n, 5200);
  assert.deepEqual(d.t, s.t);
});

test('entradas inválidas são recusadas antes de tocar o banco', async () => {
  const s = serie(2);
  await assert.rejects(() => upsertCandles(db, { symbol: 'X', timeframe: '15m', series: s }), /timeframe inválido/);
  await assert.rejects(() => readCandles(db, { symbol: 'X', timeframe: '15m' }), /timeframe inválido/);
  const nan = serie(2);
  nan.c[1] = NaN;
  await assert.rejects(() => upsertCandles(db, { symbol: 'X', timeframe: '1h', series: nan }), /inválido/);
  const frac = serie(2);
  frac.t[0] = T0 + 0.5;
  await assert.rejects(() => upsertCandles(db, { symbol: 'X', timeframe: '1h', series: frac }), /inteiro/);
  await assert.rejects(() => upsertCandles(db, { symbol: 'X', timeframe: '1h', series: 'nada' }), /series/);
  await assert.rejects(() => readCandles(db, { symbol: 'X', timeframe: '1h', limit: 0 }), /limit/);
  const n = await db.query("select count(*)::int as n from candles where symbol = 'X'");
  assert.equal(n.rows[0].n, 0);
});
