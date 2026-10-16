// GET /api/termometro/status — saúde operacional do Termômetro: quantos registros, quantos desfechos, o que está parado.
// Só contagens e datas (nada de probabilidade nem de desempenho): serve para o dono ver, por conta própria, se o registro
// prospectivo está vivo ou calado. Protegido por código de acesso; em produção, sem código configurado, recusa (falha fechado).
// Handler puro: recebe o código e o ambiente, lê o banco e devolve { status, headers, body }.
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolveDb } from '../db.js';
import { DEFAULT_CFG } from './analyze.js';
import { TIMEFRAME_SECONDS } from '../repo/candles.js';
import { ORIGIN } from '../jobs/termometro.js';
import { calibrationReport } from '../calibracao-prospectiva.js';

const NO_STORE = { 'cache-control': 'no-store' };
const failure = (status, code, message) => ({ status, headers: NO_STORE, body: { error: { code, message } } });
const iso = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());
const HOUR = 3600_000;

function sameCode(given, expected) {
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(given), h(expected));
}

/**
 * Cadência por candle: ARGOS_POR_CANDLE="1h,4h" lista os tempos gráficos que devem estar em dia a cada candle; para eles, um atraso de
 *  2 candles ou mais gera o alerta `serie_atrasada_por_candle` POR SÉRIE (o global esconderia um job de 4h parado com o de 1h vivo).
 * Limiares (ajustáveis por ambiente quando a cadência mudar de diária para por candle):
 *  - ARGOS_INGEST_MAX_AGE_H: idade máxima do último candle inserido (padrão 30 h, para cadência diária);
 *  - ARGOS_REGISTRO_MAX_AGE_H: tempo máximo sem nenhum registro novo (padrão 72 h: com disparo diário, dias sem gatilho
 *    são normais, mas três seguidos são raros).
 * @param {object} req
 * @param {string} [req.method]
 * @param {string | string[]} [req.code] cabeçalho x-argos-code
 * @param {Record<string, string | undefined>} [req.env]
 * @param {{ db?: object, now?: (() => number) | number }} [req.deps]
 */
export async function handleTermometroStatus({ method = 'GET', code, env = process.env, deps = {} } = {}) {
  if (method !== 'GET') return { ...failure(405, 'metodo_nao_permitido', 'use GET'), headers: { ...NO_STORE, allow: 'GET' } };
  if (!env.ARGOS_ACCESS_CODE && env.VERCEL_ENV === 'production') return failure(503, 'not_configured', 'O servidor não tem o código de acesso configurado.');
  if (env.ARGOS_ACCESS_CODE && !sameCode(Array.isArray(code) ? code[0] || '' : code || '', env.ARGOS_ACCESS_CODE)) {
    return failure(401, 'nao_autorizado', 'Código de acesso ausente ou incorreto.');
  }
  if (!deps.db && !env.DATABASE_URL) return failure(503, 'banco_ausente', 'DATABASE_URL não configurada.');
  const db = deps.db || (await resolveDb(env));
  const nowMs = typeof deps.now === 'function' ? deps.now() : deps.now ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const ingestMaxH = +env.ARGOS_INGEST_MAX_AGE_H > 0 ? +env.ARGOS_INGEST_MAX_AGE_H : 30;
  const registroMaxH = +env.ARGOS_REGISTRO_MAX_AGE_H > 0 ? +env.ARGOS_REGISTRO_MAX_AGE_H : 72;
  const hold = DEFAULT_CFG.hold;
  const porCandle = String(env.ARGOS_POR_CANDLE || '').split(',').map((s) => s.trim()).filter(Boolean);

  const bySeries = (await db.query(
    `select p.symbol, p.timeframe, count(*)::int as registered, count(d.previsao_id)::int as resolved,
            min(p.emitted_at) as first_at, max(p.emitted_at) as last_at
       from previsoes p left join desfechos d on d.previsao_id = p.id
      where p.origin = $1 group by p.symbol, p.timeframe order by p.symbol, p.timeframe`, [ORIGIN])).rows;
  const outcomes = (await db.query(
    `select d.outcome, count(*)::int as n from desfechos d join previsoes p on p.id = d.previsao_id where p.origin = $1 group by d.outcome`, [ORIGIN])).rows;
  const regDays = (await db.query(
    `select to_char(emitted_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as n from previsoes
      where origin = $1 and emitted_at >= $2::timestamptz - interval '14 days' group by 1 order by 1`, [ORIGIN, nowIso])).rows;
  const resDays = (await db.query(
    `select to_char(d.resolved_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as n from desfechos d join previsoes p on p.id = d.previsao_id
      where p.origin = $1 and d.resolved_at >= $2::timestamptz - interval '14 days' group by 1 order by 1`, [ORIGIN, nowIso])).rows;
  const candles = (await db.query(
    `select symbol, timeframe, max(open_time) as last_open, max(inserted_at) as last_insert from candles group by symbol, timeframe order by symbol, timeframe`)).rows;
  // Previsão em aberto cuja janela (hold candles) fechou há mais de 3 candles e continua sem desfecho: a resolução não está andando.
  const overdue = (await db.query(
    `select p.symbol, p.timeframe, count(*)::int as n from previsoes p left join desfechos d on d.previsao_id = p.id
      where p.origin = $1 and d.previsao_id is null and p.bar_time is not null
        and p.bar_time + (case p.timeframe when '1h' then interval '1 hour' when '4h' then interval '4 hours' else interval '1 day' end) * $2 < $3::timestamptz
      group by p.symbol, p.timeframe`, [ORIGIN, hold + 3, nowIso])).rows;

  // Pares (p, o, r) das previsões resolvidas, para a calibração interna (mesmo cálculo do motor).
  const pairs = (await db.query(
    `select p.prob, p.base_rate, d.outcome from previsoes p join desfechos d on d.previsao_id = p.id
      where p.origin = $1 and p.prob is not null and p.base_rate is not null`, [ORIGIN])).rows;
  const calibration = calibrationReport(pairs.map((x) => ({ p: x.prob, r: x.base_rate, o: x.outcome === 'WIN' ? 1 : 0 })));

  const registered = bySeries.reduce((s, r) => s + r.registered, 0);
  const resolved = bySeries.reduce((s, r) => s + r.resolved, 0);
  const lastRegisteredAt = bySeries.reduce((m, r) => (!m || new Date(r.last_at) > new Date(m) ? r.last_at : m), null);
  const startedAt = bySeries.reduce((m, r) => (!m || new Date(r.first_at) < new Date(m) ? r.first_at : m), null);

  const alerts = [];
  if (!registered) alerts.push({ code: 'sem_registros', message: 'Nenhum registro do Termômetro no banco.' });
  const lastInsertMs = candles.reduce((m, r) => Math.max(m, new Date(r.last_insert).getTime()), 0);
  if (!candles.length) alerts.push({ code: 'sem_candles', message: 'Nenhum candle no banco.' });
  else if (nowMs - lastInsertMs > ingestMaxH * HOUR) alerts.push({ code: 'ingestao_parada', message: `Último candle inserido há mais de ${ingestMaxH} h (${iso(lastInsertMs)}).` });
  if (registered && nowMs - new Date(lastRegisteredAt).getTime() > registroMaxH * HOUR) alerts.push({ code: 'sem_registro_recente', message: `Nenhum registro novo há mais de ${registroMaxH} h (último: ${iso(lastRegisteredAt)}).` });
  for (const r of candles) {
    if (!porCandle.includes(r.timeframe)) continue;
    const lag = Math.max(0, Math.floor((nowMs - new Date(r.last_open).getTime()) / (TIMEFRAME_SECONDS[r.timeframe] * 1000)) - 1);
    if (lag >= 2) alerts.push({ code: 'serie_atrasada_por_candle', series: `${r.symbol} ${r.timeframe}`, message: `Série ${r.symbol} ${r.timeframe} com ${lag} candles de atraso (cadência por candle).` });
  }
  if (calibration.verdict === 'acima_do_acaso') alerts.push({ code: 'calibracao_fora_do_acaso', message: calibration.note });
  for (const r of overdue) alerts.push({ code: 'desfecho_atrasado', series: `${r.symbol} ${r.timeframe}`, message: `${r.n} previsão(ões) com a janela fechada e sem desfecho.` });

  return {
    status: 200,
    headers: NO_STORE,
    body: {
      generatedAt: nowIso,
      origin: ORIGIN,
      status: alerts.length ? 'atencao' : 'ok',
      alerts,
      totals: {
        registered, resolved, open: registered - resolved,
        outcomes: Object.fromEntries(outcomes.map((o) => [o.outcome, o.n])),
        startedAt: iso(startedAt), lastRegisteredAt: iso(lastRegisteredAt)
      },
      thresholds: { ingestMaxAgeH: ingestMaxH, registroMaxAgeH: registroMaxH, holdCandles: hold, porCandle },
      series: bySeries.map((r) => ({ symbol: r.symbol, timeframe: r.timeframe, registered: r.registered, resolved: r.resolved, open: r.registered - r.resolved, firstAt: iso(r.first_at), lastAt: iso(r.last_at) })),
      candles: candles.map((r) => ({ symbol: r.symbol, timeframe: r.timeframe, lastOpen: iso(r.last_open), lastInsert: iso(r.last_insert), lagCandles: Math.max(0, Math.floor((nowMs - new Date(r.last_open).getTime()) / (TIMEFRAME_SECONDS[r.timeframe] * 1000)) - 1) })),
      perDay: { registered: regDays, resolved: resDays },
      calibration,
      note: 'Contagens operacionais para o dono do produto: não são calibração nem desempenho. Dia sem registro pode ser normal (nem todo dia há gatilho no último candle).'
    }
  };
}
