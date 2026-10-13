// Gera os arquivos do navegador que derivam de outras fontes do repositório:
//   web/js/engine.js      <- engine/index.js (mesmo código, embrulhado para window.ArgosEngine)
//   web/js/regime-view.js <- lib/regime-view.js (recorte por regime, embrulhado para window.ArgosRegimeView)
//   web/data/snapshot.js  <- data/snapshot-v1.1.json
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

export function buildWeb() {
  const out = (rel, text) => {
    const file = path.join(root, 'web', rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return rel;
  };
  const snapshot = fs.readFileSync(path.join(root, 'data', 'snapshot-v1.1.json'), 'utf8');
  const study = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'data', 'study-v1.1.json'), 'utf8')));
  return [
    out('js/engine.js', browserEngineSource()),
    out('js/regime-view.js', browserRegimeViewSource()),
    out('data/snapshot.js', `${BANNER}data/snapshot-v1.1.json */\nwindow.ARGOS_SNAPSHOT=${snapshot};\n`),
    out('data/study.js', `${BANNER}data/study-v1.1.json */\nwindow.ARGOS_STUDY=${study};\n`)
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('gerado:', buildWeb().join(', '));
}
