// O tamanho de fonte respeita a fonte configurada pelo usuário: nenhum font-size em px nas folhas de web/css/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const CSS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'css');

test('web/css: nenhum font-size em px (rem, para respeitar a fonte do usuário)', () => {
  const files = readdirSync(CSS).filter((f) => f.endsWith('.css'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const css = readFileSync(join(CSS, f), 'utf8');
    assert.doesNotMatch(css, /font-size:\s*[0-9.]+px/, `${f}: font-size em px`);
    assert.doesNotMatch(css, /font-size:\s*clamp\([^)]*px/, `${f}: clamp() com px em font-size`);
  }
});
