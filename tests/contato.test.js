// Formulário de contato (web/js/contato.js): validação e montagem do mailto:. O módulo é um script clássico do navegador;
// aqui ele roda sem DOM (new Function com `window`), como em url-state.test.js. Casos: válidos, inválidos e hostis.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'web', 'js', 'contato.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const { validate, buildMailto, buildMessage } = win.ArgosContato;

const OK = { assunto: 'acesso', nome: 'Ana Souza', email: 'Ana@Empresa.com.br', perfil: 'investidor', organizacao: '', mensagem: '' };

test('contato: o módulo expõe só validate, buildMessage e buildMailto', () => {
  assert.deepEqual(Object.keys(win.ArgosContato).sort(), ['buildMailto', 'buildMessage', 'validate']);
});

test('contato: aceita o mínimo (nome, e-mail, perfil) e normaliza o e-mail', () => {
  const r = validate(OK);
  assert.equal(r.ok, true);
  assert.equal(r.value.email, 'ana@empresa.com.br');
  assert.deepEqual(r.errors, {});
});

test('contato: campo obrigatório vazio, e-mail incompleto e perfil fora da lista', () => {
  const r = validate({ ...OK, nome: '   ', email: 'ana@empresa', perfil: 'hacker' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'nome', 'perfil']);
});

test('contato: limites de tamanho', () => {
  assert.equal(validate({ ...OK, nome: 'a'.repeat(121) }).errors.nome !== undefined, true);
  assert.equal(validate({ ...OK, mensagem: 'a'.repeat(801) }).errors.mensagem !== undefined, true);
  assert.equal(validate({ ...OK, mensagem: 'a'.repeat(800) }).ok, true);
});

test('contato: barra senha, chave, CPF e cartão no texto', () => {
  for (const m of ['minha senha: abc123', 'api_key sk-abcdefghijklmnop1234', 'meu cpf 123.456.789-09', 'cartão 4111 1111 1111 1111']) {
    assert.equal(validate({ ...OK, mensagem: m }).ok, false, m);
  }
  assert.equal(validate({ ...OK, mensagem: 'Quero ver a calibração do BTC 4h.' }).ok, true);
});

test('contato: entrada hostil (tipos errados, protótipo) não lança e não passa', () => {
  for (const x of [undefined, null, 'texto', 42, [], { __proto__: { nome: 'x' } }, { nome: {}, email: [], perfil: 7, mensagem: 9 }]) {
    const r = validate(x);
    assert.equal(r.ok, false);
  }
  assert.equal(validate({ ...OK, assunto: '__proto__' }).value.assunto, 'acesso');
  assert.equal(validate({ ...OK, perfil: 'constructor' }).ok, false);
});

test('contato: mailto só com destino simples e dados só no corpo', () => {
  const v = validate({ ...OK, assunto: 'analista', organizacao: 'Fundo X', mensagem: 'Linha 1\nLinha 2' }).value;
  const url = buildMailto('contato@stratum.example', v);
  assert.match(url, /^mailto:contato@stratum\.example\?subject=/);
  assert.equal((url.match(/\?/g) || []).length, 1);
  const body = decodeURIComponent(url.split('&body=')[1]);
  assert.match(body, /Nome: Ana Souza/);
  assert.match(body, /Linha 1\r\nLinha 2/);
  assert.match(decodeURIComponent(url), /conversa com um analista/);
  for (const bad of ['', 'sem-arroba', 'a@b.com,outro@x.com', 'a@b.com?cc=x@y.com', 'a b@c.com', 'a@b.com\r\nbcc:x@y.com', undefined, null, 5]) {
    assert.equal(buildMailto(bad, v), '', String(bad));
  }
});

test('contato: injeção de cabeçalho no nome vira texto do corpo, nunca cabeçalho', () => {
  const v = validate({ ...OK, nome: 'Ana\r\nBcc: x@y.com' }).value;
  assert.equal(v.nome.includes('\n'), false);
  const url = buildMailto('contato@stratum.example', v);
  assert.equal(/[?&]bcc=/i.test(url), false);
  assert.equal(url.includes('\n') || url.includes('\r'), false);
  assert.match(buildMessage(v), /Nome: Ana Bcc: x@y\.com/);
});
