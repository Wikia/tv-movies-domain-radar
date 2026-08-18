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
  /** An attention signal firing — buzz spike, or a wiki trending. */
  hot: 'border-accent text-accent bg-accent/10',
  /** Deliberately quieter than `hot`: a franchise-level match is a weaker
   * claim than a title-level one and shouldn't read as loud. */
  muted: 'border-line text-ink-3',
  /** Heat bands, quiet -> exceptional. Never used without the number or the
   * band's name beside them. */
  band1: 'border-hot-1 text-hot-1 bg-hot-1/10',
  band2: 'border-hot-2 text-hot-2 bg-hot-2/10',
  band3: 'border-hot-3 text-hot-3 bg-hot-3/10',
  band4: 'border-hot-4 text-hot-4 bg-hot-4/10',
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

/** One row in a signal panel: name, badges, headline number, a detail line and
 * a bar. Shared by Buzz and Trending so the two read as one system — they
 * answer the same question from different data and shouldn't look unrelated.
 *
 * `percent` must be driven by the SAME quantity as `score`. Showing one value
 * and sizing the bar by another makes the ordering look arbitrary. */
export function SignalRow({
  name,
  score,
  detail,
  percent,
  badges,
  title,
  tone = 'accent',
}: {
  name: string
  score: string
  detail: ReactNode
  percent: number
  badges?: ReactNode
  title?: string
  /** Which heat band paints the number and the bar. Defaults to the neutral
   * accent, so band colour only appears when a title has actually earned it. */
  tone?: keyof typeof SIGNAL_TONE
}) {
  const paint = SIGNAL_TONE[tone]
  // The title gets the size, and the supporting figures wrap onto their own
  // lines rather than being cut off by an ellipsis — a truncated wiki name is
  // unreadable, and the numbers under it are the whole point of the row.
  return (
    <div className="border-b border-line-soft py-2.5" title={title}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 text-[14.5px] leading-tight font-semibold [overflow-wrap:anywhere]">
          {name}
        </span>
        {badges}
        <span className={`figure ml-auto text-[13px] font-semibold ${paint.text}`}>{score}</span>
      </div>
      <div className="figure mt-0.5 text-[11px] leading-relaxed text-ink-3">{detail}</div>
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-sm bg-line">
        <div
          className={`h-full ${paint.bg}`}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  )
}

/** Written out in full rather than interpolated: Tailwind scans source for
 * literal class names, so a `text-${tone}` template would be stripped from the
 * build and the colour would silently vanish. */
const SIGNAL_TONE = {
  accent: { text: 'text-accent', bg: 'bg-accent' },
  band1: { text: 'text-hot-1', bg: 'bg-hot-1' },
  band2: { text: 'text-hot-2', bg: 'bg-hot-2' },
  band3: { text: 'text-hot-3', bg: 'bg-hot-3' },
  band4: { text: 'text-hot-4', bg: 'bg-hot-4' },
} as const
