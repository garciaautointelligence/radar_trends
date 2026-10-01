-- Dados para a aba "Rankings": por termo, no período escolhido, traz o maior
-- volume, o horário de início da tendência, a melhor posição e a presença.
-- A ordenação (por volume ou por início) é feita no site.
-- Rode no SQL Editor do Supabase. Salve como sql/05_term_rankings.sql.

create or replace function public.term_rankings(
  p_region text,
  p_since  timestamptz
)
returns table (
  term_key      text,
  term          text,
  traffic_min   int,
  traffic_label text,
  started_at    timestamptz,
  best_rank     int,
  appearances   int,
  last_seen     timestamptz
)
language sql
stable
as $$
  with cols as (
    select c.id, c.collected_at
    from public.collections c
    where c.region = p_region
      and c.collected_at >= p_since
  )
  select
    e.term_key,
    (array_agg(e.term order by cols.collected_at desc))[1]  as term,
    max(e.traffic_min)::int                                 as traffic_min,
    (array_agg(e.traffic_label
               order by e.traffic_min desc nulls last, cols.collected_at desc))[1]
                                                            as traffic_label,
    min(e.published_at)                                     as started_at,
    min(e.rank)::int                                        as best_rank,
    count(distinct cols.id)::int                            as appearances,
    max(cols.collected_at)                                  as last_seen
  from public.trend_entries e
  join cols on cols.id = e.collection_id
  group by e.term_key
$$;

-- Leitura pública (a função respeita o RLS das tabelas: só select)
grant execute on function public.term_rankings(text, timestamptz)
  to anon, authenticated;

-- Atualiza o cache da API para a função aparecer no site
notify pgrst, 'reload schema';