import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, sha256Hex as serverSha } from '../lib/canonical.js';
import { merkleRoot, merkleProof, verifyProof } from '../lib/merkle.js';
import {
  sha256Hex, verifyMerkle, checkProof, overallState, anchorStatusText, otsCommand, CryptoUnavailableError
} from '../web/js/proof-verify.js';

const SIZES = [1, 2, 3, 5, 8];
const DAY = '2026-10-12';

const flipHex = (h) => (h[0] === '0' ? '1' : '0') + h.slice(1);
const flipChar = (s, k) => s.slice(0, k) + (s[k] === 'a' ? 'b' : 'a') + s.slice(k + 1);

/** Registro no formato argos.previsao/1 (docs/api-proof.md), com acentos para exercitar UTF-8. */
function registro(i) {
  return {
    schema: 'argos.previsao/1',
    engine: 'argos-engine 1.1.0',
    origin: 'demo',
    originRef: null,
    emittedAt: new Date(Date.UTC(2026, 9, 12, 15, i, 5, 123)).toISOString(),
    input: { symbol: 'BTCUSDT', timeframe: '4h', cfg: { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, windowDays: null },
    data: { candles: 9000, from: '2024-01-01T00:00:00.000Z', to: '2026-10-12T12:00:00.000Z', warmupCandles: 200, hash: serverSha('serie-' + i) },
    resultHash: serverSha('resultado-' + i),
    regime: { regime: 'LOW_VOL_RANGING', label: 'Lateral com baixa volatilidade', confidence: 0.4, since: '2026-10-10T08:00:00.000Z', bars: 12 },
    base: { rate: 0.31, n: 5000 },
    setup: {
      id: 'RSI_OVERSOLD', nome: 'RSI Oversold', def: 'RSI(14) cruza de volta acima de 30 (saída da sobrevenda).',
      n: 290, nEff: 120, winRate: 0.2069, ci: [0.164, 0.257], method: 'wilson', base: 0.31, pTwo: 0.025, q: 0.1, family: 8,
      verdict: { key: 'SEM_EDGE', label: 'Sem vantagem demonstrável', tone: 'muted' }, activeNow: true, lastTriggerTime: '2026-10-12T12:00:00.000Z'
    }
  };
}

/** Um dia com `n` previsões: folhas, árvore, manifesto e o corpo de GET /api/proof de cada folha. */
function makeDay(n, status = 'ancorada') {
  const canonicals = Array.from({ length: n }, (_, i) => canonicalize(registro(i)));
  const leaves = canonicals.map((c) => serverSha(c));
  const root = merkleRoot(leaves);
  const manifest = canonicalize({ schema: 'argos.raiz/1', day: DAY, nLeaves: n, root });
  const manifestSha256 = serverSha(manifest);
  const body = (i) => ({
    previsao: { id: '3f2b8c1e-0000-4000-8000-00000000000' + i, hash: leaves[i], emittedAt: registro(i).emittedAt, origin: 'demo', engine: 'argos-engine 1.1.0', setupId: 'RSI_OVERSOLD', symbol: 'BTCUSDT', timeframe: '4h', verdict: 'SEM_EDGE', supersedes: null },
    canonical: canonicals[i],
    hashOk: true,
    anchor: {
      day: DAY, root, nLeaves: n, leafIndex: i, proof: merkleProof(leaves, i), status,
      manifest, manifestSha256,
      manifestUrl: `/api/proof?day=${DAY}&format=manifest`,
      otsUrl: status === 'pendente' ? null : `/api/proof?day=${DAY}&format=ots`
    },
    anchorPending: null,
    desfecho: null,
    disclaimer: 'Disclaimer de teste.'
  });
  return { canonicals, leaves, root, manifest, manifestSha256, body };
}

const byKey = (steps) => Object.fromEntries(steps.map((s) => [s.key, s]));
const oks = (steps) => steps.map((s) => s.ok);

// ---------------------------------------------------------------- sha256Hex

test('sha256Hex: vetores conhecidos e acordo com o servidor (texto e bytes)', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  for (const s of ['', 'abc', 'ação, previsão, sobrevenda', '{"a":"𝄞 ✓"}', 'x'.repeat(10000)]) {
    assert.equal(await sha256Hex(s), serverSha(s), s.slice(0, 20));
  }
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
  const esperado = serverSha(Buffer.from(bytes));
  assert.equal(await sha256Hex(bytes), esperado);
  assert.equal(await sha256Hex(Buffer.from(bytes)), esperado);
  assert.equal(await sha256Hex(bytes.buffer), esperado);
  // visão de parte de um buffer maior: só os bytes da visão entram no hash
  const grande = new Uint8Array(500); grande.set(bytes, 100);
  assert.equal(await sha256Hex(grande.subarray(100, 400)), esperado);
});

test('sha256Hex: entrada que não é texto nem bytes é recusada', async () => {
  await assert.rejects(() => sha256Hex(42), TypeError);
  await assert.rejects(() => sha256Hex(null), TypeError);
});

// ------------------------------------------------------------- verifyMerkle

test('verifyMerkle concorda com o servidor em toda folha de dias com 1, 2, 3, 5 e 8 previsões', async () => {
  for (const n of SIZES) {
    const { leaves, root } = makeDay(n);
    for (let i = 0; i < n; i++) {
      const proof = merkleProof(leaves, i);
      assert.equal(await verifyMerkle(leaves[i], proof, root), true, `n=${n} folha=${i}`);
      assert.equal(verifyProof(leaves[i], proof, root), true);
    }
  }
});

test('verifyMerkle concorda com o servidor ao recusar folha, raiz, irmão, lado e tamanho errados', async () => {
  for (const n of SIZES) {
    const { leaves, root } = makeDay(n);
    const outra = serverSha('outra-folha');
    for (let i = 0; i < n; i++) {
      const proof = merkleProof(leaves, i);
      const variantes = [
        ['folha errada', outra, proof, root],
        ['raiz errada', leaves[i], proof, flipHex(root)],
        ['raiz de outra árvore', leaves[i], proof, merkleRoot([...leaves, outra])],
        ['passo a mais', leaves[i], [...proof, { side: 'R', hash: outra }], root]
      ];
      if (proof.length) {
        variantes.push(['passo a menos', leaves[i], proof.slice(0, -1), root]);
        proof.forEach((p, k) => {
          variantes.push([`irmão ${k} adulterado`, leaves[i], proof.map((q, j) => (j === k ? { ...q, hash: flipHex(q.hash) } : q)), root]);
          variantes.push([`lado ${k} trocado`, leaves[i], proof.map((q, j) => (j === k ? { ...q, side: q.side === 'L' ? 'R' : 'L' } : q)), root]);
        });
      }
      for (const [nome, l, p, r] of variantes) {
        assert.equal(await verifyMerkle(l, p, r), false, `${nome} n=${n} folha=${i}`);
        assert.equal(verifyProof(l, p, r), false, `servidor: ${nome} n=${n} folha=${i}`);
      }
    }
  }
});

test('verifyMerkle: folha única tem raiz SHA-256(0x00 || folha) e caminho vazio', async () => {
  const folha = serverSha('uma');
  assert.equal(await verifyMerkle(folha, [], merkleRoot([folha])), true);
  assert.equal(await verifyMerkle(folha, [], folha), false);
});

test('verifyMerkle: entrada malformada devolve false, sem lançar', async () => {
  const { leaves, root } = makeDay(3);
  const proof = merkleProof(leaves, 1);
  assert.equal(await verifyMerkle(leaves[1], 'x', root), false);
  assert.equal(await verifyMerkle(leaves[1], null, root), false);
  assert.equal(await verifyMerkle(leaves[1], [null], root), false);
  assert.equal(await verifyMerkle(leaves[1], [{ side: 'X', hash: leaves[0] }], root), false);
  assert.equal(await verifyMerkle(leaves[1], [{ side: 'L', hash: 'curto' }], root), false);
  assert.equal(await verifyMerkle(leaves[1], [{ side: 'L' }], root), false);
  assert.equal(await verifyMerkle('curto', proof, root), false);
  assert.equal(await verifyMerkle(leaves[1], proof, root.toUpperCase()), false);
  assert.equal(await verifyMerkle(undefined, proof, root), false);
  assert.equal(await verifyMerkle(leaves[1], proof, undefined), false);
  assert.equal(await verifyMerkle(leaves[1], Array(65).fill({ side: 'L', hash: leaves[0] }), root), false);
});

// --------------------------------------------------------------- checkProof

test('checkProof: dia fechado confere nas etapas 1 a 3 para toda folha (1, 2, 3, 5 e 8 previsões)', async () => {
  for (const n of SIZES) {
    const dia = makeDay(n);
    for (let i = 0; i < n; i++) {
      const steps = await checkProof(dia.body(i));
      assert.deepEqual(steps.map((s) => s.key), ['hash', 'merkle', 'manifest', 'ots']);
      assert.deepEqual(oks(steps), [true, true, true, null], `n=${n} folha=${i}: ${steps.map((s) => s.detail).join(' | ')}`);
      for (const s of steps) {
        assert.deepEqual(Object.keys(s).sort(), ['detail', 'key', 'ok', 'title']);
        assert.ok(s.title && s.detail);
      }
      assert.equal(overallState(steps), 'confere');
    }
  }
});

test('checkProof: sem âncora, a etapa 1 confere e as etapas 2 a 4 aguardam o fechamento do dia', async () => {
  const dia = makeDay(3);
  const body = { ...dia.body(0), anchor: null, anchorPending: { day: DAY, expectedAfter: '2026-10-13T00:10:00.000Z' } };
  const steps = await checkProof(body);
  assert.deepEqual(oks(steps), [true, null, null, null]);
  for (const s of steps.slice(1)) assert.match(s.detail, /Aguardando o fechamento do dia/);
  assert.equal(overallState(steps), 'aguardando');
});

test('checkProof: não confia em hashOk, só no que recalcula', async () => {
  const dia = makeDay(2);
  const body = dia.body(0);
  body.canonical = flipChar(body.canonical, 40);
  assert.equal(body.hashOk, true);
  const steps = byKey(await checkProof(body));
  assert.equal(steps.hash.ok, false);
  assert.match(steps.hash.detail, /não corresponde/);
  // e o contrário: hashOk falso do servidor não derruba uma prova que confere
  const ok = dia.body(0);
  ok.hashOk = false;
  assert.deepEqual(oks(await checkProof(ok)), [true, true, true, null]);
});

test('checkProof: um caractere a menos ou a mais no texto canônico faz a etapa 1 falhar', async () => {
  const dia = makeDay(3);
  const base = dia.body(1);
  const c = base.canonical;
  // vários pontos do texto, inclusive o primeiro, um acento e o último caractere
  const posicoes = new Set([0, 1, 7, 33, Math.floor(c.length / 2), c.indexOf('á'), c.length - 2, c.length - 1]);
  for (const k of posicoes) {
    const body = structuredClone(base);
    body.canonical = flipChar(c, k);
    const steps = await checkProof(body);
    assert.equal(steps[0].ok, false, `posição ${k}`);
    // as demais etapas não dependem do texto: a falha fica localizada na etapa 1
    assert.deepEqual(oks(steps).slice(1), [true, true, null], `posição ${k}`);
    assert.equal(overallState(steps), 'nao_confere');
  }
  for (const canonical of [c.slice(0, -1), c + ' ', c + '\n', c.replace('"demo"', '"real"')]) {
    assert.equal((await checkProof({ ...structuredClone(base), canonical }))[0].ok, false);
  }
});

test('checkProof: hash informado diferente do recalculado falha na etapa 1', async () => {
  const dia = makeDay(2);
  const body = dia.body(0);
  body.previsao.hash = flipHex(body.previsao.hash);
  const steps = await checkProof(body);
  assert.equal(steps[0].ok, false);
  assert.equal(steps[1].ok, false); // a folha trocada também não está na árvore
});

test('checkProof: irmão adulterado no caminho faz a etapa 2 falhar', async () => {
  for (const n of SIZES.filter((x) => x > 1)) {
    const dia = makeDay(n);
    for (let i = 0; i < n; i++) {
      const base = dia.body(i);
      for (let k = 0; k < base.anchor.proof.length; k++) {
        const body = structuredClone(base);
        body.anchor.proof[k].hash = flipHex(body.anchor.proof[k].hash);
        const steps = await checkProof(body);
        assert.deepEqual(oks(steps), [true, false, true, null], `n=${n} folha=${i} irmão=${k}`);
      }
    }
  }
});

test('checkProof: lado trocado e passo removido no caminho fazem a etapa 2 falhar', async () => {
  const dia = makeDay(5);
  const base = dia.body(2);
  const trocado = structuredClone(base);
  trocado.anchor.proof[0].side = trocado.anchor.proof[0].side === 'L' ? 'R' : 'L';
  assert.equal((await checkProof(trocado))[1].ok, false);
  const curto = structuredClone(base);
  curto.anchor.proof.pop();
  assert.equal((await checkProof(curto))[1].ok, false);
});

test('checkProof: raiz adulterada faz a etapa 2 falhar (e a 3, que a compara com o manifesto)', async () => {
  const dia = makeDay(3);
  const body = dia.body(1);
  body.anchor.root = flipHex(body.anchor.root);
  const steps = await checkProof(body);
  assert.deepEqual(oks(steps), [true, false, false, null]);
});

test('checkProof: manifesto adulterado faz a etapa 3 falhar e deixa a etapa 2 intacta', async () => {
  const dia = makeDay(3);
  for (const k of [2, 12, dia.manifest.length - 3]) {
    const body = dia.body(1);
    body.anchor.manifest = flipChar(body.anchor.manifest, k);
    const steps = await checkProof(body);
    assert.deepEqual(oks(steps), [true, true, false, null], `posição ${k}`);
  }
  const semNada = dia.body(1);
  delete semNada.anchor.manifest;
  assert.equal((await checkProof(semNada))[2].ok, false);
});

test('checkProof: manifesto reescrito com outra raiz e digest refeito ainda falha (a raiz não bate)', async () => {
  const dia = makeDay(3);
  const body = dia.body(1);
  const falso = canonicalize({ schema: 'argos.raiz/1', day: DAY, nLeaves: 3, root: flipHex(dia.root) });
  body.anchor.manifest = falso;
  body.anchor.manifestSha256 = serverSha(falso);
  const steps = await checkProof(body);
  assert.deepEqual(oks(steps), [true, true, false, null]);
  assert.match(steps[2].detail, /raiz do manifesto/);
});

test('checkProof: digest, dia e contagem do manifesto precisam bater', async () => {
  const dia = makeDay(3);
  const digest = dia.body(0);
  digest.anchor.manifestSha256 = flipHex(digest.anchor.manifestSha256);
  assert.equal((await checkProof(digest))[2].ok, false);

  const outroDia = dia.body(0);
  outroDia.anchor.day = '2026-10-11';
  assert.equal((await checkProof(outroDia))[2].ok, false);

  const contagem = dia.body(0);
  contagem.anchor.nLeaves = 4;
  assert.equal((await checkProof(contagem))[2].ok, false);

  const tipo = dia.body(0);
  const m = canonicalize({ schema: 'argos.outro/1', day: DAY, nLeaves: 3, root: dia.root });
  tipo.anchor.manifest = m;
  tipo.anchor.manifestSha256 = serverSha(m);
  assert.equal((await checkProof(tipo))[2].ok, false);

  const lixo = dia.body(0);
  lixo.anchor.manifest = 'isto não é json';
  lixo.anchor.manifestSha256 = serverSha('isto não é json');
  assert.equal((await checkProof(lixo))[2].ok, false);
});

test('checkProof: etapa do carimbo nunca dá veredito no navegador e traz status e instrução externa', async () => {
  for (const status of ['pendente', 'ancorada', 'confirmada', 'falhou']) {
    const steps = await checkProof(makeDay(2, status).body(1));
    const ots = steps[3];
    assert.equal(ots.key, 'ots');
    assert.equal(ots.ok, null);
    assert.ok(ots.detail.includes(`Status: ${status}.`), status);
    assert.ok(ots.detail.includes(anchorStatusText(status)), status);
    assert.ok(ots.detail.includes(`ots verify argos-raiz-${DAY}.json.ots`), status);
    assert.ok(ots.detail.includes('opentimestamps.org'), status);
    assert.equal(/recibo \.ots ainda não está disponível/.test(ots.detail), status === 'pendente');
  }
});

test('checkProof: corpo vazio ou malformado não lança e não confere', async () => {
  for (const body of [undefined, null, {}, 'texto', 42, [], { previsao: {}, canonical: 'x' }, { previsao: { hash: 'curto' }, canonical: 'x' }]) {
    const steps = await checkProof(body);
    assert.equal(steps.length, 4);
    assert.equal(steps[0].ok, false);
    assert.equal(steps[3].ok, null);
  }
  const quebrado = makeDay(2).body(0);
  quebrado.anchor.proof = 'não é lista';
  const steps = await checkProof(quebrado);
  assert.deepEqual(oks(steps), [true, false, true, null]);
});

test('checkProof: sem SHA-256 no navegador, as etapas ficam indeterminadas em vez de falhar', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const body = makeDay(2).body(0);
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
  try {
    await assert.rejects(() => sha256Hex('abc'), CryptoUnavailableError);
    const steps = await checkProof(body);
    assert.deepEqual(oks(steps), [null, null, null, null]);
    assert.match(steps[0].detail, /SHA-256/);
    assert.equal(overallState(steps), 'indeterminado');
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

// ----------------------------------------------------------------- resumo

test('overallState: combina as etapas', () => {
  const s = (hash, merkle, manifest) => [
    { key: 'hash', ok: hash }, { key: 'merkle', ok: merkle }, { key: 'manifest', ok: manifest }, { key: 'ots', ok: null }
  ];
  assert.equal(overallState(s(true, true, true)), 'confere');
  assert.equal(overallState(s(true, null, null)), 'aguardando');
  assert.equal(overallState(s(false, true, true)), 'nao_confere');
  assert.equal(overallState(s(true, false, true)), 'nao_confere');
  assert.equal(overallState(s(true, true, false)), 'nao_confere');
  assert.equal(overallState(s(null, null, null)), 'indeterminado');
  assert.equal(overallState(s(true, true, null)), 'indeterminado');
});

test('textos auxiliares: status da âncora e comando de verificação', () => {
  assert.match(anchorStatusText('pendente'), /ainda não foi enviado/);
  assert.match(anchorStatusText('ancorada'), /algumas horas/);
  assert.match(anchorStatusText('confirmada'), /confirmado no Bitcoin/);
  assert.match(anchorStatusText('falhou'), /será refeito/);
  assert.equal(otsCommand('2026-10-12'), 'ots verify argos-raiz-2026-10-12.json.ots');
  assert.equal(otsCommand('x; rm -rf'), 'ots verify argos-raiz-<dia>.json.ots');
});
