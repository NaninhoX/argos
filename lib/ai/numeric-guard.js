// Guarda numérica do Argos AI. O LLM não calcula nem inventa número: todo número do texto final precisa ser
// derivável dos resultados das ferramentas do motor. Na dúvida, bloqueia.
//
// Leitura do texto (pt-BR):
//  - ponto de milhar e vírgula decimal: "67.234,51" = 67234.51; "1.234" = 1234; "0,148" = 0.148;
//  - ponto seguido de 1, 2 ou 4+ dígitos (ou depois de zero) é decimal de máquina: "0.148" = 0.148;
//  - unidades reconhecidas: "%", "p.p." (ou "pp", "pontos percentuais"), "×" (ou "2x"), "mil", "milhão/milhões", "bilhão/bilhões";
//  - notação científica: "9e-4" = 0.0009; "por cento" vale como "%";
//  - dígitos colados em letras também contam ("EMA20" = 20). Números por extenso ("dois") não são verificados,
//    salvo percentual por extenso ("sessenta por cento") e dígito de outro alfabeto, que são bloqueados.
//
// O que a guarda NÃO faz: conferir o papel do número na frase. Trocar dois números do motor de lugar, inverter
// um sinal ou afirmar "abaixo de 0,05" para um p que está acima passa aqui. Isso é assunto de teste
// adversarial e de revisão humana, não desta verificação.
//
// Fonte permitida: todo número dos resultados das ferramentas, isto é, números JSON, números dentro de strings e
// números dentro de nomes de chave ("rsi14" = 14, "ic95_pct" = 95).
//
// Regra de derivação: o número do texto, na precisão em que foi exibido, tem de ser o arredondamento de um número
// da fonte: |texto − fonte| ≤ meia unidade da última casa exibida. Com "%" ou "p.p.", a fonte pode estar em fração
// (0.2069 ↔ "20,7%") ou já em pontos (54.3 ↔ "54,3%"). O sinal é ignorado ("queda de 3,2%" ↔ −3.2).
// Truncar não passa (0.2069 ↔ "20,6%" é bloqueado), nem trocar a escala sem unidade (54.3 ↔ "0,543").
//
// Exceções estruturais (DEFAULT_EXCEPTIONS, configuráveis no terceiro argumento de checkNumbers):
//  1. marcador de lista ou título numerado no início da linha ("1.", "2)", "## 3.");
//  2. o 95 de "IC 95%" / "95% de confiança";
//  3. o limiar convencional de significância "0,05", só em comparação ("abaixo de 0,05", "< 0,05", "limiar de 0,05");
//  4. inteiro pequeno "nu" (sem casa decimal, sem unidade, sem moeda) até smallIntMax, usado em enumeração e
//     contagem ("os 8 setups", "seção 2"). smallIntMax: -1 desliga.

const LETTER = 'A-Za-zÀ-ÿ';
// Notação científica ("9e-4") vem primeiro: lida como dois inteiros pequenos, passaria pela exceção 4.
const SCI = String.raw`\d+(?:[.,]\d+)?[eE][+\-−]?\d+(?![${LETTER}\d])`;
const NUMBER = String.raw`(?:${SCI}|[1-9]\d{0,2}(?:\.\d{3})+(?!\d)(?:,\d+)?|\d+,\d+|\d+\.\d+|\d+)`;
const UNIT = String.raw`(?:\s?%|\s?por\s+cento(?![${LETTER}])|\s?p\.\s?p\.?(?![${LETTER}])|\s?pp(?![${LETTER}])|\s?pontos?\s+percentua(?:l|is)|\s?×|x(?:(?=ATR)|(?![${LETTER}]))|\s(?:milhões|milhão|bilhões|bilhão|mil)(?![${LETTER}]))`;
const TOKEN = new RegExp('(' + NUMBER + ')(' + UNIT + ')?', 'g');
const THOUSANDS = /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/;
const SCI_PARTS = /^(\d+)(?:[.,](\d+))?[eE]([+\-−]?\d+)$/;
const SCALE = { mil: 1e3, 'milhão': 1e6, 'milhões': 1e6, 'bilhão': 1e9, 'bilhões': 1e9 };
// O que a leitura por dígitos não alcança e por isso é bloqueado direto: dígito de outro alfabeto (depois da
// normalização NFKC, que já converte os de largura total) e percentual por extenso ("sessenta por cento").
const FOREIGN_DIGITS = /(?![0-9])\p{Nd}+/gu;
const SPELLED_PERCENT = new RegExp(String.raw`(?<![${LETTER}\d])[${LETTER}]+\s+por\s+cento(?![${LETTER}])`, 'gi');
// String de ferramenta que é só um hash (ou id em hexadecimal) não é fonte de número.
const HEX_BLOB = /^[0-9a-f]{32,}$/i;

export const DEFAULT_EXCEPTIONS = Object.freeze({
  smallIntMax: 10,
  patterns: Object.freeze([
    /^[ \t>]*(?:#{1,6}[ \t]*)?\d{1,3}[.)](?=\s)/gm,
    // Só o nível do intervalo de confiança. "confiança de 95%" solto não entra: o motor também emite a
    // confiança do regime, que é outro número.
    /\b(?:IC|intervalo\s+de\s+confiança|nível\s+de\s+confiança)(?:\s+(?:de|a))?\s*95\s*%|\b95\s*%\s+de\s+confiança/gi,
    /(?:[<>≤≥]|\b(?:abaixo|acima|menor|maior|inferior|superior)\s+(?:de|do|que|a|ao)|\b(?:limiar|nível|corte)(?:\s+convencional)?\s+de)\s*0,05(?!\d)/gi
  ])
});

/**
 * Extrai os números de um texto em pt-BR.
 * @param {string} text
 * @returns {{ raw: string, digits: string, index: number, end: number, value: number, step: number, decimals: number, unit: '' | '%' | 'pp' | 'x' | 'scale' }[]}
 *   value já vem multiplicado pela palavra de escala; step é a unidade da última casa exibida.
 */
export function extractNumbers(text) {
  const out = [];
  const s = String(text ?? '');
  for (const m of s.matchAll(TOKEN)) {
    const digits = m[1];
    const suffix = (m[2] || '').trim().toLowerCase();
    const scale = SCALE[suffix] || 1;
    const unit = !suffix ? '' : suffix === '%' || /^por\s+cento$/.test(suffix) ? '%' : scale !== 1 ? 'scale' : suffix === '×' || suffix === 'x' ? 'x' : 'pp';
    const sci = SCI_PARTS.exec(digits);
    let value, decimals;
    if (sci) {
      const exp = Number(sci[3].replace('−', '-'));
      value = Number(sci[1] + '.' + (sci[2] || '0') + 'e' + exp);
      decimals = (sci[2] || '').length - exp; // casas exibidas, contando o expoente (pode ser negativo)
    } else {
      const plain = THOUSANDS.test(digits) ? digits.replace(/\./g, '') : digits;
      const sep = Math.max(plain.indexOf(','), plain.indexOf('.'));
      decimals = sep < 0 ? 0 : plain.length - sep - 1;
      value = Number(plain.replace(',', '.'));
    }
    out.push({ raw: m[0], digits, index: m.index, end: m.index + m[0].length, value: value * scale, step: 10 ** -decimals * scale, decimals, unit });
  }
  return out;
}

/**
 * Junta os números dos resultados das ferramentas (em valor absoluto).
 * @param {unknown} toolResults resultado, ou lista de resultados; string é lida como JSON e, se não for JSON, como texto
 * @returns {number[]}
 */
export function collectToolNumbers(toolResults) {
  const pool = new Set();
  const addText = (s) => { if (HEX_BLOB.test(s)) return; for (const t of extractNumbers(s)) pool.add(Math.abs(t.value)); };
  const walk = (v) => {
    if (typeof v === 'number') { if (Number.isFinite(v)) pool.add(Math.abs(v)); return; }
    if (typeof v === 'string') return addText(v);
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { addText(k); walk(x); }
  };
  for (const r of Array.isArray(toolResults) ? toolResults : [toolResults]) {
    if (typeof r !== 'string') { walk(r); continue; }
    let parsed;
    try { parsed = JSON.parse(r); } catch { addText(r); continue; }
    walk(parsed);
  }
  return [...pool];
}

function derivable(tok, pool) {
  const half = tok.step / 2;
  const scales = tok.unit === '%' || tok.unit === 'pp' ? [1, 100] : [1];
  for (const v of pool) {
    for (const k of scales) {
      const c = v * k;
      if (Math.abs(tok.value - c) <= half + 1e-9 * Math.max(1, c)) return true;
    }
  }
  return false;
}

/**
 * Confere se cada número do texto é derivável dos resultados das ferramentas.
 * @param {string} text texto final do LLM
 * @param {unknown} toolResults resultados das ferramentas (conteúdo das mensagens de papel `tool`)
 * @param {{ smallIntMax?: number, patterns?: RegExp[] }} [options] substitui as exceções estruturais padrão
 * @returns {{ ok: boolean, unknown: { raw: string, value: number, index: number }[] }}
 */
export function checkNumbers(text, toolResults, options = {}) {
  const s = String(text ?? '').normalize('NFKC'); // dígitos de largura total e sobrescritos viram dígitos comuns
  const smallIntMax = options.smallIntMax ?? DEFAULT_EXCEPTIONS.smallIntMax;
  const patterns = options.patterns ?? DEFAULT_EXCEPTIONS.patterns;
  const spans = [];
  for (const re of patterns) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of s.matchAll(g)) spans.push([m.index, m.index + m[0].length]);
  }
  const pool = collectToolNumbers(toolResults);
  const unknown = [];
  for (const tok of extractNumbers(s)) {
    if (spans.some(([a, b]) => tok.index >= a && tok.index + tok.digits.length <= b)) continue;
    const currency = /\$\s?$/.test(s.slice(Math.max(0, tok.index - 2), tok.index));
    if (!tok.unit && !currency && /^\d{1,2}$/.test(tok.digits) && tok.value <= smallIntMax) continue;
    if (!derivable(tok, pool)) unknown.push({ raw: tok.raw.trim(), value: tok.value, index: tok.index });
  }
  for (const re of [FOREIGN_DIGITS, SPELLED_PERCENT]) {
    for (const m of s.matchAll(re)) unknown.push({ raw: m[0], value: NaN, index: m.index });
  }
  unknown.sort((a, b) => a.index - b.index);
  return { ok: unknown.length === 0, unknown };
}
