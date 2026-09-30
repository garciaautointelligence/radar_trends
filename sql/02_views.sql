-- Ranking da coleta mais recente de cada região
create or replace view public.v_latest_ranking
with (security_invoker = true) as
with latest as (
  select distinct on (region) id, region, collected_at
  from public.collections
  order by region, collected_at desc
)
select l.region, l.collected_at,
       e.rank, e.term, e.term_key,
       e.traffic_label, e.traffic_min, e.published_at, e.news
from latest l
join public.trend_entries e on e.collection_id = l.id;

-- Histórico de um termo ao longo do tempo
create or replace view public.v_term_history
with (security_invoker = true) as
select c.region, c.collected_at, e.term_key, e.term, e.rank, e.traffic_min
from public.trend_entries e
join public.collections c on c.id = e.collection_id;