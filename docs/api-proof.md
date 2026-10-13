# Prova de previsão — contrato (Sprint 1)

Fonte única para o servidor (`lib/previsao.js`, handlers, job de ancoragem) e para o front (botão "Registrar este veredito" e página `verificar.html`). Decisão de base: ADR 0005.

Cadeia de verificação, do registro até o Bitcoin:

```
registro (JSON canônico) --SHA-256--> hash da previsão (folha)
folha --caminho de Merkle (RFC 6962)--> raiz do dia
raiz do dia --consta no--> manifesto do dia (arquivo de texto)
manifesto --SHA-256--> digest carimbado no OpenTimestamps (.ots)
```

## 1. Registro canônico `argos.previsao/1`

O cliente nunca envia números. Ele envia a pergunta (ativo, tempo gráfico, regra de saída, setup); o servidor roda o motor e monta o registro só com a saída do motor.

```json
{
  "schema": "argos.previsao/1",
  "engine": "argos-engine 1.1.0",
  "origin": "demo",
  "originRef": null,
  "emittedAt": "2026-10-12T15:04:05.123Z",
  "input": { "symbol": "BTCUSDT", "timeframe": "4h", "cfg": { "mode": "atr", "tgt": 2, "stp": 1, "hold": 12 }, "windowDays": null },
  "data": { "candles": 9000, "from": "ISO", "to": "ISO", "warmupCandles": 200, "hash": "<sha256 da série>" },
  "resultHash": "<resultHash do resumo da análise>",
  "regime": { "...": "summary.regime.current, inteiro" },
  "base": { "rate": 0.31, "n": 5000 },
  "setup": { "...": "o item de summary.setups com o id pedido, inteiro" }
}
```

- `summary` é o corpo de `handleAnalyze` (`lib/analysis-summary.js`). `data` é `summary.data` sem `source`, `liveError` e `dbError` (a origem dos candles não entra no hash).
- `canonical = canonicalize(registro)` (`lib/canonical.js`, modo padrão: número não finito lança erro). `hash = sha256Hex(canonical)`.
- `emittedAt` é o relógio do servidor no momento do registro. A prova de data é a âncora, não este campo.

Linha em `previsoes`:

| coluna | valor |
|---|---|
| `setup_id`, `symbol`, `timeframe` | de `input` e `setup.id` |
| `params` | `{ cfg, windowDays }` |
| `prob` | `setup.winRate` se for número em [0, 1] e `setup.n > 0`; senão `null` |
| `base_rate`, `n`, `n_eff`, `verdict` | `setup.base`, `setup.n`, `setup.nEff`, `setup.verdict.key` |
| `bar_time` | `setup.lastTriggerTime` se `setup.activeNow`; senão `null` (só previsão com gatilho ativo recebe desfecho) |
| `data_cut` | `data.to` |
| `emitted_at` | `emittedAt` |
| `origin`, `origin_ref` | `'demo'` no endpoint público; `null` |
| `engine_version` | `engine` |
| `payload` | o registro |
| `hash` | `hash` |

## 2. `POST /api/previsoes`

Corpo JSON: `{ "symbol", "tf", "cfg"?: { "mode", "tgt", "stp", "hold" }, "windowDays"?, "setupId", "live"? }` (mesma validação de `/api/analyze`, mais `setupId` obrigatório e existente em `summary.setups`). Se `ARGOS_ACCESS_CODE` existir no ambiente, exige o cabeçalho `x-argos-code` (comparação em tempo constante).

Mesma pergunta sobre os mesmos dados não gera registro novo: se já existe previsão com o mesmo `origin`, `setup_id`, `symbol`, `timeframe`, `data_cut`, `params` e `payload->>'resultHash'`, devolve a existente.

Respostas:

- `201` (registro novo) ou `200` (já existia):

```json
{
  "id": "<uuid>", "hash": "<64 hex>", "inserted": true,
  "emittedAt": "ISO", "canonical": "<texto canônico exato>",
  "verifyUrl": "/verificar.html?id=<uuid>",
  "anchorPending": { "day": "2026-10-12", "expectedAfter": "2026-10-13T00:10:00.000Z" },
  "disclaimer": "<DISCLAIMER_PADRAO>"
}
```

- `400 requisicao_invalida`, `401 nao_autorizado`, `405 metodo_nao_permitido`, `503 banco_ausente` (sem `DATABASE_URL`), `503 dados_indisponiveis`. Erros no formato `{ "error": { "code", "message" } }`.

## 3. `GET /api/proof`

### 3.1 Por previsão: `?id=<uuid>` ou `?hash=<64 hex>`

```json
{
  "previsao": { "id", "hash", "emittedAt", "dataCut", "origin", "engine", "setupId", "symbol", "timeframe", "verdict", "supersedes": null },
  "canonical": "<texto canônico exato, refeito a partir do payload>",
  "hashOk": true,
  "anchor": null,
  "anchorPending": { "day": "2026-10-12", "expectedAfter": "2026-10-13T00:10:00.000Z" },
  "desfecho": null,
  "disclaimer": "<DISCLAIMER_PADRAO>"
}
```

Depois que o dia foi fechado, `anchorPending` é `null` e `anchor` é:

```json
{
  "day": "2026-10-12", "root": "<64 hex>", "nLeaves": 3, "leafIndex": 1,
  "proof": [ { "side": "L", "hash": "<64 hex>" } ],
  "status": "pendente | ancorada | confirmada | falhou",
  "manifest": "<texto exato do manifesto>",
  "manifestSha256": "<64 hex>",
  "manifestUrl": "/api/proof?day=2026-10-12&format=manifest",
  "otsUrl": "/api/proof?day=2026-10-12&format=ots"
}
```

`otsUrl` é `null` enquanto não há recibo. `desfecho`, quando existe: `{ "outcome", "ret", "bars", "barTime", "resolvedAt" }`. `404 nao_encontrado` se a previsão não existe; `400 requisicao_invalida` para parâmetro malformado.

### 3.2 Por dia: `?day=YYYY-MM-DD`

- sem `format`: `{ "day", "root", "nLeaves", "status", "leaves": ["<hash>", ...], "manifest", "manifestSha256", "manifestUrl", "otsUrl" }` (as folhas na ordem da árvore: qualquer pessoa refaz a raiz);
- `format=manifest`: `text/plain; charset=utf-8`, corpo = texto do manifesto, `content-disposition: attachment; filename="argos-raiz-<day>.json"`;
- `format=ots`: `application/octet-stream`, corpo = bytes do recibo, `content-disposition: attachment; filename="argos-raiz-<day>.json.ots"`; `404` se ainda não há recibo.

O handler puro devolve `{ status, headers, body }`; `body` pode ser objeto, string ou `Buffer`. O adaptador em `api/` usa `res.send` para string e `Buffer`.

## 4. Árvore e manifesto do dia

- Dia = data UTC de `emitted_at`. Folhas = hashes das previsões do dia, ordenadas por `emitted_at` e, no empate, por `hash`.
- Árvore RFC 6962 (`lib/merkle.js`): folha = SHA-256(0x00 ‖ hash), nó = SHA-256(0x01 ‖ esquerda ‖ direita). Caminho = lista `{ side, hash }` da folha para a raiz; `side` diz de que lado o irmão entra.
- Manifesto = `canonicalize({ schema: 'argos.raiz/1', day, nLeaves, root })`, sem quebra de linha no fim. `manifestSha256` = SHA-256 dos bytes UTF-8 desse texto. É esse digest que vai ao OpenTimestamps: quem baixa o manifesto e o `.ots` verifica com qualquer cliente OpenTimestamps (`ots verify argos-raiz-<day>.json.ots`, com o manifesto na mesma pasta).

## 5. `GET /api/cron/anchor` (agendado, `Authorization: Bearer <CRON_SECRET>`)

1. Para cada dia UTC já encerrado com previsões e sem linha em `provas_merkle`: calcula raiz e caminhos e grava `provas_merkle` (status `pendente`) e `previsao_prova`, numa transação.
2. Para cada dia com status `pendente` ou `falhou`: carimba `manifestSha256` com `stampDigest` (`lib/ots.js`), grava o recibo em `ots` e passa o status a `ancorada`; se nenhum calendário responder, `falhou`.
3. Previsão com `emitted_at` num dia já fechado e sem linha em `previsao_prova` é erro: entra em `orphans` no relatório, nunca é ignorada em silêncio.

Relatório: `{ "days": [ { "day", "nLeaves", "root", "status", "calendars": [], "error"? } ], "orphans": [], "errors": 0 }`; `207` se houve erro, `200` se não.

`confirmada` (recibo completo, com o bloco do Bitcoin) fica para depois da demo: o recibo `ancorada` já é verificável e completável por cliente externo (`ots upgrade`).

## 6. `lib/ots.js`

```js
stampDigest(digestHex, { calendars?, fetchImpl?, timeoutMs? })  // -> { ots: Buffer, calendars: string[], errors: { calendar, message }[] }; lança OtsError se nenhum calendário respondeu
buildOts(digestHex, responses /* Buffer[] */)                   // -> Buffer (.ots)
readOtsHeader(buf)                                              // -> { version, digest, timestamp /* Buffer */ }
```
