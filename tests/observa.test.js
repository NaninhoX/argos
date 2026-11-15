// lib/observa.js: exceção vira 500 JSON + um registro estruturado, sem IP, corpo, código de acesso nem DATABASE_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observa, redigir, registroDeErro } from '../lib/observa.js';

const DB_URL = 'postgres://usuario:senhasecreta99@ep-exemplo.neon.tech/argos?sslmode=require';
const env = { DATABASE_URL: DB_URL, ARGOS_ACCESS_CODE: 'codigo-geral-xyz-123', CRON_SECRET: 'segredo-do-cron-456' };

function fakeRes({ headersSent = false } = {}) {
  const r = { headers: {}, statusCode: 200, headersSent, writableEnded: false, ended: 0, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; r.headersSent = true; r.writableEnded = true; return r; };
  r.end = (b) => { r.ended += 1; r.writableEnded = true; r.headersSent = true; if (b !== undefined) r.body = b; return r; };
  return r;
}
const req = {
  method: 'POST',
  headers: { 'x-forwarded-for': '203.0.113.77, 10.0.0.1', 'x-argos-code': 'codigo-geral-xyz-123', authorization: 'Bearer segredo-do-cron-456', cookie: 'sid=abc' },
  body: { symbol: 'BTCUSDT', nota: 'corpo-secreto-do-cliente' },
  socket: { remoteAddress: '198.51.100.9' },
};
const opts = (logs) => ({ log: (l) => logs.push(l), env, now: () => Date.UTC(2026, 10, 15, 12, 0, 0), newId: () => 'req-fixo-1' });

test('erro lançado: 500 no formato da casa e um registro JSON estruturado', async () => {
  const logs = [];
  const res = fakeRes();
  const h = observa('/api/x', async () => { throw new TypeError('quebrou algo'); }, opts(logs));
  await h(req, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: { code: 'erro_interno', message: 'Erro interno. Tente de novo em instantes.' } });
  assert.equal(res.headers['x-request-id'], 'req-fixo-1');
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0]), { evento: 'erro_nao_tratado', rota: '/api/x', codigo: 'TypeError', mensagem: 'quebrou algo', requisicao: 'req-fixo-1', status: 500, em: '2026-11-15T12:00:00.000Z' });
});

test('o registro não contém IP, corpo, cabeçalhos, código de acesso, segredo nem DATABASE_URL', async () => {
  const logs = [];
  const res = fakeRes();
  const h = observa('/api/x', async () => { throw new Error(`connect falhou em ${DB_URL} (cliente 203.0.113.77, codigo-geral-xyz-123, segredo-do-cron-456)`); }, opts(logs));
  await h(req, res);
  const l = logs.join('\n') + JSON.stringify(res.body);
  for (const proibido of ['203.0.113.77', '198.51.100.9', '10.0.0.1', 'corpo-secreto-do-cliente', 'codigo-geral-xyz-123', 'segredo-do-cron-456', 'senhasecreta99', 'usuario:', 'neon.tech', DB_URL, 'cookie', 'sid=abc']) {
    assert.ok(!l.includes(proibido), `vazou: ${proibido}`);
  }
  assert.deepEqual(Object.keys(JSON.parse(logs[0])).sort(), ['codigo', 'em', 'evento', 'mensagem', 'requisicao', 'rota', 'status']);
});

test('mensagem longa é truncada e usa x-vercel-id como id da requisição quando existe', async () => {
  const logs = [];
  const h = observa('/api/x', () => { throw new Error('a '.repeat(500)); }, opts(logs));
  await h({ ...req, headers: { 'x-vercel-id': 'gru1::abc-123' } }, fakeRes());
  const r = JSON.parse(logs[0]);
  assert.ok(r.mensagem.length <= 201);
  assert.equal(r.requisicao, 'gru1::abc-123');
});

test('rejeição com valor que não é Error também vira 500 sem quebrar', async () => {
  const logs = [];
  const res = fakeRes();
  await observa('/api/x', () => Promise.reject('texto solto'), opts(logs))(req, res);
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(logs[0]).mensagem, 'texto solto');
});

test('handler normal passa intacto: mesma resposta, nenhum log', async () => {
  const logs = [];
  const res = fakeRes();
  const h = observa('/api/x', async (rq, rs) => { rs.setHeader('x-teste', '1'); rs.status(201).json({ ok: true }); return 'ret'; }, opts(logs));
  assert.equal(await h(req, res), 'ret');
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(res.headers['x-teste'], '1');
  assert.equal(res.headers['x-request-id'], undefined);
  assert.equal(logs.length, 0);
});

test('SSE com cabeçalho já enviado: registra, não escreve outra resposta e fecha o fluxo uma vez', async () => {
  const logs = [];
  const res = fakeRes();
  const h = observa('/api/argos-ai', async (rq, rs) => {
    rs.setHeader('content-type', 'text/event-stream');
    rs.statusCode = 200; rs.headersSent = true; // primeiro pedaço já saiu
    throw new Error('queda no meio do fluxo');
  }, opts(logs));
  await h(req, res);
  assert.equal(res.statusCode, 200, 'status já enviado não muda');
  assert.equal(res.body, undefined, 'nada de JSON de erro por cima do fluxo');
  assert.equal(res.headers['x-request-id'], undefined);
  assert.equal(res.ended, 1);
  const r = JSON.parse(logs[0]);
  assert.equal(r.status, 200);
  assert.equal(r.rota, '/api/argos-ai');
});

test('redigir e registroDeErro: URL de conexão, IP e token longo saem da mensagem', () => {
  assert.equal(redigir('falha em postgresql://u:p@h/db', {}), 'falha em [url-redigida]');
  assert.equal(redigir('ip 192.168.0.1 e 2001:db8:0:0:0:0:0:1', {}), 'ip [ip] e [ip]');
  assert.ok(!redigir('x ' + 'A'.repeat(40), {}).includes('AAAA'));
  assert.equal(registroDeErro({ rota: '/r', erro: Object.assign(new Error('m'), { code: 'ECONNRESET' }), id: 'i', now: 0, env: {} }).codigo, 'ECONNRESET');
});

// Ataques do validador: cada caso tem de sair sem o segredo.
const ENV_NEON = {
  DATABASE_URL: 'postgresql://neondb_owner:npg_AbC123xyz@ep-cool-darkness-a1b2c3d4-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require',
  ARGOS_IP_HASH_KEY: 'chave-do-hash-ip-777',
  ARGOS_LLM_API_KEY: 'sk-short1',
};
const naoVaza = (entrada, proibidos, e = ENV_NEON) => {
  const r = redigir(entrada, e);
  for (const p of proibidos) assert.ok(!r.includes(p), `vazou ${p} em: ${r}`);
  return r;
};

test('redigir: Authorization Bearer, api_key, tokens e x-argos-code em JSON com aspas', () => {
  naoVaza('Authorization: Bearer sk-xxxx1234', ['sk-xxxx1234', 'xxxx1234']);
  naoVaza('falhou com Bearer abcDEF123', ['abcDEF123']);
  naoVaza('request to https://api.deepseek.com/v1?api_key=SECRETO12345 failed', ['SECRETO12345']);
  naoVaza('access_token=abcdefghij12345 refresh_token=zzzqqq', ['abcdefghij12345', 'zzzqqq']);
  naoVaza('{"x-argos-code":"abc123xyz","outro":1}', ['abc123xyz']);
  naoVaza("{'api_key': 'valorsecreto9'}", ['valorsecreto9']);
});

test('redigir: host Neon, host=/user=, senha solta e usuário vindos da DATABASE_URL', () => {
  naoVaza('getaddrinfo ENOTFOUND ep-cool-darkness-a1b2c3d4-pooler.sa-east-1.aws.neon.tech', ['neon.tech', 'ep-cool']);
  naoVaza('connect ECONNREFUSED ep-x.neon.tech:5432', ['neon.tech', '5432']);
  naoVaza('host=ep-x.neon.tech user=neondb_owner dbname=neondb', ['ep-x', 'neondb_owner']);
  naoVaza('password: npg_AbC123xyz', ['npg_AbC123xyz', 'AbC123xyz']);
  naoVaza('invalid password "npg_AbC123xyz"', ['AbC123xyz']);
  naoVaza("password authentication failed for user 'neondb_owner'", ['neondb_owner']);
  naoVaza('npg_AbC123xyz', ['AbC123xyz']);
  naoVaza('chave-do-hash-ip-777', ['chave-do-hash-ip-777']);
  naoVaza('Incorrect API key provided: sk-abc123***********XYZ9', ['sk-abc123']);
  naoVaza('senha com escape postgres://u:p%40ss@h/db', ['p%40ss']);
  assert.ok(!redigir('db', { DATABASE_URL: 'pglite://memory' }).includes('[redigido]'), 'pglite://memory não vira segredo');
});

test('redigir: IPv6 comprimido, IPv4 mapeado e e-mail', () => {
  const r = naoVaza('client 203.0.113.7:51234 ::ffff:203.0.113.7 fe80::1 2001:db8::1 ::1', ['203.0.113.7', 'fe80', '2001:db8', '::1']);
  assert.ok(r.includes('[ip]'));
  naoVaza('user email fulano@exemplo.com.br falhou', ['fulano', 'exemplo.com.br']);
});

test('redigir: mensagem enorme não trava', () => {
  const t = Date.now();
  redigir('a:'.repeat(2e6), ENV_NEON);
  redigir('1.'.repeat(2e6), ENV_NEON);
  assert.ok(Date.now() - t < 1000, `lento: ${Date.now() - t} ms`);
});

test('x-request-id do cliente é ignorado: usa x-vercel-id ou id gerado', async () => {
  const logs = [];
  const res = fakeRes();
  await observa('/api/x', () => { throw new Error('x'); }, opts(logs))({ headers: { 'x-request-id': 'forjado-pelo-cliente' } }, res);
  assert.equal(res.headers['x-request-id'], 'req-fixo-1');
  assert.equal(JSON.parse(logs[0]).requisicao, 'req-fixo-1');
  const res2 = fakeRes();
  await observa('/api/x', () => { throw new Error('x'); }, opts([]))({ headers: { 'x-request-id': 'a', 'x-vercel-id': 'gru1::ok-1' } }, res2);
  assert.equal(res2.headers['x-request-id'], 'gru1::ok-1');
});

test('setHeader lançando no 500: a conexão é encerrada com res.end, nunca fica pendurada', async () => {
  const res = fakeRes();
  res.setHeader = () => { throw new TypeError('Invalid character in header content'); };
  await observa('/api/x', () => { throw new Error('x'); }, opts([]))(req, res);
  assert.equal(res.ended, 1);
  assert.equal(res.statusCode, 500);
});

test('500 não herda cabeçalhos que o handler pôs antes', async () => {
  const res = fakeRes();
  res.getHeaderNames = () => Object.keys(res.headers);
  res.removeHeader = (k) => { delete res.headers[k]; };
  await observa('/api/x', (rq, rs) => { rs.setHeader('content-type', 'text/event-stream'); rs.setHeader('set-cookie', 'a=1'); throw new Error('x'); }, opts([]))(req, res);
  assert.equal(res.headers['content-type'], undefined);
  assert.equal(res.headers['set-cookie'], undefined);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('erro 4xx do runtime (ApiError Invalid JSON): responde 400 com mensagem fixa, sem erro_nao_tratado', async () => {
  class ApiError extends Error { constructor(s, m) { super(m); this.statusCode = s; } }
  const logs = []; const avisos = [];
  const res = fakeRes();
  await observa('/api/x', () => { throw new ApiError(400, 'Invalid JSON'); }, { ...opts(logs), aviso: (l) => avisos.push(l) })(req, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: { code: 'requisicao_invalida', message: 'Requisição inválida.' } });
  assert.ok(!JSON.stringify(res.body).includes('Invalid JSON'));
  assert.equal(logs.length, 0, 'não é erro não tratado');
  assert.equal(JSON.parse(avisos[0]).evento, 'requisicao_rejeitada');
  // statusCode fora de 4xx continua sendo 500
  const r2 = fakeRes();
  await observa('/api/x', () => { throw Object.assign(new Error('x'), { statusCode: 302 }); }, opts([]))(req, r2);
  assert.equal(r2.statusCode, 500);
});
