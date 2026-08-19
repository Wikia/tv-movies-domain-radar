import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ROOT, SIGNALS, TMDB_TOKEN } from '../config.js'
import type { SignalStore } from '../store.js'
import { isoDay } from '../store.js'
import type { Title } from '../types.js'
import { pooled } from '../pool.js'

const API = 'https://api.themoviedb.org/3'
const CACHE_FILE = path.join(ROOT, 'data', 'tmdb-ids.json')

interface CacheEntry {
  tmdbId: number | null
  matchedTitle?: string
  matchedDate?: string
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
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' },
  })
  if (response.status === 429) throw new Error('tmdb: rate limited')
  if (!response.ok) throw new Error(`tmdb: HTTP ${response.status}`)
  return response.json()
}

interface SearchHit {
  id: number
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
}

const DATE_TOLERANCE_DAYS = 60

async function search(title: Title): Promise<number | null> {
  const kind = title.type === 'movie' ? 'movie' : 'tv'
  const year = title.releaseDate?.slice(0, 4)
  const params = new URLSearchParams({ query: title.title, include_adult: 'false' })
  if (year) params.set(kind === 'movie' ? 'primary_release_year' : 'first_air_date_year', year)

  const data = (await getJson(`${API}/search/${kind}?${params}`)) as { results?: SearchHit[] }
  const wanted = norm(title.title)

  for (const hit of (data.results ?? []).slice(0, 5)) {
    const name = hit.title ?? hit.name ?? ''
    if (norm(name) !== wanted) continue
    if (!sameRelease(title.releaseDate, hit.release_date ?? hit.first_air_date ?? null)) continue
    return hit.id
  }
  return null
}

function sameRelease(ours: string | null, theirs: string | null): boolean {
  if (!ours || !theirs) return true
  const apart = Math.abs(Date.parse(`${ours}T00:00:00Z`) - Date.parse(`${theirs}T00:00:00Z`))
  if (Number.isNaN(apart)) return true
  return apart <= DATE_TOLERANCE_DAYS * 86_400_000
}

export async function resolveIds(titles: Title[], today: Date): Promise<Cache> {
  const raw = await readFile(CACHE_FILE, 'utf8').catch(() => '{}')
  let cache: Cache = {}
  try {
    cache = JSON.parse(raw) as Cache
  } catch {
    cache = {}
  }
  if (!TMDB_TOKEN) return cache

  const todayKey = isoDay(today)
  const staleBefore = isoDay(new Date(today.getTime() - 7 * 86_400_000))
  const needed = titles.filter((title) => {
    const hit = cache[cacheKey(title)]
    if (!hit) return true
    return hit.tmdbId === null && hit.checked < staleBefore
  })
  if (needed.length === 0) return cache

  const found = await pooled(needed, SIGNALS.concurrency, (title) =>
    search(title).catch(() => 'failed' as const),
  )
  needed.forEach((title, i) => {
    const result = found[i]
    if (result === 'failed') return
    cache[cacheKey(title)] = { tmdbId: result ?? null, checked: todayKey }
  })

  await mkdir(path.dirname(CACHE_FILE), { recursive: true })
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2))
  return cache
}

interface Details {
  popularity?: number
  vote_count?: number
  vote_average?: number
}

interface TmdbResult {
  readings: SignalStore
  resolved: number
  polled: number
}

export async function collect(titles: Title[], today: Date, cache: Cache): Promise<TmdbResult> {
  const targets = titles
    .map((title) => ({ title, id: cache[cacheKey(title)]?.tmdbId ?? null }))
    .filter((entry): entry is { title: Title; id: number } => entry.id != null)

  const readings: SignalStore = {}
  if (!TMDB_TOKEN || targets.length === 0) {
    return { readings, resolved: targets.length, polled: 0 }
  }

  const day = isoDay(today)
  let polled = 0
  await pooled(targets, SIGNALS.concurrency, async ({ title, id }) => {
    const kind = title.type === 'movie' ? 'movie' : 'tv'
    const data = (await getJson(`${API}/${kind}/${id}`).catch(() => null)) as Details | null
    if (!data) return
    const reading: Record<string, number> = {}
    if (typeof data.popularity === 'number') reading.popularity = data.popularity
    if (typeof data.vote_count === 'number') reading.voteCount = data.vote_count
    if (typeof data.vote_average === 'number') reading.voteAverage = data.vote_average
    if (Object.keys(reading).length === 0) return
    readings[String(title.id)] = { [day]: reading }
    polled++
  })

  return { readings, resolved: targets.length, polled }
}
