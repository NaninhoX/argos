// Agente Debate do Relatório Estratégico: pede ao LLM prós, contras e pré-mortem das teses em avaliação,
// só com base nas provas do motor. O LLM nunca calcula nem inventa número: todo texto passa por checkNumbers
// (pool = números das provas), scanText e conferência de ids antes de sair. Texto reprovado nunca é devolvido.
import { checkNumbers } from '../ai/numeric-guard.js';
import { scanText } from '../compliance.js';
import { validarDebateSaida } from './contratos.js';

export const LIMITES_PADRAO = Object.freeze({ maxChamadas: 4, maxTokensSaida: 1500 });
const MAX_RETENTATIVAS = 2;
const ESTADOS_DEBATE = ['em_avaliacao', 'veto_risco'];
// Códigos de ProviderError que valem nova tentativa; saldo, credencial e pedido recusado não valem.
const TRANSITORIOS = new Set(['timeout', 'network', 'upstream_error', 'rate_limited']);

const SYSTEM = [
  'Você redige o debate estatístico de um relatório de pesquisa quantitativa.',
  'Escreva só prós e contras estatísticos de cada tese. Nenhum conselho sobre o que fazer com dinheiro, nenhuma indicação de operação, nenhuma promessa de resultado.',
  'Cite as provas pelo id (P1, P2...) no campo "provas" de cada argumento. Todo argumento cita ao menos uma prova.',
  'Não escreva nenhum número que não esteja nas provas recebidas. Não calcule, não some, não arredonde de outro jeito.',
  'Em "preMortem", cada item aponta em "provaLimiar" o id de uma prova existente que serve de limiar de falha; não invente limiar.',
  'Responda só com JSON, sem texto fora dele, neste formato:',
  '{"itens":[{"setupId":"...","pros":[{"texto":"...","provas":["P1"]}],"contras":[{"texto":"...","provas":["P2"]}],"preMortem":[{"metrica":"...","provaLimiar":"P3","texto":"..."}]}]}'
].join('\n');

class Falha extends Error {}

const ehObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function poolDeProvas(provas) {
  const pool = [];
  for (const p of provas) {
    for (const v of [p.valor, p.n, p.nEff, p.pBruto, p.pAjustado, ...(Array.isArray(p.ic95) ? p.ic95 : [])]) {
      if (typeof v === 'number' && Number.isFinite(v)) pool.push(v);
    }
  }
  return pool;
}

function somarUso(uso, u) {
  if (!ehObj(u)) return;
  const i = u.prompt_tokens ?? u.input_tokens ?? u.tokensIn;
  const o = u.completion_tokens ?? u.output_tokens ?? u.tokensOut;
  if (Number.isFinite(i) && i > 0) uso.tokensIn += Math.trunc(i);
  if (Number.isFinite(o) && o > 0) uso.tokensOut += Math.trunc(o);
}

function extrairJson(texto) {
  let s = String(texto ?? '').trim();
  const cerca = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (cerca) s = cerca[1];
  try { return { ok: true, valor: JSON.parse(s) }; } catch { return { ok: false, motivo: 'a resposta não é JSON válido' }; }
}

/** Confere forma, ids, números e termos. Devolve a lista de motivos (vazia = aprovado) e os itens normalizados. */
function conferir(json, setupsEsperados, idsProva, pool) {
  if (!ehObj(json) || !Array.isArray(json.itens)) return { motivos: ['faltou a lista "itens"'], itens: [] };
  const itens = json.itens.map((it) => ({
    setupId: ehObj(it) ? it.setupId : undefined,
    pros: ehObj(it) ? it.pros : undefined,
    contras: ehObj(it) ? it.contras : undefined,
    preMortem: ehObj(it) ? it.preMortem : undefined
  }));
  const forma = validarDebateSaida({ agente: 'debate', status: 'ok', itens, uso: { tokensIn: 0, tokensOut: 0 } });
  if (!forma.ok) return { motivos: forma.erros.slice(0, 6), itens: [] };

  const motivos = [];
  const vistos = new Set();
  const textos = [];
  const ids = [];
  itens.forEach((it, i) => {
    if (!setupsEsperados.has(it.setupId)) motivos.push(`itens[${i}].setupId "${it.setupId}" não é uma das teses pedidas`);
    else if (vistos.has(it.setupId)) motivos.push(`setupId "${it.setupId}" repetido`);
    vistos.add(it.setupId);
    for (const a of [...it.pros, ...it.contras]) {
      textos.push(a.texto);
      if (a.provas.length === 0) motivos.push(`argumento sem prova em "${it.setupId}"`);
      ids.push(...a.provas);
    }
    for (const m of it.preMortem) {
      // O número do Pré-Mortem só pode vir da prova citada em provaLimiar, nunca do nome da métrica.
      if (/\p{N}/u.test(String(m.metrica ?? '').normalize('NFKC'))) motivos.push(`métrica sem dígito: "${m.metrica}" (o número vem da prova em provaLimiar)`);
      textos.push(m.metrica, m.texto); ids.push(m.provaLimiar);
    }
  });
  for (const s of setupsEsperados) if (!vistos.has(s)) motivos.push(`faltou o item da tese "${s}"`);

  const inexistentes = [...new Set(ids.filter((id) => !idsProva.has(id)))];
  if (inexistentes.length) motivos.push(`ids de prova que não existem: ${inexistentes.join(', ')}`);

  const junto = textos.join('\n');
  const num = checkNumbers(junto, pool);
  if (!num.ok) motivos.push(`números fora das provas: ${num.unknown.map((u) => u.raw).join(', ')}`);
  const achados = scanText(junto);
  if (achados.length) motivos.push(`termos não permitidos: ${[...new Set(achados.map((a) => a.term))].join(', ')}`);
  return { motivos, itens };
}

/**
 * @param {{ teses: { serie: object, setupId: string, estado: string, vetos: object[] }[], provas: object[], provider: { chat: Function }, limites?: { maxChamadas?: number, maxTokensSaida?: number } }} args
 * @returns {Promise<{ agente: 'debate', status: 'ok' | 'falhou', itens: object[], uso: { tokensIn: number, tokensOut: number }, motivo?: string }>}
 */
export async function rodarDebate({ teses, provas, provider, limites } = {}) {
  const lim = { ...LIMITES_PADRAO, ...(limites || {}) };
  const uso = { tokensIn: 0, tokensOut: 0 };
  const falhou = (motivo) => ({ agente: 'debate', status: 'falhou', itens: [], uso, motivo });

  const lista = (Array.isArray(teses) ? teses : []).filter((t) => ehObj(t) && ESTADOS_DEBATE.includes(t.estado));
  if (lista.length === 0) return { agente: 'debate', status: 'ok', itens: [], uso };
  const provasOk = Array.isArray(provas) ? provas.filter(ehObj) : [];
  if (!provider || typeof provider.chat !== 'function') return falhou('provedor ausente');

  const idsProva = new Set(provasOk.map((p) => p.id));
  const pool = poolDeProvas(provasOk);
  const setups = new Set(lista.map((t) => t.setupId));
  let chamadas = 0;

  async function chamar(messages) {
    let transitorios = 0;
    for (;;) {
      if (chamadas >= lim.maxChamadas) throw new Falha('teto de chamadas ao provedor atingido');
      chamadas += 1;
      try {
        const r = await provider.chat({ messages, maxTokens: lim.maxTokensSaida });
        somarUso(uso, r && r.usage);
        return String((r && r.content) ?? '');
      } catch (e) {
        const code = e && e.code;
        if (!TRANSITORIOS.has(code)) throw new Falha(code === 'insufficient_balance' ? 'conta do provedor sem saldo' : 'erro do provedor sem nova tentativa');
        transitorios += 1;
        if (transitorios > MAX_RETENTATIVAS) throw new Falha('provedor indisponível após as retentativas');
      }
    }
  }

  const pedido = {
    teses: lista.map((t) => ({ serie: t.serie, setupId: t.setupId, estado: t.estado, vetos: (t.vetos || []).map((v) => ({ regra: v.regra, campo: v.campo })) })),
    provas: provasOk.map((p) => ({ id: p.id, valor: p.valor, unidade: p.unidade, ic95: p.ic95, n: p.n, nEff: p.nEff, pBruto: p.pBruto, pAjustado: p.pAjustado, caminho: p.origem && p.origem.caminho }))
  };
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: 'Teses e provas do motor (JSON):\n' + JSON.stringify(pedido) }
  ];

  try {
    let texto = await chamar(messages);
    for (let reparo = 0; ; reparo++) {
      const j = extrairJson(texto);
      const c = j.ok ? conferir(j.valor, setups, idsProva, pool) : { motivos: [j.motivo], itens: [] };
      if (c.motivos.length === 0) {
        const saida = { agente: 'debate', status: 'ok', itens: c.itens, uso };
        return validarDebateSaida(saida).ok ? saida : falhou('saída fora do contrato');
      }
      if (reparo >= 1) return falhou('resposta reprovada após o reparo: ' + c.motivos.join('; '));
      messages.push({ role: 'assistant', content: texto });
      messages.push({ role: 'user', content: 'A resposta foi reprovada: ' + c.motivos.join('; ') + '. Refaça o JSON inteiro corrigindo isso, usando só números e ids das provas.' });
      texto = await chamar(messages);
    }
  } catch (e) {
    if (e instanceof Falha) return falhou(e.message);
    throw e;
  }
}

const SYSTEM_VETO = 'Explique em até duas frases curtas, em português, por que a regra de risco barrou a tese. Só descreva a regra e a medida; nenhum conselho, nenhuma indicação de operação. Use apenas os números recebidos. Responda só com o texto.';

function textoFixoVeto(veto) {
  return `Regra "${veto.regra}": o valor medido foi ${String(veto.valor)} e o limiar da regra é ${String(veto.limiar)}.`;
}

/**
 * Texto curto sobre um veto do Risco. Se o provedor falhar ou o texto reprovar, devolve o texto fixo.
 * @param {{ veto: { regra: string, campo?: string, valor: unknown, limiar: unknown }, provider: { chat: Function } }} args
 * @returns {Promise<string>}
 */
export async function explicarVeto({ veto, provider } = {}) {
  const fixo = textoFixoVeto(veto || {});
  if (!veto || !provider || typeof provider.chat !== 'function') return fixo;
  try {
    const r = await provider.chat({
      messages: [
        { role: 'system', content: SYSTEM_VETO },
        { role: 'user', content: JSON.stringify({ regra: veto.regra, campo: veto.campo, valor: veto.valor, limiar: veto.limiar }) }
      ],
      maxTokens: 200
    });
    const t = String((r && r.content) ?? '').trim();
    if (!t || t.length > 600) return fixo;
    if (scanText(t).length) return fixo;
    const pool = [veto.valor, veto.limiar].filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!checkNumbers(t, pool).ok) return fixo;
    return t;
  } catch {
    return fixo;
  }
}
