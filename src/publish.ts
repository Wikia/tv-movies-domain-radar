import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ROOT } from './config.js'
import * as remote from './remote.js'
import type { RadarOutput, TrendingWiki } from './types.js'

// The id caches are the least obvious thing that has to survive a stateless run,
// and the most expensive to lose. YouTube's search.list costs 100 quota units a
// title against a 10,000/day budget, so re-resolving 234 titles would exceed the
// day's quota outright; Wikipedia resolution converges upward across runs, so a
// job that forgets it sits permanently at cold-run coverage.
const CACHES = {
  wikiArticles: path.join(ROOT, 'data', 'wiki-articles.json'),
  youtubeVideos: path.join(ROOT, 'data', 'youtube-videos.json'),
  tmdbIds: path.join(ROOT, 'data', 'tmdb-ids.json'),
} as const

type CacheName = keyof typeof CACHES
type Caches = Partial<Record<CacheName, unknown>>

const CACHE_FOLDER = 'resolve'
const CACHE_FILE = 'ids.json'

// Only fills caches that are MISSING locally. A local file is at least as fresh
// as the published one and the run is about to update it, so remote never
// overwrites work in progress — it only seeds a fresh container.
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

// The export is weekly and pulled through the Google Drive MCP, which a headless
// run has no access to. Publishing it means the daily job reads it over HTTP
// instead — the one dependency that otherwise stops this running unattended.
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

export async function publishRadar(output: RadarOutput): Promise<void> {
  if (!remote.canWrite()) return
  await remote.put(RADAR_FOLDER, remote.versionFor(output.today), RADAR_FILE, output)
}

export async function fetchRadar(day: string): Promise<RadarOutput | null> {
  const found = await remote.get<RadarOutput>(RADAR_FOLDER, RADAR_FILE, remote.versionFor(day))
  return found.kind === 'absent' ? null : found.body
}
