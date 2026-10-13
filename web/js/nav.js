  function showPage(which) {
    document.getElementById('page-landing').classList.toggle('visible', which === 'landing');
    document.getElementById('page-dashboard').classList.toggle('visible', which === 'dashboard');
    document.getElementById('nav-landing').classList.toggle('active', which === 'landing');
    document.getElementById('nav-dashboard').classList.toggle('active', which === 'dashboard');
    window.scrollTo(0, 0);
    if (which === 'dashboard') { var cur = document.querySelector('.dash-screen.visible'); if (cur) afterTab(cur.id.replace('dash-', '')); }
  }
  function afterTab(screen) {
    if (screen === 'live' && window.ArgosLive) window.ArgosLive.onShow();
    if (window.ArgosPlatform) window.ArgosPlatform.onTab(screen);
  }
  function switchDashTab(screen) {
    document.querySelectorAll('.dashboard-page nav.tabs a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-screen') === screen); });
    document.querySelectorAll('.dash-screen').forEach(function (s) { s.classList.remove('visible'); });
    document.getElementById('dash-' + screen).classList.add('visible');
    window.scrollTo(0, 0);
    afterTab(screen);
  }
  document.querySelectorAll('.dashboard-page nav.tabs a').forEach(function (tab) {
    tab.setAttribute('href', '#' + tab.getAttribute('data-screen'));
    tab.addEventListener('click', function (e) { e.preventDefault(); switchDashTab(this.getAttribute('data-screen')); });
  });
  function openLive() { showPage('dashboard'); switchDashTab('live'); }
  function openTab(screen) { showPage('dashboard'); switchDashTab(screen); }
  function openCase(sym, tf, id) { openLive(); if (window.ArgosLive && window.ArgosLive.openCase) window.ArgosLive.openCase(sym, tf, id); }
