import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const fmt = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

export default function App() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase
      .from('v_latest_ranking')
      .select('*')
      .eq('region', 'BR')
      .order('rank')
      .then(({ data, error }) => (error ? setError(error.message) : setRows(data)))
  }, [])

  const updatedAt = rows[0]?.collected_at
  const stale = updatedAt && Date.now() - new Date(updatedAt).getTime() > 2 * 60 * 60 * 1000

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1>Radar</h1>
      <p>O que o Brasil está pesquisando agora</p>
      {updatedAt && <p>Atualizado em {fmt(updatedAt)}</p>}
      {stale && <p>⚠️ Dados com mais de 2 horas.</p>}
      {error && <p>Erro: {error}</p>}
      <ol>
        {rows.map((r) => (
          <li key={r.rank}>
            <strong>{r.term}</strong> — {r.traffic_label ?? 's/ volume'}
          </li>
        ))}
      </ol>
    </main>
  )
}