// Divisão única do HTML legado em arquivos editáveis dentro de web/.
// O HTML da demo trazia marcação, CSS, biblioteca de gráficos, dados, motor e interface num arquivo só.
// Esta ferramenta separa cada bloco <script> em seu arquivo e troca o bloco por <script src>, sem mudar
// a ordem nem o conteúdo. Depois dela, web/index.html e web/js/{nav,live,platform,boot}.js passam a ser
// a fonte do front. Dados e motor do navegador são gerados por tools/build-web.mjs.
// Uso: node tools/split-web.mjs   (recusa sobrescrever; --force para refazer)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LEGACY_HTML } from './extract-html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');
const TARGETS = [
  { src: 'js/nav.js', write: true },
  { src: 'js/vendor/lightweight-charts.js', write: true },
  { src: 'data/snapshot.js', write: false }, // gerado por build-web a partir de data/snapshot-v1.1.json
  { src: 'data/study.js', write: false },    // gerado por build-web a partir de data/study-v1.1.json
  { src: 'js/engine.js', write: false },     // gerado por build-web a partir de engine/index.js
  { src: 'js/live.js', write: true },
  { src: 'js/platform.js', write: true },
  { src: 'js/boot.js', write: true }
];

if (fs.existsSync(path.join(web, 'js', 'live.js')) && !process.argv.includes('--force')) {
  console.error('web/js/live.js já existe: o front já foi dividido. Use --force só para refazer do zero.');
  process.exit(1);
}

const html = fs.readFileSync(LEGACY_HTML, 'utf8');
let i = 0;
const index = html.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, (_all, body) => {
  const t = TARGETS[i++];
  if (!t) throw new Error('mais blocos <script> do que o esperado');
  if (t.write) {
    const file = path.join(web, t.src);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body.replace(/^\r?\n/, ''));
  }
  return `<script src="${t.src}"></script>`;
});
if (i !== TARGETS.length) throw new Error(`esperava ${TARGETS.length} blocos, achei ${i}`);

// O resumo do estudo é dado pequeno e fixo: fica versionado em data/ e o build gera a versão do navegador.
const win = {};
new Function('window', /<script[^>]*>(window\.ARGOS_STUDY=[\s\S]*?)<\/script>/.exec(html)[1])(win);
fs.writeFileSync(path.join(root, 'data', 'study-v1.1.json'), JSON.stringify(win.ARGOS_STUDY, null, 1) + '\n');

fs.writeFileSync(path.join(web, 'index.html'), index);
console.log('web/index.html:', (index.length / 1024).toFixed(0), 'KB ·', TARGETS.filter((t) => t.write).map((t) => t.src).join(', '));
