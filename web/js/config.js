/* Argos · configuração do front. Define window.ARGOS_CONFIG antes de live.js.
   llm: 'server' quando a página vem de um endereço publicado (https) e não do computador local: o relatório do Argos AI
   passa a ser pedido a /api/argos-ai (a chave do provedor fica só no servidor). Em arquivo local e em localhost o
   relatório continua sendo redigido pelo motor determinístico. Quem já definiu window.ARGOS_CONFIG antes mantém o seu valor.
   contatoEmail: endereço que recebe o formulário de contato (mailto:); nada passa pelo servidor. */
(function () {
  'use strict';
  if (window.ARGOS_CONFIG) return;
  var h = location.hostname, published = location.protocol === 'https:' && !/^(localhost|127\.|\[::1\])/.test(h);
  window.ARGOS_CONFIG = { llm: published ? 'server' : 'local', contatoEmail: '' };
})();
