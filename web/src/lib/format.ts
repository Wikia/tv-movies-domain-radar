import type { AlertReason, Title } from '../types'

export function formatDate(iso: string | null): string {
  if (!iso) return 'TBD'
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Dates in a CHANGE must carry the year: without it a slip from 2026-05-01 to
 * 2027-05-01 renders as "May 1 → May 1", i.e. as no change at all. Schedule rows
 * don't need it — their month heading carries the year. */
export function formatDateYear(iso: string | null): string {
  if (!iso) return 'TBD'
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatMonth(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** "in 12 days" / "tomorrow" / "today" — the schedule's most-read field. */
export function formatCountdown(daysOut: number | null): string {
  if (daysOut == null) return '—'
  if (daysOut < 0) return `${Math.abs(daysOut)}d ago`
  if (daysOut === 0) return 'today'
  if (daysOut === 1) return 'tomorrow'
  if (daysOut < 45) return `in ${daysOut}d`
  return `in ${Math.round(daysOut / 30)}mo`
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export const REASON_LABEL: Record<AlertReason, string> = {
  'newly-added': 'new on calendar',
  'date-changed': 'date moved',
}

/** Semantic, not decorative: up = an addition, moved = a date shift. */
export const REASON_TONE: Record<AlertReason, 'up' | 'moved'> = {
  'newly-added': 'up',
  'date-changed': 'moved',
}

/** Group titles by release month, preserving chronological order. */
export function groupByMonth(titles: Title[]): Array<[string, Title[]]> {
  const groups = new Map<string, Title[]>()
  for (const title of titles) {
    const key = title.releaseDate ? title.releaseDate.slice(0, 7) : 'unknown'
    groups.set(key, [...(groups.get(key) ?? []), title])
  }
  return [...groups.entries()]
}
