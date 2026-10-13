# ADR 0007 — Agentes como pipeline determinístico, com portão humano antes do envio

- Status: aceita
- Fonte: plano de arquitetura (`Stratum_Arquitetura_Sistemas_Plano_Sprints_v1-11-10`), seção "Decisões de arquitetura", item 7

## Contexto

Agentes de LLM podem automatizar detecção e análise, mas nenhum deles pode decidir sozinho o que sai para o cliente ou para o investidor.

## Decisão

Os agentes formam um pipeline determinístico, com portão humano antes do envio. O agente de Risco decide por regras em código; o LLM só explica o veto. A autonomia dos agentes se limita a detectar e analisar. O que não é medido por regra não ganha poder de veto.

## Consequências

- Todo material enviado passa por revisão humana, registrada.
- O veto de Risco é reprodutível, porque vem de regra em código e não de julgamento do modelo.
- Ganhar autonomia depende de evidência acumulada, conforme o plano de sprints; não é decisão deste ADR.
