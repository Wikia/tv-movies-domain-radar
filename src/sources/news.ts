import { SIGNALS } from '../config.js'
import type { SignalStore } from '../store.js'
import { isoDay } from '../store.js'
import type { Title } from '../types.js'
import { pooled } from './wikipedia.js'

const ENDPOINT = 'https://news.google.com/rss/search'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function tooGeneric(title: string): boolean {
  const words = title.trim().split(/\s+/).filter(Boolean)
  const letters = title.replace(/[^a-z0-9]/gi, '')
  return words.length < 2 || letters.length < 8
}

function query(title: Title): string {
  const medium = title.type === 'movie' ? 'movie' : 'series'
  return `"${title.title}" ${medium}`
}

function url(title: Title, day: string): string {
  const next = isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000))
  const params = new URLSearchParams({
    q: `${query(title)} after:${day} before:${next}`,
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
  })
  return `${ENDPOINT}?${params}`
}

async function countFor(title: Title, day: string): Promise<number> {
  const response = await fetch(url(title, day), { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) throw new Error(`news: HTTP ${response.status}`)
  const xml = await response.text()
  return (xml.match(/<item>/g) ?? []).length
}

function missingDays(store: SignalStore, title: Title, today: Date): string[] {
  const have = store[String(title.id)] ?? {}
  const out: string[] = []
  for (let back = 1; back <= SIGNALS.newsBackfillDays; back++) {
    const day = isoDay(new Date(today.getTime() - back * 86_400_000))
    if (!(day in have)) out.push(day)
  }
  return out.reverse()
}

interface NewsResult {
  readings: SignalStore
  queried: number
  pending: number
  skipped: number
  failed: number
}

export async function collect(titles: Title[], today: Date, store: SignalStore): Promise<NewsResult> {
  const searchable = titles.filter((title) => !tooGeneric(title.title))
  const skipped = titles.length - searchable.length

  const byUrgency = [...searchable].sort(
    (a, b) => (a.daysOut ?? Infinity) - (b.daysOut ?? Infinity),
  )
  const wanted: { title: Title; day: string }[] = []
  for (const title of byUrgency) {
    for (const day of missingDays(store, title, today)) wanted.push({ title, day })
  }

  const work = wanted.slice(0, SIGNALS.newsQueriesPerRun)

  const readings: SignalStore = {}
  let failed = 0
  await pooled(work, SIGNALS.concurrency, async ({ title, day }) => {
    try {
      const articles = await countFor(title, day)
      const key = String(title.id)
      readings[key] = readings[key] ?? {}

      readings[key][day] =
        articles >= SIGNALS.newsDailyCap ? { articles, capped: 1 } : { articles }
    } catch {
      failed++
    }
  })

  return { readings, queried: work.length, pending: wanted.length - work.length, skipped, failed }
}
