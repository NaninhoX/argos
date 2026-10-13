// Porta mecânica do motor: lê o bloco 05 do HTML legado e gera engine/index.js como módulo ES.
// Executado uma vez para criar a v1.1.0 no repositório. A transformação só troca o invólucro
// (IIFE que escrevia em window.ArgosEngine -> exports de módulo) e remove dois espaços de recuo.
// Nenhuma linha de lógica é tocada; tests/legacy-parity.test.js prova a equivalência.
// Depois desta porta, engine/index.js passa a ser a fonte; não rode de novo por cima de alterações.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readBlocks } from './extract-html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'engine', 'index.js');
if (fs.existsSync(out) && !process.argv.includes('--force')) {
  console.error('engine/index.js já existe. Use --force só se souber o que está fazendo.');
  process.exit(1);
}

const src = readBlocks()['05-engine'];
// Crases só aparecem em comentários de uma linha. Uma crase sem par na linha indicaria template
// string de várias linhas, em que remover recuo mudaria o conteúdo.
if (src.split('\n').some((l) => (l.split('`').length - 1) % 2 === 1)) throw new Error('template string de várias linhas no motor: a remoção de recuo precisa de revisão');

const strictAt = src.indexOf("'use strict';");
const bodyStart = src.indexOf('\n', strictAt) + 1;
const exportAt = src.indexOf('  root.ArgosEngine = {');
const exportEnd = src.indexOf('};', exportAt);
if (strictAt < 0 || exportAt < 0 || exportEnd < 0) throw new Error('estrutura do bloco 05 mudou');

const body = src.slice(bodyStart, exportAt).split('\n').map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n').trimEnd();
const members = src.slice(src.indexOf('{', exportAt) + 1, exportEnd).split(',').map((s) => s.trim()).filter(Boolean);
const versionMember = members.find((m) => m.startsWith('VERSION'));
const version = versionMember.slice(versionMember.indexOf(':') + 1).trim();
const names = members.filter((m) => !m.startsWith('VERSION'));

const header = `/* =====================================================================
   ARGOS SENTINEL · motor estatístico (argos-engine)
   Zero LLM neste módulo. Tudo determinístico e reproduzível (seed fixa).
   Indicadores seguem as definições do TradingView/Pine v5 (seed por SMA),
   para que o que o motor calcula bata com o que o TradingView desenha.

   Módulo puro: sem rede, sem banco. Entra a série de candles e a regra de
   saída; sai o objeto de análise. Portado sem alteração de lógica do HTML
   da demo v1.1 (legacy/), por tools/port-engine.mjs.
   ===================================================================== */
`;

const footer = `
export const VERSION = ${version};

export {
  ${names.join(', ')}
};

/** Mesmo objeto que a demo expunha em window.ArgosEngine. */
const ArgosEngine = {
  ${names.join(', ')}, VERSION
};
export default ArgosEngine;
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, header + '\n' + body + '\n' + footer);
console.log('engine/index.js gerado:', names.length + 1, 'membros exportados,', version);
