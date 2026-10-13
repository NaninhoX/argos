/* Argos · movimento da plataforma (módulos que se penduram em eventos, sem tocar em live.js nem platform.js).
   Depende de window.ArgosMotion (js/motion.js); sem ele, ou com movimento desligado, nada aqui roda.
   Eventos: argos:screen (nav.js: uma tela ficou visível) e argos:result (platform.js: resultado novo desenhado).
   O módulo dos gráficos de calibração vale também para os gráficos estáticos do site. */

// ============================================================ 11 · entrada da tela Ao vivo
/* Argos · movimento da plataforma · live-enter. Depende de window.ArgosMotion (js/motion.js); sem ele, ou com movimento
   desligado, a tela Ao vivo aparece normal.

   Na primeira vez que a tela "Ao vivo" fica visível neste carregamento de página, os blocos principais entram em escada,
   de cima para baixo (fade e 12 px, por transition-delay). nav.js avisa cada troca de tela com argos:screen; só 'live' vale.

   Seleção: um elemento nunca entra junto com um descendente dele. Por isso o banco entra em duas partes (cabeçalho e
   cartão), e não como seção inteira: o cartão do mapa de calor (#lvHeatmap, criado depois, com animação própria) fica
   dentro da seção do banco e fica de fora. #lvDetail é irmão do cartão do banco e entra como bloco próprio.
   Determinístico: sem acaso e sem tempo sorteado. */
(function () {
  'use strict';
  var M = window.ArgosMotion;
  if (!M || !M.enabled || !M.stagger) return;

  // A ordem da escada é a ordem do DOM (querySelectorAll devolve os itens na ordem do documento).
  var STEPS = [
    '.live-head',
    '.controls',
    '.chart-card',
    '#lvRead',
    '#lvPipeCard',
    'section.block[aria-labelledby="lvBankH"] > .block-h',
    'section.block[aria-labelledby="lvBankH"] > .card:not(.hm-card):not(.detail)',
    '#lvDetail',
    'section.block[aria-labelledby="lvRepH"]'
  ];

  // Uma vez por carregamento de página: variável local, não a chave de sessionStorage do M.once.
  var played = false;

  function enter() {
    if (played) return;
    played = true;
    try {
      var box = document.getElementById('dash-live');
      if (!box) return;
      M.stagger(box, STEPS.join(', '), { step: 70, max: 420 });
    } catch (e) { /* a animação nunca derruba a página */ }
  }

  document.addEventListener('argos:screen', function (ev) {
    if (ev && ev.detail && ev.detail.screen === 'live') enter();
  });
})();

// ============================================================ 12 · entrada das outras telas e dos resultados novos
/* Argos · movimento da plataforma · screens. Depende de window.ArgosMotion (js/motion.js); sem ele, ou com
   movimento desligado, a plataforma funciona igual, só sem movimento.

   Duas coisas, e só estas:
   1. Entrada das telas. Na primeira vez que Sandbox, Query, Regime ou Calibração fica visível (uma vez por tela, por
      carregamento da página), os blocos de primeiro nível entram em escada, de cima para baixo. Gatilho: argos:screen
      (js/nav.js). A tela 'live' tem movimento próprio e fica de fora.
   2. Resultado novo. No Sandbox e no Query, os filhos diretos da área de resultado entram em escada. Gatilho:
      argos:result (js/platform.js). A Calibração fica de fora deste gatilho.

   Os seletores são uma string por tela, na ordem do DOM. Nenhum item contém outro (senão o fade dobra). As áreas de
   resultado escondidas (#sbResults, #qOut) ficam fora da entrada: entram só pelo evento de resultado.
   Usa só ArgosMotion.stagger: transform e opacity, atraso por --m-delay, sem acaso e sem número novo. */
(function () {
  'use strict';
  var M = window.ArgosMotion;
  if (!M || !M.enabled || !M.stagger) return;
  var doc = document;

  /** Blocos de primeiro nível de cada tela, relativos ao contêiner da tela (#dash-<tela>). */
  var ENTRY = {
    sandbox: '.wrap > .page-header, .wrap > .section-label, .wrap > .sb-editor, .wrap > .config-card, .wrap > .saved-section',
    query: '.wrap > .page-header, .wrap > .layout > aside, #qEmpty',
    regime: '.wrap > .page-header, .wrap > .regime-src, .wrap > .regime-cards, .wrap > .section-label, .wrap > #lvRegimeInterp, .wrap > .tree-card, .wrap > .regime-note',
    calibration: '.wrap > .page-header, .wrap > .pv-cbar, .wrap > .pv-stats, .wrap > .pv-chart, .wrap > .pv-two, .wrap > .hist-card, .wrap > .guide-card'
  };

  /** Filhos diretos da área de resultado (Sandbox e Query). */
  var RESULT_ITEMS = ':scope > *';

  /** Telas que já entraram nesta carga da página. Recarregar a página refaz a entrada, de propósito. */
  var entered = {};

  /** Se a escada falhar, o conteúdo não pode ficar escondido: tira o atributo que o esconde dos itens. */
  function unhide(container, selector) {
    try {
      Array.prototype.slice.call(container.querySelectorAll(selector)).forEach(function (el) { el.removeAttribute('data-reveal'); });
    } catch (e) { /* sem efeito: o conteúdo já aparece */ }
  }

  /** Entrada da tela, na primeira vez que ela fica visível. */
  function enterScreen(screen) {
    var selector = ENTRY[screen];
    if (typeof selector !== 'string' || entered[screen]) return;
    entered[screen] = true;
    var container = doc.getElementById('dash-' + screen);
    if (!container) return;
    try { M.stagger(container, selector, { step: 70, max: 420 }); } catch (e) { unhide(container, selector); }
  }

  /** Resultado novo desenhado em root (Sandbox ou Query): os filhos diretos entram em escada. */
  function enterResult(screen, root) {
    if (screen !== 'sandbox' && screen !== 'query') return;
    if (!root) return;
    try { M.stagger(root, RESULT_ITEMS, { step: 60, max: 360 }); } catch (e) { unhide(root, RESULT_ITEMS); }
  }

  doc.addEventListener('argos:screen', function (ev) {
    try { if (ev.detail) enterScreen(ev.detail.screen); } catch (e) { /* a animação nunca derruba a página */ }
  });
  doc.addEventListener('argos:result', function (ev) {
    try { if (ev.detail) enterResult(ev.detail.screen, ev.detail.root); } catch (e) { /* idem */ }
  });
})();

// ============================================================ 13 · faixa do IC do Sandbox e do Query
/* Argos · movimento da plataforma · faixa do IC (Sandbox e Query). Depende de window.ArgosMotion (js/motion.js);
   sem ele, ou com movimento desligado, a página fica como está.

   Quando um resultado novo é desenhado (evento argos:result, disparado por platform.js), a faixa do IC 95% cresce a
   partir da posição da taxa-base e o ponto da taxa observada entra por último. Este arquivo só põe a origem da
   transformação (inline, em % da própria faixa) e a classe temporária ci-grow por 1200 ms; o visual mora em
   css/pmotion-cibar.css. Sem a classe, a faixa já está no estado final: nenhum número é alterado aqui. */
(function () {
  'use strict';
  var M = window.ArgosMotion;
  if (!M || !M.enabled) return;

  var GROW_MS = 1200;

  /** Origem da transformação: a taxa-base em % da própria faixa, de 0 a 100. Sem número válido, 0. */
  function originOf(fill, base) {
    var left = parseFloat(fill.style.left), width = parseFloat(fill.style.width);
    var at = parseFloat(base ? base.style.left : NaN);
    var o = (at - left) / width * 100;
    if (!isFinite(o)) o = 0;
    return Math.max(0, Math.min(100, o));
  }

  /** Faz a faixa crescer a partir da taxa-base. A classe sai sozinha; o estado final é o da marcação. */
  function grow(bar) {
    var fill = bar.querySelector('.ci-fill');
    if (!fill) return;
    fill.style.transformOrigin = originOf(fill, bar.querySelector('.ci-base')) + '% 50%';
    window.clearTimeout(bar.__ciGrowT);
    bar.classList.remove('ci-grow');
    void bar.offsetWidth; // reinicia a animação se a mesma barra for pedida de novo
    bar.classList.add('ci-grow');
    bar.__ciGrowT = window.setTimeout(function () { bar.classList.remove('ci-grow'); }, GROW_MS);
  }

  // Só Sandbox e Query têm faixa de IC neste movimento; a calibração segue como está.
  document.addEventListener('argos:result', function (ev) {
    try {
      var d = ev && ev.detail;
      if (!d || (d.screen !== 'sandbox' && d.screen !== 'query')) return;
      if (!d.root || typeof d.root.querySelectorAll !== 'function') return;
      Array.prototype.forEach.call(d.root.querySelectorAll('.ci-bar'), function (bar) {
        try { grow(bar); } catch (e) { /* a faixa fica no estado final */ }
      });
    } catch (e) { /* o resultado já está na tela; o movimento não derruba nada */ }
  });
})();

// ============================================================ 14 · gráficos de calibração que se desenham (site e plataforma)
/* Argos · movimento da plataforma · cal. Depende de window.ArgosMotion (js/motion.js); sem ele, ou com movimento
   desligado, os gráficos de calibração ficam como estão.

   Gráficos de calibração: svg.rel-svg (linha .rel-line, pontos .rel-pt) e svg.roll-svg (linha .roll-line, áreas
   .area-pos e .area-neg). A linha se desenha do início ao fim e, depois, pontos e áreas entram com fade.
   Este arquivo só põe as classes cal-arm e cal-go no svg e pathLength="1" na linha; o visual mora em
   css/pmotion-cal.css. Ao terminar, tira tudo: o gráfico volta a ser exatamente o da marcação. Nenhum dado é lido
   para alterar nem é alterado.

   Uma vez por gráfico: cRender recria o svg a cada abertura da aba. A assinatura da linha (d ou points) entra num
   Set do módulo quando a entrada acontece; o mesmo gráfico, desenhado de novo, fica como está. */
(function () {
  'use strict';
  var M = window.ArgosMotion;
  if (!M || !M.enabled || !M.whenSeen) return;

  var doc = document;
  var SEL = 'svg.rel-svg, svg.roll-svg';
  var GO_MS = 1000;     // a linha leva 480 ms; pontos e áreas entram até 800 ms; depois o svg volta ao original
  var seen = new Set(); // assinaturas das linhas já desenhadas nesta visita

  /** Seletor da linha de cada tipo de gráfico. */
  function lineSel(svg) { return svg.classList.contains('rel-svg') ? '.rel-line' : '.roll-line'; }

  /** Assinatura: tipo do gráfico mais a geometria da linha (d ou points). Sem geometria, null. */
  function signatureOf(svg, line) {
    var geo = line.getAttribute('d') || line.getAttribute('points');
    if (!geo) return null;
    return (svg.classList.contains('rel-svg') ? 'rel' : 'roll') + '|' + geo;
  }

  /** Tira as classes e o pathLength: o gráfico volta a ser o da marcação. */
  function reset(svg, lines) {
    svg.classList.remove('cal-arm', 'cal-go');
    lines.forEach(function (l) { l.removeAttribute('pathLength'); });
  }

  /** Dispara a entrada: a linha se desenha; pontos e áreas entram depois, por atraso no CSS. */
  function go(svg, lines, sig) {
    void svg.getBoundingClientRect(); // o estado inicial precisa estar aplicado antes da transição
    svg.classList.add('cal-go');
    seen.add(sig);
    window.setTimeout(function () { reset(svg, lines); }, GO_MS);
  }

  /** Arma um gráfico: esconde a linha e os pontos e espera o gráfico entrar na tela. */
  function arm(svg) {
    if (!svg || svg.__calSeen) return;
    svg.__calSeen = true;
    var lines = [];
    try {
      var first = svg.querySelector(lineSel(svg));
      if (!first) return; // svg sem a linha esperada: não se mexe nele
      var sig = signatureOf(svg, first);
      if (!sig || seen.has(sig)) return;
      lines = Array.prototype.slice.call(svg.querySelectorAll(lineSel(svg)));
      lines.forEach(function (l) { l.setAttribute('pathLength', '1'); });
      svg.classList.add('cal-arm');
      M.whenSeen(svg, function () {
        try { go(svg, lines, sig); } catch (e) { reset(svg, lines); }
      });
    } catch (e) {
      reset(svg, lines); // na dúvida, o gráfico fica como está
    }
  }

  /** Arma os gráficos de calibração de scope (o documento inteiro por padrão). */
  function armAll(scope) {
    var root = scope && typeof scope.querySelectorAll === 'function' ? scope : doc;
    if (scope && scope.matches && scope.matches(SEL)) arm(scope);
    Array.prototype.forEach.call(root.querySelectorAll(SEL), function (svg) { arm(svg); });
  }

  // Os gráficos da landing já estão na marcação; os da plataforma chegam com argos:result, depois de cRender.
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { armAll(doc); });
  else armAll(doc);

  doc.addEventListener('argos:result', function (ev) {
    try {
      var d = ev && ev.detail;
      if (!d || d.screen !== 'calibration') return;
      armAll(d.root);
    } catch (e) { /* o resultado já está na tela; o movimento não derruba nada */ }
  });
})();
