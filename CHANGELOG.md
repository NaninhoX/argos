# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/). Mudança na lógica estatística do motor exige entrada neste arquivo e nova versão.

## [Não lançado]

Nenhuma mudança na lógica estatística: o motor continua na versão 1.1.0.

### Alterado

- Motor extraído do HTML da demo para `engine/`, sem alteração de lógica, com teste de paridade contra o original (72 combinações de série e setup, mais a análise completa das 9 séries).
- Front da demo dividido em arquivos dentro de `web/`; o motor e os dados do navegador passam a ser gerados de `engine/` e `data/` por `npm run build:web`.

### Adicionado

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

### Segurança e conformidade

- Argos AI: regras do servidor antepostas a toda chamada; verificador de conformidade e disclaimer valem por padrão; em produção o endpoint não abre sem `ARGOS_ACCESS_CODE`; teto de tokens de saída; ferramenta não declarada pelo cliente é recusada; auditoria em log por padrão.
- Guarda numérica: notação científica, "por cento", dígitos de largura total e de outro alfabeto, percentual por extenso; hash em resultado de ferramenta deixa de ser fonte de número; "confiança de 95%" solto deixa de ser exceção.
- Conformidade: em regra verbal, a negação só vale dentro da mesma oração ("Não hesite, compre agora" passa a ser acusado); regras novas para instrução em forma branda e para alvo ou stop em preço sem separador de milhar.
- Sandbox e Query fechados com aviso "em construção" (`FEATURES` em `web/js/platform.js`).

### Limites conhecidos

- O cron de candles roda uma vez por dia (00:05 UTC): o plano gratuito da Vercel recusa cron mais frequente que diário. No plano pago volta a `5 * * * *`. Enquanto isso, a base de candles pode estar até um dia atrás; sem banco, a análise usa snapshot mais Binance ao vivo e não é afetada.

- As ferramentas do Argos AI ainda rodam no navegador: quem tem o código de acesso pode fabricar um resultado de ferramenta. Correção planejada: ferramentas no servidor, sobre `/api/analyze`.
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
