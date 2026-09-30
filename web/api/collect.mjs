// Função serverless da Vercel: POST /api/collect
// Salve como web/api/collect.mjs
//
// Faz a mesma coisa que o collector.py (busca o feed, trata, grava via
// ingest_collection), mas em nuvem, para o botão "Coletar agora".
//
// Variáveis de ambiente (Vercel -> Settings -> Environment Variables):
//   SUPABASE_SECRET_KEY  (NOVA, sem prefixo VITE_, só no servidor)
//   VITE_SUPABASE_URL    (já existe; usada aqui também)

import { createClient } from '@supabase/supabase-js'
import { XMLParser } from 'fast-xml-parser'

const REGION = 'BR'
const COOLDOWN_MIN = 10 // intervalo mínimo entre quaisquer duas coletas
const FEED_URL = `https://trends.google.com/trending/rss?geo=${REGION}`
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

const makeTermKey = (term) =>
  term.normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()

function parseTraffic(label) {
  if (!label) return null
  const m = label.match(/^\s*(\d+)\s*(mil|mi|k|m)?\s*\+?\s*$/i)
  if (!m) return null
  let value = parseInt(m[1], 10)
  const unit = (m[2] || '').toLowerCase()
  if (unit === 'k' || unit === 'mil') value *= 1_000
  else if (unit === 'm' || unit === 'mi') value *= 1_000_000
  return value
}

// Único ponto que conhece o formato do feed (espelha parse_feed do Python)
function parseFeed(xml) {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => name === 'item' || name === 'ht:news_item',
  })
  const doc = parser.parse(xml)
  const raw = doc?.rss?.channel?.item ?? []
  const items = []
  for (const it of raw) {
    const term = str(it.title)
    if (!term) continue
    const label = str(it['ht:approx_traffic'])
    const d = it.pubDate ? new Date(it.pubDate) : null
    items.push({
      rank: items.length + 1,
      term,
      term_key: makeTermKey(term),
      traffic_label: label,
      traffic_min: parseTraffic(label),
      published_at: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
      news: (it['ht:news_item'] ?? [])
        .filter((n) => n && typeof n === 'object')
        .map((n) => ({
          title: str(n['ht:news_item_title']),
          url: str(n['ht:news_item_url']),
          source: str(n['ht:news_item_source']),
        })),
    })
  }
  return items
}

async function fetchFeed() {
  let lastStatus = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(FEED_URL, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(6000),
      })
      if (resp.ok) return await resp.text()
      lastStatus = resp.status
    } catch {
      lastStatus = 'timeout'
    }
  }
  const err = new Error(`feed_${lastStatus}`)
  err.feedStatus = lastStatus
  throw err
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Método não permitido.' })
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    console.error('collect: variáveis SUPABASE_SECRET_KEY / URL ausentes')
    return res.status(500).json({ ok: false, error: 'Servidor sem configuração.' })
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // 1) Intervalo mínimo entre coletas (protege o Google e o banco)
  const { data: last, error: lastErr } = await supabase
    .from('collections')
    .select('collected_at')
    .eq('region', REGION)
    .order('collected_at', { ascending: false })
    .limit(1)
  if (lastErr) {
    console.error('collect: erro ao ler última coleta', lastErr)
    return res.status(500).json({ ok: false, error: 'Falha ao consultar o banco.' })
  }
  if (last?.[0]) {
    const ageMin = (Date.now() - new Date(last[0].collected_at).getTime()) / 60000
    if (ageMin < COOLDOWN_MIN) {
      return res.status(429).json({
        ok: false,
        cooldown: true,
        retryAfterMin: Math.max(1, Math.ceil(COOLDOWN_MIN - ageMin)),
      })
    }
  }

  // 2) Buscar e interpretar o feed
  let items
  try {
    items = parseFeed(await fetchFeed())
  } catch (err) {
    console.error('collect: falha no feed', err)
    const status = err.feedStatus
    return res.status(502).json({
      ok: false,
      error:
        status && status !== 'timeout'
          ? `O Google recusou a requisição (status ${status}). Tente mais tarde.`
          : 'O Google não respondeu a tempo. Tente novamente.',
    })
  }
  if (items.length === 0) {
    return res.status(502).json({ ok: false, error: 'O feed veio sem itens.' })
  }

  // 3) Gravar (slot = minuto atual; o intervalo mínimo acima evita excesso)
  const slot = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString()
  const { error } = await supabase.rpc('ingest_collection', {
    p_region: REGION,
    p_source: 'google_trends_rss_manual',
    p_slot: slot,
    p_items: items,
  })
  if (error) {
    if (error.code === '23505') {
      return res.status(429).json({ ok: false, cooldown: true, retryAfterMin: 1 })
    }
    console.error('collect: erro ao gravar', error)
    return res.status(500).json({ ok: false, error: 'Falha ao gravar no banco.' })
  }

  return res.status(200).json({ ok: true, items: items.length, slot })
}
