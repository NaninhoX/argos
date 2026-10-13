# ADR 0006 — O LLM não calcula; guarda numérica rejeita número que não veio do motor

- Status: aceita
- Fonte: plano de arquitetura (`Stratum_Arquitetura_Sistemas_Plano_Sprints_v1-11-10`), seção "Decisões de arquitetura", item 6

## Contexto

A falha que mais pesa em due diligence é número inventado ou alterado pelo modelo de linguagem.

## Decisão

O LLM não calcula. Ele recebe apenas JSON produzido pelo motor. Uma guarda numérica rejeita qualquer número no texto que não esteja no retorno das ferramentas. Nenhum dado de cliente é enviado ao provedor de LLM, e a chave do provedor existe só no servidor.

## Consequências

- Bloqueia número que não veio do motor. Não confere o papel do número na frase: trocar dois números do motor de lugar, inverter um sinal ou dizer "abaixo de 0,05" de um p que está acima ainda passa. Esse resto fica com o teste adversarial (S5) e com a revisão humana.
- Limite conhecido até o S5: as ferramentas rodam no navegador, então quem tem o código de acesso pode fabricar um resultado de ferramenta. A correção é rodar as ferramentas no servidor, sobre `/api/analyze`.
- O texto fica mais seco, e uma resposta pode ser recusada pela guarda e refeita.
- Se o LLM estiver fora do ar, o sistema devolve só o resultado numérico, sem texto; nunca um número aproximado.
