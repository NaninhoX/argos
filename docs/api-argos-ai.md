# `POST /api/argos-ai`

Rodada de conversa do Argos AI. O navegador monta o prompt e executa as ferramentas (o motor roda lá); o servidor guarda a chave do provedor de LLM, limita a taxa e verifica o texto final. O contrato é o do cliente legado (`makeServerSampler` em `legacy/blocks/06-live.js`, com `ARGOS_CONFIG.llm = 'server'`), que funciona sem alteração. Código: `api/argos-ai.js` → `lib/handlers/argos-ai.js` → `lib/ai/provider.js` e `lib/ai/numeric-guard.js`.

## Requisição

Cabeçalhos: `content-type: application/json`; `x-argos-code` (código de acesso, só exigido se `ARGOS_ACCESS_CODE` existir no servidor).

```jsonc
{
  "messages": [                       // 1 a 64; a última é `user` ou `tool`
    { "role": "system", "content": "…" },
    { "role": "user", "content": "…" },
    { "role": "assistant", "content": "", "tool_calls": [ { "id": "call_1", "type": "function", "function": { "name": "obter_leitura_tecnica", "arguments": "{}" } } ], "reasoning_content": "opcional" },
    { "role": "tool", "tool_call_id": "call_1", "content": "<JSON do resultado da ferramenta>" }
  ],
  "tools": [ { "type": "function", "function": { "name": "…", "description": "…", "parameters": { } } } ],  // opcional, até 16
  "stream": true                      // opcional; define só o formato da resposta
}
```

Corpo de até 400 mil caracteres. Campos fora dessa lista são ignorados: o cliente não escolhe modelo nem parâmetros do provedor.

## Resposta `200`

Objeto `chat.completion` no formato da OpenAI, com `model: "argos-ai"`. Em `choices[0]`:

- **pedido de ferramentas**: `finish_reason: "tool_calls"` e `message: { role, content: "", tool_calls: [...], reasoning_content? }`. O cliente executa as ferramentas, acrescenta a mensagem do assistente e uma mensagem `tool` por chamada, e envia de novo.
- **texto final**: `finish_reason: "stop"` (ou `"length"`, texto cortado) e `message: { role, content }`. O texto já passou pela verificação e termina com o disclaimer padrão.

Com `stream: true`, o mesmo conteúdo vem como `text/event-stream`: um `chat.completion.chunk` com o `delta` inteiro, um com o `finish_reason` e `data: [DONE]`. Não há transmissão em tempo real: o texto só sai depois de verificado.

## Verificação do texto final

1. **Guarda numérica** (`checkNumbers`): cada número do texto tem de ser o arredondamento, na precisão exibida, de um número presente nas mensagens `tool` da conversa (número JSON, número dentro de string ou de nome de chave). `%` e `p.p.` aceitam a fonte em fração ou em pontos; o sinal é ignorado. Exceções estruturais, configuráveis: marcador de lista ou título numerado, o 95 de "IC 95%", o limiar "0,05" em comparação e inteiro pequeno sem unidade (até 10). Número por extenso não é verificado. A guarda confere a origem do valor, não o papel dele na frase.
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
| 502 | `empty_completion` | o provedor não produziu texto |
| 502 | `bad_request` | o provedor recusou o formato do pedido ou o modelo |
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
