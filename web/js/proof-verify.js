// Verificação da prova de previsão, no navegador e no Node. Sem DOM, sem rede, sem dependência.
// Contrato: docs/api-proof.md. Nada aqui confia em campo booleano do servidor (por exemplo `hashOk`):
// cada conta é refeita com SHA-256 local (`globalThis.crypto.subtle`).
//
// Cadeia conferida:
//   texto canônico --SHA-256--> hash da previsão (folha)
//   folha --caminho de Merkle (RFC 6962)--> raiz do dia
//   raiz do dia --consta no--> manifesto do dia; SHA-256 do manifesto = digest carimbado
//   carimbo OpenTimestamps: conferido fora do navegador (etapa sem veredito aqui)

const HEX64 = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PROOF_STEPS = 64; // uma árvore RFC 6962 com menos de 2^64 folhas não passa disso
const MANIFEST_SCHEMA = 'argos.raiz/1';
const LEAF_PREFIX = Uint8Array.of(0);
const NODE_PREFIX = Uint8Array.of(1);

/** Lançado quando o navegador não oferece SHA-256 (WebCrypto exige contexto seguro: https ou localhost). */
export class CryptoUnavailableError extends Error {
  constructor() {
    super('Este navegador não oferece SHA-256 (WebCrypto exige https). Use https ou confira com sha256sum.');
    this.name = 'CryptoUnavailableError';
  }
}

function subtle() {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new CryptoUnavailableError();
  return s;
}

function toBytes(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('esperado texto ou bytes');
}

function bytesToHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function hexToBytes(hex) {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function digest(bytes) {
  return new Uint8Array(await subtle().digest('SHA-256', bytes));
}

/**
 * SHA-256 em hexadecimal minúsculo. Texto vira UTF-8.
 * @param {string | ArrayBuffer | ArrayBufferView} data
 * @returns {Promise<string>}
 */
export async function sha256Hex(data) {
  return bytesToHex(await digest(toBytes(data)));
}

/**
 * Confere que a folha pertence à árvore de raiz `rootHex` pelo caminho `proof` (RFC 6962).
 * Folha = SHA-256(0x00 || hash); nó = SHA-256(0x01 || esquerda || direita).
 * `side` diz de que lado o irmão entra: 'R' (irmão à direita) ou 'L' (irmão à esquerda).
 * Entrada malformada devolve false (não lança). Mesmo resultado de `verifyProof` em lib/merkle.js.
 * @param {string} leafHex hash da previsão (64 hex minúsculos)
 * @param {{ side: 'L' | 'R', hash: string }[]} proof
 * @param {string} rootHex
 * @returns {Promise<boolean>}
 */
export async function verifyMerkle(leafHex, proof, rootHex) {
  if (!HEX64.test(leafHex ?? '') || !HEX64.test(rootHex ?? '')) return false;
  if (!Array.isArray(proof) || proof.length > MAX_PROOF_STEPS) return false;
  let h = await digest(concat(LEAF_PREFIX, hexToBytes(leafHex)));
  for (const step of proof) {
    if (!step || typeof step !== 'object' || !HEX64.test(step.hash ?? '')) return false;
    const sib = hexToBytes(step.hash);
    if (step.side === 'R') h = await digest(concat(NODE_PREFIX, h, sib));
    else if (step.side === 'L') h = await digest(concat(NODE_PREFIX, sib, h));
    else return false;
  }
  return bytesToHex(h) === rootHex;
}

/** Uma frase sobre o status da âncora. */
export function anchorStatusText(status) {
  switch (status) {
    case 'pendente': return 'A raiz do dia foi calculada e o carimbo ainda não foi enviado.';
    case 'ancorada': return 'O carimbo foi enviado aos calendários do OpenTimestamps. A confirmação no Bitcoin leva algumas horas.';
    case 'confirmada': return 'O carimbo foi confirmado no Bitcoin.';
    case 'falhou': return 'O envio do carimbo falhou e será refeito.';
    default: return 'Status da âncora desconhecido.';
  }
}

/** Comando de verificação externa do carimbo (cliente OpenTimestamps), com o manifesto na mesma pasta. */
export function otsCommand(day) {
  return `ots verify argos-raiz-${DAY.test(day ?? '') ? day : '<dia>'}.json.ots`;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

async function etapa(key, title, fn) {
  try {
    const { ok, detail } = await fn();
    return { key, ok, title, detail };
  } catch (err) {
    if (err instanceof CryptoUnavailableError) return { key, ok: null, title, detail: err.message };
    return { key, ok: false, title, detail: 'Não foi possível conferir esta etapa: ' + (err && err.message ? err.message : String(err)) };
  }
}

/**
 * Refaz no navegador as contas da prova. `body` é o corpo de `GET /api/proof?id=`.
 * Devolve quatro etapas, nesta ordem: hash, merkle, manifest, ots.
 * `ok`: true (confere), false (não confere) ou null (aguardando ou não verificável aqui).
 * @param {any} body
 * @returns {Promise<{ key: 'hash' | 'merkle' | 'manifest' | 'ots', ok: boolean | null, title: string, detail: string }[]>}
 */
export async function checkProof(body) {
  const b = isObj(body) ? body : {};
  const previsao = isObj(b.previsao) ? b.previsao : {};
  const anchor = isObj(b.anchor) ? b.anchor : null;
  const aguardando = anchor ? null : 'Aguardando o fechamento do dia. A raiz do dia só existe depois que o dia termina.';

  const hash = await etapa('hash', 'Hash do registro', async () => {
    if (typeof b.canonical !== 'string' || !b.canonical) return { ok: false, detail: 'O texto canônico não veio na resposta.' };
    if (!HEX64.test(previsao.hash ?? '')) return { ok: false, detail: 'O registro não traz um hash válido (64 caracteres hexadecimais minúsculos).' };
    const calc = await sha256Hex(b.canonical);
    return calc === previsao.hash
      ? { ok: true, detail: 'O SHA-256 do texto canônico, calculado neste navegador, é igual ao hash do registro.' }
      : { ok: false, detail: `O SHA-256 do texto canônico é ${calc}, mas o hash informado é ${previsao.hash}. O texto não corresponde ao hash.` };
  });

  const merkle = await etapa('merkle', 'Inclusão na raiz do dia', async () => {
    if (!anchor) return { ok: null, detail: aguardando };
    const ok = await verifyMerkle(previsao.hash, anchor.proof, anchor.root);
    const passos = Array.isArray(anchor.proof) ? anchor.proof.length : 0;
    return ok
      ? { ok: true, detail: `O hash do registro chega à raiz do dia pelo caminho de Merkle (RFC 6962), com ${passos} ${passos === 1 ? 'irmão' : 'irmãos'}.` }
      : { ok: false, detail: 'O caminho de Merkle não leva o hash do registro até a raiz informada.' };
  });

  const manifest = await etapa('manifest', 'Raiz no manifesto do dia', async () => {
    if (!anchor) return { ok: null, detail: aguardando };
    const problemas = [];
    if (typeof anchor.manifest !== 'string' || !anchor.manifest) {
      problemas.push('o manifesto não veio na resposta');
    } else {
      let m = null;
      try { m = JSON.parse(anchor.manifest); } catch { problemas.push('o manifesto não é um JSON válido'); }
      if (m !== null) {
        if (!isObj(m) || m.schema !== MANIFEST_SCHEMA) problemas.push(`o manifesto não é do tipo ${MANIFEST_SCHEMA}`);
        else {
          if (m.root !== anchor.root) problemas.push('a raiz do manifesto é diferente da raiz informada');
          if (m.day !== anchor.day) problemas.push('o dia do manifesto é diferente do dia informado');
          if (m.nLeaves !== anchor.nLeaves) problemas.push('o número de previsões do manifesto é diferente do informado');
        }
      }
      const calc = await sha256Hex(anchor.manifest);
      if (calc !== anchor.manifestSha256) problemas.push(`o SHA-256 do manifesto é ${calc}, mas o informado é ${anchor.manifestSha256}`);
    }
    return problemas.length
      ? { ok: false, detail: 'Não confere: ' + problemas.join('; ') + '.' }
      : { ok: true, detail: `A raiz e o dia constam no manifesto, e o SHA-256 do manifesto (${anchor.manifestSha256}) é o digest que vai ao carimbo.` };
  });

  const ots = await etapa('ots', 'Carimbo OpenTimestamps', async () => {
    if (!anchor) return { ok: null, detail: aguardando };
    const recibo = typeof anchor.otsUrl === 'string' && anchor.otsUrl ? '' : ' O recibo .ots ainda não está disponível.';
    return {
      ok: null,
      detail: `Status: ${anchor.status ?? 'desconhecido'}. ${anchorStatusText(anchor.status)}${recibo} ` +
        `Este navegador não verifica o carimbo. Baixe o manifesto e o recibo .ots na mesma pasta e verifique com um cliente OpenTimestamps (${otsCommand(anchor.day)}) ou em opentimestamps.org.`
    };
  });

  return [hash, merkle, manifest, ots];
}

/**
 * Resumo das etapas: 'nao_confere' se alguma falhou; 'confere' se hash, merkle e manifest conferem;
 * 'aguardando' se o hash confere e o dia ainda não foi fechado; 'indeterminado' nos demais casos.
 * @param {{ key: string, ok: boolean | null }[]} steps
 * @returns {'nao_confere' | 'confere' | 'aguardando' | 'indeterminado'}
 */
export function overallState(steps) {
  if (steps.some((s) => s.ok === false)) return 'nao_confere';
  const ok = (key) => steps.find((s) => s.key === key)?.ok;
  if (ok('hash') !== true) return 'indeterminado';
  if (ok('merkle') === true && ok('manifest') === true) return 'confere';
  return ok('merkle') === null && ok('manifest') === null ? 'aguardando' : 'indeterminado';
}
