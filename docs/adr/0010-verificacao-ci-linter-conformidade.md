# ADR 0010 — Verificação em CI: regressão dos 72 casos e linter de conformidade

- Status: aceita, com correção em relação ao texto original da fonte
- Fonte: plano de arquitetura (`Stratum_Arquitetura_Sistemas_Plano_Sprints_v1-11-10`), seção "Decisões de arquitetura", item 10

## Contexto

Os limites permanentes da Stratum (nunca recomendar, nunca prometer retorno, sempre o disclaimer) valem também para o que os agentes e o LLM escrevem. Só um teste automático garante isso em todo commit.

## Decisão

O CI roda, em todo push e pull request, `npm test` (que inclui a regressão dos 72 casos contra o original) e `npm run lint:compliance`.

O linter de conformidade (`tools/compliance-lint.mjs`, regras em `lib/compliance.js`) falha o build quando encontra **recomendação ou promessa** nos textos voltados ao usuário. Não proíbe as palavras "alvo" e "stop" em si: elas são vocabulário legítimo do produto quando descrevem a regra de saída do teste ("alvo 2×ATR, stop 1×ATR", "atingiu o alvo antes do stop"). O texto original da fonte listava "compre", "venda", "sinal", "alvo", "stop"; isto foi corrigido.

O que o linter acusa:

- instrução de operação: "compre", "venda agora", "recomendamos", "hora de entrar", "reduza a exposição", "abra a posição", "aloque";
- "sinal de compra" e "sinal de venda" (a palavra "sinal" sozinha não é acusada);
- preço-alvo e níveis de preço como instrução: "preço-alvo", "alvo sugerido", "stop sugerido", "alvo em US$ 70.000";
- promessa de retorno: "lucro garantido", "retorno de 8% ao mês", "risco zero";
- urgência e certeza: "não perca", "imperdível", "com certeza";
- "Astra" e "DeepSeek V4.1" citados como produto.

A base é a função `scanTerms` do cliente legado (`legacy/blocks/06-live.js`), portada com o mesmo vocabulário, mais os padrões imperativos e promissórios acima. Termo precedido de negação na mesma frase ("não recomendamos", "sem garantia") não é acusado.

Escopo: `web/**`, `lib/**/*.js`, `api/**/*.js` e `docs/public/**`. Ficam fora `legacy/`, `node_modules/`, `tests/`, `docs/adr/` e `lib/compliance.js`. Um uso legítimo se suprime com o comentário `compliance-ignore: motivo` na mesma linha; o motivo é obrigatório.

## Consequências

- O limite permanente vira teste automático e vale também para o que os agentes escreverem, desde que passe pelos mesmos arquivos ou por `assertCompliant`.
- O verificador é por expressões regulares, não semântico: pode acusar uso legítimo (supressão com motivo, que fica registrada) e deixar passar redação nova. Não substitui a revisão humana do ADR 0007.
- Listas de termos proibidos dentro de prompts e comentários são acusadas e precisam de `compliance-ignore`.
- `assertCompliant` e `withDisclaimer`, em `lib/compliance.js`, existem para a saída de servidor. Que os handlers e o Argos AI as apliquem a cada saída a cliente: [a confirmar].
- A fonte também previa falhar o build com "texto sem disclaimer". Esse teste não faz parte do linter atual: [a confirmar] se vira regra do CI.
