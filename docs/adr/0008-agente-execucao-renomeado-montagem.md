# ADR 0008 — Renomear o agente "Execução" para "Montagem"

- Status: aceita
- Fonte: plano de arquitetura (`Stratum_Arquitetura_Sistemas_Plano_Sprints_v1-11-10`), seção "Decisões de arquitetura", item 8

## Contexto

O agente chamado "Execução" faz a execução de rotina do pipeline. O nome contradiz o limite permanente de que a Stratum nunca executa ordens.

## Decisão

O agente passa a se chamar "Montagem". Ele continua executando a rotina do pipeline, e só isso.

## Consequências

- Código, prompts, esquemas e documentos usam "Montagem"; "Execução" não é mais nome de agente.
- O nome deixa de sugerir, a quem lê, execução de ordens ou de operações de mercado.
