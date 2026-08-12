/** Snapshot + diff — the "don't miss anything" mechanism.
 *
 * Metacritic tells you what the calendar looks like TODAY. It does not tell you
 * what CHANGED. A title quietly added to the schedule, or a release date that
 * slipped, is exactly the thing a domain team misses — so we keep yesterday's
 * snapshot and diff against it. This is a signal the upstream API doesn't offer.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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

const DATED = /^(\d{4}-\d{2}-\d{2})\.json$/

/** How many dated snapshots to keep. Enough to investigate a bad run or widen
 * the diff window later; small enough that the directory never sprawls. */
const KEEP_DAYS = 60

/** The baseline to diff against: the most recent snapshot from a PREVIOUS day.
 *
 * Deliberately NOT `latest.json`. That file is rewritten on every run, so
 * diffing against it meant a second run in the same day compared today against
 * today and reported nothing — silently erasing the day's changes, which is the
 * exact opposite of what this tool promises. Anchoring on the previous day makes
 * repeated runs idempotent: run it five times, still "what changed since
 * yesterday".
 *
 * Returns null when there's no earlier day on record, which the caller treats as
 * "establish a baseline, report no changes".
 */
export async function loadPrevious(today: Date): Promise<Snapshot | null> {
  const todayKey = today.toISOString().slice(0, 10)

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

/** Persist today's snapshot. `today` dates the file rather than the wall clock,
 * so `--today` stays reproducible. */
export async function save(titles: Title[], takenAt: string, today: Date): Promise<void> {
  await mkdir(SNAPSHOT_DIR, { recursive: true })
  const snapshot: Snapshot = { takenAt, entries: toEntries(titles) }
  const body = JSON.stringify(snapshot, null, 2)

  // latest.json is kept purely for inspection — nothing diffs against it.
  await writeFile(LATEST, body)
  await writeFile(path.join(SNAPSHOT_DIR, `${today.toISOString().slice(0, 10)}.json`), body)
  await prune()
}

/** Drop dated snapshots beyond KEEP_DAYS, oldest first. */
async function prune(): Promise<void> {
  const dated = (await readdir(SNAPSHOT_DIR).catch((): string[] => []))
    .filter((file) => DATED.test(file))
    .sort()

  for (const file of dated.slice(0, Math.max(0, dated.length - KEEP_DAYS))) {
    await rm(path.join(SNAPSHOT_DIR, file), { force: true })
  }
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
