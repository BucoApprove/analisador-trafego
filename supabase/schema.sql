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

-- Orçamento de tráfego mensal por produto (Placar v2)
create table if not exists orcamento_trafego (
  month      text    not null,
  product    text    not null,
  orcamento  numeric,          -- orçamento de tráfego do mês (R$)
  ticket     numeric,          -- ticket médio (histórico ou override manual)
  conversao  numeric,          -- taxa de conversão 0–1 (ex: 0.186 = 18,6%)
  updated_at timestamptz not null default now(),
  primary key (month, product)
);
alter table orcamento_trafego disable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

-- Produtos canônicos (substitui o hardcode em api/_produtos-canonicos.ts).
-- Gerenciado pela tela "Produtos Canônicos" no dashboard.
create table if not exists produtos_canonicos (
  product_id   bigint      not null,  -- product_id Hotmart (ou sentinela negativo)
  nome         text        not null,  -- nome canônico exibido no Placar
  categoria    text        not null check (categoria in ('core','porta','low')),
  goal_name    text,                  -- nome na tabela monthly_goals (pode ser null)
  intensivo_offer_codes text[],       -- offer codes que viram "Intensivo ENARE" (só para BUCO_PID)
  is_low_ticket boolean   not null default false,  -- se true, qualquer id desconhecido vira este produto
  is_intensivo_marker boolean not null default false, -- se true, é o sentinela -2016048
  updated_at   timestamptz not null default now(),
  primary key (product_id)
);
alter table produtos_canonicos disable row level security;

insert into produtos_canonicos (product_id, nome, categoria, goal_name, intensivo_offer_codes, is_low_ticket, is_intensivo_marker) values
  (2016048,   'Buco Approve',               'core',  'Buco Approve',      array['wgmh3qg1','32ypw9pk'], false, false),
  (-2016048,  'Intensivo ENARE',            'core',  null,                null,                         false, true),
  (3811518,   'Mentoria CTBMF',             'core',  'Mentoria',          null,                         false, false),
  (5694443,   'Pós Patologia',              'core',  'Pós Pato',          null,                         false, false),
  (6115663,   'Pós Anatomia',              'core',  'Pós Anato',         null,                         false, false),
  (6739963,   'Planejamento ImpulsoR+',     'core',  'Planejamento',      null,                         false, false),
  (3510472,   'Renovação de acesso',        'core',  'Renovação BA',      null,                         false, false),
  (4739673,   'Rota Enare',                'core',  null,                null,                         false, false),
  (2286372,   'BucoApp',                   'core',  null,                null,                         false, false),
  (7737553,   'Imersão ENARE',             'porta', null,                null,                         false, false),
  (7812483,   'Segurança Clínica por Casos','core', null,               null,                         false, false),
  (6766383,   'Low ticket',               'low',   'Low tickets',       null,                         true,  false)
on conflict (product_id) do nothing;

-- Ações rápidas do Placar por produto/dia (reunião matinal Gabriel + Bianco)
create table if not exists placar_acoes (
  id         uuid        primary key default gen_random_uuid(),
  data       date        not null default current_date,
  produto    text        not null,
  acao       text        not null default '',
  updated_at timestamptz not null default now(),
  unique (data, produto)
);
alter table placar_acoes disable row level security;

-- Revisão da ação: feita/não feita + comentário de retorno, preenchidos
-- posteriormente (ex: no dia seguinte, revisando o que foi feito no dia anterior).
alter table placar_acoes add column if not exists feita boolean not null default false;
alter table placar_acoes add column if not exists retorno text not null default '';

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

-- Nota: o matching campanha → produto da aba Placar reusa a tabela existente
-- campaign_produto_map (account, prefixo, produto_ids[], label), editável em
-- "Produtos/Campanhas" (TabConfigProdutos). Não há tabela própria do Placar.

-- ─────────────────────────────────────────────────────────────────────────────

-- Tags da Clint (CRM) por produto canônico, para contar Leads Clint no Placar.
-- Um produto pode ter várias tags (uma linha por tag). product_name = nome
-- canônico (ex: 'Imersão ENARE'); tag_id = UUID da tag na Clint.
create table if not exists clint_tags (
  id           uuid primary key default gen_random_uuid(),
  product_name text not null,
  tag_id       text not null,
  label        text not null default '',
  created_at   timestamptz not null default now(),
  unique (product_name, tag_id)
);
create index if not exists idx_clint_tags_product on clint_tags(product_name);
alter table clint_tags disable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

-- Tags do Green_Gold (BigQuery, campo tag_name) por produto canônico, para
-- separar leads pago vs orgânico no gráfico de distribuição do Placar.
-- Um produto pode ter várias tags (uma linha por tag). product_name = nome
-- canônico (ex: 'Imersão ENARE'); tag_name = valor exato do campo tag_name
-- no Green_Gold. "Pago" = lead cuja utm_campaign casa o prefixo em
-- campaign_produto_map; "orgânico" = demais leads com essa tag.
create table if not exists green_gold_tags (
  id           uuid primary key default gen_random_uuid(),
  product_name text not null,
  tag_name     text not null,
  created_at   timestamptz not null default now(),
  unique (product_name, tag_name)
);
create index if not exists idx_green_gold_tags_product on green_gold_tags(product_name);
alter table green_gold_tags disable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

-- Lançamentos (aba "Lançamentos"). Cada lançamento guarda os parâmetros para
-- puxar os dados (prefixo de campanha + filtros) e as datas-marco do funil.
-- A janela de dados do detalhe = captura_inicio → carrinho_fim.
create table if not exists lancamentos (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  prefixo         text not null default '',       -- prefixo do nome da campanha (ex: BA25)
  spend_filter    text not null default '',       -- keywords AND p/ gasto Meta
  or_filter       text not null default '',       -- keywords OR p/ gasto Meta
  data_inicio     date,                            -- início geral do lançamento
  captura_inicio  date,                            -- início da captura
  captura_fim     date,                            -- fim da captura
  carrinho_inicio date,                            -- abertura do carrinho
  carrinho_fim    date,                            -- fechamento do carrinho
  ordem           int not null default 0,          -- ordenação dos cards
  -- Config do detalhe (substitui o goals-data fixo da planilha do BA25):
  produto_venda        text not null default '',   -- filtro LIKE p/ Nome_do_Produto (ex: %buco%approve%)
  survey_sheet_id      text not null default '',   -- planilha de pesquisa de boas-vindas
  meta_leads_trafico   int  not null default 0,
  meta_leads_organico  int  not null default 0,
  meta_leads_manychat  int  not null default 0,
  orcamento_total      numeric not null default 0,
  orcamento_captura    numeric not null default 0,
  orcamento_descoberta numeric not null default 0,
  orcamento_aquecimento numeric not null default 0,
  orcamento_lembrete   numeric not null default 0,
  orcamento_remarketing numeric not null default 0,
  -- Tipo de lançamento e produtos vinculados (para metas de venda + cruzamento):
  --   interno = 3 aulas → captura lead → vende produto principal (ev. downsell)
  --   pago    = evento pago (ingresso já é venda) → vende produto principal + downsell
  tipo                    text not null default 'interno' check (tipo in ('interno', 'pago', 'meteórico')),
  produto_ingresso_id     int,                          -- só "pago": o produto do evento
  produto_principal_id    int,                          -- produto vendido após o lançamento
  produto_downsell_id     int,                          -- produto de downsell (opcional)
  produto_antecipado_id   int,                          -- só "meteórico": cupom/acesso antecipado vendido durante captação
  meta_vendas_ingresso    int not null default 0,       -- só "pago"
  meta_vendas_principal   int not null default 0,
  meta_vendas_downsell    int not null default 0,
  meta_vendas_antecipado  int not null default 0,       -- só "meteórico": meta de vendas do antecipado
  -- Campos do meteórico: aula única opcional antes do carrinho
  tem_aula        boolean not null default false,
  aula_data       date,
  aula_horario    text,                                 -- ex: '20:00'
  aula_tag        text,                                 -- tag da aula no BigQuery
  created_at      timestamptz not null default now()
);
alter table lancamentos disable row level security;
