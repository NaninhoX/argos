// Conformidade textual da Stratum Research: disclaimer padrão e verificação de vocabulário.
//
// Origem do vocabulário: porte fiel de `scanTerms` do cliente legado (HTML da demo v1.1,
// bloco `06-live`: lista BANNED, regex NEG e função scanTerms). Os padrões marcados "legado"
// são os mesmos da demo; os marcados "novo" foram acrescentados e só cobrem texto claramente
// imperativo ou promissório.
//
// "alvo" e "stop" NÃO são vocabulário proibido: são parâmetros legítimos da regra de saída do
// teste ("alvo 2×ATR, stop 1×ATR", "atingiu o alvo antes do stop"). Só se acusa alvo/stop como
// instrução (preço-alvo, "alvo sugerido", "alvo em US$ 70.000").
//
// Diferenças em relação ao legado:
//  - cada padrão tem um nome de regra (`rule`);
//  - o achado traz um trecho (`excerpt`);
//  - achado contido em outro mais longo é descartado (ex.: "garantido" dentro de "lucro garantido").

/** Texto padrão que acompanha toda saída a cliente ou investidor. */
export const DISCLAIMER_PADRAO =
  'Este material é produzido pela Stratum Research e constitui research e análise estatística. ' +
  'Não constitui recomendação de investimento personalizada, consultoria financeira regulamentada, ' +
  'oferta ou solicitação de compra ou venda de qualquer ativo. ' +
  'Resultados estatísticos históricos, incluindo win rate, intervalos de confiança e Brier Score, ' +
  'não constituem garantia de resultados futuros. ' +
  'O CONTRATANTE é o único responsável por todas as decisões de investimento e por sua execução. ' +
  'A Stratum Research não é instituição financeira, gestora de recursos registrada na CVM ou corretora, ' +
  'não executa ordens, não gerencia e não custodia capital de clientes sob este Contrato.';

/**
 * @typedef {object} Finding
 * @property {string} rule     nome da regra que acusou
 * @property {string} term     trecho exato encontrado no texto
 * @property {number} index    posição (em caracteres) do trecho no texto
 * @property {string} excerpt  contexto curto ao redor do trecho, em uma linha
 */

// Negação (legado): um termo precedido, na mesma frase e a até 60 caracteres, por "não", "nunca",
// "sem" etc. é descrição ou proibição ("não recomendamos", "nunca diga compre"), não instrução.
const NEGACAO = /\b(n(ã|a)o|nunca|nenhum|nenhuma|sem|jamais|nem)\b[^.!?\n]{0,60}$/i;
const JANELA_NEGACAO = 70;
const CONTEXTO_TRECHO = 30;
// Regras verbais (`clause: true`: imperativo, primeira pessoa, previsão de preço) só aceitam a negação da
// própria oração. "Não hesite, compre agora" e "Não temos dúvida e recomendamos" são instrução: a negação
// ficou do outro lado da vírgula ou da conjunção. Substantivos em lista ("sem promessa, garantia ou
// oportunidade") continuam protegidos pela regra do legado.
const FRONTEIRA_ORACAO = /[,;:—–]|\s(e|mas|ent(ã|a)o|portanto|logo)\s/gi;

/** @type {{ rule: string, re: RegExp, clause?: boolean }[]} */
const REGRAS = [
  // ---- legado: instrução de compra, venda, entrada e posição
  { rule: 'compra-imperativa', clause: true, re: /\bcompr(e|em|ar agora|a agora)\b/gi },
  { rule: 'venda-imperativa', clause: true, re: /\bvend(a|er) agora\b/gi },
  { rule: 'recomendacao', clause: true, re: /\brecomend(o|amos|a-se)\b/gi },
  { rule: 'recomendacao-compra-venda', re: /\brecomenda(ç|c)(ã|a)o de (compra|venda)\b/gi },
  { rule: 'sugestao', clause: true, re: /\bsugiro\b/gi },
  { rule: 'sugestao', clause: true, re: /\bsugerimos\b/gi },
  { rule: 'entrar-agora', clause: true, re: /\bentr(e|ar) agora\b/gi },
  { rule: 'entrada-sugerida', re: /\bentrada sugerida\b/gi },
  { rule: 'alvo-sugerido', re: /\balvo sugerido\b/gi },
  { rule: 'stop-sugerido', re: /\bstop sugerido\b/gi },
  { rule: 'reducao-de-posicao', clause: true, re: /\breduz(a|am|ir) (a |sua |suas )?(exposi(ç|c)(ã|a)o|posi(ç|c)(ã|a)o|posi(ç|c)(õ|o)es)\b/gi },
  { rule: 'aumento-de-posicao', clause: true, re: /\baument(e|ar) (a |sua )?posi(ç|c)(ã|a)o\b/gi },
  { rule: 'zerar-posicao', clause: true, re: /\bzer(e|ar) (a |sua )?posi(ç|c)(ã|a)o\b/gi },
  { rule: 'alavancagem', re: /\balavanc(ar|agem recomendada)\b/gi },

  // ---- legado: promessa, certeza e urgência
  { rule: 'garantia', clause: true, re: /\bgarant(o|imos)\b/gi },
  { rule: 'garantia', re: /\bgarant(ido|ida|idos|idas|ia)\b/gi },
  { rule: 'lucro-garantido', re: /\blucro (certo|garantido)\b/gi },
  { rule: 'previsao-de-preco', clause: true, re: /\bvai (subir|cair|disparar|explodir)\b/gi },
  { rule: 'certeza', re: /\bcom certeza\b/gi },
  { rule: 'oportunidade', re: /\boportunidade\b/gi },
  { rule: 'urgencia', re: /\bn(ã|a)o perca\b/gi },
  { rule: 'urgencia', re: /\bimperd(í|i)vel\b/gi },
  { rule: 'urgencia', re: /\bcuidado\b/gi },

  // ---- novo: recomendação de operação, em forma imperativa
  { rule: 'hora-de-operar', clause: true, re: /\b(hora|momento) de (entrar|comprar|vender|sair)\b/gi },
  {
    rule: 'ordem-imperativa',
    clause: true,
    re: /\b(venda|feche|abra|encerre|mantenha|carregue|monte)\s+(a |o |as |os |sua |seu |suas |seus |uma |um )?(posi(ç|c)(ã|a)o|posi(ç|c)(õ|o)es|ativos?|bitcoin|btc|ethereum|eth|solana|cripto\w*)\b/gi
  },
  { rule: 'sinal-de-compra-venda', re: /\b(sinal|sinais) de (compra|venda)\b/gi },
  // ---- novo: instrução em forma branda ("considere comprar", "eu compraria", "realize lucros", "saia da posição")
  { rule: 'sugestao-de-operacao', clause: true, re: /\b(considere|avalie|pense em|vale (a pena )?)\s*(comprar|vender|entrar|sair|reduzir|aumentar|zerar|realizar)\b/gi },
  { rule: 'sugestao-de-operacao', clause: true, re: /\b(eu )?(compraria|venderia)\b|\beu (entraria|sairia|reduziria|zeraria)\b/gi },
  { rule: 'realizacao-de-lucro', clause: true, re: /\brealiz(e|em|ar) (os |seus? |parte dos? )?(lucros?|ganhos?|preju(í|i)zos?)\b/gi },
  { rule: 'saida-imperativa', clause: true, re: /\bsai(a|am) d[aeo]s? (posi(ç|c)(ã|a)o|posi(ç|c)(õ|o)es|opera(ç|c)(ã|a)o|mercado|ativo|trade)\b/gi },
  { rule: 'tamanho-de-posicao', clause: true, re: /\baloque\b/gi },
  { rule: 'tamanho-de-posicao', re: /\btamanho de posi(ç|c)(ã|a)o (recomendado|sugerido|ideal|adequado)\b/gi },

  // ---- novo: preço-alvo e níveis de preço como instrução (alvo/stop em ATR ou em candles não são acusados)
  { rule: 'preco-alvo', re: /\bpre(ç|c)o[- ]alvo\b/gi },
  {
    rule: 'alvo-stop-em-preco',
    re: /(?<!pre(ç|c)o[- ])\b(alvo|stop( ?loss)?)\s*(de |em |a |para |: ?)?\s*((R\$|US\$|USD|USDT|\$)\s?\d|\d{1,3}([.,]\d{3})+(?!\d)|\d+([.,]\d+)?\s?(mil|k)\b|\d{4,})/gi
  },

  // ---- novo: promessa de retorno
  {
    rule: 'promessa-de-retorno',
    re: /\b(retorno|rentabilidade|rendimento|ganho|lucro)s?( (m(é|e)dio|esperado|projetado|mensal|anual))?\s*(de |: ?)?\s*(at(é|e) |cerca de )?\d+([.,]\d+)?\s?%\s*((ao|por|\/)\s?(m(ê|e)s|ano|dia|semana|trimestre)|a\.\s?[ma]\.)/gi
  },
  { rule: 'promessa-de-retorno', re: /\b(retorno|ganho|rentabilidade)s? (certo|assegurado|seguro)s?\b/gi },
  { rule: 'promessa-de-retorno', re: /\brisco zero\b/gi },
  { rule: 'promessa-de-retorno', clause: true, re: /\blucre\b/gi },
  { rule: 'promessa-de-retorno', clause: true, re: /\bganhe (dinheiro|\d)/gi },

  // ---- novo: nomes que não podem ser citados como produto ou benchmark
  { rule: 'marca-proibida', re: /\bAstra\b/gi },
  { rule: 'marca-proibida', re: /\bDeepSeek[\s_-]*v?4\.1\b/gi }
];

/** Trecho de uma linha ao redor do achado. */
function trecho(text, index, length) {
  const ini = Math.max(0, index - CONTEXTO_TRECHO);
  const fim = Math.min(text.length, index + length + CONTEXTO_TRECHO);
  const miolo = text.slice(ini, fim).replace(/\s+/g, ' ').trim();
  return (ini > 0 ? '…' : '') + miolo + (fim < text.length ? '…' : '');
}

/**
 * Procura instrução, promessa e nomes proibidos em um texto voltado ao usuário.
 * @param {string} text
 * @returns {Finding[]} achados em ordem de posição; lista vazia se o texto está limpo
 */
export function scanText(text) {
  const s = String(text ?? '');
  /** @type {Finding[]} */
  const todos = [];
  for (const { rule, re, clause } of REGRAS) {
    for (const m of s.matchAll(re)) {
      const index = /** @type {number} */ (m.index);
      let antes = s.slice(Math.max(0, index - JANELA_NEGACAO), index);
      if (clause) {
        let corte = 0;
        for (const b of antes.matchAll(FRONTEIRA_ORACAO)) corte = /** @type {number} */ (b.index) + b[0].length;
        antes = antes.slice(corte);
      }
      if (NEGACAO.test(antes)) continue;
      todos.push({ rule, term: m[0], index, excerpt: trecho(s, index, m[0].length) });
    }
  }
  // Ordem estável: posição e, na mesma posição, o trecho mais longo primeiro.
  todos.sort((a, b) => a.index - b.index || b.term.length - a.term.length);
  const achados = [];
  let fimAnterior = -1;
  for (const f of todos) {
    const fim = f.index + f.term.length;
    if (f.index < fimAnterior && fim <= fimAnterior) continue; // contido em outro achado
    achados.push(f);
    if (fim > fimAnterior) fimAnterior = fim;
  }
  return achados;
}

/**
 * Lança erro se o texto tiver algum achado.
 * @param {string} text
 * @returns {string} o próprio texto, para encadeamento
 * @throws {Error} `name === 'ComplianceError'`, com a lista em `findings`
 */
export function assertCompliant(text) {
  const findings = scanText(text);
  if (findings.length) {
    const lista = findings.map((f) => `"${f.term}" [${f.rule}] na posição ${f.index}: ${f.excerpt}`).join('; ');
    const err = new Error(`Texto fora da política de conformidade (${findings.length} achado(s)): ${lista}`);
    err.name = 'ComplianceError';
    /** @type {any} */ (err).findings = findings;
    throw err;
  }
  return text;
}

/**
 * Acrescenta o disclaimer padrão ao fim do texto (Markdown). Idempotente.
 * @param {string} text
 * @returns {string}
 */
export function withDisclaimer(text) {
  const s = String(text ?? '');
  if (s.includes(DISCLAIMER_PADRAO)) return s;
  const base = s.trimEnd();
  return (base ? base + '\n\n---\n' : '') + DISCLAIMER_PADRAO + '\n';
}
