/** Trailer statistics, from the YouTube Data API.
 *
 * YouTube reports only LIFETIME totals — there is no history endpoint — so a
 * daily series exists only because we record one. Nothing useful comes out on
 * the first run; a baseline takes about a week (see SIGNALS.minHistoryDays),
 * and that is inherent to the source rather than a shortcoming here.
 *
 * What IS available immediately is the trailer's `publishedAt`: a timestamped,
 * verifiable cause. "Verity +28.7k/day" becomes "Verity +28.7k/day, trailer
 * published Aug 11", which is the half of the sentence the dashboard currently
 * can't say.
 *
 * Quota shape (10,000 units/day free) is why resolution is cached forever:
 *   search.list  100 units — once per title, ever
 *   videos.list    1 unit  — batched 50 at a time, so a full daily poll of the
 *                            calendar costs about 5 units
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ROOT, SIGNALS, YOUTUBE_KEY } from '../config.js'
import type { SignalStore } from '../store.js'
import { isoDay } from '../store.js'
import type { Title } from '../types.js'
import { pooled } from './wikipedia.js'

const API = 'https://www.googleapis.com/youtube/v3'
const CACHE_FILE = path.join(ROOT, 'data', 'youtube-videos.json')

/** What we remember per title. `null` records "searched, found nothing
 * convincing" so we don't burn 100 quota units on it every run. */
interface CacheEntry {
  videoId: string | null
  publishedAt?: string
  channel?: string
  videoTitle?: string
  checked: string
}
type Cache = Record<string, CacheEntry>

function cacheKey(title: Title): string {
  return `${title.title}|${title.type}|${title.releaseDate?.slice(0, 4) ?? '?'}`
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`youtube: HTTP ${response.status}`)
  return response.json()
}

interface SearchItem {
  id: { videoId?: string }
  snippet: { title: string; channelTitle: string; publishedAt: string }
}

/** Find the official trailer for a title.
 *
 * Deliberately strict, for the reason every resolver in this project is
 * strict: a reaction video or fan edit would attach somebody else's audience to
 * the title, and nothing downstream would catch it. We require the video title
 * to contain the film's name AND to look like a trailer, and prefer channels
 * that look like a distributor rather than an aggregator.
 */
async function findTrailer(title: Title): Promise<SearchItem | null> {
  const year = title.releaseDate?.slice(0, 4) ?? ''
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: '10',
    q: `${title.title} ${year} official trailer`,
    key: YOUTUBE_KEY,
  })
  const data = (await getJson(`${API}/search?${params}`)) as { items?: SearchItem[] }
  const items = data.items ?? []

  const wanted = norm(title.title)
  const candidates = items.filter((item) => {
    const videoTitle = norm(item.snippet.title)
    return videoTitle.includes(wanted) && /trailer|teaser/i.test(item.snippet.title)
  })

  // Prefer the distributor's upload over an aggregator's re-upload. Searching
  // "Verity 2026 official trailer" returns the real Amazon MGM Studios trailer
  // alongside two re-uploads with near-identical titles; picking on API order
  // alone would be picking on relevance, which is not authority. Re-uploads
  // also carry their own view counts, so choosing one attributes a
  // reaction-channel's audience to the film.
  const official = candidates.find((item) => !AGGREGATOR.test(item.snippet.channelTitle))
  return official ?? candidates[0] ?? null
}

/** Channel names that are usually re-uploaders rather than rights holders. Not
 * exhaustive and not meant to be — the resolved channel is stored in the cache
 * so a wrong pick is visible and correctable. */
const AGGREGATOR =
  /trailer|clips?|media|movie(s)?\b|cinema|fresh|source|fan|concept|zone|hub|access/i

/** Resolve trailers for titles we haven't looked up yet, updating the cache. */
export async function resolveTrailers(titles: Title[], today: Date): Promise<Cache> {
  const raw = await readFile(CACHE_FILE, 'utf8').catch(() => '{}')
  let cache: Cache = {}
  try {
    cache = JSON.parse(raw) as Cache
  } catch {
    cache = {}
  }
  if (!YOUTUBE_KEY) return cache

  const todayKey = isoDay(today)
  // Misses are retried on the same cadence as Wikipedia's: an unreleased film
  // often has no trailer yet and gets one later.
  const staleBefore = isoDay(new Date(today.getTime() - 7 * 86_400_000))
  const needed = titles.filter((title) => {
    const hit = cache[cacheKey(title)]
    if (!hit) return true
    return hit.videoId === null && hit.checked < staleBefore
  })
  if (needed.length === 0) return cache

  // search.list is 100 units a call, so this is the expensive half of the
  // budget. Bounded per run rather than spending the day's quota in one go;
  // the rest come round on later runs.
  const budget = needed.slice(0, 40)
  const found = await pooled(budget, SIGNALS.concurrency, (title) =>
    findTrailer(title).catch(() => 'failed' as const),
  )

  budget.forEach((title, i) => {
    const result = found[i]
    // undefined can't occur (pooled fills every slot) but the index signature
    // says otherwise; treat it like a failure and retry rather than assert.
    if (result === undefined || result === 'failed') return
    if (result === null) {
      cache[cacheKey(title)] = { videoId: null, checked: todayKey }
      return
    }
    cache[cacheKey(title)] = {
      videoId: result.id.videoId ?? null,
      publishedAt: result.snippet.publishedAt,
      channel: result.snippet.channelTitle,
      videoTitle: result.snippet.title,
      checked: todayKey,
    }
  })

  await mkdir(path.dirname(CACHE_FILE), { recursive: true })
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2))
  return cache
}

interface StatsItem {
  id: string
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
}

export interface YouTubeResult {
  readings: SignalStore
  resolved: number
  polled: number
}

/** Record today's lifetime counters for every resolved trailer.
 *
 * Stored as totals, not deltas. Deltas are derived at read time from two dated
 * readings, which keeps the store a record of what was observed rather than of
 * what we computed — a wrong delta can then be recomputed instead of being
 * baked in permanently.
 */
export async function collect(
  titles: Title[],
  today: Date,
  cache: Cache,
): Promise<YouTubeResult> {
  const videos = new Map<string, number>() // videoId -> title id
  for (const title of titles) {
    const hit = cache[cacheKey(title)]
    if (hit?.videoId) videos.set(hit.videoId, title.id)
  }
  const readings: SignalStore = {}
  if (!YOUTUBE_KEY || videos.size === 0) {
    return { readings, resolved: videos.size, polled: 0 }
  }

  const ids = [...videos.keys()]
  const day = isoDay(today)
  let polled = 0

  // videos.list takes up to 50 ids per call at 1 unit — the entire calendar
  // costs about five units a day.
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50))

  for (const batch of batches) {
    const params = new URLSearchParams({
      part: 'statistics',
      id: batch.join(','),
      key: YOUTUBE_KEY,
    })
    const data = (await getJson(`${API}/videos?${params}`).catch(() => null)) as {
      items?: StatsItem[]
    } | null
    if (!data?.items) continue

    for (const item of data.items) {
      const titleId = videos.get(item.id)
      if (titleId == null) continue
      const stats = item.statistics ?? {}
      const reading: Record<string, number> = {}
      if (stats.viewCount != null) reading.views = Number(stats.viewCount)
      if (stats.likeCount != null) reading.likes = Number(stats.likeCount)
      if (stats.commentCount != null) reading.comments = Number(stats.commentCount)
      if (Object.keys(reading).length === 0) continue
      readings[String(titleId)] = { [day]: reading }
      polled++
    }
  }

  return { readings, resolved: videos.size, polled }
}

/** The trailer behind a title, for annotating "why is this hot". Available
 * from the first run — unlike the view series, this needs no history. */
export function trailerFor(cache: Cache, title: Title): CacheEntry | null {
  const hit = cache[cacheKey(title)]
  return hit?.videoId ? hit : null
}
