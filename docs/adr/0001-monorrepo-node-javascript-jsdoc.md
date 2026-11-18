# ADR 0001 — Monorrepo Node/JavaScript em módulos ES, com tipos por JSDoc

- Status: aceita
- Fonte: plano de arquitetura (`Stratum_Arquitetura_Sistemas_Plano_Sprints_v1-11-10`), seção "Decisões de arquitetura", item 1

## Contexto

O motor estatístico já existe e está validado em 72 testes. Reescrevê-lo em outra linguagem descartaria essa validação.

## Decisão

Um único repositório em Node/JavaScript, com módulos ES (`"type": "module"`, Node 20 ou superior), tipos por JSDoc e `tsc --checkJs`. Não se troca de linguagem. Sem TypeScript, sem ORM e sem framework web.

## Consequências

- Há menos segurança de tipos do que em TypeScript completo. Reavaliar na V3.
- O `tsc --checkJs` ainda não está configurado: o `package.json` não tem `typescript` nas dependências. Quando entra: [a confirmar].
- Dependências são o mínimo necessário; acrescentar pacote exige motivo registrado.

**Nota de 18/11/2026:** a versão mínima do Node mudou. O `package.json` declara `"engines": { "node": ">=22 <25" }` e o CI roda Node 22 (`.github/workflows/ci.yml`, `node-version: 22`); o "Node 20 ou superior" do texto acima não vale mais. A decisão (JavaScript, módulos ES, JSDoc) segue como está. A versão usada na Vercel não está registrada no repositório: a confirmar no painel.
