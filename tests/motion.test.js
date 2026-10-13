// Fundação do movimento (web/js/motion.js). As funções puras são testadas aqui, sem navegador: o que mais
// importa é que o contador só aceite contagem inteira e termine no texto original.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/js/motion.js', import.meta.url), 'utf8');
const root = {};
new Function('window', 'globalThis', src)(undefined, root);
const M = root.ArgosMotion;

test('motion: modo vem da URL e da preferência do sistema', () => {
  assert.deepEqual(M.parseMode('', false), { mode: 'on', freezeMs: null });
  assert.deepEqual(M.parseMode('', true), { mode: 'off', freezeMs: null });
  assert.deepEqual(M.parseMode('?motion=off', false), { mode: 'off', freezeMs: null });
  assert.deepEqual(M.parseMode('?symbol=BTCUSDT&motion=OFF', false), { mode: 'off', freezeMs: null });
  assert.deepEqual(M.parseMode('?motion=freeze:1200', false), { mode: 'freeze', freezeMs: 1200 });
  // freeze vale mesmo com movimento reduzido: é ferramenta de conferência
  assert.deepEqual(M.parseMode('?motion=freeze:0', true), { mode: 'freeze', freezeMs: 0 });
  // valor desconhecido não liga nem desliga nada
  assert.deepEqual(M.parseMode('?motion=turbo', false), { mode: 'on', freezeMs: null });
  assert.deepEqual(M.parseMode('?motion=freeze:abc', true), { mode: 'off', freezeMs: null });
});

test('motion: contador aceita só contagem inteira', () => {
  assert.deepEqual(M.parseCount('72'), { value: 72, prefix: '', suffix: '' });
  assert.deepEqual(M.parseCount('42.489'), { value: 42489, prefix: '', suffix: '' });
  assert.deepEqual(M.parseCount('N 1.204 gatilhos'), { value: 1204, prefix: 'N ', suffix: ' gatilhos' });
  assert.deepEqual(M.parseCount('0'), { value: 0, prefix: '', suffix: '' });
});

test('motion: contador recusa taxa, p, IC, Brier e qualquer decimal', () => {
  const recusados = ['54,8%', '54,8', '0,003', 'p = 0,003', 'p 0,26', '1.1', 'v1.1', '63%', '12 p.p.', '−3', '-3', '+4', '≤ 5', '= 72',
    '48,1 a 55,2', '8 setups × 9 séries', '007', '', 'sem número', '1.20', '12.3456', '0,2512', 'BSS −0,4%', '9007199254740993'];
  for (const t of recusados) assert.equal(M.parseCount(t), null, JSON.stringify(t));
});

test('motion: o contador nunca passa do alvo e termina exatamente nele, com o texto original', () => {
  for (const text of ['72', '42.489', 'N 1.204 gatilhos', '9']) {
    const c = M.parseCount(text);
    let prev = 0;
    for (let i = 0; i <= 60; i++) {
      const v = M.countAt(c.value, i / 60);
      assert.ok(Number.isInteger(v) && v >= prev && v <= c.value, `${text} em ${i}/60`);
      prev = v;
    }
    assert.equal(M.countAt(c.value, 0), 0);
    assert.equal(c.prefix + M.formatCount(M.countAt(c.value, 1)) + c.suffix, text);
    assert.equal(c.prefix + M.formatCount(M.countAt(c.value, 7)) + c.suffix, text);
  }
});

test('motion: formato pt-BR com ponto de milhar', () => {
  assert.equal(M.formatCount(0), '0');
  assert.equal(M.formatCount(999), '999');
  assert.equal(M.formatCount(1000), '1.000');
  assert.equal(M.formatCount(42489), '42.489');
  assert.equal(M.formatCount(1234567), '1.234.567');
});

test('motion: a digitação do hash é monotônica e termina no texto inteiro', () => {
  let prev = 0;
  for (let i = 0; i <= 40; i++) { const n = M.typedAt(64, i / 40); assert.ok(n >= prev && n <= 64); prev = n; }
  assert.equal(M.typedAt(64, 0), 0);
  assert.equal(M.typedAt(64, 1), 64);
  assert.equal(M.typedAt(64, 3), 64);
});

test('motion: três famílias de duração, dentro das faixas da casa', () => {
  assert.equal(M.DUR.ui, 160);
  assert.ok(M.DUR.reveal >= 240 && M.DUR.reveal <= 360);
  assert.ok(M.DUR.data >= 360 && M.DUR.data <= 480);
});

// Vale para a fundação e para as folhas de movimento que vierem depois (landing-motion.css, platform-motion.css).
test('motion: sem biblioteca externa, sem acaso e sem propriedade que mexa no layout', async () => {
  const { readdirSync } = await import('node:fs');
  const webDir = new URL('../web/', import.meta.url);
  for (const f of readdirSync(new URL('js/', webDir)).filter((n) => /motion/.test(n))) {
    const js = readFileSync(new URL('js/' + f, webDir), 'utf8');
    assert.doesNotMatch(js, /Math\.random|https?:\/\//, f);
  }
  const LAYOUT = /(^|[\s,])(width|height|top|left|right|bottom|margin|padding|all|max-height|max-width|font-size|line-height|grid|flex|gap)([\s,-]|$)/;
  for (const f of readdirSync(new URL('css/', webDir)).filter((n) => /motion/.test(n))) {
    const css = readFileSync(new URL('css/' + f, webDir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/transition(?:-property)?:\s*([^;}]+)/g)) assert.doesNotMatch(m[1], LAYOUT, `${f}: ${m[0]}`);
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
      for (const block of m[2].matchAll(/\{([^{}]*)\}/g)) {
        for (const d of block[1].matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)) assert.ok(['opacity', 'transform', 'stroke-dashoffset', 'visibility'].includes(d[1]), `${f}: ${d[1]} em @keyframes ${m[1]}`);
      }
    }
  }
});
