-- 002_acessos.sql: códigos de acesso por cliente, uso por cliente e limite de chamadas compartilhado entre as funções.
--
-- Só acrescenta tabelas. O código de acesso em si nunca é guardado: só o SHA-256 dele (tools/acesso.mjs gera,
-- mostra uma vez e grava o hash). Nenhum dado pessoal: nada de IP (o limite usa hash), nada de e-mail.

create table acessos (
  id          bigserial primary key,
  rotulo      text not null check (length(rotulo) between 1 and 80),  -- quem é o cliente, em texto livre curto
  codigo_hash text not null unique check (codigo_hash ~ '^[0-9a-f]{64}$'),
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz,                                              -- null: não expira
  revogado_em timestamptz                                               -- preenchido: deixa de valer na hora
);

-- Chamadas por cliente, por rota e por dia (o "quem usou o quê"). acesso_ref: 'geral' (ARGOS_ACCESS_CODE) ou o id em acessos.
create table acessos_uso (
  acesso_ref text not null,
  rota       text not null,
  dia        date not null,
  chamadas   integer not null default 0,
  primary key (acesso_ref, rota, dia)
);

-- Limite de chamadas por janela fixa, igual para todas as instâncias da função (antes ficava na memória de cada uma).
-- chave: rota + hash do IP; nunca o IP.
create table limite_taxa (
  chave    text not null,
  janela   timestamptz not null,
  contagem integer not null,
  primary key (chave, janela)
);
