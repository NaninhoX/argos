import fs from 'node:fs';
// Adaptador da Vercel (api/argos-ai.js) exercitado por uma réplica do cliente legado, com o provedor simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import defaultHandler, { createHandler, config } from '../api/argos-ai.js';
import { DISCLAIMER_PADRAO } from '../lib/compliance.js';

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

// Réplica de makeServerSampler (legacy/blocks/06-live.js): mesma leitura do SSE e mesmo laço de ferramentas.
function makeLegacySampler(fetch, getCode = () => '') {
  const endpoint = '/api/argos-ai';
  async function call(messages, tools, signal, onDelta) {
    let r;
    try { r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-argos-code': getCode() }, body: JSON.stringify({ messages, tools, stream: true }), signal }); }
    catch (e) { const err = new Error('sem conexão'); err.code = 'upstream_error'; throw err; }
    if (!r.ok || !r.body) {
      let j = null; try { j = await r.json(); } catch (e) { j = null; }
      const err = new Error((j && j.error) || 'HTTP ' + r.status);
      err.code = (j && j.code) || (r.status === 401 ? 'unauthorized' : r.status === 402 ? 'insufficient_balance' : r.status === 429 ? 'rate_limited' : r.status === 400 || r.status === 422 ? 'bad_request' : 'upstream_error');
      throw err;
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    const msg = { content: '', reasoning: '', calls: [] }; let buf = '', finish = null;
    const handle = (data) => {
      if (data === '[DONE]') return;
      let j; try { j = JSON.parse(data); } catch (e) { return; }
      if (j.error) { const err = new Error(j.error.message || 'erro do provedor'); err.code = 'upstream_error'; throw err; }
      const ch = j.choices && j.choices[0]; if (!ch) return;
      const dl = ch.delta || {};
      if (dl.reasoning_content) msg.reasoning += dl.reasoning_content;
      if (dl.content) { msg.content += dl.content; if (onDelta) onDelta(msg.content); }
      (dl.tool_calls || []).forEach((tc) => {
        const i = tc.index != null ? tc.index : msg.calls.length;
        const cur = msg.calls[i] || (msg.calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) cur.id = tc.id;
        if (tc.function) { if (tc.function.name) cur.function.name += tc.function.name; if (tc.function.arguments) cur.function.arguments += tc.function.arguments; }
      });
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
    return { msg, finish };
  }
  return async function samp(prompt, opts) {
    const tools = opts.tools || [];
    const oa = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    const messages = [
      { role: 'system', content: 'Você é o Argos AI, camada de linguagem da Stratum Research. Escreva em português do Brasil e siga à risca as regras da mensagem do usuário.' },
      { role: 'user', content: prompt }
    ];
    for (let round = 0; round < 8; round++) {
      const { msg, finish } = await call(messages, oa.length ? oa : undefined, opts.signal, (t) => opts.onText && opts.onText({ text: t }));
      const calls = msg.calls.filter((c) => c && c.function && c.function.name);
      if (calls.length) {
        const am = { role: 'assistant', content: msg.content || '', tool_calls: calls };
        if (msg.reasoning) am.reasoning_content = msg.reasoning;
        messages.push(am);
        for (const tc of calls) {
          const t = tools.find((x) => x.name === tc.function.name);
          let result;
          try { const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; result = t ? await t.execute(args) : { erro: 'ferramenta desconhecida: ' + tc.function.name }; }
          catch (e) { result = { erro: String((e && e.message) || e) }; }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }
        continue;
      }
      return { text: msg.content, truncated: finish === 'length', modelTierApplied: 'Argos AI (servidor)' };
    }
    const err = new Error('limite de rodadas de ferramentas'); err.code = 'upstream_error'; throw err;
  };
}

function legacyTools(log) {
  return [
    { name: 'obter_leitura_tecnica', description: 'Leitura técnica do motor.', inputSchema: { type: 'object', properties: {} }, execute: () => { log.push('leitura'); return LEITURA; } },
    { name: 'consultar_banco_de_setups', description: 'Banco de setups do motor.', inputSchema: { type: 'object', properties: {} }, execute: () => { log.push('banco'); return BANCO; } },
    { name: 'detalhar_setup', description: 'Detalhe de um setup.', inputSchema: { type: 'object', properties: { setup_id: { type: 'string' } }, required: ['setup_id'] }, execute: (inp) => { log.push('detalhe ' + inp.setup_id); return { id: inp.setup_id, cvar5_por_gatilho_pct: -4.12 }; } }
  ];
}
const failure = async (p) => { try { await p; } catch (e) { return e; } assert.fail('deveria ter falhado'); };

test('api: o cliente legado conclui o relatório com ferramentas, sem alteração', async () => {
  const provider = fakeFetch(
    reply({ content: 'Vou consultar o motor.', reasoning_content: 'plano', tool_calls: [toolCall('call_1', 'obter_leitura_tecnica'), toolCall('call_2', 'consultar_banco_de_setups')] }, 'tool_calls'),
    reply({ content: '', tool_calls: [toolCall('call_3', 'detalhar_setup', { setup_id: 'RSI_OVERSOLD' })] }, 'tool_calls'),
    reply({ content: GOOD })
  );
  const audit = [];
  const handler = createHandler({ env: { DEEPSEEK_API_KEY: KEY }, fetchImpl: provider, rateStore: new Map(), audit: (e) => audit.push(e) });
  const log = []; const partial = [];
  const res = await makeLegacySampler(browserFetch(handler))('Redija o relatório.', { tools: legacyTools(log), onText: ({ text }) => partial.push(text) });

  assert.equal(res.text, GOOD + '\n\n---\n' + DISCLAIMER_PADRAO + '\n');
  assert.equal(res.truncated, false);
  assert.deepEqual(log, ['leitura', 'banco', 'detalhe RSI_OVERSOLD']);
  assert.deepEqual(partial, [res.text]); // nada do texto não verificado ("Vou consultar o motor.") chega à tela
  assert.equal(provider.calls.length, 3);
  // O que o cliente devolve na rodada seguinte é aceito pelo servidor e segue ao provedor.
  const second = provider.calls[1].body.messages;
  assert.equal(second[0].role, 'system'); // regras do servidor, antes de tudo o que o cliente enviou
  assert.deepEqual(second[3], { role: 'assistant', content: '', tool_calls: [toolCall('call_1', 'obter_leitura_tecnica'), toolCall('call_2', 'consultar_banco_de_setups')], reasoning_content: 'plano' });
  assert.deepEqual(second.slice(4), [{ role: 'tool', tool_call_id: 'call_1', content: JSON.stringify(LEITURA) }, { role: 'tool', tool_call_id: 'call_2', content: JSON.stringify(BANCO) }]);
  assert.equal(provider.calls[2].body.messages.length, 8);
  assert.deepEqual(provider.calls[0].body.tools.map((t) => t.function.name), ['obter_leitura_tecnica', 'consultar_banco_de_setups', 'detalhar_setup']);
  assert.deepEqual(audit.filter((e) => e.type === 'tool_call').map((e) => [e.name, e.arguments]), [['obter_leitura_tecnica', {}], ['consultar_banco_de_setups', {}], ['detalhar_setup', { setup_id: 'RSI_OVERSOLD' }]]);
  assert.deepEqual(audit.filter((e) => e.type === 'tool_result').map((e) => e.toolCallId), ['call_1', 'call_2', 'call_3']);
  assert.equal(JSON.stringify(audit).includes('SEGREDO'), false);
});

test('api: resposta em SSE quando o cliente pede fluxo, JSON quando não pede', async () => {
  const handler = createHandler({ env: { DEEPSEEK_API_KEY: KEY }, fetchImpl: fakeFetch(reply({ content: 'Texto sem números.' }, 'length')), rateStore: new Map() });
  const messages = [{ role: 'user', content: 'oi' }];
  const sse = await invoke(handler, { body: { messages, stream: true } });
  assert.equal(sse.statusCode, 200);
  assert.equal(sse.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.equal(sse.headers['cache-control'], 'no-store');
  assert.match(sse.body, /^data: \{/);
  assert.match(sse.body, /"finish_reason":"length"/);
  assert.match(sse.body, /data: \[DONE\]\n\n$/);
  const json = await invoke(handler, { body: JSON.stringify({ messages }) });
  assert.equal(json.statusCode, 200);
  assert.match(json.headers['content-type'], /application\/json/);
  assert.match(JSON.parse(json.body).choices[0].message.content, /^Texto sem números\.\n\n---\n/);
  const truncated = await makeLegacySampler(browserFetch(handler))('oi', {});
  assert.equal(truncated.truncated, true);
});

test('api: o cliente legado recebe erro com código que ele conhece', async () => {
  const sampler = (handler, code) => makeLegacySampler(browserFetch(handler), () => code || '')('Redija.', { tools: legacyTools([]) });
  const env = { DEEPSEEK_API_KEY: KEY };

  const invented = createHandler({ env, fetchImpl: fakeFetch(reply({ content: 'A taxa de acerto é de 61,5%.' })), rateStore: new Map() });
  const e1 = await failure(sampler(invented));
  assert.equal(e1.code, 'refused');
  assert.equal(e1.message.includes('61,5'), false);

  const down = createHandler({ env, fetchImpl: fakeFetch(new TypeError('fetch failed')), rateStore: new Map() });
  const raw = await invoke(down, { body: { messages: [{ role: 'user', content: 'oi' }], stream: true } });
  assert.equal(raw.statusCode, 503);
  assert.match(raw.headers['content-type'], /application\/json/);
  assert.equal((await failure(sampler(down))).code, 'upstream_error');

  assert.equal((await failure(sampler(createHandler({ env: {}, fetchImpl: fakeFetch(reply({ content: 'x' })), rateStore: new Map() })))).code, 'not_configured');

  const locked = createHandler({ env: { ...env, ARGOS_ACCESS_CODE: 'codigo-da-demo' }, fetchImpl: fakeFetch(reply({ content: 'Texto sem números.' })), rateStore: new Map() });
  assert.equal((await failure(sampler(locked))).code, 'unauthorized');
  assert.equal((await failure(sampler(locked, 'errado'))).code, 'unauthorized');
  assert.match((await sampler(locked, 'codigo-da-demo')).text, /^Texto sem números\./);

  const limited = createHandler({ env, fetchImpl: fakeFetch(reply({ content: 'Texto sem números.' })), rateStore: new Map(), rateLimit: { limit: 1, windowMs: 60_000 } });
  await sampler(limited);
  const again = await invoke(limited, { body: { messages: [{ role: 'user', content: 'oi' }] } });
  assert.equal(again.statusCode, 429);
  assert.equal(again.headers['retry-after'], '60');
  assert.equal((await failure(sampler(limited))).code, 'rate_limited');
});

test('api: o verificador de conformidade da casa vale por padrão', async () => {
  const provider = fakeFetch(reply({ content: 'O cenário é claro: compre agora.' }));
  const handler = createHandler({ env: { DEEPSEEK_API_KEY: KEY }, fetchImpl: provider, rateStore: new Map() });
  const res = await invoke(handler, { body: { messages: [{ role: 'user', content: 'oi' }] } });
  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'refused');
  assert.deepEqual(body.reason, { unknownNumbers: 0, flaggedTerms: 1 });
  assert.equal(res.body.includes('compre'), false);
  assert.equal(provider.calls.length, 2);
});

test('api: só POST; corpo inválido vira 400; IP vem de x-forwarded-for', async () => {
  const store = new Map();
  const handler = createHandler({ env: { DEEPSEEK_API_KEY: KEY }, fetchImpl: fakeFetch(reply({ content: 'Texto sem números.' })), rateStore: store });
  const get = await invoke(handler, { method: 'GET' });
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.allow, 'POST');
  assert.equal(JSON.parse(get.body).code, 'bad_request');
  for (const body of [undefined, '{não é json', 'null']) {
    const res = await invoke(handler, { body });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).code, 'bad_request');
  }
  await invoke(handler, { headers: { 'X-Forwarded-For': '203.0.113.9, 10.0.0.1' }, body: { messages: [{ role: 'user', content: 'oi' }] } });
  assert.deepEqual([...store.keys()], ['127.0.0.1', '203.0.113.9']);
  assert.equal(typeof defaultHandler, 'function');
  assert.equal(config.maxDuration, 200);
  assert.equal(JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).functions['api/argos-ai.js'].maxDuration, config.maxDuration);
});
