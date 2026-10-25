/* =====================================================================
   ARGOS · Formulário de contato (seção #contato da landing)
   O formulário não envia nada ao servidor: monta a mensagem e abre o aplicativo de e-mail da pessoa (mailto:),
   para o endereço de window.ARGOS_CONFIG.contatoEmail. Nada passa pelo nosso site, nada vai para o banco.
   Parte pura (validate, buildMailto) em window.ArgosContato; a ligação com a página só roda se houver DOM.
   ===================================================================== */
(function (root) {
  'use strict';

  var ASSUNTOS = { acesso: 'Acesso à plataforma', equipe: 'Conversar com a equipe' };
  var PERFIS = {
    investidor: 'Investidor ou fundo', profissional: 'Gestor ou analista profissional', trader: 'Trader por conta própria',
    pesquisador: 'Pesquisador ou acadêmico', imprensa: 'Imprensa', outro: 'Outro'
  };
  var MAX = { nome: 120, email: 254, organizacao: 120, mensagem: 800 };
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  // A pessoa não deve colar segredo ou documento: sinais óbvios barram o envio (mensagem educada, nada é guardado).
  var SEGREDO = /(sk-[a-z0-9_-]{16,}|api[_ -]?key|senha\s*[:=]|password\s*[:=]|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b)/i;

  var str = function (v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''; };

  /** @returns {{ok: boolean, errors: Record<string, string>, value: object}} */
  function validate(raw) {
    var r = raw && typeof raw === 'object' ? raw : {};
    var v = {
      assunto: Object.prototype.hasOwnProperty.call(ASSUNTOS, r.assunto) ? r.assunto : 'acesso',
      nome: str(r.nome), email: str(r.email).toLowerCase(), perfil: typeof r.perfil === 'string' ? r.perfil : '',
      organizacao: str(r.organizacao),
      // a mensagem mantém as quebras de linha (só tira espaços repetidos dentro de cada linha)
      mensagem: typeof r.mensagem === 'string' ? r.mensagem.replace(/\r\n?/g, '\n').split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).join('\n').trim() : ''
    };
    var e = {};
    if (!v.nome) e.nome = 'Diga como podemos chamar você.';
    else if (v.nome.length > MAX.nome) e.nome = 'Use até ' + MAX.nome + ' caracteres.';
    if (!v.email) e.email = 'Informe o e-mail em que você quer receber a resposta.';
    else if (v.email.length > MAX.email || !EMAIL.test(v.email)) e.email = 'Esse e-mail não parece completo. Exemplo: nome@empresa.com.br';
    if (!Object.prototype.hasOwnProperty.call(PERFIS, v.perfil)) e.perfil = 'Escolha o que melhor descreve você.';
    if (v.organizacao.length > MAX.organizacao) e.organizacao = 'Use até ' + MAX.organizacao + ' caracteres.';
    if (v.mensagem.length > MAX.mensagem) e.mensagem = 'Use até ' + MAX.mensagem + ' caracteres (hoje: ' + v.mensagem.length + ').';
    else if (SEGREDO.test([v.nome, v.organizacao, v.mensagem].join(' '))) e.mensagem = 'Parece haver senha, chave, CPF ou número de cartão no texto. Tire isso: não precisamos desses dados.';
    return { ok: Object.keys(e).length === 0, errors: e, value: v };
  }

  /** Texto do e-mail. Dados da pessoa só entram no corpo, nunca no destinatário nem em cabeçalho. */
  function buildMessage(v) {
    var lines = ['Assunto: ' + ASSUNTOS[v.assunto], 'Nome: ' + v.nome, 'E-mail para resposta: ' + v.email, 'Perfil: ' + PERFIS[v.perfil]];
    if (v.organizacao) lines.push('Organização: ' + v.organizacao);
    if (v.mensagem) lines.push('', 'O que quero ver ou resolver:', v.mensagem);
    return lines.join('\n');
  }

  /** @returns {string} URL mailto: ou '' se o destino não for um e-mail simples. */
  function buildMailto(to, v) {
    if (typeof to !== 'string' || !EMAIL.test(to) || /[\s,;<>"]/.test(to)) return '';
    var subject = 'Argos Sentinel: ' + (v.assunto === 'equipe' ? 'conversa com a equipe' : 'pedido de acesso');
    return 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(buildMessage(v).replace(/\n/g, '\r\n'));
  }

  root.ArgosContato = { validate: validate, buildMessage: buildMessage, buildMailto: buildMailto };

  // ------------------------------------------------------------ ligação com a página
  if (typeof document === 'undefined') return;
  var form = document.getElementById('contatoForm');
  if (!form) return;
  var $ = function (id) { return document.getElementById(id); };
  var destino = function () { return (root.ARGOS_CONFIG && root.ARGOS_CONFIG.contatoEmail) || ''; };
  var FIELDS = ['nome', 'email', 'perfil', 'organizacao', 'mensagem'];

  function read() {
    var chosen = form.querySelector('input[name="assunto"]:checked');
    return {
      assunto: chosen ? chosen.value : 'acesso', nome: $('ctNome').value, email: $('ctEmail').value,
      perfil: $('ctPerfil').value, organizacao: $('ctOrg').value, mensagem: $('ctMsg').value
    };
  }
  var idOf = { nome: 'ctNome', email: 'ctEmail', perfil: 'ctPerfil', organizacao: 'ctOrg', mensagem: 'ctMsg' };

  function showErrors(errors) {
    FIELDS.forEach(function (k) {
      var el = $(idOf[k]), msg = $(idOf[k] + 'Err');
      if (errors[k]) { el.setAttribute('aria-invalid', 'true'); msg.textContent = errors[k]; msg.hidden = false; }
      else { el.removeAttribute('aria-invalid'); msg.textContent = ''; msg.hidden = true; }
    });
  }

  function setAssunto(a) {
    var r = form.querySelector('input[name="assunto"][value="' + a + '"]');
    if (r) r.checked = true;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy')); } catch (err) { reject(err); } finally { document.body.removeChild(ta); }
    });
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var res = validate(read());
    showErrors(res.errors);
    var sum = $('ctResumo');
    if (!res.ok) {
      var first = FIELDS.filter(function (k) { return res.errors[k]; });
      sum.textContent = first.length === 1 ? 'Há 1 campo para corrigir.' : 'Há ' + first.length + ' campos para corrigir.';
      sum.hidden = false;
      $(idOf[first[0]]).focus();
      return;
    }
    sum.hidden = true;
    var to = destino(), url = buildMailto(to, res.value);
    var done = $('ctFeito');
    done.hidden = false;
    $('ctEndereco').textContent = to || '(endereço ainda não configurado)';
    $('ctEndereco').href = to ? 'mailto:' + to : '#contato';
    done.dataset.msg = buildMessage(res.value);
    if (url) root.location.href = url;
    done.focus();
  });

  $('ctCopiar').addEventListener('click', function () {
    var done = $('ctFeito'), out = $('ctCopiado');
    copyText(done.dataset.msg || '').then(function () { out.textContent = 'Mensagem copiada. Cole no seu e-mail.'; }, function () { out.textContent = 'Não consegui copiar. Selecione e copie o texto abaixo.'; $('ctTexto').hidden = false; $('ctTexto').value = done.dataset.msg || ''; $('ctTexto').select(); });
  });

  // Os botões do topo da página escolhem o assunto: data-assunto="acesso" | "equipe".
  Array.prototype.forEach.call(document.querySelectorAll('[data-assunto]'), function (a) {
    a.addEventListener('click', function () { setAssunto(a.getAttribute('data-assunto')); });
  });
  // Contador de caracteres da mensagem, para a pessoa saber o limite antes de estourar.
  var msg = $('ctMsg'), cnt = $('ctMsgCount');
  var upd = function () { cnt.textContent = msg.value.length + ' / ' + MAX.mensagem; };
  msg.addEventListener('input', upd); upd();
})(typeof window !== 'undefined' ? window : globalThis);
