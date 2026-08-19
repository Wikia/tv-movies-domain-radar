import { compact } from '../lib/format'
import type { Buzz as BuzzReading, RadarOutput, Title } from '../types'
import { Empty, Section, SignalRow, Tag } from './Primitives'

const BAND_TONE = {
  exceptional: 'band1',
  strong: 'band2',
  notable: 'band3',
  quiet: 'band4',
} as const satisfies Record<BuzzReading['band'], string>

const PANEL_SIZE = 12

type ScoredTitle = Title & { buzz: BuzzReading }

const risingFirst = (title: ScoredTitle): number => (title.buzz.phase === 'rising' ? 0 : 1)

export function Buzz({
  titles,
  coverage,
  total,
  onOpen,
}: {
  titles: Title[]
  coverage: RadarOutput['buzz']
  total: number
  onOpen: (id: number) => void
}) {
  const ranked = titles
    .filter((title): title is ScoredTitle => title.buzz != null)
    .sort((a, b) => b.buzz.points - a.buzz.points || risingFirst(a) - risingFirst(b))
    .slice(0, PANEL_SIZE)

  return (
    <Section
      title="Buzz"
      aside={coverage ? `${coverage.spiking} spiking · ${coverage.scored} measured` : 'no data'}
    >
      {!coverage || ranked.length === 0 ? (
        <Empty>
          No attention data for this run. Titles are scored from Wikipedia pageviews; one that isn't
          scored has no signal rather than a low one.
        </Empty>
      ) : (
        <>
          {ranked.map((title) => {
            const buzz = title.buzz
            return (
              <SignalRow
                key={title.id}
                onClick={() => onOpen(title.id)}
                name={title.title}
                score={String(buzz.points)}
                percent={buzz.points}
                tone={BAND_TONE[buzz.band]}
                detail={`+${compact(buzz.excess)}/day over normal · ${compact(buzz.baseline)} → ${compact(buzz.recent)} · ${buzz.momentum}× wk`}
                title={`+${buzz.excess}/day beyond normal for its age (${buzz.baseline} → ${buzz.recent}), cohort ${buzz.cohort}, momentum ${buzz.momentum}× week over week`}
                badges={
                  <>
                    {/* Band colour never travels without the band's name. */}
                    <Tag tone={BAND_TONE[buzz.band]}>{buzz.band}</Tag>
                    {}
                    {title.attention && title.attention.rising.length > 1 && (
                      <Tag tone="muted">{title.attention.rising.length} sources</Tag>
                    )}
                    {}
                    {buzz.phase === 'rising' ? (
                      <Tag tone="hot">rising</Tag>
                    ) : buzz.phase === 'fading' ? (
                      <Tag tone="muted">fading</Tag>
                    ) : null}
                  </>
                }
              />
            )
          })}
          {}
          <p className="pt-2.5 text-[11px] text-ink-3">
            Measured for {coverage.scored} of {total} titles — the rest have no Wikipedia article or
            too little traffic to read.
          </p>
        </>
      )}
    </Section>
  )
}
