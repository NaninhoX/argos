# ADR 0011 — Landing leve, plataforma sob demanda e cache imutável dos arquivos versionados

- Status: aceita (24/10/2026, Michel)
- Fonte: crítica de arquitetura de 24/10/2026 (medições abaixo)

## Contexto

Medido em produção em 24/10/2026, numa conexão rápida, abrindo só a landing:

- 40 requisições e 1,6 MB transferidos; `DOMContentLoaded` em 3,2 s.
- `data/snapshot.js` sozinho é 1,1 MB transferido (2,8 MB depois de descompactado), cerca de 70% do total. São as 9 séries completas, e a landing não usa nenhuma.
- `boot.js` chama `ArgosLive.init()` no carregamento: o motor analisa a série padrão, monta a tela Regime, faz 4 consultas à Binance e liga um relógio de 60 s, tudo antes de alguém abrir a plataforma.
- Todos os CSS, JS e dados saem com `Cache-Control: public, max-age=0, must-revalidate`, apesar de o deploy já pôr `?v=<hash>` em cada endereço (`tools/versionar-web.mjs`). Toda visita revalida tudo.
- `/api/analyze` e `/api/candles` respondem com `max-age=60` (só o navegador guarda); a CDN da Vercel não guarda nada e cada consulta acorda uma função.

## Decisão

1. **A landing não carrega a plataforma.** Na landing ficam só `tema.js`, `motion.js`, `landing-motion.js`, `nav.js`, `contato.js` e `tabela-72.js`. O resto (Lightweight Charts, motor, leitor de Pine, `live.js`, `platform.js`, `heatmap.js` e os dados) entra pela primeira vez que a pessoa abre a plataforma (botão Plataforma ou endereço `#ao-vivo`, `#sandbox` e afins), por um carregador único em `nav.js`, com o esqueleto de carregamento que já existe.
2. **Snapshot por série.** `tools/build-web.mjs` passa a gerar `web/data/snapshot/<SIMBOLO>_<tf>.js` (9 arquivos) em vez de um arquivo só, e a plataforma carrega só a série pedida. A tela Regime carrega as 3 séries diárias, que são as menores.
3. **Cache imutável para o que é versionado.** Em `vercel.json`, `headers`: `/css/*`, `/js/*` e `/data/*` com `public, max-age=31536000, immutable` (seguro porque todo endereço sai com `?v=<hash do conteúdo>` e o HTML continua `max-age=0`); `/fonts/*` com uma semana. `/api/analyze` e `/api/candles` ganham `s-maxage=60, stale-while-revalidate=300`, para a CDN responder consultas repetidas sem acordar a função.

## Opções consideradas

| | A. Manter como está | B. Sob demanda + snapshot por série + cache (esta) | C. Reescrever em framework (Next.js) com divisão automática |
|---|---|---|---|
| Complexidade | nenhuma | baixa: um carregador, mudança no build e regras de cabeçalho | alta: reescrita do front e do build |
| Custo | 0 | 2 a 3 dias de trabalho | semanas |
| Ganho na landing | 0 | de ~1,6 MB para ~0,3 MB (estimativa, a conferir depois) | parecido com B |
| Risco | celular em 4G espera vários segundos | baixo: o motor e as telas não mudam, só a hora em que carregam | alto, e contra a ADR 0001 (sem framework) |

## Consequências

- A primeira abertura da plataforma passa a pagar o carregamento que hoje a landing paga (com o esqueleto visível); a landing fica instantânea.
- Visitas seguintes não baixam nem revalidam CSS, JS e dados que não mudaram.
- `tests/web-static.test.js` precisa cobrir o carregador (todo arquivo que ele pede existe) e o novo formato do snapshot.
- O modo "dentro do Claude" (`IN_CLAUDE`) usa o snapshot embutido; decidir se esse modo continua (ver crítica) antes de mexer no carregador.

## Itens

1. [ ] Carregador sob demanda em `nav.js`; `boot.js` só roteia; `ArgosLive.init()` na primeira abertura.
2. [ ] Snapshot por série em `tools/build-web.mjs`; `live.js` e `platform.js` pedem a série ao carregador.
3. [ ] `headers` em `vercel.json` (estáticos imutáveis, fontes uma semana, `s-maxage` nas duas APIs).
4. [ ] Medir de novo em produção (mesma conexão) e registrar aqui o antes e o depois.
