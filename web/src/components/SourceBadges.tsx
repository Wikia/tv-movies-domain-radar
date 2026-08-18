import type { Attention, SignalSource } from '../types'
import { Tag } from './Primitives'

/** Which sources a verdict rests on.
 *
 * The point of these is provenance: "trending" on its own is a claim, and the
 * reader's first question is *according to what*. A badge per source answers
 * that in the list, before anyone has to open the detail page.
 *
 * Rising sources are lit; sources that were measured and stayed flat are shown
 * dimmed rather than dropped, because "YouTube says yes, Wikipedia says no" is
 * more useful than a silent consensus — and a source that had nothing to say is
 * absent entirely, which is a third and different state.
 */
const LABEL: Record<SignalSource, string> = {
  wikipedia: 'Wikipedia',
  youtube: 'YouTube',
  news: 'News',
  tmdb: 'TMDB',
}

/** Fixed order so the badges don't reshuffle between rows — a moving legend is
 * much harder to scan than a static one. */
const ORDER: SignalSource[] = ['wikipedia', 'youtube', 'news', 'tmdb']

export function SourceBadges({
  attention,
  showQuiet = true,
}: {
  attention: Attention | undefined
  /** Off in tight spaces, where only the positives fit. */
  showQuiet?: boolean
}) {
  if (!attention) return <span className="text-[11px] text-ink-3">not measured</span>

  const bySource = new Map(attention.sources.map((s) => [s.source, s]))
  const shown = ORDER.filter((source) => {
    const signal = bySource.get(source)
    if (!signal) return false
    return showQuiet || signal.phase === 'rising'
  })
  if (shown.length === 0) return <span className="text-[11px] text-ink-3">no movement</span>

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((source) => {
        const signal = bySource.get(source)!
        const rising = signal.phase === 'rising'
        return (
          <span
            key={source}
            className={rising ? '' : 'opacity-45'}
            title={`${LABEL[source]}: ${signal.phase}, ${signal.relative}× vs similar titles (${signal.metric})`}
          >
            <Tag tone={rising ? 'hot' : 'muted'}>
              {LABEL[source]}
              {rising && <span className="figure"> {signal.relative}×</span>}
            </Tag>
          </span>
        )
      })}
    </span>
  )
}
