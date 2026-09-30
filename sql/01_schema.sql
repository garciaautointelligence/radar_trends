create table public.collections (
  id           bigint generated always as identity primary key,
  region       text        not null default 'BR',
  source       text        not null default 'google_trends_rss',
  slot         timestamptz not null,            -- horário "arredondado" da coleta
  collected_at timestamptz not null default now(),
  items_count  int         not null,
  unique (region, slot)
);

create table public.trend_entries (
  id            bigint generated always as identity primary key,
  collection_id bigint not null references public.collections(id) on delete cascade,
  rank          int    not null,                -- ordem no feed
  term          text   not null,                -- título original
  term_key      text   not null,                -- minúsculo, sem acento (agrupar histórico)
  traffic_label text,                           -- ex.: "200+"
  traffic_min   int,                            -- número mínimo interpretado
  published_at  timestamptz,
  news          jsonb  not null default '[]'::jsonb,
  unique (collection_id, rank)
);

create index on public.collections (region, collected_at desc);
create index on public.trend_entries (term_key, collection_id);

-- Segurança: leitura pública, escrita só pela chave secreta (que ignora RLS)
alter table public.collections   enable row level security;
alter table public.trend_entries enable row level security;

create policy "leitura publica" on public.collections
  for select to anon, authenticated using (true);
create policy "leitura publica" on public.trend_entries
  for select to anon, authenticated using (true);