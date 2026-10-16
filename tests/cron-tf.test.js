// Filtro de tempo gráfico dos crons (?tf=): disparo por candle sem mudar o comportamento diário.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTf } from '../lib/handlers/cron-tf.js';
import { handleCronCandles } from '../lib/handlers/cron-candles.js';
import { handleCronTermometro } from '../lib/handlers/cron-termometro.js';

const env = { CRON_SECRET: 's3', DATABASE_URL: 'x' };
const auth = 'Bearer s3';
const okIngest = async (_db, opts) => { okIngest.last = opts; return { series: [], fetched: 0, seeded: 0, errors: 0 }; };
const okTermo = async (_db, opts) => { okTermo.last = opts; return { series: [], registered: 0, resolved: 0, errors: 0, skipped: 0 }; };
const deps = (extra = {}) => ({ db: {}, ingest: okIngest, termometro: okTermo, log: () => {}, ...extra });

test('parseTf: vazio vale todos; aceita um ou vários (sem repetição); recusa o que não existe', () => {
  assert.deepEqual(parseTf(undefined), {});
  assert.deepEqual(parseTf({}), {});
  assert.deepEqual(parseTf({ tf: '' }), {});
  assert.deepEqual(parseTf({ tf: '1h' }), { timeframes: ['1h'] });
  assert.deepEqual(parseTf({ tf: ['4h'] }), { timeframes: ['4h'] });
  assert.deepEqual(parseTf({ tf: '1h, 4h,1h' }), { timeframes: ['1h', '4h'] });
  for (const bad of ['5m', '1H', 'all', '1h,xx', ',', '1h;drop']) assert.ok(parseTf({ tf: bad }).error, bad);
});

test('cron de candles com ?tf=1h passa o filtro à ingestão e ao Termômetro', async () => {
  const r = await handleCronCandles({ authorization: auth, query: { tf: '1h' }, env, deps: deps() });
  assert.equal(r.status, 200);
  assert.deepEqual(okIngest.last.timeframes, ['1h']);
  assert.deepEqual(okTermo.last.timeframes, ['1h']);
});

test('sem ?tf=, nada muda: nenhum filtro é passado (os três tempos, como no cron diário)', async () => {
  await handleCronCandles({ authorization: auth, env, deps: deps() });
  assert.equal('timeframes' in okIngest.last, false);
  assert.equal('timeframes' in okTermo.last, false);
  await handleCronCandles({ authorization: auth, query: {}, env, deps: deps() });
  assert.equal('timeframes' in okTermo.last, false);
});

test('?tf= inválido é 400, mas só depois da autorização (sem segredo continua 401) e sem tocar em banco nem rede', async () => {
  let touched = false;
  const spy = deps({ ingest: async () => { touched = true; return {}; }, termometro: async () => { touched = true; return {}; } });
  const noAuth = await handleCronCandles({ authorization: 'Bearer errado', query: { tf: 'xx' }, env, deps: spy });
  assert.equal(noAuth.status, 401);
  const bad = await handleCronCandles({ authorization: auth, query: { tf: 'xx' }, env, deps: spy });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'requisicao_invalida');
  assert.equal(touched, false);
});

test('cron do Termômetro também aceita ?tf= e recusa inválido', async () => {
  const r = await handleCronTermometro({ authorization: auth, query: { tf: '4h' }, env, deps: deps() });
  assert.equal(r.status, 200);
  assert.deepEqual(okTermo.last.timeframes, ['4h']);
  assert.equal((await handleCronTermometro({ authorization: auth, query: { tf: '2h' }, env, deps: deps() })).status, 400);
  assert.equal((await handleCronTermometro({ authorization: 'x', query: { tf: '4h' }, env, deps: deps() })).status, 401);
});

test('207 também quando o Termômetro pulou séries pelo prazo (candle sem registro não passa como sucesso)', async () => {
  const skipped = async () => ({ series: [], registered: 0, resolved: 0, errors: 0, skipped: 2 });
  const r = await handleCronCandles({ authorization: auth, query: { tf: '1h' }, env, deps: deps({ termometro: skipped }) });
  assert.equal(r.status, 207);
  const clean = await handleCronCandles({ authorization: auth, query: { tf: '1h' }, env, deps: deps() });
  assert.equal(clean.status, 200);
});

test('whyNotFresh: limite opcional de atraso do registro (registro_tardio), sem limite nada muda', async () => {
  const { whyNotFresh } = await import('../lib/jobs/termometro.js');
  const d = { n: 2, dt: 3600, t: [0, 3600] }; // último candle abre em 3600 s e fecha em 7200 s
  const closeMs = 7200 * 1000, source = 'database';
  assert.equal(whyNotFresh({ d, source }, closeMs + 6 * 60_000), null);
  assert.equal(whyNotFresh({ d, source }, closeMs + 55 * 60_000), null, 'sem limite, a tolerância segue de um candle');
  assert.equal(whyNotFresh({ d, source }, closeMs + 6 * 60_000, 30 * 60_000), null);
  assert.equal(whyNotFresh({ d, source }, closeMs + 55 * 60_000, 30 * 60_000), 'registro_tardio');
  assert.equal(whyNotFresh({ d, source }, closeMs + 61 * 60_000, 30 * 60_000), 'serie_atrasada', 'a recusa por atraso de um candle continua a mesma');
});
