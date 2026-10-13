/* =====================================================================
   ARGOS · Plataforma v1.1 — Sandbox (Pine → teste), Query (formato API),
   Calibração (prequencial) e interações do site (matriz do estudo, gráficos).
   Tudo roda no navegador sobre o mesmo motor da análise ao vivo.
   ===================================================================== */
(function () {
  'use strict';
  // Telas em construção. false: a entrada continua no menu com a etiqueta "em construção" e a tela mostra só um aviso
  // (o protótipo interativo não é montado). true: a tela volta a ser o protótipo. Para reabrir, troque false por true.
  const FEATURES = { sandbox: false, query: false };
  const L = window.ArgosLive; if (!L || !L.util) return;
  const U = L.util, E = U.E, $ = (id) => document.getElementById(id);
  const { fmtN, fmtPct, fmtSPct, fmtP, fmtInt, fmtDay, esc, PAIR, TF_LABEL, pl } = U;
  const DEF = { mode: 'atr', tgt: 2, stp: 1, hold: 12 };
  const TONE = { EDGE: 'good', EDGE_SENSIVEL: 'warn', ABAIXO: 'bad', SEM_EDGE: 'muted', INSUFICIENTE: 'neutral' };
  const REG_CLS = { BULL_TREND: 'bull', BEAR_TREND: 'bear', HIGH_VOL_RANGING: 'hv', LOW_VOL_RANGING: 'lv', STRUCTURAL_BREAK: 'break', UNKNOWN: 'lv' };
  const later = (fn) => new Promise((res) => requestAnimationFrame(() => setTimeout(() => res(fn()), 16)));
  function setPressed(groupId, v) { document.querySelectorAll('#' + groupId + ' button').forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-v') === v)); }
  function pressed(groupId) { const b = document.querySelector('#' + groupId + ' button[aria-pressed="true"]'); return b ? b.getAttribute('data-v') : null; }
  function bindSeg(groupId, cb) { document.querySelectorAll('#' + groupId + ' button').forEach((b) => b.addEventListener('click', () => { setPressed(groupId, b.getAttribute('data-v')); if (cb) cb(b.getAttribute('data-v')); })); }
  function num(id, def, lo, hi) { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; }
  const qid = () => 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ================================================================ blocos comuns
  function ciBar(s) {
    if (!isFinite(s.ci[0])) return '';
    const mx = Math.max(0.6, s.ci[1] * 1.1, s.base * 1.2), X = (v) => Math.max(0, Math.min(100, (v / mx) * 100));
    return '<div class="ci-bar" aria-hidden="true"><div class="ci-fill" style="left:' + X(s.ci[0]) + '%;width:' + Math.max(1, X(s.ci[1]) - X(s.ci[0])) + '%"></div><div class="ci-base" style="left:' + X(s.base) + '%"></div><div class="ci-point" style="left:' + X(s.winRate) + '%"></div></div>';
  }
  function statCards(s, calib, famTxt) {
    const tone = TONE[s.verdict.key] || 'muted';
    const c = calib && calib.n >= 30 ? calib : null;
    return '<div class="stat-grid pv-grid">' +
      '<div class="stat-card tone-' + tone + '"><div class="label">Evidência</div><div class="value v-verdict">' + esc(s.verdict.label) + '</div><div class="sub">N ' + fmtInt(s.n) + ' · efetivo ' + fmtInt(s.nEff) + '</div></div>' +
      '<div class="stat-card"><div class="label">Taxa de acerto</div><div class="value">' + fmtPct(s.winRate, 1) + '</div>' + ciBar(s) + '<div class="sub">IC 95% ' + fmtPct(s.ci[0], 1) + '–' + fmtPct(s.ci[1], 1) + ' (' + (s.method === 'wilson' ? 'Wilson' : 'Bayes') + ') · base ' + fmtPct(s.base, 1) + '</div></div>' +
      '<div class="stat-card"><div class="label">Contra o acaso</div><div class="value">' + (s.alphaPP >= 0 ? '+' : '−') + fmtN(Math.abs(s.alphaPP), 1) + ' pp</div><div class="sub">p ' + fmtP(s.pTwo) + ' · ajustado ' + fmtP(isFinite(s.q) ? s.q : s.pTwo) + (famTxt ? ' (' + famTxt + ')' : '') + '</div></div>' +
      '<div class="stat-card"><div class="label">Calibração</div><div class="value">' + (c ? fmtSPct(c.bss, 1) : '—') + '</div><div class="sub">' + (c ? 'ganho sobre a taxa-base · ECE ' + fmtN(c.ece * 100, 1) + ' p.p. · ' + fmtInt(c.n) + ' previsões' : 'previsões fora da amostra insuficientes') + '</div></div>' +
      '</div>';
  }
  function riskAndRegime(s, regNow) {
    const regs = Object.keys(s.byRegime).filter((r) => r !== 'UNKNOWN').sort((a, b) => s.byRegime[b].n - s.byRegime[a].n);
    const rl = regs.length ? regs.map((r) => { const x = s.byRegime[r]; return '<div class="regime-list-row' + (r === regNow ? ' current' : '') + '">' + E.REGIMES[r].label + ' <span class="n">' + (r === regNow ? '← atual · ' : '') + fmtPct(x.w / x.n, 1) + ' (N=' + x.n + ')</span></div>'; }).join('') : '<div class="regime-list-row">Sem gatilhos com desfecho.</div>';
    return '<div class="detail-row">' +
      '<div class="detail-card card"><div class="section-label">Risco por gatilho</div><div class="detail-metrics">' +
      '<div class="m"><div class="l">CVaR 5%</div><div class="v neg">' + fmtSPct(s.cvar, 2) + '</div></div>' +
      '<div class="m"><div class="l">Pior</div><div class="v neg">' + fmtSPct(s.worst, 2) + '</div></div>' +
      '<div class="m"><div class="l">MAE mediana</div><div class="v">' + fmtSPct(s.maeMedian, 2) + '</div></div>' +
      '<div class="m"><div class="l">Médio após 0,1%</div><div class="v">' + fmtSPct(s.meanNet, 2) + '</div></div>' +
      '</div><p class="pv-note">Números do comportamento passado. Não são limite de perda nem indicam tamanho de posição.</p></div>' +
      '<div class="detail-card card"><div class="section-label">Taxa de acerto por regime no gatilho</div><div class="regime-list">' + rl + '</div></div></div>';
  }
  function wfCard(s, d) {
    if (!s.wf || !s.wf.available) return '<div class="card wf-card"><div class="wf-head"><span class="title">Walk-forward (5 janelas, com expurgo)</span></div><p class="pv-note">' + esc((s.wf && s.wf.reason) || 'Indisponível.') + '</p></div>';
    const rows = s.wf.walks.map((w, k) => '<tr><td>' + (k + 2) + ' · ' + fmtDay(d.t[w.from]) + ' → ' + fmtDay(d.t[w.to]) + '</td><td>' + w.trainN + '</td><td>' + fmtPct(w.trainWR, 1) + '</td><td>' + w.testN + '</td><td class="' + (w.testWR >= w.trainWR ? 'wf-pos' : 'wf-neg') + '">' + fmtPct(w.testWR, 1) + '</td><td>' + (w.dropPP >= 0 ? '−' : '+') + fmtN(Math.abs(w.dropPP), 1) + ' pp</td><td class="' + (w.overfit ? 'wf-cross' : 'wf-check') + '">' + (w.overfit ? '✗' : '✓') + '</td></tr>').join('');
    return '<div class="card wf-card"><div class="wf-head"><span class="title">Walk-forward (5 janelas, com expurgo)</span><span class="wf-badge ' + (s.wf.consistent ? 'ok' : 'warn') + '">' + (s.wf.consistent ? '✓ nenhuma janela caiu mais de 15 pp' : '⚠ sensível a subperíodos') + '</span></div>' +
      '<div class="table-scroll"><table class="wf-table"><thead><tr><th>Janela de teste</th><th>Treino N</th><th>Treino</th><th>Teste N</th><th>Teste</th><th>Queda</th><th>Estável</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="wf-summary">Brier fora da amostra ' + fmtN(s.wf.brier, 3) + ' contra ' + fmtN(s.wf.brierRef, 3) + ' da taxa-base conhecida na época (ganho ' + fmtSPct(s.wf.bss, 1) + '), em ' + s.wf.nPred + ' previsões.</div></div>';
  }
  function warningsFor(s, famN, d, cfg) {
    const w = [];
    if (s.nEff < 10) w.push('Evidência insuficiente: N efetivo ' + s.nEff + ', abaixo do mínimo de 10 para qualquer conclusão.');
    else if (s.nEff < 25) w.push('Amostra pequena (N efetivo ' + s.nEff + '): o intervalo usa o método bayesiano e é largo.');
    if (s.pTwo < 0.05 && !(s.q < 0.05)) w.push('O p bruto (' + fmtP(s.pTwo) + ') ficou abaixo de 0,05, mas não resiste ao ajuste para ' + famN + ' ' + pl(famN, 'teste', 'testes') + ' (' + fmtP(s.q) + '). Tratar como acaso.');
    if (s.wf && s.wf.available && !s.wf.consistent) w.push('Ao menos uma janela do walk-forward caiu mais de 15 pp em relação ao treino: o resultado depende do subperíodo.');
    if (s.rho > 0.2) w.push('Autocorrelação entre gatilhos (ρ ' + fmtN(s.rho, 2) + '): a amostra vale menos do que o N bruto sugere.');
    if (s.timeouts > s.n * 0.4) w.push(Math.round((s.timeouts / Math.max(1, s.n)) * 100) + '% dos gatilhos terminaram por prazo, sem tocar alvo nem stop: o horizonte de ' + cfg.hold + ' candles pode ser curto para esta regra.');
    if (d && d.dt === 3600) w.push('Tempo gráfico de 1h: a plataforma carrega os últimos ' + fmtInt(d.n) + ' candles (desde ' + fmtDay(d.t[0]) + '); o estudo de referência usa o 1h desde janeiro de 2022.');
    return w.length ? '<div class="warnings">' + w.map((x) => '<div class="warning-item"><span class="mark">⚠</span> ' + esc(x) + '</div>').join('') + '</div>' : '';
  }

  // ================================================================ Pine Script
  const TPL = {
    rsi: '//@version=5\nindicator("RSI 30", overlay=false)\nr = ta.rsi(close, 14)\nsinal = ta.crossover(r, 30)\nalertcondition(sinal, title="RSI cruza 30 para cima")',
    ma: '//@version=5\nstrategy("EMA 9/21", overlay=true)\nrapida = ta.ema(close, 9)\nlenta = ta.ema(close, 21)\nif ta.crossover(rapida, lenta)\n    strategy.entry("L", strategy.long)',
    macd: '//@version=5\nindicator("MACD", overlay=false)\n[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)\nalertcondition(ta.crossover(macdLine, signalLine), title="MACD cruza o sinal")',
    bb: '//@version=5\nindicator("Bollinger inferior", overlay=true)\n[basis, upper, lower] = ta.bb(close, 20, 2.0)\ntoque = close < lower and close[1] >= lower[1]\nplotshape(toque, style=shape.triangleup, location=location.belowbar)',
    brk: '//@version=5\nindicator("Rompimento 55", overlay=true)\ntopo = ta.highest(high, 55)\nrompe = close > topo[1]\nalertcondition(rompe, title="Rompimento de 55 candles")'
  };
  function stripParens(s) {
    let prev;
    do { prev = s; s = s.replace(/\(((?:ta\.\w+|__\w+)\([^()]*\)(?:\[\d+\])?)\)/g, '$1').replace(/\(([\w.]+(?:\[\d+\])?)\)/g, '$1'); } while (s !== prev);
    return s;
  }
  function splitArgs(s, open) { // s[open] === '(' → [args, índice do ')']
    const out = []; let depth = 0, cur = '';
    for (let i = open + 1; i < s.length; i++) {
      const ch = s[i];
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') { if (depth === 0) { out.push(cur.trim()); return [out, i]; } depth--; }
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    return [out, s.length];
  }
  const norm = (x) => String(x).replace(/\s+/g, ' ').replace(/\s*([(),\[\]<>=+\-*\/?:!])\s*/g, '$1').trim();
  function parsePine(code) {
    const lines = String(code || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '').replace(/\s+$/, ''));
    const vars = {}, notes = [];
    const src = lines.join('\n');
    if (!/\S/.test(src)) return { ok: false, msg: 'Cole um script Pine para o Argos ler.' };
    lines.forEach((l) => {
      let m = l.match(/^\s*\[\s*([\w\s,]+?)\s*\]\s*=\s*ta\.(macd|bb)\s*\(\s*close\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
      if (m) {
        const names = m[1].split(',').map((x) => x.trim());
        if (m[2] === 'macd') { const a = m[3] + ',' + m[4] + ',' + (m[5] || '9'); if (names[0]) vars[names[0]] = '__macd_line(' + a + ')'; if (names[1]) vars[names[1]] = '__macd_signal(' + a + ')'; if (names[2]) vars[names[2]] = '__macd_hist(' + a + ')'; }
        else { const a = m[3] + ',' + m[4]; if (names[0]) vars[names[0]] = '__bb_basis(' + a + ')'; if (names[1]) vars[names[1]] = '__bb_upper(' + a + ')'; if (names[2]) vars[names[2]] = '__bb_lower(' + a + ')'; }
        return;
      }
      m = l.match(/^\s*(?:var\s+)?(?:(?:float|int|bool|series\s+float|simple\s+int)\s+)?([A-Za-z_]\w*)\s*:?=\s*(.+)$/);
      if (m && !/^(if|else|for|while|strategy|plot|plotshape|plotchar|alertcondition|indicator|study|bgcolor|barcolor)$/.test(m[1])) vars[m[1]] = norm(m[2]);
    });
    const resolve = (expr, depth) => {
      if (depth > 5) return expr;
      return expr.replace(/(?<![\w.])([A-Za-z_]\w*)\b(?!\s*\()/g, (w) => (Object.prototype.hasOwnProperty.call(vars, w) && !/^(close|open|high|low|volume|and|or|not|true|false|ta|math)$/.test(w) ? '(' + resolve(vars[w], depth + 1) + ')' : w));
    };
    const flat = stripParens(resolve(lines.map(norm).join('\n'), 0));
    const shortHint = /ta\.crossunder\(/.test(flat) || /strategy\.short/.test(flat);
    const num = (x) => (/^-?\d+(\.\d+)?$/.test(x) ? parseFloat(x) : NaN);
    const maOf = (x) => { const m = x.match(/^ta\.(sma|ema)\(close,(\d+)\)$/); return m ? { kind: m[1], len: +m[2] } : null; };
    const rsiOf = (x) => { const m = x.match(/^ta\.rsi\(close,(\d+)\)$/); return m ? +m[1] : NaN; };
    const cands = [];
    // 1) ta.crossover(A, B)
    let k = -1;
    while ((k = flat.indexOf('ta.crossover(', k + 1)) >= 0) {
      const [args] = splitArgs(flat, k + 'ta.crossover'.length);
      if (args.length !== 2) continue;
      const A = stripParens(args[0]), B = stripParens(args[1]);
      const rl = rsiOf(A), lv = num(B), mA = maOf(A), mB = maOf(B);
      if (isFinite(rl) && isFinite(lv)) cands.push({ type: 'rsi_cross_up', len: rl, level: lv });
      else if (mA && mB && mA.kind === mB.kind) cands.push({ type: 'ma_cross_up', kind: mA.kind, fast: mA.len, slow: mB.len });
      else if (A === 'close' && mB) cands.push({ type: 'price_cross_ma_up', kind: mB.kind, len: mB.len });
      else if (/^__macd_line\(/.test(A) && /^__macd_signal\(/.test(B)) { const p = A.match(/\(([\d.]+),([\d.]+),([\d.]+)\)/); cands.push({ type: 'macd_cross_up', fast: +p[1], slow: +p[2], signal: +p[3] }); }
      else if (A === 'close' && /^ta\.highest\(high,(\d+)\)\[1\]$/.test(B)) cands.push({ type: 'breakout', len: +B.match(/\d+/)[0] });
      else if (mA && mB) notes.push('Médias de tipos diferentes (' + mA.kind.toUpperCase() + ' × ' + mB.kind.toUpperCase() + ') ainda não são lidas nesta versão.');
    }
    // 2) comparações diretas
    let m;
    const reRsiX = /ta\.rsi\(close,(\d+)\)\[1\]<=?([\d.]+) ?and ?\(?ta\.rsi\(close,\1\)>=?\2/;
    if ((m = flat.match(reRsiX))) cands.push({ type: 'rsi_cross_up', len: +m[1], level: +m[2] });
    const reMacdX = /__macd_line\(([\d.]+),([\d.]+),([\d.]+)\)\[1\]<=?__macd_signal\(\1,\2,\3\)\[1\] ?and ?\(?__macd_line\(\1,\2,\3\)>__macd_signal\(\1,\2,\3\)/;
    if ((m = flat.match(reMacdX))) cands.push({ type: 'macd_cross_up', fast: +m[1], slow: +m[2], signal: +m[3] });
    const reMaX = /ta\.(sma|ema)\(close,(\d+)\)\[1\]<=?ta\.\1\(close,(\d+)\)\[1\] ?and ?\(?ta\.\1\(close,\2\)>ta\.\1\(close,\3\)/;
    if ((m = flat.match(reMaX))) cands.push({ type: 'ma_cross_up', kind: m[1], fast: +m[2], slow: +m[3] });
    if ((m = flat.match(/close<__bb_lower\(([\d.]+),([\d.]+)\)/))) cands.push({ type: 'bb_lower', len: +m[1], mult: +m[2] });
    if ((m = flat.match(/close>ta\.highest\(high,(\d+)\)\[1\]/))) cands.push({ type: 'breakout', len: +m[1] });
    if (!cands.length && (m = flat.match(/ta\.rsi\(close,(\d+)\)<=?([\d.]+)/))) cands.push({ type: 'rsi_below', len: +m[1], level: +m[2] });
    if (!cands.length) {
      return { ok: false, short: shortHint, notes: Array.from(new Set(notes)), msg: shortHint ? 'O script descreve um gatilho de venda (short). Nesta versão o Argos avalia apenas compras teóricas (long); gatilhos de venda entram na V2.' : 'Não encontrei uma regra de entrada que o Argos saiba ler. Esta versão lê: RSI cruzando um nível, MACD cruzando o sinal, cruzamento de médias do mesmo tipo (SMA/EMA), fechamento cruzando uma média, fechamento abaixo da Bollinger inferior e rompimento da máxima de N candles.' };
    }
    const uniq = []; cands.forEach((c) => { if (!uniq.some((u) => JSON.stringify(u) === JSON.stringify(c))) uniq.push(c); });
    const spec = uniq[0];
    const bad = Object.keys(spec).some((x) => x !== 'type' && x !== 'kind' && !(isFinite(spec[x]) && spec[x] > 0 && spec[x] <= 400));
    if (bad) return { ok: false, msg: 'Parâmetros fora do intervalo aceito (1 a 400).', notes };
    if (uniq.length > 1) notes.push('O script tem mais de uma regra de entrada; o Argos testou a primeira. Teste as outras separadamente — cada uma entra na conta da sessão.');
    if (shortHint) notes.push('Há também condições de venda no script; elas foram ignoradas (a avaliação é long).');
    return { ok: true, spec, name: E.SPEC_TYPES[spec.type].nome(spec), notes: Array.from(new Set(notes)) };
  }
  const SPEC_LABEL = { rsi_cross_up: 'RSI cruza nível para cima', rsi_below: 'RSI entra abaixo de nível', macd_cross_up: 'MACD cruza o sinal para cima', ma_cross_up: 'Cruzamento de médias', price_cross_ma_up: 'Fechamento cruza a média para cima', bb_lower: 'Fechamento abaixo da Bollinger inferior', breakout: 'Rompimento de máxima' };
  function paramRows(spec) {
    const P = { len: 'Período', level: 'Nível', fast: 'Rápida / linha', slow: 'Lenta', signal: 'Sinal', kind: 'Tipo de média', mult: 'Desvios' };
    return Object.keys(spec).filter((k) => k !== 'type').map((k) => '<div class="ext-row"><span>' + P[k] + '</span><span class="val">' + esc(k === 'kind' ? spec[k].toUpperCase() : fmtN(spec[k], spec[k] % 1 ? 1 : 0)) + '</span></div>').join('');
  }

  // ================================================================ Sandbox
  const SB = { parsed: null, tests: [], saved: [] };
  function sbCfg() { return { mode: $('sbMode').value === 'pct' ? 'pct' : 'atr', tgt: num('sbTgt', 2, 0.2, 20), stp: num('sbStp', 1, 0.2, 20), hold: Math.round(num('sbHold', 12, 2, 60)) }; }
  function sbRR() { const c = sbCfg(); $('sbRR').textContent = 'Alvo : stop = ' + fmtN(c.tgt / c.stp, 1) + ' : 1 · ' + U.cfgText(c); }
  function sbParse() {
    const r = parsePine($('sbCode').value); SB.parsed = r.ok ? r : null;
    const el = $('sbParsed'); el.hidden = false;
    if (!r.ok) { el.className = 'sb-parsed err'; el.innerHTML = '<div class="pr-h">✗ ' + esc(r.msg) + '</div>' + (r.notes || []).map((x) => '<p>' + esc(x) + '</p>').join(''); $('sbRun').disabled = true; return; }
    el.className = 'sb-parsed ok';
    el.innerHTML = '<div class="pr-h">✓ Regra lida: <strong>' + esc(r.name) + '</strong></div><div class="pr-grid"><div class="ext-row"><span>Tipo</span><span class="val">' + esc(SPEC_LABEL[r.spec.type]) + '</span></div>' + paramRows(r.spec) + '<div class="ext-row"><span>Direção</span><span class="val">compra teórica (long)</span></div></div>' + r.notes.map((x) => '<p class="pr-note">' + esc(x) + '</p>').join('');
    $('sbRun').disabled = false;
  }
  async function sbRun() {
    if (!SB.parsed) return;
    const sym = pressed('sbAsset'), tf = pressed('sbTf'), cfg = sbCfg(), spec = SB.parsed.spec, name = SB.parsed.name;
    $('sbRun').disabled = true; $('sbRun').textContent = 'Testando…';
    const en = U.entry(sym, tf);
    const res = await later(() => E.analyzeSpec(en.d, cfg, spec, { sym, tf }));
    $('sbRun').disabled = false; $('sbRun').textContent = 'Executar teste';
    const s = res.setup;
    SB.tests.push({ k: SB.tests.length + 1, name, spec, sym, tf, cfg, s, calib: res.calib, d: res.d, reg: res.tech.regime.regime, ms: res.ms });
    const fam = E.applyFamily(SB.tests.map((t) => ({ pTwo: t.s.pTwo, nEff: t.s.nEff, winRate: t.s.winRate, base: t.s.base, wf: t.s.wf })));
    SB.tests.forEach((t, i) => { t.s.q = fam[i].q; t.s.family = fam.length; t.s.verdict = fam[i].verdict; });
    sbRender(SB.tests[SB.tests.length - 1]); sbLog();
    $('sbResults').hidden = false;
    $('sbResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function sbRender(t) {
    const s = t.s, famN = SB.tests.length;
    $('sbOut').innerHTML =
      '<p class="pv-context"><strong>' + esc(t.name) + '</strong> · ' + PAIR(t.sym) + ' ' + TF_LABEL[t.tf] + ' · ' + esc(U.cfgText(t.cfg)) + ' · ' + fmtInt(t.d.n - 200) + ' candles avaliados (' + fmtDay(t.d.t[200]) + ' a ' + fmtDay(t.d.t[t.d.n - 1]) + ') · teste ' + t.k + ' da sessão · motor em ' + fmtN(t.ms, 0) + ' ms</p>' +
      statCards(s, t.calib, famN + ' ' + pl(famN, 'teste', 'testes') + ' na sessão') + riskAndRegime(s, t.reg) + wfCard(s, t.d) + warningsFor(s, famN, t.d, t.cfg) +
      '<div class="action-row">' + (FEATURES.query ? '<button type="button" class="btn" id="sbSave">Salvar para o Query</button>' : '') + '<button type="button" class="btn btn-ghost-blue" id="sbCopyPine">Copiar Pine com a evidência</button><span class="toast" id="sbToast" role="status"></span></div>';
    if ($('sbSave')) $('sbSave').onclick = () => { if (!SB.saved.find((x) => x.name === t.name)) { SB.saved.push({ name: t.name, spec: t.spec }); qFillSetups(); } $('sbToast').textContent = 'Disponível no Query como setup próprio.'; };
    $('sbCopyPine').onclick = () => {
      const head = '// Argos Sentinel · evidência (' + new Date().toLocaleDateString('pt-BR') + '): ' + PAIR(t.sym) + ' ' + TF_LABEL[t.tf] + ' · ' + U.cfgText(t.cfg) + '\n// N=' + s.n + ' (ef. ' + s.nEff + ') · acerto ' + fmtPct(s.winRate, 1) + ' · base ' + fmtPct(s.base, 1) + ' · p=' + fmtP(s.pTwo) + ' (ajust. ' + fmtP(s.q) + ') → ' + s.verdict.label + '\n// Pesquisa estatística histórica. Não é recomendação.\n';
      U.copyText(head + $('sbCode').value, $('sbToast'), 'Código copiado com o cabeçalho de evidência.');
    };
  }
  function sbLog() {
    const rows = SB.tests.slice().reverse().map((t) => '<div class="saved-item"><div class="saved-item-main"><span class="saved-item-name">' + t.k + '. ' + esc(t.name) + '</span><span class="saved-item-meta">' + PAIR(t.sym) + ' ' + TF_LABEL[t.tf] + ' · ' + esc(U.cfgText(t.cfg)) + ' · N ' + t.s.n + ' · acerto ' + fmtPct(t.s.winRate, 1) + ' vs base ' + fmtPct(t.s.base, 1) + ' · p ' + fmtP(t.s.pTwo) + ' → ajustado ' + fmtP(t.s.q) + '</span></div><span class="verdict ' + (TONE[t.s.verdict.key] || 'muted') + '">' + esc(t.s.verdict.label) + '</span></div>');
    $('sbLog').innerHTML = '<div class="saved-list">' + rows.join('') + '</div>';
  }
  function sbInit() {
    if (!$('sbCode')) return;
    $('sbCode').value = TPL.rsi;
    document.querySelectorAll('.sb-templates button').forEach((b) => b.addEventListener('click', () => { $('sbCode').value = TPL[b.getAttribute('data-tpl')]; sbParse(); }));
    $('sbParse').addEventListener('click', sbParse);
    $('sbRun').addEventListener('click', sbRun);
    $('sbCode').addEventListener('input', () => { SB.parsed = null; $('sbRun').disabled = true; });
    bindSeg('sbAsset'); bindSeg('sbTf');
    ['sbMode', 'sbTgt', 'sbStp', 'sbHold'].forEach((id) => $(id).addEventListener('input', sbRR));
    sbRR(); sbParse();
  }

  // ================================================================ Query
  function qFillSetups() {
    const sel = $('qSetup'); if (!sel) return; const cur = sel.value;
    sel.innerHTML = '<optgroup label="Banco de estratégias">' + E.SETUPS.map((s) => '<option value="' + s.id + '">' + esc(s.nome) + '</option>').join('') + '</optgroup>' +
      (SB.saved.length ? '<optgroup label="Setups próprios (Sandbox)">' + SB.saved.map((s, i) => '<option value="CUSTOM:' + i + '">' + esc(s.name) + '</option>').join('') + '</optgroup>' : '');
    if (cur && Array.from(sel.options).some((o) => o.value === cur)) sel.value = cur;
  }
  function qCfg() { return { mode: $('qMode').value === 'pct' ? 'pct' : 'atr', tgt: num('qTgt', 2, 0.2, 20), stp: num('qStp', 1, 0.2, 20), hold: Math.round(num('qHold', 12, 2, 60)) }; }
  function r4(x) { return isFinite(x) ? +x.toFixed(4) : null; }
  async function qRun() {
    const id = $('qSetup').value, sym = $('qAsset').value, tf = $('qTf').value, cfg = qCfg(), win = $('qWin').value ? +$('qWin').value : null, wfOn = $('qWf').checked;
    $('qRun').disabled = true; $('qRun').textContent = 'CONSULTANDO…';
    const t0 = performance.now();
    let s, d, calib, tech, famN, custom = null;
    await later(() => {
      if (id.indexOf('CUSTOM:') === 0) {
        custom = SB.saved[+id.split(':')[1]];
        let dd = U.entry(sym, tf).d; if (win) dd = E.sliceSeries(dd, Math.round((win * 86400) / dd.dt) + 200);
        const res = E.analyzeSpec(dd, cfg, custom.spec, { sym, tf });
        s = res.setup; s.q = s.pTwo; s.family = 1; d = res.d; calib = res.calib; tech = res.tech; famN = 1;
      } else {
        const A = U.analysisFor(sym, tf, cfg, win);
        s = A.setups.find((x) => x.id === id); d = A.d; tech = A.tech; famN = A.setups.length;
        const preds = A.preds.filter((p) => p.sid === id); calib = E.calibSummary(preds, d.t);
      }
    });
    const ms = performance.now() - t0;
    $('qRun').disabled = false; $('qRun').textContent = 'CONSULTAR';
    const reg = tech.regime, R = E.REGIMES[reg.regime];
    const qId = qid();
    const json = {
      query_id: qId, engine: E.VERSION, generated_at: new Date().toISOString(),
      request: { setup: custom ? { custom: custom.spec } : id, symbol: sym, interval: tf, exit: { unit: cfg.mode, target: cfg.tgt, stop: cfg.stp, horizon_candles: cfg.hold }, window_days: win, walk_forward: wfOn },
      data: { source: 'binance_spot', first_evaluated: new Date(d.t[200] * 1000).toISOString().slice(0, 10), last_closed: new Date(d.t[d.n - 1] * 1000).toISOString(), candles: d.n },
      result: {
        n: s.n, n_effective: s.nEff, wins: s.wins, win_rate: r4(s.winRate), ci95: [r4(s.ci[0]), r4(s.ci[1])], ci_method: s.method, base_rate: r4(s.base), diff_pp: +s.alphaPP.toFixed(2),
        p_raw_two_sided: r4(s.pTwo), p_adjusted_bh: r4(s.q), family_size: famN, verdict: s.verdict.key, verdict_label: s.verdict.label,
        risk: { cvar5: r4(s.cvar), worst: r4(s.worst), mae_median: r4(s.maeMedian), mean_after_cost: r4(s.meanNet), timeouts: s.timeouts },
        by_regime: Object.fromEntries(Object.entries(s.byRegime).filter(([k]) => k !== 'UNKNOWN').map(([k, v]) => [k, { n: v.n, win_rate: r4(v.w / v.n) }])),
        calibration: calib.n >= 30 ? { predictions: calib.n, brier: r4(calib.brier), brier_reference: r4(calib.brierRef), bss: r4(calib.bss), ece: r4(calib.ece) } : null
      },
      regime_now: { code: reg.regime, confidence: r4(reg.confidence) },
      notice: 'Pesquisa estatística histórica. Não é recomendação de compra ou venda.'
    };
    if (wfOn) json.result.walk_forward = s.wf.available ? { consistent: s.wf.consistent, brier: r4(s.wf.brier), brier_reference: r4(s.wf.brierRef), windows: s.wf.walks.map((w) => ({ test_from: new Date(d.t[w.from] * 1000).toISOString().slice(0, 10), test_to: new Date(d.t[w.to] * 1000).toISOString().slice(0, 10), train_n: w.trainN, train_wr: r4(w.trainWR), test_n: w.testN, test_wr: r4(w.testWR) })) } : { available: false, reason: s.wf.reason };
    const jtxt = JSON.stringify(json, null, 2);
    $('qEmpty').hidden = true; $('qOut').hidden = false;
    $('qOut').innerHTML =
      '<div class="regime-badge-row"><span class="lbl">Regime atual:</span><span class="regime-chip ' + REG_CLS[reg.regime] + '">' + esc(R.label) + '</span><span class="lbl">' + esc(PAIR(sym) + ' ' + TF_LABEL[tf] + ' · ' + (custom ? custom.name : s.nome)) + '</span></div>' +
      statCards(s, calib, custom ? 'teste único' : famN + ' setups do banco') +
      (wfOn ? wfCard(s, d) : '') + warningsFor(s, famN, d, cfg) +
      '<div class="card json-card"><div class="json-h"><span>Resposta · application/json</span><button type="button" class="btn btn-sm" id="qCopy">Copiar JSON</button></div><pre class="json" id="qJson"></pre></div>' +
      '<div class="meta-row"><span>Query ID: ' + qId + '</span><span>' + fmtN(ms, 0) + ' ms · ' + E.VERSION + '</span></div>' +
      '<p class="pv-note">Formato de resposta da API prevista para a V2. Nesta demonstração, o cálculo roda no próprio navegador.</p>';
    $('qJson').textContent = jtxt;
    $('qCopy').onclick = () => U.copyText(jtxt, null, '').then((ok) => { $('qCopy').textContent = ok ? 'Copiado' : 'Não copiou'; setTimeout(() => ($('qCopy').textContent = 'Copiar JSON'), 1600); });
  }
  function qRR() { const c = qCfg(); $('qRR').textContent = fmtN(c.tgt / c.stp, 1) + ' : 1'; }
  function qInit() {
    if (!$('qSetup')) return;
    qFillSetups(); $('qSetup').value = 'RSI_OVERSOLD';
    $('qRun').addEventListener('click', qRun);
    ['qTgt', 'qStp', 'qMode'].forEach((id) => $(id).addEventListener('input', qRR)); qRR();
  }

  // ================================================================ Calibração
  const C = { sym: 'BTCUSDT', tf: '4h', chart: null, s1: null, s2: null, shown: false };
  function tag(k, t) { return '<span class="brier-tag ' + k + '">' + esc(t) + '</span>'; }
  function relSVG(bins, w, h) {
    const W = w || 360, H = h || 300, P = { l: 44, r: 14, t: 14, b: 38 }, mx = 0.6;
    const X = (v) => P.l + (Math.min(v, mx) / mx) * (W - P.l - P.r), Y = (v) => H - P.b - (Math.min(v, mx) / mx) * (H - P.t - P.b);
    const ticks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    let g = ticks.map((t) => '<line x1="' + X(0) + '" x2="' + X(mx) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" class="gl"/><text x="' + (P.l - 8) + '" y="' + (Y(t) + 3.5) + '" class="ax" text-anchor="end">' + Math.round(t * 100) + '%</text><text x="' + X(t) + '" y="' + (H - P.b + 16) + '" class="ax" text-anchor="middle">' + Math.round(t * 100) + '%</text>').join('');
    g += '<line x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(mx) + '" y2="' + Y(mx) + '" class="diag"/>';
    g += '<text x="' + (X(0.44)) + '" y="' + (Y(0.47)) + '" class="ax-note" transform="rotate(-' + (Math.atan((H - P.t - P.b) / (W - P.l - P.r)) * 180 / Math.PI).toFixed(1) + ' ' + X(0.44) + ' ' + Y(0.47) + ')">calibração perfeita</text>';
    const pts = bins.filter((b) => b.n >= 20);
    if (pts.length > 1) g += '<polyline class="rel-line" points="' + pts.map((b) => X(b.pred) + ',' + Y(b.obs)).join(' ') + '"/>';
    const nMax = Math.max(1, ...pts.map((b) => b.n));
    g += pts.map((b) => { const r = 4 + 6 * Math.sqrt(b.n / nMax); const tip = 'Faixa ' + Math.round(b.lo * 100) + '–' + Math.round(Math.min(1, b.hi) * 100) + '% · ' + fmtInt(b.n) + ' previsões · previsto ' + fmtPct(b.pred, 1) + ' · observado ' + fmtPct(b.obs, 1); return '<g class="rel-pt" tabindex="0" data-tip="' + esc(tip) + '"><circle cx="' + X(b.pred) + '" cy="' + Y(b.obs) + '" r="14" class="hit"/><circle cx="' + X(b.pred) + '" cy="' + Y(b.obs) + '" r="' + r.toFixed(1) + '" class="dot"/></g>'; }).join('');
    g += '<text x="' + ((X(0) + X(mx)) / 2) + '" y="' + (H - 4) + '" class="ax-t" text-anchor="middle">probabilidade prevista</text><text x="12" y="' + ((Y(0) + Y(mx)) / 2) + '" class="ax-t" text-anchor="middle" transform="rotate(-90 12 ' + ((Y(0) + Y(mx)) / 2) + ')">frequência observada</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="rel-svg" role="img" aria-label="Diagrama de calibração: probabilidade prevista contra frequência observada">' + g + '</svg>';
  }
  function cRender() {
    if (!$('cStats')) return;
    const A = U.analysisFor(C.sym, C.tf, DEF, null), c = A.calib, d = A.d;
    const en = U.entry(C.sym, C.tf);
    $('cSrc').textContent = PAIR(C.sym) + ' ' + TF_LABEL[C.tf] + ' · ' + fmtInt(d.n) + ' candles (' + fmtDay(d.t[0]) + ' → ' + fmtDay(d.t[d.n - 1]) + ') · Binance Spot' + (en.source === 'live' ? ' ao vivo' : '') + ' · regra padrão ' + U.cfgText(DEF);
    if (!(c.n >= 30)) { $('cStats').innerHTML = '<div class="card status-card"><div class="l">Previsões</div><div class="v">' + c.n + '</div><div class="pv-note">Menos de 30 previsões fora da amostra: calibração não medida.</div></div>'; return; }
    const last = c.rolling.length ? c.rolling[c.rolling.length - 1] : null;
    const bssK = c.bss > 0.01 ? 'good' : c.bss >= -0.01 ? 'ok' : 'bad', eceK = c.ece < 0.03 ? 'good' : c.ece < 0.06 ? 'ok' : 'bad';
    $('cStats').innerHTML =
      '<div class="card status-card"><div class="l">Brier · últimos 90 dias</div><div class="v">' + (last ? fmtN(last.brier, 3) : '—') + '</div><div class="s">referência ' + (last ? fmtN(last.ref, 3) : '—') + ' · histórico ' + fmtN(c.brier, 3) + '</div></div>' +
      '<div class="card status-card"><div class="l">Ganho sobre a referência</div><div class="v">' + fmtSPct(c.bss, 1) + '</div>' + tag(bssK, c.status.skill) + '</div>' +
      '<div class="card status-card"><div class="l">Erro de calibração (ECE)</div><div class="v">' + fmtN(c.ece * 100, 1) + ' p.p.</div>' + tag(eceK, c.status.cal) + '</div>' +
      '<div class="card status-card"><div class="l">Previsões avaliadas</div><div class="v">' + fmtInt(c.n) + '</div><div class="s">' + fmtDay(d.t[A.preds[0].t]) + ' → ' + fmtDay(d.t[A.preds[A.preds.length - 1].t]) + '</div></div>';
    // gráfico (TradingView Lightweight Charts)
    const LWC = window.LightweightCharts;
    if (LWC && !C.chart) {
      C.chart = LWC.createChart($('cChart'), { autoSize: true, layout: { background: { type: 'solid', color: '#101927' }, textColor: '#8D97A6', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, attributionLogo: true }, grid: { vertLines: { color: 'rgba(42,58,78,0.28)' }, horzLines: { color: 'rgba(42,58,78,0.28)' } }, rightPriceScale: { borderColor: '#1F2B3B' }, timeScale: { borderColor: '#1F2B3B' }, crosshair: { mode: LWC.CrosshairMode.Magnet }, handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }, handleScale: { mouseWheel: false, pinch: true }, localization: { locale: 'pt-BR', priceFormatter: (p) => fmtN(p, 3) } });
      C.s2 = C.chart.addSeries(LWC.LineSeries, { color: '#8D97A6', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4 });
      C.s1 = C.chart.addSeries(LWC.LineSeries, { color: '#D4B15C', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4 });
    }
    if (C.chart) {
      C.s1.setData(c.rolling.map((r) => ({ time: r.time, value: r.brier })));
      C.s2.setData(c.rolling.map((r) => ({ time: r.time, value: r.ref })));
      C.chart.timeScale().fitContent();
    }
    const above = c.rolling.filter((r) => r.brier < r.ref).length;
    $('cChartNote').textContent = c.rolling.length ? 'Linha mais baixa = previsão melhor. Em ' + above + ' de ' + c.rolling.length + ' semanas o motor ficou abaixo da referência na janela de 90 dias.' + (C.tf === '1h' ? ' No 1h a plataforma carrega cerca de 7 meses; a série é curta.' : '') : 'Histórico curto demais para a janela móvel de 90 dias.';
    $('cRel').innerHTML = relSVG(c.bins) + '<p class="pv-note">Pontos sobre a diagonal: a frequência observada bateu com a prevista. Tamanho do ponto = número de previsões na faixa.</p>';
    // por setup
    const by = {}; A.preds.forEach((p) => { const b = by[p.sid] || (by[p.sid] = { n: 0, b: 0, r: 0 }); b.n++; b.b += (p.p - p.o) ** 2; b.r += (p.r - p.o) ** 2; });
    const rows = E.SETUPS.map((s) => { const b = by[s.id]; if (!b) return '<tr><td>' + esc(s.nome) + '</td><td>0</td><td>—</td><td>—</td><td>—</td></tr>'; const bss = 1 - b.b / b.r; return '<tr><td>' + esc(s.nome) + '</td><td>' + fmtInt(b.n) + '</td><td>' + fmtN(b.b / b.n, 3) + '</td><td>' + fmtN(b.r / b.n, 3) + '</td><td class="' + (bss > 0.01 ? 'wf-pos' : bss < -0.01 ? 'wf-neg' : '') + '">' + fmtSPct(bss, 1) + '</td></tr>'; }).join('');
    $('cSetups').innerHTML = '<table class="wf-table"><thead><tr><th>Setup</th><th>Previsões</th><th>Brier</th><th>Referência</th><th>Ganho</th></tr></thead><tbody>' + rows + '</tbody></table>';
    // histórico semanal
    const hist = c.rolling.slice(-10).reverse().map((r) => { const g = 1 - r.brier / r.ref, k = g > 0.01 ? 'good' : g >= -0.01 ? 'ok' : 'bad'; return '<tr><td>' + fmtDay(r.time) + '</td><td>' + fmtN(r.brier, 4) + '</td><td>' + fmtN(r.ref, 4) + '</td><td>' + fmtN(r.cum, 4) + '</td><td>' + fmtInt(r.n) + '</td><td>' + tag(k, g > 0.01 ? 'acima da referência' : g >= -0.01 ? 'empate' : 'abaixo da referência') + '</td></tr>'; }).join('');
    $('cHist').innerHTML = '<table class="hist-table"><thead><tr><th>Semana até</th><th>Brier 90d</th><th>Referência 90d</th><th>Brier histórico</th><th>Previsões 90d</th><th>Leitura</th></tr></thead><tbody>' + (hist || '<tr><td colspan="6">Sem semanas suficientes.</td></tr>') + '</tbody></table>';
  }
  function cInit() {
    if (!$('cAsset')) return;
    bindSeg('cAsset', (v) => { C.sym = v; cRender(); });
    bindSeg('cTf', (v) => { C.tf = v; cRender(); });
  }

  // ================================================================ Site: matriz e gráficos
  function mxDetail(btn) {
    const host = $('mxDetail'); if (!host || !btn) return;
    document.querySelectorAll('.mx-cell.sel').forEach((x) => x.classList.remove('sel')); btn.classList.add('sel');
    const g = (k) => btn.getAttribute('data-' + k);
    const tone = TONE[g('v')] || 'muted';
    host.innerHTML = '<div class="mxd-h"><span class="mxd-t">' + esc(g('pair')) + ' · ' + esc(g('name')) + '</span><span class="verdict ' + tone + '">' + esc(g('vl')) + '</span></div>' +
      '<div class="mxd-grid"><div><span>Gatilhos com desfecho</span><b>' + esc(g('n')) + '</b></div><div><span>Taxa de acerto</span><b>' + esc(g('wr')) + '</b></div><div><span>IC 95%</span><b>' + esc(g('ci')) + '</b></div><div><span>Entradas aleatórias</span><b>' + esc(g('base')) + '</b></div><div><span>p bruto</span><b>' + esc(g('p')) + '</b></div><div><span>p ajustado (72 testes)</span><b>' + esc(g('q')) + '</b></div></div>' +
      '<div class="mxd-f"><span>' + esc(g('win')) + '</span><a href="#ao-vivo" class="mxd-open">Reproduzir na plataforma →</a></div>';
    host.querySelector('.mxd-open').onclick = (e) => { e.preventDefault(); if (window.openCase) window.openCase(g('sym'), g('tf'), g('id')); };
  }
  function tipInit() {
    let tip = document.getElementById('vizTip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'vizTip'; tip.className = 'viz-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; document.body.appendChild(tip); }
    const show = (el, x, y) => { tip.textContent = el.getAttribute('data-tip'); tip.hidden = false; const r = tip.getBoundingClientRect(); tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 12)) + 'px'; tip.style.top = Math.max(8, y - r.height - 12) + 'px'; };
    document.addEventListener('pointermove', (e) => { if (e.target.closest && e.target.closest('.roll-svg')) return; const el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else if (!tip.hidden && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-tip]'))) tip.hidden = true; });
    document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); } });
    document.addEventListener('focusout', () => { tip.hidden = true; });
    // gráfico móvel (SVG do site): cursor vertical + leitura
    document.querySelectorAll('.roll-svg').forEach((svg) => {
      const data = JSON.parse(svg.getAttribute('data-pts') || '[]'); if (!data.length) return;
      const vb = svg.viewBox.baseVal, cross = svg.querySelector('.cross'), dot = svg.querySelector('.cross-dot');
      const move = (e) => {
        const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * vb.width;
        let best = data[0]; data.forEach((p) => { if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p; });
        cross.setAttribute('x1', best[0]); cross.setAttribute('x2', best[0]); cross.style.opacity = 1; dot.setAttribute('cx', best[0]); dot.setAttribute('cy', best[1]); dot.style.opacity = 1;
        tip.textContent = best[2]; tip.hidden = false; const tr = tip.getBoundingClientRect();
        tip.style.left = Math.max(8, Math.min(window.innerWidth - tr.width - 8, e.clientX + 12)) + 'px'; tip.style.top = Math.max(8, e.clientY - tr.height - 14) + 'px';
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerleave', () => { cross.style.opacity = 0; dot.style.opacity = 0; tip.hidden = true; });
    });
  }
  function siteInit() {
    const cells = document.querySelectorAll('.mx-cell');
    cells.forEach((c) => c.addEventListener('click', () => mxDetail(c)));
    const def = document.querySelector('.mx-cell[data-default="1"]') || cells[0];
    if (def) mxDetail(def);
  }

  // ================================================================ Telas em construção (FEATURES)
  // Fechada, a tela perde o protótipo (os campos nem existem: sbInit e qInit não montam nada) e passa a mostrar um aviso.
  // Quem leva à tela por fora dela (data-feature="sandbox" | "query" em outras telas) é escondido.
  const SOON = {
    sandbox: {
      title: 'Setup Sandbox',
      will: 'O Sandbox vai ler uma regra escrita em Pine Script e testá-la contra entradas aleatórias, com os dados reais da Binance e a mesma regra de saída do banco de estratégias. O p de cada teste será ajustado pelo número de variações testadas na sessão.',
      meanwhile: 'Enquanto isso, os 8 setups do banco de estratégias são testados na tela Ao vivo, com taxa de acerto, intervalo de confiança, taxa-base e p ajustado.'
    },
    query: {
      title: 'Query',
      will: 'O Query vai permitir consultar o motor diretamente: um setup, um ativo, uma regra de saída e uma janela, com a resposta no formato da API.',
      meanwhile: 'Enquanto isso, a análise de cada setup, com os mesmos números do motor, está na tela Ao vivo.'
    }
  };
  function closeScreen(key) {
    const c = SOON[key];
    const tab = document.querySelector('.dashboard-page nav.tabs a[data-screen="' + key + '"]');
    if (tab && !tab.querySelector('.soon')) tab.insertAdjacentHTML('beforeend', '<span class="soon">em construção</span>');
    const wrap = document.querySelector('#dash-' + key + ' .wrap');
    if (wrap) {
      wrap.innerHTML = '<div class="page-header"><h1>' + esc(c.title) + '<span class="soon">em construção</span></h1><p>Esta função ainda não está disponível nesta versão.</p></div>' +
        '<div class="card config-card"><div class="section-label">O que a função fará</div><p class="pv-context">' + esc(c.will) + '</p><p class="pv-note">Ainda não está disponível. ' + esc(c.meanwhile) + '</p>' +
        '<div class="run-row"><span></span><button type="button" class="btn btn-primary" data-go="live">Ir para Ao vivo</button></div></div><div class="bottom-pad"></div>';
      wrap.querySelector('[data-go]').addEventListener('click', () => { if (window.switchDashTab) window.switchDashTab('live'); });
    }
    document.querySelectorAll('[data-feature="' + key + '"]').forEach((el) => { el.hidden = true; });
  }
  function applyFeatures() { Object.keys(SOON).forEach((k) => { if (!FEATURES[k]) closeScreen(k); }); }

  // ================================================================ navegação
  const shown = {};
  function onTab(screen) {
    if (screen === 'calibration') { if (!shown.cal) { shown.cal = true; } later(cRender); }
  }
  window.ArgosPlatform = { onTab, parsePine, cRender };
  function boot() { applyFeatures(); sbInit(); qInit(); cInit(); siteInit(); tipInit(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

