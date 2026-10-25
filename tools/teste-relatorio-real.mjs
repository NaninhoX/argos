// Primeiro relatório real do Argos AI em produção, com conferência. Roda no dia em que houver crédito no provedor.
// Uso:   ARGOS_ACCESS_CODE=<código> node tools/teste-relatorio-real.mjs [url-base]   (padrão: https://argossentinel.vercel.app)
// O código de acesso vem do ambiente e nunca é impresso. Faz 3 conversas completas (cada uma, de 2 a 6 chamadas ao provedor).
//
// Para cada recorte confere: HTTP 200; texto com as duas seções e o disclaimer padrão no fim; nenhum achado do linter de
// conformidade; ferramentas realmente consultadas; recorte devolvido igual ao pedido; e o hash da série usado pela IA igual
// ao hash que /api/analyze devolve para o mesmo recorte (a IA leu a mesma série que a tela mostra).
// Não julga se o texto é bom: imprime o texto para a revisão humana (Michel) antes de qualquer uso. Código de saída 0 só se tudo passar.
import { scanText, DISCLAIMER_PADRAO } from '../lib/compliance.js';

const BASE = (process.argv[2] || 'https://argossentinel.vercel.app').replace(/\/$/, '');
const CODE = process.env.ARGOS_ACCESS_CODE;
const headers = { 'content-type': 'application/json', ...(CODE ? { 'x-argos-code': CODE } : {}) };
const CASOS = [
  { symbol: 'BTCUSDT', timeframe: '4h' },
  { symbol: 'ETHUSDT', timeframe: '4h' },
  { symbol: 'SOLUSDT', timeframe: '1h' }
];
const PEDIDO = [
  'Redija um resumo estatístico de 120 a 180 palavras sobre o recorte calculado pelo motor.',
  '1. Consulte a leitura técnica e o banco de setups.',
  '2. Escreva duas seções em Markdown: "## 1. Contexto de Regime" e "## 2. Teses em Avaliação".',
  'Regras: use somente números devolvidos pelas ferramentas, sem calcular nem estimar; não diga ao leitor o que fazer com o dinheiro dele; não prometa retorno; cite o p bruto e o p ajustado; quando a evidência for fraca, diga com clareza.'
].join('\n');

let falhas = 0;
const confere = (ok, msg) => { console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${msg}`); if (!ok) falhas++; return ok; };

for (const c of CASOS) {
  console.log(`\n== ${c.symbol} ${c.timeframe}`);
  const t0 = Date.now();
  let r, corpo;
  try {
    r = await fetch(`${BASE}/api/argos-ai`, { method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'system', content: 'Você é o Argos AI, camada de linguagem da Stratum Research & Analytics. Escreva em português do Brasil e siga à risca as regras do usuário.' }, { role: 'user', content: PEDIDO }], context: c }) });
    corpo = await r.json();
  } catch (e) { confere(false, 'requisição falhou: ' + e.message); continue; }
  console.log(`  HTTP ${r.status} em ${Date.now() - t0} ms`);
  if (!confere(r.status === 200, `status 200 (veio ${r.status}${corpo?.code ? ', código ' + corpo.code : ''})`)) { if (corpo?.error) console.log('  motivo: ' + corpo.error); continue; }
  const texto = corpo.choices?.[0]?.message?.content || '';
  const dados = corpo.argos?.data || {};
  confere(corpo.choices?.[0]?.finish_reason === 'stop', 'texto completo (finish_reason stop)');
  confere(/##\s*1\.\s*Contexto de Regime/.test(texto) && /##\s*2\.\s*Teses em Avaliação/.test(texto), 'as duas seções pedidas aparecem');
  confere(texto.trim().endsWith(DISCLAIMER_PADRAO.trim()), 'termina com o disclaimer padrão');
  const achados = scanText(texto);
  confere(achados.length === 0, `linter de conformidade sem achados${achados.length ? ': ' + achados.map((a) => a.term).join('; ') : ''}`);
  const consultadas = (dados.consulted || []).map((x) => x.tool);
  confere(consultadas.includes('obter_leitura_tecnica') && consultadas.includes('consultar_banco_de_setups'), `ferramentas consultadas: ${consultadas.join(', ') || 'nenhuma'}`);
  confere(dados.symbol === c.symbol && dados.timeframe === c.timeframe, 'recorte devolvido igual ao pedido');
  try {
    const a = await (await fetch(`${BASE}/api/analyze?symbol=${c.symbol}&tf=${c.timeframe}&live=0`, { headers })).json();
    confere(!!dados.seriesHash && dados.seriesHash === a.data?.hash, `hash da série da IA igual ao de /api/analyze (${String(dados.seriesHash).slice(0, 12)}…)`);
    console.log(`  fonte dos candles: IA=${dados.source}, analyze=${a.data?.source}; último candle: IA=${dados.lastCandle}`);
  } catch (e) { confere(false, 'não consegui comparar com /api/analyze: ' + e.message); }
  console.log('\n--- texto para revisão humana ---\n' + texto + '\n--- fim ---');
}
console.log(falhas ? `\nteste-relatorio-real: ${falhas} falha(s). Nada disto vai para a tela nem para investidor.` : '\nteste-relatorio-real: todas as conferências passaram. Falta a leitura de Michel de cada texto.');
process.exit(falhas ? 1 : 0);
