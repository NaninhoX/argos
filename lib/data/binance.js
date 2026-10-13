// Candles públicos da Binance (GET /api/v3/klines). Mesmos hosts e ordem da demo v1.1.
// Fonte trocável: quem consome é lib/data/series.js, que só conhece o formato de linhas do motor.
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

/**
 * @param {string} symbol ex.: 'BTCUSDT'
 * @param {string} interval '1h' | '4h' | '1d'
 * @param {{ limit?: number, startTime?: number, endTime?: number, fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<any[][]>} klines no formato bruto da Binance
 */
export async function fetchKlines(symbol, interval, opts = {}) {
  const { limit = 1000, startTime, endTime, fetchImpl = fetch, timeoutMs = 7000 } = opts;
  let last;
  for (const host of HOSTS) {
    const url = `${host}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}` + (startTime ? `&startTime=${startTime}` : '') + (endTime ? `&endTime=${endTime}` : '');
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!Array.isArray(j)) throw new Error('resposta inesperada');
      return j;
    } catch (e) {
      last = e;
    } finally {
      clearTimeout(to);
    }
  }
  throw last || new Error('sem resposta');
}
