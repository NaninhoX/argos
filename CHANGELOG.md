# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/). Mudança na lógica estatística do motor exige entrada neste arquivo e nova versão.

## [Não lançado]

Nenhuma mudança na lógica estatística: o motor continua na versão 1.1.0.

### Alterado

- Front (24/10): estrutura da plataforma no padrão de produto corporativo. A partir de 1100 px as abas viram menu lateral fixo (item ativo marcado com fio dourado) e o topo ganha o caminho "Argos › tela" (`web/css/estrutura.css`, `web/js/estrutura.js`); abaixo disso nada muda. Na landing, a tabela dos 72 testes passa a ordenar por coluna (`aria-sort`), filtrar por veredito e por série, mostrar a contagem e exportar o recorte em CSV (`;` e BOM para o Excel em português) (`web/js/tabela-72.js`, testes em `tests/tabela-72.test.js`). A tabela continua no HTML: sem JavaScript, fica como antes. Sem mudança no motor.
- Front (23/10): tema Papel como padrão (a mesma paleta do vídeo explicativo: fundo creme `#F5F2EA`, tinta azul-noite, dourado só em fios e marcadores, links em azul) e tema escuro opcional no botão "Tema escuro" da barra inferior (`web/js/tema.js`, escolha guardada no navegador; `?tema=escuro` ou `?tema=papel` forçam). Cerca de 300 cores fixas do CSS viraram variáveis em `web/css/base.css`; texto corrido, rótulos e números passam da fonte de código para a fonte de interface do sistema (Segoe UI no Windows); a fonte de código fica em código, hashes e Pine, e a serifa no título da landing, na assinatura Stratum e no Relatório Estratégico. Botão principal azul-noite no Papel e dourado no escuro. Gráficos (Ao vivo e Calibração) e o mapa setup × regime leem as cores do tema e se redesenham na troca; o mapa ganha uma escala própria no Papel (do quase cinza a extremos de luminância 0,27, sempre com texto escuro de 5,7:1 ou mais), coberta em `tests/heatmap.test.js` nos dois temas. `verificar.html` segue o tema; `saude.html` (interna) continua escura. Sem mudança no motor.
- Termômetro por candle (19/10): agendamento do 1h passa de `6 * * * *` para `6,26 * * * *` (segunda chance dentro da janela de 30 minutos, porque o GitHub atrasa ou pula execuções); ajuste da leitura do horário no workflow; regra de rigor e limite de atraso inalterados. Sem mudança no motor.
- Ferramenta (18/10): `tools/teste-relatorio-real.mjs`, o roteiro do primeiro relatório real do Argos AI em produção (3 recortes). Confere HTTP 200, seções, disclaimer, linter de conformidade, ferramentas consultadas, recorte e hash da série igual ao de `/api/analyze`; imprime o texto para revisão humana. Código de acesso só pelo ambiente. Sem mudança no motor.
- Front (18/10): endereços de CSS e JS passam a levar `?v=<hash do conteúdo>` (`tools/versionar-web.mjs`, rodado no deploy depois de `build-web.mjs`; testes em `tests/versionar-web.test.js`). Quem já abriu a página não vê mais HTML novo com CSS antigo. Os HTML versionados só existem no deploy: o repositório guarda os endereços sem hash. Sem mudança no motor.
- Front, revisão de interface (17/10): correções de acessibilidade, texto e cor sem mudança de lógica. Título da seção de estudo agora diz "1 mostra vantagem e 1 mostra vantagem sensível a subperíodos" (antes "2 mostram vantagem"); "evidência insuficiente" padronizado; mensagens de erro do Argos AI e do registro de veredito sem detalhe de fornecedor, saldo, chave ou logs (o detalhe vai para `console.warn`); hashes da procedência inteiros, sem corte; landing sem rolagem lateral em 320 px (botão "Solicitar acesso" quebra linha); contraste do relatório e do detalhe da matriz acima de 4,5:1; borda de campos de formulário a 3:1 (`--control-line`); ponto verde "ao vivo" removido da aba (o selo de fonte já mostra o estado); rolagem suave respeita `prefers-reduced-motion` no Sandbox; 30 regras `:hover` dentro de `@media (hover: hover)`; abas do relatório viraram grupo de botões com `aria-pressed`; anel de foco nos pontos do gráfico de calibração. Segunda leva (17/10): `role="main"` nas duas páginas, modal Pine deixa o resto da página inerte (o Tab não escapa), `backdrop-filter` removido (barras mais opacas, custo menor no celular) e escala do heatmap sem estouro em 320 px. Pendências da revisão (canal de contato, "risk advisory" no rodapé, tamanhos de fonte em rem, relatório do Argos AI relido por leitor de tela) seguem abertas. Sem mudança no motor.
- Front (13/10): o CSS saiu do `index.html` para `web/css/base.css`, `landing.css` e `platform.css`, sem mudança de regra (mesmas 946 regras, mesma ordem relativa onde há disputa). Fontes Source Serif 4 e JetBrains Mono hospedadas em `web/fonts/` (SIL OFL 1.1): as páginas não chamam mais o Google Fonts.
- Front (13/10): "Carregando…" deu lugar a um esqueleto com o formato do conteúdo (tela Ao vivo, Sandbox e Query); a mensagem de status continua disponível para leitor de tela.
- Motor extraído do HTML da demo para `engine/`, sem alteração de lógica, com teste de paridade contra o original (72 combinações de série e setup, mais a análise completa das 9 séries).
- Front da demo dividido em arquivos dentro de `web/`; o motor e os dados do navegador passam a ser gerados de `engine/` e `data/` por `npm run build:web`.

### Adicionado

- Pré-registro do estudo v1.2 (18/10/2026), só documento: `docs/estudo-v1.2-pre-registro.md` e a ficha canônica `docs/estudo-v1.2-pre-registro.json` (SHA-256 no documento). Sete setups de indicadores populares (EMA 9/21, MACD linha zero, RSI 50, preço×SMA200, ADX/DI, Bollinger superior, Rompimento 55), 63 células novas, família de correção 135, regras fixadas antes de qualquer cálculo. A implementação exige versão MINOR do motor (1.2.0) e fica para depois de 31/10, por decisão de Michel. O motor não foi alterado.
- Cartão de pré-visualização da landing (18/10): `og:*`, `twitter:*` e `canonical` em `web/index.html` com o alias provisório `argossentinel.vercel.app` (trocar ao ter domínio próprio), imagem `web/img/og-argos.png` (1200×630) e `noindex, nofollow` mantido: o link gera cartão, mas a página fica fora dos buscadores até Michel decidir abrir. Roteiro para abrir (robots.txt, sitemap.xml) em `docs/seo-quando-abrir.md`. Sem mudança no motor.
- Formulário de contato na landing (17/10), em branch separado até haver endereço: `web/js/contato.js` (validação e montagem do `mailto:`), seção `#contato` com assunto, nome, e-mail, perfil, organização e mensagem (campos de 44 px, fonte de 16 px, erro por campo com resumo, foco no primeiro erro, cópia da mensagem como alternativa). Não envia nada ao servidor nem grava no banco (a regra "nenhum dado pessoal em tabela" se mantém); o destino é `ARGOS_CONFIG.contatoEmail` em `web/js/config.js`. Barra senha, chave, CPF e cartão no texto. `tests/contato.test.js`. Sem mudança no motor.
- Página interna `web/saude.html` (16/10): o painel de saúde do Termômetro em tela, para quem não usa terminal. O dono digita o código de acesso e vê alertas, registros, séries, candles, calibração interna e os últimos 14 dias. O código fica só em memória (não vai a storage, URL nem log), a página é `noindex` e não é linkada no site. Sem mudança no motor.
- Termômetro por candle, preparado e DESLIGADO (16/10): `?tf=1h|4h|1h,4h` em `/api/cron/candles` e `/api/cron/termometro` (ingestão e registro só desse tempo gráfico; sem `tf`, tudo como antes), workflow `termometro-por-candle.yml` do GitHub Actions (só disparo manual até o agendamento ser ligado; só HTTP 200 passa, 207 falha o job), `TERMOMETRO_ATRASO_MAX_MIN` (opcional: recusa `registro_tardio`), `ARGOS_POR_CANDLE` no painel (alerta `serie_atrasada_por_candle` por série) e `/api/cron/candles` passa a responder 207 também quando o Termômetro pula séries pelo prazo. Revisado pelo Opus antes de subir. Roteiro em `docs/termometro-por-candle.md`. Sem mudança no motor.
- Calibração prospectiva interna (16/10): o painel do Termômetro traz `calibration` (ECE, BSS, Brier e curva por faixa) sobre as previsões já resolvidas, com o mesmo cálculo do motor (`calibSummary`), e ao lado o ECE que um motor perfeitamente calibrado teria só por acaso com os mesmos p e N (simulação com semente fixa). Abaixo de 30 resolvidas: "insuficiente". Faixas com menos de 30 vêm marcadas como não confiáveis. Interna: a publicação continua travada pelo parecer sobre CNPI. Sem mudança no motor.
- `POST /api/previsoes` falha fechado em produção (16/10): sem `ARGOS_ACCESS_CODE` configurado, responde 503 e não grava (o registro é permanente e append-only), como o Argos AI já fazia.
- Relatório do motor com o bloco "Procedência dos números" (16/10): a aba Motor mostra motor, recorte, regra de saída, série (candles, último candle, fonte), hash da série e hash do resultado, calculados no navegador com o mesmo resumo do servidor (`ArgosSummary`), rotulado "Relatório do motor, sem IA". É o plano B da demo quando o relatório do Argos AI não está disponível. Sem mudança no motor.
- Painel de saúde do Termômetro (16/10): `GET /api/termometro/status`, protegido por código de acesso (falha fechado em produção). Contagens por série, por resultado e por dia, atraso dos candles e alertas de silêncio (ingestão parada, sem registro recente, desfecho atrasado), com limiares ajustáveis por ambiente. Sem número de probabilidade nem de desempenho. Sem mudança no motor.
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
