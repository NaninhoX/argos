# Estudo multimercado: pré-registro

**Data do registro:** 09/11/2026. **Motor de referência:** `argos-engine 1.1.0` (não alterado por este documento nem pelo estudo).
**Ficha canônica:** [`estudo-multimercado-pre-registro.json`](estudo-multimercado-pre-registro.json).
**SHA-256 da ficha canônica** (JSON canonizado por `lib/canonical.js`): `6e22507af21bea237b28a0c4e0fd0837374623125eebe8bdfde54f53f05507cf`.

Este documento fixa **antes de calcular qualquer série nova** o que o estudo vai testar. Mudar qualquer item depois de ver resultado é outro estudo, com outro registro, nunca edição desta ficha. O hash acima e o commit no Git dão uma data verificável por quem confia no repositório.

## Pergunta

Os setups de reversão (comprar após queda) ficam abaixo da taxa-base de entradas aleatórias, e os de tendência ficam acima, de forma consistente entre mercados, em séries que ainda não foram analisadas?

A hipótese nasceu de uma **observação exploratória** em sete séries já vistas (EURUSD, PETR4, VALE3, ITUB4, BTC, ETH, SOL, diário). Essas sete não entram na contagem. O padrão visto: RSI sobrevendido abaixo da base em 7 de 7, Bollinger inferior em 6 de 7, MACD acima em 7 de 7 e Rompimento de 20 acima em 6 de 7. Foram vistos também seis regras de saída. Isso é **hipótese, não resultado**.

## Hipóteses

| | Setup | Previsão |
|---|---|---|
| H1 | RSI Oversold (`RSI_OVERSOLD`) | abaixo da taxa-base |
| H2 | Bollinger inferior (`BB_LOWER`) | abaixo da taxa-base |
| H3 | MACD cruza (`MACD_CROSS`) | acima da taxa-base |
| H4 | Rompimento de 20 (`BREAKOUT_20`) | acima da taxa-base |

Hipótese nula: em cada setup, a diferença entre a taxa de acerto e a taxa-base tem sinal aleatório entre as séries.

## Universo (fechado agora)

- **20 ações da B3:** BBDC4, ABEV3, BBAS3, B3SA3, WEGE3, RENT3, SUZB3, GGBR4, JBSS3, ELET3, RADL3, EQTL3, LREN3, RAIL3, CSNA3, PRIO3, HAPV3, CMIG4, ITSA4, UGPA3.
- **6 pares de Forex:** GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, USDBRL.
- **Fora, por já vistas:** EURUSD, PETR4, VALE3, ITUB4, BTCUSDT, ETHUSDT, SOLUSDT.
- Total previsto: 26 séries. A escolha foi por liquidez conhecida do autor, não por dado.

## Dados

API pública de gráfico do Yahoo Finance, diário, 10 anos, corte em 06/11/2026, sem licença comercial (uso interno). Candles com preço nulo são descartados e contados. **Série com menos de 1.700 candles diários** (200 de aquecimento mais 1.500) é excluída e listada, antes de ver resultado. O `seriesHash` do motor fica registrado por série.

## Regra de saída e família

Regra padrão: alvo 2×ATR, stop 1×ATR, 12 candles; empate no mesmo candle conta como perda; gaps de abertura não tratados; alvo e stop são parâmetros do teste, nunca orientação. O veredito por série segue o motor, na família de 8 setups por série (`/api/analyze`), e sempre vem com a família.

## Resultado primário e critério

Para cada série e setup, `alphaPP` (acerto menos taxa-base, em pontos percentuais, calculado pelo motor). Por hipótese:

1. **Fração** das séries com o sinal previsto.
2. **Média** das `alphaPP`, com intervalo de 95% por reamostragem das séries (10.000 sorteios, semente 20261109).
3. **Teste de sinal** binomial unilateral contra 50%, com Benjamini-Hochberg sobre as 4 hipóteses (**família 4**).

Uma hipótese é **sustentada** se a fração for de pelo menos 75%, o intervalo da média excluir zero no sentido previsto e q < 0,05 na família 4. O **padrão geral** só é declarado se pelo menos 3 das 4 forem sustentadas.

**Critério de falsificação:** fração abaixo de 75% ou intervalo incluindo zero abandona a hipótese. Menos de 3 de 4 abandona o padrão geral, e o resultado negativo sai com o mesmo destaque.

## Sensibilidade à regra de saída

Relatório, não teste: sem veredito, fora da família. Duas regras alternativas declaradas (alvo 1, stop 1, 12 candles; alvo 3, stop 1, 20 candles). Rótulo **robusto à regra** se a fração com o sinal previsto for de pelo menos 75% nas duas; senão, **sensível à regra**. Variações totais: 3 regras × 4 setups, e nenhuma outra será rodada.

## O que este estudo consegue e não consegue enxergar

- Consegue dizer se o **sinal** é consistente entre mercados novos. Não mede o tamanho do efeito em cada série, que tem poucas dezenas de gatilhos.
- **Viés de sobrevivência:** as 20 ações são as líquidas hoje. Isso tende a favorecer tendência (H3, H4); portanto confirmar H3 e H4 vale menos do que refutar.
- **Independência:** ações brasileiras andam juntas, e os pares com dólar também. O teste de sinal supõe séries independentes; o poder real é menor que o 26 sugere.
- **Mesmo período** das séries exploratórias: amostra nova nos ativos, não no tempo.
- **Custos não testados.** Gap de abertura não tratado: o retorno médio é otimista, o rótulo de acerto ou perda não muda.
- Dados sem licença comercial e sem conferência de ajuste por dividendo.

## Travas

Publicar resultado exige parecer sobre CNPI; reprodução pública exige licença dos dados. Custo: cerca de 4 h de Michel (revisão e leitura); o cálculo roda em minutos. Se o resultado for negativo ou insuficiente, ele é publicado do mesmo jeito.

## Implementação (não feita)

Script `tools/estudo-multimercado.mjs`, só leitura sobre `engine/` (nenhuma alteração no motor, `tests/legacy-parity.test.js` e `tests/study-v1.1.test.js` seguem como estão), a ser escrito **depois** deste commit e rodado uma única vez. Carimbo independente (OpenTimestamps) exigiria `tools/registrar-ficha.mjs`; hoje valem o hash e o commit.
