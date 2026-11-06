alter table public.news_sources
  add column if not exists logo_url text;

alter table public.news_sources
  drop constraint if exists news_sources_logo_url_length;

alter table public.news_sources
  add constraint news_sources_logo_url_length
  check (logo_url is null or char_length(logo_url) <= 2048);

notify pgrst, 'reload schema';
