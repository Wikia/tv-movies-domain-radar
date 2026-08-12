import type { ReactNode } from 'react'

/** Section header. The fixed height is load-bearing: the schedule carries
 * inline controls and the sidebar doesn't, and without a shared header height
 * the two columns start on different lines. */
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

/** A stat tile. With `onClick` it doubles as a filter control — the count and
 * the thing it counts are the same idea, so clicking the number to see those
 * rows is the obvious gesture. */
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
    ? 'border-accent bg-accent/10 text-accent'
    : 'border-line bg-raise hover:border-ink-3'

  const content = (
    <>
      <div className="figure text-2xl leading-tight font-[650] tracking-tight">{value}</div>
      <div className={`mt-px text-[11px] ${active ? 'text-accent' : 'text-ink-3'}`}>{label}</div>
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

const TAG_TONE = {
  up: 'border-up text-up',
  moved: 'border-moved text-moved bg-moved/10',
} as const

export function Tag({
  tone,
  children,
}: {
  tone: keyof typeof TAG_TONE
  children: ReactNode
}) {
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[10px] whitespace-nowrap ${TAG_TONE[tone]}`}
    >
      {children}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3.5 text-sm text-ink-3">{children}</p>
}
