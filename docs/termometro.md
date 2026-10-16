# Termômetro: registro prospectivo diário

O Termômetro é a base da calibração pública: o motor registra, **antes** do resultado, a probabilidade que ele emite para cada gatilho em aberto, e depois grava o desfecho. Nada aqui calcula número novo. `p`, `r`, `n` e `w` vêm de `openPredictions` (`lib/prospective.js`, a mesma conta da calibração do motor, conferida por `tests/prospective.test.js`) e o desfecho vem de `A.outs`.

## O que o job faz

`lib/jobs/termometro.js`, uma vez por dia, para as 9 séries (BTC, ETH e SOL em 1h, 4h e 1d) com a regra de saída padrão (alvo 2×ATR, stop 1×ATR, 12 candles):

1. **Registra** uma previsão por gatilho **do último candle fechado** que tenha probabilidade (setup com pelo menos 10 gatilhos encerrados). Origem `termometro`, `origin_ref` = `ATIVO:TEMPO:SETUP:INSTANTE_DO_CANDLE`. O registro leva o resumo da análise e o bloco `prospective` (índice, `elapsedBars` = 0, instante, p, r, n, w). Gatilho mais antigo, ainda dentro da janela de 12 candles, **não** é registrado: o motor só dá desfecho com a janela inteira, mas alvo ou stop podem já ter sido atingidos, e o registro deixaria de ser "antes do resultado".
   Recusa (e anota no relatório, sem registrar nem resolver nada) a série que não veio do banco (`serie_fora_do_banco`: snapshot de fallback) ou que está atrasada em um candle ou mais (`serie_atrasada`).
2. **Resolve** as previsões do Termômetro sem desfecho cujo candle já tem desfecho no motor, gravando `WIN`, `LOSS` ou `TIMEOUT` com retorno e número de candles.

Idempotente: um gatilho tem no máximo uma previsão (trava de transação por `origin_ref`) e um desfecho (chave primária). Repetir o job não duplica nada.

## Onde roda

- Encadeado depois da ingestão de candles em `GET /api/cron/candles` (00h05 UTC), porque o plano gratuito da Vercel só aceita 2 crons e os dois já existem. Uma falha do Termômetro não derruba a ingestão: o status vira 207 e o relatório traz `termometro.error`.
- `GET /api/cron/termometro` roda só o Termômetro, com o mesmo `Authorization: Bearer <CRON_SECRET>`. No painel da Vercel, Settings, Cron Jobs, o botão **Run** do cron de candles dispara a cadeia inteira.
- Prazo: a função dura 60 s; o Termômetro para entre séries aos 50 s (`skipped` no relatório) e o dia seguinte retoma.

## Limites conhecidos

- Com um disparo por dia, só entra o gatilho do último candle de cada série: 1d fica completo, mas 4h cobre 1 de 6 candles e 1h cobre 1 de 24, e a amostra é enviesada para o fechamento das 00h UTC. Para cobrir todos os candles é preciso um disparo por candle (cron por hora no plano pago, ou um agendador externo chamando `/api/cron/termometro`). Até lá, a calibração do Termômetro vale como amostra, não como cobertura.
- O desfecho só é gravado se a janela de 12 candles não tem buraco de dados.
- A resolução usa os candles que o banco tem; candle corrigido pela fonte depois do registro não reescreve o registro (a tabela é append-only).
- A publicação do Termômetro (página pública, divulgação semanal) fica travada pelo parecer sobre CNPI. O job só registra.

## Painel de saúde: `GET /api/termometro/status`

Só contagens e datas (nenhuma probabilidade nem desempenho), para ver se o registro está vivo ou calado. Protegido pelo cabeçalho `x-argos-code` (`ARGOS_ACCESS_CODE`); em produção, sem a variável configurada, responde 503 (falha fechado). Resposta: `status` (`ok` ou `atencao`), `alerts`, `totals` (registros, resolvidos, em aberto, por resultado, início e último registro), `series` (por ativo e tempo gráfico), `candles` (último candle e última inserção por série, com o atraso em candles) e `perDay` (últimos 14 dias).

Alertas: `sem_registros`; `sem_candles`; `ingestao_parada` (último candle inserido há mais de `ARGOS_INGEST_MAX_AGE_H` horas, padrão 30, para cadência diária); `sem_registro_recente` (nenhum registro há mais de `ARGOS_REGISTRO_MAX_AGE_H` horas, padrão 72: com disparo diário, dias sem gatilho são normais, três seguidos são raros); `desfecho_atrasado` (janela de 12 candles fechada há mais de 3 candles e sem desfecho). Quando a cadência passar a ser por candle, baixe os limiares por variável de ambiente.

## Calibração interna (no painel de saúde)

O painel traz `calibration` com ECE, BSS, Brier e a curva por faixa das previsões **resolvidas**, pelo mesmo cálculo do motor (`calibSummary`): `p` é a probabilidade registrada, o acerto é 1 só para WIN (LOSS e TIMEOUT valem 0, como no motor) e a taxa-base é a registrada. Abaixo de 30 resolvidas o resultado é "insuficiente".

Ao lado vai `noise`: o ECE que um motor **perfeitamente calibrado** teria só por acaso com os mesmos `p` e o mesmo N (500 simulações, semente fixa; mediana e P90). Regra de leitura: ECE observado dentro do P90 = sem evidência de descalibração (`dentro_do_acaso`); acima = `acima_do_acaso`, investigar. Com N em torno de 140 o acaso sozinho já dá ECE de alguns pontos percentuais, então um "descalibrado" do motor com poucos dados não é conclusão. Faixas com menos de 30 casos vêm com `reliable: false`. É interna: a publicação continua travada pelo parecer sobre CNPI.
