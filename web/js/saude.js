// Painel interno do Termômetro: consulta GET /api/termometro/status com o código digitado e mostra o resultado.
// O código fica só em memória (variável do módulo); nunca vai para storage, URL ou log.
const $ = (id) => document.getElementById(id);
let code = '';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }) + ' UTC' : '—');
const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d).replace('.', ',') + ' p.p.' : '—');
const table = (head, rows) => '<div class="tw"><table><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';

function render(j) {
  const t = j.totals, c = j.calibration;
  const alerts = j.alerts.length ? '<ul class="alerts">' + j.alerts.map((a) => '<li><code>' + esc(a.code) + '</code>' + (a.series ? ' · ' + esc(a.series) : '') + ': ' + esc(a.message) + '</li>').join('') + '</ul>' : '<p class="dim small">Nenhum alerta.</p>';
  const outcomes = Object.entries(t.outcomes || {}).map(([k, v]) => k + ' ' + v).join(' · ') || '—';
  const calib = c.n < c.minimum
    ? '<p>' + esc(c.note) + '</p>'
    : '<p>ECE <b>' + pct(c.ece) + '</b> · BSS <b>' + (Number.isFinite(c.bss) ? (c.bss * 100).toFixed(1).replace('.', ',') + '%' : '—') + '</b> · ' + esc(c.n) + ' resolvidas.</p><p class="dim small">Faixa de acaso de um motor perfeitamente calibrado, com este N: mediana ' + pct(c.noise.eceMedian) + ' e P90 ' + pct(c.noise.eceP90) + ' — ' + esc(c.note) + '</p>' +
      table(['Faixa de p', 'N', 'previsto', 'ocorreu', 'confiável'], c.bins.map((b) => [(b.lo * 100).toFixed(0) + '–' + Math.min(100, b.hi * 100).toFixed(0) + '%', b.n, (b.pred * 100).toFixed(1).replace('.', ',') + '%', (b.obs * 100).toFixed(1).replace('.', ',') + '%', b.reliable ? 'sim' : 'não (N < 30)']));
  $('out').innerHTML =
    '<div class="banner ' + esc(j.status) + '"><strong>' + (j.status === 'ok' ? 'Tudo em dia' : 'Atenção') + '</strong><span class="dim small">Gerado em ' + fmtDate(j.generatedAt) + '</span></div>' +
    '<div class="card"><h2>Alertas</h2>' + alerts + '</div>' +
    '<div class="card"><h2>Registros</h2><div class="grid">' +
      [['Registradas', t.registered], ['Com desfecho', t.resolved], ['Em aberto', t.open]].map(([k, v]) => '<div class="num"><b>' + esc(v) + '</b><span>' + k + '</span></div>').join('') + '</div>' +
      '<p class="dim small">Desfechos: ' + esc(outcomes) + ' · primeiro registro: ' + fmtDate(t.startedAt) + ' · último: ' + fmtDate(t.lastRegisteredAt) + '</p></div>' +
    '<div class="card"><h2>Por série</h2>' + table(['Ativo', 'Tempo', 'Registradas', 'Resolvidas', 'Em aberto', 'Último registro'], j.series.map((s) => [s.symbol, s.timeframe, s.registered, s.resolved, s.open, fmtDate(s.lastAt)])) + '</div>' +
    '<div class="card"><h2>Candles no banco</h2>' + table(['Ativo', 'Tempo', 'Último candle', 'Última inserção', 'Atraso (candles)'], j.candles.map((s) => [s.symbol, s.timeframe, fmtDate(s.lastOpen), fmtDate(s.lastInsert), s.lagCandles])) + '</div>' +
    '<div class="card"><h2>Calibração interna</h2>' + calib + '</div>' +
    '<div class="card"><h2>Últimos 14 dias</h2>' + table(['Dia (UTC)', 'Registradas', 'Resolvidas'], dayRows(j.perDay)) + '</div>' +
    '<p class="dim small">' + esc(j.note) + ' Limiares: ingestão ' + esc(j.thresholds.ingestMaxAgeH) + ' h, sem registro ' + esc(j.thresholds.registroMaxAgeH) + ' h' + (j.thresholds.porCandle.length ? ', por candle: ' + esc(j.thresholds.porCandle.join(', ')) : '') + '.</p>';
  $('out').hidden = false;
}

function dayRows(perDay) {
  const days = new Map();
  for (const r of perDay.registered) days.set(r.day, { reg: r.n, res: 0 });
  for (const r of perDay.resolved) days.set(r.day, { reg: (days.get(r.day) || { reg: 0 }).reg, res: r.n });
  return [...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([d, v]) => [d, v.reg, v.res]);
}

async function consultar() {
  const msg = $('msg');
  msg.className = 'msg'; msg.textContent = 'Consultando…'; $('out').hidden = true;
  let r;
  try { r = await fetch('/api/termometro/status', { headers: { 'x-argos-code': code }, cache: 'no-store' }); }
  catch { msg.className = 'msg erro'; msg.textContent = 'Sem conexão com o servidor.'; return; }
  let j = null; try { j = await r.json(); } catch { /* corpo sem JSON */ }
  if (r.status === 401) { msg.className = 'msg erro'; msg.textContent = 'Código incorreto.'; code = ''; $('refresh').hidden = true; return; }
  if (!r.ok || !j || !j.totals) { msg.className = 'msg erro'; msg.textContent = (j && j.error && j.error.message) || 'Erro ' + r.status + ' ao consultar o painel.'; return; }
  msg.textContent = ''; $('refresh').hidden = false; render(j);
}

$('form').addEventListener('submit', (e) => { e.preventDefault(); code = $('code').value.trim(); $('code').value = ''; if (code) consultar(); });
$('refresh').addEventListener('click', () => { if (code) consultar(); });
