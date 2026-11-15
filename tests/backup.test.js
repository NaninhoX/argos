// Backup por SQL puro e restauração: 100% em memória (PGlite), sem Neon e sem DATABASE_URL.
// Compara o CONTEÚDO das linhas (previsoes e provas_merkle campo a campo), não só a contagem.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '../lib/db.js';
import { migrate } from '../tools/migrate.mjs';
import { hashCanonical } from '../lib/canonical.js';
import { merkleRoot, merkleProof } from '../lib/merkle.js';
import { insertPrevisao } from '../lib/repo/previsoes.js';
import { insertDesfecho } from '../lib/repo/desfechos.js';
import { insertProva, markAnchored } from '../lib/repo/provas.js';
import { insertQueryLog, insertToolAudit } from '../lib/repo/audit.js';
import {
  caminhoSeguro, conferirBackup, dentroDoRepo, exportarBackup, gravarArquivo, lerArquivo,
  restaurarBackup, restaurarEmMemoria, tabelasDasMigracoes, TABELAS_PROVA,
} from '../tools/backup-neon.mjs';

const ENGINE = 'argos-engine 1.1.0';
let db;
let dir;
let ids = [];

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argos-backup-test-'));
  db = await createTestDb();
  await migrate(db);

  const hashes = [];
  for (let i = 0; i < 5; i++) {
    const params = { alvo_atr: 2, stop_atr: 1, horizonte: 20 + i };
    const hash = hashCanonical({ i, params });
    hashes.push(hash);
    // id explícito: a linha 4 (corrige a 0) ordena ANTES da 0 na ordem canônica do arquivo (texto do id vem primeiro),
    // então a restauração é obrigada a inserir a corrigida antes da que a corrige. Determinístico, sem depender de uuid sorteado.
    const id = i === 0 ? 'ffffffff-0000-4000-8000-000000000000' : `0000000${i}-0000-4000-8000-000000000000`;
    const r = await insertPrevisao(db, {
      id, setup_id: 'S-breakout', symbol: 'BTCUSDT', timeframe: '1d', params,
      prob: i === 3 ? null : 0.1 + i * 0.123456789012345, base_rate: 69130.2 + i, n: 100 + i, n_eff: 40 + i,
      verdict: i % 2 ? 'ROBUSTO' : 'FRAGIL', bar_time: '2026-10-01T00:00:00Z', data_cut: '2026-10-01T00:00:00Z',
      emitted_at: `2026-10-01T00:0${i}:00.250123Z`, origin: 'termometro', origin_ref: `ref-${i}`, engine_version: ENGINE,
      payload: { q: 0.1 + 0.2, lista: [1, 2.5, { z: 1e-7 }], texto: 'ação "citada" \\ ok', nulo: null, i },
      hash,
      supersedes: i === 4 ? ids[0] : null, // correção aponta a linha anterior: testa a ordem de inserção
    });
    ids.push(r.id);
  }
  await insertDesfecho(db, { previsao_id: ids[0], outcome: 'WIN', ret: 0.0123456789, bars: 7, bar_time: '2026-10-08T00:00:00Z', resolved_at: '2026-10-08T00:01:00Z' });
  await insertDesfecho(db, { previsao_id: ids[1], outcome: 'TIMEOUT' });

  const proof = hashes.map((_, i) => merkleProof(hashes, i));
  await db.transaction((tx) => insertProva(tx, {
    day: '2026-10-01', root: merkleRoot(hashes), n_leaves: hashes.length,
    leaves: ids.map((id, i) => ({ previsao_id: id, leaf_index: i, proof: proof[i] })),
  }));
  await markAnchored(db, '2026-10-01', Buffer.from([0x00, 0x4f, 0x70, 0x65, 0xff, 0x10]));
  await insertProva(db, { day: '2026-10-02', root: hashCanonical('outro-dia'), n_leaves: 0, leaves: [] });

  await db.query(`insert into candles (symbol, timeframe, open_time, open, high, low, close, volume) values
    ('BTCUSDT','1d','2026-10-01T00:00:00Z', 1.1, 2.2, 0.3, 1.7000000000000002, 12345.678)`);
  await db.query(`insert into regimes (symbol, timeframe, bar_time, regime, adx, engine_version)
    values ('BTCUSDT','1d','2026-10-01T00:00:00Z','tendencia', 31.5, $1)`, [ENGINE]);
  await db.query(`insert into acessos (rotulo, codigo_hash, expira_em) values ('cliente teste', $1, '2027-01-01T00:00:00Z')`, ['ab'.repeat(32)]);
  await db.query(`insert into acessos_uso (acesso_ref, rota, dia, chamadas) values ('1', '/api/argos-ai', '2026-10-01', 3)`);
  await db.query(`insert into limite_taxa (chave, janela, contagem) values ('rota:hash', '2026-10-01T00:00:00Z', 2)`);
  await insertQueryLog(db, { route: '/api/analyze', params: { a: 1 }, status: 200, latency_ms: 12, cache_hit: false, engine_version: ENGINE, ip_hash: 'h' });
  await insertToolAudit(db, { tool: 'x', args: { k: [1, 2] }, session_id: 's' });
});

after(async () => {
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Todas as linhas de uma tabela, como texto, ordenadas: comparação direta de conteúdo entre origem e destino. */
async function linhas(banco, tabela, ordem) {
  const r = await banco.query(`select t::text as linha from ${tabela} t order by ${ordem}`);
  return r.rows.map((x) => x.linha);
}

test('descobre nas migrações todas as tabelas do banco', async () => {
  const noBanco = (await db.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`))
    .rows.map((x) => x.table_name).sort();
  assert.deepEqual(tabelasDasMigracoes(), noBanco);
  assert.ok(noBanco.includes('acessos') && noBanco.includes('previsoes') && noBanco.includes('provas_merkle'));
});

test('backup, arquivo, restauração em PGlite limpo: conteúdo idêntico em previsoes e provas_merkle', async () => {
  const backup = await exportarBackup(db);
  const arquivo = path.join(dir, 'a.json');
  const g = gravarArquivo(backup, arquivo);
  assert.match(g.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => gravarArquivo(backup, arquivo), /já existe|EEXIST/); // não sobrescreve

  const lido = lerArquivo(arquivo);
  assert.equal(lido.sha256, g.sha256);
  assert.equal(lido.backup.tabelas.previsoes.contagem, 5);
  assert.equal(lido.backup.tabelas.provas_merkle.contagem, 2);

  const { db: novo, relatorio } = await restaurarEmMemoria(lido.backup);
  try {
    assert.equal(relatorio.ok, true);
    for (const t of tabelasDasMigracoes()) {
      assert.equal(relatorio.tabelas[t].contagem, lido.backup.tabelas[t].contagem, t);
      assert.equal(relatorio.tabelas[t].confere, true, t);
    }
    // conteúdo, linha a linha (texto completo da linha, inclui bytea, jsonb, double e timestamptz)
    assert.deepEqual(await linhas(novo, 'previsoes', 'hash'), await linhas(db, 'previsoes', 'hash'));
    assert.deepEqual(await linhas(novo, 'provas_merkle', 'day'), await linhas(db, 'provas_merkle', 'day'));
    assert.deepEqual(await linhas(novo, 'previsao_prova', 'leaf_index'), await linhas(db, 'previsao_prova', 'leaf_index'));
    assert.deepEqual(await linhas(novo, 'desfechos', 'previsao_id'), await linhas(db, 'desfechos', 'previsao_id'));
    assert.deepEqual(await linhas(novo, 'acessos', 'id'), await linhas(db, 'acessos', 'id'));
    // valores sensíveis a arredondamento
    const p = (await novo.query('select prob, payload, supersedes, emitted_at from previsoes order by emitted_at')).rows;
    const o = (await db.query('select prob, payload, supersedes, emitted_at from previsoes order by emitted_at')).rows;
    assert.deepEqual(p, o);
    assert.equal(p[4].supersedes, ids[0]);
    // a ordem do arquivo realmente põe a corretora antes da corrigida (senão o teste não prova nada)
    const ordem = lido.backup.tabelas.previsoes.linhas.map((l) => l[0]);
    assert.ok(ordem.indexOf(ids[4]) < ordem.indexOf(ids[0]), 'corretora deve vir antes da corrigida no arquivo');
    const ots = (await novo.query(`select encode(ots, 'hex') as h from provas_merkle where day = '2026-10-01'`)).rows[0].h;
    assert.equal(ots, '004f7065ff10');
    // sequência continua depois do maior id
    const nid = (await novo.query(`insert into acessos (rotulo, codigo_hash) values ('novo', $1) returning id`, ['cd'.repeat(32)])).rows[0].id;
    assert.equal(Number(nid), 2);
  } finally {
    await novo.close();
  }
});

test('previsoes continua append-only depois de restaurar, e a restauração só insere', async () => {
  const backup = await exportarBackup(db);
  const { db: novo } = await restaurarEmMemoria(backup);
  try {
    await assert.rejects(novo.query('update previsoes set verdict = verdict'), /append-only/);
    await assert.rejects(novo.query('delete from previsoes'), /append-only/);
    await assert.rejects(novo.query('truncate previsoes cascade'), /append-only/);
  } finally {
    await novo.close();
  }
});

test('restaurar em banco que já tem dados é recusado, sem alterar nada', async () => {
  const backup = await exportarBackup(db);
  const { db: novo } = await restaurarEmMemoria(backup);
  try {
    const antes = await linhas(novo, 'previsoes', 'hash');
    await assert.rejects(restaurarBackup(novo, backup), /não está limpo/);
    assert.deepEqual(await linhas(novo, 'previsoes', 'hash'), antes);
  } finally {
    await novo.close();
  }
});

test('linha adulterada no arquivo é detectada (previsoes e provas_merkle)', async () => {
  const backup = await exportarBackup(db);
  for (const [tabela, coluna] of [['previsoes', 'verdict'], ['provas_merkle', 'root'], ['previsoes', 'prob']]) {
    const arquivo = path.join(dir, `adulterado-${tabela}-${coluna}.json`);
    const copia = JSON.parse(JSON.stringify(backup));
    const tab = copia.tabelas[tabela];
    const i = tab.colunas.findIndex((c) => c.nome === coluna);
    const alvo = tab.linhas.find((l) => l[i] !== null);
    alvo[i] = alvo[i] + '0'; // altera um valor e deixa o manifesto como estava
    fs.writeFileSync(arquivo, JSON.stringify(copia));
    assert.throws(() => lerArquivo(arquivo), new RegExp(`${tabela}: hash das linhas não confere`));
    const limpo = await createTestDb();
    try {
      await assert.rejects(restaurarBackup(limpo, copia), /hash das linhas não confere/);
    } finally {
      await limpo.close();
    }
  }
  // linha removida: contagem do manifesto diverge
  const copia = JSON.parse(JSON.stringify(backup));
  copia.tabelas.previsoes.linhas.pop();
  assert.throws(() => conferirBackup(copia), /contagem do manifesto/);
  // arquivo truncado
  const truncado = path.join(dir, 'truncado.json');
  fs.writeFileSync(truncado, JSON.stringify(backup).slice(0, 500));
  assert.throws(() => lerArquivo(truncado), /ilegível/);
});

test('comparador pós-restauração: gatilho que altera linha no destino derruba só aquela tabela', async () => {
  const backup = await exportarBackup(db);
  for (const tabela of ['candles', 'acessos']) {
    const novo = await createTestDb();
    try {
      await migrate(novo);
      const coluna = tabela === 'candles' ? 'volume' : 'rotulo';
      const expr = tabela === 'candles' ? 'new.volume + 1' : "new.rotulo || 'x'";
      await novo.exec(`create function mexe_${tabela}() returns trigger language plpgsql as $$
        begin new.${coluna} := ${expr}; return new; end $$`);
      await novo.exec(`create trigger mexe before insert on ${tabela} for each row execute function mexe_${tabela}()`);
      const r = await restaurarBackup(novo, backup);
      assert.equal(r.ok, false, tabela);
      for (const t of tabelasDasMigracoes()) {
        assert.equal(r.tabelas[t].confere, t !== tabela, `${tabela}: ${t}`);
      }
      assert.equal(r.gatilhosOk, true);
    } finally {
      await novo.close();
    }
  }
});

test('comparador pós-restauração: gatilho append-only ausente no destino reprova', async () => {
  const backup = await exportarBackup(db);
  const novo = await createTestDb();
  try {
    await migrate(novo);
    const g = (await novo.query(`select tgname from pg_trigger where not tgisinternal and tgrelid = 'previsoes'::regclass limit 1`)).rows[0].tgname;
    await novo.exec(`drop trigger "${g}" on previsoes`);
    const r = await restaurarBackup(novo, backup);
    assert.equal(r.ok, false);
    assert.equal(r.gatilhosOk, false);
    assert.ok(Object.values(r.tabelas).every((t) => t.confere), 'as tabelas batem; só os gatilhos falham');
  } finally {
    await novo.close();
  }
});

test('verificar recusa backup com tabela ausente ou extra em relação às migrações', async () => {
  const backup = await exportarBackup(db);
  const sem = JSON.parse(JSON.stringify(backup));
  delete sem.tabelas.candles;
  assert.throws(() => conferirBackup(sem), /ausente\(s\) candles/);
  const com = JSON.parse(JSON.stringify(backup));
  com.tabelas.intrusa = com.tabelas.candles;
  assert.throws(() => conferirBackup(com), /extra\(s\) intrusa/);
});

test('gravarArquivo: parcial sobrando dá mensagem clara e não deixa lixo', async () => {
  const backup = await exportarBackup(db);
  const alvo = path.join(dir, 'p.json');
  fs.writeFileSync(alvo + '.parcial', 'x');
  assert.throws(() => gravarArquivo(backup, alvo), /arquivo parcial/);
  fs.rmSync(alvo + '.parcial');
  gravarArquivo(backup, alvo);
  assert.equal(fs.existsSync(alvo + '.parcial'), false);
  assert.throws(() => gravarArquivo(backup, alvo), /já existe/);
  assert.equal(fs.existsSync(alvo + '.parcial'), false);
});

test('hash do arquivo muda se qualquer byte muda (SHA-256 para o log externo)', async () => {
  const backup = await exportarBackup(db);
  const a = gravarArquivo(backup, path.join(dir, 'h1.json'));
  const b = gravarArquivo({ ...backup, criado_em: '2000-01-01T00:00:00.000Z' }, path.join(dir, 'h2.json'));
  assert.notEqual(a.sha256, b.sha256);
});

test('recusa caminho dentro do repositório (inclui ..), aceita fora', () => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  assert.throws(() => caminhoSeguro(path.join(repo, 'backup.json')), /dentro do repositório/);
  assert.throws(() => caminhoSeguro(path.join(repo, 'docs', '..', 'x', 'b.json')), /dentro do repositório/);
  // nomes que só COMEÇAM por '..' são filhos do repo: recusados
  assert.throws(() => caminhoSeguro(path.join(repo, '..backup', 'x.json')), /dentro do repositório/);
  assert.throws(() => caminhoSeguro(path.join(repo, '...json')), /dentro do repositório/);
  // realmente fora (irmão do repo, e a pasta temporária): aceitos
  assert.equal(dentroDoRepo(path.join(repo, '..', 'fora-do-repo.json')), false);
  assert.equal(dentroDoRepo(path.join(dir, 'ok.json')), false);
  assert.equal(caminhoSeguro(path.join(dir, 'ok.json')), path.join(dir, 'ok.json'));
  assert.throws(() => caminhoSeguro(''), /informe o caminho/);
  assert.deepEqual(TABELAS_PROVA, ['previsoes', 'provas_merkle']);
});
