/** Snapshot + diff — the "don't miss anything" mechanism.
 *
 * Metacritic tells you what the calendar looks like TODAY. It does not tell you
 * what CHANGED. A title quietly added to the schedule, or a release date that
 * slipped, is exactly the thing a domain team misses — so we keep yesterday's
 * snapshot and diff against it. This is a signal the upstream API doesn't offer.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ROOT } from './config.js'
import type { Change, Title } from './types.js'

const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots')
const LATEST = path.join(SNAPSHOT_DIR, 'latest.json')

/** Only the fields the diff cares about, so snapshots stay small and stable. */
interface SnapshotEntry {
  id: number
  type: Title['type']
  title: string
  releaseDate: string | null
}

interface Snapshot {
  takenAt: string
  entries: SnapshotEntry[]
}

function toEntries(titles: Title[]): SnapshotEntry[] {
  return titles.map(({ id, type, title, releaseDate }) => ({ id, type, title, releaseDate }))
}

/** Previous snapshot, or null on the first ever run. */
export async function loadPrevious(): Promise<Snapshot | null> {
  try {
    return JSON.parse(await readFile(LATEST, 'utf8')) as Snapshot
  } catch {
    return null // first run, or the file was cleared — both mean "no baseline"
  }
}

export async function save(titles: Title[], takenAt: string): Promise<void> {
  await mkdir(SNAPSHOT_DIR, { recursive: true })
  const snapshot: Snapshot = { takenAt, entries: toEntries(titles) }
  const body = JSON.stringify(snapshot, null, 2)

  await writeFile(LATEST, body)
  // Keep a dated copy too, so history survives and a bad run can be inspected.
  await writeFile(path.join(SNAPSHOT_DIR, `${takenAt.slice(0, 10)}.json`), body)
}

/** What changed between two snapshots.
 *
 * Returns nothing on the first run: with no baseline, every title would look
 * "new" and the first Slack post would be several hundred lines of noise.
 */
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

  // Anything left was on the calendar yesterday and isn't today. Usually it just
  // released (falling out of "coming soon"), which is why this is reported but
  // deliberately does NOT raise an alert.
  for (const old of before.values()) {
    changes.push({ kind: 'removed', id: old.id, type: old.type, title: old.title })
  }

  return changes
}
