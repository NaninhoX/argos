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
