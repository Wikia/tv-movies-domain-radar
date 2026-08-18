import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BUZZ, ROOT, WIKI_USER_AGENT } from '../config.js'
import type { Title } from '../types.js'

const CACHE_FILE = path.join(ROOT, 'data', 'wiki-articles.json')

interface CacheEntry {
  article: string | null
  checked: string
}
type Cache = Record<string, CacheEntry>

type Resolution =
  | { status: 'found'; article: string }
  | { status: 'absent' }
  | { status: 'failed' }

function cacheKey(title: Title): string {
  return `${title.title}|${title.type}|${title.releaseDate?.slice(0, 4) ?? '?'}`
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function stripDisambiguator(article: string): string {
  return article.replace(/\s*\([^)]*\)\s*$/, '')
}

async function getJson(url: string, attempts = 3): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)))
    }
    try {
      const response = await fetch(url, { headers: { 'User-Agent': WIKI_USER_AGENT } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`wikipedia: ${String(lastError)} for ${url}`)
}

export async function pooled<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await work(items[i]!)
    }
  })
  await Promise.all(workers)
  return results
}

async function search(title: Title): Promise<string | null> {
  const year = title.releaseDate?.slice(0, 4) ?? ''
  const hint = title.type === 'movie' ? 'film' : 'TV series'
  const query = encodeURIComponent(`${title.title} ${year} ${hint}`)
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json` +
    `&srlimit=5&srsearch=${query}`

  const data = (await getJson(url)) as { query?: { search?: { title: string }[] } }
  const candidates = data.query?.search ?? []

  const wanted = norm(title.title)
  return candidates.find((c) => norm(stripDisambiguator(c.title)) === wanted)?.title ?? null
}

const SCREEN_CATEGORY =
  /\b(films?|film series|television series|television films?|miniseries|telenovelas?|anime)\b/i

const CATEGORY_BATCH = 20

async function keepScreenArticles(candidates: string[]): Promise<Map<string, boolean>> {
  const verdict = new Map<string, boolean>()

  for (let i = 0; i < candidates.length; i += CATEGORY_BATCH) {
    const batch = candidates.slice(i, i + CATEGORY_BATCH)
    const base =
      `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=categories` +
      // cllimit is a budget for the WHOLE request, not per article — follow
      // clcontinue or most articles come back with no categories.
      `&cllimit=500&titles=${encodeURIComponent(batch.join('|'))}`

    try {
      const seen = new Set<string>()
      let cont: string | undefined
      do {
        const url = cont ? `${base}&clcontinue=${encodeURIComponent(cont)}` : base
        const data = (await getJson(url)) as {
          query?: {
            pages?: Record<string, { title: string; categories?: { title: string }[] }>
          }
          continue?: { clcontinue?: string }
        }

        for (const page of Object.values(data.query?.pages ?? {})) {
          seen.add(page.title)
          if ((page.categories ?? []).some((c) => SCREEN_CATEGORY.test(c.title))) {
            verdict.set(page.title, true)
          }
        }
        cont = data.continue?.clcontinue
      } while (cont)

      for (const title of seen) if (!verdict.has(title)) verdict.set(title, false)
    } catch {
    }
  }
  return verdict
}

export async function resolveArticles(
  titles: Title[],
  today: Date,
): Promise<Map<number, string>> {
  const raw = await readFile(CACHE_FILE, 'utf8').catch(() => '{}')
  let cache: Cache = {}
  try {
    cache = JSON.parse(raw) as Cache
  } catch {
    cache = {}
  }

  const todayKey = today.toISOString().slice(0, 10)
  const staleBefore = new Date(today.getTime() - BUZZ.retryMissAfterDays * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const needed = titles.filter((title) => {
    const hit = cache[cacheKey(title)]
    if (!hit) return true

    return hit.article === null && hit.checked < staleBefore
  })

  if (needed.length > 0) {
    const results = await pooled(needed, BUZZ.concurrency, (title) =>
      search(title).then(
        (article): Resolution => (article ? { status: 'found', article } : { status: 'absent' }),
        (): Resolution => ({ status: 'failed' }),
      ),
    )

    const bare = new Set<string>()
    for (const result of results) {
      if (result.status === 'found' && !result.article.includes('(')) bare.add(result.article)
    }
    const verified =
      bare.size > 0
        ? await keepScreenArticles([...bare]).catch(() => new Map<string, boolean>())
        : new Map<string, boolean>()

    needed.forEach((title, i) => {
      const result = results[i]

      if (!result || result.status === 'failed') return

      const remember = (article: string | null): void => {
        cache[cacheKey(title)] = { article, checked: todayKey }
      }
      if (result.status === 'absent') return remember(null)

      if (result.article.includes('(')) return remember(result.article)

      const isScreen = verified.get(result.article)
      if (isScreen === undefined) return
      remember(isScreen ? result.article : null)
    })
    await mkdir(path.dirname(CACHE_FILE), { recursive: true })
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2))
  }

  const articles = new Map<number, string>()
  for (const title of titles) {
    const hit = cache[cacheKey(title)]
    if (hit?.article) articles.set(title.id, hit.article)
  }
  return articles
}

function stamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

export async function pageviews(
  article: string,
  today: Date,
  days: number,
): Promise<number[]> {
  const end = new Date(today.getTime() - 86_400_000)
  const start = new Date(end.getTime() - (days - 1) * 86_400_000)

  const slug = encodeURIComponent(article.replace(/ /g, '_'))
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia` +
    `/all-access/user/${slug}/daily/${stamp(start)}/${stamp(end)}`

  const data = (await getJson(url).catch(() => null)) as
    | { items?: { timestamp: string; views: number }[] }
    | null
  if (!data?.items?.length) return []

  const byDay = new Map(data.items.map((i) => [i.timestamp.slice(0, 8), i.views]))
  const lastAvailable = data.items.at(-1)!.timestamp.slice(0, 8)

  const series: number[] = []
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const day = stamp(d)
    if (day > lastAvailable) break
    series.push(byDay.get(day) ?? 0)
  }
  return series
}

export async function fetchSeries(
  articles: Map<number, string>,
  today: Date,
  days: number,
): Promise<Map<number, number[]>> {
  const entries = [...articles]
  const series = await pooled(entries, BUZZ.concurrency, ([, article]) =>
    pageviews(article, today, days).catch(() => []),
  )
  const byTitle = new Map<number, number[]>()
  entries.forEach(([id], i) => {
    const values = series[i]
    if (values?.length) byTitle.set(id, values)
  })
  return byTitle
}
