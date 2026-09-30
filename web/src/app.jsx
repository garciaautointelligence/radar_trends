import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from './supabase'

const REGION = 'BR'
const INTERVAL_MIN = 30
const TZ = 'America/Sao_Paulo'
const PERIODS = {
  '6h': { label: '6 horas', hours: 6 },
  '24h': { label: '24 horas', hours: 24 },
  '7d': { label: '7 dias', hours: 168 },
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

function TermDetail({ termKey, current }) {
  const [period, setPeriod] = useState('24h')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [termKey])

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    const since = new Date(Date.now() - PERIODS[period].hours * 3600 * 1000).toISOString()

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
  }, [termKey, period])

  const stats = useMemo(() => {
    if (!data) return null
    const present = data.points.filter((p) => p.rank != null)
    let streak = 0
    for (let i = data.points.length - 1; i >= 0; i--) {
      if (data.points[i].rank == null) break
      streak++
    }
    return {
      present: present.length,
      total: data.points.length,
      best: present.length ? Math.min(...present.map((p) => p.rank)) : null,
      streak,
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
                {stats.streak ? fmtDuration(stats.streak * INTERVAL_MIN) : '—'}
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
            <p className="meta">Posição 1 no topo. Trechos sem linha = o termo saiu da lista naquela coleta.</p>
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

export default function App() {
  const termKey = useHashTerm()
  const [rows, setRows] = useState([])
  const [movers, setMovers] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('v_latest_ranking').select('*').eq('region', REGION).order('rank'),
      supabase.from('v_movers').select('*').eq('region', REGION),
    ]).then(([r, m]) => {
      if (r.error) setError(r.error.message)
      else setRows(r.data)
      if (!m.error) setMovers(m.data) // Emergindo é opcional: sem a view, só não aparece
      setLoading(false)
    })
  }, [])

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
      </header>

      {loading && <p className="meta">Carregando...</p>}
      {error && <p className="warn">Erro: {error}</p>}

      {termKey ? (
        <TermDetail termKey={termKey} current={rows.find((r) => r.term_key === termKey)} />
      ) : (
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
                  <span className="vol">{fmtVol(r.traffic_min)}</span>
                </li>
              )
            })}
          </ol>

          <p className="meta" style={{ marginTop: 24 }}>
            Posição = ordem de exibição no Google Trends. Volume = estimativa mínima de buscas.
          </p>
        </>
      )}
    </main>
  )
}