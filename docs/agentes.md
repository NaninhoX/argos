# Agentes do Relatório Estratégico (ciclo V3)

Pipeline determinístico com portão humano (ADR 0007). Nenhum agente aprova nada: o relatório só sai do estado `aguardando_aprovacao` com uma linha em `revisao_humana`, gravada por pessoa.

## Ordem

1. **Risco** (`lib/agents/risco.js`, `avaliarRisco`): regras em código sobre o que o motor já devolve. Sem LLM, sem limiar novo. Cada veto cita `campo`, `valor`, `limiar` e `fonteLimiar` (linha do motor). Estados da tese: `evidencia_insuficiente`, `sem_edge`, `veto_risco`, `em_avaliacao`.
2. **Provas** (`extrairProvas` em `lib/agents/montagem.js`): cada número que pode aparecer no relatório vira uma Prova `P<n>` com `origem: { resultHash, seriesHash, engine, caminho }`.
3. **Debate** (`lib/agents/debate.js`, `rodarDebate`): LLM só para prós, contras e Pré-Mortem das teses `em_avaliacao` ou `veto_risco`. Todo número do texto tem de estar nas provas; id citado tem de existir; `scanText` sem achado. Reprovou duas vezes, saldo insuficiente ou teto de chamadas: `status: 'falhou'`. `explicarVeto` cai num texto fixo se o LLM falhar.
4. **Montagem** (`montarRelatorio`): 6 seções fixas (Contexto de Regime, Teses em Avaliação, Debate, Avaliação de Risco e vetos, Cenário Teórico, Calibração), texto montado em código, disclaimer padrão, `relatorioHash` canônico. Bloqueia se algum número ficar sem prova, se o Debate falhou (seção 3) ou se houver termo proibido.
5. **Revisão** (`lib/agents/revisao.js`, `revisarRelatorio`): regras próprias, separadas de quem gerou. Recalcula o hash, confere cada prova contra os summaries (hash da série, hash do resultado e valor pelo caminho), número sem prova, conformidade, nível de preço (`technical.*`) e setups do estudo v1.2. O passo LLM é opcional e só acrescenta achados: nunca libera.
6. **Pipeline** (`lib/agents/pipeline.js`, `rodarPipeline`): grava uma linha por agente em `agent_runs` (tabelas da migração 001; sem migração nova). Estado `aguardando_aprovacao` só com Montagem ok e Revisão aprovada pelas regras; senão `bloqueado`.

Repositório: `lib/repo/agentes.js` (`inserirAgentRun`, `registrarRevisao`, `estadoRelatorio`, `runsDaRodada`, `reciboSemanal`), só INSERT e SELECT.

## Ferramenta

```
node tools/relatorio-estrategico.mjs gerar --serie BTCUSDT:4h [--serie ETHUSDT:4h] [--sem-llm] [--saida <arquivo fora do repositório>]
node tools/relatorio-estrategico.mjs estado --run <id>
node tools/relatorio-estrategico.mjs aprovar --run <id> --revisor <id interno> --decisao aprovado|aprovado_com_ajustes|rejeitado [--notas "..."]
node tools/relatorio-estrategico.mjs recibo --semana AAAA-MM-DD
```

Sem `DATABASE_URL`, roda em memória e não grava nada. Sem chave de LLM, age como `--sem-llm`: a seção 3 bloqueia quando há tese para debater. Os summaries vêm do snapshot versionado. Rodar contra o Neon de produção ou com chave real é decisão de Michel.

Saída real de 19/11/2026 (em memória, sem LLM): BTCUSDT 4h, 48 provas, `aguardando_aprovacao` (nenhuma tese elegível ao Debate); BTCUSDT 4h com ETHUSDT 4h, `bloqueado` na seção 3 (Debate sem provedor).

## Limites conhecidos (validação de 19/11/2026)

As regras de texto da seção 3 são listas, e lista não fecha tudo. Passam hoje: número escrito por extenso ("setenta por cento", "menos vinte"), nome de setup do v1.2 parafraseado ("banda de Bollinger superior" no lugar do nome exato) e conselho por sinônimo fora da lista ou depois de uma negação na mesma oração ("Não há dúvida de que vale ficar atento"). As seções 1, 2, 4, 5 e 6 não dependem de lista: a Revisão as regera e exige igualdade. Por isso a seção 3, a única escrita pelo LLM, passa sempre por leitura humana antes de aprovar.

## Decisões pendentes de Michel (implementado com o padrão conservador)

- D1: quebra estrutural e calibração `bad` vetam ou só avisam? Hoje: aviso.
- D2: vantagem sensível a subperíodos é veto ou aviso? Hoje: veto.
- D3: vetos sem limiar documentado (N efetivo baixo, IC cruzando a taxa-base, CVaR, recorte por regime com N pequeno, dado antigo). Hoje: não existem.
- D4: números sem faixa de incerteza (ECE, BSS, taxa-base, confiança do regime). Hoje: lista `ISENCOES_IC_PENDENTES`, marcada no texto.
- D5: família do p ajustado no relatório (8 setups da série ou 72 do estudo). Hoje: a da série, marcada no texto.
- D6: fonte da seção 5. Hoje: durações e transições de regime, em texto condicional.
- D7: limiares do Pré-Mortem. Hoje: só os que já estão nas provas.
- D8: teto de custo por rodada. Hoje: teto de chamadas; `cost_usd` nulo.
- D9: Debate falhou bloqueia ou a seção 3 sai como indisponível? Hoje: bloqueia.

Antes de qualquer relatório ir a cliente, as marcas "(decisão Dn pendente)" saem do texto, com a decisão tomada.
