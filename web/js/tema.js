// Tema do site: Papel (claro, padrão) ou escuro. Carrega no <head>, antes de desenhar, para a página não piscar.
// A escolha fica no navegador da pessoa (localStorage, quando disponível); ?tema=escuro ou ?tema=papel força um tema.
// Global ArgosTema: atual(), definir(t), alternar(), cor(nome) lê uma variável CSS do tema. Ao trocar, dispara
// argos:tema (detalhe { tema }) para os gráficos que guardam cor em JavaScript se redesenharem.
(function (root) {
  'use strict';
  var KEY = 'argos-tema';
  var doc = root.document;
  function salvo() { try { return root.localStorage.getItem(KEY); } catch (e) { return null; } }
  function guardar(t) { try { root.localStorage.setItem(KEY, t); } catch (e) { /* armazenamento bloqueado: vale só nesta visita */ } }
  function pedidoNaUrl() {
    var m = /[?&]tema=(escuro|papel)\b/.exec(root.location ? root.location.search : '');
    return m ? (m[1] === 'escuro' ? 'dark' : 'light') : null;
  }
  function aplicar(t) {
    if (t === 'dark') doc.documentElement.setAttribute('data-theme', 'dark');
    else doc.documentElement.removeAttribute('data-theme');
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0D1420' : '#F5F2EA');
    var b = doc.getElementById('nav-tema');
    if (b) {
      b.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
      b.textContent = t === 'dark' ? 'Tema claro' : 'Tema escuro';
    }
  }
  function atual() { return doc.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function definir(t) {
    t = t === 'dark' ? 'dark' : 'light';
    aplicar(t);
    guardar(t);
    try { doc.dispatchEvent(new CustomEvent('argos:tema', { detail: { tema: t } })); } catch (e) { /* sem CustomEvent */ }
  }
  function alternar() { definir(atual() === 'dark' ? 'light' : 'dark'); }
  function cor(nome) {
    try { return root.getComputedStyle(doc.documentElement).getPropertyValue(nome).trim(); } catch (e) { return ''; }
  }

  aplicar(pedidoNaUrl() || salvo() || 'light');
  // o botão fica no fim do corpo: acerta o rótulo quando a página termina de carregar
  doc.addEventListener('DOMContentLoaded', function () { aplicar(atual()); });
  root.ArgosTema = { atual: atual, definir: definir, alternar: alternar, cor: cor };
})(window);
