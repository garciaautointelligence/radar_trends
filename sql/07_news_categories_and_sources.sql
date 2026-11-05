alter table public.news_sources
  add column if not exists categories text[] not null default array['Brasil']::text[];

alter table public.news_sources
  drop constraint if exists news_sources_categories_allowed;

alter table public.news_sources
  add constraint news_sources_categories_allowed
  check (
    cardinality(categories) between 1 and 5
    and categories <@ array['Brasil', 'Internacional', 'Política', 'Economia', 'Breaking News']::text[]
  );

insert into public.news_sources (name, feed_url, categories, active)
values
  (
    'G1',
    'https://g1.globo.com/rss/g1/',
    array['Brasil', 'Política', 'Economia', 'Breaking News']::text[],
    true
  ),
  (
    'EBC / Agência Brasil',
    'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml',
    array['Brasil', 'Economia']::text[],
    true
  ),
  (
    'UOL Notícias',
    'https://rss.uol.com.br/feed/noticias.xml',
    array['Brasil', 'Economia']::text[],
    true
  ),
  (
    'Metrópoles',
    'https://www.metropoles.com/feed',
    array['Brasil', 'Política']::text[],
    true
  ),
  (
    'Reuters',
    'https://news.google.com/rss/search?q=when:24h+site:reuters.com&ceid=US:en&hl=en-US&gl=US',
    array['Internacional', 'Economia', 'Breaking News']::text[],
    true
  ),
  (
    'CNN International',
    'https://news.google.com/rss/search?q=when:24h+site:edition.cnn.com&ceid=US:en&hl=en-US&gl=US',
    array['Internacional', 'Breaking News']::text[],
    true
  ),
  (
    'BBC News',
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    array['Internacional']::text[],
    true
  ),
  (
    'Associated Press (AP)',
    'https://news.google.com/rss/search?q=when:24h+site:apnews.com&hl=en-US&gl=US&ceid=US:en',
    array['Internacional', 'Breaking News']::text[],
    true
  ),
  (
    'Agência Senado',
    'https://www12.senado.leg.br/noticias/rss.xml',
    array['Política']::text[],
    true
  ),
  (
    'Agência Câmara',
    'https://www.camara.leg.br/noticias/rss/ultimas-noticias',
    array['Política']::text[],
    true
  )
on conflict ((lower(name))) do update
set feed_url = excluded.feed_url,
    categories = excluded.categories,
    active = excluded.active;

notify pgrst, 'reload schema';
