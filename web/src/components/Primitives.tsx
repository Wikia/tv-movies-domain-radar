import type { ReactNode } from 'react'

import type { Title } from '../types'
import { hasDemandSignal } from '../types'

/** Section header. The fixed height is load-bearing: the schedule carries
 * inline controls and the sidebar sections don't, and without a shared header
 * height the two columns start on different lines. */
export function Section({
  title,
  aside,
  children,
  controls,
}: {
  title: string
  aside?: string
  children: ReactNode
  controls?: ReactNode
}) {
  return (
    <section className="min-w-0">
      <div className="mb-3.5 flex h-8 flex-wrap items-center gap-3 border-b border-line pb-2">
        <h2 className="section-label">{title}</h2>
        {aside && <span className="text-xs text-ink-3">{aside}</span>}
        {controls && <div className="ml-auto flex items-center gap-1.5">{controls}</div>}
      </div>
      {children}
    </section>
  )
}

/** A stat tile. When `onClick` is given it becomes a filter control — the count
 * and the thing it filters to are the same idea, so clicking the number to see
 * those rows is the obvious gesture. */
export function Tile({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value: ReactNode
  active?: boolean
  onClick?: () => void
}) {
  const base = 'min-w-[104px] rounded-[10px] border px-4 py-2.5 text-left transition-colors'
  const tone = active
    ? 'border-signal bg-signal/10 text-signal'
    : 'border-line bg-raise hover:border-ink-3'

  const content = (
    <>
      <div className="figure text-2xl leading-tight font-[650] tracking-tight">{value}</div>
      <div className={`mt-px text-[11px] ${active ? 'text-signal' : 'text-ink-3'}`}>{label}</div>
    </>
  )

  if (!onClick) return <div className={`${base} ${tone}`}>{content}</div>

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? 'Clear this filter' : `Show only: ${label}`}
      className={`${base} ${tone} cursor-pointer`}
    >
      {content}
    </button>
  )
}

/** A capped score is an absence of evidence, not a measurement — unbacked
 * titles show a dash so nobody ranks on noise. See the README's confidence cap. */
export function Score({ title }: { title: Title }) {
  if (!hasDemandSignal(title)) {
    return (
      <span
        className="figure w-[30px] shrink-0 text-right text-xs text-ink-3"
        title="No demand signal — scheduled only. Score is capped and not meaningful."
      >
        —
      </span>
    )
  }
  return (
    <span
      className={`figure w-[30px] shrink-0 text-right text-xs ${
        title.score >= 70 ? 'font-semibold text-signal' : 'text-ink-3'
      }`}
      title="Blended demand score (0–100)"
    >
      {title.score.toFixed(0)}
    </span>
  )
}

const TAG_TONE = {
  live: 'border-live text-live bg-live/10',
  warn: 'border-signal text-signal bg-signal/10',
  up: 'border-up text-up',
  plain: 'border-line text-ink-3',
} as const

export function Tag({
  tone = 'plain',
  children,
}: {
  tone?: keyof typeof TAG_TONE
  children: ReactNode
}) {
  return (
    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] whitespace-nowrap ${TAG_TONE[tone]}`}>
      {children}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3.5 text-sm text-ink-3">{children}</p>
}
