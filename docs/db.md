# Banco de dados do Argos

Postgres em produção no Neon (`@neondatabase/serverless`); testes no PGlite (`createTestDb()`), com a mesma interface (`lib/db.js`). Esquema em `db/migrations/` (SQL puro, só para frente); aplicar com `DATABASE_URL=... node tools/migrate.mjs` (idempotente, registra em `schema_migrations`). Preços e estatísticas são `double precision` (o motor trabalha com double do JavaScript e o valor volta idêntico), tempo é `timestamptz`, estruturas são `jsonb`. Nenhuma tabela guarda dado pessoal (`ip_hash`, nunca IP).

## Modelo

| Grupo | Tabelas | Observação |
|---|---|---|
| Mercado | `candles`, `regimes` | `candles` é upsert por (símbolo, intervalo, abertura). `regimes` é por barra e versão do motor, append-only. |
| Registro público | `previsoes`, `desfechos` | **Append-only.** Uma previsão tem no máximo um desfecho. |
| Ancoragem | `provas_merkle`, `previsao_prova` | Raiz diária e recibo OpenTimestamps (`status` avança). Prova de cada folha. |
| Reprodutibilidade | `engine_versions`, `resultados_matriz` | Toda previsão e todo resultado apontam a versão do motor que os gerou. |
| Operação | `query_log`, `tool_audit`, `schema_migrations` | Sem dado pessoal. |
| Agentes e calibração | `agent_runs`, `revisao_humana`, `plano_calibracao` | `reviewer` guarda identificador interno, nunca e-mail. |

Previsões pendentes de desfecho: `previsoes p left join desfechos d on d.previsao_id = p.id where d.previsao_id is null`.

## Por que append-only

O valor do registro público é poder provar que uma previsão não foi alterada depois do desfecho. Por isso `previsoes`, `desfechos` e `regimes` recusam UPDATE, DELETE e TRUNCATE por gatilho (`forbid_mutation`, SQLSTATE `23001`). Correção se faz com **nova linha** apontando a anterior em `previsoes.supersedes`; a antiga continua visível. O `hash` (64 caracteres, único) cobre o conteúdo canônico e entra na árvore de Merkle do dia. Atenção: `jsonb` não preserva a ordem das chaves, então o hash é sempre calculado e conferido sobre a forma canônica (chaves ordenadas), nunca sobre o texto armazenado.

O gatilho não é intransponível: o dono da tabela pode desativá-lo (`ALTER TABLE ... DISABLE TRIGGER`) ou apagar a tabela. Defesa adicional recomendada: a aplicação conecta com um papel que só tem `SELECT` e `INSERT` nessas tabelas (a migração e o backup usam outro papel). Isso depende do Neon e ainda não está configurado.

## Backup semanal (pg_dump)

Toda segunda-feira, a partir da conexão **direta** do Neon (não a do pooler):

```
pg_dump "$DATABASE_URL_DIRETA" --format=custom --no-owner --no-privileges --file=argos-AAAA-MM-DD.dump
```

1. Use `pg_dump` de versão igual ou superior à do servidor.
2. Criptografe o arquivo (`age` ou `gpg`) antes de sair da máquina e guarde fora do Neon (outro provedor ou disco offline). Chave de criptografia separada do backup.
3. Retenção sugerida: 8 semanais e 12 mensais. Registre data, arquivo, tamanho e contagem de linhas de `previsoes` e `desfechos` num log simples.
4. O recurso de restauração por ponto no tempo do Neon complementa, não substitui: a janela dele depende do plano.

## Teste mensal de restauração

Backup que nunca foi restaurado não conta. Todo mês, com o dump mais recente:

1. Crie um banco descartável (projeto/branch Neon de teste ou Postgres local) e rode `pg_restore --no-owner --dbname="$DESTINO" argos-AAAA-MM-DD.dump`.
2. Confira: `select max(version) from schema_migrations` bate com a última migração; `select count(*) from previsoes` e `from desfechos` batem com o log do backup; os gatilhos existem (`select tgname from pg_trigger where not tgisinternal and tgrelid in ('previsoes'::regclass, 'desfechos'::regclass, 'regimes'::regclass)` devolve 6 linhas).
3. Teste de integridade: tente `update previsoes set verdict = verdict` e `truncate desfechos`; ambos devem ser recusados.
4. Quando existir o verificador de provas: recalcule o hash de uma amostra de previsões e confira as raízes de `provas_merkle` contra os recibos OpenTimestamps.
5. Anote o resultado (data, dump usado, tempo de restauração, aprovado ou falha) e apague o banco descartável. Falha é incidente: corrija o procedimento antes do próximo dump.
