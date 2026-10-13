# Plano da próxima sessão: CSS separado e motion design (v1-13/10)

Escrito em 13/10/2026 para ser executado na sessão seguinte. Decisões de Michel que valem aqui:

- Separar o CSS do `index.html`.
- Aplicar as 10 ideias de motion (5 na landing, 5 na plataforma).
- **Não enviar nada ao GitHub.** Haverá mais iterações antes do envio. Commit local pode; `git push` não.
- Não trocar o stack do front antes do aporte.

## Como começar a sessão

1. Ler `CLAUDE.md` e este arquivo. Não reler o front inteiro: usar as linhas indicadas abaixo e busca.
2. `git status -sb`: o esperado é `main` à frente de `origin/main` (commit `7f32a5e` e os seguintes, só locais).
3. `npm test`: a base é 501 testes passando. `node tools/compliance-lint.mjs`: sem achados.
4. Servidor local: `npm run dev` (ou o painel de pré-visualização, configuração em `../.claude/launch.json`).

## Estado do front hoje (medido em 13/10)

- `web/index.html`: um único `<style>` das linhas 11 a 1715 (cerca de 1.700 linhas de CSS) e 14 atributos `style=""` soltos.
- Marcos dentro do CSS: 1051 (troca de telas da plataforma), 1092 (tela Ao vivo), 1336 (Regime), 1352 a 1500 (landing: caso real, seções, como funciona, matriz de 72 testes, calibração).
- Já existem `web/css/extras.css` (registros e link) e `web/css/heatmap.css`.
- Movimento que já existe: três `@keyframes` (`livePulse` 1086, `blink` 1317, `pvSpin` 1681), 18 transições curtas de cor e borda, um bloco `prefers-reduced-motion` (1087) e a constante `REDUCED` em `web/js/live.js:12`.
- Marcação que as animações vão usar: herói em 1739, "como funciona" em 1775 (`ol.how-steps`, `.how-n`), matriz em 1836 a 1851 (`table.mx`, `#mxDetail`), cartões de calibração em 1886 (`figure.cal-card`), telas `#dash-live` 1958, `#dash-sandbox` 2109, `#dash-query` 2163, `#dash-regime` 2205, `#dash-calibration` 2232.
- Ganchos de JavaScript: `showPage` e `switchDashTab` em `web/js/nav.js:1` e `:16`; barras de intervalo `.civiz` montadas em `web/js/live.js:338`; células `button.hm-cell` em `web/js/heatmap.js`; texto "Carregando dados reais…" em `index.html:1966` e `platform.js:242`; evento `argos:analysis` disparado ao fim de cada análise.

## Regras do movimento (valem para as dez ideias)

1. **Sóbrio, com três famílias de movimento e só três.** Interface (troca de aba, clique): 160 ms, curva firme e curta. Revelação (seção, cartão, linha do herói): 240 a 360 ms, saída suave (`cubic-bezier(.2,.7,.2,1)`). Crescimento de dado (barra de intervalo, célula da matriz): 360 a 480 ms, aceleração progressiva. Sem ricochete, brilho, partículas ou tremor. O produto vende rigor.
2. **Só `transform` e `opacity`.** Nada que mude o layout durante a animação. Sem biblioteca externa e sem CDN: a demo tem de rodar sem internet.
3. **Número estatístico não conta de zero.** Taxa de acerto, p, IC, Brier e taxa-base aparecem prontos (com fade), porque um contador mostraria valores que o motor nunca calculou. Contador só para contagens inteiras (72 testes, 42.489 previsões, N de gatilhos), e termina exatamente no texto original.
4. **Sem JavaScript, tudo visível.** O estado inicial escondido só vale quando o `<html>` tem a classe `motion-ok`, posta pelo script. Conteúdo nunca depende da animação para aparecer.
5. **Desliga de três formas:** `prefers-reduced-motion`, parâmetro `?motion=off` na URL (serve para testar e como plano B na demo) e a constante `REDUCED` já usada no `live.js`.
6. **Uma vez por elemento.** Animação de entrada não repete ao rolar de volta. A do herói e a da matriz rodam uma vez por visita.
7. **Não atrasa o trabalho.** Nenhuma animação bloqueia clique, leitura por leitor de tela ou o cálculo do motor. Sequência inteira do herói em até 2,5 s.

## Lições do guia de motion (aiidelist.com/blog/opus-5-5-motion-design, lido em 13/10)

O guia trata de vídeo gerado por código (Remotion, HyperFrames, Canvas), não de animação de site, mas os princípios de direção servem aqui:

- **Uma frase por animação.** Antes de animar, escrever o que a pessoa deve entender ao fim. Herói: "o setup mais popular perdeu para o acaso, e o Argos publica isso". Matriz: "de 72 testes, quase nenhum resiste". Se a animação não serve à frase, sai.
- **Continuidade em vez de corte.** O movimento parece autoral quando um objeto já visível vira a ponte para o seguinte. Aplicação: o marcador da taxa-base do herói é o mesmo traço que reaparece nas barras de intervalo e na legenda da matriz; a linha do "como funciona" termina na borda do cartão da matriz.
- **Pausa intencional.** De 300 a 600 ms de quietude antes do veredito do herói e antes do destaque final da matriz. Movimento constante tira a ênfase.
- **Tempo mínimo de leitura.** Todo texto principal fica parado e legível por pelo menos 1,2 s antes da próxima mudança.
- **Curva conforme a função**, não uma predefinição para tudo (daí as três famílias da regra 1).
- **Lista do que não entra:** partículas, brilho, gradiente gratuito, rotação 3D sem motivo, tremor, elástico em tudo, ilustração genérica de SaaS.
- **Determinístico.** Nada de `Math.random` sem semente: a mesma página anima igual toda vez, o que também permite conferir por captura.
- **Conferir por quadros antes de dar por pronto.** Na Etapa 3, capturar cada sequência em instantes fixos (início, meio, pausa, fim) e olhar corte de texto, hierarquia e espaçamento, em vez de julgar só pelo resultado final. Para isso `ArgosMotion` aceita `?motion=freeze:<ms>`, que leva as sequências a um instante e para.

Ideia à parte, fora desta iteração: o mesmo método serve para um filme de 15 a 20 s do produto (MP4 gerado por código, com dados e telas reais) para abrir o pitch. Fica na fila, a decidir por Michel.

## Etapas

### Etapa 0 — Separar o CSS (eu, sozinho, antes de tudo)

Mecânica, sem mudar regra nenhuma.

- Cortar o `<style>` do `index.html` em arquivos dentro de `web/css/`, na ordem em que aparecem (a ordem importa para a cascata): `base.css` (variáveis, reset, tipografia, navegação, botões), `landing.css` (linhas de 1352 a 1715 mais o que for só do site antes disso), `platform.css` (telas da plataforma, 1051 a 1351, mais Sandbox, Query e Calibração). Conferir as fronteiras lendo os marcos; onde uma regra servir aos dois lados, fica em `base.css`.
- `index.html` passa a ter só `<link>`s, na mesma ordem. Os 14 `style=""` soltos viram classes só se for trivial; senão ficam.
- Conferência de que nada mudou: antes de cortar, rodar no navegador um script que grava o estilo computado de cerca de 40 seletores representativos (landing e as cinco telas); depois de cortar, rodar de novo e comparar. Mais uma captura de tela de cada tela.
- Teste novo em `tests/web-build.test.js`: `index.html` sem `<style>` embutido acima de um tamanho pequeno, e todo `href`/`src` local existe em disco.
- Commit local próprio ("CSS separado do index.html"), para a etapa de motion partir de uma base limpa.

### Etapa 1 — Fundação do movimento (eu)

- `web/css/motion.css`: variáveis de duração e curva; utilitários `[data-reveal]`, `[data-stagger]`; bloco único de `prefers-reduced-motion` e de `html.motion-off`.
- `web/js/motion.js` (script clássico, global `ArgosMotion`): liga `motion-ok` ou `motion-off`; aceita `?motion=off` e `?motion=freeze:<ms>`; `reveal()` com `IntersectionObserver`; `countUp(el)` só para inteiros; `stagger(container, seletor)`; `once(chave)` por visita. Funções puras exportadas para teste em Node (`tests/motion.test.js`: o contador termina no texto exato, formato pt-BR, recusa número com vírgula decimal).

### Etapa 2 — As dez ideias (dois agentes Sonnet 5.5 em paralelo, arquivos disjuntos)

**Agente da landing.** Dono de `web/index.html` (só a parte do site), `web/css/landing.css`, `web/css/landing-motion.css`, `web/js/landing-motion.js`.

| # | Ideia | Pronto quando |
|---|---|---|
| 1 | Herói que conta a história | As linhas do "caso real" entram em sequência (janela, gatilhos, taxa de acerto, IC, taxa-base, p, p ajustado) e o veredito entra por último; até 2,5 s; números aparecem prontos |
| 2 | Entrada das seções ao rolar | Cada seção e seus cartões entram com fade e 12 px de deslocamento, uma vez |
| 3 | Matriz dos 72 testes que se preenche | As células acendem em onda por coluna; as que resistem ao ajuste ganham o destaque no fim; a legenda acompanha; clicar numa célula continua funcionando durante e depois |
| 4 | Contadores | Só nas contagens inteiras da página; terminam no texto original |
| 5 | "Como funciona" que se desenha | A linha entre as quatro etapas se desenha e cada número (`.how-n`) acende na sua vez |

**Agente da plataforma.** Dono de `web/js/live.js`, `web/js/platform.js`, `web/js/nav.js`, `web/js/heatmap.js`, `web/css/platform.css`, `web/css/platform-motion.css`.

| # | Ideia | Pronto quando |
|---|---|---|
| 6 | Transição entre abas e entre ativos | Troca de tela com fade curto (160 ms), sem piscar e sem perder o foco do teclado; troca de ativo ou tempo gráfico esmaece os painéis enquanto recalcula |
| 7 | Barras de intervalo que crescem | Ao fim de cada análise, a faixa do IC cresce a partir da taxa-base e o ponto da taxa observada entra por último; não reanima na atualização automática de 60 s |
| 8 | Mapa setup × regime escalonado | As 40 células entram por linha, 20 ms entre elas; só quando o mapa entra na tela ou a pergunta muda |
| 9 | Esqueleto de carregamento | No lugar de "Carregando…": blocos com o formato do gráfico, da tabela e do detalhe; some sem salto de layout |
| 10 | Registro com retorno visual | Ao registrar, o hash aparece caractere a caractere em até 600 ms e o item novo entra destacado na lista de registros; o hash exibido é sempre o devolvido pelo servidor |

Regras para os dois: as sete regras acima; nenhum texto novo que soe a recomendação; `node --check`, testes próprios e `npm run test:fast` no fim; sem navegador, sem commit, sem push. Lançar só estes dois (o limite da sessão estourou com cinco em paralelo).

### Etapa 3 — Conferência (eu, no navegador)

- Cada uma das dez ideias vista em desktop (1280) e em celular (375).
- Com `?motion=off`: tudo aparece de imediato e nada fica escondido.
- Sem JavaScript de movimento (bloqueando `motion.js`): conteúdo visível.
- Console sem erros; nenhuma tarefa longa nova na thread principal durante as animações (medir com `PerformanceObserver` de `longtask`).
- Sandbox, Query, registro de veredito e link compartilhável continuam funcionando (repetir os quatro testes desta sessão).
- Suíte inteira e linter.

### Etapa 4 — Fecho

Commit local por etapa. `CHANGELOG.md` e `CLAUDE.md` atualizados. **Sem push.** Mostrar o resultado a Michel no servidor local e colher os ajustes para a iteração seguinte.

## Custo estimado

Etapa 0: meio dia. Etapa 1: duas horas. Etapa 2: os dois agentes, em paralelo. Etapa 3: uma a duas horas. Cabe numa sessão se a Etapa 0 não trouxer surpresa de cascata.

## Decisões de Michel (aprovadas em 13/10)

1. **Intensidade: sóbria**, como descrita nas regras acima.
2. **Fontes dentro do projeto: sim.** Na Etapa 0, baixar os arquivos `woff2` da Source Serif 4 e da JetBrains Mono (só os pesos usados: serif 400, 500, 600, 700 e itálico 400; mono 400, 500, 600) para `web/fonts/`, declarar com `@font-face` em `base.css` com `font-display: swap`, e tirar os `<link>` do Google Fonts de `index.html` e de `verificar.html`. As duas fontes têm licença SIL OFL, que permite hospedar; guardar o texto da licença em `web/fonts/`. Conferir que a página não faz mais nenhuma requisição a `fonts.googleapis.com` ou `fonts.gstatic.com`.
3. **Repetição: uma vez por visita** para o herói e a matriz.

## Riscos

- **Cascata do CSS.** Separar arquivos pode mudar a ordem das regras. A comparação de estilo computado da Etapa 0 existe para pegar isso.
- **Matriz da landing.** A tabela é gerada e colada no HTML; a animação tem de se prender às classes existentes, sem regenerar a tabela.
- **Dois donos no `live.js`.** Só o agente da plataforma mexe nele.
- **Prazo.** O congelamento de funções é 28/10. Se o motion consumir mais de uma sessão, o restante das iterações de front encosta no ensaio.

## Fila depois do motion (iterações seguintes, em ordem sugerida)

1. Endereço próprio para Sandbox, Query, Regime e Calibração (o link compartilhável hoje sempre abre em Ao vivo).
2. Teste em celular de ponta a ponta e da cópia para a área de transferência.
3. Números da capa gerados do estudo, com a data ao lado.
4. Motor em Web Worker com barra de progresso.
5. Comparar o mesmo setup em BTC, ETH e SOL.
6. Tour de quatro passos na primeira visita.
7. Formulário de contato (depende da revisão de LGPD).

## Pendências que não são de front (continuam com Michel)

- Variáveis na Vercel: `DEEPSEEK_API_KEY`, `CRON_SECRET`, `ARGOS_ACCESS_CODE`. Neon (`DATABASE_URL`) ficou para depois.
- Probabilidades das 12 hipóteses e ratificação dos 10 gatilhos com o LG (`05_Operacao_Compliance\Stratum_Calibracao_Plano_Gatilhos_v1-12-10.pdf`).
- Decidir como o investidor abre a demo: hoje o endereço da Vercel exige login.
- Levar ao advogado, junto do parecer CNPI, o botão "Levar para o TradingView… cria um alerta".
