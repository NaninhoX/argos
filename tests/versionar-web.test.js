import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { versionarHtml, versionarScript, versionarWeb } from '../tools/versionar-web.mjs';

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

test('versionarScript: põe o hash nos endereços literais do carregador e é idempotente', () => {
  const h = (rel) => (rel === 'data/snapshot/BTCUSDT_4h.js' ? 'abcd1234' : null);
  const js = "var S = { BTCUSDT_4h: 'data/snapshot/BTCUSDT_4h.js', X: 'js/falta.js' }; var u = 'https://x.com/a.js';";
  const um = versionarScript(js, h);
  assert.equal(um, "var S = { BTCUSDT_4h: 'data/snapshot/BTCUSDT_4h.js?v=abcd1234', X: 'js/falta.js' }; var u = 'https://x.com/a.js';");
  assert.equal(versionarScript(um, h), um);
});

test('versionarWeb: o carregador é versionado antes do HTML, que leva o hash do carregador já reescrito', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ver-'));
  try {
    fs.mkdirSync(path.join(dir, 'js'));
    fs.writeFileSync(path.join(dir, 'js', 'live.js'), 'x');
    fs.writeFileSync(path.join(dir, 'js', 'carregador.js'), "var a = 'js/live.js';");
    fs.writeFileSync(path.join(dir, 'x.html'), '<script src="js/carregador.js"></script>');
    versionarWeb(dir);
    const carregador = fs.readFileSync(path.join(dir, 'js', 'carregador.js'), 'utf8');
    assert.match(carregador, /'js\/live\.js\?v=[0-9a-f]{8}'/);
    const hash = (await import('node:crypto')).createHash('sha256').update(carregador).digest('hex').slice(0, 8);
    assert.equal(fs.readFileSync(path.join(dir, 'x.html'), 'utf8'), `<script src="js/carregador.js?v=${hash}"></script>`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
