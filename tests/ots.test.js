// Cliente OpenTimestamps: formato do recibo, junção de calendários e complemento com atestação Bitcoin.
// Nenhum teste usa a rede: os calendários são simulados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { HEADER_MAGIC, OtsError, buildOts, readOts, stampDigest, upgradeOts } from '../lib/ots.js';

const sha = (b) => createHash('sha256').update(b).digest();
const DIGEST = sha('manifesto de teste').toString('hex');
const PENDING = Buffer.from('83dfe30d2ef90c8e', 'hex');
const BITCOIN = Buffer.from('0588960d73d71901', 'hex');
const vb = (b) => Buffer.concat([Buffer.from([b.length]), b]); // só para campos com menos de 128 bytes

/** Resposta de calendário: append(nonce) → sha256 → atestação pendente(uri). */
function calendarResponse(nonce, uri) {
  return Buffer.concat([Buffer.from([0xf0]), vb(nonce), Buffer.from([0x08, 0x00]), PENDING, vb(vb(Buffer.from(uri)))]);
}
const commitmentOf = (nonce) => sha(Buffer.concat([Buffer.from(DIGEST, 'hex'), nonce])).toString('hex');

const ALICE = 'https://alice.btc.calendar.opentimestamps.org';
const BOB = 'https://bob.btc.calendar.opentimestamps.org';
const N1 = Buffer.from('deadbeef', 'hex');
const N2 = Buffer.from('0badcafe', 'hex');

const fakeFetch = (routes) => async (url, init) => {
  const hit = routes[url];
  if (!hit) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  if (hit instanceof Error) throw hit;
  const body = typeof hit === 'function' ? hit(init) : hit;
  return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
};

test('recibo de um calendário: cabeçalho, digest e atestação pendente com o compromisso certo', () => {
  const ots = buildOts(DIGEST, [calendarResponse(N1, ALICE)]);
  assert.ok(ots.subarray(0, HEADER_MAGIC.length).equals(HEADER_MAGIC));
  assert.equal(ots[HEADER_MAGIC.length], 1);
  assert.equal(ots[HEADER_MAGIC.length + 1], 0x08);
  assert.equal(ots.subarray(HEADER_MAGIC.length + 2, HEADER_MAGIC.length + 34).toString('hex'), DIGEST);
  const info = readOts(ots);
  assert.equal(info.digest, DIGEST);
  assert.deepEqual(info.attestations, [{ kind: 'pending', uri: ALICE, commitment: commitmentOf(N1) }]);
});

test('dois calendários viram dois ramos (0xff) e relido dá o mesmo recibo', () => {
  const ots = buildOts(DIGEST, [calendarResponse(N1, ALICE), calendarResponse(N2, BOB)]);
  assert.equal(ots[HEADER_MAGIC.length + 34], 0xff);
  const info = readOts(ots);
  assert.deepEqual(info.attestations.map((a) => a.uri), [ALICE, BOB]);
  // resposta que já chega bifurcada na raiz também se junta, e resposta repetida não duplica
  const forked = buildOts(DIGEST, [info.timestamp, calendarResponse(N1, ALICE)]);
  assert.ok(forked.equals(ots));
});

test('resposta que não é carimbo é recusada', () => {
  assert.throws(() => buildOts(DIGEST, [Buffer.from('<html>erro</html>')]), OtsError);
  assert.throws(() => buildOts(DIGEST, [Buffer.concat([calendarResponse(N1, ALICE), Buffer.from([0x00])])]), /sobrando/);
  assert.throws(() => buildOts(DIGEST, [calendarResponse(N1, ALICE).subarray(0, 10)]), /truncado/);
  assert.throws(() => buildOts(DIGEST, []), OtsError);
  assert.throws(() => buildOts('abc', [calendarResponse(N1, ALICE)]), TypeError);
  assert.throws(() => readOts(Buffer.from('nada')), /não é um recibo/);
});

test('stampDigest envia os 32 bytes a /digest, aceita falha parcial e recusa falha total', async () => {
  const sent = [];
  const fetchImpl = fakeFetch({
    'https://a.test/digest': (init) => { sent.push(init); return calendarResponse(N1, ALICE); },
    'https://b.test/digest': new Error('fora do ar'),
    'https://c.test/digest': Buffer.from('lixo')
  });
  const out = await stampDigest(DIGEST, { calendars: ['https://a.test/', 'https://b.test', 'https://c.test'], fetchImpl });
  assert.deepEqual(out.calendars, ['https://a.test/']);
  assert.deepEqual(out.errors.map((e) => e.calendar), ['https://b.test', 'https://c.test']);
  assert.equal(sent[0].method, 'POST');
  assert.equal(Buffer.from(sent[0].body).toString('hex'), DIGEST);
  assert.equal(readOts(out.ots).attestations.length, 1);

  await assert.rejects(stampDigest(DIGEST, { calendars: ['https://b.test'], fetchImpl }), (e) => e instanceof OtsError && e.errors.length === 1);
});

test('upgradeOts incorpora a atestação Bitcoin, mantém pendente o que não chegou e não consulta URL fora da lista', async () => {
  const EVIL = 'https://exemplo.invalid';
  const ots = buildOts(DIGEST, [calendarResponse(N1, ALICE), calendarResponse(N2, BOB), calendarResponse(Buffer.from('01', 'hex'), EVIL)]);
  const asked = [];
  // alice: prepend(prefixo) → sha256 → atestação Bitcoin na altura 300 (varuint de dois bytes: 0xac 0x02)
  const tail = Buffer.concat([Buffer.from([0xf1]), vb(Buffer.from('aa55', 'hex')), Buffer.from([0x08, 0x00]), BITCOIN, vb(Buffer.from([0xac, 0x02]))]);
  const routes = { [ALICE + '/timestamp/' + commitmentOf(N1)]: tail };
  const fetchImpl = async (url, init) => { asked.push(url); return fakeFetch(routes)(url, init); };

  const up = await upgradeOts(ots, { fetchImpl });
  assert.equal(up.changed, true);
  assert.equal(up.confirmed, true);
  assert.deepEqual(asked.sort(), [ALICE + '/timestamp/' + commitmentOf(N1), BOB + '/timestamp/' + commitmentOf(N2)].sort());
  assert.deepEqual(up.errors, [{ calendar: EVIL, message: 'calendário fora da lista permitida' }]);
  const kinds = readOts(up.ots).attestations.map((a) => a.kind).sort();
  assert.deepEqual(kinds, ['bitcoin', 'pending', 'pending', 'pending']);
  assert.equal(readOts(up.ots).attestations.find((a) => a.kind === 'bitcoin').height, 300);

  // rodar de novo com os calendários em silêncio não muda nada
  const again = await upgradeOts(up.ots, { fetchImpl: fakeFetch({}) });
  assert.equal(again.changed, false);
  assert.equal(again.confirmed, true);
  assert.ok(again.ots.equals(up.ots));
});
