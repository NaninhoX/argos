// Extrai do HTML legado a matriz publicada do estudo de referência v1.1 (72 células) e grava
// tests/fixtures/study-v1.1-matrix.json. É a "verdade publicada" contra a qual o motor é conferido.
// Uso: node tools/extract-study-matrix.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LEGACY_HTML } from './extract-html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(LEGACY_HTML, 'utf8');

const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
const pct = (s) => num(s) / 100;
const cells = [];
const re = /<button[^>]*class="[^"]*mx-cell[^"]*"[^>]*>/g;
let m;
while ((m = re.exec(html))) {
  const a = {};
  for (const x of m[0].matchAll(/data-([a-z-]+)="([^"]*)"/g)) a[x[1]] = x[2];
  const n = /^([\d.]+) \(efetivo ([\d.]+)\)$/.exec(a.n); // milhar com ponto: "2.141 (efetivo 1.950)"
  const ci = a.ci.split('–').map((s) => pct(s.trim()));
  const pLess = a.p.trim().startsWith('<');
  const qLess = a.q.trim().startsWith('<');
  if (!n || ci.length !== 2) throw new Error('célula em formato inesperado: ' + m[0].slice(0, 200));
  cells.push({
    sym: a.sym, tf: a.tf, id: a.id, verdict: a.v,
    n: num(n[1]), nEff: num(n[2]),
    winRate: pct(a.wr), ci, base: pct(a.base),
    p: num(a.p), pIsUpperBound: pLess, q: num(a.q), qIsUpperBound: qLess,
    window: a.win,
    shown: { n: a.n, wr: a.wr, ci: a.ci, base: a.base, p: a.p, q: a.q }
  });
}
if (cells.length !== 72) throw new Error('esperava 72 células, achei ' + cells.length);

const out = path.join(root, 'tests', 'fixtures', 'study-v1.1-matrix.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ source: 'legacy/Argos_Sentinel_v1.1.html (células .mx-cell)', study: 'v1.1', cut: '2026-09-26', cells }, null, 1) + '\n');
console.log('72 células gravadas em', path.relative(root, out));
