/** Press coverage per day, from Google News RSS.
 *
 * Keyless, no quota, no approval — the only source here that needs nothing from
 * anybody. It also reaches titles Wikipedia can't see: an article can be
 * written about a film that has no Wikipedia article yet, which is exactly the
 * blind spot the buzz detector currently has.
 *
 * ONE DAY PER REQUEST, and that is not an accident. The obvious approach —
 * fetch the feed once and count `pubDate`s per day — is a false-spike
 * generator. The feed is relevance-ordered and capped at 100 items, so for a
 * busy title the older days are silently truncated and read as "no coverage",
 * i.e. as a flat baseline followed by an enormous jump. Measured against the
 * live API: one unwindowed query reported 36 articles for Coyote vs. Acme on
 * 2026-08-12, while day-windowed queries over the same period found 320.
 *
 * `after:`/`before:` are respected by the RSS endpoint, so a windowed query
 * returns that day and only that day.
 */
import { SIGNALS } from '../config.js'
import type { SignalStore } from '../store.js'
import { isoDay } from '../store.js'
import type { Title } from '../types.js'
import { pooled } from './wikipedia.js'

const ENDPOINT = 'https://news.google.com/rss/search'

/** Google News serves the RSS to browsers; a bare client gets less consistent
 * results, so present as one. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Titles too generic to search for.
 *
 * A quoted phrase is still only a phrase: "Dreams in Nightmares" returned
 * articles from 2023, and titles like "War", "Animals" or "It Ends" would
 * return the news. Wikipedia solves this by resolving to a disambiguated
 * article and Google Trends by resolving to a typed entity; Google News has no
 * equivalent, so the only honest guard is to decline the query.
 *
 * The film/TV qualifier below narrows most of the rest.
 */
function tooGeneric(title: string): boolean {
  const words = title.trim().split(/\s+/).filter(Boolean)
  const letters = title.replace(/[^a-z0-9]/gi, '')
  return words.length < 2 || letters.length < 8
}

function query(title: Title): string {
  // Quoted phrase plus a medium qualifier. Without the qualifier "Paper Tiger"
  // is a metaphor and "Hot Spot" is wifi; with it, the results are about the
  // release. Not perfect — nothing about phrase matching is — which is why
  // coverage gets reported rather than assumed.
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

/** Article count for one title on one day. Throws on a failed request so the
 * caller can leave the day unrecorded rather than storing a wrong zero. */
async function countFor(title: Title, day: string): Promise<number> {
  const response = await fetch(url(title, day), { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) throw new Error(`news: HTTP ${response.status}`)
  const xml = await response.text()
  return (xml.match(/<item>/g) ?? []).length
}

/** Which days still need fetching for a title: the completed days inside the
 * backfill window that aren't already recorded.
 *
 * Today is excluded — it is still in progress, and recording a partial day
 * would put a fake trough at the end of every series.
 */
function missingDays(store: SignalStore, title: Title, today: Date): string[] {
  const have = store[String(title.id)] ?? {}
  const out: string[] = []
  for (let back = 1; back <= SIGNALS.newsBackfillDays; back++) {
    const day = isoDay(new Date(today.getTime() - back * 86_400_000))
    if (!(day in have)) out.push(day)
  }
  return out.reverse()
}

export interface NewsResult {
  readings: SignalStore
  queried: number
  pending: number
  skipped: number
  failed: number
}

/** Collect article counts for every title that can be searched for.
 *
 * Cheap to re-run: only days not already stored are fetched, so a same-day
 * second run does nothing at all.
 */
export async function collect(titles: Title[], today: Date, store: SignalStore): Promise<NewsResult> {
  const searchable = titles.filter((title) => !tooGeneric(title.title))
  const skipped = titles.length - searchable.length

  // Nearest release first, so a limited run spends its budget on the titles
  // whose baseline is most urgently needed.
  const byUrgency = [...searchable].sort(
    (a, b) => (a.daysOut ?? Infinity) - (b.daysOut ?? Infinity),
  )
  const wanted: { title: Title; day: string }[] = []
  for (const title of byUrgency) {
    for (const day of missingDays(store, title, today)) wanted.push({ title, day })
  }
  // Budgeted rather than exhaustive: seeding the whole calendar at once is
  // thousands of requests. The remainder is picked up by later runs.
  const work = wanted.slice(0, SIGNALS.newsQueriesPerRun)

  const readings: SignalStore = {}
  let failed = 0
  await pooled(work, SIGNALS.concurrency, async ({ title, day }) => {
    try {
      const articles = await countFor(title, day)
      const key = String(title.id)
      readings[key] = readings[key] ?? {}
      // A day at the cap is censored, not counted — recorded so the series has
      // no hole, flagged so nothing downstream reads it as exact.
      readings[key][day] =
        articles >= SIGNALS.newsDailyCap ? { articles, capped: 1 } : { articles }
    } catch {
      failed++ // leave the day unrecorded; the next run retries it
    }
  })

  return { readings, queried: work.length, pending: wanted.length - work.length, skipped, failed }
}
