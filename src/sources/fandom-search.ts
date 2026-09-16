import { PRESENCE } from '../config.js'
import type { PresenceArticle, Title } from '../types.js'

interface SearchResult {
  title: string
  sitename: string
  wikiId: number
  url: string
  hub: string
}

interface SearchResponse {
  results: SearchResult[]
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const HUBS: ReadonlySet<string> = new Set(PRESENCE.hubs)

async function searchTitle(title: string): Promise<PresenceArticle[]> {
  const url = new URL(PRESENCE.searchUrl)
  url.searchParams.set('query', title)
  url.searchParams.set('lang', 'en')
  url.searchParams.set('namespace', '0')
  url.searchParams.set('page', '0')
  url.searchParams.set('limit', String(PRESENCE.limit))
  url.searchParams.set('imageOnly', 'false')
  url.searchParams.set('videoOnly', 'false')
  url.searchParams.set('gamepedia', 'false')

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`fandom search ${response.status}: ${title}`)

  const data = (await response.json()) as SearchResponse
  const key = normalise(title)

  const seen = new Set<string>()
  const articles: PresenceArticle[] = []
  for (const result of data.results) {
    if (normalise(result.title) !== key) continue
    if (!HUBS.has(result.hub)) continue
    const dedup = `${result.wikiId}:${result.title}`
    if (seen.has(dedup)) continue
    seen.add(dedup)
    articles.push({
      title: result.title,
      sitename: result.sitename,
      wikiId: result.wikiId,
      url: result.url,
    })
  }
  return articles
}

export interface PresenceResult {
  queried: number
  withWiki: number
  noWiki: number
  failed: number
}

export async function attach(titles: Title[]): Promise<PresenceResult> {
  const result: PresenceResult = { queried: 0, withWiki: 0, noWiki: 0, failed: 0 }

  const queue = [...titles]
  const run = async (): Promise<void> => {
    while (queue.length > 0) {
      const title = queue.shift()!
      try {
        const articles = await searchTitle(title.title)
        result.queried++
        const wikis = new Set(articles.map((a) => a.wikiId)).size
        title.presence = { pages: articles.length, wikis, articles }
        if (wikis > 0) result.withWiki++
        else result.noWiki++
      } catch {
        result.queried++
        result.failed++
      }
    }
  }

  await Promise.all(Array.from({ length: PRESENCE.concurrency }, run))
  return result
}
