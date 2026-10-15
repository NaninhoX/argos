# `POST /api/argos-ai`

Conversa completa do Argos AI numa chamada. O navegador monta o prompt e diz o recorte (`context`); o **servidor executa as ferramentas** (`lib/ai/tools.js`) sobre o motor e a série que ele mesmo carrega, guarda a chave do provedor de LLM, limita a taxa e verifica o texto final. Mudança do S5 (15/10/2026): antes o navegador executava as ferramentas e enviava os resultados, e quem tinha o código de acesso podia forjar um resultado com números inventados que a guarda numérica aceitaria. Agora o servidor recusa `tools`, mensagens `tool`, `tool_calls` e `tool_call_id` vindos do cliente.

## Requisição

Cabeçalhos: `content-type: application/json`; `x-argos-code` (código de acesso, só exigido se `ARGOS_ACCESS_CODE` existir no servidor).

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

`obter_leitura_tecnica`, `consultar_banco_de_setups`, `detalhar_setup(setup_id)` e `verificar_vocabulario(texto)`. Nenhuma aceita ativo ou série como argumento: tudo vem do `context`. A série é carregada uma vez por requisição (base de candles quando há banco; senão snapshot mais Binance). Limites: 6 rodadas e 10 chamadas por requisição. Ferramenta fora do catálogo encerra a conversa (`invalid_tool_call`). Cada chamada é auditada (`tool_audit`, quando há banco; sempre no log): ferramenta, argumentos, hash do resultado, modelo e latência, sem texto gerado, IP nem chave.

## Resposta `200`

Objeto `chat.completion` no formato da OpenAI, com `model: "argos-ai"` e um único resultado: texto final, `finish_reason: "stop"` (ou `"length"`, texto cortado), `message: { role, content }`. O texto já passou pela verificação e termina com o disclaimer padrão. Pedidos de ferramenta nunca voltam ao cliente. Quando alguma ferramenta usou o motor, a resposta traz `argos.data` (`source`, `lastCandle`, `candles`, `seriesHash`) com a identificação da série que o servidor usou, para a tela comparar com a série que mostra (no SSE, vai no segundo bloco). Os números do relatório são sempre os do servidor.

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
| 401 | `unauthorized` | código de acesso ausente ou incorreto |
| 405 | `bad_request` | método diferente de POST |
| 413 | `prompt_too_large` | corpo acima do limite |
| 429 | `rate_limited` | mais de 30 requisições por minuto do mesmo IP; traz `retry-after` |
| 500 | `internal_error` | o verificador de conformidade falhou; nada é liberado |
| 502 | `refused` | texto reprovado duas vezes; `reason: { unknownNumbers, flaggedTerms }` traz só contagens |
| 502 | `tool_limit`, `invalid_tool_call` | o provedor pediu consultas demais ou uma ferramenta fora do catálogo |
| 502 | `empty_completion` | o provedor não produziu texto |
| 502 | `bad_request` | o provedor recusou o formato do pedido ou o modelo |
| 504 | `timeout` | a conversa passou de 100 s antes de nova chamada ao provedor |
| 503 | `data_unavailable` | o servidor não conseguiu carregar a série; nada foi calculado |
| 503 | `not_configured` | chave ou modelo do provedor ausentes |
| 503 | `provider_auth`, `insufficient_balance`, `rate_limited` | credencial recusada, conta sem saldo ou limite do provedor |
| 503 | `upstream_error` | provedor fora do ar, tempo esgotado (90 s por chamada) ou resposta ilegível |

Em qualquer erro, nenhum texto de LLM é devolvido; o relatório do motor não depende deste endpoint.

## Ambiente

| Variável | Uso | Padrão |
|---|---|---|
| `ARGOS_LLM_API_KEY`, `OPENAI_API_KEY` ou `DEEPSEEK_API_KEY` | chave do provedor, nesta ordem de precedência; só no servidor, nunca em resposta, erro ou auditoria | obrigatória |
| `ARGOS_LLM_BASE_URL` | endereço da API compatível com OpenAI | `https://api.openai.com/v1` (DeepSeek: `https://api.deepseek.com`) |
| `ARGOS_LLM_MODEL` | modelo | obrigatório com a OpenAI (depende da conta); `deepseek-chat` na DeepSeek |
| `ARGOS_ACCESS_CODE` | se existir, exige `x-argos-code` igual | sem código |

## Auditoria e limite de taxa

`deps.audit(evento)` (padrão: não faz nada) recebe, com `requestId` e horário `at`: `tool_result` (`toolCallId`, `resultHash`, `chars`), `tool_call` (`name`, `arguments`, `toolCallId`, `model`, `latencyMs`) e `response` (`kind`, `status`, `code`, `attempts`, `durationMs`, `rejections`). Sem chave, sem IP, sem código de acesso.

O limite de taxa é uma janela fixa em memória por IP (`deps.rateStore`, `deps.rateLimit`). Em função serverless cada instância tem a própria memória: serve de freio, não de cota. Um relatório consome de 3 a 5 requisições.

Teste real, opcional e com custo: `node tools/llm-smoke.mjs` (só roda com `DEEPSEEK_API_KEY`).
