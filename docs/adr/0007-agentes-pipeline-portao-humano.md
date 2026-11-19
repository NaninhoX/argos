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

**Nota de 18/11/2026:** o veto de Risco por regra em código descrito acima não está implementado. A busca em `lib/`, `api/`, `tools/` e `web/js/` não acha regra de veto (só texto sobre o agente de Risco em `web/js/live.js`, no pipeline da tela, marcado como "Protótipo"). A decisão continua valendo como princípio e como condição para dar poder de veto a qualquer agente; a guarda numérica do ADR 0006 existe em código (`lib/ai/numeric-guard.js`); o portão humano, neste repositório, é o processo (aprovação de Michel antes de publicar ou enviar), não uma regra em código.

**Nota de 19/11/2026:** o pipeline existe em código, ainda sem commit no momento desta nota: `lib/agents/` (Risco por regra, Debate, Montagem, Revisão e `pipeline.js`), `lib/repo/agentes.js` e `tools/relatorio-estrategico.mjs`, descritos em `docs/agentes.md`. O veto de Risco é regra em código sobre campos do motor, com a linha do limiar citada. O portão humano passa a ter registro: o relatório fica em `aguardando_aprovacao` até uma linha em `revisao_humana`. Nada roda com LLM real enquanto a conta do provedor estiver sem crédito; o caminho com LLM só foi testado com provedor simulado.
