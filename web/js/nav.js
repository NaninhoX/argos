  function showPage(which) {
    document.getElementById('page-landing').classList.toggle('visible', which === 'landing');
    document.getElementById('page-dashboard').classList.toggle('visible', which === 'dashboard');
    document.getElementById('nav-landing').classList.toggle('active', which === 'landing');
    document.getElementById('nav-dashboard').classList.toggle('active', which === 'dashboard');
    document.getElementById('nav-landing').setAttribute('aria-pressed', which === 'landing' ? 'true' : 'false');
    document.getElementById('nav-dashboard').setAttribute('aria-pressed', which === 'dashboard' ? 'true' : 'false');
    window.scrollTo(0, 0);
    if (which === 'dashboard') { var cur = document.querySelector('.dash-screen.visible'); if (cur) afterTab(cur.id.replace('dash-', '')); }
  }
  function afterTab(screen) {
    if (screen === 'live' && window.ArgosLive) window.ArgosLive.onShow();
    if (window.ArgosPlatform) window.ArgosPlatform.onTab(screen);
    // argos:screen (saída): a tela `screen` da plataforma acabou de ficar visível. Gancho para o movimento.
    try { document.dispatchEvent(new CustomEvent('argos:screen', { detail: { screen: screen } })); } catch (e) { /* sem CustomEvent */ }
  }
  // Abas da plataforma: role="tablist" no <nav>, role="tab" em cada link, aria-selected e tabindex acompanham a aba aberta.
  function switchDashTab(screen) {
    document.querySelectorAll('.dashboard-page nav.tabs a').forEach(function (a) {
      var on = a.getAttribute('data-screen') === screen;
      a.classList.toggle('active', on);
      a.setAttribute('aria-selected', on ? 'true' : 'false');
      a.setAttribute('tabindex', on ? '0' : '-1');
    });
    document.querySelectorAll('.dash-screen').forEach(function (s) { s.classList.remove('visible'); });
    document.getElementById('dash-' + screen).classList.add('visible');
    window.scrollTo(0, 0);
    afterTab(screen);
  }
  var dashTabs = Array.prototype.slice.call(document.querySelectorAll('.dashboard-page nav.tabs a'));
  dashTabs.forEach(function (tab, i) {
    tab.setAttribute('href', '#' + tab.getAttribute('data-screen'));
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
  function openLive() { showPage('dashboard'); switchDashTab('live'); }
  function openTab(screen) { showPage('dashboard'); switchDashTab(screen); }
  function openCase(sym, tf, id) { openLive(); if (window.ArgosLive && window.ArgosLive.openCase) window.ArgosLive.openCase(sym, tf, id); }
