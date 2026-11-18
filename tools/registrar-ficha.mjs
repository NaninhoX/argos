// Fichas de pré-registro: confere o hash canônico e carimba o digest com OpenTimestamps.
// Não toca em engine/. Só o SHA-256 canônico vai aos calendários públicos; o texto da ficha não é enviado (ele continua no Git, que é o
// registro público do conteúdo).
//
//   node tools/registrar-ficha.mjs hash <ficha.json>                        imprime o SHA-256 canônico (sem rede)
//   node tools/registrar-ficha.mjs conferir <ficha.json> --md <ficha.md>    compara com o hash do cabeçalho do .md (sem rede)
//   node tools/registrar-ficha.mjs carimbar <ficha.json> --saida <pasta> --confirmo-rede [--md <ficha.md>]
//                                                                           grava <nome>.ots e <nome>.sha256 na pasta
//   node tools/registrar-ficha.mjs --ajuda
//
// Só `carimbar` usa a rede, e só com --confirmo-rede. A pasta de saída fica fora do repositório (como no backup do
// Neon): o recibo e o hash são guardados por Michel, não versionados aqui. Detalhes em docs/registrar-ficha.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashCanonical } from '../lib/canonical.js';
import { readOts, stampDigest } from '../lib/ots.js';
import { dentroDoRepo } from './backup-neon.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const AJUDA = `uso:
  node tools/registrar-ficha.mjs hash <ficha.json>
  node tools/registrar-ficha.mjs conferir <ficha.json> --md <ficha.md>
  node tools/registrar-ficha.mjs carimbar <ficha.json> --saida <pasta fora do repositório> --confirmo-rede [--md <ficha.md>]
  node tools/registrar-ficha.mjs --ajuda

hash      imprime o SHA-256 do JSON canonizado (lib/canonical.js). Sem rede.
conferir  compara esse hash com o declarado no cabeçalho do .md. Sai com 0 se igual, 1 se diferente. Sem rede.
carimbar  pede o recibo OpenTimestamps do digest aos calendários públicos e grava <nome>.ots e <nome>.sha256 na
          pasta de saída. Usa a rede: recusa sem --confirmo-rede e recusa pasta dentro do repositório. Com --md,
          confere o hash antes de qualquer chamada de rede. Não sobrescreve arquivo existente. Use sempre --md: sem ele
          nada confere o digest contra o registro antes de carimbar.

Códigos de saída: 0 deu certo; 1 falha, divergência de hash ou recusa de uma salvaguarda; 2 comando ausente ou desconhecido,
ou argumento malformado.`;

/** Erro de uso ou de conferência: a mensagem já é para o usuário. */
export class FichaError extends Error {
  constructor(message) { super(message); this.name = 'FichaError'; }
}

/** Lê a ficha e devolve o objeto e o SHA-256 canônico. */
export function hashDaFicha(arquivo) {
  if (!arquivo || typeof arquivo !== 'string') throw new FichaError('informe o arquivo da ficha (.json)');
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch { throw new FichaError('ficha não encontrada: ' + arquivo); }
  let ficha;
  try { ficha = JSON.parse(texto); } catch { throw new FichaError('ficha ilegível (JSON inválido): ' + arquivo); }
  return hashCanonical(ficha);
}

/**
 * Extrai do .md o hash declarado no cabeçalho: a linha "**SHA-256 da ficha canônica** (...): `<64 hex>`".
 * Só a primeira linha com esse rótulo vale (o resto do documento pode citar outros hashes).
 * @param {string} texto
 * @returns {string | null}
 */
export function hashDoCabecalho(texto) {
  for (const linha of String(texto).split(/\r?\n/)) {
    if (!/SHA-256 da ficha can[oô]nica/i.test(linha)) continue;
    const m = linha.match(/`([0-9a-fA-F]{64})`/);
    return m ? m[1].toLowerCase() : null;
  }
  return null;
}

/**
 * Compara o hash canônico da ficha com o do cabeçalho do .md.
 * @returns {{ igual: boolean, calculado: string, declarado: string }}
 * @throws {FichaError} se o .md não existe ou não traz o hash no formato das fichas
 */
export function conferirFicha(fichaJson, fichaMd) {
  const calculado = hashDaFicha(fichaJson);
  if (!fichaMd || typeof fichaMd !== 'string') throw new FichaError('informe o .md da ficha com --md');
  let texto;
  try { texto = fs.readFileSync(fichaMd, 'utf8'); } catch { throw new FichaError('.md não encontrado: ' + fichaMd); }
  const declarado = hashDoCabecalho(texto);
  if (!declarado) throw new FichaError('o .md não traz o hash no formato "SHA-256 da ficha canônica ... `<64 hex>`": ' + fichaMd);
  return { igual: calculado === declarado, calculado, declarado };
}

/** Nome-base dos arquivos de saída: o da ficha sem a extensão .json. */
const nomeBase = (ficha) => path.basename(ficha).replace(/\.json$/i, '');

/**
 * Carimba o digest canônico da ficha. A rede entra por `stamp` (padrão: `stampDigest` de lib/ots.js; nos testes, uma função falsa).
 * Ordem: flag, pasta de saída, hash, conferência com o .md (se vier), arquivos de saída ainda inexistentes, e só então a rede.
 * @param {{ ficha: string, saida?: string, md?: string, confirmoRede?: boolean, stamp?: (digest: string) => Promise<{ ots: Buffer, calendars: string[], errors: { calendar: string, message: string }[] }>, repoRoot?: string }} opts
 * @returns {Promise<{ hash: string, ots: string, sha256: string, calendars: string[], errors: { calendar: string, message: string }[] }>}
 */
export async function carimbarFicha({ ficha, saida, md, confirmoRede = false, stamp = stampDigest, repoRoot = REPO_ROOT }) {
  if (confirmoRede !== true) throw new FichaError('carimbar usa a rede (calendários OpenTimestamps): confirme com --confirmo-rede');
  if (!saida || typeof saida !== 'string') throw new FichaError('informe a pasta de saída com --saida (fora do repositório)');
  const pasta = path.resolve(saida);
  if (dentroDoRepo(pasta, repoRoot)) throw new FichaError('pasta de saída recusada: o recibo fica fora do repositório (' + pasta + ')');
  const hash = hashDaFicha(ficha);
  if (md) {
    const c = conferirFicha(ficha, md);
    if (!c.igual) throw new FichaError(`hash da ficha não confere com o .md (calculado ${c.calculado}, declarado ${c.declarado}); nada foi enviado`);
  }
  const base = nomeBase(ficha);
  const ots = path.join(pasta, base + '.ots');
  const sha256 = path.join(pasta, base + '.sha256');
  for (const f of [ots, sha256]) if (fs.existsSync(f)) throw new FichaError('já existe ' + f + ' (um recibo não se sobrescreve)');

  const r = await stamp(hash);
  // Confere o que voltou antes de gravar: o recibo precisa ser do digest pedido.
  if (readOts(r.ots).digest !== hash) throw new FichaError('o recibo devolvido é de outro digest; nada foi gravado');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(ots, r.ots, { flag: 'wx' });
  fs.writeFileSync(sha256, hash + '\n', { flag: 'wx' });
  return { hash, ots, sha256, calendars: r.calendars || [], errors: r.errors || [] };
}

/** Lê `--nome valor` e `--flag` dos argumentos; o que sobra são os posicionais. */
function lerArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirmo-rede') opt.confirmoRede = true;
    else if (a === '--ajuda' || a === '-h') opt.ajuda = true;
    else if (a === '--md' || a === '--saida') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new FichaError('falta o valor de ' + a);
      opt[a.slice(2)] = v;
    } else if (a.startsWith('--')) throw new FichaError('opção desconhecida: ' + a);
    else pos.push(a);
  }
  return { pos, opt };
}

/**
 * Executa a linha de comando e devolve o código de saída (0 certo, 1 falha ou divergência, 2 uso).
 * @param {string[]} argv
 * @param {{ log?: (s: string) => void, err?: (s: string) => void, stamp?: Parameters<typeof carimbarFicha>[0]['stamp'], repoRoot?: string }} [io]
 */
export async function main(argv = process.argv.slice(2), { log = console.log, err = console.error, stamp, repoRoot } = {}) {
  let cmd, pos, opt;
  try {
    ({ pos, opt } = lerArgs(argv));
    cmd = pos[0];
  } catch (e) {
    err(e.message);
    return 2;
  }
  if (opt.ajuda || !cmd) { log(AJUDA); return opt.ajuda ? 0 : 2; }
  const ficha = pos[1];
  try {
    if (cmd === 'hash') {
      log(hashDaFicha(ficha));
      return 0;
    }
    if (cmd === 'conferir') {
      const c = conferirFicha(ficha, opt.md);
      if (c.igual) { log('CONFERE: ' + c.calculado); return 0; }
      err('NÃO CONFERE: a ficha calcula ' + c.calculado + ' e o .md declara ' + c.declarado + '. A ficha foi alterada depois do registro, ou o .md está errado.');
      return 1;
    }
    if (cmd === 'carimbar') {
      const r = await carimbarFicha({ ficha, saida: opt.saida, md: opt.md, confirmoRede: opt.confirmoRede === true, stamp, repoRoot });
      log('digest SHA-256 canônico: ' + r.hash);
      log('recibo gravado em ' + r.ots + ' (' + r.calendars.length + ' calendário(s))');
      log('hash gravado em ' + r.sha256);
      for (const e of r.errors) log('  sem resposta: ' + e.calendar + ' (' + e.message + ')');
      for (const a of readOts(fs.readFileSync(r.ots)).attestations) {
        log(a.kind === 'bitcoin' ? '  Bitcoin, bloco ' + a.height : a.kind === 'pending' ? '  pendente em ' + a.uri : '  atestação desconhecida');
      }
      log('O recibo nasce pendente: guarde o .ots e complete depois com `node tools/ots-stamp.mjs upgrade <arquivo>.ots`.');
      return 0;
    }
    err('subcomando desconhecido: ' + cmd + '\n' + AJUDA);
    return 2;
  } catch (e) {
    err('Falha: ' + e.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
