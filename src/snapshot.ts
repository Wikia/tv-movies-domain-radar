import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ROOT, SCRIPTLR } from './config.js'
import { fetchRadar } from './publish.js'
import * as remote from './remote.js'
import type { Change, Title } from './types.js'

const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots')
const LATEST = path.join(SNAPSHOT_DIR, 'latest.json')

export interface SnapshotEntry {
  id: number
  type: Title['type']
  title: string
  releaseDate: string | null
}

export interface Snapshot {
  takenAt: string
  entries: SnapshotEntry[]
}

function toEntries(titles: Title[]): SnapshotEntry[] {
  return titles.map(({ id, type, title, releaseDate }) => ({ id, type, title, releaseDate }))
}

const DATED = /^(\d{4}-\d{2}-\d{2})\.json$/

const KEEP_DAYS = 60

// Baseline is the most recent snapshot from a PREVIOUS day, never latest.json —
// that file is rewritten every run, so diffing against it made a second run in a
// day report nothing.
export async function loadPrevious(today: Date): Promise<Snapshot | null> {
  const todayKey = today.toISOString().slice(0, 10)

  // Remote baselines are fetched by EXPLICIT date, walking back from yesterday —
  // never `latest`, which becomes today's file the moment we publish and would
  // make a second run diff today against today. Published radar.json carries the
  // full title list, so it doubles as the snapshot.
  if (remote.canRead()) {
    for (let back = 1; back <= SCRIPTLR.baselineLookbackDays; back++) {
      const day = new Date(today.getTime() - back * 86_400_000).toISOString().slice(0, 10)
      const previous = await fetchRadar(day)
      if (previous) {
        return { takenAt: previous.generatedAt, entries: toEntries(previous.titles) }
      }
    }
    return null
  }

  const earlier = (await readdir(SNAPSHOT_DIR).catch((): string[] => []))
    .map((file) => DATED.exec(file)?.[1])
    .filter((date): date is string => !!date && date < todayKey)
    .sort()

  const mostRecent = earlier.at(-1)
  if (!mostRecent) return null

  try {
    return JSON.parse(
      await readFile(path.join(SNAPSHOT_DIR, `${mostRecent}.json`), 'utf8'),
    ) as Snapshot
  } catch {
    return null
  }
}

export async function save(titles: Title[], takenAt: string, today: Date): Promise<void> {
  await mkdir(SNAPSHOT_DIR, { recursive: true })
  const snapshot: Snapshot = { takenAt, entries: toEntries(titles) }
  const body = JSON.stringify(snapshot, null, 2)

  await writeFile(LATEST, body)
  await writeFile(path.join(SNAPSHOT_DIR, `${today.toISOString().slice(0, 10)}.json`), body)
  await prune()
}

async function prune(): Promise<void> {
  const dated = (await readdir(SNAPSHOT_DIR).catch((): string[] => []))
    .filter((file) => DATED.test(file))
    .sort()

  for (const file of dated.slice(0, Math.max(0, dated.length - KEEP_DAYS))) {
    await rm(path.join(SNAPSHOT_DIR, file), { force: true })
  }
}

export function diff(previous: Snapshot | null, current: Title[]): Change[] {
  if (!previous) return []

  const before = new Map(previous.entries.map((e) => [e.id, e]))
  const changes: Change[] = []

  for (const title of current) {
    const old = before.get(title.id)
    if (!old) {
      changes.push({ kind: 'new', id: title.id, type: title.type, title: title.title })
      continue
    }
    if (old.releaseDate !== title.releaseDate) {
      changes.push({
        kind: 'date-changed',
        id: title.id,
        type: title.type,
        title: title.title,
        from: old.releaseDate,
        to: title.releaseDate,
      })
    }
    before.delete(title.id)
  }

  for (const old of before.values()) {
    changes.push({ kind: 'removed', id: old.id, type: old.type, title: old.title })
  }

  return changes
}
