// Mapa setup × regime (web/js/heatmap.js): script clássico do navegador, carregado aqui sem DOM.
// Confere o modelo (8 linhas × 5 colunas, diferença em p.p., os quatro estados) em células reais de BTCUSDT 4h e
// SOLUSDT 1d, recalculadas de forma independente a partir do resultado do motor, e a escala de cor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as engine from '../engine/index.js';
import { hashCanonical } from '../lib/canonical.js';
import { snapshotSeries } from '../lib/data/series.js';
import { regimeView } from '../lib/regime-view.js';

const CFG = Object.freeze({ mode: 'atr', tgt: 2, stp: 1, hold: 12 });
const SRC = fs.readFileSync(new URL('../web/js/heatmap.js', import.meta.url), 'utf8');

/** Executa o script como o navegador faria: sem document, com `window` e `module` fornecidos. */
function loadHeatmap() {
  const win = {};
  const mod = { exports: {} };
  new Function('window', 'module', SRC)(win, mod);
  return { win, mod };
}
const { win, mod } = loadHeatmap();
const H = mod.exports;

const cache = new Map();
function setupFor(sym, tf) {
  const k = `${sym}_${tf}`;
  if (!cache.has(k)) {
    const A = engine.analyze(snapshotSeries(sym, tf), { ...CFG }, { sym, tf });
    const view = regimeView(engine, A);
    cache.set(k, { A, view, m: H.model(engine, A, view) });
  }
  return cache.get(k);
}

const cellOf = (m, setupId, regime) => m.rows.find((r) => r.id === setupId).cells.find((c) => c.regime === regime);

// ---- cor (sem DOM) -------------------------------------------------------------------------------------------
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test('mapa setup × regime: o script expõe model, colorFor e render e carrega sem DOM', () => {
  assert.equal(win.ArgosHeatmap, H, 'window.ArgosHeatmap é o mesmo objeto de module.exports');
  for (const f of ['model', 'colorFor', 'render']) assert.equal(typeof H[f], 'function', f);
  assert.deepEqual(Object.keys(H).sort(), ['colorFor', 'model', 'render']);
});

test('mapa setup × regime: colorFor é simétrica (mesma intensidade, lados opostos, mesma luminância)', () => {
  for (const x of [0.2, 1, 3.3, 7.5, 12, 14.99, 15, 22, 100]) {
    const a = H.colorFor(x), b = H.colorFor(-x);
    assert.equal(a.t, b.t, `intensidade de ±${x}`);
    assert.equal(a.side, 'acima');
    assert.equal(b.side, 'abaixo');
    const dl = Math.abs(lum(rgbOf(a.bg)) - lum(rgbOf(b.bg)));
    assert.ok(dl < 0.012, `luminância de ±${x} difere ${dl.toFixed(4)}`);
  }
  const z = H.colorFor(0);
  assert.equal(z.side, 'neutro');
  assert.equal(z.t, 0);
  // azul acima, laranja abaixo (nos extremos, onde a matiz é inequívoca)
  const up = hsl(rgbOf(H.colorFor(15).bg)), down = hsl(rgbOf(H.colorFor(-15).bg));
  assert.ok(up.h >= 200 && up.h <= 235, `azul: matiz ${up.h}`);
  assert.ok(down.h >= 10 && down.h <= 45, `laranja: matiz ${down.h}`);
});

test('mapa setup × regime: colorFor satura no teto fixo de 15 p.p. e cresce até ele', () => {
  assert.equal(H.colorFor(15).bg, H.colorFor(15.0001).bg);
  assert.equal(H.colorFor(15).bg, H.colorFor(40).bg);
  assert.equal(H.colorFor(15).bg, H.colorFor(1e6).bg);
  assert.equal(H.colorFor(-15).bg, H.colorFor(-40).bg);
  assert.equal(H.colorFor(15).t, 1);
  assert.equal(H.colorFor(-15).t, 1);
  assert.notEqual(H.colorFor(14).bg, H.colorFor(15).bg);
  assert.notEqual(H.colorFor(-14).bg, H.colorFor(-15).bg);
  let prev = -1;
  for (let x = 0; x <= 15; x += 0.5) {
    const t = H.colorFor(x).t;
    assert.ok(t > prev || (x === 0 && t === 0), `intensidade cresce com a diferença (${x})`);
    prev = t;
  }
  // o teto é parâmetro, mas o padrão é 15
  assert.equal(H.colorFor(7.5).t, 0.5);
  assert.equal(H.colorFor(7.5, 7.5).t, 1);
});

test('mapa setup × regime: colorFor nunca devolve verde nem vermelho e o texto tem contraste AA', () => {
  const light = rgbOf('#f5f2ea'), dark = rgbOf('#0d1420');
  for (let x = -40; x <= 40; x += 0.25) {
    const c = H.colorFor(x);
    assert.match(c.bg, /^#[0-9a-f]{6}$/);
    const { h, s } = hsl(rgbOf(c.bg));
    if (s >= 0.12) {
      const azul = h >= 200 && h <= 235, laranja = h >= 8 && h <= 45;
      assert.ok(azul || laranja, `${x} p.p. deu ${c.bg} (matiz ${h.toFixed(0)}, saturação ${s.toFixed(2)})`);
      assert.ok(!(h >= 60 && h <= 180), 'sem verde');
      assert.ok(!(h <= 5 || h >= 350), 'sem vermelho');
    }
    const fg = rgbOf(c.fg);
    assert.ok(contrast(rgbOf(c.bg), fg) >= 4.5, `${x} p.p.: contraste do texto ${contrast(rgbOf(c.bg), fg).toFixed(2)}`);
    assert.ok([light, dark].some((k) => k.join() === fg.join()), 'texto é um dos dois tons de tinta');
  }
  assert.equal(H.colorFor(NaN), null);
  assert.equal(H.colorFor(undefined), null);
  assert.equal(H.colorFor(null), null);
  assert.equal(H.colorFor(Infinity), null);
});

// ---- modelo, em séries reais -----------------------------------------------------------------------------------
for (const [sym, tf] of [['BTCUSDT', '4h'], ['SOLUSDT', '1d']]) {
  test(`mapa ${sym} ${tf}: 8 linhas × 5 colunas, na ordem do motor, com o regime atual marcado`, () => {
    const { A, view, m } = setupFor(sym, tf);
    assert.equal(m.rows.length, 8);
    assert.equal(m.columns.length, 5);
    assert.equal(m.total, 40);
    assert.deepEqual(m.rows.map((r) => r.id), A.setups.map((s) => s.id));
    assert.deepEqual(m.rows.map((r) => r.nome), A.setups.map((s) => s.nome));
    assert.deepEqual(m.columns.map((c) => c.code), view.regimes);
    assert.deepEqual(m.columns.map((c) => c.label), view.regimes.map((r) => engine.REGIMES[r].label));
    assert.deepEqual(m.columns.map((c) => c.short), view.regimes.map((r) => engine.REGIMES[r].short));
    for (const row of m.rows) {
      assert.equal(row.cells.length, 5);
      assert.deepEqual(row.cells.map((c) => c.regime), view.regimes);
      assert.ok(row.cells.every((c) => c.setupId === row.id));
    }
    assert.equal(m.current, A.tech.regime.regime);
    assert.deepEqual(m.columns.filter((c) => c.current).map((c) => c.code), [m.current], 'só o regime atual é marcado');
    // a taxa-base de cada coluna é a das entradas aleatórias do motor naquele regime
    for (const col of m.columns) {
      const idx = A.base.idx.filter((i) => A.reg[i].regime === col.code);
      assert.equal(col.base.n, idx.length);
      assert.equal(col.base.rate, idx.filter((i) => A.outs[i].type === 'WIN').length / idx.length);
    }
  });

  test(`mapa ${sym} ${tf}: deltaPP = (taxa de acerto − taxa-base do regime) × 100, recalculado do motor`, () => {
    const { A, m } = setupFor(sym, tf);
    for (const row of m.rows) {
      const s = A.setups.find((x) => x.id === row.id);
      for (const cell of row.cells) {
        const eng = s.byRegime[cell.regime] || { n: 0, w: 0 };
        const idx = A.base.idx.filter((i) => A.reg[i].regime === cell.regime);
        const baseRate = idx.filter((i) => A.outs[i].type === 'WIN').length / idx.length;
        const where = `${row.id} ${cell.regime}`;
        assert.equal(cell.n, eng.n, `${where}: N`);
        assert.equal(cell.base.rate, baseRate, `${where}: taxa-base`);
        if (!eng.n) { assert.equal(cell.deltaPP, null, `${where}: vazia não tem diferença`); continue; }
        assert.equal(cell.rate, eng.w / eng.n, `${where}: taxa de acerto`);
        assert.equal(cell.deltaPP, (eng.w / eng.n - baseRate) * 100, `${where}: deltaPP`);
      }
    }
  });

  test(`mapa ${sym} ${tf}: os quatro estados seguem as regras (N efetivo < 10, IC contém a taxa-base, sem gatilho)`, () => {
    const { A, m } = setupFor(sym, tf);
    const seen = new Set();
    for (const row of m.rows) {
      const s = A.setups.find((x) => x.id === row.id);
      for (const cell of row.cells) {
        const idx = s.triggers.filter((i) => A.outs[i] && A.reg[i].regime === cell.regime);
        const wins = idx.filter((i) => A.outs[i].type === 'WIN').length;
        const nEff = engine.effectiveN(idx.map((i) => A.outs[i].ret)).nEff;
        const where = `${row.id} ${cell.regime}`;
        let want;
        if (!idx.length) want = 'vazia';
        else if (nEff < 10) want = 'insuficiente';
        else {
          const ci = nEff < 25 ? (() => { const b = engine.bayesWR(wins, idx.length); return [b.lo, b.hi]; })() : engine.wilson(wins, idx.length);
          want = ci[0] <= cell.base.rate && cell.base.rate <= ci[1] ? 'esmaecida' : 'cheia';
          assert.deepEqual(cell.ci, ci, `${where}: IC`);
          assert.equal(cell.method, nEff < 25 ? 'bayes_beta_binomial' : 'wilson', `${where}: método`);
          assert.equal(cell.ciContainsBase, want === 'esmaecida', `${where}: IC contém a base`);
        }
        assert.equal(cell.state, want, `${where}: estado`);
        assert.equal(cell.nEff, idx.length ? nEff : 0, `${where}: N efetivo`);
        seen.add(cell.state);
      }
    }
    assert.deepEqual([...seen].sort(), ['cheia', 'esmaecida', 'insuficiente', 'vazia'], 'a série real traz os quatro estados');
  });

  test(`mapa ${sym} ${tf}: só cheia e esmaecida recebem cor; a esmaecida é a mesma cor misturada ao fundo`, () => {
    const { m } = setupFor(sym, tf);
    for (const row of m.rows) for (const c of row.cells) {
      const where = `${row.id} ${c.regime} (${c.state})`;
      if (c.state === 'insuficiente' || c.state === 'vazia') {
        assert.equal(c.color, null, `${where}: sem cor`);
        assert.equal(c.fill, null, `${where}: sem preenchimento`);
        assert.equal(c.fg, null, `${where}: sem tinta própria`);
        continue;
      }
      assert.deepEqual(c.color, H.colorFor(c.deltaPP), `${where}: cor da escala`);
      if (c.state === 'cheia') assert.equal(c.fill, c.color.bg, `${where}: cor cheia`);
      else {
        assert.notEqual(c.fill, c.color.bg, `${where}: esmaecida difere da cheia`);
        const panel = lum([16, 25, 39]);
        // esmaecida fica entre o fundo do cartão e a cor da escala em luminância
        const lf = lum(rgbOf(c.fill)), lc = lum(rgbOf(c.color.bg));
        assert.ok(lf >= Math.min(panel, lc) - 1e-9 && lf <= Math.max(panel, lc) + 1e-9, `${where}: luminância entre o fundo e a cor`);
      }
      assert.ok(contrast(rgbOf(c.fill), rgbOf(c.fg)) >= 4.5, `${where}: contraste do texto`);
    }
  });

  test(`mapa ${sym} ${tf}: cada célula traz descrição acessível com setup, regime, N, N efetivo, taxa, IC, método e taxa-base`, () => {
    const { m } = setupFor(sym, tf);
    for (const row of m.rows) for (const c of row.cells) {
      const col = m.columns.find((x) => x.code === c.regime);
      assert.ok(c.label.startsWith(`${row.nome}, ${col.label}`), `${row.id} ${c.regime}: abre com setup e regime`);
      assert.ok(c.label.includes('Taxa-base do regime') || c.label.includes('taxa-base do regime'), 'cita a taxa-base do regime');
      if (c.state === 'vazia') { assert.ok(c.label.includes('sem gatilhos')); continue; }
      assert.ok(c.label.includes(`N ${c.n.toLocaleString('pt-BR')};`), 'N');
      assert.ok(c.label.includes(`N efetivo ${c.nEff.toLocaleString('pt-BR')}`), 'N efetivo');
      assert.ok(/taxa de acerto \d+,\d%/.test(c.label), 'taxa de acerto em pt-BR');
      assert.ok(/IC 95% de \d+,\d% a \d+,\d%/.test(c.label), 'IC 95%');
      assert.ok(c.label.includes(c.method === 'wilson' ? '(Wilson)' : '(Bayes Beta-Binomial)'), 'método do IC');
      if (c.state === 'insuficiente') assert.ok(c.label.includes('evidência insuficiente'));
      if (c.state === 'cheia') assert.ok(c.label.includes('exclui a taxa-base'));
      if (c.state === 'esmaecida') assert.ok(c.label.includes('contém a taxa-base'));
      assert.ok(!c.label.includes(String.fromCharCode(0x2013)) && !c.label.includes(String.fromCharCode(0x2014)), 'sem travessão');
    }
  });
}

test('mapa BTCUSDT 4h: células reais em cada estado', () => {
  const { m } = setupFor('BTCUSDT', '4h');
  const macd = cellOf(m, 'MACD_CROSS', 'LOW_VOL_RANGING'); // IC exclui a base, acima dela
  assert.equal(macd.state, 'cheia');
  assert.ok(macd.deltaPP > 7 && macd.deltaPP < 8);
  assert.equal(macd.color.side, 'acima');
  const bb = cellOf(m, 'BB_LOWER', 'BULL_TREND'); // IC exclui a base, abaixo dela, além do teto
  assert.equal(bb.state, 'cheia');
  assert.ok(bb.deltaPP < -15);
  assert.equal(bb.color.side, 'abaixo');
  assert.equal(bb.color.t, 1, 'além do teto de 15 p.p. a cor satura');
  const rsi = cellOf(m, 'RSI_OVERSOLD', 'BULL_TREND'); // IC contém a base
  assert.equal(rsi.state, 'esmaecida');
  assert.ok(rsi.ci[0] <= rsi.base.rate && rsi.base.rate <= rsi.ci[1]);
  const few = cellOf(m, 'RSI_OVERSOLD', 'LOW_VOL_RANGING'); // 4 gatilhos
  assert.equal(few.state, 'insuficiente');
  assert.ok(few.nEff < 10 && few.n > 0);
  assert.ok(few.deltaPP > 20, 'a diferença existe, mas a célula não leva cor');
  assert.equal(few.color, null);
  const none = cellOf(m, 'EMA_PULLBACK', 'BEAR_TREND'); // nenhum gatilho
  assert.equal(none.state, 'vazia');
  assert.equal(none.n, 0);
  assert.equal(none.deltaPP, null);
});

test('mapa SOLUSDT 1d: células reais em cada estado', () => {
  const { m } = setupFor('SOLUSDT', '1d');
  assert.equal(cellOf(m, 'BREAKOUT_20', 'LOW_VOL_RANGING').state, 'cheia');
  assert.equal(cellOf(m, 'BB_LOWER', 'LOW_VOL_RANGING').state, 'cheia');
  assert.equal(cellOf(m, 'BULL_ENGULFING', 'BULL_TREND').state, 'esmaecida');
  assert.equal(cellOf(m, 'MACD_CROSS', 'BULL_TREND').state, 'insuficiente'); // 11 gatilhos, N efetivo 7
  assert.equal(cellOf(m, 'GOLDEN_CROSS', 'BEAR_TREND').state, 'vazia');
  // IC contém a taxa-base mesmo com diferença grande (+16,9 p.p.), porque o N efetivo é pequeno: não ganha cor cheia
  const wide = cellOf(m, 'MACD_CROSS', 'LOW_VOL_RANGING');
  assert.equal(wide.state, 'esmaecida');
  assert.ok(wide.deltaPP > 15);
});

test('mapa: contagem de recortes comparáveis e dos que excluem a taxa-base (usada na nota)', () => {
  for (const [sym, tf] of [['BTCUSDT', '4h'], ['SOLUSDT', '1d']]) {
    const { m } = setupFor(sym, tf);
    const cells = m.rows.flatMap((r) => r.cells);
    assert.equal(m.compared, cells.filter((c) => c.state === 'cheia' || c.state === 'esmaecida').length);
    assert.equal(m.excluding, cells.filter((c) => c.state === 'cheia').length);
    assert.ok(m.excluding <= m.compared && m.compared <= m.total);
  }
});

test('mapa: fronteira do IC e taxa-base ausente (modelo sintético)', () => {
  const A = { setups: [{ id: 'X', nome: 'Setup X', grupo: 'Grupo' }] };
  const mk = (ci, base, extra = {}) => ({
    regimes: ['BULL_TREND'], current: 'BULL_TREND',
    bySetup: { X: { BULL_TREND: { n: 40, wins: 20, winRate: 0.5, ci, method: 'wilson', nEff: 40, base: { rate: base, n: 500 }, insufficient: false, ...extra } } }
  });
  const stateOf = (view) => H.model(engine, A, view).rows[0].cells[0];
  assert.equal(stateOf(mk([0.4, 0.6], 0.4)).state, 'esmaecida', 'base no limite inferior do IC: contida');
  assert.equal(stateOf(mk([0.4, 0.6], 0.6)).state, 'esmaecida', 'base no limite superior do IC: contida');
  assert.equal(stateOf(mk([0.4, 0.6], 0.3999)).state, 'cheia');
  assert.equal(stateOf(mk([0.4, 0.6], 0.6001)).state, 'cheia');
  const noBase = stateOf(mk([0.4, 0.6], NaN));
  assert.equal(noBase.state, 'esmaecida', 'sem taxa-base no regime não há exclusão a afirmar');
  assert.equal(noBase.deltaPP, null);
  assert.equal(noBase.color, null);
  assert.equal(noBase.fill, null);
  assert.ok(noBase.label.includes('Não há taxa-base neste regime'));
  // N efetivo 9 com 40 gatilhos: insuficiente mesmo com IC estreito e longe da base
  const few = stateOf(mk([0.45, 0.55], 0.2, { nEff: 9 }));
  assert.equal(few.state, 'insuficiente');
  assert.equal(few.color, null);
  // N efetivo 10 já é suficiente (corte do motor)
  assert.equal(stateOf(mk([0.45, 0.55], 0.2, { nEff: 10 })).state, 'cheia');
});

test('mapa: entradas inválidas devolvem matriz vazia sem lançar erro', () => {
  for (const [A, v] of [[null, null], [{}, null], [{ setups: [] }, null], [{ setups: [{ id: 'X' }] }, { regimes: 'x' }]]) {
    const m = H.model(engine, A, v);
    assert.deepEqual([m.rows.length, m.columns.length, m.total], [0, 0, 0]);
  }
});

test('mapa: o modelo não altera a análise nem o recorte e é determinístico', () => {
  const { A, view } = setupFor('BTCUSDT', '4h');
  const h = (v) => hashCanonical(v, { nonFinite: 'tag' });
  const before = h({ view, setups: A.setups, base: A.base, reg: A.reg, outs: A.outs });
  const a = H.model(engine, A, view), b = H.model(engine, A, view);
  assert.equal(h(a), h(b));
  assert.equal(h({ view, setups: A.setups, base: A.base, reg: A.reg, outs: A.outs }), before);
});

// ---- desenho e cartão da dica, sem navegador: DOM mínimo só com o que o mapa usa --------------------------------
/** DOM mínimo: elementos com atributos, classes, filhos e ouvintes guardados, para o teste disparar os eventos. */
function fakeDom() {
  const doc = {
    activeElement: null, byId: new Map(), listeners: [], documentElement: { clientWidth: 1024 },
    createTextNode: (text) => ({ nodeType: 3, text }),
    getElementById(id) { return this.byId.get(id) || null; },
    addEventListener(type, fn) { this.listeners.push({ type, fn }); },
    removeEventListener(type, fn) { this.listeners = this.listeners.filter((l) => l.type !== type || l.fn !== fn); },
    dispatchEvent() { return true; },
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(), ownerDocument: doc, parent: null, children: [], attrs: {}, className: '', id: '',
        hidden: false, style: { setProperty(k, v) { this[k] = v; } }, listeners: [], classes: new Set(),
        classList: { add: (c) => node.classes.add(c), remove: (c) => node.classes.delete(c), contains: (c) => node.classes.has(c) },
        offsetWidth: 220, offsetHeight: 90,
        getBoundingClientRect: () => ({ left: 100, top: 200, right: 140, bottom: 240, width: 40, height: 40 }),
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; },
        removeAttribute(k) { delete this.attrs[k]; },
        appendChild(c) { c.parent = node; node.children.push(c); if (c.id) doc.byId.set(c.id, c); return c; },
        addEventListener(type, fn, capture) { node.listeners.push({ type, fn, capture: !!capture }); },
        closest() { // só 'button.hm-cell' é usado pelo mapa
          for (let n = node; n && n.tagName; n = n.parent) {
            if (n.tagName === 'BUTTON' && n.className.split(' ').includes('hm-cell')) return n;
          }
          return null;
        },
        set textContent(v) { node.children = v === '' ? [] : [{ nodeType: 3, text: String(v) }]; },
      };
      return node;
    },
  };
  doc.body = doc.createElement('body');
  return doc;
}
function walk(node, fn) {
  fn(node);
  for (const c of node.children || []) walk(c, fn);
}
/** Textos do cartão na ordem em que aparecem: título, pares rótulo/valor e, por último, a nota. */
function cardText(tip) {
  const out = [];
  walk(tip, (n) => { if (n.nodeType === 3) out.push(n.text); });
  return out;
}
const pct = (x) => (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

test('mapa: a célula não tem title (a dica é o cartão próprio) e mantém aria-label; cabeçalhos e etiqueta usam data-tip', () => {
  const { m } = setupFor('BTCUSDT', '4h');
  const doc = fakeDom();
  const container = doc.createElement('section');
  H.render(container, m, { meta: 'BTC/USDT 4h' });
  const buttons = [], titled = [], tips = [];
  walk(container, (n) => {
    if (n.attrs && Object.hasOwn(n.attrs, 'title')) titled.push(n);
    if (n.tagName === 'BUTTON') buttons.push(n);
    if (n.attrs && n.attrs['data-tip'] !== undefined) tips.push(n.attrs['data-tip']);
  });
  assert.equal(buttons.length, m.total);
  assert.deepEqual(titled, [], 'nenhum elemento do mapa usa title');
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-label')), m.rows.flatMap((r) => r.cells.map((c) => c.label)));
  assert.deepEqual(tips, m.columns.flatMap((c) => (c.current ? [c.label, 'Regime do último candle'] : [c.label])));
});

test('mapa: dica da célula abre com o mouse (não com o toque), mostra título, linhas e nota; fecha ao sair, com Escape e ao clicar', () => {
  const { m } = setupFor('BTCUSDT', '4h');
  const doc = fakeDom();
  const container = doc.createElement('section');
  win.document = doc; // a dica fecha com Escape e clique pelo documento da página (window.document)
  try {
    H.render(container, m, { meta: '' });
    const cells = [];
    walk(container, (n) => { if (n.tagName === 'BUTTON') cells.push(n); });
    const fire = (type, ev) => container.listeners.filter((l) => l.type === type).forEach((l) => l.fn(ev));
    const hover = (cell, pointerType = 'mouse') => { fire('pointerenter', { pointerType, target: cell }); return doc.getElementById('hmTip'); };

    const cell = cells.find((b) => b.getAttribute('data-state') === 'cheia');
    const row = m.rows.find((r) => r.id === cell.getAttribute('data-setup'));
    const col = m.columns.find((c) => c.code === cell.getAttribute('data-regime'));
    const model = row.cells.find((c) => c.regime === col.code);

    assert.equal(hover(cell, 'touch'), null, 'toque não abre a dica');
    const tip = hover(cell);
    assert.equal(tip.hidden, false);
    assert.ok(tip.classList.contains('on'));
    assert.equal(tip.parent, doc.body, 'anexada ao corpo da página');
    assert.equal(tip.getAttribute('role'), 'tooltip');
    assert.equal(cell.getAttribute('aria-describedby'), 'hmTip');
    const parts = cardText(tip);
    const pairs = parts.slice(1, -1);
    assert.equal(parts[0], `${row.nome} · ${col.label}`, 'título: setup · regime');
    assert.deepEqual(pairs.filter((_, i) => i % 2 === 0), ['Taxa de acerto', 'IC 95%', 'Método do IC', 'Taxa-base do regime', 'Diferença', 'Gatilhos']);
    const values = pairs.filter((_, i) => i % 2 === 1);
    assert.equal(values[0], pct(model.rate));
    assert.equal(values[1], `${pct(model.ci[0])} a ${pct(model.ci[1])}`);
    assert.ok(cell.getAttribute('aria-label').endsWith(parts[parts.length - 1]), 'a nota é o mesmo estado que a descrição acessível diz');

    fire('pointerleave', { target: cell });
    assert.equal(tip.hidden, true, 'sair da célula fecha');
    assert.equal(cell.getAttribute('aria-describedby'), null);

    cell.matches = (sel) => sel === ':focus-visible';
    fire('focusin', { target: cell });
    assert.equal(tip.hidden, false, 'foco vindo do teclado abre');
    doc.listeners.filter((l) => l.type === 'keydown').forEach((l) => l.fn({ key: 'Escape' }));
    assert.equal(tip.hidden, true, 'Escape fecha');

    fire('focusin', { target: cell });
    fire('click', { target: cell });
    assert.equal(tip.hidden, true, 'clique fecha');

    // célula com N efetivo abaixo do corte: só a contagem e a nota, sem taxa
    const few = cells.find((b) => b.getAttribute('data-state') === 'insuficiente');
    const fewTip = hover(few);
    const fewParts = cardText(fewTip);
    assert.deepEqual(fewParts.slice(1, -1).filter((_, i) => i % 2 === 0), ['Gatilhos']);
    assert.ok(few.getAttribute('aria-label').endsWith(fewParts[fewParts.length - 1]));
  } finally {
    delete win.document;
  }
});
