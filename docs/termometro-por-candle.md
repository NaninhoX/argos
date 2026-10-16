# Termômetro por candle (cadência de 1h e 4h)

Hoje o Termômetro dispara uma vez por dia (00h05 UTC) e só enxerga o último candle de cada série: o 1h cobre 1 candle em 24 e o 4h, 1 em 6. Com disparo por candle, o registro prospectivo passa de ≈ 60 para ≈ 660 previsões por mês (estimativa medida sobre 55 meses de histórico, com o script `estimar-volume.mjs` da skill `stratum-previsoes-prospectivas`, na pasta do Projeto, fora deste repositório), e o relógio da evidência anda mais rápido. Cada dia sem isso é evidência que não se recupera.

## Como funciona

- `GET /api/cron/candles?tf=1h` (ou `4h`, ou `1h,4h`) ingere os candles novos **só desse tempo gráfico** e roda o Termômetro **só nele**. Sem `tf`, tudo continua como antes (os três tempos), inclusive o cron diário da Vercel.
- `GET /api/cron/termometro?tf=...` roda só o Termômetro, com o mesmo filtro.
- `tf` inválido responde 400, e só depois da autorização (sem o segredo, 401). Mesma proteção: `Authorization: Bearer <CRON_SECRET>`.
- Quem chama é o GitHub Actions (`.github/workflows/termometro-por-candle.yml`): o plano gratuito da Vercel só aceita cron diário. O agendamento fica **desligado por padrão** (só disparo manual) até o segredo existir.
- As regras de rigor do Termômetro não mudam (`docs/termometro.md`): só o gatilho do último candle fechado, só com série do banco e em dia (menos de um candle de atraso), idempotente por gatilho. O atraso do GitHub (poucos minutos) cabe na tolerância de um candle; se passar, o job recusa a série (`serie_atrasada`) em vez de registrar, e o painel de saúde mostra.

## Passo a passo para ligar (quem executa é o Michel; ninguém além dele mexe em segredo)

1. No GitHub, repositório `NaninhoX/argos`: Settings, Secrets and variables, Actions, **New repository secret**: nome `CRON_SECRET`, valor igual ao `CRON_SECRET` da Vercel. Opcional: variável `ARGOS_BASE_URL` (padrão `https://argossentinel.vercel.app`).
2. Actions, **Termômetro por candle**, Run workflow, `tf = 1h`. Esperado: job verde, `HTTP 200`.
3. Conferir no painel (`GET /api/termometro/status`, com o código de acesso) que o disparo manual deixou o candle novo no banco e que o `status` está `ok`.
3b. **Só então, ao ligar o agendamento**, definir na Vercel `ARGOS_POR_CANDLE=1h` (acrescente `4h` quando ligar o do 4h), `ARGOS_INGEST_MAX_AGE_H=3` e `ARGOS_REGISTRO_MAX_AGE_H=12` (e, opcional, `TERMOMETRO_ATRASO_MAX_MIN=30`) e descomentar o bloco `schedule` do 1h (um commit). Acompanhar 24 h. Definir essas variáveis antes de haver agendamento deixaria o painel em alerta. Se desligar o agendamento depois, **remova as variáveis**, senão o alerta fica aceso para sempre.
4. Depois de 24 h limpas, descomentar o do 4h.
5. Se algo estranho aparecer, **desligar**: Actions, Termômetro por candle, `...`, Disable workflow (ou comentar o `schedule` de novo). O cron diário da Vercel continua.

## O que vigiar

- Painel de saúde: os limiares globais (`ingestao_parada`, `sem_registro_recente`) olham todas as séries juntas, então com o 1h vivo eles **não** acusam um job de 4h parado. Por isso existe `ARGOS_POR_CANDLE`: para os tempos gráficos listados, o painel alerta POR SÉRIE (`serie_atrasada_por_candle`) com 2 ou mais candles de atraso.
- Alertas: `ingestao_parada`, `sem_registro_recente`, `serie_atrasada_por_candle`, `desfecho_atrasado`, `calibracao_fora_do_acaso`.
- `TERMOMETRO_ATRASO_MAX_MIN` (opcional): recusa registrar (`registro_tardio`) quando já passou esse tempo desde o fechamento do candle; sem a variável, a tolerância continua de um candle. Recomendado 30 com a cadência por candle: um disparo manual a 55 minutos do fechamento deixaria o "antes do resultado" frouxo.
- O workflow só passa com HTTP 200: um 207 (recusa, erro ou série pulada pelo prazo) falha o job e o GitHub avisa por e-mail. O resumo do log tem só contagens, sem o corpo da resposta.
- Execuções do GitHub Actions que falham mandam e-mail ao dono do repositório. O GitHub pode atrasar ou pular execuções agendadas em horários de pico; o que for pulado é um candle sem registro (perda permanente daquele candle, não do histórico).
- Armazenamento no Neon: ≈ 660 linhas por mês, cada uma com payload (ver `bytesPorRegistro` na saída do estimador). Confirme o limite do plano.

## Limites

- Não é o plano pago da Vercel nem um cron "garantido": é um agendador gratuito e externo. Se a cobertura importar mais que o custo, o plano pago com cron por hora dá a mesma chamada com SLA melhor.
- A publicação do Termômetro continua travada pelo parecer sobre CNPI; isto só aumenta o que é registrado.
