/* =====================================================================
   ARGOS SENTINEL · motor estatístico (argos-engine)
   Zero LLM neste módulo. Tudo determinístico e reproduzível (seed fixa).
   Indicadores seguem as definições do TradingView/Pine v5 (seed por SMA),
   para que o que o motor calcula bata com o que o TradingView desenha.

   Módulo puro: sem rede, sem banco. Entra a série de candles e a regra de
   saída; sai o objeto de análise. Portado sem alteração de lógica do HTML
   da demo v1.1 (legacy/), por tools/port-engine.mjs.
   ===================================================================== */


// ---------------------------------------------------------------- dados
// Snapshot compacto: linhas [o,h,l,c,v] em sequência; `g` lista [linha, timestamp] onde há lacuna.
function decodeSnapshot(s) {
  const n = s.r.length, gap = new Map((s.g || []).map((x) => [x[0], x[1]]));
  const t = new Array(n), o = new Array(n), h = new Array(n), l = new Array(n), c = new Array(n), v = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = s.r[i];
    if (r.length === 6) { t[i] = s.t0 + r[0] * s.dt; o[i] = r[1]; h[i] = r[2]; l[i] = r[3]; c[i] = r[4]; v[i] = r[5]; continue; }
    t[i] = i === 0 ? s.t0 : gap.has(i) ? gap.get(i) : t[i - 1] + s.dt;
    o[i] = r[0]; h[i] = r[1]; l[i] = r[2]; c[i] = r[3]; v[i] = r[4];
  }
  return { t, o, h, l, c, v, n, dt: s.dt };
}

// Binance /api/v3/klines -> apenas candles já fechados
function fromBinance(klines, nowMs) {
  const rows = [];
  for (const k of klines) {
    if (+k[6] >= nowMs) continue; // candle ainda aberto: nunca entra no motor
    rows.push([Math.floor(+k[0] / 1000), +k[1], +k[2], +k[3], +k[4], +k[5]]);
  }
  return rows;
}

function mergeSeries(base, rows, dt) {
  const map = new Map();
  for (let i = 0; i < base.n; i++) map.set(base.t[i], [base.t[i], base.o[i], base.h[i], base.l[i], base.c[i], base.v[i]]);
  for (const r of rows) map.set(r[0], r);
  const ts = Array.from(map.keys()).sort((a, b) => a - b);
  const out = { t: [], o: [], h: [], l: [], c: [], v: [], n: 0, dt };
  for (const k of ts) {
    const r = map.get(k);
    out.t.push(r[0]); out.o.push(r[1]); out.h.push(r[2]); out.l.push(r[3]); out.c.push(r[4]); out.v.push(r[5]);
  }
  out.n = out.t.length;
  return out;
}

function sliceSeries(d, maxN) {
  if (d.n <= maxN) return d;
  const s = d.n - maxN;
  return { t: d.t.slice(s), o: d.o.slice(s), h: d.h.slice(s), l: d.l.slice(s), c: d.c.slice(s), v: d.v.slice(s), n: maxN, dt: d.dt };
}

// ----------------------------------------------------------- indicadores
const NaNArr = (n) => new Array(n).fill(NaN);

function sma(x, len) {
  const out = NaNArr(x.length); let sum = 0, cnt = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    if (!isNaN(xi)) { sum += xi; cnt++; }
    if (i >= len) { const xo = x[i - len]; if (!isNaN(xo)) { sum -= xo; cnt--; } }
    if (i >= len - 1 && cnt === len) out[i] = sum / len;
  }
  return out;
}

// EMA estilo Pine: semente = SMA dos primeiros `len` valores válidos
function ema(x, len) {
  const out = NaNArr(x.length); const a = 2 / (len + 1);
  let prev = NaN, seedSum = 0, seedCnt = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    if (isNaN(xi)) continue;
    if (isNaN(prev)) {
      seedSum += xi; seedCnt++;
      if (seedCnt === len) { prev = seedSum / len; out[i] = prev; }
    } else { prev = a * xi + (1 - a) * prev; out[i] = prev; }
  }
  return out;
}

// RMA (Wilder) estilo Pine: semente = SMA
function rma(x, len) {
  const out = NaNArr(x.length); const a = 1 / len;
  let prev = NaN, seedSum = 0, seedCnt = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    if (isNaN(xi)) continue;
    if (isNaN(prev)) {
      seedSum += xi; seedCnt++;
      if (seedCnt === len) { prev = seedSum / len; out[i] = prev; }
    } else { prev = a * xi + (1 - a) * prev; out[i] = prev; }
  }
  return out;
}

function rsi(close, len) {
  const n = close.length, up = NaNArr(n), dn = NaNArr(n);
  for (let i = 1; i < n; i++) { const ch = close[i] - close[i - 1]; up[i] = Math.max(ch, 0); dn[i] = Math.max(-ch, 0); }
  const ru = rma(up, len), rd = rma(dn, len), out = NaNArr(n);
  for (let i = 0; i < n; i++) {
    if (isNaN(ru[i]) || isNaN(rd[i])) continue;
    out[i] = rd[i] === 0 ? 100 : ru[i] === 0 ? 0 : 100 - 100 / (1 + ru[i] / rd[i]);
  }
  return out;
}

function trueRange(d) {
  const n = d.n, tr = NaNArr(n);
  for (let i = 0; i < n; i++) {
    tr[i] = i === 0 ? d.h[i] - d.l[i] : Math.max(d.h[i] - d.l[i], Math.abs(d.h[i] - d.c[i - 1]), Math.abs(d.l[i] - d.c[i - 1]));
  }
  return tr;
}

function atr(d, len) { return rma(trueRange(d), len); }

// ta.dmi / ADX estilo Pine
function adx(d, len) {
  const n = d.n, pdm = NaNArr(n), mdm = NaNArr(n);
  for (let i = 1; i < n; i++) {
    const up = d.h[i] - d.h[i - 1], dn = d.l[i - 1] - d.l[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
  }
  const tr = trueRange(d); tr[0] = NaN;
  const trur = rma(tr, len), sp = rma(pdm, len), sm = rma(mdm, len);
  const plus = NaNArr(n), minus = NaNArr(n), dx = NaNArr(n);
  for (let i = 0; i < n; i++) {
    if (isNaN(trur[i]) || trur[i] === 0) continue;
    plus[i] = 100 * sp[i] / trur[i]; minus[i] = 100 * sm[i] / trur[i];
    const s = plus[i] + minus[i];
    dx[i] = Math.abs(plus[i] - minus[i]) / (s === 0 ? 1 : s);
  }
  const a = rma(dx, len);
  return { adx: a.map((x) => x * 100), plus, minus };
}

function stdevRolling(x, len) { // populacional (ta.stdev)
  const out = NaNArr(x.length);
  for (let i = len - 1; i < x.length; i++) {
    let s = 0, s2 = 0, ok = true;
    for (let j = i - len + 1; j <= i; j++) { const v = x[j]; if (isNaN(v)) { ok = false; break; } s += v; s2 += v * v; }
    if (!ok) continue;
    const m = s / len; out[i] = Math.sqrt(Math.max(0, s2 / len - m * m));
  }
  return out;
}

function sampleStdRolling(x, len) { // amostral (pandas .std())
  const out = NaNArr(x.length);
  for (let i = len - 1; i < x.length; i++) {
    let s = 0, s2 = 0, ok = true;
    for (let j = i - len + 1; j <= i; j++) { const v = x[j]; if (isNaN(v)) { ok = false; break; } s += v; s2 += v * v; }
    if (!ok) continue;
    const m = s / len; out[i] = Math.sqrt(Math.max(0, (s2 - len * m * m) / (len - 1)));
  }
  return out;
}

function bollinger(close, len, mult) {
  const basis = sma(close, len), dev = stdevRolling(close, len);
  return { basis, upper: basis.map((b, i) => b + mult * dev[i]), lower: basis.map((b, i) => b - mult * dev[i]) };
}

function macd(close, f, s, sig) {
  const ef = ema(close, f), es = ema(close, s);
  const line = ef.map((x, i) => x - es[i]);
  const signal = ema(line, sig);
  return { line, signal, hist: line.map((x, i) => x - signal[i]) };
}

function highest(x, len) { const o = NaNArr(x.length); for (let i = len - 1; i < x.length; i++) { let m = -Infinity; for (let j = i - len + 1; j <= i; j++) m = Math.max(m, x[j]); o[i] = m; } return o; }
function lowest(x, len) { const o = NaNArr(x.length); for (let i = len - 1; i < x.length; i++) { let m = Infinity; for (let j = i - len + 1; j <= i; j++) m = Math.min(m, x[j]); o[i] = m; } return o; }

function percentileOfScore(arr, x) { // scipy kind='rank'
  let lt = 0, le = 0;
  for (const a of arr) { if (a < x) lt++; if (a <= x) le++; }
  return ((lt + le) / 2) / arr.length * 100;
}

function computeIndicators(d) {
  const periodsPerYear = (365 * 86400) / d.dt;
  const logret = NaNArr(d.n);
  for (let i = 1; i < d.n; i++) logret[i] = Math.log(d.c[i] / d.c[i - 1]);
  const rv30raw = sampleStdRolling(logret, 30);
  const rv30 = rv30raw.map((x) => x * Math.sqrt(periodsPerYear));
  const rvPct = NaNArr(d.n);
  for (let i = 0; i < d.n; i++) {
    if (isNaN(rv30[i])) continue;
    const w = []; for (let j = Math.max(0, i - 251); j <= i; j++) if (!isNaN(rv30[j])) w.push(rv30[j]);
    if (w.length >= 20) rvPct[i] = percentileOfScore(w, rv30[i]);
  }
  const bb = bollinger(d.c, 20, 2);
  const bbw = bb.upper.map((u, i) => (u - bb.lower[i]) / bb.basis[i]);
  const dmi = adx(d, 14);
  const volAvg = sma(d.v, 20);
  return {
    ema20: ema(d.c, 20), ema50: ema(d.c, 50), sma50: sma(d.c, 50), sma200: sma(d.c, 200),
    rsi: rsi(d.c, 14), macd: macd(d.c, 12, 26, 9), bb, bbw,
    atr: atr(d, 14), adx: dmi.adx, diPlus: dmi.plus, diMinus: dmi.minus,
    rv30, rvPct, volAvg, hh20: highest(d.h, 20), ll20: lowest(d.l, 20), logret
  };
}

// --------------------------------------------------- funções especiais
function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015; for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function ibeta(x, a, b) { // I_x(a,b) regularizada
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
function fSurvival(f, d1, d2) { if (!(f > 0)) return 1; return 1 - ibeta(d1 * f / (d1 * f + d2), d1 / 2, d2 / 2); }
function betaQuantile(p, a, b) { let lo = 0, hi = 1; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (ibeta(m, a, b) < p) lo = m; else hi = m; } return (lo + hi) / 2; }

// ------------------------------------------------------------ estatística
const Z95 = 1.959963984540054;
function wilson(k, n) {
  if (n === 0) return [NaN, NaN];
  const p = k / n, z2 = Z95 * Z95, den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const margin = (Z95 / den) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
function bayesWR(k, n) { // Beta(1,1)
  const a = 1 + k, b = 1 + (n - k);
  return { mean: a / (a + b), lo: betaQuantile(0.025, a, b), hi: betaQuantile(0.975, a, b) };
}
function effectiveN(rets) { // Durbin-Watson sobre resíduos (retornos demeaned)
  const n = rets.length; if (n < 3) return { nEff: Math.max(1, n), rho: 0 };
  const m = rets.reduce((s, x) => s + x, 0) / n; let num = 0, den = 0;
  for (let i = 0; i < n; i++) { const e = rets[i] - m; den += e * e; if (i > 0) { const d = e - (rets[i - 1] - m); num += d * d; } }
  if (den === 0) return { nEff: n, rho: 0 };
  const rho = Math.min(0.99, Math.max(-0.99, 1 - (num / den) / 2));
  const nEff = Math.max(1, Math.min(n, Math.floor(n * (1 - rho) / (1 + rho))));
  return { nEff, rho };
}
function cvar5(rets) {
  if (!rets.length) return NaN;
  const s = rets.slice().sort((a, b) => a - b);
  const k = Math.max(1, Math.floor(s.length * 0.05));
  let sum = 0; for (let i = 0; i < k; i++) sum += s[i];
  return sum / k;
}
function median(a) { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN; }
function evidenceTier(nEff) { return nEff < 10 ? 'INSUFFICIENT' : nEff < 25 ? 'LOW' : nEff < 50 ? 'MODERATE' : 'HIGH'; }

function mulberry32(seed) { return function () { let t = (seed += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------- regime
// Árvore de decisão do regime_detector v1 (mesmos limiares: ADX 20/25,
// percentil de volatilidade 40/60, MM200, Chow p < 0,01). Ajuste documentado
// da demo: o teste de Chow roda sobre os log-retornos (quebra de média),
// janela de 120 candles com ponto de quebra a 30 do fim. Sobre o preço em
// nível o teste rejeita quase sempre (resíduos autocorrelacionados).
function chowTest(lr, end, win, brk) {
  const start = end - win + 1; if (start < 1) return { p: 1, m1: 0, m2: 0 };
  const bp = end - brk + 1;
  const seg = (a, b) => { let s = 0, n = 0; for (let i = a; i <= b; i++) { s += lr[i]; n++; } const m = s / n; let r = 0; for (let i = a; i <= b; i++) r += (lr[i] - m) * (lr[i] - m); return { r, m }; };
  const full = seg(start, end), p1 = seg(start, bp - 1), p2 = seg(bp, end);
  const rss = p1.r + p2.r, k = 1, n = win;
  if (rss <= 0) return { p: 1, m1: p1.m, m2: p2.m };
  const f = ((full.r - rss) / k) / (rss / (n - 2 * k));
  return { p: fSurvival(f, k, n - 2 * k), m1: p1.m, m2: p2.m };
}

const REGIMES = {
  BULL_TREND: { label: 'Tendência de alta', short: 'Alta', color: '#199e70' },
  BEAR_TREND: { label: 'Tendência de baixa', short: 'Baixa', color: '#e66767' },
  HIGH_VOL_RANGING: { label: 'Lateral com alta volatilidade', short: 'Lateral · vol. alta', color: '#c98500' },
  LOW_VOL_RANGING: { label: 'Lateral com baixa volatilidade', short: 'Lateral · vol. baixa', color: '#3987e5' },
  STRUCTURAL_BREAK: { label: 'Quebra estrutural', short: 'Quebra', color: '#E8E3D8' },
  UNKNOWN: { label: 'Aquecimento do motor', short: '—', color: '#445164' }
};

function classifyAt(d, ind, lr, i) {
  if (i < 60) return { regime: 'UNKNOWN', confidence: 0 };
  const a = isNaN(ind.adx[i]) ? 15 : ind.adx[i];
  const rp = isNaN(ind.rvPct[i]) ? 50 : ind.rvPct[i];
  const ma = !isNaN(ind.sma200[i]) ? ind.sma200[i] : (() => { let s = 0, k = 0; for (let j = Math.max(0, i - 199); j <= i; j++) { s += d.c[j]; k++; } return s / k; })();
  const close = d.c[i];
  const ch = chowTest(lr, i, 120, 30);
  let regime, conf;
  if (ch.p < 0.01) { regime = 'STRUCTURAL_BREAK'; conf = Math.min(1, Math.max(0.5, 1 - ch.p * 10)); }
  else if (a > 25 && close > ma) {
    if (rp < 60) { regime = 'BULL_TREND'; conf = Math.min(0.95, Math.max(0.3, (a - 25) / 50)); }
    else { regime = 'HIGH_VOL_RANGING'; conf = Math.min(0.85, Math.max(0.4, rp / 100)); }
  } else if (a > 25 && close < ma) { regime = 'BEAR_TREND'; conf = Math.min(0.95, Math.max(0.3, (a - 25) / 50)); }
  else if (a < 20) { regime = rp > 60 ? 'HIGH_VOL_RANGING' : 'LOW_VOL_RANGING'; conf = Math.min(0.8, Math.max(0.3, 1 - a / 25)); }
  else { regime = 'HIGH_VOL_RANGING'; conf = 0.5; }
  return { regime, confidence: conf, adx: a, rvPct: rp, ma200: ma, priceVsMa: close / ma - 1, chowP: ch.p, drift: [ch.m1, ch.m2] };
}

function regimeSeries(d, ind) {
  const lr = d.c.map((c, i) => (i ? Math.log(c / d.c[i - 1]) : 0)), out = new Array(d.n);
  for (let i = 0; i < d.n; i++) out[i] = classifyAt(d, ind, lr, i);
  return out;
}

function regimeStats(reg) {
  const runs = []; let cur = null;
  for (let i = 0; i < reg.length; i++) {
    const r = reg[i].regime; if (r === 'UNKNOWN') continue;
    if (!cur || cur.regime !== r) { if (cur) runs.push(cur); cur = { regime: r, start: i, end: i }; } else cur.end = i;
  }
  if (cur) runs.push(cur);
  const byReg = {}, trans = {};
  runs.forEach((r, k) => {
    const len = r.end - r.start + 1;
    (byReg[r.regime] = byReg[r.regime] || []).push(len);
    if (k < runs.length - 1) { const nx = runs[k + 1].regime; trans[r.regime] = trans[r.regime] || {}; trans[r.regime][nx] = (trans[r.regime][nx] || 0) + 1; }
  });
  const durations = {}; for (const k in byReg) durations[k] = { runs: byReg[k].length, mean: mean(byReg[k]), median: median(byReg[k]) };
  const share = {}; let tot = 0; reg.forEach((x) => { if (x.regime !== 'UNKNOWN') { share[x.regime] = (share[x.regime] || 0) + 1; tot++; } });
  for (const k in share) share[k] = share[k] / tot;
  return { runs, durations, transitions: trans, share, current: runs[runs.length - 1] };
}

// ------------------------------------------------------------- setups
const SETUPS = [
  { id: 'RSI_OVERSOLD', nome: 'RSI Oversold', grupo: 'Momento', def: 'RSI(14) cruza de volta acima de 30 (saída da sobrevenda) — mesma definição do backfill v1.' },
  { id: 'MACD_CROSS', nome: 'MACD Bullish Cross', grupo: 'Momento', def: 'Linha MACD(12,26,9) cruza acima da linha de sinal.' },
  { id: 'GOLDEN_CROSS', nome: 'Golden Cross', grupo: 'Tendência', def: 'Média simples de 50 cruza acima da média simples de 200.' },
  { id: 'BB_LOWER', nome: 'Toque na Bollinger inferior', grupo: 'Reversão à média', def: 'Fechamento abaixo da banda inferior de Bollinger(20, 2), primeiro candle da sequência.' },
  { id: 'BREAKOUT_20', nome: 'Rompimento de 20 candles', grupo: 'Tendência', def: 'Fechamento acima da máxima dos 20 candles anteriores (primeiro candle do rompimento).' },
  { id: 'EMA_PULLBACK', nome: 'Pullback na EMA 20', grupo: 'Tendência', def: 'Com preço acima da MM200 e EMA20 > EMA50: a mínima toca a EMA20 e o candle fecha acima dela, após 3+ candles acima.' },
  { id: 'BULL_ENGULFING', nome: 'Engolfo de alta', grupo: 'Padrão gráfico', def: 'Candle de alta cujo corpo engole o corpo do candle de baixa anterior.' },
  { id: 'HAMMER', nome: 'Martelo', grupo: 'Padrão gráfico', def: 'Sombra inferior ≥ 2× o corpo, sombra superior ≤ 0,3× o corpo, fechamento abaixo da EMA20 (contexto de queda).' }
];

function detectSetups(d, ind) {
  const n = d.n, S = {};
  SETUPS.forEach((s) => (S[s.id] = new Array(n).fill(false)));
  for (let i = 1; i < n; i++) {
    const r0 = ind.rsi[i - 1], r1 = ind.rsi[i];
    if (r0 < 30 && r1 >= 30) S.RSI_OVERSOLD[i] = true;
    const m0 = ind.macd.line[i - 1], s0 = ind.macd.signal[i - 1], m1 = ind.macd.line[i], s1 = ind.macd.signal[i];
    if (m0 <= s0 && m1 > s1) S.MACD_CROSS[i] = true;
    if (ind.sma50[i - 1] <= ind.sma200[i - 1] && ind.sma50[i] > ind.sma200[i]) S.GOLDEN_CROSS[i] = true;
    if (d.c[i] < ind.bb.lower[i] && !(d.c[i - 1] < ind.bb.lower[i - 1])) S.BB_LOWER[i] = true;
    if (i >= 21) {
      const prevHigh = ind.hh20[i - 1], prevPrevHigh = ind.hh20[i - 2];
      if (d.c[i] > prevHigh && !(d.c[i - 1] > prevPrevHigh)) S.BREAKOUT_20[i] = true;
    }
    if (i >= 4 && d.c[i] > ind.sma200[i] && ind.ema20[i] > ind.ema50[i] && d.l[i] <= ind.ema20[i] && d.c[i] > ind.ema20[i]) {
      let above = true; for (let j = i - 3; j < i; j++) if (!(d.l[j] > ind.ema20[j])) { above = false; break; }
      if (above) S.EMA_PULLBACK[i] = true;
    }
    const pBody = d.c[i - 1] - d.o[i - 1], cBody = d.c[i] - d.o[i];
    if (pBody < 0 && cBody > 0 && d.o[i] <= d.c[i - 1] && d.c[i] >= d.o[i - 1] && cBody > Math.abs(pBody)) S.BULL_ENGULFING[i] = true;
    const body = Math.abs(d.c[i] - d.o[i]), lowerW = Math.min(d.o[i], d.c[i]) - d.l[i], upperW = d.h[i] - Math.max(d.o[i], d.c[i]);
    if (body > 0 && lowerW >= 2 * body && upperW <= 0.3 * body && d.c[i] < ind.ema20[i]) S.HAMMER[i] = true;
  }
  return S;
}

// -------------------------------------------- desfechos (regra de saída)
// cfg: {mode:'atr'|'pct', tgt, stp, hold}. Alvo e stop no mesmo candle: conta como PERDA (conservador).
function outcomesAll(d, ind, cfg) {
  const n = d.n, out = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i + cfg.hold >= n) continue; // janela futura incompleta: sem desfecho
    const e = d.c[i];
    let tp, sp;
    if (cfg.mode === 'atr') { const a = ind.atr[i]; if (isNaN(a)) continue; tp = e + cfg.tgt * a; sp = e - cfg.stp * a; }
    else { tp = e * (1 + cfg.tgt / 100); sp = e * (1 - cfg.stp / 100); }
    let res = null, mae = 0;
    for (let k = 1; k <= cfg.hold; k++) {
      const j = i + k;
      mae = Math.min(mae, d.l[j] / e - 1);
      const hitS = d.l[j] <= sp, hitT = d.h[j] >= tp;
      if (hitS) { res = { type: 'LOSS', ret: sp / e - 1, bars: k }; break; }
      if (hitT) { res = { type: 'WIN', ret: tp / e - 1, bars: k }; break; }
    }
    if (!res) res = { type: 'TIMEOUT', ret: d.c[i + cfg.hold] / e - 1, bars: cfg.hold };
    res.mae = Math.max(mae, sp / e - 1);
    res.rMult = res.ret / (1 - sp / e);
    out[i] = res;
  }
  return out;
}

function baseRate(outs, from) {
  let w = 0, k = 0; const idx = [];
  const W = new Float64Array(outs.length), N = new Float64Array(outs.length);
  for (let i = 0; i < outs.length; i++) {
    if (i >= from && outs[i]) { k++; idx.push(i); if (outs[i].type === 'WIN') w++; }
    W[i] = w; N[i] = k;
  }
  // taxa-base conhecida até o candle j (entradas aleatórias entre o aquecimento e j)
  const upTo = (j) => { if (j < from) return NaN; const jj = Math.min(j, outs.length - 1); return N[jj] >= 30 ? W[jj] / N[jj] : NaN; };
  return { rate: k ? w / k : NaN, n: k, idx, upTo };
}

// Benjamini-Hochberg: controla a taxa de falsas descobertas quando vários setups são testados juntos
function bhAdjust(ps) {
  const m = ps.length, order = ps.map((p, i) => [isFinite(p) ? p : 1, i]).sort((a, b) => a[0] - b[0]), q = new Array(m);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) { const v = Math.min(prev, (order[k][0] * m) / (k + 1)); q[order[k][1]] = Math.min(1, v); prev = v; }
  return q;
}
function applyFamily(list) {
  const q = bhAdjust(list.map((s) => s.pTwo));
  list.forEach((s, k) => { s.q = q[k]; s.family = list.length; s.verdict = verdictOf(s); });
  return list;
}

// Teste de permutação de Monte Carlo: n entradas aleatórias no mesmo histórico, mesma regra de saída.
function permutationTest(outs, poolIdx, nTrig, wObs, iters, seed) {
  const rnd = mulberry32(seed), pool = poolIdx.slice(), m = pool.length;
  if (nTrig === 0 || m < nTrig) return { pHigh: 1, pLow: 1, meanRand: NaN };
  let ge = 0, le = 0, sum = 0;
  for (let it = 0; it < iters; it++) {
    let w = 0;
    for (let k = 0; k < nTrig; k++) { const j = k + Math.floor(rnd() * (m - k)); const tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp; if (outs[pool[k]].type === 'WIN') w++; }
    if (w >= wObs) ge++; if (w <= wObs) le++; sum += w;
  }
  return { pHigh: (ge + 1) / (iters + 1), pLow: (le + 1) / (iters + 1), meanRand: sum / iters / nTrig };
}

// Walk-forward com expurgo: o treino só usa gatilhos cujo desfecho já era conhecido quando a janela de teste começa.
// Previsão do motor = taxa de acerto do treino (Beta(1,1)); referência ingênua = taxa-base conhecida no mesmo instante.
function walkForward(trig, outs, K, hold, base) {
  const closed = trig.filter((i) => outs[i]);
  if (closed.length < 20) return { available: false, reason: 'Menos de 20 gatilhos com desfecho — walk-forward não é confiável.' };
  const size = Math.floor(closed.length / K), folds = [];
  for (let k = 0; k < K; k++) folds.push(closed.slice(k * size, k === K - 1 ? closed.length : (k + 1) * size));
  const walks = [], preds = [], refs = [], obs = [];
  for (let k = 1; k < K; k++) {
    const test = folds[k], t0 = test[0];
    const train = [].concat(...folds.slice(0, k)).filter((i) => i + hold <= t0);
    if (train.length < 5) continue;
    const tw = train.filter((i) => outs[i].type === 'WIN').length, vw = test.filter((i) => outs[i].type === 'WIN').length;
    const trWR = tw / train.length, vaWR = vw / test.length;
    const pHat = (tw + 1) / (train.length + 2);
    const ref = base && base.upTo ? base.upTo(t0 - hold) : NaN;
    test.forEach((i) => { preds.push(pHat); refs.push(isFinite(ref) ? ref : pHat); obs.push(outs[i].type === 'WIN' ? 1 : 0); });
    walks.push({ trainN: train.length, trainWR: trWR, testN: test.length, testWR: vaWR, dropPP: (trWR - vaWR) * 100, overfit: trWR - vaWR > 0.15, from: test[0], to: test[test.length - 1], ref });
  }
  if (!walks.length) return { available: false, reason: 'Janelas de treino pequenas demais depois do expurgo.' };
  const brier = mean(preds.map((p, i) => (p - obs[i]) ** 2));
  const brierRef = mean(refs.map((r, i) => (r - obs[i]) ** 2));
  const spread = Math.max(...walks.map((w) => w.testWR)) - Math.min(...walks.map((w) => w.testWR));
  return { available: true, walks, brier, brierRef, bss: brierRef > 0 ? 1 - brier / brierRef : NaN, nPred: preds.length, consistent: !walks.some((w) => w.overfit), spreadPP: spread * 100 };
}

// ------------------------------------------------ calibração prequencial
// Simula o motor em produção: a cada gatilho, a probabilidade emitida é a taxa de acerto
// (Beta(1,1)) dos gatilhos anteriores do mesmo setup cujo desfecho já era conhecido.
// Só pontua quando o setup já tinha pelo menos `minN` desfechos (antes disso o produto não emite probabilidade).
function prequential(trigBySetup, outs, hold, base, minN) {
  const preds = [];
  Object.keys(trigBySetup).forEach((sid) => {
    const closed = trigBySetup[sid].filter((i) => outs[i]);
    let w = 0, n = 0, ptr = 0;
    for (let a = 0; a < closed.length; a++) {
      const t = closed[a];
      while (ptr < a && closed[ptr] + hold <= t) { n++; if (outs[closed[ptr]].type === 'WIN') w++; ptr++; }
      if (n < minN) continue;
      const r = base.upTo(t - hold);
      if (!isFinite(r)) continue;
      preds.push({ t, sid, p: (w + 1) / (n + 2), r, o: outs[t].type === 'WIN' ? 1 : 0 });
    }
  });
  return preds.sort((a, b) => a.t - b.t);
}
const CAL_BINS = [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 1.0001];
function calibSummary(preds, tArr) {
  const n = preds.length;
  if (n < 30) return { n, brier: NaN, brierRef: NaN, bss: NaN, ece: NaN, bins: [], rolling: [], status: calibStatus(NaN, NaN, n) };
  let b = 0, r = 0; preds.forEach((x) => { b += (x.p - x.o) ** 2; r += (x.r - x.o) ** 2; });
  const brier = b / n, brierRef = r / n, bss = 1 - brier / brierRef;
  const bins = [];
  for (let k = 0; k < CAL_BINS.length - 1; k++) {
    const lo = CAL_BINS[k], hi = CAL_BINS[k + 1], sel = preds.filter((x) => x.p >= lo && x.p < hi);
    if (!sel.length) continue;
    bins.push({ lo, hi, n: sel.length, pred: mean(sel.map((x) => x.p)), obs: mean(sel.map((x) => x.o)) });
  }
  const ece = bins.reduce((s, x) => s + (x.n / n) * Math.abs(x.obs - x.pred), 0);
  // série temporal: Brier móvel de 90 dias vs. referência, amostrada a cada 7 dias
  const rolling = [];
  if (tArr) {
    const t0 = tArr[preds[0].t], t1 = tArr[preds[n - 1].t], W = 90 * 86400, step = 7 * 86400;
    let lo = 0, hi = 0, sb = 0, sr = 0, cb = 0, cr = 0, cn = 0;
    for (let T = t0 + W; T <= t1 + step; T += step) {
      while (hi < n && tArr[preds[hi].t] <= T) { const x = preds[hi]; sb += (x.p - x.o) ** 2; sr += (x.r - x.o) ** 2; cb += (x.p - x.o) ** 2; cr += (x.r - x.o) ** 2; cn++; hi++; }
      while (lo < hi && tArr[preds[lo].t] <= T - W) { const x = preds[lo]; sb -= (x.p - x.o) ** 2; sr -= (x.r - x.o) ** 2; lo++; }
      const m = hi - lo;
      if (m >= 15) rolling.push({ time: Math.min(T, t1), brier: sb / m, ref: sr / m, n: m, cum: cb / cn, cumRef: cr / cn });
    }
  }
  return { n, brier, brierRef, bss, ece, bins, rolling, status: calibStatus(bss, ece, n) };
}
function calibStatus(bss, ece, n) {
  if (!(n >= 30) || !isFinite(bss)) return { k: 'na', t: 'Previsões insuficientes', skill: '—', cal: '—' };
  const skill = bss > 0.01 ? 'acima da referência' : bss >= -0.01 ? 'empata com a referência' : 'abaixo da referência';
  const cal = ece < 0.03 ? 'bem calibrada' : ece < 0.06 ? 'calibração em atenção' : 'descalibrada';
  const k = bss < -0.01 || ece >= 0.06 ? 'bad' : bss > 0.01 && ece < 0.03 ? 'good' : 'ok';
  return { k, t: cal.charAt(0).toUpperCase() + cal.slice(1) + ' · ' + skill, skill, cal };
}

function verdictOf(st) {
  if (st.nEff < 10) return { key: 'INSUFICIENTE', label: 'Evidência insuficiente', tone: 'neutral' };
  const q = isFinite(st.q) ? st.q : st.pTwo;
  if (!(q < 0.05)) return { key: 'SEM_EDGE', label: 'Sem vantagem demonstrável', tone: 'muted' };
  if (st.winRate < st.base) return { key: 'ABAIXO', label: 'Abaixo do acaso', tone: 'bad' };
  if (st.wf && st.wf.available && !st.wf.consistent) return { key: 'EDGE_SENSIVEL', label: 'Vantagem presente, sensível a subperíodos', tone: 'warn' };
  return { key: 'EDGE', label: 'Vantagem estatística presente', tone: 'good' };
}

function evaluateSetup(id, d, ind, reg, trigArr, outs, base, cfg) {
  const trig = []; for (let i = 0; i < d.n; i++) if (trigArr[i]) trig.push(i);
  const closed = trig.filter((i) => outs[i]);
  const wins = closed.filter((i) => outs[i].type === 'WIN').length;
  const n = closed.length;
  const rets = closed.map((i) => outs[i].ret);
  const eff = effectiveN(rets);
  const wr = n ? wins / n : NaN;
  const small = eff.nEff < 25;
  const ci = n ? (small ? (() => { const b = bayesWR(wins, n); return [b.lo, b.hi]; })() : wilson(wins, n)) : [NaN, NaN];
  const perm = permutationTest(outs, base.idx, n, wins, 3000, 42);
  const netRets = rets.map((r) => r - 0.001);
  const byReg = {};
  closed.forEach((i) => { const r = reg[i].regime; byReg[r] = byReg[r] || { n: 0, w: 0 }; byReg[r].n++; if (outs[i].type === 'WIN') byReg[r].w++; });
  const wf = walkForward(trig, outs, 5, cfg.hold, base);
  const st = {
    id, nRaw: trig.length, n, wins, winRate: wr, ci, method: small ? 'bayes_beta_binomial' : 'wilson', nEff: eff.nEff, rho: eff.rho,
    tier: evidenceTier(eff.nEff), base: base.rate, alphaPP: (wr - base.rate) * 100, pHigh: perm.pHigh, pLow: perm.pLow,
    pTwo: Math.min(1, 2 * Math.min(perm.pHigh, perm.pLow)), q: NaN, family: 1,
    cvar: cvar5(rets), worst: rets.length ? Math.min(...rets) : NaN, maeMedian: median(closed.map((i) => outs[i].mae)),
    meanNet: mean(netRets), timeouts: closed.filter((i) => outs[i].type === 'TIMEOUT').length,
    byRegime: byReg, wf, triggers: trig, lastTrigger: trig.length ? trig[trig.length - 1] : -1,
    activeNow: trig.length > 0 && trig[trig.length - 1] >= d.n - 3, barsSinceLast: trig.length ? d.n - 1 - trig[trig.length - 1] : null
  };
  st.verdict = verdictOf(st);
  return st;
}

// ------------------------------------------------------ leitura técnica
function technicalRead(d, ind, reg) {
  const i = d.n - 1, c = d.c[i];
  const r = reg[i], rsiV = ind.rsi[i], m = ind.macd.line[i], s = ind.macd.signal[i], hst = ind.macd.hist[i];
  let barsSinceCross = 0; for (let j = i; j > 0; j--) { if ((ind.macd.line[j] > ind.macd.signal[j]) !== (ind.macd.line[j - 1] > ind.macd.signal[j - 1])) break; barsSinceCross++; }
  let barsVsMa = 0; const above = c > ind.sma200[i]; for (let j = i; j >= 0 && !isNaN(ind.sma200[j]); j--) { if ((d.c[j] > ind.sma200[j]) !== above) break; barsVsMa++; }
  const bbwWin = ind.bbw.slice(Math.max(0, i - 251), i + 1).filter((x) => !isNaN(x));
  const lastRets = []; for (let j = Math.max(1, d.n - 500); j < d.n; j++) lastRets.push(d.c[j] / d.c[j - 1] - 1);
  let peak = -Infinity, mdd = 0; for (let j = Math.max(0, d.n - 500); j < d.n; j++) { peak = Math.max(peak, d.c[j]); mdd = Math.min(mdd, d.c[j] / peak - 1); }
  const volZ = (() => { const w = d.v.slice(Math.max(0, i - 29), i + 1); const mu = mean(w); const sd = Math.sqrt(mean(w.map((x) => (x - mu) ** 2))); return sd ? (d.v[i] - mu) / sd : 0; })();
  const rangePos = (c - ind.ll20[i]) / (ind.hh20[i] - ind.ll20[i]);
  const chg = (k) => (i - k >= 0 ? c / d.c[i - k] - 1 : NaN);
  return {
    time: d.t[i], close: c, open: d.o[i], high: d.h[i], low: d.l[i],
    change1: chg(1), change24: chg(Math.round(86400 / d.dt)), change7d: chg(Math.round(7 * 86400 / d.dt)),
    ema20: ind.ema20[i], ema50: ind.ema50[i], sma200: ind.sma200[i], distMa200: c / ind.sma200[i] - 1, barsVsMa200: barsVsMa, aboveMa200: above,
    emaAligned: ind.ema20[i] > ind.ema50[i],
    adx: ind.adx[i], diPlus: ind.diPlus[i], diMinus: ind.diMinus[i],
    rsi: rsiV, rsiZone: rsiV < 30 ? 'sobrevenda' : rsiV > 70 ? 'sobrecompra' : 'neutra',
    macd: m, macdSignal: s, macdHist: hst, macdAbove: m > s, macdBarsSinceCross: barsSinceCross, histExpanding: Math.abs(hst) > Math.abs(ind.macd.hist[i - 1]),
    atr: ind.atr[i], atrPct: ind.atr[i] / c, bbUpper: ind.bb.upper[i], bbLower: ind.bb.lower[i], bbWidthPct: percentileOfScore(bbwWin, ind.bbw[i]),
    rv30: ind.rv30[i], rvPct: ind.rvPct[i], volZ, hh20: ind.hh20[i], ll20: ind.ll20[i], rangePos,
    cvar1bar: cvar5(lastRets), maxDD: mdd, regime: r
  };
}

// -------------------------------------------------------- orquestração
function analyze(d, cfg, meta) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ind = computeIndicators(d);
  const reg = regimeSeries(d, ind);
  const rstats = regimeStats(reg);
  const trig = detectSetups(d, ind);
  const outs = outcomesAll(d, ind, cfg);
  const warm = 200; // só avalia depois do aquecimento da MM200
  for (const id in trig) for (let i = 0; i < warm && i < d.n; i++) trig[id][i] = false;
  const base = baseRate(outs, warm);
  const setups = applyFamily(SETUPS.map((s) => Object.assign({}, s, evaluateSetup(s.id, d, ind, reg, trig[s.id], outs, base, cfg))));
  const tech = technicalRead(d, ind, reg);
  // Calibração prequencial agregada: todas as probabilidades que o motor teria emitido, na ordem do tempo
  const trigIdx = {}; setups.forEach((s) => (trigIdx[s.id] = s.triggers));
  const preds = prequential(trigIdx, outs, cfg.hold, base, 10);
  const calib = calibSummary(preds, d.t);
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { meta, cfg, d, ind, reg, rstats, trig, outs, base, setups, tech, calib, preds, ms, warm };
}

// ------------------------------------------ setups próprios (Sandbox)
// spec: { type, ...parâmetros } vindos do leitor de Pine Script. Avaliação long-only, mesma regra de saída.
const SPEC_TYPES = {
  rsi_cross_up: { nome: (s) => 'RSI(' + s.len + ') cruza acima de ' + s.level, need: ['len', 'level'] },
  rsi_below: { nome: (s) => 'RSI(' + s.len + ') entra abaixo de ' + s.level, need: ['len', 'level'] },
  macd_cross_up: { nome: (s) => 'MACD(' + s.fast + ', ' + s.slow + ', ' + s.signal + ') cruza acima do sinal', need: ['fast', 'slow', 'signal'] },
  ma_cross_up: { nome: (s) => s.kind.toUpperCase() + s.fast + ' cruza acima da ' + s.kind.toUpperCase() + s.slow, need: ['kind', 'fast', 'slow'] },
  price_cross_ma_up: { nome: (s) => 'Fechamento cruza acima da ' + s.kind.toUpperCase() + s.len, need: ['kind', 'len'] },
  bb_lower: { nome: (s) => 'Fechamento abaixo da Bollinger inferior (' + s.len + ', ' + s.mult + ')', need: ['len', 'mult'] },
  breakout: { nome: (s) => 'Rompimento da máxima de ' + s.len + ' candles', need: ['len'] }
};
function triggersFromSpec(d, spec) {
  const n = d.n, T = new Array(n).fill(false), c = d.c;
  const ma = (kind, len) => (kind === 'ema' ? ema(c, len) : sma(c, len));
  if (spec.type === 'rsi_cross_up' || spec.type === 'rsi_below') {
    const r = rsi(c, spec.len);
    for (let i = 1; i < n; i++) {
      if (spec.type === 'rsi_cross_up' && r[i - 1] < spec.level && r[i] >= spec.level) T[i] = true;
      if (spec.type === 'rsi_below' && r[i] < spec.level && !(r[i - 1] < spec.level)) T[i] = true;
    }
  } else if (spec.type === 'macd_cross_up') {
    const m = macd(c, spec.fast, spec.slow, spec.signal);
    for (let i = 1; i < n; i++) if (m.line[i - 1] <= m.signal[i - 1] && m.line[i] > m.signal[i]) T[i] = true;
  } else if (spec.type === 'ma_cross_up') {
    const f = ma(spec.kind, spec.fast), s = ma(spec.kind, spec.slow);
    for (let i = 1; i < n; i++) if (f[i - 1] <= s[i - 1] && f[i] > s[i]) T[i] = true;
  } else if (spec.type === 'price_cross_ma_up') {
    const m = ma(spec.kind, spec.len);
    for (let i = 1; i < n; i++) if (c[i - 1] <= m[i - 1] && c[i] > m[i]) T[i] = true;
  } else if (spec.type === 'bb_lower') {
    const bb = bollinger(c, spec.len, spec.mult);
    for (let i = 1; i < n; i++) if (c[i] < bb.lower[i] && !(c[i - 1] < bb.lower[i - 1])) T[i] = true;
  } else if (spec.type === 'breakout') {
    const hh = highest(d.h, spec.len);
    for (let i = 2; i < n; i++) if (c[i] > hh[i - 1] && !(c[i - 1] > hh[i - 2])) T[i] = true;
  } else throw new Error('tipo de setup não suportado: ' + spec.type);
  return T;
}
function analyzeSpec(d, cfg, spec, meta) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ind = computeIndicators(d), reg = regimeSeries(d, ind), outs = outcomesAll(d, ind, cfg), warm = 200;
  const trigArr = triggersFromSpec(d, spec); for (let i = 0; i < warm && i < d.n; i++) trigArr[i] = false;
  const base = baseRate(outs, warm);
  const nome = SPEC_TYPES[spec.type] ? SPEC_TYPES[spec.type].nome(spec) : spec.type;
  const s = Object.assign({ id: 'CUSTOM', nome, grupo: 'Setup próprio', def: nome + ' (lido do Pine Script).' }, evaluateSetup('CUSTOM', d, ind, reg, trigArr, outs, base, cfg));
  s.verdict = verdictOf(s);
  const preds = prequential({ CUSTOM: s.triggers }, outs, cfg.hold, base, 10);
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { meta, cfg, d, ind, reg, outs, base, setup: s, calib: calibSummary(preds, d.t), preds, tech: technicalRead(d, ind, reg), ms, warm };
}

export const VERSION = 'argos-engine 1.1.0';

export {
  decodeSnapshot, fromBinance, mergeSeries, sliceSeries, computeIndicators, regimeSeries, regimeStats, detectSetups, outcomesAll, analyze, analyzeSpec, triggersFromSpec, SPEC_TYPES, applyFamily, bhAdjust, verdictOf, prequential, calibSummary, calibStatus, wilson, bayesWR, effectiveN, cvar5, fSurvival, ibeta, REGIMES, SETUPS, median, mean
};

/** Mesmo objeto que a demo expunha em window.ArgosEngine. */
const ArgosEngine = {
  decodeSnapshot, fromBinance, mergeSeries, sliceSeries, computeIndicators, regimeSeries, regimeStats, detectSetups, outcomesAll, analyze, analyzeSpec, triggersFromSpec, SPEC_TYPES, applyFamily, bhAdjust, verdictOf, prequential, calibSummary, calibStatus, wilson, bayesWR, effectiveN, cvar5, fSurvival, ibeta, REGIMES, SETUPS, median, mean, VERSION
};
export default ArgosEngine;
