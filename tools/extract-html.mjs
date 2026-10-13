// Extrai os blocos <script> do HTML legado para legacy/blocks (pasta gerada, fora do Git).
// Uso: node tools/extract-html.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LEGACY_HTML = path.join(root, 'legacy', 'Argos_Sentinel_v1.1.html');
const NAMES = ['01-nav', '02-lightweight-charts', '03-snapshot', '04-study', '05-engine', '06-live', '07-platform', '08-boot'];

/** Devolve o texto de cada bloco <script>, na ordem em que aparece no HTML. */
export function readBlocks(file = LEGACY_HTML) {
  const html = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  if (out.length !== NAMES.length) throw new Error(`esperava ${NAMES.length} blocos, achei ${out.length}`);
  return Object.fromEntries(out.map((b, i) => [NAMES[i], b]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.join(root, 'legacy', 'blocks');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(readBlocks())) {
    fs.writeFileSync(path.join(dir, name + '.js'), body);
    console.log(name.padEnd(24), body.length, 'chars');
  }
}
