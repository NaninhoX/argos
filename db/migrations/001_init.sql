-- 001_init.sql: esquema inicial do Argos (Postgres 14+; testado em PGlite).
--
-- Regras desta pasta:
--   * SQL puro, numerado, só para frente. Nunca edite uma migração já aplicada: crie a próxima.
--   * Sem BEGIN/COMMIT: tools/migrate.mjs executa cada arquivo dentro de uma transação.
--   * Preços e estatísticas em double precision (o motor usa double do JavaScript e o valor
--     precisa voltar idêntico); tempo em timestamptz; estruturas em jsonb.
--   * Nenhum dado pessoal em nenhuma tabela (por isso ip_hash, nunca IP).

-- ============================================================ controle

-- schema_migrations(version text primary key, applied_at timestamptz) é criada por tools/migrate.mjs,
-- antes de qualquer migração, e não faz parte destes arquivos.

create table engine_versions (
  version     text primary key,
  commit_sha  text,
  released_at timestamptz,
  notes       text
);

insert into engine_versions (version, notes)
values ('argos-engine 1.1.0', 'Versão inicial: porta do motor estatístico da demo v1.1.')
on conflict (version) do nothing;

-- Bloqueio de mutação: usado nas tabelas append-only (correção = nova linha).
create function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'tabela % é append-only: % não permitido', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- ============================================================ dados de mercado

create table candles (
  symbol      text not null,
  timeframe   text not null check (timeframe in ('1h', '4h', '1d')),
  open_time   timestamptz not null,
  open        double precision not null,
  high        double precision not null,
  low         double precision not null,
  close       double precision not null,
  volume      double precision not null,
  source      text not null default 'binance',
  inserted_at timestamptz not null default now(),
  primary key (symbol, timeframe, open_time)
);

-- Regime calculado por barra e por versão do motor. Append-only.
create table regimes (
  symbol         text not null,
  timeframe      text not null check (timeframe in ('1h', '4h', '1d')),
  bar_time       timestamptz not null,
  regime         text not null,
  confidence     double precision,
  adx            double precision,
  rv_pct         double precision,
  chow_p         double precision,
  price_vs_ma    double precision,
  engine_version text not null references engine_versions (version),
  computed_at    timestamptz not null default now(),
  primary key (symbol, timeframe, bar_time, engine_version)
);

create trigger regimes_append_only
  before update or delete on regimes
  for each row execute function forbid_mutation();
create trigger regimes_no_truncate
  before truncate on regimes
  for each statement execute function forbid_mutation();

-- ============================================================ registro público de previsões

-- Append-only: UPDATE, DELETE e TRUNCATE são recusados por gatilho.
-- Correção se faz com nova linha apontando para a anterior em `supersedes`.
create table previsoes (
  id             uuid primary key default gen_random_uuid(),
  setup_id       text,
  symbol         text,
  timeframe      text,
  params         jsonb not null,
  prob           double precision check (prob >= 0 and prob <= 1), -- null: o motor não emitiu probabilidade
  base_rate      double precision,
  n              integer,
  n_eff          integer,
  verdict        text,
  bar_time       timestamptz,
  data_cut       timestamptz not null,
  emitted_at     timestamptz not null,
  origin         text not null check (origin in ('demo', 'cliente', 'relatorio', 'termometro', 'indice')),
  origin_ref     text,
  engine_version text not null references engine_versions (version),
  payload        jsonb not null,
  hash           text not null unique check (hash ~ '^[0-9a-f]{64}$'), -- SHA-256 em hexadecimal minúsculo
  supersedes     uuid references previsoes (id),
  created_at     timestamptz not null default now()
);

create trigger previsoes_append_only
  before update or delete on previsoes
  for each row execute function forbid_mutation();
create trigger previsoes_no_truncate
  before truncate on previsoes
  for each statement execute function forbid_mutation();

-- Consulta por série (calibração, histórico de um setup) e varredura por tempo (prova Merkle diária).
create index previsoes_serie_idx on previsoes (symbol, timeframe, setup_id, emitted_at);
create index previsoes_emitted_idx on previsoes (emitted_at);
create index previsoes_origin_ref_idx on previsoes (origin, origin_ref) where origin_ref is not null;
create index previsoes_supersedes_idx on previsoes (supersedes) where supersedes is not null;

-- Desfecho de cada previsão (uma vez só). Append-only.
-- Pendentes de desfecho: previsoes p left join desfechos d on d.previsao_id = p.id where d.previsao_id is null.
create table desfechos (
  previsao_id uuid primary key references previsoes (id),
  outcome     text not null check (outcome in ('WIN', 'LOSS', 'TIMEOUT')),
  ret         double precision,
  bars        integer,
  bar_time    timestamptz,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

create trigger desfechos_append_only
  before update or delete on desfechos
  for each row execute function forbid_mutation();
create trigger desfechos_no_truncate
  before truncate on desfechos
  for each statement execute function forbid_mutation();

-- ============================================================ ancoragem (árvore de Merkle diária)

-- Atualizável: o status avança (pendente, ancorada, confirmada) e o recibo OpenTimestamps chega depois.
create table provas_merkle (
  day        date primary key,
  root       text not null,
  n_leaves   integer,
  ots        bytea,
  status     text not null default 'pendente' check (status in ('pendente', 'ancorada', 'confirmada', 'falhou')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger provas_merkle_touch
  before update on provas_merkle
  for each row execute function touch_updated_at();

create table previsao_prova (
  previsao_id uuid primary key references previsoes (id),
  day         date not null references provas_merkle (day),
  leaf_index  integer not null,
  proof       jsonb not null,
  unique (day, leaf_index)
);

-- ============================================================ cache da matriz de resultados

create table resultados_matriz (
  id             bigserial primary key,
  engine_version text not null references engine_versions (version),
  data_cut       timestamptz not null,
  symbol         text not null,
  timeframe      text not null,
  setup_id       text not null,
  cfg            jsonb not null,
  cfg_hash       text not null,
  result         jsonb not null,
  computed_at    timestamptz not null default now(),
  unique (engine_version, data_cut, symbol, timeframe, setup_id, cfg_hash)
);

-- ============================================================ operação e auditoria (sem dado pessoal)

create table query_log (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  route          text,
  params         jsonb,
  status         integer,
  latency_ms     integer,
  cache_hit      boolean,
  engine_version text,
  ip_hash        text -- hash com sal; nunca o IP
);

create index query_log_at_idx on query_log (at);

create table tool_audit (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  session_id  text,
  tool        text not null,
  args        jsonb,
  result_hash text,
  model       text,
  latency_ms  integer
);

create index tool_audit_session_idx on tool_audit (session_id, at);

-- ============================================================ agentes e revisão humana

create table agent_runs (
  id          uuid primary key default gen_random_uuid(),
  run_week    date,
  agent       text not null,
  input       jsonb,
  output      jsonb,
  status      text,
  cost_usd    double precision,
  tokens_in   integer,
  tokens_out  integer,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index agent_runs_week_idx on agent_runs (run_week, agent);

create table revisao_humana (
  id           uuid primary key default gen_random_uuid(),
  agent_run_id uuid references agent_runs (id),
  reviewer     text, -- identificador interno (ex.: "michel"), nunca e-mail
  decision     text not null check (decision in ('aprovado', 'aprovado_com_ajustes', 'rejeitado')),
  changes      jsonb,
  notes        text,
  at           timestamptz not null default now()
);

create index revisao_humana_run_idx on revisao_humana (agent_run_id);

-- ============================================================ plano de calibração pré-registrado

create table plano_calibracao (
  id            text not null,
  version       integer not null,
  hipotese      text,
  prob          double precision check (prob >= 0 and prob <= 1),
  registered_at timestamptz not null default now(),
  resolves_at   date,
  criterio      text,
  resultado     boolean,
  resolved_at   timestamptz,
  hash          text,
  primary key (id, version)
);
