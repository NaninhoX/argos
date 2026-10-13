// Carrega, direto do HTML original da demo v1.1, o motor legado, o snapshot de candles e o resumo do estudo.
// O código legado roda no mesmo realm (new Function), para que arrays e objetos sejam comparáveis.
import { readBlocks } from '../../tools/extract-html.mjs';

let cache;

/** @returns {{ engine: any, snapshot: any, study: any }} */
export function loadLegacy() {
  if (cache) return cache;
  const blocks = readBlocks();
  const win = {};
  new Function('window', blocks['03-snapshot'])(win);
  new Function('window', blocks['04-study'])(win);
  new Function('window', blocks['05-engine'])(win);
  cache = { engine: win.ArgosEngine, snapshot: win.ARGOS_SNAPSHOT, study: win.ARGOS_STUDY };
  return cache;
}

/** Regra de saída padrão da demo e do estudo v1.1: alvo 2×ATR, stop 1×ATR, 12 candles. */
export const DEFAULT_CFG = Object.freeze({ mode: 'atr', tgt: 2, stp: 1, hold: 12 });
