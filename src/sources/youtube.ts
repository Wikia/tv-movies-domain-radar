import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ROOT, SIGNALS, YOUTUBE_KEY } from '../config.js'
import type { SignalStore } from '../store.js'
import { isoDay } from '../store.js'
import type { Title } from '../types.js'
import { pooled } from './wikipedia.js'

const API = 'https://www.googleapis.com/youtube/v3'
const CACHE_FILE = path.join(ROOT, 'data', 'youtube-videos.json')

export interface CacheEntry {
  videoId: string | null
  publishedAt?: string
  channel?: string
  videoTitle?: string
  checked: string
  // Set by `npm run trailer set`. Search picked the wrong video (or none), a
  // human corrected it, and no later run may undo that.
  pinned?: true
}
export type Cache = Record<string, CacheEntry>

export const TRAILER_CACHE = CACHE_FILE

export function cacheKey(title: Title): string {
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

  const official = candidates.find((item) => !AGGREGATOR.test(item.snippet.channelTitle))
  return official ?? candidates[0] ?? null
}

const AGGREGATOR =
  /trailer|clips?|media|movie(s)?\b|cinema|fresh|source|fan|concept|zone|hub|access/i

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

  const staleBefore = isoDay(new Date(today.getTime() - 7 * 86_400_000))
  const needed = titles.filter((title) => {
    const hit = cache[cacheKey(title)]
    if (!hit) return true
    if (hit.pinned) return false
    return hit.videoId === null && hit.checked < staleBefore
  })
  if (needed.length === 0) return cache

  const budget = needed.slice(0, 40)
  const found = await pooled(budget, SIGNALS.concurrency, (title) =>
    findTrailer(title).catch(() => 'failed' as const),
  )

  budget.forEach((title, i) => {
    const result = found[i]

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

interface YouTubeResult {
  readings: SignalStore
  resolved: number
  polled: number
}

export async function collect(
  titles: Title[],
  today: Date,
  cache: Cache,
): Promise<YouTubeResult> {
  const videos = new Map<string, number>()
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

