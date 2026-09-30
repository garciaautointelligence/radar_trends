-- Resumo dos termos em um período: quantas coletas cada termo apareceu,
-- melhor posição, maior volume e última vez visto.
-- Rode no SQL Editor do Supabase. Salve como sql/04_term_summary.sql.

create or replace function public.term_summary(
  p_region text,
  p_since  timestamptz
)
returns table (
  term_key          text,
  term              text,
  appearances       int,
  total_collections int,
  best_rank         int,
  max_traffic       int,
  first_seen        timestamptz,
  last_seen         timestamptz
)
language sql
stable
as $$
  with cols as (
    select c.id, c.collected_at
    from public.collections c
    where c.region = p_region
      and c.collected_at >= p_since
  ),
  tot as (
    select count(*)::int as n from cols
  )
  select
    e.term_key,
    (array_agg(e.term order by cols.collected_at desc))[1] as term,
    count(distinct cols.id)::int                           as appearances,
    (select n from tot)                                    as total_collections,
    min(e.rank)::int                                       as best_rank,
    max(e.traffic_min)::int                                as max_traffic,
    min(cols.collected_at)                                 as first_seen,
    max(cols.collected_at)                                 as last_seen
  from public.trend_entries e
  join cols on cols.id = e.collection_id
  group by e.term_key
  order by count(distinct cols.id) desc, min(e.rank) asc
$$;

-- Leitura pública (a função respeita o RLS das tabelas: só select)
grant execute on function public.term_summary(text, timestamptz)
  to anon, authenticated;