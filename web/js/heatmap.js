/* =====================================================================
   ARGOS · Mapa setup × regime
   Matriz de 8 setups (linhas) × 5 regimes de mercado (colunas). Cada célula
   mostra a taxa de acerto do setup naquele regime, o N e o N efetivo. A cor
   codifica a diferença, em pontos percentuais, entre a taxa de acerto e a
   taxa-base DO MESMO regime (entradas aleatórias do motor).

   É um recorte descritivo: não calcula p-valor, não cria teste e não emite
   veredito. Todo número vem do motor (E.analyze) e do recorte por regime
   (ArgosRegimeView). Nenhuma frase aqui é recomendação.

   Entrada: evento `argos:analysis` no document, detail { A, E }.
   Saída: evento `argos:select` no document, detail { setupId, regime }.
   ===================================================================== */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ constantes
  /** Teto fixo da escala de cor, em pontos percentuais (simétrico: ±15 p.p.). */
  var CAP_PP = 15;
  /** Esmaecida: fração da cor da escala que sobra (o resto é o fundo do cartão). */
  var FADE = 0.4;
  /** Nível do intervalo usado na conta de "quantos excluem por acaso". */
  var ALPHA = 0.05;
  /** Mesmo corte do recorte por regime (lib/regime-view.js): abaixo disso, evidência insuficiente. */
  var MIN_EFFECTIVE = 10;

  // Escala divergente segura para daltônicos: azul = acima da taxa-base, laranja = abaixo.
  // Os dois extremos têm a mesma luminância relativa (cerca de 0,15), para a escala ser simétrica
  // também em luminância, e passam de 4,5:1 contra o texto claro (WCAG AA). Nunca verde/vermelho.
  var NEUTRAL = [33, 40, 50];   // #212832  diferença zero
  var BLUE = [47, 109, 181];    // #2F6DB5  acima da taxa-base
  var ORANGE = [170, 83, 24];   // #AA5318  abaixo da taxa-base
  var PANEL = [16, 25, 39];     // #101927  fundo do cartão (--bg-panel)
  var INK_LIGHT = [245, 242, 234];
  var INK_DARK = [13, 20, 32];

  // ------------------------------------------------------------ formatos (pt-BR)
  var nfCache = {};
  function NF(d) {
    return nfCache[d] || (nfCache[d] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  }
  function ok(x) { return typeof x === 'number' && isFinite(x); }
  var INT = new Intl.NumberFormat('pt-BR');
  function fmtInt(x) { return ok(x) ? INT.format(Math.round(x)) : 'n/d'; }
  function fmtPct(x, d) { return ok(x) ? NF(d == null ? 1 : d).format(x * 100) + '%' : 'n/d'; }
  /** Diferença em p.p. com sinal ("+7,5 p.p.", "−3,1 p.p."). Arredonda antes de decidir o sinal. */
  function fmtPP(x) {
    if (!ok(x)) return 'n/d';
    var r = Math.round(Math.abs(x) * 10) / 10;
    return (r === 0 ? '' : x > 0 ? '+' : '−') + NF(1).format(r) + ' p.p.';
  }
  function methodLabel(m) { return m === 'wilson' ? 'Wilson' : 'Bayes Beta-Binomial'; }

  // ------------------------------------------------------------ cor
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function mix(a, b, t) {
    return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); });
  }
  function hex(c) {
    return '#' + c.map(function (v) { var s = v.toString(16); return s.length < 2 ? '0' + s : s; }).join('');
  }
  function lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  /** Luminância relativa (WCAG) de um RGB [0-255]. */
  function luminance(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /** Cor de texto (clara ou escura) com mais contraste sobre o fundo. */
  function textOn(rgb) { return contrast(rgb, INK_LIGHT) >= contrast(rgb, INK_DARK) ? hex(INK_LIGHT) : hex(INK_DARK); }

  /**
   * Cor da escala para uma diferença em pontos percentuais (taxa de acerto menos taxa-base do regime).
   * Simétrica: +x e −x têm a mesma intensidade `t`, só muda o lado (azul acima, laranja abaixo).
   * Satura no teto: |x| >= cap dá a cor do extremo.
   * @param {number} deltaPP
   * @param {number} [cap=15] teto, em p.p.
   * @returns {{ bg: string, fg: string, t: number, side: 'acima' | 'abaixo' | 'neutro', rgb: number[] } | null} null se não for número finito
   */
  function colorFor(deltaPP, cap) {
    if (!ok(deltaPP)) return null;
    var c = ok(cap) && cap > 0 ? cap : CAP_PP;
    var t = clamp01(Math.abs(deltaPP) / c);
    var side = deltaPP > 0 ? 'acima' : deltaPP < 0 ? 'abaixo' : 'neutro';
    var end = side === 'acima' ? BLUE : side === 'abaixo' ? ORANGE : NEUTRAL;
    var rgb = mix(NEUTRAL, end, t);
    return { bg: hex(rgb), fg: textOn(rgb), t: t, side: side, rgb: rgb };
  }

  /** Versão esmaecida de uma cor da escala: mistura com o fundo do cartão. */
  function faded(color) {
    var rgb = mix(PANEL, color.rgb, FADE);
    return { bg: hex(rgb), fg: textOn(rgb) };
  }

  // ------------------------------------------------------------ modelo (puro, sem DOM)
  function describe(nome, col, cell) {
    var head = nome + ', ' + col.label + (col.current ? ' (regime atual)' : '') + ': ';
    var baseTxt = ok(cell.base.rate) ? fmtPct(cell.base.rate) + ' (N ' + fmtInt(cell.base.n) + ')' : 'indisponível';
    if (cell.state === 'vazia') {
      return head + 'sem gatilhos encerrados neste regime. Taxa-base do regime: ' + baseTxt + '.';
    }
    var parts = [
      'N ' + fmtInt(cell.n),
      'N efetivo ' + fmtInt(cell.nEff),
      'taxa de acerto ' + fmtPct(cell.rate),
      'IC 95% de ' + fmtPct(cell.ci[0]) + ' a ' + fmtPct(cell.ci[1]) + ' (' + methodLabel(cell.method) + ')',
      'taxa-base do regime ' + baseTxt
    ];
    if (ok(cell.deltaPP)) parts.push('diferença ' + fmtPP(cell.deltaPP));
    var tail = cell.state === 'insuficiente'
      ? 'N efetivo abaixo de ' + MIN_EFFECTIVE + ': evidência insuficiente, célula sem cor.'
      : cell.state === 'cheia'
        ? 'O IC 95% exclui a taxa-base do regime. Recorte descritivo, sem teste estatístico nem correção para múltiplos testes.'
        : cell.ciContainsBase === null
          ? 'Não há taxa-base neste regime para comparar. Recorte descritivo.'
          : 'O IC 95% contém a taxa-base do regime. Recorte descritivo.';
    var body = parts.join('; ');
    return head + body + (/.$/.test(body) ? ' ' : '. ') + tail; // "p.p." já termina em ponto
  }

  function cellModel(setup, col, c) {
    var base = c && c.base ? { rate: c.base.rate, n: c.base.n } : { rate: NaN, n: 0 };
    var cell = {
      setupId: setup.id, regime: col.code, state: 'vazia',
      n: 0, nEff: 0, wins: 0, rate: NaN, ci: [NaN, NaN], method: null,
      base: base, deltaPP: null, ciContainsBase: null,
      color: null, fill: null, fg: null, label: ''
    };
    if (c && c.n > 0) {
      cell.n = c.n; cell.nEff = c.nEff; cell.wins = c.wins; cell.rate = c.winRate;
      cell.ci = [c.ci[0], c.ci[1]]; cell.method = c.method;
      cell.deltaPP = ok(base.rate) ? (c.winRate - base.rate) * 100 : null;
      cell.ciContainsBase = ok(base.rate) ? (c.ci[0] <= base.rate && base.rate <= c.ci[1]) : null;
      if (c.insufficient || c.nEff < MIN_EFFECTIVE) {
        cell.state = 'insuficiente';
      } else if (cell.ciContainsBase === false) {
        cell.state = 'cheia';
      } else {
        // IC contém a taxa-base (ou não há taxa-base no regime para comparar): nada a afirmar
        cell.state = 'esmaecida';
      }
      if (cell.state === 'cheia' || cell.state === 'esmaecida') {
        cell.color = colorFor(cell.deltaPP);
        if (cell.color) {
          var f = cell.state === 'cheia' ? cell.color : faded(cell.color);
          cell.fill = f.bg; cell.fg = f.fg;
        }
      }
    }
    cell.label = describe(setup.nome || setup.id, col, cell);
    return cell;
  }

  /**
   * Monta a matriz setup × regime, pronta para desenhar (sem DOM).
   * @param {{ REGIMES: Record<string, { label: string, short: string }> }} E motor
   * @param {{ setups: { id: string, nome: string, grupo?: string }[], meta?: object, cfg?: object }} A resultado de E.analyze
   * @param {{ regimes: string[], current: string, bySetup: Record<string, Record<string, object>> }} [view] saída de regimeView; se faltar, usa ArgosRegimeView
   * @returns {{ cap: number, current: string, columns: object[], rows: object[], total: number, compared: number, excluding: number }}
   */
  function model(E, A, view) {
    var empty = { cap: CAP_PP, current: null, columns: [], rows: [], total: 0, compared: 0, excluding: 0 };
    if (!A || !Array.isArray(A.setups)) return empty;
    var V = view;
    if (!V && root.ArgosRegimeView && E) V = root.ArgosRegimeView.regimeView(E, A);
    if (!V || !Array.isArray(V.regimes)) return empty;
    var R = (E && E.REGIMES) || {};
    var first = A.setups.length ? V.bySetup[A.setups[0].id] : null;
    var columns = V.regimes.map(function (code) {
      var meta = R[code] || {};
      var b = first && first[code] && first[code].base ? first[code].base : { rate: NaN, n: 0 }; // a taxa-base não depende do setup
      return { code: code, label: meta.label || code, short: meta.short || code, current: code === V.current, base: { rate: b.rate, n: b.n } };
    });
    var compared = 0, excluding = 0;
    var rows = A.setups.map(function (s) {
      var cells = columns.map(function (col) {
        var cell = cellModel(s, col, (V.bySetup[s.id] || {})[col.code]);
        if (cell.state === 'cheia' || cell.state === 'esmaecida') compared++;
        if (cell.state === 'cheia') excluding++;
        return cell;
      });
      return { id: s.id, nome: s.nome || s.id, grupo: s.grupo || '', cells: cells };
    });
    return { cap: CAP_PP, current: V.current, columns: columns, rows: rows, total: rows.length * columns.length, compared: compared, excluding: excluding };
  }

  // ------------------------------------------------------------ texto fixo
  function noteText(m) {
    var out = ['Recorte descritivo.'];
    out.push('São ' + fmtInt(m.total) + ' recortes por série e nenhum passou por teste estatístico nem por correção para múltiplos testes.');
    if (m.compared > 0) {
      var exp = m.compared * ALPHA;
      var e = Math.round(exp);
      var expTxt = exp < 0.75 ? 'menos de 1' : 'cerca de ' + fmtInt(e);
      var verb = e >= 2 ? 'excluam' : 'exclua';
      out.push('Dos ' + fmtInt(m.compared) + ' recortes com N efetivo de pelo menos ' + MIN_EFFECTIVE + ', ' + fmtInt(m.excluding) + ' têm IC que exclui a taxa-base. ' +
        'Com ' + fmtInt(m.compared) + ' intervalos de 95%, é esperado que ' + expTxt + ' ' + verb + ' a taxa-base por acaso.');
    }
    out.push('O teste e o veredito valem para o conjunto completo de gatilhos de cada setup.');
    return out.join(' ');
  }

  function cfgText(c) {
    if (!c || !ok(c.tgt) || !ok(c.stp) || !ok(c.hold)) return '';
    var u = c.mode === 'atr' ? '×ATR' : '%';
    var f = function (x) { return NF(x % 1 ? 1 : 0).format(x); };
    return 'alvo ' + f(c.tgt) + u + ' · stop ' + f(c.stp) + u + ' · ' + c.hold + ' candles';
  }
  var TF_LABEL = { '1h': '1h', '4h': '4h', '1d': '1D' };
  function metaText(A) {
    var parts = [];
    if (A && A.meta && A.meta.sym) {
      parts.push(String(A.meta.sym).replace('USDT', '/USDT') + (A.meta.tf ? ' ' + (TF_LABEL[A.meta.tf] || A.meta.tf) : ''));
    }
    var c = cfgText(A && A.cfg);
    if (c) parts.push(c);
    return parts.join(' · ');
  }

  // ------------------------------------------------------------ DOM
  function el(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function add(parent, child) { parent.appendChild(child); return child; }
  /** Espaço entre elementos de bloco: o nome acessível não cola "Alta" em "taxa-base". */
  function space(doc, parent) { parent.appendChild(doc.createTextNode(' ')); }

  function legendKey(doc, state, text, fill) {
    var li = el(doc, 'li', 'hm-key');
    var sw = add(li, el(doc, 'span', 'hm-sw ' + state));
    sw.setAttribute('aria-hidden', 'true');
    if (fill) sw.style.setProperty('background-color', fill);
    add(li, el(doc, 'span', null, text));
    return li;
  }

  function buildLegend(doc, m) {
    var box = el(doc, 'div', 'hm-legend');

    var scale = add(box, el(doc, 'div', 'hm-scale'));
    var cap = fmtInt(m.cap);
    add(scale, el(doc, 'span', 'hm-scale-t', 'Diferença para a taxa-base do regime'));
    var barRow = add(scale, el(doc, 'div', 'hm-scale-row'));
    barRow.setAttribute('role', 'img');
    barRow.setAttribute('aria-label', 'Escala de cor: laranja abaixo da taxa-base, neutro na taxa-base, azul acima. Satura em ' + cap + ' pontos percentuais.');
    add(barRow, el(doc, 'span', 'hm-scale-l', '−' + cap + ' p.p. ou menos'));
    var bar = add(barRow, el(doc, 'span', 'hm-bar'));
    var lo = colorFor(-m.cap, m.cap), mid = colorFor(0, m.cap), hi = colorFor(m.cap, m.cap);
    bar.style.background = 'linear-gradient(90deg, ' + lo.bg + ', ' + mid.bg + ', ' + hi.bg + ')';
    add(barRow, el(doc, 'span', 'hm-scale-r', '+' + cap + ' p.p. ou mais'));
    var caps = add(scale, el(doc, 'div', 'hm-scale-cap'));
    add(caps, el(doc, 'span', null, 'abaixo da taxa-base (laranja)'));
    add(caps, el(doc, 'span', null, 'igual'));
    add(caps, el(doc, 'span', null, 'acima da taxa-base (azul)'));

    var keys = add(box, el(doc, 'ul', 'hm-keys'));
    var sample = colorFor(m.cap * 0.8, m.cap); // amostra azul a 80% do teto, a mesma cor que a escala usa
    add(keys, legendKey(doc, 'cheia', 'Cor cheia: o IC 95% exclui a taxa-base do regime.', sample.bg));
    add(keys, legendKey(doc, 'esmaecida', 'Cor esmaecida, contorno tracejado: o IC 95% contém a taxa-base.', faded(sample).bg));
    add(keys, legendKey(doc, 'insuficiente', 'Hachura, n < ' + MIN_EFFECTIVE + ': N efetivo abaixo de ' + MIN_EFFECTIVE + ', evidência insuficiente, sem cor.'));
    add(keys, legendKey(doc, 'vazia', 'sem gatilhos: nenhum gatilho encerrado naquele regime.'));
    var keyN = el(doc, 'li', 'hm-key hm-key-text');
    add(keyN, el(doc, 'span', null, 'Em cada célula: taxa de acerto, N (N efetivo) e diferença para a taxa-base. A coluna "agora" é o regime do último candle.'));
    add(keys, keyN);
    return box;
  }

  function buildCell(doc, row, col, cell) {
    var td = el(doc, 'td', 'hm-td' + (col.current ? ' hm-now' : ''));
    var b = add(td, el(doc, 'button', 'hm-cell ' + cell.state));
    b.setAttribute('type', 'button');
    b.setAttribute('data-setup', cell.setupId);
    b.setAttribute('data-regime', cell.regime);
    b.setAttribute('data-state', cell.state);
    b.setAttribute('aria-label', cell.label);
    b.setAttribute('title', cell.label);
    if (cell.fill) {
      b.style.setProperty('background-color', cell.fill);
      b.style.setProperty('color', cell.fg);
    }
    if (cell.state === 'vazia') {
      add(b, el(doc, 'span', 'hm-v hm-v-soft', 'sem gatilhos'));
    } else if (cell.state === 'insuficiente') {
      add(b, el(doc, 'span', 'hm-v hm-v-soft', 'n < ' + MIN_EFFECTIVE));
      add(b, el(doc, 'span', 'hm-n', 'N ' + fmtInt(cell.n) + ' (' + fmtInt(cell.nEff) + ')'));
    } else {
      add(b, el(doc, 'span', 'hm-v', fmtPct(cell.rate)));
      add(b, el(doc, 'span', 'hm-n', 'N ' + fmtInt(cell.n) + ' (' + fmtInt(cell.nEff) + ')'));
      if (ok(cell.deltaPP)) add(b, el(doc, 'span', 'hm-d', fmtPP(cell.deltaPP)));
    }
    return td;
  }

  function buildTable(doc, m) {
    var table = el(doc, 'table', 'hm-table');
    table.id = 'hmTable';
    table.setAttribute('aria-describedby', 'hmNote');
    add(table, el(doc, 'caption', 'hm-sr',
      'Taxa de acerto de cada setup em cada regime de mercado, com N, N efetivo e diferença para a taxa-base do regime. A coluna marcada como agora é o regime do último candle.'));

    var thead = add(table, el(doc, 'thead'));
    var hr = add(thead, el(doc, 'tr'));
    var corner = add(hr, el(doc, 'th', 'hm-corner', 'Setup'));
    corner.setAttribute('scope', 'col');
    m.columns.forEach(function (col) {
      var th = add(hr, el(doc, 'th', 'hm-colh' + (col.current ? ' hm-now' : '')));
      th.setAttribute('scope', 'col');
      th.setAttribute('title', col.label);
      if (col.current) th.setAttribute('aria-current', 'true');
      add(th, el(doc, 'span', 'hm-rg', col.short));
      space(doc, th);
      if (col.current) {
        var tag = add(th, el(doc, 'span', 'hm-tag', 'agora'));
        tag.setAttribute('title', 'Regime do último candle');
        space(doc, th);
      }
      add(th, el(doc, 'span', 'hm-base', 'taxa-base ' + fmtPct(col.base.rate)));
    });

    var tbody = add(table, el(doc, 'tbody'));
    m.rows.forEach(function (row) {
      var tr = add(tbody, el(doc, 'tr'));
      var th = add(tr, el(doc, 'th', 'hm-rowh'));
      th.setAttribute('scope', 'row');
      add(th, el(doc, 'span', 'hm-sname', row.nome));
      if (row.grupo) { space(doc, th); add(th, el(doc, 'span', 'hm-sgrp', row.grupo)); }
      row.cells.forEach(function (cell, i) { add(tr, buildCell(doc, row, m.columns[i], cell)); });
    });
    return table;
  }

  var bound = typeof WeakSet === 'function' ? new WeakSet() : null;
  function onCardClick(ev) {
    var t = ev && ev.target;
    var b = t && t.closest ? t.closest('button.hm-cell') : null;
    if (!b) return;
    var setupId = b.getAttribute('data-setup'), regime = b.getAttribute('data-regime');
    if (!setupId || !regime) return; // sem setup não há seleção
    var doc = b.ownerDocument;
    if (doc && typeof CustomEvent === 'function') doc.dispatchEvent(new CustomEvent('argos:select', { detail: { setupId: setupId, regime: regime } }));
  }

  /**
   * Desenha a matriz dentro de `container` (substitui o conteúdo). O clique numa célula dispara `argos:select`.
   * @param {Element} container
   * @param {object} m saída de `model`
   * @param {{ meta?: string }} [opts] texto de contexto (par, tempo gráfico e regra de saída)
   * @returns {Element} o próprio container
   */
  function render(container, m, opts) {
    if (!container || !m) return container;
    var doc = container.ownerDocument || root.document;
    var meta = (opts && opts.meta) || '';

    // o clique refaz o desenho (análise nova) e perderia o foco do teclado: guarda a célula focada
    var focused = null;
    var act = doc.activeElement;
    if (act && container.contains && container.contains(act) && act.getAttribute) {
      focused = { s: act.getAttribute('data-setup'), r: act.getAttribute('data-regime') };
    }

    container.textContent = '';
    container.hidden = !m.rows.length;
    if (!m.rows.length) return container;

    var head = add(container, el(doc, 'div', 'hm-head'));
    var ht = add(head, el(doc, 'div', 'hm-head-t'));
    var h = add(ht, el(doc, 'h3', 'hm-title', 'Mapa setup × regime'));
    h.id = 'hmTitle';
    add(ht, el(doc, 'p', 'hm-sub',
      'Onde cada setup teve gatilhos e como se saiu em cada regime de mercado. A cor mostra a diferença entre a taxa de acerto e a taxa-base do mesmo regime.'));
    if (meta) add(head, el(doc, 'span', 'hm-meta', meta));

    var scroll = add(container, el(doc, 'div', 'hm-scroll'));
    add(scroll, buildTable(doc, m));

    add(container, buildLegend(doc, m));
    var note = add(container, el(doc, 'p', 'hm-note', noteText(m)));
    note.id = 'hmNote';

    container.setAttribute('aria-labelledby', 'hmTitle');

    if (!bound || !bound.has(container)) {
      container.addEventListener('click', onCardClick);
      if (bound) bound.add(container);
    }

    if (focused && focused.s && container.querySelectorAll) {
      var all = container.querySelectorAll('button.hm-cell');
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute('data-setup') === focused.s && all[i].getAttribute('data-regime') === focused.r) {
          try { all[i].focus({ preventScroll: true }); } catch (e) { /* foco é cortesia */ }
          break;
        }
      }
    }
    return container;
  }

  // ------------------------------------------------------------ integração com a tela Ao vivo
  var CARD_ID = 'lvHeatmap';

  /** Cria o cartão logo depois do cartão que contém #lvBank. Sem âncora, devolve null e não faz nada. */
  function ensureCard(doc) {
    var card = doc.getElementById(CARD_ID);
    if (card && card.parentNode) return card;
    var bank = doc.getElementById('lvBank');
    var anchor = bank && bank.closest ? bank.closest('.card') : null;
    if (!anchor || !anchor.parentNode) return null;
    card = doc.createElement('section');
    card.id = CARD_ID;
    card.className = 'card hm-card';
    anchor.parentNode.insertBefore(card, anchor.nextSibling);
    return card;
  }

  function hideCard(doc) {
    var card = doc && doc.getElementById ? doc.getElementById(CARD_ID) : null;
    if (card) card.hidden = true;
  }

  var regimeViewCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function viewOf(E, A) {
    var RV = root.ArgosRegimeView;
    if (!RV || !RV.regimeView) return null;
    var v = regimeViewCache && regimeViewCache.get(A);
    if (!v) { v = RV.regimeView(E, A); if (regimeViewCache) regimeViewCache.set(A, v); }
    return v;
  }

  var lastQuestion = null;
  function onAnalysis(ev) {
    try {
      var d = ev && ev.detail;
      if (!d || !d.A || !d.E) return;
      var doc = root.document;
      if (!Array.isArray(d.A.setups)) { hideCard(doc); return; } // análise de setup próprio (A.setup) não tem o banco de 8
      // o modelo vem antes do cartão: análise sem setups ou sem recorte por regime não cria cartão vazio
      var view = d.view || viewOf(d.E, d.A);
      var m = view ? model(d.E, d.A, view) : null;
      if (!m || !m.rows.length) { hideCard(doc); return; }
      var card = ensureCard(doc);
      if (!card) return;
      var question = metaText(d.A);
      render(card, m, { meta: question });
      // entrada em escada só quando a pergunta muda (ativo, tempo gráfico ou regra de saída); a atualização
      // automática e o clique numa célula redesenham sem animar
      var M = root.ArgosMotion;
      if (M && M.stagger && question !== lastQuestion) M.stagger(card, 'button.hm-cell', { step: 20, max: 780, kind: 'fade' });
      lastQuestion = question;
    } catch (e) {
      hideCard(root.document); // mapa da série anterior seria dado velho: esconde
      if (root.console && root.console.warn) root.console.warn('ArgosHeatmap:', e);
    }
  }

  var api = { model: model, colorFor: colorFor, render: render };
  root.ArgosHeatmap = api;
  if (root.document && root.document.addEventListener) root.document.addEventListener('argos:analysis', onAnalysis);

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
