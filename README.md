# Argos

Motor estatístico (`argos-engine`) e serviços do Argos Sentinel e do Argos AI, da Stratum Research. A Stratum vende research e análise estatística: o Argos mede e descreve evidência, não recomenda operação.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `engine/` | Motor estatístico puro: entra série de candles e configuração, sai objeto determinístico. Sem rede, banco ou relógio. |
| `lib/` | Código de servidor reutilizável: hash canônico, Merkle, banco, repositórios, IA, conformidade (`lib/compliance.js`). Handlers puros em `lib/handlers/`. |
| `api/` | Funções da Vercel, finas: só adaptam requisição e resposta para os handlers. |
| `db/migrations/` | SQL puro, numerado, só para frente. A tabela `previsoes` é append-only. |
| `web/` | Front estático. |
| `data/` | Snapshot de candles da demo v1.1 (`snapshot-v1.1.json`). |
| `legacy/` | HTML original da demo v1.1, referência. Não editar. `legacy/blocks/` é gerado por `npm run extract` e não é versionado. |
| `tests/` | Testes com `node:test`, sem framework. |
| `tools/` | Scripts de linha de comando (servidor local, migrações, extração, linter de conformidade). |
| `docs/` | Documentação. Decisões de arquitetura em `docs/adr/`. |

## Como rodar

Requer Node 22 ou superior.

```
npm ci                    # instala as dependências
cp .env.example .env      # preencha os valores; o .env não é versionado
npm test                  # todos os testes (cerca de 15 segundos)
npm run test:fast         # pula os testes de paridade e de estudo
npm run lint:compliance   # linter de conformidade
npm run dev               # servidor local (web + api), em http://localhost:3000
```

No linter, um uso legítimo de termo acusado se suprime com um comentário na mesma linha: `compliance-ignore: motivo`.

## Limites permanentes

- Nenhuma saída diz ao usuário o que fazer com o dinheiro (comprar, vender, entrar, sair, tamanho de posição, preço-alvo); "alvo" e "stop" só aparecem como parâmetros da regra de saída do teste.
- Sem performance fee, sem custódia, sem acesso a conta ou carteira de cliente, sem promessa de retorno.
- O LLM nunca calcula nem inventa número: todo número exibido vem do motor.
- Nenhum dado de cliente vai ao provedor de LLM, e nenhuma chave fica no código (segredos só em variáveis de ambiente).
- Toda saída a cliente ou investidor leva o disclaimer padrão (`lib/compliance.js`); "Astra" e "DeepSeek V4.1" não são citados como produto ou benchmark.
