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
