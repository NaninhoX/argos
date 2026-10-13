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
