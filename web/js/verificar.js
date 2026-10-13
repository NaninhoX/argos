// Página "Verificar prova". Busca o registro em GET /api/proof e refaz as contas no navegador
// (proof-verify.js). O registro exibido vem de JSON.parse(canonical), o mesmo texto cujo hash é conferido;
// nenhum outro campo da resposta alimenta os números da tela. Todo texto de origem externa entra por
// textContent (nunca innerHTML). Contrato da API: docs/api-proof.md.
import { checkProof, overallState, anchorStatusText, otsCommand, sha256Hex } from './proof-verify.js';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const HASH_RE = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/;
const PT = 'pt-BR';

const MSG = {
  carregando: 'Consultando o registro...',
  semParametro: 'Cole o id ou o hash do registro para verificar.',
  invalido: 'Id ou hash inválido. Use um uuid ou 64 caracteres hexadecimais.',
  naoEncontrado: 'Registro não encontrado.',
  rede: 'Não foi possível consultar o servidor. Verifique a conexão e tente de novo.',
  servidor: (status) => `O servidor não respondeu como esperado (código ${status}). Tente de novo mais tarde.`,
  ilegivel: 'O texto canônico não pôde ser lido como registro. As etapas de verificação continuam valendo.'
};

const BANNER = {
  confere: ['A verificação confere', 'O hash, o caminho de Merkle e o manifesto foram conferidos neste navegador. O carimbo se verifica fora dele (etapa 4).'],
  nao_confere: ['A verificação não confere', 'Pelo menos uma verificação falhou. Como recebido, este registro não pode ser tomado como prova.'],
  aguardando: ['Hash conferido, dia ainda aberto', 'O hash do registro confere. As demais etapas dependem do fechamento do dia (UTC).'],
  indeterminado: ['Verificação incompleta', 'Este navegador não concluiu as contas. Veja o detalhe de cada etapa.']
};

const TIMEFRAME = { '1h': '1 hora', '4h': '4 horas', '1d': '1 dia' };
const METHOD = { wilson: 'Wilson', bayes_beta_binomial: 'Bayes beta-binomial' };
const OUTCOME = {
  WIN: 'Alvo atingido antes do stop',
  LOSS: 'Stop atingido antes do alvo',
  TIMEOUT: 'Prazo esgotado sem atingir alvo nem stop'
};

const $ = (id) => document.getElementById(id);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------- DOM

/** Cria um elemento. Filhos de texto entram como nós de texto; nada é interpretado como HTML. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

function legacyCopy(text) {
  const ta = h('textarea', { readonly: true, style: 'position:fixed;top:-1000px;opacity:0' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

async function copyText(text, btn) {
  const original = btn.textContent;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = legacyCopy(text); }
  btn.textContent = ok ? 'Copiado' : 'Não foi possível copiar';
  setTimeout(() => { btn.textContent = original; }, 1800);
}

const copyButton = (label, text) => h('button', { class: 'btn', type: 'button', onclick: (e) => copyText(text, e.currentTarget) }, label);

function setMsg(text, kind, retry) {
  const el = $('msg');
  el.className = 'msg' + (kind ? ' ' + kind : '');
  el.replaceChildren();
  if (!text) return;
  el.append(text);
  if (retry) el.append(h('div', null, h('button', { class: 'btn', type: 'button', onclick: retry }, 'Tentar de novo')));
}

// --------------------------------------------------------- formatação

const nf = (min, max) => new Intl.NumberFormat(PT, { minimumFractionDigits: min, maximumFractionDigits: max });
const fmtInt = (v) => nf(0, 0).format(v);
const fmtDec = (v) => nf(0, 4).format(v);
const fmtPct = (v, d = 1) => nf(d, d).format(v * 100) + '%';
const fmtP = (v) => nf(v >= 0.01 ? 3 : 4, v >= 0.01 ? 3 : 4).format(v);
/** undefined: campo ausente (a linha some). null ou não finito: o motor não tinha valor. */
const num = (v, f) => (v === undefined ? undefined : isNum(v) ? f(v) : 'sem valor');

function validDate(iso) {
  if (typeof iso !== 'string') return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
const utc = (iso) => {
  if (iso === undefined) return undefined;
  if (iso === null) return 'sem valor';
  const d = validDate(iso);
  return d ? d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : String(iso);
};
const utcDay = (iso) => { const d = validDate(iso); return d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : String(iso); };
function localTime(iso) {
  const d = validDate(iso);
  return d ? new Intl.DateTimeFormat(PT, {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
  }).format(d) : undefined;
}

/** Regra de saída do teste, em texto. */
function exitRule(cfg) {
  if (!isObj(cfg)) return undefined;
  const tgt = num(cfg.tgt, fmtDec) ?? 'sem valor', stp = num(cfg.stp, fmtDec) ?? 'sem valor', hold = num(cfg.hold, fmtInt) ?? 'sem valor';
  if (cfg.mode === 'atr') return `alvo ${tgt}×ATR, stop ${stp}×ATR, prazo ${hold} candles`;
  if (cfg.mode === 'pct') return `alvo ${tgt}%, stop ${stp}%, prazo ${hold} candles`;
  return `modo ${cfg.mode}: alvo ${tgt}, stop ${stp}, prazo ${hold} candles`;
}

function parseRecord(canonical) {
  if (typeof canonical !== 'string') return null;
  try { const r = JSON.parse(canonical); return isObj(r) ? r : null; } catch { return null; }
}

/** Linha de lista de definições; some se o valor é undefined, vazio ou falso. */
function row(label, value, extra) {
  if (value === undefined || value === null || value === '' || value === false) return null;
  return [h('dt', null, label), h('dd', extra ? { class: extra } : null, value)];
}

// ------------------------------------------------------------- seções

const section = (title, ...kids) => h('section', { class: 'card' }, h('h2', null, title), ...kids);

function stepCard(step, hasAnchor) {
  let cls, badge;
  if (step.ok === true) [cls, badge] = ['ok', 'Confere'];
  else if (step.ok === false) [cls, badge] = ['fail', 'Não confere'];
  else if (step.key === 'ots' && hasAnchor) [cls, badge] = ['ext', 'Verificação externa'];
  else if (step.key === 'hash' || hasAnchor) [cls, badge] = ['wait', 'Não verificado'];
  else [cls, badge] = ['wait', 'Aguardando'];
  return h('li', { class: 'step ' + cls },
    h('div', { class: 'step-head' }, h('h3', null, step.title), h('span', { class: 'badge' }, badge)),
    h('p', null, step.detail));
}

function resultCard(steps, state, warnings, hasAnchor) {
  const [title, text] = BANNER[state];
  return section('Resultado da verificação',
    h('div', { class: 'banner ' + state }, h('strong', null, title), h('span', null, text)),
    warnings.map((w) => h('p', { class: 'alert' }, w)),
    h('ol', { class: 'steps' }, steps.map((s) => stepCard(s, hasAnchor))));
}

function recordCard(rec, hashOk) {
  if (!rec) return section('Registro', h('p', { class: 'dim' }, MSG.ilegivel));
  const input = isObj(rec.input) ? rec.input : {};
  const data = isObj(rec.data) ? rec.data : {};
  const regime = isObj(rec.regime) ? rec.regime : {};
  const base = isObj(rec.base) ? rec.base : {};
  const setup = isObj(rec.setup) ? rec.setup : {};
  const verdict = isObj(setup.verdict) ? setup.verdict : {};

  const symbol = [input.symbol, TIMEFRAME[input.timeframe] ?? input.timeframe].filter(Boolean).join(', ');
  const setupName = setup.nome ? (setup.id ? `${setup.nome} (${setup.id})` : setup.nome) : setup.id;
  const win = isNum(input.windowDays) ? `${fmtInt(input.windowDays)} dias` : input.windowDays === null ? 'série inteira' : undefined;
  const period = data.from !== undefined || data.to !== undefined ? `${utc(data.from) ?? 'sem valor'} a ${utc(data.to) ?? 'sem valor'}` : undefined;
  const candles = isNum(data.candles)
    ? `${fmtInt(data.candles)} candles` + (isNum(data.warmupCandles) ? `, dos quais ${fmtInt(data.warmupCandles)} servem de aquecimento do motor` : '')
    : undefined;
  const regimeName = regime.label ?? regime.regime;
  const regimeWhen = [isNum(regime.bars) ? `há ${fmtInt(regime.bars)} candles` : null, regime.since ? `desde ${utc(regime.since)}` : null].filter(Boolean).join(', ');
  const baseRate = base.rate !== undefined ? base.rate : setup.base;
  const ci = Array.isArray(setup.ci) ? (isNum(setup.ci[0]) && isNum(setup.ci[1]) ? `${fmtPct(setup.ci[0])} a ${fmtPct(setup.ci[1])}` : 'sem valor') : undefined;
  const emitted = rec.emittedAt;

  const rows = [
    row('Ativo e tempo gráfico', symbol),
    row('Setup', setupName),
    row('Definição', setup.def),
    row('Regra de saída', exitRule(input.cfg)),
    row('Janela da série', win),
    row('Período', period),
    row('Candles', candles),
    row('Regime no corte', regimeName ? [regimeName, regimeWhen ? h('span', { class: 'dim' }, regimeWhen) : null] : undefined),
    row('N', num(setup.n, fmtInt)),
    row('N efetivo', num(setup.nEff, fmtInt)),
    row('Taxa de acerto', num(setup.winRate, fmtPct)),
    row('IC 95%', ci),
    row('Método do IC', setup.method ? (METHOD[setup.method] ?? String(setup.method)) : undefined),
    row('Taxa-base', num(baseRate, fmtPct)),
    row('Candles na taxa-base', num(base.n, fmtInt)),
    row('p (bilateral, por permutação)', num(setup.pTwo, fmtP)),
    row('p ajustado (q)', num(setup.q, fmtP) === undefined ? undefined
      : [num(setup.q, fmtP), isNum(setup.family) ? h('span', { class: 'dim' }, `Benjamini-Hochberg, família de ${fmtInt(setup.family)} setups`) : null]),
    row('Veredito', verdict.label, 'verdict'),
    row('Último gatilho', setup.lastTriggerTime ? [utc(setup.lastTriggerTime), setup.activeNow === true ? h('span', { class: 'dim' }, 'ativo no corte') : null] : undefined),
    row('Versão do motor', rec.engine),
    row('Origem', rec.origin),
    row('Registrado em', emitted ? [utc(emitted), localTime(emitted) ? h('span', { class: 'dim' }, localTime(emitted) + ', hora local') : null] : undefined),
    row('Hash da série', data.hash ? h('span', { class: 'mono' }, data.hash) : undefined),
    row('resultHash', rec.resultHash ? h('span', { class: 'mono' }, rec.resultHash) : undefined)
  ].filter(Boolean).flat();

  return section('Registro lido do texto canônico',
    hashOk
      ? h('p', { class: 'dim small' }, 'Estes valores vêm do mesmo texto cujo hash foi conferido na etapa 1. O motor os calculou; esta página só os formata.')
      : h('p', { class: 'alert' }, 'O hash do texto não foi confirmado na etapa 1. Os valores abaixo não têm prova.'),
    h('dl', { class: 'kv' }, rows));
}

function hashCard(canonical, calc, informed, target) {
  const kids = [h('div', { class: 'label' }, 'Hash do registro (SHA-256, recalculado neste navegador)')];
  if (calc) {
    kids.push(h('div', { class: 'hashbox' }, calc));
    kids.push(h('div', { class: 'actions' }, copyButton('Copiar hash', calc)));
    if (target.kind === 'hash' && target.value === calc) kids.push(h('p', { class: 'dim small' }, 'É igual ao hash pedido na URL.'));
  } else {
    kids.push(h('p', { class: 'dim' }, 'Este navegador não calculou o hash.'));
  }
  if (informed && informed !== calc) {
    kids.push(h('div', { class: 'label' }, 'Hash informado pelo servidor'));
    kids.push(h('div', { class: 'hashbox bad' }, informed));
  }
  if (typeof canonical === 'string' && canonical) {
    const blobUrl = URL.createObjectURL(new Blob([canonical], { type: 'text/plain;charset=utf-8' }));
    const file = `argos-registro-${(calc || 'texto').slice(0, 12)}.json`;
    kids.push(h('details', null,
      h('summary', null, `Texto canônico (${fmtInt(canonical.length)} caracteres)`),
      h('div', { class: 'actions' },
        copyButton('Copiar texto', canonical),
        h('a', { class: 'btn quiet', href: blobUrl, download: file }, 'Baixar o texto')),
      h('pre', null, canonical),
      h('p', { class: 'dim small' }, `Para conferir fora daqui, salve o texto exato num arquivo, sem quebra de linha no fim, e rode sha256sum nele. O resultado deve ser o hash acima. O botão "Baixar o texto" já entrega o arquivo nesse formato.`)));
  }
  return section('Hash e texto canônico', ...kids);
}

/** Aceita só caminho relativo ao próprio site; qualquer outra coisa (esquema, //host) é descartada. */
const safePath = (u) => (typeof u === 'string' && /^\/(?!\/)/.test(u) ? u : null);

function anchorCard(anchor) {
  let m = null;
  if (typeof anchor.manifest === 'string') { try { m = JSON.parse(anchor.manifest); } catch { m = null; } }
  if (!isObj(m)) m = {};
  const day = m.day ?? anchor.day;
  const root = m.root ?? anchor.root;
  const nLeaves = m.nLeaves ?? anchor.nLeaves;
  const manifestUrl = safePath(anchor.manifestUrl);
  const otsUrl = safePath(anchor.otsUrl);
  const files = [];
  if (manifestUrl) files.push(h('a', { class: 'btn', href: manifestUrl, download: `argos-raiz-${day}.json` }, 'Baixar o manifesto'));
  if (otsUrl) files.push(h('a', { class: 'btn', href: otsUrl, download: `argos-raiz-${day}.json.ots` }, 'Baixar o recibo .ots'));

  const rows = [
    row('Dia (UTC)', day),
    row('Registros no dia', isNum(nLeaves) ? fmtInt(nLeaves) : undefined),
    row('Raiz do dia', root ? h('span', { class: 'mono' }, root) : undefined),
    row('SHA-256 do manifesto', anchor.manifestSha256 ? h('span', { class: 'mono' }, anchor.manifestSha256) : undefined),
    row('Status do carimbo', [String(anchor.status ?? 'desconhecido'), h('span', { class: 'dim' }, anchorStatusText(anchor.status))])
  ].filter(Boolean).flat();

  return section('Âncora do dia',
    h('dl', { class: 'kv' }, rows),
    files.length ? h('div', { class: 'actions' }, files) : null,
    otsUrl ? null : h('p', { class: 'dim' }, 'O recibo .ots ainda não está disponível.'),
    h('p', null,
      'Baixe os dois arquivos na mesma pasta e verifique com qualquer cliente OpenTimestamps (',
      h('code', null, otsCommand(day)),
      ') ou em ',
      h('a', { href: 'https://opentimestamps.org', target: '_blank', rel: 'noopener noreferrer' }, 'opentimestamps.org'),
      '.'));
}

function pendingCard(pending, reload) {
  const when = isObj(pending) && pending.expectedAfter ? utcDay(pending.expectedAfter) : null;
  const day = isObj(pending) && pending.day ? pending.day : null;
  return section('Fechamento do dia',
    h('p', null, 'Aguardando o fechamento do dia' + (day ? ` (${day}, UTC)` : '') + '. A raiz do dia e o carimbo só existem depois que o dia termina.'),
    when ? h('p', { class: 'dim' }, `Previsto para depois de ${when}.`) : null,
    h('p', { class: 'dim' }, 'Guarde este link e volte mais tarde: as etapas 2 a 4 serão refeitas então.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn quiet', type: 'button', onclick: reload }, 'Verificar de novo')));
}

function desfechoCard(d) {
  const rows = [
    row('Resultado', OUTCOME[d.outcome] ?? (d.outcome ? String(d.outcome) : undefined)),
    row('Variação do preço até a saída', isNum(d.ret) ? (d.ret > 0 ? '+' : '') + nf(2, 2).format(d.ret * 100) + '%' : undefined),
    row('Candles até a saída', isNum(d.bars) ? fmtInt(d.bars) : undefined),
    row('Candle do gatilho', d.barTime ? utc(d.barTime) : undefined),
    row('Resolvido em', d.resolvedAt ? [utc(d.resolvedAt), localTime(d.resolvedAt) ? h('span', { class: 'dim' }, localTime(d.resolvedAt) + ', hora local') : null] : undefined)
  ].filter(Boolean).flat();
  return section('Desfecho',
    h('dl', { class: 'kv' }, rows),
    h('p', { class: 'dim small' }, 'O desfecho é registrado depois da previsão e não entra no hash dela. Alvo e stop são os parâmetros da regra de saída do teste.'));
}

// ----------------------------------------------------------- fluxo

/** Procura um uuid ou um hash de 64 hexadecimais em texto colado ou vindo da URL. */
function parseTarget(text) {
  const s = String(text ?? '').trim().toLowerCase();
  const uuid = s.match(UUID_RE);
  if (uuid) return { kind: 'id', value: uuid[0] };
  const hash = s.match(HASH_RE);
  if (hash) return { kind: 'hash', value: hash[0] };
  return null;
}

async function fetchProof(target) {
  let res;
  try {
    res = await fetch('/api/proof?' + target.kind + '=' + encodeURIComponent(target.value), { headers: { accept: 'application/json' }, cache: 'no-store' });
  } catch { return { error: MSG.rede, retry: true }; }
  if (res.status === 404) return { error: MSG.naoEncontrado };
  if (res.status === 400) return { error: MSG.invalido };
  if (!res.ok) return { error: MSG.servidor(res.status), retry: true };
  try { return { body: await res.json() }; } catch { return { error: MSG.servidor(res.status), retry: true }; }
}

async function hashOf(text) {
  if (typeof text !== 'string' || !text) return null;
  try { return await sha256Hex(text); } catch { return null; }
}

async function render(body, target, reload) {
  const b = isObj(body) ? body : {};
  const anchor = isObj(b.anchor) ? b.anchor : null;
  const prev = isObj(b.previsao) ? b.previsao : {};
  const steps = await checkProof(b);
  let state = overallState(steps);
  const calc = await hashOf(b.canonical);

  // O servidor tem de devolver o registro que foi pedido.
  const warnings = [];
  if (target.kind === 'hash' && calc && calc !== target.value) warnings.push('O hash recalculado do texto recebido é diferente do hash pedido na URL.');
  if (target.kind === 'id' && typeof prev.id === 'string' && prev.id.toLowerCase() !== target.value) warnings.push('O servidor devolveu um registro com id diferente do pedido.');
  if (warnings.length) state = 'nao_confere';

  const nodes = [
    resultCard(steps, state, warnings, Boolean(anchor)),
    recordCard(parseRecord(b.canonical), steps[0].ok === true),
    hashCard(b.canonical, calc, typeof prev.hash === 'string' ? prev.hash : null, target),
    anchor ? anchorCard(anchor) : pendingCard(b.anchorPending, reload),
    isObj(b.desfecho) ? desfechoCard(b.desfecho) : null
  ];
  $('result').replaceChildren(...nodes.filter(Boolean));
  $('result').hidden = false;

  const disc = $('disclaimer');
  if (typeof b.disclaimer === 'string' && b.disclaimer) { disc.textContent = b.disclaimer; disc.hidden = false; }
}

async function load(target) {
  $('result').hidden = true;
  setMsg(MSG.carregando);
  const r = await fetchProof(target);
  if (r.error) {
    $('lookup').hidden = false;
    setMsg(r.error, 'erro', r.retry ? () => load(target) : null);
    return;
  }
  setMsg('');
  try {
    await render(r.body, target, () => load(target));
  } catch (err) {
    setMsg('Não foi possível montar a página com a resposta recebida.', 'erro', () => load(target));
    console.error(err);
  }
}

function main() {
  const form = $('lookup');
  const input = $('q');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = parseTarget(input.value);
    if (!t) { setMsg(MSG.invalido, 'erro'); input.focus(); return; }
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set(t.kind, t.value);
    location.assign(url.toString());
  });

  const params = new URLSearchParams(location.search);
  const raw = [params.get('id'), params.get('hash')].find((v) => v !== null && v.trim() !== '') ?? null;
  if (raw === null) {
    form.hidden = false;
    setMsg(MSG.semParametro);
    return;
  }
  input.value = raw;
  const target = parseTarget(raw);
  if (!target) {
    form.hidden = false;
    setMsg(MSG.invalido, 'erro');
    return;
  }
  load(target);
}

main();
