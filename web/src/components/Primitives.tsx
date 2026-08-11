import type { ReactNode } from 'react'

import type { Title } from '../types'
import { hasDemandSignal } from '../types'

export function Panel({
  title,
  subtitle,
  children,
  action,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-panel">
      <header className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: number | string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-panel px-5 py-4">
      <div className="text-xs font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function TypeBadge({ type }: { type: Title['type'] }) {
  return (
    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
      {type === 'movie' ? 'Film' : 'TV'}
    </span>
  )
}

/** The score badge deliberately reads as "uncorroborated" rather than showing a
 * number when a title has no demand signal. A capped score of 40 is an absence
 * of evidence, not a measurement, and showing it as a figure invites people to
 * rank on noise — see the confidence cap in the README. */
export function ScoreBadge({ title }: { title: Title }) {
  if (!hasDemandSignal(title)) {
    return (
      <span
        className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted"
        title="No demand signal — scheduled only. Score is capped and not meaningful."
      >
        —
      </span>
    )
  }
  const tone = title.score >= 70 ? 'text-hot' : title.score >= 50 ? 'text-warm' : 'text-cool'
  return (
    <span
      className={`rounded-md border border-border px-2 py-1 text-xs font-semibold tabular-nums ${tone}`}
      title="Blended demand score (0–100)"
    >
      {title.score.toFixed(0)}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-muted">{children}</p>
}
