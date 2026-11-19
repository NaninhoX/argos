// Conformidade: conselho brando sem palavra proibida.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../lib/compliance.js';

describe('conselho brando é acusado', () => {
  const casos = [
    'Vale ficar atento: momento favorável enquanto não cair.',
    'Vale a pena ficar de olho no rompimento.',
    'Vale a pena estar atento ao suporte.',
    'Fique de olho nesse nível.',
    'Este é um momento propício para o ativo.',
    'Parece o momento ideal.',
    'É o momento certo.',
    'Boa hora para o ativo.',
    'Boa hora de rever a carteira.',
    'Mantenha enquanto não romper a máxima.',
    'Aproveite a alta.',
    'Aproveitar essa queda.',
    'Aproveite a oportunidade.',
    'Há oportunidade de entrada.',
    'Surge uma oportunidade de venda.'
  ];
  for (const t of casos) {
    test(t, () => assert.ok(scanText(t).length > 0, `deveria acusar: ${t}`));
  }
  test('o texto da falha original acusa conselho-brando', () => {
    const r = scanText('Vale ficar atento: momento favorável enquanto não cair');
    assert.ok(r.some((f) => f.rule === 'conselho-brando'));
  });
});

describe('texto técnico legítimo não é acusado', () => {
  const limpos = [
    'A janela de 30 minutos contém 6 candles de 5 minutos.',
    'A janela de 120 candles foi usada para calcular o ATR.',
    'O teste ficou atento ao viés de seleção e corrigiu por múltiplos testes.',
    'O gatilho vale para o ativo e o tempo gráfico testados.',
    'A queda média após o evento foi de 2,1% em 24 horas.',
    'Enquanto o intervalo de confiança incluir 50%, o veredito é Inconclusivo.'
  ];
  for (const t of limpos) {
    test(t.slice(0, 70), () => assert.deepEqual(scanText(t), []));
  }
});

describe('negação na mesma oração não acusa', () => {
  const negados = [
    'Não é momento favorável para afirmar nada.',
    'Nunca diga que é boa hora para o ativo.',
    'Não vale ficar de olho em um único indicador.',
    'Não aproveite a alta como argumento.'
  ];
  for (const t of negados) {
    test(t, () => assert.deepEqual(scanText(t), []));
  }
});
