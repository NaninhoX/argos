// Revisão do Relatório Estratégico (agente 4): confere o relatório com regras próprias, sem confiar no que a
// Montagem diz de si. Só lê: não altera o relatório. Passo LLM opcional, que só acrescenta achados.
// Regras que reprovam: forma, hash, origem e valor das provas, intervalo de confiança, número sem prova no
// texto, conformidade, e campos de nível de preço ou de setup do estudo v1.2 como origem de prova.
import { SETUPS_V12 } from '../../engine/index.js';
import { hashCanonical } from '../canonical.js';
import { DISCLAIMER_PADRAO, scanText } from '../compliance.js';
import { SECOES, resolverCaminho, validarRelatorio } from './contratos.js';
import { ISENCOES_IC_PENDENTES, formatarProva, formatarValor, montarSecoesDeterministicas, numerosDoTexto, temAlgarismo } from './montagem.js';
import { avaliarRisco } from './risco.js';

const NUMERO = /\d+(?:,\d+)?/g; // só para o limiar do veto (texto fixo da Montagem)
const LITERAIS_FIXOS = ['IC 95%', 'D4', 'D5', 'D9'];
const IDS_V12 = SETUPS_V12.map((s) => s.id);
const NOMES_V12 = SETUPS_V12.map((s) => s.nome);

const PROMPT_SISTEMA =
  'Você confere textos de um relatório de análise estatística. Responda só com JSON no formato ' +
  '{"achados":[{"secao":<número da seção>,"detalhe":"<texto curto>"}]}, lista vazia se não houver nada. ' +
  'Aponte trechos que: (1) digam ao leitor o que fazer com dinheiro ou posição; (2) prometam resultado; ' +
  '(3) apresentem previsão como certeza; (4) citem número que não apareça entre as provas da própria seção. ' +
  'Não reescreva nada e não calcule nada.';

const ehV12 = (x) => IDS_V12.includes(x?.id) || NOMES_V12.includes(x?.nome);
const normalizar = (c) => c.replace(/\[id=[^\]]+\]/g, '[]');
const ehNum = (x) => typeof x === 'number' && Number.isFinite(x);
const tolerancia = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Números que o texto de um bloco pode trazer por causa de uma prova (mesma formatação da Montagem). */
function tokensDe(p) {
  const t = [formatarProva(p)];
  if (Array.isArray(p.ic95)) t.push(formatarValor(p.ic95[0], p.unidade), formatarValor(p.ic95[1], p.unidade));
  if (p.n !== null) t.push(formatarValor(p.n, 'contagem'));
  if (p.nEff !== null) t.push(formatarValor(p.nEff, 'contagem'));
  if (p.pBruto !== null) t.push(formatarValor(p.pBruto, 'p'));
  if (p.pAjustado !== null) t.push(formatarValor(p.pAjustado, 'p'));
  return t.flatMap(numerosDoTexto);
}

function mascarar(texto, literais) {
  let s = texto;
  for (const l of [...LITERAIS_FIXOS, ...literais].filter(Boolean).sort((a, b) => b.length - a.length)) s = s.split(l).join(' ');
  return s;
}

/** Limiar, fonte e campo escritos pela Montagem em blocos de veto (texto fixo dela); o limiar vem do motor. */
function extrasDoVeto(texto) {
  const extras = [];
  let corpo = texto;
  const f = /, fonte do limiar .*$/.exec(corpo);
  if (f) corpo = corpo.slice(0, f.index) + ' ';
  const campo = /, campo [^,]*,/.exec(corpo);
  if (campo) corpo = corpo.replace(campo[0], ' , ');
  const lim = /, limiar (.*?),?\s*$/.exec(corpo);
  if (lim) {
    extras.push(...(lim[1].match(NUMERO) ?? []));
    corpo = corpo.slice(0, lim.index) + ' ';
  }
  return { corpo, extras };
}

/**
 * @param {object} relatorio saída de montarRelatorio
 * `risco` e `debate` são opcionais: o risco é recalculado dos summaries e, se vier por parâmetro e diferir, reprova.
 * As seções 1, 2, 4, 5 e 6 são regeradas dos summaries e comparadas por igualdade exata; a 3 (Debate) segue por regra.
 * @param {{ summaries?: object[], risco?: object, debate?: object, provider?: { chat: Function } }} [opcoes]
 * @returns {Promise<{ agente: 'revisao', aprovadoPorRegras: boolean, achados: { regra: string, secao: number | string, detalhe: string }[], llm: null | { status: 'ok' | 'falhou', achados: object[] } }>}
 */
export async function revisarRelatorio(relatorio, { summaries = [], risco, debate, provider } = {}) {
  const achados = [];
  const achar = (regra, secao, detalhe) => achados.push({ regra, secao, detalhe: String(detalhe) });

  // 1. forma, seções, disclaimer
  const v = validarRelatorio(relatorio);
  if (!v.ok) for (const e of v.erros) achar('contrato', 0, e);
  const r = relatorio !== null && typeof relatorio === 'object' ? relatorio : {};
  const secoes = Array.isArray(r.secoes) ? r.secoes : [];
  if (secoes.length !== SECOES.length || SECOES.some((s, i) => secoes[i]?.n !== s.n || secoes[i]?.titulo !== s.titulo)) {
    achar('secoes', 0, 'seções fora da ordem ou do número esperado');
  }
  if (r.disclaimer !== DISCLAIMER_PADRAO) achar('disclaimer', 0, 'disclaimer diferente do padrão');

  // 2. hash
  try {
    const { relatorioHash, ...resto } = r;
    if (hashCanonical(resto) !== relatorioHash) achar('hash', 0, 'relatorioHash não confere com o hash canônico do conteúdo');
  } catch (e) {
    achar('hash', 0, `hash não calculável: ${e.message}`);
  }

  // 3 e 6. provas contra os summaries; nível de preço e setup v1.2 como origem
  const provas = Array.isArray(r.provas) ? r.provas : [];
  const sums = Array.isArray(summaries) ? summaries : [];
  for (const p of provas) {
    const id = p?.id ?? '?';
    const o = p?.origem;
    if (!o || typeof o.caminho !== 'string') { achar('prova_origem', 0, `prova ${id} sem origem`); continue; }
    if (/^technical(\.|\[|$)/.test(o.caminho)) achar('nivel_preco', 0, `prova ${id}: caminho de nível de preço (${o.caminho})`);
    if (IDS_V12.some((sid) => o.caminho.includes(sid))) achar('setup_v12', 0, `prova ${id}: setup do estudo v1.2 (${o.caminho})`);
    const sm = sums.find((s) => s?.resultHash === o.resultHash && s?.data?.hash === o.seriesHash);
    if (!sm) {
      achar('prova_origem', 0, `prova ${id}: resultHash e seriesHash não batem com nenhum summary recebido`);
    } else {
      if (o.engine !== sm.engine) achar('motor', 0, `prova ${id}: engine da origem (${String(o.engine)}) difere do summary (${String(sm.engine)})`);
      let lido;
      try { lido = resolverCaminho(sm, o.caminho); } catch (e) { achar('prova_caminho', 0, `prova ${id}: ${e.message}`); lido = null; }
      if (lido === undefined) achar('prova_caminho', 0, `prova ${id}: caminho não resolve no summary (${o.caminho})`);
      else if (lido !== null && (!ehNum(lido) || !ehNum(p.valor) || !tolerancia(lido, p.valor))) {
        achar('prova_valor', 0, `prova ${id}: valor ${String(p.valor)} difere do summary (${String(lido)}) em ${o.caminho}`);
      }
    }
    if (p.ic95 === null && p.unidade !== 'contagem' && p.unidade !== 'p' && !ISENCOES_IC_PENDENTES.includes(normalizar(o.caminho))) {
      achar('prova_ic', 0, `prova ${id} (${o.caminho}): sem intervalo de confiança e fora de ISENCOES_IC_PENDENTES`);
    }
  }

  // literais que o texto pode trazer sem prova: séries, ids e nomes de setups
  const literaisGerais = [
    ...sums.flatMap((s) => [`${s?.input?.symbol} ${s?.input?.timeframe}`]),
    ...sums.flatMap((s) => (s?.setups ?? []).filter((x) => !ehV12(x)).flatMap((x) => [x.id, x.nome]))
  ];
  const porId = new Map(provas.map((p) => [p?.id, p]));

  // 4 e 5. números e conformidade, bloco a bloco
  secoes.forEach((sec, i) => {
    const n = sec?.n ?? i + 1;
    for (const b of Array.isArray(sec?.blocos) ? sec.blocos : []) {
      const texto = typeof b?.texto === 'string' ? b.texto : '';
      const citadas = (Array.isArray(b?.provas) ? b.provas : []).map((id) => porId.get(id)).filter((p) => p && ehNum(p.valor));
      const permitidos = new Set(citadas.flatMap(tokensDe));
      const { corpo, extras } = n === 4 ? extrasDoVeto(texto) : { corpo: texto, extras: [] };
      for (const x of extras) permitidos.add(x);
      for (const tok of numerosDoTexto(mascarar(corpo, literaisGerais))) {
        if (!permitidos.has(tok)) achar('numero_sem_prova', n, `número ${tok} sem prova citada no bloco: ${texto.slice(0, 100)}`);
      }
      // Sem caixa, depois de NFKC, e com o id também escrito com espaço ("macd zero" para macd_zero).
      const baixo = texto.normalize('NFKC').toLowerCase();
      for (const sid of [...IDS_V12, ...NOMES_V12, ...IDS_V12.map((x) => x.replace(/_/g, ' '))]) {
        if (baixo.includes(sid.toLowerCase())) achar('setup_v12', n, `setup do estudo v1.2 no texto (${sid}): ${texto.slice(0, 100)}`);
      }
      const mm = n === 3 ? /^Pré-Mortem \([^,]*, métrica ([^)]*)\):/.exec(texto) : null;
      if (mm && temAlgarismo(mm[1])) achar('numero_sem_prova', n, `número na métrica do Pré-Mortem: ${mm[1].slice(0, 60)}`);
      for (const f of scanText(texto)) achar('compliance', n, `${f.rule}: ${f.excerpt}`);
    }
  });

  // 7. motor, risco e regeração independente das seções determinísticas
  if (sums.length > 0 && sums.some((x) => x?.engine !== r.motor)) achar('motor', 0, `motor do relatório (${String(r.motor)}) difere do engine dos summaries`);
  let riscoRef = null;
  try { riscoRef = avaliarRisco(sums); } catch (e) { achar('risco_divergente', 0, `risco não recalculável: ${e.message}`); }
  if (riscoRef && risco !== undefined && risco !== null) {
    try { if (hashCanonical(risco) !== hashCanonical(riscoRef)) achar('risco_divergente', 0, 'risco recebido difere do recalculado a partir dos summaries'); }
    catch (e) { achar('risco_divergente', 0, `risco recebido inválido: ${e.message}`); }
  }
  if (riscoRef && sums.length > 0) {
    try {
      const reg = montarSecoesDeterministicas({ summaries: sums, risco: riscoRef });
      // A prova inteira entra na comparação (valor, IC, n, nEff, p, unidade, origem); só o id fica de fora.
      const chaveProva = (p) => { if (!p) return '?'; const { id: _id, ...resto } = p; try { return hashCanonical(resto); } catch { return '!'; } };
      const regenPorId = new Map(reg.provas.map((p) => [p.id, p]));
      for (const n of [1, 2, 4, 5, 6]) {
        const esperado = reg.secoes[n];
        const real = secoes.find((x) => x?.n === n)?.blocos;
        const lista = Array.isArray(real) ? real : [];
        const dif = [];
        if (lista.length !== esperado.length) dif.push(`${lista.length} blocos no lugar de ${esperado.length}`);
        esperado.forEach((e, i) => {
          const b = lista[i];
          if (!b) return;
          if (b.texto !== e.texto) dif.push(`bloco ${i + 1}: texto difere do regerado (${String(b.texto).slice(0, 80)})`);
          const ce = e.provas.map((id) => chaveProva(regenPorId.get(id))).join(';');
          const cr = (Array.isArray(b.provas) ? b.provas : []).map((id) => chaveProva(porId.get(id))).join(';');
          if (ce !== cr) dif.push(`bloco ${i + 1}: provas citadas diferem das regeradas`);
        });
        for (const d of dif) achar('secao_divergente', n, d);
      }
    } catch (e) {
      achar('secao_divergente', 0, `regeração falhou: ${e.message}`);
    }
  }
  for (const f of scanText(String(r.disclaimer ?? ''))) achar('compliance', 0, `disclaimer ${f.rule}: ${f.excerpt}`);

  const out = { agente: 'revisao', aprovadoPorRegras: achados.length === 0, achados, llm: null };

  // passo LLM opcional: só acrescenta achados, nunca aprova
  if (provider) {
    out.llm = { status: 'falhou', achados: [] };
    try {
      const texto = secoes.map((s) => `Seção ${s?.n} ${s?.titulo}\n` + (s?.blocos ?? []).map((b) => `- ${b?.texto} [provas: ${(b?.provas ?? []).join(', ')}]`).join('\n')).join('\n\n');
      const prov = provas.map((p) => `${p.id}: ${formatarProva(p)}`).join('\n');
      const resp = await provider.chat({
        messages: [{ role: 'system', content: PROMPT_SISTEMA }, { role: 'user', content: `Provas:\n${prov}\n\nTexto:\n${texto}` }],
        maxTokens: 600
      });
      let c = String(resp?.content ?? '').trim();
      const cerca = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(c);
      if (cerca) c = cerca[1];
      const j = JSON.parse(c);
      if (!j || !Array.isArray(j.achados)) throw new Error('formato');
      out.llm = {
        status: 'ok',
        achados: j.achados.filter((a) => a && typeof a.detalhe === 'string' && a.detalhe).map((a) => ({
          regra: 'llm_conformidade', secao: Number.isInteger(a.secao) ? a.secao : 0, detalhe: a.detalhe.slice(0, 300)
        }))
      };
    } catch {
      out.llm = { status: 'falhou', achados: [] };
    }
  }
  return out;
}
