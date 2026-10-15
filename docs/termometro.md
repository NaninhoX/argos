# Termômetro: registro prospectivo diário

O Termômetro é a base da calibração pública: o motor registra, **antes** do resultado, a probabilidade que ele emite para cada gatilho em aberto, e depois grava o desfecho. Nada aqui calcula número novo. `p`, `r`, `n` e `w` vêm de `openPredictions` (`lib/prospective.js`, a mesma conta da calibração do motor, conferida por `tests/prospective.test.js`) e o desfecho vem de `A.outs`.

## O que o job faz

`lib/jobs/termometro.js`, uma vez por dia, para as 9 séries (BTC, ETH e SOL em 1h, 4h e 1d) com a regra de saída padrão (alvo 2×ATR, stop 1×ATR, 12 candles):

1. **Registra** uma previsão por gatilho em aberto (janela de 12 candles ainda não completa) que tenha probabilidade (setup com pelo menos 10 gatilhos encerrados). Origem `termometro`, `origin_ref` = `ATIVO:TEMPO:SETUP:INSTANTE_DO_CANDLE`. O registro leva o resumo da análise e o bloco `prospective` (índice, instante, p, r, n, w).
2. **Resolve** as previsões do Termômetro sem desfecho cujo candle já tem desfecho no motor, gravando `WIN`, `LOSS` ou `TIMEOUT` com retorno e número de candles.

Idempotente: um gatilho tem no máximo uma previsão (trava de transação por `origin_ref`) e um desfecho (chave primária). Repetir o job não duplica nada.

## Onde roda

- Encadeado depois da ingestão de candles em `GET /api/cron/candles` (00h05 UTC), porque o plano gratuito da Vercel só aceita 2 crons e os dois já existem. Uma falha do Termômetro não derruba a ingestão: o status vira 207 e o relatório traz `termometro.error`.
- `GET /api/cron/termometro` roda só o Termômetro, com o mesmo `Authorization: Bearer <CRON_SECRET>`. No painel da Vercel, Settings, Cron Jobs, o botão **Run** do cron de candles dispara a cadeia inteira.
- Prazo: a função dura 60 s; o Termômetro para entre séries aos 50 s (`skipped` no relatório) e o dia seguinte retoma.

## Limites conhecidos

- A cadência diária só vê gatilhos ainda em aberto no instante da execução. Em 1h, gatilhos que abrem e fecham entre duas execuções não entram. Com cron por hora (plano pago) a cobertura sobe.
- A resolução usa os candles que o banco tem; candle corrigido pela fonte depois do registro não reescreve o registro (a tabela é append-only).
- A publicação do Termômetro (página pública, divulgação semanal) fica travada pelo parecer sobre CNPI. O job só registra.
