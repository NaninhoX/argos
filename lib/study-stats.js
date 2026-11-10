// Estatística do estudo multimercado (docs/estudo-multimercado-pre-registro.md). Fora do motor: nada daqui altera engine/.

/** Teste binomial unilateral: P(X >= k), X ~ Bin(n, 0,5). */
export function binomialTail(k, n) {
  let s = 0;
  for (let i = k; i <= n; i++) { let c = 1; for (let j = 1; j <= i; j++) c = (c * (n - i + j)) / j; s += c; }
  return s / 2 ** n;
}

/** Gerador pseudoaleatório determinístico (mulberry32): mesma semente, mesma sequência. */
export const seededRandom = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Intervalo de 95% da média por reamostragem das séries (percentis 2,5% e 97,5% de `draws` médias). */
export function bootstrapMeanCI95(values, seed, draws = 10000) {
  const rand = seededRandom(seed), n = values.length, means = [];
  for (let b = 0; b < draws; b++) { let s = 0; for (let i = 0; i < n; i++) s += values[Math.floor(rand() * n)]; means.push(s / n); }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * draws)], means[Math.floor(0.975 * draws)]];
}
