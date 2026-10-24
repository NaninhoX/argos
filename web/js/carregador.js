// Carregador da plataforma (ADR 0011): a landing não baixa a plataforma. Na primeira vez que alguém abre a plataforma
// (botão Plataforma, link "Ao vivo" ou endereço #ao-vivo, #sandbox...), entram o gráfico, o motor, as telas e só as
// séries de candles necessárias; as outras séries vêm depois, em segundo plano.
// Global ArgosCarga: plataforma() → Promise (resolve com a plataforma iniciada); serie(sym, tf) → Promise.
// Os endereços abaixo são literais de propósito: tools/versionar-web.mjs acrescenta ?v=<hash> a cada um no deploy.
(function (root) {
  'use strict';
  var doc = root.document;
  // na ordem em que precisam rodar (cada um depende de globais dos anteriores)
  var NUCLEO_ANTES = [
    'js/vendor/lightweight-charts.js', 'data/study.js', 'js/engine.js', 'js/regime-view.js', 'js/pine-reader.js',
    'js/analysis-summary.js', 'js/url-state.js' // js/config.js já vem com a landing (o formulário de contato usa)
  ];
  var NUCLEO_DEPOIS = ['js/live.js', 'js/heatmap.js', 'js/platform.js']; // platform-motion.js já vem com a landing
  var SERIES = {
    BTCUSDT_1h: 'data/snapshot/BTCUSDT_1h.js', BTCUSDT_4h: 'data/snapshot/BTCUSDT_4h.js', BTCUSDT_1d: 'data/snapshot/BTCUSDT_1d.js',
    ETHUSDT_1h: 'data/snapshot/ETHUSDT_1h.js', ETHUSDT_4h: 'data/snapshot/ETHUSDT_4h.js', ETHUSDT_1d: 'data/snapshot/ETHUSDT_1d.js',
    SOLUSDT_1h: 'data/snapshot/SOLUSDT_1h.js', SOLUSDT_4h: 'data/snapshot/SOLUSDT_4h.js', SOLUSDT_1d: 'data/snapshot/SOLUSDT_1d.js'
  };
  var DIARIAS = ['BTCUSDT_1d', 'ETHUSDT_1d', 'SOLUSDT_1d']; // a tela Regime usa as três desde o início

  var pedidos = {};
  /** Injeta um script (ordem de execução preservada entre os injetados) e devolve uma Promise do carregamento. */
  function script(src) {
    if (pedidos[src]) return pedidos[src];
    pedidos[src] = new Promise(function (ok, falha) {
      var s = doc.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () { ok(); };
      s.onerror = function () { delete pedidos[src]; falha(new Error('não carregou ' + src)); };
      doc.body.appendChild(s);
    });
    return pedidos[src];
  }
  function temSerie(k) { var S = root.ARGOS_SNAPSHOT; return !!(S && S.series && S.series[k]); }
  function serie(sym, tf) {
    var k = sym + '_' + tf;
    if (temSerie(k)) return Promise.resolve();
    if (!SERIES[k]) return Promise.reject(new Error('série desconhecida: ' + k));
    return script(SERIES[k]);
  }
  /** Série que o endereço pede (?symbol=&tf=, ver js/url-state.js); sem pedido válido, BTC 4h, o padrão da tela Ao vivo. */
  function seriePedida() {
    var q = (root.location.search || '') + '&' + (root.location.hash.split('?')[1] || '');
    var s = /[?&]symbol=(BTCUSDT|ETHUSDT|SOLUSDT)\b/.exec(q), t = /[?&]tf=(1h|4h|1d)\b/.exec(q);
    return (s ? s[1] : 'BTCUSDT') + '_' + (t ? t[1] : '4h');
  }

  var plataformaPronta = null;
  function plataforma() {
    if (plataformaPronta) return plataformaPronta;
    var iniciais = [seriePedida()].concat(DIARIAS).filter(function (k, i, a) { return a.indexOf(k) === i; });
    // tudo injetado de uma vez, com async=false: baixa em paralelo e roda na ordem da lista
    var todos = NUCLEO_ANTES.concat(iniciais.map(function (k) { return SERIES[k]; }), NUCLEO_DEPOIS);
    plataformaPronta = Promise.all(todos.map(script)).then(function () {
      if (root.ArgosLive) root.ArgosLive.init();
      // o resto das séries em segundo plano, para a troca de ativo ou tempo gráfico não esperar a rede
      var resto = Object.keys(SERIES).filter(function (k) { return iniciais.indexOf(k) < 0; });
      var depois = root.requestIdleCallback || function (f) { return setTimeout(f, 1500); };
      depois(function () { resto.forEach(function (k) { script(SERIES[k]).catch(function () { /* a série é pedida de novo quando for usada */ }); }); });
    });
    plataformaPronta.catch(function () { plataformaPronta = null; }); // falha de rede: o próximo clique tenta de novo
    return plataformaPronta;
  }

  root.ArgosCarga = { plataforma: plataforma, serie: serie, arquivos: { nucleo: NUCLEO_ANTES.concat(NUCLEO_DEPOIS), series: SERIES } };
})(window);
