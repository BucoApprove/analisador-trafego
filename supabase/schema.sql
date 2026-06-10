-- Perfis de usuário (vinculado ao Supabase Auth)
create table if not exists profiles (
  id    uuid primary key references auth.users(id) on delete cascade,
  name  text not null,
  role  text not null default 'analyst' check (role in ('admin', 'analyst'))
);
alter table profiles disable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

-- Atividades por produto
create table if not exists activities (
  id           uuid primary key default gen_random_uuid(),
  product_name text not null,
  title        text not null,
  description  text not null default '',
  status       text not null default 'pendente' check (status in ('pendente', 'em andamento', 'concluída')),
  created_at   timestamptz not null default now()
);

-- Links de cada atividade
create table if not exists activity_links (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  label       text not null,
  url         text not null,
  type        text not null default 'link' check (type in ('drive', 'sheet', 'link')),
  created_at  timestamptz not null default now()
);

-- Comentários / atualizações
create table if not exists activity_comments (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  author      text not null,
  text        text not null,
  created_at  timestamptz not null default now()
);

-- Índices
create index if not exists idx_activities_product on activities(product_name);
create index if not exists idx_links_activity    on activity_links(activity_id);
create index if not exists idx_comments_activity on activity_comments(activity_id);

-- RLS: desabilitado (acesso controlado pelo Bearer token do próprio dashboard)
alter table activities        disable row level security;
alter table activity_links    disable row level security;
alter table activity_comments disable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

-- Cache de respostas da /api/report (anti rate-limit Meta)
-- Período fechado (until < hoje): expires_at = NULL (cache eterno)
-- Período aberto (until = hoje):  expires_at = fetched_at + 600s
create table if not exists api_cache (
  cache_key   text primary key,
  params      jsonb not null,
  response    jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz,
  hit_count   int not null default 0,
  last_hit_at timestamptz
);
create index if not exists api_cache_expires_idx on api_cache(expires_at);
alter table api_cache disable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

-- Cache genérico de relatórios (ManyChat, metas mensais, etc.)
-- Chave ex: "manychat-monthly", "goals-2025-05"
create table if not exists report_cache (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table report_cache disable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

-- Cache de dados do Perpetuo (Meta Ads Insights)
-- Chave ex: "conta1_etapa1_2024-01-01_2026-04-30"
create table if not exists perpetuo_cache (
  cache_key  text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table perpetuo_cache disable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

-- Filtros customizados por etapa (substitui os keywords hardcoded em perpetuo-data.ts)
-- Chave: (account, view) ex: ('conta1', 'etapa4')
create table if not exists etapa_filters (
  account    text not null,
  view       text not null,
  include    text[] not null default '{}',
  exclude    text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (account, view)
);
alter table etapa_filters disable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

-- Metas mensais por produto (substitui a planilha Google Sheets)
-- Chave: (month, product_name) ex: ('2026-06', 'Buco Approve')
-- month no formato "YYYY-MM". meta em R$ (numeric).
create table if not exists monthly_goals (
  month        text not null,
  product_name text not null,
  meta         numeric not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (month, product_name)
);
create index if not exists idx_monthly_goals_month on monthly_goals(month);
alter table monthly_goals disable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

-- Agrupamento manual de produtos Hotmart → produto-meta (definido pela UI).
-- Override por NOME EXATO do produto no Hotmart, vale para todos os meses.
-- Tem prioridade sobre o PRODUCT_MAP de keywords hardcoded.
-- Chave: hotmart_name ex: ('Imersão ENARE - 22, 23 e 24/06')
create table if not exists product_mappings (
  hotmart_name text primary key,
  product_name text not null,
  updated_at   timestamptz not null default now()
);
alter table product_mappings disable row level security;
