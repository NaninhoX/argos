/* =====================================================================
   ARGOS · Estado da análise na URL
   Módulo clássico, sem dependências, sem acesso a DOM nem a `location`.
   Expõe window.ArgosUrlState = { parse, build }.

   O link guarda a pergunta (ativo, tempo gráfico, regra de saída, janela,
   setup e recorte de regime), nunca o resultado. Valor inválido é ignorado,
   parâmetro a parâmetro; nada aqui lança erro.

   Parâmetros (mesmos nomes de /api/analyze):
     symbol  BTCUSDT | ETHUSDT | SOLUSDT
     tf      1h | 4h | 1d
     mode    atr | pct
     tgt     parâmetro de alvo da regra de saída, de 0,2 a 20 (até 4 casas)
     stp     parâmetro de stop da regra de saída, de 0,2 a 20 (até 4 casas)
     hold    prazo em candles, inteiro de 2 a 60
     win     janela em dias, inteiro de 30 a 5000 (ausente = série inteira)
     setup   id de setup do motor (ex.: RSI_OVERSOLD)
     regime  ALL | CURRENT | código de regime (ausente = ALL)
   Parâmetro repetido: vale o primeiro. Maiúsculas e minúsculas são aceitas
   e normalizadas.
   ===================================================================== */
(function (root) {
  'use strict';

  const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const TIMEFRAMES = ['1h', '4h', '1d'];
  const MODES = ['atr', 'pct'];
  const REGIMES = ['ALL', 'CURRENT', 'BULL_TREND', 'BEAR_TREND', 'HIGH_VOL_RANGING', 'LOW_VOL_RANGING', 'STRUCTURAL_BREAK'];
  const SETUP_RE = /^[A-Z][A-Z0-9_]{1,39}$/;
  const KEYS = ['symbol', 'tf', 'mode', 'tgt', 'stp', 'hold', 'win', 'setup', 'regime'];
  const MAX_SEARCH = 4096; // acima disto a consulta inteira é tratada como hostil
  const MAX_VALUE = 64;

  /** Valor textual de tamanho razoável, ou undefined. */
  const text = (v) => (typeof v === 'string' && v.length > 0 && v.length <= MAX_VALUE ? v : undefined);

  function choice(v, list, fold) {
    const s = text(v);
    if (s === undefined) return undefined;
    const n = fold === 'lower' ? s.toLowerCase() : s.toUpperCase();
    return list.indexOf(n) >= 0 ? n : undefined;
  }
  /** Decimal sem sinal nem expoente, até 4 casas, dentro de [lo, hi]. */
  function decimal(v, lo, hi) {
    const s = text(v);
    if (s === undefined || !/^\d{1,2}(\.\d{1,4})?$/.test(s)) return undefined;
    const x = Number(s);
    return x >= lo && x <= hi ? x : undefined;
  }
  function integer(v, lo, hi) {
    const s = text(v);
    if (s === undefined || !/^\d{1,4}$/.test(s)) return undefined;
    const x = Number(s);
    return x >= lo && x <= hi ? x : undefined;
  }
  function setupId(v, list) {
    const s = text(v);
    if (s === undefined) return undefined;
    const n = s.toUpperCase();
    if (Array.isArray(list)) return list.indexOf(n) >= 0 ? n : undefined;
    return SETUP_RE.test(n) ? n : undefined;
  }

  /** Número do estado vira o texto que o validador espera (ou undefined). */
  function numText(n) {
    if (typeof n === 'string') return n;
    return typeof n === 'number' && isFinite(n) ? String(+n.toFixed(4)) : undefined;
  }

  /** Primeiro valor de cada chave gerenciada, em objeto sem protótipo. */
  function firstValues(search) {
    const out = Object.create(null);
    if (typeof search !== 'string') return out;
    let s = search;
    const h = s.indexOf('#');
    if (h >= 0) s = s.slice(0, h);
    if (s.length > MAX_SEARCH) return out;
    const sp = new URLSearchParams(s);
    for (let i = 0; i < KEYS.length; i++) {
      const all = sp.getAll(KEYS[i]);
      if (all.length) out[KEYS[i]] = all[0];
    }
    return out;
  }

  /**
   * Lê a pergunta de uma consulta de URL (`location.search`, com ou sem "?").
   * Só devolve os campos válidos: { sym, tf, cfg: { mode, tgt, stp, hold }, win, setup, regime }.
   * @param {unknown} search
   * @param {{ setups?: string[], regimes?: string[] }} [opts] listas fechadas, se quiser validar contra o motor
   */
  function parse(search, opts) {
    const out = {};
    try {
      const o = opts && typeof opts === 'object' ? opts : {};
      const regimes = Array.isArray(o.regimes) ? o.regimes : REGIMES;
      const p = firstValues(search);
      const sym = choice(p.symbol, SYMBOLS, 'upper');
      const tf = choice(p.tf, TIMEFRAMES, 'lower');
      const cfg = {};
      const mode = choice(p.mode, MODES, 'lower');
      const tgt = decimal(p.tgt, 0.2, 20);
      const stp = decimal(p.stp, 0.2, 20);
      const hold = integer(p.hold, 2, 60);
      const win = integer(p.win, 30, 5000);
      const setup = setupId(p.setup, o.setups);
      const regime = choice(p.regime, regimes, 'upper');
      if (sym !== undefined) out.sym = sym;
      if (tf !== undefined) out.tf = tf;
      if (mode !== undefined) cfg.mode = mode;
      if (tgt !== undefined) cfg.tgt = tgt;
      if (stp !== undefined) cfg.stp = stp;
      if (hold !== undefined) cfg.hold = hold;
      if (Object.keys(cfg).length) out.cfg = cfg;
      if (win !== undefined) out.win = win;
      if (setup !== undefined) out.setup = setup;
      if (regime !== undefined) out.regime = regime;
    } catch (e) {
      return {};
    }
    return out;
  }

  /**
   * Monta a consulta de URL (sem "?") da pergunta. Campo ausente ou inválido não entra; recorte "ALL" e janela
   * vazia também não (são o padrão). `opts.keep` é uma consulta existente: os parâmetros que não são nossos
   * são mantidos, os nossos são trocados. Devolve '' se não houver nada a escrever.
   * @param {{ sym?: string, tf?: string, cfg?: { mode?: string, tgt?: number, stp?: number, hold?: number }, win?: number | null, setup?: string, regime?: string }} view
   * @param {{ keep?: string, setups?: string[], regimes?: string[] }} [opts]
   */
  function build(view, opts) {
    try {
      const v = view && typeof view === 'object' ? view : {};
      const o = opts && typeof opts === 'object' ? opts : {};
      const c = v.cfg && typeof v.cfg === 'object' ? v.cfg : {};
      const regimes = Array.isArray(o.regimes) ? o.regimes : REGIMES;
      const pairs = [];
      const add = (k, x) => { if (x !== undefined) pairs.push([k, String(x)]); };
      add('symbol', choice(v.sym, SYMBOLS, 'upper'));
      add('tf', choice(v.tf, TIMEFRAMES, 'lower'));
      add('mode', choice(c.mode, MODES, 'lower'));
      add('tgt', decimal(numText(c.tgt), 0.2, 20));
      add('stp', decimal(numText(c.stp), 0.2, 20));
      add('hold', integer(numText(c.hold), 2, 60));
      add('win', integer(numText(v.win), 30, 5000));
      add('setup', setupId(v.setup, o.setups));
      const regime = choice(v.regime, regimes, 'upper');
      if (regime !== undefined && regime !== 'ALL') add('regime', regime);
      if (!pairs.length) return '';
      const sp = new URLSearchParams();
      pairs.forEach((kv) => sp.append(kv[0], kv[1]));
      if (typeof o.keep === 'string' && o.keep.length <= MAX_SEARCH) {
        const keep = o.keep.indexOf('#') >= 0 ? o.keep.slice(0, o.keep.indexOf('#')) : o.keep;
        new URLSearchParams(keep).forEach((val, k) => { if (KEYS.indexOf(k) < 0) sp.append(k, val); });
      }
      return sp.toString();
    } catch (e) {
      return '';
    }
  }

  root.ArgosUrlState = { parse, build };
})(typeof window !== 'undefined' ? window : globalThis);
