# Estudo v1.2: pré-registro

**Data do registro:** 18/10/2026. **Motor de referência:** `argos-engine 1.1.0` (não alterado por este documento).
**Ficha canônica:** [`estudo-v1.2-pre-registro.json`](estudo-v1.2-pre-registro.json).
**SHA-256 da ficha canônica** (JSON canonizado por `lib/canonical.js`): `98e8e1134d3cf5c9c9f4a91582d4a11284efa9f3dede5bf4057f6a6db7730357`.

Este documento fixa **antes de qualquer cálculo** o que o estudo v1.2 vai testar. Mudar qualquer item depois de ver resultado é outro estudo, com outro registro, nunca edição desta ficha. O hash acima prova que o conteúdo do JSON não mudou desde o registro: qualquer alteração, até de uma vírgula, muda o hash.

## Pergunta e hipótese nula

Setups de indicadores populares, com parâmetros-padrão fixos, superam a taxa-base de entradas aleatórias nas mesmas nove séries do estudo v1.1? A hipótese nula é que a taxa de acerto (alvo antes do stop) **não** supera a base de entradas aleatórias com a mesma regra de saída (teste de permutação do motor, 3.000 sorteios).

## Os 7 setups novos

Todos seguem a convenção do estudo v1.1: o gatilho é o primeiro candle em que a condição passa a valer.

| Setup | Gatilho (candle `i`) | Grupo |
|---|---|---|
| Cruzamento de EMA 9 e 21 | `ema9[i-1] <= ema21[i-1]` e `ema9[i] > ema21[i]` | Tendência |
| MACD cruza a linha zero | MACD(12,26,9): `macd[i-1] <= 0` e `macd[i] > 0` | Momento |
| RSI cruza acima de 50 | RSI(14): `rsi[i-1] < 50` e `rsi[i] >= 50` | Momento |
| Preço cruza acima da média de 200 | `c[i-1] <= sma200[i-1]` e `c[i] > sma200[i]` | Tendência |
| ADX acima de 25 com DI+ cruzando DI− | ADX(14) > 25 e DI+ cruza acima de DI− | Tendência |
| Fechamento acima da Bollinger superior | Bollinger(20, 2), primeiro candle da sequência (espelho do `BB_LOWER`) | Momento |
| Rompimento de 55 candles | Fechamento acima da máxima dos 55 anteriores, primeiro candle (mesma construção do `BREAKOUT_20`) | Tendência |

Os períodos são os padrões de mercado e **ficam fixos**. A escolha dos sete foi feita por popularidade de uso, como julgamento do autor, não por dado, e **antes** de qualquer resultado.

## Séries e saída

BTCUSDT, ETHUSDT e SOLUSDT em 1h, 4h e 1d (9 séries), com o mesmo corte do v1.1 (26/09/2026). Regra de saída padrão: alvo 2×ATR, stop 1×ATR, prazo de 12 candles; empate no mesmo candle conta como perda. Alvo e stop são parâmetros do teste, não orientação a ninguém. O hash da série (`seriesHash`) de cada uma é registrado na execução.

## Quantas variações

7 setups × 9 séries = **63 células novas**, nenhuma descartada antes do registro. Esperado só pelo acaso, sem correção: cerca de 3 células com p ≤ 5% entre as 63.

## Família de correção (Benjamini-Hochberg)

- **Oficial para as células novas:** família de **135** (63 novas + 72 do v1.1). É a mais conservadora.
- **Sensibilidade:** família de 63 (só as novas), mostrada como comparação.
- As 72 células do v1.1 **ficam como publicadas** (família 72). O recálculo na família 135 aparece só como recálculo rotulado, nunca no lugar do valor publicado.
- Todo p ajustado vem com a família: "q = 0,xxx, família 135".

## Vereditos e critério de falsificação

Valem as regras do motor (`verdictOf`): menos de 10 gatilhos efetivos é "evidência insuficiente"; q ≥ 0,05 é "sem vantagem demonstrável"; q < 0,05 com taxa abaixo da base é "abaixo do acaso"; q < 0,05 com walk-forward inconsistente é "vantagem presente, sensível a subperíodos"; os demais, "vantagem estatística presente".

O setup é abandonado como candidato a vantagem em qualquer veredito que não seja "vantagem". Só recebe "vantagem" quem tiver q < 0,05 na família 135, intervalo da taxa de acerto acima da base e walk-forward consistente. Resultado negativo tem o mesmo destaque do positivo, e a linha inteira de cada setup (as 9 séries) é reportada, inclusive as células contrárias.

## O que este estudo consegue enxergar

Efeito mínimo detectável aproximado, com poder de 80% e nível de 5% **sem** correção, tomando a base como cerca de um terço (a de um alvo de 2× contra um stop de 1× em passeio aleatório; o motor mede a base real): cerca de **13 p.p. com 100 gatilhos efetivos** e **6,6 p.p. com 400**. Com a correção de 135 testes, o limiar sobe. Diferença menor cai em "sem vantagem demonstrável", e isso **não** prova que o efeito não existe. Células de 1d tendem a ter poucos gatilhos e cair em "evidência insuficiente", como já acontece no v1.1.

## Limites

- **Custos não testados** no veredito: o motor só embute 0,1% em `meanNet`.
- Os dados históricos já existem. O registro garante que regras e parâmetros foram fixados **antes do primeiro cálculo dos setups novos**, não que o autor desconheça o histórico do mercado. Evidência fora da amostra só existe para candles posteriores a 18/10/2026.
- Publicar o resultado exige parecer sobre CNPI; reprodução pública exige licença dos dados.

## Implementação (não feita)

Exige versão MINOR do motor (`argos-engine 1.2.0`), apenas aditiva: arrays `ema9`, `ema21` e `hh55` em `computeIndicators` e os sete gatilhos. As saídas do estudo v1.1 têm de permanecer idênticas; `tests/legacy-parity.test.js` e `tests/study-v1.1.test.js` continuam verdes. Os demais indicadores (RSI, MACD, SMA 200, ADX/DI, Bollinger) já são calculados pelo motor. Decisão de Michel; depois de 31/10/2026.

## Como carimbar a data de forma independente

O hash acima e o commit no Git dão uma data verificável por quem confia no repositório. Uma prova independente (OpenTimestamps) exigiria um script novo, `tools/registrar-ficha.mjs`, sem tocar em `engine/`: hoje a prova só aceita previsões em `POST /api/previsoes`.
