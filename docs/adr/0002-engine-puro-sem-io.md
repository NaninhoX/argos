# ADR 0002 — Engine puro: candles e parâmetros entram, JSON sai

- Status: aceita
- Fonte: plano de arquitetura (`Stratum_Arquitetura_Sistemas_Plano_Sprints_v1-11-10`), seção "Decisões de arquitetura", item 2

## Contexto

O resultado estatístico precisa ser reproduzível e testável. A origem dos candles pode mudar: banco, Binance ou Kaiko/Tardis.

## Decisão

`engine/` recebe a série de candles e a configuração e devolve um objeto JSON determinístico. Não acessa rede, banco nem relógio. A origem dos candles entra por um adaptador, fora do motor.

## Consequências

- O resultado é reproduzível e testável, inclusive contra o HTML original da demo (teste de paridade).
- O adaptador isola o risco de licença de dados: trocar de fornecedor não toca o motor.
- Alterar a lógica estatística exige registro no `CHANGELOG.md` e nova versão SemVer.

**Nota de 18/11/2026:** `analyze()` e a rotina de `engine/index.js` medem o próprio tempo de execução com `performance.now()` (com `Date.now()` como reserva; procure por `performance.now` no arquivo, em vez de número de linha, que muda a cada versão) e devolvem o resultado no campo `ms`. É a única leitura de relógio do motor; o campo não entra na paridade (`tests/legacy-parity.test.js:13` e `tests/motor-confluencia-paridade.test.js:24` o descartam), então o resultado estatístico continua determinístico. Rede e banco seguem fora do motor.
