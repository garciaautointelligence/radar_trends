create table public.news_sources (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  feed_url           text not null,
  active             boolean not null default true,
  last_fetched_at    timestamptz,
  last_attempted_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint news_sources_name_length check (char_length(name) between 2 and 60),
  constraint news_sources_feed_url_length check (char_length(feed_url) between 1 and 2048)
);

create unique index news_sources_name_lower_unique on public.news_sources (lower(name));

create table public.news_articles (
  id            bigint generated always as identity primary key,
  source_id     uuid not null references public.news_sources(id) on delete cascade,
  title         text not null,
  url           text not null,
  summary       text,
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  unique (source_id, url)
);

create index news_articles_source_published on public.news_articles (source_id, published_at desc);
create index news_articles_fetched on public.news_articles (source_id, fetched_at);

alter table public.news_sources enable row level security;
alter table public.news_articles enable row level security;

create policy "leitura publica de fontes ativas" on public.news_sources
  for select to anon, authenticated using (active);

create policy "leitura publica de noticias de fontes ativas" on public.news_articles
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.news_sources s
      where s.id = news_articles.source_id and s.active
    )
  );

grant select on public.news_sources, public.news_articles to anon, authenticated;

create or replace function public.touch_news_source_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger news_sources_updated_at
before update on public.news_sources
for each row execute function public.touch_news_source_updated_at();

notify pgrst, 'reload schema';
