// O front estático não depende de rede de terceiros nem de CSS embutido: as folhas de estilo ficam em
// web/css/, as fontes em web/fonts/, e todo arquivo local citado nas páginas existe em disco.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const read = (...p) => readFileSync(join(WEB, ...p), 'utf8');
const PAGES = ['index.html', 'verificar.html', 'saude.html'];
// engine.js e os dados são gerados por tools/build-web.mjs; o teste não exige que já tenham sido gerados.
const local = (ref) => !/^(https?:|data:|#|mailto:|javascript:)/.test(ref) && ref !== '';

test('index.html: sem CSS embutido; as folhas entram por <link>, na ordem da cascata', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<style[\s>]/, 'o CSS do index.html mora em web/css/');
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  const order = ['css/fonts.css', 'css/base.css', 'css/landing.css', 'css/platform.css'];
  assert.deepEqual(sheets.filter((s) => order.includes(s)), order);
});

test('páginas: todo href e src local existe em disco', () => {
  for (const page of PAGES) {
    const html = read(page);
    const refs = [...html.matchAll(/<(?:link|script|img|a)\b[^>]*?\b(?:href|src)="([^"]+)"/g)].map((m) => m[1].split(/[?#]/)[0]).filter(local);
    assert.ok(refs.length > 0, page);
    for (const ref of refs) assert.ok(existsSync(join(WEB, ref)), `${page}: ${ref} não existe`);
  }
});

test('páginas e folhas de estilo: nenhuma requisição a serviço de fontes de terceiros', () => {
  const css = readdirSync(join(WEB, 'css')).filter((f) => f.endsWith('.css')).map((f) => read('css', f));
  for (const text of [...PAGES.map((p) => read(p)), ...css]) {
    assert.doesNotMatch(text, /fonts\.(googleapis|gstatic)\.com/);
    assert.doesNotMatch(text, /@import\s+url\(\s*['"]?https?:/);
  }
});

test('fontes: cada url() de fonts.css aponta para um arquivo woff2 presente, com a licença ao lado', () => {
  const urls = [...read('css', 'fonts.css').matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 9);
  for (const u of urls) {
    assert.match(u, /^\.\.\/fonts\/[\w-]+\.woff2$/);
    const buf = readFileSync(join(WEB, 'css', u));
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2', u);
  }
  for (const lic of ['OFL-SourceSerif4.txt', 'OFL-JetBrainsMono.txt']) assert.match(read('fonts', lic), /SIL Open Font License, Version 1\.1/);
});
