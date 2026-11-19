// Backup do banco por SQL puro (sem pg_dump, sem dependência nova) e teste de restauração num PGlite limpo.
//
// Uso (docs/backup.md):
//   DATABASE_URL=<conexão direta do Neon> node tools/backup-neon.mjs backup <arquivo>
//   node tools/backup-neon.mjs verificar <arquivo>     confere o arquivo (contagem e hash de cada tabela), sem banco
//   node tools/backup-neon.mjs restaurar <arquivo>     verificar + recria num PGlite em memória e confere o conteúdo
//
// O arquivo de backup contém TODAS as tabelas (inclui `acessos`, com o SHA-256 dos códigos de cliente): é dado
// sensível. Esta ferramenta recusa qualquer caminho dentro do repositório; guarde criptografado, fora do Git.
// Nada daqui lê ou imprime o valor de DATABASE_URL.
//
// Formato: JSON com o cabeçalho, a lista de migrações e, por tabela, as colunas, as linhas (cada valor como o texto
// que o Postgres devolve, ou null) e o manifesto {contagem, hash}. O hash de uma tabela é o hash canônico
// (lib/canonical.js) das colunas e das linhas ordenadas. Preços e estatísticas (double) voltam idênticos porque o
// texto do Postgres é o mais curto que reproduz o valor; jsonb sai na forma normalizada do próprio Postgres.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize, hashCanonical, sha256Hex } from '../lib/canonical.js';
import { createTestDb, resolveDb } from '../lib/db.js';
import { migrate, MIGRATIONS_DIR } from './migrate.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FORMAT = 'argos-backup';
export const FORMAT_VERSION = 1;

/** Tabelas cujo conteúdo é conferido por hash e relatado à parte (o que importa provar). */
export const TABELAS_PROVA = ['previsoes', 'provas_merkle'];
/** Tabelas que a migração já popula num banco limpo (semente): a restauração as substitui pelo conteúdo do backup. */
const TABELAS_SEMENTE = ['schema_migrations', 'engine_versions'];

const qi = (name) => '"' + String(name).replace(/"/g, '""') + '"';

// ------------------------------------------------------------------ caminho

/**
 * No Windows, `\\localhost\C$\pasta` (e `\\127.0.0.1\C$\...`, `\\<nome desta máquina>\C$\...`) é a MESMA pasta que
 * `C:\pasta`, mas `path.relative` a trata como outra raiz e a deixaria passar como "fora do repositório".
 * Devolve o caminho local equivalente; qualquer outro caminho volta como veio (compartilhamento de outra máquina
 * continua valendo como externo).
 * @param {string} p
 * @param {string} [maquina] nome desta máquina (padrão: o do sistema)
 * @returns {string}
 */
export function desfazUncLocal(p, maquina = os.hostname()) {
  const m = /^[\\/]{2}([^\\/]+)[\\/]([A-Za-z])\$(?:[\\/](.*))?$/.exec(String(p));
  if (!m) return p;
  const host = m[1].toLowerCase();
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== String(maquina).toLowerCase()) return p;
  return m[2].toUpperCase() + ':\\' + (m[3] || '');
}

/** Verdadeiro se `alvo` está na pasta do repositório (ou é ela), resolvendo links simbólicos do que já existe. */
export function dentroDoRepo(alvo, repoRoot = REPO_ROOT) {
  const real = (p0) => {
    const p = process.platform === 'win32' ? desfazUncLocal(p0) : p0;
    let atual = path.resolve(p);
    const resto = [];
    while (!fs.existsSync(atual)) {
      const pai = path.dirname(atual);
      if (pai === atual) break;
      resto.unshift(path.basename(atual));
      atual = pai;
    }
    let base = atual;
    try { base = fs.realpathSync.native(atual); } catch { /* fica o caminho resolvido */ }
    return path.join(base, ...resto);
  };
  const norm = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);
  const rel = path.relative(norm(real(repoRoot)), norm(real(alvo)));
  // Fora: '..', '..<sep>...' ou outra raiz/unidade (absoluto). Nome que só começa por '..' (ex.: '..backup',
  // '...json') é um filho do repo, não uma saída da pasta. Dentro: o próprio repo (rel vazio) ou um filho.
  const fora = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  return rel === '' || !fora;
}

/** Resolve o caminho do arquivo de backup e recusa o que estiver dentro do repositório. */
export function caminhoSeguro(arquivo, repoRoot = REPO_ROOT) {
  if (!arquivo || typeof arquivo !== 'string') throw new Error('informe o caminho do arquivo de backup (fora do repositório)');
  const abs = path.resolve(arquivo);
  if (dentroDoRepo(abs, repoRoot)) {
    throw new Error('caminho recusado: o arquivo de backup é dado sensível e nunca fica dentro do repositório (' + abs + ')');
  }
  return abs;
}

// ------------------------------------------------------------------ esquema

/** Tabelas criadas pelas migrações (create table ...), mais schema_migrations, que o executor cria. */
export function tabelasDasMigracoes(dir = MIGRATIONS_DIR) {
  const nomes = new Set(['schema_migrations']);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) nomes.add(m[1].toLowerCase());
  }
  return [...nomes].sort();
}

export function versoesDasMigracoes(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort().map((f) => f.replace(/\.sql$/, ''));
}

async function colunas(tx, tabela) {
  const r = await tx.query(
    `select a.attname as nome, format_type(a.atttypid, a.atttypmod) as tipo
       from pg_attribute a
      where a.attrelid = ('public.' || quote_ident($1))::regclass and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [tabela],
  );
  return r.rows.map((x) => ({ nome: x.nome, tipo: x.tipo }));
}

/** Chaves estrangeiras de coluna única: { tabela, coluna, ref, refColuna }. */
async function chavesEstrangeiras(tx) {
  const r = await tx.query(
    `select c.conrelid::regclass::text as tabela, c.confrelid::regclass::text as ref,
            array_length(c.conkey, 1) as n,
            (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) as coluna,
            (select attname from pg_attribute where attrelid = c.confrelid and attnum = c.confkey[1]) as ref_coluna
       from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace`,
  );
  return r.rows.map((x) => {
    if (Number(x.n) !== 1) throw new Error('chave estrangeira composta em ' + x.tabela + ': não suportada pelo backup');
    return { tabela: x.tabela, coluna: x.coluna, ref: x.ref, refColuna: x.ref_coluna };
  });
}

/** Ordem de inserção: a tabela referenciada antes de quem a referencia. */
export function ordenarTabelas(tabelas, fks) {
  const pend = new Set(tabelas);
  const out = [];
  while (pend.size) {
    const pronta = [...pend].sort().find((t) => fks.every((f) => f.tabela !== t || f.ref === t || !pend.has(f.ref)));
    if (!pronta) throw new Error('ciclo de chaves estrangeiras entre tabelas');
    out.push(pronta);
    pend.delete(pronta);
  }
  return out;
}

// ------------------------------------------------------------------ hash e exportação

/** Hash canônico de uma tabela: colunas e linhas (cada uma um array de texto|null), ordenadas pela forma canônica. */
export function hashTabela(cols, rows) {
  const ordenadas = rows.map((r) => ({ k: canonicalize(r), r })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((x) => x.r);
  return { rows: ordenadas, hash: hashCanonical({ colunas: cols.map((c) => c.nome), linhas: ordenadas }) };
}

/** Lê todas as tabelas dentro de `tx` (uma transação com um só retrato do banco). */
async function lerTabelas(tx, tabelas) {
  const fora = {};
  for (const t of tabelas) {
    const cols = await colunas(tx, t);
    if (!cols.length) throw new Error('tabela inexistente no banco: ' + t);
    const lista = cols.map((c) => `${qi(c.nome)}::text`).join(', ');
    const r = await tx.query(`select ${lista} from public.${qi(t)}`);
    const linhas = r.rows.map((row) => cols.map((c) => (row[c.nome] === null || row[c.nome] === undefined ? null : String(row[c.nome]))));
    const { rows, hash } = hashTabela(cols, linhas);
    fora[t] = { colunas: cols, linhas: rows, contagem: rows.length, hash };
  }
  return fora;
}

/**
 * Exporta o banco inteiro (todas as tabelas das migrações) para um objeto de backup. Só lê.
 * @param {import('../lib/db.js').Db} db
 * @param {{ migrationsDir?: string, agora?: Date }} [opts]
 */
export async function exportarBackup(db, { migrationsDir = MIGRATIONS_DIR, agora = new Date() } = {}) {
  const esperadas = tabelasDasMigracoes(migrationsDir);
  return db.transaction(async (tx) => {
    await tx.exec('set transaction isolation level repeatable read read only');
    await tx.exec("set local time zone 'UTC'");
    await tx.exec('set local extra_float_digits = 1');
    const noBanco = (await tx.query(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    )).rows.map((x) => x.table_name);
    const semCobertura = noBanco.filter((t) => !esperadas.includes(t));
    if (semCobertura.length) throw new Error('tabela(s) no banco que as migrações não descrevem (ficariam fora do backup): ' + semCobertura.join(', '));
    const faltando = esperadas.filter((t) => !noBanco.includes(t));
    if (faltando.length) throw new Error('tabela(s) das migrações ausentes no banco (migração não aplicada?): ' + faltando.join(', '));
    const tabelas = await lerTabelas(tx, esperadas);
    const aplicadas = tabelas.schema_migrations.linhas.map((l) => l[0]).sort();
    return {
      formato: FORMAT,
      versao: FORMAT_VERSION,
      criado_em: agora.toISOString(),
      aviso: 'Dado sensível: inclui acessos (SHA-256 dos códigos de cliente). Nunca no repositório; guardar criptografado.',
      migracoes: aplicadas,
      tabelas,
    };
  });
}

// ------------------------------------------------------------------ arquivo

/** Grava o backup (sem sobrescrever; modo 600 onde o sistema respeita, no Windows vale a permissão da pasta) e devolve o SHA-256 do arquivo, para o log do backup. */
export function gravarArquivo(backup, arquivo) {
  const abs = caminhoSeguro(arquivo);
  const texto = JSON.stringify(backup);
  const tmp = abs + '.parcial';
  try {
    fs.writeFileSync(tmp, texto, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') throw new Error('sobrou um arquivo parcial de um backup anterior; confira e apague-o à mão antes de repetir: ' + tmp);
    throw e;
  }
  try {
    // Sem corrida: link falha com EEXIST se o destino já existe (rename sobrescreveria). Onde o sistema de arquivos
    // não tem link (ex.: exFAT), copyFile com COPYFILE_EXCL dá a mesma garantia de não sobrescrever.
    try {
      fs.linkSync(tmp, abs);
    } catch (e) {
      if (e.code === 'EEXIST') throw e;
      fs.copyFileSync(tmp, abs, fs.constants.COPYFILE_EXCL);
    }
  } catch (e) {
    if (e.code === 'EEXIST') throw new Error('arquivo já existe, não sobrescrevo: ' + abs);
    throw e;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return { arquivo: abs, bytes: Buffer.byteLength(texto), sha256: sha256Hex(texto) };
}

/** Confere a estrutura e, para cada tabela, a contagem e o hash recalculados das linhas do arquivo. */
export function conferirBackup(backup) {
  if (!backup || backup.formato !== FORMAT) throw new Error('não é um arquivo de backup do Argos');
  if (backup.versao !== FORMAT_VERSION) throw new Error('versão de formato não suportada: ' + backup.versao);
  if (!backup.tabelas || typeof backup.tabelas !== 'object') throw new Error('backup sem tabelas');
  for (const t of TABELAS_PROVA) if (!backup.tabelas[t]) throw new Error('backup sem a tabela ' + t);
  const esperadas = tabelasDasMigracoes();
  const presentes = Object.keys(backup.tabelas);
  const ausentes = esperadas.filter((t) => !presentes.includes(t));
  const extras = presentes.filter((t) => !esperadas.includes(t));
  if (ausentes.length || extras.length) {
    throw new Error('tabelas do backup diferem das migrações atuais:'
      + (ausentes.length ? ' ausente(s) ' + ausentes.join(', ') + ';' : '')
      + (extras.length ? ' extra(s) ' + extras.join(', ') + ';' : ''));
  }
  const relatorio = {};
  for (const [nome, tab] of Object.entries(backup.tabelas)) {
    if (!Array.isArray(tab.colunas) || !Array.isArray(tab.linhas)) throw new Error('tabela malformada: ' + nome);
    for (const l of tab.linhas) {
      if (!Array.isArray(l) || l.length !== tab.colunas.length) throw new Error(`linha malformada em ${nome}`);
    }
    if (tab.linhas.length !== tab.contagem) throw new Error(`${nome}: contagem do manifesto (${tab.contagem}) difere das linhas do arquivo (${tab.linhas.length})`);
    const { hash } = hashTabela(tab.colunas, tab.linhas);
    if (hash !== tab.hash) throw new Error(`${nome}: hash das linhas não confere com o manifesto: arquivo adulterado ou corrompido`);
    relatorio[nome] = { contagem: tab.contagem, hash };
  }
  return relatorio;
}

/** Lê e confere o arquivo de backup. */
export function lerArquivo(arquivo) {
  const abs = caminhoSeguro(arquivo);
  const texto = fs.readFileSync(abs, 'utf8');
  let backup;
  try { backup = JSON.parse(texto); } catch { throw new Error('arquivo de backup ilegível (JSON inválido)'); }
  const relatorio = conferirBackup(backup);
  return { backup, relatorio, sha256: sha256Hex(texto), bytes: Buffer.byteLength(texto) };
}

// ------------------------------------------------------------------ restauração

/**
 * Restaura o backup num banco LIMPO (recém-migrado) e confere contagem e hash de cada tabela relendo o destino.
 * Só INSERT nas tabelas append-only; as duas tabelas de semente (schema_migrations, engine_versions) são trocadas
 * pelo conteúdo do backup. Recusa destino com dados.
 * @param {import('../lib/db.js').Db} destino banco com as migrações aplicadas e nenhuma linha de dado
 * @param {object} backup
 * @returns {Promise<{ tabelas: Record<string, { contagem: number, hash: string, confere: boolean }>, ok: boolean, gatilhosOk: boolean }>}
 */
export async function restaurarBackup(destino, backup) {
  conferirBackup(backup);
  const esperadas = tabelasDasMigracoes();
  const doBackup = Object.keys(backup.tabelas).sort();
  if (canonicalize(doBackup) !== canonicalize(esperadas)) throw new Error('as tabelas do backup não são as das migrações atuais');
  const versoes = versoesDasMigracoes();
  const noBackup = backup.tabelas.schema_migrations.linhas.map((l) => l[0]).sort();
  if (canonicalize(noBackup) !== canonicalize(versoes)) throw new Error('migrações do backup diferem das de db/migrations: ' + noBackup.join(',') + ' x ' + versoes.join(','));

  await destino.transaction(async (tx) => {
    await tx.exec("set local time zone 'UTC'");
    const fks = await chavesEstrangeiras(tx);
    for (const t of esperadas) {
      if (TABELAS_SEMENTE.includes(t)) continue;
      const n = Number((await tx.query(`select count(*) as n from public.${qi(t)}`)).rows[0].n);
      if (n) throw new Error(`destino não está limpo: ${t} tem ${n} linha(s)`);
    }
    for (const t of ['schema_migrations', 'engine_versions']) await tx.exec(`delete from public.${qi(t)}`);

    for (const t of ordenarTabelas(esperadas, fks)) {
      const tab = backup.tabelas[t];
      const cols = await colunas(tx, t);
      if (canonicalize(cols) !== canonicalize(tab.colunas)) throw new Error('colunas de ' + t + ' no destino diferem das do backup');
      const lista = cols.map((c) => qi(c.nome)).join(', ');
      // bytea viaja como texto hexadecimal (\x...) e é decodificado no SQL: o PGlite não aceita texto em parâmetro bytea.
      const marcas = cols.map((c, i) => (c.tipo === 'bytea' ? `decode(substr($${i + 1}::text, 3), 'hex')` : `$${i + 1}::${c.tipo}`)).join(', ');
      const sql = `insert into public.${qi(t)} (${lista}) values (${marcas})`;
      // Chave estrangeira para a própria tabela (previsoes.supersedes): insere primeiro quem não depende de ninguém ainda não inserido.
      const auto = fks.find((f) => f.tabela === t && f.ref === t);
      let pend = tab.linhas;
      if (auto) {
        const iRef = cols.findIndex((c) => c.nome === auto.coluna);
        const iId = cols.findIndex((c) => c.nome === auto.refColuna);
        const vistos = new Set();
        while (pend.length) {
          const prontas = pend.filter((l) => l[iRef] === null || vistos.has(l[iRef]));
          if (!prontas.length) throw new Error('referência circular ou órfã em ' + t + '.' + auto.coluna);
          for (const l of prontas) { await tx.query(sql, l); vistos.add(l[iId]); }
          const feitas = new Set(prontas);
          pend = pend.filter((l) => !feitas.has(l));
        }
      } else {
        for (const l of pend) await tx.query(sql, l);
      }
    }

    // Sequências (bigserial) continuam depois do maior id restaurado.
    for (const t of esperadas) {
      for (const c of await colunas(tx, t)) {
        const s = (await tx.query('select pg_get_serial_sequence($1, $2) as seq', [`public.${qi(t)}`, c.nome])).rows[0].seq;
        if (!s) continue;
        await tx.query(
          `select setval($1, coalesce((select max(${qi(c.nome)}) from public.${qi(t)}), 1), (select max(${qi(c.nome)}) from public.${qi(t)}) is not null)`,
          [s],
        );
      }
    }
  });

  // Confere relendo o destino, como o backup leu a origem.
  const lido = await destino.transaction(async (tx) => {
    await tx.exec("set local time zone 'UTC'");
    await tx.exec('set local extra_float_digits = 1');
    return lerTabelas(tx, esperadas);
  });
  const tabelas = {};
  let ok = true;
  for (const t of esperadas) {
    const confere = lido[t].contagem === backup.tabelas[t].contagem && lido[t].hash === backup.tabelas[t].hash;
    if (!confere) ok = false;
    tabelas[t] = { contagem: lido[t].contagem, hash: lido[t].hash, confere };
  }
  // As proteções append-only precisam ter voltado junto com o esquema.
  const gat = await destino.query(
    `select count(*)::int as n from pg_trigger
      where not tgisinternal and tgrelid in ('previsoes'::regclass, 'desfechos'::regclass, 'regimes'::regclass)`,
  );
  const gatilhosOk = gat.rows[0].n === 6;
  if (!gatilhosOk) ok = false;
  return { tabelas, ok, gatilhosOk };
}

/** Restaura num PGlite novo em memória (simulado de recuperação). Devolve o banco aberto e o relatório. */
export async function restaurarEmMemoria(backup) {
  const db = await createTestDb();
  try {
    await migrate(db);
    const relatorio = await restaurarBackup(db, backup);
    return { db, relatorio };
  } catch (e) {
    await db.close();
    throw e;
  }
}

// ------------------------------------------------------------------ linha de comando

function imprimirRelatorio(rel, log) {
  for (const [nome, t] of Object.entries(rel)) {
    const marca = TABELAS_PROVA.includes(nome) ? ' [prova]' : '';
    log(`  ${nome.padEnd(18)} ${String(t.contagem).padStart(8)} linhas  ${t.hash.slice(0, 16)}…${marca}${t.confere === false ? '  DIVERGE' : ''}`);
  }
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const [cmd, arquivo] = argv;
  if (cmd === 'backup') {
    const abs = caminhoSeguro(arquivo); // recusa o repositório antes de tocar no banco
    const db = await resolveDb(process.env);
    try {
      const backup = await exportarBackup(db);
      const r = gravarArquivo(backup, abs);
      log('backup gravado: ' + r.arquivo);
      log(`${r.bytes} bytes, SHA-256 do arquivo: ${r.sha256}`);
      log('Anote o SHA-256 e as contagens num log fora do arquivo. O arquivo é dado sensível: criptografe e não o coloque no repositório.');
      imprimirRelatorio(conferirBackup(backup), log);
    } finally {
      await db.close();
    }
  } else if (cmd === 'verificar') {
    const { relatorio, sha256, bytes } = lerArquivo(arquivo);
    log(`arquivo íntegro: ${bytes} bytes, SHA-256 do arquivo: ${sha256}`);
    imprimirRelatorio(relatorio, log);
  } else if (cmd === 'restaurar') {
    const { backup, sha256 } = lerArquivo(arquivo);
    log('SHA-256 do arquivo: ' + sha256);
    const { db, relatorio } = await restaurarEmMemoria(backup);
    try {
      imprimirRelatorio(relatorio.tabelas, log);
      const tabelasOk = Object.values(relatorio.tabelas).every((t) => t.confere);
      if (relatorio.ok) log('RESTAURAÇÃO CONFERIDA: contagem e hash de todas as tabelas batem.');
      else if (tabelasOk) log('RESTAURAÇÃO FALHOU: as tabelas batem, mas os 6 gatilhos append-only não estão todos no destino.');
      else log('RESTAURAÇÃO FALHOU: veja as tabelas marcadas.' + (relatorio.gatilhosOk ? '' : ' Faltam também gatilhos append-only.'));
      if (!relatorio.ok) process.exitCode = 1;
    } finally {
      await db.close();
    }
  } else {
    log('uso: node tools/backup-neon.mjs backup|verificar|restaurar <arquivo-fora-do-repositorio>');
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Falha:', err.message);
    process.exit(1);
  });
}
