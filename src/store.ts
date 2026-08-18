/** Durable per-source daily readings.
 *
 * Wikipedia gave us history for free — two months on every call — so the buzz
 * detector worked on its first run. Google News, YouTube and TMDB don't: they
 * report only what is true *now*. A series therefore exists only because we
 * wrote one down, which makes this file the foundation those three sit on.
 *
 * Layout, one file per source:
 *
 *   data/signals/news.json     { "<titleId>": { "2026-08-17": { "articles": 21 } } }
 *   data/signals/youtube.json  { "<titleId>": { "2026-08-17": { "views": 12000 } } }
 *   data/signals/tmdb.json     { "<titleId>": { "2026-08-17": { "popularity": 31.2 } } }
 *
 * Three rules, each of which exists because of a bug this project already hit:
 *
 *  - APPEND, never rewrite. A day once recorded is history; re-running the
 *    pipeline must not disturb it. (The calendar diff was silently erasing a
 *    day's changes by comparing today against today.)
 *  - A MISSING day is missing, not zero. Nothing here fills gaps. Treating an
 *    absent reading as a real zero is what scored the entire calendar 0 when
 *    Wikipedia's publication lag was mistaken for "no views".
 *  - Readings are keyed by title id, so a title that drops off the calendar
 *    keeps its history and gets it back if the release returns.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ROOT, SIGNALS } from './config.js'

const DIR = path.join(ROOT, 'data', 'signals')

/** One day's reading. Several numbers because a single call often returns
 * several worth keeping — TMDB gives popularity AND vote_count, and vote_count
 * is the more honest of the two (a plain counter rather than a smoothed,
 * proprietary composite). */
export type Reading = Record<string, number>

/** date (YYYY-MM-DD) -> reading */
export type Series = Record<string, Reading>

/** title id -> series */
export type SignalStore = Record<string, Series>

export type SourceName = 'news' | 'youtube' | 'tmdb'

function file(source: SourceName): string {
  return path.join(DIR, `${source}.json`)
}

export async function load(source: SourceName): Promise<SignalStore> {
  const raw = await readFile(file(source), 'utf8').catch(() => '{}')
  try {
    return JSON.parse(raw) as SignalStore
  } catch {
    // A corrupt store is regenerable and losing it costs history, not
    // correctness. Never fail a run over it.
    console.warn(`[store] ${source}.json unreadable — starting a fresh store`)
    return {}
  }
}

/** Merge readings in and persist.
 *
 * `readings` is title id -> date -> reading. Existing days are left alone
 * unless the same day is supplied again, which is how a same-day re-run stays
 * idempotent instead of doubling up.
 */
export async function save(
  source: SourceName,
  store: SignalStore,
  readings: SignalStore,
  today: Date,
): Promise<void> {
  for (const [id, series] of Object.entries(readings)) {
    store[id] = { ...(store[id] ?? {}), ...series }
  }
  prune(store, today)
  await mkdir(DIR, { recursive: true })
  await writeFile(file(source), JSON.stringify(store, null, 2))
}

/** Drop days beyond the retention horizon, and titles left with nothing. */
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

/** The days a title has readings for, oldest first. */
export function days(store: SignalStore, titleId: number): string[] {
  return Object.keys(store[String(titleId)] ?? {}).sort()
}

/** A metric as an ordered series, oldest first — or null when the title hasn't
 * been watched long enough to say anything.
 *
 * This is the maturity gate, and it belongs here rather than in each caller:
 * a title we started recording three days ago has no baseline to be unusual
 * against, and scoring it anyway would report every newly-added title as a
 * spike. Returning null makes that a "no signal" the UI already knows how to
 * render, rather than a low score that reads as "cold".
 *
 * Gaps are NOT filled. A caller wanting evenly spaced days must align on the
 * returned dates.
 */
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

/** How many titles have enough history to be usable — for the run log, so
 * partial coverage is stated rather than implied. */
export function mature(store: SignalStore, metric: string): number {
  return Object.keys(store).filter((id) => series(store, Number(id), metric) !== null).length
}

/** Remove a whole source's history. Only used by tooling. */
export async function clear(source: SourceName): Promise<void> {
  await rm(file(source), { force: true })
}

/** Sources with a store on disk, for reporting. */
export async function present(): Promise<string[]> {
  const entries = await readdir(DIR).catch((): string[] => [])
  return entries.filter((name) => name.endsWith('.json')).map((name) => name.replace('.json', ''))
}
