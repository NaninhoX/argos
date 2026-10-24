  // Endereço por tela: o hash da URL diz onde a pessoa está (#ao-vivo, #sandbox, #query, #regime, #calibracao; sem hash,
  // o site). Funciona em hospedagem estática, sem regra de reescrita, e o botão Voltar do navegador percorre as telas.
  var HASH_SCREEN = { 'ao-vivo': 'live', plataforma: 'live', live: 'live', sandbox: 'sandbox', query: 'query', regime: 'regime', calibracao: 'calibration', calibration: 'calibration' };
  var SCREEN_HASH = { live: '#ao-vivo', sandbox: '#sandbox', query: '#query', regime: '#regime', calibration: '#calibracao' };
  function setHash(h) {
    try {
      var base = location.pathname + location.search;
      if (base + h !== base + location.hash) history.pushState(history.state, '', base + h);
    } catch (e) { /* sem History API (arquivo local restrito): a navegação segue sem endereço */ }
  }
  // Lê o hash e abre a tela correspondente, sem reescrever a URL. Hash desconhecido (âncoras do site) não faz nada.
  function routeFromHash() {
    var h = (location.hash || '').replace(/^#/, ''), screen = HASH_SCREEN[h];
    if (screen) { showPage('dashboard', true); switchDashTab(screen, true); }
    else if (!h) showPage('landing', true);
  }
  window.addEventListener('popstate', routeFromHash);
  function showPage(which, silent) {
    if (!silent) {
      if (which === 'landing') setHash('');
      else { var cur0 = document.querySelector('.dash-screen.visible'); setHash((cur0 && SCREEN_HASH[cur0.id.replace('dash-', '')]) || '#ao-vivo'); }
    }
    document.getElementById('page-landing').classList.toggle('visible', which === 'landing');
    document.getElementById('page-dashboard').classList.toggle('visible', which === 'dashboard');
    document.getElementById('nav-landing').classList.toggle('active', which === 'landing');
    document.getElementById('nav-dashboard').classList.toggle('active', which === 'dashboard');
    document.getElementById('nav-landing').setAttribute('aria-pressed', which === 'landing' ? 'true' : 'false');
    document.getElementById('nav-dashboard').setAttribute('aria-pressed', which === 'dashboard' ? 'true' : 'false');
    window.scrollTo(0, 0);
    if (which === 'dashboard') { var cur = document.querySelector('.dash-screen.visible'); if (cur) afterTab(cur.id.replace('dash-', '')); }
  }
  // A plataforma é carregada na primeira abertura (js/carregador.js, ADR 0011); até lá a tela mostra o esqueleto.
  function comPlataforma(fn) {
    if (!window.ArgosCarga) { fn(); return; }
    window.ArgosCarga.plataforma().then(fn, function () {
      var t = document.getElementById('lvSrcText');
      if (t) t.textContent = 'Não foi possível carregar a plataforma. Confira a conexão e toque em Plataforma de novo.';
    });
  }
  function afterTab(screen) { comPlataforma(function () { afterTabNow(screen); }); }
  function afterTabNow(screen) {
    if (screen === 'live' && window.ArgosLive) window.ArgosLive.onShow();
    if (window.ArgosPlatform) window.ArgosPlatform.onTab(screen);
    // argos:screen (saída): a tela `screen` da plataforma acabou de ficar visível. Gancho para o movimento.
    try { document.dispatchEvent(new CustomEvent('argos:screen', { detail: { screen: screen } })); } catch (e) { /* sem CustomEvent */ }
  }
  // Abas da plataforma: role="tablist" no <nav>, role="tab" em cada link, aria-selected e tabindex acompanham a aba aberta.
  function switchDashTab(screen, silent) {
    if (!silent && SCREEN_HASH[screen]) setHash(SCREEN_HASH[screen]);
    document.querySelectorAll('.dashboard-page nav.tabs a').forEach(function (a) {
      var on = a.getAttribute('data-screen') === screen;
      a.classList.toggle('active', on);
      a.setAttribute('aria-selected', on ? 'true' : 'false');
      a.setAttribute('tabindex', on ? '0' : '-1');
    });
    // A aba aberta fica à vista na barra que rola (celular): sem barra de rolagem, é assim que a pessoa vê onde está.
    var act = document.querySelector('.dashboard-page nav.tabs a.active');
    if (act && act.scrollIntoView) { try { act.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) { /* navegador antigo */ } }
    document.querySelectorAll('.dash-screen').forEach(function (s) { s.classList.remove('visible'); });
    document.getElementById('dash-' + screen).classList.add('visible');
    window.scrollTo(0, 0);
    afterTab(screen);
  }
  var dashTabs = Array.prototype.slice.call(document.querySelectorAll('.dashboard-page nav.tabs a'));
  dashTabs.forEach(function (tab, i) {
    tab.setAttribute('href', SCREEN_HASH[tab.getAttribute('data-screen')] || '#' + tab.getAttribute('data-screen'));
    tab.addEventListener('click', function (e) { e.preventDefault(); switchDashTab(this.getAttribute('data-screen')); });
    // Teclado: setas, Home e End movem entre as abas e abrem a aba em foco; a barra de espaço também abre.
    tab.addEventListener('keydown', function (e) {
      var to = -1;
      if (e.key === 'ArrowRight') to = (i + 1) % dashTabs.length;
      else if (e.key === 'ArrowLeft') to = (i - 1 + dashTabs.length) % dashTabs.length;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = dashTabs.length - 1;
      else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); switchDashTab(this.getAttribute('data-screen')); return; }
      if (to < 0) return;
      e.preventDefault();
      switchDashTab(dashTabs[to].getAttribute('data-screen'));
      dashTabs[to].focus();
    });
  });
  function openLive() { showPage('dashboard', true); switchDashTab('live'); }
  function openTab(screen) { showPage('dashboard', true); switchDashTab(screen); }
  function openCase(sym, tf, id) { openLive(); comPlataforma(function () { if (window.ArgosLive && window.ArgosLive.openCase) window.ArgosLive.openCase(sym, tf, id); }); }
  // Botões e links do site (sem onclick no HTML, por causa da política de conteúdo): data-acao, data-caso e data-tela.
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-acao], [data-caso], [data-tela]');
    if (!el) return;
    e.preventDefault();
    if (el.hasAttribute('data-caso')) { var c = el.getAttribute('data-caso').split(','); openCase(c[0], c[1], c[2]); return; }
    if (el.hasAttribute('data-tela')) { openTab(el.getAttribute('data-tela')); return; }
    var a = el.getAttribute('data-acao');
    if (a === 'ao-vivo') openLive();
    else if (a === 'site') showPage('landing');
    else if (a === 'plataforma') showPage('dashboard');
    else if (a === 'tema' && window.ArgosTema) window.ArgosTema.alternar();
  });
