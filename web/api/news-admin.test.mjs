import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicAddress, parseArticles, parseFeedUrl } from './news-admin.mjs'

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

test('aceita somente feeds HTTPS em host e porta padrão', () => {
  assert.equal(parseFeedUrl('https://news.example/rss').href, 'https://news.example/rss')
  assert.throws(() => parseFeedUrl('http://news.example/rss'))
  assert.throws(() => parseFeedUrl('https://127.0.0.1/rss'))
  assert.throws(() => parseFeedUrl('https://[::1]/rss'))
  assert.throws(() => parseFeedUrl('https://news.example:8443/rss'))
})

test('bloqueia endereços de rede privada e aceita IPs públicos', () => {
  assert.equal(isPublicAddress('127.0.0.1'), false)
  assert.equal(isPublicAddress('10.0.0.1'), false)
  assert.equal(isPublicAddress('169.254.169.254'), false)
  assert.equal(isPublicAddress('8.8.8.8'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
})
