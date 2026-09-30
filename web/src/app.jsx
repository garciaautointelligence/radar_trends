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
          initialPeriod={view === 'agora' ? '24h' : view}
          refreshKey={refreshKey}
        />
      ) : (
        <>
          <div className="tabs">
            {['agora', ...Object.keys(PERIODS)].map((key) => (
              <button
                key={key}
                className={key === view ? 'active' : ''}
                onClick={() => setView(key)}
              >
                {key === 'agora' ? 'Agora' : PERIODS[key].label}
              </button>
            ))}
          </div>

          {view === 'agora' ? (
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
          ) : (
            <PeriodSummary period={view} refreshKey={refreshKey} />
          )}
        </>
      )}
    </main>
  )
}
