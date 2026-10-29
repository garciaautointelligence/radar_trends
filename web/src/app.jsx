import { useCallback, useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from './supabase'

const REGION = 'BR'
const INTERVAL_MIN = 30
const TZ = 'America/Sao_Paulo'

const PERIODS = {
  hoje: { label: 'Hoje' },
  '24h': { label: '24 horas', hours: 24 },
  '7d': { label: '7 dias', hours: 168 },
}

// "Hoje" usa a meia-noite do fuso do dispositivo
const sinceFor = (key) => {
  if (key === 'hoje') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }
  return new Date(Date.now() - PERIODS[key].hours * 3600 * 1000).toISOString()
}

const fmtDate = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' })

const fmtTick = (iso, period) =>
  new Date(iso).toLocaleString(
    'pt-BR',
    period === '7d'
      ? { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { timeZone: TZ, hour: '2-digit', minute: '2-digit' }
  )

const fmtVol = (n) => {
  if (n == null) return 'sem volume'
  if (n >= 1_000_000) return `${n / 1_000_000} mi+`
  if (n >= 1_000) return `${n / 1_000} mil+`
  return `${n}+`
}

const fmtDuration = (minutes) => {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

const fmtAgo = (iso) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

const termLink = (termKey) => `#/t/${encodeURIComponent(termKey)}`

function useHashTerm() {
  const read = () => {
    const m = window.location.hash.match(/^#\/t\/(.+)$/)
    return m ? decodeURIComponent(m[1]) : null
  }
  const [termKey, setTermKey] = useState(read)
  useEffect(() => {
    const onChange = () => setTermKey(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return termKey
}

function Badge({ m }) {
  if (!m) return null
  if (m.rank_anterior == null) return <span className="badge new">novo</span>
  if (m.variacao > 0) return <span className="badge up">▲ {m.variacao}</span>
  if (m.variacao < 0) return <span className="badge down">▼ {-m.variacao}</span>
  return null
}

const TOPIC_RULES = [
  { name: 'Futebol', terms: ['futebol', 'flamengo', 'palmeiras', 'corinthians', 'sao paulo', 'santos', 'vasco', 'botafogo', 'brasileirao', 'selecao', 'neymar', 'libertadores', 'copa do brasil'] },
  { name: 'Política', terms: ['lula', 'bolsonaro', 'presidente', 'congresso', 'senado', 'camara', 'eleicao', 'governo', 'politica', 'brasilia', 'paulista'] },
  { name: 'Entretenimento', terms: ['bbb', 'novela', 'cantor', 'cantora', 'show', 'filme', 'serie', 'ator', 'atriz', 'celebridade'] },
  { name: 'Economia', terms: ['dolar', 'ibovespa', 'bolsa', 'inflacao', 'juros', 'selic', 'economia', 'imposto'] },
  { name: 'Tecnologia', terms: ['iphone', 'google', 'apple', 'chatgpt', 'inteligencia artificial', 'instagram', 'whatsapp', 'tecnologia'] },
]

const normalizeText = (value) =>
  (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const topicFor = (term) => {
  const normalized = normalizeText(term)
  return TOPIC_RULES.find((topic) => topic.terms.some((word) => normalized.includes(word)))?.name ?? term
}

function TrendingDashboard({ rows, refreshKey }) {
  const [comparison, setComparison] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setComparison(null)
    setError(null)
    const latest = rows[0]?.collected_at
    if (!latest) return () => { cancelled = true }

    const latestMs = new Date(latest).getTime()
    supabase.from('collections').select('collected_at').eq('region', REGION)
      .gte('collected_at', new Date(latestMs - 3 * 60 * 60 * 1000).toISOString())
      .lte('collected_at', latest).order('collected_at', { ascending: false }).limit(8)
      .then(async ({ data: collections, error: collectionError }) => {
        if (cancelled) return
        if (collectionError) { setError(collectionError.message); return }
        const baseline = (collections ?? []).slice(1).sort((a, b) =>
          Math.abs(new Date(a.collected_at).getTime() - (latestMs - 60 * 60 * 1000)) -
          Math.abs(new Date(b.collected_at).getTime() - (latestMs - 60 * 60 * 1000))
        )[0]
        if (!baseline) { setComparison({ baseline: null, ranks: new Map() }); return }
        const { data: history, error: historyError } = await supabase.from('v_term_history')
          .select('collected_at, term_key, rank').eq('region', REGION)
          .gte('collected_at', baseline.collected_at).lte('collected_at', latest)
        if (cancelled) return
        if (historyError) { setError(historyError.message); return }
        const ranks = new Map()
        history.forEach((entry) => {
          const snapshot = ranks.get(entry.collected_at) ?? new Map()
          snapshot.set(entry.term_key, entry.rank)
          ranks.set(entry.collected_at, snapshot)
        })
        setComparison({ baseline, ranks })
      })
    return () => { cancelled = true }
  }, [rows, refreshKey])

  const topics = useMemo(() => {
    if (!comparison?.baseline || !rows.length) return []
    const baselineRanks = comparison.ranks.get(comparison.baseline.collected_at) ?? new Map()
    const currentRanks = comparison.ranks.get(rows[0].collected_at) ?? new Map()
    const groups = new Map()
    rows.forEach((row) => {
      const rankNow = currentRanks.get(row.term_key)
      if (rankNow == null) return
      const rankBefore = baselineRanks.get(row.term_key) ?? null
      const variation = rankBefore == null ? null : rankBefore - rankNow
      const name = topicFor(row.term)
      const items = groups.get(name) ?? []
      const status = rankBefore == null ? 'novo' : variation > 0 ? 'subindo' : variation < 0 ? 'caindo' : 'estavel'
      items.push({ ...row, mover: { rank_atual: rankNow, rank_anterior: rankBefore, variacao: variation, status } })
      groups.set(name, items)
    })
    return [...groups.entries()].map(([name, items]) => {
      const risingItems = items.filter(({ mover }) => mover.status === 'novo' || mover.status === 'subindo')
      const urgent = risingItems.length >= 2 || risingItems.some(({ mover }) => mover.status === 'novo' && mover.rank_atual <= 3)
      const movement = risingItems.reduce((sum, { mover }) => sum + Math.max(0, mover.variacao ?? 0), 0)
      return { name, items, risingItems, urgent, movement, bestRank: Math.min(...items.map(({ mover }) => mover.rank_atual)), maxTraffic: Math.max(0, ...items.map((item) => item.traffic_min ?? 0)), status: risingItems.length ? 'Em alta' : items.some(({ mover }) => mover.status === 'caindo') ? 'Perdendo força' : 'Estável' }
    }).sort((a, b) => b.risingItems.length - a.risingItems.length || b.movement - a.movement || a.bestRank - b.bestRank)
  }, [rows, comparison])

  const dashboardStats = useMemo(() => {
    const risingTopics = topics.filter((topic) => topic.risingItems.length > 0)
    const risingTerms = risingTopics.reduce((sum, topic) => sum + topic.risingItems.length, 0)
    const newTerms = risingTopics.reduce((sum, topic) => sum + topic.risingItems.filter(({ mover }) => mover.status === 'novo').length, 0)
    return { risingTopics, risingTerms, newTerms, lead: risingTopics[0] ?? null }
  }, [topics])

  return (
    <section className="trending-dashboard">
      <p className="meta">Comparação com a coleta mais próxima de uma hora atrás. “Urgente” indica dois ou mais termos em alta, ou um termo novo entre os três primeiros.</p>
      {error && <p className="warn">Erro ao carregar o histórico: {error}</p>}
      {!comparison && !error && <p className="meta">Calculando tendências da última hora…</p>}
      {comparison && !comparison.baseline && <p className="meta">Ainda não há uma coleta anterior para comparar.</p>}
      {comparison?.baseline && (
        <>
        <div className="dashboard-stats">
          <article><strong>{dashboardStats.risingTopics.length}</strong><span>assuntos em alta</span></article>
          <article><strong>{dashboardStats.risingTerms}</strong><span>termos subindo</span></article>
          <article><strong>{dashboardStats.newTerms}</strong><span>termos novos</span></article>
          <article><strong>{topics.length}</strong><span>assuntos monitorados</span></article>
        </div>
        {dashboardStats.lead && <article className="lead-topic">
          <div><span className="eyebrow">DESTAQUE DO MOMENTO</span><h2>{dashboardStats.lead.name}</h2>
            <p>{dashboardStats.lead.risingItems.length} {dashboardStats.lead.risingItems.length === 1 ? 'termo em alta' : 'termos em alta'} · melhor posição #{dashboardStats.lead.bestRank}</p></div>
          <span className="lead-rank">#{dashboardStats.lead.bestRank}</span>
        </article>}
        {dashboardStats.risingTopics.length === 0 && <p className="meta">Nenhum assunto subiu nesta hora. Os assuntos monitorados aparecem abaixo.</p>}
        <h2 className="dashboard-section-title">Assuntos monitorados</h2>
        <div className="topic-grid">
          {topics.map((topic) => (
            <article className={`topic-card${topic.urgent ? ' urgent' : ''}`} key={topic.name}>
              <div className="topic-heading">
                <h2>{topic.name}</h2>
                <span className={`topic-status${topic.risingItems.length ? ' rising' : ''}`}>{topic.urgent ? 'URGENTE · EM ALTA' : topic.status.toUpperCase()}</span>
              </div>
              <p className="meta">{topic.risingItems.length} em alta de {topic.items.length} termos · maior volume: {fmtVol(topic.maxTraffic)}</p>
              <ul className="topic-items">
                {topic.items.map((item) => {
                  const news = item.news?.[0]
                  return <li key={item.term_key}>
                    <a href={termLink(item.term_key)}>{item.term}</a>
                    <Badge m={item.mover} />
                    <span className="topic-detail">#{item.mover.rank_atual}{item.mover.variacao > 0 ? ` · subiu ${item.mover.variacao}` : item.mover.variacao < 0 ? ` · caiu ${-item.mover.variacao}` : item.mover.status === 'novo' ? ' · novo' : ' · sem variação'} · {fmtVol(item.traffic_min)}</span>
                    {news?.title && (news.url?.startsWith('http')
                      ? <a className="news" href={news.url} target="_blank" rel="noreferrer">{news.title}</a>
                      : <span className="news">{news.title}</span>)}
                  </li>
                })}
              </ul>
            </article>
          ))}
        </div>
        <p className="dashboard-note">Volume é uma estimativa mínima em faixas fornecida pelo Google Trends, não o total exato de buscas. Os grupos por assunto são classificações automáticas por palavras-chave.</p>
        </>
      )}
    </section>
  )
}

/* ---------- Pesquisa comparativa do Google Trends ---------- */

const SEARCH_PERIODS = {
  'today 1-m': '30 dias',
  'today 3-m': '90 dias',
}

function SearchComparison() {
  const [terms, setTerms] = useState(['', '', ''])
  const [period, setPeriod] = useState('today 1-m')
  const [comparison, setComparison] = useState(null)
  const [error, setError] = useState(null)

  const submit = (event) => {
    event.preventDefault()
    const selectedTerms = terms.map((term) => term.trim()).filter(Boolean)
    if (!selectedTerms.length) {
      setError('Informe pelo menos um termo para pesquisar.')
      setComparison(null)
      return
    }
    if (new Set(selectedTerms.map(normalizeText)).size !== selectedTerms.length) {
      setError('Remova os termos repetidos para fazer a comparação.')
      setComparison(null)
      return
    }
    setError(null)
    setComparison({ terms: selectedTerms, period })
  }

  const googleTrendsUrl = useMemo(() => {
    if (!comparison) return null
    const params = new URLSearchParams({
      hl: 'pt-BR',
      tz: '180',
      date: comparison.period,
      geo: 'BR',
      q: comparison.terms.join(','),
    })
    return `https://trends.google.com/trends/explore?${params.toString()}`
  }, [comparison])

  const embedUrl = useMemo(() => {
    if (!comparison) return null
    const params = new URLSearchParams({
      hl: 'pt-BR',
      tz: '180',
      date: comparison.period,
      geo: 'BR',
      q: comparison.terms.join(','),
      cmpt: 'q',
      content: '1',
      cid: 'TIMESERIES_GRAPH_0',
      export: '5',
      w: '720',
      h: '500',
    })
    return `https://trends.google.com/trends/embed/explore/TIMESERIES?${params.toString()}`
  }, [comparison])

  return (
    <section className="search-comparison">
      <h2 className="section-title">Comparar pesquisas</h2>
      <p className="meta">
        Compare até 3 termos no Brasil. O Google Trends mostra interesse relativo de 0 a 100,
        não o número absoluto de buscas.
      </p>
      <form className="search-form" onSubmit={submit}>
        {terms.map((term, index) => (
          <label className="search-field" key={index}>
            <span>{index === 0 ? 'Termo 1' : `Termo ${index + 1} (opcional)`}</span>
            <input
              type="search"
              maxLength={100}
              value={term}
              onChange={(event) => {
                const nextTerms = [...terms]
                nextTerms[index] = event.target.value
                setTerms(nextTerms)
              }}
              placeholder={index === 0 ? 'Ex.: café' : 'Ex.: chá'}
            />
          </label>
        ))}
        <label className="search-field">
          <span>Período (dados diários)</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value)}>
            {Object.entries(SEARCH_PERIODS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <button className="collect search-submit" type="submit">Comparar no Google Trends</button>
      </form>

      {error && <p className="warn" role="alert">{error}</p>}
      {embedUrl && googleTrendsUrl && (
        <>
          <div className="search-chart">
            <iframe
              title={`Comparação no Google Trends: ${comparison.terms.join(', ')}`}
              src={embedUrl}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <p className="meta">
            Índice relativo: 100 representa o pico de popularidade no período e na região escolhidos.
            <a className="search-link" href={googleTrendsUrl} target="_blank" rel="noreferrer">
              Abrir comparação no Google Trends
            </a>
          </p>
        </>
      )}
    </section>
  )
}

/* ---------- Detalhe de um termo (gráfico) ---------- */

function TermDetail({ termKey, current, initialPeriod, refreshKey }) {
  const [period, setPeriod] = useState(initialPeriod)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [termKey])

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    const since = sinceFor(period)

    Promise.all([
      supabase
        .from('collections')
        .select('collected_at')
        .eq('region', REGION)
        .gte('collected_at', since)
        .order('collected_at'),
      supabase
        .from('v_term_history')
        .select('collected_at, term, rank, traffic_min')
        .eq('region', REGION)
        .eq('term_key', termKey)
        .gte('collected_at', since),
    ]).then(([cols, hist]) => {
      if (cancelled) return
      const err = cols.error || hist.error
      if (err) {
        setError(err.message)
        return
      }
      // Uma posição por coleta (se o termo aparecer 2x, vale a melhor)
      const byTime = new Map()
      hist.data.forEach((h) => {
        const prev = byTime.get(h.collected_at)
        byTime.set(h.collected_at, prev == null ? h.rank : Math.min(prev, h.rank))
      })
      // Coletas em que o termo NÃO estava na lista ficam como null (linha quebrada)
      const points = cols.data.map((c) => ({
        t: c.collected_at,
        rank: byTime.get(c.collected_at) ?? null,
      }))
      const volumes = hist.data.map((h) => h.traffic_min).filter((v) => v != null)
      setData({
        points,
        term: hist.data[0]?.term,
        maxVol: volumes.length ? Math.max(...volumes) : null,
      })
    })

    return () => {
      cancelled = true
    }
  }, [termKey, period, refreshKey])

  const stats = useMemo(() => {
    if (!data) return null
    const pts = data.points
    const present = pts.filter((p) => p.rank != null)
    let streak = 0
    for (let i = pts.length - 1; i >= 0; i--) {
      if (pts[i].rank == null) break
      streak++
    }
    // Duração pelos horários reais (há coletas manuais fora do intervalo de 30 min)
    const streakMin = streak
      ? Math.round(
          (new Date(pts[pts.length - 1].t).getTime() -
            new Date(pts[pts.length - streak].t).getTime()) /
            60000
        ) + INTERVAL_MIN
      : 0
    return {
      present: present.length,
      total: pts.length,
      best: present.length ? Math.min(...present.map((p) => p.rank)) : null,
      streakMin,
    }
  }, [data])

  const title = current?.term ?? data?.term ?? termKey
  const news = current?.news ?? []

  return (
    <section>
      <a href="#/" className="back">
        ← Voltar ao ranking
      </a>
      <h2 className="term-title">{title}</h2>

      <div className="periods">
        {Object.entries(PERIODS).map(([key, p]) => (
          <button
            key={key}
            className={key === period ? 'active' : ''}
            onClick={() => setPeriod(key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <p className="warn">Erro: {error}</p>}
      {!data && !error && <p className="meta">Carregando...</p>}

      {data && stats && stats.present === 0 && (
        <p className="meta">Este termo não apareceu na lista neste período.</p>
      )}

      {data && stats && stats.present > 0 && (
        <>
          <div className="stats">
            <div>
              <span className="stat-n">#{stats.best}</span>
              <span className="stat-l">melhor posição</span>
            </div>
            <div>
              <span className="stat-n">
                {stats.present}/{stats.total}
              </span>
              <span className="stat-l">coletas na lista</span>
            </div>
            <div>
              <span className="stat-n">
                {stats.streakMin ? fmtDuration(stats.streakMin) : '—'}
              </span>
              <span className="stat-l">seguido na lista até agora</span>
            </div>
            <div>
              <span className="stat-n">{fmtVol(data.maxVol)}</span>
              <span className="stat-l">maior volume</span>
            </div>
          </div>

          <div className="chart">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.points} margin={{ top: 10, right: 16, bottom: 0, left: -10 }}>
                <XAxis
                  dataKey="t"
                  tickFormatter={(v) => fmtTick(v, period)}
                  tick={{ fill: '#9aa3b8', fontSize: 12 }}
                  minTickGap={40}
                />
                <YAxis
                  reversed
                  domain={[1, 10]}
                  allowDecimals={false}
                  tick={{ fill: '#9aa3b8', fontSize: 12 }}
                  tickFormatter={(v) => `#${v}`}
                />
                <Tooltip
                  labelFormatter={(v) => fmtDate(v)}
                  formatter={(v) => [`#${v}`, 'Posição']}
                />
                <Line
                  type="linear"
                  dataKey="rank"
                  stroke="#ff7a45"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="meta">
              Posição 1 no topo. Trechos sem linha = o termo saiu da lista naquela coleta.
            </p>
          </div>
        </>
      )}

      {news.length > 0 && (
        <div className="news-block">
          <h3 className="section-title">Notícias relacionadas</h3>
          <ul className="news-list">
            {news
              .filter((n) => n?.title)
              .map((n, i) => (
                <li key={i}>
                  {n.url?.startsWith('http') ? (
                    <a href={n.url} target="_blank" rel="noreferrer">
                      {n.source ? `${n.source}: ` : ''}
                      {n.title}
                    </a>
                  ) : (
                    n.title
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/* ---------- Ranking geral por período (Hoje / 24 horas / 7 dias) ---------- */

function PeriodSummary({ period, refreshKey }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    supabase
      .rpc('term_summary', { p_region: REGION, p_since: sinceFor(period) })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        else setData(data)
      })
    return () => {
      cancelled = true
    }
  }, [period, refreshKey])

  const total = data?.[0]?.total_collections ?? 0
  const shown = data ? data.slice(0, 30) : []

  return (
    <section>
      {error && <p className="warn">Erro: {error}</p>}
      {!data && !error && <p className="meta">Carregando...</p>}
      {data && data.length === 0 && <p className="meta">Sem coletas neste período.</p>}

      {data && data.length > 0 && (
        <>
          <p className="meta">
            {total} coletas no período. Termos ordenados pela presença na lista (top {shown.length}).
          </p>
          <ol className="list">
            {shown.map((r, i) => {
              const pct = Math.round((r.appearances / r.total_collections) * 100)
              return (
                <li
                  key={r.term_key}
                  className="card clickable"
                  onClick={() => {
                    window.location.hash = termLink(r.term_key)
                  }}
                >
                  <span className="rank">{i + 1}</span>
                  <div className="info">
                    <a href={termLink(r.term_key)} className="term">
                      {r.term}
                    </a>
                    <div className="bar">
                      <div className="bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="news">
                      melhor posição #{r.best_rank} · maior volume{' '}
                      {r.max_traffic != null ? fmtVol(r.max_traffic) : '—'} · visto por último em{' '}
                      {fmtDate(r.last_seen)}
                    </span>
                  </div>
                  <span className="vol">
                    {r.appearances}/{r.total_collections}
                  </span>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </section>
  )
}

/* ---------- Rankings: por volume e por horário de início ---------- */

const RANK_PERIODS = {
  agora: { label: 'Agora' },
  hoje: { label: 'Hoje' },
  '24h': { label: '24 horas' },
  '7d': { label: '7 dias' },
}

function Rankings({ updatedAt, refreshKey }) {
  const [period, setPeriod] = useState('24h')
  const [by, setBy] = useState('volume') // 'volume' | 'inicio'
  const [oldestFirst, setOldestFirst] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    // "Agora" = somente a coleta mais recente
    const since = period === 'agora' ? updatedAt : sinceFor(period)
    if (!since) return
    let cancelled = false
    setData(null)
    setError(null)
    supabase
      .rpc('term_rankings', { p_region: REGION, p_since: since })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        else setData(data)
      })
    return () => {
      cancelled = true
    }
  }, [period, updatedAt, refreshKey])

  const sorted = useMemo(() => {
    if (!data) return []
    const arr = [...data]
    if (by === 'volume') {
      // Volume vem em faixas (200+, 500+...), então há empates: desempata pela melhor posição
      arr.sort(
        (a, b) =>
          (b.traffic_min ?? -1) - (a.traffic_min ?? -1) ||
          a.best_rank - b.best_rank ||
          b.appearances - a.appearances
      )
    } else {
      // Sem horário de início, o termo vai para o fim da lista
      arr.sort((a, b) => {
        const sa = a.started_at ? Date.parse(a.started_at) : null
        const sb = b.started_at ? Date.parse(b.started_at) : null
        if (sa == null && sb == null) return 0
        if (sa == null) return 1
        if (sb == null) return -1
        return oldestFirst ? sa - sb : sb - sa
      })
    }
    return arr.slice(0, 30)
  }, [data, by, oldestFirst])

  const maxVol = useMemo(
    () => Math.max(1, ...sorted.map((r) => r.traffic_min ?? 0)),
    [sorted]
  )
  // Barra em escala logarítmica (as faixas de volume variam muito)
  const barPct = (v) => {
    if (!v) return 0
    if (maxVol <= 1) return 100
    return Math.max(8, Math.round((Math.log10(v) / Math.log10(maxVol)) * 100))
  }

  return (
    <section>
      <p className="meta" style={{ marginTop: 16 }}>
        Ordenar por
      </p>
      <div className="periods" style={{ marginTop: 6 }}>
        <button className={by === 'volume' ? 'active' : ''} onClick={() => setBy('volume')}>
          Maior volume
        </button>
        <button className={by === 'inicio' ? 'active' : ''} onClick={() => setBy('inicio')}>
          Horário de início
        </button>
      </div>
      {by === 'inicio' && (
        <div className="periods" style={{ marginTop: 0 }}>
          <button className={!oldestFirst ? 'active' : ''} onClick={() => setOldestFirst(false)}>
            Mais recentes primeiro
          </button>
          <button className={oldestFirst ? 'active' : ''} onClick={() => setOldestFirst(true)}>
            Mais antigos primeiro
          </button>
        </div>
      )}

      <p className="meta">Período</p>
      <div className="periods" style={{ marginTop: 6 }}>
        {Object.entries(RANK_PERIODS).map(([key, p]) => (
          <button
            key={key}
            className={key === period ? 'active' : ''}
            onClick={() => setPeriod(key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <p className="warn">Erro: {error}</p>}
      {!data && !error && <p className="meta">Carregando...</p>}
      {data && data.length === 0 && <p className="meta">Sem coletas neste período.</p>}

      {data && data.length > 0 && (
        <>
          <p className="meta">
            Top {sorted.length} de {data.length} termos. Em Hoje, 24 horas e 7 dias, o volume é o
            maior já visto no período; "Agora" considera só a última coleta.
          </p>
          <ol className="list">
            {sorted.map((r, i) => (
              <li
                key={r.term_key}
                className="card clickable"
                onClick={() => {
                  window.location.hash = termLink(r.term_key)
                }}
              >
                <span className="rank">{i + 1}</span>
                <div className="info">
                  <a href={termLink(r.term_key)} className="term">
                    {r.term}
                  </a>
                  {by === 'volume' && (
                    <div className="bar">
                      <div className="bar-fill" style={{ width: `${barPct(r.traffic_min)}%` }} />
                    </div>
                  )}
                  <span className="news">
                    Início:{' '}
                    {r.started_at
                      ? `${fmtDate(r.started_at)} (${fmtAgo(r.started_at)})`
                      : 'não informado'}{' '}
                    · Volume: {r.traffic_min != null ? fmtVol(r.traffic_min) : '—'} · Melhor posição:
                    #{r.best_rank}
                  </span>
                </div>
                <span className="vol">
                  {by === 'volume'
                    ? r.traffic_min != null
                      ? fmtVol(r.traffic_min)
                      : '—'
                    : r.started_at
                      ? fmtAgo(r.started_at)
                      : '—'}
                </span>
              </li>
            ))}
          </ol>
          <p className="meta" style={{ marginTop: 24 }}>
            Volume = estimativa mínima do Google (faixas como 200+, 500+, 1 mil+), por isso há muitos
            empates; neles vale a melhor posição na lista. Início = horário em que a tendência
            começou, conforme o feed.
          </p>
        </>
      )}
    </section>
  )
}

/* ---------- App ---------- */

export default function App() {
  const termKey = useHashTerm()
  const [rows, setRows] = useState([])
  const [movers, setMovers] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState('agora') // 'agora' | 'hoje' | '24h' | '7d'
  const [refreshKey, setRefreshKey] = useState(0)
  const [collecting, setCollecting] = useState(false)
  const [notice, setNotice] = useState(null) // { type: 'ok' | 'warn' | 'error', text }

  const load = useCallback(async () => {
    const [r, m] = await Promise.all([
      supabase.from('v_latest_ranking').select('*').eq('region', REGION).order('rank'),
      supabase.from('v_movers').select('*').eq('region', REGION),
    ])
    if (r.error) setError(r.error.message)
    else {
      setError(null)
      setRows(r.data)
    }
    if (!m.error) setMovers(m.data) // Emergindo é opcional: sem a view, só não aparece
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (view !== 'dashboard') return undefined
    const refreshDashboard = async () => {
      await load()
      setRefreshKey((key) => key + 1)
    }
    refreshDashboard()
    const timer = window.setInterval(refreshDashboard, 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [view, load])

  const collectNow = async () => {
    setCollecting(true)
    setNotice(null)
    try {
      const resp = await fetch('/api/collect', { method: 'POST' })
      let body = null
      try {
        body = await resp.json()
      } catch {
        body = null
      }
      if (!body) {
        setNotice({
          type: 'error',
          text: 'Resposta inesperada do servidor. A coleta manual só funciona no site publicado.',
        })
      } else if (resp.ok && body.ok) {
        setNotice({ type: 'ok', text: `Coleta concluída: ${body.items} termos.` })
        await load()
        setRefreshKey((k) => k + 1)
      } else if (resp.status === 429) {
        setNotice({
          type: 'warn',
          text: `Já atualizado há pouco. Tente de novo em ${body.retryAfterMin ?? 'alguns'} min.`,
        })
      } else {
        setNotice({ type: 'error', text: body.error ?? `Falha na coleta (status ${resp.status}).` })
      }
    } catch {
      setNotice({ type: 'error', text: 'Não foi possível falar com o servidor.' })
    } finally {
      setCollecting(false)
    }
  }

  const updatedAt = rows[0]?.collected_at
  const stale = updatedAt && Date.now() - new Date(updatedAt).getTime() > 2 * 60 * 60 * 1000

  // Só compara se existir coleta anterior (senão tudo seria "novo")
  const hasBaseline = movers.some((m) => m.rank_anterior != null)
  const moverMap = useMemo(
    () => (hasBaseline ? new Map(movers.map((m) => [m.term_key, m])) : new Map()),
    [movers, hasBaseline]
  )
  const emerging = useMemo(() => {
    if (!hasBaseline) return []
    const novos = movers
      .filter((m) => m.rank_anterior == null)
      .sort((a, b) => a.rank_atual - b.rank_atual)
    const subiram = movers.filter((m) => m.variacao > 0).sort((a, b) => b.variacao - a.variacao)
    return [...novos, ...subiram].slice(0, 6)
  }, [movers, hasBaseline])

  return (
    <main className="wrap">
      <header>
        <h1>
          <a href="#/" className="brand">
            Radar
          </a>
        </h1>
        <p className="sub">O que o Brasil está pesquisando agora</p>
        {updatedAt && <p className="meta">Atualizado em {fmtDate(updatedAt)}</p>}
        {stale && <p className="warn">Dados com mais de 2 horas.</p>}
        <div className="actions">
          <button className={`dashboard-button${view === 'dashboard' ? ' active' : ''}`} onClick={() => setView('dashboard')}>
            Dashboard
          </button>
          <button className="collect" onClick={collectNow} disabled={collecting}>
            {collecting ? 'Coletando…' : 'Coletar agora'}
          </button>
        </div>
        {notice && <p className={`notice ${notice.type}`}>{notice.text}</p>}
      </header>

      {loading && <p className="meta">Carregando...</p>}
      {error && <p className="warn">Erro: {error}</p>}

      {termKey ? (
        <TermDetail
          termKey={termKey}
          current={rows.find((r) => r.term_key === termKey)}
          initialPeriod={PERIODS[view] ? view : '24h'}
          refreshKey={refreshKey}
        />
      ) : (
        <>
          <div className="tabs">
            {[
              ['agora', 'Agora'],
              ['rankings', 'Rankings'],
              ['pesquisa', 'Pesquisa'],
              ...Object.entries(PERIODS).map(([key, p]) => [key, p.label]),
            ].map(([key, label]) => (
              <button
                key={key}
                className={key === view ? 'active' : ''}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {view === 'pesquisa' ? (
            <SearchComparison />
          ) : view === 'dashboard' ? (
            <TrendingDashboard rows={rows} refreshKey={refreshKey} />
          ) : view === 'agora' ? (
            <>
              {emerging.length > 0 && (
                <section className="emerging">
                  <h3 className="section-title">Emergindo</h3>
                  <p className="meta">Novos na lista ou que subiram desde a coleta anterior.</p>
                  <div className="chips">
                    {emerging.map((m) => (
                      <a key={m.term_key} href={termLink(m.term_key)} className="chip">
                        <span className="chip-term">{m.term}</span>
                        <Badge m={m} />
                      </a>
                    ))}
                  </div>
                </section>
              )}

              <p className="meta" style={{ marginTop: 16 }}>
                Clique em um termo para ver o histórico.
              </p>

              <ol className="list">
                {rows.map((r) => {
                  const news = r.news?.[0]
                  const hasLink = news?.url?.startsWith('http')
                  return (
                    <li
                      key={r.rank}
                      className="card clickable"
                      onClick={() => {
                        window.location.hash = termLink(r.term_key)
                      }}
                    >
                      <span className="rank">{r.rank}</span>
                      <div className="info">
                        <div className="title-row">
                          <a href={termLink(r.term_key)} className="term">
                            {r.term}
                          </a>
                          <Badge m={moverMap.get(r.term_key)} />
                        </div>
                        {news?.title &&
                          (hasLink ? (
                            <a
                              href={news.url}
                              target="_blank"
                              rel="noreferrer"
                              className="news"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {news.source ? `${news.source}: ` : ''}
                              {news.title}
                            </a>
                          ) : (
                            <span className="news">{news.title}</span>
                          ))}
                      </div>
                      <span className="vol">{fmtVol(r.traffic_min)} ›</span>
                    </li>
                  )
                })}
              </ol>

              <p className="meta" style={{ marginTop: 24 }}>
                Posição = ordem de exibição no Google Trends. Volume = estimativa mínima de buscas.
              </p>
            </>
          ) : view === 'rankings' ? (
            <Rankings updatedAt={updatedAt} refreshKey={refreshKey} />
          ) : (
            <PeriodSummary period={view} refreshKey={refreshKey} />
          )}
        </>
      )}
    </main>
  )
}
