# ADR 0012 — Multimercado: cripto, ações e forex

- Status: proposta. A direção foi decidida por Michel em 19/11/2026 ("cripto, ações e forex"). A ordem e os portões abaixo ainda esperam a aprovação dele.
- Fonte: levantamento do código feito em 19/11/2026 (orquestrador), pré-registro de 09/11 (`docs/estudo-multimercado-pre-registro.md`) e os itens 50, 51 e 54 do Roadmap Unificado v1-19/11.

## Contexto

O Argos é cripto de ponta a ponta. Os pontos que pressupõem mercado 24/7 e uma única fonte de dados são estes:

| Onde | O que supõe | Efeito em ações e forex |
|---|---|---|
| `lib/data/series.js:9` (`SYMBOLS`), `lib/data/binance.js`, `lib/jobs/ingest-candles.js` | Três pares da Binance, ingestão só da Binance | Não há fonte nem licença para ações e forex (item 51) |
| `lib/jobs/termometro.js:70` (`windowIsContiguous`) | Candle seguinte = candle anterior + `dt` | Fim de semana, noite e feriado contam como "buraco", e o desfecho nunca seria gravado |
| `lib/jobs/termometro.js:43` (`serie_atrasada`) | O relógio anda junto com os candles | Com o mercado fechado, toda série pareceria atrasada |
| `engine/index.js:189` (`periodsPerYear = 365 × 86400 / dt`) | Ano de 365 dias corridos | Só muda o número anualizado exibido. O percentil de volatilidade (`rvPct`), que entra no regime, é invariante à escala e não muda |
| `engine/index.js` (`outcomesAll`) | Alvo e stop preenchidos dentro do candle | Gap de abertura (ações) pode pular alvo e stop; o pré-registro de 09/11 já declara "gaps de abertura não tratados" |
| Telas (`web/js/live.js`, `url-state.js`: BTC, ETH, SOL) | Lista fixa de ativos | Precisa de seletor por classe |

## Decisão proposta (ordem)

1. **Licença dos dados antes de qualquer coisa pública.** A fonte usada até hoje para ações e forex (Yahoo) não tem licença comercial. Ela serve só para estudo interno, que é o caso do pré-registro de 09/11. Fonte paga e licenciada é item 51 e passa pelo advogado (54).
2. **Estudo de validação antes do produto (item 50).** O estudo multimercado pré-registrado em 09/11 (hash `6e22507a…`, commit f53aaa1) já foi executado uma vez, em 09/11/2026, depois do registro. O resultado é interno e fica fora deste repositório. Não se roda de novo: uma pergunta nova para ações ou forex é ficha nova, com registro novo, desenhada para a classe (calendário, custos, gaps).
3. **Calendário de pregão, numa versão própria do motor e em código aditivo.** Uma noção de "próximo candle esperado" por classe substitui `t + dt` em `windowIsContiguous` e em `serie_atrasada`: para cripto continua igual a `t + dt`, para forex pula o fim de semana e para ações (B3) segue o calendário da bolsa. Resultado antigo não muda: o calendário de cripto é exatamente o de hoje, com paridade 72 de 72 obrigatória.
4. **Gap de abertura no desfecho:** nada muda no `outcomesAll` atual. Se o estudo pedir tratamento de gap, ele entra como regra declarada em ficha nova, nunca como edição silenciosa.
5. **Telas e Termômetro de ações e forex só depois de 1 a 3.** Nenhum texto externo diz que o Argos "cobre" ações ou forex antes disso. O certo é dizer que é a direção decidida, com estudo e licença pela frente.

## Consequências

- Cripto não muda em nada: motor, Termômetro e prova seguem como estão.
- O trabalho de engenharia (item 3) pode começar antes da licença, com dados de teste sintéticos e sem nenhuma série real de ações ou forex no repositório.
- Qualquer número de ações ou forex mostrado ao investidor antes do estudo seria exploratório. As 7 séries vistas em 09/11 já foram declaradas não publicáveis.
