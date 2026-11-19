// Textos que a demo mostra (ensaio de 19/11/2026): nada de "Agente de Execução" (ADR 0008) e a assinatura com o nome
// da casa desde 25/10 em todas as páginas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL(`../web/${p}`, import.meta.url), 'utf8');

test('a plataforma não chama nenhum agente de "Execução" (ADR 0008)', () => {
  assert.doesNotMatch(ler('js/live.js'), /Agente de Execução/);
  assert.match(ler('js/live.js'), /nm: 'Montagem'/);
});

test('o pipeline concorda o número de argumentos', () => {
  assert.match(ler('js/live.js'), /pl\(dbt\.pro\.length, 'argumento', 'argumentos'\)/);
});

test('assinatura "Research & Analytics" em todas as páginas com a marca', () => {
  for (const p of ['index.html', 'verificar.html', 'correcoes.html']) {
    const html = ler(p);
    if (!html.includes('stratum-lockup')) continue;
    assert.doesNotMatch(html, /<span class="sl-sub">RESEARCH<\/span>/, p);
  }
});
