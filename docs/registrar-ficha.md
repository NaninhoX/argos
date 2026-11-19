# Registrar uma ficha de pré-registro

Ferramenta: `tools/registrar-ficha.mjs`. Confere o hash canônico de uma ficha (`docs/estudo-*-pre-registro.json`) e carimba esse hash com OpenTimestamps. Não toca em `engine/`.

## Uso

```
node tools/registrar-ficha.mjs hash <ficha.json>
node tools/registrar-ficha.mjs conferir <ficha.json> --md <ficha.md>
node tools/registrar-ficha.mjs carimbar <ficha.json> --saida <pasta fora do repositório> --confirmo-rede [--md <ficha.md>]
node tools/registrar-ficha.mjs --ajuda
```

- `hash` imprime o SHA-256 do JSON canonizado por `hashCanonical` (`lib/canonical.js`). Sem rede.
- `conferir` lê o hash declarado no cabeçalho do `.md` (linha `**SHA-256 da ficha canônica** ...: ` seguida do hash entre crases) e compara com o calculado. Saída 0 se igual, 1 se diferente ou se o `.md` não traz o hash. Sem rede.
- `carimbar` pede o recibo OpenTimestamps do digest aos calendários públicos (`lib/ots.js`, o mesmo caminho de `tools/ots-stamp.mjs`) e grava `<nome>.ots` e `<nome>.sha256` na pasta de saída. `<nome>` é o nome da ficha sem `.json`. O `.sha256` guarda só o hash canônico e uma quebra de linha.

Salvaguardas do `carimbar`: recusa sem `--confirmo-rede`; recusa pasta de saída dentro do repositório (mesma verificação do backup do Neon); com `--md`, confere o hash antes de qualquer chamada de rede e não envia nada se divergir; não sobrescreve arquivo existente; só grava o recibo se ele for do digest pedido.

O recibo nasce **pendente**. Horas depois, `node tools/ots-stamp.mjs upgrade <nome>.ots` tenta incorporar o bloco do Bitcoin. Só o hash canônico vai à rede; o texto da ficha não é enviado pela ferramenta (ele já está versionado no Git, que é o registro público do conteúdo).

## Atenção ao digest e ao `--md`

- O digest carimbado é o SHA-256 do **JSON canonizado** (`lib/canonical.js`), que **não é** o SHA-256 dos bytes do arquivo `.json`. Por isso `sha256sum` e `ots verify` aplicados direto ao arquivo não conferem; quem verifica precisa do digest (comando `hash`) e de um cliente que verifique por digest.
- Só a ficha `.json` é carimbada; o `.md` não é.
- Use sempre `--md` ao carimbar: sem ele, nada confere o digest contra o hash registrado antes de ir à rede.
- A salvaguarda de pasta usa `dentroDoRepo` de `tools/backup-neon.mjs`. Até 19/11/2026 ela não reconhecia um caminho UNC de loopback (`\localhostC$...`) como a mesma pasta local; `desfazUncLocal` corrige isso (localhost, 127.0.0.1 e o nome desta máquina); compartilhamento de OUTRA máquina continua valendo como externo.
- Códigos de saída: 0 certo; 1 falha, divergência ou recusa de salvaguarda; 2 comando ausente ou desconhecido, ou argumento malformado.

## O que o carimbo prova e o que não prova

Prova: que alguém tinha um conteúdo com esse SHA-256 canônico, no mais tardar, na data do bloco do Bitcoin que o recibo atesta. Como o hash muda com qualquer alteração (até uma vírgula), a ficha carimbada não pode ter sido mudada depois dessa data sem que o hash deixe de bater.

Não prova: que a ficha é boa ou correta, nem quem a escreveu; nem que nada foi feito antes dela (o carimbo dá um limite superior de data, não inferior); nem nada sobre o resultado do estudo. Recibo pendente ainda não prova data alguma: só o recibo com atestação Bitcoin conta. Quem confere por conta própria precisa do hash canônico (recalculável com `hash`) e do `.ots`, num cliente OpenTimestamps; a Stratum não precisa ser confiável nessa conferência.

## Quem carimba

O carimbo é de Michel. Rodar `carimbar` é decisão dele: ele usa a rede, cria um recibo que não se desfaz e fica guardado fora do Git. Na construção da ferramenta nenhuma chamada de rede foi feita; os testes (`tests/registrar-ficha.test.js`) usam calendário simulado.
