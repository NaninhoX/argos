// Conformidade: vocabulário (scanText), disclaimer e linter de linha de comando.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DISCLAIMER_PADRAO, scanText, assertCompliant, withDisclaimer } from '../lib/compliance.js';
import { lintRepo } from '../tools/compliance-lint.mjs';

const LINT_CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'compliance-lint.mjs');

describe('disclaimer padrão', () => {
  test('texto exato', () => {
    assert.equal(
      DISCLAIMER_PADRAO,
      'Este material é produzido pela Stratum Research e constitui research e análise estatística. Não constitui recomendação de investimento personalizada, consultoria financeira regulamentada, oferta ou solicitação de compra ou venda de qualquer ativo. Resultados estatísticos históricos, incluindo win rate, intervalos de confiança e Brier Score, não constituem garantia de resultados futuros. O CONTRATANTE é o único responsável por todas as decisões de investimento e por sua execução. A Stratum Research não é instituição financeira, gestora de recursos registrada na CVM ou corretora, não executa ordens, não gerencia e não custodia capital de clientes sob este Contrato.'
    );
  });

  test('não é acusado pelo verificador', () => {
    assert.deepEqual(scanText(DISCLAIMER_PADRAO), []);
    assert.equal(assertCompliant(DISCLAIMER_PADRAO), DISCLAIMER_PADRAO);
  });

  test('withDisclaimer acrescenta uma vez e o resultado continua conforme', () => {
    const base = 'A taxa de acerto observada foi de 58% em 41 gatilhos.';
    const out = withDisclaimer(base);
    assert.ok(out.startsWith(base));
    assert.ok(out.endsWith(DISCLAIMER_PADRAO + '\n'));
    assert.equal(withDisclaimer(out), out, 'idempotente');
    assert.deepEqual(scanText(out), []);
    assert.equal(withDisclaimer(''), DISCLAIMER_PADRAO + '\n');
  });
});

describe('usos legítimos não são acusados', () => {
  const limpos = [
    // regra de saída do teste: alvo e stop são parâmetros
    'Regra de saída: alvo 2×ATR, stop 1×ATR, janela de 12 candles.',
    'Alvo 2×ATR e stop 1×ATR.',
    'Em 41 dos 60 gatilhos o preço atingiu o alvo antes do stop.',
    'O stop foi atingido antes do alvo em 19 gatilhos.',
    'O alvo é 1,5×ATR e o stop é 0,75×ATR.',
    // texto descritivo de evidência
    'Win rate de 57,3% em 41 gatilhos (N efetivo 38), intervalo de Wilson de 95%. Taxa-base de 50,2% em 3.000 sorteios.',
    'Evidência insuficiente: menos de 10 gatilhos neste regime.',
    'Brier Skill Score contra a taxa-base e ECE indicam calibração dentro do esperado, sem ajuste por múltiplos testes além do FDR de 5%.',
    'O teste de Chow aplicado aos log-retornos não rejeitou a estabilidade ao nível de 5%.',
    // compra e venda como substantivos
    'Oferta ou solicitação de compra ou venda de qualquer ativo.',
    'Volume de compra e venda agressora no candle.',
    // negação e proibição
    'O Argos não emite recomendação de compra ou venda, nem preço-alvo.',
    'Não é um sinal de compra.',
    'Nunca diga compre ou venda agora.',
    'Sem garantia de resultados futuros.',
    'Os resultados históricos não constituem garantia de retorno.',
    // provedor de infraestrutura não é produto
    'A redação é feita por um modelo de linguagem hospedado na DeepSeek, apenas como infraestrutura.'
  ];
  for (const texto of limpos) {
    test(texto.slice(0, 70), () => assert.deepEqual(scanText(texto), []));
  }
});

describe('instrução e promessa são acusadas', () => {
  // [texto, regra esperada, trecho esperado]
  const casos = [
    ['Compre BTC agora.', 'compra-imperativa', 'Compre'],
    ['Venda agora antes da queda.', 'venda-imperativa', 'Venda agora'],
    ['Recomendamos comprar ETH neste nível.', 'recomendacao', 'Recomendamos'],
    ['Sugerimos esta leitura do mercado.', 'sugestao', 'Sugerimos'],
    ['Aumente a posição.', 'aumento-de-posicao', 'Aumente a posição'],
    ['É hora de entrar.', 'hora-de-operar', 'hora de entrar'],
    ['Chegou o momento de comprar.', 'hora-de-operar', 'momento de comprar'],
    ['Entre agora, antes do rompimento.', 'entrar-agora', 'Entre agora'],
    ['Abra a posição comprada.', 'ordem-imperativa', 'Abra a posição'],
    ['Mantenha o ativo em carteira.', 'ordem-imperativa', 'Mantenha o ativo'],
    ['Reduza a exposição ao SOL.', 'reducao-de-posicao', 'Reduza a exposição'],
    ['Aloque 10% do capital.', 'tamanho-de-posicao', 'Aloque'],
    ['Tamanho de posição recomendado: 2%.', 'tamanho-de-posicao', 'Tamanho de posição recomendado'],
    ['Sinal de compra confirmado.', 'sinal-de-compra-venda', 'Sinal de compra'],
    ['Novo sinal de venda em ETH.', 'sinal-de-compra-venda', 'sinal de venda'],
    ['Preço-alvo de 80 mil.', 'preco-alvo', 'Preço-alvo'],
    ['Alvo sugerido: topo anterior.', 'alvo-sugerido', 'Alvo sugerido'],
    ['Stop sugerido abaixo da mínima.', 'stop-sugerido', 'Stop sugerido'],
    ['Alvo em US$ 70.000.', 'alvo-stop-em-preco', 'Alvo em US$ 7'],
    ['Defina o stop em 62.000.', 'alvo-stop-em-preco', 'stop em 62.000'],
    ['Alvo de 70 mil no curto prazo.', 'alvo-stop-em-preco', 'Alvo de 70 mil'],
    ['Stop em 66000 nesta leitura.', 'alvo-stop-em-preco', 'Stop em 66000'],
    ['Considere comprar na retração.', 'sugestao-de-operacao', 'Considere comprar'],
    ['Eu compraria neste regime.', 'sugestao-de-operacao', 'Eu compraria'],
    ['Realize lucros perto da máxima.', 'realizacao-de-lucro', 'Realize lucros'],
    ['Saia da posição se o regime mudar.', 'saida-imperativa', 'Saia da posição'],
    ['Lucro garantido.', 'lucro-garantido', 'Lucro garantido'],
    ['Rentabilidade garantida em todos os regimes.', 'garantia', 'garantida'],
    ['Retorno de 8% ao mês.', 'promessa-de-retorno', 'Retorno de 8% ao mês'],
    ['Rentabilidade de 12% a.a. com risco controlado.', 'promessa-de-retorno', 'Rentabilidade de 12% a.a.'],
    ['Operação com risco zero.', 'promessa-de-retorno', 'risco zero'],
    ['Lucre com o Termômetro.', 'promessa-de-retorno', 'Lucre'],
    ['O BTC vai subir na semana.', 'previsao-de-preco', 'vai subir'],
    ['Uma oportunidade rara.', 'oportunidade', 'oportunidade'],
    ['Não perca esta janela.', 'urgencia', 'Não perca'],
    ['Setup imperdível.', 'urgencia', 'imperdível'],
    ['O Astra superou o mercado.', 'marca-proibida', 'Astra'],
    ['Benchmark: DeepSeek V4.1 lidera o ranking.', 'marca-proibida', 'DeepSeek V4.1'],
    ['Motor baseado no deepseek-v4.1.', 'marca-proibida', 'deepseek-v4.1']
  ];
  for (const [texto, regra, trecho] of casos) {
    test(`${regra}: ${texto}`, () => {
      const f = scanText(texto);
      assert.equal(f.length, 1, JSON.stringify(f));
      assert.equal(f[0].rule, regra);
      assert.equal(f[0].term, trecho);
      assert.equal(f[0].index, texto.indexOf(trecho));
      assert.ok(f[0].excerpt.includes(trecho));
    });
  }

  test('negação de outra frase não protege o termo', () => {
    const f = scanText('Não temos dúvida. Compre agora.');
    assert.deepEqual(f.map((x) => x.rule), ['compra-imperativa']);
  });

  // regra verbal: a negação só vale dentro da mesma oração
  const outraOracao = [
    ['Não hesite, compre agora.', 'compra-imperativa'],
    ['Não hesite e compre agora.', 'compra-imperativa'],
    ['Sem medo: venda agora.', 'venda-imperativa'],
    ['Não temos dúvida, recomendamos a exposição.', 'recomendacao'],
    ['Não espere mais, é hora de entrar.', 'hora-de-operar'],
    ['Ninguém sabe o fundo, mas não importa, o BTC vai subir.', 'previsao-de-preco'],
    ['Não fique de fora — aloque já.', 'tamanho-de-posicao'],
    ['Nunca foi tão claro, garantimos o resultado.', 'garantia']
  ];
  for (const [texto, regra] of outraOracao) {
    test(`negação de outra oração não protege: ${texto}`, () => assert.deepEqual(scanText(texto).map((x) => x.rule), [regra]));
  }

  test('negação na mesma oração e substantivo em lista negada continuam limpos', () => {
    for (const texto of [
      'O relatório não diz compre nem venda agora.',
      'Não recomendamos nem sugerimos operação alguma.',
      'Não dá para afirmar que o preço vai subir.',
      'Material sem promessa de retorno, garantia ou oportunidade.',
      'Não é hora de entrar, e o estudo não diz que seja.'
    ]) assert.deepEqual(scanText(texto), [], texto);
  });

  test('vários achados saem em ordem de posição, com alvo e stop em preço', () => {
    const f = scanText('Compre agora. Alvo em US$ 70.000 e stop em US$ 62.000.');
    assert.deepEqual(f.map((x) => x.rule), ['compra-imperativa', 'alvo-stop-em-preco', 'alvo-stop-em-preco']);
    assert.deepEqual(f.map((x) => x.index), [...f.map((x) => x.index)].sort((a, b) => a - b));
  });

  test('achado contido em outro não é repetido', () => {
    assert.equal(scanText('lucro garantido').length, 1);
  });

  test('entrada que não é string não quebra', () => {
    assert.deepEqual(scanText(undefined), []);
    assert.deepEqual(scanText(null), []);
  });
});

describe('assertCompliant', () => {
  test('texto limpo passa e é devolvido', () => {
    const t = 'Alvo 2×ATR, stop 1×ATR.';
    assert.equal(assertCompliant(t), t);
  });

  test('texto com instrução lança ComplianceError com os achados', () => {
    assert.throws(
      () => assertCompliant('Compre agora e tenha lucro garantido.'),
      (err) => {
        assert.equal(err.name, 'ComplianceError');
        assert.deepEqual(err.findings.map((f) => f.rule), ['compra-imperativa', 'lucro-garantido']);
        assert.match(err.message, /Compre/);
        assert.match(err.message, /lucro garantido/i);
        return true;
      }
    );
  });
});

describe('linter de linha de comando', () => {
  let raiz;
  const escreve = (rel, conteudo) => {
    const abs = path.join(raiz, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, conteudo);
  };

  before(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'argos-lint-'));
    // varridos, com achado
    escreve('web/index.html', '<p>Texto limpo.</p>\n<p>Compre agora.</p>\n');
    escreve('api/rota.js', "export const msg = 'Lucro garantido';\n");
    escreve('docs/public/nota.md', 'Sinal de compra confirmado.\n');
    // varridos, sem achado
    escreve('lib/ok.js', "export const regra = 'alvo 2×ATR, stop 1×ATR';\n");
    // suprimidos
    escreve('web/ignorado.html', '<p>Compre agora.</p> <!-- compliance-ignore: exemplo de texto proibido -->\n');
    escreve('web/sem-motivo.html', '<p>Compre agora.</p> <!-- compliance-ignore: -->\n');
    // fora do escopo
    escreve('legacy/velho.html', '<p>Compre agora.</p>\n');
    escreve('web/legacy/velho.html', '<p>Compre agora.</p>\n');
    escreve('node_modules/pacote/index.js', "'Compre agora'\n");
    escreve('tests/caso.js', "'Compre agora'\n");
    escreve('docs/adr/0001-x.md', 'Compre agora.\n');
    escreve('lib/compliance.js', "'Compre agora'\n");
    escreve('web/imagem.png', 'Compre agora');
  });
  after(() => fs.rmSync(raiz, { recursive: true, force: true }));

  test('acusa arquivo, linha e regra; respeita exclusões e supressão', () => {
    const { files, findings } = lintRepo(raiz);
    const chave = findings.map((f) => `${f.file}:${f.line}:${f.rule}`).sort();
    assert.deepEqual(chave, [
      'api/rota.js:1:lucro-garantido',
      'docs/public/nota.md:1:sinal-de-compra-venda',
      'web/index.html:2:compra-imperativa',
      'web/sem-motivo.html:1:compra-imperativa'
    ]);
    // index.html, ignorado.html, sem-motivo.html, rota.js, nota.md, ok.js
    assert.equal(files, 6);
  });

  test('CLI sai com código 1 e imprime arquivo:linha e regra', () => {
    const r = spawnSync(process.execPath, [LINT_CLI, '--root', raiz], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /web\/index\.html:2:\d+ {2}\[compra-imperativa\]/);
    assert.match(r.stdout, /api\/rota\.js:1:\d+ {2}\[lucro-garantido\]/);
  });

  test('CLI sai com código 0 quando não há achado', () => {
    const limpa = fs.mkdtempSync(path.join(os.tmpdir(), 'argos-lint-ok-'));
    try {
      fs.mkdirSync(path.join(limpa, 'web'));
      fs.writeFileSync(path.join(limpa, 'web', 'index.html'), '<p>Alvo 2×ATR, stop 1×ATR.</p>\n');
      const r = spawnSync(process.execPath, [LINT_CLI, '--root', limpa], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /ok/);
    } finally {
      fs.rmSync(limpa, { recursive: true, force: true });
    }
  });

  test('pastas ausentes (web vazio, sem docs/public) não são erro', () => {
    const vazia = fs.mkdtempSync(path.join(os.tmpdir(), 'argos-lint-vazia-'));
    try {
      assert.deepEqual(lintRepo(vazia), { files: 0, findings: [] });
    } finally {
      fs.rmSync(vazia, { recursive: true, force: true });
    }
  });
});
