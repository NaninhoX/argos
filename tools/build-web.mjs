// Gera os arquivos do navegador que derivam de outras fontes do repositório:
//   web/js/engine.js      <- engine/index.js (mesmo código, embrulhado para window.ArgosEngine)
//   web/js/regime-view.js <- lib/regime-view.js (recorte por regime, embrulhado para window.ArgosRegimeView)
//   web/js/pine-reader.js <- lib/pine-reader.js (leitor de Pine do Sandbox, embrulhado para window.ArgosPineReader)
//   web/js/analysis-summary.js <- lib/canonical.js + lib/analysis-summary.js (mesmo resumo e mesmo resultHash do servidor,
//                                 embrulhados para window.ArgosSummary; só o SHA-256 do node:crypto é trocado por um em JS)
//   web/data/snapshot/<SIMBOLO>_<tf>.js <- data/snapshot-v1.1.json, um arquivo por série
//   web/data/study.js     <- data/study-v1.1.json
// São arquivos gerados: não editar à mão. Roda no deploy (buildCommand) e ao subir o servidor local.
// Uso: node tools/build-web.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BANNER = '/* ARQUIVO GERADO por tools/build-web.mjs. Não editar: a fonte é ';

/** Texto do motor para o navegador: o módulo ES sem as linhas de export, dentro de uma IIFE. */
export function browserEngineSource(moduleSource = fs.readFileSync(path.join(root, 'engine', 'index.js'), 'utf8')) {
  const at = moduleSource.indexOf('\nexport const VERSION');
  if (at < 0) throw new Error('engine/index.js: bloco de exports não encontrado');
  const body = moduleSource.slice(0, at);
  if (/^\s*(export|import)\s/m.test(body)) throw new Error('engine/index.js: export ou import fora do bloco final; ajuste tools/build-web.mjs');
  const tail = moduleSource.slice(at);
  const version = /export const VERSION = ([^;]+);/.exec(tail)[1];
  const names = /export \{([\s\S]*?)\};/.exec(tail)[1].split(',').map((s) => s.trim()).filter(Boolean);
  return `${BANNER}engine/index.js */\n(function (root) {\n'use strict';\n${body}\nroot.ArgosEngine = {\n  ${names.join(', ')}, VERSION: ${version}\n};\n})(typeof window !== 'undefined' ? window : globalThis);\n`;
}

/**
 * Texto de um módulo puro de lib/ para o navegador: tira o `export` das declarações do nível do arquivo e expõe os nomes
 * exportados num global, dentro de uma IIFE. Recusa `import`, `export default` e `export { ... }`: o módulo tem de ser autônomo.
 * @param {string} moduleSource
 * @param {string} rel caminho de origem, para o cabeçalho e as mensagens
 * @param {string} globalName nome do global no navegador
 */
export function browserModuleSource(moduleSource, rel, globalName) {
  if (/^\s*import[\s{*]/m.test(moduleSource)) throw new Error(`${rel}: import não é suportado no build do navegador`);
  if (/^\s*export\s+(default\b|\{|\*)/m.test(moduleSource)) throw new Error(`${rel}: use só "export function" ou "export const" para o build do navegador`);
  const names = [];
  const body = moduleSource.replace(/^export\s+((?:async\s+)?(?:function\*?|const|let|class)\s+)(\w+)/gm, (_m, kw, name) => { names.push(name); return kw + name; });
  if (!names.length) throw new Error(`${rel}: nenhum export encontrado`);
  return `${BANNER}${rel} */\n(function (root) {\n'use strict';\n${body}\nroot.${globalName} = { ${names.join(', ')} };\n})(typeof window !== 'undefined' ? window : globalThis);\n`;
}

/** Recorte por regime para o navegador: lib/regime-view.js em window.ArgosRegimeView. */
export function browserRegimeViewSource(moduleSource = fs.readFileSync(path.join(root, 'lib', 'regime-view.js'), 'utf8')) {
  return browserModuleSource(moduleSource, 'lib/regime-view.js', 'ArgosRegimeView');
}

/** Leitor de Pine do Sandbox para o navegador: lib/pine-reader.js em window.ArgosPineReader. */
export function browserPineReaderSource(moduleSource = fs.readFileSync(path.join(root, 'lib', 'pine-reader.js'), 'utf8')) {
  return browserModuleSource(moduleSource, 'lib/pine-reader.js', 'ArgosPineReader');
}

/**
 * SHA-256 síncrono em JS puro, com a interface mínima de `createHash('sha256').update(x).digest('hex')` de node:crypto.
 * O resumo da análise (lib/analysis-summary.js) é síncrono e usa essa interface; crypto.subtle é assíncrono e só existe em
 * contexto seguro. O teste de web-build compara esta função com node:crypto em entradas de vários tamanhos e em UTF-8.
 */
const SHA256_SHIM = `const createHash = (function () {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  function digestHex(bytes) {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const n = bytes.length;
    const total = ((n + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[n] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(n / 0x20000000), false);
    dv.setUint32(total - 4, (n << 3) >>> 0, false);
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    let hex = '';
    for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, '0');
    return hex;
  }
  return function createHash(alg) {
    if (alg !== 'sha256') throw new Error('createHash: só sha256 é suportado no navegador');
    let bytes = new Uint8Array(0);
    return {
      update(data) {
        const add = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const next = new Uint8Array(bytes.length + add.length);
        next.set(bytes); next.set(add, bytes.length);
        bytes = next;
        return this;
      },
      digest(enc) {
        if (enc !== 'hex') throw new Error('createHash: só digest("hex") é suportado no navegador');
        return digestHex(bytes);
      }
    };
  };
})();
`;

/**
 * Resumo da análise para o navegador: lib/canonical.js e lib/analysis-summary.js, o mesmo código do servidor, em
 * window.ArgosSummary. É o que permite calcular no navegador o mesmo `resultHash` de /api/analyze. A única troca é o
 * SHA-256 do node:crypto por SHA256_SHIM; as regras de canonização e o resumo não são reescritos.
 */
export function browserSummarySource(
  canonicalSource = fs.readFileSync(path.join(root, 'lib', 'canonical.js'), 'utf8'),
  summarySource = fs.readFileSync(path.join(root, 'lib', 'analysis-summary.js'), 'utf8')
) {
  const drop = (src, rel, line) => {
    if (!src.includes(line)) throw new Error(`${rel}: a linha de import esperada não foi encontrada (${line}); ajuste tools/build-web.mjs`);
    return src.replace(line + '\n', '');
  };
  const names = [];
  const strip = (src) => src.replace(/^export\s+((?:async\s+)?(?:function\*?|const|let|class)\s+)(\w+)/gm, (_m, kw, name) => { names.push(name); return kw + name; });
  let c = drop(canonicalSource, 'lib/canonical.js', "import { createHash } from 'node:crypto';");
  let s = drop(summarySource, 'lib/analysis-summary.js', "import { REGIMES, VERSION } from '../engine/index.js';");
  s = drop(s, 'lib/analysis-summary.js', "import { canonicalize, sha256Hex } from './canonical.js';");
  c = strip(c);
  s = strip(s);
  for (const [rel, src] of [['lib/canonical.js', c], ['lib/analysis-summary.js', s]]) {
    if (/^\s*(export|import)\s/m.test(src)) throw new Error(`${rel}: export ou import que o build do navegador não trata; ajuste tools/build-web.mjs`);
  }
  for (const need of ['canonicalize', 'sha256Hex', 'summarize']) if (!names.includes(need)) throw new Error(`lib: ${need} não foi encontrado nos exports`);
  return `${BANNER}lib/canonical.js e lib/analysis-summary.js */\n(function (root) {\n'use strict';\nconst { REGIMES, VERSION } = root.ArgosEngine;\n${SHA256_SHIM}${c}\n${s}\nroot.ArgosSummary = { ${names.join(', ')} };\n})(typeof window !== 'undefined' ? window : globalThis);\n`;
}

export function buildWeb() {
  const out = (rel, text) => {
    const file = path.join(root, 'web', rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return rel;
  };
  const { series, ...meta } = JSON.parse(fs.readFileSync(path.join(root, 'data', 'snapshot-v1.1.json'), 'utf8'));
  fs.rmSync(path.join(root, 'web', 'data', 'snapshot.js'), { force: true }); // formato antigo: as 9 séries num arquivo só
  const study = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'data', 'study-v1.1.json'), 'utf8')));
  return [
    out('js/engine.js', browserEngineSource()),
    out('js/regime-view.js', browserRegimeViewSource()),
    out('js/pine-reader.js', browserPineReaderSource()),
    out('js/analysis-summary.js', browserSummarySource()),
    // um arquivo por série: cada um acrescenta a sua em window.ARGOS_SNAPSHOT.series (a plataforma carrega só as que usa)
    ...Object.keys(series).map((k) => out(`data/snapshot/${k}.js`,
      `${BANNER}data/snapshot-v1.1.json */\n(window.ARGOS_SNAPSHOT=window.ARGOS_SNAPSHOT||${JSON.stringify({ ...meta, series: {} })}).series[${JSON.stringify(k)}]=${JSON.stringify(series[k])};\n`)),
    out('data/study.js', `${BANNER}data/study-v1.1.json */\nwindow.ARGOS_STUDY=${study};\n`)
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('gerado:', buildWeb().join(', '));
}
