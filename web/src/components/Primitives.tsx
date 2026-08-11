import type { ReactNode } from 'react'

import type { Title } from '../types'
import { hasDemandSignal } from '../types'

/** A ruled section, not a card. The heavy top rule and condensed uppercase
 * label are the page's structural signature — see index.css. */
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
    <section>
      <header className="flex items-baseline gap-3 border-b border-ink pb-1.5">
        <h2 className="eyebrow tracking-[0.1em]">{title}</h2>
        {subtitle && <p className="figure ml-auto text-[11px] text-faint">{subtitle}</p>}
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
  value: ReactNode
  hint?: string
}) {
  return (
    <div className="border-r border-rule-soft py-3.5 pr-4 last:border-r-0">
      <div className="figure text-[26px] leading-none font-semibold tracking-tight">{value}</div>
      <div className="eyebrow mt-1.5 text-muted">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
    </div>
  )
}

export function TypeBadge({ type }: { type: Title['type'] }) {
  return <span className="eyebrow text-faint">{type === 'movie' ? 'Film' : 'TV'}</span>
}

/** A capped score is an absence of evidence, not a measurement — unbacked
 * titles show a dash so nobody ranks on noise. See the confidence cap in the
 * README. */
export function ScoreBadge({ title }: { title: Title }) {
  if (!hasDemandSignal(title)) {
    return (
      <span
        className="figure w-10 text-right text-faint"
        title="No demand signal — scheduled only. Score is capped and not meaningful."
      >
        —
      </span>
    )
  }
  const tone =
    title.score >= 70 ? 'text-onair font-semibold' : title.score >= 50 ? 'text-signal' : ''
  return (
    <span className={`figure w-10 text-right ${tone}`} title="Blended demand score (0–100)">
      {title.score.toFixed(0)}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-5 text-[13px] text-faint">{children}</p>
}
