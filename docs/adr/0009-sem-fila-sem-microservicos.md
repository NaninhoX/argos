# ADR 0009 — Sem fila, sem microserviços, sem Kubernetes; cache por chave e matriz pré-calculada

- Status: aceita
- Fonte: plano de arquitetura (`Stratum_Arquitetura_Sistemas_Plano_Sprints_v1-11-10`), seção "Decisões de arquitetura", item 9

## Contexto

O volume de consultas previsto não justifica fila, serviços separados nem orquestração de contêineres.

## Decisão

Não há fila, microserviços nem Kubernetes. O cache usa como chave: setup, ativo, tempo gráfico, parâmetros e versão dos dados. A matriz de 72 casos é pré-calculada à noite (tabela `resultados_matriz`).

## Consequências

- Menos peças para operar e depurar: funções da Vercel finas, um banco Postgres.
- Revisar esta decisão quando passar de 100 consultas por dia.
- Uma nova versão dos dados muda a chave e, portanto, não reaproveita o cache anterior.

## Revisão de 24/10/2026

A matriz de 72 casos nunca passou a ser pré-calculada no banco: a tabela `resultados_matriz` foi criada em `001_init.sql`, mas nenhum código a lê ou grava. Os 72 testes publicados estão escritos no `web/index.html` (grade e tabela), e desde 24/10/2026 `tests/landing-estudo.test.js` confere cada número contra o estudo v1.1 (`tests/fixtures/study-v1.1-matrix.json`). A tabela fica onde está, vazia: apagá-la seria migração destrutiva, e ela pode servir quando houver um estudo v1.2 calculado no servidor. O cache por chave segue valendo para `/api/analyze`, agora também na CDN (`s-maxage`, ADR 0011).
