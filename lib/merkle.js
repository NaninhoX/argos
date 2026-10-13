// Árvore de Merkle no formato da RFC 6962 (Certificate Transparency).
// Uma raiz por dia resume todas as previsões do dia; é essa raiz que vai ao OpenTimestamps.
// Folha = SHA-256(0x00 || dado); nó = SHA-256(0x01 || esquerda || direita). Os prefixos impedem
// que um nó interno se passe por folha. Número ímpar de folhas: a árvore se divide na maior
// potência de 2 menor que n (não se duplica a última folha).
import { createHash } from 'node:crypto';

const sha = (...bufs) => { const h = createHash('sha256'); for (const b of bufs) h.update(b); return h.digest(); };
const LEAF = Buffer.from([0]);
const NODE = Buffer.from([1]);
const toBuf = (hex) => {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex)) throw new TypeError('esperado hash SHA-256 em hexadecimal minúsculo');
  return Buffer.from(hex, 'hex');
};
const leafHash = (hex) => sha(LEAF, toBuf(hex));
const split = (n) => { let k = 1; while (k * 2 < n) k *= 2; return k; };

function rootOf(leaves) {
  if (leaves.length === 1) return leafHash(leaves[0]);
  const k = split(leaves.length);
  return sha(NODE, rootOf(leaves.slice(0, k)), rootOf(leaves.slice(k)));
}

function pathOf(leaves, index) {
  if (leaves.length === 1) return [];
  const k = split(leaves.length);
  return index < k
    ? [...pathOf(leaves.slice(0, k), index), { side: 'R', hash: rootOf(leaves.slice(k)).toString('hex') }]
    : [...pathOf(leaves.slice(k), index - k), { side: 'L', hash: rootOf(leaves.slice(0, k)).toString('hex') }];
}

/** Raiz (hex) de uma lista ordenada de hashes de previsão (hex de 64 caracteres). */
export function merkleRoot(leaves) {
  if (!leaves.length) throw new RangeError('árvore de Merkle sem folhas');
  return rootOf(leaves).toString('hex');
}

/** Caminho de auditoria da folha `index`: lista de irmãos, da folha para a raiz. */
export function merkleProof(leaves, index) {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new RangeError('índice de folha inválido');
  return pathOf(leaves, index);
}

/** Confere que `leaf` pertence à árvore de raiz `root` pelo caminho `proof`. */
export function verifyProof(leaf, proof, root) {
  let h = leafHash(leaf);
  for (const step of proof) {
    const sib = toBuf(step.hash);
    if (step.side === 'R') h = sha(NODE, h, sib);
    else if (step.side === 'L') h = sha(NODE, sib, h);
    else return false;
  }
  return h.toString('hex') === root;
}
