import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ROOT, SCRIPTLR, SIGNALS } from './config.js'
import * as remote from './remote.js'

const DIR = path.join(ROOT, 'data', 'signals')

type Reading = Record<string, number>

type Series = Record<string, Reading>

export type SignalStore = Record<string, Series>

type SourceName = 'news' | 'youtube' | 'tmdb'

// What one source's published document looks like. The envelope exists so a
// stale file served successfully is detectable — the readings alone can't say
// when they were written.
interface Published {
  source: string
  date: string
  days: number
  titles: number
  readings: SignalStore
}

const FILENAME = 'readings.json'

function countDays(store: SignalStore): number {
  const days = new Set<string>()
  for (const series of Object.values(store)) for (const day of Object.keys(series)) days.add(day)
  return days.size
}

function file(source: SourceName): string {
  return path.join(DIR, `${source}.json`)
}

// Remote is the source of truth when configured, so the job holds no state
// between runs. A failed fetch THROWS rather than returning {}: continuing with
// an empty store would publish one day over sixty and destroy history that
// nothing can re-fetch.
async function loadLocal(source: SourceName): Promise<SignalStore> {
  const raw = await readFile(file(source), 'utf8').catch(() => '{}')
  try {
    return JSON.parse(raw) as SignalStore
  } catch {
    process.stderr.write(`[store] ${source}.json unreadable — starting fresh\n`)
    return {}
  }
}

export async function load(source: SourceName): Promise<SignalStore> {
  if (remote.canRead()) {
    const found = await remote.get<Published>(source, FILENAME)
    if (found.kind === 'found') {
      // A document that isn't ours is not an empty history. Defaulting to {}
      // here would hand save() a blank store to write over local disk and
      // publish — the exact loss this whole path is meant to prevent.
      const readings = found.body?.readings
      if (!readings || typeof readings !== 'object' || Array.isArray(readings)) {
        throw new Error(`[store] ${source}/latest/${FILENAME} is not a readings document`)
      }
      return readings
    }
    // Absent means nothing has been published yet, so fall through to the local
    // copy: the first publish must carry the history we already have rather than
    // overwrite it with a single day.
  }
  return loadLocal(source)
}

export async function save(
  source: SourceName,
  store: SignalStore,
  readings: SignalStore,
  today: Date,
  publish = false,
): Promise<void> {
  for (const [id, series] of Object.entries(readings)) {
    store[id] = { ...(store[id] ?? {}), ...series }
  }
  // Guard against local disk, not against what we loaded: if the remote read
  // came back thin for any reason, `store` is already thin and comparing it to
  // itself proves nothing. Local is the last known-good copy.
  const onDisk = await loadLocal(source)
  const before = Math.max(Object.keys(store).length, Object.keys(onDisk).length)
  prune(store, today)

  const titles = Object.keys(store).length
  if (before > 0 && titles < before * (1 - SCRIPTLR.maxShrink)) {
    throw new Error(
      `[store] refusing to write ${source}: ${titles} titles vs ${before} known — ` +
        `a shrinking store is unrecoverable once it becomes latest`,
    )
  }

  await mkdir(DIR, { recursive: true })
  await writeFile(file(source), JSON.stringify(store, null, 2))

  if (publish && remote.canWrite()) {
    const day = isoDay(today)
    const document: Published = {
      source,
      date: day,
      days: countDays(store),
      titles,
      readings: store,
    }
    await remote.put(source, remote.versionFor(day), FILENAME, document)
  }
}

function prune(store: SignalStore, today: Date): void {
  const cutoff = isoDay(new Date(today.getTime() - SIGNALS.keepDays * 86_400_000))
  for (const [id, series] of Object.entries(store)) {
    for (const day of Object.keys(series)) {
      if (day < cutoff) delete series[day]
    }
    if (Object.keys(series).length === 0) delete store[id]
  }
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Returns only the days that exist. Never fills a gap with zero.
export function series(
  store: SignalStore,
  titleId: number,
  metric: string,
): { dates: string[]; values: number[] } | null {
  const found = store[String(titleId)] ?? {}
  const dates = Object.keys(found)
    .filter((day) => typeof found[day]?.[metric] === 'number')
    .sort()
  if (dates.length < SIGNALS.minHistoryDays) return null
  return { dates, values: dates.map((day) => found[day]![metric]!) }
}

export function mature(store: SignalStore, metric: string): number {
  return Object.keys(store).filter((id) => series(store, Number(id), metric) !== null).length
}

