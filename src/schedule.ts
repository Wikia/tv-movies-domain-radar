import type { Title } from './types.js'

function daysBetween(today: Date, date: string): number {
  const MS_PER_DAY = 86_400_000
  const target = Date.parse(`${date}T00:00:00Z`)
  const base = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((target - base) / MS_PER_DAY)
}

export function applyDates(titles: Title[], today: Date): void {
  for (const title of titles) {
    title.daysOut = title.releaseDate ? daysBetween(today, title.releaseDate) : null
  }
}

export function byReleaseDate(titles: Title[]): Title[] {
  return [...titles].sort((a, b) => {
    if (!a.releaseDate) return 1
    if (!b.releaseDate) return -1
    return a.releaseDate.localeCompare(b.releaseDate) || a.title.localeCompare(b.title)
  })
}
