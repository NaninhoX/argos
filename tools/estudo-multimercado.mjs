// Estudo multimercado: executa o que está fixado em docs/estudo-multimercado-pre-registro.json (SHA-256 no .md).
// Só lê: usa engine/ sem alterá-lo. Uso: node tools/estudo-multimercado.mjs <pasta com os JSON do Yahoo> [arquivo-de-saida.json]
// Os arquivos têm o nome do ticker sem "=" nem "." (ex.: BBDC4SA.json, GBPUSDX.json).
import fs from 'node:fs';
import path from 'node:path';
import { analyze, mergeSeries, bhAdjust } from '../engine/index.js';
import { binomialTail, bootstrapMeanCI95 } from '../lib/study-stats.js';
import { summarize } from '../lib/analysis-summary.js';

const ficha = JSON.parse(fs.readFileSync(new URL('../docs/estudo-multimercado-pre-registro.json', import.meta.url), 'utf8'));
const [dir, outFile] = process.argv.slice(2);
if (!dir) { console.error('Uso: node tools/estudo-multimercado.mjs <pasta> [saida.json]'); process.exit(2); }

const CORTE = Date.parse(ficha.dados.corte + 'T23:59:59Z') / 1000;
const MIN = ficha.dados.minimoDeCandles;
const padrao = ficha.regraDeSaidaPadrao;
const REGRAS = [
  { nome: 'padrão', cfg: { mode: 'atr', tgt: padrao.alvo, stp: padrao.stop, hold: padrao.candles } },
  ...ficha.sensibilidadeARegraDeSaida.regrasAlternativas.map((r) => ({ nome: `${r.alvo}/${r.stop}/${r.candles}`, cfg: { mode: 'atr', tgt: r.alvo, stp: r.stop, hold: r.candles } }))
];
const HIP = ficha.hipoteses;
const tickers = [...ficha.universo.acoesB3, ...ficha.universo.forex];
const arq = (t) => t.replace(/[=.]/g, '') + '.json';

function load(t) {
  const f = path.join(dir, arq(t));
  if (!fs.existsSync(f)) return { t, erro: 'arquivo ausente (fonte devolveu erro)' };
  const j = (JSON.parse(fs.readFileSync(f, 'utf8')).chart.result || [])[0];
  if (!j || !j.timestamp) return { t, erro: 'fonte sem dados para o ticker (HTTP 404)' };
  const q = j.indicators.quote[0], rows = [];
  let descartados = 0;
  j.timestamp.forEach((ts, i) => {
    if (ts > CORTE) return;
    if ([q.open[i], q.high[i], q.low[i], q.close[i]].some((x) => x == null)) { descartados++; return; }
    rows.push([ts, q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i] || 0]);
  });
  const d = mergeSeries({ n: 0, t: [], o: [], h: [], l: [], c: [], v: [], dt: 86400 }, rows, 86400);
  if (d.n < MIN) return { t, erro: `${d.n} candles, menos que o mínimo de ${MIN}`, candles: d.n };
  return { t, d, descartados };
}

const used = [], excluded = [];
for (const t of tickers) { const c = load(t); if (c.erro) excluded.push({ ticker: t, motivo: c.erro }); else used.push(c); }

// alpha[regra][setup] = [{ticker, alpha}]
const alpha = {};
const porSerie = [];
for (const s of used) {
  const linha = { ticker: s.t, candles: s.d.n, descartados: s.descartados, regras: {} };
  for (const R of REGRAS) {
    const S = summarize(analyze(s.d, { ...R.cfg }, { sym: s.t, tf: '1d', source: 'yahoo-interno' }), { symbol: s.t, timeframe: '1d', source: 'yahoo-interno' });
    if (R.nome === 'padrão') { linha.hash = S.data.hash; linha.vereditos = Object.fromEntries(S.setups.map((x) => [x.id, x.verdict.label])); }
    linha.regras[R.nome] = {};
    for (const h of HIP) {
      const x = S.setups.find((y) => y.id === h.setup);
      const a = x && Number.isFinite(x.alphaPP) ? x.alphaPP : null;
      linha.regras[R.nome][h.setup] = a;
      ((alpha[R.nome] ||= {})[h.setup] ||= []).push({ ticker: s.t, alpha: a });
    }
  }
  porSerie.push(linha);
}

const predicted = (h, a) => (h.direcao === 'abaixo' ? a < 0 : a > 0);
const resultado = { estudo: ficha.estudo, motor: ficha.motor, corte: ficha.dados.corte, usadas: used.length, excluidas: excluded, hipoteses: [], sensibilidade: {} };
const ps = [];
for (const h of HIP) {
  const v = alpha['padrão'][h.setup].filter((x) => x.alpha !== null);
  const k = v.filter((x) => predicted(h, x.alpha)).length, n = v.length;
  const vals = v.map((x) => x.alpha);
  const media = vals.reduce((a, b) => a + b, 0) / n;
  const [lo, hi] = bootstrapMeanCI95(vals, 20261109);
  const p = binomialTail(k, n);
  ps.push(p);
  const sub = (lista) => { const w = v.filter((x) => lista.includes(x.ticker)); return { n: w.length, previstas: w.filter((x) => predicted(h, x.alpha)).length }; };
  resultado.hipoteses.push({ ...h, n, semAlpha: alpha['padrão'][h.setup].length - n, previstas: k, fracao: k / n, mediaPP: media, ic95: [lo, hi], p, subgrupos: { forex: sub(ficha.universo.forex), acoesB3: sub(ficha.universo.acoesB3) } });
}
const q = bhAdjust(ps);
resultado.hipoteses.forEach((h, i) => {
  h.q = q[i];
  const ic = h.direcao === 'abaixo' ? h.ic95[1] < 0 : h.ic95[0] > 0;
  h.sustentada = h.fracao >= 0.75 && ic && h.q < 0.05;
});
resultado.sustentadas = resultado.hipoteses.filter((h) => h.sustentada).length;
resultado.padraoGeral = resultado.sustentadas >= 3;
for (const R of REGRAS.slice(1)) {
  resultado.sensibilidade[R.nome] = HIP.map((h) => {
    const v = alpha[R.nome][h.setup].filter((x) => x.alpha !== null);
    const k = v.filter((x) => predicted(h, x.alpha)).length;
    return { id: h.id, setup: h.setup, n: v.length, previstas: k, fracao: k / v.length };
  });
}
resultado.robustezARegra = HIP.map((h, i) => ({ id: h.id, rotulo: Object.values(resultado.sensibilidade).every((s) => s[i].fracao >= 0.75) ? 'robusto à regra' : 'sensível à regra' }));
resultado.porSerie = porSerie;

console.log(`séries usadas: ${used.length}; excluídas: ${excluded.length} ${excluded.map((e) => e.ticker + ' (' + e.motivo + ')').join('; ')}`);
for (const h of resultado.hipoteses) console.log(`${h.id} ${h.setup.padEnd(13)} ${h.direcao.padEnd(6)} previstas ${h.previstas}/${h.n} (${(h.fracao * 100).toFixed(0)}%) média ${h.mediaPP.toFixed(1)} p.p. IC95 [${h.ic95[0].toFixed(1)}; ${h.ic95[1].toFixed(1)}] p ${h.p.toFixed(4)} q ${h.q.toFixed(4)} (família 4) -> ${h.sustentada ? 'SUSTENTADA' : 'abandonada'} | forex ${h.subgrupos.forex.previstas}/${h.subgrupos.forex.n}, B3 ${h.subgrupos.acoesB3.previstas}/${h.subgrupos.acoesB3.n}`);
console.log(`sustentadas: ${resultado.sustentadas}/4; padrão geral: ${resultado.padraoGeral ? 'DECLARADO' : 'ABANDONADO'}`);
for (const [nome, s] of Object.entries(resultado.sensibilidade)) console.log(`regra ${nome}: ` + s.map((x) => `${x.id} ${x.previstas}/${x.n}`).join(', '));
console.log('robustez: ' + resultado.robustezARegra.map((x) => `${x.id} ${x.rotulo}`).join('; '));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(resultado, null, 1));
