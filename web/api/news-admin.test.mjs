import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeFeed, isPublicAddress, parseArticles, parseFeedUrl, parseLogoUrl } from './news-admin.mjs'

test('parseia notícias de RSS e remove duplicadas', () => {
  const items = parseArticles(`<?xml version="1.0"?>
    <rss version="2.0"><channel><item>
      <title> Manchete &amp; contexto </title>
      <link>https://news.example/story</link>
      <description>&lt;p&gt;Resumo da matéria&lt;/p&gt;</description>
      <pubDate>Wed, 04 Nov 2026 12:00:00 GMT</pubDate>
    </item><item>
      <title>Duplicada</title><link>https://news.example/story</link>
    </item></channel></rss>`)

  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'Manchete & contexto')
  assert.equal(items[0].summary, 'Resumo da matéria')
  assert.equal(items[0].published_at, '2026-11-04T12:00:00.000Z')
})

test('parseia links e datas de um feed Atom', () => {
  const items = parseArticles(`<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <title>Notícia Atom</title>
    <link rel="alternate" href="https://news.example/atom-story" />
    <updated>2026-11-04T12:00:00Z</updated>
  </entry></feed>`)

  assert.equal(items[0].url, 'https://news.example/atom-story')
  assert.equal(items[0].published_at, '2026-11-04T12:00:00.000Z')
})

test('usa guid quando o RSS não informa link e entende dia da semana em português', () => {
  const items = parseArticles(`<rss version="2.0"><channel><item>
    <title>Projeto segue para a Câmara</title>
    <guid>https://senado.example/noticia/123</guid>
    <pubDate>Qui, 05 Nov 2026 08:09:21 -0300</pubDate>
  </item></channel></rss>`)

  assert.equal(items[0].url, 'https://senado.example/noticia/123')
  assert.equal(items[0].published_at, '2026-11-05T11:09:21.000Z')
})

test('importa notícias de RSS WordPress com campos namespaceados como o da CNN Brasil', () => {
  const items = parseArticles(`<rss version="2.0"
    xmlns:content="http://purl.org/rss/1.0/modules/content/"
    xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel><item>
      <title>Notícia da CNN &amp; atualização</title>
      <link>https://www.cnnbrasil.com.br/noticia/123/</link>
      <dc:creator><![CDATA[Redação CNN]]></dc:creator>
      <pubDate>Fri, 06 Nov 2026 10:21:16 +0000</pubDate>
      <guid isPermaLink="false">https://www.cnnbrasil.com.br///</guid>
      <description><![CDATA[Resumo da notícia]]></description>
      <content:encoded><![CDATA[<p>Texto completo</p>]]></content:encoded>
    </item></channel></rss>`)

  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'Notícia da CNN & atualização')
  assert.equal(items[0].url, 'https://www.cnnbrasil.com.br/noticia/123/')
  assert.equal(items[0].summary, 'Resumo da notícia')
})

test('decodifica feeds usando o charset informado pelo servidor', () => {
  const latin1Bytes = Buffer.from(
    '<title>Incêndio em prédio residencial</title>',
    'latin1'
  )

  assert.equal(
    decodeFeed(latin1Bytes, 'application/rss+xml; charset=ISO-8859-1'),
    '<title>Incêndio em prédio residencial</title>'
  )
})

test('aceita somente feeds HTTPS em host e porta padrão', () => {
  assert.equal(parseFeedUrl('https://news.example/rss').href, 'https://news.example/rss')
  assert.throws(() => parseFeedUrl('http://news.example/rss'))
  assert.throws(() => parseFeedUrl('https://127.0.0.1/rss'))
  assert.throws(() => parseFeedUrl('https://[::1]/rss'))
  assert.throws(() => parseFeedUrl('https://news.example:8443/rss'))
})

test('aceita URL HTTPS opcional para a logo e rejeita protocolos inválidos', () => {
  assert.equal(parseLogoUrl(''), null)
  assert.equal(parseLogoUrl('  https://cdn.example/logo.png  '), 'https://cdn.example/logo.png')
  assert.throws(() => parseLogoUrl('http://cdn.example/logo.png'))
  assert.throws(() => parseLogoUrl('javascript:alert(1)'))
})

test('bloqueia endereços de rede privada e aceita IPs públicos', () => {
  assert.equal(isPublicAddress('127.0.0.1'), false)
  assert.equal(isPublicAddress('10.0.0.1'), false)
  assert.equal(isPublicAddress('169.254.169.254'), false)
  assert.equal(isPublicAddress('8.8.8.8'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
})
