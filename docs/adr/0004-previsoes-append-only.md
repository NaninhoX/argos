# ADR 0004 — Previsões em tabela append-only, desfechos em tabela separada

- Status: aceita
- Fonte: plano de arquitetura (`Stratum_Arquitetura_Sistemas_Plano_Sprints_v1-11-10`), seção "Decisões de arquitetura", item 4

## Contexto

O histórico de previsões é o ativo central da Stratum. Só vale como prova se não puder ser reescrito depois do fato.

## Decisão

A tabela `previsoes` é append-only: um gatilho no banco proíbe UPDATE e DELETE. Os desfechos ficam na tabela `desfechos`, separada. Corrigir um erro cria uma nova linha com referência à anterior; a linha antiga nunca é alterada.

## Consequências

- A proibição vale no banco, não depende de disciplina do código da aplicação.
- Quem quiser a versão corrigida de uma previsão precisa seguir a referência da nova linha à anterior.
- O desfecho é preenchido depois, por job, sem tocar na previsão.
