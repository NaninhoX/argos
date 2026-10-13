/* =====================================================================
   ARGOS · Movimento (fundação)
   Três famílias e só três: interface (160 ms), revelação (240–360 ms) e
   crescimento de dado (360–480 ms). Só transform e opacity. Determinístico.
   Sem este arquivo, ou com movimento desligado, todo o conteúdo fica visível:
   o estado inicial escondido só vale com <html class="motion-ok">.

   Desliga com prefers-reduced-motion ou ?motion=off. ?motion=freeze:<ms>
   leva as sequências a um instante fixo e para (conferência por quadros).

   Número estatístico nunca conta de zero: countUp só aceita contagem inteira
   e termina no texto original.
   ===================================================================== */
(function (root) {
  'use strict';
  var win = root.window || root, doc = win.document;

  var DUR = { ui: 160, reveal: 320, data: 420, count: 700 };
  var SEEN_KEY = 'argos.motion.seen';

  // ------------------------------------------------------------ puro (testado em tests/motion.test.js)
  /** Lê ?motion= e a preferência do sistema. @returns {{mode: 'on'|'off'|'freeze', freezeMs: number|null}} */
  function parseMode(search, reduced) {
    var m = /[?&]motion=([^&#]*)/.exec(String(search || ''));
    var v = m ? decodeURIComponent(m[1]).toLowerCase() : '';
    if (v === 'off' || v === '0') return { mode: 'off', freezeMs: null };
    var f = /^freeze:(\d{1,6})$/.exec(v);
    if (f) return { mode: 'freeze', freezeMs: Number(f[1]) };
    if (reduced) return { mode: 'off', freezeMs: null };
    return { mode: 'on', freezeMs: null };
  }

  /**
   * Aceita só contagem inteira ("72", "42.489", "N 1.204 gatilhos"). Recusa decimal ("54,8", "0,003", "1.1"),
   * porcentagem, p.p. e texto com mais de um número: taxa, p, IC e Brier não são contagem.
   * @returns {{value: number, prefix: string, suffix: string}|null}
   */
  function parseCount(text) {
    var s = String(text == null ? '' : text);
    var m = /^(\D*)(\d{1,3}(?:\.\d{3})+|\d+)(\D*)$/.exec(s);
    if (!m) return null;
    var prefix = m[1], digits = m[2], suffix = m[3];
    if (/%|p\.\s*p\.|‰/.test(suffix)) return null;
    if (/[−\-+]\s*$/.test(prefix) || /[=<>≤≥≈~]\s*$/.test(prefix)) return null;
    if (digits.length > 1 && digits.charAt(0) === '0') return null;
    var value = Number(digits.replace(/\./g, ''));
    if (!Number.isSafeInteger(value)) return null;
    return { value: value, prefix: prefix, suffix: suffix };
  }

  /** Inteiro no formato pt-BR, com ponto de milhar. */
  function formatCount(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /** Valor do contador no progresso t (0 a 1): saída suave, inteiro, nunca passa do alvo e termina nele. */
  function countAt(target, t) {
    if (!(t > 0)) return 0;
    if (t >= 1) return target;
    var eased = 1 - Math.pow(1 - t, 3);
    return Math.min(target, Math.floor(target * eased));
  }

  /** Quantos caracteres de um texto de tamanho n já aparecem no progresso t (linear, termina em n). */
  function typedAt(n, t) {
    if (!(t > 0)) return 0;
    if (t >= 1) return n;
    return Math.min(n, Math.floor(n * t));
  }

  var pure = { DUR: DUR, parseMode: parseMode, parseCount: parseCount, formatCount: formatCount, countAt: countAt, typedAt: typedAt };
  if (!doc) { root.ArgosMotion = pure; return; }

  // ------------------------------------------------------------ estado
  var html = doc.documentElement;
  var reduced = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var st = parseMode(win.location && win.location.search, reduced);
  var supported = typeof win.IntersectionObserver === 'function' && typeof win.requestAnimationFrame === 'function';
  if (!supported && st.mode !== 'off') st = { mode: 'off', freezeMs: null };
  var enabled = st.mode !== 'off', frozen = st.mode === 'freeze';

  function readSeen() { try { return JSON.parse(win.sessionStorage.getItem(SEEN_KEY) || '[]'); } catch (e) { return []; } }
  var seen = readSeen();

  html.classList.add(enabled ? 'motion-ok' : 'motion-off');
  if (frozen) html.classList.add('motion-freeze');
  if (enabled) seen.forEach(function (k) { if (/^[\w-]+$/.test(k)) html.classList.add('m-seen-' + k); });

  /** Verdadeiro só na primeira chamada de cada chave por visita (aba). Com movimento desligado, sempre falso. */
  function once(key) {
    if (!enabled) return false;
    if (frozen) return true;
    if (seen.indexOf(key) >= 0) return false;
    seen.push(key);
    try { win.sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) { /* aba privada: vale só nesta página */ }
    return true;
  }

  function list(target, scope) {
    if (!target) return [];
    if (typeof target === 'string') return Array.prototype.slice.call((scope || doc).querySelectorAll(target));
    if (target.nodeType === 1) return [target];
    return Array.prototype.slice.call(target);
  }

  // ------------------------------------------------------------ revelação ao rolar
  var io = null;
  function observer() {
    if (io) return io;
    io = new win.IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        var cb = en.target.__argosOnSeen; en.target.__argosOnSeen = null;
        en.target.classList.add('is-in');
        if (cb) { try { cb(en.target); } catch (e) { /* a animação nunca derruba a página */ } }
      });
    }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });
    return io;
  }

  /** Chama cb uma única vez quando o elemento entra na tela (de imediato com movimento desligado). */
  function whenSeen(el, cb) {
    if (!el) return;
    if (!enabled || frozen) { el.classList.add('is-in'); if (cb) cb(el); return; }
    if (el.classList.contains('is-in')) return;
    el.__argosOnSeen = cb || null;
    observer().observe(el);
  }

  /** Liga os [data-reveal] de dentro de scope: cada um entra uma vez, ao chegar na tela. */
  function reveal(scope) {
    list('[data-reveal]:not(.is-in)', scope || doc).forEach(function (el) { whenSeen(el); });
  }

  /** Marca os itens de um contêiner como [data-reveal] com índice --i (atraso em escada) e os revela juntos. */
  function stagger(container, selector, opts) {
    var items = list(selector, container), o = opts || {};
    if (!container || !items.length || !enabled || frozen) return;
    var step = o.step == null ? 60 : o.step, cap = o.max == null ? 600 : o.max, last = Math.min((items.length - 1) * step, cap);
    items.forEach(function (el, i) {
      el.classList.remove('is-in');
      el.setAttribute('data-reveal', o.kind || '');
      el.style.setProperty('--m-delay', Math.min(i * step, cap) + 'ms');
    });
    container.classList.remove('is-in');
    whenSeen(container, function () {
      void container.offsetWidth; // o estado escondido precisa existir antes da entrada
      items.forEach(function (el) { el.classList.add('is-in'); });
      // terminada a entrada, o item volta a ser um elemento comum (transições próprias, hover)
      win.setTimeout(function () {
        items.forEach(function (el) { el.removeAttribute('data-reveal'); el.classList.remove('is-in'); el.style.removeProperty('--m-delay'); });
      }, last + DUR.reveal + 120);
    });
  }

  // ------------------------------------------------------------ sequências (linha do tempo determinística)
  function finish(container, instant) {
    if (!container) return;
    if (instant) container.classList.add('seq-instant');
    list('[data-step]', container).forEach(function (el) { el.classList.add('is-in'); });
    container.classList.add('seq-done');
    container.__argosSeq = 'done';
  }

  /**
   * Roda passos em instantes fixos. steps: [{ at: ms, el: seletor|elemento|lista, cls: 'is-in', run: fn }].
   * Com movimento desligado, aplica tudo de imediato. Em freeze, aplica os passos até o instante pedido e para.
   * Se algo falhar, o contêiner termina visível.
   */
  function sequence(container, steps, opts) {
    var o = opts || {};
    if (!container || container.__argosSeq === 'running' || container.__argosSeq === 'done') return;
    container.__argosSeq = 'running';
    var ordered = (steps || []).slice().sort(function (a, b) { return a.at - b.at; });
    var total = ordered.length ? ordered[ordered.length - 1].at : 0;
    var touched = [];
    function show(s, delay) {
      try {
        list(s.el, container).forEach(function (el) {
          if (delay) { el.style.setProperty('--m-delay', s.at + 'ms'); touched.push(el); }
          el.classList.add(s.cls || 'is-in');
        });
      } catch (e) { /* segue para o próximo passo */ }
    }
    function run(s) { if (s.run) { try { s.run(container); } catch (e) { /* idem */ } } }
    function end() {
      touched.forEach(function (el) { el.style.removeProperty('--m-delay'); });
      finish(container, false);
      if (o.onDone) { try { o.onDone(container); } catch (e) { /* idem */ } }
    }
    if (!enabled) { container.classList.add('seq-instant'); ordered.forEach(function (s) { show(s, false); run(s); }); end(); return; }
    if (frozen) {
      container.classList.add('seq-instant');
      ordered.forEach(function (s) { if (s.at <= st.freezeMs) { show(s, false); run(s); } });
      if (st.freezeMs >= total + (o.tail || 0)) end();
      return;
    }
    // Os passos visuais entram por atraso em CSS (--m-delay): a troca de classe é uma só e o compositor cuida do
    // tempo, mesmo com a thread principal ocupada pelo motor. Só os run() usam temporizador.
    void container.offsetWidth; // o estado escondido precisa existir antes da troca
    ordered.forEach(function (s) { if (s.el) show(s, true); if (s.run) win.setTimeout(function () { run(s); }, s.at); });
    win.setTimeout(end, total + (o.tail == null ? DUR.reveal + 80 : o.tail));
  }

  /** Avisa que um script vai rodar esta sequência mais tarde (ao entrar na tela, por exemplo): a rede de segurança não a encerra. */
  function claim(container) { if (container && !container.__argosSeq) container.__argosSeq = 'armed'; }

  // Rede de segurança: sequência declarada no HTML que nenhum script assumiu termina visível.
  function sweep() { list('[data-seq]').forEach(function (c) { if (!c.__argosSeq) finish(c, true); }); }

  // ------------------------------------------------------------ contador e digitação
  function animate(ms, frame, done) {
    if (!enabled) { done(); return; }
    if (frozen) { frame(Math.min(1, ms ? st.freezeMs / ms : 1)); if (st.freezeMs >= ms) done(); return; }
    var t0 = null;
    function tick(now) {
      if (t0 === null) t0 = now;
      var t = Math.min(1, (now - t0) / ms);
      if (t < 1) { frame(t); win.requestAnimationFrame(tick); } else { done(); }
    }
    win.requestAnimationFrame(tick);
  }

  /** Conta de zero até a contagem inteira do elemento e devolve o texto original, exato. Recusa o que não for inteiro. */
  function countUp(el, opts) {
    if (!el || el.__argosCount) return false;
    var original = el.textContent, c = parseCount(original);
    if (!c) return false;
    el.__argosCount = true;
    var o = opts || {}, ms = o.ms || DUR.count;
    if (!enabled) return true;
    // largura final travada: a contagem não empurra o texto vizinho
    var w = el.getBoundingClientRect().width, prev = { d: el.style.display, w: el.style.minWidth };
    if (w > 0) { if (win.getComputedStyle(el).display === 'inline') el.style.display = 'inline-block'; el.style.minWidth = w + 'px'; }
    el.setAttribute('aria-label', original);
    animate(ms, function (t) { el.textContent = c.prefix + formatCount(countAt(c.value, t)) + c.suffix; }, function () {
      el.textContent = original; el.style.display = prev.d; el.style.minWidth = prev.w; el.removeAttribute('aria-label');
    });
    return true;
  }

  /** Liga countUp em cada [data-count] de scope, quando o elemento entra na tela. */
  function counts(scope) {
    list('[data-count]', scope || doc).forEach(function (el) { if (!el.__argosCount) whenSeen(el, function () { countUp(el); }); });
  }

  /** Mostra text caractere a caractere em até ms, sem mexer no tamanho da caixa; termina com o texto exato. */
  function typeText(el, text, ms) {
    if (!el) return;
    var full = String(text), token = (el.__argosType = (el.__argosType || 0) + 1);
    function set(n) {
      if (el.__argosType !== token) return;
      if (n >= full.length) { el.textContent = full; return; }
      el.textContent = '';
      var a = doc.createElement('span'), b = doc.createElement('span');
      a.textContent = full.slice(0, n); b.textContent = full.slice(n); b.style.visibility = 'hidden';
      a.setAttribute('aria-hidden', 'true'); b.setAttribute('aria-hidden', 'true');
      el.appendChild(a); el.appendChild(b);
    }
    el.setAttribute('aria-label', full);
    animate(ms == null ? 600 : ms, function (t) { set(typedAt(full.length, t)); }, function () { if (el.__argosType === token) { el.textContent = full; el.removeAttribute('aria-label'); } });
  }

  /** setTimeout que respeita o desligamento (roda de imediato) e o freeze (roda só se o instante já passou). */
  function after(ms, fn) {
    if (!enabled) { fn(); return; }
    if (frozen) { if (st.freezeMs >= ms) fn(); return; }
    win.setTimeout(fn, ms);
  }

  function boot() {
    reveal(doc); counts(doc);
    if (!enabled || frozen) { win.setTimeout(sweep, 0); return; }
    win.setTimeout(sweep, 2500);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();

  root.ArgosMotion = {
    DUR: DUR, enabled: enabled, frozen: frozen, mode: st.mode, freezeMs: st.freezeMs,
    parseMode: parseMode, parseCount: parseCount, formatCount: formatCount, countAt: countAt, typedAt: typedAt,
    once: once, whenSeen: whenSeen, reveal: reveal, stagger: stagger, claim: claim, sequence: sequence, finish: finish,
    countUp: countUp, counts: counts, typeText: typeText, after: after
  };
})(typeof window !== 'undefined' ? window : globalThis);
