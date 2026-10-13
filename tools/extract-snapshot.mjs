// Grava data/snapshot-v1.1.json a partir do bloco 03 do HTML legado (candles reais da Binance até 26/09/2026).
// É o dado de partida do servidor enquanto a base de candles (Postgres) não existe, e a base dos testes.
// Uso: node tools/extract-snapshot.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readBlocks } from './extract-html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = {};
new Function('window', readBlocks()['03-snapshot'])(win);
const out = path.join(root, 'data', 'snapshot-v1.1.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(win.ARGOS_SNAPSHOT));
const s = win.ARGOS_SNAPSHOT;
console.log('snapshot gravado:', Object.keys(s.series).length, 'séries, corte', s.cut, '·', (fs.statSync(out).size / 1e6).toFixed(1), 'MB');
