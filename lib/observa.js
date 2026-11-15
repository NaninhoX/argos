// Observabilidade de erros sem serviço externo: envolve os handlers de api/. Exceção não tratada vira uma linha JSON em
// console.error (vai para o log da função na Vercel) e resposta 500 no formato de erro da casa.
// O registro NÃO leva corpo da requisição, IP, cabeçalhos, código de acesso, segredo nem URL de conexão.
import { randomUUID } from 'node:crypto';

const MAX_MSG = 200;
const MAX_ENTRADA = 4000; // limita o custo das expressões regulares em mensagens enormes
const SEGREDOS = ['DATABASE_URL', 'ARGOS_ACCESS_CODE', 'CRON_SECRET', 'ARGOS_IP_HASH_KEY', 'ARGOS_LLM_API_KEY', 'ARGOS_LLM_BASE_URL', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY'];
const NOMES_SEGREDO = '(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|pwd|senha|code|key|authorization)';
const RE_VALOR_CHAVE = new RegExp(`([A-Za-z0-9_-]{0,40}${NOMES_SEGREDO}["']?\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&"']+)`, 'gi');

/** Valores soltos que erro de driver costuma repetir: host, usuário e senha da URL de conexão (e credencial da URL do LLM). */
function derivados(env) {
  const out = [];
  for (const k of ['DATABASE_URL', 'ARGOS_LLM_BASE_URL']) {
    const v = env && env[k];
    if (typeof v !== 'string' || !v) continue;
    try {
      const u = new URL(v);
      if (u.protocol === 'pglite:') continue;
      const cred = [u.username, u.password];
      try { cred.push(decodeURIComponent(u.username), decodeURIComponent(u.password)); } catch { /* escape inválido */ }
      for (const c of cred) if (c && c.length >= 4) out.push(c);
      if (k === 'DATABASE_URL' && u.hostname.length >= 6) out.push(u.hostname);
    } catch { /* não é URL */ }
  }
  return out;
}

/** Tira da mensagem o que não pode ir ao log: URL com credencial/conexão, valores de segredo do ambiente, IPs, e-mails, tokens. */
export function redigir(texto, env = process.env) {
  let s = String(texto == null ? '' : texto);
  const valores = [...SEGREDOS.map((k) => env && env[k]), ...derivados(env)];
  for (const v of valores) {
    if (typeof v === 'string' && v.length >= 4) s = s.split(v).join('[redigido]');
  }
  s = s.slice(0, MAX_ENTRADA);
  s = s
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]*/gi, (m) => (/^https?:\/\/[^@\s]*$/i.test(m) ? m : '[url-redigida]'))
    .replace(/\b(?:postgres(?:ql)?|pglite|mysql|redis|mongodb(?:\+srv)?):\/\/\S*/gi, '[url-redigida]')
    .replace(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5}/g, '[email]')
    .replace(/\b(authorization)(["']?\s*[:=]\s*["']?)(?:(?:bearer|basic|token)\s+)?[^\s'",;]+/gi, '$1$2[redigido]')
    .replace(/\b(bearer|basic)\s+[^\s'",;]+/gi, '$1 [redigido]')
    .replace(RE_VALOR_CHAVE, '$1[redigido]')
    .replace(/\b(host(?:name)?|user(?:name)?|dbname)(\s*=\s*)[^\s,;]+/gi, '$1$2[redigido]')
    .replace(/\buser\s+(["'])[^"']*\1/gi, 'user [redigido]')
    .replace(/\b(?:[a-z0-9-]+\.)*neon\.tech\b(?::\d+)?/gi, '[host]')
    .replace(/\b(?:sk|pk|npg|ghp|xox[a-z])[-_][A-Za-z0-9_*-]{4,}/g, '[redigido]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/(?<![\w:])(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}(?![\w:])/gi, '[ip]')
    .replace(/(?<![\w:])(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?(?![\w:])/gi, '[ip]')
    .replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, '[ip]')
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, '[redigido]');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > MAX_MSG ? s.slice(0, MAX_MSG) + '…' : s;
}

/** Monta o registro estruturado de um erro (função pura, usada também pelos testes). */
export function registroDeErro({ rota, erro, id, status = 500, now = Date.now(), env = process.env, evento = 'erro_nao_tratado' }) {
  const nome = erro && typeof erro === 'object' && (erro.code || erro.name) ? String(erro.code || erro.name) : typeof erro;
  const msg = erro && typeof erro === 'object' && 'message' in erro ? erro.message : erro;
  return {
    evento,
    rota,
    codigo: redigir(nome, env).slice(0, 60),
    mensagem: redigir(msg, env),
    requisicao: id,
    status,
    em: new Date(now).toISOString(),
  };
}

const ERRO_500 = { error: { code: 'erro_interno', message: 'Erro interno. Tente de novo em instantes.' } };
const ERRO_4XX = { error: { code: 'requisicao_invalida', message: 'Requisição inválida.' } };

/**
 * Envolve um handler `(req, res)` da Vercel. Resposta normal passa intacta. Se lançar (ou rejeitar):
 * - erro com `statusCode` 4xx (ex.: ApiError "Invalid JSON" do runtime da Vercel): responde esse status com mensagem
 *   fixa e registra em nível de aviso (`requisicao_rejeitada`), não como erro não tratado;
 * - cabeçalho ainda não enviado: 500 JSON `{ error: { code: 'erro_interno', message } }`, sem herdar cabeçalhos do handler;
 * - cabeçalho já enviado (SSE, resposta parcial): só registra e fecha o fluxo, sem escrever de novo.
 * O id da requisição vem só de `x-vercel-id` (nunca do cliente em `x-request-id`) ou é gerado.
 * `opts` é para teste: `log`, `aviso`, `env`, `now`, `newId`.
 */
export function observa(rota, handler, opts = {}) {
  const { log = console.error, aviso = console.warn, env = process.env, now = Date.now, newId = randomUUID } = opts;
  return async function observado(req, res) {
    try {
      return await handler(req, res);
    } catch (erro) {
      const enviado = Boolean(res && (res.headersSent || res.writableEnded));
      let cliente = false;
      try { const c = erro && erro.statusCode; cliente = Number.isInteger(c) && c >= 400 && c <= 499; } catch { /* getter hostil */ }
      const codigo = cliente ? erro.statusCode : 500;
      const status = enviado ? (res.statusCode || 500) : codigo;
      let id;
      try {
        const v = String((req && req.headers && req.headers['x-vercel-id']) || '').replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 80);
        id = v || newId();
      } catch { id = newId(); }
      try {
        const reg = registroDeErro({ rota, erro, id, status, now: now(), env, evento: cliente ? 'requisicao_rejeitada' : 'erro_nao_tratado' });
        (cliente ? aviso : log)(JSON.stringify(reg));
      } catch { /* log nunca derruba a resposta */ }
      if (enviado) {
        try { if (!res.writableEnded && typeof res.end === 'function') res.end(); } catch { /* já encerrado */ }
        return undefined;
      }
      try {
        if (typeof res.getHeaderNames === 'function' && typeof res.removeHeader === 'function') {
          for (const h of res.getHeaderNames()) { try { res.removeHeader(h); } catch { /* segue */ } }
        }
        res.setHeader('cache-control', 'no-store');
        res.setHeader('x-request-id', id);
        return res.status(codigo).json(cliente ? ERRO_4XX : ERRO_500);
      } catch {
        try { if (!res.headersSent) res.statusCode = 500; res.end(); } catch { /* nada mais a fazer */ }
        return undefined;
      }
    }
  };
}
