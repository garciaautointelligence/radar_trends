import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const fmtDate = (iso) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  })

const fmtVol = (n) => {
  if (n == null) return 'sem volume'
  if (n >= 1_000_000) return `${n / 1_000_000} mi+`
  if (n >= 1_000) return `${n / 1_000} mil+`
  return `${n}+`
}

export default function App() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('v_latest_ranking')
      .select('*')
      .eq('region', 'BR')
      .order('rank')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setRows(data)
        setLoading(false)
      })
  }, [])

  const updatedAt = rows[0]?.collected_at
  const stale =
    updatedAt && Date.now() - new Date(updatedAt).getTime() > 2 * 60 * 60 * 1000

  return (
    <main className="wrap">
      <header>
        <h1>Radar</h1>
        <p className="sub">O que o Brasil está pesquisando agora</p>
        {updatedAt && <p className="meta">Atualizado em {fmtDate(updatedAt)}</p>}
        {stale && <p className="warn">Dados com mais de 2 horas.</p>}
      </header>

      {loading && <p className="meta">Carregando...</p>}
      {error && <p className="warn">Erro: {error}</p>}

            <ol className="list">
        {rows.map((r) => {
          const news = r.news?.[0]
          const hasLink = news?.url?.startsWith('http')

          return (
            <li key={r.rank} className="card">
              <span className="rank">{r.rank}</span>

              <div className="info">
                <span className="term">{r.term}</span>

                {news?.title &&
                  (hasLink ? (
                    <a
                      href={news.url}
                      target="_blank"
                      rel="noreferrer"
                      className="news"
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
    </main>
  )
}