// Calibração prospectiva INTERNA: ECE, BSS e curva sobre as previsões do Termômetro que já têm desfecho.
// Usa o mesmo cálculo do motor (calibSummary), sobre pares (p, o, r) lidos do banco; nada novo nasce aqui.
// Dois cuidados de honestidade, porque N pequeno engana:
//  - abaixo de 30 previsões resolvidas o motor devolve "previsões insuficientes" (aqui também);
//  - ao lado do ECE observado vai o ECE que um motor PERFEITAMENTE calibrado teria só por acaso, com os mesmos p e o mesmo N
//    (simulação com semente fixa). Se o observado está dentro dessa faixa, não há evidência de descalibração.
// Não é publicável: a publicação do Termômetro está travada pelo parecer sobre CNPI.
import { calibSummary } from '../engine/index.js';

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/**
 * @param {{ p: number, o: 0|1, r: number }[]} preds p: probabilidade registrada; o: 1 se WIN, 0 se LOSS ou TIMEOUT; r: taxa-base registrada
 * @param {{ runs?: number, seed?: number, minBin?: number }} [opts]
 */
export function calibrationReport(preds, { runs = 500, seed = 20261016, minBin = 30 } = {}) {
  const n = preds.length;
  const s = calibSummary(preds.map((x, i) => ({ ...x, t: i })), null);
  const bins = s.bins.map((b) => ({ ...b, reliable: b.n >= minBin }));
  let noise = null;
  if (n >= 30) {
    const rnd = mulberry32(seed), eces = [], bsss = [];
    for (let k = 0; k < runs; k++) {
      const sim = preds.map((x, i) => ({ p: x.p, r: x.r, o: rnd() < x.p ? 1 : 0, t: i }));
      const c = calibSummary(sim, null);
      eces.push(c.ece); bsss.push(c.bss);
    }
    eces.sort((a, b) => a - b); bsss.sort((a, b) => a - b);
    noise = { runs, eceMedian: pct(eces, 0.5), eceP90: pct(eces, 0.9), bssP10: pct(bsss, 0.1), bssMedian: pct(bsss, 0.5) };
  }
  const verdict = n < 30 ? 'insuficiente'
    : s.ece > noise.eceP90 ? 'acima_do_acaso'
    : 'dentro_do_acaso';
  return {
    n, minimum: 30, verdict,
    ece: Number.isFinite(s.ece) ? s.ece : null, bss: Number.isFinite(s.bss) ? s.bss : null,
    brier: Number.isFinite(s.brier) ? s.brier : null, brierRef: Number.isFinite(s.brierRef) ? s.brierRef : null,
    status: s.status, bins, noise,
    note: n < 30
      ? `Previsões resolvidas insuficientes (${n} de 30): nenhuma leitura de calibração.`
      : verdict === 'dentro_do_acaso'
        ? 'ECE observado dentro do que um motor perfeitamente calibrado teria por acaso, com este N: sem evidência de descalibração.'
        : 'ECE observado acima do que o acaso explicaria (P90 de um motor perfeitamente calibrado): investigar antes de concluir.'
  };
}
