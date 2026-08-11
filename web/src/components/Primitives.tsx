import type { ReactNode } from 'react'

import type { Title } from '../types'
import { hasDemandSignal } from '../types'

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
    <section>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h2 className="section-label">{title}</h2>
        {aside && <span className="text-xs text-ink-3">{aside}</span>}
        {controls && <div className="ml-auto">{controls}</div>}
      </div>
      {children}
    </section>
  )
}

export function Tile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-[104px] rounded-[10px] border border-line bg-raise px-4 py-2.5">
      <div className="figure text-2xl leading-tight font-[650] tracking-tight">{value}</div>
      <div className="mt-px text-[11px] text-ink-3">{label}</div>
    </div>
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
