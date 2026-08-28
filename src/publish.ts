import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ROOT, SCRIPTLR } from './config.js'
import * as remote from './remote.js'
import type { RadarOutput, TrendingWiki } from './types.js'

// Cron state, not a cache: re-resolving YouTube trailers costs 100 quota units a
// title against a 10,000/day budget.
const CACHES = {
  wikiArticles: path.join(ROOT, 'data', 'wiki-articles.json'),
  youtubeVideos: path.join(ROOT, 'data', 'youtube-videos.json'),
  tmdbIds: path.join(ROOT, 'data', 'tmdb-ids.json'),
} as const

type CacheName = keyof typeof CACHES
type Caches = Partial<Record<CacheName, unknown>>

const CACHE_FOLDER = 'resolve'
const CACHE_FILE = 'ids.json'

// Fills only caches MISSING locally, so remote never overwrites work in progress.
export async function hydrateCaches(): Promise<number> {
  if (!remote.canRead()) return 0
  const missing: CacheName[] = []
  for (const [name, file] of Object.entries(CACHES) as [CacheName, string][]) {
    const exists = await readFile(file, 'utf8').then(
      () => true,
      () => false,
    )
    if (!exists) missing.push(name)
  }
  if (missing.length === 0) return 0

  const found = await remote.get<{ caches: Caches }>(CACHE_FOLDER, CACHE_FILE)
  if (found.kind === 'absent') return 0

  let filled = 0
  for (const name of missing) {
    const body = found.body.caches?.[name]
    if (body === undefined) continue
    await writeFile(CACHES[name], JSON.stringify(body, null, 2))
    filled++
  }
  return filled
}

export async function publishCaches(day: string): Promise<void> {
  if (!remote.canWrite()) return
  const caches: Caches = {}
  for (const [name, file] of Object.entries(CACHES) as [CacheName, string][]) {
    const raw = await readFile(file, 'utf8').catch(() => null)
    if (raw === null) continue
    try {
      caches[name] = JSON.parse(raw)
    } catch {
      // A corrupt local cache must not be published over a good remote one.
      continue
    }
  }
  if (Object.keys(caches).length === 0) return
  await remote.put(CACHE_FOLDER, remote.versionFor(day), CACHE_FILE, { date: day, caches })
}

const TRENDING_FOLDER = 'trending'
const TRENDING_FILE = 'wikis.json'

interface PublishedTrending {
  week: string
  wikis: TrendingWiki[]
}

// The weekly export is pulled through the Google Drive MCP, which a headless run
// cannot reach; publishing it lets the daily job read it over HTTP instead.
export async function loadTrending(): Promise<TrendingWiki[]> {
  if (!remote.canRead()) return []
  const found = await remote.get<PublishedTrending>(TRENDING_FOLDER, TRENDING_FILE)
  return found.kind === 'absent' ? [] : (found.body.wikis ?? [])
}

export async function publishTrending(wikis: TrendingWiki[]): Promise<void> {
  if (!remote.canWrite() || wikis.length === 0) return
  const week = wikis[0]!.week
  const document: PublishedTrending = { week, wikis }
  await remote.put(TRENDING_FOLDER, remote.versionFor(week), TRENDING_FILE, document)
}

const RADAR_FOLDER = 'radar'
const RADAR_FILE = 'radar.json'

/** written = published now · exists = already published today · blocked = the
 * slot holds another day's data and cannot be corrected. */
type PublishResult = 'written' | 'exists' | 'blocked'

export async function publishRadar(output: RadarOutput): Promise<PublishResult> {
  if (!remote.canWrite()) return 'exists'
  const version = remote.versionFor(output.today)

  // Write-once storage: a slot holding another day's data can never be corrected.
  // Reported rather than thrown — radar.json is rebuildable, the readings are not.
  const existing = await remote.get<RadarOutput>(RADAR_FOLDER, RADAR_FILE, version)
  if (existing.kind === 'found') {
    return existing.body.today === output.today ? 'exists' : 'blocked'
  }
  await remote.post(RADAR_FOLDER, version, RADAR_FILE, output)
  return 'written'
}

export async function fetchRadar(day: string): Promise<RadarOutput | null> {
  const found = await remote.get<RadarOutput>(RADAR_FOLDER, RADAR_FILE, remote.versionFor(day))
  return found.kind === 'absent' ? null : found.body
}

// The most recent PREVIOUS day's full radar, walked back like the diff baseline.
// Carries buzz, so the trending alert can fire on the transition into trending
// rather than every day a title stays there. Null when nothing is published yet
// or storage isn't configured (local runs), in which case every spike reads new.
export async function previousRadar(today: Date): Promise<RadarOutput | null> {
  if (!remote.canRead()) return null
  for (let back = 1; back <= SCRIPTLR.baselineLookbackDays; back++) {
    const day = new Date(today.getTime() - back * 86_400_000).toISOString().slice(0, 10)
    const previous = await fetchRadar(day)
    if (previous) return previous
  }
  return null
}
