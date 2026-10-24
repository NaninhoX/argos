/* =====================================================================
   ARGOS · Análise ao vivo (Argos AI × TradingView)
   UI + orquestração. O motor fica em ArgosEngine; nenhuma frase gerada
   aqui é recomendação — o texto descreve evidência e condições.
   ===================================================================== */
(function () {
  'use strict';
  const E = window.ArgosEngine, SNAP = window.ARGOS_SNAPSHOT, LWC = window.LightweightCharts, RV = window.ArgosRegimeView;
  const US = window.ArgosUrlState; // estado da análise na URL (web/js/url-state.js); sem ele a URL simplesmente não é lida nem escrita
  const $ = (id) => document.getElementById(id);
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Movimento (web/js/motion.js): sem ele, ou desligado (prefers-reduced-motion, ?motion=off), todo gancho abaixo vira no-op.
  const MOT = () => { const M = window.ArgosMotion; return M && M.enabled ? M : null; };

  // ------------------------------------------------------------ formatos
  const nfCache = {};
  const NF = (d) => nfCache[d] || (nfCache[d] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtN = (x, d = 2) => (isFinite(x) ? NF(d).format(x) : '—');
  const fmtPct = (x, d = 1) => (isFinite(x) ? NF(d).format(x * 100) + '%' : '—');
  const fmtSPct = (x, d = 2) => (isFinite(x) ? (x >= 0 ? '+' : '−') + NF(d).format(Math.abs(x * 100)) + '%' : '—');
  const fmtP = (p) => (!isFinite(p) ? '—' : p < 0.001 ? '< 0,001' : NF(3).format(p));
  const fmtInt = (x) => (isFinite(x) ? new Intl.NumberFormat('pt-BR').format(Math.round(x)) : '—');
  const fmtVol = (x) => { if (!isFinite(x)) return '—'; const a = Math.abs(x); return a >= 1e9 ? fmtN(x / 1e9, 2) + ' bi' : a >= 1e6 ? fmtN(x / 1e6, 2) + ' mi' : a >= 1e3 ? fmtN(x / 1e3, 1) + ' mil' : fmtN(x, 0); };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TF_LABEL = { '1h': '1h', '4h': '4h', '1d': '1D' };
  const PAIR = (s) => s.replace('USDT', '/USDT');
  const pad = (n) => String(n).padStart(2, '0');
  function fmtDate(ts, withTime = true) { const d = new Date(ts * 1000); return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + (withTime ? ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC' : ''); }
  function fmtDay(ts) { return fmtDate(ts, false); }
  function nowBrt() { try { return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (Brasília)'; } catch (e) { return new Date().toLocaleString('pt-BR'); } }
  function isoDay() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function spanText(k, dt) { const h = (k * dt) / 3600; return h < 48 ? k + ' candles (~' + Math.round(h) + ' h)' : k + ' candles (~' + Math.round(h / 24) + ' dias)'; }
  const pl = (n, s, p) => (n === 1 ? s : p);

  // -------------------------------------------------------------- estado
  const state = {
    sym: 'BTCUSDT', tf: '4h', cfg: { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, show: { ma: true, bb: true, vol: true },
    selected: null, A: null, series: {}, tab: 'engine', samp: null, dl: null,
    win: null, // janela em dias (null = série inteira); só entra pela URL
    urlOn: false, // a URL só é reescrita depois que ela já trazia a pergunta ou que a pessoa mexeu na análise
    regimeSel: 'ALL', // recorte do banco de setups: 'ALL' | 'CURRENT' | código do regime; mantido ao recalcular
    regs: {}, // registros de veredito pedidos ao servidor, por pergunta (ver regKey)
    ai: { text: '', running: false, done: false, ctl: null, key: null, log: [], err: '' }, pipeTimer: null, liveTimer: null, shownOnce: false
  };
  const key = (sym, tf) => sym + '_' + tf;
  function entry(sym, tf) {
    const k = key(sym, tf);
    if (!state.series[k]) state.series[k] = { d: E.decodeSnapshot(SNAP.series[k]), source: 'snapshot' };
    return state.series[k];
  }
  function cfgText(c) { const u = c.mode === 'atr' ? '×ATR' : '%'; return 'alvo ' + fmtN(c.tgt, c.tgt % 1 ? 1 : 0) + u + ' · stop ' + fmtN(c.stp, c.stp % 1 ? 1 : 0) + u + ' · ' + c.hold + ' candles'; }
  function gapsOf(d) { let g = 0; for (let i = 1; i < d.n; i++) if (d.t[i] - d.t[i - 1] !== d.dt) g++; return g; }

  // --------------------------------------------------- dados ao vivo (arquivo)
  const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
  async function fetchKlines(sym, tf, limit, endTime) {
    let last;
    for (const host of HOSTS) {
      const url = host + '/api/v3/klines?symbol=' + sym + '&interval=' + tf + '&limit=' + limit + (endTime ? '&endTime=' + endTime : '');
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 7000);
      try {
        const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(to);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (!Array.isArray(j)) throw new Error('resposta inesperada');
        return j;
      } catch (e) { clearTimeout(to); last = e; }
    }
    throw last || new Error('sem resposta');
  }
  // Candles novos da base da Stratum (depois do corte do snapshot). Reserva quando a Binance não responde (celular, rede
  // bloqueada) e fonte do Query/Calibração: snapshot + estes candles é a mesma série que o servidor analisa.
  async function fetchServerTail(sym, tf, since) {
    if (!/^https?:$/.test(location.protocol)) return null;
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch('/api/candles?symbol=' + sym + '&tf=' + tf + '&since=' + since, { signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) return null;
      const j = await r.json();
      return Array.isArray(j.rows) && j.rows.length ? j.rows : null;
    } catch (e) { clearTimeout(to); return null; }
  }
  const dbCache = {};
  async function dbSeries(sym, tf) { // snapshot + candles da base; null se a base não responde
    const k = key(sym, tf), c = dbCache[k];
    if (c && Date.now() - c.at < 5 * 60 * 1000) return c.v;
    const snapD = E.decodeSnapshot(SNAP.series[k]);
    const rows = await fetchServerTail(sym, tf, snapD.t[snapD.n - 1]);
    if (!rows) return null;
    const v = { d: E.mergeSeries(snapD, rows, snapD.dt), source: 'database' };
    dbCache[k] = { at: Date.now(), v };
    return v;
  }
  async function fromBase(sym, tf) { // usa a série da base como série "viva" quando a Binance não respondeu
    const en = entry(sym, tf), db = await dbSeries(sym, tf);
    if (!db) return false;
    const changed = en.via !== 'base' || db.d.t[db.d.n - 1] !== en.d.t[en.d.n - 1];
    state.series[key(sym, tf)] = { d: db.d, source: 'live', via: 'base', updatedAt: Date.now() };
    return changed;
  }
  async function refreshLive(sym, tf) {
    const en = entry(sym, tf), snapD = E.decodeSnapshot(SNAP.series[key(sym, tf)]);
    try {
      const now = Date.now();
      let rows = E.fromBinance(await fetchKlines(sym, tf, 1000), now);
      if (!rows.length) return await fromBase(sym, tf);
      const dt = snapD.dt, snapEnd = snapD.t[snapD.n - 1];
      if (rows[0][0] > snapEnd + dt) {
        try { rows = E.fromBinance(await fetchKlines(sym, tf, 1000, rows[0][0] * 1000 - 1), now).concat(rows); } catch (e) { /* segue com 1000 */ }
      }
      const empty = { t: [], o: [], h: [], l: [], c: [], v: [], n: 0, dt };
      let merged = rows[0][0] <= snapEnd + dt ? E.mergeSeries(snapD, rows, dt) : E.mergeSeries(empty, rows, dt);
      merged = E.sliceSeries(merged, { '1h': 5200, '4h': 26000, '1d': 4200 }[tf]);
      const changed = en.source !== 'live' || merged.t[merged.n - 1] !== en.d.t[en.d.n - 1];
      state.series[key(sym, tf)] = { d: merged, source: 'live', updatedAt: now };
      return changed;
    } catch (e) {
      en.liveError = String((e && e.message) || e);
      try { return await fromBase(sym, tf); } catch (e2) { return false; }
    }
  }

  // ------------------------------------------------------------- gráfico
  let chart = null, S = {}, markersApi = null;
  const PRICE_FMT = { type: 'custom', minMove: 0.01, formatter: (p) => fmtN(p, 2) };
  // As cores do gráfico vêm do tema (js/tema.js). Sem o tema, ficam as do tema escuro.
  const themeColor = (name, fallback) => (window.ArgosTema && window.ArgosTema.cor(name)) || fallback;
  function paintChart() {
    if (!chart) return;
    const line = themeColor('--navy-line-soft', '#1F2B3B'), grid = themeColor('--grid-line', '#22303F'), ref = themeColor('--ink-line', '#5E6B7C');
    chart.applyOptions({
      layout: { background: { type: 'solid', color: themeColor('--chart-bg', '#101927') }, textColor: themeColor('--ink-mute', '#8D97A6'), fontFamily: themeColor('--sans', "'JetBrains Mono', monospace"), panes: { separatorColor: line } },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: line }, timeScale: { borderColor: line }
    });
    const up = themeColor('--up', '#199e70'), down = themeColor('--down', '#e66767');
    S.candles.applyOptions({ borderUpColor: up, wickUpColor: up, downColor: down, borderDownColor: down, wickDownColor: down });
    S.bbU.applyOptions({ color: ref }); S.bbL.applyOptions({ color: ref });
    S.rsi.applyOptions({ color: themeColor('--gold-bright', '#D4B15C') });
    S.macd.applyOptions({ color: themeColor('--ink', '#E8E3D8') });
    S.rsi70.applyOptions({ color: ref }); S.rsi30.applyOptions({ color: ref });
  }
  document.addEventListener('argos:tema', () => { paintChart(); setMarkers(); });
  function buildChart() {
    const el = $('lvChart');
    chart = LWC.createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: '#101927' }, textColor: '#8D97A6', fontFamily: "'JetBrains Mono', 'Courier New', monospace", fontSize: 11, attributionLogo: true, panes: { separatorColor: '#1F2B3B', separatorHoverColor: 'rgba(176,141,62,0.22)', enableResize: true } },
      grid: { vertLines: { color: 'rgba(42,58,78,0.32)' }, horzLines: { color: 'rgba(42,58,78,0.32)' } },
      rightPriceScale: { borderColor: '#1F2B3B', scaleMargins: { top: 0.16, bottom: 0.06 } },
      timeScale: { borderColor: '#1F2B3B', timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 7, minBarSpacing: 1.2 },
      crosshair: { mode: LWC.CrosshairMode.Normal, vertLine: { color: 'rgba(212,177,92,0.42)', labelBackgroundColor: '#1E2A3A' }, horzLine: { color: 'rgba(212,177,92,0.42)', labelBackgroundColor: '#1E2A3A' } },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: true },
      localization: { locale: 'pt-BR' }
    });
    const lo = (color, w) => ({ color, lineWidth: w, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: PRICE_FMT });
    S.candles = chart.addSeries(LWC.CandlestickSeries, { upColor: 'rgba(0,0,0,0)', borderUpColor: '#199e70', wickUpColor: '#199e70', downColor: '#e66767', borderDownColor: '#e66767', wickDownColor: '#e66767', priceLineColor: '#B08D3E', priceFormat: PRICE_FMT }, 0);
    S.vol = chart.addSeries(LWC.HistogramSeries, { priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'custom', minMove: 1, formatter: fmtVol } }, 0);
    S.vol.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    S.bbU = chart.addSeries(LWC.LineSeries, lo('rgba(155,164,178,0.55)', 1), 0);
    S.bbL = chart.addSeries(LWC.LineSeries, lo('rgba(155,164,178,0.55)', 1), 0);
    S.sma200 = chart.addSeries(LWC.LineSeries, lo('#d55181', 2), 0);
    S.ema50 = chart.addSeries(LWC.LineSeries, lo('#3987e5', 2), 0);
    S.ema20 = chart.addSeries(LWC.LineSeries, lo('#B08D3E', 2), 0);
    S.rsi = chart.addSeries(LWC.LineSeries, { color: '#D4B15C', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: 'custom', minMove: 0.1, formatter: (p) => fmtN(p, 1) }, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) }, 1);
    S.rsi70 = S.rsi.createPriceLine({ price: 70, color: 'rgba(155,164,178,0.5)', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false, title: '' });
    S.rsi30 = S.rsi.createPriceLine({ price: 30, color: 'rgba(155,164,178,0.5)', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false, title: '' });
    const macdFmt = { type: 'custom', minMove: 0.0001, formatter: (p) => fmtN(p, Math.abs(p) >= 100 || p === 0 ? 0 : Math.abs(p) >= 1 ? 2 : 4) };
    S.macdH = chart.addSeries(LWC.HistogramSeries, { lastValueVisible: false, priceLineVisible: false, priceFormat: macdFmt }, 2);
    S.macd = chart.addSeries(LWC.LineSeries, { color: '#E8E3D8', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: macdFmt }, 2);
    S.sig = chart.addSeries(LWC.LineSeries, { color: '#B08D3E', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: macdFmt }, 2);
    S.reg = chart.addSeries(LWC.HistogramSeries, { lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'custom', minMove: 1, formatter: () => '' }, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }) }, 3);
    try { chart.priceScale('right', 3).applyOptions({ scaleMargins: { top: 0.1, bottom: 0 }, borderVisible: false, ticksVisible: false }); } catch (e) { /* opcional */ }
    const panes = chart.panes();
    if (panes.length >= 4) {
      panes[0].setStretchFactor(5.2); panes[1].setStretchFactor(1.35); panes[2].setStretchFactor(1.35); panes[3].setStretchFactor(0.3);
      const wm = (p, t) => { try { LWC.createTextWatermark(p, { horzAlign: 'left', vertAlign: 'top', lines: [{ text: t, color: 'rgba(155,164,178,0.55)', fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }] }); } catch (e) { /* opcional */ } };
      wm(panes[1], 'RSI (14) · 30 / 70'); wm(panes[2], 'MACD (12, 26, 9)');
    }
    markersApi = LWC.createSeriesMarkers(S.candles, []);
    paintChart();
    chart.subscribeCrosshairMove((param) => {
      if (!state.A) return;
      if (!param || param.logical == null || param.point == null) { renderLegend(null); return; }
      renderLegend(Math.round(param.logical));
    });
  }

  function renderChart(A, keepRange) {
    const d = A.d, ind = A.ind;
    const cd = [], vd = [], e20 = [], e50 = [], s200 = [], bu = [], bl = [], rs = [], mh = [], ml = [], ms = [], rg = [];
    for (let i = 0; i < d.n; i++) {
      const t = d.t[i];
      cd.push({ time: t, open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i] });
      vd.push({ time: t, value: d.v[i], color: d.c[i] >= d.o[i] ? 'rgba(25,158,112,0.30)' : 'rgba(230,103,103,0.30)' });
      if (isFinite(ind.ema20[i])) e20.push({ time: t, value: ind.ema20[i] });
      if (isFinite(ind.ema50[i])) e50.push({ time: t, value: ind.ema50[i] });
      if (isFinite(ind.sma200[i])) s200.push({ time: t, value: ind.sma200[i] });
      if (isFinite(ind.bb.upper[i])) { bu.push({ time: t, value: ind.bb.upper[i] }); bl.push({ time: t, value: ind.bb.lower[i] }); }
      if (isFinite(ind.rsi[i])) rs.push({ time: t, value: ind.rsi[i] });
      if (isFinite(ind.macd.hist[i])) { mh.push({ time: t, value: ind.macd.hist[i], color: ind.macd.hist[i] >= 0 ? 'rgba(25,158,112,0.55)' : 'rgba(230,103,103,0.55)' }); ml.push({ time: t, value: ind.macd.line[i] }); ms.push({ time: t, value: ind.macd.signal[i] }); }
      const r = A.reg[i].regime;
      rg.push({ time: t, value: 1, color: r === 'UNKNOWN' ? 'rgba(68,81,100,0.35)' : E.REGIMES[r].color });
    }
    S.candles.setData(cd); S.vol.setData(vd); S.ema20.setData(e20); S.ema50.setData(e50); S.sma200.setData(s200);
    S.bbU.setData(bu); S.bbL.setData(bl); S.rsi.setData(rs); S.macdH.setData(mh); S.macd.setData(ml); S.sig.setData(ms); S.reg.setData(rg);
    applyVisibility(); setMarkers();
    if (!keepRange) fitDefault();
  }
  function applyVisibility() {
    if (!chart) return;
    S.ema20.applyOptions({ visible: state.show.ma }); S.ema50.applyOptions({ visible: state.show.ma }); S.sma200.applyOptions({ visible: state.show.ma });
    S.bbU.applyOptions({ visible: state.show.bb }); S.bbL.applyOptions({ visible: state.show.bb }); S.vol.applyOptions({ visible: state.show.vol });
  }
  function fitDefault() {
    if (!chart || !state.A) return;
    const n = state.A.d.n, w = (window.innerWidth || 1200) < 720 ? 90 : 150;
    chart.timeScale().setVisibleLogicalRange({ from: n - w, to: n + 3 });
  }
  function zoom(f) {
    const ts = chart.timeScale(), r = ts.getVisibleLogicalRange(); if (!r) return;
    const w = Math.max(20, Math.min(state.A.d.n + 10, (r.to - r.from) * f));
    ts.setVisibleLogicalRange({ from: r.to - w, to: r.to });
  }
  function outcomeText(o) {
    if (o.type === 'WIN') return 'alvo atingido em ' + o.bars + ' ' + pl(o.bars, 'candle', 'candles') + ' (' + fmtSPct(o.ret, 2) + ')';
    if (o.type === 'LOSS') return 'stop atingido em ' + o.bars + ' ' + pl(o.bars, 'candle', 'candles') + ' (' + fmtSPct(o.ret, 2) + ')';
    return 'prazo esgotado (' + fmtSPct(o.ret, 2) + ')';
  }
  function setMarkers() {
    const A = state.A; if (!A || !markersApi) return;
    const s = A.setups.find((x) => x.id === state.selected);
    if (!s) { markersApi.setMarkers([]); return; }
    markersApi.setMarkers(s.triggers.map((i) => {
      const o = A.outs[i];
      let color = themeColor('--gold-bright', '#D4B15C'), shape = 'circle';
      if (o) { if (o.type === 'WIN') color = themeColor('--up', '#199e70'); else if (o.type === 'LOSS') { color = themeColor('--down', '#e66767'); shape = 'square'; } else color = themeColor('--ink-mute', '#8D97A6'); }
      return { time: A.d.t[i], position: 'belowBar', shape, color, size: 1 };
    }));
  }
  function renderLegend(idx) {
    const A = state.A, d = A.d, ind = A.ind;
    let i = idx == null ? d.n - 1 : idx; if (i < 0 || i >= d.n) i = d.n - 1;
    const ch = i > 0 ? d.c[i] / d.c[i - 1] - 1 : 0, cls = ch > 0 ? 'pos' : ch < 0 ? 'neg' : 'flat';
    const R = E.REGIMES[A.reg[i].regime];
    const s = A.setups.find((x) => x.id === state.selected);
    let trig = '';
    if (s && A.trig[s.id][i]) { const o = A.outs[i]; trig = '<div class="trig">● ' + esc(s.nome) + ': ' + (o ? outcomeText(o) : 'gatilho recente, desfecho ainda não observável') + '</div>'; }
    const ma = state.show.ma ? '<span class="opt"><i class="key" style="background:#B08D3E"></i><span class="k">EMA20</span> <span class="v">' + fmtN(ind.ema20[i], 2) + '</span></span><span class="opt"><i class="key" style="background:#3987e5"></i><span class="k">EMA50</span> <span class="v">' + fmtN(ind.ema50[i], 2) + '</span></span><span class="opt"><i class="key" style="background:#d55181"></i><span class="k">MM200</span> <span class="v">' + fmtN(ind.sma200[i], 2) + '</span></span>' : '';
    $('lvLegend').innerHTML =
      '<div class="l1"><span class="k">' + fmtDate(d.t[i]) + '</span><span><span class="k">A</span> <span class="v">' + fmtN(d.o[i], 2) + '</span></span><span><span class="k">M</span> <span class="v">' + fmtN(d.h[i], 2) + '</span></span><span><span class="k">m</span> <span class="v">' + fmtN(d.l[i], 2) + '</span></span><span><span class="k">F</span> <span class="v">' + fmtN(d.c[i], 2) + '</span></span><span class="' + cls + '">' + fmtSPct(ch, 2) + '</span></div>' +
      '<div class="l2">' + ma + '<span><span class="k">RSI</span> <span class="v">' + fmtN(ind.rsi[i], 1) + '</span></span><span><i class="key" style="background:' + esc(R.color) + ';height:6px;vertical-align:1px"></i><span class="k">Regime</span> <span class="v">' + esc(R.short) + '</span></span></div>' + trig;
  }
  function renderFoot() {
    const regs = ['BULL_TREND', 'BEAR_TREND', 'HIGH_VOL_RANGING', 'LOW_VOL_RANGING', 'STRUCTURAL_BREAK'];
    $('lvFoot').innerHTML =
      '<span class="it">Velas: vazada = alta, cheia = baixa</span>' +
      '<span class="it"><span class="mk c" style="background:var(--up)"></span>alvo</span><span class="it"><span class="mk s" style="background:var(--down)"></span>stop</span><span class="it"><span class="mk c" style="background:var(--ink-mute)"></span>prazo esgotado</span><span class="it"><span class="mk c" style="background:var(--gold-bright)"></span>sem desfecho ainda</span>' +
      '<span class="it" style="color:var(--ink-ghost)">|</span>' + regs.map((r) => '<span class="it"><span class="rg" style="background:' + esc(E.REGIMES[r].color) + '"></span>' + esc(E.REGIMES[r].short) + '</span>').join('') +
      '<span class="it" style="margin-left:auto">Gráfico: TradingView Lightweight Charts™</span>';
  }

  // ------------------------------------------------------ painéis laterais
  function regimeWhy(r) {
    const a = fmtN(r.adx, 1), rv = fmtN(r.rvPct, 0), pm = fmtSPct(r.priceVsMa, 1);
    switch (r.regime) {
      case 'STRUCTURAL_BREAK': return 'Chow p = ' + fmtP(r.chowP) + ' (< 0,01): a média dos retornos dos últimos 30 candles difere da dos 90 anteriores.';
      case 'BULL_TREND': return 'ADX ' + a + ' (> 25), preço ' + pm + ' vs. MM200 e volatilidade no percentil ' + rv + ' (< 60).';
      case 'BEAR_TREND': return 'ADX ' + a + ' (> 25) com preço ' + pm + ' vs. MM200.';
      case 'LOW_VOL_RANGING': return 'ADX ' + a + ' (< 20, sem tendência definida) e volatilidade no percentil ' + rv + ' (≤ 60).';
      case 'HIGH_VOL_RANGING': return r.adx > 25 ? 'ADX ' + a + ' (> 25) acima da MM200, mas volatilidade no percentil ' + rv + ' (≥ 60).' : r.adx < 20 ? 'ADX ' + a + ' (< 20) com volatilidade no percentil ' + rv + ' (> 60).' : 'ADX ' + a + ' na zona intermediária (20–25): o método classifica como lateral.';
      default: return 'Histórico insuficiente para classificar.';
    }
  }
  function renderRead(A) {
    const T = A.tech, r = T.regime, R = E.REGIMES[r.regime];
    $('lvReadTime').textContent = fmtDate(T.time);
    $('lvRegime').innerHTML = '<div class="regime-chip"><span class="sq" style="background:' + esc(R.color) + '"></span>' + esc(r.regime) + '</div><div class="regime-title">' + esc(R.label) + '</div><div class="conf"><i style="width:' + Math.round(r.confidence * 100) + '%;background:' + esc(R.color) + '"></i></div><div class="regime-why">Confiança ' + fmtN(r.confidence * 100, 0) + '% · ' + esc(regimeWhy(r)) + '</div>';
    const items = [
      ['Preço', fmtN(T.close, 2), '24h ' + fmtSPct(T.change24) + ' · 7d ' + fmtSPct(T.change7d)],
      ['Distância da MM200', fmtSPct(T.distMa200, 1), (T.aboveMa200 ? 'acima' : 'abaixo') + ' há ' + T.barsVsMa200 + ' candles'],
      ['ADX (14)', fmtN(T.adx, 1), T.adx > 25 ? 'tendência presente' : T.adx < 20 ? 'sem tendência definida' : 'zona intermediária'],
      ['RSI (14)', fmtN(T.rsi, 1), 'zona ' + T.rsiZone],
      ['MACD', T.macdAbove ? 'acima do sinal' : 'abaixo do sinal', 'há ' + T.macdBarsSinceCross + ' candles · histograma ' + (T.histExpanding ? 'expandindo' : 'contraindo')],
      ['Médias', T.emaAligned ? 'EMA20 > EMA50' : 'EMA20 < EMA50', 'DI+ ' + fmtN(T.diPlus, 1) + ' · DI− ' + fmtN(T.diMinus, 1)],
      ['ATR (14)', fmtN(T.atr, 2), fmtPct(T.atrPct, 2) + ' do preço por candle'],
      ['Volatilidade realizada', 'percentil ' + fmtN(T.rvPct, 0), 'entre os últimos 252 candles'],
      ['Volume', (T.volZ >= 0 ? '+' : '−') + fmtN(Math.abs(T.volZ), 1) + ' σ', 'vs. média de 30 candles'],
      ['Canal de 20 candles', fmtPct(T.rangePos, 0) + ' da faixa', 'máx ' + fmtN(T.hh20, 2) + ' · mín ' + fmtN(T.ll20, 2)]
    ];
    $('lvKv').innerHTML = items.map((x) => '<div class="kvi"><div class="l">' + esc(x[0]) + '</div><div class="v">' + esc(x[1]) + '</div><div class="d">' + esc(x[2]) + '</div></div>').join('');
  }
  function renderTop(A) {
    const T = A.tech;
    $('lvPair').textContent = PAIR(state.sym) + ' · ' + TF_LABEL[state.tf];
    $('lvPx').textContent = fmtN(T.close, 2);
    const c = T.change24; $('lvChg').className = 'chg ' + (c > 0 ? 'pos' : c < 0 ? 'neg' : 'flat'); $('lvChg').textContent = fmtSPct(c) + ' em 24h';
  }
  function renderSource() {
    const en = entry(state.sym, state.tf), d = en.d, last = d.t[d.n - 1], el = $('lvSrc');
    if (en.source === 'live' && en.via === 'base') { el.classList.add('live'); $('lvSrcText').innerHTML = '<b>Base de candles</b> · Binance Spot via Stratum · último candle fechado ' + fmtDate(last) + ' · tenta o ao vivo a cada 60 s'; }
    else if (en.source === 'live') { el.classList.add('live'); $('lvSrcText').innerHTML = '<b>Ao vivo</b> · Binance Spot · último candle fechado ' + fmtDate(last) + ' · atualiza a cada 60 s'; }
    else {
      el.classList.remove('live');
      $('lvSrcText').innerHTML = '<b>Dados reais</b> · Binance Spot · snapshot até ' + fmtDate(last) + (en.liveError ? ' · sem conexão com a Binance agora' : ' · conectando à Binance…');
    }
  }

  // ------------------------------------------------------------ pipeline
  const PIPE = [
    { id: 'pesq', nm: 'Agente de Pesquisa', pill: ['prod', 'Produção'] },
    { id: 'back', nm: 'Agente de Backtest', pill: ['prod', 'Produção'] },
    { id: 'deb', nm: 'Agente de Debate', pill: ['proto', 'Protótipo'] },
    { id: 'risk', nm: 'Agente de Risco', pill: ['proto', 'Protótipo'] },
    { id: 'exec', nm: 'Agente de Execução', pill: ['lock', 'Desligado'], fixed: 'off' },
    { id: 'rev', nm: 'Revisão', pill: ['hum', 'Humana'], fixed: 'human' }
  ];
  function pipeResults(A) {
    const T = A.tech, dbt = debatePoints(A);
    const act = A.setups.filter((s) => s.activeNow).length, edge = A.setups.filter((s) => s.verdict.key === 'EDGE' || s.verdict.key === 'EDGE_SENSIVEL').length;
    const scan = scanTerms(reportToMarkdown(buildReport(A)));
    return {
      pesq: fmtInt(A.d.n) + ' candles ' + PAIR(state.sym) + ' ' + TF_LABEL[state.tf] + ' · Binance · ' + (gapsOf(A.d) ? gapsOf(A.d) + ' lacunas' : 'sem lacunas') + ' · indicadores e regime (' + E.REGIMES[T.regime.regime].short + ')',
      back: '8 setups × 3.000 sorteios aleatórios · ' + act + ' ' + pl(act, 'com gatilho recente', 'com gatilho recente') + ' · ' + edge + ' com vantagem estatística',
      deb: dbt.pro.length + ' argumentos a favor da leitura de tendência · ' + dbt.con.length + ' contra',
      risk: 'ATR ' + fmtPct(T.atrPct, 2) + ' por candle · CVaR 5% de 1 candle ' + fmtSPct(T.cvar1bar, 2) + ' · maior queda recente ' + fmtSPct(T.maxDD, 1),
      exec: 'Nenhuma ordem é enviada, em nenhuma versão. Princípio permanente do produto.',
      rev: 'Vocabulário verificado: ' + (scan.length ? scan.length + ' ' + pl(scan.length, 'termo sinalizado', 'termos sinalizados') : 'nenhum termo de instrução ou promessa') + ' · envio a cliente só após revisão humana'
    };
  }
  // Animação das etapas (uma por vez). pipeBusy: o laço roda; pipeK: próxima etapa do laço; pipePromise: o que run() aguarda; pipeEnd: encerra o laço à força.
  let pipeBusy = false, pipeK = 0, pipePromise = null, pipeEnd = null;
  function renderPipeline(A, animate) {
    const res = pipeResults(A), ol = $('lvPipe');
    const cont = !animate && pipeBusy; // análise nova no meio da animação: ela segue, sem recomeçar
    ol.innerHTML = PIPE.map((p) => '<li id="lvP_' + p.id + '" class="' + (p.fixed === 'off' ? 'off' : p.fixed === 'human' ? 'human' : '') + '"><span class="ic" aria-hidden="true"></span><span class="nm">' + p.nm + '</span><span class="pill ' + p.pill[0] + '">' + p.pill[1] + '</span><span class="rs" data-final="' + esc(res[p.id]) + '">' + (animate || cont ? '' : esc(res[p.id])) + '</span></li>').join('');
    $('lvPipeTime').textContent = 'motor em ' + fmtN(A.ms, 0) + ' ms';
    if (cont) {
      // o que o laço já passou fica pronto; a etapa em andamento segue; as seguintes esperam o laço
      PIPE.forEach((p, i) => {
        const li = $('lvP_' + p.id), rs = li.querySelector('.rs');
        if (i < pipeK - 1) { if (!p.fixed) li.classList.add('done'); rs.textContent = rs.getAttribute('data-final'); }
        else if (i === pipeK - 1) { if (!p.fixed) li.classList.add('run'); else rs.textContent = rs.getAttribute('data-final'); }
      });
      return pipePromise;
    }
    PIPE.forEach((p) => { if (!animate && !p.fixed) $('lvP_' + p.id).classList.add('done'); });
    if (!animate) return Promise.resolve();
    if (pipeEnd) pipeEnd(); // laço anterior, se ainda corria, termina já: quem o aguarda não fica preso
    clearTimeout(state.pipeTimer);
    const steps = PIPE.map((p) => p.id), delay = REDUCED ? 0 : 420;
    pipeBusy = true; pipeK = 0;
    pipePromise = new Promise((resolve) => {
      pipeEnd = resolve;
      let k = 0;
      const tick = () => {
        if (k > 0) { const prev = $('lvP_' + steps[k - 1]); if (prev) { prev.classList.remove('run'); if (!PIPE[k - 1].fixed) prev.classList.add('done'); const rs = prev.querySelector('.rs'); rs.textContent = rs.getAttribute('data-final'); } }
        if (k >= steps.length) { pipeBusy = false; resolve(); return; }
        const li = $('lvP_' + steps[k]); if (li && !PIPE[k].fixed) li.classList.add('run'); if (li && PIPE[k].fixed) { const rs = li.querySelector('.rs'); rs.textContent = rs.getAttribute('data-final'); }
        k++; pipeK = k; state.pipeTimer = setTimeout(tick, PIPE[k - 1].fixed ? delay / 3 : delay);
      };
      tick();
    });
    return pipePromise;
  }

  // ------------------------------------------------------- banco de setups
  // Recorte por regime (lib/regime-view.js, global ArgosRegimeView): descritivo. O teste (p) e o veredito do motor valem
  // para o conjunto completo de gatilhos; o motor 1.1 não testa por regime.
  const rvCache = new WeakMap();
  function regimeOf(A) {
    if (!RV) return null;
    let v = rvCache.get(A);
    if (!v) { v = RV.regimeView(E, A); rvCache.set(A, v); }
    return v;
  }
  function regimeChoice(V) { // regime escolhido no seletor (null = conjunto completo)
    if (!V || state.regimeSel === 'ALL') return null;
    const r = state.regimeSel === 'CURRENT' ? V.current : state.regimeSel;
    return V.regimes.indexOf(r) >= 0 ? r : null;
  }
  function renderRegimeFilter(V) {
    const box = $('lvRegFilter'), sel = $('lvRegSel'); if (!box || !sel) return;
    if (!V) { box.hidden = true; return; }
    box.hidden = false;
    const opts = [['ALL', 'Todos os regimes'], ['CURRENT', 'Regime atual (' + E.REGIMES[V.current].label + ')']].concat(V.regimes.map((r) => [r, E.REGIMES[r].label]));
    const sig = opts.map((o) => o.join('=')).join('|');
    if (sel.getAttribute('data-sig') !== sig) { sel.innerHTML = opts.map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join(''); sel.setAttribute('data-sig', sig); }
    sel.value = state.regimeSel;
  }
  function renderBank(A) {
    const V = regimeOf(A), reg = regimeChoice(V);
    renderRegimeFilter(V);
    if ($('lvRegNote')) $('lvRegNote').hidden = !reg;
    const cellOf = (s) => (reg ? V.bySetup[s.id][reg] : null); // recorte do setup no regime escolhido
    const fin = (x) => (isFinite(x) ? x : 0);
    const baseNow = reg ? V.bySetup[A.setups[0].id][reg].base.rate : A.base.rate;
    const maxX = Math.min(1, Math.max(0.5, fin(baseNow), ...A.setups.map((s) => fin((reg ? cellOf(s) : s).ci[1]))) * 1.04);
    const X = (v) => Math.max(0, Math.min(100, (v / maxX) * 100));
    const head = '<thead><tr><th scope="col">Setup</th><th scope="col">Agora</th><th scope="col">N (efetivo)</th><th scope="col">Taxa de acerto</th><th scope="col">IC 95% · escala 0–' + fmtN(maxX * 100, 0) + '%</th><th scope="col">' + (reg ? 'Taxa-base no regime' : 'Taxa-base') + '</th><th scope="col">p (ajustado)</th><th scope="col">Veredito</th></tr></thead>';
    const rows = A.setups.map((s, ri) => {
      const now = s.activeNow ? '<span class="now on">Disparou ' + (s.barsSinceLast === 0 ? 'no último candle' : 'há ' + s.barsSinceLast + ' ' + pl(s.barsSinceLast, 'candle', 'candles')) + '</span>' : '<span class="now off">' + (s.lastTrigger >= 0 ? 'há ' + s.barsSinceLast + ' candles' : 'sem gatilhos') + '</span>';
      const c = cellOf(s), v = c || s, bRate = c ? c.base.rate : s.base;
      const bs = isFinite(bRate) ? '<div class="bs" style="left:' + X(bRate) + '%"></div>' : '';
      // A faixa do IC cresce a partir da taxa-base (origem da transformação em % da própria faixa, de 0 a 100); --ci-i é a escada entre linhas.
      // Ambos só valem sob .ci-grow (ver platform-motion.css): sem a classe, a faixa está sempre no estado final.
      const ciW = Math.max(1, X(v.ci[1]) - X(v.ci[0])), ciO = (X(isFinite(bRate) ? bRate : v.winRate) - X(v.ci[0])) / ciW * 100, ciOrg = isFinite(ciO) ? Math.max(0, Math.min(100, ciO)) : 0;
      const viz = isFinite(v.ci[0]) ? '<div class="civiz" aria-hidden="true" style="--ci-i:' + ri + '"><div class="track"></div><div class="rng" style="left:' + X(v.ci[0]) + '%;width:' + ciW + '%;transform-origin:' + ciOrg + '% 50%"></div>' + bs + '<div class="pt" style="left:' + X(v.winRate) + '%"></div></div>' : '—';
      const empty = !!c && !v.n; // regime sem gatilho encerrado: não há N efetivo nem taxa
      const nCell = v.n + ' <span class="num-dim">(' + (empty ? '—' : v.nEff) + ')</span>';
      const wrCell = empty ? '—' : fmtPct(v.winRate, 1) + ' <span class="num-dim">[' + fmtPct(v.ci[0], 0) + '–' + fmtPct(v.ci[1], 0) + ']</span>';
      const baseCell = c ? fmtPct(bRate, 1) + ' <span class="num-dim">(' + fmtInt(c.base.n) + ')</span>' : fmtPct(s.base, 1);
      const pCell = c ? '—' : fmtP(s.pTwo) + ' <span class="num-dim">(' + fmtP(s.q) + ')</span>';
      const verdict = c ? '<span class="verdict ' + (c.insufficient ? 'neutral' : 'muted') + '">' + (c.insufficient ? 'Evidência insuficiente' : 'Recorte descritivo') + '</span>' : '<span class="verdict ' + esc(s.verdict.tone) + '">' + esc(s.verdict.label) + '</span>';
      return '<tr data-id="' + esc(s.id) + '" tabindex="0" class="' + (s.id === state.selected ? 'sel' : '') + '" aria-selected="' + (s.id === state.selected) + '"><td class="c-name"><div><div class="sname">' + esc(s.nome) + '</div><div class="sgrp">' + esc(s.grupo) + '</div></div></td><td class="c-now">' + now + '</td><td class="c-n" data-l="N (efetivo)">' + nCell + '</td><td class="c-wr" data-l="Taxa de acerto · IC 95%">' + wrCell + '</td><td class="c-viz">' + viz + '</td><td class="c-base" data-l="' + (c ? 'Taxa-base no regime · N' : 'Taxa-base') + '">' + baseCell + '</td><td class="c-p" data-l="p · ajustado">' + pCell + '</td><td class="c-verdict">' + verdict + '</td></tr>';
    }).join('');
    const tbl = $('lvBank');
    if (tbl.classList.contains('ci-grow')) tbl.style.setProperty('--ci-skip', '-' + (Date.now() - mo.growT0) + 'ms'); // redesenho no meio do crescimento (ex.: candles ao vivo chegando): a faixa nova continua do ponto em que a anterior estava
    tbl.innerHTML = head + '<tbody>' + rows + '</tbody>';
    const d = A.d;
    $('lvBankSub').textContent = 'Cada setup é testado agora contra ' + fmtInt(d.n - A.warm) + ' candles reais de ' + PAIR(state.sym) + ' ' + TF_LABEL[state.tf] + ' (' + fmtDay(d.t[A.warm]) + ' a ' + fmtDay(d.t[d.n - 1]) + '), com a regra de saída "' + cfgText(state.cfg) + '" aplicada também a entradas aleatórias (taxa-base: ' + fmtPct(A.base.rate, 1) + '). Toque numa linha para ver os gatilhos no gráfico.';
  }
  function selectSetup(id, scroll) {
    state.selected = id;
    document.querySelectorAll('#lvBank tbody tr').forEach((tr) => { const on = tr.getAttribute('data-id') === id; tr.classList.toggle('sel', on); tr.setAttribute('aria-selected', on); });
    setMarkers(); renderDetail(state.A);
    if (MOT()) { const d = $('lvDetail'); d.classList.remove('m-swap'); void d.offsetWidth; d.classList.add('m-swap'); } // troca do painel: esmaecer de interface (160 ms)
    renderLegend(null);
    touchUrl();
    if (scroll) { const el = document.querySelector('#dash-live .chart-card'); if (el) el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); }
  }

  function renderDetail(A) {
    const s = A.setups.find((x) => x.id === state.selected); if (!s) { $('lvDetail').innerHTML = ''; return; }
    const d = A.d, maxX = Math.max(0.5, ...Object.values(s.byRegime).map((r) => r.w / r.n), A.base.rate) * 1.05;
    const stat =(l, v, sub) => '<div class="dstat"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + sub + '</div></div>';
    let wf = '<p class="note">' + esc(s.wf.reason || '') + '</p>';
    if (s.wf.available) {
      wf = '<div class="table-scroll"><table class="wf"><thead><tr><th>Janela de teste</th><th>Treino N</th><th>Treino</th><th>Teste N</th><th>Teste</th><th>Queda</th><th></th></tr></thead><tbody>' +
        s.wf.walks.map((w, k) => '<tr><td>' + (k + 2) + ' · ' + fmtDay(d.t[w.from]) + ' → ' + fmtDay(d.t[w.to]) + '</td><td>' + w.trainN + '</td><td>' + fmtPct(w.trainWR, 1) + '</td><td>' + w.testN + '</td><td>' + fmtPct(w.testWR, 1) + '</td><td>' + (w.dropPP >= 0 ? '−' : '+') + fmtN(Math.abs(w.dropPP), 1) + ' pp</td><td>' + (w.overfit ? '<span class="flag">queda &gt; 15 pp</span>' : '<span class="ok">estável</span>') + '</td></tr>').join('') +
        '</tbody></table></div><p class="note">Brier fora da amostra: <b style="color:var(--ink)">' + fmtN(s.wf.brier, 3) + '</b> em ' + s.wf.nPred + ' previsões; prever a taxa-base conhecida na época daria ' + fmtN(s.wf.brierRef, 3) + ' (ganho ' + fmtSPct(s.wf.bss, 1) + '). ' + (s.wf.consistent ? 'Nenhuma janela caiu mais de 15 pp.' : 'Ao menos uma janela caiu mais de 15 pp: o resultado depende do subperíodo.') + '</p>';
    }
    const regs = Object.keys(s.byRegime).filter((r) => r !== 'UNKNOWN').sort((a, b) => s.byRegime[b].n - s.byRegime[a].n);
    const V = regimeOf(A); // mesmo N efetivo e mesmo corte (10) do recorte da tabela
    const rb = regs.length ? regs.map((r) => { const x = s.byRegime[r], wr = x.w / x.n, c = V && V.bySetup[s.id][r], low = !!(c && c.insufficient); return '<div class="rbar"><span>' + esc(E.REGIMES[r].short) + (low ? '<span class="flag" title="N efetivo ' + c.nEff + ' (mínimo ' + RV.MIN_EFFECTIVE + ')">evidência insuficiente</span>' : '') + '</span><span class="tr"><span class="fl" style="width:' + Math.min(100, (wr / maxX) * 100) + '%;background:' + esc(E.REGIMES[r].color) + '"></span><span class="bt" style="left:' + Math.min(100, (A.base.rate / maxX) * 100) + '%"></span></span><span class="vv">' + fmtPct(wr, 0) + ' · N ' + x.n + '</span></div>'; }).join('') : '<p class="note">Sem gatilhos com desfecho.</p>';
    $('lvDetail').innerHTML =
      '<div class="detail-h"><div><h3>' + esc(s.nome) + ' <span class="verdict ' + esc(s.verdict.tone) + '" style="vertical-align:3px;margin-left:6px">' + esc(s.verdict.label) + '</span></h3><p>' + esc(s.def) + '</p></div>' +
      '<div class="detail-actions"><button type="button" class="btn btn-sm" id="lvShowTrig">Ver gatilhos no gráfico</button><button type="button" class="btn btn-sm" id="lvRegBtn" title="O servidor calcula e registra este veredito com data comprovável">Registrar este veredito</button><button type="button" class="btn btn-sm btn-ai" id="lvOpenPine">Levar para o TradingView (Pine)</button></div></div>' +
      '<div class="ai-note" id="lvRegBox" role="status" hidden></div>' +
      '<div class="dgrid">' +
      stat('Gatilhos com desfecho', s.n + ' <span style="font-size:12px;color:var(--ink-faint)">(N efetivo ' + s.nEff + ')</span>', 'ρ serial ' + fmtN(s.rho, 2) + ' · evidência ' + esc({ INSUFFICIENT: 'insuficiente', LOW: 'baixa', MODERATE: 'moderada', HIGH: 'alta' }[s.tier] || String(s.tier))) +
      stat('Taxa de acerto', fmtPct(s.winRate, 1), 'IC 95% ' + fmtPct(s.ci[0], 1) + '–' + fmtPct(s.ci[1], 1) + ' (' + (s.method === 'wilson' ? 'Wilson' : 'Bayes Beta-Binomial') + ')') +
      stat('Contra o acaso', (s.alphaPP >= 0 ? '+' : '−') + fmtN(Math.abs(s.alphaPP), 1) + ' pp', 'taxa-base ' + fmtPct(s.base, 1) + ' · p ' + fmtP(s.pTwo) + ' · ajustado (' + s.family + ' testes) ' + fmtP(s.q)) +
      stat('Risco por gatilho', fmtSPct(s.cvar, 2), 'CVaR 5% · excursão adversa mediana ' + fmtSPct(s.maeMedian, 2)) +
      '</div>' +
      '<div class="dcols"><div><div class="mini-h">Walk-forward · treino acumulado → próxima janela</div>' + wf + '</div><div><div class="mini-h">Taxa de acerto por regime no gatilho · │ taxa-base</div><div class="rbars">' + rb + '</div><p class="note">Resultado médio por gatilho após custo de 0,1%: ' + fmtSPct(s.meanNet, 2) + ' · ' + s.timeouts + ' ' + pl(s.timeouts, 'gatilho terminou', 'gatilhos terminaram') + ' por prazo. ' + (V && regs.some((r) => V.bySetup[s.id][r].insufficient) ? 'Regime marcado como evidência insuficiente tem menos de ' + RV.MIN_EFFECTIVE + ' gatilhos efetivos: a barra é só descrição. ' : '') + 'Dados históricos: não garantem resultado futuro.</p></div></div>';
    $('lvShowTrig').onclick = () => selectSetup(s.id, true);
    $('lvOpenPine').onclick = () => openPine(s);
    $('lvRegBtn').onclick = registerVerdict;
    renderRegBox();
  }

  // ------------------------------------ registro do veredito (prova de previsão)
  // O registro é do servidor: ele roda o motor sobre os candles que tem, monta o registro canônico e grava o hash
  // (contrato em docs/api-proof.md, seção 2). O navegador manda só a pergunta, nunca número. Por isso a tela
  // mostra apenas o que o servidor devolveu (hash, hora, link da prova), não os números calculados aqui.
  const CAN_REGISTER = /^https?:$/.test(location.protocol);
  const regKey = () => [state.sym, state.tf, state.cfg.mode, state.cfg.tgt, state.cfg.stp, state.cfg.hold, state.win || 'all', state.selected].join('|');
  function proofUrl(r) { // só caminho relativo do próprio site (a resposta do servidor não pode levar a outro endereço)
    if (typeof r.verifyUrl === 'string' && /^\/(?!\/)[^\s\\]*$/.test(r.verifyUrl)) return r.verifyUrl;
    return typeof r.id === 'string' && /^[0-9a-f-]{8,40}$/i.test(r.id) ? '/verificar.html?id=' + encodeURIComponent(r.id) : '';
  }
  function renderRegBox() {
    const box = $('lvRegBox'), btn = $('lvRegBtn'); if (!box || !btn) return;
    const st = CAN_REGISTER ? state.regs[regKey()] : null;
    const busy = !!(st && st.phase === 'busy');
    btn.disabled = !CAN_REGISTER || busy;
    btn.textContent = busy ? 'Registrando…' : 'Registrar este veredito';
    if (!CAN_REGISTER) { box.hidden = false; box.textContent = 'O registro com data comprovável é feito pelo servidor e está disponível na versão publicada da plataforma.'; return; }
    if (!st) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    if (st.phase === 'busy') { box.textContent = 'Registrando no servidor…'; return; }
    if (st.phase === 'auth') { askCode(st.msg, box, registerVerdict); return; }
    if (st.phase === 'err') { box.textContent = st.msg; return; }
    const r = st.res, t = Date.parse(r.emittedAt), url = proofUrl(r);
    const abbr = r.hash.slice(0, 12) + '…' + r.hash.slice(-8);
    box.innerHTML = '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px"><strong style="color:var(--ink)">Veredito registrado</strong><span>hash <span id="lvRegHash" title="' + esc(r.hash) + '" style="color:var(--ink)">' + esc(abbr) + '</span></span><button type="button" class="btn btn-sm" id="lvRegCopy">Copiar hash</button>' + (url ? '<a class="btn btn-sm" id="lvRegProof" href="' + esc(url) + '" target="_blank" rel="noopener">Abrir prova ↗</a>' : '') + '</div>' +
      '<p class="note">Registro feito pelo servidor em ' + (isFinite(t) ? esc(fmtDate(t / 1000)) : 'horário não informado') + '. A raiz do dia é ancorada depois de 00:10 UTC.' + (r.inserted === false ? ' Esta mesma pergunta, sobre os mesmos dados, já estava registrada: o registro existente foi devolvido.' : '') + '</p>' +
      '<p class="note">Os números do registro são os calculados pelo servidor, sobre os candles que ele tinha naquele momento, e podem diferir dos exibidos nesta tela. Eles estão na prova.</p>' +
      (typeof r.disclaimer === 'string' && r.disclaimer ? '<p class="note">' + esc(r.disclaimer) + '</p>' : '');
    $('lvRegCopy').onclick = async () => { const ok = await copyText(r.hash, null, ''); const b = $('lvRegCopy'); if (!b) return; b.textContent = ok ? 'Copiado' : 'Não copiou'; setTimeout(() => { const b2 = $('lvRegCopy'); if (b2) b2.textContent = 'Copiar hash'; }, 1800); };
    // Retorno visual: o hash que o servidor devolveu (nunca um provisório) aparece caractere a caractere, uma única vez, quando a
    // resposta chega. Reabrir o painel, trocar de linha ou redesenhar mostra o hash pronto. Termina com o texto exato.
    if (st.fresh) { st.fresh = false; const M = MOT(), hs = $('lvRegHash'); if (M && hs) M.typeText(hs, abbr, 600); }
  }
  async function registerVerdict() {
    if (!CAN_REGISTER || !state.A || !state.selected) return;
    const k = regKey();
    if (state.regs[k] && state.regs[k].phase === 'busy') return;
    const hadCode = !!getCode(), A = state.A;
    const body = { symbol: state.sym, tf: state.tf, cfg: { ...state.cfg }, windowDays: (A.meta && A.meta.win) || null, setupId: state.selected };
    const put = (v) => { state.regs[k] = v; if (regKey() === k) renderRegBox(); };
    put({ phase: 'busy' });
    let r, j = null;
    try {
      r = await fetch(CFG.previsoes || '/api/previsoes', { method: 'POST', headers: { 'content-type': 'application/json', 'x-argos-code': getCode() }, body: JSON.stringify(body) });
      try { j = await r.json(); } catch (e) { j = null; }
    } catch (e) { put({ phase: 'err', msg: 'Não foi possível registrar o veredito. Verifique a conexão e tente de novo.' }); return; }
    const code = j && j.error && typeof j.error === 'object' && j.error.code ? String(j.error.code) : '';
    if ((r.status === 200 || r.status === 201) && j && typeof j.hash === 'string' && /^[0-9a-f]{64}$/i.test(j.hash)) {
      put({ phase: 'ok', res: j, fresh: regKey() === k }); // fresh: a caixa está na tela agora, então o hash entra digitado (só esta vez)
      try { rememberReg(j, body, A); } catch (e) { /* a lista local é conveniência: nunca atrapalha o registro */ }
      return;
    }
    if (r.status === 503 && code === 'banco_ausente') { put({ phase: 'err', msg: 'Registro indisponível neste ambiente: banco não configurado.' }); return; }
    if (r.status === 401) { put({ phase: 'auth', msg: hadCode ? 'Código incorreto. Digite de novo:' : 'Digite o código de acesso para registrar o veredito:' }); return; }
    console.warn('[argos] registro de veredito falhou:', code || (r.ok ? 'resposta_invalida' : 'http_' + r.status));
    put({ phase: 'err', msg: 'Não foi possível registrar o veredito agora. Tente de novo em instantes.' });
  }

  // ------------------------------------ registros deste navegador (lista local)
  // Cada veredito registrado a partir desta tela entra numa lista do próprio navegador (localStorage, uma chave com
  // versão). A lista guarda só o que o servidor e a tela já mostram, sem dado pessoal. Os registros ficam no servidor:
  // apagar a lista não apaga prova alguma. O estado do carimbo vem de GET /api/proof?id= (docs/api-proof.md, seção 3.1)
  // e é consultado ao abrir a tela e no botão "Atualizar", nunca em laço.
  const REG_KEY = 'argos.registros.v1'; // {"v":1,"items":[{id,hash,symbol,tf,setupId,setupName,verdict:{key,label,tone},at,verifyUrl}]}
  const REG_MAX = 50;
  const REG_REFRESH_MS = 60000; // ao reabrir a tela, o carimbo só é consultado de novo depois deste intervalo
  const REG_EMPTY = 'Aqui aparecem os vereditos registrados neste navegador; o botão “Registrar este veredito”, no painel do setup, cria o registro.';
  const HASH_RE = /^[0-9a-f]{64}$/i, ID_RE = /^[0-9a-f-]{8,40}$/i;
  const TONES = ['good', 'warn', 'muted', 'bad', 'neutral'];
  const STAMP = { // estado do carimbo: [tom, texto]
    consultando: ['neutral', 'consultando…'],
    aguardando: ['warn', 'aguardando o fechamento do dia'],
    pendente: ['warn', 'dia fechado, carimbo pendente'],
    ancorada: ['good', 'ancorada'],
    confirmada: ['good', 'confirmada'],
    falhou: ['bad', 'falhou'],
    indisponivel: ['muted', 'indisponível']
  };
  const REG_HL_MS = 1300; // destaque do registro novo na lista (a animação em CSS dura 1,2 s); fora dessa janela, a lista não destaca nada
  const regs = { items: [], stamps: {}, busy: false, last: 0, persist: true, confirm: false, ui: null, fresh: null };
  const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

  function cleanReg(x) { // tudo que vem do localStorage (ou da resposta do servidor) é validado antes de ser usado
    if (!x || typeof x !== 'object') return null;
    const hash = typeof x.hash === 'string' && HASH_RE.test(x.hash) ? x.hash.toLowerCase() : null;
    const t = typeof x.at === 'string' ? Date.parse(x.at) : NaN;
    if (!hash || !isFinite(t)) return null;
    const id = typeof x.id === 'string' && ID_RE.test(x.id) ? x.id : null, v = x.verdict && typeof x.verdict === 'object' ? x.verdict : {};
    return {
      id, hash,
      symbol: typeof x.symbol === 'string' && /^[A-Z0-9]{3,20}$/.test(x.symbol) ? x.symbol : '',
      tf: ['1h', '4h', '1d'].indexOf(x.tf) >= 0 ? x.tf : '',
      setupId: typeof x.setupId === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(x.setupId) ? x.setupId : '',
      setupName: clip(x.setupName, 80),
      verdict: { key: clip(v.key, 24), label: clip(v.label, 80), tone: TONES.indexOf(v.tone) >= 0 ? v.tone : 'neutral' },
      at: new Date(t).toISOString(),
      verifyUrl: proofUrl({ verifyUrl: x.verifyUrl, id })
    };
  }
  function regNormalize(list) { // sem repetição, do mais novo para o mais antigo, até REG_MAX
    const seen = {}, out = [];
    list.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).forEach((x) => { if (!seen[x.hash]) { seen[x.hash] = true; out.push(x); } });
    return out.slice(0, REG_MAX);
  }
  function regLoad() { // null = o navegador não deixou ler
    let raw;
    try { raw = localStorage.getItem(REG_KEY); } catch (e) { return null; }
    if (!raw) return [];
    try {
      const j = JSON.parse(raw);
      return j && j.v === 1 && Array.isArray(j.items) ? regNormalize(j.items.map(cleanReg).filter(Boolean)) : [];
    } catch (e) { return []; }
  }
  function regSave() {
    try { localStorage.setItem(REG_KEY, JSON.stringify({ v: 1, items: regs.items })); regs.persist = true; } catch (e) { regs.persist = false; } // cheio, bloqueado ou sem storage
  }
  function rememberReg(res, body, A) {
    const s = A.setups.find((x) => x.id === body.setupId); if (!s) return;
    const item = cleanReg({
      id: res.id, hash: res.hash, symbol: body.symbol, tf: body.tf, setupId: s.id, setupName: s.nome,
      verdict: { key: s.verdict.key, label: s.verdict.label, tone: s.verdict.tone },
      at: isFinite(Date.parse(res.emittedAt)) ? res.emittedAt : new Date().toISOString(), verifyUrl: res.verifyUrl
    });
    if (!item) return;
    if (regs.persist) { const cur = regLoad(); if (cur) regs.items = cur; } // junta o que outra aba tenha gravado
    const isNew = res.inserted !== false && !regs.items.some((x) => x.hash === item.hash); // registro que o servidor acabou de criar e que ainda não estava na lista
    regs.items = regNormalize([item].concat(regs.items));
    regSave();
    if (res.anchorPending && typeof res.anchorPending === 'object') regs.stamps[item.hash] = { s: 'aguardando' }; // vem na própria resposta do registro
    else delete regs.stamps[item.hash];
    regs.fresh = isNew && MOT() ? { hash: item.hash, t0: Date.now() } : null; // destaque que se apaga sozinho, só neste registro novo
    regRender();
    if (!regs.stamps[item.hash]) regRefresh([item]);
  }
  function stampOf(j, it) {
    if (!j || typeof j !== 'object') return { s: 'indisponivel', why: 'resposta_invalida' };
    const p = j.previsao;
    if (p && typeof p === 'object' && typeof p.hash === 'string' && p.hash.toLowerCase() !== it.hash) return { s: 'indisponivel', why: 'hash_diferente' };
    const a = j.anchor;
    if (a && typeof a === 'object') return ['pendente', 'ancorada', 'confirmada', 'falhou'].indexOf(a.status) >= 0 ? { s: a.status } : { s: 'indisponivel', why: 'estado_desconhecido' };
    if (j.anchorPending && typeof j.anchorPending === 'object') return { s: 'aguardando' };
    return { s: 'indisponivel', why: 'sem_ancora' };
  }
  async function regFetch(it) {
    const q = it.id ? 'id=' + encodeURIComponent(it.id) : 'hash=' + encodeURIComponent(it.hash);
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch((CFG.proof || '/api/proof') + '?' + q, { headers: { accept: 'application/json' }, cache: 'no-store', signal: ctl.signal });
      if (!r.ok) return { s: 'indisponivel', why: 'http_' + r.status };
      let j = null; try { j = await r.json(); } catch (e) { j = null; }
      return stampOf(j, it);
    } catch (e) { return { s: 'indisponivel', why: 'sem_conexao' }; }
    finally { clearTimeout(to); }
  }
  async function regRefresh(only) { // `only`: lista de itens a consultar (um registro novo); sem ele, consulta a lista inteira
    if (!CAN_REGISTER || (!only && regs.busy)) return;
    const todo = (only || regs.items).filter((it) => !(regs.stamps[it.hash] && regs.stamps[it.hash].s === 'confirmada')); // confirmada não muda mais
    if (!todo.length) return;
    if (!only) regs.busy = true;
    todo.forEach((it) => { regs.stamps[it.hash] = { s: 'consultando' }; });
    regRender();
    try {
      for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map(async (it) => { regs.stamps[it.hash] = await regFetch(it); }));
        regRender();
      }
    } finally {
      if (!only) { regs.busy = false; regs.last = Date.now(); }
      regRender();
    }
  }
  function regRow(it) {
    const t = Date.parse(it.at), st = regs.stamps[it.hash] || { s: CAN_REGISTER ? 'consultando' : 'indisponivel' }, sx = STAMP[st.s] || STAMP.indisponivel;
    const pair = it.symbol ? PAIR(it.symbol) + (it.tf ? ' · ' + (TF_LABEL[it.tf] || it.tf) : '') : 'ativo não informado';
    const hl = regs.fresh && regs.fresh.hash === it.hash && Date.now() - regs.fresh.t0 < REG_HL_MS ? Date.now() - regs.fresh.t0 : -1; // ms já decorridos do destaque (-1: sem destaque)
    // redesenhos dentro da janela (o carimbo chega em seguida) recriam o <li>: o atraso negativo faz o destaque continuar de onde estava, sem reiniciar
    return '<li class="lv-reg' + (hl >= 0 ? ' is-new" style="--m-hl-skip:-' + hl + 'ms' : '') + '"><div class="lv-reg-top"><span class="lv-reg-pair">' + esc(pair) + '</span><span class="lv-reg-setup">' + esc(it.setupName || it.setupId || 'setup não informado') + '</span>' +
      '<span class="verdict ' + esc(it.verdict.tone) + '">' + esc(it.verdict.label || 'sem veredito') + '</span></div>' +
      '<div class="lv-reg-meta"><span class="lv-reg-time">' + esc(fmtDate(t / 1000)) + '</span><span class="lv-reg-hash" title="' + esc(it.hash) + '">' + esc(it.hash.slice(0, 12) + '…' + it.hash.slice(-8)) + '</span>' +
      '<button type="button" class="btn btn-sm" data-act="copy" data-hash="' + esc(it.hash) + '">Copiar hash</button>' +
      (it.verifyUrl ? '<a class="btn btn-sm" href="' + esc(it.verifyUrl) + '" target="_blank" rel="noopener">Abrir prova ↗</a>' : '') + '</div>' +
      '<div class="lv-reg-stamp">Carimbo: <span class="lv-stamp ' + esc(sx[0]) + '"' + (st.why ? ' title="' + esc(st.why) + '"' : '') + '>' + esc(sx[1]) + '</span></div></li>';
  }
  function regRender() {
    const ui = regs.ui; if (!ui) return;
    if (regs.fresh && Date.now() - regs.fresh.t0 >= REG_HL_MS) regs.fresh = null;
    const n = regs.items.length;
    ui.card.hidden = !CAN_REGISTER && !n; // sem servidor e sem lista, o cartão não tem o que mostrar
    ui.count.textContent = n ? '(' + n + ')' : '';
    ui.refresh.disabled = !CAN_REGISTER || !n || regs.busy;
    ui.refresh.textContent = regs.busy ? 'Consultando…' : 'Atualizar';
    ui.clear.disabled = !n;
    ui.confirm.hidden = !(regs.confirm && n);
    ui.foot.hidden = regs.persist;
    ui.body.innerHTML = n ? '<ul class="lv-reg-list">' + regs.items.map(regRow).join('') + '</ul>' : '<p class="note">' + esc(REG_EMPTY) + '</p>';
    ui.note.hidden = !n;
  }
  function regClear() {
    regs.items = []; regs.stamps = {}; regs.confirm = false;
    try { localStorage.removeItem(REG_KEY); } catch (e) { /* sem storage: só a lista da página é limpa */ }
    regRender();
    if (regs.ui) regs.ui.clear.focus();
  }
  function buildRegs() {
    if (regs.ui || !$('lvDetail')) return;
    const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
    const btn = (txt, act) => { const b = el('button', 'btn btn-sm', txt); b.type = 'button'; b.setAttribute('data-act', act); return b; };
    const card = el('section', 'card lv-regs'); card.id = 'lvRegs'; card.setAttribute('aria-labelledby', 'lvRegsH');
    const head = el('div', 'lv-regs-h'), title = el('div'), h = el('h3', null, 'Registros deste navegador'), count = el('span', 'lv-regs-n');
    h.id = 'lvRegsH'; h.appendChild(count);
    title.appendChild(h); title.appendChild(el('p', 'lv-regs-sub', 'A lista fica só neste navegador. Os registros em si ficam no servidor, com a prova.'));
    const acts = el('div', 'lv-regs-actions'), refresh = btn('Atualizar', 'refresh'), clear = btn('Limpar lista', 'clear');
    acts.appendChild(refresh); acts.appendChild(clear); head.appendChild(title); head.appendChild(acts);
    const confirm = el('div', 'ai-note lv-regs-confirm'), yes = btn('Limpar a lista', 'clear-yes'), no = btn('Cancelar', 'clear-no');
    confirm.hidden = true; confirm.setAttribute('role', 'alertdialog'); confirm.setAttribute('aria-label', 'Confirmar a limpeza da lista');
    confirm.appendChild(el('p', null, 'Isto limpa só a lista deste navegador. Os registros continuam no servidor e as provas continuam abertas pelos links.'));
    confirm.appendChild(yes); confirm.appendChild(no);
    const body = el('div', 'lv-regs-body'), note = el('p', 'note', 'O veredito mostrado é o que a tela exibia no momento do registro. O do servidor está na prova.');
    const foot = el('p', 'note lv-regs-warn', 'Este navegador não deixou guardar a lista: ela vale só até a página ser fechada.');
    foot.hidden = true; note.hidden = true;
    [head, confirm, body, note, foot].forEach((n) => card.appendChild(n));
    card.addEventListener('click', async (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-act]') : null; if (!b) return;
      const act = b.getAttribute('data-act');
      if (act === 'refresh') regRefresh();
      else if (act === 'clear') { regs.confirm = true; regRender(); no.focus(); }
      else if (act === 'clear-no') { regs.confirm = false; regRender(); clear.focus(); }
      else if (act === 'clear-yes') regClear();
      else if (act === 'copy') {
        const hv = b.getAttribute('data-hash') || ''; if (!HASH_RE.test(hv)) return;
        const ok = await copyText(hv, null, '');
        b.textContent = ok ? 'Copiado' : 'Não copiou';
        setTimeout(() => { b.textContent = 'Copiar hash'; }, 1800);
      }
    });
    $('lvDetail').insertAdjacentElement('afterend', card);
    regs.ui = { card, count, refresh, clear, confirm, body, note, foot };
    const cur = regLoad(); if (cur) regs.items = cur;
    regRender();
  }
  function regOpen() { // ao abrir a tela: relê a lista (outra aba pode ter mudado) e consulta o carimbo uma vez
    if (!regs.ui) return;
    if (regs.persist) { const cur = regLoad(); if (cur) regs.items = cur; }
    regRender();
    if (Date.now() - regs.last > REG_REFRESH_MS) regRefresh();
  }

  // ------------------------------------------------ relatório (motor)
  function debatePoints(A) {
    const T = A.tech, pro = [], con = [];
    if (T.aboveMa200) pro.push('Preço ' + fmtSPct(T.distMa200, 1) + ' acima da MM200 há ' + T.barsVsMa200 + ' candles.'); else con.push('Preço ' + fmtSPct(T.distMa200, 1) + ' em relação à MM200, abaixo dela há ' + T.barsVsMa200 + ' candles.');
    if (T.emaAligned) pro.push('EMA20 acima da EMA50: médias curtas alinhadas para cima.'); else con.push('EMA20 abaixo da EMA50: médias curtas alinhadas para baixo.');
    if (T.macdAbove) pro.push('MACD acima da linha de sinal há ' + T.macdBarsSinceCross + ' candles' + (T.histExpanding ? ', com histograma expandindo.' : '.')); else con.push('MACD abaixo da linha de sinal há ' + T.macdBarsSinceCross + ' candles' + (T.histExpanding ? ', com histograma expandindo.' : '.'));
    if (T.adx > 25) (T.diPlus > T.diMinus ? pro : con).push('ADX ' + fmtN(T.adx, 1) + ' indica tendência presente, com ' + (T.diPlus > T.diMinus ? 'DI+ acima de DI−.' : 'DI− acima de DI+.'));
    else con.push('ADX ' + fmtN(T.adx, 1) + ': abaixo de 25, o método não reconhece tendência definida.');
    if (T.rsi > 70) con.push('RSI em ' + fmtN(T.rsi, 1) + ', na zona de sobrecompra (acima de 70).');
    else if (T.rsi < 30) con.push('RSI em ' + fmtN(T.rsi, 1) + ', na zona de sobrevenda (abaixo de 30).');
    else if (T.rsi >= 50) pro.push('RSI em ' + fmtN(T.rsi, 1) + ': momento positivo sem entrar em sobrecompra.');
    else con.push('RSI em ' + fmtN(T.rsi, 1) + ': momento abaixo da linha de 50.');
    if (T.rangePos > 0.75) pro.push('Fechamento no quarto superior do canal de 20 candles (' + fmtPct(T.rangePos, 0) + ' da faixa).');
    else if (T.rangePos < 0.25) con.push('Fechamento no quarto inferior do canal de 20 candles (' + fmtPct(T.rangePos, 0) + ' da faixa).');
    if (T.volZ < -0.5) con.push('Volume ' + fmtN(Math.abs(T.volZ), 1) + ' desvios abaixo da média de 30 candles: pouca participação no movimento.');
    else if (T.volZ > 1) pro.push('Volume ' + fmtN(T.volZ, 1) + ' desvios acima da média de 30 candles.');
    const act = A.setups.filter((s) => s.activeNow);
    const weak = act.filter((s) => s.verdict.key !== 'EDGE' && s.verdict.key !== 'EDGE_SENSIVEL');
    if (weak.length) con.push('Os setups que dispararam agora (' + weak.map((s) => s.nome).join(', ') + ') não mostram vantagem estatística nesta janela.');
    return { pro, con };
  }

  function regimeDestinations(runs, R) {
    const cnt = {}; let total = 0;
    for (let k = 0; k < runs.length - 1; k++) {
      if (runs[k].regime !== R) continue;
      let j = k + 1;
      if (R !== 'HIGH_VOL_RANGING') while (j < runs.length && runs[j].regime === 'HIGH_VOL_RANGING') j++;
      if (j >= runs.length) continue;
      cnt[runs[j].regime] = (cnt[runs[j].regime] || 0) + 1; total++;
    }
    return { total, list: Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3) };
  }
  function buildReport(A) {
    const d = A.d, T = A.tech, r = T.regime, R = E.REGIMES[r.regime], rs = A.rstats, pair = PAIR(state.sym), tfl = TF_LABEL[state.tf];
    const cur = rs.current, curLen = cur ? cur.end - cur.start + 1 : 0, dur = rs.durations[r.regime];
    const dest = regimeDestinations(rs.runs, r.regime);
    const act = A.setups.filter((s) => s.activeNow);
    const sections = [];
    // 1
    sections.push({ n: 1, title: 'Contexto de Regime', blocks: [
      { p: 'O classificador determinístico do Argos coloca **' + pair + ' (' + tfl + ')** em **' + R.label.toLowerCase() + '** (`' + r.regime + '`), com confiança de ' + fmtN(r.confidence * 100, 0) + '%. ' + regimeWhy(r) },
      { p: 'Teste de Chow sobre a média dos retornos: p = ' + fmtP(r.chowP) + (r.chowP < 0.01 ? ' — o método registra quebra estrutural.' : ' — sem quebra estrutural pelo critério do método (p < 0,01).') + ' Este regime está em vigor há ' + spanText(curLen, d.dt) + (dur ? '; nesta janela, episódios desse regime duraram em média ' + fmtN(dur.mean, 0) + ' candles (mediana ' + fmtN(dur.median, 0) + ', ' + dur.runs + ' episódios).' : '.') }
    ] });
    // 2
    const b2 = [];
    if (act.length) {
      b2.push({ p: act.length === 1 ? 'Um setup do banco disparou nos últimos 3 candles:' : act.length + ' setups do banco dispararam nos últimos 3 candles:' });
      b2.push({ ul: act.map((s) => '**' + s.nome + '** (' + (s.barsSinceLast === 0 ? 'no último candle' : 'há ' + s.barsSinceLast + ' ' + pl(s.barsSinceLast, 'candle', 'candles')) + '): ' + s.n + ' gatilhos com desfecho na janela (N efetivo ' + s.nEff + '), taxa de acerto de ' + fmtPct(s.winRate, 1) + ' (IC 95%: ' + fmtPct(s.ci[0], 1) + '–' + fmtPct(s.ci[1], 1) + ', a faixa onde a taxa real provavelmente está) contra ' + fmtPct(s.base, 1) + ' de entradas aleatórias com a mesma regra de saída; p = ' + fmtP(s.pTwo) + ', ou ' + fmtP(s.q) + ' depois do ajuste para os ' + s.family + ' setups testados juntos. Veredito: **' + s.verdict.label.toLowerCase() + '**.') });
      const weak = act.filter((s) => s.verdict.key !== 'EDGE' && s.verdict.key !== 'EDGE_SENSIVEL');
      if (weak.length) b2.push({ p: 'Em termos práticos: ' + (weak.length === 1 ? 'o padrão apareceu' : 'os padrões apareceram') + ' no gráfico, mas o histórico carregado não sustenta que ' + (weak.length === 1 ? 'ele diferencie' : 'eles diferenciem') + ' o desfecho de uma entrada ao acaso.' });
    } else {
      const lastS = A.setups.filter((s) => s.lastTrigger >= 0).sort((a, b) => b.lastTrigger - a.lastTrigger)[0];
      b2.push({ p: 'Nenhum setup do banco disparou nos últimos 3 candles.' + (lastS ? ' O gatilho mais recente foi de **' + lastS.nome + '**, há ' + lastS.barsSinceLast + ' candles.' : '') });
    }
    const edges = A.setups.filter((s) => s.verdict.key === 'EDGE' || s.verdict.key === 'EDGE_SENSIVEL');
    const below = A.setups.filter((s) => s.verdict.key === 'ABAIXO');
    b2.push({ p: 'Visão do banco inteiro (' + A.setups.length + ' setups): ' + (edges.length ? edges.map((s) => '**' + s.nome + '** (' + s.verdict.label.toLowerCase() + ')').join(', ') + (edges.length === 1 ? ' é o único' : ' são os únicos') + ' com vantagem estatística nesta janela' : 'nenhum mostra vantagem estatística demonstrável nesta janela') + (below.length ? '; ' + below.map((s) => s.nome).join(', ') + ' ' + pl(below.length, 'ficou', 'ficaram') + ' abaixo do acaso' : '') + '. Resultado negativo também é resultado: é o que o método existe para mostrar.' });
    b2.push({ table: { head: ['Setup', 'N (ef.)', 'Acerto', 'IC 95%', 'Base', 'p (ajust.)', 'Veredito'], rows: A.setups.map((s) => [s.nome, s.n + ' (' + s.nEff + ')', fmtPct(s.winRate, 1), fmtPct(s.ci[0], 0) + '–' + fmtPct(s.ci[1], 0), fmtPct(s.base, 1), fmtP(s.pTwo) + ' (' + fmtP(s.q) + ')', s.verdict.label]) } });
    sections.push({ n: 2, title: 'Teses em Avaliação', blocks: b2 });
    // 3
    const dbt = debatePoints(A);
    sections.push({ n: 3, title: 'Debate (prós e contras)', blocks: [
      { p: 'Duas leituras concorrentes sobre o mesmo gráfico. O motor registra os argumentos de cada lado com o dado que os sustenta; não escolhe um vencedor.' },
      { debate: { proT: 'Sustenta a leitura de tendência de alta', conT: 'Pesa contra essa leitura', pro: dbt.pro.length ? dbt.pro : ['Nenhum dos critérios do motor sustenta essa leitura agora.'], con: dbt.con.length ? dbt.con : ['Nenhum dos critérios do motor pesa contra essa leitura agora.'] } }
    ] });
    // 4
    const worstSet = act.length ? act[0] : null;
    sections.push({ n: 4, title: 'Avaliação de Risco', blocks: [
      { ul: [
        'Volatilidade por candle: ATR(14) de ' + fmtN(T.atr, 2) + ' USDT, ou ' + fmtPct(T.atrPct, 2) + ' do preço.',
        'Cauda histórica: CVaR 5% de 1 candle em ' + fmtSPct(T.cvar1bar, 2) + ' (média dos 5% piores candles dos últimos 500).',
        'Maior queda a partir de um topo nos últimos 500 candles: ' + fmtSPct(T.maxDD, 1) + '.',
        'Volatilidade realizada no percentil ' + fmtN(T.rvPct, 0) + ' dos últimos 252 candles' + (T.rvPct > 85 ? ' — faixa atípica, em que o v1 já aplicava penalidade de confiança.' : '.'),
        worstSet ? 'No setup ativo ' + worstSet.nome + ', o CVaR 5% por gatilho foi ' + fmtSPct(worstSet.cvar, 2) + ' e a excursão adversa mediana, ' + fmtSPct(worstSet.maeMedian, 2) + '.' : 'Sem setup ativo: o risco acima descreve o ativo, não uma tese.'
      ] },
      { p: 'Esses números descrevem o comportamento passado do ativo e dos setups nesta janela. Não são limites de perda e não indicam tamanho de posição.' }
    ] });
    // 5
    const lv = [];
    lv.push('Se o fechamento cruzar ' + (T.aboveMa200 ? 'abaixo' : 'acima') + ' da MM200 (≈ ' + fmtN(T.sma200, 2) + '), o critério de preço do classificador se inverte' + (T.adx > 25 ? ' e, com ADX acima de 25, a leitura passaria a ' + (T.aboveMa200 ? 'tendência de baixa.' : 'tendência de alta (se a volatilidade seguir abaixo do percentil 60).') : '.'));
    if (T.adx <= 25) lv.push('Se o ADX passar de 25 (hoje ' + fmtN(T.adx, 1) + '), o método passaria a reconhecer tendência: de alta com preço acima da MM200 e volatilidade abaixo do percentil 60; de baixa com preço abaixo dela.');
    else lv.push('Se o ADX cair abaixo de 20 (hoje ' + fmtN(T.adx, 1) + '), o método passaria a classificar o mercado como lateral.');
    if (dest.total) lv.push('Nesta janela, ao deixar ' + R.label.toLowerCase() + (r.regime !== 'HIGH_VOL_RANGING' ? ' (a passagem costuma ser pela zona intermediária, que o método classifica como lateral com alta volatilidade)' : '') + ', o mercado seguiu para: ' + dest.list.map((x) => (x[0] === r.regime ? 'voltou a ' + E.REGIMES[x[0]].label.toLowerCase() : E.REGIMES[x[0]].label.toLowerCase()) + ' em ' + x[1] + ' de ' + dest.total + ' casos').join('; ') + '.');
    sections.push({ n: 5, title: 'Cenário Teórico', blocks: [
      { p: 'Condições que mudariam a classificação, derivadas das regras do próprio motor. É um mapa de condições, não uma previsão.' },
      { ul: lv },
      { p: 'Níveis de referência técnica do recorte atual (não são alvos): canal de 20 candles entre ' + fmtN(T.ll20, 2) + ' e ' + fmtN(T.hh20, 2) + '; bandas de Bollinger entre ' + fmtN(T.bbLower, 2) + ' e ' + fmtN(T.bbUpper, 2) + '; EMA20 em ' + fmtN(T.ema20, 2) + '.' }
    ] });
    // 6
    const c = A.calib, ST = window.ARGOS_STUDY;
    const cal6 = [];
    if (c.n >= 30) {
      cal6.push({ p: 'Calibração prequencial desta série: a cada gatilho, a probabilidade que o motor teria emitido (a taxa de acerto do setup até aquele momento) foi comparada com o desfecho que veio depois. Em ' + fmtInt(c.n) + ' previsões, o Brier Score foi **' + fmtN(c.brier, 3) + '**; prever sempre a taxa-base conhecida na época teria dado ' + fmtN(c.brierRef, 3) + '.' });
      cal6.push({ p: 'Ganho sobre essa referência (BSS): **' + fmtSPct(c.bss, 1) + '** — ' + c.status.skill + '. Erro médio de calibração (ECE, a distância entre a probabilidade prevista e a frequência observada): **' + fmtN(c.ece * 100, 1) + ' p.p.** — ' + c.status.cal + '.' + (c.bss < 0.01 ? ' Em termos práticos: nesta série, o histórico de cada setup não prevê o próximo gatilho melhor do que a taxa-base.' : '') });
    } else cal6.push({ p: 'Previsões fora da amostra insuficientes nesta janela para medir a calibração (menos de 30).' });
    if (ST && ST.calib) cal6.push({ p: 'Referência do produto (estudo v1.1, 9 séries, ' + fmtInt(ST.calib.n) + ' previsões): ECE de ' + fmtN(ST.calib.ece * 100, 1) + ' p.p. e ganho sobre a taxa-base de ' + fmtSPct(ST.calib.bss, 1) + ', acompanhados no Relatório de Calibração Público.' });
    sections.push({ n: 6, title: 'Calibração', blocks: cal6 });
    const first = d.t[A.warm], last = d.t[d.n - 1];
    return {
      kicker: 'Stratum Research · Relatório Estratégico',
      title: pair + ' · ' + tfl + ' — ' + R.label,
      meta: ['Gerado em ' + nowBrt() + ' · último candle fechado ' + fmtDate(last), 'Janela avaliada: ' + fmtDay(first) + ' a ' + fmtDay(last) + ' · ' + fmtInt(d.n) + ' candles · fonte Binance Spot (' + (entry(state.sym, state.tf).source === 'live' ? 'ao vivo' : 'snapshot') + ')', 'Regra de saída dos backtests: ' + cfgText(state.cfg) + ' · permutação com 3.000 sorteios · seed fixa'],
      draft: 'Rascunho gerado automaticamente — requer revisão humana antes de qualquer envio a cliente.',
      sections,
      disc: 'Este material é produzido pela Stratum Research e constitui research e análise estatística histórica. Não é consultoria de investimentos, não é recomendação de compra ou venda de ativos e não é sinal de trading. Resultados passados não garantem resultados futuros. A Stratum não tem acesso a contas ou carteiras de clientes; toda decisão e execução é do cliente.',
      sign: 'Argos Sentinel (motor) + Argos AI · Stratum Research — responsável: Michel Eleutério de Andrade Ramon · ' + new Date().toLocaleDateString('pt-BR')
    };
  }

  // inline: **negrito** e `chip`
  function inl(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<span class="chip">$1</span>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>'); }
  function reportToHTML(R) {
    let h = '<div class="r-kicker"><span>' + esc(R.kicker) + '</span><span>Argos Sentinel · motor</span></div><h2 class="r-title">' + esc(R.title) + '</h2><div class="r-meta">' + R.meta.map(esc).join('<br>') + '</div><div class="r-draft">' + esc(R.draft) + '</div>';
    R.sections.forEach((s) => {
      h += '<h3><span class="n">' + String(s.n).padStart(2, '0') + '</span>' + esc(s.title) + '</h3>';
      s.blocks.forEach((b) => {
        if (b.p) h += '<p>' + inl(b.p) + '</p>';
        if (b.ul) h += '<ul>' + b.ul.map((x) => '<li>' + inl(x) + '</li>').join('') + '</ul>';
        if (b.table) h += '<div class="r-table"><table><thead><tr>' + b.table.head.map((x) => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + b.table.rows.map((r) => '<tr>' + r.map((x) => '<td>' + esc(x) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
        if (b.debate) h += '<div class="debate"><div><h4>' + esc(b.debate.proT) + '</h4><ul>' + b.debate.pro.map((x) => '<li>' + inl(x) + '</li>').join('') + '</ul></div><div><h4>' + esc(b.debate.conT) + '</h4><ul>' + b.debate.con.map((x) => '<li>' + inl(x) + '</li>').join('') + '</ul></div></div>';
      });
    });
    h += '<p class="disc">' + esc(R.disc) + '</p><div class="sign">' + esc(R.sign) + '</div>';
    return h;
  }
  function reportToMarkdown(R) {
    let m = '# ' + R.title + '\n\n' + R.meta.map((x) => '_' + x + '_').join('  \n') + '\n\n> ' + R.draft + '\n';
    R.sections.forEach((s) => {
      m += '\n## ' + s.n + '. ' + s.title + '\n\n';
      s.blocks.forEach((b) => {
        if (b.p) m += b.p + '\n\n';
        if (b.ul) m += b.ul.map((x) => '- ' + x).join('\n') + '\n\n';
        if (b.table) m += '| ' + b.table.head.join(' | ') + ' |\n|' + b.table.head.map(() => '---').join('|') + '|\n' + b.table.rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n') + '\n\n';
        if (b.debate) m += '**' + b.debate.proT + '**\n' + b.debate.pro.map((x) => '- ' + x).join('\n') + '\n\n**' + b.debate.conT + '**\n' + b.debate.con.map((x) => '- ' + x).join('\n') + '\n\n';
      });
    });
    return m + '---\n' + R.disc + '\n\n' + R.sign + '\n';
  }

  // ------------------------------------------ verificação de vocabulário
  const BANNED = [
    /\bcompr(e|em|ar agora|a agora)\b/gi, /\bvend(a|er) agora\b/gi, /\brecomend(o|amos|a-se)\b/gi, /\brecomenda(ç|c)(ã|a)o de (compra|venda)\b/gi, /\bsugiro\b/gi, /\bsugerimos\b/gi,
    /\bgarant(o|imos|ido|ida|idos|idas|ia)\b/gi, /\blucro (certo|garantido)\b/gi, /\bvai (subir|cair|disparar|explodir)\b/gi, /\bcom certeza\b/gi, /\boportunidade\b/gi, // compliance-ignore: lista de termos proibidos do verificador
    /\bentr(e|ar) agora\b/gi, /\bentrada sugerida\b/gi, /\balvo sugerido\b/gi, /\bstop sugerido\b/gi, /\breduz(a|am|ir) (a |sua |suas )?(exposi(ç|c)(ã|a)o|posi(ç|c)(ã|a)o|posi(ç|c)(õ|o)es)\b/gi,
    /\baument(e|ar) (a |sua )?posi(ç|c)(ã|a)o\b/gi, /\bzer(e|ar) (a |sua )?posi(ç|c)(ã|a)o\b/gi, /\balavanc(ar|agem recomendada)\b/gi, /\bn(ã|a)o perca\b/gi, /\bimperd(í|i)vel\b/gi, /\bcuidado\b/gi
  ];
  const NEG = /\b(n(ã|a)o|nunca|nenhum|nenhuma|sem|jamais|nem)\b[^.!?\n]{0,60}$/i;
  function scanTerms(text) {
    const out = [];
    BANNED.forEach((re) => { re.lastIndex = 0; let m; while ((m = re.exec(text))) { const before = text.slice(Math.max(0, m.index - 70), m.index); if (!NEG.test(before)) out.push({ term: m[0], index: m.index }); } });
    return out.sort((a, b) => a.index - b.index);
  }
  function renderScan(text, host) {
    const f = scanTerms(text);
    host.innerHTML = f.length
      ? '<div class="scan bad">⚠ Verificação de vocabulário (Política de Compliance, seção 2): ' + f.length + ' ' + pl(f.length, 'termo sinalizado', 'termos sinalizados') + ' para revisão humana — ' + f.map((x) => '“' + esc(x.term) + '”').join(', ') + '.</div>'
      : '<div class="scan ok">✓ Verificação de vocabulário (Política de Compliance, seção 2): nenhum termo de instrução, promessa de retorno ou urgência encontrado.</div>';
    return f;
  }
  function highlightFlags(html, flags) {
    if (!flags.length) return html;
    const terms = Array.from(new Set(flags.map((f) => f.term.toLowerCase())));
    return html.replace(/>([^<]+)</g, (all, txt) => '>' + terms.reduce((acc, t) => acc.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark class="flag-term">$1</mark>'), txt) + '<');
  }

  // ---------------------------------------------- markdown mínimo (Argos AI)
  function md2html(md) {
    const lines = md.replace(/\r/g, '').split('\n'); let h = '', list = null, para = [], tbl = null;
    const flushP = () => { if (para.length) { h += '<p>' + inl(para.join(' ')) + '</p>'; para = []; } };
    const flushL = () => { if (list) { h += '</' + list + '>'; list = null; } };
    const flushT = () => { if (tbl) { const rows = tbl.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)); const cells = (r) => r.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim()); if (rows.length) { h += '<div class="r-table"><table><thead><tr>' + cells(rows[0]).map((c) => '<th>' + inl(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.slice(1).map((r) => '<tr>' + cells(r).map((c) => '<td>' + inl(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'; } tbl = null; } };
    for (const raw of lines) {
      const ln = raw.trimEnd();
      if (/^\s*\|.*\|\s*$/.test(ln)) { flushP(); flushL(); (tbl = tbl || []).push(ln); continue; } else flushT();
      let m;
      if (!ln.trim()) { flushP(); flushL(); continue; }
      if ((m = ln.match(/^#{1,2}\s+(.*)$/))) { flushP(); flushL(); const num = m[1].match(/^(\d+)\.\s*(.*)$/); h += '<h3>' + (num ? '<span class="n">' + String(num[1]).padStart(2, '0') + '</span>' + inl(num[2]) : inl(m[1])) + '</h3>'; continue; }
      if ((m = ln.match(/^#{3,6}\s+(.*)$/))) { flushP(); flushL(); h += '<h4>' + inl(m[1]) + '</h4>'; continue; }
      if (/^(-{3,}|\*{3,})$/.test(ln.trim())) { flushP(); flushL(); h += '<hr style="border:0;border-top:1px solid #D8CDB6;margin:18px 0">'; continue; }
      if ((m = ln.match(/^\s*[-*•]\s+(.*)$/))) { flushP(); if (list !== 'ul') { flushL(); h += '<ul>'; list = 'ul'; } h += '<li>' + inl(m[1]) + '</li>'; continue; }
      if ((m = ln.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (list !== 'ol') { flushL(); h += '<ol>'; list = 'ol'; } h += '<li>' + inl(m[1]) + '</li>'; continue; }
      if ((m = ln.match(/^>\s?(.*)$/))) { flushP(); flushL(); h += '<p class="r-draft">' + inl(m[1]) + '</p>'; continue; }
      flushL(); para.push(ln.trim());
    }
    flushP(); flushL(); flushT();
    return h;
  }

  // ------------------------------------------------------- relatório: UI
  function currentReportMarkdown() {
    if (state.tab === 'ai' && state.ai.text) return aiBody();
    return reportToMarkdown(buildReport(state.A));
  }
  function renderEngineReport() {
    const R = buildReport(state.A), md = reportToMarkdown(R);
    const flags = scanTerms(md);
    $('lvReport').innerHTML = highlightFlags(reportToHTML(R), flags) + engineProvHTML();
    renderScan(md, $('lvScan'));
  }
  function aiHeader() {
    const k = state.ai.key || runKey();
    return '<div class="r-kicker"><span>Stratum Research · Relatório Estratégico</span><span>Argos AI · redigido por LLM</span></div><h2 class="r-title">' + esc(k.replace('_', ' · ').replace('USDT', '/USDT').replace('1d', '1D')) + '</h2><div class="r-meta">Redigido pelo Argos AI a partir de consultas ao motor Argos Sentinel · ' + esc(nowBrt()) + '<br>Todos os números vêm das ferramentas do motor; o texto é verificado contra o vocabulário da Política de Compliance.</div>';
  }
  function aiBody() { const t = state.ai.text || ''; const k = t.search(/^#{1,3}\s/m); return k > 0 ? t.slice(k) : t; }
  // Procedência dos números do relatório do Argos AI: tudo vem do servidor (não do modelo), para conferir e reproduzir.
  const PROV_TOOL = { obter_leitura_tecnica: 'Leitura técnica', consultar_banco_de_setups: 'Banco de setups', detalhar_setup: 'Detalhe do setup' };
  function provHTML(p) {
    if (!p || !p.seriesHash) return '';
    const rule = p.rule ? (p.rule.mode === 'atr' ? 'alvo ' + p.rule.tgt + '×ATR · stop ' + p.rule.stp + '×ATR' : 'alvo ' + p.rule.tgt + '% · stop ' + p.rule.stp + '%') + ' · ' + p.rule.hold + ' candles' : '—';
    const src = p.source === 'database' ? 'base de candles' : p.source === 'live' ? 'Binance ao vivo' : p.source === 'snapshot' ? 'snapshot versionado' : esc(String(p.source || '—'));
    const rows = [
      ['Motor', esc(p.engine || '—')],
      ['Recorte', esc(String(p.symbol || '').replace('USDT', '/USDT') + ' · ' + (p.timeframe || '') + (p.windowDays ? ' · janela de ' + p.windowDays + ' dias' : ''))],
      ['Regra de saída', esc(rule)],
      ['Série', esc(p.candles + ' candles até ' + fmtDate(Date.parse(p.lastCandle) / 1000) + ' · fonte: ') + src],
      ['Hash da série', '<code title="' + esc(p.seriesHash) + '">' + esc(p.seriesHash) + '</code>']
    ];
    if (p.resultHash) rows.push(['Hash do resultado', '<code title="' + esc(p.resultHash) + '">' + esc(p.resultHash) + '</code>']);
    const cons = (p.consulted || []).map((c) => '<li><span>' + esc((PROV_TOOL[c.tool] || c.tool) + (c.setupId ? ' · ' + c.setupId : '')) + '</span><code title="' + esc(c.resultHash) + '">' + esc(c.resultHash.slice(0, 12)) + '</code></li>').join('');
    return '<details class="prov"><summary>Procedência dos números</summary><dl>' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>' +
      (cons ? '<p class="prov-h">Consultas ao motor (hash do resultado entregue ao modelo)</p><ul>' + cons + '</ul>' : '') +
      (p.kind === 'motor'
        ? '<p class="prov-n">Relatório do motor, sem IA: os números são calculados neste navegador pelo mesmo motor do servidor. Mesma série, mesma regra e mesmo motor reproduzem o mesmo hash (o /api/analyze devolve o mesmo resultado para a mesma série e regra).</p></details>'
        : '<p class="prov-n">Estes dados vêm do servidor, não do modelo. Mesma série, mesma regra e mesmo motor reproduzem o mesmo hash. O texto passou por conferência numérica contra estes resultados e pela verificação de vocabulário.</p></details>');
  }
  // Procedência do relatório do motor (aba Motor): calculada aqui, com o mesmo resumo que o servidor usa (ArgosSummary).
  function engineProvHTML() {
    const S = window.ArgosSummary; if (!S || !state.A) return '';
    const en = state.series[key(state.sym, state.tf)] || {};
    const source = en.source === 'live' && en.via === 'base' ? 'database' : (en.source || 'snapshot');
    let s; try { s = S.summarize(state.A, { symbol: state.sym, timeframe: state.tf, source, windowDays: state.win >= 30 ? state.win : null }); } catch (e) { return ''; }
    return provHTML({ kind: 'motor', source, lastCandle: s.data.to, candles: s.data.candles, seriesHash: s.data.hash, resultHash: s.resultHash, engine: s.engine, symbol: state.sym, timeframe: state.tf, rule: s.input.cfg, windowDays: s.input.windowDays, consulted: [] });
  }
  function renderAiReport(final) {
    const t = aiBody();
    let body = md2html(t);
    if (final) { const flags = renderScan(t, $('lvScan')); body = highlightFlags(body, flags); }
    $('lvReport').innerHTML = aiHeader() + (body || '<p style="color:#5C6776">Aguardando a primeira linha do Argos AI…</p>') + (state.ai.running ? '<span class="cursor" aria-hidden="true"></span>' : '') + (final ? provHTML(state.ai.prov) + '<div class="sign">Argos AI + Argos Sentinel · Stratum Research — responsável: Michel Eleutério de Andrade Ramon · ' + new Date().toLocaleDateString('pt-BR') + '</div>' : '');
  }
  function renderAiStatus() {
    const el = $('lvAiStatus');
    const lines = state.ai.log.slice(-6).map((x) => '<div class="ln"><span class="a">' + esc(x.a || '→') + '</span><span>' + esc(x.t) + '</span></div>');
    el.innerHTML = lines.join(''); el.hidden = !lines.length || state.tab !== 'ai';
  }
  function logAi(t, a) { state.ai.log.push({ t, a }); renderAiStatus(); }
  const runKey = () => state.sym + '_' + state.tf;
  function selectTab(tab) {
    state.tab = tab;
    $('lvTabEngine').setAttribute('aria-pressed', tab === 'engine'); $('lvTabAi').setAttribute('aria-pressed', tab === 'ai');
    $('lvAiNote').hidden = !(tab === 'ai' && !state.samp);
    $('lvAiStatus').hidden = !(tab === 'ai' && state.ai.log.length);
    if (tab === 'engine') { renderEngineReport(); return; }
    if (state.ai.text) {
      renderAiReport(!state.ai.running);
      const msg = 'Esta versão foi redigida para ' + state.ai.key.replace('_', ' ') + '. Peça de novo para o recorte atual.';
      const lastLog = state.ai.log[state.ai.log.length - 1];
      if (state.ai.key && state.ai.key !== runKey() && !state.ai.running && (!lastLog || lastLog.t !== msg)) logAi(msg, '!');
      return;
    }
    $('lvScan').innerHTML = '';
    $('lvReport').innerHTML = aiHeader() + (state.samp
      ? '<p>O Argos AI ainda não redigiu este relatório. Ao pedir, ele consulta o motor por ferramentas (leitura técnica, banco de estratégias e detalhe dos setups ativos) e escreve as seis seções com os números que recebeu. Leva de 30 a 90 segundos.</p><p><strong>O que ele não faz:</strong> recomendar operações, sugerir alvos, stops ou tamanho de posição. O texto final passa pela mesma verificação de vocabulário do motor.</p>'
      : '<p>A camada Argos AI (LLM) roda na versão publicada da plataforma. Neste arquivo, o relatório da aba “Motor” é redigido pelo motor determinístico, com os mesmos números.</p>');
  }

  // ------------------------------------------------------------ Argos AI
  function toolContext(A) {
    const T = A.tech, r = T.regime, rs = A.rstats, cur = rs.current, dur = rs.durations[r.regime] || {};
    return {
      ativo: PAIR(state.sym), tempo_grafico: TF_LABEL[state.tf], fonte: 'Binance Spot (' + (entry(state.sym, state.tf).source === 'live' ? 'ao vivo' : 'snapshot real') + ')',
      janela: { inicio: fmtDay(A.d.t[A.warm]), fim: fmtDate(A.d.t[A.d.n - 1]), candles: A.d.n },
      ultimo_candle: { fechamento: +T.close.toFixed(2), variacao_24h_pct: +(T.change24 * 100).toFixed(2), variacao_7d_pct: +(T.change7d * 100).toFixed(2) },
      indicadores: { rsi14: +T.rsi.toFixed(1), zona_rsi: T.rsiZone, macd_acima_do_sinal: T.macdAbove, candles_desde_cruzamento_macd: T.macdBarsSinceCross, histograma_macd_expandindo: T.histExpanding, adx14: +T.adx.toFixed(1), di_mais: +T.diPlus.toFixed(1), di_menos: +T.diMinus.toFixed(1), ema20: +T.ema20.toFixed(2), ema50: +T.ema50.toFixed(2), mm200: +T.sma200.toFixed(2), distancia_mm200_pct: +(T.distMa200 * 100).toFixed(2), candles_do_mesmo_lado_da_mm200: T.barsVsMa200, volume_desvios_vs_media30: +T.volZ.toFixed(2), posicao_no_canal_20_pct: +(T.rangePos * 100).toFixed(0) },
      regime: { codigo: r.regime, nome: E.REGIMES[r.regime].label, confianca_pct: +(r.confidence * 100).toFixed(0), criterio: regimeWhy(r), chow_p: +r.chowP.toFixed(4), duracao_atual_candles: cur ? cur.end - cur.start + 1 : 0, duracao_media_candles: dur.mean ? +dur.mean.toFixed(1) : null, transicoes_diretas_a_partir_deste_regime: rs.transitions[r.regime] || {}, destinos_depois_da_zona_intermediaria: Object.fromEntries(regimeDestinations(rs.runs, r.regime).list), participacao_na_janela_pct: Object.fromEntries(Object.entries(rs.share).map(([k, v]) => [k, +(v * 100).toFixed(1)])) },
      risco: { atr14: +T.atr.toFixed(2), atr_pct_do_preco: +(T.atrPct * 100).toFixed(2), cvar5_1candle_pct: +(T.cvar1bar * 100).toFixed(2), maior_queda_500_candles_pct: +(T.maxDD * 100).toFixed(1), volatilidade_realizada_percentil: +T.rvPct.toFixed(0) },
      niveis_referencia_tecnica_nao_sao_alvos: { mm200: +T.sma200.toFixed(2), ema20: +T.ema20.toFixed(2), bollinger_superior: +T.bbUpper.toFixed(2), bollinger_inferior: +T.bbLower.toFixed(2), maxima_20: +T.hh20.toFixed(2), minima_20: +T.ll20.toFixed(2) },
      calibracao: A.calib.n >= 30 ? { metodo: 'prequencial: probabilidade emitida antes de cada gatilho vs. desfecho', previsoes: A.calib.n, brier: +A.calib.brier.toFixed(4), brier_referencia_taxa_base: +A.calib.brierRef.toFixed(4), ganho_sobre_referencia_bss_pct: +(A.calib.bss * 100).toFixed(2), erro_calibracao_ece_pp: +(A.calib.ece * 100).toFixed(2), leitura: A.calib.status.t, criterios: 'ECE < 3 p.p. bem calibrada; 3–6 atenção; > 6 descalibrada. BSS > +1% acrescenta informação; entre −1% e +1% empate; < −1% pior que a referência.' } : { disponivel: false, motivo: 'menos de 30 previsões fora da amostra nesta janela' },
      regra_de_saida: cfgText(state.cfg) + ' (vitória = alvo antes do stop dentro do horizonte; alvo e stop no mesmo candle = perda)'
    };
  }
  function toolBank(A) {
    return A.setups.map((s) => ({ id: s.id, nome: s.nome, definicao: s.def, gatilho_nos_ultimos_3_candles: s.activeNow, candles_desde_ultimo_gatilho: s.barsSinceLast, n_com_desfecho: s.n, n_efetivo: s.nEff, taxa_acerto_pct: +(s.winRate * 100).toFixed(1), ic95_pct: [+(s.ci[0] * 100).toFixed(1), +(s.ci[1] * 100).toFixed(1)], metodo_ic: s.method, taxa_base_aleatoria_pct: +(s.base * 100).toFixed(1), diferenca_pp: +s.alphaPP.toFixed(1), p_bruto_bicaudal: +s.pTwo.toFixed(4), p_ajustado_bh: +s.q.toFixed(4), testes_na_familia: s.family, veredito: s.verdict.label, walk_forward_consistente: s.wf.available ? s.wf.consistent : null }));
  }
  function toolDetail(A, id) {
    const s = A.setups.find((x) => x.id === String(id).trim().toUpperCase());
    if (!s) throw new Error('setup_id desconhecido. Use um destes: ' + A.setups.map((x) => x.id).join(', '));
    return { id: s.id, nome: s.nome, definicao: s.def, veredito: s.verdict.label, cvar5_por_gatilho_pct: +(s.cvar * 100).toFixed(2), excursao_adversa_mediana_pct: +(s.maeMedian * 100).toFixed(2), resultado_medio_pos_custo_pct: +(s.meanNet * 100).toFixed(3), encerrados_por_prazo: s.timeouts,
      por_regime: Object.fromEntries(Object.entries(s.byRegime).map(([k, v]) => [k, { n: v.n, taxa_acerto_pct: +((v.w / v.n) * 100).toFixed(1) }])),
      walk_forward: s.wf.available ? { janelas: s.wf.walks.map((w) => ({ periodo_teste: fmtDay(A.d.t[w.from]) + ' a ' + fmtDay(A.d.t[w.to]), treino_n: w.trainN, treino_pct: +(w.trainWR * 100).toFixed(1), teste_n: w.testN, teste_pct: +(w.testWR * 100).toFixed(1), queda_pp: +w.dropPP.toFixed(1), queda_acima_de_15pp: w.overfit })), brier_fora_da_amostra: +s.wf.brier.toFixed(3), brier_referencia: +s.wf.brierRef.toFixed(3) } : { disponivel: false, motivo: s.wf.reason } };
  }
  const PROMPT_RULES = [
    'Regras invioláveis (Política de Compliance da Stratum):',
    '- Nunca diga ao leitor o que fazer com o dinheiro dele: nada de comprar, vender, entrar, sair, aumentar, reduzir, zerar, alvo sugerido, stop sugerido ou tamanho de posição.', // compliance-ignore: regra do prompt que proíbe estes termos
    '- Nunca prometa ou insinue retorno. Não use "garantido", "certeza", "oportunidade", "vai subir", "vai cair", "imperdível", "cuidado".', // compliance-ignore: regra do prompt que proíbe estes termos
    '- Use somente números vindos do motor. Se algo não foi calculado, diga que não foi calculado. Não invente contexto de notícias ou macro.',
    '- Traduza cada termo técnico na mesma frase (por exemplo: "IC 95%, a faixa onde a taxa real provavelmente está").',
    '- O veredito usa o p ajustado para múltiplas comparações (Benjamini-Hochberg). Cite o p bruto e o ajustado; nunca apresente um p bruto abaixo de 0,05 como prova se o ajustado não sustenta.',
    '- Quando a evidência for fraca ou ausente, diga com clareza. Mostrar o que não funciona é o produto.',
    '- Níveis de preço aparecem apenas como referência técnica do classificador, nunca como alvo ou ponto de entrada.',
    '- Tom: analista sênior, direto, sem adjetivos de venda. Português do Brasil.'
  ].join('\n');
  const PROMPT_FORMAT = [
    'Formato de saída: Markdown, sem título geral, exatamente estas seções:',
    '## 1. Contexto de Regime',
    '## 2. Teses em Avaliação',
    '## 3. Debate (prós e contras)  — duas listas curtas: "Sustenta a leitura de tendência de alta" e "Pesa contra essa leitura"',
    '## 4. Avaliação de Risco',
    '## 5. Cenário Teórico  — condições que mudariam a classificação, deixando claro que não é previsão',
    '## 6. Calibração',
    'Termine com a linha: *Rascunho gerado pelo Argos AI — requer revisão humana antes de qualquer envio a cliente.*',
    'Entre 450 e 700 palavras no total.'
  ].join('\n');
  function buildPrompt(A, withTools) {
    const intro = 'Você é o Argos AI, a camada de linguagem da Stratum Research (research quantitativo em criptoativos). O motor estatístico Argos Sentinel já calculou tudo o que você precisa sobre ' + PAIR(state.sym) + ' no tempo gráfico ' + TF_LABEL[state.tf] + '. Sua tarefa: redigir o Relatório Estratégico desse recorte.';
    if (withTools) return intro + '\n\nComo trabalhar:\n1. Chame obter_leitura_tecnica e consultar_banco_de_setups.\n2. Chame detalhar_setup para cada setup com gatilho nos últimos 3 candles (no máximo 2). Se nenhum disparou, detalhe o de menor p-valor.\n3. Escreva o relatório. Se quiser, passe o texto em verificar_vocabulario antes de responder.\n\n' + PROMPT_RULES + '\n\n' + PROMPT_FORMAT;
    const act = A.setups.filter((s) => s.activeNow).slice(0, 2);
    return intro + '\n\nDados do motor (JSON):\n' + JSON.stringify({ leitura_tecnica: toolContext(A), banco_de_setups: toolBank(A), detalhes: act.map((s) => toolDetail(A, s.id)) }) + '\n\n' + PROMPT_RULES + '\n\n' + PROMPT_FORMAT;
  }
  function buildTools(A) {
    return [
      { name: 'obter_leitura_tecnica', description: 'Retorna a leitura técnica atual calculada pelo motor Argos Sentinel: preço, indicadores (RSI, MACD, ADX, médias), regime de mercado com critério e histórico de transições, métricas de risco, níveis de referência técnica e calibração.', inputSchema: { type: 'object', properties: {} },
        execute: () => { logAi('consultou a leitura técnica (' + PAIR(state.sym) + ' · ' + TF_LABEL[state.tf] + ')'); return toolContext(A); } },
      { name: 'consultar_banco_de_setups', description: 'Retorna os 8 setups do banco de estratégias testados agora contra o histórico carregado: gatilho recente, N, N efetivo, taxa de acerto com IC 95%, taxa-base de entradas aleatórias, p-valor do teste de permutação e veredito.', inputSchema: { type: 'object', properties: {} },
        execute: () => { logAi('consultou o banco de estratégias (8 setups)'); return toolBank(A); } },
      { name: 'detalhar_setup', description: 'Detalha um setup: walk-forward por janela, taxa de acerto por regime, CVaR 5% por gatilho, excursão adversa e resultado médio após custo. Use o id retornado por consultar_banco_de_setups.', inputSchema: { type: 'object', properties: { setup_id: { type: 'string', description: 'Id do setup, por exemplo RSI_OVERSOLD' } }, required: ['setup_id'] },
        execute: (inp) => { const r = toolDetail(A, inp && inp.setup_id); logAi('detalhou o setup ' + r.nome); return r; } },
      { name: 'verificar_vocabulario', description: 'Verifica um texto contra o vocabulário proibido da Política de Compliance (instrução de compra/venda, promessa de retorno, urgência). Retorna os termos sinalizados.', inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
        execute: (inp) => { const f = scanTerms(String((inp && inp.texto) || '')); logAi('verificou o vocabulário do rascunho: ' + (f.length ? f.length + ' termo(s)' : 'limpo')); return { termos_sinalizados: f.map((x) => x.term), aprovado: !f.length }; } }
    ];
  }
  const AI_ERR = {
    rate_limited: 'Muitas chamadas seguidas ou limite de uso atingido. Tente de novo em alguns minutos.',
    refused: 'O pedido foi recusado. O relatório do motor segue disponível na outra aba.', empty_completion: 'O Argos AI não produziu texto. Tente de novo.',
    prompt_too_large: 'Dados grandes demais para uma chamada.', data_unavailable: 'O servidor não conseguiu carregar os dados do motor agora. Nenhum texto foi gerado; tente de novo em instantes.', tool_limit: 'O Argos AI pediu consultas demais ao motor. Tente de novo.', invalid_tool_call: 'O provedor de IA pediu uma consulta inválida. Tente de novo.', upstream_error: 'Falha temporária de conexão. O texto parcial foi mantido; tente de novo.', cancelled: 'Interrompido.',
    unauthorized: 'Código de acesso ausente ou incorreto.', insufficient_balance: 'O Argos AI está indisponível agora. Tente de novo mais tarde.',
    not_configured: 'O Argos AI está indisponível agora. Tente de novo mais tarde.', bad_request: 'O Argos AI está indisponível agora. Tente de novo mais tarde.',
    provider_auth: 'O Argos AI está indisponível agora. Tente de novo mais tarde.'
  };

  // ------------------------------------ Argos AI via servidor próprio (deploy Vercel)
  // O navegador diz o recorte (ativo, tempo gráfico, regra de saída) e o prompt; o SERVIDOR executa as ferramentas sobre o
  // motor e guarda a chave do provedor de LLM. O cliente não declara ferramenta nem envia resultado de ferramenta
  // (o servidor recusa): era o caminho para forjar o número que a guarda numérica aceitaria. Resposta em SSE.
  const CFG = window.ARGOS_CONFIG || {};
  const SERVER_LLM = CFG.llm === 'server';
  function getCode() { try { return sessionStorage.getItem('argos_code') || state.code || ''; } catch (e) { return state.code || ''; } }
  function setCode(c) { state.code = c; try { sessionStorage.setItem('argos_code', c); } catch (e) { /* sessão sem storage */ } }
  // Pede o código de acesso no `host` (padrão: aviso da tela de IA) e, ao receber, chama `retry` (padrão: nova rodada de IA).
  // O registro de veredito usa o mesmo formulário, dentro do próprio painel de detalhe.
  let codeSeq = 0;
  function askCode(msg, host, retry) {
    const el = host || $('lvAiNote'), again = retry || runAi, fid = 'lvCode' + (++codeSeq);
    el.hidden = false;
    el.innerHTML = '<form class="code-form"><label for="' + fid + '">' + esc(msg) + '</label><input id="' + fid + '" type="password" autocomplete="off" placeholder="código de acesso"><button class="btn btn-sm btn-primary" type="submit">Entrar</button></form>';
    el.querySelector('form').onsubmit = (e) => { e.preventDefault(); setCode($(fid).value.trim()); el.hidden = true; el.textContent = ''; again(); };
    setTimeout(() => $(fid) && $(fid).focus(), 30);
  }
  function makeServerSampler() {
    const endpoint = CFG.endpoint || '/api/argos-ai';
    async function call(messages, context, signal, onDelta) {
      let r;
      try { r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-argos-code': getCode() }, body: JSON.stringify({ messages, context, stream: true }), signal }); }
      catch (e) { const err = new Error(signal && signal.aborted ? 'cancelado' : 'sem conexão'); err.code = signal && signal.aborted ? 'cancelled' : 'upstream_error'; throw err; }
      if (!r.ok || !r.body) {
        let j = null; try { j = await r.json(); } catch (e) { j = null; }
        const err = new Error((j && j.error) || 'HTTP ' + r.status);
        err.code = (j && j.code) || (r.status === 401 ? 'unauthorized' : r.status === 402 ? 'insufficient_balance' : r.status === 429 ? 'rate_limited' : r.status === 400 || r.status === 422 ? 'bad_request' : 'upstream_error');
        throw err;
      }
      const reader = r.body.getReader(), dec = new TextDecoder();
      const msg = { content: '', reasoning: '', calls: [] }; let buf = '', finish = null, meta = null;
      const handle = (data) => {
        if (data === '[DONE]') return;
        let j; try { j = JSON.parse(data); } catch (e) { return; }
        if (j.error) { const err = new Error(j.error.message || 'erro do provedor'); err.code = 'upstream_error'; throw err; }
        if (j.argos && j.argos.data) meta = j.argos.data;
        const ch = j.choices && j.choices[0]; if (!ch) return;
        const dl = ch.delta || {};
        if (dl.reasoning_content) msg.reasoning += dl.reasoning_content;
        if (dl.content) { msg.content += dl.content; if (onDelta) onDelta(msg.content); }
        (dl.tool_calls || []).forEach((tc) => {
          const i = tc.index != null ? tc.index : msg.calls.length;
          const cur = msg.calls[i] || (msg.calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) cur.id = tc.id;
          if (tc.function) { if (tc.function.name) cur.function.name += tc.function.name; if (tc.function.arguments) cur.function.arguments += tc.function.arguments; }
        });
        if (ch.finish_reason) finish = ch.finish_reason;
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1); if (line.startsWith('data:')) handle(line.slice(5).trim()); }
      }
      if (buf.trim().startsWith('data:')) handle(buf.trim().slice(5).trim());
      return { msg, finish, meta };
    }
    const samp = async function (prompt, opts) {
      const messages = [
        { role: 'system', content: 'Você é o Argos AI, camada de linguagem da Stratum Research. Escreva em português do Brasil e siga à risca as regras da mensagem do usuário.' },
        { role: 'user', content: prompt }
      ];
      const context = { symbol: state.sym, timeframe: state.tf, cfg: state.cfg, windowDays: state.win >= 30 ? state.win : null };
      const { msg, finish, meta } = await call(messages, context, opts.signal, (t) => opts.onText && opts.onText({ text: t }));
      return { text: msg.content, truncated: finish === 'length', modelTierApplied: 'Argos AI (servidor)', serverData: meta };
    };
    samp.limits = async () => ({ tools: true, serverTools: true });
    return samp;
  }
  const HIDE_CODES = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
  async function runAi() {
    if (!state.samp || state.ai.running) return;
    const A = state.A;
    state.ai = { text: '', running: true, done: false, ctl: new AbortController(), key: runKey(), log: [], err: '', prov: null };
    selectTab('ai');
    $('lvAskAi').disabled = true; $('lvStopAi').hidden = false; $('lvScan').innerHTML = '';
    logAi('Pensando… o Argos AI está planejando as consultas ao motor.', '…');
    renderAiReport(false);
    let code = null; const hadCode = !!getCode();
    let lim = null; try { lim = await state.samp.limits(); } catch (e) { lim = null; }
    const useTools = !!(lim && lim.tools);
    if (!useTools) logAi('Esta visualização não executa ferramentas: os dados do motor seguem no próprio pedido.', 'i');
    try {
      const opts = { signal: state.ai.ctl.signal, modelTier: 'default', onText: ({ text }) => { if (!state.ai.text) logAi('escrevendo', '✎'); state.ai.text = text; if (state.tab === 'ai') renderAiReport(false); } };
      if (useTools && lim.serverTools) logAi('O servidor consulta o motor (leitura técnica, banco de setups e detalhe dos setups) e confere cada número do texto.', 'i');
      else if (useTools) opts.tools = buildTools(A); else opts.cache = false;
      const res = await state.samp(buildPrompt(A, useTools), opts);
      state.ai.text = res.text; state.ai.prov = res.serverData || null; state.ai.done = true; state.ai.running = false;
      // O servidor consulta a própria série: se o último candle ou o tamanho diferem do que a tela mostra, avisa.
      if (res.serverData) {
        const sd = res.serverData, lastMs = A.d.t[A.d.n - 1] * 1000, srvMs = Date.parse(sd.lastCandle);
        if (srvMs !== lastMs || sd.candles !== A.d.n) logAi('Atenção: os números do relatório vêm da série do servidor (até ' + fmtDate(srvMs / 1000) + ', ' + sd.candles + ' candles), que difere da mostrada na tela (até ' + fmtDate(lastMs / 1000) + ', ' + A.d.n + ' candles). A aba Motor segue a série da tela.', '!');
        else logAi('Dados do servidor idênticos aos da tela (último candle ' + fmtDate(srvMs / 1000) + ').', '✓');
      }
      logAi(res.truncated ? 'Resposta cortada pelo limite de tamanho: o texto foi mantido como está.' : 'Relatório concluído · modelo: ' + (res.modelTierApplied || 'default'), res.truncated ? '!' : '✓');
    } catch (e) {
      code = (e && e.code) || 'upstream_error';
      if (e && e.text) state.ai.text = e.text;
      state.ai.running = false;
      if (code !== 'cancelled') { console.warn('[argos-ai] falha:', code); logAi(AI_ERR[code] || AI_ERR.upstream_error, '!'); } else logAi('Interrompido a pedido.', '■');
      if (HIDE_CODES.indexOf(code) >= 0) { state.samp = null; $('lvAskAi').hidden = true; $('lvAiNote').hidden = false; $('lvAiNote').textContent = (AI_ERR[code] || '') + ' O relatório do motor segue completo na aba ao lado.'; }
    } finally {
      state.ai.running = false; $('lvAskAi').disabled = false; $('lvStopAi').hidden = true;
      if (state.tab === 'ai') { if (state.ai.text) renderAiReport(true); else selectTab('ai'); }
    }
    if (code === 'unauthorized' && SERVER_LLM) askCode(hadCode ? 'Código incorreto. Digite de novo:' : 'Digite o código de acesso do Argos AI:');
  }

  // --------------------------------------------------------- Pine Script
  const PINE_COND = {
    RSI_OVERSOLD: 'r = ta.rsi(close, 14)\ntrig = r[1] < 30 and r >= 30',
    MACD_CROSS: '[m, s, h] = ta.macd(close, 12, 26, 9)\ntrig = m[1] <= s[1] and m > s',
    GOLDEN_CROSS: 'f = ta.sma(close, 50)\nsl = ta.sma(close, 200)\ntrig = f[1] <= sl[1] and f > sl',
    BB_LOWER: '[b, u, lo] = ta.bb(close, 20, 2)\ntrig = close < lo and not (close[1] < lo[1])',
    BREAKOUT_20: 'hh = ta.highest(high, 20)\ntrig = close > hh[1] and not (close[1] > hh[2])',
    EMA_PULLBACK: 'e20 = ta.ema(close, 20)\ne50 = ta.ema(close, 50)\nm200 = ta.sma(close, 200)\nabove3 = low[1] > e20[1] and low[2] > e20[2] and low[3] > e20[3]\ntrig = close > m200 and e20 > e50 and low <= e20 and close > e20 and above3',
    BULL_ENGULFING: 'pb = close[1] - open[1]\ncb = close - open\ntrig = pb < 0 and cb > 0 and open <= close[1] and close >= open[1] and cb > math.abs(pb)',
    HAMMER: 'body = math.abs(close - open)\nlw = math.min(open, close) - low\nuw = high - math.max(open, close)\ne20h = ta.ema(close, 20)\ntrig = body > 0 and lw >= 2 * body and uw <= 0.3 * body and close < e20h'
  };
  const pineStr = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, "'");
  function pineFor(s) {
    const A = state.A, d = A.d;
    const stats = 'N=' + s.n + ' (ef. ' + s.nEff + ') · acerto ' + fmtPct(s.winRate, 1) + ' · IC95 ' + fmtPct(s.ci[0], 1) + '–' + fmtPct(s.ci[1], 1) + ' · base ' + fmtPct(s.base, 1) + ' · p=' + fmtP(s.pTwo) + ' (ajust. ' + fmtP(s.q) + ')';
    return [
      '//@version=5',
      'indicator("Argos · ' + pineStr(s.nome) + ' (' + PAIR(state.sym) + ' ' + TF_LABEL[state.tf] + ')", overlay=true, max_labels_count=500)',
      '// Gerado pelo Argos Sentinel · Stratum Research. Pesquisa estatística, não recomendação.',
      '// Definição: ' + s.def,
      '// Evidência calculada em ' + new Date().toLocaleDateString('pt-BR') + ' sobre ' + fmtInt(d.n) + ' candles (' + fmtDay(d.t[A.warm]) + ' a ' + fmtDay(d.t[d.n - 1]) + '), Binance Spot.',
      '// Regra de saída do backtest: ' + cfgText(state.cfg) + '.',
      '// ' + stats + ' → ' + s.verdict.label,
      '',
      PINE_COND[s.id],
      '',
      'plotshape(trig, title="Gatilho Argos", style=shape.circle, location=location.belowbar, color=color.new(#B08D3E, 0), size=size.tiny)',
      'alertcondition(trig, title="Argos · gatilho", message="Argos: gatilho de ' + pineStr(s.nome) + ' em {{ticker}} ({{interval}}). Consulte a evidência no Argos antes de qualquer leitura.")',
      '',
      'var label info = na',
      'if barstate.islast',
      '    label.delete(info)',
      '    info := label.new(bar_index, high, "Argos · ' + pineStr(s.nome) + '\\n' + pineStr(stats) + '\\n' + pineStr(s.verdict.label) + '", style=label.style_label_down, color=color.new(#1E2A3A, 0), textcolor=color.new(#E8E3D8, 0), size=size.small)'
    ].join('\n');
  }
  let pineOpener = null;
  function openPine(s) {
    pineOpener = document.activeElement;
    $('lvPineTitle').textContent = 'Levar para o TradingView · ' + s.nome;
    $('lvPineCode').textContent = pineFor(s);
    $('lvPineToast').textContent = '';
    $('lvPineOpen').href = 'https://www.tradingview.com/chart/?symbol=BINANCE%3A' + state.sym + '&interval=' + ({ '1h': '60', '4h': '240', '1d': 'D' }[state.tf]);
    pineBackdrop(true);
    $('lvPine').hidden = false; $('lvPineClose').focus();
  }
  // aria-modal não impede o Tab de sair do diálogo: o resto da página fica inerte enquanto o modal está aberto.
  function pineBackdrop(on) { document.querySelectorAll('#page-dashboard > :not(#lvPine), .meta-nav').forEach((el) => { el.inert = on; }); }
  function closePine() { pineBackdrop(false); $('lvPine').hidden = true; if (pineOpener && pineOpener.focus) pineOpener.focus(); }

  // --------------------------------------------------- copiar / exportar
  async function copyText(text, toastEl, okMsg) {
    try { await navigator.clipboard.writeText(text); if (toastEl) toastEl.textContent = okMsg; return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      document.body.removeChild(ta);
      if (toastEl) toastEl.textContent = ok ? okMsg : 'Selecione o texto e copie manualmente.';
      return ok;
    }
  }
  function reportDocHTML() {
    const inner = $('lvReport').innerHTML.replace(/<span class="cursor"[^>]*><\/span>/g, '');
    const css = 'body{margin:0;background:#F6F2E9;color:#1D2733;font-family:"Source Serif 4",Cambria,Georgia,serif;font-size:16px;line-height:1.65}main{max-width:820px;margin:0 auto;padding:40px 28px}.r-kicker{font-family:"JetBrains Mono",monospace;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#8A6D2C;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px}h2{font-size:28px;color:#1E2A3A;margin:0 0 6px}.r-meta{font-family:"JetBrains Mono",monospace;font-size:11px;color:#5C6776;padding-bottom:14px;border-bottom:2px solid #B08D3E}.r-draft{font-family:"JetBrains Mono",monospace;font-size:11px;color:#7A5A1B;background:#EFE3C6;border-radius:4px;padding:7px 10px;display:inline-block;margin:12px 0 4px}h3{font-size:19px;color:#1E2A3A;margin:26px 0 8px}h3 .n{font-family:"JetBrains Mono",monospace;font-size:12px;color:#B08D3E;margin-right:10px}h4{font-size:15px;color:#1E2A3A;margin:12px 0 6px}.chip{font-family:"JetBrains Mono",monospace;font-size:12px;background:#E9E1D0;border-radius:3px;padding:1px 6px}.debate{display:grid;grid-template-columns:1fr 1fr;gap:14px}.debate>div{border:1px solid #DDD3BF;border-radius:6px;padding:12px 14px;background:#FBF8F1}table{border-collapse:collapse;font-family:"JetBrains Mono",monospace;font-size:12px;width:100%}th{text-align:left;border-bottom:1.5px solid #1E2A3A;padding:6px 8px}td{border-bottom:1px solid #E2D9C6;padding:6px 8px}.disc{font-family:"JetBrains Mono",monospace;font-size:11px;color:#5C6776;border-top:1px solid #D8CDB6;margin-top:26px;padding-top:14px}.sign{font-family:"JetBrains Mono",monospace;font-size:11px;margin-top:12px}mark{background:#F4C7C0}@media(max-width:640px){.debate{grid-template-columns:1fr}}';
    return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Relatório Estratégico · ' + esc(PAIR(state.sym)) + ' ' + TF_LABEL[state.tf] + '</title><style>' + css + '</style></head><body><main>' + inner + '</main></body></html>';
  }
  async function downloadReport() {
    const fname = 'Relatorio_Argos_' + state.sym + '_' + TF_LABEL[state.tf] + '_' + (state.tab === 'ai' && state.ai.text ? 'ArgosAI_' : '') + isoDay() + '.html';
    const html = reportDocHTML();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // --------------------------------------------------------- execução
  function pickDefault(A) { const act = A.setups.find((s) => s.activeNow); return act ? act.id : 'RSI_OVERSOLD'; }
  // Cache das análises (as séries de 4h têm ~20 mil candles): chave = série + regra + janela + último candle
  const acache = new Map();
  function seriesFor(sym, tf, winDays) {
    const en = entry(sym, tf); let d = en.d;
    if (winDays) d = E.sliceSeries(d, Math.round((winDays * 86400) / d.dt) + 200);
    return { en, d };
  }
  const analysisKey = (sym, tf, cfg, winDays, d) => [sym, tf, cfg.mode, cfg.tgt, cfg.stp, cfg.hold, winDays || 'all', d.n, d.t[d.n - 1]].join('|');
  function analysisFor(sym, tf, cfg, winDays) {
    const { en, d } = seriesFor(sym, tf, winDays);
    const k = analysisKey(sym, tf, cfg, winDays, d);
    let A = acache.get(k);
    if (!A) { A = E.analyze(d, cfg, { sym, tf, source: en.source, win: winDays || null }); acache.set(k, A); while (acache.size > 4) acache.delete(acache.keys().next().value); }
    return A;
  }
  function analyzeCurrent() { return analysisFor(state.sym, state.tf, state.cfg, state.win); }
  function analysisCached() { // só leitura: a pergunta atual já tem análise no cache (resposta imediata, sem o que esmaecer)?
    try { const { d } = seriesFor(state.sym, state.tf, state.win); return acache.has(analysisKey(state.sym, state.tf, state.cfg, state.win, d)); } catch (e) { return false; }
  }

  // ------------------------------------------------ movimento da tela Ao vivo (nada aqui muda o que é calculado)
  // "Pergunta mudou" = ativo, tempo gráfico, regra de saída ou janela diferentes dos da última análise desenhada (qSig).
  // Atualização automática de 60 s, chegada de candles ao vivo, seleção de linha, detalhe e recorte por regime mantêm a pergunta: não animam.
  const mo = { sig: null, tok: 0, staleTimer: 0, growTimer: 0, growT0: 0 };
  const STALE_MAX_MS = 8000; // teto: a classe nunca fica presa, mesmo que a análise não chegue ao fim
  const CI_GROW_MS = 1300; // escada (até 7 × 28 ms) + faixa (420 ms) + ponto (320 ms) + folga
  const qSig = () => [state.sym, state.tf, state.cfg.mode, state.cfg.tgt, state.cfg.stp, state.cfg.hold, state.win || 'all'].join('|');
  const nextPaint = () => new Promise((res) => { let done = false; const go = () => { if (done) return; done = true; setTimeout(res, 0); }; requestAnimationFrame(go); setTimeout(go, 80); }); // o setTimeout cobre aba em segundo plano
  function stalePanes() { // painéis de resultado: banco de estratégias (cartão), detalhe, relatório e mapa
    const bank = $('lvBank');
    return [bank && bank.closest ? bank.closest('.card') : null, $('lvDetail'), $('lvReport'), $('lvHeatmap')].filter(Boolean);
  }
  function staleOn() {
    stalePanes().forEach((el) => el.classList.add('m-pane', 'is-stale'));
    clearTimeout(mo.staleTimer); mo.staleTimer = setTimeout(staleOff, STALE_MAX_MS);
  }
  function staleOff() { // sai em emitAnalysis (fim de toda análise desenhada), nos caminhos de erro e pelo teto de tempo
    clearTimeout(mo.staleTimer); mo.staleTimer = 0;
    stalePanes().forEach((el) => el.classList.remove('is-stale'));
  }
  /**
   * Chamada logo depois de a pergunta mudar, antes de run(). Devolve true (síncrono) quando pode rodar já: movimento desligado, mesma
   * pergunta da última análise, análise em cache ou tela escondida. Senão esmaece os painéis e devolve uma promessa que cede um quadro
   * para a pintura antes de o motor ocupar a thread; ela resolve false se outra mudança chegou nesse meio-tempo (quem rodar é a nova).
   */
  function settle() {
    const tok = ++mo.tok;
    if (!MOT() || mo.sig === null || mo.sig === qSig() || !liveVisible() || analysisCached()) return true;
    staleOn();
    return nextPaint().then(() => tok === mo.tok);
  }
  function growCI() { // as faixas de IC crescem a partir da taxa-base; a classe é temporária e o estado sem ela é o final
    const tb = $('lvBank'); if (!tb || !MOT() || !liveVisible()) return;
    tb.style.removeProperty('--ci-skip');
    mo.growT0 = Date.now();
    tb.classList.add('ci-grow');
    clearTimeout(mo.growTimer);
    mo.growTimer = setTimeout(() => { tb.classList.remove('ci-grow'); tb.style.removeProperty('--ci-skip'); }, CI_GROW_MS);
  }
  async function run(animate, keepRange, forceSel) {
    let A;
    try { A = analyzeCurrent(); }
    catch (e) { if (!state.win) throw e; state.win = null; A = analyzeCurrent(); } // janela vinda da URL que o motor não aceita: volta à série inteira
    state.A = A;
    if (forceSel && A.setups.find((s) => s.id === forceSel)) state.selected = forceSel;
    else if (!state.selected || !A.setups.find((s) => s.id === state.selected) || !keepRange) state.selected = pickDefault(A);
    const asked = mo.sig !== null && mo.sig !== qSig(); // a pergunta mudou desde a última análise desenhada (atualização automática: não)
    renderSource(); renderTop(A); renderChart(A, keepRange); renderLegend(null); renderRead(A); renderBank(A); renderDetail(A);
    if (asked) growCI();
    if (state.tab === 'engine') renderEngineReport(); else selectTab('ai');
    renderShare(); syncUrl();
    if (mo.sig === null) document.querySelectorAll('#dash-live .sk').forEach((n) => n.remove()); // primeira análise na tela: o esqueleto de carregamento sai (o que ficou de fora do innerHTML)
    mo.sig = qSig();
    emitAnalysis(); // gancho para outros módulos (ex.: heatmap.js): análise calculada e desenhada
    await renderPipeline(A, animate || (asked && !!MOT()));
  }
  function setPressed(groupId, v) { document.querySelectorAll('#' + groupId + ' button').forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-v') === v)); }
  async function switchTo(sym, tf, sel) {
    if (window.ArgosCarga) await window.ArgosCarga.serie(sym, tf); // séries de candles carregam sob demanda (js/carregador.js)
    state.urlOn = true;
    state.sym = sym; state.tf = tf; setPressed('lvAsset', sym); setPressed('lvTf', tf);
    const w = settle(); if (w !== true && !(await w)) return; // outra troca chegou durante a pintura: é ela quem roda
    try { await run(false, false, sel); } catch (e) { staleOff(); throw e; }
    refreshLive(sym, tf).then((ch) => { if (ch && state.sym === sym && state.tf === tf) run(false, true); else renderSource(); });
  }
  // Abre a plataforma já no recorte de um caso (site → Ao vivo), com a regra de saída padrão
  async function openCase(sym, tf, setupId) {
    const def = { mode: 'atr', tgt: 2, stp: 1, hold: 12 };
    if (JSON.stringify(state.cfg) !== JSON.stringify(def)) { state.cfg = def; $('lvMode').value = 'atr'; $('lvTgt').value = 2; $('lvStp').value = 1; $('lvHold').value = 12; readCfg(); }
    await switchTo(sym, tf, setupId);
    const el = document.querySelector('#lvDetail'); if (el) setTimeout(() => el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }), 80);
  }
  async function rerun() { // regra de saída ou janela mudou: mesma análise de antes, com o esmaecer enquanto o motor recalcula
    const w = settle(); if (w !== true && !(await w)) return;
    try { await run(false, true); } catch (e) { staleOff(); throw e; }
  }
  function readCfg() {
    const mode = $('lvMode').value, tgt = parseFloat(String($('lvTgt').value).replace(',', '.')), stp = parseFloat(String($('lvStp').value).replace(',', '.')), hold = parseInt($('lvHold').value, 10);
    state.cfg = { mode: mode === 'pct' ? 'pct' : 'atr', tgt: isFinite(tgt) && tgt > 0 ? Math.min(20, tgt) : 2, stp: isFinite(stp) && stp > 0 ? Math.min(20, stp) : 1, hold: isFinite(hold) ? Math.max(2, Math.min(60, hold)) : 12 };
    $('lvExitSum').textContent = 'Regra de saída: ' + cfgText(state.cfg);
  }

  // ------------------------------------------------ a pergunta vai na URL
  // O link guarda a pergunta (ativo, tempo gráfico, regra de saída, janela, setup, recorte de regime), nunca o resultado.
  // Ler e montar os parâmetros são funções puras de url-state.js (ArgosUrlState); aqui só se liga isso ao estado da tela.
  // A URL só é reescrita depois que ela já trazia a pergunta ou que a pessoa mexeu na análise: quem apenas abre o site
  // não ganha parâmetros no endereço. O #hash de navegação (#ao-vivo, #plataforma) é mantido como está.
  const urlRegimes = () => ['ALL', 'CURRENT'].concat(Object.keys(E.REGIMES).filter((r) => r !== 'UNKNOWN'));
  const urlSetups = () => { const ids = (E.SETUPS || []).map((s) => s.id); return ids.length ? ids : undefined; };
  const urlView = () => ({ sym: state.sym, tf: state.tf, cfg: state.cfg, win: state.win, setup: state.selected, regime: state.regimeSel });
  function readUrl() { // preenche o estado e os campos com a pergunta da URL; devolve o setup pedido (ou null)
    if (!US) return null;
    let q = {};
    try { q = US.parse(location.search, { regimes: urlRegimes(), setups: urlSetups() }) || {}; } catch (e) { q = {}; }
    if (!Object.keys(q).length) return null;
    state.urlOn = true;
    if (q.sym) state.sym = q.sym;
    if (q.tf) state.tf = q.tf;
    if (q.cfg) {
      if (q.cfg.mode) $('lvMode').value = q.cfg.mode;
      if (q.cfg.tgt) $('lvTgt').value = q.cfg.tgt;
      if (q.cfg.stp) $('lvStp').value = q.cfg.stp;
      if (q.cfg.hold) $('lvHold').value = q.cfg.hold;
    }
    if (q.win) state.win = q.win;
    if (q.regime) state.regimeSel = q.regime;
    setPressed('lvAsset', state.sym); setPressed('lvTf', state.tf);
    return q.setup || null;
  }
  function liveVisible() { const pg = $('page-dashboard'), dash = $('dash-live'); return !!(pg && dash && pg.classList.contains('visible') && dash.classList.contains('visible')); }
  function syncUrl() {
    if (!US || !state.urlOn) return;
    try {
      const qs = US.build(urlView(), { keep: location.search, regimes: urlRegimes(), setups: urlSetups() });
      const hash = location.hash || (liveVisible() ? '#ao-vivo' : ''); // hash existente é mantido; sem ele, quem está em Ao vivo recarrega em Ao vivo
      if (qs && ('?' + qs !== location.search || hash !== location.hash)) history.replaceState(history.state, '', '?' + qs + hash);
    } catch (e) { /* sem history (arquivo local, quadro isolado): a análise segue sem URL */ }
  }
  function touchUrl() { state.urlOn = true; syncUrl(); }
  function shareUrl() {
    const qs = US ? US.build(urlView(), { regimes: urlRegimes(), setups: urlSetups() }) : '';
    if (!qs) return '';
    const nav = location.hash === '#plataforma' ? '#plataforma' : '#ao-vivo'; // sem #hash de navegação, o link abre em Ao vivo
    return location.href.replace(/[?#].*$/, '') + '?' + qs + nav;
  }
  const SHARE_NOTE = 'O link guarda a pergunta, não o resultado: os números podem mudar se os candles mudarem. Para fixar o resultado, registre o veredito.';
  const SHARE_LABEL = 'Copiar link desta análise';
  let shareUi = null, shareTimer = 0;
  function buildShare() {
    const head = US && !shareUi && document.querySelector('#dash-live .live-head > div'); if (!head) return;
    const box = document.createElement('div'); box.className = 'lv-share'; box.id = 'lvShare';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-sm'; btn.id = 'lvShareBtn'; btn.textContent = SHARE_LABEL;
    btn.setAttribute('aria-live', 'polite'); btn.setAttribute('aria-describedby', 'lvShareNote');
    const note = document.createElement('span'); note.className = 'lv-share-note'; note.id = 'lvShareNote';
    const win = document.createElement('span'); win.className = 'lv-share-win'; win.hidden = true;
    if (CAN_REGISTER) { btn.title = SHARE_NOTE; note.textContent = SHARE_NOTE; }
    else { btn.disabled = true; btn.title = 'O link só existe na versão publicada da plataforma.'; note.textContent = 'O link só existe na versão publicada da plataforma.'; }
    box.appendChild(btn); box.appendChild(win); box.appendChild(note); head.appendChild(box);
    btn.addEventListener('click', async () => {
      touchUrl(); // o endereço da barra passa a refletir a análise: serve de alternativa se a cópia falhar
      const url = shareUrl(), ok = url ? await copyText(url, null, '') : false;
      btn.textContent = ok ? 'Link copiado' : 'Não copiou';
      clearTimeout(shareTimer); shareTimer = setTimeout(() => { btn.textContent = SHARE_LABEL; }, 2000);
    });
    win.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-act="win-clear"]') : null; if (!b) return;
      state.win = null; state.urlOn = true; rerun();
    });
    shareUi = { btn, win };
  }
  function renderShare() {
    if (!shareUi) return;
    const w = shareUi.win;
    w.hidden = !state.win;
    w.innerHTML = state.win ? 'Janela: últimos ' + esc(fmtInt(state.win)) + ' dias <button type="button" class="lv-linkbtn" data-act="win-clear">usar a série inteira</button>' : '';
  }

  // ------------------------------------------------ ganchos para outros módulos
  // argos:analysis (saída): disparado ao fim de cada análise calculada e desenhada, com { A, E }.
  // argos:select (entrada): { setupId, regime } seleciona o setup, aplica o recorte de regime ('ALL', 'CURRENT' ou o código)
  // e rola até o banco de setups. Valor desconhecido é ignorado.
  function emitAnalysis() {
    try { document.dispatchEvent(new CustomEvent('argos:analysis', { detail: { A: state.A, E } })); } catch (e) { /* sem CustomEvent */ }
    staleOff(); // análise desenhada (inclusive o mapa, que se redesenha no evento): os painéis voltam à opacidade normal
  }
  function revealBank() {
    if (!liveVisible() && typeof window.openLive === 'function') { try { window.openLive(); } catch (e) { /* navegação indisponível */ } } // openLive é do nav.js
    const go = () => { const h = $('lvBankH'), sec = h && h.closest ? h.closest('section') : null, el = sec || h; if (el && el.scrollIntoView) el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); };
    if (window.requestAnimationFrame) requestAnimationFrame(go); else go();
  }
  function onExternalSelect(ev) {
    const d = (ev && ev.detail) || {}, A = state.A; if (!A || typeof d !== 'object') return;
    const id = typeof d.setupId === 'string' && A.setups.some((s) => s.id === d.setupId) ? d.setupId : null;
    const V = regimeOf(A), rg = typeof d.regime === 'string' ? d.regime : null;
    const regOk = !!(rg && V && (rg === 'ALL' || rg === 'CURRENT' || V.regimes.indexOf(rg) >= 0));
    if (!id && !regOk) return;
    if (regOk) { state.regimeSel = rg; renderBank(A); }
    if (id) selectSetup(id, false);
    touchUrl();
    revealBank();
  }

  // Tela Regime: cartões calculados ao vivo (diário)
  function renderRegimeScreen() {
    const host = document.getElementById('lvRegimeCards'), ih = document.getElementById('lvRegimeInterp');
    if (!host) return;
    const cls = { BULL_TREND: 'bull', BEAR_TREND: 'bear', HIGH_VOL_RANGING: 'hv', LOW_VOL_RANGING: 'lv', STRUCTURAL_BREAK: 'break', UNKNOWN: 'lv' };
    const INTERP = {
      BULL_TREND: 'Tendência de alta com volatilidade contida. Setups de continuação costumam ser avaliados neste regime; a evidência de cada um continua sendo medida contra entradas aleatórias no mesmo período.',
      BEAR_TREND: 'Tendência de baixa estabelecida (ADX acima de 25 com preço abaixo da MM200). Estatísticas de setups de alta tendem a ter N pequeno neste regime.',
      HIGH_VOL_RANGING: 'Mercado sem tendência limpa e com volatilidade elevada ou em zona intermediária de ADX. É o regime em que a dispersão dos desfechos costuma ser maior.',
      LOW_VOL_RANGING: 'Mercado lateral e calmo: ADX abaixo de 20 e volatilidade realizada abaixo do percentil 60 dos últimos 252 dias.',
      STRUCTURAL_BREAK: 'Quebra estatisticamente significativa na média dos retornos recentes. Durante a transição, estatísticas históricas têm validade reduzida.'
    };
    const cards = [], interps = [];
    ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].forEach((sym) => {
      const d = entry(sym, '1d').d, ind = E.computeIndicators(d), reg = E.regimeSeries(d, ind), rs = E.regimeStats(reg), r = reg[d.n - 1], R = E.REGIMES[r.regime];
      const runs = rs.runs, cur = runs[runs.length - 1], prev = runs.length > 1 ? runs[runs.length - 2] : null, recent = cur && d.n - 1 - cur.start < 3 && prev;
      const alert = r.regime === 'STRUCTURAL_BREAK' ? '<div class="regime-alert">⚠ Quebra estrutural (Chow p = ' + fmtP(r.chowP) + '). Estatísticas históricas têm confiabilidade reduzida durante a transição.</div>' : recent ? '<div class="regime-alert">⚠ Transição recente: ' + esc(E.REGIMES[prev.regime].label) + ' → ' + esc(R.label) + '.</div>' : '';
      cards.push('<div class="regime-card' + (r.regime === 'STRUCTURAL_BREAK' ? ' is-break' : '') + '"><div class="regime-card-top"><div><div class="regime-asset">' + PAIR(sym) + ' · 1D</div><div class="regime-name ' + esc(cls[r.regime]) + '">' + esc(R.label) + '</div></div><div class="regime-conf-box"><div class="l">CONFIANÇA</div><div class="v">' + fmtN(r.confidence * 100, 0) + '%</div></div></div><div class="conf-bar"><div class="conf-bar-fill ' + esc(cls[r.regime]) + '" style="width:' + Math.round(r.confidence * 100) + '%;"></div></div><div class="regime-metrics"><div class="regime-metric"><div class="l">ADX (14)</div><div class="v">' + fmtN(r.adx, 2) + '</div></div><div class="regime-metric"><div class="l">Vol. realizada · percentil</div><div class="v">' + fmtN(r.rvPct, 0) + '°</div></div><div class="regime-metric"><div class="l">Preço / MM200</div><div class="v ' + (r.priceVsMa >= 0 ? 'pos' : '') + '">' + fmtN((1 + r.priceVsMa) * 100, 1) + '%</div></div><div class="regime-metric"><div class="l">Chow p-valor</div><div class="v' + (r.chowP < 0.01 ? ' warn' : '') + '">' + fmtN(r.chowP, 4) + '</div></div></div>' + alert + '<div class="regime-computed">Candle diário fechado em ' + fmtDay(d.t[d.n - 1]) + ' · em vigor há ' + (cur ? cur.end - cur.start + 1 : 0) + ' dias</div></div>');
      interps.push('<div class="interp-card"><div class="interp-head"><span class="interp-dot ' + esc(cls[r.regime]) + '"></span><span>' + PAIR(sym) + ' — ' + esc(R.label) + '</span></div><p class="desc">' + esc(INTERP[r.regime]) + ' Critério: ' + esc(regimeWhy(r)) + '</p></div>');
    });
    host.innerHTML = cards.join(''); if (ih) ih.innerHTML = interps.join('');
    const src = document.getElementById('lvRegimeSrc'); if (src) { const dd = entry('BTCUSDT', '1d').d; src.textContent = 'Calculado agora no navegador · Binance Spot · último candle diário fechado em ' + fmtDay(dd.t[dd.n - 1]) + '.'; }
  }

  // ------------------------------------------------------------- init
  function bind() {
    document.querySelectorAll('#lvAsset button').forEach((b) => b.addEventListener('click', () => switchTo(b.getAttribute('data-v'), state.tf)));
    document.querySelectorAll('#lvTf button').forEach((b) => b.addEventListener('click', () => switchTo(state.sym, b.getAttribute('data-v'))));
    $('lvMa').addEventListener('change', (e) => { state.show.ma = e.target.checked; applyVisibility(); renderLegend(null); });
    $('lvBb').addEventListener('change', (e) => { state.show.bb = e.target.checked; applyVisibility(); });
    $('lvVol').addEventListener('change', (e) => { state.show.vol = e.target.checked; applyVisibility(); });
    ['lvMode', 'lvTgt', 'lvStp', 'lvHold'].forEach((id) => $(id).addEventListener('change', () => { readCfg(); state.urlOn = true; rerun(); }));
    $('lvRun').addEventListener('click', async () => {
      readCfg(); state.urlOn = true; $('lvRun').disabled = true;
      const w = settle(); if (w !== true && !(await w)) { $('lvRun').disabled = false; return; } // outra mudança chegou durante a pintura: é ela quem roda
      try { await refreshLive(state.sym, state.tf); await run(true, true); } catch (e) { staleOff(); throw e; }
      $('lvRun').disabled = false;
    });
    $('lvZin').addEventListener('click', () => zoom(0.7)); $('lvZout').addEventListener('click', () => zoom(1.45)); $('lvZfit').addEventListener('click', fitDefault);
    $('lvRegSel').addEventListener('change', (e) => { state.regimeSel = e.target.value; if (state.A) renderBank(state.A); touchUrl(); });
    document.addEventListener('argos:select', onExternalSelect);
    $('lvBank').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) selectSetup(tr.getAttribute('data-id'), false); });
    $('lvBank').addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const tr = e.target.closest('tr[data-id]'); if (tr) { e.preventDefault(); selectSetup(tr.getAttribute('data-id'), false); } });
    $('lvTabEngine').addEventListener('click', () => selectTab('engine')); $('lvTabAi').addEventListener('click', () => selectTab('ai'));
    $('lvAskAi').addEventListener('click', runAi); $('lvStopAi').addEventListener('click', () => state.ai.ctl && state.ai.ctl.abort());
    $('lvCopy').addEventListener('click', async () => { const ok = await copyText(currentReportMarkdown(), null, ''); $('lvCopy').textContent = ok ? 'Copiado' : 'Não copiou'; setTimeout(() => ($('lvCopy').textContent = 'Copiar'), 1800); });
    $('lvDown').addEventListener('click', downloadReport);
    $('lvPrint').addEventListener('click', () => { try { window.print(); } catch (e) { /* sem impressão */ } });
    $('lvPineClose').addEventListener('click', closePine);
    $('lvPine').addEventListener('click', (e) => { if (e.target === $('lvPine')) closePine(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('lvPine').hidden) closePine(); });
    $('lvPineCopy').addEventListener('click', () => copyText($('lvPineCode').textContent, $('lvPineToast'), 'Código copiado.'));
    document.addEventListener('click', (e) => { const det = $('lvExit'); if (det.open && !det.contains(e.target)) det.open = false; });
  }
  function initCapabilities() {
    $('lvDown').hidden = false; $('lvPrint').hidden = false;
    if (SERVER_LLM) { state.samp = makeServerSampler(); $('lvAskAi').hidden = false; }
  }
  function onShow() {
    regOpen(); // lista de registros deste navegador: relê e consulta o carimbo (no máximo uma vez por minuto)
    if (!chart || !state.A) return;
    requestAnimationFrame(() => { if (!state.shownOnce) { state.shownOnce = true; fitDefault(); renderPipeline(state.A, true); growCI(); } });
  }
  function init() {
    if (!E || !SNAP || !LWC || !$('lvChart')) { // sem motor ou gráfico a análise nunca vem: o esqueleto de carregamento não pode ficar para sempre
      if (document.querySelectorAll) document.querySelectorAll('#dash-live .sk').forEach((n) => n.remove());
      return;
    }
    $('lvAiNote').textContent = SERVER_LLM ? '' : 'Neste arquivo, o relatório é redigido pelo motor determinístico, com os mesmos números. A camada Argos AI (LLM) roda na versão publicada da plataforma.';
    const urlSetup = readUrl(); // pergunta da URL (se houver) antes de ler os campos da regra de saída
    buildChart(); bind(); readCfg(); renderFoot(); buildShare(); buildRegs();
    run(true, false, urlSetup);
    setTimeout(renderRegimeScreen, 60);
    // A tela Regime usa as séries diárias: completa com os candles novos (Binance ou base da Stratum) e redesenha se algo mudou.
    Promise.all(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].map((sy) => refreshLive(sy, '1d').catch(() => false))).then((r) => { if (r.some(Boolean)) renderRegimeScreen(); });
    initCapabilities();
    {
      refreshLive(state.sym, state.tf).then((ch) => { if (ch) run(false, true); else renderSource(); });
      state.liveTimer = setInterval(() => { if (document.visibilityState !== 'visible') return; const s0 = state.sym, t0 = state.tf; refreshLive(s0, t0).then((ch) => { if (ch && s0 === state.sym && t0 === state.tf) run(false, true); }); }, 60000);
    }
  }
  window.ArgosLive = {
    init, onShow, openCase, run: () => run(true, true), state,
    check: { scan: scanTerms, reportMd: () => reportToMarkdown(buildReport(state.A)), switchTo, shareUrl },
    util: { E, SERVER_LLM, fmtN, fmtPct, fmtSPct, fmtP, fmtInt, fmtDate, fmtDay, esc, PAIR, TF_LABEL, pl, spanText, entry, dbSeries, refreshLive, cfgText, analysisFor, scanTerms, copyText, regimeWhy, nowBrt, isoDay, refreshLive }
  };
})();

