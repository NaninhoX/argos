# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/). Mudança na lógica estatística do motor exige entrada neste arquivo e nova versão.

## [Não lançado]

Nenhuma mudança na lógica estatística: o motor continua na versão 1.1.0.

### Alterado

- Front (13/10): o CSS saiu do `index.html` para `web/css/base.css`, `landing.css` e `platform.css`, sem mudança de regra (mesmas 946 regras, mesma ordem relativa onde há disputa). Fontes Source Serif 4 e JetBrains Mono hospedadas em `web/fonts/` (SIL OFL 1.1): as páginas não chamam mais o Google Fonts.
- Front (13/10): "Carregando…" deu lugar a um esqueleto com o formato do conteúdo (tela Ao vivo, Sandbox e Query); a mensagem de status continua disponível para leitor de tela.
- Motor extraído do HTML da demo para `engine/`, sem alteração de lógica, com teste de paridade contra o original (72 combinações de série e setup, mais a análise completa das 9 séries).
- Front da demo dividido em arquivos dentro de `web/`; o motor e os dados do navegador passam a ser gerados de `engine/` e `data/` por `npm run build:web`.

### Adicionado

- Trilha de auditoria do Argos AI (15/10): `argos.data` passa a trazer também `engine`, `symbol`, `timeframe`, `rule`, `windowDays` e `consulted` (cada consulta ao motor com o SHA-256 do resultado entregue ao modelo; `verificar_vocabulario` fica de fora por não ser fonte de número). A tela mostra o bloco "Procedência dos números" sob o relatório. Tudo vem do servidor, nada do modelo. Inspirado no posicionamento "auditável" de concorrentes institucionais; sem mudança no motor.
- Celular, revisão com capturas de aparelho real (15/10): (1) quebra de texto equilibrada em rótulos, títulos e selos (`text-wrap`); (2) barras de rolagem lateral escondidas nos contêineres que rolam (a rolagem por toque continua) e a aba aberta fica à vista na barra de abas; (3) mapa setup × regime com a coluna fixa opaca e mais estreita, sem células passando por trás; (4) datas: o navegador completa o snapshot com os candles novos da Binance e, se ela não responder, com a base da Stratum (`GET /api/candles?symbol=&tf=&since=`, só candles fechados). Calibração e Regime passam a buscar os candles novos ao abrir (antes ficavam em 26/09), e o Query ganha a opção "Base de candles (atual)", que é a padrão e dá o mesmo `resultHash` do servidor.

- `GET /api/analyze?source=snapshot` (15/10): lê só o snapshot versionado, sem a base de candles nem a Binance. O Query do navegador, na opção "Snapshot versionado (reprodutível)", passa a pedir isso, para que servidor e navegador leiam os mesmos candles e o `resultHash` seja comparável. Antes, com a base de candles ligada, o servidor lia 20.062 candles até 15/10 e o navegador 19.951 até 26/09, e o Query avisava "candles diferentes" (o aviso estava certo; o pedido é que estava errado).

- Endereço por tela (15/10): `#ao-vivo`, `#sandbox`, `#query`, `#regime` e `#calibracao` abrem a tela direto, atualizam a URL ao navegar e funcionam com o botão Voltar; sem hash, é o site. Mantém os parâmetros de pergunta (`?symbol=…`) e o `#plataforma` antigo. Teste de largura a 360 px nas cinco telas e no site: nenhuma passa da borda; o painel da regra de saída (Ao vivo) passou a abrir dentro da tela no celular.

- Termômetro (15/10): `lib/jobs/termometro.js` registra por dia a probabilidade do motor para cada gatilho em aberto (origem `termometro`) e grava o desfecho quando a janela fecha; encadeado em `/api/cron/candles` e disponível em `/api/cron/termometro`. Ver `docs/termometro.md`.
- Provedor de LLM: OpenAI como padrão (`ARGOS_LLM_API_KEY`, `OPENAI_API_KEY` ou `DEEPSEEK_API_KEY`; `ARGOS_LLM_MODEL` obrigatório); a DeepSeek continua aceita. Migração do banco aplicada no build (`tools/migrate.mjs --if-configured`). `web/js/config.js` liga o Argos AI de servidor nas páginas publicadas.
- Movimento (13/10): fundação em `web/js/motion.js` e `web/css/motion.css` e dez animações. No site: cartão do caso real em sequência com a marca das quatro camadas, entrada das seções ao rolar, matriz dos 72 testes em onda, contadores (só contagens inteiras) e a linha do "como funciona". Na plataforma: troca de tela, painéis que esmaecem enquanto o motor recalcula, barras de intervalo que crescem a partir da taxa-base, mapa setup × regime em escada, esqueleto de carregamento e retorno visual do registro. Nenhum número é calculado ou alterado pela animação; taxa, p, IC e Brier nunca contam de zero. Desliga com `prefers-reduced-motion` e `?motion=off`.
- Marca Stratum Research no front (13/10): símbolo no cabeçalho, assinatura no rodapé e na página de verificação, ícone da aba.
- Testes `tests/web-static.test.js` (sem CSS embutido, sem chamada a terceiros, arquivos citados existem) e `tests/motion.test.js` (contador só aceita inteiro e termina no texto original; só `transform` e `opacity`; sem acaso e sem biblioteca externa).
- Teste de reprodução do estudo de referência v1.1: as 48 células de 4h e 1D da matriz publicada conferem com o motor (N, N efetivo, taxa de acerto, IC, taxa-base e p bruto). As 24 de 1h aguardam a base de candles.
- `GET|POST /api/analyze`: motor no servidor, com hash dos candles e do resultado.
- `GET /api/health`.
- JSON canônico e hash (`lib/canonical.js`) e árvore de Merkle RFC 6962 (`lib/merkle.js`), base da prova de previsão.
- Esquema Postgres com `previsoes`, `desfechos` e `regimes` append-only (`db/migrations/001_init.sql`), camada de banco e repositórios.
- Verificador de conformidade textual (`lib/compliance.js`) e linter (`npm run lint:compliance`), a partir do vocabulário da demo.
- Servidor local (`npm run dev`) e fluxo de CI.
- Prova de previsão (contrato em `docs/api-proof.md`): `POST /api/previsoes` registra o veredito com hash canônico (o cliente envia só a pergunta; o servidor roda o motor); `GET /api/proof` devolve o registro, o caminho de Merkle, o manifesto do dia e o recibo `.ots`; `GET /api/cron/anchor` fecha o dia UTC anterior, carimba o manifesto no OpenTimestamps e completa os recibos com o bloco do Bitcoin.
- Cliente OpenTimestamps sem dependência (`lib/ots.js`), conferido contra a implementação de referência, e `tools/ots-stamp.mjs` para carimbar qualquer arquivo.
- Página pública `web/verificar.html`, que refaz no navegador o hash, o caminho de Merkle e o manifesto.
- Botão "Registrar este veredito" na tela Ao vivo.
- Recorte do banco de setups por regime de mercado (`lib/regime-view.js` e seletor na tela Ao vivo). É descritivo: sem p-valor por regime, com o rótulo "evidência insuficiente" abaixo de 10 gatilhos efetivos. O motor não mudou.
- Previsão prospectiva (`lib/prospective.js`): a probabilidade de um gatilho ainda em aberto, pela mesma conta da calibração do motor (equivalência testada gatilho a gatilho).
- `DATABASE_URL=pglite://memory` para desenvolvimento local sem conta de banco (`resolveDb`).

- Sandbox e Query concluídos e reabertos. Leitor de Pine Script em módulo testado (`lib/pine-reader.js`): lê RSI, MACD, cruzamento de médias, fechamento cruzando média, Bollinger inferior e rompimento de máxima em Pine v4 a v6, e recusa com motivo o que não consegue ler com exatidão (condições combinadas, ordens limit, mais de uma regra). O Query chama `GET /api/analyze` de verdade e compara o `resultHash` do servidor com o do navegador.
- `GET /api/analyze?brief=1`: só a identificação do resultado.
- Link compartilhável: ativo, tempo gráfico, regra de saída, setup e regime na URL (`web/js/url-state.js`).
- "Registros deste navegador": lista dos vereditos registrados, com hash, link da prova e estado do carimbo.
- Mapa setup × regime (`web/js/heatmap.js`): 8 setups × 5 regimes, cor pela diferença para a taxa-base do regime; descritivo, com N efetivo abaixo de 10 hachurado.
- Saem os rótulos de protótipo; rótulos de interface em português; contraste do texto secundário corrigido.

### Segurança e conformidade

- Argos AI, S5 (15/10): as ferramentas passam a rodar no servidor (`lib/ai/tools.js`), sobre o motor e a série que ele mesmo carrega; o cliente envia só o texto e o recorte (`context`). O servidor recusa `tools`, mensagens `tool` e `tool_calls` do cliente, o que fecha o caminho de forjar o resultado de uma ferramenta; a guarda numérica passa a conferir contra o que o servidor calculou. Contrato novo em `docs/api-argos-ai.md`; chamadas auditadas em `tool_audit` (só hash). Sem mudança na lógica estatística.
- Argos AI: regras do servidor antepostas a toda chamada; verificador de conformidade e disclaimer valem por padrão; em produção o endpoint não abre sem `ARGOS_ACCESS_CODE`; teto de tokens de saída; ferramenta não declarada pelo cliente é recusada; auditoria em log por padrão.
- Guarda numérica: notação científica, "por cento", dígitos de largura total e de outro alfabeto, percentual por extenso; hash em resultado de ferramenta deixa de ser fonte de número; "confiança de 95%" solto deixa de ser exceção.
- Conformidade: em regra verbal, a negação só vale dentro da mesma oração ("Não hesite, compre agora" passa a ser acusado); regras novas para instrução em forma branda e para alvo ou stop em preço sem separador de milhar.
- Sandbox e Query podem ser fechados com aviso numa linha (`FEATURES` em `web/js/platform.js`), se algo falhar perto da demo.

### Limites conhecidos

- O cron de candles roda uma vez por dia (00:05 UTC): o plano gratuito da Vercel recusa cron mais frequente que diário. No plano pago volta a `5 * * * *`. Enquanto isso, a base de candles pode estar até um dia atrás; sem banco, a análise usa snapshot mais Binance ao vivo e não é afetada.

- O Argos AI ainda não gerou relatório real em produção (a conta do provedor está sem crédito); o ciclo completo foi testado com provedor simulado.
- A guarda numérica não confere o papel do número na frase.

## [1.1.0] - 2026-09-27

Ajustes de método da v1.1.

### Alterado

- A taxa-base passou a vir de entradas aleatórias no mesmo período e com a mesma regra de saída, em 3.000 sorteios.
- Intervalo de confiança por Wilson; Bayes Beta(1,1) quando o N efetivo é menor que 25.
- Correção para múltiplos testes por Benjamini-Hochberg (FDR de 5%).
- O teste de Chow passou de preço em nível para log-retornos, com janela de 120 candles e quebra a 30 do fim.
- Calibração por BSS (Brier Skill Score) contra a taxa-base e por ECE, no lugar do Brier absoluto.
- Walk-forward com expurgo.
