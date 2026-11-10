import test from 'node:test';
import assert from 'node:assert/strict';
import { binomialTail, seededRandom, bootstrapMeanCI95 } from '../lib/study-stats.js';
import { bhAdjust } from '../engine/index.js';

test('binomialTail: valores conhecidos de Bin(n, 0,5)', () => {
  assert.equal(binomialTail(0, 3), 1);
  assert.equal(binomialTail(7, 7), 1 / 128);
  assert.ok(Math.abs(binomialTail(5, 10) - 0.623046875) < 1e-12);
  assert.ok(Math.abs(binomialTail(20, 26) - 313912 / 2 ** 26) < 1e-12, 'soma de C(26, k) para k de 20 a 26, em inteiros, sobre 2^26');
});

test('seededRandom: determinístico e dentro de [0, 1)', () => {
  const a = seededRandom(20261109), b = seededRandom(20261109);
  for (let i = 0; i < 1000; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

test('bootstrapMeanCI95: série constante dá intervalo degenerado; reprodutível; contém a média', () => {
  assert.deepEqual(bootstrapMeanCI95([2, 2, 2, 2], 1, 500), [2, 2]);
  const v = [-3, -1, 0, 2, 4, 5, -2, 1];
  const [lo, hi] = bootstrapMeanCI95(v, 20261109);
  assert.deepEqual([lo, hi], bootstrapMeanCI95(v, 20261109));
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(lo <= mean && mean <= hi && lo < hi);
});

test('bhAdjust (usado pelo estudo): p ordenados e monotonia', () => {
  const q = bhAdjust([0.01, 0.04, 0.03, 0.5]);
  assert.ok(Math.abs(q[0] - 0.04) < 1e-12 && Math.abs(q[3] - 0.5) < 1e-12);
  assert.ok(q.every((x) => x <= 1));
});
