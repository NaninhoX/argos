# `POST /api/argos-ai`

Conversa completa do Argos AI numa chamada. O navegador monta o prompt e diz o recorte (`context`); o **servidor executa as ferramentas** (`lib/ai/tools.js`) sobre o motor e a série que ele mesmo carrega, guarda a chave do provedor de LLM, limita a taxa e verifica o texto final. Mudança do S5 (15/10/2026): antes o navegador executava as ferramentas e enviava os resultados, e quem tinha o código de acesso podia forjar um resultado com números inventados que a guarda numérica aceitaria. Agora o servidor recusa `tools`, mensagens `tool`, `tool_calls` e `tool_call_id` vindos do cliente.

## Requisição

Cabeçalhos: `content-type: application/json`; `x-argos-code` (código de acesso: o geral, `ARGOS_ACCESS_CODE`, ou um código de cliente da tabela `acessos`; ver "Acesso" abaixo).

```jsonc
{
  "messages": [                       // 1 a 64, só system, user e assistant em texto; a última é `user`
    { "role": "system", "content": "…" },
    { "role": "user", "content": "…" }
  ],
  "context": {                        // o recorte que as ferramentas consultam; mesmas regras do /api/analyze
    "symbol": "BTCUSDT", "timeframe": "4h",
    "cfg": { "mode": "atr", "tgt": 2, "stp": 1, "hold": 12 },   // opcional (padrão do motor)
    "windowDays": 365                                           // opcional (30 a 5000)
  },
  "stream": true                      // opcional; define só o formato da resposta
}
```

Corpo de até 400 mil caracteres. Campos fora dessa lista são ignorados: o cliente não escolhe modelo, parâmetros do provedor nem ferramentas.

## Ferramentas (catálogo fechado do servidor)

`obter_leitura_tecnica`, `consultar_banco_de_setups`, `detalhar_setup(setup_id)` e `verificar_vocabulario(texto)`. Nenhuma aceita ativo ou série como argumento: tudo vem do `context`. A série é carregada uma vez por requisição (base de candles quando há banco; senão snapshot mais Binance). Limites: 6 rodadas e 10 chamadas por requisição. Ferramenta fora do catálogo encerra a conversa (`invalid_tool_call`). Cada chamada é auditada (`tool_audit`, quando há banco; sempre no log): ferramenta, argumentos, hash do resultado, modelo e latência, sem texto gerado, IP nem chave. Ver "Auditoria e registro".

## Resposta `200`

Objeto `chat.completion` no formato da OpenAI, com `model: "argos-ai"` e um único resultado: texto final, `finish_reason: "stop"` (ou `"length"`, texto cortado), `message: { role, content }`. O texto já passou pela verificação e termina com o disclaimer padrão. Pedidos de ferramenta nunca voltam ao cliente. Quando alguma ferramenta usou o motor, a resposta traz `argos.data` (`source`, `lastCandle`, `candles`, `seriesHash`, `engine`, `symbol`, `timeframe`, `rule`, `windowDays` e `consulted`: lista de `{ tool, setupId?, resultHash }` com o SHA-256 de cada resultado entregue ao modelo) com a identificação da série que o servidor usou, para a tela comparar com a série que mostra (no SSE, vai no segundo bloco). Os números do relatório são sempre os do servidor.

Com `stream: true`, o mesmo conteúdo vem como `text/event-stream`: um `chat.completion.chunk` com o `delta` inteiro, um com o `finish_reason` e `data: [DONE]`. Não há transmissão em tempo real: o texto só sai depois de verificado.

## Verificação do texto final

1. **Guarda numérica** (`checkNumbers`): cada número do texto tem de ser o arredondamento, na precisão exibida, de um número presente nos resultados das ferramentas que o servidor executou (número JSON, número dentro de string ou de nome de chave). `%` e `p.p.` aceitam a fonte em fração ou em pontos; o sinal é ignorado. Exceções estruturais, configuráveis: marcador de lista ou título numerado, o 95 de "IC 95%", o limiar "0,05" em comparação e inteiro pequeno sem unidade (até 10). Número por extenso não é verificado. A guarda confere a origem do valor, não o papel dele na frase.
2. **Conformidade**: `scanText` de `lib/compliance.js`.
3. Reprovou: uma nova chamada ao provedor, com o texto recusado e o pedido de correção. Reprovou de novo: erro `refused`. O texto reprovado nunca é devolvido, nem em parte. O texto que acompanha um pedido de ferramentas também não é repassado.

## Erros

Corpo: `{ "error": "<mensagem em português>", "code": "<código>" }`. Os códigos são os que o cliente legado já trata.

| HTTP | `code` | Quando |
|---|---|---|
| 400 | `bad_request` | JSON ou campos inválidos |
| 401 | `unauthorized` | código de acesso ausente, incorreto, vencido ou revogado |
| 405 | `bad_request` | método diferente de POST |
| 413 | `prompt_too_large` | corpo acima do limite |
| 429 | `rate_limited` | mais de 30 requisições por minuto do mesmo IP (conferido antes do código de acesso); traz `retry-after` |
| 500 | `internal_error` | o verificador de conformidade falhou; nada é liberado |
| 502 | `refused` | texto reprovado duas vezes; `reason: { unknownNumbers, flaggedTerms }` traz só contagens |
| 502 | `tool_limit`, `invalid_tool_call` | o provedor pediu consultas demais ou uma ferramenta fora do catálogo |
| 502 | `empty_completion` | o provedor não produziu texto |
| 502 | `bad_request` | o provedor recusou o formato do pedido ou o modelo |
| 504 | `timeout` | a conversa passou de 100 s antes de nova chamada ao provedor |
| 503 | `data_unavailable` | o servidor não conseguiu carregar a série; nada foi calculado |
| 503 | `not_configured` | chave ou modelo do provedor ausentes; ou, em produção, sem `ARGOS_ACCESS_CODE` e sem nenhum código de cliente ativo (a rota falha fechada) |
| 503 | `unavailable` | o banco falhou ou passou do prazo (cerca de 500 ms) ao conferir um código de cliente: falha fechada, nada é liberado; o código geral não depende do banco |
| 503 | `provider_auth`, `insufficient_balance`, `rate_limited` | credencial recusada, conta sem saldo ou limite do provedor |
| 503 | `upstream_error` | provedor fora do ar, tempo esgotado (90 s por chamada) ou resposta ilegível |

Em qualquer erro, nenhum texto de LLM é devolvido; o relatório do motor não depende deste endpoint.

## Ambiente

| Variável | Uso | Padrão |
|---|---|---|
| `ARGOS_LLM_API_KEY`, `OPENAI_API_KEY` ou `DEEPSEEK_API_KEY` | chave do provedor, nesta ordem de precedência; só no servidor, nunca em resposta, erro ou auditoria | obrigatória |
| `ARGOS_LLM_BASE_URL` | endereço da API compatível com OpenAI | `https://api.openai.com/v1` (DeepSeek: `https://api.deepseek.com`) |
| `ARGOS_LLM_MODEL` | modelo | obrigatório com a OpenAI (depende da conta); `deepseek-chat` na DeepSeek |
| `ARGOS_ACCESS_CODE` | código geral, aceito em `x-argos-code` | sem código: fora de produção a rota fica aberta; em produção, só valem códigos de cliente |
| `ARGOS_IP_HASH_KEY` | chave do HMAC do IP (limite de chamadas no banco e `ip_hash` do `query_log`); a criar por Michel na Vercel | sem a chave: limite só em memória e `ip_hash` nulo |

## Acesso

`lib/acesso.js`. Vale o código geral (`ARGOS_ACCESS_CODE`) ou um código de cliente (tabela `acessos`, migração 002: só o SHA-256 fica no banco, com validade e revogação). Fora de produção (`VERCEL_ENV` diferente de `production`) e sem código geral, a rota fica aberta (desenvolvimento e testes). Em produção ela **falha fechada**: sem código geral e sem nenhum código de cliente ativo responde 503 `not_configured`; havendo código de cliente ativo, ele é aceito e qualquer outro valor dá 401. A conferência de código de cliente no banco tem prazo de cerca de 500 ms: se o banco falhar ou demorar, a rota responde 503 `unavailable` (falha fechada). O uso por cliente é contado por dia em `acessos_uso`, com o mesmo prazo; se passar dele, a chamada só deixa de ser contada. A identificação da chamada (`acessoRef`: `geral`, `acesso:<id>` ou `aberto`) vai ao log e ao `query_log`; o código nunca.

## Limite de taxa

30 requisições por minuto por IP (janela fixa), conferido antes do código de acesso e de qualquer chamada ao provedor. Um relatório consome de 3 a 5 requisições.

- **Com banco e com `ARGOS_IP_HASH_KEY`:** contador na tabela `limite_taxa` (`consumirLimite`, `lib/acesso.js`), comum a todas as instâncias. A chave é `argos-ai:` mais `hashDoIpParaLimite` (`lib/query-log.js`): HMAC-SHA256 do IP com o prefixo `limite|`, sem o mês, 32 hex. O IP nunca é gravado nem vira hash sem sal.
- **Sem a variável:** o limite cai para a memória da instância e **deixa de ser compartilhado entre instâncias**: em função serverless cada instância tem a própria contagem, então serve de freio, não de cota. Custo aceito de propósito; criar `ARGOS_IP_HASH_KEY` na Vercel é de Michel e volta a ser prioridade.
- **Banco fora do ar ou lento** (prazo de cerca de 500 ms): `consumirLimite` devolve `indisponivel: true` (não é excesso de uso) e o handler usa a memória da instância. Nunca libera a chamada sem limite.
- Com `deps.rateStore` injetado (testes), só a memória é usada.

## Auditoria e registro

`deps.audit(evento)` recebe, com `requestId` e horário `at`:

- `tool_call`: `toolCallId`, `name`, `arguments`, `model`, `latencyMs`, `resultHash`, `chars`, `context`. Não existe evento `tool_result`: o hash do resultado vai no próprio `tool_call`.
- `response`: `kind`, `status`, `code`, `attempts`, `durationMs`, `acessoRef`, `toolCalls`, `rejections` (e, em erro, detalhes como `provider` e `strayTools`).

Sem chave, sem IP, sem código de acesso, sem texto gerado. No handler puro, sem `deps.audit`, nada é emitido. A função `api/argos-ai.js` injeta a auditoria padrão: uma linha JSON por evento no log da função (`{"argos_ai": …}`) e, quando há `DATABASE_URL`, duas gravações:

- `tool_call` vira linha de `tool_audit` (`session_id` = `requestId`).
- `response` vira **uma linha de `query_log`** com `route` `/api/argos-ai`, `status`, `latency_ms` e `ip_hash` (HMAC com `ARGOS_IP_HASH_KEY`; nulo sem a chave). `params` leva só `requestId`, `acessoRef`, `toolCalls`, `codigo`, `tentativas` e `rejeicoes` (contagens: `tentativas`, `numerosSemOrigem`, `termosSinalizados`). Nunca texto gerado, prompt, código de acesso, texto de rejeição nem IP. O `requestId` liga a linha às de `tool_audit`. Entram também 401, 429, 4xx e 5xx que chegam ao handler. Não gera linha o 405 (método diferente de POST), que responde antes do handler. Retenção de 90 dias e limite de 500 ms de gravação, como em `lib/query-log.js`; falha de banco não derruba a resposta.

Leitura (só `select`; precisa de `DATABASE_URL`, rodada por Michel): `node tools/auditoria.mjs requisicao --id <uuid>` mostra a linha de `query_log` e as de `tool_audit` de uma requisição; `node tools/auditoria.mjs periodo --de AAAA-MM-DD --ate AAAA-MM-DD [--rota /api/argos-ai] [--linhas N]` traz totais, latência p50 e p95, status, códigos e chamadas de ferramenta (`--linhas`, no máximo 200, lista linhas individuais com o `ip_hash` cortado em 8 caracteres).

Estado: pronto em código; ainda não lido em produção.

## Teste real

Opcional e com custo, contra o deploy: `ARGOS_ACCESS_CODE=… node tools/teste-relatorio-real.mjs` (3 recortes; confere HTTP 200, seções, disclaimer, ferramentas e hash da série; imprime o texto para Michel ler). Exige crédito na conta do provedor; até lá nenhum relatório real foi gerado. `node tools/llm-smoke.mjs` é anterior à S5: ainda envia `tools` e resultados de ferramenta no corpo, que o servidor agora recusa com 400, então não serve como teste real.
