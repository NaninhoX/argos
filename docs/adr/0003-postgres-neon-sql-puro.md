# ADR 0003 — Postgres no Neon, SQL puro com migrações versionadas, sem ORM

- Status: aceita
- Fonte: plano de arquitetura (`Stratum_Arquitetura_Sistemas_Plano_Sprints_v1-11-10`), seção "Decisões de arquitetura", item 3

## Contexto

O sistema só precisa de Postgres. O Supabase traria autenticação, que não é necessária agora.

## Decisão

Postgres no Neon, acessado por SQL puro, com migrações numeradas em `db/migrations/`, só para frente. Sem ORM.

## Consequências

- Migrar de provedor exige mover dados. A mitigação é um `pg_dump` semanal para armazenamento separado, além da restauração pontual do provedor, com teste de restauração a cada mês.
- O esquema é lido diretamente no SQL; não há camada que o esconda.
- Mudança de esquema é sempre uma nova migração; nunca se edita uma já aplicada.

**Nota de 18/11/2026:** a mitigação de backup hoje tem duas descrições que não coincidem. `docs/db.md` (seção "Backup semanal (pg_dump)") ainda manda rodar `pg_dump` toda segunda-feira. `docs/backup.md` e `tools/backup-neon.mjs` descrevem o backup por SQL puro, "sem `pg_dump`", com teste de restauração num PGlite, e dizem que ele complementa o `pg_dump` e serve onde este não existe. O que de fato roda, e com que frequência, está a confirmar; os dois documentos não foram reconciliados aqui.
