import test from 'node:test';
import assert from 'node:assert/strict';
import { handleArgosAi, toSse, DEFAULT_RATE_LIMIT, LIMITS, SERVER_POLICY } from '../lib/handlers/argos-ai.js';
import { withDisclaimer } from '../lib/compliance.js';
import { createProvider } from '../lib/ai/provider.js';

// O fim da chave não é hexadecimal de propósito: os ids e hashes da saída não podem coincidir com ele por acaso.
const KEY = 'sk-teste-SEGREDO-0123456789-wxyz';
const ENV = { DEEPSEEK_API_KEY: KEY, ARGOS_LLM_MODEL: 'modelo-teste' };

// Resultados no formato das ferramentas do cliente legado (toolContext e toolBank).
const LEITURA = { ativo: 'BTC/USDT', ultimo_candle: { fechamento: 67234.51 }, indicadores: { rsi14: 41.3, adx14: 18.2 } };
const BANCO = [{ id: 'RSI_OVERSOLD', n_com_desfecho: 290, taxa_acerto_pct: 20.7, ic95_pct: [16.4, 25.7], taxa_base_aleatoria_pct: 26.5, diferenca_pp: -5.8, p_bruto_bicaudal: 0.025, p_ajustado_bh: 0.1, testes_na_familia: 8 }];
const TOOLS = ['obter_leitura_tecnica', 'consultar_banco_de_setups'].map((name) => ({ type: 'function', function: { name, description: 'ferramenta do motor', parameters: { type: 'object', properties: {} } } }));
const QUESTION = [{ role: 'system', content: 'Você é o Argos AI.' }, { role: 'user', content: 'Redija o relatório.' }];
const CALLS = [{ id: 'call_a', type: 'function', function: { name: 'obter_leitura_tecnica', arguments: '{}' } }, { id: 'call_b', type: 'function', function: { name: 'consultar_banco_de_setups', arguments: '{}' } }];
const WITH_RESULTS = [...QUESTION, { role: 'assistant', content: '', tool_calls: CALLS }, { role: 'tool', tool_call_id: 'call_a', content: JSON.stringify(LEITURA) }, { role: 'tool', tool_call_id: 'call_b', content: JSON.stringify(BANCO) }];

const GOOD = ['## 1. Contexto de Regime', 'O RSI de 14 períodos está em 41,3 e o ADX em 18,2. O fechamento foi 67.234,51.', '', '## 2. Teses em Avaliação', 'O setup RSI_OVERSOLD teve 290 gatilhos com desfecho e taxa de acerto de 20,7% (IC 95%: 16,4% a 25,7%), contra taxa-base de 26,5%: diferença de −5,8 p.p. O p bruto é 0,025 e o p ajustado é 0,1, acima de 0,05, entre os 8 setups.'].join('\n');
const BAD = GOOD.replace('20,7%', '31,4%').replace('em 18,2', 'em 44,9');
// O servidor antepõe as próprias regras a toda chamada e assina o texto aprovado com o disclaimer da casa.
const POLICY = { role: 'system', content: SERVER_POLICY };
const SIGNED = withDisclaimer(GOOD);
const DETAIL_TOOL = { type: 'function', function: { name: 'detalhar_setup', description: 'ferramenta do motor', parameters: { type: 'object', properties: {} } } };

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

/** Chama o handler com store de taxa novo e auditoria gravada. */
async function run(fetchImpl, args = {}, deps = {}) {
  const events = [];
  const out = await handleArgosAi({ body: { messages: WITH_RESULTS, tools: TOOLS }, ip: '203.0.113.7', env: ENV, ...args, deps: { fetchImpl, rateStore: new Map(), audit: (e) => events.push(e), ...deps } });
  return { ...out, events };
}
const textOf = (out) => out.body.choices[0].message.content;

test('handler: caminho feliz devolve o texto verificado no formato chat.completion', async () => {
  const fetchImpl = fakeFetch(reply({ content: GOOD, reasoning_content: 'rascunho interno' }));
  const out = await run(fetchImpl);
  assert.equal(out.status, 200);
  assert.equal(out.body.object, 'chat.completion');
  assert.equal(out.body.model, 'argos-ai');
  assert.deepEqual(out.body.choices, [{ index: 0, message: { role: 'assistant', content: SIGNED }, finish_reason: 'stop' }]);
  assert.equal(out.sse, undefined);
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(fetchImpl.calls[0].body.messages, [POLICY, ...WITH_RESULTS]);
  assert.deepEqual(fetchImpl.calls[0].body.tools, TOOLS);
  assert.equal(fetchImpl.calls[0].body.stream, false);
  const last = out.events.at(-1);
  assert.equal(last.type, 'response');
  assert.equal(last.kind, 'text');
  assert.equal(last.status, 200);
  assert.equal(last.attempts, 1);
  assert.match(last.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(out.events.filter((e) => e.type === 'tool_result').map((e) => e.toolCallId), ['call_a', 'call_b']);
  assert.match(out.events[0].resultHash, /^[0-9a-f]{64}$/);
});

test('handler: o cliente não escolhe modelo nem parâmetros do provedor', async () => {
  const fetchImpl = fakeFetch(reply({ content: GOOD }));
  await run(fetchImpl, { body: { messages: WITH_RESULTS, tools: TOOLS, model: 'outro-modelo', temperature: 2, max_tokens: 99999, user: 'cliente-1' }, env: { ...ENV, ARGOS_LLM_BASE_URL: 'https://llm.exemplo.test/v1', ARGOS_LLM_MODEL: 'modelo-da-casa' } });
  assert.deepEqual(Object.keys(fetchImpl.calls[0].body).sort(), ['max_tokens', 'messages', 'model', 'stream', 'tools']);
  assert.equal(fetchImpl.calls[0].body.max_tokens, LIMITS.maxOutputTokens);
  assert.equal(fetchImpl.calls[0].body.model, 'modelo-da-casa');
});

test('handler: repassa chamadas de ferramenta ao cliente, sem o texto que as acompanha', async () => {
  const fetchImpl = fakeFetch(reply({ content: 'Vou consultar o motor: a taxa deve ser 99,9%.', reasoning_content: 'preciso dos dados', tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'detalhar_setup', arguments: '{"setup_id":"RSI_OVERSOLD"}' } }] }, 'tool_calls'));
  const out = await run(fetchImpl, { body: { messages: QUESTION, tools: [...TOOLS, DETAIL_TOOL], stream: true } });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.choices[0], {
    index: 0,
    message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'detalhar_setup', arguments: '{"setup_id":"RSI_OVERSOLD"}' } }], reasoning_content: 'preciso dos dados' },
    finish_reason: 'tool_calls'
  });
  assert.equal(JSON.stringify(out.body).includes('99,9'), false);
  const call = out.events.find((e) => e.type === 'tool_call');
  assert.equal(call.name, 'detalhar_setup');
  assert.deepEqual(call.arguments, { setup_id: 'RSI_OVERSOLD' });
  assert.equal(call.toolCallId, 'call_a');
  assert.match(call.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(call.requestId, out.events.at(-1).requestId);
  assert.equal(out.events.at(-1).kind, 'tool_calls');

  const chunks = out.sse.trim().split('\n\n').map((l) => l.replace(/^data: /, ''));
  assert.equal(chunks.at(-1), '[DONE]');
  const first = JSON.parse(chunks[0]);
  assert.equal(first.object, 'chat.completion.chunk');
  assert.deepEqual(first.choices[0].delta.tool_calls, [{ index: 0, id: 'call_a', type: 'function', function: { name: 'detalhar_setup', arguments: '{"setup_id":"RSI_OVERSOLD"}' } }]);
  assert.equal(first.choices[0].delta.reasoning_content, 'preciso dos dados');
  assert.equal(JSON.parse(chunks[1]).choices[0].finish_reason, 'tool_calls');
  assert.equal(out.sse, toSse(out.body));
});

test('handler: ferramenta que o cliente não declarou não é repassada', async () => {
  const fetchImpl = fakeFetch(reply({ content: '', tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'taxa_61.5', arguments: '{}' } }] }, 'tool_calls'));
  const out = await run(fetchImpl, { body: { messages: QUESTION, tools: TOOLS } });
  assert.equal(out.status, 502);
  assert.equal(out.body.code, 'invalid_tool_call');
  assert.equal(JSON.stringify(out.body).includes('61'), false);
  assert.deepEqual(out.events.at(-1).strayTools, ['taxa_61.5']);
});

test('handler: sem injeção, valem o verificador de conformidade e o disclaimer da casa', async () => {
  const out = await handleArgosAi({ body: { messages: WITH_RESULTS, tools: TOOLS }, ip: '203.0.113.8', env: ENV, deps: { fetchImpl: fakeFetch(reply({ content: GOOD + '\nCompre agora. Eu garanto.' })), rateStore: new Map() } });
  assert.equal(out.status, 502);
  assert.equal(out.body.code, 'refused');
  assert.equal(out.body.reason.flaggedTerms, 2);
  const ok = await handleArgosAi({ body: { messages: WITH_RESULTS, tools: TOOLS }, ip: '203.0.113.8', env: ENV, deps: { fetchImpl: fakeFetch(reply({ content: GOOD })), rateStore: new Map() } });
  assert.equal(ok.body.choices[0].message.content, SIGNED);
});

test('handler: em produção, sem código de acesso configurado, o endpoint não abre', async () => {
  const fetchImpl = fakeFetch(reply({ content: GOOD }));
  const out = await run(fetchImpl, { env: { ...ENV, VERCEL_ENV: 'production' } });
  assert.equal(out.status, 503);
  assert.equal(out.body.code, 'not_configured');
  assert.equal(fetchImpl.calls.length, 0);
  const open = await run(fakeFetch(reply({ content: GOOD })), { env: { ...ENV, VERCEL_ENV: 'production', ARGOS_ACCESS_CODE: 'demo-123' }, code: 'demo-123' });
  assert.equal(open.status, 200);
});

test('handler: a guarda bloqueia número inventado e nunca devolve o texto', async () => {
  const fetchImpl = fakeFetch(reply({ content: BAD }));
  const out = await run(fetchImpl, { body: { messages: WITH_RESULTS, tools: TOOLS, stream: true } });
  assert.equal(out.status, 502);
  assert.equal(out.body.code, 'refused');
  assert.match(out.body.error, /não passou na verificação/);
  assert.deepEqual(out.body.reason, { unknownNumbers: 2, flaggedTerms: 0 });
  assert.equal(out.sse, undefined);
  assert.equal(fetchImpl.calls.length, 2);
  const visible = JSON.stringify({ body: out.body, headers: out.headers });
  for (const leak of ['31,4', '44,9', 'Contexto de Regime', 'RSI_OVERSOLD']) assert.equal(visible.includes(leak), false, leak);
  const last = out.events.at(-1);
  assert.equal(last.code, 'refused');
  assert.equal(last.attempts, 2);
  assert.deepEqual(last.rejections.map((r) => r.unknownNumbers), [['44,9', '31,4%'], ['44,9', '31,4%']]);
});

test('handler: sem resultado de ferramenta na conversa, texto com número é bloqueado', async () => {
  const out = await run(fakeFetch(reply({ content: GOOD })), { body: { messages: QUESTION, tools: TOOLS } });
  assert.equal(out.status, 502);
  assert.equal(out.body.code, 'refused');
});

test('handler: nova tentativa pede correção e devolve só o texto corrigido', async () => {
  const fetchImpl = fakeFetch(reply({ content: BAD }), reply({ content: GOOD }));
  const out = await run(fetchImpl);
  assert.equal(out.status, 200);
  assert.equal(textOf(out), SIGNED);
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(fetchImpl.calls[1].body.messages[0], POLICY);
  const retry = fetchImpl.calls[1].body.messages.slice(1);
  assert.deepEqual(retry.slice(0, WITH_RESULTS.length), WITH_RESULTS);
  assert.deepEqual(retry[WITH_RESULTS.length], { role: 'assistant', content: BAD });
  const ask = retry[WITH_RESULTS.length + 1];
  assert.equal(ask.role, 'user');
  assert.match(ask.content, /recusada pela verificação automática/);
  assert.match(ask.content, /44,9; 31,4%/);
  assert.equal(retry.length, WITH_RESULTS.length + 2);
  assert.equal(out.events.at(-1).attempts, 2);
  assert.equal(out.events.at(-1).rejections.length, 1);
});

test('handler: nova tentativa que pede ferramenta é repassada', async () => {
  const fetchImpl = fakeFetch(reply({ content: BAD }), reply({ content: '', tool_calls: [CALLS[0]] }, 'tool_calls'));
  const out = await run(fetchImpl);
  assert.equal(out.status, 200);
  assert.equal(out.body.choices[0].finish_reason, 'tool_calls');
  assert.equal(textOf(out), '');
});

test('handler: verificador de conformidade reprova, pede correção e falha fechado', async () => {
  const scanText = (text) => (text.includes('TERMO_VETADO') ? [{ rule: 'teste', term: 'TERMO_VETADO', index: text.indexOf('TERMO_VETADO') }] : []);
  const flagged = GOOD + '\nTERMO_VETADO.';

  const fixed = fakeFetch(reply({ content: flagged }), reply({ content: GOOD }));
  const ok = await run(fixed, {}, { scanText });
  assert.equal(ok.status, 200);
  assert.equal(textOf(ok), SIGNED);
  assert.match(fixed.calls[1].body.messages.at(-1).content, /Termos fora da Política de Compliance: TERMO_VETADO/);

  const stuck = await run(fakeFetch(reply({ content: flagged })), {}, { scanText });
  assert.equal(stuck.status, 502);
  assert.equal(stuck.body.code, 'refused');
  assert.deepEqual(stuck.body.reason, { unknownNumbers: 0, flaggedTerms: 1 });
  assert.equal(JSON.stringify(stuck.body).includes('TERMO_VETADO'), false);

  for (const broken of [() => { throw new Error('quebrou'); }, () => null, async () => 'limpo']) {
    const out = await run(fakeFetch(reply({ content: GOOD })), {}, { scanText: broken });
    assert.equal(out.status, 500);
    assert.equal(out.body.code, 'internal_error');
    assert.equal(JSON.stringify(out.body).includes('Contexto de Regime'), false);
  }
});

test('handler: o disclaimer entra depois da verificação', async () => {
  const withDisclaimer = (t) => t + '\n\n---\nAviso padrão 2026: 100% research.';
  const out = await run(fakeFetch(reply({ content: GOOD })), {}, { withDisclaimer });
  assert.equal(out.status, 200);
  assert.equal(textOf(out), withDisclaimer(GOOD));
});

test('handler: limite de taxa por IP, com store e relógio injetados', async () => {
  let t = 1_000_000;
  const deps = { fetchImpl: fakeFetch(reply({ content: GOOD })), rateStore: new Map(), rateLimit: { limit: 2, windowMs: 60_000 }, now: () => t };
  const call = (ip) => handleArgosAi({ body: { messages: WITH_RESULTS, tools: TOOLS }, ip, env: ENV, deps });
  assert.equal((await call('198.51.100.1')).status, 200);
  assert.equal((await call('198.51.100.1')).status, 200);
  const blocked = await call('198.51.100.1');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'rate_limited');
  assert.deepEqual(blocked.headers, { 'retry-after': '60' });
  assert.equal(deps.fetchImpl.calls.length, 2);
  assert.equal((await call('198.51.100.2')).status, 200);
  t += 30_000;
  assert.deepEqual((await call('198.51.100.1')).headers, { 'retry-after': '30' });
  t += 30_001;
  assert.equal((await call('198.51.100.1')).status, 200);
  assert.deepEqual(DEFAULT_RATE_LIMIT, { limit: 30, windowMs: 60_000 });
});

test('handler: provedor fora devolve 503 honesto, sem texto', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('abortado', 'AbortError'))));
  const cases = [
    [{ fetchImpl: fakeFetch(new TypeError('fetch failed')) }, 'upstream_error'],
    [{ fetchImpl: fakeFetch({ status: 500, text: 'Internal Server Error' }) }, 'upstream_error'],
    [{ fetchImpl: fakeFetch({ status: 503, json: { error: { message: 'Server overloaded' } } }) }, 'upstream_error'],
    [{ fetchImpl: fakeFetch({ text: 'não é JSON' }) }, 'upstream_error'],
    [{ provider: createProvider({ apiKey: KEY, model: 'modelo-teste', fetchImpl: hang, timeoutMs: 25 }) }, 'upstream_error'],
    [{ provider: { chat: async () => { throw new Error('erro inesperado'); } } }, 'upstream_error'],
    [{ fetchImpl: fakeFetch({ status: 429, json: { error: { message: 'Rate limit' } } }) }, 'rate_limited'],
    [{ fetchImpl: fakeFetch({ status: 402, json: { error: { message: 'Insufficient Balance' } } }) }, 'insufficient_balance'],
    [{ fetchImpl: fakeFetch({ status: 401, json: { error: { message: 'Authentication Fails' } } }) }, 'provider_auth']
  ];
  for (const [deps, code] of cases) {
    const out = await run(undefined, { body: { messages: WITH_RESULTS, tools: TOOLS, stream: true } }, deps);
    assert.equal(out.status, 503, code);
    assert.equal(out.body.code, code);
    assert.match(out.body.error, /Nenhum texto foi gerado/);
    assert.deepEqual(Object.keys(out.body), ['error', 'code']);
    assert.equal(out.sse, undefined);
    assert.equal(out.events.at(-1).status, 503);
  }
  const rejected = await run(fakeFetch({ status: 400, json: { error: { message: 'Model Not Exist' } } }));
  assert.equal(rejected.status, 502);
  assert.equal(rejected.body.code, 'bad_request');
  assert.equal(rejected.events.at(-1).provider.detail, 'Model Not Exist');
});

test('handler: sem chave configurada devolve 503 e não chama a rede', async () => {
  const fetchImpl = fakeFetch(reply({ content: GOOD }));
  const out = await run(fetchImpl, { env: {} });
  assert.equal(out.status, 503);
  assert.equal(out.body.code, 'not_configured');
  assert.equal(fetchImpl.calls.length, 0);
});

test('handler: resposta vazia do provedor vira erro, não texto em branco', async () => {
  const out = await run(fakeFetch(reply({ content: '  \n' })));
  assert.equal(out.status, 502);
  assert.equal(out.body.code, 'empty_completion');
});

test('handler: valida a requisição antes de chamar o provedor', async () => {
  const fetchImpl = fakeFetch(reply({ content: GOOD }));
  const invalid = [
    undefined, 'texto', [], {}, { messages: [] }, { messages: 'oi' },
    { messages: [{ role: 'root', content: 'x' }] },
    { messages: [{ role: 'user', content: { parte: 1 } }] },
    { messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] },
    { messages: [{ role: 'user', content: 'x' }, { role: 'tool', content: '{}' }] },
    { messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: '', tool_calls: [{ id: 'a' }] }, { role: 'tool', tool_call_id: 'a', content: '{}' }] },
    { messages: QUESTION, stream: 'sim' },
    { messages: QUESTION, tools: [{ type: 'function', function: { name: 'nome inválido!' } }] },
    { messages: QUESTION, tools: 'todas' },
    { messages: Array.from({ length: 65 }, () => ({ role: 'user', content: 'x' })) }
  ];
  for (const body of invalid) {
    const out = await run(fetchImpl, { body });
    assert.equal(out.status, 400, JSON.stringify(body));
    assert.equal(out.body.code, 'bad_request');
    assert.equal(typeof out.body.error, 'string');
  }
  const big = await run(fetchImpl, { body: { messages: [{ role: 'user', content: 'x'.repeat(400_001) }] } });
  assert.equal(big.status, 413);
  assert.equal(big.body.code, 'prompt_too_large');
  assert.equal(fetchImpl.calls.length, 0);
});

test('handler: código de acesso só é exigido quando ARGOS_ACCESS_CODE existe', async () => {
  const env = { ...ENV, ARGOS_ACCESS_CODE: 'codigo-da-demo' };
  for (const code of [undefined, '', 'errado', 'codigo-da-dema']) {
    const fetchImpl = fakeFetch(reply({ content: GOOD }));
    const out = await run(fetchImpl, { env, code });
    assert.equal(out.status, 401);
    assert.equal(out.body.code, 'unauthorized');
    assert.equal(fetchImpl.calls.length, 0);
  }
  assert.equal((await run(fakeFetch(reply({ content: GOOD })), { env, code: 'codigo-da-demo' })).status, 200);
  assert.equal((await run(fakeFetch(reply({ content: GOOD })), { code: 'qualquer' })).status, 200);
});

test('handler: a chave, o IP e o código de acesso nunca aparecem em saída, auditoria, log ou pedido ao provedor', async () => {
  const echo = 'Authentication Fails, Your api key: ' + KEY + ' is invalid';
  const env = { ...ENV, ARGOS_ACCESS_CODE: 'codigo-da-demo' };
  const scenarios = [
    fakeFetch(reply({ content: GOOD })),
    fakeFetch(reply({ content: '', tool_calls: [CALLS[0]] }, 'tool_calls')),
    fakeFetch(reply({ content: BAD })),
    fakeFetch({ status: 401, json: { error: { message: echo } } }),
    fakeFetch({ status: 400, json: { error: { message: echo } } }),
    fakeFetch({ status: 500, text: echo }),
    fakeFetch(new Error('falha com Bearer ' + KEY)),
    fakeFetch({ text: echo })
  ];
  const logged = [];
  const original = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) { original[m] = console[m]; console[m] = (...a) => logged.push(a.map(String).join(' ')); }
  const seen = [];
  try {
    for (const fetchImpl of scenarios) {
      for (const stream of [false, true]) {
        const out = await run(fetchImpl, { env, code: 'codigo-da-demo', body: { messages: WITH_RESULTS, tools: TOOLS, stream } });
        seen.push(JSON.stringify(out));
      }
      for (const c of fetchImpl.calls) {
        assert.equal(c.init.headers.authorization, 'Bearer ' + KEY);
        const sent = c.url + JSON.stringify({ ...c.init, headers: { ...c.init.headers, authorization: '' }, signal: undefined });
        for (const secret of [KEY, '203.0.113.7', 'codigo-da-demo']) assert.equal(sent.includes(secret), false);
      }
    }
  } finally {
    Object.assign(console, original);
  }
  const everything = seen.concat(logged).join('\n');
  assert.ok(seen.length === 16 && everything.length > 1000);
  for (const secret of [KEY, 'SEGREDO', KEY.slice(-4), '203.0.113.7', 'codigo-da-demo']) assert.equal(everything.includes(secret), false, secret);
});
