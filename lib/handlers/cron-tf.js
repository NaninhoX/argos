// Filtro de tempo gráfico dos crons (`?tf=1h`, `?tf=4h`, `?tf=1h,4h`). Sem `tf`, valem os três (comportamento diário original).
// Serve ao disparo por candle: um agendador externo chama o cron de cada tempo gráfico logo depois do fechamento do candle.
import { TIMEFRAMES } from '../data/series.js';

const first = (v) => (Array.isArray(v) ? v[0] : v);

/** @returns {{ timeframes?: string[] } | { error: string }} */
export function parseTf(query) {
  const raw = first(query && query.tf);
  if (raw === undefined || raw === '') return {};
  const list = String(raw).split(',').map((s) => s.trim());
  if (!list.length || list.some((t) => !TIMEFRAMES.includes(t))) return { error: 'tf inválido: use ' + TIMEFRAMES.join(', ') + ' (separados por vírgula)' };
  return { timeframes: [...new Set(list)] };
}
