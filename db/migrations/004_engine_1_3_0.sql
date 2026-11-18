-- 004_engine_1_3_0.sql: registra a versão 1.3.0 do motor (os 7 setups do estudo v1.2, aditiva).
--
-- Só insere uma linha. Sem ela, todo registro novo do Termômetro e de POST /api/previsoes falharia por chave
-- estrangeira (engine_version references engine_versions), porque o resumo da análise grava engine: VERSION.
-- As linhas da 1.1.0 (001_init) e da 1.2.0 (003) ficam: previsões antigas continuam válidas.

insert into engine_versions (version, notes)
values ('argos-engine 1.3.0', 'setups do estudo v1.2 (EMA 9/21, MACD zero, RSI 50, preço×SMA200, ADX/DI, Bollinger superior, rompimento 55), aditiva')
on conflict (version) do nothing;
