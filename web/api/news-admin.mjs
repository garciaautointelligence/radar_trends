import { createHmac, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import https from 'node:https'
import { createClient } from '@supabase/supabase-js'
import { XMLParser } from 'fast-xml-parser'

const SESSION_COOKIE = 'radar_admin'
const SESSION_SECONDS = 8 * 60 * 60
const FEED_COOLDOWN_MS = 5 * 60 * 1000
const MAX_FEED_BYTES = 1_000_000
const NEWS_CATEGORIES = ['Brasil', 'Internacional', 'Política', 'Economia', 'Breaking News']
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['item', 'entry', 'link'].includes(name),
})

const cleanString = (value, maxLength) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null

function adminPassword() {
  return process.env.RADAR_ADMIN_PASSWORD || ''
}

function adminConfigured() {
  return adminPassword().length >= 16
}

function signature(timestamp) {
  return createHmac('sha256', adminPassword()).update(timestamp).digest()
}

function issueSession() {
  const timestamp = `${Date.now()}`
  return `${timestamp}.${signature(timestamp).toString('base64url')}`
}

function isValidSession(req) {
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
  if (!cookie || !adminPassword()) return false
  let token
  try {
    token = decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1))
  } catch {
    return false
  }
  const [timestamp, encodedSignature] = token.split('.')
  if (!timestamp || !encodedSignature || !/^\d{13}$/.test(timestamp)) return false
  const age = Date.now() - Number(timestamp)
  if (age < 0 || age > SESSION_SECONDS * 1000) return false
  const received = Buffer.from(encodedSignature, 'base64url')
  const expected = signature(timestamp)
  return received.length === expected.length && timingSafeEqual(received, expected)
}

function setSessionCookie(res, token, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secure}`
  )
}

function safeEqual(left, right) {
  const a = createHmac('sha256', 'radar-password-check').update(left).digest()
  const b = createHmac('sha256', 'radar-password-check').update(right).digest()
  return timingSafeEqual(a, b)
}

function verifySameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return false
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function parseFeedUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Informe uma URL válida para o feed.')
  }
  if (
    url.protocol !== 'https:' || url.username || url.password || !url.hostname ||
    (url.port && url.port !== '443') || url.href.length > 2048
  ) {
    throw new Error('O feed precisa usar HTTPS e não pode conter credenciais.')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname) && !isPublicAddress(hostname)) {
    throw new Error('O endereço do feed não é público.')
  }
  return url
}

function isPublicAddress(address) {
  const family = isIP(address)
  if (family === 4) {
    const octets = address.split('.').map(Number)
    const [a, b] = octets
    if (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 88 && octets[2] === 99) ||
      (a === 192 && b === 0 && octets[2] === 2) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && octets[2] === 113)
    ) return false
    return true
  }
  if (family === 6) {
    const normalized = address.toLowerCase()
    return (normalized.startsWith('2') || normalized.startsWith('3')) &&
      !normalized.startsWith('2001:db8:')
  }
  return false
}

async function resolvePublicAddress(hostname) {
  hostname = hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('O endereço do feed não é público.')
    return { address: hostname, family: isIP(hostname) }
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('O domínio do feed não aponta exclusivamente para endereços públicos.')
  }
  return addresses[0]
}

function requestFeed(url, address) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: { 'User-Agent': 'RadarTrends/1.0 (+RSS reader)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        timeout: 8000,
        lookup: (_hostname, options, callback) => {
          if (options?.all) callback(null, [address])
          else callback(null, address.address, address.family)
        },
      },
      (response) => {
        const chunks = []
        let size = 0
        response.on('data', (chunk) => {
          size += chunk.length
          if (size > MAX_FEED_BYTES) {
            request.destroy(new Error('O feed excede o limite de tamanho permitido.'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => resolve({
          status: response.statusCode || 0,
          location: response.headers.location,
          body: decodeFeed(Buffer.concat(chunks), response.headers['content-type']),
        }))
      }
    )
    request.on('timeout', () => request.destroy(new Error('Tempo limite ao consultar o feed.')))
    request.on('error', reject)
  })
}

function decodeFeed(bytes, contentType = '') {
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || 'utf-8'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch (error) {
    throw new Error(`Charset não suportado no feed: ${charset}.`, { cause: error })
  }
}

async function fetchFeed(initialUrl) {
  let current = initialUrl
  for (let redirects = 0; redirects <= 3; redirects++) {
    const address = await resolvePublicAddress(current.hostname)
    const response = await requestFeed(current, address)
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      if (redirects === 3) throw new Error('O feed excedeu o limite de redirecionamentos.')
      current = parseFeedUrl(new URL(response.location, current).href)
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`O feed respondeu com status HTTP ${response.status}.`)
    }
    return response.body
  }
  throw new Error('Não foi possível acessar o feed.')
}

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : [])

function articleUrl(entry, atom = false) {
  if (!atom) {
    const links = asArray(entry.link)
    const link = links.find((value) => typeof value === 'string' || value?.['@_href'])
    if (link) return typeof link === 'string' ? link : link['@_href']
    const guid = entry.guid
    if (typeof guid === 'string') return guid
    return guid?.['@_isPermaLink'] === 'false' ? null : guid?.['#text'] || null
  }
  const links = asArray(entry.link)
  return links.find((link) => !link['@_rel'] || link['@_rel'] === 'alternate')?.['@_href'] ||
    links[0]?.['@_href']
}

function plainText(value, maxLength) {
  if (typeof value !== 'string') return null
  const text = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, maxLength) : null
}

function parseArticles(xml) {
  const parsed = parser.parse(xml)
  const rss = parsed?.rss?.channel
  const atom = parsed?.feed
  const rdf = parsed?.RDF
  const entries = rss ? asArray(rss.item) : asArray(atom?.entry ?? rdf?.item)
  const seen = new Set()
  const articles = []
  for (const entry of entries) {
    const title = plainText(entry?.title, 500)
    const rawUrl = articleUrl(entry, !rss)
    if (!title || typeof rawUrl !== 'string') continue
    let url
    try {
      url = new URL(rawUrl)
    } catch {
      continue
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue
    seen.add(url.href)
    const rawDate = entry.pubDate || entry.published || entry.updated || null
    const normalizedDate = typeof rawDate === 'string'
      ? rawDate.replace(/^(Seg|Ter|Qua|Qui|Sex|Sáb|Sab|Dom)\b/i, (day) => ({
          seg: 'Mon',
          ter: 'Tue',
          qua: 'Wed',
          qui: 'Thu',
          sex: 'Fri',
          'sáb': 'Sat',
          sab: 'Sat',
          dom: 'Sun',
        })[day.toLocaleLowerCase('pt-BR')] || day)
      : rawDate
    const parsedDate = normalizedDate ? new Date(normalizedDate) : null
    articles.push({
      title,
      url: url.href,
      summary: plainText(entry.description || entry.summary || entry.content, 1000),
      published_at: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
    })
    if (articles.length >= 100) break
  }
  return articles
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Servidor sem configuração do Supabase.')
  return createClient(url, key, { auth: { persistSession: false } })
}

async function refreshSource(supabase, sourceId) {
  const { data: source, error: sourceError } = await supabase
    .from('news_sources')
    .select('id, feed_url, active, last_attempted_at')
    .eq('id', sourceId)
    .maybeSingle()
  if (sourceError) throw new Error('Falha ao consultar a fonte no banco.')
  if (!source || !source.active) throw new Error('Fonte não encontrada ou inativa.')
  if (source.last_attempted_at && Date.now() - new Date(source.last_attempted_at).getTime() < FEED_COOLDOWN_MS) {
    const retryMinutes = Math.ceil((FEED_COOLDOWN_MS - (Date.now() - new Date(source.last_attempted_at).getTime())) / 60000)
    const error = new Error(`Esta fonte foi atualizada recentemente. Tente novamente em ${retryMinutes} min.`)
    error.statusCode = 429
    throw error
  }

  const { error: attemptError } = await supabase
    .from('news_sources')
    .update({ last_attempted_at: new Date().toISOString() })
    .eq('id', source.id)
  if (attemptError) throw new Error('Falha ao registrar a tentativa de atualização.')

  const items = parseArticles(await fetchFeed(parseFeedUrl(source.feed_url)))
  if (!items.length) throw new Error('O feed foi lido, mas não contém notícias válidas.')

  const fetchedAt = new Date().toISOString()
  const rows = items.map((item) => ({ ...item, source_id: source.id, fetched_at: fetchedAt }))
  const { error: upsertError } = await supabase
    .from('news_articles')
    .upsert(rows, { onConflict: 'source_id,url' })
  if (upsertError) throw new Error('Falha ao salvar as notícias no banco.')

  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('news_sources')
    .update({ last_fetched_at: now })
    .eq('id', source.id)
  if (updateError) throw new Error('Notícias salvas, mas não foi possível registrar o horário da atualização.')

  const { error: pruneError } = await supabase
    .from('news_articles')
    .delete()
    .eq('source_id', source.id)
    .lt('fetched_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
  if (pruneError) console.error('news-admin: falha ao limpar notícias antigas', pruneError)
  return items.length
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  if (req.method === 'GET') {
    if (!adminConfigured()) return res.status(503).json({ ok: false, error: 'Configure RADAR_ADMIN_PASSWORD com pelo menos 16 caracteres.' })
    if (!isValidSession(req)) return res.status(401).json({ ok: false, error: 'Entre para administrar as fontes.' })
    try {
      const { data, error } = await getSupabase()
        .from('news_sources')
        .select('id, name, feed_url, categories, active, last_fetched_at, last_attempted_at')
        .order('name')
      if (error) throw error
      return res.status(200).json({ ok: true, sources: data })
    } catch (error) {
      console.error('news-admin: falha ao listar fontes', error)
      return res.status(500).json({ ok: false, error: error.message || 'Falha ao listar fontes.' })
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ ok: false, error: 'Método não permitido.' })
  }
  if (!verifySameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origem da solicitação não permitida.' })
  if (!adminConfigured()) return res.status(503).json({ ok: false, error: 'Configure RADAR_ADMIN_PASSWORD com pelo menos 16 caracteres.' })

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
  } catch {
    return res.status(400).json({ ok: false, error: 'Corpo JSON inválido.' })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ ok: false, error: 'Corpo de solicitação inválido.' })
  }
  const action = body.action
  if (action === 'login') {
    if (typeof body.password !== 'string' || !safeEqual(body.password, adminPassword())) {
      return res.status(401).json({ ok: false, error: 'Senha administrativa incorreta.' })
    }
    setSessionCookie(res, issueSession(), SESSION_SECONDS)
    return res.status(200).json({ ok: true })
  }
  if (action === 'logout') {
    setSessionCookie(res, '', 0)
    return res.status(200).json({ ok: true })
  }
  if (!isValidSession(req)) return res.status(401).json({ ok: false, error: 'Entre para administrar as fontes.' })

  try {
    const supabase = getSupabase()
    if (action === 'save') {
      const source = body.source || {}
      const name = cleanString(source.name, 60)
      const feedUrl = parseFeedUrl(source.feed_url)
      const categories = [...new Set(
        Array.isArray(source.categories)
          ? source.categories.filter((category) => NEWS_CATEGORIES.includes(category))
          : []
      )]
      if (!name || name.length < 2) throw new Error('O nome da agência precisa ter entre 2 e 60 caracteres.')
      if (!categories.length || categories.length !== (Array.isArray(source.categories) ? source.categories.length : 0)) {
        throw new Error('Selecione pelo menos uma categoria válida.')
      }
      if (source.id) {
        const { error } = await supabase.from('news_sources').update({
          name,
          feed_url: feedUrl.href,
          categories,
          active: source.active !== false,
        }).eq('id', source.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('news_sources').insert({
          name,
          feed_url: feedUrl.href,
          categories,
          active: source.active !== false,
        })
        if (error) throw error
      }
      return res.status(200).json({ ok: true })
    }
    if (action === 'delete') {
      if (typeof body.source_id !== 'string') throw new Error('Identificador de fonte inválido.')
      const { error } = await supabase.from('news_sources').delete().eq('id', body.source_id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    }
    if (action === 'refresh') {
      if (typeof body.source_id !== 'string') throw new Error('Identificador de fonte inválido.')
      const items = await refreshSource(supabase, body.source_id)
      return res.status(200).json({ ok: true, items })
    }
    return res.status(400).json({ ok: false, error: 'Ação administrativa inválida.' })
  } catch (error) {
    if (error.statusCode === 429) return res.status(429).json({ ok: false, error: error.message })
    console.error(`news-admin: falha na ação ${action}`, error)
    return res.status(400).json({
      ok: false,
      error: error.message || 'Não foi possível concluir a operação.',
    })
  }
}

export { decodeFeed, isPublicAddress, parseArticles, parseFeedUrl }
