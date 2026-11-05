import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const NEWS_CATEGORIES = ['Brasil', 'Internacional', 'Política', 'Economia', 'Breaking News']

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : 'Data não informada'

async function postAdmin(action, values = {}) {
  const response = await fetch('/api/news-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...values }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) {
    const error = new Error(body?.error || `Falha na solicitação (status ${response.status}).`)
    error.status = response.status
    throw error
  }
  return body
}

function NewsCards({ sources, articles, onSelect }) {
  const latestBySource = useMemo(() => {
    const latest = new Map()
    articles.forEach((article) => {
      if (!latest.has(article.source_id)) latest.set(article.source_id, article)
    })
    return latest
  }, [articles])

  if (!sources.length) {
    return <p className="meta">Nenhuma agência cadastrada. Configure os feeds no painel Admin.</p>
  }

  return (
    <div className="news-source-cards">
      {sources.map((source) => {
        const article = latestBySource.get(source.id)
        return (
          <article className="news-source-card" key={source.id}>
            <div className="news-card-heading">
              <span className="eyebrow">{source.name}</span>
              {article?.published_at && <time className="meta">{fmtDate(article.published_at)}</time>}
            </div>
            {article ? (
              <a href={article.url} target="_blank" rel="noreferrer" className="news-card-title">
                {article.title}
              </a>
            ) : (
              <p className="meta">Ainda não há notícias coletadas.</p>
            )}
            {onSelect && (
              <button className="news-card-link" type="button" onClick={() => onSelect(source.id)}>
                Ver notícias →
              </button>
            )}
          </article>
        )
      })}
    </div>
  )
}

export default function NewsHub({ overviewOnly = false, refreshKey = 0 }) {
  const [sources, setSources] = useState([])
  const [articles, setArticles] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('Brasil')
  const [selectedSource, setSelectedSource] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [adminSources, setAdminSources] = useState([])
  const [password, setPassword] = useState('')
  const [form, setForm] = useState({ id: '', name: '', feed_url: '', categories: ['Brasil'], active: true })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const loadNews = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sourceResult, articleResult] = await Promise.all([
        supabase
          .from('news_sources')
          .select('id, name, categories, last_fetched_at')
          .eq('active', true)
          .order('name'),
        supabase
          .from('news_articles')
          .select('id, source_id, title, url, summary, published_at')
          .order('published_at', { ascending: false, nullsFirst: false })
          .limit(300),
      ])
      if (sourceResult.error || articleResult.error) {
        setError((sourceResult.error || articleResult.error).message)
      } else {
        const activeSources = sourceResult.data ?? []
        const sourceIds = new Set(activeSources.map((source) => source.id))
        setSources(activeSources)
        setArticles((articleResult.data ?? []).filter((article) => sourceIds.has(article.source_id)))
        setSelectedSource((current) =>
          activeSources.some((source) => source.id === current) ? current : activeSources[0]?.id ?? null
        )
      }
    } catch (loadError) {
      setError(loadError.message || 'Não foi possível carregar as notícias.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadNews()
  }, [loadNews, refreshKey])

  const loadAdminSources = async () => {
    const response = await fetch('/api/news-admin', { credentials: 'same-origin' })
    const body = await response.json().catch(() => null)
    if (response.status === 401) {
      setAuthenticated(false)
      return
    }
    if (!response.ok || !body?.ok) throw new Error(body?.error || 'Não foi possível carregar as fontes.')
    setAuthenticated(true)
    setAdminSources(body.sources)
  }

  const openAdmin = async () => {
    setAdminOpen(true)
    setNotice(null)
    try {
      await loadAdminSources()
    } catch (loadError) {
      setNotice({ type: 'error', text: loadError.message })
    }
  }

  const login = async (event) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      await postAdmin('login', { password })
      setPassword('')
      await loadAdminSources()
      setNotice({ type: 'ok', text: 'Acesso administrativo liberado.' })
    } catch (loginError) {
      setNotice({ type: 'error', text: loginError.message })
    } finally {
      setBusy(false)
    }
  }

  const saveSource = async (event) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      await postAdmin('save', { source: form })
      setForm({ id: '', name: '', feed_url: '', categories: ['Brasil'], active: true })
      await Promise.all([loadAdminSources(), loadNews()])
      setNotice({ type: 'ok', text: 'Fonte salva.' })
    } catch (saveError) {
      setNotice({ type: 'error', text: saveError.message })
    } finally {
      setBusy(false)
    }
  }

  const refreshSource = async (sourceId) => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await postAdmin('refresh', { source_id: sourceId })
      await Promise.all([loadNews(), authenticated ? loadAdminSources() : Promise.resolve()])
      setNotice({ type: 'ok', text: `${result.items} notícias atualizadas.` })
    } catch (refreshError) {
      if (refreshError.status === 401) {
        setAdminOpen(true)
        setAuthenticated(false)
      }
      setNotice({ type: 'error', text: refreshError.message })
    } finally {
      setBusy(false)
    }
  }

  const deleteSource = async (sourceId) => {
    if (!window.confirm('Excluir esta fonte e as notícias salvas dela?')) return
    setBusy(true)
    setNotice(null)
    try {
      await postAdmin('delete', { source_id: sourceId })
      setForm({ id: '', name: '', feed_url: '', categories: ['Brasil'], active: true })
      await Promise.all([loadAdminSources(), loadNews()])
      setNotice({ type: 'ok', text: 'Fonte excluída.' })
    } catch (deleteError) {
      setNotice({ type: 'error', text: deleteError.message })
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    setBusy(true)
    try {
      await postAdmin('logout')
      setAuthenticated(false)
      setAdminSources([])
      setNotice({ type: 'ok', text: 'Sessão administrativa encerrada.' })
    } catch (logoutError) {
      setNotice({ type: 'error', text: logoutError.message })
    } finally {
      setBusy(false)
    }
  }

  if (overviewOnly) {
    return (
      <section className="news-overview">
        <h2 className="dashboard-section-title">Últimas notícias por agência</h2>
        {error && <p className="warn">Erro ao carregar notícias: {error}</p>}
        {loading && <p className="meta">Carregando notícias…</p>}
        {!loading && !error && NEWS_CATEGORIES.map((category) => {
          const categorySources = sources.filter((source) => source.categories?.includes(category))
          if (!categorySources.length) return null
          return (
            <section className="news-overview-category" key={category}>
              <h3>{category}</h3>
              <NewsCards sources={categorySources} articles={articles} />
            </section>
          )
        })}
      </section>
    )
  }

  const availableCategories = NEWS_CATEGORIES.filter((category) =>
    sources.some((source) => source.categories?.includes(category))
  )
  const activeCategory = availableCategories.includes(selectedCategory)
    ? selectedCategory
    : availableCategories[0]
  const visibleSources = sources.filter((source) => source.categories?.includes(activeCategory))
  const activeSource = visibleSources.find((source) => source.id === selectedSource) ?? visibleSources[0]
  const sourceArticles = articles.filter((article) => article.source_id === activeSource?.id)
  const selectSource = (sourceId) => {
    const source = sources.find((item) => item.id === sourceId)
    if (source?.categories?.length) setSelectedCategory(source.categories[0])
    setSelectedSource(sourceId)
  }

  return (
    <section className="news-hub">
      <div className="news-heading">
        <div>
          <h2 className="section-title">Notícias</h2>
          <p className="meta">Últimas publicações nos feeds cadastrados.</p>
        </div>
        <button className="dashboard-button" type="button" onClick={openAdmin}>
          Admin · fontes RSS
        </button>
      </div>

      {error && <p className="warn">Erro ao carregar notícias: {error}</p>}
      {notice && <p className={`notice ${notice.type}`} role="status">{notice.text}</p>}
      {loading && <p className="meta">Carregando notícias…</p>}
      {!loading && !error && <NewsCards sources={sources} articles={articles} onSelect={selectSource} />}

      {!loading && sources.length > 0 && (
        <div className="news-browser">
          <nav className="news-category-tabs" aria-label="Categorias de notícias">
            {availableCategories.map((category) => (
              <button
                type="button"
                key={category}
                className={category === activeCategory ? 'active' : ''}
                aria-pressed={category === activeCategory}
                onClick={() => {
                  setSelectedCategory(category)
                  const firstSource = sources.find((source) => source.categories?.includes(category))
                  setSelectedSource(firstSource?.id ?? null)
                }}
              >
                {category}
              </button>
            ))}
          </nav>
          <nav className="news-source-tabs" aria-label={`Agências de ${activeCategory}`}>
            {visibleSources.map((source) => (
              <button
                type="button"
                key={source.id}
                className={source.id === activeSource?.id ? 'active' : ''}
                aria-current={source.id === activeSource?.id ? 'page' : undefined}
                onClick={() => setSelectedSource(source.id)}
              >
                {source.name}
              </button>
            ))}
          </nav>
          <div className="news-feed">
            {activeSource && (
              <div className="news-feed-heading">
                <div>
                  <h3>{activeSource.name}</h3>
                  <p className="meta">
                    {activeSource.last_fetched_at
                      ? `Atualizado em ${fmtDate(activeSource.last_fetched_at)}`
                      : 'Ainda não atualizado'}
                  </p>
                </div>
                <button
                  type="button"
                  className="collect"
                  disabled={busy}
                  onClick={() => refreshSource(activeSource.id)}
                >
                  {busy ? 'Atualizando…' : 'Atualizar notícias'}
                </button>
              </div>
            )}
            {sourceArticles.length ? (
              <ul className="news-article-list">
                {sourceArticles.map((article) => (
                  <li key={article.id}>
                    <a href={article.url} target="_blank" rel="noreferrer">{article.title}</a>
                    <time>{fmtDate(article.published_at)}</time>
                    {article.summary && <p>{article.summary}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta">Ainda não há notícias para esta agência. Use “Atualizar notícias”.</p>
            )}
          </div>
        </div>
      )}

      {adminOpen && (
        <div className="admin-panel">
          <div className="news-feed-heading">
            <div>
              <h3>Administração de feeds</h3>
              <p className="meta">A senha é validada no servidor; não fica salva no navegador.</p>
            </div>
            <button type="button" className="dashboard-button" onClick={() => setAdminOpen(false)}>
              Fechar
            </button>
          </div>
          {!authenticated ? (
            <form className="admin-login" onSubmit={login}>
              <label className="search-field">
                <span>Senha administrativa</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <button className="collect" type="submit" disabled={busy}>
                {busy ? 'Validando…' : 'Entrar'}
              </button>
            </form>
          ) : (
            <>
              <div className="admin-source-list">
                {adminSources.map((source) => (
                  <div className="admin-source-row" key={source.id}>
                    <button
                      type="button"
                      className="dashboard-button"
                      onClick={() => setForm({
                        id: source.id,
                        name: source.name,
                        feed_url: source.feed_url,
                        categories: source.categories ?? [],
                        active: source.active,
                      })}
                    >
                      {source.name} {source.active ? '' : '(inativa)'}
                    </button>
                    <button
                      type="button"
                      className="dashboard-button"
                      disabled={busy || !source.active}
                      onClick={() => refreshSource(source.id)}
                    >
                      Atualizar feed
                    </button>
                    <button
                      type="button"
                      className="dashboard-button"
                      disabled={busy}
                      onClick={() => deleteSource(source.id)}
                    >
                      Excluir
                    </button>
                  </div>
                ))}
              </div>
              <form className="admin-form" onSubmit={saveSource}>
                <h4>{form.id ? 'Editar agência' : 'Adicionar agência'}</h4>
                <label className="search-field">
                  <span>Nome exibido</span>
                  <input
                    type="text"
                    maxLength={60}
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder="Ex.: Reuters"
                    required
                  />
                </label>
                <label className="search-field">
                  <span>URL do feed RSS (HTTPS)</span>
                  <input
                    type="url"
                    maxLength={2048}
                    value={form.feed_url}
                    onChange={(event) => setForm({ ...form, feed_url: event.target.value })}
                    placeholder="https://exemplo.com/rss"
                    required
                  />
                </label>
                <fieldset className="admin-categories">
                  <legend>Categorias do dashboard</legend>
                  {NEWS_CATEGORIES.map((category) => (
                    <label className="admin-active" key={category}>
                      <input
                        type="checkbox"
                        checked={form.categories.includes(category)}
                        onChange={(event) => {
                          const categories = event.target.checked
                            ? [...form.categories, category]
                            : form.categories.filter((value) => value !== category)
                          setForm({ ...form, categories })
                        }}
                      />
                      {category}
                    </label>
                  ))}
                </fieldset>
                <label className="admin-active">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => setForm({ ...form, active: event.target.checked })}
                  />
                  Exibir no dashboard
                </label>
                <div className="actions">
                  <button className="collect" type="submit" disabled={busy || form.categories.length === 0}>
                    {busy ? 'Salvando…' : 'Salvar fonte'}
                  </button>
                  {form.id && (
                    <button
                      type="button"
                      className="dashboard-button"
                      onClick={() => setForm({ id: '', name: '', feed_url: '', categories: ['Brasil'], active: true })}
                    >
                      Cancelar edição
                    </button>
                  )}
                  <button type="button" className="dashboard-button" disabled={busy} onClick={logout}>
                    Sair do admin
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}
    </section>
  )
}
