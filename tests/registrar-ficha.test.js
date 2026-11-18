// Fichas de pré-registro: hash canônico, conferência contra o .md e carimbo (tools/registrar-ficha.mjs).
// Nenhum teste usa a rede: o calendário é simulado e entra por parâmetro.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { hashCanonical } from '../lib/canonical.js';
import { buildOts, readOts } from '../lib/ots.js';
import { carimbarFicha, conferirFicha, hashDaFicha, hashDoCabecalho, main } from '../tools/registrar-ficha.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(RAIZ, 'docs');
const FICHAS = [
  { nome: 'estudo-combinacoes', prefixo: '76bcee77' },
  { nome: 'estudo-v1.2', prefixo: '98e8e113' },
  { nome: 'estudo-multimercado', prefixo: null } // o prefixo vem do cabeçalho do .md
];
const json = (n) => path.join(DOCS, n + '-pre-registro.json');
const md = (n) => path.join(DOCS, n + '-pre-registro.md');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'argos-registrar-ficha-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ---- calendário falso: append(nonce) -> sha256 -> atestação pendente(uri)
const PENDING = Buffer.from('83dfe30d2ef90c8e', 'hex');
const vb = (b) => Buffer.concat([Buffer.from([b.length]), b]);
const URI = 'https://alice.btc.calendar.opentimestamps.org';
const respostaFalsa = Buffer.concat([Buffer.from([0xf0]), vb(Buffer.from('deadbeef', 'hex')), Buffer.from([0x08, 0x00]), PENDING, vb(vb(Buffer.from(URI)))]);
function stampFalso() {
  const chamadas = [];
  const stamp = async (digest) => {
    chamadas.push(digest);
    return { ots: buildOts(digest, [respostaFalsa]), calendars: [URI], errors: [] };
  };
  return { stamp, chamadas };
}
const semRede = () => { throw new Error('a rede não pode ser chamada'); };
function captura() {
  const out = [];
  const errs = [];
  return { out, errs, io: { log: (s) => out.push(s), err: (s) => errs.push(s) } };
}

for (const { nome, prefixo } of FICHAS) {
  test(`hash e conferir: ficha real ${nome}`, async () => {
    const hash = hashDaFicha(json(nome));
    assert.match(hash, /^[0-9a-f]{64}$/);
    // o hash é o do JSON canonizado por lib/canonical.js
    assert.equal(hash, hashCanonical(JSON.parse(fs.readFileSync(json(nome), 'utf8'))));
    const declarado = hashDoCabecalho(fs.readFileSync(md(nome), 'utf8'));
    assert.match(declarado, /^[0-9a-f]{64}$/);
    assert.ok(hash.startsWith(prefixo ?? declarado.slice(0, 8)), 'prefixo esperado de ' + nome);
    assert.equal(hash, declarado);

    const c = conferirFicha(json(nome), md(nome));
    assert.equal(c.igual, true);

    // pela linha de comando: códigos de saída e saída impressa
    const a = captura();
    assert.equal(await main(['hash', json(nome)], a.io), 0);
    assert.deepEqual(a.out, [hash]);
    const b = captura();
    assert.equal(await main(['conferir', json(nome), '--md', md(nome)], b.io), 0);
    assert.match(b.out[0], /^CONFERE: /);
  });
}

test('conferir falha (saída 1, mensagem clara) com a ficha alterada numa cópia temporária', async () => {
  const copia = path.join(tmp, 'estudo-v1.2-pre-registro.json');
  const original = JSON.parse(fs.readFileSync(json('estudo-v1.2'), 'utf8'));
  fs.writeFileSync(copia, JSON.stringify({ ...original, campo_extra_de_teste: 1 }));
  const c = conferirFicha(copia, md('estudo-v1.2'));
  assert.equal(c.igual, false);
  assert.notEqual(c.calculado, c.declarado);

  const r = captura();
  assert.equal(await main(['conferir', copia, '--md', md('estudo-v1.2')], r.io), 1);
  assert.match(r.errs.join('\n'), /NÃO CONFERE/);
  assert.match(r.errs.join('\n'), new RegExp(c.declarado));
});

test('conferir: .md sem o hash no formato das fichas é erro, não "confere"', async () => {
  const semHash = path.join(tmp, 'sem-hash.md');
  fs.writeFileSync(semHash, '# Ficha\n\nTexto sem hash.\n');
  assert.throws(() => conferirFicha(json('estudo-v1.2'), semHash), /não traz o hash/);
  const r = captura();
  assert.equal(await main(['conferir', json('estudo-v1.2'), '--md', semHash], r.io), 1);
  assert.equal(await main(['conferir', json('estudo-v1.2')], captura().io), 1); // falta --md
});

test('hash: arquivo inexistente e JSON inválido dão saída 1', async () => {
  assert.equal(await main(['hash', path.join(tmp, 'nao-existe.json')], captura().io), 1);
  const ruim = path.join(tmp, 'ruim.json');
  fs.writeFileSync(ruim, '{"a": 1,}');
  assert.equal(await main(['hash', ruim], captura().io), 1);
});

test('carimbar recusa sem --confirmo-rede (e a rede não é chamada)', async () => {
  await assert.rejects(carimbarFicha({ ficha: json('estudo-v1.2'), saida: path.join(tmp, 'a'), stamp: semRede }), /--confirmo-rede/);
  const r = captura();
  assert.equal(await main(['carimbar', json('estudo-v1.2'), '--saida', path.join(tmp, 'a')], { ...r.io, stamp: semRede }), 1);
  assert.match(r.errs.join('\n'), /--confirmo-rede/);
  assert.equal(fs.existsSync(path.join(tmp, 'a')), false);
});

test('carimbar recusa pasta de saída dentro do repositório (e a rede não é chamada)', async () => {
  for (const dentro of [path.join(RAIZ, 'saida-de-teste-recusada'), path.join(DOCS, 'saida-de-teste-recusada'), RAIZ]) {
    await assert.rejects(
      carimbarFicha({ ficha: json('estudo-v1.2'), saida: dentro, confirmoRede: true, stamp: semRede }),
      /fora do repositório/
    );
  }
  assert.equal(fs.existsSync(path.join(RAIZ, 'saida-de-teste-recusada')), false);
  assert.equal(fs.existsSync(path.join(DOCS, 'saida-de-teste-recusada')), false);
});

test('carimbar com --md divergente: recusa antes da rede', async () => {
  const copia = path.join(tmp, 'alterada', 'estudo-v1.2-pre-registro.json');
  fs.mkdirSync(path.dirname(copia));
  const original = JSON.parse(fs.readFileSync(json('estudo-v1.2'), 'utf8'));
  fs.writeFileSync(copia, JSON.stringify({ ...original, campo_extra_de_teste: 1 }));
  const saida = path.join(tmp, 'saida-divergente');
  await assert.rejects(
    carimbarFicha({ ficha: copia, md: md('estudo-v1.2'), saida, confirmoRede: true, stamp: semRede }),
    /não confere com o \.md/
  );
  assert.equal(fs.existsSync(saida), false);
});

test('carimbar com rede falsa grava <nome>.ots e <nome>.sha256 do digest canônico', async () => {
  const saida = path.join(tmp, 'saida-ok');
  const { stamp, chamadas } = stampFalso();
  const r = captura();
  const code = await main(
    ['carimbar', json('estudo-v1.2'), '--saida', saida, '--confirmo-rede', '--md', md('estudo-v1.2')],
    { ...r.io, stamp }
  );
  assert.equal(code, 0, r.errs.join('\n'));
  const hash = hashDaFicha(json('estudo-v1.2'));
  assert.deepEqual(chamadas, [hash]); // um pedido, com o digest canônico
  assert.deepEqual(fs.readdirSync(saida).sort(), ['estudo-v1.2-pre-registro.ots', 'estudo-v1.2-pre-registro.sha256']);
  assert.equal(fs.readFileSync(path.join(saida, 'estudo-v1.2-pre-registro.sha256'), 'utf8'), hash + '\n');
  const recibo = readOts(fs.readFileSync(path.join(saida, 'estudo-v1.2-pre-registro.ots')));
  assert.equal(recibo.digest, hash);
  assert.deepEqual(recibo.attestations.map((a) => a.kind), ['pending']);
  assert.ok(hash.startsWith('98e8e113'));
  assert.match(r.out.join('\n'), /recibo gravado em/);
});

test('carimbar não sobrescreve recibo existente e não chama a rede nesse caso', async () => {
  const saida = path.join(tmp, 'saida-existente');
  const { stamp } = stampFalso();
  await carimbarFicha({ ficha: json('estudo-multimercado'), saida, confirmoRede: true, stamp });
  const antes = fs.readFileSync(path.join(saida, 'estudo-multimercado-pre-registro.ots'));
  await assert.rejects(carimbarFicha({ ficha: json('estudo-multimercado'), saida, confirmoRede: true, stamp: semRede }), /já existe/);
  assert.ok(fs.readFileSync(path.join(saida, 'estudo-multimercado-pre-registro.ots')).equals(antes));
});

test('carimbar recusa recibo de outro digest devolvido pelo calendário', async () => {
  const saida = path.join(tmp, 'saida-outro-digest');
  const outro = createHash('sha256').update('outro').digest('hex');
  const stamp = async () => ({ ots: buildOts(outro, [respostaFalsaDe(outro)]), calendars: [URI], errors: [] });
  await assert.rejects(carimbarFicha({ ficha: json('estudo-v1.2'), saida, confirmoRede: true, stamp }), /outro digest/);
  assert.equal(fs.existsSync(saida), false);
});

// A resposta falsa não depende do digest (a árvore é só operações e atestação), então serve para qualquer um.
function respostaFalsaDe() { return respostaFalsa; }

test('ajuda e subcomando desconhecido', async () => {
  const a = captura();
  assert.equal(await main(['--ajuda'], a.io), 0);
  assert.match(a.out[0], /--confirmo-rede/);
  const b = captura();
  assert.equal(await main(['inventar', 'x'], b.io), 2);
  assert.equal(await main([], captura().io), 2);
  assert.equal(await main(['hash', 'x', '--opcao-inexistente'], captura().io), 2);
});
