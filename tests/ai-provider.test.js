import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { createProvider, providerFromEnv, ProviderError, redact, DEFAULT_BASE_URL, DEFAULT_MODEL } from '../lib/ai/provider.js';

const KEY = 'sk-teste-SEGREDO-0123456789abcdef';
const MESSAGES = [{ role: 'user', content: 'oi' }];

/** fetch simulado: cada item de `replies` é { status, json } | { status, text } | Error | função. */
function fakeFetch(...replies) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, init);
    return new Response(next.text ?? JSON.stringify(next.json), { status: next.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}
const reply = (message, finish = 'stop') => ({ json: { id: 'r1', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }], usage: { total_tokens: 10 } } });
const failure = async (p) => { try { await p; } catch (e) { return e; } assert.fail('deveria ter falhado'); };
const dump = (e) => [e.message, e.stack, e.detail, JSON.stringify(e), inspect(e, { depth: 6, showHidden: true })].join('\n');

test('provedor: monta a chamada de chat completions e normaliza a resposta', async () => {
  const fetchImpl = fakeFetch(reply({ content: 'olá', reasoning_content: 'pensando' }));
  const p = createProvider({ apiKey: KEY, fetchImpl });
  const tools = [{ type: 'function', function: { name: 'obter_leitura_tecnica', parameters: { type: 'object', properties: {} } } }];
  const out = await p.chat({ messages: MESSAGES, tools });
  assert.deepEqual(out, { content: 'olá', reasoning: 'pensando', toolCalls: [], finishReason: 'stop', usage: { total_tokens: 10 } });
  const c = fetchImpl.calls[0];
  assert.equal(c.url, DEFAULT_BASE_URL + '/chat/completions');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers.authorization, 'Bearer ' + KEY);
  assert.deepEqual(c.body, { model: DEFAULT_MODEL, messages: MESSAGES, stream: false, tools });
});

test('provedor: normaliza chamadas de ferramenta', async () => {
  const fetchImpl = fakeFetch(reply({ content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'detalhar_setup', arguments: '{"setup_id":"RSI_OVERSOLD"}' } }, { function: { name: 'consultar_banco_de_setups', arguments: {} } }, { id: 'sem_nome', function: {} }] }, 'tool_calls'));
  const out = await createProvider({ apiKey: KEY, fetchImpl }).chat({ messages: MESSAGES });
  assert.equal(out.content, '');
  assert.equal(out.finishReason, 'tool_calls');
  assert.deepEqual(out.toolCalls, [
    { id: 'call_1', type: 'function', function: { name: 'detalhar_setup', arguments: '{"setup_id":"RSI_OVERSOLD"}' } },
    { id: 'call_argos_1', type: 'function', function: { name: 'consultar_banco_de_setups', arguments: '{}' } }
  ]);
  assert.equal('tools' in fetchImpl.calls[0].body, false);
});

test('provedor: lê endereço e modelo do ambiente', async () => {
  const fetchImpl = fakeFetch(reply({ content: 'ok' }));
  const p = providerFromEnv({ DEEPSEEK_API_KEY: KEY, ARGOS_LLM_BASE_URL: 'https://llm.exemplo.test/v1/', ARGOS_LLM_MODEL: 'modelo-x' }, { fetchImpl });
  await p.chat({ messages: MESSAGES, temperature: 0.2, maxTokens: 900 });
  assert.equal(fetchImpl.calls[0].url, 'https://llm.exemplo.test/v1/chat/completions');
  assert.deepEqual(fetchImpl.calls[0].body, { model: 'modelo-x', messages: MESSAGES, stream: false, temperature: 0.2, max_tokens: 900 });
  assert.equal(p.model, 'modelo-x');
});

test('provedor: sem chave não chama a rede', async () => {
  const fetchImpl = fakeFetch(reply({ content: 'ok' }));
  const e = await failure(providerFromEnv({}, { fetchImpl }).chat({ messages: MESSAGES }));
  assert.ok(e instanceof ProviderError);
  assert.equal(e.code, 'not_configured');
  assert.equal(fetchImpl.calls.length, 0);
});

test('provedor: traduz o status HTTP em código de erro', async () => {
  const cases = [[401, 'provider_auth'], [403, 'provider_auth'], [402, 'insufficient_balance'], [429, 'rate_limited'], [400, 'bad_request'], [422, 'bad_request'], [404, 'bad_request'], [500, 'upstream_error'], [503, 'upstream_error']];
  for (const [status, code] of cases) {
    const e = await failure(createProvider({ apiKey: KEY, fetchImpl: fakeFetch({ status, json: { error: { message: 'falhou' } } }) }).chat({ messages: MESSAGES }));
    assert.ok(e instanceof ProviderError, String(status));
    assert.equal(e.code, code, String(status));
    assert.equal(e.status, status);
  }
});

test('provedor: estouro de tempo, rede fora e resposta fora do formato', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('abortado', 'AbortError'))));
  const t0 = Date.now();
  const timeout = await failure(createProvider({ apiKey: KEY, fetchImpl: hang, timeoutMs: 25 }).chat({ messages: MESSAGES }));
  assert.equal(timeout.code, 'timeout');
  assert.ok(Date.now() - t0 < 2000);

  const deaf = () => new Promise(() => {}); // ignora o sinal de cancelamento
  assert.equal((await failure(createProvider({ apiKey: KEY, fetchImpl: deaf, timeoutMs: 25 }).chat({ messages: MESSAGES }))).code, 'timeout');

  const down = await failure(createProvider({ apiKey: KEY, fetchImpl: fakeFetch(new TypeError('fetch failed')) }).chat({ messages: MESSAGES }));
  assert.equal(down.code, 'network');

  for (const bad of [{ text: '<html>erro</html>' }, { json: { choices: [] } }, { json: { choices: [{ index: 0 }] } }]) {
    assert.equal((await failure(createProvider({ apiKey: KEY, fetchImpl: fakeFetch(bad) }).chat({ messages: MESSAGES }))).code, 'invalid_response');
  }
});

test('provedor: a chave nunca aparece em erro nem no objeto do provedor', async () => {
  const echo = 'Authentication Fails, Your api key: ' + KEY + ' / ****' + KEY.slice(-4) + ' is invalid (Bearer ' + KEY + ')';
  const scenarios = [
    fakeFetch({ status: 401, json: { error: { message: echo } } }),
    fakeFetch({ status: 400, json: { error: { message: echo } } }),
    fakeFetch({ status: 500, text: echo }),
    fakeFetch(new Error('connect ECONNREFUSED com cabeçalho Bearer ' + KEY)),
    fakeFetch({ text: echo })
  ];
  for (const fetchImpl of scenarios) {
    const e = await failure(createProvider({ apiKey: KEY, fetchImpl }).chat({ messages: MESSAGES }));
    const text = dump(e);
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes(KEY.slice(-4)), false);
    assert.equal(text.includes('SEGREDO'), false);
  }
  const p = createProvider({ apiKey: KEY, fetchImpl: fakeFetch(reply({ content: 'ok' })) });
  assert.equal((JSON.stringify(p) + inspect(p, { depth: 6, showHidden: true })).includes('SEGREDO'), false);
  assert.deepEqual(Object.keys(p), ['model', 'chat']);
  assert.equal(redact('chave ' + KEY + ' e sk-outra-chave-123', KEY), 'chave [chave] e [chave]');
});
