// Linter de conformidade: varre os textos voltados ao usuário e acusa instrução e promessa.
// Uso: node tools/compliance-lint.mjs [--root <pasta>]     (npm run lint:compliance)
//
// Varre: web/** (texto), lib/**/*.js, api/**/*.js, docs/public/** (texto).
// Ignora: legacy/, node_modules/, tests/, docs/adr/ e lib/compliance.js.
// Supressão: comentário na mesma linha, `compliance-ignore: motivo` (o motivo é obrigatório).
// Saída: arquivo:linha:coluna, regra, termo e trecho. Código de saída 1 se houver achado.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from '../lib/compliance.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXT_TEXTO = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.md', '.txt', '.json']);
const EXT_CODIGO = new Set(['.js', '.mjs']);

/** Pastas varridas (relativas à raiz) e extensões aceitas em cada uma. */
const ALVOS = [
  { dir: 'web', ext: EXT_TEXTO },
  { dir: 'lib', ext: EXT_CODIGO },
  { dir: 'api', ext: EXT_CODIGO },
  { dir: 'docs/public', ext: EXT_TEXTO }
];

const IGNORAR_PASTAS = new Set(['legacy', 'node_modules', 'tests']);
const IGNORAR_PREFIXOS = ['docs/adr'];
const IGNORAR_ARQUIVOS = new Set(['lib/compliance.js']);

const SUPRESSAO = /compliance-ignore:\s*[\p{L}\p{N}]/u; // o motivo começa com letra ou número

/** @param {string} abs @param {string} rel @param {Set<string>} ext @returns {Generator<{abs: string, rel: string}>} */
function* percorrer(abs, rel, ext) {
  let entradas;
  try {
    entradas = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return; // pasta inexistente (ex.: docs/public) não é erro
  }
  entradas.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entradas) {
    const r = rel + '/' + e.name;
    if (e.isDirectory()) {
      if (IGNORAR_PASTAS.has(e.name)) continue;
      if (IGNORAR_PREFIXOS.some((p) => r === p || r.startsWith(p + '/'))) continue;
      yield* percorrer(path.join(abs, e.name), r, ext);
    } else if (e.isFile() && ext.has(path.extname(e.name).toLowerCase()) && !IGNORAR_ARQUIVOS.has(r)) {
      yield { abs: path.join(abs, e.name), rel: r };
    }
  }
}

/** Posição de início de cada linha, para converter índice em linha e coluna. */
function inicioDasLinhas(texto) {
  const inicios = [0];
  for (let i = texto.indexOf('\n'); i !== -1; i = texto.indexOf('\n', i + 1)) inicios.push(i + 1);
  return inicios;
}

/** Índice (0-based) da linha que contém a posição. */
function linhaDe(inicios, pos) {
  let lo = 0;
  let hi = inicios.length - 1;
  while (lo < hi) {
    const meio = (lo + hi + 1) >> 1;
    if (inicios[meio] <= pos) lo = meio;
    else hi = meio - 1;
  }
  return lo;
}

/**
 * Varre o repositório.
 * @param {string} [root] raiz do repositório
 * @returns {{ files: number, findings: { file: string, line: number, col: number, rule: string, term: string, excerpt: string }[] }}
 */
export function lintRepo(root = REPO_ROOT) {
  const findings = [];
  let files = 0;
  for (const { dir, ext } of ALVOS) {
    for (const { abs, rel } of percorrer(path.join(root, dir), dir, ext)) {
      files++;
      const texto = fs.readFileSync(abs, 'utf8');
      const achados = scanText(texto);
      if (!achados.length) continue;
      const inicios = inicioDasLinhas(texto);
      for (const a of achados) {
        const i = linhaDe(inicios, a.index);
        const fim = i + 1 < inicios.length ? inicios[i + 1] - 1 : texto.length;
        if (SUPRESSAO.test(texto.slice(inicios[i], fim))) continue;
        findings.push({ file: rel, line: i + 1, col: a.index - inicios[i] + 1, rule: a.rule, term: a.term, excerpt: a.excerpt });
      }
    }
  }
  return { files, findings };
}

function main() {
  const args = process.argv.slice(2);
  let root = REPO_ROOT;
  const i = args.indexOf('--root');
  if (i !== -1) {
    if (!args[i + 1]) {
      console.error('compliance-lint: --root exige uma pasta');
      process.exitCode = 2;
      return;
    }
    root = path.resolve(args[i + 1]);
  }
  const { files, findings } = lintRepo(root);
  for (const f of findings) {
    console.log(`${f.file}:${f.line}:${f.col}  [${f.rule}]  "${f.term}"  ${f.excerpt}`);
  }
  if (findings.length) {
    const arquivos = new Set(findings.map((f) => f.file)).size;
    console.log(`\ncompliance-lint: ${findings.length} achado(s) em ${arquivos} arquivo(s) (${files} verificados). Para suprimir um uso legítimo: comentário "compliance-ignore: motivo" na mesma linha.`);
    process.exitCode = 1;
    return;
  }
  console.log(`compliance-lint: ok (${files} arquivo(s) verificados, nenhum achado)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
