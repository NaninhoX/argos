// Interações do site que não dependem da plataforma (ADR 0011: a landing não carrega a plataforma):
// detalhe da célula da matriz do estudo, dicas (data-tip) da página inteira e leitura do gráfico móvel de calibração.
// Saiu de js/platform.js sem mudança de comportamento; as dicas valem também para as telas da plataforma.
(function () {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TONE = { EDGE: 'good', EDGE_SENSIVEL: 'warn', ABAIXO: 'bad', SEM_EDGE: 'muted', INSUFICIENTE: 'neutral' };
  const $ = (id) => document.getElementById(id);

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

  function boot() { siteInit(); tipInit(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
