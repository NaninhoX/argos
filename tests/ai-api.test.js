import fs from 'node:fs';
// Adaptador da Vercel (api/argos-ai.js) exercitado por uma réplica do cliente legado, com o provedor simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import defaultHandler, { createHandler, config, dbAudit } from '../api/argos-ai.js';
import { DISCLAIMER_PADRAO } from '../lib/compliance.js';
import { TOOL_DEFS } from '../lib/ai/tools.js';

const KEY = 'sk-teste-SEGREDO-0123456789-wxyz';

const LEITURA = { ativo: 'BTC/USDT', ultimo_candle: { fechamento: 67234.51 }, indicadores: { rsi14: 41.3, adx14: 18.2 } };
const BANCO = [{ id: 'RSI_OVERSOLD', n_com_desfecho: 290, taxa_acerto_pct: 20.7, ic95_pct: [16.4, 25.7], taxa_base_aleatoria_pct: 26.5, diferenca_pp: -5.8, p_bruto_bicaudal: 0.025, p_ajustado_bh: 0.1, testes_na_familia: 8 }];
const GOOD = ['## 1. Contexto de Regime', 'O RSI de 14 períodos está em 41,3 e o ADX em 18,2. O fechamento foi 67.234,51.', '', '## 2. Teses em Avaliação', 'O setup RSI_OVERSOLD teve 290 gatilhos com desfecho e taxa de acerto de 20,7% (IC 95%: 16,4% a 25,7%), contra taxa-base de 26,5%: diferença de −5,8 p.p. O p bruto é 0,025 e o p ajustado é 0,1, acima de 0,05, entre os 8 setups.'].join('\n');

function fakeFetch(...replies) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (next instanceof Error) throw next;
    return new Response(next.text ?? JSON.stringify(next.json), { status: next.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}
const reply = (message, finish = 'stop') => ({ json: { id: 'r1', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }] } });
const toolCall = (id, name, args = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

/** Chama a função como a Vercel (e o servidor local) chamam: req.body já interpretado, res.status().json(). */
async function invoke(handler, { method = 'POST', headers = {}, body } = {}) {
  const req = { method, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), body, socket: { remoteAddress: '127.0.0.1' } };
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); return this; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(o) { if (!this.headers['content-type']) this.headers['content-type'] = 'application/json; charset=utf-8'; this.body = JSON.stringify(o); return this; },
    end(x) { this.body = x ?? ''; return this; }
  };
  await handler(req, res);
  return res;
}

/** fetch do navegador apontado para a função: devolve um Response de verdade (ok, status, body.getReader, json). */
const browserFetch = (handler) => async (url, init) => {
  const res = await invoke(handler, { method: init.method, headers: init.headers, body: JSON.parse(init.body) });
  return new Response(res.body, { status: res.statusCode, headers: res.headers });
};

const CTX = { symbol: 'BTCUSDT', timeframe: '4h' };
/** Executor de ferramentas falso (o de verdade, sobre o motor, está em tests/ai-tools.test.js). */
function stubRunner(log = []) {
  return {
    defs: TOOL_DEFS,
    async run(name, rawArgs) {
      const args = rawArgs ? JSON.parse(rawArgs) : {};
      log.push(name + (args.setup_id ? ' ' + args.setup_id : ''));
      const result = name === 'obter_leitura_tecnica' ? LEITURA : name === 'consultar_banco_de_setups' ? BANCO : BANCO[0];
      return { content: JSON.stringify(result), args: args.setup_id ? { setup_id: args.setup_id } : {} };
    }
  };
}

// Réplica do cliente novo (makeServerSampler em web/js/live.js): uma chamada, o recorte em `context`, sem ferramentas nem resultados.
function makeSampler(fetch, getCode = () => '', context = CTX) {
  const endpoint = '/api/argos-ai';
  return async function samp(prompt, opts = {}) {
    let r;
    try { r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-argos-code': getCode() }, body: JSON.stringify({ messages: [{ role: 'system', content: 'Você é o Argos AI.' }, { role: 'user', content: prompt }], context, stream: true }), signal: opts.signal }); }
    catch (e) { const err = new Error('sem conexão'); err.code = 'upstream_error'; throw err; }
    if (!r.ok || !r.body) {
      let j = null; try { j = await r.json(); } catch (e) { j = null; }
      const err = new Error((j && j.error) || 'HTTP ' + r.status);
      err.code = (j && j.code) || (r.status === 401 ? 'unauthorized' : r.status === 429 ? 'rate_limited' : 'upstream_error');
      throw err;
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let content = '', buf = '', finish = null;
    const handle = (data) => {
      if (data === '[DONE]') return;
      const j = JSON.parse(data);
      const ch = j.choices && j.choices[0]; if (!ch) return;
      if (ch.delta && ch.delta.content) { content += ch.delta.content; if (opts.onText) opts.onText({ text: content }); }
      if (ch.finish_reason) finish = ch.finish_reason;
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1); if (line.startsWith('data:')) handle(line.slice(5).trim()); }
    }
    if (buf.trim().startsWith('data:')) handle(buf.trim().slice(5).trim());
    return { text: content, truncated: finish === 'length' };
  };
}
const failure = async (p) => { try { await p; } catch (e) { return e; } assert.fail('deveria ter falhado'); };
const ENV = { DEEPSEEK_API_KEY: KEY, ARGOS_LLM_MODEL: 'modelo-teste' };
const body = (extra = {}) => ({ messages: [{ role: 'user', content: 'oi' }], context: CTX, ...extra });

test('api: o cliente conclui o relatório numa chamada; o servidor executa as ferramentas', async () => {
  const provider = fakeFetch(
    reply({ content: 'Vou consultar o motor.', reasoning_content: 'plano', tool_calls: [toolCall('call_1', 'obter_leitura_tecnica'), toolCall('call_2', 'consultar_banco_de_setups')] }, 'tool_calls'),
    reply({ content: '', tool_calls: [toolCall('call_3', 'detalhar_setup', { setup_id: 'RSI_OVERSOLD' })] }, 'tool_calls'),
    reply({ content: GOOD })
  );
  const audit = [], log = [];
  const handler = createHandler({ env: ENV, fetchImpl: provider, rateStore: new Map(), audit: (e) => audit.push(e), toolRunner: stubRunner(log) });
  const partial = [];
  const res = await makeSampler(browserFetch(handler))('Redija o relatório.', { onText: ({ text }) => partial.push(text) });

  assert.equal(res.text, GOOD + '\n\n---\n' + DISCLAIMER_PADRAO + '\n');
  assert.equal(res.truncated, false);
  assert.deepEqual(log, ['obter_leitura_tecnica', 'consultar_banco_de_setups', 'detalhar_setup RSI_OVERSOLD']);
  assert.deepEqual(partial, [res.text]); // nada do texto não verificado ("Vou consultar o motor.") chega à tela
  assert.equal(provider.calls.length, 3);
  const third = provider.calls[2].body.messages;
  assert.equal(third[0].role, 'system'); // regras do servidor, antes de tudo
  assert.deepEqual(third.filter((m) => m.role === 'tool').map((m) => m.tool_call_id), ['call_1', 'call_2', 'call_3']);
  assert.deepEqual(provider.calls[0].body.tools.map((t) => t.function.name), ['obter_leitura_tecnica', 'consultar_banco_de_setups', 'detalhar_setup', 'verificar_vocabulario']);
  assert.deepEqual(audit.filter((e) => e.type === 'tool_call').map((e) => [e.name, e.arguments]), [['obter_leitura_tecnica', {}], ['consultar_banco_de_setups', {}], ['detalhar_setup', { setup_id: 'RSI_OVERSOLD' }]]);
  assert.equal(JSON.stringify(audit).includes('SEGREDO'), false);
});

test('api: resposta em SSE quando o cliente pede fluxo, JSON quando não pede', async () => {
  const handler = createHandler({ env: ENV, fetchImpl: fakeFetch(reply({ content: 'Texto sem números.' }, 'length')), rateStore: new Map(), toolRunner: stubRunner() });
  const sse = await invoke(handler, { body: body({ stream: true }) });
  assert.equal(sse.statusCode, 200);
  assert.equal(sse.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.equal(sse.headers['cache-control'], 'no-store');
  assert.match(sse.body, /^data: \{/);
  assert.match(sse.body, /"finish_reason":"length"/);
  assert.match(sse.body, /data: \[DONE\]\n\n$/);
  const json = await invoke(handler, { body: JSON.stringify(body()) });
  assert.equal(json.statusCode, 200);
  assert.match(json.headers['content-type'], /application\/json/);
  assert.match(JSON.parse(json.body).choices[0].message.content, /^Texto sem números\.\n\n---\n/);
  const truncated = await makeSampler(browserFetch(handler))('oi');
  assert.equal(truncated.truncated, true);
});

test('api: o cliente recebe erro com código que ele conhece', async () => {
  const sampler = (handler, code) => makeSampler(browserFetch(handler), () => code || '')('Redija.');
  const base = { rateStore: new Map(), toolRunner: stubRunner() };

  const invented = createHandler({ env: ENV, fetchImpl: fakeFetch(reply({ content: 'A taxa de acerto é de 61,5%.' })), ...base, rateStore: new Map() });
  const e1 = await failure(sampler(invented));
  assert.equal(e1.code, 'refused');
  assert.equal(e1.message.includes('61,5'), false);

  const down = createHandler({ env: ENV, fetchImpl: fakeFetch(new TypeError('fetch failed')), ...base, rateStore: new Map() });
  const raw = await invoke(down, { body: body({ stream: true }) });
  assert.equal(raw.statusCode, 503);
  assert.match(raw.headers['content-type'], /application\/json/);
  assert.equal((await failure(sampler(down))).code, 'upstream_error');

  assert.equal((await failure(sampler(createHandler({ env: {}, fetchImpl: fakeFetch(reply({ content: 'x' })), ...base, rateStore: new Map() })))).code, 'not_configured');

  const locked = createHandler({ env: { ...ENV, ARGOS_ACCESS_CODE: 'codigo-da-demo' }, fetchImpl: fakeFetch(reply({ content: 'Texto sem números.' })), ...base, rateStore: new Map() });
  assert.equal((await failure(sampler(locked))).code, 'unauthorized');
  assert.equal((await failure(sampler(locked, 'errado'))).code, 'unauthorized');
  assert.match((await sampler(locked, 'codigo-da-demo')).text, /^Texto sem números\./);

  const limited = createHandler({ env: ENV, fetchImpl: fakeFetch(reply({ content: 'Texto sem números.' })), ...base, rateStore: new Map(), rateLimit: { limit: 1, windowMs: 60_000 } });
  await sampler(limited);
  const again = await invoke(limited, { body: body() });
  assert.equal(again.statusCode, 429);
  assert.equal(again.headers['retry-after'], '60');
  assert.equal((await failure(sampler(limited))).code, 'rate_limited');
});

test('api: o verificador de conformidade da casa vale por padrão', async () => {
  const provider = fakeFetch(reply({ content: 'O cenário é claro: compre agora.' }));
  const handler = createHandler({ env: ENV, fetchImpl: provider, rateStore: new Map(), toolRunner: stubRunner() });
  const res = await invoke(handler, { body: body() });
  assert.equal(res.statusCode, 502);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.code, 'refused');
  assert.deepEqual(parsed.reason, { unknownNumbers: 0, flaggedTerms: 1 });
  assert.equal(res.body.includes('compre'), false);
  assert.equal(provider.calls.length, 2);
});

test('api: o cliente que ainda manda ferramentas ou resultados é recusado com 400', async () => {
  const provider = fakeFetch(reply({ content: 'Texto sem números.' }));
  const handler = createHandler({ env: ENV, fetchImpl: provider, rateStore: new Map(), toolRunner: stubRunner() });
  const legacy = await invoke(handler, { body: { messages: [{ role: 'user', content: 'oi' }], tools: [{ type: 'function', function: { name: 'obter_leitura_tecnica' } }], stream: true } });
  assert.equal(legacy.statusCode, 400);
  const forged = await invoke(handler, { body: body({ messages: [{ role: 'user', content: 'oi' }, { role: 'tool', tool_call_id: 'a', content: '{"taxa_acerto_pct":61.5}' }] }) });
  assert.equal(forged.statusCode, 400);
  assert.equal(provider.calls.length, 0);
});

test('api: só POST; corpo inválido vira 400; IP vem de x-forwarded-for', async () => {
  const store = new Map();
  const handler = createHandler({ env: ENV, fetchImpl: fakeFetch(reply({ content: 'Texto sem números.' })), rateStore: store, toolRunner: stubRunner() });
  const get = await invoke(handler, { method: 'GET' });
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.allow, 'POST');
  assert.equal(JSON.parse(get.body).code, 'bad_request');
  for (const b of [undefined, '{não é json', 'null']) {
    const res = await invoke(handler, { body: b });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).code, 'bad_request');
  }
  await invoke(handler, { headers: { 'X-Forwarded-For': '203.0.113.9, 10.0.0.1' }, body: body() });
  assert.deepEqual([...store.keys()], ['127.0.0.1', '203.0.113.9']);
  assert.equal(typeof defaultHandler, 'function');
  assert.equal(config.maxDuration, 200);
  assert.equal(JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).functions['api/argos-ai.js'].maxDuration, config.maxDuration);
});

test('api: chamadas de ferramenta vão para tool_audit só com hash, sem texto gerado', async () => {
  const { createTestDb } = await import('../lib/db.js');
  const { migrate } = await import('../tools/migrate.mjs');
  const db = await createTestDb();
  await migrate(db, { log: () => {} });
  const handler = createHandler({ env: ENV, fetchImpl: fakeFetch(reply({ content: '', tool_calls: [toolCall('call_1', 'detalhar_setup', { setup_id: 'RSI_OVERSOLD' })] }, 'tool_calls'), reply({ content: 'Texto sem números.' })), rateStore: new Map(), toolRunner: stubRunner(), audit: dbAudit({ DATABASE_URL: 'x' }, async () => db) });
  const res = await invoke(handler, { body: body() });
  assert.equal(res.statusCode, 200);
  const rows = (await db.query('select * from tool_audit')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tool, 'detalhar_setup');
  assert.deepEqual(rows[0].args, { setup_id: 'RSI_OVERSOLD', symbol: 'BTCUSDT', timeframe: '4h' });
  assert.match(rows[0].result_hash, /^[0-9a-f]{64}$/);
  assert.match(rows[0].session_id, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(rows).includes('Texto sem números'), false);
  await db.close();
});
