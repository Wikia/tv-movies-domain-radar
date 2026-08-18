import { SIGNALS } from '../config.js'
import type { SignalStore } from '../store.js'
import { isoDay } from '../store.js'
import type { Title } from '../types.js'
import { pooled } from './wikipedia.js'

const ENDPOINT = 'https://news.google.com/rss/search'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Single-word titles are still refused. Filtering on the headline rescues some
// of them — "Animals" goes from 50 articles to 6 that are genuinely about the
// Ben Affleck thriller — but it fails on common words: for "War" it keeps
// "A Cold War Movie…", and for "Him" it keeps "…makes him the most residuals".
// Both look exactly like a hit and neither is one, so the phrase has to carry
// more than one word. The 8-letter floor is gone: headline filtering handles
// short-but-distinctive phrases like "The Deb" that the old rule threw away.
function tooGeneric(title: string): boolean {
  const words = title.trim().split(/\s+/).filter(Boolean)
  return words.length < 2
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

function decode(value: string): string {
  return value
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

interface Item {
  headline: string
  outlet: string
}

// Each <item> title arrives as "Headline - Outlet".
function parseItems(xml: string): Item[] {
  const items: Item[] = []
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1]!
    const raw = decode(/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? '')
    const source = decode(/<source[^>]*>([\s\S]*?)<\/source>/.exec(block)?.[1] ?? '')
    const split = raw.lastIndexOf(' - ')
    items.push({
      headline: split > 0 ? raw.slice(0, split) : raw,
      outlet: source || (split > 0 ? raw.slice(split + 3) : 'unknown'),
    })
  }
  return items
}

interface DayCount {
  articles: number
  onTopic: number
  outlets: number
}

// Three numbers per day, because the raw count answers the wrong question.
//
//   articles  everything the query returned, kept for continuity and so the
//             on-topic share stays inspectable
//   onTopic   headlines that actually name the title — "Animals" returns 50
//             articles of which 12 are about the film
//   outlets   distinct publications among those. Resists syndication (twelve
//             sites re-running one wire story is one story) and saturates far
//             later than the 100-item ceiling: Avengers: Doomsday hits the cap
//             at 100 articles while sitting at 55 outlets.
async function countFor(title: Title, day: string): Promise<DayCount> {
  const response = await fetch(url(title, day), { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) throw new Error(`news: HTTP ${response.status}`)
  const items = parseItems(await response.text())

  const wanted = normalise(title.title)
  const onTopic = items.filter((item) => normalise(item.headline).includes(wanted))
  return {
    articles: items.length,
    onTopic: onTopic.length,
    outlets: new Set(onTopic.map((item) => item.outlet)).size,
  }
}

// A day counts as missing until it carries the metric we now score on, so days
// recorded before headline filtering are re-queried once and filled in rather
// than leaving a permanent seam in the middle of the series.
function missingDays(store: SignalStore, title: Title, today: Date): string[] {
  const have = store[String(title.id)] ?? {}
  const out: string[] = []
  for (let back = 1; back <= SIGNALS.newsBackfillDays; back++) {
    const day = isoDay(new Date(today.getTime() - back * 86_400_000))
    if (have[day]?.onTopic === undefined) out.push(day)
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
      const count = await countFor(title, day)
      const key = String(title.id)
      readings[key] = readings[key] ?? {}
      readings[key][day] = {
        ...count,
        // The feed stops at 100, so a day at the ceiling is censored rather
        // than measured. `outlets` is the more honest number for those.
        ...(count.articles >= SIGNALS.newsDailyCap ? { capped: 1 } : {}),
      }
    } catch {
      failed++
    }
  })

  return { readings, queried: work.length, pending: wanted.length - work.length, skipped, failed }
}
