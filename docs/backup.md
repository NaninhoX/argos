# Backup do banco (SQL puro) e teste de restauração

`tools/backup-neon.mjs` exporta todas as tabelas do banco sem `pg_dump` e sem dependência nova, e restaura o arquivo num PGlite limpo em memória conferindo o conteúdo. Complementa o `pg_dump` de `docs/db.md`: é o que se roda onde não há `pg_dump` e o que prova, a cada backup, que o arquivo restaura.

## Aviso: o arquivo é dado sensível

O backup contém **todas** as tabelas, inclusive `acessos` (o SHA-256 dos códigos de cliente, rótulo e validade), `acessos_uso`, `limite_taxa` e os logs. O SHA-256 não revela o código, mas permite confirmar um código adivinhado e identifica os clientes. Regras:

1. O arquivo **nunca entra no repositório**. A ferramenta recusa qualquer caminho dentro da pasta do repositório (também com `..` no meio do caminho e links simbólicos; um nome que apenas começa por `..`, como `..backup` ou `...json`, é um arquivo dentro da pasta e também é recusado), em `backup`, `verificar` e `restaurar`. Não há caminho padrão: o argumento é obrigatório.
2. Criptografe (`age` ou `gpg`) antes de sair da máquina; chave separada do arquivo; cópia fora do Neon. Apague o arquivo em claro depois de criptografar.
3. Nunca cole o arquivo, trechos dele nem `DATABASE_URL` em chat.
4. A ferramenta não sobrescreve arquivo existente (grava num `.parcial` e o liga ao nome final sem corrida; se sobrar um `.parcial` de uma falha anterior, ela para e pede que você o apague à mão). O modo `0o600` só vale em Unix/macOS. **No Windows ele não restringe nada**: vale a permissão da pasta de destino, então guarde o arquivo numa pasta com acesso restrito ao seu usuário (propriedades da pasta, Segurança) ou num volume criptografado.

`.gitignore` do repositório: além de `node_modules/`, `.env*`, `.vercel/`, `legacy/blocks/` e os gerados do front, cobre `argos-backup*`, `*.dump` e `*.parcial`. Como a ferramenta já recusa caminho dentro do repo, isso é só a rede de segurança para quem mover o arquivo à mão para lá.

## Passo a passo

Requisitos: Node 22 ou mais (WebSocket global, exigido por `db.transaction` no Neon) e `npm install` feito (o PGlite, usado na restauração, é devDependency). Use a conexão **direta** do Neon, não a do pooler, e uma pasta fora do repositório (exemplo: `D:\backups-argos`).

1. Backup (só lê o banco; um único retrato consistente, transação `repeatable read` somente leitura):

   ```
   DATABASE_URL=<conexão direta> node tools/backup-neon.mjs backup D:\backups-argos\argos-backup-AAAA-MM-DD.json
   ```

   A saída traz o SHA-256 do arquivo e, por tabela, a contagem de linhas e o início do hash. `previsoes` e `provas_merkle` aparecem marcadas `[prova]`. Anote esses números e o SHA-256 num log **fora** do arquivo (data, arquivo, tamanho, SHA-256, contagem de `previsoes`, `desfechos`, `provas_merkle`).

2. Confira o arquivo, sem banco (também depois de copiar ou baixar de outro disco):

   ```
   node tools/backup-neon.mjs verificar D:\backups-argos\argos-backup-AAAA-MM-DD.json
   ```

   Recalcula contagem e hash de cada tabela a partir das linhas do arquivo e compara com o manifesto; confere também que o conjunto de tabelas é o das migrações (tabela ausente ou extra é recusada). Linha alterada, removida ou arquivo truncado é recusado, com o nome da tabela. Compare também o SHA-256 impresso com o do log: quem adultera uma linha e o manifesto juntos só é pego por esse SHA-256 anotado fora do arquivo.

3. Teste de restauração (recria num PGlite em memória, não toca em Neon):

   ```
   node tools/backup-neon.mjs restaurar D:\backups-argos\argos-backup-AAAA-MM-DD.json
   ```

   O procedimento: confere o arquivo; cria um banco vazio e aplica `db/migrations` (as migrações do repositório precisam ser as mesmas do backup, senão recusa); restaura em ordem de chaves estrangeiras; ajusta as sequências; relê todas as tabelas do destino e compara contagem e hash com o manifesto; confere que os 6 gatilhos append-only existem. Termina com `RESTAURAÇÃO CONFERIDA` (código de saída 0) ou `RESTAURAÇÃO FALHOU` (1), com a tabela que diverge marcada; se só os gatilhos faltarem, a mensagem diz isso.

4. Rotina: backup semanal e restauração testada todo mês (`docs/db.md`). Falha na restauração é incidente: corrija antes do próximo backup.

## O que a conferência garante

- **Contagem e conteúdo por tabela.** O hash de cada tabela é o hash canônico (`lib/canonical.js`) das colunas e das linhas, ordenadas; as linhas são o texto que o Postgres devolve (double no formato mais curto que reproduz o valor, `timestamptz` em UTC com microssegundos, `jsonb` normalizado, `bytea` em hexadecimal). Vale para todas as tabelas; `previsoes` e `provas_merkle` são relatadas à parte.
- **`previsoes` não é alterada.** A restauração só faz `INSERT` nela (nunca `UPDATE`, `DELETE` ou `TRUNCATE`), com o `id`, o `hash` e os carimbos de tempo do backup; o gatilho `forbid_mutation` continua ativo no destino. Correções (`supersedes`) entram depois da linha que corrigem.
- **Destino limpo.** Se qualquer tabela de dados do destino tiver linha, a restauração para antes de inserir. As únicas tabelas substituídas são `schema_migrations` (criada pelo `tools/migrate.mjs` e pela migração 001) e `engine_versions` (semeada pela migração 001).
- **Cobertura.** O backup descobre as tabelas em `db/migrations/*.sql` e recusa se o banco tiver tabela que as migrações não descrevem (ficaria de fora sem aviso) ou se faltar uma delas.

## Limites

- Não é backup físico: não guarda papéis, permissões, índices (vêm das migrações), nem extensões. O arquivo é lido inteiro em memória; serve para o volume atual do Argos, e deve ser reavaliado se `candles` ou `query_log` crescerem muito (nesse caso usar `pg_dump`).
- O teste de restauração é em PGlite. Restaurar num Postgres real (Neon de teste) continua sendo o ensaio completo de `docs/db.md`.
- O hash do arquivo só prova integridade em relação ao que foi anotado; não prova autoria.
