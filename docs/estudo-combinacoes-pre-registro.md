# Estudo de combinações de setups (pares e trios): pré-registro

**Data do registro:** 17/11/2026. **Estado:** REGISTRADO, aprovado por Michel em 17/11/2026. **Motor de referência:** `argos-engine 1.1.0` (não alterado por este documento; o estudo exige a versão 1.2.0, descrita em "Implementação (não feita)").
**Ficha canônica:** [`estudo-combinacoes-pre-registro.json`](estudo-combinacoes-pre-registro.json).
**SHA-256 da ficha canônica** (JSON canonizado por `lib/canonical.js`): `76bcee77d3355117fb60908f9b996f3b1456017bcd17ea1cc61dec42990e33d8`. O mesmo cálculo reproduz os hashes já publicados do v1.2 e do multimercado. Carimbo independente por OpenTimestamps: pendente.

Este documento fixa **antes de calcular qualquer taxa de acerto de combinação** o que o estudo vai testar. Mudar qualquer item depois de ver resultado é outro estudo, com outro registro, nunca edição desta ficha. O hash acima e o commit no Git dão uma data verificável por quem confia no repositório; o carimbo do OpenTimestamps daria prova independente e ainda não foi feito.

## Pergunta e hipótese nula

Exigir que dois ou três setups do motor apareçam juntos, numa janela curta de candles, produz uma taxa de acerto (alvo antes do stop) acima da taxa-base de entradas aleatórias, nas mesmas nove séries do estudo v1.1? A hipótese nula é que a combinação **não** supera a taxa-base de entradas aleatórias com a mesma regra de saída (teste de permutação do motor, 100.000 sorteios, semente 42, gerador mulberry32).

**Por que 100.000 sorteios e não os 3.000 do v1.1:** com 3.000 sorteios o menor p possível é 2/3001 = 6,7e-4; na família de 756 testes, pelo ajuste do motor, uma célula sozinha só alcançaria q = 0,504 (seriam necessárias 11 células no piso para q < 0,05). Com 100.000 sorteios o piso é 2e-5 e uma célula isolada chega a q ≈ 0,015. Isso exige o parâmetro novo `iters` em `evaluateSetup` (padrão 3.000, para manter a paridade 72/72; ver "Implementação"). A comparação com os componentes (condição 4) não depende do número de sorteios: usa o `alphaPP` (diferença para a taxa-base), que é um cálculo determinístico; ver "Comparação com os componentes".

Este é um teste de hipótese sobre o passado. Não diz a ninguém o que fazer com dinheiro.

## Hipótese de pesquisa e critério de falsificação

**Hipótese de pesquisa:** "combinar setups melhora": ao menos uma combinação tem vantagem estatística sobre o acaso depois de corrigidos os múltiplos testes.

**Critério de falsificação, escrito antes:** uma célula só conta a favor de "combinar melhora" se cumprir **todas** as condições a seguir:

1. veredito "Vantagem estatística presente" na família de 756, medido pelo q (o p ajustado pela correção de Benjamini-Hochberg, que limita a proporção esperada de falsos positivos quando se fazem muitos testes); isso exclui "sensível a subperíodos";
2. o limite inferior do intervalo da taxa de acerto fica acima da taxa-base;
3. walk-forward (teste em blocos sucessivos do tempo) disponível (pelo menos 20 gatilhos com desfecho) e consistente;
4. a diferença para a taxa-base (`alphaPP`) da combinação é **maior** que a de cada componente isolado na mesma série, com cada componente isolado **reavaliado na mesma série, com o mesmo período refratário de 12 candles e a mesma regra de saída** (cálculo determinístico, sem teste de permutação); os valores publicados do v1.1 aparecem ao lado só como contexto. O `alphaPP` (diferença para a taxa-base) não depende do número de sorteios.

Se nenhuma célula cumprir de (1) a (4), a ideia é dada como **não sustentada nesta forma** (janela de 4 candles, refratário de 12, estas séries e esta saída); efeitos menores que o efeito mínimo detectável não ficam excluídos. A condição (4) existe porque, no v1.1, o único veredito "Vantagem estatística presente" foi de +5,7 p.p. (ETHUSDT 4h BREAKOUT_20), e SOLUSDT 1d BREAKOUT_20 teve q < 0,05 com +17,4 p.p., mas "sensível a subperíodos": qualquer combinação que inclua um desses componentes herdaria a vantagem sem nenhum ganho por combinar.

Para virar **candidata** ao Estágio 2, a célula precisa ainda de `alphaPP` > 0 da mesma combinação no mesmo tempo gráfico em pelo menos um dos outros dois ativos, com N efetivo (nEff do motor: gatilhos com desfecho corrigidos pela autocorrelação dos retornos, Durbin-Watson; nunca maior que o número de gatilhos com desfecho) ≥ 10. Esse último é um **sinal descritivo**, não uma confirmação, porque BTC, ETH e SOL são correlacionados. Um resultado positivo isolado, no meio de 756 células de três ativos correlacionados, é indício a ser reconfirmado, não conclusão. O resultado negativo sai publicado com o mesmo destaque que um positivo teria.

## As combinações

- **Setups componentes (os 8 do motor, sem escolher nenhum por resultado):** `RSI_OVERSOLD`, `MACD_CROSS`, `GOLDEN_CROSS`, `BB_LOWER`, `BREAKOUT_20`, `EMA_PULLBACK`, `BULL_ENGULFING`, `HAMMER`. O gatilho de cada um é o do motor 1.1.0, igual ao do estudo v1.1.
- **Todos os 28 pares e todos os 56 trios** (84 combinações), listados no apêndice. Ordem dos componentes não importa. Nenhuma combinação foi retirada ou escolhida por resultado.
- **Semântica única de confluência (primária):** a combinação tem gatilho no candle `i` se **todos** os componentes tiveram gatilho em algum dos candles `i-3` a `i` (inclusive `i`), isto é, **janela de 4 candles (o atual e os 3 anteriores)**, **e** pelo menos um componente dispara exatamente no candle `i`. A janela é fixa e usa os candles do **próprio tempo gráfico** da série. Aquecimento de 200 candles, como no motor: os gatilhos dos componentes antes do índice 200 são zerados antes de aplicar a confluência.
- **Período refratário de 12 candles** (igual ao prazo da saída): um gatilho da combinação no candle `i` só conta se `i` − (índice do último gatilho **contado** da mesma combinação na mesma série) ≥ 12. O primeiro gatilho da série sempre conta. Motivo: sem o refratário, gatilhos colados no tempo (cerca de 16% dos gatilhos, 4.461 de 27.883, ficam a até 3 candles do anterior, e o refratário remove 5.770 deles, 20,7%) têm desfechos sobrepostos, e o teste de permutação, que sorteia candles como independentes, ficaria otimista. Com o refratário os desfechos não se sobrepõem.
- **Independência:** mesmo com o refratário, o teste de permutação trata os candles como independentes entre si. Regimes de mercado e ativos correlacionados deixam o p possivelmente otimista; isso é declarado, não corrigido.
- **Não são testados** (qualquer um deles é outro estudo, com outro registro): gatilho só no mesmo candle, outras janelas, outros períodos refratários, "ou" entre setups, e "votos" (pelo menos k de n).

## Séries e saída

BTCUSDT, ETHUSDT e SOLUSDT em 1h, 4h e 1d (9 séries), com as mesmas fontes do v1.1. **Fonte: 4h e 1d: `data/snapshot-v1.1.json`; 1h: `data/history/*_1h.json.gz` (jan/2022 ao corte), como em `tests/study-v1.1.test.js`.** Origem dos dados: Binance Spot API pública, coletados em 27/09/2026. Corte do v1.1: **26/09/2026** (23:59:59 UTC). O hash de cada série (`seriesHash`, SHA-256 do JSON canônico de `[dt, t, o, h, l, c, v]`) fica fixado aqui:

| Série | Fonte | Candles | Primeiro (UTC) | Último (UTC) | `seriesHash` |
|---|---|---|---|---|---|
| BTCUSDT 1h | `data/history/BTCUSDT_1h.json.gz` | 41519 | 2022-01-01 00:00 | 2026-09-26 23:00 | `8e4cb5d8b4542962bb5dd3c98ba40cb336b1e476131be7ec0b56ac87eccaf1af` |
| BTCUSDT 4h | `data/snapshot-v1.1.json` | 19951 | 2017-08-17 04:00 | 2026-09-26 20:00 | `478c029631d32b3c04206fbe683e88f178f194a9be19dfb0ee8dc7b3cb40f051` |
| BTCUSDT 1d | `data/snapshot-v1.1.json` | 3328 | 2017-08-17 00:00 | 2026-09-26 00:00 | `81c1aec5ac1be17a0145507df10aa6d3abeb737d9e85ba1a30e81fe9ab0b1096` |
| ETHUSDT 1h | `data/history/ETHUSDT_1h.json.gz` | 41519 | 2022-01-01 00:00 | 2026-09-26 23:00 | `341bd2069c4284ccb91c6b8061a9c2fe753036cdb824ed34a41939155efd388c` |
| ETHUSDT 4h | `data/snapshot-v1.1.json` | 19951 | 2017-08-17 04:00 | 2026-09-26 20:00 | `12aca5f11a6fbb23bd54423fcc520303a3d06be1e2015c5c24ed3a79ef0a9728` |
| ETHUSDT 1d | `data/snapshot-v1.1.json` | 3328 | 2017-08-17 00:00 | 2026-09-26 00:00 | `1397933a078c23a8d686abcf9f7a49e41b37bd1d0c779f4f9322f94cb38a6271` |
| SOLUSDT 1h | `data/history/SOLUSDT_1h.json.gz` | 41519 | 2022-01-01 00:00 | 2026-09-26 23:00 | `6c8f15a99830f7918a492e14c5546a6ccf88ac9a0058944c54a5feb1493989ce` |
| SOLUSDT 4h | `data/snapshot-v1.1.json` | 13427 | 2020-08-11 04:00 | 2026-09-26 20:00 | `6eca353facf61405cf406cd41bd121a4c1c095e63abf43205f1e123165213e05` |
| SOLUSDT 1d | `data/snapshot-v1.1.json` | 2238 | 2020-08-11 00:00 | 2026-09-26 00:00 | `ee6eb552d926c59263699c9b4e79019020439a2da409c9e7c61154a74844d56f` |

**Regra de saída padrão:** alvo 2×ATR, stop 1×ATR, prazo de 12 candles; ATR(14) com média de Wilder; empate no mesmo candle conta como perda. Alvo e stop são **parâmetros do teste**, não orientação a ninguém. Também fixos: aquecimento de 200 candles, 100.000 sorteios com semente 42 (gerador mulberry32) e os vereditos do motor (`verdictOf`).

## Quantas variações

84 combinações × 9 séries = **756 células**, nenhuma descartada antes do registro e nenhuma outra regra de janela, de refratário ou de saída será rodada. Esperado só pelo acaso, sem correção: **no máximo cerca de 25 células com p ≤ 5%** (5% das 491 células com pelo menos um gatilho); na prática menos, porque células com poucos gatilhos não alcançam p ≤ 5%. Células com zero gatilhos (265) entram com p = 1.

## Família de correção (Benjamini-Hochberg)

- **Oficial:** família de **756** (as 84 combinações × 9 séries). **Todas as células entram com o p do teste de permutação; as de zero gatilhos entram com p = 1; células com N efetivo < 10 recebem "evidência insuficiente" qualquer que seja o q.** Contar todas é a escolha conservadora.
- **Por que a oficial é 756 e não inclui as 72 do v1.1** (o v1.2 escolheu somar as 72): a pergunta é outra, as combinações são hipóteses novas, e a família oficial mais conservadora entre as defensáveis para a pergunta nova já é grande. As outras famílias ficam como sensibilidade.
- **Sensibilidade, apenas reportada:** família de **828** (756 + as 72 células do v1.1). Família de **891** (756 + as 135 do v1.2, que já incluem as 72): **condicional**, reportada só se o v1.2 tiver sido executado antes; caso contrário é omitida, e o relatório diz isso. Servem de comparação e **nunca** se misturam com a oficial.
- As células do v1.1 e do v1.2 ficam como publicadas (v1.1) ou como forem publicadas (v1.2) nas suas famílias.
- Todo p ajustado vem com a família: "q = 0,xxx, família 756, combinações".

## Vereditos

Valem as regras do motor (`verdictOf`): menos de 10 gatilhos efetivos é "evidência insuficiente"; q ≥ 0,05 é "sem vantagem demonstrável"; q < 0,05 com taxa abaixo da base é "abaixo do acaso"; q < 0,05 com walk-forward inconsistente (bloco de teste mais de 15 p.p. abaixo do treino) é "vantagem presente, sensível a subperíodos"; os demais, "vantagem estatística presente". Intervalo de Wilson, ou Beta-binomial quando o N efetivo é menor que 25.

O critério de falsificação da ideia "combinar melhora" está na seção da hipótese de pesquisa. A **lista completa por série** (as 9 séries de cada combinação) é reportada, inclusive as células contrárias (taxa abaixo do acaso), e o resultado negativo sai com o mesmo destaque do positivo.

## Comparação com os componentes (condição 4 do critério)

Para cada combinação e série, o relatório mostra lado a lado a diferença para o acaso (`alphaPP`, em pontos percentuais) da combinação e a de cada componente isolado, este **reavaliado na mesma série, com o mesmo período refratário de 12 candles e a mesma regra de saída** (cálculo determinístico, sem teste de permutação); os valores publicados do v1.1 aparecem ao lado só como contexto. O `alphaPP` (diferença para a taxa-base) não depende do número de sorteios. Esta comparação **não** é só descrição: é a condição (4) do critério de falsificação. Ela não gera veredito próprio e não entra na família de correção.

## O que este estudo consegue enxergar

**Número de gatilhos (só contagem, nenhuma taxa de acerto foi calculada).** Contagem exata com a semântica acima (janela de 4 candles, refratário de 12). **As contagens são de gatilhos brutos, limite superior do N efetivo** (nEff do motor: gatilhos com desfecho corrigidos pela autocorrelação dos retornos, Durbin-Watson; nunca maior que o número de gatilhos com desfecho).

| | Células | Zero | Pelo menos 1 | Pelo menos 3 | Pelo menos 4 | Pelo menos 10 | Pelo menos 20 | Pelo menos 30 | Pelo menos 100 | Pelo menos 300 | Soma de gatilhos |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Pares | 252 | 25 | 227 | 200 | 190 | 147 (58,3%) | 121 | 103 (40,9%) | 53 (21,0%) | 16 | 18.217 |
| Trios | 504 | 240 | 264 | 165 | 140 | 90 (17,9%) | 55 | 38 (7,5%) | 4 | 0 | 3.896 |
| Total | 756 | 265 | 491 | 365 | 330 | 237 | 176 | 141 | 57 | 16 | 22.113 |

- **Mínimo para chegar a 5%:** com 2 ou menos gatilhos o p bicaudal não chega a 5%; com 3 chega se todos acertarem em 8 das 9 séries (em BTCUSDT 1d no limite, 0,0498, e depende do sorteio; em ETHUSDT 1d não chega); com menos de 10 gatilhos o veredito é sempre "evidência insuficiente", e esse p só pesa na ordenação de Benjamini-Hochberg; 365 das 756 células têm 3 ou mais gatilhos (330 têm 4 ou mais). As 265 células com zero gatilhos ficam com p = 1 fixo.
- **Consequência esperada:** 42% das células de pares e 82% das de trios têm menos de 10 gatilhos brutos e caem necessariamente em **"evidência insuficiente"** (o N efetivo nunca passa da contagem bruta). Das 237 células com 10 ou mais gatilhos brutos (147 pares, 58%; 90 trios), uma parte ainda pode cair em "evidência insuficiente" pelo N efetivo, que só se conhece na execução. Isso não prova que a combinação não funciona; prova que o histórico não tem dados para dizer. O walk-forward fica indisponível abaixo de 20 gatilhos com desfecho: só 176 das 756 células podem cumpri-lo.
- **Efeito mínimo detectável** (poder de 80%, nível de 5%, base medida no v1.1 entre 25% e 30%; o motor mede a base real): cerca de **13 p.p. com 100 gatilhos efetivos** e **6,5 p.p. com 400**, sem correção; com a correção de 756 testes, cerca de **22 e 11 p.p.** (melhor caso, uma célula só; conferido pelo validador). Ter muitos gatilhos **baixa** o efeito mínimo: 53 células de pares e 4 de trios (57 no total) chegam a 100 gatilhos brutos e só 16 (todas de pares) passam de 300; nas demais o efeito mínimo passa de 13 p.p. (sem correção; com a correção de 756 testes, passa de 22 p.p.). O único veredito "Vantagem estatística presente" do v1.1 foi de +5,7 p.p. (ETHUSDT 4h BREAKOUT_20); SOLUSDT 1d BREAKOUT_20 teve q < 0,05 com +17,4 p.p., mas "sensível a subperíodos". Efeitos do tamanho de +5,7 p.p. **não** são detectáveis em nenhuma célula: mesmo no melhor caso, o menor efeito detectável com a correção de 756 testes é de cerca de 6 p.p. com 50% de poder e 7,4 p.p. com 80% (P12 em 1h, mais de 800 gatilhos). Diferença menor cai em "sem vantagem demonstrável", e isso **não** prova que o efeito não existe.
- **Por acaso:** no máximo cerca de 25 células (5% das 491 com pelo menos 1 gatilho); menos na prática.
- **Poder real da condição (iii):** a condição (iii) exige 20 ou mais gatilhos com desfecho: só 176 das 756 células podem cumprir o critério. No melhor caso (uma célula só, 50% de poder, binomial exata com a base de cada série, q<0,05 na família de 756), 14 detectam efeito de até 10 p.p., 39 até 15 p.p. e 62 até 20 p.p. (com 80% de poder, só 6 células detectam até 10 p.p.). Um efeito do tamanho do único veredito "Vantagem estatística presente" do v1.1 (+5,7 p.p.) é indetectável. Este estudo é, por isso, um detector de efeitos grandes (10 p.p. ou mais) em um conjunto pequeno de células, principalmente pares de 1h e 4h; não prova ausência de efeitos menores.
- Se a amostra for curta demais, o Relógio de Evidência pode projetar quando a combinação alcança o mínimo, no ritmo atual de gatilhos (estimativa, rotulada como tal).

## Avisos honestos (disclosure)

1. **Os 72 resultados individuais do v1.1 já foram vistos.** Por isso a lista de combinações foi fixada (todas as 84, sem escolha) **antes de calcular qualquer taxa de acerto de combinação**. Ainda assim, o autor conhece o comportamento dos componentes nestas mesmas séries: este estudo, nas 9 séries, é **confirmatório só em parte**.
2. **Só foram contados gatilhos das combinações (poder). Nenhum acerto foi calculado.** Essa contagem foi feita para dimensionar o estudo e está declarada acima e no apêndice.
3. **As 9 séries são 3 ativos cripto muito correlacionados em 3 tempos gráficos**, não 9 amostras independentes. O poder real é menor que o número 756 sugere, e um resultado positivo em BTC tende a aparecer em ETH e SOL.
4. **Custos não testados:** o veredito do motor não inclui taxas, spread nem deslizamento (o motor só embute 0,1% em `meanNet`).
5. **Sem gap de abertura no cripto 24h:** não há lacuna entre o fechamento e a abertura seguinte nessas séries, o que não vale para ações nem Forex; os resultados não se transferem a esses mercados.
6. **Os dados históricos já existem.** O registro assegura que regras e parâmetros foram fixados antes do primeiro cálculo de taxa de acerto das combinações, não que o autor desconheça o histórico do mercado. Já existem também cerca de 7 semanas de candles posteriores ao corte de 26/09/2026.
7. **O teste de permutação trata os candles como independentes entre si.** Regimes de mercado e ativos correlacionados deixam o p possivelmente otimista, mesmo com o refratário de 12 candles.

## Estágio 2: o que fazer com um resultado positivo

Qualquer combinação que passe o critério (e a exigência de outro ativo) vira **candidata** e exige um **novo pré-registro**. **Estágio 2: novo pré-registro carimbado; só contam candles posteriores ao carimbo desse novo registro.** Dados "posteriores a 26/09/2026" não bastam: já existem cerca de 7 semanas deles.

A regra do skill de desenho de estudos é que a ficha só vale como pré-registro antes de qualquer candle posterior ao corte. **Este estudo também foi registrado depois do corte** (17/11/2026 contra 26/09/2026), com o mesmo argumento do v1.2: as regras são fixadas antes de calcular qualquer taxa de acerto de combinação, mas os candles já existiam; por isso o resultado é retrospectivo, não prospectivo. Opcional, a decidir por Michel: o trecho de 27/09/2026 até a data do carimbo deste estudo pode ser fixado com `seriesHash` como amostra fora da amostra **não prospectiva**.

Registrar combinações no Termômetro exige alterar o job (`lib/jobs/termometro.js`, que hoje só registra os 8 setups de `analyze` com 10 ou mais desfechos) e o motor: **decisão de Michel**. Nenhum resultado deste estudo, sozinho, é tratado como vantagem confirmada. Se o resultado for negativo ou "evidência insuficiente" em toda a família, é publicado do mesmo jeito.

## Limites

- **Custos não testados** no veredito.
- Cripto apenas, em três ativos correlacionados; nada se diz de ações, Forex ou outros mercados.
- Só uma semântica de confluência, um refratário e uma regra de saída; os resultados valem para elas e não para variações.
- Evidência prospectiva só existe para candles posteriores ao carimbo (do novo pré-registro do Estágio 2).
- Os dados históricos já existem (aviso 6): o pré-registro não elimina o conhecimento prévio do autor sobre o histórico.
- Publicar o resultado exige parecer sobre CNPI; reprodução pública exige licença dos dados.

## Custo

Cerca de **4 a 6 h de Michel** (revisão do código novo, leitura da lista completa de 756 células e do relatório). Ordem de grandeza medida pelo validador com as séries atuais: permutação de 100.000 sorteios em cerca de 2,6 ms por gatilho (cerca de 22.000 gatilhos: de 1 a 2 minutos só nos sorteios) e `analyzeSpec` de 1 a 2 s por série de 1h (41.519 candles); estimativa total de poucos minutos, a medir na execução.

## Implementação (não feita)

O motor **não tem gatilho composto**: `analyzeSpec` aceita um tipo por vez (`SPEC_TYPES`: `rsi_cross_up`, `rsi_below`, `macd_cross_up`, `ma_cross_up`, `price_cross_ma_up`, `bb_lower`, `breakout`) e `evaluateSetup` não é exportado. Testar combinações exige código novo, versão MINOR `argos-engine 1.2.0`, decisão de Michel, com CHANGELOG. Pode ir junto do v1.2 (7 setups novos), mas **com família de correção separada**.

Interface proposta (não implementada):

```js
{ type: 'confluence', members: [ids dos 8 setups do v1.1], window: 3, refractory: 12, iters: 100000 }
```

- `members` lista 2 ou 3 ids (ou **1 id**, o componente isolado, usado na comparação da condição 4), **restritos aos 8 ids do v1.1**, mesmo que o v1.2 acrescente setups. `window` é o número de candles **anteriores** incluídos na janela (3, portanto janela de 4 candles com o atual). `refractory` é o período refratário em candles (12). `iters` é o número de sorteios do teste de permutação (100.000).
- **Não colocar `confluence` em `SPEC_TYPES`:** `tests/pine-reader.test.js:463` exige que os tipos do leitor de Pine sejam iguais a `Object.keys(SPEC_TYPES)`, e mudar esse teste seria ajustar teste. Usar um ramo próprio em `analyzeSpec`, antes de `triggersFromSpec`, ou uma função exportada nova `confluenceTriggers(d, ind, members, window, refractory)`.
- Os gatilhos dos membros vêm de `detectSetups(d, ind)` (exportada, idêntica ao 1.1.0); zerar os gatilhos dos membros antes do índice 200 e só depois aplicar a confluência e o refratário.
- Parâmetro `iters` em `evaluateSetup`, com padrão 3.000: a paridade 72/72 e o estudo v1.1 ficam intactos, e `analyze()` não muda.
- **A versão 1.2.0 quebra cerca de 11 asserts** que fixam `argos-engine 1.1.0` (`tests/analyze-handler.test.js`, `previsao.test.js`, `proof-handlers.test.js`, `proof-verify`, `backup`, `db-*`, `termometro-status`). Atualizá-los para a nova versão é **mudança deliberada de versão, não ajuste de regressão**, e exige CHANGELOG, `npm run build:web` (`web/js/engine.js` é gerado) e a nota de que a versão gravada em previsões e no Termômetro muda. Decisão de Michel; pode ir junto do v1.2, com família separada.
- O script aplica `applyFamily` (Benjamini-Hochberg) à lista das 756 células; as de zero gatilhos saem com `pTwo` = 1 pelo próprio `permutationTest`.
- As saídas do estudo v1.1 têm de permanecer idênticas: `tests/legacy-parity.test.js` (72/72) e `tests/study-v1.1.test.js` continuam verdes. O script do estudo, só leitura sobre `engine/`, é escrito **depois** da aprovação desta ficha e rodado uma única vez.

## Como carimbar a data de forma independente

Depois da aprovação de Michel: canonizar o JSON com `lib/canonical.js`, registrar o SHA-256 no cabeçalho e fazer o commit. Uma prova independente (OpenTimestamps) exigiria um script novo, `tools/registrar-ficha.mjs`, sem tocar em `engine/`: hoje a prova só aceita previsões em `POST /api/previsoes` (`tools/ots-stamp.mjs` existe, mas não carimba fichas).

## Apêndice: as 84 combinações

**Os números deste apêndice são contagem de gatilhos brutos (soma nas 9 séries, janela de 4 candles, período refratário de 12 candles), limite superior do N efetivo; não são resultado.** Nenhuma taxa de acerto foi calculada. As somas fecham em 18.217 (pares) e 3.896 (trios).

### Pares (P01 a P28)

| Id | Setups (ids) | Nomes | Gatilhos somados nas 9 séries (janela de 4 candles, refratário de 12) |
|---|---|---|---|
| P01 | RSI_OVERSOLD, MACD_CROSS | RSI Oversold + MACD Bullish Cross | 747 |
| P02 | RSI_OVERSOLD, GOLDEN_CROSS | RSI Oversold + Golden Cross | 6 |
| P03 | RSI_OVERSOLD, BB_LOWER | RSI Oversold + Toque na Bollinger inferior | 995 |
| P04 | RSI_OVERSOLD, BREAKOUT_20 | RSI Oversold + Rompimento de 20 candles | 31 |
| P05 | RSI_OVERSOLD, EMA_PULLBACK | RSI Oversold + Pullback na EMA 20 | 2 |
| P06 | RSI_OVERSOLD, BULL_ENGULFING | RSI Oversold + Engolfo de alta | 1032 |
| P07 | RSI_OVERSOLD, HAMMER | RSI Oversold + Martelo | 276 |
| P08 | MACD_CROSS, GOLDEN_CROSS | MACD Bullish Cross + Golden Cross | 118 |
| P09 | MACD_CROSS, BB_LOWER | MACD Bullish Cross + Toque na Bollinger inferior | 531 |
| P10 | MACD_CROSS, BREAKOUT_20 | MACD Bullish Cross + Rompimento de 20 candles | 1690 |
| P11 | MACD_CROSS, EMA_PULLBACK | MACD Bullish Cross + Pullback na EMA 20 | 335 |
| P12 | MACD_CROSS, BULL_ENGULFING | MACD Bullish Cross + Engolfo de alta | 3740 |
| P13 | MACD_CROSS, HAMMER | MACD Bullish Cross + Martelo | 426 |
| P14 | GOLDEN_CROSS, BB_LOWER | Golden Cross + Toque na Bollinger inferior | 58 |
| P15 | GOLDEN_CROSS, BREAKOUT_20 | Golden Cross + Rompimento de 20 candles | 184 |
| P16 | GOLDEN_CROSS, EMA_PULLBACK | Golden Cross + Pullback na EMA 20 | 99 |
| P17 | GOLDEN_CROSS, BULL_ENGULFING | Golden Cross + Engolfo de alta | 306 |
| P18 | GOLDEN_CROSS, HAMMER | Golden Cross + Martelo | 14 |
| P19 | BB_LOWER, BREAKOUT_20 | Toque na Bollinger inferior + Rompimento de 20 candles | 102 |
| P20 | BB_LOWER, EMA_PULLBACK | Toque na Bollinger inferior + Pullback na EMA 20 | 151 |
| P21 | BB_LOWER, BULL_ENGULFING | Toque na Bollinger inferior + Engolfo de alta | 1669 |
| P22 | BB_LOWER, HAMMER | Toque na Bollinger inferior + Martelo | 598 |
| P23 | BREAKOUT_20, EMA_PULLBACK | Rompimento de 20 candles + Pullback na EMA 20 | 488 |
| P24 | BREAKOUT_20, BULL_ENGULFING | Rompimento de 20 candles + Engolfo de alta | 2685 |
| P25 | BREAKOUT_20, HAMMER | Rompimento de 20 candles + Martelo | 58 |
| P26 | EMA_PULLBACK, BULL_ENGULFING | Pullback na EMA 20 + Engolfo de alta | 1027 |
| P27 | EMA_PULLBACK, HAMMER | Pullback na EMA 20 + Martelo | 42 |
| P28 | BULL_ENGULFING, HAMMER | Engolfo de alta + Martelo | 807 |

### Trios (T01 a T56)

| Id | Setups (ids) | Nomes | Gatilhos somados nas 9 séries (janela de 4 candles, refratário de 12) |
|---|---|---|---|
| T01 | RSI_OVERSOLD, MACD_CROSS, GOLDEN_CROSS | RSI Oversold + MACD Bullish Cross + Golden Cross | 1 |
| T02 | RSI_OVERSOLD, MACD_CROSS, BB_LOWER | RSI Oversold + MACD Bullish Cross + Toque na Bollinger inferior | 87 |
| T03 | RSI_OVERSOLD, MACD_CROSS, BREAKOUT_20 | RSI Oversold + MACD Bullish Cross + Rompimento de 20 candles | 29 |
| T04 | RSI_OVERSOLD, MACD_CROSS, EMA_PULLBACK | RSI Oversold + MACD Bullish Cross + Pullback na EMA 20 | 0 |
| T05 | RSI_OVERSOLD, MACD_CROSS, BULL_ENGULFING | RSI Oversold + MACD Bullish Cross + Engolfo de alta | 387 |
| T06 | RSI_OVERSOLD, MACD_CROSS, HAMMER | RSI Oversold + MACD Bullish Cross + Martelo | 63 |
| T07 | RSI_OVERSOLD, GOLDEN_CROSS, BB_LOWER | RSI Oversold + Golden Cross + Toque na Bollinger inferior | 1 |
| T08 | RSI_OVERSOLD, GOLDEN_CROSS, BREAKOUT_20 | RSI Oversold + Golden Cross + Rompimento de 20 candles | 1 |
| T09 | RSI_OVERSOLD, GOLDEN_CROSS, EMA_PULLBACK | RSI Oversold + Golden Cross + Pullback na EMA 20 | 0 |
| T10 | RSI_OVERSOLD, GOLDEN_CROSS, BULL_ENGULFING | RSI Oversold + Golden Cross + Engolfo de alta | 5 |
| T11 | RSI_OVERSOLD, GOLDEN_CROSS, HAMMER | RSI Oversold + Golden Cross + Martelo | 2 |
| T12 | RSI_OVERSOLD, BB_LOWER, BREAKOUT_20 | RSI Oversold + Toque na Bollinger inferior + Rompimento de 20 candles | 8 |
| T13 | RSI_OVERSOLD, BB_LOWER, EMA_PULLBACK | RSI Oversold + Toque na Bollinger inferior + Pullback na EMA 20 | 2 |
| T14 | RSI_OVERSOLD, BB_LOWER, BULL_ENGULFING | RSI Oversold + Toque na Bollinger inferior + Engolfo de alta | 358 |
| T15 | RSI_OVERSOLD, BB_LOWER, HAMMER | RSI Oversold + Toque na Bollinger inferior + Martelo | 111 |
| T16 | RSI_OVERSOLD, BREAKOUT_20, EMA_PULLBACK | RSI Oversold + Rompimento de 20 candles + Pullback na EMA 20 | 0 |
| T17 | RSI_OVERSOLD, BREAKOUT_20, BULL_ENGULFING | RSI Oversold + Rompimento de 20 candles + Engolfo de alta | 21 |
| T18 | RSI_OVERSOLD, BREAKOUT_20, HAMMER | RSI Oversold + Rompimento de 20 candles + Martelo | 3 |
| T19 | RSI_OVERSOLD, EMA_PULLBACK, BULL_ENGULFING | RSI Oversold + Pullback na EMA 20 + Engolfo de alta | 1 |
| T20 | RSI_OVERSOLD, EMA_PULLBACK, HAMMER | RSI Oversold + Pullback na EMA 20 + Martelo | 0 |
| T21 | RSI_OVERSOLD, BULL_ENGULFING, HAMMER | RSI Oversold + Engolfo de alta + Martelo | 134 |
| T22 | MACD_CROSS, GOLDEN_CROSS, BB_LOWER | MACD Bullish Cross + Golden Cross + Toque na Bollinger inferior | 2 |
| T23 | MACD_CROSS, GOLDEN_CROSS, BREAKOUT_20 | MACD Bullish Cross + Golden Cross + Rompimento de 20 candles | 57 |
| T24 | MACD_CROSS, GOLDEN_CROSS, EMA_PULLBACK | MACD Bullish Cross + Golden Cross + Pullback na EMA 20 | 13 |
| T25 | MACD_CROSS, GOLDEN_CROSS, BULL_ENGULFING | MACD Bullish Cross + Golden Cross + Engolfo de alta | 58 |
| T26 | MACD_CROSS, GOLDEN_CROSS, HAMMER | MACD Bullish Cross + Golden Cross + Martelo | 2 |
| T27 | MACD_CROSS, BB_LOWER, BREAKOUT_20 | MACD Bullish Cross + Toque na Bollinger inferior + Rompimento de 20 candles | 55 |
| T28 | MACD_CROSS, BB_LOWER, EMA_PULLBACK | MACD Bullish Cross + Toque na Bollinger inferior + Pullback na EMA 20 | 6 |
| T29 | MACD_CROSS, BB_LOWER, BULL_ENGULFING | MACD Bullish Cross + Toque na Bollinger inferior + Engolfo de alta | 218 |
| T30 | MACD_CROSS, BB_LOWER, HAMMER | MACD Bullish Cross + Toque na Bollinger inferior + Martelo | 38 |
| T31 | MACD_CROSS, BREAKOUT_20, EMA_PULLBACK | MACD Bullish Cross + Rompimento de 20 candles + Pullback na EMA 20 | 158 |
| T32 | MACD_CROSS, BREAKOUT_20, BULL_ENGULFING | MACD Bullish Cross + Rompimento de 20 candles + Engolfo de alta | 952 |
| T33 | MACD_CROSS, BREAKOUT_20, HAMMER | MACD Bullish Cross + Rompimento de 20 candles + Martelo | 30 |
| T34 | MACD_CROSS, EMA_PULLBACK, BULL_ENGULFING | MACD Bullish Cross + Pullback na EMA 20 + Engolfo de alta | 156 |
| T35 | MACD_CROSS, EMA_PULLBACK, HAMMER | MACD Bullish Cross + Pullback na EMA 20 + Martelo | 2 |
| T36 | MACD_CROSS, BULL_ENGULFING, HAMMER | MACD Bullish Cross + Engolfo de alta + Martelo | 218 |
| T37 | GOLDEN_CROSS, BB_LOWER, BREAKOUT_20 | Golden Cross + Toque na Bollinger inferior + Rompimento de 20 candles | 2 |
| T38 | GOLDEN_CROSS, BB_LOWER, EMA_PULLBACK | Golden Cross + Toque na Bollinger inferior + Pullback na EMA 20 | 4 |
| T39 | GOLDEN_CROSS, BB_LOWER, BULL_ENGULFING | Golden Cross + Toque na Bollinger inferior + Engolfo de alta | 13 |
| T40 | GOLDEN_CROSS, BB_LOWER, HAMMER | Golden Cross + Toque na Bollinger inferior + Martelo | 4 |
| T41 | GOLDEN_CROSS, BREAKOUT_20, EMA_PULLBACK | Golden Cross + Rompimento de 20 candles + Pullback na EMA 20 | 20 |
| T42 | GOLDEN_CROSS, BREAKOUT_20, BULL_ENGULFING | Golden Cross + Rompimento de 20 candles + Engolfo de alta | 87 |
| T43 | GOLDEN_CROSS, BREAKOUT_20, HAMMER | Golden Cross + Rompimento de 20 candles + Martelo | 1 |
| T44 | GOLDEN_CROSS, EMA_PULLBACK, BULL_ENGULFING | Golden Cross + Pullback na EMA 20 + Engolfo de alta | 39 |
| T45 | GOLDEN_CROSS, EMA_PULLBACK, HAMMER | Golden Cross + Pullback na EMA 20 + Martelo | 0 |
| T46 | GOLDEN_CROSS, BULL_ENGULFING, HAMMER | Golden Cross + Engolfo de alta + Martelo | 8 |
| T47 | BB_LOWER, BREAKOUT_20, EMA_PULLBACK | Toque na Bollinger inferior + Rompimento de 20 candles + Pullback na EMA 20 | 9 |
| T48 | BB_LOWER, BREAKOUT_20, BULL_ENGULFING | Toque na Bollinger inferior + Rompimento de 20 candles + Engolfo de alta | 42 |
| T49 | BB_LOWER, BREAKOUT_20, HAMMER | Toque na Bollinger inferior + Rompimento de 20 candles + Martelo | 2 |
| T50 | BB_LOWER, EMA_PULLBACK, BULL_ENGULFING | Toque na Bollinger inferior + Pullback na EMA 20 + Engolfo de alta | 34 |
| T51 | BB_LOWER, EMA_PULLBACK, HAMMER | Toque na Bollinger inferior + Pullback na EMA 20 + Martelo | 5 |
| T52 | BB_LOWER, BULL_ENGULFING, HAMMER | Toque na Bollinger inferior + Engolfo de alta + Martelo | 154 |
| T53 | BREAKOUT_20, EMA_PULLBACK, BULL_ENGULFING | Rompimento de 20 candles + Pullback na EMA 20 + Engolfo de alta | 247 |
| T54 | BREAKOUT_20, EMA_PULLBACK, HAMMER | Rompimento de 20 candles + Pullback na EMA 20 + Martelo | 3 |
| T55 | BREAKOUT_20, BULL_ENGULFING, HAMMER | Rompimento de 20 candles + Engolfo de alta + Martelo | 33 |
| T56 | EMA_PULLBACK, BULL_ENGULFING, HAMMER | Pullback na EMA 20 + Engolfo de alta + Martelo | 10 |

### Soma de gatilhos por série (janela de 4 candles, refratário de 12)

| Série | Pares (28) | Trios (56) |
|---|---|---|
| BTCUSDT 1h | 4.155 | 912 |
| BTCUSDT 4h | 1.962 | 442 |
| BTCUSDT 1d | 290 | 71 |
| ETHUSDT 1h | 4.252 | 926 |
| ETHUSDT 4h | 1.820 | 329 |
| ETHUSDT 1d | 249 | 36 |
| SOLUSDT 1h | 3.999 | 866 |
| SOLUSDT 4h | 1.317 | 282 |
| SOLUSDT 1d | 173 | 32 |
| Total | 18.217 | 3.896 |
