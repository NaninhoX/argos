/* Argos · movimento do site. Depende de window.ArgosMotion (js/motion.js); sem ele a página funciona igual, só sem movimento.

   Este arquivo só monta as linhas do tempo. O visual mora em css/landing-motion.css e o tempo corre por
   transition-delay (--m-delay), não por setTimeout, então não depende da thread principal.
   Entrada das seções ([data-reveal]) e contadores ([data-count]) são ligados sozinhos por motion.js.

   Sequências (ms a partir do início):
   - herói (uma vez por visita): marca 0–650, linhas do cartão 520–1240, pausa, veredito 1900, fim ~2300;
   - matriz (uma vez por visita, ao entrar na tela): legenda e onda por coluna 0–560, pausa de 500,
     as células que resistem ao ajuste 1478, fim ~2040;
   - como funciona (cada etapa, ao entrar na tela): número e linha em escada de 440 ms, fim ~1640.
   Determinístico: nenhum valor sorteado, nenhum número é calculado aqui. */
(function () {
  'use strict';
  var M = window.ArgosMotion;
  if (!M || !M.whenSeen || !M.sequence) return;
  var doc = document;

  function $(sel, scope) { return (scope || doc).querySelector(sel); }
  function all(sel, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(sel)); }
  /** Se a montagem falhar, o bloco termina visível: a animação nunca esconde conteúdo. */
  function guard(container, fn) { try { fn(); } catch (e) { M.finish(container, true); } }

  // ------------------------------------------------------------ 1. herói
  var HERO = {
    layers: [0, 90, 180, 270], // as quatro camadas da marca se assentam de baixo para cima
    gold: 330,                 // a de cima acende por último
    row0: 520, rowStep: 120,   // linhas do cartão, na ordem do HTML
    verdictGap: 660            // da última linha ao veredito: 320 de entrada + 340 de pausa
  };

  function heroSteps(hero) {
    var steps = [];
    HERO.layers.forEach(function (at, i) { steps.push({ at: at, el: '.hm-l' + (i + 1) }); });
    steps.push({ at: HERO.gold, el: '.hm-gold' });
    var rows = all('.qp-row', hero);
    rows.forEach(function (row, i) { steps.push({ at: HERO.row0 + i * HERO.rowStep, el: row }); });
    var verdictAt = HERO.row0 + Math.max(0, rows.length - 1) * HERO.rowStep + HERO.verdictGap;
    ['.qp-result', '.qp-note', '.qp-foot'].forEach(function (sel) { steps.push({ at: verdictAt, el: sel }); });
    return steps;
  }

  function setupHero() {
    var hero = $('.query-panel[data-seq="hero"]');
    if (!hero) return;
    M.claim(hero);
    // começa quando o cartão aparece (no celular ele pode estar abaixo da dobra)
    M.whenSeen(hero, function () {
      guard(hero, function () {
        if (!M.once('hero')) { M.finish(hero, true); return; }
        M.sequence(hero, heroSteps(hero), { tail: M.DUR.reveal + 80 });
      });
    });
  }

  // ------------------------------------------------------------ 3. matriz dos 72 testes
  var MX = {
    wave0: 60, col: 50, row: 14, // cada célula acende em wave0 + coluna × col + linha × row
    pause: 500,                  // entre a última célula pronta e as que resistem ao ajuste
    legend: 60,                  // legenda: itens comuns em escada
    survivorLegend: 40           // legenda das que resistem acompanha as células delas
  };

  function resists(cell) { return cell.classList.contains('v-edge') || cell.classList.contains('v-sens'); }

  function matrixSteps(card) {
    var steps = [], survivors = [], lastWave = 0;
    all('.mx-cell', card).forEach(function (cell) {
      if (resists(cell)) { survivors.push(cell); return; }
      var td = cell.parentNode, tr = td && td.parentNode;
      var col = Math.max(0, (td && td.cellIndex ? td.cellIndex : 1) - 1);
      var row = Math.max(0, tr && tr.sectionRowIndex ? tr.sectionRowIndex : 0);
      var at = MX.wave0 + col * MX.col + row * MX.row;
      if (at > lastWave) lastWave = at;
      steps.push({ at: at, el: cell, cls: 'mx-on' });
    });
    var highlightAt = lastWave + M.DUR.data + MX.pause;
    survivors.forEach(function (cell) { steps.push({ at: highlightAt, el: cell, cls: 'mx-on' }); });
    var common = 0, kept = 0;
    all('.mx-legend .lg', card).forEach(function (item) {
      if (item.querySelector('.sw.edge, .sw.sens')) steps.push({ at: highlightAt + MX.survivorLegend * (1 + kept++), el: item });
      else steps.push({ at: MX.legend * common++, el: item });
    });
    return steps;
  }

  function setupMatrix() {
    var card = $('.matrix-card[data-seq="mx"]');
    if (!card) return;
    M.claim(card);
    // a tabela inteira é gerada: nada nela muda, só as classes das células; o clique (#mxDetail) segue valendo o tempo todo
    M.whenSeen($('.mx-scroll', card) || card, function () {
      guard(card, function () {
        if (!M.once('mx')) { M.finish(card, true); return; }
        M.sequence(card, matrixSteps(card), { tail: M.DUR.data + 60 });
      });
    });
  }

  // ------------------------------------------------------------ 5. como funciona
  var HOW = { step: 440, line: 80 }; // número 01 em 0; a linha até o 02 corre de 80 a 500; o 02 acende em 440; e assim por diante

  function columnsOf(list) {
    var tracks = window.getComputedStyle(list).gridTemplateColumns;
    return tracks && tracks !== 'none' ? Math.max(1, tracks.split(/\s+/).length) : 1;
  }

  function setupHow() {
    var list = $('.how-steps[data-seq="how"]');
    if (!list || !M.enabled) return;
    var items = Array.prototype.filter.call(list.children, function (el) { return el.tagName === 'LI'; });
    M.claim(list);
    items.forEach(function (li, i) {
      // cada etapa acende quando entra na tela; em quatro colunas as quatro entram juntas e o atraso faz a escada
      M.whenSeen(li, function () {
        guard(list, function () {
          var j = i % columnsOf(list), numberAt = j * HOW.step, lineAt = numberAt + HOW.line;
          if (M.frozen) {
            if (numberAt <= M.freezeMs) li.classList.add('hw-n');
            if (lineAt <= M.freezeMs) li.classList.add('hw-l');
            return;
          }
          li.style.setProperty('--hw-nd', numberAt + 'ms');
          li.style.setProperty('--hw-ld', lineAt + 'ms');
          void list.offsetWidth; // o estado escondido precisa existir antes da troca
          li.classList.add('hw-n');
          li.classList.add('hw-l');
        });
      });
    });
  }

  // uma montagem que falhe não derruba as outras e deixa o bloco dela visível
  [[setupHero, '.query-panel[data-seq="hero"]'], [setupMatrix, '.matrix-card[data-seq="mx"]'], [setupHow, '.how-steps[data-seq="how"]']].forEach(function (job) {
    try { job[0](); } catch (e) { M.finish($(job[1]), true); }
  });
})();
