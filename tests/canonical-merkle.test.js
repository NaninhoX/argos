import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalize, sha256Hex, hashCanonical } from '../lib/canonical.js';
import { merkleRoot, merkleProof, verifyProof } from '../lib/merkle.js';

test('canônico: ordem das chaves não muda o texto nem o hash', () => {
  const a = { setup: 'RSI_OVERSOLD', prob: 0.2069, params: { tgt: 2, stp: 1, hold: 12, mode: 'atr' } };
  const b = { params: { mode: 'atr', hold: 12, stp: 1, tgt: 2 }, prob: 0.2069, setup: 'RSI_OVERSOLD' };
  assert.equal(canonicalize(a), canonicalize(b));
  assert.equal(canonicalize(a), '{"params":{"hold":12,"mode":"atr","stp":1,"tgt":2},"prob":0.2069,"setup":"RSI_OVERSOLD"}');
  assert.equal(hashCanonical(a), hashCanonical(b));
});

test('canônico: undefined e funções somem de objetos e viram null em arrays', () => {
  assert.equal(canonicalize({ a: 1, b: undefined, c: () => 1 }), '{"a":1}');
  assert.equal(canonicalize([1, undefined, 2]), '[1,null,2]');
});

test('canônico: número não finito é recusado por padrão', () => {
  assert.throws(() => canonicalize({ x: NaN }), TypeError);
  assert.equal(canonicalize({ x: NaN }, { nonFinite: 'null' }), '{"x":null}');
  assert.equal(canonicalize([NaN, -Infinity], { nonFinite: 'tag' }), '["NaN","-Infinity"]');
});

test('canônico: double ida e volta sem perda', () => {
  for (const x of [69130.2, 0.20689655172413793, 1e-7, 123456789.12345678]) assert.equal(JSON.parse(canonicalize(x)), x);
});

test('sha256Hex: vetor conhecido', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

const leaves = Array.from({ length: 9 }, (_, i) => sha256Hex('previsao-' + i));

test('merkle: uma folha tem raiz SHA-256(0x00 || folha)', () => {
  const expected = createHash('sha256').update(Buffer.from([0])).update(Buffer.from(leaves[0], 'hex')).digest('hex');
  assert.equal(merkleRoot([leaves[0]]), expected);
  assert.deepEqual(merkleProof([leaves[0]], 0), []);
});

test('merkle: toda folha prova a raiz, para árvores de 1 a 9 folhas', () => {
  for (let n = 1; n <= leaves.length; n++) {
    const set = leaves.slice(0, n), root = merkleRoot(set);
    for (let i = 0; i < n; i++) assert.ok(verifyProof(set[i], merkleProof(set, i), root), `n=${n} i=${i}`);
  }
});

test('merkle: folha trocada, caminho adulterado ou raiz errada não verificam', () => {
  const root = merkleRoot(leaves), proof = merkleProof(leaves, 4);
  assert.equal(verifyProof(leaves[5], proof, root), false);
  assert.equal(verifyProof(leaves[4], proof, merkleRoot(leaves.slice(0, 8))), false);
  const bad = proof.map((s, k) => (k === 0 ? { ...s, hash: sha256Hex('x') } : s));
  assert.equal(verifyProof(leaves[4], bad, root), false);
});

test('merkle: ordem das folhas muda a raiz; entradas inválidas são recusadas', () => {
  assert.notEqual(merkleRoot(leaves), merkleRoot([...leaves].reverse()));
  assert.throws(() => merkleRoot([]), RangeError);
  assert.throws(() => merkleRoot(['abc']), TypeError);
  assert.throws(() => merkleProof(leaves, 9), RangeError);
});
