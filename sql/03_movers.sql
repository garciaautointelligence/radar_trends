-- Compara a coleta mais recente com a anterior
create or replace view public.v_movers
with (security_invoker = true) as
with ordered as (
  select id, region, collected_at,
         row_number() over (partition by region order by collected_at desc) as rn
  from public.collections
)
select cur.region,
       e.term, e.term_key,
       e.rank  as rank_atual,
       p.rank  as rank_anterior,
       case when p.rank is null then null else p.rank - e.rank end as variacao
from ordered cur
join public.trend_entries e on e.collection_id = cur.id
left join ordered prev on prev.region = cur.region and prev.rn = 2
left join public.trend_entries p
       on p.collection_id = prev.id and p.term_key = e.term_key
where cur.rn = 1;