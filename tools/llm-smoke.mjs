// Teste real do Argos AI contra o provedor de LLM. Opcional: só roda se DEEPSEEK_API_KEY existir (ambiente ou .env).
// Uso: node tools/llm-smoke.mjs
//
// Repete o laço do navegador (as ferramentas são executadas aqui) passando pelo handler de verdade: provedor,
// guarda numérica, verificador de conformidade e disclaimer. Faz de 2 a 6 chamadas ao provedor.
// Os números das ferramentas abaixo são fixos, de exemplo: não são resultado do motor nem leitura de mercado.
// A chave não é impressa. Código de saída: 0 (texto verificado ou teste pulado), 1 (falha).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleArgosAi } from '../lib/handlers/argos-ai.js';
import { scanText, withDisclaimer } from '../lib/compliance.js';
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '../lib/ai/provider.js';

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

if (!process.env.DEEPSEEK_API_KEY) {
  console.log('llm-smoke: pulado (DEEPSEEK_API_KEY ausente).');
  process.exit(0);
}

const FIXTURES = {
  obter_leitura_tecnica: { exemplo: true, ativo: 'BTC/USDT', tempo_grafico: '4H', indicadores: { rsi14: 41.3, adx14: 18.2, distancia_mm200_pct: -3.42 }, regime: { nome: 'Lateral de baixa volatilidade', confianca_pct: 62, criterio: 'ADX 18,2 (< 20, sem tendência definida) e volatilidade no percentil 38 (≤ 60).' }, risco: { atr_pct_do_preco: 1.87, cvar5_1candle_pct: -2.91 } },
  consultar_banco_de_setups: [
    { id: 'RSI_OVERSOLD', nome: 'RSI saindo de sobrevenda', gatilho_nos_ultimos_3_candles: true, n_com_desfecho: 290, taxa_acerto_pct: 20.7, ic95_pct: [16.4, 25.7], taxa_base_aleatoria_pct: 26.5, diferenca_pp: -5.8, p_bruto_bicaudal: 0.025, p_ajustado_bh: 0.1, testes_na_familia: 8, veredito: 'Sem vantagem demonstrável' },
    { id: 'BREAKOUT_20', nome: 'Rompimento da máxima de 20 candles', gatilho_nos_ultimos_3_candles: false, n_com_desfecho: 412, taxa_acerto_pct: 27.9, ic95_pct: [23.8, 32.4], taxa_base_aleatoria_pct: 26.5, diferenca_pp: 1.4, p_bruto_bicaudal: 0.5312, p_ajustado_bh: 0.7083, testes_na_familia: 8, veredito: 'Sem vantagem demonstrável' }
  ]
};
const tools = [
  { type: 'function', function: { name: 'obter_leitura_tecnica', description: 'Leitura técnica calculada pelo motor: indicadores, regime e risco.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'consultar_banco_de_setups', description: 'Setups testados pelo motor: N, taxa de acerto com IC 95%, taxa-base, p bruto, p ajustado e veredito.', parameters: { type: 'object', properties: {} } } }
];
const messages = [
  { role: 'system', content: 'Você é o Argos AI, camada de linguagem da Stratum Research. Escreva em português do Brasil e siga à risca as regras da mensagem do usuário.' },
  { role: 'user', content: [
    'Redija um resumo estatístico de 120 a 180 palavras sobre o recorte calculado pelo motor.',
    '1. Chame obter_leitura_tecnica e consultar_banco_de_setups.',
    '2. Escreva duas seções em Markdown: "## 1. Contexto de Regime" e "## 2. Teses em Avaliação".',
    'Regras: use somente números devolvidos pelas ferramentas, sem calcular nem estimar; não diga ao leitor o que fazer com o dinheiro dele; não prometa retorno; cite o p bruto e o p ajustado; quando a evidência for fraca, diga com clareza.'
  ].join('\n') }
];

const events = [];
const started = Date.now();
console.log('llm-smoke: provedor ' + (process.env.ARGOS_LLM_BASE_URL || DEFAULT_BASE_URL) + ' · modelo ' + (process.env.ARGOS_LLM_MODEL || DEFAULT_MODEL));

for (let round = 1; round <= 6; round++) {
  const t0 = Date.now();
  const out = await handleArgosAi({ body: { messages, tools }, ip: 'llm-smoke', code: process.env.ARGOS_ACCESS_CODE, env: process.env, deps: { scanText, withDisclaimer, audit: (e) => events.push(e) } });
  const last = events.at(-1) || {};
  console.log(`rodada ${round}: HTTP ${out.status} · ${last.kind || '?'} · ${last.attempts ?? '?'} chamada(s) ao provedor · ${Date.now() - t0} ms`);
  for (const r of last.rejections || []) console.log(`  tentativa ${r.attempt} reprovada: números sem origem [${r.unknownNumbers.join('; ')}] · termos [${r.flaggedTerms.join('; ')}]`);
  if (out.status !== 200) {
    console.log(`llm-smoke: FALHOU (${out.body.code}): ${out.body.error}`);
    if (last.provider) console.log('  provedor: ' + JSON.stringify(last.provider));
    process.exit(1);
  }
  const message = out.body.choices[0].message;
  if (!message.tool_calls) {
    console.log('\n' + message.content);
    console.log(`llm-smoke: ok em ${Date.now() - started} ms · ferramentas chamadas: ${events.filter((e) => e.type === 'tool_call').map((e) => e.name).join(', ') || 'nenhuma'}`);
    process.exit(0);
  }
  messages.push(message);
  for (const tc of message.tool_calls) {
    console.log('  ferramenta: ' + tc.function.name + ' ' + tc.function.arguments);
    messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(FIXTURES[tc.function.name] ?? { erro: 'ferramenta desconhecida: ' + tc.function.name }) });
  }
}
console.log('llm-smoke: FALHOU (limite de rodadas de ferramentas).');
process.exit(1);
