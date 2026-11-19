import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarRisco } from '../lib/agents/risco.js';
import { validarRiscoSaida, resolverCaminho } from '../lib/agents/contratos.js';
import { analyze } from '../engine/index.js';
import { summarize } from '../lib/analysis-summary.js';
import { snapshotSeries } from '../lib/data/series.js';

const base = (o = {}) => ({
  id: 'X', nEff: 50, q: 0.01, pTwo: 0.01, winRate: 0.4, base: 0.3,
  wf: { available: true, consistent: true, walks: [] }, ...o
});
const sm = (setup, extra = {}) => ({
  input: { symbol: 'BTCUSDT', timeframe: '4h' },
  regime: { current: { regime: 'BULL_TREND' } },
  calibration: { status: { k: 'good' } },
  data: {},
  setups: [setup], ...extra
});
const um = (setup, extra) => avaliarRisco([sm(setup, extra)]);

test('risco: INSUFICIENTE (nEff < 10) vira evidencia_insuficiente', () => {
  const r = um(base({ nEff: 4 }));
  assert.equal(r.teses[0].estado, 'evidencia_insuficiente');
  assert.equal(r.teses[0].vetos[0].regra, 'evidencia_insuficiente');
  assert.equal(r.teses[0].vetos[0].limiar, 10);
});

test('risco: SEM_EDGE (q >= 0,05) vira sem_edge', () => {
  const r = um(base({ q: 0.2 }));
  assert.equal(r.teses[0].estado, 'sem_edge');
  assert.equal(r.teses[0].vetos[0].limiar, 0.05);
});

test('risco: q ausente cai em pTwo, como o motor', () => {
  const r = um(base({ q: null, pTwo: 0.3 }));
  assert.equal(r.teses[0].estado, 'sem_edge');
  assert.equal(r.teses[0].vetos[0].campo, 'setups[id=X].pTwo');
});

test('risco: ABAIXO (winRate < base) vira sem_edge', () => {
  const r = um(base({ winRate: 0.2 }));
  assert.equal(r.teses[0].estado, 'sem_edge');
  assert.equal(r.teses[0].vetos[0].regra, 'abaixo_da_base');
});

test('risco: EDGE_SENSIVEL vira veto_risco com as janelas que falharam', () => {
  const walks = [
    { trainWR: 0.4, testWR: 0.38, dropPP: 2, overfit: false, fromTime: 'a', toTime: 'b' },
    { trainWR: 0.5, testWR: 0.3, dropPP: 20, overfit: true, fromTime: 'c', toTime: 'd' }
  ];
  const r = um(base({ wf: { available: true, consistent: false, walks } }));
  assert.equal(r.teses[0].estado, 'veto_risco');
  const v = r.teses[0].vetos[0];
  assert.equal(v.valor.length, 1);
  assert.equal(v.valor[0].janela, 2);
  assert.equal(v.limiar, 0.15);
});

test('risco: EDGE vira em_avaliacao, sem vetos', () => {
  const r = um(base());
  assert.equal(r.teses[0].estado, 'em_avaliacao');
  assert.deepEqual(r.teses[0].vetos, []);
});

test('risco: avisos por série não mudam o estado', () => {
  const r = um(base(), {
    regime: { current: { regime: 'STRUCTURAL_BREAK' } },
    calibration: { status: { k: 'bad' } },
    data: { liveError: 'timeout', dbError: 'banco_indisponivel' }
  });
  assert.equal(r.teses[0].estado, 'em_avaliacao');
  assert.deepEqual(r.avisos.map((a) => a.regra), ['regime_quebra_estrutural', 'calibracao_fraca', 'falha_fonte_ao_vivo', 'banco_indisponivel']);
  assert.equal(validarRiscoSaida(r).ok, true);
  const na = um(base(), { calibration: { status: { k: 'na' } } });
  assert.equal(na.avisos[0].valor, 'na');
});

test('risco: snapshot real BTCUSDT 4h é determinístico, válido e com fonteLimiar em todo veto', () => {
  const rodar = () => {
    const d = snapshotSeries('BTCUSDT', '4h');
    const A = analyze(d, { mode: 'atr', tgt: 2, stp: 1, hold: 12 }, { sym: 'BTCUSDT', tf: '4h', source: 'snapshot' });
    return summarize(A, { symbol: 'BTCUSDT', timeframe: '4h', source: 'snapshot' });
  };
  const s1 = rodar();
  const a = avaliarRisco([s1]);
  const b = avaliarRisco([rodar()]);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(validarRiscoSaida(a), { ok: true });
  assert.equal(a.teses.length, s1.setups.length);
  const mapa = { INSUFICIENTE: 'evidencia_insuficiente', SEM_EDGE: 'sem_edge', ABAIXO: 'sem_edge', EDGE_SENSIVEL: 'veto_risco', EDGE: 'em_avaliacao' };
  for (const t of a.teses) {
    const st = s1.setups.find((x) => x.id === t.setupId);
    assert.equal(t.estado, mapa[st.verdict.key], `${t.setupId}: estado igual ao veredito do motor`);
    for (const v of t.vetos) {
      assert.ok(v.fonteLimiar && v.fonteLimiar.length > 0);
      assert.notEqual(resolverCaminho(s1, v.campo), undefined, v.campo);
    }
  }
  for (const av of a.avisos) assert.ok(av.fonteLimiar);
});
