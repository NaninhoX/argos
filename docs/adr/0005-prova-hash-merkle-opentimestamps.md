# ADR 0005 — Prova: hash SHA-256 por previsão e uma raiz de Merkle por dia no OpenTimestamps

- Status: aceita
- Fonte: plano de arquitetura (`Stratum_Arquitetura_Sistemas_Plano_Sprints_v1-11-10`), seção "Decisões de arquitetura", item 5

## Contexto

Cada previsão precisa poder ser verificada por terceiros, sem confiar na Stratum. Ancorar cada previsão separadamente multiplicaria chamadas e pontos de falha.

## Decisão

Cada previsão recebe o hash SHA-256 do seu JSON canônico. Uma raiz de Merkle por dia, calculada sobre esses hashes, é ancorada no OpenTimestamps.

## Consequências

- Uma âncora por dia em vez de uma por previsão reduz chamadas e falhas; cada previsão continua verificável pelo caminho na árvore.
- A prova completa sai até algumas horas depois da previsão.
- Âncora sem confirmação em 24 horas gera alerta.
- O hash canônico e a árvore de Merkle ficam em `lib/` (`canonical.js`, `merkle.js`).
