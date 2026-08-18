import type { Attention, SignalSource } from '../types'
import { Tag } from './Primitives'

const LABEL: Record<SignalSource, string> = {
  wikipedia: 'Wikipedia',
  youtube: 'YouTube',
  news: 'News',
  tmdb: 'TMDB',
}

const ORDER: SignalSource[] = ['wikipedia', 'youtube', 'news', 'tmdb']

export function SourceBadges({
  attention,
  showQuiet = true,
}: {
  attention: Attention | undefined

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
