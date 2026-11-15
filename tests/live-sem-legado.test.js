// Backlog 6-B: uma só cópia do esquema de ferramentas (lib/ai/tools.js). O caminho legado do artefato
// (ferramentas e JSON do motor montados no navegador) não pode voltar a web/js/live.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = fs.readFileSync(path.join(raiz, 'web', 'js', 'live.js'), 'utf8');

test('live.js não tem o caminho legado de ferramentas no navegador', () => {
  for (const nome of ['buildTools', 'HIDE_CODES', 'toolContext', 'toolBank', 'toolDetail', 'useTools']) {
    assert.ok(!new RegExp('\\b' + nome + '\\b').test(live), nome + ' voltou a live.js');
  }
  assert.ok(!/opts\.tools\b/.test(live), 'opts.tools voltou a live.js');
  assert.ok(!/\.limits\b/.test(live), 'sondagem de limites do sampler voltou a live.js');
});

test('o prompt não carrega o JSON do motor', () => {
  assert.ok(!/Dados do motor \(JSON\)/.test(live), 'o prompt volta a enviar o JSON do motor');
  const i = live.indexOf('function buildPrompt'), j = live.indexOf('const AI_ERR');
  assert.ok(i > 0 && j > i);
  assert.ok(!/JSON\.stringify/.test(live.slice(i, j)), 'buildPrompt serializa dados');
  assert.ok(/function buildPrompt\(\)/.test(live), 'buildPrompt não deve receber dados do motor');
});

test('resta só o caminho do servidor, e sem ele o botão do Argos AI fica escondido', () => {
  assert.ok(/const SERVER_LLM = CFG\.llm === 'server'/.test(live));
  assert.ok(/function makeServerSampler\(\)/.test(live));
  assert.ok(/if \(SERVER_LLM\) \{ state\.samp = makeServerSampler\(\); \$\('lvAskAi'\)\.hidden = false; \}/.test(live));
  assert.ok(/body: JSON\.stringify\(\{ messages, context, stream: true \}\)/.test(live), 'o cliente só envia mensagens e recorte');
});
