// Tabela dos 72 testes (landing, "Ver os 72 testes em tabela"): ordenar por coluna, filtrar por veredito e por série
// e exportar em CSV. Melhora a tabela estática que já está no HTML (sem JavaScript ela continua inteira e legível);
// não calcula nada: só reordena, esconde e copia o texto das células.
// Funções puras (sortKey, toCSV) ficam expostas para os testes (tests/tabela-72.test.js).
(function (root) {
  'use strict';

  /**
   * Chave de ordenação do texto de uma célula, em pt-BR.
   * "1.569 (1.569)" → 1569; "20,7%" → 20.7; "17,7%–24,1%" → 17.7 (o limite inferior); "< 0,001" → 0.0009;
   * texto sem número → o próprio texto, em minúsculas.
   * @param {string} text
   * @returns {number|string}
   */
  function sortKey(text) {
    var t = String(text == null ? '' : text).trim();
    var m = /^(<\s*)?(-|−)?([\d.]+(?:,\d+)?)/.exec(t);
    if (!m) return t.toLowerCase();
    var n = parseFloat(m[3].replace(/\./g, '').replace(',', '.'));
    if (m[2]) n = -n;
    if (m[1]) n = n - n / 10; // "< 0,001" vem antes de 0,001
    return n;
  }

  function compare(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'number') return -1;
    if (typeof b === 'number') return 1;
    return a.localeCompare(b, 'pt-BR');
  }

  /**
   * CSV (separador ponto e vírgula, como o Excel em português espera) de um cabeçalho e linhas de texto.
   * Campos com ; aspas ou quebra de linha vão entre aspas. Começa com BOM para o Excel ler os acentos.
   * @param {string[]} head
   * @param {string[][]} rows
   * @returns {string}
   */
  function toCSV(head, rows) {
    var q = function (v) {
      var s = String(v == null ? '' : v);
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + [head].concat(rows).map(function (r) { return r.map(q).join(';'); }).join('\r\n') + '\r\n';
  }

  function cellsOf(tr) { return Array.prototype.map.call(tr.cells, function (td) { return td.textContent.trim(); }); }

  function enhance(table) {
    if (!table || table.getAttribute('data-tabela72') === 'ok') return;
    var doc = table.ownerDocument;
    var tbody = table.tBodies[0];
    var ths = Array.prototype.slice.call(table.tHead.rows[0].cells);
    var head = ths.map(function (th) { return th.textContent.trim(); });
    var rows = Array.prototype.slice.call(tbody.rows);
    rows.forEach(function (tr, i) { tr.setAttribute('data-ordem', String(i)); });
    var iSerie = head.indexOf('Série'), iVer = head.indexOf('Veredito');
    var sortState = { col: -1, dir: 1 };

    // barra de comandos: filtros, contagem e exportação
    var bar = doc.createElement('div');
    bar.className = 'mx-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Filtrar e exportar os 72 testes');
    function select(label, values) {
      var wrap = doc.createElement('label');
      wrap.className = 'mx-filter';
      var span = doc.createElement('span');
      span.textContent = label;
      var sel = doc.createElement('select');
      var all = doc.createElement('option');
      all.value = ''; all.textContent = 'Todos';
      sel.appendChild(all);
      values.forEach(function (v) { var o = doc.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
      wrap.appendChild(span); wrap.appendChild(sel);
      bar.appendChild(wrap);
      return sel;
    }
    var uniq = function (i) {
      var seen = []; rows.forEach(function (tr) { var v = tr.cells[i].textContent.trim(); if (seen.indexOf(v) < 0) seen.push(v); });
      return seen;
    };
    var selVer = select('Veredito', uniq(iVer));
    var selSerie = select('Série', uniq(iSerie));
    var count = doc.createElement('span');
    count.className = 'mx-count';
    count.setAttribute('role', 'status');
    count.setAttribute('aria-live', 'polite');
    bar.appendChild(count);
    var exp = doc.createElement('button');
    exp.type = 'button';
    exp.className = 'mx-export';
    exp.textContent = 'Exportar CSV';
    bar.appendChild(exp);
    table.parentNode.parentNode.insertBefore(bar, table.parentNode);

    function visibleRows() { return Array.prototype.filter.call(tbody.rows, function (tr) { return !tr.hidden; }); }
    function applyFilter() {
      var v = selVer.value, s = selSerie.value;
      rows.forEach(function (tr) {
        tr.hidden = !!((v && tr.cells[iVer].textContent.trim() !== v) || (s && tr.cells[iSerie].textContent.trim() !== s));
      });
      var n = visibleRows().length;
      count.textContent = n === rows.length ? rows.length + ' testes' : n + ' de ' + rows.length + ' testes';
    }
    selVer.addEventListener('change', applyFilter);
    selSerie.addEventListener('change', applyFilter);

    // cabeçalhos viram botões de ordenação; aria-sort diz a ordem atual
    ths.forEach(function (th, col) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'mx-sort';
      b.textContent = head[col];
      th.textContent = '';
      th.appendChild(b);
      th.setAttribute('aria-sort', 'none');
      b.addEventListener('click', function () {
        sortState.dir = sortState.col === col ? -sortState.dir : 1;
        sortState.col = col;
        ths.forEach(function (o) { o.setAttribute('aria-sort', 'none'); });
        th.setAttribute('aria-sort', sortState.dir > 0 ? 'ascending' : 'descending');
        var ordered = rows.slice().sort(function (x, y) {
          var c = compare(sortKey(x.cells[col].textContent), sortKey(y.cells[col].textContent));
          return c * sortState.dir || (+x.getAttribute('data-ordem') - +y.getAttribute('data-ordem'));
        });
        ordered.forEach(function (tr) { tbody.appendChild(tr); });
      });
    });

    exp.addEventListener('click', function () {
      var csv = toCSV(head, visibleRows().map(cellsOf));
      var a = doc.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = 'argos-estudo-v1.1-72-testes.csv';
      doc.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    });

    applyFilter();
    table.setAttribute('data-tabela72', 'ok');
  }

  var api = { sortKey: sortKey, toCSV: toCSV, enhance: enhance };
  root.ArgosTabela72 = api;
  if (root.document && root.document.addEventListener) {
    var go = function () { enhance(root.document.querySelector('table.mx-full')); };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', go);
    else go();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
