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

/** Each reason gets its own colour so the alert list is scannable at a glance. */
export const REASON_STYLE: Record<AlertReason, string> = {
  'trending-and-imminent': 'bg-hot/15 text-hot border-hot/30',
  'high-score': 'bg-warm/15 text-warm border-warm/30',
  'newly-added': 'bg-calm/15 text-calm border-calm/30',
  'date-changed': 'bg-cool/15 text-cool border-cool/30',
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
