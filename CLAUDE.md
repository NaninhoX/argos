# Argos — repositório de código da Stratum Research

Motor estatístico (`argos-engine`) e serviços do Argos Sentinel / Argos AI. Você atua como arquiteto e engenheiro. O dono do produto é Michel (trate por "Senhor", português do Brasil, direto e seco).

## Limites permanentes (valem para código, textos, testes e saídas de LLM)

- A Stratum vende research e análise estatística. Nunca recomendação: nenhuma saída diz ao usuário o que fazer com o dinheiro (comprar, vender, entrar, sair, tamanho de posição, preço-alvo). "Alvo" e "stop" só aparecem como parâmetros da regra de saída do teste (ex.: "alvo 2×ATR, stop 1×ATR").
- Sem performance fee, sem custódia, sem acesso a conta ou carteira de cliente, sem promessa de retorno.
- O LLM nunca calcula nem inventa número. Todo número exibido vem do motor.
- Nenhum dado de cliente vai ao provedor de LLM. Nenhuma chave no código; segredos só em variáveis de ambiente.
- Toda saída a cliente ou investidor leva o disclaimer padrão (`lib/compliance.js`).
- Não citar "Astra" nem "DeepSeek V4.1" como produto ou benchmark. DeepSeek é só provedor de infraestrutura.

## Arquitetura

- `engine/` — módulo puro (sem rede, sem banco, sem relógio). Entra série de candles + configuração, sai objeto determinístico. Não alterar a lógica estatística sem registrar no `CHANGELOG.md` e subir a versão (SemVer).
- `lib/` — código de servidor reutilizável (hash canônico, Merkle, banco, IA, conformidade). Handlers puros em `lib/handlers/`.
- `api/` — funções da Vercel, finas: só adaptam requisição/resposta para os handlers.
- `db/migrations/` — SQL puro, numerado, só para frente. A tabela `previsoes` é append-only.
- `web/` — front estático. `legacy/` — HTML original da demo v1.1 (referência, não editar).
- `tests/` — `node:test`, sem framework. `tools/` — scripts de linha de comando.
- `docs/adr/` — decisões de arquitetura.

## Convenções

- Node ≥ 20, módulos ES (`"type": "module"`), JavaScript com JSDoc. Sem TypeScript, sem ORM, sem framework web.
- Identificadores em inglês; comentários e textos ao usuário em português. Seguir o estilo do arquivo vizinho.
- Dependências: o mínimo. Não acrescentar pacote sem necessidade clara; registrar o motivo no PR ou no relatório.
- Testes: `npm test` roda tudo; `node --test tests/<arquivo>` roda um. O teste de paridade com o legado é lento (dezenas de segundos).
- Nunca "ajustar" um teste de regressão para passar: diferença de resultado se investiga.

## Comandos

```
npm test                 # todos os testes (~20 s)
npm run lint:compliance  # linter de conformidade
npm run dev              # servidor local (web + api) em http://localhost:3000
npm run build:web        # gera web/js/engine.js e web/data/*.js a partir de engine/ e data/
npm run migrate          # aplica db/migrations (usa DATABASE_URL)
node tools/extract-html.mjs   # regenera legacy/blocks a partir do HTML original
```

## Front

`web/index.html` e `web/js/{nav,live,platform,boot}.js` são fonte editável (saíram do HTML legado por `tools/split-web.mjs`, uma vez). `web/js/engine.js`, `web/data/snapshot.js` e `web/data/study.js` são gerados: não editar. O front ainda calcula no navegador com o mesmo motor; o servidor expõe `/api/analyze` com resultado idêntico.

CSS em `web/css/`, nesta ordem (a ordem é a cascata): `fonts.css`, `base.css`, `landing.css` (tudo sob `#page-landing`), `platform.css`, `extras.css`, `heatmap.css`, `brand.css`, `motion.css`, `landing-motion.css`, `platform-motion.css`. `index.html` não tem `<style>` embutido (`tests/web-static.test.js`). Fontes em `web/fonts/` (SIL OFL), sem chamada a terceiros.

Movimento: `web/js/motion.js` (global `ArgosMotion`, carregado no `<head>`) e `web/css/motion.css`. Regras: três famílias (interface 160 ms, revelação 240–360 ms, crescimento de dado 360–480 ms); só `transform` e `opacity`; estado inicial escondido só sob `html.motion-ok`; número estatístico nunca conta de zero (`data-count` só aceita contagem inteira); sem biblioteca externa e sem acaso. Desliga com `prefers-reduced-motion` e `?motion=off`; `?motion=freeze:<ms>` congela as sequências num instante. `tests/motion.test.js` cobra essas regras em todo arquivo `*motion*`. O movimento da plataforma que não precisa mexer em `live.js` nem em `platform.js` fica em `web/js/platform-motion.js`, pendurado em dois eventos: `argos:screen` (nav.js, uma tela ficou visível) e `argos:result` (platform.js, resultado novo desenhado). Conferir animação no navegador com `?motion=freeze:<ms>` e capturas: o painel de pré-visualização não renderiza em tempo real.

Marca: Stratum Research é a casa, Argos Sentinel é o produto. Guia em `../_layout/marca/`; na web, `css/brand.css`, `img/stratum-simbolo.svg` e `favicon.svg`.

## Verificação que não pode regredir

- `tests/legacy-parity.test.js`: `engine/` é idêntico ao motor do HTML legado (72 combinações + análise completa das 9 séries).
- `tests/study-v1.1.test.js`: o motor reproduz o estudo publicado v1.1 inteiro: 72 células, p ajustado e veredito sobre os 72 testes, contagem 63/3/4/1/1 e calibração agregada (N 42.489, BSS, ECE).

- `tests/prospective.test.js`: a previsão prospectiva devolve os mesmos p e r da calibração do motor.

## Prova de previsão

Contrato em `docs/api-proof.md`. Cadeia: registro canônico → hash → caminho de Merkle → raiz do dia → manifesto → OpenTimestamps. O cliente nunca envia número: `POST /api/previsoes` roda o motor no servidor. `previsoes` é append-only; correção é linha nova. O recibo `.ots` sai de `lib/ots.js` (formato conferido contra a implementação de referência; não trocar por dependência).

## Desenvolvimento local

`.env` (fora do Git, modelo em `.env.example`) com `DATABASE_URL=pglite://memory` dá banco em memória ao `npm run dev`: registrar veredito e abrir `verificar.html` funcionam sem conta de banco. A configuração do painel de pré-visualização fica em `../.claude/launch.json`.

## Estado

Em 15/10/2026, em produção na Vercel (`argos-ramonmichel8-8330s-projects.vercel.app`, atrás do login da Vercel): banco real (Neon, `DATABASE_URL`; o build aplica a migração com `tools/migrate.mjs --if-configured`), prova de previsão com ancoragem diária, Termômetro registrando (`docs/termometro.md`; 6 registros reais em 15/10) e Argos AI com ferramentas no servidor (S5, `lib/ai/tools.js`, contrato em `docs/api-argos-ai.md`). Provedor de LLM: OpenAI por padrão (`ARGOS_LLM_API_KEY`, `OPENAI_API_KEY` ou `DEEPSEEK_API_KEY`; `ARGOS_LLM_MODEL` obrigatório); a chave está configurada, mas a conta está sem crédito, então **nenhum relatório real foi gerado**: dizer "configurado e integrado", nunca "rodando". Plano gratuito da Vercel: só cron diário e no máximo 2 crons. Não fazer `git push` sem Michel dizer "pode subir"; cada push novo pede nova autorização. Falta: endereço próprio por tela e teste no celular, motor em Web Worker, relatório real do LLM. Plano completo em `../04_Produto_Argos/Stratum_Arquitetura_Sistemas_Plano_Sprints_v1-11-10.pdf`. A Stratum ainda não tem CNPJ.
