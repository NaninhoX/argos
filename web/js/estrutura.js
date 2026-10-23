// Caminho de navegação da plataforma ("Argos › Ao vivo") no topo, ao lado da marca. Acompanha a tela aberta pelo
// evento argos:screen (nav.js). O menu lateral é só CSS (css/estrutura.css): as abas existentes viram a lista lateral.
(function () {
  'use strict';
  var bar = document.querySelector('.dashboard-page .topbar-inner');
  var brand = bar && bar.querySelector('.brand');
  if (!bar || !brand) return;
  var crumb = document.createElement('nav');
  crumb.className = 'crumb';
  crumb.setAttribute('aria-label', 'Caminho');
  crumb.innerHTML = '<span>Argos</span><span class="sep" aria-hidden="true">›</span><span class="now" aria-current="page"></span>';
  brand.insertAdjacentElement('afterend', crumb);
  var now = crumb.querySelector('.now');
  function update(screen) {
    var tab = document.getElementById('tab-' + screen) || document.querySelector('.dashboard-page nav.tabs a.active');
    now.textContent = tab ? tab.textContent.trim() : '';
  }
  document.addEventListener('argos:screen', function (e) { update(e.detail && e.detail.screen); });
  update('live');
})();
