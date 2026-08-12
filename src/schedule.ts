/** Date maths for the release calendar.
 *
 * This file used to be scoring.ts. The scoring is gone — demand and trending
 * signals were removed after they proved too sparse to rank on — so what
 * remains is ordering and dating the calendar.
 */
import type { Title } from './types.js'

/** Whole days from `today` to `date`. Negative once the date has passed. */
export function daysBetween(today: Date, date: string): number {
  const MS_PER_DAY = 86_400_000
  const target = Date.parse(`${date}T00:00:00Z`)
  const base = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((target - base) / MS_PER_DAY)
}

/** Fill in daysOut for every title. */
export function applyDates(titles: Title[], today: Date): void {
  for (const title of titles) {
    title.daysOut = title.releaseDate ? daysBetween(today, title.releaseDate) : null
  }
}

/** Chronological order, undated titles last — the schedule view, and the only
 * order this tool has an honest basis for. */
export function byReleaseDate(titles: Title[]): Title[] {
  return [...titles].sort((a, b) => {
    if (!a.releaseDate) return 1
    if (!b.releaseDate) return -1
    return a.releaseDate.localeCompare(b.releaseDate) || a.title.localeCompare(b.title)
  })
}
