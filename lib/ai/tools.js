// Ferramentas do Argos AI, executadas no servidor. O modelo só enxerga o que o motor calculou aqui, sobre a série que
// o servidor carregou: o cliente não declara ferramenta nem envia resultado de ferramenta (era a falha do S5).
// O contexto (ativo, tempo gráfico, regra de saída, janela) vem validado por parseAnalyzeInput; as ferramentas
// não aceitam ativo nem série como argumento, então o modelo não consulta nada fora do recorte pedido.
// As contas são as mesmas que o navegador fazia em web/js/live.js (toolContext, toolBank, toolDetail): só mudou o lugar.
import { analyze, sliceSeries, REGIMES } from '../../engine/index.js';
import { scanText } from '../compliance.js';
import { defaultSeriesLoader, parseAnalyzeInput } from '../handlers/analyze.js';

const NFS = {};
const NF = (d) => NFS[d] || (NFS[d] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtN = (x, d = 2) => (isFinite(x) ? NF(d).format(x) : '—');
const fmtSPct = (x, d = 2) => (isFinite(x) ? (x >= 0 ? '+' : '−') + NF(d).format(Math.abs(x * 100)) + '%' : '—');
const fmtP = (p) => (!isFinite(p) ? '—' : p < 0.001 ? '< 0,001' : NF(3).format(p));
const pad = (n) => String(n).padStart(2, '0');
function fmtDate(ts, withTime = true) {
  const d = new Date(ts * 1000);
  return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + (withTime ? ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC' : '');
}
const fmtDay = (ts) => fmtDate(ts, false);
const TF_LABEL = { '1h': '1h', '4h': '4h', '1d': '1D' };
const PAIR = (s) => s.replace('USDT', '/USDT');
const cfgText = (c) => { const u = c.mode === 'atr' ? '×ATR' : '%'; return 'alvo ' + fmtN(c.tgt, c.tgt % 1 ? 1 : 0) + u + ' · stop ' + fmtN(c.stp, c.stp % 1 ? 1 : 0) + u + ' · ' + c.hold + ' candles'; };

function regimeWhy(r) {
  const a = fmtN(r.adx, 1), rv = fmtN(r.rvPct, 0), pm = fmtSPct(r.priceVsMa, 1);
  switch (r.regime) {
    case 'STRUCTURAL_BREAK': return 'Chow p = ' + fmtP(r.chowP) + ' (< 0,01): a média dos retornos dos últimos 30 candles difere da dos 90 anteriores.';
    case 'BULL_TREND': return 'ADX ' + a + ' (> 25), preço ' + pm + ' vs. MM200 e volatilidade no percentil ' + rv + ' (< 60).';
    case 'BEAR_TREND': return 'ADX ' + a + ' (> 25) com preço ' + pm + ' vs. MM200.';
    case 'LOW_VOL_RANGING': return 'ADX ' + a + ' (< 20, sem tendência definida) e volatilidade no percentil ' + rv + ' (≤ 60).';
    case 'HIGH_VOL_RANGING': return r.adx > 25 ? 'ADX ' + a + ' (> 25) acima da MM200, mas volatilidade no percentil ' + rv + ' (≥ 60).' : r.adx < 20 ? 'ADX ' + a + ' (< 20) com volatilidade no percentil ' + rv + ' (> 60).' : 'ADX ' + a + ' na zona intermediária (20–25): o método classifica como lateral.';
    default: return 'Histórico insuficiente para classificar.';
  }
}

function regimeDestinations(runs, R) {
  const cnt = {}; let total = 0;
  for (let k = 0; k < runs.length - 1; k++) {
    if (runs[k].regime !== R) continue;
    let j = k + 1;
    if (R !== 'HIGH_VOL_RANGING') while (j < runs.length && runs[j].regime === 'HIGH_VOL_RANGING') j++;
    if (j >= runs.length) continue;
    cnt[runs[j].regime] = (cnt[runs[j].regime] || 0) + 1; total++;
  }
  return { total, list: Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3) };
}

function sourceLabel(series) {
  if (series.source === 'database') return 'Binance Spot (base de candles da Stratum)';
  return 'Binance Spot (' + (series.source === 'live' || series.source === 'merged' ? 'ao vivo' : 'snapshot real') + ')';
}

function toolContext(A, ctx, series) {
  const T = A.tech, r = T.regime, rs = A.rstats, cur = rs.current, dur = rs.durations[r.regime] || {};
  return {
    ativo: PAIR(ctx.symbol), tempo_grafico: TF_LABEL[ctx.timeframe], fonte: sourceLabel(series),
    janela: { inicio: fmtDay(A.d.t[A.warm]), fim: fmtDate(A.d.t[A.d.n - 1]), candles: A.d.n },
    ultimo_candle: { fechamento: +T.close.toFixed(2), variacao_24h_pct: +(T.change24 * 100).toFixed(2), variacao_7d_pct: +(T.change7d * 100).toFixed(2) },
    indicadores: { rsi14: +T.rsi.toFixed(1), zona_rsi: T.rsiZone, macd_acima_do_sinal: T.macdAbove, candles_desde_cruzamento_macd: T.macdBarsSinceCross, histograma_macd_expandindo: T.histExpanding, adx14: +T.adx.toFixed(1), di_mais: +T.diPlus.toFixed(1), di_menos: +T.diMinus.toFixed(1), ema20: +T.ema20.toFixed(2), ema50: +T.ema50.toFixed(2), mm200: +T.sma200.toFixed(2), distancia_mm200_pct: +(T.distMa200 * 100).toFixed(2), candles_do_mesmo_lado_da_mm200: T.barsVsMa200, volume_desvios_vs_media30: +T.volZ.toFixed(2), posicao_no_canal_20_pct: +(T.rangePos * 100).toFixed(0) },
    regime: { codigo: r.regime, nome: REGIMES[r.regime].label, confianca_pct: +(r.confidence * 100).toFixed(0), criterio: regimeWhy(r), chow_p: +r.chowP.toFixed(4), duracao_atual_candles: cur ? cur.end - cur.start + 1 : 0, duracao_media_candles: dur.mean ? +dur.mean.toFixed(1) : null, transicoes_diretas_a_partir_deste_regime: rs.transitions[r.regime] || {}, destinos_depois_da_zona_intermediaria: Object.fromEntries(regimeDestinations(rs.runs, r.regime).list), participacao_na_janela_pct: Object.fromEntries(Object.entries(rs.share).map(([k, v]) => [k, +(v * 100).toFixed(1)])) },
    risco: { atr14: +T.atr.toFixed(2), atr_pct_do_preco: +(T.atrPct * 100).toFixed(2), cvar5_1candle_pct: +(T.cvar1bar * 100).toFixed(2), maior_queda_500_candles_pct: +(T.maxDD * 100).toFixed(1), volatilidade_realizada_percentil: +T.rvPct.toFixed(0) },
    niveis_referencia_tecnica_nao_sao_alvos: { mm200: +T.sma200.toFixed(2), ema20: +T.ema20.toFixed(2), bollinger_superior: +T.bbUpper.toFixed(2), bollinger_inferior: +T.bbLower.toFixed(2), maxima_20: +T.hh20.toFixed(2), minima_20: +T.ll20.toFixed(2) },
    calibracao: A.calib.n >= 30 ? { metodo: 'prequencial: probabilidade emitida antes de cada gatilho vs. desfecho', previsoes: A.calib.n, brier: +A.calib.brier.toFixed(4), brier_referencia_taxa_base: +A.calib.brierRef.toFixed(4), ganho_sobre_referencia_bss_pct: +(A.calib.bss * 100).toFixed(2), erro_calibracao_ece_pp: +(A.calib.ece * 100).toFixed(2), leitura: A.calib.status.t, criterios: 'ECE < 3 p.p. bem calibrada; 3–6 atenção; > 6 descalibrada. BSS > +1% acrescenta informação; entre −1% e +1% empate; < −1% pior que a referência.' } : { disponivel: false, motivo: 'menos de 30 previsões fora da amostra nesta janela' },
    regra_de_saida: cfgText(ctx.cfg) + ' (vitória = alvo antes do stop dentro do horizonte; alvo e stop no mesmo candle = perda)'
  };
}

function toolBank(A) {
  return A.setups.map((s) => ({ id: s.id, nome: s.nome, definicao: s.def, gatilho_nos_ultimos_3_candles: s.activeNow, candles_desde_ultimo_gatilho: s.barsSinceLast, n_com_desfecho: s.n, n_efetivo: s.nEff, taxa_acerto_pct: +(s.winRate * 100).toFixed(1), ic95_pct: [+(s.ci[0] * 100).toFixed(1), +(s.ci[1] * 100).toFixed(1)], metodo_ic: s.method, taxa_base_aleatoria_pct: +(s.base * 100).toFixed(1), diferenca_pp: +s.alphaPP.toFixed(1), p_bruto_bicaudal: +s.pTwo.toFixed(4), p_ajustado_bh: +s.q.toFixed(4), testes_na_familia: s.family, veredito: s.verdict.label, walk_forward_consistente: s.wf.available ? s.wf.consistent : null }));
}

function toolDetail(A, id) {
  const s = A.setups.find((x) => x.id === String(id).trim().toUpperCase());
  if (!s) throw new Error('setup_id desconhecido. Use um destes: ' + A.setups.map((x) => x.id).join(', '));
  return { id: s.id, nome: s.nome, definicao: s.def, veredito: s.verdict.label, cvar5_por_gatilho_pct: +(s.cvar * 100).toFixed(2), excursao_adversa_mediana_pct: +(s.maeMedian * 100).toFixed(2), resultado_medio_pos_custo_pct: +(s.meanNet * 100).toFixed(3), encerrados_por_prazo: s.timeouts,
    por_regime: Object.fromEntries(Object.entries(s.byRegime).map(([k, v]) => [k, { n: v.n, taxa_acerto_pct: +((v.w / v.n) * 100).toFixed(1) }])),
    walk_forward: s.wf.available ? { janelas: s.wf.walks.map((w) => ({ periodo_teste: fmtDay(A.d.t[w.from]) + ' a ' + fmtDay(A.d.t[w.to]), treino_n: w.trainN, treino_pct: +(w.trainWR * 100).toFixed(1), teste_n: w.testN, teste_pct: +(w.testWR * 100).toFixed(1), queda_pp: +w.dropPP.toFixed(1), queda_acima_de_15pp: w.overfit })), brier_fora_da_amostra: +s.wf.brier.toFixed(3), brier_referencia: +s.wf.brierRef.toFixed(3) } : { disponivel: false, motivo: s.wf.reason } };
}

const fn = (name, description, properties = {}, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, ...(required ? { required } : {}) } } });

/** Catálogo fechado: é o único conjunto de ferramentas que o modelo pode chamar. */
export const TOOL_DEFS = Object.freeze([
  fn('obter_leitura_tecnica', 'Retorna a leitura técnica atual calculada pelo motor Argos Sentinel: preço, indicadores (RSI, MACD, ADX, médias), regime de mercado com critério e histórico de transições, métricas de risco, níveis de referência técnica e calibração.'),
  fn('consultar_banco_de_setups', 'Retorna os 8 setups do banco de estratégias testados agora contra o histórico carregado: gatilho recente, N, N efetivo, taxa de acerto com IC 95%, taxa-base de entradas aleatórias, p-valor do teste de permutação e veredito.'),
  fn('detalhar_setup', 'Detalha um setup: walk-forward por janela, taxa de acerto por regime, CVaR 5% por gatilho, excursão adversa e resultado médio após custo. Use o id retornado por consultar_banco_de_setups.', { setup_id: { type: 'string', description: 'Id do setup, por exemplo RSI_OVERSOLD' } }, ['setup_id']),
  fn('verificar_vocabulario', 'Verifica um texto contra o vocabulário proibido da Política de Compliance (instrução de compra/venda, promessa de retorno, urgência). Retorna os termos sinalizados.', { texto: { type: 'string' } }, ['texto'])
]);
export const TOOL_NAMES = Object.freeze(TOOL_DEFS.map((t) => t.function.name));

/** Valida o recorte que o cliente pede (mesmas regras do /api/analyze). */
export function parseContext(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: '`context` deve ser um objeto com symbol e timeframe' };
  const p = parseAnalyzeInput({ symbol: raw.symbol, tf: raw.timeframe, cfg: raw.cfg, windowDays: raw.windowDays });
  if (p.error) return { error: 'context inválido: ' + p.error };
  return { value: { symbol: p.value.symbol, timeframe: p.value.timeframe, cfg: p.value.cfg, windowDays: p.value.windowDays } };
}

/**
 * Executor de ferramentas de uma requisição. A análise é calculada uma vez, sob demanda.
 * @param {{ context: { symbol: string, timeframe: string, cfg: object, windowDays: number|null }, loadSeries?: Function, env?: object, now?: () => number }} args
 */
export function createToolRunner({ context, loadSeries, env = process.env, now = Date.now }) {
  let memo = null;
  async function analysis() {
    if (!memo) {
      memo = (async () => {
        const series = await (loadSeries || defaultSeriesLoader(env))(context.symbol, context.timeframe, { live: true, now: now() });
        const d = context.windowDays ? sliceSeries(series.d, Math.round((context.windowDays * 86400) / series.d.dt) + 200) : series.d;
        const A = analyze(d, { ...context.cfg }, { sym: context.symbol, tf: context.timeframe, source: series.source, win: context.windowDays });
        return { A, series };
      })();
    }
    return memo;
  }
  return {
    defs: TOOL_DEFS,
    /**
     * @returns {Promise<{ content: string, args: object, evidence?: boolean }>} `content` é o texto da mensagem `tool`; erro de uso vira { erro } para o modelo corrigir.
     * Falha de dados (série indisponível) é lançada: nada é calculado nem repassado.
     */
    async run(name, rawArgs) {
      if (!TOOL_NAMES.includes(name)) throw new RangeError('ferramenta fora do catálogo: ' + name);
      let args = {};
      try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return { content: JSON.stringify({ erro: 'argumentos fora de JSON' }), args: {} }; }
      if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
      if (name === 'verificar_vocabulario') {
        // Só o veredito e o nome das regras: o trecho sinalizado (que pode conter dígitos escolhidos pelo modelo) não volta,
        // e este resultado não vale como fonte de número (`evidence: false`): a guarda numérica o ignora.
        const flags = await scanText(String(args.texto || ''));
        const regras = [...new Set(flags.map((f) => String((f && f.rule) || 'regra')).filter((r) => !/d/.test(r)))];
        return { content: JSON.stringify({ aprovado: !flags.length, regras_acionadas: regras }), args: { chars: String(args.texto || '').length }, evidence: false };
      }
      const { A, series } = await analysis();
      try {
        if (name === 'obter_leitura_tecnica') return { content: JSON.stringify(toolContext(A, context, series)), args: {} };
        if (name === 'consultar_banco_de_setups') return { content: JSON.stringify(toolBank(A)), args: {} };
        return { content: JSON.stringify(toolDetail(A, args.setup_id)), args: { setup_id: String(args.setup_id || '').slice(0, 40) } };
      } catch (e) {
        return { content: JSON.stringify({ erro: String((e && e.message) || e) }), args: {} };
      }
    }
  };
}
