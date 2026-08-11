import type { AlertReason, Title } from '../types'

export function formatDate(iso: string | null): string {
  if (!iso) return 'TBD'
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Short weekday — a schedule is read by day-of-week as much as by date. */
export function formatWeekday(iso: string | null): string {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  })
}

export function formatMonth(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** "in 12 days" / "tomorrow" / "today" — the schedule's most-read field. */
export function formatCountdown(daysOut: number | null): string {
  if (daysOut == null) return 'no date'
  if (daysOut < 0) return `${Math.abs(daysOut)}d ago`
  if (daysOut === 0) return 'today'
  if (daysOut === 1) return 'tomorrow'
  if (daysOut < 30) return `in ${daysOut}d`
  const months = Math.round(daysOut / 30)
  return `in ~${months}mo`
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
  'trending-and-imminent': 'trending + landing soon',
  'high-score': 'high demand',
  'newly-added': 'new on calendar',
  'date-changed': 'date moved',
}

/** Semantic, not decorative: on-air marks urgency, signal marks a corroborated
 * shift, ok marks an addition. Colour is doing work here, not styling. */
export const REASON_STYLE: Record<AlertReason, string> = {
  'trending-and-imminent': 'border-onair text-onair bg-onair/10',
  'high-score': 'border-onair text-onair bg-onair/10',
  'newly-added': 'border-ok text-ok',
  'date-changed': 'border-signal text-signal bg-signal/10',
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
