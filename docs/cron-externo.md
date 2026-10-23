# Agendador externo: cron-job.org (decidido em 24/10/2026)

## Por que

O GitHub Actions atrasa ou pula horários agendados. O servidor recusa o registro do Termômetro que chega mais de 30 minutos depois do fechamento do candle (`registro_tardio`, variável `TERMOMETRO_ATRASO_MAX_MIN=30`). O plano gratuito da Vercel só aceita 2 agendamentos, e os dois já estão em uso; por isso o cron-job.org (serviço externo gratuito) chama os mesmos endereços na hora certa.

## Disparos a configurar

Todos são `GET`, com o cabeçalho `Authorization` descrito abaixo. Horário em UTC (sem horário de verão; Brasília é UTC-3, então 00:05 UTC são 21:05 em Brasília).

| Disparo | URL completa | Método | Horário (UTC) | De onde sai |
|---|---|---|---|---|
| Termômetro 1h | `https://argossentinel.vercel.app/api/cron/candles?tf=1h` | GET | minutos 6 e 26 de toda hora (00:06, 00:26, 01:06, 01:26 ...) | `.github/workflows/termometro-por-candle.yml` (`6,26 * * * *`, e a chamada com `tf=$TF`); `lib/handlers/cron-candles.js` |
| Termômetro 4h | `https://argossentinel.vercel.app/api/cron/candles?tf=4h` | GET | 00:09, 04:09, 08:09, 12:09, 16:09 e 20:09 | Bloco comentado `9 0,4,8,12,16,20 * * *` no workflow; `docs/termometro-por-candle.md`, passo 4 |
| Diário (os três tempos) | `https://argossentinel.vercel.app/api/cron/candles` (sem `tf`) | GET | 00:05 todo dia | `vercel.json` (`5 0 * * *`); `lib/handlers/cron-candles.js` (sem `tf` roda 1h, 4h e 1d) |

Notas:
- O 4h só entra depois de 24 h limpas do 1h. Crie o disparo quando for ligá-lo, não antes.
- O diário já roda pela Vercel. O do cron-job.org é o reserva: a Vercel só garante "dentro da hora", e um atraso maior faz o 1d e o 4h das 00:00 UTC serem recusados.
- O `/api/cron/anchor` (00:10 UTC) não é do Termômetro. Continua só na Vercel.

**Cabeçalho (igual em todos os disparos):** `Authorization` com o valor `Bearer ` (a palavra Bearer, um espaço) seguido do valor da variável `CRON_SECRET`. O valor é o mesmo que está na Vercel. Não cole o valor em chat, e-mail, print ou arquivo do repositório.

**Respostas:**

| Código | O que quer dizer | O que fazer |
|---|---|---|
| 200 | Tudo certo: candles atualizados e nenhuma recusa no Termômetro. No disparo das :26, `registered: 0` é normal quando o das :06 já registrou. | Nada. |
| 207 | Rodou, mas algo foi recusado: registro tardio (mais de 30 min após o fechamento), série atrasada, série fora do banco, erro, ou série pulada pelo tempo. | Abra `/api/termometro/status` e leia `alerts`. Um 207 no disparo das :06 não é perda se o das :26 deu 200 e registrou o candle. |
| 401 | O cabeçalho `Authorization` falta ou tem outro valor. | Confira o cabeçalho no cron-job.org e o valor de `CRON_SECRET` na Vercel. |

Outros códigos que não devem aparecer com estas URLs: 400 (horário `tf` inválido) e 503 (banco não configurado).

## Passo a passo no cron-job.org

Quem faz tudo isto é o Michel. Ninguém mais deve mexer na conta.

1. Crie a conta no cron-job.org com o e-mail do Michel.
2. Escolha a opção de criar um novo agendamento (job).
3. Dê um título que diga o disparo, por exemplo "Termômetro 1h".
4. No campo de URL, cole a URL da tabela.
5. Em método, escolha `GET`.
6. Na aba de cabeçalhos, adicione um cabeçalho chamado `Authorization`. No valor, escreva `Bearer ` e logo depois o valor de `CRON_SECRET`, copiado do painel de configurações do projeto na Vercel.
7. No campo de fuso horário, escolha UTC.
8. No campo de horário, marque os minutos e as horas da tabela. Para o 1h, são os minutos 6 e 26 de todas as horas.
9. Em tempo limite, use 90 segundos (é o que o workflow usa hoje). Se o serviço não aceitar esse valor, use o maior que ele permitir.
10. Ative a notificação por e-mail quando o disparo falhar.
11. Salve. Depois use a opção de executar agora, uma vez, e confira que a resposta é 200. Se der 207, leia o painel (seção "Como conferir").

Atenção: não sabemos ainda se o cron-job.org trata a resposta 207 como falha. Confira na primeira semana. Se tratar, o aviso do disparo das :06 pode chegar mesmo quando o das :26 deu 200. Isso não é emergência; confirme no painel.

## O que fazer com o workflow do GitHub depois

1. **Mantenha o agendamento do GitHub em paralelo por uma semana (7 dias).** O servidor ignora duplicata: em `lib/jobs/termometro.js`, antes de registrar, uma transação com trava (`pg_advisory_xact_lock`) procura o mesmo `origin_ref` e não grava nada se já existir (linhas 55 a 60; comentário de idempotência na linha 14). Então os dois disparos não criam registro duplicado.
2. **Depois da semana, desligue o agendamento do GitHub.** Comente o bloco `schedule` do workflow (um commit). Mantenha o disparo manual (`workflow_dispatch`), que serve para emergência.
3. **Não remova as variáveis `ARGOS_POR_CANDLE`, `ARGOS_INGEST_MAX_AGE_H`, `ARGOS_REGISTRO_MAX_AGE_H` e `TERMOMETRO_ATRASO_MAX_MIN` da Vercel.** Elas valem enquanto o disparo por candle estiver ligado, seja qual for o agendador. O texto de `docs/termometro-por-candle.md` manda remover ao desligar o GitHub; isso só vale se nenhum outro agendador estiver rodando.
4. Não altere o workflow nesta etapa.

## Monitor externo

Michel escolhe o serviço: UptimeRobot ou Better Stack. Ambos têm plano gratuito.

- Tipo: monitor de site (HTTP).
- Endereço: `https://argossentinel.vercel.app/api/health`.
- Intervalo: 5 minutos.
- Alerta: e-mail quando ficar fora do ar.

O que `/api/health` devolve (`lib/handlers/health.js`): com status 200, um JSON com `ok` (true), `engine` (versão do motor), `time`, `snapshotCut` (data do snapshot de dados), `database` (`configurado` ou `ausente`, só diz se a variável existe) e `llm` (`configurado` ou `ausente`). Se os dados de base não carregarem, responde 503 com `ok: false`.

Conta como fora do ar: qualquer resposta diferente de 200 (503, 500, 404) ou nenhuma resposta dentro do tempo limite do monitor.

Este monitor não vê se o Termômetro parou. Isso é o painel de status, na seção abaixo.

## Como conferir que funcionou

Abra `https://argossentinel.vercel.app/saude.html`, digite o código de acesso e toque em Consultar; ou chame `GET /api/termometro/status` com o cabeçalho `x-argos-code` (valor de `ARGOS_ACCESS_CODE`). Se `status` vier `ok`, não há alerta; se vier `atencao`, leia a lista `alerts`, e confira `lastRegisteredAt` e `candles` (atraso em candles por série).
