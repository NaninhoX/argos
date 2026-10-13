// Cliente mínimo do OpenTimestamps: carimba um digest SHA-256 nos calendários públicos e monta o recibo
// (.ots) no formato que qualquer cliente OpenTimestamps lê. Sem dependência: só o necessário do formato.
//
// Arquivo .ots = cabeçalho mágico ‖ versão (1) ‖ 0x08 (SHA-256) ‖ digest (32 bytes) ‖ carimbo.
// Carimbo = árvore: cada nó tem uma mensagem; dele saem operações (que levam a outro nó) e atestações.
// Na serialização, todo item menos o último vem depois de 0xff; atestação começa com 0x00.
// O calendário devolve o carimbo do digest enviado, terminando numa atestação "pendente" (a URL do
// calendário). Dias depois, o mesmo calendário entrega o trecho que chega a um bloco do Bitcoin.
//
// O que este módulo NÃO faz: conferir a atestação contra o Bitcoin. Isso é do verificador externo
// (`ots verify`), que é justamente quem não precisa confiar na Stratum.
import { createHash } from 'node:crypto';

export const HEADER_MAGIC = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');
const VERSION = 1;
const TAG_SHA256 = 0x08;
const PENDING = Buffer.from('83dfe30d2ef90c8e', 'hex');
const BITCOIN = Buffer.from('0588960d73d71901', 'hex');
const MAX_MSG = 4096;
const MAX_RESPONSE = 10000;

/** Agregadores públicos (os mesmos do cliente de referência). */
export const DEFAULT_CALENDARS = Object.freeze([
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com',
  'https://ots.btc.catallaxy.com'
]);
/** Só se consulta calendário destes domínios ao completar um recibo (a URL vem de dentro do recibo). */
const UPGRADE_HOSTS = ['.calendar.opentimestamps.org', '.calendar.eternitywall.com', '.calendar.catallaxy.com'];

export class OtsError extends Error {
  constructor(message, errors = []) { super(message); this.name = 'OtsError'; this.errors = errors; }
}

const hash = (alg) => (msg) => createHash(alg).update(msg).digest();
const OPS = {
  0xf0: { binary: true, apply: (msg, arg) => Buffer.concat([msg, arg]) },   // append
  0xf1: { binary: true, apply: (msg, arg) => Buffer.concat([arg, msg]) },   // prepend
  0xf2: { apply: (msg) => Buffer.from(msg).reverse() },                     // reverse
  0xf3: { apply: (msg) => Buffer.from(msg.toString('hex')) },               // hexlify
  0x02: { apply: hash('sha1') },
  0x03: { apply: hash('ripemd160') },
  0x08: { apply: hash('sha256') }
};

function toDigest(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex)) throw new TypeError('esperado digest SHA-256 em hexadecimal minúsculo');
  return Buffer.from(hex, 'hex');
}

function reader(buf) {
  let pos = 0;
  const need = (n) => { if (pos + n > buf.length) throw new OtsError('carimbo truncado'); };
  const r = {
    byte() { need(1); return buf[pos++]; },
    bytes(n) { need(n); pos += n; return buf.subarray(pos - n, pos); },
    varuint() {
      let value = 0, shift = 0;
      for (;;) {
        const b = r.byte();
        value += (b & 0x7f) * 2 ** shift;
        if (!(b & 0x80)) return value;
        shift += 7;
        if (shift > 49) throw new OtsError('inteiro grande demais no carimbo');
      }
    },
    varbytes(max) { const n = r.varuint(); if (n > max) throw new OtsError('campo grande demais no carimbo'); return r.bytes(n); },
    get done() { return pos === buf.length; }
  };
  return r;
}

function varuint(n) {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); } while (n > 0);
  return Buffer.from(out);
}
const varbytes = (b) => Buffer.concat([varuint(b.length), b]);

/** @typedef {{ msg: Buffer, attestations: { tag: Buffer, payload: Buffer }[], ops: { tag: number, arg: Buffer | null, next: Node }[] }} Node */

/** @returns {Node} */
function parseNode(r, msg, depth) {
  if (depth > 256) throw new OtsError('carimbo profundo demais');
  const node = { msg, attestations: [], ops: [] };
  const item = (tag) => {
    if (tag === 0x00) {
      const t = Buffer.from(r.bytes(8));
      node.attestations.push({ tag: t, payload: Buffer.from(r.varbytes(8192)) });
      return;
    }
    const op = OPS[tag];
    if (!op) throw new OtsError('operação desconhecida no carimbo: 0x' + tag.toString(16));
    const arg = op.binary ? Buffer.from(r.varbytes(MAX_MSG)) : null;
    if (op.binary && !arg.length) throw new OtsError('operação sem argumento no carimbo');
    let out;
    try { out = op.apply(msg, arg); } catch { throw new OtsError('operação não suportada neste ambiente: 0x' + tag.toString(16)); }
    if (out.length > MAX_MSG) throw new OtsError('mensagem grande demais no carimbo');
    node.ops.push({ tag, arg, next: parseNode(r, out, depth + 1) });
  };
  let tag = r.byte();
  while (tag === 0xff) { item(r.byte()); tag = r.byte(); }
  item(tag);
  return node;
}

/** Lê um carimbo (sem cabeçalho) da mensagem `msg`. Recusa bytes sobrando e carimbo sem atestação. */
function parseTimestamp(buf, msg) {
  const r = reader(buf);
  const node = parseNode(r, msg, 0);
  if (!r.done) throw new OtsError('bytes sobrando depois do carimbo');
  if (!listAttestations(node).length) throw new OtsError('carimbo sem atestação');
  return node;
}

function serializeNode(node) {
  const items = [
    ...node.attestations.map((a) => Buffer.concat([Buffer.from([0x00]), a.tag, varbytes(a.payload)])),
    ...node.ops.map((o) => Buffer.concat([Buffer.from([o.tag]), o.arg ? varbytes(o.arg) : Buffer.alloc(0), serializeNode(o.next)]))
  ];
  if (!items.length) throw new OtsError('nó vazio não pode ser serializado');
  return Buffer.concat(items.flatMap((it, i) => (i < items.length - 1 ? [Buffer.from([0xff]), it] : [it])));
}

/** Junta `b` em `a` (mesma mensagem): atestações e operações repetidas não duplicam. */
function mergeNode(a, b) {
  if (!a.msg.equals(b.msg)) throw new OtsError('carimbos de mensagens diferentes não se juntam');
  for (const att of b.attestations) {
    if (!a.attestations.some((x) => x.tag.equals(att.tag) && x.payload.equals(att.payload))) a.attestations.push(att);
  }
  for (const op of b.ops) {
    const same = a.ops.find((x) => x.tag === op.tag && (x.arg ? op.arg && x.arg.equals(op.arg) : !op.arg));
    if (same) mergeNode(same.next, op.next); else a.ops.push(op);
  }
  return a;
}

function describe(att, node) {
  const commitment = node.msg.toString('hex');
  try {
    if (att.tag.equals(PENDING)) {
      const r = reader(att.payload);
      const uri = r.varbytes(1000).toString('utf8');
      if (!r.done || !/^[A-Za-z0-9.\-_/:]+$/.test(uri)) throw new OtsError('URL de calendário inválida');
      return { kind: 'pending', uri, commitment };
    }
    if (att.tag.equals(BITCOIN)) return { kind: 'bitcoin', height: reader(att.payload).varuint(), commitment };
  } catch { /* cai em desconhecida */ }
  return { kind: 'unknown', commitment };
}

function listAttestations(node, out = []) {
  for (const att of node.attestations) out.push({ ...describe(att, node), node });
  for (const op of node.ops) listAttestations(op.next, out);
  return out;
}

const publicAttestations = (root) => listAttestations(root).map(({ node: _n, ...a }) => a);

function serializeFile(digest, root) {
  return Buffer.concat([HEADER_MAGIC, Buffer.from([VERSION, TAG_SHA256]), digest, serializeNode(root)]);
}

function parseFile(buf) {
  const head = HEADER_MAGIC.length;
  if (!Buffer.isBuffer(buf) || buf.length < head + 2 + 32 || !buf.subarray(0, head).equals(HEADER_MAGIC)) throw new OtsError('não é um recibo OpenTimestamps');
  if (buf[head] !== VERSION) throw new OtsError('versão de recibo não suportada: ' + buf[head]);
  if (buf[head + 1] !== TAG_SHA256) throw new OtsError('recibo de digest que não é SHA-256');
  const digest = Buffer.from(buf.subarray(head + 2, head + 34));
  const timestamp = Buffer.from(buf.subarray(head + 34));
  return { digest, timestamp, root: parseTimestamp(timestamp, digest) };
}

/**
 * Monta o recibo a partir das respostas dos calendários (cada uma é o carimbo do digest enviado).
 * @param {string} digestHex
 * @param {Uint8Array[]} responses
 * @returns {Buffer}
 */
export function buildOts(digestHex, responses) {
  const digest = toDigest(digestHex);
  if (!responses || !responses.length) throw new OtsError('nenhuma resposta de calendário');
  const nodes = responses.map((r) => parseTimestamp(Buffer.from(r), digest));
  return serializeFile(digest, nodes.reduce(mergeNode));
}

/**
 * Lê e valida um recibo.
 * @param {Uint8Array} buf
 * @returns {{ version: number, digest: string, timestamp: Buffer, attestations: { kind: 'pending' | 'bitcoin' | 'unknown', uri?: string, height?: number, commitment: string }[] }}
 */
export function readOts(buf) {
  const { digest, timestamp, root } = parseFile(Buffer.from(buf));
  return { version: VERSION, digest: digest.toString('hex'), timestamp, attestations: publicAttestations(root) };
}
export const readOtsHeader = readOts;

async function call(fetchImpl, url, init, timeoutMs) {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_RESPONSE) throw new Error('resposta grande demais');
  return body;
}
const HEADERS = { accept: 'application/vnd.opentimestamps.v1', 'user-agent': 'argos-ots' };

/**
 * Envia o digest aos calendários e devolve o recibo com uma atestação pendente por calendário que respondeu.
 * @param {string} digestHex SHA-256 em hexadecimal minúsculo
 * @param {{ calendars?: readonly string[], fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ots: Buffer, calendars: string[], errors: { calendar: string, message: string }[] }>}
 * @throws {OtsError} se nenhum calendário devolveu um carimbo válido
 */
export async function stampDigest(digestHex, { calendars = DEFAULT_CALENDARS, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const digest = toDigest(digestHex);
  const results = await Promise.all(calendars.map(async (calendar) => {
    try {
      const body = await call(fetchImpl, calendar.replace(/\/+$/, '') + '/digest', { method: 'POST', headers: { ...HEADERS, 'content-type': 'application/x-www-form-urlencoded' }, body: digest }, timeoutMs);
      return { calendar, node: parseTimestamp(body, digest) };
    } catch (e) {
      return { calendar, message: String((e && e.message) || e) };
    }
  }));
  const ok = results.filter((r) => r.node);
  const errors = results.filter((r) => !r.node).map(({ calendar, message }) => ({ calendar, message }));
  if (!ok.length) throw new OtsError('nenhum calendário OpenTimestamps respondeu', errors);
  return { ots: serializeFile(digest, ok.map((r) => r.node).reduce(mergeNode)), calendars: ok.map((r) => r.calendar), errors };
}

function upgradeUrl(uri, commitment) {
  let u;
  try { u = new URL(uri); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !UPGRADE_HOSTS.some((h) => u.hostname.endsWith(h))) return null;
  return u.origin + u.pathname.replace(/\/+$/, '') + '/timestamp/' + commitment;
}

/**
 * Pergunta aos calendários das atestações pendentes se o carimbo já chegou a um bloco do Bitcoin e,
 * se chegou, incorpora o trecho ao recibo. `confirmed` diz só que o recibo CONTÉM atestação Bitcoin.
 * @param {Uint8Array} otsBuf
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ots: Buffer, changed: boolean, confirmed: boolean, attestations: object[], errors: { calendar: string, message: string }[] }>}
 */
export async function upgradeOts(otsBuf, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const { digest, root } = parseFile(Buffer.from(otsBuf));
  const before = serializeNode(root);
  const errors = [];
  await Promise.all(listAttestations(root).filter((a) => a.kind === 'pending').map(async (att) => {
    const url = upgradeUrl(att.uri, att.commitment);
    if (!url) { errors.push({ calendar: att.uri, message: 'calendário fora da lista permitida' }); return; }
    try {
      const body = await call(fetchImpl, url, { method: 'GET', headers: HEADERS }, timeoutMs);
      mergeNode(att.node, parseTimestamp(body, att.node.msg));
    } catch (e) {
      if (e && e.status === 404) return; // ainda não chegou a um bloco
      errors.push({ calendar: att.uri, message: String((e && e.message) || e) });
    }
  }));
  const after = serializeNode(root);
  const attestations = publicAttestations(root);
  return { ots: serializeFile(digest, root), changed: !after.equals(before), confirmed: attestations.some((a) => a.kind === 'bitcoin'), attestations, errors };
}
