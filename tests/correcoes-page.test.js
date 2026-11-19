// web/correcoes.html (item 25: Log de Correções e Diário de Bordo): disclaimer padrão, fora dos buscadores e do menu
// até Michel aprovar o texto, e conformidade do texto inteiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { DISCLAIMER_PADRAO, scanText } from '../lib/compliance.js';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const html = readFileSync(join(WEB, 'correcoes.html'), 'utf8');
const texto = html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('correcoes.html traz o disclaimer padrão sem alteração', () => {
  assert.ok(texto.includes(DISCLAIMER_PADRAO), 'o rodapé precisa do DISCLAIMER_PADRAO de lib/compliance.js, igual');
});

test('correcoes.html segue noindex e fora do menu até a aprovação do texto', () => {
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  const index = readFileSync(join(WEB, 'index.html'), 'utf8');
  assert.doesNotMatch(index, /correcoes\.html/, 'linkar no site só depois de Michel aprovar o texto (e então trocar este teste)');
});

test('correcoes.html: texto sem achado do verificador de conformidade', () => {
  const r = scanText(texto);
  const achados = Array.isArray(r) ? r : (r?.findings ?? r?.achados ?? []);
  assert.deepEqual(achados, []);
});

test('correcoes.html: cada correção tem data e estado, e a contagem do topo confere', () => {
  const fixes = [...html.matchAll(/<article class="fix (aberta|feita)">([\s\S]*?)<\/article>/g)];
  assert.ok(fixes.length > 0);
  for (const [, classe, corpo] of fixes) {
    assert.match(corpo, /<time datetime="\d{4}-\d{2}-\d{2}">/);
    assert.match(corpo, classe === 'aberta' ? /Em correção/ : /Corrigida/);
  }
  assert.match(html, new RegExp(`<b>${fixes.length} correções</b>`));
});
