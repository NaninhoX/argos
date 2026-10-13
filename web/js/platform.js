/* =====================================================================
   ARGOS · Plataforma v1.1 — Sandbox (Pine → teste), Query (formato API),
   Calibração (prequencial) e interações do site (matriz do estudo, gráficos).
   O motor é o mesmo da análise ao vivo. O Sandbox lê o script com o leitor de
   lib/pine-reader.js (gerado em js/pine-reader.js) e o Query consulta
   GET /api/analyze, comparando o resultado do servidor com o do navegador
   (resumo gerado em js/analysis-summary.js a partir do mesmo código do servidor).
   ===================================================================== */
(function () {
  'use strict';
  // Telas em construção. false: a entrada continua no menu com a etiqueta "em construção" e a tela mostra só um aviso
  // (o conteúdo interativo não é montado). true: a tela volta a funcionar. Para fechar de novo, troque true por false.
  const FEATURES = { sandbox: true, query: true };
  const L = window.ArgosLive; if (!L || !L.util) return;
  const U = L.util, E = U.E, $ = (id) => document.getElementById(id);
  const { fmtN, fmtPct, fmtSPct, fmtP, fmtInt, fmtDay, esc, PAIR, TF_LABEL, pl } = U;
  const PR = window.ArgosPineReader, SUM = window.ArgosSummary;
  const IN_CLAUDE = !!U.IN_CLAUDE;
  const DEF = { mode: 'atr', tgt: 2, stp: 1, hold: 12 };
  const ASSETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'], TFS = ['1h', '4h', '1d'], TF_SEC = { '1h': 3600, '4h': 14400, '1d': 86400 };
  const TONE = { EDGE: 'good', EDGE_SENSIVEL: 'warn', ABAIXO: 'bad', SEM_EDGE: 'muted', INSUFICIENTE: 'neutral' };
  const REG_CLS = { BULL_TREND: 'bull', BEAR_TREND: 'bear', HIGH_VOL_RANGING: 'hv', LOW_VOL_RANGING: 'lv', STRUCTURAL_BREAK: 'break', UNKNOWN: 'lv' };
  // Cede o quadro ao navegador antes de um cálculo pesado (o aviso de "carregando" aparece antes). O setTimeout cobre aba em segundo plano,
  // onde requestAnimationFrame fica parado.
  const later = (fn) => new Promise((res, rej) => {
    let done = false;
    const go = () => { if (done) return; done = true; setTimeout(() => { try { res(fn()); } catch (e) { rej(e); } }, 16); };
    requestAnimationFrame(go); setTimeout(go, 80);
  });
  const nz = (x) => (x === null || x === undefined ? NaN : x);
  const shortHash = (h) => (typeof h === 'string' && h.length > 20 ? h.slice(0, 12) + '…' + h.slice(-6) : String(h));
  const isoDayOf = (iso) => { const t = Date.parse(iso); return isFinite(t) ? fmtDay(t / 1000) : '—'; };
  function setPressed(groupId, v) { document.querySelectorAll('#' + groupId + ' button').forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-v') === v)); }
  function pressed(groupId) { const b = document.querySelector('#' + groupId + ' button[aria-pressed="true"]'); return b ? b.getAttribute('data-v') : null; }
  function bindSeg(groupId, cb) { document.querySelectorAll('#' + groupId + ' button').forEach((b) => b.addEventListener('click', () => { setPressed(groupId, b.getAttribute('data-v')); if (cb) cb(b.getAttribute('data-v')); })); }
  function num(id, def, lo, hi) { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; }
  const listHTML = (items, cls) => '<ul class="' + (cls || 'pr-list') + '">' + items.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>';
  const stateHTML = (kind, title, text) => '<div class="pv-state ' + kind + '" role="' + (kind === 'err' ? 'alert' : 'status') + '"><div class="pv-state-h">' + esc(title) + '</div>' + (text ? '<p>' + esc(text) + '</p>' : '') + '</div>';
  // Carregando: esqueleto com o formato do resultado (linha de contexto, quatro cartões, dois cartões, uma tabela). Os blocos são
  // aria-hidden; o texto de status segue para o leitor de tela, escondido só da vista (.pv-skel-sr). A pulsação fica em platform-motion.css.
  const SKEL = '<div class="pv-skel-body" aria-hidden="true"><i class="ctx"></i><div class="g"><i></i><i></i><i></i><i></i></div><div class="r"><i></i><i></i></div><i class="w"></i></div>';
  const loadingHTML = (text) => '<div class="pv-skel" role="status"><span class="pv-skel-sr">' + esc(text) + '</span>' + SKEL + '</div>';
  // Troca só a mensagem quando o esqueleto já está na tela (a segunda etapa não recria os blocos nem reinicia a pulsação).
  function setLoading(out, text) { const s = out.querySelector('.pv-skel-sr'); if (s) s.textContent = text; else out.innerHTML = loadingHTML(text); }

  // Armazenamento do navegador: pode não existir (janela privada, dados bloqueados). A tela funciona sem ele.
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { window.localStorage.removeItem(k); } catch (e) { /* sem armazenamento */ } }
  };

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
      '<div class="stat-card"><div class="label">Contra o acaso</div><div class="value">' + (s.alphaPP >= 0 ? '+' : '−') + fmtN(Math.abs(s.alphaPP), 1) + ' pp</div><div class="sub">p ' + fmtP(s.pTwo) + ' · ajustado ' + fmtP(isFinite(s.q) ? s.q : s.pTwo) + (famTxt ? ' (' + esc(famTxt) + ')' : '') + '</div></div>' +
      '<div class="stat-card"><div class="label">Calibração</div><div class="value">' + (c ? fmtSPct(c.bss, 1) : '—') + '</div><div class="sub">' + (c ? 'ganho sobre a taxa-base · ECE ' + fmtN(c.ece * 100, 1) + ' p.p. · ' + fmtInt(c.n) + ' previsões' : 'previsões fora da amostra insuficientes') + '</div></div>' +
      '</div>';
  }
  function riskAndRegime(s, regNow) {
    const regs = Object.keys(s.byRegime).filter((r) => r !== 'UNKNOWN' && E.REGIMES[r]).sort((a, b) => s.byRegime[b].n - s.byRegime[a].n);
    const rl = regs.length ? regs.map((r) => { const x = s.byRegime[r]; return '<div class="regime-list-row' + (r === regNow ? ' current' : '') + '">' + esc(E.REGIMES[r].label) + ' <span class="n">' + (r === regNow ? '← atual · ' : '') + fmtPct(x.w / x.n, 1) + ' (N=' + x.n + ')</span></div>'; }).join('') : '<div class="regime-list-row">Sem gatilhos com desfecho.</div>';
    return '<div class="detail-row">' +
      '<div class="detail-card card"><div class="section-label">Risco por gatilho</div><div class="detail-metrics">' +
      '<div class="m"><div class="l">CVaR 5%</div><div class="v neg">' + fmtSPct(s.cvar, 2) + '</div></div>' +
      '<div class="m"><div class="l">Pior</div><div class="v neg">' + fmtSPct(s.worst, 2) + '</div></div>' +
      '<div class="m"><div class="l">MAE mediana</div><div class="v">' + fmtSPct(s.maeMedian, 2) + '</div></div>' +
      '<div class="m"><div class="l">Médio após 0,1%</div><div class="v">' + fmtSPct(s.meanNet, 2) + '</div></div>' +
      '</div><p class="pv-note">Números do comportamento passado. Não são limite de perda nem indicam tamanho de posição.</p></div>' +
      '<div class="detail-card card"><div class="section-label">Taxa de acerto por regime no gatilho</div><div class="regime-list">' + rl + '</div></div></div>';
  }
  // d: série do motor (índices em from/to) ou, no Query, o resumo do servidor (fromTime/toTime em ISO)
  function wfCard(s, d) {
    if (!s.wf || !s.wf.available) return '<div class="card wf-card"><div class="wf-head"><span class="title">Walk-forward (5 janelas, com expurgo)</span></div><p class="pv-note">' + esc((s.wf && s.wf.reason) || 'Indisponível.') + '</p></div>';
    const day = (w, which) => (w[which + 'Time'] ? isoDayOf(w[which + 'Time']) : fmtDay(d.t[w[which]]));
    const rows = s.wf.walks.map((w, k) => '<tr><td>' + (k + 2) + ' · ' + day(w, 'from') + ' → ' + day(w, 'to') + '</td><td>' + w.trainN + '</td><td>' + fmtPct(w.trainWR, 1) + '</td><td>' + w.testN + '</td><td class="' + (w.testWR >= w.trainWR ? 'wf-pos' : 'wf-neg') + '">' + fmtPct(w.testWR, 1) + '</td><td>' + (w.dropPP >= 0 ? '−' : '+') + fmtN(Math.abs(w.dropPP), 1) + ' pp</td><td class="' + (w.overfit ? 'wf-cross' : 'wf-check') + '">' + (w.overfit ? '✗' : '✓') + '</td></tr>').join('');
    return '<div class="card wf-card"><div class="wf-head"><span class="title">Walk-forward (5 janelas, com expurgo)</span><span class="wf-badge ' + (s.wf.consistent ? 'ok' : 'warn') + '">' + (s.wf.consistent ? '✓ nenhuma janela caiu mais de 15 pp' : '⚠ sensível a subperíodos') + '</span></div>' +
      '<div class="table-scroll"><table class="wf-table"><thead><tr><th>Janela de teste</th><th>Treino N</th><th>Treino</th><th>Teste N</th><th>Teste</th><th>Queda</th><th>Estável</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="wf-summary">Brier fora da amostra ' + fmtN(s.wf.brier, 3) + ' contra ' + fmtN(s.wf.brierRef, 3) + ' da taxa-base conhecida na época (ganho ' + fmtSPct(s.wf.bss, 1) + '), em ' + s.wf.nPred + ' previsões.</div></div>';
  }
  function warningsFor(s, famN, d, cfg) {
    const w = [];
    if (s.nEff < 10) w.push('Evidência insuficiente: N efetivo ' + s.nEff + ', abaixo do mínimo de 10 para qualquer conclusão.');
    else if (s.nEff < 25) w.push('Amostra pequena (N efetivo ' + s.nEff + '): o intervalo usa o método bayesiano e é largo.');
    if (s.pTwo < 0.05 && !(s.q < 0.05)) w.push('O p bruto (' + fmtP(s.pTwo) + ') ficou abaixo de 0,05, mas não resiste ao ajuste para ' + famN + ' ' + pl(famN, 'teste', 'testes') + ' (' + fmtP(s.q) + '). O resultado é compatível com o acaso.');
    if (s.wf && s.wf.available && !s.wf.consistent) w.push('Ao menos uma janela do walk-forward caiu mais de 15 pp em relação ao treino: o resultado depende do subperíodo.');
    if (s.rho > 0.2) w.push('Autocorrelação entre gatilhos (ρ ' + fmtN(s.rho, 2) + '): a amostra vale menos do que o N bruto sugere.');
    if (s.timeouts > s.n * 0.4) w.push(Math.round((s.timeouts / Math.max(1, s.n)) * 100) + '% dos gatilhos terminaram por prazo, sem tocar alvo nem stop: o horizonte de ' + cfg.hold + ' candles pode ser curto para esta regra.');
    if (d && d.dt === 3600) w.push('Tempo gráfico de 1h: a plataforma carrega os últimos ' + fmtInt(d.n) + ' candles (desde ' + fmtDay(d.t[0]) + '); o estudo de referência usa o 1h desde janeiro de 2022.');
    return w.length ? '<div class="warnings">' + w.map((x) => '<div class="warning-item"><span class="mark">⚠</span> ' + esc(x) + '</div>').join('') + '</div>' : '';
  }

  // Valores do resumo do servidor (JSON) trazem null onde o motor tem NaN; as telas formatam NaN como "—".
  function reviveWf(wf) {
    if (!wf || !wf.available) return wf;
    return Object.assign({}, wf, { brier: nz(wf.brier), brierRef: nz(wf.brierRef), bss: nz(wf.bss), walks: wf.walks.map((w) => Object.assign({}, w, { trainWR: nz(w.trainWR), testWR: nz(w.testWR), dropPP: nz(w.dropPP) })) });
  }
  function reviveSetup(s) {
    return Object.assign({}, s, {
      winRate: nz(s.winRate), ci: [nz(s.ci && s.ci[0]), nz(s.ci && s.ci[1])], base: nz(s.base), alphaPP: nz(s.alphaPP), pTwo: nz(s.pTwo), q: nz(s.q), rho: nz(s.rho),
      cvar: nz(s.cvar), worst: nz(s.worst), maeMedian: nz(s.maeMedian), meanNet: nz(s.meanNet), wf: reviveWf(s.wf)
    });
  }
  const reviveCalib = (c) => Object.assign({}, c, { brier: nz(c.brier), brierRef: nz(c.brierRef), bss: nz(c.bss), ece: nz(c.ece) });

  // ================================================================ Registro da sessão (variações testadas)
  // Cada variação testada (regra, ativo, tempo gráfico e regra de saída) entra na conta do ajuste de p. O registro fica no
  // localStorage; sem armazenamento ele vale até fechar a aba. Repetir o mesmo teste não conta duas vezes.
  const REG_KEY = 'argos.sandbox.registro.v1', SAVED_KEY = 'argos.sandbox.salvos.v1', REG_MAX = 500;
  const specOk = (spec) => {
    if (!spec || typeof spec !== 'object' || !Object.prototype.hasOwnProperty.call(E.SPEC_TYPES, spec.type)) return false;
    return E.SPEC_TYPES[spec.type].need.every((k) => (k === 'kind' ? spec.kind === 'sma' || spec.kind === 'ema' : typeof spec[k] === 'number' && isFinite(spec[k]) && spec[k] > 0 && spec[k] <= 400));
  };
  const specKey = (spec, sym, tf, cfg) => JSON.stringify([Object.keys(spec).sort().map((k) => [k, spec[k]]), sym, tf, cfg.mode, cfg.tgt, cfg.stp, cfg.hold]);
  const cfgOk = (c) => c && (c.mode === 'atr' || c.mode === 'pct') && [c.tgt, c.stp].every((v) => typeof v === 'number' && v >= 0.2 && v <= 20) && Number.isInteger(c.hold) && c.hold >= 2 && c.hold <= 60;
  const Reg = {
    tests: [], persisted: true,
    load() {
      this.tests = [];
      const raw = store.get(REG_KEY); if (!raw) return;
      let arr; try { arr = JSON.parse(raw); } catch (e) { return; }
      if (!Array.isArray(arr)) return;
      arr.slice(0, REG_MAX).forEach((t) => {
        if (!t || !specOk(t.spec) || !ASSETS.includes(t.sym) || !TFS.includes(t.tf) || !cfgOk(t.cfg) || !(t.pTwo >= 0 && t.pTwo <= 1) || !Number.isInteger(t.n) || !Number.isInteger(t.nEff)) return;
        this.tests.push({
          key: specKey(t.spec, t.sym, t.tf, t.cfg), k: this.tests.length + 1, name: E.SPEC_TYPES[t.spec.type].nome(t.spec), spec: t.spec, sym: t.sym, tf: t.tf, cfg: { mode: t.cfg.mode, tgt: t.cfg.tgt, stp: t.cfg.stp, hold: t.cfg.hold },
          n: t.n, nEff: t.nEff, winRate: nz(t.winRate), base: nz(t.base), alphaPP: nz(t.alphaPP), pTwo: t.pTwo, wf: { available: !!(t.wf && t.wf.available), consistent: !(t.wf && t.wf.available) || !!t.wf.consistent }
        });
      });
      this.adjust();
    },
    save() {
      const out = this.tests.map((t) => ({ spec: t.spec, sym: t.sym, tf: t.tf, cfg: t.cfg, n: t.n, nEff: t.nEff, winRate: isFinite(t.winRate) ? t.winRate : null, base: isFinite(t.base) ? t.base : null, alphaPP: isFinite(t.alphaPP) ? t.alphaPP : null, pTwo: t.pTwo, wf: t.wf }));
      this.persisted = store.set(REG_KEY, JSON.stringify(out));
    },
    // Benjamini-Hochberg sobre todas as variações da sessão (mesma função do banco de setups)
    adjust() {
      const list = this.tests.map((t) => ({ pTwo: t.pTwo, nEff: t.nEff, winRate: t.winRate, base: t.base, wf: t.wf }));
      E.applyFamily(list);
      this.tests.forEach((t, i) => { t.q = list[i].q; t.family = list[i].family; t.verdict = list[i].verdict; });
    },
    // devolve a entrada do registro (nova ou atualizada) ou null se o registro está cheio
    record(spec, name, sym, tf, cfg, s) {
      const key = specKey(spec, sym, tf, cfg);
      const stats = { n: s.n, nEff: s.nEff, winRate: s.winRate, base: s.base, alphaPP: s.alphaPP, pTwo: s.pTwo, wf: { available: !!(s.wf && s.wf.available), consistent: !(s.wf && s.wf.available) || !!s.wf.consistent } };
      let t = this.tests.find((x) => x.key === key);
      if (t) Object.assign(t, stats);
      else {
        if (this.tests.length >= REG_MAX) return null;
        t = Object.assign({ key, k: this.tests.length + 1, name, spec: Object.assign({}, spec), sym, tf, cfg: { mode: cfg.mode, tgt: cfg.tgt, stp: cfg.stp, hold: cfg.hold } }, stats);
        this.tests.push(t);
      }
      this.adjust(); this.save();
      return t;
    },
    clear() { this.tests = []; store.del(REG_KEY); }
  };
  const Saved = {
    list: [],
    load() {
      this.list = [];
      const raw = store.get(SAVED_KEY); if (!raw) return;
      let arr; try { arr = JSON.parse(raw); } catch (e) { return; }
      if (Array.isArray(arr)) arr.slice(0, 50).forEach((x) => { if (x && specOk(x.spec)) this.list.push({ spec: x.spec, name: E.SPEC_TYPES[x.spec.type].nome(x.spec) }); });
    },
    save() { store.set(SAVED_KEY, JSON.stringify(this.list.map((x) => ({ spec: x.spec })))); },
    add(spec, name) {
      const k = JSON.stringify(Object.keys(spec).sort().map((x) => [x, spec[x]]));
      const i = this.list.findIndex((x) => JSON.stringify(Object.keys(x.spec).sort().map((y) => [y, x.spec[y]])) === k);
      if (i >= 0) return i;
      this.list.push({ spec: Object.assign({}, spec), name }); this.save();
      return this.list.length - 1;
    }
  };

  // ================================================================ Séries para os testes
  // Candles: o snapshot versionado sempre existe; o ao vivo (Binance) é tentado antes de rodar e, se falhar, o teste usa o snapshot e diz isso.
  const snapCache = {};
  function snapshotEntry(sym, tf) {
    const k = sym + '_' + tf;
    if (!snapCache[k]) snapCache[k] = { d: E.decodeSnapshot(window.ARGOS_SNAPSHOT.series[k]), source: 'snapshot' };
    return snapCache[k];
  }
  async function ensureSeries(sym, tf) {
    const en0 = U.entry(sym, tf);
    const fresh = en0.source === 'live' && en0.updatedAt && Date.now() - en0.updatedAt < 5 * 60 * 1000;
    if (!fresh && !IN_CLAUDE && typeof U.refreshLive === 'function') { try { await U.refreshLive(sym, tf); } catch (e) { /* refreshLive guarda o erro no próprio registro da série */ } }
    const en = U.entry(sym, tf);
    return { d: en.d, source: en.source, fallback: en.source === 'live' ? '' : IN_CLAUDE ? '' : (en.liveError ? 'a Binance não respondeu' : 'sem resposta da Binance') };
  }
  const seriesLine = (sym, tf, d, source) => PAIR(sym) + ' ' + TF_LABEL[tf] + ' · ' + fmtInt(d.n) + ' candles até ' + fmtDay(d.t[d.n - 1]) + ' · ' + (source === 'live' ? 'Binance Spot ao vivo' : 'snapshot versionado');

  // ================================================================ Sandbox
  const SB = { spec: null, name: '', read: null, last: null, running: false, timer: null, resetTimer: null, resetArmed: false };
  const sbCfgRead = () => ({ mode: $('sbMode').value === 'pct' ? 'pct' : 'atr', tgt: num('sbTgt', 2, 0.2, 20), stp: num('sbStp', 1, 0.2, 20), hold: Math.round(num('sbHold', 12, 2, 60)) });
  function sbRR() { const c = sbCfgRead(); $('sbRR').textContent = 'Alvo : stop = ' + fmtN(c.tgt / c.stp, 1) + ' : 1 · ' + U.cfgText(c); }
  function sbDataLine() {
    const el = $('sbData'); if (!el) return;
    const sym = pressed('sbAsset') || 'BTCUSDT', tf = pressed('sbTf') || '4h', en = U.entry(sym, tf);
    el.textContent = 'Candles: ' + seriesLine(sym, tf, en.d, en.source) + '. O ao vivo é carregado ao executar; sem resposta da Binance, o teste usa o snapshot.';
  }
  function sbCount() {
    const el = $('sbCount'), n = $('sbCode').value.length, max = PR ? PR.MAX_SCRIPT_CHARS : 20000;
    el.textContent = fmtInt(n) + ' / ' + fmtInt(max) + ' caracteres'; el.className = 'sb-count' + (n > max ? ' over' : '');
  }
  function sbReadPanel(r, empty) {
    if (r.ok) {
      return { cls: 'ok', html: '<div class="pr-h"><span aria-hidden="true">✓</span> Regra lida: <strong>' + esc(SB.name) + '</strong></div>' +
        '<div class="pr-sub">O que o Argos entendeu do script</div>' + listHTML(r.understood) +
        (r.ignored.length ? '<div class="pr-sub">O que foi ignorado, sem efeito na regra de entrada</div>' + listHTML(r.ignored, 'pr-list dim') : '') +
        '<p class="pr-note">A regra testada é a descrita acima. Se ela diferir do script, o resultado não vale para o script.</p>' };
    }
    const sup = r.supported && r.supported.length ? r.supported : (PR ? PR.SUPPORTED_PATTERNS : []);
    if (empty) return { cls: 'neutral', html: '<div class="pr-h">Sem script ainda</div><p>A galeria acima carrega um exemplo com um clique. Um script colado é lido antes de qualquer teste.</p><div class="pr-sub">O que o Argos lê hoje</div>' + listHTML(sup) };
    return { cls: 'err', html: '<div class="pr-h"><span aria-hidden="true">✗</span> O Argos não leu este script</div><p>' + esc(r.reason) + '</p>' +
      (r.unsupported && r.unsupported.length ? '<div class="pr-sub">Construções não cobertas</div>' + listHTML(r.unsupported) : '') +
      '<div class="pr-sub">O que o Argos lê hoje</div>' + listHTML(sup) +
      '<p class="pr-note">O Argos não aproxima a regra. Uma versão parecida seria outro teste e daria um resultado que não vale para o seu script.</p>' };
  }
  function sbRead() {
    clearTimeout(SB.timer);
    const code = $('sbCode').value;
    let r;
    if (!PR) r = { ok: false, reason: 'O leitor de Pine não foi carregado nesta página.', unsupported: [], supported: [] };
    else { try { r = PR.readPine(code); } catch (e) { r = { ok: false, reason: 'O leitor não conseguiu interpretar este texto.', unsupported: [], supported: PR.SUPPORTED_PATTERNS }; } }
    SB.read = r; SB.spec = r.ok ? r.spec : null; SB.name = r.ok ? E.SPEC_TYPES[r.spec.type].nome(r.spec) : '';
    const p = sbReadPanel(r, !/\S/.test(code)), el = $('sbParsed');
    el.hidden = false; el.className = 'sb-parsed ' + p.cls; el.innerHTML = p.html;
    $('sbRun').disabled = !r.ok || SB.running;
    sbCount();
  }
  function sbSchedule() { SB.spec = null; $('sbRun').disabled = true; sbCount(); clearTimeout(SB.timer); SB.timer = setTimeout(sbRead, 350); }

  async function sbRun() {
    if (!SB.spec || SB.running) return;
    const sym = pressed('sbAsset'), tf = pressed('sbTf'), cfg = sbCfgRead(), spec = SB.spec, name = SB.name, out = $('sbOut');
    SB.running = true; $('sbRun').disabled = true; $('sbRun').textContent = 'Testando…';
    $('sbResults').hidden = false; out.setAttribute('aria-busy', 'true'); out.innerHTML = loadingHTML('Carregando os candles de ' + PAIR(sym) + ' ' + TF_LABEL[tf] + '…');
    try {
      const ser = await ensureSeries(sym, tf);
      setLoading(out, 'Rodando o motor sobre ' + fmtInt(ser.d.n) + ' candles…');
      const res = await later(() => E.analyzeSpec(ser.d, cfg, spec, { sym, tf }));
      const s = res.setup;
      if (!s.n) {
        out.innerHTML = '<p class="pv-context"><strong>' + esc(name) + '</strong> · ' + esc(seriesLine(sym, tf, ser.d, ser.source)) + '</p>' +
          stateHTML('empty', 'Nenhum gatilho com desfecho nesta série', 'A regra não disparou depois do aquecimento de 200 candles, ou os disparos não têm a janela futura completa de ' + cfg.hold + ' candles. Sem gatilhos não há estatística, e este teste não entra na conta da sessão.');
        sbLog(); return;
      }
      const t = Reg.record(spec, name, sym, tf, cfg, s);
      if (!t) { out.innerHTML = stateHTML('err', 'Registro da sessão cheio', 'O registro chegou a ' + REG_MAX + ' variações. Zerar o registro libera novos testes.'); return; }
      s.q = t.q; s.family = t.family; s.verdict = t.verdict;
      SB.last = { t, s, spec, name, sym, tf, cfg, d: res.d, calib: res.calib, reg: res.tech.regime.regime, ms: res.ms, source: ser.source, fallback: ser.fallback, code: $('sbCode').value };
      sbRender(); sbLog(); sbDataLine();
      if (typeof out.scrollIntoView === 'function') out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      out.innerHTML = stateHTML('err', 'O motor não conseguiu rodar esta regra', 'Nenhum número foi calculado. ' + (e && e.message ? String(e.message).slice(0, 160) : ''));
    } finally {
      SB.running = false; out.setAttribute('aria-busy', 'false'); $('sbRun').textContent = 'Executar teste'; $('sbRun').disabled = !SB.spec;
    }
  }
  const adjustHTML = (s, fam) => '<p class="pv-note adj-note"><strong>Ajuste por variações testadas.</strong> ' + (fam === 1
    ? 'Esta é a primeira variação da sessão, então o p ajustado é igual ao bruto (' + fmtP(s.pTwo) + '). A cada novo teste, o ajuste passa a contar as variações já feitas.'
    : 'A sessão tem ' + fam + ' variações. O p bruto deste teste é ' + fmtP(s.pTwo) + ' e, ajustado para ' + fam + ' variações (Benjamini-Hochberg), é ' + fmtP(s.q) + '. O veredito usa o p ajustado.') + '</p>';
  function sbRender() {
    const x = SB.last; if (!x) return;
    const { s, t } = x, fam = Reg.tests.length;
    $('sbOut').innerHTML =
      '<p class="pv-context"><strong>' + esc(x.name) + '</strong> · ' + esc(PAIR(x.sym) + ' ' + TF_LABEL[x.tf]) + ' · ' + esc(U.cfgText(x.cfg)) + ' · ' + fmtInt(x.d.n - 200) + ' candles avaliados (' + fmtDay(x.d.t[200]) + ' a ' + fmtDay(x.d.t[x.d.n - 1]) + ') · ' + (x.source === 'live' ? 'Binance Spot ao vivo' : 'snapshot versionado') + ' · variação ' + t.k + ' da sessão · motor em ' + fmtN(x.ms, 0) + ' ms</p>' +
      (x.fallback ? '<div class="warnings"><div class="warning-item"><span class="mark">⚠</span> Candles ao vivo indisponíveis (' + esc(x.fallback) + '). O teste usou o snapshot versionado, até ' + fmtDay(x.d.t[x.d.n - 1]) + '.</div></div>' : '') +
      statCards(s, x.calib, fam + ' ' + pl(fam, 'variação', 'variações') + ' na sessão') + adjustHTML(s, fam) + riskAndRegime(s, x.reg) + wfCard(s, x.d) + warningsFor(s, fam, x.d, x.cfg) +
      '<div class="action-row">' + (FEATURES.query ? '<button type="button" class="btn" id="sbSave">Salvar para o Query</button>' : '') + '<button type="button" class="btn btn-ghost-blue" id="sbCopyPine">Copiar Pine com a evidência</button><span class="toast" id="sbToast" role="status"></span></div>';
    if ($('sbSave')) {
      $('sbSave').onclick = () => {
        const i = Saved.add(x.spec, x.name); qFillSetups(); $('qSetup').value = 'CUSTOM:' + i;
        $('sbToast').innerHTML = 'Disponível no Query como setup próprio. <a href="#query" id="sbGoQuery">Abrir o Query</a>';
        $('sbGoQuery').onclick = (e) => { e.preventDefault(); if (window.switchDashTab) window.switchDashTab('query'); };
      };
    }
    $('sbCopyPine').onclick = () => {
      const head = '// Argos Sentinel · evidência (' + new Date().toLocaleDateString('pt-BR') + '): ' + PAIR(x.sym) + ' ' + TF_LABEL[x.tf] + ' · ' + U.cfgText(x.cfg) + '\n// N=' + s.n + ' (ef. ' + s.nEff + ') · acerto ' + fmtPct(s.winRate, 1) + ' · base ' + fmtPct(s.base, 1) + ' · p=' + fmtP(s.pTwo) + ' (ajust. ' + fmtP(s.q) + ' para ' + fam + ' variações) → ' + s.verdict.label + '\n// Pesquisa estatística histórica. Não é recomendação.\n';
      U.copyText(head + x.code, $('sbToast'), 'Código copiado com o cabeçalho de evidência.');
    };
  }
  function sbLog() {
    const box = $('sbLog'), n = Reg.tests.length;
    if (!n) { box.innerHTML = '<div class="saved-empty">Nenhum teste nesta sessão ainda.</div>'; return; }
    const rows = Reg.tests.slice().reverse().map((t) => '<div class="saved-item"><div class="saved-item-main"><span class="saved-item-name">' + t.k + '. ' + esc(t.name) + '</span><span class="saved-item-meta">' + esc(PAIR(t.sym) + ' ' + TF_LABEL[t.tf]) + ' · ' + esc(U.cfgText(t.cfg)) + ' · N ' + t.n + ' · acerto ' + fmtPct(t.winRate, 1) + ' vs base ' + fmtPct(t.base, 1) + ' · p ' + fmtP(t.pTwo) + ' → ajustado ' + fmtP(t.q) + '</span></div><span class="verdict ' + (TONE[t.verdict.key] || 'muted') + '">' + esc(t.verdict.label) + '</span></div>');
    box.innerHTML = '<div class="reg-head"><span>' + n + ' ' + pl(n, 'variação testada', 'variações testadas') + (Reg.persisted ? ' · registro salvo neste navegador' : ' · sem armazenamento no navegador: o registro vale até fechar a aba') + '</span><button type="button" class="btn btn-sm" id="sbReset">Zerar registro</button></div><div class="saved-list">' + rows.join('') + '</div>';
    $('sbReset').onclick = sbReset;
  }
  // Zerar pede uma segunda confirmação no próprio botão (sem janela do navegador)
  function sbReset() {
    const b = $('sbReset'); if (!b) return;
    if (!SB.resetArmed) {
      SB.resetArmed = true; b.textContent = 'Confirmar: apagar ' + Reg.tests.length + (Reg.tests.length === 1 ? ' variação' : ' variações'); b.classList.add('btn-warn');
      clearTimeout(SB.resetTimer); SB.resetTimer = setTimeout(() => { SB.resetArmed = false; sbLog(); }, 5000);
      return;
    }
    clearTimeout(SB.resetTimer); SB.resetArmed = false; Reg.clear(); SB.last = null; sbLog();
    $('sbOut').innerHTML = ''; $('sbResults').hidden = true;
  }
  function sbInit() {
    if (!$('sbCode')) return;
    Reg.load(); Saved.load();
    const gal = $('sbGallery');
    if (gal && PR) {
      PR.PINE_EXAMPLES.forEach((ex) => {
        const b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-ex', ex.id); b.title = ex.note; b.textContent = ex.title;
        b.addEventListener('click', () => { $('sbCode').value = ex.code; sbRead(); });
        gal.insertBefore(b, $('sbCount'));
      });
    }
    $('sbCode').value = PR && PR.PINE_EXAMPLES.length ? PR.PINE_EXAMPLES[0].code : '';
    $('sbParse').addEventListener('click', sbRead);
    $('sbRun').addEventListener('click', sbRun);
    $('sbCode').addEventListener('input', sbSchedule);
    bindSeg('sbAsset', sbDataLine); bindSeg('sbTf', sbDataLine);
    ['sbMode', 'sbTgt', 'sbStp', 'sbHold'].forEach((id) => $(id).addEventListener('input', sbRR));
    sbRR(); sbDataLine(); sbRead(); sbLog();
  }

  // ================================================================ Query
  // Consulta real: GET /api/analyze no servidor e o mesmo cálculo no navegador (mesmo motor e mesmo resumo). O selo compara o
  // resultHash dos dois quando usaram os mesmos candles (hash da série igual). Setup do Sandbox roda só no navegador.
  const Q = { running: false, last: null, cache: [] };
  function qFillSetups() {
    const sel = $('qSetup'); if (!sel) return; const cur = sel.value;
    sel.innerHTML = '<optgroup label="Banco de estratégias">' + E.SETUPS.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.nome) + '</option>').join('') + '</optgroup>' +
      (Saved.list.length ? '<optgroup label="Setups próprios (Sandbox)">' + Saved.list.map((s, i) => '<option value="CUSTOM:' + i + '">' + esc(s.name) + '</option>').join('') + '</optgroup>' : '');
    if (cur && Array.from(sel.options).some((o) => o.value === cur)) sel.value = cur;
  }
  const qCfgRead = () => ({ mode: $('qMode').value === 'pct' ? 'pct' : 'atr', tgt: num('qTgt', 2, 0.2, 20), stp: num('qStp', 1, 0.2, 20), hold: Math.round(num('qHold', 12, 2, 60)) });
  const numStr = (v) => String(+v);
  function qRequest(sym, tf, cfg, win, live, brief) {
    const p = ['symbol=' + sym, 'tf=' + tf, 'mode=' + cfg.mode, 'tgt=' + numStr(cfg.tgt), 'stp=' + numStr(cfg.stp), 'hold=' + cfg.hold];
    if (win) p.push('windowDays=' + win);
    p.push('live=' + (live ? 1 : 0));
    if (brief) p.push('brief=1');
    const path = '/api/analyze?' + p.join('&');
    const origin = /^https?:$/.test(location.protocol) ? location.origin : 'http://localhost:3000';
    return { path, url: origin + path, curl: 'curl -s "' + origin + path + '"' };
  }
  async function fetchServer(req) {
    const t0 = performance.now(), ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(req.path, { signal: ctl.signal, headers: { accept: 'application/json' }, cache: 'no-store' });
      const text = await r.text(), ms = performance.now() - t0;
      let body = null; try { body = JSON.parse(text); } catch (e) { /* não é JSON */ }
      if (!r.ok) return { ok: false, status: r.status, ms, error: (body && body.error && body.error.message) ? 'HTTP ' + r.status + ': ' + String(body.error.message).slice(0, 200) : 'HTTP ' + r.status };
      if (!body || typeof body !== 'object' || typeof body.resultHash !== 'string') return { ok: false, status: r.status, ms, error: 'a resposta não é o JSON esperado (HTTP ' + r.status + ')' };
      return { ok: true, status: r.status, ms, body, text };
    } catch (e) {
      return { ok: false, status: 0, ms: performance.now() - t0, error: e && e.name === 'AbortError' ? 'o servidor não respondeu em 25 s' : 'sem conexão com o servidor' };
    } finally { clearTimeout(to); }
  }
  // Candles do navegador para o Query: snapshot versionado ou ao vivo (com queda para o snapshot)
  async function qSeries(sym, tf, live) {
    if (!live) return { d: snapshotEntry(sym, tf).d, source: 'snapshot', fallback: '' };
    const s = await ensureSeries(sym, tf);
    return s;
  }
  function qWindow(d, win) { return win ? E.sliceSeries(d, Math.round((win * 86400) / d.dt) + 200) : d; }
  async function qLocalBank(sym, tf, cfg, win, live) {
    const ser = await qSeries(sym, tf, live), d = qWindow(ser.d, win);
    const key = [sym, tf, ser.source, cfg.mode, cfg.tgt, cfg.stp, cfg.hold, win || 'all', d.n, d.t[d.n - 1]].join('|');
    let hit = Q.cache.find((c) => c.key === key);
    if (!hit) {
      hit = await later(() => {
        const A = E.analyze(d, Object.assign({}, cfg), { sym, tf, source: ser.source, win: win || null });
        return { key, A, sum: SUM.summarize(A, { symbol: sym, timeframe: tf, source: ser.source, windowDays: win || null }) };
      });
      Q.cache.push(hit); while (Q.cache.length > 4) Q.cache.shift();
    }
    return { sum: hit.sum, d, source: ser.source, fallback: ser.fallback };
  }
  // Setup do Sandbox: motor no navegador, com o p ajustado pelas variações da sessão; resumo no mesmo formato da API
  async function qLocalCustom(custom, sym, tf, cfg, win, live) {
    const ser = await qSeries(sym, tf, live), d = qWindow(ser.d, win);
    return later(() => {
      const res = E.analyzeSpec(d, Object.assign({}, cfg), custom.spec, { sym, tf });
      const s = res.setup;
      if (s.n) { const t = Reg.record(custom.spec, custom.name, sym, tf, cfg, s); if (t) { s.q = t.q; s.family = t.family; s.verdict = t.verdict; } else { s.q = s.pTwo; s.family = 1; } } else { s.q = s.pTwo; s.family = 1; }
      const A = { d, cfg: res.cfg, warm: res.warm, rstats: E.regimeStats(res.reg), base: res.base, setups: [s], calib: res.calib, tech: res.tech };
      return { sum: SUM.summarize(A, { symbol: sym, timeframe: tf, source: ser.source, windowDays: win || null }), d, source: ser.source, fallback: ser.fallback, empty: !s.n };
    });
  }
  // Selo: compara o resultHash do servidor com o do navegador, só quando os dois usaram os mesmos candles
  function qSeal(server, local, custom, skipped) {
    if (custom) return { kind: 'off', title: 'Setup próprio: roda só no navegador', text: 'Um setup vindo do Sandbox não existe no servidor. O cálculo usou o mesmo motor (' + local.sum.engine + '), no navegador. O resultHash abaixo é o deste cálculo local.' };
    if (skipped) return { kind: 'off', title: 'Sem comparação com o servidor', text: 'Esta página roda sem acesso ao servidor. O resultado foi calculado no navegador.' };
    if (!server.ok) return { kind: 'off', title: 'Servidor indisponível: calculado só no navegador', text: 'Motivo: ' + server.error + '. O resultado abaixo foi calculado no navegador com o mesmo motor (' + local.sum.engine + '). Não há comparação de hash.' };
    const sb = server.body, lb = local.sum;
    if (sb.engine !== lb.engine) return { kind: 'warn', title: 'Versões do motor diferentes', text: 'Servidor: ' + sb.engine + '. Navegador: ' + lb.engine + '. Com versões diferentes os resultHash não são comparáveis.' };
    if (sb.data.hash !== lb.data.hash) {
      return { kind: 'warn', title: 'Candles diferentes: o resultHash não é comparável', text: 'O servidor leu ' + fmtInt(sb.data.candles) + ' candles até ' + isoDayOf(sb.data.to) + ' (' + sb.data.source + ', hash da série ' + shortHash(sb.data.hash) + '). O navegador leu ' + fmtInt(lb.data.candles) + ' candles até ' + isoDayOf(lb.data.to) + ' (' + lb.data.source + ', hash ' + shortHash(lb.data.hash) + '). Isso não indica erro de cálculo.' + (sb.data.source === 'database' ? ' O servidor leu da base de candles.' : ' Com a opção "Snapshot versionado" e o servidor sem base de candles, os dois lados leem o mesmo arquivo.') };
    }
    if (sb.resultHash === lb.resultHash) return { kind: 'ok', title: 'Mesmo resultado no servidor e no navegador', text: 'Os dois usaram os mesmos ' + fmtInt(sb.data.candles) + ' candles (hash da série ' + shortHash(sb.data.hash) + ') e chegaram ao mesmo resultHash.' };
    const diffs = [];
    (sb.setups || []).forEach((s, i) => { const l = lb.setups[i]; ['n', 'nEff', 'wins', 'winRate', 'pTwo', 'q'].forEach((k) => { if (!l || s[k] !== l[k]) diffs.push(s.id + '.' + k); }); });
    return { kind: 'bad', title: 'Resultados diferentes sobre os mesmos candles', text: 'Os candles são os mesmos (hash da série ' + shortHash(sb.data.hash) + '), mas os resultHash diferem.' + (diffs.length ? ' Campos diferentes: ' + diffs.slice(0, 6).join(', ') + '.' : ' Os campos dos setups coincidem; a diferença está em outra parte do resumo.') };
  }
  const sealHTML = (z) => '<div class="q-seal ' + z.kind + '" role="status"><span class="q-seal-ico" aria-hidden="true">' + ({ ok: '✓', bad: '✗', warn: '!', off: 'i' }[z.kind]) + '</span><div><strong>' + esc(z.title) + '</strong><p>' + esc(z.text) + '</p></div></div>';

  async function qRun() {
    if (Q.running) return;
    const id = $('qSetup').value, sym = $('qAsset').value, tf = $('qTf').value, cfg = qCfgRead(), win = $('qWin').value ? +$('qWin').value : null, brief = $('qBrief').checked, live = $('qData').value === 'live';
    if (!ASSETS.includes(sym) || !TFS.includes(tf)) return;
    let custom = null;
    if (id.indexOf('CUSTOM:') === 0) { custom = Saved.list[+id.split(':')[1]]; if (!custom) return; }
    else if (!E.SETUPS.some((s) => s.id === id)) return;
    Q.running = true; $('qRun').disabled = true; $('qRun').textContent = 'CONSULTANDO…';
    $('qEmpty').hidden = true; $('qOut').hidden = false; $('qOut').setAttribute('aria-busy', 'true');
    $('qOut').innerHTML = loadingHTML(custom ? 'Calculando no navegador…' : 'Consultando o servidor e calculando no navegador…');
    const req = qRequest(sym, tf, cfg, win, live, brief);
    try {
      if (!SUM) throw new Error('o módulo de resumo não foi carregado nesta página');
      const skipped = !custom && (IN_CLAUDE || !/^https?:$/.test(location.protocol));
      const serverP = custom || skipped ? Promise.resolve(null) : fetchServer(req);
      const local = custom ? await qLocalCustom(custom, sym, tf, cfg, win, live) : await qLocalBank(sym, tf, cfg, win, live);
      const server = await serverP;
      if (local.empty) { $('qOut').innerHTML = stateHTML('empty', 'Nenhum gatilho com desfecho nesta série', 'O setup próprio não disparou depois do aquecimento de 200 candles, ou os disparos não têm a janela futura completa de ' + cfg.hold + ' candles.'); return; }
      qRender({ id, custom, sym, tf, cfg, win, live, brief, req, local, server, skipped });
    } catch (e) {
      $('qOut').innerHTML = stateHTML('err', 'A consulta não pôde ser feita', 'Nenhum número foi calculado. ' + (e && e.message ? String(e.message).slice(0, 160) : ''));
    } finally {
      Q.running = false; $('qOut').setAttribute('aria-busy', 'false'); $('qRun').disabled = false; $('qRun').textContent = 'CONSULTAR';
    }
  }
  // Recorte da resposta do servidor para o setup escolhido (a resposta completa traz os 8 setups, a calibração e a leitura técnica)
  function qSlice(body, setupRaw) {
    return {
      engine: body.engine, input: body.input, data: body.data, regime: { current: body.regime.current }, base: body.base, setup: setupRaw,
      calibration: { n: body.calibration.n, brier: body.calibration.brier, brierRef: body.calibration.brierRef, bss: body.calibration.bss, ece: body.calibration.ece, status: body.calibration.status },
      resultHash: body.resultHash
    };
  }
  function qRender(c) {
    const { custom, server, local, req } = c;
    const serverOk = !!(server && server.ok), full = serverOk && !!server.body.setups;
    const shown = full ? server.body : local.sum;
    const sRaw = shown.setups.find((x) => x.id === (custom ? 'CUSTOM' : c.id));
    if (!sRaw) { $('qOut').innerHTML = stateHTML('err', 'Setup não encontrado na resposta', 'A resposta não traz o setup pedido.'); return; }
    const s = reviveSetup(sRaw), calib = reviveCalib(shown.calibration);
    const regNow = shown.regime.current, seal = qSeal(server, local, !!custom, c.skipped);
    const dLike = { n: shown.data.candles, dt: TF_SEC[c.tf], t: [Date.parse(shown.data.from) / 1000] };
    const famN = custom ? Math.max(1, s.family || 1) : shown.setups.length;
    const famTxt = custom ? famN + ' ' + pl(famN, 'variação', 'variações') + ' na sessão' : famN + ' setups do banco';
    // JSON mostrado: a resposta curta inteira, o recorte da resposta completa ou, sem servidor, o resumo local no mesmo formato
    let view, origin = serverOk ? 'servidor' : 'navegador';
    if (serverOk && c.brief) view = server.body;
    else if (full) view = Object.assign(qSlice(server.body, sRaw), { ms: server.body.ms, cacheHit: server.body.cacheHit, disclaimer: server.body.disclaimer });
    else view = Object.assign(qSlice(local.sum, sRaw), { calculado_no: 'navegador' });
    const jtxt = JSON.stringify(view, null, 2), fulltxt = JSON.stringify(serverOk ? server.body : local.sum, null, 2);
    const meta = serverOk
      ? '<span>Latência: ' + fmtN(server.ms, 0) + ' ms' + (isFinite(server.body.ms) ? ' (motor no servidor: ' + fmtN(server.body.ms, 0) + ' ms' + (server.body.cacheHit ? ', em cache' : '') + ')' : '') + '</span>'
      : server ? '<span>Latência: ' + fmtN(server.ms, 0) + ' ms até a falha</span>' : '<span>Latência: sem chamada ao servidor</span>';
    const fallbackNote = local.fallback ? '<div class="warnings"><div class="warning-item"><span class="mark">⚠</span> Candles ao vivo indisponíveis no navegador (' + esc(local.fallback) + '). O navegador usou o snapshot versionado.</div></div>' : '';
    $('qOut').innerHTML =
      '<div class="regime-badge-row"><span class="lbl">Regime atual:</span><span class="regime-chip ' + (REG_CLS[regNow.regime] || 'lv') + '">' + esc(regNow.label || (E.REGIMES[regNow.regime] || {}).label || regNow.regime) + '</span><span class="lbl">' + esc(PAIR(c.sym) + ' ' + TF_LABEL[c.tf] + ' · ' + (custom ? custom.name : s.nome)) + '</span></div>' +
      sealHTML(seal) + fallbackNote +
      (serverOk && c.brief ? '<p class="pv-note">A resposta curta (brief=1) traz só a identificação do resultado. As estatísticas abaixo vêm do cálculo no navegador, com o mesmo motor.</p>' : '') +
      statCards(s, calib, famTxt) + (s.wf ? wfCard(s, dLike) : '') + warningsFor(s, famN, dLike, c.cfg) +
      (custom
        ? '<div class="card q-req"><div class="json-h"><span>Requisição</span></div><p class="pv-note q-note">Setup próprio do Sandbox: não há requisição ao servidor. O cálculo rodou no navegador, com o motor ' + esc(local.sum.engine) + ' e os candles descritos abaixo.</p></div>'
        : '<div class="card q-req"><div class="json-h"><span>Requisição · GET /api/analyze</span><span class="q-btns"><button type="button" class="btn btn-sm" id="qCopyUrl">Copiar URL</button><button type="button" class="btn btn-sm" id="qCopyCurl">Copiar curl</button></span></div><pre class="json q-line" id="qUrl" tabindex="0"></pre><pre class="json q-line" id="qCurl" tabindex="0"></pre></div>') +
      '<div class="card json-card"><div class="json-h"><span>Resposta · application/json · ' + (serverOk ? 'HTTP ' + server.status + ' · servidor' : 'calculada no navegador') + '</span><span class="q-btns"><button type="button" class="btn btn-sm" id="qCopy">Copiar JSON</button><button type="button" class="btn btn-sm" id="qCopyFull">Copiar resposta completa</button></span></div><pre class="json" id="qJson" tabindex="0" aria-label="Resposta JSON"></pre></div>' +
      '<div class="meta-row q-meta">' + meta + '<span>' + esc(shown.engine) + ' · candles: ' + esc(shown.data.source) + ' · ' + fmtInt(shown.data.candles) + '</span></div>' +
      '<div class="q-hashes"><div><span class="lbl">resultHash (' + origin + ')</span><code class="q-hash">' + esc(shown.resultHash) + '</code></div>' +
        (serverOk ? '<div><span class="lbl">resultHash (navegador)</span><code class="q-hash">' + esc(local.sum.resultHash) + '</code></div>' : '') +
        '<div><span class="lbl">hash da série (' + origin + ')</span><code class="q-hash">' + esc(shown.data.hash) + '</code></div></div>' +
      '<p class="pv-note">O resultHash é o SHA-256 do resumo canônico da análise: os mesmos candles, a mesma regra de saída e a mesma versão do motor dão o mesmo hash em qualquer ambiente. O navegador monta o resumo com o mesmo código do servidor.</p>';
    $('qJson').textContent = jtxt;
    if (!custom) {
      $('qUrl').textContent = 'GET ' + req.url; $('qCurl').textContent = req.curl;
      $('qCopyUrl').onclick = () => copyBtn('qCopyUrl', req.url, 'Copiar URL');
      $('qCopyCurl').onclick = () => copyBtn('qCopyCurl', req.curl, 'Copiar curl');
    }
    $('qCopy').onclick = () => copyBtn('qCopy', jtxt, 'Copiar JSON');
    $('qCopyFull').onclick = () => copyBtn('qCopyFull', fulltxt, 'Copiar resposta completa');
    Q.last = { jtxt, fulltxt, seal };
  }
  function copyBtn(id, text, label) { const b = $(id); U.copyText(text, null, '').then((ok) => { b.textContent = ok ? 'Copiado' : 'Não copiou'; setTimeout(() => (b.textContent = label), 1600); }); }
  function qRR() { const c = qCfgRead(); $('qRR').textContent = fmtN(c.tgt / c.stp, 1) + ' : 1'; }
  function qInit() {
    if (!$('qSetup')) return;
    if (!$('sbCode')) { Saved.load(); }
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
  // Fechada, a tela perde o conteúdo interativo (os campos nem existem: sbInit e qInit não montam nada) e passa a mostrar um aviso.
  // Quem leva à tela por fora dela (data-feature="sandbox" | "query" em outras telas) é escondido.
  const SOON = {
    sandbox: {
      title: 'Setup Sandbox',
      will: 'O Sandbox lê uma regra escrita em Pine Script e a testa contra entradas aleatórias, com os dados reais da Binance e a mesma regra de saída do banco de estratégias. O p de cada teste é ajustado pelo número de variações testadas na sessão.',
      meanwhile: 'Enquanto isso, os 8 setups do banco de estratégias são testados na tela Ao vivo, com taxa de acerto, intervalo de confiança, taxa-base e p ajustado.'
    },
    query: {
      title: 'Query',
      will: 'O Query consulta o motor diretamente: um setup, um ativo, uma regra de saída e uma janela, com a resposta no formato da API.',
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
        '<div class="card config-card"><div class="section-label">O que a função faz</div><p class="pv-context">' + esc(c.will) + '</p><p class="pv-note">Ainda não está disponível. ' + esc(c.meanwhile) + '</p>' +
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
    if (screen === 'query') qFillSetups();
  }
  window.ArgosPlatform = { onTab, cRender, readPine: PR ? PR.readPine : null };
  function boot() { applyFeatures(); sbInit(); qInit(); cInit(); siteInit(); tipInit(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
