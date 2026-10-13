// Cliente do provedor de LLM: API de chat completions compatível com OpenAI. A DeepSeek é só infraestrutura.
// A chave fica na closure de createProvider: não entra em erro, log, retorno nem em propriedade do objeto.
// Todo erro sai como ProviderError, com mensagem fixa e `detail` já sem segredo.

export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
// O cliente legado não indica modelo: confirmar com Michel.
export const DEFAULT_MODEL = 'deepseek-chat';
export const DEFAULT_TIMEOUT_MS = 90_000;

const MESSAGES = {
  not_configured: 'chave do provedor de LLM ausente',
  timeout: 'o provedor de LLM não respondeu dentro do tempo limite',
  network: 'falha de rede ao chamar o provedor de LLM',
  provider_auth: 'o provedor de LLM recusou a credencial',
  insufficient_balance: 'conta do provedor de LLM sem saldo',
  rate_limited: 'o provedor de LLM limitou as chamadas',
  bad_request: 'o provedor de LLM recusou o pedido (formato, modelo ou endereço)',
  upstream_error: 'erro interno do provedor de LLM',
  invalid_response: 'resposta do provedor de LLM em formato inesperado'
};

export class ProviderError extends Error {
  /**
   * @param {keyof typeof MESSAGES} code
   * @param {{ status?: number | null, detail?: string }} [extra]
   */
  constructor(code, extra = {}) {
    super(MESSAGES[code] || MESSAGES.upstream_error);
    this.name = 'ProviderError';
    this.code = code;
    this.status = extra.status ?? null;
    this.detail = extra.detail ?? '';
  }
}

/** Remove a chave (inteira, início e fim) e qualquer credencial aparente de um texto; corta em 300 caracteres. */
export function redact(text, secret) {
  let s = String(text ?? '');
  if (secret) {
    const parts = secret.length >= 12 ? [secret, secret.slice(0, 8), secret.slice(-4)] : [secret];
    for (const p of parts) s = s.split(p).join('[chave]');
  }
  return s.replace(/\bBearer\s+\S+/gi, 'Bearer [chave]').replace(/\bsk-[A-Za-z0-9_-]{4,}/g, '[chave]').slice(0, 300);
}

const codeForStatus = (s) => (s === 401 || s === 403 ? 'provider_auth' : s === 402 ? 'insufficient_balance' : s === 429 ? 'rate_limited' : s === 400 || s === 404 || s === 422 ? 'bad_request' : 'upstream_error');

/**
 * @param {{ baseUrl?: string, apiKey?: string, model?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [cfg]
 * @returns {{ model: string, chat: (req: { messages: object[], tools?: object[], temperature?: number, maxTokens?: number }) => Promise<{ content: string, reasoning: string, toolCalls: { id: string, type: 'function', function: { name: string, arguments: string } }[], finishReason: string | null, usage: object | null }> }}
 */
export function createProvider(cfg = {}) {
  const apiKey = String(cfg.apiKey || '').trim(); // chave colada com espaço ou quebra de linha não vira erro de credencial
  const model = cfg.model || DEFAULT_MODEL;
  const url = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '') + '/chat/completions';
  const fetchImpl = cfg.fetchImpl || globalThis.fetch;
  const timeoutMs = cfg.timeoutMs || DEFAULT_TIMEOUT_MS;

  async function request(payload, signal) {
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey }, body: JSON.stringify(payload), signal });
    } catch (e) {
      throw new ProviderError('network', { detail: redact(e && e.message, apiKey) });
    }
    let raw;
    try { raw = await res.text(); } catch (e) { throw new ProviderError('network', { status: res.status, detail: redact(e && e.message, apiKey) }); }
    let json = null;
    try { json = JSON.parse(raw); } catch { json = null; }
    if (!res.ok) {
      const code = codeForStatus(res.status);
      // Em erro de credencial o provedor costuma ecoar parte da chave: o detalhe é descartado.
      const detail = code === 'provider_auth' ? '' : redact((json && json.error && json.error.message) || raw, apiKey);
      throw new ProviderError(code, { status: res.status, detail });
    }
    const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
    const msg = choice && choice.message;
    if (!msg || typeof msg !== 'object') throw new ProviderError('invalid_response', { status: res.status });
    const toolCalls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : [])
      .filter((tc) => tc && tc.function && typeof tc.function.name === 'string' && tc.function.name)
      .map((tc, i) => ({ id: String(tc.id || 'call_argos_' + i), type: 'function', function: { name: tc.function.name, arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments ?? {}) } }));
    return {
      content: typeof msg.content === 'string' ? msg.content : '',
      reasoning: typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '',
      toolCalls,
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
      usage: json.usage && typeof json.usage === 'object' ? json.usage : null
    };
  }

  async function chat({ messages, tools, temperature, maxTokens } = {}) {
    if (!apiKey) throw new ProviderError('not_configured');
    const payload = { model, messages, stream: false };
    if (Array.isArray(tools) && tools.length) payload.tools = tools;
    if (temperature != null) payload.temperature = temperature;
    if (maxTokens != null) payload.max_tokens = maxTokens;
    const ctl = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { reject(new ProviderError('timeout')); ctl.abort(); }, timeoutMs); });
    const work = request(payload, ctl.signal);
    work.catch(() => {}); // se o tempo estourar primeiro, a rejeição tardia não fica sem tratamento
    try { return await Promise.race([work, timeout]); } finally { clearTimeout(timer); }
  }

  return { model, chat };
}

/**
 * Provedor a partir das variáveis de ambiente DEEPSEEK_API_KEY, ARGOS_LLM_BASE_URL e ARGOS_LLM_MODEL.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [overrides]
 */
export function providerFromEnv(env = {}, overrides = {}) {
  return createProvider({ baseUrl: env.ARGOS_LLM_BASE_URL, apiKey: env.DEEPSEEK_API_KEY, model: env.ARGOS_LLM_MODEL, ...overrides });
}
