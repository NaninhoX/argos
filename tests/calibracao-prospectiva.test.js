// Calibração prospectiva interna (lib/calibracao-prospectiva.js): mesmo cálculo do motor, com o ECE de acaso ao lado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationReport } from '../lib/calibracao-prospectiva.js';

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** n previsões com p entre 15% e 45%; o resultado sai com probabilidade truth(p). */
function synth(n, truth, seed = 3) {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () => { const p = 0.15 + 0.3 * rnd(); return { p, r: 0.26, o: rnd() < truth(p) ? 1 : 0 }; });
}

test('abaixo de 30 resolvidas: insuficiente, sem ECE, BSS nem faixa de acaso', () => {
  const r = calibrationReport(synth(29, (p) => p));
  assert.equal(r.verdict, 'insuficiente');
  assert.equal(r.n, 29);
  assert.equal(r.ece, null);
  assert.equal(r.bss, null);
  assert.equal(r.noise, null);
  assert.match(r.note, /29 de 30/);
});

test('motor perfeitamente calibrado: o ECE observado fica dentro da faixa de acaso, mesmo com N moderado', () => {
  const r = calibrationReport(synth(140, (p) => p));
  assert.equal(r.n, 140);
  assert.ok(r.noise.eceMedian > 0.02, 'com N = 140 o acaso sozinho já dá ECE de alguns pontos: ' + r.noise.eceMedian);
  assert.ok(r.noise.eceP90 > r.noise.eceMedian);
  assert.equal(r.verdict, 'dentro_do_acaso', JSON.stringify({ ece: r.ece, p90: r.noise.eceP90 }));
  assert.match(r.note, /sem evidência de descalibração/);
});

test('motor muito descalibrado (acerta metade do que prevê): fica acima do acaso', () => {
  const r = calibrationReport(synth(400, (p) => Math.min(1, p * 0.4 + 0.02)));
  assert.equal(r.verdict, 'acima_do_acaso', JSON.stringify({ ece: r.ece, p90: r.noise.eceP90 }));
  assert.ok(r.ece > r.noise.eceP90);
});

test('faixas com poucos casos vêm marcadas como não confiáveis; resultado é reprodutível (semente fixa)', () => {
  const preds = synth(60, (p) => p);
  const a = calibrationReport(preds), b = calibrationReport(preds);
  assert.deepEqual(a.noise, b.noise, 'mesma entrada, mesma faixa de acaso');
  assert.ok(a.bins.length >= 2);
  for (const bin of a.bins) assert.equal(bin.reliable, bin.n >= 30);
  assert.ok(a.bins.some((x) => !x.reliable), 'com 60 previsões espalhadas em várias faixas, alguma faixa tem menos de 30');
});

test('TIMEOUT e LOSS contam como o = 0 (como no motor): quem mapeia é o handler, aqui só o contrato dos pares', () => {
  const allWin = Array.from({ length: 40 }, () => ({ p: 0.3, r: 0.26, o: 1 }));
  const r = calibrationReport(allWin);
  assert.ok(r.ece > 0.6, 'prever 30% e acertar sempre é muito descalibrado: ' + r.ece);
});
