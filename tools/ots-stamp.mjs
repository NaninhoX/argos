// Carimbo OpenTimestamps de um arquivo qualquer (ex.: a planilha de calibração do plano, um relatório em PDF).
// O arquivo não sai da máquina: só o SHA-256 dele vai aos calendários públicos.
//
//   node tools/ots-stamp.mjs stamp <arquivo>          grava <arquivo>.ots (não sobrescreve)
//   node tools/ots-stamp.mjs upgrade <arquivo>.ots    tenta completar o recibo com o bloco do Bitcoin
//   node tools/ots-stamp.mjs info <arquivo>.ots       mostra digest e atestações
//
// Verificação por terceiros: `ots verify <arquivo>.ots` (com o arquivo na mesma pasta) ou opentimestamps.org.
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import { readOts, stampDigest, upgradeOts } from '../lib/ots.js';

const [, , cmd, file] = process.argv;
const fail = (msg) => { console.error(msg); process.exit(1); };
if (!['stamp', 'upgrade', 'info'].includes(cmd) || !file) fail('uso: node tools/ots-stamp.mjs stamp|upgrade|info <arquivo>');
if (!fs.existsSync(file)) fail('arquivo não encontrado: ' + file);

const show = (ots) => {
  const info = readOts(ots);
  console.log('digest SHA-256: ' + info.digest);
  for (const a of info.attestations) {
    console.log(a.kind === 'bitcoin' ? '  Bitcoin, bloco ' + a.height : a.kind === 'pending' ? '  pendente em ' + a.uri : '  atestação desconhecida');
  }
};

if (cmd === 'stamp') {
  const out = file + '.ots';
  if (fs.existsSync(out)) fail('já existe ' + out + ' (um recibo não se sobrescreve; use upgrade)');
  const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const r = await stampDigest(digest);
  fs.writeFileSync(out, r.ots, { flag: 'wx' });
  console.log('recibo gravado em ' + out + ' (' + r.calendars.length + ' calendário(s))');
  for (const e of r.errors) console.log('  sem resposta: ' + e.calendar + ' (' + e.message + ')');
  show(r.ots);
} else if (cmd === 'upgrade') {
  const r = await upgradeOts(fs.readFileSync(file));
  if (r.changed) fs.writeFileSync(file, r.ots);
  console.log(r.confirmed ? 'recibo contém atestação Bitcoin' : 'ainda pendente (o Bitcoin leva algumas horas)');
  for (const e of r.errors) console.log('  erro: ' + e.calendar + ' (' + e.message + ')');
  show(r.ots);
} else {
  show(fs.readFileSync(file));
}
