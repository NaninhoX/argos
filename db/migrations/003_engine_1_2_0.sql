-- 003_engine_1_2_0.sql: registra a versão 1.2.0 do motor (confluência e iters, aditiva).
--
-- Só insere uma linha. Sem ela, todo registro novo do Termômetro e de POST /api/previsoes falharia por chave
-- estrangeira (engine_version references engine_versions), porque o resumo da análise grava engine: VERSION.
-- A linha da 1.1.0 (001_init) fica: previsões antigas continuam válidas.

insert into engine_versions (version, notes)
values ('argos-engine 1.2.0', 'confluência e iters, aditiva')
on conflict (version) do nothing;
