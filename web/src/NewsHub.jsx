import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'

const NEWS_CATEGORIES = ['Brasil', 'Internacional', 'Política', 'Economia', 'Breaking News']
const AGENCY_DOMAINS = {
  G1: 'g1.globo.com',
  'EBC / Agência Brasil': 'agenciabrasil.ebc.com.br',
  'UOL Notícias': 'noticias.uol.com.br',
  Metrópoles: 'metropoles.com',
  Reuters: 'reuters.com',
  'CNN International': 'edition.cnn.com',
  'BBC News': 'bbc.com',
  'Associated Press (AP)': 'apnews.com',
  'Agência Senado': 'senado.leg.br',
  'Agência Câmara': 'camara.leg.br',
}

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

function AgencyLogo({ source, onClick }) {
  const [failed, setFailed] = useState(false)
  let domain = AGENCY_DOMAINS[source.name]
  if (!domain) {
    try {
      domain = new URL(source.feed_url).hostname
    } catch {
      domain = ''
    }
  }
  if (!domain) {
    const fallback = <span aria-hidden="true">{source.name.slice(0, 2).toUpperCase()}</span>
    return onClick
      ? <button className="agency-logo-button" type="button" aria-label={`Abrir as últimas 10 notícias de ${source.name}`} onClick={onClick}>{fallback}</button>
      : <span className="agency-logo-button" aria-hidden="true">{fallback}</span>
  }
  const logoUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`

  const image = !failed ? (
    <img src={logoUrl} alt="" onError={() => setFailed(true)} />
  ) : (
    <span aria-hidden="true">{source.name.slice(0, 2).toUpperCase()}</span>
  )

  return onClick ? (
    <button
      className="agency-logo-button"
      type="button"
      aria-label={`Abrir as últimas 10 notícias de ${source.name}`}
      title={`Ver últimas notícias de ${source.name}`}
      onClick={onClick}
    >
      {image}
    </button>
  ) : <span className="agency-logo-button" aria-hidden="true">{image}</span>
}

function NewsCards({ sources, articles, onSelect }) {
  const latestBySource = useMemo(() => {
    const latest = new Map()
    articles.forEach((article) => {
      const current = latest.get(article.source_id)
      if (!current || (article.published_at && new Date(article.published_at) > new Date(current.published_at || 0))) {
        latest.set(article.source_id, article)
      }
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
            <div className="news-card-identity">
              <AgencyLogo source={source} onClick={() => onSelect?.(source.id)} />
              <div className="news-card-source">
                <strong>{source.name}</strong>
                <div className="news-category-badges">
                  {(source.categories ?? []).map((category) => (
                    <span className="news-category-badge" key={category}>{category}</span>
                  ))}
                </div>
              </div>
            </div>
            {article ? (
              <>
                <a href={article.url} target="_blank" rel="noreferrer" className="news-card-title">
                  {article.title}
                </a>
                <time className="news-card-time">{fmtDate(article.published_at)}</time>
              </>
            ) : (
              <p className="news-card-empty">Ainda não há notícias coletadas.</p>
            )}
            {onSelect && <span className="news-card-hint">Toque no logo para ver as 10 últimas</span>}
          </article>
        )
      })}
    </div>
  )
}

export default function NewsHub({ refreshKey = 0 }) {
  const [sources, setSources] = useState([])
  const [articles, setArticles] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('Todas')
  const [selectedSource, setSelectedSource] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [sourceFormOpen, setSourceFormOpen] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [adminSources, setAdminSources] = useState([])
  const [refreshingSourceId, setRefreshingSourceId] = useState(null)
  const [refreshAllProgress, setRefreshAllProgress] = useState(null)
  const refreshAllLock = useRef(false)
  const [refreshErrors, setRefreshErrors] = useState({})
  const [password, setPassword] = useState('')
  const [form, setForm] = useState({ id: '', name: '', feed_url: '', categories: ['Brasil'], active: true })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const loadNews = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sourceResult = await supabase
        .from('news_sources')
        .select('id, name, feed_url, categories, last_fetched_at')
        .eq('active', true)
        .order('name')
      if (sourceResult.error) {
        setError(sourceResult.error.message)
      } else {
        const activeSources = sourceResult.data ?? []
        const articleResults = await Promise.all(activeSources.map((source) =>
          supabase
            .from('news_articles')
            .select('id, source_id, title, url, summary, published_at')
            .eq('source_id', source.id)
            .order('published_at', { ascending: false, nullsFirst: false })
            .limit(10)
        ))
        const articleError = articleResults.find((result) => result.error)?.error
        if (articleError) {
          setError(articleError.message)
          return
        }
        setSources(activeSources)
        setArticles(articleResults.flatMap((result) => result.data ?? []))
        setSelectedSource((current) =>
          activeSources.some((source) => source.id === current) ? current : null
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
      setSourceFormOpen(false)
      await Promise.all([loadAdminSources(), loadNews()])
      setNotice({ type: 'ok', text: 'Fonte salva.' })
    } catch (saveError) {
      setNotice({ type: 'error', text: saveError.message })
    } finally {
      setBusy(false)
    }
  }

  const refreshSource = async (sourceId) => {
    if (refreshAllProgress || refreshingSourceId) return
    setRefreshingSourceId(sourceId)
    setRefreshErrors((current) => ({ ...current, [sourceId]: null }))
    setNotice(null)
    try {
      const result = await postAdmin('refresh', { source_id: sourceId })
      await Promise.all([loadNews(), authenticated ? loadAdminSources() : Promise.resolve()])
      setNotice({ type: 'ok', text: `${result.items} notícias atualizadas.` })
    } catch (refreshError) {
      setRefreshErrors((current) => ({ ...current, [sourceId]: refreshError.message }))
      if (authenticated) {
        try {
          await loadAdminSources()
        } catch (adminError) {
          setRefreshErrors((current) => ({
            ...current,
            [sourceId]: `${refreshError.message} Também não foi possível atualizar o status: ${adminError.message}`,
          }))
        }
      }
      if (refreshError.status === 401) {
        setAdminOpen(true)
        setAuthenticated(false)
      }
      setNotice({ type: 'error', text: refreshError.message })
    } finally {
      setRefreshingSourceId(null)
    }
  }

  const refreshAllSources = async () => {
    const activeSources = adminSources.filter((source) => source.active)
    if (refreshAllLock.current || refreshingSourceId || !activeSources.length) return

    refreshAllLock.current = true
    setRefreshAllProgress({ current: 0, total: activeSources.length, sourceName: '' })
    setRefreshErrors((current) => {
      const next = { ...current }
      activeSources.forEach((source) => { delete next[source.id] })
      return next
    })
    setNotice(null)
    const failures = []
    let completed = 0
    let authenticationExpired = false

    for (const source of activeSources) {
      setRefreshingSourceId(source.id)
      setRefreshAllProgress({
        current: completed + 1,
        total: activeSources.length,
        sourceName: source.name,
      })
      try {
        await postAdmin('refresh', { source_id: source.id })
        completed += 1
      } catch (refreshError) {
        failures.push({ source, message: refreshError.message })
        setRefreshErrors((current) => ({ ...current, [source.id]: refreshError.message }))
        completed += 1
        if (refreshError.status === 401) {
          authenticationExpired = true
          setAuthenticated(false)
          setAdminOpen(true)
          break
        }
      }
    }

    setRefreshingSourceId(null)
    try {
      await Promise.all([loadNews(), loadAdminSources()])
      if (failures.length) {
        const failedNames = failures.map(({ source }) => source.name).join(', ')
        setNotice({
          type: 'warn',
          text: `Atualizados: ${completed - failures.length}. Falharam: ${failedNames}.${authenticationExpired ? ' A sessão expirou; entre novamente.' : ''}`,
        })
      } else {
        setNotice({
          type: 'ok',
          text: `${completed} feeds atualizados com sucesso.`,
        })
      }
    } catch (loadError) {
      setNotice({
        type: 'error',
        text: `Atualização encerrada, mas não foi possível recarregar o painel: ${loadError.message}`,
      })
    } finally {
      refreshAllLock.current = false
      setRefreshAllProgress(null)
    }
  }

  const deleteSource = async (sourceId) => {
    if (refreshAllProgress || refreshingSourceId) return
    if (!window.confirm('Excluir esta fonte e as notícias salvas dela?')) return
    setBusy(true)
    setNotice(null)
    try {
      await postAdmin('delete', { source_id: sourceId })
      setForm({ id: '', name: '', feed_url: '', categories: ['Brasil'], active: true })
      setSourceFormOpen(false)
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

  const availableCategories = ['Todas', ...NEWS_CATEGORIES]
  const activeCategory = availableCategories.includes(selectedCategory)
    ? selectedCategory
    : 'Todas'
  const visibleSources = activeCategory === 'Todas'
    ? sources
    : sources.filter((source) => source.categories?.includes(activeCategory))
  const activeSource = sources.find((source) => source.id === selectedSource)
  const sourceArticles = articles
    .filter((article) => article.source_id === activeSource?.id)
    .sort((a, b) => {
      if (!a.published_at) return 1
      if (!b.published_at) return -1
      return new Date(b.published_at) - new Date(a.published_at)
    })
    .slice(0, 10)
  const selectSource = (sourceId) => {
    setSelectedSource(sourceId)
  }

  useEffect(() => {
    if (!selectedSource && !sourceFormOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        if (sourceFormOpen) setSourceFormOpen(false)
        else setSelectedSource(null)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedSource, sourceFormOpen])

  return (
    <section className="news-hub">
      <div className="news-heading">
        <div>
          <p className="news-kicker">Últimas Notícias</p>
          <h2 className="section-title">PANORAMA NEWS</h2>
          <p className="meta">Uma visão rápida de todas as fontes. Selecione uma agência  para ver as 10 últimas notícias.</p>
        </div>
        <button className="dashboard-button" type="button" onClick={openAdmin}>
          Admin · fontes RSS
        </button>
      </div>

      {error && <p className="warn">Erro ao carregar notícias: {error}</p>}
      {notice && <p className={`notice ${notice.type}`} role="status">{notice.text}</p>}
      {loading && <p className="meta">Carregando notícias…</p>}
      {!loading && !error && !sources.length && (
        <p className="news-empty">Nenhuma fonte ativa. Cadastre ou ative feeds no painel Admin.</p>
      )}

      {!loading && sources.length > 0 && (
        <>
          <nav className="news-category-tabs" aria-label="Categorias de notícias">
            {availableCategories.map((category) => (
              <button
                type="button"
                key={category}
                className={category === activeCategory ? 'active' : ''}
                aria-pressed={category === activeCategory}
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </button>
            ))}
          </nav>
          <NewsCards sources={visibleSources} articles={articles} onSelect={selectSource} />
        </>
      )}

      {activeSource && (
        <div className="news-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedSource(null)
        }}>
          <section
            className="news-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="news-modal-title"
          >
            <header className="news-modal-header">
              <div className="news-card-identity">
                <AgencyLogo source={activeSource} onClick={() => setSelectedSource(null)} />
                <div>
                  <h3 id="news-modal-title">{activeSource.name}</h3>
                  <div className="news-category-badges">
                    {(activeSource.categories ?? []).map((category) => (
                      <span className="news-category-badge" key={category}>{category}</span>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="news-modal-close"
                aria-label="Fechar notícias"
                onClick={() => setSelectedSource(null)}
              >
                ×
              </button>
            </header>
            <p className="meta">
              {activeSource.last_fetched_at
                ? `Última atualização: ${fmtDate(activeSource.last_fetched_at)}`
                : 'Este feed ainda não foi atualizado.'}
            </p>
            {sourceArticles.length ? (
              <ol className="news-modal-list">
                {sourceArticles.map((article) => (
                  <li key={article.id}>
                    <a href={article.url} target="_blank" rel="noreferrer">{article.title}</a>
                    <time>{fmtDate(article.published_at)}</time>
                    {article.summary && <p>{article.summary}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="meta">Ainda não há notícias salvas desta agência. Atualize o feed pelo painel Admin.</p>
            )}
          </section>
        </div>
      )}

      {adminOpen && (
        <div className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <h3>Administração de feeds</h3>
              <p className="meta">
                {authenticated
                  ? 'Gerencie as fontes e mantenha as manchetes atualizadas.'
                  : 'A senha é validada no servidor; não fica salva no navegador.'}
              </p>
            </div>
            <div className="admin-header-actions">
              {authenticated && (
                <button
                  type="button"
                  className="admin-refresh-all"
                  disabled={busy || refreshingSourceId !== null || !adminSources.some((source) => source.active)}
                  onClick={refreshAllSources}
                >
                  {refreshAllProgress ? (
                    <><span className="admin-spinner" aria-hidden="true" /> {refreshAllProgress.current}/{refreshAllProgress.total}</>
                  ) : (
                    '⟳ Atualizar todos'
                  )}
                </button>
              )}
              <button type="button" className="dashboard-button" onClick={() => setAdminOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
          {refreshAllProgress && (
            <p className="admin-batch-progress" role="status">
              Atualizando {refreshAllProgress.sourceName} ({refreshAllProgress.current} de {refreshAllProgress.total})
            </p>
          )}
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
                    <AgencyLogo source={source} />
                    <div className="admin-source-info">
                      <strong>{source.name}</strong>
                      <span className={`admin-feed-status${source.last_fetched_at ? ' updated' : ''}${refreshErrors[source.id] || (source.last_attempted_at && (!source.last_fetched_at || new Date(source.last_attempted_at) > new Date(source.last_fetched_at))) ? ' failed' : ''}`}>
                        {refreshErrors[source.id] ? (
                          refreshErrors[source.id]
                        ) : source.last_attempted_at && (!source.last_fetched_at || new Date(source.last_attempted_at) > new Date(source.last_fetched_at)) ? (
                          <>Última tentativa {fmtDate(source.last_attempted_at)} · sem atualização concluída</>
                        ) : source.last_fetched_at ? (
                          <><span aria-hidden="true">✓</span> Atualizado {fmtDate(source.last_fetched_at)}</>
                        ) : (
                          'Aguardando primeira atualização'
                        )}
                      </span>
                    </div>
                    <div className="admin-source-actions">
                      <button
                        type="button"
                        className="admin-refresh-button"
                        disabled={busy || refreshAllProgress !== null || refreshingSourceId !== null || !source.active}
                        onClick={() => refreshSource(source.id)}
                      >
                        {refreshingSourceId === source.id ? (
                          <><span className="admin-spinner" aria-hidden="true" /> Atualizando</>
                        ) : (
                          'Atualizar'
                        )}
                      </button>
                      <button
                        type="button"
                        className="admin-icon-button"
                        aria-label={`Editar ${source.name}`}
                        title="Editar fonte"
                        disabled={busy || refreshAllProgress !== null || refreshingSourceId !== null}
                        onClick={() => {
                          setForm({
                            id: source.id,
                            name: source.name,
                            feed_url: source.feed_url,
                            categories: source.categories ?? [],
                            active: source.active,
                          })
                          setSourceFormOpen(true)
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="admin-icon-button danger"
                        aria-label={`Excluir ${source.name}`}
                        title="Excluir fonte"
                        disabled={busy || refreshAllProgress !== null || refreshingSourceId !== null}
                        onClick={() => deleteSource(source.id)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="admin-add-source"
                disabled={busy || refreshAllProgress !== null || refreshingSourceId !== null}
                onClick={() => {
                  setForm({ id: '', name: '', feed_url: '', categories: ['Brasil'], active: true })
                  setSourceFormOpen(true)
                }}
              >
                <span aria-hidden="true">＋</span> Cadastrar agência + RSS
              </button>
              <div className="admin-session-actions">
                <button type="button" className="dashboard-button" disabled={busy || refreshAllProgress !== null || refreshingSourceId !== null} onClick={logout}>
                  Sair do admin
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {sourceFormOpen && authenticated && (
        <div className="news-modal-backdrop admin-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setSourceFormOpen(false)
        }}>
          <section className="news-modal admin-source-modal" role="dialog" aria-modal="true" aria-labelledby="admin-source-form-title">
            <header className="news-modal-header">
              <div>
                <p className="news-kicker">GERENCIAR FONTES</p>
                <h3 id="admin-source-form-title">{form.id ? 'Editar agência' : 'Cadastrar agência'}</h3>
              </div>
              <button type="button" className="news-modal-close" aria-label="Fechar formulário" disabled={busy} onClick={() => setSourceFormOpen(false)}>
                ×
              </button>
            </header>
            <form className="admin-form" onSubmit={saveSource}>
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
                  <button type="button" className="dashboard-button" disabled={busy} onClick={() => setSourceFormOpen(false)}>
                    Cancelar
                  </button>
                </div>
              </form>
          </section>
        </div>
      )}
    </section>
  )
}
