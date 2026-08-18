import type { AlertReason, Title } from '../types'

export function formatDate(iso: string | null): string {
  if (!iso) return 'TBD'
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

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

  'wiki-trending': '',
}

export const REASON_TONE: Record<AlertReason, 'up' | 'moved' | 'hot'> = {
  'newly-added': 'up',
  'date-changed': 'moved',
  'wiki-trending': 'hot',
}

export const CHANGE_REASONS: AlertReason[] = ['newly-added', 'date-changed']

export function isCalendarChange(reasons: AlertReason[] | undefined): boolean {
  return (reasons ?? []).some((reason) => CHANGE_REASONS.includes(reason))
}

export function compact(value: number): string {
  if (value < 1000) return String(value)
  return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k`
}

export function groupByMonth(titles: Title[]): Array<[string, Title[]]> {
  const groups = new Map<string, Title[]>()
  for (const title of titles) {
    const key = title.releaseDate ? title.releaseDate.slice(0, 7) : 'unknown'
    groups.set(key, [...(groups.get(key) ?? []), title])
  }
  return [...groups.entries()]
}
