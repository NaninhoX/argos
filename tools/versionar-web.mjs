// Põe `?v=<hash do conteúdo>` nos endereços locais de CSS e JS dos HTML de web/, para o navegador nunca misturar
// HTML novo com CSS ou JS antigo. O hash é o SHA-256 do arquivo (8 primeiros caracteres): muda só quando o arquivo muda.
// Roda no deploy (buildCommand), depois de build-web.mjs, porque os arquivos gerados também entram. Idempotente.
// Uso: node tools/versionar-web.mjs [pasta-web]
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ATTR = /\b(href|src)="((?:css|js|data)\/[^"?#]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"/g;

/** Reescreve os endereços de um HTML. `hashDe(rel)` devolve o hash do arquivo ou null se ele não existe (então fica como está). */
export function versionarHtml(html, hashDe) {
  return html.replace(ATTR, (m, attr, rel) => {
    const h = hashDe(rel);
    return h ? `${attr}="${rel}?v=${h}"` : m;
  });
}

// Endereços que um script pede em tempo de execução, escritos como literais entre aspas simples (js/carregador.js).
const LITERAL = /'((?:css|js|data)\/[^'?#]+\.(?:css|js))(?:\?v=[0-9a-f]+)?'/g;
/** Scripts cujos literais de endereço também recebem ?v=: são versionados antes dos HTML, que os carregam. */
export const SCRIPTS_COM_ENDERECOS = ['js/carregador.js'];

/** Reescreve os literais de endereço de um script, como versionarHtml faz com os atributos. */
export function versionarScript(js, hashDe) {
  return js.replace(LITERAL, (m, rel) => {
    const h = hashDe(rel);
    return h ? `'${rel}?v=${h}'` : m;
  });
}

export function versionarWeb(webDir) {
  const hashDe = (rel) => {
    const f = path.join(webDir, rel);
    return fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 8) : null;
  };
  const feitos = [];
  for (const rel of SCRIPTS_COM_ENDERECOS) {
    const f = path.join(webDir, rel);
    if (!fs.existsSync(f)) continue;
    const antes = fs.readFileSync(f, 'utf8'), depois = versionarScript(antes, hashDe);
    if (depois !== antes) { fs.writeFileSync(f, depois); feitos.push(rel); }
  }
  for (const nome of fs.readdirSync(webDir).filter((n) => n.endsWith('.html'))) {
    const f = path.join(webDir, nome);
    const antes = fs.readFileSync(f, 'utf8'), depois = versionarHtml(antes, hashDe);
    if (depois !== antes) { fs.writeFileSync(f, depois); feitos.push(nome); }
  }
  return feitos;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web'));
  console.log('versionados:', versionarWeb(dir).join(', ') || 'nenhum');
}
