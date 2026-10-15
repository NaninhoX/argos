# `GET|POST /api/analyze`

Roda o `argos-engine` no servidor sobre uma série de candles e devolve o resumo da análise. Não há LLM neste caminho.

## Requisição

| Parâmetro | Valores | Padrão |
|---|---|---|
| `symbol` | `BTCUSDT`, `ETHUSDT`, `SOLUSDT` | obrigatório |
| `tf` (ou `timeframe`) | `1h`, `4h`, `1d` | obrigatório |
| `mode` | `atr` (múltiplos do ATR) ou `pct` (percentual) | `atr` |
| `tgt`, `stp` | regra de saída do teste: alvo e stop, de 0 a 50 | `2`, `1` |
| `hold` | prazo máximo em candles, de 1 a 200 | `12` |
| `windowDays` | janela em dias (30 a 5000); o servidor soma 200 candles de aquecimento | série inteira |
| `live` | `0` não busca candles novos na Binance (com a base de candles ligada, o servidor ainda lê a base) | `1` |
| `source` | `snapshot` lê só o snapshot versionado: sem base de candles e sem Binance; resultado reprodutível e comparável com o do navegador | automático |

Em `POST`, o corpo JSON aceita os mesmos campos; a regra de saída pode vir em `cfg: { mode, tgt, stp, hold }`.

`alvo` e `stop` aqui são parâmetros do teste estatístico, não instrução de operação.

## Resposta `200`

```jsonc
{
  "engine": "argos-engine 1.1.0",
  "input": { "symbol": "BTCUSDT", "timeframe": "4h", "cfg": { "mode": "atr", "tgt": 2, "stp": 1, "hold": 12 }, "windowDays": null },
  "data": { "source": "database | live | snapshot", "candles": 19951, "from": "...", "to": "...", "warmupCandles": 200, "hash": "<sha256 dos candles>", "liveError": "só quando caiu para o snapshot" },
  "regime": { "current": { "regime": "LOW_VOL_RANGING", "label": "...", "confidence": 0.4, "since": "...", "bars": 12 }, "share": {}, "durations": {}, "transitions": {} },
  "base": { "rate": 0.265, "n": 19739 },
  "setups": [ { "id": "RSI_OVERSOLD", "n": 290, "nEff": 290, "winRate": 0.2069, "ci": [0.164, 0.257], "method": "wilson", "base": 0.265, "pTwo": 0.025, "q": 0.1, "family": 8, "verdict": { "key": "SEM_EDGE", "label": "Sem vantagem demonstrável" }, "byRegime": {}, "wf": {}, "lastTriggerTime": "..." } ],
  "calibration": { "n": 4551, "brier": 0.19, "brierRef": 0.19, "bss": -0.001, "ece": 0.033, "bins": [], "rolling": [], "status": {} },
  "technical": { "time": "...", "close": 0, "rsi": 0 },
  "resultHash": "<sha256 do resumo canônico>",
  "disclaimer": "…",
  "ms": 950,
  "cacheHit": false
}
```

- `q` é o p ajustado por Benjamini-Hochberg **dentro da família de 8 setups desta série**. O estudo de referência v1.1 ajusta sobre os 72 testes; os dois valores não são comparáveis.
- Números sem valor (amostra insuficiente) vêm como `null`, nunca como `NaN` ou zero.
- `data.hash` + `input.cfg` + `engine` determinam `resultHash`: a mesma série e a mesma regra dão o mesmo resultado.

## Erros

| Código HTTP | `error.code` | Quando |
|---|---|---|
| 400 | `requisicao_invalida` | parâmetro ausente ou fora da faixa |
| 405 | `metodo_nao_permitido` | método diferente de GET e POST |
| 503 | `dados_indisponiveis` | candles não puderam ser lidos; nenhum número é devolvido |

Se a Binance não responder, a resposta é `200` com `data.source = "snapshot"` e `data.liveError` preenchido: o resultado vale para os dados até o corte do snapshot.

## Resposta curta

`brief=1` devolve só `engine`, `input`, `data` e `resultHash` (mais `disclaimer`, `ms` e `cacheHit`). Serve para monitorar e para conferir que dois ambientes chegam ao mesmo resultado sem baixar o resumo inteiro.
