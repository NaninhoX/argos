import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { versionarHtml, versionarWeb } from '../tools/versionar-web.mjs';

test('versionarHtml: põe o hash em css e js locais e deixa o resto', () => {
  const h = (rel) => (rel === 'css/a.css' ? 'abcd1234' : rel === 'js/b.js' ? '99999999' : null);
  const html = '<link href="css/a.css"><script src="js/b.js"></script><script src="https://x.com/c.js"></script><script src="js/falta.js"></script><a href="verificar.html">';
  assert.equal(versionarHtml(html, h), '<link href="css/a.css?v=abcd1234"><script src="js/b.js?v=99999999"></script><script src="https://x.com/c.js"></script><script src="js/falta.js"></script><a href="verificar.html">');
});

test('versionarHtml: é idempotente e troca o hash antigo', () => {
  const h = () => 'aaaaaaaa';
  const um = versionarHtml('<link href="css/a.css?v=00000000">', h);
  assert.equal(um, '<link href="css/a.css?v=aaaaaaaa">');
  assert.equal(versionarHtml(um, h), um);
});

test('versionarWeb: o hash acompanha o conteúdo do arquivo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ver-'));
  try {
    fs.mkdirSync(path.join(dir, 'css'));
    fs.writeFileSync(path.join(dir, 'css', 'a.css'), 'a{}');
    fs.writeFileSync(path.join(dir, 'x.html'), '<link href="css/a.css">');
    assert.deepEqual(versionarWeb(dir), ['x.html']);
    const v1 = fs.readFileSync(path.join(dir, 'x.html'), 'utf8');
    assert.deepEqual(versionarWeb(dir), []);
    fs.writeFileSync(path.join(dir, 'css', 'a.css'), 'a{color:red}');
    versionarWeb(dir);
    assert.notEqual(fs.readFileSync(path.join(dir, 'x.html'), 'utf8'), v1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
